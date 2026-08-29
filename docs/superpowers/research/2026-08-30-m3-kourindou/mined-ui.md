## 1. 页面信息架构（legacy 现状）

### `/resources` 列表 — `/Users/i/Code/th/legacy/thdl/src/app/(site)/resources/page.tsx`
- **取数**：Server Component 直接打 db（`db.query.resources.findMany`），`export const revalidate = 30`（ISR）。整个查询包在 `try/catch` 里，出错静默返回空数组 —— 用户看到的是"没找到匹配的资源"而不是错误。
- **展示**：标题 `资源库` → `<ResourceFilters />` → `<ResourceGrid>`（2/3/4 列响应式）或空态。
- **查询逻辑**：`status = 'public'` + `ilike(title, %q%)` + `eq(category)`；排序三选一 `new | popular | rating`（rating 用 `ratingSum::float/ratingCount` 的 SQL 表达式，零除保护写在 case 里）；`perPage = 24`，`offset = (page-1)*24`。
- **缺陷（M3 必补）**：① `page` 参数服务端读了但**页面上根本没有分页 UI**，第 2 页只能手改 URL；② 没有总数查询，无法渲染页码；③ 筛选器把"全部分类"提交成 `category=all`，服务端 `eq(category,'all')` 不是合法 enum，查询抛错被 catch 吞掉 → 选"全部"反而空列表（**真实 bug**）；④ 搜索只匹配 title，不含简介/社团/拼音。

### `/resources/[slug]` 详情 — `.../resources/[slug]/page.tsx`
- **取数**：`findFirst({ with: { files: true, uploader: true } })` + 单独一条 comments 联表查询（left join users，limit 200，倒序）+ favorites 存在性查询（仅登录时）+ `getSession()`。合计 3~4 次串行 db 往返。
- **`generateMetadata`** 再查一次同一行（重复查询，Next 的 request dedup 靠 fetch 缓存，drizzle 直查不去重）。
- **布局**：`lg:grid-cols-[1fr_340px]` 主栏 + 右侧栏。
  - 主栏：16:9 封面（`publicUrl(coverKey)` 直链公开桶）→ 元信息行（分类 Badge / 社团 / 作者 / 展会 `eventName` / 语言 `language`）→ 标题 → 第二行元信息（上传者、创建日期 `toLocaleDateString("zh-CN")`、均分+评分数、右对齐"编辑"按钮）→ 简介（**`whitespace-pre-wrap` 裸渲染，`descriptionMd` 字段名叫 Markdown 但没有 md 渲染器**）→ 评论区。
  - 侧栏卡片 A：均分、`<RatingStars>`、"共 N 人评分 · 下载 N 次"、`<FavoriteButton>`、右下角 `<ReportDialog>`。
  - 侧栏卡片 B：`文件 (N)` + `<DownloadList>` + 外链区块（`externalLinks` jsonb 数组，`target=_blank` 直链）。
- **权限**：`canEdit = 本人 || moderator || admin`。
- **缺陷**：只有 `status === "takedown"` 走 `notFound()`，**`pending` / `hidden` 的资源凭 URL 仍可访问**，`/api/download` 同样只挡 takedown。没有版本概念（`resourceFiles.version` 字段存在但 UI 完全不用）。

### `/resources/[slug]/edit` — `.../edit/page.tsx`
- 极薄：`getSession()` → 未登录 `redirect("/login")` → 查资源（`with: files`）→ 非本人非 staff `redirect` 回详情 → 把扁平化的 6 个字段喂给 `<EditForm>`。
- 注意：查了 `files` 但**没传给 EditForm**，编辑页无法增删文件、无法改封面、无法改外链（`externalLinks` 传进 Props 类型里但 EditForm 里没有对应 UI）。

### `/upload` — `.../upload/page.tsx`
- 更薄：鉴权 `redirect("/login?callbackUrl=/upload")` → 标题 + 一句免责说明「先发后审。恶意、侵权或违反东方社区规范的内容会被下架。」→ `<UploadForm />`。

### `/dash/*` 管理后台
- `layout.tsx`：`getSession()`，role 非 admin/moderator 直接 `redirect("/")`。侧栏三项：概览 / 资源管理 / 举报（`200px_1fr` 栅格）。
- `page.tsx` 概览：三张统计卡 —— 资源数、用户数、未处理举报（`count(*) filter (where not resolved)`）。每个 count 包在 `safeCount` 里，失败返回 0（会把 0 和"查询挂了"混淆）。
- `resources/page.tsx`：一张 HTML `<table>`，列 = 标题 / 分类 / 状态 / 下载 / 操作。`findMany({ orderBy: createdAt desc, limit: 100 })` —— **无筛选、无分页、无搜索、无"待审"过滤**。操作列是 `<ModerateActions>`。
- `reports/page.tsx`：举报卡片流（left join resources 取 slug/title），显示资源标题链接、时间、原因文本、"已处理"标记。**纯只读，没有任何处理按钮** —— `resolved` 字段永远无法被置为 true。

---

## 2. 上传"向导"的真实形态

**legacy 根本没有向导** —— `upload-form.tsx` 是一个单页扁平表单，所有字段同屏，一个"发布"按钮。这是 M3 最需要重做的地方。

现有交互序列（全部客户端命令式 fetch，无表单提交语义）：

1. **文本字段**（无校验、无 blur 提示）：标题（placeholder「例：蓬莱人形 Reimu Remix」）、分类 Select（9 项）、社团（placeholder「例：上海アリス幻樂団」）、作者、简介 Textarea（rows=6，「支持简单 Markdown」）。
2. **封面**：`<label>` 包 `<input type=file accept=image/*>`，选中即刻 → `POST /api/upload/presign {kind:"cover"}` → `fetch(url, PUT)` → 存 `coverKey` + `URL.createObjectURL` 本地预览 → toast「封面已上传」。**封面上传无进度条**。
3. **文件**：虚线框 `<input multiple>`，选中即刻串行上传：
   - `< 20 MB` → `uploadSingle`：presign → **XMLHttpRequest PUT**（用 XHR 只为拿 `upload.onprogress`）。
   - `≥ 20 MB` → `uploadMultipart`：`?action=start` → 每片 8 MB 依次 `?action=part` 换预签名 → `fetch PUT` → 收 ETag → `?action=complete`。分片进度按"已完成片数/总片数"跳变，不是字节级平滑。
   - **abort 通道形同虚设**：`uploadSingle` 收到的是 `new AbortController().signal`，controller 当场丢弃，没有任何取消 UI。`?action=abort` 端点存在但前端从不调用 → 失败的分片上传在 B2 里变成永久垃圾。
4. **进度展示**：两个独立列表 —— `queue[]`（正在传，`name — NN%` + 1px 高进度条）和 `files[]`（已完成，文件名 + `formatBytes` + `X` 删除按钮）。**已完成的文件不会从 queue 里移除**，所以传完后同一个文件在两个列表里各出现一次。
   - **真实 bug**：`const idx = queue.length` 在 `for` 循环里读的是闭包里的旧 state，多选时所有文件拿到同一个 idx，进度条互相覆盖。
5. **提交**：客户端校验只有两条 —— 标题非空、`files.length > 0 || coverKey`。`POST /api/resources` 带上已上传文件的 key 清单 → 服务端 `slugify(title)` + `uniqueSlug` 循环去重（最多试 50 次再退化成时间戳）→ 事务插 resources + resourceFiles → `status: "public"` **直接公开** → toast「已发布」→ `router.push`。
   - 注意：`externalLinks` 在服务端 zod schema 里有，**上传表单里没有对应 UI**，只能通过 API 直接传。
   - **"先发后审"在代码里只是文案**：没有 pending 态、没有信任梯度、没有 Turnstile、没有审核队列。

**M3 向导建议分步**（对应新对象模型）：① 许可与归属（license 状态四选一 + circle + 认领声明勾选，**放最前面当闸门**）→ ② 基本信息（多语标题/简介 zh·ja·en + 类型 + 原作关联 + 展会）→ ③ 文件与版本（首个 version 号 + changelog + B2 直传 / 外链镜像混填）→ ④ 封面与标签 → ⑤ 预览与提交（Turnstile + 根据信任等级显示"将进入审核队列"或"将立即发布"）。

---

## 3. 管理后台审核流程 UI

**现状能力清单（很小）**：
- 队列 = `/dash/resources` 的 100 行全量表格，没有"待审"视图，因为**根本不存在 pending 的资源**。
- 操作 = `moderate-actions.tsx` 三个按钮，按当前状态条件渲染：`上架`(→public) / `下架`(→hidden) / `移除`(→takedown，destructive 样式)。全部走 `PATCH /api/resources/[id] {status}`，服务端 `if (v.status && !check.staff) delete v.status` 做权限降级，成功后 toast + `router.refresh()`。
- **无二次确认、无操作原因、无审计日志、无通知上传者、无批量操作**。
- 举报页只读，`resolved` 无法翻转，举报与资源状态之间没有联动。
- 状态机 4 态：`public | pending | hidden | takedown`（`pending` 从未被写入过）。

**M3 需要新建的**：待审队列（按信任等级 + 提交时间排序，展示许可状态徽章作为首要审核信号）、审核操作带原因枚举 + 自由文本、驳回后回到上传者可编辑态、举报处理闭环（受理/驳回/关联下架）、认领与下架申请单独队列（这是版权生死线，需要独立通道而非混在举报里）、moderation log 表。

---

## 4. 筛选器维度（`resource-filters.tsx`）

只有 **3 个**，全部同步到 URL query，`useTransition` + `router.push`，每次改动 `p.delete("page")` 重置分页：

| 维度 | 控件 | 取值 |
|---|---|---|
| `q` | Input，**仅回车触发**（无防抖、无搜索按钮、无清除） | 自由文本，服务端 `ilike title` |
| `category` | Select | 全部/音乐/游戏/CG/同人志/MMD/视频/壁纸/工具/其他（10 项，含"全部"） |
| `sort` | Select | `new` 最新 / `popular` 最热 / `rating` 评分最高 |

**完全缺失**：社团、作者、展会（`eventName` 字段存在但不可筛）、语言（`language` 同上）、标签（`tags`/`resourceTags` 两张表已建，UI 零使用）、文件大小、有无外链、日期区间、许可状态（新增）、原作关联（新增）、已收藏/我上传的。M3 的"类型 × 原作 × 展会 多维筛选"需要从零设计，配合 Meilisearch 的 facet。

---

## 5. 组件去留：沿用 vs RR8 重构

### 值得沿用（结构/视觉直接搬，改数据通道）
- **`resource-card.tsx`** — 4:3 封面 + 左上角分类 Badge + 标题 + 社团/作者 + 底部星级/下载数，信息密度合适。改动：`framer-motion` 的 `whileInView` 在 SSR 首屏会先渲染 `opacity:0`（RR8 SSR 下 FOUC/CLS 更明显，建议只保留 hover 位移，或用 CSS `@starting-style`）；`categoryLabel` 硬编码 map 换 Paraglide；`publicUrl` 换 B2 CDN base；标题要走多语字段回退链（zh→ja→en）。
- **`resource-grid.tsx`** — 纯展示，`grid-cols-2/3/4`，无状态。直接搬，加 skeleton 变体。
- **`download-list.tsx`** — 交互模型（点按钮 → 换签名 URL → `window.open`）在 M3 依然正确，是 B2 签名下载的标准做法。扩展为按 version 分组 + 区分 B2 对象 / 外链镜像两种来源。
- **`report-dialog.tsx`** — Dialog + Textarea + 提交的形态可用。需加原因枚举 Select（版权/违法/假资源/其他），因为纯自由文本对审核方毫无结构化价值。
- **`rating-stars.tsx`** — hover 预览 + 点击提交的星级交互可用。缺陷：`value` 初始恒为 0，**不回显用户已有的评分**，刷新后自己打的分消失，需要 loader 传入 `myScore`。
- **`moderate-actions.tsx`** — 条件渲染按钮的思路可用，但要扩成"审核决定"（含原因、确认弹窗）。
- **dash 表格布局** — 简单直白，适合 solo 运营；换 shadcn `<Table>` + 分页 + 状态筛选 tab。

### 必须重构（Next 边界 → RR8 loader/action）
| legacy 做法 | RR8 做法 |
|---|---|
| Server Component 里直查 db | `loader` 里用 `hc` RPC 打 `apps/api`，类型从 hono 链式路由推导 |
| `export const revalidate = 30`（ISR） | 无对应物 → loader 返回 `Cache-Control: s-maxage=30, stale-while-revalidate` 由 CDN 承接 |
| `redirect()` / `notFound()`（next/navigation） | `throw redirect(...)` / `throw data(null,{status:404})` + route `ErrorBoundary` |
| `generateMetadata` 再查一次库 | `meta` export 读 `loaderData`（零额外查询），且要接 Paraglide locale |
| `"use client"` 组件 + 命令式 `fetch()` 打 route handler | 组件不再分服务端/客户端；变更走 `<Form>` / `useFetcher()` → route `action` |
| 变更后手动 `router.refresh()`（出现在 favorite/rating/comment/moderate 共 5 处） | **全部删掉** —— RR8 action 返回后自动重新验证同级 loader |
| `FavoriteButton` 手写乐观 state + 失败回滚 | `fetcher.formData` 派生乐观 UI，失败自动回退，代码量减半 |
| `ResourceFilters` 用 `useSearchParams` + `router.push` 拼 URL | `<Form method="get">` + `useSubmit` 自动序列化；loader 读 `new URL(request.url).searchParams`，用 zod 解析（一份 schema 同时喂前端表单与后端） |
| `UploadForm` 全命令式（presign→XHR→POST） | **上传部分保持命令式**（action 无法上报字节级进度），只有最后一步"创建资源"改成 action；分步向导用嵌套路由 `/upload/step-1..n` 或单路由 + `useFetcher` 暂存草稿 |
| `CommentSection` 本地 state + refresh | `useFetcher` 提交 + 乐观插入；**且必须改成"发帖"语义** —— 按已批准的决策，评论表就是论坛楼层表，schema 要带 `topicId`/`floor`/`parentId`，M4 直接复用 |
| `EditForm` 的 `confirm()` 删除 | `useFetcher` + shadcn `AlertDialog`，`method="delete"` |
| 3 处硬编码 `toLocaleDateString/toLocaleString("zh-CN")` | 必须 locale 驱动；且 SSR/CSR 时区不一致会造成 hydration mismatch，统一用 `<time>` + 服务端格式化 |
| 客户端 zod schema 与服务端各写一份（`api/resources/route.ts` 与 `[id]/route.ts` 的 enum 重复了两遍） | 全部收进 `packages/shared`，`z.infer` 出类型，同时供 OpenAPI |

### 直接丢弃
- `descriptionMd` 的裸 `whitespace-pre-wrap` 渲染 —— 换真正的 Markdown 渲染 + sanitize。
- `try/catch { return [] }` 的静默吞错模式 —— RR8 用 `ErrorBoundary` 显式呈现。
- 单文件 `schema.ts`（247 行 12 表）→ 按模块拆到 `packages/db/src/schema/*.ts`。
- `EditForm` 与 `UploadForm` 的字段定义重复 —— 抽成共享的字段组件 + 同一份 zod schema。

---

## 6. 硬编码中文文案盘点

**统计口径**：`src` 下 31 个文件含 CJK，共 **189 行**包含中文；去重后 **149 条**独立中文片段（含被 JSX 标签切碎的句子，如「幻想乡的」「一切资源」「都在这里」实为一句 hero 标题）。合并成真正的翻译单元后约 **115–125 条 zh message**。

**分布**（按行计）：
```
upload-form.tsx        25   ← 最大集中地
components 小计        95
app/(site)/*           42   （首页 14、详情 12、me 6、upload 3…）
app/dash/*             21
其余（layout/offline）   6
```

**按类别（M3 必须全部 Paraglide 化）**：
- **导航与外壳** ~15：东方资源站 / 资源 / 音乐 / 游戏 / CG / 同人志 / 上传 / 后台 / 搜索 / 登录 / 注册 / 退出登录 / 个人中心 / 关于 / 条款 / 版权投诉 / 切换主题。
- **枚举标签** ~26：分类 9 项（音乐·游戏·CG·同人志·MMD·视频·壁纸·工具·其他）在 `resource-card`、`resource-filters`、`upload-form` 里**各写了一遍**（三处重复，`edit-form` 里干脆直接显示英文 slug）；排序 3 项；状态 4 项（dash 里直接渲染英文 enum 未翻译）。
- **表单标签与 placeholder** ~30：标题/分类/社团(可选)/作者(可选)/简介/封面/文件/邮箱/密码/昵称 + 「例：蓬莱人形 Reimu Remix」「例：上海アリス幻樂団」「支持简单 Markdown」「点击或拖拽文件（支持多选，大文件自动分片上传）」「点击选择」「搜索标题…」「说点什么…」「登录后评论」。
- **按钮与状态文案** ~25：发布/提交中…/保存/保存中…/删除/发送/取消/上架/下架/移除/编辑/收藏/已收藏/举报/登录中…/创建中…。
- **Toast 与错误** ~22：请填写标题 / 至少上传一个文件或封面 / 提交失败 / 保存失败 / 删除失败 / 发送失败 / 评分失败 / 操作失败 / 获取下载链接失败 / 请先登录 / 请先登录后再评分 / 请填写举报原因 / 邮箱或密码错误 / 注册失败 / 已发布 / 已保存 / 已删除 / 已更新 / 封面已上传 / 感谢你的评分 / 已提交，感谢你的反馈。
- **空态与长句** ~14：没找到匹配的资源。/ 还没有评论，来抢沙发。/ 还没上传资源。/ 还没收藏任何资源。/ 还没有资源，成为第一个上传者吧。/ 暂无附件 / 暂无举报。/ 暂无数据 / 无封面 /（无简介）/ 确认删除这个资源？此操作不可恢复。
- **营销与法务长句** 6（翻译成本最高、需真人校对）：hero 标题三段式、「免费开放的东方Project 同人资源社区 — 音乐、游戏、CG、同人志、MMD。上传、编辑、评分，全由你掌控。」、「先发后审。恶意、侵权或违反东方社区规范的内容会被下架。」、「请简述问题（版权侵权、违法内容、假资源等）。管理员会尽快处理。」、footer 免责声明、离线页说明。
- **`metadata` title** 8 条：上传资源 / 编辑资源 / 个人中心 / 未找到 / 后台 · 概览 / 后台 · 资源管理 / 后台 · 举报 —— RR8 里全部搬进 `meta` export，且必须按 locale 出。

**M3 量级估算**：legacy 基线约 120 条 zh。M3 新增面（多语字段编辑器、许可状态四态 + 各自的解释性 tooltip、版本与更新日志、多维标签、审核队列与驳回原因枚举、认领/下架申请流程、信任等级提示、Turnstile 提示、分页、Meilisearch 空结果与拼音提示）预计再加 **150–220 条** → **zh 总量约 270–340 条**，×3 语言 = **810–1020 条翻译条目**。建议现在就定死三条约定：① 所有 enum 的展示名一律走 message 而非组件内 map（legacy 的分类标签重复三份就是反面教材）；② message key 按模块前缀命名（`kourindou.upload.*` / `kourindou.moderation.*`），为 M4 论坛复用评论文案留位；③ 日期/文件大小/复数走 Paraglide 的 locale-aware 格式化，不要像 legacy 那样写死 `"zh-CN"` 和英文单位数组。

---

## 附：顺带发现的 legacy 缺陷（M3 别继承）
1. `resource-filters.tsx:53` 选"全部分类"提交 `category=all` → 服务端 enum 比较抛错被吞 → 空列表。
2. `upload-form.tsx:105` `const idx = queue.length` 闭包读旧 state，多选文件进度条串台。
3. `upload-form.tsx:112` AbortController 当场丢弃，取消/中止分片上传的能力完全没接。
4. 列表页 `page` 参数有服务端逻辑但无分页 UI，也无 total count。
5. 详情页与 `/api/download` 只挡 `takedown`，`hidden`/`pending` 资源凭 URL 可访问、可下载。
6. `rating-stars.tsx` 不回显用户已有评分。
7. `/dash/reports` 无处理动作，`reports.resolved` 永远为 false。
8. `edit-form.tsx` 无法编辑文件、封面、外链，且分类下拉直接显示英文 slug。
9. `comments.parentId` 有字段、有查询、**UI 完全不渲染层级** —— M3 重建时正好按"论坛楼层"重做。