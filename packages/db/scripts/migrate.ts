/**
 * 应用迁移。
 *
 *   bun run migrate
 *
 * 用 drizzle-orm 自带的迁移器而不是 `drizzle-kit migrate`：
 * `bun --env-file=… x drizzle-kit` 不会把加载的环境变量转发给子进程，
 * drizzle-kit 会拿到 undefined 的连接串。走运行时迁移器就没有这一层。
 */
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from '../src/client'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 未设置')
  process.exit(1)
}

await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })
console.log('migrations applied')
