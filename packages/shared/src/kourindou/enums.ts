/**
 * 香霖堂的枚举常量。这里是唯一事实来源：
 * drizzle 的 pgEnum 与 zod 的 z.enum 都从这些数组派生，两边不会漂移。
 */

/** 资源状态。draft 只有作者可见；published 是唯一可下载的状态 */
export const RESOURCE_STATUS = [
  'draft',
  'pending',
  'published',
  'delisted',
] as const
export type ResourceStatus = (typeof RESOURCE_STATUS)[number]

/** 分发许可状态——版权生死线字段，投稿时必选 */
export const LICENSE_STATUS = [
  'allowed', // 社团明示允许
  'unspecified', // 未标明
  'out_of_print', // 已绝版
  'licensed', // 授权转载
] as const
export type LicenseStatus = (typeof LICENSE_STATUS)[number]

export const RESOURCE_KIND = [
  'game',
  'music',
  'doujinshi',
  'patch',
  'tool',
] as const
export type ResourceKind = (typeof RESOURCE_KIND)[number]

/** 标签维度。work/convention 不单独建表——M3 对它们的操作与 tag 完全同构 */
export const TAG_KIND = ['work', 'convention', 'language', 'other'] as const
export type TagKind = (typeof TAG_KIND)[number]

export const USER_ROLE = ['user', 'moderator', 'admin'] as const
export type UserRole = (typeof USER_ROLE)[number]

export const REVIEW_DECISION = ['approve', 'reject'] as const
export type ReviewDecision = (typeof REVIEW_DECISION)[number]

/** 拒绝理由。copyright / illegal 会触发 strikeCount 递增，进而清零信任等级 */
export const REJECT_REASON = [
  'copyright',
  'illegal',
  'low_quality',
  'duplicate',
  'other',
] as const
export type RejectReason = (typeof REJECT_REASON)[number]

/** 触发信任惩罚的拒绝理由 */
export const STRIKE_REJECT_REASONS: readonly RejectReason[] = [
  'copyright',
  'illegal',
]

export const REPORT_REASON = [
  'copyright',
  'illegal',
  'broken_link',
  'wrong_info',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASON)[number]

export const REPORT_STATUS = ['open', 'resolved', 'rejected'] as const
export type ReportStatus = (typeof REPORT_STATUS)[number]

export const TAKEDOWN_STATUS = ['open', 'accepted', 'rejected'] as const
export type TakedownStatus = (typeof TAKEDOWN_STATUS)[number]

export const CLAIM_STATUS = [
  'open',
  'approved',
  'rejected',
  'withdrawn',
] as const
export type ClaimStatus = (typeof CLAIM_STATUS)[number]

export const TOPIC_KIND = ['resource', 'board'] as const
export type TopicKind = (typeof TOPIC_KIND)[number]

/**
 * 分发方式。M3 先做外链——中文同人圈的实际主流是网盘链接，
 * 自托管（B2 直传）是后续增量，加回来时这里补一个 'hosted'。
 */
export const MIRROR_KIND = [
  'netdisk',
  'direct',
  'torrent',
  'magnet',
  'other',
] as const
export type MirrorKind = (typeof MIRROR_KIND)[number]

export const RESOURCE_SORT = ['newest', 'downloads', 'rating'] as const
export type ResourceSort = (typeof RESOURCE_SORT)[number]

/** 跨实体审计动作 */
export const MODERATION_ACTION = [
  'review',
  'status_change',
  'license_change',
  'report_resolve',
  'takedown_resolve',
  'trust_change',
  'role_change',
  // 软删与例行下架分开记：审计日志要能回答「站长撤下过什么」，
  // 混进 status_change 就得跟每一次普通的上下架一起翻。
  'soft_delete',
  'hard_delete',
  'config_change',
] as const
export type ModerationAction = (typeof MODERATION_ACTION)[number]

/** 即发即审门槛：通过 N 个资源且无违规记录 */
export const TRUST_AUTO_PUBLISH_THRESHOLD = 3

/**
 * 站点配置。键是白名单的——配置表是 admin 唯一能写的自由结构，
 * 不限死键名等于给自己开一个任意写入口。
 */
export const SITE_CONFIG_KEYS = [
  /** 是否开放注册 */
  'registrationOpen',
  /** 即发即审门槛：通过多少个资源后免审 */
  'autoPublishThreshold',
  /** 版权联系邮箱——「权利人能联系到你」是法律要求，不能只存在于代码注释里 */
  'takedownEmail',
  /** 站点公告，三语 */
  'announcement',
] as const
export type SiteConfigKey = (typeof SITE_CONFIG_KEYS)[number]

/** 公开可读的配置：前端要用来决定是否显示注册入口、下架联系方式等 */
export const PUBLIC_CONFIG_KEYS: readonly SiteConfigKey[] = [
  'registrationOpen',
  'takedownEmail',
  'announcement',
]
