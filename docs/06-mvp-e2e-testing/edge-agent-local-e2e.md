# Edge Agent 本地端到端测试手册（拉包 + vmagent 采集上报 + blackbox 拨测）

> 目标：在本地单机跑通「edge-sync-agent 心跳 → 中心判定 config_changed → 拉取配置包 →
> supervisor 拉起 vmagent 抓取上报 + blackbox_exporter 拨测」的完整闭环。
>
> 覆盖缺口：G1（中心 receiver）+ G1-02（remote_write_url 注入）+ 决策 88（采集器统一 vmagent）。
>
> 与 [README.md](README.md)（`default` 域 local 通道）的关系：本手册测试的是**边缘 agent_pull 通道**，
> 动线不同——网域必须用**新增 edge 域**，不能复用 `default`（default 固定 `channel=local` 直发中心，
> 不走 edge 协议，见 `configcenter/domain/service.go`）。

---

## 0. 动手前必读的 4 个事实（不理解就会误判）

1. **本机架构 vs 交叉编译产物（最易踩的坑）**：
   - `make build-vmagent` 产出 `platform/edge-sync-agent/dist/vmagent-linux-{amd64,arm64}`（**linux 交叉编译**）；
   - `make build-edge-agent` 同理产出 linux 产物；
   - `make build-blackbox-edge` 也是 linux 产物。
   这些**在本机 (macOS/darwin) 跑不了**，只能用于打边缘交付包。本机测试必须**本机架构编译**
   （见 §1），不要用上面三个 Makefile target。

2. **edge agent 走 `agent_pull` 通道，必须用新增 edge 域**：
   `POST /network-domains/:id/monitor` 对非 `default` 域固定 `channel=agent_pull` + `agent_type=vmagent`，
   自动签发 token（明文仅纳管/重置单次返回）。confirm 后中心**不写盘**，只登记 pending 占位；
   真正下发由 agent 心跳拉包完成（`configcenter/deployment/service.go:60` 注释）。

3. **blackbox 能力由 `job_type=blackbox` 的 Job 触发**：
   只有存在 `JobTypeBlackbox` 的 Job，generator 才生成 `blackbox.yml`（`generator/render.go:118`），
   zip 才含 blackbox 条目，supervisor 才会拉起 blackbox_exporter。没有 blackbox Job 时
   `blackbox.yml` 为空、blackbox 进程不启动。

4. **vmagent 上报中心依赖中心 receiver**：中心 Prometheus 必须开 `--web.enable-remote-write-receiver`
   （G1-01 已固化进 `make run-prometheus`），且 remote_write_url 由 agent 按
   `metadata > env > center_endpoint 推导 > 环回` 解析（G1-02）。

---

## 1. 准备本机架构二进制

```bash
cd /Users/chenrt/S-03Python/03\ AIopsAgent-study/CNCF_Monitor-feature

# 1) edge-sync-agent（本机架构；勿用 make build-edge-agent=linux）
cd platform/edge-sync-agent
../../.tools/go/bin/go build -o /tmp/edge-sync-agent ./cmd/edge-sync-agent
cd ../..

# 2) vmagent（本机架构；VictoriaMetrics 独立 module，入口 app/vmagent；勿用 make build-vmagent=linux）
cd upstream/victoria-metrics
../../.tools/go/bin/go build -o /tmp/vmagent ./app/vmagent
cd ../..

# 3) blackbox_exporter（make build-blackbox-exporter 本就是主机架构，本机可跑）
make build-blackbox-exporter
# 产物：upstream/blackbox_exporter/blackbox_exporter
```

验证三个二进制存在：

```bash
ls -la /tmp/edge-sync-agent /tmp/vmagent upstream/blackbox_exporter/blackbox_exporter
```

---

## 2. 启动中心端（2 个进程）

```bash
cd /Users/chenrt/S-03Python/03\ AIopsAgent-study/CNCF_Monitor-feature

# 终端 1：Prometheus（:9090，receiver 已开，监听 127.0.0.1）
make run-prometheus

# 终端 2：控制面（:8080）
make run-metric-center

# 终端 3（可选，样本采集端，供 vmagent 抓取"UP"判据）：
cd platform/examples/simple-agent && ../../../.tools/go/bin/go run . -listen-address ":9100" -app-name "demo-app" -env "test"
```

环境自检：

```bash
curl -s http://localhost:8080/api/v1/health | jq .                  # success
curl -s -X POST http://localhost:9090/-/reload -o /dev/null -w '%{http_code}\n'   # 200
```

---

## 3. 建 edge 域并纳管（拿 token）

约定：

```bash
BASE=http://localhost:8080/api/v2/platform
```

### Step A：登记 edge 域（M06）

```bash
curl -s -X POST "$BASE/network-domains" -H 'Content-Type: application/json' -d '{
  "name": "本地边缘域",
  "domain_type": "edge",
  "zone_type": "internet",
  "domain_code": "edge-local"
}' | jq '.data | {id, name, domain_type, status}'
```

```bash
DOMAIN_ID=<上一步返回的 data.id>   # 形如 mc-edge-local
```

### Step B：纳管（M09，签发 token）

```bash
curl -s -X POST "$BASE/network-domains/$DOMAIN_ID/monitor" \
  -H 'Content-Type: application/json' \
  -d '{"remote_write_url": "http://127.0.0.1:9090/api/v1/write", "description": "本地边缘测试"}' | jq .
# 期望 data.token 非空（agent_pull 一次签发明文）；data.channel=agent_pull, agent_type=vmagent
```

```bash
DOMAIN_TOKEN=<上一步返回的 data.token>
```

> token 明文仅在这次纳管（或 `POST /network-domains/:id/reset-token`）返回一次，务必保存。
> 忘记可 `reset-token` 重置重新获取（仅 agent_pull 已纳管网域允许）。

---

## 4. 建资源 + 采集 Job（standard 测 vmagent，blackbox 测拨测）

与 README 动线一致，区别是 `network_domain_id` 换成上面的 `$DOMAIN_ID`。

### 4.1 standard Job（vmagent 抓取上报，目标指向本机 simple-agent :9100）

```bash
# Step 1 建资源（middleware kafka，port 9100 → UP 判据）
curl -s -X POST "$BASE/resources" -H 'Content-Type: application/json' -d "{
  \"resource_category\": \"middleware\",
  \"network_domain_id\": \"$DOMAIN_ID\",
  \"biz_code\": \"authorized-ops\",
  \"app_name\": \"demo-app\",
  \"cluster\": \"demo-cluster\",
  \"middleware_type\": \"kafka\",
  \"instance_ip\": \"127.0.0.1\",
  \"port\": 9100,
  \"env\": \"test\",
  \"status\": \"online\"
}" | jq '.data | {resource_id}'
```

```bash
RESOURCE_ID=<上一步返回的 data.resource_id>
```

```bash
# Step 2 建 standard Job
curl -s -X POST "$BASE/scrape-jobs" -H 'Content-Type: application/json' -d "{
  \"job_name\": \"edge-demo-kafka-9100\",
  \"job_type\": \"standard\",
  \"monitor_type\": \"kafka\",
  \"network_domain_id\": \"$DOMAIN_ID\",
  \"instance_selection_mode\": \"manual\",
  \"selected_instance_ids\": [\"$RESOURCE_ID\"],
  \"scrape_interval\": \"15s\",
  \"scrape_timeout\": \"10s\",
  \"metrics_path\": \"/metrics\",
  \"scheme\": \"http\",
  \"auth_type\": \"none\"
}" | jq '.data | {id, job_name}'
```

```bash
STD_JOB_ID=<上一步返回的 data.id>
```

### 4.2 blackbox Job（拨测，触发 blackbox.yml 生成）

```bash
curl -s -X POST "$BASE/scrape-jobs" -H 'Content-Type: application/json' -d "{
  \"job_name\": \"edge-blackbox-http\",
  \"job_type\": \"blackbox\",
  \"network_domain_id\": \"$DOMAIN_ID\",
  \"blackbox_module\": \"http_2xx\",
  \"blackbox_targets\": [{\"target\": \"http://localhost:9090/-/healthy\", \"protocol\": \"http\"}]
}" | jq '.data | {id, job_name, blackbox_module}'
```

```bash
BB_JOB_ID=<上一步返回的 data.id>
```

### 4.3 两个 Job 提交 ready

```bash
curl -s -X POST "$BASE/scrape-jobs/batch-draft-status" \
  -H 'Content-Type: application/json' \
  -d "{\"ids\": [$STD_JOB_ID, $BB_JOB_ID]}" | jq .
# 期望：draft_status=ready, change_status=pending
```

---

## 5. 生成配置草稿并确认下发（agent_pull）

```bash
curl -s -X POST "$BASE/config/drafts" -H 'Content-Type: application/json' \
  -d "{\"network_domain_id\": \"$DOMAIN_ID\"}" | jq .
```

```bash
CHANGE_NO=<上一步返回的 data.change_no>
```

```bash
curl -s -X POST "$BASE/config-drafts/$CHANGE_NO/confirm" \
  -H 'Content-Type: application/json' \
  -d '{"confirmed_by": "tester"}' | jq .
# agent_pull 通道：confirm 生成 ConfigVersion + 登记 pending 占位下发记录（不写盘），返回 ConfigVersion
```

核查（可选）：

```bash
curl -s "$BASE/deployments?network_domain_id=$DOMAIN_ID" | jq '.data.items[0] | {channel, status, includes_blackbox}'
# 期望：channel=agent_pull, status=pending, includes_blackbox=true
```

---

## 6. 启动 edge-sync-agent（模拟边缘，本机）

```bash
export NETWORK_DOMAIN_ID=$DOMAIN_ID
export TOKEN=$DOMAIN_TOKEN
export CENTER_ENDPOINT=http://127.0.0.1:8080
export EDGE_CONFIG_ROOT=/tmp/edge-config
export EDGE_COLLECTOR_BIN=/tmp/vmagent
export EDGE_BLACKBOX_BIN=/Users/chenrt/S-03Python/03\ AIopsAgent-study/CNCF_Monitor-feature/upstream/blackbox_exporter/blackbox_exporter
export EDGE_COLLECTOR_ADDR=127.0.0.1:8429
export EDGE_PROM_HEALTH_URL=http://127.0.0.1:8429/health
export EDGE_BLACKBOX_ADDR=127.0.0.1:9115
export EDGE_WAL_DIR=/tmp/edge-vmagent-cache

/tmp/edge-sync-agent
```

> agent 日志会输出心跳、`config_changed` 判定、拉包、supervisor 拉起 vmagent / blackbox 的过程。
> 首次心跳时上报 config_version 为空，中心返回 `config_changed=true`，触发首拉配置包。

---

## 7. 验证四能力

### 7.1 拉取配置（zip 落地）

```bash
ls /tmp/edge-config/*/
# 期望包含：prometheus.yml、targets/edge-demo-kafka-9100.json、blackbox.yml、metadata.json
cat /tmp/edge-config/*/metadata.json | jq .   # 含 config_version / agent_type / checksum / remote_write_url
```

### 7.2 vmagent 抓取上报（8429 探活 + 中心 9090 可查指标）

```bash
curl -s http://127.0.0.1:8429/health                              # 期望 OK/200
curl -s 'http://localhost:9090/api/v1/query?query=up{job="edge-demo-kafka-9100"}' | jq '.data.result[].value'
# 期望：[<ts>, "1"]（simple-agent 在 9100 监听时）
# 且标签含 network_domain_id（G1-03 外部 labels 贯通验证）
curl -s 'http://localhost:9090/api/v1/query?query=up' | jq '.data.result[] | {job: .metric.job, domain: .metric.network_domain_id}'
```

### 7.3 blackbox 拨测（9115 TCP 探活 + 拨测指标回中心）

```bash
nc -zv 127.0.0.1 9115                                            # 期望端口可达
curl -s 'http://localhost:9090/api/v1/query?query=probe_success{job="edge-blackbox-http"}' | jq '.data.result[] | {target: .metric.instance, value: .value}'
# 期望：value="1"（blackbox_exporter 拨测本机 9090 /-/healthy 成功）
```

### 7.4 supervisor 守护（进程重启 + 心跳可观测）

```bash
kill $(pgrep vmagent)
# 等数秒，vmagent 被 supervisor 自动重启；日志出现 restart 记录
curl -s http://127.0.0.1:8429/health                             # 恢复 OK

# 中心可观测心跳与组件状态：
curl -s "$BASE/edge-agents" | jq '.data[0] | {hostname, status, collector_version, last_heartbeat}'
```

浏览器对照：`http://localhost:9090/targets` 出现 `edge-demo-kafka-9100`（state=UP）；
`http://localhost:9090/graph` 可查 `up` / `probe_success`；`http://localhost:5173` 采集节点状态页可看该 agent。

---

## 8. 常见失败排查

| 现象 | 最可能原因 | 定位 |
|------|-----------|------|
| dom.token 为空 / token 不匹配 401 | 用了 `default` 域（local，拒绝走 edge 协议）或 token 丢失 | §0 事实 2；用新增 edge 域纳管拿 token |
| 心跳后日志仍 `config_changed=false` 且不拉包 | confirm 前 agent 已上报同版本；或未 confirm 生成 ConfigVersion | 先 confirm 再启 agent；或 reset version 后重启 |
| vmagent 启动即退 / `exec: "vmagent": not found` | `EDGE_COLLECTOR_BIN` 指向 linux 交叉编译产物或未设 | §0 事实 1：用 `/tmp/vmagent`（本机构建） |
| 中心 9090 查不到 `up` 指标 | 中心未开 receiver；或 remote_write_url 解析成环回但中心不在本机 | `make run-prometheus`（已开 receiver）；§0 事实 4 |
| `probe_success` 无数据 | 无 blackbox Job，`blackbox.yml` 未生成，blackbox 未拉起 | §0 事实 3：建 `job_type=blackbox` Job 后重新 confirm |
| blackbox 进程未起 | `EDGE_BLACKBOX_BIN` 指向 linux 产物或路径错 | 用 `upstream/blackbox_exporter/blackbox_exporter`（主机架构） |
| 草稿校验 pending「promtool/blackbox_exporter 不可调用」 | PATH 未含上游二进制目录 | 用 `make run-metric-center` 启动（已自动加 PATH） |
| 下发记录 status=pending 而非 success | agent_pull 通道正确行为（占位，由 agent 拉包生效） | §0 事实 2，非失败 |

---

## 9. 归档与清理

```bash
# 停止 agent：Ctrl-C
# 停止中心各终端；确认端口释放
lsof -i :8080 -i :9090 -i :8429 -i :9115 -i :9100
```

测试结论登记至 `docs/05-execution-records/integration/v0.2/issues.md` 或模块 dev-feedback。