import { db, schema } from '@gensokyo/db'
import type { ListResourcesQuery, ResourceSort } from '@gensokyo/shared'
import { eq } from 'drizzle-orm'

/**
 * 香霖堂搜索：Meilisearch 的一切都在这一个文件。
 *
 * 三条不变式（见 docs/superpowers/specs/2026-09-11-kourindou-search-design.md）：
 * 1. 可见性只在 Postgres。这里的文档不带 status / deletedAt，回库取行时
 *    必带 `status = 'published' AND deleted_at IS NULL` 白名单。
 * 2. 文档映射与索引设置只有这一份，reindex.ts 也 import 这里。
 * 3. 同步永不抛错、查询失败由调用方降级到 ILIKE。
 */

const { resource, resourceTag } = schema

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

// ------------------------------------------------------------------ 客户端

/**
 * 配置按调用惰性读取，不在模块顶层：app.ts 被测试 import，不该因为缺配置炸；
 * 测试还要能临时改 MEILI_HOST 验证降级。缺省值与 dev-services.sh 一致。
 */
const config = () => ({
  host: (process.env.MEILI_HOST ?? 'http://localhost:57700').replace(/\/$/, ''),
  key: process.env.MEILI_MASTER_KEY ?? '',
})

export class MeiliError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function meiliFetch<T = unknown>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { host, key } = config()
  const { timeoutMs = 5_000, ...rest } = init
  const res = await fetch(`${host}${path}`, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...rest.headers,
    },
  })
  if (!res.ok) {
    throw new MeiliError(
      res.status,
      `meili ${path} → ${res.status} ${await res.text()}`,
    )
  }
  // 204 / 空体
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** 等所有已入队的索引任务跑完。Meili 的写入全是异步任务，测试与 reindex 收尾都靠它 */
export async function awaitIndexing(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { results } = await meiliFetch<{ results: unknown[] }>(
      '/tasks?statuses=enqueued,processing&limit=1',
    )
    if (results.length === 0) return
    if (Date.now() > deadline) throw new Error('meili 索引任务超时未完成')
    await Bun.sleep(100)
  }
}

/** 建索引 + 写设置。幂等：索引已存在时 409 忽略；settings PATCH 本身幂等 */
export async function ensureIndex(): Promise<void> {
  await meiliFetch('/indexes', {
    method: 'POST',
    body: JSON.stringify({ uid: SEARCH_INDEX, primaryKey: 'id' }),
  }).catch((err) => {
    if (err instanceof MeiliError && err.status === 409) return
    throw err
  })
  await meiliFetch(`/indexes/${SEARCH_INDEX}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(SEARCH_SETTINGS),
  })
  await awaitIndexing()
}

// ------------------------------------------------------------------ 查询

export async function searchResources(p: {
  q: string
  filter?: string
  sort?: string[]
  page: number
  pageSize: number
}): Promise<{ ids: string[]; total: number }> {
  const body = await meiliFetch<{ hits: { id: string }[]; totalHits: number }>(
    `/indexes/${SEARCH_INDEX}/search`,
    {
      method: 'POST',
      timeoutMs: 1_500,
      body: JSON.stringify({
        q: p.q,
        filter: p.filter,
        sort: p.sort,
        page: p.page,
        hitsPerPage: p.pageSize,
        attributesToRetrieve: ['id'],
      }),
    },
  )
  return { ids: body.hits.map((h) => h.id), total: body.totalHits }
}

// ------------------------------------------------------------------ 同步

const inflight = new Set<Promise<void>>()

/**
 * 按 id 重读该行：已发布且未软删 → upsert，否则 → 删文档。
 * **永不 reject**——索引写失败的后果是「最多陈旧到夜间重建」，而可见性由
 * Postgres 兜底，所以只记日志。调用方一律 `void syncResource(id)`，
 * 且必须在 db.transaction() resolve 之后调（读的是已提交状态）。
 */
export function syncResource(id: string): Promise<void> {
  const run = (async () => {
    const [row] = await db
      .select(SEARCH_COLUMNS)
      .from(resource)
      .where(eq(resource.id, id))
      .limit(1)
    const visible = row?.status === 'published' && row.deletedAt === null
    if (row && visible) {
      const tags = await db
        .select({ tagId: resourceTag.tagId })
        .from(resourceTag)
        .where(eq(resourceTag.resourceId, id))
      await meiliFetch(`/indexes/${SEARCH_INDEX}/documents`, {
        method: 'POST',
        body: JSON.stringify([
          toDoc(
            row,
            tags.map((t) => t.tagId),
          ),
        ]),
      })
    } else {
      // 删一个不存在的文档也是成功的任务，不用先查
      await meiliFetch(`/indexes/${SEARCH_INDEX}/documents/${id}`, {
        method: 'DELETE',
      })
    }
  })().catch((err) => {
    console.error('[search] 同步失败，等夜间重建', { id, err })
  })
  inflight.add(run)
  run.finally(() => inflight.delete(run))
  return run
}

/** 等所有在途同步落地并被 Meili 处理完。只给测试与脚本用 */
export async function flushSyncs(): Promise<void> {
  await Promise.all([...inflight])
  await awaitIndexing()
}
