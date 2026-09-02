import { db, schema } from '@gensokyo/db'
import {
  type NotificationKind,
  RANKED_NOTIFICATION_KINDS,
} from '@gensokyo/shared'
import { inArray } from 'drizzle-orm'
import { pgErrorCode } from './errors'

const { notification } = schema

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type NotificationDraft = {
  userId: string
  kind: NotificationKind
  actorId?: string | null
  topicId?: string | null
  postId?: string | null
  /** ⚠️ kind='resource_deleted' 绝不能带它——硬删会顺着外键把通知自己级联删掉 */
  resourceId?: string | null
  payload?: Record<string, unknown> | null
}

const RANKED = new Set<string>(RANKED_NOTIFICATION_KINDS)

/**
 * 通知的**唯一**写入口。
 *
 * 扇出的 SELECT（把 @handle 解析成 userId、查父楼作者）在事务**外**做，
 * 写入在事务**内**包一层 SAVEPOINT（`tx.transaction()`）。
 * PG 里事务内任何错误都让事务进 aborted 状态，裸 try/catch 救不回发帖，
 * 只会把失败变成 25P02 这种更难懂的形式——所以必须用嵌套事务。
 * 已实证：内层违反外键被 catch 后，外层写入照常提交。
 *
 * 去重只对 RANKED = {mention, reply} 生效：同一收件人在同一楼层同时被回复
 * 与被 @，只留一条 mention（更具体）。**不在集合里的 kind 直接入队**——通知
 * 不可重算，丢了就是永久丢，而按全局优先级去重会静默丢掉同批次的第二条
 * 治理通知。
 *
 * 自己触发的动作不通知自己。
 *
 * @returns 实际写入的行数；通知失败时为 0——**失败只记日志，绝不让业务写入连坐**
 */
export async function notify(
  tx: Tx,
  drafts: readonly NotificationDraft[],
): Promise<number> {
  const rows: NotificationDraft[] = []
  const ranked = new Map<string, NotificationDraft>()

  for (const d of drafts) {
    if (d.actorId && d.actorId === d.userId) continue
    if (!RANKED.has(d.kind)) {
      rows.push(d)
      continue
    }
    const key = `${d.userId}|${d.postId ?? d.topicId ?? ''}`
    const prev = ranked.get(key)
    if (!prev || (prev.kind === 'reply' && d.kind === 'mention')) {
      ranked.set(key, d)
    }
  }
  rows.push(...ranked.values())
  if (rows.length === 0) return 0

  const toRow = (r: NotificationDraft) => ({
    userId: r.userId,
    kind: r.kind,
    actorId: r.actorId ?? null,
    topicId: r.topicId ?? null,
    postId: r.postId ?? null,
    resourceId: r.resourceId ?? null,
    payload: r.payload ?? null,
  })
  const logSkip = (batch: NotificationDraft[], err: unknown) => {
    // 收件人刚注销（外键）、或别的意外：通知丢了，但帖子/审核结论必须落地
    const cause = (err as { cause?: { detail?: string; constraint?: string } })
      .cause
    console.error('[notify] 写入失败，已跳过', {
      kinds: batch.map((r) => r.kind),
      sqlstate: pgErrorCode(err),
      detail: cause?.detail,
      constraint: cause?.constraint,
    })
  }

  try {
    await tx.transaction(async (sp) => {
      await sp.insert(notification).values(rows.map(toRow))
    })
    return rows.length
  } catch (err) {
    if (rows.length === 1) {
      logSkip(rows, err)
      return 0
    }
    /**
     * 整批在一个 SAVEPOINT 里，一行违例会把同批次全部回滚——被 @ 的人刚好
     * 注销了，楼主本该收到的 reply 也一起没了。异常路径退化成逐行各开一个
     * SAVEPOINT 重试：只多几次往返，且只在出错时发生。
     */
    let written = 0
    for (const r of rows) {
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(notification).values(toRow(r))
        })
        written++
      } catch (rowErr) {
        logSkip([r], rowErr)
      }
    }
    return written
  }
}

/**
 * 把正文里的 @handle 解析成 userId。**事务外调用。**
 * 找不到的 handle 静默忽略——@一个不存在的人不是错误，只是没人收到。
 */
export async function resolveMentions(
  handles: readonly string[],
): Promise<string[]> {
  if (handles.length === 0) return []
  const rows = await db
    .select({ userId: schema.userProfile.userId })
    .from(schema.userProfile)
    .where(inArray(schema.userProfile.handle, [...handles]))
  return rows.map((r) => r.userId)
}
