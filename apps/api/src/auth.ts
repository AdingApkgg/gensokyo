import { db } from '@gensokyo/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  // 硬编码 localhost 会让生产域名不在信任列表里、登录全废；
  // 但也绝不能退化成 '*'，那会连 better-auth 的 CSRF 防线一起拆掉
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
})
