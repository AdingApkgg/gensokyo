import { db, schema } from '@gensokyo/db'
import { createPostSchema, paginationQuerySchema } from '@gensokyo/shared'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { fail } from '../../errors'
import { isOwnerOrStaff, requireAuth } from '../../middleware/require'
import type { AppEnv } from '../../middleware/session'
import {
  createPost,
  findPost,
  listPosts,
  softDeletePost,
  topicForResource,
} from './post'

const { resource } = schema

/** 评论区只对已发布的资源开放 */
async function publishedTopic(slug: string) {
  const [row] = await db
    .select({ id: resource.id })
    .from(resource)
    .where(
      and(
        eq(resource.slug, slug),
        eq(resource.status, 'published'),
        isNull(resource.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null
  return topicForResource(row.id)
}

/**
 * 资源评论 = 论坛楼层，同一份数据两个视图。
 * M4 博丽神社会在这之上加 /shrine/topics/:id/posts，复用 content/post.ts。
 */
export const content = new Hono<AppEnv>()
  .get(
    '/resources/:slug/posts',
    zValidator('query', paginationQuerySchema),
    async (c) => {
      const t = await publishedTopic(c.req.param('slug'))
      if (!t) return fail(c, 'not_found', 404)
      const { page, pageSize } = c.req.valid('query')
      return c.json({ posts: await listPosts(t.id, page, pageSize) })
    },
  )

  .post(
    '/resources/:slug/posts',
    requireAuth,
    zValidator('json', createPostSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const t = await publishedTopic(c.req.param('slug'))
      if (!t) return fail(c, 'not_found', 404)

      const input = c.req.valid('json')
      const result = await createPost({
        topicId: t.id,
        authorId: actor.id,
        bodyMd: input.bodyMd,
        parentId: input.parentId,
      })

      if (!result.ok) {
        return result.reason === 'parent_invalid'
          ? fail(c, 'validation_failed', 400, ['parentId'])
          : fail(c, 'not_found', 404)
      }
      return c.json({ id: result.id, floor: result.floor }, 201)
    },
  )

  .delete('/posts/:id', requireAuth, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const row = await findPost(c.req.param('id'))
    if (!row) return fail(c, 'not_found', 404)
    if (!isOwnerOrStaff(actor, row.authorId)) return fail(c, 'forbidden', 403)

    await softDeletePost(row.id)
    return c.json({ deleted: true })
  })
