import { Star } from 'lucide-react'
import { Form } from 'react-router'
import { m } from '~/paraglide/messages'

export const STARS = [1, 2, 3, 4, 5] as const

/**
 * T4 落地的 CSS 累积点亮：悬停/聚焦第 n 颗，1..n 一起亮。
 * 它是 no-JS 与 chunk 未到时的兜底，也是键盘用户的即时反馈——MotionValue 版
 * 叠在它上面，不替换它。
 */
export const STAR_BUTTON_CLASS =
  'relative text-muted-foreground transition-colors hover:text-chart-2 focus-visible:text-chart-2 [&:has(~*:hover)]:text-chart-2 [&:has(~*:focus-visible)]:text-chart-2'

/**
 * 星条的静态形态：显示「我评过几分」（实心金星）与 CSS 累积点亮。
 * 既是 StarStrip 的 Suspense 兜底，也是 no-JS 的完整功能——五个 submit 按钮
 * 原样提交 intent=rate。
 */
export function StaticStars({ myRating }: { myRating: number | null }) {
  return (
    <Form method="post" className="ml-auto flex items-center gap-1">
      <input type="hidden" name="intent" value="rate" />
      {STARS.map((n) => (
        <button
          key={n}
          type="submit"
          name="score"
          value={n}
          aria-label={`${m.detail_rate()} ${n}`}
          aria-pressed={myRating === n}
          className={STAR_BUTTON_CLASS}
        >
          <Star
            className={
              myRating !== null && n <= myRating
                ? 'size-4 fill-current text-chart-2'
                : 'size-4'
            }
          />
        </button>
      ))}
    </Form>
  )
}
