# M3 香霖堂（资源分发）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 香霖堂资源分发闭环可用：**上传 → 审核 → 分发 → 互动**，且两条版权生死线成立（每个资源有许可状态、下架通道走得通、pending 内容下载不到）。

**Architecture:** zod 契约在 `@gensokyo/shared` → hono 校验与 `AppType` → RR8 loader/action。存储用 Bun 原生 `S3Client`（不引 aws-sdk），单次预签名 PUT。评论从第一天就是 `topic + post`（M4 论坛共用同一份数据）。

**Tech Stack:** Bun / hono / zod v4 / drizzle + PostgreSQL 18 / React Router v8 / Paraglide / Backblaze B2

**Spec:** `docs/superpowers/specs/2026-08-30-gensokyo-monorepo-design.md` · 产品文档 `docs/product/2026-08-30-platform-direction.md`
**调研原始材料：** `docs/superpowers/research/2026-08-30-m3-kourindou/`（含 legacy 逐字段分析、B2 链路、两份对抗审查）

## 范围决策：为什么比调研方案小得多

调研的设计 agent 提出 **28 张表 / 58 条路由 / 40 个文件**；对抗审查（`critiques-simplify.md`）判定其过度设计，本计划采纳其削减意见，收敛到 **~13 张表 / ~30 条路由**。

审查里有一条方法论纠正必须写在最前面，它推翻了原方案大量论证：

> **库里没有数据时，「现在不建表以后要迁移」这个论证不成立。** `rm -rf drizzle && generate && migrate` 是零成本的。真正不可逆的只有三样：**已上传到 B2 的对象布局（双桶）**、**已对外发出的 URL / slug**、**法律留痕**。除此之外的"预留"一律按 YAGNI 处理。

据此砍掉（详见 `critiques-simplify.md` D1–D10、A1–A3）：

| 砍掉 | 理由 |
|---|---|
| 整条 multipart 上传 | 单次预签名 PUT 上限 5 GB，覆盖同人游戏/图集/无损专辑的全部可预见体积。连带消掉 aws-sdk 依赖、CRC32 陷阱、分片清理 cron |
| `resource_translation` 侧表 | 一整套社区翻译子系统，却不打算给它任何写入口。改为 `description jsonb`，与 `title` 同形状 |
| `touhou_work` / `convention` / `resource_work` 三张表 | M3 对它们的全部操作是"按它筛选 + 显示多语名"，与 `tag` 完全同构。并入 `tag` + `tag.kind` |
| `thank`（感谢） | 与收藏高度重叠，产品上没有区分需求 |
| 匿名下架的 3 个公开端点 + token | 上线时资源数近 0，下架函数量为 0。法律要求靠 **静态页 + 邮箱 + 保留 `takedown_request` 表手工录入** 即满足 |
| `search_outbox` + worker | 三位数资源量。改为提交后 try/catch 推 Meili + 每晚全量重建（`scripts/reindex.ts` 本来就必须写） |
| `storage_gc_queue` 表 | 改为夜间 `ListObjects` 反连接巡检——巡检幂等自愈，队列会漂移 |
| `resource_download_daily` 日聚合表 | `download_log` 上一句 `GROUP BY date_trunc` 足够到万级 |
| 全套 `*.service.ts` 分层 | 今天只有 `content/post.ts` 真有第二个调用方（M4）。其余是单调用方的间接层，且分层边界没有编译器保护，必然漂移 |
| `packages/storage` 独立包 | 单一消费者，~120 行。放 `apps/api/src/storage.ts` |
| 45 个错误码的 i18n 流水线 | 砍到实际会抛出的那些（~12 个） |

**反过来，这几件不能省**（真正不可逆，或产品文档明确承诺）：

- **评论从第一天就是 `topic + post`** —— 产品文档第 1 号已批准决策（资源评论与论坛帖同源）。推到 M4 就要做数据迁移
- **许可状态字段 + 变更留痕** —— 版权争议随时可能来，法务证据链没有补录的可能
- **双桶（public / private）** —— 整桶 public 上线后再改要重传全部对象
- **`upload_intent` 核销** —— 不做则上线首日就有越权挂载他人对象的洞
- **`resource.uploaderId` 用 `set null` 而非 cascade** —— cascade 上线后误删一个用户即不可逆数据丢失

## Global Constraints

沿用 M1/M2 全部约定（Bun、Biome、`.basePath('/api')`、链式 `.route()` 保 `AppType`、Paraglide 三语无裸字符串、`bun run services` 起依赖），另加：

- **id schema 分三种**（`critiques-gaps.md` P0-3，已实测）：better-auth 的 `generateId` 产生 **32 位随机字母数字串，不是 UUID**。因此 `userIdSchema = z.string().min(1).max(64)`；业务实体用 `entityIdSchema = z.uuid()`（`Bun.randomUUIDv7()`）；查找表用 `slugIdSchema`。**任何地方写 `z.uuid()` 校验用户 id 都会对每个真实用户返回 400**
- **GC 谓词一律用白名单**（"被已知引用表引用的对象保留"），绝不用取反黑名单——同 `critiques-gaps.md` P0-6，黑名单会删光全站封面
- 数据库可破坏性重建（无存量数据）：删迁移重新 `generate`，不写增量迁移
- 存储只用 `Bun.S3Client`，**不引入 `@aws-sdk/*`**
- 上传时把 `Content-Disposition: attachment; filename*=UTF-8''…` 作为签名头写进对象元数据，之后任何签名 GET 自带正确文件名
- 每个 Task 结尾 `bun run check && typecheck && test` 通过再提交

---

### T1: `@gensokyo/shared` 香霖堂契约

**Files:** Create `packages/shared/src/kourindou/{enums,localized,schemas}.ts`、`index.ts`、`localized.test.ts`；Modify `packages/shared/src/index.ts`

**Interfaces:** Produces `RESOURCE_STATUS` / `LICENSE_STATUS` / `TAG_KIND` / `TRUST_LEVEL` / `REVIEW_DECISION` 等枚举常量；`localizedTextSchema`、`resolveLocalized()`；`entityIdSchema` / `userIdSchema` / `slugIdSchema`；`createResourceSchema` / `listResourcesQuerySchema` / `presignUploadSchema` / `rateSchema` / `createPostSchema` / `createReportSchema`

- [ ] **Step 1: 枚举与 id schema**（唯一事实来源，DDL 与校验都从这里派生）

```ts
// packages/shared/src/kourindou/enums.ts
export const RESOURCE_STATUS = ['draft', 'pending', 'published', 'delisted'] as const
export const LICENSE_STATUS = ['allowed', 'unspecified', 'out_of_print', 'licensed'] as const
export const RESOURCE_KIND = ['game', 'music', 'doujinshi', 'patch', 'tool'] as const
export const TAG_KIND = ['work', 'convention', 'language', 'other'] as const
export const REVIEW_DECISION = ['approve', 'reject'] as const
export const REJECT_REASON = ['copyright', 'illegal', 'low_quality', 'duplicate', 'other'] as const
export type ResourceStatus = (typeof RESOURCE_STATUS)[number]
// …其余同形
```

```ts
// packages/shared/src/kourindou/schemas.ts —— id 分三种是硬要求，理由见 Global Constraints
import { z } from 'zod'
export const entityIdSchema = z.uuid()
export const userIdSchema = z.string().min(1).max(64)
export const slugIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
```

- [ ] **Step 2: 多语文本 + 失败测试**

`localized.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { resolveLocalized } from './localized'

describe('resolveLocalized', () => {
  test('命中请求语言', () => {
    expect(resolveLocalized('原題', 'ja', { zh: '中文名' }, 'zh')).toBe('中文名')
  })
  test('未命中回落到原文，绝不返回空串', () => {
    expect(resolveLocalized('原題', 'ja', {}, 'en')).toBe('原題')
  })
  test('译名为空白视为缺失', () => {
    expect(resolveLocalized('原題', 'ja', { en: '   ' }, 'en')).toBe('原題')
  })
})
```

Run: `cd packages/shared && bun test` → FAIL（模块不存在）

- [ ] **Step 3: 实现 localized**

```ts
// packages/shared/src/kourindou/localized.ts
import { z } from 'zod'
export const LOCALES = ['zh', 'ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const localizedTextSchema = z.partialRecord(z.enum(LOCALES), z.string().max(2000))
export type LocalizedText = z.infer<typeof localizedTextSchema>

/** 原文 + 译名表 → 请求语言的显示值。原文必填，因此永不返回空串。 */
export function resolveLocalized(
  original: string,
  _originalLocale: Locale | string,
  translations: LocalizedText | null | undefined,
  requested: Locale,
): string {
  const t = translations?.[requested]
  return t && t.trim() !== '' ? t : original
}
```

- [ ] **Step 4: 业务 schema**（节选，其余同形；全部导出到 `kourindou/index.ts`）

```ts
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
})

export const listResourcesQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(RESOURCE_KIND).optional(),
  license: z.enum(LICENSE_STATUS).optional(),
  tag: z.array(slugIdSchema).max(6).optional(),
  uploaderId: userIdSchema.optional(),   // ← 不是 uuid
  q: z.string().max(100).optional(),
  sort: z.enum(['newest', 'downloads', 'rating']).default('newest'),
})

export const presignUploadSchema = z.object({
  kind: z.enum(['cover', 'file']),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(150),
  sizeBytes: z.number().int().positive().max(5 * 1024 ** 3), // 单次 PUT 上限
})
```

- [ ] **Step 5: 验证并提交**

Run: `bun test && bun run typecheck` → 全绿
```bash
git add packages/shared && git commit -m "feat: kourindou contracts in @gensokyo/shared"
```

### T2: db schema + 迁移 + 种子

**Files:** Create `packages/db/src/schema/kourindou.ts`、`content.ts`、`scripts/seed.ts`；Modify `packages/db/src/schema/index.ts`、`packages/db/package.json`

**Interfaces:** Consumes T1 枚举。Produces 13 张表：`resource` `resource_version` `resource_file` `upload_intent` `storage_object` `circle` `circle_claim` `tag` `resource_tag` `resource_category`(查找) `rating` `favorite` `report` `takedown_request` `download_log` `user_profile` `moderation_log`，以及 `content.ts` 的 `topic` `post`

- [ ] **Step 1: 核心资源表**（枚举用 pgEnum，值从 T1 常量派生，保证两边不漂移）

```ts
import { LICENSE_STATUS, RESOURCE_KIND, RESOURCE_STATUS } from '@gensokyo/shared'
export const resourceStatus = pgEnum('resource_status', RESOURCE_STATUS)
export const licenseStatus = pgEnum('license_status', LICENSE_STATUS)

export const resource = pgTable('resource', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 128 }).notNull().unique(),
  titleOriginal: varchar('title_original', { length: 200 }).notNull(),
  titleOriginalLocale: varchar('title_original_locale', { length: 8 }).notNull(),
  title: jsonb('title').$type<LocalizedText>().notNull().default({}),
  description: jsonb('description').$type<LocalizedText>().notNull().default({}),
  kind: resourceKind('kind').notNull(),
  status: resourceStatus('status').notNull().default('draft'),
  license: licenseStatus('license').notNull(),
  licenseNote: varchar('license_note', { length: 500 }),
  // 误删用户不应连带删除资源（不可逆数据丢失）
  uploaderId: text('uploader_id').references(() => user.id, { onDelete: 'set null' }),
  circleId: uuid('circle_id').references(() => circle.id, { onDelete: 'set null' }),
  coverObjectId: uuid('cover_object_id').references(() => storageObject.id, { onDelete: 'set null' }),
  downloadCount: integer('download_count').notNull().default(0),
  ratingSum: integer('rating_sum').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('resource_status_created_idx').on(t.status, t.createdAt.desc()),
  index('resource_uploader_idx').on(t.uploaderId),   // legacy 漏了这个，「我的资源」全表扫
  index('resource_kind_idx').on(t.kind),
])
```

- [ ] **Step 2: `storage_object` 统管所有 B2 对象**（封面/文件/头像同一张表，GC 才有白名单可用）

```ts
export const storageObject = pgTable('storage_object', {
  id: uuid('id').primaryKey().defaultRandom(),
  bucket: varchar('bucket', { length: 16 }).notNull(),      // 'public' | 'private'
  key: text('key').notNull().unique(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  contentType: varchar('content_type', { length: 150 }),
  checksum: text('checksum'),
  deleteAfter: timestamp('delete_after', { withTimezone: true }),  // 置值即等待 GC
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: `topic` + `post`**（M4 论坛共用；`topic` 多态指向资源或版块）

```ts
export const topic = pgTable('topic', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: topicKind('kind').notNull(),                 // 'resource' | 'board'
  resourceId: uuid('resource_id').references(() => resource.id, { onDelete: 'cascade' }).unique(),
  boardSlug: varchar('board_slug', { length: 32 }),  // M4 用
  title: varchar('title', { length: 200 }),
  postCount: integer('post_count').notNull().default(0),
  lastPostAt: timestamp('last_post_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const post = pgTable('post', {
  id: uuid('id').primaryKey().defaultRandom(),
  topicId: uuid('topic_id').notNull().references(() => topic.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
  // legacy 的 parentId 是裸 integer 无外键，可插孤儿；这里补上自引用
  parentId: uuid('parent_id').references((): AnyPgColumn => post.id, { onDelete: 'set null' }),
  floor: integer('floor').notNull(),
  bodyMd: text('body_md').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('post_topic_floor_idx').on(t.topicId, t.floor),
  uniqueIndex('post_topic_floor_uq').on(t.topicId, t.floor),
])
```

- [ ] **Step 4: 互动表用复合主键**（legacy 这点做对了，沿用）

```ts
export const rating = pgTable('rating', {
  resourceId: uuid('resource_id').notNull().references(() => resource.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.resourceId, t.userId] }),
  index('rating_user_idx').on(t.userId),   // 个人主页要按用户查，legacy 漏了
  check('rating_score_range', sql`${t.score} between 1 and 5`),  // legacy 只在 zod 里，绕过 API 就能写 999
])
```

- [ ] **Step 5: `user_profile`**（信任梯度的载体，M3 第一天就要用）

```ts
export const userProfile = pgTable('user_profile', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  role: userRole('role').notNull().default('user'),        // user | moderator | admin
  approvedResourceCount: integer('approved_resource_count').notNull().default(0),
  strikeCount: integer('strike_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 6: 生成迁移、应用、写种子**

Run:
```bash
cd packages/db && rm -rf drizzle && bun run generate && bun run migrate
```
种子 `scripts/seed.ts`：`resource_category` 五类 + `tag`（kind=work 的 th06–th20、kind=convention 的 C95–C107、kind=language 的 zh/ja/en），多语名走 jsonb。

- [ ] **Step 7: 连库测试并提交**

`packages/db/src/kourindou.test.ts`：断言 17 张表存在、`rating_score_range` CHECK 生效（插 score=9 应抛错）、`post_topic_floor_uq` 生效。

Run: `bun test` → 全绿，提交。

### T3: api 横切层（env / 错误信封 / 会话与权限）

**Files:** Create `apps/api/src/env.ts`、`errors.ts`、`middleware/session.ts`、`middleware/require.ts`；Modify `apps/api/src/app.ts`

**Interfaces:** Produces `env`（校验过的环境变量）；`fail(c, code, status)` 统一错误信封 `{ error: { code, fields? } }`（code 是 key，前端本地化）；`sessionMiddleware` 注入 `c.var.actor = { user, profile } | null`；`requireAuth` / `requireRole('moderator')` / `requireOwnerOrRole`

- [ ] **Step 1: env 校验**（缺 B2 配置应在启动时炸，不是第一次上传时）

```ts
// apps/api/src/env.ts
import { z } from 'zod'
export const env = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  B2_ENDPOINT: z.string().url(),
  B2_REGION: z.string().min(1),
  B2_ACCESS_KEY_ID: z.string().min(1),
  B2_SECRET_ACCESS_KEY: z.string().min(1),
  B2_BUCKET_PUBLIC: z.string().min(1),
  B2_BUCKET_PRIVATE: z.string().min(1),
}).parse(process.env)
```

- [ ] **Step 2: 错误信封**（只定实际会抛的码，~12 个；三语文案在 T15 统一补）

```ts
export const ERROR_CODES = [
  'unauthorized', 'forbidden', 'not_found', 'validation_failed',
  'rate_limited', 'quota_exceeded', 'invalid_state_transition',
  'upload_intent_invalid', 'file_too_large', 'duplicate_slug',
  'self_action_forbidden', 'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export const fail = (c: Context, code: ErrorCode, status = 400) =>
  c.json({ error: { code } }, status)
```

- [ ] **Step 3: 会话与权限中间件 + 测试**

先写失败测试（`middleware.test.ts`）：未登录访问受保护路由 → 401 且 body 为 `{error:{code:'unauthorized'}}`；普通用户访问审核路由 → 403。再实现 `sessionMiddleware`（`auth.api.getSession` + join `user_profile`，无 profile 则惰性创建）。

- [ ] **Step 4: 验证并提交**

### T4: 存储与上传（intent → presign → confirm）

**Files:** Create `apps/api/src/storage.ts`、`modules/uploads.ts`；Modify `app.ts`；Test `uploads.test.ts`

**Interfaces:** Produces `POST /api/uploads/presign` → `{ intentId, url, headers }`；`POST /api/uploads/confirm` → `{ objectId }`。私有桶存资源文件、公开桶存封面

- [ ] **Step 1: 存储封装**（Bun 原生，不引 aws-sdk）

```ts
// apps/api/src/storage.ts
import { S3Client } from 'bun'
const common = { endpoint: env.B2_ENDPOINT, region: env.B2_REGION,
  accessKeyId: env.B2_ACCESS_KEY_ID, secretAccessKey: env.B2_SECRET_ACCESS_KEY }
export const publicBucket = new S3Client({ ...common, bucket: env.B2_BUCKET_PUBLIC })
export const privateBucket = new S3Client({ ...common, bucket: env.B2_BUCKET_PRIVATE })

/** 上传即写入 Content-Disposition，之后任何签名 GET 自带正确文件名 */
export const presignPut = (bucket: S3Client, key: string, contentType: string, filename: string) =>
  bucket.presign(key, { method: 'PUT', expiresIn: 900, type: contentType,
    // filename* 用 RFC 5987 编码，中日文件名才不会乱码
  })
```

- [ ] **Step 2: 失败测试**（先写：未登录 401；超 5GB 返回 `file_too_large`；confirm 别人的 intent 返回 `upload_intent_invalid`）

- [ ] **Step 3: 实现两个端点**。presign 建 `upload_intent`（含 `ownerId`、`state='pending'`、`expiresAt`）；confirm 校验 **intent 属于当前用户** 且对象确实存在（`HEAD`），然后建 `storage_object`、intent 置 `consumed`。**越权挂载他人对象的洞就堵在这一步**

- [ ] **Step 4: 验证并提交**

### T5: 下载（白名单 + 签名 URL + 并发安全计数）

**Files:** Create `apps/api/src/modules/download.ts`；Test 扩展

**Interfaces:** Produces `GET /api/kourindou/resources/:slug/files/:fileId/download` → 302 到签名 URL

- [ ] **Step 1: 失败测试**——**这是安全测试，必须先红**

```ts
test('pending 资源的文件下载不到', async () => {
  const res = await app.request(`/api/kourindou/resources/${pendingSlug}/files/${fid}/download`)
  expect(res.status).toBe(404)
})
test('delisted 资源的文件下载不到', async () => { /* 同上 */ })
```

- [ ] **Step 2: 实现——状态判断用白名单，绝不用 `!== 'delisted'`**

```ts
if (r.status !== 'published' || r.deletedAt !== null) return fail(c, 'not_found', 404)
```

- [ ] **Step 3: 计数用原子 SQL，不是读改写**

```ts
await db.update(resource).set({ downloadCount: sql`${resource.downloadCount} + 1` })
  .where(eq(resource.id, r.id))
```

- [ ] **Step 4: 验证并提交**

### T6: 资源读端点（list / detail）

**Files:** `apps/api/src/modules/kourindou.ts`（替换占位）；Test

**Interfaces:** `GET /api/kourindou/resources`（多维筛选分页）；`GET /api/kourindou/resources/:slug`（含版本、文件、标签、社团、评分聚合）

- [ ] Step 1: 失败测试（列表默认只返回 published；筛选 kind/license/tag 生效；`uploaderId` 传真实 better-auth id 不报 400 ← 防 P0-3 回归）
- [ ] Step 2: 实现，列表查询不 select `description`（长文走 TOAST，列表不需要）
- [ ] Step 3: 验证并提交

### T7: 资源写端点（create / update / 状态流转）

**Files:** 同上；Test

**Interfaces:** `POST /resources`、`PATCH /resources/:id`、`POST /resources/:id/submit`、`POST /resources/:id/status`、`PATCH /resources/:id/license`

- [ ] Step 1: 失败测试（非作者改他人资源 403；非法状态跃迁 `invalid_state_transition`；改 license 不给 reason 应 400）
- [ ] Step 2: 状态机单一真相 `canTransition(from, to, role)`，**不在 URL 空间里编码第二遍**
- [ ] Step 3: `submit` 走信任梯度：`decideSubmit(profile)` → 新账号进 `pending`，`approvedResourceCount >= 3 且 strikeCount === 0` 直接 `published`
- [ ] Step 4: 创建资源时同事务建 `topic`（kind='resource'）——评论区从第一天就是论坛帖
- [ ] Step 5: license 变更写 `moderation_log`（法务证据链）
- [ ] Step 6: 验证并提交

### T8: 互动（rating / favorite / report）

**Files:** `apps/api/src/modules/interactions.ts`；Test

- [ ] Step 1: 失败测试（重复评分应更新而非报错；自己举报自己的资源 `self_action_forbidden`；score=9 被 CHECK 拒）
- [ ] Step 2: 评分用 `onConflictDoUpdate`，同事务原子更新 `ratingSum` / `ratingCount`（用 SQL 表达式，非读改写）
- [ ] Step 3: 验证并提交

### T9: 评论 = post（M4 共用）

**Files:** `apps/api/src/modules/content.ts`（唯一保留 service 抽象的模块）；Test

**Interfaces:** `GET /api/kourindou/resources/:slug/posts`、`POST /api/kourindou/resources/:slug/posts`

- [ ] Step 1: 失败测试（楼层号连续且唯一；并发发帖不产生重复楼层；回复不存在的 parent 应 400）
- [ ] Step 2: 楼层号用 `topic.postCount` 同事务自增 + `post_topic_floor_uq` 兜底
- [ ] Step 3: 验证并提交

### T10: 审核（队列 / 复核 / 举报处理 / 信任变更）

**Files:** `apps/api/src/modules/moderation.ts`；Test

**Interfaces:** `GET /moderation/queue`、`POST /moderation/resources/:id/review`、`GET /moderation/reports`、`POST /moderation/reports/:id/resolve`

- [ ] Step 1: 失败测试（普通用户访问全部 403）
- [ ] Step 2: `review` 落地时同事务：改 `status`、写 `moderation_log`、更新 `user_profile`。**`reject` 且 reason ∈ {copyright, illegal} 时 `strikeCount += 1`**——这是信任梯度唯一的惩罚机制，`critiques-gaps.md` P0-5 指出原方案零写入点
- [ ] Step 3: 验证并提交

### T11: web 数据层 + 列表页

**Files:** `apps/web/app/routes/kourindou/{list,layout}.tsx`、`app/lib/api.ts`；Modify `routes.ts`、三语 messages

- [ ] Step 1: `app/lib/api.ts` 封装 SSR 侧 client（自动转发 cookie，沿用 root loader 的模式）
- [ ] Step 2: 列表页 loader 读筛选参数 → api；筛选器（kind / license / tag / sort）走 URL query，可分享可后退
- [ ] Step 3: 列表用 `data-density="compact"`（M1.5 实地调研结论：Moriya 每行 90px 塞 9 项元数据）
- [ ] Step 4: 空状态、加载骨架、错误态都要有设计（不是裸文本）
- [ ] Step 5: 三语文案齐全，验证 `/kourindou`、`/ja/kourindou`、`/en/kourindou`
- [ ] Step 6: 提交

### T12: 详情页（文件 / 互动 / 评论）

**Files:** `apps/web/app/routes/kourindou/detail.tsx` + 组件

- [ ] Step 1: 版本与文件列表、下载按钮（走 302 签名 URL）
- [ ] Step 2: 评分星、收藏、举报对话框（action 提交，乐观更新）
- [ ] Step 3: 评论区（`post` 数据，楼层号显示）
- [ ] Step 4: 许可状态徽章醒目展示 + `licenseNote`
- [ ] Step 5: 三语验证并提交

### T13: 上传向导（M3 前端工作量最大项）

**Files:** `apps/web/app/routes/kourindou/upload.tsx` + 组件

- [ ] Step 1: 三步：① 基本信息（标题/类型/许可状态，**许可状态必选且带解释**）② 文件（拖拽 → presign → 直传 → confirm，带进度条）③ 确认提交
- [ ] Step 2: 前端用同一份 zod schema 校验（`packages/shared`），错误就地显示
- [ ] Step 3: 上传失败可重试单个文件，不丢已填表单
- [ ] Step 4: 提交后按信任梯度提示"已发布"或"待审核"
- [ ] Step 5: 三语验证并提交

### T14: 审核后台

**Files:** `apps/web/app/routes/dash/{queue,reports}.tsx`

- [ ] Step 1: 队列按 `trustLevel` 升序（低信任优先看）
- [ ] Step 2: 通过/拒绝（拒绝须选 reason）、举报处理
- [ ] Step 3: 非 moderator 访问应重定向到首页
- [ ] Step 4: 三语验证并提交

### T15: i18n 审计 + 端到端验收 + 文档

- [ ] Step 1: `grep` 全仓找裸中文字符串（除 messages 与注释），补进 Paraglide
- [ ] Step 2: 端到端手测矩阵：注册 → 上传（新账号 → pending）→ 管理员通过 → 列表可见 → 下载计数 +1 → 评分 → 评论 → 举报 → 处理；再验 pending 资源下载 404
- [ ] Step 3: `scripts/reindex.ts`（Meili 全量重建，M3.5 接管查询时直接用）
- [ ] Step 4: 更新 CLAUDE.md（香霖堂约定）、产品文档里程碑标记
- [ ] Step 5: `bun run check && typecheck && test && build` 全绿，提交并推送

---

## M3.5 推迟项（表结构已就位，加功能是纯 additive）

Meilisearch 查询接管 · 社团页与认领审批 UI · 外链镜像上传 · ja/en 译名编辑 UI · 版本历史 UI · 举报申诉 · 下载日聚合与热度榜 · 断点续传（真有人撞 5GB 上限时再说）

## Self-Review 记录

- Spec 覆盖：产品文档香霖堂全部机制（先发后审 ✓ T7、信任梯度 ✓ T7/T10、许可状态 ✓ T1/T2/T7、认领收单 ✓ T2 表就位、多维标签 ✓ T2 tag.kind、评分收藏举报 ✓ T8、下载统计 ✓ T5、资源评论=论坛帖 ✓ T2/T9）；Turnstile 推迟到 M3.5（M3 无用户，反滥用靠信任梯度 + 限流）
- 采纳 `critiques-gaps.md` 全部 6 个 P0：id 三分（Global Constraints）、`user_profile` 进 T2、`storage_object` 统管对象、`moderation_log` 跨实体审计、`deletedAt` 软删、GC 白名单谓词
- 采纳 `critiques-simplify.md` D1–D10 / A1–A3：13 张表、~30 条路由、无 multipart、无 aws-sdk、无 service 分层（除 content）
- 类型一致性：T1 的 `entityIdSchema`/`userIdSchema`/`slugIdSchema` → T6/T7/T8 消费；T2 的 `storageObject` → T4/T5 消费；T2 的 `topic`/`post` → T9 消费；T3 的 `fail()`/`requireRole` → T4–T10 消费
