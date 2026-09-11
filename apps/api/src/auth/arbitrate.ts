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
 * ⚠️⚠️ **这次仲裁是一次性的，而且不可重试**——下面每一条都建立在这上面：
 *
 * 钩子挂在 `account.create.after`，所以它对每个 account 行**只触发一次**。
 * 重试 Google 登录会命中已链接账号的 token 刷新分支（`link-account.mjs`
 * 135–181 行），不再走 `createWithHooks`，本函数也就不会被第二次调用，
 * 而那条分支**会**执行 `updateUser({ emailVerified: true })`。也就是说：
 * 这一次没接管成功，就永远不会接管了，且事后**无法辨认**——`emailVerified`
 * 已经是 true，与「本来就是已验证账号接上 Google」长得一模一样。
 *
 * 两次 delete 因此必须包在同一个事务里：若断线或死锁恰好夹在删密码与删会话
 * 之间，用户就会卡在「密码已删、会话还在」——正是这个设计要杜绝的状态——
 * 而且没有重试能补救。宁可两个 delete 都不生效，也不要只生效一半。
 *
 * 同理，函数体整个包 try/catch，**吞掉异常只留一条日志**，不往上抛：
 *
 * - 抛也救不回来。`account` 行在 `create.after` 跑之前就已经提交了
 *   （`queueAfterTransactionHook` 没有 `onError` 时原样 re-throw，
 *   `with-hooks.mjs:33` 没给），抛出去只会被 `link-account.mjs` 的泛用
 *   catch 变成 `{ error: "unable to link account" }`。链接**已经落库**，
 *   抛错撤不掉它。
 * - 抛了反而更糟：用户看到一次莫名其妙的登录失败 → 再点一次 → 走的是上面
 *   那条已链接分支 → 登录成功、`emailVerified` 置 true、抢注者的密码原封
 *   不动，而第二次连这条日志都不会再打。等于把同一个洞藏得更深。
 *
 * 所以出口只有一个：**打一条带 userId 的、能被搜到的日志**，让运维能手工
 * 核对 `account` 表（`delete from account where user_id = '…' and
 * provider_id = 'credential'`，再吊销该用户的 session）。想让它真正可恢复，
 * 得把仲裁挪到「每次 Google 登录都会跑」的位置去，那是另一个设计决定，
 * 不在本次修复范围内。
 *
 * ⚠️ **依赖 `accountLinking.requireLocalEmailVerified: false`**，而那个选项
 * 已标 deprecated、下个小版本会变成无条件。升级 better-auth 之后本函数不再
 * 被触发，行为退回「拒绝链接」——是**朝安全方向的退化**，不是开天窗，但
 * 未验证用户会卡住。`arbitrate.test.ts` 的第一条会在那时变红。
 */
export async function takeoverIfUnverified(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ emailVerified: schema.user.emailVerified })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)
    if (!row || row.emailVerified) return false

    return await db.transaction(async (tx) => {
      const removed = await tx
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

      await tx.delete(schema.session).where(eq(schema.session.userId, userId))
      return true
    })
  } catch (err) {
    // 这条日志是整件事**唯一**的痕迹，见上面长注释：不抛、不重试、事后
    // 认不出来。所以它必须带 userId 且措辞可搜
    console.error(
      `[auth] 抢注仲裁失败 userId=${userId} 需人工核对 account 表（该用户的 credential 行可能仍在、会话可能未吊销）`,
      err,
    )
    return false
  }
}
