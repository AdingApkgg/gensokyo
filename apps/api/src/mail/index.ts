import { mailConfig } from './config'
import { sendViaConsole } from './transports/console'
import { sendViaResend } from './transports/resend'
import { sendViaSmtp } from './transports/smtp'

export type Mail = {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * 发信的**唯一出口**。别再写第二份 fetch——与 `lib/upload.ts` 的
 * `uploadImage()` 是同一条约定。
 *
 * transport 在这里才解析（见 config.ts 顶部的说明）。
 */
export async function sendMail(msg: Mail): Promise<void> {
  const cfg = mailConfig()
  switch (cfg.transport) {
    case 'console':
      return sendViaConsole(cfg, msg)
    case 'resend':
      return sendViaResend(cfg, msg)
    case 'smtp':
      return sendViaSmtp(cfg, msg)
  }
}
