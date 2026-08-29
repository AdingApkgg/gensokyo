# M2：auth + 用户体系 + 站点外壳 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** better-auth 认证（邮箱+密码）落地 api，web 获得登录/注册/登出与会话感知的三语站点外壳（导航/页脚/用户菜单/模块占位页）。

**Architecture:** better-auth 挂在 hono `/api/auth/*`（drizzle 适配器，schema 由 CLI 生成进 `@gensokyo/db`）；浏览器经 Vite 代理同源访问，SSR loader 手动转发 Cookie 头；会话在 root loader 解析注入外壳。

**Tech Stack:** better-auth（bun + drizzle adapter）/ hono / RR8 middleware / Paraglide / shadcn

**Spec:** `docs/superpowers/specs/2026-08-30-gensokyo-monorepo-design.md` · 产品文档 `docs/product/2026-08-30-platform-direction.md`

## Global Constraints

- 沿用 M1 全部约定（Bun、Biome、端口、`.basePath('/api')`、链式路由保 AppType）
- `BETTER_AUTH_URL=http://localhost:3000`（公共 origin 是 web，不是 api）；`BETTER_AUTH_SECRET` 进 `.env`（gitignored）与 `.env.example`（占位值）
- turbo `globalPassThroughEnv` 增加 `BETTER_AUTH_*`
- 尚未部署过，数据库可破坏性重建：删旧迁移重新生成 0000，不写增量迁移
- UI 文案一律走 Paraglide 消息（zh/ja/en 三份齐全），不写裸字符串
- 每个 Task 结尾 biome + typecheck + test 过了再 commit；最后 push

---

### Task 1: better-auth 接入 api + schema 生成

**Files:**
- Create: `apps/api/src/auth.ts`、`packages/db/src/schema/auth.ts`（覆盖）
- Modify: `apps/api/src/app.ts`、`.env` / `.env.example`、`turbo.json`、`packages/db` 迁移重建
- Test: `apps/api/src/auth.test.ts`

**Interfaces:**
- Produces: `auth`（better-auth 实例）；`/api/auth/*` 全部端点；db 表 `user/session/account/verification`

- [ ] Step 1: `cd apps/api && bun add better-auth`；`.env` 追加 `BETTER_AUTH_SECRET`（`openssl rand -base64 32` 生成）与 `BETTER_AUTH_URL=http://localhost:3000`；turbo.json passThrough 加 `BETTER_AUTH_*`
- [ ] Step 2: 写 `apps/api/src/auth.ts`：

```ts
import { db } from '@gensokyo/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  trustedOrigins: ['http://localhost:3000'],
})
```

- [ ] Step 3: `bunx @better-auth/cli generate` 生成 drizzle schema，产物整理进 `packages/db/src/schema/auth.ts`（替换骨架 user 表；导出全部表）；api 需要 `@gensokyo/db@workspace:*` 依赖
- [ ] Step 4: 重建迁移：删 `packages/db/drizzle/`，`bun run generate && bun run migrate`（先在 pg 里 `DROP TABLE "user"`）
- [ ] Step 5: app.ts 挂载（保持链式）：

```ts
.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
```

- [ ] Step 6: 测试 `auth.test.ts`：`app.request('/api/auth/sign-up/email', {method:'POST', body: JSON.stringify({email,password,name}), headers:{'content-type':'application/json'}})` → 200 且 set-cookie；用返回 cookie 请求 `/api/auth/get-session` → 返回该用户。跑通后 commit

### Task 2: api 会话感知端点 `/api/me`

**Files:**
- Create: `apps/api/src/modules/me.ts`
- Modify: `apps/api/src/app.ts`
- Test: 扩展 `apps/api/src/auth.test.ts`

**Interfaces:**
- Produces: `GET /api/me` → `{ user: { id,name,email } | null }`（走 `auth.api.getSession({ headers })`）

- [ ] Step 1: me 模块：

```ts
export const me = new Hono().get('/', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  return c.json({ user: session?.user ?? null })
})
```

- [ ] Step 2: `.route('/me', me)` 挂进 app；测试未登录 null / 登录后返回用户；commit

### Task 3: web 登录/注册页 + auth 客户端

**Files:**
- Create: `apps/web/app/lib/auth-client.ts`、`apps/web/app/routes/login.tsx`、`apps/web/app/routes/register.tsx`
- Modify: `apps/web/app/routes.ts`、三份 messages

**Interfaces:**
- Consumes: `/api/auth/*`（同源，浏览器走 Vite 代理）
- Produces: `authClient`（better-auth/react，`baseURL: '/api/auth'` 相对路径同源）；`/login` `/register` 路由（locale 前缀内）

- [ ] Step 1: `cd apps/web && bun add better-auth`；auth-client：`createAuthClient({ baseURL: '/api/auth' })`
- [ ] Step 2: 登录/注册页：shadcn Card+Input+Label+Button，`authClient.signIn.email` / `signUp.email`，成功后 `navigate(localizeHref('/'))`，错误用 destructive 文本展示；全部文案 Paraglide（新增 keys：auth_login/auth_register/auth_email/auth_password/auth_name/auth_submit/auth_error_invalid 等，三语齐）
- [ ] Step 3: routes.ts 在 locale prefix 内加 `route('login',...)`、`route('register',...)`；typecheck+手测（dev 起两端，curl 注册后浏览器流程由 /ui 验证条测）；commit

### Task 4: 站点外壳 + 会话注入

**Files:**
- Create: `apps/web/app/components/site-header.tsx`、`site-footer.tsx`、`apps/web/app/routes/module-stub.tsx`
- Modify: `apps/web/app/root.tsx`（loader 取会话 + Layout 挂外壳）、`apps/web/app/routes.ts`、`apps/web/app/routes/home.tsx`、messages、`packages/api-client`（转发 headers 支持）

**Interfaces:**
- Consumes: `/api/me`（SSR：`createClient('http://localhost:3001', { headers: { cookie } })` 转发 Cookie）
- Produces: root loader 返回 `{ user }`；`useRouteLoaderData('root')` 供全站；导航含 香霖堂/博丽神社/求闻史纪/符卡/音乐 五个占位路由 `/kourindou` 等（"建设中"页）

- [ ] Step 1: api-client 扩展：`createClient(baseUrl, init?: { headers?: Record<string,string> })` 透传给 hc 的 `init.headers`；补类型测试
- [ ] Step 2: root loader：读 `request.headers.get('cookie')` → `/api/me`；`API_URL` env 默认 localhost:3001
- [ ] Step 3: site-header：站名（宋体）+ 五模块导航（`localizeHref`）+ 语言切换 + 主题切换 + 未登录（登录/注册按钮）/已登录（DropdownMenu：用户名、登出 `authClient.signOut()` 后 revalidate）；site-footer：极简（站名 + ZUN 二创指引声明占位）；全部 Paraglide 三语
- [ ] Step 4: /ui 页头部的语言/主题切换保留不动（它是独立展示页）；home.tsx 改为落地页雏形（欢迎语 + 五模块入口卡）；五个 module-stub 路由共用一个"建设中"组件（按路径显示模块名）
- [ ] Step 5: 手测矩阵：未登录首页 → 注册 → 自动登录 → 导航用户菜单 → 登出；三语下外壳文案正确；commit

### Task 5: 全仓验证 + 文档 + 推送

- [ ] Step 1: `bun run check && bun run typecheck && bun run test && bun run build` 全绿
- [ ] Step 2: CLAUDE.md 补 auth 约定（better-auth 挂 /api/auth，SSR 转发 cookie 的模式）；产品文档里程碑 M2 标记完成
- [ ] Step 3: commit + push

## Self-Review 记录

- Spec 覆盖：M2 三要素（auth/用户体系/外壳）对应 T1-T4；Turnstile 与 OAuth 按产品文档后置到 M3 ✓
- 占位符：better-auth CLI 生成的 schema 内容以产物为准（探测性步骤，附整理规则）✓
- 类型一致性：`auth`（T1）→ T2 消费；`/api/me`（T2）→ T4 消费；`createClient` 扩展签名（T4 Step1）在 T4 Step2 使用 ✓
