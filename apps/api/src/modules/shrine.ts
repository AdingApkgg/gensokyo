import { db, schema } from '@gensokyo/db'
import {
  createPostSchema,
  createTopicSchema,
  deletePostSchema,
  extractMentions,
  listPostsQuerySchema,
  listTopicsQuerySchema,
  MAX_MENTIONS_PER_POST,
  STRIKE_REPORT_REASONS,
  updatePostSchema,
} from '@gensokyo/shared'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { entityIdParam, fail, validate } from '../errors'
import { isOwnerOrStaff, isSelf, requireAuth } from '../middleware/require'
import type { Actor, AppEnv } from '../middleware/session'
import { assertRate, type Bucket, canPostLinks, hasExternalLink } from '../rate'
import { linkTrustThreshold } from '../site-config'
import { createPost, findPost, listPosts, softDeletePost } from './content/post'
import {
  loadTopicForModeration,
  loadVisibleTopic,
  visibleTopicWhere,
} from './content/visibility'

const { topic, post, resource, user, userProfile, moderationLog } = schema

/**
 * 写操作前的三道闸：频率、外链、@ 上限。
 *
 * 返回判定结果而不是 Response——由路由层去 fail()。
 * 让它返回 Response 会把 Hono 的 Context 类型牵进来，而这个文件里
 * Context 的类型又依赖下面的 `shrine`，形成循环引用。
 */
type Guard = null | {
  code: 'rate_limited' | 'link_not_allowed' | 'mention_limit_exceeded'
  status: 429 | 403 | 400
  retryAfterSeconds?: number
}

/**
 * @param texts **所有要过闸的文本片段**，不是单个正文。
 *
 *   上一版只收 bodyMd，于是 `POST /topics` 的 title 一道闸都不过——而标题
 *   恰恰是全站曝光最高的字段：它进最新流、版块页、通知、举报队列的每一行。
 *   正文被拦住而标题放行，等于把广告位从帖子里挪到首页。限流仍然只按**动作**
 *   算一次，外链与 @ 上限对每一片各跑一遍。
 *
 * @param bucket 编辑传 `'edit'`：限流管的是**造内容的量**，不该管改错别字，
 *   所以编辑不占发帖配额。但它有自己的桶而不是没有桶——见 rate.ts。
 *   外链与 @ 上限在编辑时**照常生效**，否则可以先发干净的、再编辑塞进链接。
 */
async function guardWrite(
  actor: Actor,
  texts: readonly string[],
  bucket: Bucket = 'post',
): Promise<Guard> {
  const rate = await assertRate(actor, bucket)
  if (!rate.ok) {
    return {
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: rate.retryAfterSeconds,
    }
  }

  const threshold = await linkTrustThreshold()
  for (const text of texts) {
    if (hasExternalLink(text) && !canPostLinks(actor, threshold)) {
      return { code: 'link_not_allowed', status: 403 }
    }
    if (extractMentions(text).length > MAX_MENTIONS_PER_POST) {
      return { code: 'mention_limit_exceeded', status: 400 }
    }
  }
  return null
}

/**
 * 限流拒绝时把等待时长带出去。
 *
 * 少了它，「等 15 秒」和「等一小时」在界面上是同一句话，用户会在小时配额
 * 耗尽后反复重试——而 assertRate 本来就把两者算得清清楚楚。
 */
function blocked(c: Context<AppEnv>, g: NonNullable<Guard>) {
  if (g.retryAfterSeconds !== undefined) {
    c.header('Retry-After', String(g.retryAfterSeconds))
  }
  return fail(c, g.code, g.status)
}

/**
 * 博丽神社。**楼层的唯一入口**——资源评论区与版块帖是同一份数据、同一组路由。
 * 同一张表两个写入口 = 两份可见性判断 = 必然漂移。
 */
export const shrine = new Hono<AppEnv>()
  // ------------------------------------------------------------ 主题列表
  .get('/topics', validate('query', listTopicsQuerySchema), async (c) => {
    const q = c.req.valid('query')
    const where = q.board
      ? and(visibleTopicWhere(), eq(topic.boardSlug, q.board))
      : visibleTopicWhere()

    /**
     * replyCount **真数未删楼层**，不能用 floorSeq 推——那是只增不减的序列、
     * 含被软删的占位，会让列表写「12 条回复」而点进去只有 8 条。
     *
     * 「版块主题不算 1 楼」这条也写进谓词，**不在 JS 里事后减 1**。
     * 减法的前提是「1 楼一定在计数里」，而这个计数已经排除了软删楼层——
     * 1 楼被删掉之后再减一次，就把一条真实回复也减没了。同一个错位的镜像版本。
     */
    const replyCount = sql<number>`(
      select count(*)::int from ${post}
      where ${post.topicId} = ${topic.id} and ${post.deletedAt} is null
        and (${topic.kind} = 'resource' or ${post.floor} > 1)
    )`

    const [items, [total]] = await Promise.all([
      db
        .select({
          id: topic.id,
          kind: topic.kind,
          boardSlug: topic.boardSlug,
          title: topic.title,
          pinnedAt: topic.pinnedAt,
          lastPostAt: topic.lastPostAt,
          createdAt: topic.createdAt,
          authorId: topic.authorId,
          authorName: user.name,
          authorHandle: userProfile.handle,
          replyCount,
          // 资源主题：**原样返回三语束**，服务端不知道请求者要哪种语言
          resourceSlug: resource.slug,
          resourceTitleOriginal: resource.titleOriginal,
          resourceTitleOriginalLocale: resource.titleOriginalLocale,
          resourceTitle: resource.title,
          resourceCoverUrl: resource.coverUrl,
        })
        .from(topic)
        .leftJoin(resource, eq(resource.id, topic.resourceId))
        .leftJoin(user, eq(user.id, topic.authorId))
        .leftJoin(userProfile, eq(userProfile.userId, topic.authorId))
        .where(where)
        /**
         * 置顶进排序键，不抽出流外——抽出去会让 total 与分页对不上。
         *
         * 末尾的 `id desc` 是**唯一性兜底**，不是装饰：前两列不构成全序，
         * 并列时 PG 每次执行可以给出不同的行顺序，于是 offset 分页会让同一条
         * 主题在第 1、2 页各出现一次而另一条谁也看不到。六篇引导帖正是并列的
         * 高危场景——一条 `UPDATE ... SET pinned_at = now()` 给六行相同的
         * 事务时间戳。加上它，seed 就不必再遵守「必须给不同时间戳」这条隐性纪律。
         */
        .orderBy(
          sql`${topic.pinnedAt} desc nulls last`,
          desc(topic.lastPostAt),
          desc(topic.id),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db
        .select({ n: count() })
        .from(topic)
        .leftJoin(resource, eq(resource.id, topic.resourceId))
        .where(where),
    ])

    return c.json({
      items: items.map((r) => ({
        id: r.id,
        kind: r.kind,
        boardSlug: r.boardSlug,
        title: r.title,
        resource: r.resourceSlug
          ? {
              slug: r.resourceSlug,
              titleOriginal: r.resourceTitleOriginal as string,
              titleOriginalLocale: r.resourceTitleOriginalLocale as string,
              title: r.resourceTitle,
              coverUrl: r.resourceCoverUrl,
            }
          : null,
        /**
         * handle 缺失时整个 author 置 null，**不用 `?? ''` 兜**——
         * PostAuthor 的契约就写着这一条：空 handle 会让 web 拼出 `/u/`，
         * 那是另一个路由，产出的是一条没有任何信号的死链。
         * authorId 可为 null（onDelete set null），所以不能简单换成 innerJoin。
         */
        author:
          r.authorId && r.authorHandle
            ? {
                id: r.authorId,
                name: r.authorName ?? '',
                handle: r.authorHandle,
              }
            : null,
        replyCount: r.replyCount,
        pinned: r.pinnedAt !== null,
        lastPostAt: r.lastPostAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total: total?.n ?? 0,
    })
  })

  // ------------------------------------------------------------ 发主题
  .post(
    '/topics',
    requireAuth,
    validate('json', createTopicSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const input = c.req.valid('json')

      // 标题与正文都过闸；限流仍只按这一次发帖算一次
      const g = await guardWrite(actor, [input.title, input.bodyMd])
      if (g) return blocked(c, g)

      /**
       * 主题与 1 楼必须同事务：分开写会产生「没有主楼的主题」，
       * 而那种行没有任何界面能修复它。
       */
      const created = await db.transaction(async (tx) => {
        const [t] = await tx
          .insert(topic)
          .values({
            kind: 'board',
            boardSlug: input.boardSlug,
            title: input.title,
            authorId: actor.id,
            lastPostAt: new Date(),
          })
          .returning()
        if (!t) throw new Error('insert topic failed')

        const view = {
          id: t.id,
          kind: t.kind,
          resourceId: null,
          resourceSlug: null,
          boardSlug: input.boardSlug,
          title: t.title,
          authorId: t.authorId,
          floorSeq: t.floorSeq,
          pinnedAt: t.pinnedAt,
          lastPostAt: t.lastPostAt,
        }
        const r = await createPost(tx, view, {
          authorId: actor.id,
          bodyMd: input.bodyMd,
          locale: input.locale,
        })
        if (!r.ok) throw new Error(`opening post failed: ${r.reason}`)
        return { id: t.id, postId: r.id }
      })

      return c.json(created, 201)
    },
  )

  // ------------------------------------------------------------ 主题详情
  .get('/topics/:id', entityIdParam, async (c) => {
    const t = await loadVisibleTopic(c.req.param('id'))
    if (!t) return fail(c, 'not_found', 404)
    // 必须带上主楼：详情页首屏不该再发一次请求
    const opening = await listPosts(t, 1)
    return c.json({ topic: t, ...opening })
  })

  // ------------------------------------------------------------ 删主题
  .delete('/topics/:id', requireAuth, entityIdParam, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)

    const t = await loadVisibleTopic(c.req.param('id'))
    if (!t) return fail(c, 'not_found', 404)

    /**
     * 资源主题一律拒绝，权限判断表达在 `resourceId` 上而不是 handler 里一句 if。
     *
     * 资源主题的 authorId 就是投稿者，而「无他人回复」在零评论时恒成立——
     * 于是投稿者可以在收到差评前把自己资源的评论区永久摧毁，之后没有任何
     * 路径能恢复（topic.resourceId 有唯一约束，补插撞约束）。
     * 动机不是误操作是**审查规避**。
     * 「不让讨论继续」的正确动作是下架资源：可逆、留痕、通知作者。
     */
    if (t.resourceId !== null) return fail(c, 'invalid_state_transition', 409)

    const [others] = await db
      .select({ n: count() })
      .from(post)
      .where(
        and(
          eq(post.topicId, t.id),
          isNull(post.deletedAt),
          sql`${post.authorId} is distinct from ${actor.id}`,
        ),
      )
    const hasOthers = (others?.n ?? 0) > 0
    const own = isSelf(actor, t.authorId)
    const staff = actor.role === 'moderator' || actor.role === 'admin'
    if (!staff && !(own && !hasOthers)) {
      return fail(c, 'forbidden', 403)
    }

    /**
     * staff 删他人的主题**必须留痕**，与删楼同一套规矩。
     *
     * 少了它就成了「删一层要给理由、写审计、可申诉，删两百层反而不用」——
     * 而主题一软删，visibleTopicWhere 会把整条讨论（包括其他所有人的楼层）
     * 从全站流、/u/:handle、资源页一并隐掉，影响面比删单层大一个数量级。
     * 作者删自己的（无他人回复）仍然不需要理由、不留痕，也与删楼一致。
     */
    const parsed = deletePostSchema.safeParse(
      await c.req.json().catch(() => ({})),
    )
    if (!parsed.success) return fail(c, 'validation_failed', 400)
    const { reason, note } = parsed.data
    if (!own && !reason) return fail(c, 'validation_failed', 400, ['reason'])

    await db.transaction(async (tx) => {
      await tx
        .update(topic)
        .set({ deletedAt: new Date() })
        .where(eq(topic.id, t.id))

      if (own) return
      await tx.insert(moderationLog).values({
        actorId: actor.id,
        action: 'soft_delete',
        subjectKind: 'topic',
        subjectId: t.id,
        toValue: { reason },
        reason: note ?? reason,
      })
    })
    return c.json({ deleted: true })
  })

  // ------------------------------------------------------------ 楼层
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
      const g = await guardWrite(actor, [input.bodyMd])
      if (g) return blocked(c, g)

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
   * 编辑楼层。**仅作者本人**——staff 也不行。
   *
   * staff 可以「删」他人的东西（留痕、可申诉），但不能「改」他人的话：
   * 改完之后没有痕迹说明原文是什么，作者也无从申诉。
   */
  .patch(
    '/posts/:id',
    requireAuth,
    entityIdParam,
    validate('json', updatePostSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)

      const row = await findPost(c.req.param('id'))
      if (!row || row.deletedAt !== null) return fail(c, 'not_found', 404)
      if (!(await loadVisibleTopic(row.topicId)))
        return fail(c, 'not_found', 404)
      if (!isSelf(actor, row.authorId)) return fail(c, 'forbidden', 403)

      const input = c.req.valid('json')
      const g = await guardWrite(actor, [input.bodyMd], 'edit')
      if (g) return blocked(c, g)

      await db
        .update(post)
        .set({ bodyMd: input.bodyMd, locale: input.locale })
        .where(eq(post.id, row.id))
      return c.json({ updated: true })
    },
  )

  /**
   * 删楼。作者删自己的不需要理由；**staff 删他人的必须给**——
   * 理由同时是三样东西：审计的可过滤类别、申诉的依据、以及要不要记违规的判据。
   */
  .delete('/posts/:id', requireAuth, entityIdParam, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)

    const row = await findPost(c.req.param('id'))
    if (!row) return fail(c, 'not_found', 404)
    if (!isOwnerOrStaff(actor, row.authorId)) return fail(c, 'forbidden', 403)

    const own = isSelf(actor, row.authorId)
    const staff = actor.role === 'moderator' || actor.role === 'admin'
    /**
     * 闸门按身份分：staff 走治理闸（只要行还在），其他人走可见性闸。
     * 用可见性闸鉴权 staff 的写路径会把治理锁死——见 loadTopicForModeration。
     */
    const t = staff
      ? await loadTopicForModeration(row.topicId)
      : await loadVisibleTopic(row.topicId)
    if (!t) return fail(c, 'not_found', 404)

    /**
     * 手动解析：作者删自己的楼不该被迫发一个空 body，
     * 而 `validate('json')` 在没有 body 时会 500。
     */
    const parsed = deletePostSchema.safeParse(
      await c.req.json().catch(() => ({})),
    )
    if (!parsed.success) return fail(c, 'validation_failed', 400)
    const { reason, note } = parsed.data
    if (!own && !reason) return fail(c, 'validation_failed', 400, ['reason'])

    const done = await db.transaction(async (tx) => {
      /**
       * **让 DB 回答「这次有没有真的删到」**，而不是先读后写。
       *
       * 少了 `deleted_at is null` 这半句，对同一条已软删的楼层再 DELETE 一次
       * 会重写 deletedAt（原始删除时刻被覆盖，审计时间线失真）、再写一条
       * moderationLog、再给作者 +1 违规。而 strikeCount 全仓**没有任何递减、
       * 清零或申诉路径**，`strikeCount > 0` 同时否掉发外链与即发即审——
       * 每一次误触都是永久的信任清零。触发面很现成：/dash/reports 上的
       * 「删除该楼层」按钮双击、两个版主处理同一条举报、或同一楼层被两条
       * 不同理由的举报各删一次。写成条件更新，并发双击也只会命中一次。
       */
      const [hit] = await tx
        .update(post)
        .set({ deletedAt: new Date() })
        .where(and(eq(post.id, row.id), isNull(post.deletedAt)))
        .returning({ id: post.id })
      if (!hit) return false

      /**
       * 回退 lastPostAt。删掉最后一条回复却不回退，结果是「版主删掉一条广告」
       * 之后广告没了、但它顶起来的主题继续钉在最新流最前面，且再也不会自己
       * 掉下去——只有下一条真回复才能更新它。主题一条楼层都不剩时回落到建帖时间。
       */
      await tx
        .update(topic)
        .set({
          lastPostAt: sql`coalesce((
            select max(${post.createdAt}) from ${post}
            where ${post.topicId} = ${topic.id} and ${post.deletedAt} is null
          ), ${topic.createdAt})`,
        })
        .where(eq(topic.id, t.id))

      if (own) return true
      await tx.insert(moderationLog).values({
        actorId: actor.id,
        // MODERATION_ACTION 一个值都不加：subjectKind 就是用来区分对象的
        action: 'soft_delete',
        subjectKind: 'post',
        subjectId: row.id,
        toValue: { reason },
        reason: note ?? reason,
      })

      /**
       * 违规计入信任梯度。四份设计文档都没发现这条链是断的：
       * 论坛灌水被删 20 层的账号，在香霖堂仍然「即发即审」。
       */
      if (row.authorId && reason && STRIKE_REPORT_REASONS.includes(reason)) {
        await tx
          .update(userProfile)
          .set({ strikeCount: sql`${userProfile.strikeCount} + 1` })
          .where(eq(userProfile.userId, row.authorId))
      }
      return true
    })

    // 已经删过了：幂等地成功，但这一次不留痕、不记违规
    return c.json({ deleted: done })
  })

// softDeletePost 保留给 dash 的删楼按钮复用
export { softDeletePost }
