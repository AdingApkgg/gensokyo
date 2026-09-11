import { db, schema } from '@gensokyo/db'
import {
  applyTranslation,
  changeLicenseSchema,
  changeStatusSchema,
  createResourceSchema,
  createVersionSchema,
  isTranslationOverwrite,
  listResourcesQuerySchema,
  updateResourceSchema,
  updateTranslationSchema,
} from '@gensokyo/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, validate } from '../../errors'
import { isOwnerOrStaff, requireAuth } from '../../middleware/require'
import { type AppEnv, canAutoPublish } from '../../middleware/session'
import { notify } from '../../notify'
import { assertRate } from '../../rate'
import { autoPublishThreshold } from '../../site-config'
import { loadVisibleTopicByResourceSlug } from '../content/visibility'
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

    /**
     * 当前用户对它的评分。星条要靠它显示「我评过了」这个常驻状态——
     * 没有它，每次刷新星条都是空的，用户不知道自己评没评、评了几分。
     * 匿名与未评 → null。只多一次主键查询，且 actor 为空时不查——匿名读者零成本。
     */
    const myRating = actor
      ? ((
          await db
            .select({ score: schema.rating.score })
            .from(schema.rating)
            .where(
              and(
                eq(schema.rating.resourceId, row.id),
                eq(schema.rating.userId, actor.id),
              ),
            )
            .limit(1)
        )[0]?.score ?? null)
      : null

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

    /**
     * 评论区的入口。楼层的读写全部走 /api/shrine/topics/:id/posts——
     * 同一张表两个写入口 = 两份可见性判断 = 必然漂移，所以这里只给 id。
     *
     * 走同一道闸门取：主题被软删时它是 null，前端据此不渲染评论区，
     * 而不是渲染出一个点进去 404 的壳。
     */
    const discussion = await loadVisibleTopicByResourceSlug(slug)

    return c.json({
      resource: row,
      circle: circleRow[0] ?? null,
      tags,
      versions: versions.map((v) => ({
        ...v,
        files: files.filter((f) => f.versionId === v.id),
      })),
      topicId: discussion?.id ?? null,
      myRating,
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

        /**
         * 评论区从第一天就是论坛主题（M4 共用同一份数据）。
         *
         * **不写 title**：资源标题是 titleOriginal + 三语 jsonb 一束，
         * 存快照既不随资源 PATCH 更新、又只能存下其中一种语言。
         * 显示时从 resource 现取。DB 侧由 topic_kind_shape 兜底。
         */
        await tx.insert(schema.topic).values({
          kind: 'resource',
          resourceId: row.id,
          authorId: actor.id,
          lastPostAt: new Date(),
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

  /**
   * 补译名。**全站唯一一个非作者也能写内容的端点。**
   *
   * 它不需要审核队列，全部理由只有一条：**陌生人只能填空位**。新增一个
   * 原本不存在的译名是纯增量，写坏了由作者或 staff 覆写；而改写别人已经
   * 写好的值是编辑他人内容，那永远要 `isOwnerOrStaff`。判据在
   * `isTranslationOverwrite`（shared，有单测），不要在这里就地展开重写。
   *
   * 与 `PATCH /resources/:id` 分成两个端点也是为此：那个 schema 带着
   * license、status、tagIds，对陌生人开放等于把治理字段一起交出去。
   */
  .patch(
    '/resources/:id/translations',
    // requireAuth 在 entityIdParam 之前：否则未登录用户能用 400/404 的差异
    // 探测资源存在性
    requireAuth,
    entityIdParam,
    validate('json', updateTranslationSchema),
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

      /**
       * 白名单判可见（`=== 'published'`），不是 `!== 'delisted'`。
       * 草稿与待审对陌生人一律 404——补译名不能成为存在性预言机。
       */
      const owned = isOwnerOrStaff(actor, row.uploaderId)
      if (row.status !== 'published' && !owned) return fail(c, 'not_found', 404)

      // 已下架的不接受任何编辑，与 PATCH /resources/:id 同一条规矩
      if (row.status === 'delisted') {
        return fail(c, 'invalid_state_transition', 409)
      }

      const overwriting =
        isTranslationOverwrite(row.title, input.locale, input.title) ||
        isTranslationOverwrite(row.description, input.locale, input.description)
      if (overwriting && !owned) return fail(c, 'forbidden', 403)

      /**
       * 限流放在权限之后：被 403 挡住的请求本来就不落行，先查配额只是
       * 白白多一次 COUNT。`translation` 是它自己的桶——与发帖共用配额的话，
       * 补一条译名会让人发不出帖。
       */
      const rate = await assertRate(actor, 'translation')
      if (!rate.ok) {
        c.header('Retry-After', String(rate.retryAfterSeconds))
        return fail(c, 'rate_limited', 429)
      }

      const updated = await db.transaction(async (tx) => {
        const [r] = await tx
          .update(resource)
          .set({
            title: applyTranslation(row.title, input.locale, input.title),
            description: applyTranslation(
              row.description,
              input.locale,
              input.description,
            ),
          })
          .where(eq(resource.id, id))
          .returning()

        /**
         * 审计行与写入同一个事务：这是全站唯一能回答「谁把这条资源的哪种
         * 语言改成了什么」的地方，漏一条就永远查不回来。它同时是限流的
         * 计数依据（rate.ts 的 translation 桶数的就是这些行）。
         */
        await tx.insert(schema.moderationLog).values({
          actorId: actor.id,
          action: 'translation_edit',
          subjectKind: 'resource',
          subjectId: id,
          fromValue: {
            locale: input.locale,
            title: row.title?.[input.locale] ?? null,
            description: row.description?.[input.locale] ?? null,
          },
          toValue: {
            locale: input.locale,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
          },
          reason: owned ? null : '社区补译名',
        })

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

    const auto = canAutoPublish(actor, await autoPublishThreshold())
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

      /**
       * 审核结论（通过**与拒绝**）只能走 `/moderation/resources/:id/review`。
       *
       * 那条路径才递增 `approvedResourceCount` / 记 strike、才把审计写成 `review`、
       * 才通知投稿者；从这里放行 pending→draft 就是一扇「不通知、不记理由、
       * 不记 strike」的第二拒稿门。同一个业务动作只能有一条路径。
       *
       * ⚠️ **不能改状态机去掉这条边**：`/review` 自己调的正是
       * `canTransition(pending, published)`，删了它审核通过会 409。
       * `status.ts` 是「什么跃迁合法」的真相，不是「走哪扇门」的真相——
       * 门在这里关。
       */
      if (row.status === 'pending' && (to === 'published' || to === 'draft')) {
        return fail(c, 'invalid_state_transition', 409)
      }

      if (
        !canTransition(row.status, to, {
          role: actor.role,
          isOwner: actor.id === row.uploaderId,
          canAutoPublish: canAutoPublish(actor, await autoPublishThreshold()),
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
        // 被 staff 下架要通知作者；作者自助下架不用（notify 会滤掉自己）
        if (to === 'delisted' && row.uploaderId) {
          await notify(tx, [
            {
              userId: row.uploaderId,
              kind: 'resource_delisted',
              actorId: actor.id,
              resourceId: id,
              // reason 是自由文本、写进审计日志的，不投递给作者
              payload: null,
            },
          ])
        }
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
