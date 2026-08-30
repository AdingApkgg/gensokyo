/**
 * 版块 slug 进 /shrine/b/:board，是**对外 URL，不可逆**。
 *
 * 关版块 = 一批死链；开版块 = 零成本 additive。按不可逆性判据，
 * 正确方向永远是少开——所以这六个是上限不是起点，不再加第七个。
 *
 * **不建 board 表**：`boardSlug` 的唯一写入口是下面这个常量派生出的 z.enum，
 * 用户打错得 400；唯一能打错的是这个常量本身，而表的六行也只能从它 seed，
 * 外键挡不住它。DB 层的保证由 topic_board_slug 这条 CHECK 提供，零表零 join。
 */
export const BOARD_SLUGS = [
  'tea-house', // 幻想乡茶话会（综合）
  'danmaku', // 弹幕研究所（原作 STG）
  'workshop', // 二创工坊
  'music-hall', // 音乐堂
  'kappa', // 河童重工（技术）
  'meta', // 站务
] as const
export type BoardSlug = (typeof BOARD_SLUGS)[number]

export const isBoardSlug = (s: string): s is BoardSlug =>
  (BOARD_SLUGS as readonly string[]).includes(s)

/**
 * 主题的两种形态。M3 只用 'resource'（每个资源自动挂一个），M4 加 'board'。
 * 从 kourindou/enums.ts 迁来——它描述的是内容层不是香霖堂。
 */
export const TOPIC_KIND = ['resource', 'board'] as const
export type TopicKind = (typeof TOPIC_KIND)[number]

/**
 * 举报目标。**一个值都不用加**：主题正文 = floor 1 的 post，'post' 全覆盖。
 * 从 createReportSchema 的就地字面量提成常量，供 DB 与前端徽章共用。
 */
export const REPORT_TARGET_KIND = ['resource', 'post'] as const
export type ReportTargetKind = (typeof REPORT_TARGET_KIND)[number]

/**
 * 通知类型。**扁平 7 值**——两层结构（把判据藏进 jsonb）TS 与 pgEnum 都管不住，
 * 而前端仍要写 N 个分支。按「上线首月会不会触发」从设计稿的 13 值筛掉了 6 个。
 *
 * resource_delisted 与 resource_deleted 都要：两条版权生死线的移除路径
 * （下架、彻底删除）必须都通知到作者。
 */
export const NOTIFICATION_KIND = [
  'reply',
  'mention',
  'review_approved',
  'review_rejected',
  'resource_delisted',
  'resource_deleted',
  'post_deleted',
] as const
export type NotificationKind = (typeof NOTIFICATION_KIND)[number]

/**
 * 去重只对这两种生效。其余 kind 直接入队——通知不可重算，丢了就是永久丢，
 * 而按全局优先级去重会把同批次的第二条治理通知静默丢弃。
 */
export const RANKED_NOTIFICATION_KINDS = ['mention', 'reply'] as const

/** 楼层页大小由服务端定死并回显，客户端不能自选——否则「跳到第 N 楼」算不准 */
export const POSTS_PAGE_SIZE = 50

/** 一条帖子最多提及多少人。超出直接拒，不是静默截断 */
export const MAX_MENTIONS_PER_POST = 10
