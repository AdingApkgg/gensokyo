import { useEffect, useState } from 'react'
import { formatAbsolute, formatRelative, periodFor } from '~/lib/time'

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
    const at = new Date(iso).getTime()
    setNow(Date.now())

    /**
     * 自排队的 setTimeout 而不是 setInterval：档位要**每次都重算**。
     * 定时器只在挂载时算一次的话，一条挂载时才 30 秒的通知会以 10 秒的节奏
     * 一直刷到标签页关闭——哪怕它早已过了一天、`periodFor` 已经该返回 null。
     */
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const period = periodFor(Date.now() - at)
      if (period === null) return
      timer = setTimeout(() => {
        setNow(Date.now())
        tick()
      }, period)
    }
    tick()
    return () => clearTimeout(timer)
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
