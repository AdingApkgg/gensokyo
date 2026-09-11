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
import { renderOtpMail } from './mail/templates/otp'
import { assertOtpRate, otpRateTarget } from './otp-rate'
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
        // 只有这两种类型会被我们触发；别的类型不该发信。
        // ⚠️ **限流判断不在这里**——它在下面的 hooks.before，必须早于
        // `resolveOTP` 写行。回调被调用时这次请求的验证码行早就落库了，
        // 在这里拒发只会留下一行没人收到过的「更新的」码，把用户手里那封
        // 信作废。见 otp-rate.ts 顶部与 hooks.before 的注释
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
     * 发码的**按邮箱**限流，两种用途都挂在这里，**唯一**的挂载点。
     *
     * ⚠️ **必须挡在 `resolveOTP` 之前**，这是 round 3 的 Critical：
     * `resolveOTP` 在端点里无条件先插一行验证码，而
     * `consumeVerificationValue` 只认「该 identifier 最新的一行」并在消费
     * 时删光全部行。晚于插入的限流判断被拒时会留下一行没人收到过的、更新
     * 的码，用户输信箱里那个旧码 → 匹配的是新行 → `INVALID_OTP` + 两行
     * 一起删光，人被卡死在「验证码错误」上。`hooks.before` 跑在 endpoint
     * handler 之前，所以短路时那一行根本不会被写。附带好处：小时配额数的
     * 重新是「真发出去的信」，而不是「被拒的尝试」。
     *
     * 命中限流后的回应按用途分两种，**这个差异是刻意的**：
     *
     * - `forget-password` → **短路成与端点自己一模一样的 200
     *   `{ success: true }`**，绝不能抛错。better-auth 对未注册邮箱永远回
     *   200 防枚举（`routes.mjs` 里 `findUserByEmail` 落空就把行删掉再回
     *   200），我们要是回 429，连打两次的状态码序列 `(200,429)` 与
     *   `(200,200)` 就成了一个注册预言机（round 1 review 发现）。
     *   dispatch 支持这种短路：`hooks.before` 返回一个**不含 `context` 键**
     *   的对象时，`runBeforeHooks` 直接把它当响应返回、endpoint handler
     *   完全不跑（`better-auth/dist/api/dispatch.mjs` 的 `runBeforeHooks`
     *   末尾与 `dispatchAuthEndpoint` 的 `else if (before)` 分支），再经
     *   `toResponse` 变成 200 + `application/json`——与端点自己
     *   `ctx.json({ success: true })` 的产物逐字节一致。
     *
     * - `email-verification` → 继续 429。它**没有同一个洞**：
     *   `/api/auth/sign-up/email` 对已注册邮箱本来就直接抛
     *   `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`（`sign-up.mjs:212`，因为我们
     *   既没开 `requireEmailVerification` 也没关 `autoSignIn`）——单次请求
     *   就泄露了同一个事实，这条 429 不多泄露什么；而 429 是 `/verify` 页
     *   重发按钮唯一的真实反馈。⚠️ **这条决策以那个泄露为前提**：将来谁把
     *   sign-up 的枚举洞堵上（改用统一 200 或强制 `requireEmailVerification`），
     *   **必须同时把这里的 429 也改成上面那种静默短路**，否则
     *   `/email-otp/send-verification-otp` 带 `type: 'email-verification'`
     *   仍然是 `(200,429)` vs `(200,200)`，堵洞只堵了一半。
     *
     * 分派用 `otpRateTarget()` 这个纯函数：发 forget-password 码的路径有
     * **三条**（新端点 / deprecated 别名 / `send-verification-otp` 带
     * `type`），漏一条不会报错，只会静默放行。
     *
     * ⚠️ 这是 better-auth 的错误信封，**不是 `fail()` 那套**——
     * `ERROR_CODES` 里的 `rate_limited` 在这里用不上。前端在 authClient
     * 侧按 `err.code` 查文案。两套错误码体系刻意不统一。
     */
    before: createAuthMiddleware(async (ctx) => {
      const target = otpRateTarget(ctx.path, ctx.body)
      if (!target) return
      const verdict = await assertOtpRate(target.purpose, target.email)
      if (verdict.ok) return
      if (target.purpose === 'email-verification')
        throw new APIError('TOO_MANY_REQUESTS', {
          code: 'RATE_LIMITED',
          message: `请等待 ${verdict.retryAfterSeconds} 秒后再试`,
        })
      // 端点自己那个防枚举响应，逐字段照抄
      return { success: true }
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
