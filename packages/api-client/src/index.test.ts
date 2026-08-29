import { expect, test } from 'bun:test'
import { app } from '@gensokyo/api'
import { testClient } from 'hono/testing'

test('hc 类型链路端到端', async () => {
  const client = testClient(app)
  const res = await client.api.kourindou.resources.$get({
    query: { page: '2', pageSize: '5' },
  })
  expect(res.status).toBe(200)
  if (res.status !== 200) throw new Error('unreachable')
  const body = await res.json()
  expect(body.page).toBe(2)
})
