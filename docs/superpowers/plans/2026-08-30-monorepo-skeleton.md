# Gensokyo Monorepo 骨架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成可运行的 Bun monorepo 骨架：web(RR8) + api(hono) 启动、hc 类型链路 typecheck 通过、dev 依赖容器化、legacy 迁移归位、推送 GitHub 完成备份。

**Architecture:** bun workspaces + Turborepo；api 用 hono 链式路由导出 `AppType`，经 `@gensokyo/api-client` 的 `hc` 流向 web；zod schema 集中在 `@gensokyo/shared`；drizzle 在 `@gensokyo/db`。

**Tech Stack:** Bun / TypeScript strict ESM / hono / zod v4 / drizzle + PostgreSQL 17 / React Router v8 + React 19 + Vite 7 + Tailwind v4 / Turborepo / Biome

**Spec:** `docs/superpowers/specs/2026-08-30-gensokyo-monorepo-design.md`

## Global Constraints

- 运行时一律 Bun（无 Node、无 pnpm）；依赖装 latest 由解析器定版，不手写猜测版本号
- 所有包 `"private": true`、`"type": "module"`；包名前缀 `@gensokyo/`
- TS `strict: true`；lint/format 只用 Biome；类型检查用 `tsc --noEmit`（bun 不做类型检查）
- 端口约定：web dev `3000`、api dev `3001`、postgres `55432`、redis `56379`、meilisearch `57700`
- dev 数据库凭证：user/pass/db 均为 `gensokyo`（仅本地）
- api 全部路由挂在 `.basePath('/api')` 下；web dev 通过 Vite proxy `/api` → `http://localhost:3001`
- 本计划不做：部署文件（deploy/）、shadcn、better-auth、任何业务模块——只搭骨架
- 每个 Task 结尾提交；最后一个 Task 推送 GitHub

---

### Task 1: workspace 根

**Files:**
- Create: `package.json`, `turbo.json`, `biome.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: workspaces `apps/*`, `packages/*`；根脚本 `dev` `build` `check` `typecheck` `test`

- [ ] **Step 1: 确认 bun 可用**

Run: `bun --version`
Expected: 输出版本号（无则 `brew install oven-sh/bun/bun` 后重试）

- [ ] **Step 2: 写根 package.json**

```json
{
  "name": "gensokyo",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "check": "biome check .",
    "check:fix": "biome check --write .",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  }
}
```

- [ ] **Step 3: 写 turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "build/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": {}
  }
}
```

- [ ] **Step 4: 写 biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true },
  "formatter": { "enabled": true, "indentStyle": "space" },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```

注：biome schema 字段跨大版本有变动，以 `bunx biome check .` 实际运行结果为准修正字段名。

- [ ] **Step 5: .gitignore 增补**

在现有文件末尾追加（已有 node_modules/.env 等 Node 模板内容，勿重复）：

```
.turbo/
*.tsbuildinfo
legacy/**/node_modules/
legacy/**/.next/
legacy/**/.turbo/
```

- [ ] **Step 6: 安装 turbo + biome 并验证**

Run: `bun add -d turbo @biomejs/biome && bunx turbo --version && bunx biome --version`
Expected: 两个版本号正常输出

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: workspace root (bun workspaces + turbo + biome)"
```

### Task 2: dev 依赖 compose

**Files:**
- Create: `compose.yml`, `.env.example`

**Interfaces:**
- Produces: `postgres://gensokyo:gensokyo@localhost:55432/gensokyo`、`redis://localhost:56379`、`http://localhost:57700`

- [ ] **Step 1: 写 compose.yml**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: gensokyo
      POSTGRES_PASSWORD: gensokyo
      POSTGRES_DB: gensokyo
    ports: ['127.0.0.1:55432:5432']
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U gensokyo -d gensokyo']
      interval: 5s
      timeout: 3s
      retries: 10
  redis:
    image: redis:8-alpine
    restart: unless-stopped
    ports: ['127.0.0.1:56379:6379']
    volumes: [redisdata:/data]
  meilisearch:
    image: getmeili/meilisearch:latest
    restart: unless-stopped
    environment:
      MEILI_MASTER_KEY: dev_master_key
      MEILI_ENV: development
    ports: ['127.0.0.1:57700:7700']
    volumes: [meilidata:/meili_data]
volumes:
  pgdata:
  redisdata:
  meilidata:
```

- [ ] **Step 2: 写 .env.example**

```
DATABASE_URL=postgres://gensokyo:gensokyo@localhost:55432/gensokyo
REDIS_URL=redis://localhost:56379
MEILI_HOST=http://localhost:57700
MEILI_MASTER_KEY=dev_master_key
```

同时 `cp .env.example .env`（.env 被 gitignore）。

- [ ] **Step 3: 起容器并验证健康**

Run: `docker compose up -d && sleep 8 && docker compose ps --format '{{.Name}} {{.Status}}'`
Expected: postgres 显示 healthy，三个容器均 Up；端口只绑 127.0.0.1

- [ ] **Step 4: Commit**

```bash
git add compose.yml .env.example && git commit -m "chore: dev dependencies via docker compose"
```

### Task 3: @gensokyo/tsconfig + @gensokyo/shared

**Files:**
- Create: `packages/tsconfig/package.json`, `packages/tsconfig/base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/pagination.ts`, `packages/shared/src/pagination.test.ts`

**Interfaces:**
- Produces: `@gensokyo/tsconfig/base.json`；`paginationQuerySchema`（zod，`{ page≥1 默认1, pageSize 1..100 默认20 }`）、类型 `PaginationQuery`

- [ ] **Step 1: tsconfig 包**

`packages/tsconfig/package.json`:

```json
{ "name": "@gensokyo/tsconfig", "private": true, "version": "0.0.0" }
```

`packages/tsconfig/base.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"],
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 2: shared 包骨架**

`packages/shared/package.json`:

```json
{
  "name": "@gensokyo/shared",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "bun test" }
}
```

`packages/shared/tsconfig.json`:

```json
{ "extends": "@gensokyo/tsconfig/base.json", "include": ["src"] }
```

- [ ] **Step 3: 写失败测试**

`packages/shared/src/pagination.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { paginationQuerySchema } from './pagination'

describe('paginationQuerySchema', () => {
  test('空输入给默认值', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })
  test('字符串数字被 coerce', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 })
  })
  test('pageSize 超上限拒绝', () => {
    expect(() => paginationQuerySchema.parse({ pageSize: 101 })).toThrow()
  })
})
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd packages/shared && bun add zod && bun add -d typescript @gensokyo/tsconfig && bun test`
Expected: FAIL（pagination 模块不存在）

- [ ] **Step 5: 实现**

`packages/shared/src/pagination.ts`:

```ts
import { z } from 'zod'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>
```

`packages/shared/src/index.ts`:

```ts
export * from './pagination'
```

- [ ] **Step 6: 验证通过**

Run: `bun test && bun run typecheck`（在 packages/shared 下）
Expected: 3 pass；typecheck 无错

- [ ] **Step 7: Commit**

```bash
git add packages/ && git commit -m "feat: @gensokyo/tsconfig + @gensokyo/shared with zod pagination schema"
```

### Task 4: @gensokyo/db

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/auth.ts`, `packages/db/src/client.test.ts`

**Interfaces:**
- Consumes: Task 2 的 postgres（`DATABASE_URL`）
- Produces: `db`（drizzle 实例）、`user` 表（`id` text 主键 / `name` / `email` unique / `createdAt`）、迁移文件 `packages/db/drizzle/`

- [ ] **Step 1: 包骨架与依赖**

`packages/db/package.json`:

```json
{
  "name": "@gensokyo/db",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate"
  }
}
```

Run: `cd packages/db && bun add drizzle-orm && bun add -d drizzle-kit typescript @gensokyo/tsconfig`

`packages/db/tsconfig.json` 同 shared（extends base，include src）。

- [ ] **Step 2: schema**

`packages/db/src/schema/auth.ts`:

```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`packages/db/src/schema/index.ts`:

```ts
export * from './auth'
```

- [ ] **Step 3: 客户端（Bun 原生 SQL driver）**

`packages/db/src/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

export const db = drizzle(process.env.DATABASE_URL as string, { schema })
```

`packages/db/src/index.ts`:

```ts
export * from './client'
export * as schema from './schema'
```

注：若 `drizzle-orm/bun-sql` 在当前版本不可用，改用 `drizzle-orm/postgres-js` + `postgres` 依赖，接口不变。

- [ ] **Step 4: drizzle.config.ts + 生成迁移并应用**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL as string },
})
```

Run: `DATABASE_URL=postgres://gensokyo:gensokyo@localhost:55432/gensokyo bun run generate && DATABASE_URL=... bun run migrate`
Expected: `drizzle/0000_*.sql` 生成；migrate 无错

- [ ] **Step 5: 连通性测试**

`packages/db/src/client.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client'

test('db 连通且 user 表存在', async () => {
  const r = await db.execute(sql`select count(*)::int as n from "user"`)
  expect(r.rows?.[0]?.n ?? (r as any)[0]?.n).toBe(0)
})
```

Run: `DATABASE_URL=postgres://gensokyo:gensokyo@localhost:55432/gensokyo bun test`
Expected: 1 pass（返回结构因 driver 而异，按实际调整断言取值路径）

- [ ] **Step 6: Commit**

```bash
git add packages/db && git commit -m "feat: @gensokyo/db with drizzle + bun-sql, user table migration"
```

### Task 5: apps/api（hono）

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/modules/kourindou.ts`, `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `paginationQuerySchema`（@gensokyo/shared）
- Produces: `AppType`（`apps/api/src/app.ts` 导出）；路由 `GET /api/health` → `{ status: 'ok' }`；`GET /api/kourindou/resources?page&pageSize` → `{ items: [], page, pageSize }`

- [ ] **Step 1: 包骨架与依赖**

`apps/api/package.json`:

```json
{
  "name": "@gensokyo/api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/app.ts" },
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  }
}
```

Run: `cd apps/api && bun add hono @hono/zod-validator @gensokyo/shared && bun add -d typescript @gensokyo/tsconfig`
（workspace 内包用 `"@gensokyo/shared": "workspace:*"` 形式，bun add 会自动识别；若没有则手写进 dependencies 再 `bun install`）

tsconfig 同前。

- [ ] **Step 2: 失败测试**

`apps/api/src/app.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { app } from './app'

describe('api skeleton', () => {
  test('health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
  test('kourindou resources 带分页默认值', async () => {
    const res = await app.request('/api/kourindou/resources')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], page: 1, pageSize: 20 })
  })
  test('非法分页参数 400', async () => {
    const res = await app.request('/api/kourindou/resources?pageSize=9999')
    expect(res.status).toBe(400)
  })
})
```

Run: `bun test` → Expected: FAIL（app 不存在）

- [ ] **Step 3: 实现**

`apps/api/src/modules/kourindou.ts`:

```ts
import { paginationQuerySchema } from '@gensokyo/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

export const kourindou = new Hono().get(
  '/resources',
  zValidator('query', paginationQuerySchema),
  (c) => {
    const { page, pageSize } = c.req.valid('query')
    return c.json({ items: [] as never[], page, pageSize })
  },
)
```

`apps/api/src/app.ts`:

```ts
import { Hono } from 'hono'
import { kourindou } from './modules/kourindou'

export const app = new Hono()
  .basePath('/api')
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/kourindou', kourindou)

export type AppType = typeof app
```

`apps/api/src/index.ts`:

```ts
import { app } from './app'

export default { port: 3001, fetch: app.fetch }
```

- [ ] **Step 4: 验证**

Run: `bun test && bun run typecheck`
Expected: 3 pass；typecheck 无错

Run: `bun run dev &`（后台）后 `curl -s localhost:3001/api/health`，然后停掉
Expected: `{"status":"ok"}`

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "feat: hono api skeleton with kourindou module and AppType export"
```

### Task 6: @gensokyo/api-client

**Files:**
- Create: `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/src/index.ts`, `packages/api-client/src/index.test.ts`

**Interfaces:**
- Consumes: `AppType`（@gensokyo/api）
- Produces: `createClient(baseUrl: string)` → `hc<AppType>` 实例

- [ ] **Step 1: 包骨架**

`packages/api-client/package.json`:

```json
{
  "name": "@gensokyo/api-client",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "hono": "*", "@gensokyo/api": "workspace:*" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "bun test" }
}
```

`bun install`；tsconfig 同前。

- [ ] **Step 2: 实现**

`packages/api-client/src/index.ts`:

```ts
import type { AppType } from '@gensokyo/api'
import { hc } from 'hono/client'

export const createClient = (baseUrl: string) => hc<AppType>(baseUrl)
export type ApiClient = ReturnType<typeof createClient>
```

- [ ] **Step 3: 类型链路测试（testClient 直连 app，不起网络）**

`packages/api-client/src/index.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { app } from '@gensokyo/api'
import { testClient } from 'hono/testing'

test('hc 类型链路端到端', async () => {
  const client = testClient(app)
  const res = await client.api.kourindou.resources.$get({
    query: { page: '2', pageSize: '5' },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.page).toBe(2) // body 类型由 AppType 推导，若这里报 any 则链路断了
})
```

Run: `bun test && bun run typecheck`
Expected: pass；`body` 有精确类型（IDE/tsc 均无 any）

- [ ] **Step 4: Commit**

```bash
git add packages/api-client && git commit -m "feat: @gensokyo/api-client with typed hc + e2e type test"
```

### Task 7: apps/web（RR8 + Tailwind v4）

**Files:**
- Create: `apps/web/`（create-react-router 模板生成后调整）
- Modify: `apps/web/vite.config.ts`（加 /api proxy）、`apps/web/app/routes/home.tsx`（调 api 验证链路）、`apps/web/package.json`（name/scripts 对齐）

**Interfaces:**
- Consumes: `createClient`（@gensokyo/api-client）；api dev :3001
- Produces: web dev :3000，`/` 页面 SSR 显示 api health 状态

- [ ] **Step 1: 官方模板生成（保证 RR8 文件结构正确）**

Run: `cd apps && bunx create-react-router@latest web --yes --no-git-init --no-install`
Expected: 生成 framework-mode 项目（react-router.config.ts / app/root.tsx / app/routes.ts）

- [ ] **Step 2: 对齐 workspace**

`apps/web/package.json` 改 `"name": "@gensokyo/web"`，加 `"@gensokyo/api-client": "workspace:*"`，scripts 确保有 `dev`（`react-router dev --port 3000`）、`build`、`typecheck`（`react-router typegen && tsc`）、无则补。根目录 `bun install`。模板若含 eslint/prettier 配置文件则删除（Biome 全局管）。模板若未带 Tailwind v4 则：`bun add tailwindcss @tailwindcss/vite`，vite 插件挂上，`app/app.css` 用 `@import "tailwindcss";`。

- [ ] **Step 3: Vite proxy**

`apps/web/vite.config.ts` 的 defineConfig 中加：

```ts
server: { port: 3000, proxy: { '/api': 'http://localhost:3001' } },
```

- [ ] **Step 4: 首页 loader 走类型化客户端**

`apps/web/app/routes/home.tsx` 替换为：

```tsx
import { createClient } from '@gensokyo/api-client'
import type { Route } from './+types/home'

export async function loader() {
  const client = createClient(process.env.API_URL ?? 'http://localhost:3001')
  const res = await client.api.health.$get()
  return { health: await res.json() }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="grid min-h-screen place-items-center">
      <h1 className="text-2xl font-bold">幻想乡 · Gensokyo</h1>
      <p>api: {loaderData.health.status}</p>
    </main>
  )
}
```

（`Route` 类型路径以 `react-router typegen` 实际产物为准。）

- [ ] **Step 5: 验证**

Run: api dev 起着的前提下 `bun run dev &`，`curl -s localhost:3000 | grep -o 'api: ok'`，然后停掉两个 dev
Expected: `api: ok`（SSR 输出里含 api 状态）

Run: `bun run typecheck && bun run build`（apps/web 下）
Expected: 均通过。若 Vite dev/build 在 Bun 下有兼容问题，记录现象——退路是 web 单独用 node 跑，但先如实报告再决定。

- [ ] **Step 6: Commit**

```bash
git add apps/web && git commit -m "feat: RR8 web app with typed api loader and tailwind v4"
```

### Task 8: legacy 归位 + 文档 + 全仓验证 + 推送

**Files:**
- Move: `thdl/` → `legacy/thdl/`、`touhou-project-music/` → `legacy/touhou-project-music/`
- Create: `legacy/README.md`, `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 前 7 个 Task 的全部产物

- [ ] **Step 1: 迁移 legacy**

```bash
mkdir legacy && git mv thdl legacy/thdl && mv touhou-project-music legacy/touhou-project-music
```

`legacy/README.md`:

```markdown
# Legacy 参考项目

只读参考，不进 workspace、不装依赖、不改动。逻辑移植完一块删一块。

- `thdl/` — 东方资源下载站（Next.js + drizzle + better-auth + B2），git 历史已并入主仓库
- `touhou-project-music/` — 东方同人音乐站（pnpm/turbo monorepo），产品决策见 Claude 记忆
```

- [ ] **Step 2: 提交前检查 touhou-project-music 体积**

Run: `git add legacy/ && git diff --cached --stat | tail -3`
Expected: 增量在几 MB 级（构建产物被 gitignore 挡住）。若出现异常大文件（>5MB），列出并在 .gitignore 增补后重新 add。

- [ ] **Step 3: 写 CLAUDE.md**

```markdown
# Gensokyo

东方 Project 主题综合平台。单站多模块：/shrine 社区、/kourindou 资源、/chronicle Wiki、/spellcard 工具、/music 音乐。

- 运行时 Bun；monorepo：bun workspaces + turbo；lint/format 用 Biome（`bun run check`）
- 类型主轴：packages/shared 的 zod schema → api 校验 → AppType/hc → web
- api 路由一律挂 `.basePath('/api')`，按模块链式 `.route()`（保 RPC 类型推导）
- dev：`docker compose up -d` 起依赖（pg 55432 / redis 56379 / meili 57700），`bun run dev` 起应用（web 3000 / api 3001）
- 设计文档：docs/superpowers/specs/；legacy/ 是只读参考
```

- [ ] **Step 4: 更新根 README.md**

```markdown
# 幻想乡 · Gensokyo

东方 Project 主题综合平台（TypeScript / Bun / hono / React Router）。

## 开发

    docker compose up -d   # postgres + redis + meilisearch
    cp .env.example .env
    bun install
    bun run dev            # web :3000 / api :3001

设计文档见 docs/superpowers/specs/。
```

- [ ] **Step 5: 全仓验证**

Run: `bun install && bun run check && bun run typecheck && bun run test && bun run build`
Expected: 全绿（turbo 聚合各包）

- [ ] **Step 6: 提交并推送**

```bash
git add -A && git commit -m "chore: move legacy projects, add docs, finish skeleton"
git push -u origin main
```

Expected: push 成功，GitHub 上可见完整历史（含 thdl 合并线）

---

## Self-Review 记录

- Spec 覆盖：里程碑 1 全项对应 Task 1-8；deploy/、shadcn、better-auth 按 spec 明确后置 ✓
- 占位符：无 TBD；两处"以实际为准"（biome schema 字段、RR8 typegen 路径）是版本探测性质，附了判定方法 ✓
- 类型一致性：`paginationQuerySchema`（T3）→ T5 消费；`AppType`（T5）→ T6 消费；`createClient`（T6）→ T7 消费 ✓
