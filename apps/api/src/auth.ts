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
import { assertOtpRate, assertOtpRateExcludingCurrent } from './otp-rate'
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
        /**
         * ⚠️ forget-password 的限流判断**必须**放在这里、而不是
         * `hooks.before` 里 throw 429——原因不是「回调抛错传不回客户端」
         * 那条老理由（虽然那条也成立），是一个更根本的问题：
         *
         * `resolveOTP` 给**已注册**邮箱留下一行持久的 verification 行，
         * 但 better-auth 自己的端点代码对**未注册**邮箱会把刚插入的行
         * 立刻删掉（防枚举，`routes.mjs` 的 `request-password-reset` /
         * `forget-password/email-otp` 都是）。如果限流命中时在
         * hooks.before 里 throw 429，「被限流」（说明这个邮箱之前真的
         * 收到过一次信，即已注册）和「邮箱不存在」（永远 200）就变成两种
         * 外部可分辨的响应——连打两次同一个地址，状态码序列
         * `(200,429)` 还是 `(200,200)` 直接告诉攻击者这个邮箱有没有
         * 账号。这是限流层自己引入的新洞：identifier 格式修对之前，
         * 计数器是哑的，不保护也不泄露；修对之后计数器第一次真的开始
         * 数到已注册邮箱的行，副作用是让这条差异变得可观测。
         *
         * 挂在这里、命中限流时直接 `return`（不发信、不抛错），endpoint
         * 该返回什么还返回什么——统一 200 `{ success: true }`，「被限流」
         * 与「邮箱不存在」从外部彻底不可区分，轰炸防护也没削弱（信确实
         * 没发出去）。详见 otp-rate.test.ts 的
         * 「找回密码限流不能变成注册预言机」与 task-12-report.md。
         *
         * `email-verification` **不**搬到这里、继续留在 hooks.before 里
         * throw 429——见下面 hooks.before 的注释。
         *
         * ⚠️ 这里必须用 `assertOtpRateExcludingCurrent`，不能用
         * `assertOtpRate`：`resolveOTP` 在这个回调被调用之前就已经把
         * 这次请求自己的验证码行插进去了，直接数会把「自己这一行」也算
         * 进冷却窗，导致连第一次请求都被误判成限流（连一封信都发不出
         * 去）。见 otp-rate.ts 里 `assertOtpRateExcludingCurrent` 的
         * 注释。
         */
        if (type === 'forget-password') {
          const verdict = await assertOtpRateExcludingCurrent(
            'forget-password',
            email,
          )
          if (!verdict.ok) return
        }
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
     * `email-verification` 类型的**按邮箱**限流，只挡这一种类型。
     * `forget-password` 的限流判断在上面 `emailOTP` 配置的
     * `sendVerificationOTP` 回调里，**不**在这里——原因是 review round 1
     * 发现的「注册预言机」：`hooks.before` 里 throw 429 会让「限流命中」
     * （邮箱已注册但短时间内又要了一次）与「邮箱未注册」（better-auth
     * 自己永远回 200 防枚举）产生两种外部可分辨的状态码，连打两次就能
     * 反推邮箱是否注册。挂回调里、命中限流时静默不发信但仍返回统一的
     * 200，才能让两种情况从外部彻底不可区分。完整推导见
     * `sendVerificationOTP` 回调那段注释与 task-12-report.md。
     *
     * `email-verification` 保留在这里、继续 429，是因为它**没有同一个
     * 洞**：`/api/auth/sign-up/email` 对已注册邮箱本来就直接抛
     * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`（`sign-up.mjs:212`）——单次
     * 请求、不需要计时或连打两次，就已经把「这个邮箱有没有账号」泄露给
     * 任何人了。email-verification 端点关不关这条限流的 429，都不会让
     * 攻击者多拿到或少拿到这个事实。而 429 对 `/verify` 页的重发按钮是
     * 有用的真实反馈，所以这条路径保持不变。
     *
     * 挂在 `hooks.before` 而不是 `ctx.request?.clone().json()` 或退回
     * 插件回调：Step 1 探针已证实 `ctx.body` 在这里对
     * `/email-otp/send-verification-otp` 是已解析好的请求体（见
     * otp-rate.ts 顶部注释）。
     *
     * ⚠️ 这是 better-auth 的错误信封，**不是 `fail()` 那套**——
     * `ERROR_CODES` 里的 `rate_limited` 在这里用不上。前端在 authClient
     * 侧按 `err.code` 查文案。两套错误码体系刻意不统一。
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/email-otp/send-verification-otp') return
      const type = (ctx.body as { type?: string })?.type
      if (type !== 'email-verification') return
      const email = (ctx.body as { email?: string })?.email
      if (!email) return
      const verdict = await assertOtpRate('email-verification', email)
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
