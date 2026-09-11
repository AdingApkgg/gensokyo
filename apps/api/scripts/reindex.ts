/**
 * 把已发布资源全量灌进 Meilisearch。
 *
 *   bun run reindex
 *
 * 这个脚本无论如何都要存在——换 Meili 版本、改索引 schema、灾后恢复都靠它。
 * 正因为它存在，才不需要 search_outbox 表和 worker：写路径的同步失败就等
 * 下一次全量重建，比"outbox 表 + 重试语义"简单，而且能自愈 outbox 处理不了
 * 的故障（比如索引 schema 变了）。生产每夜 cron 跑一次。
 *
 * 文档映射与索引设置在 src/search.ts，这里不另存一份。
 */
import { db, schema } from '@gensokyo/db'
import { and, eq, isNull } from 'drizzle-orm'
import {
  awaitIndexing,
  ensureIndex,
  meiliFetch,
  SEARCH_COLUMNS,
  SEARCH_INDEX,
  toDoc,
} from '../src/search'

const BATCH = 1_000

async function main() {
  const rows = await db
    .select(SEARCH_COLUMNS)
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

  const docs = rows.map((r) => toDoc(r, tagsOf.get(r.id) ?? []))

  await ensureIndex()
  // 全量重建：先清空，避免已下架的资源留在索引里
  await meiliFetch(`/indexes/${SEARCH_INDEX}/documents`, { method: 'DELETE' })
  for (let i = 0; i < docs.length; i += BATCH) {
    await meiliFetch(`/indexes/${SEARCH_INDEX}/documents`, {
      method: 'POST',
      timeoutMs: 30_000,
      body: JSON.stringify(docs.slice(i, i + BATCH)),
    })
  }
  await awaitIndexing(60_000)

  console.log(
    `reindexed ${docs.length} published resources into "${SEARCH_INDEX}"`,
  )
}

await main()
