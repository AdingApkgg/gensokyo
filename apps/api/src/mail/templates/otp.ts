import type { Locale } from '@gensokyo/shared'
import type { Mail } from '../index'

export type OtpPurpose = 'email-verification' | 'forget-password'

type Copy = { subject: string; lead: string; hint: string; ignore: string }

/**
 * 邮件文案。**三语齐全靠类型顶**——`check-messages` 扫的是
 * `apps/web/messages`，管不到 api 侧；这里漏一种语言是编译错误。
 *
 * 正文里**不拼接收件人地址等外部字符串**：模板输出直接进 html，
 * 少一个需要记得转义的地方就少一类事故。
 */
const COPY: Record<Locale, Record<OtpPurpose, (minutes: number) => Copy>> = {
  zh: {
    'email-verification': (m) => ({
      subject: '幻想乡 · 邮箱验证码',
      lead: '这是你的邮箱验证码：',
      hint: `${m} 分钟内有效，最多可尝试 3 次。`,
      ignore: '如果这不是你本人的操作，忽略这封信即可，账号不会有任何变化。',
    }),
    'forget-password': (m) => ({
      subject: '幻想乡 · 重置密码验证码',
      lead: '这是你重置密码用的验证码：',
      hint: `${m} 分钟内有效，最多可尝试 3 次。`,
      ignore:
        '如果你没有申请重置密码，忽略这封信即可，你的密码不会被更改。若频繁收到此类邮件，请联系站点管理员。',
    }),
  },
  ja: {
    'email-verification': (m) => ({
      subject: '幻想郷 · メールアドレス確認コード',
      lead: 'メールアドレスの確認コードです：',
      hint: `${m} 分間有効です。入力は 3 回まで試せます。`,
      ignore:
        'お心当たりがない場合は、このメールを破棄してください。アカウントには何の変更も加えられません。',
    }),
    'forget-password': (m) => ({
      subject: '幻想郷 · パスワード再設定コード',
      lead: 'パスワード再設定用の確認コードです：',
      hint: `${m} 分間有効です。入力は 3 回まで試せます。`,
      ignore:
        'パスワード再設定をご依頼でない場合は、このメールを破棄してください。パスワードは変更されません。',
    }),
  },
  en: {
    'email-verification': (m) => ({
      subject: 'Gensokyo · Email verification code',
      lead: 'Here is your email verification code:',
      hint: `It expires in ${m} minutes and can be tried up to 3 times.`,
      ignore:
        "If you didn't request this, you can ignore this message — nothing will change on your account.",
    }),
    'forget-password': (m) => ({
      subject: 'Gensokyo · Password reset code',
      lead: 'Here is your password reset code:',
      hint: `It expires in ${m} minutes and can be tried up to 3 times.`,
      ignore:
        "If you didn't ask to reset your password, ignore this message — your password stays unchanged.",
    }),
  },
}

export function renderOtpMail(
  locale: Locale,
  purpose: OtpPurpose,
  otp: string,
  to: string,
  minutes: number,
): Mail {
  const c = COPY[locale][purpose](minutes)
  return {
    to,
    subject: c.subject,
    text: `${c.lead}\n\n    ${otp}\n\n${c.hint}\n\n${c.ignore}`,
    html: [
      '<div style="font-family:system-ui,sans-serif;line-height:1.7">',
      `<p>${c.lead}</p>`,
      `<p style="font-size:28px;letter-spacing:.3em;font-weight:700;margin:24px 0">${otp}</p>`,
      `<p>${c.hint}</p>`,
      `<p style="color:#666;font-size:13px">${c.ignore}</p>`,
      '</div>',
    ].join(''),
  }
}
