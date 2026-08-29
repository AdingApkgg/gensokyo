import { db, schema } from '@gensokyo/db'
import { createReportSchema, rateSchema } from '@gensokyo/shared'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { fail } from '../errors'
import { requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'

const { resource, rating, favorite, report } = schema

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
    zValidator('json', rateSchema),
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
    zValidator('json', createReportSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const input = c.req.valid('json')

      if (input.targetKind === 'resource') {
        const [row] = await db
          .select({ uploaderId: resource.uploaderId })
          .from(resource)
          .where(eq(resource.id, input.targetId))
          .limit(1)
        if (!row) return fail(c, 'not_found', 404)
        if (row.uploaderId === actor.id)
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
