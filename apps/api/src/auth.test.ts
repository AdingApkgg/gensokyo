import { describe, expect, test } from 'bun:test'
import { app } from './app'

const email = `test-${Date.now()}@example.com`
const password = 'hakurei-reimu-514'

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

    const session = await app.request('/api/auth/get-session', {
      headers: { cookie: cookie ?? '' },
    })
    expect(session.status).toBe(200)
    const body = (await session.json()) as { user?: { email: string } }
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
