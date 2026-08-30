# Gensokyo

东方 Project 主题综合平台。单站多模块：/shrine 社区、/kourindou 资源、/chronicle Wiki、/spellcard 工具、/music 音乐。

- 运行时 Bun；monorepo：bun workspaces + turbo；lint/format 用 Biome（`bun run check:fix`）
- 类型主轴：packages/shared 的 zod schema → api 校验 → AppType/hc → web
- api 路由一律挂 `.basePath('/api')`，按模块链式 `.route()`（保 RPC 类型推导）
- **dev 依赖跑原生进程，不用容器**：`bun run services`（幂等，另有 `services:status` / `services:down`），然后 `bun run dev` 起应用（web 3000 / api 3001）
  - postgres 与 redis 用 brew 的共享实例，gensokyo 只占独立的库（DB `gensokyo` @5432、redis `db1`）；脚本只启动、从不停止它们（其他项目在用）
  - Meilisearch（@57700）与 MinIO（@59000，控制台 59001）跑 gensokyo 专属实例——前者的数据库格式与引擎版本强绑定，后者存的是本项目自己的图片
- 存储分流：**大型资源走外链镜像**（网盘/直链/磁链，存 `resource_file.url`），**小图走自建 MinIO**（封面、头像 ≤5MB，经 `/api/uploads/image` 代理上传，URL 存 `coverUrl`/`avatarUrl`；文件头校验，不信 Content-Type）。未引用图片由 `apps/api/scripts/gc-images.ts` 白名单巡检清理
- 生产才用容器：`deploy/compose.yml`。有状态服务**绝不用 `:latest`**；postgres/redis 固定大版本，Meilisearch 固定次版本（跨次版本需迁移 DB）
- i18n：Paraglide JS，消息在 `apps/web/messages/{zh,ja,en}.json`，代码里一律 `m.key()`，不写裸字符串；zh 无 URL 前缀，ja/en 走 `/ja` `/en`；路由用 `localizeHref()`
- UI：shadcn `radix-nova`（Radix 底座，组合用 `asChild` 而非 `render`）；主题 token 在 `apps/web/app/app.css`（白玉楼 / 深夜幻想乡）
- auth：better-auth 挂 `/api/auth/*`；SSR 取会话要手动转发 cookie（见 root loader 的 `createClient(url, { headers: { cookie } })`）；浏览器端 authClient 的 baseURL 必须在 window 存在时才拼 origin
- 香霖堂（M3，已完成）约定：
  - 状态机只在 `apps/api/src/modules/kourindou/status.ts`，不给每个跃迁开具名 URL
  - 状态判断一律**白名单**（`status === 'published'`），绝不写 `!== 'delisted'`
  - `licenseNote` 与 `license` 只能走 `PATCH /license`，那里强制给理由并写 `moderationLog`
  - zod 的 `.partial()` **不移除 `.default()`**——更新用的 schema 必须逐字段重建，否则没传的字段会被写成空值
  - 校验用 `validate()` 而非裸 `zValidator`，`:id` 路由要挂 `entityIdParam`，否则非 UUID 会 500 逃出错误信封
  - 前端错误按 `error.code` 查 Paraglide 文案，api 不返回人类可读消息
- 博丽神社（M4，进行中）约定：
  - **可见性只有一个来源**：`apps/api/src/modules/content/visibility.ts` 的 `visibleTopicWhere()`（表达式，给列表路径）与 `loadVisibleTopic()`（函数，给取单行路径）。只有函数不够——列表路径（最新流 / `/u/:handle` / 通知收件箱）必然各写一遍 WHERE，那就是漂移的源头。**新增任何能返回 `post` 行或 `topic.title` 的端点，必须回答「它用的是哪一份 `visibleTopicWhere()`」**
  - `content/post.ts` 的函数一律收 `TopicView` 而非裸 `topicId`，让「没过闸就拿不到参数」成为编译期事实
  - **`isSelf(actor, ownerId)` 与 `isOwnerOrStaff(actor, ownerId)` 不可混用**：编辑他人正文永远禁止，staff 也不行。`isOwnerOrStaff` 在仓库里已出现 6 次且全部是「作者或 staff」，所以正确写法要有更短的名字
  - `requireAuth` 永远在 `entityIdParam` 之前，否则未登录用户能用 400/404 的差异探测资源存在性
  - **`topic.floorSeq` 是序列不是计数，只增不减**（软删的楼层保留占位）。展示值按 kind 推：版块主题 -1，资源主题不减。旧名 `postCount` 邀请人写 `- 1`，真写了该主题永久发不出帖而错误信息说「主题不存在」
  - **通知扇出的 SELECT 在事务外，写入在事务内包 SAVEPOINT**（`tx.transaction()`）。PG 里事务内任何错误都让事务进 aborted 状态，裸 `try/catch` 救不回发帖
  - 通知不可重算：`notify()` 的去重只对 `{mention, reply}` 生效，其余 kind 直接入队，否则同批次第二条治理通知被静默丢弃且永久丢失
  - **任何 PR 里出现 `rehype-raw` 都是安全事故**
  - **handle 不可逆**：它同时进 `/u/:handle` 与已发布帖子的正文，改动等于死链 + 重写历史正文。`^[a-z0-9][a-z0-9_]{1,19}$`，NOT NULL，从 `user.id` 派生
  - 版块 slug 是对外 URL，六值闭合在 `packages/shared/src/shrine/enums.ts`，DB 侧由一条 CHECK 兜底（不建 `board` 表）
  - **测试必须接 `apps/api/src/test-support.ts` 的 track/cleanup**——测试打的是共享开发库，不是一次性容器
- 常用脚本：`bun run e2e`（端到端验收 23 项）、`reindex`（Meili 全量重建）、`gc:images`（未引用图片巡检，带白名单熔断）、`seed:demo*`（演示数据）
- 设计文档：docs/superpowers/specs/；产品文档：docs/product/；实施计划：docs/superpowers/plans/；调研与审计：docs/superpowers/research/；legacy/ 是只读参考
