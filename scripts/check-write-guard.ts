/**
 * 写闸门禁：
 *   bun run check-write-guard
 *
 * 断言：`/api` 下每一个非 GET 路由的中间件链里都出现了一道守卫
 * （`requireVerified` 或 `requireRole`），豁免必须写进下面的显式名单。
 *
 * 为什么需要它：api 的测试**刻意不进 CI**（要真实的 pg/redis/Meili/MinIO），
 * 所以「新加的写端点忘了挂验证闸」这类回归在 CI 里没有任何东西会响，
 * 而它的表现是一个安全洞，不是一个报错。这条门禁是这块工作里唯一能在
 * CI 跑的保障。
 *
 * **走运行时自省而不是扫源码。** 判据是**函数身份**：`app.routes` 里每条
 * 记录的 `handler` 就是中间件函数本身（实测 `r.handler === requireAuth`
 * 为 true），而守卫在 `middleware/require.ts` 里登记进一个 WeakSet。
 * 这样改路径、改文件名、改路由写法都不会让门禁失灵——正则会。
 * `requireRole('admin')` 每次调用产生新函数，也只有 WeakSet 认得出。
 *
 * ⚠️ **两类条目要分开处理**（实测得到，不要想当然）：
 *
 * - 逐路由的守卫（`.post(p, requireVerified, …)`）与该路由同 method+path，
 *   出现在同一个分组里；
 * - 子应用的前缀守卫（`.use('*', requireRole('admin'))`）是**独立的
 *   `ALL /api/admin/*` 条目**，不会并进 `PATCH /api/admin/config` 的分组。
 *   漏掉这一类会把 moderation / admin 下的 7 个写端点全部误报。
 *
 * 只用 Bun 内置能力，不引依赖。`DATABASE_URL` 缺失时 import 不会抛错，
 * 所以裸 runner 上可跑。
 */
import { app } from '../apps/api/src/app'
import { isGuard } from '../apps/api/src/middleware/require'

type Row = { method: string; path: string; handler: unknown }

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** better-auth 自己挂的处理器。它有自己的一套闸，不归这条门禁管 */
const NOT_OURS = new Set(['/api/auth/*'])

/**
 * 显式豁免：**登录即可、不要求邮箱验证**的「账号内务」端点。
 *
 * 判据是「是否产出对外可见的内容」。这两个产出的都不是内容：
 * 认领 handle 产出一个标识符，而未验证账号拿不出任何东西挂在它下面；
 * 标记通知已读只动自己的收件箱。
 *
 * **往这里加一行就是一次安全决策**，写清楚理由再加。
 */
const ALLOWED_UNVERIFIED = new Set([
  'PUT /api/me/handle',
  'POST /api/notifications/read',
])

const rows = (app as unknown as { routes: Row[] }).routes

// 前缀守卫：'/api/admin/*' → '/api/admin/'
const prefixGuards = rows
  .filter(
    (r) => r.method === 'ALL' && r.path.endsWith('/*') && isGuard(r.handler),
  )
  .map((r) => r.path.slice(0, -1))

const groups = new Map<string, Row[]>()
for (const r of rows) {
  if (r.method === 'ALL' || READ_METHODS.has(r.method)) continue
  if (NOT_OURS.has(r.path)) continue
  const key = `${r.method} ${r.path}`
  const list = groups.get(key)
  if (list) list.push(r)
  else groups.set(key, [r])
}

const unguarded: string[] = []
const exempt: string[] = []
for (const [key, entries] of groups) {
  if (ALLOWED_UNVERIFIED.has(key)) {
    exempt.push(key)
    continue
  }
  const guarded =
    entries.some((r) => isGuard(r.handler)) ||
    prefixGuards.some((p) => entries[0].path.startsWith(p))
  if (!guarded) unguarded.push(key)
}

// 名单腐烂检查：豁免了一个已经不存在的路由，说明名单该清理了
const stale = [...ALLOWED_UNVERIFIED].filter((k) => !groups.has(k))

console.info(
  `[check-write-guard] 非 GET 路由 ${groups.size} 条，已挂守卫 ${
    groups.size - unguarded.length - exempt.length
  } 条，显式豁免 ${exempt.length} 条`,
)
for (const k of exempt) console.info(`  豁免：${k}`)

if (stale.length > 0) {
  console.error('\n[check-write-guard] 豁免名单里有已经不存在的路由：')
  for (const k of stale) console.error(`  ${k}`)
}

if (unguarded.length > 0) {
  console.error('\n[check-write-guard] 下列写端点没有挂验证闸：')
  for (const k of unguarded) console.error(`  ${k}`)
  console.error(
    '\n修法二选一：\n' +
      '  1. 给它挂 requireVerified（或 requireRole）——绝大多数情况是这条；\n' +
      '  2. 如果它确实是「登录即可」的账号内务端点，把它加进脚本顶部的\n' +
      '     ALLOWED_UNVERIFIED 并写清楚理由。那是一次安全决策。',
  )
}

if (unguarded.length > 0 || stale.length > 0) process.exit(1)
console.info('[check-write-guard] 通过')
