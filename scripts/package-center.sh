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
#   │   └── ui-custom/             # Custom UI 静态资源 + Prometheus Web UI 静态资源
#   ├── config/
#   │   ├── metric-center.yml      # 控制面示例配置
#   │   ├── prometheus.yml.example # Prometheus 初始配置模板
#   │   ├── alertmanager.yml(.example)  # WITH_ALERTMANAGER 时写入，M08 AM 种子配置
#   │   └── blackbox.yml(.example) # WITH_BLACKBOX 时写入，M01/M09 探测模块种子配置
#   ├── env/
#   │   └── env.sh.example         # 生产集中环境配置模板（install.sh → env/env.sh）
#   ├── scripts/
#   │   ├── start.sh               # 双模式启动：有 env/env.sh 走 /opt 生产路径，否则解压即用；
#   │   │                          #   组件 --config.file/--storage 指向 $DATA_ROOT/config-output
#   │   ├── stop.sh                # 优雅停止（遍历 $DATA_ROOT/run 或 $ROOT/logs 下的 *.pid）
#   │   ├── install.sh             # 生产安装（root/sudo）：入驻 /opt 三目录 + 建账 + seed 活配置
#   │   └── logrotate.conf.example # 日志轮转示例（daily/rotate 14/compress）
#   └── README.md                  # 部署说明（快速启动 + 生产安装，含 M08/M09 段落，按 WITH_* 注入）
#
# 用法：
#   bash scripts/package-center.sh                    # 本机平台产物
#   CROSS=linux/amd64 bash scripts/package-center.sh  # 交叉编译为 Ubuntu x86_64
#
# 环境变量：
#   DIST_DIR          产物输出目录（默认 ./dist）
#   BUNDLE_NAME       自定义包名（默认自动生成）
#   CROSS             交叉编译目标，如 linux/amd64、linux/arm64
#   WITH_ALERTMANAGER 默认 1：随包交付 alertmanager + amtool（M08 依赖）。除 bin/ 外还会：
#                     ① 写入 config/alertmanager.yml（＋ .example 模板）；
#                     ② start.sh 注入 :9093 启动段并写出 pid（生产模式 $DATA_ROOT/run/，解压即用模式 logs/）；
#                     ③ metric-center 追加 --config.am-dir / --config.am-reload-url，
#                        使 M08 下发写盘与 AM 读取指向同一份文件，闭环生效。
#                     显式设为 0 / no / false 时才裁剪（如 WITH_ALERTMANAGER=0）。
#   WITH_BLACKBOX     默认 1：随包交付 blackbox_exporter（M01/M09 依赖）。除 bin/ 外还会：
#                     ① 写入 config/blackbox.yml（＋ .example 模板）；
#                     ② start.sh 注入 :9115 启动段并写出 pid（生产模式 $DATA_ROOT/run/，解压即用模式 logs/）；
#                     ③ 给 metric-center 追加 --config.dir，并保证 blackbox.yml 与
#                        prometheus.yml 同目录下发、同文件读取。
#                     显式设为 0 / no / false 时才裁剪。
#
# 完整性保证：collect_bundle 末尾 verify_bundle_bins 强制核对 bin/ 必含
#   metric-center / prometheus / promtool（＋启用时的 alertmanager / amtool /
#   blackbox_exporter），缺任何一个即报错中止，杜绝「WARNING 跳过、带病交付」。

set -e

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST_DIR=${DIST_DIR:-"$PROJECT_ROOT/dist"}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# 默认全量交付：M08/M09 校验依赖 amtool / blackbox_exporter 必须随包。
# 历史事故：裸跑 `make package-center` 时 WITH_ALERTMANAGER 未设置，包内缺 amtool，
# 部署机 M08 挂载校验报「amtool check-config 不可调用」。因此改为默认开启，
# 仅当显式设为 0 / no / false 时才裁剪。
WITH_ALERTMANAGER=${WITH_ALERTMANAGER:-1}
WITH_BLACKBOX=${WITH_BLACKBOX:-1}

# enabled 判定开关是否生效：空 / 0 / no / false 视为关闭，其余视为开启。
enabled() {
    case "$1" in
        ""|0|no|false) return 1 ;;
        *) return 0 ;;
    esac
}

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

    if enabled "$WITH_ALERTMANAGER"; then
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
    if enabled "$WITH_BLACKBOX"; then
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
    mkdir -p "$BUNDLE_DIR"/{bin,config,env,scripts,web/ui}

    cp "$PROJECT_ROOT/platform/cmd/metric-center/metric-center" "$BUNDLE_DIR/bin/"
    cp "$PROJECT_ROOT/upstream/prometheus/prometheus" "$BUNDLE_DIR/bin/"
    # promtool：M09 草稿校验依赖（exec.LookPath("promtool")）；随包常驻，缺失即中止。
    # start.sh 已 export PATH="$ROOT/bin:$PATH"，部署机上即可被控制面命中。
    if [ -f "$PROJECT_ROOT/upstream/prometheus/promtool" ]; then
        cp "$PROJECT_ROOT/upstream/prometheus/promtool" "$BUNDLE_DIR/bin/"
    else
        echo ">>> ERROR: promtool not built（build_optional 应已产出），打包中止"
        exit 1
    fi

    # 是否随包交付 Alertmanager（M08 告警分发）：决定 bin/、config/ 与 start.sh 的 AM 段。
    # 默认开启（见文件头 enabled 说明）；启用时 alertmanager/amtool 必须已构建，
    # 缺失即中止，不再 WARNING 跳过——避免部署机 M08 校验报「amtool 不可调用」。
    AM_ENABLED=0
    if enabled "$WITH_ALERTMANAGER"; then
        AM_ENABLED=1
        for b in alertmanager amtool; do
            if [ ! -f "$PROJECT_ROOT/upstream/alertmanager/$b" ]; then
                echo ">>> ERROR: $b not built（build_optional 应已产出），打包中止"
                exit 1
            fi
            cp "$PROJECT_ROOT/upstream/alertmanager/$b" "$BUNDLE_DIR/bin/"
        done
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
    # 是否随包交付 blackbox_exporter（M01/M09 拨测）：默认开启，缺失即中止。
    BB_ENABLED=0
    if enabled "$WITH_BLACKBOX"; then
        BB_ENABLED=1
        if [ ! -f "$PROJECT_ROOT/upstream/blackbox_exporter/blackbox_exporter" ]; then
            echo ">>> ERROR: blackbox_exporter not built（build_optional 应已产出），打包中止"
            exit 1
        fi
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
# 实际运行以 start.sh 传参为准：db 走 METRIC_CENTER_DB_DSN 环境变量（见 env/env.sh.example），
# --config.dir / --config.am-dir 指向 \$DATA_ROOT/config-output 下的活配置。
listen: :8080
db: data/metric_center.db
prometheus:
  query_url: http://127.0.0.1:9090
  reload_url: http://127.0.0.1:9090/-/reload
  config_dir: ./config-output
EOF

    # 启动脚本
    # 分段生成的理由：AM_ARGS 与 alertmanager 段由「打包期」的 WITH_ALERTMANAGER 决定，
    # 而 $ROOT 等变量必须留到「运行期」在部署机上展开。因此各段统一用 quoted heredoc
    # （<<'EOF'）保持 $ 原样，仅 AM_ARGS 一行用 printf 注入（构建期求值）。
    local start_sh="$BUNDLE_DIR/scripts/start.sh"
    cat > "$start_sh" <<'EOF'
#!/usr/bin/env bash
# start.sh — 一键启动 metric-center + prometheus（+alertmanager +blackbox）
# 双模式（对齐 docs/06-mvp-e2e-testing/package-center-guide.md §2.4 / 决策 64）：
#   - 存在 $ROOT/env/env.sh → 生产模式：路径/保留策略/端口取自 env.sh（/opt 三目录）
#   - 无 env.sh               → 解压即用模式：数据/日志落同目录下 data/、logs/
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$SCRIPT_DIR")
cd "$ROOT"
export PATH="$ROOT/bin:$PATH"

# 生产模式：加载集中环境定义（env/env.sh）；未安装则回落包内 data/ logs/
PROD=0
if [ -f "$ROOT/env/env.sh" ]; then
    PROD=1
    . "$ROOT/env/env.sh"
fi
DATA_ROOT=${DATA_ROOT:-"$ROOT/data"}
LOG_ROOT=${LOG_ROOT:-"$ROOT/logs"}
# pid 落点：生产模式 → $DATA_ROOT/run；解压即用模式 → $ROOT/logs
if [ "$PROD" -eq 1 ]; then PID_DIR="$DATA_ROOT/run"; else PID_DIR="$ROOT/logs"; fi
mkdir -p "$DATA_ROOT/config-output" "$DATA_ROOT/run" "$LOG_ROOT"

# 保留策略默认值（env.sh 未定义时使用）
PROM_RETENTION_TIME=${PROM_RETENTION_TIME:-15d}
PROM_RETENTION_SIZE=${PROM_RETENTION_SIZE:-10GB}
# 组件端口默认值（env.sh 未定义时使用）
PROM_PORT=${PROM_PORT:-9090}
AM_PORT=${AM_PORT:-9093}
BB_PORT=${BB_PORT:-9115}
MC_PORT=${MC_PORT:-8080}
AM_CLUSTER_PORT=${AM_CLUSTER_PORT:-9094}
# SQLite DSN：未指定时落数据根（生产 /opt/data/metric-center，解压即用 data/）
export METRIC_CENTER_DB_DSN=${METRIC_CENTER_DB_DSN:-"$DATA_ROOT/metric_center.db"}

# 从种子配置恢复活配置（DATA_ROOT/config-output 缺失时）——两种模式均生效
# 种子源目录：解压即用模式为包内 config/；生产 install.sh 入驻后为 conf/（规范名）。
CONF_DIR="$ROOT/config"
[ -d "$CONF_DIR" ] || CONF_DIR="$ROOT/conf"
# 注意：seed 必须用 if 结构。若写成 `[..] && [..] && cp`，当目标已存在时该链条会一次短路
# 返回非零，在文件头 set -e 的 start.sh 里会导致「stop 后二次启动」提前静默退出、进程拉不起来。
seed() {
    if [ -f "$2" ] && [ ! -f "$1" ]; then
        cp "$2" "$1"
    fi
}
seed "$DATA_ROOT/config-output/prometheus.yml" "$CONF_DIR/prometheus.yml.example"
if [ -f "$CONF_DIR/alertmanager.yml.example" ]; then
    seed "$DATA_ROOT/config-output/alertmanager.yml" "$CONF_DIR/alertmanager.yml.example"
fi
if [ -f "$CONF_DIR/blackbox.yml.example" ]; then
    seed "$DATA_ROOT/config-output/blackbox.yml" "$CONF_DIR/blackbox.yml.example"
fi

# M08 告警分发：中心 Alertmanager 配置下发目录（$DATA_ROOT/config-output）+ reload 地址
# 由 scripts/package-center.sh 依据 WITH_ALERTMANAGER 注入；未打包 Alertmanager 时为空。
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        # AM 配置下发落盘目录必须与 alertmanager --config.file 所在目录一致
        #（均为 $DATA_ROOT/config-output），否则 M08 下发的 alertmanager.yml 写不到
        # AM 正在读取的文件上，reload 后不生效。
        printf 'AM_ARGS="--config.am-dir=$DATA_ROOT/config-output --config.am-reload-url=http://127.0.0.1:${AM_PORT}/-/reload --alertmanager.url=http://127.0.0.1:${AM_PORT}"\n\n' >> "$start_sh"
    else
        printf 'AM_ARGS=""\n\n' >> "$start_sh"
    fi

    cat >> "$start_sh" <<'EOF'
echo ">>> Starting prometheus on :${PROM_PORT}"
nohup "$ROOT/bin/prometheus" \
    --config.file="$DATA_ROOT/config-output/prometheus.yml" \
    --storage.tsdb.path="$DATA_ROOT/prometheus" \
    --storage.tsdb.retention.time="$PROM_RETENTION_TIME" \
    --storage.tsdb.retention.size="$PROM_RETENTION_SIZE" \
    --web.enable-lifecycle \
    --web.listen-address=":${PROM_PORT}" \
    > "$LOG_ROOT/prometheus.log" 2>&1 &
echo $! > "$PID_DIR/prometheus.pid"
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'

echo ">>> Starting alertmanager on :${AM_PORT}"
mkdir -p "$DATA_ROOT/alertmanager"
nohup "$ROOT/bin/alertmanager" \
    --config.file="$DATA_ROOT/config-output/alertmanager.yml" \
    --storage.path="$DATA_ROOT/alertmanager" \
    --web.listen-address=":${AM_PORT}" \
    --cluster.listen-address=":${AM_CLUSTER_PORT}" \
    > "$LOG_ROOT/alertmanager.log" 2>&1 &
echo $! > "$PID_DIR/alertmanager.pid"
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'

echo ">>> Starting blackbox_exporter on :${BB_PORT}"
nohup "$ROOT/bin/blackbox_exporter" \
    --config.file="$DATA_ROOT/config-output/blackbox.yml" \
    --config.enable-auto-reload \
    --web.listen-address=":${BB_PORT}" \
    > "$LOG_ROOT/blackbox_exporter.log" 2>&1 &
echo $! > "$PID_DIR/blackbox_exporter.pid"
EOF
    fi

    cat >> "$start_sh" <<'EOF'

echo ">>> Starting metric-center on :${MC_PORT} (UI + API 同源)"
nohup "$ROOT/bin/metric-center" \
    --listen-address=":${MC_PORT}" \
    --prometheus.url="http://127.0.0.1:${PROM_PORT}" \
    --config.dir="$DATA_ROOT/config-output" \
    --config.reload-url="http://127.0.0.1:${PROM_PORT}/-/reload" \
    --web.static-dir="$ROOT/web/ui-custom" \
    $AM_ARGS \
    > "$LOG_ROOT/metric-center.log" 2>&1 &
echo $! > "$PID_DIR/metric-center.pid"

echo "MetricCenter started."
echo "  Custom UI:     http://<服务器IP>:${MC_PORT}"
echo "  Prometheus UI: http://<服务器IP>:${PROM_PORT}"
EOF

    if [ "$AM_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'
echo "  Alertmanager:  http://<服务器IP>:${AM_PORT}"
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$start_sh" <<'EOF'
echo "  Blackbox:      http://<服务器IP>:${BB_PORT}"
EOF
    fi

    cat >> "$start_sh" <<'EOF'
echo "  MetricCenter:  http://<服务器IP>:${MC_PORT}"
echo "  Data:          $DATA_ROOT"
echo "  Logs:          $LOG_ROOT"
echo
echo "把 <服务器IP> 换成部署机实际可达的 IP 或域名；本机访问可用 127.0.0.1。"
echo "生产部署请先执行 scripts/install.sh（参考 README「生产安装」节）。"
EOF
    chmod +x "$start_sh"

    cat > "$BUNDLE_DIR/scripts/stop.sh" <<'EOF'
#!/usr/bin/env bash
# stop.sh — 优雅停止全部随包组件
# 与 start.sh 环境检测一致：存在 env/env.sh → 生产模式，pid 在 $DATA_ROOT/run；
# 否则解压即用模式，pid 在 $ROOT/logs。
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$SCRIPT_DIR")
cd "$ROOT"
if [ -f "$ROOT/env/env.sh" ]; then
    . "$ROOT/env/env.sh"
    PID_DIR="${DATA_ROOT:-$ROOT/data}/run"
else
    PID_DIR="$ROOT/logs"
fi
for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    echo ">>> Stopping $(basename "$pidfile") (PID $pid)"
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
done
echo "MetricCenter stopped."
EOF
    chmod +x "$BUNDLE_DIR/scripts/stop.sh"

    # 生产环境集中配置模板（env/env.sh.example → install.sh 复制为 env/env.sh）
    cat > "$BUNDLE_DIR/env/env.sh.example" <<'EOF'
# MetricCenter 生产环境集中配置
# 安装时由 scripts/install.sh 复制到 /opt/apps/metric-center/env/env.sh（已存在则不覆盖）。
# 运维只需调整本文件即可改盘与保留策略；start.sh 启动时加载，不污染全局环境。
export DATA_ROOT=${DATA_ROOT:-/opt/data/metric-center}     # 数据根（TSDB / SQLite / config-output / run）
export LOG_ROOT=${LOG_ROOT:-/opt/log/metric-center}        # 日志根
export PROM_RETENTION_TIME=${PROM_RETENTION_TIME:-15d}     # TSDB 时间保留（--storage.tsdb.retention.time）
export PROM_RETENTION_SIZE=${PROM_RETENTION_SIZE:-10GB}    # TSDB 容量兜底（--storage.tsdb.retention.size）
# 组件端口（端口冲突时改这里，start.sh 全部引用）
export PROM_PORT=${PROM_PORT:-9090}                        # Prometheus
export AM_PORT=${AM_PORT:-9093}                            # Alertmanager
export BB_PORT=${BB_PORT:-9115}                            # blackbox_exporter
export MC_PORT=${MC_PORT:-8080}                            # metric-center（UI + API 同源）
export AM_CLUSTER_PORT=${AM_CLUSTER_PORT:-9094}            # Alertmanager gossip 集群端口（单机也必须独占）
# SQLite 数据库 DSN（控制面持久化；默认落数据根）
export METRIC_CENTER_DB_DSN=${METRIC_CENTER_DB_DSN:-$DATA_ROOT/metric_center.db}
EOF

    # 生产安装脚本（必须以 root/sudo 运行；入驻 /opt 三目录，对齐决策 64 与包中心指南 §2.4）
    cat > "$BUNDLE_DIR/scripts/install.sh" <<'EOF'
#!/usr/bin/env bash
# install.sh — MetricCenter 生产环境安装（root/sudo 提权执行）
# 将解压包入驻 /opt 三目录基线；活配置种子化到数据区 config-output，程序目录保持只读。
# 用法：sudo bash scripts/install.sh
set -e

[ "$(id -u)" -eq 0 ] || { echo ">>> ERROR: install.sh 必须以 root/sudo 权限运行"; exit 1; }

BUNDLE_DIR=$(cd "$(dirname "$0")/.." && pwd)

APP_DIR=${APP_DIR:-/opt/apps/metric-center}
DATA_DIR=${DATA_DIR:-/opt/data/metric-center}
LOG_DIR=${LOG_DIR:-/opt/log/metric-center}
APP_USER=${APP_USER:-app-metric-center}
APP_GROUP=${APP_GROUP:-app-group}
YUNWEI_GROUP=${YUNWEI_GROUP:-yunwei-group}

echo ">>> 目标目录:"
echo "  APP: $APP_DIR"
echo "  DATA: $DATA_DIR"
echo "  LOG:  $LOG_DIR"

# 1) 幂等创建目录结构
mkdir -p "$APP_DIR"/{bin,conf,env,script,web}
mkdir -p "$DATA_DIR"/{prometheus,alertmanager,config-output,run}
mkdir -p "$LOG_DIR"

# 2) 复制文件（config→conf、scripts→script：对齐生产 script/ 规范名）
cp -f  "$BUNDLE_DIR"/bin/*        "$APP_DIR"/bin/
rm -rf "$APP_DIR"/conf/*
cp -rf "$BUNDLE_DIR"/config/*    "$APP_DIR"/conf/
rm -rf "$APP_DIR"/script/*
cp -f  "$BUNDLE_DIR"/scripts/*.sh "$APP_DIR"/script/
cp -f  "$BUNDLE_DIR"/scripts/logrotate.conf.example "$APP_DIR"/script/ 2>/dev/null || true
rm -rf "$APP_DIR"/web/ui-custom
cp -rf "$BUNDLE_DIR"/web/ui-custom "$APP_DIR"/web/

# 3) env/env.sh.example → env/env.sh（目标存在则跳过，不覆盖运维已调整配置）
if [ ! -f "$APP_DIR/env/env.sh" ]; then
    cp "$BUNDLE_DIR/env/env.sh.example" "$APP_DIR/env/env.sh"
    echo ">>> 已生成 $APP_DIR/env/env.sh（请按需调整 DATA_ROOT / 保留策略）"
else
    echo ">>> 跳过（已存在）: $APP_DIR/env/env.sh"
fi

# 4) 从 conf/*.example 种子活配置到数据区 config-output（缺失才生成）
# 与 start.sh 同因：seed 必须用 if 结构，目标已存在时不能返回非零（install.sh 头部 set -e），
# 否则二次安装会静默中断。
seed() {
    if [ -f "$APP_DIR/conf/$2" ] && [ ! -f "$DATA_DIR/config-output/$1" ]; then
        cp "$APP_DIR/conf/$2" "$DATA_DIR/config-output/$1"
    fi
}
seed prometheus.yml  prometheus.yml.example
seed alertmanager.yml alertmanager.yml.example
seed blackbox.yml    blackbox.yml.example

# 5) 权限：程序目录 root:APP_GROUP（目录 2750 只读 + SGID 继承属组）；数据/日志 APP_USER:YUNWEI_GROUP
#    注意按「目录/文件」分开设权限——chmod -R 2750 会把普通文件也加上执行位。
if id -u "$APP_USER" >/dev/null 2>&1; then
    chown -R "root:$APP_GROUP" "$APP_DIR" 2>/dev/null || echo ">>> WARNING: chown $APP_DIR 失败，请人工核对属主"
    find "$APP_DIR" -type d -exec chmod 2750 {} + 2>/dev/null || true
    find "$APP_DIR" -type f -exec chmod 0640 {} + 2>/dev/null || true
    chmod 0750 "$APP_DIR"/bin/* "$APP_DIR"/script/*.sh 2>/dev/null || true
    chown -R "$APP_USER:$YUNWEI_GROUP" "$DATA_DIR" "$LOG_DIR" 2>/dev/null || {
        echo ">>> WARNING: chown $DATA_DIR/$LOG_DIR 失败，请人工核对属主/所属组"
    }
    find "$DATA_DIR" "$LOG_DIR" -type d -exec chmod 2750 {} + 2>/dev/null || true
    find "$DATA_DIR" "$LOG_DIR" -type f -exec chmod 0640 {} + 2>/dev/null || true
else
    echo ">>> WARNING: 未找到账户 $APP_USER，跳过属主设置。请先创建账户/组后再执行。"
fi

# 6) SOP 部署验证提示
cat <<NOTE

=== 安装完成，部署验证 SOP ===
1) 以程序账户拉起（确保以 $APP_USER 运行）：
     sudo -u $APP_USER $APP_DIR/script/start.sh
   进程/账户核对：
     ps -ef | grep -E 'metric-center|prometheus|alertmanager|blackbox'
2) 健康检查：
     curl -s http://127.0.0.1:8080/api/v1/health
3) 查看日志（含 SQLite DSN 落点在 \$DATA_ROOT/metric_center.db）：
     tail -f $LOG_DIR/*.log
4) 停止：
     $APP_DIR/script/stop.sh
5) 日志轮转（可选：/etc 属系统保留区，是否应用由运维决定）：
     cp $APP_DIR/script/logrotate.conf.example /etc/logrotate.d/metric-center
6) 扩容：把 $DATA_DIR 作为独立挂载点，加盘 = 挂载 + rsync + 重启；程序与日志目录不动。
NOTE
EOF
    chmod +x "$BUNDLE_DIR/scripts/install.sh"

    # 日志轮转示例（daily / rotate 14 / compress / copytruncate）
    cat > "$BUNDLE_DIR/scripts/logrotate.conf.example" <<'EOF'
/opt/log/metric-center/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
EOF

    # README 同样分段：Alertmanager 访问条目与 M08 说明段按 AM_ENABLED 条件注入。
    # 含 ${TARGET_OS} / ${BUNDLE_NAME} 的段落用 unquoted heredoc（构建期展开，反引号需转义）；
    # 纯文本段落用 quoted heredoc，反引号可直接书写。
    local readme="$BUNDLE_DIR/README.md"
    # README 用引号 heredoc（反引号与 $DATA_ROOT 等无需转义），动态值（bundle 名/目标平台）
    # 通过末尾 __BUNDLE_NAME__ / __TARGET__ 占位符 + sed 注入，避免与反引号/转义互相干扰。
    cat > "$readme" <<'R1'
# MetricCenter MVP 交付包

## 目录说明

- bin/           可执行二进制（含 promtool / amtool：控制面 M08/M09 草稿校验依赖，由 start.sh 注入的 PATH 自动命中）
- config/        种子配置模板（prometheus.yml.example / alertmanager.yml.example / blackbox.yml.example / metric-center.yml）
- env/           生产环境集中配置（env.sh.example → 安装后 env/env.sh，集中定义 DATA_ROOT / 保留策略 / 端口）
- scripts/       启动/停止/安装脚本（start.sh / stop.sh / install.sh / logrotate.conf.example）
- web/           前端静态资源与 Prometheus Web UI 静态资源
- data/          [解压即用模式运行时生成] SQLite 数据库、Prometheus TSDB 数据
- logs/          [解压即用模式运行时生成] 进程日志与 pid 文件

## 快速启动（解压即用）

> 未安装（无 `env/env.sh`）时自动回落「解压即用」模式：数据/日志落在本目录 `data/`、`logs/`，无需 root。

```bash
cd "__BUNDLE_NAME__"
./scripts/start.sh
```

## 停止

```bash
./scripts/stop.sh
```

## 生产安装（/opt 三目录，对齐决策 64）

> 生产环境对齐《业务软件标准化目录与权限配置操作手册》三目录基线，需 **root/sudo** 执行：程序目录 `/opt/apps/metric-center`(root:app-group，`2750` 只读)、数据目录 `/opt/data/metric-center`(数据账户可写，含 `config-output/` 活配置)、日志目录 `/opt/log/metric-center`。

```bash
# 解压包内执行（sudo 提权）
sudo bash scripts/install.sh

# 安装完成后，以程序账户拉起（env/env.sh 已生成并加载）
sudo -u app-metric-center /opt/apps/metric-center/script/start.sh
```

- `scripts/install.sh` 幂等入驻目录树、复制 bin/config/web、由 `env/env.sh.example` 生成 `env/env.sh`（已存在不覆盖）、把种子配置 seed 到数据区 `config-output/`，并按账户设置属主。
- `env/env.sh` 集中定义：`DATA_ROOT`(`/opt/data/metric-center`)、`LOG_ROOT`(`/opt/log/metric-center`)、`PROM_RETENTION_TIME`(`15d`)、`PROM_RETENTION_SIZE`(`10GB`)、`PROM_PORT`/`AM_PORT`/`BB_PORT`/`MC_PORT`、`METRIC_CENTER_DB_DSN`。运维改盘、保留策略与端口只改这一个文件。
- 数据/日志根由 `env.sh` 决定；M09/M08 下发的活配置落 `$DATA_ROOT/config-output/`（程序账户可写），不进只读的程序 `conf/`。
- 日志轮转示例：`scripts/logrotate.conf.example`（daily / rotate 14 / compress）。是否写入 `/etc/logrotate.d/` 由运维决定（/etc 属系统保留区，默认不碰）。

## 访问

把 `<服务器IP>` 换成部署机实际可达的 IP 或域名（本机访问可用 `127.0.0.1`）。

- **Custom UI（同源）**: http://<服务器IP>:8080
- **Prometheus UI**: http://<服务器IP>:9090
R1
    # 注入动态值：bundle 目录名（sed 兼容 BSD/GNU，.bak 兜底后删除）
    sed -i'.bak' "s|__BUNDLE_NAME__|$BUNDLE_NAME|g" "$readme" && rm -f "$readme.bak"

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
- 活配置落点为 `$DATA_ROOT/config-output/alertmanager.yml`（种子模板见 `config/alertmanager.yml.example`）。
- 控制面以 `--config.am-dir=$DATA_ROOT/config-output` + `--config.am-reload-url=http://127.0.0.1:9093/-/reload` 启动，
  因此 M08 下发的 alertmanager.yml 会直接写入上述文件并触发 AM reload，形成闭环。
EOF
    fi

    if [ "$BB_ENABLED" -eq 1 ]; then
        cat >> "$readme" <<'EOF'

## M01/M09 拨测（Blackbox exporter）

- blackbox_exporter 随包提供，由 `scripts/start.sh` 在 **:9115** 一并拉起，无需手动启动。
- 活配置落点为 `$DATA_ROOT/config-output/blackbox.yml`（种子模板见 `config/blackbox.yml.example`）。
- 控制面以 `--config.dir=$DATA_ROOT/config-output` 启动，因此 M09 下发的 blackbox.yml 与
  Prometheus 的 prometheus.yml、targets/*.json 落在同一目录；blackbox_exporter 通过
  `--config.enable-auto-reload` 自动感知配置变更，形成闭环。
EOF
    fi

    cat >> "$readme" <<EOF

## 平台

构建目标：${TARGET_OS}/${TARGET_ARCH}
EOF
}

# verify_bundle_bins 交付前最后防线：核对 bin/ 必含全部预期二进制。
# 缺任何一个即报错中止并删除残缺产物，杜绝「缺 amtool/promtool 的包流出」。
verify_bundle_bins() {
    local required=(metric-center prometheus promtool)
    [ "$AM_ENABLED" -eq 1 ] && required+=(alertmanager amtool)
    [ "$BB_ENABLED" -eq 1 ] && required+=(blackbox_exporter)
    local missing=()
    local b
    for b in "${required[@]}"; do
        [ -f "$BUNDLE_DIR/bin/$b" ] || missing+=("$b")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        echo ">>> ERROR: bundle 缺少必含二进制: ${missing[*]}"
        echo ">>> 打包中止，已清理残缺产物 $BUNDLE_DIR"
        rm -rf "$BUNDLE_DIR"
        exit 1
    fi
    echo ">>> Bundle bin/ 完整: ${required[*]}"
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
    verify_bundle_bins
    archive_bundle
}

main "$@"
