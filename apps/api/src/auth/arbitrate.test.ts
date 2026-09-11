import { afterAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { and, eq } from 'drizzle-orm'
import { app } from '../app'
import { cleanupTracked, markVerified, trackUser } from '../testing'
import { takeoverIfUnverified } from './arbitrate'

const password = 'hakurei-reimu-514'

afterAll(cleanupTracked)

/** 建一个真账号：signUp 会同时造出 user、credential account 与一个 session */
async function signUp(tag: string) {
  const email = `arb-${tag}-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: '测试' }),
  })
  const id = ((await res.json()) as { user?: { id: string } }).user
    ?.id as string
  trackUser(id)
  return { id, email }
}

const credentials = (userId: string) =>
  db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential'),
      ),
    )

const sessions = (userId: string) =>
  db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, userId))

describe('takeoverIfUnverified', () => {
  test('未验证 + 有密码 → 接管：删掉密码，吊销全部会话', async () => {
    const { id } = await signUp('takeover')
    expect(await credentials(id)).not.toHaveLength(0)
    expect(await sessions(id)).not.toHaveLength(0)

    expect(await takeoverIfUnverified(id)).toBe(true)

    // 抢注者的密码从此无效
    expect(await credentials(id)).toHaveLength(0)
    // 抢注者可能正登录着，会话必须一起吊销
    expect(await sessions(id)).toHaveLength(0)
  })

  test('已验证 → 不动：密码保留，会话保留（两边都是本人）', async () => {
    const { id } = await signUp('verified')
    await markVerified(id)

    expect(await takeoverIfUnverified(id)).toBe(false)

    expect(await credentials(id)).not.toHaveLength(0)
    expect(await sessions(id)).not.toHaveLength(0)
  })

  test('未验证但没有密码 → 不动（这是 Google 刚建的新号，没什么可接管的）', async () => {
    const { id } = await signUp('nopass')
    await db
      .delete(schema.account)
      .where(
        and(
          eq(schema.account.userId, id),
          eq(schema.account.providerId, 'credential'),
        ),
      )

    expect(await takeoverIfUnverified(id)).toBe(false)
    // 没有误伤会话
    expect(await sessions(id)).not.toHaveLength(0)
  })

  test('用户不存在 → 返回 false 而不是抛错', async () => {
    expect(await takeoverIfUnverified('no-such-user-id')).toBe(false)
  })
})
