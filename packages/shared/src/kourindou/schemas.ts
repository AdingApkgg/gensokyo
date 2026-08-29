import { z } from 'zod'
import { paginationQuerySchema } from '../pagination'
import {
  LICENSE_STATUS,
  MIRROR_KIND,
  REJECT_REASON,
  REPORT_REASON,
  RESOURCE_KIND,
  RESOURCE_SORT,
  RESOURCE_STATUS,
  REVIEW_DECISION,
} from './enums'
import { LOCALES, localizedTextSchema } from './localized'

/**
 * id 分三种，不可混用。
 *
 * better-auth 的 generateId 产生 32 位随机字母数字串（实测 1.7.2），**不是 UUID**——
 * 用 z.uuid() 校验用户 id 会对每一个真实用户返回 400。
 */
export const entityIdSchema = z.uuid()
export const userIdSchema = z.string().min(1).max(64)
export const slugIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

/** 举报目标是多态的（资源/帖子/用户），只能用最宽的形状，存在性交给应用层 */
export const anyIdSchema = z.string().min(1).max(64)

export const resourceSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/)

// ---------- 资源 ----------

export const createResourceSchema = z.object({
  titleOriginal: z.string().min(1).max(200),
  titleOriginalLocale: z.enum(LOCALES),
  title: localizedTextSchema.default({}),
  description: localizedTextSchema.default({}),
  kind: z.enum(RESOURCE_KIND),
  license: z.enum(LICENSE_STATUS),
  licenseNote: z.string().max(500).optional(),
  circleId: entityIdSchema.optional(),
  circleNameRaw: z.string().max(120).optional(),
  tagIds: z.array(slugIdSchema).max(12).default([]),
  coverUrl: z.url().max(2000).optional(),
})
export type CreateResource = z.infer<typeof createResourceSchema>

export const updateResourceSchema = createResourceSchema.partial()
export type UpdateResource = z.infer<typeof updateResourceSchema>

export const listResourcesQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(RESOURCE_KIND).optional(),
  license: z.enum(LICENSE_STATUS).optional(),
  tag: z.array(slugIdSchema).max(6).optional(),
  circleId: entityIdSchema.optional(),
  uploaderId: userIdSchema.optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(RESOURCE_SORT).default('newest'),
})
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>

/** 状态流转只有一个入口，不在 URL 空间里把状态机编码第二遍 */
export const changeStatusSchema = z.object({
  to: z.enum(RESOURCE_STATUS),
  reason: z.string().max(500).optional(),
})

/** 许可状态变更必须给理由——这条留痕是版权争议时的证据链 */
export const changeLicenseSchema = z.object({
  license: z.enum(LICENSE_STATUS),
  licenseNote: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
})

// ---------- 分发链接 ----------

/** 只收 http(s) 与 magnet，挡掉 javascript: 之类 */
const downloadUrlSchema = z
  .string()
  .max(2000)
  .refine((u) => /^(https?:\/\/|magnet:\?)/i.test(u), {
    message: '只支持 http(s) 或 magnet 链接',
  })

export const createFileSchema = z.object({
  label: z.string().min(1).max(255),
  url: downloadUrlSchema,
  mirrorKind: z.enum(MIRROR_KIND),
  /** 网盘提取码 */
  extractCode: z.string().max(32).optional(),
  /** 投稿者自报的体积，仅供展示 */
  sizeBytes: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
})
export type CreateFile = z.infer<typeof createFileSchema>

// ---------- 版本与文件 ----------

export const createVersionSchema = z.object({
  label: z.string().min(1).max(64),
  changelog: z.string().max(4000).default(''),
  files: z.array(createFileSchema).min(1).max(20),
})

// ---------- 互动 ----------

export const rateSchema = z.object({ score: z.number().int().min(1).max(5) })

export const createReportSchema = z.object({
  targetKind: z.enum(['resource', 'post']),
  targetId: anyIdSchema,
  reason: z.enum(REPORT_REASON),
  detail: z.string().max(2000).default(''),
})

// ---------- 内容（评论 = 论坛楼层，M4 共用） ----------

export const createPostSchema = z.object({
  bodyMd: z.string().min(1).max(20000),
  parentId: entityIdSchema.optional(),
})
export type CreatePost = z.infer<typeof createPostSchema>

// ---------- 审核 ----------

export const reviewResourceSchema = z
  .object({
    decision: z.enum(REVIEW_DECISION),
    rejectReason: z.enum(REJECT_REASON).optional(),
    note: z.string().max(1000).optional(),
  })
  .refine((v) => v.decision !== 'reject' || v.rejectReason !== undefined, {
    message: 'reject 必须给出 rejectReason',
    path: ['rejectReason'],
  })

export const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'rejected']),
  note: z.string().max(1000).optional(),
})
