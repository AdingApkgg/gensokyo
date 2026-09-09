/**
 * 体积门禁：
 *   bun run check-bundle-size
 *
 * 抓的是一类 code review 抓不住的故障：**同一个文件里既静态又动态 import
 * 同一个包**（比如叶子路由文件里顶部 `import Foo from 'lib'`，函数体里又
 * `await import('lib')`），rolldown 会认定拆分收益不划算，直接放弃分包、
 * 把它提进某个共享 chunk——于是全站每个路由都平白多背这份体积。更麻烦的
 * 是 Vite 8 对这种情况**完全不打警告**（它只在「纯动态 import 撞上纯静态
 * import」时才打 `INEFFECTIVE_DYNAMIC_IMPORT`，本项目当前 auth-client.ts
 * 那条就是这种会警告的情形；但「同一文件里两种 import 并存」这种更隐蔽的
 * 写法，rolldown 静默处理，构建日志里什么都看不到）。唯一能抓住它的手段
 * 是称重：给每个路由实际会加载的资源求和，超预算就说明有什么东西被错误
 * 地塞进了不该进的 chunk。
 *
 * 数据源是 React Router 产物里内联的 SSR manifest
 * （`apps/web/build/server/index.js` 里的 `var server_manifest_default =
 * {...}`）——它记录了每个路由自己的 `module`/`imports`，以及 `entry`（客户端
 * 入口）与 `routes.root`（根布局）各自的 `module`/`imports`。**不用 `eval`**
 * 解析：手动数括号切出对象字面量文本，把压缩产物里的 `void 0` 换成合法
 * JSON 的 `null` 再 `JSON.parse`。
 *
 * 两个口径决定了这份门禁的形状：
 *
 * 1. **首屏集**（SHARED_BUDGET）= `entry.module ∪ entry.imports ∪
 *    routes.root.module ∪ routes.root.imports`——这是任意一个 URL 都会
 *    加载的公共部分（客户端运行时 + 根布局 + 根布局用到的一切）。
 *    只算 JS（`module`/`imports`），不算 `css`——两者是完全不同的资源类型，
 *    混在一起求和会让「哪块变重了」的信号变糊。
 *
 * 2. **单路由预算**（ROUTE_BUDGET）= 首屏集 ∪ 该路由自身（含其所有祖先
 *    布局，root 除外）的 `module`/`imports`。**这一条不能省**：上面那个
 *    故障场景不一定会把模块提进 `entry`/`root` 这两个「真首屏」入口——它
 *    也可能被提进某个只被几个叶子路由共享的「伪共享」chunk，这种情况在
 *    首屏集里完全看不出来，只有把每个路由自己的体积也称一遍才抓得住。
 *
 * 逐文件 gzip level 9 求和，不是拼起来压一次——拼压会让多个文件互相蹭上
 * 同一份 deflate 字典，读数会比真实情况乐观（实测拼压比逐文件求和低约
 * 6.9 KB，足以掩盖一次真实的预算超支）。
 *
 * 只用 Bun 内置的 `node:fs`/`node:path`/`node:zlib`，不引入任何依赖。
 *
 * ---
 *
 * 预算取值理由（2026-09-07 T4 收尾时在 motion-t4-dash 分支重新称重，
 * 构建产物见 `apps/web/build/{server,client}`；`bun run check-bundle-size -- --all`
 * 逐路由打印，校准时用它，别手工拆产物）：
 *
 *   - 首屏集：25 个文件，gzip 合计 **152.45 KB**。`SHARED_BUDGET_KB = 155`
 *     留了约 2.5 KB 余量。T3 时是 22 个文件 150.62 KB；多出的那一个文件是
 *     `motion-*.js` **0.40 KB**——root.tsx 里 `MotionConfig` 那一个名字的
 *     全部代价，正是 A2 边界允许进 root 树的唯一东西。其余 +0.47 KB 是
 *     rolldown 重新分块的漂移，不对应任何新进 root 树的模块。
 *     T5（计划五）之后 25 个文件 152.45 KB：+0.49 是 mobile-nav 的划走手势、+0.24 是
 *     header 收起的监听，都是 root 树里的手写代码；其余 +0.2 是 rolldown 重新分块的漂移。
 *     motion 仍不在 root 可达图里（check-motion-boundary 断言 1/2）。**T5 期间它真抓过一次事故**：
 *     一句裸的 `await import('motion/react')` 让 rolldown 把整个 motion 并进 root 的共享 chunk，
 *     首屏 151 → 192——源码可达性断言看不见，只有这里的读数会红。现由断言 4 在源码层堵住。
 *     **预算刻意不放宽**：它要抓的是 motion 主体（≈37 KB）漏进 root 可达图
 *     那一类事故，3.5 KB 的余量对此绰绰有余；放宽只会让「谁又往 root 树塞了
 *     东西」这个信号变钝。
 *   - 单路由预算里最重的仍是 `:locale?/kourindou/:slug`
 *     （`routes/kourindou/detail`）：首屏集 + 自身 gzip 合计 **255.68 KB**
 *     （T3 时 250.99），其中 `Markdown` 单 chunk **47.37 KB**（该 chunk 被
 *     `kourindou/detail`、`shrine/new`、`shrine/topic` 三个路由共享，但因为
 *     不在首屏集里，只在实际引用它的路由预算里现身）。
 *     `ROUTE_BUDGET_KB = 270` 留了约 17 KB 余量。
 *   - motion 装进来之后的增量全部落在 `/dash` 一族：`/dash`（queue）从装前的
 *     193.14 KB 到 **236.68 KB**（+43.5 KB，在预估的 39–46 KB 带内），
 *     `/dash/reports` 227.95、`/dash/users` 200.04、`/dash/site` 198.95、
 *     `/dash/trash` 196.86——后三个自己几乎不用 motion，但 dash 布局
 *     （tab 下划线的 `layoutId`）是它们的祖先，motion 的 layout 引擎跟着
 *     布局 chunk 一起来。`login` / `register` / `home` 增量 0.00。
 *
 * 这两个数字只在当前依赖与路由结构下成立。下次再往里装会进 root 树的东西，
 * 或给 `kourindou/detail` 加依赖，都要重新构建、重新称重、重新校准——
 * 如果新读数比这里记的还低，说明有路由被精简了，也要如实更新注释，
 * 不能让注释继续写着过时的旧读数。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = join(import.meta.dir, '..')
const serverEntry = join(root, 'apps/web/build/server/index.js')
const clientDir = join(root, 'apps/web/build/client')

if (!existsSync(serverEntry)) {
  console.log(`✗ 构建产物不存在：${serverEntry}（先跑 bun run build）`)
  process.exit(1)
}

const SHARED_BUDGET_KB = 155
const ROUTE_BUDGET_KB = 270

type RouteManifestEntry = {
  id: string
  parentId: string | null
  path: string | null
  index: boolean | null
  module: string
  imports: string[]
}

type ServerManifest = {
  entry: { module: string; imports: string[] }
  routes: Record<string, RouteManifestEntry>
}

/**
 * 从构建产物里手动切出 `server_manifest_default` 的对象字面量文本。
 * 不用 `eval`：数括号找到与开头 `{` 配对的 `}`，把 rolldown 输出里表示
 * `undefined` 的 `void 0` 替换成合法 JSON 的 `null`，再交给 `JSON.parse`。
 */
function extractManifest(source: string): ServerManifest {
  const marker = 'var server_manifest_default = '
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) {
    console.log(
      '✗ 构建产物里找不到 var server_manifest_default——React Router 的产物格式可能变了',
    )
    process.exit(1)
  }
  const braceStart = startIdx + marker.length
  let depth = 0
  let end = -1
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end === -1) {
    console.log('✗ server_manifest_default 的对象字面量括号不配对，解析失败')
    process.exit(1)
  }
  const jsonStr = source.slice(braceStart, end).replace(/:\s*void 0/g, ': null')
  return JSON.parse(jsonStr) as ServerManifest
}

const manifest = extractManifest(readFileSync(serverEntry, 'utf8'))

// 逐文件 gzip level 9，按文件路径缓存——同一个 chunk 会被多个路由引用，
// 缓存既省时间，也保证「同一份字节」在所有地方读出的是同一个数字。
const gzipCache = new Map<string, number>()
function gzipSizeOf(relPath: string): number {
  const cached = gzipCache.get(relPath)
  if (cached !== undefined) return cached
  const filePath = join(clientDir, relPath)
  if (!existsSync(filePath)) {
    console.log(`✗ manifest 引用了 ${relPath}，但构建产物里没有这个文件`)
    process.exit(1)
  }
  const size = gzipSync(readFileSync(filePath), { level: 9 }).length
  gzipCache.set(relPath, size)
  return size
}

function sumGzip(files: Iterable<string>): number {
  let total = 0
  for (const f of files) total += gzipSizeOf(f)
  return total
}

/** 打印一个文件集合里最重的 6 个 chunk——报错不带这个等于没报。 */
function printHeaviestChunks(files: Iterable<string>, top = 6): void {
  const ranked = [...new Set(files)]
    .map((f) => ({ file: f, kb: gzipSizeOf(f) / 1024 }))
    .sort((a, b) => b.kb - a.kb)
    .slice(0, top)
  for (const { file, kb } of ranked) {
    console.log(`    ${kb.toFixed(2).padStart(8)} KB  ${file}`)
  }
}

// ---- 首屏集：entry ∪ routes.root 各自的 module/imports ----

const sharedFiles = new Set<string>([
  manifest.entry.module,
  ...manifest.entry.imports,
  manifest.routes.root.module,
  ...manifest.routes.root.imports,
])
const sharedKB = sumGzip(sharedFiles) / 1024

let ok = true

if (sharedKB > SHARED_BUDGET_KB) {
  ok = false
  console.log(
    `✗ 首屏共享集 ${sharedKB.toFixed(2)} KB 超出预算 ${SHARED_BUDGET_KB} KB（${sharedFiles.size} 个文件）`,
  )
  console.log('  最重的 6 个 chunk：')
  printHeaviestChunks(sharedFiles)
} else {
  console.log(
    `✓ 首屏共享集 ${sharedKB.toFixed(2)} KB / 预算 ${SHARED_BUDGET_KB} KB（${sharedFiles.size} 个文件）`,
  )
}

// ---- 单路由预算：首屏集 ∪ 该路由（含其祖先布局，root 除外）自身的 module/imports ----

/** 从某路由沿 parentId 一路走到 root（不含 root），返回沿途每一层的 id。 */
function ancestorChainExcludingRoot(routeId: string): string[] {
  const chain: string[] = []
  let cur: RouteManifestEntry | undefined = manifest.routes[routeId]
  while (cur && cur.id !== 'root') {
    chain.push(cur.id)
    cur = cur.parentId ? manifest.routes[cur.parentId] : undefined
  }
  return chain
}

// 可直接访问的路由：有自己的 URL 段，或者是某层的 index 路由。
// 纯用来分组子路由的 pathless layout（如 routes/dash/layout）本身不对外
// 暴露 URL，跳过它自己，但它的 module/imports 会通过祖先链算进它的子路由。
function isVisitableRoute(r: RouteManifestEntry): boolean {
  return r.path !== null || r.index === true
}

/** `--all`：逐路由打印首屏集+自身的读数，并列出首屏集的每个文件。校准头注释时用 */
const PRINT_ALL = process.argv.includes('--all')
if (PRINT_ALL) {
  console.log('  首屏集文件：')
  printHeaviestChunks(sharedFiles, sharedFiles.size)
}

let heaviestRoute: {
  id: string
  path: string | null
  kb: number
  files: Set<string>
} | null = null
const overBudgetRoutes: {
  id: string
  path: string | null
  kb: number
  files: Set<string>
}[] = []

for (const route of Object.values(manifest.routes)) {
  if (route.id === 'root' || !isVisitableRoute(route)) continue

  const files = new Set(sharedFiles)
  for (const ancestorId of ancestorChainExcludingRoot(route.id)) {
    const ancestor = manifest.routes[ancestorId]
    files.add(ancestor.module)
    for (const imp of ancestor.imports) files.add(imp)
  }

  const kb = sumGzip(files) / 1024
  if (PRINT_ALL) {
    console.log(
      `  ${kb.toFixed(2).padStart(8)} KB  ${String(route.path ?? '(index)').padEnd(34)} ${route.id}`,
    )
  }
  if (!heaviestRoute || kb > heaviestRoute.kb) {
    heaviestRoute = { id: route.id, path: route.path, kb, files }
  }
  if (kb > ROUTE_BUDGET_KB) {
    overBudgetRoutes.push({ id: route.id, path: route.path, kb, files })
  }
}

if (overBudgetRoutes.length > 0) {
  ok = false
  overBudgetRoutes.sort((a, b) => b.kb - a.kb)
  for (const r of overBudgetRoutes) {
    console.log(
      `✗ 路由 ${r.path}（${r.id}）首屏集+自身 ${r.kb.toFixed(2)} KB 超出预算 ${ROUTE_BUDGET_KB} KB`,
    )
    console.log('  最重的 6 个 chunk：')
    printHeaviestChunks(r.files)
  }
} else if (heaviestRoute) {
  console.log(
    `✓ 单路由预算：最重的是 ${heaviestRoute.path}（${heaviestRoute.id}）${heaviestRoute.kb.toFixed(2)} KB / 预算 ${ROUTE_BUDGET_KB} KB`,
  )
}

process.exit(ok ? 0 : 1)
