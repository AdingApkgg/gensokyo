import { db, schema } from '@gensokyo/db'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

const { topic, post, user } = schema

/**
 * 楼层的读写。
 *
 * 这是整个 M3 唯一保留 service 抽象的模块——因为它设计上就有两个调用方：
 * 香霖堂的资源评论区（现在）和博丽神社的版块帖（M4）。其余模块的
 * handler 直接内联在路由里，避免单调用方的间接层。
 */

export type PostAuthor = { id: string; name: string } | null

export async function listPosts(topicId: string, page = 1, pageSize = 50) {
  const rows = await db
    .select({
      id: post.id,
      floor: post.floor,
      bodyMd: post.bodyMd,
      parentId: post.parentId,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      deletedAt: post.deletedAt,
      authorId: post.authorId,
      authorName: user.name,
    })
    .from(post)
    .leftJoin(user, eq(user.id, post.authorId))
    .where(eq(post.topicId, topicId))
    .orderBy(asc(post.floor))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return rows.map((r) => ({
    id: r.id,
    floor: r.floor,
    // 软删的楼层保留占位，否则楼层号会出现空洞、引用会断
    bodyMd: r.deletedAt ? '' : r.bodyMd,
    deleted: r.deletedAt !== null,
    parentId: r.parentId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? '' } : null,
  }))
}

export type CreatePostResult =
  | { ok: true; id: string; floor: number }
  | { ok: false; reason: 'topic_missing' | 'parent_invalid' }

export async function createPost(input: {
  topicId: string
  authorId: string
  bodyMd: string
  parentId?: string
}): Promise<CreatePostResult> {
  if (input.parentId) {
    const [parent] = await db
      .select({ id: post.id })
      .from(post)
      .where(and(eq(post.id, input.parentId), eq(post.topicId, input.topicId)))
      .limit(1)
    if (!parent) return { ok: false, reason: 'parent_invalid' }
  }

  try {
    return await db.transaction(async (tx) => {
      /**
       * 楼层号来自对 topic 行的原子自增：UPDATE 会持有行锁，
       * 并发发帖因此被串行化，不会读到同一个 postCount。
       * post_topic_floor_uq 是最后一道兜底。
       */
      const [t] = await tx
        .update(topic)
        .set({
          postCount: sql`${topic.postCount} + 1`,
          lastPostAt: new Date(),
        })
        .where(and(eq(topic.id, input.topicId), isNull(topic.deletedAt)))
        .returning({ floor: topic.postCount })

      if (!t) return { ok: false, reason: 'topic_missing' } as const

      const [created] = await tx
        .insert(post)
        .values({
          topicId: input.topicId,
          authorId: input.authorId,
          parentId: input.parentId,
          floor: t.floor,
          bodyMd: input.bodyMd,
        })
        .returning({ id: post.id, floor: post.floor })

      return { ok: true, id: created?.id as string, floor: t.floor } as const
    })
  } catch {
    return { ok: false, reason: 'topic_missing' }
  }
}

/** 软删：保留楼层占位，不打断楼层号与引用 */
export async function softDeletePost(id: string) {
  await db.update(post).set({ deletedAt: new Date() }).where(eq(post.id, id))
}

export async function findPost(id: string) {
  const [row] = await db
    .select({ id: post.id, authorId: post.authorId, topicId: post.topicId })
    .from(post)
    .where(eq(post.id, id))
    .limit(1)
  return row
}

export async function topicForResource(resourceId: string) {
  const [row] = await db
    .select({ id: topic.id })
    .from(topic)
    .where(eq(topic.resourceId, resourceId))
    .limit(1)
  return row
}
