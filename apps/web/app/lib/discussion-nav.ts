/**
 * 刚发的楼在不在用户当前看到的这一页？
 *
 * 分页按**楼层区间**不按 page（见 Discussion.tsx 的注释）：`from` 是当前页第一层的
 * 楼层号。`floor` 是序列不是计数——软删的楼保留占位，所以页边界只能从 from/pageSize
 * 算，不能从存活楼数算。
 *
 * 不在窗口内时返回目标页的页首楼层号，调用方据此拼 `?floor=<from>#p<floor>`。
 */
export function replyTarget(
  floor: number,
  from: number,
  pageSize: number,
): { kind: 'inpage' } | { kind: 'navigate'; from: number } {
  if (floor >= from && floor < from + pageSize) return { kind: 'inpage' }
  const page = Math.floor((floor - 1) / pageSize)
  return { kind: 'navigate', from: page * pageSize + 1 }
}
