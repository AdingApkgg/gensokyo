/**
 * motion 边界断言：
 *   bun run check-motion-boundary
 *
 * 背景（A2，`docs/superpowers/plans/2026-09-07-motion-t4-dash.md`）：实测
 * `motion/react` 出现在 root 的可达图里 = 首屏 **+37.31 KB**。而这个站流量
 * 最大的页面是被外链进来的 `/kourindou/:slug` 匿名读者——root 树背上的每一
 * 字节都由他们先付。所以硬边界是：**`app/root.tsx` 是 root 树里唯一允许
 * import `motion/react` 的文件，且只允许其中的 `MotionConfig` 这一个名字**；
 * 从 root.tsx 出发能沿本地 import 到达的其余所有文件，必须零命中
 * `motion/react`。
 *
 * 断言两条：
 *   1. `app/root.tsx` 的 `motion/react` 导入存在，且导入的名字集合 ⊆ {MotionConfig}
 *   2. 可达集里除 root.tsx 外的每个文件，import 语句都不出现 `motion/react`
 *
 * **不硬编码文件名单**——早期方案列了四个文件（site-header / mobile-nav /
 * pending-bar / ui/button），但实测 root 可达图不止这些（还有 site-footer /
 * lang-switcher / theme-toggle / ui/dropdown-menu 等），且这类名单会随组件树
 * 演进持续腐烂，没人会记得每次改 site-header.tsx 时回来同步它。正确形状是
 * **从 `app/root.tsx` 出发递归解析本地 import**（相对路径 `./` `../` 与
 * `~/` 别名），对整棵可达集求值，新增的 root 树文件自动被覆盖。
 *
 * 解析范围与已知简化（都是刻意的，不是遗漏）：
 *   - 只跟本地 import：相对路径（`./` `../`）与 `~/`（映射到 `apps/web/app/`，
 *     与 `apps/web/tsconfig.json` 的 `paths` 一致）。裸说明符（`react`、
 *     `motion/react` 本身、`lucide-react`……）一律视为 node_modules 包，不递归，
 *     只用来检测是否命中 `motion/react`。
 *   - 只解析 `.tsx` `.ts` 两种扩展名，以及目录形式的 `index.tsx` / `index.ts`。
 *     `root.tsx` 里 `./+types/root`（React Router typegen 生成的虚拟 .d.ts，
 *     挂在 `.react-router/types/` 下走 `rootDirs` 解析）与
 *     `./paraglide/{messages,runtime,server}`（Paraglide 编译产物是 `.js`）
 *     都解析不到 `.ts`/`.tsx` 文件，会被跳过——这是预期行为：它们是构建期
 *     生成物，不是手写源码，没人会手改它们去 import motion。
 *   - **只跟静态 `import`**（含具名/默认/命名空间/`type`/纯副作用），
 *     不跟 `import()` 动态导入。理由与 A1 是同一个：动态 import 会被
 *     rolldown 单独分包，不会进入调用它的模块所在的那个 chunk——
 *     `site-header.tsx` 里 `await import('~/lib/auth-client')` 那样的调用
 *     不会让 auth-client 的内容并入 root 共享 chunk，所以它不该算进这条
 *     「root 共享 chunk 不许有 motion」的边界里。
 *   - 不剥注释就地正则匹配 import 语句（体例同 `check-css-layers.ts`：
 *     不引入一个真正的解析器）。为避免懒惰量词跨越到下一条 import、把上一条
 *     的字符串字面量误吞进具名导入列表，导入子句的字符类显式排除引号与分号。
 *
 * 依赖 `bun run typecheck` 跑过一次会更完整（补齐 `.react-router/types` 与
 * paraglide 产物），但**不是必需**——本脚本只读源码，找不到的生成文件按上面
 * 的规则跳过，不影响两条断言的正确性，所以可以放在 `bun run build` 之前跑。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = join(import.meta.dir, '..')
const appDir = join(root, 'apps/web/app')
const rootFile = join(appDir, 'root.tsx')

if (!existsSync(rootFile)) {
  console.log(`✗ 找不到 ${relative(root, rootFile)}`)
  process.exit(1)
}

const EXTENSIONS = ['.tsx', '.ts']
const INDEX_FILES = ['index.tsx', 'index.ts']

/** 把一个 import 说明符解析成本地源文件的绝对路径；非本地（node_modules）说明符返回 null。 */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('~/')) {
    base = join(appDir, specifier.slice(2))
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = resolve(dirname(fromFile), specifier)
  } else {
    return null
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext
  }
  for (const idx of INDEX_FILES) {
    const p = join(base, idx)
    if (existsSync(p)) return p
  }
  return null
}

type ImportRecord = { specifier: string; names: string[] }

/** 从 import 子句文本（`import` 与 `from` 之间的部分）里取出被导入的名字，`as` 前的原始名。 */
function namesFromClause(clause: string): string[] {
  const names: string[] = []
  const namedMatch = clause.match(/\{([^}]*)\}/)
  if (namedMatch) {
    for (const part of (namedMatch[1] as string).split(',')) {
      const trimmed = part.trim().replace(/^type\s+/, '')
      if (!trimmed) continue
      const name = (trimmed.split(/\s+as\s+/)[0] as string).trim()
      if (name) names.push(name)
    }
  }
  const rest = clause.replace(/\{[^}]*\}/, '').trim()
  if (rest) {
    for (const part of rest.split(',')) {
      const trimmed = part.trim().replace(/^\*\s+as\s+/, '')
      if (trimmed) names.push(trimmed)
    }
  }
  return names
}

/**
 * 抠出一个源文件里所有 `import` 语句的 { 说明符, 导入的名字 }。
 *
 * 两条正则分别处理「带 from」与「纯副作用」两种形态，而不是一条正则里塞
 * 可选组：带 from 的子句字符类显式排除 `'"` 与 `;`，防止懒惰量词在找不到
 * 紧邻的 `from` 时一路扩张、跨过下一条语句的字符串字面量把它错认成本条的
 * 具名导入（例如 `import './app.css'\nimport { MotionConfig } from '...'`
 * 这种紧邻的副作用导入 + 具名导入组合）。
 */
function extractImports(source: string): ImportRecord[] {
  const records: ImportRecord[] = []

  const withClauseRe =
    /import\s+(?:type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g
  for (const m of source.matchAll(withClauseRe)) {
    records.push({
      specifier: m[2] as string,
      names: namesFromClause(m[1] as string),
    })
  }

  const sideEffectRe = /import\s+['"]([^'"]+)['"]/g
  for (const m of source.matchAll(sideEffectRe)) {
    records.push({ specifier: m[1] as string, names: [] })
  }

  return records
}

function isMotionReact(specifier: string): boolean {
  return specifier === 'motion/react' || specifier.startsWith('motion/react/')
}

// ---- 从 root.tsx 出发做可达集的 BFS，不跟 node_modules、不跟动态 import ----

const visited = new Set<string>()
const queue: string[] = [rootFile]
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

console.log(
  `可达集：从 app/root.tsx 出发递归解析本地 import，共 ${visited.size} 个文件`,
)

let ok = true

// ---- 断言 1：root.tsx 的 motion/react 导入存在，且只有 MotionConfig ----

const rootHits = motionHitsByFile.get(rootFile) ?? []
const rootNames = rootHits.flatMap((h) => h.names)
const disallowed = rootNames.filter((n) => n !== 'MotionConfig')

if (rootHits.length === 0) {
  ok = false
  console.log(
    '✗ app/root.tsx 没有 import motion/react——MotionConfig 是不是被移除了？',
  )
} else if (disallowed.length > 0) {
  ok = false
  console.log(
    `✗ app/root.tsx 从 motion/react 导入了不该在 root 树出现的名字：${disallowed.join(', ')}（A2：root 树只允许 MotionConfig 这一个）`,
  )
} else {
  console.log(`✓ app/root.tsx 的 motion/react 导入只有 MotionConfig`)
}

// ---- 断言 2：可达集里除 root.tsx 外零命中 motion/react ----

const offenders = [...motionHitsByFile.keys()].filter((f) => f !== rootFile)

if (offenders.length > 0) {
  ok = false
  for (const f of offenders.sort()) {
    console.log(
      `✗ ${relative(root, f)} import 了 motion/react——root 树里除 app/root.tsx 外禁止出现 motion（A2：实测 motion 进 root 可达图 = 首屏 +37.31 KB，而这个站流量最大的页面是被外链进来的 /kourindou/:slug 匿名读者）`,
    )
  }
} else {
  console.log(
    `✓ 可达集里除 root.tsx 外的 ${visited.size - 1} 个文件零命中 motion/react`,
  )
}

process.exit(ok ? 0 : 1)
