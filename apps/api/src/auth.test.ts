import { afterAll, describe, expect, test } from 'bun:test'
import { app } from './app'
import { cleanupTracked, trackUser } from './testing'

const email = `test-${Date.now()}@example.com`
const password = 'hakurei-reimu-514'

afterAll(cleanupTracked)

describe('auth flow', () => {
  test('注册 → 拿到会话 cookie → get-session 返回用户', async () => {
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: '博丽灵梦' }),
    })
    expect(signUp.status).toBe(200)
    const cookie = signUp.headers.get('set-cookie')
    expect(cookie).toContain('better-auth.session_token')
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const session = await app.request('/api/auth/get-session', {
      headers: { cookie: cookie ?? '' },
    })
    expect(session.status).toBe(200)
    const body = (await session.json()) as { user?: { email: string } }
    expect(body.user?.email).toBe(email)
  })

  test('/api/me 未登录返回 null，登录后返回用户', async () => {
    const anon = await app.request('/api/me')
    expect(await anon.json()).toEqual({ user: null })

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const cookie = signIn.headers.get('set-cookie') ?? ''
    const res = await app.request('/api/me', { headers: { cookie } })
    const body = (await res.json()) as { user: { email: string } | null }
    expect(body.user?.email).toBe(email)
  })

  test('错误密码登录被拒', async () => {
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password-9' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('注册开关', () => {
  /**
   * 这条钉的是「开关必须在服务端强制」：之前它只是后台的一个 UI 状态，
   * 生产关了三个月照样能注册。挡在 better-auth 的 user.validateUserInfo
   * 钩子里，绕过页面直接打 API 也进不来。
   */
  test('registrationOpen=false 时 sign-up 返回 403 与 REGISTRATION_CLOSED', async () => {
    const { db, schema } = await import('@gensokyo/db')
    const { eq } = await import('drizzle-orm')
    const { invalidateConfig } = await import('./site-config')
    await db
      .insert(schema.siteConfig)
      .values({ key: 'registrationOpen', value: false })
      .onConflictDoUpdate({
        target: schema.siteConfig.key,
        set: { value: false },
      })
    invalidateConfig()
    try {
      const res = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `closed-${Date.now()}@example.com`,
          password,
          name: '门外的人',
        }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { code?: string; message?: string }
      // ⚠️ 这个码是前端 register.tsx 的匹配依据。改这里就要同步改那里。
      // 实测值（validateUserInfo 的错误形状，2026-09-11）：
      // status 403，body { code: 'REGISTRATION_CLOSED', message: 'REGISTRATION_CLOSED' }。
      // 与旧的 APIError 形状相比，code 与 status 都不变，只有 message 从
      // 'registration is closed' 变成了与 code 相同的字符串（没传 errorDescription
      // 时 better-auth 回落成 error 本身）——前端不读 message，不受影响。
      expect(body.code).toBe('REGISTRATION_CLOSED')
      // 登录不受开关影响
      const login = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      expect(login.status).toBe(200)
    } finally {
      // 开发库是共享的：不恢复的话后面每个注册账号的测试都会 403
      await db
        .delete(schema.siteConfig)
        .where(eq(schema.siteConfig.key, 'registrationOpen'))
      invalidateConfig()
    }
  })

  // emailOTP 的 sign-in 路径（disableSignUp + validateUserInfo 双重挡住建号）
  // 在这一层**刻意不测**：实测过一条按此路径写的测试用假验证码
  // '000000' 会在两道闸之前就被 atomicVerifyOTP 拒掉（INVALID_OTP），
  // 所以那种写法测的是「假验证码被拒」，不是「注册开关生效」——绿灯不等于
  // 证据，删掉了。改用真验证码同样走不通：POST
  // /email-otp/send-verification-otp（type: 'sign-in'）在 disableSignUp
  // 为 true 时，对不存在的邮箱会在调用我们的 sendVerificationOTP 回调之前
  // 就短路——它统一回 200 { success: true }（防枚举），既不产生持久化的
  // verification 行，也不触发任何发信（实测：捕获 console.info 得到 0
  // 条命中，直接查 verification 表得到 0 行）。也就是说这条路径从公开
  // HTTP 接口拿不到一个真验证码，没有不靠 mock 发信或不碰 better-auth
  // 内部哈希算法就能诚实通过闸门的测试写法。这条路径的真实防线仍然是
  // disableSignUp（挡在 send-verification-otp 这一层，比 sign-in 端点
  // 更早）与 validateUserInfo（万一 disableSignUp 被改回 false 时的最后
  // 一道闸，由上面 sign-up/email 那条测试直接钉住）——只是没有测试能在
  // HTTP 层同时证明两者在 emailOTP 路径上真的生效。
})
