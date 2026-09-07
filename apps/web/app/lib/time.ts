import { getLocale } from '~/paraglide/runtime'

const intlLocale: Record<string, string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  en: 'en-US',
}
const tag = () => intlLocale[getLocale()] ?? 'zh-CN'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/**
 * 相对时间。首帧用服务端时钟是对的——SSR 与水合时钟不同，调用方要给 `<time>`
 * 加 `suppressHydrationWarning` 才能避免水合不匹配。但光靠这个文本就会永远
 * 停在 SSR 那一刻：`suppressHydrationWarning` 只是让 React 跳过水合时的文本
 * 修补，客户端并不会重新计算。水合后的接管在 `~/components/relative-time`
 * 的 `RelativeTime` 组件——用它而不是裸调这个函数拼 `<time>`。
 */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(tag(), { numeric: 'auto' })
  if (abs < 60) return rtf.format(0, 'second')
  for (const [unit, secs] of UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit)
  }
  return ''
}

/**
 * 绝对时间**显式带时区**：SSR 跑在容器里（UTC），不传 timeZone 输出的是慢 8 小时
 * 的字符串，而 React 19 水合不修补属性差异——title 里那个值会永远是服务端算的。
 * 按站点语言选时区并把时区名印出来，字符串自解释。
 */
const zoneOf: Record<string, string> = {
  zh: 'Asia/Shanghai',
  ja: 'Asia/Tokyo',
  en: 'UTC',
}
export const formatAbsolute = (iso: string) =>
  // 不能用 dateStyle/timeStyle：它们与 timeZoneName 互斥，Intl 会直接抛 TypeError——
  // 而这个函数在每一楼的 <time title> 里都会被调，抛了就是整页 500
  new Intl.DateTimeFormat(tag(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zoneOf[getLocale()] ?? 'UTC',
    timeZoneName: 'short',
  }).format(new Date(iso))

/**
 * `RelativeTime` 的自更新间隔：距离越近刷得越勤，超过一天就不刷了
 *（「3 天前」不会在你看着的时候变成「4 天前」）。返回 `null` 表示不起 interval。
 *
 * 放在这里而不是组件里，是为了能被 `bun test` 直接测——档位边界是这段逻辑里
 * 唯一会写错的地方，而组件本身没什么可测的。
 *
 * `ageMs` 允许是**负数**（服务端时钟快于客户端时，帖子看起来来自未来）：
 * 那会落进最勤的 10 秒档，几秒内就自己纠正过来，正是想要的。
 */
export function periodFor(ageMs: number): number | null {
  if (ageMs < 60_000) return 10_000
  if (ageMs < 3_600_000) return 60_000
  if (ageMs < 86_400_000) return 600_000
  return null
}
