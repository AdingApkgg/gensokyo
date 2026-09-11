import type { MailConfig } from '../config'
import type { Mail } from '../index'

/**
 * dev 与测试的默认通道。**它有两个职责，缺一不可**：
 *
 * 1. 别在开发时往真实邮箱发信；
 * 2. 让验证码能从 stdout 取到——`bun run e2e` 的注册链路靠这个读码。
 */
export async function sendViaConsole(
  cfg: MailConfig,
  msg: Mail,
): Promise<void> {
  console.info(
    `[mail:console] from=${cfg.from} to=${msg.to}\n  subject: ${msg.subject}\n  ${msg.text}`,
  )
}
