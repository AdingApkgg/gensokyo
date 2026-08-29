import { Hono } from 'hono'
import { auth } from './auth'
import { kourindou } from './modules/kourindou'

export const app = new Hono()
  .basePath('/api')
  .on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/kourindou', kourindou)

export type AppType = typeof app
