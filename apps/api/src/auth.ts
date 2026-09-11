import { db } from '@gensokyo/db'
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  pickRequestLocale,
  readCookie,
} from '@gensokyo/shared'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { sendMail } from './mail'
import { renderOtpMail } from './mail/templates/otp'
import { registrationOpen } from './site-config'

/** 10 分钟。默认的 5 分钟对「切到手机收信再切回来」偏紧 */
export const OTP_EXPIRES_SECONDS = 600

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
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
