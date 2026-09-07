/**
 * 三材曲线的 TS 字面值。
 *
 * **必须再抄一份**：motion 的 `ease` 不接受 `var(--ease-washi)`，它要数组。
 * 所以同一条曲线在仓库里有两份权威——`app.css` 的 `@theme` 与这里。
 * `motion.test.ts` 断言两者逐字符相等，别靠注释。
 *
 * 语义边界（这是「一套动效」而不是「一堆效果」的判据）：
 *   washi = 位置连续性（我点的那个东西去哪了）
 *   sumi  = 远端回执（它办完了吗）
 *   fude  = 一笔画出来（只给 scaleX 类延展）
 */
export const EASE_SUMI = [0, 0.408, 0.501, 0.75] as const
export const EASE_WASHI = [0.212, 0.091, 0.259, 0.953] as const
export const EASE_FUDE = [0.244, 0, 0.756, 1] as const

/** ζ=1 临界阻尼。`bounce: 0` 就是它的正确编码——纸不会弹，全域禁 overshoot */
export const SPRING_WASHI = {
  type: 'spring',
  visualDuration: 0.28,
  bounce: 0,
} as const
