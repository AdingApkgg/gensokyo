import { Hono } from 'hono'
import { auth } from '../auth'

export const me = new Hono().get('/', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ user: null })
  const { id, name, email, image } = session.user
  return c.json({ user: { id, name, email, image: image ?? null } })
})
