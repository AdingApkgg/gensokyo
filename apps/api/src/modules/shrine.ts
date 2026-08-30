import { db } from '@gensokyo/db'
import { createPostSchema, listPostsQuerySchema } from '@gensokyo/shared'
import { Hono } from 'hono'
import { entityIdParam, fail, validate } from '../errors'
import { isOwnerOrStaff, requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { createPost, findPost, listPosts, softDeletePost } from './content/post'
import { loadVisibleTopic } from './content/visibility'

/**
 * 博丽神社。
 *
 * **楼层的唯一入口。** 资源评论区与版块帖是同一份数据，从 M4 起也是同一组
 * 路由——香霖堂那边只返回 `topicId`，读写都走这里。
 * 同一张表两个写入口 = 两份可见性判断 = 必然漂移，M3 已经漂过一次
 * （publishedTopic 把关 resource，它调用的 topicForResource 什么都不把关）。
 *
 * T4 会在这之上加版块主题的增删改查；这里只有从 /kourindou 搬过来的三条。
 */
export const shrine = new Hono<AppEnv>()
  .get(
    '/topics/:id/posts',
    entityIdParam,
    validate('query', listPostsQuerySchema),
    async (c) => {
      const t = await loadVisibleTopic(c.req.param('id'))
      if (!t) return fail(c, 'not_found', 404)
      return c.json(await listPosts(t, c.req.valid('query').from))
    },
  )

  .post(
    '/topics/:id/posts',
    requireAuth,
    entityIdParam,
    validate('json', createPostSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)

      const t = await loadVisibleTopic(c.req.param('id'))
      if (!t) return fail(c, 'not_found', 404)

      const input = c.req.valid('json')
      const result = await db.transaction((tx) =>
        createPost(tx, t, { authorId: actor.id, ...input }),
      )

      if (!result.ok) {
        return result.reason === 'parent_invalid'
          ? fail(c, 'validation_failed', 400, ['parentId'])
          : fail(c, 'not_found', 404)
      }
      return c.json({ id: result.id, floor: result.floor }, 201)
    },
  )

  /**
   * 删楼。搬家自 `/kourindou/posts/:id`。
   *
   * 先过主题的闸门再判归属：否则可以对一条被下架资源的评论区继续做写操作。
   * staff 删他人楼层要留痕并可能记违规——那是 T4 的事，这里保持 M3 的语义不变。
   */
  .delete('/posts/:id', requireAuth, entityIdParam, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)

    const row = await findPost(c.req.param('id'))
    if (!row) return fail(c, 'not_found', 404)

    const t = await loadVisibleTopic(row.topicId)
    if (!t) return fail(c, 'not_found', 404)

    if (!isOwnerOrStaff(actor, row.authorId)) return fail(c, 'forbidden', 403)

    await softDeletePost(row.id)
    return c.json({ deleted: true })
  })
