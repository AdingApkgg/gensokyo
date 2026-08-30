import type { UserRole } from '@gensokyo/shared'
import { createMiddleware } from 'hono/factory'
import { fail } from '../errors'
import type { Actor, AppEnv } from './session'

const RANK: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 }

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('actor')) return fail(c, 'unauthorized', 401)
  return next()
})

export const requireRole = (min: UserRole) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    if (RANK[actor.role] < RANK[min]) return fail(c, 'forbidden', 403)
    return next()
  })

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
