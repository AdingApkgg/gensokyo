import { Hono } from 'hono'
import { auth } from './auth'
import { type AppEnv, sessionMiddleware } from './middleware/session'
import { interactions } from './modules/interactions'
import { kourindou } from './modules/kourindou'
import { me } from './modules/me'
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

export type AppType = typeof app
