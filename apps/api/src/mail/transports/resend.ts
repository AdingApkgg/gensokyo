import type { MailConfig } from '../config'
import type { Mail } from '../index'

/**
 * 请求的构造抽成纯函数，这样不打网络就能测。
 * 零依赖：一个 fetch，不装 resend SDK。
 */
export function buildResendRequest(
  cfg: Extract<MailConfig, { transport: 'resend' }>,
  msg: Mail,
): { url: string; init: RequestInit } {
  return {
    url: 'https://api.resend.com/emails',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        subject: msg.subject,
        // 两种都发：只发 html 会让纯文本客户端与部分反垃圾评分吃亏
        text: msg.text,
        html: msg.html,
      }),
    },
  }
}

export async function sendViaResend(
  cfg: Extract<MailConfig, { transport: 'resend' }>,
  msg: Mail,
): Promise<void> {
  const { url, init } = buildResendRequest(cfg, msg)
  const res = await fetch(url, init)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[mail:resend] ${res.status} ${detail.slice(0, 200)}`)
  }
}
