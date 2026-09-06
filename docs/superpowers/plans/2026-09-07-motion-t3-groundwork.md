# 和风纸境 T3：根集减重与三个真缺陷 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 T3 原本要花在装 `motion` 上的额度，先花在收益覆盖 100% 访客、且**零新增依赖**的地方；同时把装 motion 的前置护栏（体积门禁）立起来。

**Architecture:** 全部改动在 `apps/web` 与 `scripts/`，**零新增运行时依赖**。核心是一次根集减重（每个匿名访客省 10.7 KB gz）、一个能抓住「谁又往根集塞东西」的体积门禁、以及三个此前没人看见的真缺陷（错误合流、服务端时钟、全站静默）。

**Tech Stack:** Bun · React Router 8 (SSR) · React 19 · Tailwind v4 · Paraglide JS

**Spec:** `docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md`

**前置:** T0、T1–T2 已合入 main。

**这一期为什么长这样:** 原计划的 T3 是「装 motion」。一轮实测勘察（5 路交互面 + 1 路值不值裁决）得出的结论是：在 `domAnimation` 约束下，列表退场唯一正确的 motion 写法（`mode="sync"` 或 `popLayout` + 动 opacity/height）**CSS 逐字能复刻**，而受益方是 1–3 个 staff；同时勘察挖出六处覆盖全体访客、零依赖就能修的东西。站长裁定「两者都做，先清单再装 motion」——本计划是「清单」那半，motion 那半是 T4，它以本计划的 Task 2（体积门禁）为硬前置。

## Global Constraints

- **零新增运行时依赖。** 本期一个包都不装（Task 9 的 CI 是可选项，且不装运行时包）。
- 文案一律走 Paraglide；新增 key 必须 zh/ja/en 三语齐全，否则 `bun run check-messages` 退出码 1。
- **不得使用 `m` 作为 Paraglide 之外的标识符**（`scripts/check-messages.ts:74` 的正则 `/\bm\.([a-zA-Z0-9_]+)\(/g`）。
- **内容层首帧即终态，禁止任何 `initial` 隐藏态**；装饰层需同时有 `aria-hidden="true"` 与 `pointer-events: none`。
- 只动 transform / opacity / 颜色。
- **`prefers-reduced-motion` 的降级规则一律加进 `app.css` 文件末尾那个不带任何 `@layer` 的块**，`bun run check-css-layers` 断言这一点。
- Biome：单引号、按需分号；`**/*.css` 不进 Biome，CSS 自己看。
- 提交信息末尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## 已核实的实测数据（不要重新估算）

| 项 | 值 |
|---|---|
| **root 首屏集**（每个匿名访客必付） | **161.2 KB gz**（23 个文件） |
| 其中 `auth-client-*.js` | **10.7 KB gz** ← Task 1 要移出去的 |
| 前四大 | `entry.client` 55.9、`jsx-runtime` 27.6、Radix collection/dropdown/dialog 20.1、`errorBoundaries` 11.4 |
| `/kourindou` | 200.5 KB gz |
| `/dash` | 201.8 KB gz（其中 dash 独有 40.0 KB） |
| **`/shrine/t/:id`（全站最重）** | **256.2 KB gz**（`Markdown` 单 chunk 48.3 KB） |

口径：解析 `apps/web/build/server/index.js` 内联的 RR manifest，首屏集 = `entry.module ∪ entry.imports ∪ routes.root.module ∪ routes.root.imports`，**逐文件 gzip -9 求和**（不是拼起来压一次——拼压会互相蹭字典，实测乐观 6.9 KB）。

---

### Task 1: 根集减重——`authClient` 移出首屏

**每个匿名访客都在下载 10.7 KB 的 better-auth 客户端，只为了一个他们永远不会点的登出按钮。**

`site-header.tsx:16` 在模块顶层 `import { authClient }`，唯一用途是第 44 行的 `await authClient.signOut()`。而 `SiteHeader` 在 `root.tsx` 里，是所有路由的父级。

**Files:**
- Modify: `apps/web/app/components/site-header.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯打包边界改动）。Task 2 的体积门禁会把这次省下的量锁住。

- [ ] **Step 1: 先量出改动前的基线**

Run:
```bash
bun run build >/dev/null 2>&1
python3 - <<'PY'
import re, json, gzip, os
src = open('build/server/index.js').read()
mo = re.search(r'var server_manifest_default = (\{.*?\});', src, re.S)
man = json.loads(re.sub(r':\s*void 0', ': null', mo.group(1)))
def urls(e): return [e['module']] + list(e.get('imports') or [])
files = set(urls(man['entry'])) | set(urls(man['routes']['root']))
tot = 0
rows = []
for u in sorted(files):
    p = 'build/client' + u.split('?')[0]
    if not os.path.exists(p): continue
    n = len(gzip.compress(open(p,'rb').read(), 9))
    tot += n; rows.append((n, os.path.basename(p)))
print(f"root 首屏集 {len(rows)} 个文件 {tot/1024:.2f} KB gz")
for n, b in sorted(rows, reverse=True)[:6]: print(f"  {n/1024:7.2f}  {b}")
PY
```
把输出贴进报告。**期望**：约 161 KB、23 个文件，且列表里能看到 `auth-client-*.js` 约 10.7 KB。

- [ ] **Step 2: 改成动态 import**

`apps/web/app/components/site-header.tsx`：

(a) 删掉顶层这一行：

```ts
import { authClient } from '~/lib/auth-client'
```

(b) 把 `logout` 改成：

```ts
  async function logout() {
    /**
     * 动态 import：`SiteHeader` 在 root.tsx 里，是所有路由的父级——顶层 import
     * 会把 better-auth 客户端（10.7 KB gz）钉进每一个匿名访客的首屏包，
     * 而匿名访客按定义永远不会登出。
     * login/register 有自己的路由 chunk，不受这里影响。
     */
    const { authClient } = await import('~/lib/auth-client')
    await authClient.signOut()
    revalidator.revalidate()
  }
```

- [ ] **Step 3: 量出改动后的数字**

重跑 Step 1 的脚本。**期望**：首屏集降到约 150.5 KB，且 `auth-client-*.js` **不再出现在列表里**。

若它仍在列表里，说明还有别的模块在 root 树上 import 它——`grep -rn "auth-client" apps/web/app` 找出来并报告，**不要自行扩大改动范围**。

- [ ] **Step 4: 浏览器实测登出仍然可用**

**这一步不能省**——动态 import 改的是加载时机，最容易出的错是「按钮点了没反应」。

用 Browser pane（端口见报告顶部说明），登录后点头像菜单里的登出，确认：会话真的结束（页面回到未登录态、出现「登录/注册」按钮）、无控制台错误。

- [ ] **Step 5: 门禁与提交**

```bash
cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)
git add apps/web/app/components/site-header.tsx
git commit -m "$(cat <<'EOF'
perf(web): authClient 改动态 import，根集减重 10.7 KB gz

SiteHeader 在 root.tsx 里、是所有路由的父级，顶层 import better-auth 客户端
把 10.7 KB gz 钉进了每一个匿名访客的首屏包——而匿名访客按定义永远不会登出。
改成登出处理器里动态 import，login/register 有自己的路由 chunk 不受影响。

首屏集 161.2 → 约 150.5 KB gz。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 体积门禁 `check-bundle-size`

**这是 T4 装 motion 的硬前置。** 勘察实测过一个必须被称重才能抓住的故障：把 `import('motion/react')` 写进任何一个叶子路由的同一个文件里（同文件既静态又动态 import），rolldown 会放弃分包、把 motion 提进**共享 chunk**，全站每页 +22.7 KB——**而 Vite 8 连警告都不打**。code review 抓不住，只有称重抓得住。

**Files:**
- Create: `scripts/check-bundle-size.ts`
- Modify: `package.json`（根，scripts 块）

**Interfaces:**
- Consumes: `apps/web/build/server/index.js` 内联的 RR manifest
- Produces: `bun run check-bundle-size`。T4 以它为前置。

- [ ] **Step 1: 写脚本**

创建 `scripts/check-bundle-size.ts`。**体例照 `scripts/check-css-layers.ts`**（先读它：读构建产物、中文注释讲清为什么、`✓`/`✗` + 退出码）。要求：

- 数据源：`apps/web/build/server/index.js` 里 `var server_manifest_default = {…}`，用 `.replace(/:\s*void 0/g, ': null')` 后 `JSON.parse`，**不用 `eval`**。
- **首屏集** = `entry.module ∪ entry.imports ∪ routes.root.module ∪ routes.root.imports`——任意 URL 都会加载的集合。
- **逐文件 gzip level 9 求和**，不是拼起来压一次。
- 两条预算：`SHARED_BUDGET_KB = 155`、`ROUTE_BUDGET_KB = 270`（首屏集 + 该路由自身 module/imports）。
  **第二条不能省**：否则把重物塞进叶子就绕过了门禁。
- 失败时打印**最重的 6 个 chunk**，否则报错等于没报。
- 只用 Bun 内置（`node:fs`/`node:path`/`node:zlib`）。

预算取值理由写进脚本注释：Task 1 之后首屏约 150.5 KB，留 4.5 KB 余量；最重路由 `/shrine/t/:id` 约 256 KB（其中 `Markdown` 48.3 KB），留 14 KB。**T4 装 motion 后要重新校准并在那时说明理由。**

- [ ] **Step 2: 挂进 package.json**

根 `package.json` 的 scripts 里，`check-css-layers` 那一行**之后**加：

```json
    "check-bundle-size": "bun run scripts/check-bundle-size.ts"
```

**不要**接进 `bun run check`（Biome 那条）——它需要先有构建产物。

- [ ] **Step 3: 正反验证（这是本任务的验收，不许跳过）**

1. 当前状态：`cd /Users/i/Code/th/apps/web && bun run build >/dev/null 2>&1 && cd /Users/i/Code/th && bun run check-bundle-size` → **应当通过**，输出里能看到两条预算各自的实际值。
2. **临时**把预算改成 `SHARED_BUDGET_KB = 100`，重跑 → **必须失败**、退出码 1、且列出最重的 6 个 chunk。
3. 改回 155，重跑 → 恢复通过。

三步的**实际输出**都贴进报告。

- [ ] **Step 4: 提交**

```bash
cd /Users/i/Code/th && bun run check && bun run typecheck
git add scripts/check-bundle-size.ts package.json
git commit -m "$(cat <<'EOF'
test: 新增 check-bundle-size——唯一能抓住静默分包失败的东西

实测过一个 code review 抓不住的故障：同一文件里既静态又动态 import 一个包，
rolldown 会放弃分包、把它提进共享 chunk，全站每页变重，而 Vite 8 连警告都不打。
只有称重抓得住。

口径钉死：首屏集 = entry ∪ routes.root 的 module+imports，逐文件 gzip -9 求和
（拼起来压一次会互相蹭字典，实测乐观 6.9 KB）。两条预算——共享集与单路由，
后者不能省，否则把重物塞进叶子就绕过了门禁。

这也是后续引入任何前端库的硬前置。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `/dash` 审核队列的错误合流

**审核员遇到 403 或「已被别人审过」，屏幕上写的是「请填写驳回理由」。**

`queue.tsx` 的 action 有两条返回 `ok: false` 的路径：

- 第 46-48 行：缺 `rejectReason`，**根本没打 API**
- 第 62 行 `return { ok: res.ok }`：API 真的失败了（403 / 409 / 网络）

而第 82 行 `const missingReason = fetcher.data?.ok === false` 把两者判成同一件事。

同时第 133-145 行的驳回按钮只有 `disabled={busy}`，缺 `|| !reason`——本可以在客户端拦住的路径，每次都要白跑一趟服务端往返。

**Files:**
- Modify: `apps/web/app/routes/dash/queue.tsx`

**Interfaces:**
- Consumes: `apiErrorCode` / `errorMessage`（`~/lib/api-error`），`reports.tsx` 已在用
- Produces: 无

- [ ] **Step 1: 先读 reports.tsx 的既有写法**

Run: `cd /Users/i/Code/th/apps/web && grep -n "apiErrorCode\|errorMessage" app/routes/dash/reports.tsx`

`reports.tsx` 已经把这件事做对了——**照抄它的形状**，不要发明第二套。把 grep 输出贴进报告。

- [ ] **Step 2: action 区分两条路径**

`apps/web/app/routes/dash/queue.tsx` 的 action：

(a) 顶部 import 区加（若尚未有）：

```ts
import { apiErrorCode } from '~/lib/api-error'
```

(b) 把

```ts
  if (decision === 'reject' && !rejectReason) {
    return { ok: false as const }
  }
```

改成

```ts
  // 客户端本该拦住，这里是兜底。code 与 API 错误分开，否则 403 会显示成「请填写驳回理由」
  if (decision === 'reject' && !rejectReason) {
    return { ok: false as const, code: 'validation_failed' as const }
  }
```

(c) 把结尾的

```ts
  return { ok: res.ok }
```

改成

```ts
  const code = await apiErrorCode(res)
  return code ? { ok: false as const, code } : { ok: true as const }
```

- [ ] **Step 3: 组件区分两种提示**

在 `ReviewActions` 里，把

```ts
  const missingReason = fetcher.data?.ok === false
```

改成

```ts
  const failCode = fetcher.data?.ok === false ? fetcher.data.code : undefined
```

并把渲染那处

```tsx
      {missingReason && (
        <p className="text-xs text-destructive">{m.dash_reject_required()}</p>
      )}
```

改成

```tsx
      {failCode && (
        <p className="text-xs text-destructive" role="alert">
          {failCode === 'validation_failed'
            ? m.dash_reject_required()
            : errorMessage(failCode)}
        </p>
      )}
```

并在 import 区把 `errorMessage` 一并取来（`import { apiErrorCode, errorMessage } from '~/lib/api-error'`——注意 `apiErrorCode` 用在 action、`errorMessage` 用在组件，同一文件两处都要）。

**`role="alert"` 不能省**：这是审核员唯一会看到的失败提示，而全站没有任何其他播报渠道（Task 6 才补）。

- [ ] **Step 4: 驳回按钮加客户端拦截**

把驳回按钮的

```tsx
          disabled={busy}
```

改成

```tsx
          disabled={busy || !reason}
```

（**只改驳回那个按钮**，「通过」不需要理由，它的 `disabled={busy}` 一字不动。）

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test)`
Expected: 全绿。`check-messages` 尤其要跑——`errorMessage(code)` 会按 code 查 Paraglide 文案，若某个 code 没有对应 key 会在运行时落到兜底文案，请顺带确认 `api-error.ts` 里的映射覆盖了 moderation 相关的 code。

- [ ] **Step 6: 浏览器实测**

用 Browser pane，以审核员身份进 `/dash`：
1. 不选理由点「驳回」→ 按钮应当是 disabled，点不动
2. 选了理由再点 → 正常处理
3. 若能造出一个 409（比如两个标签页同时处理同一条），确认提示文案**不是**「请填写驳回理由」

第 3 条造不出来就在报告里说明，由 Step 2/3 的代码审查覆盖。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/dash/queue.tsx
git commit -m "$(cat <<'EOF'
fix(web): 审核队列把 403 显示成「请填写驳回理由」

action 有两条返回 ok:false 的路径——缺理由（没打 API）与 API 真的失败——
而组件用 `fetcher.data?.ok === false` 把它们判成同一件事。审核员遇到 403
或「已被别人审过」，屏幕上写的是让他填理由。

按 reports.tsx 已有的写法拆开：action 返回 code，组件按 code 查文案。
驳回按钮补 `|| !reason`，本可客户端拦住的路径不必白跑一趟往返。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `PendingBar` 接上 fetcher

T1–T2 的全局 pending 墨线只订阅 `useNavigation()`，**接不到任何 fetcher**。于是 `/dash` 的每一次审核、通知页的「全部已读」、香霖堂的封面上传与下架，全程没有任何等待信号。

这条直接打掉了 T4 想买的第二样东西（「不确定时长的可中断接管」）——那些页面上看起来还缺，不是因为 CSS 不够，是现有方案**漏接了一整类触发源**。

**Files:**
- Modify: `apps/web/app/components/pending-bar.tsx`

**Interfaces:**
- Consumes: `useNavigation`、`useFetchers`（react-router）
- Produces: 无

- [ ] **Step 1: 改组件**

`apps/web/app/components/pending-bar.tsx`，把

```tsx
import { useNavigation } from 'react-router'
```

改成

```tsx
import { useFetchers, useNavigation } from 'react-router'
```

并把

```tsx
  const navigation = useNavigation()
  const pending = navigation.state !== 'idle'
```

改成

```tsx
  const navigation = useNavigation()
  const fetchers = useFetchers()
  /**
   * fetcher 也要算进来：/dash 的审核、通知页的「全部已读」、香霖堂的封面上传
   * 与下架全都走 fetcher 而不是导航，此前它们全程没有任何等待信号。
   *
   * RR8 的 fetcher persistence 会让在途 fetcher 在组件卸载后仍留在这个数组里
   * 直到结算，所以「卡片消失了但请求还在飞」的那段时间条也还亮着——这正确。
   */
  const pending =
    navigation.state !== 'idle' || fetchers.some((f) => f.state !== 'idle')
```

- [ ] **Step 2: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿

- [ ] **Step 3: 浏览器实测（两类触发源各验一次）**

用 Browser pane：

1. **导航类**（回归，确认没弄坏）：点一个导航链接，导航期间读 `document.querySelector('.pending-bar').getAttribute('data-pending')` 应为 `"true"`。
2. **fetcher 类**（本任务的新增）：在通知页点「全部已读」，或在 `/dash` 处理一条，提交期间读同一个属性——**改动前这里恒为 `"false"`**，改动后应为 `"true"`。

若网络太快抓不到，用 `javascript_tool` 在点击后立刻（<50ms）采样。两次输出都贴进报告。

- [ ] **Step 4: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/pending-bar.tsx
git commit -m "$(cat <<'EOF'
fix(web): pending 墨线接上 fetcher，此前漏掉一整类触发源

它只订阅 useNavigation()，于是 /dash 的审核、通知页的「全部已读」、香霖堂的
封面上传与下架全程没有任何等待信号——这些都走 fetcher 不走导航。

补一句 useFetchers().some(f => f.state !== 'idle')，0 KB。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 相对时间显示的是服务端时钟，且永不更新

`app/lib/time.ts:19` 的注释写着「SSR 与水合时钟不同，调用方要给 `<time>` 加 `suppressHydrationWarning`——这是相对时间的固有属性，不是 bug」。

**前半句对，后半句的推论错了。** `suppressHydrationWarning` 让 React 在水合时**跳过文本差异修补**，所以屏幕上那个「3 分钟前」是 SSR 那一刻服务端算出来的，客户端从未参与。慢网、bfcache、任何缓存下它一开始就是错的；而且页面开一小时后它还是「3 分钟前」。

**修法不是删掉 `suppressHydrationWarning`**（首帧确实需要它），而是**水合后主动接管**：`useEffect` 里 setState 触发一次正常渲染，此时 React 会正常修补文本。

**Files:**
- Create: `apps/web/app/components/relative-time.tsx`
- Modify: `apps/web/app/components/discussion/PostList.tsx`、`apps/web/app/routes/notifications.tsx`、`apps/web/app/routes/profile.tsx`（以及 `grep` 出来的其余调用点）

**Interfaces:**
- Consumes: `formatRelative` / `formatAbsolute`（`~/lib/time`）
- Produces: `<RelativeTime iso={...} className={...} />`

- [ ] **Step 1: 找出所有调用点**

Run:
```bash
cd /Users/i/Code/th/apps/web && grep -rn "formatRelative" app
```
把输出贴进报告——后面每一处都要对上号。

- [ ] **Step 2: 写组件**

创建 `apps/web/app/components/relative-time.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { formatAbsolute, formatRelative } from '~/lib/time'

/** 距离越近刷得越勤；超过一天就不用刷了（「3 天前」不会在你看着的时候变成「4 天前」） */
function periodFor(ageMs: number): number | null {
  if (ageMs < 60_000) return 10_000
  if (ageMs < 3_600_000) return 60_000
  if (ageMs < 86_400_000) return 600_000
  return null
}

/**
 * 相对时间。
 *
 * **首帧必须用服务端时钟**，否则水合不匹配；`suppressHydrationWarning` 是为此
 * 而在的，不能删。但它同时让 React 在水合时**跳过文本差异修补**——所以光有它，
 * 屏幕上那个「3 分钟前」永远停在 SSR 那一刻，慢网与 bfcache 下一开始就是错的。
 *
 * 修法是水合后主动接管：effect 里 setState 触发一次正常渲染，此时 React 会
 * 正常修补文本。之后按距离选间隔自更新。
 *
 * **刻意不做任何过渡**：一屏 50 个时间戳每 30 秒集体动一下，是 50 个余光干扰点。
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string
  className?: string
}) {
  // null = 尚未水合，用 formatRelative 的默认 now（SSR 那一刻）
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const period = periodFor(Date.now() - new Date(iso).getTime())
    if (period === null) return
    const timer = setInterval(() => setNow(Date.now()), period)
    return () => clearInterval(timer)
  }, [iso])

  return (
    <time
      dateTime={iso}
      title={formatAbsolute(iso)}
      suppressHydrationWarning
      className={className}
    >
      {now === null ? formatRelative(iso) : formatRelative(iso, now)}
    </time>
  )
}
```

- [ ] **Step 3: 逐个调用点换过来**

Step 1 grep 出来的每一处，把原本手写的 `<time dateTime={...} title={formatAbsolute(...)} suppressHydrationWarning className={...}>{formatRelative(...)}</time>` 换成 `<RelativeTime iso={...} className={...} />`，并删掉该文件里不再使用的 `formatRelative` / `formatAbsolute` import。

**逐处对照 Step 1 的清单，一处不漏、一处不多。**

- [ ] **Step 4: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿。若 `typecheck` 报某处 `formatRelative` 未使用，说明该文件的 import 没清干净。

- [ ] **Step 5: 浏览器实测（本任务的关键验收）**

用 Browser pane，进任一有时间戳的页面（通知页或主题页）：

```js
const t = document.querySelector('time[datetime]')
const before = t.textContent
// 把这条时间戳的 dateTime 改成 5 秒前，等自更新周期过去
JSON.stringify({ before, dateTime: t.getAttribute('datetime'), hasTitle: !!t.getAttribute('title') })
```

更直接的验法：读服务端 HTML 与水合后 DOM 的差异——

```bash
curl -s http://localhost:<port>/notifications | grep -o '<time[^>]*>[^<]*</time>' | head -3
```
把它与浏览器里 `document.querySelectorAll('time')` 的文本对比。**改动前两者必然相同**（因为客户端从不参与）；改动后，若服务端渲染时刻与你打开的时刻相差足够久，两者应当不同。

若时间差不够大看不出来，用 `javascript_tool` 直接验自更新：把某个 `<time>` 的文本记下来，`await new Promise(r=>setTimeout(r,11000))` 后再读——一分钟内的时间戳应当变化。**注意不要用 `requestAnimationFrame`，隐藏面板里它不触发。**

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/relative-time.tsx apps/web/app/components/discussion/PostList.tsx apps/web/app/routes/notifications.tsx apps/web/app/routes/profile.tsx
git commit -m "$(cat <<'EOF'
fix(web): 相对时间显示的是服务端时钟，且永不更新

time.ts 的注释说 suppressHydrationWarning「是相对时间的固有属性，不是 bug」——
前半句对，推论错了：它同时让 React 在水合时跳过文本差异修补，所以屏幕上那个
「3 分钟前」是 SSR 那一刻算的，客户端从未参与。慢网与 bfcache 下一开始就是错的，
页面开一小时后它还是「3 分钟前」。

抽成 RelativeTime 组件：首帧仍用服务端时钟（水合不匹配是真的要避），
水合后 effect 里 setState 主动接管，之后按距离选间隔自更新。
刻意不做任何过渡——一屏 50 个时间戳集体动一下是 50 个余光干扰点。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 全站零播报——补 `aria-live` 回执与 skip link

已 grep 核实：`apps/web/app` 下 `aria-live` **零命中**、`role="status"` 零命中、`toast|sonner` 零命中、跳至内容链接零命中。加上 RR8 不做路由播报——**读屏用户在这个站上，每一次导航、每一次 fetcher 成功，都是完全静默的。**

通知页尤其荒谬：API 已经算好 `{ marked }`（`apps/api/src/modules/notifications.ts`），而 `notifications.tsx` 的 action 把它丢掉只回 `{ ok }`，于是连一句「已标记 N 条」都印不出来。

**Files:**
- Create: `apps/web/app/components/live-region.tsx`
- Modify: `apps/web/app/root.tsx`（挂 skip link 与 live region）
- Modify: `apps/web/app/routes/notifications.tsx`（action 传出 `marked`，组件播报）
- Modify: `apps/web/messages/{zh,ja,en}.json`

**Interfaces:**
- Consumes: 无
- Produces: `<LiveRegion />`（root 挂一次），以及 `announce()` 的用法约定

- [ ] **Step 1: 三语加文案**

`apps/web/messages/zh.json`：

```json
  "skip_to_content": "跳至正文",
  "notif_marked_n": "已标记 {n} 条为已读",
```

`ja.json`：

```json
  "skip_to_content": "本文へスキップ",
  "notif_marked_n": "{n} 件を既読にしました",
```

`en.json`：

```json
  "skip_to_content": "Skip to content",
  "notif_marked_n": "Marked {n} as read",
```

Run: `cd /Users/i/Code/th && bun run check-messages`
Expected: 通过（此时两个 key 会被列进「没有代码引用」的软提示，正常）

- [ ] **Step 2: live region 组件**

创建 `apps/web/app/components/live-region.tsx`：

```tsx
/**
 * 全站唯一的播报区。
 *
 * 此前全站 aria-live / role="status" 零命中，加上 React Router 不做路由播报——
 * 读屏用户的每一次导航、每一次 fetcher 成功都是完全静默的。
 *
 * 刻意做成「由调用方把要播报的文本渲染进来」而不是命令式 API：
 * 播报内容几乎总是已经存在于某个 fetcher 的返回值里，多一层状态机只会漂移。
 *
 * `sr-only` 而非 `hidden`：后者会让内容从可访问性树里消失，播报不出来。
 */
export function LiveRegion({ children }: { children?: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-slot="live-region"
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 3: skip link 进 root**

`apps/web/app/root.tsx` 的 `App` 组件里，把

```tsx
    <div className="flex min-h-screen flex-col">
      <SiteHeader user={loaderData.user} />
```

改成

```tsx
    <div className="flex min-h-screen flex-col">
      {/* 跳至正文：键盘用户此前必须逐个 Tab 过整条导航才能到内容 */}
      <a
        href="#main"
        className="sr-only rounded-md bg-background px-3 py-2 text-sm ring-1 ring-ring focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {m.skip_to_content()}
      </a>
      <SiteHeader user={loaderData.user} />
```

并把下面的

```tsx
      <div className="flex-1">
        <Outlet />
      </div>
```

改成

```tsx
      <div id="main" className="flex-1 scroll-mt-20">
        <Outlet />
      </div>
```

- [ ] **Step 4: 通知页把 `marked` 传出来并播报**

`apps/web/app/routes/notifications.tsx`：

(a) action 的

```ts
  return { ok: res.ok }
```

改成

```ts
  // API 已经算好了 marked，此前被丢掉——于是连一句「已标记 N 条」都印不出来
  if (!res.ok) return { ok: false as const }
  const { marked } = (await res.json()) as { marked: number }
  return { ok: true as const, marked }
```

(b) 组件里，在现有 `const fetcher = useFetcher<typeof action>()` 之后加：

```tsx
  const marked =
    fetcher.state === 'idle' && fetcher.data?.ok ? fetcher.data.marked : null
```

(c) 在页面的 `<main>` 内、列表之前插入：

```tsx
      <LiveRegion>
        {marked !== null ? m.notif_marked_n({ n: String(marked) }) : null}
      </LiveRegion>
```

并在 import 区加 `import { LiveRegion } from '~/components/live-region'`。

**注意**：`marked` 的类型来自 API 响应，若 `typecheck` 报它不存在，说明 API 的返回类型没有它——**停下来报告**，不要用 `as any` 绕过。

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && (cd apps/web && bun test)`
Expected: 全绿，且 `check-messages` 不再把两个新 key 列为无引用

- [ ] **Step 6: 浏览器实测**

用 Browser pane：

1. **skip link**：进任一页，`javascript_tool` 跑 `document.querySelector('a[href="#main"]').focus()`，然后读它的 `getBoundingClientRect()`——聚焦后应当**可见**（`width > 0 && height > 0` 且在视口内），失焦后应回到 `sr-only`。
2. **live region**：进通知页点「全部已读」，读 `document.querySelector('[data-slot="live-region"]').textContent`——应当出现「已标记 N 条为已读」。
3. `#main` 锚点存在且有 `scroll-mt-20`。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/live-region.tsx apps/web/app/root.tsx apps/web/app/routes/notifications.tsx apps/web/messages/
git commit -m "$(cat <<'EOF'
feat(web): 补 skip link 与全站播报区，此前读屏用户全程静默

grep 核实：aria-live / role="status" / toast / skip link 全站零命中，
加上 React Router 不做路由播报——读屏用户的每一次导航、每一次 fetcher 成功
都听不到任何东西。

通知页尤其荒谬：API 已经算好 marked，action 却丢掉只回 ok，于是连一句
「已标记 N 条」都印不出来。现在把它传出来并播报。

先有一行文字，再谈动画。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `viewTransition` 补全

T1–T2 立了一条硬约束：「客户端导航后的到达由**原生 View Transition 独占**」。但实际只接了 5 处（`board-nav`、`site-header`、`mobile-nav`、`home`、`kourindou/list`）——通知跳转、个人页帖子链接、**共享的 `ui/pagination.tsx`**、香霖堂筛选翻页全都没有。

**那些路径上的到达不是「交给别人做了」，是什么都没有。** 这条约束在大部分路径上根本没开着。

**Files:**
- Modify: `apps/web/app/components/ui/pagination.tsx`
- Modify: `apps/web/app/routes/notifications.tsx`、`apps/web/app/routes/profile.tsx`
- Modify: `apps/web/app/routes/kourindou/list.tsx`（`Filter` 的 `setParams`）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 找出所有还没接的导航链接**

Run:
```bash
cd /Users/i/Code/th/apps/web && grep -rn "<Link\|<NavLink" app --include=*.tsx | grep -v viewTransition
```
把输出贴进报告，逐条判断该不该加（**判断标准：它是否导致整页内容替换**。同页锚点 `href="#pN"` 这类不算导航，不加）。

- [ ] **Step 2: `ui/pagination.tsx` —— 一处改动覆盖三个页面**

`PaginationLink` 内部那个 `<Link>` 已经有 `preventScrollReset`，在它旁边加 `viewTransition`。

这一处同时覆盖香霖堂列表分页、讨论区楼层分页、个人页分页——**这是本任务性价比最高的一改**。

- [ ] **Step 3: 通知与个人页的跳转链接**

- `notifications.tsx`：通知条目指向楼层的那个 `<Link>` 加 `viewTransition`
- `profile.tsx`：帖子列表指向主题/资源的那些 `<Link>` 加 `viewTransition`

**都不加 `prefetch="intent"`**——这两个页面都是长列表，悬停预取会打出大量请求（与香霖堂资源行同理）。

- [ ] **Step 4: 香霖堂筛选切换**

`kourindou/list.tsx` 的 `Filter` 用的是 `setParams(next, { preventScrollReset: true })`。`useSearchParams` 的 setter 支持 `viewTransition`：

```ts
        setParams(next, { preventScrollReset: true, viewTransition: true })
```

**若 typecheck 报 `viewTransition` 不在 `NavigateOptions` 上**，说明这个版本的 setter 不支持——那就**停下来报告**，不要硬塞。

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && (cd apps/web && bun test)`
Expected: 全绿

- [ ] **Step 6: 浏览器实测（每类路径各验一次）**

用 Browser pane，给 `document.startViewTransition` 打桩计数：

```js
window.__vt = 0
const orig = document.startViewTransition?.bind(document)
if (orig) document.startViewTransition = (cb) => { window.__vt++; return orig(cb) }
```

然后依次触发：① 香霖堂列表翻页 ② 通知条目跳转 ③ 香霖堂切筛选。每次之后读 `window.__vt`——**应当各自 +1**。三次的实际数字贴进报告。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/ui/pagination.tsx apps/web/app/routes/notifications.tsx apps/web/app/routes/profile.tsx apps/web/app/routes/kourindou/list.tsx
git commit -m "$(cat <<'EOF'
fix(web): viewTransition 补全——「到达由 VT 独占」此前大半路径没开着

T1–T2 立的硬约束是「客户端导航后的到达由原生 View Transition 独占」，
但实际只接了 5 处。通知跳转、个人页帖子链接、共享的 ui/pagination、
香霖堂筛选切换全都没有——那些路径上的到达不是交给别人做了，是什么都没有。

ui/pagination 一处改动同时覆盖香霖堂列表、讨论区楼层、个人页三处分页。
长列表一律不加 prefetch="intent"，悬停预取会打出大量请求。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `paper-lift` 补第三个分支，并改掉一处错注释

我在 T1–T2 的最终修复波里给 `paper-lift` 的注释写道：「`&:has(:focus-visible)` 处理『可聚焦的在卡片**内部**』——后续香霖堂许可卡属于这一类」。

**核实为错。** 香霖堂许可卡是 `upload.tsx:228` 的 `<button type="button">`——**它自身可聚焦、内部零个可聚焦后代**。`:has()` 向下看，选不中它；`a:focus-visible > &` 也选不中（它不在 `<a>` 里）。所以 spec 点名的那个「整个香霖堂唯一一处纸被括起一角」的落点上，键盘用户拿不到掀角。

顺带清掉另一处死代码：`.markdown-anchor`（`app.css` 里两处）全仓无使用点。

**Files:**
- Modify: `apps/web/app/app.css`

**Interfaces:**
- Consumes: 无
- Produces: `paper-lift` 现在覆盖三种可聚焦形态

- [ ] **Step 1: 核实许可卡确实是 `<button>`**

Run: `cd /Users/i/Code/th/apps/web && sed -n '225,236p' app/routes/kourindou/upload.tsx`
把输出贴进报告——这是本任务的事实依据。

- [ ] **Step 2: 补第三个分支并改注释**

`apps/web/app/app.css` 的 `@utility paper-lift` 里，把

```css
  /* 键盘同步：两种形态都要。
     `a:focus-visible > &` 处理「可聚焦的是卡片的**祖先**」——首页与六版块网格
     都是 <a><Card/></a> 的结构，卡片内零个可聚焦元素。
     `&:has(:focus-visible)` 处理「可聚焦的在卡片**内部**」——`:has()` 是向下看的，
     后续香霖堂许可卡属于这一类。
     只写其中一种都会漏掉一半调用点。 */
  &:hover,
  a:focus-visible > &,
  &:has(:focus-visible) {
```

改成

```css
  /* 键盘同步：可聚焦元素与卡片的关系有三种，三种都要写。
     `a:focus-visible > &` —— 可聚焦的是卡片的**祖先**（首页与六版块网格是
       <a><Card/></a>，卡片内零个可聚焦元素）。
     `&:focus-visible` —— 卡片**自身**可聚焦（香霖堂许可卡是 upload.tsx 的
       <button>，自身可聚焦、内部零可聚焦后代；前两种形态都选不中它）。
     `&:has(:focus-visible)` —— 可聚焦的在卡片**内部**（`:has()` 是向下看的）。
     漏掉任何一种都会让对应调用点的键盘用户拿不到掀角，而且没有门禁能抓。 */
  &:hover,
  a:focus-visible > &,
  &:focus-visible,
  &:has(:focus-visible) {
```

**同时**把文件末尾 reduced-motion 降级块里那条

```css
  .paper-lift:hover,
  a:focus-visible > .paper-lift,
  .paper-lift:has(:focus-visible) {
    transform: none;
  }
```

也加上 `.paper-lift:focus-visible,`。

- [ ] **Step 3: 删掉 `.markdown-anchor` 死规则**

Run: `cd /Users/i/Code/th/apps/web && grep -rn "markdown-anchor" app`

确认它只出现在 `app.css`（两处：`@layer components` 的 `:target` 规则与降级块），**没有任何元素在用**。把这两处的 `.markdown-anchor:target,` 那一行删掉，只保留 `li[id^="p"]:target`。

若 grep 发现有元素在用，**不要删**，在报告里说明。

- [ ] **Step 4: 构建 + 门禁 + 层定位断言**

Run:
```bash
cd /Users/i/Code/th && bun run check && bun run typecheck && \
  (cd apps/web && bun run build >/dev/null 2>&1) && \
  bun run check-css-layers && bun run check-bundle-size
```
Expected: 全绿（`check-bundle-size` 是 Task 2 建的）

Run:
```bash
cd /Users/i/Code/th/apps/web && C=$(ls -t build/client/assets/*.css | head -1)
echo "focus-visible 自身分支是否生成: $(grep -o '\.paper-lift:focus-visible' $C | wc -l)"
echo "markdown-anchor 是否已清: $(grep -o 'markdown-anchor' $C | wc -l)"
```
Expected: 前者 ≥ 2（掀起 + 折角 + 降级，Lightning CSS 可能拆开），后者 **0**

- [ ] **Step 5: 浏览器实测许可卡的键盘态**

用 Browser pane 进 `/kourindou/upload`（需登录），找到许可状态那组 `<button>`：

```js
const btn = document.querySelector('[aria-pressed]')
JSON.stringify({
  tag: btn?.tagName,
  hasPaperLift: btn?.className.includes('paper-lift'),
  focusableInside: btn?.querySelectorAll('a,button,input,[tabindex]').length,
})
```

**注意**：许可卡目前**可能还没挂 `paper-lift`**（spec 把它列在「本期明确不做」里）。若 `hasPaperLift` 为 false，那说明这个分支现在还没有实际落点——**这不是缺陷**，本任务是为它铺路并改掉错注释。在报告里如实写明。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css
git commit -m "$(cat <<'EOF'
fix(web): paper-lift 补第三个键盘分支，并改掉一处我写错的注释

T1–T2 的修复波里我把注释写成「:has() 处理卡内可聚焦的场景，如香霖堂许可卡」。
核实为错：许可卡是 upload.tsx 的 <button>，自身可聚焦、内部零可聚焦后代——
:has() 向下看选不中它，a:focus-visible > & 也选不中（它不在 <a> 里）。

可聚焦元素与卡片的关系有三种（祖先/自身/内部），三种都要写。
顺带清掉 .markdown-anchor 死规则（全仓无使用点）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9（可选，站长可砍）: CI

**这一项是站长可以直接砍掉的，砍了不影响前八项。**

仓库目前没有 `.github/`。这意味着 Task 2 建的体积门禁、以及 `check-css-layers` / `check-messages` / `typecheck` / `e2e` 全都**只能靠人记得手跑**——一个只有约定、没有执行者的护栏。而 T4 装 motion 的前置条件里，「体积门禁在跑」是最要紧的一条。

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 写 workflow**

创建 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run typecheck
      - run: bun run check-messages
      - run: bun run test
      - run: cd apps/web && bun run build
      - run: bun run check-css-layers
      - run: bun run check-bundle-size
```

**刻意不跑 `e2e`**：它打的是真实的 postgres / redis / Meilisearch / MinIO（见 CLAUDE.md 的 dev 依赖那一节），在 CI 里要起一整套服务，是另一个决策。本 workflow 只覆盖不需要外部服务的门禁。

- [ ] **Step 2: 本地把这串跑一遍**

Run:
```bash
cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages && \
  bun run test && (cd apps/web && bun run build) && \
  bun run check-css-layers && bun run check-bundle-size
```
Expected: 全绿。这正是 CI 会跑的那串。

- [ ] **Step 3: 提交**

```bash
cd /Users/i/Code/th
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: 把已有的六道门禁接上执行者

仓库此前没有 CI，于是 check / typecheck / check-messages / test /
check-css-layers / check-bundle-size 全都只能靠人记得手跑——
一个只有约定、没有执行者的护栏。

刻意不跑 e2e：它打真实的 postgres/redis/Meilisearch/MinIO，
在 CI 里要起一整套服务，那是另一个决策。

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
  bun run check-css-layers && bun run check-bundle-size && \
  (cd apps/api && bun run e2e)
```
Expected: 全绿，e2e 40 通过 / 0 失败。**注意 `e2e` 必须在 `apps/api` 下跑**——根上跑会打印 "Script not found" 却仍然退出 0。

- [ ] **确认零新增依赖**

Run: `cd /Users/i/Code/th && git diff main --stat -- package.json apps/web/package.json bun.lock`
Expected: `package.json` 只多 `check-bundle-size` 一条 script；`bun.lock` **无改动**。

- [ ] **更新 CLAUDE.md**

在「动效与样式约定」那一节追加：

```markdown
  - **根集是有预算的**：`bun run check-bundle-size`（读构建产物、逐文件 gzip -9）断言首屏集 ≤ 155 KB、单路由 ≤ 270 KB。加任何前端库之前先跑它。曾经有 10.7 KB 的 better-auth 客户端因为 `site-header.tsx` 顶层 import 而钉在每个匿名访客的首屏里
  - **相对时间用 `<RelativeTime>`，不要手写 `formatRelative` + `suppressHydrationWarning`**：后者会让 React 跳过文本差异修补，屏幕上的「3 分钟前」会永远停在 SSR 那一刻
  - `paper-lift` 的键盘分支有**三种**（可聚焦元素是卡片的祖先/自身/内部），漏一种就有一类调用点的键盘用户拿不到掀角，且没有门禁能抓
  - 播报走 `<LiveRegion>`（root 挂一次，`aria-live="polite"`）；**新增任何「操作成功了」的反馈，先问有没有一行文字，再问要不要动画**
```

- [ ] **提交收尾**

```bash
cd /Users/i/Code/th
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md 记下 T3 立起来的四条约定

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 下一步：T4（装 motion，只进 /dash）

本计划落地后，T4 的前置条件才成立。届时的关键数字与纠正（**全部已实测，写进 T4 计划时不必重测**）：

- **推荐架构只要 +0.79 KB gz**：`MotionConfig reducedMotion="user"` 挂 root（实测 +0.27 KB），`LazyMotion` **下沉到需要动效的叶子**（provider chunk 15.54 KB gz 被用到它的路由共享，features chunk 14.02 KB gz 水合后异步拉）。挂 root 则是 +10.00 KB。
- **`popLayout` 在 `domAnimation` 下可用**（`PopChild` 走 `offsetTop`/`getComputedStyle` + 注入 `position:absolute`，不碰 projection）。失去的只是兄弟**滑动**补位。观感优于 `sync`。
- **`<AnimatePresence initial={false}>` 的子元素可以写 `initial={{opacity:0, y:'var(--settle-y)'}}`**，SSR 产物仍是 `style="opacity:1;transform:none"`。这才是 `--settle-y` 一直在等的用法，且 motion 能解析 CSS 变量。
- **`exit` 里禁止出现位移键**：reduced-motion 下 motion 对 positional keys 是**瞬移到终点**（`{type:false}`）而非跳过，`exit={{opacity:0,y:-12}}` 会让减弱动效用户看到一次 12px 瞬跳。`animate` 用 y 是安全的（终态是 0）。
- **`features.ts` 必须独占一个模块**，且引用侧 `.then((mod) => mod.default)` 不能省（LazyMotion 直接解构 resolve 值，不剥 `.default`）。少写这句会让 `m` 组件全站变成惰性 div、静默失效——只有 `tsc` 抓得住，`react-router build` 不做类型检查。
- **⚠️ 以上关于 `LazyMotion` / `strict` / `features.ts` / Biome `noRestrictedImports` 的建议已被 T4 的架构裁决推翻**，详见 `docs/superpowers/plans/2026-09-07-motion-t4-dash.md` 的 A1–A3：`{user && <LazyMotion>}` 是运行时条件、影响不了构建期分包，实测 `LazyMotion` 反而比全量 `motion` 贵 0.03 KB，而 rolldown 本来就把 motion 放进只被引用它的路由加载的共享 chunk。**T4 用全量 `motion`、不用 `LazyMotion`、不建 `features.ts`。** 真正的墙是「root 树五个文件禁止 import `motion/react`」的 path 断言（实测 motion 进 root 可达图 = 首屏 +37.31 KB）。
- **⚠️ 「禁止用 `m` 作 motion 标识符」这条约定也已撤销**：实测 `check-messages` 的正则 `/\bm\.(\w+)\(/g` 不会命中 `motion.div`（`m` 后面接的是 `o` 不是 `.`），且 `motion/react-m` 在 motion 13 里不导出 `m`。全站直接写 `<motion.div>`。
- **`whileTap` 与 `onTap` 都会往 SSR HTML 塞 `tabindex="0"`**；`whileFocus` 不会。
- **`@starting-style` 能做 settle**（0 KB，实测同形）。所以 **motion 只该买 `exit`**——React 在退场动画开始前就卸载了节点，CSS 没有挂载点，这是 `AnimatePresence` 唯一无可替代的地方。
