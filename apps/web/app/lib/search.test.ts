import { describe, expect, test } from 'bun:test'
import { effectiveSort, sortOptions } from './search'

describe('effectiveSort', () => {
  test('显式 sort 优先', () => {
    expect(effectiveSort('紅魔', 'downloads')).toBe('downloads')
    expect(effectiveSort(null, 'rating')).toBe('rating')
  })
  test('有 q 无 sort → relevance；无 q 无 sort → __all（Select 的「全部」项）', () => {
    expect(effectiveSort('紅魔', null)).toBe('relevance')
    expect(effectiveSort(null, null)).toBe('__all')
    expect(effectiveSort('', null)).toBe('__all')
  })
})

describe('sortOptions', () => {
  test('无 q 时不显示相关度', () => {
    expect(sortOptions(null)).toEqual(['newest', 'downloads', 'rating'])
  })
  test('有 q 时相关度排第一', () => {
    expect(sortOptions('紅魔')).toEqual([
      'relevance',
      'newest',
      'downloads',
      'rating',
    ])
  })
})
