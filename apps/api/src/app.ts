import { Hono } from 'hono'
import { auth } from './auth'
import { kourindou } from './modules/kourindou'
import { me } from './modules/me'

export const app = new Hono()
  .basePath('/api')
  .on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/me', me)
  .route('/kourindou', kourindou)

export type AppType = typeof app
