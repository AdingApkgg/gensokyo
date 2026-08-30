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

/** 资源的讨论主题 id——楼层读写都要它 */
async function topicOf(slug: string): Promise<string> {
  const res = await app.request(`/api/kourindou/resources/${slug}`)
  const { topicId } = (await res.json()) as { topicId: string | null }
  return topicId as string
}

/** 楼层端点 */
const postsOf = (topicId: string) => `/api/shrine/topics/${topicId}/posts`

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
  trackResource(resource)
  return { ...resource, topicId: await topicOf(resource.slug) }
}

let owner: Session
let commenter: Session
/** 需要连续写入的用例用它——staff 短路限流，而那些用例验的是别的不变量 */
let bulk: Session
let target: { id: string; slug: string; topicId: string }

beforeAll(async () => {
  owner = await signUp('资源作者')
  commenter = await signUp('评论者')
  bulk = await signUp('连发用')
  await app.request('/api/me', { headers: { cookie: bulk.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role: 'moderator' })
    .where(eq(schema.userProfile.userId, bulk.userId))
  target = await publishedResource(owner)
})

describe('评论即楼层', () => {
  test('未登录不能发', async () => {
    const res = await app.request(postsOf(target.topicId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bodyMd: '匿名发言' }),
    })
    expect(res.status).toBe(401)
  })

  test('楼层号从 1 开始且连续', async () => {
    const r = await publishedResource(await signUp('作者E'))
    for (const body of ['一楼', '二楼', '三楼']) {
      const res = await app.request(
        postsOf(r.topicId),
        send(bulk, 'POST', { bodyMd: body }),
      )
      expect(res.status).toBe(201)
    }
    const list = await app.request(postsOf(r.topicId))
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
          postsOf(r.topicId),
          send(bulk, 'POST', { bodyMd: `并发 ${i}` }),
        ),
      ),
    )
    const list = await app.request(postsOf(r.topicId))
    const { posts } = (await list.json()) as { posts: { floor: number }[] }
    const floors = posts.map((p) => p.floor)
    expect(floors).toHaveLength(8)
    expect(new Set(floors).size).toBe(8) // 无重复
    expect(floors).toEqual([1, 2, 3, 4, 5, 6, 7, 8]) // 无空洞
  })

  test('回复不存在的楼层被拒', async () => {
    const res = await app.request(
      postsOf(target.topicId),
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

    // 草稿的详情作者自己看得到，但它不给 topicId——评论区不对外开放
    const detail = await app.request(
      `/api/kourindou/resources/${resource.slug}`,
      {
        headers: { cookie: drafter.cookie },
      },
    )
    const { topicId } = (await detail.json()) as { topicId: string | null }
    expect(topicId).toBeNull()

    // 就算从库里翻出主题 id，闸门也照样挡住
    const [t] = await db
      .select({ id: schema.topic.id })
      .from(schema.topic)
      .where(eq(schema.topic.resourceId, resource.id))
    const res = await app.request(postsOf(t?.id as string))
    expect(res.status).toBe(404)
  })
})

describe('删除楼层', () => {
  test('陌生人删不了别人的楼', async () => {
    const r = await publishedResource(await signUp('作者G'))
    const created = await app.request(
      postsOf(r.topicId),
      send(commenter, 'POST', { bodyMd: '我的发言' }),
    )
    const { id } = (await created.json()) as { id: string }

    const other = await signUp('路人乙')
    const res = await app.request(
      `/api/shrine/posts/${id}`,
      send(other, 'DELETE'),
    )
    expect(res.status).toBe(403)
  })

  test('软删保留楼层占位，不打断楼层号', async () => {
    const r = await publishedResource(await signUp('作者H'))
    const ids: string[] = []
    for (const body of ['一楼', '二楼', '三楼']) {
      const res = await app.request(
        postsOf(r.topicId),
        send(bulk, 'POST', { bodyMd: body }),
      )
      const { id } = (await res.json()) as { id: string }
      ids.push(id)
    }

    await app.request(`/api/shrine/posts/${ids[1]}`, send(bulk, 'DELETE'))

    const list = await app.request(postsOf(r.topicId))
    const { posts } = (await list.json()) as {
      posts: { floor: number; deleted: boolean; bodyMd: string }[]
    }
    expect(posts.map((p) => p.floor)).toEqual([1, 2, 3])
    expect(posts[1]?.deleted).toBe(true)
    expect(posts[1]?.bodyMd).toBe('')
    expect(posts[2]?.bodyMd).toBe('三楼')
  })
})

/**
 * P0-5 回归。
 *
 * 修之前：publishedTopic() 把关的是 resource，而它调用的 topicForResource()
 * **什么都不把关**——只按 resourceId 取行，topic.deletedAt 不在 WHERE 里。
 * 于是一条被软删的资源主题，GET 仍完整列出全部楼层，POST 才 404。
 * M3 侥幸没出事的真实原因是 M3 没有任何路径会软删 topic；
 * M4 第一次给出这个能力，这条路径当天就活。
 *
 * 修之后 topicForResource() 已删除，读写都过 loadVisibleTopic()。
 */
describe('可见性闸门（P0-5 回归）', () => {
  test('主题被软删后，资源页不再列出楼层', async () => {
    const r = await publishedResource(owner)
    await app.request(
      postsOf(r.topicId),
      send(commenter, 'POST', { bodyMd: '删之前的一楼' }),
    )

    await db
      .update(schema.topic)
      .set({ deletedAt: new Date() })
      .where(eq(schema.topic.resourceId, r.id))

    const res = await app.request(postsOf(r.topicId))
    expect(res.status).toBe(404)
  })

  test('主题被软删后也发不出新楼层', async () => {
    const r = await publishedResource(owner)
    await db
      .update(schema.topic)
      .set({ deletedAt: new Date() })
      .where(eq(schema.topic.resourceId, r.id))

    const res = await app.request(
      postsOf(r.topicId),
      send(commenter, 'POST', { bodyMd: '不该发得出去' }),
    )
    expect(res.status).toBe(404)
  })
})

// ============================================================ T4 新增

/** 版块主题：发主题会同事务建 1 楼 */
async function makeTopic(s: Session, body = '主题正文') {
  const res = await app.request(
    '/api/shrine/topics',
    send(s, 'POST', {
      boardSlug: 'meta',
      title: `测试主题 ${Math.random().toString(36).slice(2, 7)}`,
      bodyMd: body,
    }),
  )
  const b = (await res.json()) as { id?: string; postId?: string }
  if (b.id) trackTopic(b.id)
  return { status: res.status, ...b }
}

describe('发主题', () => {
  test('主题与 1 楼同事务创建——不会产生没有主楼的主题', async () => {
    const t = await makeTopic(await signUp('建主题的'))
    expect(t.status).toBe(201)

    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts, total } = (await list.json()) as {
      posts: { floor: number; bodyMd: string }[]
      total: number
    }
    expect(posts).toHaveLength(1)
    expect(posts[0]?.floor).toBe(1)
    expect(total).toBe(1)
  })

  test('版块 slug 不在六值内被拒', async () => {
    const res = await app.request(
      '/api/shrine/topics',
      send(await signUp('slug测试'), 'POST', {
        boardSlug: 'shrine',
        title: 'x',
        bodyMd: 'y',
      }),
    )
    expect(res.status).toBe(400)
  })

  test('未登录发不了', async () => {
    const res = await app.request('/api/shrine/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardSlug: 'meta', title: 'x', bodyMd: 'y' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('编辑楼层：只有本人', () => {
  /**
   * 计划点名的那条。staff 可以「删」他人的东西（留痕、可申诉），
   * 但不能「改」他人的话——改完没有痕迹说明原文是什么，作者无从申诉。
   */
  test('moderator 编辑他人楼层 → 403', async () => {
    const author = await signUp('被改的人')
    const t = await makeTopic(author)
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }
    const pid = posts[0]?.id as string

    const mod = await signUp('版主')
    await app.request('/api/me', { headers: { cookie: mod.cookie } })
    await db
      .update(schema.userProfile)
      .set({ role: 'moderator' })
      .where(eq(schema.userProfile.userId, mod.userId))

    const res = await app.request(
      `/api/shrine/posts/${pid}`,
      send(mod, 'PATCH', { bodyMd: '被版主改写的内容' }),
    )
    expect(res.status).toBe(403)
  })

  test('作者本人改得动', async () => {
    const author = await signUp('自改的人')
    const t = await makeTopic(author, '改之前')
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }

    const res = await app.request(
      `/api/shrine/posts/${posts[0]?.id}`,
      send(author, 'PATCH', { bodyMd: '改之后' }),
    )
    expect(res.status).toBe(200)

    const after = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const b = (await after.json()) as { posts: { bodyMd: string }[] }
    expect(b.posts[0]?.bodyMd).toBe('改之后')
  })
})

describe('删主题', () => {
  /**
   * X4：资源主题的 authorId 就是投稿者，而「无他人回复」在零评论时恒成立。
   * 删掉之后没有任何路径能恢复——动机不是误操作是审查规避。
   */
  test('资源主题一律 409，投稿者也删不掉自己资源的评论区', async () => {
    const r = await publishedResource(owner)
    const res = await app.request(
      `/api/shrine/topics/${r.topicId}`,
      send(owner, 'DELETE'),
    )
    expect(res.status).toBe(409)
  })

  test('版块主题：作者在无他人回复时可删', async () => {
    const author = await signUp('自删主题')
    const t = await makeTopic(author)
    const res = await app.request(
      `/api/shrine/topics/${t.id}`,
      send(author, 'DELETE'),
    )
    expect(res.status).toBe(200)
    expect((await app.request(`/api/shrine/topics/${t.id}`)).status).toBe(404)
  })

  test('有他人回复之后作者删不掉', async () => {
    const author = await signUp('删不掉的')
    const t = await makeTopic(author)
    await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(bulk, 'POST', { bodyMd: '别人的回复' }),
    )
    const res = await app.request(
      `/api/shrine/topics/${t.id}`,
      send(author, 'DELETE'),
    )
    expect(res.status).toBe(403)
  })
})

describe('主题列表', () => {
  test('replyCount 数的是未删楼层，不是 floorSeq', async () => {
    const t = await makeTopic(await signUp('计数用'))
    const ids: string[] = []
    for (const b of ['回复一', '回复二', '回复三']) {
      const r = await app.request(
        `/api/shrine/topics/${t.id}/posts`,
        send(bulk, 'POST', { bodyMd: b }),
      )
      ids.push(((await r.json()) as { id: string }).id)
    }
    // 删掉一条：floorSeq 仍是 4，但可见回复应是 2
    await app.request(
      `/api/shrine/posts/${ids[0]}`,
      send(bulk, 'DELETE', { reason: 'spam' }),
    )

    const res = await app.request('/api/shrine/topics?board=meta&pageSize=100')
    const { items } = (await res.json()) as {
      items: { id: string; replyCount: number }[]
    }
    const row = items.find((i) => i.id === t.id)
    expect(row?.replyCount).toBe(2)
  })

  test('资源主题原样返回三语束，不在服务端选语言', async () => {
    const res = await app.request('/api/shrine/topics?pageSize=100')
    const { items } = (await res.json()) as {
      items: {
        kind: string
        title: string | null
        resource: { titleOriginal: string; title: unknown } | null
      }[]
    }
    const r = items.find((i) => i.kind === 'resource')
    expect(r?.title).toBeNull()
    expect(typeof r?.resource?.titleOriginal).toBe('string')
    expect(r?.resource).toHaveProperty('title')
  })
})

describe('限流（rate_limited 从空悬码变成真的）', () => {
  test('连续发帖撞冷却窗 → 429', async () => {
    const t = await makeTopic(await signUp('连发的人'))
    const spammer = await signUp('刷屏的')

    const first = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(spammer, 'POST', { bodyMd: '第一条' }),
    )
    expect(first.status).toBe(201)

    const second = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(spammer, 'POST', { bodyMd: '紧接着第二条' }),
    )
    expect(second.status).toBe(429)
    expect((await second.json()) as unknown).toEqual({
      error: { code: 'rate_limited' },
    })
  })

  test('staff 不受限流约束——站长要能连发六篇引导帖', async () => {
    const t = await makeTopic(await signUp('给staff发的'))
    for (const b of ['引导一', '引导二']) {
      const res = await app.request(
        `/api/shrine/topics/${t.id}/posts`,
        send(bulk, 'POST', { bodyMd: b }),
      )
      expect(res.status).toBe(201)
    }
  })

  test('编辑不受发帖限流约束——发完立刻改错别字应该改得动', async () => {
    const author = await signUp('改错别字的')
    const t = await makeTopic(author, '有错别子')
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }

    const res = await app.request(
      `/api/shrine/posts/${posts[0]?.id}`,
      send(author, 'PATCH', { bodyMd: '有错别字' }),
    )
    expect(res.status).toBe(200)
  })
})

describe('外链禁令与 @ 上限', () => {
  test('新账号发不了站外链接', async () => {
    const t = await makeTopic(await signUp('给外链的'))
    const rookie = await signUp('新人')
    const res = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(rookie, 'POST', { bodyMd: '看这个 https://example.com/spam' }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'link_not_allowed' },
    })
  })

  test('staff 短路——否则站长发不出自己写的引导帖', async () => {
    const t = await makeTopic(await signUp('给staff外链的'))
    const res = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(bulk, 'POST', { bodyMd: '规则见 https://example.com/rules' }),
    )
    expect(res.status).toBe(201)
  })

  test('@ 超过 10 人被拒，不是静默截断', async () => {
    const t = await makeTopic(await signUp('给提及的'))
    const many = Array.from({ length: 12 }, (_, i) => `@user${i}`).join(' ')
    const res = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(bulk, 'POST', { bodyMd: many }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'mention_limit_exceeded' },
    })
  })
})

describe('staff 删楼：留痕 + 计入信任梯度', () => {
  /**
   * 四份设计文档都没发现这条链是断的：
   * 论坛灌水被删 20 层的账号，在香霖堂仍然「即发即审」。
   */
  test('按 spam 删他人楼层 → 写审计 + strikeCount +1', async () => {
    const author = await signUp('灌水的')
    const t = await makeTopic(author, '灌水内容')
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }
    const pid = posts[0]?.id as string

    const before = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, author.userId))

    const res = await app.request(
      `/api/shrine/posts/${pid}`,
      send(bulk, 'DELETE', { reason: 'spam', note: '重复刷屏' }),
    )
    expect(res.status).toBe(200)

    const after = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, author.userId))
    expect(after[0]?.strikeCount).toBe((before[0]?.strikeCount ?? 0) + 1)

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, pid))
    const entry = logs.find((l) => l.action === 'soft_delete')
    expect(entry?.subjectKind).toBe('post')
    expect(entry?.reason).toBe('重复刷屏')
  })

  test('按 wrong_info 删不记违规——只有那四类才算', async () => {
    const author = await signUp('信息有误的')
    const t = await makeTopic(author, '内容有误')
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }

    await app.request(
      `/api/shrine/posts/${posts[0]?.id}`,
      send(bulk, 'DELETE', { reason: 'wrong_info' }),
    )
    const after = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, author.userId))
    expect(after[0]?.strikeCount).toBe(0)
  })

  test('staff 删他人楼层不给理由 → 400', async () => {
    const author = await signUp('无理由删')
    const t = await makeTopic(author)
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }

    const res = await app.request(
      `/api/shrine/posts/${posts[0]?.id}`,
      send(bulk, 'DELETE', {}),
    )
    expect(res.status).toBe(400)
  })

  test('作者删自己的不需要理由', async () => {
    const author = await signUp('自删楼的')
    const t = await makeTopic(author)
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }

    const res = await app.request(
      `/api/shrine/posts/${posts[0]?.id}`,
      send(author, 'DELETE'),
    )
    expect(res.status).toBe(200)
  })
})

/**
 * 以下每一条都对应 T4 对抗验证里的一个真实缺陷。
 * 命名按「被挡住的故障」写，不按「被测的函数」写——半年后回来看的是前者。
 */
describe('对抗验证补的回归', () => {
  test('gfm 自动链接的 www. 也算站外链接——上一版正则一个字都不管', async () => {
    const t = await makeTopic(await signUp('给www的'))
    const rookie = await signUp('发www的新人')
    const res = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(rookie, 'POST', { bodyMd: '好货在 www.evil.example/spam 快来' }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'link_not_allowed' },
    })
  })

  test('协议相对链接 //host 同样拦下', async () => {
    const t = await makeTopic(await signUp('给协议相对的'))
    const rookie = await signUp('发//的新人')
    const res = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(rookie, 'POST', { bodyMd: '[广告](//evil.example/spam)' }),
    )
    expect(res.status).toBe(403)
  })

  test('代码块里的 URL 不算发外链——走 AST 之后误伤自动消失', async () => {
    const t = await makeTopic(await signUp('给代码块的'))
    const rookie = await signUp('贴代码的新人')
    const res = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(rookie, 'POST', { bodyMd: '```\ncurl https://example.com\n```' }),
    )
    expect(res.status).toBe(201)
  })

  test('标题也过外链闸——它是全站曝光最高的字段', async () => {
    const rookie = await signUp('标题塞广告的')
    const res = await app.request(
      '/api/shrine/topics',
      send(rookie, 'POST', {
        boardSlug: 'meta',
        title: 'https://evil.example/promo 全场五折',
        bodyMd: '正文很干净',
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'link_not_allowed' },
    })
  })

  test('标题也过 @ 上限', async () => {
    const res = await app.request(
      '/api/shrine/topics',
      send(bulk, 'POST', {
        boardSlug: 'meta',
        title: Array.from({ length: 12 }, (_, i) => `@user${i}`).join(' '),
        bodyMd: '正文很干净',
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'mention_limit_exceeded' },
    })
  })

  test('429 带 Retry-After——「等 15 秒」和「等一小时」不该是同一句话', async () => {
    const t = await makeTopic(await signUp('给RetryAfter的'))
    const spammer = await signUp('连点的')
    await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(spammer, 'POST', { bodyMd: '第一条' }),
    )
    const second = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(spammer, 'POST', { bodyMd: '第二条' }),
    )
    expect(second.status).toBe(429)
    expect(second.headers.get('Retry-After')).toBe('15')
  })

  test('重复删同一楼层是幂等的——strikeCount 不会被删三次记三次', async () => {
    const author = await signUp('被删三次的')
    const t = await makeTopic(author, '广告内容')
    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }
    const pid = posts[0]?.id as string

    for (let i = 0; i < 3; i++) {
      const res = await app.request(
        `/api/shrine/posts/${pid}`,
        send(bulk, 'DELETE', { reason: 'spam' }),
      )
      expect(res.status).toBe(200)
    }

    const after = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, author.userId))
    expect(after[0]?.strikeCount).toBe(1)

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, pid))
    expect(logs.filter((l) => l.action === 'soft_delete')).toHaveLength(1)
  })

  test('资源下架后 staff 仍能处置它评论区的楼层——治理闸不是可见性闸', async () => {
    const r = await publishedResource(await signUp('会被下架的'))
    const author = await signUp('下架区发言的')
    const created = await app.request(
      postsOf(r.topicId),
      send(author, 'POST', { bodyMd: '要被处置的发言' }),
    )
    const { id: pid } = (await created.json()) as { id: string }

    // 版权举报的标准第一动作：下架资源
    await db
      .update(schema.resource)
      .set({ status: 'delisted' })
      .where(eq(schema.resource.id, r.id))

    // 普通读者从此看不见（可见性闸照常生效）
    const read = await app.request(`/api/shrine/topics/${r.topicId}`)
    expect(read.status).toBe(404)

    // 但 staff 删得掉，且违规记得上
    const res = await app.request(
      `/api/shrine/posts/${pid}`,
      send(bulk, 'DELETE', { reason: 'copyright' }),
    )
    expect(res.status).toBe(200)
    const after = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, author.userId))
    expect(after[0]?.strikeCount).toBe(1)
  })

  test('1 楼被删后 replyCount 不变——不能在已排除软删的计数上再减 1', async () => {
    const t = await makeTopic(await signUp('删主楼的'))
    for (const b of ['回复一', '回复二']) {
      await app.request(
        `/api/shrine/topics/${t.id}/posts`,
        send(bulk, 'POST', { bodyMd: b }),
      )
    }
    const before = await app.request(
      '/api/shrine/topics?board=meta&pageSize=100',
    )
    const rowBefore = (
      (await before.json()) as { items: { id: string; replyCount: number }[] }
    ).items.find((i) => i.id === t.id)
    expect(rowBefore?.replyCount).toBe(2)

    const list = await app.request(`/api/shrine/topics/${t.id}/posts`)
    const { posts } = (await list.json()) as { posts: { id: string }[] }
    await app.request(
      `/api/shrine/posts/${posts[0]?.id}`,
      send(bulk, 'DELETE', { reason: 'wrong_info' }),
    )

    const after = await app.request(
      '/api/shrine/topics?board=meta&pageSize=100',
    )
    const rowAfter = (
      (await after.json()) as { items: { id: string; replyCount: number }[] }
    ).items.find((i) => i.id === t.id)
    expect(rowAfter?.replyCount).toBe(2)
  })

  test('staff 删他人主题要给理由并留痕——删两百层不该比删一层更随意', async () => {
    const author = await signUp('主题被删的')
    const t = await makeTopic(author)
    await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(bulk, 'POST', { bodyMd: '别人的回复，作者从此删不掉' }),
    )

    const noReason = await app.request(
      `/api/shrine/topics/${t.id}`,
      send(bulk, 'DELETE', {}),
    )
    expect(noReason.status).toBe(400)

    const res = await app.request(
      `/api/shrine/topics/${t.id}`,
      send(bulk, 'DELETE', { reason: 'spam', note: '整贴都是广告' }),
    )
    expect(res.status).toBe(200)

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, t.id as string))
    const entry = logs.find((l) => l.action === 'soft_delete')
    expect(entry?.subjectKind).toBe('topic')
    expect(entry?.reason).toBe('整贴都是广告')
  })

  test('删掉最后一条回复要回退 lastPostAt——被删的广告不该继续顶着主题', async () => {
    const t = await makeTopic(await signUp('lastPostAt的'))
    const created = await app.request(
      `/api/shrine/topics/${t.id}/posts`,
      send(bulk, 'POST', { bodyMd: '把主题顶上去的广告' }),
    )
    const { id: pid } = (await created.json()) as { id: string }

    const [bumped] = await db
      .select()
      .from(schema.topic)
      .where(eq(schema.topic.id, t.id as string))

    await app.request(
      `/api/shrine/posts/${pid}`,
      send(bulk, 'DELETE', { reason: 'spam' }),
    )

    const [rolled] = await db
      .select()
      .from(schema.topic)
      .where(eq(schema.topic.id, t.id as string))
    expect(rolled?.lastPostAt.getTime()).toBeLessThan(
      bumped?.lastPostAt.getTime() as number,
    )
  })
})
