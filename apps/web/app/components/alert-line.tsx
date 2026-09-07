import { AnimatePresence, motion } from 'motion/react'
import { EASE_SUMI } from '~/lib/motion'

/**
 * 卡内那一行「出错了 / 这么做会有后果」的提示。
 *
 * 它解决的不是好看，是**手跟不上**：这些提示全都紧贴着按钮出现，
 * 一出现就把一个可点击目标瞬间顶走位置——而失败路径恰恰最需要「再点一次」。
 * `height: auto` 是 CSS 至今动不了的东西，所以用 popLayout 把它做成
 * 180ms 的可见变化。
 *
 * **`mode="popLayout"` 不是 `mode="wait"`**（全站禁用后者：它让进出串行，
 * 在工作界面上是净损失）。
 *
 * **`role="alert"` 是这一行的语义，不是装饰**——七个调用点全是
 * 「操作失败」或「后果警告」类的即时提示，读屏必须当场打断。
 * 所以这里写死而不做成可选项：做成可选就一定有调用点忘了传。
 * 纯说明性文字**不要**用这个组件（那会让读屏在无关时刻打断用户）。
 *
 * ⚠️ **调用点的直接父容器必须有 `relative`**（红线 9）：`PopChild` 用
 * `offsetTop`/`offsetLeft` + `position: absolute` 定位退场元素，没有定位
 * 祖先时 `offsetParent` 一路落到 `<body>`，退场的这一行会在淡出的 180ms 里
 * 飞到页面左上角。
 *
 * 只走 sumi（远端回执，答「它办完了吗」），不带任何位移键——
 * 位移键在 reduced-motion 下是瞬移到终点，等于给减弱动效的人一次位置突变。
 */
export function AlertLine({
  show,
  className,
  children,
}: {
  show: boolean
  className: string
  children: React.ReactNode
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {show && (
        <motion.p
          key="alert-line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_SUMI }}
          role="alert"
          className={className}
        >
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  )
}
