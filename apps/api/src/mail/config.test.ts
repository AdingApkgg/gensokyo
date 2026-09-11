import { describe, expect, test } from 'bun:test'
import { parseMailEnv } from './config'

describe('parseMailEnv', () => {
  test('不配 MAIL_TRANSPORT 时默认 console，且不要求任何凭据', () => {
    const cfg = parseMailEnv({})
    expect(cfg.transport).toBe('console')
  })

  test('console 分支不因为缺 RESEND_API_KEY 而失败', () => {
    // 这条钉的是「测试环境不该因为少一个生产变量就整套跑不起来」
    expect(() => parseMailEnv({ MAIL_TRANSPORT: 'console' })).not.toThrow()
  })

  test('resend 分支缺 RESEND_API_KEY 时抛错', () => {
    expect(() =>
      parseMailEnv({ MAIL_TRANSPORT: 'resend', MAIL_FROM: 'a <a@b.c>' }),
    ).toThrow()
  })

  test('resend 分支齐全时解析出 apiKey', () => {
    const cfg = parseMailEnv({
      MAIL_TRANSPORT: 'resend',
      MAIL_FROM: 'a <a@b.c>',
      RESEND_API_KEY: 're_xxx',
    })
    expect(cfg.transport).toBe('resend')
    if (cfg.transport === 'resend') expect(cfg.apiKey).toBe('re_xxx')
  })

  test('smtp 分支缺 SMTP_HOST 时抛错', () => {
    expect(() =>
      parseMailEnv({
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'a <a@b.c>',
        SMTP_PORT: '465',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    ).toThrow()
  })

  test('smtp 的 PORT 从字符串转成数字，SECURE 从字符串转成布尔', () => {
    const cfg = parseMailEnv({
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'a <a@b.c>',
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PORT: '465',
      SMTP_USER: 'resend',
      SMTP_PASS: 'p',
      SMTP_SECURE: 'true',
    })
    if (cfg.transport !== 'smtp') throw new Error('分支判断错了')
    expect(cfg.port).toBe(465)
    expect(cfg.secure).toBe(true)
  })

  test('未知的 MAIL_TRANSPORT 抛错，不静默回落到 console', () => {
    // 静默回落会让生产上一个拼错的值表现成「邮件发不出去但没有报错」
    expect(() => parseMailEnv({ MAIL_TRANSPORT: 'sendgrid' })).toThrow()
  })
})
