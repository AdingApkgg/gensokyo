import { Hono } from 'hono'
import { auth } from './auth'
import { type AppEnv, sessionMiddleware } from './middleware/session'
import { content } from './modules/content'
import { interactions } from './modules/interactions'
import { kourindou } from './modules/kourindou'
import { me } from './modules/me'
import { moderation } from './modules/moderation'
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
  .route('/kourindou', content)
  .route('/moderation', moderation)

export type AppType = typeof app
