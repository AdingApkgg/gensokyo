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

/**
 * URL 校验：真正解析一遍再看协议，不能只做前缀正则。
 * 前缀正则放得过去 `https://x\r\nX: y` 这种含控制字符的串，
 * 存进库之后每次访问都在 c.redirect 里抛 500。
 */
const safeUrl = (protocols: string[], max = 2000) =>
  z
    .string()
    .max(max)
    .transform((raw, ctx) => {
      let u: URL
      try {
        u = new URL(raw.trim())
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid_url' })
        return z.NEVER
      }
      if (!protocols.includes(u.protocol)) {
        ctx.addIssue({ code: 'custom', message: 'unsupported_protocol' })
        return z.NEVER
      }
      // 归一化后存 href：顺带剔除控制字符与畸形写法
      return u.href
    })

const downloadUrlSchema = safeUrl(['http:', 'https:', 'magnet:'])
/** 封面只能是 http(s)——javascript:/data:/file: 一律拒 */
const imageUrlSchema = safeUrl(['http:', 'https:'])

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
  coverUrl: imageUrlSchema.optional(),
})
export type CreateResource = z.infer<typeof createResourceSchema>

/**
 * 不能写成 `createResourceSchema.partial()`：`.partial()` 只把字段变 optional，
 * **不会移除 `.default()`**，于是没传的 title/description/tagIds 会被补成
 * `{}`/`[]` 并原样写库——改一次标题就清空全部译名和标签。
 * 这里逐字段重建，未传即 undefined。
 */
export const updateResourceSchema = z.object({
  titleOriginal: z.string().min(1).max(200).optional(),
  titleOriginalLocale: z.enum(LOCALES).optional(),
  title: localizedTextSchema.optional(),
  description: localizedTextSchema.optional(),
  kind: z.enum(RESOURCE_KIND).optional(),
  license: z.enum(LICENSE_STATUS).optional(),
  licenseNote: z.string().max(500).optional(),
  circleId: entityIdSchema.optional(),
  circleNameRaw: z.string().max(120).optional(),
  tagIds: z.array(slugIdSchema).max(12).optional(),
  coverUrl: imageUrlSchema.optional(),
})
export type UpdateResource = z.infer<typeof updateResourceSchema>

export const listResourcesQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(RESOURCE_KIND).optional(),
  license: z.enum(LICENSE_STATUS).optional(),
  // Hono 的单值 query 是 string，不升维的话「点一个标签」100% 400
  tag: z
    .preprocess(
      (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
      z.array(slugIdSchema).max(6),
    )
    .optional(),
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

// ---------- 站长 ----------

/**
 * 授予角色。**故意不含 'admin'**：能通过 HTTP 发放 admin 的端点会成为全站
 * 最值得攻击的目标，授予 admin 只走本地 grant-role 脚本。
 */
export const grantRoleSchema = z.object({
  role: z.enum(['user', 'moderator']),
  reason: z.string().min(1).max(500),
})

/**
 * 用户检索。不带 q 时只列出 moderator 和 admin——全站用户列表对站长没用，
 * 而且是一份现成的邮箱清单，没有理由默认吐出来。
 * 要提权的人此刻还是普通用户，只能靠邮箱或昵称找，所以 q 必须能搜到全体。
 */
export const userSearchSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
})

/** 硬删是不可逆的，因此理由必填且会写进审计 */
export const deleteResourceSchema = z.object({
  mode: z.enum(['soft', 'purge']),
  reason: z.string().min(1).max(500),
})

export const siteConfigSchema = z.object({
  registrationOpen: z.boolean().optional(),
  autoPublishThreshold: z.number().int().min(0).max(1000).optional(),
  takedownEmail: z.email().max(320).optional(),
  announcement: localizedTextSchema.optional(),
})
export type SiteConfig = z.infer<typeof siteConfigSchema>

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
