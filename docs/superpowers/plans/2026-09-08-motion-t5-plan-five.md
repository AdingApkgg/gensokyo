# 和风纸境 T5（计划五）：讨论区・通知・香霖堂，以及两条手写的

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 motion 用到它在这个站剩下的正当落点上——讨论区（浮标・落款・翻纸）、通知（墨扫）、香霖堂（星条・向导・镜像重排・上传进度）——并把两条不引 motion 的手写交互（抽屉边缘划走、header 下滚收起）一并落地。

**Architecture:** 全量 `motion`，`MotionConfig` 在 root（T4 已落地）。**本期新增一条边界**：匿名可读的路由（首页、香霖堂列表/详情、神社各页、个人页）的**静态 import 图里零 `motion/react`**——浮标/落款/翻纸/星条/上传进度全是登录后才用得上的东西，它们一律走 `lazy()` + 动态 `import()`，匿名读者一个字节不下载。这条与 A2 同源（A2 守首屏，这条守流量最大的匿名页），由 `check-motion-boundary` 的第二组根钉成断言。批次 6 的两条在 root 树里，手写 Pointer Events / scroll 监听，不碰 motion。

**Tech Stack:** Bun · React Router 8 (SSR) · React 19 · Tailwind v4 · motion 13.2 · Paraglide JS

**Spec:** `docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md`（§8.2 香霖堂、§8.3 博丽神社、§9.2 JS 侧、§9.3 pending 反馈）

**前置（已在 main）:** T0–T4 全部落地。本计划**写在 T4 合并之后、对着当前代码核实过每一条前提**——T4 的教训。

**范围:** 计划五三批（批次 3 Discussion、批次 4 通知、批次 5 香霖堂）+ 批次 6 两条手写 + 一处相邻缺陷（`detail.tsx` 的 trash 分支）+ 批次 5 的前置 `myRating`。共 13 个任务。

---

## 本期立的两条新裁决

### C1. 匿名可读路由的静态图零 motion；登录后才有的东西走 lazy

实测 motion 是一个约 39 KB gz 的共享 chunk。T4 把它挡在 root 树外（A2），但本期要碰的 `kourindou/detail.tsx` 与 `shrine/topic.tsx` 是**匿名可读**的，且 `/kourindou/:slug` 是被外链进来的、全站流量最大的页面——而浮标、落款、翻纸、星条、上传进度**全部只对登录用户可见**。给它们静态 import motion，等于让匿名读者为自己永远用不到的东西多下载 15%。

所以：这些组件一律 `React.lazy(() => import('…'))`，按 `user` / 交互门控渲染；命令式的 `animate()` 用 `await import('motion/react')`。rolldown 把动态 import 单独分包，静态图不含它，`check-bundle-size` 的单路由读数不涨。**Task 11 把「匿名路由的可达集零 `motion/react`」钉成断言**，与 A2 的 root 断言共用同一个 BFS。

代价：首次交互（第一次点「编辑」、第一次点「引用」）要拉一次 chunk，那一次的入场可能不带动画。可接受——按钮 hover 时预取能把这一次也抹掉，Task 5 做了。

### C2. 「三件套」的第三件是浮标，落款用命令式 `animate()`

T4 尾巴列的「PostForm 插入文案」与「『回复中 · #N』浮标」核实为**同一件事**：`PostForm` 现在只在 `parentId` 存在时渲染一行「正在回复引用的楼层。」——**连是哪一楼都不说**（它只拿到 `parentId` 不拿楼号）。浮标就是把这行做成 sticky 的常驻状态指示（spec 三支柱的第三根「我现在处在什么模式」），带楼号、可跳回、可取消。PostForm 里那行随之删掉。

落款（spec §8.3「命中当前楼层窗口 → `useAnimate()` 命令式播墨洇」）改用**独立的 `animate()` 函数 + 动态 import**：`useAnimate` 是 hook，必须静态 import `motion/react`，那就把 motion 钉进了 `Discussion.tsx` 的静态图，违反 C1。`animate(el, …)` 与 `useAnimate` 是同一个引擎，spec 要的「命令式、不把 50 个 `<li>` 变成 motion 组件」一字不差地保住。红线 6 对它同样生效：自己走 `prefersReduced()`。

---

## Global Constraints

**曲线语义**（CLAUDE.md 已记）：`SPRING_WASHI` / `EASE_WASHI` = 位置连续性；`EASE_SUMI` = 远端回执；`EASE_FUDE` = 一笔画出来（只给 scaleX 类延展）。

**九条红线**（CLAUDE.md 已记，逐条与本期落点对应）：
1. 会进 SSR HTML 的节点零 `initial` 隐藏态。本期所有 `initial={{opacity:0}}` 都在**客户端交互后才存在**的节点上（浮标、翻纸、墨扫、向导的第 2/3 步），且 `AnimatePresence initial={false}`。
2. `useInView` 唯一用途是 `layout` 规模门控——本期**零处**使用。浮标的「不在视口时才显眼」用 `position: sticky` 做，不做视口检测。
3. 挂 `backdrop-filter` 的卡片只用 `layout="position"`——`Reorder.Item` 的 `layout` 是可覆盖的 prop（实测源码 `layout = true` 解构），Task 9 显式传 `"position"`。
4. `exit` 里零位移键——本期全部 `exit={{ opacity: 0 }}`。
5. `whileTap` 只加在 `<button>`/`<a>`——本期零处 `whileTap`。
6. `MotionConfig reducedMotion="user"` 管不到的三类必须自己门控：**本期恰好三类都有落点**——MotionValue 直连 `style`（Task 7 星条、Task 10 上传进度）、命令式 `animate()`（Task 4 落款）、opacity 的 delay（无）。每处都有 `useReducedMotion()` / `prefersReduced()` 守卫，且守卫是任务的验收项。
7. `Reorder` 必须有键盘替代——Task 9 每张镜像卡带「上移 / 下移」按钮。
8. `popLayout` 移除后焦点掉回 `<body>`——本期的 `popLayout` 只用于**同位置替换**（翻纸、向导换步），不移除可聚焦目标；向导换步后焦点显式回表头。
9. `popLayout` 的直接父容器必须 `relative`——Task 5、Task 8 各自的容器已写死。

**其余**：
- **零新增依赖。**
- 文案走 Paraglide，新增 key 三语齐全，`bun run check-messages` 是硬门禁。**`m` 只能是 Paraglide 的标识符。**
- root 树（`root.tsx` / `site-header.tsx` / `mobile-nav.tsx` / `pending-bar.tsx` / `ui/button.tsx` / `ui/dropdown-menu.tsx` / `site-footer.tsx` / `lang-switcher.tsx` / `theme-toggle.tsx` / `live-region.tsx`）**一律不得 import `motion/react`**——Task 12、13 全部手写。
- 匿名可读路由（`home` / `kourindou/list` / `kourindou/detail` / `shrine/index` / `shrine/board` / `shrine/topic` / `profile`）的**静态图零 `motion/react`**（C1）。
- Biome：单引号、按需分号；`**/*.css` 不进 Biome。
- 提交信息末尾带 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- **不要 `git add` 任何 `.superpowers/` 下的东西**，也不要 add `apps/web/build/`。
- 门禁基线（T4 合并后实测）：首屏 **151.49 KB / 155**（23 文件）；最重路由 `/kourindou/:slug` **252.85 / 270**；`check-messages` 303 key × 3 语；`test` 126。

**共享文件与串行**：`detail.tsx`（Task 2 → 7）、`Discussion.tsx`（3 → 4）、`PostForm.tsx`（3 → 10）、`upload.tsx`（8 → 9 → 10）、三份 `messages/*.json`（3、9）。**十三个任务严格串行，派工里不得引用行号，只能用锚点文本定位。**

---

## 文件结构

| 文件 | 责任 | 任务 |
|---|---|---|
| `apps/api/src/modules/kourindou/index.ts` | `GET /resources/:slug` 带 `myRating` | 1 |
| `apps/api/src/kourindou.test.ts` | `myRating` 三态测试 | 1 |
| `apps/web/app/routes/kourindou/detail.tsx` | trash 分支错误码；星条换 lazy `StarStrip` + 乐观分 | 2、7 |
| `apps/web/app/components/discussion/ReplyTargetBar.tsx`（新） | 浮标（含 motion，lazy 加载） | 3 |
| `apps/web/app/components/discussion/Discussion.tsx` | 挂浮标；落款 `animate()` | 3、4 |
| `apps/web/app/components/discussion/PostForm.tsx` | 删「正在回复」行；pending 文案；上传进度 | 3、10 |
| `apps/web/app/components/discussion/FloorFlip.tsx`（新） | 翻纸（含 motion，lazy 加载） | 5 |
| `apps/web/app/components/discussion/PostList.tsx` | 编辑态门控 + 预取 | 5 |
| `apps/web/app/routes/notifications.tsx` | 墨扫 | 6 |
| `apps/web/app/components/kourindou/stars.tsx`（新） | 静态星条 + 共享 class（零 motion，也是 no-JS 兜底） | 7 |
| `apps/web/app/components/kourindou/star-strip.tsx`（新） | MotionValue 星条（lazy 加载） | 7 |
| `apps/web/app/routes/kourindou/upload.tsx` | 向导纸落定・步骤墨线・焦点・许可卡 `paper-lift`；`Reorder`；封面进度 | 8、9、10 |
| `apps/web/app/lib/upload.ts`（新） | XHR 上传 + 进度回调（两处共用） | 10 |
| `apps/web/app/components/upload-progress.tsx`（新） | `useSpring` 进度条 | 10 |
| `apps/web/app/lib/motion.ts` | 追加 `SPRING_WASHI_VALUE`（只追加不改） | 10 |
| `scripts/check-motion-boundary.ts` | 第二组根：匿名路由 | 11 |
| `apps/web/app/components/mobile-nav.tsx` | 边缘划走关闭（手写） | 12 |
| `apps/web/app/components/site-header.tsx` + `app.css` | 下滚收起（手写） | 13 |
| `apps/web/messages/{zh,ja,en}.json` | 新 key | 3、9 |

---

# 批次 0 · 前置（不含 motion）

### Task 1: `GET /resources/:slug` 带 `myRating`

星条要知道「我评过几分」才能显示常驻状态；这是 T4 推到本期的前置。**API 不返回它，前端无从得知。**

**Files:**
- Modify: `apps/api/src/modules/kourindou/index.ts`（`.get('/resources/:slug', …)` 的返回体）
- Modify: `apps/api/src/kourindou.test.ts`

**Interfaces:**
- Produces: `GET /api/kourindou/resources/:slug` 响应多一个字段 `myRating: number | null`（匿名或未评 → `null`）。web 侧经 hc 自动获得类型，`detail.tsx` 的 loader 已是 `return { ...detail, discussion }`，**无需改动**即可读到 `loaderData.myRating`。

- [ ] **Step 1: 写失败的测试**

`apps/api/src/kourindou.test.ts` 的 `describe('可见性', …)` 之后追加（沿用该文件已有的 `signUp` / `send` 与 `trackResource` / `cleanupTracked`；`Session` 以文件顶部 `signUp` 的返回类型名为准）：

```ts
describe('myRating', () => {
  test('匿名与未评分者是 null，评过分的人看到自己的分', async () => {
    // 评分端点只对已发布资源开放：照 interactions.test.ts 的 publishedResource，
    // 先把作者提到自动发布线，再建资源 → 挂版本 → 投递
    const owner = await signUp('myRating 作者')
    await app.request('/api/me', { headers: { cookie: owner.cookie } })
    await db
      .update(schema.userProfile)
      .set({ approvedResourceCount: 5 })
      .where(eq(schema.userProfile.userId, owner.userId))
    const created = await app.request(
      '/api/kourindou/resources',
      send(owner, 'POST', {
        titleOriginal: '東方紅魔郷',
        titleOriginalLocale: 'ja',
        kind: 'game',
        license: 'allowed',
      }),
    )
    const { resource } = (await created.json()) as {
      resource: { id: string; slug: string }
    }
    trackResource(resource)
    await app.request(
      `/api/kourindou/resources/${resource.id}/versions`,
      send(owner, 'POST', {
        label: 'v1',
        files: [
          { label: '本体', url: 'https://pan.example.com/s/kmk', mirrorKind: 'netdisk' },
        ],
      }),
    )
    await app.request(
      `/api/kourindou/resources/${resource.id}/submit`,
      send(owner, 'POST'),
    )

    const rater = await signUp('myRating 评分者')
    const rated = await app.request(
      `/api/kourindou/resources/${resource.slug}/rating`,
      send(rater, 'PUT', { score: 4 }),
    )
    expect(rated.status).toBe(200)

    const read = async (s?: Session) => {
      const res = await app.request(
        `/api/kourindou/resources/${resource.slug}`,
        s ? { headers: { cookie: s.cookie } } : {},
      )
      return (await res.json()) as { myRating: number | null }
    }
    expect((await read()).myRating).toBeNull()
    expect((await read(owner)).myRating).toBeNull()
    expect((await read(rater)).myRating).toBe(4)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd /Users/i/Code/th/apps/api && bun test src/kourindou.test.ts -t myRating`
Expected: FAIL——`myRating` 是 `undefined`，`toBeNull()` 不过。

- [ ] **Step 3: 最小实现**

`apps/api/src/modules/kourindou/index.ts` 的 `.get('/resources/:slug', …)` 里，`const [versions, tags, circleRow] = await Promise.all([…])` 那一句之后、`const files = …` 之前加：

```ts
    /**
     * 当前用户对它的评分。星条要靠它显示「我评过了」这个常驻状态——
     * 没有它，每次刷新星条都是空的，用户不知道自己评没评、评了几分。
     * 匿名与未评 → null。只多一次主键查询，且 actor 为空时不查——匿名读者零成本。
     */
    const myRating = actor
      ? ((
          await db
            .select({ score: schema.rating.score })
            .from(schema.rating)
            .where(
              and(
                eq(schema.rating.resourceId, row.id),
                eq(schema.rating.userId, actor.id),
              ),
            )
            .limit(1)
        )[0]?.score ?? null)
      : null
```

返回体 `c.json({ resource: row, … topicId: … })` 里加一行 `myRating,`。

`schema` 已在文件顶部 `import { db, schema } from '@gensokyo/db'`；`rating` 表在 `schema.rating`（`packages/db/src/schema/kourindou.ts`），与 `interactions.ts` 用的是同一张。

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd /Users/i/Code/th/apps/api && bun test src/kourindou.test.ts`
Expected: 全部 PASS（含新增那条）。

- [ ] **Step 5: 门禁**

Run: `bun run check && bun run typecheck`
Expected: 全绿。web 侧 `detail.tsx` 的 loader 返回类型自动带上 `myRating`，typecheck 不该有任何抱怨。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/api/src/modules/kourindou/index.ts apps/api/src/kourindou.test.ts
git commit -m "$(cat <<'MSG'
feat(api): 资源详情带 myRating

星条要靠它显示「我评过了」这个常驻状态。此前每次刷新星条都是空的，
用户不知道自己评没评、评了几分。匿名与未评 → null，actor 为空时不查。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `detail.tsx` 的 trash 分支丢掉错误码

T4 Task 1 顺手记下的相邻缺陷：`intent === 'trash'` 分支读了 `res.ok` 却丢掉错误码，而 `AdminZone` 把**任何**失败都渲染成「理由必填」。403/404 的软删失败会显示一句与原因无关的提示。

**Files:**
- Modify: `apps/web/app/routes/kourindou/detail.tsx`（action 的 trash 分支；`AdminZone` 组件）

- [ ] **Step 1: action 带出错误码**

锚点 `if (intent === 'trash') {`，整块改成：

```ts
  if (intent === 'trash') {
    const reason = String(form.get('reason') ?? '').trim()
    // 自造的码：与 API 的 validation_failed 撞名会让别的校验失败也显示成「理由必填」
    if (!reason) return { ok: false as const, code: 'reason_required' as const }
    const res = await api.api.admin.resources[':id'].$delete({
      param: { id: String(form.get('id')) },
      json: { mode: 'soft', reason },
    })
    if (res.ok) throw redirect(localizeHref('/dash/trash'))
    // hc 对 4xx 不抛异常；此前这里无条件 { ok: false }，403/404 全显示成「理由必填」
    const code = await apiErrorCode(res)
    return { ok: false as const, code: code ?? 'generic' }
  }
```

- [ ] **Step 2: `AdminZone` 按码显示**

`const busy = fetcher.state !== 'idle'` 之后加：

```ts
  // action 是全页 intent 共用的联合类型；trash 结果一定带 code，用 in 收窄
  const failCode =
    fetcher.data && fetcher.data.ok === false && 'code' in fetcher.data
      ? fetcher.data.code
      : undefined
```

锚点 `{fetcher.data?.ok === false && (`，那一块改成：

```tsx
        {failCode && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {failCode === 'reason_required'
              ? m.admin_reason_required()
              : errorMessage(failCode)}
          </p>
        )}
```

`errorMessage` 已在文件顶部 import（T4 Task 1 加的）。

- [ ] **Step 3: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test)`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/kourindou/detail.tsx
git commit -m "$(cat <<'MSG'
fix(web): 资源页下架失败一律显示成「理由必填」

trash 分支读了 res.ok 却丢掉错误码，AdminZone 把任何失败都当成缺理由。
403/404 的软删失败会显示一句与原因无关的提示。与 T3/T4 修过的三处同病。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

# 批次 3 · 讨论区

### Task 3: 「回复中 · #N」浮标 + PostForm 的 pending 文案

现状：点「引用」后 `PostForm` 顶部出现一行「正在回复引用的楼层。取消」——**不说是哪一楼**，且用户滚上去重读那一楼时这行随表单一起出了视口。发送时按钮只是变灰，没有文案切换（spec §9.3：pending 的主信号是文案切换 + `aria-busy`）。

**Files:**
- Create: `apps/web/app/components/discussion/ReplyTargetBar.tsx`
- Modify: `apps/web/app/components/discussion/Discussion.tsx`
- Modify: `apps/web/app/components/discussion/PostForm.tsx`
- Modify: `apps/web/messages/{zh,ja,en}.json`

**Interfaces:**
- Produces: `ReplyTargetBar({ floor: number | null; onClear: () => void; onExited: () => void })`（default export，lazy 加载）
- Consumes: `EASE_SUMI`（`~/lib/motion`，纯常量模块，静态 import 安全）

- [ ] **Step 1: 三语文案**

`zh.json`：
```json
  "shrine_replying_to_floor": "回复中",
  "shrine_sending": "发送中…",
```
`ja.json`：
```json
  "shrine_replying_to_floor": "返信中",
  "shrine_sending": "送信中…",
```
`en.json`：
```json
  "shrine_replying_to_floor": "Replying to",
  "shrine_sending": "Sending…",
```

三份都**删掉** `shrine_replying_to`（全仓唯一引用点是 PostForm 那一行，本任务 Step 3 删掉它）。

- [ ] **Step 2: 浮标组件**

创建 `apps/web/app/components/discussion/ReplyTargetBar.tsx`：

```tsx
import { AnimatePresence, motion } from 'motion/react'
import { EASE_SUMI } from '~/lib/motion'
import { m } from '~/paraglide/messages'

/**
 * 「回复中 · #N」——常驻状态的指示（spec 三支柱的第三根：我现在处在什么模式）。
 *
 * `position: sticky; bottom` 挂在讨论区容器里：回复框在视口内时它就待在
 * 自己的位置（回复框正上方）；用户滚上去重读被引用的那一楼时，它贴在视口
 * 底部跟着走。**不做视口检测**（红线 2：useInView 只给 layout 门控）。
 *
 * 这个文件含 motion，由 Discussion 通过 lazy() 加载——匿名读者永远走不到
 * 「引用」这一步，不该为它下载 39 KB（C1）。
 *
 * 只在客户端交互后存在，所以 initial 隐藏态不违反红线 1；exit 只有 opacity（红线 4）。
 */
export default function ReplyTargetBar({
  floor,
  onClear,
  onExited,
}: {
  floor: number | null
  onClear: () => void
  onExited: () => void
}) {
  return (
    <AnimatePresence onExitComplete={onExited}>
      {floor !== null && (
        <motion.div
          key="reply-target"
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_SUMI }}
          className="sticky bottom-3 z-10 flex items-center gap-2 rounded-md bg-background/85 px-3 py-1.5 text-xs ring-1 ring-foreground/10 backdrop-blur"
        >
          <span>{m.shrine_replying_to_floor()}</span>
          {/* 跳回那一楼：原生 hash 跳转，:target 的墨洇会在落点亮一下 */}
          <a
            href={`#p${floor}`}
            className="font-medium underline underline-offset-4"
          >
            #{floor}
          </a>
          <button
            type="button"
            className="ml-auto underline underline-offset-4"
            onClick={onClear}
          >
            {m.shrine_cancel()}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 3: PostForm 删掉那一行，加 pending 文案**

`apps/web/app/components/discussion/PostForm.tsx`：

(a) 删掉整块：
```tsx
      {parentId && onClearParent && (
        <p className="text-xs text-muted-foreground">
          {m.shrine_replying_to()}{' '}
          <button type="button" className="underline" onClick={onClearParent}>
            {m.shrine_cancel()}
          </button>
        </p>
      )}
```
（`onClearParent` prop **保留**——成功效应里还在用它。）

(b) `<fetcher.Form method="post" action={action} className="grid gap-2">` 改成
```tsx
    <fetcher.Form
      method="post"
      action={action}
      className="grid gap-2"
      aria-busy={busy || undefined}
    >
```

(c) 提交按钮的文案改成三态：
```tsx
          <Button type="submit" size="sm" disabled={busy || !body.trim()}>
            {busy
              ? m.shrine_sending()
              : intent === 'edit'
                ? m.shrine_save()
                : m.shrine_reply()}
          </Button>
```

spec §9.3：pending 的**主信号**是文案切换 + `aria-busy`——减弱动效下 spinner 会被冻结，只有文案不会。

- [ ] **Step 4: Discussion 挂浮标（lazy）**

`apps/web/app/components/discussion/Discussion.tsx`：

把 `import { useCallback, useState } from 'react'` 换成
```tsx
import { lazy, Suspense, useCallback, useState } from 'react'
```
并在 import 区末尾加：
```tsx
/** 含 motion；匿名读者走不到「引用」这一步，不为它下载（C1） */
const ReplyTargetBar = lazy(() => import('./ReplyTargetBar'))
```

组件里 `const clearParent = useCallback(() => setParent(null), [])` 之后加：
```tsx
  /**
   * 浮标的挂载门控：parent 出现时挂上，退场动画播完再卸——直接按 parent 挂卸
   * 就没有退场可播。首次挂载要拉一次 chunk，那一次的入场由 AnimatePresence
   * 的默认 initial 播，不受影响。
   *
   * 渲染期 setState 是 React 允许的「派生状态」写法（只对本组件的 state），
   * 比 effect 少一帧。
   */
  const [barMounted, setBarMounted] = useState(false)
  if (parent && !barMounted) setBarMounted(true)
  const onBarExited = useCallback(() => setBarMounted(false), [])
```

渲染里，`{pages > 1 && (<Pagination>…)}` 之后、`<div id="reply-form" …>` 之前插入：
```tsx
      {barMounted && (
        <Suspense fallback={null}>
          <ReplyTargetBar
            floor={parent?.floor ?? null}
            onClear={clearParent}
            onExited={onBarExited}
          />
        </Suspense>
      )}
```

- [ ] **Step 5: 门禁**

Run: `bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test)`
Expected: 全绿；`check-messages` 的 key 数 303 → **304**（+2 −1），代码引用数相等。

- [ ] **Step 6: 浏览器实测（需登录用户，留给控制者）**

进任一主题页，点某楼的「引用」：
1. 浮标出现，文案「回复中 #N」，N 与被引用楼一致；点 `#N` 页面跳到那一楼且它亮一下墨洇
2. 滚到页面上方：浮标贴在视口底部；滚回回复框：浮标回到回复框正上方
3. 点「取消」：浮标淡出（180ms），PostForm 里**没有**任何「正在回复」的文字残留
4. 提交一条回复：按钮文案变「发送中…」，`document.querySelector('form[aria-busy]')` 非空
5. `curl` 匿名抓该页 HTML，`grep -c ReplyTargetBar` 为 0；匿名浏览时 Network 里不出现 `ReplyTargetBar-*.js`

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/discussion/ReplyTargetBar.tsx apps/web/app/components/discussion/Discussion.tsx apps/web/app/components/discussion/PostForm.tsx apps/web/messages/
git commit -m "$(cat <<'MSG'
feat(web): 「回复中 · #N」浮标，PostForm 发送时切文案

点「引用」之后原来只有一行「正在回复引用的楼层。」——连是哪一楼都不说，
用户滚上去重读那一楼时这行还随表单一起出了视口。浮标是常驻状态的指示
（spec 三支柱的第三根），sticky 跟着走，带楼号、可跳回、可取消。

不做视口检测：position: sticky 就够了，useInView 只给 layout 门控。
含 motion 的组件走 lazy()，匿名读者永远走不到「引用」，不为它下载 39 KB。

发送时按钮文案切「发送中…」+ aria-busy：减弱动效下 spinner 会被冻结，
只有文案不会（spec 9.3）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: 发帖落款——新楼层的墨洇

spec §8.3：「发帖成功后新楼层的出现：命中当前楼层窗口 → 命令式播墨洇（不把 50 个 `<li>` 变成 motion 组件）；不在窗口内 → 先导航到邻近页再播。」

现状：`Discussion.onPosted` 在页内时只 `scrollIntoView`，新楼**没有任何标记**——50 层里哪一层是我刚发的，靠猜。导航的那条路径走 `#p{floor}` hash，`:target` 的 CSS 墨洇会亮（T1–T2 落地）。

**Files:**
- Modify: `apps/web/app/components/discussion/Discussion.tsx`

**Interfaces:**
- Consumes: `EASE_SUMI`（静态）、`animate`（`motion/react`，**动态 import**，C2）

- [ ] **Step 1: 墨洇函数**

`Discussion.tsx` 文件末尾、`function prefersReduced()` 之前加：

```ts
/**
 * 落款：在刚发的那一楼上播一次墨洇，与 app.css 里 `li[id^="p"]:target` 那条
 * 同一副面孔（12% 的 primary 洇开、淡去、1.2s、墨曲线）。
 *
 * 命令式 `animate()` 而不是把楼层做成 motion 组件（spec §8.3）；用动态 import
 * 而不是 `useAnimate` hook——后者要静态 import motion/react，会把 39 KB 钉进
 * 这个匿名可读页面的静态图（C2）。匿名读者永远发不了帖，走不到这里。
 *
 * 两个关键帧的字符串结构完全一致、只有百分数不同：motion 的复合值插值器会
 * 只对那个数字做插值，`var(--primary)` 与 `color-mix()` 原样保留、交给浏览器解析。
 *
 * 红线 6：命令式 animate() 不受 MotionConfig 管，自己门控——减弱动效下不做
 * 1.2s 的持续变化，改成「亮起、停住、消失」一次提示，与 :target 那条的降级同义。
 */
async function bloom(floor: number) {
  const el = document.getElementById(`p${floor}`)
  if (!el) return
  const { animate } = await import('motion/react')
  const at = (pct: number) =>
    `color-mix(in oklab, var(--primary) ${pct}%, transparent)`
  el.style.borderRadius = 'var(--radius-md)'
  if (prefersReduced()) {
    animate(
      el,
      { backgroundColor: [at(12), at(12), at(0)] },
      { duration: 1.2, times: [0, 0.99, 1], ease: 'linear' },
    )
    return
  }
  animate(el, { backgroundColor: [at(12), at(0)] }, { duration: 1.2, ease: EASE_SUMI })
}
```

import 区加 `import { EASE_SUMI } from '~/lib/motion'`。

- [ ] **Step 2: 页内路径播墨洇**

`onPosted` 里页内那一支，`requestAnimationFrame(() => { … scrollIntoView … })` 改成：

```tsx
      // 已在本页：等 revalidate 把新楼渲染出来再滚过去，然后落款
      requestAnimationFrame(() => {
        document.getElementById(`p${floor}`)?.scrollIntoView({
          block: 'center',
          behavior: prefersReduced() ? 'auto' : 'smooth',
        })
        void bloom(floor)
      })
```

- [ ] **Step 3: 导航路径的兜底**

导航到邻近页时 URL 带 `#p{floor}`，正常情况下 `:target` 的 CSS 墨洇会亮。但 `:target` 是否随 `pushState` 更新是浏览器行为，T1–T2 只在翻页路径上观察过。给一个不依赖它的兜底：

`const navigate = useNavigate()` 之后加：
```tsx
  /**
   * 导航路径的落款兜底：正常情况下 `#p{floor}` 让 :target 的 CSS 墨洇亮起，
   * 但 :target 是否随 pushState 更新是浏览器行为。目标页到达（page.from 变了）
   * 之后检查一次：:target 没落在那一楼，就用 JS 补一笔。
   */
  const pendingBloom = useRef<number | null>(null)
  useEffect(() => {
    const floor = pendingBloom.current
    if (floor === null) return
    const el = document.getElementById(`p${floor}`)
    if (!el) return
    pendingBloom.current = null
    if (document.querySelector(':target') === el) return
    void bloom(floor)
  }, [page.from])
```
（`useRef` / `useEffect` 加进 react 的 import。）

`onPosted` 里导航那一支，`navigate(…)` 之前加一行 `pendingBloom.current = floor`。

- [ ] **Step 4: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿。`check:fix` 可能把 `animate(el, {...}, {...})` 折行，正常。

- [ ] **Step 5: 浏览器实测（需登录用户，留给控制者）**

1. **页内**：在一个 <50 楼的主题里发一条回复，新楼滚到视口中央，且 `getComputedStyle(newLi).backgroundColor` 在发帖后立即读到**非 `rgba(0, 0, 0, 0)`**（关键帧已挂上），1.3s 后回到透明
2. **导航**：在 >50 楼的主题里发一条，页面跳到新页、`location.hash === '#p{N}'`，那一楼亮了（`:target` 或兜底其一生效——读 `document.querySelector(':target')?.id` 记进报告，这是 pushState 是否更新 :target 的实测答案）
3. **匿名**：`grep -c "motion/react" build/client/assets/Discussion-*.js` 为 0，且匿名浏览主题页时 Network 里没有 motion 的 chunk
4. **减弱动效**：注入 `matchMedia` 桩让 `prefersReduced()` 返回 true，发一条——楼层的背景色在 1.2s 内**恒为** 12% 而不是连续变化

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/discussion/Discussion.tsx
git commit -m "$(cat <<'MSG'
feat(web): 发帖落款——刚发的那一楼洇一滴墨

页内发帖此前只 scrollIntoView，50 层里哪一层是我刚发的靠猜。
命令式 animate() 而不是把楼层做成 motion 组件（spec 8.3）；用动态 import
而不是 useAnimate——后者会把 39 KB 钉进这个匿名可读页面的静态图。

与 :target 那条 CSS 墨洇同一副面孔。导航路径给了不依赖 :target 的兜底。
减弱动效下改成亮起、停住、消失的一次提示。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: 楼层的翻纸——编辑态切换不再瞬跳

spec §8.3：「编辑态展开：不动高度，改为翻纸。」现状：点「编辑」，`<Markdown>` 瞬间换成 `<PostForm>`，高度瞬跳。`popLayout` 让旧内容脱离文档流淡出、新内容淡入——高度不做动画（`Markdown.tsx` 里的图片是 `loading="lazy"`，测高会在图片到达后再变一次），这就是「翻纸」。

**「三选一」里只有两支参与翻纸**：`deleted` 态由软删 + revalidate 整体替换，不在此列。

**Files:**
- Create: `apps/web/app/components/discussion/FloorFlip.tsx`
- Modify: `apps/web/app/components/discussion/PostList.tsx`

**Interfaces:**
- Produces: `FloorFlip({ editing: boolean; view: ReactNode; edit: ReactNode; onSettled: () => void })`（default export，lazy 加载）

- [ ] **Step 1: 翻纸组件**

创建 `apps/web/app/components/discussion/FloorFlip.tsx`：

```tsx
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { EASE_SUMI } from '~/lib/motion'

/**
 * 一楼的正文 ⇄ 编辑框：翻纸，不动高度（spec §8.3）。
 *
 * popLayout 把退场的那一面改成 position:absolute、脱离文档流，进场的那一面
 * 直接占位——高度一步到位、两面交叉淡出淡入。不用 layout 测高：Markdown 里的
 * 图片 loading="lazy"，测到的高度会在图片到达后再变一次。
 *
 * 含 motion，由 PostList 通过 lazy() 加载，且只在「正在编辑或刚编辑完」的
 * 那一楼挂载——50 层的列表里其余 49 层是纯 <li>，spec 不许把它们变成 motion 组件。
 *
 * initial={false}：AnimatePresence 首次挂上时带着的那一面不播入场。
 * 退场只有 opacity（红线 4）；父容器 relative（红线 9）。
 */
export default function FloorFlip({
  editing,
  view,
  edit,
  onSettled,
}: {
  editing: boolean
  view: ReactNode
  edit: ReactNode
  onSettled: () => void
}) {
  return (
    <div className="relative mt-2">
      <AnimatePresence mode="popLayout" initial={false} onExitComplete={onSettled}>
        <motion.div
          key={editing ? 'edit' : 'view'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_SUMI }}
        >
          {editing ? edit : view}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: PostList 的门控与预取**

`apps/web/app/components/discussion/PostList.tsx`：

import 区：把 `import { useState } from 'react'` 换成
```tsx
import { lazy, Suspense, useState } from 'react'
import { flushSync } from 'react-dom'
```
并加：
```tsx
/** 含 motion，只在被编辑的那一楼挂载；hover「编辑」时预取，让第一次翻纸也有动画 */
const FloorFlip = lazy(() => import('./FloorFlip'))
const preloadFlip = () => void import('./FloorFlip')
```

`PostItem` 里 `const [editing, setEditing] = useState(false)` 之后加：
```tsx
  /**
   * 翻纸的挂载门控：AnimatePresence 必须**先**带着「正文」那一面挂上，
   * 再切到「编辑」，正文才有退场可播。flushSync 把第一步单独提交——
   * 两个 setState 批在同一次提交里的话，AnimatePresence 挂上时初始子节点
   * 已经是编辑框，initial={false} 让它什么也不播。
   * 编辑结束同理：先标记 flipping 再收起 editing，让编辑框有退场；退场播完
   * （onSettled）才卸掉 FloorFlip，这一楼回到纯 <li>。
   */
  const [flipping, setFlipping] = useState(false)
  const startEdit = () => {
    flushSync(() => setFlipping(true))
    setEditing(true)
  }
  const stopEdit = () => {
    setFlipping(true)
    setEditing(false)
  }
```

渲染里，`) : editing ? (` 到 `) : (` 那一段（编辑分支）改成：

```tsx
      ) : editing || flipping ? (
        <Suspense
          fallback={
            <div className="mt-2">
              <Markdown lang={p.locale}>{p.bodyMd}</Markdown>
            </div>
          }
        >
          <FloorFlip
            editing={editing}
            onSettled={() => setFlipping(false)}
            view={<Markdown lang={p.locale}>{p.bodyMd}</Markdown>}
            edit={
              <PostForm
                action={action}
                intent="edit"
                postId={p.id}
                initial={p.bodyMd}
                onDone={stopEdit}
                onCancel={stopEdit}
              />
            }
          />
        </Suspense>
      ) : (
```

「编辑」按钮改成：
```tsx
          {own && (
            <Button
              variant="ghost"
              size="xs"
              onPointerEnter={preloadFlip}
              onFocus={preloadFlip}
              onClick={startEdit}
            >
              {m.shrine_edit()}
            </Button>
          )}
```

- [ ] **Step 3: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿。

- [ ] **Step 4: 浏览器实测（需登录用户，留给控制者）**

1. hover「编辑」再点：正文淡出、编辑框淡入（用 MutationObserver 记 `.relative.mt-2 > div` 的子节点变化：**同一帧内两个子节点并存**，旧的是 `position: absolute`）
2. 点「取消」：编辑框淡出、正文淡入；播完后 `li` 里**不再有** `.relative.mt-2` 这层包裹（FloorFlip 已卸）
3. 页面上其余楼层：`document.querySelectorAll('[data-projection-id]').length` 为 0（没有别的楼被变成 motion 组件）
4. 匿名：`grep -c "motion/react" build/client/assets/PostList-*.js`（或 Discussion chunk）为 0
5. 减弱动效：opacity 过渡照播（spec 有意保留），无位移

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/discussion/FloorFlip.tsx apps/web/app/components/discussion/PostList.tsx
git commit -m "$(cat <<'MSG'
feat(web): 楼层编辑态翻纸，不动高度

点「编辑」此前 Markdown 瞬间换成 PostForm、高度瞬跳。popLayout 让旧的一面
脱离文档流淡出、新的一面直接占位——高度一步到位、两面交叉。不测高：
Markdown 里的图片 loading="lazy"，测到的高度会在图片到达后再变一次。

只在被编辑的那一楼挂 AnimatePresence，其余 49 层仍是纯 <li>（spec 8.3）。
flushSync 先让正文那一面挂上再切，第一次翻纸才有退场可播；hover 预取 chunk。
匿名读者的静态图里零 motion。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

# 批次 4 · 通知

### Task 6: 「全部已读」的墨扫

点「全部标为已读」之后，revalidate 回来时 N 个未读点一起消失、N 行字重一起变细——**一次操作、五十处瞬变、没有一笔把它们连起来**。墨扫：一道 10% 的 primary 从列表左缘一笔扫到右缘（`scaleX`，笔·运 `EASE_FUDE`），扫完淡去。它是「远端回执」——提交那一刻起笔，笔到了活也办完了。

装饰层契约：`aria-hidden` + `pointer-events-none`，不承载信息，所以允许自由入场。**通知页是登录后才有的页面，静态 import motion 不违反 C1。**

**Files:**
- Modify: `apps/web/app/routes/notifications.tsx`

**Interfaces:**
- Consumes: `motion`、`AnimatePresence`、`useReducedMotion`（`motion/react`）、`EASE_FUDE`、`EASE_SUMI`

- [ ] **Step 1: 起笔的时机与门控**

import 区加：
```tsx
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { EASE_FUDE, EASE_SUMI } from '~/lib/motion'
```

组件里 `const fetcher = useFetcher<typeof action>()` 之后加：
```tsx
  /**
   * 墨扫：一笔从左扫到右，把「N 个未读点各自消失」连成一次动作。
   *
   * 起笔在**提交那一刻**（远端回执：笔到了活也办完了），不等结果——等结果的话
   * 请求比笔快时笔画会被截断在半途。用 formData 区分：同一个 fetcher 也承担
   * 「点进某条即标已读」，那不该起笔。
   * 画完（onAnimationComplete）才收笔，与 fetcher 何时 idle 无关。
   *
   * 减弱动效：MotionConfig 会把 scaleX 直接跳到终态，那就是整片 10% 的色块
   * 闪一下再淡去——注意力敏感用户的干扰。整笔不画。
   */
  const reduce = useReducedMotion()
  const [sweeping, setSweeping] = useState(false)
  const submittingAll =
    fetcher.state === 'submitting' && fetcher.formData?.has('upTo') === true
  useEffect(() => {
    if (submittingAll && !reduce) setSweeping(true)
  }, [submittingAll, reduce])
```

- [ ] **Step 2: 笔画本身**

渲染里，`<ol className="mt-6 ink-divide border-y">` 这一支包一层容器并加笔画。把
```tsx
        <ol className="mt-6 ink-divide border-y">
```
改成
```tsx
        <div className="relative mt-6">
          <AnimatePresence>
            {sweeping && (
              <motion.div
                key="sweep"
                aria-hidden
                className="pointer-events-none absolute inset-0 origin-left bg-primary/10"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  scaleX: { duration: 0.4, ease: EASE_FUDE },
                  opacity: { duration: 0.18, ease: EASE_SUMI },
                }}
                onAnimationComplete={() => setSweeping(false)}
              />
            )}
          </AnimatePresence>
          <ol className="ink-divide border-y">
```
并把对应的 `</ol>` 之后补一个 `</div>`（`mt-6` 从 `<ol>` 挪到了外层 `div`）。

`onAnimationComplete` 在 `animate` 完成时触发一次、`exit` 完成时再触发一次；第二次时 `sweeping` 已是 false，`setSweeping(false)` 幂等。

- [ ] **Step 3: 门禁**

Run: `bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿。

- [ ] **Step 4: 浏览器实测（需登录且有未读，留给控制者）**

1. 点「全部标为已读」：起笔在点击瞬间（用 MutationObserver 观察 `.relative.mt-6 > [aria-hidden]` 的出现，时间戳早于 fetcher 变 idle）；笔画从左到右（`transform` 的 scaleX 单调增）；扫完淡出
2. 点某条通知（走 `{ id }` 提交）：**不起笔**
3. 减弱动效（注入 `matchMedia` 桩，或直接把 `reduce` 断言）：不起笔
4. 笔画元素 `aria-hidden="true"` 且 `pointer-events: none`（装饰层契约）

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/notifications.tsx
git commit -m "$(cat <<'MSG'
feat(web): 「全部已读」一笔墨扫

此前 revalidate 回来时 N 个未读点一起消失、N 行字重一起变细——一次操作、
五十处瞬变、没有一笔把它们连起来。一道 10% 的 primary 从左扫到右（scaleX，
笔·运），扫完淡去。

起笔在提交那一刻（远端回执），不等结果；用 formData 区分「全部已读」与
「点进某条即标已读」。减弱动效下整笔不画：MotionConfig 会把 scaleX 跳到终态，
那是一整片色块闪一下，比不画更糟。装饰层契约：aria-hidden + pointer-events-none。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

# 批次 5 · 香霖堂

### Task 7: MotionValue 星条——扫笔填充 + 提交期乐观保持 + 「我评过了」

spec §8.2：「评分星条：扫笔填充 + 提交期乐观保持。不做均分数字的滚动/闪色。」

现状（T4 落地后）：五个 `<button type="submit">`，CSS 的 `:has(~*:hover)` 做累积点亮——**离散**的（悬停第 4 颗，1–4 一起亮），提交后到 revalidate 回来之前星条空白，回来之后也**不显示我评过几分**（Task 1 之前 API 不给）。

MotionValue 版：指针在星条上的横坐标 → 一个连续的 `0..5` 值 → 每颗星按自己的区间算填充比例 → `clipPath` 露出金色的实心星。指针离开回到「我评过的分」；提交期间保持刚点的那个分（乐观）。**T4 的 CSS 累积点亮保留**：它是 no-JS 与 chunk 未到时的兜底，也是键盘用户的即时反馈。

**Files:**
- Create: `apps/web/app/components/kourindou/stars.tsx`（零 motion：静态星条 + 共享 class）
- Create: `apps/web/app/components/kourindou/star-strip.tsx`（MotionValue 星条，lazy）
- Modify: `apps/web/app/routes/kourindou/detail.tsx`

**Interfaces:**
- Consumes: `loaderData.myRating: number | null`（Task 1）；`SPRING_WASHI_VALUE`——**由本任务的 Step 1 追加进 `lib/motion.ts`**（`useSpring` 收的是不带 `type` 的 SpringOptions），Task 10 直接复用
- Produces: `StaticStars({ myRating })`、`STAR_BUTTON_CLASS`、`STARS`（`stars.tsx`）；`StarStrip({ myRating, submittingScore })`（`star-strip.tsx` default export）

- [ ] **Step 1: `lib/motion.ts` 追加 `SPRING_WASHI_VALUE`**

`apps/web/app/lib/motion.ts` 里，把
```ts
export const SPRING_WASHI = {
  type: 'spring',
  visualDuration: 0.28,
  bounce: 0,
} as const
```
改成
```ts
/**
 * `useSpring(value, …)` 收的是 SpringOptions，不带 `type`——给 MotionValue 用这份。
 * 组件的 `transition` prop 用下面带 `type` 的那份。两份的数字必须相同，
 * motion.test.ts 断言它。
 */
export const SPRING_WASHI_VALUE = { visualDuration: 0.28, bounce: 0 } as const

export const SPRING_WASHI = { type: 'spring', ...SPRING_WASHI_VALUE } as const
```
`motion.test.ts` 追加：
```ts
import { SPRING_WASHI, SPRING_WASHI_VALUE } from './motion'
// …
describe('SPRING_WASHI 两份写法同一个数', () => {
  test('MotionValue 用的那份与 transition 用的那份数字相同', () => {
    expect(SPRING_WASHI.visualDuration).toBe(SPRING_WASHI_VALUE.visualDuration)
    expect(SPRING_WASHI.bounce).toBe(SPRING_WASHI_VALUE.bounce)
    expect(SPRING_WASHI.type).toBe('spring')
  })
})
```
（把两个 import 合进文件顶部已有的那一行。）

Run: `cd apps/web && bun test app/lib/motion.test.ts` → PASS。

- [ ] **Step 2: 静态星条（零 motion）**

创建 `apps/web/app/components/kourindou/stars.tsx`：

```tsx
import { Star } from 'lucide-react'
import { Form } from 'react-router'
import { m } from '~/paraglide/messages'

export const STARS = [1, 2, 3, 4, 5] as const

/**
 * T4 落地的 CSS 累积点亮：悬停/聚焦第 n 颗，1..n 一起亮。
 * 它是 no-JS 与 chunk 未到时的兜底，也是键盘用户的即时反馈——MotionValue 版
 * 叠在它上面，不替换它。
 */
export const STAR_BUTTON_CLASS =
  'relative text-muted-foreground transition-colors hover:text-chart-2 focus-visible:text-chart-2 [&:has(~*:hover)]:text-chart-2 [&:has(~*:focus-visible)]:text-chart-2'

/**
 * 星条的静态形态：显示「我评过几分」（实心金星）与 CSS 累积点亮。
 * 既是 StarStrip 的 Suspense 兜底，也是 no-JS 的完整功能——五个 submit 按钮
 * 原样提交 intent=rate。
 */
export function StaticStars({ myRating }: { myRating: number | null }) {
  return (
    <Form method="post" className="ml-auto flex items-center gap-1">
      <input type="hidden" name="intent" value="rate" />
      {STARS.map((n) => (
        <button
          key={n}
          type="submit"
          name="score"
          value={n}
          aria-label={`${m.detail_rate()} ${n}`}
          aria-pressed={myRating === n}
          className={STAR_BUTTON_CLASS}
        >
          <Star
            className={
              myRating !== null && n <= myRating
                ? 'size-4 fill-current text-chart-2'
                : 'size-4'
            }
          />
        </button>
      ))}
    </Form>
  )
}
```

- [ ] **Step 3: MotionValue 星条（lazy）**

创建 `apps/web/app/components/kourindou/star-strip.tsx`：

```tsx
import { Star } from 'lucide-react'
import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { useEffect } from 'react'
import { Form } from 'react-router'
import { SPRING_WASHI_VALUE } from '~/lib/motion'
import { m } from '~/paraglide/messages'
import { STAR_BUTTON_CLASS, STARS } from './stars'

/**
 * 扫笔填充的星条（spec §8.2）。
 *
 * 一个连续的 0..5 MotionValue：指针在星条上的横坐标映射过来，每颗星按自己的
 * 区间 [n-1, n] 算填充比例，用 clipPath 露出叠在上面的实心金星——指针扫过去，
 * 填充跟着笔走，不是五档离散跳变。指针离开回到「我评过的分」。
 *
 * 提交期乐观保持：submittingScore 由 detail.tsx 从 useNavigation().formData 读出，
 * 从点下到 revalidate 回来之前星条一直显示刚点的那个分。
 *
 * 红线 6：MotionValue 直连 style 不受 MotionConfig 管——减弱动效下不走 spring，
 * 直接用原始值（指针跟随是直接操纵不是动画，离开时瞬回而不是回弹）。
 *
 * 含 motion，由 detail.tsx 通过 lazy() 加载，只在登录用户处渲染（C1）。
 * 兜底与 no-JS 形态是 StaticStars，两者共用 STAR_BUTTON_CLASS。
 */
export default function StarStrip({
  myRating,
  submittingScore,
}: {
  myRating: number | null
  submittingScore: number | null
}) {
  const reduce = useReducedMotion()
  const base = submittingScore ?? myRating ?? 0
  const pointer = useMotionValue(base)
  const spring = useSpring(pointer, SPRING_WASHI_VALUE)
  useEffect(() => {
    pointer.set(base)
  }, [pointer, base])
  const shown = reduce ? pointer : spring

  return (
    <Form
      method="post"
      className="ml-auto flex items-center gap-1"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const v = ((e.clientX - r.left) / r.width) * STARS.length
        pointer.set(Math.max(0, Math.min(STARS.length, v)))
      }}
      onPointerLeave={() => pointer.set(base)}
    >
      <input type="hidden" name="intent" value="rate" />
      {STARS.map((n) => (
        <StarButton
          key={n}
          n={n}
          shown={shown}
          pressed={myRating === n}
          onFocus={() => pointer.set(n)}
          onBlur={() => pointer.set(base)}
        />
      ))}
    </Form>
  )
}

function StarButton({
  n,
  shown,
  pressed,
  onFocus,
  onBlur,
}: {
  n: number
  shown: MotionValue<number>
  pressed: boolean
  onFocus: () => void
  onBlur: () => void
}) {
  // 这颗星的填充比例：shown 落在 [n-1, n] 之间时按比例，之外是 0 或 1
  const clipPath = useTransform(shown, (v) => {
    const fill = Math.max(0, Math.min(1, v - (n - 1)))
    return `inset(0 ${(1 - fill) * 100}% 0 0)`
  })
  return (
    <button
      type="submit"
      name="score"
      value={n}
      aria-label={`${m.detail_rate()} ${n}`}
      aria-pressed={pressed}
      className={STAR_BUTTON_CLASS}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Star className="size-4" />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 text-chart-2"
        style={{ clipPath }}
      >
        <Star className="size-4 fill-current" />
      </motion.span>
    </button>
  )
}
```

- [ ] **Step 4: detail.tsx 接上**

import 区加：
```tsx
import { lazy, Suspense, useState } from 'react'   // 把原来的 useState import 合并进来
import { data, Form, Link, redirect, useFetcher, useNavigation } from 'react-router'  // 加 useNavigation
import { StaticStars } from '~/components/kourindou/stars'
```
并在 import 区末尾加：
```tsx
/** 含 motion，只给登录用户渲染，lazy 加载（C1）；兜底是 StaticStars */
const StarStrip = lazy(() => import('~/components/kourindou/star-strip'))
```
`Star` 的 lucide import 若本文件不再直接用，删掉（Biome 会报未使用）。

组件里 `const { resource, circle, tags, versions, discussion, topicId } = loaderData` 改成
```tsx
  const { resource, circle, tags, versions, discussion, topicId, myRating } =
    loaderData
```
并在 `const locale = getLocale()` 之后加：
```tsx
  /**
   * 提交期乐观保持：从点下星到 revalidate 回来之前，星条显示刚点的那个分。
   * 评分走 <Form method="post">（导航式提交），在途表单在 navigation.formData 里。
   */
  const navigation = useNavigation()
  const submittingScore =
    navigation.formData?.get('intent') === 'rate'
      ? Number(navigation.formData.get('score'))
      : null
```

渲染里，把 `{user && (<Form method="post" className="ml-auto flex items-center gap-1">…</Form>)}` 整块（含五个按钮）换成：
```tsx
            {user && (
              <Suspense fallback={<StaticStars myRating={myRating} />}>
                <StarStrip
                  myRating={myRating}
                  submittingScore={submittingScore}
                />
              </Suspense>
            )}
```

- [ ] **Step 5: 门禁 + 体积**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test) && (cd apps/web && bun run build) && bun run check-bundle-size`
Expected: 全绿；**`/kourindou/:slug` 的读数与基线 252.85 相比只差零点几 KB**（StarStrip 是动态 import，不在静态图里）。若它涨了约 39 KB，说明 motion 进了 detail 的静态图——检查 `stars.tsx` 是否误 import 了 motion。

- [ ] **Step 6: 浏览器实测（需登录用户，留给控制者）**

1. 指针从左到右慢慢扫过星条：`document.querySelectorAll('[aria-label^="评分"] span')` 各自的 `clip-path` 从 `inset(0 100% 0 0)` 连续变到 `inset(0 0% 0 0)`（不是五档跳变）
2. 指针离开：回到 `myRating`（已评的话实心星数 = 分数）
3. 点第 3 颗：从点下到页面刷新完，第 1–3 颗实心（乐观保持）；刷新后仍是 3 颗（myRating 生效）；`aria-pressed="true"` 落在第 3 颗
4. 键盘：Tab 到第 4 颗，1–4 填充
5. 匿名：页面上没有星条；`check-bundle-size` 的 detail 读数没涨
6. 减弱动效：指针离开时瞬回，无回弹

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/lib/motion.ts apps/web/app/lib/motion.test.ts apps/web/app/components/kourindou/stars.tsx apps/web/app/components/kourindou/star-strip.tsx apps/web/app/routes/kourindou/detail.tsx
git commit -m "$(cat <<'MSG'
feat(web): 星条扫笔填充 + 提交期乐观保持 + 显示我评过的分

一个连续的 0..5 MotionValue 跟着指针走，每颗星按自己的区间算填充、用 clipPath
露出实心金星——扫过去填充跟着笔走，不是五档跳变。指针离开回到「我评过的分」
（Task 1 的 myRating），提交期间保持刚点的那个分。

红线 6：MotionValue 直连 style 不受 MotionConfig 管，减弱动效下不走 spring。
含 motion 的组件 lazy 加载、只给登录用户；兜底与 no-JS 形态是 StaticStars，
T4 的 CSS 累积点亮保留在两者共用的 class 里。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: 上传向导——纸落定、步骤墨线、焦点回表头

spec §8.2：「上传向导：只做纸落定，**不做退场、不做方向性滑动**。方向感由步骤墨线的笔画承担，不由位移承担。步骤容器设高度地板，换步后焦点回表头。」

现状：`step` 切换时三个 `{step === n && (…)}` 块瞬间互换，页面高度从约 700px 跳到约 300px，「下一步」按钮跟着跳；表头只有一行「第 n 步 / 共 3 步 · 基本信息」；焦点留在刚点过的按钮上（它已经不在原位）。

**上传页是登录后才有的（loader 未登录即 redirect），静态 import motion 不违反 C1。**

**Files:**
- Modify: `apps/web/app/routes/kourindou/upload.tsx`

**Interfaces:**
- Consumes: `motion`、`AnimatePresence`（`motion/react`）、`SPRING_WASHI`、`EASE_SUMI`

- [ ] **Step 1: import**

`upload.tsx` 的 import 区：
```tsx
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'   // 替换原来的 useId, useState
import { EASE_SUMI, SPRING_WASHI } from '~/lib/motion'
```

- [ ] **Step 2: 表头——焦点落点与步骤墨线**

`UploadWizard` 组件里 `const [step, setStep] = useState(1)` 之后加：
```tsx
  /**
   * 换步后焦点回表头（spec §8.2）：不这么做，焦点留在刚点过的「下一步」上——
   * 它在新的一步里已经换了位置甚至换了字（最后一步变「提交投稿」）。
   * 首次挂载不动焦点。
   */
  const heading = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    heading.current?.focus()
  }, [step])
```

`<header>` 里的 `<h1 className="font-heading text-2xl font-bold">{m.upload_title()}</h1>` 改成
```tsx
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-heading text-2xl font-bold outline-none"
        >
          {m.upload_title()}
        </h1>
```
并在 `<p className="mt-1 text-sm text-muted-foreground">…</p>` 之后加步骤墨线：
```tsx
        {/*
          步骤墨线：三段，走到第几步第几段就「画」出来（scaleX，笔·运）。
          方向感由这里承担，不由内容位移承担（spec §8.2）。
          纯 CSS 过渡；motion-reduce 下直接给终态。
        */}
        <ol aria-hidden className="mt-3 flex gap-1">
          {[1, 2, 3].map((i) => (
            <li
              key={i}
              className="h-0.5 flex-1 overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className="block h-full origin-left bg-primary transition-transform duration-washi-md ease-fude motion-reduce:transition-none"
                style={{ transform: `scaleX(${i <= step ? 1 : 0})` }}
              />
            </li>
          ))}
        </ol>
```
`duration-washi-md` / `ease-fude` 由 Tailwind 从 `@theme` 的 `--transition-duration-washi-md` / `--ease-fude` 解析（T1 已实测这两个命名空间）。

- [ ] **Step 3: 三步换成纸落定**

把 `<Separator className="my-6" />` 之后、`<div className="mt-8 flex items-center gap-3">`（底部按钮行）之前的三个 `{step === 1 && (…)}` / `{step === 2 && (…)}` / `{step === 3 && (…)}` 块，**原样**搬进下面这个壳里（块内一个字不改）：

```tsx
      {/*
        纸落定：新的一步从 --settle-y（6px）落到位、淡入；旧的一步只淡出，
        不做方向性滑动（spec §8.2）。popLayout 让旧的一步脱离文档流，新的一步
        直接占位——高度一步到位。

        relative：popLayout 用 offsetParent 定位退场节点（红线 9）。
        min-h-80：高度地板，第 2/3 步比第 1 步矮一半，没有地板的话底部按钮行
        会在换步瞬间往上跳 400px。
        initial={false}：第 1 步是 SSR 出来的，首帧即终态（红线 1）。
      */}
      <div className="relative min-h-80">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 'var(--settle-y)' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{
              ...SPRING_WASHI,
              opacity: { duration: 0.18, ease: EASE_SUMI },
            }}
          >
            {step === 1 && (
              …原来的第 1 步整块…
            )}
            {step === 2 && (
              …原来的第 2 步整块…
            )}
            {step === 3 && (
              …原来的第 3 步整块…
            )}
          </motion.div>
        </AnimatePresence>
      </div>
```

- [ ] **Step 3b: 许可卡挂 `paper-lift`**

spec §8.2：「许可卡：整个香霖堂唯一一处做完整『纸被括起一角』的地方。」T3 为它补了 `&:focus-visible` 那一支（它是 `<button>`，自身可聚焦、内部零可聚焦后代），但一直没挂上。`LicensePicker` 里那个 `<button>` 的 className 加 `paper-lift`：

```tsx
            className={`paper-lift rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
              value === l ? 'border-primary bg-muted/40' : ''
            }`}
```

`paper-lift` 是 `@utility`（T1–T2），带 `position: relative` 与右上角的折角 `::after`；这张卡的 Badge 在左上，不打架。`border-primary` 在这里是**有效的**——它同时写了 `border`（=1px），不属于 CLAUDE.md 里「卡片不能用 border-* 表达状态」那条空操作陷阱。

- [ ] **Step 4: 门禁**

Run: `bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿。

- [ ] **Step 5: 浏览器实测（需登录用户，留给控制者）**

0. 许可卡：hover 任一张，`transform` 为 `translateY(-2px)`、`::after` 的折角 `scale(1)`；Tab 到它同样（`&:focus-visible` 那一支，T3 补的）
1. 填好第 1 步点「下一步」：旧的一步淡出、新的一步从下方 6px 落到位（读 `transform` 从 `translateY(6px)` 变到 `none`）；底部按钮行的 `getBoundingClientRect().top` **不往上跳**（地板生效）
2. 换步后 `document.activeElement` 是 `<h1>`
3. 步骤墨线：第 2 段的 `transform` 从 `scaleX(0)` 过渡到 `scaleX(1)`，第 3 段仍是 0
4. 若 `y: 'var(--settle-y)'` 实测不位移（读到的初始 transform 是 `none`），改成 `y: 6` 并在报告里注明「motion 在这条路径上没解析 var()」——那是要记进 CLAUDE.md 的事实
5. 减弱动效：位移被 MotionConfig 跳过，淡入照播（spec 有意保留）；墨线直接给终态

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/kourindou/upload.tsx
git commit -m "$(cat <<'MSG'
feat(web): 上传向导纸落定、步骤墨线、焦点回表头，许可卡挂 paper-lift

换步此前三块瞬间互换，页面高度从约 700px 跳到 300px、按钮跟着跳，
焦点留在一个已经换了位置的按钮上。

只做纸落定不做方向性滑动（spec 8.2）：新的一步从 --settle-y 落到位，旧的一步
只淡出；方向感由三段步骤墨线的笔画承担。popLayout 让高度一步到位，
min-h 做地板。换步后焦点回 <h1>。

许可卡是 spec 点名「纸被括起一角」的唯一一处，T3 为它补的 &:focus-visible
分支终于有了落点。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: 镜像 `Reorder`——拖动排序，带键盘替代

第 2 步的镜像列表决定提交后 `resourceFile.sortOrder`，也就是详情页上下载链接的顺序——现在只能删了重加。`Reorder.Group` / `Reorder.Item` 拖动排序，**拖动只从把手起**（卡片里全是输入框，整卡可拖会与选字打架）。

红线 7：`Reorder.Item` 不自带键盘重排——每张卡带「上移 / 下移」。红线 3：`Card` 挂着 `backdrop-filter`，`Reorder.Item` 的 `layout` 显式传 `"position"`（实测源码里它是 `layout = true` 的可覆盖 prop）。

**Files:**
- Modify: `apps/web/app/routes/kourindou/upload.tsx`（第 2 步；新增 `MirrorCard` 组件）
- Modify: `apps/web/messages/{zh,ja,en}.json`

**Interfaces:**
- Consumes: `Reorder`、`useDragControls`（`motion/react`）；`GripVertical`、`ArrowUp`、`ArrowDown`（`lucide-react`）
- Produces: `MirrorCard`（同文件内）

- [ ] **Step 1: 三语文案**

`zh.json`：
```json
  "upload_mirror_drag": "拖动排序",
  "upload_mirror_up": "上移",
  "upload_mirror_down": "下移",
```
`ja.json`：
```json
  "upload_mirror_drag": "ドラッグして並べ替え",
  "upload_mirror_up": "上へ",
  "upload_mirror_down": "下へ",
```
`en.json`：
```json
  "upload_mirror_drag": "Drag to reorder",
  "upload_mirror_up": "Move up",
  "upload_mirror_down": "Move down",
```

- [ ] **Step 2: import 与状态操作**

import 区：
```tsx
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, Upload as UploadIcon } from 'lucide-react'   // 替换原来的 lucide 行
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'   // 替换 Task 8 加的那行
```

`UploadWizard` 里 `const [mirrors, setMirrors] = useState<MirrorDraft[]>([emptyMirror()])` 之后加：
```tsx
  /**
   * 不可变更新。此前是 `const next = [...mirrors]; next[i].label = …` 原地改对象——
   * Reorder 按对象身份认 value，原地改虽然不会坏，但让每一处 onChange 都得
   * 记住那个 i。按 key 定位，与 Reorder 的 values 天然对齐。
   */
  const patchMirror = (key: string, patch: Partial<Mirror>) =>
    setMirrors((ms) => ms.map((mi) => (mi.key === key ? { ...mi, ...patch } : mi)))
  const removeMirror = (key: string) =>
    setMirrors((ms) => ms.filter((mi) => mi.key !== key))
  /** 键盘替代（红线 7）：与拖动改的是同一份状态 */
  const moveMirror = (key: string, delta: -1 | 1) =>
    setMirrors((ms) => {
      const i = ms.findIndex((mi) => mi.key === key)
      const j = i + delta
      if (i < 0 || j < 0 || j >= ms.length) return ms
      const next = [...ms]
      const a = next[i] as MirrorDraft
      next[i] = next[j] as MirrorDraft
      next[j] = a
      return next
    })
```

- [ ] **Step 3: 第 2 步换成 `Reorder.Group`**

第 2 步块里，把 `{mirrors.map((mi, i) => (<Card key={mi.key}>…</Card>))}` 整段（到 `))}` 为止）换成：
```tsx
          <Reorder.Group
            as="div"
            axis="y"
            values={mirrors}
            onReorder={setMirrors}
            className="grid gap-4"
          >
            {mirrors.map((mi, i) => (
              <MirrorCard
                key={mi.key}
                mi={mi}
                index={i}
                total={mirrors.length}
                invalidUrl={err('url')}
                onPatch={(patch) => patchMirror(mi.key, patch)}
                onRemove={() => removeMirror(mi.key)}
                onMove={(delta) => moveMirror(mi.key, delta)}
              />
            ))}
          </Reorder.Group>
```
外层原来的 `<div className="grid gap-4">` 保留（它还包着下面的错误行与「添加镜像」按钮）。

- [ ] **Step 4: `MirrorCard` 组件**

在 `UploadWizard` 之前（`const mirrorLabel = …` 之后）加：

```tsx
/**
 * 一张镜像卡。拖动只从把手起（dragListener={false} + useDragControls）：
 * 卡片里全是输入框，整卡可拖会与选字打架。
 *
 * layout="position"（红线 3）：Card 挂着 backdrop-filter，both 会做 scale 校正，
 * 背板模糊逐帧重算、正文被拉伸。Reorder.Item 的 layout 是可覆盖的 prop。
 * 「上移 / 下移」是键盘替代（红线 7），与拖动改同一份状态。
 */
function MirrorCard({
  mi,
  index,
  total,
  invalidUrl,
  onPatch,
  onRemove,
  onMove,
}: {
  mi: MirrorDraft
  index: number
  total: number
  invalidUrl: boolean
  onPatch: (patch: Partial<Mirror>) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      as="div"
      value={mi}
      dragListener={false}
      dragControls={controls}
      layout="position"
    >
      <Card>
        <CardContent className="grid gap-3 pt-5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={m.upload_mirror_drag()}
              className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
              onPointerDown={(e) => controls.start(e)}
            >
              <GripVertical className="size-4" />
            </button>
            <span className="text-xs text-muted-foreground">
              {index + 1} / {total}
            </span>
            <div className="ml-auto flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={m.upload_mirror_up()}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={m.upload_mirror_down()}
                disabled={index === total - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown />
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{m.upload_mirror_label()}</Label>
            <Input
              value={mi.label}
              placeholder={m.upload_mirror_label_ph()}
              onChange={(e) => onPatch({ label: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label>{m.upload_mirror_url()}</Label>
            <Input
              value={mi.url}
              placeholder="https://…"
              aria-invalid={invalidUrl}
              onChange={(e) => onPatch({ url: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{m.upload_mirror_kind()}</Label>
              <Select
                value={mi.mirrorKind}
                onValueChange={(v) => onPatch({ mirrorKind: v as MirrorKind })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MIRROR_KIND.map((k) => (
                    <SelectItem key={k} value={k}>
                      {mirrorLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{m.upload_mirror_code()}</Label>
              <Input
                value={mi.extractCode}
                onChange={(e) => onPatch({ extractCode: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {m.upload_mirror_code_hint()}
              </p>
            </div>
          </div>
          {total > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-end"
              onClick={onRemove}
            >
              <Trash2 /> {m.upload_mirror_remove()}
            </Button>
          )}
        </CardContent>
      </Card>
    </Reorder.Item>
  )
}
```

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test)`
Expected: 全绿；`check-messages` 304 → **307**。

- [ ] **Step 6: 浏览器实测（需登录用户，留给控制者）**

1. 加三条镜像填不同 label；按住把手拖第 3 条到最上：松手后顺序变了，`mirrors` 的提交 JSON（第 3 步的预览列表）顺序跟着变
2. 键盘：Tab 到第 2 条的「上移」按 Enter，它到第 1 位，焦点仍在那颗按钮上（它随卡片一起移了）
3. 在 label 输入框里按住拖：**不**触发拖动（把手之外不可拖）
4. 减弱动效：拖动时其余卡片瞬时补位（MotionConfig 管到 layout）
5. `Reorder.Item` 渲染出的 `div` **没有** `tabindex` 属性（drag 不该塞 tabindex；有的话是红线 5 那类问题，报告）

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/kourindou/upload.tsx apps/web/messages/
git commit -m "$(cat <<'MSG'
feat(web): 镜像拖动排序，带键盘替代

镜像顺序决定提交后 resourceFile.sortOrder，也就是详情页下载链接的顺序——
此前只能删了重加。拖动只从把手起：卡片里全是输入框，整卡可拖会与选字打架。

layout="position"：Card 挂着 backdrop-filter，both 会让背板模糊逐帧重算（红线 3）。
每张卡带「上移 / 下移」：Reorder.Item 不自带键盘重排（红线 7）。
顺带把镜像的状态更新改成不可变、按 key 定位。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: 上传进度——`useSpring` 平滑的进度条

封面上传与帖子配图上传都走 `fetch` POST——**`fetch` 没有上传进度事件**。上限 5 MB 的图在慢网上要传十几秒，期间只有一句「上传中…」。改用 `XMLHttpRequest`（`upload.onprogress`），进度进 MotionValue，`useSpring` 把离散的进度事件抹成一条连续的线。**两处共用一份 `uploadImage()`**——现在是两份几乎相同的 `fetch` 代码。

红线 6：MotionValue 直连 `style`，减弱动效下不走 spring。进度条是**信息**不是装饰（`role="progressbar"`），只在上传中存在，不进 SSR。

**Files:**
- Create: `apps/web/app/lib/upload.ts`
- Create: `apps/web/app/components/upload-progress.tsx`
- Modify: `apps/web/app/components/discussion/PostForm.tsx`（lazy 加载进度条——它在匿名可读页面的静态图里）
- Modify: `apps/web/app/routes/kourindou/upload.tsx`（`CoverPicker`，静态加载）

**Interfaces:**
- Produces: `uploadImage(file: File, purpose: 'post' | 'cover', onProgress?: (ratio: number) => void): Promise<string>`（resolve 为图片 URL）；`UploadProgress({ ratio: number })`（default export）
- Consumes: `SPRING_WASHI_VALUE`（Task 7 已追加）

- [ ] **Step 1: 上传函数**

创建 `apps/web/app/lib/upload.ts`：

```ts
export type ImagePurpose = 'post' | 'cover'

/**
 * 上传一张图到 /api/uploads/image，resolve 为它的公开 URL。
 *
 * 用 XMLHttpRequest 而不是 fetch：**fetch 没有上传进度事件**，而上限 5 MB 的图
 * 在慢网上要传十几秒。同源请求，cookie 自动带上，与 fetch 一致。
 *
 * onProgress 收 0..1；lengthComputable 为 false 的浏览器不回调（进度条停在 0，
 * 文案仍是「上传中…」，信息不丢）。
 */
export function uploadImage(
  file: File,
  purpose: ImagePurpose,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads/image')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`upload failed: ${xhr.status}`))
        return
      }
      try {
        resolve((JSON.parse(xhr.responseText) as { url: string }).url)
      } catch (err) {
        reject(err)
      }
    }
    xhr.onerror = () => reject(new Error('upload failed'))
    const fd = new FormData()
    fd.append('file', file)
    fd.append('purpose', purpose)
    xhr.send(fd)
  })
}
```

- [ ] **Step 2: 进度条组件**

创建 `apps/web/app/components/upload-progress.tsx`：

```tsx
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { useEffect } from 'react'
import { SPRING_WASHI_VALUE } from '~/lib/motion'
import { m } from '~/paraglide/messages'

/**
 * 上传进度条。进度事件是离散的（浏览器按 chunk 回调），useSpring 把它抹成
 * 一条连续的线——纸·落的临界阻尼，不会冲过头再回来。
 *
 * 红线 6：MotionValue 直连 style 不受 MotionConfig 管，减弱动效下直接用原始值。
 * 它是信息不是装饰（role=progressbar），只在上传中存在，不进 SSR。
 *
 * 含 motion：PostForm 在匿名可读页面的静态图里，那边 lazy 加载；upload.tsx
 * 是登录后才有的路由，静态加载。
 */
export default function UploadProgress({ ratio }: { ratio: number }) {
  const reduce = useReducedMotion()
  const raw = useMotionValue(ratio)
  const spring = useSpring(raw, SPRING_WASHI_VALUE)
  useEffect(() => {
    raw.set(ratio)
  }, [raw, ratio])
  const scaleX = reduce ? raw : spring

  return (
    <div
      role="progressbar"
      aria-label={m.shrine_uploading()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="h-0.5 w-full overflow-hidden rounded-full bg-foreground/10"
    >
      <motion.div className="h-full origin-left bg-primary" style={{ scaleX }} />
    </div>
  )
}
```

- [ ] **Step 3: PostForm 接上（lazy）**

`apps/web/app/components/discussion/PostForm.tsx`：

import 区：把 `import { useEffect, useId, useRef, useState } from 'react'` 换成
```tsx
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { uploadImage } from '~/lib/upload'
```
并在 import 区末尾加：
```tsx
/** 含 motion；PostForm 在匿名可读页面的静态图里，进度条只在上传中才拉（C1） */
const UploadProgress = lazy(() => import('~/components/upload-progress'))
```

`const [uploading, setUploading] = useState<'idle' | 'busy' | 'failed'>('idle')` 之后加 `const [ratio, setRatio] = useState(0)`。

`async function upload(file: File) { … }` 整个函数体换成：
```tsx
  async function upload(file: File) {
    setUploading('busy')
    setRatio(0)
    try {
      const url = await uploadImage(file, 'post', setRatio)
      // 预览态下 textarea 没挂载，wrap() 会提前 return 把 URL 丢掉——直接追加到正文
      if (ref.current)
        wrap(
          '',
          `
![](${url})
`,
        )
      else
        setBody(
          (b) => `${b}
![](${url})
`,
        )
      setUploading('idle')
    } catch {
      setUploading('failed')
    }
  }
```

工具栏里 `{uploading === 'failed' && (<span …>…</span>)}` 之前加：
```tsx
        {uploading === 'busy' && (
          <span className="basis-full">
            <Suspense fallback={null}>
              <UploadProgress ratio={ratio} />
            </Suspense>
          </span>
        )}
```
（工具栏容器是 `flex flex-wrap`，`basis-full` 让进度条独占一行。）

- [ ] **Step 4: CoverPicker 接上（静态）**

`apps/web/app/routes/kourindou/upload.tsx`：

import 区加：
```tsx
import UploadProgress from '~/components/upload-progress'
import { uploadImage } from '~/lib/upload'
```

`CoverPicker` 里 `const inputId = useId()` 之后加 `const [ratio, setRatio] = useState(0)`。`async function upload(file: File) { … }` 换成：
```tsx
  async function upload(file: File) {
    setState('busy')
    setRatio(0)
    try {
      onChange(await uploadImage(file, 'cover', setRatio))
      setState('idle')
    } catch {
      // 失败只影响封面，表单其余内容原样保留
      setState('failed')
    }
  }
```

`<p className="text-xs text-muted-foreground">{state === 'busy' ? … : …}</p>` 之前加：
```tsx
          {state === 'busy' && <UploadProgress ratio={ratio} />}
```

- [ ] **Step 5: 门禁 + 体积**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test) && (cd apps/web && bun run build) && bun run check-bundle-size`
Expected: 全绿；`/kourindou/:slug` 与 `/shrine/t/:id` 的读数不涨（PostForm 里是 lazy）；`/kourindou/upload` 涨约 39 KB（本期第一次给它静态 import motion，是 Task 8 已经付过的门票，这里只多进度条本身）。

- [ ] **Step 6: 浏览器实测（需登录用户，留给控制者）**

1. 在回复框里传一张 2–4 MB 的图：进度条出现，`aria-valuenow` 单调递增到 100，`scaleX` 连续变化而不是几次跳变（spring）
2. 上传完成进度条消失，正文里多了 `![](…)`
3. 上传页封面同样
4. 匿名：`grep -c "motion/react" build/client/assets/PostForm-*.js`（或 Discussion chunk）为 0
5. 减弱动效：`scaleX` 直接等于 `aria-valuenow / 100`（无 spring 滞后）

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/lib/upload.ts apps/web/app/components/upload-progress.tsx apps/web/app/components/discussion/PostForm.tsx apps/web/app/routes/kourindou/upload.tsx
git commit -m "$(cat <<'MSG'
feat(web): 图片上传进度条，两处上传共用一份 uploadImage

封面与帖子配图都走 fetch——fetch 没有上传进度事件，5 MB 的图在慢网上
要传十几秒，期间只有一句「上传中…」。改用 XMLHttpRequest 拿 upload.onprogress，
进度进 MotionValue，useSpring 把离散事件抹成一条连续的线。

红线 6：MotionValue 直连 style，减弱动效下不走 spring。进度条是信息不是装饰
（role=progressbar）。PostForm 在匿名可读页面的静态图里，进度条 lazy 加载。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: 匿名可读路由的 motion 边界

C1 立了规矩，这一步把它钉成断言：`check-motion-boundary` 现在只从 `app/root.tsx` 出发。加**第二组根**——七个匿名可读的路由模块——对每个根的可达集断言**零** `motion/react` 静态 import（连 `MotionConfig` 也不许：这些根不含 root.tsx）。BFS 已经写好，只需把它抽成函数、多跑几遍。

**Files:**
- Modify: `scripts/check-motion-boundary.ts`

**Interfaces:**
- Produces: `bun run check-motion-boundary` 多打印七行 `✓ routes/… 可达集 N 个文件零命中 motion/react`

- [ ] **Step 1: 把 BFS 抽成函数**

`scripts/check-motion-boundary.ts` 里，`// ---- 从 root.tsx 出发做可达集的 BFS …` 那一段（从 `const visited = new Set<string>()` 到 `while` 循环结束）改成一个函数，放在原位置：

```ts
// ---- 可达集的 BFS：不跟 node_modules、不跟动态 import ----

function reachable(startFile: string) {
  const visited = new Set<string>()
  const queue: string[] = [startFile]
  const motionHitsByFile = new Map<string, ImportRecord[]>()

  while (queue.length > 0) {
    const file = queue.shift() as string
    if (visited.has(file)) continue
    visited.add(file)

    const source = readFileSync(file, 'utf8')
    const imports = extractImports(source)

    const hits = imports.filter((imp) => isMotionReact(imp.specifier))
    if (hits.length > 0) motionHitsByFile.set(file, hits)

    for (const imp of imports) {
      const resolved = resolveLocal(imp.specifier, file)
      if (resolved && !visited.has(resolved)) queue.push(resolved)
    }
  }
  return { visited, motionHitsByFile }
}

const { visited, motionHitsByFile } = reachable(rootFile)
```

后面断言 1、2 的代码引用的 `visited` / `motionHitsByFile` 名字不变，原样保留。

- [ ] **Step 2: 第二组根**

`process.exit(ok ? 0 : 1)` 之前加：

```ts
// ---- 断言 3：匿名可读路由的可达集零命中 motion/react（C1） ----
//
// 这些路由是被外链进来的匿名读者会打开的页面，/kourindou/:slug 更是全站流量最大的。
// 浮标、落款、翻纸、星条、上传进度全是登录后才用得上的东西——它们必须走
// lazy() / 动态 import，不许钉进这些路由的静态图。这条断言与断言 2 同源：
// A2 守首屏，这条守匿名页。

const ANON_ROUTES = [
  'routes/home.tsx',
  'routes/kourindou/list.tsx',
  'routes/kourindou/detail.tsx',
  'routes/shrine/index.tsx',
  'routes/shrine/board.tsx',
  'routes/shrine/topic.tsx',
  'routes/profile.tsx',
]

for (const rel of ANON_ROUTES) {
  const start = join(appDir, rel)
  if (!existsSync(start)) {
    ok = false
    console.log(`✗ 找不到 ${rel}——路由文件改名了？同步更新 ANON_ROUTES`)
    continue
  }
  const r = reachable(start)
  const hits = [...r.motionHitsByFile.keys()].sort()
  if (hits.length > 0) {
    ok = false
    for (const f of hits) {
      console.log(
        `✗ ${rel} 的可达集里 ${relative(root, f)} 静态 import 了 motion/react——匿名可读路由的静态图必须零 motion（C1：登录后才有的东西走 lazy()，匿名读者一个字节不下载）`,
      )
    }
  } else {
    console.log(`✓ ${rel} 可达集 ${r.visited.size} 个文件零命中 motion/react`)
  }
}
```

`appDir` 是脚本里已有的 `apps/web/app` 绝对路径变量（`rootFile` 就是用它拼的；若变量名不同，以文件里的为准）。`join` / `existsSync` / `relative` 已 import。

- [ ] **Step 3: 正向**

Run: `bun run check-motion-boundary`
Expected: 原两条 `✓` + 七条新 `✓`，退出码 0。**若某条 `✗`**——说明 Task 3/4/5/7/10 里有哪处把 motion 静态 import 进了匿名路由的图，那是那个任务的 bug，回去修它，不要放宽断言。

- [ ] **Step 4: 反向**

临时给 `apps/web/app/components/discussion/PostList.tsx` 顶部加一行 `import { motion } from 'motion/react'`，再跑：
Expected: `✗` 至少两条（`routes/kourindou/detail.tsx` 与 `routes/shrine/topic.tsx` 都能到达 PostList），退出码 1。

`git checkout -- apps/web/app/components/discussion/PostList.tsx` 还原，**先 `git status` 确认工作树干净再做这一步**。再跑确认恢复 `✓`。三步输出贴进报告。

- [ ] **Step 5: 门禁**

Run: `bun run check && bun run typecheck`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add scripts/check-motion-boundary.ts
git commit -m "$(cat <<'MSG'
test: 匿名可读路由的静态图零 motion，钉成断言

/kourindou/:slug 是被外链进来的、全站流量最大的页面，而浮标、落款、翻纸、
星条、上传进度全是登录后才用得上的东西。它们走 lazy()，这条断言保证没人
把 motion 静态 import 回这七个路由的图里。与 A2 的 root 断言共用同一个 BFS。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

# 批次 6 · 两条手写的（root 树，不引 motion）

### Task 12: 移动端抽屉边缘划走关闭

抽屉从左侧滑入，关闭只有 Esc、遮罩与底部按钮——**手指往左一划**是移动端最自然的关法，现在没有。手写 Pointer Events：手指拖动抽屉跟着走，松手时拖过 35% 宽度或甩得够快就关，否则弹回。`mobile-nav.tsx` 在 root 树里，不许引 motion（A2）。

**Files:**
- Modify: `apps/web/app/components/mobile-nav.tsx`

- [ ] **Step 1: 手势**

import 区：`import { useEffect, useState } from 'react'` 换成 `import { useEffect, useRef, useState } from 'react'`。

`useEffect(() => setOpen(false), [pathname])` 那行之后加：

```tsx
  /**
   * 边缘划走关闭：手指从抽屉上向左拖，抽屉跟着手走；松手时拖过 35% 宽度或
   * 甩动够快就关，否则弹回。手写 Pointer Events——本组件在 root 树里，不许引 motion。
   *
   * 只认触摸与笔（鼠标有 Esc、遮罩与关闭按钮）；先分辨轴向，竖向的交给滚动
   * （Content 上的 touch-pan-y 让浏览器只接管竖向）。
   *
   * 关闭时先把抽屉送到 -100%，transitionend 再 setOpen(false)：Radix 的退场
   * 动画会从当前 transform（已是 -100%）开始，不会先跳回 0 再滑出。
   * 减弱动效：瞬时到位，不做过渡。
   */
  const content = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    x: number
    y: number
    t: number
    axis: 'x' | 'y' | null
  } | null>(null)
  const swiped = useRef(false)
  useEffect(() => {
    if (open) swiped.current = false
  }, [open])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    gesture.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const el = content.current
    if (!g || !el) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (g.axis === 'x') el.setPointerCapture(e.pointerId)
    }
    if (g.axis !== 'x') return
    el.style.transition = 'none'
    el.style.transform = `translateX(${Math.min(0, dx)}px)`
  }
  const settle = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current
    const el = content.current
    gesture.current = null
    if (!g || !el || g.axis !== 'x') return
    const dx = e.clientX - g.x
    const velocity = dx / Math.max(1, e.timeStamp - g.t) // px/ms，负 = 向左
    const close = !cancelled && (dx < -el.offsetWidth * 0.35 || velocity < -0.5)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    el.style.transition = reduce
      ? 'none'
      : 'transform var(--transition-duration-washi-sm) var(--ease-washi)'
    if (!close) {
      el.style.transform = ''
      return
    }
    swiped.current = true
    el.style.transform = 'translateX(-100%)'
    if (reduce) {
      setOpen(false)
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setOpen(false)
    }
    el.addEventListener('transitionend', finish, { once: true })
    // transitionend 被打断时不触发；兜底一次，与 washi-sm 同量级
    setTimeout(finish, 250)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => settle(e, false)
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => settle(e, true)
  /** 划走之后紧跟的 click（落在某个 NavLink 上）不是导航意图 */
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!swiped.current) return
    swiped.current = false
    e.preventDefault()
    e.stopPropagation()
  }
```

- [ ] **Step 2: 挂到 Content 上**

`<DialogPrimitive.Content aria-describedby={undefined} className="…">` 改成：
```tsx
        <DialogPrimitive.Content
          ref={content}
          aria-describedby={undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={onClickCapture}
          className="fixed inset-y-0 start-0 z-50 flex w-64 max-w-[80vw] touch-pan-y flex-col gap-1 bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
        >
```
（只多了 `ref`、五个事件处理器与 `touch-pan-y`；原注释保留。）

- [ ] **Step 3: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-motion-boundary`
Expected: 全绿——`check-motion-boundary` 顺带证明本任务没往 root 树引 motion。

- [ ] **Step 4: 浏览器实测（匿名即可；`resize_window` 到 mobile 预设，留给控制者）**

1. 打开抽屉，用 `touch_path` / 触摸模拟从抽屉中部向左拖 60px 松手：抽屉弹回（`transform` 回到空）
2. 向左拖超过 90px（256px 的 35%）松手：抽屉滑出并关闭；关闭过程**没有先跳回 0 的一帧**（MutationObserver 记录 `style.transform` 序列）
3. 快速甩一下（位移小但速度大）：关闭
4. 竖向拖：抽屉不动（`transform` 始终为空），列表可滚
5. 划走后 `location.pathname` **没变**（NavLink 的 click 被吞了）；再次打开抽屉正常点击可导航（`swiped` 已复位）
6. 鼠标拖动：无反应

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/mobile-nav.tsx
git commit -m "$(cat <<'MSG'
feat(web): 移动端抽屉手指向左划走关闭

关闭此前只有 Esc、遮罩与底部按钮——手指往左一划是移动端最自然的关法。
手写 Pointer Events：抽屉跟着手走，松手时拖过 35% 宽或甩得够快就关，否则弹回。
本组件在 root 树里，不引 motion（A2）。

只认触摸与笔；先分辨轴向，竖向交给滚动（touch-pan-y）。关闭时先送到 -100%
再 setOpen(false)，Radix 的退场从当前位置起、不先跳回 0。划走后紧跟的 click
不当导航。减弱动效下瞬时到位。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: header 下滚收起、上滚露出

站长拍板做的。此前的顾虑与处置：
- **`scroll-mt-20` 的深链落点按 header 可见算**——处置：`hashchange` 时强制露出，RR 的 `pushState` 导航则由「导航在途强制露出」覆盖（`navigation.state !== 'idle'` 那一段 header 一定可见，ScrollRestoration 在那之后才滚）。页内 `scrollIntoView({ block: 'center' })` 不受影响。
- **它是每页每次滚动都跑的主线程回调**——处置：`passive` 监听 + rAF 节流 + 只在值变化时写 `dataset`。
- **pending 墨线挂在 header 下缘**——处置：导航在途强制露出。
- **减弱动效**：整个功能不启用。一个 56px 的条瞬间出现/消失是位移类刺激，换来的只是 56px 空间。

`site-header.tsx` 在 root 树里，手写。

**Files:**
- Modify: `apps/web/app/components/site-header.tsx`
- Modify: `apps/web/app/app.css`（`@layer components`）

- [ ] **Step 1: CSS**

`app.css` 的 `@layer components` 里、`.ink-row {` 那一段之前加：

```css
  /* header 下滚收起（手写，见 site-header.tsx）。sticky 元素做 translateY 不改布局，
     正文不会跳。只有 data-hidden 出现之后才有过渡——SSR 没有这个属性，首帧零动画；
     减弱动效下 JS 根本不设它。 */
  .site-header[data-hidden] {
    transition: transform var(--transition-duration-washi-md) var(--ease-washi);
  }
  .site-header[data-hidden="true"] {
    transform: translateY(-100%);
  }
```

- [ ] **Step 2: 监听**

`site-header.tsx` import 区：
```tsx
import { useEffect, useRef } from 'react'
import { Link, NavLink, useNavigation, useRevalidator } from 'react-router'   // 加 useNavigation
```

`SiteHeader` 里 `const revalidator = useRevalidator()` 之后加：

```tsx
  const header = useRef<HTMLElement>(null)
  const navigation = useNavigation()

  /**
   * 下滚收起、上滚露出。手写——本组件在 root 树里，不许引 motion（A2）。
   *
   * 强制露出的三种情况：接近页顶（< 56px）；导航在途（pending 墨线挂在下缘，
   * 藏起来就看不见了；且 ScrollRestoration 在这之后才滚，深链落点按 header 可见算）；
   * hashchange（同上，页内锚点跳转）。焦点在 header 内时不收（键盘用户正在用它）。
   *
   * passive + rAF 节流 + 只在值变化时写 dataset：它是每页每次滚动都跑的回调。
   * 减弱动效：整个功能不启用——56px 的条瞬间出没是位移类刺激，换来的只是 56px 空间。
   */
  useEffect(() => {
    const el = header.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let last = window.scrollY
    let ticking = false
    const set = (hidden: boolean) => {
      const next = hidden ? 'true' : 'false'
      if (el.dataset.hidden !== next) el.dataset.hidden = next
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const y = window.scrollY
        const dy = y - last
        last = y
        if (y < 56 || dy < -4) set(false)
        else if (dy > 4 && !el.matches(':focus-within')) set(true)
      })
    }
    const show = () => set(false)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('hashchange', show)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('hashchange', show)
    }
  }, [])
  useEffect(() => {
    if (navigation.state !== 'idle')
      header.current?.setAttribute('data-hidden', 'false')
  }, [navigation.state])
```

`<header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">` 改成
```tsx
    <header
      ref={header}
      className="site-header sticky top-0 z-40 border-b bg-background/85 backdrop-blur"
    >
```

- [ ] **Step 3: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-motion-boundary && (cd apps/web && bun run build) && bun run check-css-layers && bun run check-bundle-size`
Expected: 全绿；首屏读数与基线 151.49 相比只差零点几 KB（多了几十行 JS）。

- [ ] **Step 4: 浏览器实测（匿名即可，`resize_window` 1280×900，留给控制者）**

进 `/shrine`（够长）：
1. `window.scrollTo(0, 400)` 再 `scrollBy(0, 40)`（模拟下滚）：header 的 `data-hidden` 变 `"true"`，`getBoundingClientRect().bottom ≤ 0`
2. `scrollBy(0, -40)`：`"false"`，header 回到视口
3. 在 hidden 状态下 `location.hash = '#main'`：`"false"`
4. hidden 状态下点一个 NavLink（客户端导航）：导航开始时 `"false"`
5. `document.documentElement.scrollTop` 回 0：`"false"`
6. 注入 `matchMedia` 桩使 reduce 为 true、刷新：滚多少 `data-hidden` 都**不出现**
7. SSR HTML 里 `<header` 没有 `data-hidden`（首帧零动画）

隐藏面板里 `scroll` 事件与 rAF 都可能不推进（见 memory 里那条）——若第 1 条读不到变化，先 `document.visibilityState` 确认，再用 `tabs_select` 提到前台重试。

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/site-header.tsx apps/web/app/app.css
git commit -m "$(cat <<'MSG'
feat(web): header 下滚收起、上滚露出

手写 scroll 监听（passive + rAF 节流 + 只在值变化时写 dataset），本组件在
root 树里不引 motion。sticky 元素做 translateY 不改布局。

三种情况强制露出：接近页顶、导航在途（pending 墨线挂在下缘，且深链落点
按 header 可见算）、hashchange。焦点在 header 内时不收。减弱动效下整个功能
不启用——56px 的条瞬间出没是位移类刺激，换来的只是 56px 空间。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
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
Expected: 全绿，e2e 40 通过 / 0 失败（Task 1 只**加**字段，e2e 读的 `topicId` 不受影响）。**`e2e` 必须在 `apps/api` 下跑**；根脚本（`check-*`）必须在**仓库根**跑——在子目录跑会打印 `Script not found` 却退出 0（T4 记过这条）。

- [ ] **体积复核与校准（T3 立的交接：装了新东西就重新称重）**

`bun run check-bundle-size` 的读数与基线并排贴进报告：
- 首屏：应与 151.49 相差不超过 1 KB（Task 12/13 各几十行 JS；**motion 没有进 root 树**——`check-motion-boundary` 的断言 1/2 是证据）
- `/kourindou/:slug`：应与 252.85 相差不超过 1 KB（**motion 没有进匿名图**——断言 3 是证据）
- `/shrine/t/:id`：同上不涨
- `/kourindou/upload` 与 `/notifications`：各涨约 39–41 KB（静态 import motion，登录后才有的路由，是设计允许的）

按实测改 `scripts/check-bundle-size.ts` 头注释里的读数与「多出的文件」说明；**两个预算常量不动**——若哪条路由真的超了 270，那是 C1 的断言漏了，回去查，不放宽预算。

- [ ] **更新 CLAUDE.md**

先 `grep -n "root 树一律不进 motion 树" CLAUDE.md` 找到 T4 写的那条，在它**之后**追加：

```markdown
  - **匿名可读路由的静态图零 motion（T5 立的 C1）**：`home` / `kourindou/list` / `kourindou/detail` / `shrine/index` / `shrine/board` / `shrine/topic` / `profile` 七个路由从各自出发的可达集里不许出现 `motion/react` 的静态 import——`/kourindou/:slug` 是被外链进来的、全站流量最大的页面，而浮标/落款/翻纸/星条/上传进度全是登录后才用得上的。**登录后才有的东西走 `lazy()` + 动态 `import()`**（`ReplyTargetBar` / `FloorFlip` / `StarStrip` / `UploadProgress`），命令式动画用 `await import('motion/react')` 拿 `animate`（`Discussion.tsx` 的 `bloom`）。`check-motion-boundary` 的第二组根钉住它，与 A2 共用同一个 BFS
  - **红线 6 的三类现在都有示范**：MotionValue 直连 `style` → `star-strip.tsx` / `upload-progress.tsx`（`reduce ? raw : spring`）；命令式 `animate()` → `Discussion.tsx` 的 `bloom`（`prefersReduced()` 分支）；opacity 的 delay → `lib/motion.ts` 的 `confirmStagger`。**新增这三类时照抄它们的守卫**
  - **红线 7 的示范**：`upload.tsx` 的 `MirrorCard`——`Reorder.Item` 配「上移 / 下移」按钮，拖动只从把手起（`dragListener={false}` + `useDragControls`），`layout="position"`（Card 挂着 backdrop-filter，红线 3）
  - **常驻状态的第二个示范**：`ReplyTargetBar`（「回复中 · #N」），`position: sticky` 跟着走，**不做视口检测**（红线 2）
  - **两条手写的（root 树，不引 motion）**：抽屉边缘划走（`mobile-nav.tsx`，只认触摸与笔，`touch-pan-y`，划走后的 click 不当导航）；header 下滚收起（`site-header.tsx` + `.site-header[data-hidden]`，**减弱动效下整个不启用**，导航在途与 `hashchange` 时强制露出——深链落点 `scroll-mt-20` 是按 header 可见算的）
  - `uploadImage()`（`lib/upload.ts`）是图片上传的唯一入口：XHR 拿进度，两处共用，别再写第三份 fetch
```

- [ ] **提交收尾**

```bash
cd /Users/i/Code/th
git add CLAUDE.md scripts/check-bundle-size.ts
git commit -m "$(cat <<'MSG'
docs: CLAUDE.md 记下 T5 的匿名路由边界与三类守卫的示范，并校准体积读数

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

## 明说不做的（不是遗漏）

- **spec §9.3「全站 12 处 busy 统一按文案切换 + aria-busy 实现」**——本期只做了 PostForm 一处（Task 3）。其余 11 处是独立的一条工作，不混进动效计划；记为后续。
- **通知未读点的逐个退场动画**——50 个 `AnimatePresence` 换 50 个 2px 圆点的淡出，墨扫已经把这次动作连成一笔，不再叠加。
- **`useVelocity`**——零落点。星条的扫笔用位置就够了，速度感由 spring 的临界阻尼给。
- **抽屉的「从屏幕左缘划入打开」**——那要在页面级监听边缘手势，与浏览器的返回手势冲突（iOS Safari 左缘划是后退）。只做「划走关闭」。
- **header 收起时打开着的 dropdown**：Radix 的菜单是 portal，`:focus-within` 兜不住它——用户开着菜单往下滚，header 会藏而菜单留在原地。已知，不处理：开着菜单滚动本身就少见，菜单在下一次点击时自己关。
