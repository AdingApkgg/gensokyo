# M4 博丽神社 · 前端信息架构 / 页面设计 / i18n

2026-08-30 · 状态：**调研产物，未评审，不得据此改代码**

范围：`apps/web`。数据层与 API 契约只在「前端逼出来的要求」处点名，不代替 schema 设计。

---

## 0. 一页结论

1. **路由 8 条**（含 1 个 layout）。版块进 URL 用 **slug**，主题进 URL 用 **uuid**，两者分别挂在 `/shrine/b/` 与 `/shrine/t/` 命名空间下——前缀不是装饰，它让版块 slug 与主题 id 永不撞车，也让 `/u/:handle` 的保留字表缩到只剩「防冒充」那几个。
2. **建议不建 `board` 表**。版块 slug + 排序放 `packages/shared` 的 const 数组，版块名与说明放 Paraglide。理由见 §5.3——solo 站长没有版块管理后台，DB 里的名字只能用 psql 改，比一次部署更贵。这与 M3 把 `touhou_work`/`convention` 并进 `tag` 是同一条判据。
3. **空态是 /shrine 的主设计，不是兜底**。上线当天最新流真的是空的。设计是：**流为空时页面降级为「版块目录 + 最近资源横排」**，而不是画一个空盒子。版块目录因此在空态下是内容、在有内容时自动消失（`total < 10` 才渲染）——这恰好调和了「版块目录不能当默认视图」与「六个空版块很难看」这对矛盾。
4. **评论区抽成 `app/components/discussion/`**，5 个组件。关键边界：组件**不知道 API 长什么样**，只接收 `action` 路径字符串，两个路由各自实现 `intent=reply`。hono RPC 的类型止步于 loader/action，不进共享组件。
5. **Markdown 用 `react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-sanitize`，渲染成 React 元素，全仓不出现一次针对用户内容的 `dangerouslySetInnerHTML`**。**不装 `rehype-raw`**——这一个「不装」就消掉了整个原始 HTML 攻击面。图片只放站内 MinIO host，外链图降级成链接而不是丢弃。详见 §6。
6. **帖子内容不标语言、不做筛选、不做翻译入口**。唯一要做的是把发帖时的 UI locale 存下来当 `lang=` 属性（一列一属性，零用户摩擦），并且**保证不破坏浏览器自带翻译**。理由见 §7——理由不是「以后再说」，是「做了会更糟」。
7. **新增 message key 约 118 条 × 3 语 ≈ 354 条翻译**，现有文件（207 key）几乎翻倍。相对时间用 `Intl.RelativeTimeFormat` 而不是 Paraglide，省掉约 10 条带复数的 key。
8. **shadcn 要补 8 个**：popover / tooltip / alert / alert-dialog / sonner / pagination / breadcrumb / scroll-area。**不装 `command`**——@ 补全挂在 textarea 上，本来就不是标准 combobox，cmdk 的输入框会跟 textarea 打架。所有组合一律 `asChild`，见 §8 的警告。

---

## 1. 路由表

### 1.1 直接可抄的形状

```ts
// apps/web/app/routes.ts
import { index, layout, prefix, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  ...prefix(':locale?', [
    index('routes/home.tsx'),
    route('ui', 'routes/ui.tsx'),
    route('login', 'routes/login.tsx'),
    route('register', 'routes/register.tsx'),

    route('kourindou', 'routes/kourindou/list.tsx'),
    route('kourindou/upload', 'routes/kourindou/upload.tsx'),
    route('kourindou/:slug', 'routes/kourindou/detail.tsx'),

    // ── M4 新增：博丽神社 ──────────────────────────────────
    // layout 存在的唯一理由是版块导航条要在三个页面复用，
    // 且它的 loader 只取六行常量，不产生额外请求（见 §1.4）
    layout('routes/shrine/layout.tsx', [
      ...prefix('shrine', [
        index('routes/shrine/latest.tsx'),      // 全站最新流 = 默认视图
        route('b/:board', 'routes/shrine/board.tsx'),
        route('t/:id', 'routes/shrine/topic.tsx'),
        route('new', 'routes/shrine/compose.tsx'),
      ]),
    ]),

    // ── M4 新增：跨模块（不属于 /shrine）───────────────────
    route('notifications', 'routes/notifications.tsx'),
    route('u/:handle', 'routes/user/profile.tsx'),
    route('settings', 'routes/settings.tsx'),

    route('chronicle', 'routes/stub.tsx', { id: 'stub-chronicle' }),
    route('spellcard', 'routes/stub.tsx', { id: 'stub-spellcard' }),
    route('music', 'routes/stub.tsx', { id: 'stub-music' }),

    layout('routes/dash/layout.tsx', [
      route('dash', 'routes/dash/queue.tsx'),
      route('dash/reports', 'routes/dash/reports.tsx'),
      route('dash/users', 'routes/dash/users.tsx'),
      route('dash/trash', 'routes/dash/trash.tsx'),
      route('dash/site', 'routes/dash/site.tsx'),
    ]),
  ]),
] satisfies RouteConfig
```

删掉的那行：`route('shrine', 'routes/stub.tsx', { id: 'stub-shrine' })`。连带 `routes/stub.tsx:8` 的 `'/shrine'` 那条映射变成死代码，顺手删。

### 1.2 版块用 slug，主题用 id——为什么不是别的

| 段 | 取值 | 理由 |
|---|---|---|
| `/shrine/b/:board` | **slug**（`tea-house` 等 6 个 ASCII 常量） | 版块是 6 个永久对象，slug 是它们唯一的对外身份。用 id 等于把「站务版」写成一串 uuid，口头传不了、SEO 无信息、且站长自己都记不住 |
| `/shrine/t/:id` | **topic uuid** | 见下 |

主题 id 的三个候选，逐一算账：

- **纯 uuid（推荐）**：`/shrine/t/0193c8...`。丑，但**零协商成本**——`Bun.randomUUIDv7()` 已经是全项目的 id 生成器，`entityIdSchema`/`entityIdParam` 现成，schema 一列不动。标题可改而 URL 恒定这条性质天然成立。
- **Discourse 式 `slug + id`**：`/shrine/t/幻想乡的天气-0193c8...`。它的全部价值是 slug 那段的可读性与 SEO。**本站标题几乎全是 CJK**，slug 段会变成一长串 percent-encoding——比裸 uuid 更难读、粘进 IM 会断行、复制回来还可能被二次编码。要取拼音就得引一个转写库，而日文标题用拼音转写是错的。**这个方案在本站的具体条件下拿不到它的收益，只留下成本。**
- **全局递增序号**：`/shrine/t/1234`。短、可口头传播（「你看 1234 帖」是真实的论坛用法）、跨版块移动不变。代价是一列 `identity` + 一条：**它把主题总数公开了**。上线第二周 `/shrine/t/7` 会告诉每个访客这里总共只有 7 个主题——这正好命中冷启动失败模式 A。

**判断**：M4 用 uuid。序号是纯 additive 升级（加一列 `seq`，让 `/shrine/t/:seq` 也能解析，把规范 URL 换成序号，uuid 链接 301 过去，旧链接不死），等主题数上三位数、"公开总数"不再尴尬时再做。这条列进 §10 的待拍板。

**楼层不进 path，进 query**：`/shrine/t/:id?floor=137#p137`。
理由是 `mined-legacy-comments.md` 的 D2——OFFSET 分页下同一个深链在不同 `pageSize` 下指向不同内容。所以：**pageSize 由服务端定死并在响应里回传，URL 里只出现楼层号**，页码由 `floor` 反算。`?page=` 这个参数在主题页**不存在**。

### 1.3 `kind='resource'` 的主题：301，不 404

`/shrine/t/:id` 的 loader 拿到 topic 后：

```ts
if (topic.kind === 'resource') {
  throw redirect(localizeHref(`/kourindou/${topic.resourceSlug}#discussion`), 301)
}
```

规范 URL 唯一地落在 `/kourindou/:slug`。301 而不是 404，是给「有人手改 URL」和「最新流之外的外部链接」兜底；最新流里那条目本来就直接链资源页，正常路径不经过这里。

`#discussion` 是资源详情页评论区的锚点 id，M4 要给它加上。

### 1.4 `:locale?` 与 `localizeHref` 的三条注意

1. `/u/:handle` 在 `:locale?` 之下不会歧义：路径是 `/:locale?/u/:handle`，`u` 是字面段。`/u/marisa` 与 `/ja/u/marisa` 都能匹配，跟现有 `/kourindou` 同构。
2. **`/u/` 前缀让 handle 保留字表缩水**。`mined-notification.md` 那份保留字表里 `api`/`shrine`/`login`/`new`/`edit` 之类是为了「handle 挂在根路径」准备的；挂到 `/u/` 之下就没有路由碰撞了。保留字只需保留**防冒充与防歧义**那一档：`admin` `moderator` `staff` `system` `official` `gensokyo` `all` `everyone` `here` `me` `anonymous`。
3. 所有站内跳转一律 `localizeHref()`，包括 Markdown 渲染器吐出的 `@提及` 链接与引用块链接（§6.5）——这是最容易漏的一处，因为它不在 JSX 里，在渲染插件里。

### 1.5 为什么通知与个人主页不在 `/shrine` 下

通知包含**审核结果**（来自香霖堂），个人主页聚合**帖子 + 资源 + 收藏**（产品文档原话）。两者都跨模块，放 `/shrine/notifications` 会在语义上撒谎，且以后 chronicle/music 也要往通知里投递时就得搬家——搬家会动已发出的 URL。放顶层，一次到位。

`/settings` 同理：它现在只有一个 handle 字段，但把它叫 `/settings` 而不是 `/settings/handle`，是为了以后加头像/显示名时是**页内 additive**，不是新开路由。

---

## 2. 每个页面的信息架构

统一约定（沿用 M3 已有写法，不发明新的）：

- loader 失败**不抛错**，返回 `{ ..., failed: true as const }`，页面渲染 `m.load_error()`。**失败态与空态必须是两个分支**——`kourindou/list.tsx:133-141` 已是这个形状，照抄。把加载失败画成「还没有内容」是冷启动期最坏的一种错，因为它把一次故障伪装成了「这站是空的」。
- 找不到资源 `throw data(null, { status: 404 })` + 路由级 `ErrorBoundary`（`kourindou/detail.tsx:384` 已有）。
- 写操作走 `action` + `intent` 字段分派（`detail.tsx:61-108` 已有）；无跳转的写（点赞、已读、订阅）用 `useFetcher`。
- api 只回 `{error:{code}}`，前端查表出文案。新增 `app/lib/errors.ts`：

```ts
export const errorLabel = (code: string) => ({
  rate_limited:      m.err_rate_limited(),
  forbidden:         m.err_forbidden(),
  validation_failed: m.err_validation_failed(),
  not_found:         m.err_not_found(),
  link_not_allowed:  m.err_link_not_allowed(),   // 新账号外链
  mention_limit_exceeded: m.err_mention_limit(),
  topic_locked:      m.err_topic_locked(),
  duplicate_slug:    m.err_handle_taken(),        // 复用现有码，见 §2.7
}[code] ?? m.load_error())
```

M3 现在是每个页面各写各的（`upload_failed` / `dash_action_failed` / `admin_config_failed`）。到 8 个论坛错误码时这条散着写会漂移，值得现在收口。

---

### 2.1 `/shrine` —— 全站最新流（默认视图）

**loader**

```
GET /api/shrine/topics?page=1                    // 混合流：board 主题 + 有回复的资源主题
GET /api/kourindou/resources?sort=newest&pageSize=6   // 仅当上一条 total < 10 时才发（空态供血）
```
公告直接从 root loader 已有的 `siteConfig.announcement` 拿（`PUBLIC_CONFIG_KEYS` 已含它，三语 jsonb）——**不需要为公告造一个置顶主题**。

排序：`lastPostAt DESC`。**资源主题只有 `postCount > 0` 时才进流**——一个零评论的资源主题不是「有人在说话」，把它放进「最新」是在稀释这条流唯一的信号。

每行（`TopicRow`）：
```
[封面 32px（仅资源主题）] 标题                            [徽章] 12 回复 · 3 分钟前
                          版块名 / 香霖堂 · 作者 handle              最后回复者
```

**action** 无。

**空态（重点）**

上线当天 `items.length === 0`。设计不是「画个空盒子写『还没有帖子』」，是**整页换一个形态**：

```
┌ 幻想乡的入口 ───────────────────────────────┐
│ 一句 tagline（m.shrine_tagline）             │
├─────────────────────────────────────────────┤
│ 从这里开始                                   │
│ ┌──────────┬──────────┬──────────┐          │
│ │ 幻想乡茶话会│ 弹幕研究所 │ 二创工坊  │  ← 6 张卡，每张：
│ ├──────────┼──────────┼──────────┤     名称 + 一句话说明 + 「发第一帖」
│ │ 音乐堂   │ 河童重工  │ 站务     │        （链到 /shrine/new?board=x）
│ └──────────┴──────────┴──────────┘          │
├─────────────────────────────────────────────┤
│ 或者，去聊聊刚上架的资源                      │
│ [封面][封面][封面][封面][封面][封面]          │  ← 链到 /kourindou/:slug#discussion
└─────────────────────────────────────────────┘
```

三个判断写在这里：

- **版块目录是空态的填充物，不是常态视图。** `mined-forum-mechanics.md` §3.1 的结论「默认视图必须是最新流」和「六个空版块并排展示读到的是『这地方是死的』」并不矛盾——矛盾只存在于把版块目录当**唯一**内容的时候。当它下面还接着「6 个刚上架的资源，点进去就能说话」，读到的就是「这里有东西，只是话题还没开始」。
- **规则用数据自动切换，不做后台开关**：`total < 10` 时在流下面继续渲染版块网格，`>= 10` 自动消失。零配置、零运营动作，且随着内容增长自然退场。
- **「最近资源」横排是「靠资源站供血」这条产品判断在 UI 上的字面实现**。它不是装饰——它是空论坛里唯一一处「点进去马上有内容可读、且有一个输入框可以说话」的入口。

**错误态** `failed` → 居中 `m.load_error()`，**不渲染空态引导**（否则一次 API 抖动会让站长以为帖子全丢了）。

---

### 2.2 `/shrine/b/:board` —— 版块内主题列表

**loader**
```
GET /api/shrine/topics?board=<slug>&page=n
```
先在 loader 里用 `BOARD_SLUGS.includes(params.board)` 挡一道，不在名单里直接 `throw data(null, {status:404})`——省一次往返，且 404 语义由前端和后端各自独立成立（不依赖后端一定会回 404）。

排序 `pinnedAt DESC NULLS LAST, lastPostAt DESC`。置顶行加 `Pin` 图标 + `Badge`。

**action** 无（发帖是独立路由；置顶/锁在主题页做）。

**空态**
```
{版块名}
{版块一句话说明}                     ← 这两条来自 Paraglide，不是数据库
[ 发第一帖 ]                        ← primary button
────────────────────────────────
隔壁在聊什么                         ← 全站最近 3 条，链出去
```
最后那块是关键：**一个空版块不能是死路**。没有它，用户进了空版块只能按后退键，而按后退键的人不会再进第二个版块。

**错误态** 未知 slug → `ErrorBoundary`，「没有这个版块」+ 回 `/shrine` 的链接。加载失败 → `m.load_error()`。

---

### 2.3 `/shrine/t/:id` —— 主题详情（楼层）

**loader**
```
GET /api/shrine/topics/:id          → topic 元信息 + opening(floor 1) + viewer 上下文
   若 kind === 'resource' → throw redirect(301) 见 §1.3
   若 deletedAt !== null 且 viewer 非 staff → 404
GET /api/shrine/topics/:id/posts?floor=<n>   → 该楼层所在那一页
```

`GET /topics/:id` **必须返回 opening post**，因为第 2 页往后 floor 1 不在列表里，而主题正文要在每一页都可见（NGA/贴吧行为）。这是前端逼出来的一条 API 形状要求。

`viewer` 一并塞进 topic 响应，省一次往返：
```ts
viewer: { subscription: 'watching' | 'muted' | null, canModerate: boolean }
```

**页面结构**

```
神社 › 幻想乡茶话会 › 主题标题                    ← Breadcrumb
标题                        [置顶] [已锁]
作者 chip · 发布时间 · 12 回复 · [订阅中 ▾] [举报]
────────────────────────────────────────────
▣ 主楼（opening，视觉更重：更大字号、无楼层号）
────────────────────────────────────────────
#2  作者 chip [版主]  · 3 分钟前 (已编辑)
    ┌ 引用 #1 ⟨作者⟩：截断的纯文本…              ← 现查，不是快照
    正文（Markdown）
    ♡ 3   回复   引用   ⋯（举报 / 删除）
#3  …
────────────────────────────────────────────
[ ‹ 1 2 3 › ]  跳转到第 [___] 楼               ← 楼层区间分页
────────────────────────────────────────────
[ 回复编辑器 ]  或  [ 主题已锁定 · 说明 ]  或  [ 登录后可回复 ]
```

**action（一个 action，intent 分派）**

| intent | 方式 | 说明 |
|---|---|---|
| `reply` | `Form method=post` | 成功后 `redirect` 到新楼层锚点 `?floor=N#pN`。**不要用 fetcher**——回复要滚到新楼层，那是导航 |
| `like` | `useFetcher` | 乐观更新计数；失败回滚 + toast |
| `subscribe` | `useFetcher` | `PUT .../subscription {state}` |
| `delete-post` | `useFetcher` + AlertDialog | 二次确认。staff 删他人楼层时必须带理由字段（后端要写 `moderationLog`，见 `mined-reusable.md` P0-2） |
| `report-post` | Dialog + Form | 理由 Select（**按 `targetKind='post'` 过滤选项**，见 §2.9） |
| `lock` / `pin` | `useFetcher`，仅 staff | |

**锁定态**：编辑器**替换**成一条 `Alert`（「主题已锁定」+ 原因类别），**不隐藏**。隐藏输入框会让用户以为页面坏了或自己被封了。资源下架导致的自动锁要说清楚是资源下架（`m.topic_locked_resource`）而不是「你被禁言」。

**已删楼层**：保留占位，显示 `m.detail_deleted()`（现有 key），`bodyMd` 后端已置空。引用一个已删楼层时引用块显示 `m.quote_deleted()`。这是「引用现查」方案的正回报——一次软删就让内容从所有引用里消失。

**空态** 不存在：主题永远至少有 floor 1。唯一的边界是 floor 1 被 staff 软删——那时主楼位置渲染「该楼层已删除」，主题应当同时被锁（后端行为，此处只需正确渲染）。

**错误态** 404 → `ErrorBoundary`「找不到这个主题」+ 回版块的链接。回复失败 → 内联 `errorLabel(code)`，**草稿不清**（§2.4）。

---

### 2.4 `/shrine/new` —— 发主题

**loader**
- 未登录 → `throw redirect(localizeHref('/login?next=' + encodeURIComponent(pathname + search)))`。
  ⚠️ `routes/login.tsx` 现在**不支持 `?next=`**，登录后固定回首页。空论坛里最重要的 CTA 是「发第一帖」，把人踢回首页等于丢掉这个首帖。**这是 M4 必须顺手改的一处既有路由。**
- 已登录但 `handle` 为空 → `throw redirect('/settings?reason=handle')`（见 §2.7）。
- 返回 `{ boards: BOARD_SLUGS, defaultBoard: url.searchParams.get('board') }`。

**action**
```
POST /api/shrine/topics  { boardSlug, title, bodyMd }
  201 → throw redirect(localizeHref(`/shrine/t/${id}`))
  4xx → return { ok:false, code, fields }
```

**表单**
| 字段 | 控件 | 备注 |
|---|---|---|
| 版块 | `Select` | 默认值来自 `?board=`；6 项 |
| 标题 | `Input` maxLength=200 | 对应 `topic.title varchar(200)` |
| 正文 | `PostComposer`（§4） | 写 / 预览两个 `Tabs`，工具条：图片、表情、@ |

**草稿（localStorage）**
键：`shrine:draft:new:<board|'_'>`，回帖是 `shrine:draft:t:<topicId>`。挂载时若有草稿，顶部出一条 `Alert`：「恢复了未发送的草稿 [丢弃]」。提交成功后清除。
理由（`mined-forum-mechanics.md` §3.14）：服务端草稿的价值是跨设备续写，冷启动没有重度用户；而「刷新一下内容没了」是**每个第一次发帖的人都可能撞上的**，代价是丢掉一个首帖。纯前端几十行。
⚠️ localStorage 在 SSR 不存在，读取必须在 `useEffect` 里，且整段包 `try/catch`（隐私模式会抛）。

**空态** 不适用。

**错误态**
- `rate_limited` → 「发得太快了，等一会儿再试」。**不显示倒计时**（要后端回 retry-after，YAGNI）。
- `link_not_allowed`（新账号外链）→ 文案必须说清**为什么**和**怎么办**：「新账号暂时不能发外部链接。先在站里聊几句，或者去掉链接再发。」这是最容易把新用户一次性赶走的错误，一句敷衍的 `validation_failed` 会直接损失掉这个人。
- `validation_failed` + `fields` → 高亮对应字段。
- 任何失败**都不清空表单**，且草稿仍在 localStorage。

---

### 2.5 `/notifications` —— 通知中心

**loader** `GET /api/notifications?page&unread=`（`unread` 用显式 `z.enum(['true','false'])`，不用 `z.coerce.boolean()`——它对字符串 `"false"` 得到 `true`）。

**Tabs（走 URL，不走组件 state）**：`全部` / `未读`，staff 多一个 `站务`。
staff 的 `mod_queue` 通知（「7 件待审」）与个人通知混在一起，会让站长的收件箱永远被站务刷屏，也让「未读红点」失去个人语义。分 tab 的成本是一个 query 参数。

**行渲染**：**句子在前端组装，payload 只有 kind / id / count**。
```tsx
{ reply:        () => m.notif_reply({ actor, title }),
  reply_multi:  () => m.notif_reply_multi({ actor, count, title }),   // collapse 折叠后的形态
  mention:      () => m.notif_mention({ actor, title }),
  moderation_reject: () => m.notif_moderation_reject({ title, reason: rejectLabel(r) }),
  … }[n.kind]()
```
人名与标题**join 出来，不快照**——快照会让对方改名后收件箱里还是旧名字。（`mined-notification.md` §8.4）

**action**
- `mark-read`（fetcher，行级点击时静默触发）
- `mark-all-read`（按钮，传 `before` 游标而不是 `all:true`——避免把读页面时刚到的新通知一起标掉）

**空态**
```
还没有通知
通知会在这些时候出现：有人回复你的帖子 · 有人 @ 你 ·
你订阅的主题有新回复 · 你的投稿有审核结果
```
**必须写这四句。** 一个永远空的收件箱如果不解释自己，用户学会的是「这里没东西，不用看」——等到真有通知那天他也不会看。这是空态里唯一一个「解释比安慰更重要」的页面。

**未读徽章：零成本**
`root.tsx` 的 loader 已经在调 `GET /api/me`。让它多回一个 `unreadCount`，`SiteHeader` 上的铃铛徽章就白得——**不新增请求、不做客户端轮询**，并且 React Router 在每次导航后自然 revalidate root loader，刷新时机恰好正确。计数在 100 处截断显示 `99+`。

---

### 2.6 `/u/:handle` —— 个人主页

**loader**
```
GET /api/users/:handle             → { handle, name, avatarUrl, role, joinedAt, counts:{posts,resources,favorites} }
GET /api/users/:handle/<tab>?page  → tab ∈ posts | resources | favorites
```
tab 走 URL query（`?tab=resources`），与 `kourindou/list.tsx` 的筛选器同一套心智：可分享、可后退、SSR 直出。

**头部**：`Avatar` + 显示名 + `@handle`（等宽、可点击复制）+ 角色徽章（版主/站长）+ 加入时间。
**不显示等级、勋章、发帖数排名**——`mined-forum-mechanics.md` §5.5，游戏化在 0 帖时只能显示「Lv.0」。`counts` 只用来给 tab 标数字。

**收藏 tab 的可见性判断**：**M4 只对本人可见**（服务端按 viewer 判，不是前端隐藏）。收藏在 M3 从没有任何公开出口，把它默认公开是一个**已经发生的泄露**，而反过来「以后开放」是 additive。默认收紧。

**空态** 每个 tab 各一条：「还没有发过帖」/「还没有投稿」/「还没有收藏」。本人视角时附一个行动链接（去发帖 / 去投稿 / 去逛香霖堂）。

**错误态** 未知 handle → 404 `ErrorBoundary`「没有这个用户」。注意**已被站长改掉 handle 的旧链接会落到这里**，这是期望行为（`mined-notification.md` §4.2 c 方案），文案不要写成「用户已注销」。

---

### 2.7 `/settings` —— handle 设置（M4 只有这一件事）

**loader** 未登录 → redirect `/login?next=/settings`。返回 `{ handle, handleLocked }`。

**action** `PATCH /api/me/handle { handle }`。

**UI**
```
用户名（handle）
[ @ ][ marisa____________ ]  ← 前缀不可编辑，输入框只收 [a-z0-9_]
你的主页地址会是 /u/marisa，别人用 @marisa 提到你。
⚠ 设定后不能自己修改（需要联系站长）。         ← 必须在提交前说，不能在提交后说
[ 保存 ]
```
`handleLocked === true` 时字段只读 + 说明「如需修改请联系站长」。

**错误码复用**：handle 被占用直接用现有的 `duplicate_slug`，在这个页面映射成「这个名字已经有人用了」。这正是「api 返回 code、前端按页给文案」这条约定该起作用的地方——**不新增错误码**。格式非法用 `validation_failed` + `fields:['handle']`。

**`?reason=handle`**：从发帖页被拦过来时，顶部加一条 `Alert` 说明「发帖前需要先定一个用户名」，保存成功后 `redirect` 回 `next`。

---

### 2.8 `/kourindou/:slug` 的改动

1. 评论区整块换成 `<Discussion>`（§3），并给它一个 `id="discussion"` 的容器——这是 §1.3 那个 301 的落点。
2. **一个现存的伪装故障**：`detail.tsx:51-56` 把 posts 端点的 404 吞成 `posts: []`。对已下架资源（staff 仍可看页面），评论区现在渲染成「还没有人评论」——但真相是「讨论已锁定」。改成区分 `failed` / `locked` / `empty` 三态。
3. 评分表单、AdminZone 不动。

---

### 2.9 `/dash/reports` 的改动（举报队列接入帖子）

- 理由 Select 的选项要按 `targetKind` 过滤：`broken_link` / `wrong_info` 对帖子无意义，`spam` / `harassment` 对资源基本无意义。**枚举保持一份**（`mined-reusable.md` 已论证不要拆 `POST_REPORT_REASON`），过滤发生在前端的举报表单里。
- 队列卡片现在把 `targetId` 当等宽 uuid 渲染（`dash/reports.tsx:104,109-111`），没有任何跳转。帖子举报进来后这会让队列直接失效——**审核员看到一串 uuid 无法判断**。需要 api 端 LEFT JOIN 出目标上下文（`mined-reusable.md` P1-4），前端渲染成「标题 + 楼层 + 跳转链接」。
- 「urgent 优先」现在是前端 `sort`（`reports.tsx:77-81`），**只对当前页有效**。帖子举报量上来后第 2 页开始排序是错的。挪到 api 的 `orderBy`。

---

## 3. 组件边界：一份数据，两个视图

### 3.1 要不要从 `detail.tsx` 抽出来——要，但抽的边界是关键

现状：`detail.tsx:255-332` 内联了「评分 + 编辑器 + 楼层列表」三件事，共约 78 行。直接搬到 `/shrine/t/:id` 会立刻分叉，因为两边的 API 路径不同（`/api/kourindou/resources/:slug/posts` vs `/api/shrine/topics/:id/posts`）。

**核心边界判断：组件不知道 API 长什么样。**

组件收一个 `action: string`（React Router 的路由路径），提交时 `fetcher.submit(data, { method:'post', action })`，由**各自的路由** action 去调自己的 hono RPC 端点。理由：

- hono 的 RPC 类型推导（`AppType`/`hc`）只在 loader/action 里有意义，它推不进一个被两个不同端点复用的展示组件。硬要推就得给组件加一层泛型，那是把类型主轴掰弯去迁就组件复用。
- 两边的权限闸门不同且**必须不同**：资源侧是 `publishedTopic()` 白名单（`content/index.ts:19-33`），论坛侧要查 `topic.deletedAt IS NULL AND lockedAt IS NULL`。把闸门收进共享组件等于让前端替后端把关——`mined-legacy-comments.md` N3 记录的正是这类「分层边界没有编译器保护必然漂移」。

### 3.2 目录与签名

放 `app/components/discussion/`。**不要放 `app/components/ui/`**——那目录归 shadcn 管，`bunx shadcn add` 会覆盖。

```ts
// app/components/discussion/types.ts
export type ViewerCtx = {
  id: string
  handle: string
  role: 'user' | 'moderator' | 'admin'
} | null

export type PostView = {
  id: string
  floor: number
  bodyMd: string
  deleted: boolean
  createdAt: string
  updatedAt: string
  /** 发帖时作者的 UI 语言，只用于 lang= 属性，见 §7 */
  locale: 'zh' | 'ja' | 'en' | null
  likeCount: number
  likedByViewer: boolean
  author: {
    id: string; name: string; handle: string
    avatarUrl: string | null
    role: 'user' | 'moderator' | 'admin'
  } | null
  /** 引用「现查」的结果，服务端已解析成纯文本摘要 */
  quoted: { floor: number; authorName: string; excerpt: string; deleted: boolean } | null
  /** 已解析存在的 handle，渲染器据此决定 @xxx 是否成链接（§6.5） */
  mentions: string[]
}
```

```tsx
// 五个组件
<Discussion              // 组合体，给两个页面的默认用法
  posts={PostView[]}
  opening={PostView | null}      // 版块主题 = floor 1；资源评论区 = null
  viewer={ViewerCtx}
  action={string}                 // '.' 或 '/shrine/t/xxx'
  state={'open' | 'locked' | 'failed'}
  lockedReason={'resource_delisted' | 'staff' | undefined}
  emptyLabel={string}
  pager={{ floor:number; pageSize:number; total:number } | null}
/>

<PostList posts viewer action />
<PostItem post viewer action variant={'opening' | 'floor'} />
<PostComposer action viewer draftKey placeholder replyTo={PostView|null} />
<MarkdownBody md locale mentions />     // 唯一一处渲染用户内容的地方
```

`<Discussion>` 是给调用方的便利壳；单独导出零件是因为主题页要把主楼与列表分开摆（主楼在分页第 2 页仍要出现）。

调用方长这样：

```tsx
// kourindou/detail.tsx
<section id="discussion">
  <Discussion posts={posts} opening={null} viewer={user} action="."
    state={resource.status === 'published' ? 'open' : 'locked'}
    lockedReason="resource_delisted"
    emptyLabel={m.detail_no_comments()} pager={pager} />
</section>

// shrine/topic.tsx
<PostItem post={opening} viewer={user} action="." variant="opening" />
<PostList posts={posts} viewer={user} action="." />
<PostComposer action="." viewer={user} draftKey={`shrine:draft:t:${topic.id}`} />
```

### 3.3 这个抽取逼出的两条 API 要求

1. **`content/post.ts:listPosts` 的 select 投影必须变宽**：现在只有 `{id, name}`（`post.ts:26-27`），共享组件需要 `handle` / `avatarUrl` / `role` / `likeCount` / `likedByViewer` / `quoted` / `mentions`。好消息是这个改动**一次落到两个视图**——这正是「一套内容系统」该有的性质。
2. **`GET /topics/:id` 必须单独返回 opening post**（§2.3）。

### 3.4 明确不共享的三样

| 不共享 | 理由 |
|---|---|
| 权限判断 | 见 §3.1 |
| 评分（`intent=rate`） | 资源独有，论坛主题不评分。留在 `detail.tsx` |
| 标题/面包屑/置顶锁定条 | 两边语义不同（资源有 license/版本，主题有版块/置顶），强行统一会造出一堆条件分支 |

---

## 4. `PostComposer` 的构成

```
┌ [写] [预览] ──────────────────────── @ 🖼 😀 ┐   ← Tabs + 工具条
│ <Textarea rows=6 …>                          │
│                                              │
├──────────────────────────────────────────────┤
│ 支持 Markdown · 图片 ≤5MB          [ 回复 ]  │
└──────────────────────────────────────────────┘
```

- **预览 tab 用同一个 `<MarkdownBody>`**——这不只是省代码，它保证作者**发之前就看到净化后的结果**，不会出现「我写的 `<script>` 怎么没了」这类事后困惑。
- **图片**：复用 `upload.tsx:125-143` 的 `CoverPicker` 上传逻辑（`POST /api/uploads/image` multipart），成功后在光标处插入 `![](url)`。
  ⚠️ 需要新的 `purpose='post'`（现在只认 `avatar`|`cover`，`uploads.ts:24`）。理由不只是分目录：`gc-images.ts` 的白名单巡检要能按前缀区分「帖子图」，否则第一次跑 `gc:images` 就会删光帖子插图（`mined-reusable.md` P0-1，**不改必炸**）。
- **表情**：`Popover` + 网格按钮，插入 `:reimu_smug:`。
- **@ 补全**：见 §6.5 与 §8.2。
- **提交中禁用**：`useNavigation().state === 'submitting'`（`detail.tsx:291` 已有写法）。

---

## 5. Markdown 渲染

### 5.0 现状确认

`detail.tsx:323-327`：
```tsx
<p className={`mt-1 whitespace-pre-wrap ...`}>
  {p.deleted ? m.detail_deleted() : p.bodyMd}
</p>
```
纯文本，`whitespace-pre-wrap`。资源简介同样（`detail.tsx:190-194`）。**全站目前对用户内容的 XSS 面为零，因为从来没有渲染过 HTML。M4 加渲染器的那一刻打开这个面。**

### 5.1 选型

**`react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-sanitize`**，外加两个自写插件（表情、提及）。

选它而不是 `marked`/`markdown-it` + `DOMPurify`/`sanitize-html` 的**结构性理由**：

| | 字符串 HTML 方案 | react-markdown（unified）方案 |
|---|---|---|
| 产物 | HTML 字符串 → 必须 `dangerouslySetInnerHTML` | React 元素树，**永不产生 HTML 字符串** |
| 净化时机 | 渲染后清洗字符串（黑名单心智容易滑进来） | AST 层白名单（`hast-util-sanitize`） |
| SSR | `DOMPurify` 服务端要 `jsdom` | 同构，零额外依赖 |
| 扩展点 | 字符串替换（表情/@ 会误伤代码块与链接文本） | AST 上只访问 `text` 节点，**天然不进代码块** |

第一行是决定性的：只要方案里出现 `dangerouslySetInnerHTML`，安全性就变成「净化器有没有漏」这个持续赌局；react-markdown 方案里**那行代码根本不存在**，漏洞需要先有人主动加一个依赖才可能出现。

**代价要说清楚**：`react-markdown` + `remark-parse` + `remark-gfm` + `rehype-sanitize` 约 **55–60 KB gzip** 进客户端 bundle。SSR 出的是 HTML，但 hydration 需要同一棵树，所以解析器省不掉（这里没有 RSC）。可以砍 `remark-gfm`（省 ~15KB，代价是表格、删除线、自动链接全没）——**不砍**：河童重工要表格，自动链接是所有人的肌肉记忆。

### 5.2 绝对不要装 `rehype-raw`

`react-markdown` 默认**不解析源文里的原始 HTML**（它被当作文本转义输出）。要解析必须显式加 `rehype-raw`。

**这一个「不装」消掉的是整个原始 HTML 攻击面**：`<img onerror>`、`<svg><script>`、`<iframe>`、`<form>`、`<style>` 注入、DOM clobbering 的一大半、mXSS（净化器与浏览器解析器不一致导致的变异）。

写进代码注释和 review checklist：**任何 PR 里出现 `rehype-raw` 都是安全事故。**

### 5.3 净化 schema（白名单，不是黑名单）

即便不装 `rehype-raw`，仍然要上 `rehype-sanitize`——因为**我们自己的插件会在解析后往树里插节点**（表情插 `img`、提及插 `a`），插错了就是自己给自己开洞。净化跑在所有插件之后，是最后一道。

```ts
// app/lib/markdown.ts —— 草案
import { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeOptions } from 'rehype-sanitize'

export const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'hr',
    'h3', 'h4', 'h5', 'h6',                 // h1/h2 见下
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  attributes: {
    // 注意：rel / target 故意不在白名单里 —— 它们由 components.a 无条件设置，
    // 作者写什么都不算数（写了会被这里丢掉）
    a: ['href'],
    img: ['src', 'alt', 'width', 'height', ['className', 'th-emoji']],
    td: ['colSpan', 'rowSpan'], th: ['colSpan', 'rowSpan'],
    '*': [],                                 // 其余标签一个属性都不带
  },
  protocols: { href: ['http', 'https', 'mailto'] },
  clobberPrefix: 'ugc-',                     // 防 DOM clobbering
  strip: ['script', 'style'],
  allowComments: false,
  allowDoctypes: false,
}
```

逐条理由：

- **`id` 一律不允许**（`'*': []` 覆盖）。用户内容里的 `id` 会跟页面自身的锚点撞车（我们的 `#discussion`、`#p137` 就在同一个文档里），也是 DOM clobbering 的入口。
- **`h1`/`h2` 不进白名单**，但**不能直接丢弃**（内容会消失）。加一个极小的 rehype 插件在净化**之前**把 `h1`/`h2` 降级成 `h3`：既保住可访问性大纲（页面 h1 是主题标题），又不吃掉正文。
- **`className` 只允许我们自己插的那几个固定值**（`['className','th-emoji']` 语法 = 只有取这个值才放行）。开放 `className` 等于把 Tailwind 全部工具类交给用户，包括 `fixed inset-0 z-50` 这种可以做出全屏钓鱼覆盖层的组合。**这是纯 CSS 就能做出的 UI 欺骗，比 XSS 更容易被忽略。**
- **`protocols.href` 只放 http/https/mailto**。`hast-util-sanitize` 的协议判定会处理 `java\tscript:` 之类的插入字符，比自己写正则可靠。M3 的 `safeUrl()`（`schemas.ts`）是同一套心智，那边是写入时、这边是渲染时，**两边都要有**。
- **代码高亮 M4 不做**。`<pre><code>` + 等宽字体足够。高亮器是一个大依赖，且有些实现会吐 HTML 字符串——那正好把 §5.1 的结构性保证给破坏掉。additive，以后再说。

### 5.4 图片：只放站内 MinIO，外链降级成链接

`rehype-sanitize` 的 `protocols` 表达不了 host 白名单。所以再写一个插件，跑在净化**之前**：

```ts
// rehypeImagePolicy：src 的 host ≠ 站内图床 → 把 <img> 换成 <a>（保留 URL 文本）
```

- **降级成链接而不是丢弃**：内容不丢，用户看得见原本链的是什么，而浏览器**不会向第三方发出请求**。丢弃会让作者以为「站坏了」。
- 为什么禁外链图（`mined-forum-mechanics.md` §3.10）：外链图把每个读者的 IP + Referer 泄露给第三方、随时失效、且**发帖后可以被悄悄换成别的图**（换成违法内容时留痕在我们站上）。这三条里第三条是治理级别的。
- **图床 host 从哪来**：API 的 `S3_PUBLIC_BASE_URL`。**不要**在 web 侧再定义一个 `VITE_IMAGE_HOST`（会与后端漂移，且改桶要重新构建前端）。做法：root loader 多回一个 `imageHost`，用一个 `MarkdownConfigProvider` 挂在 `root.tsx` 里，`MarkdownBody` 从 context 读。
- 渲染出的 `<img>`：`loading="lazy" decoding="async"`，CSS `max-height: 24rem; max-width: 100%`，外面套 `<a href={src} target="_blank">` 让点击看原图（同源，安全）。

### 5.5 链接的三条渲染规则

`components.a` 覆盖（跑在净化之后，作者无法影响）：

```tsx
a: ({ href, children }) => {
  // ⚠️ 协议相对 URL：'//evil.com' 在 hast-util-sanitize 眼里没有 ':'，
  //    被当作相对路径放行。判「站内」时必须显式排除 '//' 开头。
  const internal = href?.startsWith('/') && !href.startsWith('//')
  return internal
    ? <Link to={localizeHref(href!)}>{children}</Link>
    : <a href={href} rel="nofollow ugc noreferrer noopener" target="_blank">{children}</a>
}
```

1. **站内链接走 React Router `<Link>`**（客户端导航 + `localizeHref` 保住语言前缀）。`@提及` 与引用块的跳转都走这条。
2. **站外一律 `rel="nofollow ugc noreferrer noopener" target="_blank"`**。`nofollow ugc` 直接掐掉 SEO 垃圾的收益——它和「新账号禁外链」是同一条防线的两半：一半让 spam 发不出来，一半让发出来的 spam 一文不值。
3. **`//evil.com` 这个坑要写进注释**。它是本节唯一一个「看起来对、跑起来错」的地方：不排除 `//`，一个外站链接会被当成站内路由，`<Link to="//evil.com">` 会真的跳出去，而且带着 Referer、没有 `noopener`。

（链接文本伪装 `[https://gensokyo.example](https://evil.com)` 无法根治——所有论坛都有这个问题。M4 不做额外处理，`target=_blank` + 浏览器地址栏是现有防线。以后可考虑外链前加一个 ↗ 图标。）

### 5.6 东方表情

- **固定 shortcode 表**，静态资源放 `apps/web/public/emoji/*.webp`。放 web 的 public 而不是 MinIO：它们是应用资产不是 UGC，且这样天然不进 `gc-images.ts` 的视野。
- **remark 插件只访问 `text` 节点**：mdast 里 `inlineCode`/`code` 的内容在 `value` 字段而不是 `text` 子节点，所以「只处理 text 节点」这一条**自动**保证了代码块里的 `:reimu:` 不被替换——不需要额外判断。这是选 AST 方案的具体回报。
- 正则 `/:([a-z0-9_+-]{2,32}):/g`，且**只有名字在静态表里才替换**。
- 产物：`<img class="th-emoji" alt=":reimu_smug:" width=20 height=20 loading="lazy">`。`alt` 保留 shortcode——截图/复制/读屏都还原成人类可读的东西。
- **未知 shortcode 渲染成字面文本，不是破图。** 这条让「以后下线某个表情」的代价从「旧帖里一堆破图」降到「旧帖里一段文字」。
- ⚠️ **shortcode 词表在不可逆那一档**：它会被写进已发布的正文。改名 `:reimu_smug:` → `:reimu_smirk:` 就是改写历史正文。建议一次定好，用「角色_表情」的命名保证命名空间不撞。
- **不做**：用户上传表情、表情管理后台、表情市场（`mined-forum-mechanics.md` §3.18）。

### 5.7 @提及的渲染

- **抽取正则从 `packages/shared` 导入，不在 web 侧重写一遍**。`mined-notification.md` §4.3 的理由是硬的：发通知的一端和渲染链接的一端逐字不一致，用户就会「收到提及但帖子里没链接」或者反过来。这是「类型主轴 = 单一事实来源」在文本上的应用。
- **渲染器不能查库**，所以 `PostView.mentions` 由 API 提供：服务端对该页楼层的正文跑一次抽取，`WHERE handle = ANY(...)` 查一次存在性，把**存在的** handle 数组挂到每条 post 上。前端插件只对 `mentions` 里有的 handle 成链接，其余渲染成纯文本。
  - 这直接兑现了「handle 被站长改掉后旧帖里的 `@oldhandle` 渲染成纯文本，这是期望行为」。
  - 也避免了往 404 页面发链接（对 SEO 和用户都是负分）。
- 产物：`<Link to={localizeHref('/u/'+handle)} class="mention">@handle</Link>`。

### 5.8 CSP（应该做，但不在 M4 前端范围内，必须点名）

上面所有措施的最后一道背板是 `Content-Security-Policy`（`script-src` 不含 `unsafe-inline`）。
**当前障碍**：`root.tsx:53-54` 为了防主题闪烁注入了一段内联 `<script>`。上 CSP 需要给它一个 nonce 或 hash。这是一条真实的、已知的、可解的债，**M4 不做但要记下来**——不要在文档里假装现在有 CSP。

---

## 6. i18n

### 6.1 UI 三语：例行公事

`m.key()`，不写裸字符串；`localizeHref()` 包所有站内跳转（**包括 Markdown 渲染器吐出的链接**，§5.5/§5.7）。

### 6.2 用户发的帖子是单语的——判断

问题：一个日本人用日文发的帖，中文用户点进来看到什么？

四个选项，逐个算账：

| 方案 | 判断 | 理由 |
|---|---|---|
| 按语言分版块 / 分区 | **永远不做**（至少 M4 不做） | 这是所有多语论坛的终局，但它把一个 0 帖的社区切成三个 0 帖的社区。冷启动失败模式 A × 3。以后加一个语言版块是一行常量，additive |
| 自动检测语言 + 标语言徽章 | **不做** | 短回复上检测极不可靠：「ありがとう」可检，「www」「Reimu best girl」「引用占一半的帖子」不可检；zh/ja 之间纯汉字文本几乎必错。**一个标错的语言徽章比没有徽章更糟**——它会误导读者，还会让「翻译」按钮往错方向翻 |
| 发帖时让作者选语言 | **不做** | 在冷启动期最重要的动作（发第一帖）上加一个必填字段。回帖尤其不能加 |
| 站内机器翻译入口 | **不做** | 见下 |

**为什么不做翻译入口**（这条要说透，因为它看起来像「面向全球」的标配）：

1. **浏览器自带的翻译更好**：Chrome/Edge/Safari 的整页翻译免费、按读者意愿触发、质量不比我们接的任何 API 差，而且不是我们的延迟、成本、配额、故障。
2. **一个「翻译」按钮是一次质量承诺**。这是版权敏感的同人站——如果我们的翻译把一句关于「社团允许再分发」的日文说反了，那不是体验问题，是踩生死线。
3. 一个翻译 API 意味着密钥、账单、限流、缓存表、滥用防护。冷启动期收益 ≈ 0。

**所以 M4 该做的是「不要挡住浏览器翻译」**，而这有具体动作：
- 帖子正文必须是**真实 DOM 文本**（`MarkdownBody` 渲染 React 元素，天然满足；如果当初选了 canvas/图片或者把文本塞进 `title` 属性就不满足了）。
- **不要**在任何用户内容上写 `translate="no"`。
- 尽量给正文一个**尽量正确的 `lang`**。

### 6.3 唯一要做的一件事：`post.locale`

被浪费掉的免费信号：**用户发帖时正在用哪个 UI 语言**。他在 `/ja/shrine/new` 上发的帖，是日文的先验概率远高于任何文本检测。

- 存：`post.locale varchar(5)`，写入时取请求 locale。一列，库是空的，零成本。
- 用：**只用在 `<div lang={post.locale ?? ''}>` 这一个属性上**，绝不做徽章、绝不做筛选。
- 收益：
  - CJK **字形选择**。同一个 Unicode 码位在 `lang="zh-CN"` 与 `lang="ja"` 下浏览器会选不同字形（`直`、`骨`、`今` 等一大批）。日文帖挂在 `lang="zh-CN"` 的文档里会被渲染成中文字形——**这是一个今天就会发生、且看得见的显示错误**。
  - 读屏软件用正确的语音合成。
  - 浏览器翻译的检测起点更准。
- 猜错时的代价：一个中国人用日文发帖会被标成 `zh`，结果是字形不理想。**可接受，且严格优于现状**（现状是全站都继承 `zh-CN`）。
- 猜不到时（旧数据/null）：`lang=""`，HTML 规范里表示「语言未知」——比断言一个错的值诚实。

**这条是「面向全球」在论坛上的具体形态**：不是给用户加功能，是不让基础设施对他们说谎。

### 6.4 版块名与说明：Paraglide，不是数据库

`mined-forum-mechanics.md` §3.1 建议建 `board` 表，理由是「改名/加版块要动代码部署」。这条在本项目的具体条件下**不成立**：

- 建了表，但**没有版块管理后台**（M4 不做，也不该做）。于是改版块名的实际操作是 **psql 手改 jsonb**——比 `git push` 更慢、更容易错、且没有 review。
- 六个版块 × {名, 说明} × 3 语 = 36 条字符串。放 Paraglide：跟其余 UI 文案一起翻译、有类型、能 tree-shake、改动走同一条 review 流水线。
- M3 的先例正好是这个判据：`touhou_work` / `convention` 两张表被并进 `tag`，理由是「M3 对它们的全部操作与 tag 完全同构」。这里同理——**M4 对版块的全部操作是「按它筛选 + 显示多语名」**。

**结论：不建 `board` 表。**

```ts
// packages/shared/src/shrine/boards.ts
export const BOARD_SLUGS = [
  'tea-house',    // 幻想乡茶话会（综合）
  'danmaku',      // 弹幕研究所（原作 STG）
  'workshop',     // 二创工坊
  'music-hall',   // 音乐堂
  'kappa',        // 河童重工（技术）
  'meta',         // 站务
] as const
export type BoardSlug = (typeof BOARD_SLUGS)[number]
```

```ts
// apps/web/app/lib/display.ts —— 与 kindLabel / licenseLabel / mirrorLabel 同形
export const boardLabel = (b: BoardSlug) => ({
  'tea-house': m.board_tea_house(), 'danmaku': m.board_danmaku(),
  'workshop': m.board_workshop(),   'music-hall': m.board_music_hall(),
  'kappa': m.board_kappa(),         'meta': m.board_meta(),
})[b]
export const boardDesc = (b: BoardSlug) => ({ /* 同形 */ })[b]
```

`topic.boardSlug` 已经是 `varchar(32)` 且无外键，正好接得上；API 侧用 `z.enum(BOARD_SLUGS)` 校验。
排序 = 数组顺序。加版块 = 一个数组元素 + 6 条 message key + 2 个 map 条目，**零迁移**。
唯一的代价：以后要做「用户自建版块」就得建表。那件事已经在 §4.1（子版块）一起被推迟了。

顺带：slug 用 ASCII 是因为它**对 ja/en 用户也是 URL**。`/shrine/b/幻想乡茶话会` 在浏览器地址栏和 IM 里都会变成 percent-encoding。

### 6.5 需要新增多少 message key

| 分组 | 条数 | 备注 |
|---|---:|---|
| 神社外壳 / 导航 | 5 | `shrine_title` `shrine_tagline` `shrine_latest` `nav_notifications` `shrine_start_here` |
| 版块名 + 说明 | 12 | 6 × 2，§6.4 |
| 列表 / 最新流 / 空态 | 14 | 含 `shrine_empty*` `board_empty*` `shrine_elsewhere` `shrine_recent_resources` `topic_from_resource` `topic_pinned` `topic_locked` … |
| 主题详情 | 21 | 回复/引用/点赞/举报/删除/订阅/锁/置顶/已编辑/跳楼层/版主徽章… |
| 发帖与编辑器 | 16 | 含草稿恢复、预览、图片、表情、@ 提示、Markdown 说明 |
| 错误码文案（新增） | 8 | `err_rate_limited` `err_link_not_allowed` `err_mention_limit` `err_topic_locked` `err_word_blocked` `err_duplicate_post` `err_handle_taken` `err_handle_invalid` |
| 通知中心 | 20 | 7 条外壳 + 13 条事件文案（`mined-notification.md` §8.4 已列全） |
| 个人主页 | 9 | 三个 tab × (标题 + 空态) + 加入时间 + 未找到 |
| 设置 / handle | 7 | |
| 举报理由新增 | 2 | `report_reason_spam` `report_reason_harassment` |
| 杂项 | 4 | 表情面板、Markdown 帮助、复制链接、面包屑根 |
| **合计** | **≈ 118** | **× 3 语 ≈ 354 条翻译** |

现有 `zh.json` 是 207 个 key，**M4 让文案量差不多翻倍**。

两条实操建议：
- **相对时间不要用 message key。** 「3 分钟前 / 3分前 / 3 minutes ago」用 `Intl.RelativeTimeFormat(getLocale())` 一行搞定，含各语言的复数规则，**省掉约 10 条带复数变体的 key**，而且永远不会翻错。
- **ja 文案的权重不同于 en。** 产品文档说 ja「是社团认领/下架通道真正可用的前提」。118 条里真正需要人工把关的是：版块名、站规/发帖须知、举报理由、审核结果通知这四组（约 30 条）——一个日本社团主看到的就是这些。其余可以机翻打底后迭代。

### 6.6 SSR 时间戳的坑（顺带修一条既有 bug）

`dash/reports.tsx:106` 写的是 `new Date(r.createdAt).toLocaleString()`。这在 SSR 时用**服务器**的时区与 locale 渲染，hydration 时用**浏览器**的，结果是 hydration mismatch + 时间显示错误。论坛每一行都有时间戳，这个错会被放大 100 倍。

`RelativeTime` 组件的做法：
```tsx
<time dateTime={iso} title={absolute}>{text}</time>
```
首帧（含 SSR）渲染一个与时区无关的稳定字符串；`useEffect` 里换成 `Intl.RelativeTimeFormat` 的相对时间。或者最省事：首帧渲染 ISO 日期部分 + `suppressHydrationWarning`。

---

## 7. shadcn / radix-nova 组件

### 7.1 ⚠️ `asChild`，不是 `render`

仓库锁的是 `radix-ui@^1.6.7`，`button.tsx:54` / `badge.tsx:37` 用的是 `asChild ? Slot.Root : '...'`。
**新版 shadcn/Radix 文档里的 `render={<Link/>}` 语法在这个版本编译不过。** 从文档或别处粘来的片段必须改写成 `asChild`。

现有惯用法（照抄）：
```tsx
<Button asChild><Link to={localizeHref('/shrine/new')}>{m.compose_title()}</Link></Button>
```
`site-header.tsx:99-104`、`detail.tsx:235-244` 都是这个形状。

### 7.2 现有 15 个够用的部分

`avatar` `badge` `button` `card` `dialog` `dropdown-menu` `input` `label` `select` `separator` `skeleton` `switch` `table` `tabs` `textarea`。
主题列表、发帖表单主体、举报对话框、楼层操作菜单、写/预览切换、加载骨架都能直接用。

### 7.3 要装的 8 个

| 组件 | 用在哪 | 不装的话 |
|---|---|---|
| `popover` | 表情面板、@ 补全的锚点、订阅状态菜单 | 用 `dropdown-menu` 硬撑，但它是 menu 语义（roving tabindex），装网格按钮和输入过滤时 a11y 是错的 |
| `tooltip` | 图标按钮说明、相对时间悬停显示绝对时间 | 纯图标按钮没有可见标签，键盘/读屏用户拿不到信息 |
| `alert` | 锁帖提示、草稿恢复、新账号外链说明、空态引导块 | 8 处各手搓一个 div，样式必然漂移 |
| `alert-dialog` | 删楼层 / 删主题的二次确认 | 用 `dialog` 也能做，但删除是 destructive 且带审计后果，`alert-dialog` 的默认焦点与 esc 行为才是对的 |
| `sonner` | 点赞、复制链接、标记已读这类**无跳转**操作的反馈 | fetcher 提交完页面毫无变化，用户不知道成没成 |
| `pagination` | 主题列表翻页、楼层翻页 | 现在全站**没有任何分页 UI**（`kourindou/list.tsx` 也没有），论坛必须有 |
| `breadcrumb` | 神社 › 版块 › 主题 | 三层导航，移动端尤其需要回上级 |
| `scroll-area` | 表情面板、@ 补全列表 | 原生滚动条在暗色主题下很难看，且两套主题下表现不一致 |

安装：`bunx shadcn@latest add popover tooltip alert alert-dialog sonner pagination breadcrumb scroll-area`（`components.json` 的 `style: radix-nova` 会被自动尊重）。

### 7.4 **不**装的

- **`command`（cmdk）**——@ 补全挂在 `<Textarea>` 的光标位置上，**它不是标准 combobox**：cmdk 自带的输入框会和 textarea 争夺焦点与按键。这个交互本质是「typeahead overlay」，用 `popover` + 一个手写的按钮列表（↑↓/Enter/Esc，约 30 行）更贴合，也少一个依赖。
- `sheet`——版块导航用一行可横向滚动的 chip，在所有宽度下都成立，不需要移动端抽屉。
- `hover-card`（用户悬停卡）、`collapsible`（长引用折叠）——纯增强，M5。

### 7.5 要自己写的（非 shadcn）

`app/components/`：
- `discussion/`：`Discussion` `PostList` `PostItem` `PostComposer` `MarkdownBody`（§3.2）
- `EmojiPicker` `MentionPopover`
- `RelativeTime`（§6.6）
- `UserChip`（头像 + 显示名 + `@handle` + 角色徽章，帖子/通知/个人主页三处复用）
- `TopicRow` `BoardGrid` `NotificationRow`
- `EmptyState`（标题 + 说明 + 可选行动按钮）——`kourindou/list.tsx:136-141`、`dash/queue.tsx:156-162`、`dash/reports.tsx:85-88` 现在各手搓一份同样的居中块，M4 又要新增 8 个空态，现在抽出来正好。

### 7.6 `SiteHeader` 的改动

- `SessionUser` 类型加 `handle: string | null`、`unreadCount: number`（来自扩展后的 `/api/me`，root loader 已经在调）。
- 加一个铃铛按钮 + 未读徽章，链到 `/notifications`。
- 用户下拉里加「我的主页」（`/u/:handle`）、「设置」。

---

## 8. 这份前端设计对 API / schema 提出的要求（汇总，供对齐）

不是我拍板的，但**前端做不出来**，列出来供 schema/API 设计对齐：

| # | 要求 | 出处 |
|---|---|---|
| 1 | `listPosts` 投影加 `handle` / `avatarUrl` / `role` / `likeCount` / `likedByViewer` / `quoted` / `mentions` / `locale` | §3.3 |
| 2 | `GET /shrine/topics/:id` 单独返回 opening post（分页第 2 页仍需主楼） | §2.3 |
| 3 | 楼层分页按**楼层区间**，`pageSize` 服务端定死并在响应里回传 | §1.2 |
| 4 | 引用「现查」：服务端返回 `quoted.excerpt`（**纯文本、已剥 Markdown、~100 字**），不要让前端渲染嵌套 Markdown | §2.3 |
| 5 | `mentions`：服务端跑 shared 的抽取器 + 存在性查库，只回存在的 handle | §5.7 |
| 6 | `POST /api/uploads/image` 支持 `purpose='post'`，对象走独立前缀（`gc-images` 白名单必须跟上，**不改必炸**） | §4 |
| 7 | `post.locale` 一列，写入时取请求 locale | §6.3 |
| 8 | `/api/me` 加 `handle` 与 `unreadCount` | §2.5 §7.6 |
| 9 | `GET /moderation/reports` 投影加目标上下文（LEFT JOIN），urgent 排序挪到 `orderBy` | §2.9 |
| 10 | `REPORT_REASON` 加 `spam` / `harassment` | §2.9 |
| 11 | root loader 需要 `imageHost`（来自 API 的 `S3_PUBLIC_BASE_URL`） | §5.4 |
| 12 | `routes/login.tsx` 支持 `?next=`（既有路由的改动） | §2.4 |

---

## 9. 明确不做（前端侧 YAGNI）

未读标记体系 · 无限滚动（用分页，深链才可用）· 富文本 WYSIWYG（Markdown 源文编辑 + 预览）· 代码高亮 · 楼层内联编辑（走独立编辑态）· 客户端搜索 · 帖子的实时更新（SSE/WebSocket）· 签名档 · 用户自定义主题 · 移动端抽屉导航 · 服务端草稿 · 私信 UI · 语言徽章 / 语言筛选 / 翻译按钮（§6.2）。

---

## 10. 留给站长拍板

1. **主题 URL 用 uuid 还是全局序号？** 我推荐 uuid（零协商、序号是 additive 升级）。但序号可口头传播（「1234 帖」）是真实的论坛价值，代价是**把主题总数公开**——冷启动期 `/shrine/t/7` 会告诉所有人这里只有 7 个主题。这条属于不可逆范围。
2. **handle 在注册时收，还是自动生成？** 这两件事和「要不要做 @ 补全」是**同一个决定**：自动生成的 `u_a7f3k2m9` 没人打得出来，@ 补全就从「锦上添花」变成「必需品」；注册时让用户自己填，handle 可读，补全降级为便利。我倾向注册时收（注册表单加一个字段），并保留自动生成作为兜底（防止「注册成功但 handle 没设」的中间态）。
3. **收藏 tab 默认公开还是仅本人可见？** 我按「收紧默认」判为仅本人可见。若产品希望个人主页是一张可炫耀的名片，就要改成公开——但公开之后再收回来，泄露已经发生了。
4. **版块不建表（§6.4）是否接受？** 这与 `mined-forum-mechanics.md` 的建议相反。我的理由是「没有管理后台时，DB 里的名字只能用 psql 改，比部署更贵」。如果 M4 打算做版块管理后台，这个判断就翻转。
5. **六个版块的 slug 定名**（`tea-house` / `danmaku` / `workshop` / `music-hall` / `kappa` / `meta`）——**这是对外 URL，发出去就改不动了**，需要现在确认。
6. **东方表情的 shortcode 词表**需要在写第一行渲染代码之前定下来，因为它会被写进已发布正文（§5.6）。M4 要几个？谁来画/授权？（同人图的使用许可本身就踩本站的生死线字段。）
