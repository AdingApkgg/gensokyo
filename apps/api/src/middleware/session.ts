import { db, schema } from '@gensokyo/db'
import type { UserRole } from '@gensokyo/shared'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { auth } from '../auth'
import { availableHandle } from '../handle'

export type Actor = {
  id: string
  name: string
  email: string
  /** 稳定标识：进 /u/:handle 与正文里的 @ */
  handle: string
  role: UserRole
  approvedResourceCount: number
  strikeCount: number
  /**
   * profile 的建档时间——**不是注册时间**。
   * 它是「首次带会话访问 API」的时刻，外链禁令的账号年龄判据用的就是它。
   */
  createdAt: Date
}

export type AppEnv = { Variables: { actor: Actor | null } }

/**
 * 解析会话并把 user + user_profile 合成 actor 注入上下文。
 * 首次见到的用户惰性创建 profile，省掉注册钩子。
 */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    c.set('actor', null)
    return next()
  }

  const row = await loadOrCreateProfile(session.user.id)

  c.set('actor', {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    handle: row.handle,
    role: row.role,
    approvedResourceCount: row.approvedResourceCount,
    strikeCount: row.strikeCount,
    createdAt: row.createdAt,
  })
  return next()
})

const selectProfile = (userId: string) =>
  db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, userId))
    .limit(1)

/**
 * 惰性建档。全站每一个带会话的请求都走这里，所以它的失败必须是显式的。
 *
 * 三处刻意的写法：
 *
 * 1. **`onConflictDoNothing` 必须带 target。** 不带 target 时它会吞掉这张表上
 *    的**任何**唯一违例——加了 handle 唯一约束之后，handle 撞车也会被当成
 *    「行已存在」静默跳过，于是 profile 建不成、`returning()` 空、actor 落默认值，
 *    而 `UPDATE ... WHERE user_id` 会更新 0 行且不报错：
 *    **信任梯度对这个用户永久失效，且没有任何日志。**
 *
 * 2. **冲突后重新 SELECT**，不依赖 `returning()`。`onConflictDoNothing` 命中冲突时
 *    返回空数组，那不代表行不存在——它恰恰代表行已经存在。
 *
 * 3. **handle 唯一违例单独捕获并延长前缀重试。** 派生前缀不继承 id 的唯一性。
 */
async function loadOrCreateProfile(userId: string) {
  const [existing] = await selectProfile(userId)
  if (existing) return existing

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const [created] = await db
        .insert(schema.userProfile)
        .values({ userId, handle: await availableHandle(userId) })
        .onConflictDoNothing({ target: schema.userProfile.userId })
        .returning()
      if (created) return created

      // 命中 userId 冲突：行已经被并发请求建好了，重查一次
      const [row] = await selectProfile(userId)
      if (row) return row
    } catch (err) {
      // 23505 = 唯一违例。这里只可能是 handle 撞车（userId 冲突走上面的分支），
      // 下一轮 availableHandle 会看到新占用的值并给出更长的前缀
      if (!isUniqueViolation(err)) throw err
    }
  }
  throw new Error(`无法为 ${userId} 建立 user_profile`)
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: string }).code === '23505'

/**
 * 信任梯度：通过 N 个资源且无违规记录 → 即发即审。
 * strikeCount > 0 直接清零信任，这是唯一的惩罚机制。
 *
 * 门槛由站点配置决定（admin 可改），没配置时回落到编译期常量。
 */
export const canAutoPublish = (actor: Actor, threshold: number) =>
  actor.strikeCount === 0 && actor.approvedResourceCount >= threshold
