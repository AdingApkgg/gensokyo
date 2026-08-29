import { beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { app } from './app'

type Session = { cookie: string; userId: string }

async function signUp(name: string): Promise<Session> {
  const email = `ix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  return {
    cookie: res.headers.get('set-cookie') ?? '',
    userId: body.user?.id as string,
  }
}

const send = (s: Session, method: string, body?: unknown) => ({
  method,
  headers: { cookie: s.cookie, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

/** 造一个已发布、带一个版本一个下载链接的资源 */
async function publishedResource(owner: Session) {
  await app.request('/api/me', { headers: { cookie: owner.cookie } })
  await db
    .update(schema.userProfile)
    .set({ approvedResourceCount: 5 })
    .where(eq(schema.userProfile.userId, owner.userId))

  const created = await app.request(
    '/api/kourindou/resources',
    send(owner, 'POST', {
      titleOriginal: '東方妖々夢',
      titleOriginalLocale: 'ja',
      kind: 'game',
      license: 'allowed',
    }),
  )
  const { resource } = (await created.json()) as {
    resource: { id: string; slug: string }
  }

  const ver = await app.request(
    `/api/kourindou/resources/${resource.id}/versions`,
    send(owner, 'POST', {
      label: 'v1.00a',
      files: [
        {
          label: '本体',
          url: 'https://pan.example.com/s/abc',
          mirrorKind: 'netdisk',
          extractCode: 'th07',
        },
      ],
    }),
  )
  const { files } = (await ver.json()) as { files: { id: string }[] }

  await app.request(`/api/kourindou/resources/${resource.id}/submit`, {
    method: 'POST',
    headers: { cookie: owner.cookie },
  })

  return { ...resource, fileId: files[0]?.id as string }
}

let owner: Session
let visitor: Session
let target: Awaited<ReturnType<typeof publishedResource>>

beforeAll(async () => {
  owner = await signUp('作者')
  visitor = await signUp('访客')
  target = await publishedResource(owner)
})

describe('下载', () => {
  test('302 跳到外链并累加计数', async () => {
    const before = await db
      .select({ n: schema.resource.downloadCount })
      .from(schema.resource)
      .where(eq(schema.resource.id, target.id))

    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/files/${target.fileId}/download`,
      { headers: { cookie: visitor.cookie }, redirect: 'manual' },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://pan.example.com/s/abc')

    const after = await db
      .select({ n: schema.resource.downloadCount })
      .from(schema.resource)
      .where(eq(schema.resource.id, target.id))
    expect(after[0]?.n).toBe((before[0]?.n ?? 0) + 1)

    const logs = await db
      .select()
      .from(schema.downloadLog)
      .where(eq(schema.downloadLog.resourceId, target.id))
    expect(logs.length).toBeGreaterThan(0)
  })

  test('未发布资源的文件下载不到（安全底线）', async () => {
    const draftOwner = await signUp('草稿作者')
    const created = await app.request(
      '/api/kourindou/resources',
      send(draftOwner, 'POST', {
        titleOriginal: '未发布',
        titleOriginalLocale: 'zh',
        kind: 'tool',
        license: 'unspecified',
      }),
    )
    const { resource } = (await created.json()) as {
      resource: { id: string; slug: string }
    }
    const ver = await app.request(
      `/api/kourindou/resources/${resource.id}/versions`,
      send(draftOwner, 'POST', {
        label: 'v1',
        files: [
          { label: 'x', url: 'https://example.com/x', mirrorKind: 'direct' },
        ],
      }),
    )
    const { files } = (await ver.json()) as { files: { id: string }[] }

    // 连作者本人也下不到——下载走的是发布状态，不是所有权
    const res = await app.request(
      `/api/kourindou/resources/${resource.slug}/files/${files[0]?.id}/download`,
      { headers: { cookie: draftOwner.cookie }, redirect: 'manual' },
    )
    expect(res.status).toBe(404)
  })

  test('拿别的资源的 fileId 也下不到（防越权拼接）', async () => {
    const other = await publishedResource(await signUp('另一个作者'))
    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/files/${other.fileId}/download`,
      { redirect: 'manual' },
    )
    expect(res.status).toBe(404)
  })
})

describe('评分', () => {
  test('自己不能给自己评分', async () => {
    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/rating`,
      send(owner, 'PUT', { score: 5 }),
    )
    expect(res.status).toBe(403)
  })

  test('首次评分累加计数与总分', async () => {
    const rater = await signUp('评分者')
    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/rating`,
      send(rater, 'PUT', { score: 4 }),
    )
    expect(res.status).toBe(200)

    const [row] = await db
      .select({
        sum: schema.resource.ratingSum,
        count: schema.resource.ratingCount,
      })
      .from(schema.resource)
      .where(eq(schema.resource.id, target.id))
    expect(row?.count).toBe(1)
    expect(row?.sum).toBe(4)
  })

  test('改分只调整差额，不重复计数', async () => {
    const rater = await signUp('改分者')
    await app.request(
      `/api/kourindou/resources/${target.slug}/rating`,
      send(rater, 'PUT', { score: 2 }),
    )
    const [mid] = await db
      .select({
        sum: schema.resource.ratingSum,
        count: schema.resource.ratingCount,
      })
      .from(schema.resource)
      .where(eq(schema.resource.id, target.id))

    await app.request(
      `/api/kourindou/resources/${target.slug}/rating`,
      send(rater, 'PUT', { score: 5 }),
    )
    const [after] = await db
      .select({
        sum: schema.resource.ratingSum,
        count: schema.resource.ratingCount,
      })
      .from(schema.resource)
      .where(eq(schema.resource.id, target.id))

    expect(after?.count).toBe(mid?.count as number) // 计数不变
    expect(after?.sum).toBe((mid?.sum as number) + 3) // 只加差额
  })

  test('分数越界被拒', async () => {
    const rater = await signUp('乱评的')
    const res = await app.request(
      `/api/kourindou/resources/${target.slug}/rating`,
      send(rater, 'PUT', { score: 9 }),
    )
    expect(res.status).toBe(400)
  })
})

describe('收藏', () => {
  test('收藏与取消是幂等的', async () => {
    const url = `/api/kourindou/resources/${target.slug}/favorite`
    expect((await app.request(url, send(visitor, 'PUT'))).status).toBe(200)
    expect((await app.request(url, send(visitor, 'PUT'))).status).toBe(200)

    const rows = await db
      .select()
      .from(schema.favorite)
      .where(eq(schema.favorite.userId, visitor.userId))
    expect(rows).toHaveLength(1)

    expect((await app.request(url, send(visitor, 'DELETE'))).status).toBe(200)
    expect((await app.request(url, send(visitor, 'DELETE'))).status).toBe(200)
  })
})

describe('举报', () => {
  test('不能举报自己的资源', async () => {
    const res = await app.request(
      '/api/kourindou/reports',
      send(owner, 'POST', {
        targetKind: 'resource',
        targetId: target.id,
        reason: 'copyright',
      }),
    )
    expect(res.status).toBe(403)
  })

  test('他人可以举报', async () => {
    const res = await app.request(
      '/api/kourindou/reports',
      send(visitor, 'POST', {
        targetKind: 'resource',
        targetId: target.id,
        reason: 'broken_link',
        detail: '网盘链接失效了',
      }),
    )
    expect(res.status).toBe(201)
  })

  test('未登录不能举报', async () => {
    const res = await app.request('/api/kourindou/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'resource',
        targetId: target.id,
        reason: 'other',
      }),
    })
    expect(res.status).toBe(401)
  })
})
