# 挖掘 legacy thdl 评论系统 —— 逐字段 / 逐端点 / 缺陷目录

2026-08-30 · M4 博丽神社调研材料 · 只读挖掘，不含实施方案

**范围**：`legacy/thdl` 的评论系统全部代码，以及与之相邻的授权、举报、审核路径。
**产出**：它到底是什么形状（事实）→ 它踩过哪些坑（缺陷目录）→ M3 修掉了几条（对账）→
还剩哪些坑等着 M4（含**当前仓库里的新发现**）→ 什么值得移植、什么是历史包袱。

---

## 0. 先说结论

**legacy 的评论系统总共 110 行代码：一张表、一个 POST 端点、一个渲染组件、一段内联查询。
M3 已经把其中值得要的东西全部吸收完了。** 这次挖掘的真正价值不是"找可移植的设计"——
没什么可移植的——而是**缺陷目录**：它用极小的代码量踩齐了评论系统的几乎每一类经典坑，
每一类都精确对应 M4 必须做的一个决定。

一句话概括各部分结论：

| 维度 | legacy 状态 | M3 状态 | M4 待办 |
|---|---|---|---|
| 数据模型 | `comments` 挂死在 resource 上 | `topic + post` 已就位 | 只差 `kind='board'` 的写入口 |
| 楼层号 | **不存在**，按 `createdAt DESC` 排 | `floor` + 原子自增 + 唯一索引 | 排序方向与"跳楼"分页 |
| 引用完整性 | `parentId` 裸 integer 无外键 | 自引用外键 + 同主题校验 | 定义 `parentId` 的**语义** |
| 越权 | **完全没有资源状态校验** | 白名单 `=== 'published'` | 版块级可见性 / 封禁态 |
| 删除 | **没有任何删除端点** | 软删 + owner/staff | 版主删帖留痕、锁帖 |
| 举报 | 只能举报资源，**评论无法举报** | `report` 已多态 | 几乎免费 |
| 通知 / @提及 | **零** | 零 | 100% 新建 |
| 限流 / 反滥用 | **零** | 零（`rate_limited` 码空悬） | 必须做 |
| Markdown 渲染 | **从未真正渲染过 Markdown** | 未渲染 | XSS 面全新，无先例可抄 |

**最重要的三个发现**（详见 §3、§5）：

1. **legacy 的 `POST /api/comments` 从头到尾没有加载过 resource 行**——不检查状态、不检查存在。
   这不只是"少一个白名单"，它同时是越权、是 500 逃逸、是信息预言机。M3 修了资源侧，
   M4 加版块侧时是**同一个洞的第二次机会**。
2. **`user.name` 至今没有唯一约束，也没有 handle 列**（legacy 与当前仓库都是）。
   `@提及` 无法按显示名解析。而 handle 一旦发出就进入公开 URL——按 M3 方法论，
   这**正是那三样不可逆之一**，是 M4 唯一必须提前拍板的 schema 决定。
3. **`topic.postCount` 在 M3 里身兼两职**（楼层分配器 + 展示计数）。M3 场景下自洽，
   M4 一旦要"硬删刷屏帖"或"隐藏已删楼层"就会崩——这是 M3 新引入的、legacy 没有的坑。

---

## 1. 全量清点：legacy 评论系统的完整形状

### 1.1 表 `comments`（`legacy/thdl/src/lib/db/schema.ts:152-167`）

实际 DDL（`legacy/thdl/drizzle/0000_lively_wiccan.sql:20-27`）：

```sql
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" integer,          -- ← 注意：无任何约束
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
```

约束与索引（同文件 `:143-158`）——**只有三条**：

```sql
comments_resource_id_resources_id_fk  FOREIGN KEY (resource_id) → resources(id) ON DELETE cascade
comments_user_id_users_id_fk          FOREIGN KEY (user_id)     → users(id)     ON DELETE cascade
CREATE INDEX comments_resource_idx ON comments (resource_id);
```

逐字段体检：

| 字段 | 类型 | 问题 |
|---|---|---|
| `id` | `serial` | 顺序整数主键。可枚举、可数总量。冷启动论坛里"你是第 7 号评论"本身就是产品问题。**且它作为 `number` 一路暴露到客户端 props**（`comment-section.tsx:11`） |
| `resource_id` | `text NOT NULL` FK **cascade** | **评论只能挂在资源上，没有 topic 层**——这是 legacy 结构上不可能支撑论坛的根本原因 |
| `user_id` | `text NOT NULL` FK **cascade** | **删一个用户 = 炸掉他所有楼层**，任何他参与过的讨论串出现空洞。而 legacy 又没有封禁概念（见 §3.A4），治理唯一的杠杆就是删号——两个缺陷叠加成"处理一个刷屏者会毁掉整个版面" |
| `parent_id` | `integer` **无外键** | 可插任意整数，含负数、0、不存在的 id、**别的资源下的评论 id**。孤儿数据的直接来源 |
| `body` | `text NOT NULL` | **DB 层无长度上限**。zod 的 `max(4000)` 只护住这一个端点，任何脚本 / 种子 / 未来端点都能写进 MB 级正文 |
| `created_at` | `timestamp`（**无时区**） | 写入的是 DB 会话时区的墙上时间。对一个 zh/ja/en 三语、面向全球的站点，这是真实隐患 |
| — | — | **无 `updated_at`**：不可编辑，且无法判断内容是否被改过 |
| — | — | **无 `deleted_at`**：不可软删。要删只能硬删，硬删父评论就留下一批 `parent_id` 悬空的孤儿（无外键，DB 不拦） |
| — | — | **无 `floor`**：没有楼层号。排序键是 `created_at`，非唯一，无 tiebreaker |
| — | — | **无 `topic_id` / `board`**：无法表达"不挂资源的帖子" |

索引缺口：

- 实际查询是 `WHERE resource_id = ? ORDER BY created_at DESC LIMIT 200`，
  单列索引只能供 rows，排序要额外 sort。缺 `(resource_id, created_at DESC)` 复合索引。
- **`user_id` 无索引** → "这个用户的全部发言"（产品文档承诺的个人主页聚合）是全表扫。
- **`parent_id` 无索引** → 找子回复全表扫。
- `resources` 上**没有 `comment_count` 冗余列** → 列表页想显示评论数只能对每张卡片跑子查询（N+1）。

### 1.2 端点：**只有一个**

`legacy/thdl/src/app/api/comments/route.ts`，全文 23 行：

```ts
const body = z.object({
  resourceId: z.string().min(8),        // ← 只要求 ≥8 字符
  body: z.string().min(1).max(4000),
  parentId: z.number().int().optional(),// ← 无 positive，无存在性校验
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { resourceId, body: text, parentId } = parsed.data;
  const [row] = await db
    .insert(comments)
    .values({ resourceId, userId: session.user.id, body: text, parentId: parentId ?? null })
    .returning();
  return NextResponse.json({ ok: true, id: row.id });
}
```

**授权逻辑的全部内容就是"有没有登录"。** 没有 `GET`、没有 `PATCH`、没有 `DELETE`。

对比 M4 需要的端点面：读（分页）、写、编辑、软删、举报、订阅、通知已读——
legacy 提供了其中 1/7，且那 1/7 是错的。

### 1.3 读路径：内联在 RSC 页面里

`legacy/thdl/src/app/(site)/resources/[slug]/page.tsx:43-57`：

```ts
const commentRows = await db
  .select({ id, body, createdAt, parentId, userId, userName: users.name, userImage: users.image })
  .from(comments)
  .leftJoin(users, eq(users.id, comments.userId))
  .where(eq(comments.resourceId, r.id))
  .orderBy(desc(comments.createdAt))
  .limit(200);
```

- 读路径**没有 API**，焊死在这一个页面上。M4 的"一套数据两个视图"根本无法复用它。
- `.limit(200)` **无 offset、无分页**：第 201 条起永久不可见，且因为是 `DESC`，
  被吞掉的是**最早的评论**，UI 上没有任何提示。对论坛而言这是数据丢失形状的 bug。
- 200 行完整正文全量塞进 RSC payload，每次访问（含爬虫）都传一遍。
- `leftJoin(users)` 的 null 分支在 legacy 里**永远走不到**——cascade 保证了作者存在评论就存在。
  M3 改成 `set null` 后这个分支才真正可达，`listPosts` 已正确处理。

### 1.4 前端组件（`comment-section.tsx`，85 行）

- 渲染 `<p className="whitespace-pre-wrap">{c.body}</p>`——**纯文本，不渲染 Markdown**。
- `parentId` 在 `Row` 类型里声明了、从服务端传下来了，**然后被完全忽略**：
  渲染的是扁平 `<ul>`，提交时也不发送 `parentId`（`:39`）。
  → **回复功能是半成品死代码**：列存在、API 收、无人产、无人消费。
- 发送后 `router.refresh()`（`:43`），但该页面有 `export const revalidate = 30`（`:17`），
  POST 端点也从不 `revalidatePath`。**自己刚发的评论可能最长 30 秒看不到。**
- `body.trim()` 只在客户端挡（`:38`）；API 侧 `min(1)`，**一个空格就能过**。
- 错误处理是 `toast.error("发送失败")`——单一文案，与 M3 立的规矩（api 返回 code、前端查 Paraglide）相反。
- 无乐观更新、无草稿保存：发送失败 `body` 不清空算是歪打正着，但 `router.refresh()` 期间无任何 pending 反馈。

---

## 2. 相邻系统里的连带事实（影响 M4 判断）

- **举报只能针对资源**：`reports.resourceId NOT NULL FK → resources`（`schema.ts:198-207`）。
  **legacy 里根本没有"举报一条评论"的可能。**
  好消息：M3 的 `report` 已经是多态的（`targetKind` + `targetId`，`kourindou.ts:360-384`），
  且 `interactions.ts:107-134` 已对两个分支都做了存在性 + 状态校验。M4 举报楼层几乎零成本。
- **角色枚举有个死值**：`roleEnum = ["user","uploader","moderator","admin"]`，
  `uploader` 全仓无消费点。M3 已收敛为 `user|moderator|admin`——不要因为"论坛要更多角色"就重新膨胀。
- **没有封禁态**。`users` 表无 `banned`/`mutedUntil`。M4 有了论坛就必然需要——
  但注意 M3 已有 `userProfile.strikeCount`，先考虑复用而不是新起一套。
- **详情页用黑名单判可见性**：`if (!r || r.status === "takedown") notFound()`（`page.tsx:34`）
  → `pending` 与 `hidden` 资源的**详情页和评论区对所有人开放**。
  下载端点同病（`api/download/route.ts`：`if (!r || r.status === "takedown")`）。
  这正是 CLAUDE.md 里那条"状态判断一律白名单"的来源。
- **`PATCH /api/resources/[id]` 的 `canEdit` 有个漂亮的小处理**：
  `if (v.status && !check.staff) delete v.status`（`[id]/route.ts:42`）——
  非 staff 的 status 字段被静默剥离而不是报错。这是**值得抄的思路**（字段级授权），
  但**静默**是错的：用户以为改成功了。M4 应该显式 403。

---

## 3. 缺陷目录

每条给出：**证据 → 机制 → M3 是否已修 → M4 该做什么**。

### A. 授权与越权

**A1（P0）· `POST /api/comments` 从不加载 resource 行 —— 一个洞、三种后果**

- 证据：`route.ts:18-21`，从 `db.insert` 直接开始，全文没有 `select ... from resources`。
- 机制一（**越权**）：可以对 `pending`（未审核）、`hidden`、`takedown` 的资源发评论。
  只要拿到 id 就行，而 id 会出现在上传者自己的页面、编辑页 URL、以及任何一次分享里。
- 机制二（**500 逃逸**）：`resources.id` 是 `text` 列，喂一个不存在的字符串不会触发 22P02，
  而是触发 FK 违例——**未 catch**，直接冒泡成 500 带栈。与 M3 记下的"非 UUID 会 500 逃出错误信封"
  是同一类，只是走的是外键而不是类型转换。
- 机制三（**信息预言机**）：因此"发评论"的成功/失败泄露了"该 id 是否存在"，
  包括别人的私有草稿。M3 在举报端点的注释里已经点名过这个模式（`interactions.ts:115-119`）。
- M3：**已修**——`content/index.ts:19-33` 的 `publishedTopic()` 用白名单
  `eq(resource.status,'published') && isNull(deletedAt)`，`fail(c,'not_found',404)`。
- M4：**同一个洞的第二次机会。** 版块帖走的是另一条路径（`topic.kind='board'`），
  `publishedTopic()` 帮不上忙。必须写一个对称的 `visibleTopic()`，
  同样用白名单，并且**在同一个函数里**同时处理两种 kind——分成两个函数就会漂移。

**A2（P1）· `parentId` 不校验归属，可跨资源回复**

- 证据：`route.ts:9` + `:20`，`parentId` 直接落库，不查它属于哪个 resource。
- 机制：在资源 A 下发一条 `parentId` 指向资源 B 评论的回复。UI 若渲染树就会跨资源串线。
- M3：**已修**——`post.ts:59-65` 用 `and(eq(post.id, parentId), eq(post.topicId, topicId))` 双条件查。
- M4：保持。注意它在**事务外**执行（见 C3）。

**A3（P1）· 无任何限流、反滥用、去重**

- 证据：全仓 grep 无 rate limit、无 Turnstile、无冷却、无重复正文检测。
- 机制：一个有效 cookie + 循环 = 无上限写入。**而 legacy 又没有删除端点**（E1），
  刷屏后除了直接连 SQL 无法收拾。
- M3：**未修**。`errors.ts:16` 定义了 `rate_limited` 码，但全仓无人抛出——空悬。
- M4：**必须做，且这是 M4 新增的风险，不是继承的。** 资源站的写入天然稀疏（上传要填表、要过审），
  论坛的写入天然密集。M3 靠"信任梯度 + 资源少"侥幸过关的地方，M4 不成立。
  最低限度：按 `userId` 的滑动窗口（redis db1 已在跑），新账号更严；`rate_limited` 码终于有人抛。

**A4（P1）· 无封禁态，治理唯一杠杆是删号，而删号 cascade 炸楼**

- 证据：`users` 无 banned 列；`comments.user_id ... ON DELETE cascade`。
- M3：**部分修**——`post.authorId` 已改 `set null`，删号不再炸楼；但仍无封禁态。
- M4：需要"能发言但不能新发"的中间态。**先看能不能复用 `userProfile.strikeCount`**
  （M3 已有写入点：`copyright`/`illegal` 拒稿 +1），而不是新建一张 ban 表。

### B. 孤儿数据与引用完整性

**B1（P0）· `parent_id` 裸 integer，无外键**

- 证据：DDL `"parent_id" integer,`，migration 里只有 resource_id / user_id 两条 FK。
- 机制：可插不存在 id、负数、0；硬删父评论后子评论悬空且 DB 不拦。
- M3：**已修**——`content.ts:69-71` 自引用外键 `onDelete: 'set null'`，且注释点名了这条。
- M4：注意一个后果——M4 的删除是**软删**，`set null` 不会触发，
  `parentId` 会继续指向一条 `bodyMd` 被清空的楼层（`post.ts:40`）。
  UI 必须有"被引用的楼层已删除"的渲染态，不能空白或崩。

**B2（P1）· 硬删是唯一的删除方式，因此孤儿是必然而非意外**

- 证据：无 `deletedAt`，无 DELETE 端点——所以删除只能是 DBA 行为，
  而 DBA 行为不会去补 `parent_id`。
- M3：**已修**——`softDeletePost` 保留楼层占位（`post.ts:104-107`），
  `listPosts` 把已删楼层渲染成 `bodyMd: ''` + `deleted: true`（`post.ts:39-41`）。
  这条**做得对，M4 直接沿用**：楼层号不能出现空洞，否则"第 137 楼"这个引用就断了。
- M4：唯一要加的是**版主删帖要留痕**（谁删的、为什么），
  M3 的 `moderationLog` 已有 `soft_delete` 动作值（`enums.ts` MODERATION_ACTION）——现成的。

**B3（新增 · P1）· M3 的 `report.targetId` 是同一类风险的合法版本**

- 证据：`kourindou.ts:364-365`，`targetKind varchar` + `targetId text`，**无外键**（多态列不可能有）。
- 机制：这是"legacy parentId 无外键"的同构问题，只是这次是**故意的**——多态外键做不到。
  因此完整性责任 100% 落在 API 层。
- M3：`interactions.ts:107+` 两个分支都验了。**但被举报对象后来被硬删时，report 行会悬空。**
- M4：新增"举报楼层"入口时别绕开那段校验；另外审核队列渲染要能容忍 target 已消失
  （M3 的举报队列 UI 目前假定 target 还在）。

### C. 竞态与并发

**C1（P0）· 没有楼层号，所以没有楼层竞态——但换来了排序不确定**

- 证据：无 `floor` 列；`orderBy(desc(comments.createdAt))`，**无 tiebreaker**。
- 机制：`created_at` 非唯一。同一微秒内的两条评论排序由 PG 自行决定，
  且**每次查询可以不同**。叠加 `LIMIT 200` 无 offset，翻页（如果有）会重复/漏行。
- M3：**已修**——`floor` + `topic.postCount` 原子自增（`UPDATE` 持行锁串行化）
  + `post_topic_floor_uq` 兜底（`post.ts:69-98`）。这是 M3 做得最好的一处。
- M4：沿用。但见 C4 / D2 的两个后续问题。

**C2（P1）· 评分端点的读-改-写竞态（同一作者的同类习惯）**

- 证据：`api/ratings/route.ts`，事务内先 `select` 旧分再算 `delta` 再 `update`。
  默认隔离级别下两个并发请求可读到同一旧分，`ratingSum` 漂移。
- M3：**已修**——`onConflictDoUpdate` + SQL 表达式自增。
- M4：不涉及评分，但**同一个陷阱会出现在"点赞数""订阅数""未读计数"上**。
  凡是计数，一律 SQL 表达式，不许读-改-写。

**C3（新增 · P2）· `createPost` 的父帖校验在事务外（TOCTOU）**

- 证据：`post.ts:59-65` 的父帖查询在 `db.transaction` **之前**。
- 机制：校验通过与插入之间父帖被删 → 回复挂到已删父帖上。软删场景下危害小（不会孤儿），
  硬删场景下靠 `set null` 兜住。当前可接受，但 M4 版块并发更高，值得移进事务。

**C4（新增 · P1）· `createPost` 的 `catch {}` 吞掉一切错误**

- 证据：`post.ts:99-101`：

```ts
  } catch {
    return { ok: false, reason: 'topic_missing' }
  }
```

- 机制：`post_topic_floor_uq` 的唯一违例、连接错误、CHECK 违例——**全部被翻译成 404 not_found**。
  也就是说：**楼层分配器一旦真的坏了，你永远不会知道**，
  因为那道专门为它设的唯一索引报出来的错，会被伪装成"主题不存在"。
  这个 catch 把 C1 修复里最关键的告警通道给闷死了。
- M4：至少区分三条路——唯一违例（可重试一次）、主题缺失（404）、其余（500 + 日志）。
  M4 的版块是真会有并发的地方，M3 只有资源评论区所以没暴露。

### D. 查询与性能

**D1（P1）· 读路径的三个缺陷叠加**

- 无索引支撑排序（缺 `(resource_id, created_at DESC)`）、无分页、全量正文进 payload。
- M3：**部分修**——有 `post_topic_floor_idx (topicId, floor)` 支撑 `ORDER BY floor`，
  有 `page/pageSize`。
- M4：见 D2。

**D2（新增 · P1）· `listPosts` 用 OFFSET 分页，但楼层号是稠密单调的**

- 证据：`post.ts:33-34`，`.limit(pageSize).offset((page-1)*pageSize)`。
- 机制：论坛的表台功能是**"跳转到第 137 楼"**。用 OFFSET 就得把楼层号换算成页号，
  换算依赖 `pageSize`，而 `pageSize` 是客户端传的（`paginationQuerySchema`）——
  同一条深链在不同 pageSize 下指向不同内容。而 `floor` 稠密单调，
  `WHERE floor BETWEEN x AND y` 既更快也让"跳楼"变成纯函数。
- M4：楼层区间分页；`pageSize` 由服务端定，不接受客户端任意值。

**D3（P2）· 缺 `user_id` 索引 → 个人主页聚合全表扫**

- M3：**已修**（`post_author_idx`）。M4 的"个人主页帖子聚合"直接可用。

**D4（P2）· 无评论数冗余列 → 列表页要 N+1**

- M3：**已修**（`topic.postCount`）。但见 §5 的双职问题。

**D5（P2）· 同作者的 N+1 习惯出现在别处，别带进 M4**

- `me/page.tsx`：先查全部 favorite id（**无 limit**），再 `inArray` 二次查询。
  收藏 1 万条就构造 1 万元素的 `IN (...)`。
- M4 的**通知列表 / 订阅列表**是同形状的东西，必须一次 join + 分页，不许"先取 id 再 inArray"。

### E. 功能性空洞（不是 bug，是"根本没有"）

| 缺口 | legacy | M3 | M4 判断 |
|---|---|---|---|
| **E1 删除评论** | 无端点。作者不能撤回，版主不能删 | 已有 `DELETE /posts/:id` + `isOwnerOrStaff` | 沿用；补版主留痕 |
| **E2 编辑评论** | 无。连 `updated_at` 都没有 | 有 `updatedAt` 列，**无端点** | 要做（Markdown 没有编辑很痛苦），且必须显示"已编辑" |
| **E3 举报评论** | 结构上不可能 | `report` 已多态且已校验 | 近乎免费 |
| **E4 通知** | **零**。回复了对方永远不知道 | 零 | 100% 新建，无先例可挖 |
| **E5 @提及** | **零** | 零 | 见 §5 的 handle 问题 |
| **E6 订阅 / 追帖** | 零 | 零 | 新建 |
| **E7 锁帖 / 置顶 / 精华** | 零 | 零 | 论坛必需；`topic` 表加列即可（无数据，零成本） |
| **E8 限流** | 零 | 码空悬 | 见 A3 |

关于 E4 的一条**反向收获**：因为 legacy 完全没有通知表，
也就没有留下"扇出写 vs 扇出读"的历史包袱。按 M3 方法论（库里没数据 ⇒ 迁移成本为零），
上线时通知量近 0，**写时扇出进一张 `notification` 表**是显然的选择——
不要为它建 outbox / 队列 / worker。M3 已经用同样理由删掉过 `search_outbox`。

### F. 渲染与 XSS

**F1 · legacy 从未真正渲染过 Markdown**

- 证据：字段叫 `descriptionMd`，渲染却是 `whitespace-pre-wrap` 纯文本（`page.tsx:107`）；
  评论同理（`comment-section.tsx:78`）。
- 后果：**legacy 的 XSS 面为零，因此也没有任何可参考的净化代码。**
  M4 承诺"Markdown + 图片 + 东方表情 + @提及 + 引用"，
  这意味着 M4 引入一个**完全没有先例的渲染攻击面**，必须从零设计：
  - 净化在**渲染时**，不在存储时。`bodyMd` 存原文（M3 已经是），
    否则净化器修 bug 后无法回溯修复历史内容。
  - 图片 `src` 必须白名单（自建 MinIO + 极少数已知域）。
    允许任意外链 `<img>` = 给每个访客发 IP 追踪像素，且必然混合内容。
    M3 的 `downloadUrlSchema` 已经立了"只收 http(s)/magnet"的先例，同一思路延伸。
  - 用户产出的链接一律 `rel="noopener noreferrer nofollow ugc"`。
    **legacy 这一处做对了**（`page.tsx:154`，`rel="noreferrer noopener"`）——
    是本次挖掘里为数不多"值得抄"的具体行为。
  - 表情与 @提及**不要发明新语法**。它们应当是渲染期对已净化 AST 的替换，
    而不是渲染前对原文的字符串替换——后者会被代码块和转义符绕过。

**F2（P2）· 错误反馈与 i18n 相悖**

- legacy 是单一中文 toast。M3 已立规矩（api 返回 code，前端查 Paraglide）。
- M4 楼层写入的失败分支比 M3 多（限流、封禁、锁帖、版块权限），
  每一条都要有 code + 三语文案，别退回"发送失败"。

---

## 4. M3 对账表：legacy 的坑修掉几条

任务里点名 M3 修了 `parentId` 无外键与楼层竞态两条。逐条核对，实际是这样：

| # | legacy 缺陷 | M3 | 证据 |
|---|---|---|---|
| 1 | `parentId` 无外键 | ✅ 已修 | `content.ts:69-71` 自引用 FK |
| 2 | 无楼层号 / 排序不确定 | ✅ 已修 | `post.ts:75-97` 原子自增 + `post_topic_floor_uq` |
| 3 | 评论挂死 resource | ✅ 已修 | `topic` 多态（`content.ts:27-53`） |
| 4 | `serial` 主键 | ✅ 已修 | uuid |
| 5 | 作者 cascade 炸楼 | ✅ 已修 | `post.authorId ... set null` |
| 6 | 无软删 | ✅ 已修 | `deletedAt` + 占位渲染 |
| 7 | 无状态校验（越权/500/预言机） | ✅ 已修（资源侧） | `publishedTopic()` 白名单 |
| 8 | `parentId` 不校验归属 | ✅ 已修 | `post.ts:63` 双条件 |
| 9 | 无 `user_id` 索引 | ✅ 已修 | `post_author_idx` |
| 10 | 无评论数冗余 | ✅ 已修 | `topic.postCount` |
| 11 | 无时区时间戳 | ✅ 已修 | 全部 `withTimezone: true` |
| 12 | 举报无法针对评论 | ✅ 已修 | `report` 多态 + 双分支校验 |
| 13 | 无删除端点 | ✅ 已修 | `DELETE /posts/:id` |
| 14 | **正文无 DB 层长度上限** | ❌ **未修** | `bodyMd: text()`，只有 zod `max(20000)` |
| 15 | **空白正文可入库** | ❌ **未修** | `createPostSchema` 是 `min(1)` 无 trim，`" "` 通过 |
| 16 | **无限流** | ❌ 未修 | `rate_limited` 码无人抛 |
| 17 | **无封禁态** | ❌ 未修 | — |
| 18 | **无编辑端点** | ❌ 未修 | 有 `updatedAt` 列无入口 |
| 19 | **无通知 / @提及** | ❌ 未修 | 本就是 M4 范围 |

第 14、15 条值得单独说：它们是**从 legacy 一路活到今天**的两条，
且都属于"zod 是唯一防线"这一类。M3 自己在评分上立过反例
（`rating_score_range` CHECK：`legacy 只在 zod 里，绕过 API 就能写 999`），
但对 `bodyMd` 没有执行同一标准。M4 加种子数据、加导入脚本、加"资源自动建首楼"
这类**绕过 HTTP 层的写入**时会撞上。修法是零成本的（无数据）：
`bodyMd` 加 CHECK 长度上限，schema 侧 `.trim().min(1)`。

---

## 5. 当前仓库里的新发现（不是 legacy 的坑，是 M3 留给 M4 的）

这几条不在任务给的清单里，但会直接决定 M4 的 schema 与服务层，且都是**现在改零成本、上线后不是**。

**N1（P0）· `user.name` 无唯一约束，也没有 handle —— @提及无法解析**

- 证据：`packages/db/src/schema/auth.ts`，`name: text('name').notNull()`，**无 unique**；
  全表无 `handle`/`username` 列。legacy 亦然。
- 机制：`@灵梦` 无法确定指向谁。按 name 解析要么歧义、要么取第一个（可被抢注冒充）。
- 为什么必须现在定：M3 方法论说真正不可逆的只有**已发出的 URL/slug** 与**法律留痕**。
  用户 handle 一旦启用就同时是 `@handle` 的解析键**和** `/u/handle` 的公开 URL——
  它正好落在那条红线上。**这是 M4 唯一必须提前拍板的 schema 决定**，
  其余表结构都可以 `rm -rf drizzle && generate`。
- 三个方向（留给站长决策，见开放问题）：
  a) 加 `userProfile.handle` 唯一列，注册时生成、可改一次；
  b) 不做 handle，@提及走"选择器 + 存 userId"（前端补全，正文里存 `@[名字](userId)`），
     显示名可随意改而链接不断——**这条不需要新 URL 空间，也就不触碰红线**；
  c) 两者都做。
  b 是 YAGNI 意义上的最小解，且规避了不可逆点。

**N2（P1）· `topic.postCount` 身兼两职：楼层分配器 + 展示计数**

- 证据：`post.ts:78` 自增它、`:97` 拿它当 `floor`；同时它显然也是"共 N 条回复"的数据源。
  `softDeletePost` 不减它（**这是对的**——减了下次插入就会撞楼层）。
- 机制：M3 场景自洽，因为 `listPosts` 会把已删楼层作为占位渲染出来，列表长度 = postCount。
  **M4 一旦做以下任一件事就崩**：
  - 硬删刷屏帖（论坛必然会有）→ 计数虚高且楼层出现真空洞；
  - 列表里彻底隐藏已删楼层（版面清爽的常见诉求）→ "共 N 条"与看到的条数对不上；
  - 版块列表页显示"回复数"→ 显示的是"曾经分配过的楼层数"。
- M4：把两件事拆开。`postCount` 更名/明确为**楼层水位（只增不减）**，
  另加 `replyCount`（可增可减，展示用）。现在零成本。

**N3（P1）· `listPosts` 不检查 topic 的可见性，`createPost` 检查了**

- 证据：`post.ts:81` 的 `createPost` 有 `isNull(topic.deletedAt)`；
  `listPosts`（`:16-46`）只按 `topicId` 查，**不碰 topic 行**。
- 机制：M3 侥幸——资源侧调用方 `publishedTopic()` 在外面把关了。
  **M4 的版块主题可以被版主单独软删**（M3 的 topic 只随资源消亡），
  那时 `listPosts(deletedTopicId)` 会正常返回全部楼层。
- M4：可见性判断要么全进 `content/post.ts`，要么全在路由层——
  现在是"一半一半"，这正是 M3 计划里说过的"分层边界没有编译器保护，必然漂移"的实例。

**N4（P2）· `createPost` 的 `catch {}`**（同 C4，此处不重复）

**N5（P2）· `createPostSchema` 没有 trim**（同对账表第 15 条）

---

## 6. 判断：什么值得移植，什么是历史包袱

### 值得移植（诚实地说，很少，且大半已在 M3 里）

1. **`leftJoin(users)` 单查询补全作者** —— 一次 join 拿到 author name/image，不做 per-post 用户查询。
   `listPosts` 已是这个形状，M4 加"头像 / 角色徽章 / 楼主标记"时**不许**退化成循环查用户。
2. **`rel="noreferrer noopener"` 用在用户产出的链接上**（`page.tsx:154`）——
   legacy 少数做对的具体行为，M4 的 Markdown 渲染器要把它变成强制规则（再加 `nofollow ugc`）。
3. **字段级授权的思路**（`[id]/route.ts:42` 剥离非 staff 的 `status`）——
   思路对（同一端点不同角色可写字段不同），**但静默剥离要改成显式 403**。
   M4 会遇到同构场景：普通用户 PATCH 自己的帖子，版主 PATCH 时还能改置顶/加精。
4. **交互表用复合主键**（`ratings`/`favorites`）—— M3 已沿用；M4 的"订阅""已读"同形。
5. **发帖后清空输入 + 刷新的交互骨架** —— 形状对，失效机制错（见 §1.4）。

### 历史包袱，明确不要带过来

1. **以 resource 为锚点** —— 已被 `topic` 取代。M4 不许再出现任何 `resourceId` 直连楼层的路径。
2. **`serial` 主键 / 客户端可见的顺序整数** —— 已换 uuid。
3. **`created_at DESC` 的评论区排序** —— 这是评论区约定，与论坛约定**相反**。
   一份数据两个视图，如果两个视图排序方向不同，`floor` 就失去意义（"第 3 楼"在哪一屏？）。
   **建议：两个视图都按 floor 升序**，资源侧给"跳到最新"的入口，而不是翻转排序。
4. **半成品的 `parentId` 树** —— legacy 存了、收了、从不用。
   M4 必须**先定语义再写代码**。建议取 **NGA 心智：扁平楼层 + 引用**，
   `parentId` 表示"这条引用了哪一楼"，UI 渲染成引用块而非嵌套缩进。
   理由：产品文档写的是"楼层回复"与"引用"，不是"嵌套讨论"；
   且嵌套树会把分页、楼层号、跳楼三件事同时复杂化，而上线时帖子数为 0，收益为 0。
   数据库列不变（已有 `parentId` 自引用），差别纯在 UI 与 API 语义——**现在定，别拖**。
5. **`uploader` 这类死角色值** —— 不要以"论坛需要更多角色"为由膨胀 `USER_ROLE`。
   版主的**版块范围**如果真要做，是一张 `board_moderator` 关联表，不是新枚举值。
6. **黑名单式可见性判断**（`!== 'takedown'`）—— CLAUDE.md 已明令。
   M4 版块可见性（公开/登录可见/staff 可见）同样必须白名单。
7. **`revalidate = 30` 式的读缓存叠在写路径上** —— RR8 没有这个具体机制，
   但等价陷阱是 loader 缓存 / 乐观更新与服务端真值不一致。
   **写端点应当返回创建出来的楼层（M3 的 `POST` 已返回 `{id, floor}`）**，
   前端用它直接渲染，而不是发完再去 refetch 一次赌缓存。
8. **单一 toast 文案的错误处理** —— 与三语和 error-code 约定相悖。

---

## 7. 给 M4 设计的可执行结论（收敛清单）

按"现在做零成本 / 上线后昂贵"排序：

**必须在写第一行代码前定的（红线）**
- N1：@提及的身份解析方案（handle 列 vs. 存 userId）。**唯一触碰"已发出 URL"红线的决定。**

**建表时顺手做掉的（零成本，漏了以后要迁移或补脏数据）**
- N2：`postCount` 拆成"楼层水位"与"展示回复数"。
- 对账表 14/15：`bodyMd` 加 DB 层 CHECK 长度；schema 加 `.trim()`。
- E7：`topic` 加 `locked` / `pinnedAt` / `featured`（论坛必需，加列此刻是零成本）。
- 版块表：`board` 是查找表（六个版块 + 多语名 + 排序），不是 pgEnum——
  与 M3 的 `resource_category` 完全同构，抄那个形状。

**服务层必须处理的**
- A1：`visibleTopic()` 白名单，**两种 kind 在同一函数里**。
- N3：可见性判断收口，不许一半在 `post.ts` 一半在路由。
- C4：`createPost` 的 `catch {}` 拆分三条路径，唯一违例不许伪装成 404。
- D2：楼层区间分页取代 OFFSET；`pageSize` 服务端定。
- C3：父帖校验移进事务。

**必须新建、无先例可抄的**
- A3：限流（redis db1 已在跑，`rate_limited` 码已存在，缺的只有实现）。
- E4：`notification` 表 + 写时扇出，**不要 outbox/队列/worker**（M3 已用同理由删过 `search_outbox`）。
- E2：编辑端点 + "已编辑"标记。
- F1：Markdown 渲染管线——渲染时净化、图片 host 白名单、链接 rel 强制、
  表情与 @ 在 AST 层替换而非字符串替换。

**明确不做（YAGNI，上线帖子数为 0）**
- 嵌套回复树、分版块权限矩阵、声望/等级/勋章体系、
  编辑历史版本表、草稿箱、通知偏好细粒度开关、邮件推送。
  这些全都是"有数据以后加，加的时候是纯 additive"。

---

## 附：本次挖掘读过的全部文件

**legacy（只读参考）**
- `legacy/thdl/src/lib/db/schema.ts`（`comments` 表 `:152-167`，关系 `:240-243`）
- `legacy/thdl/drizzle/0000_lively_wiccan.sql`（实际 DDL `:20-27`、约束 `:143-158`）
- `legacy/thdl/src/app/api/comments/route.ts`（唯一端点，全文 23 行）
- `legacy/thdl/src/components/comment-section.tsx`（渲染组件，全文 85 行）
- `legacy/thdl/src/app/(site)/resources/[slug]/page.tsx`（读路径 `:43-57`、可见性 `:34`、缓存 `:17`）
- `legacy/thdl/src/app/api/{ratings,favorites,reports,download}/route.ts`（相邻授权与竞态样本）
- `legacy/thdl/src/app/api/resources/route.ts`、`resources/[id]/route.ts`（字段级授权样本）
- `legacy/thdl/src/app/dash/{layout,page,reports}/page.tsx`、`src/app/(site)/me/page.tsx`
- `legacy/thdl/src/lib/{auth,get-session}.ts`、`src/components/{report-dialog,moderate-actions}.tsx`

**当前仓库（对账与新发现，未修改任何文件）**
- `packages/db/src/schema/content.ts`、`kourindou.ts`、`auth.ts`
- `apps/api/src/modules/content/{post.ts,index.ts}`、`interactions.ts`
- `apps/api/src/{errors.ts,middleware/require.ts}`
- `packages/shared/src/kourindou/{enums.ts,schemas.ts}`
