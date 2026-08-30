import { afterAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { app } from './app'
import { requireAuth, requireRole } from './middleware/require'
import { type AppEnv, sessionMiddleware } from './middleware/session'
import { cleanupTracked, trackUser } from './test-support'

/**
 * 中间件挂在一个本地 app 上测，不往生产 app 里塞测试路由。
 * 会话 cookie 仍来自真实的 better-auth 注册流程。
 */
const probe = new Hono<AppEnv>()
  .use('*', sessionMiddleware)
  .get('/open', (c) => c.json({ actor: c.get('actor')?.name ?? null }))
  .get('/protected', requireAuth, (c) => c.json({ ok: true }))
  .get('/staff', requireRole('moderator'), (c) => c.json({ ok: true }))

async function signUp(name: string) {
  const email = `mw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const cookie = res.headers.get('set-cookie') ?? ''
  const body = (await res.json()) as { user?: { id: string } }
  return { cookie, userId: trackUser(body.user?.id) }
}

afterAll(cleanupTracked)

describe('会话中间件', () => {
  test('未登录时 actor 为 null', async () => {
    const res = await probe.request('/open')
    expect(await res.json()).toEqual({ actor: null })
  })

  test('登录后注入 actor 并惰性创建 user_profile', async () => {
    const { cookie, userId } = await signUp('雾雨魔理沙')
    const res = await probe.request('/open', { headers: { cookie } })
    expect(await res.json()).toEqual({ actor: '雾雨魔理沙' })

    const [profile] = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, userId))
    expect(profile?.role).toBe('user')
    expect(profile?.approvedResourceCount).toBe(0)
    expect(profile?.strikeCount).toBe(0)
  })
})

describe('权限中间件', () => {
  test('未登录访问受保护路由 → 401，统一错误信封', async () => {
    const res = await probe.request('/protected')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
  })

  test('登录用户可访问受保护路由', async () => {
    const { cookie } = await signUp('十六夜咲夜')
    const res = await probe.request('/protected', { headers: { cookie } })
    expect(res.status).toBe(200)
  })

  test('普通用户访问审核路由 → 403', async () => {
    const { cookie } = await signUp('琪露诺')
    const res = await probe.request('/staff', { headers: { cookie } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'forbidden' } })
  })

  test('提权为 moderator 后可访问审核路由', async () => {
    const { cookie, userId } = await signUp('八云紫')
    await probe.request('/open', { headers: { cookie } }) // 先建出 profile
    await db
      .update(schema.userProfile)
      .set({ role: 'moderator' })
      .where(eq(schema.userProfile.userId, userId))

    const res = await probe.request('/staff', { headers: { cookie } })
    expect(res.status).toBe(200)
  })
})
