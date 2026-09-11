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
 *
 * ⚠️ `default` 那条穷尽性守卫**不是摆设**，它补的是一处类型上的不对称：
 * `parseMailEnv` 的返回类型是 `MailConfig`，加第四个 transport 时那边会**编译
 * 报错**（返回值少了一支）；而这里的返回类型是 `Promise<void>`，少一支
 * `case` 会被隐式的 `undefined` 悄悄接住——同一个改动，一边报错、一边静默
 * 地「发不出任何信但也不报错」。`const _: never = cfg` 把这半边也变成编译
 * 错误。
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
    default: {
      const unreachable: never = cfg
      throw new Error(
        `未知的邮件 transport：${JSON.stringify(unreachable)}——sendMail 少了一支 case`,
      )
    }
  }
}
