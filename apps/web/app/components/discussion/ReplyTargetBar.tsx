import { AnimatePresence, motion } from 'motion/react'
import { EASE_SUMI } from '~/lib/motion'
import { m } from '~/paraglide/messages'

/**
 * 「回复中 · #N」——常驻状态的指示（spec 三支柱的第三根：我现在处在什么模式）。
 *
 * `position: sticky; bottom` 挂在讨论区容器里：回复框在视口内时它就待在
 * 自己的位置（回复框正上方）；用户滚上去重读被引用的那一楼时，它贴在视口
 * 底部跟着走。**不做视口检测**（红线 2：useInView 只给 layout 门控）。
 *
 * 这个文件含 motion，由 Discussion 通过 lazy() 加载——匿名读者永远走不到
 * 「引用」这一步，不该为它下载 39 KB（C1）。
 *
 * 只在客户端交互后存在，所以 initial 隐藏态不违反红线 1；exit 只有 opacity（红线 4）。
 */
export default function ReplyTargetBar({
  floor,
  onClear,
  onExited,
}: {
  floor: number | null
  onClear: () => void
  onExited: () => void
}) {
  return (
    <AnimatePresence onExitComplete={onExited}>
      {floor !== null && (
        <motion.div
          key="reply-target"
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_SUMI }}
          className="sticky bottom-3 z-10 flex items-center gap-2 rounded-md bg-background/85 px-3 py-1.5 text-xs ring-1 ring-foreground/10 backdrop-blur"
        >
          <span>{m.shrine_replying_to_floor()}</span>
          {/* 跳回那一楼：原生 hash 跳转，:target 的墨洇会在落点亮一下 */}
          <a
            href={`#p${floor}`}
            className="font-medium underline underline-offset-4"
          >
            #{floor}
          </a>
          <button
            type="button"
            className="ml-auto underline underline-offset-4"
            onClick={onClear}
          >
            {m.shrine_cancel()}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
