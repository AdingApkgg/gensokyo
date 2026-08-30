import { db, schema } from '@gensokyo/db'
import {
  changeLicenseSchema,
  changeStatusSchema,
  createResourceSchema,
  createVersionSchema,
  listResourcesQuerySchema,
  updateResourceSchema,
} from '@gensokyo/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, validate } from '../../errors'
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
  .get('/resources', validate('query', listResourcesQuerySchema), async (c) => {
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
      db.select({ n: sql<number>`count(*)::int` }).from(resource).where(where),
    ])

    return c.json({
      items,
      page: q.page,
      pageSize: q.pageSize,
      total: count?.n ?? 0,
    })
  })

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
    validate('json', createResourceSchema),
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
    entityIdParam,
    requireAuth,
    validate('json', updateResourceSchema),
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

      // 已下架的资源不允许继续编辑：下架是治理动作，不该被绕过
      if (row.status === 'delisted') {
        return fail(c, 'invalid_state_transition', 409)
      }

      /**
       * license 与 licenseNote 都必须走 /license——那里强制给理由并写
       * moderationLog。licenseNote 是许可状态的自由文本载体，从这里漏过去
       * 等于让版权处置的证据链断掉。
       */
      const { license: _license, licenseNote: _note, tagIds, ...rest } = input

      const updated = await db.transaction(async (tx) => {
        // 只改标签时 rest 是空对象，drizzle 的 .set({}) 会抛错
        const [r] = Object.keys(rest).length
          ? await tx
              .update(resource)
              .set(rest)
              .where(eq(resource.id, id))
              .returning()
          : await tx.select().from(resource).where(eq(resource.id, id)).limit(1)

        // 只有显式传了 tagIds 才动标签；传空数组是「清空」，不传是「不管」
        if (tagIds !== undefined) {
          await tx.delete(resourceTag).where(eq(resourceTag.resourceId, id))
          if (tagIds.length) {
            await tx
              .insert(resourceTag)
              .values(tagIds.map((t) => ({ resourceId: id, tagId: t })))
              .onConflictDoNothing()
          }
        }

        // 已发布内容被改动要留痕，否则「审核一次之后随意换货」无从追溯
        if (row.status === 'published') {
          await tx.insert(schema.moderationLog).values({
            actorId: actor.id,
            action: 'status_change',
            subjectKind: 'resource',
            subjectId: id,
            fromValue: { edited: 'published_resource' },
            toValue: { fields: Object.keys(rest) },
            reason: '已发布资源被编辑',
          })
        }

        return r
      })

      return c.json({ resource: updated })
    },
  )

  /** 投稿：信任达标直接发布，否则进审核队列 */
  .post('/resources/:id/submit', entityIdParam, requireAuth, async (c) => {
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
    entityIdParam,
    requireAuth,
    validate('json', changeStatusSchema),
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
    entityIdParam,
    requireAuth,
    validate('json', changeLicenseSchema),
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

  /** 新建版本并挂上分发链接 */
  .post(
    '/resources/:id/versions',
    entityIdParam,
    requireAuth,
    validate('json', createVersionSchema),
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

      const created = await db.transaction(async (tx) => {
        // 新版本成为最新版，旧的先让位（isLatest 上有部分唯一索引）
        await tx
          .update(resourceVersion)
          .set({ isLatest: 0 })
          .where(eq(resourceVersion.resourceId, id))

        const [version] = await tx
          .insert(resourceVersion)
          .values({
            resourceId: id,
            label: input.label,
            changelog: input.changelog,
            isLatest: 1,
          })
          .returning()
        if (!version) throw new Error('insert failed')

        const files = await tx
          .insert(resourceFile)
          .values(
            input.files.map((f, i) => ({
              versionId: version.id,
              label: f.label,
              url: f.url,
              kind: f.mirrorKind,
              extractCode: f.extractCode,
              sizeBytes: f.sizeBytes,
              note: f.note,
              sortOrder: i,
            })),
          )
          .returning()

        return { version, files }
      })

      return c.json(created, 201)
    },
  )

  /**
   * 下载跳转。状态判断用白名单——写成 `!== 'delisted'` 会在新增状态时漏网。
   * 外链本身不校验可达性（网盘普遍反爬），失效由用户举报 broken_link 处理。
   */
  .get('/resources/:slug/files/:fileId/download', async (c) => {
    const { slug, fileId } = c.req.param()

    const [row] = await db
      .select({
        id: resource.id,
        status: resource.status,
        deletedAt: resource.deletedAt,
      })
      .from(resource)
      .where(eq(resource.slug, slug))
      .limit(1)

    // biome-ignore lint/complexity/useOptionalChain: 下载的安全闸门，三种拒绝情形显式写出比可选链更难读错
    if (!row || row.status !== 'published' || row.deletedAt !== null) {
      return fail(c, 'not_found', 404)
    }

    const [file] = await db
      .select({ url: resourceFile.url, versionId: resourceFile.versionId })
      .from(resourceFile)
      .innerJoin(
        resourceVersion,
        eq(resourceVersion.id, resourceFile.versionId),
      )
      .where(
        and(
          eq(resourceFile.id, fileId),
          eq(resourceVersion.resourceId, row.id),
        ),
      )
      .limit(1)

    if (!file) return fail(c, 'not_found', 404)

    const actor = c.get('actor')
    await db.transaction(async (tx) => {
      // 原子自增，不是读改写——并发下载不会丢计数
      await tx
        .update(resource)
        .set({ downloadCount: sql`${resource.downloadCount} + 1` })
        .where(eq(resource.id, row.id))
      await tx.insert(schema.downloadLog).values({
        resourceId: row.id,
        fileId,
        userId: actor?.id ?? null,
      })
    })

    return c.redirect(file.url, 302)
  })
