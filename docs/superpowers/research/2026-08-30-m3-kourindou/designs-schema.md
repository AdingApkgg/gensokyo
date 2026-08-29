已写入并逐项验证。**验证方式**：`bunx drizzle-kit generate` 生成 DDL → 在本机 PostgreSQL 18.6 建临时库 `kourindou_probe` 实际执行 → **158/158 语句全部成功**（28 表 / 18 CHECK / 55 外键 / 91 索引）→ 再跑 16 条行为断言（越界评分、重复评分、双 latest 版本、判别联合违规、重复未决举报、孤儿引用、删用户保留资源…）**全部按预期拦截或通过** → 临时库已删除。`bun run typecheck` 全 workspace 6 包通过，biome 已格式化。

## 产出文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `/Users/i/Code/th/packages/db/src/schema/kourindou.ts` | 1295 | 24 张表 + 19 个 pgEnum + 全部 relations + $inferSelect 类型 |
| `/Users/i/Code/th/packages/shared/src/kourindou/enums.ts` | 251 | 枚举值元组唯一真源，同时喂 `pgEnum` / `z.enum` / 未来 OpenAPI；含 `LocalizedText` 与 `resolveLocalized()` |
| `/Users/i/Code/th/packages/shared/src/kourindou/index.ts` | 1 | barrel |
| 改动 | — | `packages/shared/package.json` 加 `"./kourindou"` 子路径导出；`packages/db/package.json` 加 `@gensokyo/shared: workspace:*`；`packages/db/src/schema/index.ts` 加 `export * from './kourindou'` |

⚠️ **并发提醒**：任务期间上述 `packages/shared` 新文件与两个 package.json 改动被仓库里的并行进程**清除过两次**（`git checkout` 类操作），我重建后已确认存活。合并前请再 `grep -c "gensokyo/shared" packages/db/package.json` 确认为 1。

## 表清单（24 张）

```
分类/维度   resource_category  convention  touhou_work  tag
社团        circle  circle_claim
资源        resource  resource_translation
版本/文件   resource_version  resource_file  upload_intent
内容系统    topic  post                        ← M3/M4 同一份数据
关联        resource_circle  resource_work  resource_tag
互动        rating  favorite  thank  download_log  resource_download_daily
治理        report  takedown_request  resource_audit_log
```

---

## 3. 多语方案：**原文列 + 译名 jsonb（短字段） / 侧表（长字段）** 混合

```ts
// resource
titleOriginal:       text('title_original').notNull(),          // 社团封面上的原名，永不翻译、永不为空
titleOriginalLocale: localeEnum('title_original_locale').notNull().default('ja'),
title:               jsonb('title').$type<LocalizedText>().notNull().default({}),  // 只装译名
// 长文另开侧表
resource_translation(resourceId, locale) PK → descriptionMd + source + contributedById
```

**为什么不是纯 jsonb**：UGC 现实是绝大多数投稿只有一种语言。纯 `{zh?,ja?,en?}` 会让「显示什么」变成一个到处判空的回退函数，且没有任何一列保证非空。加一个 `titleOriginal NOT NULL` + `titleOriginalLocale` 后，`resolveLocalized()` 是**纯函数且必有返回值**，调用方零判空——同时原文语义上是「作品的事实」而不是「一条翻译」，永远不该被别的语言覆盖掉。

**为什么不是纯翻译侧表**：标题/社团名在列表页**永远整体读取**。侧表意味着每次列表都要 `LEFT JOIN ... AND locale = $1` 再回退第二次查询；`titleOriginalLocale` + jsonb 一次读出，Meilisearch 建索引时展平成 `title_zh / title_ja / title_en` 也最省事。drizzle 侧 `$type<LocalizedText>()` 给出 `Partial<Record<'zh'|'ja'|'en', string>>`，类型友好度也优于 join 出来的数组。

**为什么长文反过来用侧表**：`descriptionMd` / 社团简介需要**按语种独立贡献、独立审核、独立回滚**，还要记 `source: original|uploader|community|machine` 与贡献者。塞进 jsonb 会让主表行膨胀（列表查询把用不到的两语长文一起拖出来），且无法做 per-locale 权限。`changelogMd` 只加了 `changelogLocale` 标注语种，暂不开侧表——更新日志的社区翻译需求极低，需要时再加 `resource_version_translation` 是纯 additive。

**第三种规制**：`resource_category.name` 是**编辑向**文案（5~10 行 seed 数据），类型是 `Record<Locale,string>` 三语必填，用 `completeLocalizedTextSchema` 校验——和 UGC 的部分填充明确区分开。

---

## 4. M4 论坛整合：**统一 topic + post，带判别列的可空真外键**

```ts
topic {
  kind: topicKindEnum,                       // 'resource' | 'forum'
  resourceId: text().unique().references(() => resource.id, { onDelete: 'cascade' }),
  title: text(),                             // forum 必填；resource 为空（标题从 resource 派生）
  postCount, lastPostedAt, lastPostById, isLocked, pinnedAt
}
CHECK topic_target_ck:
  (kind='resource' AND resource_id IS NOT NULL AND title IS NULL)
  OR (kind='forum' AND resource_id IS NULL AND title IS NOT NULL)

post { topicId, floorNo, authorId, bodyMd, replyToPostId(自引用FK set null), status, deletedAt, editedAt }
UNIQUE (topicId, floorNo)
```

**为什么不用 `(subjectType, subjectId)` 无类型多态**：那样 `resourceId` 就没法建外键，级联、`with: { topic: true }`、完整性全部失效——正是 legacy `comments.parentId` 裸 integer 的同一个错误。用「判别列 + 可空真外键 + CHECK」把多态收进类型系统里，PG 的 nullable UNIQUE 把 NULL 视为互不相同，所以论坛主题可以有任意多条 `resource_id IS NULL` 的行。已实测：`kind='forum'` 带 resourceId 被 CHECK 拦、第二个 topic 挂同一资源被 unique 拦。

**为什么 topic 指向 resource 而不是反过来**：`resource.topicId NOT NULL` 会强制 topic 先插，制造插入顺序体操；反向则是自然的 resource → topic 同事务两插，且不产生循环外键。

**M4 的增量是纯 additive**：`ALTER TABLE topic ADD COLUMN board_id text REFERENCES board(id)` + 重建那条 CHECK（放宽 forum 分支要求 `board_id IS NOT NULL`）。**不动数据、不迁移评论**。M3 的「资源评论」在 API 层就是 post 的一个视图。

**为什么是扁平楼层而非递归树**：产品文档的心智是 NGA/贴吧「版块 → 主题 → 楼层 + 引用」。`floorNo` 扁平 + `replyToPostId` 引用让分页、通知、@提及全部退化成简单查询；`deletedAt` 软删而非物理删，否则楼层号断裂。楼层号发号器就是 `topic.postCount`：同事务 `UPDATE topic SET post_count = post_count + 1 ... RETURNING post_count` 拿行锁再插 post。

---

## 5. 关键约束（全部实测生效）

| 约束 | 表达 |
|---|---|
| 一人一资源一评分 | `rating` 复合主键 `(resourceId, userId)`，无代理键。`favorite` / `thank` 同 |
| 评分 1–5 | `CHECK score BETWEEN 1 AND 5` —— **zod 校 API 边界，DB 校数据不变式，两层都要** |
| 冗余计数不被写坏 | `CHECK rating_sum >= rating_count AND rating_sum <= rating_count * 5`（越界立刻炸，而不是悄悄污染排行榜） |
| slug 全局唯一 | `resource.slug` / `circle.slug` 列级 unique |
| 每资源一个当前版本 | `CREATE UNIQUE INDEX ON resource_version(resource_id) WHERE is_latest`（比 `resource.currentVersionId` 循环外键干净） |
| B2 / 外链二选一 | `CHECK (storage_kind='b2' AND s3_key IS NOT NULL AND external_url IS NULL) OR (storage_kind='external' AND ...)` |
| 一个 B2 对象只被一条 file 认领 | `UNIQUE INDEX ON resource_file(s3_key) WHERE s3_key IS NOT NULL` |
| 举报防刷 | `UNIQUE (target_type, target_id, reporter_id) WHERE status IN ('open','reviewing')`——处理完可再报（已实测） |
| 社团认领防刷 | `UNIQUE (circle_id, claimant_id) WHERE status IN ('open','reviewing')` |
| 下载不可灌水 | `UNIQUE (file_id, ip_hash, day_bucket) WHERE file_id IS NOT NULL` |
| 已发布必有发布时间 | `CHECK status <> 'published' OR published_at IS NOT NULL` |
| 审计载荷完整 | `CHECK (event<>'status_change' OR to_status IS NOT NULL) AND (event<>'license_change' OR to_license IS NOT NULL)` |

**索引补全**（legacy 缺的全部补上）：`resource(uploaderId, createdAt)`、`resource(licenseStatus)`、`resource(submittedAt) WHERE status='pending'`（审核队列不再全表扫）、`resource_tag(tagId, resourceId)` 反向、`favorite/thank(userId, createdAt)`、`rating(userId, updatedAt)`、`resource_file(versionId, sortOrder)`、`post(topicId, floorNo)`、`download_log(resourceId, createdAt)`，外加两条表达式/部分索引：平均分排序 `((case when rating_count=0 then 0 else rating_sum::numeric/rating_count end) desc)` 和 Meilisearch 待索引队列 `(updated_at) WHERE search_indexed_at IS NULL`。

**刻意与 legacy 相反的取舍**：
- `resource.uploaderId` 改 `set null` + 可空（legacy 的 cascade 删一个用户会连带抹掉别人的评论、评分、下载日志，B2 对象变永久孤儿）；`post.authorId` 同理。已实测：删用户后资源保留、楼层保留、uploader_id 置空。
- 全部时间列 `timestamptz` + `$onUpdate`（legacy 13 张表全是无时区 `timestamp`，且 `updatedAt` 只有 `defaultNow()` 从不更新）。
- `category` **不做 pgEnum**：内容类型是会长的集合，`ALTER TYPE ADD VALUE` 在同事务里加完不能立刻用、删值几乎不可能。改成 `resource_category` 查找表，`id` 直接用 slug（`'music'`），FK 值在行里就可读。闭集（status / license / report_status / storage_kind…）继续用 pgEnum。
- `report` 是**唯一**保留 `(targetType, targetId)` 无类型多态的地方，并且是有意的：举报是治理侧日志，目标被删后**仍应保留**（这正是 FK 级联会破坏的东西），且统一寻址才能让防刷 partial unique、跨类型审核面板共用一套索引。目标存在性由应用层 + 夜间孤儿巡检兜底。

**新增的两张 legacy 完全没有的关键表**：
- `upload_intent`：预签名直传的服务端账本。没有它，`POST /resources` 只能无条件相信客户端上报的 key——legacy 的原样漏洞（任意登录用户可把别人的 B2 对象挂到自己的资源上）。它同时承载 multipart `uploadId`（用于 abort 与「扫 ListMultipartUploads 清残留」定时任务）和 `HeadObject` 回填的真实 size/etag。
- `resource_audit_log`：状态与许可共用一条时间线。版权争议时你要看的是这个资源身上发生过的**全部**事情，而不是两份分开的日志。带 `reportId` / `takedownRequestId` 关联触发源，`isAutomated` 区分「系统」与「人」。

---

## 6. 迁移注意事项（数据库可破坏性重建，无存量数据）

1. **`packages/db/drizzle/` 里的 `0000_unusual_rage.sql` 必须删掉重生成**，不要在它之上叠加。步骤：`rm -rf packages/db/drizzle/* && bun run --cwd packages/db generate && bun run --cwd packages/db migrate`。我只把 DDL 生成到 scratchpad 验证，**没有动仓库里的 `drizzle/` 目录**——留给你决定何时重置。
2. **`auth.ts` 建议同步改 timestamptz**。现在 auth 四表是无时区 `timestamp`，而香霖堂全部是 `timestamptz`，同库两套时间语义是长期的坑。无存量数据时这是零成本的一次性修正；better-auth CLI 重新生成时记得再改一次（或在 `docs/` 里记一笔）。
3. **`auth.ts` 的 `userRelations` 需要扩展**。drizzle 每张表只能有一个 `relations()` 导出，所以 `user` 上的 `uploadedResources` / `ratings` / `favorites` / `posts` 必须写进 `auth.ts` 那个已有的 `userRelations`，不能在 kourindou.ts 里再声明一份——我没有改 auth.ts，这条留给你。
4. **`user_profile.ts` 还没建，但先发后审依赖它**。`trustLevel smallint` / `approvedResourceCount int` / `role` 应该放在独立的 `packages/db/src/schema/user-profile.ts`（`userId` 作 PK/FK → `user.id` cascade），**不要像 legacy 那样把 `role` 塞进 better-auth CLI 可再生成的 `user` 表**。`trustLevel` 与 `role` 必须分开：前者是信任等级（两模块共享），后者是权限——legacy 的 `uploader` role 就是把信任等级伪装成角色。kourindou 的表**不 FK 到它**（trustLevel 是写入时读取的判据，不是引用），所以两边解耦，先后建表都行。
5. **seed 数据是启动前置条件**：`resource_category` 至少 5 行（`game` / `doujinshi` / `music` / `patch` / `tool`，三语名必填），否则 `resource.categoryId NOT NULL RESTRICT` 会让第一次上传直接失败。`touhou_work`、`convention` 可以先空表逐步补。
6. **`resource_ratingSum_ck` 要求 sum 与 count 在同一条 UPDATE 里更新**。`UPDATE resource SET rating_sum = rating_sum + $d, rating_count = rating_count + 1` 没问题；拆成两条语句时第一条就会违约。这是有意的——它把「必须原子更新计数对」变成数据库强制的事，而不是靠每条写路径的自觉。互动写入一律用 `INSERT ... ON CONFLICT (resource_id, user_id) DO UPDATE ... RETURNING`，不要 legacy 那种 read-then-write。
7. **`gen_random_uuid()` 不需要扩展**（PG 13+ 内置），但本方案根本不用它——主键是应用层 `Bun.randomUUIDv7()`，时间有序、不泄露总量、与 better-auth 的 text userId 同型。只有 `download_log` / `resource_audit_log` 两张 append-only 日志用 `bigserial`（不进 URL，且为将来按时间分区/裁剪留路）。
8. **对账脚本要一起排期**：冗余计数（`downloadCount` / `ratingSum` / `ratingCount` / `favoriteCount` / `thankCount` / `topic.postCount` / `circle.resourceCount` / `tag.usageCount`）没有触发器，CHECK 只能挡住明显越界的写坏。建议 `scripts/reconcile-counters.ts` 全量重算 + 定时跑。
9. **PII 有意收敛**：`download_log` 存 `ip_hash char(64)`（每日轮换盐的 sha256）而非明文 IP，`day_bucket` 只到自然日；长期曲线读 `resource_download_daily`，`download_log` 保留 90 天后由 GC 裁剪。`takedown_request.contactEmail` 是必要 PII，处理结案 N 天后置空只留结论。
10. **两条本次没做、但 M3 实施时必须一起落的事**（不属于 schema）：下载路径一律白名单 `status === 'published'`（`DISTRIBUTABLE_RESOURCE_STATUS` 常量已在 shared 里备好）；B2 必须**双桶**（public 存封面、private 存资源本体），否则签名 URL 形同虚设。