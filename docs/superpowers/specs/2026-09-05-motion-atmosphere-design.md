# 和风纸境：全站动效层设计

**一句话**：给面向访客的页面铺一层「墨・纸・水」的氛围动效，用 CSS 承担材质、用浏览器原生 View Transition 承担跨页转场、用 motion 只承担这两者做不到的两类事，同时把动效踩到的既存缺陷一并修掉。

**上游决定**（2026-09-05 与站长确认，四问四答）：
1. 档位＝**全面视觉升级，动效当氛围**。不是「只做有信息价值的动效」。
2. 范围＝**面向访客的页全上**；`/dash` 只给功能性动效，不加装饰。
3. 语汇＝**和风纸境：墨、纸、青海波**。不走弹幕符卡路线。
4. 剂量＝**方案甲**，LazyMotion + `domAnimation` 异步，首屏 +16.2 KB gzip；既存缺陷**全修**，排在动效之前。

---

## 一、先说不做什么

- **不做逐条 stagger 入场**。列表动辄几十条，逐条错列在真实数据量下是退步。原提案里的 `--fude-speed` / `stagger.brush`（延迟＝行高÷笔速）设计得很漂亮，但它服务的是一个被禁止的场景，一并砍掉。
- **不装 `domMax`，因此不做 `layout` / `layoutId` / `drag`**。见第六节的能力缺失约定。
- **不做跨路由共享元素的 motion 版本**。RR8 是整棵子树替换 + `ScrollRestoration` 立即复位，`layoutId` 会出现「元素飞到一半、页面突然跳回旧滚动位」。共享元素改由原生 View Transition 承担（第七节）。
- **不做卡片微旋转**。原提案的 `--lift-tilt: 0.15deg` 被三位评审中的两位独立否决：在半透明 + `backdrop-filter: blur(10px)` 的卡片上做亚度数旋转会让 Noto Serif SC 的 CJK 字形重新栅格化、整卡发虚，而 0.15deg 本身看不见。掀角靠位移 + 折角三角就够。
- **不做「墨的退去比来时慢」**。原提案的 `--ease-sumi-in` + 420ms 慢退场在纸上是真的，在一个每天开关几十次的 dropdown 上会被读成卡顿；对状态反馈（focus ring、hover 底色）更是可访问性缺陷——快速 Tab 或快速划过 30 行列表时会有多个元素同时挂着残留态。改为状态一律对称，弹层消散降到 240ms。
- **不引入 token 代码生成器**。原提案的 `scripts/gen-motion-tokens.ts` 是三份里唯一真正消灭 CSS↔TS 漂移的做法，但为防一个数字漂移而引入一个构建步骤 + 一份生成产物，收益不抵心智成本。改为手写镜像 + 25 行一致性门禁脚本。
- **不做空闲循环的背景漂移**。见第五节：改为滚动驱动。
- **不给 `/dash` 加装饰动效**。它是审核员一天点几百下的工作界面。

---

## 二、实测事实

本节所有数字来自实际构建与实际运行，不是估算。任何后续争论以本节为准。

### 2.1 分母

| 项 | 值 |
|---|---|
| `/` 路由首屏 JS | **470.2 KB raw / 159.9 KB gzip**（26 个文件） |
| 含 CSS | 552.3 KB raw / 176.1 KB gzip |
| 大头 | `entry.client` 57.0 KB gz、`jsx-runtime` 28.2 KB gz、better-auth 相关 20.4 KB gz、`root.css` 12.3 KB gz |

`root.tsx` 是所有路由的父级，任何 import 进它的东西都会落进这 26 个文件，**不按路由分包**。

### 2.2 motion 体积（同一基线 react+react-dom 59.66 KB gzip，逐个变体 production 构建）

| 接法 | gzip 增量 | 占首屏 JS |
|---|---|---|
| 仅 `useReducedMotion` | +0.42 KB | +0.3% |
| `motion/mini` 的 `animate()` | +2.72 KB | +1.7% |
| **LazyMotion + `m` + 异步 features** | **+16.18 KB**（另切 14.14 KB 异步块） | **+10.1%** |
| LazyMotion + 同步 `domAnimation` | +27.42 KB | +17.1% |
| LazyMotion + `domMax` | +39.05 KB | +24.4% |
| 全量 `motion` 组件 | +40.77 KB | +25.5% |

交叉验证：`framer-motion` 包内自带官方基准 `dist/size-rollup-dom-animation.js` = 14,021 B gzip，与切出的异步块 14.14 KB 逐字节吻合；`size-rollup-motion.js` = 39,341 B gzip 与全量 +40.77 KB 吻合。

**异步 features 必须写成独立模块文件**。在同一文件里既静态 `import 'motion/react'` 又动态 import 它，rolldown 会报 `INEFFECTIVE_DYNAMIC_IMPORT` 并放弃分包，体积反而涨到 +41.5 KB。

### 2.3 SSR 红线（`renderToStaticMarkup` 实跑）

| 写法 | 服务端输出 |
|---|---|
| `initial={{opacity:0, y:8}}` | `<div style="opacity:0;transform:translateY(8px)">` — **文字在 DOM 里但视觉不可见，直到 JS 到达** |
| `initial={false}` | `<div style="opacity:1">` — **唯一安全的进场写法** |
| 外面包 `<MotionConfig reducedMotion="always">` | **仍然是 `opacity:0`** |
| `AnimatePresence`、`layout` 单独用 | `<div>x</div>` — 干净，SSR 安全 |
| `whileTap={{scale:.97}}` | `<div tabindex="0">` — **服务端就写进 HTML** |
| `whileHover` | `<div>x</div>` — 干净 |

推论一：**`MotionConfig reducedMotion` 是纯客户端的（读 `matchMedia`），对服务端输出零作用。「加了 MotionConfig 就安全了」是错的。**

推论二：`whileTap` 只能加在本来就在 Tab 顺序里的 `button` / `a` 上。加在列表行的包裹 div 上，等于给一屏几十行各插一个 Tab 停靠点。

### 2.4 `domAnimation` 的静默失效

构建「`<m.div layout>` 但 features 只给 `domAnimation`」的变体，产物 gzip 与不写 `layout` 的版本**完全相同**（86.95 KB）——projection 代码根本没打进去，`layout` prop 被无声吞掉，运行时不报错、不动画。

而 `domMax`（+39.05）与全量 motion（+40.77）只差 0.06 KB，**LazyMotion 在布局动画这条路上零收益**。中间态最危险：省了体积，但某天有人加了个 `layout` 就永远查不出为什么不动。

**本设计选择让这个能力缺失，见第六节。**

### 2.5 Tailwind v4 的 token 解析（读 `tailwindcss@4.3.3/dist/lib.mjs`）

- `duration-*` 从主题命名空间 **`--transition-duration-*`** 解析（不是 `--duration-*`），命中后同时写 `--tw-duration` 与 `transition-duration`
- `ease-*` 从 **`--ease-*`** 解析，同时写 `--tw-ease` 与 `transition-timing-function`
- `tw-animate-css@1.4.0` 的 `--animate-in` 定义是 `enter var(--tw-animation-duration, var(--tw-duration,.15s)) var(--tw-ease, ease) …`
- `theme.css:492-493` 出厂值为 `150ms` / `cubic-bezier(0.4,0,0.2,1)`

**红利**：一条 `@theme` 命名空间同时喂饱三个消费者——工具类、tw-animate-css 给 Radix 的 keyframes、以及裸 `transition-colors`。改 `--default-transition-duration` / `--default-transition-timing-function` 两行，现存 12 处裸 `transition-colors` **零 diff** 全部改用墨的曲线。

### 2.6 React Router 8.3.1 原生 View Transition（读 `dist/production/` 类型定义）

- `viewTransition?: boolean` 出现在 `LinkProps`（`lib/dom/lib.d.ts:877`）、`NavLinkProps`（`:1029`）、`FormProps`（`:1264`）、`SubmitOptions`（`lib/dom/dom.d.ts:116`）、`NavigateOptions`（`lib/context.d.ts:42`）
- `useViewTransitionState` 从 `index.d.ts:44` 的导出清单里**不带 `unstable_` 前缀**导出，实现在 `lib/dom/lib.js:1276`
- `NavLink` 的 render props 有 `isTransitioning`（`lib.d.ts:1024`），并在 className 里输出 `transitioning` 类（`lib.js:402`）
- 类型注释原文：把最终的状态更新包进 `document.startViewTransition()`

浏览器支持：**同文档 view transitions 于 2025-10-14 成为 Baseline newly available**（Firefox 144 补齐）。RR 走的正是同文档路径。跨文档的 `@view-transition` at-rule 仍未进 Baseline，但 RR 水合后是 SPA，用不着。**Firefox 首版实现不含 view transition types，所以方向性转场不得依赖 `types`。**

### 2.7 测试与部署

- `bun run e2e` 的真身是 `apps/api/scripts/e2e.ts`，`import { app }` 后用 `app.request('/api/...')` 直接打 Hono 实例。**524 行、40 项断言，全在 HTTP 层，没有浏览器、没有 DOM。动效对它的影响是 0。**
- 仓库零 playwright / puppeteer / vitest / @testing-library。`apps/web` 的 scripts 里没有 `test`。**没有任何自动化能发现「首屏内容不可见」「reduced-motion 失效」。**
- SSR **不需要** `ssr.noExternal`：RR8 的 server 构建默认外置 node_modules（已在现有 `build/server/index.js` 中核实为裸 specifier 保留态），`motion@13.2.0` 的 `./react` 是 721 字节的纯 ESM re-export。
- `motion` 与 `framer-motion` 当前同为 **13.2.0**，`motion` 的 dependencies 是 `framer-motion: ^13.2.0`。**只装 `motion`，两个都写进 package.json 才可能被 caret 解析出两份**，届时 LazyMotion 的 strict 模式会因为两个 MotionContext 报错。
- 磁盘：framer-motion 5.6 MB + motion-dom 4.6 MB + motion-utils 312 KB ≈ **11.3 MB** 未压缩进 node_modules 层。`deploy/Dockerfile:71` 把整棵 node_modules 拷进运行镜像。
- `deploy/Dockerfile:30` 是 `bun install --frozen-lockfile`：**改 package.json 不提交 bun.lock 会让生产构建直接失败**。
- `motion` 放 `apps/web` 的 **dependencies**（运行时真的解析它）。

---

## 三、既存缺陷（T0，排在动效之前）

动效踩在这些之上，不修就是给坏掉的东西化妆。

| # | 缺陷 | 证据 | 为什么挡动效 |
|---|---|---|---|
| 1 | **移动端完全没有导航** | `site-header.tsx:55` 是 `hidden md:flex`；全仓 `md:hidden` / `Sheet` / `Drawer` 零命中；`components/ui/` 下无抽屉原语 | <768px 的用户看不到五个模块入口中的任何一个。门面在手机上根本进不去，此时任何触屏动效都是在给一扇不存在的门装合页 |
| 2 | **超过 50 层的主题，回复后不出现在任何地方** | `discussion-action.ts:57` 返回 `{ok, intent, floor}`，被 `PostForm.tsx:28` 的 `Result` 类型丢弃；`post.ts:130` 把无 `?floor=` 的请求吸附到 `from=1`，`POSTS_PAGE_SIZE=50` | 「发帖成功后新楼层的出现」整条方案以此为前提。不修就是给一个不会发生的事件配缓动 |
| 3 | **`.markdown` 是个空 class** | `app.css` 全文无 `.markdown` 规则、未装 typography 插件、`shadcn/tailwind.css` 里也没有；`Markdown.tsx:135` | 正文的引用/标题/列表/表格全被 preflight 抹平。`PostForm.tsx:189` 的「❝」按钮产出不可见的格式。「纸」这个语汇在正文里无从谈起 |
| 4 | **香霖堂列表没有分页控件** | loader 收 `page`、`Filter` 会 `next.delete('page')`、API 返回 `page/pageSize/total`（`pageSize` 默认 20、上限 100），但 `list.tsx:143-194` 只渲染 `items` | 第 21 条资源 UI 上不可达。仓库已有 `components/ui/pagination.tsx` 且 `Discussion.tsx:98` 正在用 |
| 5 | **卡片 hover 是空操作** | `card.tsx:15` 只有 `ring-1 ring-foreground/10`，无任何 border 宽度工具类；`tailwindcss@4.3.3/preflight.css:15` 是 `border: 0 solid` | `home.tsx:33` 首页五张模块卡的 `hover:border-primary/50`、`board-nav.tsx:26` 六版块卡的 hover **和**「当前版块」的 `border-primary`，**全部无效**。这正是本次要做掀角的两个网格 |
| 6 | **正文图片无尺寸预留** | `Markdown.tsx:109` 的 `img` 只有 `loading="lazy"` + `max-h`，无 `width`/`height`/`aspect-ratio` | 图片到达即抖动。这是站内一半布局跳变的共同源头；修完，多条「需要动效掩盖跳变」的提案自动消失 |
| 7 | **`prefers-reduced-motion` 全站零覆盖** | `app.css` 206 行里 0 处；构建产物里唯一一处来自未使用的 `tw-animate-css` `.shimmer` | 现有 Radix 弹层动效、`skeleton` 的 `animate-pulse`、18 处 `transition-*` 对减弱动效用户全部照播。**这条独立于要不要上 motion，现在就该做** |
| 8 | **主题图标首帧闪错** | `theme-toggle.tsx` 是 `useState(false)` + `useEffect` 读 DOM class；SSR 恒渲染 Moon，水合后才翻转 | 深色用户每次刷新都看到月亮闪成太阳。修好之前不许给图标加任何交换动画 |

**修法一律不引入新依赖**，除第 1 条需要一个抽屉（用 `radix-ui` 已有的 Dialog 做侧滑，不新增包）。

---

## 四、动效语汇：三材 Sanzai

三份独立提案经设计师 / 工程师 / 无障碍三视角评审，2:1 选出「三材」，并带三处强制修正落地。

选它的核心理由：另两份提案都把 `cubic-bezier(0.16, 1, 0.3, 1)` 命名为「墨」——那是 easeOutExpo 家族、2023 年以来全网最常见的那条曲线，实测对 √t 的 RMSE 是 **0.219**（不是拟合得差，是根本无关），实际形状是「25% 时间走完 82.6%」，即猛地弹到位然后爬。与本次点名要的「长而软」相反。

### 4.1 缓动曲线

| token | 值 | 依据 | 用在哪 |
|---|---|---|---|
| `--ease-sumi`（墨·洇） | `cubic-bezier(0, .408, .501, .75)` | Lucas–Washburn 毛细渗透 L ∝ √t，RMSE 0.0001。前 10% 走完 32%、前 25% 走完 50%，之后极长的尾 | 一切**出现类**的颜色/不透明度：hover 底色、ring 变色、focus ring、badge、tooltip 淡入。也是 `--default-transition-timing-function` 的值 |
| `--ease-washi`（纸·落） | `cubic-bezier(.212, .091, .259, .953)` | 临界阻尼 ζ=1 阶跃响应在 y(T)=97.5% 处拟合，RMSE 0.0026。p(.25)=.42、p(.5)=.78、p(.75)=.95 | 一切 **transform 归位**：内容 settle、掀角与回落、dialog 位移、按钮松手 |
| `--ease-fude`（笔·运） | `cubic-bezier(.244, 0, .756, 1)` | 梯形速度剖面（加速 20%/匀速 60%/减速 20%）的位置积分，p(.5)=0.500 严格对称 | **只**给「一笔画出来」的几何延展：下划线 scaleX、分隔线铺开、进度条 |
| 水 | `linear` | 波的相位以恒定角速度推进，导数是常数 | **这是禁令不是 token**，写进注释。给背景波加 ease-in-out，循环接缝处会出现肉眼可见的「抽泵」 |

**ζ=1 是全域纪律：禁止 overshoot / bounce。** 纸纤维内阻尼极高，掀起一角松手不会来回抖。motion 侧的 spring 一律写 `{ type:'spring', visualDuration, bounce: 0 }`——`bounce: 0` 就是 ζ=1 的正确编码，不手推 stiffness/damping（评审共识：手推参数会在 motion 版本变动时漂移，且没人会重跑推导）。

### 4.2 时长

| token | 值 | 挑档依据 |
|---|---|---|
| `--transition-duration-sumi` | `180ms` | 毛细渗透深度是材料常数，与元素多大无关，**单值不做阶梯** |
| `--transition-duration-washi-sm` | `180ms` | 纸的**尺寸**：<40px（badge / button / 图标） |
| `--transition-duration-washi-md` | `280ms` | 40–200px（卡片 / 列表行 / 输入框） |
| `--transition-duration-washi-lg` | `400ms` | >200px（dialog / 页面区块） |

阶梯公式 `T(L) = 180ms · √(L/40)`，上限 420ms。**挑档看纸的尺寸，不看「这个交互重不重要」。**

薄板基频 f ∝ 1/L² 是真的，但严格套用会让 dialog 等 4.5 秒。所以立一条明写的元规则：**曲线取真值，标度取压缩**——形状忠于物理，标度指数从 L² 压到 L^0.5。压缩是设计决定，写在注释里，不假装它是物理。

**出场降一档**（÷√2，取自落选提案 2 并被两位评审点名移植）：进场 `--transition-duration-washi-md` 的元素，出场用 `-sm`。

**两条无障碍修正（强制）**：
- 状态反馈（focus ring、hover 底色、选中态）**一律对称 180ms**。不做慢退场——快速 Tab 或快速划过 30 行列表时会有多个元素同时挂着残留态。
- portal 弹层消散 **240ms**，且仅限 portal 弹层。

### 4.3 几何

| token | 值 | 说明 |
|---|---|---|
| `--settle-y` | `6px` | 全站**唯一**的入场位移量，方向恒为 +y→0（纸从上方落下贴到桌面）。绝不给第二个值——一旦出现 12px/24px，「远近」就被编码进 transform，而 reduced-motion 会把 transform 全部关掉 |
| `--lift-y` | `-2px` | 卡片 hover 抬起 |
| `--dogear` | `14px` | 右上角折角三角，`transform-origin` 在角点，从 `scale(0)` 长到 `scale(1)` |
| `--wave-rate` | `0.06` | 青海波远层视差系数 |
| `--wave-period` | `22px` | 取自 `app.css:178` 的 `background-size: 44px 22px`；远层用 2× 尺度（88×44），取模 44px |
| `--press-duration` | `0ms` 按下 / `--transition-duration-washi-sm` 松手 | 手指按到纸上是瞬时接触，**按下没有过渡**；松手是弹性恢复。仓库现有 `button.tsx:8` 的 `active:not-aria-[haspopup]:translate-y-px` 直接受益 |

**折角（dog-ear）是纯 transform + opacity 的「掀起一角」**，不动 `box-shadow`（paint 类）就能读出纸的厚度。

### 4.4 青海波：近层不动，远层滚动驱动

- **近层** = 现有 `body::before`（44×22，`app.css:171-181`）：**一行不改，永远不动**。它是纸自己的纤维肌理，纸不流动；这同时保证无 JS 时观感与今天完全一致，也永远不会碰到那个还挂着 `--bg-image`（cover/no-repeat）的槽位。
- **远层** = 新增 `fixed` div，图案 88×44、对比度再降一半、`inset: -24px 0` 出血。它是画在纸上的水，水才流动。位移 `translate3d(0, −((scrollY × 0.06) mod 22px), 0)`。

两个不同尺度的波列同向异速滚动会产生缓慢的莫尔/视差——这是真实水面的深度线索，也是唯一一个「一眼认出这是那个站」的东西。

**为什么是滚动驱动而不是空闲循环**（三位评审一致）：`app.css:184-188` 给 card / popover / dropdown 挂了 `backdrop-filter: blur(10px)`，`site-header.tsx:45` 还有 `bg-background/85 backdrop-blur`。底层每变一帧，上面每张半透明卡都要重算模糊。滚动时浏览器本来就在为 sticky header 和所有 blur 卡重算合成，波是**搭便车**；页面静止时波也静止，**静止开销严格为 0**。这同时是最好的前庭安全性质：用户停手，动就停。

远层图案必须**重写 stop**，不能靠 `background-size` 放大近层图案——放大会同时放大线宽，读作模糊而非远景。

### 4.5 一处收编

`@theme` 里设 `--default-transition-duration: var(--transition-duration-sumi)` 与 `--default-transition-timing-function: var(--ease-sumi)` 两行，现存 12 处裸 `transition-colors` **零 diff** 全部变成墨的曲线。仓库现有 5 处 `duration-100`（Radix 内容）换成本组 token。

---

## 五、内容层 / 装饰层契约

**这是整个设计的支点。** 它让「氛围」与「首屏可读性」不互相牺牲。

### 5.1 三条规则

1. **内容层**——会进 SSR HTML 的文字、列表项、表单、任何承载信息的元素：**禁止任何 `initial` 隐藏态，无例外**。首帧零入场。
2. **装饰层**——同时满足 `aria-hidden="true"` 与 `pointer-events-none`、不承载任何信息的纯视觉元素：可自由入场。
3. **到达动画的归属**：客户端导航后的到达由**原生 View Transition 独占**；motion 的 settle **只服务非导航到达**（fetcher 结果、展开收起、增删）。两套动效因此永不重叠。

### 5.2 为什么不用「transform-only 入场」这条出路

曾评估过：内容始终 `opacity: 1`，只从 `translateY(6px)` 归位。无 JS 时内容仍完整可读，只是位置差 6px。

**否决，两条理由**：
- 无 JS 时那 6px 是**永久版面误差**，不是延迟归位。紧贴的列表行会累积成可见错位。
- 更锋利的一条：`reducedMotion="user"` **只关 transform、保留 opacity**。所以 opacity 入场在 reduced-motion 下**照跑**，此时它是页面上唯一在动的东西——比不做还糟。而 transform-only 入场在 reduced-motion 下被完全关掉，等于那部分用户永远看到「差 6px」的版面。两头不讨好。

**结论：首帧就是终态，没有中间形态。**

### 5.3 `Decor` 基座

装饰层不是靠自觉，是靠一个组件把口子封上：

- `Decor` 强制写死 `aria-hidden="true"` + `pointer-events-none`
- 内建 `useReducedMotion()` 门控：减弱动效时直接渲染终态，不跑入场
- 装饰性入场只能通过 `Decor` 写

**唯一例外**：`Decor` 无法承载含文字的卡片 hover（「纸被括起一角」是本次点名要的效果，而它长在内容元素上）。这类**交互态**动效由 CSS 承担（`:hover` / `:focus-visible`），不走 motion，因此也不受 `Decor` 约束——交互态本来就不进 SSR 首帧。

---

## 六、模块边界与命名约定

### 6.1 文件结构

```
apps/web/app/
  app.css                       ← 三材 token 的单一来源（@theme）
                                  + reduced-motion 兜底
                                  + ::view-transition 曲线
                                  + .markdown 排版（T0 第 3 条）
  lib/motion/
    features.ts                 ← export default domAnimation（独立文件，供异步 import）
    tokens.ts                   ← CSS token 的 TS 镜像
    index.ts                    ← 具名再导出，解 m 冲突
  components/motion/
    MotionProvider.tsx          ← MotionConfig + LazyMotion strict
    WaveLayer.tsx               ← 青海波远层（装饰层）
    Decor.tsx                   ← 装饰层基座
    Presence.tsx                ← AnimatePresence 封装，锁死 initial={false}
scripts/
  check-motion-tokens.ts        ← CSS ↔ TS token 一致性门禁（约 25 行）
```

### 6.2 单一来源方向：CSS → TS

token 定义在 `app.css` 的 `@theme`（用普通 `@theme`，**不要 `@theme inline`**——变量要真落到 `:root` 上）。`lib/motion/tokens.ts` 是手写镜像，`check-motion-tokens.ts` 做一致性校验并接进 `bun run check`。

方向是 CSS → TS 而非反过来，因为 CSS 侧一处定义能同时喂饱三个消费者（第 2.5 节），TS 侧只有 motion 一个。

### 6.3 命名约定（要进 CLAUDE.md）

**禁止用 `m` 作为 motion 的标识符。** 一律具名导入：

```ts
import { div as MotionDiv, li as MotionLi } from 'motion/react-m'
```

实测与 namespace 导入体积差 0.04 KB，无代价。

理由：`m` 已被 Paraglide 占用于 `apps/web/app` 下 **30 个文件**，且 `scripts/check-messages.ts:74` 的门禁正则 `/\bm\.([a-zA-Z0-9_]+)\(/g` 会扫所有 ts/tsx 把 `m.xxx(` 当成消息 key 引用，找不到就**硬失败退出码 1**。JSX 的 `<m.div ...>` 后面跟空格不是 `(`，不会被误判；真正会误伤的是 `m.create('div')` 这类函数调用形式。

风险不是「一定会炸」，而是**命名规范必须在动手前定死**，否则 30 个文件里任何一个混用都要返工。

### 6.4 能力缺失作为执行力机制

`lib/motion/features.ts` 只导出 `domAnimation`，`LazyMotion` 开 `strict`。于是 `layout` / `layoutId` / `drag` **物理上不存在**——不靠 code review 拦，靠能力缺失拦。这是 CLAUDE.md 里「让『没过闸就拿不到参数』成为编译期事实」的同一手法。

**代价（必须写清）**：`AnimatePresence` 的 `mode="popLayout"` 也需要 projection，因此**不可用**，只能 `mode="sync"`。退场元素在动画期间仍占位，下方不会立刻上移。短退场（≤180ms）下可接受，但这是方案甲实打实的让步。

`mode="wait"` **全站禁用**：它让进出串行，每次交互变成 2 倍时长。`/dash` 的审核员一次会话点几十次，这是可测量的效率损失。

### 6.5 Provider 挂载点：root

`MotionConfig` + `LazyMotion` 都挂 `root.tsx`，features 异步。

曾考虑新增访客 layout 把 `LazyMotion` 挡在 `/dash` 之外，**否决**：首页本身就在访客 layout 里，首屏一样要付，拆分收益接近零，却要改 `routes.ts` 的结构。主包 +16.18 KB 里 `LazyMotion` 是壳，14.14 KB 的 features 走异步 chunk，不阻塞首帧。

---

## 七、跨页转场：原生 View Transition

### 7.1 为什么不是 AnimatePresence

RR8 的默认行为是 **loader 完成后才提交新 location**，所以「出场动画」没有自然的时机窗口。用 `AnimatePresence` + `useLocation` 作 key 只能做到「新页面淡入」，做不到真正的出场，且要和 `ScrollRestoration` 抢时序。

原生 View Transition 由浏览器在状态更新前后各截一次快照，**天然解决出场窗口问题**，且是 0 KB。

### 7.2 做法

- 访客页的 `Link` / `NavLink` 加 `viewTransition`
- `::view-transition-old/new` 的曲线写在 `app.css`，**且不进 `@layer`**（伪元素在 UA origin，layer 里会被优先级问题吃掉）
- 用 `--ease-sumi`（交叉淡入是颜色/不透明度类）
- **不依赖 view transition types**（Firefox 首版不支持），因此不做方向性转场
- reduced-motion 下 `::view-transition-group { animation: none }` 兜底

### 7.3 配套

- **`prefetch="intent"`**：把「没有出场窗口」这个问题缩小到不需要出场——鼠标悬停即预取，loader 往返在用户点击前就开始了。
- **pending 墨线**：纯 CSS，挂在 header 下边缘，由 `useNavigation().state` 切 `data-` 属性驱动。**不做完成动画**，让它死在旧快照里——VT 接管后旧快照整体淡出，进度条跟着走，这比手写收尾更自然。
  - 需 ~150ms 显示延迟阈值，否则快网下每次点击都闪一道。
  - **不要 `fixed z-50` 压在 header 上**：进度条每帧变化会触发 `backdrop-blur` 重算，那是全站最贵的元素。挂在 header 之内或之下。
- **路由播报与焦点归位**：转场看不见的那一半。RR8 不会在导航后移动焦点，全仓无 route announcer、无 skip link（`sr-only` 仅 3 处且全在组件内部）。补一个 `aria-live="polite"` 的路由播报 + skip link。新增文案 key 必须三语齐全，否则 `check-messages` 硬失败。
- **主题切换**包一层 `startViewTransition`，与路由转场共用同一套 `::view-transition` 曲线。注意别破坏 `root.tsx` 里防闪烁的 `themeInit` 内联脚本。

---

## 八、各页落地

### 8.1 首页与背景层

- **Hero**：`h1` 与 tagline 是内容层，首帧零入场。氛围由装饰层承担——大尺度青海波弧组（同一母题的第二个尺度）、一道 `--ease-fude` 的朱红界线（`--ease-fude` 唯一的正当用途）、一枚无字的几何朱印 + 墨洇。
- **五张模块卡的入场**：**卡本体一帧不动，动的是卡内的墨渍**。这是内容/装饰契约在最门面处的具体形态——卡片是内容，墨渍是装饰。
- **`PaperLift`**：hover 掀角（`--lift-y` + 折角三角露金）+ 按压压平 + **键盘同步**（`:focus-visible` 与 `:hover` 同一套视觉，否则键盘用户拿不到掀角）。
- **先修 `home.tsx:33` 的死类**（T0 第 5 条）。

### 8.2 香霖堂

- **筛选/翻页期间列表整体洇淡**，绝不换骨架屏——20 行以内的内容替换，骨架屏比洇淡更跳。
- **列表行 hover/focus：左缘一道朱线落笔**（`--ease-fude`，scaleY）。不做整行位移——`data-density="compact"` 的扫读效率优先。
- **封面显影**：图片是唯一「真的后到」的东西，是天然的装饰层，可自由淡入。但注意 `list.tsx:157` 是 `size-14`（56px）固定框 + 同尺寸 `bg-muted` 占位，**本来就没有布局跳变**，所以只做淡入不做 pop-in。
- **许可卡**：整个香霖堂唯一一处做完整「纸被括起一角」的地方。
- **评分星条**：扫笔填充 + 提交期乐观保持。**不做均分数字的滚动/闪色**——一次评分对均分的影响通常在小数点后第二位，动画会暗示一个并不存在的因果强度。
- **上传向导**：只做纸落定，**不做退场、不做方向性滑动**。方向感由步骤墨线的笔画承担，不由位移承担。步骤容器设高度地板，换步后焦点回表头。

### 8.3 博丽神社

- **当前版块的视觉指示**（今天根本不存在，见 T0 第 5 条）。
- **六版块卡掀角**（hover / focus）。
- **`divide-y` 硬线 → 墨界线**（楼层与主题列表）。
- **`#pN` 落点的墨洇用 CSS `:target`，不用 motion**。理由是时机：原生 hash 跳转发生在浏览器解析文档时，早于 React 水合，motion 组件在那个瞬间还不存在，接不住；而 `:target` 是浏览器自己维护的状态，跨页深链、前进后退、手动改地址栏全覆盖。
  - **但要避一个坑**：分页 href 是 `?floor=51#p51`，`:target` 会在**每次翻页**给当页第一楼闪一下，而那一楼什么也没发生。所以 `:target` 规则必须限定在「引用锚点与自链接」，翻页落点走另一条路径（或不给提示）。
- **发帖成功后新楼层的出现**：以 T0 第 2 条修完为前提。命中当前楼层窗口 → `useAnimate()` 命令式播墨洇（**不把 50 个 `<li>` 变成 motion 组件**）；不在窗口内 → 先导航到邻近页再播。
- **编辑态展开：不动高度，改为翻纸**。`height: auto` 需要 motion 测量子树，而 `Markdown.tsx` 里的图片是 `loading="lazy"`，测到的高度会在图片到达后再变一次。
- **明确不做**：楼层列表的 `AnimatePresence` / `layout`（会打断 hash 定位，且与 `ScrollRestoration` 抢时序）。

### 8.4 `/dash`（只给功能性，不加装饰）

- **审核队列与举报列表的条目退场**：`AnimatePresence mode="sync"` + `exit`，时长 ≤180ms，`exit` 里加 `pointerEvents: 'none'` 防误触。两个列表**共享同一份 transition 常量**。
- **乐观移除**：从 `useFetchers()` 收集非 idle 的 fetcher 过滤 items。**但必须先把 fetcher 从 `ReviewActions` 内部提到列表层**（`useFetcher({ key: r.id })`）——否则 `AnimatePresence` 退场结束即卸载组件，fetcher 随之注销，网络慢于动画时卡片会「弹回来再消失一次」，且 `fetcher.data` 随组件销毁，错误文案物理上挂不回卡上。
- **内联错误与警告的插入**：现在是裸条件渲染，会把下方按钮顶开约 20px，而用户正准备去点——这是误点诱因。抽成一个 `FormError` 原语（仓库里同构写法出现 6 次以上），**不要六份实现**。
- **不做**：tab 下划线的 `layoutId`（需要 domMax）、待办计数翻牌（需要 popLayout，且收益接近零）、所有装饰性动效。

---

## 九、无障碍与降级

### 9.1 CSS 侧兜底（这一半与 motion 无关，但不做的话「尊重 reduced-motion」就是假的）

**整块必须不带任何 `@layer`**（写在 `app.css` 文件末尾）。设 `--tw-enter-*`/`--tw-exit-*` 非零值的工具类落在 `@layer utilities`，Tailwind v4 层序 theme→base→components→utilities 晚层恒胜，放进 `@layer base` 会被 `utilities` 完全盖过而失效——T0 曾经这么写过，源码看起来没问题，直到最终审查在生产构建产物上实测才抓出。放进 `@layer utilities` 也不行：我们的 `*` 特异性是 0,0,0，仍输给工具类选择器的 0,1,0。未分层的常规声明胜过任何分层声明，这是唯一有效的位置。`scripts/check-css-layers.ts` 解析构建产物、把这条钉成门禁（`bun run check-css-layers`）。

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    --tw-enter-translate-x: 0; --tw-enter-translate-y: 0;
    --tw-exit-translate-x:  0; --tw-exit-translate-y:  0;
    --tw-enter-scale: 1;       --tw-exit-scale: 1;
    --tw-enter-rotate: 0;      --tw-exit-rotate: 0;
    --tw-enter-blur: 0;        --tw-exit-blur: 0;
  }
}
```

**三条设计决定，每条都有反例支撑**：

- **必须用 `*, *::before, *::after`，不能用 `:where(.animate-in, .animate-out)`**。本仓库 8 处弹层的类名 token 是 `data-open:animate-in`，`.animate-in` **一个元素都选不中**。
- **必须归零变量，不能用 `animation: none !important`**。Radix 靠 `animationend` 卸载弹层，核弹写法会让弹层卡住不消失。归零变量保留淡入淡出、只掐掉位移与缩放。
- **不能用 `*{transition-duration: 1ms !important}`**。它连颜色过渡一起杀，而 `reducedMotion="user"` 只关 transform、保留 opacity/颜色——两套降级语义长期必然打架。本系统「状态用墨、动作用纸」的整个降级设计就靠颜色还在跑。

`skeleton` 的 `animate-pulse` 需要保留一个低幅度版本，否则骨架屏静止后用户分不清是在加载还是坏了。

### 9.2 JS 侧

`root.tsx` 的 `<MotionConfig reducedMotion="user">`。注意它**只管 motion 组件**，管不到 tw-animate-css、`animate-pulse` 和 18 处 `transition-*`——所以 9.1 不可省。

`Discussion.tsx:69` 的 `scrollIntoView({behavior:'smooth'})` 单独处理：`MotionConfig` 管不到原生滚动 API，需按 `matchMedia('(prefers-reduced-motion: reduce)').matches` 选 `auto`/`smooth`。

### 9.3 pending 反馈的降级陷阱

全局 reduced-motion 兜底会冻结 `animate-spin`，于是开启减弱动效的用户看到一个**静止的 spinner**。若再采用「loading 时把 children 设 `opacity-0` 保留占位」的写法，结果是**一个完全空白的禁用按钮**。

**规定**：pending 的主信号是**文案切换**（「发送中…」）+ `aria-busy`，spinner 只是辅助。全站 12 处 busy 统一按此实现。

复用现有 key：`shrine_uploading`、`section_loading`、`shrine_load_failed` 等。新增 key 必须三语齐全。

---

## 十、验收

### 10.1 最小 Playwright 冒烟（新增）

仓库零浏览器测试，`bun run e2e` 只打 HTTP 层。以下三条红线**目前没有任何门禁能挡**，而它们恰好是「肉眼看不出、但会伤到爬虫和前庭敏感用户」的那一类：

1. **禁 JS 截首屏**，断言首页 `h1`、香霖堂列表首行、神社主题正文均可见（computed `opacity !== 0`）
2. **开 `prefers-reduced-motion: reduce`**，断言首屏无元素带非 `none` 的 `transform`
3. **`::view-transition` 期间无控制台错误**

这是加动效的隐藏成本，显式付掉而不是记在账外。

### 10.2 体积门禁

构建后断言 `/` 路由首屏 JS gzip **≤ 178 KB**（基线 159.9 + 预算 18）。超了就是有人不小心把 features 变成同步、或把 `motion/react` 静态 import 进了 root。

### 10.3 现有门禁

`bun run check`（Biome）、`typecheck`、`check-messages`（三语 key 审计）、`e2e`（40 项 HTTP 验收）全部照跑。`check-motion-tokens` 接进 `check`。

---

## 十一、分期

| 期 | 内容 | 新依赖 | 可独立交付 |
|---|---|---|---|
| **T0** | 八条既存缺陷（第三节）。含 `prefers-reduced-motion` 兜底、`.markdown` 排版、移动端导航、超 50 楼回复、香霖堂分页、卡片死类、图片尺寸、主题图标首帧 | 无 | 是，纯净收益 |
| **T1** | 三材 token 进 `@theme`；两行 `--default-transition-*` 收编现存 12 处；`check-motion-tokens` | 无 | 是 |
| **T2** | 材质层：掀角 / 朱线 / 墨界线 / `:target` 墨洇 / 青海波远层视差 / `::view-transition` 曲线 | 无 | 是 |
| **T3** | 装 motion、`MotionProvider`、`Decor`、`Presence`、`viewTransition` 转场、pending 墨线、路由播报 | `motion` | 是 |
| **T4** | 各页落地（8.1–8.4） | 无 | 是 |
| **T5** | Playwright 冒烟 + 体积门禁 | `@playwright/test` | 是 |

**T0–T2 一行 motion 都不装。** 和风纸境的材质本来就是 CSS 的主场，这不是拖延，是让 T3 装进来的 16 KB 只买真正买不到的东西（`AnimatePresence` 的 exit，和不确定时长的可中断接管）。

**T2 结束是一个真实的决策点**：此时全站已有完整的三材质感、跨页转场、青海波视差，且零新依赖。可以先看观感，再决定 T3 是否继续。

---

## 附录 A：落选方案与理由

**「墨时 Sumidoki · 四层时间尺度」**（工程师评审的首选）。按「用户的手离它多远」分四层，一次分类同时给出时长档、位移预算与 SSR 判定，可推导性最强。落选原因：它的核心机制建立在一个事实错误上——认定 Tailwind v4 没有 `--duration-*` 命名空间，因此发明了七条手维护的 `@utility dur-*`。实测 `duration-*` 从 `--transition-duration-*` 解析，改名即可全删。它的 `--ease-ground: steps(44, end)` 性能推理是三份里最好的观察（把背景帧率降到 0.61fps 以免每张卡每秒重算 60 次高斯模糊），但结论自毁——它自己承认那条动画「视觉上与连续漂移不可分辨」，即付了合成成本买了零观感。滚动驱动免费拿到更强的结果。

**已移植进最终方案的部分**：「出场比进场降一档（÷√2）」、「不装 domMax 让 `layout` 物理上不存在」这一执行力机制、以及「`reducedMotion="user"` 保留 opacity，所以 opacity 入场在减弱动效下反而成为页面上唯一在动的东西」这一洞察。

**「墨三息 Sumi Mitsuiki — 三息二笔」**。三个时长两条曲线，克制到极限，实现与维护成本最低。落选原因：它自洽在一个比本次 brief 小的问题上——它的 `Decor` 把 `aria-hidden` + `pointer-events-none` 写死，这对背景层优雅，但**结构上无法承载一个含文字的卡片的 hover**，而「纸被括起一角」是本次点名要的效果。它把这部分交给 CSS，于是 motion 几乎什么都不做。它的 reduced-motion 是 `*{transition-duration:1ms!important}` 核弹写法。

**已移植进最终方案的部分**：`Decor` 基座本身（用于纯装饰层）、轻量 check 脚本替代代码生成器。

## 附录 B：三位评审共同要求砍掉的东西

| 砍掉 | 理由 |
|---|---|
| `--lift-tilt: 0.15deg` 卡片微旋 | 半透明 + `backdrop-filter` 上做 rotate → CJK 文字重新栅格化、整卡发虚；0.15deg 本身看不见 |
| `--ease-sumi-in` + 420ms 慢退场 | 在 dropdown 上读作卡顿；在状态反馈上是可访问性缺陷（多元素残留态） |
| 物理推导叙事（RMSE 表、ωn/stiffness 手算） | 曲线值保留，推导表演不进文档——两年后没人重跑拟合，只会照抄，此时叙事的唯一作用是让人不敢改 |
| `scripts/gen-motion-tokens.ts` | 为防一个数字漂移引入构建步骤 + 生成产物，收益不抵心智成本 |
| `--ease-mizu: linear` 立为 token | 它是禁令不是值，写进注释；立成 token 会有人拿去当通用缓动 |
| `--fude-speed` / `stagger.brush` | 为一个被禁止的场景（列表逐条入场）设计的自适应参数 |
| 三套并行时长阶梯 | 给一个总共约 15 处动效的站配三套正交的时长来源，是把可推导性变成记忆负担 |
| 空闲循环背景漂移（72s / 200s） | 页面静止时持续让每张 `backdrop-filter` 卡失效，买来的是没人注意到的运动 |
