import { schema } from '@gensokyo/db'
import type { ListResourcesQuery, ResourceSort } from '@gensokyo/shared'

/**
 * 香霖堂搜索：Meilisearch 的一切都在这一个文件。
 *
 * 三条不变式（见 docs/superpowers/specs/2026-09-11-kourindou-search-design.md）：
 * 1. 可见性只在 Postgres。这里的文档不带 status / deletedAt，回库取行时
 *    必带 `status = 'published' AND deleted_at IS NULL` 白名单。
 * 2. 文档映射与索引设置只有这一份，reindex.ts 也 import 这里。
 * 3. 同步永不抛错、查询失败由调用方降级到 ILIKE。
 */

const { resource } = schema

export const SEARCH_INDEX = 'resources'

export const SEARCH_SETTINGS = {
  searchableAttributes: ['titles', 'circleNameRaw', 'descriptions', 'slug'],
  filterableAttributes: ['kind', 'license', 'tagIds', 'circleId', 'uploaderId'],
  sortableAttributes: ['createdAt', 'downloadCount', 'rating'],
  // 默认 1,000：索引已有 6.7k 文档，翻到底会被截断
  pagination: { maxTotalHits: 10_000 },
} as const

/** 同步与全量重建共用的 select 形状；status / deletedAt 只用于判可见，不进文档 */
export const SEARCH_COLUMNS = {
  id: resource.id,
  slug: resource.slug,
  titleOriginal: resource.titleOriginal,
  title: resource.title,
  description: resource.description,
  kind: resource.kind,
  license: resource.license,
  circleId: resource.circleId,
  uploaderId: resource.uploaderId,
  circleNameRaw: resource.circleNameRaw,
  coverUrl: resource.coverUrl,
  downloadCount: resource.downloadCount,
  ratingSum: resource.ratingSum,
  ratingCount: resource.ratingCount,
  createdAt: resource.createdAt,
  status: resource.status,
  deletedAt: resource.deletedAt,
}

/** 与 SEARCH_COLUMNS 同名同型，从表模型上 Pick 才带得上可空性 */
export type SearchRow = Pick<
  typeof resource.$inferSelect,
  keyof typeof SEARCH_COLUMNS
>

export type SearchDoc = ReturnType<typeof toDoc>

export function toDoc(row: SearchRow, tagIds: string[]) {
  const {
    status: _status,
    deletedAt: _deletedAt,
    title,
    description,
    createdAt,
    ...rest
  } = row
  return {
    ...rest,
    // 三语标题摊平成可检索的字符串数组：Meili 不便直接搜 jsonb 的值
    titles: [row.titleOriginal, ...Object.values(title ?? {})].filter(Boolean),
    descriptions: Object.values(description ?? {}).filter(Boolean),
    tagIds,
    rating: row.ratingCount ? row.ratingSum / row.ratingCount : 0,
    createdAt: new Date(createdAt).getTime(),
  }
}

type FilterInput = Partial<
  Pick<
    ListResourcesQuery,
    'kind' | 'license' | 'tag' | 'circleId' | 'uploaderId'
  >
>

/** Meili 过滤表达式里的字符串字面量：双引号，转义 `"` 与 `\` */
const quote = (v: string) => `"${v.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`

export function buildFilter(q: FilterInput): string | undefined {
  const parts: string[] = []
  if (q.kind) parts.push(`kind = ${quote(q.kind)}`)
  if (q.license) parts.push(`license = ${quote(q.license)}`)
  if (q.tag?.length) parts.push(`tagIds IN [${q.tag.map(quote).join(', ')}]`)
  if (q.circleId) parts.push(`circleId = ${quote(q.circleId)}`)
  if (q.uploaderId) parts.push(`uploaderId = ${quote(q.uploaderId)}`)
  return parts.length ? parts.join(' AND ') : undefined
}

export function buildSort(sort: ResourceSort): string[] | undefined {
  switch (sort) {
    case 'newest':
      return ['createdAt:desc']
    case 'downloads':
      return ['downloadCount:desc']
    case 'rating':
      return ['rating:desc']
    default:
      return undefined
  }
}
