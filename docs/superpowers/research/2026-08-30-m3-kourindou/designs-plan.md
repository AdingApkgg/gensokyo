# M3 香霖堂 任务拆解骨架

> 供主 agent 写正式 `docs/superpowers/plans/` 计划用。已核对仓库现状：`apps/api/src/modules/kourindou.ts` 目前只有一个返回空数组的 `/resources`，`packages/db/src/schema/` 只有 `auth.ts`，`packages/shared/src/` 只有 `pagination.ts`，web 侧 `/kourindou` 还是 `routes/stub.tsx`。M3 基本是从 M2 骨架上长出整个模块。

---

## 全局约定（写进计划的 Global Constraints）

1. **迁移策略**：M2 的 `packages/db/drizzle/0000_unusual_rage.sql` 只含 auth 四表，已在本地跑过。M3 **走增量 0001**（而不是像 M2 那样重建 0000）——业务表全新、与 auth 表无冲突，正好验证 drizzle-kit 增量路径能用，这条路径迟早要走，不如现在踩。
2. **枚举单一来源**：`as const` 元组定义在 `packages/shared`，同时喂 `z.enum()` 与 `pgEnum()`。**任何一处硬编码枚举字面量都算 bug**（legacy 的分类标签写了三份是反面教材）。
3. **DB 不变式与 zod 双层**：zod 校 API 边界，DB 用 CHECK / partial unique index 校数据不变式。两层都要，不因为有 zod 就放弃数据库约束。
4. **时间列一律 `timestamp({ withTimezone: true })`**；`updatedAt` 一律带 `$onUpdate`。现有 `packages/db/src/schema/auth.ts` 是无时区的，M3 顺手改掉，并在 CLAUDE.md 记一条"better-auth CLI 再生成后需重新打 timestamptz 补丁"。
5. **文案零裸字符串**：每个含 UI 的 Task 的验收条件里必须包含"`messages/{zh,ja,en}.json` 三份 key 集合相等"。
6. **每个 Task 收尾**：`bun run check && bun run typecheck && bun run test` 全绿再 commit；含前端的加 `bun run build`。
7. **hc 类型主轴不能断**：模块文件内部单条链式 `.get().post()...`，`app.ts` 上链式 `.route()`。新增路由后 `packages/api-client` 的类型烟测必须仍能推出具体响应类型（不是 `any`、不是四路联合）。

---

## 依赖图（一眼看清串并行）

```
T1 契约 ──┬─→ T2 schema ──→ T3 api横切 ──┬─→ [S分支] T5 → T6 → T7
          │                              ├─→ [R分支] T8 → T9 → T10 → T11
          └─→ T4 storage ────────────────┘        ↑
                                                   │ (T9 依赖 T5)
                                 [M分支] T12 → T13 → T14   (T12 依赖 T9)
                                 [X分支] T15               (依赖 T9 + T12)

T8 ──→ T16 web数据层 ──┬─→ T17 列表页
                        ├─→ T18 详情页  (还依赖 T6/T10/T11)
                        ├─→ T19 上传向导 (还依赖 T5/T9/T14)
                        ├─→ T20 我的资源/编辑/社团页
                        └─→ T21 审核后台 (还依赖 T12/T13)
                                          ↓
                              T22 i18n审计 → T23 端到端验收
```

**严格串行**：T1 → T2 → T3。**T4 与 T2/T3 可并行**（不碰 DB）。**S / R / M / X 四条分支在 T3 之后可分头推进**，仅 T9→T5、T12→T9、T15→T9+T12 三处跨分支依赖。**T17–T21 五个页面 Task 相互独立，可全并行**。

---

# 阶段 0：契约地基（串行）

## T1 — `@gensokyo/shared` 香霖堂契约命名空间

纯 TS，零 IO，是整个 M3 的类型源头。

**新建**
- `packages/shared/src/kourindou/enums.ts` — `RESOURCE_STATUS` / `LICENSE_STATUS` / `REPORT_KIND` / `REPORT_STATUS` / `FILE_STORAGE_KIND` / `UPLOAD_STATE` / `TOPIC_KIND` / `CIRCLE_ROLE` / `ROLE` 的 `as const` 元组 + 对应 `z.enum()`
- `packages/shared/src/kourindou/localized.ts` — `localizedTextSchema`（`{ zh?, ja?, en? }`，至少一个非空）+ `pickLocalized(text, locale)` 回退链 zh→ja→en→原文
- `packages/shared/src/kourindou/permissions.ts` — `can(actor, action, target)` 纯函数；`Action` 联合类型（`resource:edit` / `resource:moderate` / `resource:delete` / `report:handle` / `circle:claim-approve` …）；**owner 与 staff 权限必须拆开**（staff 只能改 status/license/tag，不能改标题；硬删只留 admin）
- `packages/shared/src/kourindou/errors.ts` — 统一响应信封 `{ data }` / `{ error: { code, message, fields? } }`，`fields` 用 `z.treeifyError()` 结构
- `packages/shared/src/kourindou/schemas/*.ts` — resource / version / file / circle / tag / interaction / report / review 的输入输出 schema；含 `resourceListQuerySchema`（多维筛选 + 游标分页，替代现有 `paginationQuerySchema` 的 offset 语义）；file 用 **discriminated union**（`storageKind: 'b2'` 有 `s3Key`，`'external'` 有 `url`）
- `packages/shared/src/kourindou/*.test.ts`

**修改**：`packages/shared/src/index.ts` 导出（建议加 `./kourindou` subpath export，避免 barrel 越滚越大）

**验证**
- `cd packages/shared && bun test` — 覆盖：回退链（三种缺失组合）、`can()` 的 owner/staff/anon × 5 个 action 矩阵、file 判别联合两分支互斥、`resourceListQuerySchema` 对非法 `category=all` 报 400 而不是抛（legacy 的真实 bug #1）
- `bun run typecheck`

**为什么最先做**：T2 的 pgEnum、T3 的中间件、所有 API、所有前端表单都从这里取型。这个 Task 定错了，后面全返工。

---

## T2 — db schema 全量 + 迁移 + 种子

**新建**（`packages/db/src/schema/` 按模块分文件，产出 8 个新文件）
| 文件 | 表 |
|---|---|
| `user-profile.ts` | `user_profile`（role / **trustLevel** / approvedResourceCount / bio / locale） |
| `resource.ts` | `resource`（含 `licenseStatus` 及一组 license 字段、`topicId` unique、多语 `title` jsonb + `titleOriginal`）、`resource_translation` |
| `version.ts` | `version`、`file`、`upload_intent` |
| `circle.ts` | `circle`、`resource_circle`、`circle_claim` |
| `tag.ts` | `tag`（带 `kind`）、`resource_tag`、`event`、`touhou_work`、`resource_work` |
| `interaction.ts` | `rating`、`favorite`、`thanks`、`download_log` |
| `moderation.ts` | `report`、`moderation_log`、`license_change_log`、`takedown_request` |
| `content.ts` | `topic`、`post`（M4 共用，M3 只用 `kind='resource'` 分支） |
| `search.ts` | `search_outbox`（供 T15 用；表现在建，worker 后建） |

**修改**：`packages/db/src/schema/index.ts`、`packages/db/src/schema/auth.ts`（timestamptz）、`packages/db/package.json`（加 seed script）

**必须落进 DDL 的硬约束**（这是 legacy 全库零 CHECK 的补课）
- `CHECK (rating.score BETWEEN 1 AND 5)`
- `CHECK ((storage_kind='b2' AND s3_key IS NOT NULL) OR (storage_kind='external' AND external_url IS NOT NULL))`
- `CREATE UNIQUE INDEX ON version (resource_id) WHERE is_latest` — 每资源一个 latest
- `CREATE UNIQUE INDEX ON report (target_type, target_id, reporter_id) WHERE status='open'` — 举报防刷
- `resource.uploader_id` **改 `onDelete: 'set null'`**（legacy 的 cascade 会删一个用户抹掉全部内容和别人的评论）
- `post.replyToPostId` 自引用 FK `onDelete: 'set null'`（legacy 是裸 integer，可插孤儿）
- 索引补全清单：`resource(uploaderId)` / `resource(licenseStatus)` / `resource_tag(tagId, resourceId)` 反向 / `favorite(userId, createdAt)` / `rating(userId)` / `report(status, createdAt)` / `post(topicId, floorNo)` / `file(versionId)` / `version(resourceId)` / `download_log(resourceId, createdAt)`

**种子**：`packages/db/src/seed.ts` — touhou_work（th06–th20 + 书籍/音乐 CD 的多语名）、初始 tag kind 数据、常见 event（C95–C107、例大祭若干）。**这是 T8 列表页能验收的前提**。

**依赖**：T1

**验证**
```bash
docker compose up -d
cd packages/db && bun run generate           # 应生成 0001_*.sql
grep -c 'CREATE TYPE' drizzle/0001_*.sql     # 枚举都在
grep -E 'CHECK|WHERE' drizzle/0001_*.sql     # CHECK 与 partial index 都在
bun run migrate && bun run seed
psql postgres://gensokyo:gensokyo@localhost:55432/gensokyo -c '\d+ resource'
psql ... -c "INSERT INTO rating(resource_id,user_id,score) VALUES('x','y',99)"   # 期望被 CHECK 拒绝
```
- 新增 `packages/db/src/schema/schema.test.ts`：遍历 schema 导出，**断言每张表都声明了 `relations()`**（legacy 漏了 5 张表的 relations，导致 `db.query.*.findMany({with})` 对它们不可用）

---

## T3 — api 横切层：env / 错误信封 / 会话与权限中间件

**新建**
- `apps/api/src/env.ts` — zod 校验全部 env，**启动即失败**（legacy 的 `?? ""` 把配置错误推迟到第一次签名失败，极难排查）
- `apps/api/src/middleware/session.ts` — 一次 `auth.api.getSession({ headers: c.req.raw.headers })`，join `user_profile` 拿 role + trustLevel，`c.set('user', ...)`；类型经 `Hono<{ Variables: ... }>` 贯穿到 hc
- `apps/api/src/middleware/require.ts` — `requireAuth` / `requireRole('moderator')` / `requireOwnerOrStaff(loader)`
- `apps/api/src/error.ts` — `app.onError` + `zValidator` 的统一 hook，全部输出 T1 的 error 信封
- `apps/api/src/test-utils.ts` — `signUpAndGetCookie()` / `makeUser({ role, trustLevel })` 测试夹具

**修改**：`apps/api/src/app.ts`（挂 onError + sessionMiddleware）、`turbo.json` 的 `globalPassThroughEnv` 加 `B2_*` / `TURNSTILE_*`、`.env` / `.env.example`

**依赖**：T1、T2

**验证**
- `bun test apps/api` — 未登录打受保护路由 401 且信封形状正确；role=user 打 staff 路由 403；zod 失败返回 `fields` 而非 `{error:"bad input"}`
- 故意删一个 env 变量启动 → 进程立刻退出并打出缺失字段名
- `packages/api-client/src/index.test.ts` 扩一条类型烟测：`c.api.me.$get()` 的响应类型不是 `any`

---

# 阶段 1：并行分支

## 分支 S：存储与分发

### T4 — `packages/storage` 包（**可与 T2/T3 并行**）

**新建**：`packages/storage/{package.json,src/index.ts,src/client.ts,src/keys.ts,src/*.test.ts}`

**关键设计决策（挖掘报告已实测，直接采纳）**
- **双桶**：`gensokyo-assets`（public，封面/缩略图走 CDN）+ `gensokyo-files`（private，资源本体只走签名 URL）。legacy 因为封面要公开访问所以整桶 public，导致 `presignGet` 的保护为 0 —— 这是架构级问题，不是补丁。
- **混合 SDK**：封面/小文件 presign PUT 用 `Bun.S3Client.presign`（零依赖、同步）；下载签名 GET **必须**用 `@aws-sdk` 的 `GetObjectCommand` + `ResponseContentDisposition`（Bun 原生不支持 disposition，而"下载到的文件名是真实名而不是 uuid"是资源站基本体验）；multipart 四个 Command 用 `@aws-sdk`（Bun 原生不暴露 create/uploadPart/complete，`presign` 会静默忽略 `partNumber`/`uploadId`）。
- **aws-sdk client 必须加两个选项**：`requestChecksumCalculation: 'WHEN_REQUIRED'` + `responseChecksumValidation: 'WHEN_REQUIRED'`。不加会把空 body 的 CRC32（`AAAAAA==`）签进 query string，legacy 能跑只是在赌 B2 的宽容度。
- key 命名 `staging/<userId>/<uuid>.<ext>`，**创建版本时不搬对象**（B2 copy 计费），归属由 `upload_intent` 表承担而非 key 前缀。
- **bucket CORS 规则写成版本化文件**（`packages/storage/b2-cors.json` + 一条应用脚本）。legacy 的 CORS 是控制台手工设的、没版本化，而 multipart 读 ETag 强依赖 `ExposeHeaders: [ETag]`，丢了会静默失败。

**验证**：`bun test packages/storage` —— 签出的 URL query 参数快照断言（不含 `x-amz-checksum-crc32`）、GET 带 `response-content-disposition`、`SignedHeaders=host`；起一个 `Bun.serve` 假 S3 端点验证 multipart 三段请求形状（挖掘报告的探针脚本在 scratchpad 里可复用）。

---

### T5 — 上传流程 API：intent → presign → complete

**新建**：`apps/api/src/modules/kourindou/uploads.ts`

**路由**（**必须拆成独立路由，不要 legacy 的 `?action=`**——hc 无法为 query 分支收窄返回类型，单路由会退化成四种响应的联合）
```
POST /api/kourindou/uploads/presign                      单文件，落 upload_intent
POST /api/kourindou/uploads/multipart                    start，一次性返回全部 partUrls[]
POST /api/kourindou/uploads/multipart/:uploadId/complete
POST /api/kourindou/uploads/multipart/:uploadId/abort
```

**必须修掉的 legacy 缺陷**
1. **intent 表核销**：presign 时落一行 `upload_intent(userId, key, declaredSize, contentType, status)`；`complete` 时 `HeadObject` 回填真实 size/etag 并置 `status='uploaded'`。legacy 的 `/api/resources` 无条件信任客户端上报的 key，任何登录用户能把别人的 B2 对象挂到自己资源上。
2. **key 归属校验**：part / complete / abort 全部校验 intent 属于调用者。legacy 只验登录，知道 key+uploadId 就能终止他人上传。
3. **大小上限**：`declaredSize` 在 presign 时校验 + `HeadObject` 回填时二次拒绝超限。legacy 完全无上限。
4. **一次性批量签片**：128 片文件从 258 次往返降到 3 次。

**依赖**：T3、T4

**验证**：`bun test` —— 用户 A 的 intent 被用户 B 的 complete 请求命中 → 403；declaredSize 超限 → 400；complete 未先 presign 的 key → 404；三个状态流转的 intent 行断言。

---

### T6 — 下载 API：白名单状态 + 并发安全计数 + filename

**新建**：`apps/api/src/modules/kourindou/downloads.ts`（`GET /files/:fileId/download`）

**三条硬要求**
1. **白名单判定** `status === 'published'`（外加"上传者本人 / staff 可预览"的显式例外分支）。**绝不写 `!== 'takedown'`** —— legacy 就是这么写的，结果 `pending` 和 `hidden` 的资源只要知道 id 就能下载，M3 有真实待审队列后这是直接漏洞。
2. **先写库后签名**（legacy 反了，事务失败也已交出 URL）。
3. **计数并发安全**：`download_log` 加去重唯一索引 `(fileId, userId_or_ipHash, date)` + `ON CONFLICT DO NOTHING`；主表 `downloads` 用原子 `sql\`+ 1\`` 且**只在去重命中新行时递增**。legacy 是签发即 +1，空跑 GET 即可无限刷量。
4. **IP 不明文存**：存 `ipHash`（salt 从 env），或直接不存。面向 EU/日本的站点，legacy 的明文 IP + 无保留期是 PII 合规风险。
5. **外链镜像分支**：`storageKind='external'` 直接 302 到 `externalUrl`，同样计数。

**依赖**：T3、T4、T5（同一模块的 file 表读写）

**验证**：`bun test` —— pending 资源的 file 匿名下载 → 403，上传者本人 → 200；同一 (user, file, day) 连打 20 次 → `download_log` 只 1 行、`resource.downloads` 只 +1；签出 URL 含 `response-content-disposition` 且 filename 是 `file.name` 而非 uuid。**并发测试**：`Promise.all` 打 50 个并发请求断言最终计数正确。

---

### T7 — 清理任务：孤儿对象 / 残留分片 / 过期 intent

**新建**：`apps/api/src/jobs/storage-gc.ts` + 一个能手跑的入口

legacy 的 `abortMultipart` 写了、路由挂了、**全仓零调用点** —— B2 上堆积的未完成 multipart 持续计费且在控制台不可见。

- 客户端侧：上传编排 `try/finally` 调 abort（属于 T19）
- 服务端侧：定时扫 `ListMultipartUploads` 清理 >24h 残留；扫 `upload_intent` 里 `status='pending'` 且 >24h 的行，删对象 + 删行；扫 `status='uploaded'` 但从未被任何 file 引用的 intent（用户传了文件但没提交表单）

**依赖**：T5

**验证**：造三种残留状态，跑一次 job，断言 B2 侧和 DB 侧都干净；job 必须幂等（连跑两次结果相同）。

---

## 分支 R：资源 API

### T8 — 资源读端点（list / detail）

legacy **一个 GET 都没有**（除 download），全部读取在 RSC 里直接打 drizzle。这条整个是新建。

**新建**：`apps/api/src/modules/kourindou/resources.ts`（先只写 GET）

- `GET /resources` — 用 T1 的 `resourceListQuerySchema`；**游标分页**（`createdAt + id` 复合游标）替代 offset；多维筛选 type × 原作 × 展会 × license × circle × tag；排序 new / popular / rating
- `GET /resources/:slug` — 一次 `findMany({ with: { versions: { with: { files } }, circles, tags, works, topic } })`，避免 legacy 详情页的 3–4 次串行往返
- **错误绝不吞**：legacy 的 `try { } catch { list = [] }` 让所有 DB 故障显示成"没找到匹配的资源"，故障完全不可观测

**修改**：`apps/api/src/modules/kourindou.ts` → 改造成 `kourindou/index.ts` 的链式聚合，删掉现有那个返回空数组的占位路由

**依赖**：T3（+ T2 的 seed 数据才能验收）

**验证**：curl 六种筛选组合 + 游标翻页首尾一致性；`category=all` 这类非法枚举值返回 400 而非空列表；detail 的 SQL 往返次数断言（可用 drizzle logger 计数）。

---

### T9 — 资源写端点（create / update / 状态流转）

**同一事务里必须一起做完三件事**（这是 M4 不用迁移的关键）：
1. 插 `resource`
2. 插 `topic`（`kind='resource'`）并回写 `resource.topicId`
3. 插首个 `version`（`isLatest=true`）+ 从 `upload_intent` 核销出 `file` 行

**其余要点**
- `status` 默认 `pending`，按 `user_profile.trustLevel` 决定是否直接 `published`（信任梯度的写入点在这里，判定逻辑在 T12）
- 所有状态变更写 `moderation_log`；license 变更写 `license_change_log`（**版权争议时要能证明"我们何时依据什么改的状态"，这是法务价值**）
- `uniqueSlug` 复用 legacy 的 `slugify`（`[^\p{L}\p{N}-]` 保住中日文 slug，这点 legacy 做对了），但循环查库改成一次 `ON CONFLICT` 重试
- **不提供硬删**。legacy 的 `DELETE /api/resources/[id]` 上传者本人即可硬删，级联抹掉全部评论/评分/举报证据，B2 对象永久孤儿。M3 只有软 `delisted`，真删走 admin 专用 + T7 的清理任务
- PATCH 一律 `returning()` 回传实体（legacy 只回 `{ok:true}`）
- 写 `search_outbox` 行（供 T15）

**依赖**：T5、T8

**验证**：create 后断言 topic 已建且 `resource.topicId` 非空；用别人的 intent key 创建 → 403；trustLevel=0 用户创建 → `status='pending'`，trustLevel≥2 → `published`；非 staff 传 `status` 字段 → **显式 403 而不是 legacy 那样静默 `delete v.status`**。

---

### T10 — 互动端点（rating / favorite / thanks / report）

- 全部 `INSERT ... ON CONFLICT (resource_id,user_id) DO UPDATE ... RETURNING`，**去掉 legacy 的 read-then-write**（默认 READ COMMITTED 下并发双击会撞主键 500）
- favorite 拆成显式 `PUT` / `DELETE` 两个端点（比 legacy 的 toggle 更幂等，RPC 类型也更干净）
- rating 补 `updatedAt`；补"取消评分"路径
- **计数对账**：`packages/db/src/jobs/reconcile-counters.ts`，可手跑重算 `ratingSum` / `ratingCount` / `downloads`。冗余计数保留（列表排序需要）但必须可对账
- report 改多态（`targetType: resource|post|user|circle`）+ `kind` 枚举（copyright 直连 T13 的下架流程）

**依赖**：T9

**验证**：`Promise.all` 并发 20 次评分/收藏 → 无 500、终态正确、计数一致；对账脚本在人为篡改计数后能修回。

---

### T11 — 评论 = post 端点（M4 共用的核心）

**这是 M3 最容易被做错、做错了 M4 就要迁移的一个 Task。**

- API 形状是"资源视图的 post"：`GET /resources/:slug/posts`、`POST /topics/:topicId/posts`
- **扁平楼层 + 引用**：`floorNo` 自增 + `replyToPostId` 自引用 FK。**不要 legacy 那种 `parentId` 递归树**——产品文档描述的是 NGA 心智（版块→主题帖→楼层回复+引用），扁平楼层让分页、通知、@提及全部变简单
- 软删（`deletedAt`）而非物理删，否则楼层号断裂
- 校验资源存在且可评论（legacy 完全不检查，已下架资源仍可评论，resourceId 不存在时靠 FK 抛出变成 500）
- `floorNo` 分配要并发安全：`INSERT ... SELECT coalesce(max(floor_no),0)+1 FROM post WHERE topic_id=$1` 配 `(topicId, floorNo)` 唯一索引 + 重试

**依赖**：T9

**验证**：并发 20 条发帖 → 楼层号 1..20 无重复无空洞；跨 topic 的 `replyToPostId` 被拒；软删后楼层号保持。

---

## 分支 M：审核与治理

### T12 — 状态机 + 信任梯度 + 审核队列

**新建**：`apps/api/src/modules/kourindou/admin.ts`、`apps/api/src/lib/trust.ts`

- 五态 `draft | pending | published | rejected | delisted` + `moderation_log` 审计（actor / from / to / reason / at）
- 信任梯度判定：`trustLevel` 与 `role` **必须分开**（legacy 的 `uploader` role 是把信任等级伪装成角色）；`approvedResourceCount` 达 N 后自动升级
- `GET /admin/resources?status=pending` 游标队列，**排序把 licenseStatus 作为首要审核信号**（生死线字段排在最前）
- `POST /admin/resources/:id/review { action, reason }` — 驳回后回到上传者可编辑态
- 写 `search_outbox`

**审核队列权限（易漏项）**：必须 `requireRole('moderator')`，并且测试三条：普通用户 403；上传者能看**自己**的 pending 资源详情但看不到队列；未登录 401。

**依赖**：T9

**验证**：状态流转矩阵测试（每个非法转移都被拒）；每次流转都产生一条 `moderation_log`；trustLevel 升级在通过第 N 个资源时触发。

---

### T13 — 举报闭环 + 下架 / 认领通道

- 举报状态机 `open | reviewing | resolved | rejected | duplicate` + assignee + resolution + resolvedAt。legacy 的 `resolved` 是 boolean，且**全代码库没有任何地方写它**——举报永远处理不掉
- `kind='copyright'` 的举报一键转 `takedown_request`
- `takedown_request`（申请人 / 与社团关系 / 证据 URL / 状态 / 处理结果）与 `circle_claim`（申请人 / 证据 / 审批人）**必须是独立通道，不能混在举报里**——这是版权生死线
- 申诉字段（可 M3.5 接 UI，表结构 M3 建好）

**依赖**：T12

**验证**：同一人对同一目标重复举报 → partial unique index 拒绝；处理完后可再报；copyright 举报转 takedown 后两边状态联动。

---

### T14 — Turnstile + 限流

全站零反机器人是 solo 运营的致命伤。legacy 的 `TURNSTILE_*` 和 `REDIS_URL` 在 `.env.example` 里但**全仓 grep 零命中**。

- Turnstile 中间件挂：注册、上传提交、举报（匿名可发）、发帖
- Redis 令牌桶限流挂：download、post、rating、report
- `compose.yml` 的 redis 已经在跑，接上即可

**依赖**：T3（可与 T12/T13 并行）

**验证**：无 token 提交 → 403；超频请求 → 429 且带 `Retry-After`；测试环境用 Turnstile 的官方 always-pass 测试密钥。

---

## 分支 X：搜索

### T15 — Meilisearch 索引契约 + outbox worker + 查询接管

**索引同步时机（最容易漏的横切项，必须逐条列进计划）**：资源发布 / 编辑 / **状态变更**（pending→published 才进索引，delisted 要删索引）/ license 变更 / 版本发布 / tag 变更 / circle 改名（波及其全部资源）/ 资源软删。

**做法**：**不要在写路径里直接 `await meili.addDocuments()`**（会把搜索故障变成写入故障，且事务回滚后索引已脏）。用 `search_outbox` 表在**同事务**插一行，独立 worker 消费。这是唯一能保证"DB 与索引最终一致"的做法。

- 索引文档形状：多语标题展平成 `title_zh` / `title_ja` / `title_en` + `titleOriginal` + 拼音字段
- facet：type / 原作 / 展会 / license / circle
- `GET /resources` 的搜索分支切到 Meili，筛选与精确过滤仍可走 DB 兜底

**依赖**：T9、T12

**验证**：写一条资源 → worker 跑一轮 → Meili 查得到；改状态为 delisted → Meili 查不到；杀掉 worker 期间的写入在 worker 恢复后补齐；中文/拼音/日文三种查询各一条断言。

---

# 阶段 2：前端（T17–T21 五个页面可全并行）

### T16 — web 数据层与香霖堂路由骨架

**新建**：`apps/web/app/lib/server-client.ts`、`apps/web/app/routes/kourindou/*`

**SSR cookie 转发（易漏项）**：现在 `root.tsx` 是手写 `createClient(url, { headers: { cookie } })`。M3 路由变多，**必须封装成 `serverClient(request)` 一个函数**，否则一定会有某个 loader 忘记转发 cookie，表现为"登录了但收藏按钮显示未收藏"这种难查的 bug。加一条 lint 规则或测试：loader 里禁止直接调 `createClient`。

**修改**：`apps/web/app/routes.ts`（`/kourindou` 从 `stub.tsx` 换成真实嵌套路由：`_index` / `:slug` / `:slug/edit` / `upload` / `circles/:slug` / `dash/*`）

**依赖**：T8

**验证**：一个 loader 故意不转发 cookie → 测试失败；`bun run build` 通过；`bun run typecheck` 时 hc 能从 loader 一路推到组件 props。

---

### T17 — 列表页（多维筛选 + 分页）

- 筛选从 legacy 的 3 个（q / category / sort）扩到 8+ 维；用 `<Form method="get">` + `useSubmit`，loader 用 T1 的**同一份** `resourceListQuerySchema` 解析（一份 schema 同时喂前端表单与后端）
- **补上分页 UI** —— legacy 服务端读了 `page` 参数但页面上根本没有翻页控件，第 2 页只能手改 URL
- 沿用 `resource-card` 的信息密度（4:3 封面 + 分类 Badge + 标题 + 社团 + 星级/下载数），但标题走多语回退链，`framer-motion` 的 `whileInView` 换掉（SSR 首屏会先渲染 `opacity:0`）
- **license 状态徽章要在卡片上就可见**（`/ui` 页已经有 `section_badges` 的设计）

**依赖**：T16

---

### T18 — 详情页（版本历史 + 文件 + 互动 + 评论）

- 版本分组的文件列表（legacy 完全没有版本概念）；B2 对象与外链镜像两种来源要有视觉区分
- `descriptionMd` 用**真正的 Markdown 渲染 + sanitize**（legacy 字段名叫 md 但用 `whitespace-pre-wrap` 裸输出）
- `rating-stars` 必须**回显用户已有评分**（legacy 的 `value` 初始恒为 0，刷新后自己打的分消失）
- 收藏/评分/发帖全改 `useFetcher` 乐观 UI，**删掉全部 `router.refresh()`**（legacy 里有 5 处；RR8 action 后自动重新验证）
- 评论区 = post 列表，UI 就按"楼层"做（`#12` 楼层号 + 引用块），M4 论坛直接复用组件
- 日期一律 `<time>` + 服务端按 locale 格式化（legacy 3 处硬编码 `toLocaleDateString("zh-CN")`，SSR/CSR 时区不一致会 hydration mismatch）

**依赖**：T16、T6、T10、T11

---

### T19 — 上传向导（M3 工作量最大的前端 Task）

legacy 没有向导，是一个所有字段同屏的扁平表单。M3 分五步：

```
① 许可与归属  ← licenseStatus 四选一 + circle + 认领声明勾选，放最前面当闸门
② 基本信息    ← 多语标题/简介 zh·ja·en + 类型 + 原作关联 + 展会
③ 文件与版本  ← 首个 version 号 + changelog + B2 直传 / 外链镜像混填
④ 封面与标签
⑤ 预览与提交  ← Turnstile + 按信任等级显示"将进入审核队列"或"将立即发布"
```

**上传编排保持命令式**（RR8 的 `action` 收 FormData 会让文件字节过服务器，正好抵消直传的意义）；只有最后一步"创建资源"走 action / `useFetcher`。继续用 XHR 拿 `upload.onprogress`（fetch 的 request streaming 需要 HTTP/2 且 Safari 支持不全）。

**必须修掉的三个 legacy 前端 bug**
- `const idx = queue.length` 是 stale closure，多选时所有文件拿到同一个 idx，进度条互相覆盖 → 改用 `crypto.randomUUID()` 作 key
- `new AbortController().signal` 在调用点即时构造，controller 立刻被 GC，取消功能实际不存在 → 真正接上取消按钮
- 失败时 `try/finally` 调 `abort`（配合 T7）

**依赖**：T16、T5、T9、T14

---

### T20 — 我的资源 / 编辑 / 社团页

- 编辑页要能改文件、封面、外链（legacy 的 `EditForm` 查了 `files` 却没传进去，全都改不了）
- "我的资源"显示 pending / rejected 状态与驳回理由（**M3 没有通知中心，这个页面就是审核结果的唯一出口**）
- 社团页 + 认领申请入口

**依赖**：T16、T9、T13

---

### T21 — 审核后台

- 待审队列（按信任等级 + 提交时间排序，license 徽章作首要信号）
- 审核操作带**原因枚举 + 自由文本 + 二次确认**（legacy 三个按钮无确认、无原因、无审计、无通知）
- 举报处理闭环（受理/驳回/关联下架）
- 下架申请与认领申请**独立队列**
- 状态枚举全部走 message（legacy 的 dash 直接渲染英文 enum）

**依赖**：T16、T12、T13

---

# 阶段 3：收尾

### T22 — i18n 审计与三语补全

**量级估算**：legacy 基线约 120 条 zh；M3 新增面（多语字段编辑器、license 四态 + tooltip、版本与更新日志、多维标签、审核队列与驳回原因枚举、认领/下架流程、信任等级提示、Turnstile 提示、分页、搜索空结果与拼音提示）预计再加 150–220 条 → **zh 总量 270–340 条，×3 = 810–1020 条**。

**三条现在就定死的约定**
1. 所有 enum 的展示名一律走 message，**不写组件内 map**（legacy 的分类标签在三个组件里各写一遍，`edit-form` 干脆显示英文 slug）
2. key 按模块前缀：`kourindou_upload_*` / `kourindou_moderation_*` / `content_post_*`（最后一组给 M4 论坛复用评论文案留位）
3. 日期 / 文件大小 / 复数走 locale-aware 格式化，不写死 `"zh-CN"` 和英文单位数组

**新建**：`apps/web/scripts/check-messages.ts` —— 断言三份 json 的 key 集合完全相等 + 无空值，挂进 `bun run test`。**这个脚本是"三语文案不漏"的唯一机械保证**，不能靠人肉 review。

---

### T23 — 端到端验收 + 文档

- 验收矩阵：新账号注册 → 上传（走完五步）→ 进 pending → 管理员审核通过 → 列表页搜到 → 详情页下载（计数 +1，文件名正确）→ 评分/收藏/发帖 → 举报 → 举报处理 → 下架 → 列表页搜不到、下载 403
- 三语 × 亮暗主题 各跑一遍上述路径
- `bun run check && bun run typecheck && bun run test && bun run build` 全绿
- 更新 CLAUDE.md（storage 双桶约定、outbox 同步模式、serverClient 转发约定、pgEnum 增值的运维代价）+ 产品文档里程碑标记

---

# 最小可上线闭环（"香霖堂能用了"）

**必须做完（22 个中的 18 个）**：T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T16 T17 T18 T19 T21 T22 T23

判据是四个动词能闭环：**上传 → 审核 → 分发 → 互动**，且两条生死线不破——① 每个资源有 license 状态且下架通道能走通；② 下载走白名单 + 签名 URL + 双桶，pending 的东西下不到。

**可推到 M3.5（但表结构必须 M3 建好，否则要迁移）**

| 推迟项 | 为什么能推 | 前提 |
|---|---|---|
| T15 Meilisearch 查询接管 | 列表页用 pg 的多维 filter + `title jsonb` 上的 GIN/trigram 索引兜底够用 | **`search_outbox` 表和写入点 M3 必须做**，否则补索引时要回溯全量 |
| T20 社团页 / 认领审批 UI | 认领申请能收单（T13）即可，审批先手工 SQL | `circle` / `circle_claim` 表 M3 建好 |
| 外链镜像的上传 UI | 先只支持 B2 直传 | `file.storageKind` 判别联合 + CHECK M3 建好 |
| 多语字段的 ja/en 编辑 UI | 上传向导第②步先只填 zh + `titleOriginal` | jsonb 列与 `resource_translation` 表 M3 建好 |
| 版本历史 UI | 详情页先只暴露"最新版" | `version` 表 + `isLatest` partial unique M3 建好 |
| 感谢 / 举报申诉 | 评分收藏够用 | `thanks` 表、申诉字段 M3 建好 |
| 断点续传 / 并发分片 | 串行 8MiB 够用 | — |
| 下载日聚合与热度排行 | 主表 rollup 够用 | `download_log(resourceId, createdAt)` 索引 M3 建好 |

**反过来，这几件绝不能推到 M3.5**：`comments` 拆成 `topic + post`（推了 M4 要做数据迁移，产品文档第 1 号已批准决策就悬着）、`license` 全套字段 + `license_change_log`（版权争议随时可能来，法务证据链没有补录的可能）、`upload_intent` 核销（不做的话上线首日就有越权挂载他人对象的洞）、双桶（整桶 public 上线后再改要重传全部对象）、`resource.uploaderId` 的 `set null`（cascade 上线后误删一个用户就是不可逆的数据丢失）。