/**
 * 写闸门禁：
 *   bun run check-write-guard
 *
 * 断言：`/api` 下每一个非 GET 路由的中间件链里，都有一道守卫
 * （`requireVerified` 或 `requireRole`）排在终结 handler 之前，豁免必须写进
 * 下面的显式名单。
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
 * ⚠️ **守卫必须排在 handler 之前，光「出现过」不够**（同样是实测驱动，不是
 * 想当然）：Hono 按注册顺序执行中间件链，终结 handler 不调用 `next()`——
 * `.post(p, handler, requireVerified)` 这种守卫误放在 handler 之后的写法，
 * 在 `app.routes` 里两个函数依然都会被记录、`isGuard` 依然命中，但运行时
 * 守卫永远执行不到，形同虚设。探针验证过（对 3 个已知的多中间件路由，
 * 逐条打印分组内每个条目的 isGuard 结果与位置）：同一 method+path 分组内，
 * `app.routes` 的条目严格按源码注册顺序排列，终结 handler 恒在最后一位。
 * 所以判据从「组内出现过守卫」升级成「组内某个守卫的位置严格早于最后
 * 一位」，且把「守卫存在但顺序错了」与「压根没挂守卫」分开报——两者的
 * 修法不一样。前缀守卫（上一条）天然满足这个位置要求：它在子应用级别
 * `.use('*', …)`，必然先于子应用内任何一条路由自己的 handler 执行，不需要
 * 再检查位置。
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
 * 判据是「是否产出对外可见的内容」。标记通知已读只动自己的收件箱，
 * 不产出任何对外可见的东西。
 *
 * `PUT /api/me/handle` **曾经**也在这张名单里，2026-09-11 复审推翻：原判据
 * 「未验证账号没有内容可挂」只说明不挂闸不会立刻造成可见滥用，不等于
 * 必须不挂闸。handle 是不可逆的公开标识符（进 `/u/:handle`、进已发布正文的
 * 纯文本 @mention），挂 `requireVerified` 不挡任何真实用户——`/verify` 本来
 * 就是验证在前、认领在后，Google 注册的用户邮箱天生已验证——却能堵住
 * 绕开页面直接打接口抢注一个拿不回来的标识符那条路。现已按 `requireVerified`
 * 处理，不再豁免。
 *
 * **往这里加一行就是一次安全决策**，写清楚理由再加。
 */
const ALLOWED_UNVERIFIED = new Set(['POST /api/notifications/read'])

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
const misordered: string[] = []
const exempt: string[] = []
for (const [key, entries] of groups) {
  if (ALLOWED_UNVERIFIED.has(key)) {
    exempt.push(key)
    continue
  }
  // 最后一个条目是终结 handler（探针验证过：app.routes 按注册顺序排列）。
  // 守卫必须出现在它之前才算数——出现在最后一位等于排在了 handler 之后。
  const lastIndex = entries.length - 1
  const guardIndices = entries
    .map((r, i) => (isGuard(r.handler) ? i : -1))
    .filter((i) => i >= 0)
  const guarded =
    guardIndices.some((i) => i < lastIndex) ||
    prefixGuards.some((p) => entries[0].path.startsWith(p))
  if (!guarded) {
    if (guardIndices.length > 0) misordered.push(key)
    else unguarded.push(key)
  }
}

// 名单腐烂检查：豁免了一个已经不存在的路由，说明名单该清理了
const stale = [...ALLOWED_UNVERIFIED].filter((k) => !groups.has(k))

console.info(
  `[check-write-guard] 非 GET 路由 ${groups.size} 条，已挂守卫 ${
    groups.size - unguarded.length - misordered.length - exempt.length
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

if (misordered.length > 0) {
  console.error(
    '\n[check-write-guard] 下列写端点守卫挂了，但排在 handler 之后，运行时不会执行：',
  )
  for (const k of misordered) console.error(`  ${k}`)
  console.error(
    '\nHono 按注册顺序执行中间件链，终结 handler 不调用 next()——排在它之后的\n' +
      '中间件永远跑不到。把守卫挪到 handler 之前（通常是链上第一个参数）。',
  )
}

if (unguarded.length > 0 || misordered.length > 0 || stale.length > 0)
  process.exit(1)
console.info('[check-write-guard] 通过')
