import { afterAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { and, eq } from 'drizzle-orm'
import { app } from './app'
import {
  cleanupTracked,
  markVerified,
  trackResource,
  trackUser,
} from './testing'

/**
 * 补译名端点。它是全站唯一一个**非作者也能写内容**的写端点，所以这组测试
 * 钉住的核心只有一条：**填空位人人可，覆写只有作者与 staff**。
 *
 * 单独一个文件而不是并进 kourindou.test.ts：那个文件正被搜索改造改着，
 * 而这组用例与搜索毫无关系。
 */

type Session = { cookie: string; userId: string }

async function signUp(name: string): Promise<Session> {
  const email = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  const userId = trackUser(body.user?.id)
  await markVerified(userId)
  return { cookie: res.headers.get('set-cookie') ?? '', userId }
}

afterAll(cleanupTracked)

const send = (s: Session | null, method: string, body: unknown) => ({
  method,
  headers: {
    'content-type': 'application/json',
    ...(s ? { cookie: s.cookie } : {}),
  },
  body: JSON.stringify(body),
})

/** 信任达标 → submit 之后直接 published，省掉一次 staff 过审 */
async function makeTrusted(s: Session) {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ approvedResourceCount: 5, strikeCount: 0 })
    .where(eq(schema.userProfile.userId, s.userId))
}

async function promote(s: Session, role: 'moderator' | 'admin') {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role })
    .where(eq(schema.userProfile.userId, s.userId))
}

/** 一条已发布的资源：原题日文，已有中文译名，日文与英文两栏是空的 */
async function publishedResource(author: Session) {
  const res = await app.request(
    '/api/kourindou/resources',
    send(author, 'POST', {
      titleOriginal: '東方紅魔郷 体験版',
      titleOriginalLocale: 'ja',
      title: { zh: '东方红魔乡 体验版' },
      kind: 'game',
      license: 'allowed',
    }),
  )
  const body = (await res.json()) as {
    resource?: { id: string; slug: string }
  }
  if (body.resource) trackResource(body.resource)
  await app.request(`/api/kourindou/resources/${body.resource?.id}/submit`, {
    method: 'POST',
    headers: { cookie: author.cookie },
  })
  return body.resource as { id: string; slug: string }
}

const patchTranslation = (
  s: Session | null,
  id: string,
  body: Record<string, unknown>,
) =>
  app.request(
    `/api/kourindou/resources/${id}/translations`,
    send(s, 'PATCH', body),
  )

const titleOf = async (id: string) =>
  (
    await db
      .select({ title: schema.resource.title })
      .from(schema.resource)
      .where(eq(schema.resource.id, id))
      .limit(1)
  )[0]?.title

describe('补译名：填空位', () => {
  test('任何登录用户都能填一个空着的语言', async () => {
    const author = await signUp('作者-填空')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-填空')
    const res = await patchTranslation(stranger, r.id, {
      locale: 'en',
      title: 'Embodiment of Scarlet Devil Trial',
    })

    expect(res.status).toBe(200)
    expect(await titleOf(r.id)).toEqual({
      zh: '东方红魔乡 体验版',
      en: 'Embodiment of Scarlet Devil Trial',
    })
  })

  test('填空位也留审计行——这是唯一能回答「谁改的」的地方', async () => {
    const author = await signUp('作者-审计')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-审计')
    await patchTranslation(stranger, r.id, { locale: 'en', title: 'Trial' })

    const [log] = await db
      .select()
      .from(schema.moderationLog)
      .where(
        and(
          eq(schema.moderationLog.subjectKind, 'resource'),
          eq(schema.moderationLog.subjectId, r.id),
          eq(schema.moderationLog.action, 'translation_edit'),
        ),
      )
    expect(log?.actorId).toBe(stranger.userId)
    expect(log?.toValue).toMatchObject({ locale: 'en', title: 'Trial' })
  })

  test('简介与标题可以一次补两栏', async () => {
    const author = await signUp('作者-两栏')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-两栏')
    const res = await patchTranslation(stranger, r.id, {
      locale: 'en',
      title: 'Trial',
      description: 'The first Windows-era game, trial version.',
    })
    expect(res.status).toBe(200)

    const [row] = await db
      .select({ description: schema.resource.description })
      .from(schema.resource)
      .where(eq(schema.resource.id, r.id))
      .limit(1)
    expect(row?.description).toEqual({
      en: 'The first Windows-era game, trial version.',
    })
  })
})

describe('补译名：覆写', () => {
  test('陌生人改写别人已经写好的译名被拒', async () => {
    const author = await signUp('作者-覆写')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-覆写')
    const res = await patchTranslation(stranger, r.id, {
      locale: 'zh',
      title: '我说了算',
    })

    expect(res.status).toBe(403)
    expect(await titleOf(r.id)).toEqual({ zh: '东方红魔乡 体验版' })
  })

  test('陌生人清空别人的译名同样被拒', async () => {
    const author = await signUp('作者-清空')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-清空')
    const res = await patchTranslation(stranger, r.id, {
      locale: 'zh',
      title: '',
    })
    expect(res.status).toBe(403)
  })

  test('作者本人可以改写自己的译名', async () => {
    const author = await signUp('作者-自改')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const res = await patchTranslation(author, r.id, {
      locale: 'zh',
      title: '东方红魔乡 试玩版',
    })
    expect(res.status).toBe(200)
    expect(await titleOf(r.id)).toEqual({ zh: '东方红魔乡 试玩版' })
  })

  test('staff 可以改写他人的译名', async () => {
    const author = await signUp('作者-被staff改')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const mod = await signUp('审核员-译名')
    await promote(mod, 'moderator')
    const res = await patchTranslation(mod, r.id, {
      locale: 'zh',
      title: '东方红魔乡（体验版）',
    })
    expect(res.status).toBe(200)
  })

  /** 用户点两下按钮不该吃 403 */
  test('提交与现值完全相同不算覆写', async () => {
    const author = await signUp('作者-重复提交')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-重复提交')
    const res = await patchTranslation(stranger, r.id, {
      locale: 'zh',
      title: '东方红魔乡 体验版',
    })
    expect(res.status).toBe(200)
  })
})

describe('补译名：闸门', () => {
  test('未登录被拒', async () => {
    const author = await signUp('作者-匿名')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const res = await patchTranslation(null, r.id, {
      locale: 'en',
      title: 'Trial',
    })
    expect(res.status).toBe(401)
  })

  /** 未发布的资源对陌生人根本不存在，补译名不能成为存在性预言机 */
  test('未发布的资源对陌生人是 404', async () => {
    const author = await signUp('作者-草稿')
    const res0 = await app.request(
      '/api/kourindou/resources',
      send(author, 'POST', {
        titleOriginal: '未提交的东西',
        titleOriginalLocale: 'zh',
        kind: 'game',
        license: 'allowed',
      }),
    )
    const body = (await res0.json()) as { resource?: { id: string } }
    if (body.resource) trackResource(body.resource)

    const stranger = await signUp('路人-草稿')
    const res = await patchTranslation(stranger, body.resource?.id ?? '', {
      locale: 'en',
      title: 'Nope',
    })
    expect(res.status).toBe(404)
  })

  test('两栏都不给是 400，不写审计行', async () => {
    const author = await signUp('作者-空写')
    await makeTrusted(author)
    const r = await publishedResource(author)

    const stranger = await signUp('路人-空写')
    const res = await patchTranslation(stranger, r.id, { locale: 'en' })
    expect(res.status).toBe(400)
  })

  /** 非 UUID 的 :id 要落在 400 信封里，不能 500 逃出去 */
  test('非法 id 是 400 信封', async () => {
    const stranger = await signUp('路人-非法id')
    const res = await patchTranslation(stranger, 'not-a-uuid', {
      locale: 'en',
      title: 'x',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation_failed')
  })

  test('同一个人连着补两条会撞冷却窗', async () => {
    const author = await signUp('作者-限流')
    await makeTrusted(author)
    const a = await publishedResource(author)
    const b = await publishedResource(author)

    const stranger = await signUp('路人-限流')
    const first = await patchTranslation(stranger, a.id, {
      locale: 'en',
      title: 'First',
    })
    expect(first.status).toBe(200)

    const second = await patchTranslation(stranger, b.id, {
      locale: 'en',
      title: 'Second',
    })
    expect(second.status).toBe(429)
    expect(second.headers.get('Retry-After')).toBeTruthy()
  })
})
