#!/usr/bin/env bash
# 本地开发依赖：原生进程，不用容器。
#
#   ./scripts/dev-services.sh up      启动并就绪（幂等）
#   ./scripts/dev-services.sh status  查看状态
#   ./scripts/dev-services.sh down    只停 gensokyo 专属进程
#
# postgres 与 redis 是 brew 的共享服务（其他项目也在用），本脚本只会启动、
# 从不停止它们；gensokyo 在共享实例里用独立的库（DB gensokyo / redis db1）。
# Meilisearch 与 MinIO 则各跑一个专属实例：前者的数据库格式与引擎版本强绑定，
# 后者存的是本项目自己的图片，都不该与别的项目共用。
set -euo pipefail

BREW_PREFIX="$(brew --prefix)"
PSQL="$BREW_PREFIX/opt/postgresql@18/bin/psql"
MEILI_BIN="$BREW_PREFIX/opt/meilisearch/bin/meilisearch"
MEILI_DB="$HOME/.local/share/gensokyo/meili"
MEILI_LOG="$HOME/.local/share/gensokyo/meili.log"
MEILI_PORT=57700
MEILI_KEY="${MEILI_MASTER_KEY:-dev_master_key}"
MINIO_BIN="$BREW_PREFIX/opt/minio/bin/minio"
MC_BIN="$BREW_PREFIX/bin/mc"
MINIO_DIR="$HOME/.local/share/gensokyo/minio"
MINIO_LOG="$HOME/.local/share/gensokyo/minio.log"
MINIO_PORT=59000
MINIO_CONSOLE_PORT=59001
MINIO_USER="${S3_ACCESS_KEY_ID:-gensokyo}"
MINIO_PASS="${S3_SECRET_ACCESS_KEY:-gensokyo-dev-secret}"
MINIO_BUCKET="${S3_BUCKET:-gensokyo}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }

meili_running() {
  curl -sf -m 2 "http://127.0.0.1:$MEILI_PORT/health" >/dev/null 2>&1
}

minio_running() {
  curl -sf -m 2 "http://127.0.0.1:$MINIO_PORT/minio/health/live" >/dev/null 2>&1
}

up() {
  # --- postgres ---
  if ! "$PSQL" -h localhost -p 5432 -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    yellow "postgres 未运行，启动 brew 服务…"
    brew services start postgresql@18 >/dev/null
    for _ in $(seq 1 20); do
      "$PSQL" -h localhost -p 5432 -d postgres -tAc 'select 1' >/dev/null 2>&1 && break
      sleep 0.5
    done
  fi
  if ! "$PSQL" -h localhost -p 5432 -d postgres -tAc \
      "select 1 from pg_roles where rolname='gensokyo'" 2>/dev/null | grep -q 1; then
    yellow "创建角色 gensokyo…"
    "$PSQL" -h localhost -p 5432 -d postgres \
      -c "CREATE ROLE gensokyo LOGIN PASSWORD 'gensokyo'" >/dev/null
  fi
  if ! "$PSQL" -h localhost -p 5432 -d postgres -tAc \
      "select 1 from pg_database where datname='gensokyo'" 2>/dev/null | grep -q 1; then
    yellow "创建数据库 gensokyo…"
    "$PSQL" -h localhost -p 5432 -d postgres \
      -c "CREATE DATABASE gensokyo OWNER gensokyo" >/dev/null
  fi
  green "postgres  ✓ $("$PSQL" -h localhost -p 5432 -d postgres -tAc 'show server_version')"

  # --- redis ---
  if ! "$BREW_PREFIX/bin/redis-cli" ping >/dev/null 2>&1; then
    yellow "redis 未运行，启动 brew 服务…"
    brew services start redis >/dev/null
    for _ in $(seq 1 20); do
      "$BREW_PREFIX/bin/redis-cli" ping >/dev/null 2>&1 && break
      sleep 0.5
    done
  fi
  green "redis     ✓ $("$BREW_PREFIX/bin/redis-cli" info server | awk -F: '/redis_version/{print $2}' | tr -d '\r') (db1)"

  # --- meilisearch（gensokyo 专属实例）---
  if ! meili_running; then
    yellow "启动 gensokyo 专属 Meilisearch…"
    mkdir -p "$MEILI_DB"
    MEILI_MASTER_KEY="$MEILI_KEY" MEILI_ENV=development \
      nohup "$MEILI_BIN" --db-path "$MEILI_DB" \
      --http-addr "127.0.0.1:$MEILI_PORT" >"$MEILI_LOG" 2>&1 &
    for _ in $(seq 1 30); do
      meili_running && break
      sleep 0.5
    done
  fi
  if meili_running; then
    green "meili     ✓ $(curl -sf -H "Authorization: Bearer $MEILI_KEY" \
      "http://127.0.0.1:$MEILI_PORT/version" | sed 's/.*pkgVersion":"\([^"]*\)".*/\1/')"
  else
    red "meili     ✗ 启动失败，见 $MEILI_LOG"
    exit 1
  fi

  # --- minio（只存封面等小图，大资源走外链）---
  if ! minio_running; then
    yellow "启动 gensokyo 专属 MinIO…"
    mkdir -p "$MINIO_DIR"
    MINIO_ROOT_USER="$MINIO_USER" MINIO_ROOT_PASSWORD="$MINIO_PASS" \
      nohup "$MINIO_BIN" server "$MINIO_DIR" \
      --address "127.0.0.1:$MINIO_PORT" \
      --console-address "127.0.0.1:$MINIO_CONSOLE_PORT" \
      >"$MINIO_LOG" 2>&1 &
    for _ in $(seq 1 40); do
      minio_running && break
      sleep 0.5
    done
  fi
  if minio_running; then
    # 建桶并设为匿名可读——存的是封面，本来就要给人看
    "$MC_BIN" alias set gensokyo-dev "http://127.0.0.1:$MINIO_PORT" \
      "$MINIO_USER" "$MINIO_PASS" >/dev/null 2>&1 || true
    "$MC_BIN" mb --ignore-existing "gensokyo-dev/$MINIO_BUCKET" >/dev/null 2>&1 || true
    "$MC_BIN" anonymous set download "gensokyo-dev/$MINIO_BUCKET" >/dev/null 2>&1 || true
    green "minio     ✓ localhost:$MINIO_PORT bucket=$MINIO_BUCKET (console :$MINIO_CONSOLE_PORT)"
  else
    red "minio     ✗ 启动失败，见 $MINIO_LOG"
    exit 1
  fi
}

status() {
  "$PSQL" -h localhost -p 5432 -d gensokyo -tAc 'select 1' >/dev/null 2>&1 \
    && green "postgres  ✓ localhost:5432/gensokyo" || red "postgres  ✗"
  "$BREW_PREFIX/bin/redis-cli" ping >/dev/null 2>&1 \
    && green "redis     ✓ localhost:6379 db1" || red "redis     ✗"
  meili_running \
    && green "meili     ✓ localhost:$MEILI_PORT" || red "meili     ✗"
  minio_running \
    && green "minio     ✓ localhost:$MINIO_PORT" || red "minio     ✗"
}

down() {
  # 只停自己的进程；brew 的共享服务留给其他项目
  if pkill -f "meilisearch --db-path $MEILI_DB" 2>/dev/null; then
    green "已停止 gensokyo 的 Meilisearch"
  else
    yellow "Meilisearch 未在运行"
  fi
  if pkill -f "minio server $MINIO_DIR" 2>/dev/null; then
    green "已停止 gensokyo 的 MinIO"
  else
    yellow "MinIO 未在运行"
  fi
  yellow "postgres / redis 是共享的 brew 服务，未停止（其他项目可能在用）"
}

case "${1:-up}" in
  up) up ;;
  status) status ;;
  down) down ;;
  *) echo "用法: $0 {up|status|down}" >&2; exit 1 ;;
esac
