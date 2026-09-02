import { db, schema } from '@gensokyo/db'
import {
  markReadSchema,
  type NotificationSubject,
  type NotificationView,
  paginationQuerySchema,
  RANKED_NOTIFICATION_KINDS,
} from '@gensokyo/shared'
import {
  aliasedTable,
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from 'drizzle-orm'
import { Hono } from 'hono'
import { fail, validate } from '../errors'
import { requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { visibleTopicWhere } from './content/visibility'

const { notification, topic, resource, post, user, userProfile } = schema

/** 只有回复/@ 才把「谁」给收件人看；治理类的执行者归属只留在 moderationLog */
const SHOWS_ACTOR = new Set<string>(RANKED_NOTIFICATION_KINDS)

// 两个 resource join：主题挂着的（不加别名，visibleTopicWhere 引用的就是它）
// 与通知自己指向的（审核/下架类），后者要别名
const subjectResource = aliasedTable(resource, 'subject_resource')
const actorUser = aliasedTable(user, 'actor_user')
const actorProfile = aliasedTable(userProfile, 'actor_profile')

/**
 * 收件箱。
 *
 * **subject 的可见性走 `visibleTopicWhere()`**——CLAUDE.md 的铁律：任何能返回
 * `topic.title` 的端点都要回答「它用的是哪一份 visibleTopicWhere」。这里的
 * 答案是：作为一个 boolean 列选出来，不可见就把 subject 渲染成 `{kind:'removed'}`，
 * **行本身保留**。通知不是法律留痕，但它是「有没有告诉过用户」的送达副本，
 * 删行会破坏这个语义。
 *
 * 资源类 subject（审核/下架）的收件人就是投稿者，只要资源没被软删就给他看——
 * 那是他自己的东西，draft 也一样。
 */
export const notifications = new Hono<AppEnv>()
  .get(
    '/',
    requireAuth,
    validate('query', paginationQuerySchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const { page, pageSize } = c.req.valid('query')
      const mine = eq(notification.userId, actor.id)

      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: notification.id,
            kind: notification.kind,
            topicId: notification.topicId,
            postId: notification.postId,
            payload: notification.payload,
            readAt: notification.readAt,
            createdAt: notification.createdAt,
            actorId: notification.actorId,
            actorName: actorUser.name,
            actorHandle: actorProfile.handle,
            // --- 主题 subject ---
            topicKind: topic.kind,
            topicTitle: topic.title,
            topicVisible: sql<boolean>`(${visibleTopicWhere()})`,
            topicResSlug: resource.slug,
            topicResTitleOriginal: resource.titleOriginal,
            topicResTitleOriginalLocale: resource.titleOriginalLocale,
            topicResTitle: resource.title,
            topicResCoverUrl: resource.coverUrl,
            // --- 资源 subject ---
            resSlug: subjectResource.slug,
            resTitleOriginal: subjectResource.titleOriginal,
            resTitleOriginalLocale: subjectResource.titleOriginalLocale,
            resTitle: subjectResource.title,
            resCoverUrl: subjectResource.coverUrl,
            resDeletedAt: subjectResource.deletedAt,
            floor: post.floor,
          })
          .from(notification)
          .leftJoin(actorUser, eq(actorUser.id, notification.actorId))
          .leftJoin(actorProfile, eq(actorProfile.userId, notification.actorId))
          .leftJoin(topic, eq(topic.id, notification.topicId))
          .leftJoin(resource, eq(resource.id, topic.resourceId))
          .leftJoin(
            subjectResource,
            eq(subjectResource.id, notification.resourceId),
          )
          .leftJoin(post, eq(post.id, notification.postId))
          .where(mine)
          // id 兜底：同一事务里扇出的两条 createdAt 相同
          .orderBy(desc(notification.createdAt), desc(notification.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: count() }).from(notification).where(mine),
      ])

      const items: NotificationView[] = rows.map((r) => {
        let subject: NotificationSubject | null = null
        if (r.topicId) {
          if (!r.topicVisible) subject = { kind: 'removed' }
          else if (r.topicKind === 'resource' && r.topicResSlug) {
            subject = {
              kind: 'resource',
              resource: {
                slug: r.topicResSlug,
                titleOriginal: r.topicResTitleOriginal as string,
                titleOriginalLocale: r.topicResTitleOriginalLocale as string,
                title: r.topicResTitle,
                coverUrl: r.topicResCoverUrl,
              },
            }
          } else subject = { kind: 'topic', title: r.topicTitle ?? '' }
        } else if (r.resSlug !== null || r.kind === 'resource_deleted') {
          // 硬删的没有外键可指，只剩 payload 里的快照；软删的对收件人也算「已移除」
          subject =
            r.resSlug && r.resDeletedAt === null
              ? {
                  kind: 'resource',
                  resource: {
                    slug: r.resSlug,
                    titleOriginal: r.resTitleOriginal as string,
                    titleOriginalLocale: r.resTitleOriginalLocale as string,
                    title: r.resTitle,
                    coverUrl: r.resCoverUrl,
                  },
                }
              : { kind: 'removed' }
        }

        const payload = (r.payload as Record<string, unknown> | null) ?? null
        return {
          id: r.id,
          kind: r.kind,
          /**
           * 治理类通知不暴露执行的版主/站长——solo 或小团队运营下，那等于把
           * 版主的 /u/:handle 直接交给刚被删帖记违规的人。
           * handle 缺失 → 置 null，不用 `?? ''` 兜（PostAuthor 契约）。
           */
          actor:
            SHOWS_ACTOR.has(r.kind) && r.actorId && r.actorHandle
              ? {
                  id: r.actorId,
                  name: r.actorName ?? '',
                  handle: r.actorHandle,
                }
              : null,
          topicId: r.topicId,
          postId: r.postId,
          subject,
          // 对象被硬删后外键置空、join 不到，退回写入时的快照
          floor:
            r.floor ??
            (typeof payload?.floor === 'number' ? payload.floor : null),
          payload,
          read: r.readAt !== null,
          createdAt: r.createdAt.toISOString(),
        }
      })

      return c.json({ items, page, pageSize, total: total?.n ?? 0 })
    },
  )

  /**
   * 标记已读。`ids` 或 `upTo` 二选一（schema 用 XOR refine 保证）。
   * 「全部已读」走 id 游标：点击那一瞬间刚到的通知不该被这次操作吞掉，
   * 而时间戳游标在微秒截断与 now() 事务起点两处都会出错——见 markReadSchema。
   * 只动自己的、只动未读的——重复标记是幂等的空操作。
   */
  .post('/read', requireAuth, validate('json', markReadSchema), async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const input = c.req.valid('json')

    let scope = input.ids ? inArray(notification.id, input.ids) : undefined
    if (input.upTo) {
      // 游标必须是自己的通知：拿别人的 id 也能算出一个时间点
      const [cursor] = await db
        .select({ id: notification.id })
        .from(notification)
        .where(
          and(
            eq(notification.id, input.upTo),
            eq(notification.userId, actor.id),
          ),
        )
        .limit(1)
      if (!cursor) return fail(c, 'not_found', 404)
      /**
       * row-value 比较，与列表的排序键 (created_at desc, id desc) 完全对应。
       * **游标的 created_at 必须留在 SQL 里用子查询取**：读进 JS 的 Date 只有
       * 毫秒，再绑回去就是 `.123456 <= .123000` → 游标那条自己都标不掉——
       * 正是这个端点从时间戳游标改成 id 游标要消掉的那个错误。
       */
      scope = sql`(${notification.createdAt}, ${notification.id}) <= (
        select n2.created_at, n2.id from ${notification} n2 where n2.id = ${cursor.id}
      )`
    }

    const marked = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, actor.id),
          isNull(notification.readAt),
          scope,
        ),
      )
      .returning({ id: notification.id })
    return c.json({ marked: marked.length })
  })
