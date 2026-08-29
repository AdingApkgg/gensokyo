# Gensokyo

东方 Project 主题综合平台。单站多模块：/shrine 社区、/kourindou 资源、/chronicle Wiki、/spellcard 工具、/music 音乐。

- 运行时 Bun；monorepo：bun workspaces + turbo；lint/format 用 Biome（`bun run check:fix`）
- 类型主轴：packages/shared 的 zod schema → api 校验 → AppType/hc → web
- api 路由一律挂 `.basePath('/api')`，按模块链式 `.route()`（保 RPC 类型推导）
- dev：`docker compose up -d` 起依赖（pg 55432 / redis 56379 / meili 57700），`bun run dev` 起应用（web 3000 / api 3001）。本机 docker 不可用时可指向 brew 服务（改 .env 即可）
- 设计文档：docs/superpowers/specs/；产品文档：docs/product/；legacy/ 是只读参考
