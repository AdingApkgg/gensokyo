import { db, schema } from '@gensokyo/db'
import type { UserRole } from '@gensokyo/shared'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { auth } from '../auth'

export type Actor = {
  id: string
  name: string
  email: string
  role: UserRole
  approvedResourceCount: number
  strikeCount: number
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

  const [profile] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, session.user.id))
    .limit(1)

  const row =
    profile ??
    (
      await db
        .insert(schema.userProfile)
        .values({ userId: session.user.id })
        .onConflictDoNothing()
        .returning()
    )[0]

  c.set('actor', {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: row?.role ?? 'user',
    approvedResourceCount: row?.approvedResourceCount ?? 0,
    strikeCount: row?.strikeCount ?? 0,
  })
  return next()
})

/**
 * 信任梯度：通过 N 个资源且无违规记录 → 即发即审。
 * strikeCount > 0 直接清零信任，这是唯一的惩罚机制。
 *
 * 门槛由站点配置决定（admin 可改），没配置时回落到编译期常量。
 */
export const canAutoPublish = (actor: Actor, threshold: number) =>
  actor.strikeCount === 0 && actor.approvedResourceCount >= threshold
