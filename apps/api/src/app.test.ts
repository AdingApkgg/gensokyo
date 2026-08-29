import { describe, expect, test } from 'bun:test'
import { app } from './app'

describe('api skeleton', () => {
  test('health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
  test('kourindou resources 带分页默认值', async () => {
    const res = await app.request('/api/kourindou/resources')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], page: 1, pageSize: 20 })
  })
  test('非法分页参数 400', async () => {
    const res = await app.request('/api/kourindou/resources?pageSize=9999')
    expect(res.status).toBe(400)
  })
})
