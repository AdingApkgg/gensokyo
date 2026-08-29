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

/** 作者本人或 moderator 以上 */
export const isOwnerOrStaff = (actor: Actor, ownerId: string | null) =>
  actor.id === ownerId || RANK[actor.role] >= RANK.moderator
