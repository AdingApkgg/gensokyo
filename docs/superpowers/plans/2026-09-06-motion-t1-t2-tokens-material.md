# 和风纸境 T1–T2：三材 token 与材质层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「墨・纸・水」三材 token 立进 `@theme`，并用它铺出全站材质层——掀角、朱线、墨界线、落点墨洇、青海波远层视差、跨页转场、hero 装饰、全局 pending 墨线。

**Architecture:** 全部改动在 `apps/web`，**零新增依赖，且几乎零新增 JS**。材质靠 CSS 自定义属性 + `@utility`；跨页转场用 React Router 8 原生 `viewTransition`（浏览器 API，0 KB）；青海波视差用原生 scroll-driven animation（`animation-timeline: scroll()`，0 KB）。唯一新增的 React 代码是一个读 `useNavigation()` 的 pending 指示条。

**Tech Stack:** Bun · React Router 8 (SSR) · React 19 · Tailwind v4 · radix-ui · Paraglide JS

**Spec:** `docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md` 第四、五、七节

**前置:** T0 已完成并合入 main（`docs/superpowers/plans/2026-09-05-motion-t0-defects.md`）。

## Global Constraints

- **不引入任何新依赖**。本期不装 `motion`——那是 T3。若任何任务里出现 `import ... from 'motion'`，是错的。
- **内容层禁止任何 `initial` 隐藏态**（`opacity: 0` / `visibility: hidden` 作为进 SSR HTML 的内容元素初始样式）。装饰层（同时满足 `aria-hidden="true"` 与 `pointer-events-none`、不承载信息）才可以自由入场。
- **到达动画的归属**：客户端导航后的到达由**原生 View Transition 独占**。本期不得给内容元素写任何入场动画。
- **全域禁止 overshoot / bounce**（ζ=1，纸不会弹）。
- **只动 `transform` / `opacity` / 颜色**，绝不动 `width` / `height` / `top` / `left` / `filter`。`[data-slot="card"]`、`[data-slot="popover-content"]`、`[data-slot="dropdown-menu-content"]` 与 `site-header` 都挂着 `backdrop-filter`，在它们上面叠动画代价极高。
- **卡片不能用 `border-*` 表达状态**（`card.tsx` 只有 `ring-1`，preflight 是 `border: 0 solid`）。用 `ring-*`。
- **`prefers-reduced-motion` 的降级块在 `app.css` 文件末尾、不带任何 `@layer`**。新增任何降级规则一律加进那一块，不要另起。`bun run check-css-layers` 会断言这一点。
- 文案一律走 Paraglide；新增 key 必须 zh/ja/en 三语齐全。**不得使用 `m` 作为 Paraglide 之外的标识符**。
- Biome：单引号、按需分号。`**/*.css` 不进 Biome，CSS 自己看仔细。
- 提交信息末尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## 已核实的事实（不要重新论证，直接用）

| 事实 | 依据 |
|---|---|
| `duration-*` 从 `--transition-duration-*` 解析，`ease-*` 从 `--ease-*` 解析 | `tailwindcss@4.3.3/dist/lib.js` 里 `"--transition-duration"` 与 `themeKeys:["--ease"]` |
| `tw-animate-css` 的 `--animate-in` 读 `var(--tw-duration)` / `var(--tw-ease)` | 该包 dist |
| 出厂默认是 `150ms` / `cubic-bezier(0.4,0,0.2,1)` | `theme.css:492-493` |
| `app.css` 结构：`@theme inline`(15-57) → `:root`(60-104) → `.dark`(107-149) → `@layer base`(151-189) → `@layer components`(191-292) → `@layer utilities`(294-309) → 不分层降级块(324-344) | 直接读文件 |
| **`body::before` 已被近层青海波占用；`body::after` 是空的** | `app.css` 的 `@layer base` |
| RR8 原生支持 `viewTransition`（稳定 API，非 `unstable_`） | `LinkProps`/`NavLinkProps`/`FormProps`/`NavigateOptions` 均有该 prop；导出 `useViewTransitionState` |
| 同文档 view transitions 自 2025-10-14 起为 Baseline newly available | web.dev |
| **Firefox 首版不含 view transition `types`** | MDN |
| `animation-timeline: scroll()`：Chrome/Edge 115+、Safari 26+（含 iOS）、Firefox 158+，全球 87.22% | caniuse |

---

### Task 1: 三材 token 进 `@theme`

把「墨・纸・水」立成 token，并用两行把仓库现存的裸 `transition-*` 零 diff 收编。本任务**不产生任何可见变化**——它是后面所有任务的词汇表。

**Files:**
- Modify: `apps/web/app/app.css`（在 `@theme inline { … }` 块结束之后、`:root {` 之前插入一个新的 `@theme` 块；另在 `:root` 内追加几何 token）

**Interfaces:**
- Consumes: 无
- Produces: 工具类 `ease-sumi` / `ease-washi` / `ease-fude`、`duration-sumi` / `duration-washi-sm` / `duration-washi-md` / `duration-washi-lg`；CSS 变量 `--settle-y` / `--lift-y` / `--dogear` / `--wave-period`。Task 2–9 全部消费它们。

- [ ] **Step 1: 插入三材 token**

在 `apps/web/app/app.css` 的 `@theme inline { … }` 块**结束之后**、`:root {` **之前**插入：

```css
/* 三材 Sanzai —— 墨・纸・水
   这三条曲线不是挑好看的库存缓动，是从物理拟合来的；改数值之前请读
   docs/superpowers/specs/2026-09-05-motion-atmosphere-design.md 第四节。

   **必须用不带 inline 的 @theme**：inline 模式下变量不会真正落到 :root，
   而 --settle-y 这类几何 token 需要在运行时被 var() 读到。

   水（青海波）的正确缓动是 linear —— 这是**禁令不是 token**：给背景波加
   ease-in-out，循环接缝处会出现肉眼可见的「抽泵」。不要为它立一个条目，
   否则一定有人拿去当通用缓动使。 */
@theme {
  /* 墨·洇：Lucas–Washburn 毛细渗透 L ∝ √t 的拟合（RMSE 0.0001）。
     前 10% 时间走完 32%、前 25% 走完 50%，之后是极长的尾——落笔猛、越洇越慢。
     用于一切**出现类**的颜色/不透明度：hover 底色、ring 变色、focus ring、badge、tooltip。 */
  --ease-sumi: cubic-bezier(0, 0.408, 0.501, 0.75);

  /* 纸·落：临界阻尼 ζ=1 阶跃响应在 y(T)=97.5% 处的拟合（RMSE 0.0026）。
     p(.25)=.42、p(.5)=.78、p(.75)=.95——最后 5% 用掉 25% 的时间，这就是「长而软」。
     ζ=1 是选定的：纸纤维内阻尼极高，掀起一角松手不会来回抖。**全域禁止 overshoot**。
     用于一切 transform 归位。 */
  --ease-washi: cubic-bezier(0.212, 0.091, 0.259, 0.953);

  /* 笔·运：梯形速度剖面（加速 20% / 匀速 60% / 减速 20%）的位置积分，p(.5)=0.500 严格对称。
     **只**用于「一笔画出来」的几何延展：下划线 scaleX、分隔线铺开、进度条。
     关键区分：笔画的**长度**由手速决定（匀速），笔画的**浓淡**才由毛细决定（√t）。
     把两者混成一条曲线，是多数所谓「墨感」动效失真的原因。 */
  --ease-fude: cubic-bezier(0.244, 0, 0.756, 1);

  /* 墨的时长是单值不做阶梯：毛细渗透深度是材料常数，与元素多大无关。 */
  --transition-duration-sumi: 180ms;

  /* 纸的时长按**纸的尺寸**挑档，不按「这个交互重不重要」：
     sm = badge / button / 图标（<40px）
     md = 卡片 / 列表行 / 输入框（40–200px）
     lg = dialog / 页面区块（>200px）
     公式 T(L) = 180ms · √(L/40)，上限 420ms。
     元规则：**曲线取真值，标度取压缩**——形状忠于物理（薄板基频 f ∝ 1/L²），
     但标度指数从 L² 压到 L^0.5，否则 dialog 要等 4.5 秒。压缩是设计决定，不假装它是物理。 */
  --transition-duration-washi-sm: 180ms;
  --transition-duration-washi-md: 280ms;
  --transition-duration-washi-lg: 400ms;

  /* 收编：把出厂默认（150ms / cubic-bezier(0.4,0,0.2,1)）换成墨。
     仓库现存所有裸 `transition-colors` / `transition-shadow` 零 diff 全部改用墨的曲线。
     这两行必须写字面值而不是 var(--ease-sumi)——它们在构建期被 Tailwind 读取，
     不是运行时求值。改上面的 --ease-sumi 时记得同步这里。 */
  --default-transition-duration: 180ms;
  --default-transition-timing-function: cubic-bezier(0, 0.408, 0.501, 0.75);
}
```

- [ ] **Step 2: 几何 token 进 `:root`**

在 `apps/web/app/app.css` 的 `:root { … }` 块内、`--radius: 0.375rem;` 那一行**之后**插入：

```css
  /* 三材的几何量。这些不是 Tailwind 命名空间，只是给 CSS 读的普通变量。 */

  /* 全站**唯一**的入场位移量，方向恒为 +y→0（纸从上方落下贴到桌面）。
     绝不给第二个值——一旦出现 12px/24px，「远近」就被编码进了 transform，
     而 reduced-motion 会把 transform 全部关掉，那部分信息就丢了。

     **T1–T2 不使用它**：本期所有「到达」都由原生 View Transition 独占（见
     全局约束），没有任何元素需要 settle。这里先立着是为了 T3 的 motion 层，
     那时非导航到达（fetcher 结果、展开收起、增删）才需要它。
     在 T3 之前谁用到它，八成是在给内容层写入场动画——那是红线。 */
  --settle-y: 6px;
  --lift-y: -2px; /* 卡片 hover 抬起 */
  --dogear: 14px; /* 折角三角边长，transform-origin 在角点 */
  --wave-period: 22px; /* 近层瓦片高，来自 body::before 的 background-size: 44px 22px */
```

- [ ] **Step 3: 构建并断言工具类真的生成了**

「一条命名空间同时喂饱三个消费者」是本期最大的红利，必须实证，不能假设。

Run:
```bash
bun run build >/dev/null 2>&1
C=$(ls -t build/client/assets/*.css | head -1)
echo "--- token 是否落到 :root ---"
grep -o '\--ease-sumi:[^;]*' $C | head -1
grep -o '\--settle-y:[^;]*' $C | head -1
echo "--- 出厂默认是否被换掉（应为 180ms，不是 150ms）---"
grep -o '\--default-transition-duration:[^;]*' $C | head -1
```
Expected: 三条都有输出，且 `--default-transition-duration` 是 `180ms`。

- [ ] **Step 4: 断言 `duration-sumi` / `ease-washi` 这类工具类可用**

Tailwind 是按需生成的，没被用到的工具类不会出现在产物里。所以在 `app/routes/ui.tsx` 里**临时**加一个探针元素再构建：

```bash
cd /Users/i/Code/th/apps/web
# 临时探针
sed -i '' 's|<main className=|<main data-probe="duration-sumi ease-washi duration-washi-lg ease-fude" className=|' app/routes/ui.tsx
bun run build >/dev/null 2>&1
C=$(ls -t build/client/assets/*.css | head -1)
grep -o 'duration-sumi{[^}]*}' $C
grep -o 'ease-washi{[^}]*}' $C
# 撤销探针
git checkout -- app/routes/ui.tsx
```

**注意** `data-probe` 不会被 Tailwind 扫到——Tailwind v4 扫的是源文件里出现的**字符串**，`data-probe="duration-sumi …"` 里的这些词确实是源文件里的字符串，会被扫到。
Expected: `duration-sumi{--tw-duration:180ms;transition-duration:180ms}` 与 `ease-washi{--tw-ease:cubic-bezier(0.212,0.091,0.259,0.953);transition-timing-function:…}` 各出现一次。

若**没有**输出，说明命名空间判断有误，**停下来报告**，不要继续往下做——Task 2–9 全部建立在这条之上。

- [ ] **Step 5: 门禁与提交**

```bash
cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-css-layers
git status --short   # 必须只有 app/app.css 一个文件
git add apps/web/app/app.css
git commit -m "$(cat <<'EOF'
feat(web): 三材 token —— 墨・纸・水的缓动、时长与几何

三条曲线从物理拟合而来，不是库存缓动：墨走 Lucas–Washburn 毛细渗透 √t、
纸走临界阻尼 ζ=1 阶跃响应（全域禁 overshoot）、笔走梯形速度剖面。
水的正确缓动是 linear，写成注释里的禁令而不是 token——立成条目一定会被
拿去当通用缓动使。

顺带用两行把出厂默认（150ms / cubic-bezier(.4,0,.2,1)）换成墨，仓库现存
所有裸 transition-* 零 diff 收编。

用不带 inline 的 @theme：inline 模式下变量不落到 :root，而几何 token 要被
运行时的 var() 读到。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 把现存的 `duration-100` 换成 token

`ui/` 下有 5 处硬编码的 `duration-100`（Radix 弹层内容）。它们绕过了刚立起来的时长体系。

**Files:**
- Modify: `apps/web/app/components/ui/dialog.tsx`（2 处）
- Modify: `apps/web/app/components/ui/select.tsx`（1 处）
- Modify: `apps/web/app/components/ui/dropdown-menu.tsx`（2 处）

**Interfaces:**
- Consumes: Task 1 的 `duration-sumi`
- Produces: 无

- [ ] **Step 1: 先定位这 5 处**

Run: `cd /Users/i/Code/th/apps/web && grep -n "duration-100" app/components/ui/*.tsx`
Expected: 5 行，分布在 dialog.tsx(2) / select.tsx(1) / dropdown-menu.tsx(2)

- [ ] **Step 2: 逐处替换**

把这 5 处的 `duration-100` 改成 `duration-sumi`。**只改这一个词**，同一 className 串里其他内容一字不动。

理由：弹层的出现是「墨在纸上洇开」，180ms 比 100ms 更软，且与全站同源。这五处是 `tw-animate-css` 的 `--animate-in` 读 `var(--tw-duration)` 的消费点——换成 token 后它们自动跟随三材体系。

- [ ] **Step 3: 构建断言时长真的变了**

Run:
```bash
cd /Users/i/Code/th/apps/web && bun run build >/dev/null 2>&1
C=$(ls -t build/client/assets/*.css | head -1)
echo "--- 还有没有残留的 duration-100 ---"
grep -c 'duration-100' $C || echo 0
echo "--- duration-sumi 是否生成 ---"
grep -o 'duration-sumi{[^}]*}' $C
```
Expected: `duration-sumi{--tw-duration:180ms;transition-duration:180ms}`。残留计数为 0 或仅剩非本项目来源的。

- [ ] **Step 4: 浏览器实测弹层仍能正常关闭**

**这一步不能省。** T0 的教训：Radix 靠 `animationend` 卸载弹层，任何动到弹层时长的改动都要验一遍「它还会不会消失」。

用 Browser pane：
1. `preview_start` 起 dev server（`.claude/launch.json` 里的 `gensokyo`）
2. `navigate` 到 `http://localhost:3000/ui`
3. 用 `javascript_tool` 跑（`find`/`read_page` 在这一页拿不到可访问性树，直接用 JS）：

```js
const sleep = ms => new Promise(r => setTimeout(r, ms))
const trigger = document.querySelector('[data-slot="select-trigger"]')
const present = () => !!document.querySelector('[data-slot="select-content"], [role="listbox"]')
const before = present()
trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0}))
trigger.click()
await sleep(300)
const afterOpen = present()
document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))
await sleep(900)
JSON.stringify({ before, afterOpen, afterClose: present() })
```
Expected: `{before:false, afterOpen:true, afterClose:false}`

**若 `afterClose` 为 true**：先检查 `document.visibilityState`。如果是 `hidden`，那是 Chromium 对后台标签页的动画节流（`currentTime` 会恒为 0），**不是缺陷**——改用机制测试：手动派发 `animationend` 后再看是否卸载。

- [ ] **Step 5: 门禁与提交**

```bash
cd /Users/i/Code/th && bun run check && bun run typecheck
git add apps/web/app/components/ui/
git commit -m "$(cat <<'EOF'
refactor(web): 弹层的 duration-100 换成 duration-sumi

ui/ 下 5 处硬编码的 duration-100 绕过了刚立起的时长体系。换成 token 后
它们自动跟随三材——tw-animate-css 的 --animate-in 读的正是 var(--tw-duration)。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: PaperLift —— 纸被掀起一角

首页五张模块卡与六版块网格是站点门面。T0 只是把 hover 从「空操作」修成「能看见」，本任务给它们真正的纸感。

**设计取舍（不要自行更改）**：**不做卡片微旋转**。原提案有 `--lift-tilt: 0.15deg`，被三位评审中的两位独立否决——在半透明 + `backdrop-filter: blur(10px)` 的卡片上做亚度数旋转会让 Noto Serif SC 的 CJK 字形重新栅格化、整卡发虚，而 0.15deg 本身看不见。掀角靠位移 + 折角三角就够。

**Files:**
- Modify: `apps/web/app/app.css`（新增 `@utility paper-lift`，放在 `@layer components` 之后、`@layer utilities` 之前）
- Modify: `apps/web/app/routes/home.tsx:33`
- Modify: `apps/web/app/components/board-nav.tsx:26`

**Interfaces:**
- Consumes: `--lift-y`、`--dogear`、`--ease-washi`、`--transition-duration-washi-md`（Task 1）
- Produces: `paper-lift` 工具类。Task 8 的 hero 不用它（hero 里没有卡片）。

- [ ] **Step 1: 加 `@utility paper-lift`**

在 `apps/web/app/app.css` 的 `@layer components { … }` 块**结束之后**、`@layer utilities {` **之前**插入：

```css
/* 纸被掀起一角。
   用 @utility 而不是 @layer components 里的类：@utility 生成的规则落在
   @layer utilities，能被 hover:/focus-visible: 这类变体正常修饰。

   刻意**不做**微旋转：在半透明 + backdrop-filter 的卡片上做亚度数 rotate 会让
   CJK 衬线字形重新栅格化、整卡发虚，而 0.15deg 本身看不见（详见 spec 附录 B）。

   折角三角是纯 transform + opacity 的厚度暗示，不动 box-shadow（paint 类，贵）。 */
@utility paper-lift {
  position: relative;
  transition-property: transform, box-shadow;
  transition-duration: var(--transition-duration-washi-md);
  transition-timing-function: var(--ease-washi);

  /* 折角：右上角一枚三角，常态收成 0，掀起时长出来。
     用 accent（山吹金）而不是 primary（朱红）——朱红已经承担了 ring 的强调，
     再用一次就分不清主次。 */
  &::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: var(--dogear);
    height: var(--dogear);
    background: linear-gradient(
      225deg,
      var(--accent) 0 50%,
      transparent 50%
    );
    border-start-end-radius: var(--radius-xl);
    transform: scale(0);
    transform-origin: 100% 0;
    opacity: 0;
    pointer-events: none;
    transition: transform var(--transition-duration-washi-md) var(--ease-washi),
      opacity var(--transition-duration-washi-sm) var(--ease-sumi);
  }

  /* 键盘同步：只写 :hover 的话键盘用户永远拿不到掀角。
     :focus-visible 挂在外层 <a> 上，所以用 :has() 往下传。 */
  &:hover,
  &:has(:focus-visible) {
    transform: translateY(var(--lift-y));
    &::after {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* 按下：纸被压回桌面。接触是瞬时的，所以按下没有过渡；松手才走纸的回落。 */
  &:active {
    transform: translateY(0);
    transition-duration: 0s;
  }
}
```

- [ ] **Step 2: 首页五张卡用上它**

`apps/web/app/routes/home.tsx`，把

```tsx
            <Card className="h-full transition-shadow hover:ring-primary/50">
```

改成

```tsx
            <Card className="paper-lift h-full hover:ring-primary/50">
```

（`transition-shadow` 去掉：`paper-lift` 自己声明了 `transition-property: transform, box-shadow`，两者并存会互相覆盖。）

- [ ] **Step 3: 六版块网格用上它**

`apps/web/app/components/board-nav.tsx`，把

```tsx
          <Card
            className={`h-full transition-shadow ${b === current ? 'ring-2 ring-primary hover:ring-primary' : 'hover:ring-primary/50'}`}
          >
```

改成

```tsx
          <Card
            className={`paper-lift h-full ${b === current ? 'ring-2 ring-primary hover:ring-primary' : 'hover:ring-primary/50'}`}
          >
```

- [ ] **Step 4: 降级——reduced-motion 下不掀**

在 `apps/web/app/app.css` **文件末尾那个不分层的** `@media (prefers-reduced-motion: reduce) { … }` 块内，`.animate-pulse` 规则**之后**追加：

```css
  /* 掀角是纯装饰的空间暗示，减弱动效下整条关掉——ring 的颜色变化仍在，
     所以「这张卡可点」的信息不丢。 */
  .paper-lift {
    transition-property: box-shadow;
  }
  .paper-lift:hover,
  .paper-lift:has(:focus-visible) {
    transform: none;
  }
  .paper-lift::after {
    display: none;
  }
```

**必须加进那一块，不要另起一个 `@media`**——`bun run check-css-layers` 断言的是「归零规则不在任何 `@layer` 内」，另起的块若被谁挪进 layer 就会静默失效。

- [ ] **Step 5: 构建 + 门禁**

Run: `cd /Users/i/Code/th && (cd apps/web && bun run build >/dev/null 2>&1) && bun run check && bun run typecheck && bun run check-css-layers`
Expected: 全绿

Run:
```bash
cd /Users/i/Code/th/apps/web && C=$(ls -t build/client/assets/*.css | head -1)
grep -c 'paper-lift' $C
```
Expected: ≥ 3（工具类本体 + hover 分支 + 降级分支）

- [ ] **Step 6: 浏览器实测**

用 Browser pane，`navigate` 到 `http://localhost:3000/`，用 `javascript_tool`：

```js
const card = document.querySelector('a .paper-lift, a [data-slot="card"].paper-lift')
if (!card) throw new Error('paper-lift 没挂上')
const cs = getComputedStyle(card)
const after = getComputedStyle(card, '::after')
JSON.stringify({
  hasUtility: card.className.includes('paper-lift'),
  transitionProperty: cs.transitionProperty,
  transitionDuration: cs.transitionDuration,
  restTransform: cs.transform,
  dogearScale: after.transform,
  dogearOpacity: after.opacity,
  dogearSize: after.width + '×' + after.height,
})
```
Expected: `transitionProperty` 含 `transform` 与 `box-shadow`；`transitionDuration` 为 `0.28s`；常态 `restTransform` 是 `none` 或 identity 矩阵；折角常态 `opacity: 0`、`transform` 为 `matrix(0, 0, 0, 0, 0, 0)`（scale(0)）、尺寸 `14px×14px`。

**`computer` 的 hover 动作在这个预览标签页上不可用**（会报「local file」）。折角的悬停态改用注入伪 hover 的办法验：

```js
const s = document.createElement('style')
s.textContent = '.paper-lift{transform:translateY(var(--lift-y))} .paper-lift::after{transform:scale(1);opacity:1}'
document.head.appendChild(s)
const card = document.querySelector('.paper-lift')
const r = { lifted: getComputedStyle(card).transform, dogear: getComputedStyle(card, '::after').opacity }
s.remove()
JSON.stringify(r)
```
Expected: `lifted` 是含 `-2` 的矩阵（`matrix(1, 0, 0, 1, 0, -2)`），`dogear` 为 `1`。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css apps/web/app/routes/home.tsx apps/web/app/components/board-nav.tsx
git commit -m "$(cat <<'EOF'
feat(web): PaperLift —— 卡片掀角、折角露金、按压压平

首页五张模块卡与六版块网格是站点门面，T0 只是把 hover 从空操作修成能看见，
这里给它们真正的纸感：抬起 2px + 右上角长出一枚山吹金折角三角。

刻意不做微旋转：半透明 + backdrop-filter 的卡片上做亚度数 rotate 会让 CJK
衬线字形重新栅格化、整卡发虚，而 0.15deg 本身看不见。

:focus-visible 与 :hover 同一套视觉，否则键盘用户永远拿不到掀角。
按下无过渡（手指接触纸面是瞬时的），松手才走纸的回落。
reduced-motion 下整条关掉，ring 的颜色变化仍在。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 墨界线与列表行的朱线

站内所有列表现在用 `divide-y` 的硬线分隔。和纸语汇里，分隔应当是墨在纸上洇开又淡去的一道，两端渐隐。列表行的 hover 则用一道「落笔」的朱线。

**Files:**
- Modify: `apps/web/app/app.css`（`@layer components` 内新增两条）
- Modify: `apps/web/app/components/discussion/PostList.tsx`（`<ol>` 的 `divide-y border-y`）
- Modify: `apps/web/app/routes/shrine/topic-list.tsx`（列表容器）
- Modify: `apps/web/app/routes/kourindou/list.tsx`（`<ul>` 与行 `<Link>`）

**Interfaces:**
- Consumes: `--ease-fude`、`--ease-sumi`、`--transition-duration-sumi`（Task 1）
- Produces: `ink-divide`（容器类，替代 `divide-y`）与 `ink-row`（行类）

- [ ] **Step 1: 先确认三处容器的现状**

Run:
```bash
cd /Users/i/Code/th/apps/web
grep -n 'divide-y' app/components/discussion/PostList.tsx app/routes/shrine/topic-list.tsx app/routes/kourindou/list.tsx
```
把输出记进报告——后面每一处都要对上号。

- [ ] **Step 2: 加两条规则**

在 `apps/web/app/app.css` 的 `@layer components { … }` 内、`.markdown` 那一大段**之后**（仍在该 layer 内）插入：

```css
  /* 墨界线：替代 divide-y 的硬线。两端渐隐，像墨在纸上洇开又淡去。
     用 border-image 而不是 ::after，是为了不占用列表项的伪元素——
     PostList 的 <li> 后面可能还要挂别的东西。 */
  .ink-divide > * + * {
    border-top: 1px solid transparent;
    border-image: linear-gradient(
        to right,
        transparent 0,
        var(--border) 8%,
        var(--border) 92%,
        transparent 100%
      )
      1;
  }

  /* 列表行落笔：左缘一道朱线由上至下画出来。
     用 scaleY + transform-origin 而不是改 width/height——只动 transform，
     不触发 layout。密度高的数据视图（data-density=compact）里行高只有 80px，
     整行位移会让扫读失焦，所以**不做**任何行位移。 */
  .ink-row {
    position: relative;
  }
  .ink-row::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: 2px;
    background: var(--primary);
    transform: scaleY(0);
    transform-origin: 50% 0;
    transition: transform var(--transition-duration-sumi) var(--ease-fude);
  }
  .ink-row:hover::before,
  .ink-row:focus-visible::before,
  .ink-row:has(:focus-visible)::before {
    transform: scaleY(1);
  }
```

- [ ] **Step 3: 三处容器换用 `ink-divide`**

逐处把 `divide-y` 换成 `ink-divide`，**保留同一串里的 `border-y` 等其他类**。Step 1 的 grep 输出里有几处就改几处。

- [ ] **Step 4: 香霖堂列表行加 `ink-row`**

`apps/web/app/routes/kourindou/list.tsx` 里那个行 `<Link>`：

```tsx
                <Link
                  to={localizeHref(`/kourindou/${r.slug}`)}
                  className="flex items-center gap-4 py-3 transition-colors hover:bg-muted/50"
                >
```

改成

```tsx
                <Link
                  to={localizeHref(`/kourindou/${r.slug}`)}
                  className="ink-row flex items-center gap-4 py-3 pl-3 transition-colors hover:bg-muted/50"
                >
```

（加 `pl-3` 给朱线让出位置，否则它会压在封面缩略图上。）

- [ ] **Step 5: 降级**

在文件末尾那个**不分层的** reduced-motion 块内追加：

```css
  /* 朱线的「画出来」是笔势，减弱动效下直接给终态：一步到位，不做过渡 */
  .ink-row::before {
    transition: none;
  }
```

墨界线本身是静态的，不需要降级。

- [ ] **Step 6: 构建 + 门禁 + 单测**

Run: `cd /Users/i/Code/th && (cd apps/web && bun run build >/dev/null 2>&1) && bun run check && bun run typecheck && bun run check-css-layers && (cd apps/web && bun test)`
Expected: 全绿，13 个单测仍通过

- [ ] **Step 7: 浏览器实测**

用 Browser pane：

```js
// 墨界线：第二个列表项应当有渐变 border-image
const list = document.querySelector('.ink-divide')
const second = list?.children[1]
// 朱线：常态 scaleY(0)
const row = document.querySelector('.ink-row')
const before = row ? getComputedStyle(row, '::before') : null
JSON.stringify({
  inkDivideFound: !!list,
  secondItemBorderImage: second ? getComputedStyle(second).borderImageSource.slice(0, 60) : null,
  inkRowFound: !!row,
  restTransform: before?.transform,
  width: before?.width,
  background: before?.backgroundColor,
})
```
Expected: `secondItemBorderImage` 含 `linear-gradient`；朱线常态 `transform` 为 `matrix(1, 0, 0, 0, 0, 0)`（scaleY(0)）、`width` 为 `2px`。

再验密度视图没被撑坏：`resize_window` 到 `mobile`，`navigate` 到 `/kourindou`，确认 `document.documentElement.scrollWidth <= clientWidth`（无横向溢出）。

- [ ] **Step 8: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css apps/web/app/components/discussion/PostList.tsx apps/web/app/routes/shrine/topic-list.tsx apps/web/app/routes/kourindou/list.tsx
git commit -m "$(cat <<'EOF'
feat(web): 墨界线与列表行朱线

divide-y 的硬线换成两端渐隐的墨界线（border-image 渐变，不占用列表项伪元素）。
列表行 hover/focus 时左缘由上至下画出一道朱线，走笔的匀速曲线。

刻意不做行位移：data-density=compact 的数据视图行高只有 80px，整行动会让
扫读失焦。只动 transform，不触发 layout。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `#pN` 落点的墨洇

锚点入口有四个：楼层自链接、引用块指向被引楼层、分页 href、深链 `?floor=137#p137`。落地后除了 `scroll-mt-20` 的偏移，页面对「你现在停在第几楼」零提示。

**为什么用 CSS `:target` 而不是 JS**：原生 hash 跳转发生在浏览器解析文档时，**早于 React 水合**，那个瞬间任何 JS 组件都还不存在、接不住；而 `:target` 是浏览器自己维护的状态，跨页深链、前进后退、手动改地址栏全都覆盖。

**必须避开的坑**：分页 href 是 `?floor=51#p51`，裸 `:target` 会在**每次翻页**给当页第一楼闪一下，而那一楼什么也没发生——纯噪音。

**控制者裁定（本任务的核心设计决定）**：`:target` 只服务「同页内的引用锚点与楼层自链接」，翻页落点不给提示。实现手段是**把翻页链接的 hash 与楼层 id 错开**：让分页链接指向列表容器而不是第一楼。

**Files:**
- Modify: `apps/web/app/app.css`（`@layer components` 内新增 `@keyframes` 与 `:target` 规则）
- Modify: `apps/web/app/components/discussion/Discussion.tsx`（`hrefFor` 的 hash）
- Modify: `apps/web/app/components/discussion/PostList.tsx`（给 `<ol>` 一个 id 作为翻页落点）

**Interfaces:**
- Consumes: `--ease-sumi`（Task 1）
- Produces: 无

- [ ] **Step 1: 加墨洇动画**

在 `apps/web/app/app.css` 的 `@layer components` 内追加：

```css
  /* 落点墨洇：一滴墨落在这一楼上，然后洇开淡去。
     只动 background-color（合成友好），不动布局。

     用 :target 而不是 JS：原生 hash 跳转发生在浏览器解析文档时、早于 React
     水合，那一刻 motion 组件还不存在、接不住；而 :target 是浏览器自己维护的
     状态，跨页深链、前进后退、手动改地址栏全覆盖。 */
  @keyframes ink-bloom {
    from {
      background-color: color-mix(in oklab, var(--primary) 12%, transparent);
    }
    to {
      background-color: transparent;
    }
  }
  .markdown-anchor:target,
  li[id^="p"]:target {
    animation: ink-bloom 1.2s var(--ease-sumi);
    border-radius: var(--radius-md);
  }
```

- [ ] **Step 2: 给楼层列表一个翻页落点**

`apps/web/app/components/discussion/PostList.tsx`，把

```tsx
    <ol className="ink-divide border-y">
```

改成

```tsx
    <ol id="floors" className="ink-divide scroll-mt-20 border-y">
```

（Task 4 已把 `divide-y` 换成 `ink-divide`；这里在它基础上加 `id` 与 `scroll-mt-20`。）

- [ ] **Step 3: 翻页链接改指向容器**

`apps/web/app/components/discussion/Discussion.tsx` 的 `hrefFor`：

```tsx
  const hrefFor = (p: number) => {
    // 带 hash：ScrollRestoration 先处理 hash 再看 preventScrollReset，
    // 没有它翻页后视口停在原地，新一页的第一楼在上方 50 层之外
    const from = (p - 1) * page.pageSize + 1
    return `${pathname}?floor=${from}#p${from}`
  }
```

改成

```tsx
  const hrefFor = (p: number) => {
    /**
     * 带 hash：ScrollRestoration 先处理 hash 再看 preventScrollReset，
     * 没有它翻页后视口停在原地，新一页的第一楼在上方 50 层之外。
     *
     * hash 指向列表容器 `#floors` 而不是首楼 `#p{from}`：后者会让 `:target`
     * 的落点墨洇在**每一次翻页**给当页第一楼闪一下，而那一楼什么也没发生。
     * 墨洇只该服务「有人特意指向这一楼」——引用锚点与楼层自链接。
     */
    const from = (p - 1) * page.pageSize + 1
    return `${pathname}?floor=${from}#floors`
  }
```

- [ ] **Step 4: 降级**

在文件末尾那个不分层的 reduced-motion 块内追加：

```css
  /* 墨洇是颜色动画不是位移，前庭安全；但 1.2s 的持续变化对注意力敏感用户
     仍是干扰，压到一次极短的提示 */
  li[id^="p"]:target,
  .markdown-anchor:target {
    animation-duration: 1ms;
    background-color: color-mix(in oklab, var(--primary) 12%, transparent);
  }
```

- [ ] **Step 5: 构建 + 门禁**

Run: `cd /Users/i/Code/th && (cd apps/web && bun run build >/dev/null 2>&1) && bun run check && bun run typecheck && bun run check-css-layers && (cd apps/web && bun test)`
Expected: 全绿

- [ ] **Step 6: 浏览器实测（三条路径都要走）**

需要一个楼层数 > 1 的主题。用 Browser pane：

1. **引用锚点应当触发墨洇**：`navigate` 到 `http://localhost:3000/shrine/t/<id>#p1`，然后
```js
const el = document.querySelector('li[id^="p"]:target')
JSON.stringify({
  targetFound: !!el,
  targetId: el?.id,
  animationName: el ? getComputedStyle(el).animationName : null,
  animationDuration: el ? getComputedStyle(el).animationDuration : null,
})
```
Expected: `targetFound: true`、`animationName: "ink-bloom"`、`duration: "1.2s"`

2. **翻页落点不应触发墨洇**（本任务的核心）：
```js
const links = [...document.querySelectorAll('nav[aria-label="pagination"] a')].map(a => a.getAttribute('href'))
JSON.stringify({ pageHrefs: links, allPointToContainer: links.every(h => h.endsWith('#floors')) })
```
Expected: `allPointToContainer: true`，且**没有**任何一条以 `#p` 数字结尾

3. **翻页后视口仍然落到列表顶部**（不能为了避墨洇把滚动定位弄丢）：`navigate` 到某个 `?floor=51#floors`，确认 `document.getElementById('floors')` 存在且 `getBoundingClientRect().top` 在视口内（考虑 `scroll-mt-20` 的偏移，应当在 0–120px 之间）。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css apps/web/app/components/discussion/PostList.tsx apps/web/app/components/discussion/Discussion.tsx
git commit -m "$(cat <<'EOF'
feat(web): #pN 落点的墨洇，并避开翻页误触发

四个锚点入口（楼层自链接、引用块、分页、深链）落地后此前零提示。
用 CSS :target 而不是 JS：原生 hash 跳转早于 React 水合，那一刻组件还不
存在接不住；:target 是浏览器自己维护的状态，深链/前进后退/改地址栏全覆盖。

顺带避掉一个坑：分页 href 原本是 ?floor=51#p51，裸 :target 会在每次翻页
给当页第一楼闪一下，而那一楼什么也没发生。改成指向列表容器 #floors，
墨洇只服务「有人特意指向这一楼」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 青海波远层视差

站点最具辨识度的一处。**近层不动，远层滚动驱动。**

- **近层** = 现有 `body::before`（44×22，`app.css` 的 `@layer base`）：**一行不改，永远不动**。它是纸自己的纤维肌理——纸不流动。这同时保证无 JS 时观感与今天完全一致，也永远不会碰到那个还挂着 `--bg-image` 槽位的规则。
- **远层** = `body::after`（**目前是空的，零新增 DOM**），图案 88×44、对比度再降一半。它是画在纸上的水——水才流动。

**为什么是滚动驱动而不是空闲循环**（三位评审一致）：卡片与 header 全挂 `backdrop-filter: blur(10px)`，底层每变一帧，上面每张半透明卡都要重算模糊。滚动时浏览器本来就在为 sticky header 与 blur 卡重算合成，波是**搭便车**；页面静止时波也静止，**静止开销严格为 0**。这同时是最好的前庭安全性质：用户停手，动就停。

**必须用 `@supports` 包住（这是本任务最容易出错的地方）**：不支持 `animation-timeline` 的浏览器会**忽略该属性但照常把 `animation` 当成基于时间的动画跑**——那正好变成被否决的空闲循环。`@supports` 守卫之后，不支持的浏览器（约 13%）得到一个静止的远层，与 reduced-motion 下的表现一致，是可接受的降级。

**与 spec 的一处刻意偏离**：spec §4.3 写的是 `位移 = scrollY × 0.06`（速率）。原生 scroll timeline 把动画进度**归一化到滚动范围**，表达不了固定速率。改为「整页滚动范围内恰好漂移一个远层周期（44px）」——这保证首尾无缝，代价是漂移速率随页面长度变化。这是我做的取舍，不是实现者的偏离。

**Files:**
- Modify: `apps/web/app/app.css`

**Interfaces:**
- Consumes: `--wave-period`（Task 1）、现有的 `--bg-pattern`
- Produces: 无

- [ ] **Step 1: 远层图案变量**

远层必须**重写 stop**，不能靠 `background-size` 放大近层图案——放大会同时放大线宽，读作模糊而非远景。

在 `apps/web/app/app.css` 的 `:root { … }` 内、`--bg-pattern: …` 那一条**之后**插入：

```css
  /* 青海波远层：同一母题的第二个尺度（2×），线宽不变、对比度再降一半。
     两个不同尺度的波列同向异速滚动会产生缓慢的莫尔/视差——这是真实水面的
     深度线索，也是唯一一个「一眼认出这是那个站」的东西。 */
  --bg-pattern-far: radial-gradient(
    circle at 50% 100%,
    transparent 18px,
    oklch(0.26 0.018 45 / 0.025) 18px 20px,
    transparent 20px 30px,
    oklch(0.26 0.018 45 / 0.025) 30px 32px,
    transparent 32px 42px,
    oklch(0.26 0.018 45 / 0.025) 42px 44px,
    transparent 44px
  );
```

在 `.dark { … }` 内、它的 `--bg-pattern` **之后**插入深色版：

```css
  --bg-pattern-far: radial-gradient(
    circle at 50% 100%,
    transparent 18px,
    oklch(0.92 0.012 84 / 0.028) 18px 20px,
    transparent 20px 30px,
    oklch(0.92 0.012 84 / 0.028) 30px 32px,
    transparent 32px 42px,
    oklch(0.92 0.012 84 / 0.028) 42px 44px,
    transparent 44px
  );
```

- [ ] **Step 2: 远层元素**

在 `apps/web/app/app.css` 的 `@layer base { … }` 内、现有 `body::before { … }` 规则**之后**插入：

```css
  /* 青海波远层。挂 body::after——它目前是空的，所以零新增 DOM。
     z-index 比近层再低一层，永远在内容之下。
     上下各出血 24px：位移最多一个周期（44px），出血保证边缘不会露白。 */
  body::after {
    content: "";
    position: fixed;
    inset: -24px 0;
    z-index: -2;
    pointer-events: none;
    background-image: var(--bg-pattern-far);
    background-size: 88px 44px;
    background-repeat: repeat;
    /* 常驻图层提升：全屏图层约 8MB 显存，painted 一次之后只做合成。
       比 will-change 的开/关更稳——后者会在滚动开始那一帧创建/销毁图层，
       正好把抖动放在最不能抖的时刻。 */
    transform: translate3d(0, 0, 0);
  }
```

- [ ] **Step 3: 滚动驱动的漂移**

在 `apps/web/app/app.css` **文件末尾**、那个不分层的 reduced-motion 块**之前**插入：

```css
/* 青海波远层的滚动驱动漂移。
   **必须用 @supports 包住**：不支持 animation-timeline 的浏览器会忽略该属性、
   却照常把 animation 当成基于时间的动画跑——那就变成了空闲循环，页面静止时
   持续让每张 backdrop-filter 卡重算模糊，正是我们要避免的东西。
   支持度：Chrome/Edge 115+、Safari 26+（含 iOS）、Firefox 158+，约 87%。
   其余浏览器得到一个静止的远层，与 reduced-motion 下表现一致，可接受。

   与 spec §4.3 的一处刻意偏离：spec 写的是「位移 = scrollY × 0.06」这样的
   固定速率，而原生 scroll timeline 把进度归一化到滚动范围，表达不了速率。
   改为「整页滚动范围内恰好漂移一个远层周期（44px）」——首尾无缝，代价是
   漂移速率随页面长度变化。 */
@keyframes wave-drift {
  to {
    /* 远层周期是近层的两倍（88×44 对 44×22），所以位移一个远层周期
       = --wave-period × 2。写成 calc 而不是字面 44px，改 token 时不会漏。 */
    transform: translate3d(0, calc(var(--wave-period) * -2), 0);
  }
}

@supports (animation-timeline: scroll()) {
  @media not (prefers-reduced-motion: reduce) {
    body::after {
      animation: wave-drift linear both;
      animation-timeline: scroll(root block);
    }
  }
}
```

**注意**：`@media not (prefers-reduced-motion: reduce)` 而不是把它塞进文件末尾那个降级块——因为这里要**禁用**而不是覆盖属性，写成否定媒体查询更直接。这不违反「降级规则集中」的约定：那条约定针对的是**变量归零**类的覆盖。

- [ ] **Step 4: 构建 + 断言 `@supports` 守卫在**

Run:
```bash
cd /Users/i/Code/th/apps/web && bun run build >/dev/null 2>&1
C=$(ls -t build/client/assets/*.css | head -1)
echo "--- 远层元素 ---"; grep -c 'bg-pattern-far' $C
echo "--- @supports 守卫（必须有，且 animation-timeline 只出现在它里面）---"
grep -o '@supports (animation-timeline:scroll())' $C | head -1
echo "--- 裸的 animation-timeline 出现次数（守卫之外不该有）---"
grep -o 'animation-timeline' $C | wc -l
```
Expected: `bg-pattern-far` ≥ 2（浅色 + 深色）；`@supports` 出现；`animation-timeline` 总计出现 2 次（`@supports` 条件里一次、规则里一次）——若多于 2，说明有一处没被守卫包住，**停下来修**。

- [ ] **Step 5: 浏览器实测**

用 Browser pane：

```js
const after = getComputedStyle(document.body, '::after')
const before = getComputedStyle(document.body, '::before')
JSON.stringify({
  farLayerPresent: after.content === '""' || after.content === 'none' ? after.content : after.content,
  farSize: after.backgroundSize,
  farZ: after.zIndex,
  nearSize: before.backgroundSize,       // 近层必须一字未改
  nearZ: before.zIndex,
  supportsScrollTimeline: CSS.supports('animation-timeline', 'scroll()'),
  farAnimation: after.animationName,
})
```
Expected: 远层 `backgroundSize: "88px 44px"`、`zIndex: "-2"`；**近层仍是 `"cover, 44px 22px"` 与 `"-1"`（一字未改）**；若 `supportsScrollTimeline` 为 true 则 `farAnimation` 为 `wave-drift`，否则为 `none`。

再验静止时零开销：滚动到底再停住，确认动画的 `currentTime` 不再变化——scroll timeline 天然如此，但要确认没有别的东西在跑：
```js
JSON.stringify(document.getAnimations().map(a => ({ n: a.animationName, tl: a.timeline?.constructor?.name })))
```
Expected: 若有 `wave-drift`，它的 timeline 是 `ScrollTimeline` 而**不是** `DocumentTimeline`。**这条是本任务最关键的断言**——`DocumentTimeline` 意味着它退化成了时间驱动的空闲循环。

- [ ] **Step 6: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css
git commit -m "$(cat <<'EOF'
feat(web): 青海波远层滚动驱动视差

近层（body::before，44×22）是纸自己的纤维肌理，纸不流动——一行不改，永远不动，
无 JS 时观感与今天完全一致。远层挂 body::after（原本是空的，零新增 DOM），
图案 88×44、对比度再降一半，是画在纸上的水。两个尺度同向异速产生真实视差。

滚动驱动而不是空闲循环：卡片与 header 全挂 backdrop-filter，底层每变一帧
上面每张卡都要重算模糊。滚动时浏览器本来就在重算合成，波是搭便车；页面
静止时波也静止，静止开销严格为 0，前庭安全性也最好——用户停手，动就停。

必须用 @supports 包住：不支持 animation-timeline 的浏览器会忽略该属性却
照常把 animation 当成时间驱动动画跑，那正好变成被否决的空闲循环。

与 spec §4.3 的刻意偏离：原生 scroll timeline 把进度归一化到滚动范围，
表达不了「scrollY × 0.06」的固定速率，改为整页滚动漂移一个周期（首尾无缝）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 跨页转场（原生 View Transition）

**为什么不是 AnimatePresence**：RR8 的默认行为是 **loader 完成后才提交新 location**，所以「出场动画」没有自然的时机窗口。原生 View Transition 由浏览器在状态更新前后各截一次快照，天然解决这个问题，且是 **0 KB**。

**Files:**
- Modify: `apps/web/app/app.css`（`::view-transition` 曲线，**不进任何 `@layer`**）
- Modify: `apps/web/app/components/site-header.tsx`（导航 `NavLink` 加 `viewTransition` 与 `prefetch`）
- Modify: `apps/web/app/components/mobile-nav.tsx`（同上）
- Modify: `apps/web/app/components/board-nav.tsx`、`apps/web/app/routes/home.tsx`（模块/版块入口卡的 `Link`）
- Modify: `apps/web/app/routes/kourindou/list.tsx`（资源行 `Link`）

**Interfaces:**
- Consumes: `--ease-sumi`、`--transition-duration-washi-lg`（Task 1）
- Produces: 无

- [ ] **Step 1: `::view-transition` 曲线**

在 `apps/web/app/app.css` **文件末尾**（在 Task 6 的 `@supports` 块之后、reduced-motion 块之前）插入：

```css
/* 跨页转场。
   **不进任何 @layer**：view transition 伪元素在 UA origin，包进 layer 会被
   优先级问题吃掉。

   交叉淡入用墨的曲线（这是颜色/不透明度类）。刻意**不做方向性转场**——
   Firefox 首版实现不含 view transition types，靠 types 做方向的方案在那里
   会静默退化成无方向，两套观感反而更糟。 */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: var(--transition-duration-washi-lg);
  animation-timing-function: var(--ease-sumi);
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

**注意这里用 `animation: none !important` 是对的**，与 T0 立下的「不能用 `animation: none`」不冲突：那条约定针对的是 **Radix 弹层**（靠 `animationend` 卸载，掐掉动画会卡住）。View transition 的伪元素由浏览器管理，没有 `animationend` 依赖，掐掉即立即完成。

- [ ] **Step 2: 桌面导航加 `viewTransition` 与 `prefetch`**

`apps/web/app/components/site-header.tsx` 里那个 `NavLink`，在 `to={localizeHref(item.path)}` 之后加两个 prop：

```tsx
              viewTransition
              prefetch="intent"
```

**`prefetch="intent"` 是转场的一半**：它把「没有出场窗口」这个问题缩小到不需要出场——鼠标悬停即预取，loader 往返在用户点击前就开始了。

- [ ] **Step 3: 移动抽屉同样处理**

`apps/web/app/components/mobile-nav.tsx` 里那个 `NavLink`，同样加 `viewTransition` 与 `prefetch="intent"`。

- [ ] **Step 4: 三处入口卡加 `viewTransition`**

- `apps/web/app/routes/home.tsx`：包着 `<Card>` 的那个 `<Link>`
- `apps/web/app/components/board-nav.tsx`：包着 `<Card>` 的那个 `<Link>`
- `apps/web/app/routes/kourindou/list.tsx`：资源行 `<Link>`

三处都加 `viewTransition`。**资源行不加 `prefetch="intent"`**——一屏几十行，悬停预取会打出大量请求。

- [ ] **Step 5: 构建 + 门禁**

Run: `cd /Users/i/Code/th && (cd apps/web && bun run build >/dev/null 2>&1) && bun run check && bun run typecheck && bun run check-css-layers && (cd apps/web && bun test)`
Expected: 全绿

Run:
```bash
cd /Users/i/Code/th/apps/web && C=$(ls -t build/client/assets/*.css | head -1)
grep -c 'view-transition' $C
```
Expected: ≥ 2

- [ ] **Step 6: 浏览器实测**

用 Browser pane：

```js
JSON.stringify({
  browserSupports: typeof document.startViewTransition === 'function',
  navLinksHaveVT: [...document.querySelectorAll('header nav a')].length,
})
```

再验转场真的发生了——用一个 `startViewTransition` 的探针 hook：
```js
let fired = false
const orig = document.startViewTransition?.bind(document)
if (orig) document.startViewTransition = (cb) => { fired = true; return orig(cb) }
document.querySelector('header nav a[href="/kourindou"]').click()
await new Promise(r => setTimeout(r, 1500))
if (orig) document.startViewTransition = orig
JSON.stringify({ url: location.pathname, viewTransitionFired: fired })
```
Expected: `url: "/kourindou"`、`viewTransitionFired: true`

**若 `viewTransitionFired` 为 false 但 URL 变了**：确认这个浏览器 `document.startViewTransition` 是否存在（旧版可能没有）。存在却没触发，说明 `viewTransition` prop 没生效，**报告**。

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/app.css apps/web/app/components/site-header.tsx apps/web/app/components/mobile-nav.tsx apps/web/app/components/board-nav.tsx apps/web/app/routes/home.tsx apps/web/app/routes/kourindou/list.tsx
git commit -m "$(cat <<'EOF'
feat(web): 跨页转场用 RR8 原生 viewTransition（0 KB）

不用 AnimatePresence：RR8 是 loader 完成后才提交新 location，所以出场动画
没有自然的时机窗口。原生 View Transition 由浏览器前后各截一次快照，天然
解决这个问题，且不花一个字节。

配 prefetch="intent"——它把「没有出场窗口」缩小到不需要出场：悬停即预取，
loader 往返在点击前就开始了。资源行不加，一屏几十行会打出大量请求。

刻意不做方向性转场：Firefox 首版不含 view transition types，靠 types 做方向
在那里会静默退化，两套观感反而更糟。

::view-transition 规则不进任何 @layer——伪元素在 UA origin，包进 layer 会被
优先级问题吃掉。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 全局 pending 墨线

RR8 的每一次导航都要等 loader 往返，期间页面完全静止。这是全站唯一一处「不确定时长」的等待。

**本期用纯 CSS 做**（T3 再评估要不要为「可中断接管」付 16 KB）。

**Files:**
- Create: `apps/web/app/components/pending-bar.tsx`
- Modify: `apps/web/app/app.css`（`@layer components` 内加动画）
- Modify: `apps/web/app/components/site-header.tsx`（挂进 header 内部）

**Interfaces:**
- Consumes: `--ease-fude`、`--primary`
- Produces: `<PendingBar />`

- [ ] **Step 1: 加动画**

在 `apps/web/app/app.css` 的 `@layer components` 内追加：

```css
  /* 全局 pending 墨线：一道朱线从左缘运笔展开，逼近但不到达右端。
     时长未知，所以用一条先快后极慢的曲线让它「永远在接近完成」。
     纯 CSS 无限接近 + 到达时整条淡出，比手写百分比更省。 */
  @keyframes ink-progress {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(0.9);
    }
  }
  .pending-bar {
    position: absolute;
    inset-inline: 0;
    bottom: -1px;
    height: 2px;
    background: var(--primary);
    transform-origin: 0 50%;
    transform: scaleX(0);
    opacity: 0;
    pointer-events: none;
  }
  .pending-bar[data-pending="true"] {
    opacity: 1;
    /* 150ms 延迟阈值：快网下每次点击都闪一道比没有更烦 */
    animation: ink-progress 8s var(--ease-fude) 0.15s both;
    transition: opacity var(--transition-duration-sumi) var(--ease-sumi);
  }
```

- [ ] **Step 2: 组件**

创建 `apps/web/app/components/pending-bar.tsx`：

```tsx
import { useNavigation } from 'react-router'

/**
 * 全局导航 pending 指示。
 *
 * RR8 的每次导航都要等 loader 往返，期间页面完全静止——这是全站唯一一处
 * 「不确定时长」的等待。
 *
 * 纯 CSS：动画本身由 `.pending-bar[data-pending]` 驱动，这里只负责把
 * navigation.state 翻成一个 data 属性。到达时不做完成动画——让它随
 * View Transition 的旧快照一起淡出，比手写收尾更自然。
 *
 * **挂在 header 之内而不是 fixed 压在它上面**：header 有 backdrop-blur，
 * 是全站最贵的元素，进度条每帧变化都会触发它下方那条模糊带重算。
 */
export function PendingBar() {
  const navigation = useNavigation()
  const pending = navigation.state !== 'idle'
  return (
    <div
      className="pending-bar"
      data-pending={pending}
      aria-hidden="true"
    />
  )
}
```

**注意 `aria-hidden="true"`**：它是纯视觉的。读屏用户的路由播报是另一件事，不在本期范围（spec §7.3 记着）。

- [ ] **Step 3: 挂进 header**

`apps/web/app/components/site-header.tsx`：

(a) import 区加：

```ts
import { PendingBar } from '~/components/pending-bar'
```

(b) 把 `<header>` 加上 `relative`，并在它的**闭合标签之前**插入 `<PendingBar />`：

```tsx
    <header className="sticky top-0 z-40 border-b bg-background/85 relative backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:gap-6">
        …
      </div>
      <PendingBar />
    </header>
```

- [ ] **Step 4: 降级**

在文件末尾那个不分层的 reduced-motion 块内追加：

```css
  /* 进度条是「还在等」的唯一视觉信号，不能整条关掉。
     改为静止的一小段：位置固定，只靠出现/消失传达状态。 */
  .pending-bar[data-pending="true"] {
    animation: none;
    transform: scaleX(0.3);
  }
```

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && bun run check && bun run typecheck && bun run check-css-layers && (cd apps/web && bun test)`
Expected: 全绿

- [ ] **Step 6: 浏览器实测**

用 Browser pane：

```js
const bar = document.querySelector('.pending-bar')
const cs = bar ? getComputedStyle(bar) : null
JSON.stringify({
  found: !!bar,
  ariaHidden: bar?.getAttribute('aria-hidden'),
  restState: bar?.getAttribute('data-pending'),
  restOpacity: cs?.opacity,
  position: cs?.position,
  insideHeader: !!bar?.closest('header'),
})
```
Expected: `found: true`、`ariaHidden: "true"`、常态 `data-pending="false"` 且 `opacity: "0"`、`position: "absolute"`、`insideHeader: true`（**不能是 fixed，也不能在 header 之外**）

再验 pending 态真的会亮：点一个导航链接后立刻读：
```js
document.querySelector('header nav a[href="/shrine"]').click()
await new Promise(r => setTimeout(r, 60))
const bar = document.querySelector('.pending-bar')
JSON.stringify({ duringNav: bar?.getAttribute('data-pending'), opacity: getComputedStyle(bar).opacity })
```
Expected: 导航期间 `data-pending="true"`。（若网络太快抓不到，把 dev server 的响应人为放慢，或接受这条由代码审查覆盖并在报告里说明。）

- [ ] **Step 7: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/pending-bar.tsx apps/web/app/components/site-header.tsx apps/web/app/app.css
git commit -m "$(cat <<'EOF'
feat(web): 全局导航 pending 墨线

RR8 每次导航都要等 loader 往返，期间页面完全静止——全站唯一一处不确定时长
的等待。本期用纯 CSS 做：组件只把 navigation.state 翻成一个 data 属性，
动画由 CSS 驱动，一道朱线从左缘运笔展开、逼近但不到达右端。

带 150ms 延迟阈值：快网下每次点击都闪一道比没有更烦。
到达时不做完成动画——让它随 View Transition 的旧快照一起淡出。

挂在 header 之内而不是 fixed 压在它上面：header 有 backdrop-blur，是全站最贵
的元素，进度条每帧变化都会触发它下方那条模糊带重算。

reduced-motion 下不整条关掉（它是「还在等」的唯一信号），改为静止的一小段。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 首页 Hero 装饰层

首页现在是站点门面，但 hero 区极简到近乎空白：一个 `h1` 站名 + 一句 tagline，`py-20` 的空间全是留白。这是「氛围」最该发力的地方。

**内容层 / 装饰层契约在这里最吃紧**：`h1` 与 tagline 是内容层，**首帧零入场、禁止任何 `initial` 隐藏态**。氛围全部由装饰层承担。

**Files:**
- Create: `apps/web/app/components/hero-decor.tsx`
- Modify: `apps/web/app/app.css`（`@layer components` 内加装饰层规则）
- Modify: `apps/web/app/routes/home.tsx`

**Interfaces:**
- Consumes: `--ease-fude`、`--ease-sumi`、`--transition-duration-washi-lg`、`--bg-pattern-far`
- Produces: `<HeroDecor />`

- [ ] **Step 1: 装饰层规则**

在 `apps/web/app/app.css` 的 `@layer components` 内追加：

```css
  /* Hero 装饰层。整层是**装饰**不是内容——aria-hidden + pointer-events-none，
     所以可以自由入场（内容层的首帧零入场红线不适用于它）。

     三件东西：
     1) hero 区局部强化的青海波弧组（同一母题的第三个尺度）
     2) 一道朱红界线，由中心向两侧运笔展开
     3) 一枚无字的几何朱印 + 墨洇 */
  .hero-decor {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }

  /* 大尺度青海波：只在 hero 区，尺度是远层的两倍 */
  .hero-decor::before {
    content: "";
    position: absolute;
    inset-inline: -10%;
    bottom: 0;
    height: 60%;
    background-image: var(--bg-pattern-far);
    background-size: 176px 88px;
    background-repeat: repeat-x;
    opacity: 0;
    animation: hero-wash 1.2s var(--ease-sumi) 0.1s forwards;
  }
  @keyframes hero-wash {
    to {
      opacity: 1;
    }
  }

  /* 朱红界线：--ease-fude 唯一的正当用途（一笔画出来的几何延展） */
  .hero-rule {
    display: block;
    height: 1px;
    width: min(18rem, 60%);
    margin-inline: auto;
    background: linear-gradient(
      to right,
      transparent,
      var(--primary) 20%,
      var(--primary) 80%,
      transparent
    );
    transform: scaleX(0);
    animation: hero-stroke 0.52s var(--ease-fude) 0.25s forwards;
  }
  @keyframes hero-stroke {
    to {
      transform: scaleX(1);
    }
  }

  /* 落款朱印：一枚无字的几何印，墨洇式淡入 */
  .hero-seal {
    position: absolute;
    inset-inline-end: clamp(1rem, 8vw, 5rem);
    bottom: 15%;
    width: 3rem;
    height: 3rem;
    border: 2px solid var(--primary);
    border-radius: var(--radius-sm);
    opacity: 0;
    animation: hero-seal-ink 0.9s var(--ease-sumi) 0.5s forwards;
  }
  .hero-seal::before,
  .hero-seal::after {
    content: "";
    position: absolute;
    background: var(--primary);
  }
  .hero-seal::before {
    inset: 0.65rem 0.5rem;
    clip-path: polygon(0 0, 100% 0, 100% 22%, 0 22%, 0 44%, 100% 44%, 100% 66%, 0 66%);
  }
  .hero-seal::after {
    inset-block: 0.5rem;
    inset-inline-start: 50%;
    width: 2px;
    translate: -1px 0;
  }
  @keyframes hero-seal-ink {
    to {
      opacity: 0.75;
    }
  }
```

- [ ] **Step 2: 组件**

创建 `apps/web/app/components/hero-decor.tsx`：

```tsx
/**
 * 首页 hero 的装饰层。
 *
 * **整层是装饰不是内容**：aria-hidden + pointer-events-none，不承载任何信息。
 * 因此它可以自由入场——内容层「首帧零入场、禁止 initial 隐藏态」的红线不适用。
 * h1 与 tagline 仍然首帧即终态，无 JS 时照常完整可读。
 *
 * 纯 CSS 动画，没有一行 JS 在运行时跑。
 */
export function HeroDecor() {
  return (
    <div className="hero-decor" aria-hidden="true">
      <span className="hero-seal" />
    </div>
  )
}
```

- [ ] **Step 3: 接进首页**

`apps/web/app/routes/home.tsx`，把

```tsx
      <section className="py-20 text-center">
        <h1 className="text-5xl font-bold tracking-wide">{m.site_name()}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{m.home_tagline()}</p>
      </section>
```

改成

```tsx
      <section className="relative isolate py-20 text-center">
        <HeroDecor />
        <h1 className="text-5xl font-bold tracking-wide">{m.site_name()}</h1>
        <span className="hero-rule mt-6" />
        <p className="mt-6 text-lg text-muted-foreground">{m.home_tagline()}</p>
      </section>
```

并在 import 区加：

```ts
import { HeroDecor } from '~/components/hero-decor'
```

**`isolate` 不能漏**：装饰层是 `z-index: -1`，没有新的层叠上下文它会钻到 `body` 背景之下（那里已经有两层青海波）。

- [ ] **Step 4: 降级**

在文件末尾那个不分层的 reduced-motion 块内追加：

```css
  /* 装饰层的入场全部跳过，直接给终态——装饰不该是唯一在动的东西 */
  .hero-decor::before,
  .hero-seal {
    animation: none;
    opacity: 1;
  }
  .hero-seal {
    opacity: 0.75;
  }
  .hero-rule {
    animation: none;
    transform: none;
  }
```

- [ ] **Step 5: 门禁**

Run: `cd /Users/i/Code/th && (cd apps/web && bun run build >/dev/null 2>&1) && bun run check && bun run typecheck && bun run check-css-layers && (cd apps/web && bun test)`
Expected: 全绿

- [ ] **Step 6: SSR 红线断言（本任务最重要的一条）**

装饰层可以 `opacity: 0` 入场，**内容层绝对不行**。构建后起 server 抓首屏 HTML，断言 `h1` 与 tagline 上没有任何隐藏态：

```bash
cd /Users/i/Code/th/apps/web && bun run build >/dev/null 2>&1
PORT=3100 bun run start &
sleep 3
curl -s http://localhost:3100/ > /tmp/home-ssr.html
echo "--- h1 与 tagline 必须没有 opacity:0 / visibility:hidden ---"
grep -o '<h1[^>]*>' /tmp/home-ssr.html
grep -o 'style="[^"]*opacity:\s*0[^"]*"' /tmp/home-ssr.html | wc -l
echo "--- 站名文本必须在 HTML 里 ---"
grep -c '幻想乡' /tmp/home-ssr.html
kill %1
```
Expected: `<h1>` 上无 `style`；`opacity: 0` 的内联样式计数为 **0**；站名文本出现 ≥ 1 次。

**若 `opacity: 0` 计数不是 0**，停下来查是谁——内容层出现 SSR 隐藏态是本工程的红线。

- [ ] **Step 7: 浏览器实测**

```js
const decor = document.querySelector('.hero-decor')
const h1 = document.querySelector('main h1')
const rule = document.querySelector('.hero-rule')
JSON.stringify({
  decorAriaHidden: decor?.getAttribute('aria-hidden'),
  decorPointerEvents: getComputedStyle(decor).pointerEvents,
  decorZ: getComputedStyle(decor).zIndex,
  sectionIsolation: getComputedStyle(decor.parentElement).isolation,
  h1Opacity: getComputedStyle(h1).opacity,       // 必须是 "1"
  h1Transform: getComputedStyle(h1).transform,   // 必须是 "none"
  ruleAnimation: getComputedStyle(rule).animationName,
})
```
Expected: 装饰层 `aria-hidden: "true"`、`pointerEvents: "none"`、`zIndex: "-1"`、父级 `isolation: "isolate"`；**`h1Opacity: "1"` 且 `h1Transform: "none"`**（内容层零入场）；`ruleAnimation: "hero-stroke"`。

最后 `computer` 截一张图存档（`resize_window` 到 1280×900 之后），放进报告。

- [ ] **Step 8: 提交**

```bash
cd /Users/i/Code/th
git add apps/web/app/components/hero-decor.tsx apps/web/app/routes/home.tsx apps/web/app/app.css
git commit -m "$(cat <<'EOF'
feat(web): 首页 hero 装饰层——青海波弧组、朱红界线、落款朱印

hero 此前极简到近乎空白（一个 h1 + 一句 tagline，py-20 全是留白），
而它是站点门面。

内容层/装饰层契约在这里最吃紧：h1 与 tagline 首帧即终态、禁止任何 initial
隐藏态；氛围全部由装饰层承担——它 aria-hidden + pointer-events-none、
不承载任何信息，所以可以自由入场。纯 CSS，运行时零 JS。

朱红界线是 --ease-fude 唯一的正当用途（一笔画出来的几何延展）。

section 上的 isolate 不能漏：装饰层是 z-index:-1，没有新的层叠上下文会钻到
body 背景之下（那里已经有两层青海波）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 本期明确不做（spec 第八节的其余条目）

写在这里是为了让「没排进任务」是一个**决定**而不是一次遗漏。

**需要 motion，归 T3**（CSS 结构上做不到——节点已被 React 卸载，或需要可中断的补间）：

| spec 条目 | 为什么必须等 T3 |
|---|---|
| 神社「编辑态展开：翻纸」 | 三选一的分支切换要 `AnimatePresence` 的 exit，CSS 无从挂载已卸载的节点 |
| 神社「发帖成功后新楼层的出现」 | 需要命令式动画接住 `onPosted(floor)` 的时机（T0 已把数据通路打通，动效待 T3） |
| 香霖堂「筛选/翻页期间列表整体洇淡」 | 需要在 fetcher 状态之间做可中断过渡 |
| 香霖堂「上传向导步骤推进」 | 分步容器的进出需要 exit |
| `/dash` 队列与举报的条目退场 | `AnimatePresence` 的经典正当用途，且 `/dash` 只要功能性动效 |

**CSS 能做但本期刻意延后**（为了让 T2 保持可审查的体量，且它们都依赖本期先立起来的词汇）：

- 香霖堂封面显影（图片是天然的装饰层，可自由淡入）
- 香霖堂许可卡的掀角（`paper-lift` 已经就位，接上即可）
- 引用块的和纸质感
- 标题与楼层锚点的墨线（替换 `hover:underline`）

**明确永远不做**：内容层的逐条 stagger 入场（列表动辄几十条，SSR 首屏下是纯粹的退步）；跨路由的 `layoutId` 共享元素（与 `ScrollRestoration` 抢时序，且要拖进 `domMax`）。

---

## 收尾

- [ ] **全量门禁**

Run:
```bash
cd /Users/i/Code/th && \
  bun run check && bun run typecheck && bun run check-messages && \
  (cd apps/web && bun test) && \
  (cd apps/web && bun run build >/dev/null 2>&1) && bun run check-css-layers && \
  (cd apps/api && bun run e2e)
```
Expected: 全绿，e2e 40 通过 / 0 失败。**注意 `bun run e2e` 在根上不存在，必须在 `apps/api` 下跑**（根上跑会打印 "Script not found" 却仍然退出 0，很容易被静默放过）。

- [ ] **确认零新增依赖**

Run: `cd /Users/i/Code/th && git diff main --stat -- package.json apps/web/package.json bun.lock`
Expected: **空输出**。本期一个包都不该装。

- [ ] **更新 CLAUDE.md**

在「动效与样式约定」那一节内追加：

```markdown
  - 三材 token（墨・纸・水）在 `app.css` 的**不带 inline 的 `@theme`**：`--ease-sumi`（墨·洇，出现类颜色）/ `--ease-washi`（纸·落，transform 归位，**全域禁 overshoot**）/ `--ease-fude`（笔·运，只给「一笔画出来」的 scaleX）。水的 linear 是**禁令不是 token**。时长按纸的**尺寸**挑档（sm/md/lg），不按交互重要性
  - **跨页转场用 RR8 原生 `viewTransition`（0 KB），不用 AnimatePresence**——RR 是 loader 完成后才提交新 location，出场动画没有时机窗口。`::view-transition` 规则**不进任何 `@layer`**（伪元素在 UA origin）。不得依赖 view transition `types`（Firefox 首版没有）
  - **青海波近层（`body::before`）永远不动**，远层（`body::after`）走原生 scroll-driven animation。**必须用 `@supports (animation-timeline: scroll())` 包住**——不支持的浏览器会忽略该属性却照常把 `animation` 当成时间驱动动画跑，那就变成了空闲循环，会让每张 `backdrop-filter` 卡持续重算模糊
  - 装饰层（`aria-hidden` + `pointer-events-none`、不承载信息）可以自由入场；**内容层首帧即终态，禁止任何 `initial` 隐藏态，无例外**
```

- [ ] **提交收尾**

```bash
cd /Users/i/Code/th
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md 记下 T1–T2 立起来的四条动效约定

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 下一步

T1–T2 完成后，全站已有完整的三材质感、跨页转场与青海波视差，**且零新依赖**。

spec 第 11 节写明**这里是真实决策点**：先看观感，再决定 T3 是否继续。T3 要装 `motion`（+16.2 KB gzip，首屏 JS 159.9 → 176.1 KB），换来的只有两样 CSS 真做不到的东西——`AnimatePresence` 的 exit（列表增删时节点已被 React 卸载，CSS 无从挂载）与不确定时长的可中断 pending 接管。Task 8 的纯 CSS 版本已经覆盖了后者约 90% 的价值。
