import { LOCALES, type Locale } from './localized'

/** 显式头。**刻意不用 `Accept-Language`** —— 见下。 */
export const LOCALE_HEADER = 'x-gensokyo-locale'

/** Paraglide 的 cookie 策略写的键（vite 配置里 strategy 含 'cookie'） */
export const LOCALE_COOKIE = 'PARAGLIDE_LOCALE'

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * 决定一封邮件用哪种语言写。
 *
 * **不读 `Accept-Language`**：那是浏览器语言，不是用户在站内选的界面语言，
 * 两者经常不一致——在日文站浏览的中文用户是常态。这与「UGC 的语言按写它的人
 * 当时的界面语言归档」是同一条原则。
 *
 * 不认识的值**被忽略而不是原样透传**：`zh-TW` 不是内容语种（简繁是显示层
 * 转换，库里永远只有一个 zh），透传会让模板查表落空。
 */
export function pickRequestLocale(
  header: string | null | undefined,
  cookie: string | null | undefined,
): Locale {
  for (const candidate of [header, cookie]) {
    const v = candidate?.trim().toLowerCase()
    if (v && (LOCALES as readonly string[]).includes(v)) return v as Locale
  }
  return 'zh'
}
