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
 * 相对时间。SSR 与水合时钟不同，调用方要给 `<time>` 加 suppressHydrationWarning——
 * 这是相对时间的固有属性，不是 bug。
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
