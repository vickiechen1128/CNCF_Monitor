#!/usr/bin/env bash
# 本地一键启动 MetricCenter 四个服务（控制面 / Prometheus / Alertmanager / 前端）。
#
# 设计要点：
#   1) 数据库连接只认 METRIC_CENTER_DB_DSN。优先读环境变量，其次读仓库根目录的
#      .env.local（已 gitignore，可安全写本机账号密码）；两者都没有时回落到本地
#      trust 认证的默认库 metric_center（由 make db-init 自动建库并迁移）。
#   2) 四个服务后台并发启动，日志分文件落到 .dev-logs/（已 gitignore）。
#   3) Ctrl-C / 脚本退出时统一收掉四个进程及其子进程。
#
# 用法：make dev-all   或   bash scripts/dev-all.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1) 本地配置（不入库）
if [[ -f .env.local ]]; then
  echo ">>> 读取本地配置 .env.local"
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# 2) 准备数据库并迁移
if [[ -n "${METRIC_CENTER_DB_DSN:-}" ]]; then
  echo ">>> 使用自定义 DSN 迁移数据库（库需已存在）"
  export METRIC_CENTER_DB_DRIVER=postgres
  if command -v psql >/dev/null 2>&1; then
    if ! psql "$METRIC_CENTER_DB_DSN" -tAc 'select 1' >/dev/null 2>&1; then
      echo "ERROR: 无法用 METRIC_CENTER_DB_DSN 连接数据库，请确认库已创建、账号密码正确。" >&2
      exit 1
    fi
  fi
  make migrate
else
  echo ">>> 使用本地默认 PostgreSQL（trust 认证）建库并迁移"
  make db-init
fi

# 3) 后台启动 + 日志
pids=()
start_service() {
  local name="$1"
  shift
  "$@" >"$LOG_DIR/$name.log" 2>&1 &
  local pid=$!
  pids+=("$pid")
  echo "  $name -> PID $pid  (日志 .dev-logs/$name.log)"
}

cleanup() {
  echo ""
  echo ">>> 停止服务..."
  if [[ ${#pids[@]} -gt 0 ]]; then
    for pid in "${pids[@]}"; do
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    done
  fi
  # make 的子 shell 被杀后，真正监听端口的二进制可能成为孤儿进程，
  # 这里按已发布端口兜底清理，避免下次启动时端口被占用。
  local port_pids
  for port in 8080 9090 9093 5173; do
    port_pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
    if [[ -n "$port_pids" ]]; then
      # shellcheck disable=SC2086
      kill $port_pids 2>/dev/null || true
    fi
  done
}

# Ctrl-C / SIGTERM 时正常收尾并以 0 退出，避免 make 打印 "Error 130"。
on_signal() {
  trap - EXIT INT TERM
  cleanup
  exit 0
}
trap cleanup EXIT
trap on_signal INT TERM

echo ">>> 启动四个服务..."
start_service center       make run-metric-center
start_service prometheus   make run-prometheus
start_service alertmanager make run-alertmanager
start_service ui           make dev-ui

echo ""
echo ">>> 全部启动。Ctrl-C 停止；日志目录 .dev-logs/"
echo "    控制面      http://localhost:8080   (health: /api/v3/platform/health)"
echo "    Prometheus http://localhost:9090"
echo "    Alertmanager http://localhost:9093"
echo "    前端        http://localhost:5173"

# 保持脚本前台运行，直到收到信号
wait
