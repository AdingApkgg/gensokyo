import type {
  BoardSlug,
  LicenseStatus,
  LocalizedText,
  ReportReason,
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

/** 六个版块的名字与一句话说明。slug 闭合在 shared 的 BOARD_SLUGS，这里只做文案 */
export const boardLabel = (b: BoardSlug) =>
  ({
    'tea-house': m.board_tea_house(),
    danmaku: m.board_danmaku(),
    workshop: m.board_workshop(),
    'music-hall': m.board_music_hall(),
    kappa: m.board_kappa(),
    meta: m.board_meta(),
  })[b]

export const boardDescription = (b: BoardSlug) =>
  ({
    'tea-house': m.board_tea_house_desc(),
    danmaku: m.board_danmaku_desc(),
    workshop: m.board_workshop_desc(),
    'music-hall': m.board_music_hall_desc(),
    kappa: m.board_kappa_desc(),
    meta: m.board_meta_desc(),
  })[b]

/** 举报 / 删楼理由。删楼的理由集就是举报的理由集 */
export const reportReasonLabel = (r: ReportReason) =>
  ({
    copyright: m.report_reason_copyright(),
    illegal: m.report_reason_illegal(),
    spam: m.report_reason_spam(),
    harassment: m.report_reason_harassment(),
    broken_link: m.report_reason_broken_link(),
    wrong_info: m.report_reason_wrong_info(),
    other: m.report_reason_other(),
  })[r]
