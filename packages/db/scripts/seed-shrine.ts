/**
 * 博丽神社开场内容：六篇引导帖 + 一篇站规，入库并置顶。
 *
 *   bun run seed:shrine
 *   生产：docker compose run --rm migrate bun run packages/db/scripts/seed-shrine.ts
 *
 * 一个功能齐备但六个版块全空的论坛，读到的是「这地方是死的」。这七篇是 M4 最高
 * 杠杆的一件事，而它不是代码——文案的编辑源是
 * docs/product/2026-08-30-shrine-seed-content.md，正文由那份文档生成到
 * seed-shrine-content.ts（生成命令见该文件头；本脚本只负责入库）。
 *
 * **幂等**：按「版块 + 标题 + 种子账号」找主题。已存在则只同步主楼正文（文案改了
 * 重跑即可，改标题会被当成新帖——旧帖需手动删）并刷新置顶时间；不存在则建主题 + 主楼。
 * 置顶端点在 M4 没有（M4.5 推迟项），pinnedAt 只能由这里写。
 *
 * 种子账号「博丽神社」没有密码，不能登录；它只是这七篇的署名。
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../src'
import { ensureSeedUser, seedHandle } from './_shared/create-resource-topic'
import { SHRINE_SEED } from './seed-shrine-content'

const SEED_USER = {
  id: 'hakurei-shrine',
  email: 'shrine@example.com',
  name: '博丽神社',
}

async function main() {
  await ensureSeedUser({ ...SEED_USER, handle: seedHandle(SEED_USER.id) })

  // 数组顺序 = 展示顺序：pinnedAt 递减，列表按 pinned_at DESC 排
  const base = Date.now()
  let created = 0
  let updated = 0
  let unchanged = 0

  for (const [i, entry] of SHRINE_SEED.entries()) {
    const pinnedAt = new Date(base - i * 60_000)
    const [existing] = await db
      .select({ id: schema.topic.id })
      .from(schema.topic)
      .where(
        and(
          eq(schema.topic.kind, 'board'),
          eq(schema.topic.boardSlug, entry.board),
          eq(schema.topic.title, entry.title),
          eq(schema.topic.authorId, SEED_USER.id),
          isNull(schema.topic.deletedAt),
        ),
      )
      .limit(1)

    if (existing) {
      const [op] = await db
        .select({ id: schema.post.id, bodyMd: schema.post.bodyMd })
        .from(schema.post)
        .where(
          and(eq(schema.post.topicId, existing.id), eq(schema.post.floor, 1)),
        )
        .limit(1)
      if (op && op.bodyMd !== entry.bodyMd) {
        await db
          .update(schema.post)
          .set({ bodyMd: entry.bodyMd })
          .where(eq(schema.post.id, op.id))
        updated++
      } else {
        unchanged++
      }
      await db
        .update(schema.topic)
        .set({ pinnedAt })
        .where(eq(schema.topic.id, existing.id))
      continue
    }

    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(schema.topic)
        .values({
          kind: 'board',
          boardSlug: entry.board,
          title: entry.title,
          authorId: SEED_USER.id,
          // floorSeq 是序列不是计数：主楼占 1
          floorSeq: 1,
          pinnedAt,
          lastPostAt: pinnedAt,
        })
        .returning({ id: schema.topic.id })
      if (!t) throw new Error('insert topic returned nothing')
      await tx.insert(schema.post).values({
        topicId: t.id,
        authorId: SEED_USER.id,
        floor: 1,
        bodyMd: entry.bodyMd,
        locale: 'zh',
      })
    })
    created++
  }

  console.log(
    `seed:shrine 完成：新建 ${created}，同步正文 ${updated}，未变 ${unchanged}（共 ${SHRINE_SEED.length} 篇）`,
  )
  process.exit(0)
}

await main()
