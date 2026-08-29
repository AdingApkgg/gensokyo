import { beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client'
import { rating, resource, resourceVersion, user } from './schema'
import { post, topic } from './schema/content'

const rows = async (q: ReturnType<typeof sql>) => {
  const r = await db.execute(q)
  return (
    Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[]
}

/** drizzle 的查询构造器是 thenable 而非真 Promise，expect().rejects 不认它 */
const rejects = async (run: () => unknown) => {
  try {
    await run()
    return false
  } catch {
    return true
  }
}

const EXPECTED_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'user_profile',
  'storage_object',
  'upload_intent',
  'resource_category',
  'tag',
  'circle',
  'circle_claim',
  'resource',
  'resource_tag',
  'resource_version',
  'resource_file',
  'rating',
  'favorite',
  'download_log',
  'report',
  'takedown_request',
  'moderation_log',
  'topic',
  'post',
]

let uid: string
let rid: string

beforeAll(async () => {
  uid = `test-${Date.now()}`
  await db.insert(user).values({
    id: uid,
    name: '博丽灵梦',
    email: `${uid}@example.com`,
    emailVerified: false,
  })
  const [r] = await db
    .insert(resource)
    .values({
      slug: `test-${Date.now()}`,
      titleOriginal: '東方紅魔郷',
      titleOriginalLocale: 'ja',
      kind: 'game',
      license: 'allowed',
      uploaderId: uid,
    })
    .returning({ id: resource.id })
  rid = r?.id as string
})

describe('schema', () => {
  test('23 张表全部存在', async () => {
    const r = await rows(sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
    `)
    const names = r.map((x) => x.table_name as string)
    for (const t of EXPECTED_TABLES) expect(names).toContain(t)
  })

  test('多语 jsonb 默认空对象，原文必填', async () => {
    const r = await rows(sql`
      select title, description from resource where id = ${rid}::uuid
    `)
    expect(r[0]?.title).toEqual({})
    expect(r[0]?.description).toEqual({})
  })
})

describe('约束（legacy 缺失的那些）', () => {
  test('rating.score 超范围被数据库拒绝，不只靠 zod', async () => {
    const bad = await rejects(() =>
      db.insert(rating).values({ resourceId: rid, userId: uid, score: 9 }),
    )
    expect(bad).toBe(true)
    await db.insert(rating).values({ resourceId: rid, userId: uid, score: 5 })
  })

  test('同一用户对同一资源只能有一条评分', async () => {
    const dup = await rejects(() =>
      db.insert(rating).values({ resourceId: rid, userId: uid, score: 3 }),
    )
    expect(dup).toBe(true)
  })

  test('一个资源只能有一个 isLatest 版本', async () => {
    await db
      .insert(resourceVersion)
      .values({ resourceId: rid, label: 'v1', isLatest: 1 })
    const dup = await rejects(() =>
      db
        .insert(resourceVersion)
        .values({ resourceId: rid, label: 'v2', isLatest: 1 }),
    )
    expect(dup).toBe(true)
    // 非最新版可以有多个
    await db
      .insert(resourceVersion)
      .values({ resourceId: rid, label: 'v2', isLatest: 0 })
  })

  test('同一主题的楼层号唯一（并发发帖不会撞号）', async () => {
    const [t] = await db
      .insert(topic)
      .values({ kind: 'resource', resourceId: rid, authorId: uid })
      .returning({ id: topic.id })
    const tid = t?.id as string
    await db
      .insert(post)
      .values({ topicId: tid, authorId: uid, floor: 1, bodyMd: '一楼' })
    const dup = await rejects(() =>
      db
        .insert(post)
        .values({ topicId: tid, authorId: uid, floor: 1, bodyMd: '抢楼' }),
    )
    expect(dup).toBe(true)
  })

  test('一个资源只能挂一个主题', async () => {
    const dup = await rejects(() =>
      db.insert(topic).values({ kind: 'resource', resourceId: rid }),
    )
    expect(dup).toBe(true)
  })

  test('post.parentId 有外键，插不进孤儿回复', async () => {
    const [t] = await db
      .insert(topic)
      .values({ kind: 'board', boardSlug: 'shrine', title: 'x' })
      .returning({ id: topic.id })
    const orphan = await rejects(() =>
      db.insert(post).values({
        topicId: t?.id as string,
        floor: 1,
        bodyMd: '孤儿',
        parentId: '00000000-0000-4000-8000-000000000000',
      }),
    )
    expect(orphan).toBe(true)
  })
})

describe('删除语义', () => {
  test('删除用户不连带删除他的资源（uploaderId 是 set null）', async () => {
    const tmpId = `tmp-${Date.now()}`
    await db.insert(user).values({
      id: tmpId,
      name: '临时',
      email: `${tmpId}@example.com`,
      emailVerified: false,
    })
    const [r] = await db
      .insert(resource)
      .values({
        slug: `tmp-${Date.now()}`,
        titleOriginal: 'x',
        titleOriginalLocale: 'zh',
        kind: 'tool',
        license: 'unspecified',
        uploaderId: tmpId,
      })
      .returning({ id: resource.id })

    await db.delete(user).where(sql`${user.id} = ${tmpId}`)

    const after = await rows(
      sql`select uploader_id from resource where id = ${r?.id}::uuid`,
    )
    expect(after).toHaveLength(1)
    expect(after[0]?.uploader_id).toBeNull()
  })
})
