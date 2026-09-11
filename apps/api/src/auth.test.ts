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

  test('开关关闭时，emailOTP 的 sign-in 路径也建不出新号', async () => {
    // disableSignUp: true 已经挡住这条路，但这条测试钉的是「注册开关
    // 不再依赖路径匹配」——将来谁把 disableSignUp 改回 false，
    // validateUserInfo 仍然是最后一道闸。
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
    const fresh = `otp-signup-${Date.now()}@example.com`
    try {
      const res = await app.request('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: fresh, otp: '000000' }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      const [created] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, fresh))
        .limit(1)
      expect(created).toBeUndefined()
    } finally {
      await db
        .delete(schema.siteConfig)
        .where(eq(schema.siteConfig.key, 'registrationOpen'))
      invalidateConfig()
    }
  })
})
