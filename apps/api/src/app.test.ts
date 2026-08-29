import { describe, expect, test } from 'bun:test'
import { app } from './app'

describe('api skeleton', () => {
  test('health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  test('资源列表返回分页信封', async () => {
    const res = await app.request('/api/kourindou/resources')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: unknown[]
      page: number
      pageSize: number
      total: number
    }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
    expect(typeof body.total).toBe('number')
  })

  test('非法分页参数 400', async () => {
    const res = await app.request('/api/kourindou/resources?pageSize=9999')
    expect(res.status).toBe(400)
  })
})
