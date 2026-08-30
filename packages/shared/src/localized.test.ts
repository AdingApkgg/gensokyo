import { describe, expect, test } from 'bun:test'
import { localizedTextSchema, resolveLocalized } from './localized'

describe('resolveLocalized', () => {
  test('命中请求语言时用译名', () => {
    expect(
      resolveLocalized('東方紅魔郷', 'ja', { zh: '东方红魔乡' }, 'zh'),
    ).toBe('东方红魔乡')
  })

  test('未命中时回落到原文，绝不返回空串', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', {}, 'en')).toBe('東方紅魔郷')
  })

  test('译名为空白视为缺失', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', { en: '   ' }, 'en')).toBe(
      '東方紅魔郷',
    )
  })

  test('译名表为 null 也安全', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', null, 'zh')).toBe('東方紅魔郷')
  })
})

describe('localizedTextSchema', () => {
  test('接受空对象（对应 jsonb NOT NULL DEFAULT {}）', () => {
    expect(localizedTextSchema.parse({})).toEqual({})
  })

  test('接受部分语言', () => {
    expect(localizedTextSchema.parse({ zh: '中文名' })).toEqual({
      zh: '中文名',
    })
  })

  test('拒绝未知语言', () => {
    expect(() => localizedTextSchema.parse({ fr: 'bonjour' })).toThrow()
  })
})
