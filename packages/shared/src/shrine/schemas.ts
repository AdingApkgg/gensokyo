import { z } from 'zod'
import { entityIdSchema, handleSchema } from '../ids'
import { REPORT_REASON } from '../kourindou/enums'
import { LOCALES } from '../localized'
import { paginationQuerySchema } from '../pagination'
import { BOARD_SLUGS } from './enums'

// ---------- 楼层 ----------

/**
 * 发楼层。从 kourindou/schemas.ts 迁来，加了两样：
 *
 * - `.trim()`：原版没有，于是「   」是一条合法的 20000 字以内的帖子。
 *   trim 之后再判 min(1)，纯空白就被挡在 400
 * - `locale`：只用于渲染时的 `<div lang=>`。日文帖被按中文字形渲染是
 *   一个今天就存在的显示错误（同一个码位在 zh/ja 字体下字形不同）
 */
export const createPostSchema = z.object({
  bodyMd: z.string().trim().min(1).max(20000),
  parentId: entityIdSchema.optional(),
  locale: z.enum(LOCALES).optional(),
})
export type CreatePost = z.infer<typeof createPostSchema>

/**
 * 编辑楼层。**只有作者本人能调**（staff 也不行），所以这里不含任何治理字段。
 * 不设时间窗：改自己说过的话不需要理由，而「已编辑」标记已经提供了透明度。
 */
export const updatePostSchema = z.object({
  bodyMd: z.string().trim().min(1).max(20000),
  locale: z.enum(LOCALES).optional(),
})

/**
 * 删楼。作者删自己的不需要理由；**staff 删他人的必须给**，
 * 因为理由同时是三样东西：审计记录的可过滤类别、申诉时的依据、
 * 以及要不要给作者记违规的判据（spam/harassment/illegal/copyright 会 +1）。
 */
export const deletePostSchema = z.object({
  reason: z.enum(REPORT_REASON).optional(),
  note: z.string().max(1000).optional(),
})

// ---------- 主题 ----------

/**
 * 发主题。主题正文就是 floor 1 的 post——不给主题单独开一张正文表，
 * 否则「编辑主题正文」和「编辑 1 楼」会变成两条代码路径。
 */
export const createTopicSchema = z.object({
  boardSlug: z.enum(BOARD_SLUGS),
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().trim().min(1).max(20000),
  locale: z.enum(LOCALES).optional(),
})
export type CreateTopic = z.infer<typeof createTopicSchema>

/**
 * 主题列表。沿用 offset 分页——首月全站主题数不足一页，
 * 游标分页要解决的「翻页期间重排」需要有第二页才会发生。
 */
export const listTopicsQuerySchema = paginationQuerySchema.extend({
  board: z.enum(BOARD_SLUGS).optional(),
})
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>

/**
 * 楼层列表。用**楼层区间**而不是 page——`?floor=137` 的深链要稳定，
 * 而 page 会随「前面有几层被删」漂移。服务端把 from 吸附到页边界并回显。
 */
export const listPostsQuerySchema = z.object({
  from: z.coerce.number().int().min(1).optional(),
})
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>

// ---------- 通知 ----------

/**
 * 标记已读。用 `z.object` + XOR refine，**不用 `z.union`**：
 * union 在 `{ids, upTo}` 同时给出时会静默走第一分支并把 upTo 剥掉，
 * 于是「全部已读」变成「只读了这几条」而前端毫不知情。
 *
 * 「全部已读」走 **通知 id 游标**（`upTo`），不走时间戳：
 * - created_at 在 PG 里是微秒精度，`toISOString()` 截到毫秒；客户端把列表里
 *   最新一条的时间原样送回来，`created_at <= before` 在 DB 侧比的是
 *   `.010096 <= .010000` → false，**最新那条永远标不掉**，铃铛卡在 ≥1。
 * - PG 的 `now()` 是事务起点：扇出事务在用户点击前 start、点击后 commit，
 *   那条通知的时间早于点击，用户没看到就被标成已读——正是游标要防的情形。
 * 用 (created_at, id) 的 row-value 比较，两个问题一起消失，且不依赖客户端时钟。
 */
export const markReadSchema = z
  .object({
    ids: z.array(entityIdSchema).min(1).max(200).optional(),
    /** 收件箱里看到的最新一条的 id：它及它之前的全部标已读 */
    upTo: entityIdSchema.optional(),
  })
  .refine((v) => (v.ids === undefined) !== (v.upTo === undefined), {
    message: 'ids 与 upTo 必须且只能给一个',
  })
export type MarkRead = z.infer<typeof markReadSchema>

// ---------- 身份 ----------

/**
 * 认领 handle。注册走客户端 authClient.signUp.email，**API 看不到注册**，
 * 所以 handle 由 sessionMiddleware 在惰性建档时从 user.id 派生，
 * 用户自选的值经这个端点覆盖一次。服务端只在 handle_set_at IS NULL 时接受。
 */
export const setHandleSchema = z.object({ handle: handleSchema })
