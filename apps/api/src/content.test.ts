import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { app } from './app'
import { cleanupTracked, trackResource, trackUser } from './test-support'

type Session = { cookie: string; userId: string }

async function signUp(name: string): Promise<Session> {
  const email = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

async function publishedResource(owner: Session) {
  await app.request('/api/me', { headers: { cookie: owner.cookie } })
  await db
    .update(schema.userProfile)
    .set({ approvedResourceCount: 5 })
    .where(eq(schema.userProfile.userId, owner.userId))

  const created = await app.request(
    '/api/kourindou/resources',
    send(owner, 'POST', {
      titleOriginal: '評論用リソース',
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

let owner: Session
let commenter: Session
let target: { id: string; slug: string }

beforeAll(async () => {
  owner = await signUp('资源作者')
  commenter = await signUp('评论者')
  target = await publishedResource(owner)
})

describe('评论即楼层', () => {
  test('未登录不能发', async () => {
    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/posts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: '匿名发言' }),
      },
    )
    expect(res.status).toBe(401)
  })

  test('楼层号从 1 开始且连续', async () => {
    const r = await publishedResource(await signUp('作者E'))
    for (const body of ['一楼', '二楼', '三楼']) {
      const res = await app.request(
        `/api/kourindou/resources/${r.slug}/posts`,
        send(commenter, 'POST', { bodyMd: body }),
      )
      expect(res.status).toBe(201)
    }
    const list = await app.request(`/api/kourindou/resources/${r.slug}/posts`)
    const { posts } = (await list.json()) as {
      posts: { floor: number; bodyMd: string }[]
    }
    expect(posts.map((p) => p.floor)).toEqual([1, 2, 3])
    expect(posts[0]?.bodyMd).toBe('一楼')
  })

  test('并发发帖不会撞楼层号', async () => {
    const r = await publishedResource(await signUp('作者F'))
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        app.request(
          `/api/kourindou/resources/${r.slug}/posts`,
          send(commenter, 'POST', { bodyMd: `并发 ${i}` }),
        ),
      ),
    )
    const list = await app.request(
      `/api/kourindou/resources/${r.slug}/posts?pageSize=50`,
    )
    const { posts } = (await list.json()) as { posts: { floor: number }[] }
    const floors = posts.map((p) => p.floor)
    expect(floors).toHaveLength(8)
    expect(new Set(floors).size).toBe(8) // 无重复
    expect(floors).toEqual([1, 2, 3, 4, 5, 6, 7, 8]) // 无空洞
  })

  test('回复不存在的楼层被拒', async () => {
    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/posts`,
      send(commenter, 'POST', {
        bodyMd: '回复幽灵',
        parentId: '00000000-0000-4000-8000-000000000000',
      }),
    )
    expect(res.status).toBe(400)
  })

  test('未发布资源没有评论区', async () => {
    const drafter = await signUp('草稿作者')
    const created = await app.request(
      '/api/kourindou/resources',
      send(drafter, 'POST', {
        titleOriginal: '草稿',
        titleOriginalLocale: 'zh',
        kind: 'tool',
        license: 'unspecified',
      }),
    )
    const { resource } = (await created.json()) as {
      resource: { id: string; slug: string }
    }
    trackResource(resource)
    const res = await app.request(
      `/api/kourindou/resources/${resource.slug}/posts`,
    )
    expect(res.status).toBe(404)
  })
})

describe('删除楼层', () => {
  test('陌生人删不了别人的楼', async () => {
    const r = await publishedResource(await signUp('作者G'))
    const created = await app.request(
      `/api/kourindou/resources/${r.slug}/posts`,
      send(commenter, 'POST', { bodyMd: '我的发言' }),
    )
    const { id } = (await created.json()) as { id: string }

    const other = await signUp('路人乙')
    const res = await app.request(
      `/api/kourindou/posts/${id}`,
      send(other, 'DELETE'),
    )
    expect(res.status).toBe(403)
  })

  test('软删保留楼层占位，不打断楼层号', async () => {
    const r = await publishedResource(await signUp('作者H'))
    const ids: string[] = []
    for (const body of ['一楼', '二楼', '三楼']) {
      const res = await app.request(
        `/api/kourindou/resources/${r.slug}/posts`,
        send(commenter, 'POST', { bodyMd: body }),
      )
      const { id } = (await res.json()) as { id: string }
      ids.push(id)
    }

    await app.request(
      `/api/kourindou/posts/${ids[1]}`,
      send(commenter, 'DELETE'),
    )

    const list = await app.request(`/api/kourindou/resources/${r.slug}/posts`)
    const { posts } = (await list.json()) as {
      posts: { floor: number; deleted: boolean; bodyMd: string }[]
    }
    expect(posts.map((p) => p.floor)).toEqual([1, 2, 3])
    expect(posts[1]?.deleted).toBe(true)
    expect(posts[1]?.bodyMd).toBe('')
    expect(posts[2]?.bodyMd).toBe('三楼')
  })
})
