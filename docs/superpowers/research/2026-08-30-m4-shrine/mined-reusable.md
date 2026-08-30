# M4 博丽神社：现有代码可复用机制盘点

2026-08-30 · 调研产出（**文档，不是代码**）· 覆盖 `apps/api`、`packages/db`、`packages/shared`、`apps/web`

产品文档第 53 行写着「角色权限 user/版主/管理员；举报-处理-申诉闭环；信任等级两模块共享」。
本文把这句话逐条落到函数签名、表列名、路由路径上，并给出**哪些必须改、改哪一行、为什么非改不可**。

## 一句话结论

M3 留给 M4 的地基比看上去厚：**鉴权、错误信封、举报写入、举报队列、审计日志、站点配置、SSR 数据层这七样，API 层一行都不用改就能吃帖子**。
真正要动现有代码的只有 **7 处**，其中 **2 处不改必炸**（图片 GC 会删光帖子里的图；staff 删楼不留痕导致申诉无依据）。
M4 该花力气的地方在 **通知中心 / 版块表 / Markdown 渲染与消毒** —— 这三样现有代码里是零基础。

---

## 主对照表：M4 要用什么 → 现有的什么 → 怎么用 → 需要改吗

| M4 需要的能力 | 现有实现 | 怎么用 | 需要改吗 |
|---|---|---|---|
| 登录闸门 | `apps/api/src/middleware/require.ts` `requireAuth` | 发帖/回复/举报路由挂 `requireAuth` | **不改** |
| 版主/站长闸门 | 同上 `requireRole('moderator' \| 'admin')` | 论坛治理路由挂 `requireRole('moderator')` | **不改** |
| 作者本人或 staff | 同上 `isOwnerOrStaff(actor, ownerId)` | 编辑/删除自己的楼 | **不改** |
| 当前用户身份 | `middleware/session.ts` `sessionMiddleware` → `c.get('actor')` | 全局已挂在 `app.ts:17` | **不改** |
| 统一错误信封 | `apps/api/src/errors.ts` `fail(c, code, status, fields?)` | 所有失败分支 | **不改** |
| 请求体/查询校验 | 同上 `validate(target, schema)` | 一律用它，**不用裸 `zValidator`** | **不改** |
| 路径 uuid 校验 | 同上 `entityIdParam` | `/topics/:id/posts` 之类挂它 | **不改**（但参数名必须叫 `id`，见 §3.3） |
| 路径用户 id 校验 | 同上 `userIdParam` | `/users/:id/posts` 之类 | **不改** |
| 分页 | `packages/shared/src/pagination.ts` `paginationQuerySchema` | `validate('query', ...)` | **不改** |
| 楼层读写 | `apps/api/src/modules/content/post.ts` | 直接调 `listPosts` / `createPost` / `softDeletePost` / `findPost` | **加函数**（编辑），并修 `catch` 吞异常 |
| 主题/楼层表 | `packages/db/src/schema/content.ts` `topic` / `post` | `kind='board'` + `boardSlug` 已就位 | **加 CHECK 约束**，`boardSlug` 加 FK |
| 举报写入 | `apps/api/src/modules/interactions.ts` `POST /kourindou/reports` | `targetKind:'post'` **已实现且已做自举报与存在性校验** | API **不改**（建议挪路径，见 P2-3） |
| 举报队列 | `apps/api/src/modules/moderation.ts` `GET /reports` | 多态查询，帖子举报自动进队 | **必须改**：要 join 目标上下文 |
| 举报结案 | 同上 `POST /reports/:id/resolve` | 与目标类型无关 | **不改** |
| 审计留痕 | `packages/db/src/schema/kourindou.ts` `moderationLog` | `subjectKind` 是 varchar 多态，写 `'post'` 即可 | 表**不改**；`MODERATION_ACTION` 枚举要加值 |
| 信任等级 | `userProfile.role / approvedResourceCount / strikeCount` | 论坛只消费 `strikeCount`（见 §5.1） | 表**不改** |
| 即发即审门槛 | `middleware/session.ts` `canAutoPublish(actor, threshold)` | **论坛慎用**，语义是资源站的 | **不改**，但论坛别硬套 |
| 站点配置 | `apps/api/src/site-config.ts` `configValue<T>(key, fallback)` | 加论坛配置项照 `autoPublishThreshold()` 写一行 | **不改**（加键要动三处白名单） |
| 提权 / 用户检索 | `apps/api/src/modules/admin.ts` | 版主任命已经能用 | **不改** |
| SSR 取数（带 cookie） | `apps/web/app/lib/api.ts` `apiFor(request)` | 每个 loader/action 第一行 | **不改** |
| 浏览器取数 | 同上 `browserApi()` | 客户端交互 | **不改** |
| 多语显示回落 | `packages/shared` `resolveLocalized(...)` + `apps/web/app/lib/display.ts` | 版块名走 `resolveLocalized` | **加 helper**，不改现有的 |
| 后台外壳 | `apps/web/app/routes/dash/layout.tsx` | tabs 数组加一项 | **加一项**（纯 additive） |
| 图片上传 | `apps/api/src/modules/uploads.ts` `POST /uploads/image` | 帖子插图直接复用 | **不改** |
| 未引用图片回收 | `apps/api/scripts/gc-images.ts` | —— | **必须改，不改必炸**（§4 P0-1） |

---

## 1. 鉴权与身份（一行不用改）

### 1.1 `apps/api/src/middleware/session.ts`

```ts
export type Actor = {
  id: string          // better-auth 的 32 位随机串，不是 UUID
  name: string
  email: string
  role: UserRole      // 'user' | 'moderator' | 'admin'
  approvedResourceCount: number
  strikeCount: number
}

export type AppEnv = { Variables: { actor: Actor | null } }

export const sessionMiddleware  // createMiddleware<AppEnv>，已在 app.ts:17 全局挂载
export const canAutoPublish = (actor: Actor, threshold: number) =>
  actor.strikeCount === 0 && actor.approvedResourceCount >= threshold
```

用法：`const actor = c.get('actor'); if (!actor) return fail(c, 'unauthorized', 401)`。
即使已经挂了 `requireAuth`，现有代码仍然逐处再判一次 —— 因为 TS 那边 `actor` 的类型是 `Actor | null`，中间件挡不掉类型。M4 照抄这个写法。

**每请求一次 `user_profile` 查询**（session.ts:29-43，首次见到的用户惰性建行）。论坛列表页 QPS 会高于资源站，但这是一条主键查询，M4 不必优化；**要优化也不要改 Actor 的形状**（形状一变会波及 `/api/me` 与 `apps/web/app/components/site-header.tsx` 的 `SessionUser` 类型）。

### 1.2 `apps/api/src/middleware/require.ts`（全文 24 行）

```ts
const RANK: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 }

export const requireAuth                                  // 401 unauthorized
export const requireRole = (min: UserRole) => Middleware   // 401 / 403 forbidden
export const isOwnerOrStaff = (actor: Actor, ownerId: string | null) =>
  actor.id === ownerId || RANK[actor.role] >= RANK.moderator
```

`isOwnerOrStaff` 的第二个参数是 `string | null` —— `post.authorId` 正好是 `text ... onDelete:'set null'`，类型对得上，`findPost()` 的返回可以直接喂进去。`apps/api/src/modules/content/index.ts:83` 就是这么用的。

**不要给论坛引入按版块的版主。** 现有 role 是全站的，solo 运营下没有第二个版主，per-board 角色会凭空多出一张 `board_moderator` 表和一套 scope 判断。

---

## 2. 错误信封与校验（一行不用改）

### 2.1 `apps/api/src/errors.ts`

```ts
export const ERROR_CODES = [
  'unauthorized', 'forbidden', 'not_found', 'validation_failed',
  'rate_limited', 'quota_exceeded', 'invalid_state_transition',
  'invalid_url', 'file_too_large', 'duplicate_slug',
  'self_action_forbidden', 'internal',
] as const

export type ApiError = { error: { code: ErrorCode; fields?: string[] } }

export const fail = (
  c: Context, code: ErrorCode,
  status: ContentfulStatusCode = 400, fields?: string[],
) => c.json<ApiError>({ error: { code, ...(fields ? { fields } : {}) } }, status)

export const validate      // 带错误信封的 zValidator，失败返回 validation_failed + fields[]
export const entityIdParam // validate('param', z.object({ id: entityIdSchema }))
export const userIdParam   // validate('param', z.object({ id: userIdSchema }))
```

`app.ts:34-39` 的 `onError` / `notFound` 把漏网异常也收进同一个信封。M4 的新路由挂进 `app.ts` 就自动继承。

**M4 大概率一个新错误码都不需要。** 帖子编辑窗口过期 → `forbidden`；主题被锁 → `invalid_state_transition`；发帖限速 → `rate_limited`（已在列）。加码之前先证明现有 12 个表达不了。

### 2.2 id 三分（`packages/shared/src/kourindou/schemas.ts:21-26`）

```ts
export const entityIdSchema = z.uuid()                                  // topic.id / post.id
export const userIdSchema   = z.string().min(1).max(64)                 // better-auth id
export const slugIdSchema   = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)  // board slug
export const anyIdSchema    = z.string().min(1).max(64)                 // 举报的多态 targetId
```

`board.slug` 用 `slugIdSchema`；`topic.id` / `post.id` 用 `entityIdSchema`；任何指向用户的路径参数用 `userIdSchema`。

### 2.3 分页（`packages/shared/src/pagination.ts`，全文 8 行）

```ts
export const paginationQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
```

`z.coerce` 已经处理了 Hono 的 query 全是 string。**但数组参数仍要 preprocess 升维** —— 见 `listResourcesQuerySchema.tag`（schemas.ts:105-110）的写法，M4 若做「按多个标签筛主题」照抄。

---

## 3. 内容层：M4 的主战场

### 3.1 `apps/api/src/modules/content/post.ts` —— 楼层 service（M4 是第二个调用方）

文件头的注释就是为 M4 写的：「这是整个 M3 唯一保留 service 抽象的模块 —— 因为它设计上就有两个调用方」。

```ts
export type PostAuthor = { id: string; name: string } | null

export async function listPosts(topicId: string, page = 1, pageSize = 50): Promise<{
  id: string; floor: number; bodyMd: string; deleted: boolean
  parentId: string | null; createdAt: Date; updatedAt: Date
  author: { id: string; name: string } | null
}[]>

export type CreatePostResult =
  | { ok: true; id: string; floor: number }
  | { ok: false; reason: 'topic_missing' | 'parent_invalid' }

export async function createPost(input: {
  topicId: string; authorId: string; bodyMd: string; parentId?: string
}): Promise<CreatePostResult>

export async function softDeletePost(id: string): Promise<void>
export async function findPost(id: string): Promise<{ id: string; authorId: string | null; topicId: string } | undefined>
export async function topicForResource(resourceId: string): Promise<{ id: string } | undefined>
```

**楼层号机制**（post.ts:69-98，M4 直接继承，不要重写）：
在事务里 `UPDATE topic SET post_count = post_count + 1 ... RETURNING post_count`，UPDATE 持行锁把并发发帖串行化；`post_topic_floor_uq` 唯一索引兜底。
`apps/api/src/content.test.ts:97-115` 有 8 并发不撞号、无空洞的回归测试 —— M4 别把这条测试改坏。

**软删保留占位**：`listPosts` 对 `deletedAt !== null` 的行把 `bodyMd` 置空并给 `deleted: true`，楼层号不出现空洞、引用不断。前端渲染分支见 `apps/web/app/routes/kourindou/detail.tsx:323-327`。

**M4 用得上的现成事实**：`topic.postCount` 只增不减（软删不回退），所以它同时是「最高楼层号」和「含已删的总楼数」—— **论坛分页的 total 直接读这一列，不用 `count(*)`**。

**这个 service 缺什么（M4 要补，但都是加东西不是改东西）**：

| 缺 | M4 要做什么 |
|---|---|
| 没有 `updatePost`（编辑） | 在同一文件加一个函数，两个调用方共用 |
| `listPosts` 不返回 total | 用 `topic.postCount`，不加查询 |
| 不检查主题是否被锁 | `topic` 表现在没有 lock 列；要做锁帖才加列 |
| `softDeletePost` 不写审计 | **见 §4 P0-2，这是必改项** |
| `bodyMd` 原样返回，无消毒 | 消毒是 web 侧的新工作（§6） |
| `post.updatedAt` 是 `$onUpdate` | 软删也会顶到 updatedAt，「已编辑」角标不能只看它 |

### 3.2 `packages/db/src/schema/content.ts` —— 表结构（M3 时就按 M4 的形状建好）

```ts
topic {
  id          uuid pk default random
  kind        topic_kind NOT NULL          -- pgEnum('resource','board')，M4 用 'board'
  resourceId  uuid UNIQUE -> resource cascade   -- kind='resource' 时用
  boardSlug   varchar(32)                       -- kind='board' 时用，【无外键】
  title       varchar(200)                      -- 可空，单语（不是 jsonb）
  authorId    text -> user set null
  postCount   integer NOT NULL default 0
  lastPostAt  timestamptz
  deletedAt   timestamptz
  createdAt   timestamptz NOT NULL default now()
}
index topic_board_last_post_idx (board_slug, last_post_at)
index topic_kind_idx (kind)

post {
  id        uuid pk
  topicId   uuid NOT NULL -> topic cascade
  authorId  text -> user set null
  parentId  uuid -> post(id) set null      -- 自引用外键，legacy 的孤儿回复问题已修
  floor     integer NOT NULL
  bodyMd    text NOT NULL
  deletedAt timestamptz
  createdAt / updatedAt  timestamptz NOT NULL（updatedAt 带 $onUpdate）
}
index      post_topic_floor_idx (topic_id, floor)
uniqueIndex post_topic_floor_uq  (topic_id, floor)     -- 楼层号兜底
index      post_author_idx (author_id)
```

**结构性判断**：`topic` **没有正文列**。所以 M4 的主题帖正文只有一种不加列的落法 —— **正文就是 floor 1 的 `post` 行**。
这个选择顺带把「举报」问题解决了（见 §5.2）：举报主题正文 = 举报 floor 1，`targetKind` 一个新值都不用加。

**要补的约束**（additive，DDL 便宜）：

- `topic.boardSlug` 没有外键。M4 建 `board` 表后要挂 FK，否则打错版块名的主题会永久失踪（列表按 boardSlug 查，查不到就不显示，也没有任何地方报错）。
- 没有 CHECK 保证 `kind='resource' ⇒ resourceId NOT NULL` 且 `kind='board' ⇒ boardSlug NOT NULL`。现在靠调用方自觉（`kourindou/index.ts:196-201` 建资源时手写 `kind:'resource'`）。M4 加两个调用方之后应该补 CHECK。
- `topic.title` 可空。板块主题的标题必须必填 —— 在 zod 层强制，或者把列改 NOT NULL（改列要处理已有的 resource 主题，它们的 title 是资源原文标题，非空，所以其实能改）。

**排序索引够用**：`topic_board_last_post_idx (board_slug, last_post_at)` 是升序建的，版块列表要 `ORDER BY last_post_at DESC`，PG 反向扫索引即可，不需要新建降序索引。

### 3.3 `apps/api/src/modules/content/index.ts` —— 现有路由（M4 的镜像参照）

```
GET    /api/kourindou/resources/:slug/posts     列楼层（先解析 slug → published 资源 → topic）
POST   /api/kourindou/resources/:slug/posts     发楼层（requireAuth + createPostSchema）
DELETE /api/kourindou/posts/:id                 软删（entityIdParam + requireAuth + isOwnerOrStaff）
```

文件里的注释写明了 M4 的落点：「M4 博丽神社会在这之上加 `/shrine/topics/:id/posts`，复用 `content/post.ts`」。

**注意 `entityIdParam` 写死了参数名 `id`**（errors.ts:75）。M4 的实体路径参数一律命名 `id` 就能直接复用；`/boards/:slug/topics` 这种要自己写 `validate('param', z.object({ slug: slugIdSchema }))`。
（`:slug` 不校验也不会 500 —— 它进的是 `varchar` 列不是 `uuid` 列，这是 kourindou 现在的做法。但版块 slug 建议还是校验，因为它要拼进 URL。）

**一个可以顺手修正的小瑕疵**：`DELETE /posts/:id` 的中间件顺序是 `entityIdParam, requireAuth`，所以未登录 + 非法 uuid 会先拿到 400 而不是 401。无害，但 M4 新路由请写成 `requireAuth, entityIdParam`。

---

## 4. 必须改现有代码的 7 处

### P0-1 `apps/api/scripts/gc-images.ts` → `referencedUrls()` —— 不改必炸

**现状**：白名单只扫三处引用来源：

```ts
// gc-images.ts:26-49
const [covers, avatars, userImages] = await Promise.all([
  db.select({ url: schema.resource.coverUrl })...,
  db.select({ url: schema.circle.avatarUrl })...,
  db.select({ url: schema.user.image })...,
])
```

**为什么非改不可**：产品文档第 47 行明确「Markdown + **图片** + 东方表情 + @提及 + 引用」。帖子里的图片 URL 存在 `post.bodyMd` 的 Markdown 里，**不在任何一列**。GC 判定「桶里有、白名单里没有、超过 24h 宽限期」→ 删。
脚本头部的熔断（引用集合为空 + 桶非空 → 拒绝执行）**挡不住这个情况** —— 封面和头像还在，引用集合非空，熔断不触发，于是精确地删掉全部帖子插图。

脚本第 22-25 行的注释就是给 M4 留的：

> 所有可能引用图片的列。**加一处引用来源就必须加到这里**，漏掉等于让 GC 删掉正在用的图。

**两种改法，设计 agent 择一**：
1. 在 `referencedUrls()` 里加第四个来源，扫 `post.bodyMd` 并用 `isManagedUrl(url)` 前缀把 URL 抠出来。**风险**：正则扫 Markdown 会漏掉 HTML `<img>` 写法和其他变体，漏一种就删一批。
2. 建一张 `post_image` 关联表，上传时写行、编辑时对账，GC 扫表。**多一张表，但白名单是精确的**。M3 的方法论说「库里没数据时建表零成本」，这条在这里成立。

倾向 2 —— 图片 GC 是「错删不可逆」的路径，正则匹配 UGC 正文不该出现在不可逆路径上。

### P0-2 `apps/api/src/modules/content/index.ts` → `DELETE /posts/:id` —— 不改则申诉闭环断掉

**现状**（content/index.ts:78-87）：

```ts
.delete('/posts/:id', entityIdParam, requireAuth, async (c) => {
  ...
  if (!isOwnerOrStaff(actor, row.authorId)) return fail(c, 'forbidden', 403)
  await softDeletePost(row.id)      // ← 不写 moderationLog
  return c.json({ deleted: true })
})
```

**为什么非改不可**：M3 的每一个 staff 处置动作都留痕 —— `review`（moderation.ts:119）、`report_resolve`（:173）、`role_change`（admin.ts:83）、`soft_delete` / `hard_delete`（:127）、`license_change`（kourindou/index.ts:390）、甚至「已发布资源被编辑」（:265）。**staff 删他人楼层是唯一漏的一处**。
产品文档承诺「举报-处理-申诉闭环」。申诉阶段要回答「谁在什么时候依据什么删了这一楼」，没有留痕就无从答起。M3 只有资源评论、删楼是罕见动作，M4 之后这是版主的日常动作。

**改法**：当 `actor.id !== row.authorId` 时，同事务写一条 `moderationLog`（`subjectKind: 'post'`，`subjectId: row.id`，`action` 见 P1-1）。作者删自己的楼不必留痕。

### P1-1 `MODERATION_ACTION` 枚举加值

**两处同改**（这是 M3 的铁律：pgEnum 与 zod 从同一个数组派生，不能漂移）：

- `packages/shared/src/kourindou/enums.ts:102-116` 的 `MODERATION_ACTION`
- `packages/db/src/schema/kourindou.ts:51` 的 `pgEnum('moderation_action', MODERATION_ACTION)` 会自动跟上，但要生成迁移

**为什么**：现有 10 个 action 里没有能表达「删楼」的。`status_change` 是资源状态机专用（`fromValue:{status}` / `toValue:{status}`），拿它记删楼会让审计日志的 payload 形状分叉。enums.ts:110-111 的注释已经确立了这个原则：「软删与例行下架分开记：审计日志要能回答『站长撤下过什么』，混进 status_change 就得跟每一次普通的上下架一起翻」。

**要加什么**：至少 `post_delete`。若 M4 做锁帖/置顶，再加 `topic_lock` / `topic_pin`。

**迁移写法有现成先例**：`packages/db/drizzle/0002_certain_master_mold.sql` 全文一行

```sql
ALTER TYPE "public"."moderation_action" ADD VALUE 'soft_delete' BEFORE 'hard_delete';
```

注意 PG 的限制：`ALTER TYPE ... ADD VALUE` 之后不能在同一事务里立刻使用新值。迁移与首次写入天然分开，不成问题。

### P1-2 `REPORT_REASON` 枚举加值

**位置**：`packages/shared/src/kourindou/enums.ts:59-66`

```ts
export const REPORT_REASON = [
  'copyright', 'illegal', 'broken_link', 'wrong_info', 'other',
] as const
```

**为什么非改不可**：这五个值全是为**资源**设计的。`broken_link`（网盘失效）和 `wrong_info`（元数据写错）对帖子毫无意义，而论坛最高频的两类 —— **广告灌水**和**人身攻击/骚扰** —— 一个都没有。用户只能选 `other`，举报队列会退化成一堆无分类噪音，而「按 reason 分优先级」正是现在这套治理机制的核心（`moderation.ts:44` 按信任排队列、`dash/reports.tsx:46` 把 copyright/illegal 提前）。

**要加什么**：`spam`、`harassment`（或 `abuse`）。是否再加 `off_topic` 由设计 agent 定 —— 冷启动期版块划分本就模糊，跑题举报大概率是噪音，倾向不加。

**不要为帖子单独拆一份 `POST_REPORT_REASON`**：`report` 是单表单队列，拆枚举会让后台 UI 维护两套标签映射与两套排序规则。保持一份枚举，**在前端按 `targetKind` 过滤可选项**（那是 M4 的新 UI，不是改现有代码）。

### P1-3 `apps/api/src/modules/moderation.ts` → `GET /reports` —— 这是 M4 对 moderation.ts 的唯一必须改动

**现状**（moderation.ts:135-145）：

```ts
.get('/reports', validate('query', paginationQuerySchema), async (c) => {
  const items = await db.select().from(report)
    .where(eq(report.status, 'open'))
    .orderBy(asc(report.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize)
  return c.json({ items, page, pageSize })
})
```

只返回 report 行本身，**没有任何目标上下文**。前端因此只能把 `targetKind` 当徽章、`targetId` 当等宽文本渲染（`dash/reports.tsx:104,109-111`），没有任何跳转。

**为什么非改不可**：资源举报时审核员至少能拿 uuid 去列表里找；帖子举报给出一串 `post / 4f3c…`，审核员**看不到被举报的内容本身**，无法做出任何判断 —— 举报队列直接失效。

**改法**：在 api 端加两个 LEFT JOIN 并投影出上下文（推荐在 api 端做，而非前端二次取 —— hono RPC 的类型会一路推到 loader，前端按 targetKind 分叉发两轮请求既慢又要手写类型）：

- `targetKind='post'`：LEFT JOIN `post` ON `post.id = report.targetId::uuid` → LEFT JOIN `topic` → 取楼层号、主题标题、`boardSlug`/`resourceId`、`bodyMd` 摘要、作者名
- `targetKind='resource'`：LEFT JOIN `resource` → 取 slug、`titleOriginal`

**注意 targetId 是 `text` 而 post.id / resource.id 是 `uuid`**（表设计如此，为了多态）。JOIN 时必须防 22P02：用 `report.target_id::uuid` 会在遇到非 uuid 值时整条查询爆掉。安全写法是在 ON 子句里先按 `targetKind` 过滤，或者把 uuid 侧转成 text 比较（`post.id::text = report.target_id`）—— 后者放弃索引但 report 表规模极小，可接受。
`interactions.ts:12-13` 已经有一个现成的 `uuidLike()` 守卫可以借鉴思路。

**顺带（P2 优先级）**：`/reports` 不返回 `total`，且「urgent 优先」是在前端 `dash/reports.tsx:77-81` 手工 sort 的 —— **只对当前页有效**。帖子举报进来后量会上去，第 2 页开始排序就是错的。应该把排序挪到 api 的 `orderBy`。

### P1-4 `apps/web/app/routes/dash/reports.tsx` —— 消费 P1-3 的新字段

现在的形状（Card 列表 + `useFetcher` 提交 + `resolved`/`rejected` 两个按钮）是对的，M4 沿用。要改的是：

- loader 里 `body.items` 的元素多了目标上下文字段
- 卡片标题从 `{r.targetId}` 的等宽文本换成**指向被举报内容的链接**（帖子 → `/shrine/topics/:id#floor-n`，资源 → `/kourindou/:slug`）
- 帖子举报要能就地看到正文摘要 —— 现在这个页面完全没有正文区
- 「处置」动作：现在这个页面只能 `resolve`/`reject` 一条举报记录，**不能删帖**。见下面的补充说明

**关键认知：`resolve` 只结案，不处置。** `POST /reports/:id/resolve` 只改 `report.status` + 写 `moderationLog`（moderation.ts:164-182），不碰目标。M3 里「处置」是另一条路径（站长在资源详情页 `AdminZone` 里软删，见 `detail.tsx:96-105`）。
M4 的对应处置动作是删楼，最省的做法是复用已有的 `DELETE /api/kourindou/posts/:id` —— `isOwnerOrStaff` 已经放 moderator 过（`RANK[actor.role] >= RANK.moderator`），**不用新开端点**。但那条路径不留痕，所以 P0-2 是这一切的前提。

### P2-1 `apps/api/src/modules/interactions.ts` → 举报的 post 分支

**现状**（interactions.ts:136-146）：

```ts
} else {
  if (!uuidLike(input.targetId)) return fail(c, 'not_found', 404)
  const [row] = await db.select({ authorId: post.authorId }).from(post)
    .where(and(eq(post.id, input.targetId), isNull(post.deletedAt)))
    .limit(1)
  if (!row) return fail(c, 'not_found', 404)
  if (row.authorId === actor.id) return fail(c, 'self_action_forbidden', 403)
}
```

只过滤了 `post.deletedAt`，**不看 post 所属的 topic 是否可见**。而正上方的 resource 分支特意加了 `status='published'` 和 `isNull(deletedAt)`，注释写明了理由：

> 不过滤状态的话，对任意 uuid 举报的成败就成了「该资源是否存在」的预言机 —— 包括别人的私有草稿。

**post 分支留着同一个洞**：可以探测「某个未发布资源的评论区里是否存在某条 post」。实际危害现在很小（要先猜中一个 uuid），但 M4 之后不可见主题会大量增加（软删主题、软删版块下的主题），而且这属于「同一份代码里两个分支的安全水位不一致」，是明确的技术债。

**改法**：post 分支 JOIN `topic`，要求 `topic.deletedAt IS NULL`；`topic.kind='resource'` 时资源必须 `status='published'`。判断一律用**白名单**（`=== 'published'`），不写 `!== 'delisted'`。

### P2-2 `apps/api/src/modules/content/post.ts` → `createPost` 的 catch 吞异常

```ts
// post.ts:99-101
} catch {
  return { ok: false, reason: 'topic_missing' }
}
```

把**所有**异常翻译成「主题不存在」，调用方进而返回 404（content/index.ts:69-73）。数据库连接断了、约束冲突了、事务死锁了 —— 用户看到的都是「主题不存在」，日志里什么都没有（`app.onError` 收不到，因为异常被吞了）。

M3 里发帖是低频路径，无所谓。**M4 里发帖是主写路径**，一个吞掉所有异常的 catch 会让线上问题无法定位。

**改法**：只在能确定的业务失败上返回 `ok:false`，其余重抛给 `app.onError`（它会 `console.error` 并返回 `internal` 500）。

### P2-3 举报端点的挂载位置 —— **现在改成本接近零，M4 之后就贵了**

**现状**：`interactions` 被挂在 `.route('/kourindou', interactions)`（app.ts:22），所以举报端点的完整路径是 **`POST /api/kourindou/reports`**。帖子举报走一个 `/kourindou` 前缀的 URL 名不副实。

**为什么现在改几乎免费**：全仓搜索确认，**web 端零个调用方**（`apps/web` 里唯一的 `reports` 引用是 `dash/reports.tsx`，那是 `/api/moderation/reports`，另一条路径）。唯一的调用方是 `apps/api/scripts/e2e.ts`（约第 206 行）。
M3 的方法论说「真正不可逆的只有已对外发出的 URL/slug」—— 这条 API 路径**没有对外发出过**（连自己的前端都没用）。

**改法**：把 `POST /reports` 从 `interactions.ts` 拆出来单独成模块，在 `app.ts` 上 `.route('/reports', reports)`。M4 之后再改就要同时动两个模块的前端调用。

---

## 5. 两个专题回答

### 5.1 信任等级「两模块共享」到底怎么共享

`userProfile` 三列：`role` / `approvedResourceCount` / `strikeCount`。

- `role` —— 天然全站共享，直接用，**不改**
- `strikeCount` —— 天然全站共享。session.ts:60 的注释：「`strikeCount > 0` 直接清零信任，这是唯一的惩罚机制」。论坛应当消费这一列
- `approvedResourceCount` —— **是资源语义的**。列名就写着 resource

**语义冲突**：`canAutoPublish(actor, threshold)` 的判据是 `strikeCount === 0 && approvedResourceCount >= threshold`。论坛硬套它，结果是**纯论坛用户永远为 false** —— 从没传过资源的人在论坛里永远是「不可信」。冷启动期几乎所有人都是这样，等于对全体限速。

**倾向（请设计 agent 拍板）**：论坛侧**只消费 `strikeCount`**（违规即降权），不消费 `approvedResourceCount`。若确实需要论坛自己的信任进度条，那是给 `userProfile` **加一列**（如 `approvedPostCount`），而不是把资源计数当论坛信任用。加列是 additive，DDL 成本可忽略。

另外：论坛的反滥用手段应该是**限速**（新账号 N 分钟一贴，`rate_limited` 错误码已在列）而不是**排队审核**。产品文档第 22 行的「低人肉运营」在论坛上比在资源站更硬 —— 人肉审每一条新帖比处理举报贵一个数量级。

### 5.2 举报的 `targetKind` 现在支持哪些值？帖子举报要加什么？

**DB 层**：`report.targetKind` 是 `varchar(16) NOT NULL`，**没有 pgEnum、没有 FK、没有 CHECK**（kourindou.ts:364）。任何 ≤16 字符的字符串都写得进去。同理 `targetId` 是 `text`（多态，不是 uuid 列），索引 `report_target_idx (target_kind, target_id)` 已建。

**唯一的闸门在 zod**（`packages/shared/src/kourindou/schemas.ts:157-162）：

```ts
export const createReportSchema = z.object({
  targetKind: z.enum(['resource', 'post']),   // ← 就地字面量
  targetId: anyIdSchema,
  reason: z.enum(REPORT_REASON),
  detail: z.string().max(2000).default(''),
})
```

**所以：`'post'` 已经在支持列表里，而且 API 层已经完整实现。**

`interactions.ts:136-146` 的 post 分支做了存在性校验（查 post 表 + `isNull(deletedAt)`）和自举报拦截（`self_action_forbidden` 403）。这是 M3 的对抗审查补上的（代码注释：「post 分支此前完全没有校验」）。

#### 帖子举报要加什么 —— 逐项

| 项 | 结论 |
|---|---|
| `targetKind` 加新值 | **一个都不用加**。前提是主题正文落成 floor 1 的 `post`（`topic` 表没有正文列，这是唯一不加列的做法），那么「举报主题」= 举报 floor 1，`'post'` 全覆盖 |
| `REPORT_REASON` 加值 | **必须加** `spam` / `harassment`。见 P1-2 |
| api 端点 | **不用加**。`POST /api/kourindou/reports` 已经收 post（建议挪路径，P2-3） |
| post 分支的可见性过滤 | **要补**。见 P2-1 |
| 前端举报入口 | **全新工作**。web 里现在零个举报 UI（连资源举报都没做） |
| `targetKind` 升 pgEnum | **不建议**。多态列升 pgEnum 后每加一种可举报对象都要 DDL，而 zod 那道闸门已经是唯一写入口 |
| `REPORT_TARGET_KIND` 常量 | **建议加**。把 `z.enum(['resource','post'])` 的就地字面量提成 shared 里的常量数组，与 `REPORT_REASON` 等其他枚举一致。散落的字面量是漂移源 |

### 5.3 moderation 队列现在只处理资源，接进帖子要动多少？

**先把两个「队列」分开**，它们是两件事：

#### (a) `GET /moderation/queue` —— 资源待审队列：**动 0 行，M4 不该碰它**

```ts
// moderation.ts:21-54
.where(and(eq(resource.status, 'pending'), isNull(resource.deletedAt)))
.orderBy(asc(userProfile.approvedResourceCount), asc(resource.createdAt))
```

硬编码 `resource` 表 + `status='pending'`，join 了 `user` 和 `userProfile` 展示投稿者信任度。

**论坛不需要它**，因为 `post` 表**根本没有 status 列**（只有 `deletedAt`）。产品选的是先发后审，论坛的「审」入口是**举报队列**而不是待审队列。

要给论坛做 pending 队列意味着：post 加 status 列 + 新状态机 + 新队列端点 + 新后台页 + 新审核动作。**强烈建议不做** —— 与产品文档第 22 行「低人肉运营」直接冲突，且上线时发帖量近 0，人肉审每条新帖是最贵的运营方式。

同理 `POST /moderation/resources/:id/review`（moderation.ts:63-133）是资源专用，**M4 不碰**。它里面还耦合着信任梯度的两个写入点（approve → `approvedResourceCount+1`；reject 且 reason ∈ `STRIKE_REJECT_REASONS` → `strikeCount+1`），是资源站的核心逻辑，别去改它的形状。

#### (b) `GET /moderation/reports` + `POST /reports/:id/resolve` —— 举报队列：**API 层动 1 处，UI 动 1 个文件**

- 队列查询**已经是多态的**（`select * from report where status='open'`），帖子举报**自动进队，0 行改动**
- `resolve` 端点**完全不用改** —— 它只改 report 行 + 写 `moderationLog`，与目标类型无关
- **唯一必须改的是 `/reports` 的投影**：加目标上下文的 LEFT JOIN（P1-3）
- 前端 `dash/reports.tsx` 必须改（P1-4）
- 处置动作复用 `DELETE /api/kourindou/posts/:id`（moderator 已放行），**不用新开端点**，但必须先做 P0-2 的留痕

**结论量化**：接进帖子举报，`moderation.ts` **改 1 个 handler 的 select 投影**（约 30 行），`dash/reports.tsx` 改 loader 与卡片渲染，`content/index.ts` 加一段留痕。其余零改动。

---

## 6. M4 无法复用、必须新建的（列出来是为了不去现有代码里瞎找）

| 要做的 | 现状 | 说明 |
|---|---|---|
| `board` 版块表 | **零基础**。`topic.boardSlug` 是裸 varchar(32) | 六个固定版块 + 多语名 + 排序。形状建议见下 |
| 通知中心 | **零基础**。没有任何 notification 表或端点 | 回复 / @ / 订阅 / 审核结果四种源 |
| @提及解析 | **零基础** | 解析 → 存关联 → 触发通知 |
| 引用 / 东方表情 | **零基础** | 引用可复用 `post.parentId`（自引用外键已就位） |
| Markdown 渲染 + XSS 消毒 | **零基础**。现在 `detail.tsx:326` 把 `bodyMd` 当纯文本渲染（`whitespace-pre-wrap`） | 这会**同时改到资源评论区** —— 一套内容系统两个视图，渲染器必须共用 |
| 帖子编辑 | `post.ts` 没有 update 函数 | 加在同一文件，两个调用方共用 |
| 主题订阅 | **零基础** | 通知的一个源 |
| 论坛发帖限速 | **零基础**。`rate_limited` 错误码已在列，但没有限流实现 | |

**`board` 表的形状建议**：照 `tag` 而不是 `resourceCategory`。

- `tag`（kourindou.ts:92-104）有 `nameOriginal varchar(120) NOT NULL` + `name jsonb`，能直接喂给 `resolveLocalized(original, locale, translations, requested)`，**缺失语言时回落到原文，永不返回空串**
- `resourceCategory`（kourindou.ts:81-86）只有 `name jsonb default {}`，缺失语言就是空

版块名是站长自己写的六条，三语大概率都会填全，两种形状都能跑。但 `tag` 的形状让 `resolveLocalized` 这个已经过测试的回落函数直接可用（`packages/shared/src/kourindou/localized.test.ts` 覆盖了三种回落情形），而 `resourceCategory` 的形状要在 web 侧另写一个可能返回空串的取值函数。

---

## 7. 明确不该改的（防止 M4 顺手动坏 M3）

| 文件 / 位置 | 为什么别动 |
|---|---|
| `apps/api/src/modules/kourindou/status.ts` | 资源状态机，与论坛无关。**别给 topic/post 引入同款状态机** —— post 没有 status 列，也不该有 |
| `moderation.ts` 的 `/queue` 与 `/resources/:id/review` | 资源专用，含信任梯度的两个写入点 |
| `admin.ts` 的 `/resources/:id` 删除、`/restore`、`/resources/deleted` | 资源专用。M4 不给帖子做硬删与回收站（软删已够；法律要求的彻底删除走手工 SQL） |
| `admin.ts:76` 的 `if (target.role === 'admin') return forbidden` | HTTP 上既不能造 admin 也不能废 admin，只走 `scripts/grant-role.ts` |
| `middleware/require.ts` 的 `RANK` | 别引入按版块的版主角色 |
| `Actor` 的形状 | 一变就波及 `/api/me`、`site-header.tsx` 的 `SessionUser`、`dash/layout.tsx` 的守卫 |
| `content.test.ts` 的楼层号并发测试 | 8 并发不撞号、软删不打断楼层号 —— M4 改 `post.ts` 时这两条必须还是绿的 |
| `errors.ts` 的 `ERROR_CODES` | 加码前先证明现有 12 个表达不了 |
| `packages/db/drizzle/` 里已有的 3 个迁移 | 库里已有 demo 种子数据，走增量迁移（0002 就是 `ALTER TYPE ADD VALUE` 的先例），别 `rm -rf drizzle` |

关于最后一条：M3 计划里那句「`rm -rf drizzle && generate && migrate` 是零成本的」是在**空库**前提下说的。现在开发库里有 seed 与 demo 数据（`packages/db/scripts/seed-demo-*.ts`，且用户记忆明确记着「开发库 @example.com 同时是测试账号和种子内容所有者」）。方法论的**结论**（不为将来预留结构）依然成立，但**手段**要换成增量迁移。

---

## 8. M3 踩过的坑 —— 对 M4 逐条复核

| 坑 | 在 M4 的对应风险点 |
|---|---|
| `.partial()` 不移除 `.default()` | M4 的「编辑帖子」「编辑主题标题」schema 必须**逐字段重建**，照 `updateResourceSchema`（schemas.ts:86-98）的写法，别写 `createPostSchema.partial()` |
| id 三分不可混用 | `topic.id`/`post.id` 用 `entityIdSchema`；发帖人/@提及的用户用 `userIdSchema`；`board.slug` 用 `slugIdSchema`；举报 `targetId` 用 `anyIdSchema` |
| 用 `validate()` 而非裸 `zValidator` | 全部新路由 |
| `:id` 路由挂 `entityIdParam` | `entityIdParam` 写死参数名 `id`，M4 的实体参数一律命名 `id` |
| 状态判断用白名单 | 版块/主题的可见性判断一律 `=== 'published'` 式白名单；P2-1 的 topic 可见性过滤同理 |
| Hono 单值 query 是 string | 「按多个标签筛主题」要 preprocess 升维，照 `listResourcesQuerySchema.tag` |
| api 不返回人类可读消息 | 论坛的每一条错误都要有 `error.code` → Paraglide 文案 |
| 楼层号靠 topic 行原子自增 | **别重写**，直接调 `createPost()` |

---

## 附：M4 会碰到的现有文件清单（绝对路径）

**必改**
- `/Users/i/Code/th/apps/api/scripts/gc-images.ts`（P0-1）
- `/Users/i/Code/th/apps/api/src/modules/content/index.ts`（P0-2）
- `/Users/i/Code/th/packages/shared/src/kourindou/enums.ts`（P1-1 `MODERATION_ACTION`、P1-2 `REPORT_REASON`）
- `/Users/i/Code/th/apps/api/src/modules/moderation.ts`（P1-3，仅 `GET /reports` 的投影）
- `/Users/i/Code/th/apps/web/app/routes/dash/reports.tsx`（P1-4）

**建议改**
- `/Users/i/Code/th/apps/api/src/modules/interactions.ts`（P2-1 可见性、P2-3 拆出举报端点）
- `/Users/i/Code/th/apps/api/src/modules/content/post.ts`（P2-2 catch，另加 `updatePost`）

**纯 additive（加东西，不动既有行）**
- `/Users/i/Code/th/apps/api/src/app.ts`（`.route('/shrine', shrine)`）
- `/Users/i/Code/th/apps/web/app/routes.ts`（shrine 路由替换 stub）
- `/Users/i/Code/th/apps/web/app/routes/dash/layout.tsx`（tabs 数组）
- `/Users/i/Code/th/packages/db/src/schema/content.ts`（`board` 表、CHECK、FK）
- `/Users/i/Code/th/packages/shared/src/kourindou/schemas.ts`（论坛 schema）
- `/Users/i/Code/th/apps/web/app/lib/display.ts`（版块名 helper）
- `/Users/i/Code/th/apps/api/scripts/e2e.ts`（论坛验收项）

**只读参照，不改**
- `/Users/i/Code/th/apps/api/src/middleware/{require,session}.ts`
- `/Users/i/Code/th/apps/api/src/errors.ts`
- `/Users/i/Code/th/apps/api/src/site-config.ts`
- `/Users/i/Code/th/apps/api/src/modules/admin.ts`
- `/Users/i/Code/th/apps/api/src/modules/kourindou/status.ts`
- `/Users/i/Code/th/apps/web/app/lib/api.ts`

**会被 Markdown 渲染器牵连的**
- `/Users/i/Code/th/apps/web/app/routes/kourindou/detail.tsx:307-331`（资源评论区，必须与论坛共用同一个渲染器与消毒策略）
