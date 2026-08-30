# M4 博丽神社：API 契约设计

2026-08-30 · 调研阶段产物，**不是决定**。正式范围见 `docs/superpowers/plans/`。
本文只设计 **API 契约**（挂载点 / 路由 / zod / 权限 / 分页 / 错误码）。schema 细节以另一份设计为准，本文只写"契约要求 schema 提供什么"。

---

## 0. 一页结论

| 项 | 决定 |
|---|---|
| **挂载点** | `/api/shrine` 独占 topic+post 全部读写。**删掉** `/api/kourindou/resources/:slug/posts`（GET+POST），资源详情响应里加一个 `topicId`。理由见 §1——不是审美，是**可见性闸门必须只有一个入口** |
| **新增路由** | **16 条**（shrine 12 + notifications 2 + identity 2）。删 2 条、移 1 条，净 +14 |
| **zod 落点** | 新建 `packages/shared/src/shrine/`；把 `createPostSchema` / `TOPIC_KIND` 从 `kourindou/` 迁过来；把三种 id schema 上提到 `packages/shared/src/ids.ts`。全部经包根导出，两侧引法不变 |
| **主题列表分页** | **游标（keyset）**。代价是没有 total、没有"第 N 页"——而"最新流"本来就不需要这两样。置顶主题不进游标流，单独返回，把二列排序化简成一列 |
| **楼层分页** | **楼层区间**，`pageSize` 服务端固定并回显。`?from=137` 服务端吸附到页边界，深链永久稳定 |
| **编辑时间窗** | **不设**。硬停只有两条：主题锁定、楼层已删。另加一条硬规则：**staff 不能编辑他人正文**（只能删+锁） |
| **限流落点** | hono 中间件之外的一个 `assertCanPost()` 守卫，计数走 **SQL**（复用 `post_author_idx`），不引 redis。仓库里现在**没有任何限流**，`rate_limited` 码是空悬的 |
| **新增错误码** | 6 个：`topic_locked` / `mention_limit_exceeded` / `duplicate_content` / `link_not_allowed` / `handle_taken` / `content_blocked` |
| **未读数** | 不占路由，搭 `GET /api/me` |

不可逆清单（本文只碰这几样，其余一律 YAGNI）：**主题 URL 形状**、**用户 handle**、**删除语义**。

---

## 1. 挂载点：本次设计最重要的判断

### 1.1 问题的真实形状

事实（`app.ts:19-26`）：三个模块都挂在同一个前缀上。

```ts
.route('/kourindou', kourindou)     // 资源
.route('/kourindou', interactions)  // 评分/收藏/举报
.route('/kourindou', content)       // ← 评论 = 楼层
```

于是资源评论今天的路径是 `GET /api/kourindou/resources/:slug/posts`。而 M4 之后，**同一批 `post` 行**还要在 `/shrine` 视图下被列出、被回复、被点赞、被举报。

三个候选：

| 方案 | 形状 | 判断 |
|---|---|---|
| **A. 扩展 `/api/kourindou`** | 论坛主题变成 `/api/kourindou/topics/...` | 否。论坛不是香霖堂的一部分。`mined-reusable.md` P2-3 已经指出同构问题：帖子举报走 `POST /api/kourindou/reports` 名不副实 |
| **B. 两套并存** | 资源侧保留 `/kourindou/resources/:slug/posts`，论坛侧新开 `/shrine/topics/:id/posts` | 否。理由见 §1.2 |
| **C. `/api/shrine` 独占，资源侧退化为一个 `topicId`** | 只有 `/shrine/topics/:id/posts`；`GET /kourindou/resources/:slug` 多返回一个 `topicId` | **采纳** |

### 1.2 为什么 B 是错的：这是安全问题，不是命名问题

B 看起来最省事（不动 M3 已跑通的代码），但它意味着**同一张表有两个写入口**，而这两个入口各自要重新实现一遍"这条主题现在能不能读 / 能不能写"。

这不是假想的风险，仓库里已经有它的实例。`mined-legacy-comments.md` 的 N3：

- `createPost`（`content/post.ts:81`）带了 `isNull(topic.deletedAt)`；
- `listPosts`（`:16-46`）**完全不碰 topic 行**；
- M3 侥幸过关，只因为资源侧路由层的 `publishedTopic()`（`content/index.ts:19-33`）在外面又把了一次关。

也就是说：**闸门今天已经是"一半在 service、一半在路由"的漂移状态**，而 B 方案是在这个状态上再复制一份路由层闸门。M3 计划里那句话正好适用——"分层边界没有编译器保护，必然漂移"。

C 方案把闸门收敛成一个函数（§1.4），两个视图物理上走同一段代码。这才是"一套内容系统两个视图"在 API 层的正确投影：

> **URL 命名的是被寻址的东西，不是渲染它的页面。**
> 一条楼层只有一个身份：`post.id`。一个主题只有一个身份：`topic.id`。
> "属于香霖堂还是属于神社"是**呈现事实**，呈现的分叉发生在 web 侧（`/kourindou/:slug` vs `/shrine/t/:id`），不该在 API 侧再分叉一次。

### 1.3 "已发出的 URL 不可逆"适用于这里吗？

不适用。M3 方法论那条红线说的是**对外发出的 URL / slug**——被收藏、被外链、被搜索引擎索引的那些。`/api/kourindou/resources/:slug/posts` 是内部 API 路径，调用方只有 `apps/web` 的 loader/action（`detail.tsx:50,68`）、`content.test.ts`、`e2e.ts`，全在同一个 monorepo 里。改它是一次编译期可发现的重构，成本与 P2-3 说的举报端点搬家同级：**接近零，而且 M4 之后会变贵**。

### 1.4 C 方案的落地形状

```ts
// modules/shrine/visibility.ts —— 全模块唯一的可见性闸门
export type TopicView = {
  id: string; kind: 'board' | 'resource'
  boardSlug: string | null; title: string
  authorId: string | null
  pinnedAt: Date | null; lockedAt: Date | null
  postCount: number      // 楼层水位，只增不减
  replyCount: number     // 展示用，可增可减
  lastPostAt: Date
  resourceId: string | null
  resourceSlug: string | null   // kind='resource' 时用于 301
}

/** 一次查询（topic LEFT JOIN resource），判断一律白名单 */
export async function loadVisibleTopic(id: string): Promise<TopicView | null>

/** 可写 = 可见 且 未锁定。锁定对所有人生效，staff 也不例外（见 §5 备注） */
export function isWritable(t: TopicView): boolean { return t.lockedAt === null }
```

白名单规则（**绝不写 `!== 'delisted'`**）：

1. `topic.deleted_at IS NULL`；
2. `kind = 'board'` → 可见；
3. `kind = 'resource'` → 要求 `resource.status = 'published' AND resource.deleted_at IS NULL`。

**这条规则顺手兑现了 `mined-forum-mechanics.md` §3.8 的硬需求**（"资源被下架时讨论主题必须自动锁"），而且**不需要 `lockedAt` 列，也不需要在下架路径上挂钩子**：闸门本身是联查白名单，资源一旦不是 published，它的讨论主题当场既不可见也不可写。写钩子会漂移，白名单不会。

> 产品后果要说清楚：这是"下架即隐藏讨论"，不是"下架但讨论只读"。这与 M3 现状一致（`publishedTopic()` 对非 published 资源已经返回 null），不是新行为。若产品要"只读可见"，改的是这一个函数，仍然只有一处。

对应地，`content/post.ts` 的函数签名要改成**接收 `TopicView` 而不是裸 `topicId`**——让类型系统承担"这个主题已经过闸"的证明，N3 那种漂移就没有发生的地方了：

```ts
// 不是 listPosts(topicId: string, ...)
export async function listPosts(topic: TopicView, from: number)
export async function createPost(topic: TopicView, input: {...})
```

### 1.5 连带的三处改动

1. **`GET /api/kourindou/resources/:slug` 响应加 `topicId: string | null`**（可空是防御：脚本造的资源行可能没有配套 topic，web 端 null 就不渲染评论区）。这条不在 `mined-reusable.md` 的"必须改 7 处"里，是本文新增的第 8 处。
2. **`modules/content/index.ts` 整个删除**；`content/post.ts` 建议移成 `modules/shrine/post.ts`（M3 保留它作为 service 的理由是"设计上有两个调用方"，合并 URL 之后跨模块的第二个调用方消失了，但模块内仍有多个调用点：发主题建 1 楼、回帖建 N 楼、通知扇出。降级为模块内 service 是正确的，不必内联）。
3. `apps/web/app/routes/kourindou/detail.tsx` 的 loader/action 改成用 `topicId` 调 `/api/shrine/*`。**不产生新的瀑布**：现在的 loader 本来就是两次串行 `await`（`:44` 与 `:50`）。

### 1.6 web 侧 URL（决定 API 要返回什么）

| 路径 | 说明 |
|---|---|
| `/shrine` | 全站最新流（默认视图，**不是版块目录**） |
| `/shrine/b/:board` | 单版块 |
| `/shrine/t/:id` | 主题。`kind='resource'` 的主题 **301 → `/kourindou/:slug#discussion`** |
| `/shrine/t/:id?floor=137` | 跳楼深链 |
| `/u/:handle` | 个人主页 |

301 需要 API 给依据 → `GET /api/shrine/topics/:id` 必须返回 `kind` 与 `resourceSlug`。

**主题 URL 里不带标题 slug。** `mined-forum-mechanics.md` §6.1 倾向 Discourse 式 `slug + id`，但它自己的开放问题 6 也指出：slug 取自中文标题会变成一长串 percent-encoding；取拼音/英文要么引依赖要么要人工填。`/shrine/t/:id` 是纯 id、永久稳定、零歧义；**日后要加 slug 是 additive**（`/shrine/t/:slug/:id`，旧链 301），因为权威永远是 id。这是"晚做零成本"的那一类，按 YAGNI 推。

---

## 2. 路由全表（新增 16 条）

```ts
// app.ts —— 保持链式 .route() 以维持 AppType 推导
export const app = new Hono<AppEnv>()
  .basePath('/api')
  .on(['GET','POST'], '/auth/*', ...)
  .use('*', sessionMiddleware)
  .get('/health', ...)
  .route('/me', me)                       // + PATCH /handle，GET / 加 handle/unread
  .route('/users', users)                 // 新：GET /:handle
  .route('/uploads', uploads)
  .route('/kourindou', kourindou)         // 响应加 topicId
  .route('/kourindou', interactions)      // 举报拆走后只剩 rating/favorite
  .route('/shrine', shrine)               // 新：12 条
  .route('/notifications', notifications)  // 新：2 条
  .route('/reports', reports)             // P2-3：从 interactions 拆出（不计入新增）
  .route('/moderation', moderation)
  .route('/admin', admin)
  .route('/config', publicConfig)
```

| # | Method + Path | 校验 | 权限 | 返回 | 可能的 error code |
|---|---|---|---|---|---|
| 1 | `GET /api/shrine/topics` | `listTopicsQuerySchema` (query) | 公开 | `{ pinned[], items[], nextCursor }` | `validation_failed` |
| 2 | `POST /api/shrine/topics` | `createTopicSchema` (json) | `requireAuth` + `assertCanPost` | `{ topicId, postId, floor:1 }` 201 | `unauthorized` `validation_failed` `rate_limited` `duplicate_content` `link_not_allowed` `content_blocked` `mention_limit_exceeded` |
| 3 | `GET /api/shrine/topics/:id` | `entityIdParam` | 公开 | `{ topic, resource?:{slug,titleOriginal,coverUrl} }` | `not_found` `validation_failed` |
| 4 | `DELETE /api/shrine/topics/:id` | `entityIdParam` + `deleteReasonSchema` (json) | 作者（仅当无他人回复）或 `moderator` | `{ deleted:true }` | `unauthorized` `forbidden` `not_found` `invalid_state_transition` `validation_failed` |
| 5 | `POST /api/shrine/topics/:id/moderate` | `entityIdParam` + `moderateTopicSchema` (json) | `requireRole('moderator')` | `{ topic }` | `unauthorized` `forbidden` `not_found` `invalid_state_transition` `validation_failed` |
| 6 | `PUT /api/shrine/topics/:id/subscription` | `entityIdParam` + `subscribeSchema` (json) | `requireAuth` | `{ state }` | `unauthorized` `not_found` `validation_failed` |
| 7 | `GET /api/shrine/topics/:id/posts` | `entityIdParam` + `listPostsQuerySchema` (query) | 公开（登录时附带 `liked`） | `{ posts[], from, size, floorHighWater, replyCount }` | `not_found` `validation_failed` |
| 8 | `POST /api/shrine/topics/:id/posts` | `entityIdParam` + `createPostSchema` (json) | `requireAuth` + `assertCanPost` | `{ id, floor }` 201 | 同 #2，另加 `topic_locked` |
| 9 | `PATCH /api/shrine/posts/:id` | `entityIdParam` + `updatePostSchema` (json) | **仅作者本人** | `{ id, updatedAt }` | `unauthorized` `forbidden` `not_found` `topic_locked` `validation_failed` `content_blocked` `mention_limit_exceeded` |
| 10 | `DELETE /api/shrine/posts/:id` | `entityIdParam` + `deleteReasonSchema` (json) | 作者或 `moderator`（staff 必须给 reason 且留痕） | `{ deleted:true }` | `unauthorized` `forbidden` `not_found` `validation_failed` |
| 11 | `PUT /api/shrine/posts/:id/like` | `entityIdParam` | `requireAuth` | `{ liked:true, likeCount }` | `unauthorized` `not_found` `self_action_forbidden` |
| 12 | `DELETE /api/shrine/posts/:id/like` | `entityIdParam` | `requireAuth` | `{ liked:false, likeCount }` | `unauthorized` `not_found` |
| 13 | `GET /api/notifications` | `listNotificationsQuerySchema` (query) | `requireAuth` | `{ items[], nextCursor, unread }` | `unauthorized` `validation_failed` |
| 14 | `POST /api/notifications/read` | `markReadSchema` (json) | `requireAuth` | `{ updated, unread }` | `unauthorized` `validation_failed` |
| 15 | `PATCH /api/me/handle` | `setHandleSchema` (json) | `requireAuth` | `{ handle, handleSetAt }` | `unauthorized` `forbidden` `handle_taken` `validation_failed` |
| 16 | `GET /api/users/:handle` | `handleParam` | 公开 | `{ user, counts, recentPosts[] }` | `not_found` `validation_failed` |

**删除 2 条**：`GET /api/kourindou/resources/:slug/posts`、`POST /api/kourindou/resources/:slug/posts`。
**搬家 1 条**：`DELETE /api/kourindou/posts/:id` → `DELETE /api/shrine/posts/:id`（#10）。
**搬家 1 条（P2-3，不计入新增）**：`POST /api/kourindou/reports` → `POST /api/reports`。

净增 **14 条**，在 20 条自我约束之内，不需要辩护。下面反过来记一笔**为什么没有更多**：

| 想要但没做成路由 | 去哪了 |
|---|---|
| `GET /api/shrine/boards` | 版块是 6 个固定值，做成 `packages/shared` 的常量 + Paraglide 文案，零路由（§3.2） |
| 未读数端点 | 搭 `GET /api/me` |
| `POST /topics/:id/pin` `/lock` `/move` | 合并成 #5 一个 `/moderate`（M3 先例：`changeStatusSchema` 的注释"状态流转只有一个入口，不在 URL 空间里把状态机编码第二遍"） |
| `PATCH /topics/:id`（改标题） | 折进 #9：标题是 1 楼作者的属性，不是独立资源 |
| `POST /topics/:id/restore` | 不做。误删主题的恢复走站长 SQL（M3 先例：社团认领审批走 SQL） |
| 帖子举报 | 复用已有的举报端点，`targetKind='post'` 已支持（`mined-reusable.md` §5.2） |
| 帖子处置（版主删楼） | 复用 #10，`isOwnerOrStaff` 已放行 moderator |

---

## 3. zod 契约的落点

### 3.1 目录

```
packages/shared/src/
  ids.ts                 ← 新：entityIdSchema / userIdSchema / slugIdSchema / anyIdSchema / handleSchema
  pagination.ts          ← 保留（kourindou 的 page/pageSize 分页继续用）
  cursor.ts              ← 新：游标编解码 + cursorSchema（shrine 与 notifications 共用）
  kourindou/             ← 保留原样（enums / localized / schemas）
  shrine/                ← 新
    enums.ts             BOARD_SLUGS / NOTIFICATION_KIND / SUBSCRIPTION_STATE /
                         TOPIC_MODERATE_ACTION / RESERVED_HANDLES / 页大小常量
    schemas.ts           topic / post / subscription / notification / handle 的全部 zod
    mention.ts           extractMentions()：纯函数，收发两侧共用
    index.ts
  index.ts               export * from './ids' './cursor' './kourindou' './shrine' './pagination'
```

### 3.2 三个判断

**(a) 新建 `shrine/` 而不是塞进 `kourindou/`。** 目录名是给人看的边界。`topic`/`post` 的契约放进 `kourindou/` 会让"论坛的契约在资源模块里"这件事永久化。而"两边都要能引"不构成留在 `kourindou/` 的理由——全仓 grep 确认**没有任何深路径导入**（没有 `@gensokyo/shared/kourindou` 这种写法），一切都从包根导出，所以 `import { createPostSchema } from '@gensokyo/shared'` 在移动前后**逐字不变**。移动是零风险的。

**(b) 把 `createPostSchema` 与 `TOPIC_KIND` 从 kourindou 迁到 shrine。** 前者是楼层契约，后者被 `packages/db/src/schema/content.ts:1` 引用——改一行 import。同时把 `createPostSchema` 的 `bodyMd` 补上 `.trim()`（对账表未修第 15 条：一个空格今天可以入库）。

**(c) 三种 id schema 上提到 `packages/shared/src/ids.ts`。** 它们从来就不是香霖堂的东西，只是 M3 时香霖堂是唯一模块。不上提的话 shrine 会依赖 kourindou，纯属人为耦合。同样因为全部走包根导出，这次移动对所有调用点**零改动**。

**明确不动的**：`REPORT_REASON` / `MODERATION_ACTION` / `USER_ROLE` 留在 `kourindou/enums.ts`（它们要加值，见 §9，但搬家只是改名噪音，没有类型收益）。诚实记一笔债：`kourindou/` 目录现在事实上兼任"平台通用治理契约"，日后重命名为 `platform/` 是纯内部改名，随时可做。

### 3.3 契约草案（未评审，不得进仓库）

```ts
// packages/shared/src/shrine/enums.ts

/**
 * 六版块。**不建 board 表**：
 * - 版块名是 UI chrome（6 条固定文案），按 CLAUDE.md 归 Paraglide，不该建第二套 i18n；
 * - 表能买到的是"不部署就加版块"，而 mined-forum-mechanics §3.1 的结论恰恰是"此外一个都不再开"；
 * - slug 是对外 URL —— 但常量比表更稳定（改它需要改代码 + review）。
 * 对照：tag/resource_category 建表是因为它们是**数据**（几百行、可编辑）；版块更像 RESOURCE_KIND。
 */
export const BOARD_SLUGS = [
  'tea-party',    // 幻想乡茶话会（综合）
  'danmaku-lab',  // 弹幕研究所（原作 STG）
  'workshop',     // 二创工坊
  'music-hall',   // 音乐堂
  'kappa-heavy',  // 河童重工（技术）
  'meta',         // 站务
] as const
export type BoardSlug = (typeof BOARD_SLUGS)[number]

export const TOPIC_KIND = ['resource', 'board'] as const   // 从 kourindou 迁入

export const TOPIC_MODERATE_ACTION =
  ['pin', 'unpin', 'lock', 'unlock', 'move'] as const

export const SUBSCRIPTION_STATE = ['watching', 'muted'] as const

export const NOTIFICATION_KIND =
  ['reply', 'topic_reply', 'mention', 'moderation', 'mod_queue'] as const

/** @all/@everyone 永不解析；其余是给未来路由与身份留的窄保留字 */
export const RESERVED_HANDLES = [
  'all','everyone','here','channel','staff','admin','moderator',
  'me','you','system','gensokyo','shrine','kourindou','api','support',
] as const

/** 页大小是契约的一部分：楼层深链的换算依赖它，客户端不得自定 */
export const POSTS_PAGE_SIZE = 30
export const TOPICS_PAGE_SIZE = 30
export const NOTIFICATIONS_PAGE_SIZE = 30
export const MENTION_LIMIT = 10
```

```ts
// packages/shared/src/ids.ts（上提，内容不变，只加 handle）

export const entityIdSchema = z.uuid()
export const userIdSchema = z.string().min(1).max(64)   // better-auth 32 位随机串，不是 UUID
export const slugIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
export const anyIdSchema = z.string().min(1).max(64)

/**
 * **第四种 id 形状**。既是 @提及的解析键，也是 /u/:handle 的路径段。
 * 无连字符：`-` 紧贴中日文时终止边界难判（`@marisa-的帖子`）。
 * 小写存储、大小写不敏感比较（写入前 toLowerCase）。
 */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{2,20}$/)
  .refine((h) => !RESERVED_HANDLES.includes(h as never), { message: 'reserved' })
```

```ts
// packages/shared/src/cursor.ts
/** 游标 = base64url(`${ISO 时间}|${uuid}`)。解码失败必须变成 validation_failed，
 *  绝不能把用户串直接喂给 Postgres 的 timestamp/uuid —— 那是 22P02 → 500 的老路。 */
export const cursorSchema = z.string().max(120).regex(/^[A-Za-z0-9_-]+$/)
export function encodeCursor(ts: Date, id: string): string
export function decodeCursor(raw: string): { ts: Date; id: string } | null
```

```ts
// packages/shared/src/shrine/schemas.ts

const bodyMdSchema = z.string().trim().min(1).max(20000)
// DB 侧要配一条 CHECK（char_length(body_md) between 1 and 20000）——
// legacy 缺 DB 层上限是未修的 6 条之一，rating_score_range 是现成先例。

// ---------- 主题列表 ----------
export const listTopicsQuerySchema = z.object({
  board: z.enum(BOARD_SLUGS).optional(),
  /** all = 全站流（含资源讨论）；board = 只看人写的主题 */
  scope: z.enum(['all', 'board']).default('all'),
  cursor: cursorSchema.optional(),
})
// 注意：**没有 pageSize**。见 §4.1

// ---------- 楼层列表 ----------
export const listPostsQuerySchema = z.object({
  /** 楼层锚点。服务端会吸附到页边界，见 §4.2 */
  from: z.coerce.number().int().min(1).max(1_000_000).default(1),
})

// ---------- 写 ----------
export const createTopicSchema = z.object({
  boardSlug: z.enum(BOARD_SLUGS),
  title: z.string().trim().min(2).max(100),
  bodyMd: bodyMdSchema,
})

export const createPostSchema = z.object({
  bodyMd: bodyMdSchema,
  /**
   * **引用**，不是树形父节点。渲染成引用块、不缩进、不嵌套。
   * 被引楼现查而非快照（软删一次即从所有引用块消失，见 mined-forum-mechanics §3.3）。
   */
  parentId: entityIdSchema.optional(),
})

/**
 * **逐字段重建，不用 `.partial()`** —— M3 那个坑：`.partial()` 不移除 `.default()`。
 * title 只在"1 楼 且 kind='board' 且 作者本人"时可传；否则显式 400 fields:['title']，
 * **不静默剥离**（legacy 的字段级授权思路对，但静默剥离要改成显式拒绝）。
 */
export const updatePostSchema = z.object({
  bodyMd: bodyMdSchema.optional(),
  title: z.string().trim().min(2).max(100).optional(),
}).refine((v) => v.bodyMd !== undefined || v.title !== undefined, { path: ['bodyMd'] })

// ---------- 治理 ----------
export const moderateTopicSchema = z.discriminatedUnion('action', [
  // reason 可选：可逆、无受影响的第三方
  z.object({ action: z.literal('pin'),    reason: z.string().max(500).optional() }),
  z.object({ action: z.literal('unpin'),  reason: z.string().max(500).optional() }),
  // reason 必填：有一个人日后可能来申诉
  z.object({ action: z.literal('lock'),   reason: z.string().min(1).max(500) }),
  z.object({ action: z.literal('unlock'), reason: z.string().min(1).max(500) }),
  z.object({ action: z.literal('move'),   boardSlug: z.enum(BOARD_SLUGS),
                                          reason: z.string().min(1).max(500) }),
])
// reason 必填与否的判据（写下来免得日后各写各的）：
// **是否存在一个受影响的人，日后可能来申诉。**

export const deleteReasonSchema = z.object({ reason: z.string().max(500).optional() })
// staff 删他人内容时 reason 必填 —— 但 zod 看不到 actor，所以在 handler 里判：
//   if (!isSelf && !reason) return fail(c, 'validation_failed', 400, ['reason'])

// ---------- 订阅 ----------
export const subscribeSchema = z.object({ state: z.enum(SUBSCRIPTION_STATE) })
// **没有 DELETE 语义**：取消订阅写 muted 行。删行的话，下次回复"回复即订阅"会把人加回来。

// ---------- 通知 ----------
export const listNotificationsQuerySchema = z.object({
  /** Hono 的单值 query 是 string；`z.coerce.boolean()` 对 "false" 会得到 true —— 必须显式枚举 */
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  cursor: cursorSchema.optional(),
})

export const markReadSchema = z.object({
  ids: z.array(entityIdSchema).max(100).optional(),
  /** 「全部已读」用游标而不是 all:true —— 点击瞬间刚到的那条不该被吞掉 */
  before: z.iso.datetime().optional(),
}).refine((v) => (v.ids === undefined) !== (v.before === undefined), { path: ['ids'] })

// ---------- handle ----------
export const setHandleSchema = z.object({ handle: handleSchema })
```

```ts
// apps/api/src/errors.ts 追加（handle 是第四种 id 形状，不能用 entityIdParam/userIdParam）
export const handleParam = validate('param', z.object({ handle: handleSchema }))
```

---

## 4. 分页策略

### 4.1 主题列表：游标（keyset），并把置顶抽出流外

**offset 在这里确实会漏帖/重帖**，而且是必然的：排序键 `last_post_at` 在每次有人回帖时都会变。用户看完第 1 页去翻第 2 页，中间只要有一条第 1 页的主题被顶上来，第 2 页的第一条就会重复出现，同时有一条被挤过边界的主题永远看不到。

但直接对 `ORDER BY pinned_at DESC NULLS LAST, last_post_at DESC` 做 keyset 是个坑：两列排序 + NULLS LAST 的游标条件很容易写错，而写错的表现是"翻页时静默丢内容"——最难发现的一类 bug。

**化简：置顶主题根本不进分页流。**

```
{ pinned: Topic[],      // ≤10 条，不分页；只在 ?board= 时返回，全站流不返回
  items:  Topic[],      // ORDER BY last_post_at DESC, id DESC
  nextCursor: string | null }
```

于是游标条件退化成干净的单键 keyset：

```sql
WHERE t.deleted_at IS NULL
  AND (t.resource_id IS NULL OR (r.status = 'published' AND r.deleted_at IS NULL))
  AND t.pinned_at IS NULL
  AND (t.last_post_at, t.id) < ($cursorTs, $cursorId)
ORDER BY t.last_post_at DESC, t.id DESC
LIMIT 31          -- 多取 1 条判断有没有下一页
```

**代价，逐条摊开（这是判断题，不是免费午餐）：**

| 代价 | 是否可接受 | 理由 |
|---|---|---|
| 没有 `total`，UI 上没有"共 N 页" | 是 | 最新流的正确 UI 是"加载更多"/无限滚动。而香霖堂的资源列表**继续用 page/pageSize + total**——那里排序键是稳定的 `created_at`，且分页器 UI 是对的。两种分页并存是有意为之，不是不一致 |
| 不能深链"第 7 页" | 是 | 没有人深链一个内容会移动的流的第 7 页。真正需要深链的是**主题**和**楼层**，两者都有稳定寻址 |
| 客户端不能自定页大小 | 是 | 见 §4.2，页大小服务端固定是**楼层深链稳定性的前提**，主题列表跟着统一 |
| 短页不代表到底 | **必须写进契约** | 上面的 `resource.status` 过滤发生在 LIMIT 之后，一页可能不足 30 条却仍有下一页。**客户端判断"是否还有"只能看 `nextCursor`，绝不能看 `items.length < 30`** |

**索引**：`topic_feed_idx (last_post_at DESC, id DESC) WHERE deleted_at IS NULL AND pinned_at IS NULL`。现有的 `topic_board_last_post_idx (board_slug, last_post_at)` 要重建成带 DESC 与部分条件的版本。

**一个必须现在修的洞**：`topic.lastPostAt` 现在可空（`content.ts:43`），而 M3 建资源主题时**没有给它赋值**（`kourindou/index.ts:196-201`）。Postgres 的 `ORDER BY x DESC` 默认 NULLS FIRST，于是**所有零评论的资源主题会霸占最新流的最前面**——上线当天首页就是一堆空评论区。修法：`lastPostAt` 改 `NOT NULL DEFAULT now()`，建主题时显式写入。库里无数据，改它零成本；不改就是上线首日的观感事故。

### 4.2 楼层：区间分页 + 服务端固定页大小

`mined-legacy-comments.md` D2 的判断成立：楼层号稠密单调，OFFSET 是错的工具。

```
GET /api/shrine/topics/:id/posts?from=137
→ { posts: [...],            // floor ∈ [121, 151)
    from: 121,               // ← 服务端吸附到页边界后的真实起点
    size: 30,                // = POSTS_PAGE_SIZE，回显
    floorHighWater: 412,     // topic.postCount，只增不减
    replyCount: 407 }        // 展示用
```

```sql
WHERE post.topic_id = $1 AND post.floor >= $from AND post.floor < $from + 30
ORDER BY post.floor
-- 命中现有的 post_topic_floor_idx (topic_id, floor)
```

三条要点：

1. **`pageSize` 由服务端定，不接受客户端传值。** 这是 D2 的核心：换算 `楼层 → 页` 依赖页大小，客户端能改页大小就意味着同一条深链在不同客户端指向不同内容。`POSTS_PAGE_SIZE` 从 `@gensokyo/shared` 导出，收发两侧引同一个常量——正是项目"类型主轴 = 单一事实来源"的做法。
2. **服务端吸附页边界**：`from = floor((from-1)/30)*30 + 1`。于是 `?from=137` 与 `?from=121` 返回逐字相同的响应，深链天然规范化、可缓存。
3. **"跳到最后一楼"不需要新参数**：客户端从 `GET /topics/:id` 拿到 `floorHighWater` 自己算末页。少一个 query 参数、少一条分支。

**为什么区间分页是精确的**（而不只是"差不多"）：软删保留楼层占位（`post.ts:105-107` 已实现），且论坛内容**一律软删、硬删只走站长脚本**（§6.3 的删除语义）。所以 floor 序列永远稠密。万一将来真发生 purge，区间分页只会返回不足 30 条——**优雅降级，不会返回错的内容**。

这条同时坐实了 N2 的建议：`postCount` 明确为**楼层水位（只增不减，楼层分配器）**，另加 `replyCount`（可增可减，展示用）。两职分离现在零成本，等到第一次硬删刷屏帖时就晚了。

### 4.3 通知列表：同样是游标

理由与主题流完全同构：新通知不断从头部插入，且折叠会把旧行的 `createdAt` 推到 `now()`（`mined-notification.md` §2.3）——这是 offset 漂移的教科书场景。游标键 `(created_at DESC, id DESC)`。

**禁止 D5 那种形状**（`me/page.tsx` 的"先查全部 id 无 limit，再 inArray 二次查"）：通知列表必须**一次 join** 出触发者名/handle、主题标题、楼层号，分页在同一条 SQL 里。

---

## 5. 权限矩阵

| 动作 | 匿名 | 登录用户 | 内容作者本人 | moderator | admin | 备注 |
|---|---|---|---|---|---|---|
| 读版块 / 主题 / 楼层 | ✅ | ✅ | ✅ | ✅ | ✅ | 一律过 `loadVisibleTopic()` 白名单 |
| 发主题 | ❌ 401 | ✅ | — | ✅ | ✅ | 过 `assertCanPost`（§6） |
| 回帖 | ❌ 401 | ✅ | ✅ | ✅ | ✅ | 主题锁定 → 409 `topic_locked`，**staff 也不例外** |
| 编辑自己的楼 | ❌ | — | ✅ **无时间窗** | ✅（自己的） | ✅（自己的） | 锁定/已删的楼不可编辑 |
| **编辑别人的楼** | ❌ | ❌ | — | **❌ 403** | **❌ 403** | 见下方 (b) |
| 删自己的楼 | ❌ | — | ✅ 软删 | ✅ | ✅ | 不写 moderationLog |
| 删别人的楼 | ❌ | ❌ | — | ✅ 软删 | ✅ | **reason 必填 + `moderationLog`**（P0-2） |
| 删自己的主题 | ❌ | — | ✅ 仅当无他人回复 | ✅ | ✅ | 有回复则 409 `invalid_state_transition` |
| 删别人的主题 | ❌ | ❌ | — | ✅ | ✅ | reason 必填 + 留痕 |
| 置顶 / 取消置顶 | ❌ | ❌ | ❌ | ✅ | ✅ | reason 可选 |
| 锁帖 / 解锁 | ❌ | ❌ | ❌ | ✅ | ✅ | reason 必填 |
| 移动版块 | ❌ | ❌ | ❌ | ✅ | ✅ | reason 必填；`kind='resource'` 的主题 → 409 |
| 点赞 / 取消 | ❌ 401 | ✅ | ❌ `self_action_forbidden` | ✅ | ✅ | 单向，**无踩** |
| 订阅 / 静音 | ❌ 401 | ✅ | ✅ | ✅ | ✅ | 回复即订阅（`DO NOTHING`） |
| 举报楼层 | ❌ 401 | ✅ | ❌ self | ✅ | ✅ | 已有端点，`targetKind='post'` |
| 设置 handle | ❌ 401 | ✅ **一次** | — | ✅ | ✅ | 锁定后仅站长脚本代改 |
| 读/标记自己的通知 | ❌ 401 | ✅ 仅自己 | — | ✅ | ✅ | 收件人过滤是 `user_id = actor.id`，无例外 |
| 恢复被删主题/楼层 | ❌ | ❌ | ❌ | ❌ | ❌ | M4 不做，走 SQL |

**(a) 编辑有没有时间窗？没有。**
三条理由：① 透明比限制便宜——`post.updatedAt` 已存在，前端显示"编辑于 X"即可覆盖 90% 的透明度需求；② 时间窗本身要处理"窗口内 vs 窗口外"两套 UI 与两套错误码，是白送的复杂度；③ solo 站长没有能力处理"我差一分钟没改上"这类申诉，而时间窗**制造**这类申诉。
硬停只有两条，都不是时间：**主题锁定**（409 `topic_locked`）、**楼层已软删**（404）。

**(b) staff 不能编辑他人正文——这是一条刻意的收紧。**
Discourse 允许 staff 编辑，本设计不允许。理由是申诉链：产品文档承诺"举报-处理-申诉闭环"，而"版主改写了我的话"是这个闭环里最难自证清白的一种指控，尤其在 solo + 无编辑历史表（`post_revision` 已推到 §4.4）的前提下。staff 的工具是**删除（留痕）**与**锁定**，两者都是"移除"而非"改写"，事后可查、可解释。
实现上要留意：这里**不能顺手写 `isOwnerOrStaff`**（那是本能反射），必须写 `actor.id === row.authorId` 的严格判断。

**(c) 锁帖对 staff 同样生效。**
诱惑是给 staff 开个口子好留一句"本帖已锁定，原因……"。不开：闸门多一个例外分支，就多一处会漂移的地方。正确操作顺序是**先发结帖说明，再锁**。

**(d) `canAutoPublish` 不参与论坛任何判断。**
它的判据含 `approvedResourceCount`（`session.ts:62`），纯论坛用户永远为 false。论坛侧共享的是**数据**（`role` / `strikeCount`）而不是**策略**：资源先审、帖子先发（`mined-forum-mechanics.md` §3.13）。

---

## 6. 防灌水：放哪一层

### 6.1 先回答"现有代码里有速率限制吗"——**没有，一处都没有**

去找的结果（不是假设）：

- `rate_limited` 在 `apps/api/src/errors.ts:16` 的 `ERROR_CODES` 里，**全仓再无第二处出现**：没有任何 `fail(c, 'rate_limited', ...)`。它是空悬的码。
- `apps/api/package.json` 依赖只有 hono / drizzle / better-auth / zod / @hono/zod-validator —— **没有任何限流中间件，没有 redis 客户端**。
- `apps/api/src/env.ts` 只校验 `DATABASE_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `PORT` —— **没有 `REDIS_URL`**。仓库里唯一出现 redis 的地方是 `packages/db/scripts/seed-demo-tools.ts`（那是种子内容里的一个"工具"条目，不是基础设施）。
- 写端点里唯一的配额概念是 `putImage` 的体积上限（`file_too_large`），那是单次请求的大小，不是频率。

结论：**限流在 M4 是从零建，而它是全清单里最不能省的一条**——理由与社区规模无关：公网上一个开放的写端点会被扫。

### 6.2 放哪一层：SQL 守卫，不是 redis，也不是中间件

| 候选 | 判断 |
|---|---|
| 反代 / Cloudflare 层 | 不够。它只认 IP，认不出"这个账号一小时发了 40 帖"；且本地开发环境没有它，规则会在生产才第一次生效 |
| hono 中间件 + 进程内 Map | 零依赖，但重启清零、多副本失效。**够用但不是最好**——因为下一项同样零依赖且更强 |
| 中间件 + redis | 要加依赖 + 加环境变量 + 处理"redis 挂了 fail open 还是 fail closed"。为一个日均个位数发帖的站引入一个新的可用性依赖，不划算 |
| **发帖前的一次 SQL 守卫** | **采纳**。命中现有 `post_author_idx`，跨副本精确、重启不失效、零依赖零环境变量，且**同一次查询顺带做重复内容检测** |

```ts
// modules/shrine/guard.ts —— 路由 handler 调用，不放进 content/post.ts
//（service 只管数据；策略在模块里，因为香霖堂与神社共享数据但不共享策略）
export type PostGuardFailure =
  | 'rate_limited' | 'duplicate_content' | 'link_not_allowed' | 'content_blocked'

export async function assertCanPost(
  actor: Actor, bodyMd: string,
): Promise<PostGuardFailure | null>
```

四条规则，按"挡住 spam 的性价比"排序：

1. **新账号不许发外链**（`link_not_allowed`, 403）。`mined-forum-mechanics.md` §3.9 说这是性价比最高的一刀，判断成立：SEO 垃圾的全部载体就是链接，挡住链接则垃圾发了也没收益。判据见 §6.3。
2. **冷却窗**（`rate_limited`, 429）：距上一帖 < 15s。
3. **小时配额**（`rate_limited`, 429）：未达信任 10/h，已达 60/h。
   规则 2、3 是同一条 SQL：`SELECT created_at, body_md FROM post WHERE author_id=$1 ORDER BY created_at DESC LIMIT 1` + `SELECT count(*) ... WHERE author_id=$1 AND created_at > now() - interval '1 hour'`。
4. **重复正文**（`duplicate_content`, 409）：与该用户上一帖 `bodyMd` 逐字相同。上一条查询已经把正文取回来了，零额外成本。
5. **硬词表**（`content_blocked`, 422）：20 词量级的法律红线表，放 `siteConfig`（kv 表已在）或 shared 常量。**不做变体检测、不做星号替换**——误伤一次就是一次人肉申诉，恰是要避免的东西。

`POST /topics` 与 `POST /topics/:id/posts` 两处调用同一个守卫。

**顺带一条相邻缺口**（不在 M4 范围，但应报）：`POST /api/uploads/image` 同样无限流，一个登录 bot 可以把 MinIO 填满。同一个守卫思路可以复用（按 `userId` 数最近一小时的上传），代价是要有一张上传记录——M4 若做 `post_image` 关联表（P0-1 的方案 2），它顺带就是那张表。

### 6.3 论坛侧的"信任达标"判据（**需要站长拍板**）

`approvedResourceCount` 是资源语义的，纯论坛用户永远为 0。提议：

```ts
canPostLinks(actor) =
  actor.strikeCount === 0 &&
  (actor.approvedResourceCount >= threshold || accountAgeDays(actor) >= 3)
```

选**账号年龄**而不是"有效发帖数"，理由是后者制造刷帖激励（`mined-forum-mechanics.md` §3.13 明确点名了这个风险），而账号年龄不能被行为刷出来。
实现代价接近零：`sessionMiddleware` 已经把整行 `user_profile` 查出来了（`session.ts:29-43`），`row.createdAt` 就在手里，只需把它放进 `Actor`。**注意不要用 `user.createdAt`**——better-auth 生成的那列是无时区 `timestamp`（`schema/auth.ts:9`），而 `user_profile.createdAt` 是 `timestamptz`，与全项目的时间约定一致。

---

## 7. 通知的读写端点与未读数

### 7.1 端点（2 条）

```
GET  /api/notifications?unread=true&cursor=…
POST /api/notifications/read     { ids: [...] } | { before: "2026-08-30T12:00:00Z" }
```

**`GET` 的响应项只放 key / id / 数字，不放句子也不放人名快照**：

```jsonc
{
  "items": [{
    "id": "0193…",
    "kind": "reply",                 // NOTIFICATION_KIND
    "count": 3,                      // 折叠计数
    "readAt": null,
    "createdAt": "…",
    "actor": { "id": "…", "name": "魔理沙", "handle": "marisa" },  // join 出来，非快照
    "topic": { "id": "…", "kind": "board", "title": "…" },
    "postFloor": 42,
    "resourceSlug": null,            // kind='resource' 时非空
    "payload": { "decision": "reject", "rejectReason": "copyright" }  // 只有枚举 key
  }],
  "nextCursor": "…",
  "unread": 7
}
```

**不返回 `href`。** 拼 `/shrine/t/:id?floor=42` 还是 `/kourindou/:slug#floor-42` 是 web 的路由知识；api 返回零件（`topic.kind` / `topicId` / `postFloor` / `resourceSlug`），web 按 Paraglide 的 `localizeHref()` 组装。api 里出现前端路径就是把 i18n 前缀规则复制了第二份。

**`POST /read` 返回 `{ updated, unread }`**，让红点在同一个往返里更新，省掉一次 `GET /api/me`。

### 7.2 未读数：搭 `GET /api/me`，不占路由

`apps/web` 的 root loader 每个 SSR 页面都会打 `/api/me`，未读数搭车 = 每页零额外往返。

```jsonc
// GET /api/me 的新形状（相对 me.ts:8-10 是纯增量）
{ "user": { "id":"…","name":"…","email":"…","role":"user",
            "approvedResourceCount":0,"strikeCount":0,
            "handle":"marisa","handleSetAt":"…" },
  "unread": 7 }
```

- `unread` 走部分索引 `WHERE read_at IS NULL` 并**在 100 处截断**（`SELECT count(*) FROM (SELECT 1 … LIMIT 100) t`），前端显示 `99+`。索引随阅读自然缩小，**不做反范式计数器**。
- 未登录时不查（`if (!actor) return { user: null, unread: 0 }`）。
- `handle` / `handleSetAt` 也从这里出——web 据此决定要不要弹"设置你的 handle"。

### 7.3 通知的产生点（属于服务层契约，不是路由）

同请求同事务写入。**扇出前的所有 SELECT（订阅者、handle 解析）必须在事务外**——楼层号靠 `UPDATE topic … RETURNING` 原子自增，那个 UPDATE 持行锁，把 SELECT 塞进事务等于延长整个主题的发帖串行区间。

规则一句话：**每一处 `insert(moderationLog)` 就是一个通知挂点**，加上两处不写日志但要通知的（资源进 pending 队列、新举报进队列，都发给 staff 并折叠）。逐点裁决见 `mined-notification.md` §9.2，本文不重复。

三条会直接影响契约的约束：

- 每帖提及上限 `MENTION_LIMIT = 10`，**超出直接拒绝**（`mention_limit_exceeded`）而不是静默截断——静默截断会让一次真诚的 12 人点名悄悄丢 2 个。
- `PATCH /posts/:id` **只对新增的 handle 发提及通知**（新旧 `extractMentions()` 结果取差集）。不做的话，改一个错别字会把所有人重新 @ 一遍。
- 回复即订阅的 upsert 必须 `DO NOTHING`；取消订阅写 `state='muted'` 行而不是删行。订阅者查询用白名单 `state === 'watching'`。

---

## 8. 新增 error code（6 个）

现有 12 个（`errors.ts:11-24`）全部继续用。每个新码的准入判据是：**它对应一个与既有码不同的用户补救动作**，否则前端的 Paraglide 文案会撒谎。

| 新码 | HTTP | 触发 | 为什么不能复用现有码 |
|---|---|---|---|
| `topic_locked` | 409 | 向已锁定的主题发帖 / 编辑其中的楼层 | `invalid_state_transition` 是状态机跃迁非法；这里没有跃迁，是一个持久属性挡住了写。用户要看到的是"此主题已锁定"，不是"状态不合法" |
| `mention_limit_exceeded` | 422 | 单帖 `@` 超过 10 人 | `validation_failed` 只带 `fields`，前端只能说"格式有误"。这里的补救是"减少 @ 的人数"，必须说得出来 |
| `duplicate_content` | 409 | 与自己上一帖正文逐字相同 | 与 `rate_limited` 的补救**相反**：那个是"等一会儿再发"，这个是"等多久都没用，改内容" |
| `link_not_allowed` | 403 | 未达信任的账号发含外链的帖 | `forbidden` 太泛，用户会以为自己没权限发帖；实际补救是"去掉链接就能发" |
| `handle_taken` | 409 | handle 已被占用 | `duplicate_slug` 语义是资源 slug，且 handle 表单要就地高亮字段。（`duplicate_slug` 今天在全仓也没有抛出点，属另一笔待清的空悬码） |
| `content_blocked` | 422 | 命中硬词表 | 同 `mention_limit_exceeded`：`validation_failed` 说不出"内容包含不允许的词语" |

**刻意不加的**（记下来免得日后有人再提）：

- `post_not_found` / `topic_not_found` / `topic_deleted` → 一律 `not_found` 404。区分它们等于给探测者一个预言机（M3 在举报端点上已经立过这条规矩：`interactions.ts:115-119` 的注释）。
- `already_liked` / `not_subscribed` → PUT/DELETE 幂等，重复调用返回当前状态，不是错误。
- `handle_locked` → 403 `forbidden` 足够：`/api/me` 已经返回 `handleSetAt`，前端在锁定时根本不会渲染这个表单，403 只是服务端的防御性兜底。
- 新增 `ERROR_CODES` 必须同步补三语 Paraglide 文案（`apps/web/messages/{zh,ja,en}.json`），否则前端会退化成显示裸 code。

---

## 9. 对现有代码的必须改动（含新增项）

`mined-reusable.md` 已列 7 处，本文确认并补 3 处。按"不改必炸"排序：

| # | 位置 | 改什么 | 来源 |
|---|---|---|---|
| **P0-1** | `apps/api/scripts/gc-images.ts` `referencedUrls()` | 加第四个引用来源（倾向建 `post_image` 关联表而非正则扫 `bodyMd`——图片 GC 是错删不可逆的路径，正则匹配 UGC 正文不该出现在不可逆路径上） | mined-reusable |
| **P0-2** | `DELETE /posts/:id`（本文迁到 `/shrine/posts/:id`） | staff 删他人楼层要写 `moderationLog` | mined-reusable |
| **P0-3（新）** | `topic.lastPostAt` 可空 + M3 建资源主题时未赋值 | 改 `NOT NULL DEFAULT now()` 并在建主题时写入，否则**零评论的资源主题会霸占最新流最前面**（§4.1） | 本文 |
| **P0-4（新）** | `GET /kourindou/resources/:slug` | 响应加 `topicId`；否则 §1 的合并方案落不了地 | 本文 |
| P1-1 | `MODERATION_ACTION` 枚举 | 加 `post_delete` / `topic_delete` / `topic_moderate` 三个值（走 `ALTER TYPE ADD VALUE`，`0002_certain_master_mold.sql` 有一行先例） | mined-reusable + 本文收敛 |
| P1-2 | `REPORT_REASON` 枚举 | 加 `spam` / `harassment`。现有五值全是资源语义，论坛最高频的两类举报无处可选 | mined-reusable |
| P1-3 | `GET /moderation/reports` 的 select 投影 | LEFT JOIN 出目标上下文（帖子：楼层号/主题标题/正文摘要/作者；资源：slug/标题），否则审核员只看到一串 uuid。JOIN 时注意 `report.target_id` 是 text 而 `post.id` 是 uuid，用 `post.id::text = report.target_id` 避免 22P02 | mined-reusable |
| P1-4 | `apps/web/app/routes/dash/reports.tsx` | 消费 P1-3 的新字段；排序挪到 api 的 `orderBy`（现在的前端手工 sort 只对当前页有效） | mined-reusable |
| P2-1 | `interactions.ts` 举报的 post 分支 | JOIN topic 判可见性；本文的 `loadVisibleTopic()` 正好是现成的闸门 | mined-reusable |
| P2-2 | `content/post.ts` 的 `catch {}` | 只在能确定的业务失败上返回 `ok:false`，其余重抛给 `app.onError`。它现在闷死了 `post_topic_floor_uq` 这道专为楼层竞态设的告警通道 | mined-reusable |
| P2-3 | `POST /kourindou/reports` | 拆成 `POST /api/reports`。web 端零调用方，现在改接近免费 | mined-reusable |

**P1-1 的收敛说明**：`mined-reusable.md` 提示可能要加 `topic_lock` / `topic_pin` 等。本文合并成一个 `topic_moderate`，`toValue: { action, from, to }`。判据沿用 `enums.ts:110-111` 那条注释的精神——**审计日志要能被过滤**，而审计员真正会过滤的是"删了什么"（`post_delete` / `topic_delete`），pin/lock/move 是同一类低强度属性处置，拆成三个值只会让 `ALTER TYPE` 多跑两次而查询侧毫无收益。

**M4 明确不该碰的**：`GET /moderation/queue`（资源待审队列）。`post` 表没有 status 列，产品选的是先发后审，论坛的"审"入口是举报队列不是待审队列。

---

## 10. 明确不做（API 层）

| 不做 | 一句话理由 |
|---|---|
| `GET /api/shrine/boards` + `board` 表 | 六个固定版块是 UI chrome，归 Paraglide + shared 常量（§3.3） |
| `PATCH /api/shrine/topics/:id`（改标题） | 折进 `PATCH /posts/:id`，标题是 1 楼作者的属性 |
| 主题恢复 / 楼层恢复端点 | 走站长 SQL，M3 已有"认领审批走 SQL"的先例 |
| 未读标记 / 阅读位置端点 | 实现最复杂 × 冷启动价值最低；替代品是"最新流 + 相对时间" |
| 版块级订阅 | 6 个版块、流量近 0，站长本来就看全部。日后一张 `board_subscription` 是纯 additive |
| 通知偏好端点 | 通知类型只有 5 种，且都该收。有了偏好表就要有偏好 UI 与三语文案 |
| 私信 | 骚扰主通道，补的时候必须同时补拉黑与举报，否则不要上线 |
| 帖子全文搜索端点 | 要一条新 Meili 索引管道 + 软删/不可见内容的权限过滤。主题标题搜索先顶着（可直接进现有索引） |
| 邮件 / WebPush / SSE | 前置链（发信域名 DNS、退订、退信、跨进程 pub/sub）各自是独立里程碑 |
| `emailedAt` 之类的预留列 | 标准 YAGNI 预留，库里没数据时"以后要迁移"不成立 |
| 踩 / 多 emoji 反应 / 加精 / 勋章 | 加是 additive，撤不是 |

---

## 11. 已知取舍与留给站长拍板的问题

**已知会被指出的一处妥协：编辑可以抹掉举报证据。**
M4 没有 `post_revision`（推到日后），而 `PATCH /posts/:id` 无时间窗。于是被举报者可以在版主看到之前改掉正文。缓解：举报队列的正文摘要是**实时 join**（看到的是当前内容），且 `report.detail` 保留了举报人自己的陈述。这不是完整的证据链，是**在 M4 规模下可接受的缺口**，升级路径明确且 additive（加一张 `post_revision`）。写在这里是为了不让它变成"没人想到"。

需要拍板的（本文无法自行决定）：

1. **合并 URL 要不要现在做。** 本文的 §1 建议删掉 `/kourindou/resources/:slug/posts`。它会动到 M3 已跑通的 `detail.tsx` 与 `content.test.ts` / `e2e.ts`。保守选项是先并行一个版本——但那正是 §1.2 说的"两个闸门"。
2. **handle 的获取时机。** 本文倾向：在 `sessionMiddleware` 惰性建 `user_profile` 时**自动生成** `u_<8位>`（那里已经有 `onConflictDoNothing` 的惰性创建，是零新代码路径的挂点），用户可自选覆盖一次然后锁定。理由：若 handle 是可选的，大多数用户没有 handle，于是**大多数用户不可被 @**——静默地废掉一半提及功能。代价是会有一批 `u_a7f3k2m9` 样的丑 handle。另一选项是首次发帖前强制自选。**一旦对外就不可逆。**
3. **handle 字符集**：`^[a-z0-9_]{2,20}$`（本文取值，无连字符、纯 ASCII）vs 允许假名。ja 有战略意义，但假名会让 @ 补全的终止边界与 URL 编码都复杂化。
4. **移动版块要不要进 M4。** `mined-forum-mechanics.md` §4.16 建议推迟，理由是"要配审计留痕 + 通知作者才算做完"。本文把它放进了 `/moderate`，因为**留痕与通知在 M4 恰好都已存在**，边际成本是一个 union 分支；且六个边界模糊的版块在冷启动期必然出现放错版，替代方案（删掉让用户重发）更糟。请确认这次覆盖。
5. **论坛侧信任判据用账号年龄（3 天）还是别的**（§6.3）。这条决定了新用户多久能发外链。
6. **资源下架 = 讨论主题隐藏，还是只读可见**（§1.4）。本文取"隐藏"，与 M3 现状一致；若产品要"只读可见"，改的是 `loadVisibleTopic()` 一个函数。
7. **staff 的 `mod_queue` 通知要不要与用户通知混在一个收件箱**（`mined-notification.md` 开放问题 5）。本文的 `GET /api/notifications` 不分 tab，靠 `kind` 区分；要分 tab 就是一个 query 参数，additive。
8. **`/status` 绕开 `/review` 导致信任梯度不推进**（`mined-notification.md` §9.3）——M3 遗留的既有不一致，M4 要不要顺手收口（把 `pending -> published` 从 `/status` 的允许集合里去掉）。
9. **`admin.ts` 的 `POST /resources/:id/restore` 完全不写 `moderationLog`**（`:153-168`）——既有审计缺口，与 M4 无关但应报。
