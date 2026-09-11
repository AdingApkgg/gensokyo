import { db, schema } from '@gensokyo/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../middleware/session'
import { visibleTopicWhere } from './content/visibility'

const { resource, topic } = schema

/**
 * sitemap.xml 的数据源。web 拿它拼 XML——三语互链的形状是前端的事，
 * 这里只回答「哪些东西对匿名访客存在，以及它们最后一次变动是什么时候」。
 *
 * **可见性用的是哪一份闸门**（CLAUDE.md 要求每个能返回 topic 行的端点都
 * 回答这个问题）：主题走 `visibleTopicWhere()` 的**表达式**形式，配
 * `LEFT JOIN resource`——它是列表路径，函数形式复用不上。
 *
 * sitemap 是一份对外公开的网址清单，所以它的漏洞不是「多显示一行」而是
 * 「把未发布内容的存在告诉全世界」。资源侧同样是白名单：
 * `status = 'published' AND deleted_at IS NULL`，绝不写 `!== 'delisted'`。
 */

/**
 * 单类型上限，取 **sitemap 协议自身的 50,000 条**。
 *
 * 这个数不能按手头开发库的行数拍：初版取 5,000 是照开发库的 110 条定的，
 * 上线当天就把生产的 6,696 条资源截掉了 1,696 条——而截断没有任何症状，
 * 正好把这层 SEO 要解决的问题重新制造了一遍。50,000 是「再往上这份文件
 * 无论如何都不再是一份合法 sitemap」的那个点，越过它要做的是 sitemap
 * index 分片，而不是再调大一次常量。
 */
const MAX = 50_000

/** 触顶不能无声。它是这个端点唯一一种「返回 200 但结果是错的」的失败 */
const warnIfCapped = (kind: string, n: number) => {
  if (n >= MAX) {
    console.warn(
      `[sitemap] ${kind} 触到 ${MAX} 条上限，清单已被截断——该上 sitemap index 分片了`,
    )
  }
}

export const sitemap = new Hono<AppEnv>().get('/', async (c) => {
  const [resources, topics] = await Promise.all([
    db
      .select({ slug: resource.slug, updatedAt: resource.updatedAt })
      .from(resource)
      .where(and(eq(resource.status, 'published'), isNull(resource.deletedAt)))
      .orderBy(desc(resource.updatedAt))
      .limit(MAX),
    /**
     * **只要版块主题。** 资源自带的讨论主题的网址就是
     * `/kourindou/:slug#discussion`，再给它发一条 `/shrine/t/:id`
     * 等于同一份内容在清单里出现两次——那正是 hreflang 要消除的重复。
     */
    db
      .select({ id: topic.id, lastPostAt: topic.lastPostAt })
      .from(topic)
      .leftJoin(resource, eq(resource.id, topic.resourceId))
      .where(and(visibleTopicWhere(), eq(topic.kind, 'board')))
      .orderBy(desc(topic.lastPostAt))
      .limit(MAX),
  ])

  warnIfCapped('resources', resources.length)
  warnIfCapped('topics', topics.length)
  return c.json({ resources, topics })
})
