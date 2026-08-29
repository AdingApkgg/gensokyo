import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

const guard = async (c: any, next: any) => {
  if (c.req.header('x-role') !== 'mod') return c.json({ e: 'forbidden' }, 403)
  return next()
}

const sub = new Hono()
  .use('*', guard)
  .get('/queue', (c) => c.json({ ok: 'queue' }))
  .post('/resources/:id/review', (c) => c.json({ ok: 'review' }))
  .post('/reports/:id/resolve', (c) => c.json({ ok: 'resolve' }))

const root = new Hono().basePath('/api').route('/moderation', sub)

describe('hono use(*) coverage', () => {
  test('queue', async () => {
    const r = await root.request('/api/moderation/queue')
    console.log('queue', r.status)
    expect(r.status).toBe(403)
  })
  test('nested review', async () => {
    const r = await root.request('/api/moderation/resources/abc/review', {
      method: 'POST',
    })
    console.log('review', r.status, await r.clone().text())
    expect(r.status).toBe(403)
  })
  test('nested resolve', async () => {
    const r = await root.request('/api/moderation/reports/abc/resolve', {
      method: 'POST',
    })
    console.log('resolve', r.status, await r.clone().text())
    expect(r.status).toBe(403)
  })
})
