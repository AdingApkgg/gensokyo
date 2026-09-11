import { z } from 'zod'

export const LOCALES = ['zh', 'ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** 允许 `{}`，与 `title jsonb NOT NULL DEFAULT '{}'` 一致 */
export const localizedTextSchema = z.partialRecord(
  z.enum(LOCALES),
  z.string().max(2000),
)
export type LocalizedText = z.infer<typeof localizedTextSchema>

/**
 * 显示值 + 它**实际所属的语言**。
 *
 * `lang` 是承重的，不是装饰：中文页上落一个日文原名时，没有 `lang="ja"`
 * 浏览器就按简体字形渲染它（「直」「海」「骨」「今」的字形两边不同）。
 * 这正是 `post.locale` 当初要修的那个显示错误，资源标题同样需要。
 *
 * 值是 `string` 而非 `Locale`：`title_original_locale` 是 varchar(8)，
 * 历史行可能超出三语。原样带出好过谎报成 zh——浏览器会忽略它读不懂的
 * 语言标记，而一个错误的标记会真的选错字体。
 */
export type LocalizedValue = { text: string; lang: string }

const nonEmpty = (s: string | undefined): s is string =>
  s !== undefined && s.trim() !== ''

/**
 * 原文 + 译名表 → 请求语言的显示值。
 *
 * 原文（`titleOriginal`）在库里是必填的，所以此函数永不返回空串——
 * UGC 现实是大多数投稿只有一种语言，译名是可选增量而非必需。
 *
 * 未命中请求语言时回落**原文**，不回落另一种译名：原文是这条资源的规范
 * 标识，对读不懂两者的第三种语言的读者来说，它比另一种译名更有用。
 */
export function resolveLocalized(
  original: string,
  originalLocale: Locale | string,
  translations: LocalizedText | null | undefined,
  requested: Locale,
): LocalizedValue {
  const translated = translations?.[requested]
  return nonEmpty(translated)
    ? { text: translated, lang: requested }
    : { text: original, lang: originalLocale }
}

/**
 * 没有「原文」列的多语字段——`resource.description`、`tag.name`。
 *
 * 回落顺序：请求语言 → 原文语言 → 任何非空。最后一步按 {@link LOCALES}
 * 定序而不是按对象键序，好让同一行数据在任何机器上取到同一个值。
 *
 * 全空时返回 `null`：调用方据此**整段不渲染**，而不是渲染一个空段落。
 */
export function pickLocalized(
  translations: LocalizedText | null | undefined,
  originalLocale: Locale | string,
  requested: Locale,
): LocalizedValue | null {
  if (!translations) return null
  for (const lang of [requested, originalLocale, ...LOCALES]) {
    const text = translations[lang as Locale]
    if (nonEmpty(text)) return { text, lang }
  }
  return null
}

/**
 * 这次补译名是**覆写**还是**填空**？
 *
 * 「只让填空」是社区补译名不需要审核队列的**全部理由**：新增一个原本不存在
 * 的译名是纯增量，错了由作者或 staff 覆写即可；而改写别人已经写好的值是
 * 编辑他人内容，那要走 `isOwnerOrStaff`。判据错一次，等于把全站资源的标题
 * 交给任何注册十秒的账号改写。
 *
 * - `next === undefined` —— 这一栏不动，永远不是覆写
 * - 现值空白（含只有空格）—— 填空
 * - 提交值与现值逐字符相同 —— 不是覆写：用户点两下按钮不该吃 403
 * - 其余（改写、清空）—— 覆写
 */
export function isTranslationOverwrite(
  existing: LocalizedText | null | undefined,
  locale: Locale,
  next: string | undefined,
): boolean {
  if (next === undefined) return false
  const current = existing?.[locale]
  if (!nonEmpty(current)) return false
  // 两侧都 trim 再比：写入走 applyTranslation 是存 trim 过的值，而经
  // createResource 落库的旧值没有。不归一化的话，一个尾随空格就能让
  // 「重复提交」被判成覆写，陌生人平白吃一个 403。
  return current.trim() !== next.trim()
}

/**
 * 把一次补译名写进多语表，返回新表（不改原表）。
 *
 * 空值**删键**而不是写空串：`{ zh: '' }` 的语义等于「没有中文名」，但它在
 * 每一处按「键存不存在」判断的地方都表现为「有」——Meili 的分语言字段会
 * 因此多出一个空文档字段，hreflang 会为一个并不存在的语言版本发出声明。
 */
export function applyTranslation(
  existing: LocalizedText | null | undefined,
  locale: Locale,
  next: string | undefined,
): LocalizedText {
  const out: LocalizedText = { ...(existing ?? {}) }
  if (next === undefined) return out
  if (nonEmpty(next)) out[locale] = next.trim()
  else delete out[locale]
  return out
}
