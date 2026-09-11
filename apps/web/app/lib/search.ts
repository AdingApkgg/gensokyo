import { RESOURCE_SORT, type ResourceSort } from '@gensokyo/shared'

/**
 * 排序 Select 的显示值。api 的默认是「有 q → relevance，无 q → newest」，
 * 这里要与之一致，否则用户看到的选中项和实际排序对不上。
 * `__all` 是 Filter 组件里「全部」项的哨兵值。
 */
export function effectiveSort(q: string | null, sort: string | null): string {
  if (sort) return sort
  return q ? 'relevance' : '__all'
}

/** 相关度只在有 q 时才是一个有意义的选项 */
export function sortOptions(q: string | null): ResourceSort[] {
  return q ? [...RESOURCE_SORT] : RESOURCE_SORT.filter((s) => s !== 'relevance')
}
