# 幻想乡 · Gensokyo

东方 Project 主题综合平台（TypeScript / Bun / hono / React Router）。

## 开发

```bash
cp .env.example .env    # 填一个 BETTER_AUTH_SECRET：openssl rand -base64 32
bun install
bun run services        # postgres / redis / meilisearch（原生进程，幂等）
bun run dev             # web :3000 / api :3001
```

依赖服务跑原生进程而非容器：postgres 和 redis 用 brew 的共享实例（gensokyo 只占独立的库），
Meilisearch 跑专属实例。`bun run services:status` 看状态，`services:down` 停掉 gensokyo 专属进程。
生产环境仍走容器，见 `deploy/compose.yml`。

设计文档见 `docs/superpowers/specs/`，产品方向见 `docs/product/`。
