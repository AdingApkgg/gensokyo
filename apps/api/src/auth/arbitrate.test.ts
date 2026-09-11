import { afterAll, describe, expect, spyOn, test } from 'bun:test'
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

  /**
   * 这条钉的是「失败必须留下痕迹」。
   *
   * 函数体里任何一处抛错，都会沿 `create.after` →
   * `queueAfterTransactionHook`（没给 `onError`，原样 re-throw）→
   * `createWithHooks` → `linkAccount` 一路冒到 `link-account.mjs` 的泛用
   * catch，在那里变成一句 `Unable to link account`。而 `account` 行**已经
   * 提交**，用户重试会走已链接分支（不再触发本钩子、却会把 `emailVerified`
   * 置 true），抢注者的密码原封不动——事后没有任何东西能把这个状态与
   * 「本来就已验证的账号接上 Google」区分开。
   *
   * 所以唯一的出口是那条带 userId 的日志。删掉 try/catch，这条测试会因为
   * 异常直接冒出来而红。
   */
  test('中途抛错 → 吞掉并留一条带 userId 的日志，不往上抛', async () => {
    const { id } = await signUp('boom')
    const logs: string[] = []
    const errSpy = spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    const txSpy = spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('模拟：删密码时数据库断线')
    })
    try {
      expect(await takeoverIfUnverified(id)).toBe(false)
    } finally {
      txSpy.mockRestore()
      errSpy.mockRestore()
    }

    expect(logs.some((l) => l.includes('抢注仲裁失败') && l.includes(id))).toBe(
      true,
    )
    // 失败之后抢注者的密码确实还在——这正是那条日志要运维去手工处理的状态
    expect(await credentials(id)).not.toHaveLength(0)
  })
})
