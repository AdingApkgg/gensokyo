# Gensokyo Monorepo 设计

2026-08-30 · 状态：待用户批准

## 背景与目标

东方 Project 主题综合平台，单站实现所有功能（社区、资源、Wiki、玩家工具、音乐，后续可扩展）。Web 先行，未来拓展 React Native。仓库：`AdingApkgg/gensokyo`，本地目录 `/Users/i/Code/th`。

两个前身项目已并入本仓库作参考：

- `thdl/` — 东方资源下载站（Next.js + drizzle + better-auth + B2），git 历史已 subtree 合并进主仓库
- `touhou-project-music/` — 东方同人音乐站（pnpm/turbo monorepo），无 git 历史，尚未提交

两者均从未上线、数据库均为空，无存量数据和兼容包袱。产品决策记忆存于 `~/.claude/projects/-Users-i-Code-th-touhou-project-music/memory/`。

## 技术栈（已定稿）

| 层 | 选择 | 关键理由 |
|---|---|---|
| 运行时 | Bun | 全家桶单二进制、TS 零构建、hono 原生形态；用户已有生产使用经验（iv2） |
| 包管理 | bun workspaces（`bun.lock`） | 随运行时归一 |
| 任务编排 | Turborepo | 用户既有习惯，对 bun 一等支持 |
| 前端 | React Router v8 framework mode（SSR）+ React 19 + Vite 7 | 前后端分离为 RN 铺路 |
| UI | Tailwind v4 + shadcn/ui | 沿用两个前身项目的习惯 |
| 后端 | hono | AI 熟悉度最高、中间件护栏、运行时可移植（对冲 bun 赌注）、hc RPC |
| 契约 | zod v4（Standard Schema，可局部替换） | 生态链路最全（drizzle-zod / zod-validator / hono-openapi） |
| 数据库 | PostgreSQL 17 + Drizzle ORM | 沿用习惯；单库、schema 按模块分文件 |
| 搜索 | Meilisearch（中文 + 拼音） | 音乐站决策沿用 |
| 缓存/队列 | Redis；BullMQ（后置，音乐模块时引入） | |
| 对象存储 | Backblaze B2（S3 兼容 + 预签名上传） | thdl 方案沿用，bucket `thdl-resources` 现成 |
| 认证 | better-auth（挂在 api） | thdl 已验证；单一 origin 下 cookie 直接生效 |
| i18n | Paraglide JS 2（inlang） | 编译型、类型安全（漏译=编译错误）、树摇、RR framework mode 一等支持；UI 三语 zh/ja/en，zh 基准无前缀，`/ja/*` `/en/*` 前缀路由；api 返回消息 key 由客户端本地化；业务表多语字段从首张表落实 |
| Lint/Format | Biome + `tsc --noEmit` | 反馈环速度、单配置文件、AI 维护漂移最小 |
| 测试 | `bun test`（web 组件测试需要时再局部引 vitest） | |
| API 文档 | hono-openapi → Scalar（`/api/docs`，可选项） | 与校验、类型同源于 zod schema |

**已明确排除**：Elysia（绑定 Bun，失去运行时对冲）、tRPC/oRPC 全站化（放弃 REST 面；未来可局部挂载）、Nest/Adonis（魔法层对 AI 不可见）、单进程 hono 托管 SSR、纯 RR8 loader 全栈（RN 无法消费）、podman（alice 上 dockerd 是既成事实；新服务器时再评估 Quadlet 路线）。

## 目录结构

```
gensokyo/
├─ apps/
│  ├─ web/                  # RR8 framework mode（SSR）
│  └─ api/                  # hono，export type AppType
├─ packages/
│  ├─ db/                   # @gensokyo/db — drizzle schema + 客户端 + drizzle-kit
│  ├─ shared/               # @gensokyo/shared — zod schema、常量、纯工具（三端可用）
│  ├─ api-client/           # @gensokyo/api-client — hc<AppType> 薄封装
│  └─ tsconfig/             # @gensokyo/tsconfig — 共享 TS 预设
├─ legacy/
│  ├─ thdl/                 # 冻结参考（自 thdl/ git mv 而来，保留历史）
│  └─ touhou-project-music/
├─ deploy/
│  ├─ compose.prod.yml
│  ├─ Caddyfile
│  └─ .env.production.example
├─ docs/
├─ compose.yml              # 开发依赖：postgres / redis / meilisearch
├─ turbo.json
├─ biome.json
└─ package.json             # workspaces: apps/*, packages/*（legacy 不入 workspace）
```

**预留不建**（YAGNI）：`apps/mobile`（RN/Expo）、`apps/worker`（BullMQ + ffmpeg）、`services/meting-api`、`packages/ui`。

## 类型契约链路（架构主轴）

```
packages/shared 的 zod schema（唯一事实来源）
   ├→ @hono/zod-validator   运行时校验，非法请求自动 400
   ├→ z.infer + AppType/hc  编译期类型 → web 与未来 RN
   └→ hono-openapi → Scalar 外部文档 + 调试台
```

api 按板块拆 hono 子应用，链式挂载保住 RPC 类型推导：

```ts
const app = new Hono()
  .route('/shrine', shrine)        // 社区（博丽神社）
  .route('/kourindou', kourindou)  // 资源（香霖堂，thdl 逻辑移植目标）
  .route('/chronicle', chronicle)  // Wiki（求闻史纪）
  .route('/spellcard', spellcard)  // 玩家工具（符卡）
  .route('/music', music)          // 音乐（音乐站逻辑移植目标）
export type AppType = typeof app
```

web 路由镜像同一命名空间（`/shrine` `/kourindou` …），通用页面收进 `/u`（用户）、`/s`（设置）等短前缀。顶层路径一律用设定词，命名空间提前占死。

## 数据层

单 Postgres 库。`packages/db/src/schema/` 按模块分文件（`auth.ts`、`shrine.ts`、`kourindou.ts`、`chronicle.ts`、`music.ts`…），跨模块外键允许但需显式（如各模块共用 `user` 表）。迁移用 drizzle-kit，生产以一次性 migrate 容器执行。

## 部署（alice）

Docker Compose 生产栈，延续用户 iv2 的既有模式：

```
caddy      前置代理，唯一发布端口（127.0.0.1:8300），/api/* → api，其余 → web
web        RR8 SSR，oven/bun 镜像，仅内部网络
api        hono，oven/bun 镜像，仅内部网络
migrate    drizzle migrate 一次性容器（depends_on: postgres healthy）
postgres   数据卷，不发布端口
redis      不发布端口
meilisearch 不发布端口
```

入口：Cloudflare Tunnel，域名 **`th.saop.cc`**（复用现有 saop.cc tunnel `7f5c560b`，dashboard 加一条 `th.saop.cc` → `localhost:8300`）。数据服务一律不发布端口（修正音乐站时代 0.0.0.0 裸听的问题）。选 Caddy 而非 nginx：配置进仓库、6 行零雷（流式/WS/转发头默认正确）、LAN 直连可用（不被 CF 绑死）。

**风险与退路**：RR8 SSR + Vite dev 跑 Bun 是全栈最新组合；若骨架阶段遇兼容问题，仅 web 容器退回 node 基础镜像（一行配置的切换，代码不动）。

## 开发环境

`compose.yml` 只起 postgres/redis/meili；web 与 api 裸跑 `bun dev`（热更新），Vite 代理 `/api` → api 端口，与生产 Caddy 行为同构。

## 里程碑

产品方向与模块规划详见 `docs/product/2026-08-30-platform-direction.md`（已批准）。

1. **M1 骨架**：workspace + turbo + biome + 两个 app 启动 + compose 依赖 + hc 类型全链路 typecheck 通过 + legacy 迁入 → 提交并推送
2. **M1.5 UI 主题**：东方风 shadcn/ui 主题（参考 tweakcn 的 token 方式）+ `/ui` 设计系统展示页
3. **M2 auth + 用户体系 + 站点外壳**
4. **M3 香霖堂**（资源分发完整闭环）
5. **M4 博丽神社**（版块论坛 + 资源评论统一）
6. **M5+** chronicle（TouhouDB 中文层）→ music → 其余方向

每个里程碑独立走 计划 → 实现 → 验证 流程。

## 未决事项

无。所有决策点均已确认（域名定为 `th.saop.cc`，2026-08-30）。
