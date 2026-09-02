import type { Locale, LocalizedText } from '../localized'
import type { BoardSlug, NotificationKind, TopicKind } from './enums'

/**
 * 响应契约类型。
 *
 * 它们和 zod 输入 schema 并列，同属「类型主轴」——**web 侧不许手写一份**。
 * 手写的那份会在第一次改投影时漂移，而 TS 不会报错（结构类型兼容），
 * 表现是前端渲染出 undefined 而没有任何编译期信号。
 *
 * api 侧由 content/post.ts 里唯一的 toPostView() 产生，路由层不许自己拼投影。
 */

export type PostAuthor = {
  id: string
  /** 显示名，完全自由，可含空格与任意语言 */
  name: string
  /**
   * 稳定标识，进 /u/:handle 与正文里的 @。
   *
   * ⚠️ **非空是一条不变量，不是一个事实**：handle 在 user_profile 上，
   * 而 user_profile 是 sessionMiddleware 惰性建的——种子脚本直接 insert(user)
   * 建出来的账号（如「编目机器人」）今天没有 profile 行。
   *
   * **T2 必须建立这条不变量**：迁移里给缺行的 user 补 profile，
   * 种子脚本建 user 时同步建 profile，然后投影用 INNER JOIN user_profile。
   * 缺行就该在测试里炸，而不是产出一个没有 handle 的 author 对象——
   * 那会让 web 渲染出 /u/undefined 的死链且没有任何编译期信号。
   * 也不要用 `?? ''` 兜：空 handle 会拼出 /u/ 这个另一个路由。
   */
  handle: string
}

/** 被引用的楼层。摘要**现查不快照**——一次软删就能让它从所有引用块里消失 */
export type QuotedPost = {
  id: string
  floor: number
  author: PostAuthor | null
  /**
   * 已被删除时**服务端置空**。
   * RR8 的 SSR 会把整个 loader 返回值序列化进 HTML——不置空的话，
   * 一条被版主删掉的骚扰内容会以明文出现在每一个引用了它的页面源码里。
   */
  excerpt: string
  deleted: boolean
}

export type PostView = {
  id: string
  floor: number
  /** 软删的楼层保留占位（楼层号不出洞、引用不断），正文为空串 */
  bodyMd: string
  deleted: boolean
  /** 只用于渲染时的 <div lang=>，不做筛选、不显示徽章 */
  locale: Locale | null
  author: PostAuthor | null
  quoted: QuotedPost | null
  /** ISO 串。跨线的类型一律用 string——c.json() 序列化后就是它 */
  createdAt: string
  /**
   * 「已编辑」的判据是 `!deleted && updatedAt > createdAt`，
   * **不能省掉 !deleted**：软删走的是 UPDATE，会触发 post.updatedAt 的
   * $onUpdate，于是每一条被删的楼层都会带上「已编辑」标记。
   */
  updatedAt: string
}

/** kind='resource' 的主题要显示的资源信息束 */
export type TopicResourceRef = {
  slug: string
  /**
   * **原样返回三语束，不在服务端选语言。**
   * api 不知道请求者要哪种语言（同一份数据三种视图），web 侧用
   * display.ts 的 displayTitle() 落地——这是全站既定分工。
   * 压成一个 string 的话，同一个资源会在 /kourindou 显示译名、
   * 在 /shrine 显示原文名，两个页面互相打脸。
   */
  titleOriginal: string
  titleOriginalLocale: string
  title: LocalizedText | null
  coverUrl: string | null
}

/**
 * 主题的可见性投影。
 *
 * **这是 content/post.ts 全部函数的参数类型**——收 TopicView 而不是裸 topicId，
 * 让「没过闸就拿不到参数」成为编译期事实。它只能由
 * modules/content/visibility.ts 的 loadVisibleTopic() 产生。
 */
/**
 * 主题的可见性投影。
 *
 * **这不是跨线类型**，是 service 层的参数类型——时间字段用 Date，
 * 因为 drizzle 那侧给的就是 Date，声明成 string 只会逼出一堆 as 断言。
 */
export type TopicView = {
  id: string
  kind: TopicKind
  /** kind='resource' 时非空 */
  resourceId: string | null
  /** 供 /shrine/t/:id 301 回 /kourindou/:slug */
  resourceSlug: string | null
  /** kind='board' 时非空 */
  boardSlug: BoardSlug | null
  /** kind='resource' 时恒为 null——标题从资源现取，不快照 */
  title: string | null
  authorId: string | null
  /** 楼层序列，只增不减 */
  floorSeq: number
  pinnedAt: Date | null
  lastPostAt: Date
}

/** 最新流与版块页的行。资源主题带封面与来源徽章，视觉权重与版块主题区分 */
export type TopicListItem = {
  id: string
  kind: TopicKind
  boardSlug: BoardSlug | null
  /** kind='board' 时的标题（用户输入的单语字符串）；资源主题恒为 null */
  title: string | null
  /** kind='resource' 时的资源信息束；版块主题恒为 null */
  resource: TopicResourceRef | null
  author: PostAuthor | null
  /**
   * 回复数。**必须真数未删楼层**，不能用 `floorSeq - 1` 推——
   * floorSeq 只增不减、含被软删的楼层，那样列表写「12 条回复」
   * 点进去只看到 8 条。版块主题不含 1 楼（主题正文本身），资源主题全算。
   */
  replyCount: number
  pinned: boolean
  lastPostAt: string
  createdAt: string
}

/**
 * 通知指向的对象。
 *
 * 三种情形必须分得开，用一个 `title: string | null` 兼表是错的：
 * - `null`：这条通知本来就没有 subject（比如提权类）
 * - `{ kind: 'removed' }`：有 subject 但已不可见。**服务端只给这个标记，
 *   不给「该内容已被移除」这句人话**——CLAUDE.md 的铁律是 api 不返回
 *   人类可读消息，文案由前端查 Paraglide
 * - 其余：正常显示，资源类同样原样给三语束
 */
export type NotificationSubject =
  | { kind: 'topic'; title: string }
  | { kind: 'resource'; resource: TopicResourceRef }
  | { kind: 'removed' }

export type NotificationView = {
  id: string
  kind: NotificationKind
  actor: PostAuthor | null
  topicId: string | null
  postId: string | null
  /** subject 不可见时是 { kind:'removed' }，**通知行本身保留** */
  subject: NotificationSubject | null
  floor: number | null
  /**
   * 写入时的快照与理由：resource_deleted 的 `title`（对象已不存在，只剩这个）、
   * post_deleted / review_rejected 的 `reason` / `note`。全部是写给收件人看的。
   */
  payload: Record<string, unknown> | null
  read: boolean
  createdAt: string
}
