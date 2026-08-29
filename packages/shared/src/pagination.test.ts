import { describe, expect, test } from 'bun:test'
import { paginationQuerySchema } from './pagination'

describe('paginationQuerySchema', () => {
  test('空输入给默认值', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })
  test('字符串数字被 coerce', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    })
  })
  test('pageSize 超上限拒绝', () => {
    expect(() => paginationQuerySchema.parse({ pageSize: 101 })).toThrow()
  })
})
