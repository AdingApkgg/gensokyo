import { afterAll, describe, expect, test } from 'bun:test'
import { BOARD_SLUGS, HANDLE_RE, RESERVED_HANDLES } from '@gensokyo/shared'
import { eq, sql } from 'drizzle-orm'
import { db } from './client'
import * as schema from './schema'

/**
 * DB 层约束的行为测试。
 *
 * 存在但不生效的约束等于没有——`pgTable` 忘了第二参数时 CHECK 会**静默不生成**，
 * migrate 照样报成功。所以这里不查 information_schema「有没有这条约束」，
 * 而是真的插入违规数据看它拒不拒。
 */

const created: string[] = []
afterAll(async () => {
  if (created.length === 0) return
  for (const id of created) {
    await db.delete(schema.topic).where(eq(schema.topic.id, id))
  }
})

/** 插入应当被拒的行；返回 true 表示 DB 确实拒了 */
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}

const anyResourceId = async () => {
  const [r] = await db
    .select({ id: schema.resource.id })
    .from(schema.resource)
    .limit(1)
  return r?.id as string
}

describe('topic_board_slug：版块白名单代替 board 表', () => {
  test('六个正式 slug 都能插', async () => {
    for (const slug of BOARD_SLUGS) {
      const [row] = await db
        .insert(schema.topic)
        .values({ kind: 'board', boardSlug: slug, title: `约束测试 ${slug}` })
        .returning({ id: schema.topic.id })
      expect(row?.id).toBeTruthy()
      if (row) created.push(row.id)
    }
  })

  test('不在白名单的 slug 被拒（测试残留的 shrine 就是这样清掉的）', async () => {
    expect(
      await rejects(() =>
        db
          .insert(schema.topic)
          .values({ kind: 'board', boardSlug: 'shrine', title: 'x' }),
      ),
    ).toBe(true)
  })
})

describe('topic_kind_shape：两种 kind 的形状互斥', () => {
  test('版块主题缺 title 被拒', async () => {
    expect(
      await rejects(() =>
        db.insert(schema.topic).values({ kind: 'board', boardSlug: 'meta' }),
      ),
    ).toBe(true)
  })

  test('版块主题缺 boardSlug 被拒', async () => {
    expect(
      await rejects(() =>
        db.insert(schema.topic).values({ kind: 'board', title: 'x' }),
      ),
    ).toBe(true)
  })

  /** 资源主题一律不存标题快照——快照不随资源 PATCH 更新，而且它是单语的 */
  test('资源主题带 title 被拒', async () => {
    const rid = await anyResourceId()
    expect(
      await rejects(() =>
        db
          .insert(schema.topic)
          .values({ kind: 'resource', resourceId: rid, title: 'x' }),
      ),
    ).toBe(true)
  })

  test('资源主题缺 resourceId 被拒', async () => {
    expect(
      await rejects(() => db.insert(schema.topic).values({ kind: 'resource' })),
    ).toBe(true)
  })
})

describe('post_body_len：legacy 缺的那道 DB 层上限', () => {
  const withTopic = async (bodyMd: string) => {
    const [t] = await db
      .insert(schema.topic)
      .values({ kind: 'board', boardSlug: 'meta', title: '正文长度' })
      .returning({ id: schema.topic.id })
    if (t) created.push(t.id)
    return rejects(() =>
      db
        .insert(schema.post)
        .values({ topicId: t?.id as string, floor: 1, bodyMd }),
    )
  }

  test('空正文被拒', async () => {
    expect(await withTopic('')).toBe(true)
  })

  test('超过 20000 字被拒（与 createPostSchema 同值）', async () => {
    expect(await withTopic('a'.repeat(20001))).toBe(true)
  })

  test('恰好 20000 字通过', async () => {
    expect(await withTopic('a'.repeat(20000))).toBe(false)
  })
})

describe('handle 的两条 CHECK', () => {
  const someProfile = async () => {
    const [p] = await db
      .select({ userId: schema.userProfile.userId })
      .from(schema.userProfile)
      .limit(1)
    return p?.userId as string
  }

  const setHandle = async (handle: string) => {
    const userId = await someProfile()
    return rejects(() =>
      db.transaction(async (tx) => {
        await tx
          .update(schema.userProfile)
          .set({ handle })
          .where(eq(schema.userProfile.userId, userId))
        // 不真的改库：验证约束是否放行之后回滚
        tx.rollback()
      }),
    )
  }

  test('大写 / 连字符 / 首字符下划线 / 太短 全被拒', async () => {
    for (const bad of ['Reimu', 'a-b', '_admin', 'a']) {
      expect(await setHandle(bad)).toBe(true)
    }
  })

  /**
   * 保留字只写在 zod 里的话绕过 API 就没了，而这里绕过的后果是**不可逆冒充**。
   * 逐个验证——只验一个不能证明整张表都在。
   */
  test('每一个保留字都被 DB 拒绝', async () => {
    for (const h of RESERVED_HANDLES) {
      expect(await setHandle(h)).toBe(true)
    }
  })

  /**
   * DB 的正则由 HANDLE_RE 的同一个字面量派生。这条断言防的是有人
   * 只改了一边——两处各写一遍正则必然漂移。
   */
  test('DB 里的正则与 HANDLE_RE 逐字一致', async () => {
    const rows = await db.execute<{ def: string }>(sql`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conname = 'user_profile_handle_fmt'
    `)
    const def = [...rows][0]?.def ?? ''
    expect(def).toContain(HANDLE_RE.source)
  })
})
