import type { UserRole } from '@gensokyo/shared'
import { createMiddleware } from 'hono/factory'
import { fail } from '../errors'
import type { Actor, AppEnv } from './session'

const RANK: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 }

/**
 * 写闸的登记处。`scripts/check-write-guard.ts` 枚举 `app.routes` 时，靠
 * **函数身份**（不是名字、不是正则）判断一条路由挂没挂守卫——`requireRole('admin')`
 * 每次调用都产生新函数，只有把它们登记进来才认得出。
 */
const guards = new WeakSet<object>()

const markGuard = <T extends object>(mw: T): T => {
  guards.add(mw)
  return mw
}

/** 给门禁脚本用 */
export const isGuard = (fn: unknown): boolean =>
  typeof fn === 'function' && guards.has(fn as object)

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('actor')) return fail(c, 'unauthorized', 401)
  return next()
})

/**
 * 已登录**且邮箱已验证**。挂在一切「造对外可见内容」的写端点上。
 *
 * **401 必须先于 403**：未登录用户看到「邮箱未验证」毫无意义，而且那会泄露
 * 一点点状态机的形状。与 `requireAuth` 永远在 `entityIdParam` 之前是同一类考虑。
 *
 * 判据来自 `Actor.emailVerified`，那是 better-auth 的 session.user 直接搬过来的，
 * 不查库不加列。
 */
export const requireVerified = markGuard(
  createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    if (!actor.emailVerified) return fail(c, 'email_unverified', 403)
    return next()
  }),
)

export const requireRole = (min: UserRole) =>
  markGuard(
    createMiddleware<AppEnv>(async (c, next) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      // staff 也要验证过邮箱。老账号由迁移一次性刷成已验证，新 staff
      // 是从已验证用户里提拔的，所以这一条不会挡住任何真实的人。
      if (!actor.emailVerified) return fail(c, 'email_unverified', 403)
      if (RANK[actor.role] < RANK[min]) return fail(c, 'forbidden', 403)
      return next()
    }),
  )

/**
 * 作者本人或 moderator 以上。
 *
 * ⚠️ **编辑他人正文时不要用这个**——那种场合要 `isSelf`。
 * staff 可以「删」他人的东西（留痕、可申诉），但不能「改」他人的话：
 * 改完之后没有任何痕迹说明原文是什么，作者也无从申诉。
 */
export const isOwnerOrStaff = (actor: Actor, ownerId: string | null) =>
  actor.id === ownerId || RANK[actor.role] >= RANK.moderator

/**
 * **只有本人**，staff 也不行。
 *
 * 它存在的理由是让正确写法比错误写法更短：`isOwnerOrStaff` 在仓库里出现
 * 六次且全部是「作者或 staff」，靠注释防住第七次不现实。
 */
export const isSelf = (actor: Actor, ownerId: string | null) =>
  actor.id === ownerId
