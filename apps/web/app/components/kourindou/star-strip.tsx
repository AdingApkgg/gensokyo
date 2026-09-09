import { Star } from 'lucide-react'
import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { useEffect } from 'react'
import { Form } from 'react-router'
import { SPRING_WASHI_VALUE } from '~/lib/motion'
import { m } from '~/paraglide/messages'
import { STAR_BUTTON_CLASS, STARS } from './stars'

/**
 * 扫笔填充的星条（spec §8.2）。
 *
 * 一个连续的 0..5 MotionValue：指针在星条上的横坐标映射过来，每颗星按自己的
 * 区间 [n-1, n] 算填充比例，用 clipPath 露出叠在上面的实心金星——指针扫过去，
 * 填充跟着笔走，不是五档离散跳变。指针离开回到「我评过的分」。
 *
 * 提交期乐观保持：submittingScore 由 detail.tsx 从 useNavigation().formData 读出，
 * 从点下到 revalidate 回来之前星条一直显示刚点的那个分。
 *
 * 红线 6：MotionValue 直连 style 不受 MotionConfig 管——减弱动效下不走 spring，
 * 直接用原始值（指针跟随是直接操纵不是动画，离开时瞬回而不是回弹）。
 *
 * 含 motion，由 detail.tsx 通过 lazy() 加载，只在登录用户处渲染（C1）。
 * 兜底与 no-JS 形态是 StaticStars，两者共用 STAR_BUTTON_CLASS。
 */
export default function StarStrip({
  myRating,
  submittingScore,
}: {
  myRating: number | null
  submittingScore: number | null
}) {
  const reduce = useReducedMotion()
  const base = submittingScore ?? myRating ?? 0
  const pointer = useMotionValue(base)
  const spring = useSpring(pointer, SPRING_WASHI_VALUE)
  useEffect(() => {
    pointer.set(base)
  }, [pointer, base])
  const shown = reduce ? pointer : spring

  return (
    <Form
      method="post"
      className="ml-auto flex items-center gap-1"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const v = ((e.clientX - r.left) / r.width) * STARS.length
        pointer.set(Math.max(0, Math.min(STARS.length, v)))
      }}
      onPointerLeave={() => pointer.set(base)}
    >
      <input type="hidden" name="intent" value="rate" />
      {STARS.map((n) => (
        <StarButton
          key={n}
          n={n}
          shown={shown}
          pressed={(submittingScore ?? myRating) === n}
          onFocus={() => pointer.set(n)}
          onBlur={() => pointer.set(base)}
        />
      ))}
    </Form>
  )
}

function StarButton({
  n,
  shown,
  pressed,
  onFocus,
  onBlur,
}: {
  n: number
  shown: MotionValue<number>
  pressed: boolean
  onFocus: () => void
  onBlur: () => void
}) {
  // 这颗星的填充比例：shown 落在 [n-1, n] 之间时按比例，之外是 0 或 1
  const clipPath = useTransform(shown, (v) => {
    const fill = Math.max(0, Math.min(1, v - (n - 1)))
    return `inset(0 ${(1 - fill) * 100}% 0 0)`
  })
  return (
    <button
      type="submit"
      name="score"
      value={n}
      aria-label={`${m.detail_rate()} ${n}`}
      aria-pressed={pressed}
      className={STAR_BUTTON_CLASS}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Star className="size-4" />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 text-chart-2"
        style={{ clipPath }}
      >
        <Star className="size-4 fill-current" />
      </motion.span>
    </button>
  )
}
