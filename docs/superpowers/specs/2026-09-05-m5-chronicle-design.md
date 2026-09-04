# M5 求闻史纪（TouhouDB 中文层）设计

**一句话**：在 TouhouDB 的公开编目之上做一层中文检索与译名层，让中文用户用中文和拼音找到社团、专辑、曲目与原曲，并把结果接回香霖堂的投稿与资源页。

**上游产品文档**：`docs/product/2026-08-30-platform-direction.md` 第 11、13、35、63 行。

---

## 一、先说不做什么

这一节定义模块边界，排在最前是因为「求闻史纪」这个名字会让人默认它是百科。

- **不做散文百科条目**（角色介绍、世界观设定、作品年表）。产品文档已拍板「不正面做百科」——THBWiki 有十几年积累的中文散文，正面竞争会输；且散文靠志愿者写，在一个刚上线、发帖者接近于零的站上必然停在残页状态，二十个残页比没有更伤。
- **不做用户直接编辑的 wiki**：没有修订表、没有 diff 视图、没有回退流程。
- **不引入 Wiki.js 或任何独立 wiki 应用**（评估见附录 A）。
- **不从零建库**：编目事实来自 TouhouDB，我们只加中文层。

**散文需求由两条满足，都不需要 wiki 系统**：

1. 每个条目页链到 THBWiki 的对应页（产品文档里的「与 THBWiki 互引」）。
2. 每个实体一个 staff 可写的中文说明字段 `noteZh`，一段话，跟译名并列存在同一行上。用于「这个社团 2015 年后转向东方以外题材」这类必须我们自己说的话。

---

## 二、已批准的决策

| 决策点 | 选择 | 说明 |
|---|---|---|
| 定位 | **两者并重** | 既服务香霖堂的元数据补全，也提供可浏览可深链的独立条目页 |
| 实体范围 | **社团 + 专辑 + 曲目 + 原曲** | 全量，约 233,500 条 |
| 译名来源 | **staff 导入 + 用户提议进审核队列** | 不建修订系统，复用 M3/M4 的治理原语 |
| 条目形态 | **结构化条目页，不写散文** | 见第一节 |

---

## 三、实测事实

**这一节是后续所有取舍的依据。推翻其中任何一条之前请重测，不要凭印象改设计。** 全部数据实测于 2026-09-04 至 09-05。

| 事实 | 数值 / 结论 | 对设计的影响 |
|---|---|---|
| 中文名覆盖率 | 曲目 ≤2%、社团 ≤6%（判据把日文汉字误计在内，真实值更低） | 译名缺口成立，这是模块存在的理由 |
| 中文检索 | 中文别名存在时**搜得到**（「平安时代的外星人」命中） | 我们录入的译名一旦入库即可检索，不需要额外映射机制 |
| 语料规模 | 社团 20,779 / 专辑 24,702 / 曲目 188,030 / 标签 1,667 | 全量镜像可行 |
| 分页上限 | `maxResults` 硬顶 100 | 全量 = 2,337 次列表请求 |
| 关系数据 | 列表端点加 `fields=Tracks,Artists,MainPicture` **批量返回**曲目与社团 | 不需要逐条详情请求，省掉约 24,700 次调用 |
| 原曲图 | 曲目列表自带 `originalVersionId`；`/songs/{id}/derived` 可反查编曲 | 原曲页可从列表同步的数据直接构建 |
| 增量同步 | `/activityEntries` 可用，支持 `before` 游标，返回 `{editEvent, entry:{entryType, id}}`；每条实体带 `version` | 增量同步有抓手 |
| 简繁匹配 | Meilisearch v1.53 **原生跨简繁**（查「东方」命中「東方紅魔郷」，查「紅魔」命中「东方红魔乡」） | **不需要简繁转换层** |
| 拼音 | 零命中（查 `dongfang` 无结果） | 需在索引时自行生成 |
| 速率限制 | 密集请求会返回 **403** | 同步必须限速、退避、可续跑 |

---

## 四、数据模型

### 4.1 镜像层（可随时整表重建）

以 TouhouDB 的 `id` 为主键，保留 `version` 与 `syncedAt` 用于变更检测与追溯。

- `tdb_artist` — 社团与个人。`names`（jsonb 数组，含各语言别名）、`artistType`、`pictureMime`、`status`
- `tdb_album` — `names`、`discType`、`releaseDate`、`catalogNumber`、`artistString`、`ratingAverage`、`coverUrl`
- `tdb_song` — `names`、`songType`、`originalVersionId`（自引用，指向原曲）、`lengthSeconds`、`publishDate`、`artistString`
- `tdb_album_artist` — 专辑与社团的多对多，带 `categories`（Circle / Producer 等）
- `tdb_album_track` — 专辑与曲目的多对多，带 `discNumber`、`trackNumber`

「原曲」不是独立表。它是 `tdb_song` 里 `songType = 'Original'` 的行，编曲通过 `originalVersionId` 指回来。

### 4.2 中文层（不可再生，**绝不与镜像同表**）

```
chronicle_entry
  entityKind   'artist' | 'album' | 'song'    ┐ 复合主键
  tdbId        integer                        ┘
  nameZh          varchar(200)   中文译名
  pinyin          text           全拼，索引时生成
  pinyinInitials  text           首字母，索引时生成
  noteZh          text           staff 可写的中文说明，一段话
  source          'staff' | 'proposal' | 'upstream'
  updatedBy       text → user.id (set null)
  updatedAt       timestamptz
```

**为什么必须分表**：镜像表要被同步作业整表覆盖。若把 `nameZh` 挂在 `tdb_artist` 上，一次重同步就洗掉全部 staff 与社区贡献，且没有任何恢复路径。镜像可再生，中文层不可再生，两者的生命周期不同，就不能同表。

上游条目被删或改 id 时，`chronicle_entry` 的孤儿行**保留并标记**，不级联删除——译名是我们的资产。

### 4.3 提议队列

```
chronicle_proposal
  id, entityKind, tdbId, nameZh, noteZh, reason,
  proposerId → user.id, status 'open'|'accepted'|'rejected',
  reviewedBy, reviewedAt, createdAt
```

不复用 `report` 表：举报是「这东西有问题」，提议是「这东西该叫什么」，两者的字段、队列语义与处置动作都不同。审批通过时写 `chronicle_entry` 并记 `moderationLog`，与 M3/M4 的留痕规矩一致。后台加一个标签页，待办计数走查询（沿用 M4 的结论：staff 待办不发通知）。

### 4.4 同步状态

```
chronicle_sync_state
  entityKind        主键
  cursor            integer     全量分页进度（start 偏移）
  lastFullSyncAt    timestamptz
  lastActivityDate  timestamptz 增量游标
  updatedAt
```

---

## 五、同步设计

**全量**：按实体类型分页拉取，`maxResults=100`，专辑与曲目带 `fields`。限速约 1 请求 / 2 秒，遇 429 或 403 指数退避。每页写回 `cursor`，**中断后从断点续跑**（2,337 次请求中途一定会断，403 已经实测过）。

**增量**：`/activityEntries` 按 `before` 游标回溯到 `lastActivityDate`，取出 `entryType` 与 `id`，逐条重新拉取该实体。`editEvent` 为删除时标记镜像行而非物理删除。

**失败策略**：单条失败记录并继续，不中止整轮。全轮结束打印失败清单。

**执行方式**：`packages/db/scripts/sync-touhoudb.ts`，本地 `bun run sync:tdb`，生产用一次性容器 `docker compose run --rm migrate bun run packages/db/scripts/sync-touhoudb.ts`（与 `seed-shrine.ts` 同一条路子）。

---

## 六、搜索

Meilisearch 新增索引 `chronicle`，每个实体一份文档。

- **searchable**：`nameZh`、`pinyin`、`pinyinInitials`、`namesAll`（原名与各语言别名摊平）、`artistString`
- **filterable**：`entityKind`、`songType`、`discType`、`hasZh`（是否已有译名，用于「待补译名」视图）
- **sortable**：`releaseDate`、`ratingAverage`

简繁交叉匹配由 Meilisearch 提供，不写转换层。拼音在索引时用纯 JS 库生成全拼与首字母两个字段——不引入需要原生编译的依赖。

---

## 七、页面与 URL

**`tdbId` 是稳定键，译名会变，所以 URL 用 id 不用 slug。** 这条直接沿用 M4 handle 的教训：进了 URL 的东西不可逆。

| 路径 | 内容 |
|---|---|
| `/chronicle` | 搜索与浏览入口 |
| `/chronicle/c/:id` | 社团页：中文名、原名、说明、专辑列表、香霖堂中该社团的资源、认领入口、THBWiki 链接 |
| `/chronicle/a/:id` | 专辑页：中文名、原名、封面、社团、发行日、曲目列表、香霖堂中的对应资源、THBWiki 链接 |
| `/chronicle/s/:id` | 曲目页。`songType = 'Original'` 时渲染**原曲模板**（列出所有编曲它的曲目），否则渲染编曲模板（指回原曲、收录专辑） |

原曲不单开 URL 空间。同一实体两个规范地址是 M4 已经修过的问题（资源主题 301 到 `/kourindou/:slug`），不再犯。

**原曲页是这个模块最立得住的一页**：「恋色マスタースパーク 有哪些编曲」这个查询 THBWiki 做不好，TouhouDB 做得到但中文用户搜不到。

---

## 八、与香霖堂的接口

- `circle` 表加可空 `tdbArtistId`，指向 `tdb_artist`。
- 投稿表单可用中文或拼音搜社团并绑定，绑定后自动带出原名、头像、官网。
- 资源详情页增加「TouhouDB 编目」区块，链到对应的 chronicle 条目页。

`circle` 已有 `nameOriginal`、三语 `name` 与认领流程，这一半地基是现成的。

---

## 九、许可与署名

**这是实现的阻塞项，不是设计的阻塞项。** 站长确认前不执行任何镜像。

- 实现前必须书面确认 TouhouDB / 上游 VocaDB 的数据复用条款。其 Help 页面为客户端渲染，无法抓取内联许可文本，不能凭记忆断言。
- **无论结论如何都要做的**：每个条目页显示数据来源，并回链上游原页（`https://touhoudb.com/Ar/{id}`、`/Al/{id}`、`/S/{id}`）；镜像行保留 `tdbId` 与 `version` 以便追溯。
- **若条款不允许镜像**：退路是只保留 `chronicle_entry`（中文层）与代理详情，条目页降级为「中文名 + 上游链接」，放弃浏览、分面与离线可用。这条退路会实质改变模块价值，届时需重新决策而非默认执行。

---

## 十、分期

**这是排期，不是缩范围。** 最终交付仍是四类实体全量。

- **阶段一**：社团 + 专辑（45,481 条，456 次请求）。搜索、中文层、提议队列、后台审批、香霖堂对接全部跑通并上线。
- **阶段二**：曲目 + 原曲（188,030 条，1,881 次请求）。原曲页与编曲反查。

阶段一上线时同步作业小一个数量级，出问题好收拾；阶段二的风险集中在索引体积与同步时长，届时已有阶段一的运行数据做判断。

---

## 十一、推迟项

| 推迟 | 触发条件 |
|---|---|
| 标签（tags）镜像与分面 | 浏览页出现「按标签筛选」的实际需求 |
| 展会（ReleaseEvent）实体化 | 香霖堂的展会标签不够用时 |
| 每首曲目的详细艺术家署名 | `artistString` 不足以支撑显示时 |
| 中文层的编辑历史与回退 | 第一次出现译名被恶意改写 |
| 用户直接编辑（免审） | 提议队列积压到 staff 处理不过来 |
| 日文 / 英文界面的译名层 | 中文层稳定之后 |

---

## 十二、风险

1. **许可未确认**（阻塞实现）。见第九节。
2. **上游限流**。403 已实测。靠限速、指数退避、可续跑缓解；同步作业须能安全重跑。
3. **188,030 条曲目的索引体积与 Meilisearch 内存占用**。阶段二前用阶段一的实际数据外推。
4. **上游改名或删条目导致中文层挂空**。孤儿行保留并标记，不静默丢弃。
5. **译名质量**。staff 导入的批量译名若来源不可靠会污染检索。`source` 字段记录来源，可按来源批量回滚。

---

## 附录 A：为什么不用 Wiki.js

评估于 2026-09-04。结论是不用，**主要理由不是技术适配，是形状不匹配**。

- Wiki.js 存的是页面树里的 Markdown 文档，没有「实体 + 上游 id + 同步 + 中文名叠加」的概念。「按社团浏览专辑」「投稿时自动补全元数据」「原曲的编曲列表」在它的模型里都表达不出来，它的检索也不做拼音。
- 它擅长的散文百科，恰好是产品文档已经决定不做的那件事。
- 技术上它是独立应用不是库：GraphQL 对我们的 hono RPC 类型主轴、Vuetify 对 shadcn radix-nova、自带用户表对 better-auth。实测本仓库的 better-auth 1.7.2 只导出 `generic-oauth`、`jwt`、`oauth-proxy`，**没有 OIDC provider**，它做不了身份提供方，SSO 需要额外工作，且角色、handle、信任等级、违规计数这些概念 Wiki.js 一个都没有。
- 其 3.0 重写至今仍是预发布（2026-09-02 的 `3.0.0-beta.537`），稳定线停在 v2.5.314，栈为 Vue 2 + Express 4 + Apollo Server 2（早已 EOL）+ 155 个依赖。

若日后确实需要散文条目，代价更低的路径是给 M4 已交付的 Markdown 管线加一张修订表，白拿认证、i18n、主题与治理，而不是接入外部应用。
