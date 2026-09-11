import { describe, expect, test } from 'bun:test'
import { forgotStep } from './forgot-step'

describe('forgotStep', () => {
  test('还没请求过 → email', () => {
    expect(forgotStep({ requested: false, reset: false })).toBe('email')
  })

  test('请求过还没重置 → reset', () => {
    expect(forgotStep({ requested: true, reset: false })).toBe('reset')
  })

  test('重置完成 → done', () => {
    expect(forgotStep({ requested: true, reset: true })).toBe('done')
  })

  test('没请求就标记重置完成是不可能的状态，按 done 处理不回退', () => {
    // 页面不该因为一个自相矛盾的状态把用户打回第一步重来
    expect(forgotStep({ requested: false, reset: true })).toBe('done')
  })
})
