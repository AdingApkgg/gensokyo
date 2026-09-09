import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react'
import { useEffect } from 'react'
import { SPRING_WASHI_VALUE } from '~/lib/motion'
import { m } from '~/paraglide/messages'

/**
 * 上传进度条。进度事件是离散的（浏览器按 chunk 回调），useSpring 把它抹成
 * 一条连续的线——纸·落的临界阻尼，不会冲过头再回来。
 *
 * 红线 6：MotionValue 直连 style 不受 MotionConfig 管，减弱动效下直接用原始值。
 * 它是信息不是装饰（role=progressbar），只在上传中存在，不进 SSR。
 *
 * 含 motion：PostForm 在匿名可读页面的静态图里，那边 lazy 加载；upload.tsx
 * 是登录后才有的路由，静态加载。
 */
export default function UploadProgress({ ratio }: { ratio: number }) {
  const reduce = useReducedMotion()
  const raw = useMotionValue(ratio)
  const spring = useSpring(raw, SPRING_WASHI_VALUE)
  useEffect(() => {
    raw.set(ratio)
  }, [raw, ratio])
  const scaleX = reduce ? raw : spring

  return (
    <div
      role="progressbar"
      aria-label={m.shrine_uploading()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="h-0.5 w-full overflow-hidden rounded-full bg-foreground/10"
    >
      <motion.div
        className="h-full origin-left bg-primary"
        style={{ scaleX }}
      />
    </div>
  )
}
