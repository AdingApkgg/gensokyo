import { describe, expect, test } from 'bun:test'
import { verifyStep } from './verify-step'

describe('verifyStep', () => {
  test('未登录 → anonymous', () => {
    expect(verifyStep(null)).toBe('anonymous')
  })

  test('没验证邮箱 → otp，即使 handle 也没认领', () => {
    // 顺序不能反：先证明邮箱是你的，再让你占一个公开标识符
    expect(verifyStep({ emailVerified: false, handleSetAt: null })).toBe('otp')
  })

  test('验证了但没认领 handle → handle', () => {
    expect(verifyStep({ emailVerified: true, handleSetAt: null })).toBe(
      'handle',
    )
  })

  test('两段都完成 → done', () => {
    expect(
      verifyStep({ emailVerified: true, handleSetAt: '2026-09-11T00:00:00Z' }),
    ).toBe('done')
  })

  test('Google 注册的用户（邮箱天生已验证）直接落到 handle 段', () => {
    // 这正是 /verify 兼做认领页的理由：OAuth 路径上没有注册表单，
    // 「注册成功后立刻认领 handle」那一次性机会在那条路上不存在
    expect(verifyStep({ emailVerified: true, handleSetAt: null })).toBe(
      'handle',
    )
  })

  test('已验证且已认领的老用户误入本页 → done（页面据此立刻跳走）', () => {
    expect(
      verifyStep({ emailVerified: true, handleSetAt: '2020-01-01T00:00:00Z' }),
    ).toBe('done')
  })
})
