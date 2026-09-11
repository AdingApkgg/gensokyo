import { describe, expect, test } from 'bun:test'
import { pickRequestLocale, readCookie } from './request-locale'

describe('readCookie', () => {
  test('从 cookie 头里取出指定的键', () => {
    expect(
      readCookie('a=1; PARAGLIDE_LOCALE=ja; b=2', 'PARAGLIDE_LOCALE'),
    ).toBe('ja')
  })

  test('键不存在返回 null', () => {
    expect(readCookie('a=1', 'PARAGLIDE_LOCALE')).toBeNull()
  })

  test('前缀相同的别的键不会被误认', () => {
    // PARAGLIDE_LOCALE_OLD 不应该被当成 PARAGLIDE_LOCALE
    expect(readCookie('PARAGLIDE_LOCALE_OLD=en', 'PARAGLIDE_LOCALE')).toBeNull()
  })

  test('头为 null 或空串时返回 null', () => {
    expect(readCookie(null, 'x')).toBeNull()
    expect(readCookie('', 'x')).toBeNull()
  })
})

describe('pickRequestLocale', () => {
  test('显式头优先于 cookie', () => {
    expect(pickRequestLocale('ja', 'en')).toBe('ja')
  })

  test('没有头时回落到 cookie', () => {
    expect(pickRequestLocale(null, 'en')).toBe('en')
  })

  test('两者都没有时回落到 zh', () => {
    expect(pickRequestLocale(null, null)).toBe('zh')
  })

  test('不认识的值被忽略而不是原样透传', () => {
    // 'zh-TW' 不是我们的内容语种（简繁是显示层转换，库里只有 zh）
    expect(pickRequestLocale('zh-TW', null)).toBe('zh')
    expect(pickRequestLocale('klingon', 'ja')).toBe('ja')
  })

  test('大小写与空白不敏感', () => {
    expect(pickRequestLocale(' JA ', null)).toBe('ja')
  })
})
