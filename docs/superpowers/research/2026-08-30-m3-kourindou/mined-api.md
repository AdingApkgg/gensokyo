## 一、端点清单（legacy 全部 API 面）

legacy 的 API 只有 **8 个写端点，0 个读端点**。所有列表/详情读取都在 RSC 里直接打 drizzle，没有经过 HTTP 层。这是移植时最大的结构性事实。

| 方法 | 路径 | 认证 | 文件 |
|---|---|---|---|
| POST | `/api/resources` | 必须登录 | `src/app/api/resources/route.ts` |
| PATCH | `/api/resources/[id]` | 登录 + 本人或 staff | `src/app/api/resources/[id]/route.ts` |
| DELETE | `/api/resources/[id]` | 登录 + 本人或 staff | 同上 |
| POST | `/api/comments` | 必须登录 | `src/app/api/comments/route.ts` |
| POST | `/api/ratings` | 必须登录 | `src/app/api/ratings/route.ts` |
| POST | `/api/favorites` | 必须登录 | `src/app/api/favorites/route.ts` |
| POST | `/api/reports` | **无需登录** | `src/app/api/reports/route.ts` |
| GET | `/api/download` | **无需登录** | `src/app/api/download/route.ts` |
| POST | `/api/upload/presign` · `/api/upload/multipart?action=` | 必须登录 | `src/app/api/upload/*` |

### 1. POST /api/resources — 创建资源

- **入参**：`title(1..200)` / `category(9 值枚举)` / `circle?(<=120)` / `author?(<=120)` / `description?(<=20000)` / `coverKey?` / `files[]{name,size,contentType,key}` / `externalLinks[]{label,url}`
- **校验**：文件内 zod v4 schema + `safeParse`，失败一律 `{error:"bad input"}` 400，**不返回字段级错误**
- **权限**：仅 `session?.user?.id` 存在
- **副作用**：`uniqueSlug()` 循环查库（最多 50 次 SELECT，超限退化为时间戳后缀）；事务内插 `resources` + 批量插 `resource_files`
- **返回**：`{ok:true, id, slug}`

关键片段（`resources/route.ts:48-63`）：

```ts
const inserted = await db.transaction(async (tx) => {
  const [row] = await tx.insert(resources).values({
    slug, title: v.title, category: v.category,
    descriptionMd: v.description ?? "",
    coverKey: v.coverKey ?? null,
    circle: v.circle, author: v.author,
    uploaderId: session.user!.id,
    status: "public",          // ← 写死，先发后审在这里被跳过了
    externalLinks: v.externalLinks,
  }).returning();
```

**严重问题（新栈必须修）**：`files[].key` 完全由客户端提供，服务端不校验这个 key 是不是自己签发给该用户的、对象是否真实存在、真实大小/类型是否与声明一致。presign 时 key 命名为 `file/<userId>/<uuid>.<ext>`（`upload/presign/route.ts:21`），但 POST 从不比对前缀 → 任何登录用户都能把**别人的 B2 对象**挂到自己的资源上，`size`/`contentType` 也可任意伪造。

### 2. PATCH /api/resources/[id] — 编辑 + 唯一的审核动作

- **入参**：`title? category? circle? author? description? status?`，status 枚举 `public|hidden|takedown|pending`
- **权限**：`canEdit()` 先查资源，`uploaderId === userId || role ∈ {admin, moderator}`；找不到资源和无权限**都返回 403**（信息泄露少，但语义混淆 404/403）
- **提权屏障**（`[id]/route.ts:36`）：

```ts
if (v.status && !check.staff) delete v.status;   // 非 staff 的 status 字段被静默丢弃（不报错）
```

- **副作用**：条件展开式 `set()`，手动 `updatedAt: new Date()`；返回 `{ok:true}`（**不回传更新后的行**）

### 3. DELETE /api/resources/[id]

- 同一个 `canEdit` 门；`db.delete(resources)` 硬删。
- **副作用远超预期**：schema 上 `resource_files / comments / ratings / favorites / reports / download_logs` 全部 `onDelete: "cascade"` → 一次 DELETE 抹掉全部评论、评分、下载日志、举报证据。**B2 对象不清理**，永久成为孤儿。且上传者本人即可硬删，绕开 takedown 留痕。M3 绝不能保留此语义。

### 4. POST /api/comments

```ts
const body = z.object({
  resourceId: z.string().min(8),
  body: z.string().min(1).max(4000),
  parentId: z.number().int().optional(),
});
```

- **权限**：仅登录。**不检查资源是否存在、是否 `takedown`/`hidden`** → 已下架资源仍可评论；resourceId 不存在时靠 FK 抛出 → 500。
- `parentId` 在 schema 里是 `integer("parent_id")` **没有外键**（`schema.ts:162`），也不校验父评论是否属于同一资源 → 可跨资源挂楼。
- 无限流、无 Turnstile、无编辑/删除端点。

### 5. POST /api/ratings — 反范式计数

- 校验 `z.string().uuid().or(z.string().min(8))`（写得很随意）+ `score` 1..5
- 事务内：先 SELECT 是否已评 → 有则 UPDATE + `ratingSum += delta`；无则 INSERT + `ratingSum += score, ratingCount += 1`

```ts
await tx.update(resources)
  .set({ ratingSum: sql`${resources.ratingSum} + ${delta}` })
  .where(eq(resources.id, resourceId));
```

- **竞态**：read-then-write 无 `FOR UPDATE`、无 `ON CONFLICT`，默认 READ COMMITTED 下并发双击可插两次（PK 会挡住报 500）或重复累加。新栈应改为 `INSERT ... ON CONFLICT (resource_id,user_id) DO UPDATE ... RETURNING`，或干脆去掉反范式列改视图/触发器。
- 无「取消评分」路径。

### 6. POST /api/favorites — toggle

- 读→有则 DELETE 返回 `{favorited:false}`，无则 INSERT 返回 `{favorited:true}`。
- 非事务、非幂等，双击并发会撞主键 500。应为 `ON CONFLICT DO NOTHING` + 显式 `PUT/DELETE` 两个端点（RPC 类型也更干净）。

### 7. POST /api/reports — 匿名可发

```ts
const session = await getSession();
// ↑ 取了 session 但不作为门槛
await db.insert(reports).values({
  resourceId, reporterId: session?.user?.id ?? null, reason,
});
```

- **完全无鉴权、无限流、无 Turnstile、无去重、不校验 resourceId 存在** → 现成的刷库/骚扰入口。
- `reports.resolved` 布尔字段存在，但**全代码库没有任何地方写它**——举报没有处理闭环。

### 8. GET /api/download — 签名下载 + 统计

- **入参**：query `?resource=<id>&file=<number>`，**手工 `Number()` 解析，无 zod**（唯一没上 zod 的端点）
- 校验 file 属于该 resource；`if (!r || r.status === "takedown")` 才拒绝 → **`hidden` 和 `pending` 状态的资源照样能下载**。M3 有真实待审队列后这是直接漏洞。
- 副作用：`presignGet(key, 600)` **先签名后写库**，事务失败也已交出 URL；插 `download_logs`（记 IP，取 `x-forwarded-for` 首段）+ `downloads += 1`。
- 无节流/去重 → 刷新即刷量。

### 9. 上传：presign / multipart

- presign：key = `${kind}/${session.user.id}/${crypto.randomUUID()}.${safeExt}`，扩展名清洗后截 8 字符；**无大小上限、无 contentType 白名单、无配额**。
- multipart：单个 POST 用 `?action=start|part|complete|abort` 分派。`part/complete/abort` 只验登录，**不验 `key` 前缀属于调用者** → 知道 key+uploadId 即可终止/完成他人上传。
- 客户端阈值 20MB 走分片、8MB 分块（`upload-form.tsx:14-15`）。

### 10. `get-session.ts` 全文

```ts
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
export type SessionPayload = Awaited<ReturnType<typeof getSession>>;
```

零缓存、零 memo，**每个端点各调一次**（详情页里 RSC 和内部逻辑重复调用）。`role` 来自 better-auth `user.additionalFields`（`auth.ts:38-43`，`input: false` 防止注册时自设角色）。

---

## 二、先发后审：**legacy 里根本不存在**

必须明确告知：产品文档里的「先发后审 + 信任梯度」在 legacy **没有任何实现**，M3 是从零建。现有的只是残骸：

1. `resourceStatusEnum = ["public","pending","hidden","takedown"]`（`schema.ts:19-24`）——`pending` 值存在。
2. 列默认 `status: "public"`（`schema.ts:101`），POST 又**硬编码** `status: "public"`（`route.ts:60`）。**全代码库没有一处写入 `"pending"`**。
3. 唯一的「管理员操作」是 `ModerateActions` 组件（`moderate-actions.tsx`）调 `PATCH /api/resources/:id` 传 `{status}`，三个按钮：上架 `public` / 下架 `hidden` / 移除 `takedown`——**连 pending 都不在 UI 里**。
4. `/dash/resources` 只是 `findMany({orderBy: desc(createdAt), limit: 100})` 全量列表，**没有 status 过滤，不是审核队列**。`/dash/reports` 是纯只读列表，`resolved` 无按钮无端点。
5. 没有 `audit_log` / `review` 表，没有审核人、审核时间、驳回理由；没有信任等级字段（`roleEnum` 里的 `"uploader"` 从未被赋值或读取）；没有 Turnstile；没有通知。

**M3 需要新建的**：`status` 默认改 `pending`；用户维度 `trustLevel` / `approvedResourceCount`（决定首发是否自动过审）；`resource_review` 审核记录表（reviewer / action / reason / at）；审核队列端点（`GET /admin/resources?status=pending` 带游标）；`POST /admin/resources/:id/review {action, reason}`；举报处理端点（resolve/dismiss + 处理人）；下架/认领通道（新表 `takedown_request` / `circle_claim`）。

---

## 三、权限模型

**判定方式：字符串比较，散落 6 处，无任何抽象。**

- 管理员/版主：`role === "admin" || role === "moderator"`（合称 staff）
  - API：`[id]/route.ts:19` `const staff = role === "admin" || role === "moderator";`
  - 页面守卫：`dash/layout.tsx:9` `if (!session?.user || (role !== "admin" && role !== "moderator")) redirect("/")`
  - 另在 `site-header.tsx:11`、`resources/[slug]/page.tsx:40`、`edit/page.tsx:22` 各写一遍
- 作者本人：`r.uploaderId !== userId`（`[id]/route.ts:20`），必须先查库拿到资源才能判断
- **没有 middleware.ts**（已确认根目录不存在），无集中式路由守卫；每个端点自己 `getSession()` 自己 if
- 角色数据来源：`users.role` pgEnum，经 better-auth `additionalFields` 透传进 session
- staff 与 owner **权限完全等价**（除了 `status` 字段）：moderator 能改标题、能硬删，没有分级

**新栈应做**：`packages/shared` 出 `Role` / `Permission` 常量与 `can(user, action, resource)` 纯函数；hono 侧 `requireAuth()` / `requireRole('moderator')` / `requireOwnerOrStaff()` 三个中间件，`c.set('user', ...)` 注入并让类型贯穿到 hc；owner 与 staff 拆开（staff 只能改 status/license/tag，不能改标题；硬删只留 admin）。

---

## 四、列表查询：分页/筛选/排序

**不在 API 里**，全部在 RSC `src/app/(site)/resources/page.tsx`：

```ts
const where = and(
  eq(resources.status, "public"),
  q ? ilike(resources.title, `%${q}%`) : undefined,
  cat ? eq(resources.category, cat as "music") : undefined      // ← as "music" 强转绕过类型，未做枚举白名单校验
);

const orderBy =
  sort === "popular" ? [desc(resources.downloads)]
  : sort === "rating" ? [desc(sql`case when ${resources.ratingCount} = 0 then 0
        else ${resources.ratingSum}::float / ${resources.ratingCount} end`)]
  : [desc(resources.createdAt)];

list = await db.query.resources.findMany({ where, orderBy, limit: 24, offset: (page-1)*24 });
```

特征与缺陷：

- **offset 分页，perPage=24 硬编码，不查 total，不返回 hasNext** → 前端 `resource-filters.tsx` 没有翻页 UI
- `searchParams` **完全不校验**：`page` 走 `Math.max(1, Number(...))`（`NaN` 时 `Math.max(1,NaN)=NaN` → offset 变 `NaN`，drizzle 抛错被 catch 吞成空列表）；`category` 直接 `as "music"` 强转塞进 SQL 枚举比较，非法值 → Postgres 报错 → 空列表
- **`try { ... } catch { list = [] }` 吞掉所有 DB 错误**，页面永远显示「没找到匹配的资源」，故障不可观测。`/dash` 三个页面同样吞异常
- 搜索用 `ilike '%q%'`，**无索引可用、无中文分词、无拼音**；`meilisearch` 在 `package.json` 里但 `src/` 里零引用（已 grep 确认）
- 平均分排序每次全表算 `case when`，无索引
- 已有索引仅 `resources_status_created_idx(status, createdAt)` 和 `resources_category_idx`
- 页面级 `export const revalidate = 30`（ISR 缓存 30s）——React Router v8 loader 没有等价物，需自己做缓存

**新栈应做**：查询参数 schema 进 `packages/shared`（`resourceListQuerySchema`），hono `zValidator('query', ...)` + `coerce`；游标分页（`createdAt + id` 复合游标）替代 offset；多维筛选（type × 原作 × 展会 × license × circle）交给 Meilisearch，DB 只做兜底与精确过滤；错误不吞，走统一 error envelope。

---

## 五、可直接移植 vs 必须重设计

### 近乎直接移植（逻辑正确，换个外壳即可）

| 逻辑 | 位置 | 移植说明 |
|---|---|---|
| better-auth session 读取 | `get-session.ts` | 换成 hono 中间件 `auth.api.getSession({headers: c.req.raw.headers})`，`c.set('session')` 一次，全链路复用 |
| owner-or-staff 判定表达式 | `[id]/route.ts:16-22` | 抽成 `packages/shared` 的纯函数，逻辑本身照抄 |
| B2/S3 presign 封装 | `lib/s3.ts` | **整文件几乎可直接搬**到 `packages/storage`；`forcePathStyle: true` + B2 endpoint 配置是踩过坑的，保留 |
| 分片上传编排（start/part/complete/abort） | `upload/multipart/route.ts` + `upload-form.tsx` | 流程正确；拆成 4 个 hono 路由 + 补 key 归属校验 |
| key 命名空间 `kind/userId/uuid.ext` + 扩展名清洗 | `presign/route.ts:19-21` | 直接沿用，扩展为 `resource/<rid>/<vid>/<uuid>.<ext>` |
| 评分 delta 累加的数学 | `ratings/route.ts` | 公式对，但要换成 `ON CONFLICT DO UPDATE` 写法 |
| 下载=签名 URL + 落日志 + 计数 | `download/route.ts` | 流程骨架可用；顺序要改成先写库后签名，并补 status 门槛 |
| `slugify` 保留 Unicode 字母 | `lib/utils.ts:15` | `[^\p{L}\p{N}-]` 保住中日文 slug，这是对的，直接搬 |
| `formatBytes` | `lib/utils.ts:8` | 搬到 `packages/shared` |

### 必须重新设计

1. **校验体系**：legacy 已是 zod v4（`^4.3.6`），但**每个路由文件各写各的**，`category` 枚举在 `resources/route.ts`、`[id]/route.ts`、`edit-form.tsx:68` 三处重复硬编码，前后端各一份。`safeParse(await req.json().catch(() => ({})))` 这段样板重复 8 次，错误统一降级为 `{error:"bad input"}`，丢掉全部字段信息。
   → 新栈：schema 全进 `packages/shared/src/schemas/kourindou.ts`，`@hono/zod-validator` 挂中间件，枚举用 `z.enum` 单一来源同时喂 drizzle `pgEnum`、前端表单、未来 OpenAPI；错误返回 `z.treeifyError()` 结构。
2. **对象模型**：legacy 是**扁平单层** `resource → files`。`resource_files.version` 是个从未被写入的 varchar 残迹（POST 不设它），**没有 version 表**。circle/author 是 `varchar(120)` 自由文本、无表无 FK、无归一化 → 必须新建 `circle` 表 + `resource_circle` 关联。`license` 字段**完全不存在**（生死线字段从零建）。tag 表存在但 API/UI 零使用，且是一维的（`tags.slug/name`），要改成带 `kind` 的多维（type × 原作 × 展会）。`externalLinks` 是 resource 上的 jsonb，新模型要下沉到 file 层做「B2 对象 + 外链镜像」混合。
3. **多语字段**：`title varchar(200)`、`circle`、`author` 全是单值单语。新栈从第一张表就要落多语（推荐 `jsonb` 形如 `{zh, ja, en}` 或 `title` + `title_translations`，配 Meilisearch 多语字段）。
4. **评论 = 论坛帖（M4 关键整合）**：legacy `comments` 表**死绑 `resourceId` 非空外键**（`schema.ts:154-158`），`parentId` 无外键、单表楼中楼、无软删、无编辑时间、无 Markdown 渲染（前端 `whitespace-pre-wrap` 裸输出）、无 @提及、无审核状态。这张表**不可移植**。M3 必须直接按 M4 目标建：`topic` 表（`subjectType: 'resource'|'board'` + `subjectId`）+ `post` 表（楼层，`topicId` + `replyToPostId` + `authorId` + `contentMd` + `status` + `editedAt` + 软删）；资源创建时事务内自动建 topic 并回写 `resource.topicId`。M3 的评论 API 应当就是 post API 的资源视图。
5. **读端点全部新写**：legacy 一个 GET 都没有（除 download）。列表、详情、评论分页、我的上传/收藏、社团页、审核队列——全部要在 hono 里从零建，并按模块 `.route()` 链式挂载以保住 hc 类型推导。
6. **状态机与审核**：见第二节，全新。
7. **响应结构统一**：现在是 `{ok:true,id,slug}` / `{ok:true}` / `{favorited:boolean}` / `{url}` / `{error:"..."}` 五种形状混用，且 PATCH 不回传实体。hc RPC 下应统一 `{data}` / `{error:{code,message,fields?}}`，PATCH/POST 一律 `returning()` 回传实体。
8. **反机器人与限流**：全站零限流、零 Turnstile。reports（匿名）、comments、ratings、download 四处都需要。
9. **搜索**：`ilike '%q%'` → Meilisearch；需要在 resource/version 写入与状态变更时同步索引（legacy 无同步逻辑可参考）。
10. **文件安全**：客户端 key 信任问题（见第一节 1）、缺 HeadObject 校验、缺大小/类型白名单、缺删除时的 B2 清理、缺孤儿对象 GC——这几条在新栈要作为上传流程的硬性设计点。

---

## 六、给 M3 的落地要点（浓缩）

- 建 `packages/shared/src/schemas/kourindou/{resource,version,file,circle,tag,license,interaction,review}.ts`，drizzle 枚举与 zod 枚举共用一份 `as const` 数组。
- hono 结构：`apps/api/src/routes/kourindou/{resources,versions,files,comments,interactions,reports,admin}.ts`，在 `app.basePath('/api').route('/kourindou/resources', resources).route(...)` 链式挂。
- 中间件三件套：`sessionMiddleware`（取代逐端点 `getSession`）、`requireAuth`、`requireStaff`；`c.var.user` 带 `role` 与 `trustLevel`。
- 状态默认 `pending`，创建时按 `trustLevel` 决定是否立刻 `published`；所有状态变更写 `resource_review` 审计。
- 下载门槛改为 `status === 'published'`（或 staff 预览），先写日志后签名。
- 所有 upsert 类互动（rating/favorite/thanks）一律 `ON CONFLICT`，去掉 read-then-write。
- 硬删除下线，只保留 `takedown` 软状态；真删走管理员专用 + B2 清理任务。

**已读文件（绝对路径）**：`/Users/i/Code/th/legacy/thdl/src/app/api/{resources/route.ts,resources/[id]/route.ts,comments/route.ts,ratings/route.ts,favorites/route.ts,reports/route.ts,download/route.ts,upload/presign/route.ts,upload/multipart/route.ts}`、`/Users/i/Code/th/legacy/thdl/src/lib/{get-session.ts,auth.ts,db/schema.ts,db/index.ts,s3.ts,utils.ts}`、`/Users/i/Code/th/legacy/thdl/src/app/(site)/resources/page.tsx`、`/Users/i/Code/th/legacy/thdl/src/app/(site)/resources/[slug]/{page.tsx,edit/page.tsx}`、`/Users/i/Code/th/legacy/thdl/src/app/(site)/me/page.tsx`、`/Users/i/Code/th/legacy/thdl/src/app/dash/{layout.tsx,page.tsx,resources/page.tsx,reports/page.tsx}`、`/Users/i/Code/th/legacy/thdl/src/components/{moderate-actions.tsx,comment-section.tsx,edit-form.tsx,upload-form.tsx}`