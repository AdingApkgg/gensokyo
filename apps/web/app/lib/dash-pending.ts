/**
 * dash 列表的乐观移除：从全局 fetcher 表里认出「哪一行正在途中」。
 *
 * 抽成纯函数是因为它测不了也看不见——它的效果是「一张卡片当帧消失」，
 * 而那一帧被 `AnimatePresence` 的退场动画盖住，浏览器里读到的永远是
 * 动画未完成的中间态。这里用单测把这条链钉死。
 *
 * 两个 dash 页面各用各的前缀（`review:` / `report:`）：它们的 action
 * 返回形状不同，共用前缀会让一边的列表层读到另一边的 data。
 */
export function pendingIdsFrom(
  fetchers: readonly { key: string; state: string }[],
  prefix: string,
): string[] {
  return fetchers
    .filter((f) => f.state !== 'idle' && f.key.startsWith(prefix))
    .map((f) => f.key.slice(prefix.length))
}

/**
 * 把在途的行从列表里摘掉。
 *
 * 不乐观的话是 action 一趟 → revalidate → 卡片才消失，退场动画串在网络
 * 之后，每条 +280ms；乐观之后动画与往返重叠，增量 0ms——这才是这套动效
 * 不是净成本的原因。
 */
export function withoutPending<T extends { id: string }>(
  items: readonly T[],
  pendingIds: readonly string[],
): T[] {
  const pending = new Set(pendingIds)
  return items.filter((r) => !pending.has(r.id))
}

/**
 * 该为哪些 id 保留一个「盯梢」组件。
 *
 * **必须是并集而不是当前在途集**：`fetcher.data` 恰好在它变回 `idle` 的
 * 那一帧才有，而那一帧它已经不在在途集里了。只渲染在途集的话，盯梢组件
 * 会在拿到结果的同一次提交里卸载，effect 永远不触发，播报永远是空的。
 * （实测踩过：queue 页处理一条，LiveRegion 全程空字符串。）
 *
 * 登记过就不摘：一页最多 50 行，留着几个空组件比错过回执便宜。
 */
export function mergeWatched(
  watched: readonly string[],
  pendingIds: readonly string[],
): string[] {
  const add = pendingIds.filter((id) => !watched.includes(id))
  return add.length ? [...watched, ...add] : (watched as string[])
}
