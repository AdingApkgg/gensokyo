# 香霖堂搜索：Meilisearch 接管查询

**一句话**：把已经存在但没人用的 `q` 参数真正接上——前端补搜索框，api 在 `q` 非空时改走 Meilisearch 取 id、回 Postgres 取行，写路径每次改动后同步一份文档，夜间全量重建兜底。只做香霖堂，不做神社与全站。

**上游决定**（2026-09-11 与站长确认）：方案 B。A（只接线 ILIKE）是它的子集，C（全站搜索页）推迟。

---

## 一、实测事实

本节数字来自 2026-09-11 对生产库的只读查询与对仓库的检索，后续争论以此为准。

| 事实 | 数值 |
|---|---|
| 已发布资源 | 6,696（game 6,385 / music 96 / patch 89 / doujinshi 68 / tool 58） |
| 其中 `title` 译名非空 | **0**；`description` 非空也是 0 |
| `title_original_locale` 分布 | zh 3,492 / ja 2,232 / en 972 |
| 有 `circle_name_raw` 的资源 | 79 |
| `resource_tag` 行 | 124；`tag` 31 |
| 版块主题 / 楼层 / 真实用户 | 7 / 7 / 2 |
| 生产 Meili 的 `resources` 索引 | **不存在**（`reindex` 从未在生产跑过）；生产机无 crontab |
| 仓库里读写 Meili 的 api 源码 | **零处**；只有 `apps/api/scripts/reindex.ts` |
| 现有 `q` 实现 | `apps/api/src/modules/kourindou/index.ts:39`，对 `title_original` 与 `title::text` 做 `ILIKE '%q%'` |
| 前端 | `/kourindou` 无输入框，loader 不转发 `q` |
| Meili 版本 | 开发 1.53.1，生产 compose 钉 `v1.53`；简繁跨匹配原生（求闻史纪调研实测：查「东方」命中「東方紅魔郷」） |

结论：可搜文本几乎只有 `title_original` 一列，且三种文字混杂（「[紅緑亭 Kouryokutei] 東方ディアブロ … 东方大菠萝寻宝者G 汉化版」）。搜索的全部价值在香霖堂；神社没有供给。

---

## 二、先说不做什么

- **不做神社与全站搜索**。7 条主题没有供给。更重要的是：楼层索引会成为 `visibleTopicWhere()` 之外的第二份可见性来源，CLAUDE.md 明令只能有一份。神社将来要搜，在同一份 WHERE 里用 Postgres 全文检索。
- **不做拼音**。Meili 只做词首前缀匹配，不做中缀：`hongmo` 匹配不到 `dongfanghongmoxiang`。对一半标题是日文或英文的库，收益不够引 `pinyin-pro`。真有人用拼音搜再加，文档字段位置已预留（`toDoc()` 一处）。
- **不建 `search_outbox` 与 worker**。M3 已定：提交后 try/catch 推 Meili，夜间全量重建自愈。索引写失败的后果是「最多陈旧到下一次重建」，而可见性由 Postgres 兜底（第四节），陈旧不会泄漏。
- **不引 `meilisearch-js`**。四个 HTTP 调用（PUT index / PATCH settings / POST documents / DELETE document / POST search）不值得一个依赖；`reindex.ts` 已经用裸 fetch。
- **不把搜索框放进 site-header**。全站可搜内容 100% 在 `/kourindou`，站头入口是全站搜索（方案 C）的事。
- **不加任何前端库**。搜索框是 GET 表单，SSR 直出，零新增 JS；`check-bundle-size` 不受影响。
- **不改 `q` 的响应形状**。`GET /api/kourindou/resources` 仍返回 `{ items, page, pageSize, total }`，前端列表组件不变。

---

## 三、架构

```
浏览器 ──GET /kourindou?q=红魔&kind=game──▶ web loader ──▶ GET /api/kourindou/resources?q=…
                                                                │
                                              q 非空 ┌──────────┴──────────┐ q 为空
                                                     ▼                     ▼
                                          POST /indexes/resources/search   现有 PG 路径
                                          (filter / sort / page)           (ILIKE 保留为降级)
                                                     │ ids + totalHits
                                                     ▼
                                          SELECT … FROM resource
                                          WHERE id IN (ids) AND status='published' AND deleted_at IS NULL
                                          按 ids 顺序重排 ──▶ { items, total }

写路径：每个 resource 写点 ──事务提交后──▶ syncResource(id) ──▶ 已发布且未软删 ? upsert : delete
夜间：cron ──▶ reindex.ts（同一份 toDoc / settings）──▶ 清空重灌
```

三条不变式：

1. **可见性只在 Postgres**。Meili 只给 id 与顺序；回库取行必带 `status = 'published' AND deleted_at IS NULL` 白名单。索引哪怕残留已下架资源的文档，也漏不出去。
2. **文档映射与索引设置只有一份**：`apps/api/src/search.ts`。`reindex.ts` import 它，不再自己维护映射。
3. **Meili 不可用时搜索降级不停机**：超时或非 2xx → 记日志 → 走现有 ILIKE 路径。

---

## 四、api

### 4.1 `apps/api/src/search.ts`（新）

| 导出 | 作用 |
|---|---|
| `SEARCH_INDEX = 'resources'` | 索引名 |
| `meiliFetch(path, init)` | 底层客户端：拼 host、带 `authorization`、非 2xx 抛错。其余导出与 `reindex.ts` 都只经它访问 Meili |
| `SEARCH_SETTINGS` | `searchableAttributes: ['titles','circleNameRaw','descriptions','slug']`；`filterableAttributes: ['kind','license','tagIds','circleId','uploaderId']`；`sortableAttributes: ['createdAt','downloadCount','rating']`；`pagination: { maxTotalHits: 10000 }`（默认 1,000，索引已有 6.7k 文档，翻页到底会被截断） |
| `toDoc(row, tagIds)` | 纯函数。`titles = [titleOriginal, ...values(title)]`、`descriptions = values(description)`、`rating = ratingCount ? ratingSum/ratingCount : 0`、`createdAt` 毫秒数。从 `reindex.ts` 搬来 |
| `buildFilter(query)` | 纯函数。`kind = "game" AND license = "allowed" AND tagIds IN ["th06","th07"] AND circleId = "…" AND uploaderId = "…"`。字符串值一律双引号并转义 `"` 与 `\`——`userIdSchema` 是任意 64 字符的字符串 |
| `buildSort(sort)` | 纯函数。`newest → ['createdAt:desc']`、`downloads → ['downloadCount:desc']`、`rating → ['rating:desc']`、`relevance → undefined` |
| `searchResources({ q, filter, sort, page, pageSize })` | `POST /indexes/resources/search`，`AbortSignal.timeout(1500)`；返回 `{ ids: string[], total: number }`；失败抛错，由调用方决定降级 |
| `syncResource(id)` | 重读该行与标签；已发布且未软删 → `POST /documents`（upsert），否则 → `DELETE /documents/:id`。**永不抛错**：catch 后 `console.error('[search] 同步失败', { id, err })`。返回 `Promise<void>` |
| `ensureIndex()` | `PUT /indexes`（已存在则忽略）+ `PATCH /settings`。幂等 |
| `awaitIndexing()` | 轮询 `/tasks?statuses=enqueued,processing` 直到为空；超过 10 秒抛错。Meili 写入是异步任务，`reindex.ts` 收尾与集成测试都需要它 |

配置从 `process.env.MEILI_HOST` / `MEILI_MASTER_KEY` **按调用惰性读取**（不在模块顶层），原因有二：`app.ts` 被测试 import，不该因为缺配置炸；测试要能临时改 `MEILI_HOST` 验证降级。缺省 `http://localhost:57700` / 空 key，与 `reindex.ts` 现状一致。

`env.ts` 加 `MEILI_HOST: z.url()` 与 `MEILI_MASTER_KEY: z.string().min(1)`：生产进程缺配置启动即炸（compose 已在传两者；`.env.example` 已有）。

`index.ts` 启动时 `void ensureIndex().catch(log)`：新部署的生产 Meili 从零起也能拿到带 filterable 设置的空索引，否则第一次带筛选的搜索会因「属性不可过滤」报错而全部降级。

### 4.2 `GET /resources` 的改动

```ts
const term = q.q?.trim()
const sort = q.sort ?? (term ? 'relevance' : 'newest')
if (term) {
  const hit = await searchResources({ q: term, filter: buildFilter(q), sort: buildSort(sort), page, pageSize })
    .catch((err) => { console.error('[search] 查询失败，降级 ILIKE', err); return null })
  if (hit) {
    const rows = await db.select(列表列).from(resource)
      .where(and(publicOnly, inArray(resource.id, hit.ids)))
    const items = 按 hit.ids 顺序重排(rows)      // 回库缺的行（索引陈旧）直接丢
    c.header('x-search-engine', 'meili')
    return c.json({ items, page, pageSize, total: hit.total })
  }
}
c.header('x-search-engine', 'pg')   // 仅 term 非空时设；无 term 的普通列表不设
…现有路径不变；relevance 在此路径等同 newest…
```

- `x-search-engine` 响应头是**给测试与运维的可观测点**：集成测试用它断言「这次确实是 Meili 服务的」；生产 `curl -I` 一眼看出是否在降级。不进响应体、不进类型。
- `hit.ids` 为空数组时不发 `inArray`（drizzle 对空数组会生成非法 SQL），直接返回空。
- `total` 取 Meili 的 `totalHits`。若回库丢了行，这一页条数会少于 `pageSize` 而 `total` 不变——可接受，夜间重建后消失。

### 4.3 `packages/shared` 的改动

- `RESOURCE_SORT` 加 `'relevance'`：`['relevance', 'newest', 'downloads', 'rating']`。
- `listResourcesQuerySchema.sort` 从 `.default('newest')` 改为 `.optional()`；默认值在 handler 里按有无 `term` 决定。**不能在 zod 里默认**——默认后 handler 分不清「用户选了最新」与「没选」。
- `q` 从 `z.string().max(100)` 改为 `z.string().trim().max(100)`；空串等同不传。

### 4.4 同步调用点（十处，逐一列出，一处不漏）

同步一律在 `db.transaction()` **resolve 之后**调用（读的是已提交状态），写成 `void syncResource(id)`，不 await、不影响响应。

| 文件 | 位置 | 动作 | 同步 |
|---|---|---|---|
| `kourindou/index.ts` | `POST /resources` | 新建，status 恒为 `draft` | **不调**：新行永远不可见，删一个不存在的文档是空转 |
| `kourindou/index.ts` | `PATCH /resources/:id` | 改标题/描述/标签等 | 调 |
| `kourindou/index.ts` | `POST /resources/:id/submit` | draft → pending/published | 调 |
| `kourindou/index.ts` | `POST /resources/:id/status` | 任意跃迁（含下架） | 调 |
| `kourindou/index.ts` | `PATCH /resources/:id/license` | 改 license | 调（license 是 filterable） |
| `kourindou/index.ts` | `GET …/files/:fileId/download` | `downloadCount + 1` | 调（`downloads` 排序依赖它） |
| `interactions.ts` | 评分 | `ratingSum / ratingCount` | 调（`rating` 排序依赖它） |
| `moderation.ts` | 审核通过/驳回 | status 跃迁 | 调 |
| `admin.ts` | 回收站删除（soft / purge） | `deletedAt` 或硬删 | 调（两种模式都落到 delete 文档） |
| `admin.ts` | 回收站恢复 | `deletedAt = null` | 调 |

版本/文件（`resource_version` / `resource_file`）的写点不进文档，不同步。

**门禁**：没有静态门禁能抓「漏了一处同步」，漏掉的表现是「最多陈旧到夜间重建」。所以这张表要写进 CLAUDE.md 的香霖堂约定：新增 resource 写点必须回答「同步了吗」。

### 4.5 `apps/api/scripts/reindex.ts`

改为 `import { SEARCH_INDEX, ensureIndex, toDoc, awaitIndexing, meiliFetch } from '../src/search'`。流程不变：查已发布行与标签 → `ensureIndex()` → 清空 → 按 1,000 条分批 POST → `awaitIndexing()` → 打印条数。分批是因为 6.7k 文档一次 POST 已经是 MB 级，将来更多时不该靠 Meili 的 95 MB 上限。

---

## 五、web

### 5.1 `/kourindou` 列表页

- loader 转发 `q`（`['kind','license','sort','page','q']`）。
- 页头筛选行之前加搜索表单：

  ```tsx
  <Form method="get" viewTransition role="search" className="…">
    <Input name="q" type="search" defaultValue={q} placeholder={m.search_placeholder()} aria-label={m.search_placeholder()} />
    {kind && <input type="hidden" name="kind" value={kind} />}
    {license && <input type="hidden" name="license" value={license} />}
    <Button type="submit">{m.search_submit()}</Button>
  </Form>
  ```

  `Form` 来自 react-router，GET 表单无 JS 也能用；`viewTransition` 与全站一致。**不带 `sort` 与 `page`**：换关键词后回到第一页与默认排序（有 `q` 时默认相关度）。
- 有 `q` 时，标题下方一行「「{q}」共 {total} 件 · 清除」（`search_result_count` + `search_clear`，清除是去掉 `q` 的 `<Link viewTransition>`）；无 `q` 时维持现有 `list_count`。
- 空结果：有 `q` 时文案换成 `search_empty` / `search_empty_hint`（「没有找到「{q}」」/「换个关键词，或者试试原文标题」），不再显示「还没有资源」。
- 排序 Select：有 `q` 时选项前加「相关度」（`sort_relevance`），且无 `sort` 参数时显示值为 `relevance` 而不是 `__all`；无 `q` 时不显示相关度选项。这个「显示值」推导抽成纯函数 `effectiveSort(params)` 放 `app/lib/search.ts`，配单测。
- 首帧即终态：表单与结果都进 SSR HTML，无 `initial` 隐藏态（红线 ①）。

### 5.2 i18n（zh / ja / en 三份同时加，跑 `check-messages`）

`search_placeholder` / `search_submit` / `search_clear` / `search_result_count` / `search_empty` / `search_empty_hint` / `sort_relevance`。

---

## 六、错误处理

| 情形 | 行为 |
|---|---|
| Meili 超时 / 5xx / 连接拒绝 | 降级 ILIKE，`x-search-engine: pg`，`console.error` 一条 |
| Meili 返回 `invalid_search_filter`（设置未生效） | 同上降级；`ensureIndex()` 在启动时已修，重启即愈 |
| 索引残留已下架文档 | 回库白名单挡住，不返回 |
| 同步写失败 | 记日志，等夜间重建 |
| `q` 超 100 字 | 现有 zod 400 |
| 用户 id 含引号 | `buildFilter` 转义，不注入 |

---

## 七、测试

**纯函数（`apps/api/src/search.test.ts`，不需要服务）**：`toDoc` 的三语摊平与 rating 计算；`buildFilter` 的组合、空值省略、引号转义；`buildSort` 四档。

**集成（`apps/api/src/kourindou.test.ts` 追加，打开发 Meili；`beforeAll` 调 `ensureIndex()`，每次写后 `awaitIndexing()`）**：

1. 发布后可搜：trusted 作者创建 + submit → `?q=<唯一标记>` 命中，`x-search-engine: meili`。
2. 下架后消失：`POST /status` 到 `delisted` → 同一查询零命中。
3. 陈旧索引不泄漏：直接往 Meili 写一份已 delisted 资源的文档 → 搜索仍零命中，且头仍是 `meili`（证明是白名单挡的，不是降级）。
4. 降级：把 `process.env.MEILI_HOST` 指到 `http://127.0.0.1:1` → 同一查询走 ILIKE 命中，`x-search-engine: pg`；恢复 env。
5. 筛选透传：`?q=…&kind=music` 只命中 music。

**web（`bun test`）**：`effectiveSort` 的四种输入。

**门禁**：`bun run check && typecheck && check-messages && build && check-bundle-size && check-motion-boundary`，加 web 与 shared 的 `test`。api 测试本地跑（CI 刻意不跑它们）。

---

## 八、上线与运维

1. 部署（rsync → build → migrate → up）。api 启动即 `ensureIndex()`。
2. **首次全量灌入**：`docker compose --env-file deploy/.env -f deploy/compose.yml run --rm migrate bun run apps/api/scripts/reindex.ts`（migrate 镜像带全部 scripts，与 seed 同一条路）。
3. **夜间重建**：生产机 `crontab` 加一行，每日 04:10 跑上一条，输出追加到 `~/th/reindex.log`。这是自愈机制，不是可选项。
4. 验证：`curl -sI 'https://th.saop.cc/api/kourindou/resources?q=紅魔'` 看 `x-search-engine: meili`；再查一个简体词命中繁体标题。

`prod-deploy-procedure` 记忆同步补第 2、3 条。

---

## 九、推迟项与复活条件

| 项 | 复活条件 |
|---|---|
| 拼音 | 有用户反馈用拼音搜不到；届时在 `toDoc()` 加 `pinyinInitials` 一列即可 |
| 神社搜索 | 版块主题上三位数；实现走 Postgres 全文检索 + 同一份 `visibleTopicWhere()` |
| 站头全站搜索入口 | 神社搜索存在之后 |
| 搜索词联想 / 热词 | 有搜索日志之后 |
