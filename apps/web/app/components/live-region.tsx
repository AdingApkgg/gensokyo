/**
 * 全站唯一的播报区。
 *
 * 此前全站 aria-live / role="status" 零命中，加上 React Router 不做路由播报——
 * 读屏用户的每一次导航、每一次 fetcher 成功都是完全静默的。
 *
 * 刻意做成「由调用方把要播报的文本渲染进来」而不是命令式 API：
 * 播报内容几乎总是已经存在于某个 fetcher 的返回值里，多一层状态机只会漂移。
 *
 * `sr-only` 而非 `hidden`：后者会让内容从可访问性树里消失，播报不出来。
 */
export function LiveRegion({ children }: { children?: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-slot="live-region"
    >
      {children}
    </div>
  )
}
