import { afterAll, describe, expect, test } from 'bun:test'
import { cleanupTracked, trackUser } from '@gensokyo/db/testing'
import { app } from './app'

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
   * 生产关了三个月照样能注册。挡在 better-auth 的 before 钩子里，
   * 绕过页面直接打 API 也进不来。
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
      const body = (await res.json()) as { code?: string }
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
})
