import { describe, expect, test } from 'bun:test'
import { buildFilter, buildSort, toDoc } from './search'

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'touhou-koumakyou',
  titleOriginal: '東方紅魔郷',
  title: { zh: '东方红魔乡', en: 'Embodiment of Scarlet Devil' },
  description: { zh: '第六作' },
  kind: 'game' as const,
  license: 'allowed' as const,
  circleId: null,
  uploaderId: 'u_1',
  circleNameRaw: '上海アリス幻樂団',
  coverUrl: null,
  downloadCount: 3,
  ratingSum: 9,
  ratingCount: 2,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  status: 'published' as const,
  deletedAt: null,
}

describe('toDoc', () => {
  test('三语标题摊平成数组，原文在最前', () => {
    const doc = toDoc(row, ['th06'])
    expect(doc.titles).toEqual([
      '東方紅魔郷',
      '东方红魔乡',
      'Embodiment of Scarlet Devil',
    ])
    expect(doc.descriptions).toEqual(['第六作'])
    expect(doc.tagIds).toEqual(['th06'])
  })

  test('rating 是均分，无评分时为 0；createdAt 是毫秒数', () => {
    expect(toDoc(row, []).rating).toBe(4.5)
    expect(toDoc({ ...row, ratingCount: 0, ratingSum: 0 }, []).rating).toBe(0)
    expect(toDoc(row, []).createdAt).toBe(Date.UTC(2026, 0, 2))
  })

  test('文档不带 status / deletedAt——可见性不是索引的事', () => {
    const doc = toDoc(row, []) as Record<string, unknown>
    expect('status' in doc).toBe(false)
    expect('deletedAt' in doc).toBe(false)
  })
})

describe('buildFilter', () => {
  test('什么都不传 → undefined', () => {
    expect(buildFilter({})).toBeUndefined()
  })

  test('全部条件 AND 起来，tag 用 IN', () => {
    expect(
      buildFilter({
        kind: 'game',
        license: 'allowed',
        tag: ['th06', 'th07'],
        circleId: '22222222-2222-4222-8222-222222222222',
        uploaderId: 'u_1',
      }),
    ).toBe(
      'kind = "game" AND license = "allowed" AND tagIds IN ["th06", "th07"] AND circleId = "22222222-2222-4222-8222-222222222222" AND uploaderId = "u_1"',
    )
  })

  test('字符串值里的引号与反斜杠被转义（userId 是任意字符串）', () => {
    expect(buildFilter({ uploaderId: 'a"b\\c' })).toBe(
      'uploaderId = "a\\"b\\\\c"',
    )
  })

  test('空 tag 数组等于没传', () => {
    expect(buildFilter({ tag: [] })).toBeUndefined()
  })
})

describe('buildSort', () => {
  test('四档映射', () => {
    expect(buildSort('relevance')).toBeUndefined()
    expect(buildSort('newest')).toEqual(['createdAt:desc'])
    expect(buildSort('downloads')).toEqual(['downloadCount:desc'])
    expect(buildSort('rating')).toEqual(['rating:desc'])
  })
})
