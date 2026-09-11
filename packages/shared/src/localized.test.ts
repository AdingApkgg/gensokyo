import { describe, expect, test } from 'bun:test'
import {
  applyTranslation,
  isTranslationOverwrite,
  localizedTextSchema,
  pickLocalized,
  resolveLocalized,
} from './localized'

describe('resolveLocalized', () => {
  test('命中请求语言时用译名，lang 是请求语言', () => {
    expect(
      resolveLocalized('東方紅魔郷', 'ja', { zh: '东方红魔乡' }, 'zh'),
    ).toEqual({ text: '东方红魔乡', lang: 'zh' })
  })

  test('未命中时回落到原文，绝不返回空串', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', {}, 'en')).toEqual({
      text: '東方紅魔郷',
      lang: 'ja',
    })
  })

  /**
   * 承重：日文原名落在中文页上时，没有 lang="ja" 浏览器按简体字形渲染。
   * 回落到原文的那一刻，lang 必须跟着变回原文的语言。
   */
  test('回落到原文时 lang 是原文语言而不是请求语言', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', { en: '' }, 'en').lang).toBe(
      'ja',
    )
  })

  test('译名为空白视为缺失', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', { en: '   ' }, 'en')).toEqual({
      text: '東方紅魔郷',
      lang: 'ja',
    })
  })

  test('译名表为 null 也安全', () => {
    expect(resolveLocalized('東方紅魔郷', 'ja', null, 'zh')).toEqual({
      text: '東方紅魔郷',
      lang: 'ja',
    })
  })

  /** 原文语言是 varchar(8)，历史行可能超出三语；原样带出，别谎报成 zh */
  test('原文语言超出三语时原样带出', () => {
    expect(resolveLocalized('Туман', 'ru', {}, 'zh').lang).toBe('ru')
  })
})

describe('pickLocalized', () => {
  test('命中请求语言', () => {
    expect(pickLocalized({ zh: '中文', ja: '日本語' }, 'ja', 'zh')).toEqual({
      text: '中文',
      lang: 'zh',
    })
  })

  test('未命中时回落到原文语言', () => {
    expect(pickLocalized({ ja: '日本語' }, 'ja', 'en')).toEqual({
      text: '日本語',
      lang: 'ja',
    })
  })

  /**
   * 投稿页曾把描述一律写进 description.zh（不管原文语言是什么），
   * 于是「请求语言 → 原文语言」两步都落空。那批历史行只能靠这一步救。
   */
  test('请求语言与原文语言都落空时取任何非空值', () => {
    expect(pickLocalized({ zh: '中文描述' }, 'ja', 'en')).toEqual({
      text: '中文描述',
      lang: 'zh',
    })
  })

  test('兜底顺序按 LOCALES 定序，可复现', () => {
    expect(pickLocalized({ en: 'E', ja: 'J' }, 'ru', 'ru' as never)).toEqual({
      text: 'J',
      lang: 'ja',
    })
  })

  test('全空返回 null——调用方据此整段不渲染', () => {
    expect(pickLocalized({ zh: '  ' }, 'ja', 'en')).toBeNull()
  })

  test('null 与 undefined 都返回 null', () => {
    expect(pickLocalized(null, 'ja', 'zh')).toBeNull()
    expect(pickLocalized(undefined, 'ja', 'zh')).toBeNull()
  })
})

/**
 * 补译名的权限判据。填空位对任何登录用户开放，覆写只有作者与 staff——
 * 「只让填空」正是这个端点不需要审核队列的全部理由，判据错了就等于把
 * 全站 6,700 条资源的标题交给任何注册十秒的账号改写。
 */
describe('isTranslationOverwrite', () => {
  test('空位上填新值不算覆写', () => {
    expect(isTranslationOverwrite({}, 'zh', '东方红魔乡')).toBe(false)
  })

  test('该语言只有空白字符也算空位', () => {
    expect(isTranslationOverwrite({ zh: '   ' }, 'zh', '东方红魔乡')).toBe(
      false,
    )
  })

  test('别的语言有值不影响本语言的空位判断', () => {
    expect(isTranslationOverwrite({ ja: '東方紅魔郷' }, 'zh', '红魔乡')).toBe(
      false,
    )
  })

  test('改写已有值是覆写', () => {
    expect(isTranslationOverwrite({ zh: '红魔乡' }, 'zh', '东方红魔乡')).toBe(
      true,
    )
  })

  test('清空已有值是覆写', () => {
    expect(isTranslationOverwrite({ zh: '红魔乡' }, 'zh', '')).toBe(true)
  })

  /** 重复提交同一个值不该 403——用户点两下按钮是常事 */
  test('提交与现值完全相同不算覆写', () => {
    expect(isTranslationOverwrite({ zh: '红魔乡' }, 'zh', '红魔乡')).toBe(false)
  })

  /** 存的是 trim 过的值，输入框里多一个尾随空格不该变成 403 */
  test('只差首尾空白不算覆写', () => {
    expect(isTranslationOverwrite({ zh: '红魔乡' }, 'zh', ' 红魔乡 ')).toBe(
      false,
    )
  })

  test('undefined 表示这一栏不动，永远不是覆写', () => {
    expect(isTranslationOverwrite({ zh: '红魔乡' }, 'zh', undefined)).toBe(
      false,
    )
  })

  test('译名表为 null 时一切都是填空', () => {
    expect(isTranslationOverwrite(null, 'zh', '红魔乡')).toBe(false)
  })
})

describe('applyTranslation', () => {
  test('写入一个新语言', () => {
    expect(applyTranslation({ ja: '東方' }, 'zh', '东方')).toEqual({
      ja: '東方',
      zh: '东方',
    })
  })

  test('undefined 表示这一栏不动，原样返回', () => {
    expect(applyTranslation({ ja: '東方' }, 'zh', undefined)).toEqual({
      ja: '東方',
    })
  })

  /**
   * 清空要**删键**而不是写空串：留下 `{zh: ''}` 会让 `title` 这张表里堆满
   * 语义等于「没有」的键，而 Meili 的语言分字段与 hreflang 都按键的存在与否
   * 判断这条资源有没有这种语言。
   */
  test('空串是删键，不是写一个空值', () => {
    expect(applyTranslation({ ja: '東方', zh: '东方' }, 'zh', '')).toEqual({
      ja: '東方',
    })
  })

  test('只有空白字符也是删键', () => {
    expect(applyTranslation({ zh: '东方' }, 'zh', '   ')).toEqual({})
  })

  test('原表为 null 时从空表开始', () => {
    expect(applyTranslation(null, 'zh', '东方')).toEqual({ zh: '东方' })
  })

  test('不改动传进来的那张表', () => {
    const before = { ja: '東方' }
    applyTranslation(before, 'zh', '东方')
    expect(before).toEqual({ ja: '東方' })
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
