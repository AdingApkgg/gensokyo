import { db, schema } from '@gensokyo/db'
import { createReportSchema, rateSchema } from '@gensokyo/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, validate } from '../errors'
import { requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'

const { resource, rating, favorite, report, post } = schema

/** targetId 是多态的，进 uuid 列之前先自己挡一道，避免 22P02 */
const uuidLike = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** 只有已发布的资源能被互动 */
async function publishedResource(slug: string) {
  const [row] = await db
    .select({ id: resource.id, uploaderId: resource.uploaderId })
    .from(resource)
    .where(
      and(
        eq(resource.slug, slug),
        eq(resource.status, 'published'),
        isNull(resource.deletedAt),
      ),
    )
    .limit(1)
  return row
}

export const interactions = new Hono<AppEnv>()
  .put(
    '/resources/:slug/rating',
    requireAuth,
    validate('json', rateSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const row = await publishedResource(c.req.param('slug'))
      if (!row) return fail(c, 'not_found', 404)
      if (row.uploaderId === actor.id)
        return fail(c, 'self_action_forbidden', 403)

      const { score } = c.req.valid('json')

      await db.transaction(async (tx) => {
        const [prev] = await tx
          .select({ score: rating.score })
          .from(rating)
          .where(
            and(eq(rating.resourceId, row.id), eq(rating.userId, actor.id)),
          )
          .limit(1)

        await tx
          .insert(rating)
          .values({ resourceId: row.id, userId: actor.id, score })
          .onConflictDoUpdate({
            target: [rating.resourceId, rating.userId],
            set: { score },
          })

        // 改分只调整差额，首评才 +1 计数；全用 SQL 表达式，并发安全
        await tx
          .update(resource)
          .set({
            ratingSum: sql`${resource.ratingSum} + ${score - (prev?.score ?? 0)}`,
            ratingCount: prev
              ? sql`${resource.ratingCount}`
              : sql`${resource.ratingCount} + 1`,
          })
          .where(eq(resource.id, row.id))
      })

      return c.json({ score })
    },
  )

  .put('/resources/:slug/favorite', requireAuth, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const row = await publishedResource(c.req.param('slug'))
    if (!row) return fail(c, 'not_found', 404)

    await db
      .insert(favorite)
      .values({ resourceId: row.id, userId: actor.id })
      .onConflictDoNothing()
    return c.json({ favorited: true })
  })

  .delete('/resources/:slug/favorite', requireAuth, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const row = await publishedResource(c.req.param('slug'))
    if (!row) return fail(c, 'not_found', 404)

    await db
      .delete(favorite)
      .where(
        and(eq(favorite.resourceId, row.id), eq(favorite.userId, actor.id)),
      )
    return c.json({ favorited: false })
  })

  .post(
    '/reports',
    requireAuth,
    validate('json', createReportSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const input = c.req.valid('json')

      /**
       * 举报是版权下架的入口通道，两个分支都要设防：
       * 不过滤状态的话，对任意 uuid 举报的成败就成了「该资源是否存在」的
       * 预言机——包括别人的私有草稿。post 分支此前完全没有校验。
       */
      if (input.targetKind === 'resource') {
        if (!uuidLike(input.targetId)) return fail(c, 'not_found', 404)
        const [row] = await db
          .select({ uploaderId: resource.uploaderId })
          .from(resource)
          .where(
            and(
              eq(resource.id, input.targetId),
              eq(resource.status, 'published'),
              isNull(resource.deletedAt),
            ),
          )
          .limit(1)
        if (!row) return fail(c, 'not_found', 404)
        if (row.uploaderId === actor.id)
          return fail(c, 'self_action_forbidden', 403)
      } else {
        if (!uuidLike(input.targetId)) return fail(c, 'not_found', 404)
        const [row] = await db
          .select({ authorId: post.authorId })
          .from(post)
          .where(and(eq(post.id, input.targetId), isNull(post.deletedAt)))
          .limit(1)
        if (!row) return fail(c, 'not_found', 404)
        if (row.authorId === actor.id)
          return fail(c, 'self_action_forbidden', 403)
      }

      const [created] = await db
        .insert(report)
        .values({
          targetKind: input.targetKind,
          targetId: input.targetId,
          reporterId: actor.id,
          reason: input.reason,
          detail: input.detail,
        })
        .returning({ id: report.id })

      return c.json({ id: created?.id }, 201)
    },
  )
