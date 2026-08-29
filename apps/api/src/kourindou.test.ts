import { beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { app } from './app'

type Session = { cookie: string; userId: string }

async function signUp(name: string): Promise<Session> {
  const email = `kr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

const json = (s: Session, body: unknown) => ({
  method: 'POST',
  headers: { cookie: s.cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const NEW_RESOURCE = {
  titleOriginal: '東方紅魔郷 体験版',
  titleOriginalLocale: 'ja',
  title: { zh: '东方红魔乡 体验版' },
  kind: 'game',
  license: 'allowed',
  tagIds: ['th06'],
}

async function createResource(s: Session, overrides = {}) {
  const res = await app.request(
    '/api/kourindou/resources',
    json(s, { ...NEW_RESOURCE, ...overrides }),
  )
  const body = (await res.json()) as {
    resource?: { id: string; slug: string; status: string }
  }
  return { status: res.status, ...body }
}

/** 把账号提权到 staff */
async function promote(s: Session, role: 'moderator' | 'admin') {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role })
    .where(eq(schema.userProfile.userId, s.userId))
}

/** 让账号达到即发即审门槛 */
async function makeTrusted(s: Session) {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ approvedResourceCount: 5, strikeCount: 0 })
    .where(eq(schema.userProfile.userId, s.userId))
}

let author: Session
let stranger: Session
let staff: Session

beforeAll(async () => {
  author = await signUp('投稿者')
  stranger = await signUp('路人')
  staff = await signUp('审核员')
  await promote(staff, 'moderator')
})

describe('创建资源', () => {
  test('未登录被拒', async () => {
    const res = await app.request('/api/kourindou/resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(NEW_RESOURCE),
    })
    expect(res.status).toBe(401)
  })

  test('新建为 draft，并自动挂上讨论主题', async () => {
    const { status, resource } = await createResource(author)
    expect(status).toBe(201)
    expect(resource?.status).toBe('draft')

    const topics = await db
      .select()
      .from(schema.topic)
      .where(eq(schema.topic.resourceId, resource?.id as string))
    expect(topics).toHaveLength(1)
    expect(topics[0]?.kind).toBe('resource')
  })

  test('许可状态缺失被 zod 拒绝', async () => {
    const { license: _l, ...withoutLicense } = NEW_RESOURCE
    const res = await app.request(
      '/api/kourindou/resources',
      json(author, withoutLicense),
    )
    expect(res.status).toBe(400)
  })

  test('slug 从 CJK 标题也能生成且不重复', async () => {
    const a = await createResource(author)
    const b = await createResource(author)
    expect(a.resource?.slug).toBeTruthy()
    expect(a.resource?.slug).not.toBe(b.resource?.slug)
  })
})

describe('可见性', () => {
  test('draft 不出现在公开列表里', async () => {
    const { resource } = await createResource(author)
    const res = await app.request('/api/kourindou/resources?pageSize=100')
    const body = (await res.json()) as { items: { id: string }[] }
    expect(body.items.some((i) => i.id === resource?.id)).toBe(false)
  })

  test('draft 详情：作者可见，陌生人 404', async () => {
    const { resource } = await createResource(author)
    const mine = await app.request(
      `/api/kourindou/resources/${resource?.slug}`,
      { headers: { cookie: author.cookie } },
    )
    expect(mine.status).toBe(200)

    const theirs = await app.request(
      `/api/kourindou/resources/${resource?.slug}`,
      { headers: { cookie: stranger.cookie } },
    )
    expect(theirs.status).toBe(404)

    const anon = await app.request(`/api/kourindou/resources/${resource?.slug}`)
    expect(anon.status).toBe(404)
  })
})

describe('编辑权限', () => {
  test('陌生人改不了别人的资源', async () => {
    const { resource } = await createResource(author)
    const res = await app.request(`/api/kourindou/resources/${resource?.id}`, {
      method: 'PATCH',
      headers: { cookie: stranger.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ titleOriginal: '被篡改' }),
    })
    expect(res.status).toBe(403)
  })

  test('作者本人可以改', async () => {
    const { resource } = await createResource(author)
    const res = await app.request(`/api/kourindou/resources/${resource?.id}`, {
      method: 'PATCH',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ titleOriginal: '改过的标题' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('投稿与信任梯度', () => {
  test('新账号投稿进审核队列', async () => {
    const rookie = await signUp('新人')
    const { resource } = await createResource(rookie)
    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/submit`,
      { method: 'POST', headers: { cookie: rookie.cookie } },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'pending',
      autoPublished: false,
    })
  })

  test('信任达标的账号即发即审', async () => {
    const veteran = await signUp('老手')
    await makeTrusted(veteran)
    const { resource } = await createResource(veteran)
    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/submit`,
      { method: 'POST', headers: { cookie: veteran.cookie } },
    )
    expect(await res.json()).toEqual({
      status: 'published',
      autoPublished: true,
    })
  })

  test('有违规记录的账号即使数量达标也不放行', async () => {
    const striked = await signUp('有前科的')
    await makeTrusted(striked)
    await db
      .update(schema.userProfile)
      .set({ strikeCount: 1 })
      .where(eq(schema.userProfile.userId, striked.userId))

    const { resource } = await createResource(striked)
    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/submit`,
      { method: 'POST', headers: { cookie: striked.cookie } },
    )
    expect(await res.json()).toEqual({
      status: 'pending',
      autoPublished: false,
    })
  })
})

describe('状态流转', () => {
  test('普通用户下不了架', async () => {
    const veteran = await signUp('作者2')
    await makeTrusted(veteran)
    const { resource } = await createResource(veteran)
    await app.request(`/api/kourindou/resources/${resource?.id}/submit`, {
      method: 'POST',
      headers: { cookie: veteran.cookie },
    })

    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/status`,
      json(veteran, { to: 'delisted' }),
    )
    expect(res.status).toBe(409)
  })

  test('staff 下架后从公开列表消失，并留下审计', async () => {
    const veteran = await signUp('作者3')
    await makeTrusted(veteran)
    const { resource } = await createResource(veteran)
    await app.request(`/api/kourindou/resources/${resource?.id}/submit`, {
      method: 'POST',
      headers: { cookie: veteran.cookie },
    })

    const listed = await app.request('/api/kourindou/resources?pageSize=100')
    const before = (await listed.json()) as { items: { id: string }[] }
    expect(before.items.some((i) => i.id === resource?.id)).toBe(true)

    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/status`,
      json(staff, { to: 'delisted', reason: '社团要求下架' }),
    )
    expect(res.status).toBe(200)

    const after = await app.request('/api/kourindou/resources?pageSize=100')
    const body = (await after.json()) as { items: { id: string }[] }
    expect(body.items.some((i) => i.id === resource?.id)).toBe(false)

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, resource?.id as string))
    expect(logs).toHaveLength(1)
    expect(logs[0]?.action).toBe('status_change')
    expect(logs[0]?.reason).toBe('社团要求下架')
  })

  test('非法跃迁被拒（draft 直接下架）', async () => {
    const { resource } = await createResource(author)
    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/status`,
      json(staff, { to: 'delisted' }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: { code: 'invalid_state_transition' },
    })
  })
})

describe('许可状态变更', () => {
  test('必须给理由', async () => {
    const { resource } = await createResource(author)
    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/license`,
      {
        method: 'PATCH',
        headers: { cookie: author.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ license: 'out_of_print' }),
      },
    )
    expect(res.status).toBe(400)
  })

  test('变更留痕（版权争议的证据链）', async () => {
    const { resource } = await createResource(author)
    const res = await app.request(
      `/api/kourindou/resources/${resource?.id}/license`,
      {
        method: 'PATCH',
        headers: { cookie: author.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          license: 'out_of_print',
          reason: '社团已停止发行，确认为绝版',
        }),
      },
    )
    expect(res.status).toBe(200)

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, resource?.id as string))
    const licenseLog = logs.find((l) => l.action === 'license_change')
    expect(licenseLog?.fromValue).toEqual({ license: 'allowed', note: null })
    expect(licenseLog?.toValue).toMatchObject({ license: 'out_of_print' })
  })
})

describe('列表筛选', () => {
  test('uploaderId 用真实 better-auth id 不报 400（P0 回归点）', async () => {
    const res = await app.request(
      `/api/kourindou/resources?uploaderId=${author.userId}`,
    )
    expect(res.status).toBe(200)
  })

  test('按类型筛选', async () => {
    const res = await app.request('/api/kourindou/resources?kind=music')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { kind: string }[] }
    expect(body.items.every((i) => i.kind === 'music')).toBe(true)
  })

  test('分页参数非法被拒', async () => {
    const res = await app.request('/api/kourindou/resources?pageSize=9999')
    expect(res.status).toBe(400)
  })
})
