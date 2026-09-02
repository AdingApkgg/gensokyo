import { db, schema } from '@gensokyo/db'
import {
  type Locale,
  POSTS_PAGE_SIZE,
  type PostView,
  type TopicView,
} from '@gensokyo/shared'
import { aliasedTable, and, asc, between, eq, sql } from 'drizzle-orm'
import { type NotificationDraft, notify } from '../../notify'

const { topic, post, user, userProfile } = schema

/**
 * 楼层的读写。
 *
 * 设计上就有两个调用方：香霖堂的资源评论区与博丽神社的版块帖。
 * M4 起两边共用的不只是这段代码，还有同一道可见性闸门——
 * 所有函数都收 `TopicView` 而不是裸 `topicId`，
 * 让「没过闸就拿不到参数」成为**编译期事实**而不是纪律。
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// 被引用的楼层要再 join 一次 post/user，用别名区分
const parent = aliasedTable(post, 'parent_post')
const parentAuthor = aliasedTable(user, 'parent_author')
const parentProfile = aliasedTable(userProfile, 'parent_profile')

const row = {
  id: post.id,
  floor: post.floor,
  bodyMd: post.bodyMd,
  locale: post.locale,
  deletedAt: post.deletedAt,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  authorId: post.authorId,
  authorName: user.name,
  authorHandle: userProfile.handle,
  parentId: post.parentId,
  parentFloor: parent.floor,
  parentBody: parent.bodyMd,
  parentDeletedAt: parent.deletedAt,
  parentAuthorId: parent.authorId,
  parentAuthorName: parentAuthor.name,
  parentAuthorHandle: parentProfile.handle,
}

/** 截断按码点而非 UTF-16 码元，否则会把 emoji 与部分汉字切成半个 */
const excerpt = (s: string, n = 100) => [...s].slice(0, n).join('')

/**
 * 行 → 响应契约。**唯一的投影实现**，路由层不许自己拼。
 *
 * 两条硬约束在这里兑现，它们的注释在 types.ts 里，而注释拦不住下一个人：
 * ① 软删的楼层保留占位、正文置空——楼层号不出洞、引用不断
 * ② 被引用的楼层若已删，摘要**在服务端置空**。RR8 的 SSR 会把整个 loader
 *    返回值序列化进 HTML，不置空的话一条被版主删掉的骚扰内容会以明文
 *    出现在每一个引用了它的页面源码里
 */
export function toPostView(r: Record<string, unknown>): PostView {
  const deleted = r.deletedAt !== null
  const parentDeleted = r.parentDeletedAt !== null
  return {
    id: r.id as string,
    floor: r.floor as number,
    bodyMd: deleted ? '' : (r.bodyMd as string),
    deleted,
    locale: (r.locale ?? null) as Locale | null,
    /**
     * handle 缺失 → 整个 author 置 null。**不用 `?? ''` 兜**：
     * PostAuthor 的契约就写着这一条，空 handle 会让 web 拼出 `/u/`——
     * 那是另一个路由，产出一条没有任何编译期或运行期信号的死链。
     * authorId 可为 null（onDelete set null），所以不能换成 innerJoin。
     */
    author:
      r.authorId && r.authorHandle
        ? {
            id: r.authorId as string,
            name: (r.authorName ?? '') as string,
            handle: r.authorHandle as string,
          }
        : null,
    quoted:
      r.parentId === null
        ? null
        : {
            id: r.parentId as string,
            floor: r.parentFloor as number,
            author:
              r.parentAuthorId && r.parentAuthorHandle
                ? {
                    id: r.parentAuthorId as string,
                    name: (r.parentAuthorName ?? '') as string,
                    handle: r.parentAuthorHandle as string,
                  }
                : null,
            excerpt: parentDeleted ? '' : excerpt(r.parentBody as string),
            deleted: parentDeleted,
          },
    createdAt: (r.createdAt as Date).toISOString(),
    updatedAt: (r.updatedAt as Date).toISOString(),
  }
}

export type PostPage = {
  posts: PostView[]
  /** 服务端把请求的起点吸附到页边界后的实际起点，回显给前端 */
  from: number
  pageSize: number
  /** 楼层总数（含软删的占位），= topic.floorSeq */
  total: number
}

/**
 * 按**楼层区间**取，不用 offset 分页。
 *
 * `?floor=137` 的深链要稳定，而 page 会随「前面有几层被删」漂移——
 * 软删保留占位所以其实不会漂，但恢复/硬删任一出现就会，
 * 而楼层号是我们自己发出去的锚点，用它做区间是唯一不会错位的方式。
 */
export async function listPosts(
  t: TopicView,
  fromFloor?: number,
): Promise<PostPage> {
  // 吸附到页边界：客户端传第 137 楼，返回的是含它的那一页
  // 越界的 from 吸附到最后一页：?floor=99999 不该渲染成「没有楼层」而实际有 58 层
  const ceiling = Math.max(1, t.floorSeq)
  const raw = Math.min(fromFloor && fromFloor > 0 ? fromFloor : 1, ceiling)
  const from = Math.floor((raw - 1) / POSTS_PAGE_SIZE) * POSTS_PAGE_SIZE + 1

  const rows = await db
    .select(row)
    .from(post)
    .leftJoin(user, eq(user.id, post.authorId))
    .leftJoin(userProfile, eq(userProfile.userId, post.authorId))
    .leftJoin(parent, eq(parent.id, post.parentId))
    .leftJoin(parentAuthor, eq(parentAuthor.id, parent.authorId))
    .leftJoin(parentProfile, eq(parentProfile.userId, parent.authorId))
    .where(
      and(
        eq(post.topicId, t.id),
        between(post.floor, from, from + POSTS_PAGE_SIZE - 1),
      ),
    )
    .orderBy(asc(post.floor))

  return {
    posts: rows.map(toPostView),
    from,
    pageSize: POSTS_PAGE_SIZE,
    total: t.floorSeq,
  }
}

export type CreatePostResult =
  | { ok: true; id: string; floor: number }
  | { ok: false; reason: 'topic_missing' | 'parent_invalid' }

/**
 * 发一层。
 *
 * **收 `tx` 是硬要求**：建主题与建 1 楼必须在同一个事务里，否则会产生
 * 「没有主楼的主题」。调用方自己开事务，这里只参与。
 */
export async function createPost(
  tx: Tx,
  t: TopicView,
  input: {
    authorId: string
    bodyMd: string
    parentId?: string
    locale?: Locale
    /**
     * 正文里 @ 到的 userId。**由调用方在事务外解析好**（notify.ts 的
     * resolveMentions）——扇出的 SELECT 不进事务，这是 notify 的约定。
     */
    mentionUserIds?: readonly string[]
  },
): Promise<CreatePostResult> {
  let parentAuthorId: string | null = null
  if (input.parentId) {
    /**
     * `eq(post.topicId, t.id)` **必须保留**：它是 QuotedPost 不需要自己那道
     * 可见性检查的全部理由。删了的话引用块就能跨主题泄漏——
     * 引用一条不可见主题里的楼层，摘要会照常渲染出来。
     */
    const [p] = await tx
      .select({ id: post.id, authorId: post.authorId })
      .from(post)
      .where(and(eq(post.id, input.parentId), eq(post.topicId, t.id)))
      .limit(1)
    if (!p) return { ok: false, reason: 'parent_invalid' }
    parentAuthorId = p.authorId
  }

  /**
   * 楼层号来自对 topic 行的原子自增：UPDATE 持有行锁，
   * 并发发帖因此被串行化，不会读到同一个 floorSeq。
   * post_topic_floor_uq 是最后一道兜底。
   *
   * 这里**不再检查 deletedAt**——闸门已经在 loadVisibleTopic 里过了，
   * 拿得到 TopicView 就说明这条主题当时可见。
   */
  const [updated] = await tx
    .update(topic)
    .set({ floorSeq: sql`${topic.floorSeq} + 1`, lastPostAt: new Date() })
    .where(eq(topic.id, t.id))
    .returning({ floor: topic.floorSeq })

  if (!updated) return { ok: false, reason: 'topic_missing' }

  const [created] = await tx
    .insert(post)
    .values({
      topicId: t.id,
      authorId: input.authorId,
      parentId: input.parentId,
      floor: updated.floor,
      bodyMd: input.bodyMd,
      locale: input.locale,
    })
    .returning({ id: post.id })
  const id = created?.id as string

  /**
   * 通知扇出。收件人从 topic.authorId 与父楼作者推出——M4 没有订阅表，
   * 一次回复产生 ≤2 行 reply，外加被 @ 的人。自己不通知自己、
   * 同一人同时被回复与被 @ 只留 mention，都在 notify 里处理。
   * 主楼（floor 1）没有人可回复：它自己就是主题。
   */
  const drafts: NotificationDraft[] = []
  const base = { actorId: input.authorId, topicId: t.id, postId: id }
  /**
   * 「主楼不算回复」**只对版块主题成立**：资源主题没有主楼，floorSeq 从 0 起，
   * 评论区的 floor 1 就是第一条真实评论——而那恰恰是最该送达投稿者的一条。
   * 写成 `floor > 1` 会让每个只被评论过一次的资源的投稿者完全不知道有人评论了。
   */
  const opening = t.kind === 'board' && updated.floor === 1
  if (!opening && t.authorId) {
    drafts.push({ ...base, userId: t.authorId, kind: 'reply' })
  }
  if (parentAuthorId && parentAuthorId !== t.authorId) {
    drafts.push({ ...base, userId: parentAuthorId, kind: 'reply' })
  }
  for (const uid of input.mentionUserIds ?? []) {
    drafts.push({ ...base, userId: uid, kind: 'mention' })
  }
  await notify(tx, drafts)

  return { ok: true, id, floor: updated.floor }
}

/** 软删：保留楼层占位，不打断楼层号与引用 */
export async function softDeletePost(id: string) {
  await db.update(post).set({ deletedAt: new Date() }).where(eq(post.id, id))
}

/**
 * 取一条楼层**及其所属主题的可见性上下文**。
 *
 * 只返回 post 行是不够的：删楼、编辑楼都要先确认那条主题现在可见，
 * 否则可以对一条被下架资源的评论区继续写操作。
 */
export async function findPost(id: string) {
  const [r] = await db
    .select({
      id: post.id,
      authorId: post.authorId,
      topicId: post.topicId,
      floor: post.floor,
      deletedAt: post.deletedAt,
    })
    .from(post)
    .where(eq(post.id, id))
    .limit(1)
  return r
}
