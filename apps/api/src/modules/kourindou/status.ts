import type { ResourceStatus, UserRole } from '@gensokyo/shared'

/**
 * 资源状态机。这是唯一真相——不给每个跃迁开一条具名 URL，
 * 那等于把状态机在 URL 空间里再编码一遍，两处必然漂移。
 */
const ALLOWED: Record<ResourceStatus, ResourceStatus[]> = {
  draft: ['pending', 'published'],
  pending: ['published', 'draft'],
  published: ['delisted'],
  delisted: ['published'],
}

/** 只有 staff 能碰的跃迁：审核结论与上下架 */
const STAFF_ONLY: ReadonlyArray<`${ResourceStatus}->${ResourceStatus}`> = [
  'pending->published',
  'pending->draft',
  'published->delisted',
  'delisted->published',
]

export type TransitionActor = {
  role: UserRole
  isOwner: boolean
  /** 信任梯度允许即发即审 */
  canAutoPublish: boolean
}

export function canTransition(
  from: ResourceStatus,
  to: ResourceStatus,
  actor: TransitionActor,
): boolean {
  if (!ALLOWED[from].includes(to)) return false

  const isStaff = actor.role === 'moderator' || actor.role === 'admin'
  if (STAFF_ONLY.includes(`${from}->${to}`)) return isStaff

  // draft->published 只有信任达标的作者本人（或 staff）能走
  if (from === 'draft' && to === 'published') {
    return isStaff || (actor.isOwner && actor.canAutoPublish)
  }
  // draft->pending 是投稿
  return actor.isOwner || isStaff
}

/** 投稿时的落点：信任达标直接发布，否则进审核队列 */
export const submitTarget = (canAutoPublish: boolean): ResourceStatus =>
  canAutoPublish ? 'published' : 'pending'
