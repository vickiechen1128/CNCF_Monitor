#!/usr/bin/env bash
# scripts/package-center.sh — 打包 MetricCenter MVP 中心一体化交付包
#
# 产物结构（参考 docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md）：
#   metric-center-bundle-<os>-<arch>-<timestamp>/
#   ├── bin/
#   │   ├── metric-center          # 控制面二进制（CGO，依赖平台）
#   │   └── prometheus             # 上游 Prometheus 二进制
#   ├── web/
#   │   └── ui/                    # Custom UI 静态资源 + Prometheus Web UI 静态资源
#   ├── config/
#   │   ├── metric-center.yml      # 控制面示例配置
#   │   └── prometheus.yml.example # Prometheus 初始配置模板
#   ├── scripts/
#   │   ├── start.sh               # 一键启动 metric-center + prometheus
#   │   └── stop.sh                # 优雅停止
#   └── README.md                  # 部署说明
#
# 用法：
#   bash scripts/package-center.sh                    # 本机平台产物
#   CROSS=linux/amd64 bash scripts/package-center.sh  # 交叉编译为 Ubuntu x86_64
#
# 环境变量：
#   DIST_DIR          产物输出目录（默认 ./dist）
#   BUNDLE_NAME       自定义包名（默认自动生成）
#   CROSS             交叉编译目标，如 linux/amd64、linux/arm64
#   WITH_ALERTMANAGER 非空时额外打包 alertmanager（非 MVP 默认）
#   WITH_BLACKBOX     非空时额外打包 blackbox_exporter（非 MVP 默认）

set -e

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST_DIR=${DIST_DIR:-"$PROJECT_ROOT/dist"}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# 国内/受限网络下优先使用 goproxy.io，避免交叉编译时下载新依赖超时
# 如需要可覆盖：GOPROXY=https://proxy.golang.org,direct make package-center
export GOPROXY=${GOPROXY:-"https://goproxy.io,direct"}

# 解析目标平台
if [ -n "$CROSS" ]; then
    TARGET_OS=$(echo "$CROSS" | cut -d/ -f1)
    TARGET_ARCH=$(echo "$CROSS" | cut -d/ -f2)
    echo ">>> Cross-compile mode: target $TARGET_OS/$TARGET_ARCH"
else
    TARGET_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    TARGET_ARCH=$(uname -m)
fi

# 规范化架构名
case "$TARGET_ARCH" in
    x86_64) TARGET_ARCH=amd64 ;;
    aarch64) TARGET_ARCH=arm64 ;;
esac

HOST_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
    x86_64) HOST_ARCH=amd64 ;;
    aarch64) HOST_ARCH=arm64 ;;
esac
IS_CROSS=0
[ "$TARGET_OS/$TARGET_ARCH" != "$HOST_OS/$HOST_ARCH" ] && IS_CROSS=1

BUNDLE_NAME=${BUNDLE_NAME:-"metric-center-bundle-${TARGET_OS}-${TARGET_ARCH}-${TIMESTAMP}"}
BUNDLE_DIR="$DIST_DIR/$BUNDLE_NAME"
TARBALL="$DIST_DIR/${BUNDLE_NAME}.tar.gz"

# 工具链路径（与 Makefile 一致）
GO_DIR="$PROJECT_ROOT/.tools/go"
GO_BIN="$GO_DIR/bin/go"
NODE_DIR="$PROJECT_ROOT/.tools/node"
PNPM_DIR="$PROJECT_ROOT/.tools/pnpm"
PNPM_BIN="$PNPM_DIR/bin/pnpm"
export PATH="$GO_DIR/bin:$NODE_DIR/bin:$NODE_DIR:$PNPM_DIR/bin:$PATH"
export GOROOT="$GO_DIR"

ensure_toolchain() {
    if [ ! -f "$GO_BIN" ]; then
        echo ">>> Go toolchain missing, running: make install-go"
        make -C "$PROJECT_ROOT" install-go
    fi
    if [ ! -f "$PNPM_BIN" ]; then
        echo ">>> pnpm missing, running: make install-node install-pnpm"
        make -C "$PROJECT_ROOT" install-node install-pnpm
    fi
    if [ "$IS_CROSS" -eq 1 ] && ! command -v zig >/dev/null 2>&1; then
        echo ">>> ERROR: cross-compilation requires zig as the C compiler for CGO."
        echo "    macOS:   brew install zig"
        echo "    Ubuntu:  snap install zig --classic"
        echo "    或访问:   https://ziglang.org/download/"
        exit 1
    fi
}

build_metric_center() {
    echo ">>> Building metric-center -> $TARGET_OS/$TARGET_ARCH"
    if [ "$IS_CROSS" -eq 0 ]; then
        make -C "$PROJECT_ROOT" build-metric-center
    else
        cd "$PROJECT_ROOT"
        # mattn/go-sqlite3 依赖 CGO；使用 zig 作为交叉 C 工具链
        # Go 的 amd64 在 zig target 中对应 x86_64
        local zig_arch="$TARGET_ARCH"
        [ "$zig_arch" = "amd64" ] && zig_arch="x86_64"
        local zig_target="${zig_arch}-${TARGET_OS}-gnu"
        CC="zig cc -target $zig_target" \
        CXX="zig c++ -target $zig_target" \
        CGO_ENABLED=1 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
            "$GO_BIN" build -o "$PROJECT_ROOT/platform/cmd/metric-center/metric-center" ./platform/cmd/metric-center
    fi
}

build_prometheus() {
    echo ">>> Building prometheus -> $TARGET_OS/$TARGET_ARCH"
    local prom_dir="$PROJECT_ROOT/upstream/prometheus"
    if [ "$IS_CROSS" -eq 0 ]; then
        make -C "$PROJECT_ROOT" build-prometheus
    else
        # 静态资源需要先行构建（与平台无关）
        if [ ! -d "$prom_dir/web/ui/static" ]; then
            echo ">>> Building Prometheus Web UI assets first"
            cd "$prom_dir/web/ui" && "$PNPM_BIN" install && "$PNPM_BIN" run build:mantine-ui
        fi
        cd "$prom_dir"
        CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
        GOPROXY="${GOPROXY:-https://goproxy.io,direct}" \
            "$GO_BIN" build -o prometheus ./cmd/prometheus
    fi
}

build_ui() {
    echo ">>> Building Custom UI"
    # 产物包中前端静态资源直接请求本机 8080 后端（metric-center）
    export VITE_API_BASE_URL="http://127.0.0.1:8080"
    make -C "$PROJECT_ROOT" build-ui
}

build_optional() {
    if [ -n "$WITH_ALERTMANAGER" ]; then
        echo ">>> Building alertmanager -> $TARGET_OS/$TARGET_ARCH"
        if [ "$IS_CROSS" -eq 0 ]; then
            make -C "$PROJECT_ROOT" build-alertmanager
        else
            cd "$PROJECT_ROOT/upstream/alertmanager"
            CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
                "$GO_BIN" build -o alertmanager ./cmd/alertmanager
        fi
    fi
    if [ -n "$WITH_BLACKBOX" ]; then
        echo ">>> Building blackbox_exporter -> $TARGET_OS/$TARGET_ARCH"
        if [ "$IS_CROSS" -eq 0 ]; then
            make -C "$PROJECT_ROOT" build-blackbox-exporter
        else
            cd "$PROJECT_ROOT/upstream/blackbox_exporter"
            CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
                "$GO_BIN" build -o blackbox_exporter ./
        fi
    fi
}

collect_bundle() {
    echo ">>> Assembling bundle: $BUNDLE_DIR"
    rm -rf "$BUNDLE_DIR"
    mkdir -p "$BUNDLE_DIR"/{bin,config/prometheus,scripts,web/ui}

    cp "$PROJECT_ROOT/platform/cmd/metric-center/metric-center" "$BUNDLE_DIR/bin/"
    cp "$PROJECT_ROOT/upstream/prometheus/prometheus" "$BUNDLE_DIR/bin/"

    if [ -n "$WITH_ALERTMANAGER" ] && [ -f "$PROJECT_ROOT/upstream/alertmanager/alertmanager" ]; then
        cp "$PROJECT_ROOT/upstream/alertmanager/alertmanager" "$BUNDLE_DIR/bin/"
    fi
    if [ -n "$WITH_BLACKBOX" ] && [ -f "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox_exporter" ]; then
        cp "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox_exporter" "$BUNDLE_DIR/bin/"
    fi

    # Custom UI 产物
    if [ -d "$PROJECT_ROOT/ui-custom/web/dist" ]; then
        cp -r "$PROJECT_ROOT/ui-custom/web/dist" "$BUNDLE_DIR/web/ui-custom"
    fi

    # Prometheus 自带 Web UI 静态资源（启动时从 CWD 读取 web/ui/static）
    if [ -d "$PROJECT_ROOT/upstream/prometheus/web/ui/static" ]; then
        cp -r "$PROJECT_ROOT/upstream/prometheus/web/ui/static" "$BUNDLE_DIR/web/ui/static"
    fi

    # 示例配置
    # 使用项目级 Prometheus 种子配置作为示例
    cp "$PROJECT_ROOT/deploy/prometheus/prometheus.yml" "$BUNDLE_DIR/config/prometheus.yml.example"
    cat > "$BUNDLE_DIR/config/metric-center.yml" <<EOF
# MetricCenter 控制面示例配置（MVP）
listen: :8080
db: data/metric_center.db
prometheus:
  query_url: http://127.0.0.1:9090
  reload_url: http://127.0.0.1:9090/-/reload
  config_dir: ./config/prometheus
EOF

    # 启动脚本
    cat > "$BUNDLE_DIR/scripts/start.sh" <<'EOF'
#!/usr/bin/env bash
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
mkdir -p data logs config/prometheus
[ -f config/prometheus/prometheus.yml ] || cp config/prometheus.yml.example config/prometheus/prometheus.yml

echo ">>> Starting prometheus on :9090"
nohup ./bin/prometheus \
    --config.file="$ROOT/config/prometheus/prometheus.yml" \
    --storage.tsdb.path="$ROOT/data" \
    --web.enable-lifecycle \
    --web.listen-address=:9090 \
    > logs/prometheus.log 2>&1 &
echo $! > logs/prometheus.pid

echo ">>> Starting metric-center on :8080"
nohup ./bin/metric-center \
    --config.reload-url=http://127.0.0.1:9090/-/reload \
    > logs/metric-center.log 2>&1 &
echo $! > logs/metric-center.pid

if command -v python3 >/dev/null 2>&1; then
    echo ">>> Starting Custom UI static server on :5173"
    nohup python3 -m http.server 5173 --directory "$ROOT/web/ui-custom" \
        > logs/ui.log 2>&1 &
    echo $! > logs/ui.pid
else
    echo ">>> WARN: python3 not found, Custom UI static server will not start."
    echo "    Install python3 or serve web/ui-custom/ with your own static server."
fi

echo "MetricCenter started."
echo "  Custom UI:     http://127.0.0.1:5173"
echo "  Prometheus UI: http://127.0.0.1:9090"
echo "  MetricCenter:  http://127.0.0.1:8080"
echo "  Logs:          $ROOT/logs/"
EOF
    chmod +x "$BUNDLE_DIR/scripts/start.sh"

    cat > "$BUNDLE_DIR/scripts/stop.sh" <<'EOF'
#!/usr/bin/env bash
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
for pidfile in logs/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    echo ">>> Stopping $pidfile (PID $pid)"
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
done
# 兜底：清理可能残留的 python http.server 进程
pkill -f "http.server 5173" 2>/dev/null || true
echo "MetricCenter stopped."
EOF
    chmod +x "$BUNDLE_DIR/scripts/stop.sh"

    cat > "$BUNDLE_DIR/README.md" <<EOF
# MetricCenter MVP 交付包

## 目录说明

- bin/           可执行二进制
- config/        配置文件模板
- scripts/       启动/停止脚本
- web/           前端静态资源与 Prometheus Web UI 静态资源
- data/          运行时生成：SQLite 数据库、Prometheus TSDB 数据
- logs/          运行时生成：进程日志与 pid 文件

## 快速启动

\`\`\`bash
cd "$BUNDLE_NAME"
./scripts/start.sh
\`\`\`

## 停止

\`\`\`bash
./scripts/stop.sh
\`\`\`

## 访问

- **Custom UI**: http://127.0.0.1:5173
- **Prometheus UI**: http://127.0.0.1:9090
- **MetricCenter API**: http://127.0.0.1:8080
- **Health**: http://127.0.0.1:8080/api/v1/health

> 说明：前端静态资源由 \`start.sh\` 通过 python3 \`http.server\` 在 5173 端口提供，API 请求已固定指向本机 8080（\`VITE_API_BASE_URL=http://127.0.0.1:8080\`）。

## 平台

构建目标：${TARGET_OS}/${TARGET_ARCH}
EOF
}

archive_bundle() {
    cd "$DIST_DIR"
    tar -czf "$(basename "$TARBALL")" "$(basename "$BUNDLE_DIR")"
    echo ">>> Archive created: $TARBALL"
    echo ">>> Bundle directory: $BUNDLE_DIR"
    ls -lh "$TARBALL"
}

main() {
    ensure_toolchain
    build_metric_center
    build_prometheus
    build_ui
    build_optional
    collect_bundle
    archive_bundle
}

main "$@"
