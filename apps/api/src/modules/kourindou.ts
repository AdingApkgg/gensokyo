import { paginationQuerySchema } from '@gensokyo/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

export const kourindou = new Hono().get(
  '/resources',
  zValidator('query', paginationQuerySchema),
  (c) => {
    const { page, pageSize } = c.req.valid('query')
    return c.json({ items: [] as never[], page, pageSize })
  },
)
