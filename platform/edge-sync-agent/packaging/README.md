# Edge Sync Agent 部署说明（Module_11）

`edge-sync-agent` 是部署在边缘监控代理节点的独立守护进程。它向上以 outbound HTTPS + 每网域
Token 与中心通信（心跳上报 / 配置包拉取 / remote_write），本地作为 supervisor 守护并编排
采集器（vmagent/prometheus-agent）与 blackbox_exporter 子进程。

## 目录结构（本 packaging/）
- `edge-sync-agent.service`：systemd unit（父进程模式）

## 安装（systemd）
1. 部署二进制：
   ```bash
   mkdir -p /opt/apps/edge-sync-agent
   install -m 0755 edge-sync-agent /opt/apps/edge-sync-agent/
   ```
2. 编辑并安装 service，在 `[Service].Environment` 填必填项：
   ```bash
   install -m 0644 packaging/edge-sync-agent.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now edge-sync-agent
   ```

## 必填环境变量
| 变量 | 说明 |
|------|------|
| `NETWORK_DOMAIN_ID` | 网域 ID（中心纳管网域时获取） |
| `TOKEN` | 网域接入 Token（中心门户生成，重置后需到节点更新并重启 Agent） |
| `CENTER_ENDPOINT` | 中心地址，如 `https://mc.example.com` |

## 可选环境变量
| 变量 | 默认 | 说明 |
|------|------|------|
| `EDGE_AGENT_TYPE` | `vmagent` | 采集器类型 |
| `EDGE_AGENT_VERSION` | `dev` | 上报版本 |
| `EDGE_CONFIG_ROOT` | `/opt/apps/edge-sync-agent/edge-config` | 配置包版本落盘根目录 |
| `EDGE_WAL_DIR` | `<version>/vmagent-cache` | 采集器（vmagent）抓取缓存目录 |
| `EDGE_COLLECTOR_BIN` / `EDGE_BLACKBOX_BIN` | PATH 内 `vmagent` / `blackbox_exporter` | 子进程可执行文件 |
| `EDGE_REMOTE_WRITE_URL` | 空 | vmagent `-remoteWrite.url`（指标上报中心；空则仅本地抓取） |
| `EDGE_COLLECTOR_ADDR` | `127.0.0.1:8429` | vmagent HTTP 监听地址 |
| `EDGE_PROM_HEALTH_URL` | `http://127.0.0.1:8429/health` | 采集器健康探活 |
| `EDGE_PROM_RELOAD_URL` | `http://127.0.0.1:8429/-/reload` | 采集器 HTTP reload（进程信号失败时回落） |
| `EDGE_BLACKBOX_ADDR` | `127.0.0.1:9115` | 拨测器探活 TCP 地址 |

## 进程守护
- 健康检查双判定：进程存活 + HTTP/TCP 探活，默认 10s 间隔。
- 指数退避重启 5s→60s；滚动窗口 10min 内重启 ≥5 次 → 组件置 `crash_loop`，需人工介入
  （重启 Agent / 重装）后自动恢复（PRD §6.4.2）。
- 启动顺序：blackbox_exporter 先于 collector；配置包含 `blackbox.yml` 时启用拨测器守护。

## 日志
- 优先写本地 `syslog`（Linux），不可用时回落 `stderr`（systemd 下 `journalctl -u edge-sync-agent -f`）。

## 升级
新增边缘包后在中心发布新版本，节点心跳会带当前 `config_version`，中心响应新
`config_download_url`，Agent 自动拉包 → 校验 checksum → 原子切换 → reload；采集进程由
supervisor 按新配置目录拉起。二进制升级需人工替换 + `systemctl restart edge-sync-agent`。
