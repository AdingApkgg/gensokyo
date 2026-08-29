我已读完现有代码。先记录对齐基线，再给设计。

## 0. 与现有代码的对齐基线

读过的文件：`/Users/i/Code/th/apps/api/src/app.ts`、`/Users/i/Code/th/apps/api/src/modules/kourindou.ts`、`/Users/i/Code/th/apps/api/src/modules/me.ts`、`/Users/i/Code/th/apps/api/src/auth.ts`、`/Users/i/Code/th/apps/api/src/app.test.ts`、`/Users/i/Code/th/packages/shared/src/pagination.ts`、`/Users/i/Code/th/packages/db/src/schema/auth.ts`、`/Users/i/Code/th/packages/api-client/src/index.ts`、`/Users/i/Code/th/biome.json`、各 `package.json`。

必须遵守的既成约定（下面所有代码都按此写）：

| 约定 | 现状 | 影响 |
|---|---|---|
| 格式 | biome：单引号、**无分号**、2 空格 | 全部代码照此 |
| 路由风格 | `export const kourindou = new Hono().get(...)` 单一链式表达式 | 子路由器一律单表达式，禁止 `const a = new Hono()` 后再 `a.get()` |
| 校验 | `zValidator('query', paginationQuerySchema)` + `c.req.valid('query')` | 保留，但包一层统一错误 |
| 响应形状 | `{ status: 'ok' }` / `{ user: … }` / `{ items, page, pageSize }` —— **裸载荷，无 `data` 包装** | **成功响应不加 `{data}` 包装**（挖掘报告建议加，但那会破坏 `/api/health`、`/api/me` 和现有测试）；只有错误加 `{error}` 包装 |
| 分页 | `paginationQuerySchema` = offset `page`/`pageSize` | 保留不动（`app.test.ts` 依赖 `{items:[],page:1,pageSize:20}`），另加 cursor schema |
| TS | `verbatimModuleSyntax` + `noUncheckedIndexedAccess` | 类型导入必须 `import type`；数组下标访问要判空 |
| 测试 | 同目录 `.test.ts`，`bun:test`，中文用例名 | 新代码同风格 |
| 包边界 | `@gensokyo/shared` 只依赖 zod；`@gensokyo/db` 只依赖 drizzle | enums 用**零 zod 依赖**的 const 元组文件，让 db 也能 import |

一个现有的隐患：`app.ts` 的 `.on(['GET','POST'], '/auth/*')` 排在最前，这是**对的**——session 中间件必须挂在它之后，否则每个 better-auth 请求会多跑一次 getSession。

---

## 1. 文件结构

```
apps/api/src/
  app.ts                          # 链式装配（改动：插入 use(sessionMiddleware) + onError）
  auth.ts                         # 不动
  env.ts                          # 【新】zod 校验的环境变量，启动即失败
  index.ts                        # 不动
  http/
    env.ts                        # AppEnv / Actor 类型（hono Variables）
    error.ts                      # ApiError + onError
    validate.ts                   # zValidator 包装（抛 ApiError，不污染路由类型）
    cache.ts                      # 公开读路由的 Cache-Control 助手
  middleware/
    session.ts                    # sessionMiddleware（唯一 getSession 调用点）
    guard.ts                      # requireAuth / requireRole / requireTrust / requireOwnerOrStaff
    turnstile.ts                  # turnstile()
    rate-limit.ts                 # rateLimit()
  modules/
    me.ts                         # 不动（跨模块聚合留给 M4）
    content/                      # 【新】评论=论坛帖，M3/M4 共用，不属于 kourindou
      post.service.ts             # createPost / listPosts / editPost / softDeletePost
      topic.service.ts            # ensureTopicForResource / lockTopic
    kourindou/
      index.ts                    # 只做 .route() 链式装配
      resources.ts        + resources.service.ts
      versions.ts         + versions.service.ts
      files.ts            + files.service.ts        # 文件元数据 + 下载签名
      uploads.ts          + uploads.service.ts      # presign / multipart / intent 确认
      interactions.ts     + interactions.service.ts # rating / favorite / thanks
      comments.ts                                   # 薄壳，转调 content/post.service
      reports.ts          + reports.service.ts
      circles.ts          + circles.service.ts      # 含 claim
      takedowns.ts        + takedowns.service.ts
      taxonomy.ts         + taxonomy.service.ts     # type/tag/work/event 只读
      mine.ts                                       # /kourindou/me/*
      moderation.ts       + moderation.service.ts   # 审核队列（staff）
      policy.ts                                     # 纯函数权限判定（无 hono 依赖）
      search.ts                                     # Meilisearch 适配 + outbox
      storage.ts                                    # B2 客户端（Bun.S3Client + aws-sdk 混合）

packages/shared/src/
  index.ts            # 重新导出全部
  validation.ts       # 【新】z.config 全局 error map + toFieldIssues
  errors.ts           # 【新】ApiErrorCode + 状态码映射 + apiErrorSchema
  pagination.ts       # 【改】保留 paginationQuerySchema，新增 cursor + 结果类型
  localized.ts        # 【新】LocalizedText + 回退链
  content/post.ts     # 【新】帖子 schema（M4 共用）
  kourindou/
    enums.ts          # 【新】零 zod 依赖的 const 元组（喂 pgEnum + z.enum）
    trust.ts          # 【新】信任梯度 + 状态机纯函数
    resource.ts  version.ts  upload.ts  interaction.ts  circle.ts  moderation.ts
    index.ts
```

**服务层与路由层的分工**：`*.service.ts` 不 import hono，签名是 `(db, args) => Promise<T>`，抛 `ApiError`。路由文件只做「校验 → 取 actor → 调 service → c.json」。这样 service 可以被 M4 的 shrine 路由、cron 任务、种子脚本复用，也能直接单测。

---

## 2. 端点清单

全部挂在 `/api/kourindou` 下（`app.ts` 已有 `.basePath('/api')`）。权限记号：`public` / `auth` / `TS`=需 Turnstile（trust≥2 免） / `owner|staff` / `staff`=moderator+admin / `admin` / `T≥n`=信任等级门槛。

### 2.1 resources（`.route('/resources', resources)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| GET | `/resources` | query `listResourcesQuerySchema` | public | `{ items: ResourceCard[], page, pageSize, total, facets? }` |
| GET | `/resources/:slug` | path slug；query `?locale=` | public（非 published 仅 owner\|staff） | `{ resource: ResourceDetail, versions: VersionSummary[], viewer: { rated, favorited, thanked, canEdit } }` |
| POST | `/resources` | json `createResourceSchema` | auth + TS + 日配额 | `201 { resource: ResourceDetail }`（status=`draft`） |
| PATCH | `/resources/:id` | json `updateResourceSchema` | owner\|staff | `{ resource, statusChanged: boolean }` |
| POST | `/resources/:id/submit` | json `submitResourceSchema` | owner | `{ resource, decision: SubmitDecision }` ← 先发后审判定点 |
| POST | `/resources/:id/delist` | json `{ reason? }` | owner\|staff | `{ resource }` |
| POST | `/resources/:id/republish` | — | owner(T≥2)\|staff | `{ resource, decision }` |
| PATCH | `/resources/:id/license` | json `changeLicenseSchema` | owner\|staff | `{ resource, requiresReview }` |
| DELETE | `/resources/:id` | json `{ reason }` | **admin** | `{ deleted: true, objectsQueued: number }` |

`DELETE` 不物理删数据：写 `moderation_log`、置 `deleted_at`、把 B2 对象推进 `storage_gc_queue`。真正的物理清理是 cron。legacy 的「上传者本人可硬删、连带删光他人评论/评分」语义**不继承**。

### 2.2 versions（`.route('/resources', resourceVersions)` + `.route('/versions', versions)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| GET | `/resources/:slug/versions` | — | public | `{ items: VersionDetail[] }` |
| POST | `/resources/:id/versions` | json `createVersionSchema` | owner\|staff | `201 { version }` |
| PATCH | `/versions/:versionId` | json `updateVersionSchema` | owner\|staff | `{ version }` |
| POST | `/versions/:versionId/promote` | — | owner\|staff | `{ version }`（置 `isLatest`，partial unique index 保证唯一） |
| DELETE | `/versions/:versionId` | — | owner\|staff | `{ deleted: true }`（禁止删最后一个版本 → `conflict`） |
| POST | `/versions/:versionId/files` | json `attachFileSchema`（判别联合 b2/external） | owner\|staff | `201 { file }` |

### 2.3 files & downloads（`.route('/files', files)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| PATCH | `/files/:fileId` | json `updateFileSchema`（displayName 多语 / sortOrder） | owner\|staff | `{ file }` |
| DELETE | `/files/:fileId` | — | owner\|staff | `{ deleted: true }` |
| GET | `/files/:fileId/download` | — | public + rateLimit | `{ url, storageKind, filename, sizeBytes, expiresAt \| null }` |

下载路由三条硬规则（都是修 legacy 漏洞）：
1. **白名单判定** `resource.status === 'published'`，owner/staff 才走预览分支。绝不写 `!== 'takedown'`。
2. 先写 `download_event`（`ON CONFLICT DO NOTHING`，去重键 `(fileId, actorHash, hourBucket)`），只有真插入了才递增计数，然后才签名。签名失败最多丢一次计数，不会「空跑刷量」。
3. `actorHash = sha256(userId ?? clientIp + dailySalt)`，**不存明文 IP**。
4. 签名用 `GetObjectCommand + ResponseContentDisposition`，让用户下到真实文件名而非 `<uuid>.zip`。

### 2.4 uploads（`.route('/uploads', uploads)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| POST | `/uploads/presign` | json `presignUploadSchema` | auth + 配额 | `{ intentId, key, url, expiresAt }` |
| POST | `/uploads/multipart` | json `startMultipartSchema` | auth + 配额 | `{ intentId, key, uploadId, partSize, partUrls: {partNumber,url}[] }` ← **一次性批量签所有片** |
| POST | `/uploads/multipart/:intentId/complete` | json `completeMultipartSchema` | owner(intent) | `{ intentId, etag, sizeBytes }` |
| POST | `/uploads/multipart/:intentId/abort` | — | owner(intent) | `{ aborted: true }` |
| POST | `/uploads/:intentId/confirm` | — | owner(intent) | `{ intent: UploadIntent }`（HeadObject 校验真实 size/contentType 后置 `uploaded`） |
| GET | `/kourindou/me/uploads` | query `paginationQuerySchema` | auth | 未完成 intent 列表（断点续传/清理用） |

`upload_intent` 表是安全闸门，直接解掉挖掘报告列的头号缺陷（`/api/resources` 无条件信任客户端上报的 key）：presign 时落一行 `(id, userId, purpose, key, declaredSize, declaredContentType, state, uploadId, expiresAt)`；`attachFile` 只接受 `state='uploaded' && userId===actor.id` 的 intent，并且**接收的是 `intentId` 而不是 `key`**。客户端从此拿不到、也不需要拼 key。

`partUrls` 批量返回：1GB 文件从 258 次往返降到 3 次。

### 2.5 interactions（`.route('/resources', interactions)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| PUT | `/resources/:id/rating` | json `rateResourceSchema` | auth | `{ myScore, ratingAvg, ratingCount }` |
| DELETE | `/resources/:id/rating` | — | auth | 同上（`myScore: null`） |
| PUT | `/resources/:id/favorite` | — | auth | `{ favorited: true, favoriteCount }` |
| DELETE | `/resources/:id/favorite` | — | auth | `{ favorited: false, favoriteCount }` |
| PUT | `/resources/:id/thanks` | — | auth（禁自谢） | `{ thanked: true, thanksCount }` |
| DELETE | `/resources/:id/thanks` | — | auth | `{ thanked: false, thanksCount }` |

`PUT`/`DELETE` 取代 legacy 的 `POST` toggle：幂等、双击不炸、hc 类型不需要联合窄化。全部走 `INSERT … ON CONFLICT (resource_id,user_id) DO UPDATE … RETURNING`，不再 read-then-write。

### 2.6 comments = 论坛楼层（`.route('/resources', resourceComments)` + `.route('/comments', commentItems)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| GET | `/resources/:slug/comments` | query `cursorQuerySchema` | public | `{ topicId, locked, postCount, items: Post[], nextCursor }` |
| POST | `/resources/:id/comments` | json `createPostSchema` | auth + TS | `201 { post: Post }` |
| PATCH | `/comments/:postId` | json `updatePostSchema` | author(限时) \| staff | `{ post }` |
| DELETE | `/comments/:postId` | — | author \| staff | `{ post }`（软删，保楼层号） |

**这就是 M4 的预留**：返回体是 `postListSchema`，与将来 `GET /api/shrine/topics/:topicId/posts` **完全同一个 schema、同一个 service 函数**。`POST /resources/:id/comments` 内部只做 `resourceId → topicId` 解析后转调 `createPost(db, { topicId, … })`。M4 上线时这四条路由一行不用改。

### 2.7 reports（`.route('/reports', reports)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| POST | `/reports` | json `createReportSchema`（多态 target） | auth + TS | `201 { report: { id, status } }` |
| GET | `/kourindou/me/reports` | query 分页 | auth | 我提交的举报及处理结果 |

匿名举报**取消**（legacy 允许，是现成的刷库入口）。真正需要匿名通道的是下架申请，见 2.9。防刷用 partial unique index：`UNIQUE (target_type,target_id,reporter_id) WHERE status='open'`，重复提交返回 `duplicate_report` 409。

### 2.8 circles + claims（`.route('/circles', circles)`）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| GET | `/circles` | query `listCirclesQuerySchema` | public | `{ items, page, pageSize, total }` |
| GET | `/circles/:slug` | — | public | `{ circle, resourceCount, claimedBy }` |
| GET | `/circles/:slug/resources` | query `listResourcesQuerySchema` | public | 同资源列表 |
| POST | `/circles` | json `createCircleSchema` | auth **T≥1** + TS | `201 { circle }` |
| PATCH | `/circles/:id` | json `updateCircleSchema` | claimer \| staff | `{ circle }` |
| POST | `/circles/:id/claims` | json `createClaimSchema` | auth + TS | `201 { claim }` |
| GET | `/circles/:id/claims` | — | staff | `{ items }` |

### 2.9 takedowns（`.route('/takedowns', takedowns)`）—— 版权生死线通道

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| POST | `/takedowns` | json `createTakedownSchema` | **public + TS**（不需要账号） | `201 { id, trackingToken }` |
| GET | `/takedowns/:id` | query `?token=` | 持 token 者 | `{ status, submittedAt, resolution, resolvedAt }` |
| POST | `/takedowns/:id/withdraw` | json `{ token }` | 持 token 者 | `{ status: 'withdrawn' }` |

**必须允许匿名**：日本社团不会为了发一封下架函在中文站注册账号。产品文档把 ja 界面列为「社团认领/下架通道真正可用的前提」，这条路由就是那个前提的落点。`trackingToken` 是一次性随机串（存 hash），同时邮件抄送 `contactEmail`。

### 2.10 taxonomy（`.route('/taxonomy', taxonomy)`）— 全部可 CDN 缓存

| 方法 | 路径 | 权限 | 返回 |
|---|---|---|---|
| GET | `/taxonomy` | public | `{ types, tagKinds, locales, licenseStatuses }` 一次喂满筛选 UI |
| GET | `/taxonomy/tags` | public | query `{ kind?, q?, limit }` → `{ items }` |
| GET | `/taxonomy/works` | public | 原作作品（th06…）多语名 |
| GET | `/taxonomy/events` | public | 展会（C105…） |
| GET | `/taxonomy/suggest` | public | Meilisearch 补全（含拼音） |

### 2.11 me（`.route('/me', mine)`，即 `/api/kourindou/me/*`）

| 方法 | 路径 | 权限 | 返回 |
|---|---|---|---|
| GET | `/me/resources` | auth | query 带 `status` 多选，含 draft/rejected |
| GET | `/me/favorites` | auth | 收藏聚合（个人主页用） |
| GET | `/me/ratings` | auth | |
| GET | `/me/trust` | auth | `{ trustLevel, signals, nextLevel, dailyQuota, quotaUsed }` ← 上传向导第 5 步显示「将进入审核队列 / 将立即发布」 |

### 2.12 moderation（`.route('/moderation', moderation)`，全 staff）

| 方法 | 路径 | 入参 | 权限 | 返回 |
|---|---|---|---|---|
| GET | `/moderation/queue` | query `moderationQueueQuerySchema` | staff | `{ items, page, pageSize, total }`（按 trustLevel↑ + submittedAt↑ 排序，许可状态徽章前置） |
| POST | `/moderation/resources/:id/review` | json `reviewResourceSchema` | staff | `{ resource, log }` |
| POST | `/moderation/resources/:id/status` | json `forceStatusSchema` | staff | `{ resource, log }` |
| GET | `/moderation/resources/:id/logs` | — | staff | `{ items: ModerationLog[] }` |
| GET | `/moderation/reports` | query `listReportsQuerySchema` | staff | `{ items, … }` |
| PATCH | `/moderation/reports/:id` | json `resolveReportSchema` | staff | `{ report }` |
| GET/PATCH | `/moderation/claims` `/moderation/claims/:id` | json `resolveClaimSchema` | staff | |
| GET/PATCH | `/moderation/takedowns` `/moderation/takedowns/:id` | json `resolveTakedownSchema` | staff | |
| GET | `/moderation/stats` | — | staff | `{ pending, openReports, openClaims, openTakedowns, spotCheckDue }` |
| PATCH | `/moderation/users/:userId/trust` | json `setTrustOverrideSchema` | **admin** | `{ profile }` |

合计 **58 条路由 / 15 个子路由器**。

---

## 3. packages/shared zod 代码

### 3.1 `packages/shared/src/validation.ts` — 全局 error map（i18n 的根）

```ts
import { z } from 'zod'

/**
 * 全局 error map：把 zod 内建校验的英文散文替换成 i18n key。
 * 自定义 refine 传的 error 若已是 'validation.*' 形式则原样透出。
 * 这是「错误消息全部是 key、永不是散文」这条约定的强制点。
 */
z.config({
  customError: (issue) => {
    const raw = issue.message
    if (typeof raw === 'string' && raw.startsWith('validation.')) return raw
    return `validation.${issue.code}`
  },
})

export type FieldIssue = {
  /** 点分路径，'' 表示根级；数组下标以数字段出现，如 'files.0.key' */
  path: string
  /** zod issue code，如 too_small / invalid_type */
  code: string
  /** 前端 Paraglide 查表用的 key */
  key: string
  /** 插值参数，如 { minimum: 1, maximum: 200 } */
  params?: Record<string, string | number>
}

const ISSUE_PARAM_KEYS = [
  'minimum',
  'maximum',
  'expected',
  'received',
  'format',
  'origin',
] as const

const pickParams = (issue: z.core.$ZodIssue): FieldIssue['params'] | undefined => {
  const out: Record<string, string | number> = {}
  for (const key of ISSUE_PARAM_KEYS) {
    const value = (issue as unknown as Record<string, unknown>)[key]
    if (typeof value === 'string' || typeof value === 'number') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 把 ZodError 摊平成可本地化的字段级问题列表。
 * 刻意不用 z.treeifyError()：那个只保留 message 字符串，
 * 丢掉 code 和 minimum/maximum，前端就没法做带插值的翻译。
 */
export const toFieldIssues = (error: z.ZodError): FieldIssue[] =>
  error.issues.map((issue) => {
    const message = issue.message
    return {
      path: issue.path.map(String).join('.'),
      code: issue.code,
      key: message.startsWith('validation.') ? message : `validation.${issue.code}`,
      params: pickParams(issue),
    }
  })
```

### 3.2 `packages/shared/src/errors.ts`

```ts
import { z } from 'zod'
import { fieldIssueSchema } from './issue-schema'

export const API_ERROR_CODES = [
  // 通用
  'validation_error',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'turnstile_failed',
  'internal_error',
  // 资源
  'resource_not_found',
  'resource_not_available',
  'invalid_status_transition',
  'slug_conflict',
  // 版本 / 文件
  'version_not_found',
  'last_version_protected',
  'file_not_found',
  'external_mirror_unreachable',
  // 上传
  'upload_intent_not_found',
  'upload_intent_expired',
  'upload_not_confirmed',
  'upload_ownership_mismatch',
  'upload_size_mismatch',
  'upload_type_rejected',
  'object_missing',
  'payload_too_large',
  'daily_upload_quota_exceeded',
  // 互动 / 内容
  'self_thanks_forbidden',
  'topic_locked',
  'post_not_found',
  'edit_window_expired',
  // 审核 / 版权
  'trust_level_too_low',
  'license_change_requires_review',
  'duplicate_report',
  'duplicate_claim',
  'takedown_token_invalid',
  // 社团
  'circle_not_found',
  'circle_already_claimed',
  // 依赖
  'search_unavailable',
  'storage_unavailable',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** 单一来源的状态码映射：服务端据此设 status，前端据此判断可重试性 */
export const API_ERROR_STATUS = {
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  turnstile_failed: 403,
  internal_error: 500,
  resource_not_found: 404,
  resource_not_available: 403,
  invalid_status_transition: 409,
  slug_conflict: 409,
  version_not_found: 404,
  last_version_protected: 409,
  file_not_found: 404,
  external_mirror_unreachable: 502,
  upload_intent_not_found: 404,
  upload_intent_expired: 410,
  upload_not_confirmed: 409,
  upload_ownership_mismatch: 403,
  upload_size_mismatch: 409,
  upload_type_rejected: 415,
  object_missing: 409,
  payload_too_large: 413,
  daily_upload_quota_exceeded: 429,
  self_thanks_forbidden: 409,
  topic_locked: 403,
  post_not_found: 404,
  edit_window_expired: 403,
  trust_level_too_low: 403,
  license_change_requires_review: 409,
  duplicate_report: 409,
  duplicate_claim: 409,
  takedown_token_invalid: 403,
  circle_not_found: 404,
  circle_already_claimed: 409,
  search_unavailable: 503,
  storage_unavailable: 503,
} as const satisfies Record<ApiErrorCode, number>

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    /** 消息插值参数，如 { max: 20, retryAfter: 30 } */
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    /** 仅 validation_error 出现 */
    fields: z.array(fieldIssueSchema).optional(),
    requestId: z.string(),
  }),
})

export type ApiErrorBody = z.infer<typeof apiErrorSchema>

/** 前端用：错误码 → Paraglide message key */
export const errorMessageKey = <T extends ApiErrorCode>(code: T) =>
  `error.${code}` as const
```

`packages/shared/src/issue-schema.ts`（拆出来避免 errors ↔ validation 循环引用）：

```ts
import { z } from 'zod'

export const fieldIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  key: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})
```

### 3.3 `packages/shared/src/pagination.ts`（在现有文件上追加，不改动已有导出）

```ts
import { z } from 'zod'

// ── 既有，保持不动：app.test.ts 依赖其默认值 ──────────────────────
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

// ── 新增 ────────────────────────────────────────────────────────
/**
 * 分页策略二分法（不是随意混用）：
 *  - offset：有页码选择器、需要 total 和 facet 计数、由 Meilisearch 支撑的列表
 *    （资源列表、社团列表、审核队列）。
 *  - cursor：只追加、按序消费的流（评论楼层、下载日志、通知）。
 *    评论必须用 cursor：楼层会被插入，offset 分页会漏帖/重帖。
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type CursorQuery = z.infer<typeof cursorQuerySchema>

export type PageResult<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export type CursorResult<T> = {
  items: T[]
  nextCursor: string | null
}

export const emptyPage = <T>(query: PaginationQuery): PageResult<T> => ({
  items: [],
  page: query.page,
  pageSize: query.pageSize,
  total: 0,
})
```

### 3.4 `packages/shared/src/localized.ts`

```ts
import { z } from 'zod'
import { LOCALES, type Locale } from './kourindou/enums'

const localizedShape = (max: number) =>
  z.object({
    zh: z.string().trim().min(1).max(max).optional(),
    ja: z.string().trim().min(1).max(max).optional(),
    en: z.string().trim().min(1).max(max).optional(),
  })

const atLeastOne = (value: Record<string, string | undefined>) =>
  LOCALES.some((locale) => value[locale] !== undefined)

/** 短字段多语（标题/社团名/标签名）—— 存 jsonb，整体读取，Meilisearch 展平 */
export const localizedTextSchema = localizedShape(200).refine(atLeastOne, {
  error: 'validation.localized_text_required',
})

export const localizedLineSchema = localizedShape(500).refine(atLeastOne, {
  error: 'validation.localized_text_required',
})

/** 长字段多语（简介/更新日志）—— 存 resource_translation 侧表，可按语种独立审核 */
export const localizedMarkdownSchema = z.object({
  zh: z.string().max(20000).optional(),
  ja: z.string().max(20000).optional(),
  en: z.string().max(20000).optional(),
})

export type LocalizedText = z.infer<typeof localizedTextSchema>
export type LocalizedMarkdown = z.infer<typeof localizedMarkdownSchema>

/** 回退链：请求语种 → zh → ja → en → 原文（社团原始日文名，永不翻译） */
export const FALLBACK_CHAIN: readonly Locale[] = ['zh', 'ja', 'en']

export const resolveLocalized = (
  value: Partial<Record<Locale, string>> | null | undefined,
  locale: Locale,
  original?: string | null,
): string => {
  if (value) {
    const preferred = value[locale]
    if (preferred) return preferred
    for (const fallback of FALLBACK_CHAIN) {
      const candidate = value[fallback]
      if (candidate) return candidate
    }
  }
  return original ?? ''
}
```

### 3.5 `packages/shared/src/kourindou/enums.ts`（零 zod 依赖，同时喂 `pgEnum` 和 `z.enum`）

```ts
export const LOCALES = ['zh', 'ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const USER_ROLES = ['user', 'moderator', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const TRUST_LEVELS = [0, 1, 2, 3] as const
export type TrustLevel = (typeof TRUST_LEVELS)[number]

/** 闭集 → pgEnum。加值要 ALTER TYPE ADD VALUE，所以只给真闭的集合用。 */
export const RESOURCE_STATUSES = [
  'draft',
  'pending',
  'published',
  'rejected',
  'delisted',
] as const
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number]

/** 分发许可状态——版权生死线。默认永远是最保守的 unspecified。 */
export const LICENSE_STATUSES = [
  'circle_permitted',
  'unspecified',
  'out_of_print',
  'authorized_repost',
] as const
export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

/** 许可宽松度排序：变宽松需要人工复核，收紧免审 */
export const LICENSE_PERMISSIVENESS = {
  unspecified: 0,
  out_of_print: 1,
  authorized_repost: 2,
  circle_permitted: 3,
} as const satisfies Record<LicenseStatus, number>

/** 这些许可状态下不允许自动过审 */
export const LICENSE_REQUIRES_REVIEW: readonly LicenseStatus[] = [
  'unspecified',
  'authorized_repost',
]

export const FILE_STORAGE_KINDS = ['b2', 'external'] as const
export type FileStorageKind = (typeof FILE_STORAGE_KINDS)[number]

export const UPLOAD_PURPOSES = ['cover', 'resource_file'] as const
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number]

export const UPLOAD_STATES = ['pending', 'uploaded', 'failed', 'expired'] as const
export type UploadState = (typeof UPLOAD_STATES)[number]

/** 标签维度。资源「类型」不在这里——它是会长的集合，做 resource_type 表。 */
export const TAG_KINDS = ['origin', 'event', 'language', 'misc'] as const
export type TagKind = (typeof TAG_KINDS)[number]

export const CIRCLE_ROLES = [
  'circle',
  'artist',
  'translator',
  'publisher',
  'label',
] as const
export type CircleRole = (typeof CIRCLE_ROLES)[number]

export const REPORT_TARGET_TYPES = ['resource', 'post', 'user', 'circle'] as const
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number]

export const REPORT_KINDS = [
  'copyright',
  'broken_link',
  'miscategorized',
  'illegal',
  'spam',
  'other',
] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const REPORT_STATUSES = [
  'open',
  'reviewing',
  'resolved',
  'rejected',
  'duplicate',
] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const REVIEW_DECISIONS = ['approve', 'reject'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const REJECT_REASONS = [
  'license_unclear',
  'copyright_violation',
  'duplicate',
  'broken_files',
  'wrong_type',
  'low_quality',
  'off_topic',
  'rule_violation',
  'other',
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export const MODERATION_ACTIONS = [
  'submit',
  'auto_publish',
  'approve',
  'reject',
  'delist',
  'republish',
  'license_change',
  'hard_delete',
  'trust_change',
] as const
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const TAKEDOWN_STATUSES = [
  'pending',
  'reviewing',
  'accepted',
  'rejected',
  'withdrawn',
] as const
export type TakedownStatus = (typeof TAKEDOWN_STATUSES)[number]

export const TAKEDOWN_RELATIONS = [
  'circle_member',
  'author',
  'rights_holder',
  'agent',
  'other',
] as const
export type TakedownRelation = (typeof TAKEDOWN_RELATIONS)[number]

export const RESOURCE_SORTS = [
  'new',
  'updated',
  'popular',
  'rating',
  'downloads',
] as const
export type ResourceSort = (typeof RESOURCE_SORTS)[number]

export const TOPIC_KINDS = ['resource', 'forum'] as const
export type TopicKind = (typeof TOPIC_KINDS)[number]

/**
 * resource_type 是「会长」的集合 → 用表不用 pgEnum。
 * 这里只是首批种子的 slug，API 参数校验用 slug 格式而非枚举。
 */
export const SEED_RESOURCE_TYPE_SLUGS = [
  'game',
  'doujinshi',
  'music',
  'translation',
  'tool',
] as const
```

`packages/db/src/schema/*.ts` 里直接：

```ts
import { RESOURCE_STATUSES } from '@gensokyo/shared'
export const resourceStatusEnum = pgEnum('resource_status', RESOURCE_STATUSES)
```

`pgEnum` 要 `readonly [string, ...string[]]`，`as const` 元组正好满足；`z.enum()` 也直接吃同一个元组。**一份元组喂三处：DB 约束 + 运行时校验 + z.infer 类型。**

### 3.6 `packages/shared/src/kourindou/resource.ts`

```ts
import { z } from 'zod'
import { localizedMarkdownSchema, localizedTextSchema } from '../localized'
import { paginationQuerySchema } from '../pagination'
import {
  CIRCLE_ROLES,
  LICENSE_STATUSES,
  LOCALES,
  RESOURCE_SORTS,
  RESOURCE_STATUSES,
} from './enums'

/** 业务实体主键：应用层生成的 UUIDv7（时间有序、不泄露总量、与 better-auth 的 text userId 兼容） */
export const idSchema = z.uuid()
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u, { error: 'validation.invalid_slug' })

/** CSV 查询参数 → 数组。前端传 ?work=th06,th08 */
const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((raw) => raw.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1).max(values.length))
    .optional()

const csvSlug = (max: number) =>
  z
    .string()
    .transform((raw) => raw.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(slugSchema).min(1).max(max))
    .optional()

export const circleLinkSchema = z.object({
  circleId: idSchema,
  role: z.enum(CIRCLE_ROLES).default('circle'),
})

export const createResourceSchema = z.object({
  /** 多语标题；至少一种语言 */
  title: localizedTextSchema,
  /** 社团原始标题（通常日文），永不翻译，Meilisearch 单独建索引 */
  titleOriginal: z.string().trim().min(1).max(200),
  summary: localizedTextSchema.optional(),
  /** 长文按语种分开，落 resource_translation 侧表 */
  description: localizedMarkdownSchema.optional(),
  /** resource_type.slug，非枚举——类型集合会增长 */
  typeSlug: slugSchema,
  /** 生死线字段。默认最保守，客户端不传就是「未标明」 */
  licenseStatus: z.enum(LICENSE_STATUSES).default('unspecified'),
  licenseNote: z.string().trim().max(2000).optional(),
  licenseSourceUrl: z.url().max(500).optional(),
  circles: z.array(circleLinkSchema).max(8).default([]),
  eventId: idSchema.optional(),
  /** 原作关联：touhou_work.id[] */
  workIds: z.array(idSchema).max(24).default([]),
  tagIds: z.array(idSchema).max(32).default([]),
  /** 封面走 upload_intent，不接受裸 key */
  coverIntentId: idSchema.optional(),
  /** 资源内容语言（不是 UI 语言） */
  contentLocales: z.array(z.enum(LOCALES)).max(3).default([]),
})

export type CreateResourceInput = z.infer<typeof createResourceSchema>

/**
 * 编辑：licenseStatus 不在这里——它走 PATCH /resources/:id/license，
 * 因为改许可必须带 reason 并写 license_change_log（法务留痕）。
 */
export const updateResourceSchema = createResourceSchema
  .omit({ licenseStatus: true, licenseNote: true, licenseSourceUrl: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    error: 'validation.empty_patch',
  })

export type UpdateResourceInput = z.infer<typeof updateResourceSchema>

export const changeLicenseSchema = z.object({
  licenseStatus: z.enum(LICENSE_STATUSES),
  licenseNote: z.string().trim().max(2000).optional(),
  licenseSourceUrl: z.url().max(500).optional(),
  /** 变更理由强制填写，进 license_change_log */
  reason: z.string().trim().min(5).max(500),
})

export const submitResourceSchema = z.object({
  /** 上传者确认已阅读分发规范；false 直接 400 */
  acknowledgeLicensePolicy: z.literal(true, {
    error: 'validation.must_acknowledge',
  }),
  note: z.string().trim().max(500).optional(),
})

export const delistResourceSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

/** 多维筛选：类型 × 原作 × 展会 × 社团 × 标签 × 许可 × 语言 */
export const listResourcesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  type: csvSlug(8),
  work: csvSlug(12),
  event: csvSlug(8),
  circle: csvSlug(8),
  tag: csvSlug(16),
  license: csvEnum(LICENSE_STATUSES),
  lang: csvEnum(LOCALES),
  /** 仅 staff 生效；普通调用者一律被服务端强制为 published */
  status: csvEnum(RESOURCE_STATUSES),
  uploaderId: idSchema.optional(),
  hasMirror: z.stringbool().optional(),
  sort: z.enum(RESOURCE_SORTS).default('new'),
  /** 是否返回 facet 计数（列表页首屏要，无限滚动后续页不要） */
  facets: z.stringbool().default(false),
})

export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>
```

> `z.stringbool()` 是 zod v4 的字符串布尔解析（`'true'|'1'|'yes'` → `true`），正好用于 query。若锁定版本没有，退回 `z.enum(['true','false']).transform(v => v === 'true').optional()`。

### 3.7 `packages/shared/src/kourindou/version.ts`

```ts
import { z } from 'zod'
import { localizedMarkdownSchema, localizedTextSchema } from '../localized'
import { FILE_STORAGE_KINDS } from './enums'
import { idSchema } from './resource'

export const createVersionSchema = z.object({
  /** 'v1.2' / 'C105版' / '汉化 rev3'——自由文本，展示原样 */
  versionLabel: z.string().trim().min(1).max(64),
  changelog: localizedMarkdownSchema.optional(),
  releasedAt: z.iso.datetime().optional(),
  /** 建版本时即置为最新（partial unique index 保证每资源唯一 latest） */
  makeLatest: z.boolean().default(true),
})

export const updateVersionSchema = createVersionSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'validation.empty_patch' })

/**
 * 挂文件：B2 对象与外链镜像的判别联合。
 * 一份 schema 同时喂运行时校验、drizzle 列的 $type、以及 DB 的 CHECK 约束：
 *   CHECK ((storage_kind='b2'       AND s3_key IS NOT NULL)
 *       OR (storage_kind='external' AND external_url IS NOT NULL))
 * b2 分支只收 intentId——服务端据此查 upload_intent 校验归属与真实大小，
 * 客户端永远拿不到也不需要 s3 key。这是 legacy「无条件信任客户端 key」的根治。
 */
export const attachFileSchema = z.discriminatedUnion('storageKind', [
  z.object({
    storageKind: z.literal(FILE_STORAGE_KINDS[0]), // 'b2'
    intentId: idSchema,
    displayName: localizedTextSchema.optional(),
    sortOrder: z.number().int().min(0).max(999).default(0),
  }),
  z.object({
    storageKind: z.literal(FILE_STORAGE_KINDS[1]), // 'external'
    externalUrl: z.url().max(1000),
    /** 外链无法信任大小，声明值仅供展示，UI 需标注「镜像」 */
    declaredSizeBytes: z.number().int().min(0).optional(),
    displayName: localizedTextSchema.optional(),
    sortOrder: z.number().int().min(0).max(999).default(0),
  }),
])

export type AttachFileInput = z.infer<typeof attachFileSchema>

export const updateFileSchema = z
  .object({
    displayName: localizedTextSchema,
    sortOrder: z.number().int().min(0).max(999),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'validation.empty_patch' })
```

### 3.8 `packages/shared/src/kourindou/upload.ts`

```ts
import { z } from 'zod'
import { UPLOAD_PURPOSES } from './enums'
import { idSchema } from './resource'

export const MAX_COVER_BYTES = 10 * 1024 * 1024 // 10 MiB
export const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024 // 8 GiB
export const MULTIPART_THRESHOLD_BYTES = 32 * 1024 * 1024
export const MULTIPART_PART_BYTES = 16 * 1024 * 1024
export const MAX_MULTIPART_PARTS = 1000

export const COVER_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const

export const maxBytesFor = (purpose: (typeof UPLOAD_PURPOSES)[number]) =>
  purpose === 'cover' ? MAX_COVER_BYTES : MAX_FILE_BYTES

const uploadBaseSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  /** 原始文件名只进 DB 展示字段，绝不进 S3 key（规避路径穿越 + CJK 签名歧义） */
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  /** 声明大小：presign 时限流用，confirm 时与 HeadObject 真实值比对 */
  sizeBytes: z.number().int().min(1),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, { error: 'validation.invalid_checksum' })
    .optional(),
})

const enforceSizeLimit = <T extends z.ZodType<{ purpose: 'cover' | 'resource_file'; sizeBytes: number; contentType: string }>>(
  schema: T,
) =>
  schema
    .refine((v) => v.sizeBytes <= maxBytesFor(v.purpose), {
      error: 'validation.file_too_large',
      path: ['sizeBytes'],
    })
    .refine(
      (v) =>
        v.purpose !== 'cover' ||
        (COVER_CONTENT_TYPES as readonly string[]).includes(v.contentType),
      { error: 'validation.unsupported_cover_type', path: ['contentType'] },
    )

export const presignUploadSchema = enforceSizeLimit(uploadBaseSchema)
export type PresignUploadInput = z.infer<typeof presignUploadSchema>

export const startMultipartSchema = enforceSizeLimit(
  uploadBaseSchema.extend({
    purpose: z.literal('resource_file'),
    sizeBytes: z.number().int().min(MULTIPART_THRESHOLD_BYTES),
  }),
)

export const completeMultipartSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
        etag: z.string().trim().min(1).max(128),
      }),
    )
    .min(1)
    .max(MAX_MULTIPART_PARTS),
})

export const uploadIntentSchema = z.object({
  id: idSchema,
  purpose: z.enum(UPLOAD_PURPOSES),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  state: z.enum(['pending', 'uploaded', 'failed', 'expired']),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
})
```

### 3.9 `packages/shared/src/kourindou/interaction.ts` 与 `content/post.ts`

```ts
// packages/shared/src/kourindou/interaction.ts
import { z } from 'zod'

export const rateResourceSchema = z.object({
  score: z.number().int().min(1).max(5),
})

export type RateResourceInput = z.infer<typeof rateResourceSchema>
```

> zod 校 API 边界，DB 同时加 `CHECK (score BETWEEN 1 AND 5)`。**两层都要**——「一份 schema 喂运行时校验」不能替代数据库不变式；legacy 全库零 CHECK，任何绕过路由的写入都能污染 `rating_sum`。

```ts
// packages/shared/src/content/post.ts
// 刻意不放在 kourindou/ 下：M3 的资源评论与 M4 的论坛楼层是同一份数据、同一份 schema。
import { z } from 'zod'
import { TOPIC_KINDS } from '../kourindou/enums'
import { idSchema } from '../kourindou/resource'

export const createPostSchema = z.object({
  bodyMd: z.string().trim().min(1).max(10000),
  /** 引用某一楼（NGA 心智），不是无限层级树 */
  replyToPostId: idSchema.optional(),
})

export const updatePostSchema = z.object({
  bodyMd: z.string().trim().min(1).max(10000),
})

export const postAuthorSchema = z.object({
  id: idSchema,
  name: z.string(),
  image: z.string().nullable(),
  trustLevel: z.number().int().min(0).max(3),
})

export const postSchema = z.object({
  id: idSchema,
  topicId: idSchema,
  floorNo: z.number().int().min(1),
  author: postAuthorSchema.nullable(), // 注销用户 → null 占位，楼层不塌
  bodyMd: z.string(),
  replyTo: z
    .object({ id: idSchema, floorNo: z.number().int(), authorName: z.string() })
    .nullable(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
})

export const topicKindSchema = z.enum(TOPIC_KINDS)
export type Post = z.infer<typeof postSchema>
```

### 3.10 `packages/shared/src/kourindou/moderation.ts`

```ts
import { z } from 'zod'
import { paginationQuerySchema } from '../pagination'
import {
  CLAIM_STATUSES,
  LOCALES,
  REJECT_REASONS,
  REPORT_KINDS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  RESOURCE_STATUSES,
  REVIEW_DECISIONS,
  TAKEDOWN_RELATIONS,
  TAKEDOWN_STATUSES,
  TRUST_LEVELS,
} from './enums'
import { idSchema } from './resource'

export const createReportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: idSchema,
    kind: z.enum(REPORT_KINDS),
    reason: z.string().trim().min(10).max(2000),
    evidenceUrls: z.array(z.url().max(500)).max(5).default([]),
  })
  // copyright 只对资源成立，且直连下架流程
  .refine((v) => v.kind !== 'copyright' || v.targetType === 'resource', {
    error: 'validation.copyright_report_requires_resource',
    path: ['kind'],
  })

export const listReportsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).default('open'),
  kind: z.enum(REPORT_KINDS).optional(),
  targetType: z.enum(REPORT_TARGET_TYPES).optional(),
})

export const resolveReportSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  resolution: z.string().trim().max(1000).optional(),
  /** 处理举报的同时可顺带下架资源（举报-处理闭环） */
  delistTarget: z.boolean().default(false),
})

export const reviewResourceSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    rejectReason: z.enum(REJECT_REASONS).optional(),
    /** 驳回理由对上传者可见，必须能被翻译 → 枚举 + 自由补充 */
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision !== 'reject' || v.rejectReason !== undefined, {
    error: 'validation.reject_reason_required',
    path: ['rejectReason'],
  })

export const forceStatusSchema = z.object({
  status: z.enum(RESOURCE_STATUSES),
  reason: z.string().trim().min(5).max(1000),
})

export const moderationQueueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RESOURCE_STATUSES).default('pending'),
  /** 抽查队列：自动过审但尚未人工看过的 */
  spotCheckOnly: z.stringbool().default(false),
  maxTrustLevel: z.coerce.number().int().min(0).max(3).optional(),
  typeSlug: z.string().max(32).optional(),
})

export const createClaimSchema = z.object({
  statement: z.string().trim().min(20).max(2000),
  evidenceUrls: z.array(z.url().max(500)).min(1).max(10),
  contactUrl: z.url().max(500).optional(),
})

export const resolveClaimSchema = z.object({
  status: z.enum(CLAIM_STATUSES),
  note: z.string().trim().max(1000).optional(),
})

/**
 * 下架申请：允许匿名提交。
 * 日本社团不会为发一封下架函而注册中文站账号；产品文档把 ja 界面
 * 列为「社团认领/下架通道真正可用的前提」，这条 schema 就是那个前提的落点。
 */
export const createTakedownSchema = z.object({
  resourceId: idSchema,
  relation: z.enum(TAKEDOWN_RELATIONS),
  claimantName: z.string().trim().min(1).max(120),
  circleName: z.string().trim().max(120).optional(),
  contactEmail: z.email().max(200),
  contactUrl: z.url().max(500).optional(),
  statement: z.string().trim().min(20).max(4000),
  evidenceUrls: z.array(z.url().max(500)).min(1).max(10),
  /** 回执与后续状态通知用哪种语言 */
  locale: z.enum(LOCALES).default('ja'),
  acknowledgeTruthful: z.literal(true, { error: 'validation.must_acknowledge' }),
})

export const resolveTakedownSchema = z.object({
  status: z.enum(TAKEDOWN_STATUSES),
  resolution: z.string().trim().max(2000).optional(),
  delistResource: z.boolean().default(false),
})

export const setTrustOverrideSchema = z.object({
  trustLevel: z.union([z.literal(TRUST_LEVELS[0]), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  reason: z.string().trim().min(5).max(500),
})
```

### 3.11 `packages/shared/src/kourindou/trust.ts` —— 先发后审与状态机的单一真相

```ts
import {
  LICENSE_PERMISSIVENESS,
  LICENSE_REQUIRES_REVIEW,
  type LicenseStatus,
  type ResourceStatus,
  type TrustLevel,
} from './enums'

/** 只存信号，等级永远是算出来的（缓存列可加索引，但不是真相） */
export type TrustSignals = {
  approvedResourceCount: number
  strikeCount: number
  accountAgeDays: number
  emailVerified: boolean
  /** 人工锁定（风控/内测邀请），非 null 时短路所有规则 */
  override: TrustLevel | null
}

export const TRUST_RULES = [
  { level: 3, minApproved: 20, minAgeDays: 30 },
  { level: 2, minApproved: 3, minAgeDays: 14 },
  { level: 1, minApproved: 1, minAgeDays: 3 },
  { level: 0, minApproved: 0, minAgeDays: 0 },
] as const satisfies readonly {
  level: TrustLevel
  minApproved: number
  minAgeDays: number
}[]

export const computeTrustLevel = (signals: TrustSignals): TrustLevel => {
  if (signals.override !== null) return signals.override
  if (!signals.emailVerified) return 0
  if (signals.strikeCount > 0) return 0 // 一次确认侵权直接清零
  const matched = TRUST_RULES.find(
    (rule) =>
      signals.approvedResourceCount >= rule.minApproved &&
      signals.accountAgeDays >= rule.minAgeDays,
  )
  return matched?.level ?? 0
}

export const AUTO_PUBLISH_MIN_TRUST: TrustLevel = 2
export const TURNSTILE_EXEMPT_MIN_TRUST: TrustLevel = 2
export const CIRCLE_CREATE_MIN_TRUST: TrustLevel = 1

export const DAILY_UPLOAD_QUOTA = {
  0: 2,
  1: 5,
  2: 20,
  3: 50,
} as const satisfies Record<TrustLevel, number>

export type SubmitDecisionInput = {
  trustLevel: TrustLevel
  licenseStatus: LicenseStatus
  /** 该用户是否还没有任何已发布资源 */
  isFirstResource: boolean
  /** 版本里是否含不在允许清单上的外链镜像宿主 */
  hasUntrustedMirror: boolean
}

export type SubmitDecision = {
  status: Extract<ResourceStatus, 'pending' | 'published'>
  requiresReview: boolean
  /** i18n key 数组——上传向导第 5 步与审核队列共用同一批文案 */
  reasonKeys: string[]
  /** 自动过审的进抽查队列，事后人工抽看 */
  spotCheck: boolean
}

/**
 * 先发后审的唯一判定点。
 * 这个函数在 packages/shared，所以上传向导（RRv8 loader）与 API 用同一份逻辑，
 * 前端能在提交前如实显示「将进入审核队列」还是「将立即发布」，不会与后端不一致。
 */
export const decideSubmit = (input: SubmitDecisionInput): SubmitDecision => {
  const reasonKeys: string[] = []
  if (input.isFirstResource) reasonKeys.push('review_reason.first_resource')
  if (input.trustLevel < AUTO_PUBLISH_MIN_TRUST) {
    reasonKeys.push('review_reason.trust_too_low')
  }
  if (LICENSE_REQUIRES_REVIEW.includes(input.licenseStatus)) {
    reasonKeys.push('review_reason.license_needs_check')
  }
  if (input.hasUntrustedMirror) reasonKeys.push('review_reason.untrusted_mirror')

  const requiresReview = reasonKeys.length > 0
  return {
    status: requiresReview ? 'pending' : 'published',
    requiresReview,
    reasonKeys,
    spotCheck: !requiresReview,
  }
}

/** 收紧许可免审，放宽许可必须人工复核 */
export const licenseChangeNeedsReview = (
  from: LicenseStatus,
  to: LicenseStatus,
) => LICENSE_PERMISSIVENESS[to] > LICENSE_PERMISSIVENESS[from]

export const RESOURCE_TRANSITIONS = {
  draft: ['pending', 'published'],
  pending: ['published', 'rejected', 'delisted'],
  rejected: ['pending', 'draft'],
  published: ['pending', 'delisted'],
  delisted: ['pending', 'published'],
} as const satisfies Record<ResourceStatus, readonly ResourceStatus[]>

export type TransitionActor = {
  isOwner: boolean
  isStaff: boolean
  trustLevel: TrustLevel
}

export const canTransition = (
  from: ResourceStatus,
  to: ResourceStatus,
  actor: TransitionActor,
): boolean => {
  if (!(RESOURCE_TRANSITIONS[from] as readonly ResourceStatus[]).includes(to)) {
    return false
  }
  if (actor.isStaff) return true
  if (!actor.isOwner) return false
  // 上传者自己能做的：提交、自主下架、恢复（信任够则直发，否则回队列）
  if (from === 'draft' || from === 'rejected') return to === 'pending' || to === 'published'
  if (from === 'published') return to === 'delisted'
  if (from === 'delisted') {
    return to === 'pending' || (to === 'published' && actor.trustLevel >= AUTO_PUBLISH_MIN_TRUST)
  }
  return false
}

/** 只有这些状态对匿名访客可见/可下载。绝不写 `!== 'delisted'`。 */
export const PUBLIC_RESOURCE_STATUSES: readonly ResourceStatus[] = ['published']
```

### 3.12 `packages/shared/src/index.ts`

```ts
import './validation' // 副作用：注册全局 zod error map，必须最先

export * from './errors'
export * from './issue-schema'
export * from './localized'
export * from './pagination'
export * from './content/post'
export * from './kourindou/circle'
export * from './kourindou/enums'
export * from './kourindou/interaction'
export * from './kourindou/moderation'
export * from './kourindou/resource'
export * from './kourindou/trust'
export * from './kourindou/upload'
export * from './kourindou/version'
```

---

## 4. hono 模块骨架

### 4.1 `apps/api/src/http/env.ts`

```ts
import type { TrustLevel, UserRole } from '@gensokyo/shared'

export type Actor = {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  trustLevel: TrustLevel
  approvedResourceCount: number
  strikeCount: number
  emailVerified: boolean
  createdAt: Date
}

export type AppEnv = {
  Variables: {
    requestId: string
    actor: Actor | null
  }
}

/** requireAuth 之后的 Env：actor 收窄为非 null */
export type AuthedEnv = {
  Variables: AppEnv['Variables'] & { actor: Actor }
}

/** requireOwnerOrStaff 之后的 Env：实体已加载好，handler 不再二次查库 */
export type OwnedEnv<T> = {
  Variables: AuthedEnv['Variables'] & { subject: T }
}
```

### 4.2 `apps/api/src/http/error.ts`

```ts
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  type FieldIssue,
} from '@gensokyo/shared'
import type { Context, ErrorHandler } from 'hono'
import type { AppEnv } from './env'

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly params?: Record<string, string | number>,
    readonly fields?: FieldIssue[],
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

/**
 * 注意：onError 返回的响应【不】进入 hc 的类型推导——
 * hc 只看 handler 的返回类型。所以错误形状的类型安全由
 * packages/api-client 在运行时用 apiErrorSchema 解析后抛 ApiClientError 提供。
 * 好处：成功响应类型保持精简，不会每条路由都背一个 400|401|403|404 联合。
 */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId') ?? ''
  if (err instanceof ApiError) {
    return c.json(
      {
        error: {
          code: err.code,
          ...(err.params ? { params: err.params } : {}),
          ...(err.fields ? { fields: err.fields } : {}),
          requestId,
        },
      },
      API_ERROR_STATUS[err.code],
    )
  }
  console.error(`[${requestId}] unhandled`, err)
  return c.json(
    { error: { code: 'internal_error' as const, requestId } },
    500,
  )
}

export const notFoundHandler = (c: Context<AppEnv>) =>
  c.json({ error: { code: 'not_found' as const, requestId: c.get('requestId') } }, 404)
```

### 4.3 `apps/api/src/http/validate.ts`

```ts
import { toFieldIssues } from '@gensokyo/shared'
import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { ApiError } from './error'

/**
 * zValidator 的统一包装。
 * 关键点：hook 里【抛】ApiError 而不是 return c.json(...)。
 * 若 return 响应，那个 400 会被并进每条路由的返回类型联合，
 * 前端每次 res.json() 都要先窄化——这正是 legacy 单路由 ?action= 的老毛病。
 */
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ApiError('validation_error', undefined, toFieldIssues(result.error))
    }
  })
```

### 4.4 `apps/api/src/middleware/session.ts`

```ts
import { createMiddleware } from 'hono/factory'
import { auth } from '../auth'
import type { AppEnv } from '../http/env'
import { loadActor } from '../modules/actor.service'

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('requestId', crypto.randomUUID())
  // 无 cookie 直接短路：公开列表页是最热路径，不该为匿名请求多打一次库
  const hasCookie = c.req.raw.headers.has('cookie')
  if (!hasCookie) {
    c.set('actor', null)
    await next()
    return
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('actor', session ? await loadActor(session.user.id) : null)
  await next()
})
```

`loadActor` 一次 join `user` + `user_profile`，并用 `computeTrustLevel()` 现算等级（缓存列只用于队列排序索引）。整个进程里 `auth.api.getSession` **只在这一处调用**——legacy 每个端点各调一次是纯浪费。

### 4.5 `apps/api/src/middleware/guard.ts`

```ts
import {
  CIRCLE_CREATE_MIN_TRUST,
  type ApiErrorCode,
  type TrustLevel,
  type UserRole,
} from '@gensokyo/shared'
import { createMiddleware } from 'hono/factory'
import type { AuthedEnv, OwnedEnv } from '../http/env'
import { ApiError } from '../http/error'

export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.get('actor')) throw new ApiError('unauthenticated')
  await next()
})

export const requireRole = (...roles: readonly UserRole[]) =>
  createMiddleware<AuthedEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) throw new ApiError('unauthenticated')
    if (!roles.includes(actor.role)) throw new ApiError('forbidden')
    await next()
  })

export const requireStaff = requireRole('moderator', 'admin')
export const requireAdmin = requireRole('admin')

export const requireTrust = (min: TrustLevel) =>
  createMiddleware<AuthedEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) throw new ApiError('unauthenticated')
    if (actor.trustLevel < min) {
      throw new ApiError('trust_level_too_low', { required: min, current: actor.trustLevel })
    }
    await next()
  })

export const requireCircleCreator = requireTrust(CIRCLE_CREATE_MIN_TRUST)

/**
 * 归属守卫。
 * 刻意用 `{ param, load }` 而不是 `(c) => ...`：中间件工厂里传 Context 会撞上
 * Hono Env 泛型不可协变的问题，而 param 名 + 纯 loader 完全绕开它。
 * load 的结果放进 c.get('subject')，handler 不必二次查库——
 * 这也是为什么归属检查值得做成中间件而不是留在 service 里。
 */
export const requireOwnerOrStaff = <T extends { ownerId: string }>(options: {
  param: string
  load: (id: string) => Promise<T | null>
  notFound?: ApiErrorCode
}) =>
  createMiddleware<OwnedEnv<T>>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) throw new ApiError('unauthenticated')
    const id = c.req.param(options.param)
    if (!id) throw new ApiError(options.notFound ?? 'not_found')
    const subject = await options.load(id)
    if (!subject) throw new ApiError(options.notFound ?? 'not_found')
    const isStaff = actor.role === 'moderator' || actor.role === 'admin'
    if (subject.ownerId !== actor.id && !isStaff) throw new ApiError('forbidden')
    c.set('subject', subject)
    await next()
  })
```

**分工原则**：中间件只做「粗粒度闸门 + 加载被操作实体」。**细粒度判定留给 `policy.ts` 的纯函数**，因为它依赖实体的当前状态：

```ts
// apps/api/src/modules/kourindou/policy.ts
import { canTransition, type ResourceStatus, type TrustLevel } from '@gensokyo/shared'
import type { Actor } from '../../http/env'

export const isStaff = (actor: Actor) =>
  actor.role === 'moderator' || actor.role === 'admin'

export type ResourceSubject = {
  id: string
  ownerId: string
  status: ResourceStatus
}

export const canViewResource = (subject: ResourceSubject, actor: Actor | null) =>
  subject.status === 'published' ||
  (actor !== null && (actor.id === subject.ownerId || isStaff(actor)))

/** staff 只能改状态/许可/标签，改不了标题——与 owner 权限分级，legacy 是完全等价的 */
export const canEditContent = (subject: ResourceSubject, actor: Actor) =>
  actor.id === subject.ownerId || actor.role === 'admin'

export const assertTransition = (
  subject: ResourceSubject,
  to: ResourceStatus,
  actor: Actor,
) =>
  canTransition(subject.status, to, {
    isOwner: subject.ownerId === actor.id,
    isStaff: isStaff(actor),
    trustLevel: actor.trustLevel,
  })
```

### 4.6 `apps/api/src/modules/kourindou/index.ts` —— 装配

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env'
import { circles } from './circles'
import { commentItems, resourceComments } from './comments'
import { files } from './files'
import { interactions } from './interactions'
import { mine } from './mine'
import { moderation } from './moderation'
import { reports } from './reports'
import { resources } from './resources'
import { takedowns } from './takedowns'
import { taxonomy } from './taxonomy'
import { uploads } from './uploads'
import { resourceVersions, versions } from './versions'

/**
 * 装配规则（为了 hc 的 AppType 推导，全部必须是一条链式表达式）：
 *  1. 绝不 `const k = new Hono(); k.route(...)` —— typeof 拿不到累积的 schema。
 *  2. 每个子路由器 ≤ ~12 条路由。route 数一多 TS 会报 2589（类型实例化过深），
 *     拆子路由器是唯一可扩展的缓解手段。
 *  3. 同前缀可以挂多个路由器（`/resources` 挂了 4 个），Hono 会合并 schema。
 *     这样 URL 保持 REST 嵌套，文件不至于变成 1000 行。
 *  4. 任何 `export const x: Hono = ...` 的类型标注都会抹掉推导，禁止。
 */
export const kourindou = new Hono<AppEnv>()
  .route('/resources', resources)
  .route('/resources', resourceVersions)
  .route('/resources', interactions)
  .route('/resources', resourceComments)
  .route('/versions', versions)
  .route('/files', files)
  .route('/comments', commentItems)
  .route('/uploads', uploads)
  .route('/circles', circles)
  .route('/takedowns', takedowns)
  .route('/reports', reports)
  .route('/taxonomy', taxonomy)
  .route('/me', mine)
  .route('/moderation', moderation)
```

### 4.7 `apps/api/src/modules/kourindou/resources.ts` —— 子路由器范例

```ts
import {
  changeLicenseSchema,
  createResourceSchema,
  delistResourceSchema,
  listResourcesQuerySchema,
  submitResourceSchema,
  updateResourceSchema,
} from '@gensokyo/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env'
import { ApiError } from '../../http/error'
import { validate } from '../../http/validate'
import {
  requireAdmin,
  requireAuth,
  requireOwnerOrStaff,
} from '../../middleware/guard'
import { rateLimit } from '../../middleware/rate-limit'
import { turnstile } from '../../middleware/turnstile'
import { canViewResource } from './policy'
import * as service from './resources.service'

const owner = requireOwnerOrStaff({
  param: 'id',
  load: service.loadSubject,
  notFound: 'resource_not_found',
})

export const resources = new Hono<AppEnv>()
  .get('/', validate('query', listResourcesQuerySchema), async (c) => {
    const query = c.req.valid('query')
    const actor = c.get('actor')
    // status 筛选只对 staff 生效；其余一律强制 published（白名单，不是黑名单）
    const page = await service.listResources(query, actor)
    c.header('cache-control', actor ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=300')
    return c.json(page)
  })

  .get('/:slug', async (c) => {
    const actor = c.get('actor')
    const detail = await service.getResourceBySlug(c.req.param('slug'), actor)
    if (!detail) throw new ApiError('resource_not_found')
    if (!canViewResource(detail.resource, actor)) {
      throw new ApiError('resource_not_available')
    }
    return c.json(detail)
  })

  .post(
    '/',
    requireAuth,
    turnstile(),
    rateLimit({ key: 'resource:create', limit: 10, windowSec: 3600 }),
    validate('json', createResourceSchema),
    async (c) => {
      const resource = await service.createResource(c.get('actor'), c.req.valid('json'))
      return c.json({ resource }, 201)
    },
  )

  .patch('/:id', requireAuth, owner, validate('json', updateResourceSchema), async (c) => {
    const result = await service.updateResource(
      c.get('subject'),
      c.get('actor'),
      c.req.valid('json'),
    )
    return c.json(result)
  })

  .post('/:id/submit', requireAuth, owner, validate('json', submitResourceSchema), async (c) => {
    // ← 先发后审的唯一入口，见 §6
    const result = await service.submitResource(c.get('subject'), c.get('actor'))
    return c.json(result)
  })

  .post('/:id/delist', requireAuth, owner, validate('json', delistResourceSchema), async (c) => {
    const resource = await service.delistResource(
      c.get('subject'),
      c.get('actor'),
      c.req.valid('json').reason ?? null,
    )
    return c.json({ resource })
  })

  .post('/:id/republish', requireAuth, owner, async (c) => {
    return c.json(await service.republishResource(c.get('subject'), c.get('actor')))
  })

  .patch('/:id/license', requireAuth, owner, validate('json', changeLicenseSchema), async (c) => {
    return c.json(
      await service.changeLicense(c.get('subject'), c.get('actor'), c.req.valid('json')),
    )
  })

  .delete('/:id', requireAuth, requireAdmin, async (c) => {
    return c.json(await service.hardDeleteResource(c.req.param('id'), c.get('actor')))
  })
```

注意 `.patch('/:id', requireAuth, owner, validate(...), handler)` 里 `c.get('subject')` 已被 `owner` 中间件的 `OwnedEnv<T>` 收窄为非 null——Hono 会把路由内联中间件的 Env 与外层 Env 求交，`Actor | null` ∩ `Actor` = `Actor`。这就是 `requireAuth` 免去手写判空的机制。

### 4.8 `apps/api/src/modules/kourindou/uploads.ts` —— 上传范例

```ts
import {
  completeMultipartSchema,
  presignUploadSchema,
  startMultipartSchema,
} from '@gensokyo/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env'
import { validate } from '../../http/validate'
import { requireAuth } from '../../middleware/guard'
import { rateLimit } from '../../middleware/rate-limit'
import * as service from './uploads.service'

/**
 * legacy 是一条 `POST /api/upload/multipart?action=start|part|complete|abort`。
 * 拆成独立路由不只是美观：hc 无法为 query 分支收窄返回类型，
 * 单路由在 RPC 下会退化成四种响应的联合，前端每次都得窄化。
 */
export const uploads = new Hono<AppEnv>()
  .post(
    '/presign',
    requireAuth,
    rateLimit({ key: 'upload:presign', limit: 120, windowSec: 3600 }),
    validate('json', presignUploadSchema),
    async (c) => c.json(await service.presign(c.get('actor'), c.req.valid('json'))),
  )
  .post(
    '/multipart',
    requireAuth,
    rateLimit({ key: 'upload:multipart', limit: 30, windowSec: 3600 }),
    validate('json', startMultipartSchema),
    async (c) =>
      // 一次性签完所有分片：1GB 文件从 258 次往返降到 3 次
      c.json(await service.startMultipart(c.get('actor'), c.req.valid('json'))),
  )
  .post(
    '/multipart/:intentId/complete',
    requireAuth,
    validate('json', completeMultipartSchema),
    async (c) =>
      c.json(
        await service.completeMultipart(
          c.get('actor'),
          c.req.param('intentId'),
          c.req.valid('json').parts,
        ),
      ),
  )
  .post('/multipart/:intentId/abort', requireAuth, async (c) =>
    c.json(await service.abortMultipart(c.get('actor'), c.req.param('intentId'))),
  )
  .post('/:intentId/confirm', requireAuth, async (c) =>
    // HeadObject 校验真实 size/contentType 与声明是否一致，回填 checksum
    c.json(await service.confirmUpload(c.get('actor'), c.req.param('intentId'))),
  )
```

`uploads.service.ts` 里必须做的四件 legacy 没做的事：
1. 每个 intent 都校验 `intent.userId === actor.id`（legacy 的 part/complete/abort 只验登录，知道 key+uploadId 就能终止他人上传）。
2. `abort` 有真实调用点；另加 cron 扫 `ListMultipartUploads` 清理 >24h 残留（legacy 的 abort helper 写了但全仓零调用，B2 上的分片持续计费且不可见）。
3. S3Client 必须带 `requestChecksumCalculation: 'WHEN_REQUIRED'` 与 `responseChecksumValidation: 'WHEN_REQUIRED'`——否则 aws-sdk 会把空 body 的 CRC32（`AAAAAA==`）签进 query string，客户端无法剔除。legacy 能跑通只是在依赖 B2 的宽容度。
4. 双桶：`gensokyo-assets`（public，封面走 CDN）+ `gensokyo-files`（private，只走签名 URL）。B2 的 public/private 是整桶级别的，legacy 为了显示封面把桶设成 public，导致 `presignGet` 的保护实际为 0。

### 4.9 `apps/api/src/app.ts` 的改动

```ts
import { Hono } from 'hono'
import { auth } from './auth'
import type { AppEnv } from './http/env'
import { notFoundHandler, onError } from './http/error'
import { sessionMiddleware } from './middleware/session'
import { kourindou } from './modules/kourindou'
import { me } from './modules/me'

export const app = new Hono<AppEnv>()
  .basePath('/api')
  // better-auth 排在 session 中间件之前：它自己管 session，
  // 放后面会让每个 auth 请求白白多跑一次 getSession
  .on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  .use(sessionMiddleware)
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/me', me)
  .route('/kourindou', kourindou)
  .notFound(notFoundHandler)
  .onError(onError)

export type AppType = typeof app
```

`.notFound()` / `.onError()` 返回 Hono 且保留 schema，链式安全。

### 4.10 `packages/api-client/src/index.ts` 的配套改动

```ts
import type { AppType } from '@gensokyo/api'
import { apiErrorSchema, type ApiErrorBody, type ApiErrorCode } from '@gensokyo/shared'
import { hc } from 'hono/client'

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody['error'],
  ) {
    super(body.code)
    this.name = 'ApiClientError'
  }
  get code(): ApiErrorCode {
    return this.body.code
  }
}

/** loader/action 里统一用它拆包：成功类型来自 hc 推导，错误类型来自运行时解析 */
export const unwrap = async <T>(res: Response & { json: () => Promise<T> }): Promise<T> => {
  if (res.ok) return res.json()
  const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null))
  if (!parsed.success) {
    throw new ApiClientError(res.status, { code: 'internal_error', requestId: '' })
  }
  throw new ApiClientError(res.status, parsed.data.error)
}

export const createClient = (
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) => hc<AppType>(baseUrl, options?.headers ? { headers: options.headers } : {})

export type ApiClient = ReturnType<typeof createClient>
```

---

## 5. 权限中间件小结

三层，职责不重叠：

| 层 | 位置 | 做什么 | 为什么在这层 |
|---|---|---|---|
| `sessionMiddleware` | `app.ts` 全局一次 | 生成 requestId、解 session、装配 `Actor`（含 role + 现算的 trustLevel） | `auth.api.getSession` 全进程唯一调用点；无 cookie 短路 |
| `requireAuth` / `requireRole` / `requireTrust` / `turnstile` / `rateLimit` | 路由内联 | 与被操作实体无关的粗闸门 | 不需要查库就能拒绝，省一次 DB 往返 |
| `requireOwnerOrStaff` | 路由内联 | 加载实体 + 判归属，结果放 `c.get('subject')` | 实体反正要加载；放中间件避免 handler 二次查库 |
| `policy.ts` 纯函数 | service 内 | 依赖实体状态的细判定（能否查看/能否改内容/能否状态流转） | 需要 `status`、`trustLevel`、目标状态三方参与，中间件表达不了；且要能被 cron、种子脚本、M4 复用 |

**与 legacy 的关键差异**：legacy 的 staff 与 owner 权限完全等价（都能改标题、都能硬删）。新设计里 staff 只能改状态/许可/标签（`canEditContent` 返回 false），硬删只留 admin 且不物理删。

---

## 6. 先发后审 + 信任梯度

### 6.1 字段（`user_profile` 表，**不碰 better-auth 的 `user` 表**）

`packages/db/src/schema/auth.ts` 是 better-auth CLI 可再生成的文件，`role` 绝不能像 legacy 那样塞进去。新建：

```
user_profile
  userId          text PK → user.id cascade
  role            pgEnum('user'|'moderator'|'admin')  NOT NULL DEFAULT 'user'
  trustLevelCache smallint NOT NULL DEFAULT 0     -- 仅供队列排序建索引，不是真相
  trustOverride   smallint NULL                    -- 人工锁定，非 null 短路规则
  approvedResourceCount int NOT NULL DEFAULT 0
  rejectedResourceCount int NOT NULL DEFAULT 0
  strikeCount     int NOT NULL DEFAULT 0           -- 确认侵权/违规次数，>0 直接清零信任
  bio             jsonb                            -- LocalizedText
  locale          text
  createdAt / updatedAt timestamptz
```

`role`（权限）与 `trustLevel`（信任）**必须分开**：产品文档说信任等级两模块共享，role 是权限。legacy 的 `uploader` role 是把信任等级伪装成角色，不学。

### 6.2 等级与效果

| level | 名称 | 条件（全部满足） | 效果 |
|---|---|---|---|
| 0 | newcomer | 默认 / 邮箱未验证 / strike>0 | 提交 → `pending`；日配额 2；必过 Turnstile |
| 1 | contributor | 已通过 ≥1 且账号 ≥3 天 | 提交 → `pending`（队列优先级高）；日配额 5 |
| 2 | trusted | 已通过 ≥3 且账号 ≥14 天 且 strike=0 | 提交 → **直接 `published`**；日配额 20；免 Turnstile；可自助恢复下架 |
| 3 | veteran | 已通过 ≥20 且账号 ≥30 天 且 strike=0 | 同上 + 日配额 50 |

### 6.3 判定逻辑

`decideSubmit()`（§3.11）是唯一判定点，四个强制回审信号任一命中即 `pending`：

1. `isFirstResource` —— 产品文档「新账号首个资源人工审核」的字面落实。
2. `trustLevel < 2` —— 「通过 N 个后即发即审」的 N。
3. **`licenseStatus ∈ {unspecified, authorized_repost}`** —— 这条是版权生死线写进代码。许可未标明的资源**永远不自动过审**，无论上传者信任多高。挖掘报告只把 license 当字段，这里把它变成审核闸门。
4. `hasUntrustedMirror` —— 外链镜像宿主不在允许清单上时回审。

自动过审的仍进 `spot_check` 队列（`moderation/queue?spotCheckOnly=true`）供事后抽查——「即发即审」不等于「永不审」。

因为 `decideSubmit` 在 `packages/shared`，上传向导第 5 步能在提交**前**如实显示「将进入审核队列（原因：许可状态未标明）」还是「将立即发布」，且不可能与后端判定不一致。

### 6.4 状态流转

```
draft ──submit──▶ decideSubmit()
                    ├ requiresReview ──▶ pending ──approve──▶ published
                    │                            └─reject───▶ rejected ─┐
                    └ 自动          ──▶ published (+spot_check)         │
                                                                        │
  rejected ──owner 修改后 resubmit──▶ pending ◀───────────────────────┘
  published ──owner delist──▶ delisted ──owner republish──▶ published (T≥2) / pending
  published ──staff/举报/下架申请──▶ delisted（takedownReason，owner 不可自助恢复）
  any ──admin──▶ 软删 + storage_gc_queue
```

合法迁移由 `RESOURCE_TRANSITIONS` + `canTransition(from, to, actor)` 强制，前后端共用。

### 6.5 审计（法务价值，不是技术洁癖）

每次流转在同一事务里写 `moderation_log(resourceId, action, fromStatus, toStatus, actorId, reasonKey, note, createdAt)`；许可变更另写 `license_change_log(resourceId, from, to, changedBy, reason, sourceUrl, createdAt)`。版权争议发生时要能证明「我们何时依据什么改的状态」。

审核结果落地时同事务更新 `approvedResourceCount` / `strikeCount`，并重算 `trustLevelCache`——所以信任等级的推进是审核动作的副产品，没有额外的定时任务。

---

## 7. 错误响应约定

### 7.1 形状

**成功 = 裸载荷**（与现有 `/api/health`、`/api/me` 一致，不加 `{data}` 包装）。
**失败 = 唯一形状**：

```json
{
  "error": {
    "code": "daily_upload_quota_exceeded",
    "params": { "limit": 2, "trustLevel": 0 },
    "requestId": "01936f4a-..."
  }
}
```

校验失败多一个 `fields`：

```json
{
  "error": {
    "code": "validation_error",
    "requestId": "…",
    "fields": [
      { "path": "title", "code": "custom", "key": "validation.localized_text_required" },
      { "path": "files.0.sizeBytes", "code": "too_big", "key": "validation.too_big",
        "params": { "maximum": 8589934592, "origin": "number" } }
    ]
  }
}
```

### 7.2 i18n：`code` 就是消息 key

不设单独的 `messageKey` 字段——`error.${code}` 是确定性推导，一个真相。前端建一张**编译期穷尽**的映射表：

```ts
// apps/web/app/lib/api-error.ts
import type { ApiErrorCode } from '@gensokyo/shared'
import { m } from '#/paraglide/messages'

const ERROR_MESSAGES = {
  daily_upload_quota_exceeded: (p) => m.error_daily_upload_quota_exceeded({ limit: p.limit }),
  resource_not_available: () => m.error_resource_not_available(),
  // …
} satisfies Record<ApiErrorCode, (params: Record<string, string | number>) => string>
```

`satisfies Record<ApiErrorCode, …>` 意味着**后端新增一个错误码而前端没加翻译，`bun typecheck` 直接失败**。这是 legacy「错误统一降级成 `{error:"bad input"}`」的反面。

Paraglide 要求静态 message 引用，所以必须是显式 map 而非动态 key 查表——这张表就是那个必要的中介，而 `satisfies` 让它不会漏。

### 7.3 三条硬规则

1. **服务端永不返回散文**。`z.config({ customError })`（§3.1）把 zod 内建消息也强制成 `validation.<code>` 形式，refine 的 `error` 一律写成 `'validation.xxx'` key。三语站点里，任何一句英文兜底文案都是缺陷。
2. **`fields` 用 issue 列表而非 `z.treeifyError()`**。treeify 只留 message 字符串，丢掉 `code` 和 `minimum`/`maximum`，前端就做不了带插值的翻译（「最多 200 字」里的 200 从哪来）。
3. **`requestId` 必带**，前端在错误 toast 角落显示，用户报错时能直接对上服务端日志。

### 7.4 状态码

由 `API_ERROR_STATUS`（§3.2）单表映射，前后端共用同一张表：前端据此判断「可重试（429/502/503）」还是「需要用户改输入（400/409）」还是「需要登录（401）」，不必逐个错误码写 if。

### 7.5 hc 类型边界（重要）

`onError` 的响应**不进入** hc 推导（hc 只看 handler 的返回类型）。这是刻意的：如果每条路由都 `return c.json(err, 400)`，返回类型会背上 `400|401|403|404|409` 的联合，前端每次 `res.json()` 都要先窄化——正是 legacy `?action=` 单路由的老毛病。

所以：**成功形状由 hc 静态推导，错误形状由 `apiErrorSchema` 在 `packages/api-client` 运行时解析并抛 `ApiClientError`**。两边都类型安全，且路由返回类型保持精简（这对 §4.6 提到的 TS2589 类型深度问题也有直接帮助）。

---

## 8. 落地顺序建议

1. `packages/shared`（enums → validation → errors → localized → trust → 各 schema）。零依赖，可先单测 `computeTrustLevel` / `decideSubmit` / `canTransition`。
2. `packages/db/src/schema/*.ts` 复用同一批 const 元组建 pgEnum，补 CHECK（`score BETWEEN 1 AND 5`、file 的 b2/external 二选一）、partial unique index（latest version、防刷举报）。
3. `apps/api/src/http/*` + `middleware/*` + 改 `app.ts`。此时跑一遍现有 `app.test.ts`——`{items:[],page:1,pageSize:20}` 与非法分页 400 都应仍然通过。
4. `modules/content/*`（topic/post service）——**先于** kourindou 的 comments，因为它是 M4 的地基。
5. kourindou 各子路由器，按 `taxonomy → resources → versions → uploads → files → interactions → comments → reports → circles → takedowns → moderation → mine` 顺序，每加一个就跑 `bun typecheck` 盯 TS2589。
6. Meilisearch 用 `search_outbox` 表 + cron 排空，**publish 事务不同步等 Meili**——搜索挂了不能阻塞发布。

两个必须在 M3 起手就定、后补代价极高的架构决策：**双桶（public assets / private files）**，以及 **comments 从第一天就是 topic+post**。这两条都改不动一次，改一次要迁数据。