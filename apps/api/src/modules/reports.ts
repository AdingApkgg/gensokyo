import { db, schema } from '@gensokyo/db'
import { createReportSchema } from '@gensokyo/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { fail, isUniqueViolation, validate } from '../errors'
import { requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { assertRate } from '../rate'
import { loadVisibleTopic } from './content/visibility'

const { resource, post, report } = schema

/** 非 uuid 的 targetId 直接 404，别让它进 SQL 触发 22P02 */
const uuidLike = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/**
 * 举报。**两个模块共用，所以挂在顶层而不是 /kourindou 下。**
 *
 * 从 `/api/kourindou/reports` 搬来：M4 起论坛与香霖堂两侧都要调它，
 * 留在资源模块下会让论坛的前端去调一条写着 kourindou 的路径。
 *
 * solo 运营下这是全站唯一的「审」的入口——`report_open_uq` 保证同一个人
 * 对同一对象只能有一条未结案的举报，被重复提交埋掉等于关掉整个治理通道。
 */
export const reports = new Hono<AppEnv>().post(
  '/',
  requireAuth,
  validate('json', createReportSchema),
  async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const input = c.req.valid('json')

    const rate = await assertRate(actor, 'report')
    if (!rate.ok) {
      // 与 shrine 的 blocked() 一致：不带 Retry-After 的话，
      // 「等 15 秒」和「等一小时」在界面上是同一句话
      c.header('Retry-After', String(rate.retryAfterSeconds))
      return fail(c, 'rate_limited', 429)
    }

    /**
     * 两个分支都要设防：不过滤可见性的话，对任意 uuid 举报的成败就成了
     * 「该对象是否存在」的预言机——包括别人的私有草稿。
     */
    if (!uuidLike(input.targetId)) return fail(c, 'not_found', 404)

    if (input.targetKind === 'resource') {
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
      const [row] = await db
        .select({ authorId: post.authorId, topicId: post.topicId })
        .from(post)
        .where(and(eq(post.id, input.targetId), isNull(post.deletedAt)))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)
      /**
       * 楼层还要过它所属主题的闸门——否则可以对一条被下架资源的评论区
       * 提交举报，那既泄漏了「该主题存在」，也会往队列里塞进不可达的对象。
       */
      if (!(await loadVisibleTopic(row.topicId)))
        return fail(c, 'not_found', 404)
      if (row.authorId === actor.id)
        return fail(c, 'self_action_forbidden', 403)
    }

    try {
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
    } catch (err) {
      // report_open_uq：同一人对同一对象已有未结案举报
      if (isUniqueViolation(err)) return fail(c, 'duplicate_slug', 409)
      throw err
    }
  },
)
