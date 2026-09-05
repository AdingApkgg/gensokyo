/**
 * CSS 层归属断言：
 *   bun run check-css-layers
 *
 * 断言构建产物（`apps/web/build/client/assets/*.css`）里的两类规则都
 * **不在任何 `@layer` 内**：
 *
 *   1. 每一处把 `--tw-enter-*` / `--tw-exit-*` 归零的规则（reduced-motion）。
 *   2. 每一条 `::view-transition-*` 伪元素规则。
 *
 * 背景见 `apps/web/app/app.css` 文件末尾那段注释：Tailwind v4 的层序是
 * theme→base→components→utilities，同特异性下**晚层恒胜于早层**，且任何
 * **未分层（unlayered）的常规声明恒胜于任何分层声明**。设这些变量非零值的
 * 工具类（`data-open:slide-in-from-*` 等）落在 `@layer utilities`——归零规则
 * 如果被塞进 `@layer base`（甚至 `@layer utilities` 本身，特异性打不过工具类
 * 选择器），会被恒胜的晚层／同层工具类盖过而完全失效。T0 曾经就是这么错的，
 * 由最终审查在生产构建产物上实测抓出，而不是靠读源码看出来的——分层裁决
 * 发生在构建之后，所以这个脚本解析的是构建产物，不是源码。
 *
 * `::view-transition-*` 是同一类问题的另一种成因：这些伪元素在 UA origin
 * 生成，不属于文档树，包进任何 `@layer`（哪怕只有它自己）都会被 UA 的
 * 未分层默认样式或其他未分层规则盖过、静默失效——与 reduced-motion 归零块
 * 「未分层胜过任何分层声明」是同一条规则，因此并入同一份门禁脚本。
 *
 * 依赖 `bun run build` 先跑过一次；不接进 `bun run check`（Biome 那条），
 * 理由同上。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const cssDir = join(root, 'apps/web/build/client/assets')

if (!existsSync(cssDir)) {
  console.log(`✗ 构建产物不存在：${cssDir}（先跑 bun run build）`)
  process.exit(1)
}

const cssFiles = readdirSync(cssDir).filter((f) => f.endsWith('.css'))
if (cssFiles.length === 0) {
  console.log(`✗ ${cssDir} 下没有 .css 文件（先跑 bun run build）`)
  process.exit(1)
}

type Frame =
  | { kind: 'layer'; name: string }
  | { kind: 'media-reduced' }
  | { kind: 'other'; contentStart: number; header: string }

const MEDIA_REDUCED_RE =
  /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i
const LAYER_RE = /^@layer\s+([a-zA-Z-]+)$/
const RESET_VAR_RE = /--tw-(enter|exit)-/
const VIEW_TRANSITION_RE = /::view-transition-/

/**
 * 极简 CSS 块扫描：只关心 `{` / `}` 的嵌套与紧邻 `{` 之前的「头部」文本。
 * 不需要一个真正的 CSS 解析器——构建产物是压缩过的合法 CSS，本项目的规则里
 * 没有含 `{`/`}` 字符的字符串字面量（内容属性、url() 等）会打乱嵌套计数。
 *
 * 两条断言共用同一次遍历，各自独立计数、独立收集失败信息：
 *
 * 1) reduced-motion 归零：只看结构，不看选择器文本（选择器会被压缩成
 *    `:before`/`:after` 等不稳定形式）——一条声明块的内容一旦命中
 *    `--tw-enter-`/`--tw-exit-`，就检查它的祖先帧：含
 *    `@media (prefers-reduced-motion: reduce)` 才计入统计，再看含 `@media`
 *    到根之间是否夹着任何 `@layer`。**此断言逻辑不变。**
 *
 * 2) view transition 伪元素：`::view-transition-*` 不会被压缩改名（不像
 *    `::before`/`::after` 有历史缩写形式），选择器文本在构建产物里保持
 *    稳定，所以直接匹配声明块的「头部」（选择器）文本；命中即计入统计，
 *    再看它到根之间是否夹着任何 `@layer`——不要求处于某个 `@media` 内，
 *    因为 `::view-transition-old/new(root)` 本身就在顶层。
 */
function scan(
  css: string,
  fileLabel: string,
  bad: string[],
  badViewTransition: string[],
): { resetFound: number; viewTransitionFound: number } {
  const stack: Frame[] = []
  let headerStart = 0
  let resetFound = 0
  let viewTransitionFound = 0

  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      const header = css.slice(headerStart, i).trim()
      const layerMatch = LAYER_RE.exec(header)
      if (layerMatch) {
        stack.push({ kind: 'layer', name: layerMatch[1] as string })
      } else if (MEDIA_REDUCED_RE.test(header)) {
        stack.push({ kind: 'media-reduced' })
      } else {
        stack.push({ kind: 'other', contentStart: i + 1, header })
      }
      headerStart = i + 1
    } else if (ch === '}') {
      const frame = stack.pop()
      if (frame?.kind === 'other') {
        const content = css.slice(frame.contentStart, i)
        const layerAncestor = () =>
          stack.find((f) => f.kind === 'layer') as
            | { kind: 'layer'; name: string }
            | undefined

        // 断言 1：prefers-reduced-motion 的 --tw-enter-*/--tw-exit-* 归零
        if (RESET_VAR_RE.test(content)) {
          const insideReduced = stack.some((f) => f.kind === 'media-reduced')
          if (insideReduced) {
            resetFound++
            const ancestor = layerAncestor()
            if (ancestor) {
              bad.push(
                `✗ ${fileLabel}：prefers-reduced-motion 的 --tw-enter-*/--tw-exit-* 归零规则落在 @layer ${ancestor.name} 内——会被 @layer utilities 的工具类盖过而失效`,
              )
            }
          }
        }

        // 断言 2：::view-transition-* 规则必须不分层
        if (VIEW_TRANSITION_RE.test(frame.header)) {
          viewTransitionFound++
          const ancestor = layerAncestor()
          if (ancestor) {
            badViewTransition.push(
              `✗ ${fileLabel}：::view-transition-* 规则（${frame.header}）落在 @layer ${ancestor.name} 内——view transition 伪元素在 UA origin，包进 @layer 会被优先级问题吃掉、静默失效`,
            )
          }
        }
      }
      headerStart = i + 1
    } else if (ch === ';' && stack.length === 0) {
      // 顶层语句（如 `@layer theme, base, components, utilities;`），跳过
      headerStart = i + 1
    }
  }
  return { resetFound, viewTransitionFound }
}

const bad: string[] = []
const badViewTransition: string[] = []
let totalFound = 0
let totalViewTransitionFound = 0
for (const f of cssFiles) {
  const { resetFound, viewTransitionFound } = scan(
    readFileSync(join(cssDir, f), 'utf8'),
    f,
    bad,
    badViewTransition,
  )
  totalFound += resetFound
  totalViewTransitionFound += viewTransitionFound
}

if (totalFound === 0) {
  bad.push(
    '✗ 构建产物里找不到 prefers-reduced-motion 的 --tw-enter-*/--tw-exit-* 归零规则——可能被误删或改名',
  )
}

if (totalViewTransitionFound === 0) {
  badViewTransition.push(
    '✗ 构建产物里找不到 ::view-transition-* 规则——可能被误删或改名',
  )
}

for (const m of bad) console.log(m)
console.log(
  bad.length
    ? `${bad.length} 处问题`
    : `✓ ${totalFound} 处 prefers-reduced-motion 归零规则均不在任何 @layer 内`,
)

for (const m of badViewTransition) console.log(m)
console.log(
  badViewTransition.length
    ? `${badViewTransition.length} 处问题`
    : `✓ ${totalViewTransitionFound} 处 ::view-transition-* 规则均不在任何 @layer 内`,
)

process.exit(bad.length || badViewTransition.length ? 1 : 0)
