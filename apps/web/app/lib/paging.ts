/**
 * 分页控件要显示的页码：当前页前后各两页，首尾常在。
 *
 * 从 Discussion.tsx 抽出来共用——香霖堂列表与讨论区楼层分页是同一个窗口算法，
 * 各写一遍必然漂移。
 */
export function pageWindow(current: number, total: number): number[] {
  const set = new Set<number>([1, total])
  for (let p = current - 2; p <= current + 2; p++)
    if (p >= 1 && p <= total) set.add(p)
  return [...set].sort((a, b) => a - b)
}
