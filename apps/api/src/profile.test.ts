import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import {
  cleanupTracked,
  trackResource,
  trackTopic,
  trackUser,
} from '@gensokyo/db/testing'
import { eq } from 'drizzle-orm'
import { app } from './app'

type Session = { cookie: string; userId: string; handle: string }

async function signUp(name: string): Promise<Session> {
  const email = `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  const cookie = res.headers.get('set-cookie') ?? ''
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

const profile = async (handle: string) => {
  const res = await app.request(`/api/shrine/users/${handle}`)
  return {
    status: res.status,
    body: (await res.json()) as {
      user?: { handle: string }
      posts?: { id: string; floor: number; topic: { kind: string } }[]
      total?: number
    },
  }
}

let staff: Session
beforeAll(async () => {
  staff = await signUp('版主')
  await db
    .update(schema.userProfile)
    .set({ role: 'moderator' })
    .where(eq(schema.userProfile.userId, staff.userId))
})

async function publishedResource(owner: Session) {
  await db
    .update(schema.userProfile)
    .set({ approvedResourceCount: 5 })
    .where(eq(schema.userProfile.userId, owner.userId))
  const created = await app.request(
    '/api/kourindou/resources',
    send(owner, 'POST', {
      titleOriginal: '主页テスト',
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
  trackResource(resource)
  const detail = await app.request(`/api/kourindou/resources/${resource.slug}`)
  const { topicId } = (await detail.json()) as { topicId: string }
  return { ...resource, topicId }
}

describe('/u/:handle 过可见性闸门（P0-1）', () => {
  test('资源被下架后，参与者主页不再列出那条讨论；软删的楼层也不列', async () => {
    const owner = await signUp('投稿者')
    const talker = await signUp('参与讨论的')
    const r = await publishedResource(owner)
    // 一条在资源讨论区、一条在版块
    const inRes = await app.request(
      `/api/shrine/topics/${r.topicId}/posts`,
      send(talker, 'POST', { bodyMd: '在资源讨论区发言' }),
    )
    expect(inRes.status).toBe(201)
    const boardTopic = await app.request(
      '/api/shrine/topics',
      send(staff, 'POST', {
        boardSlug: 'meta',
        title: '主页测试主题',
        bodyMd: '开帖',
      }),
    )
    const { id: topicId } = (await boardTopic.json()) as { id: string }
    trackTopic(topicId)
    const inBoard = await app.request(
      `/api/shrine/topics/${topicId}/posts`,
      send(talker, 'POST', { bodyMd: '在版块发言' }),
    )
    // 限流：同一人 15 秒内第二帖会 429，这里改用直接写库绕开冷却（测的不是限流）
    let boardPostId: string
    if (inBoard.status === 201) {
      boardPostId = ((await inBoard.json()) as { id: string }).id
    } else {
      const [row] = await db
        .insert(schema.post)
        .values({
          topicId,
          authorId: talker.userId,
          floor: 2,
          bodyMd: '在版块发言',
        })
        .returning({ id: schema.post.id })
      boardPostId = row?.id as string
    }

    // 两条都可见
    let p = await profile(talker.handle)
    expect(p.status).toBe(200)
    expect(p.body.user?.handle).toBe(talker.handle)
    expect(p.body.posts?.map((x) => x.topic.kind).sort()).toEqual([
      'board',
      'resource',
    ])
    expect(p.body.total).toBe(2)

    // 版权下架：资源讨论区那条从主页消失——这就是 P0-1 要挡的枚举面
    await db
      .update(schema.resource)
      .set({ status: 'delisted' })
      .where(eq(schema.resource.id, r.id))
    p = await profile(talker.handle)
    expect(p.body.posts?.map((x) => x.topic.kind)).toEqual(['board'])
    expect(p.body.total).toBe(1)

    // 软删版块那条：主页为空
    await db
      .update(schema.post)
      .set({ deletedAt: new Date() })
      .where(eq(schema.post.id, boardPostId))
    p = await profile(talker.handle)
    expect(p.body.posts).toEqual([])
    expect(p.body.total).toBe(0)
  })

  test('不存在的 handle 404；保留字与形状不对的 handle 也是 404 而不是 400', async () => {
    expect((await profile('no_such_user_404')).status).toBe(404)
    // 保留字：URL 上不该能探测到「这个词是保留的」
    expect((await profile('admin')).status).toBe(404)
    expect((await profile('Reimu')).status).toBe(404)
    expect((await profile('a')).status).toBe(404)
  })

  test('匿名可读', async () => {
    const u = await signUp('公开的')
    const res = await app.request(`/api/shrine/users/${u.handle}`)
    expect(res.status).toBe(200)
  })
})
