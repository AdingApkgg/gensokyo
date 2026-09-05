/**
 * 分页控件要显示的页码：当前页前后各两页，首尾常在。
 *
 * 从 Discussion.tsx 抽出来共用——香霖堂列表与讨论区楼层分页是同一个窗口算法，
 * 各写一遍必然漂移。
 */
export function pageWindow(current: number, total: number): number[] {
  // total < 1（如 0 或负数）不是合法页数，但调用方可能算出这种边界值
  // （比如列表为空时 Math.ceil(0 / pageSize)）——clamp 到至少 1 页，
  // 否则 new Set([1, total]) 会混进一个不存在的页码。
  const last = Math.max(1, total)
  const set = new Set<number>([1, last])
  for (let p = current - 2; p <= current + 2; p++)
    if (p >= 1 && p <= last) set.add(p)
  return [...set].sort((a, b) => a - b)
}
