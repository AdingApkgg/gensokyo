import { db, schema } from '@gensokyo/db'
import { setHandleSchema } from '@gensokyo/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { fail, isUniqueViolation, validate } from '../errors'
import { requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'

const { userProfile, notification } = schema

/**
 * 未读数：走 `notification_unread_idx` 部分索引，**上限 100 截断**。
 * 铃铛显示「99+」就够了，数到底既没意义又让一个从不读通知的人拖慢每次 /me。
 * 不做反范式计数器：部分索引随阅读自然缩小，是自愈的；计数器要在
 * 五处同步维护，漏一处永久漂移。
 */
async function unreadCount(userId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select 1 from ${notification}
      where ${notification.userId} = ${userId} and ${notification.readAt} is null
      limit 100
    ) s`)
  return Number(row?.n ?? 0)
}

export const me = new Hono<AppEnv>()
  .get('/', async (c) => {
    const actor = c.get('actor')
    if (!actor) return c.json({ user: null })
    const {
      id,
      name,
      email,
      handle,
      role,
      approvedResourceCount,
      strikeCount,
    } = actor
    return c.json({
      user: {
        id,
        name,
        email,
        handle,
        /** null = 还没自选过，前端据此决定要不要弹认领 */
        handleSetAt: actor.handleSetAt?.toISOString() ?? null,
        role,
        approvedResourceCount,
        strikeCount,
        unread: await unreadCount(id),
      },
    })
  })

  /**
   * 认领 handle。**只能改一次**——它同时进 /u/:handle 与已发布正文里的 @，
   * 改动等于死链 + 重写历史正文，所以 handle_set_at 一旦写入就永久锁定。
   *
   * 注册走客户端 authClient.signUp.email，API 看不到注册；派生值由
   * sessionMiddleware 惰性建档时写入，这里是用户把它换成自选值的唯一机会。
   *
   * UPDATE 的 WHERE 带 `handle_set_at IS NULL`：两次并发认领只有一个能命中行，
   * 另一个拿到 0 行 → 409，而不是后者覆盖前者。
   *
   * **派生 handle 一旦暴露过就不能再换。** 暴露 = 自己发过帖（/u/:handle 可能
   * 已被人贴出去）或被人 @ 过（正文里以纯文本存着 @旧handle）。换了之后旧值
   * 被释放，任何人都能认领它——历史正文里的 @ 与外链全部改指冒充者，
   * 那正是「handle 不可逆」这条红线要挡的。认领是给「注册后立刻自选」这一种
   * 场景的，不是改名功能。
   */
  .put('/handle', requireAuth, validate('json', setHandleSchema), async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const { handle } = c.req.valid('json')
    if (actor.handleSetAt !== null)
      return fail(c, 'invalid_state_transition', 409)

    const [exposed] = await db.execute<{ exposed: boolean }>(sql`
      select exists(select 1 from ${schema.post} where ${schema.post.authorId} = ${actor.id})
          or exists(select 1 from ${notification}
                    where ${notification.userId} = ${actor.id}
                      and ${notification.kind} = 'mention') as exposed`)
    if (exposed?.exposed) return fail(c, 'forbidden', 403, ['handle'])

    try {
      const [updated] = await db
        .update(userProfile)
        .set({ handle, handleSetAt: new Date() })
        .where(
          and(
            eq(userProfile.userId, actor.id),
            isNull(userProfile.handleSetAt),
          ),
        )
        .returning({ handle: userProfile.handle })
      if (!updated) return fail(c, 'invalid_state_transition', 409)
      return c.json({ handle: updated.handle })
    } catch (err) {
      // 23505：被别人占了。与 reports.ts 同一个约定，不新造错误码
      if (isUniqueViolation(err))
        return fail(c, 'duplicate_slug', 409, ['handle'])
      throw err
    }
  })
