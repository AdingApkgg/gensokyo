# 幻想乡的生产镜像。两个 target 共用同一层依赖安装。
#
#   docker compose -f deploy/compose.yml build
#
# 构建上下文是**仓库根目录**（monorepo 的 workspace 装在根 node_modules 里，
# 只 COPY 单个 app 目录会装不出来）。

# ---------------------------------------------------------------- 依赖
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
# 先只拷清单，让依赖层能被缓存住——改一行业务代码不该重装依赖
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/api-client/package.json packages/api-client/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN bun install --frozen-lockfile

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
# Paraglide 的产物是 Vite 插件在构建时生成的（app/paraglide 不进 git），
# 所以这里必须真的跑一次构建，不能只拷贝
RUN cd apps/web && bun run build

# ---------------------------------------------------------------- web 运行
FROM oven/bun:1.3.14-alpine AS web
WORKDIR /app
COPY --from=web-build /app/node_modules ./node_modules
COPY --from=web-build /app/packages ./packages
COPY --from=web-build /app/apps/web/package.json ./apps/web/
COPY --from=web-build /app/apps/web/build ./apps/web/build
COPY --from=web-build /app/apps/web/node_modules ./apps/web/node_modules
WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "start"]
