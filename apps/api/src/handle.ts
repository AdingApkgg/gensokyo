import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'

/**
 * 从 user.id 派生 handle。**不随机生成。**
 *
 * better-auth 的 id 是 32 位随机字母数字串，取小写过滤后的前 8 位加 'u' 前缀。
 * 随机生成需要「生成 → 查重 → 重试」的循环，那个循环没有终止证明；
 * 派生是确定性的，冲突时按固定规则延长前缀，必然终止。
 *
 * ⚠️ **前缀不继承 id 的唯一性**——实测 631 个账号里就有 1 组 8 位前缀相撞。
 * 所以延长逻辑不能省。
 */
const BASE_LEN = 8
const STEP = 4
const MAX_LEN = 19

const filtered = (userId: string) =>
  userId.toLowerCase().replace(/[^a-z0-9]/g, '')

export const deriveHandle = (userId: string, len = BASE_LEN): string =>
  `u${filtered(userId).slice(0, len)}`

/**
 * 取一个当前没被占用的派生 handle。
 *
 * 只在惰性建档时调用一次，所以这里的查重竞态窗口由 DB 的唯一约束兜底：
 * 调用方要捕获唯一违例并用更长的前缀重试。
 */
export async function availableHandle(userId: string): Promise<string> {
  for (let len = BASE_LEN; len <= MAX_LEN; len += STEP) {
    const candidate = deriveHandle(userId, len)
    const [taken] = await db
      .select({ h: schema.userProfile.handle })
      .from(schema.userProfile)
      .where(eq(schema.userProfile.handle, candidate))
      .limit(1)
    if (!taken) return candidate
  }
  // 走到这里说明同一个 id 前缀被占了四轮，这不该发生
  throw new Error(`无法为 ${userId} 派生出未占用的 handle`)
}
