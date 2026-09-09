import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { EASE_SUMI } from '~/lib/motion'

/**
 * 一楼的正文 ⇄ 编辑框：翻纸，不动高度（spec §8.3）。
 *
 * popLayout 把退场的那一面改成 position:absolute、脱离文档流，进场的那一面
 * 直接占位——高度一步到位、两面交叉淡出淡入。不用 layout 测高：Markdown 里的
 * 图片 loading="lazy"，测到的高度会在图片到达后再变一次。
 *
 * 含 motion，由 PostList 通过 lazy() 加载，且只在「正在编辑或刚编辑完」的
 * 那一楼挂载——50 层的列表里其余 49 层是纯 <li>，spec 不许把它们变成 motion 组件。
 *
 * initial={false}：AnimatePresence 首次挂上时带着的那一面不播入场。
 * 退场只有 opacity（红线 4）；父容器 relative（红线 9）。
 */
export default function FloorFlip({
  editing,
  view,
  edit,
  onSettled,
}: {
  editing: boolean
  view: ReactNode
  edit: ReactNode
  onSettled: () => void
}) {
  return (
    <div className="relative mt-2">
      <AnimatePresence
        mode="popLayout"
        initial={false}
        onExitComplete={onSettled}
      >
        <motion.div
          key={editing ? 'edit' : 'view'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_SUMI }}
        >
          {editing ? edit : view}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
