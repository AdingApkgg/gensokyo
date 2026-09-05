import { useNavigation } from 'react-router'

/**
 * 全局导航 pending 指示。
 *
 * RR8 的每次导航都要等 loader 往返，期间页面完全静止——这是全站唯一一处
 * 「不确定时长」的等待。
 *
 * 纯 CSS：动画本身由 `.pending-bar[data-pending]` 驱动，这里只负责把
 * navigation.state 翻成一个 data 属性。到达时不做完成动画——让它随
 * View Transition 的旧快照一起淡出，比手写收尾更自然。
 *
 * **挂在 header 之内而不是 fixed 压在它上面**：header 有 backdrop-blur，
 * 是全站最贵的元素，进度条每帧变化都会触发它下方那条模糊带重算。
 */
export function PendingBar() {
  const navigation = useNavigation()
  const pending = navigation.state !== 'idle'
  return (
    <div className="pending-bar" data-pending={pending} aria-hidden="true" />
  )
}
