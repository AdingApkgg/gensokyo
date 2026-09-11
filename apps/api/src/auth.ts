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
  hooks: {
    /**
     * 注册开关的**唯一**强制点。
     *
     * 此前 `registrationOpen` 只被后台开关页读写，服务端零调用——生产上
     * 把它关了三个月，任何人照样能注册。开关必须挡在 better-auth 的入口
     * 而不是注册页：页面只是提示，`POST /api/auth/sign-up/email` 才是门。
     *
     * 只拦 `/sign-up/email`：登录、登出、改密码不受影响；将来加社交登录
     * 时它的注册路径（`/callback/*` 里的首次登录）要另判，这里不会自动覆盖。
     *
     * 配置走进程内 60s 缓存，后台写入时 `invalidateConfig()` 立即失效；
     * 多进程部署最多陈旧一个 TTL，对「关注册」这件事可以接受。
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return
      if (await registrationOpen()) return
      throw new APIError('FORBIDDEN', {
        code: 'REGISTRATION_CLOSED',
        message: 'registration is closed',
      })
    }),
  },
})
