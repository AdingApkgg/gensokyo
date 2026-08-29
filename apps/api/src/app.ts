import { Hono } from 'hono'
import { kourindou } from './modules/kourindou'

export const app = new Hono()
  .basePath('/api')
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/kourindou', kourindou)

export type AppType = typeof app
