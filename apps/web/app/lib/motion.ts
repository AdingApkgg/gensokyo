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
/**
 * `useSpring(value, …)` 收的是 SpringOptions，不带 `type`——给 MotionValue 用这份。
 * 组件的 `transition` prop 用下面带 `type` 的那份。两份的数字必须相同，
 * motion.test.ts 断言它。
 */
export const SPRING_WASHI_VALUE = { visualDuration: 0.28, bounce: 0 } as const

export const SPRING_WASHI = { type: 'spring', ...SPRING_WASHI_VALUE } as const

/**
 * `/dash/trash` 销毁确认的两拍。全站唯一一处 `staggerChildren`。
 *
 * 抽成纯函数是因为它唯一要防的东西**在浏览器里测不了**：
 * `prefers-reduced-motion` 这套工具模拟不了，而 opacity 动画靠 rAF——
 * 隐藏面板里根本不推进。能被单测钉住的只有这段推导本身。
 *
 * **`reduce` 的两个守卫是这个函数存在的全部理由。**
 * `MotionConfig reducedMotion="user"` 只关 transform/positional 键，
 * opacity 动画连同 stagger 算出来的 delay 照跑。删掉守卫的话，开了减弱动效
 * 的人看到的仍是三段递延淡入——而此时它是页面上唯一在动的东西，
 * 还落在全 /dash 唯一不可逆的操作上，比不做还糟。
 *
 * 未减弱时最后一个子节点在 `0.12 × 2 + 0.18 = 0.42s` 完成——
 * stagger 是 **n−1** 个间隔，且最后一个子节点自己还有时长。
 */
export function confirmStagger(reduce: boolean) {
  return {
    container: {
      hidden: {},
      show: { transition: { staggerChildren: reduce ? 0 : 0.12 } },
    },
    /** hidden 里只有 opacity 没有位移：保持与「exit 零位移键」同形 */
    item: {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: { duration: reduce ? 0 : 0.18, ease: EASE_SUMI },
      },
    },
  }
}

/**
 * MotionConfig 管不到原生滚动 API，reduced-motion 要自己判。
 * 三处调用点：`bloom.ts` 命令式 `animate()` 的守卫（红线 6 三类之一）；
 * `mobile-nav.tsx`（边缘划走关闭）与 `site-header.tsx`（下滚收起）两处
 * 手写交互的减弱动效判断。
 */
export function prefersReduced() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
