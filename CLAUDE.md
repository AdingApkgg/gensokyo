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
- 常用脚本：`bun run e2e`（端到端验收 23 项）、`reindex`（Meili 全量重建）、`gc:images`（未引用图片巡检，带白名单熔断）、`seed:demo*`（演示数据）
- 设计文档：docs/superpowers/specs/；产品文档：docs/product/；实施计划：docs/superpowers/plans/；调研与审计：docs/superpowers/research/；legacy/ 是只读参考
