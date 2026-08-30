import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

const create = () =>
  drizzle({
    connection: {
      url: process.env.DATABASE_URL as string,
      max: 10,
      // 空闲连接自己回收：脚本跑完不显式 close 也不会长期占着槽位
      idleTimeout: 20,
      maxLifetime: 60 * 30,
      connectionTimeout: 10,
    },
    schema,
  })

/**
 * 连接池跨热重载复用。
 *
 * `bun run --hot` 不换进程，而是在原进程里重新求值整个模块图。每求值一次
 * 这里就会新建一个连接池（10 条连接），而旧池没有任何人持有、也没有任何人
 * 关闭它。改十来次文件就能把 Postgres 默认的 100 个连接槽占满，此后所有
 * 查询——包括登录用的 select from "user"——一起报
 * `remaining connection slots are reserved for roles with the SUPERUSER attribute`。
 *
 * globalThis 活得比模块久，是热重载场景下唯一能拿到「上一次的池」的地方。
 * 生产环境没有热重载，这里恒等于普通的单例，无副作用。
 */
declare global {
  var __gensokyoDb: ReturnType<typeof create> | undefined
}

const pool = globalThis.__gensokyoDb ?? create()
globalThis.__gensokyoDb = pool

export const db = pool
