# 幻想乡的生产镜像。三个 target 共用同一层依赖安装。
#
#   docker compose -f deploy/compose.yml build
#
# 构建上下文是**仓库根目录**（monorepo 的 workspace 装在根 node_modules 里，
# 只 COPY 单个 app 目录会装不出来）。
#
# ⚠️ **基础镜像必须是 Debian 版，不能用 -alpine。**
# 实测：alpine（musl）下 `react-router build` / `vite build` **退出码 0、零输出、
# 零产物**——不报错、不抛异常，只是什么都不做。Vite 8 走 rolldown，
# musl 原生绑定虽然装上了，但整条链在 musl 上静默失效。
# 同一份源码换 Debian 基础镜像立刻正常（✓ built in 415ms）。
# 这个失败形态极难查（构建"成功"，只是后面 COPY 产物时才报 not found），
# 换回 alpine 省下的那几十 MB 不值得再踩一次。
ARG BUN_IMAGE=oven/bun:1.3.14

# ---------------------------------------------------------------- 依赖
FROM ${BUN_IMAGE} AS deps
WORKDIR /app
# 先只拷清单，让依赖层能被缓存住——改一行业务代码不该重装依赖
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/api-client/package.json packages/api-client/
COPY packages/tsconfig/package.json packages/tsconfig/
# 缓存挂载：依赖有变动时也只下载差量，不必从零拉整个 registry
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---------------------------------------------------------------- api
FROM deps AS api
COPY . .
ENV NODE_ENV=production
EXPOSE 3001
# 不用 --hot：热重载会在同一进程里重新求值模块图，每次都新建一个连接池
CMD ["bun", "run", "apps/api/src/index.ts"]

# ---------------------------------------------------------------- 迁移
# 单次任务：compose 里以 `restart: no` 跑，跑完退出。
# migrate.ts 用 import.meta.dir 定位迁移目录，与 cwd 无关。
FROM deps AS migrate
COPY . .
ENV NODE_ENV=production
CMD ["bun", "run", "packages/db/scripts/migrate.ts"]

# ---------------------------------------------------------------- web 构建
FROM deps AS web-build
COPY . .
# 反代后面 action 的 CSRF 校验要放行公开域名，见 apps/web/react-router.config.ts。
# 它在**构建时**求值，所以必须是构建参数而不是运行时环境变量。
ARG ALLOWED_ACTION_ORIGINS=""
ENV ALLOWED_ACTION_ORIGINS=$ALLOWED_ACTION_ORIGINS
# Paraglide 的产物是 Vite 插件在构建时生成的（app/paraglide 不进 git），
# 所以这里必须真的跑一次构建，不能只拷贝。
# 显式断言产物存在：alpine 那次就是"构建成功但没有产物"，
# 失败要炸在这里，而不是等到下一阶段 COPY 时报一句 not found。
RUN cd apps/web && bun run build && test -d build/server && test -d build/client

# ---------------------------------------------------------------- web 运行
#
# ⚠️ **构建用 bun，运行必须用 Node。**
# bun 把 `react-dom/server` 解析到它自己的 server.bun.js，那个文件没有
# `renderToPipeableStream`——那是 Node 专用的流式 SSR API，而 React Router
# 的服务端入口正依赖它。用 bun 起会在第一个请求之前就崩：
#   SyntaxError: Export named 'renderToPipeableStream' not found
# api 那边没有这个问题（它是纯 hono，不做 React SSR），所以只有 web 换 Node。
FROM node:24-slim AS web
WORKDIR /app
COPY --from=web-build /app/node_modules ./node_modules
COPY --from=web-build /app/packages ./packages
COPY --from=web-build /app/apps/web/package.json ./apps/web/
COPY --from=web-build /app/apps/web/build ./apps/web/build
COPY --from=web-build /app/apps/web/node_modules ./apps/web/node_modules
WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "node_modules/.bin/react-router-serve", "./build/server/index.js"]
