import { mailConfig } from './config'
import { sendViaConsole } from './transports/console'

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
    default:
      // resend / smtp 在 Task 2 接上
      throw new Error(`未实现的邮件通道：${cfg.transport}`)
  }
}
