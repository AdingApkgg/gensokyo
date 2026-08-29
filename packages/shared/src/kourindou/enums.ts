import { z } from 'zod'

/**
 * 香霖堂枚举与多语字段的**唯一真源**。
 *
 * 每个 `as const` 元组同时喂三处：
 *   1. `packages/db` 的 `pgEnum(...)`（数据库层强约束）
 *   2. 这里的 `z.enum(...)`（API 运行时校验 + `z.infer` 类型）
 *   3. 未来的 OpenAPI / 前端表单选项
 *
 * 增删值只改这一处；`pgEnum` 需要 `readonly [string, ...string[]]`，`as const` 数组正好满足。
 */

// ---------------------------------------------------------------------------
// 多语
// ---------------------------------------------------------------------------

export const LOCALES = ['zh', 'ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const localeSchema = z.enum(LOCALES)

/** 回退链：请求语种 → zh → ja → en。原文语种由调用方插入到链首。 */
export const LOCALE_FALLBACK: readonly Locale[] = ['zh', 'ja', 'en']

/**
 * UGC 短字段的译名袋。**永远是部分的**——绝大多数投稿只有一种语言。
 * 原文不放这里，放在实体的 `*Original` + `*OriginalLocale` 列上。
 */
export type LocalizedText = Partial<Record<Locale, string>>

export const localizedTextSchema = z.partialRecord(
  localeSchema,
  z.string().trim().min(1).max(500),
)

/** 编辑向文案（分类名等）：三语必填，不是 UGC，不允许缺项。 */
export const completeLocalizedTextSchema = z.record(
  localeSchema,
  z.string().trim().min(1).max(500),
)

/**
 * 短字段显示解析：原文先占据自己的语种槽位，然后按 请求 → zh → ja → en 回退。
 * 保证有返回值（`original` 非空），调用方无需判空。
 */
export function resolveLocalized(
  original: string,
  originalLocale: Locale,
  translations: LocalizedText | null | undefined,
  requested: Locale,
): string {
  const bag: LocalizedText = { ...translations, [originalLocale]: original }
  const hit = bag[requested]
  if (hit) return hit
  for (const l of LOCALE_FALLBACK) {
    const v = bag[l]
    if (v) return v
  }
  return original
}

// ---------------------------------------------------------------------------
// 资源状态机 / 许可
// ---------------------------------------------------------------------------

/**
 * draft     上传向导未提交（多步向导需要落盘草稿）
 * pending   已提交待审（先发后审的入口；信任梯度不足时停在这里）
 * published 公开可下载——**唯一允许分发的状态**
 * rejected  审核驳回，回到上传者可编辑
 * delisted  已下架（版权 / 失效 / 自撤）
 */
export const RESOURCE_STATUS = [
  'draft',
  'pending',
  'published',
  'rejected',
  'delisted',
] as const
export type ResourceStatus = (typeof RESOURCE_STATUS)[number]
export const resourceStatusSchema = z.enum(RESOURCE_STATUS)

/** 分发路径一律**白名单**判定，绝不写 `!== 'takedown'`（legacy 的 pending/hidden 可下载就是这么来的）。 */
export const DISTRIBUTABLE_RESOURCE_STATUS = ['published'] as const

/** 生死线字段：社团明示允许 / 未标明 / 已绝版 / 授权转载。默认必须是最保守的 unspecified。 */
export const LICENSE_STATUS = [
  'circle_permitted',
  'unspecified',
  'out_of_print',
  'authorized_repost',
] as const
export type LicenseStatus = (typeof LICENSE_STATUS)[number]
export const licenseStatusSchema = z.enum(LICENSE_STATUS)

// ---------------------------------------------------------------------------
// 归属 / 分类
// ---------------------------------------------------------------------------

export const CIRCLE_ROLE = [
  'circle',
  'artist',
  'translator',
  'publisher',
  'other',
] as const
export type CircleRole = (typeof CIRCLE_ROLE)[number]
export const circleRoleSchema = z.enum(CIRCLE_ROLE)

/** 原作本体的形态。 */
export const WORK_KIND = [
  'stg',
  'fighting',
  'spinoff',
  'print',
  'music',
  'other',
] as const
export type WorkKind = (typeof WORK_KIND)[number]
export const workKindSchema = z.enum(WORK_KIND)

/**
 * tag 是「类型 × 原作 × 展会」之外的**开放维度**。
 * 三个命名维度各有专表（resource_category / touhou_work / convention），不塞进 tag。
 */
export const TAG_KIND = [
  'format',
  'language',
  'content_warning',
  'freeform',
] as const
export type TagKind = (typeof TAG_KIND)[number]
export const tagKindSchema = z.enum(TAG_KIND)

export const TRANSLATION_SOURCE = [
  'original',
  'uploader',
  'community',
  'machine',
] as const
export type TranslationSource = (typeof TRANSLATION_SOURCE)[number]
export const translationSourceSchema = z.enum(TRANSLATION_SOURCE)

// ---------------------------------------------------------------------------
// 存储
// ---------------------------------------------------------------------------

/** file 是判别联合：b2 分支有 s3Key，external 分支有 externalUrl，DB 层用 CHECK 保证二选一。 */
export const FILE_STORAGE_KIND = ['b2', 'external'] as const
export type FileStorageKind = (typeof FILE_STORAGE_KIND)[number]
export const fileStorageKindSchema = z.enum(FILE_STORAGE_KIND)

export const UPLOAD_KIND = ['cover', 'file'] as const
export type UploadKind = (typeof UPLOAD_KIND)[number]
export const uploadKindSchema = z.enum(UPLOAD_KIND)

/** 预签名直传是两阶段的：签名时 pending，HeadObject 确认后 uploaded。 */
export const UPLOAD_STATE = [
  'pending',
  'uploaded',
  'failed',
  'aborted',
] as const
export type UploadState = (typeof UPLOAD_STATE)[number]
export const uploadStateSchema = z.enum(UPLOAD_STATE)

// ---------------------------------------------------------------------------
// 内容系统（M3 资源评论 / M4 论坛共用）
// ---------------------------------------------------------------------------

export const TOPIC_KIND = ['resource', 'forum'] as const
export type TopicKind = (typeof TOPIC_KIND)[number]
export const topicKindSchema = z.enum(TOPIC_KIND)

export const POST_STATUS = ['visible', 'hidden', 'deleted'] as const
export type PostStatus = (typeof POST_STATUS)[number]
export const postStatusSchema = z.enum(POST_STATUS)

// ---------------------------------------------------------------------------
// 治理
// ---------------------------------------------------------------------------

export const REPORT_TARGET = ['resource', 'post', 'user', 'circle'] as const
export type ReportTarget = (typeof REPORT_TARGET)[number]
export const reportTargetSchema = z.enum(REPORT_TARGET)

/** copyright 直连 takedown_request 流程，不走普通举报队列。 */
export const REPORT_KIND = [
  'copyright',
  'broken_link',
  'miscategorized',
  'illegal',
  'spam',
  'other',
] as const
export type ReportKind = (typeof REPORT_KIND)[number]
export const reportKindSchema = z.enum(REPORT_KIND)

export const REPORT_STATUS = [
  'open',
  'reviewing',
  'resolved',
  'rejected',
  'duplicate',
] as const
export type ReportStatus = (typeof REPORT_STATUS)[number]
export const reportStatusSchema = z.enum(REPORT_STATUS)

export const CLAIM_STATUS = [
  'open',
  'reviewing',
  'approved',
  'rejected',
  'withdrawn',
] as const
export type ClaimStatus = (typeof CLAIM_STATUS)[number]
export const claimStatusSchema = z.enum(CLAIM_STATUS)

export const TAKEDOWN_STATUS = [
  'open',
  'reviewing',
  'accepted',
  'rejected',
  'withdrawn',
] as const
export type TakedownStatus = (typeof TAKEDOWN_STATUS)[number]
export const takedownStatusSchema = z.enum(TAKEDOWN_STATUS)

export const TAKEDOWN_RELATION = [
  'circle_member',
  'author',
  'rights_agent',
  'publisher',
  'other',
] as const
export type TakedownRelation = (typeof TAKEDOWN_RELATION)[number]
export const takedownRelationSchema = z.enum(TAKEDOWN_RELATION)

/** 资源生命周期审计事件。版权争议时要能证明「我们何时依据什么改的状态」。 */
export const RESOURCE_AUDIT_EVENT = [
  'created',
  'submitted',
  'status_change',
  'license_change',
  'edited',
  'version_added',
  'takedown',
  'restored',
] as const
export type ResourceAuditEvent = (typeof RESOURCE_AUDIT_EVENT)[number]
export const resourceAuditEventSchema = z.enum(RESOURCE_AUDIT_EVENT)
