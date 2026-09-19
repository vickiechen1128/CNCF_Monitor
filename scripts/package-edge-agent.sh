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
#       PackageArtifact{version, size_bytes, components[]} / PackageComponent{name, version}）：
#       version=EDGE_AGENT_VERSION；size_bytes=tarball 字节数；
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
        echo ">>> ERROR: 缺少 $b（请先执行 make build-edge-agent && make build-vmagent && make build-blackbox-edge）"
        exit 1
    fi
done
if [ ! -f "$PROJECT_ROOT/platform/edge-sync-agent/packaging/edge-sync-agent.service" ]; then
    echo ">>> ERROR: 缺少 packaging/edge-sync-agent.service，打包中止"
    exit 1
fi

rm -rf "$PACK_DIR"
mkdir -p "$PACK_DIR"/bin "$PACK_DIR"/packaging
cp -f "$BIN_AMD64" "$PACK_DIR/bin/"
cp -f "$BIN_ARM64" "$PACK_DIR/bin/"
cp -f "$BIN_VM_AMD64" "$PACK_DIR/bin/"
cp -f "$BIN_VM_ARM64" "$PACK_DIR/bin/"
cp -f "$BIN_BB_AMD64" "$PACK_DIR/bin/"
cp -f "$BIN_BB_ARM64" "$PACK_DIR/bin/"
cp -f "$PROJECT_ROOT/platform/edge-sync-agent/packaging/edge-sync-agent.service" "$PACK_DIR/packaging/"

# 启动/安装引导脚本（systemd 优先，回落前台手动运行）
cat > "$PACK_DIR/start.sh" <<'EOF'
#!/usr/bin/env bash
# start.sh — Edge Sync Agent 安装引导
# 推荐以 systemd 部署（生产，见 packaging/edge-sync-agent.service）：
#   sudo cp packaging/edge-sync-agent.service /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now edge-sync-agent
#   编辑 /etc/systemd/system/edge-sync-agent.service 的 Environment= 填写
#     NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT，然后 sudo systemctl restart edge-sync-agent。
#
# 无 systemd 时（容器 / 调试）可前台手动运行。
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH=amd64
[ "$ARCH" = "aarch64" ] && ARCH=arm64
BIN="$DIR/bin/edge-sync-agent-linux-${ARCH}"
[ -x "$BIN" ] || { echo ">>> ERROR: 未找到适配当前架构的二进制: $BIN"; exit 1; }

for v in NETWORK_DOMAIN_ID TOKEN CENTER_ENDPOINT; do
    if [ -z "${!v}" ]; then
        echo ">>> ERROR: 缺少环境变量 $v（必填）。export $v=... 后再运行。"
        exit 1
    fi
done
echo ">>> Starting edge-sync-agent (arch=$ARCH, domain=$NETWORK_DOMAIN_ID, center=$CENTER_ENDPOINT)"
exec "$BIN"
EOF
chmod +x "$PACK_DIR/start.sh"

# 安装/配置/升级说明
cat > "$PACK_DIR/README.md" <<'EOF'
# Edge Sync Agent 部署包

版本：__VERSION__（模块 Module_11，阶段 D）

## 目录说明

- `bin/`   三件套二进制（linux/amd64 + linux/arm64，部署机按架构选装）：
  `edge-sync-agent-*`（守护）/ `vmagent-*`（采集器，决策 88）/ `blackbox_exporter-*`（拨测器）
- `packaging/edge-sync-agent.service`  systemd 守护单元（父进程运行、TimeoutStopSec=15、CAP_NET_RAW 注释）
- `start.sh`  安装引导（systemd 优先；无 systemd 时前台快速验证）

## 部署（生产建议 systemd）

```bash
sudo cp packaging/edge-sync-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
# 编辑 unit 的 [Service] Environment=，填写三项必填：
#   NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT
sudo systemctl enable --now edge-sync-agent
```

- 默认 ExecStart 指向 `/opt/apps/edge-sync-agent/edge-sync-agent`；如需改安装目录，
  同步修改 unit 的 ExecStart 与配置文件落点（EDGE_CONFIG_ROOT，默认 /opt/apps/edge-sync-agent/edge-config）。
- 状态查看：`sudo systemctl status edge-sync-agent`
- 停止：`sudo systemctl stop edge-sync-agent`

## 手动运行（无 systemd 的临时/调试/容器场景）

```bash
export NETWORK_DOMAIN_ID=xxx TOKEN=xxx CENTER_ENDPOINT=http://<center>:8080
./start.sh                                # 或 ./bin/edge-sync-agent-linux-<arch>
./bin/edge-sync-agent-linux-amd64 -version   # 打印版本与平台
./bin/edge-sync-agent-linux-amd64 -help      # 参数
```

## 关键环境变量

| 变量 | 必填 | 说明 | 默认 |
|------|------|------|------|
| `NETWORK_DOMAIN_ID` | 是 | 网域 ID（决定配置子目录 config-<domain>） | 无 |
| `TOKEN` | 是 | 中心鉴权 Bearer token | 无 |
| `CENTER_ENDPOINT` | 是 | 中心地址，如 `http://10.0.0.1:8080` | 无 |
| `EDGE_CONFIG_ROOT` | 否 | 配置/版本目录根 | `/opt/apps/edge-sync-agent/edge-config` |
| `EDGE_AGENT_TYPE` | 否 | 采集器类型 | `vmagent` |
| `EDGE_AGENT_VERSION` | 否 | 心跳上报的 Agent 版本 | `dev` |
| `EDGE_WAL_DIR` | 否 | 抓取 WAL 目录 | 采集进程默认 |
| `EDGE_COLLECTOR_BIN` / `EDGE_BLACKBOX_BIN` | 否 | 采集/拨测二进制路径 | 同目录探测 |
| `EDGE_PROM_HEALTH_URL` / `EDGE_PROM_RELOAD_URL` | 否 | 采集器健康/reload 探活地址 | `http://127.0.0.1:9090/-/healthy` / `../-/reload` |
| `EDGE_BLACKBOX_ADDR` | 否 | 拨测器监听地址 | `:9115` |

> 采集器需 `CAP_NET_RAW` 能力（ICMP 拨测）；systemd 部署时按需在 unit 中
> `AmbientCapabilities=CAP_NET_RAW` 开启（unit 内已留注释）。

## 版本与升级

- Agent 版本由 `EDGE_AGENT_VERSION` 注入 main.version（Makefile：`-ldflags "-X main.version=$(EDGE_AGENT_VERSION)"`）。
- 升级：替换 `/opt/apps/edge-sync-agent/edge-sync-agent` 二进制 → `sudo systemctl restart edge-sync-agent`。
  重启后守护进程从磁盘恢复上次生效 config_version（崩溃恢复），无需再次下发。
EOF

# 注入实际版本号（回退 sed），再清理临时文件。
sed "s|__VERSION__|$EDGE_AGENT_VERSION|g" "$PACK_DIR/README.md" > "$PACK_DIR/README.md.tmp"
mv "$PACK_DIR/README.md.tmp" "$PACK_DIR/README.md"

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
