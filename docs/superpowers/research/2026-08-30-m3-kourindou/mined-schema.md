## 一、legacy 数据模型全表提取

文件：`/Users/i/Code/th/legacy/thdl/src/lib/db/schema.ts`（247 行）
生成的 DDL 对照：`/Users/i/Code/th/legacy/thdl/drizzle/0000_lively_wiccan.sql`（160 行，已核对，与 schema 完全一致）

**实际是 13 张表，不是产品文档写的「thdl 十二张表」**（`docs/product/2026-08-30-platform-direction.md` 第 29 行）。4 张 auth 表 + 9 张业务表。

### 1.1 枚举（3 个，全部 pgEnum 原生类型）

```ts
export const roleEnum = pgEnum("role", ["user", "uploader", "moderator", "admin"]);
export const resourceStatusEnum = pgEnum("resource_status", [
  "public", "pending", "hidden", "takedown",
]);
export const categoryEnum = pgEnum("category", [
  "game", "music", "doujinshi", "cg", "mmd", "video", "wallpaper", "tool", "other",
]);
```

DDL 里落为 `CREATE TYPE "public"."resource_status" AS ENUM(...)`。**没有任何 text + CHECK 约束**，全库零 CHECK（`score` 的 1–5 范围只在 API 层的 zod 里，见 §3.3）。

### 1.2 auth 四表（better-auth 0.x 布局）

| 表 | 字段 | 约束 |
|---|---|---|
| `users` | id text PK；name text NN；email text NN UNIQUE；email_verified bool NN def false；image text；**role roleEnum NN def 'user'**；bio text；created_at/updated_at ts NN def now() | — |
| `sessions` | id text PK；user_id text NN → users.id **cascade**；token text NN UNIQUE；expires_at ts NN；ip_address text；user_agent text；created_at/updated_at | 无索引（连 user_id 索引都没有） |
| `accounts` | id text PK；user_id → users.id cascade；account_id NN；provider_id NN；access_token/refresh_token/id_token；access_token_expires_at/refresh_token_expires_at；scope；password；created_at/updated_at | 无索引 |
| `verifications` | id text PK；identifier NN；value NN；expires_at NN；created_at/updated_at | 无索引 |

对照新仓 `/Users/i/Code/th/packages/db/src/schema/auth.ts`：新版已是单数表名（`user`/`session`/`account`）、有 `session_userId_idx`/`account_userId_idx`、`updatedAt` 带 `$onUpdate`、`account` 多了 `issuer` 字段，且 **`user` 表上没有 `role`**。这是必须处理的差异点（见 §2.7）。

### 1.3 `resources`（核心表）

```ts
export const resources = pgTable(
  "resources",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 128 }).notNull().unique(),
    title: varchar("title", { length: 200 }).notNull(),
    category: categoryEnum("category").notNull().default("other"),
    descriptionMd: text("description_md").notNull().default(""),
    coverKey: text("cover_key"),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: resourceStatusEnum("status").notNull().default("public"),
    circle: varchar("circle", { length: 120 }),
    author: varchar("author", { length: 120 }),
    eventName: varchar("event_name", { length: 80 }),
    language: varchar("language", { length: 16 }),
    externalLinks: jsonb("external_links").$type<{ label: string; url: string }[]>().default([]),
    downloads: integer("downloads").notNull().default(0),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("resources_status_created_idx").on(t.status, t.createdAt),
    index("resources_category_idx").on(t.category),
  ]
);
```

细节：
- `id` 是 **text 列**用 `gen_random_uuid()` 做默认值（PG 隐式 uuid→text 转换），不是 `uuid` 类型 —— 拿不到 uuid 类型的 16 字节存储和比较优势，索引是 36 字节文本比较。
- `external_links` **漏了 `.notNull()`** → DDL 是 `jsonb DEFAULT '[]'::jsonb`（可空），`$inferSelect` 推出 `... [] | null`，每个读点都要判空。
- `circle` / `author` / `event_name` / `language` 全是**自由文本 varchar，无外键、无归一化、无多语**。
- 冗余计数 `downloads` / `rating_sum` / `rating_count` 落在主表。
- 索引只有 2 个：`(status, created_at)`、`(category)`。**`uploader_id` 无索引**（个人主页「我的资源」全表扫）。

### 1.4 `resource_files`

```ts
export const resourceFiles = pgTable("resource_files", {
  id: serial("id").primaryKey(),
  resourceId: text("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  s3Key: text("s3_key").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  checksum: text("checksum"),
  contentType: varchar("content_type", { length: 100 }),
  version: varchar("version", { length: 32 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- **`version` 挂在 file 上**——这就是产品文档要求的 version 实体的全部退化残留：版本号是每个文件各自写的字符串，没有更新日志、没有版本发布时间、没有「当前版本」指针、同一版本的多个文件无法成组。
- **`s3Key` NOT NULL**：结构上不支持「外链镜像」，外链只能塞进 `resources.external_links` 的展示型 jsonb，走不了统一的下载/统计通路。
- **无索引**（连 `resource_id` 都没有；详情页列文件走 seq scan）。
- **无上传状态字段**：预签名直传是两阶段的（建记录 → 签 PUT → 客户端确认），legacy 没有 `uploadState`，失败上传会留下指向不存在对象的行。
- `serial` int 主键直接出现在下载 URL 里：`/api/download?resource=...&file=123`（可枚举）。

### 1.5 `tags` / `resource_tags`

```ts
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
});

export const resourceTags = pgTable("resource_tags", { /* resourceId, tagId 均 cascade */ },
  (t) => [primaryKey({ columns: [t.resourceId, t.tagId] })]
);
```

- 标签是**单维扁平**的：无 `kind`（类型/原作/展会）、无父子、无多语名、无别名、无使用计数。产品文档要的「类型 × 原作 × 展会 多维」在这里没有任何表达。
- `resource_tags` 复合主键 `(resource_id, tag_id)` —— 只有这一个索引，**反向查询（tag → resources，即列表页按标签筛选的主路径）没有索引**。

### 1.6 `comments`

```ts
export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    resourceId: text("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    parentId: integer("parent_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("comments_resource_idx").on(t.resourceId)]
);
```

**`parentId` 是裸 integer，没有 `.references()`** —— DDL 里确认只有 `"parent_id" integer`，两条 FK 约束分别是 resource_id 和 user_id，**没有自引用外键**。可以插入指向任意不存在 id 的孤儿回复。另外：无 `updatedAt`、无软删除、无编辑记录、无楼层号、无 `parentId` 索引。

最关键的结构问题：**comments 直接硬绑 `resourceId`**。这与「资源评论区 = 论坛帖是同一份数据」的已批准决策正面冲突，是 M3 必须先解掉的耦合。

### 1.7 `ratings` / `favorites`（互动，复合主键设计）

```ts
export const ratings = pgTable("ratings", {
    resourceId: text("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.userId] })]
);

export const favorites = pgTable("favorites", { /* 同上，无 score */ },
  (t) => [primaryKey({ columns: [t.resourceId, t.userId] })]
);
```

- **复合主键 `(resource_id, user_id)`，无代理键、无额外 unique index** —— 这个设计本身是对的（天然唯一、无冗余索引），是 legacy 少数值得原样保留的东西。
- 但 **`score` 无 CHECK 约束**：1–5 只在 `/Users/i/Code/th/legacy/thdl/src/app/api/ratings/route.ts` 的 `z.number().int().min(1).max(5)` 里；任何绕过该路由的写入（脚本、后台、未来第二个 API）都能写入 0 或 999，并直接污染 `rating_sum`。
- **`ratings` 无 `updatedAt`**：改分后 `createdAt` 仍是首评时间。
- 主键列序 `(resource, user)` 意味着**「某用户的收藏/评分列表」无索引**——而个人主页「帖子+资源+收藏聚合」是产品文档明写的页面。

冗余计数由应用层事务维护（`ratings/route.ts`）：

```ts
await tx.update(resources).set({ ratingSum: sql`${resources.ratingSum} + ${delta}` })
```

即 sum/count 的正确性完全依赖每一条写路径都记得改主表，没有触发器、没有对账。

### 1.8 `reports`

```ts
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  resourceId: text("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  reporterId: text("reporter_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- **无任何唯一约束**：同一用户可对同一资源无限次举报（刷屏面板）。
- `resolved` 是 **boolean 而非状态枚举**：没有 open/reviewing/rejected/duplicate 的区分，没有处理人、处理时间、处理结论、申诉字段——产品文档要的「举报-处理-申诉闭环」这里只有第一个字。
- `reason` 是自由文本，无举报类型枚举（侵权/失效/错分类/违规内容——其中「侵权」要直连下架流程）。
- 只能举报 resource，无法举报评论/用户。
- `reporterId` 可空 + `set null`：用户注销后举报留存（这点是对的，保留）。
- **无索引**（审核队列 `where resolved = false` 全表扫）。

### 1.9 `download_logs`

```ts
export const downloadLogs = pgTable("download_logs", {
    id: serial("id").primaryKey(),
    resourceId: text("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("dl_resource_idx").on(t.resourceId)]
);
```

- **明文存 IP**，无保留期、无哈希——面向全球（含 EU/日本）的站点这是 PII 合规风险。
- 记的是 resource 级，**没记具体哪个 file**（虽然下载路由拿了 fileId），未来 version 级统计无从谈起。
- 无去重：刷新页面就 +1，`resources.downloads` 可被任意灌水。

### 1.10 关系声明（不完整）

`relations()` 只声明了 4 组：`resourcesRelations`（uploader/files/tags/comments/ratings）、`resourceFilesRelations`、`resourceTagsRelations`、`commentsRelations`。**`favorites` / `reports` / `downloadLogs` / `users` / `tags` 全都没有 relations** → `db.query.*.findMany({ with: ... })` 对这些表不可用。导出类型也只有三个：`Resource` / `NewResource` / `User`。

### 1.11 外键 onDelete 汇总

| 关系 | 行为 | 评价 |
|---|---|---|
| sessions/accounts → users | cascade | 正确 |
| **resources.uploader_id → users** | **cascade** | **危险，见 §2.8** |
| resource_files/resource_tags/comments/ratings/favorites/reports/download_logs → resources | cascade | 大体正确，但 comments 见 §2.2 |
| comments.user_id / ratings.user_id / favorites.user_id → users | cascade | 删用户会在楼层里挖洞 |
| reports.reporter_id / download_logs.user_id → users | set null | 正确 |
| resource_tags.tag_id → tags | cascade | 正确 |
| **comments.parent_id** | **无 FK** | 缺陷 |

---

## 二、保留 / 改造 / 新建

### 保留（原样或微调搬到 `packages/db/src/schema/`）

1. **`ratings` / `favorites` 的复合主键模式** `(targetId, userId)`——新架构继续用，不要加 serial 代理键。
2. **`resource_tags` 的 join 表模式**（复合 PK + 双向 cascade）。
3. **`reports.reporterId` 用 `set null`**、`downloadLogs.userId` 用 `set null` 的取舍。
4. **`slug` 全局 unique + 用 slug 做详情页路由**。
5. **冗余计数落主表**的思路（`downloads`/`ratingSum`/`ratingCount`）——列表页排序需要，保留，但改为可对账（见 §2.9）。
6. **下载走预签名 GET、不落地代理**（`presignGet(file.s3Key, 600)`），B2 同为 S3 兼容，直接沿用。
7. **`descriptionMd` 存 Markdown 源**、渲染在读侧。

### 改造

**2.1 枚举表达方式：pgEnum 保留，但值必须来自 `packages/shared` 的单一常量**

legacy 三个枚举都是 pgEnum，这在新架构下仍然是对的选择（数据库层强约束 > text+check 的可读性劣势），但必须解决「一份 schema 喂三处」：

```ts
// packages/shared/src/kourindou/enums.ts
export const RESOURCE_STATUS = ['draft','pending','published','rejected','delisted'] as const
export const resourceStatusSchema = z.enum(RESOURCE_STATUS)   // 运行时校验 + z.infer + OpenAPI
// packages/db/src/schema/resource.ts
export const resourceStatusEnum = pgEnum('resource_status', RESOURCE_STATUS)  // 同一元组
```
`pgEnum` 要 `readonly [string, ...string[]]`，`as const` 数组正好满足，`z.enum()` 也直接吃它。**注意 pgEnum 的运维代价**：加值要 `ALTER TYPE ... ADD VALUE`（drizzle-kit 能生成，但在同一事务里加完不能立刻用），删值/改序几乎不可能。所以判断标准是「这个集合会不会长」：
- `resource_status`、`license_status`、`report_status`、`file_storage_kind` → 闭集，**用 pgEnum**。
- `category` → **不要再做 pgEnum**。legacy 的 9 值（game/music/doujinshi/cg/mmd/video/wallpaper/tool/other）已经和产品文档的五类内容（同人游戏 / 同人志·图集 / 音乐专辑 / 汉化补丁·字幕 / 工具·素材）对不上；内容类型是会长的。改为 tag 的一个维度（`tag.kind = 'category'`），或独立 `resource_type` 表。

**2.2 评论表：必须先解耦成 topic + post（M3 就要做对，M4 才不用迁移）**

这是本次最重要的一条。legacy 的 `comments.resourceId` 硬绑必须换成：

```
topic        id / boardId?(可空,M4填) / kind('resource'|'forum') / title / lastPostAt / postCount / locked
 └ post      id / topicId / userId / floorNo / bodyMd / replyToPostId(自引用 FK) / deletedAt / editedAt
resource     ... + topicId (unique, 建资源时自动建 topic)
```
要点：
- `resource.topicId` 做 **1:1 且 unique**，资源创建时同事务插 topic —— 这就是「一套内容系统两个视图」的落点。
- 产品文档描述的是「版块 → 主题帖 → 楼层回复 + 引用」（NGA 心智），**不是无限层级树**。所以用 `floorNo` 扁平楼层 + `replyToPostId` 引用，不要 legacy 那种 `parentId` 递归树；这样分页、通知、@提及都简单。
- `replyToPostId` **必须补上真正的自引用外键**（legacy 的裸 integer 是纯缺陷），`onDelete: 'set null'`。
- 补 `deletedAt` 软删（楼层不能物理删，否则楼层号断裂）、`editedAt`、`updatedAt`。
- 索引：`(topicId, floorNo)`、`(userId, createdAt)`。
- M3 阶段 `boardId` 可空、`kind` 固定 `'resource'`，M4 只需填 board 数据，不动表结构。

**2.3 file：三处大改**

- **`s3Key` 改为可空 + 新增 `storageKind` pgEnum(`'b2' | 'external'`) + `externalUrl`**，用 CHECK 保证二选一：`CHECK ((storage_kind='b2' AND s3_key IS NOT NULL) OR (storage_kind='external' AND external_url IS NOT NULL))`。这是唯一一处我建议主动引入 CHECK 的地方（legacy 全库零 CHECK）。
- **新增上传状态**：`uploadState` pgEnum(`'pending'|'uploaded'|'failed'`) + `uploadedAt`。预签名直传必须两阶段确认，否则 B2 里会积累孤儿对象、库里积累指向空对象的行。
- `checksum` 明确算法：`sha256` 列名或加 `checksumAlgo`；`size` 保留 `bigint({ mode: 'number' })`（JS number 到 9PB 安全）。
- 新增 `sortOrder`、`downloadCount`（文件级统计）。
- 补 `(versionId)` 索引。

**2.4 version：新建（legacy 完全没有）**

```
version  id / resourceId(FK cascade) / versionLabel('v1.2'/'C105版') / changelogMd
         / releasedAt / isLatest bool / createdBy / createdAt
```
- `file.resourceId` 改挂 `file.versionId`。
- 「下载指向版本」：详情页默认取 `isLatest = true`，用 **partial unique index** 保证每资源只有一个 latest：`CREATE UNIQUE INDEX ON version (resource_id) WHERE is_latest`。这比在 `resource` 上放 `currentVersionId` 少一条循环外键。
- 下载统计从 resource 级下沉到 version/file 级，resource 级保留 rollup。

**2.5 circle / event：从自由 varchar 提为实体**

legacy 的 `circle` / `author` / `event_name` varchar 无法支撑「社团页」「社团认领」「展会筛选」这三个已定需求。

```
circle          id / slug / name(多语) / nameOriginal / aliases text[] / homepageUrl
                / claimedByUserId(可空 → 认领通道) / verifiedAt / createdAt
resource_circle resourceId + circleId + role('circle'|'artist'|'translator'...)  复合PK
event           id / slug / name(多语) / shortName('C105') / heldOn date / series
```
- 用 `resource_circle` join 表而非 resource 上的单列：一个汉化补丁同时有原社团和汉化组，legacy 的 `circle`+`author` 两列表达不了。
- `event` 建议同时保留 `resource.eventId` 单值 FK（一个资源通常只在一个展会首发）而非 join，除非要表达再版。
- `circle.claimedByUserId` 就是「社团认领」的落点，配 `circle_claim` 申请表（申请人 / 证据 URL / 状态 / 审批人）。

**2.6 license：全新，且是生死线字段**

legacy **一个字段都没有**。建议放在 `resource` 上（它是资源的当前状态，不是独立实体）：

```
licenseStatus  pgEnum('circle_permitted' | 'unspecified' | 'out_of_print' | 'authorized_repost')
               NOT NULL DEFAULT 'unspecified'      ← 默认必须是最保守的「未标明」
licenseNote    text        （社团原文/许可条款摘录）
licenseSourceUrl text      （社团官网/推文/说明书截图的出处）
licenseVerifiedBy / licenseVerifiedAt
```
另外**必须有变更审计表** `license_change_log(resourceId, from, to, changedBy, reason, createdAt)`——版权争议发生时要能证明「我们何时依据什么改的状态」，这是法务价值不是技术洁癖。同理 `takedown_request` 表（申请人 / 与社团关系 / 证据 / 状态 / 处理结果）。

**2.7 用户扩展字段：不要动 better-auth 的 `user` 表**

legacy 把 `role` 直接塞进 `users`。新仓 `packages/db/src/schema/auth.ts` 是 better-auth CLI 可再生成的文件，建议：

```
user_profile  userId PK/FK → user.id cascade
              role pgEnum('user'|'moderator'|'admin')      （或用 better-auth admin plugin 的字段）
              trustLevel smallint NOT NULL DEFAULT 0        ← 信任梯度
              approvedResourceCount int NOT NULL DEFAULT 0  ← 「通过 N 个后即发即审」的计数
              bio / displayName(多语?) / locale / createdAt
```
`trustLevel` 与 `role` **必须分开**（产品文档：信任等级两模块共享，role 是权限）。legacy 的 `uploader` role 其实是把信任等级伪装成角色，别学。

**2.8 级联删除：`resources.uploaderId` 的 cascade 必须改掉**

```ts
uploaderId: text("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" })
```
删一个用户 → 他的所有资源连带 files/comments/ratings 全部消失，B2 上的对象变成永久孤儿，别人写的评论和评分一起没。对内容平台这是错的。改为 `onDelete: 'set null'`（uploaderId 变可空）+ 软删用户 + 保留「已注销用户」占位；`comments.userId` 同理。

**2.9 计数一致性**

保留冗余计数（列表排序需要），但补两件事：一是 `downloads` 去重（按 `(resourceId, userId 或 ip_hash, 日期)` 唯一，或直接改成 `download_stat_daily` 汇总表 + 主表只存 rollup）；二是加一个可跑的对账脚本 / 定时任务重算 `ratingSum`、`ratingCount`。同时 `rating.score` 加 `CHECK (score BETWEEN 1 AND 5)`——**zod 校 API 边界，DB 校数据不变式，两层都要**，这正是「一份 schema 喂运行时校验」不能替代数据库约束的地方。

**2.10 时间类型：全部 `timestamp` 改 `timestamptz`**

legacy 13 张表所有时间列都是**无时区 `timestamp`**（DDL 确认）。一个 zh/ja/en 三语、面向全球的站点必须用 `timestamp({ withTimezone: true })`。另外 legacy 的 `updatedAt` 只有 `defaultNow()` **没有 `$onUpdate`**，所以更新时根本不动——新仓 auth.ts 已经用了 `.$onUpdate(() => new Date())`，业务表照抄这个模式。

**2.11 主键策略统一**

legacy 是混的：auth 表 text id、`resources` text+uuid 默认值、其余 6 张表 `serial` int。新架构建议业务实体统一 **text 主键 + 应用层生成 UUIDv7/ULID**（与 better-auth 的 text userId 天然兼容、时间有序、不泄露总量、不阻碍未来数据合并），纯 join 表继续用复合主键，`serial` 一律不用。

**2.12 多语业务字段（产品文档第 7 行明写「从第一张业务表开始落实」）**

legacy 零支持。两种方案，建议混用：
- **短字段（resource.title、circle.name、tag.name、event.name）**：用 jsonb `{ zh?, ja?, en? }` + 独立的 `titleOriginal`（社团原始日文标题，永不翻译）+ 回退链 zh→ja→en。理由：永远整体读取、Meilisearch 建索引时展平最方便、不需要 join。用 `$type<LocalizedText>()` 配 `packages/shared` 的 zod schema 保证写入形状。
- **长字段（resource.descriptionMd、version.changelogMd）**：独立 `resource_translation(resourceId, locale, ...)` 复合 PK 侧表。理由：需要按语种独立贡献、审核、版本化，jsonb 里塞长文会让主表膨胀且无法做 per-locale 权限。

同时补 **原作关联**（legacy 完全没有，只能靠自由 tag）：`touhou_work` 表（作品编号 th06…、多语名、类型 STG/书籍/音乐）+ `resource_work` join，这也是日后与 chronicle/TouhouDB 对接的挂载点。

**2.13 索引补全清单**

`resource(uploaderId)`、`resource(licenseStatus)`、`resource(circleId 或 resource_circle 反向)`、`resource_tag(tagId, resourceId)` 反向、`favorite(userId, createdAt)`、`rating(userId)`、`report(status, createdAt)`、`post(topicId, floorNo)`、`file(versionId)`、`version(resourceId)`、`download_log(resourceId, createdAt)`。

---

## 三、三个特别关注点的直接回答

### 3.1 枚举值怎么表达

**全部是 `pgEnum`，原生 PG ENUM 类型，零 `text + CHECK`，全库零 CHECK 约束。** 三个：`role`、`resource_status`、`category`（定义见 §1.1，DDL 里是 `CREATE TYPE "public"."xxx" AS ENUM(...)`）。取值范围的业务校验（如 rating 1–5）全部散落在各 API 路由的 zod 里，数据库不设防。

新架构结论：pgEnum 继续用于闭集，但值元组必须定义在 `packages/shared` 并同时喂给 `z.enum()` 和 `pgEnum()`；`category` 这种会增长的集合改用 tag 维度；**同时补回 CHECK 约束**（score 范围、file 的 b2/external 二选一），不要因为有 zod 就放弃数据库不变式。

### 3.2 资源状态机怎么建模

`resourceStatusEnum = ["public", "pending", "hidden", "takedown"]`，列定义 `status: resourceStatusEnum("status").notNull().default("public")`。

**这不是一个状态机，只是一个标签**：
- **默认 `public`** —— legacy 是「直接发布，无审核」，连「先发后审」的 pending 入口都没接（pending 是死值）。
- **没有任何流转元数据**：无 `submittedAt` / `reviewedBy` / `reviewedAt` / `rejectReason` / `takedownReason` / `takedownRequestedBy`。审核队列、审核结果通知、申诉全部无处落地。
- **没有审计**：状态改了就改了，查不到谁在什么时候因为什么改的。版权场景下这是硬伤。
- **`hidden` 与 `takedown` 语义混淆**：一个是上传者/版主软隐藏，一个是版权下架，但没有字段区分二者的成因和可恢复性。
- **信任梯度零支持**：`users` 上没有信任等级/已通过资源数，「新账号首个资源人工审核、通过 N 个后即发即审」的判定依据不存在。
- **状态检查是黑名单式的，且有实际漏洞**。`/Users/i/Code/th/legacy/thdl/src/app/api/download/route.ts`：

```ts
if (!r || r.status === "takedown") return NextResponse.json({ error: "unavailable" }, { status: 403 });
```
只挡 `takedown`。**`pending` 和 `hidden` 状态的资源，只要知道 resourceId 和 fileId 就能拿到签名下载链接**。这是把「允许」写成「非禁止」的典型后果。

新架构建议：`draft | pending | published | rejected | delisted` 五态 + `moderation_log(resourceId, fromStatus, toStatus, actorId, reason, createdAt)` 审计表；所有分发路径一律**白名单判定** `status === 'published'`（且 `licenseStatus` 不在禁发集合内），绝不写 `!== 'takedown'`。

### 3.3 评分 / 收藏 / 举报的主键与唯一约束

| 表 | 主键 | 唯一约束 | 评价 |
|---|---|---|---|
| `ratings` | **复合 PK `(resource_id, user_id)`** | 即主键本身 | **设计正确，保留**。一人一资源一评分靠 PK 天然保证，无冗余索引。缺陷：`score` 无 CHECK；无 `updatedAt`；PK 列序导致「某用户的评分」无索引 |
| `favorites` | **复合 PK `(resource_id, user_id)`** | 即主键本身 | 同上，**保留**。缺陷同样是 `(userId, createdAt)` 无索引，而个人主页收藏聚合是明确需求 |
| `reports` | `serial id`（代理键） | **无** | **有缺陷**。同一用户可对同一资源无限次举报；`resolved` 是 boolean 不是状态；无处理人/结论/申诉；只能举报 resource；无索引 |

新架构：
- ratings/favorites 沿用复合 PK 模式，并按此扩展新增的「感谢」（产品文档要求，legacy 没有）：`thanks(resourceId, userId)` 复合 PK。
- reports 改为**多态举报表**：`report(id, targetType pgEnum('resource'|'post'|'user'|'circle'), targetId, reporterId, kind pgEnum('copyright'|'broken'|'miscategorized'|'illegal'|'other'), reason, status pgEnum('open'|'reviewing'|'resolved'|'rejected'|'duplicate'), assigneeId, resolution, resolvedAt)`，并加 **partial unique index 防刷**：`UNIQUE (target_type, target_id, reporter_id) WHERE status = 'open'`（同一人对同一目标只能有一条未处理举报，处理完可再报）。`kind = 'copyright'` 直接连到 `takedown_request` 流程。

---

## 四、一句话总结落差

legacy 的 13 张表把「资源 → 文件 → 标签 → 互动」这条最短路径跑通了，**复合主键的互动表、slug 路由、预签名下载**三处可直接继承；但产品文档要求的四个新实体（**version / file 的外链镜像与上传状态 / circle / license**）在 legacy 中是零，**审核状态机、信任梯度、举报闭环、多语字段、原作关联**同样是零，`comments` 的 resourceId 硬绑还与 M4 的核心决策直接冲突。按上面的拆分，M3 的 `packages/db/src/schema/` 大致是 `resource.ts` / `version.ts`（含 file）/ `circle.ts` / `tag.ts`（含 event、touhou_work）/ `interaction.ts`（rating/favorite/thanks/download）/ `moderation.ts`（report/moderation_log/takedown_request/license_change_log）/ `content.ts`（topic/post，M4 共用）七个模块文件 + 已有的 `auth.ts` + 新增 `user-profile.ts`。