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
 * 原文 + 译名表 → 请求语言的显示值。
 *
 * 原文（`titleOriginal`）在库里是必填的，所以此函数永不返回空串——
 * UGC 现实是大多数投稿只有一种语言，译名是可选增量而非必需。
 */
export function resolveLocalized(
  original: string,
  _originalLocale: Locale | string,
  translations: LocalizedText | null | undefined,
  requested: Locale,
): string {
  const translated = translations?.[requested]
  return translated && translated.trim() !== '' ? translated : original
}
