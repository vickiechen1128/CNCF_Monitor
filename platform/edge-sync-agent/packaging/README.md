# Edge Sync Agent 离线部署包

版本：__VERSION__（Module_11）

`edge-sync-agent` 是部署在边缘监控代理节点的独立守护进程。它向上以 outbound HTTPS + 每网域
Token 与中心通信（心跳上报 / 配置包拉取 / remote_write），本地作为 supervisor 守护并编排
采集器（vmagent）与 blackbox_exporter 子进程。

## 目录说明

- `bin/`  三件套二进制（linux/amd64 + linux/arm64，部署机按架构选装）：
  `edge-sync-agent-*`（守护）/ `vmagent-*`（采集器）/ `blackbox_exporter-*`（拨测器）
- `packaging/edge-sync-agent.service`  systemd 守护单元（父进程模式、TimeoutStopSec=15、CAP_NET_RAW 注释）
- `start.sh`  安装引导（systemd 优先；无 systemd 时前台快速验证）

## 部署（生产建议 systemd）

> **目录规范（对齐中心三目录「程序只读 / 数据可写」基线）**：
> - 程序（只读）：`/opt/apps/edge-sync-agent/`（`bin/` + `packaging/` + `start.sh`）；
> - 数据（可写，独立数据盘）：`/opt/data/edge-sync-agent/`（配置包落 `EDGE_CONFIG_ROOT`、vmagent 队列落 `EDGE_WAL_DIR`）。
> 生产建议把 `EDGE_CONFIG_ROOT` / `EDGE_WAL_DIR` 指向 `/opt/data/edge-sync-agent/`（含下面 systemd
> `Environment=` 覆盖），保持程序目录只读、避免配置/缓存写入程序目录。

```bash
sudo mkdir -p /opt/apps/edge-sync-agent /opt/data/edge-sync-agent
sudo tar -xzf edge-sync-agent-*.tar.gz -C /opt/apps/edge-sync-agent --strip-components=1
sudo ln -sf /opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64 \
             /opt/apps/edge-sync-agent/edge-sync-agent
sudo install -m 0644 /opt/apps/edge-sync-agent/packaging/edge-sync-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
# 编辑 unit 的 [Service] Environment=，填写三项必填 + 数据目录覆盖：
#   NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT
#   EDGE_CONFIG_ROOT=/opt/data/edge-sync-agent/edge-config
#   EDGE_WAL_DIR=/opt/data/edge-sync-agent/vmagent-cache
sudo systemctl enable --now edge-sync-agent
```

- 默认 ExecStart 指向 `/opt/apps/edge-sync-agent/edge-sync-agent`；如需改安装目录，
  同步修改 unit 的 ExecStart 与配置文件落点（`EDGE_CONFIG_ROOT`）。
- 状态查看：`sudo systemctl status edge-sync-agent`
- 停止：`sudo systemctl stop edge-sync-agent`

## 手动运行（无 systemd 的临时/调试/容器场景）

```bash
export NETWORK_DOMAIN_ID=xxx TOKEN=xxx CENTER_ENDPOINT=https://<center>:8080
./start.sh                                   # 或 ./bin/edge-sync-agent-linux-<arch>
./bin/edge-sync-agent-linux-amd64 -version   # 打印版本与平台
./bin/edge-sync-agent-linux-amd64 -help      # 参数
```

## 必填环境变量

| 变量 | 说明 |
|------|------|
| `NETWORK_DOMAIN_ID` | 网域 ID（中心纳管网域时获取，决定配置子目录 `config-<domain>`） |
| `TOKEN` | 网域接入 Token（中心门户生成；重置后需到节点更新并重启 Agent） |
| `CENTER_ENDPOINT` | 中心地址，**必须带协议头**，如 `https://mc.example.com:8080` |

## 可选环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `EDGE_AGENT_TYPE` | `vmagent` | 采集器类型 |
| `EDGE_AGENT_VERSION` | `dev` | 心跳上报的 Agent 版本 |
| `EDGE_CONFIG_ROOT` | `/opt/apps/edge-sync-agent/edge-config` | 配置包版本落盘根（生产建议指 `/opt/data/...`） |
| `EDGE_WAL_DIR` | `<version>/vmagent-cache` | vmagent 抓取缓存目录（生产建议指 `/opt/data/...`） |
| `EDGE_COLLECTOR_BIN` / `EDGE_BLACKBOX_BIN` | PATH 内 `vmagent` / `blackbox_exporter` | 子进程可执行文件 |
| `EDGE_COLLECTOR_ADDR` | `127.0.0.1:8429` | vmagent HTTP 监听地址（改端口见下节） |
| `EDGE_PROM_HEALTH_URL` | `http://127.0.0.1:8429/health` | vmagent 健康探活（**改 `EDGE_COLLECTOR_ADDR` 时必须同步改**） |
| `EDGE_BLACKBOX_ADDR` | `127.0.0.1:9115` | blackbox_exporter 监听与 TCP 探活地址（改端口见下节） |
| `EDGE_REMOTE_WRITE_URL` | 空 | vmagent `-remoteWrite.url`；空时按「配置包 metadata > 本变量 > `CENTER_ENDPOINT` + `/api/v1/write` > 环回兜底」解析，正常无需手工填 |

## 端口与网络策略

**本机监听（默认仅绑回环，不占对外端口，无需网络策略放通）**

| 组件 | 变量 | 默认 | 用途 |
|------|------|------|------|
| vmagent | `EDGE_COLLECTOR_ADDR` | `127.0.0.1:8429` | 本地 HTTP（`/health`、`/targets`、`/-/reload`） |
| blackbox_exporter | `EDGE_BLACKBOX_ADDR` | `127.0.0.1:9115` | 拨测器 HTTP |
| edge-sync-agent | — | 不监听 | outbound-only，只主动发心跳/拉包 |

**需要打通的出站**

| 方向 | 目标 | 默认 | 用途 |
|------|------|------|------|
| 采集节点 → 中心 | `CENTER_ENDPOINT` | 中心 `:8080` | 心跳、拉配置包 |
| 采集节点 → 中心 | `remote_write_url` | 中心 Prometheus `:9090`（或配置包 metadata 下发值） | 指标 remote write |
| 采集节点 → 被采集目标 | 目标自身的端口 | 如 node_exporter `:9100`、中间件自带端口 | 指标抓取 / 拨测 |

**自定义端口**：两个本地监听端口都可用环境变量覆盖，例如 systemd
`Environment=EDGE_COLLECTOR_ADDR=127.0.0.1:18429`。注意 vmagent 改监听地址时必须**同步**覆盖
`EDGE_PROM_HEALTH_URL`（如 `http://127.0.0.1:18429/health`），否则组件会被判为不健康并触发重启。

> 采集器需 `CAP_NET_RAW` 能力（ICMP 拨测）；systemd 部署时按需在 unit 中
> `AmbientCapabilities=CAP_NET_RAW` 开启（unit 内已留注释）。

## 进程守护

- 健康检查双判定：进程存活 + HTTP/TCP 探活，默认 10s 间隔。
- 指数退避重启 5s→60s；滚动窗口 10min 内重启 ≥5 次 → 组件置 `crash_loop`，需人工介入
  （重启 Agent / 重装）后自动恢复（PRD §6.4.2）。
- 启动顺序：blackbox_exporter 先于 collector；配置包含 `blackbox.yml` 时启用拨测器守护。

## 日志

- 优先写本地 `syslog`（Linux），不可用时回落 `stderr`（systemd 下 `journalctl -u edge-sync-agent -f`）。

## 版本与升级

- Agent 版本由 `EDGE_AGENT_VERSION` 注入 main.version。
- 二进制升级：替换 `/opt/apps/edge-sync-agent/edge-sync-agent` → `sudo systemctl restart edge-sync-agent`。
  重启后守护进程从磁盘恢复上次生效 `config_version`（崩溃恢复），无需再次下发。
- 配置升级：新增边缘包后在中心发布新版本，节点心跳会带当前 `config_version`，中心响应新
  `config_download_url`，Agent 自动拉包 → 校验 checksum → 原子切换 → reload；采集进程由
  supervisor 按新配置目录拉起。