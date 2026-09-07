import { motion, useInView } from 'motion/react'
import { useRef } from 'react'
import { EASE_SUMI, SPRING_WASHI } from '~/lib/motion'

/**
 * dash 列表里「处理掉就会消失」的一行。审核队列与举报处理共用。
 *
 * 配 `<AnimatePresence mode="popLayout">`：退场的那张**同一帧脱离文档流**，
 * 兄弟身上的 `layout="position"` 把它们从旧位置平移到新位置。
 * 只有 `AnimatePresence` 而没有 popLayout 的话，卡片是原地淡出、
 * 下方等它淡完了才整体跳一下——那次跳恰恰是这个动效要消除的东西。
 *
 * **`layout="position"` 不是 `layout`（both）**：卡片挂着 `backdrop-filter`，
 * both 会连尺寸一起做 scale 校正，于是背板模糊逐帧重算，且 CJK 正文
 * 在整个动画时长里被横向拉伸。位置连续性要的只是位置。
 *
 * **`exit` 只有 `opacity`**：motion 在 reduced-motion 下对位移类键是
 * **瞬移到终点**而不是跳过，写了位移就等于给减弱动效的人一次位置突变。
 *
 * 位置走 washi（spring，ζ=1，禁 overshoot），不透明度走 sumi——
 * 这正是两条曲线的语义分工：前者答「我点的那个东西去哪了」，
 * 后者答「它办完了吗」。
 *
 * **`useInView` 门控的是规模，不是入场触发**（全站唯一一处 useInView）：
 * `layout` 每次布局变化都要测量**全部**带 layout 的兄弟。两个 loader 都写死
 * `pageSize: 50`（API schema 上限 100），所以列表恒 ≤50——而 50 正好压在
 * ≈30ms（一帧半）的判定线上。门控后只有视口内的 4–6 张参与测量（≈17ms），
 * 观感一模一样。`margin: '200px'` 让刚滚出视口的几张仍然参与，
 * 免得边界上那张在滚动时忽然不再平移。
 */
export function RemovableRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '200px' })

  return (
    <motion.div
      ref={ref}
      layout={inView ? 'position' : false}
      // 内容层首帧即终态：这一行是内容不是装饰，禁止任何 initial 隐藏态
      initial={false}
      exit={{ opacity: 0 }}
      transition={{
        ...SPRING_WASHI,
        opacity: { duration: 0.18, ease: EASE_SUMI },
      }}
    >
      {children}
    </motion.div>
  )
}
