import { db, schema } from '@gensokyo/db'
import {
  paginationQuerySchema,
  resolveReportSchema,
  reviewResourceSchema,
  STRIKE_REJECT_REASONS,
} from '@gensokyo/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, validate } from '../errors'
import { requireRole } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { canTransition } from './kourindou/status'

const { resource, userProfile, moderationLog, report, user } = schema

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
      })

      return c.json({ status: to, struck: striking })
    },
  )

  .get('/reports', validate('query', paginationQuerySchema), async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const items = await db
      .select()
      .from(report)
      .where(eq(report.status, 'open'))
      .orderBy(asc(report.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
    return c.json({ items, page, pageSize })
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

      await db.transaction(async (tx) => {
        await tx
          .update(report)
          .set({
            status: input.status,
            resolvedBy: actor.id,
            resolvedAt: new Date(),
          })
          .where(eq(report.id, id))
        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: 'report_resolve',
          subjectKind: 'report',
          subjectId: id,
          fromValue: { status: row.status },
          toValue: { status: input.status },
          reason: input.note,
        })
      })

      return c.json({ status: input.status })
    },
  )
