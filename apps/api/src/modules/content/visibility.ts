import { db, schema } from '@gensokyo/db'
import type { BoardSlug, TopicView } from '@gensokyo/shared'
import { and, eq, isNull, or } from 'drizzle-orm'

const { topic, resource } = schema

/**
 * 可见性闸门的**唯一**来源。
 *
 * 一条主题可见，当且仅当：主题自己没被软删，**并且**（它不是资源主题，
 * 或者它挂着的资源已发布且没被软删）。
 *
 * ⚠️ **两种形式都必须存在，不是二选一。**
 * 函数只能被「取一行」的路径复用；最新流、/u/:handle、通知收件箱这些列表
 * 路径必然各写一遍 WHERE，那正是 P0-1 泄漏（被下架资源的讨论从个人主页
 * 泄漏出去）的成因。所以列表路径用表达式，取单行用函数，两边同一个谓词。
 *
 * ⚠️ 用表达式的查询**必须 LEFT JOIN resource**——谓词里引用了 resource 的列。
 */
export const visibleTopicWhere = () =>
  and(
    isNull(topic.deletedAt),
    or(
      isNull(topic.resourceId),
      and(
        // 白名单，绝不写 !== 'delisted'
        eq(resource.status, 'published'),
        /**
         * 少了这一条 = P0-1 换一扇门进来：admin 的软删只写 deletedAt，
         * **完全不动 status**，于是被站长软删的资源 status 仍是 'published'，
         * 它的主题会继续进最新流 / 个人主页 / 通知收件箱，标题封面讨论内容
         * 照常现取——而 /kourindou/:slug 那边早就 404 了。
         */
        isNull(resource.deletedAt),
      ),
    ),
  )

const topicProjection = {
  id: topic.id,
  kind: topic.kind,
  resourceId: topic.resourceId,
  resourceSlug: resource.slug,
  boardSlug: topic.boardSlug,
  title: topic.title,
  authorId: topic.authorId,
  floorSeq: topic.floorSeq,
  pinnedAt: topic.pinnedAt,
  lastPostAt: topic.lastPostAt,
}

const toView = (r: {
  id: string
  kind: 'resource' | 'board'
  resourceId: string | null
  resourceSlug: string | null
  boardSlug: string | null
  title: string | null
  authorId: string | null
  floorSeq: number
  pinnedAt: Date | null
  lastPostAt: Date
}): TopicView => ({ ...r, boardSlug: r.boardSlug as BoardSlug | null })

/**
 * 按 id 取一条可见主题。
 *
 * **它取代了 topicForResource()，不是与之并列。** 那个函数只按 resourceId
 * 取行，topic.deletedAt 根本不在 WHERE 里——是一条会返回墓碑的查询。
 */
export async function loadVisibleTopic(id: string): Promise<TopicView | null> {
  const [row] = await db
    .select(topicProjection)
    .from(topic)
    .leftJoin(resource, eq(resource.id, topic.resourceId))
    .where(and(eq(topic.id, id), visibleTopicWhere()))
    .limit(1)
  return row ? toView(row) : null
}

/**
 * 按资源 slug 取它的讨论主题。
 *
 * 资源详情页要用它——那个页面只知道 slug。走的是同一个谓词，
 * 所以「资源页看得到的评论」与「神社看得到的主题」永远是同一批。
 */
export async function loadVisibleTopicByResourceSlug(
  slug: string,
): Promise<TopicView | null> {
  const [row] = await db
    .select(topicProjection)
    .from(topic)
    .leftJoin(resource, eq(resource.id, topic.resourceId))
    .where(and(eq(resource.slug, slug), visibleTopicWhere()))
    .limit(1)
  return row ? toView(row) : null
}
