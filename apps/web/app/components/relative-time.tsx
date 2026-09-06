import { useEffect, useState } from 'react'
import { formatAbsolute, formatRelative } from '~/lib/time'

/** 距离越近刷得越勤；超过一天就不用刷了（「3 天前」不会在你看着的时候变成「4 天前」） */
function periodFor(ageMs: number): number | null {
  if (ageMs < 60_000) return 10_000
  if (ageMs < 3_600_000) return 60_000
  if (ageMs < 86_400_000) return 600_000
  return null
}

/**
 * 相对时间。
 *
 * **首帧必须用服务端时钟**，否则水合不匹配；`suppressHydrationWarning` 是为此
 * 而在的，不能删。但它同时让 React 在水合时**跳过文本差异修补**——所以光有它，
 * 屏幕上那个「3 分钟前」永远停在 SSR 那一刻，慢网与 bfcache 下一开始就是错的。
 *
 * 修法是水合后主动接管：effect 里 setState 触发一次正常渲染，此时 React 会
 * 正常修补文本。之后按距离选间隔自更新。
 *
 * **刻意不做任何过渡**：一屏 50 个时间戳每 30 秒集体动一下，是 50 个余光干扰点。
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string
  className?: string
}) {
  // null = 尚未水合，用 formatRelative 的默认 now（SSR 那一刻）
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const period = periodFor(Date.now() - new Date(iso).getTime())
    if (period === null) return
    const timer = setInterval(() => setNow(Date.now()), period)
    return () => clearInterval(timer)
  }, [iso])

  return (
    <time
      dateTime={iso}
      title={formatAbsolute(iso)}
      suppressHydrationWarning
      className={className}
    >
      {now === null ? formatRelative(iso) : formatRelative(iso, now)}
    </time>
  )
}
