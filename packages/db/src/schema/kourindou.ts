import {
  CIRCLE_ROLE,
  CLAIM_STATUS,
  FILE_STORAGE_KIND,
  LICENSE_STATUS,
  LOCALES,
  type Locale,
  type LocalizedText,
  POST_STATUS,
  REPORT_KIND,
  REPORT_STATUS,
  REPORT_TARGET,
  RESOURCE_AUDIT_EVENT,
  RESOURCE_STATUS,
  TAG_KIND,
  TAKEDOWN_RELATION,
  TAKEDOWN_STATUS,
  TOPIC_KIND,
  TRANSLATION_SOURCE,
  UPLOAD_KIND,
  UPLOAD_STATE,
  WORK_KIND,
} from '@gensokyo/shared/kourindou'
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

// ---------------------------------------------------------------------------
// 公共约定
// ---------------------------------------------------------------------------

/**
 * 业务实体主键：应用层生成的 UUIDv7（时间有序、不泄露总量、与 better-auth 的 text userId 同型）。
 * 纯 join 表用复合主键；只有 append-only 日志表用 bigserial。
 */
const newId = () => Bun.randomUUIDv7()

/** 全部时间列一律 timestamptz——站点面向全球（zh/ja/en），无时区 timestamp 会在跨时区统计上出错。 */
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

// ---------------------------------------------------------------------------
// 枚举（值元组来自 @gensokyo/shared/kourindou，一处定义三处消费）
// ---------------------------------------------------------------------------

export const localeEnum = pgEnum('locale', LOCALES)
export const resourceStatusEnum = pgEnum('resource_status', RESOURCE_STATUS)
export const licenseStatusEnum = pgEnum('license_status', LICENSE_STATUS)
export const circleRoleEnum = pgEnum('circle_role', CIRCLE_ROLE)
export const workKindEnum = pgEnum('work_kind', WORK_KIND)
export const tagKindEnum = pgEnum('tag_kind', TAG_KIND)
export const translationSourceEnum = pgEnum(
  'translation_source',
  TRANSLATION_SOURCE,
)
export const fileStorageKindEnum = pgEnum(
  'file_storage_kind',
  FILE_STORAGE_KIND,
)
export const uploadKindEnum = pgEnum('upload_kind', UPLOAD_KIND)
export const uploadStateEnum = pgEnum('upload_state', UPLOAD_STATE)
export const topicKindEnum = pgEnum('topic_kind', TOPIC_KIND)
export const postStatusEnum = pgEnum('post_status', POST_STATUS)
export const reportTargetEnum = pgEnum('report_target', REPORT_TARGET)
export const reportKindEnum = pgEnum('report_kind', REPORT_KIND)
export const reportStatusEnum = pgEnum('report_status', REPORT_STATUS)
export const claimStatusEnum = pgEnum('claim_status', CLAIM_STATUS)
export const takedownStatusEnum = pgEnum('takedown_status', TAKEDOWN_STATUS)
export const takedownRelationEnum = pgEnum(
  'takedown_relation',
  TAKEDOWN_RELATION,
)
export const resourceAuditEventEnum = pgEnum(
  'resource_audit_event',
  RESOURCE_AUDIT_EVENT,
)

// ===========================================================================
// 分类（编辑向查找表，5~10 行，seed 数据）
// ===========================================================================

/**
 * 内容类型是**会长的**集合（同人游戏 / 同人志·图集 / 音乐专辑 / 汉化补丁·字幕 / 工具·素材 …），
 * 所以不做 pgEnum（`ALTER TYPE ADD VALUE` 在同事务里加完不能立刻用），做查找表。
 * id 直接用 slug（'game' / 'doujinshi' / …），FK 值在行里就是可读的。
 */
export const resourceCategory = pgTable('resource_category', {
  id: varchar('id', { length: 32 }).primaryKey(),
  /** 编辑向文案：三语必填（不是 UGC），用 completeLocalizedTextSchema 校验。 */
  name: jsonb('name').$type<Record<Locale, string>>().notNull(),
  description: jsonb('description')
    .$type<Partial<Record<Locale, string>>>()
    .notNull()
    .default({}),
  iconKey: varchar('icon_key', { length: 64 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
})

// ===========================================================================
// 展会 / 原作（「类型 × 原作 × 展会」三个命名维度各有专表）
// ===========================================================================

export const convention = pgTable(
  'convention',
  {
    /** 'c105' / 'reitaisai22'，稳定可读，直接进 URL 与 Meilisearch facet 值。 */
    id: varchar('id', { length: 32 }).primaryKey(),
    series: varchar('series', { length: 32 }).notNull(),
    edition: integer('edition'),
    nameOriginal: text('name_original').notNull(),
    nameOriginalLocale: localeEnum('name_original_locale')
      .notNull()
      .default('ja'),
    name: jsonb('name').$type<LocalizedText>().notNull().default({}),
    shortName: varchar('short_name', { length: 32 }),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    homepageUrl: text('homepage_url'),
    ...timestamps(),
  },
  (t) => [
    index('convention_series_startsOn_idx').on(t.series, t.startsOn.desc()),
    index('convention_startsOn_idx').on(t.startsOn.desc()),
  ],
)

/**
 * 东方作品本体。是**数据实体**而非标签：有作品编号、形态、发售日、外部 ID（chronicle / TouhouDB 对接挂载点）。
 * id 用 'th06' / 'th12_8' 这类稳定编号。
 */
export const touhouWork = pgTable(
  'touhou_work',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    kind: workKindEnum('kind').notNull(),
    /** 作品序号 ×10（th12.8 → 128），整数可排序、可索引，避免 numeric 的字符串往返。 */
    sortIndex: integer('sort_index').notNull(),
    nameOriginal: text('name_original').notNull(),
    nameOriginalLocale: localeEnum('name_original_locale')
      .notNull()
      .default('ja'),
    name: jsonb('name').$type<LocalizedText>().notNull().default({}),
    abbr: varchar('abbr', { length: 32 }),
    releasedOn: date('released_on'),
    /** { touhoudb?: number, thbwiki?: string } —— 与外部结构化数据源互引。 */
    externalIds: jsonb('external_ids')
      .$type<{ touhoudb?: number; thbwiki?: string }>()
      .notNull()
      .default({}),
    ...timestamps(),
  },
  (t) => [index('touhou_work_kind_sortIndex_idx').on(t.kind, t.sortIndex)],
)

// ===========================================================================
// 社团
// ===========================================================================

export const circle = pgTable(
  'circle',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    slug: varchar('slug', { length: 128 }).notNull().unique(),
    /** 社团原名（几乎总是日文），**永不翻译、永不为空**——显示回退链的终点。 */
    nameOriginal: text('name_original').notNull(),
    nameOriginalLocale: localeEnum('name_original_locale')
      .notNull()
      .default('ja'),
    /** 译名袋，部分填充：{ zh?: '上海爱丽丝幻乐团', en?: 'Team Shanghai Alice' } */
    name: jsonb('name').$type<LocalizedText>().notNull().default({}),
    /** 别名/罗马音/旧名，喂 Meilisearch 同义词与自动补全。 */
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    bioMd: text('bio_md').notNull().default(''),
    bioLocale: localeEnum('bio_locale'),
    homepageUrl: text('homepage_url'),
    twitterHandle: varchar('twitter_handle', { length: 64 }),
    avatarKey: text('avatar_key'),
    /** 社团认领通道的落点：认领成功后该用户可管理社团页与发起下架。 */
    claimedByUserId: text('claimed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedById: text('verified_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    resourceCount: integer('resource_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('circle_claimedByUserId_idx').on(t.claimedByUserId),
    index('circle_aliases_idx').using('gin', t.aliases),
    check('circle_resourceCount_ck', sql`${t.resourceCount} >= 0`),
  ],
)

export const circleClaim = pgTable(
  'circle_claim',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    circleId: text('circle_id')
      .notNull()
      .references(() => circle.id, { onDelete: 'cascade' }),
    claimantId: text('claimant_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 举证链接（社团官网/推特/pixiv 的自我声明页）。 */
    evidenceUrl: text('evidence_url').notNull(),
    message: text('message').notNull().default(''),
    status: claimStatusEnum('status').notNull().default('open'),
    reviewedById: text('reviewed_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    ...timestamps(),
  },
  (t) => [
    // 同一人对同一社团只能有一条未决申请；处理完可再申请。
    uniqueIndex('circle_claim_open_uq')
      .on(t.circleId, t.claimantId)
      .where(sql`${t.status} in ('open', 'reviewing')`),
    index('circle_claim_status_createdAt_idx').on(t.status, t.createdAt),
    index('circle_claim_circleId_idx').on(t.circleId),
  ],
)

// ===========================================================================
// 标签（开放维度：格式 / 内容语言 / 内容警示 / 自由标签）
// ===========================================================================

export const tag = pgTable(
  'tag',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    kind: tagKindEnum('kind').notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    /** 显示名回退：name[locale] ?? slug。自由标签常常只有一种语言，这里允许全空。 */
    name: jsonb('name').$type<LocalizedText>().notNull().default({}),
    parentId: text('parent_id'),
    usageCount: integer('usage_count').notNull().default(0),
    /** 受控标签（staff 维护），普通用户不能自动创建同名。 */
    isCurated: boolean('is_curated').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('tag_kind_slug_uq').on(t.kind, t.slug),
    index('tag_kind_usageCount_idx').on(t.kind, t.usageCount.desc()),
    index('tag_parentId_idx').on(t.parentId),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'tag_parentId_fk',
    }).onDelete('set null'),
    check('tag_usageCount_ck', sql`${t.usageCount} >= 0`),
  ],
)

// ===========================================================================
// 资源
// ===========================================================================

export const resource = pgTable(
  'resource',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    slug: varchar('slug', { length: 128 }).notNull().unique(),

    // --- 多语标题：原文列 + 译名袋 ---------------------------------------
    /** 社团写在封面上的原始标题，**NOT NULL、永不翻译**。显示回退链保证有值。 */
    titleOriginal: text('title_original').notNull(),
    titleOriginalLocale: localeEnum('title_original_locale')
      .notNull()
      .default('ja'),
    /** 只装**译名**，不重复原文（原文的语种由 titleOriginalLocale 标定）。 */
    title: jsonb('title').$type<LocalizedText>().notNull().default({}),
    /** 长文（简介）在 resource_translation 侧表，不进 jsonb。 */

    categoryId: varchar('category_id', { length: 32 })
      .notNull()
      .references(() => resourceCategory.id, { onDelete: 'restrict' }),
    /** 首发展会。一个资源通常只在一个展会首发，单值 FK 足够；再版走 version.releasedAt。 */
    conventionId: varchar('convention_id', { length: 32 }).references(
      () => convention.id,
      {
        onDelete: 'set null',
      },
    ),

    coverKey: text('cover_key'),

    /** 用户注销不得连带删资源（legacy 的 cascade 会一并抹掉别人的评论与评分）。 */
    uploaderId: text('uploader_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // --- 状态机 ----------------------------------------------------------
    /** 默认 pending：先发后审。信任梯度达标时由应用在同一事务里直接置 published。 */
    status: resourceStatusEnum('status').notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    reviewedById: text('reviewed_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** 驳回理由，回显给上传者。 */
    reviewNote: text('review_note'),
    delistedAt: timestamp('delisted_at', { withTimezone: true }),

    // --- 许可（生死线） ---------------------------------------------------
    licenseStatus: licenseStatusEnum('license_status')
      .notNull()
      .default('unspecified'),
    /** 社团原文条款摘录。 */
    licenseNote: text('license_note'),
    /** 出处：社团官网 / 推文 / 说明书截图的 URL，争议时的第一证据。 */
    licenseSourceUrl: text('license_source_url'),
    licenseVerifiedById: text('license_verified_by_id').references(
      () => user.id,
      {
        onDelete: 'set null',
      },
    ),
    licenseVerifiedAt: timestamp('license_verified_at', { withTimezone: true }),

    // --- 冗余计数（列表排序需要；由 scripts/reconcile-counters 定期对账） ---
    downloadCount: integer('download_count').notNull().default(0),
    ratingSum: integer('rating_sum').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    favoriteCount: integer('favorite_count').notNull().default(0),
    thankCount: integer('thank_count').notNull().default(0),

    /** Meilisearch 同步水位：NULL 或早于 updatedAt 即待重建索引。 */
    searchIndexedAt: timestamp('search_indexed_at', { withTimezone: true }),

    ...timestamps(),
  },
  (t) => [
    // 列表页主路径
    index('resource_status_publishedAt_idx').on(t.status, t.publishedAt.desc()),
    index('resource_categoryId_status_idx').on(t.categoryId, t.status),
    index('resource_uploaderId_createdAt_idx').on(
      t.uploaderId,
      t.createdAt.desc(),
    ),
    index('resource_conventionId_idx').on(t.conventionId),
    index('resource_licenseStatus_idx').on(t.licenseStatus),
    // 审核队列：只扫待审行
    index('resource_pending_idx')
      .on(t.submittedAt)
      .where(sql`${t.status} = 'pending'`),
    // 「评分最高」排序：平均分表达式索引（legacy 每次全表算 case when）
    index('resource_ratingAvg_idx').on(
      sql`(case when rating_count = 0 then 0 else rating_sum::numeric / rating_count end) desc`,
    ),
    // 待索引队列
    index('resource_searchPending_idx')
      .on(t.updatedAt)
      .where(sql`${t.searchIndexedAt} is null`),
    check(
      'resource_counters_ck',
      sql`${t.downloadCount} >= 0 and ${t.ratingSum} >= 0 and ${t.ratingCount} >= 0
        and ${t.favoriteCount} >= 0 and ${t.thankCount} >= 0`,
    ),
    // rating_sum 必须落在 [1×count, 5×count]——冗余计数被写坏时立刻炸，而不是悄悄污染排行榜
    check(
      'resource_ratingSum_ck',
      sql`${t.ratingSum} >= ${t.ratingCount} and ${t.ratingSum} <= ${t.ratingCount} * 5`,
    ),
    // 已发布必须有发布时间（列表排序依赖它）
    check(
      'resource_publishedAt_ck',
      sql`${t.status} <> 'published' or ${t.publishedAt} is not null`,
    ),
  ],
)

/**
 * 长文按语种独立成行：简介需要**按语种独立贡献、审核、回滚**，
 * 塞进 jsonb 会让主表膨胀且无法做 per-locale 权限与来源标注。
 */
export const resourceTranslation = pgTable(
  'resource_translation',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    locale: localeEnum('locale').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    source: translationSourceEnum('source').notNull().default('uploader'),
    contributedById: text('contributed_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.locale] }),
    index('resource_translation_locale_idx').on(t.locale),
  ],
)

// ===========================================================================
// 版本 / 文件
// ===========================================================================

export const resourceVersion = pgTable(
  'resource_version',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    /** 'v1.2' / 'C105版' / '第二刷'——社团怎么写就怎么存。 */
    versionLabel: varchar('version_label', { length: 64 }).notNull(),
    changelogMd: text('changelog_md').notNull().default(''),
    /** 更新日志通常只有一种语言；需要多语时再开 resource_version_translation 侧表。 */
    changelogLocale: localeEnum('changelog_locale'),
    releasedAt: timestamp('released_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** 详情页默认下载指向的版本。每资源至多一个（partial unique 强制）。 */
    isLatest: boolean('is_latest').notNull().default(false),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    downloadCount: integer('download_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('resource_version_resourceId_label_uq').on(
      t.resourceId,
      t.versionLabel,
    ),
    // 「当前版本」不用 resource.currentVersionId 循环外键，用部分唯一索引表达
    uniqueIndex('resource_version_latest_uq')
      .on(t.resourceId)
      .where(sql`${t.isLatest}`),
    index('resource_version_resourceId_releasedAt_idx').on(
      t.resourceId,
      t.releasedAt.desc(),
    ),
    check('resource_version_downloadCount_ck', sql`${t.downloadCount} >= 0`),
  ],
)

/**
 * 文件挂在**版本**上，不挂资源。
 * `storageKind` 是判别联合：b2 分支有 s3Key，external 分支有 externalUrl——
 * 外链镜像从此走同一条下载/统计通路，而不是像 legacy 那样退化成展示型 jsonb。
 */
export const resourceFile = pgTable(
  'resource_file',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    versionId: text('version_id')
      .notNull()
      .references(() => resourceVersion.id, { onDelete: 'cascade' }),
    /** 展示用文件名，签名 GET 时写进 response-content-disposition。 */
    displayName: varchar('display_name', { length: 255 }).notNull(),
    storageKind: fileStorageKindEnum('storage_kind').notNull(),
    /** 私有桶对象 key（gensokyo-files）。封面走公开桶，不在这张表。 */
    s3Key: text('s3_key'),
    externalUrl: text('external_url'),
    /** 'mega.nz' / 'drive.google.com'，列表页展示镜像来源，也用于封禁失效站点。 */
    externalHost: varchar('external_host', { length: 128 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    checksumSha256: char('checksum_sha256', { length: 64 }),
    contentType: varchar('content_type', { length: 160 }),
    /** 两阶段直传：签名时 pending，HeadObject 回填后 uploaded。external 直接 uploaded。 */
    uploadState: uploadStateEnum('upload_state').notNull().default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    downloadCount: integer('download_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('resource_file_versionId_sortOrder_idx').on(t.versionId, t.sortOrder),
    // 同一个 B2 对象不能被两条 file 记录认领（配合 upload_intent 堵住「客户端上报别人的 key」）
    uniqueIndex('resource_file_s3Key_uq')
      .on(t.s3Key)
      .where(sql`${t.s3Key} is not null`),
    check(
      'resource_file_storage_ck',
      sql`(${t.storageKind} = 'b2' and ${t.s3Key} is not null and ${t.externalUrl} is null)
        or (${t.storageKind} = 'external' and ${t.externalUrl} is not null and ${t.s3Key} is null)`,
    ),
    check(
      'resource_file_sizeBytes_ck',
      sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`,
    ),
    check('resource_file_downloadCount_ck', sql`${t.downloadCount} >= 0`),
  ],
)

/**
 * 预签名直传的服务端账本。**没有这张表，`POST /resources` 就只能无条件相信客户端上报的 key**
 * （legacy 的原样漏洞：任意登录用户可把别人的 B2 对象挂到自己的资源上）。
 * 流程：presign 时插一行 → 客户端 PUT → 确认接口 HeadObject 回填真实 size/etag → state=uploaded
 *      → 建 file 时只接受 `userId` 匹配且 `state='uploaded'` 且未被消费的 key。
 */
export const uploadIntent = pgTable(
  'upload_intent',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: uploadKindEnum('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    declaredName: varchar('declared_name', { length: 255 }).notNull(),
    declaredSize: bigint('declared_size', { mode: 'number' }).notNull(),
    contentType: varchar('content_type', { length: 160 }),
    state: uploadStateEnum('state').notNull().default('pending'),
    /** S3 multipart uploadId，用于 abort 与「扫 ListMultipartUploads 清残留」定时任务。 */
    multipartUploadId: text('multipart_upload_id'),
    verifiedSize: bigint('verified_size', { mode: 'number' }),
    verifiedEtag: text('verified_etag'),
    /** 一次性消费：一个 intent 只能变成一个 file。 */
    consumedByFileId: text('consumed_by_file_id')
      .unique()
      .references(() => resourceFile.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('upload_intent_userId_createdAt_idx').on(
      t.userId,
      t.createdAt.desc(),
    ),
    // GC 队列：过期未完成的 intent → abort multipart + 删孤儿对象
    index('upload_intent_gc_idx')
      .on(t.expiresAt)
      .where(sql`${t.state} = 'pending'`),
    check('upload_intent_declaredSize_ck', sql`${t.declaredSize} > 0`),
  ],
)

// ===========================================================================
// 内容系统：topic + post（M3 = 资源评论视图，M4 = 论坛视图，同一份数据）
// ===========================================================================

/**
 * 讨论主题。资源评论区与论坛帖是**同一张表**——这是已批准的结构性决策。
 *
 * 用「带判别列的可空外键」而不是 `(subjectType, subjectId)` 无类型多态：
 * resourceId 是真外键，级联、完整性、`with: { topic: true }` 全部成立。
 * M4 追加 `board_id text references board(id)` 与放宽后的 CHECK——纯 additive ALTER，不动数据。
 */
export const topic = pgTable(
  'topic',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    kind: topicKindEnum('kind').notNull(),
    /** kind='resource' 时非空且唯一（1:1）；kind='forum' 时为空。真外键，不是 legacy 那种裸列。 */
    resourceId: text('resource_id')
      .unique()
      .references(() => resource.id, { onDelete: 'cascade' }),
    /** 论坛主题必填；资源主题为空（标题从 resource 派生，避免两份标题不同步）。 */
    title: text('title'),
    authorId: text('author_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    isLocked: boolean('is_locked').notNull().default(false),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    /** 楼层号发号器兼计数：新楼 floorNo = postCount + 1，同事务 `UPDATE ... RETURNING`。 */
    postCount: integer('post_count').notNull().default(0),
    lastPostedAt: timestamp('last_posted_at', { withTimezone: true }),
    lastPostById: text('last_post_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    index('topic_kind_lastPostedAt_idx').on(t.kind, t.lastPostedAt.desc()),
    index('topic_authorId_idx').on(t.authorId),
    check(
      'topic_target_ck',
      sql`(${t.kind} = 'resource' and ${t.resourceId} is not null and ${t.title} is null)
        or (${t.kind} = 'forum' and ${t.resourceId} is null and ${t.title} is not null)`,
    ),
    check('topic_postCount_ck', sql`${t.postCount} >= 0`),
  ],
)

/**
 * 楼层。产品心智是 NGA/贴吧式「版块 → 主题 → 楼层 + 引用」，**不是无限层级树**：
 * 扁平 floorNo + `replyToPostId` 引用，分页/通知/@提及全部简单。
 * 楼层不物理删除（否则楼层号断裂），走 status + deletedAt 软删。
 */
export const post = pgTable(
  'post',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    topicId: text('topic_id')
      .notNull()
      .references(() => topic.id, { onDelete: 'cascade' }),
    floorNo: integer('floor_no').notNull(),
    /** 用户注销后置空并保留楼层，不 cascade（legacy 的 cascade 会在楼层里挖洞）。 */
    authorId: text('author_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    bodyMd: text('body_md').notNull(),
    /** 真正的自引用外键（legacy 的裸 integer parentId 可以挂孤儿回复）。 */
    replyToPostId: text('reply_to_post_id'),
    status: postStatusEnum('status').notNull().default('visible'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editCount: integer('edit_count').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedById: text('deleted_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('post_topicId_floorNo_uq').on(t.topicId, t.floorNo),
    index('post_topicId_createdAt_idx').on(t.topicId, t.createdAt),
    index('post_authorId_createdAt_idx').on(t.authorId, t.createdAt.desc()),
    index('post_replyToPostId_idx').on(t.replyToPostId),
    foreignKey({
      columns: [t.replyToPostId],
      foreignColumns: [t.id],
      name: 'post_replyToPostId_fk',
    }).onDelete('set null'),
    check('post_floorNo_ck', sql`${t.floorNo} >= 1`),
  ],
)

// ===========================================================================
// 关联表
// ===========================================================================

export const resourceCircle = pgTable(
  'resource_circle',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    circleId: text('circle_id')
      .notNull()
      .references(() => circle.id, { onDelete: 'cascade' }),
    /** 一个汉化补丁同时有原社团和汉化组——legacy 的 circle+author 两列表达不了。 */
    role: circleRoleEnum('role').notNull().default('circle'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.circleId, t.role] }),
    // 反向：社团页列资源
    index('resource_circle_circleId_idx').on(t.circleId, t.resourceId),
  ],
)

export const resourceWork = pgTable(
  'resource_work',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    workId: varchar('work_id', { length: 32 })
      .notNull()
      .references(() => touhouWork.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.workId] }),
    index('resource_work_workId_idx').on(t.workId, t.resourceId),
  ],
)

export const resourceTag = pgTable(
  'resource_tag',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
    addedById: text('added_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.tagId] }),
    // 反向（按标签筛资源）——legacy 只有正向复合主键，这条路径全表扫
    index('resource_tag_tagId_idx').on(t.tagId, t.resourceId),
  ],
)

// ===========================================================================
// 互动
// ===========================================================================

/** 复合主键 = 天然的「一人一资源一评分」，无代理键、无冗余唯一索引。 */
export const rating = pgTable(
  'rating',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    score: smallint('score').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.userId] }),
    // 主键列序是 (resource, user)，个人主页「我的评分」需要反向索引
    index('rating_userId_updatedAt_idx').on(t.userId, t.updatedAt.desc()),
    // zod 校 API 边界，DB 校数据不变式——绕过路由的脚本/后台一样挡住
    check('rating_score_ck', sql`${t.score} between 1 and 5`),
  ],
)

export const favorite = pgTable(
  'favorite',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.userId] }),
    index('favorite_userId_createdAt_idx').on(t.userId, t.createdAt.desc()),
  ],
)

/** 「感谢」：与评分正交的轻量正反馈（产品文档要求，legacy 没有）。 */
export const thank = pgTable(
  'thank',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.userId] }),
    index('thank_userId_createdAt_idx').on(t.userId, t.createdAt.desc()),
  ],
)

/**
 * 「已计次的下载」日志——不是原始访问日志（原始访问量看 B2/CDN 日志，不进 PG）。
 * 唯一约束本身就是防灌水机制：同一 (文件, 来源, 自然日) 只计一次。
 * **不存明文 IP**：存每日轮换盐的 sha256，满足 EU/日本用户的 PII 预期；90 天后由 GC 任务清理，
 * 长期统计留在 resource_download_daily。
 */
export const downloadLog = pgTable(
  'download_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    versionId: text('version_id').references(() => resourceVersion.id, {
      onDelete: 'set null',
    }),
    fileId: text('file_id').references(() => resourceFile.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    ipHash: char('ip_hash', { length: 64 }).notNull(),
    countryCode: char('country_code', { length: 2 }),
    dayBucket: date('day_bucket').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('download_log_dedupe_uq')
      .on(t.fileId, t.ipHash, t.dayBucket)
      .where(sql`${t.fileId} is not null`),
    index('download_log_resourceId_createdAt_idx').on(
      t.resourceId,
      t.createdAt.desc(),
    ),
    index('download_log_versionId_dayBucket_idx').on(t.versionId, t.dayBucket),
    index('download_log_dayBucket_idx').on(t.dayBucket),
  ],
)

/** 日汇总。图表读这张表，downloadLog 可按保留期裁剪而不丢历史曲线。 */
export const resourceDownloadDaily = pgTable(
  'resource_download_daily',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    dayBucket: date('day_bucket').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.dayBucket] }),
    index('resource_download_daily_dayBucket_idx').on(t.dayBucket),
    check('resource_download_daily_count_ck', sql`${t.count} >= 0`),
  ],
)

// ===========================================================================
// 治理：举报 / 下架申请 / 审计
// ===========================================================================

/**
 * 举报是**多态**的（资源/楼层/用户/社团），这里刻意用 `(targetType, targetId)` 而非四个可空外键：
 * 举报是治理侧日志，目标被删后**仍应保留**（这正是 FK 级联会破坏的东西），
 * 且统一寻址才能让 partial unique 防刷、审核队列排序、跨类型面板用同一套索引。
 * 目标存在性由应用层校验 + 夜间孤儿巡检，不由 FK 保证。
 */
export const report = pgTable(
  'report',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: text('target_id').notNull(),
    /** 注销后保留举报（set null 而非 cascade）。 */
    reporterId: text('reporter_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reporterIpHash: char('reporter_ip_hash', { length: 64 }),
    kind: reportKindEnum('kind').notNull(),
    detail: text('detail').notNull(),
    status: reportStatusEnum('status').notNull().default('open'),
    assigneeId: text('assignee_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    resolution: text('resolution'),
    resolvedById: text('resolved_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // 防刷：同一人对同一目标只能有一条未决举报；处理完可再报
    uniqueIndex('report_open_uq')
      .on(t.targetType, t.targetId, t.reporterId)
      .where(sql`${t.status} in ('open', 'reviewing')`),
    index('report_status_createdAt_idx').on(t.status, t.createdAt),
    index('report_target_idx').on(t.targetType, t.targetId),
    index('report_assigneeId_idx').on(t.assigneeId),
  ],
)

/**
 * 下架申请：版权生死线的**独立通道**，不混进普通举报队列。
 * 申请人常常不是站内用户（社团成员直接来信），所以 requesterUserId 可空、姓名与邮箱是必填的联系信息。
 * contactEmail 是 PII：仅供争议处理，处理完 N 天后由 GC 任务置空，只留结论。
 */
export const takedownRequest = pgTable(
  'takedown_request',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    requesterUserId: text('requester_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    requesterName: text('requester_name').notNull(),
    requesterRelation: takedownRelationEnum('requester_relation').notNull(),
    contactEmail: text('contact_email'),
    evidenceUrl: text('evidence_url').notNull(),
    statementMd: text('statement_md').notNull(),
    status: takedownStatusEnum('status').notNull().default('open'),
    handledById: text('handled_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    ...timestamps(),
  },
  (t) => [
    index('takedown_request_status_createdAt_idx').on(t.status, t.createdAt),
    index('takedown_request_resourceId_idx').on(t.resourceId),
  ],
)

/**
 * 资源生命周期审计。**法务价值不是技术洁癖**：版权争议时要能证明
 * 「我们何时、依据什么、由谁把状态/许可改成了什么」。状态与许可共用一条时间线，
 * 因为争议时你要看的是这个资源身上发生过的**全部**事情。
 */
export const resourceAuditLog = pgTable(
  'resource_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    event: resourceAuditEventEnum('event').notNull(),
    fromStatus: resourceStatusEnum('from_status'),
    toStatus: resourceStatusEnum('to_status'),
    fromLicense: licenseStatusEnum('from_license'),
    toLicense: licenseStatusEnum('to_license'),
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /** 自动化动作（信任梯度直发、GC 下架）没有 actor，用这一列区分「系统」与「人」。 */
    isAutomated: boolean('is_automated').notNull().default(false),
    reason: text('reason'),
    reportId: text('report_id').references(() => report.id, {
      onDelete: 'set null',
    }),
    takedownRequestId: text('takedown_request_id').references(
      () => takedownRequest.id,
      {
        onDelete: 'set null',
      },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('resource_audit_log_resourceId_createdAt_idx').on(
      t.resourceId,
      t.createdAt.desc(),
    ),
    index('resource_audit_log_event_createdAt_idx').on(
      t.event,
      t.createdAt.desc(),
    ),
    index('resource_audit_log_actorId_idx').on(t.actorId),
    check(
      'resource_audit_log_payload_ck',
      sql`(${t.event} <> 'status_change' or ${t.toStatus} is not null)
        and (${t.event} <> 'license_change' or ${t.toLicense} is not null)`,
    ),
  ],
)

// ===========================================================================
// 关系（legacy 只声明了 4 组，导致一半的表用不了 db.query.*.findMany({ with }））
// ===========================================================================

export const resourceCategoryRelations = relations(
  resourceCategory,
  ({ many }) => ({
    resources: many(resource),
  }),
)

export const conventionRelations = relations(convention, ({ many }) => ({
  resources: many(resource),
}))

export const touhouWorkRelations = relations(touhouWork, ({ many }) => ({
  resources: many(resourceWork),
}))

export const circleRelations = relations(circle, ({ one, many }) => ({
  claimedBy: one(user, {
    fields: [circle.claimedByUserId],
    references: [user.id],
  }),
  resources: many(resourceCircle),
  claims: many(circleClaim),
}))

export const circleClaimRelations = relations(circleClaim, ({ one }) => ({
  circle: one(circle, {
    fields: [circleClaim.circleId],
    references: [circle.id],
  }),
  claimant: one(user, {
    fields: [circleClaim.claimantId],
    references: [user.id],
  }),
  reviewedBy: one(user, {
    fields: [circleClaim.reviewedById],
    references: [user.id],
  }),
}))

export const tagRelations = relations(tag, ({ one, many }) => ({
  parent: one(tag, {
    fields: [tag.parentId],
    references: [tag.id],
    relationName: 'tagTree',
  }),
  children: many(tag, { relationName: 'tagTree' }),
  resources: many(resourceTag),
}))

export const topicRelations = relations(topic, ({ one, many }) => ({
  resource: one(resource, {
    fields: [topic.resourceId],
    references: [resource.id],
  }),
  author: one(user, { fields: [topic.authorId], references: [user.id] }),
  posts: many(post),
}))

export const postRelations = relations(post, ({ one, many }) => ({
  topic: one(topic, { fields: [post.topicId], references: [topic.id] }),
  author: one(user, { fields: [post.authorId], references: [user.id] }),
  replyTo: one(post, {
    fields: [post.replyToPostId],
    references: [post.id],
    relationName: 'postQuote',
  }),
  replies: many(post, { relationName: 'postQuote' }),
}))

export const resourceRelations = relations(resource, ({ one, many }) => ({
  category: one(resourceCategory, {
    fields: [resource.categoryId],
    references: [resourceCategory.id],
  }),
  convention: one(convention, {
    fields: [resource.conventionId],
    references: [convention.id],
  }),
  uploader: one(user, { fields: [resource.uploaderId], references: [user.id] }),
  reviewedBy: one(user, {
    fields: [resource.reviewedById],
    references: [user.id],
  }),
  licenseVerifiedBy: one(user, {
    fields: [resource.licenseVerifiedById],
    references: [user.id],
  }),
  topic: one(topic, { fields: [resource.id], references: [topic.resourceId] }),
  translations: many(resourceTranslation),
  versions: many(resourceVersion),
  circles: many(resourceCircle),
  works: many(resourceWork),
  tags: many(resourceTag),
  ratings: many(rating),
  favorites: many(favorite),
  thanks: many(thank),
  downloads: many(downloadLog),
  dailyDownloads: many(resourceDownloadDaily),
  takedownRequests: many(takedownRequest),
  auditLogs: many(resourceAuditLog),
}))

export const resourceTranslationRelations = relations(
  resourceTranslation,
  ({ one }) => ({
    resource: one(resource, {
      fields: [resourceTranslation.resourceId],
      references: [resource.id],
    }),
    contributedBy: one(user, {
      fields: [resourceTranslation.contributedById],
      references: [user.id],
    }),
  }),
)

export const resourceVersionRelations = relations(
  resourceVersion,
  ({ one, many }) => ({
    resource: one(resource, {
      fields: [resourceVersion.resourceId],
      references: [resource.id],
    }),
    createdBy: one(user, {
      fields: [resourceVersion.createdById],
      references: [user.id],
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

export const uploadIntentRelations = relations(uploadIntent, ({ one }) => ({
  user: one(user, { fields: [uploadIntent.userId], references: [user.id] }),
  consumedByFile: one(resourceFile, {
    fields: [uploadIntent.consumedByFileId],
    references: [resourceFile.id],
  }),
}))

export const resourceCircleRelations = relations(resourceCircle, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceCircle.resourceId],
    references: [resource.id],
  }),
  circle: one(circle, {
    fields: [resourceCircle.circleId],
    references: [circle.id],
  }),
}))

export const resourceWorkRelations = relations(resourceWork, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceWork.resourceId],
    references: [resource.id],
  }),
  work: one(touhouWork, {
    fields: [resourceWork.workId],
    references: [touhouWork.id],
  }),
}))

export const resourceTagRelations = relations(resourceTag, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceTag.resourceId],
    references: [resource.id],
  }),
  tag: one(tag, { fields: [resourceTag.tagId], references: [tag.id] }),
  addedBy: one(user, {
    fields: [resourceTag.addedById],
    references: [user.id],
  }),
}))

export const ratingRelations = relations(rating, ({ one }) => ({
  resource: one(resource, {
    fields: [rating.resourceId],
    references: [resource.id],
  }),
  user: one(user, { fields: [rating.userId], references: [user.id] }),
}))

export const favoriteRelations = relations(favorite, ({ one }) => ({
  resource: one(resource, {
    fields: [favorite.resourceId],
    references: [resource.id],
  }),
  user: one(user, { fields: [favorite.userId], references: [user.id] }),
}))

export const thankRelations = relations(thank, ({ one }) => ({
  resource: one(resource, {
    fields: [thank.resourceId],
    references: [resource.id],
  }),
  user: one(user, { fields: [thank.userId], references: [user.id] }),
}))

export const downloadLogRelations = relations(downloadLog, ({ one }) => ({
  resource: one(resource, {
    fields: [downloadLog.resourceId],
    references: [resource.id],
  }),
  version: one(resourceVersion, {
    fields: [downloadLog.versionId],
    references: [resourceVersion.id],
  }),
  file: one(resourceFile, {
    fields: [downloadLog.fileId],
    references: [resourceFile.id],
  }),
  user: one(user, { fields: [downloadLog.userId], references: [user.id] }),
}))

export const resourceDownloadDailyRelations = relations(
  resourceDownloadDaily,
  ({ one }) => ({
    resource: one(resource, {
      fields: [resourceDownloadDaily.resourceId],
      references: [resource.id],
    }),
  }),
)

export const reportRelations = relations(report, ({ one }) => ({
  reporter: one(user, { fields: [report.reporterId], references: [user.id] }),
  assignee: one(user, { fields: [report.assigneeId], references: [user.id] }),
  resolvedBy: one(user, {
    fields: [report.resolvedById],
    references: [user.id],
  }),
}))

export const takedownRequestRelations = relations(
  takedownRequest,
  ({ one }) => ({
    resource: one(resource, {
      fields: [takedownRequest.resourceId],
      references: [resource.id],
    }),
    requester: one(user, {
      fields: [takedownRequest.requesterUserId],
      references: [user.id],
    }),
    handledBy: one(user, {
      fields: [takedownRequest.handledById],
      references: [user.id],
    }),
  }),
)

export const resourceAuditLogRelations = relations(
  resourceAuditLog,
  ({ one }) => ({
    resource: one(resource, {
      fields: [resourceAuditLog.resourceId],
      references: [resource.id],
    }),
    actor: one(user, {
      fields: [resourceAuditLog.actorId],
      references: [user.id],
    }),
    report: one(report, {
      fields: [resourceAuditLog.reportId],
      references: [report.id],
    }),
    takedownRequest: one(takedownRequest, {
      fields: [resourceAuditLog.takedownRequestId],
      references: [takedownRequest.id],
    }),
  }),
)

// ===========================================================================
// 推导类型
// ===========================================================================

export type Resource = typeof resource.$inferSelect
export type NewResource = typeof resource.$inferInsert
export type ResourceTranslation = typeof resourceTranslation.$inferSelect
export type ResourceVersion = typeof resourceVersion.$inferSelect
export type NewResourceVersion = typeof resourceVersion.$inferInsert
export type ResourceFile = typeof resourceFile.$inferSelect
export type NewResourceFile = typeof resourceFile.$inferInsert
export type UploadIntent = typeof uploadIntent.$inferSelect
export type NewUploadIntent = typeof uploadIntent.$inferInsert
export type Circle = typeof circle.$inferSelect
export type NewCircle = typeof circle.$inferInsert
export type CircleClaim = typeof circleClaim.$inferSelect
export type Tag = typeof tag.$inferSelect
export type TouhouWork = typeof touhouWork.$inferSelect
export type Convention = typeof convention.$inferSelect
export type ResourceCategory = typeof resourceCategory.$inferSelect
export type Topic = typeof topic.$inferSelect
export type NewTopic = typeof topic.$inferInsert
export type Post = typeof post.$inferSelect
export type NewPost = typeof post.$inferInsert
export type Rating = typeof rating.$inferSelect
export type Favorite = typeof favorite.$inferSelect
export type Thank = typeof thank.$inferSelect
export type DownloadLog = typeof downloadLog.$inferSelect
export type Report = typeof report.$inferSelect
export type NewReport = typeof report.$inferInsert
export type TakedownRequest = typeof takedownRequest.$inferSelect
export type ResourceAuditLog = typeof resourceAuditLog.$inferSelect
export type NewResourceAuditLog = typeof resourceAuditLog.$inferInsert
