import { Hono } from 'hono'
import { auth } from './auth'
import { fail } from './errors'
import { type AppEnv, sessionMiddleware } from './middleware/session'
import { admin, publicConfig } from './modules/admin'
import { interactions } from './modules/interactions'
import { kourindou } from './modules/kourindou'
import { me } from './modules/me'
import { moderation } from './modules/moderation'
import { notifications } from './modules/notifications'
import { reports } from './modules/reports'
import { profiles, shrine } from './modules/shrine'
import { uploads } from './modules/uploads'

export const app = new Hono<AppEnv>()
  .basePath('/api')
  .on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  // auth 路由自己解析会话，之后的路由统一从 c.var.actor 拿
  .use('*', sessionMiddleware)
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/me', me)
  .route('/uploads', uploads)
  .route('/kourindou', kourindou)
  .route('/kourindou', interactions)
  .route('/shrine', shrine)
  .route('/shrine/users', profiles)
  .route('/reports', reports)
  .route('/notifications', notifications)
  .route('/moderation', moderation)
  .route('/admin', admin)
  .route('/config', publicConfig)

/**
 * 兜底：任何未处理异常都要落进统一错误信封。
 * 没有它的话，一个非 UUID 的 :id 会让 Postgres 抛 22P02，
 * Hono 默认回 `text/plain` 的 "Internal Server Error"——
 * 前端按 { error: { code } } 解析会直接崩，三语本地化更无从谈起。
 */
app.onError((err, c) => {
  console.error('[api] unhandled', err)
  return fail(c, 'internal', 500)
})

app.notFound((c) => fail(c, 'not_found', 404))

export type AppType = typeof app
