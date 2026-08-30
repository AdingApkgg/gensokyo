import { db, schema } from '../../src'

/**
 * 给一个资源挂它的讨论主题。
 *
 * 六个 seed 脚本原本各抄了一遍这段，而它们抄的那一版**写了 title**——
 * 那正是一条 CHECK（topic_kind_shape）能一次打穿六处的原因。
 *
 * 资源主题一律不存标题快照：快照不随资源 PATCH 更新，而且它是单语的
 * （资源标题本身是 titleOriginal + 三语 jsonb 一束），显示时从 resource 现取。
 *
 * lastPostAt 显式写：它是 NOT NULL 且是最新流的排序键，
 * 让它落默认值也对，但写出来是为了说明这条主题「有时间」而不是碰巧有。
 */
export async function createResourceTopic(
  resourceId: string,
  authorId: string,
  at: Date = new Date(),
) {
  await db.insert(schema.topic).values({
    kind: 'resource',
    resourceId,
    authorId,
    lastPostAt: at,
  })
}

/**
 * 建种子账号，**并同时建 user_profile**。
 *
 * profile 平时是 sessionMiddleware 惰性建的，而种子脚本不走 HTTP。
 * 缺行的话该账号没有 handle，它名下的主题在最新流里会渲染出 /u/undefined
 * 的死链——「每个 user 都有 profile 行」是 M4 依赖的一条不变量。
 */
export function seedHandle(seedUserId: string): string {
  // 与迁移和 sessionMiddleware 相同的派生规则：'u' + 过滤后的前 8 位。
  // 种子 id 是 'demo-importer' 这类可读串，过滤掉连字符后取前 8 位。
  const filtered = seedUserId.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `u${filtered.slice(0, 8)}`
}

export async function ensureSeedUser(opts: {
  id: string
  email: string
  name: string
  handle: string
}) {
  await db
    .insert(schema.user)
    .values({
      id: opts.id,
      email: opts.email,
      name: opts.name,
      emailVerified: true,
    })
    .onConflictDoNothing({ target: schema.user.id })

  await db
    .insert(schema.userProfile)
    .values({ userId: opts.id, handle: opts.handle })
    .onConflictDoNothing({ target: schema.userProfile.userId })
}
