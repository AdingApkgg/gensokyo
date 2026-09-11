import { createTransport, type Transporter } from 'nodemailer'
import type { MailConfig } from '../config'
import type { Mail } from '../index'

let transporter: Transporter | null = null

/**
 * SMTP 通道存在的理由是**换服务商只改环境变量**：Resend 对国内邮箱
 * （QQ / 163 / 126）的送达率是真实风险，而那种失败是静默的——后台显示
 * delivered，用户那边什么都没收到。真出了问题，换成腾讯企业邮 / 阿里云
 * 邮件推送不需要改代码。
 *
 * 连接池复用一个 transporter：每封信重建连接会在发信高峰被服务商限速。
 */
export async function sendViaSmtp(
  cfg: Extract<MailConfig, { transport: 'smtp' }>,
  msg: Mail,
): Promise<void> {
  transporter ??= createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // 不设 pool 的话 nodemailer 每次 sendMail 都会新开一条连接再关闭——
    // 复用 transporter 只省了重建这个 JS 配置对象，省不了握手。
    pool: true,
  })
  await transporter.sendMail({
    from: cfg.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  })
}
