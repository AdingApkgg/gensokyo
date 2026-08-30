import { describe, expect, test } from 'bun:test'
import {
  entityIdSchema,
  HANDLE_RE,
  handleSchema,
  isReservedHandle,
  RESERVED_HANDLES,
  slugIdSchema,
  userIdSchema,
} from './ids'

/**
 * better-auth 1.7.2 的 generateId 是 32 位随机字母数字串，不是 UUID。
 * 用 z.uuid() 校验用户 id 会对每一个真实用户返回 400 —— 这组测试钉住这个区别。
 */
const REAL_BETTER_AUTH_ID = 'Xl0dVwjBxK9cRZ2mQ7pT4sN6yH8gE1aF'
const REAL_UUID = '0192f3c4-5678-7abc-9def-0123456789ab'

describe('id schema 三分', () => {
  test('userIdSchema 接受 better-auth 的 32 位串', () => {
    expect(userIdSchema.parse(REAL_BETTER_AUTH_ID)).toBe(REAL_BETTER_AUTH_ID)
  })

  test('entityIdSchema 拒绝 better-auth 的 id（它不是 UUID）', () => {
    expect(() => entityIdSchema.parse(REAL_BETTER_AUTH_ID)).toThrow()
  })

  test('entityIdSchema 接受 uuid', () => {
    expect(entityIdSchema.parse(REAL_UUID)).toBe(REAL_UUID)
  })

  test('slugIdSchema 接受查找表的 slug，拒绝大写与空格', () => {
    expect(slugIdSchema.parse('th06')).toBe('th06')
    expect(slugIdSchema.parse('c105')).toBe('c105')
    expect(() => slugIdSchema.parse('TH06')).toThrow()
    expect(() => slugIdSchema.parse('th 06')).toThrow()
  })
})

describe('handleSchema（不可逆字段，形状必须钉死）', () => {
  test('接受合法 handle', () => {
    expect(handleSchema.parse('reimu')).toBe('reimu')
    expect(handleSchema.parse('marisa_k')).toBe('marisa_k')
    expect(handleSchema.parse('u0192f3c4')).toBe('u0192f3c4')
    expect(handleSchema.parse('a1')).toBe('a1') // 下限 2 位
  })

  test('长度边界：2–20', () => {
    expect(() => handleSchema.parse('a')).toThrow()
    expect(handleSchema.parse('a'.repeat(20))).toBe('a'.repeat(20))
    expect(() => handleSchema.parse('a'.repeat(21))).toThrow()
  })

  test('首字符必须字母数字——挡住 _admin 这类视觉冒充', () => {
    expect(() => handleSchema.parse('_admin')).toThrow()
    expect(() => handleSchema.parse('_')).toThrow()
  })

  test('纯 ASCII 小写：拒绝大写、连字符、假名、汉字、空格', () => {
    expect(() => handleSchema.parse('Reimu')).toThrow()
    expect(() => handleSchema.parse('with-dash')).toThrow()
    expect(() => handleSchema.parse('れいむ')).toThrow()
    expect(() => handleSchema.parse('灵梦')).toThrow()
    expect(() => handleSchema.parse('a b')).toThrow()
  })

  test('保留字被拒——@admin 被注册是不可逆冒充', () => {
    for (const h of RESERVED_HANDLES) {
      expect(() => handleSchema.parse(h)).toThrow()
    }
  })

  test('isReservedHandle 与 RESERVED_HANDLES 一致', () => {
    expect(isReservedHandle('admin')).toBe(true)
    expect(isReservedHandle('reimu')).toBe(false)
  })

  test('每个保留字本身都是合法形状——否则那条保留没有意义', () => {
    // 若某个保留字连正则都过不了，它根本不可能被注册，写在表里是误导
    for (const h of RESERVED_HANDLES) {
      expect(HANDLE_RE.test(h)).toBe(true)
    }
  })
})
