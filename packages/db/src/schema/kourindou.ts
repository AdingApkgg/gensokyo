import {
  CLAIM_STATUS,
  HANDLE_RE,
  LICENSE_STATUS,
  type LocalizedText,
  MIRROR_KIND,
  MODERATION_ACTION,
  REJECT_REASON,
  REPORT_REASON,
  REPORT_STATUS,
  RESERVED_HANDLES,
  RESOURCE_KIND,
  RESOURCE_STATUS,
  TAG_KIND,
  TAKEDOWN_STATUS,
  USER_ROLE,
} from '@gensokyo/shared'
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * 枚举值从 @gensokyo/shared 派生，DDL 与 zod 校验不会漂移。
 *
 * 时间列一律 timestamptz：平台面向 zh/ja/en 三个时区的用户，
 * 用无时区的 timestamp 存 UTC 是等着出错。
 */
export const resourceStatus = pgEnum('resource_status', RESOURCE_STATUS)
export const licenseStatus = pgEnum('license_status', LICENSE_STATUS)
export const resourceKind = pgEnum('resource_kind', RESOURCE_KIND)
export const tagKind = pgEnum('tag_kind', TAG_KIND)
export const userRole = pgEnum('user_role', USER_ROLE)
export const rejectReason = pgEnum('reject_reason', REJECT_REASON)
export const reportReason = pgEnum('report_reason', REPORT_REASON)
export const reportStatus = pgEnum('report_status', REPORT_STATUS)
export const takedownStatus = pgEnum('takedown_status', TAKEDOWN_STATUS)
export const claimStatus = pgEnum('claim_status', CLAIM_STATUS)
export const mirrorKind = pgEnum('mirror_kind', MIRROR_KIND)
export const moderationAction = pgEnum('moderation_action', MODERATION_ACTION)

// ---------------------------------------------------------------- 用户扩展

/**
 * CHECK 里的字面量从常量派生，不在 SQL 里再抄一遍。
 *
 * ⚠️ 必须用 `sql.raw` 内联。写成 `sql`${v}`` 的话 drizzle-kit 会把它参数化成
 * `$1, $2, …`，而 **DDL 不能用绑定参数**——生成的迁移一跑就报
 * 「there is no parameter $1」。值来自本仓的编译期常量，不是用户输入；
 * 出现引号就说明有人把常量改成了不该内联的东西，宁可在构建期炸。
 */
const assertInlinable = (v: string) => {
  if (/['\\]/.test(v)) throw new Error(`不可内联的字面量: ${v}`)
  return v
}
const sqlLiteral = (v: string) => sql.raw(`'${assertInlinable(v)}'`)
const sqlLiteralList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${assertInlinable(v)}'`).join(', '))

/**
 * 角色与信任梯度。不动 better-auth 生成的 user 表，避免它升级时冲突。
 *
 * ⚠️ 这张表原本**没有第二参数**。加表级 CHECK 必须同时把它从
 * `pgTable(name, {...})` 改成 `pgTable(name, {...}, (t) => [...])`——
 * 忘了第二参数的话 CHECK 会**静默不生成**，migrate 照样成功。
 */
export const userProfile = pgTable(
  'user_profile',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull().default('user'),
    /**
     * 稳定标识：进 /u/:handle，也进已发布帖子的正文（@xxx）。
     * **M4 唯一同时命中两条不可逆红线的字段**——改它等于死链 + 重写历史正文。
     *
     * NOT NULL 是一条不变量：sessionMiddleware 惰性建档时从 user.id 派生，
     * 迁移里给所有缺行的 user 补了 profile。可空的话「没有 handle 的用户」
     * 会出现在 @解析 / /u/:handle / 通知渲染三条路径的每个分支里。
     */
    handle: varchar('handle', { length: 20 }).notNull().unique(),
    /** 「自选一次后锁定」的状态位：只在它为 NULL 时接受 PUT /me/handle */
    handleSetAt: timestamp('handle_set_at', { withTimezone: true }),
    /** 通过审核的资源数，达阈值后即发即审 */
    approvedResourceCount: integer('approved_resource_count')
      .notNull()
      .default(0),
    /** 违规记录数，> 0 直接清零信任等级 */
    strikeCount: integer('strike_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    /**
     * 正则由 HANDLE_RE 的**同一个字面量**派生，并有测试断言两者一致。
     * 两处各写一遍正则必然漂移。
     */
    check(
      'user_profile_handle_fmt',
      sql`${t.handle} ~ ${sqlLiteral(HANDLE_RE.source)}`,
    ),
    /**
     * 保留字只写在 zod 里的话，绕过 API 就没了——而这里绕过的后果是
     * **不可逆冒充**：@admin 一旦被注册并出现在已发布的正文里，改不回来。
     */
    check(
      'user_profile_handle_not_reserved',
      sql`${t.handle} NOT IN (${sqlLiteralList(RESERVED_HANDLES)})`,
    ),
  ],
)

// ---------------------------------------------------------------- 分类与标签

/** 资源类型：单选、必填，独立查找表（不是 pgEnum，因为要挂多语名与图标） */
export const resourceCategory = pgTable('resource_category', {
  id: varchar('id', { length: 32 }).primaryKey(),
  kind: resourceKind('kind').notNull(),
  name: jsonb('name').$type<LocalizedText>().notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
})

/**
 * 标签：原作 / 展会 / 语言 / 其他，用 kind 区分维度。
 * 不为 work 和 convention 单独建表——M3 对它们的操作只有"按它筛选"和"显示多语名"。
 */
export const tag = pgTable(
  'tag',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    kind: tagKind('kind').notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull().default({}),
    /** 原文名，多语表缺失时的回落 */
    nameOriginal: varchar('name_original', { length: 120 }).notNull(),
    usageCount: integer('usage_count').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('tag_kind_idx').on(t.kind, t.sortOrder)],
)

// ---------------------------------------------------------------- 社团

export const circle = pgTable(
  'circle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 128 }).notNull().unique(),
    nameOriginal: varchar('name_original', { length: 120 }).notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull().default({}),
    description: jsonb('description')
      .$type<LocalizedText>()
      .notNull()
      .default({}),
    websiteUrl: text('website_url'),
    avatarUrl: text('avatar_url'),
    /** 认领成功后指向社团本人的账号 */
    ownerId: text('owner_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('circle_owner_idx').on(t.ownerId)],
)

/** 社团认领申请。M3 只收单，审批走 SQL */
export const circleClaim = pgTable(
  'circle_claim',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circle.id, { onDelete: 'cascade' }),
    claimantId: text('claimant_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: claimStatus('status').notNull().default('open'),
    evidence: text('evidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** 同一个人对同一社团只能有一个待处理申请 */
    uniqueIndex('circle_claim_open_uq')
      .on(t.circleId, t.claimantId)
      .where(sql`${t.status} = 'open'`),
  ],
)

// ---------------------------------------------------------------- 资源

export const resource = pgTable(
  'resource',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 128 }).notNull().unique(),
    /** 原文标题必填，多语表只是可选增量 —— 保证显示值永不为空 */
    titleOriginal: varchar('title_original', { length: 200 }).notNull(),
    titleOriginalLocale: varchar('title_original_locale', {
      length: 8,
    }).notNull(),
    title: jsonb('title').$type<LocalizedText>().notNull().default({}),
    description: jsonb('description')
      .$type<LocalizedText>()
      .notNull()
      .default({}),
    kind: resourceKind('kind').notNull(),
    categoryId: varchar('category_id', { length: 32 }).references(
      () => resourceCategory.id,
      { onDelete: 'set null' },
    ),
    status: resourceStatus('status').notNull().default('draft'),
    /** 版权生死线：投稿时必选 */
    license: licenseStatus('license').notNull(),
    licenseNote: varchar('license_note', { length: 500 }),
    /**
     * set null 而非 cascade：误删一个用户不应连带抹掉他投稿的所有资源，
     * 那是不可逆的数据丢失。
     */
    uploaderId: text('uploader_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    circleId: uuid('circle_id').references(() => circle.id, {
      onDelete: 'set null',
    }),
    /** 社团未建档时的原始署名 */
    circleNameRaw: varchar('circle_name_raw', { length: 120 }),
    coverUrl: text('cover_url'),
    downloadCount: integer('download_count').notNull().default(0),
    ratingSum: integer('rating_sum').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    /** 软删。所有读路径必须带 deleted_at is null */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('resource_status_created_idx').on(t.status, t.createdAt.desc()),
    /** legacy 漏了这个索引，「我的资源」是全表扫 */
    index('resource_uploader_idx').on(t.uploaderId),
    index('resource_circle_idx').on(t.circleId),
    index('resource_kind_idx').on(t.kind),
  ],
)

export const resourceTag = pgTable(
  'resource_tag',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    tagId: varchar('tag_id', { length: 64 })
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.tagId] }),
    /** 反向索引：按标签筛资源是列表页的主路径，legacy 没建 */
    index('resource_tag_tag_idx').on(t.tagId),
  ],
)

/** 版本：资源可更新，下载指向具体版本 */
export const resourceVersion = pgTable(
  'resource_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 64 }).notNull(),
    changelog: text('changelog').notNull().default(''),
    isLatest: integer('is_latest').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('resource_version_resource_idx').on(t.resourceId, t.createdAt.desc()),
    uniqueIndex('resource_version_label_uq').on(t.resourceId, t.label),
    /** 一个资源只能有一个最新版 */
    uniqueIndex('resource_version_latest_uq')
      .on(t.resourceId)
      .where(sql`${t.isLatest} = 1`),
  ],
)

/**
 * 分发链接。M3 只做外链——中文同人圈的实际主流是网盘 + 提取码。
 * 自托管（B2 直传）是后续增量：加一个 mirrorKind='hosted' 与对象表即可，
 * 现有行不受影响。
 */
export const resourceFile = pgTable(
  'resource_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => resourceVersion.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 255 }).notNull(),
    url: text('url').notNull(),
    kind: mirrorKind('kind').notNull(),
    /** 网盘提取码 */
    extractCode: varchar('extract_code', { length: 32 }),
    /** 投稿者自报，仅供展示，不可信 */
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    note: varchar('note', { length: 500 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('resource_file_version_idx').on(t.versionId, t.sortOrder)],
)

// ---------------------------------------------------------------- 互动

export const rating = pgTable(
  'rating',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.userId] }),
    /** 个人主页要按用户查评分，legacy 只有 (resource,user) 主键 */
    index('rating_user_idx').on(t.userId),
    /** legacy 的 1-5 只在 zod 里，绕过 API 就能写 999 并污染 ratingSum */
    check('rating_score_range', sql`${t.score} between 1 and 5`),
  ],
)

export const favorite = pgTable(
  'favorite',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.userId] }),
    index('favorite_user_idx').on(t.userId, t.createdAt.desc()),
  ],
)

export const downloadLog = pgTable(
  'download_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => resourceFile.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** 日聚合直接 GROUP BY date_trunc，不建聚合表 */
    index('download_log_resource_created_idx').on(t.resourceId, t.createdAt),
  ],
)

// ---------------------------------------------------------------- 治理

/** 举报目标是多态的（资源 / 帖子） */
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetKind: varchar('target_kind', { length: 16 }).notNull(),
    targetId: text('target_id').notNull(),
    reporterId: text('reporter_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reason: reportReason('reason').notNull(),
    detail: text('detail').notNull().default(''),
    status: reportStatus('status').notNull().default('open'),
    resolvedBy: text('resolved_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('report_status_created_idx').on(t.status, t.createdAt),
    index('report_target_idx').on(t.targetKind, t.targetId),
    /**
     * 同一个人对同一个对象只能有一条未结案的举报。
     * solo 运营下举报队列是论坛唯一的「审」的入口——被同一个人的重复提交
     * 埋掉，等于关掉整个治理通道。形状与上面的 circle_claim_open_uq 逐字相同。
     */
    uniqueIndex('report_open_uq')
      .on(t.reporterId, t.targetKind, t.targetId)
      .where(sql`${t.status} = 'open'`),
  ],
)

/**
 * 下架申请。M3 不做公开提交表单——上线时资源数近 0，下架函数量为 0，
 * 法律要求靠「静态页 + 邮箱 + 手工往这张表录入」即满足。
 * 表存在，法律留痕就存在，这才是它现在的价值。
 */
export const takedownRequest = pgTable(
  'takedown_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    claimantName: varchar('claimant_name', { length: 200 }).notNull(),
    claimantEmail: varchar('claimant_email', { length: 320 }).notNull(),
    relation: varchar('relation', { length: 32 }).notNull(),
    statement: text('statement').notNull(),
    status: takedownStatus('status').notNull().default('open'),
    handledBy: text('handled_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('takedown_resource_idx').on(t.resourceId)],
)

/**
 * 跨实体审计日志。subjectId 是多态的，因此信任变更、举报处理、
 * 认领审批、下架结案都有地方可写——legacy 的审计绑死 resourceId，
 * 版权争议时"我们何时依据什么做的处置"根本写不下。
 */
export const moderationLog = pgTable(
  'moderation_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    action: moderationAction('action').notNull(),
    subjectKind: varchar('subject_kind', { length: 24 }).notNull(),
    subjectId: text('subject_id').notNull(),
    fromValue: jsonb('from_value'),
    toValue: jsonb('to_value'),
    rejectReason: rejectReason('reject_reason'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('moderation_log_subject_idx').on(t.subjectKind, t.subjectId),
    index('moderation_log_created_idx').on(t.createdAt.desc()),
  ],
)

/**
 * 站点配置。键值对而非固定列——配置项会随产品增减，
 * 每加一个开关就改一次 schema 不划算。键名在 shared 里是白名单的。
 */
export const siteConfig = pgTable('site_config', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

// ---------------------------------------------------------------- relations

export const resourceRelations = relations(resource, ({ one, many }) => ({
  uploader: one(user, {
    fields: [resource.uploaderId],
    references: [user.id],
  }),
  circle: one(circle, {
    fields: [resource.circleId],
    references: [circle.id],
  }),
  versions: many(resourceVersion),
  tags: many(resourceTag),
  ratings: many(rating),
}))

export const resourceVersionRelations = relations(
  resourceVersion,
  ({ one, many }) => ({
    resource: one(resource, {
      fields: [resourceVersion.resourceId],
      references: [resource.id],
    }),
    files: many(resourceFile),
  }),
)

export const resourceFileRelations = relations(resourceFile, ({ one }) => ({
  version: one(resourceVersion, {
    fields: [resourceFile.versionId],
    references: [resourceVersion.id],
  }),
}))

export const resourceTagRelations = relations(resourceTag, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceTag.resourceId],
    references: [resource.id],
  }),
  tag: one(tag, { fields: [resourceTag.tagId], references: [tag.id] }),
}))

export const circleRelations = relations(circle, ({ one, many }) => ({
  owner: one(user, { fields: [circle.ownerId], references: [user.id] }),
  resources: many(resource),
  claims: many(circleClaim),
}))

export const userProfileRelations = relations(userProfile, ({ one }) => ({
  user: one(user, { fields: [userProfile.userId], references: [user.id] }),
}))
