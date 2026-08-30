/**
 * 把已发布资源全量灌进 Meilisearch。
 *
 *   bun run reindex
 *
 * 这个脚本无论如何都要存在——换 Meili 版本、改索引 schema、灾后恢复都靠它。
 * 正因为它存在，M3 才不需要 search_outbox 表和 worker：索引写失败就等下一次
 * 全量重建，比"outbox 表 + 重试语义"简单，而且能自愈 outbox 处理不了的故障
 * （比如索引 schema 变了）。
 *
 * 用裸 fetch 而不是 meilisearch-js：一个脚本不值得引一个依赖。
 */
import { db, schema } from '@gensokyo/db'
import { and, eq, isNull } from 'drizzle-orm'

const HOST = (process.env.MEILI_HOST ?? 'http://localhost:57700').replace(
  /\/$/,
  '',
)
const KEY = process.env.MEILI_MASTER_KEY ?? ''
const INDEX = 'resources'

const meili = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    throw new Error(`meili ${path} → ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function main() {
  const rows = await db
    .select({
      id: schema.resource.id,
      slug: schema.resource.slug,
      titleOriginal: schema.resource.titleOriginal,
      title: schema.resource.title,
      description: schema.resource.description,
      kind: schema.resource.kind,
      license: schema.resource.license,
      circleNameRaw: schema.resource.circleNameRaw,
      coverUrl: schema.resource.coverUrl,
      downloadCount: schema.resource.downloadCount,
      ratingSum: schema.resource.ratingSum,
      ratingCount: schema.resource.ratingCount,
      createdAt: schema.resource.createdAt,
    })
    .from(schema.resource)
    .where(
      and(
        eq(schema.resource.status, 'published'),
        isNull(schema.resource.deletedAt),
      ),
    )

  const tags = await db
    .select({
      resourceId: schema.resourceTag.resourceId,
      tagId: schema.resourceTag.tagId,
    })
    .from(schema.resourceTag)

  const tagsOf = new Map<string, string[]>()
  for (const t of tags) {
    tagsOf.set(t.resourceId, [...(tagsOf.get(t.resourceId) ?? []), t.tagId])
  }

  const docs = rows.map((r) => ({
    ...r,
    // 三语标题摊平成可检索的字符串数组：Meili 不便直接搜 jsonb 的值
    titles: [r.titleOriginal, ...Object.values(r.title ?? {})].filter(Boolean),
    descriptions: Object.values(r.description ?? {}).filter(Boolean),
    tagIds: tagsOf.get(r.id) ?? [],
    rating: r.ratingCount ? r.ratingSum / r.ratingCount : 0,
    createdAt: new Date(r.createdAt).getTime(),
  }))

  await meili(`/indexes/${INDEX}`, {
    method: 'PUT',
    body: JSON.stringify({ primaryKey: 'id' }),
  }).catch(() => {
    // 已存在时 PUT 会失败，无所谓
  })

  await meili(`/indexes/${INDEX}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      searchableAttributes: ['titles', 'circleNameRaw', 'descriptions', 'slug'],
      filterableAttributes: ['kind', 'license', 'tagIds'],
      sortableAttributes: ['createdAt', 'downloadCount', 'rating'],
    }),
  })

  // 全量重建：先清空，避免已下架的资源留在索引里
  await meili(`/indexes/${INDEX}/documents`, { method: 'DELETE' })
  if (docs.length) {
    await meili(`/indexes/${INDEX}/documents`, {
      method: 'POST',
      body: JSON.stringify(docs),
    })
  }

  console.log(`reindexed ${docs.length} published resources into "${INDEX}"`)
}

await main()
