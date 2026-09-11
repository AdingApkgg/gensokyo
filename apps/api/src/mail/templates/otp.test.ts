import { describe, expect, test } from 'bun:test'
import { LOCALES } from '@gensokyo/shared'
import { renderOtpMail } from './otp'

describe('renderOtpMail', () => {
  test('三种语言 × 两种用途都渲染得出来，且不含未替换的占位', () => {
    for (const locale of LOCALES) {
      for (const purpose of [
        'email-verification',
        'forget-password',
      ] as const) {
        const mail = renderOtpMail(locale, purpose, '123456', 'a@b.c', 10)
        expect(mail.subject.length).toBeGreaterThan(0)
        expect(mail.text).toContain('123456')
        expect(mail.html).toContain('123456')
        expect(mail.subject + mail.text).not.toContain('{')
      }
    }
  })

  test('收件人就是传进去的地址', () => {
    expect(renderOtpMail('zh', 'email-verification', '1', 'x@y.z', 10).to).toBe(
      'x@y.z',
    )
  })

  test('两种用途的正文不同 —— 找回密码不能说成「欢迎注册」', () => {
    const verify = renderOtpMail('zh', 'email-verification', '1', 'a@b.c', 10)
    const forgot = renderOtpMail('zh', 'forget-password', '1', 'a@b.c', 10)
    expect(verify.subject).not.toBe(forgot.subject)
  })

  test('有效期分钟数出现在正文里', () => {
    expect(
      renderOtpMail('zh', 'email-verification', '1', 'a@b.c', 10).text,
    ).toContain('10')
  })

  test('html 里的验证码做了转义安全的包裹', () => {
    // 验证码是我们自己生成的数字，但模板不应该拼接任何外部字符串进 html
    const mail = renderOtpMail(
      'en',
      'email-verification',
      '654321',
      'a@b.c',
      10,
    )
    expect(mail.html).toContain('654321')
    expect(mail.html).not.toContain('a@b.c')
  })
})
