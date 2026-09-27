#!/usr/bin/env bash
# scripts/package-edge-agent.sh — 组装 Edge Sync Agent 边缘一体化离线交付包（Module_11 阶段 D / T11-16）
#
# 依赖：已由 `make build-edge-package` 前置完成二进制交叉编译（linux/amd64 + linux/arm64）：
#   make build-edge-agent     -> dist/edge-sync-agent-linux-<arch>
#   make build-vmagent        -> dist/vmagent-linux-<arch>
#   make build-blackbox-edge  -> dist/blackbox_exporter-linux-<arch>
#
# 产物结构（DIST_DIR/edge-package/）：
#   edge-sync-agent-<version>-linux-<arch>-<timestamp>.tar.gz    # 离线包
#   release_meta.json                                            # 发布元数据（对齐中心
#       PackageArtifact{version, file, size_bytes, sha256, components[]} / PackageComponent{name, version}）：
#       version=EDGE_AGENT_VERSION；file=tarball 文件名（带时间戳，中心据此定位产物）；
#       size_bytes=tarball 字节数；sha256=整包校验和；
#       components=[edge-sync-agent + vmagent + blackbox_exporter]
#
# 离线包内部结构：
#   edge-sync-agent/
#   ├── bin/                       # 三组件 × 两架构二进制（部署机按 arch 选装）
#   │   ├── edge-sync-agent-linux-amd64 / -arm64
#   │   ├── vmagent-linux-amd64 / -arm64
#   │   └── blackbox_exporter-linux-amd64 / -arm64
#   ├── packaging/edge-sync-agent.service   # systemd unit（父进程守护）
#   ├── start.sh                   # 安装引导（systemd 或前台手动运行）
#   └── README.md                  # 安装/配置/升级说明
#
# 文档单一来源：包内 README.md 与 unit 均直接拷贝自
#   platform/edge-sync-agent/packaging/{README.md,edge-sync-agent.service}，
#   本脚本只把其中的 __VERSION__ 占位符替换为实际版本号——避免出现第二份会各自漂移的文档。
#
# 产物清理：默认只保留最新一份 tarball 与解压目录，打包前会删除同目录历史产物。
#
# 环境变量：
#   EDGE_AGENT_VERSION  版本号（Makefile 注入，默认 v0.2.0）
#   DIST_DIR           产物根目录（默认 $PROJECT_ROOT/dist）
#   EDGE_SRC_DIST      二进制目录（默认 $PROJECT_ROOT/platform/edge-sync-agent/dist）

set -e

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
EDGE_AGENT_VERSION=${EDGE_AGENT_VERSION:-v0.2.0}
DIST_DIR=${DIST_DIR:-"$PROJECT_ROOT/dist"}
EDGE_SRC_DIST=${EDGE_SRC_DIST:-"$PROJECT_ROOT/platform/edge-sync-agent/dist"}
PKG_ROOT="$DIST_DIR/edge-package"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# 编排架构：默认以 x86_64 命名（离线包内含 amd64 + arm64 双架构二进制，部署机按需选装）。
TARGET_ARCH=${TARGET_ARCH:-"amd64"}
PACK_NAME="edge-sync-agent-${EDGE_AGENT_VERSION}-linux-${TARGET_ARCH}-${TIMESTAMP}"
PACK_DIR="$PKG_ROOT/$PACK_NAME"
TARBALL="$PKG_ROOT/${PACK_NAME}.tar.gz"

BIN_AMD64="$EDGE_SRC_DIST/edge-sync-agent-linux-amd64"
BIN_ARM64="$EDGE_SRC_DIST/edge-sync-agent-linux-arm64"

echo ">>> Packaging edge-sync-agent ${EDGE_AGENT_VERSION} -> $PKG_ROOT"

# 产物理性检查：三组件 × 两架构二进制必须存在，缺任一即中止（杜绝带病交付）。
BIN_VM_AMD64="$EDGE_SRC_DIST/vmagent-linux-amd64"
BIN_VM_ARM64="$EDGE_SRC_DIST/vmagent-linux-arm64"
BIN_BB_AMD64="$EDGE_SRC_DIST/blackbox_exporter-linux-amd64"
BIN_BB_ARM64="$EDGE_SRC_DIST/blackbox_exporter-linux-arm64"
for b in "$BIN_AMD64" "$BIN_ARM64" "$BIN_VM_AMD64" "$BIN_VM_ARM64" "$BIN_BB_AMD64" "$BIN_BB_ARM64"; do
    if [ ! -f "$b" ]; then
        echo ">>> ERROR: 缺少 ${b}（请先执行 make build-edge-agent && make build-vmagent && make build-blackbox-edge）"
        exit 1
    fi
done
for doc in "$PROJECT_ROOT/platform/edge-sync-agent/packaging/edge-sync-agent.service" \
           "$PROJECT_ROOT/platform/edge-sync-agent/packaging/README.md"; do
    if [ ! -f "$doc" ]; then
        echo ">>> ERROR: 缺少 ${doc##*/}（包内文档单一来源），打包中止"
        exit 1
    fi
done

rm -rf "$PACK_DIR"
# 只保留最新一份产物：清理同目录的历史 tarball 与历史解压目录（用户要求「只要一个最新版本」）。
# 放在二进制检查之后执行，避免检查失败退出时反而清掉了上一份可用产物。
for old in "$PKG_ROOT"/edge-sync-agent-*.tar.gz; do
    [ -e "$old" ] || continue
    [ "$old" = "$TARBALL" ] && continue
    rm -f "$old"
done
for olddir in "$PKG_ROOT"/edge-sync-agent-v*; do
    [ -d "$olddir" ] || continue
    [ "$olddir" = "$PACK_DIR" ] && continue
    rm -rf "$olddir"
done
mkdir -p "$PACK_DIR"/bin "$PACK_DIR"/packaging
cp -f "$BIN_AMD64" "$PACK_DIR/bin/"
cp -f "$BIN_ARM64" "$PACK_DIR/bin/"
cp -f "$BIN_VM_AMD64" "$PACK_DIR/bin/"
cp -f "$BIN_VM_ARM64" "$PACK_DIR/bin/"
cp -f "$BIN_BB_AMD64" "$PACK_DIR/bin/"
cp -f "$BIN_BB_ARM64" "$PACK_DIR/bin/"
cp -f "$PROJECT_ROOT/platform/edge-sync-agent/packaging/edge-sync-agent.service" "$PACK_DIR/packaging/"

# 启动/安装引导脚本（systemd 优先，回落前台手动运行）
# 注意：本段用 quoted heredoc（<<'EOF'），端口默认值与变量名需原样保留到部署机展开。
cat > "$PACK_DIR/start.sh" <<'EOF'
#!/usr/bin/env bash
# start.sh — Edge Sync Agent 安装引导
#
# 推荐以 systemd 部署（生产，见 packaging/edge-sync-agent.service）：
#   sudo cp packaging/edge-sync-agent.service /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now edge-sync-agent
#   编辑 /etc/systemd/system/edge-sync-agent.service 的 Environment= 填写三项必填：
#     NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT，然后 sudo systemctl restart edge-sync-agent。
#   systemd 场景自定义端口：取消该 unit 中对应 Environment= 行的注释并改成目标端口。
#
# 无 systemd 时（容器 / 调试）可前台手动运行：export 必填项后执行本脚本。
#
# ---- 端口（可选自定义，默认无需改动）------------------------------------------
# 采集器与拨测器默认只绑回环（127.0.0.1），不占对外端口，因此无需为其开通网络策略。
#   EDGE_COLLECTOR_ADDR     vmagent HTTP 监听地址          默认 127.0.0.1:8429
#   EDGE_PROM_HEALTH_URL    vmagent 健康探活地址           默认 http://127.0.0.1:8429/health
#   EDGE_BLACKBOX_ADDR      blackbox 监听 / TCP 探活地址   默认 127.0.0.1:9115
# 与部署机上已有服务端口冲突时，export 覆盖后再运行本脚本，例如：
#   export EDGE_COLLECTOR_ADDR=127.0.0.1:18429
#   export EDGE_PROM_HEALTH_URL=http://127.0.0.1:18429/health   # 端口必须与上一行一致
#   export EDGE_BLACKBOX_ADDR=127.0.0.1:19115
# 注意：只改 EDGE_COLLECTOR_ADDR 而不改 EDGE_PROM_HEALTH_URL，探活会打到旧端口，
#      组件会被反复判为不健康并触发重启。
#
# ---- 出站网络策略（需放通的方向）----------------------------------------------
#   采集节点 -> 中心 CENTER_ENDPOINT         心跳上报 / 拉取配置包
#   采集节点 -> 中心 Prometheus :9090        remote write（实际地址由配置包 metadata 下发）
#   采集节点 -> 被采集目标自身端口            如 node_exporter :9100、中间件自带端口
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH=amd64
[ "$ARCH" = "aarch64" ] && ARCH=arm64
BIN="$DIR/bin/edge-sync-agent-linux-${ARCH}"
[ -x "$BIN" ] || { echo ">>> ERROR: 未找到适配当前架构的二进制: $BIN"; exit 1; }

for v in NETWORK_DOMAIN_ID TOKEN CENTER_ENDPOINT; do
    if [ -z "${!v}" ]; then
        echo ">>> ERROR: 缺少环境变量 ${v}（必填）。export $v=... 后再运行。"
        exit 1
    fi
done

# 生效端口（默认值需与 cmd/edge-sync-agent/probe.go 保持一致）
COLLECTOR_ADDR=${EDGE_COLLECTOR_ADDR:-127.0.0.1:8429}
HEALTH_URL=${EDGE_PROM_HEALTH_URL:-http://127.0.0.1:8429/health}
BLACKBOX_ADDR=${EDGE_BLACKBOX_ADDR:-127.0.0.1:9115}
# 一致性自检：健康探活端口必须与采集器监听端口一致（去掉 URL 路径后比对）。
COLLECTOR_PORT=${COLLECTOR_ADDR##*:}
HEALTH_PORT=${HEALTH_URL##*:}
HEALTH_PORT=${HEALTH_PORT%%/*}
if [ "$COLLECTOR_PORT" != "$HEALTH_PORT" ]; then
    echo ">>> WARNING: EDGE_PROM_HEALTH_URL 端口 ${HEALTH_PORT} 与 EDGE_COLLECTOR_ADDR 端口 ${COLLECTOR_PORT} 不一致，"
    echo "             组件可能被判为不健康并反复重启；建议改为 http://${COLLECTOR_ADDR}/health"
fi

echo ">>> Starting edge-sync-agent (arch=$ARCH, domain=$NETWORK_DOMAIN_ID, center=$CENTER_ENDPOINT)"
echo ">>> 本机监听（仅回环，无需网络策略）: vmagent=${COLLECTOR_ADDR}  blackbox=${BLACKBOX_ADDR}"
echo ">>> edge-sync-agent 自身不监听端口，仅主动出站"
exec "$BIN"
EOF
chmod +x "$PACK_DIR/start.sh"

# 安装/配置/升级说明：直接拷贝仓库内唯一权威文档（文档单一来源），不再在此生成第二份。
cp -f "$PROJECT_ROOT/platform/edge-sync-agent/packaging/README.md" "$PACK_DIR/README.md"

# 版本注入：README 与 systemd unit 中的 __VERSION__ 占位符统一替换为实际版本号。
for f in "$PACK_DIR/README.md" "$PACK_DIR/packaging/edge-sync-agent.service"; do
    sed "s|__VERSION__|$EDGE_AGENT_VERSION|g" "$f" > "$f.tmp"
    mv "$f.tmp" "$f"
done
# 兜底自检：占位符不得残留（防止漏拷贝或漏渲染带病交付）。
if grep -q "__VERSION__" "$PACK_DIR/README.md" "$PACK_DIR/packaging/edge-sync-agent.service"; then
    echo ">>> ERROR: 版本占位符 __VERSION__ 未完全注入，打包中止"
    exit 1
fi

# 打包离线 tar.gz
cd "$PKG_ROOT"
tar -czf "${TARBALL##*/}" "$PACK_NAME"
echo ">>> Archive created: $TARBALL"
ls -lh "$TARBALL"

# 生成发布元数据（字段对齐中心 PackageArtifact / PackageComponent；三件套版本注入）
SIZE_BYTES=$(wc -c < "$TARBALL" | tr -d ' ')
SHA256=$(shasum -a 256 "$TARBALL" | awk '{print $1}')
cat > "$PKG_ROOT/release_meta.json" <<EOF
{
  "version": "$EDGE_AGENT_VERSION",
  "file": "${PACK_NAME}.tar.gz",
  "size_bytes": $SIZE_BYTES,
  "sha256": "$SHA256",
  "components": [
    { "name": "edge-sync-agent", "version": "$EDGE_AGENT_VERSION" },
    { "name": "vmagent", "version": "${VMAgent_VERSION:-v1.152.0}" },
    { "name": "blackbox_exporter", "version": "${Blackbox_VERSION:-v0.26.0}" }
  ]
}
EOF
echo ">>> release_meta.json (对齐 PackageArtifact/PackageComponent 契约):"
cat "$PKG_ROOT/release_meta.json"
