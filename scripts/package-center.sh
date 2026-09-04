#!/usr/bin/env bash
# scripts/package-center.sh — 打包 MetricCenter MVP 中心一体化交付包
#
# 产物结构（参考 docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md）：
#   metric-center-bundle-<os>-<arch>-<timestamp>/
#   ├── bin/
#   │   ├── metric-center          # 控制面二进制（CGO，依赖平台）
#   │   ├── prometheus             # 上游 Prometheus 二进制
#   │   ├── promtool               # 常驻：M09 草稿校验依赖（exec.LookPath("promtool")）
#   │   └── amtool                 # WITH_ALERTMANAGER 时随包：M08 AM 配置校验依赖
#   ├── web/
#   │   └── ui/                    # Custom UI 静态资源 + Prometheus Web UI 静态资源
#   ├── config/
#   │   ├── metric-center.yml      # 控制面示例配置
#   │   ├── prometheus.yml.example # Prometheus 初始配置模板
#   │   ├── alertmanager.yml(.example)  # WITH_ALERTMANAGER 时写入，M08 AM 配置落点
#   │   └── blackbox.yml(.example) # WITH_BLACKBOX 时写入，M01/M09 探测模块种子配置
#   ├── scripts/
#   │   ├── start.sh               # 一键启动 metric-center + prometheus（+alertmanager +blackbox）
#   │   └── stop.sh                # 优雅停止（遍历 logs/*.pid，自动覆盖全部随包组件）
#   └── README.md                  # 部署说明（含 M08/M09 段落，按 WITH_* 注入）
#
# 用法：
#   bash scripts/package-center.sh                    # 本机平台产物
#   CROSS=linux/amd64 bash scripts/package-center.sh  # 交叉编译为 Ubuntu x86_64
#
# 环境变量：
#   DIST_DIR          产物输出目录（默认 ./dist）
#   BUNDLE_NAME       自定义包名（默认自动生成）
#   CROSS             交叉编译目标，如 linux/amd64、linux/arm64
#   WITH_ALERTMANAGER 非空时随包交付 alertmanager + amtool（非 MVP 默认）。除 bin/ 外还会：
#                     ① 写入 config/alertmanager.yml（＋ .example 模板）；
#                     ② start.sh 注入 :9093 启动段并写出 logs/alertmanager.pid；
#                     ③ metric-center 追加 --config.am-dir / --config.am-reload-url，
#                        使 M08 下发写盘与 AM 读取指向同一份文件，闭环生效。
#   WITH_BLACKBOX     非空时随包交付 blackbox_exporter（非 MVP 默认）。除 bin/ 外还会：
#                     ① 写入 config/blackbox.yml（＋ .example 模板）；
#                     ② start.sh 注入 :9115 启动段并写出 logs/blackbox_exporter.pid；
#                     ③ 给 metric-center 追加 --config.dir，并保证 blackbox.yml 与
#                        prometheus.yml 同目录下发、同文件读取。

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
    # 1) Web UI 静态资源（与平台无关，必须先构建）
    if [ ! -d "$prom_dir/web/ui/static" ]; then
        echo ">>> Building Prometheus Web UI assets"
        ( cd "$prom_dir/web/ui" && "$PNPM_BIN" install && "$PNPM_BIN" run build:mantine-ui )
    fi
    # 2) 生成 embed.go：将静态资源编译进二进制（builtinassets），
    #    使交付包自包含，不再依赖运行时 CWD 下的 ./static 目录。
    #    该文件在 upstream/prometheus/web/ui/.gitignore 中（已忽略），不会污染 git。
    if [ ! -f "$prom_dir/web/ui/embed.go" ]; then
        cat > "$prom_dir/web/ui/embed.go" <<'EOF'
//go:build builtinassets
package ui

import "embed"

//go:embed static
var EmbedFS embed.FS
EOF
    fi
    # 3) 编译（含 builtinassets，资源内嵌）
    if [ "$IS_CROSS" -eq 0 ]; then
        make -C "$PROJECT_ROOT" build-prometheus
    else
        cd "$prom_dir"
        CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
        GOPROXY="${GOPROXY:-https://goproxy.io,direct}" \
            "$GO_BIN" build -tags builtinassets -o prometheus ./cmd/prometheus
    fi
}

build_ui() {
    echo ">>> Building Custom UI"
    # A2 部署拓扑：不注入 VITE_API_BASE_URL，前端产物走相对路径，由 metric-center
    # 通过 --web.static-dir 直接托管，UI 与 API 共用 8080 端口。
    # 产物因此与部署 IP / 域名解耦：换环境无需重新打包，也不存在跨域。
    # 这里用 unset 而非「不设置」，避免宿主 shell 残留的同名变量被误注入产物。
    # 见 docs/06-mvp-e2e-testing/frontend-backend-deploy-topology.md
    unset VITE_API_BASE_URL
    make -C "$PROJECT_ROOT" build-ui
}

build_optional() {
    # promtool：M09 配置草稿校验（ValidateArtifacts）通过 exec.LookPath("promtool")
    # 调用做 `promtool check config`；它是控制面在部署服务器上的校验依赖，必须随包。
    # 不依赖 WITH_* 开关——prometheus 本就常驻交付包。
    echo ">>> Building promtool -> $TARGET_OS/$TARGET_ARCH"
    if [ "$IS_CROSS" -eq 0 ]; then
        make -C "$PROJECT_ROOT" build-promtool
    else
        cd "$PROJECT_ROOT/upstream/prometheus"
        CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
            GOPROXY="${GOPROXY:-https://goproxy.io,direct}" \
            "$GO_BIN" build -o promtool ./cmd/promtool
    fi

    if [ -n "$WITH_ALERTMANAGER" ]; then
        echo ">>> Building alertmanager -> $TARGET_OS/$TARGET_ARCH"
        if [ "$IS_CROSS" -eq 0 ]; then
            make -C "$PROJECT_ROOT" build-alertmanager
        else
            cd "$PROJECT_ROOT/upstream/alertmanager"
            CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
                "$GO_BIN" build -o alertmanager ./cmd/alertmanager
            # amtool：M08 Alertmanager 配置挂载校验通过 exec.LookPath("amtool")
            # 调用做 `amtool check-config`；与 alertmanager 同源，交叉编译时必须显式构建
            # （非交叉路径走 make build-alertmanager，已在 Makefile:322 一并产出 amtool）。
            CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
                GOPROXY="${GOPROXY:-https://goproxy.io,direct}" \
                "$GO_BIN" build -o amtool ./cmd/amtool
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
    # promtool：M09 草稿校验依赖（exec.LookPath("promtool")）；随包常驻。
    # start.sh 已 export PATH="$ROOT/bin:$PATH"，部署机上即可被控制面命中。
    if [ -f "$PROJECT_ROOT/upstream/prometheus/promtool" ]; then
        cp "$PROJECT_ROOT/upstream/prometheus/promtool" "$BUNDLE_DIR/bin/"
    else
        echo ">>> WARNING: promtool not built, skip (M09 草稿校验将 pending)"
    fi

    # 是否随包交付 Alertmanager（M08 告警分发）：决定 bin/、config/ 与 start.sh 的 AM 段
    AM_ENABLED=0
    if [ -n "$WITH_ALERTMANAGER" ] && [ -f "$PROJECT_ROOT/upstream/alertmanager/alertmanager" ]; then
        AM_ENABLED=1
        cp "$PROJECT_ROOT/upstream/alertmanager/alertmanager" "$BUNDLE_DIR/bin/"
        # amtool：M08 AM 配置挂载校验依赖（exec.LookPath("amtool")）；随包常驻
        if [ -f "$PROJECT_ROOT/upstream/alertmanager/amtool" ]; then
            cp "$PROJECT_ROOT/upstream/alertmanager/amtool" "$BUNDLE_DIR/bin/"
        else
            echo ">>> WARNING: amtool not built, skip (M08 AM 校验将 pending)"
        fi
        # M08：写入中心 Alertmanager 配置——它是决策 60 里 AM 配置下发（--config.am-dir）的落盘目标，
        # 也是 alertmanager 进程 --config.file 读取的文件，二者必须指向同一份。
        # - config/alertmanager.yml          开箱即用，解压后启动即生效
        # - config/alertmanager.yml.example  默认模板，供误改后恢复
        if [ -f "$PROJECT_ROOT/deploy/alertmanager/alertmanager.yml" ]; then
            cp "$PROJECT_ROOT/deploy/alertmanager/alertmanager.yml" "$BUNDLE_DIR/config/alertmanager.yml"
            cp "$PROJECT_ROOT/deploy/alertmanager/alertmanager.yml" "$BUNDLE_DIR/config/alertmanager.yml.example"
        else
            echo ">>> WARNING: deploy/alertmanager/alertmanager.yml missing, generating minimal fallback"
            cat > "$BUNDLE_DIR/config/alertmanager.yml" <<'EOF'
global:
  resolve_timeout: 5m
route:
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
receivers:
  - name: 'default'
EOF
            cp "$BUNDLE_DIR/config/alertmanager.yml" "$BUNDLE_DIR/config/alertmanager.yml.example"
        fi
    fi
    # 是否随包交付 blackbox_exporter（M01/M09 拨测）
    BB_ENABLED=0
    if [ -n "$WITH_BLACKBOX" ] && [ -f "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox_exporter" ]; then
        BB_ENABLED=1
        cp "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox_exporter" "$BUNDLE_DIR/bin/"
        # M01/M09：blackbox.yml 是 blackbox_exporter 进程 --config.file 读取的文件，
        # 也是控制面下发探测模块（blackbox.yml）的落盘目标，二者必须指向同一份。
        # - config/blackbox.yml          开箱即用，解压后启动即生效
        # - config/blackbox.yml.example  默认模板，供误改后恢复
        if [ -f "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox.yml" ]; then
            cp "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox.yml" "$BUNDLE_DIR/config/blackbox.yml"
            cp "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox.yml" "$BUNDLE_DIR/config/blackbox.yml.example"
        else
            echo ">>> WARNING: upstream/blackbox_exporter/blackbox.yml missing, generating minimal fallback"
            cat > "$BUNDLE_DIR/config/blackbox.yml" <<'EOF'
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: [200]
      method: GET
EOF
            cp "$BUNDLE_DIR/config/blackbox.yml" "$BUNDLE_DIR/config/blackbox.yml.example"
        fi
    fi

    # Custom UI 产物
    if [ -d "$PROJECT_ROOT/ui-custom/web/dist" ]; then
        cp -r "$PROJECT_ROOT/ui-custom/web/dist" "$BUNDLE_DIR/web/ui-custom"
    fi

    # 注：Prometheus 自带 Web UI 资源已通过 -tags builtinassets 编译进二进制
    # （见 build_prometheus），无需再拷贝 web/ui/static，交付包自包含。

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
    # 分段生成的理由：AM_ARGS 与 alertmanager 段由「打包期」的 WITH_ALERTMANAGER 决定，
    # 而 $ROOT 等变量必须留到「运行期」在部署机上展开。因此各段统一用 quoted heredoc
    # （<<'EOF'）保持 $ 原样，仅 AM_ARGS 一行用 printf 注入（构建期求值）。
    local start_sh="$BUNDLE_DIR/scripts/start.sh"
    cat > "$start_sh" <<'EOF'
#!/usr/bin/env bash
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export PATH="$ROOT/bin:$PATH"
mkdir -p data logs config/prometheus
[ -f config/prometheus/prometheus.yml ] || cp config/prometheus.yml.example config/prometheus/prometheus.yml

# M08 告警分发：中心 Alertmanager 配置下发目录 + reload 地址
# 由 scripts/package-center.sh 依据 WITH_ALERTMANAGER 注入；未打包 Alertmanager 时为空。
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        # AM 配置下发落盘目录必须与 alertmanager --config.file 所在目录一致（均为 $ROOT/config），
        # 否则 M08 下发的 alertmanager.yml 写不到 AM 正在读取的文件上，reload 后不生效。
        printf 'AM_ARGS="--config.am-dir=$ROOT/config --config.am-reload-url=http://127.0.0.1:9093/-/reload"\n\n' >> "$start_sh"
    else
        printf 'AM_ARGS=""\n\n' >> "$start_sh"
    fi

    cat >> "$start_sh" <<'EOF'
echo ">>> Starting prometheus on :9090"
nohup ./bin/prometheus \
    --config.file="$ROOT/config/prometheus/prometheus.yml" \
    --storage.tsdb.path="$ROOT/data" \
    --web.enable-lifecycle \
    --web.listen-address=:9090 \
    > logs/prometheus.log 2>&1 &
echo $! > logs/prometheus.pid
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'

echo ">>> Starting alertmanager on :9093"
mkdir -p data/alertmanager
[ -f config/alertmanager.yml ] || cp config/alertmanager.yml.example config/alertmanager.yml
nohup ./bin/alertmanager \
    --config.file="$ROOT/config/alertmanager.yml" \
    --storage.path="$ROOT/data/alertmanager" \
    --web.listen-address=:9093 \
    > logs/alertmanager.log 2>&1 &
echo $! > logs/alertmanager.pid
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'

echo ">>> Starting blackbox_exporter on :9115"
[ -f config/prometheus/blackbox.yml ] || cp config/blackbox.yml.example config/prometheus/blackbox.yml
nohup ./bin/blackbox_exporter \
    --config.file="$ROOT/config/prometheus/blackbox.yml" \
    --config.enable-auto-reload \
    --web.listen-address=:9115 \
    > logs/blackbox_exporter.log 2>&1 &
echo $! > logs/blackbox_exporter.pid
EOF
    fi

    cat >> "$start_sh" <<'EOF'

echo ">>> Starting metric-center on :8080 (UI + API 同源)"
nohup ./bin/metric-center \
    --config.dir="$ROOT/config/prometheus" \
    --config.reload-url=http://127.0.0.1:9090/-/reload \
    --web.static-dir="$ROOT/web/ui-custom" \
    $AM_ARGS \
    > logs/metric-center.log 2>&1 &
echo $! > logs/metric-center.pid

echo "MetricCenter started."
echo "  Custom UI:     http://<服务器IP>:8080"
echo "  Prometheus UI: http://<服务器IP>:9090"
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'
echo "  Alertmanager:  http://<服务器IP>:9093"
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'
echo "  Blackbox:      http://<服务器IP>:9115"
EOF
    fi

    cat >> "$start_sh" <<'EOF'
echo "  MetricCenter:  http://<服务器IP>:8080"
echo "  Logs:          $ROOT/logs/"
echo
echo "把 <服务器IP> 换成部署机实际可达的 IP 或域名；本机访问可用 127.0.0.1。"
EOF
    chmod +x "$start_sh"

    cat > "$BUNDLE_DIR/scripts/stop.sh" <<'EOF'
#!/usr/bin/env bash
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# 通用停止：遍历 logs/ 下全部 pid 文件。启用 Alertmanager（M08）/ blackbox_exporter（M09）时
# start.sh 会写出 logs/alertmanager.pid / logs/blackbox_exporter.pid，因此无需单独列举。
for pidfile in logs/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    echo ">>> Stopping $pidfile (PID $pid)"
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
done
echo "MetricCenter stopped."
EOF
    chmod +x "$BUNDLE_DIR/scripts/stop.sh"

    # README 同样分段：Alertmanager 访问条目与 M08 说明段按 AM_ENABLED 条件注入。
    # 含 ${TARGET_OS} / ${BUNDLE_NAME} 的段落用 unquoted heredoc（构建期展开，反引号需转义）；
    # 纯文本段落用 quoted heredoc，反引号可直接书写。
    local readme="$BUNDLE_DIR/README.md"
    cat > "$readme" <<EOF
# MetricCenter MVP 交付包

## 目录说明

- bin/           可执行二进制（含 promtool / amtool：控制面 M08/M09 草稿校验依赖，由 start.sh 注入的 PATH 自动命中）
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

把 \`<服务器IP>\` 换成部署机实际可达的 IP 或域名（本机访问可用 \`127.0.0.1\`）。

- **Custom UI（同源）**: http://<服务器IP>:8080
- **Prometheus UI**: http://<服务器IP>:9090
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        cat >> "$readme" <<'EOF'
- **Alertmanager**: http://<服务器IP>:9093
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$readme" <<'EOF'
- **Blackbox exporter**: http://<服务器IP>:9115
EOF
    fi

    cat >> "$readme" <<EOF
- **MetricCenter API**: http://<服务器IP>:8080/api
- **Health**: http://<服务器IP>:8080/api/v1/health

> 说明：前端产物由 \`metric-center\` 通过 \`--web.static-dir\` 直接托管，UI 与 API 共用 8080 端口（部署拓扑方案 A2）。构建时**不注入** \`VITE_API_BASE_URL\`，页面内的 API 请求走相对路径，会自适应当前访问的 IP / 域名——同一份产物可部署到任意机器而无需重新打包，也不存在跨域问题。
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        cat >> "$readme" <<'EOF'

## M08 告警分发

- Alertmanager 随包提供，由 `scripts/start.sh` 在 **:9093** 一并拉起，无需手动启动。
- 配置落点为 `config/alertmanager.yml`（默认模板见同目录 `alertmanager.yml.example`）。
- 控制面以 `--config.am-dir=config` + `--config.am-reload-url=http://127.0.0.1:9093/-/reload` 启动，
  因此 M08 下发的 alertmanager.yml 会直接写入上述文件并触发 AM reload，形成闭环。
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$readme" <<'EOF'

## M01/M09 拨测（Blackbox exporter）

- blackbox_exporter 随包提供，由 `scripts/start.sh` 在 **:9115** 一并拉起，无需手动启动。
- 配置落点为 `config/prometheus/blackbox.yml`（默认模板见 `config/blackbox.yml.example`）。
- 控制面以 `--config.dir=$ROOT/config/prometheus` 启动，因此 M09 下发的 blackbox.yml 与
  Prometheus 的 prometheus.yml、targets/*.json 落在同一目录；blackbox_exporter 通过
  `--config.enable-auto-reload` 自动感知配置变更，形成闭环。
EOF
    fi

    cat >> "$readme" <<EOF

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
