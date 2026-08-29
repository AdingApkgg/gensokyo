## M3 香霖堂设计评审：按严重程度排序的问题清单

我对照了 `/Users/i/Code/th/docs/product/2026-08-30-platform-direction.md`、仓库现状（`packages/db/src/schema/kourindou.ts` 1295 行已落盘、`packages/shared/src/kourindou/enums.ts` 已落盘、`apps/api/src/app.ts` / `app.test.ts` / `auth.ts`、`packages/api-client/src/index.ts`）和三份设计方案。**三份方案彼此不自洽的程度，比它们各自与产品文档的偏差更严重**——schema 方案已经写进仓库了，而 api 方案和 plan 方案是对着一个不再存在的仓库状态写的。

---

# P0 — 照着实施会直接编不过 / 上线即错 / 不可逆

### 1. 两份互斥的 `packages/shared/src/kourindou/enums.ts`

**问题**：文件已存在（8169 字节，19 组枚举，`import { z } from 'zod'`）。api 方案 §3.5 给出同一路径的**完整替代实现**，导出名、枚举值、依赖全部不同。plan 的 T1 还把它列为"新建"。

具体冲突（不是命名风格，是值）：

| 已落盘 | api 方案 | 后果 |
|---|---|---|
| `RESOURCE_STATUS` | `RESOURCE_STATUSES` | `kourindou.ts` 19 处 import 全断 |
| `CLAIM_STATUS = open\|reviewing\|approved\|rejected\|withdrawn` | `pending\|approved\|rejected\|withdrawn` | DDL 已生成 `WHERE status IN ('open','reviewing')` 的部分唯一索引；换成 api 的值后**谓词永远为假 → 社团认领防刷静默失效**，且插 `'open'` 直接报枚举值不存在 |
| `TAKEDOWN_STATUS = open\|...` | `pending\|...` | 同上 |
| `UPLOAD_STATE = ...\|aborted` | `...\|expired` | T7 GC 任务按 `expired` 写会永远扫不到行 |
| `UPLOAD_KIND = cover\|file` | `UPLOAD_PURPOSES = cover\|resource_file` | `upload_intent.kind` 列与 `presignUploadSchema.purpose` 字段名+值双重不匹配 |
| `TAG_KIND = format\|language\|content_warning\|freeform` | `origin\|event\|language\|misc` | api 把已独立成表的 `touhou_work` / `convention` 两个维度又塞回 tag |
| `CIRCLE_ROLE = ...\|other` | `...\|label` | |
| `TAKEDOWN_RELATION = ...\|rights_agent\|publisher\|other` | `...\|rights_holder\|agent\|other` | |

而 api 方案里 `USER_ROLES` / `TRUST_LEVELS` / `REVIEW_DECISIONS` / `REJECT_REASONS` / `MODERATION_ACTIONS` / `RESOURCE_SORTS` / `LICENSE_PERMISSIVENESS` / `LICENSE_REQUIRES_REVIEW` 在已落盘文件里**一个都没有**——而 `decideSubmit()`、`requireRole`、审核队列全部依赖它们。

**修法**：把已落盘的文件当基线（DDL 已按它验证过），只做 additive 补齐缺的 8 组常量；api 方案 §3.5 整节作废，改成"在现有 enums.ts 上追加"。同时 plan T1 的措辞从"新建"改成"补齐 + 迁移到 T2 之前重新验证 DDL"。

### 2. `packages/shared/src/index.ts` 会重复导出 → 硬编译错误

api 方案 §3.12 同时 `export * from './localized'` 和 `export * from './kourindou/enums'`。但 `localizedTextSchema`、`LocalizedText`、`resolveLocalized`、`Locale`、`LOCALES` **两个文件都导出**，语义还不同：

- 已落盘：`localizedTextSchema = z.partialRecord(...)`，允许 `{}`（与 `title jsonb NOT NULL DEFAULT '{}'` 一致）
- api 方案：`.refine(atLeastOne)`，**禁止 `{}`**
- 已落盘：`resolveLocalized(original, originalLocale, translations, requested)`，纯函数必有返回
- api 方案：`resolveLocalized(value, locale, original?)`，两者皆空时返回 `''`——**重新引入了 schema 方案专门论证要消灭的空标题**

**修法**：删掉 `packages/shared/src/localized.ts` 这个新文件，多语一律走 `kourindou/enums.ts`（或把它拆到 `localized.ts` 并从 enums 里删掉，但只能有一份）。

### 3. `idSchema = z.uuid()` 在至少四类 id 上是错的

**已实测**：better-auth 1.7.2 的 `generateId` 是 `createRandomStringGenerator("a-z","A-Z","0-9")(32)`（`node_modules/.bun/@better-auth+core@1.7.2*/node_modules/@better-auth/core/src/utils/id.ts:3`）——**32 位随机字母数字串，不是 UUID**。

失败场景：
- `listResourcesQuerySchema.uploaderId: idSchema` → `/resources?uploaderId=<真实用户id>` **对每一个真实用户都返回 400**
- `createReportSchema.targetId: idSchema` + `REPORT_TARGET` 含 `'user'` → **举报用户功能永远无法调用**
- `postAuthorSchema.id: idSchema` → 出参 schema 若被用于校验，每条帖子都炸
- `createResourceSchema.workIds/eventId: idSchema`，而 `touhou_work.id` = `'th06'`、`convention.id` = `'c105'`（`varchar(32)` slug）→ **上传时勾选任何原作或展会都 400**
- `attachFileSchema.intentId`、`coverIntentId` 是 `Bun.randomUUIDv7()` ✓ 唯一正确的一类

**修法**：拆三种 id schema：`entityIdSchema = z.uuid()`（uuidv7 业务实体）、`userIdSchema = z.string().min(1).max(64)`（better-auth 不透明串）、`slugIdSchema`（`th06`/`c105`/`game` 查找表）。`report.targetId` 因为是多态，只能用最宽的 `z.string().min(1).max(64)`，目标存在性交给应用层。

### 4. api 方案引用了 6 张不存在的表，其中一条端点根本无法实现

api / plan 反复引用：`moderation_log`、`license_change_log`、`storage_gc_queue`、`search_outbox`、`download_event`、`resource_type`、`event`、`thanks`、`user_profile`。实际落盘的是 `resource_audit_log`、`download_log`、`resource_category`、`convention`、`thank`，其余**三张完全不存在**。

最硬的一条：`DELETE /resources/:id`（admin）规格是"不物理删数据：写 moderation_log、置 `deleted_at`、把 B2 对象推进 `storage_gc_queue`"，返回 `{ deleted: true, objectsQueued: number }`。**`resource` 表没有 `deletedAt` 列**，`storage_gc_queue` 表不存在。而如果真的物理删，`resource → resource_version → resource_file` 是 cascade，持有 `s3Key` 的行同事务消失，**B2 对象变成永久不可达的孤儿**（正是设计文档批评 legacy 的那一条）。

另一条：`MODERATION_ACTIONS` 含 `trust_change`，`PATCH /moderation/users/:userId/trust`（admin）需要写审计——但 `resource_audit_log.resourceId` 是 `NOT NULL`，**信任等级人工干预、举报处理、认领审批、下架结案全都无处可写**。版权争议时"我们何时依据什么做的处置"只能覆盖资源自身的状态/许可两类事件。

**修法**：
- `resource` 加 `deletedAt timestamptz`，并把所有读路径的白名单加上 `deleted_at is null`
- 新建 `storage_object(id, bucket, key unique, sizeBytes, refCount/ownerKind, state, deleteAfter)` 一张表统管所有 B2 对象（封面、资源文件、社团头像），删除 = 置 `deleteAfter`，cron 消费。这同时解决问题 6 和 11
- 新建 `moderation_log(id, actorId, action, subjectType, subjectId, fromJson, toJson, reason, createdAt)` 作为**跨实体**审计，`resource_audit_log` 保留为资源专属时间线（或直接合并，把 `resourceId` 改可空 + 加 `subjectType/subjectId`）

### 5. `user_profile` 没建，但整条权限/信任链路都读它；`strikeCount` 全设计零写入点

`sessionMiddleware` → `loadActor` 要 join 它；`requireRole` / `requireTrust` / `decideSubmit` / 审核队列排序（`按 trustLevel↑ 排序`）/ `DAILY_UPLOAD_QUOTA` 全部依赖。schema 方案的"迁移注意事项 #4"把它列为待办，plan T2 列了，但 schema 方案的 24 张表里没有它——**这是 M3 第一天就要用的表，不是可选项**。

更具体的：`computeTrustLevel` 的 `strikeCount > 0 → 直接归零` 是整个信任梯度唯一的惩罚机制，但**设计里没有任何地方递增它**。T12 只说"审核结果落地时同事务更新 `approvedResourceCount`"。失败场景：一个 trustLevel=3 的账号被确认版权侵权、资源被下架，他的信任等级**纹丝不动**，下一个投稿继续即发即审。

**修法**：`user_profile` 进 T2（与 kourindou 表同一个 migration）；`strikeCount` 的递增点明确写死在两处——`reviewResource(decision='reject' && rejectReason ∈ {copyright_violation, illegal})` 和 `resolveTakedown(status='accepted')`——并在同事务重算 `trustLevelCache`。

### 6. 封面对象无法标记"已消费" → GC 任务会删光全站封面

`upload_intent.consumedByFileId` 只 references `resource_file.id`。但设计明确说"封面走公开桶，**不在这张表**"（`kourindou.ts:489`），封面存在 `resource.coverKey text`（裸列、无 FK、无唯一约束）。

于是：`kind='cover'` 的 intent **永远无法置为已消费**。而 plan T7 的 GC 任务规格是"扫 `state='uploaded'` 但从未被任何 file 引用的 intent（用户传了文件但没提交表单）→ 删对象 + 删行"。**第一次 GC 运行就会删掉所有已发布资源的封面**，且这些 B2 对象删完不可恢复。

同类问题：`circle.avatarKey`、`resourceCategory.iconKey` 也是裸 key。

**修法**：同 #4 的 `storage_object` 表；或最低限度给 `resource` 加 `coverIntentId` 唯一 FK，并把 GC 谓词改成白名单（"被任何已知引用表引用"逐个列举），**不要用取反的黑名单**——这和下载路径"绝不写 `!== 'takedown'`"是同一条纪律。

---

# P1 — 安全与数据正确性

### 7. 预签名 PUT 没有真实的大小强制 → 任意 level-0 账号可做存储成本 DoS

设计说"`declaredSize` 在 presign 时校验 + `HeadObject` 回填时二次拒绝超限"。**第二道检查发生在字节已经落盘并开始计费之后**。B2 的预签名 PUT 不校验 `Content-Length`（除非签进 `content-length-range` 策略，S3 POST policy 才有，PUT 需要把 `Content-Length` 列入 SignedHeaders）。

失败场景：新账号，`rateLimit({key:'upload:presign', limit:120, windowSec:3600})`，每次声明 1 字节封面，实际 PUT 5 GiB → **每小时 600 GB**，24 小时后 GC 才清理。`upload_intent` 表没有任何"同一用户未完成 intent 数量上限"的约束。

**修法**：三层，缺一不可——① presign 时把 `Content-Length` 签进 SignedHeaders（并实测 B2 是否拒绝不匹配的请求，不匹配就承认这层无效）；② `upload_intent` 加 partial unique/计数约束或在 service 里查 `count(*) where userId=? and state='pending'` 上限（按 trustLevel 分档，比如 3/8/20）；③ **B2 staging 前缀配 lifecycle 规则自动删 >24h 对象**——这是唯一不依赖我们的 cron 活着的一层。

### 8. 版本 / 评论 / 文件端点缺状态白名单（IDOR）

`GET /resources/:slug/versions`（public，无状态判定）、`GET /resources/:slug/comments`（public，无状态判定）。只有 `GET /resources/:slug` 和 `GET /files/:fileId/download` 走了 `canViewResource`。

失败场景：一个因版权被 `delisted` 的资源，其 slug 仍在搜索引擎缓存/外链里；`/resources/<slug>/versions` 返回完整版本与文件元数据（文件名、大小、外链镜像 URL——**外链 URL 本身就是一个可用的下载地址**），`/comments` 保留公开可读的讨论页。下架等于没下架。同理 `pending` 资源的文件清单可被 slug 枚举。

**修法**：把 `canViewResource` 提成一个 `loadVisibleResource(slugOrId, actor)` 服务函数，**所有**资源作用域的读端点第一行都调它，而不是逐路由自觉。

### 9. 下架申请通道：token 走 query string，且表缺三个必需列，匿名端点零防刷

- `GET /takedowns/:id?token=` 把凭证放在 URL 查询串里——会进反向代理与 CDN 访问日志、进 Referer；而这个 token 同时是 `POST /takedowns/:id/withdraw` 的授权凭证
- `takedown_request` 表**没有 `trackingTokenHash` 列** → §2.9 的两条查询/撤回端点无法实现
- 表**没有 `locale` 列**，而 `createTakedownSchema.locale` 收了它（回执与状态通知语种）——产品文档把 ja 界面列为这条通道可用的前提，语种记不下来等于白做
- `evidenceUrl text NOT NULL` 单值 vs schema 收 `evidenceUrls: array().min(1).max(10)`
- 没有 `requesterIpHash`，没有 `acknowledgeTruthful` 的落盘（法律性声明只在内存里过了一遍），**没有任何防刷约束**（对比 `report` 和 `circle_claim` 都有 partial unique）

失败场景：`POST /takedowns` 是 public + Turnstile，`resourceId` 任意；配合 `resolveTakedownSchema.delistResource`，攻击者批量提交下架请求淹没审核队列 / 制造对竞品资源的下架压力。solo 运营下这是最省力的骚扰面。

**修法**：token 改 `Authorization: Bearer` 或 POST body；表补 `trackingTokenHash char(64) unique` / `locale` / `evidenceUrls jsonb` / `requesterIpHash` / `acknowledgedAt`；加 `UNIQUE (resource_id, contact_email) WHERE status IN ('open','reviewing')` + 按 IP 的限流。另：**M3 没有任何邮件发送能力**（`.env.example` 无 SMTP/Resend，plan 无对应任务），所以"邮件抄送 contactEmail"这条要么补一个任务，要么明确 M3 只发页面上的 token 并接受用户关掉标签页就丢失。

### 10. 签名下载 URL 无 TTL 约定、不绑定请求者

`GET /files/:fileId/download` 返回 `{ url, expiresAt | null }`。`expiresAt` 可为 null 意味着规格允许无限期。签名 URL 一旦签出可被任意转发，"私有桶 + 签名 URL"的强度完全等于 TTL。

**修法**：TTL 定死（60–300s）写进 `packages/shared` 常量并在前端立即触发下载；同时承认**下载计数是上界不是测量**，别在产品文案里说"下载次数"。

### 11. `uploadIntent.consumedByFileId onDelete: 'set null'` 制造对象 GC 竞态

删一条 `resource_file` → intent 的消费标记被清空 → intent 回到"`state='uploaded'` 且未被引用"状态 → GC 判定为孤儿删掉 B2 对象。但 intent 行还在、还能被重新 attach（`state='uploaded'` 是 attach 的唯一条件）→ **得到一条指向已删除对象的 file 行**。反过来，删 file **从不删 B2 对象**（无 GC 队列，见 #4/#6）。

**修法**：`onDelete: 'no action'`（保留历史指向）；对象生命周期交给 `storage_object` 表，file 删除时置 `deleteAfter`。

### 12. `report_open_uq` 的防刷依赖 `reporterId` 非空，而该列可空

`uniqueIndex('report_open_uq').on(targetType, targetId, reporterId).where(status in ('open','reviewing'))` + `reporterId ... onDelete: 'set null'`，且列本身 nullable、表还有 `reporterIpHash`（暗示曾考虑匿名举报）。PG 里 NULL 互不相等 → **任何 `reporterId IS NULL` 的举报可无限重复**。api 方案说取消匿名举报，schema 却留着入口。

**修法**：要么加 `CHECK (status NOT IN ('open','reviewing') OR reporter_id IS NOT NULL)`，要么把防刷键改成 `COALESCE(reporter_id, reporter_ip_hash)` 的表达式唯一索引。并在注释里写明 nullable 只为"用户注销后保留举报"。

### 13. staff 通过 `requireOwnerOrStaff` 拿到了内容编辑权，与 §5 自己的声明矛盾

§5 明确写"staff 只能改状态/许可/标签，改不了标题"，`policy.ts` 定义了 `canEditContent(subject, actor) = actor.id === ownerId || actor.role === 'admin'`。但 §4.7 的 `PATCH /:id` 路由链是 `requireAuth, owner, validate, handler`，handler 直接 `service.updateResource(subject, actor, input)`——**`canEditContent` 从未被调用**，moderator 可以改任何人的标题。示例代码就是实施者会照抄的东西。

**修法**：把 `canEditContent` 的断言放进 `updateResource` service 的第一行（service 层而非路由层，这样 cron/脚本也绕不过），并给它一个错误码。

### 14. 列表页缓存头缺 `Vary` → CDN 串味

`c.header('cache-control', actor ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=300')`。响应内容同时依赖 cookie（是否登录）和语种（`?locale=` 或 `Accept-Language`），但没有 `Vary`。一旦挂 CDN，第一个匿名 zh 请求的响应会被喂给 ja 用户，或者反过来 `private` 的判定在边缘失效。

**修法**：`Vary: Cookie, Accept-Language` 必须与 `Cache-Control` 同处设置，最好包在一个 `publicCache(c)` 助手里（api 方案已规划 `http/cache.ts`，把 Vary 写进去）。

### 15. `ratingSum` 的增量算法没有定义，而 CHECK 会把算错变成事务失败

`INSERT ... ON CONFLICT (resource_id,user_id) DO UPDATE ... RETURNING` 拿到的是**新值**，算 `resource.ratingSum` 的 delta 需要**旧分数**。`RETURNING` 给不了。而 `CHECK (rating_sum >= rating_count AND rating_sum <= rating_count * 5)` 意味着算错时不是悄悄脏数据，而是**整个评分请求 500**。取消评分（`DELETE /rating`）同理必须同一条语句里减两个计数（迁移注意事项 #6 只说了增，没说减）。

**修法**：把唯一正确写法写进设计（否则每个实施者会各自发明一个）：

```sql
WITH prev AS (SELECT score FROM rating WHERE resource_id=$1 AND user_id=$2),
     up AS (INSERT INTO rating(resource_id,user_id,score) VALUES($1,$2,$3)
            ON CONFLICT (resource_id,user_id) DO UPDATE SET score=EXCLUDED.score
            RETURNING score)
UPDATE resource SET rating_sum = rating_sum + (SELECT score FROM up) - COALESCE((SELECT score FROM prev),0),
                    rating_count = rating_count + (CASE WHEN EXISTS(SELECT 1 FROM prev) THEN 0 ELSE 1 END)
WHERE id=$1 RETURNING rating_sum, rating_count;
```

另：所有 partial unique index 上的 `ON CONFLICT` **必须把索引谓词一起写出来**（`ON CONFLICT (file_id, ip_hash, day_bucket) WHERE file_id IS NOT NULL DO NOTHING`），否则 PG 报 `no unique or exclusion constraint matching the ON CONFLICT specification`。这条适用于 `download_log_dedupe_uq`、`report_open_uq`、`circle_claim_open_uq`、`resource_version_latest_uq`、`resource_file_s3Key_uq`——五处，一处都别漏，设计里一处都没写。

### 16. 用户删除后所有冗余计数静默失真，而对账脚本只是"建议"

`rating` / `favorite` / `thank` 的 `userId` 是 `cascade`，但 `resource.ratingSum` / `ratingCount` / `favoriteCount` / `thankCount` / `circle.resourceCount` / `tag.usageCount` **没有触发器**。删一个刷分小号，明细行没了、计数不动 → 排行榜永久偏移，且 `CHECK` 抓不到（两个计数都停在旧值，不变式仍成立）。

**修法**：`scripts/reconcile-counters.ts` 从"建议"升级为 plan 的一个正式 Task + 一条 cron，并且**在用户删除路径上同事务做一次针对性回收**（`DELETE FROM rating ... RETURNING` 后按 resourceId 聚合回写）。`circle.resourceCount` 还要注意 `resource_circle` 主键是 `(resourceId, circleId, role)`——同一社团既是 `circle` 又是 `translator` 时会被计两次，对账必须 `COUNT(DISTINCT resource_id)`。

### 17. 唯一/外键违约没有错误码映射 → 最常见的用户错误全变 500

`API_ERROR_STATUS` 有 40 个码，但下面这些必然发生的约束违约一个都没覆盖：`resource_version_resourceId_label_uq`（重复版本号）、`resource_file_s3Key_uq`（对象被认领两次）、`upload_intent.consumedByFileId unique`（intent 重复消费）、`circle.slug unique` / `resource.slug unique`、`categoryId` FK restrict（分类 slug 打错）、`workIds`/`tagIds`/`conventionId` FK。api 设计从不做存在性预检（`typeSlug` 只有正则校验），所以**上传时选了一个不存在的分类 = 500 internal_error**，而不是一条可翻译的 400。

**修法**：schema 已经给每一条约束起了名字——利用它。写一个 PG 错误映射：`err.code === '23505' → CONSTRAINT_ERROR_MAP[err.constraint_name]`、`'23503' → FK_ERROR_MAP[...]`，放在 `apps/api/src/http/error.ts`，用 `satisfies Record<string, ApiErrorCode>` 保证新加约束时被提醒。这比逐路由预检既省往返又不会漏。

---

# P2 — 产品承诺落空与架构债

### 18. 许可默认 `unspecified` + 强制回审 = 先发后审在多数情况下名存实亡

`decideSubmit` 的四个回审信号里，`LICENSE_REQUIRES_REVIEW = ['unspecified', 'authorized_repost']`，而 `resource.licenseStatus` 的默认值就是 `unspecified`，`createResourceSchema` 也 `.default('unspecified')`。现实里绝大多数投稿者不知道社团的分发条款，会保留默认值 → **无论信任等级多高，几乎每一条投稿都进人工队列**。

这直接打在生死线 2（低运营成本）上：产品文档说"通过 N 个后即发即审"，设计把它改成了"通过 N 个后**且许可已标明**才即发即审"。方案把这条当成优点写（"把版权生死线写进代码"），没有注意它抵消了先发后审机制本身。

**修法**：把 `unspecified` 从**阻断**降级为**抽查 + 显式徽章**：trust≥2 + `unspecified` → 直接 `published`，但强制显示"分发许可未标明"徽章、进 `spotCheck` 队列、且下架申请对它走加速通道。真正阻断的只保留 `authorized_repost`（声称有授权 = 有具体主张要核实）。同时在 plan 里加一条验收：按预估投稿量算出每日人工审核条数，超过 solo 可承受量（比如 20/天）就说明门槛设错了。

### 19. 多维标签的三个维度都有缺陷

产品文档承诺"类型 × 原作 × 展会 多维"：

- **展会是单值 FK**（`resource.conventionId`）。一本在 C104 首发、例大祭 21 再版的同人志表达不了；`?event=c105,c104` 这个 CSV 筛选**永远只能命中一个值**。注释说"再版走 version.releasedAt"，但 `resource_version` **也没有 conventionId**。
- **`tag.slug` 不是全局唯一**（`uniqueIndex('tag_kind_slug_uq').on(kind, slug)`），而 `listResourcesQuerySchema.tag` 是 `csvSlug` → `?tag=touhou` 歧义。
- **`workIds` / `eventId` 类型不匹配**（见 #3）。

**修法**：展会改 `resource_convention(resourceId, conventionId, isPrimary)` M2M，或给 `resource_version` 加 `conventionId`（后者更准确：版本才对应发行批次）；tag 查询参数改 `kind:slug` 形式或让 slug 全局唯一。

### 20. Meilisearch 同步机制自相矛盾，且下载会触发索引写放大

`resource.searchIndexedAt` 的注释是"**NULL 或早于 updatedAt** 即待重建索引"，但索引是 `index('resource_searchPending_idx').on(updatedAt).where(sql\`search_indexed_at is null\`)`。谓词只覆盖 NULL：

- 按注释的语义查询（`search_indexed_at IS NULL OR search_indexed_at < updated_at`）**用不上这个索引** → 每轮轮询全表扫
- 按索引的语义查询（只查 NULL）→ 首次索引后再也不会重建 → **编辑资源、改状态、下架，搜索结果永远是旧的**

而且 drizzle 的 `$onUpdate` 对**每一次 `db.update(resource)`** 生效，包括 `downloadCount + 1` → 每次下载都会 bump `updatedAt`。若把谓词修成注释的语义，**下载量越大，Meili 重建索引的写放大越大**。

另外 plan T15 / api §落地顺序 6 说用 `search_outbox` 表，schema 用水位列——**两套机制并存**。而水位列表达不了"资源被硬删 → 要从索引里删文档"（行没了，水位也没了）和"社团改名 → 波及其全部资源"。

**修法**：选 outbox（api/plan 的方案是对的），删掉 `searchIndexedAt` 与它的索引；outbox 行在写事务里插，worker 消费，`op ∈ {upsert, delete}`。若坚持水位列，至少把计数器从 `resource` 主行拆走（比如 `resource_stats` 侧表），否则下载和搜索索引永远耦合。

### 21. "推迟 Meilisearch"的兜底方案在已落盘 schema 里不存在，拼音搜索被静默砍掉

plan 的 M3.5 推迟清单说"列表页用 pg 的多维 filter + `title jsonb` 上的 GIN/trigram 索引兜底够用"。实际：`kourindou.ts` 的 91 个索引里**没有任何 `title` / `titleOriginal` 上的 GIN 或 trigram 索引**，`pg_trgm` 扩展没有任何地方创建。唯一的 GIN 是 `circle_aliases_idx`（`text[]` 上的数组包含索引，做不了前缀/模糊补全，且没有任何设计中的查询用它——是条死索引）。

更重要：**产品文档明确写"Meilisearch 中文+拼音搜索"**，拼音在 pg 里没有扩展根本做不了。所以"Meili 可推迟"这个判断成立的前提是**接受 M3 上线时没有搜索**（只有筛选）。

**修法**：要么承认 T15 是最小闭环的一部分（我倾向这个——资源站没有搜索等于没上线），要么在 T2 的 migration 里加 `CREATE EXTENSION pg_trgm` + `titleOriginal` 的 GIN trgm 索引，并在 plan 里白纸黑字写"M3 上线不含拼音搜索"。

### 22. M4 论坛整合的预留：楼层和引用可以，@提及和通知不行

评审问题问的是"能否承载楼层、引用、@提及"。楼层 ✓（`floorNo` + `(topicId, floorNo)` 唯一），引用 ✓（自引用 FK）。**@提及不行**，三个原因：

1. **没有可寻址的用户 handle**。`user.name` 在 `auth.ts` 里只是 `text NOT NULL`，**只有 email 唯一**。`@东风谷早苗` 无法唯一解析。等 M4 再加 `username unique` 就要给存量用户回填 + 处理重名冲突 + 改 better-auth 注册流程——这和"评论必须从第一天就是 topic+post"是同一类"改一次要迁数据"的决策，但它没有出现在"绝不能推到 M3.5"的清单里。
2. **没有 `post_mention` 表**，通知扇出只能全表 `LIKE '%@name%'`。
3. `replyToPostId` 是**无约束的自引用**——可以引用另一个 topic 的楼层。plan T11 的验收里写了"跨 topic 的 replyToPostId 被拒"，但 schema 里没有任何东西拒绝它。

另外两处：`post` 没有 `lastEditedById`（§2.6 允许 staff 编辑他人楼层，无痕迹，论坛里这是信任事故）；一条 post 在 M4 会有两个 canonical URL（`/kourindou/:slug#floor-N` 和 `/shrine/topics/:id`），通知链接和 SEO 要现在定死一个。

**修法**：M3 就加 `user_profile.username varchar(32) unique`（注册时生成，可改一次）；`post_mention(postId, userId)` 表 M3 建好（M3 不用，M4 直接用）；`replyToPostId` 改复合外键 `(topicId, replyToPostId) → (topicId, id)`（需要 `post` 上加 `unique(topic_id, id)` 支撑），这是唯一能在 DB 层保证的方式；加 `lastEditedById`。

### 23. `topic.postCount` 背了两个互斥的语义

它同时是"楼层号发号器"（`floorNo = postCount + 1`，必须单调不减）和"评论数"（`GET /comments` 返回 `postCount` 给 UI）。而 post 是软删的。第一次有人抱怨"删了评论数字不变"，就会有人给 delete 加一句 `postCount - 1` → **下一条新楼撞上已存在的 floorNo，被唯一索引挡下，正常的审核操作变成 500**。

**修法**：拆成 `nextFloorNo`（单调）和 `visiblePostCount`（可增可减）两列。现在拆是改两行，M4 论坛上线后拆是数据迁移。

### 24. draft 流程与 `status` 默认值、slug、pending 队列三处不一致

- `resource.status` 默认 `'pending'`，但 `POST /resources` 规格返回 `status='draft'`
- `slug` 是 `NOT NULL UNIQUE`，创建时（= 草稿阶段）就要生成 → **废弃草稿永久占用好 slug**，而且 slug 从一个用户在第②步还会改的标题派生
- `resource_pending_idx` 按 `submittedAt` 排序，但 `submittedAt` 可空且默认 status 就是 `pending` → **默认插入的行会以 NULL 排序键待在审核队列里**
- 没有任何机制回收废弃草稿（连带占着封面对象和已消费的 intent）

**修法**：默认改 `'draft'`；加 `CHECK (status <> 'pending' OR submitted_at IS NOT NULL)` 和 `CHECK (status <> 'delisted' OR delisted_at IS NOT NULL)`；slug 在 `submit` 时才最终确定（草稿期允许 NULL 或用 id 占位）；草稿 GC 进 T7。

### 25. 社团认领是单人单列，且认领证据会被用户注销抹掉

`circle.claimedByUserId` 单列 + `circle_claim.claimantId onDelete: 'cascade'`。失败场景：

- 真社团有多个成员，第二个成员来认领 → 批准即**静默覆盖**第一个，无记录、无争议通道
- 冒名者先认领 → 拿到 `PATCH /circles/:id` 和社团页管理权，成为事实上的"可信联系人"
- 认领人注销 → `circle_claim` 行 cascade 删除（**批准证据消失**），`circle.claimedByUserId` set null（社团变未认领，无痕迹）——与全设计"治理记录在用户删除后必须保留"的原则直接冲突

**修法**：`circle_claim.claimantId` 改 `set null`（与 `report.reporterId` 一致）；认领关系改 `circle_member(circleId, userId, role, approvedAt, approvedByClaimId)` 表，`circle.claimedByUserId` 降级为冗余缓存或删掉。

### 26. 路由规格里有两条路径拼错，且 slug/id 在同一 URL 空间混用

- §2.4 表里 `GET /kourindou/me/uploads` 写在 `uploads` 路由器（挂载前缀 `/uploads`）内 → 实际 URL 变成 `/api/kourindou/uploads/kourindou/me/uploads`。§2.7 的 `GET /kourindou/me/reports` 同样问题。这两条应该在 §2.11 的 `mine` 路由器里。
- `GET /resources/:slug` 与 `PATCH /resources/:id`、`POST /resources/:id/submit`、`GET /resources/:slug/versions`、`POST /resources/:id/comments` **在同一前缀下混用 slug 和 id**。方法不同不会路由冲突，但缓存键、前端 link 生成、`resourceId → topicId` 解析全都要判断"手上这个字符串是哪一种"。
- `GET /resources/:slug/comments`（slug）和 `POST /resources/:id/comments`（id）是**同一个资源的读写却用两种寻址**。

**修法**：定一条规则——公开读路径用 slug，所有写/管理路径用 id，且在 URL 里显式区分（`/resources/:slug` vs `/resources/id/:id/...`），或者干脆全用 id + 一个 `GET /resources/by-slug/:slug` 解析端点。

### 27. 现有测试会被破坏，且两份文档在分页策略上直接打架

`apps/api/src/app.test.ts:12` 是 `expect(await res.json()).toEqual({ items: [], page: 1, pageSize: 20 })`——**`toEqual` 严格比对**。api 方案一边承诺"`paginationQuerySchema` 保留不动（`app.test.ts` 依赖它）"，一边把列表响应定义成 `{ items, page, pageSize, total, facets? }`。加 `total` 就红。

同时：api 方案说资源列表用 offset（"有页码选择器、需要 total 和 facet"），plan T8 说"**游标分页（`createdAt + id` 复合游标）替代 offset**"。两份文档对同一个端点给了相反的规格。

**修法**：明确选 offset（列表页要页码和 total，Meili 也是 offset 语义），plan T8 改掉；并在 plan 里把"更新 `app.test.ts`"写成 T8 的一个显式步骤，而不是让实施者自己发现。

### 28. `env.ts` 启动即失败 与 `bun test` 冲突；Redis 限流无实现也无测试替身

plan T3 要求 `apps/api/src/env.ts` 在导入时校验全部环境变量并"进程立刻退出"，验收项之一就是"故意删一个 env 变量 → 立刻退出"。但同一个 T3 的另一条验收是"跑一遍现有 `app.test.ts`"——`app.test.ts` 导入 `app.ts` → 导入模块链 → 导入 `env.ts`。**测试环境必须提供 B2 / Turnstile / Meili 的全部真实变量，否则整个测试套件在 import 阶段就崩**。

另：`middleware/rate-limit.ts` 在 api 方案里只有调用签名 `rateLimit({ key, limit, windowSec })`，没有 Redis 客户端选型、没有 key 的维度参数（匿名下载要按 IP，presign 要按 userId，签名里体现不出来），没有测试环境的内存实现。`turbo.json` 的 `globalPassThroughEnv` 也还没有 `B2_*` / `TURNSTILE_*`。

**修法**：env 分必需/可选两组，可选子系统（B2/Meili/Turnstile/Redis）用惰性校验 + 显式 `disabled` 模式；`rateLimit` 签名加 `by: 'ip' | 'user' | 'ip+user'`；`.env.test` 进仓库；Turnstile 用官方 always-pass 测试密钥。

### 29. 迁移策略两份文档相反

schema 方案"迁移注意事项 #1"：`rm -rf packages/db/drizzle/* && generate && migrate`（重生成 0000）。plan 的全局约定 1：**走增量 0001**。仓库里 `packages/db/drizzle/0000_unusual_rage.sql` + `meta/_journal.json` 已存在并已应用过。

重生成 0000 会让任何已经跑过 M2 迁移的环境（包括开发者本机）的 journal 与文件哈希对不上，`drizzle-kit migrate` 行为不可预期。`auth.ts` 改 timestamptz 在增量路径下是一条正常的 `ALTER COLUMN ... TYPE timestamptz`。

**修法**：走增量 0001（plan 是对的），schema 方案的注意事项 #1 作废。并在 CLAUDE.md 记一条"better-auth CLI 再生成 auth.ts 后需重新打 timestamptz 补丁"。

### 30. 三个次级但会积累的点

- **`packages/db` 现在依赖 `@gensokyo/shared`**（已实测 `grep -c` = 1），违反了 api 方案自己列的包边界"db 只依赖 drizzle / enums 零 zod 依赖"——实际的 `enums.ts` 第 1 行就是 `import { z } from 'zod'`。更麻烦的是 api 方案 §3.12 的 `import './validation'` 是**副作用导入**（全局 `z.config`）：一旦 barrel 被 drizzle-kit、seed 脚本或任何第三方拉起，全局 zod 行为就被改了，且**错误消息取决于导入顺序**。改成显式 `configureValidation()` 在 `apps/api/src/index.ts` 调一次。
- **`bigserial` + "为将来按时间分区留路"是自相矛盾的**：分区表的主键必须包含分区键。`download_log` / `resource_audit_log` 现在的 PK 是 `id` 单列，将来按 `created_at` 分区需要重建表。现在就改成 `PRIMARY KEY (created_at, id)` 是零成本。
- **i18n 的机械保证不够**：plan T22 的 `check-messages.ts` 只断言三份 json 的 key 集合相等——它抓不到"shared 里新增了一个 `REJECT_REASONS` 值但没加对应文案"。既然所有枚举元组都是导出的 `as const`，应该再加一个测试：遍历 `REJECT_REASONS` / `REPORT_KINDS` / `RESOURCE_STATUS` / `LICENSE_STATUS` / `TAKEDOWN_RELATION` …，断言 `zh.json` 里存在 `kourindou_enum_<name>_<value>` 键。这才是"enum 展示名一律走 message"这条规则的强制点。
- **`hasUntrustedMirror` 没有数据来源**：`decideSubmit` 依赖它，但设计里没有镜像宿主允许清单（常量或表），`resource_file.externalHost` 只是个记录列。而 `decideSubmit` 放进 `packages/shared` 的**全部理由**就是"前端能在提交前如实预测"——前端算不出 `hasUntrustedMirror`，预测就会与后端不一致，那个理由自我拆台。加一个 `MIRROR_HOST_ALLOWLIST` 常量到 shared。
- **`titleOriginalLocale` 前端从不采集**：列是 `NOT NULL DEFAULT 'ja'`，`createResourceSchema` 只收 `titleOriginal` 不收它的语种。一个中文汉化组的原名是中文，会被记成 `ja` → `resolveLocalized` 把中文字符串放进 ja 槽位，**ja 界面永久显示中文且回退链失效**。上传向导第②步必须收这个字段（默认 ja，可改）。

---

## 一句话总结

三份方案里，**schema 方案是唯一已落盘并验证过的**，api 与 plan 两份是对着旧仓库状态写的，彼此在枚举名、枚举值、表名、id 类型、分页策略、迁移策略、多语工具函数七处直接冲突——**照现状实施第一天就编不过**。真正的安全洞集中在三处：预签名上传没有生效的大小闸门（#7）、版本/评论/文件读端点漏掉状态白名单（#8）、封面对象无消费账本会被 GC 删光（#6）。产品承诺里被静默削弱的是三条：先发后审被许可默认值抵消（#18）、拼音搜索随 T15 一起被推迟（#21）、@提及在 M4 缺一个唯一 handle（#22）——最后这条属于"改一次要迁数据"，应该和 topic+post 一样进 M3 的不可推迟清单。