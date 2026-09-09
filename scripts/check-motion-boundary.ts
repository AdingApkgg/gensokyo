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
 * 断言四条：
 *   1. `app/root.tsx` 的 `motion/react` 导入存在，且导入的名字集合 ⊆ {MotionConfig}
 *   2. 可达集里除 root.tsx 外的每个文件，import 语句都不出现 `motion/react`
 *   3.（C1）七个匿名可读路由各自的可达集零命中 `motion/react`——登录后才用得上
 *      的东西（浮标/落款/翻纸/星条/上传进度）必须走 lazy() / 动态 import，
 *      不许钉进这些路由的静态图
 *   4. 全站源码零裸的 `import('motion/react')`——见下方「只跟静态 import」
 *      一条的更正
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
 *   - 断言 1–3 **只跟静态 `import`**（含具名/默认/命名空间/`type`/纯副作用），
 *     不跟 `import()` 动态导入。动态 import **一般**会被 rolldown 单独分包，
 *     不进入调用它的模块所在的那个 chunk——`site-header.tsx` 里
 *     `await import('~/lib/auth-client')` 那样的调用不会让 auth-client 的
 *     内容并入 root 共享 chunk，按可达性算不该判它违规。**但这不是无条件
 *     成立**：T5 实测过反例——裸包名的动态 import 会让 rolldown 改变
 *     **该包**的 chunk 归属，把它并进调用方也能到达的共享 chunk。
 *     `Discussion.tsx` 里一句裸的 `await import('motion/react')` 按可达性
 *     算一样安全（`motion/react` 本身不在可达集判定范围内），却让 rolldown
 *     把整个 `motion/react`（约 40 KB gz）并进了 root 静态 import 就能到达
 *     的共享 chunk，首屏 151 → 192 KB——断言 1–3 全绿，完全没抓到。断言 4
 *     就是为这个反例单独加的：只要源码里出现裸的 `import('motion/react')`，
 *     不管它在不在可达集里，一律判违规。即便如此，断言 4 也只是「已知的
 *     一种诱因」，不是形式化证明——`bun run check-bundle-size`（读构建产物、
 *     逐文件量体积）才是这类 chunk 归属问题的最终裁判，断言 1–4 只是把已知
 *     模式提前挡在 CI 更早的一步。
 *   - 不剥注释就地正则匹配 import 语句（体例同 `check-css-layers.ts`：
 *     不引入一个真正的解析器）。为避免懒惰量词跨越到下一条 import、把上一条
 *     的字符串字面量误吞进具名导入列表，导入子句的字符类显式排除引号与分号。
 *
 * 依赖 `bun run typecheck` 跑过一次会更完整（补齐 `.react-router/types` 与
 * paraglide 产物），但**不是必需**——本脚本只读源码，找不到的生成文件按上面
 * 的规则跳过，不影响以上断言的正确性，所以可以放在 `bun run build` 之前跑。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

// ---- 断言 4：全站零裸的 import('motion/react') ----
//
// 实测（T5）：Discussion.tsx 里一句 `await import('motion/react')` 在源码可达性上没问题，
// 却让 rolldown 改变了 motion 的 chunk 归属，把整个 motion（约 40 KB gz）并进 root
// 静态 import 的共享 chunk——首屏 151 → 192 KB。断言 1–3 看的是可达性，抓不到它。
// 含 motion 的东西要独立成本地模块（ReplyTargetBar / FloorFlip / bloom / star-strip 那样），
// 由匿名可读文件 `import('./x')` 加载；rolldown 对本地模块的动态 import 不会这么做。
// 只看代码行，跳过注释——注释里可以举例说明这条禁令。

const BARE_DYNAMIC = /import\(\s*['"]motion\/react['"]\s*\)/
const sourceFiles = readdirSync(appDir, { recursive: true })
  .map(String)
  // readdirSync 给的是相对 appDir 的路径，顶层目录没有前导斜杠——`paraglide/…`
  // 要按前缀排除，否则三百多个 Paraglide 类型声明会被白扫一遍
  .filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.startsWith('paraglide/') &&
      !f.includes('/paraglide/'),
  )
const bareHits: string[] = []
for (const rel of sourceFiles) {
  const lines = readFileSync(join(appDir, rel), 'utf8').split('\n')
  lines.forEach((line, i) => {
    const t = line.trimStart()
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return
    if (BARE_DYNAMIC.test(line)) bareHits.push(`${rel}:${i + 1}`)
  })
}
if (bareHits.length > 0) {
  ok = false
  for (const h of bareHits) {
    console.log(
      `✗ ${h} 有裸的 import('motion/react')——它会让 rolldown 把整个 motion 并进首屏共享 chunk（T5 实测 +40 KB）。含 motion 的代码请独立成本地模块，再 import('./那个模块')`,
    )
  }
} else {
  console.log(`✓ ${sourceFiles.length} 个源码文件零裸 import('motion/react')`)
}

process.exit(ok ? 0 : 1)
