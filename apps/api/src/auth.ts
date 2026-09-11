import { db } from '@gensokyo/db'
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  pickRequestLocale,
  readCookie,
} from '@gensokyo/shared'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { takeoverIfUnverified } from './auth/arbitrate'
import { sendMail } from './mail'
import type { OtpPurpose } from './mail/templates/otp'
import { renderOtpMail } from './mail/templates/otp'
import { assertOtpRate } from './otp-rate'
import { registrationOpen } from './site-config'

/** 10 分钟。默认的 5 分钟对「切到手机收信再切回来」偏紧 */
export const OTP_EXPIRES_SECONDS = 600

/**
 * Google 凭据是**可选**的：本地开发不该因为没申请 OAuth 应用就跑不起来。
 * 两个都配齐才注册这个 provider，前端靠 `GET /api/config` 的 googleEnabled
 * 决定要不要显示按钮。
 */
export const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
    /**
     * ⚠️ **默认是 `false`。** 找回密码的典型场景就是「怀疑号被盗」——
     * 不吊销会话等于没找回：盗号者手里那个会话照样有效。
     */
    revokeSessionsOnPasswordReset: true,
  },
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  // 硬编码 localhost 会让生产域名不在信任列表里、登录全废；
  // 但也绝不能退化成 '*'，那会连 better-auth 的 CSRF 防线一起拆掉
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_EXPIRES_SECONDS,
      allowedAttempts: 3,
      sendVerificationOnSignUp: true,
      /**
       * ⚠️ **默认是 `'plain'`**——验证码会明文躺在 `verification` 表里，
       * 任何拿到只读库权限的人可以直接读出任何人当下的验证码。
       */
      storeOTP: 'hashed',
      /**
       * ⚠️ **默认是 `false`**——那样 `sign-in` 类型的 OTP 在邮箱不存在时会
       * **自动建号**，等于凭空开出第二条完全绕过注册开关的注册路径。
       * 我们只用 `email-verification` 与 `forget-password` 两种类型。
       */
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }, ctx) => {
        // 只有这两种类型会被我们触发；别的类型不该发信
        if (type !== 'email-verification' && type !== 'forget-password') return
        const headers = ctx?.request?.headers
        const locale = pickRequestLocale(
          headers?.get(LOCALE_HEADER),
          readCookie(headers?.get('cookie'), LOCALE_COOKIE),
        )
        await sendMail(
          renderOtpMail(locale, type, otp, email, OTP_EXPIRES_SECONDS / 60),
        )
      },
    }),
  ],

  hooks: {
    /**
     * 发码类端点的**按邮箱**限流。挂在这里而不是 `sendVerificationOTP`
     * 回调里：那个回调被 `runInBackgroundOrAwait` 调用，抛错未必能传回
     * 客户端，限流会表现成「静默不发信」。Step 1 探针已经证实
     * `hooks.before` 里 `ctx.body` 对这两条路径都是已解析好的请求体
     * （见 otp-rate.ts 顶部注释），不需要退回 `ctx.request?.clone().json()`
     * 或插件回调兜底。
     *
     * ⚠️ 这是 better-auth 的错误信封，**不是 `fail()` 那套**——
     * `ERROR_CODES` 里的 `rate_limited` 在这里用不上。前端在 authClient
     * 侧按 `err.code` 查文案。两套错误码体系刻意不统一。
     *
     * ⚠️ `/forget-password/email-otp` 是 better-auth **默认仍会注册**的
     * deprecated 别名（`email-otp/index.mjs` 里 `forgetPasswordEmailOTP`
     * 和 `requestPasswordResetEmailOTP` 一起无条件挂载），内部调用同一个
     * `resolveOTP(..., "forget-password")`、写同一种 identifier——漏掉它
     * 的话限流形同虚设：自查时用一次性脚本连打两次都拿到 200，
     * `otp-rate.test.ts` 里有一条测试钉住这一点。
     */
    before: createAuthMiddleware(async (ctx) => {
      const purpose =
        ctx.path === '/email-otp/send-verification-otp'
          ? ((ctx.body as { type?: string })?.type as OtpPurpose | undefined)
          : ctx.path === '/email-otp/request-password-reset' ||
              ctx.path === '/forget-password/email-otp'
            ? ('forget-password' as const)
            : undefined
      if (!purpose) return
      const email = (ctx.body as { email?: string })?.email
      if (!email) return
      const verdict = await assertOtpRate(purpose, email)
      if (verdict.ok) return
      throw new APIError('TOO_MANY_REQUESTS', {
        code: 'RATE_LIMITED',
        message: `请等待 ${verdict.retryAfterSeconds} 秒后再试`,
      })
    }),
  },

  socialProviders: googleConfigured()
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : {},

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      /**
       * ⚠️ 把仲裁权接管过来。默认 true 时 better-auth 会直接**拒绝**链接到
       * 未验证的本地账号——那是安全的，但用户会卡死且没有出路。
       * 我们改成放行链接，再由 databaseHooks 里的 takeoverIfUnverified
       * 把抢注者的密码与会话清掉。见 auth/arbitrate.ts 的长注释。
       */
      requireLocalEmailVerified: false,
    },
  },

  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          if (account.providerId !== 'google') return
          await takeoverIfUnverified(account.userId)
        },
      },
    },
  },

  user: {
    /**
     * 注册开关的**唯一**强制点。
     *
     * 此前 `registrationOpen` 只被后台开关页读写，服务端零调用——生产上
     * 把它关了三个月，任何人照样能注册。开关必须挡在 better-auth 的入口
     * 而不是注册页：页面只是提示，`POST /api/auth/sign-up/email` 才是门。
     *
     * 这个钩子「在 create-user / link-account / OAuth 的 sign-in 之前触发，
     * 横跨每一种认证方式」。此前按路径拦 `/sign-up/email`，每加一种登录
     * 方式就要记得再判一次——而「记得」不是一种机制。挪到这里之后，
     * Google 登录（首次登录即建号）自动受这道闸约束，不必再判一次。
     *
     * 配置走进程内 60s 缓存，后台写入时 `invalidateConfig()` 立即失效；
     * 多进程部署最多陈旧一个 TTL，对「关注册」这件事可以接受。
     */
    validateUserInfo: async ({ source }) => {
      if (source.action !== 'create-user') return
      if (await registrationOpen()) return
      return { error: 'REGISTRATION_CLOSED' }
    },
  },
})
