# 和风纸境 T0：既存缺陷修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉动效层踩在其上的八条既存缺陷，其中三条是功能性 bug（移动端无导航、超 50 楼回复丢失、香霖堂第 21 条资源不可达）。

**Architecture:** 全部是 `apps/web` 内的局部修改，**零新增运行时依赖**。先给 `apps/web` 接上 `bun test`（仓库已有 bun，只是 web 包没挂 test 脚本），把能抽成纯函数的逻辑抽出来做 TDD；纯视觉/结构的改动用「构建产物断言 + Browser pane 实测」验证。

**Tech Stack:** Bun · React Router 8 (SSR) · React 19 · Tailwind v4 · radix-ui · Paraglide JS

**Spec:** `docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md` 第三节（既存缺陷表）

## Global Constraints

- **不引入任何新的运行时依赖。** 移动端抽屉用仓库已有的 `radix-ui` Dialog，不装 `vaul` 之类。
- **文案一律走 Paraglide**，代码里不写裸字符串。新增 key 必须 `zh` / `ja` / `en` 三语齐全，否则 `bun run check-messages` 退出码 1。
- **不得使用 `m` 作为 Paraglide 之外的标识符**（`scripts/check-messages.ts:74` 的正则 `/\bm\.([a-zA-Z0-9_]+)\(/g` 会把 `m.xxx(` 当消息 key 引用）。
- **不得引入 SSR 隐藏态**：任何 `opacity: 0` / `visibility: hidden` 的初始样式都不能出现在服务端输出的内容元素上。
- **卡片不能用 `border-*` 表达状态**：`card.tsx:15` 只有 `ring-1 ring-foreground/10`，`tailwindcss@4.3.3/preflight.css:15` 是 `border: 0 solid`，改 border 颜色是空操作。用 `ring-*`。
- 每个任务结束跑 `bun run check`（Biome）与 `bun run typecheck`；碰了 `messages/` 或新增文案的额外跑 `bun run check-messages`。
- 提交信息用 `fix(web): …` 或 `feat(web): …`，末尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

### Task 0: 给 apps/web 接上 bun test

没有测试运行器就无法对后面几个任务做 TDD。仓库根已有 bun，`apps/api` 与 `packages/*` 都在跑 `bun test`，只有 `apps/web` 的 package.json 没挂 `test` 脚本，于是 `turbo.json:25` 的 `test` 任务在 web 上空转。

**Files:**
- Modify: `apps/web/package.json`（scripts 块）
- Create: `apps/web/app/lib/paging.test.ts`
- Create: `apps/web/app/lib/paging.ts`

**Interfaces:**
- Consumes: 无
- Produces: `pageWindow(current: number, total: number): number[]` — 当前页前后各两页、首尾常在的页码窗口。Task 4 与 Task 5 都会用。

- [ ] **Step 1: 写失败的测试**

创建 `apps/web/app/lib/paging.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { pageWindow } from './paging'

describe('pageWindow', () => {
  test('总页数少时全列出', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
  })

  test('当前页在中间：首尾常在，中间是前后各两页', () => {
    expect(pageWindow(10, 20)).toEqual([1, 8, 9, 10, 11, 12, 20])
  })

  test('当前页贴首：不越界到 0 或负数', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 20])
  })

  test('当前页贴尾：不越界超过 total', () => {
    expect(pageWindow(20, 20)).toEqual([1, 18, 19, 20])
  })

  test('单页：只有 1，不重复', () => {
    expect(pageWindow(1, 1)).toEqual([1])
  })

  test('结果永远升序且无重复', () => {
    const w = pageWindow(5, 30)
    expect(w).toEqual([...new Set(w)].sort((a, b) => a - b))
  })
})
```

- [ ] **Step 2: 挂上 test 脚本并跑，确认失败**

在 `apps/web/package.json` 的 `scripts` 里加一行（放在 `"start"` 之后）：

```json
    "test": "bun test",
```

Run: `cd apps/web && bun test`
Expected: FAIL，报 `Cannot find module './paging'`

- [ ] **Step 3: 实现 pageWindow**

创建 `apps/web/app/lib/paging.ts`：

```ts
/**
 * 分页控件要显示的页码：当前页前后各两页，首尾常在。
 *
 * 从 Discussion.tsx 抽出来共用——香霖堂列表与讨论区楼层分页是同一个窗口算法，
 * 各写一遍必然漂移。
 */
export function pageWindow(current: number, total: number): number[] {
  const set = new Set<number>([1, total])
  for (let p = current - 2; p <= current + 2; p++)
    if (p >= 1 && p <= total) set.add(p)
  return [...set].sort((a, b) => a - b)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && bun test`
Expected: PASS，6 项全绿

- [ ] **Step 5: 让 Discussion.tsx 改用共用实现**

`apps/web/app/components/discussion/Discussion.tsx`：删掉文件末尾那个本地的 `pageWindow` 函数（连同它上面的 `/** 当前页前后各两页，首尾常在 */` 注释），并在顶部 import 区加：

```ts
import { pageWindow } from '~/lib/paging'
```

- [ ] **Step 6: 全量门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && cd apps/web && bun test`
Expected: 三者全绿

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/package.json apps/web/app/lib/paging.ts apps/web/app/lib/paging.test.ts apps/web/app/components/discussion/Discussion.tsx
git commit -m "$(cat <<'EOF'
test(web): 接上 bun test 并抽出共用的 pageWindow

apps/web 此前没有 test 脚本，turbo 的 test 任务在 web 上空转。
顺手把 Discussion.tsx 里的本地 pageWindow 抽到 lib/paging.ts——
香霖堂列表分页（下一个任务）要用同一个窗口算法。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: prefers-reduced-motion 全站兜底

**缺陷 7。** `app.css` 206 行里 `prefers-reduced-motion` 出现 0 次。现有 Radix 弹层的 fade/zoom（8 处 `data-open:animate-in`）、`skeleton` 的 `animate-pulse`、18 处 `transition-*` 对开了减弱动效的用户全部照播。

**这条独立于要不要上 motion，现在就该做。**

**Files:**
- Modify: `apps/web/app/app.css`（`@layer base` 块内，`body::before` 规则之后）

**Interfaces:**
- Consumes: 无
- Produces: 一条全局媒体查询。后续 T3 的 `MotionConfig reducedMotion="user"` 与它构成完整的两层降级，二者语义必须一致（都只掐 transform，保留 opacity 与颜色）。

- [ ] **Step 1: 写下要加的 CSS**

在 `apps/web/app/app.css` 的 `@layer base { … }` 内、`body::before { … }` 规则之后、`[data-slot="card"]` 规则之前插入：

```css
  /* 减弱动效：只掐掉位移与缩放，保留淡入淡出与颜色过渡。
     三条都是刻意的，改之前先读 specs/2026-09-05-motion-atmosphere-design.md 第 9.1 节：
     1) 选择器必须是 `*`——本仓库弹层的类名 token 是 `data-open:animate-in`，
        `:where(.animate-in)` 一个元素都选不中。
     2) 不能用 `animation: none !important`——Radix 靠 animationend 卸载弹层，
        掐掉动画会让弹层卡住不消失。归零 tw-animate-css 的 @property 变量才是对的。
     3) 不能用 `transition-duration: .01ms !important`——它连颜色过渡一起杀，
        而 T3 的 MotionConfig reducedMotion="user" 只关 transform、保留 opacity，
        两套降级语义打架。 */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      --tw-enter-translate-x: 0;
      --tw-enter-translate-y: 0;
      --tw-exit-translate-x: 0;
      --tw-exit-translate-y: 0;
      --tw-enter-scale: 1;
      --tw-exit-scale: 1;
      --tw-enter-rotate: 0;
      --tw-exit-rotate: 0;
      --tw-enter-blur: 0;
      --tw-exit-blur: 0;
      scroll-behavior: auto !important;
    }
    /* 骨架屏保留一个低幅度脉冲：完全静止的话用户分不清是在加载还是坏了 */
    .animate-pulse {
      animation-duration: 3s;
    }
  }
```

- [ ] **Step 2: 构建并断言媒体查询进了产物**

Run:
```bash
bun run build && \
  grep -c "prefers-reduced-motion" build/client/assets/*.css
```
Expected: ≥ 1（改动前构建产物里唯一一处来自未使用的 tw-animate-css `.shimmer`，所以断言的是**增加**；改动后应 ≥ 2）

- [ ] **Step 3: 断言归零的是变量而不是 animation**

Run:
```bash
cd /Users/i/Code/th/apps/web && \
  grep -o "prefers-reduced-motion[^}]*}" build/client/assets/*.css | grep -c "tw-enter-translate-y"
```
Expected: ≥ 1

Run:
```bash
cd /Users/i/Code/th/apps/web && \
  grep -o "prefers-reduced-motion[^}]*}" build/client/assets/*.css | grep -c "animation:none"
```
Expected: 0（**必须是 0**——出现 `animation:none` 说明有人改用了核弹写法，会卡住 Radix 弹层）

- [ ] **Step 4: 浏览器实测弹层仍能正常关闭**

用 Browser pane：
1. `preview_start` 起 dev server（`.claude/launch.json` 里若无 web 配置就先建：`runtimeExecutable: "bun"`、`runtimeArgs: ["run","dev"]`、`port: 3000`）
2. `navigate` 到 `http://localhost:3000/ui`
3. 找到 Dialog 的触发按钮，`computer` 点开，再点关闭
4. `read_page` 确认弹层已从可访问性树消失

Expected: 弹层能正常打开与关闭（这一步验证的是「没用核弹写法」在真实 Radix 上成立）

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css
git commit -m "$(cat <<'EOF'
fix(web): 补 prefers-reduced-motion 全站兜底

此前 app.css 里 prefers-reduced-motion 出现 0 次：Radix 弹层的 fade/zoom、
skeleton 的 animate-pulse、18 处 transition-* 对减弱动效用户全部照播。

归零 tw-animate-css 的 --tw-enter-*/--tw-exit-* 变量，而不是 animation:none
——Radix 靠 animationend 卸载弹层，掐掉动画会让弹层卡住不消失。
也不用 transition-duration:.01ms!important，那会连颜色过渡一起杀，与后续
MotionConfig reducedMotion="user"（只关 transform）的语义不一致。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 卡片 hover 与「当前版块」高亮的死类

**缺陷 5。** `card.tsx:15` 的 className 里只有 `ring-1 ring-foreground/10`，没有任何 border 宽度工具类；`tailwindcss@4.3.3/preflight.css:15` 是 `border: 0 solid`。所以给 0 宽度的边框改颜色什么都不会发生：

- `home.tsx:33` 首页五张模块卡的 `hover:border-primary/50` — 空操作
- `board-nav.tsx:26` 六版块卡的 `hover:border-primary/50` **和** `b === current ? 'border-primary'` — **都是**空操作，当前版块今天只有 `aria-current`

**Files:**
- Modify: `apps/web/app/routes/home.tsx:33`
- Modify: `apps/web/app/components/board-nav.tsx:26`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯样式修正）。T2 的掀角效果会长在这两处之上。

- [ ] **Step 1: 修首页**

`apps/web/app/routes/home.tsx`，把

```tsx
            <Card className="h-full transition-colors hover:border-primary/50">
```

改成

```tsx
            <Card className="h-full transition-colors hover:ring-primary/50">
```

- [ ] **Step 2: 修六版块网格**

`apps/web/app/components/board-nav.tsx`，把

```tsx
          <Card
            className={`h-full transition-colors hover:border-primary/50 ${b === current ? 'border-primary' : ''}`}
          >
```

改成

```tsx
          <Card
            className={`h-full transition-colors hover:ring-primary/50 ${b === current ? 'ring-2 ring-primary' : ''}`}
          >
```

注意当前版块用 `ring-2` 而不是只换颜色：`ring-1` 的朱红在和纸底色上对比度不够，而「当前在哪个版块」是这个网格唯一的状态信息。

- [ ] **Step 3: 浏览器实测 hover 真的有反馈**

用 Browser pane：
1. `navigate` 到 `http://localhost:3000/`
2. `find` 定位第一张模块卡，`computer` 用 `hover` 动作悬停到它上面
3. `javascript_tool` 跑：

```js
const card = document.querySelector('[data-slot="card"]')
getComputedStyle(card).getPropertyValue('--tw-ring-color') || getComputedStyle(card).outlineColor
```

Expected: hover 时的 ring 颜色与非 hover 时不同（非 hover 是 `foreground/10` 的墨色，hover 是 `primary/50` 的朱红）

4. `navigate` 到 `http://localhost:3000/shrine/b/danmaku`，`computer` 截图，确认当前版块那张卡有可见的朱红描边

- [ ] **Step 4: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/home.tsx apps/web/app/components/board-nav.tsx
git commit -m "$(cat <<'EOF'
fix(web): 卡片 hover 与当前版块高亮此前是空操作

card.tsx 用 ring-1 ring-foreground/10，没有任何 border 宽度工具类，
而 preflight 是 border: 0 solid——给 0 宽度的边框改颜色什么都不会发生。

于是首页五张模块卡没有 hover 反馈，六版块网格既没有 hover 反馈也没有
「当前版块」的视觉指示（只剩 aria-current）。一律改用 ring-*。
当前版块用 ring-2：ring-1 的朱红在和纸底色上对比度不够。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 主题图标首帧闪错

**缺陷 8。** `theme-toggle.tsx` 是 `useState(false)` + `useEffect` 读 `document.documentElement.classList`。SSR 恒渲染 `<Moon />`，水合后才可能翻成 `<Sun />`。深色用户每次刷新都看到月亮闪成太阳。

修法是**去掉状态**：`root.tsx` 的 `themeInit` 内联脚本在首帧前就把 `dark` 类打在 `<html>` 上了，所以用 CSS 的 `dark:` 变体就能在首帧渲染对，根本不需要 React 知道当前主题。

**Files:**
- Modify: `apps/web/app/components/theme-toggle.tsx`

**Interfaces:**
- Consumes: `root.tsx` 的 `themeInit` 脚本已在首帧前设好 `html.dark`（不要动它）
- Produces: 无

- [ ] **Step 1: 整体替换 theme-toggle.tsx**

```tsx
import { Moon, Sun } from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages'

/**
 * 主题开关。**刻意不持有当前主题的 state**——
 * root.tsx 的 themeInit 内联脚本在首帧前就把 `dark` 类打在 <html> 上了，
 * 所以两个图标都渲染、用 CSS 的 dark: 变体决定谁可见，服务端与客户端
 * 输出逐字节相同。此前用 useState(false)+useEffect，SSR 恒出月亮，
 * 深色用户每次刷新都看到月亮闪成太阳。
 */
export function ThemeToggle() {
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {}
  }, [])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={m.theme_toggle()}
    >
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  )
}
```

- [ ] **Step 2: 断言组件不再持有状态**

Run:
```bash
cd /Users/i/Code/th/apps/web && grep -c "useState\|useEffect" app/components/theme-toggle.tsx
```
Expected: `0`（有任何一个都说明没改干净，水合闪烁会回来）

- [ ] **Step 3: 断言服务端输出里两个图标都在**

Run:
```bash
cd /Users/i/Code/th/apps/web && bun run build && bun run start &
sleep 3
curl -s http://localhost:3000/ | grep -o 'class="[^"]*dark:hidden[^"]*"' | head -1
```
Expected: 输出含 `dark:hidden` 的 class（说明 Moon 在 SSR HTML 里）。跑完记得 `kill %1`。

- [ ] **Step 4: 浏览器实测深色下刷新不闪**

用 Browser pane：
1. `navigate` 到 `http://localhost:3000/`
2. `javascript_tool` 跑 `localStorage.setItem('theme','dark'); location.reload()`
3. 立刻 `computer` 截图
4. 确认右上角是太阳图标，**没有**先出现月亮

Expected: 首帧即为太阳

- [ ] **Step 5: 门禁并提交**

```bash
cd /Users/i/Code/th && bun run check && bun run typecheck
git add apps/web/app/components/theme-toggle.tsx
git commit -m "$(cat <<'EOF'
fix(web): 主题图标首帧闪错

此前 useState(false)+useEffect 读 DOM class：SSR 恒渲染月亮，水合后才翻成
太阳，深色用户每次刷新都看到一次闪烁。

去掉状态即可——root.tsx 的 themeInit 内联脚本在首帧前就设好了 html.dark，
两个图标都渲染、用 dark: 变体决定谁可见，服务端与客户端输出逐字节相同。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 香霖堂列表补分页控件

**缺陷 4。** loader 收 `page`、`Filter` 切换时会 `next.delete('page')`、api 返回 `page/pageSize/total`（`pageSize` 默认 20、上限 100），但 `list.tsx:143-194` 只渲染 `items`——**第 21 条资源在 UI 上不可达**。仓库已有 `components/ui/pagination.tsx` 且 `Discussion.tsx` 正在用。

**Files:**
- Modify: `apps/web/app/routes/kourindou/list.tsx`

**Interfaces:**
- Consumes: `pageWindow(current, total)` from `~/lib/paging`（Task 0 建立）
- Produces: 无

- [ ] **Step 1: 确认 loader 已经把分页字段传下来**

Run:
```bash
cd /Users/i/Code/th/apps/web && sed -n '28,42p' app/routes/kourindou/list.tsx
```
Expected: 看到 `return { ...body, failed: false as const }`——`page` / `pageSize` / `total` 已在 `loaderData` 里，无需改 loader。

- [ ] **Step 2: 加 import**

在 `apps/web/app/routes/kourindou/list.tsx` 顶部 import 区加：

```ts
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination'
import { pageWindow } from '~/lib/paging'
```

并把 `import { Link, useSearchParams } from 'react-router'` 保持不变（`useSearchParams` 仍被 `Filter` 用）。

- [ ] **Step 3: 组件里取出分页字段**

把

```tsx
export default function KourindouList({ loaderData }: Route.ComponentProps) {
  const { items, total, failed } = loaderData
```

改成

```tsx
export default function KourindouList({ loaderData }: Route.ComponentProps) {
  const { items, total, failed } = loaderData
  // failed 分支下 loader 只返回 items/total/failed，这两个字段不存在
  const pageSize = 'pageSize' in loaderData ? loaderData.pageSize : 20
  const current = 'page' in loaderData ? loaderData.page : 1
  const pages = Math.max(1, Math.ceil(total / pageSize))
```

- [ ] **Step 4: 在列表 `</ul>` 之后、`</main>` 之前插入分页控件**

紧跟在渲染 `items` 的那个 `</ul>` 后面（即 `)}` 收尾之后）插入：

```tsx
      {!failed && pages > 1 && (
        <Pagination className="mt-8">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                to={pageHref(current - 1)}
                disabled={current === 1}
              />
            </PaginationItem>
            {pageWindow(current, pages).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink to={pageHref(p)} isActive={p === current}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                to={pageHref(current + 1)}
                disabled={current === pages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
```

- [ ] **Step 5: 加 pageHref——翻页必须保住现有筛选**

在 `const pages = …` 那一行之后加：

```tsx
  const [params] = useSearchParams()
  /** 翻页要保住 kind/license/sort：丢了筛选的翻页比没有翻页更让人困惑 */
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params)
    if (p <= 1) next.delete('page')
    else next.set('page', String(p))
    const qs = next.toString()
    return qs ? `?${qs}` : '.'
  }
```

- [ ] **Step 6: 跑门禁与类型检查**

Run: `cd /Users/i/Code/th && bun run typecheck && bun run check`
Expected: 全绿。若 `pageSize`/`page` 的 `in` 收窄报错，说明 loader 的两个分支返回类型不同——这是预期的，`in` 收窄正是为此。

- [ ] **Step 7: 浏览器实测第 21 条可达**

前提：开发库里香霖堂已发布资源 > 20 条（`bun run seed:demo` 可造）。

用 Browser pane：
1. `navigate` 到 `http://localhost:3000/kourindou`
2. `read_page` 确认底部出现 `nav[aria-label="pagination"]`
3. `find` 找到「2」并 `computer` 点击
4. `read_page` 确认 URL 带 `?page=2` 且列表内容与第 1 页不同
5. 再选一个筛选（比如 kind），确认 URL 里 `page` 被清掉、`kind` 保留
6. 翻到第 2 页后再看 URL，确认 `kind` 与 `page` **同时**在

Expected: 6 步全部符合

- [ ] **Step 8: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/routes/kourindou/list.tsx
git commit -m "$(cat <<'EOF'
fix(web): 香霖堂列表补分页控件

loader 一直收 page、api 一直返回 page/pageSize/total，但列表只渲染 items,
没有任何翻页控件——pageSize 默认 20，第 21 条资源在 UI 上不可达。

复用已有的 ui/pagination 与 lib/paging 的 pageWindow（与讨论区楼层分页同一
个窗口算法）。翻页保住 kind/license/sort，切筛选时清掉 page。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 超 50 楼的主题，回复后不出现在任何地方

**缺陷 2，功能性 bug。** `discussion-action.ts` 已经导出了带 `floor` 的结果类型：

```ts
export type DiscussionResult =
  | { ok: true; intent: string; floor?: number }
  | { ok: false; intent: string; code: string; draft?: string }
```

但 `PostForm.tsx:28` 声明了一个**本地的** `type Result = { ok: boolean; code?: string; draft?: string }`，`useFetcher<Result>()` 把 `floor` 从类型里抹掉了（运行时数据里其实有）。加上 `post.ts:130` 把无 `?floor=` 的请求吸附到 `from=1`、`POSTS_PAGE_SIZE=50`，结果是：**主题超过 50 层后，用户发的回复不会出现在他当前看到的这一页，观感等同于发失败。**

**Files:**
- Create: `apps/web/app/lib/discussion-nav.ts`
- Create: `apps/web/app/lib/discussion-nav.test.ts`
- Modify: `apps/web/app/components/discussion/PostForm.tsx`
- Modify: `apps/web/app/components/discussion/Discussion.tsx`

**Interfaces:**
- Consumes: `DiscussionResult` from `~/lib/discussion-action`
- Produces:
  - `replyTarget(floor: number, from: number, pageSize: number): { kind: 'inpage' } | { kind: 'navigate'; from: number }`
  - `PostForm` 新增可选 prop `onPosted?: (floor: number) => void`

- [ ] **Step 1: 写失败的测试**

创建 `apps/web/app/lib/discussion-nav.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { replyTarget } from './discussion-nav'

describe('replyTarget', () => {
  test('新楼落在当前窗口内：原地定位', () => {
    expect(replyTarget(37, 1, 50)).toEqual({ kind: 'inpage' })
  })

  test('新楼正好是窗口最后一层：仍算窗口内', () => {
    expect(replyTarget(50, 1, 50)).toEqual({ kind: 'inpage' })
  })

  test('新楼超出窗口一层：要导航，且落到含它的那一页页首', () => {
    expect(replyTarget(51, 1, 50)).toEqual({ kind: 'navigate', from: 51 })
  })

  test('用户停在第二页、新楼在第三页', () => {
    expect(replyTarget(120, 51, 50)).toEqual({ kind: 'navigate', from: 101 })
  })

  test('用户停在第三页、新楼就在这一页', () => {
    expect(replyTarget(120, 101, 50)).toEqual({ kind: 'inpage' })
  })

  test('软删造成楼层序列有空洞时，按页边界吸附而不是按计数', () => {
    // floorSeq 是序列不是计数：第 3 页的页首恒为 101，与实际存活楼数无关
    expect(replyTarget(103, 1, 50)).toEqual({ kind: 'navigate', from: 101 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/i/Code/th/apps/web && bun test discussion-nav`
Expected: FAIL，`Cannot find module './discussion-nav'`

- [ ] **Step 3: 实现**

创建 `apps/web/app/lib/discussion-nav.ts`：

```ts
/**
 * 刚发的楼在不在用户当前看到的这一页？
 *
 * 分页按**楼层区间**不按 page（见 Discussion.tsx 的注释）：`from` 是当前页第一层的
 * 楼层号。`floor` 是序列不是计数——软删的楼保留占位，所以页边界只能从 from/pageSize
 * 算，不能从存活楼数算。
 *
 * 不在窗口内时返回目标页的页首楼层号，调用方据此拼 `?floor=<from>#p<floor>`。
 */
export function replyTarget(
  floor: number,
  from: number,
  pageSize: number,
): { kind: 'inpage' } | { kind: 'navigate'; from: number } {
  if (floor >= from && floor < from + pageSize) return { kind: 'inpage' }
  const page = Math.floor((floor - 1) / pageSize)
  return { kind: 'navigate', from: page * pageSize + 1 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/i/Code/th/apps/web && bun test discussion-nav`
Expected: PASS，6 项全绿

- [ ] **Step 5: PostForm 换掉丢字段的本地类型，并把 floor 交出去**

`apps/web/app/components/discussion/PostForm.tsx`：

(a) 顶部 import 区加：

```ts
import type { DiscussionResult } from '~/lib/discussion-action'
```

(b) 删掉这一行：

```ts
type Result = { ok: boolean; code?: string; draft?: string }
```

(c) 把 `Props` 里 `onDone?: () => void` 那一行的**上面**插入：

```ts
  /** 发帖成功后回调，带上服务端分配的楼层号。编辑不给（没有新楼层） */
  onPosted?: (floor: number) => void
```

(d) 把解构参数列表里的 `onDone,` 上面加 `onPosted,`

(e) 把

```ts
  const fetcher = useFetcher<Result>()
```

改成

```ts
  const fetcher = useFetcher<DiscussionResult>()
```

(f) 在成功 effect 里，`onClearParent?.()` 那一行**之前**插入：

```ts
    if (fetcher.data.ok && typeof fetcher.data.floor === 'number') {
      onPosted?.(fetcher.data.floor)
    }
```

并把该 effect 的依赖数组从

```ts
  }, [fetcher.state, fetcher.data, draftKey, onClearParent, onDone])
```

改成

```ts
  }, [fetcher.state, fetcher.data, draftKey, onClearParent, onDone, onPosted])
```

**注意**：`fetcher.data?.ok` 的守卫在 effect 开头已经有了，但 `DiscussionResult` 是判别联合，TypeScript 需要在同一作用域再收窄一次才能访问 `floor`，所以上面的 `fetcher.data.ok &&` 不是冗余。

- [ ] **Step 6: Discussion 接住 floor 并定位**

`apps/web/app/components/discussion/Discussion.tsx`：

(a) import 区改为（`useNavigate` 是新增的）：

```ts
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router'
```

并加：

```ts
import { replyTarget } from '~/lib/discussion-nav'
```

(b) 在 `const clearParent = useCallback(…)` 之后插入：

```ts
  const navigate = useNavigate()

  /**
   * 发帖成功后把用户带到他刚发的那一楼。
   *
   * 不做这件事的话，主题超过 50 层（POSTS_PAGE_SIZE）之后新楼根本不在当前
   * 楼层窗口里——revalidate 回来的列表看不到它，观感等同于发失败。
   */
  const onPosted = useCallback(
    (floor: number) => {
      const target = replyTarget(floor, page.from, page.pageSize)
      if (target.kind === 'navigate') {
        navigate(`${pathname}?floor=${target.from}#p${floor}`)
        return
      }
      // 已在本页：等 revalidate 把新楼渲染出来再滚过去
      requestAnimationFrame(() => {
        document
          .getElementById(`p${floor}`)
          ?.scrollIntoView({ block: 'center', behavior: prefersReduced() ? 'auto' : 'smooth' })
      })
    },
    [navigate, pathname, page.from, page.pageSize],
  )
```

(c) 在文件底部（`pageWindow` 已在 Task 0 移走，这里是文件末尾）加：

```ts
/** MotionConfig 管不到原生滚动 API，reduced-motion 要自己判 */
function prefersReduced() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
```

(d) 把 `onQuote` 里那句 `scrollIntoView({ behavior: 'smooth' })` 也改成：

```ts
    document
      .getElementById('reply-form')
      ?.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth' })
```

(e) 把回复框那个 `<PostForm … compact />` 加上 `onPosted={onPosted}`：

```tsx
          <PostForm
            action={action}
            intent="comment"
            topicId={topicId}
            parentId={parent?.id ?? null}
            onClearParent={clearParent}
            onPosted={onPosted}
            draftKey={`shrine:draft:topic:${topicId}`}
            compact
          />
```

- [ ] **Step 7: 跑测试与门禁**

Run: `cd /Users/i/Code/th && bun run typecheck && bun run check && cd apps/web && bun test`
Expected: 全绿

- [ ] **Step 8: 浏览器实测**

用 Browser pane（需要一个已登录会话与一个主题）：
1. `navigate` 到任一 `/shrine/t/<id>`
2. 在回复框输入文字，`computer` 点发送
3. 确认页面滚动到新楼且新楼可见

超 50 楼那一支难以手工造数据，由 Step 1–4 的单测覆盖——`replyTarget` 的六个用例正是为此写的。

- [ ] **Step 9: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/lib/discussion-nav.ts apps/web/app/lib/discussion-nav.test.ts \
        apps/web/app/components/discussion/PostForm.tsx \
        apps/web/app/components/discussion/Discussion.tsx
git commit -m "$(cat <<'EOF'
fix(web): 超 50 楼的主题回复后不出现在任何地方

discussion-action.ts 一直返回 { ok, intent, floor }，但 PostForm 声明了一个
本地的 Result 类型把 floor 抹掉了。加上 post.ts 把无 ?floor= 的请求吸附到
第一页、POSTS_PAGE_SIZE=50，主题超过 50 层后用户发的回复不在他当前看到的
这一页，revalidate 回来也看不到，观感等同于发失败。

PostForm 改用 DiscussionResult 并新增 onPosted(floor)；Discussion 用
replyTarget 判断新楼在不在当前楼层窗口，不在就导航到含它的那一页。

窗口判定抽成纯函数并单测：floorSeq 是序列不是计数，软删的楼保留占位，
所以页边界只能从 from/pageSize 算，不能从存活楼数算。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `.markdown` 正文排版

**缺陷 3。** `app.css` 全文没有任何 `.markdown` 规则，未装 typography 插件，`shadcn/tailwind.css` 里也没有。`Markdown.tsx:135` 的 `.markdown` 是个空 class，于是正文的引用/标题/列表/表格全被 preflight 抹平——`PostForm.tsx:189` 那个「❝」工具栏按钮产出的是**不可见的格式**。

不装 `@tailwindcss/typography`：它自带一整套与「白玉楼／深夜幻想乡」无关的配色与字号，覆盖成本高于自己写三十行。

**Files:**
- Modify: `apps/web/app/app.css`（新增一个 `@layer components` 块，放在 `@layer utilities` 之前）

**Interfaces:**
- Consumes: 现有主题 token（`--muted-foreground`、`--border`、`--primary`、`--muted`）与 `--font-heading`
- Produces: `.markdown` 的排版规则。T2 的墨界线会替换其中的 `hr` 与 `blockquote` 边框。

- [ ] **Step 1: 加排版规则**

在 `apps/web/app/app.css` 的 `@layer utilities {` **之前**插入：

```css
@layer components {
  /* 正文排版。Markdown.tsx 一直挂着 .markdown 这个类，但此前全站没有任何
     对应规则，正文的标题/引用/列表/表格全被 preflight 抹平——工具栏的
     「❝」按钮产出的是看不见的格式。
     不装 @tailwindcss/typography：它自带一整套与白玉楼/深夜幻想乡无关的
     配色与字号，覆盖成本高于自己写这三十行。 */
  .markdown {
    line-height: 1.75;
  }
  .markdown > * + * {
    margin-top: 0.75em;
  }
  .markdown h1,
  .markdown h2,
  .markdown h3,
  .markdown h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    line-height: 1.35;
    margin-top: 1.5em;
  }
  .markdown h1 {
    font-size: 1.5rem;
  }
  .markdown h2 {
    font-size: 1.25rem;
  }
  .markdown h3 {
    font-size: 1.0625rem;
  }
  .markdown h4 {
    font-size: 1rem;
  }
  .markdown a {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .markdown blockquote {
    border-inline-start: 2px solid var(--border);
    padding-inline-start: 0.875rem;
    color: var(--muted-foreground);
  }
  .markdown ul,
  .markdown ol {
    padding-inline-start: 1.5rem;
  }
  .markdown ul {
    list-style: disc;
  }
  .markdown ol {
    list-style: decimal;
  }
  .markdown li::marker {
    color: var(--muted-foreground);
  }
  .markdown li + li {
    margin-top: 0.25em;
  }
  .markdown code {
    background: var(--muted);
    border-radius: var(--radius-sm);
    padding: 0.1em 0.35em;
    font-size: 0.875em;
  }
  .markdown pre {
    background: var(--muted);
    border-radius: var(--radius-md);
    padding: 0.875rem;
    overflow-x: auto;
  }
  .markdown pre code {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
  }
  .markdown hr {
    border-top: 1px solid var(--border);
    margin-block: 1.5em;
  }
  .markdown table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875em;
    display: block;
    overflow-x: auto;
  }
  .markdown :is(th, td) {
    border: 1px solid var(--border);
    padding: 0.4rem 0.6rem;
    text-align: start;
  }
  .markdown th {
    background: var(--muted);
    font-weight: 600;
  }
}
```

- [ ] **Step 2: 构建并断言规则进了产物**

Run:
```bash
cd /Users/i/Code/th/apps/web && bun run build && \
  grep -c "\.markdown" build/client/assets/*.css
```
Expected: ≥ 10

- [ ] **Step 3: 浏览器实测**

用 Browser pane：
1. `navigate` 到任一有正文的主题页
2. 在回复框里贴一段富 Markdown（标题、引用、有序/无序列表、表格、行内代码、代码块、分隔线），点预览
3. `computer` 截图

Expected: 七种元素全部有可见的排版差异；引用有左边线、表格有边框、代码块有底色

- [ ] **Step 4: 断言表格在窄屏不撑破版面**

`resize_window` 到 `mobile` 预设（375px），重新截图。

Expected: 宽表格在自己的容器内横向滚动，**页面 body 不横向滚动**

- [ ] **Step 5: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css
git commit -m "$(cat <<'EOF'
fix(web): .markdown 此前是个空 class，正文排版全被 preflight 抹平

Markdown.tsx 一直挂着 .markdown，但 app.css 全文没有任何对应规则，也没装
typography 插件。结果是正文的标题/引用/列表/表格全无样式，PostForm 工具栏
那个「❝」按钮产出的是看不见的格式。

自己写三十行而不是装 @tailwindcss/typography：后者自带一整套与白玉楼／
深夜幻想乡无关的配色与字号，覆盖成本更高。表格用 display:block + overflow-x
自滚，避免窄屏撑破版面。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 正文图片尺寸预留

**缺陷 6。** `Markdown.tsx:109` 的 `img` 只有 `loading="lazy"` + `max-h-[32rem]`，没有 `width`/`height`/`aspect-ratio`。图片到达即把下方内容顶开，这是站内一半布局跳变的共同源头。

**设计取舍（执行者请读完再动手）**：远程图片的真实尺寸我们**不知道**，所以无法做到精确预留。这里选的是「预留一个有界的盒子，让图片在里面居中留白」——版面从首帧起就稳定，代价是竖图会被装进 3:2 的盒子里缩小显示。更彻底的解法是走一个知道尺寸的图片代理，那是另一个任务，不在本期。

**Files:**
- Modify: `apps/web/app/components/discussion/Markdown.tsx`（`img` 渲染器）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 改 img 渲染器**

`apps/web/app/components/discussion/Markdown.tsx`，把

```tsx
  img({ src, alt, title }) {
    // 远程图片不带 referrer；lazy 让一屏几十张图的主题不至于一次全拉
    return (
      <img
        src={src}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-h-[32rem] rounded-md"
      />
    )
  },
```

改成

```tsx
  img({ src, alt, title }) {
    /**
     * 远程图片不带 referrer；lazy 让一屏几十张图的主题不至于一次全拉。
     *
     * 外面这层固定 3:2 的盒子是**尺寸预留**：远程图的真实尺寸我们不知道，
     * 没有它，图片到达时会把下方内容整体顶开——这是站内一半布局跳变的源头。
     * 代价是竖图会在盒子里缩小居中；要精确预留得走一个知道尺寸的图片代理。
     * span 不是 div：img 渲染器的输出会落在 <p> 里，块级元素会被 HTML 解析器
     * 提到 <p> 外面，造成水合不一致。
     */
    return (
      <span className="my-1 block aspect-3/2 max-h-[32rem] overflow-hidden rounded-md bg-muted/40">
        <img
          src={src}
          alt={alt ?? ''}
          title={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
        />
      </span>
    )
  },
```

- [ ] **Step 2: 类型检查**

Run: `cd /Users/i/Code/th && bun run typecheck && bun run check`
Expected: 全绿

- [ ] **Step 3: 浏览器实测版面不跳**

用 Browser pane：
1. `navigate` 到一个正文含图片的主题页
2. `javascript_tool` 跑下面这段，测量图片容器在图片加载前后的高度：

```js
const box = document.querySelector('.markdown span.aspect-3\\/2')
const before = box.getBoundingClientRect().height
const img = box.querySelector('img')
await (img.complete ? Promise.resolve() : new Promise(r => img.onload = r))
const after = box.getBoundingClientRect().height
JSON.stringify({ before, after, jumped: Math.abs(after - before) > 1 })
```

Expected: `jumped: false`

3. `read_console_messages` 确认无水合警告（验证 `span` 而非 `div` 的选择是对的）

- [ ] **Step 4: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/discussion/Markdown.tsx
git commit -m "$(cat <<'EOF'
fix(web): 正文图片补尺寸预留，消掉一半的布局跳变

img 此前只有 loading=lazy + max-h，没有任何尺寸预留，图片到达即把下方
内容顶开。远程图的真实尺寸我们不知道，所以预留一个固定 3:2 的有界盒子、
让图片 object-contain 在里面居中——版面从首帧起稳定，代价是竖图缩小显示。
要精确预留得走一个知道尺寸的图片代理，那是另一个任务。

用 span 不用 div：img 渲染器的输出落在 <p> 里，块级元素会被 HTML 解析器
提到 <p> 外面，造成水合不一致。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 移动端导航

**缺陷 1，本期最重的一条。** `site-header.tsx:55` 的主导航是 `hidden … md:flex`，而全仓 `md:hidden` / `Sheet` / `Drawer` **零命中**，`components/ui/` 下没有抽屉原语。也就是说 **<768px 的用户看不到 `/kourindou` `/shrine` `/chronicle` `/spellcard` `/music` 五个模块入口中的任何一个**，只能靠首页或改地址栏。

用仓库已有的 `radix-ui` Dialog 做侧滑抽屉，**不装新包**。

**Files:**
- Create: `apps/web/app/components/mobile-nav.tsx`
- Modify: `apps/web/app/components/site-header.tsx`
- Modify: `apps/web/messages/zh.json`、`ja.json`、`en.json`

**Interfaces:**
- Consumes: `nav` 数组（从 `site-header.tsx` 导出）、`radix-ui` 的 `Dialog`
- Produces: `<MobileNav items={NAV_ITEMS} />`；`site-header.tsx` 导出 `NAV_ITEMS`

- [ ] **Step 1: 三语加文案 key**

`apps/web/messages/zh.json` 加：

```json
  "nav_menu": "菜单",
  "nav_menu_close": "关闭菜单",
```

`apps/web/messages/ja.json` 加：

```json
  "nav_menu": "メニュー",
  "nav_menu_close": "メニューを閉じる",
```

`apps/web/messages/en.json` 加：

```json
  "nav_menu": "Menu",
  "nav_menu_close": "Close menu",
```

- [ ] **Step 2: 跑三语审计确认 key 齐全**

Run: `cd /Users/i/Code/th && bun run check-messages`
Expected: 通过（此时两个 key 会被列进「没有代码引用的 key」软提示，正常）

- [ ] **Step 3: site-header 导出 NAV_ITEMS**

`apps/web/app/components/site-header.tsx`，把

```ts
const nav = [
```

改成

```ts
export const NAV_ITEMS = [
```

并把下面 `{nav.map((item) => (` 改成 `{NAV_ITEMS.map((item) => (`。

- [ ] **Step 4: 建抽屉组件**

创建 `apps/web/app/components/mobile-nav.tsx`：

```tsx
import { Menu } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

type Item = { path: string; label: () => string }

/**
 * 移动端导航抽屉。
 *
 * 此前 <768px 的用户看不到五个模块入口中的任何一个——site-header 的主导航是
 * `hidden md:flex`，而全站没有任何 md:hidden 的替代入口。
 *
 * 用 radix-ui 的 Dialog 而不是装 vaul/sheet：Dialog 已经在仓库里，
 * 焦点陷阱、Esc 关闭、aria-modal、滚动锁定它全都做了，缺的只是从侧面滑进来。
 */
export function MobileNav({ items }: { items: readonly Item[] }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  // 导航后自动关闭：Radix 不知道路由变了
  useEffect(() => setOpen(false), [pathname])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={m.nav_menu()}
        >
          <Menu />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-label={m.nav_menu()}
          className="fixed inset-y-0 start-0 z-50 flex w-64 max-w-[80vw] flex-col gap-1 bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
        >
          <DialogPrimitive.Title className="mb-2 font-heading text-lg font-bold">
            {m.site_name()}
          </DialogPrimitive.Title>
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={localizeHref(item.path)}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`
              }
            >
              {item.label()}
            </NavLink>
          ))}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" className="mt-auto">
              {m.nav_menu_close()}
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
```

**注意**：`DialogPrimitive.Title` 不能省——Radix 没有 Title 会在控制台报无障碍警告，且读屏用户拿不到抽屉的名字。

- [ ] **Step 5: 挂进 header**

`apps/web/app/components/site-header.tsx`：

(a) import 区加：

```ts
import { MobileNav } from '~/components/mobile-nav'
```

(b) 把站名 `<Link>` 那一段**之前**插入触发按钮（放最左边，符合移动端习惯）：

```tsx
        <MobileNav items={NAV_ITEMS} />
```

即结构变成：

```tsx
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <MobileNav items={NAV_ITEMS} />
        <Link
          to={localizeHref('/')}
          className="font-heading text-lg font-bold tracking-wide"
        >
```

注意外层的 `gap-6` 在移动端会让按钮与站名离得太远，把它改成 `gap-3 md:gap-6`。

- [ ] **Step 6: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-messages`
Expected: 全绿，且 `check-messages` 不再把 `nav_menu` / `nav_menu_close` 列为无引用

- [ ] **Step 7: 浏览器实测**

用 Browser pane：
1. `resize_window` 到 `mobile` 预设（375×812），`navigate` 到 `http://localhost:3000/`
2. `read_page` 确认存在 aria-label 为「菜单」的按钮
3. `computer` 点击它
4. `read_page` 确认五个模块入口全部出现在可访问性树里
5. `computer` 点「博丽神社」
6. `read_page` 确认 URL 变成 `/shrine` 且抽屉**已关闭**（验证 Step 4 的 `useEffect(() => setOpen(false), [pathname])`）
7. `computer` 按 `Escape` 键测试再次打开后能用键盘关闭
8. `resize_window` 回 `desktop`，`read_page` 确认菜单按钮消失、桌面导航回来

Expected: 8 步全部符合

- [ ] **Step 8: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/mobile-nav.tsx apps/web/app/components/site-header.tsx apps/web/messages/
git commit -m "$(cat <<'EOF'
feat(web): 补移动端导航抽屉

site-header 的主导航是 hidden md:flex，而全站没有任何 md:hidden 的替代
入口——<768px 的用户看不到 /kourindou /shrine /chronicle /spellcard /music
五个模块入口中的任何一个，只能靠首页或改地址栏。

用仓库已有的 radix-ui Dialog 做侧滑抽屉，不装 vaul/sheet：焦点陷阱、
Esc 关闭、aria-modal、滚动锁定 Radix 全都做了，缺的只是从侧面滑进来。
导航后靠 pathname 变化自动关闭（Radix 不知道路由变了）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 收尾

- [ ] **全量门禁**

Run:
```bash
cd /Users/i/Code/th && \
  bun run check && bun run typecheck && bun run check-messages && \
  (cd apps/web && bun test) && bun run e2e
```
Expected: 全绿。`e2e` 是 HTTP 层验收（40 项），本期改动全在 web 端，它应当不受影响——若它红了，说明改动越界了。

- [ ] **更新 CLAUDE.md**

在「博丽神社（M4，已完成）约定」之后新增一节：

```markdown
- 动效与样式约定（T0 已落地，详见 docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md）：
  - **卡片不能用 `border-*` 表达状态**：`card.tsx` 只有 `ring-1`，preflight 是 `border: 0 solid`，改 border 颜色是空操作（首页与六版块网格曾因此三处 hover 全无反馈）
  - `prefers-reduced-motion` 兜底在 `app.css` 的 `@layer base`：**归零 `--tw-enter-*/--tw-exit-*` 变量**，不用 `animation: none`（Radix 靠 `animationend` 卸载弹层）
  - `.markdown` 的排版规则在 `app.css` 的 `@layer components`，不装 typography 插件
  - 分页窗口算法只有一份：`app/lib/paging.ts` 的 `pageWindow`
  - `apps/web` 已接 `bun test`，能抽成纯函数的逻辑请抽出来测
```

- [ ] **提交收尾**

```bash
cd /Users/i/Code/th
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md 记下 T0 立的四条样式约定

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 下一步

T0 完成后：
- **计划二** T1–T2：三材 token 进 `@theme`、两行 `--default-transition-*` 收编现存 12 处裸 `transition-colors`、材质层（掀角 / 朱线 / 墨界线 / `:target` 墨洇 / 青海波远层视差）、`::view-transition` 曲线。**仍然零新依赖。**
- **计划三** T3–T5：装 `motion`、Provider、`viewTransition` 转场、各页落地、Playwright 冒烟。

spec 第 11 节写明 **T2 结束是真实决策点**：那时全站已有完整的三材质感与跨页转场且零新依赖，可以先看观感再决定 T3 是否继续。
