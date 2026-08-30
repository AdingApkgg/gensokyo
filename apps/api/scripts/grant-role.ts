/**
 * 给已注册的账号授予角色。
 *
 *   bun run grant-role -- <email> admin
 *   bun run grant-role -- <email> moderator
 *   bun run grant-role -- <email> user          # 收回权限
 *   bun run grant-role -- --list                # 列出所有非普通用户
 *
 * 刻意**不创建账号**：账号得你自己在站上注册，密码只有你知道。
 * 这个脚本只做提权，是站长权限的唯一引导路径——线上不该有任何 HTTP 端点
 * 能把人提成 admin，否则那个端点本身就是最大的攻击面。
 */
import { db, schema } from '@gensokyo/db'
import { USER_ROLE, type UserRole } from '@gensokyo/shared'
import { eq, ne } from 'drizzle-orm'

const args = process.argv.slice(2).filter((a) => a !== '--')

async function list() {
  const rows = await db
    .select({
      email: schema.user.email,
      name: schema.user.name,
      role: schema.userProfile.role,
      approved: schema.userProfile.approvedResourceCount,
      strikes: schema.userProfile.strikeCount,
    })
    .from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.user.id, schema.userProfile.userId))
    .where(ne(schema.userProfile.role, 'user'))

  if (rows.length === 0) {
    console.log('没有任何 moderator 或 admin。')
    return
  }
  for (const r of rows) {
    console.log(
      `${r.role.padEnd(10)} ${r.email.padEnd(36)} ${r.name}  ` +
        `(通过 ${r.approved} · 违规 ${r.strikes})`,
    )
  }
}

async function grant(email: string, role: UserRole) {
  const [u] = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1)

  if (!u) {
    console.error(
      `找不到 ${email}。\n先在站上注册这个邮箱（密码由你自己设），再跑这个脚本。`,
    )
    process.exit(1)
  }

  // profile 是首次带会话请求时惰性创建的，脚本里可能还不存在
  await db
    .insert(schema.userProfile)
    .values({ userId: u.id, role })
    .onConflictDoUpdate({
      target: schema.userProfile.userId,
      set: { role },
    })

  console.log(`${u.name} <${email}> → ${role}`)
}

async function main() {
  if (args[0] === '--list' || args.length === 0) return list()

  const [email, role] = args
  if (!email || !role || !USER_ROLE.includes(role as UserRole)) {
    console.error(
      `用法: bun run grant-role -- <email> <${USER_ROLE.join('|')}>\n` +
        '      bun run grant-role -- --list',
    )
    process.exit(1)
  }
  await grant(email, role as UserRole)
}

await main()
