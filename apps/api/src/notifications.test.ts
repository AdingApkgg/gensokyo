import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import {
  cleanupTracked,
  trackResource,
  trackTopic,
  trackUser,
} from '@gensokyo/db/testing'
import { and, eq } from 'drizzle-orm'
import { app } from './app'
import { notify } from './notify'

type Session = { cookie: string; userId: string; handle: string }

async function signUp(name: string): Promise<Session> {
  const email = `nt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  const cookie = res.headers.get('set-cookie') ?? ''
  // 惰性建档 + 拿派生 handle
  const me = await app.request('/api/me', { headers: { cookie } })
  const { user } = (await me.json()) as { user: { handle: string } }
  return { cookie, userId: trackUser(body.user?.id), handle: user.handle }
}

afterAll(cleanupTracked)

const send = (s: Session, method: string, body?: unknown) => ({
  method,
  headers: { cookie: s.cookie, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

async function setRole(s: Session, role: 'moderator' | 'admin') {
  await db
    .update(schema.userProfile)
    .set({ role })
    .where(eq(schema.userProfile.userId, s.userId))
}

async function makeTopic(s: Session, body = '主题正文') {
  const res = await app.request(
    '/api/shrine/topics',
    send(s, 'POST', {
      boardSlug: 'meta',
      title: `通知测试 ${Math.random().toString(36).slice(2, 7)}`,
      bodyMd: body,
    }),
  )
  const b = (await res.json()) as { id: string; postId: string }
  trackTopic(b.id)
  return b
}

async function reply(
  s: Session,
  topicId: string,
  bodyMd: string,
  parentId?: string,
) {
  const res = await app.request(
    `/api/shrine/topics/${topicId}/posts`,
    send(s, 'POST', { bodyMd, ...(parentId ? { parentId } : {}) }),
  )
  return (await res.json()) as { id: string; floor: number }
}

const inbox = async (s: Session) => {
  const res = await app.request('/api/notifications?pageSize=100', {
    headers: { cookie: s.cookie },
  })
  return (await res.json()) as {
    items: {
      id: string
      kind: string
      topicId: string | null
      postId: string | null
      subject: { kind: string; title?: string } | null
      payload: Record<string, unknown> | null
      actor: { id: string; handle: string } | null
      floor: number | null
      read: boolean
    }[]
    total: number
  }
}

const unread = async (s: Session) => {
  const res = await app.request('/api/me', { headers: { cookie: s.cookie } })
  return ((await res.json()) as { user: { unread: number } }).user.unread
}

async function makeResource(owner: Session, trusted: boolean) {
  if (trusted) {
    await db
      .update(schema.userProfile)
      .set({ approvedResourceCount: 5 })
      .where(eq(schema.userProfile.userId, owner.userId))
  }
  const created = await app.request(
    '/api/kourindou/resources',
    send(owner, 'POST', {
      titleOriginal: '通知テスト',
      titleOriginalLocale: 'ja',
      kind: 'music',
      license: 'allowed',
    }),
  )
  const { resource } = (await created.json()) as {
    resource: { id: string; slug: string }
  }
  await app.request(`/api/kourindou/resources/${resource.id}/submit`, {
    method: 'POST',
    headers: { cookie: owner.cookie },
  })
  return trackResource(resource)
}

let staff: Session
let boss: Session
beforeAll(async () => {
  staff = await signUp('版主')
  boss = await signUp('站长')
  await setRole(staff, 'moderator')
  await setRole(boss, 'admin')
})

describe('回复与 @', () => {
  test('回复主题 → 楼主收到 reply；回复者自己不收', async () => {
    const a = await signUp('楼主A')
    const b = await signUp('回复者B')
    const t = await makeTopic(a)
    const r = await reply(b, t.id, '沙发')

    const { items } = await inbox(a)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'reply',
      topicId: t.id,
      postId: r.id,
      floor: 2,
      read: false,
      actor: { id: b.userId, handle: b.handle },
      subject: { kind: 'topic' },
    })
    expect((await inbox(b)).total).toBe(0)
    expect(await unread(a)).toBe(1)
  })

  test('自己回自己的主题不产生通知', async () => {
    const a = await signUp('自言自语')
    const t = await makeTopic(a)
    await reply(a, t.id, '补充一下')
    expect((await inbox(a)).total).toBe(0)
  })

  test('同一楼层既回复又 @ 楼主 → 只留一条 mention', async () => {
    const a = await signUp('被@的楼主')
    const b = await signUp('回复并@')
    const t = await makeTopic(a)
    await reply(b, t.id, `@${a.handle} 看这里`)

    const { items } = await inbox(a)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('mention')
  })

  test('@ 第三人 → 第三人收到 mention；@ 不存在的 handle 静默忽略', async () => {
    const a = await signUp('楼主')
    const b = await signUp('回复者')
    const x = await signUp('被叫到的')
    const t = await makeTopic(a)
    await reply(b, t.id, `叫一下 @${x.handle} 和 @nobody_here_404`)

    expect((await inbox(x)).items.map((i) => i.kind)).toEqual(['mention'])
    expect((await inbox(a)).items.map((i) => i.kind)).toEqual(['reply'])
  })

  test('回复某一楼 → 那楼作者与楼主各收一条 reply（≤2 行）', async () => {
    const a = await signUp('楼主')
    const b = await signUp('二楼')
    const cc = await signUp('回二楼的')
    const t = await makeTopic(a)
    const second = await reply(b, t.id, '二楼')
    await reply(cc, t.id, '回二楼', second.id)

    expect((await inbox(b)).items.map((i) => i.kind)).toEqual(['reply'])
    // 楼主两条：二楼的、回二楼的
    expect((await inbox(a)).items.map((i) => i.kind)).toEqual([
      'reply',
      'reply',
    ])
  })

  test('主楼可以 @ 人', async () => {
    const a = await signUp('开帖@人')
    const x = await signUp('被开帖@的')
    await makeTopic(a, `开个新帖，@${x.handle} 来看`)
    expect((await inbox(x)).items.map((i) => i.kind)).toEqual(['mention'])
  })
})

describe('治理链上的通知', () => {
  test('审核通过 / 拒绝 → 投稿者各收一条，带 resourceId', async () => {
    const u = await signUp('投稿者')
    const r1 = await makeResource(u, false)
    await app.request(
      `/api/moderation/resources/${r1.id}/review`,
      send(staff, 'POST', { decision: 'approve' }),
    )
    const r2 = await makeResource(u, false)
    await app.request(
      `/api/moderation/resources/${r2.id}/review`,
      send(staff, 'POST', {
        decision: 'reject',
        rejectReason: 'low_quality',
        note: '再改改',
      }),
    )
    const { items } = await inbox(u)
    expect(items.map((i) => i.kind).sort()).toEqual([
      'review_approved',
      'review_rejected',
    ])
    const rejected = items.find((i) => i.kind === 'review_rejected')
    expect(rejected?.payload).toMatchObject({ rejectReason: 'low_quality' })
    expect(rejected?.subject?.kind).toBe('resource')
  })

  test('staff 下架 → 通知作者；作者自助下架 → 不通知自己', async () => {
    const u = await signUp('会被下架的')
    const r = await makeResource(u, true)
    await app.request(
      `/api/kourindou/resources/${r.id}/status`,
      send(staff, 'POST', { to: 'delisted', reason: '版权方要求' }),
    )
    const { items } = await inbox(u)
    expect(items.map((i) => i.kind)).toEqual(['resource_delisted'])
    // 自由文本 reason 是审计内容，不投递给作者
    expect(items[0]?.payload).toBeNull()

    const self = await signUp('自己下架的')
    const r2 = await makeResource(self, true)
    await app.request(
      `/api/kourindou/resources/${r2.id}/status`,
      send(self, 'POST', { to: 'delisted' }),
    )
    expect((await inbox(self)).total).toBe(0)
  })

  /**
   * P0-11：硬删会在同一个事务里顺着 resourceId 外键把通知自己级联删掉，
   * 症状是「什么都没发生」。唯一能发现它的方式就是这条断言。
   */
  test('硬删之后「你的资源被删除了」这条通知**仍然存在**（P0-11）', async () => {
    const u = await signUp('被硬删的')
    const r = await makeResource(u, true)
    const res = await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'purge', reason: '侵权确认' }),
    )
    expect(res.status).toBe(200)

    const { items } = await inbox(u)
    expect(items.map((i) => i.kind)).toEqual(['resource_deleted'])
    expect(items[0]?.payload).toEqual({ title: '通知テスト', slug: r.slug })
    expect(items[0]?.subject).toEqual({ kind: 'removed' })
  })

  test('软删通知作者且幂等：第二次软删 → 409', async () => {
    const u = await signUp('被软删的')
    const r = await makeResource(u, true)
    const first = await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'soft', reason: '先下来看看' }),
    )
    expect(first.status).toBe(200)
    const again = await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'soft', reason: '再删一次' }),
    )
    expect(again.status).toBe(409)
    const { items } = await inbox(u)
    expect(items.map((i) => i.kind)).toEqual(['resource_delisted'])
    // 软删的资源对收件人也是「已移除」
    expect(items[0]?.subject).toEqual({ kind: 'removed' })
  })

  test('恢复留痕', async () => {
    const u = await signUp('会被恢复的')
    const r = await makeResource(u, true)
    await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'soft', reason: '误删' }),
    )
    const res = await app.request(
      `/api/admin/resources/${r.id}/restore`,
      send(boss, 'POST'),
    )
    expect(res.status).toBe(200)
    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(
        and(
          eq(schema.moderationLog.subjectId, r.id),
          eq(schema.moderationLog.action, 'status_change'),
        ),
      )
    expect(
      logs.some((l) => (l.toValue as { deleted?: boolean })?.deleted === false),
    ).toBe(true)
  })

  test('staff 删楼 → 作者收到 post_deleted，带理由', async () => {
    const a = await signUp('楼主')
    const b = await signUp('被删楼的')
    const t = await makeTopic(a)
    const r = await reply(b, t.id, '广告')
    await app.request(
      `/api/shrine/posts/${r.id}`,
      send(staff, 'DELETE', { reason: 'spam', note: '刷屏' }),
    )
    const { items } = await inbox(b)
    expect(items.map((i) => i.kind)).toEqual(['post_deleted'])
    expect(items[0]).toMatchObject({ topicId: t.id, postId: r.id, floor: 2 })
    expect(items[0]?.payload).toEqual({
      reason: 'spam',
      floor: 2,
      topicTitle: expect.any(String),
    })
  })
})

describe('收件箱', () => {
  test('主题软删后 subject 变成 removed，行保留', async () => {
    const a = await signUp('楼主')
    const b = await signUp('回复者')
    const t = await makeTopic(a)
    await reply(b, t.id, '回复')
    expect((await inbox(a)).items[0]?.subject).toMatchObject({ kind: 'topic' })

    await db
      .update(schema.topic)
      .set({ deletedAt: new Date() })
      .where(eq(schema.topic.id, t.id))
    const { items, total } = await inbox(a)
    expect(total).toBe(1)
    expect(items[0]?.subject).toEqual({ kind: 'removed' })
  })

  test('按 ids 标记已读；未读数随之减少；重复标记幂等', async () => {
    const a = await signUp('楼主')
    const b = await signUp('回复者')
    const t = await makeTopic(a)
    await reply(b, t.id, '一')
    await reply(staff, t.id, '二')
    expect(await unread(a)).toBe(2)

    const { items } = await inbox(a)
    const first = items[0]?.id as string
    const res = await app.request(
      '/api/notifications/read',
      send(a, 'POST', { ids: [first] }),
    )
    expect(await res.json()).toEqual({ marked: 1 })
    expect(await unread(a)).toBe(1)

    const again = await app.request(
      '/api/notifications/read',
      send(a, 'POST', { ids: [first] }),
    )
    expect(await again.json()).toEqual({ marked: 0 })
  })

  test('全部已读走 id 游标：游标之后到的不被吞掉；别人的 id 当游标 → 404', async () => {
    const a = await signUp('楼主')
    const b = await signUp('回复者')
    const t = await makeTopic(a)
    await reply(b, t.id, '早到的')
    await reply(staff, t.id, '晚到的')
    const { items } = await inbox(a)
    // 列表按 (created_at desc, id desc)：items[1] 是早到的那条
    const older = items[1]?.id as string
    const newer = items[0]?.id as string

    const res = await app.request(
      '/api/notifications/read',
      send(a, 'POST', { upTo: older }),
    )
    expect(await res.json()).toEqual({ marked: 1 })
    expect(await unread(a)).toBe(1)

    // 别人拿我的通知 id 当游标：404，且不动我的行
    const other = await app.request(
      '/api/notifications/read',
      send(b, 'POST', { upTo: newer }),
    )
    expect(other.status).toBe(404)
    expect(await unread(a)).toBe(1)

    const rest = await app.request(
      '/api/notifications/read',
      send(a, 'POST', { upTo: newer }),
    )
    expect(await rest.json()).toEqual({ marked: 1 })
    expect(await unread(a)).toBe(0)
  })

  test('ids 与 upTo 同时给 → 400（XOR）', async () => {
    const a = await signUp('乱传参的')
    const res = await app.request(
      '/api/notifications/read',
      send(a, 'POST', {
        ids: ['00000000-0000-4000-8000-000000000000'],
        upTo: '00000000-0000-4000-8000-000000000001',
      }),
    )
    expect(res.status).toBe(400)
  })

  test('别人的通知看不到也标不了', async () => {
    const a = await signUp('楼主')
    const b = await signUp('回复者')
    const t = await makeTopic(a)
    await reply(b, t.id, '回复')
    const { items } = await inbox(a)
    const res = await app.request(
      '/api/notifications/read',
      send(b, 'POST', { ids: [items[0]?.id] }),
    )
    expect(await res.json()).toEqual({ marked: 0 })
    expect(await unread(a)).toBe(1)
  })
})

describe('notify 的 SAVEPOINT 隔离', () => {
  test('通知写入失败（收件人不存在）不连坐外层事务', async () => {
    const a = await signUp('写主题的')
    let created: string | undefined
    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(schema.topic)
        .values({
          kind: 'board',
          boardSlug: 'meta',
          title: '隔离测试',
          authorId: a.userId,
          lastPostAt: new Date(),
        })
        .returning({ id: schema.topic.id })
      created = t?.id
      trackTopic(created as string)
      const n = await notify(tx, [
        {
          userId: `no-such-user-${Date.now()}`,
          kind: 'reply',
          topicId: created,
        },
      ])
      expect(n).toBe(0)
      // 若不是 SAVEPOINT，这里会 25P02
      await tx
        .update(schema.topic)
        .set({ title: '隔离测试·改' })
        .where(eq(schema.topic.id, created as string))
    })
    const [row] = await db
      .select()
      .from(schema.topic)
      .where(eq(schema.topic.id, created as string))
    expect(row?.title).toBe('隔离测试·改')
  })
})

describe('handle 认领', () => {
  test('派生 handle 形如 u + 8 位；认领一次后锁定', async () => {
    const s = await signUp('认领的')
    expect(s.handle).toMatch(/^u[a-z0-9]{8}$/)
    const want = `reimu_${Math.random().toString(36).slice(2, 8)}`
    const res = await app.request(
      '/api/me/handle',
      send(s, 'PUT', { handle: want }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ handle: want })

    const me = await app.request('/api/me', { headers: { cookie: s.cookie } })
    const { user } = (await me.json()) as {
      user: { handle: string; handleSetAt: string | null }
    }
    expect(user.handle).toBe(want)
    expect(user.handleSetAt).not.toBeNull()

    const again = await app.request(
      '/api/me/handle',
      send(s, 'PUT', { handle: `marisa_${Date.now()}` }),
    )
    expect(again.status).toBe(409)
  })

  test('保留字 400；被占用 409', async () => {
    const s = await signUp('想当admin的')
    expect(
      (await app.request('/api/me/handle', send(s, 'PUT', { handle: 'admin' })))
        .status,
    ).toBe(400)
    const other = await signUp('先占的')
    const taken = `taken_${Math.random().toString(36).slice(2, 8)}`
    await app.request('/api/me/handle', send(other, 'PUT', { handle: taken }))
    const res = await app.request(
      '/api/me/handle',
      send(s, 'PUT', { handle: taken }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: { code: 'duplicate_slug', fields: ['handle'] },
    })
  })
})

describe('举报结案只能一次', () => {
  test('resolve 已 resolved 的举报 → 409，resolvedBy 不被覆盖', async () => {
    const owner = await signUp('被举报的')
    const r = await makeResource(owner, true)
    const reporter = await signUp('举报人')
    const created = await app.request(
      '/api/reports',
      send(reporter, 'POST', {
        targetKind: 'resource',
        targetId: r.id,
        reason: 'spam',
      }),
    )
    const { id } = (await created.json()) as { id: string }
    const first = await app.request(
      `/api/moderation/reports/${id}/resolve`,
      send(staff, 'POST', { status: 'resolved' }),
    )
    expect(first.status).toBe(200)
    const second = await app.request(
      `/api/moderation/reports/${id}/resolve`,
      send(boss, 'POST', { status: 'rejected' }),
    )
    expect(second.status).toBe(409)
    const [row] = await db
      .select()
      .from(schema.report)
      .where(eq(schema.report.id, id))
    expect(row?.status).toBe('resolved')
    expect(row?.resolvedBy).toBe(staff.userId)
  })
})

/**
 * 唯一违例的映射此前全仓三处都是死代码——drizzle 把 PostgresError 包在 cause 里，
 * SQLSTATE 在 errno 不在 code。重复举报在生产上回的是 500。这条钉住它。
 */
describe('唯一违例 → 409（不是 500）', () => {
  test('同一人对同一对象重复举报 → 409 duplicate_slug', async () => {
    const owner = await signUp('被重复举报的')
    const r = await makeResource(owner, true)
    const reporter = await signUp('执着的举报人')
    // 举报限流 15 秒冷却在唯一约束之前；staff 免限流，才碰得到 23505 那条路径
    await setRole(reporter, 'moderator')
    const body = { targetKind: 'resource', targetId: r.id, reason: 'spam' }
    expect(
      (await app.request('/api/reports', send(reporter, 'POST', body))).status,
    ).toBe(201)
    const dup = await app.request('/api/reports', send(reporter, 'POST', body))
    expect(dup.status).toBe(409)
    expect(await dup.json()).toEqual({ error: { code: 'duplicate_slug' } })
  })
})

describe('对抗验证补的回归', () => {
  test('资源主题的第一条评论（floor 1）通知投稿者', async () => {
    const u = await signUp('投稿者')
    const r = await makeResource(u, true)
    const detail = await app.request(`/api/kourindou/resources/${r.slug}`)
    const { topicId } = (await detail.json()) as { topicId: string }
    const c1 = await signUp('第一个评论的')
    const p = await reply(c1, topicId, '第一条评论')
    expect(p.floor).toBe(1)
    const { items } = await inbox(u)
    expect(items.map((i) => i.kind)).toEqual(['reply'])
    expect(items[0]?.floor).toBe(1)
    expect(items[0]?.subject?.kind).toBe('resource')
  })

  test('派生 handle 暴露过（发过帖 / 被 @ 过）就不能再认领', async () => {
    const poster = await signUp('发过帖的')
    await makeTopic(poster)
    const res = await app.request(
      '/api/me/handle',
      send(poster, 'PUT', { handle: `late_${Date.now()}` }),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', fields: ['handle'] },
    })

    const mentioned = await signUp('被@过的')
    const a = await signUp('楼主')
    const t = await makeTopic(a)
    await reply(staff, t.id, `@${mentioned.handle} 你好`)
    const res2 = await app.request(
      '/api/me/handle',
      send(mentioned, 'PUT', { handle: `late2_${Date.now()}` }),
    )
    expect(res2.status).toBe(403)
  })

  test('staff 经 /status 走 pending→draft 被挡：拒稿只有 /review 一扇门', async () => {
    const u = await signUp('待审的')
    const r = await makeResource(u, false)
    const res = await app.request(
      `/api/kourindou/resources/${r.id}/status`,
      send(staff, 'POST', { to: 'draft', reason: '绕过审核的退稿' }),
    )
    expect(res.status).toBe(409)
    expect((await inbox(u)).total).toBe(0)
  })

  test('资源被 purge 后，评论区里 staff 删楼的 post_deleted 仍然存在（外键 SET NULL）', async () => {
    const u = await signUp('投稿者')
    const r = await makeResource(u, true)
    const detail = await app.request(`/api/kourindou/resources/${r.slug}`)
    const { topicId } = (await detail.json()) as { topicId: string }
    const spammer = await signUp('发广告的')
    const p = await reply(spammer, topicId, '广告')
    await app.request(
      `/api/shrine/posts/${p.id}`,
      send(staff, 'DELETE', { reason: 'spam' }),
    )
    expect((await inbox(spammer)).items.map((i) => i.kind)).toEqual([
      'post_deleted',
    ])

    await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'purge', reason: '整个撤掉' }),
    )
    const { items } = await inbox(spammer)
    expect(items.map((i) => i.kind)).toEqual(['post_deleted'])
    expect(items[0]?.topicId).toBeNull()
    expect(items[0]?.postId).toBeNull()
    // 外键置空后 join 不到，floor 退回写入时的快照
    expect(items[0]?.floor).toBe(1)
    expect(items[0]?.subject).toBeNull()
  })

  test('staff 软删整条主题 → 作者收到 post_deleted（floor 1）', async () => {
    const a = await signUp('主题被删的')
    const t = await makeTopic(a)
    await reply(staff, t.id, '让作者删不掉')
    const res = await app.request(
      `/api/shrine/topics/${t.id}`,
      send(staff, 'DELETE', { reason: 'spam' }),
    )
    expect(res.status).toBe(200)
    const { items } = await inbox(a)
    const del = items.find((i) => i.kind === 'post_deleted')
    expect(del).toMatchObject({
      topicId: t.id,
      postId: t.postId,
      floor: 1,
      subject: { kind: 'removed' },
    })
  })

  test('治理类通知不暴露执行的版主；回复/@ 照常带 actor', async () => {
    const a = await signUp('楼主')
    const b = await signUp('回复者')
    const t = await makeTopic(a)
    const p = await reply(b, t.id, '回复')
    expect((await inbox(a)).items[0]?.actor).toMatchObject({ id: b.userId })

    await app.request(
      `/api/shrine/posts/${p.id}`,
      send(staff, 'DELETE', { reason: 'spam' }),
    )
    const del = (await inbox(b)).items.find((i) => i.kind === 'post_deleted')
    expect(del?.actor).toBeNull()
  })

  test('整批里一行违例只丢那一行：其余通知照常写入', async () => {
    const a = await signUp('楼主')
    let topicId = ''
    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(schema.topic)
        .values({
          kind: 'board',
          boardSlug: 'meta',
          title: '逐行重试',
          authorId: a.userId,
          lastPostAt: new Date(),
        })
        .returning({ id: schema.topic.id })
      topicId = trackTopic(t?.id as string)
      const n = await notify(tx, [
        { userId: a.userId, kind: 'reply', topicId, actorId: staff.userId },
        {
          userId: `ghost-${Date.now()}`,
          kind: 'mention',
          topicId,
          actorId: staff.userId,
        },
      ])
      expect(n).toBe(1)
    })
    expect((await inbox(a)).items.map((i) => i.kind)).toEqual(['reply'])
  })
})
