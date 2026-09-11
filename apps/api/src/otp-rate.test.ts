import { afterAll, describe, expect, test } from 'bun:test'
import { app } from './app'
import { countOtpRows, decideOtpRate, OTP_HOURLY_QUOTA } from './otp-rate'
import { cleanupTracked, trackUser } from './testing'

afterAll(cleanupTracked)

describe('decideOtpRate', () => {
  test('冷却窗内有过一次 → 拒绝，并给出等待秒数', () => {
    const r = decideOtpRate(1, 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  test('冷却窗空着但小时配额用尽 → 拒绝', () => {
    const r = decideOtpRate(0, OTP_HOURLY_QUOTA)
    expect(r.ok).toBe(false)
  })

  test('两者都没超 → 放行', () => {
    expect(decideOtpRate(0, 0).ok).toBe(true)
    expect(decideOtpRate(0, OTP_HOURLY_QUOTA - 1).ok).toBe(true)
  })

  test('冷却窗优先于配额报出来 —— 它更早触发，反馈也更直观', () => {
    const r = decideOtpRate(1, OTP_HOURLY_QUOTA)
    expect(r.ok).toBe(false)
    // 冷却窗的等待时间远短于一小时
    if (!r.ok) expect(r.retryAfterSeconds).toBeLessThanOrEqual(60)
  })
})

describe('发码端点的按邮箱限流', () => {
  test('连着要两次验证码，第二次被冷却窗挡住', async () => {
    const email = `rate-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    // 注册本身已经发过一次码（sendVerificationOnSignUp），所以下面这次
    // 必然落在冷却窗里
    const again = await app.request(
      '/api/auth/email-otp/send-verification-otp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, type: 'email-verification' }),
      },
    )
    expect(again.status).toBe(429)
  })

  test('找回密码对不存在的邮箱也返回成功 —— 不泄露邮箱是否注册过', async () => {
    const res = await app.request(
      '/api/auth/email-otp/request-password-reset',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `ghost-${Date.now()}@example.com` }),
      },
    )
    expect(res.status).toBe(200)
  })
})

describe('countOtpRows 的 identifier 拼接与 better-auth 实际写库一致', () => {
  /**
   * ⚠️ 这条测试不测限流逻辑（上面那组已经测过），测的是 identifier 拼接
   * 格式本身。`toIdentifier()` 镜像的是 better-auth **未导出的内部实现**
   * `toOTPIdentifier()`（`email-otp/utils.mjs`），没有任何类型能保护这处
   * 耦合——格式拼错不会报错，只会让 `countOtpRows` 永远数到 0 行，限流
   * 表现成「永远放行」且不抛异常。
   *
   * 所以这里真实触发一次发码（走注册，会触发 sendVerificationOnSignUp），
   * 再直接断言 `countOtpRows` 对同一个邮箱数得到 ≥ 1 行。如果将来
   * better-auth 升级改了 `toOTPIdentifier` 的格式，这条测试会先红——
   * 而不是让限流在生产上静默失效、没有任何门禁能抓到。
   */
  test('真实发一次验证码后，countOtpRows 对该邮箱数得到 ≥ 1 行', async () => {
    const email = `fmt-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    const n = await countOtpRows('email-verification', email)
    expect(n).toBeGreaterThanOrEqual(1)
  })
})
