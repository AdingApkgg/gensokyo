import { db, schema } from '@gensokyo/db'
import {
  type BoardSlug,
  createPostSchema,
  createTopicSchema,
  deletePostSchema,
  extractMentions,
  handlePathSchema,
  listPostsQuerySchema,
  listTopicsQuerySchema,
  MAX_MENTIONS_PER_POST,
  paginationQuerySchema,
  STRIKE_REPORT_REASONS,
  type TopicListItem,
  type TopicWire,
  updatePostSchema,
} from '@gensokyo/shared'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { entityIdParam, fail, validate } from '../errors'
import { isOwnerOrStaff, isSelf, requireAuth } from '../middleware/require'
import type { Actor, AppEnv } from '../middleware/session'
import { notify, resolveMentions } from '../notify'
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

    // 投影按 shared 契约收口：boardSlug 在 DB 里是 varchar，CHECK 保证了取值集
    const list: TopicListItem[] = items.map((r) => ({
      id: r.id,
      kind: r.kind,
      boardSlug: r.boardSlug as BoardSlug | null,
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
    }))
    return c.json({
      items: list,
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
      // @ 解析在事务外：扇出的 SELECT 不进事务（notify 的约定）
      const mentionUserIds = await resolveMentions(
        extractMentions(input.bodyMd),
      )

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
          mentionUserIds,
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
    // 跨线用 ISO 串（TopicWire），web 侧靠 hc 推导即可，不必手写类型
    const topicWire: TopicWire = {
      ...t,
      pinnedAt: t.pinnedAt?.toISOString() ?? null,
      lastPostAt: t.lastPostAt.toISOString(),
    }
    return c.json({ topic: topicWire, ...opening })
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
      /**
       * 删一层要通知作者，删整条主题（连所有回复一起下掉）更要。
       * 不加 topic_deleted 这个 kind：主题的 1 楼就是主题正文，post_deleted
       * 带 floor 1 足够前端区分；主题软删后 subject 渲染成 removed。
       */
      if (t.authorId) {
        const [opening] = await tx
          .select({ id: post.id })
          .from(post)
          .where(and(eq(post.topicId, t.id), eq(post.floor, 1)))
          .limit(1)
        await notify(tx, [
          {
            userId: t.authorId,
            kind: 'post_deleted',
            actorId: actor.id,
            topicId: t.id,
            postId: opening?.id ?? null,
            payload: { reason, floor: 1, topicTitle: t.title },
          },
        ])
      }
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
      const mentionUserIds = await resolveMentions(
        extractMentions(input.bodyMd),
      )

      const result = await db.transaction((tx) =>
        createPost(tx, t, { authorId: actor.id, ...input, mentionUserIds }),
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
   * **编辑不触发通知**（取舍）：编辑时新加的 @ 不会送达。要送就得 diff 新旧
   * 提及、再查一次已发过的 mention 行去重——为一个「发完才想起 @」的场景，
   * 代价是每次编辑多两次查询和一条可被反复触发的通知路径。先不做；
   * web 的编辑框要提示这一点。
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
        // locale 不传就不动：否则任何一次编辑都把创建时写的语言清成 NULL
        .set({
          bodyMd: input.bodyMd,
          ...(input.locale ? { locale: input.locale } : {}),
        })
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
      // 被删的人要知道：申诉的前提是先收到通知
      if (row.authorId) {
        await notify(tx, [
          {
            userId: row.authorId,
            kind: 'post_deleted',
            actorId: actor.id,
            topicId: t.id,
            postId: row.id,
            // 只带枚举理由。note 是版主写给审计日志的内部备注，UI 文案就是这么提示的，
            // 不能原样投递给被处置的人
            payload: { reason, floor: row.floor, topicTitle: t.title },
          },
        ])
      }
      return true
    })

    // 已经删过了：幂等地成功，但这一次不留痕、不记违规
    return c.json({ deleted: done })
  })

// softDeletePost 保留给 dash 的删楼按钮复用
export { softDeletePost }

/**
 * 个人主页（/u/:handle）——**必须过闸门**（P0-1）。
 *
 * 触发序列全是正常运营动作：资源被版权下架 → /shrine 与 /kourindou 都看不到了
 * → 但 /u/A、/u/B 仍公开列出「在《R 的标题》的 #2 楼」。一份因版权被下架的资源，
 * 标题、讨论内容、讨论者名单仍可被任何人经任一参与者主页枚举。
 * 所以这里 INNER JOIN topic + LEFT JOIN resource，用**同一个** visibleTopicWhere()
 * 加 post.deleted_at IS NULL。只有「帖子」一个列表，不给 counts。
 *
 * handle 形状不对 → 404 而不是 400：挡路径会让保留字的存在从 URL 上被探测出来。
 */
export const profiles = new Hono<AppEnv>().get(
  '/:handle',
  validate('query', paginationQuerySchema),
  async (c) => {
    const parsed = handlePathSchema.safeParse(c.req.param('handle'))
    if (!parsed.success) return fail(c, 'not_found', 404)
    const { page, pageSize } = c.req.valid('query')

    const [who] = await db
      .select({
        id: user.id,
        name: user.name,
        handle: userProfile.handle,
        createdAt: userProfile.createdAt,
      })
      .from(userProfile)
      .innerJoin(user, eq(user.id, userProfile.userId))
      .where(eq(userProfile.handle, parsed.data))
      .limit(1)
    if (!who) return fail(c, 'not_found', 404)

    const where = and(
      eq(post.authorId, who.id),
      isNull(post.deletedAt),
      visibleTopicWhere(),
    )
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: post.id,
          floor: post.floor,
          bodyMd: post.bodyMd,
          createdAt: post.createdAt,
          topicId: topic.id,
          topicKind: topic.kind,
          topicTitle: topic.title,
          boardSlug: topic.boardSlug,
          resourceSlug: resource.slug,
          resourceTitleOriginal: resource.titleOriginal,
          resourceTitleOriginalLocale: resource.titleOriginalLocale,
          resourceTitle: resource.title,
          resourceCoverUrl: resource.coverUrl,
        })
        .from(post)
        .innerJoin(topic, eq(topic.id, post.topicId))
        .leftJoin(resource, eq(resource.id, topic.resourceId))
        .where(where)
        .orderBy(desc(post.createdAt), desc(post.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ n: count() })
        .from(post)
        .innerJoin(topic, eq(topic.id, post.topicId))
        .leftJoin(resource, eq(resource.id, topic.resourceId))
        .where(where),
    ])

    return c.json({
      user: {
        id: who.id,
        name: who.name,
        handle: who.handle,
        createdAt: who.createdAt.toISOString(),
      },
      posts: rows.map((r) => ({
        id: r.id,
        floor: r.floor,
        // 摘要用码点切，别把 emoji 切成半个
        excerpt: [...r.bodyMd].slice(0, 200).join(''),
        createdAt: r.createdAt.toISOString(),
        topic: {
          id: r.topicId,
          kind: r.topicKind,
          title: r.topicTitle,
          boardSlug: r.boardSlug as BoardSlug | null,
          resource: r.resourceSlug
            ? {
                slug: r.resourceSlug,
                titleOriginal: r.resourceTitleOriginal as string,
                titleOriginalLocale: r.resourceTitleOriginalLocale as string,
                title: r.resourceTitle,
                coverUrl: r.resourceCoverUrl,
              }
            : null,
        },
      })),
      page,
      pageSize,
      total: total?.n ?? 0,
    })
  },
)
