import { db, schema } from '@gensokyo/db'
import { and, eq } from 'drizzle-orm'

/**
 * Google 撞车仲裁：**能证明邮箱所有权的人获胜**。
 *
 * 挂在 `databaseHooks.account.create.after`，即「链接成功之后」。这个位置
 * 是从 better-auth 的实现顺序推出来的，不是随便挑的：
 *
 *   linkAccount → [本钩子] → updateUser({emailVerified:true}) → createSession
 *
 * 三个后果：
 *
 * 1. 钩子跑的时候 `emailVerified` **还是 false**，所以它能当判据；
 * 2. 本次登录的 session **还没建**，所以「吊销全部会话」不会误伤刚登录的人——
 *    不需要写「排除当前会话」的逻辑，那只会排除掉一个 null；
 * 3. 链接已经成功了，所以**不存在「密码删了但 Google 没接上」的锁死**。
 *
 * 三种情形被一个条件自动分开：
 *
 * | 情形 | emailVerified | 有 credential | 动作 |
 * |---|---|---|---|
 * | Google 建的新号 | true（Google 给的） | 无 | 不动 |
 * | 本地已验证 + 接上 Google | true | 有 | 不动 |
 * | 本地未验证（抢注） | false | 有 | 删密码 + 吊销会话 |
 *
 * 敢动那个账号，是因为「未验证账号不持有任何对外可见的内容」——这条由
 * `requireVerified` 保证。被删了密码的人若真是本人，可以用找回密码把密码
 * 装回来（better-auth 在没有 credential 行时会自动创建一行）；抢注者读不到
 * 那个邮箱，走不了这条路。
 *
 * ⚠️ **依赖 `accountLinking.requireLocalEmailVerified: false`**，而那个选项
 * 已标 deprecated、下个小版本会变成无条件。升级 better-auth 之后本函数不再
 * 被触发，行为退回「拒绝链接」——是**朝安全方向的退化**，不是开天窗，但
 * 未验证用户会卡住。`arbitrate.test.ts` 的第一条会在那时变红。
 */
export async function takeoverIfUnverified(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  if (!row || row.emailVerified) return false

  const removed = await db
    .delete(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential'),
      ),
    )
    .returning({ id: schema.account.id })
  // 没有密码可删 = 不是抢注，别顺手吊销人家的会话
  if (removed.length === 0) return false

  await db.delete(schema.session).where(eq(schema.session.userId, userId))
  return true
}
