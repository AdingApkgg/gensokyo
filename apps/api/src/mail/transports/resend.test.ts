import { describe, expect, test } from 'bun:test'
import type { MailConfig } from '../config'
import { buildResendRequest } from './resend'

const cfg: MailConfig = {
  transport: 'resend',
  from: '幻想乡 <noreply@example.com>',
  apiKey: 're_test_key',
}
const msg = {
  to: 'reimu@example.com',
  subject: '验证码',
  text: '你的验证码是 123456',
  html: '<p>你的验证码是 <b>123456</b></p>',
}

describe('buildResendRequest', () => {
  test('打到 Resend 的 emails 端点', () => {
    expect(buildResendRequest(cfg, msg).url).toBe(
      'https://api.resend.com/emails',
    )
  })

  test('带 Bearer 授权头与 JSON content-type', () => {
    const { init } = buildResendRequest(cfg, msg)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer re_test_key')
    expect(headers['content-type']).toBe('application/json')
  })

  test('from 取配置的值而不是收件人域名', () => {
    const { init } = buildResendRequest(cfg, msg)
    const body = JSON.parse(String(init.body)) as { from: string; to: string[] }
    expect(body.from).toBe('幻想乡 <noreply@example.com>')
    expect(body.to).toEqual(['reimu@example.com'])
  })

  test('text 与 html 都带上', () => {
    // 只发 html 会让纯文本客户端与部分反垃圾评分吃亏
    const body = JSON.parse(
      String(buildResendRequest(cfg, msg).init.body),
    ) as Record<string, unknown>
    expect(body.text).toBe(msg.text)
    expect(body.html).toBe(msg.html)
  })
})
