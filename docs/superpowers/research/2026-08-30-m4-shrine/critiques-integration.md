# M4 博丽神社：与已建成系统的接缝审查

2026-08-30 · 状态：**对抗审查产物**。本文只审查「M4 设计」与「仓库里真实存在的代码和数据」之间的接缝。

审查对象是四份设计定稿（`designs-schema.md` / `designs-api.md` / `designs-web.md` / `designs-notification.md`），
判据是**真实代码与真实数据**，不是设计文档的自述。凡引用行号，都是 2026-08-30 仓库现状。

> 本文是文档。代码块是「对不上的地方长什么样」的精确表达，**不得复制进 `packages/` 或 `apps/`**。

---

## 0. 一页结论

产品文档第 1 号已批准决策是「资源评论 = 论坛帖，一套内容系统两个视图」。
去代码里查证的结果：**同源性在数据层是真的，在服务层是半真的，在闸门层是假的，在设计文档之间是矛盾的。**

- **数据层（真）**：`topic` / `post` 两张表确实是共用的，dev 库里已经有 662 条 `kind='resource'` 主题、177 条楼层、13 条 `targetKind='post'` 的举报。形状是对的。
- **服务层（半真）**：`content/post.ts` 的注释写着「设计上就有两个调用方」，但今天**只有一个**调用方（`content/index.ts`）。它的五个导出函数没有一个能被 M4 直接复用而不改签名。
- **闸门层（假）**：可见性判断散在三处且**已经在漂移**——比两份设计文档所描述的还要更碎一层。
- **文档层（矛盾）**：四份设计在 **8 个具体点上互相冲突**，其中 5 个是「实现出来编译不过或跑不通」级别的（§10）。这是本次审查发现的最高优先级问题：**在裁决这 8 条之前，M4 一行代码都不该写。**

### 严重度汇总

| # | 接缝 | 严重度 | 一句话 |
|---|---|---|---|
| S1 | 四份设计互相矛盾 8 处 | **P0** | 枚举值集、版块方案、版块 slug、handle 可空性、列名、错误码，各文件各说各的（§10） |
| S2 | `topic.title` 的 CHECK 与库里 657 行冲突 | **P0** | 迁移会失败；6 个 seed 脚本会开始抛 23514（§9.2） |
| S3 | `lastPostAt NOT NULL` 与库里 611 行冲突 | **P0** | 同上，且需要回填（§9.2） |
| S4 | `board` 表 + FK restrict 会打死一个既有测试 | **P0** | `packages/db/src/kourindou.test.ts:151` 写死 `boardSlug:'shrine'`（§9.3） |
| S5 | 可见性闸门有**三处**而不是两处 | **P0** | `topicForResource()` 不查 `topic.deletedAt`，M4 版主软删主题后资源页照列评论（§3.1） |
| S6 | `content/post.ts` 被两份设计以不兼容的方式改写 | **P0** | api 改签名为 `TopicView`，notification 按现签名打补丁（§2.1） |
| S7 | 举报队列没有「处置」动作也没有跳转 | **P0** | 「举报-处理-申诉闭环」在帖子上是断的（§4.2） |
| S8 | `post.locale` 只存在于前端设计里 | **P1** | schema 预算里没有这一列，写入路径也没定义（§2.4） |
| S9 | `handle NOT NULL` 需要给 603 行 user_profile 回填 | **P1** | 不是「零成本重建」（§9.2） |
| S10 | 论坛违规不推进 `strikeCount` | **P1** | 论坛灌水者在香霖堂仍然「即发即审」（§5.3） |
| S11 | `PostView` 类型手写在 web 侧 | **P1** | 违背 CLAUDE.md 的类型主轴（§7.2） |
| S12 | 错误码与 message key 的命名两边对不上 | **P1** | `duplicate_content` vs `err_duplicate_post` 等 4 处（§8.3） |
| S13 | `isOwnerOrStaff` 是本仓库的肌肉记忆，会直接违反「staff 不得编辑他人正文」 | **P1** | 需要一个显式的 `isSelf` 才防得住（§3.3） |
| S14 | `DELETE /posts/:id` 无事务、无审计、无主题闸门、中间件顺序错 | **P1** | 三份文档各修了一半（§3.2） |
| S15 | seed-demo × 6 不写订阅行 | **P2** | 演示数据的评论不产生任何通知（§6.4） |
| S16 | `gc-images` 的修法在 designs-web 里理由写错了 | **P2** | `purpose='post'` 不能解决 GC 问题（§11 第 22 项） |

---

## 1. 审查方法与证据来源

**读过的真实文件**（全文，非节选）：
`packages/db/src/schema/content.ts` · `kourindou.ts` · `auth.ts` · `index.ts` ·
`apps/api/src/modules/content/{index,post}.ts` · `kourindou/{index,status}.ts` · `moderation.ts` · `admin.ts` · `interactions.ts` · `me.ts` · `uploads.ts` ·
`apps/api/src/{app,errors,storage}.ts` · `middleware/{session,require}.ts` ·
`apps/api/scripts/{gc-images,e2e}.ts` · `apps/api/src/content.test.ts` · `packages/db/src/kourindou.test.ts` ·
`packages/shared/src/{index,pagination}.ts` · `kourindou/{enums,schemas,localized}.ts` ·
`apps/web/app/routes/{routes.ts,stub.tsx,login.tsx}` · `kourindou/detail.tsx` · `dash/{layout,reports,queue}.tsx` ·
`apps/web/app/{root.tsx,lib/{api,display}.ts,components/site-header.tsx}` · `messages/{zh,ja,en}.json` ·
`packages/db/scripts/seed.ts` + `seed-demo*.ts` × 6。

**dev 库实测**（`psql-18 $DATABASE_URL`，2026-08-30）：

```
topic         kind='resource' 662 行（657 行 title 非空，51 行 last_post_at 非空）
              kind='board'     10 行（board_slug 全部是 'shrine'，title 全部是 'x'）
post          177 行（11 行属于 status<>'published' 的资源；11 行已软删）
report        50 行 targetKind='resource' + 13 行 targetKind='post'
user_profile  603 行
```

这组数字直接推翻了设计文档反复引用的那个前提——「库里没有数据」。**生产库确实是空的，但 dev 库不是**，而 M4 的每一次 `bun run migrate` 都先打在 dev 库上。详见 §9。

---

## 2. 接缝 1：同源性是真的吗

### 2.1 P0 — 两份设计以**不兼容的方式**改写同一个文件

`apps/api/src/modules/content/post.ts` 是整个 M3 唯一保留的 service 抽象，注释写着「设计上就有两个调用方」。
去查调用方：

```
apps/api/src/modules/content/index.ts:10-13   ← 唯一的 import
```

全仓再无第二处。所以「两个调用方」到今天为止是**意图**，不是事实。这不是问题；问题是两份设计要把它改成两个不同的东西：

| 文档 | 要求的 `createPost` 形状 |
|---|---|
| `designs-api.md` §1.4 | `createPost(topic: TopicView, input)` —— 参数从裸 `topicId` 换成「已过闸的主题视图」，让类型系统承担闸门证明 |
| `designs-notification.md` §4.3 | 保持现签名 `createPost(input: {topicId, authorId, bodyMd, parentId})`，在 `:59-66` 和 `:86-95` 之间插入订阅与扇出，并给 `CreatePostResult.reason` 加 `'mention_limit'` |

两者都精确到行号，两者都自洽，**合起来落不了地**：notification 那份的补丁位置（`:59-66` 的父楼查询、`:86-95` 的 insert）在 api 那份重写之后就不存在了；而 api 那份的 `TopicView` 参数一旦落地，notification 设计里「事务外先查订阅者与 handle」的三步就要重排（因为闸门查询已经在路由层做过一次 topic 联查，再查一次是重复往返）。

**怎么对齐**：M4 计划必须指定 `content/post.ts` 的**唯一目标签名**，并让通知挂点的行号描述作废（改成「在 insert(post) 之后」这种结构描述）。建议采纳 api 那份的 `TopicView` 参数——它是 S5 的解药——同时把 notification 的三步（父楼 authorId、`extractMentions` + `resolveHandles`、`watchersOf`）作为**同一个函数内部**的前置步骤，而不是路由层的额外查询。

**回归风险**：中。`content.test.ts` 的 10 个用例全部经由 HTTP 打进来，签名改动本身不破测试；破测试的是 URL 合并（§11 第 24 项）。

### 2.2 有没有偷偷分叉：逐列体检

对 M4 提议的每一处 topic/post 增量，问「资源评论视图用不用得上」：

| 增量 | 论坛用 | 资源评论用 | 判断 |
|---|---|---|---|
| `topic.pinnedAt` | ✅ | ❌ | 可接受。CHECK 不禁止资源主题被置顶，但没有 UI 能置顶它，是死列不是分叉 |
| `topic.lockedAt` | ✅ | ✅（版主锁掉一个吵起来的评论区） | 真共用 |
| `topic.boardSlug` | ✅ | ❌（CHECK 钉死为 NULL） | 已被约束隔离，可接受 |
| `topic.title` | ✅ | ❌（CHECK 钉死为 NULL） | **这是修 bug，不是分叉**——见 §9.2 |
| `post.likeCount` + `post_like` | ✅ | ✅ | 真共用，但**前提是 URL 合并**，见下 |
| `post.locale` | ✅ | ✅ | **只出现在 designs-web，schema 预算里没有**，见 §2.4 |
| `topic_subscription` | ✅ | ✅（「我的资源有新评论」就是它） | 真共用，是本设计里最漂亮的一处复用 |

**唯一真正的分叉风险不在列上，在 URL 上。**
`designs-api.md` §1 主张删掉 `/api/kourindou/resources/:slug/posts`，`/api/shrine` 独占。这条**不是命名审美，它是 like / report / edit 三个新能力能否共用的前提**：

- 点赞端点在 `PUT /api/shrine/posts/:id/like`（api §2 路由 11）。
- 但资源评论区的楼层列表如果仍从 `/api/kourindou/...` 出，那么**同一条 post 的读走香霖堂闸门、写（点赞）走神社闸门**——恰好是 api §1.2 论证要避免的「两个闸门」，而且是在同一个页面上。

所以 §11 的待拍板问题 1（「合并 URL 要不要现在做」）**不是保守 vs 激进的选择，是「有没有第二套闸门」的选择**。建议：合并，且在 M4 第一个 PR 就合并（此刻只有 12 个调用点；M4 之后是 30+）。

### 2.3 `listPosts` / `createPost` 两边能直接用吗

**不能**，差在四处：

| 函数 | 现状 | 论坛侧缺什么 |
|---|---|---|
| `listPosts(topicId, page, pageSize)` `:16-47` | OFFSET 分页；投影只有 `{id, floor, bodyMd, deleted, parentId, createdAt, updatedAt, author:{id,name}}` | ① 楼层区间分页（D2）② 8 个新字段（`handle`/`avatarUrl`/`role`/`likeCount`/`likedByViewer`/`quoted`/`mentions`/`locale`）③ **完全不碰 `topic` 行**——见 S5 |
| `createPost(input)` `:53-102` | 无提及、无订阅、无扇出、无限流、`catch {}` 把一切异常翻译成 404 | 全部 |
| `softDeletePost(id)` `:105-107` | 裸 UPDATE | 无审计、无通知、不区分作者/staff |
| `findPost(id)` `:109-116` | 返回 `{id, authorId, topicId}`，**不过滤 `deletedAt`** | 重复删除会重写 `deleted_at`（幂等但审计会重复记一条）；且不带主题上下文，没法判锁 |
| `topicForResource(resourceId)` `:118-125` | `WHERE resource_id = $1`，**不过滤 `topic.deletedAt`** | 见 S5 |

结论：**五个函数没有一个能原样复用。** 这不是设计缺陷——service 本来就该改；但它意味着「M4 直接复用 M3 的 service」这句话在计划里必须改成「M4 重写 service，两个视图共用重写后的版本」，工作量估算不同。

### 2.4 P1 — `post.locale` 是设计之间的一个洞

`designs-web.md` §6.3 把「存发帖时的 UI locale 当 `lang=` 属性」定为「M4 唯一要做的一件 i18n 事」，理由充分（CJK 字形选择是今天就存在的显示错误）。它需要 `post.locale varchar(5)`。

但：

- `designs-schema.md` §0 的预算是「**5 个新列**」，逐一点名：`topic.pinnedAt` / `topic.lockedAt` / `post.likeCount` / `user_profile.handle` / `user_profile.handleSetAt`。**没有 `post.locale`。**
- 写入路径未定义。API 侧没有任何 locale 概念——Paraglide 的 locale 活在 web 的 URL 前缀里（`:locale?`），`apps/api` 全仓不解析它。所以要么：
  - `createPostSchema` 加一个 `locale: z.enum(LOCALES)` 字段（**但这个 schema 是两个视图共用的**，资源评论区也要传），或者
  - api 读 `Accept-Language`（不准，且和 UI locale 不是一回事）。
- 一旦选前者，`packages/shared` 的 `LOCALES` 需要被 shrine 契约引用，而 `designs-api.md` §3.2 主张 shrine 不依赖 kourindou —— `LOCALES` 在 `kourindou/localized.ts:3`，也要一起上提。

**怎么对齐**：把 `post.locale` 写进 schema 预算（变成 6 列），并在 `createPostSchema` 里加 `locale`，同时把 `LOCALES` / `localizedTextSchema` 一起上提到 `packages/shared/src/`（它们和 id schema 一样，从来就不是香霖堂的东西）。

---

## 3. 接缝 2：权限模型一致吗

### 3.1 P0 — 资源评论区今天的权限规则，以及它比设计文档描述的**还要碎一层**

去 `apps/api/src/modules/content/index.ts` 逐条读：

```ts
// :19-33
async function publishedTopic(slug: string) {
  const [row] = await db.select({ id: resource.id }).from(resource)
    .where(and(eq(resource.slug, slug),
               eq(resource.status, 'published'),      // ← 白名单，正确
               isNull(resource.deletedAt)))
    .limit(1)
  if (!row) return null
  return topicForResource(row.id)                      // ← 这里之后不再有任何判断
}
```

三条实际规则：

| 动作 | 实际闸门 | 缺什么 |
|---|---|---|
| `GET /resources/:slug/posts` `:40-49` | `publishedTopic()` → `topicForResource()` → `listPosts()` | **三段都不查 `topic.deletedAt`** |
| `POST /resources/:slug/posts` `:51-76` | `publishedTopic()` + `createPost()` 里的 `isNull(topic.deletedAt)`（`post.ts:81`） | 查了 |
| `DELETE /posts/:id` `:78-87` | `isOwnerOrStaff(actor, row.authorId)` | **完全不碰 topic**：不查主题是否可见、是否已删、是否锁定 |

`designs-api.md` §1.2 把这条描述成「`createPost` 带了 `isNull(topic.deletedAt)`，`listPosts` 完全不碰 topic 行，靠路由层 `publishedTopic()` 在外面把关侥幸过关」。

**这个描述不完整，而缺的那一半正是要命的那一半**：`publishedTopic()` 把关的是**资源**，`topicForResource()`（`post.ts:118-125`）把关的是**什么都没有**——它只按 `resourceId` 取行，`topic.deletedAt` 不在 WHERE 里。也就是说：

> 今天，一个被软删的 `kind='resource'` 主题，它的楼层仍然会在资源详情页上被完整列出；而同一个主题上的**发帖**会返回 404。

M3 侥幸过关的真实原因不是「路由层多把了一道关」，而是**M3 没有任何代码路径会软删 topic**。M4 第一次给版主「删主题」的能力，这条路径当天就活了：版主删掉一个吵起来的资源讨论主题 → 资源页上的评论一条不少，只是没人能再回复。

**怎么对齐**：`designs-api.md` §1.4 的 `loadVisibleTopic()` 是正确的解药，但它的实现必须**取代 `topicForResource()` 而不是并列**——`topicForResource()` 应当被删除，不是保留。同时 `content/post.ts` 里所有函数改成接收 `TopicView`，让「没过闸就拿不到参数」成为编译期事实。

`designs-schema.md` §3.2 的 `visibleTopic()` 与 api 的 `loadVisibleTopic()` 是同一个东西的两个名字和两套返回形状（schema 版返回 `{id,kind,lockedAt,resourceStatus,resourceDeletedAt}`，api 版返回 12 字段的 `TopicView`）。这也要合成一个（§10 第 6 条）。

### 3.2 P1 — `DELETE /posts/:id` 有四个独立缺陷，三份文档各修了一半

```ts
// content/index.ts:78-87
.delete('/posts/:id', entityIdParam, requireAuth, async (c) => {
  const actor = c.get('actor')
  if (!actor) return fail(c, 'unauthorized', 401)
  const row = await findPost(c.req.param('id'))
  if (!row) return fail(c, 'not_found', 404)
  if (!isOwnerOrStaff(actor, row.authorId)) return fail(c, 'forbidden', 403)
  await softDeletePost(row.id)
  return c.json({ deleted: true })
})
```

| 缺陷 | 谁修了 | 谁漏了 |
|---|---|---|
| staff 删他人楼层不写 `moderationLog` | schema §8.5、api P0-2、notification §4.7 | — |
| 无事务（审计 + 软删 + 通知要原子） | notification §4.7 | schema / api 只说「写日志」，没说要开事务 |
| **不查主题可见性 / 锁定** | **无人** | 三份都没提。M4 之后：版主可以删掉一条他看不见的主题里的楼层；作者可以删掉已锁主题里的自己的楼层（可能是想要的，但没人写下来） |
| **中间件顺序 `entityIdParam, requireAuth`**：未登录 + 非法 uuid 得到 400 而不是 401 | notification §4.7 脚注 | schema / api 没提；但 api §2 的 16 条新路由表把校验列写成 `entityIdParam` 在前 |

**怎么对齐**：把这个端点的目标形状一次写全（事务 + 审计 + 通知 + `TopicView` 闸门 + `requireAuth, entityIdParam` 顺序），并在 M4 的路由约定里写死「**`requireAuth` 永远在 `entityIdParam` 之前**」——现有的 6 条 `:id` 路由（`kourindou/index.ts` 5 条 + `content/index.ts` 1 条）都是反的，M4 的新路由不能跟着抄。

### 3.3 P1 — 同一个 post 从两个入口进来，判权限的代码是不是同一段

**删除**：是同一段（`isOwnerOrStaff`），因为只有一个端点。
**编辑**：M4 新增，而 `designs-api.md` §5(b) 定了一条**刻意的收紧**——staff 不能编辑他人正文，只能删和锁。文档自己也警告：「实现上要留意，这里**不能顺手写 `isOwnerOrStaff`**」。

这个警告不够。去数一下 `isOwnerOrStaff` 在仓库里的出现频率：

```
apps/api/src/middleware/require.ts:22    定义
apps/api/src/modules/kourindou/index.ts:106, 227, 295, 382, 423   5 处
apps/api/src/modules/content/index.ts:83                          1 处
```

**它是这个仓库里「谁能改这个东西」的唯一表达方式，出现 6 次，全部是「作者或 staff」。** 在这种肌肉记忆下，靠注释防住第 7 次是不现实的。

**怎么对齐**：在 `middleware/require.ts` 加一个**具名的、有注释的**反向工具，让正确写法比错误写法更短：

```ts
/** 只有作者本人。staff 不在此列——「版主改写了我的话」是申诉链上最难自证的指控。 */
export const isSelf = (actor: Actor, ownerId: string | null) => actor.id === ownerId
```

并在 `PATCH /shrine/posts/:id` 的实现上挂一条测试：`moderator 编辑他人楼层 → 403`。没有这条测试，这个设计决定活不过第一次重构。

### 3.4 P2 — 举报 post 分支不查主题可见性

`interactions.ts:136-146`：post 分支只查 `post.deletedAt IS NULL`，不 join topic。

后果（两个视图都有）：一个曾经发布、后来下架的资源，它评论区里的楼层仍可被举报（201），而不存在的 id 返回 404 —— 这就是 `interactions.ts:115-119` 注释里自己反对的那种**存在性预言机**，只是资源分支修了、post 分支没修。M4 之后 post 分支的流量会超过 resource 分支。

`designs-api.md` P2-1 点名了这条并给了解法（用 `loadVisibleTopic()`）。**同意，但要注意它与 §4.1 的 targetKind 讨论有冲突**：如果举报端点搬到 `POST /api/reports`（api P2-3），那它就要 import shrine 的可见性函数，而 `reports` 是平台级模块。建议把 `loadVisibleTopic()` 放在一个不属于 shrine 的位置（比如 `modules/content/visibility.ts`），因为它的两个消费者一个在神社、一个在治理。

---

## 4. 接缝 3：审核与举报

### 4.1 帖子举报进现有 report 表：**零 schema 改动，这一点三份文档都对**

查证：

```ts
// packages/db/src/schema/kourindou.ts:360-384
targetKind: varchar('target_kind', { length: 16 }).notNull(),   // 无 enum、无 CHECK、无外键
targetId:  text('target_id').notNull(),
```
```ts
// packages/shared/src/kourindou/schemas.ts:157-162
targetKind: z.enum(['resource', 'post']),      // 'post' M3 就在
```
dev 库里已经有 13 行 `targetKind='post'`。所以「帖子举报进现有表」不是一个待做项，**它已经能用了**。

`designs-schema.md` §8.1 的推理（主题正文 = floor 1 的 post，所以不需要 `'topic'` 值）成立，且它依赖「topic 表没有正文列」这个决定——两者要一起守住。

### 4.2 P0 — 但队列**处理不了**帖子举报，这才是真正的缺口

`GET /moderation/reports`（`moderation.ts:135-145`）返回 `select()`（report 全列），前端 `dash/reports.tsx` 渲染：

```tsx
<Badge variant="outline">{r.targetKind}</Badge>        {/* :104  裸英文，未 i18n */}
<CardTitle className="mt-2 font-mono text-sm break-all">
  {r.targetId}                                          {/* :109-111  一串 uuid，无链接 */}
</CardTitle>
```

审核员看到的是「post」+ 一串 uuid，**既不知道内容是什么，也点不进去**。三份文档都点了这一条（api P1-3/P1-4、schema §8.4、web §2.9），修法一致（LEFT JOIN 目标上下文 + 排序挪到 `orderBy`）。同意。

**但三份都漏了更关键的一条：队列里没有「处置」动作。**

`Actions`（`reports.tsx:48-74`）只有两个按钮：`resolve` 和 `dismiss`，两者都只改 `report.status`，**不动目标**。也就是说处理一条帖子举报的完整流程是：

1. 在 `/dash/reports` 看到举报 → 2. 手工把 uuid 复制出来 → 3. 猜它属于哪个主题 → 4. 去主题页删楼 → 5. 回队列点 resolve。

第 2、3 步今天做不到（没有链接）。**「举报-处理-申诉闭环」在帖子上是断的**，而这是产品文档明写的配套能力。

**怎么对齐**（这是本文对设计的一个新增要求，四份文档都没写）：

- `GET /moderation/reports` 的投影必须包含**跳转所需的全部零件**：`targetKind` + `topicId` + `postFloor` + `topicTitle` + `resourceSlug`（因为 `kind='resource'` 的主题要跳 `/kourindou/:slug#p<floor>`，`kind='board'` 的跳 `/shrine/t/:id?floor=N`）。api §7.1 已经为通知定过这套零件，队列复用同一组。
- 队列卡片上加**第三个按钮「删除该楼层」**（走 `DELETE /shrine/posts/:id`），或者至少加一个跳转链接。前者更符合「低人肉运营」——solo 站长处理一条 spam 举报应当是一次点击而不是五步。

**关于「一个混合队列还是两个 tab」**：四份文档都没有正面回答这个问题，只是隐含地假设了混合队列。本文的判断是**混合队列 + `targetKind` 徽章 + 按 reason 优先级排序**，理由是：

- 队列不是按对象类型分工的，是按**紧急度**分工的。`copyright`/`illegal` 的资源举报和 `harassment` 的帖子举报都属于「今天必须处理」，把它们分到两个 tab 会让站长必须记得看两个地方。
- solo 运营下只有一个人，分 tab 的唯一收益（分工）不存在。
- 分 tab 是纯前端的 additive 改动，等真出现「帖子举报每天 50 条淹掉版权举报」时再分。

配套要求：`report_status_created_idx (status, created_at)` 已存在，但按 reason 排优先级需要在 `orderBy` 里用 `CASE WHEN reason IN ('copyright','illegal','harassment') THEN 0 ELSE 1 END`——它不走索引，在 50 行量级上无所谓，写进注释即可。

### 4.3 P2 — `GET /reports` 没有 `total`

`GET /moderation/queue` 返回 `{items, page, pageSize, total}`（`:53`），`GET /reports` 只返回 `{items, page, pageSize}`（`:144`）。前端因此建不出分页器（`dash/reports.tsx` 今天硬编 `pageSize:'50'` 且无分页 UI）。M4 帖子举报进来后这会在第 51 条开始丢内容。加一个 `count(*)` 即可。

顺带：`designs-notification.md` §1.2 用「`GET /moderation/queue` 已经返回 `total`」论证「用 dash 导航计数代替 staff 待办通知」——这条**只对资源队列成立**。举报队列没有 total，要显示「7 件待处理举报」得先补这个字段。这是那条裁决的一个未言明的前置。

### 4.4 REPORT_REASON 加值是安全的

`REPORT_REASON` 加 `spam` / `harassment` 会让 `dash/reports.tsx:36-43` 的 `reasonLabel` 对象字面量缺键，TypeScript 在 `({...})[r]` 处报错（`r: ReportReason` 的联合含未覆盖成员）。**这是好事**——typecheck 会强制补上两条 message key，不会静默返回 `undefined`。`dash/queue.tsx` 的 `reject_*` 映射同理。

同样的检查用在 `MODERATION_ACTION` 上：它没有任何前端映射（审计日志无 UI），所以加值不会被 typecheck 兜住——这让 §10 第 3 条的三方分歧更危险。

---

## 5. 接缝 4：信任等级

### 5.1 `canAutoPublish` 现状与论坛的关系

```ts
// apps/api/src/middleware/session.ts:62-63
export const canAutoPublish = (actor: Actor, threshold: number) =>
  actor.strikeCount === 0 && actor.approvedResourceCount >= threshold
```

三个调用点，全在 `kourindou/index.ts`（`:297` submit、`:341` status、`moderation.ts:90` 传常量 false）。

`designs-api.md` §5(d) 的判断正确且应当采纳：**论坛不过这个梯度**。理由它写得很好——两个模块共享的是**数据**（`role` / `strikeCount`）而不是**策略**（资源先审、帖子先发）。

### 5.2 `approvedResourceCount` 要不要改名：**不改**

论坛语境下这个名字仍然成立——它字面就是「通过审核的资源数」，论坛不用它。真正的问题不是列名，是**函数名**：`canAutoPublish` 是通用名，M4 会出现第二个信任谓词（`canPostLinks`），两个通用名放在一起就会被误用。

| 方案 | 改动面 | 收益 |
|---|---|---|
| 改列名 `approvedResourceCount` → `trustScore` 之类 | DB 列 + `session.ts:12,50,63` + `moderation.ts:37,108` + `admin.ts:45` + `me.ts:7,9` + web `SessionUser:23` + `dash/queue.tsx` + `admin/users.tsx` + 2 条 message key（`dash_trust_n` `admin_trust_summary`）+ **603 行 dev 数据的迁移** | 无。名字本来就准确 |
| **改函数名 `canAutoPublish` → `canAutoPublishResource`** | 3 个调用点，零 DB 改动 | 让 `canPostLinks` 并排时不会拿错 |

**建议：只改函数名。** 这也是对 `designs-api.md` §6.3 那句「`approvedResourceCount` 是资源语义的」的正确回应——那句话是对的，但它推出的结论应该是「论坛用别的谓词」而不是「改这一列的名字」。

### 5.3 P1 — 一个四份文档都没发现的洞：论坛违规不推进 `strikeCount`

`strikeCount` 的注释写着「违规记录数，**> 0 直接清零信任等级**」（`kourindou.ts:67-68`），它是整个信任梯度**唯一的惩罚机制**。

递增它的地方全仓只有一处：

```ts
// moderation.ts:95-98, 111-116
const striking = input.decision === 'reject'
  && STRIKE_REJECT_REASONS.includes(input.rejectReason)   // ['copyright','illegal']
```

也就是**只有资源审核拒绝会记 strike**。M4 加了版主删楼、锁帖、帖子举报处置——这些动作**一个都不递增 strikeCount**。

后果是具体的：一个在论坛灌 spam、被删了 20 层的账号，`strikeCount` 仍然是 0。只要他此前通过过 3 个资源，他在香霖堂仍然是「即发即审」，可以绕过审核直接发布资源。**论坛是本站最容易被滥用的入口，而它对生死线模块（版权）的信任判断完全没有影响。**

这不是 M4 制造的问题（M3 就是这样），但 **M4 是它第一次可被利用**——M3 时论坛不存在，滥用者没有低成本的入口。

**怎么对齐**（本文的新增建议）：

- 最小改动：staff 删他人楼层且给出的理由类别属于 `STRIKE_REPORT_REASONS`（`spam`/`harassment`/`illegal`/`copyright`）时，同事务 `strikeCount + 1`。这与 `/review` 的现有机制同形（同一条 SQL 表达式、同一个事务、同一条 `moderationLog`）。
- 或者显式记一笔债：在 CLAUDE.md 的 M4 约定里写下「论坛处置不影响资源信任，这是已知的、有意的缺口」并说明为什么。**两者都行，不能默认沉默**——沉默的结果是没人知道这条链是断的。

### 5.4 P1 — 论坛信任谓词需要 `Actor` 加字段，而现有惰性建档有个坑

`designs-api.md` §6.3 提议 `accountAgeDays(actor) >= 3`，并说「`sessionMiddleware` 已经把整行 `user_profile` 查出来了，`row.createdAt` 就在手里」。查证属实（`session.ts:29-43` 是 `select()` 全行）。但：

```ts
// session.ts:35-43
const row = profile ?? (await db.insert(schema.userProfile)
  .values({ userId: session.user.id })
  .onConflictDoNothing()      // ← 无 target
  .returning())[0]

c.set('actor', {
  role: row?.role ?? 'user',                    // ← row 可能是 undefined
  approvedResourceCount: row?.approvedResourceCount ?? 0,
  strikeCount: row?.strikeCount ?? 0,
})
```

并发首访时 `onConflictDoNothing` 会让 `returning()` 返回空数组，`row` 是 `undefined`，actor 落到默认值。今天这只是「这一次请求里 role 当成 user」，无害。加了 `createdAt` 之后就有害了：`createdAt` 没有安全默认值（`?? new Date()` 会把老账号判成新账号 → 禁外链；`?? new Date(0)` 会把新账号判成老账号 → 放行外链）。

`designs-notification.md` §5.1 已经指出同一段代码的另一个坑（handle 唯一违例被 `onConflictDoNothing` 吞掉导致 profile 建不成）。**两个坑要一起修**：`onConflictDoNothing({ target: userProfile.userId })` + 冲突后重新 SELECT 一次（而不是依赖 `returning()`）。这样 `row` 永远非空，两个新字段都有真值。

---

## 6. 接缝 5：通知

### 6.1 M3 的审核结果通知：`designs-notification.md` 覆盖得很完整，行号全部核对属实

逐条核对（左边是文档声称的挂点，右边是实际代码）：

| 文档声称 | 实际 | 核对 |
|---|---|---|
| `moderation.ts:119-128` 之后（review） | `insert(moderationLog)` 在 `:119-128`，事务 `:100-129` | ✅ |
| `moderation.ts:173-181` 之后（report resolve） | 同上，事务 `:164-182` | ✅ |
| `kourindou/index.ts:349-357` 之后（status） | `insert(moderationLog)` 在 `:349-357`，事务 `:347-358` | ✅ |
| `kourindou/index.ts:390-398` 之后（license） | ✅ | ✅ |
| `admin.ts:83-91` 之后（role） | ✅ | ✅ |
| `admin.ts:127-135` 之后（delete） | ✅ | ✅ |
| `admin.ts:109-118` 的 select **没取 uploaderId** | `{id, slug, titleOriginal, deletedAt}` | ✅ 确实没取 |
| `content/index.ts:85` 无事务无审计 | ✅ | ✅ |
| `kourindou/index.ts:196-201` 建 topic 处要加订阅 | ✅ | ✅ |

**这是四份文档里质量最高的一份**，挂点分析可以直接用。三条判断尤其正确：

- **SAVEPOINT 是强制的**（PG 事务 aborted 后裸 try/catch 救不回来）——这条是硬事实，不是风格。
- **`resource_deleted` 不能带 `resourceId` 外键**（purge 会在同事务里级联删掉通知自己）——这是本次调研里最漂亮的一处推理。
- **扇出的 SELECT 必须在事务外**（`UPDATE topic ... RETURNING` 持行锁，是整个主题发帖的串行点）——与 `post.ts:70-74` 的既有注释一致。

### 6.2 P0 — 但它和另外两份在 `NOTIFICATION_KIND` 上直接对撞

见 §10 第 2 条。这不是通知设计的问题，是文档之间没有对齐。

### 6.3 补通知需要改 `moderation.ts` 的哪几处

具体两处，都很小：

1. **`POST /resources/:id/review`**（`:63-133`）：在 `:128` 的 `insert(moderationLog)` 之后、`:129` 的事务闭合之前加一次 `notify(tx, actor.id, [...])`。`row` 已含 `uploaderId`（`:73-77` 是 `select()` 全行），`input.rejectReason` 现成。**零额外查询。**
2. **`POST /reports/:id/resolve`**（`:147-186`）：在 `:181` 之后加一次 `notify`。`row` 是 `select()` 全行，`reporterId` 现成。**零额外查询。**

两处都**不包 SAVEPOINT**（notification §4.2 的判据：`/review` 开头有 `:80-82` 的 409 幂等闸门，重试安全）。核对属实。

`moderation.ts` 还需要第三处改动，但不是为通知：**`GET /reports` 的投影**（§4.2）。

### 6.4 P2 — seed-demo × 6 会让通知在演示数据上完全失效

六个 seed 脚本（`seed-demo.ts:161`、`seed-demo-tools.ts:168`、`seed-demo-fanworks.ts:187`、`seed-demo-official.ts:111`、`seed-demo-lilywhite.ts:167`、`seed-demo-official-free.ts:127`）都是：

```ts
await db.insert(topic).values({ kind:'resource', resourceId: row.id, authorId: DEMO_USER, title: ... })
```

三个问题（一次改完）：

- 不写 `topic_subscription` → 「我的资源有新评论」对全部演示资源失效（notification §4.8 点名了这条）。
- 写 `title` → 触发 §9.2 的 CHECK。
- 不写 `lastPostAt` → 依赖新的 `DEFAULT now()`（可以接受，但值会是 seed 时间而不是资源创建时间，最新流的排序会是「seed 顺序」）。

---

## 7. 接缝 6：前端组件真的能共用吗

### 7.1 能，而且 `designs-web.md` §3 的边界判断是对的

它的核心主张是：**组件不知道 API 长什么样，只收一个 `action` 路径字符串**，两个路由各自实现 `intent=reply`。理由（hono RPC 类型推不进共享展示组件；两边权限闸门必须不同）成立。

这不是「嘴上说共用」——`PostItem` / `MarkdownBody` / `PostComposer` 是纯展示 + 提交，确实能一份代码服务两个页面。判断为**真共用**。

但它有两个前提，其中一个 designs-web 自己就违背了。

### 7.2 P1 — `PostView` 手写在 web 侧，违背 CLAUDE.md 的类型主轴

`designs-web.md` §3.2 把 `PostView` 定义在 `app/components/discussion/types.ts`，21 个字段，手写。

CLAUDE.md 第 6 行：「类型主轴：packages/shared 的 zod schema → api 校验 → AppType/hc → web」。手写一份 `PostView` 等于在主轴之外开第二个真相源。具体的失败模式：

- API 的 `listPosts` 投影加一个字段 → `PostView` 不知道 → 组件收到了但用不了（沉默）。
- API 改了 `quoted.excerpt` 的形状 → `PostView` 仍是旧形状 → **TypeScript 不报错**，因为 loader 的返回值经过 `.json()` 之后是通过 `PostView` 断言进组件的，两边根本没有类型联系。
- 三个消费者（资源页、主题页、通知页的引用摘要）会各自断言，漂移在第三个消费者上暴露。

**怎么对齐**：`PostView` 应该从 `AppType` 推出来，或者定义在 `packages/shared/src/shrine/`（作为响应契约类型，与 zod 输入 schema 并列）。这一条不影响功能，但它是本项目最核心的一条约定，值得在实施前钉死。

### 7.3 第二个前提：两个视图必须共用一个 serializer

`listPosts` 现在的投影（`post.ts:18-46`）有 8 个字段；`PostView` 要 21 个。如果 URL 合并被否决（§11 待拍板 1），`/kourindou/.../posts` 与 `/shrine/.../posts` 会是两个 handler，**各自写一遍这 21 个字段的投影**——那才是「两套系统假装是一套」的真实形态。它不会以「两套表」的样子出现，会以「两个 select 投影慢慢长歪」的样子出现。

**建议**：无论 URL 合并的结论如何，`toPostView()` 必须是 service 里的**一个**函数，路由层不许自己拼投影。这条比 URL 合并更根本。

### 7.4 `detail.tsx` 的具体改动量（比设计文档写的大）

| 位置 | 改什么 | 文档提了吗 |
|---|---|---|
| `:44-58` loader | 两次 `$get` 改成拿 `topicId` 再打 `/api/shrine` | api §1.5 ✅ |
| `:51-56` | 404 吞成 `posts: []` → 三态（`failed` / `locked` / `empty`） | web §2.8 ✅ |
| `:67-75` action `intent=comment` | 换端点 | ✅ |
| `:255-332` 评论区 | 换成 `<Discussion>` + `id="discussion"` 锚点 | web §2.8 ✅ |
| **无分页** | `query:{}` → `paginationQuerySchema` 默认 `pageSize=20`，**第 21 条评论今天就看不见了，且没有任何 UI 提示** | **无人提** |
| **无收藏按钮、无举报按钮** | `detail_favorite` / `detail_favorited` / `detail_report` 三个 message key 存在但**全仓无引用**——API 端点齐全，UI 从来没做 | **无人提** |

最后两条值得单独说：**「举报-处理-申诉闭环」在前端连入口都没有。** 资源页没有举报按钮，帖子也不会有（M4 才做）。所以 dev 库里那 50 条 resource 举报只可能来自测试脚本。M4 如果只做帖子举报 UI 而不补资源举报 UI，会出现「帖子能举报、资源不能举报」的倒挂——而版权举报才是生死线那一条。**建议 M4 顺手补上资源举报按钮**，它复用同一个举报对话框，边际成本是一个 `targetKind` 参数。

---

## 8. 接缝 7：i18n

### 8.1 现有命名约定（实测 207 个 key）

- **扁平 snake_case，`<域>_<物>`**，无嵌套。域：`site` `ui` `section` `theme` `nav` `action` `home` `auth` `footer` `wip` `kourindou` `filter` `sort` `kind` `license` `list` `downloads` `no` `anonymous` `load` `detail` `mirror` `upload` `dash` `reject` `report_reason` `admin`。
- **枚举值的文案用 `<枚举名>_<值>`**：`kind_game` / `license_allowed` / `mirror_netdisk` / `reject_copyright` / `report_reason_spam`。这是给 `display.ts` 的映射表用的。
- **参数用 `{name}`**：`downloads_n = '{n} 次下载'`、`list_count = '共 {total} 件'`。
- **三份文件 key 集合必须逐字相同**（今天都是 208 = 207 + `$schema`）。
- **错误文案今天没有统一命名空间**：`load_error` / `upload_failed` / `dash_action_failed` / `admin_config_failed`，各页各写。

### 8.2 M4 的新 key 遵守约定吗：**基本遵守，三处要修**

`designs-web.md` §6.5 的 118 条按 `shrine_*` `board_*` `topic_*` `notif_*` `err_*` `compose_*` `quote_*` 分组，符合 `<域>_<物>`。`board_tea_house` 符合枚举值命名。`notif_reply({actor, title})` 的参数写法符合。

三处不合：

1. **P1 — `err_*` 与四条既有 per-page 错误 key 并存。** designs-web 提出集中式 `errorLabel(code)`，方向对，但没说 `upload_failed` / `dash_action_failed` / `admin_config_failed` / `load_error` 怎么办。如果不迁移，就是两套错误文案系统同时存在，下一个人不知道该往哪边加。**建议：M4 一并把这四处迁到 `errorLabel()`，删掉三条 per-page key**（`load_error` 保留作为兜底 default）。
2. **P1 — key 名与错误码对不上**（详见 §10 第 5 条）：`err_duplicate_post` ↔ `duplicate_content`、`err_word_blocked` ↔ `content_blocked`。`errorLabel` 是**按 code 查表**的，key 名与 code 名不一致会让下一个人在 map 里找不到对应关系。建议 key 名逐字跟 code 走：`err_duplicate_content` / `err_content_blocked`。
3. **P2 — 漏了 `targetKind` 的文案。** §4.2 指出 `dash/reports.tsx:104` 渲染的是裸 `{r.targetKind}`（英文 `post`/`resource`）。M4 让帖子举报成为主流之后这个badge 三语都显示英文。需要 `report_target_post` / `report_target_resource` 两条。另有三条**已定义但从未使用**的 key（`dash_report_target` / `dash_report_reason` / `dash_report_detail`）——说明这个页面的 i18n 当初就是半成品。

### 8.3 一条约定要写进 M4

CLAUDE.md：「代码里一律 `m.key()`，不写裸字符串」。13 个 `NOTIFICATION_KIND` × 一句话文案的渲染**不能写成 `m['notif_' + kind]()`**。`designs-notification.md` §10 已经写下这条，`designs-web.md` §2.5 的写法（显式 Record，值是 `() => m.xxx()`）是正确形态。**但 `boardLabel` / `boardDesc`（web §6.4）也是同一形态，而它有 6 个键 × 2 张表 = 12 个字面量**——如果版块最终建表（§10 第 1 条），这两张表就该删掉，改从 API 拿 jsonb。**这两个决定必须同时做，不能一个建表一个建 Paraglide 表。**

---

## 9. 接缝 8：数据迁移

### 9.1 库里已经有 `topic(kind='resource')` 的行吗：**有，662 行**

```
kind      | count | with_board | with_title | with_lastpost
----------+-------+------------+------------+---------------
board     |    10 |         10 |         10 |             0
resource  |   662 |          0 |        657 |            51
```

另有 `post` 177 行、`report` 63 行、`user_profile` 603 行。

**这直接推翻了三份文档共用的那个前提。** `designs-schema.md` §13.3 写：

> **若无线上数据**（M4 之前的默认假设）：`rm -rf drizzle && bun run generate && bun run migrate`，枚举加值、列改名、索引删改全部一次做完，零迁移脚本。

生产库确实是空的（没有部署），所以**没有不可逆损失**——这一半是对的。但 **dev 库不是空的**，而每一次 `bun run migrate` 都先打在 dev 库上，`bun test` / `bun run e2e` 也都打在同一个库上（`.env` 的 `DATABASE_URL` 指 `gensokyo@5432`）。而用户自己的记忆文件写着「开发库 @example.com 同时是测试账号和种子内容所有者」——这些数据是有价值的。

**所以正确的说法不是「零成本重建」，而是「不可逆损失为零，但迁移必须写对，否则 dev 环境当场停摆」。**

### 9.2 M4 的改动会破坏它们吗：**会，四处**

| 改动 | 冲突的行数 | 现象 |
|---|---|---|
| `CHECK topic_kind_shape`（`kind='resource'` → `title IS NULL`） | **657 行** | `ALTER TABLE ... ADD CONSTRAINT` 直接失败（23514）。之后 6 个 seed 脚本每建一个资源都抛 |
| `lastPostAt` 改 `NOT NULL` | **611 行**（`last_post_at IS NULL`） | `SET NOT NULL` 失败。必须先 `UPDATE topic SET last_post_at = created_at WHERE last_post_at IS NULL` |
| `board` 表 + `topic.boardSlug` FK `restrict` | **10 行**（`board_slug='shrine'`，不在任何一份文档的 6 个 slug 里） | `ADD FOREIGN KEY` 失败 |
| `user_profile.handle NOT NULL UNIQUE`（designs-schema §9.2 的主张） | **603 行** | 需要一个生成 603 个唯一 handle 的回填脚本。这**不是**「一列的事」 |

三条回填 SQL 顺序（写进 M4 计划，不要留给实施时现想）：

```sql
-- 1. lastPostAt 回填（必须在 SET NOT NULL 之前）
UPDATE topic SET last_post_at = created_at WHERE last_post_at IS NULL;

-- 2. 资源主题的 title 清空（必须在 CHECK 之前）
UPDATE topic SET title = NULL WHERE kind = 'resource';

-- 3. 测试留下的孤儿 board 主题（它们的 slug 不在版块表里）
DELETE FROM topic WHERE kind = 'board' AND board_slug NOT IN (<6 个正式 slug>);
```

第 3 条那 10 行全部是 `title='x'`、`post_count=0` 的测试残留（来自 `packages/db/src/kourindou.test.ts:151`，该测试不清理），删掉无损。**但它揭示了一个流程问题：测试直接往 dev 库写且不清理。** M4 会大幅增加这类写入（主题、楼层、通知、订阅、点赞），如果不给 shrine 的测试配上 `test-support.ts` 的 track/cleanup 机制（`content.test.ts` 已经在用 `trackUser`/`trackResource`/`cleanupTracked`），dev 库会以更快的速度积累垃圾，而 `board` 表的 FK restrict 会让这些垃圾**变得删不掉**（有帖子的版块删不了）。

`handle NOT NULL` 那一条还有第二重代价：`designs-notification.md` §5.1 明确说 handle **可空**（「三次都撞就落 null」），`designs-schema.md` §9.2 明确说 **NOT NULL**（「可空会让『没有 handle 的用户』这个状态出现在三条路径的每一个分支里」）。两边的论证都成立，但**结论必须统一**（§10 第 4 条）。本文倾向 **NOT NULL**：schema 那份的论证更强（可空会污染 @解析 / `/u/:handle` 路由 / 通知渲染三处），而回填 603 行只是一次性成本；notification 那份担心的「三次都撞」在 32^8 的空间里不会发生，真撞了应该 500 而不是留 null。

### 9.3 测试破坏清单（实测）

| 文件 | 破在哪 | 修法 |
|---|---|---|
| `packages/db/src/kourindou.test.ts:151` | `values({ kind:'board', boardSlug:'shrine', title:'x' })` → 若 board 建表 + FK restrict，FK 违例 | 换成正式 slug（如 `'meta'`），并在 `afterAll` 里清理 |
| `apps/api/src/content.test.ts` | 10 处调 `/api/kourindou/resources/:slug/posts`（`:71,89,101,107,118,144,153,172,184` 附近） | URL 合并后全部要改；本文件基本是重写 |
| `apps/api/scripts/e2e.ts:189` | 同上 | 改端点 + 加 shrine 的验收项 |
| `apps/api/src/interactions.test.ts` | 未直接受影响（只测 resource 举报） | 应补 post 举报用例 |

`content.test.ts` 的 5 个用例（楼层号连续、并发不撞、软删占位、回复幽灵楼被拒、未发布无评论区）**全部是有价值的、必须在新 URL 下重跑的用例**。它们是 M4 最重要的回归网——尤其「并发发帖不会撞楼层号」那条，因为 `floorSeq` 改名 + SAVEPOINT 扇出都动到那段临界区。

---

## 10. 四份设计文档之间的直接矛盾（必须先裁决）

这是本次审查最高优先级的产出。以下 8 条，**每一条都会让「照文档实现」的结果编译不过或跑不通**。

| # | 议题 | schema | api | web | notification | 严重度 |
|---|---|---|---|---|---|---|
| 1 | **版块是表还是常量** | **建 `board` 表**（§2，「决定性理由是 `topic.boardSlug` 需要外键」） | **不建表**（§10，「六个固定版块是 UI chrome」） | **不建表**（§6.4，「没有管理后台时 psql 改比部署更贵」） | 未表态 | **P0** |
| 2 | **`NOTIFICATION_KIND` 的值集** | 5 值 `['reply','topic_reply','mention','moderation','mod_queue']` | 同 5 值 | 「13 条事件文案」 | **13 值扁平枚举**，且明确论证反对两层方案 | **P0** |
| 3 | **`MODERATION_ACTION` 加什么** | 只加 `topic_lock`，**明确反对** `post_delete`（「soft_delete 是通用动词」） | 加 `topic_moderate`（合并 pin/lock/move），并提 `post_delete`/`topic_delete` | 未表态 | 代码里直接写 `action: 'post_delete'`，并说「依赖：要加 `post_delete`」 | **P0** |
| 4 | **`handle` 可空性** | `NOT NULL UNIQUE` + 生成失败重试 5 次后 `internal` | 「若 handle 是可选的，大多数用户不可被 @」（倾向必填） | 「已登录但 `handle` 为空 → redirect」（假设**可空**） | `.unique()` **无 notNull**，「三次都撞就落 null」 | **P0** |
| 5 | **handle 冲突的错误码** | 未表态 | **新增 `handle_taken`**（§8） | **不新增，复用 `duplicate_slug`**（§2.7「这正是该约定起作用的地方」） | 未表态 | P1 |
| 6 | **可见性函数的名字与返回形状** | `visibleTopic()`，返回 5 字段 | `loadVisibleTopic()`，返回 12 字段 `TopicView` | 未表态 | 未表态 | P1 |
| 7 | **`topic.postCount` 的处置** | 改名 `floorSeq`，**明确拒绝** `replyCount` | 保留 `postCount` 并**新增** `replyCount`（§4.2「两职分离现在零成本」），响应字段叫 `floorHighWater` | 未表态 | 未表态 | P1 |
| 8 | **六个版块的 slug** | 未定值（seed 里定） | `tea-party` / `danmaku-lab` / `workshop` / `music-hall` / `kappa-heavy` / `meta` | `tea-house` / `danmaku` / `workshop` / `music-hall` / `kappa` / `meta` | 未表态 | **P0（不可逆）** |

另有两处**文档内部**的不一致：

- `designs-schema.md` §7 建 `post_like` 表并要求「点赞与通知是同一条回路的两半，必须一起做」，但它自己的 `NOTIFICATION_KIND`（§6.2，5 值）**没有 `like`**。同一份文档里点赞通知无处安放。
- `designs-schema.md` §11.1 为 `mod_queue` 扇出建了 `user_profile_staff_idx`，而 `designs-notification.md` §1.2 已经**否决了 mod_queue 通知**。若采纳 notification 的裁决，这个索引是死索引（且它建在一张 603 行的表上，无害但是噪音）。

### 对这 8 条的裁决建议

1. **版块：不建表（2 : 1）。** 但 schema 那份的「`boardSlug` 需要外键」是本次审查里唯一一条**技术性**理由，另外两份是运营性理由。折中：不建表，但给 `topic.boardSlug` 加一条 **CHECK**（`board_slug IS NULL OR board_slug IN ('...','...')`）。CHECK 提供了外键 90% 的价值（拼错的 slug 进不来，孤儿主题不会产生），代价是加版块要一次 `ALTER TABLE` ——而在「不建表」方案里加版块本来就要一次部署。这条 CHECK 让三份文档的核心诉求同时满足。
2. **通知枚举：13 值（notification 那份）。** 它的论证（「两层把判据藏进 jsonb，TS 与 pgEnum 都管不住，而 web 侧仍要写 13 个分支」）是三份里最硬的；designs-web 的文案预算也是按 13 条算的。
3. **`MODERATION_ACTION`：采纳 schema 那份**（只加 `topic_lock`，删楼用 `soft_delete` + `subjectKind='post'`）。理由：它的判据（`subjectKind` 就是用来区分对象的，加 `post_delete` 会造出同一件事两个动词）与 `moderationLog` 的既有设计意图一致。**连带要求**：`designs-notification.md` §4.7 的代码片段（`action: 'post_delete'`）作废。
4. **handle：`NOT NULL`**（见 §9.2）。连带 `designs-web.md` §2.4 的「handle 为空 → redirect」分支删掉，`/settings` 只处理「还没自选过」。
5. **错误码：新增 `handle_taken`**（api 那份）。`duplicate_slug` 今天在全仓也没有抛出点，用它承载 handle 冲突会让两个语义永久缠在一起。
6. **可见性函数：一个，`loadVisibleTopic()` + `TopicView`**，放在 `modules/content/visibility.ts`（不放 shrine——它的消费者包括治理模块，见 §3.4）。
7. **`postCount`：改名 `floorSeq`，不加 `replyCount`**（schema 那份）。理由：M4 确实没有楼层硬删路径，`replyCount` 找不到上线当天的查询；api 那份的响应字段 `floorHighWater` 与 `replyCount` 改成从 `floorSeq` 推导（版块主题 `-1`，资源主题不减）。**改名本身是必须的**——`postCount` 这个名字在字面上邀请人写 `- 1`，而那会让主题永久发不出帖且错误信息说「主题不存在」。
8. **版块 slug：站长拍板。** 本文只提供判据：`kappa` 比 `kappa-heavy` 短且不会与「河童重工」的中文名脱节（英文 slug 本来就不是翻译）；`danmaku` 比 `danmaku-lab` 更通用，但通用意味着以后想开「弹幕游戏创作」板时撞名；`tea-house` 与 `tea-party` 都可以，前者更像地点（与「幻想乡茶话会」的场所感一致）。**这是四份文档里唯一一条真正不可逆的，必须在写第一行路由之前定。**

---

## 11. 必须改动的现有文件清单

M4 不是纯新增。以下是**已存在的文件**中必须改动的全部，按包分组。
「回归风险」列的判据是：**改错了会不会静默出错**（编译器/测试兜不住的记为高）。

### packages/db

| # | 文件 | 改什么 | 为什么 | 回归风险 |
|---|---|---|---|---|
| 1 | `src/schema/content.ts` | `topic`: `postCount`→`floorSeq`；`lastPostAt` 改 `NOT NULL DEFAULT now()`；加 `pinnedAt`/`lockedAt`；加 `topic_kind_shape` CHECK；`boardSlug` 加 CHECK（§10-1）；索引重做（`topic_board_last_post_idx` → 带 DESC + 部分条件；新增 `topic_latest_idx`/`topic_author_idx`；删 `topic_kind_idx`）。`post`: 加 `likeCount`、`locale`；删重复索引 `post_topic_floor_idx`；`post_author_idx` → `(author_id, created_at DESC)` | S2/S3/§2.4/§10-7 | **高** — 三条回填 SQL 漏一条 dev 库就迁不动；`post_topic_floor_idx` 与 `post_topic_floor_uq` 键完全相同，删的是重复的那个（**不要删 uq**） |
| 2 | `src/schema/kourindou.ts` | `userProfile` 加 `handle`(NOT NULL UNIQUE) / `handleSetAt` / handle 格式 CHECK。**表定义从「无第二参数」变成「有表级约束数组」**（drizzle 的 `pgTable(name, cols)` → `pgTable(name, cols, (t)=>[...])`） | §9.2 | **高** — 603 行回填；忘了第二参数会让 CHECK 静默不生成 |
| 3 | `src/schema/index.ts` | `export * from './shrine'` | 新表 | 低 |
| 4 | `src/kourindou.test.ts:151` | `boardSlug:'shrine'` → 正式 slug；补 `afterAll` 清理 | §9.3 | 低（编译期可见） |
| 5 | `scripts/seed.ts` | 若最终建 board 表则加 6 行种子；否则**不改** | §10-1 | 低 |
| 6-11 | `scripts/seed-demo.ts` · `-tools` · `-fanworks` · `-official` · `-lilywhite` · `-official-free`（6 个文件） | 建 topic 时**删掉 `title`**；补一行 `topic_subscription(uploader, watching)` | §6.4 / S2 | 中 — 不改的话 seed 直接抛 23514；漏订阅是静默的 |

### packages/shared

| # | 文件 | 改什么 | 为什么 | 回归风险 |
|---|---|---|---|---|
| 12 | `src/kourindou/enums.ts` | `REPORT_REASON` 加 `spam`/`harassment`；`MODERATION_ACTION` 加 `topic_lock`；`TOPIC_KIND` 迁出到 shrine | §4.4 / §10-3 | 低 — `dash/reports.tsx` 与 `dash/queue.tsx` 的映射表会编译报错，正好强制补文案 |
| 13 | `src/kourindou/schemas.ts` | 三种 id schema + `anyIdSchema` 上提到 `src/ids.ts`；`createPostSchema` 迁到 shrine 并加 `.trim()` 与 `locale`；`createReportSchema` 的 `z.enum(['resource','post'])` 提成 `REPORT_TARGET_KIND` 常量 | api §3.2 / §2.4 | 低 — 全仓无深路径导入（已 grep 确认），移动对调用点零改动 |
| 14 | `src/kourindou/localized.ts` | `LOCALES` / `Locale` 上提（`post.locale` 要用，而 shrine 不该依赖 kourindou） | §2.4 | 低 |
| 15 | `src/index.ts` | 新增 `./ids` `./shrine`（+ `./cursor`，若采纳游标分页） | — | 低 |

### apps/api

| # | 文件 | 改什么 | 为什么 | 回归风险 |
|---|---|---|---|---|
| 16 | `src/app.ts` | 加 `.route('/shrine', shrine)` / `.route('/notifications', notifications)` / `.route('/users', users)`；**删掉 `.route('/kourindou', content)`**（URL 合并）；举报若拆走则加 `.route('/reports', reports)` | api §2 | 中 — 删 route 会让 web 侧所有 `api.kourindou.resources[':slug'].posts` 编译报错（**这是好事**，是唯一能穷举调用点的机制） |
| 17 | `src/errors.ts` | 加新错误码（`topic_locked` / `mention_limit_exceeded` / `duplicate_content` / `link_not_allowed` / `handle_taken` / `content_blocked`）；加 `handleParam` | api §8 | 低 |
| 18 | `src/middleware/session.ts` | `Actor` 加 `handle` / `createdAt`；惰性建档改成 `onConflictDoNothing({target})` + 冲突后重查（**不再依赖 `returning()`**）+ handle 生成重试；`canAutoPublish` 改名 `canAutoPublishResource` | §5.4 / §5.2 | **高** — 这是全站每个请求都走的路径；handle 唯一违例被吞会让用户永远建不成 profile |
| 19 | `src/middleware/require.ts` | 加 `isSelf()` | S13 | 低 |
| 20 | `src/modules/content/index.ts` | **整个删除**（URL 合并后它的三条路由全部搬走） | api §1.5 | 中 |
| 21 | `src/modules/content/post.ts` | 签名改 `TopicView`；删 `topicForResource()`；加 `loadVisibleTopic()`；`listPosts` 改楼层区间 + 21 字段投影 + 单一 `toPostView()`；`createPost` 加提及/订阅/扇出/SAVEPOINT；`catch{}` 收窄到 23505；`findPost` 带主题上下文 | S5/S6/§2.3/§7.3 | **高** — 楼层分配临界区在这里；`content.test.ts` 的 5 条并发/连续性用例是唯一的网 |
| 22 | `src/modules/kourindou/index.ts` | `GET /resources/:slug` 响应加 `topicId`；`POST /resources` 建 topic 时**不写 `title`**、写 `lastPostAt`、插订阅行；`/status` 与 `/license` 加通知挂点；（若收口）`pending->published` 移出 `/status` | api P0-3/P0-4、notification §4.5/§4.8、S2 | 中 |
| 23 | `src/modules/kourindou/status.ts` | 若收口 `/status` 绕过：从 `ALLOWED.pending` 里去掉 `'published'`，同时 `STAFF_ONLY` 删 `pending->published` | 三份文档共同的待拍板项 | 中 — 会影响 `moderation.ts:84-93` 的 `canTransition` 调用（那里 `to='published'` 走的正是这条边），**改错了审核通过会 409** |
| 24 | `src/modules/interactions.ts` | post 分支加主题可见性判断；（若采纳 P2-3）举报端点整体搬到 `/api/reports` | §3.4 | 中 |
| 25 | `src/modules/moderation.ts` | `GET /reports` 投影 LEFT JOIN 目标上下文（`post.id::text = report.target_id`，**不要反向 cast**）+ 加 `total` + 排序挪进 `orderBy`；`/review` 与 `/reports/:id/resolve` 加通知挂点 | §4.2/§4.3/§6.3 | 中 — cast 方向写反（`target_id::uuid`）会在出现非 uuid 的 targetId 时让整个队列 500 |
| 26 | `src/modules/admin.ts` | `DELETE /resources/:id` 的 select 加 `uploaderId`；加通知（**不带 `resourceId` 外键**）；`role` 加通知；`restore` 补 `moderationLog` | notification §4.6 | 中 — purge 通知带外键会被自己级联删掉，且**没有任何测试会发现** |
| 27 | `src/modules/me.ts` | 返回 `handle` / `handleSetAt` / `unread`；加 `PATCH /handle` | api §7.2 | 低 |
| 28 | `src/modules/uploads.ts` | `purpose` 白名单加 `'post'`（现在是 `purposeRaw === 'avatar' ? 'avatar' : 'cover'` 的二元三目，任何未知值静默变成 `cover`） | web §4 | 低 |
| 29 | `src/storage.ts` | `ImagePurpose` 加 `'post'` | 同上 | 低 |
| 30 | `scripts/gc-images.ts` | `referencedUrls()` 加第 4、5 个来源：`post.bodyMd` 的**逐字子串匹配**（`LIKE '%base%'` 下推给 PG）+ `siteConfig.announcement` | schema §13.1 | **高** — 不改的话第一次跑 `gc:images` 删光全部帖子插图，且 `:82` 的熔断挡不住（封面还在，引用集合非空）。**注意：`designs-web.md` §4 说 `purpose='post'` 是为了让 GC 能按前缀区分，这个理由是错的**——GC 按完整 URL 白名单工作，与前缀无关。`purpose='post'` 只是分目录；GC 修复是独立且必须的 |
| 31 | `scripts/e2e.ts` | 端点改名；补 shrine 验收项（发主题、回帖、通知、举报处置） | §9.3 | 低 |
| 32 | `src/content.test.ts` | 基本重写（10 处端点 + 新增可见性/锁定/权限用例） | §9.3 | 中 — **5 条既有用例必须原样保留语义**，尤其并发楼层号 |
| 33 | `package.json` | 加 `gc:notifications` 脚本 | notification §8 | 低 |

### apps/web

| # | 文件 | 改什么 | 为什么 | 回归风险 |
|---|---|---|---|---|
| 34 | `app/routes.ts` | 加 shrine layout + 4 条子路由 + `/notifications` `/u/:handle` `/settings`；删 `route('shrine', stub)` | web §1.1 | 低 |
| 35 | `app/routes/stub.tsx:8` | 删 `'/shrine'` 映射（变成死代码） | 同上 | 低 |
| 36 | `app/routes/kourindou/detail.tsx` | loader/action 换端点；评论区换 `<Discussion>` + `id="discussion"`；404 三态；**补分页**（现在 `pageSize=20` 静默截断）；**补举报按钮**（`detail_report` key 存在但未用） | §7.4 | 中 |
| 37 | `app/routes/dash/reports.tsx` | 消费新投影（标题/楼层/跳转链接）；排序挪走；`targetKind` 徽章 i18n；**加「删除该楼层」动作**；`reasonLabel` 补两个 reason | §4.2/§8.2 | 中 |
| 38 | `app/routes/dash/layout.tsx` | 若采纳 notification §1.2：tab 上显示待办计数（需要 §4.3 的 `total`） | notification §1.2 | 低 |
| 39 | `app/routes/dash/queue.tsx` | `reject_*` 映射随枚举变化（若 `REJECT_REASON` 不变则不改） | — | 低 |
| 40 | `app/routes/login.tsx` | 支持 `?next=`（现在 `navigate(localizeHref('/'))` 写死回首页） | web §2.4 | 低 — **但它是冷启动期最贵的一处**：从「发第一帖」被踢回首页 = 丢一个首帖 |
| 41 | `app/root.tsx` | loader 返回 `unread` 与 `imageHost`（`S3_PUBLIC_BASE_URL`，**从 API 出，不要在 web 侧再定义一个环境变量**） | web §5.4/§2.5 | 低 |
| 42 | `app/components/site-header.tsx` | `SessionUser` 加 `handle` / `unreadCount`（**这个类型是手写的，不是从 AppType 推的**，加字段要手动同步）；加铃铛 + 徽章；下拉加「我的主页」「设置」 | web §7.6 | 中 — 手写类型与 `/api/me` 的实际响应之间没有编译期联系（与 S11 同类问题） |
| 43 | `app/lib/display.ts` | 加 `boardLabel`/`boardDesc`（若不建表）或删掉这个想法（若建表） | §10-1/§8.3 | 低 |
| 44 | `app/messages/{zh,ja,en}.json` | ≈118 × 3；三份 key 集合必须逐字相同；四条既有 per-page 错误 key 的去留 | §8 | 中 — key 不齐 Paraglide 会在构建期报，但**翻译质量**（尤其 ja 的版块名/站规/审核结果）没有任何机制兜底 |
| 45 | `package.json` | `react-markdown` `remark-gfm` `remark-breaks` `rehype-sanitize` + 8 个 shadcn 组件 | web §5/§7.3 | 低 — **PR checklist 加一条：出现 `rehype-raw` 即安全事故** |

### 根目录

| # | 文件 | 改什么 | 为什么 |
|---|---|---|---|
| 46 | `CLAUDE.md` | 加「博丽神社（M4）约定」小节，与「香霖堂（M3）约定」并列。至少含：可见性只有 `loadVisibleTopic()` 一个入口；`isSelf` vs `isOwnerOrStaff` 的使用边界；`requireAuth` 永远在 `entityIdParam` 之前；`floorSeq` 只增不减；订阅取消写 `muted` 不删行；扇出 SELECT 必须在事务外；`rehype-raw` 禁令；handle 不可逆 | M3 的约定小节被证明有效（本次审查里多处「做对了」都能追溯到它） |

**总计：46 个既有文件**（含 6 个 seed 脚本与 3 个 message 文件）。其中标 **高** 回归风险的 5 个：`schema/content.ts`、`schema/kourindou.ts`、`middleware/session.ts`、`content/post.ts`、`gc-images.ts`。

---

## 12. 建议的实施闸门

按「改错了会静默出错」的顺序排，不是按功能优先级：

1. **先裁决 §10 的 8 条。** 不裁决就动手 = 保证返工。其中第 8 条（版块 slug）与第 4 条（handle 可空性 + 字符集）是**不可逆**的，其余 6 条只是返工。
2. **写迁移与回填（§9.2 的三条 SQL），在 dev 库上跑通并让 `bun test` 全绿**，再写任何新功能。这一步会立刻暴露 §10 第 1、4、7 条是否真的裁决清楚了。
3. **修 `gc-images.ts`（第 30 项），在允许帖子插图的那个 PR 之前。** 顺序反了就是删光帖子插图，且熔断不触发。
4. **收口可见性闸门（`loadVisibleTopic()` + `TopicView` 参数），在加任何新路由之前。** 这是 S5 的解药，也是「两个视图」不退化成「两套系统」的唯一结构性保证。
5. **`isSelf` + 「moderator 编辑他人楼层 → 403」的测试，与 `PATCH /posts/:id` 同一个 PR。** 没有这条测试，这个设计决定活不过第一次重构。
6. **`content.test.ts` 的 5 条既有用例在新 URL 下重跑并全绿**，再动楼层分配那段临界区。

**验收上不能省的三条**（建议加进 `e2e.ts`）：

- 版主软删一个 `kind='resource'` 的主题 → 资源详情页的评论区**不再列出楼层**（S5 的回归测试）。
- 站长 `purge` 一个资源 → 作者收到 `resource_deleted` 通知**且该通知在 purge 之后仍然存在**（§6.1 那条外键陷阱的回归测试；这是唯一能发现它的方式）。
- 一条 `targetKind='post'` 的举报，从提交到审核员在 `/dash/reports` 里看到标题+楼层、点进去、删楼、结案——**全程不复制 uuid**（§4.2 的闭环验收）。
