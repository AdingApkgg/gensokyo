import { useFetchers, useNavigation } from 'react-router'

/**
 * 全局 pending 指示。
 *
 * 全站的「不确定时长」等待有两类：导航要等 loader 往返，fetcher 提交要等
 * action 往返。期间页面完全静止，这条墨线是唯一的回执。
 *
 * 纯 CSS：动画本身由 `.pending-bar[data-pending]` 驱动，这里只负责把
 * 两类状态翻成一个 data 属性。到达时不做完成动画——让它随
 * View Transition 的旧快照一起淡出，比手写收尾更自然。
 *
 * **挂在 header 之内而不是 fixed 压在它上面**：header 有 backdrop-blur，
 * 是全站最贵的元素，进度条每帧变化都会触发它下方那条模糊带重算。
 */
export function PendingBar() {
  const navigation = useNavigation()
  const fetchers = useFetchers()
  /**
   * fetcher 也要算进来：/dash 的审核、通知页的「全部已读」、香霖堂的封面上传
   * 与下架全都走 fetcher 而不是导航，此前它们全程没有任何等待信号。
   *
   * RR8 的 fetcher persistence 会让在途 fetcher 在组件卸载后仍留在这个数组里
   * 直到结算，所以「卡片消失了但请求还在飞」的那段时间条也还亮着——这正确。
   */
  const pending =
    navigation.state !== 'idle' || fetchers.some((f) => f.state !== 'idle')
  return (
    <div className="pending-bar" data-pending={pending} aria-hidden="true" />
  )
}
