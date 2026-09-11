import { afterAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { app } from './app'
import { cleanupTracked, trackResource, trackUser } from './testing'

/**
 * sitemap 的数据源。它是**匿名可读**的，所以这组用例钉住的只有一条：
 * 凡是 /kourindou/:slug 会 404 的东西，都不许出现在这里——sitemap 是
 * 一份对外公开的 URL 清单，草稿混进去就是把未发布资源的存在告诉全世界。
 */

type Session = { cookie: string; userId: string }

async function signUp(name: string): Promise<Session> {
  const email = `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

async function makeTrusted(s: Session) {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ approvedResourceCount: 5, strikeCount: 0 })
    .where(eq(schema.userProfile.userId, s.userId))
}

async function createResource(s: Session, title: string) {
  const res = await app.request('/api/kourindou/resources', {
    method: 'POST',
    headers: { cookie: s.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      titleOriginal: title,
      titleOriginalLocale: 'ja',
      kind: 'game',
      license: 'allowed',
    }),
  })
  const body = (await res.json()) as { resource?: { id: string; slug: string } }
  if (body.resource) trackResource(body.resource)
  return body.resource as { id: string; slug: string }
}

const fetchSitemap = async () => {
  const res = await app.request('/api/sitemap')
  return {
    status: res.status,
    body: (await res.json()) as {
      resources: { slug: string }[]
      topics: { id: string }[]
    },
  }
}

describe('GET /api/sitemap', () => {
  test('匿名可读', async () => {
    expect((await fetchSitemap()).status).toBe(200)
  })

  test('已发布的资源在清单里，草稿不在', async () => {
    const author = await signUp('地图作者')
    await makeTrusted(author)
    const draft = await createResource(author, '未提交的东西')
    const live = await createResource(author, '已发布的东西')
    await app.request(`/api/kourindou/resources/${live.id}/submit`, {
      method: 'POST',
      headers: { cookie: author.cookie },
    })

    const { body } = await fetchSitemap()
    const slugs = body.resources.map((r) => r.slug)
    expect(slugs).toContain(live.slug)
    expect(slugs).not.toContain(draft.slug)
  })

  /**
   * 资源主题**不单独出现**：它的网址就是 /kourindou/:slug#discussion，
   * 再给它发一条 /shrine/t/:id 就是同一份内容的两个条目。
   */
  test('资源自带的讨论主题不单独成条', async () => {
    const author = await signUp('地图作者2')
    await makeTrusted(author)
    const live = await createResource(author, '带讨论区的东西')
    await app.request(`/api/kourindou/resources/${live.id}/submit`, {
      method: 'POST',
      headers: { cookie: author.cookie },
    })

    const [topicRow] = await db
      .select({ id: schema.topic.id })
      .from(schema.topic)
      .where(eq(schema.topic.resourceId, live.id))
      .limit(1)

    const { body } = await fetchSitemap()
    expect(body.topics.map((t) => t.id)).not.toContain(topicRow?.id)
  })

  test('软删的版块主题不在清单里', async () => {
    const author = await signUp('发帖人')
    const res = await app.request('/api/shrine/topics', {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        boardSlug: 'tea-house',
        title: '会被删掉的帖',
        bodyMd: '正文',
      }),
    })
    const created = (await res.json()) as { id?: string }
    const id = created.id
    if (!id) throw new Error('建主题失败，后面的断言都没有意义')

    const before = await fetchSitemap()
    expect(before.body.topics.map((t) => t.id)).toContain(id)

    await db
      .update(schema.topic)
      .set({ deletedAt: new Date() })
      .where(eq(schema.topic.id, id))

    const after = await fetchSitemap()
    expect(after.body.topics.map((t) => t.id)).not.toContain(id)
  })
})
