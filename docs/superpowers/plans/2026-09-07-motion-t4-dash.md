# 和风纸境 T4：装 motion，第一个界面是 /dash

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 装 `motion`，把它用在这个站真正需要的三件事上——**位置连续性**（我点的那个东西去哪了）、**远端回执**（它办完了吗）、**常驻状态**（我现在处在什么模式）——并从全站最高频的操作界面 `/dash` 开始。

**Architecture:** 全量 `motion`（**不用 `LazyMotion`**），`MotionConfig` 挂 root，其余一律落在**路由自己的 chunk** 里。`root.tsx` 之外的 root 树文件**一律不得 import `motion/react`**——这条是硬边界，由体积门禁与 grep 断言双重把守。

**Tech Stack:** Bun · React Router 8 (SSR) · React 19 · Tailwind v4 · **motion 13** · Paraglide JS

**Spec:** `docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md`

**硬前置:** `docs/superpowers/plans/2026-09-07-motion-t3-groundwork.md` 全部落地，尤其 Task 2 的 `check-bundle-size` 与 Task 6 的 `<LiveRegion>`。

**范围:** 本计划覆盖批次 0（三条前置 bug）、批次 1（四条 0 KB）、批次 2（/dash 六条）。讨论区、通知、香霖堂三个批次是**计划五**。

---

> **2026-09-07 修订（T3 合并之后）**：本计划成文于 T3 落地**之前**，而 T3 改动了这里要碰的
> 绝大多数文件。执行前做了一轮九任务前提审计（每个任务一名只读审计员比对计划与实际代码，
> 每条「计划有误」再由独立审查员尝试反驳），提出 59 条、站住 33 条，其中 4 条会直接把生产
> 打 500 或让验收必然失败。**下面的正文已按审计结果就地修订**，被改动处都留了「修订：」标注。
> 审计与裁定的完整记录在 `.superpowers/sdd/2026-09-07-motion-t4-dash/progress.md`。

## 三条架构裁决（它们推翻了此前几轮的共同前提，先读这里）

### A1. 不用 `LazyMotion`，用全量 `motion`

此前几轮都设计了 `LazyMotion strict` + 异步 features + 三套别名，并写了同一句承诺：「把 `<LazyMotion>` 放进 `{user && …}` 分支，匿名访客一个字节不下载」。

**这句话是假的。** chunk 划分是**构建期静态**的；`{user && …}` 是运行时条件，模块仍被路由 chunk 静态 import。实测：

| 架构 | 首屏 gz |
|---|---|
| `LazyMotion` 同步版 | 45.91 KB |
| **全量 `motion`** | **45.88 KB** ← 反而更便宜 0.03 KB |

而且 motion 全部落进**一个共享 chunk**，只被引用它的路由 import——`login` / `register` / `home` 增量 **0.00**。**「下沉到叶子」是 rolldown 已经免费做完的事。** `LazyMotion` 在这个仓库买不到任何东西，只买到三样负债：strict 的静默失败（features 未加载时元素不动且无报错）、一个必须存在的 `motion-features.ts` 单独模块、一条要开 path override 的 Biome 规则。

### A2. root 树一律不进 motion 树

实测：motion 出现在 root 的可达图里 = **首屏 +37.31 KB**。而这个站流量最大的页面是被外链进来的 `/kourindou/:slug` 匿名读者。

**以下五个文件禁止 import `motion/react`**（`root.tsx` 例外，且只允许 `MotionConfig`）：
`app/root.tsx`（仅 MotionConfig）· `app/components/site-header.tsx` · `app/components/mobile-nav.tsx` · `app/components/pending-bar.tsx` · `app/components/ui/button.tsx`

被这条否掉的（**其中两条 CSS 确实做不到，但它们落在唯一不能付这个代价的树里**）：header 下滚收起、header 活动项 `layoutId` 朱线、pending 墨线换 MotionValue、青海波 `useScroll` 定速视差、mobile-nav `drag` 抽屉、header 未读徽章 `AnimatePresence`。替代方案见批次 1 与批次 6。

### A3. 撤销 T3 计划末尾提到的 Biome `noRestrictedImports` 形状

T3 的「下一步」小节写着要禁 `motion/react` 的 `motion` / `domMax` / `domMin` 具名导入——**那条规则从来没有正确形态**，T4 全站都要用 `motion`。正确的墙是 A2 的 path 禁令。**T3 收尾时直接按 A2 写，别先加再反转。**

### 顺带撤销一条执行了整个项目的约定

此前立的「**禁止用 `m` 作 motion 标识符**」是围绕一个**不存在的冲突**建立的。实测 `scripts/check-messages.ts:74` 的正则 `/\bm\.([a-zA-Z0-9_]+)\(/g`：

```
<motion.div className="x">   -> 无命中     （m 后面接的是 o，不是 .）
motion.create("div")         -> 无命中
m.site_name()                -> ['site_name']
```

**全站写 `<motion.div>`，零别名，零约定要记。** 另：`motion/react-m` 在 motion 13 里不导出 `m`（只导出逐元素组件），此前几份方案里的 `import { m as MotionLi } from 'motion/react-m'` 会直接构建失败——这条随 A1 一并消失。

---

## Global Constraints

**这套动效的判据**：三条曲线各管一类语义，这是「一套」而不是「一堆」的分界线。

| 曲线 | 语义 | 用在哪 |
|---|---|---|
| `--ease-washi`（spring `bounce:0`） | **位置连续性** | 「我点的那个东西去哪了」 |
| `--ease-sumi` | **远端回执** | 「它办完了吗」 |
| `--ease-fude` | 一笔画出来 | 只给 scaleX 类延展 |

**九条红线**（写进 CLAUDE.md）：

> *修订*：Goal 说本期把 motion 用在**三件事**上，第三件是「常驻状态（我现在处在什么模式）」——
> 但下面的曲线语义表只有三格且没有它，批次 2 的四条任务也没有一条认领它。裁定：
> **dash tab 下划线同时是这两件事**——它**怎么动**属位置连续性（走 washi），它**意味着什么**
> 属常驻状态（「我现在在哪个 tab」）。收尾写进 CLAUDE.md 的那三问因此有了referent；
> 否则「这是常驻状态」将是一句无法被证伪的挡箭牌。

1. **内容层零入场动画。** 没有 stagger 入场、没有 `useInView` 触发的显现、**任何会进 SSR HTML 的节点都不许有 `initial={{opacity:0}}`**。**这个站的内容永远第一帧就在。**
   *修订*：原文写的是「零入场动画……本计划里没有任何一条是『东西出现』」，而 Task 8 的错误行与
   Task 9 的确认块都是 `initial={{opacity:0}}`——它俩都是**纯客户端交互后才存在**的临时节点，
   不进 SSR、也不是内容。红线的真正边界在 spec §5.1：**限定词是「会进 SSR HTML 的」**。
   原措辞若原样进 CLAUDE.md，就是一条写着「无例外」却在同一期被违反三次的禁令。
2. `useInView` 在这个站的**唯一**用途是给 `layout` 做规模门控，不是入场触发。
3. **`backdrop-filter` 卡片上只用 `layout="position"`，永不用 `layout`（both）**——both 会做 scale 校正 → 背板模糊重算 + CJK 正文被拉伸 280ms。全站唯一允许 both 的是 dash tab 下划线（纯色条，无内容可失真）。
4. **`exit` 里零位移键。** reduced-motion 下 motion 对 positional keys 是**瞬移到终点**而非跳过。本计划全部 `exit={{opacity:0}}`。
5. **`whileTap` 只加在 `<button>` / `<a>`**（它与 `onTap` 都会往 SSR HTML 塞 `tabindex="0"`；`whileFocus` 不会）。
6. **`MotionConfig reducedMotion="user"` 管不到三类调用**：MotionValue 直连 `style`、`useAnimate` 驱动的 `window.scrollTo`、命令式 `animate()`。这三类必须自己走 `useReducedMotion()`。`Discussion.tsx` 底部已有 `prefersReduced()` 可复用。
7. **`Reorder` 必须有键盘替代**（`Reorder.Item` 不自带键盘重排）。本计划不涉及，计划五涉及。
8. **`popLayout` 移除后的焦点会掉回 `<body>`**——走 T3 的 `<LiveRegion>` 播报。
9. **`popLayout` 的容器要 `position: relative`**（`PopChild` 用 `offsetTop`/`offsetLeft` 定位）；它往 `document.head` 注 `<style>`，将来加 CSP 时 `MotionConfig` 必须同时给 `nonce`。
   *修订*：这条**Task 7 遵守了、Task 8 忘了**（同一份计划里一处写 `relative` 一处没写）。
   Task 8 的四个容器现已逐个点名要加。另外「CSP 要给 nonce」这条线索必须落成
   `root.tsx` 里 `MotionConfig` 旁的一行注释——留在 1089 行计划的红线表里等于没留。

**其余：**
- 文案走 Paraglide，新增 key 三语齐全。
- 只动 transform / opacity / 颜色优先；`layout` 的 FLIP 是 transform 实现的，可用。
- **`mode="wait"` 全站禁用**（工作界面上净损失；内容界面上与原生 VT 抢同一次替换）。
- **跨路由 `layoutId` 全站零处**——跨页到达 100% 归原生 View Transition。
- Biome：单引号、按需分号；`**/*.css` 不进 Biome。
- 提交信息末尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

# 批次 0 · 三条前置 bug（不含 motion）

### Task 1: 投稿者点星，UI 说成功、数据库什么也没发生

`detail.tsx` 的 `intent === 'rate'` 分支 **`await` 了请求却不读响应**，无条件 `return { ok: true }`。而 `apps/api/src/modules/kourindou/interactions.ts` 禁止投稿者给自己的资源评分（403）。

**所以投稿者点星，界面显示成功，数据库一动不动。** hc 客户端对 4xx 不抛异常，这个错误一路静默到用户眼前。

顺带：`intent === 'favorite'` 是同样的写法，而且 `favorite` 在整个 `apps/web` 只出现在这两行——**它是死分支**。

**Files:**
- Modify: `apps/web/app/routes/kourindou/detail.tsx`
- Modify: `apps/web/app/lib/api-error.ts`（*修订*：403 的码是 `self_action_forbidden`，映射表里没有它）
- Modify: `apps/web/messages/{zh,ja,en}.json`（*修订*：同上，要补 `err_self_action_forbidden` 三语）

**Interfaces:**
- Consumes: `apiErrorCode`、`errorMessage`（`~/lib/api-error`）、`<LiveRegion>`（`~/components/live-region`）
- Produces: rate 的 action 返回 `{ ok, code?, score? }`，**并且组件真的把它渲染出来**。

> *修订（loader 的 `myRating` 本期不做）*：它需要改 `apps/api/src/modules/kourindou/index.ts` 的
> `GET /resources/:slug` 加一次 rating 查询。而本期**没有任何消费者**——星条是计划五的事。
> 裁定：`myRating` 连同它的 API 改动一并推到计划五，本任务只修「谎报成功」。
> 计划五开工时这是它的第一步前置。

- [ ] **Step 1: 核实 API 侧的 403**

Run:
```bash
cd /Users/i/Code/th && grep -n -B3 -A6 "uploaderId" apps/api/src/modules/interactions.ts | head -30
grep -rn "favorite" apps/web/app
```
把两条输出贴进报告——第一条是 403 的依据，第二条应当只有 `detail.tsx` 那两行（证明是死分支）。若还有别的引用点，**不要删它**，在报告里说明。

> *修订两处*：① 路径原写作 `apps/api/src/modules/kourindou/interactions.ts`，**该文件不存在**，
> 真实位置没有 `kourindou/` 这一层。② 原 grep 带单引号 `'favorite'` 只能命中一行——
> `detail.tsx` 的第二处是 `.favorite.$put(`，两侧没有引号。
>
> **③ 最要紧的一条**：403 的码不是泛泛的 `forbidden`，而是
> `apps/api/src/modules/interactions.ts:38` 的 **`self_action_forbidden`**，
> 而 `apps/web/app/lib/api-error.ts` 的 `MESSAGES` 表里**没有这个键**——
> 不补的话 `errorMessage()` 会回落到「操作没有成功，请稍后再试。」，
> 对一个**永远** 403 的操作这是错误引导（它不是「稍后再试」能解决的）。
> 所以本任务必须同时补 `api-error.ts` 的映射与三语文案。

- [ ] **Step 2: rate 分支读响应**

`apps/web/app/routes/kourindou/detail.tsx`，把

```ts
  if (intent === 'rate') {
    await api.api.kourindou.resources[':slug'].rating.$put({
      param: { slug },
      json: { score: Number(form.get('score')) },
    })
    return { ok: true as const }
  }
```

改成

```ts
  if (intent === 'rate') {
    const score = Number(form.get('score'))
    const res = await api.api.kourindou.resources[':slug'].rating.$put({
      param: { slug },
      json: { score },
    })
    /**
     * 必须读响应：hc 对 4xx 不抛异常，而 api 侧禁止投稿者给自己的资源评分（403）。
     * 此前这里无条件 return { ok: true }，于是投稿者点星、界面显示成功、
     * 数据库一动不动，错误一路静默到用户眼前。
     */
    const code = await apiErrorCode(res)
    return code ? { ok: false as const, code } : { ok: true as const, score }
  }
```

并确认顶部已有 `import { apiErrorCode } from '~/lib/api-error'`（若无则加）。

- [ ] **Step 3: 删掉死分支**

把整个 `if (intent === 'favorite') { … }` 块删掉。**前提是 Step 1 的 grep 确认它没有任何调用点。**

- [ ] **Step 4（*已替换*）: 把错误码真的渲染出来**

> 原 Step 4 是「loader 补 `myRating`」，已按上面的裁定推到计划五。**取而代之的是这一步，
> 它才是本任务标题成立的必要条件。**

`detail.tsx` 的组件现在是这样（实测）：

```tsx
  actionData,
  …
  void actionData
```

**组件显式丢弃了 action 的返回值。** 只做 Step 2 的话，错误码从 action 流出来后死在组件门口，
标题里「UI 说成功」那个症状一个字都没变——只是从「谎报成功」变成「什么也不说」。
这同时踩掉 T3 刚立进 CLAUDE.md 的约定：**新增任何「操作成功了」的反馈，先问有没有一行文字。**

所以：

1. 删掉 `void actionData`。
2. 星条那一带渲染失败提示——`errorMessage(actionData.code)`，`role="alert"`，
   照 `dash/queue.tsx` 与 `dash/reports.tsx` 已经做对的形状（T3 落地），**不要发明第二套**。
3. 成功时把「已评 N 星」送进 `<LiveRegion>`（`~/components/live-region`，T3 建的）。
   评分是纯视觉反馈，读屏用户此前完全听不到。

**验收就是这一条**：以投稿者身份点自己的资源的星，屏幕上出现一句说明为什么不行的话，
而不是一片沉默。

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test)`
Expected: 全绿。若 `errorMessage(code)` 用到的 code 没有对应 Paraglide key，`check-messages` 会抓到。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/kourindou/detail.tsx
git commit -m "$(cat <<'EOF'
fix(web): 投稿者点星显示成功但数据库一动不动

detail.tsx 的 rate 分支 await 了请求却不读响应，无条件 return { ok: true }。
而 api 侧禁止投稿者给自己的资源评分（403），hc 对 4xx 不抛异常——
于是这个错误一路静默到用户眼前。

光把码送到 action 的返回值里还不够：组件里写着 void actionData，显式丢弃它。
不删掉那一句，症状只是从「谎报成功」变成「什么也不说」。所以一并接上
errorMessage(code) + role="alert"，成功时走 LiveRegion 播报。

顺带删掉 favorite 死分支（整个 apps/web 只出现在这两行），并补上
err_self_action_forbidden 三语——api 发的码是 self_action_forbidden 而不是
泛泛的 forbidden，映射表里原本没有它，会回落到「请稍后再试」，
而这是一个永远 403 的操作，不是稍后能解决的。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 三处列表取了 `total` 却没有分页控件

`queue.tsx` / `reports.tsx` / `notifications.tsx` 的 loader 都取了 `total`，但页面上没有翻页控件——**超过一页的内容在 UI 上不可达**。这与 T0 修过的香霖堂列表是同一个病。

**Files:**
- Modify: `apps/web/app/routes/dash/queue.tsx`、`apps/web/app/routes/dash/reports.tsx`、`apps/web/app/routes/notifications.tsx`

**Interfaces:**
- Consumes: `pageWindow`（`~/lib/paging`）、`ui/pagination`
- Produces: 无

- [ ] **Step 1: 核实三处的现状**

Run:
```bash
cd /Users/i/Code/th/apps/web
grep -n "total\|pageSize\|page" app/routes/dash/queue.tsx app/routes/dash/reports.tsx app/routes/notifications.tsx | grep -v "^.*://" | head -30
grep -rn "Pagination" app/routes/dash app/routes/notifications.tsx || echo "（三处均无分页控件）"
```
输出贴进报告。

- [ ] **Step 2（*新增，必须最先做*）: 先让 loader 真的读 `?page`**

> **这一步是审计新加的，原计划完全没有它——而没有它，整个 Task 2 是死的。**

实测：`queue.tsx` 与 `reports.tsx` 的 loader **整个函数里没有 `new URL(request.url)`**，
只写死 `query: { pageSize: '50' }`。API 侧 `paginationQuerySchema` 的 `page` 默认 1，
于是**无论 URL 上写什么，服务端永远返回第 1 页**。只加控件的话，点「下一页」是
URL 变、`total` 不变、列表内容一模一样，Step 4 的验收「翻到第 2 页内容不同」必红。

两个文件各照 `notifications.tsx` 已经做对的形状改（**它是三处里唯一读了 `?page` 的**）：

```ts
export async function loader({ request }: Route.LoaderArgs) {
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  const res = await apiFor(request).api.moderation.queue.$get({
    query: { page: String(page), pageSize: '50' },
  })
  const body = await res.json()
  // 失败分支也要给全形状：少了 page/pageSize，loaderData 是联合类型，
  // 组件里读 loaderData.page 直接是 TS 错误，Step 4 的 typecheck 必红
  if ('error' in body) return { items: [], page: 1, pageSize: 50, total: 0 }
  return body
}
```

**`pageSize` 保持 50 不动**——改它是产品决定，不在本任务范围。副作用是开发库现有数据量下
分页控件几乎不出现（`pages > 1` 为假），所以 Step 4 的实测要手工构造 `?page=2`，
验的是「翻页真的换了内容」而不只是「不崩」。

- [ ] **Step 3: 照 T0 在香霖堂列表用过的形状加控件**

三处各加一段分页控件。**照抄 `apps/web/app/routes/kourindou/list.tsx` 的写法**（T0 已经把这件事做对了：`pageWindow` 共用、第 1 页不写 `?page=1`、翻页保住现有 query），不要发明第二套。

每处都要：
- `import { pageWindow } from '~/lib/paging'` 与 `ui/pagination` 的六个组件
- `pageHref` 基于 `new URLSearchParams(params)` 增量修改
- `<PaginationPrevious disabled={current === 1} />` / `<PaginationNext disabled={current === pages} />`

**`ui/pagination.tsx` 的 `<Link>` 在 T3 已经带上 `viewTransition`**，所以这三处的翻页自动获得跨页转场，不需要额外做什么。

> *修订（notifications 有一处必须一起改，否则分页会造出一个静默的正确性 bug）*：
> 「全部标为已读」的游标 `upTo` 是**当前页的第一条**，而 API 对 `upTo` 的语义是
> 「标记该游标**及更旧**的全部未读」。今天 `?page=2` 只能手打 URL、几乎没人走到；
> **一旦分页控件成为常规入口**，在第 2 页点「全部已读」只会标掉第 2 页及更旧的，
> 第 1 页的未读一条不动——而 T3 加的 `<LiveRegion>` 还会播报一句看起来成功的「已标记 N 条」。
>
> 修法：loader 已经返回 `page`，把按钮限死在第 1 页——
> `{page === 1 && unread.length > 0 && newest && (…)}`，并在旁边留一行注释写清
> `upTo` 是「游标及更旧」、只有第 1 页的 `items[0]` 才是全局最新一条。
> 要让它在任意页可用，得先给 api 的 `markReadSchema` 加「全部」语义——那是另一条。

- [ ] **Step 4: 门禁 + 浏览器实测**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)`

用 Browser pane，三个页面各验一次：分页控件出现、第 1 页 href 不含 `?page=1`、翻到第 2 页内容不同、原有筛选/查询参数被保住。三次输出贴进报告。

**若某个页面的数据量不足一页**，在报告里说明，并用手工构造 `?page=2` 确认不崩。

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/dash/queue.tsx apps/web/app/routes/dash/reports.tsx apps/web/app/routes/notifications.tsx
git commit -m "$(cat <<'EOF'
fix(web): 审核队列/举报/通知三处取了 total 却没有分页控件

超过一页的内容在 UI 上不可达——与 T0 修过的香霖堂列表是同一个病。
但 queue/reports 比那次更糟：它们的 loader 根本不读 ?page，只写死 pageSize，
所以服务端永远返回第 1 页——只加控件的话点下一页是 URL 变、内容不变。

照抄 T0 已经做对的形状：pageWindow 共用、第 1 页不写 ?page=1、翻页保住现有 query。
ui/pagination 在 T3 已带 viewTransition，三处自动获得跨页转场。

notifications 的「全部已读」一并限死在第 1 页：upTo 的语义是「游标及更旧」，
第 2 页点它会静默漏掉第 1 页的未读，而 LiveRegion 还会播报一句看起来成功的话。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# 批次 1 · 四条 0 KB（先做，它是全站「到达感」的骨架，也是 motion 的对照基准）

### Task 3: 香霖堂封面的跨页 morph —— 这一套里唯一的跨页连续性

点一行进详情，今天是整页交叉淡出淡入：封面从行首 56px「消失」，再在页首 112px「出现」——用户要自己确认「这是不是我点的那个」。

**用 `useViewTransitionState` + `view-transition-name`，0 KB，不用 `layoutId`。**

`layoutId` 在这条路径上**做不成**，四条理由（勘察读 RR 源码得出）：
1. RR framework 模式整棵 `Outlet` 子树替换，**不存在列表行与详情封面同时挂载的那一帧**，而 `layoutId` 的交接需要旧节点仍注册在同一个 `LayoutGroup` 里
2. 唯一的共存办法是给 `<Outlet/>` 套 `AnimatePresence` 并按 pathname 加 key——但 framework 模式下**退场中的旧路由会拿到新的 loader 数据**（`useLoaderData` 由 location 派生），列表会在退场时闪一下详情页的数据
3. 它与 `ScrollRestoration` 抢时序：RR 在提交时的 layout effect 里复位滚动，而退场的旧树还占着文档高度，复位落在错误偏移上，旧树卸载后页面再跳一次
4. 就算全部绕开，还得给这条链接关掉 `viewTransition`，为一张图破掉「跨页到达归原生 VT 独占」的全站约定

**反过来，`useViewTransitionState` 正是为这件事造的**：RR 的两段式提交（先渲染一帧带 `isTransitioning`，**再**在 effect 里 `startViewTransition`）保证名字在旧快照被截之前就落到旧 DOM 上；而它对 `currentLocation` 与 `nextLocation` **都**匹配，所以**后退（详情 → 列表）会自动配对回同一行**——这是 `layoutId` 版本还要额外写的一件事。

**Files:**
- Modify: `apps/web/app/routes/kourindou/list.tsx`（行体抽成组件）
- Modify: `apps/web/app/routes/kourindou/detail.tsx`
- Modify: `apps/web/app/app.css`
- ~~Modify: `scripts/check-css-layers.ts`（加一条断言）~~ *修订：不改它*。该脚本是通用断言
  （命中 `::view-transition-` 即计数并检查是否分层），不含硬编码计数或规则名白名单，
  `kourindou-cover` 自动被覆盖。照原 Files 去「加一条断言」反而会引入一个
  每次新增 VT 规则都要同步的硬编码。Step 5 改为**只跑不改**。

**Interfaces:**
- Consumes: `useViewTransitionState`（react-router，稳定 API）
- Produces: `view-transition-name: kourindou-cover`

- [ ] **Step 1: 行体抽成组件**

`apps/web/app/routes/kourindou/list.tsx`：hook 不能写在 `.map()` 里，所以把 `items.map` 的行体抽成同文件内的 `function ResourceRow({ r }: { r: ... })`。

**这一步只做机械搬迁，不改任何 className 或结构**——`ink-row` / `pl-3` / `viewTransition` 全部原样带过去。改完先跑一次 `bun run typecheck` 与浏览器看一眼，确认列表长得和之前一模一样，再做 Step 2。

- [ ] **Step 2: 只给「被点的那一行」命名**

在 `ResourceRow` 里：

```tsx
  const to = localizeHref(`/kourindou/${r.slug}`)
  /**
   * 只给正在转场的那一行命名。同名元素在同一帧出现两个，整次 view transition
   * 会被浏览器静默放弃——所以绝不能给所有行都挂上。
   *
   * useViewTransitionState 对 currentLocation 与 nextLocation 都匹配，
   * 所以后退（详情 → 列表）会自动配对回同一行，不需要额外写。
   */
  const morphing = useViewTransitionState(to)
```

然后给封面 `<img>` **与无封面时的 `bg-muted` 占位**都挂：

```tsx
          style={{ viewTransitionName: morphing ? 'kourindou-cover' : undefined }}
```

（两个分支都要挂，否则无封面的资源转场时会突然少一个命名元素。）

- [ ] **Step 3: 详情页无条件挂同名**

`apps/web/app/routes/kourindou/detail.tsx` 的 `size-28` 封面与它的占位，都挂：

```tsx
          style={{ viewTransitionName: 'kourindou-cover' }}
```

详情页同一时刻只有一个封面，所以无条件挂即可。

- [ ] **Step 4: 曲线**

`apps/web/app/app.css` **文件末尾那段不分层的 VT 规则区**（现在只有 `::view-transition-old/new(root)`）里加：

```css
/* 香霖堂封面的跨页 morph：列表 56px → 详情 112px。
   它是**位移/尺寸**类，所以走纸·落（--ease-washi）而不是 root 那条墨·洇。

   两侧都是正方形（size-14 / size-28）且都 object-cover，所以 morph 是纯缩放，
   old/new 的交叉淡入几乎看不见。**哪天有一侧不再是正方形，这条会立刻变成挤压**——
   到时要么让两侧比例一致，要么给 old/new 单独写 object-fit 过渡。 */
::view-transition-group(kourindou-cover) {
  animation-duration: var(--transition-duration-washi-lg);
  animation-timing-function: var(--ease-washi);
}
```

**不要放进任何 `@layer`**——VT 伪元素在 UA origin。文件末尾降级块里已有的 `::view-transition-group(*) { animation: none !important }` 会自动覆盖它，不需要另写降级。

- [ ] **Step 5: 门禁加断言**

`scripts/check-css-layers.ts` 已经断言「所有 `::view-transition-*` 规则不分层」——`kourindou-cover` 这条会被现有断言自动覆盖。**先跑一遍确认**：

Run: `bun run build >/dev/null 2>&1 && cd /Users/i/Code/th && bun run check-css-layers`
Expected: `::view-transition-*` 的计数从 5 涨到 6，且仍全部不分层。若计数没涨，说明规则没进产物（可能是 Tailwind 把它当未使用剪掉了——VT 伪元素不该被剪，若真发生请报告）。

- [ ] **Step 6: 浏览器实测（三条断言，缺一不可）**

用 Browser pane：

**① 禁 JS 的首屏 HTML 里不得有 `view-transition-name`**（它是运行时状态，不该进 SSR 产物）：
```bash
curl -s http://localhost:<port>/kourindou | grep -c 'view-transition-name' || echo 0
```
Expected: `0`

**② 前进与后退各触发一次 VT**：给 `document.startViewTransition` 打桩计数，点一行进详情（+1），浏览器后退（再 +1）。

**③ 转场中同名元素有且只有一个**（这条最要紧——两个同名会让整次转场被静默放弃）：
```js
window.__vt = 0
const orig = document.startViewTransition.bind(document)
document.startViewTransition = (cb) => {
  window.__named = [...document.querySelectorAll('*')]
    .filter(el => getComputedStyle(el).viewTransitionName === 'kourindou-cover').length
  window.__vt++
  return orig(cb)
}
document.querySelectorAll('main ul li a')[2].click()
await new Promise(r => setTimeout(r, 1200))
JSON.stringify({ vt: window.__vt, namedAtCapture: window.__named, url: location.pathname })
```
Expected: `vt: 1`、**`namedAtCapture: 1`**、URL 进了详情页。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/kourindou/list.tsx apps/web/app/routes/kourindou/detail.tsx apps/web/app/app.css
git commit -m "$(cat <<'EOF'
feat(web): 香霖堂封面跨页 morph（0 KB，用原生 VT 不用 layoutId）

点一行进详情今天是整页交叉淡出：封面从行首 56px 消失、再在页首 112px 出现，
用户要自己确认「这是不是我点的那个」。命名之后它是同一张纸被拿起来放大。

刻意不用 layoutId：RR framework 模式整棵 Outlet 子树替换，不存在列表行与
详情封面同时挂载的那一帧；唯一的共存办法（给 Outlet 套 AnimatePresence）会让
退场中的旧路由拿到新的 loader 数据，列表退场时闪一下详情页数据；它还与
ScrollRestoration 抢时序。而 useViewTransitionState 对 current 与 next 都匹配，
后退会自动配对回同一行。

只给正在转场的那一行命名——同名元素出现两个，整次转场会被静默放弃。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 三条 0 KB 的小修（未读徽章 / 星条 hover / 通知行反馈）

三条都很小、都不需要 motion，合成一个任务、**三个 commit**。

**Files:**
- Modify: `apps/web/app/components/site-header.tsx`（A）
- Modify: `apps/web/app/routes/kourindou/detail.tsx`（B）
- Modify: `apps/web/app/routes/notifications.tsx`（C）　*修订：`profile.tsx` 已从 C 划掉，理由见 Step C1*

- [ ] **Step A1: 未读徽章不卸载节点**

`site-header.tsx` 现在是 `{user.unread > 0 && <span>…</span>}`——**节点被移除，所以没有任何过渡的挂载点**。

改成始终渲染、用类切换可见性：

```tsx
                <span
                  className={`absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground transition-[opacity,scale] ${
                    user.unread > 0 ? 'opacity-100 scale-100' : 'scale-75 opacity-0'
                  }`}
                  aria-hidden={user.unread === 0}
                >
                  {user.unread >= 100 ? '99+' : user.unread}
                </span>
```

**用 CSS 消掉问题，比用 motion 动画化问题便宜**——而且 `site-header.tsx` 在 A2 的禁令名单里，本来就不许引 motion。

`aria-hidden={user.unread === 0}` 不能省：数字为 0 时它视觉上消失了，但仍在 DOM 里，读屏用户会读到一个孤零零的「0」。

- [ ] **Step A2: 提交**

```bash
git add apps/web/app/components/site-header.tsx
git commit -m "$(cat <<'EOF'
fix(web): 未读徽章不再卸载节点，改用类切换

{unread > 0 && <span>} 会移除节点，于是没有任何过渡的挂载点。
始终渲染 + opacity/scale 类切换，180ms 的墨曲线淡出完全等价，0 KB。
数字为 0 时补 aria-hidden，否则读屏用户会读到一个孤零零的「0」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step B1: 星条 hover 累积填充**

`detail.tsx` 的五个星按钮各自挂 `hover:text-chart-2`——**悬停第 4 颗只亮第 4 颗，不亮 1–4**。这是既有 bug，也是计划五那条 MotionValue 星条的无 JS 降级底座。

用兄弟选择器修：给 `<Form>`（或包裹容器）加 `group/stars`，然后让每个按钮在「自己或自己右边的兄弟被 hover」时点亮。

> *修订：原方案（`flex-row-reverse` + `[5,4,3,2,1]`）已否决。* 它把 DOM 序与视觉序解耦：
> 视觉上仍是 1→5，但 Tab 序与读屏朗读序变成 5→4→3→2→1——键盘用户第一次 Tab 进来落在
> 最右边的「5 星」，继续 Tab 往左走。而每颗星都带着 `aria-label={\`${m.detail_rate()} ${n}\`}`。
> **这是 WCAG 2.4.3（Focus Order）/ 1.3.2（Meaningful Sequence）的典型形态**——
> 原方案为键盘用户补了 `:focus-visible` 的填充，却在同一改动里把他们的遍历方向倒过来了。
>
> 另外原代码块凭空造了一个 `<div className="ml-auto flex flex-row-reverse items-center gap-1">`，
> 而**当前文件里没有这个 div**：按钮是 `<Form>` 的直接子元素，`ml-auto flex items-center gap-1`
> 这三个类正长在 `<Form>` 上，`<Form>` 里还有决定 action 分支的
> `<input type="hidden" name="intent" value="rate" />`。照抄那个代码块最省事的做法
> 就是拿它替换 `<Form>` 那一行——表单会当场坏掉。

**保留 `[1, 2, 3, 4, 5]` 与现有 DOM／视觉同序**，改用**向后看**的 `:has()` 兄弟选择器
（「我后面有任何一个兄弟被 hover」就点亮自己）：

```tsx
                <button
                  …
                  className="text-muted-foreground transition-colors hover:text-chart-2 focus-visible:text-chart-2 [&:has(~*:hover)]:text-chart-2 [&:has(~*:focus-visible)]:text-chart-2"
                >
```

**`:focus-visible` 的那两份不能省**——键盘用户同样需要看到累积填充。
`<Form>` 与那个 hidden input 一个字都不要动。

`:has()` 的浏览器支持与 T1–T2 已经在用的 `.paper-lift:has(:focus-visible)` / `.ink-row:has(:focus-visible)`
同档，不引入新的兼容负担。

- [ ] **Step B2: 浏览器实测 + 提交**

用 Browser pane：注入伪 hover（`transition: none !important` 见 memory 里那条），确认悬停第 4 颗时第 1–4 颗都是 `--chart-2` 色、第 5 颗不是。

```bash
git add apps/web/app/routes/kourindou/detail.tsx
git commit -m "$(cat <<'EOF'
fix(web): 星条悬停第 4 颗只亮第 4 颗

五个按钮各自挂 hover:text-chart-2，没有累积填充——评分控件的基本预期。
用 flex-row-reverse + 兄弟选择器修，0 KB，同时给 :focus-visible 一份。
这也是后续 MotionValue 版星条的无 JS 降级底座。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step C1: 通知行与个人页帖子行加 `.ink-row`**

`notifications.tsx` 的通知条目是可点 `<Link className="block">`，**零 hover/focus 反馈**。

而 T1–T2 建的 `.ink-row`（左缘朱线，含 hover / focus-visible / `:has(:focus-visible)` 三个分支与减弱动效降级）**全仓只有 `kourindou/list.tsx` 一处在用**。

> *修订两处*：
>
> **① `profile.tsx` 从本步划掉。** 那里根本没有「可点的帖子行」：`<li>` 不可点，
> 唯一的 `<Link>` 是夹在 `{m.profile_in()}` 之后的**行内标题链接**，而且**它已经有
> `hover:underline`**——不是「零反馈」。把 `ink-row pl-3` 挂上去，会在句子中段
> （「在」和标题之间）竖起一根 2px 朱线，并给行内元素塞 12px 左内边距。那不是行反馈，是排版事故。
>
> **② `ink-row` 挂 `<li>` 而不是内层 `<Link>`。** notifications 的行内边距长在
> `<li className="py-3">` 上（与被抄的 `list.tsx` 正相反），而 `.ink-row::before` 用
> `inset-block: 0`——挂在内层 `<Link>` 上，朱线只有正文那么高、上下各缺 12px。
> `.ink-row` 的 `:has(:focus-visible)` 分支正好覆盖内部的 `<Link>`，键盘反馈不丢。

`notifications.tsx` 的 `<li className="py-3">` 加 `ink-row` 与 `pl-3`（给朱线让位）。

- [ ] **Step C2: 浏览器实测 + 提交**

确认通知页的行有朱线（常态 `scaleY(0)`，注入终态后 `scaleY(1)`、色为 `--primary`），
朱线**高度等于整个 `<li>`**（不是只有正文那么高），且无横向溢出。

```bash
git add apps/web/app/routes/notifications.tsx
git commit -m "$(cat <<'EOF'
fix(web): 通知行与个人页帖子行补上 hover/focus 反馈

通知条目是可点的 <Link> 却零反馈。T1–T2 建的 .ink-row（左缘朱线，含三个分支
与减弱动效降级）全仓只有香霖堂列表一处在用。

挂在 <li> 而不是内层 <Link> 上：行内边距长在 <li> 上，而 .ink-row::before 用
inset-block: 0，挂内层朱线会上下各缺 12px。

profile.tsx 不在此列——那里没有可点的帖子行，只有一个夹在句子中间、
已经带 hover:underline 的行内标题链接。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# 批次 2 · 装 motion，第一个界面是 /dash

### Task 5: 装 motion 并立边界

本任务**不产生任何可见效果**，但它决定后面五条的时长真的是我们的曲线，也把 A2 的禁令变成可执行的断言。

**两条源码事实是承重的：**
- `MotionConfigContext` 的默认 `reducedMotion` 是 `"never"`——不写它，`app.css` 末尾那个不分层的兜底块**管不到 motion 的任何一条**
- 布局动画的兜底是 `{duration: 0.45, ease: [0.4, 0, 0.1, 1]}`——不给就是 450ms 的外来缓动

**Files:**
- Modify: `apps/web/package.json`（装包）
- Create: `apps/web/app/lib/motion.ts`
- Create: `apps/web/app/lib/motion.test.ts`
- Modify: `apps/web/app/root.tsx`
- ~~Modify: `biome.json`~~ *修订：不改它*。它是 A3 亲手撤销的那条 `noRestrictedImports` 方案的残留——
  Step 1–7 没有任何一步说要把它改成什么，仓库里也从没加过那条规则。**留在 Files 与 `git add` 里
  最可能的后果，是照单办事的实现者把本计划亲手撤销的规则加回来。**
- Create: `scripts/check-motion-boundary.ts`
- Modify: `package.json`（根，scripts）
- Modify: `.github/workflows/ci.yml`　*修订：新增*。根 `package.json` 的 `check` 就是
  `biome check .` 一条命令，`check-motion-boundary` 折不进去，就必须在 CI 里单列一行——
  否则这道门禁只存在于本地，等于没有。

**Interfaces:**
- Consumes: 无
- Produces: `EASE_SUMI` / `EASE_WASHI` / `EASE_FUDE`（TS 字面值）、`SPRING_WASHI`；`bun run check-motion-boundary`

- [ ] **Step 1: 装包**

Run: `cd /Users/i/Code/th/apps/web && bun add motion`

**写进 `dependencies` 不是 `devDependencies`**——SSR 运行时真的 import 它。**必须同时提交 `bun.lock`**：`deploy/Dockerfile` 是 `bun install --frozen-lockfile`，不提交 lock 会让生产构建直接失败。

**Dockerfile 一行都不用改**（已实测：`build/server/index.js` 里 motion 是外置的裸 import，与 react-router / radix-ui 同档；Dockerfile 已把两处 node_modules 整棵拷进运行镜像，相对符号链接仍成立）。

- [ ] **Step 2: 曲线的 TS 字面值 + 断言它与 CSS 一致**

创建 `apps/web/app/lib/motion.ts`：

```ts
/**
 * 三材曲线的 TS 字面值。
 *
 * **必须再抄一份**：motion 的 `ease` 不接受 `var(--ease-washi)`，它要数组。
 * 所以同一条曲线在仓库里有两份权威——`app.css` 的 `@theme` 与这里。
 * `motion.test.ts` 断言两者逐字符相等，别靠注释。
 *
 * 语义边界（这是「一套动效」而不是「一堆效果」的判据）：
 *   washi = 位置连续性（我点的那个东西去哪了）
 *   sumi  = 远端回执（它办完了吗）
 *   fude  = 一笔画出来（只给 scaleX 类延展）
 */
export const EASE_SUMI = [0, 0.408, 0.501, 0.75] as const
export const EASE_WASHI = [0.212, 0.091, 0.259, 0.953] as const
export const EASE_FUDE = [0.244, 0, 0.756, 1] as const

/** ζ=1 临界阻尼。`bounce: 0` 就是它的正确编码——纸不会弹，全域禁 overshoot */
export const SPRING_WASHI = {
  type: 'spring',
  visualDuration: 0.28,
  bounce: 0,
} as const
```

创建 `apps/web/app/lib/motion.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EASE_FUDE, EASE_SUMI, EASE_WASHI } from './motion'

const css = readFileSync(join(import.meta.dir, '../app.css'), 'utf8')

/** 从 app.css 的 @theme 里读出某条曲线的四个数 */
function cubicFromCss(name: string): number[] {
  const mo = css.match(new RegExp(`--ease-${name}:\\s*cubic-bezier\\(([^)]+)\\)`))
  if (!mo) throw new Error(`app.css 里找不到 --ease-${name}`)
  return mo[1].split(',').map((s) => Number(s.trim()))
}

describe('三材曲线的 TS 字面值与 app.css 一致', () => {
  test('sumi', () => expect(cubicFromCss('sumi')).toEqual([...EASE_SUMI]))
  test('washi', () => expect(cubicFromCss('washi')).toEqual([...EASE_WASHI]))
  test('fude', () => expect(cubicFromCss('fude')).toEqual([...EASE_FUDE]))
})
```

- [ ] **Step 3: `MotionConfig` 挂 root（root 树唯一允许的 motion 用法）**

`apps/web/app/root.tsx` 的 `App` 里，把最外层那个 `<div className="flex min-h-screen flex-col">` 包一层：

```tsx
    {/**
      * root 树里唯一允许的 motion 用法（见 A2）。两个 prop 都是承重的：
      *   reducedMotion —— 默认是 "never"，不写它 app.css 末尾那个不分层的兜底块
      *     管不到 motion 的任何一条
      *   transition —— 布局动画的兜底是 { duration: 0.45, ease: [0.4,0,0.1,1] }，
      *     不给就是 450ms 的外来缓动
      *
      * 将来加 CSP 时这里要同时给 nonce：AnimatePresence 的 popLayout 会往
      * document.head 注 <style>（PopChild 用它定位退场元素）。没有 nonce
      * 就是生产上弹层与退场动画静默失效——而症状离原因很远。
      */}
    <MotionConfig reducedMotion="user" transition={SPRING_WASHI}>
      <div className="flex min-h-screen flex-col">
        …
      </div>
    </MotionConfig>
```

import：`import { MotionConfig } from 'motion/react'` 与 `import { SPRING_WASHI } from '~/lib/motion'`。

> *修订两处*：① 原文让这里**手抄** `{ type: 'spring', visualDuration: 0.28, bounce: 0 }`
> 的字面值，而同一个任务的上一步刚建了 `SPRING_WASHI` 这个常量，Task 6/7 也都是正经
> import 它——同一条曲线在同一份计划里出现第三份权威，第一次改它就会漏掉这处。
> ② 红线 9 后半句「CSP 要给 nonce」原本只留在红线表里，现在落成这里的注释。

**两条 prop 都不能省**：`reducedMotion` 的默认是 `"never"`；`transition` 不给就是 450ms 的外来缓动。

- [ ] **Step 4: 边界断言脚本**

创建 `scripts/check-motion-boundary.ts`，体例照 `scripts/check-css-layers.ts`（中文注释讲清为什么、`✓`/`✗` + 退出码）。断言两条：

1. **`app/root.tsx` 是 root 树里唯一允许出现 `motion/react` 的文件，且只允许 `MotionConfig`**——即它的 import 语句里不得出现 `motion`、`AnimatePresence`、`LazyMotion`、`domMax` 等其他名字
2. **root 可达图里的其余文件零命中 `motion/react`**

> *修订：不要硬编码文件名单。* 原文列了四个文件，而实测 root 可达图不止这些——
> `root.tsx` → `site-header.tsx` / `site-footer.tsx`；`site-header.tsx` → `lang-switcher.tsx` /
> `mobile-nav.tsx` / `pending-bar.tsx` / `theme-toggle.tsx` / `ui/dropdown-menu.tsx`。
> 漏掉的四个（`site-footer` / `lang-switcher` / `theme-toggle` / `ui/dropdown-menu`）里，
> **后两个恰是最想加 motion 的位置**（主题切换的 `startViewTransition`、Radix 弹层动效）。
>
> 更根本的问题是**硬编码名单会腐烂**：T3 刚往 root 树旁边加了 `live-region.tsx`，
> 名单在写下来的那一刻就开始过期。
>
> **正确形状：从 `app/root.tsx` 出发递归解析本地 import（相对路径与 `~/` 别名），
> 对整棵可达集断言零命中 `motion/react`**（`root.tsx` 例外且只许 `MotionConfig`）。
> 这样新增 root 树文件自动纳入，不需要有人记得回来改名单。
> 脚本要把**解析出的可达集文件数**打印出来——数字变化本身就是信号。

理由写进脚本注释：实测 motion 出现在 root 的可达图里 = **首屏 +37.31 KB**，而这个站流量最大的页面是被外链进来的 `/kourindou/:slug` 匿名读者。

根 `package.json` 加 `"check-motion-boundary": "bun run scripts/check-motion-boundary.ts"`。

**这条要接进 `bun run check`**（它只读源码、不需要构建产物，与 `check-css-layers` 不同）——若接进去会让 Biome 那条变慢，就单独列一条并写进 CLAUDE.md 的门禁顺序。

- [ ] **Step 5: 正反验证边界断言**

1. 当前状态跑 → 通过
2. **临时**在 `app/components/site-header.tsx` 顶部加 `import { motion } from 'motion/react'` → **必须失败并指名文件**
3. `git checkout --` 还原 → 恢复通过

三步实际输出贴进报告。

- [ ] **Step 6: 全量门禁 + 体积**

Run:
```bash
cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && \
  (cd apps/web && bun test) && (cd apps/web && bun run build >/dev/null 2>&1) && \
  bun run check-css-layers && bun run check-motion-boundary && bun run check-bundle-size
```
**Expected: `check-bundle-size` 的首屏集必须几乎不变**（`MotionConfig` 实测 +0.46 KB）。若它涨了几十 KB，说明有 root 树文件引了 motion——`check-motion-boundary` 应当已经先抓到。

把 `check-bundle-size` 的实际数字贴进报告，**下一个任务要用它做对照**。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/package.json bun.lock apps/web/app/lib/motion.ts apps/web/app/lib/motion.test.ts apps/web/app/root.tsx scripts/check-motion-boundary.ts package.json .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat(web): 装 motion 并立边界——全量 motion，不用 LazyMotion

不用 LazyMotion：chunk 划分是构建期静态的，`{user && <LazyMotion>}` 是运行时
条件，「匿名访客一个字节不下载」这句话是假的。实测 LazyMotion 同步版 45.91 vs
全量 motion 45.88——它反而贵 0.03 KB；而 motion 本来就落进一个共享 chunk、
只被引用它的路由 import（login/register/home 增量 0.00）。「下沉到叶子」是
rolldown 已经免费做完的事。

root 树一律不进 motion 树：实测 motion 进 root 可达图 = 首屏 +37.31 KB，
而流量最大的页面是被外链进来的 /kourindou/:slug 匿名读者。
新增 check-motion-boundary 把这条钉成断言（root.tsx 只许 MotionConfig，
site-header/mobile-nav/pending-bar/ui/button 零命中）。

MotionConfig 的两个 prop 都是承重的：reducedMotion 默认是 "never"，不写它
app.css 的兜底块管不到 motion；transition 不给就是 450ms 的外来缓动。

三条曲线的 TS 字面值由 motion.test.ts 断言与 app.css 逐字符相等——
motion 的 ease 不接受 var()，同一条曲线必然有两份权威。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: dash tab 下划线 —— 位置连续性的最短示范

`dash/layout.tsx` 的五个 tab 切换时，`border-primary` 从 A 直接跳到 B。更实际的问题是**时机**：`NavLink` 的 `isActive` 读的是**已提交**的 location，要等目标 tab 的 loader 返回才翻转——而每个 tab 的 loader 都要打 API，切一次有 150–400ms 页面完全不动。T1 的 pending 墨线在 header 顶端，视线在 tab 上的人看不见。

**下划线在点击那一刻就走。** 审核员一天切 20–40 次。

`routes.ts` 的 `layout()` 让 dash 布局在五个 tab 间**持续挂载**，所以「跨路由 `layoutId` 不安全」那条约束在这里不适用。

**Files:**
- Modify: `apps/web/app/routes/dash/layout.tsx`

**Interfaces:**
- Consumes: `motion`、`SPRING_WASHI`（`~/lib/motion`）、`useNavigation`
- Produces: 无

- [ ] **Step 1: 先确认 T3 没给这五个 NavLink 加 `viewTransition`**

Run: `cd /Users/i/Code/th/apps/web && grep -n "viewTransition" app/routes/dash/layout.tsx || echo "（无，正确）"`

**它一定在**（不是「应当没有」）——*修订*：T3 的补全是**无差别**的 33/33，不存在原文说的
「T3 已把这五个显式判为不加」这回事，控制者当时的裁定就是「VT 是导航机制，/dash 也加」。
所以本步是**确定要做的一次摘除**，不是条件分支。

摘掉的理由：原生 VT 会把整页截快照，`layoutId` 的滑动会被压进 `::view-transition-new(root)`
的快照里，看不见。

**三条硬约束：**

1. **只摘 `app/routes/dash/layout.tsx` 的那一个 `NavLink`。绝不能顺手摘
   `app/components/ui/pagination.tsx` 的**——那一处覆盖香霖堂列表、讨论区楼层、个人页三处分页，
   而 Task 2 刚给 /dash 加的分页控件也复用它。摘掉会把三个页面的翻页转场一起打掉。
2. 删除处**留一行注释**说明：dash tab 是全站唯一不带 `viewTransition` 的导航链接，
   因为原生 VT 的 root 快照会吞掉 `layoutId` 下划线的滑动。没有这行注释，
   下一次「viewTransition 补全扫描」会把它加回来。
3. **必须就地修订 `CLAUDE.md`**——它现在写着「全站导航链接一律带 `viewTransition`
   （33/33，含 `/dash`）」。改成 32/33 并写明唯一例外。这条约定 CLAUDE.md 自己
   写着「没有门禁能抓」，留着矛盾就是留着一个必然复发的 bug。

- [ ] **Step 2: 用 `layoutId` + 抢跑的 active 判定**

`apps/web/app/routes/dash/layout.tsx`：

> ⚠️ ***修订：原文这段逐字代码会把 `/dash` 全部打成 500，而门禁全绿放行。***
> 原文写的是 `navigation.location?.pathname ?? location.pathname`，但
> `dash/layout.tsx` **只 import 了 `NavLink, Outlet, redirect`，没有任何 `location` 绑定**。
> SSR 时 `navigation.state === 'idle'`、`navigation.location === undefined`，
> 右侧一定会被求值 → 落到全局 `location`，而 Bun 与 Node 都没有这个全局
> （`bun -e 'console.log(typeof location)'` → `undefined`）→ `ReferenceError` → 五个 tab 页全 500。
>
> **而 `bun run typecheck` 不会报**：`apps/web/tsconfig.json` 的 `"lib": ["DOM", …]`
> 让 `location` 有全局类型。照抄 + 全绿 = 生产 500。**必须显式绑定 `useLocation()`。**

```tsx
import { motion } from 'motion/react'
import { useLocation, useNavigation } from 'react-router'
import { SPRING_WASHI } from '~/lib/motion'
```

在组件里：

```tsx
  const navigation = useNavigation()
  const location = useLocation()   // ← 不能省；没有它右边那个 location 是不存在的全局
  /**
   * 抢跑：NavLink 的 isActive 读的是已提交的 location，要等 loader 回来才翻转。
   * 而每个 tab 的 loader 都要打 API，切一次有 150–400ms 页面完全不动。
   * 用 pending location 让下划线在**点击那一刻**就走。
   *
   * useNavigation() 是**全局**导航状态，不限于 dash 内部——从 /dash 点去
   * /kourindou 时它也会给出 pending location。所以只在目标仍属于 dash 时才抢跑，
   * 否则下划线会在离开 dash 的那一瞬间先跳到一个不存在的 tab 上。
   */
  const pending = navigation.location?.pathname
  const activePath =
    pending && TABS.some((t) => pending.startsWith(localizeHref(t.to)))
      ? pending
      : location.pathname
```

把每个 tab 的渲染改成：外层 `NavLink` 加 `relative`、去掉 `border-b-2 border-primary`（**保留 `border-transparent` 占位**，否则高度会跳），active 的那个内部渲染：

```tsx
              {isActive && (
                <motion.span
                  layoutId="dash-tab-underline"
                  transition={SPRING_WASHI}
                  className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-primary"
                />
              )}
```

其中 `isActive` 用上面的 `activePath` 判定，**不用 NavLink 的 render prop**。

> *修订（几何）*：原文用 `-bottom-px`。绝对定位的包含块是父元素的 **padding box**，
> 不含那 2px 的 `border-transparent` 占位——`bottom: -1px` 的 2px 条会落在 border-box
> 底边**上方** 1px–3px 处，比今天的 `border-b-2` 高一格，也不再压住 nav 自己的底线。
> `-bottom-0.5`（-2px）才与被替换的 `border-b-2` 对齐。**Step 4 的实测要量这一条**：
> 切换前后下划线的 `getBoundingClientRect().bottom` 应与 NavLink 的 border-box 底边重合。

**这是全站唯一允许用 `layout`（both）语义的地方**——它是纯色条，没有内容可失真（红线 3）。

- [ ] **Step 3: 处理折行**

`nav` 是 `flex-wrap`，admin 有 5 个 tab，窄屏会折行——此时下划线会从上一行**斜穿**到下一行，观感很差。

在窄屏断点下退回纯 CSS：给下划线加 `hidden sm:block`，并给 active 的 `NavLink` 在窄屏下保留一个静态的 `sm:border-transparent border-b-2 border-primary`。

**具体断点以实际折行点为准**——Step 4 的实测要量出它在多宽开始折行。

- [ ] **Step 4: 浏览器实测**

用 Browser pane，以审核员身份进 `/dash`：

1. **抢跑**：点「举报处理」，**在 loader 返回之前**（<100ms）读下划线所在的 tab——应当已经在新 tab 下面
2. **滑动**：确认它是移动而不是消失再出现（读 `document.querySelectorAll('[data-projection-id]')` 或用注入 `transition:none` 的办法读两端位置）
3. **折行**：`resize_window` 逐步收窄，量出 `nav` 在多宽开始折行，确认该宽度下下划线已退回静态
4. **减弱动效**：确认 `MotionConfig reducedMotion="user"` 下它是瞬时跳到新 tab（信息不丢）

四条输出贴进报告。

- [ ] **Step 5: 门禁 + 体积对照**

Run:
```bash
cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test) && \
  (cd apps/web && bun run build >/dev/null 2>&1) && \
  bun run check-css-layers && bun run check-motion-boundary && bun run check-bundle-size
```

**Expected: 首屏集与 Task 5 记录的数字一致（motion 没有泄进 root）**，而 `/dash` 路由的增量应当出现。把两个数字都贴进报告。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/dash/layout.tsx
git commit -m "$(cat <<'EOF'
feat(dash): tab 下划线用 layoutId 滑动，并在点击那一刻就走

价值的一半在抢跑：NavLink 的 isActive 读已提交的 location，要等 loader 回来
才翻转，而每个 tab 的 loader 都要打 API——切一次有 150–400ms 页面完全不动，
而 T1 的 pending 墨线在 header 顶端，视线在 tab 上的人看不见。
用 navigation.location 让下划线在点击瞬间就走。审核员一天切 20–40 次。

routes.ts 的 layout() 让 dash 布局在五个 tab 间持续挂载，所以「跨路由 layoutId
不安全」那条约束在这里不适用。这也是全站唯一允许 layout(both) 的地方——
纯色条，没有内容可失真。

flex-wrap 折行时下划线会斜穿，窄屏退回静态边框。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: dash 条目移除 —— 全站最有说服力的一处 FLIP

`AnimatePresence` 单独只能让卡片**原地淡出**、下方等它淡完才跳。`popLayout` 让它**同一帧脱离文档流**，兄弟身上的 `layout="position"` 把它们从旧位置**平移**到新位置。

**乐观移除是它不是净成本的原因**：现状是 action 一趟 → revalidate → 卡片才消失，非乐观时动画串在网络之后、每条 +280ms；乐观之后动画与往返重叠，增量 0ms。

**Files:**
- Modify: `apps/web/app/routes/dash/queue.tsx`、`apps/web/app/routes/dash/reports.tsx`
- Modify: `apps/web/messages/{zh,ja,en}.json`　*修订新增*：红线 8 的播报文案
- ~~Modify: `apps/web/app/app.css`（`.ink-divide` 跳过退场元素）~~　*修订：不改*。
  实测两个列表容器是 `grid gap-*` 而不是 `.ink-divide`，详见 Step 4。

**Interfaces:**
- Consumes: `motion`、`AnimatePresence`、`useInView`、`SPRING_WASHI`、`EASE_SUMI`
- Produces: 无

- [ ] **Step 1: fetcher 提到列表层并具名**

每张卡现在各自持有一个 `useFetcher()`（默认 key 是 `useId()`）。乐观移除需要列表层认出「哪一行在途」。

把 `ReviewActions` 里的 `useFetcher()` 改成 `useFetcher({ key: \`review:${id}\` })`，列表层：

```tsx
  const pending = new Set(
    useFetchers()
      .filter((f) => f.state !== 'idle' && f.key.startsWith('review:'))
      .map((f) => f.key.slice('review:'.length)),
  )
  const visible = items.filter((r) => !pending.has(r.id))
```

**RR8 的 fetcher persistence 是这套方案成立的前提**（已读源码确认）：在途 fetcher 在组件卸载后仍留在 `state.fetchers` 直到结算，所以乐观移除的集合不会闪断。

**但 `fetcher.data` 会被主动丢弃**——卡片卸载后拿不回错误。所以 **T3 Task 3 的错误码修复是硬前置**：卡片飞出去又飞回来时如果没有真实错误码，审核员只会看到一次无法解释的抖动。

> ⚠️ ***修订：原文给的 effect 永远不会触发。***
> 它的守卫是 `fetcher.state === 'idle' && fetcher.data?.ok === false`，
> 而卡片正是因为 `f.state !== 'idle'` 才被过滤出 `visible` 的——
> **两个条件互斥**。fetcher 一进 `submitting`，卡片当帧就从列表里消失、`ReviewActions` 卸载；
> 等到 `state === 'idle'` 时组件早已不在，effect 不可能再跑。
> 计划自己标注「最要紧」的那条验收（Step 5 第 3 条：失败卡飞回来且带真实文案）必然失败。

**正确形状：把「盯梢」从卡片里搬到列表层，让它在卡片卸载之后仍然活着。**

hooks 不能在循环里调，所以每个在途 id 需要一个自己的小组件——它**不渲染任何东西**，
只持有那个 key 的 fetcher 并在结算时上报：

```tsx
/**
 * 只做一件事：替一个已经飞出去的卡片守着它的 fetcher，结算时把失败码交给列表层。
 *
 * 为什么不能写在卡片里：卡片是因为 fetcher 非 idle 才被移出 visible 的，
 * 它在 submitting 的那一帧就卸载了，而 data 要到 idle 才有——两个时刻不重叠。
 *
 * 它挂在 AnimatePresence **之外**，所以不参与退场、也不影响 layout 测量。
 * 它持有同一个 key，因此那个 fetcher 始终有一个活着的订阅者，
 * RR 不会把它排进 queueFetcherForDeletion，data 也就不会被清掉。
 */
function PendingWatcher({
  id,
  onSettled,
}: {
  id: string
  onSettled: (id: string, code?: string) => void
}) {
  const fetcher = useFetcher<typeof action>({ key: `review:${id}` })
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return
    onSettled(id, fetcher.data.ok === false ? fetcher.data.code : undefined)
  }, [fetcher.state, fetcher.data, id, onSettled])
  return null
}
```

列表层为每个在途 id 渲染一个，并把失败码收进 state 显示出来。
`onSettled` 必须是 `useCallback` 稳定引用（它进了那边 effect 的依赖）。

**reports.tsx 的三处不同，派工必须写清**（实测）：
1. 组件不叫 `ReviewActions`，是 `function Actions({ r }: { r: Item })`，**收整行不收 id**；
2. key 前缀必须是 `report:` 而**不能与 queue 共用 `review:`**——两个页面的 action 返回形状不同；
3. 它一个 fetcher 承载三个 intent（`delete_post` / `resolved` / `rejected`），
   所以「在途 = 该行要移除」这个等式在 reports 上**未必成立**——
   实现者要先判断哪些 intent 才意味着「这一行从列表里走了」，报告里写清判断依据。

- [ ] **Step 2: `AnimatePresence popLayout` + 兄弟 `layout="position"`**

容器加 `relative`（红线 9：`PopChild` 用 `offsetTop`/`offsetLeft` 定位）：

```tsx
      <div className="relative mt-6 grid gap-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((r) => (
            <motion.div
              key={r.id}
              layout="position"
              initial={false}
              exit={{ opacity: 0 }}
              transition={{ ...SPRING_WASHI, opacity: { duration: 0.18, ease: EASE_SUMI } }}
            >
              <Card>…</Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
```

- **`layout="position"` 不是 `layout`**（红线 3）：Card 挂着 `backdrop-filter`，both 会做 scale 校正 → 背板模糊重算 + CJK 正文被拉伸。
- **`exit` 只有 `opacity`**（红线 4）：位移键在 reduced-motion 下是瞬移到终点。
- **位置走 washi（spring）、不透明度走 sumi**——这正是两条曲线的语义分工。

- [ ] **Step 3: `useInView` 门控 layout 的规模（红线 2）**

`layout` 会在每次布局变化时测量**全部**带 `layout` 的子元素。实测判定线是 ≤50 项。

> *修订（理由要换，结论不变）*：原文说「而队列可能更长」——**不成立**。两个 loader 都硬编码
> `pageSize: '50'`（Task 2 之后仍是 50），API 侧 schema 上限 100，所以列表**恒 ≤50**。
> 但 50 **正好压在判定线上**（≈30ms，一帧半），门控之后降到约 4–6 张（≈17ms）。
> 「刚好踩线所以门控」是真理由；「可能更长」是假的，留着它下一个人会据此把 pageSize 调大。

给每张卡加视口门控：只有在视口内（`margin: '200px'`）时才带 `layout="position"`，视口外的不带。门控后 FLIP 规模降到约 4–6 张卡（≈17ms），观感一模一样。

**这是 `useInView` 在这个站的唯一用途——不是入场触发。**

- [ ] **Step 4: `.ink-divide` 跳过退场元素**

`popLayout` 把退场元素改成 `position: absolute` 却**仍留在 DOM 里**，`.ink-divide > * + *` 的 `+` 选择器照常匹配——**退场卡会带着自己那条墨界线飘出去**。

`apps/web/app/app.css` 的 `.ink-divide > * + *` 改成：

```css
  /* :not([data-exiting]) —— popLayout 的退场元素仍在 DOM 里（只是 position:absolute），
     不排除的话它会带着自己那条墨界线一起飘出去 */
  .ink-divide > *:not([data-exiting]) + *:not([data-exiting]) {
```

并在退场元素上加 `data-exiting`（用 `AnimatePresence` 的 `custom` 或在 `exit` 时通过 `onAnimationStart` 打标——**具体写法由实现者选，但必须在报告里说明选了哪种及为什么**）。

> ***修订：本步已确认不适用，整步作废。*** 实测两个列表容器用的是 `grid gap-*`，
> 不是 `.ink-divide`（`.ink-divide` 全仓只有讨论区楼层列表在用）。所以：
>
> - **`app/app.css` 从本任务的 Files 里划掉**，`.ink-divide > * + *` 一个字不改；
> - Step 2 代码块里那个 `data-exiting-safe` 属性也**一并删掉**——它是个孤儿：
>   全计划只出现那一次，没有任何 CSS 或代码读它，本步用的还是另一个名字 `data-exiting`；
> - 「退场元素仍在 DOM 里、`+` 选择器照常匹配」这个**真问题**留给计划五的楼层列表，
>   到时候连同 `data-exiting` 的打标方式一起决定。
>
> 实现者**只需在报告里贴出两个容器的实际 className 作为确认**，不做任何改动。

- [ ] **Step 4b（*修订新增*）: 补上红线 8 要求的播报**

> 红线 8 写着「`popLayout` 移除后的焦点会掉回 `<body>`——走 T3 的 `<LiveRegion>` 播报」，
> 而原计划**六个 Step 里一处都没执行它**：Files 不含 `messages/`，`git add` 也没有。
> **Task 7 是全 T4 唯一「被点击的按钮随卡片一起卸载」的地方，红线 8 就是为它写的。**
>
> 不做的后果：读屏审核员点一次「通过」，卡片消失、零播报；键盘审核员每处理一条
> 就要从文档顶部重新 Tab 一遍。而审核员一次会话处理几十条。

两个列表页各挂一个 `<LiveRegion>`（`~/components/live-region`，T3 建的），
内容由上面 `PendingWatcher` 的 `onSettled` 驱动：成功播「已处理《标题》」，失败播错误文案。

新增 Paraglide key **三语齐全**，跑 `bun run check-messages`。
**Files 因此要加上 `apps/web/messages/{zh,ja,en}.json`，`git add` 同步。**

- [ ] **Step 5: 门禁 + 浏览器实测**

Run: 全量门禁（同 Task 6 Step 5）**外加 `bun run check-messages`**（原文漏了它，
而本任务现在会新增三语 key——`check-messages` 是硬失败门禁）。

用 Browser pane，以审核员身份：
1. 处理一条 → 卡片淡出、**下方卡片平移上来而不是瞬跳**
2. 连续快速处理三条 → 确认动画可中断、不排队、不累积延迟
3. 制造一次失败（缺理由或 409）→ 卡片飞回来，且**带着真实的错误文案**
4. 减弱动效下 → 卡片瞬时消失、下方瞬时补位，无位移瞬跳
5. **播报**（*修订新增*）：读屏路径上处理一条之后，`[data-slot="live-region"]` 里出现一句回执

五条输出贴进报告。**第 3 与第 5 条最要紧**——前者是 T3 错误码修复与本任务乐观移除的交汇点，
后者是红线 8 的唯一落点。

> *修订*：原文的「403」在这个端点上不会出现——`/resources/:id/review` 实测只发
> 401 / 404 / **409**（非 staff 与「已被别人审过」都走 `canTransition` 的 409）。
> 制造失败的可行办法：两个标签页同时打开队列，在 A 里处理一条，再在 B 里处理同一条。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/dash/queue.tsx apps/web/app/routes/dash/reports.tsx apps/web/messages/
git commit -m "$(cat <<'EOF'
feat(dash): 条目移除用 popLayout + 兄弟 layout="position"，配乐观移除

AnimatePresence 单独只能让卡片原地淡出、下方等它淡完才跳。popLayout 让它
同一帧脱离文档流，兄弟身上的 layout="position" 把它们从旧位置平移到新位置——
这是 domAnimation 做不到、domMax 才有的 FLIP。

乐观移除是它不是净成本的原因：现状是 action 一趟 → revalidate → 卡片才消失，
非乐观时动画串在网络之后、每条 +280ms；乐观之后动画与往返重叠，增量 0ms。
RR8 的 fetcher persistence 让在途 fetcher 在组件卸载后仍留在 state.fetchers
直到结算，所以乐观集合不会闪断；但 fetcher.data 会被主动丢弃，所以失败码要在
卸载前的 effect 里抬到列表层——这依赖 T3 已修好的错误码拆分。

layout="position" 不是 layout(both)：Card 挂着 backdrop-filter，both 会做
scale 校正、背板模糊重算、CJK 正文被拉伸 280ms。
exit 只有 opacity：reduced-motion 下 motion 对位移键是瞬移到终点而非跳过。
位置走 washi(spring)、不透明度走 sumi——两条曲线的语义分工。

useInView 门控把 FLIP 规模从整列表降到视口内 4–6 张（约 17ms）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: dash 卡内二段展开与错误行

`queue.tsx` / `reports.tsx` / `users.tsx` 里有一批由客户端交互驱动的高度增删。每一次跳变都在移动一个可点击目标，而失败路径恰恰最需要「再点一次」。

`height: auto` 是 CSS 至今动不了的东西。280ms 的可见位移让手能跟上。

> ***修订：原文那句「四处——驳回理由展开、「记违规」警告、内联错误、危险区——全都发生在按钮附近」
> 有三处不成立。***
>
> ① **「驳回理由展开」在这三个文件里不存在。** queue.tsx 的驳回理由 `<Select>` 与备注 `<Input>`
> 是**无条件渲染**的，没有任何展开/收起状态。全 /dash 唯一的「两段展开」是 `trash.tsx`
> 的 `confirming`——那是 Task 9 的文件。
> ② **「危险区」也不在这三个文件里**，同样归 `trash.tsx`。
> ③ **不是四处，实测是八处**，其中 `users.tsx` 独占五处（原文只算作一处）。
> ④ **「全都发生在按钮附近」只对 queue.tsx 的两处成立。** reports.tsx 与 users.tsx 的错误行
> 全部在按钮**之后**，它们出现/消失时按钮位置根本不变——在那两个文件给按钮行加
> `layout="position"` 是**纯空操作**。
>
> **所以 Step 1 的落点清单必须在 Task 7 落地之后重新生成**，不能沿用正文——
> Task 7 的乐观移除会让 queue/reports 的内联错误行要么被删除、要么迁到列表层。

**Files:**
- Modify: `apps/web/app/routes/dash/queue.tsx`、`reports.tsx`、`users.tsx`

- [ ] **Step 1: 重新生成落点清单**

Run: `cd /Users/i/Code/th/apps/web && grep -n "&& (" app/routes/dash/queue.tsx app/routes/dash/reports.tsx app/routes/dash/users.tsx`

> *修订*：原文在这条命令后面还接了 `| grep -i "warn\|error\|reason\|danger\|strike"`——
> **实测那样只返回 1 行**，因为关键词落在 JSX 正文里而不是条件行上
> （`{failCode && (`、`{missing && (`、`{fetcher.data?.code && (` 全被过滤掉）。**去掉第二段过滤。**

逐处判断它是不是「客户端交互驱动的高度增删」，把清单贴进报告。**必须写出每一处的
file + 锚点文本（不写行号）**，并说明：它在按钮**之前**还是**之后**——只有在按钮之前的
才需要给按钮行加 `layout="position"`，之后的加了是空操作。

**Task 7 刚改过 queue.tsx 与 reports.tsx**，所以以你**当下读到的文件**为准，
不要相信本计划正文里任何关于这两个文件的结构描述。

- [ ] **Step 2: 各处包 `AnimatePresence popLayout`**

**不用 `mode="wait"`**（全站禁用）。形状：

```tsx
              <AnimatePresence mode="popLayout" initial={false}>
                {condition && (
                  <motion.p
                    key="…"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE_SUMI }}
                    role="alert"
                    className="…原样…"
                  >
                    …
                  </motion.p>
                )}
              </AnimatePresence>
```

**`initial={{opacity:0}}` 在 `<AnimatePresence initial={false}>` 内是安全的**（已实测：SSR 产物是 `style="opacity:1"`）。但这四处本来就只在客户端交互后出现，首屏不存在。

**`role="alert"` 不能因为包了一层就丢掉。**

> *修订*：原文说「必须**保留**」，但实测八处里**只有两处现在带 `role="alert"`**，
> 其余六处没有可保留的东西——尤其 Step 3 点名要验的那条「记违规」警告本身就没有 role，
> 所以那条实测断言在当前代码上必红。
> 正确说法：**该有 role 的补上、已有的不许丢**。判据是它是不是「操作失败/后果警告」类的
> 即时提示；纯说明性文字不要滥挂 `role="alert"`（那会让读屏在无关时刻打断用户）。

**容器要 `position: relative`（红线 9）。**

> *修订*：原文没提这条，而同一份计划的 Task 7 Step 2 是明写了 `relative` 的——
> **同一条红线在同一份计划里一处遵守、一处遗忘**。`PopChild` 用 `offsetTop`/`offsetLeft` +
> `position: absolute` 定位退场元素；没有定位祖先时 `offsetParent` 一路落到 `<body>`，
> 退场的 `<p role="alert">` 会在淡出的 180ms 里**飞到页面左上角**。
> Step 1 清单里的每一处，都要确认它 `AnimatePresence` 的直接父容器有 `relative`，没有就加。

**只给「错误行在按钮之前」的那几处**给按钮行加 `layout="position"` 吸收高度变化（见 Step 1）。

- [ ] **Step 3: 门禁 + 实测**

Run: 全量门禁（同 Task 6 Step 5）

实测重点：选中「版权/违法」时警告出现，**按钮不再瞬间被顶下去**（量按钮在警告出现前后的 `getBoundingClientRect().top`，应当是连续位移而非瞬跳）；`role="alert"` 的文本仍被播报（读 `document.querySelector('[role=alert]')` 存在且有文本）。

- [ ] **Step 4: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/dash/queue.tsx apps/web/app/routes/dash/reports.tsx apps/web/app/routes/dash/users.tsx
git commit -m "$(cat <<'EOF'
feat(dash): 卡内展开与错误行不再瞬间顶开按钮

四处高度增删（驳回理由、记违规警告、内联错误、危险区）全都发生在按钮附近，
每一次跳变都在移动一个可点击目标——而失败路径恰恰最需要「再点一次」。
height:auto 是 CSS 至今动不了的东西，280ms 的可见位移让手能跟上。

用 popLayout 不用 mode="wait"（全站禁用：它让进出串行，工作界面上是净损失）。
role="alert" 保留——它是这些提示的语义，不能因为包了一层就丢掉。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: dash trash 销毁确认两拍

`/dash/trash` 的销毁是全 `/dash` 唯一**不可逆**的操作。

本任务的方向是**反的**：刻意把它的完成时间从 0ms 抬到 360ms。**正当性不来自曝光量。**

**Files:**
- Modify: `apps/web/app/routes/dash/trash.tsx`

- [ ] **Step 1: `variants` + `staggerChildren`**

确认按钮出现时，三个元素（警告文案、输入框/复选框、销毁按钮）按 120ms 递延出现。这是全站 `staggerChildren` 的**唯一**落点。

**variants 必须写在组件内**，因为它要读 `useReducedMotion()`：

```tsx
  /**
   * 这是全站唯一一处 staggerChildren，也是唯一一处刻意让操作变慢的地方。
   *
   * 自己门控减弱动效：MotionConfig reducedMotion="user" 只关 transform/positional 键，
   * opacity 动画连同 stagger 算出来的 delay 照跑（红线 6 的三类之一）。
   * 不门控的话，开了减弱动效的用户看到的仍是三段递延淡入——
   * 而此时它是页面上唯一在动的东西，落在全 /dash 唯一不可逆的操作上。
   */
  const reduce = useReducedMotion()
  const confirmVariants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.12 } },
  }
  const itemVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { duration: reduce ? 0 : 0.18, ease: EASE_SUMI },
    },
  }
```

import：`import { motion, useReducedMotion } from 'motion/react'`。

**注意：`hidden` 里只有 `opacity`，没有位移**——这几个元素会进 SSR 吗？不会（只在点了「销毁」之后出现），但保持与红线 4 同形，避免后人照抄到会进 SSR 的地方。

- [ ] **Step 2: 门禁 + 实测**

Run: 全量门禁（同 Task 6 Step 5）

实测：点「销毁」后三个元素依次出现、**总时长约 420ms**（用 `setTimeout` 分段采样各元素的
`opacity`，**不要用 `requestAnimationFrame`**——隐藏面板里它不触发）；
**减弱动效下三者同帧出现**（信息一点不丢）。

> *修订两处*：
>
> ① **「360ms」算错了。** 按 Step 1 给的参数，最后一个子节点在 `0.12 × 2 + 0.18 = 0.42s`
> 完成。360ms 是「3 × 120ms」的算法——漏掉了 stagger 是 **n−1** 个间隔，且最后一个子节点
> 自己还有 180ms 时长。任务标题里的「抬到 360ms」同理，实际是 420ms。
>
> ② **「减弱动效下三者同帧出现」不会自动成立，必须自己写。**
> `MotionConfig reducedMotion="user"` 只关 transform/positional 键，**opacity 动画连同
> `staggerChildren` 算出来的 delay 照跑**（spec:209 已实测记下这一条）。不门控的话，
> 开启减弱动效的用户看到的仍是三段 120ms 递延的淡入——**而此时它是页面上唯一在动的东西**，
> 落在全 /dash 唯一不可逆的操作上。spec 的原话：比不做还糟。
> 这正是红线 6 说的「`MotionConfig` 管不到的三类」之一。

- [ ] **Step 3: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/dash/trash.tsx
git commit -m "$(cat <<'EOF'
feat(dash): 销毁确认刻意变慢两拍

/dash/trash 的销毁是全 /dash 唯一不可逆的操作。这一条的方向是反的——
刻意把完成时间从 0ms 抬到 360ms，让手在按下之前多一次看清的机会。
正当性不来自曝光量。

这是全站 staggerChildren 的唯一落点；入场 stagger 全站零处。
variants 的 hidden 里只有 opacity 没有位移——这几个元素不进 SSR，
但保持与「exit 零位移键」同形，避免后人照抄到会进 SSR 的地方。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 收尾

- [ ] **全量门禁**

```bash
cd /Users/i/Code/th && \
  bun run check && bun run typecheck && bun run check-messages && bun run test && \
  (cd apps/web && bun run build) && \
  bun run check-css-layers && bun run check-motion-boundary && bun run check-bundle-size && \
  (cd apps/api && bun run e2e)
```

- [ ] **确认 root 首屏没涨**

Run: `bun run check-bundle-size`
Expected: 首屏集与 Task 5 Step 6 记录的数字**一致**（只多 `MotionConfig` 的 +0.46 KB）；`/dash` 路由自身增量约 39–46 KB。**这两个数字都要贴进报告**——它们是 A2 边界成立的最终证据。

- [ ] **重新校准 `scripts/check-bundle-size.ts`（*修订新增，这是 T3 留下的明确交接*）**

该脚本自己的头注释粗体写着：「**T4 往里装 motion 之后必须重新构建、重新称重、重新校准这两个
常量**……如果新读数比这里记的还低，也要如实更新注释，不能让注释继续写着过时的旧读数」。
而 T4 原文从头到尾只要求「把数字贴进报告」——**没有一步接住它**。

- 把注释里的 `150.62` / `250.99` 两处读数改成本次全量构建的实测值；
- 复核 `SHARED_BUDGET_KB = 155` 与 `ROUTE_BUDGET_KB = 270` 两个常量在装了 motion 之后是否仍合理
  （实测参考：装 motion 前 `/dash/queue` 是 193.14 KB，加 39–46 KB 后约 232–239 KB，仍在 270 内，
  **所以这条不会自己报红**——它只会静静地让注释永远停在过时读数上）；
- 若调整了预算常量，注释里写清新数字是怎么来的。

**这一步归收尾、不归 Task 5**：Task 5 那次只有 +0.46 KB，校准完立刻被 Task 6–9 作废。

- [ ] **更新 CLAUDE.md**

> *修订*：**先 `grep -n "viewTransition" CLAUDE.md` 确认 Task 6 的修订已经在。**
> 那条现在写着「全站导航链接一律带 `viewTransition`（33/33，含 `/dash`）」，
> Task 6 必须已把它改成 32/33 + 唯一例外。**若还没改，先补上再动笔**——
> 否则追加完会出现「全站一律带」与「dash tab 不带」两条并存且互相矛盾的约定，
> 而这条约定 CLAUDE.md 自己写着「没有门禁能抓」。

追加：九条红线的摘要（**红线 1 用修订后的措辞：限定词是「会进 SSR HTML 的」**）
+ 三条曲线的语义分工 + A2 的 root 树禁令（**说明 `check-motion-boundary` 是按 root 可达图
算的、不是硬编码名单**）+ 「新增 motion 用法前先问：它是位置连续性、远端回执、还是常驻状态？
三者之外不做」（**常驻状态的referent是 dash tab 下划线，见 Global Constraints 的修订注**）。

- [ ] **提交收尾（*修订新增：原文没有这一步***）

```bash
cd /Users/i/Code/th
git add CLAUDE.md scripts/check-bundle-size.ts
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md 记下 T4 的红线与曲线分工，并校准体积门禁的读数

check-bundle-size 的头注释自己写着「T4 装 motion 之后必须重新称重、
重新校准」——这是 T3 留给 T4 的明确交接，本次接住。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 计划五（后续）

批次 3（Discussion 三件套：发帖落款 `useAnimate`、楼层三选一 `popLayout`、PostForm 插入文案、「回复中 · #N」浮标）、批次 4（通知「全部已读」的墨扫）、批次 5（香霖堂：MotionValue 星条、三步向导、镜像 `Reorder`、上传进度 `useSpring`）。

**批次 6 的两条需要站长单独拍板**（都不引 motion 进 root 树，走手写）：
- **移动端抽屉边缘划走关闭** —— 约 40 行 Pointer Events。这是本轮对真实用户体感提升最大的一条
- **header 下滚收起** —— 约 25 行。**建议不做**：header 只有 56px，而 `scroll-mt-20`（80px）的深链落点预留是按固定 header 算的，收起后会失准；且它是全站每页每次滚动都跑的主线程回调

## 找不到正当落点的能力（明说，不是遗漏）

- **`useScroll` —— 零落点。** 这个站的滚动响应已经由原生 scroll-driven animation 在**合成器**上做完，而每个滚动容器上都挂着 `backdrop-filter` 卡片。把滚动响应搬回主线程换「速率恒定」是这个站最不该做的事。
- **`mode="wait"` —— 零落点。** 工作界面上是净损失；内容界面上与原生 VT 抢同一次替换。
- **`useInView` 作为入场触发 —— 零落点**；只作为 `layout` 的规模门控。
- **跨路由 `layoutId` —— 零落点。** 跨页到达 100% 归原生 View Transition。
- **红线 6 的三类（MotionValue 直连 `style`、`useAnimate` 驱动 `window.scrollTo`、命令式 `animate()`）
  —— 本期零落点。** *修订补入*：它们会以「必须自己走 `useReducedMotion()`」的形态进 CLAUDE.md，
  却在仓库里没有一处示范可对照。计划五的 MotionValue 星条、`useAnimate` 落款、
  上传进度 `useSpring` 全是这三类——**那时才有第一个示范**。
  本期唯一自走 `useReducedMotion()` 的是 Task 9 的 stagger（因为 opacity + delay 同样不受
  `MotionConfig` 管），它可以充当那个示范的雏形。
- **`myRating` 与它的 api 改动 —— 推到计划五。** *修订补入*：本期没有消费者（星条是计划五的事），
  为一个无人读的字段改 `GET /resources/:slug` 是提前支出。计划五开工时它是第一步前置。

**实测那条数字是这份清单的底气：门票 39.4 KB，把 `layout` / `drag` / MotionValue / `useAnimate` / `LayoutGroup` / `variants` 全用上只多 6.4 KB。所以「用满」不花钱，克制才花钱——花的是想清楚每一处该不该动的时间。**
