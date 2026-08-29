# Gensokyo

东方 Project 主题综合平台。单站多模块：/shrine 社区、/kourindou 资源、/chronicle Wiki、/spellcard 工具、/music 音乐。

- 运行时 Bun；monorepo：bun workspaces + turbo；lint/format 用 Biome（`bun run check:fix`）
- 类型主轴：packages/shared 的 zod schema → api 校验 → AppType/hc → web
- api 路由一律挂 `.basePath('/api')`，按模块链式 `.route()`（保 RPC 类型推导）
- dev：`docker compose up -d` 起依赖（pg 55432 / redis 56379 / meili 57700），`bun run dev` 起应用（web 3000 / api 3001）
- **本机当前实际配置**（Docker Desktop 未登录不可用）：postgres 用 brew `postgresql@18`（端口 5432，`.env` 已指向它）、redis 用 brew（6379）、Meilisearch 跑独立实例避开与其他项目的版本冲突：
  `MEILI_MASTER_KEY=dev_master_key /opt/homebrew/opt/meilisearch/bin/meilisearch --db-path ~/.local/share/gensokyo/meili --http-addr 127.0.0.1:57700 &`
- 镜像固定：有状态服务**绝不用 `:latest`**；postgres/redis 固定大版本，Meilisearch 固定次版本（跨次版本需迁移 DB）
- i18n：Paraglide JS，消息在 `apps/web/messages/{zh,ja,en}.json`，代码里一律 `m.key()`，不写裸字符串；zh 无 URL 前缀，ja/en 走 `/ja` `/en`；路由用 `localizeHref()`
- UI：shadcn `radix-nova`（Radix 底座，组合用 `asChild` 而非 `render`）；主题 token 在 `apps/web/app/app.css`（白玉楼 / 深夜幻想乡）
- auth：better-auth 挂 `/api/auth/*`；SSR 取会话要手动转发 cookie（见 root loader 的 `createClient(url, { headers: { cookie } })`）；浏览器端 authClient 的 baseURL 必须在 window 存在时才拼 origin
- 设计文档：docs/superpowers/specs/；产品文档：docs/product/；实施计划：docs/superpowers/plans/；legacy/ 是只读参考
