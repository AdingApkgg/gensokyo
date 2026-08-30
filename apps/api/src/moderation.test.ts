import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { cleanupTracked, trackResource, trackUser } from '@gensokyo/db/testing'
import { eq } from 'drizzle-orm'
import { app } from './app'

type Session = { cookie: string; userId: string }

async function signUp(name: string): Promise<Session> {
  const email = `md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  return {
    cookie: res.headers.get('set-cookie') ?? '',
    userId: trackUser(body.user?.id),
  }
}

afterAll(cleanupTracked)

const send = (s: Session, method: string, body?: unknown) => ({
  method,
  headers: { cookie: s.cookie, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

async function promote(s: Session) {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role: 'moderator' })
    .where(eq(schema.userProfile.userId, s.userId))
}

/** 造一个待审核的资源 */
async function pendingResource(owner: Session) {
  const created = await app.request(
    '/api/kourindou/resources',
    send(owner, 'POST', {
      titleOriginal: '待审核的投稿',
      titleOriginalLocale: 'zh',
      kind: 'doujinshi',
      license: 'unspecified',
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

const profileOf = async (userId: string) => {
  const [p] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, userId))
  return p
}

let staff: Session
let rookie: Session

beforeAll(async () => {
  staff = await signUp('审核员')
  await promote(staff)
  rookie = await signUp('新投稿者')
})

describe('权限', () => {
  test('普通用户看不到审核队列', async () => {
    const res = await app.request('/api/moderation/queue', {
      headers: { cookie: rookie.cookie },
    })
    expect(res.status).toBe(403)
  })

  test('未登录看不到审核队列', async () => {
    const res = await app.request('/api/moderation/queue')
    expect(res.status).toBe(401)
  })
})

describe('审核队列', () => {
  test('待审资源出现在队列里，带投稿者信任信息', async () => {
    const r = await pendingResource(rookie)
    const res = await app.request('/api/moderation/queue?pageSize=100', {
      headers: { cookie: staff.cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: { id: string; approvedResourceCount: number | null }[]
    }
    const found = body.items.find((i) => i.id === r.id)
    expect(found).toBeTruthy()
    expect(found?.approvedResourceCount).toBe(0)
  })
})

describe('审核结论', () => {
  test('通过：发布并推进投稿者的信任进度', async () => {
    const author = await signUp('作者A')
    const r = await pendingResource(author)
    const before = await profileOf(author.userId)

    const res = await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', { decision: 'approve' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'published', struck: false })

    const after = await profileOf(author.userId)
    expect(after?.approvedResourceCount).toBe(
      (before?.approvedResourceCount ?? 0) + 1,
    )
    expect(after?.strikeCount).toBe(0)
  })

  test('拒绝必须给理由', async () => {
    const author = await signUp('作者B')
    const r = await pendingResource(author)
    const res = await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', { decision: 'reject' }),
    )
    expect(res.status).toBe(400)
  })

  test('因版权拒绝会记违规——信任梯度唯一的惩罚点', async () => {
    const author = await signUp('侵权者')
    const r = await pendingResource(author)

    const res = await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', {
        decision: 'reject',
        rejectReason: 'copyright',
        note: '社团明确禁止转载',
      }),
    )
    expect(await res.json()).toEqual({ status: 'draft', struck: true })

    const after = await profileOf(author.userId)
    expect(after?.strikeCount).toBe(1)
  })

  test('因质量拒绝不记违规', async () => {
    const author = await signUp('手滑的')
    const r = await pendingResource(author)
    const res = await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', { decision: 'reject', rejectReason: 'low_quality' }),
    )
    expect(await res.json()).toEqual({ status: 'draft', struck: false })

    const after = await profileOf(author.userId)
    expect(after?.strikeCount).toBe(0)
  })

  test('记了违规之后，即使数量达标也不再即发即审', async () => {
    const author = await signUp('被罚过的')
    const r = await pendingResource(author)
    await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', { decision: 'reject', rejectReason: 'copyright' }),
    )
    // 人为把通过数拉到门槛之上，违规记录仍在
    await db
      .update(schema.userProfile)
      .set({ approvedResourceCount: 10 })
      .where(eq(schema.userProfile.userId, author.userId))

    const next = await app.request(
      '/api/kourindou/resources',
      send(author, 'POST', {
        titleOriginal: '再来一稿',
        titleOriginalLocale: 'zh',
        kind: 'tool',
        license: 'allowed',
      }),
    )
    const { resource } = (await next.json()) as { resource: { id: string } }
    trackResource(resource)
    const submitted = await app.request(
      `/api/kourindou/resources/${resource.id}/submit`,
      { method: 'POST', headers: { cookie: author.cookie } },
    )
    expect(await submitted.json()).toEqual({
      status: 'pending',
      autoPublished: false,
    })
  })

  test('审核动作全部留痕', async () => {
    const author = await signUp('作者C')
    const r = await pendingResource(author)
    await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', { decision: 'approve', note: '内容合规' }),
    )
    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, r.id))
    const review = logs.find((l) => l.action === 'review')
    expect(review?.actorId).toBe(staff.userId)
    expect(review?.reason).toBe('内容合规')
  })
})

describe('举报处理', () => {
  test('处理后关闭并留痕', async () => {
    const author = await signUp('作者D')
    const r = await pendingResource(author)
    await app.request(
      `/api/moderation/resources/${r.id}/review`,
      send(staff, 'POST', { decision: 'approve' }),
    )

    const reporter = await signUp('举报人')
    const created = await app.request(
      '/api/reports',
      send(reporter, 'POST', {
        targetKind: 'resource',
        targetId: r.id,
        reason: 'broken_link',
      }),
    )
    const { id } = (await created.json()) as { id: string }

    const res = await app.request(
      `/api/moderation/reports/${id}/resolve`,
      send(staff, 'POST', { status: 'resolved', note: '已联系投稿者更新' }),
    )
    expect(res.status).toBe(200)

    const [row] = await db
      .select()
      .from(schema.report)
      .where(eq(schema.report.id, id))
    expect(row?.status).toBe('resolved')
    expect(row?.resolvedBy).toBe(staff.userId)
  })
})

/**
 * 举报队列的 GET 此前**零测试覆盖**——只有 /queue 与 /reports/:id/resolve 有。
 * 于是「114 项全绿」与这条路由是不是 500 完全无关，而它是站点唯一的治理入口。
 */
describe('举报队列不会被一条非 uuid 的 targetId 整条打挂', () => {
  test('库里有非 uuid 的 target_id 时仍然 200', async () => {
    const mod = await signUp('看队列的版主')
    await promote(mod)
    const reporter = await signUp('乱填目标的')

    /**
     * 直接写库，不走 POST /api/reports——那条路由有 uuidLike 前置校验。
     * 要防的正是**绕过入口校验进来的行**：历史数据、seed、手工 SQL。
     * targetKind 用 user，因为 better-auth 的 user.id 本来就不是 uuid，
     * 这不是构造出来的极端值，是这张多态表的正常内容。
     */
    const [row] = await db
      .insert(schema.report)
      .values({
        targetKind: 'user',
        targetId: reporter.userId,
        reporterId: reporter.userId,
        reason: 'harassment',
      })
      .returning({ id: schema.report.id })

    try {
      const res = await app.request('/api/moderation/reports?pageSize=100', {
        headers: { cookie: mod.cookie },
      })
      expect(res.status).toBe(200)
      const { items } = (await res.json()) as { items: { id: string }[] }
      // 那一行照常出现在队列里，只是关联不上任何 post/resource
      expect(items.some((i) => i.id === row?.id)).toBe(true)
    } finally {
      if (row) {
        await db.delete(schema.report).where(eq(schema.report.id, row.id))
      }
    }
  })
})
