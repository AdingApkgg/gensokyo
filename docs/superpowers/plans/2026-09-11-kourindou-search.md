# 香霖堂搜索（Meili 接管查询）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/kourindou` 真正能搜：前端补搜索框，api 在 `q` 非空时走 Meilisearch 取 id、回 Postgres 取行，十处资源写点后同步文档，Meili 不可用时降级到现有 ILIKE。

**Architecture:** 一个新模块 `apps/api/src/search.ts` 持有文档映射、索引设置、裸 fetch 客户端、同步与查询；`reindex.ts` 与列表端点都只经它访问 Meili。可见性永远由 Postgres 的 `status='published' AND deleted_at IS NULL` 白名单决定，Meili 只提供 id 与顺序。前端是一个 GET 表单，零新增 JS。

**Tech Stack:** Bun、hono、drizzle、zod v4、Meilisearch v1.53（裸 fetch，不引 meilisearch-js）、React Router v8 `<Form>`、Paraglide。

**Spec:** `docs/superpowers/specs/2026-09-11-kourindou-search-design.md`

## Global Constraints

- 不引任何新依赖：api 用裸 `fetch`，web 不加库。做完跑 `bun run check-bundle-size`，首屏 ≤ 155 KB、单路由 ≤ 270 KB。
- 可见性只在 Postgres：任何返回资源行的路径都带 `and(eq(resource.status,'published'), isNull(resource.deletedAt))`。
- 文档映射与索引设置只有一份：`apps/api/src/search.ts`。
- `syncResource()` 永不抛错；一律在 `db.transaction()` resolve **之后**以 `void syncResource(id)` 调用。
- 消息键三语同时加（`apps/web/messages/{zh,ja,en}.json`），改完跑 `bun run check-messages`。
- 前端会进 SSR HTML 的节点零 `initial` 隐藏态；所有新增 `<Link>` 带 `viewTransition`。
- api 测试打的是共享开发库：新建的账号/资源必须经 `trackUser` / `trackResource` 登记，`afterAll(cleanupTracked)`。
- 提交信息用中文，遵循仓库既有风格（`feat(search): …`），结尾带 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 每个任务开始前确认 `bun run services:status` 三项 ✓（postgres / meili / minio）；测试与 reindex 都打本机 Meili `:57700`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `apps/api/src/search.ts`（新） | Meili 的一切：`SEARCH_INDEX`、`SEARCH_SETTINGS`、`SEARCH_COLUMNS`、`toDoc`、`buildFilter`、`buildSort`、`meiliFetch`、`ensureIndex`、`awaitIndexing`、`searchResources`、`syncResource`、`flushSyncs` |
| `apps/api/src/search.test.ts`（新） | 纯函数单测，不需要服务 |
| `apps/api/src/env.ts` | 加 `MEILI_HOST` / `MEILI_MASTER_KEY` 启动校验 |
| `apps/api/src/index.ts` | 启动时 `ensureIndex()` |
| `apps/api/scripts/reindex.ts` | 改为 import `search.ts`，分批灌入 |
| `apps/api/src/modules/kourindou/index.ts` | 列表端点走 Meili + 降级；五处写点后同步 |
| `apps/api/src/modules/interactions.ts` / `moderation.ts` / `admin.ts` | 四处写点后同步 |
| `apps/api/src/kourindou.test.ts` | 集成测试追加两个 describe |
| `packages/shared/src/kourindou/enums.ts` / `schemas.ts` (+ `schemas.test.ts`) | `relevance`、`sort` 可选、`q` trim |
| `apps/web/app/lib/search.ts` (+ `search.test.ts`)（新） | `effectiveSort` / `sortOptions` 纯函数 |
| `apps/web/app/routes/kourindou/list.tsx` | loader 转发 `q`；搜索表单；结果计数与清除；空态；排序选项 |
| `apps/web/messages/{zh,ja,en}.json` | 七个新键 |
| `CLAUDE.md` | 香霖堂约定加「同步表」 |

---

### Task 1: `search.ts` 的纯函数核心

**Files:**
- Create: `apps/api/src/search.ts`
- Create: `apps/api/src/search.test.ts`

**Interfaces:**
- Produces:
  - `SEARCH_INDEX: 'resources'`
  - `SEARCH_SETTINGS`（Meili settings 对象）
  - `SEARCH_COLUMNS`（drizzle select 形状）与 `type SearchRow`
  - `toDoc(row: SearchRow, tagIds: string[]): SearchDoc`
  - `buildFilter(q: FilterInput): string | undefined`
  - `buildSort(sort: ResourceSort): string[] | undefined`

- [ ] **Step 1: 写失败的单测**

`apps/api/src/search.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { buildFilter, buildSort, toDoc } from './search'

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'touhou-koumakyou',
  titleOriginal: '東方紅魔郷',
  title: { zh: '东方红魔乡', en: 'Embodiment of Scarlet Devil' },
  description: { zh: '第六作' },
  kind: 'game' as const,
  license: 'allowed' as const,
  circleId: null,
  uploaderId: 'u_1',
  circleNameRaw: '上海アリス幻樂団',
  coverUrl: null,
  downloadCount: 3,
  ratingSum: 9,
  ratingCount: 2,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  status: 'published' as const,
  deletedAt: null,
}

describe('toDoc', () => {
  test('三语标题摊平成数组，原文在最前', () => {
    const doc = toDoc(row, ['th06'])
    expect(doc.titles).toEqual([
      '東方紅魔郷',
      '东方红魔乡',
      'Embodiment of Scarlet Devil',
    ])
    expect(doc.descriptions).toEqual(['第六作'])
    expect(doc.tagIds).toEqual(['th06'])
  })

  test('rating 是均分，无评分时为 0；createdAt 是毫秒数', () => {
    expect(toDoc(row, []).rating).toBe(4.5)
    expect(toDoc({ ...row, ratingCount: 0, ratingSum: 0 }, []).rating).toBe(0)
    expect(toDoc(row, []).createdAt).toBe(Date.UTC(2026, 0, 2))
  })

  test('文档不带 status / deletedAt——可见性不是索引的事', () => {
    const doc = toDoc(row, []) as Record<string, unknown>
    expect('status' in doc).toBe(false)
    expect('deletedAt' in doc).toBe(false)
  })
})

describe('buildFilter', () => {
  test('什么都不传 → undefined', () => {
    expect(buildFilter({})).toBeUndefined()
  })

  test('全部条件 AND 起来，tag 用 IN', () => {
    expect(
      buildFilter({
        kind: 'game',
        license: 'allowed',
        tag: ['th06', 'th07'],
        circleId: '22222222-2222-4222-8222-222222222222',
        uploaderId: 'u_1',
      }),
    ).toBe(
      'kind = "game" AND license = "allowed" AND tagIds IN ["th06", "th07"] AND circleId = "22222222-2222-4222-8222-222222222222" AND uploaderId = "u_1"',
    )
  })

  test('字符串值里的引号与反斜杠被转义（userId 是任意字符串）', () => {
    expect(buildFilter({ uploaderId: 'a"b\\c' })).toBe('uploaderId = "a\\"b\\\\c"')
  })

  test('空 tag 数组等于没传', () => {
    expect(buildFilter({ tag: [] })).toBeUndefined()
  })
})

describe('buildSort', () => {
  test('四档映射', () => {
    expect(buildSort('relevance')).toBeUndefined()
    expect(buildSort('newest')).toEqual(['createdAt:desc'])
    expect(buildSort('downloads')).toEqual(['downloadCount:desc'])
    expect(buildSort('rating')).toEqual(['rating:desc'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/search.test.ts`
Expected: FAIL，`Cannot find module './search'`

- [ ] **Step 3: 写最小实现**

`apps/api/src/search.ts`（本任务只写纯函数部分，Task 3 再追加客户端）：

```ts
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

export type SearchRow = {
  [K in keyof typeof SEARCH_COLUMNS]: (typeof SEARCH_COLUMNS)[K]['_']['data']
}

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
  Pick<ListResourcesQuery, 'kind' | 'license' | 'tag' | 'circleId' | 'uploaderId'>
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
```

注意：`ResourceSort` 此刻还没有 `'relevance'`，`buildSort('relevance')` 会有类型错误——Task 2 加上。这一步只要求 `bun test` 过；`typecheck` 在 Task 2 末尾才要求绿。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && bun test src/search.test.ts`
Expected: PASS，9 个测试

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/search.ts apps/api/src/search.test.ts
git commit -m "feat(search): 文档映射、过滤与排序拼装——Meili 的唯一一份定义

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: shared 的排序枚举与查询 schema

**Files:**
- Modify: `packages/shared/src/kourindou/enums.ts:120`
- Modify: `packages/shared/src/kourindou/schemas.ts:92-105`
- Modify: `packages/shared/src/kourindou/schemas.test.ts`
- Modify: `apps/web/app/routes/kourindou/list.tsx:206-218`（排序标签映射）
- Modify: `apps/web/messages/zh.json` / `ja.json` / `en.json`（加 `sort_relevance`）

**Interfaces:**
- Produces: `RESOURCE_SORT = ['relevance','newest','downloads','rating']`；`listResourcesQuerySchema.sort` 可选、`q` trim。
- Consumes: 无。

- [ ] **Step 1: 写失败的测试**

在 `packages/shared/src/kourindou/schemas.test.ts` 末尾追加：

```ts
describe('listResourcesQuerySchema：搜索', () => {
  test('sort 不传时是 undefined，不是 newest——默认值由 handler 按有无 q 决定', () => {
    const r = listResourcesQuerySchema.parse({})
    expect(r.sort).toBeUndefined()
  })

  test('relevance 是合法排序', () => {
    expect(listResourcesQuerySchema.parse({ sort: 'relevance' }).sort).toBe(
      'relevance',
    )
  })

  test('q 两端空白被 trim，纯空白等于空串', () => {
    expect(listResourcesQuerySchema.parse({ q: '  紅魔  ' }).q).toBe('紅魔')
    expect(listResourcesQuerySchema.parse({ q: '   ' }).q).toBe('')
  })
})
```

若文件顶部没有 import `listResourcesQuerySchema`，加上：`import { listResourcesQuerySchema } from './schemas'`。

同一文件「列表筛选（P0 回归点）」里现有的 `expect(parsed.sort).toBe('newest')` 改为 `expect(parsed.sort).toBeUndefined()`——默认值不再由 zod 给。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && bun test src/kourindou/schemas.test.ts`
Expected: FAIL，`sort` 是 `'newest'`、`'relevance'` 报 invalid enum

- [ ] **Step 3: 改 enums 与 schema**

`packages/shared/src/kourindou/enums.ts:120`：

```ts
/** relevance 只在带 q 的搜索里有意义；无 q 时 api 把它当 newest */
export const RESOURCE_SORT = ['relevance', 'newest', 'downloads', 'rating'] as const
```

`packages/shared/src/kourindou/schemas.ts` 里 `listResourcesQuerySchema` 的最后两行：

```ts
  q: z.string().trim().max(100).optional(),
  /**
   * 不给默认值。默认按有无 q 决定（有 → relevance，无 → newest），
   * 这只能在 handler 里判——zod 一旦默认，handler 就分不清「用户选了最新」
   * 与「没选」。
   */
  sort: z.enum(RESOURCE_SORT).optional(),
```

- [ ] **Step 4: 跑 shared 测试确认通过**

Run: `cd packages/shared && bun test`
Expected: 全部 PASS

- [ ] **Step 5: 补 web 的排序标签，保持 typecheck 绿**

三个消息文件各加一键（放在 `sort_rating` 之后）：

- `zh.json`：`"sort_relevance": "相关度",`
- `ja.json`：`"sort_relevance": "関連度順",`
- `en.json`：`"sort_relevance": "Relevance",`

`apps/web/app/routes/kourindou/list.tsx` 排序 `Filter` 的 `label` 映射加一行：

```tsx
            label: {
              relevance: m.sort_relevance(),
              newest: m.sort_newest(),
              downloads: m.sort_downloads(),
              rating: m.sort_rating(),
            }[s],
```

api 端 `kourindou/index.ts:50-55` 现在用 `q.sort === 'downloads'`——`sort` 变成可选后仍能编译（undefined 落到 `desc(createdAt)`），本任务不动它，Task 5 重写。

- [ ] **Step 6: 跑门禁**

Run: `bun run check-messages && bun run typecheck`
Expected: 两者绿。`check-messages` 不报缺键；typecheck 无错。

- [ ] **Step 7: 提交**

```bash
git add packages/shared apps/web/app/routes/kourindou/list.tsx apps/web/messages
git commit -m "feat(search): 排序枚举加 relevance，sort 改可选、q 去空白

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Meili 客户端、索引初始化、同步与全量重建

**Files:**
- Modify: `apps/api/src/search.ts`（追加）
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/scripts/reindex.ts`（重写）

**Interfaces:**
- Produces:
  - `meiliFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>`，非 2xx 抛 `MeiliError`（带 `.status`）
  - `ensureIndex(): Promise<void>`（幂等，末尾等待任务完成）
  - `awaitIndexing(timeoutMs = 10_000): Promise<void>`
  - `searchResources(p: { q: string; filter?: string; sort?: string[]; page: number; pageSize: number }): Promise<{ ids: string[]; total: number }>`
  - `syncResource(id: string): Promise<void>`（永不 reject）
  - `flushSyncs(): Promise<void>`（等所有在途同步 + 索引任务；只给测试与脚本）
- Consumes: Task 1 的 `SEARCH_INDEX` / `SEARCH_SETTINGS` / `SEARCH_COLUMNS` / `toDoc`。

- [ ] **Step 1: 追加客户端与同步到 `search.ts`**

在文件 import 区把 `import { schema } from '@gensokyo/db'` 改为 `import { db, schema } from '@gensokyo/db'`，并加 `import { eq } from 'drizzle-orm'`；`const { resource } = schema` 改为 `const { resource, resourceTag } = schema`。文件末尾追加：

```ts
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
    throw new MeiliError(res.status, `meili ${path} → ${res.status} ${await res.text()}`)
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
        body: JSON.stringify([toDoc(row, tags.map((t) => t.tagId))]),
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
```

- [ ] **Step 2: env.ts 加启动校验**

`apps/api/src/env.ts` 的 zod 对象里，`S3_PUBLIC_BASE_URL` 之后加：

```ts
    /** 搜索。缺了它 api 每次带 q 的请求都会降级到 ILIKE 并刷一条 error 日志 */
    MEILI_HOST: z.url(),
    MEILI_MASTER_KEY: z.string().min(1),
```

- [ ] **Step 3: index.ts 启动时建索引**

`apps/api/src/index.ts`：在 `import './env'` 之后加

```ts
import { ensureIndex } from './search'

/**
 * 新部署的 Meili 从零起也要拿到带 filterable 设置的空索引，否则第一次带筛选
 * 的搜索会因「属性不可过滤」报错而全部降级。失败只记日志：搜索有 ILIKE 兜底，
 * 不该因为 Meili 没起来而让 api 起不来。
 */
void ensureIndex().catch((err) => console.error('[search] 索引初始化失败', err))
```

- [ ] **Step 4: 重写 reindex.ts**

整个文件替换为：

```ts
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
  SEARCH_COLUMNS,
  SEARCH_INDEX,
  awaitIndexing,
  ensureIndex,
  meiliFetch,
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

  console.log(`reindexed ${docs.length} published resources into "${SEARCH_INDEX}"`)
}

await main()
```

- [ ] **Step 5: 验证：跑 reindex 并搜一次**

Run:

```bash
bun run --filter @gensokyo/api reindex
```

Expected: 打印 `reindexed N published resources into "resources"`，退出码 0。

Run:

```bash
curl -s -H 'authorization: Bearer dev_master_key' http://127.0.0.1:57700/indexes/resources/settings | head -c 400
```

Expected: 含 `"filterableAttributes":["kind","license","tagIds","circleId","uploaderId"]` 与 `"maxTotalHits":10000`。

- [ ] **Step 6: 类型与 lint**

Run: `bun run check && bun run typecheck`
Expected: 绿。若 Biome 要求 import 排序，按它的提示 `bun run check:fix`。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/search.ts apps/api/src/env.ts apps/api/src/index.ts apps/api/scripts/reindex.ts
git commit -m "feat(search): Meili 客户端、索引初始化、单行同步；reindex 改为共用一份映射

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 九处写点后同步

**Files:**
- Modify: `apps/api/src/modules/kourindou/index.ts`（PATCH、submit、status、license、download 五处）
- Modify: `apps/api/src/modules/interactions.ts`（评分）
- Modify: `apps/api/src/modules/moderation.ts`（审核）
- Modify: `apps/api/src/modules/admin.ts`（回收站删除、恢复）
- Modify: `apps/api/src/kourindou.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 3 的 `syncResource(id)`、`flushSyncs()`、`meiliFetch`、`SEARCH_INDEX`。

- [ ] **Step 1: 写失败的集成测试**

`apps/api/src/kourindou.test.ts` 顶部 import 区加：

```ts
import { ensureIndex, flushSyncs, meiliFetch, SEARCH_INDEX } from './search'
```

在 `afterAll(cleanupTracked)` 之后加：

```ts
beforeAll(async () => {
  await ensureIndex()
})
```

文件末尾追加：

```ts
/** 直接读 Meili 里的文档：404 表示不在索引里 */
async function indexedDoc(id: string) {
  return meiliFetch<{ id: string; titles: string[] }>(
    `/indexes/${SEARCH_INDEX}/documents/${id}`,
  ).catch((err: { status?: number }) => (err.status === 404 ? null : Promise.reject(err)))
}

describe('搜索索引同步', () => {
  test('发布后文档进索引，下架后文档被删', async () => {
    const veteran = await signUp('索引作者')
    await makeTrusted(veteran)
    const { resource } = await createResource(veteran, {
      titleOriginal: `東方紅魔郷 ${crypto.randomUUID().slice(0, 8)}`,
    })
    const id = resource?.id as string

    // 草稿不进索引
    await flushSyncs()
    expect(await indexedDoc(id)).toBeNull()

    await app.request(`/api/kourindou/resources/${id}/submit`, {
      method: 'POST',
      headers: { cookie: veteran.cookie },
    })
    await flushSyncs()
    expect((await indexedDoc(id))?.id).toBe(id)

    await app.request(
      `/api/kourindou/resources/${id}/status`,
      json(veteran, { to: 'delisted', reason: '自查后发现社团禁止转载' }),
    )
    await flushSyncs()
    expect(await indexedDoc(id)).toBeNull()
  })

  test('编辑标题后索引里的标题跟着变', async () => {
    const veteran = await signUp('改名作者')
    await makeTrusted(veteran)
    const { resource } = await createResource(veteran)
    const id = resource?.id as string
    await app.request(`/api/kourindou/resources/${id}/submit`, {
      method: 'POST',
      headers: { cookie: veteran.cookie },
    })
    await flushSyncs()

    const res = await app.request(`/api/kourindou/resources/${id}`, {
      method: 'PATCH',
      headers: { cookie: veteran.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ titleOriginal: '東方妖々夢 体験版' }),
    })
    expect(res.status).toBe(200)
    await flushSyncs()
    expect((await indexedDoc(id))?.titles[0]).toBe('東方妖々夢 体験版')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/kourindou.test.ts -t '搜索索引同步'`
Expected: FAIL——submit 之后 `indexedDoc` 仍为 null（没有同步）

- [ ] **Step 3: 在九处写点后加同步**

`apps/api/src/modules/kourindou/index.ts` import 区加：

```ts
import { syncResource } from '../../search'
```

五处，每处都在事务/更新 **resolve 之后、return 之前**：

1. `PATCH /resources/:id`：`const updated = await db.transaction(…)` 之后

```ts
      void syncResource(id)
      return c.json({ resource: updated })
```

2. `POST /resources/:id/submit`：`const [updated] = await db.update(…)` 之后

```ts
    void syncResource(id)
    return c.json({ status: updated?.status ?? to, autoPublished: auto })
```

3. `POST /resources/:id/status`：`await db.transaction(…)` 之后

```ts
      void syncResource(id)
      return c.json({ status: to })
```

4. `PATCH /resources/:id/license`：`await db.transaction(…)` 之后

```ts
      void syncResource(id)
      return c.json({ license: input.license })
```

5. `GET /resources/:slug/files/:fileId/download`：`await db.transaction(…)` 之后

```ts
    // downloads 排序读的是索引里的计数
    void syncResource(row.id)
    return c.redirect(file.url, 302)
```

`apps/api/src/modules/interactions.ts`：import `import { syncResource } from '../search'`；评分端点 `await db.transaction(…)` 之后

```ts
      // rating 排序读的是索引里的均分
      void syncResource(row.id)
      return c.json({ score })
```

`apps/api/src/modules/moderation.ts`：import `import { syncResource } from '../search'`；`/resources/:id/review` 的 `await db.transaction(…)` 之后

```ts
      void syncResource(id)
      return c.json({ status: to, struck: striking })
```

`apps/api/src/modules/admin.ts`：import `import { syncResource } from '../search'`；

- 回收站删除端点 `await db.transaction(…)` 之后：

```ts
      // soft 与 purge 都落到「删文档」：重读时行已软删或已不存在
      void syncResource(id)
      return c.json({ mode, id })
```

- 恢复端点 `await db.transaction(…)` 之后：

```ts
    void syncResource(id)
    return c.json({ restored: true })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && bun test src/kourindou.test.ts -t '搜索索引同步'`
Expected: PASS，2 个测试

Run: `cd apps/api && bun test`
Expected: 全部 PASS（既有测试不受影响；同步是 fire-and-forget，测试进程退出前若有在途 fetch 被中断只会打日志）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules apps/api/src/kourindou.test.ts
git commit -m "feat(search): 九处资源写点后同步索引文档

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 列表端点走 Meili，失败降级

**Files:**
- Modify: `apps/api/src/modules/kourindou/index.ts:32-92`
- Modify: `apps/api/src/kourindou.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `buildFilter` / `buildSort`，Task 3 的 `searchResources` / `flushSyncs` / `meiliFetch` / `toDoc` / `SEARCH_COLUMNS`。
- Produces: `GET /api/kourindou/resources?q=…` 在 `q` 非空时带响应头 `x-search-engine: meili | pg`；响应体形状不变。

- [ ] **Step 1: 写失败的集成测试**

`apps/api/src/kourindou.test.ts` 顶部 import 改为：

```ts
import {
  ensureIndex,
  flushSyncs,
  meiliFetch,
  SEARCH_COLUMNS,
  SEARCH_INDEX,
  toDoc,
} from './search'
```

文件末尾追加：

```ts
describe('搜索查询', () => {
  /** 建一条带唯一标记的已发布资源，返回 id 与标记 */
  async function published(s: Session, overrides = {}) {
    const token = crypto.randomUUID().slice(0, 8)
    const { resource } = await createResource(s, {
      titleOriginal: `東方紅魔郷 ${token}`,
      ...overrides,
    })
    const id = resource?.id as string
    await app.request(`/api/kourindou/resources/${id}/submit`, {
      method: 'POST',
      headers: { cookie: s.cookie },
    })
    await flushSyncs()
    return { id, token }
  }

  const search = async (qs: string) => {
    const res = await app.request(`/api/kourindou/resources?${qs}`)
    const body = (await res.json()) as { items: { id: string }[]; total: number }
    return { status: res.status, engine: res.headers.get('x-search-engine'), body }
  }

  let veteran: Session
  beforeAll(async () => {
    veteran = await signUp('搜索作者')
    await makeTrusted(veteran)
  })

  test('发布后能搜到，且是 Meili 服务的', async () => {
    const { id, token } = await published(veteran)
    const r = await search(`q=${token}`)
    expect(r.status).toBe(200)
    expect(r.engine).toBe('meili')
    expect(r.body.items.map((i) => i.id)).toContain(id)
  })

  test('简体查询命中繁体/日文标题（Meili 原生简繁跨匹配）', async () => {
    const { id, token } = await published(veteran, {
      titleOriginal: `東方紅魔郷 ${crypto.randomUUID().slice(0, 8)}`,
    })
    // 用「东方红魔乡」加 kind 过滤缩小范围，再断言包含
    const r = await search(`q=${encodeURIComponent('东方红魔乡')}&uploaderId=${veteran.userId}&pageSize=100`)
    expect(r.engine).toBe('meili')
    expect(r.body.items.map((i) => i.id)).toContain(id)
    void token
  })

  test('下架后搜不到', async () => {
    const { id, token } = await published(veteran)
    await app.request(
      `/api/kourindou/resources/${id}/status`,
      json(veteran, { to: 'delisted', reason: '自查后发现社团禁止转载' }),
    )
    await flushSyncs()
    const r = await search(`q=${token}`)
    expect(r.engine).toBe('meili')
    expect(r.body.items.map((i) => i.id)).not.toContain(id)
  })

  test('索引残留已下架资源的文档时，Postgres 白名单挡住它', async () => {
    const { id, token } = await published(veteran)
    await app.request(
      `/api/kourindou/resources/${id}/status`,
      json(veteran, { to: 'delisted', reason: '社团要求下架' }),
    )
    await flushSyncs()
    // 模拟同步失败：把已下架的行硬塞回索引
    const [row] = await db
      .select(SEARCH_COLUMNS)
      .from(schema.resource)
      .where(eq(schema.resource.id, id))
      .limit(1)
    if (!row) throw new Error('row missing')
    await meiliFetch(`/indexes/${SEARCH_INDEX}/documents`, {
      method: 'POST',
      body: JSON.stringify([toDoc(row, [])]),
    })
    await flushSyncs()

    const r = await search(`q=${token}`)
    expect(r.engine).toBe('meili')
    expect(r.body.items.map((i) => i.id)).not.toContain(id)
  })

  test('筛选透传到 Meili：同一标记只命中 music', async () => {
    const token = crypto.randomUUID().slice(0, 8)
    const game = await published(veteran, { titleOriginal: `東方 ${token}`, kind: 'game' })
    const music = await published(veteran, { titleOriginal: `東方 ${token}`, kind: 'music' })
    const r = await search(`q=${token}&kind=music`)
    expect(r.engine).toBe('meili')
    const ids = r.body.items.map((i) => i.id)
    expect(ids).toContain(music.id)
    expect(ids).not.toContain(game.id)
  })

  test('Meili 不可用时降级 ILIKE，搜索不停机', async () => {
    const { id, token } = await published(veteran)
    const saved = process.env.MEILI_HOST
    process.env.MEILI_HOST = 'http://127.0.0.1:1'
    try {
      const r = await search(`q=${token}`)
      expect(r.status).toBe(200)
      expect(r.engine).toBe('pg')
      expect(r.body.items.map((i) => i.id)).toContain(id)
    } finally {
      process.env.MEILI_HOST = saved
    }
  })

  test('无 q 的普通列表不带 x-search-engine 头', async () => {
    const res = await app.request('/api/kourindou/resources')
    expect(res.headers.get('x-search-engine')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/kourindou.test.ts -t '搜索查询'`
Expected: FAIL——`engine` 为 null（端点还没设头）

- [ ] **Step 3: 重写列表端点**

`apps/api/src/modules/kourindou/index.ts` import 区把 `import { syncResource } from '../../search'` 改为：

```ts
import {
  buildFilter,
  buildSort,
  searchResources,
  syncResource,
} from '../../search'
```

`GET /resources` 整个 handler 替换为：

```ts
  .get('/resources', validate('query', listResourcesQuerySchema), async (c) => {
    const q = c.req.valid('query')
    const term = q.q || undefined
    // 有 q 默认相关度，无 q 默认最新；无 q 时 relevance 等同 newest
    const sort = q.sort ?? (term ? 'relevance' : 'newest')

    const listColumns = {
      id: resource.id,
      slug: resource.slug,
      titleOriginal: resource.titleOriginal,
      titleOriginalLocale: resource.titleOriginalLocale,
      title: resource.title,
      kind: resource.kind,
      license: resource.license,
      coverUrl: resource.coverUrl,
      circleId: resource.circleId,
      circleNameRaw: resource.circleNameRaw,
      downloadCount: resource.downloadCount,
      ratingSum: resource.ratingSum,
      ratingCount: resource.ratingCount,
      createdAt: resource.createdAt,
    }

    if (term) {
      /**
       * Meili 只给 id 与顺序。回库取行必带 publicOnly：索引哪怕残留已下架
       * 资源的文档（同步失败、还没到夜间重建），也漏不出去。
       * Meili 挂了就降级到下面的 ILIKE——搜索变差，不变没。
       */
      const hit = await searchResources({
        q: term,
        filter: buildFilter(q),
        sort: buildSort(sort),
        page: q.page,
        pageSize: q.pageSize,
      }).catch((err) => {
        console.error('[search] 查询失败，降级 ILIKE', err)
        return null
      })
      if (hit) {
        c.header('x-search-engine', 'meili')
        // drizzle 对空数组的 inArray 会生成非法 SQL
        const rows = hit.ids.length
          ? await db
              .select(listColumns)
              .from(resource)
              .where(and(publicOnly, inArray(resource.id, hit.ids)))
          : []
        const byId = new Map(rows.map((r) => [r.id, r]))
        // 按 Meili 的顺序重排；回库缺的行（索引陈旧）直接丢
        const items = hit.ids.flatMap((id) => byId.get(id) ?? [])
        return c.json({ items, page: q.page, pageSize: q.pageSize, total: hit.total })
      }
      c.header('x-search-engine', 'pg')
    }

    const filters = [publicOnly]
    if (q.kind) filters.push(eq(resource.kind, q.kind))
    if (q.license) filters.push(eq(resource.license, q.license))
    if (q.circleId) filters.push(eq(resource.circleId, q.circleId))
    if (q.uploaderId) filters.push(eq(resource.uploaderId, q.uploaderId))
    if (term) {
      filters.push(
        sql`(${resource.titleOriginal} ilike ${`%${term}%`} or ${resource.title}::text ilike ${`%${term}%`})`,
      )
    }
    if (q.tag?.length) {
      filters.push(
        sql`exists (select 1 from ${resourceTag} rt where rt.resource_id = ${resource.id} and rt.tag_id in ${q.tag})`,
      )
    }

    const order =
      sort === 'downloads'
        ? desc(resource.downloadCount)
        : sort === 'rating'
          ? desc(sql`case when ${resource.ratingCount} = 0 then 0
              else ${resource.ratingSum}::float / ${resource.ratingCount} end`)
          : desc(resource.createdAt)

    const where = and(...filters)
    const [items, [count]] = await Promise.all([
      // 列表不 select description：长文走 TOAST，列表页用不上
      db
        .select(listColumns)
        .from(resource)
        .where(where)
        .orderBy(order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(resource).where(where),
    ])

    return c.json({
      items,
      page: q.page,
      pageSize: q.pageSize,
      total: count?.n ?? 0,
    })
  })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && bun test src/kourindou.test.ts`
Expected: 全部 PASS，含「搜索查询」7 个

Run: `bun run check && bun run typecheck`
Expected: 绿

- [ ] **Step 5: 手动验证一次简繁**

Run（api 需在跑：`bun run dev` 或单独 `bun run --filter @gensokyo/api dev`）：

```bash
curl -sI 'http://localhost:3001/api/kourindou/resources?q=%E7%BA%A2%E9%AD%94' | grep -i x-search-engine
```

Expected: `x-search-engine: meili`。开发库若有繁体标题的已发布资源，`curl -s …` 的 items 里能看到。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/modules/kourindou/index.ts apps/api/src/kourindou.test.ts
git commit -m "feat(search): 列表端点 q 非空时走 Meili 取 id、回 PG 取行，失败降级 ILIKE

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 前端搜索框、结果计数、空态与排序选项

**Files:**
- Create: `apps/web/app/lib/search.ts`
- Create: `apps/web/app/lib/search.test.ts`
- Modify: `apps/web/app/routes/kourindou/list.tsx`
- Modify: `apps/web/messages/zh.json` / `ja.json` / `en.json`

**Interfaces:**
- Produces: `effectiveSort(q: string | null, sort: string | null): string`；`sortOptions(q: string | null): ResourceSort[]`。
- Consumes: Task 2 的 `RESOURCE_SORT`（含 `relevance`）与 `sort_relevance` 消息。

- [ ] **Step 1: 写失败的单测**

`apps/web/app/lib/search.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { effectiveSort, sortOptions } from './search'

describe('effectiveSort', () => {
  test('显式 sort 优先', () => {
    expect(effectiveSort('紅魔', 'downloads')).toBe('downloads')
    expect(effectiveSort(null, 'rating')).toBe('rating')
  })
  test('有 q 无 sort → relevance；无 q 无 sort → __all（Select 的「全部」项）', () => {
    expect(effectiveSort('紅魔', null)).toBe('relevance')
    expect(effectiveSort(null, null)).toBe('__all')
    expect(effectiveSort('', null)).toBe('__all')
  })
})

describe('sortOptions', () => {
  test('无 q 时不显示相关度', () => {
    expect(sortOptions(null)).toEqual(['newest', 'downloads', 'rating'])
  })
  test('有 q 时相关度排第一', () => {
    expect(sortOptions('紅魔')).toEqual(['relevance', 'newest', 'downloads', 'rating'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && bun test app/lib/search.test.ts`
Expected: FAIL，`Cannot find module './search'`

- [ ] **Step 3: 写实现**

`apps/web/app/lib/search.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && bun test app/lib/search.test.ts`
Expected: PASS，4 个

- [ ] **Step 5: 三语消息**

各文件在 `sort_relevance` 之后加六键（保持 JSON 逗号正确）：

`zh.json`：
```json
  "search_placeholder": "搜索标题、社团…",
  "search_submit": "搜索",
  "search_clear": "清除",
  "search_result_count": "「{q}」共 {total} 件",
  "search_empty": "没有找到「{q}」",
  "search_empty_hint": "换个关键词，或者试试原文标题。",
```

`ja.json`：
```json
  "search_placeholder": "タイトル・サークルで検索",
  "search_submit": "検索",
  "search_clear": "クリア",
  "search_result_count": "「{q}」の結果 {total} 件",
  "search_empty": "「{q}」は見つかりませんでした",
  "search_empty_hint": "別のキーワードか、原題で試してください。",
```

`en.json`：
```json
  "search_placeholder": "Search titles, circles…",
  "search_submit": "Search",
  "search_clear": "Clear",
  "search_result_count": "{total} results for “{q}”",
  "search_empty": "Nothing found for “{q}”",
  "search_empty_hint": "Try another keyword, or the original title.",
```

- [ ] **Step 6: 改 list.tsx**

(a) import：`react-router` 那行改为

```tsx
import { Form, Link, useSearchParams, useViewTransitionState } from 'react-router'
```

加 `import { Input } from '~/components/ui/input'` 与 `import { effectiveSort, sortOptions } from '~/lib/search'`。

(b) loader 的转发键加 `'q'`：

```ts
    ['kind', 'license', 'sort', 'page', 'q']
```

(c) `Filter` 组件加可选 `value` 覆盖（排序要按有无 q 推显示值）：

```tsx
function Filter({
  param,
  label,
  options,
  value,
}: {
  param: string
  label: string
  options: { value: string; label: string }[]
  /** 不传时按 URL 里的参数；排序传 effectiveSort() 的结果 */
  value?: string
}) {
  const [params, setParams] = useSearchParams()
  const current = value ?? params.get(param) ?? '__all'
```

其余不变。

(d) 组件里 `const [params] = useSearchParams()` 之后加：

```tsx
  const q = params.get('q')
  const kind = params.get('kind')
  const license = params.get('license')
  /** 清除关键词：保住筛选，丢掉 sort 与 page */
  const clearHref = (() => {
    const next = new URLSearchParams()
    if (kind) next.set('kind', kind)
    if (license) next.set('license', license)
    const qs = next.toString()
    return qs ? `?${qs}` : '.'
  })()
```

(e) `<header>` 之后、筛选行 `<div className="mt-6 flex …">` 之前插入搜索表单。GET 表单会**替换**整个 query string，所以 kind/license 用 hidden 保住，sort/page 刻意不保（换词回到第一页与默认排序）：

```tsx
      <Form
        method="get"
        role="search"
        viewTransition
        className="mt-6 flex items-center gap-2"
      >
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          maxLength={100}
          placeholder={m.search_placeholder()}
          aria-label={m.search_placeholder()}
          className="max-w-md"
        />
        {kind && <input type="hidden" name="kind" value={kind} />}
        {license && <input type="hidden" name="license" value={license} />}
        <Button type="submit" variant="secondary">
          {m.search_submit()}
        </Button>
        {q && (
          <Button asChild variant="ghost" size="sm">
            <Link to={clearHref} viewTransition>
              {m.search_clear()}
            </Link>
          </Button>
        )}
      </Form>
```

`defaultValue={q ?? ''}` 要配 `key={q ?? ''}`——否则客户端导航到「清除」后输入框里还留着旧词（非受控输入不随 defaultValue 变化）。在 `<Input` 上加 `key={q ?? ''}`。

(f) 筛选行 `mt-6` 改 `mt-3`；排序 `Filter` 改为：

```tsx
        <Filter
          param="sort"
          label={m.filter_sort()}
          value={effectiveSort(q, params.get('sort'))}
          options={sortOptions(q).map((s) => ({
            value: s,
            label: {
              relevance: m.sort_relevance(),
              newest: m.sort_newest(),
              downloads: m.sort_downloads(),
              rating: m.sort_rating(),
            }[s],
          }))}
        />
```

(g) 计数 span：

```tsx
        {!failed && (
          <span className="ml-auto text-sm text-muted-foreground">
            {q ? m.search_result_count({ q, total }) : m.list_count({ total })}
          </span>
        )}
```

(h) 空态：

```tsx
      ) : items.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="font-heading text-lg">
            {q ? m.search_empty({ q }) : m.list_empty()}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {q ? m.search_empty_hint() : m.list_empty_hint()}
          </p>
        </div>
      ) : (
```

- [ ] **Step 7: 门禁**

Run:

```bash
bun run check-messages && bun run check && bun run typecheck && bun run --filter @gensokyo/web test
```

Expected: 全绿。`check-messages` 无缺键。

Run:

```bash
bun run build && bun run check-bundle-size && bun run check-motion-boundary && bun run check-css-layers
```

Expected: 全绿；首屏与 `kourindou/list` 路由体积变化 ≤ 1 KB（只多了一个表单与两个纯函数）。

- [ ] **Step 8: 浏览器验证（机制测试，不看动画）**

用 Browser pane 打开 dev 的 `http://localhost:3000/kourindou?q=紅魔`（web 与 api 都在跑），`read_page` 确认：

- 存在 `role=search` 的表单，输入框值为「紅魔」
- 计数文案形如「「紅魔」共 N 件」，且有「清除」链接
- 排序 Select 当前显示「相关度」
- `read_network_requests` 过滤 `/api/kourindou/resources` 看到 `q=` 已转发

再开 `?q=紅魔&kind=music` 确认 hidden 字段保住了 kind：改输入框内容回车后 URL 仍带 `kind=music`。

- [ ] **Step 9: 提交**

```bash
git add apps/web/app/lib/search.ts apps/web/app/lib/search.test.ts apps/web/app/routes/kourindou/list.tsx apps/web/messages
git commit -m "feat(web): 香霖堂搜索框——GET 表单零 JS，结果计数、清除、空态与相关度排序

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 约定入档、全量门禁、上线备忘

**Files:**
- Modify: `CLAUDE.md:22`（香霖堂约定末尾）
- Modify: `/Users/i/.claude/projects/-Users-i-Code-th/memory/prod-deploy-procedure.md`（追加上线步骤）

- [ ] **Step 1: CLAUDE.md 加两条约定**

在「前端错误按 `error.code` 查 Paraglide 文案」那条之后加：

```markdown
  - **搜索（2026-09-11）**：Meili 的一切只在 `apps/api/src/search.ts`；**可见性只在 Postgres**——Meili 只给 id 与顺序，回库取行必带 `publicOnly`。资源的每个写点在事务 resolve 之后 `void syncResource(id)`，现有九处：PATCH / submit / status / license / download（`kourindou/index.ts`）、评分（`interactions.ts`）、审核（`moderation.ts`）、回收站删除与恢复（`admin.ts`）；`POST /resources` 不调（新行恒为 draft）。**新增任何 resource 写点必须回答「同步了吗」**——没有门禁能抓，漏掉的表现是「最多陈旧到夜间 `reindex`」。Meili 挂了列表端点降级 ILIKE，响应头 `x-search-engine: meili|pg` 是运维可观测点
```

- [ ] **Step 2: 记忆里补上线步骤**

`prod-deploy-procedure.md` 末尾追加：

```markdown
**搜索上线（2026-09-11 起）**：部署后必须跑一次全量灌入，并给生产机加每夜 cron，否则 Meili 里是空索引、所有搜索都在降级：
- 首次：`docker compose --env-file deploy/.env -f deploy/compose.yml run --rm migrate bun run apps/api/scripts/reindex.ts`
- cron（`crontab -e`）：`10 4 * * * cd ~/th && docker compose --env-file deploy/.env -f deploy/compose.yml run --rm migrate bun run apps/api/scripts/reindex.ts >> ~/th/reindex.log 2>&1`
- 验证：`curl -sI 'https://th.saop.cc/api/kourindou/resources?q=%E7%B4%85%E9%AD%94' | grep -i x-search-engine` 应为 `meili`
```

- [ ] **Step 3: 全量门禁**

Run:

```bash
bun run check && bun run typecheck && bun run check-messages && bun run build && bun run check-css-layers && bun run check-bundle-size && bun run check-motion-boundary && bun run --filter @gensokyo/web test && bun run --filter @gensokyo/shared test && bun run --filter @gensokyo/api test
```

Expected: 全绿。记录 `check-bundle-size` 打印的首屏与 `kourindou/list` 数字，写进提交信息。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 记下搜索约定——Meili 只在 search.ts、可见性只在 PG、九处同步点

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- 二「不做什么」：无新依赖（Global Constraints）、不进 site-header（Task 6 只改列表页）、响应形状不变（Task 5）✓
- 四.1 `search.ts` 十个导出：Task 1 + Task 3 ✓；惰性读 env ✓；`env.ts` ✓；`index.ts` 启动 `ensureIndex` ✓
- 四.2 端点：Meili 路径、回库白名单、按 ids 重排、空数组不发 inArray、`x-search-engine`、降级 ✓（Task 5）
- 四.3 shared：`relevance`、`sort` 可选、`q` trim ✓（Task 2）
- 四.4 十处写点表：九处调 + 一处不调 ✓（Task 4）；写进 CLAUDE.md ✓（Task 7）
- 四.5 reindex 改为 import + 分批 ✓（Task 3）
- 五 web：转发 `q`、GET 表单、hidden 保筛选、计数与清除、空态、相关度选项、`effectiveSort` 单测、三语键 ✓（Task 6）
- 六 错误处理：超时/5xx 降级 ✓；引号转义 ✓（Task 1 测试）；`q` 超长走现有 400（不变）✓
- 七 测试：纯函数 ✓、集成五条（发布可搜 / 下架消失 / 陈旧不泄漏 / 降级 / 筛选透传）✓ + 简繁一条 + 无 q 无头一条；web 单测 ✓
- 八 上线：记忆追加 ✓（Task 7）；生产 cron 与首次灌入是**上线时的人工步骤**，不在本计划的代码范围内

**Type consistency**
- `syncResource(id: string): Promise<void>` 在 Task 3 定义、Task 4 调用 ✓
- `searchResources` 参数 `{ q, filter?, sort?, page, pageSize }` 与 Task 5 调用一致 ✓
- `buildFilter` 收 `Partial<Pick<ListResourcesQuery, …>>`，Task 5 直接传整个 `q`（多余字段被结构类型忽略）✓
- `SEARCH_COLUMNS` 含 `status` / `deletedAt`，`toDoc` 剥掉它们 ✓；Task 5 的陈旧测试用 `toDoc(row, [])` ✓
- `effectiveSort` / `sortOptions` 签名在 Task 6 内部一致 ✓
