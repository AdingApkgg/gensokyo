import { describe, expect, test } from 'bun:test'
import { pageWindow } from './paging'

describe('pageWindow', () => {
  test('总页数少时全列出', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
  })

  test('当前页在中间：首尾常在，中间是前后各两页', () => {
    expect(pageWindow(10, 20)).toEqual([1, 8, 9, 10, 11, 12, 20])
  })

  test('当前页贴首：不越界到 0 或负数', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 20])
  })

  test('当前页贴尾：不越界超过 total', () => {
    expect(pageWindow(20, 20)).toEqual([1, 18, 19, 20])
  })

  test('单页：只有 1，不重复', () => {
    expect(pageWindow(1, 1)).toEqual([1])
  })

  test('total 不足 1（如空列表算出的 0 页）：clamp 到 1 页', () => {
    expect(pageWindow(1, 0)).toEqual([1])
  })

  test('结果永远升序且无重复', () => {
    const w = pageWindow(5, 30)
    expect(w).toEqual([...new Set(w)].sort((a, b) => a - b))
  })
})
