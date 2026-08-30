# M4 通知中心：设计先例与方案空间

2026-08-30 · 调研材料，**不是决定**

> 本文的 schema 与代码片段全部是**草案**，未经评审，**不得直接写进 `packages/` 或 `apps/`**。
> M3 时有 agent 把未评审草稿直接落库，含致命缺陷，整个 commit 被撤回（582d02c）。
>
> 本文遵循 M3 留下的方法论纠正：
> **库里没有数据时，「现在不建表以后要迁移」这个论证不成立。**
> 真正不可逆的只有 **已对外发出的 URL / slug** 与 **法律留痕**。其余一律 YAGNI。
> 本文只对一件事主张「必须现在决定」——**用户 handle**，因为它同时踩中这两条（进 URL、进已发布的帖子正文）。

---

## 0. 结论速览

| 议题 | 推荐 | 一句话理由 |
|---|---|---|
| 数据模型 | **一张宽表 `notification`，写扇出** | 每条通知都要存 per-user 的 `read_at`，那一行本来就躲不掉；再拆 event 侧表只省几十字节，却给最热的读路径加一次 join |
| subject 指向 | **类型化可空外键**（`topic_id` / `post_id` / `resource_id`）+ 极小 `payload jsonb` | 收件箱是列表读，要 join 出标题和楼层；`moderation_log` 那种多态 text id join 不了，会退化成 N+1 |
| 抑制噪音 | **`collapse_key` + 部分唯一索引 + upsert 累加** | 200 楼的主题对每个订阅者只产生 1 行未读。这一条把「回复即订阅太吵」整个问题消解掉 |
| 已读状态 | **`read_at timestamptz null`**，无水位线、无反范式计数 | 水位线与行级已读会成为两个真相源；反范式计数把每次扇出变成对收件人 profile 行的写，且一旦漂移永不自愈 |
| 产生时机 | **同请求同事务**，扇出 INSERT 放最后一步，用嵌套事务（SAVEPOINT）隔离其失败 | 与项目现有的 `moderationLog` 同事务写入一致；没有队列也不想要队列，outbox 是「带额外步骤的队列」 |
| @ 提及 | **给 `user_profile` 加不可自助修改的 `handle`**；解析在 `packages/shared` 的纯函数里，收发两侧共用 | `user.name` 是 `text NOT NULL` **不唯一、无字符约束、可随意改**——今天根本无法从正文里可靠地认出一个人 |
| 订阅语义 | 发帖即订阅 + 回复即订阅 + 显式订阅按钮；**取消订阅写 `muted` 行，不删行** | 删行的话下一次回复会立刻把订阅加回来 |
| 未读数 | **`read_at IS NULL` 的部分索引 + COUNT，上限 99+**；搭 `GET /api/me` 一起返回 | 部分索引只装未读行，用户读完索引自己就变小；`/api/me` 每个 SSR 页面本来就要打 |
| 清理 | `apps/api/scripts/gc-notifications.ts`，按龄删，带熔断 | 与 `gc-images.ts` / `reindex.ts` 同形；通知**不是**法律留痕，`moderation_log` 才是 |
| 推送渠道 | **只做站内，且不做实时**。邮件与 WebPush 明确不做 | 邮件的前置链是「邮箱验证 → 发信域名 DNS → 退订 → 退信处理」，那是一个独立里程碑，不是 M4 的一个勾选框 |

**预算：2 张新表**（`notification`、`topic_subscription`）+ `user_profile` 加 2 列 + **4 条新路由**（其中未读数搭车 `/api/me`，不占路由）。

对照一个「完整」的通知系统会长成什么样：`notification` / `notification_event` / `notification_inbox` / `notification_pref` / `notification_channel` / `notification_digest` / `push_subscription` / `email_delivery_log` / `mention` / `subscription` / `subscription_level` —— 11 张表。M3 的教训就是别走这条路。

---

## 1. 现状盘点：本项目已有什么、缺什么

调研代码后确认的事实（每一条都影响下面的选择）：

| 事实 | 出处 | 对通知的影响 |
|---|---|---|
| **没有队列、没有 redis 客户端、没有常驻 worker** | 全仓 grep `redis` 零命中；`apps/api/scripts/` 只有 4 个手动脚本 | 「事务后异步投递」没有承载体；任何 outbox 都需要新造一个轮询器 |
| **没有 markdown 渲染依赖** | `apps/web/package.json` / `apps/api/package.json` 均无 marked/remark/dompurify | @ 提及的抽取不能依赖 AST，除非 M4 同时引入解析器 |
| **没有邮件能力** | `auth.ts` 只有 `emailAndPassword: { enabled: true }`，无 `sendVerificationEmail` | 邮件通道是从零开始，不是「接一下」 |
| **`user.emailVerified` 默认 false 且无验证流程** | `packages/db/src/schema/auth.ts:8` | 现在往用户邮箱发信 = 往陌生人邮箱发信 = 域名进黑名单 |
| **`user.name` 是 `text NOT NULL`，不唯一、无字符集约束、用户可自由改** | `packages/db/src/schema/auth.ts:6` | **平台今天没有任何稳定、唯一、URL 安全的用户标识**。`@名字` 无法解析 |
| **`user_profile` 是我们自己的表**（角色、信任梯度都在这），`sessionMiddleware` 会惰性创建 | `apps/api/src/middleware/session.ts:29-43` | handle 应该加在这里，不动 better-auth 的表 |
| **`topic` / `post` 已按 M4 形状建好**，`topic.boardSlug` 预留，`post.parentId` 有自引用外键 | `packages/db/src/schema/content.ts` | 通知的两个主要 subject 已就位，无需改 |
| **`content/post.ts` 是唯一保留的 service，设计上就有两个调用方** | `apps/api/src/modules/content/post.ts:6-12` | 「发帖产生通知」的唯一正确挂点就是 `createPost()` 内部，两个视图自动都覆盖 |
| **楼层号靠对 `topic` 行 `UPDATE ... RETURNING` 原子自增取得，持行锁** | 同上 `:75-84` | 同事务扇出会延长这把锁的持有时间——所以**订阅者查询必须放在事务外** |
| **`moderation_log` 是跨实体审计，`subjectId` 是 `text` 不是外键**（为了硬删后记录仍在） | `packages/db/src/schema/kourindou.ts:414-441` | 「审核结果」通知的挂点候选就是每一处 `insert(moderationLog)` |
| **错误码是白名单常量数组，api 只返回 code** | `apps/api/src/errors.ts:11-24` | 新增的通知类错误码要进这个数组并补三语文案 |
| **`validate()` 包装 zValidator；`:id` 路由必须挂 `entityIdParam`** | 同上 `:51-81` | 通知 id 是 uuid → `entityIdParam`；订阅路由的 topic id 也是 uuid |

---

## 2. 数据模型

### 2.1 四个方案

#### A. 一张宽表 + 写扇出（推荐）

```sql
notification(id, user_id, kind, actor_id, topic_id, post_id, resource_id,
             collapse_key, count, payload jsonb, read_at, created_at)
```
每个收件人一行。

- **优点**：收件箱一次查询；未读数一次 COUNT；标记已读一次 UPDATE；没有 join 放大；清理是一条 DELETE。
- **缺点**：扇出 N 人写 N 行，重复存储 `kind/topic_id/...`（每行约 100–150 字节）。

#### B. 按类型分表（`notification_reply` / `notification_mention` / …）

- **优点**：列是类型化的，没有可空外键的「哪几列有值取决于 kind」。
- **缺点**：合并收件箱要 `UNION ALL` + 排序 + 分页（分页跨 UNION 是经典难题）；未读数要 N 次 COUNT；加一种通知就加一张表、一条路由分支、一段前端；清理脚本要写 N 遍。
- **判定**：**否**。这是把一个枚举字段展开成了表拓扑。真实世界里会这么做的只有超大规模按类型分片的场景，我们是零流量。

#### C. `notification_event` + `notification_inbox`（事件 + 收件箱）

```sql
notification_event(id, kind, actor_id, topic_id, post_id, payload, created_at)
notification_inbox(event_id, user_id, read_at)   -- pk(user_id, event_id)
```

- **优点**：扇出 500 人时是 1 条胖行 + 500 条瘦行，而不是 500 条胖行。
- **缺点**：收件箱的每一次读都要 join；两次 insert；清理要删两张表并处理孤儿 event；「折叠」（见 2.3）在两表结构下要同时改 event 和 inbox，复杂度翻倍。
- **判定**：**否，但理由要说准**。常见的误判是「C 更规范所以更好」。真正的判据是：

  > **无论选哪个方案，per-user 的 `read_at` 都必须有一行来装。**
  > 既然那一行本来就要付，event 侧表节省的只是那几十字节的冗余列，
  > 代价却是在**最热的读路径**（每次开收件箱、每次算未读数）上加一次 join。

  C 值得的临界点大约是「单次扇出 > 50 人且 payload 很胖」。本站点上线时论坛发帖量接近 0，一个主题的订阅者长期会是 1–20 人。等真的出现 500 人订阅的主题时，从 A 迁到 C 是一次 `INSERT ... SELECT`——那时候有数据了，但那也是一次可以离线做的迁移，不是不可逆决定。

#### D. 无表：水位线 + 读时聚合

`user_profile.notificationsReadUntil timestamptz`，收件箱 = 对源表（`post` join `topic_subscription`、`moderation_log`…）做 UNION 查询，`created_at > 水位线` 即未读。

- **优点**：零新表，零扇出，零清理。
- **缺点**：
  - 只能「全部已读」，无法单条已读、无法「这条新那条旧」；
  - 查询是多张源表的 UNION + 排序 + 分页，比 A 的单表扫描慢一个数量级，而且随着通知种类增加而线性变复杂；
  - **审核结果根本装不下**——「你的资源被拒绝」的收件人是 `resource.uploaderId`，但这不是一条可以按时间窗口扫出来的行为，得反查 `moderation_log` 再反查 subject 的 owner，且硬删之后 subject 没了；
  - `@提及` 要在读时重新解析所有帖子正文才能知道谁被提到——不可接受。
- **判定**：**否**。但值得记录，因为它是「最省」的极端，用来校准 A 的成本：A 的全部成本就是一张表和一个 GC 脚本。

### 2.2 subject 怎么指：多态 text id vs 类型化外键

项目里已有两种先例：

- `moderation_log.subjectKind + subjectId(text)`、`report.targetKind + targetId(text)` —— **多态**
- `resource.circleId`、`post.topicId` —— **类型化外键**

选哪个取决于访问模式：

| | 多态 text id | 类型化可空外键 |
|---|---|---|
| 引用完整性 | 无，会有悬垂指针 | 有，`on delete` 语义明确 |
| 列表页 join 出标题/楼层 | **做不到**，要按 kind 分组后逐类查 → N+1 | 一次 LEFT JOIN 全拿到 |
| 加一种 subject | 免费 | 加一列（**没有数据时是免费的**） |
| 适合 | 写多读少、逐条被人翻阅的审计行 | 读多、渲染成列表的行 |

`moderation_log` 选多态是对的：它是审计，硬删之后记录还得在，所以**故意**不要外键。收件箱是反的——它每次渲染都要显示「在《主题标题》的 12 楼」。

**推荐：类型化可空外键。** 具体三列：`topic_id` / `post_id` / `resource_id`，全部可空。

- `topic.resourceId` 与 `topic.boardSlug` 已经存在 → 前端能自己推出链接是 `/kourindou/:slug#post-12` 还是 `/shrine/t/:id#post-12`，**不需要在通知里存 URL**（存 URL 会在改路由时全部失效）。
- `on delete`：`post_id`/`topic_id`/`resource_id` 用 `cascade`。软删的楼层不会消失（`post.deletedAt` 是软删），所以正常情况通知仍指得到；只有 admin `purge` 才真的级联删除——那正好，指向已被硬删资源的通知也该消失。
- **例外，且这是最容易做错的一条**：`admin.ts` 的 `mode: 'purge'` 会级联删掉 `resource → topic → post`。如果「你的资源被站长删除」这条通知带了 `resource_id` 外键，它会**在同一个事务里被自己级联删掉**，作者永远收不到。所以硬删通知**必须不带外键，只在 payload 里存标题快照**。这与 `moderation_log.subjectId` 用 `text` 而非外键是同一条道理的两次应用。

### 2.3 折叠（collapse）：本设计里最高杠杆的一个决定

没有折叠：一个 200 楼的主题，对每个订阅者产生 200 行未读，收件箱变垃圾场，清理策略变成刚需，用户第一反应是关掉通知。

有折叠：**一个主题对一个用户最多 1 行未读**，内容是「有 37 条新回复」。

实现：

```ts
// 草案
collapseKey: varchar('collapse_key', { length: 96 }),   // 可空；null = 不折叠
count: integer('count').notNull().default(1),
// ...
uniqueIndex('notification_collapse_uq')
  .on(t.userId, t.collapseKey)
  .where(sql`${t.readAt} is null and ${t.collapseKey} is not null`)
```

```ts
await tx.insert(notification).values(rows).onConflictDoUpdate({
  target: [notification.userId, notification.collapseKey],
  // targetWhere 必须与索引谓词**逐字**一致，否则 PG 找不到这个 arbiter，
  // 报 "there is no unique or exclusion constraint matching the ON CONFLICT specification"
  targetWhere: sql`read_at is null and collapse_key is not null`,
  set: {
    count: sql`${notification.count} + 1`,
    actorId: sql`excluded.actor_id`,
    postId: sql`excluded.post_id`,
    createdAt: sql`now()`,      // 冒泡到收件箱顶部
  },
})
```

几个必须写在设计文档里的性质：

1. **索引是部分的（`WHERE read_at IS NULL`）**，所以「已读之后再来新回复」会新建一行——这正是想要的行为，而不是永远只有一行。
2. **`collapse_key IS NULL` 的行永不冲突**（PG 的唯一索引里 NULL ≠ NULL），所以「不折叠的种类」不需要任何额外分支。谓词里再写一遍 `collapse_key is not null` 只是为了索引更小。
3. **`createdAt` 被推前**会让这一行在收件箱里跳到最上面。副作用是它会「逃出」下面 6.2 说的 `before` 游标——而这恰好是对的：有新动静就该保持未读。
4. **哪些种类折叠**：

| kind | collapse_key | 理由 |
|---|---|---|
| `reply`（有人回复了我的楼层） | `reply:<topicId>` | 5 个人回我同一楼 → 「5 人回复了你」 |
| `topic_reply`（我订阅的主题有新回复） | `sub:<topicId>` | 这条是折叠的主战场 |
| `mention` | **null** | @ 是点名，每一次都要单独看见 |
| `moderation`（审核/下架/许可变更结果） | **null** | 每条都是对用户有行动含义的独立决定；数量天然极少 |
| `mod_queue`（有新待审 / 新举报，发给 staff） | `queue:resource` / `queue:report` | 站长只需要知道「有 7 件待办」 |

  （折叠 `moderation` 的诱惑是「拒绝后又通过，只显示最新状态」。**不建议**：那会把拒绝理由吞掉，而拒绝理由是用户唯一能据以改进的信息。状态历史在 `moderation_log` 里，但用户看不到它。）

5. **同一条 post 对同一个人只产生一条通知**：一个人既是父楼作者、又是订阅者、又被 @，必须去重。优先级 `mention > reply > topic_reply`，在扇出辅助函数里统一裁决，**不在各调用点各写一遍**。

### 2.4 已读状态

- **`read_at timestamptz NULL`**。比布尔多存一个时间戳是免费的，而且它是未来「10 分钟没读就发邮件」的唯一前置。
- **不要水位线**（`user_profile.readUntil`）：一旦有两个真相源，「在水位线之前创建、但在水位线更新之后才可见的行」会天生已读。水位线唯一的优势是「全部已读」时不用 UPDATE N 行——而我们有上限（见 §7），N 天然有界。
- **不要反范式 `unreadCount`**。这是本设计里最典型的「看起来更快其实更糟」：
  - 它把每一次扇出变成对**每个收件人 profile 行**的 UPDATE → 同一个热门用户的所有通知在他那一行上串行；
  - 它要在插入、折叠、单条已读、全部已读、GC 删除五个地方同步维护，漏一个就永久漂移；
  - 部分索引 COUNT 是自愈的，计数器不是。

### 2.5 表草案（**未评审，不得进仓库**）

```ts
// 草案 · packages/db/src/schema/shrine.ts（示意）
export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KIND)
// NOTIFICATION_KIND = ['reply','topic_reply','mention','moderation','mod_queue']

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 收件人。用户被删则通知一起走 */
    userId: text('user_id').notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    /** 触发者。删号不该抹掉「你被回复过」这件事 —— 与 resource.uploaderId 同理 */
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),

    topicId: uuid('topic_id').references(() => topic.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => post.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').references(() => resource.id, { onDelete: 'cascade' }),

    /** null = 不折叠 */
    collapseKey: varchar('collapse_key', { length: 96 }),
    count: integer('count').notNull().default(1),

    /**
     * 只放枚举 key 与数字，**永不放句子、永不放人名**。
     * 站内文案由 web 侧 Paraglide 按 kind 组装；存了中文句子的话，
     * 用户切到 ja 会看到一个永远是中文的收件箱。
     * 唯一例外：subject 会被硬删的场景（purge），此时存标题快照——
     * 那是专有名词不是待翻译文本，且与 moderation_log.subjectId 用 text 同理。
     */
    payload: jsonb('payload').$type<NotificationPayload>().notNull().default({}),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** 收件箱主查询 */
    index('notification_user_created_idx').on(t.userId, t.createdAt.desc()),
    /** 未读数：部分索引只装未读行，用户读完索引自己就缩小 */
    index('notification_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
    uniqueIndex('notification_collapse_uq')
      .on(t.userId, t.collapseKey)
      .where(sql`${t.readAt} is null and ${t.collapseKey} is not null`),
  ],
)

export const subscriptionState = pgEnum('subscription_state', SUBSCRIPTION_STATE)
// SUBSCRIPTION_STATE = ['watching','muted']

export const topicSubscription = pgTable(
  'topic_subscription',
  {
    topicId: uuid('topic_id').notNull()
      .references(() => topic.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    state: subscriptionState('state').notNull().default('watching'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.userId] }),
    /** 「我订阅的主题」列表 */
    index('topic_subscription_user_idx').on(t.userId),
  ],
)
```

`user_profile` 增补两列（见 §4）：

```ts
/** 小写存储、全局唯一、进 URL、进帖子正文 —— 因此是本 milestone 唯一「必须现在决定」的东西 */
handle: varchar('handle', { length: 20 }).unique(),
/** null = 还没自选过，可以改一次；非 null = 锁定，只有站长能代改 */
handleSetAt: timestamp('handle_set_at', { withTimezone: true }),
```

---

## 3. 产生时机

本项目**没有队列，也不想要队列**。方案空间因此只有四个：

| 方案 | 丢通知 | 重通知 | 发帖延迟 | 新增基础设施 |
|---|---|---|---|---|
| **① 同请求、同事务** | 不会 | 不会 | +1 次 INSERT | 无 |
| ② 同请求、事务提交后 | 会（提交与投递之间崩溃） | 会（重试时） | +1 次 INSERT | 无 |
| ③ outbox 表 + 轮询脚本 | 不会 | 需要幂等键 | 无 | **一个轮询器 = 带额外步骤的队列** |
| ④ 真队列 | — | — | — | 明确不要 |

M3 已经就同一个问题做过判决：`search_outbox + worker` 被砍掉，理由是「三位数的量级，改为提交后 try/catch 推 Meili + 每晚全量重建」。通知没有「每晚全量重建」这个兜底——通知是不可重算的（重算「谁在什么时候被回复了」需要重新遍历全部帖子并且没法知道已经发过没有），所以 ② 的丢失是**永久且不可察觉**的。

**推荐 ①：同请求、同事务。** 落点：

```ts
// 草案 · content/post.ts 的 createPost 内部
export async function createPost(input: {...}) {
  // ---- 事务外：所有只读的解析与查库都在这里做 ----
  // 理由：楼层号靠 `UPDATE topic ... RETURNING` 原子自增，那个 UPDATE 持行锁，
  //       整个主题的并发发帖在此串行化。把 SELECT 塞进事务 = 延长全局锁。
  const mentioned = extractMentions(input.bodyMd)              // 纯函数，无 IO
  const mentionedIds = await resolveHandles(mentioned)          // 1 次 SELECT
  const subscriberIds = await watchersOf(input.topicId)         // 1 次 SELECT
  const parentAuthorId = parent?.authorId ?? null               // 已有的 parent 查询里顺带取

  return await db.transaction(async (tx) => {
    const [t] = await tx.update(topic).set({ postCount: sql`... + 1`, ... })...
    const [created] = await tx.insert(post).values({ floor: t.floor, ... }).returning()

    // 回复即订阅。**DO NOTHING 而非 DO UPDATE** —— 见 §5
    await tx.insert(topicSubscription)
      .values({ topicId: input.topicId, userId: input.authorId })
      .onConflictDoNothing()

    // ---- 扇出放最后一步，并用嵌套事务（SAVEPOINT）隔离它的失败 ----
    try {
      await tx.transaction(async (tx2) => {
        await fanOut(tx2, { ... })
      })
    } catch (e) {
      // 通知写失败不该让发帖失败。但要留下痕迹，否则是静默丢失。
      console.error('[notify] fan-out failed', e)
    }

    return { ok: true, id: created.id, floor: t.floor }
  })
}
```

关于 SAVEPOINT 的取舍要说清楚：

- **不用**（纯同事务）：更简单，且失败模式基本可以用 schema 消掉——收件人外键 `on delete cascade`、折叠走 upsert、扇出列表有上限。剩下的唯一真实风险是「读到订阅者列表之后、插入之前那个人被硬删」→ 外键违例 → 整个发帖 500。删号是站长手动操作，撞上的概率接近零。
- **用**（drizzle 的 `tx.transaction()` 就是 SAVEPOINT）：多五行代码，换来「通知子系统的任何 bug 都炸不掉发帖」。

**建议**：扇出（收件人数量可变、写的是别人的行）用 SAVEPOINT 包住；单收件人的审核结果通知直接同事务写，不包——它和旁边那条 `moderationLog` 是同一份事实，要么都在要么都不在。

**明确不做**：数据库触发器（业务规则藏进 DDL，与「状态机只有一个真相源」的项目约定冲突）、`LISTEN/NOTIFY`（需要常驻监听进程 = 回到队列）。

---

## 4. @ 提及

### 4.1 先说结论性发现：现在根本没法可靠解析

```ts
// packages/db/src/schema/auth.ts:6
name: text('name').notNull(),
```

`user.name` **不唯一、无长度上限、无字符集约束、用户可随时改**。于是：

- `@霧雨魔理沙` 可能对应 0 个、1 个或 17 个用户；
- CJK 没有词边界，`@魔理沙的帖子` 里名字在哪结束是无解的；名字本身还能含空格、`@`、换行；
- 任何人都能把自己改名成 `@管理员` 实施冒充；
- 就算某次解析对了，对方改名之后旧帖里的那个 `@` 就指错人了。

所以 @ 提及的第一个问题不是「怎么解析」，而是**「解析什么」**。

### 4.2 方案空间

#### 方案 1：给 `user_profile` 加 `handle`（推荐）

- `handle varchar(20) unique`，正则 `^[a-z0-9_]{2,20}$`（**纯 ASCII**），小写存储。
- 显示名（`user.name`）保持自由：日文、中文、emoji 随便用，改名随便改。
- 提及语法 `@handle`，有干净的终止边界（非 `[a-z0-9_]`）。
- 页面 URL `/u/:handle`。

**这是本 milestone 唯一一件「必须现在决定」的事**，因为它同时命中 M3 定义的两条不可逆：它会出现在**已对外发出的 URL** 里，也会被写进**已发布帖子的正文**里。改语法或改字符集就要重写历史正文。

**改名之后旧提及怎么办**——三种做法：

| 做法 | 机制 | 代价 |
|---|---|---|
| a. handle 可改 + 存 mention 侧表（post_id, user_id） | 正文里的 `@old` 渲染时靠侧表换成当前 handle | 多一张表；正文与渲染结果分离，编辑时会看到不一致 |
| b. handle 可改 + 正文规范化为 `@[handle](user:<id>)` | id 进正文，天然抗改名 | 正文不再是人写得出来的 Markdown；脱离编辑器就没法 @；导出/迁移时是私有语法 |
| **c. handle 不可自助修改（推荐）** | 渲染时按 `@handle` 现查现渲染 | 零额外存储、零额外表、正文永远是人类可读的 Markdown |

  推荐 c，配套两条规则：
  - 新用户可以**自选一次**（`handleSetAt IS NULL` 时可设），设完锁定；
  - 站长可代改（冒充、骚扰场景），走 `moderationLog`；
  - **释放的 handle 永不回收**——否则旧帖里的 `@marisa` 会在某天突然指向另一个人。这是一列 `retired_handle` 或者干脆「改过的旧 handle 保留一行占位」；最省的做法是站长代改时把旧值写进 `moderation_log.fromValue`，并**不删除**唯一约束占位（实现细节留给设计阶段）。
  - handle 被站长改掉后，旧帖里的 `@oldhandle` 解析不到 → 渲染为纯文本。这是**期望行为**，不是 bug。

**handle 怎么产生**（未决，见 §11 开放问题）：`sessionMiddleware` 现在惰性创建 `user_profile` 且没有 handle 概念。候选：
  - 创建时生成 `u` + 8 位随机 base32，冲突重试 ≤3 次；用户可自选一次覆盖；
  - 或从 `user.name` slugify，CJK 名字会得到空串 → 回落随机。
  - 保持 `handle` 可空 + 首次发帖前强制设置：多一个引导步骤，摩擦最大，不推荐。

**保留字**：`admin` `moderator` `staff` `system` `official` `all` `everyone` `here` `me` `new` `edit` `login` `register` `api` `u` `shrine` `kourindou` `chronicle` `spellcard` `music` `gensokyo` …；`/u/:handle` 路由与 handle 命名空间共用，不设保留字会撞路由。

#### 方案 2：不加 handle，提及靠编辑器插入 `@[显示名](/u/<userId>)`

Slack 式（它存 `<@U123>`）。零 schema 变更，解析 100% 准确，改名无影响。

**代价**：
- 正文不再是人手写得出来的 Markdown——没有编辑器就 @ 不了人（e2e 脚本、未来的第三方 API 客户端、手机上粘贴文本都不行）；
- 用户看到的和存的不一样，编辑已有帖子体验割裂；
- 而且平台**迟早还是需要** `/u/:handle` 这样的个人主页 URL（产品文档明确要「个人主页（帖子+资源+收藏聚合）」），到时候 handle 还是得加，只是晚加而且要为存量用户批量生成。

**判定**：技术上成立，但它把一件迟早要做、而且越晚做越贵的事推后了。不推荐。

### 4.3 解析规则（方案 1 之下）

抽取器必须放在 `packages/shared`，因为**发通知的一端和渲染链接的一端必须逐字一致**——两边不一致的话，用户会收到「你被提及」但帖子里没有链接，或者反过来。这是项目「类型主轴 = 单一事实来源」原则在文本上的应用。

```ts
// 草案 · packages/shared/src/shrine/mention.ts
/** 代码块里的 @ 不是提及。这个预处理不完美（未闭合的 fence 会误伤），
 *  但失败模式是「少发一条通知」或「多发一条给不存在的 handle」，都无害。 */
const stripCode = (md: string) =>
  md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')

/**
 * 前置断言排除 邮箱(foo@bar) 与 URL(x.com/@marisa) 与 @@；
 * 后置断言避免把 21 字符以上的串截成一个合法前缀。
 */
const MENTION_RE = /(?<![\p{L}\p{N}_/@.])@([A-Za-z0-9_]{2,20})(?![\p{L}\p{N}_])/gu

export function extractMentions(md: string, limit = 10): string[] {
  const seen = new Set<string>()
  for (const m of stripCode(md).matchAll(MENTION_RE)) {
    seen.add(m[1]!.toLowerCase())
    if (seen.size >= limit) break
  }
  return [...seen]
}
```

关键性质：**解析可以偏宽松，因为抽取结果必须再过一次「这个 handle 是否存在」的查库**。不存在就什么都不发生。这条安全网让正则的不精确变得可以容忍——不必为此引入 Markdown AST 依赖。

（如果 M4 最终引入了 markdown 解析器做服务端渲染/消毒，届时把抽取改成「只遍历 text 节点」是纯升级，接口不变。）

### 4.4 防 @ 轰炸

| 手段 | 建议 | 说明 |
|---|---|---|
| **每帖提及人数上限** | **10，超出直接拒绝** | 静默截断会让一次真诚的 12 人点名悄悄丢 2 个。拒绝是响亮的、可纠正的。需新增错误码 `mention_limit_exceeded` 进 `ERROR_CODES` 并补三语文案 |
| **不 @ 自己** | 在扇出辅助函数里统一过滤 `actorId` | 不要在每个调用点各写一遍 |
| **一帖对一人只发一条** | 优先级 `mention > reply > topic_reply` | 见 §2.3 第 5 点 |
| **`@all` / `@everyone`** | 列入保留字，永不解析 | 保留字表顺带解决 |
| **每小时提及配额** | **M4 不做**，记录做法备用 | `SELECT count(*) FROM notification WHERE actor_id=$1 AND kind='mention' AND created_at > now() - interval '1 hour'`，需要 `(actor_id, created_at)` 索引。上线时靠「每帖上限 + 信任梯度 + 发帖限流」已足够 |
| **编辑帖子时的重复提及** | 只对**新增**的 handle 发通知 | 取新旧 `extractMentions()` 结果的差集。不做的话，改一个错别字会把所有人重新 @ 一遍。M4 若引入 `PATCH /posts/:id` 就必须做（现在只有 DELETE） |

---

## 5. 订阅语义

### 5.1 触发点

| 事件 | 是否订阅 | 说明 |
|---|---|---|
| 发起主题 | **是** | 无争议 |
| 回复主题 | **是**（`ON CONFLICT DO NOTHING`） | 见下方「为什么这次不吵」 |
| 点显式「关注」按钮 | **是** | 一个 PUT，同一张表 |
| 收藏资源 | **否** | 收藏 = 「我要下载它」，订阅 = 「跟我说这里有人说话」。产品语义不同，耦合了就没法拆。日后想联动就在收藏对话框加个勾选框 |
| 给资源评分 | **否** | 同上 |

**「回复即订阅」在传统论坛是收件箱噪音的头号来源**——Discourse 为此发明了 watching / tracking / normal / muted 四级。本设计不需要那四级，因为 §2.3 的折叠已经把成本压到了「一个主题一行未读」。这是一个真实的结构性差异，值得写进设计文档：**先有折叠，才敢默认回复即订阅**。

### 5.2 取消订阅：必须写 `muted` 行，不能删行

```ts
// 取消订阅
await db.insert(topicSubscription)
  .values({ topicId, userId, state: 'muted' })
  .onConflictDoUpdate({ target: [...], set: { state: 'muted' } })
```

如果取消订阅是 `DELETE`，那么用户下一次在这个主题里回复，「回复即订阅」会立刻把他加回来——用户会认为取消订阅坏了。因此 `state` 是两值枚举而不是「行存在与否」。这也是为什么 5.1 里回复时的 upsert 必须是 **`DO NOTHING`**：`DO UPDATE state='watching'` 会把 muted 顶掉，等价于同一个 bug。

### 5.3 查询订阅者：白名单

```ts
// 对：白名单
.where(and(eq(topicSubscription.topicId, id), eq(topicSubscription.state, 'watching')))
// 错：黑名单 —— CLAUDE.md 明令禁止的写法，将来加 'digest_only' 状态时会漏
.where(ne(topicSubscription.state, 'muted'))
```

扇出查询要带 `LIMIT`（比如 500）作为绝对上界，超出就记一条日志。零流量时永远撞不到，但它是防止某天一个主题被机器人订阅一万次拖垮发帖的唯一闸门。

### 5.4 明确不做

- **版块级订阅**（订阅「二创工坊」的所有新主题）：6 个版块、上线时流量近 0，站长本来就要看全部。折叠机制在场，日后加一张 `board_subscription` 是纯 additive，无数据即无迁移成本。
- **订阅等级（watching / tracking / normal）**：折叠已经解决了它要解决的问题。
- **忽略某个用户 / 屏蔽**：治理手段，不是订阅语义，且平台还没有需要它的人口规模。

---

## 6. 未读数

### 6.1 怎么算

```sql
-- 部分索引 notification_unread_idx (user_id) WHERE read_at IS NULL 直接命中
SELECT count(*) FROM (
  SELECT 1 FROM notification
  WHERE user_id = $1 AND read_at IS NULL
  LIMIT 100
) t;
```

三个性质：

1. **部分索引只装未读行**。用户读完，行就从索引里消失——索引尺寸自然跟着「未读量」走，而未读量天然有界（人会去读）。这是为什么不需要计数器。
2. **`LIMIT 100` 把最坏情况钉死**。前端显示 `99+`，数据库最多扫 100 个索引项，与用户历史通知总量无关。
3. **不做反范式计数器**，理由见 §2.4。

### 6.2 挂在哪里

`apps/api/src/modules/me.ts` 目前只有一个 `GET /`，而 web 的 root loader 每个 SSR 页面都会打它。

**推荐：未读数搭 `GET /api/me` 的车返回**，不新开端点。

```ts
// 草案
return c.json({
  user: { id, name, handle, role, approvedResourceCount, strikeCount },
  unread,          // 已在 100 处截断
})
```

好处：每个 SSR 页面零额外 HTTP 往返；坏处：未登录时白算——加一个 `if (!actor)` 即可。

### 6.3 标记已读

一条路由搞定两种语义：

```
POST /api/notifications/read   { ids?: string[] }  |  { before?: string /* ISO 时间 */ }
```

- `ids`：点开某条时标记。
- `before`：**「全部已读」用游标而不是 `all: true`**。理由：用户点「全部已读」的那一刻，页面上显示的最新一条是 T；如果用 `all`，在 T 之后、点击之前刚到的那条会被标记成已读而用户从没见过它。传 `before = T` 就没有这个洞。
  - 与 §2.3 第 3 点的联动：被折叠更新过的行 `createdAt` 会被推到 `now()`，自动越过游标保持未读——正确。

```sql
UPDATE notification SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND created_at <= $2;
```
命中同一个部分索引，更新行数有界。

---

## 7. 清理策略

通知会无限增长，但**折叠已经把增长率压掉了一个数量级**（订阅通知从「每楼一行」变成「每主题一行」）。剩下的靠按龄删。

**推荐：`apps/api/scripts/gc-notifications.ts`，与 `gc-images.ts` / `reindex.ts` 同形——手动/系统 cron 触发的幂等脚本，不是应用内的常驻任务。** 这是项目已有的、明确的定式（CLAUDE.md：「dev 依赖跑原生进程，不用容器」「未引用图片由脚本白名单巡检清理」）。

```sql
-- ① 已读的，30 天后删
DELETE FROM notification WHERE read_at IS NOT NULL AND read_at < now() - interval '30 days';
-- ② 未读的，180 天后也删（半年没登录的人，那条未读没有意义了）
DELETE FROM notification WHERE read_at IS NULL AND created_at < now() - interval '180 days';
```

配套（照抄 `gc-images.ts` 的形状）：

- **熔断**：先 `count(*)`，如果本次将删除的比例超过总量的某个阈值（比如 50%）就打印并退出，要求显式 `--force`。防止某天写错间隔把整张表清空。`gc-images.ts:81` 的熔断就是这么写的，且它注释里记了那次差点全删的真实 bug。
- **`--dry` 开关**（与 `gc:images` 同名同语义：`bun run gc:notifications -- --dry`）。
- **分批 DELETE**（`... WHERE id IN (SELECT id ... LIMIT 5000)` 循环），避免一次锁太多行。

明确记录一句，防止日后被人误解成合规问题：

> **通知不是法律留痕。** 版权争议时的证据链在 `moderation_log`（它的 `subjectId` 是 `text` 不是外键，正是为了硬删后仍在）。通知只是「这件事有没有告诉过用户」的送达副本，可以放心按龄删。

**评估过但不推荐的替代**：

- **按人数上限保留最近 N 条**（窗口函数 + `row_number()`）：更精确但 SQL 复杂，且折叠之后单人通知量本来就不大。留作日后需要时的备选。
- **打开收件箱时顺手删自己的旧通知**（自清理，零 cron）：确实优雅，代价是把 DELETE 塞进用户的读路径，而且不活跃用户永远清不到。**不推荐作为主方案**，但如果站长不想维护 cron，它是一个可接受的退路。

---

## 8. 推送渠道

### 8.1 站内：做，但不做实时

- **做**：收件箱页 + 顶栏未读徽标。徽标随 SSR 导航自然更新（`/api/me` 已经每页打一次）。
- **不做实时**。三个选项的代价：

| 方案 | 代价 |
|---|---|
| 轮询 `GET /api/notifications/unread` | 最便宜。若要做：60 秒间隔、`document.visibilityState === 'visible'` 才轮询、`ETag`/`304`。但零用户时它纯粹是给数据库加恒定负载 |
| **SSE** | hono 写起来很容易，**陷阱在部署**：每个在线用户占一条常驻连接；一旦 api 跑两个进程，A 进程的发帖无法推给连在 B 进程上的用户——需要跨进程 pub/sub，也就是需要 redis 客户端（现在没有）。「本地好用、上线扩容即坏」是最贵的一类技术债 |
| WebSocket | 同上，且更重 |

  **建议：M4 完全不做实时。** 需要的时候，轮询是三行代码的增量；SSE 要等到确实有并发用户、且确定 api 的进程模型之后再谈。

### 8.2 邮件：**明确不做**，并且要把「为什么不是一个勾选框」写清楚

前置链条（每一环都是硬门槛）：

1. **邮箱验证**。现在 `auth.ts` 只有 `emailAndPassword: { enabled: true }`，没有 `sendVerificationEmail`，`user.emailVerified` 默认 `false`。往未验证邮箱发通知 = 有人拿别人的邮箱注册，之后每条通知都变成发给陌生人的垃圾邮件 → 发信域名进黑名单。
2. **发信域名 + DNS**（SPF / DKIM / DMARC）+ 一个事务邮件服务商。
3. **退订**。通知邮件属于可退订类，需要 `List-Unsubscribe` 头与一键退订落地页，还需要一张 `notification_pref(user_id, kind, in_app, email)`。
4. **退信与投诉处理**（bounce / complaint webhook），否则硬退信累积会让发信信誉持续下滑。
5. **节流与摘要**：即时邮件对论坛通知几乎必然过量，实际要做的是「10 分钟未读 → 攒一封摘要」，那需要一个定时任务和「上次摘要发到哪」的水位线。

这五条加起来是一个独立里程碑。**M4 的正确动作是：什么都不加。** 按 M3 方法论，`notification_pref` 这张表现在建也是空的，等真做邮件时 `rm -rf drizzle && generate && migrate` 是零成本。唯一要保证的是 `read_at` 存在（第 5 条要用它），而它本来就在。

**一个必须承认的产品缺口**：审核拒绝通知，对一个刚投稿就被拒的新用户，可能是他唯一会看到的反馈——而新用户往往不会再回站。但这个缺口的正确解法不是邮件，而是**投稿完成页就把「进了审核队列 / 预计多久 / 从哪看结果」讲清楚**，加上信任梯度让老用户根本不进队列。

### 8.3 WebPush：**明确不做**

需要 VAPID 密钥对、Service Worker、`push_subscription` 表、逐浏览器的权限弹窗（拒绝一次基本就永久拒绝了）、订阅过期与 410 清理循环。零用户时收益为零，且它是纯 additive，日后加不影响任何既有结构。

### 8.4 三语（这条容易被忽略，但会毁掉整个功能）

CLAUDE.md：「api 不返回人类可读消息」「代码里一律 `m.key()`，不写裸字符串」。通知的推论是：

> **`payload` 里只能有枚举 key、id 和数字，绝不能有句子，也不能有人名。**

- 句子：存了「魔理沙回复了你的帖子」，用户切到 `/ja` 会看到一个永远是中文的收件箱。文案由 web 侧按 `kind` 用 Paraglide 组装，参数是 `count` / `actorName` / `title`。
- 人名与标题：**join 出来，不要快照**。存了快照，对方改名之后收件箱里还是旧名字。
  （唯一例外仍然是 §2.2 说的硬删场景。）

需要的消息 key 大致：`notif_reply` / `notif_reply_multi` / `notif_topic_reply` / `notif_mention` / `notif_moderation_approve` / `notif_moderation_reject` / `notif_moderation_delist` / `notif_moderation_license` / `notif_moderation_delete` / `notif_report_resolved` / `notif_role_change` / `notif_queue_pending` / `notif_queue_report`，各 3 份。

---

## 9. 审核结果通知挂在哪一步

任务要求特别看清 `moderation.ts` 现在怎么写 `moderationLog`，以及通知挂哪里不漏不重。

### 9.1 现有写入方式

`apps/api/src/modules/moderation.ts:100-129`，`POST /moderation/resources/:id/review`：

```ts
await db.transaction(async (tx) => {
  await tx.update(resource).set({ status: to }).where(eq(resource.id, id))
  if (row.uploaderId) { /* approvedResourceCount++ 或 strikeCount++ */ }
  await tx.insert(moderationLog).values({
    actorId: actor.id, action: 'review',
    subjectKind: 'resource', subjectId: id,
    fromValue: { status: row.status },
    toValue: { status: to, decision: input.decision },
    rejectReason: input.rejectReason, reason: input.note,
  })
})
```

三个对通知有利的既有性质：

1. **状态更新、信任计数、审计日志已经在同一个事务里**——通知加进去是自然延伸，不引入新的一致性模型。
2. **`row` 已经在手**（含 `uploaderId`），不需要为通知再查一次库。
3. **`row.uploaderId` 可空**（`onDelete: 'set null'`），代码里已经有 `if (row.uploaderId)` 的判空先例——通知照抄。

**推荐挂点：紧跟在 `insert(moderationLog)` 之后，同一个事务内。**

> 统一规则：**每一处 `insert(moderationLog)` 就是一个通知挂点候选。**
> `moderation_log` 本来就是「谁对谁做了什么」的跨实体记录；其中每一条「subject 有归属人且归属人 ≠ actor」的，正好就是一条该发的通知。

（诱惑：写个脚本轮询 `moderation_log` 的新行来扇出。**否**——那就是 outbox，M3 已经就 `search_outbox` 判过一次。挂点显式写在调用处，靠下面这张清单保证不漏。）

### 9.2 全部 `moderationLog` 写入点逐条裁决

| # | 位置 | action | 收件人 | 通知？ |
|---|---|---|---|---|
| 1 | `moderation.ts` `POST /resources/:id/review` | `review` | `row.uploaderId` | **是**（approve / reject + rejectReason + note） |
| 2 | `moderation.ts` `POST /reports/:id/resolve` | `report_resolve` | `report.reporterId` | **是**——产品文档要求「举报-处理-申诉闭环」，举报人不被告知的话闭环第一环就断了。当前代码 `SELECT * FROM report` 已拿到 `reporterId`，零额外查询 |
| 3 | `kourindou/index.ts` `POST /resources/:id/status` | `status_change` | `row.uploaderId` | **是，且这是最容易漏的一条**——见 9.3 |
| 4 | `kourindou/index.ts` `PATCH /resources/:id/license` | `license_change` | `row.uploaderId` | **是**（当 actor ≠ uploader）。许可状态是版权生死线字段，被别人改了必须知道 |
| 5 | `kourindou/index.ts` `PATCH /resources/:id`（已发布资源被编辑的审计） | `status_change` | — | **否**。actor 通常就是作者本人；staff 代编辑属边界情况。顺带记一笔既有小债：这条日志名不副实——它记的是「编辑」却写成 `status_change`，跟真正的状态变更混在同一个 action 里，日后按 action 过滤审计会串味 |
| 6 | `admin.ts` `PATCH /users/:id/role` | `role_change` | 被授权的用户 | **是**。「你成为了版主」，一行代码的产品体验 |
| 7 | `admin.ts` `DELETE /resources/:id`（soft / purge） | `soft_delete` / `hard_delete` | `resource.uploaderId` | **是，且实现上有坑**——见 9.4 |
| 8 | `admin.ts` `PATCH /config` | `config_change` | 无（subject 是 `site`） | **否** |

另外两个**不写 `moderationLog` 但该发通知**的地方（说明「挂在 moderationLog 旁边」这条规则是必要不充分的）：

| # | 位置 | 通知 | 说明 |
|---|---|---|---|
| 9 | `kourindou/index.ts` `POST /resources/:id/submit` 落到 `pending` 时 | 发给全体 **staff**：`mod_queue`，collapse_key `queue:resource` | solo 运营下这是「站长不用天天刷后台」的关键。折叠成一行「7 件待审」 |
| 10 | `interactions.ts` `POST /reports` 插入 `report` 后 | 发给全体 **staff**：`mod_queue`，collapse_key `queue:report` | 同上 |

### 9.3 「不会漏」：`/status` 这条支线

`kourindou/status.ts` 的状态机：

```ts
const ALLOWED = { draft: ['pending','published'], pending: ['published','draft'],
                  published: ['delisted'], delisted: ['published'] }
const STAFF_ONLY = ['pending->published', 'pending->draft', 'delisted->published']
```

`pending -> published` 是 **staff 允许**的跃迁。也就是说 staff 可以走 `POST /resources/:id/status` 把一个待审资源直接发布，**完全绕开 `/review`**。

后果分两层：

- **对通知**：只把通知挂在 `/review` 上，这条路径下作者收不到任何结果通知。所以 #3 必须挂。
- **顺带发现的既有不一致（不属于本次任务，但应报给站长）**：走 `/status` 的 `pending -> published` 不会给作者 `approvedResourceCount += 1`，也不会写 `action: 'review'` 而是 `status_change`。于是**同一个业务动作（通过审核）有两条路径，只有一条推进信任梯度**。审核台 UI 现在用哪条？如果日后有人为了方便在后台加了个「直接发布」按钮走 `/status`，信任梯度会静默失效。

### 9.4 「不会重」：三个真实的重复来源

1. **共享 helper + 调用点各写一次**。若把通知塞进一个被 `/review` 与 `/status` 共用的 `changeStatus()` 里，而两处又各自保留了自己的 `insert(moderationLog)` 与通知调用，就会双发。
   → 规则：**通知与 `moderationLog` 一一对应，写在同一个语句块里，不抽公共层。**
2. **actor 就是收件人**。`/status` 里作者自助下架（`published -> delisted` 不在 `STAFF_ONLY`，作者本人可以走——这是产品硬约束）会给自己发「你的资源被下架了」。
   → 规则：`if (recipientId && recipientId !== actor.id)`，**在扇出辅助函数里统一判**，不在各调用点重复。
3. **重复提交 / 客户端重试**。
   - `/review` 已经有守卫：`if (row.status !== 'pending') return fail(c, 'invalid_state_transition', 409)`，第二次调用打不进来。**这是现成的幂等闸门。**
   - `/status` 没有等价守卫：`delisted -> published -> delisted -> published` 每次都合法、每次都发通知。这是正确行为（每次都是真实事件），但意味着 staff 反复切换会刷屏。可接受；若要收敛，做法是给 `moderation` 类也加 collapse_key，代价是会吞掉拒绝理由（§2.3 已论证不做）。

### 9.5 调研中顺带发现的一个既有缺口（与通知无关，但应报）

`admin.ts` 的 `POST /resources/:id/restore`（`:153-168`）**完全不写 `moderationLog`**。恢复一个被软删的资源是站长特权动作，旁边的 `DELETE` 写了审计、`PATCH /config` 写了审计，唯独 restore 没有。审计链上是个洞。

---

## 10. 路由与契约草案

```
GET    /api/notifications              ?page&pageSize&unread=true   收件箱
POST   /api/notifications/read         { ids? } | { before? }        标记已读
PUT    /api/shrine/topics/:id/subscription   { state: 'watching'|'muted' }
DELETE /api/shrine/topics/:id/subscription   （= state:'muted' 的糖，可省）
```

未读数**不占路由**，搭 `GET /api/me` 返回。合计 **3–4 条**。

对照 M3 踩过的坑逐条自查：

| M3 的坑 | 本设计怎么避 |
|---|---|
| `.partial()` 不移除 `.default()` | 通知这边没有更新型 schema（只有「标记已读」和「设订阅状态」两个全量小对象）。**但 handle 的自选表单是一个 PATCH**，若与其他 profile 字段合并成一个更新 schema，必须逐字段重建 |
| id 分三种 | `notification.id` / `topic.id` = `entityIdSchema`(uuid) → 挂 `entityIdParam`；`user_id` / `actor_id` = `userIdSchema`（32 位随机串，**不是 UUID**）；`handle` 是第四种形状，接近 `slugIdSchema` 但字符集更窄（`^[a-z0-9_]{2,20}$`，无连字符——因为 `-` 在 CJK 排版里贴着中文时边界更难判） |
| `validate()` 而非裸 `zValidator` | 全部端点照用 |
| 状态判断用白名单 | 订阅查询 `state === 'watching'`，**绝不写** `!== 'muted'`（§5.3） |
| Hono 单值 query 是 string | `?unread=true` 要用 `z.coerce.boolean()` 或显式 `z.enum(['true','false'])`——注意 `z.coerce.boolean()` 对字符串 `"false"` 会得到 `true`，这里必须写显式转换 |
| api 不返回人类可读消息 | 新错误码 `mention_limit_exceeded` 进 `ERROR_CODES`，文案三语 |
| 楼层号靠 topic 行原子自增 | 扇出的 SELECT 必须在事务外，避免延长那把行锁（§3） |

---

## 11. 明确不做（YAGNI 清单）与留给站长的问题

### 现在不做

版块级订阅 · 订阅等级（watching/tracking/normal） · 用户屏蔽 · 通知偏好表 · 邮件 · WebPush · SSE/WebSocket 实时 · 摘要邮件 · 每小时提及配额 · mention 侧表 · event+inbox 两表拆分 · 按人数上限的清理 · 通知的搜索/筛选（除 unread） · 已读通知归档

**全部理由同一条**：库里没有数据，这些日后加是纯 additive，`rm -rf drizzle && generate && migrate` 零成本。唯一不适用这条豁免的是 handle。

### 需要站长拍板

1. **handle 的生成策略**：注册时自动生成随机 handle（用户可自选一次覆盖），还是强制用户在首次发帖前自选？前者零摩擦但会有一批 `u_a7f3k2m9` 样的丑 handle；后者干净但在注册与发帖之间插了一道门。
2. **handle 是否允许自助修改**：本文推荐「自选一次后锁定，站长可代改」，因为这样才能不存 mention 侧表、不改写正文。若允许自由改名，就得回到 §4.2 的 a 或 b 方案，多一张表或改变正文格式。
3. **handle 的字符集是否放开到连字符 `-`**：`^[a-z0-9_]{2,20}$` vs `^[a-z0-9][a-z0-9_-]{1,19}$`。前者与 `slugIdSchema` 不同形，后者与 `@` 后的中文相邻时终止边界更难判。**一旦发出去就不可改**。
4. **举报处理结果是否通知被举报人**：通知举报人（#2）已推荐。被举报人这一侧，通知等于告诉他「有人举报了你」，可能引发报复；不通知则申诉闭环缺一环。倾向是「只在实际对其内容采取了处置时通知」（那时会另有一条 `status_change` / `soft_delete` 日志，走 #3/#7 的通知），而不是每次举报处理都通知。请确认。
5. **staff 的 `mod_queue` 通知要不要**（#9/#10）：它是「solo + AI 运营」下站长不用刷后台的机制，但会让站长自己的收件箱与用户收件箱混在一起。要不要在收件箱里分「我的 / 站务」两个 tab？
6. **`/status` 绕开 `/review` 导致信任梯度不推进**（§9.3）——这是 M3 遗留的既有不一致，M4 要不要顺手收口（比如把 `pending->published` 从 `/status` 的允许集合里去掉，强制走 `/review`）？

---

## 附：本文引用的源码位置

- `apps/api/src/modules/moderation.ts:100-129` —— review 的事务写法（通知主挂点）
- `apps/api/src/modules/moderation.ts:164-182` —— report resolve 的事务写法
- `apps/api/src/modules/kourindou/index.ts:347-358` —— `/status` 的 moderationLog（易漏挂点）
- `apps/api/src/modules/kourindou/index.ts:385-399` —— `/license` 的 moderationLog
- `apps/api/src/modules/kourindou/index.ts:264-274` —— 已发布资源被编辑的审计（不通知）
- `apps/api/src/modules/admin.ts:121-146` —— soft/hard delete 的事务（purge 级联的坑）
- `apps/api/src/modules/admin.ts:153-168` —— restore **无审计**（既有缺口）
- `apps/api/src/modules/content/post.ts:53-102` —— `createPost`，通知扇出的落点；楼层号行锁
- `apps/api/src/modules/kourindou/status.ts:7-23` —— 状态机允许 `pending->published` 绕过 `/review`
- `apps/api/src/middleware/session.ts:22-54` —— `user_profile` 惰性创建（handle 生成的落点）
- `packages/db/src/schema/auth.ts:4-15` —— `user.name` 非唯一、可变（@ 提及问题的根因）
- `packages/db/src/schema/content.ts:27-89` —— `topic` / `post`，通知的两个主要 subject
- `packages/db/src/schema/kourindou.ts:414-441` —— `moderation_log` 多态 subjectId 的先例与理由
- `apps/api/src/errors.ts:11-24` —— `ERROR_CODES` 白名单
- `apps/api/src/modules/me.ts` —— 未读数的搭车点
- `apps/api/scripts/gc-images.ts` —— GC 脚本的既有形状（`gc-notifications.ts` 照抄）
