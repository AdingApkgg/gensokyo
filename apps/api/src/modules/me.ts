import { Hono } from 'hono'
import type { AppEnv } from '../middleware/session'

export const me = new Hono<AppEnv>().get('/', (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ user: null })
  const { id, name, email, role, approvedResourceCount, strikeCount } = actor
  return c.json({
    user: { id, name, email, role, approvedResourceCount, strikeCount },
  })
})
