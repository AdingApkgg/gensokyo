import type {
  LicenseStatus,
  LocalizedText,
  ResourceKind,
} from '@gensokyo/shared'
import { resolveLocalized } from '@gensokyo/shared'
import { m } from '~/paraglide/messages'
import { getLocale } from '~/paraglide/runtime'

/**
 * 多语显示值。api 原样返回 jsonb，回落在这里做——
 * 服务端不知道请求者要哪种语言（同一份数据三种视图）。
 */
export function displayTitle(r: {
  titleOriginal: string
  titleOriginalLocale: string
  title: LocalizedText | null
}) {
  return resolveLocalized(
    r.titleOriginal,
    r.titleOriginalLocale,
    r.title,
    getLocale(),
  )
}

export const kindLabel = (k: ResourceKind) =>
  ({
    game: m.kind_game(),
    music: m.kind_music(),
    doujinshi: m.kind_doujinshi(),
    patch: m.kind_patch(),
    tool: m.kind_tool(),
  })[k]

export const licenseLabel = (l: LicenseStatus) =>
  ({
    allowed: m.license_allowed(),
    unspecified: m.license_unspecified(),
    out_of_print: m.license_out_of_print(),
    licensed: m.license_licensed(),
  })[l]

/** 许可状态的视觉分级：未标明是需要警惕的那一档 */
export const licenseVariant = (
  l: LicenseStatus,
): 'default' | 'secondary' | 'outline' | 'destructive' =>
  ({
    allowed: 'default' as const,
    licensed: 'secondary' as const,
    out_of_print: 'outline' as const,
    unspecified: 'destructive' as const,
  })[l]

export const averageRating = (sum: number, count: number) =>
  count === 0 ? null : Math.round((sum / count) * 10) / 10
