import { db, schema } from '@gensokyo/db'
import {
  paginationQuerySchema,
  resolveReportSchema,
  reviewResourceSchema,
  STRIKE_REJECT_REASONS,
} from '@gensokyo/shared'
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, validate } from '../errors'
import { requireRole } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { notify } from '../notify'
import { canTransition } from './kourindou/status'

const { resource, userProfile, moderationLog, report, user, post, topic } =
  schema

export const moderation = new Hono<AppEnv>()
  .use('*', requireRole('moderator'))

  /** 审核队列。低信任的排前面——他们更可能出问题，也更需要及时反馈 */
  .get('/queue', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const items = await db
      .select({
        id: resource.id,
        slug: resource.slug,
        titleOriginal: resource.titleOriginal,
        titleOriginalLocale: resource.titleOriginalLocale,
        title: resource.title,
        kind: resource.kind,
        license: resource.license,
        licenseNote: resource.licenseNote,
        coverUrl: resource.coverUrl,
        createdAt: resource.createdAt,
        uploaderId: resource.uploaderId,
        uploaderName: user.name,
        approvedResourceCount: userProfile.approvedResourceCount,
        strikeCount: userProfile.strikeCount,
      })
      .from(resource)
      .leftJoin(user, eq(user.id, resource.uploaderId))
      .leftJoin(userProfile, eq(userProfile.userId, resource.uploaderId))
      .where(and(eq(resource.status, 'pending'), isNull(resource.deletedAt)))
      .orderBy(asc(userProfile.approvedResourceCount), asc(resource.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(resource)
      .where(and(eq(resource.status, 'pending'), isNull(resource.deletedAt)))

    return c.json({ items, page, pageSize, total: count?.n ?? 0 })
  })

  /**
   * 审核结论。
   *
   * 通过：发布 + 作者的 approvedResourceCount +1（这是信任梯度的进度条）。
   * 拒绝：退回草稿；若理由是版权或违法，strikeCount +1——**这是整个信任
   * 梯度唯一的惩罚机制**，少了它，被确认侵权的账号下一稿照样即发即审。
   */
  .post(
    '/resources/:id/review',
    entityIdParam,
    validate('json', reviewResourceSchema),
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
      // 审核只作用于队列中的资源；否则可以 approve 一个从未投稿的草稿
      if (row.status !== 'pending') {
        return fail(c, 'invalid_state_transition', 409)
      }

      const to = input.decision === 'approve' ? 'published' : 'draft'
      if (
        !canTransition(row.status, to, {
          role: actor.role,
          isOwner: actor.id === row.uploaderId,
          canAutoPublish: false,
        })
      ) {
        return fail(c, 'invalid_state_transition', 409)
      }

      const striking =
        input.decision === 'reject' &&
        input.rejectReason !== undefined &&
        STRIKE_REJECT_REASONS.includes(input.rejectReason)

      await db.transaction(async (tx) => {
        await tx.update(resource).set({ status: to }).where(eq(resource.id, id))

        if (row.uploaderId) {
          if (input.decision === 'approve') {
            await tx
              .update(userProfile)
              .set({
                approvedResourceCount: sql`${userProfile.approvedResourceCount} + 1`,
              })
              .where(eq(userProfile.userId, row.uploaderId))
          } else if (striking) {
            await tx
              .update(userProfile)
              .set({ strikeCount: sql`${userProfile.strikeCount} + 1` })
              .where(eq(userProfile.userId, row.uploaderId))
          }
        }

        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: 'review',
          subjectKind: 'resource',
          subjectId: id,
          fromValue: { status: row.status },
          toValue: { status: to, decision: input.decision },
          rejectReason: input.rejectReason,
          reason: input.note,
        })

        if (row.uploaderId) {
          await notify(tx, [
            {
              userId: row.uploaderId,
              kind:
                input.decision === 'approve'
                  ? 'review_approved'
                  : 'review_rejected',
              actorId: actor.id,
              resourceId: id,
              // 只带枚举。note 是给审计日志的内部备注，不投递给投稿者
              payload: { rejectReason: input.rejectReason ?? null },
            },
          ])
        }
      })

      return c.json({ status: to, struck: striking })
    },
  )

  /**
   * 举报队列。**一个混合队列**，不按对象类型分 tab——solo 运营下分 tab 的
   * 唯一收益（分工）不存在，而按紧急度排序是真有用的。
   */
  .get('/reports', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query')

    /**
     * ⚠️ **cast 恒定作用在 uuid 那一侧：`post.id::text = report.target_id`。**
     * 反过来写 `report.target_id::uuid` 会在队列里出现任何一条非 uuid 的
     * targetId 时让**整个查询** 500——而 targetId 是多态 text 列
     * （targetKind 可以是 user，而 user.id 是 better-auth 的 32 位非 uuid 串），
     * 它迟早会有非 uuid 的值。入口校验挡不住这件事：reports.ts 的 uuidLike
     * 只管新写入，历史行、seed、手工 SQL 都进不了那道闸。
     *
     * 这个坑被挖回来过两次，所以有一条专门的测试钉住它——
     * shrine.test.ts 里先插一条 targetId 非 uuid 的 open 举报再断言 200。
     * `count(*)` 验不出来：PG 会把没被引用的 LEFT JOIN 整个消掉。
     */
    const where = eq(report.status, 'open')
    const [items, [total]] = await Promise.all([
      db
        .select({
          id: report.id,
          targetKind: report.targetKind,
          targetId: report.targetId,
          reason: report.reason,
          detail: report.detail,
          status: report.status,
          createdAt: report.createdAt,
          reporterId: report.reporterId,
          // --- 目标上下文：没有它，处理一条帖子举报要靠复制 uuid 去猜 ---
          postFloor: post.floor,
          postTopicId: post.topicId,
          postDeletedAt: post.deletedAt,
          topicTitle: topic.title,
          topicKind: topic.kind,
          resourceSlug: resource.slug,
          resourceTitleOriginal: resource.titleOriginal,
          resourceTitleOriginalLocale: resource.titleOriginalLocale,
          resourceTitle: resource.title,
        })
        .from(report)
        .leftJoin(post, sql`${post.id}::text = ${report.targetId}`)
        .leftJoin(topic, eq(topic.id, post.topicId))
        /**
         * 两条 join 的 cast 方向必须**一致**：uuid 侧转 text，永不反向。
         * 上一版这里写的是 `coalesce(topic.resource_id, target_id::uuid)`，
         * 正是上面那段注释三行前刚禁止的方向——而且对每一条 resource_id
         * 为 NULL 的行（所有版块帖举报）都会求值。dev 库上它已经在 500 了。
         */
        .leftJoin(
          resource,
          sql`${resource.id}::text = coalesce(${topic.resourceId}::text, ${report.targetId})`,
        )
        .where(where)
        /**
         * 按紧急度排：版权与违法是下架通道的入口，骚扰与灌水次之。
         * 同级内先到先处理。
         */
        .orderBy(
          sql`case ${report.reason}
                when 'copyright' then 0 when 'illegal' then 0
                when 'harassment' then 1 when 'spam' then 2 else 3 end`,
          asc(report.createdAt),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: count() }).from(report).where(where),
    ])

    return c.json({ items, page, pageSize, total: total?.n ?? 0 })
  })

  .post(
    '/reports/:id/resolve',
    entityIdParam,
    validate('json', resolveReportSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const input = c.req.valid('json')

      const [row] = await db
        .select()
        .from(report)
        .where(eq(report.id, id))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)
      /**
       * 只处理 open 的。此前能把已 resolved 的改成 rejected 并覆盖 resolvedBy——
       * 审计里「谁处理的」被后来者顶掉，而 report_open_uq 是按 open 算的，
       * 结案后再改也不会撞它。既有 bug，顺手修。
       */
      if (row.status !== 'open') return fail(c, 'invalid_state_transition', 409)

      // 两个版主同时结案：UPDATE 的 WHERE 带 status='open'，只有一个能命中行；
      // 命中 0 行的那个不能再写审计装作自己处理了
      const won = await db.transaction(async (tx) => {
        const [hit] = await tx
          .update(report)
          .set({
            status: input.status,
            resolvedBy: actor.id,
            resolvedAt: new Date(),
          })
          .where(and(eq(report.id, id), eq(report.status, 'open')))
          .returning({ id: report.id })
        if (!hit) return false
        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: 'report_resolve',
          subjectKind: 'report',
          subjectId: id,
          fromValue: { status: row.status },
          toValue: { status: input.status },
          reason: input.note,
        })
        return true
      })
      if (!won) return fail(c, 'invalid_state_transition', 409)

      return c.json({ status: input.status })
    },
  )
