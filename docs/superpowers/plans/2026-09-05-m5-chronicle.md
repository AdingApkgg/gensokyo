# M5 求闻史纪（TouhouDB 中文层）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中文用户能用中文和拼音搜到社团、专辑、曲目与原曲；译名由 staff 导入、由用户提议进审核队列；结果接回香霖堂的投稿表单与资源页。

**Architecture:** 三层。**镜像层**是 TouhouDB 编目的本地快照，可整表重建；**中文层**（`chronicle_entry`）是我们唯一不可再生的资产，独立成表；**检索层**是 Meilisearch，简繁由引擎白送，拼音在索引时生成。同步是一个限速、可续跑的脚本，全量走列表分页，增量走 `activityEntries`。

**Tech Stack:** Bun / hono / zod v4 / drizzle + PostgreSQL 18 / React Router v8 / Paraglide / Meilisearch v1.53 / pinyin-pro 3.29.3

**Spec:** `docs/superpowers/specs/2026-09-05-m5-chronicle-design.md`

## Global Constraints

每个任务的要求都隐含包含这一节。

- **许可未确认前不执行任何镜像。** T0 是硬闸门，未通过则 T3 及之后全部停工。
- **镜像表与 `chronicle_entry` 绝不同表，且 `chronicle_entry` 不设到镜像表的外键。** 镜像可整表重建，译名不可再生；有外键则一次重建就连带毁掉译名。
- **URL 用 `tdbId`，不用译名 slug。** 译名会改，进了 URL 的东西不可逆（M4 handle 的教训）。
- **原曲不单开 URL 空间。** 它是 `tdb_song` 里 `songType = 'Original'` 的行，`/chronicle/s/:id` 按类型切模板。同一实体两个规范地址是 M4 已修过的问题。
- **同步限速 1 请求 / 2 秒，403 与 429 指数退避，游标写库，中断可续跑。** 403 已实测。
- **不引入需要原生编译或预编译二进制的依赖。** 拼音库固定 `pinyin-pro@3.29.3`（零依赖、纯 JS、922 KB）。
- 校验用 `validate()`，`:id` 路由挂参数中间件；`requireAuth` 永远在参数校验之前。
- 前端错误按 `error.code` 查 Paraglide 文案，api 不返回人类可读消息。
- 消息改完跑 `bun run check-messages`；测试接 `@gensokyo/db/testing` 的 track/cleanup。
- Meilisearch 用裸 `fetch`，不引 `meilisearch-js`（沿用 `reindex.ts` 的判断）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/shared/src/chronicle/enums.ts` | `ENTITY_KIND`、`SONG_TYPE`、`PROPOSAL_STATUS` |
| `packages/shared/src/chronicle/schemas.ts` | 搜索、提议、批量导入的 zod |
| `packages/shared/src/chronicle/types.ts` | `ArtistView` / `AlbumView` / `SongView` / `SearchHit` 响应契约 |
| `packages/db/src/schema/chronicle.ts` | 8 张表 |
| `packages/db/scripts/_shared/tdb-client.ts` | 限速 + 退避的 TouhouDB 客户端 |
| `packages/db/scripts/sync-touhoudb.ts` | 全量与增量同步 |
| `apps/api/src/modules/chronicle/pinyin.ts` | 译名 → 全拼 + 首字母 |
| `apps/api/src/modules/chronicle/index.ts` | 读路由（搜索 + 三种条目详情） |
| `apps/api/src/modules/chronicle/entry.ts` | 中文层读写与提议审批 |
| `apps/api/scripts/reindex-chronicle.ts` | 全量重建 `chronicle` 索引 |
| `apps/web/app/routes/chronicle/{index,artist,album,song}.tsx` | 四个页面 |
| `apps/web/app/routes/dash/proposals.tsx` | 译名提议审批 |
| `apps/web/app/lib/chronicle.ts` | 显示辅助（实体标签、上游回链） |

---

## T0: 许可裁定与依赖固定（不写生产代码）

**Files:** Modify `docs/superpowers/specs/2026-09-05-m5-chronicle-design.md`、`CLAUDE.md`、`package.json`

- [ ] **Step 1: 确认 TouhouDB / VocaDB 的数据复用条款**

其 Help 页面是客户端渲染，抓不到内联许可文本。由站长确认，途径任选：登录后看条款页、查 VocaDB 的 GitHub 仓库文档、或直接发信问。

把结论逐字写进 spec 第九节，包括来源链接与确认日期。

**三种结论对应三条路**：允许镜像并署名 → 继续 T1；仅允许有限缓存 → 回到 spec 第九节的退路（只留中文层 + 代理详情），本计划的 T3、T4、T10 需重写；不允许 → M5 终止，另议方向。

- [ ] **Step 2: 固定拼音依赖**

```bash
bun add pinyin-pro@3.29.3 --cwd apps/api
```

选它的理由写进 CLAUDE.md：零依赖、纯 JS、922 KB。被否掉的两个：`pinyin` 解包 60 MB 且带 commander 依赖；`@napi-rs/pinyin` 是 Rust 原生绑定，与「不引入预编译二进制」冲突。

- [ ] **Step 3: CLAUDE.md 加「求闻史纪（M5）约定」小节**

写进去的必须是**会被改错的东西**，不是复述结构：

- 镜像表与 `chronicle_entry` 分表且无外键，理由是译名不可再生
- `tdb_*` 用 TouhouDB 的 integer id 作主键，不是 uuid
- 原曲不单开 URL
- 同步必须限速且可续跑，403 是实测过的

- [ ] **Step 4: 提交**（只有 docs、CLAUDE.md、package.json）

---

## T1: `@gensokyo/shared` 求闻史纪契约

**Files:** Create `packages/shared/src/chronicle/{enums,schemas,types}.ts`；Modify `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `ENTITY_KIND`、`EntityKind`、`SONG_TYPE`、`SongType`、`tdbIdSchema`、`chronicleSearchQuerySchema`、`proposalSchema`、`reviewProposalSchema`、`importEntriesSchema`、`ArtistView`、`AlbumView`、`SongView`、`SearchHit`

- [ ] **Step 1: 枚举**

```ts
export const ENTITY_KIND = ['artist', 'album', 'song'] as const
export type EntityKind = (typeof ENTITY_KIND)[number]

/** TouhouDB 的 songType 取值。未知值入库时归到 'Other'，不丢行 */
export const SONG_TYPE = [
  'Original', 'Arrangement', 'Remix', 'Cover', 'Instrumental',
  'Mashup', 'MusicPV', 'DramaPV', 'Live', 'Illustration', 'Other',
] as const
export type SongType = (typeof SONG_TYPE)[number]

export const PROPOSAL_STATUS = ['open', 'accepted', 'rejected'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number]
```

- [ ] **Step 2: 写会失败的测试**

`packages/shared/src/chronicle/schemas.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { proposalSchema, tdbIdSchema } from './schemas'

describe('tdbIdSchema', () => {
  test('接受正整数与数字字符串', () => {
    expect(tdbIdSchema.parse(25)).toBe(25)
    expect(tdbIdSchema.parse('25')).toBe(25)
  })
  test('拒绝 0、负数、小数与非数字', () => {
    for (const bad of [0, -1, 1.5, 'abc', '']) {
      expect(tdbIdSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('proposalSchema', () => {
  test('译名与说明至少给一个', () => {
    expect(proposalSchema.safeParse({ entityKind: 'artist', tdbId: 1 }).success).toBe(false)
  })
  test('译名不能是纯空白', () => {
    const r = proposalSchema.safeParse({ entityKind: 'artist', tdbId: 1, nameZh: '   ' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test packages/shared/src/chronicle/schemas.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 4: 实现 schemas**

```ts
import { z } from 'zod'
import { ENTITY_KIND, PROPOSAL_STATUS } from './enums'

/** TouhouDB 的 id 是正整数。用 coerce 是因为它从 URL 参数进来 */
export const tdbIdSchema = z.coerce.number().int().positive()

export const chronicleSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  kind: z.enum(ENTITY_KIND).optional(),
  /** 只看还没有中文译名的，给 staff 补译名用 */
  needsZh: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const nameZh = z.string().trim().min(1).max(200)
const noteZh = z.string().trim().min(1).max(2000)

/**
 * 提议：译名与说明至少给一个，否则是一条空提议。
 * refine 放在最外层，因为它是跨字段约束。
 */
export const proposalSchema = z
  .object({
    entityKind: z.enum(ENTITY_KIND),
    tdbId: tdbIdSchema,
    nameZh: nameZh.optional(),
    noteZh: noteZh.optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.nameZh !== undefined || v.noteZh !== undefined, {
    message: 'nameZh or noteZh required',
    path: ['nameZh'],
  })

export const reviewProposalSchema = z.object({
  status: z.enum(PROPOSAL_STATUS).exclude(['open']),
  note: z.string().trim().max(1000).optional(),
})

/** staff 批量导入。上限 500 条，超了分批传 */
export const importEntriesSchema = z.object({
  entries: z
    .array(
      z.object({
        entityKind: z.enum(ENTITY_KIND),
        tdbId: tdbIdSchema,
        nameZh: nameZh.optional(),
        noteZh: noteZh.optional(),
      }),
    )
    .min(1)
    .max(500),
})
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun test packages/shared/src/chronicle/schemas.test.ts` → PASS

- [ ] **Step 6: 响应契约类型**

`types.ts` 定义 `ArtistView`、`AlbumView`、`SongView`、`SearchHit`。**web 侧不许手写响应类型**，一律从 `hc` 推导；这里的类型是给 api 自己标注投影用的。

`SongView` 必须能表达两种形态：`songType === 'Original'` 时带 `arrangements`（编曲列表），否则带 `originalSong`（指回原曲）。用可辨识联合，不要两个字段都可空。

- [ ] **Step 7: 从 `packages/shared/src/index.ts` 导出，跑门禁，提交**

Run: `bun run check:fix && bun run typecheck && bun run test -- --force`

---

## T2: db schema + 迁移

**Files:** Create `packages/db/src/schema/chronicle.ts`；Modify `packages/db/src/schema/index.ts`、`packages/db/src/schema/kourindou.ts`

- [ ] **Step 1: 镜像层五张表**

```ts
/**
 * 主键用 TouhouDB 的 integer id，不是 uuid。
 *
 * 与仓库其他表不同，这是有意的：外部 id 是这些行的天然主键，它同时是
 * URL 里的键、activityEntries 返回的键、以及关系表的外键。再造一层 uuid
 * 会让每次同步 upsert 都要先查一次映射，且没有任何收益。
 */
export const tdbArtist = pgTable('tdb_artist', {
  id: integer('id').primaryKey(),
  defaultName: varchar('default_name', { length: 400 }).notNull(),
  /** 各语言别名原样存：[{ language, value }]，检索层摊平后灌 Meili */
  names: jsonb('names').$type<TdbName[]>().notNull().default([]),
  artistType: varchar('artist_type', { length: 32 }),
  pictureMime: varchar('picture_mime', { length: 64 }),
  status: varchar('status', { length: 32 }),
  version: integer('version').notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tdbAlbum = pgTable('tdb_album', {
  id: integer('id').primaryKey(),
  defaultName: varchar('default_name', { length: 400 }).notNull(),
  names: jsonb('names').$type<TdbName[]>().notNull().default([]),
  discType: varchar('disc_type', { length: 32 }),
  artistString: text('artist_string'),
  catalogNumber: varchar('catalog_number', { length: 128 }),
  releaseDate: date('release_date'),
  releaseEventName: varchar('release_event_name', { length: 200 }),
  coverUrl: text('cover_url'),
  ratingAverage: numeric('rating_average', { precision: 3, scale: 2 }),
  version: integer('version').notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tdbSong = pgTable(
  'tdb_song',
  {
    id: integer('id').primaryKey(),
    defaultName: varchar('default_name', { length: 400 }).notNull(),
    names: jsonb('names').$type<TdbName[]>().notNull().default([]),
    songType: varchar('song_type', { length: 32 }).notNull(),
    /** 编曲指向原曲。上游删原曲时置空而不是删编曲 */
    originalVersionId: integer('original_version_id').references(
      (): AnyPgColumn => tdbSong.id,
      { onDelete: 'set null' },
    ),
    artistString: text('artist_string'),
    lengthSeconds: integer('length_seconds'),
    publishDate: date('publish_date'),
    version: integer('version').notNull().default(0),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 原曲页反查编曲全靠它
    index('tdb_song_original_idx').on(t.originalVersionId),
    index('tdb_song_type_idx').on(t.songType),
  ],
)
```

关系两张表 `tdb_album_artist`（带 `categories`）与 `tdb_album_track`（带 `discNumber`、`trackNumber`），双向外键 `onDelete: 'cascade'`，各建一条反向索引。

- [ ] **Step 2: 中文层**

```ts
/**
 * 中文层。**故意不设到 tdb_* 的外键。**
 *
 * 镜像表会被同步作业整表重建，也可能因上游删条目而少行。若这里挂外键，
 * 一次重建就把译名连带删掉，而译名是这个模块唯一不可再生的资产——
 * 镜像随时能重拉，译名重来一遍要人再录一次。
 * 上游条目消失时这里留下孤儿行，由 T6 的「孤儿视图」让 staff 决定去留。
 */
export const chronicleEntry = pgTable(
  'chronicle_entry',
  {
    entityKind: varchar('entity_kind', { length: 16 }).notNull(),
    tdbId: integer('tdb_id').notNull(),
    nameZh: varchar('name_zh', { length: 200 }),
    /** 索引期生成，不接受外部写入 */
    pinyin: text('pinyin'),
    pinyinInitials: text('pinyin_initials'),
    noteZh: text('note_zh'),
    source: varchar('source', { length: 16 }).notNull().default('staff'),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.entityKind, t.tdbId] }),
    check('chronicle_entry_kind', sql`${t.entityKind} in ('artist','album','song')`),
    // 至少有一样内容，否则是空行
    check('chronicle_entry_nonempty', sql`${t.nameZh} is not null or ${t.noteZh} is not null`),
  ],
)
```

- [ ] **Step 3: 提议队列与同步状态**

`chronicleProposal`：`id` uuid、`entityKind`、`tdbId`、`nameZh`、`noteZh`、`reason`、`proposerId → user.id (set null)`、`status`、`reviewedBy`、`reviewedAt`、`createdAt`。索引 `(status, createdAt)` 给后台队列，部分唯一索引挡同一人对同一实体的重复 open 提议。

`chronicleSyncState`：`entityKind` 主键、`cursor` integer、`lastFullSyncAt`、`lastActivityDate`、`updatedAt`。

- [ ] **Step 4: 香霖堂对接列**

`kourindou.ts` 的 `circle` 加 `tdbArtistId: integer(...).references(() => tdbArtist.id, { onDelete: 'set null' })`，加唯一索引（一个 TouhouDB 社团最多绑一个本地社团）。

- [ ] **Step 5: 生成并应用迁移**

```bash
cd packages/db && bun run generate && bun run migrate
```

检查生成的 SQL：两条 CHECK 都在、`tdb_song` 的自引用外键是 `set null`、`chronicle_entry` **没有**到 `tdb_*` 的外键。

- [ ] **Step 6: 写不变量测试**

`packages/db/src/chronicle.test.ts`：

```ts
test('删掉镜像行不会带走译名——这是分表的全部理由', async () => {
  await db.insert(schema.tdbArtist).values({ id: 999001, defaultName: 'Probe' })
  await db.insert(schema.chronicleEntry).values({
    entityKind: 'artist', tdbId: 999001, nameZh: '探针社团',
  })
  await db.delete(schema.tdbArtist).where(eq(schema.tdbArtist.id, 999001))
  const [kept] = await db.select().from(schema.chronicleEntry)
    .where(and(eq(schema.chronicleEntry.entityKind, 'artist'),
               eq(schema.chronicleEntry.tdbId, 999001)))
  expect(kept?.nameZh).toBe('探针社团')
  await db.delete(schema.chronicleEntry).where(eq(schema.chronicleEntry.tdbId, 999001))
})

test('译名与说明都为空的行进不去', async () => {
  const bad = db.insert(schema.chronicleEntry)
    .values({ entityKind: 'artist', tdbId: 999002 })
  expect(bad).rejects.toThrow()
})
```

- [ ] **Step 7: 门禁 + 提交**

Run: `bun run check:fix && bun run typecheck && bun run test -- --force`

---

## T3: TouhouDB 同步管线（阶段一：社团 + 专辑）

**Files:** Create `packages/db/scripts/_shared/tdb-client.ts`、`packages/db/scripts/sync-touhoudb.ts`、`packages/db/src/tdb-sync.test.ts`；Modify `packages/db/package.json`

**Interfaces:**
- Consumes: T2 的 `tdbArtist` / `tdbAlbum` / `tdbAlbumArtist` / `tdbAlbumTrack` / `tdbSyncState`
- Produces: `createTdbClient(opts) → { fetchPage(entity, start, fields), fetchActivity(before) }`、`syncEntity(kind, opts)`

- [ ] **Step 1: 限速客户端**

```ts
const MIN_INTERVAL_MS = 2000
const UA = 'gensokyo-chronicle/1.0 (+https://th.saop.cc)'

/**
 * 403 是实测过的：请求打密了对方直接拒。所以三件事一个都不能少——
 * 固定最小间隔、指数退避、以及带联系方式的 UA。
 */
export function createTdbClient(base = 'https://touhoudb.com/api') {
  let lastAt = 0
  const gate = async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastAt)
    if (wait > 0) await Bun.sleep(wait)
    lastAt = Date.now()
  }

  async function get<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await gate()
      const res = await fetch(`${base}${path}`, {
        headers: { accept: 'application/json', 'user-agent': UA },
      })
      if (res.ok) return (await res.json()) as T
      // 403 在这里和 429 同义：被限流了，退避后重试
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        await Bun.sleep(2000 * 2 ** attempt)
        continue
      }
      throw new Error(`tdb ${path} → ${res.status}`)
    }
    throw new Error(`tdb ${path} → 退避 5 次仍失败`)
  }
  return { get }
}
```

- [ ] **Step 2: 写会失败的测试（打桩，不碰真实 API）**

`tdb-sync.test.ts` 用注入的 `get` 桩验三件事：**页内失败不中止整轮**、**同一页重跑结果幂等**、**游标写库后能从断点续**。

```ts
test('中断后从游标续跑，不重头来过', async () => {
  const seen: number[] = []
  const stub = async (path: string) => {
    const start = Number(new URL(`http://x${path}`).searchParams.get('start'))
    seen.push(start)
    if (start === 200) throw new Error('模拟中断')
    return { items: page(start), totalCount: 300 }
  }
  await expect(syncEntity('artist', { get: stub })).rejects.toThrow()
  expect(await cursorOf('artist')).toBe(200)
  seen.length = 0
  await syncEntity('artist', { get: async (p) => ({ items: page(n(p)), totalCount: 300 }) })
  expect(seen[0]).toBe(200) // 从断点起，不是 0
})
```

- [ ] **Step 3: 跑测试确认失败** → 模块不存在

- [ ] **Step 4: 同步脚本**

要点：

- 分页 `maxResults=100`，专辑带 `fields=Tracks,Artists,MainPicture`（实测列表端点批量返回关系，省掉约 24,700 次详情调用）
- upsert 用 `onConflictDoUpdate`，`where: sql\`excluded.version > tdb_album.version\`` 跳过没变的行
- 关系表：**先删该专辑的旧关系再插**，否则上游删曲目时本地留幽灵行
- 每页结束写 `cursor`，整轮结束写 `lastFullSyncAt` 并把 `cursor` 归零
- 单页失败记录并继续；整轮结束打印失败清单并以非零退出码结束
- `songType` 不在枚举内时归 `'Other'`，不丢行

**已知限制写进注释**：全量用 `start` 偏移分页，期间上游新增会让个别行漂移。这不靠加锁解决，靠随后的增量轮补齐。

- [ ] **Step 5: 增量模式**

`--incremental`：从 `lastActivityDate` 起用 `/activityEntries?before=` 回溯，取 `entry.entryType` 与 `entry.id`，逐条重拉。`editEvent` 为删除时给镜像行打标记而不是物理删。

- [ ] **Step 6: 跑测试确认通过**，加 `"sync:tdb"` 脚本

- [ ] **Step 7: 真实跑一次阶段一**

```bash
cd packages/db && bun run sync:tdb -- --kind=artist,album
```

预期约 456 次请求、15 分钟。跑完核对：`tdb_artist` 约 20,779 行、`tdb_album` 约 24,702 行、关系表非空。

- [ ] **Step 8: 门禁 + 提交**

---

## T4: 拼音与 Meilisearch 索引

**Files:** Create `apps/api/src/modules/chronicle/pinyin.ts`、`apps/api/scripts/reindex-chronicle.ts`、`apps/api/src/chronicle-search.test.ts`；Modify `apps/api/package.json`

**Interfaces:**
- Consumes: T2 的镜像表与 `chronicleEntry`
- Produces:
  - `pinyinOf(nameZh) → { full, initials }`
  - `chronicleDocId(entityKind, tdbId) → \`${entityKind}:${tdbId}\`` —— **Meili 文档主键，T6 单文档刷新必须用同一个函数**，三类实体的 id 空间会撞，各拼各的迟早对不上
  - `buildDoc(row) → ChronicleDoc` —— 索引文档的唯一构造处，T6 刷新单条时复用，不另写一份
  - `bun run reindex:chronicle`

- [ ] **Step 1: 拼音**

```ts
import { pinyin } from 'pinyin-pro'

/**
 * 只对中文译名生成拼音。原名是日文，给它注音没有意义——
 * 用户不会用罗马音搜日文原名，那条路径由 TouhouDB 自带的 Romaji 别名覆盖。
 */
export function pinyinOf(nameZh: string): { full: string; initials: string } {
  return {
    full: pinyin(nameZh, { toneType: 'none', type: 'string', separator: ' ' }),
    initials: pinyin(nameZh, { pattern: 'first', toneType: 'none', type: 'string', separator: '' }),
  }
}
```

- [ ] **Step 2: 写会失败的测试**

```ts
test('全拼与首字母', () => {
  expect(pinyinOf('东方红魔乡')).toEqual({ full: 'dong fang hong mo xiang', initials: 'dfhmx' })
})
test('中英混排不炸', () => {
  expect(pinyinOf('涡轮蒸鸭GLIKER').initials).toContain('wlzy')
})
```

- [ ] **Step 3: 跑测试确认失败**，然后实现，再跑确认通过

- [ ] **Step 4: 索引脚本**

照 `reindex.ts` 的形状（裸 fetch，不引 `meilisearch-js`）。索引名 `chronicle`，`primaryKey: 'docId'`，值由 `chronicleDocId()` 产出——**不要在别处手拼这个字符串**，三类实体的 id 空间会撞，拼错了表现为「搜索有结果但点进去 404」。

`hasZh` 是布尔字段，取 `nameZh !== null`。它是 staff 补译名的工作流入口：233,511 条里哪些还没有中文名，只能靠这个筛。

```ts
searchableAttributes: ['nameZh', 'pinyin', 'pinyinInitials', 'namesAll', 'artistString'],
filterableAttributes: ['entityKind', 'songType', 'discType', 'hasZh'],
sortableAttributes: ['releaseDate', 'ratingAverage'],
```

**分批灌**，每批 1000 条：233,511 条一次 POST 会超 Meili 的负载上限。

- [ ] **Step 5: 索引行为测试**

对真实索引断言三件事，其中第一条是**引擎白送的、我们绝不能自己再实现一遍**的：

```ts
test('简繁交叉匹配由引擎提供，不写转换层', async () => {
  // 库里存的是日文汉字「東方紅魔郷」，用简体「东方」要能搜到
  const hits = await search('东方')
  expect(hits.some((h) => h.namesAll.includes('東方紅魔郷'))).toBe(true)
})
test('拼音全拼命中', async () => expect(await search('dongfang')).not.toHaveLength(0))
test('拼音首字母命中', async () => expect(await search('dfhmx')).not.toHaveLength(0))
```

- [ ] **Step 6: 全量建索引，门禁 + 提交**

```bash
cd apps/api && bun run reindex:chronicle
```

---

## T5: api 读路由

**Files:** Create `apps/api/src/modules/chronicle/index.ts`、`apps/api/src/chronicle.test.ts`；Modify `apps/api/src/app.ts`

**Interfaces:**
- Consumes: T1 的 `chronicleSearchQuerySchema` / `tdbIdSchema`、T2 的表、T4 的 `chronicleDocId`
- Produces: `GET /api/chronicle/search`、`GET /api/chronicle/artists/:id`、`GET /api/chronicle/albums/:id`、`GET /api/chronicle/songs/:id`

- [ ] **Step 1: 先写失败测试**

五条断言：搜索走 Meili 且分页正确；**`needsZh=true` 只返回还没有中文译名的条目**（走 Meili 的 `hasZh = false` 过滤）；社团详情带出它的专辑与香霖堂资源；专辑详情带出曲目与社团；**曲目详情按 `songType` 返回两种形态**——`Original` 带 `arrangements`，否则带 `originalSong`。

再加一条边界：`:id` 传非数字（`/artists/abc`）→ 400 且不是 500。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

```ts
/** tdbId 是正整数不是 uuid，所以不能用 entityIdParam */
const tdbIdParam = validate('param', z.object({ id: tdbIdSchema }))

export const chronicle = new Hono<AppEnv>()
  .get('/search', validate('query', chronicleSearchQuerySchema), async (c) => { /* ... */ })
  .get('/artists/:id', tdbIdParam, async (c) => { /* ... */ })
  .get('/albums/:id', tdbIdParam, async (c) => { /* ... */ })
  .get('/songs/:id', tdbIdParam, async (c) => { /* ... */ })
```

每个详情路由都 `LEFT JOIN chronicle_entry ON (entity_kind, tdb_id)` 取译名与说明。**社团详情还要 join 香霖堂**：`circle.tdbArtistId = tdb_artist.id`，再取该 circle 名下**已发布**的资源（状态判断走白名单 `status === 'published'`，不写 `!== 'delisted'`）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 挂进 `app.ts`，门禁 + 提交**

---

## T6: 中文层写路径与后台审批

**Files:** Create `apps/api/src/modules/chronicle/entry.ts`、`apps/api/src/chronicle-entry.test.ts`；Modify `apps/api/src/modules/chronicle/index.ts`、`apps/api/src/modules/moderation.ts`、`apps/api/src/rate.ts`

- [ ] **Step 1: 先写失败测试**

- 匿名提议 → 401；登录可提议 → 201
- 同一人对同一实体重复 open 提议 → 409（部分唯一索引兜底）
- 提议受限流，冷却窗内第二条 → 429 带 `Retry-After`
- 普通用户看不到审批队列 → 403
- 审批通过 → 写 `chronicle_entry`、记 `moderationLog`、提议转 `accepted`
- **重复审批同一条 → 409**（沿用 M4 `/resolve` 的条件更新 + `.returning()` 写法，别先读后写）
- staff 批量导入 500 条 → 200；501 条 → 400

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

`rate.ts` 加 `proposal` bucket（冷却 15 秒，小时配额 20）。

审批的写入必须在一个事务里做三件事：upsert `chronicle_entry`、更新提议状态、写 `moderationLog`。

译名变更后**同步刷该实体的 Meili 文档**（单文档 upsert，不重建全量），主键与文档体分别用 T4 的 `chronicleDocId()` 与 `buildDoc()`，**不在这里另写一份构造逻辑**——两处构造漂移的表现是「搜索结果里的名字是旧的，点进去是新的」，很难查。写入前用 `pinyinOf()` 重算拼音。

刷索引失败不回滚事务：索引可由 `reindex:chronicle` 自愈，这与 M3 不建 outbox 表的判断一致。

`source` 字段按写入路径记 `'staff'` 或 `'proposal'`，便于按来源批量回滚坏译名。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 孤儿视图**

`GET /api/moderation/chronicle/orphans`：列出 `chronicle_entry` 里 `tdbId` 在镜像表中已不存在的行，让 staff 决定删还是留。这是 T2 「不设外键」这个决定的配套，没有它孤儿行会永远看不见。

- [ ] **Step 6: 门禁 + 提交**

---

## T7: web —— 搜索页与条目页

**Files:** Create `apps/web/app/routes/chronicle/{index,artist,album,song}.tsx`、`apps/web/app/lib/chronicle.ts`；Modify `apps/web/app/routes.ts`、`apps/web/messages/{zh,ja,en}.json`

- [ ] **Step 1: 路由与 URL**

`routes.ts` 去掉 `stub-chronicle`，换成：

```ts
route('chronicle', 'routes/chronicle/index.tsx'),
route('chronicle/c/:id', 'routes/chronicle/artist.tsx'),
route('chronicle/a/:id', 'routes/chronicle/album.tsx'),
route('chronicle/s/:id', 'routes/chronicle/song.tsx'),
```

**原曲不单开路由。** `song.tsx` 按 `songType` 切模板。

- [ ] **Step 2: 搜索页**

搜索框 + 实体类型筛选 + 分页。空态要说清这里能搜什么（中文、拼音、首字母、日文原名），因为「搜不到」和「不知道能搜什么」在冷启动期长得一样。

**staff 多一个「只看待补译名」开关**（`?needsZh=1`）。这是补译名的唯一工作流入口：233,511 条里没有它就无从下手，只能靠碰运气翻。普通用户看不到这个开关。

- [ ] **Step 3: 三个条目页**

共同零件：中文名（无则回落原名并标注「暂无中文译名」）、原名、staff 说明、**上游回链**（`https://touhoudb.com/{Ar|Al|S}/{id}`，`externalLinkProps`）、THBWiki 搜索链接、「提议译名」按钮（未登录跳 `/login?next=`）。

- 社团页：专辑列表 + 香霖堂中该社团的资源
- 专辑页：封面、发行日、社团、曲目列表
- 曲目页：`Original` 时列出所有编曲；否则指回原曲 + 收录专辑

- [ ] **Step 4: 提议对话框**

复用 M4 `ReportDialog` 的形状：受控 `open`、`e.preventDefault()`、错误按 `error.code` 查文案。

- [ ] **Step 5: 三语文案 + 审计**

Run: `bun run check-messages`（key 集合必须逐字相同）

- [ ] **Step 6: 浏览器验证**

用 `form_input` 与 `javascript_tool` 驱动（`computer` 的点击进不到预览面板）。至少验：中文搜到、拼音搜到、条目页三种模板都渲染、原曲页列出编曲。

- [ ] **Step 7: 门禁 + 提交**

---

## T8: 香霖堂对接

**Files:** Modify `apps/api/src/modules/kourindou/*`、`apps/web/app/routes/kourindou/upload.tsx`、`apps/web/app/routes/kourindou/detail.tsx`

- [ ] **Step 1: 先写失败测试**

绑定 `tdbArtistId` 后，资源详情返回上游社团信息；同一个 `tdbArtistId` 绑第二个 circle → 409。

- [ ] **Step 2: 投稿表单接搜索**

社团字段加「从求闻史纪搜索」：输中文或拼音 → 命中列表 → 选中后带出原名、头像、官网，并写 `circle.tdbArtistId`。

- [ ] **Step 3: 资源详情页加「TouhouDB 编目」区块**，链到对应条目页

- [ ] **Step 4: 跑测试确认通过，门禁 + 提交**

---

## T9: 阶段二 —— 曲目与原曲

**Files:** Modify `packages/db/scripts/sync-touhoudb.ts`（如需）、`apps/api/scripts/reindex-chronicle.ts`

- [ ] **Step 1: 同步曲目**

```bash
cd packages/db && bun run sync:tdb -- --kind=song
```

约 1,881 次请求、超过一小时。**中途一定会断，验证的就是断点续跑**：跑到一半 Ctrl+C，重跑，确认从游标继续而不是重头。

- [ ] **Step 2: 核对原曲图**

`tdb_song` 里 `songType = 'Original'` 的行数应为数百量级；随机取一首原曲，反查 `originalVersionId` 指向它的编曲数量，与 `/songs/{id}/derived` 的 `totalCount` 比对。

- [ ] **Step 3: 重建索引并量测**

Run: `bun run reindex:chronicle`

记录：文档总数、索引体积、建索引耗时、搜索 p95。这些数字写进 spec 第十二节风险 3，替换掉「用阶段一数据外推」。

- [ ] **Step 4: 原曲页上线**（T7 已写好模板，这里只是有数据了）

- [ ] **Step 5: 门禁 + 提交**

---

## T10: 验收与上线

**Files:** Modify `apps/api/scripts/e2e.ts`、`CLAUDE.md`、`docs/superpowers/plans/2026-09-05-m5-chronicle.md`

- [ ] **Step 1: e2e 扩充**

在现有 40 项之上加：

1. 中文搜到社团（库里是日文原名 + 我们的译名）
2. 拼音全拼与首字母各搜到一次
3. 社团页带出香霖堂中该社团的已发布资源，**不带出未发布的**
4. 曲目详情按 `songType` 返回两种形态
5. 原曲页列出编曲，数量与库中一致
6. 匿名提议 401，登录提议 201，重复提议 409
7. 审批通过后译名生效且 Meili 立即可搜到
8. **重复审批同一条提议 → 409**
9. **删掉镜像行后译名仍在**（分表这个决定的端到端回归）

跑完自清理，沿用 `E2E_KEEP=1` 约定。

- [ ] **Step 2: 全量门禁**

Run: `bun run check:fix && bun run typecheck && bun run test -- --force && bun run build && bun run check-messages && cd apps/api && bun run e2e`

- [ ] **Step 3: 上线**

顺序不能改：rsync（不带 `--delete`，排除 `.env`）→ 生产机 `build` → **单独** `run --rm migrate` → `up -d`。build 前打回滚 tag `pre-m5`。

同步作业在生产用一次性容器跑：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml run --rm migrate bun run packages/db/scripts/sync-touhoudb.ts
```

**注意**：生产同步会跑一个多小时，用 `-d` 或 tmux，别让 SSH 断开杀掉它。

- [ ] **Step 4: 生产只读验收 + 收口**

CLAUDE.md 的 M5 小节从「进行中」改「已完成」；本计划补状态行（上线日期、提交范围、实测数字）。

---

## 阶段划分回顾

| 阶段 | 任务 | 数据量 | 请求数 |
|---|---|---|---|
| 一 | T0–T8 | 45,481 条（社团 + 专辑） | 456 |
| 二 | T9–T10 | 188,030 条（曲目 + 原曲） | 1,881 |

**这是排期不是缩范围**，最终交付仍是四类实体全量。阶段一上线时同步作业小一个数量级，出问题好收拾。

## 推迟项

见 spec 第十一节。触发条件到了再开新计划，不在本计划内做。
