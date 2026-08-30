# M4 通知子系统：落地设计

2026-08-30 · 状态：**设计已定，待对抗审查**

> 本文是**决定**，不是方案空间。挖掘阶段的材料在 `mined-notification.md` / `mined-forum-mechanics.md` / `mined-reusable.md`，本文对其中每一处分歧都给出了裁决与理由。
>
> **本文是文档，不是代码。** 这里的 drizzle / TS 片段是待评审的目标形态，**不得直接复制进 `packages/` 或 `apps/`**（M3 有过未评审草稿直接落库、整个 commit 被撤回的先例）。
>
> 遵循 M3 方法论纠正：**库里没有数据时，「现在不建表以后要迁移」不成立。** 真正不可逆的只有 **已对外发出的 URL / slug** 与 **法律留痕**。本文只对一件事主张「必须现在决定」——**用户 handle**（§5.1）。

---

## 0. 决定速览

| 议题 | 决定 |
|---|---|
| 数据模型 | 一张宽表 `notification`（写扇出）+ `topic_subscription`。**2 张新表** |
| subject 指向 | 类型化可空外键 `topic_id` / `post_id` / `resource_id`；硬删场景不带外键，只存标题快照 |
| 通知种类 | **扁平 13 值枚举**，一个 kind 对应一句话（一个 Paraglide key），不做「kind + payload.event」两层 |
| 折叠 | `collapse_key` + 部分唯一索引 + upsert 累加。`reply` / `topic_reply` / `like` 折叠，其余不折叠 |
| 已读 | `read_at timestamptz null`。**不用水位线**（推翻 `mined-forum-mechanics` §3.6 的建议，理由见 §1.1） |
| 未读数 | 部分索引 + 100 截断，搭 `GET /api/me` 返回，不占路由 |
| 产生时机 | 同请求同事务。扇出与订阅写入包在 **SAVEPOINT** 里（`tx.transaction()`），失败只打日志不影响发帖 |
| @ 提及 | `user_profile.handle`（唯一、ASCII、注册时自动生成、可自选一次后锁定），解析器放 `packages/shared` |
| staff 待办通知 | **不做**（推翻 `mined-notification` §9.2 #9/#10，理由见 §1.2） |
| 邮件 / WebPush / SSE | **不做**，且**不为它们预留任何列或表** |
| 清理 | `apps/api/scripts/gc-notifications.ts`，按龄删 + 比例熔断，与 `gc-images.ts` 同形 |
| 新路由 | **4 条**（其中 1 条属 handle 子系统） |
| 代码量 | 核心 ≈ **620 行**，与 M3 审核模块（`moderation.ts` 186 + dash 三页 392 ≈ 578）同量级 |

---

## 1. 与挖掘材料的三处分歧裁决

挖掘阶段两份文档在三点上互相矛盾或需要收口。先裁决，后面全按裁决结果写。

### 1.1 已读语义：`read_at` 行级，**不用** `notificationsSeenAt` 水位线

`mined-forum-mechanics.md:171` 建议「已读语义只做『打开通知页 → 全部已读』，用 `user_profile.notificationsSeenAt` 即可，通知行上连 `readAt` 都不必有」。**否决**，三条理由：

1. **折叠机制依赖 `read_at`**。折叠的部分唯一索引谓词是 `WHERE read_at IS NULL`——「已读之后再来新回复就新起一行」这个正确行为，是由 `read_at` 从索引里消失实现的。用水位线的话，折叠行的唯一性判据没有东西可以挂，要么永远只有一行（读过也不再冒泡），要么每次回复都新建一行（折叠失效）。**水位线与折叠不兼容，而折叠是本设计里最高杠杆的一步。**
2. **未读数的自愈性依赖 `read_at`**。部分索引只装未读行，用户读完索引自己就缩小；水位线方案下未读数是 `created_at > seen_at` 的范围扫描，索引尺寸随历史总量增长。
3. **省下的成本是负数**。`read_at` 是一列 + 一个 UPDATE；水位线是一列 + 一个 UPDATE。行级已读并不更贵，它只是允许了更多语义。

（`mined-forum-mechanics` 的判断在它自己的语境下不错——它是在给「四类事件」估成本。但它没有把折叠算进去。）

### 1.2 **不做** staff 的「有新待审 / 新举报」通知

`mined-notification.md:667-668` 建议给 staff 发 `mod_queue` 折叠通知（#9 #10）。**否决**，改为**在 `/dash` 布局的导航上显示待办计数**。

- **收件人集合是「当前 staff」，而通知是历史行。** 有人被提权/降权之后，旧的未读 `mod_queue` 行就指向了错误的人：新版主看不到既有待办，被降权的人还留着一个点不动的红点。计数查询天然永远正确，通知不是。
- **它是查询，不是事件。** 「有 7 件待审」是对 `resource WHERE status='pending'` 的一次 `count(*)`——这个数在资源被别的 staff 处理掉之后应该自己变小，通知行不会。
- **成本对比**：通知方案 = 1 个 enum 值 + 2 个挂点 + 收件箱「我的 / 站务」分 tab 的开放问题；计数方案 = `dash/layout.tsx` 里一个已有 loader 的 `total` 字段（`GET /moderation/queue` 已经返回 `total`）。
- 顺带消掉 `mined-notification` §11 的开放问题 5。

### 1.3 点赞通知：**做**，但它属于点赞功能的预算

`mined-forum-mechanics.md:40` 把「点赞 + 通知」论证成同一条反馈回路：没有点赞反馈不会发生，没有通知反馈发生了也没人看见。因此只要 M4 做点赞，`like` 通知就必须一起做。它的增量只有 1 个 enum 值 + 挂点处 3 行。

**若最终 M4 不做点赞**：从 `NOTIFICATION_KIND` 删掉 `like`、删掉 `collapseKeyFor` 的一个 case，零迁移成本（库里没数据）。这是标准 YAGNI 处置，不是「预留」。

---

## 2. 表定义

### 2.1 `packages/shared/src/shrine/enums.ts`（新）

枚举是唯一事实来源，pgEnum 与 z.enum 都从这里派生——沿用 M3 的做法。

```ts
/**
 * 通知种类。**一个 kind = 一句话 = 一个 Paraglide key**。
 *
 * 刻意做成扁平 13 值而不是「5 个 kind + payload.event」两层：
 * 两层的话，判据落在 jsonb 里，TypeScript 与 pgEnum 都管不住它，
 * 而 web 侧仍然要写 13 个分支——把类型安全换成了一个不省事的间接层。
 * 上线前加值是零成本的 `rm -rf drizzle && generate`；上线后是一行
 * ALTER TYPE ADD VALUE（0002_certain_master_mold.sql 已有先例）。
 */
export const NOTIFICATION_KIND = [
  // —— 社区侧（有 actor）——
  'reply',              // 有人回复了我的楼层
  'topic_reply',        // 我订阅的主题有新回复（含「我的资源有新评论」）
  'mention',            // 有人 @ 了我
  'like',               // 有人赞了我的楼层
  // —— 治理侧（actor 是 staff）——
  'review_approved',    // 资源过审
  'review_rejected',    // 资源被拒（带 rejectReason）
  'resource_delisted',  // 资源被下架
  'resource_restored',  // 资源被恢复上架
  'resource_license',   // 许可状态被他人修改
  'resource_deleted',   // 资源被站长删除（软删或硬删）
  'post_deleted',       // 楼层被 staff 删除
  'role_granted',       // 我被提权 / 降权
  'report_resolved',    // 我提交的举报被处理
] as const
export type NotificationKind = (typeof NOTIFICATION_KIND)[number]

/** 订阅状态。两值，且判断一律白名单 `=== 'watching'` */
export const SUBSCRIPTION_STATE = ['watching', 'muted'] as const
export type SubscriptionState = (typeof SUBSCRIPTION_STATE)[number]

/**
 * payload 只放**枚举 key、id、数字**，绝不放句子，绝不放人名与标题。
 * 存了中文句子，用户切到 /ja 会看到一个永远是中文的收件箱。
 * 人名与标题一律 join 出来——存快照的话对方改名后收件箱里还是旧名字。
 *
 * 唯一例外是 title：只在 subject 会被硬删、join 不到的场景使用
 * （与 moderation_log.subjectId 用 text 而非外键是同一条道理）。
 */
export type NotificationPayload = {
  rejectReason?: RejectReason
  reportStatus?: ReportStatus
  role?: UserRole
  /** 仅 resource_deleted 使用：专有名词快照，不是待翻译文本 */
  title?: string
}

/** 折叠键。null = 不折叠，每条都单独出现 */
export function collapseKeyFor(
  kind: NotificationKind,
  ids: { topicId?: string | null; postId?: string | null },
): string | null {
  switch (kind) {
    case 'reply':
      return ids.topicId ? `reply:${ids.topicId}` : null
    case 'topic_reply':
      return ids.topicId ? `sub:${ids.topicId}` : null
    case 'like':
      return ids.postId ? `like:${ids.postId}` : null
    default:
      return null
  }
}

/** 同一次动作里一个人只收一条，优先级高的胜出。未列出的种类不参与竞争 */
export const KIND_PRIORITY: Partial<Record<NotificationKind, number>> = {
  mention: 3,
  reply: 2,
  topic_reply: 1,
}

/** 每帖提及人数上限。超出**拒绝**而非静默截断——静默截断会让一次真诚的 12 人点名悄悄丢 2 个 */
export const MENTION_LIMIT = 10
```

### 2.2 `packages/db/src/schema/shrine.ts`（新）

```ts
export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KIND)
export const subscriptionState = pgEnum('subscription_state', SUBSCRIPTION_STATE)

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 收件人。用户没了，他的收件箱也没意义 */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    kind: notificationKind('kind').notNull(),

    /** 触发者。删号不该抹掉「你被回复过」这件事——与 resource.uploaderId 同理 */
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),

    /**
     * subject 用类型化可空外键而不是 moderation_log 那种多态 text id：
     * 收件箱是**列表读**，每行都要显示「在《主题标题》的 12 楼」。
     * 多态 id join 不出来，会退化成按 kind 分组的 N+1。
     */
    topicId: uuid('topic_id').references(() => topic.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => post.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').references(() => resource.id, { onDelete: 'cascade' }),

    /** null = 不折叠。PG 的唯一索引里 NULL ≠ NULL，所以不折叠的种类不需要任何分支 */
    collapseKey: varchar('collapse_key', { length: 96 }),
    count: integer('count').notNull().default(1),

    payload: jsonb('payload').$type<NotificationPayload>().notNull().default({}),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** 收件箱主查询 */
    index('notification_user_created_idx').on(t.userId, t.createdAt.desc()),
    /**
     * 未读数与 ?unread=true。部分索引**只装未读行**——用户读完，行就从索引里
     * 消失，索引尺寸跟着「未读量」走而不是历史总量。这就是不需要反范式计数器的原因。
     */
    index('notification_unread_idx')
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} is null`),
    /**
     * 折叠。谓词里的 read_at is null 让「已读之后再来新回复」新起一行——
     * 这是期望行为，不是缺陷。
     */
    uniqueIndex('notification_collapse_uq')
      .on(t.userId, t.collapseKey)
      .where(sql`${t.readAt} is null and ${t.collapseKey} is not null`),
  ],
)

export const topicSubscription = pgTable(
  'topic_subscription',
  {
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topic.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 取消订阅写 muted 行，**不删行**——删了的话下一次回复会把订阅悄悄加回来 */
    state: subscriptionState('state').notNull().default('watching'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.userId] })],
)
```

**故意没有的东西**（每一条都是 YAGNI 裁决，不是遗漏）：

| 没建 | 理由 |
|---|---|
| `topic_subscription_user_idx`（按用户查订阅） | M4 没有「我关注的主题」列表。扇出走 PK 前缀，取消订阅走 PK。加索引 = 给每次写加成本换一个不存在的读 |
| `topic_subscription.source`（隐式/显式来源） | 没有任何逻辑会读它 |
| `notification` 的 GC 用索引 | GC 是夜间对小表的一次全扫。为它建索引 = 每次写都付钱 |
| `emailed_at` / `notification_pref` | 见 §9。这是标准的「为不做的功能预留」 |
| 反范式 `unreadCount` | 见 §4.2 |
| `notification_event` + `notification_inbox` 两表拆分 | per-user 的 `read_at` 无论如何都要占一行；侧表只省几十字节，却给最热的读路径加一次 join。临界点约「单次扇出 > 50 人」，本站长期 1–20 人 |

### 2.3 `user_profile` 增补（`packages/db/src/schema/kourindou.ts`）

```ts
/**
 * 全局唯一、小写 ASCII、进 URL（/u/:handle）、进已发布的帖子正文（@handle）。
 * 这是 M4 唯一命中「已对外发出的 URL」这条不可逆红线的字段，
 * 因此它不适用「没数据就能重建」的豁免，必须一次定对。
 */
handle: varchar('handle', { length: 20 }).unique(),
/** null = 还没自选过，可以改一次；非 null = 锁定 */
handleSetAt: timestamp('handle_set_at', { withTimezone: true }),
```

外加一条 DB 层 CHECK——M3 的教训是「只写在 zod 里的约束绕过 API 就没了」（`rating_score_range` 就是为此补的）：

```ts
check('user_profile_handle_fmt', sql`${t.handle} ~ '^[a-z0-9_]{2,20}$'`)
```

> `user_profile` 从无键表变成带表级约束的表，drizzle 的第二个参数从无到有，别忘了同时改 `pgTable('user_profile', {...})` 的调用形状。

---

## 3. 未读数与收件箱的确切查询

### 3.1 未读数

```sql
-- 命中 notification_unread_idx (user_id, created_at desc) WHERE read_at IS NULL
SELECT count(*)::int AS n FROM (
  SELECT 1 FROM notification
  WHERE user_id = $1 AND read_at IS NULL
  LIMIT 100
) t;
```

三个必须写进注释的性质：

1. **`LIMIT 100` 把最坏情况钉死**。前端显示 `99+`，数据库最多扫 100 个索引项，与用户历史通知总量无关。
2. **部分索引自愈**。计数器会漂移且永不自愈；索引扫描不会。
3. **未登录不算**，`if (!actor)` 直接跳过。

drizzle 实现直接用查询构建器更省事，`rows.length` 就是截断后的计数：

```ts
export async function unreadCount(userId: string) {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .limit(100)
  return rows.length // 0..100
}
```

### 3.2 收件箱（一次查询，无 N+1）

```sql
SELECT n.id, n.kind, n.count, n.payload, n.created_at, n.read_at,
       n.topic_id, n.post_id,
       a.name  AS actor_name,
       ap.handle AS actor_handle,
       t.title AS topic_title,
       t.board_slug,
       r.slug  AS resource_slug,
       p.floor AS post_floor
FROM notification n
LEFT JOIN "user"        a  ON a.id = n.actor_id
LEFT JOIN user_profile  ap ON ap.user_id = n.actor_id
LEFT JOIN topic         t  ON t.id = n.topic_id
LEFT JOIN resource      r  ON r.id = COALESCE(n.resource_id, t.resource_id)
LEFT JOIN post          p  ON p.id = n.post_id
WHERE n.user_id = $1
  -- ?unread=true 时追加：AND n.read_at IS NULL
ORDER BY n.created_at DESC
LIMIT $2 OFFSET $3;
```

- 5 个 LEFT JOIN 作用在**一页 20 行**上，不是全表。这正是选类型化外键而非多态 id 的兑现。
- 链接由前端从 `board_slug` / `resource_slug` 推出（`/kourindou/:slug#post-:floor` 还是 `/shrine/t/:id#post-:floor`），**通知里不存 URL**——存了的话改路由就全部失效。
- 分页沿用仓库既有的 `paginationQuerySchema`（offset）。已知代价：折叠行被 upsert 冒泡后会在翻页过程中换页。收件箱经 GC 后是几百行量级，可接受；keyset 分页是纯 additive 的后续升级。
- `?unread=true` 的解析**不能用 `z.coerce.boolean()`**（它把字符串 `"false"` 转成 `true`）。写 `z.enum(['true','false']).optional().transform(v => v === 'true')`。

---

## 4. 触发点清单

### 4.0 唯一写入口

所有挂点都只调这一个函数。去重、自我过滤、折叠键、锁顺序都只在这里发生一次——**不在各调用点各写一遍**（`mined-notification` §9.4 指出的重复来源正是「共享 helper + 调用点各写一次」）。

```ts
// apps/api/src/notify.ts（新，≈90 行）
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type NotifyRow = {
  userId: string | null
  kind: NotificationKind
  topicId?: string | null
  postId?: string | null
  resourceId?: string | null
  payload?: NotificationPayload
}

export async function notify(tx: Tx, actorId: string | null, rows: NotifyRow[]) {
  // ① 不给自己发。作者自助下架自己的资源、自己回自己的主题都在这里被挡掉
  const candidates = rows.filter((r) => r.userId && r.userId !== actorId)
  if (candidates.length === 0) return

  // ② 一个人一次动作只收一条：mention > reply > topic_reply。
  //    这既是产品规则，也是**正确性要求**——同一条 INSERT 里两行命中同一个
  //    折叠行，PG 会报 21000 "ON CONFLICT DO UPDATE command cannot affect
  //    row a second time"。
  const best = new Map<string, NotifyRow>()
  for (const r of candidates) {
    const prev = best.get(r.userId as string)
    const p = KIND_PRIORITY[r.kind] ?? 0
    if (!prev || p > (KIND_PRIORITY[prev.kind] ?? 0)) best.set(r.userId as string, r)
  }

  // ③ 按 userId 排序后再插。并发扇出对同一批收件人加行锁的顺序一致，不会死锁。
  const values = [...best.values()]
    .sort((a, b) => ((a.userId as string) < (b.userId as string) ? -1 : 1))
    .map((r) => ({ ...r, actorId, collapseKey: collapseKeyFor(r.kind, r), payload: r.payload ?? {} }))

  await tx.insert(notification).values(values).onConflictDoUpdate({
    target: [notification.userId, notification.collapseKey],
    // 必须与 notification_collapse_uq 的谓词逐字一致，否则 PG 找不到 arbiter，
    // 报 "there is no unique or exclusion constraint matching the ON CONFLICT specification"
    targetWhere: sql`read_at is null and collapse_key is not null`,
    set: {
      count: sql`${notification.count} + 1`,
      actorId: sql`excluded.actor_id`,
      postId: sql`excluded.post_id`,
      createdAt: sql`now()`, // 冒泡到收件箱顶部
    },
  })
}
```

### 4.1 总表

| # | 通知 | kind | 文件:行（M3 现状） | 收件人 | 事务 | 失败处理 |
|---|---|---|---|---|---|---|
| 1 | 有人回复了我的楼层 | `reply` | `content/post.ts:86-96` 之后 | 父楼作者 | 内，**SAVEPOINT** | 吞掉 + `console.error`，发帖成功 |
| 2 | 我订阅的主题有新回复 | `topic_reply` | 同上 | `watchersOf(topicId)` | 内，SAVEPOINT | 同上 |
| 3 | 有人 @ 了我 | `mention` | 同上 | `resolveHandles()` 命中者 | 内，SAVEPOINT | 同上 |
| 4 | 有人赞了我的楼层 | `like` | M4 新增 `POST /shrine/posts/:id/like` | 楼层作者 | 内，SAVEPOINT | 同上 |
| 5 | 资源过审 | `review_approved` | `moderation.ts:119-128` 之后 | `row.uploaderId` | 内，**不包 SAVEPOINT** | 整个事务回滚，审核员重试（有幂等闸门） |
| 6 | 资源被拒 | `review_rejected` | 同上 | 同上 | 同上 | 同上 |
| 7 | 资源被下架 / 恢复 / 绕过 review 直发 | `resource_delisted` / `resource_restored` / `review_approved` | `kourindou/index.ts:349-357` 之后 | `row.uploaderId` | 内，不包 | 同上 |
| 8 | 许可状态被他人改 | `resource_license` | `kourindou/index.ts:390-398` 之后 | `row.uploaderId` | 内，不包 | 同上 |
| 9 | 资源被站长删除 | `resource_deleted` | `admin.ts:127-135` 之后 | `row.uploaderId`（**要先加 select**） | 内，不包 | 同上 |
| 10 | 楼层被 staff 删除 | `post_deleted` | `content/index.ts:85`（**要先开事务**） | `row.authorId` | 内，不包 | 同上 |
| 11 | 我被提权 / 降权 | `role_granted` | `admin.ts:83-91` 之后 | 路径参数 `:id` | 内，不包 | 同上 |
| 12 | 我提交的举报被处理 | `report_resolved` | `moderation.ts:173-181` 之后 | `row.reporterId` | 内，不包 | 同上 |

### 4.2 为什么发帖包 SAVEPOINT、审核不包

这是本设计里最需要说清楚的一条判据，**不是风格偏好**：

> **有幂等闸门可以重试的动作，让通知失败连坐；没有幂等闸门的动作，必须隔离。**

- **发帖没有幂等闸门**。通知写失败导致发帖 500，用户重试就会发出两楼。所以扇出必须隔离。
- **审核有**。`/review` 开头就是 `if (row.status !== 'pending') return fail(..., 409)`（`moderation.ts:80-82`），第二次调用打不进来；`/status`、`/license`、`role_change`、`delete` 的重试都不改变最终状态。通知失败 → 整个事务回滚 → 状态没变 → staff 重试即可。而且这样「审计日志说做过、用户却没收到」这种状态根本不可能存在，与旁边那条 `moderationLog` 保持「要么都在要么都不在」。

**SAVEPOINT 是强制的，不是「多五行换安全」。** PG 里事务内任何错误都会让事务进入 aborted 状态，之后每条语句都报 25P02，连 COMMIT 都失败。裸 `try/catch` 包住扇出**不能**救回发帖，只会把失败变成更难懂的形式。必须用 drizzle 的 `tx.transaction()`（它发的是 SAVEPOINT / ROLLBACK TO SAVEPOINT）：

```ts
try {
  await tx.transaction(async (tx2) => {
    await tx2.insert(topicSubscription)
      .values({ topicId: input.topicId, userId: input.authorId })
      .onConflictDoNothing()          // ← DO NOTHING，理由见 §6.3
    await notify(tx2, input.authorId, rows)
  })
} catch (e) {
  // 通知失败不该让发帖失败。但必须留痕，否则是静默丢失。
  console.error('[notify] fan-out failed', e)
}
```

### 4.3 发帖：`apps/api/src/modules/content/post.ts`

这是唯一保留 service 抽象的模块，**设计上就有两个调用方**（香霖堂评论区 + M4 版块帖）。通知挂在这里，两个视图自动都覆盖——挂在路由上就要写两遍并且必然漂移。

**事务外**（现有代码 `:59-66` 之前/之内做）——理由是楼层号靠 `UPDATE topic ... RETURNING` 原子自增，那个 UPDATE 持行锁，整个主题的并发发帖在此串行化；把 SELECT 塞进事务等于延长这把锁：

```ts
// ① 父楼查询已存在（:59-66），把 authorId 一起 select 出来（现在只 select id）
const [parent] = await db
  .select({ id: post.id, authorId: post.authorId })   // ← +authorId
  .from(post).where(and(eq(post.id, input.parentId), eq(post.topicId, input.topicId))).limit(1)

// ② 提及：纯函数抽取 + 一次查库解析
const handles = extractMentions(input.bodyMd)
if (handles.length > MENTION_LIMIT) return { ok: false, reason: 'mention_limit' } as const
const mentionedIds = await resolveHandles(handles)     // 不存在的 handle 直接消失

// ③ 订阅者（白名单 state='watching'，LIMIT 500）
const watcherIds = await watchersOf(input.topicId)
```

**事务内**，在 `:86-95` 的 `insert(post).returning()` 之后、`:97` 的 `return` 之前，用 §4.2 的 SAVEPOINT 块写入订阅与扇出：

```ts
const rows: NotifyRow[] = [
  ...mentionedIds.map((userId) => ({ userId, kind: 'mention' as const, topicId, postId })),
  ...(parent?.authorId ? [{ userId: parent.authorId, kind: 'reply' as const, topicId, postId }] : []),
  ...watcherIds.map((userId) => ({ userId, kind: 'topic_reply' as const, topicId, postId })),
]
```

顺序即优先级：`notify()` 的去重按 `KIND_PRIORITY` 取胜者，与数组顺序无关，但把 mention 写在前面更容易读。

**调用方要跟着改**（`content/index.ts:69-73`）：`CreatePostResult` 的 reason 联合多了 `'mention_limit'`，映射到新错误码：

```ts
if (!result.ok) {
  switch (result.reason) {
    case 'parent_invalid':  return fail(c, 'validation_failed', 400, ['parentId'])
    case 'mention_limit':   return fail(c, 'mention_limit_exceeded', 400, ['bodyMd'])
    default:                return fail(c, 'not_found', 404)
  }
}
```

> **顺带报告（不是本设计的前置条件）**：`post.ts:99-101` 的 `catch { return { ok:false, reason:'topic_missing' } }` 会把唯一违例、连接错误、CHECK 违例一律翻译成 404，闷死了 `post_topic_floor_uq` 这道专为楼层竞态设的告警通道（挖掘结论 N4）。本设计的新增代码全部在 SAVEPOINT 内自行捕获，不会加剧它；但建议 M4 顺手把这个 catch 收窄成「只有 23505 才算竞态」。

### 4.4 审核：`apps/api/src/modules/moderation.ts`

`POST /resources/:id/review`，事务在 `:100-129`，`insert(moderationLog)` 在 `:119-128`。紧跟其后加一行：

```ts
await notify(tx, actor.id, [{
  userId: row.uploaderId,
  kind: input.decision === 'approve' ? 'review_approved' : 'review_rejected',
  resourceId: id,
  payload: input.rejectReason ? { rejectReason: input.rejectReason } : {},
}])
```

三个既有性质让这一行成立，不需要额外查询：`row` 已在手且含 `uploaderId`；`uploaderId` 可空但 `notify()` 内部会过滤 null；状态、信任计数、审计日志本来就在同一事务里。

`POST /reports/:id/resolve`，事务 `:164-182`，`insert(moderationLog)` 在 `:173-181` 之后：

```ts
await notify(tx, actor.id, [{
  userId: row.reporterId,
  kind: 'report_resolved',
  payload: { reportStatus: input.status },
}])
```

**举报人通知是必需的**——产品文档要求「举报-处理-申诉闭环」，举报人不被告知的话闭环第一环就断了。`row` 已经是 `SELECT *`，`reporterId` 现成。

**被举报人不发这条通知**（裁决 `mined-notification` 开放问题 4）：
- `resolve` 只结案不处置（`report.status` 变了，目标没动）。真正对内容的处置是另一条路径（软删 / 下架 / 删楼），那条路径**自己已经发了通知**（#7 #9 #10）。所以「被处置了」这件事不会漏，漏的只是「有人举报过你但站长驳回了」——那件事没有告知价值，只有报复价值。
- 少一条挂点、少一个 enum 值、少一个开放问题。

### 4.5 状态与许可：`apps/api/src/modules/kourindou/index.ts`

`POST /resources/:id/status`，事务 `:347-358`。**这是最容易漏的一条**：状态机允许 `pending -> published` 且它是 STAFF_ONLY（`kourindou/status.ts:20-23`），也就是 staff 可以完全绕开 `/review` 把待审资源直接发布。只把通知挂在 `/review` 上，这条路径下作者收不到任何结果。

kind 由跃迁决定，一个 kind 一句话，web 侧不需要嵌套分支：

```ts
const kind =
  to === 'delisted' ? 'resource_delisted'
  : row.status === 'pending' ? 'review_approved'   // 绕过 /review 的直发
  : 'resource_restored'                            // delisted -> published
await notify(tx, actor.id, [{ userId: row.uploaderId, kind, resourceId: id }])
```

作者自助下架（`published -> delisted` 不在 STAFF_ONLY，产品硬约束要求作者能自助下架）会走到这里，但 `notify()` 的 `userId !== actorId` 过滤掉了自我通知。

`PATCH /resources/:id/license`，事务 `:385-399`，在 `:390-398` 之后：

```ts
await notify(tx, actor.id, [{ userId: row.uploaderId, kind: 'resource_license', resourceId: id }])
```

许可状态是版权生死线字段，被别人改了必须知道；改的人是自己时同样被过滤掉。

`PATCH /resources/:id`（已发布资源被编辑，`:264-274` 的审计）：**不发通知**。actor 通常就是作者本人。

> **顺带报告**：走 `/status` 的 `pending -> published` 不推进 `approvedResourceCount`，也不写 `action:'review'`。同一个业务动作（通过审核）有两条路径，只有一条推进信任梯度。这是 M3 遗留的既有不一致，不属于通知子系统，但审核台 UI 若为了方便加一个「直接发布」按钮走 `/status`，信任梯度会静默失效。建议 M4 顺手把 `pending->published` 从 `/status` 的允许集合里去掉。

### 4.6 站长动作：`apps/api/src/modules/admin.ts`

`PATCH /users/:id/role`，事务 `:78-92`，在 `:83-91` 之后：

```ts
await notify(tx, actor.id, [{ userId: id, kind: 'role_granted', payload: { role } }])
```

`DELETE /resources/:id`，事务 `:121-146`。**两处必须注意**：

1. **现在的 SELECT（`:109-118`）没有取 `uploaderId`**，必须加上，否则没有收件人。
2. **`resource_deleted` 绝不能带 `resourceId` 外键。** `mode: 'purge'` 会 `DELETE FROM resource`，级联带走 `topic` / `post`；带外键的通知会**在同一个事务里被自己级联删掉**，作者永远收不到。所以只存 `payload.title` 快照——这与 `moderation_log.subjectId` 用 text 而非外键是同一条道理的第二次应用。软删场景也统一不带外键（链接指向一个用户看不到的资源没有意义），少一个分支。

```ts
await notify(tx, actor.id, [{
  userId: row.uploaderId,          // ← 需要在 :109-118 的 select 里加这一列
  kind: 'resource_deleted',
  payload: { title: row.titleOriginal },   // 硬删后 join 不到，只能存快照
}])
```

`POST /resources/:id/restore`（`:153-168`）：**不发通知，本次也不动它**。

> **顺带报告**：restore 完全不写 `moderationLog`——旁边的 DELETE 写了、`PATCH /config` 写了，唯独恢复没有。审计链上是个洞，属 M3 遗留，应单独修。

`PATCH /config`：不发通知（subject 是站点，没有归属人）。

### 4.7 删楼：`apps/api/src/modules/content/index.ts`

`DELETE /posts/:id`（`:78-87`）现在是裸的 `await softDeletePost(row.id)`，**既不写审计也没有事务**。这是 M3 所有 staff 处置动作里唯一漏留痕的一处（挖掘结论 P0-2），申诉阶段无从答起。改法：

```ts
if (actor.id === row.authorId) {
  await softDeletePost(row.id)          // 作者删自己的楼，不留痕也不通知
} else {
  await db.transaction(async (tx) => {
    await tx.update(post).set({ deletedAt: new Date() }).where(eq(post.id, row.id))
    await tx.insert(moderationLog).values({
      actorId: actor.id, action: 'post_delete',
      subjectKind: 'post', subjectId: row.id, reason,
    })
    await notify(tx, actor.id, [{
      userId: row.authorId, kind: 'post_deleted', topicId: row.topicId, postId: row.id,
    }])
  })
}
```

`findPost()`（`post.ts:109-116`）已经返回 `authorId` 与 `topicId`，无需改。依赖：`MODERATION_ACTION` 要加 `'post_delete'`（`ALTER TYPE ... ADD VALUE`，0002 已有先例）。

> 中间件顺序另有一个既有小瑕疵：`entityIdParam, requireAuth` 会让未登录 + 非法 uuid 先拿到 400 而不是 401。M4 的新路由一律写成 `requireAuth, entityIdParam`。

### 4.8 订阅的产生点（不是通知，但没有它通知就是空的）

| 位置 | 动作 |
|---|---|
| `kourindou/index.ts:196-201`（建资源时同事务建 topic） | 同事务给 uploader 插一行 `watching`。**这是「我的资源有新评论」的全部实现**——不需要为它单独设计一种通知，它就是 `topic_reply` |
| `content/post.ts` 事务内 | 回复即订阅，`onConflictDoNothing()` |
| M4 `POST /shrine/topics` | 发起主题即订阅 |
| `PUT /api/shrine/topics/:id/subscription` | 显式关注 / 取消 |

`packages/db/scripts/seed-demo*.ts` 造资源时同样要补这一行，否则演示数据的评论不产生通知。

---

## 5. @ 提及

### 5.1 先决条件：`handle`（M4 唯一不可推迟的 schema 决定）

`user.name` 是 `text NOT NULL`，**不唯一、无字符集约束、用户可随时改**（`packages/db/src/schema/auth.ts:6`）。于是 `@霧雨魔理沙` 可能对应 0 个、1 个或 17 个用户；CJK 没有词边界，`@魔理沙的帖子` 里名字在哪结束无解；任何人都能改名成 `@管理员` 实施冒充；就算某次解析对了，对方改名后旧帖里的 `@` 就指错人。

**决定：给 `user_profile` 加 `handle`**，规则如下（这里把 `mined-notification` 的三个开放问题一次拍死）：

| 项 | 决定 | 理由 |
|---|---|---|
| 字符集 | `^[a-z0-9_]{2,20}$`，小写存储，**不含连字符** | `-` 与 `slugIdSchema` 同形会让 `/u/foo-bar` 和资源 slug 在视觉上混淆；且 `-` 常出现在日文排版的连接位置，终止边界更难判。一旦发出去不可改，所以取更窄的那个 |
| 生成 | 注册（`session.ts:35-43` 惰性建 profile 时）自动生成 `u` + 8 位 base32，冲突重试 ≤3 次；失败则留 null | 冷启动最怕在注册与发帖之间插门。`mined-forum-mechanics` 的核心判断是「0 帖时需要放大而不是抑制」 |
| 修改 | 用户可**自选一次**（`handleSetAt IS NULL` 时），设完锁定 | 这样才能「渲染时按 `@handle` 现查现渲染」——零额外存储、零 mention 侧表、正文永远是人类可读的 Markdown |
| staff 代改 | **M4 不做端点**，走 SQL + 手工补一条 `moderationLog` | 与 M3「社团认领只收单，审批走 SQL」同一条既定处置。冒充/骚扰是低频事件，一个操作者 |
| 释放回收 | **永不回收**。M4 里没有任何代码路径能释放一个 handle | 回收会让旧帖里的 `@marisa` 某天突然指向另一个人。唯一能释放的动作是站长手工 UPDATE——那是运维守则，不是机制。残余风险已知，日后要机制化就是一张 `handle_reservation` 表，纯 additive |
| 保留字 | `admin` `moderator` `staff` `system` `official` `all` `everyone` `here` `me` `new` `edit` `login` `register` `api` `u` `shrine` `kourindou` `chronicle` `spellcard` `music` `gensokyo` | `/u/:handle` 与路由命名空间共用；`@all` / `@everyone` 因此天然不解析 |

自动生成要注意一个坑：现有的惰性建档是 `.insert(userProfile).values({userId}).onConflictDoNothing().returning()`，**无 target 的 DO NOTHING 会连 handle 唯一违例一起吞掉**，结果是 profile 行根本没建成。改成 `onConflictDoNothing({ target: userProfile.userId })` 并对 handle 冲突重试；三次都撞（32^8 概率下不可能）就落 null——handle 可空，用户照样能浏览，只是暂时 @ 不到他。

### 5.2 抽取器（`packages/shared/src/shrine/mention.ts`）

放 shared 是硬要求：**发通知的一端和渲染链接的一端必须逐字一致**，否则用户会收到「你被提及」但帖子里没有链接，或者反过来。这是「类型主轴 = 单一事实来源」在文本上的应用。

```ts
/** 代码块里的 @ 不是提及。未闭合的 fence 会误伤，但失败模式只是「少发一条」或
 *  「多解析出一个不存在的 handle」，两者都无害——见下面的安全网。 */
const stripCode = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')

/**
 * 前瞻只排除 [A-Za-z0-9_]：handle 是纯 ASCII，所以 CJK 紧跟其后就是合法终止边界。
 * 后顾排除 ASCII 字母数字与 . / @ -：挡掉邮箱与 URL 里的 @。
 * **后顾故意不含 \p{L}**——含了的话「你好@marisa」就解析不出来，
 * 而中日文写作里 @ 前面不加空格是常态。
 */
const MENTION_RE = /(?<![A-Za-z0-9_./@-])@([A-Za-z0-9_]{2,20})(?![A-Za-z0-9_])/gu

export function extractMentions(md: string): string[] {
  const seen = new Set<string>()
  for (const m of stripCode(md).matchAll(MENTION_RE)) seen.add(m[1].toLowerCase())
  return [...seen]
}
```

**为什么它不会误伤**——逐个用例：

| 输入 | 结果 | 机制 |
|---|---|---|
| `` `@marisa` `` / ```` ```@marisa``` ```` | 不解析 | `stripCode` |
| `foo@example.com` | 不解析 | 后顾：`o` 是 ASCII 字母 |
| `https://x.com/@marisa` | 不解析 | 后顾：`/` |
| `[看这里](https://x.com/@marisa)` | 不解析 | 同上 |
| `@@marisa` | 不解析 | 后顾：`@` |
| `你好@marisa，帮我看看` | **解析出 `marisa`** | 后顾不含 CJK；前瞻遇到 `，` 终止 |
| `@marisa的帖子` | **解析出 `marisa`** | handle 是 ASCII，`的` 就是边界 |
| `@marisa.` / `@marisa)` | **解析出 `marisa`** | 前瞻只挡 `[A-Za-z0-9_]` |
| `@abcdefghijklmnopqrstuvwxyz`（26 字符） | 不解析 | 前瞻阻止把超长串截成一个合法的 20 字符前缀 |
| `@霧雨魔理沙` | 不解析 | handle 不含 CJK。显示名保持自由（日文/中文/emoji 随便用），提及只认 handle |

**关键性质：解析可以偏宽松，因为抽取结果必须再过一次「这个 handle 是否存在」的查库。** 不存在就什么都不发生。这条安全网让正则的不精确变得可以容忍——**不必为此引入 Markdown AST 依赖**（仓库现在没有任何 markdown 解析器）。若 M4 最终为服务端消毒引入了解析器，把抽取改成「只遍历 text 节点」是纯升级，接口不变。

### 5.3 两个必答问题

**被 @ 的人不存在怎么办？** `resolveHandles()` 是一次 `WHERE handle IN (...)`，不存在的 handle 不会出现在结果里，什么都不发生。渲染侧同理：`@nobody` 保持纯文本，不生成链接。**这是期望行为，不是 bug**——站长代改过 handle 之后，旧帖里的 `@oldhandle` 也走这条路径退化成纯文本。

**一条帖 @ 20 个人怎么办？** `MENTION_LIMIT = 10`，**超出直接拒绝**（新错误码 `mention_limit_exceeded`，前端按 code 查 Paraglide 文案），不静默截断——静默截断会让一次真诚的 12 人点名悄悄丢 2 个，而用户无从察觉。检查放在 `createPost()` 里而不是路由里：那里是唯一有两个调用方的地方，放路由上就要写两遍并且必然漂移。

其余防轰炸手段：

| 手段 | 决定 |
|---|---|
| 不 @ 自己 | `notify()` 统一过滤，不在调用点重复 |
| 一帖对一人只发一条 | `notify()` 的优先级去重，`mention > reply > topic_reply` |
| `@all` / `@everyone` | 保留字，永不能被注册，因此永不解析 |
| 每小时提及配额 | **不做**。上线时靠「每帖上限 + 发帖限流 + 信任梯度」已足够。做法记在这里备用：`(actor_id, created_at)` 索引 + 一次 count |
| 编辑帖子的重复提及 | M4 若引入 `PATCH /posts/:id`（现在只有 DELETE）**必须**只对新增 handle 发通知（新旧 `extractMentions()` 结果的差集）。否则改一个错别字会把所有人重新 @ 一遍 |

---

## 6. 去重与合并

### 6.1 「同一个主题连续 10 条回复，收 10 条还是 1 条？」

**1 条，内容是「有 10 条新回复」**——只要那一行还没被读。

机制：`collapse_key` + 部分唯一索引 + upsert 累加。四个必须写进注释的性质：

1. **索引是部分的（`WHERE read_at IS NULL`）**，所以「已读之后再来新回复」会新建一行。这正是想要的：读过 3 条之后来的第 4 条应该重新亮红点，而不是把 count 从 3 改成 4 却仍是已读。
2. **`collapse_key IS NULL` 的行永不冲突**（PG 唯一索引里 NULL ≠ NULL），所以不折叠的种类不需要任何额外分支。
3. **`created_at` 被推到 `now()`**，折叠行冒泡到收件箱顶部；副作用是它会逃出「全部已读」的 `before` 游标——而这恰好是对的（有新动静就该保持未读）。
4. **折叠是「先有折叠，才敢默认回复即订阅」的前提**。传统论坛为此发明了 watching / tracking / normal / muted 四级（Discourse）；本设计不需要那四级，因为一个主题对一个用户最多一行未读。

折叠规则表：

| kind | collapse_key | 理由 |
|---|---|---|
| `reply` | `reply:<topicId>` | 5 个人回我在这个主题里的发言 → 「5 人回复了你」。按 topic 而非 post 折叠：同一主题里回我两个楼层，仍然是一件事 |
| `topic_reply` | `sub:<topicId>` | 折叠的主战场。200 楼的主题对每个订阅者只产生 1 行 |
| `like` | `like:<postId>` | 「3 人赞了你的 12 楼」 |
| `mention` | **null** | @ 是点名，每一次都要单独看见 |
| 全部治理类（9 种） | **null** | 每条都是对用户有行动含义的独立决定，数量天然极少 |

**治理类刻意不折叠**，即使 staff 反复切换 `delisted ⇄ published` 会刷屏。折叠它的诱惑是「拒绝后又通过，只显示最新状态」——那会**吞掉拒绝理由**，而拒绝理由是用户唯一能据以改进的信息。状态历史在 `moderation_log` 里，但用户看不到它。

### 6.2 一次动作内的去重

一个人既是父楼作者、又是订阅者、又被 @ → 只发一条，`mention > reply > topic_reply`。这不只是产品规则，**也是正确性要求**：同一条 INSERT 里两行命中同一个折叠行，PG 会报 21000（`ON CONFLICT DO UPDATE command cannot affect row a second time`）。`notify()` 的 Map 去重同时解决这两件事。

### 6.3 取消订阅必须写 `muted` 行

```ts
// 取消订阅
.insert(topicSubscription).values({ topicId, userId, state: 'muted' })
.onConflictDoUpdate({ target: [...], set: { state: 'muted' } })
```

如果取消订阅是 `DELETE`，用户下一次在这个主题里回复，「回复即订阅」会立刻把他加回来——用户会认为取消订阅坏了。这也是为什么**回复时的 upsert 必须是 `DO NOTHING` 而不是 `DO UPDATE state='watching'`**：后者会把 muted 顶掉，等价于同一个 bug。

订阅者查询一律白名单 `eq(state, 'watching')`，**绝不写 `ne(state,'muted')`**（CLAUDE.md 明令）；并带 `LIMIT 500` 作为绝对上界——零流量时永远撞不到，但它是防止某天一个主题被机器人订阅一万次拖垮发帖的唯一闸门。

**mute 只压制 `topic_reply`。** 被 mute 的主题里，`reply`（有人回我的楼）与 `mention`（有人点我的名）照发——mute 是关掉订阅的水管，不是拒绝被直接称呼。

### 6.4 点赞的一个已知噪音

反复「取消赞 → 再赞」会让折叠行的 count 一路往上加。缓解到「只在 reaction 行**真的插入成功**时才发」（`onConflictDoNothing().returning()` 判空），但取消后重赞仍会 +1。**接受**：噪音上限受未来的发帖/互动限流保护，而做「撤销通知」这条反向路径的复杂度远大于收益。

---

## 7. 已读语义

一条路由承担三种语义：

```
POST /api/notifications/read   { ids: string[] }  |  { before: <ISO 时间> }
```

| 语义 | 实现 |
|---|---|
| **单条已读** | 点击收件箱里的一行时，前端 fetcher 提交 `{ ids: [id] }` 然后跳转 |
| **全部已读** | 顶部按钮提交 `{ before: <当前页最新一条的 createdAt> }` |
| **点进去自动已读** | **只在收件箱内点击时生效**，不在目标页生效 |

```sql
-- ids
UPDATE notification SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2);
-- before
UPDATE notification SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND created_at <= $2;
```

两条都命中 `notification_unread_idx`，更新行数有界。

三个决定与理由：

1. **「全部已读」用游标而不是 `all: true`。** 用户点击的那一刻页面上最新的一条是 T；用 `all` 的话，在 T 之后、点击之前刚到的那条会被标记成已读而用户从没见过它。传 `before = T` 就没有这个洞。与折叠的联动：被 upsert 冒泡过的行 `created_at` 是 `now()`，自动越过游标保持未读——正确。
2. **打开收件箱页不自动全部已读。** 否则「我记得有条通知，回头找找」变成不可能——一进去红点就没了，而列表里已读与未读在视觉上是同一堆东西。
3. **访问目标页（主题/资源）不标记已读。** 需要在每个目标页注入「我是从哪条通知来的」，收益远小于复杂度。
4. `read_at` 用时间戳而非布尔：多存一个时间戳是免费的，而且它是未来任何「N 分钟未读则如何」的唯一前置。

---

## 8. 增长控制

折叠已经把增长率压掉了一个数量级（订阅通知从「每楼一行」变成「每主题一行」）。剩下的靠按龄删。

**`apps/api/scripts/gc-notifications.ts`**，与 `gc-images.ts` / `reindex.ts` 同形：手动 / 系统 cron 触发的幂等脚本，**不是应用内的常驻任务**。

```ts
/**
 * 清理过期通知。
 *
 *   bun run gc:notifications -- --dry      只打印不删
 *   bun run gc:notifications -- --force    越过比例熔断
 *
 * 删除谓词是**白名单**：显式列出「够老的已读」与「非常老的未读」两类。
 * 绝不写成 `not (...)` 的取反式——取反式漏掉任何一个保留条件就是清库。
 *
 * 与 gc-images.ts 的一处差别值得写明：那里的危险是「引用集合塌成空集」
 * （白名单是从别处查出来的，查错了就全删），所以它有一道「引用为空即拒绝」的
 * 熔断。这里的白名单是纯粹的时间谓词，不依赖任何外部查询，塌陷模式不存在；
 * 因此只保留比例熔断，防的是「有人把 30 days 改成 30 minutes」。
 */
import { db, schema } from '@gensokyo/db'
import { sql } from 'drizzle-orm'

const READ_TTL_DAYS = 30     // 已读的，30 天后删
const UNREAD_TTL_DAYS = 180  // 未读的，半年后也删（半年没登录，那条未读没有意义了）
const BATCH = 5000
const MAX_RATIO = 0.5

const dry = process.argv.includes('--dry')
const force = process.argv.includes('--force')
const { notification: n } = schema

const doomed = sql`(
  (${n.readAt} is not null and ${n.readAt}  < now() - make_interval(days => ${READ_TTL_DAYS}))
  or
  (${n.readAt} is     null and ${n.createdAt} < now() - make_interval(days => ${UNREAD_TTL_DAYS}))
)`

async function main() {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(n)
  const [{ doomedCount }] = await db
    .select({ doomedCount: sql<number>`count(*)::int` }).from(n).where(doomed)

  // 熔断：一次要删掉半张表以上，几乎必然是谓词或时钟出了问题，不是真的都过期了
  if (total > 0 && doomedCount / total > MAX_RATIO && !force) {
    console.error(
      `拒绝执行：共 ${total} 行，本次将删 ${doomedCount} 行（${((doomedCount / total) * 100).toFixed(1)}%），` +
      `超过 ${MAX_RATIO * 100}% 的熔断阈值。确认无误请加 --force。`,
    )
    process.exit(1)
  }

  if (dry) {
    console.log(`[dry] total ${total}, would delete ${doomedCount}`)
    return
  }

  // 分批删，避免一次锁太多行
  let removed = 0
  for (;;) {
    const res = await db.execute(sql`
      delete from ${n} where id in (select id from ${n} where ${doomed} limit ${BATCH})
    `)
    const k = Number((res as { count?: number }).count ?? 0)
    removed += k
    if (k < BATCH) break
  }
  console.log(`total ${total}, removed ${removed}`)
}

await main()
```

配套：`apps/api/package.json` 加 `"gc:notifications": "bun run --env-file=../../.env scripts/gc-notifications.ts"`（与 `gc:images` 同形）。

**必须写进注释、防止日后被误解成合规问题的一句：**

> **通知不是法律留痕。** 版权争议时的证据链在 `moderation_log`（它的 `subjectId` 是 `text` 而非外键，正是为了硬删之后记录仍在）。通知只是「这件事有没有告诉过用户」的送达副本，可以放心按龄删。

**`topic_subscription` 不需要 GC**：它随 topic / user 级联删除，且行数上界是「订阅关系数」，不随时间增长。

**评估过但不做的替代**：按人数保留最近 N 条（窗口函数 + `row_number()`，更精确但 SQL 复杂，折叠之后单人通知量本来就不大）；打开收件箱时顺手删自己的旧通知（优雅但把 DELETE 塞进读路径，且不活跃用户永远清不到）。

---

## 9. 邮件：**不做**，且**什么都不为它留**

按方法论纠正判断：**「现在不建表以后要迁移」在空库上不成立，所以「为邮件预留列」是纯粹的成本。** `emailed_at` 列、`notification_pref` 表现在建也是空的，等真做邮件时 `rm -rf drizzle && generate && migrate` 是零成本。`mined-forum-mechanics` §4.10 已经把这句话说死了：「**不要预留 `emailedAt` 列，那是标准的 YAGNI 预留**」。

**通知表为邮件留的东西恰好是零**——因为它需要的唯一前置 `read_at`（「10 分钟未读则发摘要」的判据）本来就为站内已读而存在。

不做的真正理由不是「懒」，而是**前置链的每一环都是硬门槛**，加起来是一个独立里程碑：

1. **邮箱验证**。`auth.ts` 现在只有 `emailAndPassword: { enabled: true }`，没有 `sendVerificationEmail`，`user.emailVerified` 默认 false。往未验证邮箱发通知 = 有人拿别人的邮箱注册后，每条通知都变成发给陌生人的垃圾邮件 → 发信域名进黑名单。
2. **发信域名 + DNS**（SPF / DKIM / DMARC）+ 一个事务邮件服务商。
3. **退订**。通知邮件属可退订类，需要 `List-Unsubscribe` 头、一键退订落地页，以及一张真正的 `notification_pref(user_id, kind, in_app, email)`。
4. **退信与投诉 webhook**，否则硬退信累积会让发信信誉持续下滑。
5. **节流与摘要**。即时邮件对论坛通知几乎必然过量，实际要做的是「10 分钟未读 → 攒一封摘要」，那需要定时任务和「上次摘到哪」的水位线。

**一个必须承认的产品缺口**：审核拒绝通知，对一个刚投稿就被拒的新用户，可能是他唯一会看到的反馈——而新用户往往不会再回站。但这个缺口的正确解法不是邮件，而是**投稿完成页把「进了审核队列 / 预计多久 / 从哪看结果」讲清楚**，加上信任梯度让老用户根本不进队列。

**同样不做**：WebPush（VAPID + Service Worker + `push_subscription` 表 + 410 清理循环，零用户时收益为零，纯 additive）；SSE / WebSocket 实时（hono 写起来容易，**陷阱在部署**：api 一旦跑两个进程，A 进程的发帖推不给连在 B 上的用户，需要跨进程 pub/sub 也就是 redis 客户端，现在没有。「本地好用、上线扩容即坏」是最贵的一类技术债）；轮询（零用户时是给数据库加恒定负载）。

**徽标怎么更新**：`GET /api/me` 每个 SSR 页面本来就会被 root loader 打一次（`apps/web/app/root.tsx:74`），未读数搭这趟车，跟着导航自然刷新。**不占新路由**。

---

## 10. 契约与路由

```
GET    /api/notifications                      ?page&pageSize&unread=true
POST   /api/notifications/read                 { ids } | { before }
PUT    /api/shrine/topics/:id/subscription     { state: 'watching' | 'muted' }
PATCH  /api/me/handle                          { handle }        ← handle 子系统
```

未读数搭 `GET /api/me`；`handle` 也一并从 `/api/me` 返回（`Actor` 类型加一个字段）。订阅端点归属 M4 的 shrine 路由模块（`.route('/shrine', shrine)`），不另起命名空间。

```ts
// packages/shared/src/shrine/schemas.ts
export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  // z.coerce.boolean() 对字符串 "false" 会得到 true —— 必须显式转换
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
})

export const markReadSchema = z.union([
  z.object({ ids: z.array(entityIdSchema).min(1).max(100) }),
  z.object({ before: z.iso.datetime() }),
])

export const setSubscriptionSchema = z.object({ state: z.enum(SUBSCRIPTION_STATE) })

export const setHandleSchema = z.object({
  handle: z.string().regex(/^[a-z0-9_]{2,20}$/),
})
```

对照 M3 踩过的坑逐条自查：

| M3 的坑 | 本设计怎么避 |
|---|---|
| `.partial()` 不移除 `.default()` | 通知侧没有更新型 schema（只有「标记已读」「设订阅状态」两个全量小对象）。`setHandleSchema` 是独立端点，**不与其他 profile 字段合并成一个 PATCH** |
| id 分三种 | `notification.id` / `topic.id` 是 uuid → `entityIdParam`；`user_id` / `actor_id` 是 better-auth 的 32 位随机串 → `userIdSchema`；`handle` 是第四种形状，比 `slugIdSchema` 更窄 |
| `validate()` 而非裸 `zValidator` | 全部端点照用 |
| `:id` 路由要挂 param 校验 | 全部挂；且顺序写成 `requireAuth, entityIdParam`（不是反过来） |
| 白名单判断 | 订阅查询 `state === 'watching'`，绝不写 `!== 'muted'` |
| Hono 单值 query 是 string | `?unread=true` 用显式 `z.enum` + transform |
| api 不返回人类可读消息 | 新错误码 `mention_limit_exceeded` 进 `ERROR_CODES`，三语文案在 web 侧 |
| 楼层号靠 topic 行原子自增（持行锁） | 扇出的两次 SELECT（订阅者、handle 解析）**必须在事务外** |

**三语文案**：13 个 kind 各一条 + 「全部已读 / 收件箱为空 / 关注 / 取消关注 / 99+」等 UI 串，约 20 key × 3 份。渲染时**不能用 `m['notif_' + kind]()` 动态取键**（CLAUDE.md：代码里一律 `m.key()`），要写一张显式的 `Record<NotificationKind, (p) => string>` 映射表，让每个调用点都是字面量。人名与标题由查询 join 出来作为参数传入，**不进 payload**。

---

## 11. 代码量核算

| 文件 | 新/改 | 行 |
|---|---|---|
| `packages/shared/src/shrine/enums.ts` | 新 | 55 |
| `packages/shared/src/shrine/mention.ts` | 新 | 30 |
| `packages/shared/src/shrine/schemas.ts` | 新 | 30 |
| `packages/db/src/schema/shrine.ts` | 新 | 65 |
| `apps/api/src/notify.ts`（扇出 + `watchersOf` + `resolveHandles`） | 新 | 90 |
| `apps/api/src/modules/notifications.ts`（2 条路由 + 收件箱查询） | 新 | 75 |
| `content/post.ts` 挂点 + 订阅 + 提及上限 | 改 | +45 |
| `content/index.ts` 删楼留痕 + 挂点 | 改 | +18 |
| `moderation.ts` 2 挂点 | 改 | +12 |
| `kourindou/index.ts` 3 挂点 + 建 topic 时订阅 | 改 | +24 |
| `admin.ts` 2 挂点（含补 select） | 改 | +14 |
| `me.ts` 未读数 + handle | 改 | +12 |
| `errors.ts` / `app.ts` | 改 | +3 |
| web：收件箱页 + 顶栏徽标 + 订阅按钮 | 新/改 | 145 |
| **通知子系统本体小计** | | **≈ 618** |
| `handle` 子系统（schema 2 列 + CHECK、`session.ts` 生成、`PATCH /me/handle`、保留字） | 新/改 | 55 |
| `gc-notifications.ts` + package.json | 新 | 75 |
| 测试（`mention.test.ts` + `e2e.ts` 加 4 项） | 新/改 | 70 |
| 三语文案（JSON，非代码） | 改 | 60 |

**对照 M3 的审核模块**（实测行数）：`moderation.ts` 186 + `dash/queue.tsx` 205 + `dash/reports.tsx` 125 + `dash/layout.tsx` 62 = **578 行**。

通知子系统本体 **≈ 618 行**，与之同量级、略高（多出来的部分是收件箱查询的 5 个 join 与 13 个 kind 的渲染映射）。附属的 handle / GC / 测试与 M3 的 `gc-images.ts`（107）、`e2e.ts`（247）属同类，不计入对照。

**若实施中超出这个量级，按顺序砍**：

1. `like` 通知（3 行 + 1 enum 值）——若点赞本身推迟，它自动消失。
2. `resource_restored` 与 `report_resolved`（各 1 个 enum 值 + 3 行）——前者是礼貌，后者是闭环的一半。
3. 显式订阅按钮与 `PUT .../subscription`（≈25 行）——隐式订阅仍然工作，只是不能 mute。**这条最后砍**：`mined-forum-mechanics` 判断 mute 是「一旦有热闹主题就是紧急需求」。

**绝不砍**：折叠（砍了收件箱立刻变垃圾场，且已读语义随之崩塌）、`notify()` 的统一去重（砍了会撞 PG 21000）、SAVEPOINT（砍了通知子系统的任何 bug 都会连坐发帖）。

---

## 12. 明确不做

版块级订阅 · 订阅等级（watching/tracking/normal）· 用户屏蔽 · 通知偏好表 · `emailed_at` 列 · 邮件 · WebPush · SSE / 轮询实时 · 摘要 · 每小时提及配额 · mention 侧表 · event+inbox 两表拆分 · 按人数上限的清理 · 通知的搜索与筛选（除 `unread`）· 已读归档 · staff 待办通知 · 未读标记（read tracking）· 通知里存 URL。

**理由同一条**：库里没有数据，这些日后加是纯 additive，`rm -rf drizzle && generate && migrate` 零成本。**唯一不适用这条豁免的是 `handle`**，因为它同时进入「已对外发出的 URL」和「已发布的帖子正文」。

---

## 13. 需要站长拍板

挖掘阶段的 6 个开放问题，本文已自行裁决 4 个（handle 生成策略 = 自动生成 + 可自选一次；handle 是否可改 = 锁定 + SQL 代改；字符集 = 无连字符；被举报人是否通知 = 否）。剩下 2 个不该由设计者单方决定：

1. **`handle` 的字符集是最后一次可改的机会。** 本文定 `^[a-z0-9_]{2,20}$`（纯 ASCII、无连字符、长度 2–20）。它会出现在 `/u/:handle` 和所有已发布帖子的正文里，**发出去之后改动等于重写历史正文 + 死链**。请在 M4 动工前确认，尤其是「日本社团用户是否接受只能用 ASCII handle」——本文的判断是可以（显示名完全自由，handle 只是稳定标识，与 X / GitHub 的做法一致）。
2. **`/status` 绕开 `/review` 导致信任梯度不推进**（§4.5 顺带报告）。这是 M3 遗留的既有不一致，M4 要不要顺手收口（把 `pending->published` 从 `/status` 的允许集合里去掉，强制走 `/review`）？收口的话本文 §4.5 的 `review_approved` 分支可以一并删掉，少一个分支。

另有 3 条**与通知无关但本次调研中确认的既有缺口**，建议单独排期，不要塞进 M4 通知任务：

- `admin.ts:153-168` 的 `restore` 完全不写 `moderationLog`——审计链上的洞。
- `content/post.ts:99-101` 的 `catch {}` 把所有异常翻译成 404 `topic_missing`，闷死了 `post_topic_floor_uq` 的告警通道。
- `gc-images.ts` 的 `referencedUrls()` 不扫 `post.bodyMd`——M4 一旦允许帖子插图，第一次跑 `gc:images` 就会删光帖子里的图，且熔断挡不住（封面还在，引用集合非空）。**这一条必须在 M4 允许帖子插图之前修完。**
