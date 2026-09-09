import { animate } from 'motion/react'
import { EASE_SUMI, prefersReduced } from '~/lib/motion'

/**
 * 落款：在刚发的那一楼上播一次墨洇，与 app.css 里 `li[id^="p"]:target` 那条
 * 同一副面孔（12% 的 primary 洇开、淡去、1.2s、墨曲线）。
 *
 * 命令式 `animate()` 而不是把楼层做成 motion 组件（spec §8.3）。这个模块
 * 本身含 motion，由 `Discussion.tsx` 动态 import（`import('./bloom')`）加载
 * 而不是静态引入——匿名读者永远发不了帖，走不到这里，不为他们的首屏下载
 * 这份 motion（C1，与 ReplyTargetBar / FloorFlip 同形）。**不许在别处写裸的
 * `import("motion/react")`——它会让 rolldown 把 motion 并进 root 静态
 * import 的共享 chunk，首屏 +40 KB（本次实测）。**
 *
 * 两个关键帧的字符串结构完全一致、只有百分数不同：motion 的复合值插值器会
 * 只对那个数字做插值，`var(--primary)` 与 `color-mix()` 原样保留、交给浏览器解析。
 *
 * 红线 6：命令式 animate() 不受 MotionConfig 管，自己门控——减弱动效下不做
 * 1.2s 的持续变化，改成「亮起、停住、消失」一次提示，与 :target 那条的降级同义。
 */
export async function bloom(floor: number) {
  const el = document.getElementById(`p${floor}`)
  if (!el) return
  const at = (pct: number) =>
    `color-mix(in oklab, var(--primary) ${pct}%, transparent)`
  el.style.borderRadius = 'var(--radius-md)'
  if (prefersReduced()) {
    animate(
      el,
      { backgroundColor: [at(12), at(12), at(0)] },
      { duration: 1.2, times: [0, 0.99, 1], ease: 'linear' },
    )
    return
  }
  animate(
    el,
    { backgroundColor: [at(12), at(0)] },
    { duration: 1.2, ease: EASE_SUMI },
  )
}
