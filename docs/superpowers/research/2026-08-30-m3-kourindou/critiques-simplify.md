# M3 香霖堂方案「过度设计」审查

审查基线（已核对仓库）：现有业务代码为 `apps/api/src/modules/kourindou.ts`（1 条返回空数组的路由）、`packages/shared/src/pagination.ts`、`packages/db/src/schema/{auth,kourindou,index}.ts`。legacy `thdl` 用 **9 张业务表**跑了一个真实站点；新方案 schema 已写 **24 张**，api 设计另引入 `user_profile` / `search_outbox` / `storage_gc_queue` / `moderation_log` / `license_change_log` → 实际 **~28 张**，**58 条路由 / 15 个子路由器 / ~40 个新文件**。用户数为 0。

判据统一为三问：**删了会不会 (a) 挡住 M3 上线、(b) 造成真实用户数据的迁移、(c) 留下法律/安全洞？** 三个都否 → 删。

> 有一条贯穿全文的方法论纠正：方案里大量论证形如「表结构 M3 必须建好，否则要迁移」。**库里没有数据时这个论证不成立**——`rm -rf drizzle/* && generate && migrate` 是零成本的。真正不可逆的只有三样：**已上传到 B2 的对象布局（双桶）**、**已对外发出的 URL/slug**、**法律留痕**。除此之外的「预留」都是伪成本，应当按 YAGNI 处理。

---

## 一、可删项（表 / 字段 / 端点）

### D1. `resource_translation` 侧表 → 合并为 `resource.description jsonb`

**删了失去什么**：长文按语种独立贡献、独立审核、独立回滚，`source: original|uploader|community|machine` 与贡献者归属。

**为什么现在不需要**：这是一个**社区翻译协作子系统**，它需要的是「有一群人愿意翻译别人的投稿」。M3 的用户数是 0，投稿者是你自己。更直接的证据是方案**自相矛盾**：拆解表明确把「多语字段的 ja/en 编辑 UI」推到 M3.5，上传向导第②步「先只填 zh + titleOriginal」——**你建了一整套 per-locale 贡献与审核的存储层，却不打算给它任何写入口**。

方案给侧表的两条理由都不成立：①「主表行膨胀，列表查询把长文一起拖出来」——Postgres 的 TOAST 本来就把大 jsonb 移出主行，且 drizzle 支持列选择，列表查询根本不 select description；②「无法做 per-locale 权限」——M3 没有 per-locale 权限需求。

**替代**：`description jsonb $type<LocalizedText>()`，和 `title` 完全同一个形状、同一个 `resolveLocalized()`。**少一张表、少一次 join、少一套 schema、少一个"两种多语规制"的心智负担**。真出现社区翻译时，加侧表是纯 additive，且届时要迁的是你自己写的几十行数据。

### D2. `resource_download_daily` 日聚合表

拆解自己把「下载日聚合与热度排行」列进 M3.5 可推迟项，然后又在 M3 建了表。**建了表就要写聚合 job、要测、要进对账脚本、要保证与 `download_log` 一致**——为一个没人要求的图表。`download_log` 上一句 `GROUP BY date_trunc('day', created_at)` 覆盖到万级下载量毫无压力。删。

### D3. 整条 multipart 上传路径（**本次最大的一刀**）

删除范围：`POST /uploads/multipart`、`/complete`、`/abort`、partUrls 批量签名、`upload_intent.uploadId` 列、`ListMultipartUploads` 清理 cron（即整个 **T7**）、`GET /me/uploads` 未完成 intent 列表、`completeMultipartSchema`、`MAX_MULTIPART_PARTS` / `MULTIPART_PART_BYTES` / `MULTIPART_THRESHOLD_BYTES`。

**删了失去什么**：>5 GB 单文件、断点续传、并发分片。

**为什么现在不需要**：S3 兼容存储的**单次 presigned PUT 上限是 5 GB**。同人游戏几百 MB、同人志图集几十到几百 MB、无损音乐专辑 1 GB 以内——5 GB 覆盖了这个站点可预见的**全部**内容。断点续传与并发分片是方案自己列的 M3.5 推迟项（"先串行 8MiB 够用"），但 T5 又把 4 个 multipart 端点全建了。**在 `presignUploadSchema` 里把上限设为 5 GB 并给一个明确错误码**；哪天真有人撞上，那就是建 multipart 的最佳信号，而不是现在猜。

**连带收益**：这一刀同时消掉了方案里最难写、最容易出错的一块——aws-sdk 的 `requestChecksumCalculation` / `AAAAAA==` CRC32 陷阱、bucket CORS 的 `ExposeHeaders: [ETag]` 依赖、以及一整个后台 job 的幂等性设计。

**顺带一个"更笨更可靠"的做法**：方案为了下载文件名真实，引入 `@aws-sdk/client-s3` + `s3-request-presigner` 专门签 `ResponseContentDisposition`。**改成上传时把 `Content-Disposition: attachment; filename*=UTF-8''…` 作为签名头写进对象元数据**（上传器是你自己的 JS，能发这个头），之后任何签名 GET 都自带正确文件名。**整个 aws-sdk 依赖可以从项目里消失**，`Bun.S3Client.presign` 一个 API 打完上传和下载两侧。少一个依赖 = 少一类版本漂移。

### D4. `touhou_work` + `convention` + `resource_work` → 并入 `tag`

三张表 + `work_kind` 枚举，就为了表达「原作」和「展会」两个筛选维度。而 `tag` + `tag_kind` + `resource_tag` 已经是完全同构的东西。

**删了失去什么**：原作/展会的类型化外键，以及挂作品专属元数据（发售日、官方编号、chronicle 互引 ID）的位置。

**为什么现在不需要**：M3 对 work 和 convention 的**全部操作是「按它筛选」和「显示它的多语名」**——和 tag 一模一样。作品专属元数据的消费方是 chronicle（M5+）。种子数据（th06–th20、C95–C107）无论哪种设计都是同一批行、同一个 jsonb 名字字段。

**替代**：`tag { id, kind: 'work'|'convention'|'other', slug, name jsonb, usageCount }` + `resource_tag`。**省 3 张表、1 个枚举、~6 个索引、2 个 relations、以及详情页的 2 个 join**。将来 work 需要专属列时，从 `tag` 里把行提升出去是一个脚本（数据是你自己 seed 的），不是迁移。

> 注意：`resource_category`（类型）**保留独立表**是对的——它是单选、必填、语义不同，且方案里「不做 pgEnum 而做查找表」的论证成立。

### D5. `thank`（感谢）整条

拆解自己列在 M3.5 推迟项（"评分收藏够用"），然后 schema 建了表、api 建了 2 个端点、resource 加了 `thankCount` 列、对账脚本加了一项、policy 加了「禁自谢」判定、i18n 加了文案。**感谢与收藏对用户是高度重叠的动作**。整条删（表 + 2 端点 + 计数列 + 自谢检查 + 对账项 + 3 语文案）。

### D6. 匿名下架通道的 3 个公开端点 + `trackingToken`

删除：`POST /takedowns`（公开）、`GET /takedowns/:id?token=`、`POST /takedowns/:id/withdraw`、token 生成/哈希/校验、`takedown_token_invalid` 错误码、状态查询与撤回 UI、三语回执邮件。**保留 `takedown_request` 表**。

**删了失去什么**：日本社团无账号自助提交并自助查询进度。

**为什么现在不需要**：M3 上线时站上资源数接近 0，你会收到的下架函数量是 **0**。而"版权生死线"的真实法律要求是三条：**资源有许可状态标注 ✓（保留）**、**权利人能联系到你**、**你能下架**。前两条用**一个 ja/zh/en 的 `/kourindou/takedown` 静态页 + 邮箱 + 必填信息清单**就完全满足，工作量 1 小时；第三条是 staff 把 `status` 改成 `delisted`，本来就有。收到邮件后由你手工往 `takedown_request` 表插一行——**表在，法律留痕就在**，这才是表的价值。

真收到第二封下架函的那天，再建表单。届时你会知道社团实际会写什么、需要什么字段。

### D7. `circle_claim` 的审批端点与队列

保留表 + `POST /circles/:id/claims`（1 个端点，收单）。删 `GET /circles/:id/claims`、`PATCH /moderation/claims/:id`、独立审批队列 UI。拆解自己已把「社团页 / 认领审批 UI」推到 M3.5 并说"审批先手工 SQL"——那就别建审批端点。

### D8. `search_outbox` + worker（连同 T15 整体推迟）

**删了失去什么**：搜索索引与 DB 的事务级最终一致。

**为什么现在不需要**：outbox 是"索引陈旧不可接受 + 写入量高"场景的正确工程。M3 的资源数是三位数以内，且拆解本来就把 Meilisearch 查询接管推到 M3.5。

**方案对这条的论证是错的**：「`search_outbox` 表和写入点 M3 必须做，否则补索引时要回溯全量」——**全量重建索引正是那个补救手段**，一个 `scripts/reindex.ts` 从 Postgres 扫一遍写进 Meili，几百条资源耗时以秒计，而且这个脚本你**无论如何都要写**（Meili 换版本、改 schema、灾后恢复都要它）。

**替代（择一）**：
- (a) M3 用 Postgres：`title_original` + `title` jsonb 上的 `pg_trgm` GIN 索引做模糊搜索。三位数资源量下体验没有可感差异。
- (b) 真要上 Meili：提交事务后 `try { await meili.addDocuments() } catch { log }`，配一个每晚跑的全量重建。**"失败就等下次全量"比 outbox 表 + worker + 重试语义严格更简单，且能自愈 outbox 处理不了的故障（比如索引 schema 改了）。**

### D9. `storage_gc_queue` 表 → 换成夜间反连接巡检

api 设计为硬删引入的队列表。**替代**：一个夜间脚本 `ListObjects` 后与 `resource_file.s3_key` 反连接，删无主对象。**巡检是幂等且自愈的；队列是有状态且会漂移的**（入队失败 = 对象永久孤儿，而巡检下一晚就捡回来）。同一个脚本顺手清理 `upload_intent` 里 `pending` 超 24h 的行 + 其对象——**T7 从一个 Task 缩成 20 行**。

### D10. 端点收敛：58 → ~35，15 个子路由器 → 8

| 组 | 现 | 建议 | 说明 |
|---|---|---|---|
| 资源状态流转 | 7 条（submit / delist / republish / license / DELETE / moderation review / moderation status） | 4 条 | `canTransition()` 已经是状态机唯一真相，再用 5 个具名 URL 把状态机**在 URL 空间里编码第二遍**，正是它本要消除的重复。保留 `POST /:id/submit`（返回 `decideSubmit` 结果，语义独特）与 `PATCH /:id/license`（强制 reason，法务价值）；`delist` / `republish` 合并为 `POST /:id/status { to, reason? }`；`DELETE`（admin 软删）删掉——M3 你就是 admin，删东西用 `delisted` + SQL |
| taxonomy | 5 条 | **1 条** | 全站分类数据 M3 不超过 100 行几 KB。一次 `GET /taxonomy` 返回全部，标签补全在客户端过滤。`/taxonomy/suggest`（Meili 拼音）随 D8 推迟 |
| moderation | 11 条 | **4 条** | 保留 queue / review / reports / resolve-report。claims、takedowns、stats、`PATCH /users/:id/trust` 全删——前两个随 D6/D7 走，stats 是队列页自己能算的 count，trust override 你是唯一 admin，用 SQL |
| me | 4 条 | **1 条** | 保留 `/me/resources`。`/me/favorites`、`/me/ratings` 是「个人主页聚合」，产品文档把它列在 M4 配套。`/me/trust` 并进已有的 `/api/me` 响应，不新开端点 |
| uploads | 6 条 | **2 条** | presign + confirm（随 D3） |
| interactions | 6 条 | **4 条** | 删 thanks（随 D5） |
| 其它 | | | 删 `GET /resources/:slug/versions`（详情页已返回 versions）；删 `PATCH /files/:fileId`（文件显示名的**多语翻译**是深度 YAGNI，`displayName` 降为原文件名 text）；`POST /versions/:id/promote` 并进 `PATCH /versions/:id { isLatest: true }` |

**附带效果**：方案在 §4.6 专门讨论了 TS2589（类型实例化过深）并把「拆成 15 个子路由器」当作缓解手段。**对 TS2589 的恐惧本身就是规模过大的症状**，方案是在治标。路由降到 35 条后这个问题基本消失，子路由器可以按 REST 资源自然划分为 8 个文件。

---

## 二、过早的抽象（间接层）

### A1. 全套 `*.service.ts` 分层 —— 建议取消（保留 1 个例外）

方案给 11 个模块每个配一个 `.service.ts`，理由是「可以被 M4 的 shrine 路由、cron、种子脚本复用」。**今天真有第二个调用方的只有 `content/post.service.ts`**（M4 论坛，用户明确要求的整合点）。其余全是单调用方的间接层：改一个字段要开两个文件、跳一次定义。

**对 AI 长期维护尤其有害**：每个模块的读取面积翻倍，而分层边界（什么算 service、什么算 route）是一条**没有编译器保护的软约定**，必然漂移——你会在半年后看到一半逻辑在 route 里、一半在 service 里。

**建议**：handler 直接内联在路由文件里；**出现第二个调用方时才抽 service**。`content/post.ts` 作为例外保留（它设计上就有两个调用方）。测试改用 `app.request()`（`app.test.ts` 已经是这个模式），这比测 service 函数覆盖更多——顺带覆盖了校验和中间件。

### A2. `packages/storage` 独立 workspace 包 → `apps/api/src/storage.ts`

一个只有单一消费者（apps/api）的包边界，代价是 package.json + tsconfig + turbo 里的 build/typecheck 任务 + 一条要维护的导入边界。~120 行代码。等 web 或独立 worker 真要用时再提升为包。

### A3. 错误码 i18n 流水线 —— 砍到 1/4

现状：**45 个错误码** + 全局 `z.config({ customError })` + `toFieldIssues` + `ISSUE_PARAM_KEYS` + `FieldIssue` + `fieldIssueSchema`（为避免循环引用单独拆的文件）+ `errorMessageKey` + 前端 `satisfies Record<ApiErrorCode, ...>` 穷尽表。**在写出第一条错误消息之前，就建成了完整的错误国际化基础设施。**

具体成本：45 个码 × 3 语 = **135 条文案**，而且 `satisfies Record<ApiErrorCode, …>` 的穷尽检查意味着**前端必须为永远不会被抛出的码写翻译**否则 typecheck 红。清点一下永远不会抛的：`external_mirror_unreachable`、`search_unavailable`、`upload_type_rejected`、`object_missing`、`takedown_token_invalid`（随 D6 死）、`duplicate_claim`、`circle_already_claimed`、`edit_window_expired`、`upload_size_mismatch`、`payload_too_large`、`storage_unavailable`……

**建议**：
1. **错误码起手 ~12 个**（validation_error / unauthenticated / forbidden / not_found / conflict / rate_limited / turnstile_failed / internal_error / resource_not_available / invalid_status_transition / upload_ownership_mismatch / daily_upload_quota_exceeded），**第一次真的 throw 时才加码**。`API_ERROR_STATUS` 映射表和错误信封形状保留——那部分是对的且便宜。
2. **删掉 `z.config` 全局 error map 与 `toFieldIssues` 的参数提取**。字段级错误返回 `{ path, code, message }`（message 用 zod 默认值），前端只翻译真正会展示的那几条。**关键前提你已经有了：schema 在 `packages/shared`，前端可以用同一份 schema 做提交前校验**——服务端字段错误是极少走到的兜底路径，为它建三语插值管线是倒置了投入。

### A4. `requireOwnerOrStaff<T>({ param, load })` + `OwnedEnv<T>` 泛型 Env 交集

这个中间件工厂的存在理由是「handler 不必二次查库」。**在你的流量下第二次查询是 0.2ms**。而代价是 Hono Env 泛型的类型体操——方案自己在注释里承认「中间件工厂里传 Context 会撞上 Hono Env 泛型不可协变的问题」，这正是 AI 会陷进去调半小时的那类构造。

**建议**：handler 头两行写 `const r = await loadResourceOr404(id)` / `assertCanEdit(r, actor)`。显式、可 grep、零泛型。`requireAuth` 和 `requireStaff` 保留（无泛型，10 行）。

### A5. 信任梯度：4 档 ladder → 1 个阈值

产品文档的原话是**一句话**：「新账号首个资源人工审核，通过 N 个后即发即审」。方案实现为：`TrustSignals` 5 个信号 + `TRUST_RULES` 4 档（各带 minApproved/minAgeDays）+ `trustLevelCache` + `trustOverride` + `strikeCount` + `DAILY_UPLOAD_QUOTA` 4 档 + `AUTO_PUBLISH_MIN_TRUST` + `TURNSTILE_EXEMPT_MIN_TRUST` + `CIRCLE_CREATE_MIN_TRUST` + `PATCH /moderation/users/:id/trust`。**这是一个为不存在的社区建的声誉系统。**

**建议保留** `decideSubmit()` 在 `packages/shared`——「前端能在提交前如实显示将进审核队列还是将立即发布」是真实且重要的（这个论证成立）。**只把它的输入从 6 个字段砍到 3 个**：

```
user_profile.approvedResourceCount            // 唯一信号
decideSubmit({ approvedCount, licenseStatus, isFirstResource })
  → pending if approvedCount < 3 || isFirstResource || licenseStatus 需审
```

- 日配额：**所有人一个常数**（如 10/天）。分档配额在没有滥用者时纯属参数噪音。
- **Turnstile 不做豁免**：Turnstile 对真人本来就是不可见的，「T≥2 免验证」省不了任何用户体验，只多一条分支和一次判定。
- `trustLevelCache` / `trustOverride` / `strikeCount` / `accountAgeDays` / `TRUST_LEVELS` 元组：全删。出现滥用时加一档，`decideSubmit` 的形状不变。

### A6. 两套分页（offset + cursor）→ M3 只留 offset

cursor 分页给评论的理由（"楼层会被插入，offset 会漏帖"）在**繁忙论坛**上成立。M3 一个资源的评论数是 0–20 条，一次全取。两套分页 = 两种结果类型、两套客户端代码、两套测试。**M4 论坛真的有长贴时再给 post 列表加 cursor**——那是加一个可选参数，不是改架构。

### A7. 下载去重的 PII 方案：4 个零件 → 0 个

现状：`ip_hash char(64)`（每日轮换盐的 sha256）+ `day_bucket` + partial unique + 90 天 GC + `resource_download_daily`。**方向对，但零件太多**（盐轮换 job、哈希列、GC job、聚合表）。

**更简单且隐私更强**：**根本不存 IP**。登录用户按 `(fileId, userId, day)` 去重；匿名下载不去重（或用一个签名 cookie 去重）。失去的是「同一匿名用户反复刷新会多计数」——在计数用于排序而非计费的场景里，这个误差没有任何后果。省掉盐轮换、哈希列、GC、以及一整场 PII 合规讨论。需要时加哈希列是 additive。

---

## 三、用户明确要求的两项：不删，但可以更简单

### B1. 评论 = topic + post（M4 整合）—— 保留核心，砍掉论坛专属列

方案的核心判断是**对的且应当保留**：判别列 + 可空真外键 + CHECK（而非无类型多态）、topic 指向 resource（而非反向，避免循环外键）、扁平 `floorNo` + `replyToPostId`（而非递归树）、软删保楼层号。这几条都是低成本高回报，且确实是 M4 免迁移的关键。

**可以砍掉的是 topic 上那些 M3 用不到的论坛列**：

```
topic 保留： id, kind, resourceId(unique nullable FK), title, postCount, createdAt
topic 删除： lastPostedAt, lastPostById, isLocked, pinnedAt
```

`lastPostedAt` / `lastPostById` 是**论坛主题列表页的反范式**（M4 才有那个页面）；`isLocked` / `pinnedAt` 是版主的论坛操作（M4）。`postCount` 保留——它是楼层发号器。这四列在 M4 是 `ADD COLUMN`，纯 additive。

**另外**：`post.status` 枚举与 `post.deletedAt` 是**同一个概念的两套机制**，AI 维护时必然写出「删了但 status 还是 published」的行。只留 `deletedAt`，删 `post_status` 枚举。

### B2. 多语字段 —— 保留「原文列 + jsonb 译名」，砍掉第二和第三种规制

方案的核心判断也是**对的**：`titleOriginal NOT NULL` + `titleOriginalLocale` + `title jsonb`，让 `resolveLocalized()` 成为**必有返回值的纯函数、调用方零判空**。这是整个方案里最好的一个决策，保留。

**简化为一条规制，全站复用**：

```
<name>Original  text NOT NULL     // 事实，永不翻译
<name>          jsonb LocalizedText  // 只装译名
resolveLocalized(jsonb, locale, original) → string
```

`resource.title`、`resource.description`、`circle.name`、`tag.name` 全走这一条。删掉：
- **`resource_translation` 侧表**（D1）——即「长文用侧表」这第二种规制；
- **`completeLocalizedTextSchema`**（三语必填，给 `resource_category.name` 用）——即第三种规制。5 行 seed 数据的三语完整性用**一个单测断言**保证，不值得为它开一个 schema 变体；
- **`titleOriginalLocale`**——M3 没有任何代码消费它（它是给未来「原文已是 ja 就不显示 ja 译名」和 `<span lang>` 用的），additive 列，需要时再加；
- **`changelogLocale`**——同理。

**结果**：多语从「jsonb + 侧表 + 三种 schema + 两个 locale 标注列」收敛为 **2 列 + 1 个纯函数**，仍然完整满足"业务数据多语字段，从第一张业务表开始落实"。**对 AI 维护是决定性的**：只有一种模式，不存在"这个字段该用哪种多语规制"的判断点。

---

## 四、任务拆解：23 → ~11

拆得过碎本身有成本——每个 Task 边界都是一次上下文重建 + 一轮 `check/typecheck/test/build`。

| 合并 | 原 Task | 理由 |
|---|---|---|
| **P1 契约 + schema + 横切** | T1 + T2 + T3 | 三者严格串行，且**T1/T2 已基本完成**（`packages/db/src/schema/kourindou.ts` 与 `packages/shared/src/kourindou/enums.ts` 已存在并验证过）。计划应该反映"改造已有产物"而非"从零建"。T14 的 Turnstile + 限流（各 ~30/40 行中间件）也并进这里 |
| **P2 上传 + 下载 + GC** | T4 + T5 + T6 + T7 | 同一张表、同一个 S3 客户端、同一批测试。storage 不再是独立包（A2），multipart 已删（D3），GC 缩成 20 行（D9） |
| **P3 资源读写** | T8 + T9 | 共用查询构造、行映射、slug 逻辑。拆开会把 DTO 映射写两遍 |
| **P4 互动 + 评论** | T10 + T11 | 都很小（删了 thanks 后 rating/favorite 各 2 条路由）。评论是 M4 地基，值得在同一个上下文里想清楚 |
| **P5 审核 + 举报** | T12 + T13 | 同一批 staff 界面、同一批表（report / audit_log / takedown_request） |
| ~~T15 搜索~~ | — | 整体推迟 M3.5，M3 用 pg_trgm（D8） |
| **P6 web 数据层 + 列表 + 详情** | T16 + T17 + T18 | 共用 `serverClient(request)`、resource-card、多语 resolve |
| **P7 上传向导** | T19 | **保持独立**——确实是前端最大块，且有独立的命令式编排 |
| **P8 我的资源 + 编辑** | T20 | 与列表共用表单组件，但可独立推进 |
| **P9 审核后台** | T21 | |
| **P10 i18n 审计** | T22 | `check-messages.ts`（~15 行）保留，**是三语不漏的唯一机械保证**。但文案量估算要重算：删掉上述功能后约 **120–160 条 zh**，不是 270–340 |
| **P11 端到端验收 + 文档** | T23 | |

---

## 五、必须解决的方案内部矛盾（不解决会直接浪费实施轮次）

三份设计对同一批对象**用了不同的名字和不同的形状**。如果照现状写成正式计划，实施的 AI 会产出互相矛盾的代码，然后花几轮去调和：

| 概念 | schema 设计 | api 设计 | plan 设计 |
|---|---|---|---|
| 类型查找表 | `resource_category` | `resource_type` / `typeSlug` | `resource_type` |
| 审计日志 | **一张** `resource_audit_log` | **两张** `moderation_log` + `license_change_log` | 两张 |
| 感谢表 | `thank` | `thanks` | `thanks` |
| 下载日志 | `download_log` + `resource_download_daily` | `download_event` | `download_log` |
| 展会 | `convention` | `eventId` | `event` |
| 权限判定 | — | 具体函数 `canViewResource`/`canEditContent` | 通用矩阵 `can(actor, action, target)` |
| 迁移策略 | 「0000 必须删掉重生成」 | — | 「走增量 0001」 |
| 成功响应 | — | **裸载荷，无 `{data}` 包装**（明确论证） | `{ data }` 信封 |

**建议裁决**：`resource_category` / **一张** `resource_audit_log` / 删 thank / `download_log` / 展会并入 tag（D4）/ **具体权限函数**（通用 `can()` 矩阵是权限框架，A 类过早抽象）/ 无数据则**重建 0000**（一个干净文件，比叠加增量更适合 AI 阅读）/ **裸载荷**（api 设计的论证成立，且 `app.test.ts` 已依赖）。

---

## 六、明确不要删的（防止简化过头）

| 项 | 理由 |
|---|---|
| **双桶 public/private** | 桶级设置，对象传上去之后再改要重传全部对象。**唯一真正不可逆的架构决策** |
| **`upload_intent`（单文件部分）** | legacy 的越权挂载他人对象是上线首日就存在的洞，修复成本是一张 8 列表 + 一个 `intent.userId === actor.id` 判断 |
| **下载白名单 `status === 'published'`** | 一行代码，防的是"知道 id 就能下待审资源" |
| **`licenseStatus` + 许可变更留痕** | 法律，无补录可能 |
| **`resource.uploaderId` 用 `set null`** | cascade 上线后误删一个用户即不可逆数据丢失 |
| **全部 `timestamptz`** | 零成本，同库两套时间语义是长期坑 |
| **关键 CHECK / partial unique** | rating 1–5、b2/external 二选一、每资源一个 `is_latest`、举报防刷。全部已实测，各 1 行 |
| **`decideSubmit()` 放 shared** | 前后端判定一致，是「上传向导第 5 步如实显示」的唯一实现方式 |
| **`resource_category` 用查找表而非 pgEnum** | 「`ALTER TYPE ADD VALUE` 同事务加完不能立刻用」这个论证成立，且查找表更便宜 |
| **`apps/api/src/env.ts` 启动即校验** | ~15 行，把配置错误从"第一次签名失败"提前到启动 |
| **`check-messages.ts`** | 三语不漏的唯一机械保证 |
| **对账脚本 `reconcile-counters.ts`** | 自愈型脚本，正是本文推荐的那类机制 |

---

## 七、收敛后的规模

| | 原方案 | 建议 |
|---|---|---|
| 业务表 | ~28 | **~18** |
| 路由 | 58 | **~35** |
| 子路由器 / 文件 | 15 路由器 + 11 service + policy + 4 http + 4 middleware ≈ 40 文件 | **~15 文件** |
| pgEnum | 19 | **~12**（删 work_kind / post_status / upload_kind 等） |
| 错误码 | 45（×3 语 = 135 条文案） | **~12**（36 条） |
| shared 多语规制 | 3 种 | **1 种** |
| 后台 job | 4（multipart GC / outbox worker / 日聚合 / 对账） | **2**（夜间巡检 + 对账） |
| Task | 23 | **11** |
| 三语文案 | 270–340 条 zh | **120–160 条 zh** |

**加一条字段的触点数**（AI 漂移的直接度量）：原方案约 10 处（shared schema → drizzle 列 → 迁移 → service → route → DTO → 前端表单 → 3 份 message → 可能的 error code + 3 条 message）；收敛后约 **5 处**。

**一条判断原则可以写进 CLAUDE.md**：**优先选自愈型机制（夜间全量重建索引、夜间孤儿巡检、计数对账脚本），而非增量维护状态的机制（outbox 表、gc 队列、日聚合表）。** 自愈型是幂等的、故障后自动收敛、AI 改坏了下一晚就修回来；增量型一旦某次入队失败就永久漂移，而且没人会发现。