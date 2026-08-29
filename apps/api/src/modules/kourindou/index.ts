import { db, schema } from '@gensokyo/db'
import {
  changeLicenseSchema,
  changeStatusSchema,
  createResourceSchema,
  listResourcesQuerySchema,
  updateResourceSchema,
} from '@gensokyo/shared'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { fail } from '../../errors'
import { isOwnerOrStaff, requireAuth } from '../../middleware/require'
import { type AppEnv, canAutoPublish } from '../../middleware/session'
import { makeSlug } from './slug'
import { canTransition, submitTarget } from './status'

const { resource, resourceTag, resourceVersion, resourceFile, tag, circle } =
  schema

/** 列表只暴露 published；作者与 staff 另有入口，不在这里放宽 */
const publicOnly = and(
  eq(resource.status, 'published'),
  isNull(resource.deletedAt),
)

export const kourindou = new Hono<AppEnv>()
  // ---------------------------------------------------------------- 读
  .get(
    '/resources',
    zValidator('query', listResourcesQuerySchema),
    async (c) => {
      const q = c.req.valid('query')
      const filters = [publicOnly]
      if (q.kind) filters.push(eq(resource.kind, q.kind))
      if (q.license) filters.push(eq(resource.license, q.license))
      if (q.circleId) filters.push(eq(resource.circleId, q.circleId))
      if (q.uploaderId) filters.push(eq(resource.uploaderId, q.uploaderId))
      if (q.q) {
        filters.push(
          sql`(${resource.titleOriginal} ilike ${`%${q.q}%`} or ${resource.title}::text ilike ${`%${q.q}%`})`,
        )
      }
      if (q.tag?.length) {
        filters.push(
          sql`exists (select 1 from ${resourceTag} rt where rt.resource_id = ${resource.id} and rt.tag_id in ${q.tag})`,
        )
      }

      const order =
        q.sort === 'downloads'
          ? desc(resource.downloadCount)
          : q.sort === 'rating'
            ? desc(sql`case when ${resource.ratingCount} = 0 then 0
              else ${resource.ratingSum}::float / ${resource.ratingCount} end`)
            : desc(resource.createdAt)

      const where = and(...filters)
      const [items, [count]] = await Promise.all([
        // 列表不 select description：长文走 TOAST，列表页用不上
        db
          .select({
            id: resource.id,
            slug: resource.slug,
            titleOriginal: resource.titleOriginal,
            titleOriginalLocale: resource.titleOriginalLocale,
            title: resource.title,
            kind: resource.kind,
            license: resource.license,
            coverUrl: resource.coverUrl,
            circleId: resource.circleId,
            circleNameRaw: resource.circleNameRaw,
            downloadCount: resource.downloadCount,
            ratingSum: resource.ratingSum,
            ratingCount: resource.ratingCount,
            createdAt: resource.createdAt,
          })
          .from(resource)
          .where(where)
          .orderBy(order)
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(resource)
          .where(where),
      ])

      return c.json({
        items,
        page: q.page,
        pageSize: q.pageSize,
        total: count?.n ?? 0,
      })
    },
  )

  .get('/resources/:slug', async (c) => {
    const slug = c.req.param('slug')
    const actor = c.get('actor')

    const [row] = await db
      .select()
      .from(resource)
      .where(and(eq(resource.slug, slug), isNull(resource.deletedAt)))
      .limit(1)

    if (!row) return fail(c, 'not_found', 404)
    // 未发布的资源只有作者和 staff 看得见
    if (
      row.status !== 'published' &&
      !(actor && isOwnerOrStaff(actor, row.uploaderId))
    ) {
      return fail(c, 'not_found', 404)
    }

    const [versions, tags, circleRow] = await Promise.all([
      db
        .select()
        .from(resourceVersion)
        .where(eq(resourceVersion.resourceId, row.id))
        .orderBy(desc(resourceVersion.createdAt)),
      db
        .select({
          id: tag.id,
          kind: tag.kind,
          name: tag.name,
          nameOriginal: tag.nameOriginal,
        })
        .from(resourceTag)
        .innerJoin(tag, eq(tag.id, resourceTag.tagId))
        .where(eq(resourceTag.resourceId, row.id)),
      row.circleId
        ? db.select().from(circle).where(eq(circle.id, row.circleId)).limit(1)
        : Promise.resolve([]),
    ])

    const files = versions.length
      ? await db
          .select()
          .from(resourceFile)
          .where(
            inArray(
              resourceFile.versionId,
              versions.map((v) => v.id),
            ),
          )
          .orderBy(resourceFile.sortOrder)
      : []

    return c.json({
      resource: row,
      circle: circleRow[0] ?? null,
      tags,
      versions: versions.map((v) => ({
        ...v,
        files: files.filter((f) => f.versionId === v.id),
      })),
    })
  })

  // ---------------------------------------------------------------- 写
  .post(
    '/resources',
    requireAuth,
    zValidator('json', createResourceSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const input = c.req.valid('json')

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(resource)
          .values({
            slug: makeSlug(input.titleOriginal),
            titleOriginal: input.titleOriginal,
            titleOriginalLocale: input.titleOriginalLocale,
            title: input.title,
            description: input.description,
            kind: input.kind,
            license: input.license,
            licenseNote: input.licenseNote,
            circleId: input.circleId,
            circleNameRaw: input.circleNameRaw,
            coverUrl: input.coverUrl,
            uploaderId: actor.id,
            status: 'draft',
          })
          .returning()

        if (!row) throw new Error('insert failed')

        if (input.tagIds.length) {
          await tx
            .insert(resourceTag)
            .values(input.tagIds.map((t) => ({ resourceId: row.id, tagId: t })))
            .onConflictDoNothing()
        }

        // 评论区从第一天就是论坛主题（M4 共用同一份数据）
        await tx.insert(schema.topic).values({
          kind: 'resource',
          resourceId: row.id,
          authorId: actor.id,
          title: row.titleOriginal,
        })

        return row
      })

      return c.json({ resource: created }, 201)
    },
  )

  .patch(
    '/resources/:id',
    requireAuth,
    zValidator('json', updateResourceSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const input = c.req.valid('json')

      const [row] = await db
        .select()
        .from(resource)
        .where(and(eq(resource.id, id), isNull(resource.deletedAt)))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)
      if (!isOwnerOrStaff(actor, row.uploaderId))
        return fail(c, 'forbidden', 403)

      // 许可状态改动必须走 /license（那里强制留痕）
      const { license: _license, tagIds, ...rest } = input
      const [updated] = await db
        .update(resource)
        .set(rest)
        .where(eq(resource.id, id))
        .returning()

      if (tagIds) {
        await db.transaction(async (tx) => {
          await tx.delete(resourceTag).where(eq(resourceTag.resourceId, id))
          if (tagIds.length) {
            await tx
              .insert(resourceTag)
              .values(tagIds.map((t) => ({ resourceId: id, tagId: t })))
              .onConflictDoNothing()
          }
        })
      }

      return c.json({ resource: updated })
    },
  )

  /** 投稿：信任达标直接发布，否则进审核队列 */
  .post('/resources/:id/submit', requireAuth, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const id = c.req.param('id')

    const [row] = await db
      .select()
      .from(resource)
      .where(and(eq(resource.id, id), isNull(resource.deletedAt)))
      .limit(1)
    if (!row) return fail(c, 'not_found', 404)
    if (!isOwnerOrStaff(actor, row.uploaderId)) return fail(c, 'forbidden', 403)

    const auto = canAutoPublish(actor)
    const to = submitTarget(auto)
    if (
      !canTransition(row.status, to, {
        role: actor.role,
        isOwner: actor.id === row.uploaderId,
        canAutoPublish: auto,
      })
    ) {
      return fail(c, 'invalid_state_transition', 409)
    }

    const [updated] = await db
      .update(resource)
      .set({ status: to })
      .where(eq(resource.id, id))
      .returning({ status: resource.status })

    return c.json({ status: updated?.status ?? to, autoPublished: auto })
  })

  /** staff 的状态流转（上下架、审核结论） */
  .post(
    '/resources/:id/status',
    requireAuth,
    zValidator('json', changeStatusSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const { to, reason } = c.req.valid('json')

      const [row] = await db
        .select()
        .from(resource)
        .where(and(eq(resource.id, id), isNull(resource.deletedAt)))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)

      if (
        !canTransition(row.status, to, {
          role: actor.role,
          isOwner: actor.id === row.uploaderId,
          canAutoPublish: canAutoPublish(actor),
        })
      ) {
        return fail(c, 'invalid_state_transition', 409)
      }

      await db.transaction(async (tx) => {
        await tx.update(resource).set({ status: to }).where(eq(resource.id, id))
        await tx.insert(schema.moderationLog).values({
          actorId: actor.id,
          action: 'status_change',
          subjectKind: 'resource',
          subjectId: id,
          fromValue: { status: row.status },
          toValue: { status: to },
          reason,
        })
      })

      return c.json({ status: to })
    },
  )

  /** 许可状态变更：必须给理由，且一定留痕——版权争议时这是证据链 */
  .patch(
    '/resources/:id/license',
    requireAuth,
    zValidator('json', changeLicenseSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const input = c.req.valid('json')

      const [row] = await db
        .select()
        .from(resource)
        .where(and(eq(resource.id, id), isNull(resource.deletedAt)))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)
      if (!isOwnerOrStaff(actor, row.uploaderId))
        return fail(c, 'forbidden', 403)

      await db.transaction(async (tx) => {
        await tx
          .update(resource)
          .set({ license: input.license, licenseNote: input.licenseNote })
          .where(eq(resource.id, id))
        await tx.insert(schema.moderationLog).values({
          actorId: actor.id,
          action: 'license_change',
          subjectKind: 'resource',
          subjectId: id,
          fromValue: { license: row.license, note: row.licenseNote },
          toValue: { license: input.license, note: input.licenseNote },
          reason: input.reason,
        })
      })

      return c.json({ license: input.license })
    },
  )
