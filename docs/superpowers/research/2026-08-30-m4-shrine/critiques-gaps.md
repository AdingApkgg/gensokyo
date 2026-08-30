# M4 博丽神社：对抗性审查

2026-08-30 · 审查对象：`designs-schema.md` / `designs-api.md` / `designs-web.md` / `designs-notification.md`
方法：逐份精读 + 对照仓库真实代码逐条验证。本文只写**会坏的东西**与**不要动的东西**。

> 本文是审查意见，不是实施许可。所有代码块都是「应该长成什么样」的表达，不得复制进 `packages/` 或 `apps/`。

---

## 0. 这次审查的判据

M3 那份审查的价值来自三个具体缺陷（id schema 类型错、GC 会删光封面、`.partial()` 保留 `default()` 毁数据），共同点是：**它们都不是「设计得不够好」，而是「按这份设计写出来的代码会在某个具体输入下丢数据或泄漏」**。本文只收这种。

四份设计的整体质量高于 M3 调研阶段——它们自己抓到了 `lastPostAt` NULLS FIRST、`resource_deleted` 通知被自己级联删掉、SAVEPOINT 的必要性、`rehype-raw` 的攻击面。**这些不要动**（§4）。

但四份文档是**四个作者各写各的**，而 M4 的核心命题恰恰是「一套内容系统两个视图」。结果是：**同一个字段、同一条路由、同一个枚举，在不同文档里有不同取值**，而其中两处落在文档自己声明的不可逆红线上。这类问题在 M3 不存在（M3 只有一份设计），是 M4 特有的最大风险，本文把它单列成 §3。

验证过的代码位置在每条里给出 `file:line`。没验证的我会写「未验证」。

---

## 1. P0 —— 会丢数据、会泄漏、或上线第一天就坏

### P0-1 `/u/:handle` 的「他的发言」没有可见性闸门 —— 被下架资源与被版主删掉的楼层从个人主页泄漏出来

**这就是任务里点名的那条：资源评论与论坛帖同源之后，pending/软删资源的评论区会从论坛侧泄漏。它确实存在，但泄漏点不在 `/shrine`，在 `/u/:handle`。**

`designs-api.md` §1.4 把可见性收敛成 `loadVisibleTopic()`，并逐条列了三个入口（`GET /topics`、`GET /topics/:id`、`GET /topics/:id/posts`）。但 §2 的路由表第 16 条 `GET /api/users/:handle` 返回 `recentPosts[]`，`designs-web.md` §2.6 进一步要求一个分页的 `posts` tab，`designs-schema.md` §11.1 还专门为它新建了 `post_author_created_idx (author_id, created_at DESC)`——**三份文档都要这个查询，没有一份说它要过闸门**。

具体触发序列（全部是正常运营动作）：

1. 资源 R 发布，A、B、C 在它的讨论主题里各留一楼；
2. 收到版权方下架函，站长 `POST /resources/:id/status → delisted`（或 `admin DELETE mode:'soft'`）；
3. `loadVisibleTopic()` 现在对该主题返回 null——`/shrine` 与 `/kourindou/:slug` 都看不到讨论了；
4. **但 `/u/A`、`/u/B`、`/u/C` 仍然公开列出「在《R 的标题》的 #2 楼：……」**。

后果：一份因版权/违法被下架的资源，它的标题、它的讨论内容、以及讨论者名单，仍然可以被任何人通过任意一个参与者的主页枚举出来。产品文档的第一条生死线就是版权分级与下架通道，「下架了但换个 URL 还能看」是这条生死线上最糟的形态。

同一个洞的第二种形态更普通也更高频：**版主软删一条骚扰楼层之后，作者的个人主页照样把它列出来**。`content/post.ts:36-46` 的 `listPosts` 会把软删楼层的 `bodyMd` 在服务端置空（这是对的），而 `/u/:handle` 是一条**新写的**查询，没有任何东西强制它做同样的事。这正是 `designs-api.md` §1.2 自己论证过的漂移——它把论证用在了 `/kourindou` vs `/shrine` 上，却新开了第三条不受同一论证保护的读路径。

**修**：

- `/u/:handle` 的 posts 查询必须 `INNER JOIN topic` + `LEFT JOIN resource`，复用与 `loadVisibleTopic()` **逐字相同**的白名单谓词，并且 `WHERE post.deleted_at IS NULL`（个人主页不需要楼层占位，直接不列）。
- 把这个谓词抽成一个 drizzle 的 `visibleTopicWhere()` 表达式（不是一个查询函数），让 `loadVisibleTopic()`、feed 查询、profile 查询、通知收件箱四处 import 同一个常量表达式。**闸门必须是一个表达式而不是一个函数**——函数只能被「取一行」的路径复用，列表路径必然会各写一遍 WHERE，这就是漂移的源头。
- 契约里写死：任何新增的、能返回 `post` 行或 `topic.title` 的端点，PR 模板里要回答「它用的是哪一份 `visibleTopicWhere()`」。

---

### P0-2 `DELETE /api/shrine/topics/:id` 没有排除 `kind='resource'` —— 投稿者可以永久摧毁自己资源的评论区，且没有任何恢复路径

`designs-api.md` §2 路由 #4：权限是「作者（仅当无他人回复）或 `moderator`」。

而 `apps/api/src/modules/kourindou/index.ts:195-201` 建资源主题时写的是 `authorId: actor.id`——**资源讨论主题的「作者」就是投稿者本人**。于是：

1. 投稿者发布资源 R，还没有人评论（`floorSeq = 0`，没有任何楼层，因此「无他人回复」恒成立）；
2. 投稿者调 `DELETE /api/shrine/topics/:id`，`topic.deletedAt` 被写上；
3. 从此 `loadVisibleTopic()` 永远返回 null → R 的评论区消失；
4. **没有任何代码路径能把它变回来。** `POST /resources` 只在建资源时插 topic；`topic.resourceId` 有 `.unique()`（`content.ts:35`），补插一行会撞唯一约束；`topicForResource`（`content/post.ts:118-125`）**不过滤 `deletedAt`**，所以就算有人想「没有就建一个」也会先查到那条死行；`admin` 的 `restore`（`admin.ts:153-168`）只恢复 resource，不碰 topic。

真正的动机不是误操作，是**审查规避**：一个投稿者眼看要挨骂，抢在第一条评论进来之前把评论区删掉，资源继续挂在站上收下载量。M4 之后这是一键操作。

顺带同一个洞的第二种形态：版主软删一个资源讨论主题（他有权限，且没有 kind 限制），效果一样不可逆。

**修**（三条都要，缺一条洞就还在）：

1. `DELETE /api/shrine/topics/:id` 对 `kind='resource'` 一律 409 `invalid_state_transition`。**资源讨论主题的生命周期归资源，不归主题。**「不让这条讨论继续」的正确动作是下架资源（可逆、留痕、通知作者），已经存在。
2. `topicForResource()` 加 `isNull(topic.deletedAt)`——它现在是一条会返回墓碑的查询，任何调用方拿到它都会得到一个「存在但永远不可见」的 id。
3. 若确实需要「删主题」，那也只能是 staff 动作，并且必须与 `resourceId IS NULL` 这条 CHECK 一起表达在权限层，而不是靠 handler 里的一句 if。

---

### P0-3 `gc-images` 的「逐字子串匹配」失败方向是反的 —— 过度匹配 = 不可逆删图，而这是「不建 `post_image` 表」的全部依据

`designs-schema.md` §13.1 推翻了挖掘阶段的 `post_image` 表，理由是：

> 图片能被浏览器加载，当且仅当 MinIO 的 URL 以完整字面量出现在正文里……**失败方向是安全的**：误匹配导致多保留一张图，而不是误删。

**第一句对，第二句错。** 白名单不是「正文里出现过的 URL」，是 `gc-images.ts:56-60` 那段：

```ts
for (const url of referenced) {
  if (isManagedUrl(url)) keys.add(url.slice(base.length + 1))   // ← 派生 key
}
```

白名单里装的是**对象 key**，不是 URL。所以判定是 `keys.has(o.key)`——一次**精确字符串相等**。于是：

- 正文写 `![](https://minio/post/019a....webp)`，正则若把闭括号一起吃进去，`m[0]` = `https://minio/post/019a....webp)`，派生出的 key 是 `post/019a....webp)`；
- 桶里真实的 key 是 `post/019a....webp`；
- `keys.has()` 为 false → **超过 24h 宽限期后这张正在用的图被删掉**；
- 而 §13.1 那道熔断（`keys.size === 0 && objects.length > 0`）**挡不住**：封面和头像还在，`keys.size` 远大于 0。

也就是说：**过度匹配不是「多保留一张」，是「精确地删掉这一张」。** 这一条把「不建表」的全部论证掀翻了——不是说必须建表，是说这个论证不能当作不建表的理由。

同一段还有两个次级问题：

- `WHERE body_md LIKE '%' || base || '%'` —— `base` 来自 `S3_PUBLIC_BASE_URL`，若其中含 `_`（LIKE 的单字符通配）会静默变成模糊匹配。功能上无害（只影响下推的预过滤），但要知道它不是精确过滤。
- **编辑器先传图、用户隔天才发帖**：`PostComposer` 的图片按钮走 `POST /api/uploads/image` 立即落桶（`uploads.ts:12-30`），正文却存在 localStorage 草稿里（`designs-web.md` §2.4）。草稿存活超过 `GRACE_MS = 24h`（`gc-images.ts:19`）就会被 GC 删掉，用户发出去的是一堆破图。封面今天也有这个问题，但封面是「上传即提交」的表单，帖子草稿是被明确设计成跨天存活的。

**修**：

- 正则必须锚死到 key 的完整文法，不能靠「URL 长什么样」猜：
  `new RegExp(escapeRegExp(base) + '/(?:avatar|cover|post)/[0-9a-f-]{36}\\.(?:webp|png|jpe?g|gif)', 'g')`
  ——key 由 `storage.ts:111` 自己生成（`${purpose}/${Bun.randomUUIDv7()}.${ext}`），文法是我们自己定的，所以可以锚死。
- 加一条**自检**，写进脚本而不是注释：把从正文抽出来的 key 与 `objects` 求交集，若「正文里解析出的 key 有 N 个，其中能在桶里找到的不足 N 的 90%」→ 拒绝执行。这是对 §13.1 那道熔断的补齐——现在的熔断防的是「白名单塌成空集」，防不住「白名单塌成一堆拼错的 key」。
- 帖子图的宽限期单独调到 7 天（按 key 前缀区分），或者在 `PostComposer` 里把「上传了但没发出去」的 URL 也写进 localStorage 草稿并在恢复时校验可达性。
- **顺序是硬要求**：`referencedUrls()` 必须在 `uploads.ts:22` 接受 `purpose === 'post'` **之前**合入，不是「M4 上线前」。`gc:images` 是手工脚本，开发期间任何人跑一次就会删。

---

### P0-4 Markdown 站内链接判定可被 `/\evil.com` 绕过 —— 而这正是设计里唯一被专门标注过的那个坑的隔壁

`designs-web.md` §5.5 抓到了协议相对 URL：

```tsx
const internal = href?.startsWith('/') && !href.startsWith('//')
```

并写了「`//evil.com` 是本节唯一一个看起来对、跑起来错的地方」。**它不是唯一一个。** WHATWG URL 解析器对 special scheme 把 `\` 等同于 `/`：解析 `/\evil.com` 时，第一个 `/` 进 relative slash state，第二个字符是 `\` 且 scheme 是 special → 进 authority state → **`evil.com` 被当成 host**，结果是 `https://evil.com`。

`[点这里](/\evil.com)` 这段 Markdown 能活到渲染：CommonMark 里 `\e` 不是可转义序列，反斜杠原样保留；`hast-util-sanitize` 看不到冒号，判定为相对路径放行；上面那行 `internal` 判定为 true。然后：

- 若 `localizeHref('/\\evil.com')` 内部用 `new URL(href, origin)` 归一化（Paraglide 的 href 处理会解析 URL），它会返回 `https://evil.com/`，`<Link to="https://evil.com/">` 对跨源绝对 URL 不做客户端拦截 → **左键点击直接跳出去**；
- 即便 `localizeHref` 原样透传，`<Link>` 只拦截 `button===0 && 无修饰键 && target 为空`——**中键、Ctrl/Cmd+点击、右键「复制链接地址」、以及爬虫读 SSR HTML，全部拿到 `https://evil.com`**，带着 Referer，没有 `noopener`、没有 `nofollow ugc`（那三个 rel 只加在「外链」分支上，而这条被判成了内链）。

同一类的第二个变体：URL 解析前会剥掉 TAB/LF/CR，所以 `/<TAB>/evil.com` 等价于 `//evil.com`，而 `startsWith('//')` 同样测不出来。

这一条的严重性在于：整份前端设计的安全叙事是「不装 `rehype-raw` + 白名单净化 + 链接策略」三件套，前两件做得很好，第三件有一个可用的绕过，**而绕过的产物是一个看起来是站内链接的钓鱼链接**——这比 XSS 更容易骗到人，因为它不触发任何浏览器警告。

**修**：判「站内」不能用前缀比较，要归一化后比 origin：

```ts
function classify(href: string) {
  const clean = href.replace(/[ -]/g, '')      // 先剥控制字符与 TAB/LF/CR
  if (!/^\/[^/\\]/.test(clean)) return 'external'                // 只认单斜杠 + 非斜杠/反斜杠开头
  const u = new URL(clean, 'https://internal.invalid')           // 再用 URL 解析器复核一次
  return u.origin === 'https://internal.invalid' ? 'internal' : 'external'
}
```

两道都要：正则挡住形状，`URL` 复核挡住我们没想到的形状（解析器永远比正则更懂它自己）。判定为 external 的一律走 `<a rel="nofollow ugc noreferrer noopener" target="_blank">`——**判错方向的代价是一个站内链接变成新标签页，而不是一次钓鱼**。

同一条判据要复用到 `?next=`（见 P1-7）。

---

### P0-5 `handle` 在三份文档里有三种定义 —— 而它是全设计唯一被声明为不可逆的字段

四份文档一致认为 `user_profile.handle` 是 M4 唯一同时命中「已对外发出的 URL」和「已发布正文」两条红线的决定。**然后给了三套互不兼容的定义：**

| 项 | designs-schema §9.2 | designs-notification §2.3/§10 | designs-api §3.3 |
|---|---|---|---|
| 可空性 | `varchar(20).notNull().unique()`，并论证 NOT NULL「是刻意的」 | `varchar(20).unique()`，**可空**，并论证「三次都撞就落 null——handle 可空」 | 未表态 |
| 正则 | `^[a-z0-9][a-z0-9_]{1,19}$`（首字符必须 alnum，防 `_admin` 视觉冒充） | `^[a-z0-9_]{2,20}$`（**允许 `_admin`**） | `^[a-z0-9_]{2,20}$` |
| 保留字 | `handleSchema` 带 `.refine(!RESERVED_HANDLES.includes)` | `setHandleSchema = z.object({ handle: z.string().regex(...) })` —— **没有保留字校验** | 带 `.refine` |
| 自动生成 | `u` + 10 位 base32 | `u` + 8 位 base32 | `u_` + 8 位 |
| 保留字表 | 21 项 | 21 项 | 17 项（多 `support`/`channel`/`you`，少 `u`/`new`/`edit`/`login`/`register`/`chronicle`/`spellcard`/`music`） |

三处具体后果：

1. **实现者若照抄 `designs-notification.md` §10 的 `setHandleSchema`**（那是四份文档里唯一给出完整可粘贴 schema 的地方），保留字校验就没有了 → 任何人可以 `PATCH /api/me/handle {handle:'admin'}`，从此 `@admin`、`/u/admin` 归他。这是**冒充**，而且因为 handle「自选一次后锁定、永不回收」，**是不可逆的**。同理 `@everyone` / `@all` 被注册之后，「@全体永不解析」这条保证当场失效。
2. **NOT NULL 与「生成失败落 null」直接互斥。** 若取 NOT NULL：`middleware/session.ts:35-43` 的惰性建档在 handle 唯一冲突时，`onConflictDoNothing()` 会静默吞掉插入 → `returning()` 空 → `row` undefined → actor 落到默认值 → **该用户永远没有 `user_profile` 行**。而 `moderation.ts` 的 `approvedResourceCount` / `strikeCount` 递增都是 `UPDATE user_profile WHERE user_id = ...`，对不存在的行是**更新 0 行且不报错**——信任梯度对这个用户永久失效，且没有任何日志。`designs-schema.md` §9.4 抓到了这个失败模式（值得表扬），但它的修法（显式 catch + 重试）与 `designs-notification.md` §5.1 的修法（`onConflictDoNothing({ target: userProfile.userId })`）**方向相反**：加了显式 target 之后，handle 唯一违例不再被吞，而是抛 23505 逃到 `app.onError` → 该用户**每一个 API 请求都 500**。
3. 首字符规则不同 → `_admin` 能不能注册取决于实现者翻到哪一页。

**修**（必须在写第一行代码之前拍死，因为发出去就改不动）：

- **一处定义**：`packages/shared/src/ids.ts` 的 `handleSchema` 是唯一事实来源，DB CHECK 由同一个正则字面量派生（写进注释并加一条测试断言两者一致）。
- 取值建议：`^[a-z0-9][a-z0-9_]{1,19}$`（采纳 designs-schema 的首字符收紧，理由成立且更窄的那个永远可以放宽、反过来不行）。
- **保留字必须在 DB 层也有一道**，不能只在 zod：`check('user_profile_handle_not_reserved', sql\`handle <> all (array[...])\`)`。理由与 `rating_score_range` 完全相同——只写在 zod 里的约束，绕过 API 就没了，而 handle 的绕过后果是不可逆冒充。
- 可空性取 **NOT NULL + 显式重试**，并且惰性建档必须写成：显式 `target: userProfile.userId` 的 DO NOTHING（保住并发建档的幂等）+ 对 23505 且 `constraint = user_profile_handle_uq` 的**单独** catch + 重试 ≤5 次 + 全失败 `fail(c,'internal',500)`。**绝不允许「落 null 继续」**——那会让 NOT NULL 变成一句谎话，并且把「没有 handle 的用户」这个状态偷偷带回三条渲染路径。
- 保留字表合并成一份，取并集，放 `shared/src/shrine/enums.ts`。

---

### P0-6 `/shrine` 默认视图的契约在三份文档里互相矛盾 —— 上线当天首页会是空的

`/shrine` 是博丽神社的默认视图，也是「资源站给论坛供血」这条产品判断的唯一落点。三份文档对同一个端点给了三套不兼容的行为：

| 争点 | designs-api §4.1 | designs-web §2.1 | designs-schema §3.5 |
|---|---|---|---|
| 置顶主题 | SQL 里 `AND t.pinned_at IS NULL`；`pinned[]` **只在 `?board=` 时返回，全站流不返回** | 未提及置顶 | `pinnedAt` 的唯一存在理由是「六版块各发一条站长引导帖」 |
| 零回复的资源主题 | 无过滤，进流 | **「资源主题只有 `postCount > 0` 时才进流」** | `lastPostAt NOT NULL DEFAULT now()`，其立论正是「新资源发布即进最新流，零回复也在」 |
| 分页 | 游标，**没有 `total`、没有 `page`** | `?page=1`，空态触发条件是 **`total < 10`**，并要装 shadcn `pagination` 组件 | — |

把三条叠在一起，上线当天的实际行为是：

1. 站长按计划在六个版块各发一条引导帖并置顶 → **它们被 `pinned_at IS NULL` 从全站流里排除**，只在 `/shrine/b/:board` 里能看到。而 `/shrine` 才是默认视图。
2. 种子资源的讨论主题 `postCount = 0` → **被 web 的过滤排除**。
3. 于是 `/shrine` 的 `items` 是空的。
4. 空态本该接管——但空态的触发条件是 `total < 10`，而 API 明确不返回 `total`。`loaderData.total` 是 `undefined`，`undefined < 10` 是 `false` → **空态不渲染**。
5. 结果：`/shrine` 是一个既没有内容、也没有空态引导的白页。**上线第一天，默认视图。**

而且第 2 条与 `designs-schema.md` §3.5 是正面冲突：那一节把 `lastPostAt` 收窄成 NOT NULL 的**全部理由**就是让零回复的新资源进流（「这正是资源站供血这条管道本身」），web 侧的 `postCount > 0` 过滤把它精确地撤销了。

**修**（按顺序拍板，三条一起）：

1. **置顶进全站流**：`pinned[]` 在无 `?board=` 时也返回（六条固定，不分页，不进游标）。分页流仍然排除置顶——这部分设计是对的，不要动。
2. **零回复的资源主题进流**，采纳 schema 的立场。web 若担心稀释信号，正确做法是**在行上区分视觉权重**（资源主题带封面缩略图 + 「来自香霖堂」徽章），不是从流里删掉——删掉之后这条流在上线期就没有东西了。
3. **空态触发条件换成不依赖 `total` 的信号**：`items.length === 0 && pinned.length <= 6 && nextCursor === null`。同时 web 的分页组件从主题流上撤掉（游标流用「加载更多」），`pagination` 组件只保留给楼层分页。

---

### P0-7 `NOTIFICATION_KIND` 与 `BOARD_SLUGS` 各有两套不兼容取值，后者是不可逆的对外 URL

**`NOTIFICATION_KIND`**：

- `designs-schema.md` §6.2 / `designs-api.md` §3.3：5 值 —— `['reply','topic_reply','mention','moderation','mod_queue']`，治理类事件塞进 `payload.action`；
- `designs-notification.md` §2.1：**扁平 13 值** —— `['reply','topic_reply','mention','like','review_approved','review_rejected','resource_delisted','resource_restored','resource_license','resource_deleted','post_deleted','role_granted','report_resolved']`，并且专门论证了「两层结构把判据藏进 jsonb，TypeScript 与 pgEnum 都管不住」。

这不是命名分歧，是三样东西的分叉：pgEnum 的值集、`collapseKeyFor()` 的分支、以及 web 侧 13 条 vs 5 条 Paraglide 文案映射。另外 5 值方案里**没有 `like`**，而同一份 schema 文档 §7 又把 `post_like` 表列为必建、并论证「点赞与通知是同一条回路的两半」——**它自己的两节互相矛盾**。

**`BOARD_SLUGS`**（这条更硬，它是对外 URL）：

| designs-api §3.3 | designs-web §6.4 |
|---|---|
| `tea-party` | `tea-house` |
| `danmaku-lab` | `danmaku` |
| `workshop` | `workshop` |
| `music-hall` | `music-hall` |
| `kappa-heavy` | `kappa` |
| `meta` | `meta` |

**六个里有三个不同。** 按四份文档一致承认的判据，`/shrine/b/:board` 是已对外发出的 URL，属于不可逆那一档。两份设计各写一半、实施时谁先落谁算数，是 M4 里最容易发生的一次不可逆错误。

**修**：这两个枚举在写代码之前由站长**逐值确认一次**，落在 `packages/shared/src/shrine/enums.ts` 单一文件里。建议取值：

- `NOTIFICATION_KIND` 取扁平 13 值（`designs-notification` 的论证更硬：判据落在 pgEnum 上，TypeScript 与 PG 都能管；13 个 Paraglide key 反正都要写）；同时把 `mod_queue` 按 §1.2 的裁决删掉（改为 `/dash` 导航计数）。
- `BOARD_SLUGS` 取更短的那一套（`tea-house`/`danmaku`/`workshop`/`music-hall`/`kappa`/`meta`），理由是 URL 段越短越经得起口头传播与 IM 粘贴；但这条由站长拍，不由本文拍。

---

## 2. P1 —— 会静默出错、会被利用、或让一条主要路径不可用

### P1-1 六个 `seed-demo*.ts` 都写 `topic.title`，新 CHECK 一加全部失败

`designs-schema.md` §3.6 的 `topic_kind_shape` CHECK 要求 `kind='resource'` 时 `title IS NULL`，§13.2 的改动清单只点了一处：`kourindou/index.ts:194-200`。

实际有 **7** 处：

```
apps/api/src/modules/kourindou/index.ts:195-201    title: row.titleOriginal
packages/db/scripts/seed-demo.ts:161-166           title: a.name
packages/db/scripts/seed-demo-fanworks.ts:187-192  title: e.title
packages/db/scripts/seed-demo-lilywhite.ts:167-172 title: w.title
packages/db/scripts/seed-demo-official.ts:111-116  title: ja
packages/db/scripts/seed-demo-official-free.ts:127-132  title: opts.titleOriginal
packages/db/scripts/seed-demo-tools.ts:168-173     title: it.titleOriginal
```

`seed:demo*` 是 CLAUDE.md 列进「常用脚本」的东西，也是一个零用户站点的全部启动内容。加了 CHECK 之后六个脚本**全部在第一条资源上 23514 失败**，而 `bun run migrate` 是成功的——症状是「迁移好了，种子跑不了」，排查方向容易跑偏到 drizzle。

**修**：改动清单补齐 7 处；同时 `designs-notification.md` §4.8 要求「seed 脚本造资源时补一行 `topic_subscription`」，那也是同样这 6 个文件，一并列进去。建议这 6 处抽成一个 `packages/db/scripts/_shared/createResourceTopic.ts`——它们现在是六份逐字重复的代码，正是 CHECK 会一次打穿六个地方的原因。

---

### P1-2 `POST /shrine/topics` 建主题 + 建 1 楼跨两个事务 —— 会产生「没有主楼的主题」

`content/post.ts:69` 的 `createPost` 用的是**全局 `db`**，自己开 `db.transaction`，签名不收 `tx`。`designs-api.md` §1.4 提出的签名改动是 `createPost(topic: TopicView, input)`——**仍然不收 tx**。

于是 `POST /shrine/topics` 只能写成：先 `insert(topic)` 提交，再 `createPost()` 提交。中间任何失败（`assertCanPost` 之后的限流竞争、mention 上限、DB 抖动、进程被 kill）都留下一条 `floorSeq = 0`、一条楼层都没有的主题：

- `GET /topics/:id` 按 `designs-web.md` §2.3「**必须返回 opening post**」，此时 opening 是 null，主题页渲染不出正文；
- 它带着 `lastPostAt = now()` 进最新流，用户点进去看到一个空壳；
- 作者可以删（无他人回复），但他得先找到它——最新流里它长得跟正常主题一样。

`designs-notification.md` §4.3 把订阅与扇出挂在 `createPost` 的事务内，等于把三件事（topic 行、floor 1、订阅+通知）分在两个事务里，原子性只保住了后两件。

**修**：`createPost` 的签名要收一个可选的 `tx`（drizzle 的 `PgTransaction`），`POST /shrine/topics` 在一个外层事务里调它。这与 §1.4 的 `TopicView` 参数化不冲突，两个参数都要：
```ts
export async function createPost(tx: Tx, topic: TopicView, input: {...})
```
调用方各自决定是 `db.transaction(tx => createPost(tx, ...))` 还是复用外层 tx。**「service 自己开事务」是一个只有单一写场景时才成立的偷懒**，M4 有两个写场景，现在就得改。

---

### P1-3 点赞 / 订阅 / 举报三个写端点没有过 `loadVisibleTopic()`

`designs-api.md` §1.2 的整篇论证是「同一张表两个写入口就要写两遍可见性判断，而分层闸门必然漂移」。然后 §2 的路由表里：

| 路由 | 列出的 error code | 有没有闸门 |
|---|---|---|
| #11 `PUT /shrine/posts/:id/like` | `unauthorized` `not_found` `self_action_forbidden` | 没写 |
| #12 `DELETE /shrine/posts/:id/like` | `unauthorized` `not_found` | 没写 |
| #6 `PUT /shrine/topics/:id/subscription` | `unauthorized` `not_found` `validation_failed` | 没写 |
| 举报（复用 `interactions.ts:136-146`） | — | **确认没有**（只查 `isNull(post.deletedAt)`，不 JOIN topic） |

后果按严重性排：

1. **点赞是一次会产生通知的写。** 对一个「已下架资源讨论区里的楼层」点赞，会给作者发一条 `like` 通知，通知里带着那条已经被下架的主题——把一条本该隐藏的内容，主动推到用户收件箱里。
2. **点赞 + 取消点赞可以无限循环增加折叠计数。** `designs-notification.md` §6.4 承认「反复取消赞再赞会让 count 一路往上加」，并写「接受：噪音上限受未来的发帖/互动限流保护」——但 §6 的 `assertCanPost` 只覆盖发帖，**点赞完全没有限流**（见 P1-6）。一个登录 bot 可以把受害者收件箱顶部那条 `like:<postId>` 顶到 count=50000 并且永远 `createdAt = now()`（折叠会把它推到顶）——**受害者的收件箱从此只有这一条**，而且他没有任何屏蔽手段（私信/拉黑明确不做）。这是一条完整的骚扰链路。
3. 举报端点仍然是一个「这个 post id 存在吗」的预言机（`mined-reusable` P2-1 已列，两份设计都标成 P2）。在同源之后它探测的是「这个 uuid 是不是某条被隐藏讨论里的楼层」。

**修**：三个端点全部先过 `loadVisibleTopic()`（点赞和举报要先 `post → topicId` 一跳，这是一次主键查找）。`PUT /like` 在主题 `lockedAt !== null` 时也应当拒绝——锁帖的语义是「停止这里的一切互动」，只挡回帖挡不住点赞，那是半扇门。

---

### P1-4 通知收件箱与 `quoted.excerpt` 没有可见性过滤，且被删内容会经 SSR 进入 HTML

**(a) 收件箱查询**（`designs-notification.md` §3.2）5 个 LEFT JOIN 取 `t.title` / `p.floor` / `r.slug`，**没有任何可见性谓词**。版主软删一个主题之后，订阅者收件箱里那条 `topic_reply` 仍然显示主题标题；资源被下架之后，`topic_reply` 仍然显示资源 slug（点进去 404，但标题已经泄漏了）。严重性低于 P0-1（收件人只有订阅过的人），但它是同一个洞的第三个实例，而且**修法是同一个 `visibleTopicWhere()`**——收件箱应当在 join 后把不可见 subject 的标题渲染成「该内容已被移除」，行本身保留（通知不是法律留痕但它是「有没有告诉过用户」的送达副本，删行会破坏这个语义）。

**(b) `quoted.excerpt` 必须在服务端置空。** `designs-web.md` §8 第 4 条要求 API 返回 `quoted.excerpt`（纯文本摘要），`PostView.quoted` 里同时有 `deleted: boolean`。如果服务端在 `deleted === true` 时照样把 excerpt 发出来、由前端负责不渲染，那么：**React Router 的 SSR 会把整个 loader 返回值序列化进 HTML**（用于 hydration）。一条被版主删掉的骚扰内容，会以明文出现在每一个引用了它的楼层所在页面的 HTML 源码里。

`content/post.ts:36-46` 已经做对了这件事（`bodyMd: r.deletedAt ? '' : r.bodyMd`，注释写着「软删的楼层保留占位」），**新写的 `quoted` 投影必须照抄这个形状**，四份文档里没有一处写了这条。

**(c) 顺带**：excerpt「~100 字」的截断如果按 UTF-16 code unit 切，会把 emoji / 罕用汉字的代理对切一半，渲染出替换字符。用 `Intl.Segmenter` 或 `[...str].slice(0,100)`。

---

### P1-5 `link_not_allowed` 没有 staff 豁免，且「账号年龄 ≥ 3 天」意味着上线第一周**没有人**能发外链

`designs-api.md` §6.3：

```ts
canPostLinks(actor) =
  actor.strikeCount === 0 &&
  (actor.approvedResourceCount >= threshold || accountAgeDays(actor) >= 3)
```

三个问题：

1. **没有角色豁免。** 站长自己的账号在上线第一天也是新账号（`user_profile.createdAt` 由 `session.ts:35-43` 惰性创建，最早也就是部署当天）。而 P0-6 里那六条置顶引导帖，正常写法一定包含「去看看 /kourindou 的这几个资源」这类链接。**站长发不出自己的引导帖。**
2. **`河童重工`（技术版）与 `二创工坊` 的内容形态就是链接。** 上线首周这两个版块对所有人只读。
3. `accountAgeDays` 的基准是 `user_profile.createdAt`，那是**首次带会话访问 API 的时间**，不是注册时间。差异通常是秒级，但如果将来加了「注册后先验邮箱」的流程，差异会变成任意长。写进注释，别让后人以为它等于注册时间。

**修**：`canPostLinks` 加 `RANK[actor.role] >= RANK.moderator ||` 作为第一个短路条件；`accountAgeDays` 的阈值放进 `siteConfig`（kv 表已在，`autoPublishThreshold` 是现成先例），上线首周设 0，有了第一批 spam 再调上去。**冷启动期的默认值应当是「先放开、出事再收紧」**——这与资源侧「先审后发」相反是对的，因为帖子可删、资源分发不可撤。

---

### P1-6 只给发帖做了限流：举报、点赞、订阅、handle 全裸

`designs-api.md` §6.1 的调查结论经代码复核**完全属实**：`rate_limited` 在 `errors.ts:16` 定义，全仓再无第二处出现；`duplicate_slug`（`errors.ts:21`）同样是空悬码。但 §6.2 的 `assertCanPost` 只挂在 `POST /topics` 与 `POST /topics/:id/posts` 两处。裸着的写端点：

| 端点 | 被滥用会怎样 |
|---|---|
| `POST /api/reports` | **`report` 表没有任何 `(reporter_id, target_id)` 唯一约束**（`kourindou.ts:360-384` 确认）。一个账号可以对同一条资源提交 10000 条举报，全部进 `WHERE status='open'` 的队列（`moderation.ts:132-142`）。solo 运营下，举报队列是论坛唯一的「审」入口（两份设计都这么说），把它埋掉就等于关掉整个治理通道 |
| `PUT/DELETE /posts/:id/like` | 见 P1-3 第 2 条：可把受害者收件箱永久占满 |
| `PUT /topics/:id/subscription` | 配合 `LIMIT 500` 的扇出（§6.3），把一个热门主题订阅到 500 上限，之后真实订阅者静默收不到通知（见 P2-6） |
| `PATCH /api/me/handle` | handle 抢注扫描；且它是不可逆资源 |
| `POST /api/uploads/image`（既有） | §6.2 自己点名了，加上 `purpose='post'` 之后 MinIO 的填充速度乘以帖子数 |

**修**：`assertCanPost` 泛化成 `assertRate(actor, bucket)`，bucket 是 `'post' | 'report' | 'like' | 'upload' | 'handle'`，用同一条 SQL 形状（各自的表 + `(actor, created_at)` 索引）。`report` 额外加一条 `uniqueIndex('report_open_uq').on(reporterId, targetKind, targetId).where(status = 'open')`——**同一个人对同一个目标只能有一条未处理的举报**，形状与 `circle_claim_open_uq`（`kourindou.ts:151-153`）逐字相同，是现成的先例。

顺带：`assertCanPost` 的「重复正文」规则（与上一帖逐字相同 → 409 `duplicate_content`）在冷启动期会**误伤真实用户**——「谢谢」「+1」「ありがとう」在两个不同主题里发两次就被拒。而且它只比对上一条，交替两句就能绕过。建议要么按「同一 topic 内」限定，要么直接砍掉（它挡不住会写脚本的人，只挡得住正常人）。

---

### P1-7 `?next=` 没有同源校验 —— 开放重定向

`designs-web.md` §2.4 要求 `routes/login.tsx` 支持 `?next=`（现在确实不支持，`login.tsx:31` 是写死的 `navigate(localizeHref('/'))`），§2.7 要求 handle 设置成功后 `redirect` 回 `next`。**两处都没有说 `next` 要校验。**

`https://gensokyo.example/login?next=https://evil.example/login` 是一条挂在真域名下、能通过任何链接检查的钓鱼链接。同样的 `/\evil.com` 变体（P0-4）也适用。

**修**：复用 P0-4 的 `classify()`，只接受判定为 `internal` 的 `next`，其余一律回 `/`。这条要写成一个 `safeNext(raw)` 工具函数，因为 `next` 参数以后每加一个需要登录的页面就会多一个调用点。

---

### P1-8 游标分页的两个具体缺陷（其中一个会让翻页永远前进不了）

**(a) 正文与 SQL 互相矛盾，而按正文实现会卡死。** `designs-api.md` §4.1 的 SQL 把 `r.status = 'published'` 写在 `WHERE` 里（LIMIT 之前），紧接着的代价表却写：

> **短页不代表到底** —— 上面的 `resource.status` 过滤发生在 **LIMIT 之后**，一页可能不足 30 条却仍有下一页。

如果实施者信了这句话、把过滤挪到应用层，就会踩到一个具体的死循环：`nextCursor` 若取自**最后一条返回项**（过滤后的），那么被过滤掉的、排在它后面的那些行会在下一页被重新取出、重新过滤掉；极端情况下整页 31 条全被过滤 → `items` 为空 → 前端拿不到 `nextCursor`（或拿到一个不前进的游标）→ **翻页永远停在这里**。

**修**：过滤留在 SQL 里（现有 SQL 是对的），把那段正文删掉；如果确实需要应用层过滤，契约必须写死「`nextCursor` 取自**最后一条被取出**的行，不是最后一条被返回的行」。

**(b) keyset 并没有消掉漏帖。** §4.1 说「offset 在这里确实会漏帖/重帖，而且是必然的」——对；但结论「所以用 keyset」只对了一半。keyset 消掉的是「插入/删除导致的偏移漂移」，**消不掉「排序键本身会变」**：`last_post_at` 每次回帖都变，一条排在游标之下的主题被顶到游标之上，本次翻页就永远看不到它了。这是所有「按最后活动时间排序」的信息流的固有性质（Reddit/HN/Discourse 都一样），不是缺陷——但设计文档不该把它写成「解决了」。诚实地记一笔即可，避免日后有人为了「修这个 bug」去改分页方案。

**(c) 游标编码**：`cursorSchema = z.string().max(120).regex(/^[A-Za-z0-9_-]+$/)` 不接受 `=`。若 `encodeCursor` 用 `btoa()` 而不剥 padding，**服务端会拒绝自己刚发出去的游标**——第二页 400。写进契约：`encodeCursor` 必须 `.replace(/=+$/,'')`，并加一条 round-trip 测试。

---

### P1-9 `postCount` / `floorSeq` / `replyCount` 三方矛盾，且 `replyCount` 没有维护者

| 文档 | 主张 |
|---|---|
| `designs-schema.md` §3.4 | 改名 `floorSeq`，**明确不加 `replyCount`**，理由是「找不到上线当天需要它的查询」，并写下了触发条件 |
| `designs-api.md` §1.4 / §4.2 | `TopicView` 同时有 `postCount`（水位）**和** `replyCount`（展示用），并说「这条同时坐实了 N2 的建议……两职分离现在零成本」 |

如果实施者按 api 文档加了 `replyCount`：它需要在**发帖 +1、软删 -1、恢复 +1** 三处维护，而 M4 只有软删、没有恢复端点（`designs-api.md` §10「主题恢复/楼层恢复端点：不做，走站长 SQL」）。**站长走 SQL 恢复一条楼层时不会记得更新 `replyCount`** → 计数永久偏低。这是标准的冗余计数漂移，而 schema 文档的分析（软删保留占位、行数恒等于 `floorSeq`、展示值一个三元表达式就能推）是正确的。

**修**：采纳 `designs-schema.md`。`TopicView` 只留 `floorSeq`，序列化层按 `kind` 推导展示值。改名本身必须做——理由（`postCount` 这个名字在字面上邀请人写 `- 1`，真写了会让下次发帖撞 `post_topic_floor_uq`，而 `content/post.ts:99-101` 的 `catch {}` 会把这个唯一违例伪装成 404 `topic_missing`，该主题从此发不出帖）经代码复核完全成立，是本次审查里我最认可的一条判断。

---

### P1-10 `notify()` 的优先级去重会静默丢掉同批次里第二条治理通知

`designs-notification.md` §4.0：

```ts
const p = KIND_PRIORITY[r.kind] ?? 0
if (!prev || p > (KIND_PRIORITY[prev.kind] ?? 0)) best.set(r.userId, r)
```

`KIND_PRIORITY` 只定义了 `mention:3 / reply:2 / topic_reply:1`，**其余 10 个治理类 kind 全部 `?? 0`**。同一个 userId 出现两条 priority-0 行时，条件 `p > prevP` 为 false → **第二条被静默丢弃**。

今天的 12 个挂点里治理类都是单收件人单条，撞不上。但这是一个**没有护栏的地雷**：日后任何「一个动作产生两条治理通知」的场景（例：删楼的同时降权；purge 一个资源的同时通知作者与举报人——举报人恰好是作者时）会静默丢一条，而通知是**不可重算**的（§6.5 自己论证过），丢了就是永久丢。

**修**：去重只对参与竞争的三个社区 kind 生效：

```ts
const RANKED = new Set(['mention','reply','topic_reply'] as const)
// 不在 RANKED 里的行一律直接入队，不参与 Map 去重
```
并加一条断言：同一批次里同一个 `(userId, collapseKey)` 出现两次直接抛（那是 PG 21000 的前置条件，宁可在应用层炸得清楚）。

---

### P1-11 「治理动作有幂等闸门所以不包 SAVEPOINT」这个前提，经代码核对只有 `/review` 成立

`designs-notification.md` §4.2 是全设计里最重要的一条判据，它的论证依赖一句事实主张：

> **审核有**（幂等闸门）。`/review` 开头就是 `if (row.status !== 'pending') return fail(..., 409)`……`/status`、`/license`、`role_change`、`delete` 的重试都不改变最终状态。

逐个核对：

| 端点 | 有没有幂等闸门 | 重试的后果 |
|---|---|---|
| `POST /resources/:id/review`（`moderation.ts:80-82`） | ✅ 有 409 守卫 | 打不进来，正确 |
| `POST /resources/:id/status` | ✅ 靠 `canTransition`（`published → published` 非法） | 正确 |
| `POST /reports/:id/resolve`（`moderation.ts:148-186`） | ❌ **没有任何 status 检查** | 重试 → 再写一条 `report_resolve` 审计 + **再发一条 `report_resolved` 通知** |
| `PATCH /resources/:id/license` | ❌ 没有「新旧值相同就 409」 | 同上，重复 `license_change` 审计 + 重复通知 |
| `PATCH /users/:id/role` | ❌ 没有 | 重复 `role_change` 审计 + 重复 `role_granted` 通知 |
| `DELETE /resources/:id`（soft） | ❌ 没有 `deletedAt` 检查 | 重复 `soft_delete` 审计 + 重复通知 |

也就是说：把通知与事务绑死之后，「通知失败 → 整体回滚 → staff 重试」这条恢复路径，在四个端点上会产生**重复的审计行**。审计日志是版权争议时的证据链（`kourindou.ts:414-418` 的注释原话），重复行不致命但会让「这件事做过几次」这个问题答不清楚。

**修**：不是去掉事务绑定（那条判据本身是对的），而是**把幂等闸门补齐**——四个端点各加一句「新值与旧值相同 → 409 `invalid_state_transition`」。这是几行代码，且顺带修掉了一个既有缺陷（`resolve` 可以把一条已 resolved 的举报改成 rejected 并覆盖 `resolvedBy`）。

---

## 3. P2 —— 应当修，但不阻塞

### P2-1 `sanitizeSchema` 整体替换 `protocols`，`img.src` 因此失去协议白名单

```ts
export const sanitizeSchema = {
  ...defaultSchema,
  protocols: { href: ['http','https','mailto'] },   // ← 整个替换掉了 defaultSchema.protocols
}
```

`hast-util-sanitize` 的 `defaultSchema.protocols` 含 `src: ['http','https']`（还有 `cite` / `longDesc`）。上面这行把它们全部删掉，于是 `<img src>` 不再有协议限制。`designs-web.md` §5.4 的 `rehypeImagePolicy` 会先把非站内 host 的 `<img>` 降级成 `<a>`，所以实际后果取决于那个插件怎么判 host——若用 `new URL(src).host !== imageHost` 则 `data:` URI 的 host 为空字符串、会被判成外链、降级成 `<a href="data:...">`、再被 href 的协议白名单挡掉，链路是安全的；若用 `src.startsWith(base)` 也安全。但**安全性此时依赖那个插件，而不是净化器**——这与整节「白名单不是黑名单」的立场相反。

**修**：`protocols: { ...defaultSchema.protocols, href: ['http','https','mailto'] }`。一个字符的事，把最后一道背板留在净化器里。

### P2-2 `MODERATION_ACTION` 三方矛盾

- `designs-schema.md` §8.3：**只加 `topic_lock`**，论证 `soft_delete` 是通用动词 + `subjectKind` 已能区分对象，加 `post_delete` 会造出「同一件事两个动词」；
- `designs-api.md` §9 P1-1：加 `post_delete` / `topic_delete` / `topic_moderate` 三个；
- `designs-notification.md` §4.7 的代码片段：用 `action: 'post_delete'`。

schema 文档的论证更强（审计日志的过滤维度是 `(action, subjectKind)` 二元组，不是 action 一元）。建议采纳 schema 版：只加 `topic_lock`，删楼用 `soft_delete + subjectKind='post'`。**这条要拍板，因为它决定 `dash` 里审计过滤 UI 的形状。**

### P2-3 若干契约细节在两份文档间不一致（逐条列出，便于一次收敛）

| 项 | A | B |
|---|---|---|
| handle 被占用的错误码 | `designs-api` §8：新增 `handle_taken` | `designs-web` §2.7：「不新增错误码」，复用 `duplicate_slug` |
| 通知列表分页 | `designs-api` §4.3：游标 | `designs-notification` §3.2：offset（`paginationQuerySchema`） |
| `markReadSchema` | `designs-api`：`z.object` + XOR `.refine` | `designs-notification`：`z.union([...])`（`{ids,before}` 同时给会静默走第一分支并剥掉 `before`） |
| 主题标题长度 | `designs-api`：`.max(100)` | `designs-web` §2.4：`maxLength=200`（对齐 `topic.title varchar(200)`） |
| 被软删主题 staff 能否看 | `designs-api` §1.4 的 `loadVisibleTopic` 对所有人返回 null | `designs-web` §2.3：「`deletedAt !== null` 且 viewer **非 staff** → 404」 |
| 版块是表还是常量 | `designs-schema` §2：**建表**（决定性理由是 `topic.boardSlug` 要外键） | `designs-api` §3.3 / `designs-web` §6.4：**不建表** |

最后一条要单独说：**两边的论证都成立，但它们回答的不是同一个问题。** schema 文档要的是引用完整性（拼错一个 slug 就产生一条「不在版块页、却在最新流」的孤儿主题），api/web 文档要的是「没有管理后台时改 DB 里的名字比部署更贵」。**两者可以同时满足**：建一张只有 `slug` 主键（+ `sortOrder`）的 6 行表当外键目标，名字与说明留在 Paraglide。这样既拿到外键，又不引入第二套 i18n，也不需要 psql 改文案。建议按这个合。

### P2-4 `lastPostAt` 混用应用时钟与数据库时钟

`content/post.ts:79` 写的是 `lastPostAt: new Date()`（API 进程的时钟），而 §3.5 提议的列默认值是 `DEFAULT now()`（DB 时钟）。最新流的排序键横跨两个时钟源；API 进程时钟落后于 DB 时,新回复会排在旧主题后面。改成 `sql\`now()\`` 一处即可。

### P2-5 `visibleTopic()` 里 `lockedAt` 的读写分离没有写进契约

`designs-schema.md` §3.2 的 `visibleTopic()` 返回 `lockedAt` 并注释「调用方再判 lockedAt（读可以，写不行）」——**这是把闸门又拆成两半的写法**，正是 §1.2 反对的形状。应当返回 `TopicView` 并只暴露 `isWritable(t)` 这一个判定函数，让「忘了判 lockedAt」在类型层面难写出来（例如 `createPost` 只接受 `WritableTopic` 这个 branded type）。

### P2-6 扇出 `LIMIT 500` 没有 `ORDER BY` —— 静默且不确定的截断

`designs-schema.md` §5.2 / `designs-notification.md` §6.3 的 `watchersOf(topicId)` 带 `LIMIT 500` 作为绝对上界。没有 `ORDER BY` 时 PG 返回哪 500 个是不确定的，且**每次不同**——一个超过 500 订阅者的主题，每次发帖随机 500 人收到通知。零流量时撞不到（这是选它的理由），但撞到那天的症状是「通知时有时无」，是最难排查的一类。加 `ORDER BY user_id` 并在截断时 `console.warn` 一行。

### P2-7 `user.name` 完全不受控，而 M4 把它铺到每一行

`packages/db/src/schema/auth.ts` 的 `name: text('name').notNull()`——无长度上限、无字符集约束、可通过 better-auth 的 update-user 随时改。M4 之后它会出现在：每条楼层、每条通知、每行主题列表的「最后回复者」、`UserChip`。

后果不是 XSS（React 会转义），是：① 一个 5000 字的显示名把每一行布局打爆；② 显示名可以是 `霧雨魔理沙 [版主]` 或 `@admin` —— handle 解决了**提及**的冒充，没解决**视觉**的冒充；③ 显示名里的 RTL override / 零宽字符会污染整行渲染。

**修**（M4 范围内的最小动作）：`UserChip` 对显示名做 `.slice(0, 40)` + `[\p{Cf}\p{Cc}]` 剥除 + CSS `truncate`；角色徽章用不同的视觉容器（不是方括号文字）。真正的修法是给 better-auth 的 update-user 加校验，那是独立一项。

### P2-8 `handleParam` 用带保留字 `.refine` 的 schema 会把 `/u/admin` 变成 400

`designs-api.md` §3.3 的 `handleParam = validate('param', z.object({ handle: handleSchema }))`，而 `handleSchema` 带 `.refine(!RESERVED_HANDLES.includes)`。路径参数校验应当只管**形状**，不管**语义**——`/u/admin` 的正确答案是 404（没有这个用户），不是 400（格式错误）。分成 `handleSchema`（写入用，带保留字）与 `handleParamSchema`（读取用，只有正则）。

### P2-9 `packages/shared` 的 `"./kourindou"` 子路径导出

`designs-api.md` §3.2 的「全仓 grep 确认没有任何深路径导入，所以移动是零风险的」经复核**属实**（源码里零处 `@gensokyo/shared/kourindou`）。但 `packages/shared/package.json` 里确实**声明了** `"./kourindou": "./src/kourindou/index.ts"` 这个导出。把 `createPostSchema` / `TOPIC_KIND` / 三种 id schema 搬走会改变这个已声明子路径的内容。没有调用方所以无害，但顺手把它一起删掉或改成 `"./shrine"` + `"./kourindou"` 两条，别留一个内容漂移的导出面。

### P2-10 `POST /api/uploads/image` 是 multipart，因此是 CSRF 可达的（既有，M4 放大）

hono 的 `validate('json', ...)` 会拒绝非 `application/json` 的 content-type，所以 M4 所有 JSON 写端点天然免疫跨站表单提交。但 `uploads.ts:16` 用的是 `c.req.parseBody()`（multipart），而 multipart/form-data 是「简单请求」——一个跨站页面可以带着用户 cookie 往这里 POST。今天的影响是「别人可以用你的账号往桶里塞图」，加上 `purpose='post'` 之后影响不变但配额变大。加一道 `Origin` / `Sec-Fetch-Site` 检查即可，几行。

---

## 4. 设计里对的部分 —— 不要动

这一节和上面一样重要。以下每一条我都对照代码验证过，它们是这四份文档的真实价值所在：

1. **`topic.lastPostAt` 改 NOT NULL DEFAULT now()**（schema §3.5 / api §4.1 P0-3）。PG 的 `ORDER BY x DESC` 默认 NULLS FIRST 属实；`kourindou/index.ts:195-201` 建 topic 时确实不写 `lastPostAt` 属实。这是一个上线当天必然发生、又极易被误诊成「排序写错了」的 bug。**保留，并且它连带的立论（零回复的新资源要进最新流）也要保留**——见 P0-6。

2. **`postCount → floorSeq` 改名**（schema §3.4）。名字邀请人写 `- 1` → 下次发帖撞 `post_topic_floor_uq`（`content.ts:86`）→ 被 `content/post.ts:99-101` 的 `catch {}` 伪装成 404 `topic_missing` → 该主题永久无法发帖而错误信息说的是「主题不存在」。这条因果链每一环我都在代码里确认过。**三处引用换一条走不通的死路，做。**

3. **删掉 `post_topic_floor_idx`**（schema §11.1）。`content.ts:84` 与 `:86` 的键**完全相同**（`topicId, floor`），唯一索引已经服务所有查询——在全站最热的写表上白付一倍索引维护。删。同理 `topic_kind_idx`（两值低选择性，`topicForResource` 走 `resourceId` 的唯一索引）。

4. **`resource_deleted` 通知绝不能带 `resourceId` 外键**（notification §4.6 / schema §10）。`admin.ts:121-146` 的 `mode:'purge'` 确实是 `DELETE FROM resource`，`topic.resourceId` 确实是 cascade——带外键的通知会在同一个事务里被自己级联删掉，作者永远收不到。这是本次审查里我最欣赏的一条发现：**它需要同时看懂级联拓扑和事务边界，且症状是「什么都没发生」**。

5. **`admin.ts:110-118` 的 select 没取 `uploaderId`**（notification §4.6）。属实。挂点之前必须先补这一列，否则没有收件人。

6. **SAVEPOINT 是强制而非可选**（notification §4.2）。PG 里事务内任何错误都让事务进 aborted 状态、后续语句一律 25P02，裸 `try/catch` 救不回发帖——这个判断完全正确，而且是最容易被「加个 try/catch 就好了」糊弄过去的地方。必须用 `tx.transaction()`。

7. **`notify()` 的去重是正确性要求而非产品规则**（notification §6.2）。同一条 INSERT 里两行命中同一个折叠行，PG 报 21000（`ON CONFLICT DO UPDATE command cannot affect row a second time`）。这条把一个产品决定和一个数据库约束绑在了一起，值得写进代码注释。

8. **`targetWhere` 必须与部分唯一索引的谓词逐字一致**（schema §6.3 / notification §4.0）。不一致时 PG 报「there is no unique or exclusion constraint matching the ON CONFLICT specification」，而这个错误发生在**运行时的扇出路径上**，本地小数据量测试很容易漏。

9. **取消订阅写 `muted` 行而不是删行；回复即订阅的 upsert 必须 `DO NOTHING`**（schema §5.1 / notification §6.3）。「删行 → 下次回复被自动加回来 → 用户认为退订功能坏了」这条推理是对的，而且 `DO UPDATE state='watching'` 是同一个 bug 的第二种写法——两条都点了出来。

10. **不装 `rehype-raw` + `react-markdown` 永不产生 HTML 字符串**（web §5.1/§5.2）。「针对用户内容的 `dangerouslySetInnerHTML` 那行代码根本不存在」是一个**结构性**保证，不是一次代码审查的结论。这是整份前端设计里价值最高的一条。「任何 PR 里出现 `rehype-raw` 都是安全事故」应当逐字写进 review checklist。

11. **`className` 只允许固定值**（web §5.3）。开放 `className` = 把 Tailwind 全部工具类交给用户，`fixed inset-0 z-50` 就是一个纯 CSS 的全屏钓鱼覆盖层——**不触发任何 XSS 检测**。这是我在同类设计里很少见到有人想到的。同理 `id` 一律禁（与 `#discussion`/`#p137` 撞车 + DOM clobbering）。

12. **表情/提及插件只访问 mdast 的 `text` 节点，因此代码块自动免疫**（web §5.6）。`inlineCode`/`code` 的内容在 `value` 字段而不是 `text` 子节点——这个细节是对的，而且它把「代码块里的 `:reimu:` 不被替换」从一条要写的判断变成了一个不需要写的性质。

13. **`extractMentions` 的后顾断言故意不含 `\p{L}`**（notification §5.2）。中日文写作里 `@` 前面不加空格是常态，含了 `\p{L}` 就解析不出「你好@marisa」。这条只有真的想过 CJK 排版才会发现。配套的「解析可以宽松，因为结果必过一次 handle 存否查库」也是对的。

14. **`GET /moderation/reports` 的 join 要写 `post.id::text = report.target_id`**（api §9 P1-3）。`report.targetId` 是 `text`（`kourindou.ts:365`），反向写 `report.target_id::uuid` 会在遇到任何非 uuid 行时抛 22P02。方向选对了。

15. **楼层区间分页 + 服务端固定 `POSTS_PAGE_SIZE` + 吸附页边界**（api §4.2）。`?from=137` 与 `?from=121` 返回逐字相同的响应，深链永久稳定；而 `paginationQuerySchema` 允许客户端把 `pageSize` 设成 1..100（`pagination.ts:5` 确认）确实会让同一条深链指向不同内容。

16. **staff 不能编辑他人正文，只能删（留痕）与锁**（api §5(b)）。「版主改写了我的话」是申诉链上最难自证的指控，而 M4 没有 `post_revision`。收紧的方向是对的，并且文档提醒了「这里不能顺手写 `isOwnerOrStaff`」——那确实是本能反射（`require.ts:22-23` 就在手边）。

17. **失败态与空态必须是两个分支**（web §2）。「把加载失败画成『还没有内容』是冷启动期最坏的错」——它把一次故障伪装成「这站是空的」。`kourindou/list.tsx` 的 `failed` 标志是现成形状。

18. **通知中心空态必须写清「通知会从哪四处来」**（web §2.5）。一个永远空的收件箱如果不解释自己，用户学会的是不看它。

19. **`post.locale` 只用于 `lang=` 属性，不做徽章、不做筛选、不做翻译入口**（web §6.2/§6.3）。CJK 字形选择是一个**今天就存在**的显示错误；而「标错的语言徽章比没有徽章更糟」和「翻译按钮是一次质量承诺，把『社团允许再分发』翻反就是踩生死线」两条论证都成立。

20. **`gc-notifications.ts` 只保留比例熔断**（notification §8），并明确说明 `gc-images` 的「引用集合塌成空集」那种塌陷模式在这里不存在（白名单是纯时间谓词）。判断精确，没有照抄。

21. **`DELETE /posts/:id` 缺 `moderationLog`**（`content/index.ts:78-87` 确认无事务无审计）。三份文档都点了，属实，且它是 M3 所有 staff 处置动作里唯一漏的一处。

22. **`admin.ts:153-167` 的 `restore` 不写 `moderationLog`** —— 复核属实（旁边的 DELETE 写了、`PATCH /config` 写了，唯独恢复没有）。

23. **`siteConfig` 的公开面是白名单**（`enums.ts:138-142` + `admin.ts:226-234`）。所以把硬词表放进 `siteConfig`（api §6.2 规则 5）**不会**泄漏——只要不把新键加进 `PUBLIC_CONFIG_KEYS`。这一点设计文档没说，但结论是安全的，记在这里免得后人为它单独造一张表。

---

## 5. 复核过、判定不是问题的

列出来是为了证明它们被查过：

- **`z.coerce.boolean()` 对 `"false"` 得到 `true`** —— 属实，三份文档都用了显式 `z.enum(['true','false'])`。对。
- **`notify()` 按 `userId` 排序防死锁** —— 去重之后每个 user 在一个批次里只剩一行，排序确实足以保证加锁顺序一致。对。
- **折叠行 `createdAt = now()` 会逃出「全部已读」的 before 游标** —— 这是想要的行为（有新动静就该保持未读），论证对。
- **`bodyMdSchema = z.string().trim().min(1).max(20000)`** —— zod 里 `.trim()` 在 `.min()` 之前生效，顺序写对了（M3 的 `createPostSchema` 确实没有 `.trim()`，一个空格今天可以入库，`schemas.ts:166-169` 确认）。
- **`user_profile.createdAt` 可以当账号年龄用** —— `kourindou.ts:69-71` 确认存在且是 `timestamptz`，而 `session.ts:29-33` 是 `db.select()`（整行），所以它确实在手里。api §6.3 关于「不要用 better-auth 的 `user.createdAt`（无时区）」的提醒也对。
- **`entityIdParam` / `userIdParam` 的区分** —— `errors.ts:75-81` 确认，三份文档都正确引用了。`handle` 作为第四种 id 形状的判断也对。
- **中间件顺序 `requireAuth, entityIdParam`** —— notification §4.7 的顺带提醒属实（`content/index.ts:78` 是反的，未登录 + 非法 uuid 会先拿 400）。
- **`report.targetKind` 不用加值** —— `kourindou.ts:364` 是无约束的 `varchar(16)`，`schemas.ts:158` 的 `z.enum(['resource','post'])` 已含 `'post'`，`interactions.ts:136-146` 的 post 分支 M3 就写完了。属实。
- **`REPORT_REASON` 缺 `spam`/`harassment`** —— 属实，现有五值全是资源语义。

---

## 6. 动工前必须拍板的清单（按不可逆程度排序）

1. **`BOARD_SLUGS` 六个取值**（对外 URL，不可逆）—— 两份文档三处不同，见 P0-7。
2. **`handle` 的正则、可空性、保留字表、生成策略**（对外 URL + 已发布正文，不可逆）—— 见 P0-5。
3. **东方表情 shortcode 词表**（写进已发布正文，不可逆）—— 四份文档都提到要定，都没有定。`:角色_表情:` 的命名约定是对的。
4. **主题 URL 用 uuid 还是全局序号**（对外 URL，不可逆）—— 两份文档都倾向 uuid 且理由一致（序号会公开主题总数），建议照办。
5. `NOTIFICATION_KIND` 取 5 值还是 13 值（库空时可逆，但决定 20 条 Paraglide 文案的形状）。
6. `board` 建不建表 —— 建议按 P2-3 的折中方案（只建 slug 表当外键目标，文案留 Paraglide）。
7. `postCount/floorSeq/replyCount` —— 建议采纳 schema 版（不加 `replyCount`）。
8. `MODERATION_ACTION` 加几个值 —— 建议采纳 schema 版（只加 `topic_lock`）。
9. 合并 URL（删 `/kourindou/resources/:slug/posts`）现在做还是并行一版 —— **建议现在做**。§1.2 的论证成立，而且 `content.test.ts` 有 14 处引用、`e2e.ts` 有若干，全在 monorepo 内，是一次编译期可发现的重构；M4 之后会变贵。
10. 资源下架 = 讨论隐藏还是只读可见 —— 与 M3 现状一致（隐藏）即可，但**若改成「只读可见」，P0-1 的泄漏面会扩大**，届时 `/u/:handle` 的闸门要跟着改。
