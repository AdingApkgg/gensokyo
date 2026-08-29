# Gensokyo

东方 Project 主题综合平台。单站多模块：/shrine 社区、/kourindou 资源、/chronicle Wiki、/spellcard 工具、/music 音乐。

- 运行时 Bun；monorepo：bun workspaces + turbo；lint/format 用 Biome（`bun run check:fix`）
- 类型主轴：packages/shared 的 zod schema → api 校验 → AppType/hc → web
- api 路由一律挂 `.basePath('/api')`，按模块链式 `.route()`（保 RPC 类型推导）
- **dev 依赖跑原生进程，不用容器**：`bun run services`（幂等，另有 `services:status` / `services:down`），然后 `bun run dev` 起应用（web 3000 / api 3001）
  - postgres 与 redis 用 brew 的共享实例，gensokyo 只占独立的库（DB `gensokyo` @5432、redis `db1`）；脚本只启动、从不停止它们（其他项目在用）
  - Meilisearch 跑 gensokyo 专属实例（`~/.local/share/gensokyo/meili` @57700）——它的数据库格式与引擎版本强绑定，共用必撞版本
- 生产才用容器：`deploy/compose.yml`。有状态服务**绝不用 `:latest`**；postgres/redis 固定大版本，Meilisearch 固定次版本（跨次版本需迁移 DB）
- i18n：Paraglide JS，消息在 `apps/web/messages/{zh,ja,en}.json`，代码里一律 `m.key()`，不写裸字符串；zh 无 URL 前缀，ja/en 走 `/ja` `/en`；路由用 `localizeHref()`
- UI：shadcn `radix-nova`（Radix 底座，组合用 `asChild` 而非 `render`）；主题 token 在 `apps/web/app/app.css`（白玉楼 / 深夜幻想乡）
- auth：better-auth 挂 `/api/auth/*`；SSR 取会话要手动转发 cookie（见 root loader 的 `createClient(url, { headers: { cookie } })`）；浏览器端 authClient 的 baseURL 必须在 window 存在时才拼 origin
- 设计文档：docs/superpowers/specs/；产品文档：docs/product/；实施计划：docs/superpowers/plans/；legacy/ 是只读参考
