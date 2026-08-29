import {
  CLAIM_STATUS,
  LICENSE_STATUS,
  type LocalizedText,
  MODERATION_ACTION,
  REJECT_REASON,
  REPORT_REASON,
  REPORT_STATUS,
  RESOURCE_KIND,
  RESOURCE_STATUS,
  STORAGE_BUCKET,
  TAG_KIND,
  TAKEDOWN_STATUS,
  UPLOAD_KIND,
  UPLOAD_STATE,
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
export const uploadKind = pgEnum('upload_kind', UPLOAD_KIND)
export const uploadState = pgEnum('upload_state', UPLOAD_STATE)
export const storageBucket = pgEnum('storage_bucket', STORAGE_BUCKET)
export const moderationAction = pgEnum('moderation_action', MODERATION_ACTION)

// ---------------------------------------------------------------- 用户扩展

/**
 * 角色与信任梯度。不动 better-auth 生成的 user 表，避免它升级时冲突。
 */
export const userProfile = pgTable('user_profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: userRole('role').notNull().default('user'),
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
})

// ---------------------------------------------------------------- 存储

/**
 * 统管所有 B2 对象（封面 / 资源文件 / 社团头像）。
 *
 * 单独一张表是为了让 GC 能用**白名单**谓词——"被已知引用表引用的保留"。
 * 取反的黑名单（"没被 resource_file 引用的删掉"）会连封面一起删光。
 */
export const storageObject = pgTable(
  'storage_object',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: storageBucket('bucket').notNull(),
    key: text('key').notNull().unique(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentType: varchar('content_type', { length: 150 }),
    checksum: text('checksum'),
    /** 置值即等待 GC 回收；null 表示在用 */
    deleteAfter: timestamp('delete_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('storage_object_delete_after_idx').on(t.deleteAfter)],
)

/**
 * 预签名直传的意向。confirm 时校验 intent 属于当前用户，
 * 否则任何人都能把别人上传的对象挂到自己的资源上。
 */
export const uploadIntent = pgTable(
  'upload_intent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: uploadKind('kind').notNull(),
    state: uploadState('state').notNull().default('pending'),
    bucket: storageBucket('bucket').notNull(),
    key: text('key').notNull().unique(),
    filename: varchar('filename', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 150 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    objectId: uuid('object_id').references(() => storageObject.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('upload_intent_owner_idx').on(t.ownerId),
    index('upload_intent_state_expires_idx').on(t.state, t.expiresAt),
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
    avatarObjectId: uuid('avatar_object_id').references(
      () => storageObject.id,
      { onDelete: 'set null' },
    ),
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
    coverObjectId: uuid('cover_object_id').references(() => storageObject.id, {
      onDelete: 'set null',
    }),
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

export const resourceFile = pgTable(
  'resource_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => resourceVersion.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => storageObject.id, { onDelete: 'restrict' }),
    displayName: varchar('display_name', { length: 255 }).notNull(),
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
  cover: one(storageObject, {
    fields: [resource.coverObjectId],
    references: [storageObject.id],
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
  object: one(storageObject, {
    fields: [resourceFile.objectId],
    references: [storageObject.id],
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
