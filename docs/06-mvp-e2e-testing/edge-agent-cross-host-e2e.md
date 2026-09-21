# Edge Agent 跨主机端到端测试手册（方案 B）

> 覆盖两种形态，按阶段选用：
> - **阶段一（调试期）**：中心留本地 mac + Cloudflare Tunnel 打通，采集节点（edge 三件套）上腾讯云，
>   验证「边缘主动回连中心」的跨公网链路；采集节点安装目录对齐打包文档的 `/opt` 规范。
> - **阶段二（预生产/生产）**：中心 + 采集节点**都上云**；打包方案**拆两份**——中心侧（package-center）
>   与采集节点侧（build-edge-package）。
>
> 功能链路（资源/Job/草稿确认/四能力验证）复用 [edge-agent-local-e2e.md](edge-agent-local-e2e.md)（方案 A）。
> 目录规范出处：中心 [package-center-guide.md](package-center-guide.md)（`/opt` 三目录，决策 64）；
> 边缘 [package-edge-agent.sh](../../scripts/package-edge-agent.sh) 与
> [platform/edge-sync-agent/packaging/README.md](../../platform/edge-sync-agent/packaging/README.md)。

---

## 1. 机器角色（两阶段）

| 机器 | 系统 | 阶段一（调试期） | 阶段二（预生产/生产） |
|------|------|----------------|---------------------|
| 本地 mac | macOS | **中心**（metric-center + prometheus）+ cloudflared 隧道 + 打包机 | 打包机 + 控制台 |
| 腾讯云（UAT/生产） | Ubuntu | **采集节点**（edge 三件套） | **中心** + **采集节点**（同机或分机） |
| serv00 | FreeBSD | 不用 | 不用（跑不了 linux ELF 产物） |

---

## 2. 阶段一：调试期（中心本地 + 隧道 + 采集节点上云）

### 2.0 拓扑

```
本地 mac：metric-center(127.0.0.1:8080) + prometheus(127.0.0.1:9090, receiver 开)
      ▲ Cloudflare Tunnel 两条（trycloudflare.com 公网 URL）
      │  ├─ TUNNEL_8080 → localhost:8080   （边缘心跳 / 拉包）
      │  └─ TUNNEL_9090 → localhost:9090   （vmagent remote_write）
      │
腾讯云采集节点（/opt/apps/edge-sync-agent，只读程序）
      edge-sync-agent（supervisor）→ vmagent(:8429) + blackbox_exporter(:9115)
```

### 2.1 起本地中心（2 进程 + 2 隧道）

```bash
cd "~/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
make run-prometheus       # 终端 1：127.0.0.1:9090（已开 --web.enable-remote-write-receiver）
make run-metric-center    # 终端 2：127.0.0.1:8080

brew install cloudflared
cloudflared tunnel --url http://localhost:8080   # 终端 3 → 记 TUNNEL_8080
cloudflared tunnel --url http://localhost:9090   # 终端 4 → 记 TUNNEL_9090
```

自检：`curl -s http://localhost:8080/api/v1/health`；浏览器开 `$TUNNEL_9090/-/healthy` 期望 Healthy。

### 2.2 打采集节点侧 1 个包（边缘，纯 Go，mac 直接交叉）

```bash
cd "~/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
make build-edge-package
# 单包：dist/edge-package/edge-sync-agent-<v>-linux-amd64-<ts>.tar.gz
# 内含 bin/（三件套 amd64+arm64）+ packaging/edge-sync-agent.service + start.sh + release_meta.json
```

### 2.3 上传部署到腾讯云（安装目录对齐打包文档 /opt 规范）

```bash
TARBALL=$(ls -t dist/edge-package/edge-sync-agent-*-linux-amd64-*.tar.gz | head -1)
scp "$TARBALL" ubuntu@<腾讯云IP>:~/
ssh ubuntu@<腾讯云IP>
# 程序目录（只读，对齐 packaging/README.md /opt/apps/edge-sync-agent）
sudo mkdir -p /opt/apps/edge-sync-agent
sudo tar -xzf "$TARBALL" -C /opt/apps/edge-sync-agent --strip-components=1
# 数据目录（配置包 + WAL 落独立数据盘，对齐中心三目录理念）
sudo mkdir -p /opt/data/edge-sync-agent
sudo chown -R $(whoami) /opt/data/edge-sync-agent
file /opt/apps/edge-sync-agent/bin/vmagent-linux-amd64   # 期望 ELF 64-bit
```

> 目录语义：`/opt/apps/edge-sync-agent/`（程序 + `bin/` + `packaging/`，只读）；
> `/opt/data/edge-sync-agent/`（`EDGE_CONFIG_ROOT` 配置包版本 + `EDGE_WAL_DIR` vmagent 缓存，可写）。
> 与中心「程序只读 / 数据可写」三目录基线同构。调式期前台运行即可，生产再用 systemd。
> 建专属账户 / 目录权限 / systemd 启动的完整命令见下方 **§2.3.1**（含 mac tar 丢可执行位、
> `useradd` 报 `umask`、systemd 增配键须用 drop-in 等踩坑处理）。

### 2.3.1 腾讯云部署全集：建专属账户 / 目录权限 / systemd 启动（以 `yunwei-chenrt` sudo 账户实测） 

```bash
# ── 0) 前置：若 sudo useradd 报 unknown item 'umask'，先注释 /etc/libuser.conf 里 umask 行 ──
sudo sed -i 's/^[[:space:]]*umask[[:space:]]*=.*/#&/' /etc/libuser.conf

# ── 1) 建组 + 专属账户（无家目录、禁 SSH 登录；app 账号入 app-group 才能执行程序区二进制）──
sudo groupadd -f app-group && sudo groupadd -f yunwei-group
sudo id app-edge-sync-agent >/dev/null 2>&1 || \
  sudo useradd -M -s /sbin/nologin -G app-group app-edge-sync-agent

# ── 2) 三目录分离 + SGID 2750 权限切割（程序只读，数据/日志可写）──
sudo mkdir -p /opt/apps/edge-sync-agent /opt/data/edge-sync-agent /opt/log/edge-sync-agent
sudo chown -R root:app-group /opt/apps/edge-sync-agent && sudo chmod -R 2750 /opt/apps/edge-sync-agent
sudo chown -R app-edge-sync-agent:yunwei-group /opt/data/edge-sync-agent /opt/log/edge-sync-agent
sudo chmod -R 2750 /opt/data/edge-sync-agent /opt/log/edge-sync-agent
sudo chmod -R a+x /opt/apps/edge-sync-agent/bin/   # mac tar 丢可执行位，补位
sudo chown -R root:app-group /opt/apps/edge-sync-agent/bin/   # 补位后收回属组（防篡改）

# ── 3) 解压（若尚未解压） + symlink 到 ExecStart 对应二进制 + 注册 unit ──
sudo tar -xzf "$TARBALL" -C /opt/apps/edge-sync-agent --strip-components=1
sudo ln -sf /opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64 /opt/apps/edge-sync-agent/edge-sync-agent
sudo install -m 0644 /opt/apps/edge-sync-agent/packaging/edge-sync-agent.service /etc/systemd/system/

# ── 4) 运行身份 + 环境变量用 drop-in 注入（勿 cat >> 改原 unit，否则落 [Install] 被忽略）──
sudo mkdir -p /etc/systemd/system/edge-sync-agent.service.d
sudo tee /etc/systemd/system/edge-sync-agent.service.d/site.conf >/dev/null <<'EOF'
[Service]
User=app-edge-sync-agent
Group=app-edge-sync-agent
Environment=NETWORK_DOMAIN_ID=<DOMAIN_ID>
Environment=TOKEN=<DOMAIN_TOKEN>
Environment=CENTER_ENDPOINT=<中心或隧道 8080 根 URL>
Environment=EDGE_CONFIG_ROOT=/opt/data/edge-sync-agent/edge-config
Environment=EDGE_WAL_DIR=/opt/data/edge-sync-agent/vmagent-cache
Environment=EDGE_COLLECTOR_BIN=/opt/apps/edge-sync-agent/bin/vmagent-linux-amd64
Environment=EDGE_BLACKBOX_BIN=/opt/apps/edge-sync-agent/bin/blackbox_exporter-linux-amd64
Environment=EDGE_COLLECTOR_ADDR=127.0.0.1:8429
Environment=EDGE_PROM_HEALTH_URL=http://127.0.0.1:8429/health
Environment=EDGE_BLACKBOX_ADDR=127.0.0.1:9115
EOF

# ── 5) 启动 + 双重核验（进程归属必须是 app-edge-sync-agent，非 root）──
sudo systemctl daemon-reload && sudo systemctl enable --now edge-sync-agent
sudo systemctl status edge-sync-agent --no-pager
ps -eo user,pid,cmd | grep edge-sync-agent
sudo journalctl -u edge-sync-agent -n 30 -l --no-pager
```

> 实测结论：此套命令已在腾讯云 Ubuntu（`yunwei-chenrt` 账户）跑通——`systemd` 显示 `active (running)`，
> 进程属主为 `app-edge-sync-agent`。四能力是否回传中心见 §2.7 验证。

### 2.4 建 edge 域 + 纳管（remote_write_url 指 9090 隧道）

```bash
BASE=http://localhost:8080/api/v2/platform
curl -s -X POST "$BASE/network-domains" -H 'Content-Type: application/json' -d '{
  "name": "腾讯云调试边缘域", "domain_type": "edge", "zone_type": "internet", "domain_code": "edge-debug"
}' | jq '.data.id'                                       # 记 DOMAIN_ID

curl -s -X POST "$BASE/network-domains/$DOMAIN_ID/monitor" -H 'Content-Type: application/json' \
  -d "{\"remote_write_url\": \"$TUNNEL_9090/api/v1/write\", \"description\": \"调试期跨公网边缘\"}" | jq '.data.token'
# 记 DOMAIN_TOKEN（一次性明文）；remote_write_url 必须指 9090 隧道（非 8080，见 §4 坑 1）
```

### 2.5 资源 + Job + 草稿确认（复用方案 A §4/§5）

- standard Job：目标抓 vmagent 自身 `127.0.0.1:8429`（`instance_ip=127.0.0.1`, `port=8429`）。
- blackbox Job：`blackbox_targets` 填公网可达 URL（如 `http://example.com`）。
- 两个 Job ready → 生成草稿 → 确认下发（agent_pull 登记 pending）。

### 2.6 腾讯云启动采集节点 agent

```bash
ssh ubuntu@<腾讯云IP>
export NETWORK_DOMAIN_ID=<DOMAIN_ID> TOKEN=<DOMAIN_TOKEN>
export CENTER_ENDPOINT=$TUNNEL_8080               # 心跳/拉包，8080 隧道
export EDGE_CONFIG_ROOT=/opt/data/edge-sync-agent/edge-config
export EDGE_WAL_DIR=/opt/data/edge-sync-agent/vmagent-cache
export EDGE_COLLECTOR_BIN=/opt/apps/edge-sync-agent/bin/vmagent-linux-amd64
export EDGE_BLACKBOX_BIN=/opt/apps/edge-sync-agent/bin/blackbox_exporter-linux-amd64
export EDGE_COLLECTOR_ADDR=127.0.0.1:8429 EDGE_PROM_HEALTH_URL=http://127.0.0.1:8429/health
export EDGE_BLACKBOX_ADDR=127.0.0.1:9115
/opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64
```

### 2.7 验证四能力（复用方案 A §7）

拉包（`ls /opt/data/edge-sync-agent/edge-config/*/` 见 prometheus.yml/targets/metadata.json）→
vmagent 上报（中心 9090 查 `up`，含 `network_domain_id`）→ blackbox 拨测（`probe_success`）→ supervisor 守护（kill vmagent 自动重启）。

---

## 3. 阶段二：预生产/生产（全上云，打包方案拆两份）

> 与调试期差异：中心不再留本地，也不再用隧道；中心与采集节点都在腾讯云内网/同机互通。
> 打包方案**明确拆为两份独立产物**，各自按 `/opt` 三目录规范部署。

### 3.1 中心侧打包方案（中心一体化交付包）

依赖 CGO(SQLite)，最稳做法是 **Ubuntu 本机构建**（或本地 mac `zig` 交叉，见 package-center-guide §3）。

```bash
# 在腾讯云（或 mac+zig）执行
bash setup.sh
WITH_ALERTMANAGER=1 WITH_BLACKBOX=1 make package-center   # 全量五件套
# 产物：dist/metric-center-bundle-linux-amd64-<ts>.tar.gz
```

部署到 `/opt` 三目录（决策 64）：

```bash
tar -xzf metric-center-bundle-*.tar.gz && cd metric-center-bundle-*/
sudo bash scripts/install.sh     # 核验/预建 /opt/apps、/opt/data、/opt/log → 入驻 → seed 活配置
sudo -u app-metric-center /opt/apps/metric-center/script/start.sh
```

目录：`/opt/apps/metric-center/`（程序+种子只读）、`/opt/data/metric-center/`（TSDB/SQLite/config-output 活配置）、
`/opt/log/metric-center/`（日志）。端口/保留策略改 `env/env.sh`。

### 3.2 采集节点侧 edge-sync-agent 打包方案

纯 Go，本地 mac 直接交叉，无 CGO 依赖：

```bash
make build-edge-package
# 产物：dist/edge-package/edge-sync-agent-<v>-linux-amd64-<ts>.tar.gz
# 内含 bin/（三件套 amd64+arm64）+ packaging/edge-sync-agent.service + start.sh + release_meta.json
```

部署到腾讯云 `/opt`（程序只读 + 数据独立盘，同 §2.3）：

```bash
sudo mkdir -p /opt/apps/edge-sync-agent /opt/data/edge-sync-agent
sudo tar -xzf edge-sync-agent-*.tar.gz -C /opt/apps/edge-sync-agent --strip-components=1
# 解压后二进制在 bin/ 子目录（arch 后缀）；unit 的 ExecStart 指顶层 /opt/apps/.../edge-sync-agent，
# 需按架构做 symlink（或直接改 unit ExecStart 指向 bin/ 下对应二进制）：
sudo ln -sf /opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64 \
            /opt/apps/edge-sync-agent/edge-sync-agent
sudo install -m 0644 /opt/apps/edge-sync-agent/packaging/edge-sync-agent.service /etc/systemd/system/
# 运行身份与环境变量【必须用 drop-in，禁止 cat >> 追加进原 unit（会落进 [Install] 被忽略）】：
mkdir -p /etc/systemd/system/edge-sync-agent.service.d
cat > /etc/systemd/system/edge-sync-agent.service.d/site.conf <<'EOF'
[Service]
User=app-edge-sync-agent
Group=app-edge-sync-agent
Environment=NETWORK_DOMAIN_ID=<DOMAIN_ID>
Environment=TOKEN=<DOMAIN_TOKEN>
Environment=CENTER_ENDPOINT=<中心或隧道 8080>
Environment=EDGE_CONFIG_ROOT=/opt/data/edge-sync-agent/edge-config
Environment=EDGE_WAL_DIR=/opt/data/edge-sync-agent/vmagent-cache
Environment=EDGE_COLLECTOR_BIN=/opt/apps/edge-sync-agent/bin/vmagent-linux-amd64
Environment=EDGE_BLACKBOX_BIN=/opt/apps/edge-sync-agent/bin/blackbox_exporter-linux-amd64
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now edge-sync-agent
```

### 3.3 生产连通与验证要点

- `CENTER_ENDPOINT`：中心内网地址 `http://<中心内网IP>:8080`（同机 `127.0.0.1`）。
- `remote_write_url`：中心 Prometheus `/api/v1/write`（`http://<中心内网IP>:9090/api/v1/write`），
  跨机时 9090 仅内网放行，**勿对公网暴露**。
- 四能力验证同 §2.7；中心 UI 经 `http://<中心IP>:8080/` 远程核对。

---

## 4. 排查

| 现象 | 最可能原因 | 定位 |
|------|-----------|------|
| agent 心跳 401/404 | `CENTER_ENDPOINT` 用了 9090 隧道或带多余路径 | 用 8080 隧道/中心内网根 URL，agent 自行拼 `/api/v2/platform/edge/*` |
| 中心查不到指标 | remote_write 被推导到 8080（无 write 接口） | 纳管填 9090 隧道 `/api/v1/write` 或设 `EDGE_REMOTE_WRITE_URL` |
| 隧道重连后 agent 断连 | quick tunnel URL 变了 | 刷新 `CENTER_ENDPOINT` + 重纳管 `remote_write_url`；生产不用隧道 |
| 边缘写不进 `/opt/apps/.../edge-config` | 程序目录只读，配置落点错误 | `EDGE_CONFIG_ROOT`/`EDGE_WAL_DIR` 指 `/opt/data/edge-sync-agent/`（可写） |
| `/opt/...` 三目录不存在、install 报错 | 运维未预建目录 | 预建 + SGID 2750 + 属组（package-center-guide §2.4） |
| mac 交叉打包后本地 `make run-*` 失败 | `CROSS` 把本机二进制覆盖为 ELF | 重跑原生 `make build-center` 恢复 |
| 启动报 `Permission denied` | mac tar 丢了可执行位 | `sudo chmod -R a+x /opt/apps/edge-sync-agent/bin/` |
| unit 日志 `Unknown key 'Environment' in section 'Install'`、进程仍 root | `cat >>` 追加键落进 `[Install]` | 用 drop-in `*.service.d/site.conf`，勿改原 unit |
| `sudo useradd` 报 `unknown item 'umask'` | 腾讯云 libuser 配置项不被识别 | 注释 `/etc/libuser.conf` 的 `umask` 行后重试 |
| 拉包失败 `Get "/api/v2/platform/edge/config?network_domain=..."` unsupported protocol scheme "" | 旧中心 `configDownloadURL` 依赖从未赋值的 `dom.CenterEndpoint`，拼出无 host 的相对 URL | 升级中心：用 `requestAuthority` 按 `X-Forwarded-Proto/Host` 优先（cloudflared 注入）、回落请求 Host+TLS 推导；重编译重启中心 |
| 心跳在重编译后变 `http 530` / CF error 1033「unable to resolve」 | **中心重编译不背锅**：cloudflared 隧道进程独立于 metric-center；530 是隧道侧无法到达 origin | 确认 8080 隧道进程还活着（`ps aux|grep cloudflared`），且 `lsof -i tcp:8080` 有 metric-center 监听。quick tunnel 域名**重启即变** |
| 终端 3/4 各起一条 quick tunnel，后起的把先起的那条隧道进程杀掉 | cloudflared 同源互杀：同名 quick tunnel 只保最新一条 | **不要**用两条并列 `cloudflared tunnel --url`；改成环回落地 + 单隧道，或用命名隧道绑定固定域名。见 §4.1 |
| 换 8080 隧道域名后 agent 心跳仍指旧域名 | 心跳的 `CENTER_ENDPOINT` 是 agent 侧写死，不自动跟新 | 拉包 URL 会自动跟新（中心按请求来源动态生成），但**心跳**要手工刷新 `CENTER_ENDPOINT` 为当前 8080 隧道域名并 `systemctl restart` |
| 中心 9090 只见 local 域数据、看不到边缘域 `up` | remote_write 未从边缘透传到中心 9090 | 确认 9090 隧道进程活着、agent `remoteWrite.url` 生效 |
| 拨测无数据 | 无 `job_type=blackbox` Job | 建 blackbox Job 后重新 confirm |

---

## 4.1 隧道稳定性：避免 cloudflared 同源互杀（中心重编译不影响隧道）

> 结论：**重编译/重启中心（metric-center）不影响隧道**。cloudflared 是独立进程，替换中心二进制后再起 8080 进程，隧道不受扰。隧道「消失 530」只可能是：① cloudflared 进程被杀；② quick tunnel 域名重启即变，agent 仍指旧域名。

cloudflared 对同名 quick tunnel 是「后启杀先」，终端 3/4 两条并列会互踩。稳妥做法：**只开 8080 一条，9090 用落盘直连**——调试期所需三端口均经同一隧道暴露：

```bash
# 隧道 A：8080 → 中心控制面（心跳/拉包/前端）
cloudflared tunnel --url http://localhost:8080 --no-autoupdate   # 记 TUNNEL_8080，重启域名会变
# 隧道 B：9090 → Prometheus remote_write（用命名隧道固定域名，避免互杀与域名漂移）
cloudflared tunnel create center-9090 && cloudflared tunnel route dns center-9090 <固定域名>
cloudflared tunnel --no-autoupdate run center-9090 --config <(cat <<'EOF'
tunnel: center-9090
credentials-file: /Users/chenrt/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: <固定域名>
    service: http://localhost:9090
EOF
)
```

若坚持用两条并列 quick tunnel（调试一次性场景），**务必分终端启动、并先启动 9090 再启动 8080**，且互杀后用 `ps aux | grep cloudflared` 核对两条都存活；一旦域名变化，按 §4 排查表「换 8080 隧道域名」更新 agent `CENTER_ENDPOINT`。

**重编译中心的正确动线**（不碰隧道）：
```bash
# 本地 mac：升级中心二进制 → 重启 8080 进程（cloudflared 隧道进程保持不动）
lsof -ti tcp:8080 | xargs kill 2>/dev/null
make build-metric-center && make run-metric-center
# agent 无需改，~30s 心跳周期内自动重新连上当前隧道域名
```

## 4.2 换包重启动线（agent 代码升级后 remote_write_url 生效）

> 背景（F-9）：跨主机联调发现边缘域监控目标为空，根因是 agent 侧**双缺陷**——
> ① 旧 `marshalMetadata` 重写落盘 `metadata.json` 时丢弃 `remote_write_url`，probe 读到空值回退到
> 8080「center_endpoint 推导」；② `promReload` 仅 SIGHUP 热加载，改不了 vmagent 启动时固定的
> `-remoteWrite.url`。修复后：`marshalMetadata` 透传该字段 + 新增 `ProcProbe.Reload`（参数变化时
> Stop+Start 重启 vmagent）。**已落盘的旧版本目录 metadata.json 仍缺该字段**，故换二进制后必须
> 触发一次「新的 config_version 串」重拉才生效。

**本机 build（mac）产出新包**：
```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
make build-edge-package
# 产物：dist/edge-package/edge-sync-agent-v0.2.0-linux-amd64-<ts>.tar.gz
```

**上传 + 替换 + 重启（腾讯云）** ：
```bash
# ── 1) 本机 scp 上传（<HOST>/<ns> 填你的腾讯云地址/网段；系统账户 yunwei-chenrt）──
scp "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature/dist/edge-package/edge-sync-agent-v0.2.0-linux-amd64-<ts>.tar.gz" \
    yunwei-chenrt@<TENCENT_HOST>:~/

# ── 2) 云端：停服务 → 解压覆盖（保留 /opt/data 数据与 site.conf 不动；二进制在 bin/ 子目录）──
systemctl stop edge-sync-agent
cd /tmp && sudo rm -rf edge-new && sudo mkdir -p edge-new
sudo tar -xzf ~/edge-sync-agent-v0.2.0-linux-amd64-<ts>.tar.gz -C edge-new
# 只替换程序区 bin/ 子目录三件套；symlink（ExecStart=/opt/apps/edge-sync-agent/edge-sync-agent
# → bin/edge-sync-agent-linux-amd64）自动指向新文件，勿动
sudo cp edge-new/bin/edge-sync-agent-linux-amd64 /opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64
sudo cp edge-new/bin/vmagent-linux-amd64            /opt/apps/edge-sync-agent/bin/vmagent-linux-amd64
sudo cp edge-new/bin/blackbox_exporter-linux-amd64 /opt/apps/edge-sync-agent/bin/blackbox_exporter-linux-amd64
sudo chmod 755 /opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64
# 若顶层 symlink 尚不存在，执行：sudo ln -sf bin/edge-sync-agent-linux-amd64 /opt/apps/edge-sync-agent/edge-sync-agent

# ── 3) (可选) 立即强制走 9090 数据隧道：drop-in 注入 EDGE_REMOTE_WRITE_URL（档位②，高于推导）──
# sudo tee /etc/systemd/system/edge-sync-agent.service.d/site.conf 追加一行：
#   Environment=EDGE_REMOTE_WRITE_URL=https://<9090隧道域名>/api/v1/write
# 否则依赖下面第 4 步的中心新版本包（档位① metadata 下发）即可。

# ── 4) 启动 + 依赖中心触发新版本 ──
systemctl start edge-sync-agent
```

**中心触发新版本重拉（必要条件，勿漏）**：
```bash
# 中心按 config_version 串判定 config_changed；必须产生「新的版本串」agent 才重拉。
# 任一制造变更方式：改 scrape_jobs/<id> 的 scrape_interval（如 15s→20s）→ PUT
# → 生成新变更单 → 确认 → 下发。agent Apply 落新版本目录 → probe.Reload 检测到
# remote_write_url 变化 → 自动重启 vmagent → -remoteWrite.url 指向 9090。
```

**生效验证**：
```bash
# 腾讯云：vmagent 命令行 -remoteWrite.url 应变为 9090 数据隧道（非 8080 控制面）
ps aux | grep vmagent | grep -o -- '-remoteWrite.url=[^ ]*'
# 中心：9090 查网域身份标签指标已上报
# http://127.0.0.1:9090 查询：
#   up{network_domain_id="mc-edge-debug"}
# 前端「监控目标」非空；下发记录 success、Job 变更进度 deployed。
```

**故障对应**：
- 换包后仍指向 8080：多半是旧版本目录 metadata.json 仍缺 remote_write_url → 确认第 4 步真实产生了新版本串并已被 agent 拉取订阅（心跳 config_version 更新）。
- drop-in 改 env 后不生效：`systemctl daemon-reload && systemctl restart edge-sync-agent`；确认变量写进 `[Service]` 段而非 `[Install]`（见 §2.3.1 步骤 4）。

---

## 5. 清理

```bash
# 调试期：Ctrl-C 停 agent、两条 cloudflared、make run-prometheus、make run-metric-center
# 生产：systemctl stop edge-sync-agent；/opt/apps/metric-center/script/stop.sh
lsof -i :8080 -i :9090 -i :8429 -i :9115
```

测试结论登记至 `docs/05-execution-records/integration/v0.2/issues.md` 或模块 dev-feedback。