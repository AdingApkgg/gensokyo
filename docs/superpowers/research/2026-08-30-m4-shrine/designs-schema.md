# M4 博丽神社：数据库 schema 设计

2026-08-30 · **设计草案，未经对抗审查，不得直接写进 `packages/` 或 `apps/`**

> M3 时有 agent 把未评审的 schema 草稿直接落库，含致命缺陷，整个 commit 被撤回。
> 本文的产出是**判断与理由**，代码块是判断的精确表达，不是可以复制粘贴的实现。

本文遵循 M3 留下的方法论纠正：

> **库里没有数据时，「现在不建表以后要迁移」这个论证不成立。**
> `rm -rf drizzle && generate && migrate` 是零成本的。真正不可逆的只有：
> **已对外发出的 URL / slug**、**法律留痕**。除此之外的「预留」一律按 YAGNI 处理。

据此，本文对每一处增量只接受两种理由之一：

1. **M4 上线当天就要用**（不是「以后会用」）；或
2. **它落在不可逆红线上**（对外 URL / 法律留痕）。

「现在加是一列的事」**不是**理由——正因为它是一列的事，以后加也是一列的事。

---

## 0. 结论速览

| 项 | 判断 | 一句话理由 |
|---|---|---|
| **版块** | **建表 `board`**（seed 写入，M4 无运行时写端点） | 唯一决定性理由是 `topic.boardSlug` 需要外键：没有它，一个拼错的 slug 就是一条对外不可见、对内查不出的孤儿主题 |
| **topic 加列** | `pinnedAt` ✅ `lockedAt` ✅ `featuredAt` ❌；`postCount` 改名 `floorSeq` | 置顶是「站长自己先发内容」这个最大杠杆的载体；锁帖是两视图整合的必然产物；加精是运营债 |
| **@提及** | **不建表**。写时解析进 `notification`，渲染时现查 | 这个「不建表」是用 handle 不可自助修改换来的——两个决定必须一起做 |
| **订阅** | **新表 `topic_subscription`**，不复用 `favorite` | 语义不同（下载 vs 出声）、主键不同（resource vs topic）、且订阅需要 `muted` 负状态，行不存在 ≠ 静音 |
| **通知** | **新表 `notification`**，宽表 + 写扇出 + `collapse_key` | 采纳挖掘阶段推荐，逐列复核后有 3 处修正（见 §7.4） |
| **点赞** | **新表 `post_like`** + `post.likeCount` 冗余计数 | 冷启动失败模式 B 的上半段；计数列与 `resource.ratingCount` 同模式 |
| **帖子举报** | `targetKind` **一个值都不用加**；`REPORT_REASON` 必须加 `spam` / `harassment` | 主题正文 = floor 1 的 post，`'post'` 全覆盖；而现有五个 reason 全是资源语义 |
| **handle** | `user_profile.handle` + `handleSetAt` | **M4 唯一命中不可逆红线的 schema 决定** |

**预算：4 张新表**（`board` / `topic_subscription` / `notification` / `post_like`）
**+ 5 个新列**（`topic.pinnedAt` / `topic.lockedAt` / `post.likeCount` / `user_profile.handle` / `user_profile.handleSetAt`）
**+ 1 处改名**（`topic.postCount` → `topic.floorSeq`）
**+ 1 处收窄**（`topic.lastPostAt` 改 NOT NULL）
**+ 2 个新 pgEnum**（`notification_kind` / `subscription_state`）
**+ 3 个既有枚举加值**。

明确**不建**的表：`post_image` · `post_mention` · `post_revision` · `topic_read` · `board_moderator` · `topic_tag` · `notification_pref` · `rate_limit` · `emoji` · `draft` · `notification_event`+`notification_inbox`（见 §11）。

自我约束复核见 §12：4 张表逐张辩护。

---

## 1. 判据：这次要防的是什么

M3 的调研 agent 提 28 张表被砍到 13 张。要避免重蹈覆辙，光说「少建表」没用，需要一条能当场判定的规则。本文用的是：

> **一张表的存在，必须能指认出 M4 上线当天的一次具体查询或一次具体写入。**
> 指不出来的，它就是把一个还没发生的需求提前编码成了拓扑。

这条规则对**列**同样成立，且对列更该严——列比表更容易混进来，因为「反正就一列」。

论坛的三种死法（挖掘阶段 §1）是本文所有「必须有」的靠山：

- **A 来了没东西看** → 资源讨论主题必须进全站最新流（§4.3 的 `lastPostAt` NOT NULL 就是为它服务的）
- **B 发了帖没人理** → 点赞（§8）+ 订阅（§6）+ 通知（§7）是同一条回路，缺一半就合不上
- **C 站长被垃圾压垮** → 限流（**不需要表**，redis 已在）+ 举报队列（**不需要新表**，接线即可）

---

## 2. 硬问题 1：版块是表还是常量

### 2.1 判断：**建表**。

### 2.2 为什么不是常量

先把常量方案说完整，否则「建表」这个结论没有分量。常量方案长这样：`BOARD_SLUGS` 数组进 `packages/shared`，六个多语名进 Paraglide（`m.board_tea_party()`），排序靠数组下标，零新表零迁移。它能跑，而且六个版块、solo 运营、不让用户建版块——三个前提全都指向常量。

我仍然选表，理由按强度排序：

**理由一（决定性）：`topic.boardSlug` 需要外键。**

`boardSlug` 现在是裸的 `varchar(32)`，没有任何约束。常量方案下它永远只能是裸的——常量不能被外键引用。于是：

- 任何写路径打错一个字符（`tea-party` vs `teaparty`），就产生一条主题，它**不出现在任何版块页**（版块页按 slug 精确匹配），却**出现在全站最新流**（最新流不按 slug 过滤）。作者能看到自己发出去了，站长要靠肉眼在数据里找。
- 版块 slug 改名时，没有任何机制告诉你「还有 37 条主题指着旧值」。

这是 legacy 缺陷目录 B 类（孤儿数据与引用完整性）的同一个形状。M3 花力气给 `post.parentId` 补上了自引用外键，就是因为「列存在但没有引用完整性」这件事的代价是**静默的、发现得晚的、修起来要人肉对账的**。`boardSlug` 是 M4 里唯一还剩的这种列。

**理由二：与 `resource_category` 完全同构，抄现成的形状比发明第二种机制便宜。**

M3 已经就「固定的、站长控制的、需要多语名的分类」做过一次判决——`resource_category` **不是 pgEnum**，是查找表，注释写着「因为要挂多语名与图标」。版块与它的差别只有名字。项目里已经有这个形状的表、有 seed 脚本的写法、有前端消费 jsonb 多语名的写法。常量方案要求版块名走 Paraglide，也就是要求版块名与其他所有业务分类走**两套不同的多语机制**——那是一个需要每次都记住的例外。

**理由三：版块描述是版块在 0 帖时唯一的实际用途。**

挖掘阶段 §3.1 的判断是：0 帖时版块的用途不是分流（没有东西可分），而是**设定预期**（「这里该发什么」）。承载预期的是描述文字，三语，两三句话。放 Paraglide 也行，但描述是站长会反复调整的运营文案——每次改一个字要走一次代码部署。

**理由四（反向的、也要说清楚的）：这张表 M4 没有写端点。**

「建表」不等于「建一套 CRUD」。`board` 在 M4 是**只读的**：

- **谁写**：`packages/db/scripts/seed.ts`，与 `resource_category` / `tag` 的六类种子并排。加第七个版块 = 往 seed 里加一行 + 重跑（或一条 `INSERT`）。
- **谁不写**：没有 `POST /boards`、没有 `PATCH /boards/:slug`、没有 admin UI。因此不需要权限判断、不需要 `MODERATION_ACTION` 加值、不需要审计。
- **删版块**：外键选 `restrict`，DB 层直接拒绝删除还有主题的版块（见 §10）。这是刻意的——关一个版块 = 一批对外 URL 变死链，属于不可逆那一类，必须让站长撞到一堵墙而不是撞到一个 cascade。

对「一张永远不通过 API 写的表就是带 join 的常量」这个反驳：**join 的对象是 6 行，Postgres 会把它永久放在共享缓存里；换来的是外键。** 这笔账不用算。

### 2.3 表定义

```ts
// 草案 · packages/db/src/schema/content.ts（board 放这里，不放 shrine.ts——
// 理由是 topic 要引用它，而 notification 要引用 topic；把 board 放进 shrine.ts
// 会让 content.ts ↔ shrine.ts 互相 import，产生循环）

/**
 * 版块。与 resource_category 完全同构的查找表：固定几行、站长控制、要挂多语名。
 *
 * **M4 没有写端点**——只由 packages/db/scripts/seed.ts 写入。
 * 加版块 = 加一行种子（零成本）；关版块 = 一批对外 URL 死链（不可逆），
 * 因此 topic.boardSlug 的外键是 restrict 而不是 cascade/set null。
 */
export const board = pgTable('board', {
  /** 对外 URL 的一段：/shrine/b/:slug。定了就不能改 */
  slug: varchar('slug', { length: 32 }).primaryKey(),
  /** 三语齐全由 seed 保证，缺失时前端回落 zh——与 resource_category 同处理 */
  name: jsonb('name').$type<LocalizedText>().notNull().default({}),
  /** 「这里该发什么」。0 帖时这是版块唯一的实际用途 */
  description: jsonb('description').$type<LocalizedText>().notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
```

**索引**：只有主键。六行的表加任何索引都是负收益（`ORDER BY sort_order` 对 6 行是排序算法的常数项）。

**刻意没有的列**：

| 没加 | 为什么 |
|---|---|
| `state`（open/archived） | M4 不会归档任何版块。真要归档时加一列 + 白名单判断，additive。**触发条件写在这里**：第一次想关版块时加，别提前 |
| `topicCount` / `lastPostAt` | 冗余计数需要在每次发帖时多写一行**版块**行——那会让同一版块的所有发帖串行在一行上（这与 §7.4 拒绝 `unreadCount` 是同一条理由）。6 个版块的计数直接 `GROUP BY` 聚合 |
| `parentSlug`（子版块） | 挖掘阶段 §4.1：六个空房间再切一层就是 24 个空房间 |
| `nameOriginal` | `tag` 有它是因为标签名来自外部（社团名、日文原题）需要回落；版块名是站长自己写的，三语必然齐全 |

---

## 3. 硬问题 2：topic 要加什么列

现有列：`kind` / `resourceId` / `boardSlug` / `title` / `authorId` / `postCount` / `lastPostAt` / `deletedAt` / `createdAt`。

### 3.1 `pinnedAt timestamptz` —— **加**

**不是**因为要对抗信息流冲刷（0 帖时没有冲刷）。真实理由是它是**「站长自己先发内容」这个最大杠杆的载体**：六个版块各钉一条「这个版块发什么 / 从这三个话题开始」的引导帖，是 solo 站长唯一零成本的内容注入手段。

这个功能在 M4 的验收清单里（六版块各一条引导帖），所以它满足判据 1（上线当天就要用）而不是判据「以后可能要」。反过来说：**如果 M4 的计划里没有「发六条引导帖」这一步，这一列应该砍掉。** 这是本列的证伪条件。

用 `timestamptz` 而不是 `boolean`：多条置顶时排序确定，且自带「何时置顶」——不需要为它单独写审计。

### 3.2 `lockedAt timestamptz` —— **加**，但语义与挖掘阶段的建议不同

挖掘阶段 §3.8 的「理由二」是：资源被下架 / 软删时，讨论主题必须自动锁，否则「资源 404 了评论区还能发新楼」。

**这个后果是真的，但用「自动写 lockedAt」去解决是错的。** 理由：

- 那会让 `lockedAt` 有两个写入者（版主的锁帖动作、资源状态机的下架动作），而它们**不知道对方存在**。序列 `版主锁帖 → 资源下架 → 资源重新上架 → 自动解锁` 会静默撤销版主的处置。这正是 M3 计划里说的「分层边界没有编译器保护，必然漂移」。
- 而资源侧的可见性本来就是一次 PK join 就能拿到的东西（`topic.resourceId → resource.status`），没有理由把它反范式成第二份真相。

**正确形状**：

```ts
/** 只由 staff 的锁帖动作写入。资源下架导致的「不能再发」不走这一列，见下 */
lockedAt: timestamp('locked_at', { withTimezone: true }),
```

配套一个**唯一的**可见性判断函数，两种 kind 在同一个函数里（这同时是挖掘阶段 N3 / A1 的修法）：

```ts
// 草案 · apps/api/src/modules/content/post.ts
/**
 * 主题的可写/可见判定，**白名单**。
 * N3：M3 时 createPost 查了 topic.deletedAt 而 listPosts 完全不碰 topic 行，
 * 靠资源侧路由 publishedTopic() 在外面把关侥幸过关。M4 有第二个调用方，
 * 判定必须收口到这里——否则版块主题被版主软删之后楼层照列。
 */
export async function visibleTopic(topicId: string) {
  const [row] = await db
    .select({
      id: topic.id,
      kind: topic.kind,
      lockedAt: topic.lockedAt,
      resourceStatus: resource.status,
      resourceDeletedAt: resource.deletedAt,
    })
    .from(topic)
    .leftJoin(resource, eq(resource.id, topic.resourceId))
    .where(and(eq(topic.id, topicId), isNull(topic.deletedAt)))
    .limit(1)
  if (!row) return null
  // 白名单：resource 主题只在资源 published 且未软删时可见
  if (row.kind === 'resource') {
    if (row.resourceStatus !== 'published' || row.resourceDeletedAt) return null
  }
  return row // 调用方再判 lockedAt（读可以，写不行）
}
```

于是「资源下架 → 评论区自动停写」是这个 join 的**推论**，不是一次额外的写入。`lockedAt` 保持单一写入者。

### 3.3 `featuredAt`（加精）—— **不加**

- N=0 时它标记不出任何东西（加精是从 N 条里挑 top 5% 的操作）。
- 它一旦存在，站长就欠下一份「持续评选」的运营债，与「低人肉运营」这个架构前提直接冲突。
- 以后补：一列 `featuredAt` + 一个 staff 端点，additive。

这条是判据的标准应用：**它不属于 M4 的验收内容**，因此不加。

### 3.4 `postCount` → `floorSeq` —— **改名**（挖掘阶段 N2 的收口）

现在 `postCount` 身兼两职：`createPost` 拿它当楼层分配器（`UPDATE ... RETURNING` 原子自增），同时它显然也是「共 N 条回复」的数据源。M3 场景自洽，因为已删楼层作为占位渲染，行数 = postCount。

挖掘阶段建议拆成「只增不减的水位」+「可增可减的展示计数」。**我只采纳一半：改名，不加 `replyCount`。**

- **改名必须做**。`postCount` 这个名字在字面上邀请人写 `SET post_count = post_count - 1`。真写了会怎样：下一次发帖分配到一个已存在的楼层号 → `post_topic_floor_uq` 抛唯一违例 → 被 `createPost` 的 `catch {}` 翻译成 `404 topic_missing`（挖掘阶段 N4），于是**这个主题从此再也发不出帖，而错误信息说的是「主题不存在」**。改名成 `floorSeq` 的成本是三处引用，收益是让这条路走不通。
- **`replyCount` 不加**。找不到 M4 上线当天需要它的查询：论坛内容一律软删且保留楼层占位（§6.3 的删除语义），所以渲染行数恒等于 `floorSeq`；硬删只走站长本地脚本，而那个脚本 M4 不存在。展示值直接从 `floorSeq` 推：版块主题减 1（floor 1 是正文），资源主题不减（没有正文楼）——那是序列化层的一行三元表达式。
- **触发条件**：真写出楼层硬删脚本的那一天，加 `replyCount` 并由该脚本维护。在此之前它是纯预留。

```ts
/**
 * 楼层水位：**只增不减**。楼层号由对本行的原子自增分配（UPDATE 持行锁），
 * post_topic_floor_uq 是兜底。绝不因删楼而递减——递减会让下一次发帖撞上
 * 已存在的楼层号，而那个唯一违例现在会被伪装成 404。
 * 展示用的「回复数」由它推导，不另存一列（M4 无楼层硬删路径）。
 */
floorSeq: integer('floor_seq').notNull().default(0),
```

### 3.5 `lastPostAt` 改 **NOT NULL DEFAULT now()** —— 这一处是为失败模式 A 服务的

现在它可空。两个后果：

1. **排序错误**：PG 的 `ORDER BY x DESC` 默认 **NULLS FIRST**。全站最新流写 `ORDER BY last_post_at DESC`，会把所有零回复的主题顶到最前面——恰好是最不该在首屏的东西。这是一个上线当天必然发生、且很容易被误当成「排序写错了」的 bug。
2. **供血管道漏了一半**：一个刚发布、还没人评论的资源，它的讨论主题 `lastPostAt IS NULL`。如果最新流按 `lastPostAt` 排且过滤掉 NULL，**新资源根本不进论坛首页**——而「资源站给论坛供血」正是这条流存在的全部理由。

改成 `NOT NULL DEFAULT now()` 之后语义变成「**最后活动时间，无回复时即创建时间**」。新资源发布即进最新流，零回复也在，排序无歧义，索引不需要 `NULLS LAST`。

### 3.6 `title`：`kind='resource'` 时必须为 **NULL**（这是在修一个既有 bug）

`apps/api/src/modules/kourindou/index.ts:194-200` 建资源主题时写了 `title: row.titleOriginal`。这是快照，而且：

- **它不更新**。`PATCH /resources/:id` 改 `titleOriginal` 不碰 topic 行 → 论坛最新流里显示的是旧标题。M3 从不读 `topic.title`，所以没暴露；M4 的最新流第一个读它。
- **它是单语的**。资源标题是 `titleOriginal` + `title jsonb` 三语；快照进 `varchar(200)` 等于**把最新流里的资源条目锁死成一种语言**，直接违背「面向全球 / 业务数据多语字段」。

正确做法：资源主题不存标题，最新流 join `resource` 拿 `titleOriginal` + `title` 走 `resolveLocalized()`——反正为了拿 `slug` 生成链接本来就要 join。

用 CHECK 把这个不变量钉死：

```ts
/**
 * 「一套内容系统两个视图」的形状不变量，现在零约束。
 * 资源主题不存标题（标题的唯一真相在 resource 行，且它是三语的）；
 * 版块主题必须有标题和版块。
 */
check(
  'topic_kind_shape',
  sql`(${t.kind} = 'resource' and ${t.resourceId} is not null
       and ${t.boardSlug} is null and ${t.title} is null)
   or (${t.kind} = 'board' and ${t.boardSlug} is not null
       and ${t.resourceId} is null and ${t.title} is not null)`,
)
```

### 3.7 明确不加的 topic 列

| 没加 | 为什么 |
|---|---|
| `slug`（主题 URL 的装饰段） | URL 形状 `/shrine/t/:slug/:id`（Discourse 式）是**路由层**决定，slug 由标题实时派生、不匹配就 301。存一列 = 标题可编辑而 slug 会过期的第二份真相 |
| `viewCount` | 把一次写放到读路径上，换一个 0 流量时无人看的数字 |
| `lastPostId` / `lastPosterId` | 版块列表要显示「最后回复者」，但每行一次 lateral join（20 行 = 20 次索引查找）足够，且这是**要在删楼时维护的**冗余 |
| `featuredAt` | §3.3 |
| `replyCount` | §3.4 |
| `tagIds` / 主题标签 | 挖掘阶段 §4.3，规模型 |

---

## 4. 硬问题 3：@提及要不要独立成表

### 4.1 判断：**不建表。** 写时解析 → 落 `notification`；读时按 `@handle` 现查渲染。

三条路径分别对应三个位置：

| 时刻 | 做什么 | 落在哪 |
|---|---|---|
| 发帖 | `extractMentions(bodyMd)` 纯函数抽 handle → 一次 `SELECT user_id FROM user_profile WHERE handle IN (...)` → 扇出 | `notification`（kind=`mention`，带 `post_id`） |
| 渲染 | 再跑一次同一个抽取器，把命中的 handle 换成 `/u/:handle` 链接 | 无存储 |
| 编辑 | `extractMentions(新) \ extractMentions(旧)` 的差集才发通知 | 无存储 |

抽取器放 `packages/shared/src/shrine/mention.ts`，**收发两侧共用同一个函数**——这是项目「类型主轴 = 单一事实来源」原则在文本上的应用。两边不一致的直接后果是：用户收到「你被提及」但帖子里没有链接（或反过来）。

### 4.2 为什么不需要 `post_mention(post_id, user_id)` 侧表

一张 mention 侧表能回答两个问题：

1. **「谁被这条帖提及了」** —— 通知已经回答了（`notification` 里 kind=`mention` + `post_id` + `user_id` 就是这条边）。侧表是同一条边的第二份拷贝。
2. **「改名之后旧帖里的 @old 还能指对人」** —— 只有在 handle 可自助修改时才是个问题。

所以：

> **「@提及不建表」这个结论，是用「handle 不可自助修改」买来的。这两个决定必须一起做，不能只采纳一个。**

如果站长选择放开 handle 自由改名，本节结论作废，必须回到侧表方案（或把正文规范化成 `@[name](user:<id>)`，代价是正文不再是人能手写的 Markdown）。这一点写在 §9 的开放问题里。

### 4.3 抽取规则要点（不涉及 schema，但影响 handle 的字符集选择）

```ts
// 草案
const MENTION_RE = /(?<![\p{L}\p{N}_/@.])@([a-z0-9_]{2,20})(?![\p{L}\p{N}_])/giu
```

- **解析可以偏宽松**，因为结果必须再过一次「这个 handle 存在吗」的查库。不存在 → 什么都不发生。这条安全网让我们不必为了 @ 引入 Markdown AST 依赖。
- 前置断言排除邮箱（`foo@bar`）与 URL（`x.com/@marisa`）。
- 代码块里的 `@` 先剥掉；剥不干净的失败模式是「少发一条通知」，无害。
- **不 @ 自己**、**每帖上限 10 且超出直接拒绝**（新错误码 `mention_limit_exceeded`）、**一帖对一人只发一条**（优先级 `mention > reply > topic_reply`，在扇出辅助函数里统一裁决，不在各调用点各写一遍）。

---

## 5. 硬问题 4：订阅怎么存，能不能复用 favorite

### 5.1 判断：**新表 `topic_subscription`。不能复用 `favorite`，也不该。**

三条理由，任何一条单独都够：

**一、主键不兼容。** `favorite` 是 `(resource_id, user_id)` 复合主键，`resourceId` 是 `NOT NULL` 且外键指 `resource`。订阅的主体是 `topic`，而**版块主题根本没有 resource**。复用就要把 `resourceId` 改成可空、再加一个可空 `topicId`、再加一个「二者恰有其一」的 CHECK——把一张两列表改造成多态表，比新建一张干净的表贵。

**二、语义不同，耦合了就拆不开。** 收藏 = 「我要下载它 / 我要收着」；订阅 = 「这里有人说话就告诉我」。合表意味着**取消收藏会静默退订**——用户不再想下载某个资源，但仍在跟这个帖子的讨论，这是完全正常的组合。

**三（决定性）：订阅有负状态，收藏没有。** 取消订阅**必须写一行 `state='muted'`，不能删行**：

```ts
state: subscriptionState('state').notNull().default('watching'), // 'watching' | 'muted'
```

如果取消订阅是 `DELETE`，那么「回复即订阅」会在用户下一次回复这个主题时立刻把他加回来——用户会认为退订功能坏了。所以状态必须显式存在。而 `favorite` 的语义里「行不存在」就是完整的否定，它没有、也不该有这一列。

**该复用的是形状，不是表**：复合主键 + `(userId)` 反向索引，与 `favorite` / `rating` 一模一样（legacy 这点做对了，M3 沿用，M4 继续）。

### 5.2 表定义

```ts
// 草案 · packages/db/src/schema/shrine.ts
export const subscriptionState = pgEnum('subscription_state', SUBSCRIPTION_STATE)
// SUBSCRIPTION_STATE = ['watching', 'muted'] as const

/**
 * 主题订阅。发起主题 / 回复主题自动订阅（隐式），显式「关注」按钮写同一张表。
 *
 * 取消订阅写 state='muted' 而**不删行**：删行的话下一次回复会被
 * 「回复即订阅」立刻加回来。同理，回复时的 upsert 必须是 DO NOTHING —— 
 * DO UPDATE state='watching' 会把 muted 顶掉，是同一个 bug 的另一种写法。
 */
export const topicSubscription = pgTable(
  'topic_subscription',
  {
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topic.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    state: subscriptionState('state').notNull().default('watching'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.userId] }),
    /** 「我订阅的主题」列表。扇出查询走主键前缀 (topic_id)，不需要额外索引 */
    index('topic_subscription_user_idx').on(t.userId),
  ],
)
```

**查询模式**：

| 查询 | 走哪个索引 |
|---|---|
| 扇出：`WHERE topic_id = $1 AND state = 'watching' LIMIT 500` | 主键前缀。**白名单**判 `= 'watching'`，绝不写 `!= 'muted'`（将来加第三个状态时会漏） |
| 「我订阅的主题」 | `topic_subscription_user_idx` |
| 「我订阅了这个主题吗」（主题页的按钮状态） | 主键 |

**为什么不加 `source` 列**（隐式/显式来源）：挖掘阶段的形状里带了它，但指不出 M4 有哪一个查询按它过滤。UI 只需要知道「现在是 watching 还是 muted」。

**扇出的 `LIMIT 500`** 不是 schema 的事，但要写进设计：它是防止某天一个主题被脚本订阅一万次拖垮发帖的唯一闸门，零流量时永远撞不到。

---

## 6. 硬问题 5：通知表长什么样

采纳挖掘阶段的推荐方案（宽表 + 写扇出 + `collapse_key` 折叠 + `read_at`），逐列复核后有 3 处修正（§6.4）。

### 6.1 为什么是宽表而不是 event + inbox

复述判据，因为它是本表全部形状的地基：

> **无论选哪个方案，per-user 的 `read_at` 都必须有一行来装。**
> 既然那一行本来就要付，event 侧表节省的只是那几十字节的冗余列，
> 代价却是在**最热的读路径**（每次开收件箱、每次算未读数）上加一次 join。

拆表值得的临界点约在「单次扇出 > 50 人」。本站一个主题的订阅者长期是 1–20 人。真到那天，A → C 是一次可离线做的 `INSERT ... SELECT`。

### 6.2 表定义

```ts
// 草案 · packages/db/src/schema/shrine.ts
export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KIND)
// NOTIFICATION_KIND = ['reply','topic_reply','mention','moderation','mod_queue'] as const

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 收件人。收件箱是用户私有数据，删号必须一起走 */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    kind: notificationKind('kind').notNull(),

    /**
     * 触发者。set null 而非 cascade —— 与 resource.uploaderId /
     * moderationLog.actorId 同理：「你曾被回复过」这件事不该因为对方注销而消失。
     * 渲染成「某位用户」。
     */
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    /**
     * subject 用类型化可空外键，不用 moderation_log 那种多态 text id。
     * 判据是访问模式：收件箱每次渲染都要显示「在《主题标题》的 12 楼」，
     * 多态 id join 不了，会退化成按 kind 分组的 N+1。
     * （moderation_log 选多态是对的——它是审计，硬删之后记录还得在。）
     */
    topicId: uuid('topic_id').references(() => topic.id, {
      onDelete: 'cascade',
    }),
    postId: uuid('post_id').references(() => post.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').references(() => resource.id, {
      onDelete: 'cascade',
    }),

    /** null = 不折叠。PG 唯一索引里 NULL ≠ NULL，所以不折叠的种类不需要任何分支 */
    collapseKey: varchar('collapse_key', { length: 96 }),
    count: integer('count').notNull().default(1),

    /**
     * 只放枚举 key、id 和数字。**绝不放句子，也不放人名**——
     * 存了中文句子，用户切到 /ja 会看到一个永远是中文的收件箱；
     * 存了人名快照，对方改名后收件箱里还是旧名字（人名一律 join 出来）。
     * 唯一例外：subject 会被硬删的场景（admin purge），此时存标题快照，
     * 与 moderation_log.subjectId 用 text 是同一条道理的两次应用。
     */
    payload: jsonb('payload').$type<NotificationPayload>().notNull().default({}),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** 收件箱主查询：WHERE user_id=$1 ORDER BY created_at DESC */
    index('notification_user_created_idx').on(t.userId, t.createdAt.desc()),
    /**
     * 未读数 COUNT + 「全部已读」的 before 游标更新，两个查询共用。
     * 部分索引只装未读行——用户读完，行就从索引里消失，索引尺寸跟着「未读量」
     * 而不是「历史总量」走。这就是为什么不需要反范式计数器。
     */
    index('notification_unread_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    /** 折叠：一个主题对一个用户最多 1 行未读 */
    uniqueIndex('notification_collapse_uq')
      .on(t.userId, t.collapseKey)
      .where(sql`${t.readAt} is null and ${t.collapseKey} is not null`),
    check('notification_count_positive', sql`${t.count} >= 1`),
  ],
)
```

`payload` 的类型（放 `packages/shared`）：

```ts
export type NotificationPayload = {
  /** moderation 类：复用既有的 MODERATION_ACTION，不另造一套 */
  action?: ModerationAction
  rejectReason?: RejectReason
  reportReason?: ReportReason
  /** mod_queue 类：哪个队列 */
  queue?: 'resource' | 'report'
  /** **仅** admin purge：subject 会被级联删掉，此时存标题快照 */
  subjectTitle?: string
}
```

### 6.3 折叠：本表最高杠杆的一个决定

没有折叠：200 楼的主题对每个订阅者产生 200 行未读，收件箱变垃圾场，用户第一反应是关掉通知。
有折叠：一个主题对一个用户最多 1 行未读，内容是「有 37 条新回复」。

```ts
await tx.insert(notification).values(rows).onConflictDoUpdate({
  target: [notification.userId, notification.collapseKey],
  // targetWhere 必须与索引谓词**逐字一致**，否则 PG 找不到 arbiter，报
  // "there is no unique or exclusion constraint matching the ON CONFLICT specification"
  targetWhere: sql`read_at is null and collapse_key is not null`,
  set: {
    count: sql`${notification.count} + 1`,
    actorId: sql`excluded.actor_id`,
    postId: sql`excluded.post_id`,
    createdAt: sql`now()`, // 冒泡到收件箱顶部
  },
})
```

| kind | collapse_key | 理由 |
|---|---|---|
| `reply` | `reply:<topicId>` | 5 个人回我同一楼 → 「5 人回复了你」 |
| `topic_reply` | `sub:<topicId>` | 折叠的主战场 |
| `mention` | **null** | @ 是点名，每一次都要单独看见 |
| `moderation` | **null** | 每条都是对用户有行动含义的独立决定，数量天然极少。折叠会吞掉拒绝理由，而那是用户唯一能据以改进的信息 |
| `mod_queue` | `queue:resource` / `queue:report` | 站长只需要知道「有 7 件待办」 |

三个必须写进设计的性质：

1. 索引是**部分**的（`WHERE read_at IS NULL`），所以「已读之后再来新回复」会新建一行——这正是想要的。
2. `createdAt` 被推到 `now()` 会让该行跳到收件箱顶部，并**逃出「全部已读」的 `before` 游标**——而这恰好正确：有新动静就该保持未读。
3. **先有折叠，才敢默认「回复即订阅」**。这是本设计不需要 Discourse 那套 watching/tracking/normal/muted 四级订阅的结构性原因。

### 6.4 对挖掘阶段草案的 3 处修正

**修正一：`notification_unread_idx` 从 `(user_id)` 改成 `(user_id, created_at)`。**
挖掘阶段草案是 `.on(t.userId).where(read_at is null)`。但「全部已读」的写法是
`UPDATE ... WHERE user_id=$1 AND read_at IS NULL AND created_at <= $2`——
带 `created_at` 的索引让它变成一次范围扫描而不是「取出全部未读再逐行比较」。
未读数 COUNT 仍走同一个索引的前缀。**一个索引服务两个查询**，不需要第三个。

**修正二：不为 GC 建索引。**
`gc-notifications.ts` 的两条 DELETE（按 `read_at` / `created_at` 的绝对时间）无法命中上面任何一个索引，会是 seq scan。**这是刻意的**：为它建索引意味着在**最热的写路径**（每次发帖的扇出）上多维护一个索引，换一个每天跑一次、扫一张小表的脚本。等 `notification` 真的大到 GC 跑不动时再加，那时是纯 additive。

**修正三：`count` 列名的 SQL 交互。**
`count` 在 PG 里不是保留字，但在裸 SQL 里写 `count >= 1` 容易被人误读成函数调用。所有涉及它的 `sql` 模板一律用列引用插值（`sql\`${t.count} >= 1\``），drizzle 会渲染成带引号的 `"count"`——与 `rating_score_range` 的既有写法一致。

### 6.5 产生时机（影响 schema 的部分）

**同请求、同事务**，不做 outbox、不做队列、不做触发器、不做 `LISTEN/NOTIFY`。

M3 已经就同一问题判过一次（`search_outbox` + worker 被砍），但通知与搜索索引有一个关键差别：**通知不可重算**（重算「谁在什么时候被回复了」需要重新遍历全部帖子且无法知道发过没有），所以「事务提交后投递」的丢失是**永久且不可察觉**的。

对 schema 的两个推论：

1. **扇出的 SELECT（订阅者、被提及者）必须在事务外。** 楼层号靠 `UPDATE topic ... RETURNING` 原子自增并持行锁，整个主题的并发发帖在此串行化。把 SELECT 塞进事务 = 延长这把锁的持有区间。
2. **扇出 INSERT 用 SAVEPOINT（`tx.transaction()`）隔离**，通知子系统的任何 bug 都不该炸掉发帖；但单收件人的审核结果通知直接同事务写、不包——它和旁边那条 `moderationLog` 是同一份事实，要么都在要么都不在。

### 6.6 明确不加的通知相关结构

| 没加 | 为什么 |
|---|---|
| `notification_pref`（偏好开关） | 只有站内一个渠道时，偏好表能表达的只有「全关」——而那等于「不看收件箱」。做邮件时再说 |
| `unreadCount` 反范式列 | 它把每次扇出变成对**收件人 profile 行**的 UPDATE（同一个热门用户的所有通知在他那一行上串行），且要在插入/折叠/单条已读/全部已读/GC 删除五处同步维护，漏一处永久漂移。部分索引 COUNT 是自愈的，计数器不是 |
| `userProfile.notificationsSeenAt` 水位线 | 挖掘阶段的两份材料在这里冲突：forum-mechanics §3.6 建议水位线，notification §2.4 建议 `read_at`。**采纳 `read_at`**——水位线会造出两个真相源（「在水位线之前创建、但在水位线更新之后才可见的行」天生已读），且逐条已读做不了。水位线唯一的优势是「全部已读」不用 UPDATE N 行，而 §6.4 修正一让那次 UPDATE 走索引范围扫描，N 天然有界 |
| `emailedAt` / `pushedAt` | 标准的预留。做邮件是一个独立里程碑（邮箱验证 → 发信域名 DNS → 退订 → 退信处理 → 摘要节流），不是一个勾选框 |

---

## 7. 硬问题 6：点赞要不要

### 7.1 判断：**要，新表 `post_like` + `post.likeCount` 冗余计数。**

`rating` 是资源评分（1–5 星，复合主键，带 `ratingSum`/`ratingCount` 聚合），与帖子点赞完全是两件事：目标不同（resource vs post）、值域不同（1–5 vs 有/无）、聚合方式不同（求平均 vs 计数）。不复用。

**为什么必须在 M4 就有**：它是冷启动失败模式 B 的上半段。5 人在线的论坛里，发帖者收到 3 个赞和收到 0 条回复是完全不同的留存结果，而让这 3 个人各写一段回复不会发生。没有点赞，反馈根本不产生；没有通知，反馈产生了发帖者也看不见——**两者是同一条回路的两半，必须一起做，缺一半都合不上**。

**单向，不做踩**：踩在小社区是可归因的社死；它唯一的正当价值（内容过滤排序）在内容量为 0 时不存在；且加踩是 additive，撤踩不是（用户已经承受过的体验收不回来）。

**表名叫 `post_like` 不叫 `post_reaction`**：`post_reaction` 会邀请人「顺手」加一个 `kind` 列，那正是要避免的预留。多 emoji 反应真要做时，改名 + 加列是一次 `ALTER TABLE`。

### 7.2 表与列

```ts
// 草案 · packages/db/src/schema/shrine.ts
export const postLike = pgTable(
  'post_like',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => post.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
)
```

```ts
// content.ts · post 表加一列
/**
 * 冗余计数，与 resource.ratingCount 同模式：同事务用 SQL 表达式增减，非读改写。
 * 可随时重算（select count(*) from post_like），因此漂移是可修复的。
 */
likeCount: integer('like_count').notNull().default(0),
```

### 7.3 两个必须交代的判断

**为什么这里接受冗余计数，而 §6.6 拒绝 `unreadCount`？** 判据不是「冗余好不好」，是两条具体的差别：

| | `post.likeCount` | `notification` 的 unreadCount |
|---|---|---|
| 计数落在谁的行上 | **被赞的帖子**行 → 争用是 per-post，天然分散 | **收件人的 profile** 行 → 一个活跃用户的所有通知都在他那一行上串行 |
| 维护点 | 2 个（点赞 / 取消） | 5 个（插入 / 折叠 / 单条已读 / 全部已读 / GC 删除） |

**为什么不用聚合查询代替计数列？** 渲染一页 30 个楼层时，本来就要 join 一次 `post_like`（判断「我赞过没有」，走主键 `(post_id, user_id)`）。计数如果不落列，就要**第二次**扫 `post_like` 做 `GROUP BY`。一列换掉一次聚合，而且这一列的所有写入都在已有的事务里。

**`post_like_user_idx` 不建**：M4 侧没有「我赞过的帖子」这个页面（个人主页聚合的是帖子 + 资源 + 收藏）；「我赞过这 30 楼吗」走主键前缀。代价是删号时 PG 要 seq scan 找该用户的点赞行——而删号是站长手动的罕见动作。**触发条件**：账号自助注销上线时，加这个索引。

**已知的、有界的漂移**：`post_like.userId` 是 cascade，删一个用户会静默移除他的点赞行而 `likeCount` 不减。修法是一条重算 SQL。**这不是新问题**——M3 的 `rating.userId` 是 cascade 而 `resource.ratingSum` 同样不减，是同一个既有形状。建议把两者的重算写进同一个 `scripts/recount.ts`，与 `gc-images.ts` 同形（见 §13）。

---

## 8. 硬问题 7：帖子举报怎么进现有 report 表

### 8.1 `targetKind` **一个新值都不用加**

`report.targetKind` 是 `varchar(16)`，DB 层无枚举无 CHECK 无外键；唯一闸门是 `createReportSchema` 里就地写的 `z.enum(['resource','post'])`。也就是说 **`'post'` 早就在支持列表里，`interactions.ts` 的 post 分支（存在性校验 + 自举报拦截）M3 时就写完了**。

不需要 `'topic'` 值，前提是**主题正文落成 floor 1 的 `post`**（`topic` 表没有正文列，本设计也不加）。于是「举报主题」= 举报 floor 1，`'post'` 全覆盖。这是「不加正文列」这个决定的一个额外红利，值得记下来。

**不把 `targetKind` 升成 pgEnum**：多态列升 pgEnum 后每加一种可举报对象都要一次 DDL，而 zod 那道闸门已经是唯一写入口。

**建议加一个 `REPORT_TARGET_KIND` 常量**到 `packages/shared`，把 `z.enum(['resource','post'])` 的就地字面量提出来——散落的字面量是漂移源，项目其他枚举全部走常量数组。这不是 schema 改动。

### 8.2 `REPORT_REASON` **必须加值**，这才是真正的缺口

```ts
export const REPORT_REASON = [
  'copyright', 'illegal',
  'spam',        // ← 新增
  'harassment',  // ← 新增
  'broken_link', 'wrong_info', 'other',
] as const
```

现有五个值全是资源语义：`broken_link`（网盘失效）和 `wrong_info`（元数据写错）对帖子毫无意义，而论坛最高频的两类举报——**广告灌水**和**人身攻击/骚扰**——一个都没有。用户只能选 `other`，举报队列退化成一堆无分类噪音，而「按 reason 分优先级」正是这套治理机制的核心（`moderation.ts` 按信任排队列、`dash/reports.tsx` 把 copyright/illegal 提前）。

**不加 `off_topic`**：冷启动期版块划分本就模糊，跑题举报大概率是噪音。
**不为帖子拆一份 `POST_REPORT_REASON`**：`report` 是单表单队列，拆枚举会让后台 UI 维护两套标签映射与两套排序规则。保持一份枚举，在前端按 `targetKind` 过滤可选项。

### 8.3 `MODERATION_ACTION` 只加 **一个**值（这里我推翻挖掘阶段的建议）

挖掘阶段 P1-1 主张加 `post_delete`，理由是「现有 10 个 action 里没有能表达删楼的，而 `status_change` 是资源状态机专用」。

**`status_change` 确实是资源专用，但 `soft_delete` 不是。** 它是通用动词，而 `moderationLog.subjectKind` 就是用来区分对象类型的（这正是 M3 把它做成多态审计的理由）。`soft_delete` + `subjectKind='post'` 精确表达「删了某一楼」，`subjectKind='topic'` 表达「删了某个主题」。加 `post_delete` 会造出一个「同一件事有两个动词」的审计日志，比缺一个动词更糟。

**真正缺的是锁帖**——没有任何现有动词能表达它：

```ts
export const MODERATION_ACTION = [
  ..., 'soft_delete', 'hard_delete', 'config_change',
  'topic_lock',   // ← 唯一新增。用 fromValue/toValue 的 {locked:bool} 表达锁与解锁两个方向
] as const
```

**不加 `topic_pin`**。判据：**审计动作是为「限制他人」和「不可见/不可逆的处置」准备的**。锁帖限制了所有人的发言能力，必须留痕；置顶不限制任何人、在页面上完全可见、且一键可撤。给它留痕只会稀释审计日志。

### 8.4 队列侧：`GET /moderation/queue` 动 0 行，`GET /reports` 必须动

- **待审队列（`/moderation/queue`）M4 不该碰**：`post` 表没有 `status` 列，产品选的是「帖子先发后审」。论坛的「审」入口是举报队列，不是待审队列。
- **举报队列已经是多态的**（`select * from report where status='open'`），帖子举报自动进队，0 行改动；`resolve` 端点与目标类型无关也不用改。
- **唯一必须改的是 `GET /reports` 的 select 投影**：现在只返回 `report.*`，审核员看到的是一串 uuid。要 LEFT JOIN 出目标上下文（post 的楼层号 + 主题标题 / resource 的标题 + slug），否则队列直接失效。这不是 schema 改动，但它是「帖子举报能用」的前提。

### 8.5 顺带补上 M3 唯一漏留痕的一处

`DELETE /posts/:id`（`content/index.ts:78-87`）在 staff 删他人楼层时**不写 `moderationLog`**——这是 M3 所有 staff 处置动作里唯一漏的一处（review / report_resolve / role_change / soft_delete / hard_delete / license_change 甚至「已发布资源被编辑」都写了）。产品文档承诺「举报-处理-申诉闭环」，申诉阶段要回答「谁在什么时候依据什么删了这一楼」。M3 时删楼是罕见动作，M4 之后这是版主的日常。

改法：`actor.id !== row.authorId` 时同事务写 `soft_delete` + `subjectKind='post'`。作者删自己的楼不必留痕。

---

## 9. 不可逆红线：`user_profile.handle`

这是 M4 **唯一**不能按 YAGNI 推迟的 schema 决定，因为它同时命中两条不可逆判据：它会进**已对外发出的 URL**（`/u/:handle`），也会被写进**已发布帖子的正文**（`@handle`）。改语法或改字符集就要重写历史正文。

### 9.1 现状：今天根本没法可靠解析

`packages/db/src/schema/auth.ts:6`：`name: text('name').notNull()`——**不唯一、无长度上限、无字符集约束、用户可随时改**。于是 `@霧雨魔理沙` 可能对应 0 个、1 个或 17 个用户；CJK 没有词边界，`@魔理沙的帖子` 里名字在哪结束无解；任何人都能把自己改名成 `@管理员` 实施冒充；就算某次解析对了，对方改名后旧帖里的 `@` 就指错人了。

### 9.2 列定义

```ts
// 草案 · packages/db/src/schema/kourindou.ts 的 userProfile 加两列
// 放 user_profile 而不是 better-auth 的 user 表 —— 沿用 M3 的既有理由：
// 「不动 better-auth 生成的 user 表，避免它升级时冲突」

/**
 * 稳定、唯一、URL 安全的用户标识。小写存储，纯 ASCII。
 * 显示名（user.name）保持完全自由：日文、中文、emoji 随便用、随便改。
 *
 * NOT NULL 是刻意的：可空会让「没有 handle 的用户」这个状态出现在
 * @提及解析、/u/:handle 路由、通知渲染三条路径的每一个分支里。
 * profile 由 sessionMiddleware 惰性创建，创建时生成随机 handle（见下）。
 */
handle: varchar('handle', { length: 20 }).notNull().unique(),

/** null = 还没自选过，可以改一次；非 null = 锁定，只有站长能代改 */
handleSetAt: timestamp('handle_set_at', { withTimezone: true }),
```

```ts
// 索引与约束
uniqueIndex('user_profile_handle_uq').on(t.handle),   // .unique() 生成，写出来是为了说明它同时是 @ 解析的查询索引
check('user_profile_handle_fmt', sql`${t.handle} ~ '^[a-z0-9][a-z0-9_]{1,19}$'`),
/** staff 扇出（mod_queue 通知）。白名单谓词，绝不写 role <> 'user' */
index('user_profile_staff_idx')
  .on(t.role)
  .where(sql`${t.role} in ('moderator','admin')`),
```

### 9.3 三个决定及其理由

**一、`handle` 不可自助修改（自选一次后锁定，站长可代改）。**

| 做法 | 机制 | 代价 |
|---|---|---|
| a. 可自由改 + `post_mention` 侧表 | 渲染时靠侧表把 `@old` 换成当前 handle | 多一张表；正文与渲染结果分离，编辑时看到不一致 |
| b. 可自由改 + 正文规范化 `@[handle](user:<id>)` | id 进正文，天然抗改名 | 正文不再是人手写得出来的 Markdown；脱离编辑器就没法 @；导出/迁移时是私有语法 |
| **c. 自选一次后锁定（选）** | 渲染时按 `@handle` 现查现渲染 | 零额外存储、零额外表、正文永远是人类可读的 Markdown |

**c 是 §4「@提及不建表」这个结论的全部依据。** 站长若要改成 a 或 b，两处一起改。
站长代改（冒充、骚扰场景）走 `moderationLog`（`role_change` 不合适，用 `config_change`? 都不合适——若真要做，那时加一个 `handle_change` 值；M4 不预留）。

**二、字符集 `^[a-z0-9][a-z0-9_]{1,19}$`——纯 ASCII，允许下划线，不允许连字符。**

- 纯 ASCII：日文假名 handle 会让 `/u/` 路径进入 percent-encoding，且 @ 补全与终止边界判定复杂化。显示名已经完全自由，身份表达的需求由它满足。
- 不允许 `-`：`@marisa-chan` 这种写法里，连字符与后续 CJK 相邻时的终止边界更难判；而下划线在中日文排版里不会与正文粘连。
- 首字符限 alnum：避免 `_admin` 这类视觉冒充。
- **这与 `slugIdSchema`（`^[a-z0-9][a-z0-9-]{0,63}$`）刻意不同形**，所以要在 shared 里加**第四种 id schema**：

```ts
export const handleSchema = z
  .string()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_]{1,19}$/)
  .refine((h) => !RESERVED_HANDLES.includes(h))
```

id 从三种变成四种，在 M3 的坑清单上加一行——但这是必要的：混用 `slugIdSchema` 校验 handle 会放进连字符，混用 `userIdSchema` 会放进任意字符串。

**三、保留字表**：`admin` `moderator` `staff` `system` `official` `all` `everyone` `here` `me` `new` `edit` `login` `register` `api` `u` `shrine` `kourindou` `chronicle` `spellcard` `music` `gensokyo` …。`/u/:handle` 与路由命名空间共用，不设保留字会撞路由；`@all` / `@everyone` 列入保留字顺带解决「@全体」永不解析。

### 9.4 生成策略与一个必须处理的失败模式

profile 由 `sessionMiddleware` 惰性创建（`insert().onConflictDoNothing().returning()`）。加了 `NOT NULL UNIQUE` 的 handle 之后，**这段代码有一个会静默死循环的失败模式**：

`onConflictDoNothing()` 不区分冲突目标。如果冲突发生在 `handle` 的唯一索引上（而不是主键上），插入被静默跳过，`returning()` 返回空，`actor` 落到默认值，**该用户永远没有 profile，且每次请求都重试并再次失败**。

改法：生成 10 字符 base32 随机串（约 50 bit，碰撞概率可忽略），**显式 catch 唯一违例并重试 ≤5 次**，全失败则返回 `internal`——绝不用 `onConflictDoNothing` 掩盖 handle 冲突。这条与挖掘阶段发现的 `createPost` 的 `catch {}` 是同一类错误（把唯一违例伪装成别的东西），要一起改掉。

### 9.5 handle 回收：**M4 不做，但写下触发条件**

释放的 handle 若被重新分配，旧帖里的 `@marisa` 会在某天突然指向另一个人。M4 不加 `previousHandle` / `retired_handle`——因为 M4 不会发生任何一次改名（自选一次 + 站长代改，而站长代改的场景是冒充/骚扰，上线时不存在）。

**触发条件（写进计划，别写进表）**：站长第一次代改 handle 之前，加一列 `previousHandle varchar(20) unique`（一列，零表，其唯一索引就是占位）。删号同理——删号会 cascade 掉 profile 从而释放 handle。

---

## 10. 外键 onDelete 决策总表

M3 有两个刻意选择：`resource.uploaderId` 是 `set null` 不是 cascade（误删一个用户不该抹掉他投稿的所有资源）；`moderationLog.actorId` 也是 `set null`（让审计活过账号注销）。把这两条抽象成一条可复用的规则：

> **内容与审计 → `set null`，活过账号注销。**
> **私有偏好与私有收件箱 → `cascade`，随人消失。**
> 区分点不是「重不重要」，是「这一行是他产出的东西，还是关于他的设置」。

| 外键 | onDelete | 理由 |
|---|---|---|
| `topic.boardSlug → board.slug` | **restrict** | 删版块 = 一批对外 URL 死链，属不可逆。restrict 让 DB 层直接拒绝删除还有主题的版块——站长必须撞到一堵墙，而不是撞到一次级联。**本设计唯一的 restrict** |
| `topic.resourceId → resource.id` | cascade（不变） | 资源被 purge 时讨论无处依附 |
| `topic.authorId → user.id` | set null（不变） | 内容：与 `resource.uploaderId` 同理 |
| `post.topicId → topic.id` | cascade（不变） | |
| `post.authorId → user.id` | set null（不变） | 内容：删号不删楼层，否则楼层号出洞、引用断裂 |
| `post.parentId → post.id` | set null（不变） | 引用**现查**而非快照，父楼消失则渲染「该楼已删除」 |
| `topic_subscription.topicId` | cascade | 偏好：主题没了，「跟这个主题的动静」无意义 |
| `topic_subscription.userId` | cascade | 偏好：是用户私有设置，不是他产出的内容 |
| `post_like.postId` | cascade | 偏好 |
| `post_like.userId` | cascade | 偏好。**代价**：会让 `post.likeCount` 虚高，见 §7.3（与 M3 的 `rating` → `ratingSum` 是同一个既有形状） |
| `notification.userId`（收件人） | cascade | 收件箱是用户私有数据，删号必须一起走——这同时是隐私要求 |
| `notification.actorId`（触发者） | **set null** | 审计性质：「你曾被回复过」不该因对方注销而消失，渲染成「某位用户」。与 `moderationLog.actorId` 同一条理由 |
| `notification.topicId` / `postId` / `resourceId` | cascade | 指向已被硬删对象的通知点开就是 404，不如一起消失。**例外见下** |
| `userProfile.userId`（既有） | cascade（不变） | |

**必须单独写出来的一个陷阱**：`admin.ts` 的 `mode:'purge'` 会级联删 `resource → topic → post`。「你的资源被站长删除」这条通知如果带了 `resource_id` 外键，**会在同一个事务里被自己级联删掉，作者永远收不到**。

> 规则：**purge 类通知不带任何 subject 外键，只在 `payload.subjectTitle` 里存标题快照。**

这与 `moderation_log.subjectId` 用 `text` 而非外键是同一条道理的两次应用。CHECK 表达不了它（`kind` 是粗粒度的 `moderation`，purge 在 `payload.action` 里），所以它必须是一条**带测试**的代码级不变量，不是注释。

---

## 11. 索引总表与查询模式

### 11.1 新增/改动的索引

| 索引 | 服务的查询 | 备注 |
|---|---|---|
| `topic_board_feed_idx (board_slug, pinned_at DESC NULLS LAST, last_post_at DESC) WHERE deleted_at IS NULL` | 版块页 | **替换**现有的 `topic_board_last_post_idx (board_slug, last_post_at)`：加了置顶后排序键变了；升序索引服务不了 `DESC` 的主排序 |
| `topic_latest_idx (last_post_at DESC) WHERE deleted_at IS NULL` | **全站最新流**（`/shrine` 默认视图） | 新建。资源主题与版块主题混排——这是供血管道本身 |
| `topic_author_idx (author_id)` | `/u/:handle` 的「他发起的主题」 | 新建 |
| ~~`topic_kind_idx (kind)`~~ | — | **删除**。两个值的低选择性索引，没有任何查询只按 kind 过滤（`topicForResource` 走 `resourceId` 的唯一索引） |
| ~~`post_topic_floor_idx (topic_id, floor)`~~ | — | **删除**。与 `post_topic_floor_uq (topic_id, floor)` 键完全相同，是一份重复索引——在全站最热的写表上白付一倍索引维护 |
| `post_author_created_idx (author_id, created_at DESC)` | `/u/:handle` 的「他的发言」 | **替换** `post_author_idx (author_id)`，加 `created_at` 免掉排序 |
| `topic_subscription_user_idx (user_id)` | 「我订阅的主题」 | 新建 |
| `notification_user_created_idx (user_id, created_at DESC)` | 收件箱 | 新建 |
| `notification_unread_idx (user_id, created_at) WHERE read_at IS NULL` | 未读数 COUNT + 「全部已读」的 before 游标 | 新建，一个索引两个查询（§6.4 修正一） |
| `notification_collapse_uq (user_id, collapse_key) WHERE read_at IS NULL AND collapse_key IS NOT NULL` | 折叠 upsert 的 arbiter | 新建，正确性索引 |
| `user_profile_handle_uq (handle)` | 唯一约束 + `@handle` 解析查询 | 新建 |
| `user_profile_staff_idx (role) WHERE role IN ('moderator','admin')` | `mod_queue` 扇出（找全体 staff） | 新建。**白名单谓词**，绝不写 `role <> 'user'` |

### 11.2 楼层区间分页（挖掘阶段 D2）不需要新索引

`listPosts` 现在用 OFFSET。论坛的「跳到第 137 楼」用 OFFSET 需要按客户端传入的 `pageSize` 换算，同一条深链在不同 `pageSize` 下指向不同内容——而 `paginationQuerySchema` 允许客户端把 `pageSize` 设成 1..100 的任意值。

改成楼层区间：`WHERE topic_id = $1 AND floor >= $2 ORDER BY floor LIMIT $3`，直接走 `post_topic_floor_uq`，**不需要任何新索引**。配套要在 `packages/shared` 加一个**服务端定死 pageSize** 的 query schema（不复用 `paginationQuerySchema`），否则深链仍然不稳定。

---

## 12. 自我约束：表数量复核

**4 张新表。** 逐张辩护（判据：指认出 M4 上线当天的一次具体查询或写入）：

| 表 | 上线当天的具体用途 | 不建它会怎样 | 能否合并进已有表 |
|---|---|---|---|
| `board` | 版块页 `SELECT * FROM board ORDER BY sort_order`；`topic.boardSlug` 的外键目标 | `boardSlug` 永远没有引用完整性，拼错即产生孤儿主题（§2.2） | 不能。常量方案无法被外键引用 |
| `topic_subscription` | 发帖扇出 `WHERE topic_id=$1 AND state='watching'`；退订写 `muted` 行 | 通知中心只剩「回复我」和「@我」，冷启动期日均 0 条，红点从不亮 = 负资产 | 不能合进 `favorite`：主键不兼容、语义不同、且需要 `muted` 负状态（§5.1） |
| `notification` | 收件箱列表 + 未读数 + 标记已读，产品文档已批准的模块本体 | 失败模式 B 无解 | 不能。per-user 的 `read_at` 必须有一行来装 |
| `post_like` | 楼层渲染时的「我赞过没有」；点赞写入 | 失败模式 B 的上半段缺失（反馈根本不产生） | 不能合进 `rating`：目标、值域、聚合方式全不同 |

**明确否决的表**（列出来是为了证明它们被考虑过，不是被忘了）：

| 否决的表 | 替代方案 |
|---|---|
| `post_image`（图片 GC 白名单） | 见 §13.1——把扫描做成**逐字子串匹配**而不是 Markdown 解析，问题消失 |
| `post_mention` | §4.2，用 handle 不可改换来 |
| `post_revision`（编辑历史） | `post.updatedAt` + 前端「编辑于 X」覆盖 90% 的透明度需求 |
| `topic_read`（未读标记） | 清单里性价比最差的一条：实现最复杂 × 冷启动价值最低。替代品是「最新流 + 相对时间」，成本是一个排序 |
| `board_moderator` | 六个版块一个站长，per-board 版主是 0 个人的调度问题 |
| `topic_tag` | 规模型二次分类 |
| `notification_pref` | 只有站内一个渠道时，偏好只能表达「全关」 |
| `notification_event` + `notification_inbox` | §6.1，临界点在单次扇出 > 50 人 |
| `rate_limit` | redis 已在跑（db1），计数器是现成的。**限流是 M4 最不能省的一条功能，但它一张表都不需要** |
| `emoji`（东方表情） | 一张静态 shortcode → 图片路径的映射表放代码常量。不做用户上传表情 |
| `draft` | localStorage，按 `topicId + userId` 键 |
| `sensitive_word` | 20 词量级的硬红线词表放代码常量或 `siteConfig`（kv 表已在） |

---

## 13. 对既有代码的必须改动（schema 之外，但由 schema 决定）

### 13.1 `apps/api/scripts/gc-images.ts` —— 不改必炸，但**不需要新表**

`referencedUrls()` 只扫 `resource.coverUrl` / `circle.avatarUrl` / `user.image`。帖子插图的 URL 藏在 `post.bodyMd` 的 Markdown 里，不在任何一列。GC 判定「桶里有、白名单里没有、超过 24h 宽限期」→ **删**。脚本头部的熔断挡不住：封面和头像还在，引用集合非空，熔断不触发，于是精确地删掉全部帖子插图。

挖掘阶段给了两个改法，并倾向建 `post_image` 表，理由是「正则扫 Markdown 会漏掉 HTML `<img>` 写法和其他变体」。

**这个顾虑基于一个错误前提：我们不需要解析 Markdown。**

图片能被浏览器加载，当且仅当 MinIO 的 URL 以**完整字面量**出现在正文里。无论它写成 `![](url)`、`<img src=url>`、裸链接还是引用式定义，`url` 这个字符串本身必然逐字存在。于是白名单只需要：

```ts
// 草案 · 加第四个来源
const base = publicBaseUrl()                       // 已有
const rows = await db
  .select({ body: schema.post.bodyMd })
  .from(schema.post)
  .where(sql`${schema.post.bodyMd} like ${'%' + base + '%'}`)  // 过滤下推给 PG
for (const r of rows) {
  for (const m of r.body.matchAll(managedUrlRe(base))) set.add(m[0])
}
```

- **失败方向是安全的**：误匹配（比如代码块里贴了一个 URL）导致**多保留**一张图，而不是误删。不可逆路径上，宁可漏删。
- 真正的漏网需要 URL 不逐字出现（percent-encoding、被拆开）——而 key 由我们自己生成（uuid + 扩展名），不含需要转义的字符。
- 顺手把 `siteConfig.announcement`（三语 jsonb，站长会往里写 Markdown）也加进来，它是同一类洞。

结论：**加第四个来源，不建 `post_image` 表。**

### 13.2 其余改动清单

| 位置 | 改什么 | 为什么 |
|---|---|---|
| `content/post.ts` `createPost` | `catch {}` 拆成三条路径，唯一违例不许伪装成 `topic_missing` | 现在把唯一违例、连接错误、CHECK 违例一律翻译成 404，等于闷死了 `post_topic_floor_uq` 这道专为楼层竞态设的告警通道 |
| `content/post.ts` | 可见性判断收口到 `visibleTopic()`，两种 kind 同一函数 | §3.2 / 挖掘阶段 N3 |
| `content/post.ts` `listPosts` | OFFSET → 楼层区间；pageSize 服务端定 | §11.2 |
| `content/index.ts` `DELETE /posts/:id` | staff 删他人楼层时写 `moderationLog` | §8.5 |
| `kourindou/index.ts:194-200` | 建资源主题时**不再写 `title`** | §3.6，同时被新 CHECK 强制 |
| `middleware/session.ts` | 惰性创建 profile 时生成 handle，显式处理唯一冲突 | §9.4 |
| `moderation.ts` `GET /reports` | select 投影 LEFT JOIN 出目标上下文 | §8.4 |
| `createPostSchema` | 加 `.trim()` | 现在一个空格可入库；DB 的 `btrim` CHECK 是第二道 |
| `errors.ts` | 加 `mention_limit_exceeded`；**实现 `rate_limited`** | 后者 M3 就定义了码但全仓无人抛出 |
| `scripts/`（新） | `gc-notifications.ts`（照抄 `gc-images.ts` 的熔断 + `--dry` + 分批）、`recount.ts`（`likeCount` / `ratingSum` 重算） | §7.3、§6 |

### 13.3 迁移方式

**若无线上数据**（M4 之前的默认假设）：`rm -rf drizzle && bun run generate && bun run migrate`，枚举加值、列改名、索引删改全部一次做完，零迁移脚本。

**若已有线上库**：枚举加值走 `ALTER TYPE ... ADD VALUE`（`0002_certain_master_mold.sql` 有一行先例），注意 PG 限制——`ADD VALUE` 之后不能在同一事务里立刻使用新值（迁移与首次写入天然分开，不成问题）。`topic.lastPostAt` 改 NOT NULL 需要先回填 `= created_at`。

---

## 14. 完整草案汇总（文件与依赖方向）

```
packages/shared/src/shrine/          ← 新目录，镜像 kourindou/
  enums.ts       NOTIFICATION_KIND / SUBSCRIPTION_STATE / RESERVED_HANDLES
  schemas.ts     handleSchema（第四种 id）/ 订阅与已读的小 schema / 楼层分页 query
  mention.ts     extractMentions()  ← 收发两侧共用的纯函数

packages/db/src/schema/
  content.ts     board（新表）· topic（+pinnedAt +lockedAt，改名 floorSeq，
                 lastPostAt NOT NULL，+CHECK，boardSlug 加外键，索引重做）
                 · post（+likeCount，+CHECK，索引去重）
  shrine.ts      ← 新文件：topic_subscription · notification · post_like
                 依赖方向 content.ts → shrine.ts，单向，无循环
  kourindou.ts   userProfile +handle +handleSetAt +CHECK +staff 索引；
                 REPORT_REASON / MODERATION_ACTION 加值（枚举定义在 shared）
```

**为什么 `board` 放 `content.ts` 而不是 `shrine.ts`**：`topic` 要引用 `board`，而 `notification` 要引用 `topic`。把 `board` 放进 `shrine.ts` 会让两个文件互相 import。依赖方向必须单向。

---

## 15. 留给站长拍板的问题

1. **handle 的生成时机**：本文选「注册即自动生成随机 handle（`u` + 10 位），用户可自选一次覆盖」，代价是会有一批 `ua7f3k2m9x` 样的丑 handle 出现在早期帖子的 `@` 里。替代方案是「首次发帖前强制自选」——干净但在注册与发帖之间插了一道门，冷启动期每一道门都可能损失一个首帖。
2. **handle 是否允许自助改名**：本文选「自选一次后锁定，站长可代改」。**这个选择是「@提及不建表」的全部依据**（§4.2）——若放开自由改名，必须同时接受一张 `post_mention` 侧表或改变正文格式。两个决定必须一起做。
3. **置顶列的证伪条件**：`topic.pinnedAt` 的唯一理由是「六版块各发一条站长引导帖」。若 M4 的计划里没有这一步，这一列应当砍掉——请确认这一步在不在计划里。
4. **`mod_queue` 通知要不要**（新待审 / 新举报发给全体 staff）：它是 solo 运营下「站长不用天天刷后台」的机制，但会让站长自己的收件箱与用户收件箱混在一起。要不要在收件箱里分「我的 / 站务」两个 tab？（分 tab 是纯前端，不影响本文任何一列。）
5. **资源讨论主题的版块归属**：本文的 schema 假设它 `boardSlug IS NULL`（CHECK 已把这个假设钉死），只进全站最新流。若产品希望「音乐堂」版块里能看到音乐资源的讨论，CHECK 要放宽、`topic_kind_shape` 要重写。这是查询层与观感的选择，但**它现在被约束固化了**，改要动 DDL。
6. **`/status` 绕开 `/review` 导致信任梯度不推进**（M3 遗留）：staff 可以走 `POST /resources/:id/status` 把 pending 直接改 published，完全绕开 `/review`，于是不递增 `approvedResourceCount`、审计写成 `status_change` 而非 `review`。M4 要不要顺手收口（把 `pending->published` 从 `/status` 的允许集合里去掉）？
