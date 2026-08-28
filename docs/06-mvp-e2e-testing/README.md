# MVP 配置下发闭环测试指导手册（local 通道）

> 适用版本：MVP（v0.1）。目标：用 curl 走完「资源录入 → 采集 Job → 配置草稿 → 确认下发 →
> Prometheus 真正加载并采到数据」的完整链路，覆盖 M01 / M06 / M07 / M09 的联动。
> 所有端点均已对照 `platform/` 源码核实；如手册与源码冲突，以源码为准并更新本手册。

---

## 1. 动手前必读的 5 个事实（不理解就会误判）

1. **local 下发通道只对 `default` 管理域生效。**
   `configcenter/domain/service.go:83-93`：`default` 域固定 `channel=local`（写盘 + reload），
   通过 API 新建的 edge 域纳管后一律是 `agent_pull`（签发 token、走边缘拉包），**不会写
   `config-output/`**。`default` 域由 `platform/db/seed` 预置（`is_monitored=true`、
   `status=enabled`），**无需也不能通过 API 创建**。本手册所有资源 / Job 都挂在 `default` 域下。

2. **host 类资源的采集目标不带端口。**
   `configcenter/generator/targets.go:14-30`：host 的 target 地址 = `PrivateIP`（裸 IP，Prometheus
   会按 :80 抓取，必然 DOWN）；只有 database / middleware / generic_target 会合成 `ip:port`。
   想看到 `state=UP`，本手册使用 **middleware（kafka 类型）+ port=9100** 的路径。

3. **下发 success 后 Job 回写 `deployed` 有前提。**
   `configcenter/deployment/callback.go:14-22`：仅回写 `change_status=pending` **且**
   `draft_status=ready` 的 Job。没走「提交 ready」就直接生成草稿下发，下发记录是 success
   但 Job 状态不会变 —— 这是设计行为，不是 bug。

4. **两个启动参数已固化进 Makefile**（2026-08-25 修复）：
   - `make run-prometheus`：`--config.file` 指向 `config-output/prometheus.yml`（首次自动从
     项目自有模板 `deploy/prometheus/prometheus.yml` seed），并开启 `--web.enable-lifecycle`；
   - `make run-metric-center`：默认传 `--config.reload-url=http://localhost:9090/-/reload`。
   少任何一个都会出现「下发 failed」或「假 success」（生成的 file_sd 用相对路径
   `targets/<job>.json`，按配置文件所在目录解析，`config.file` 指错目录时 targets 永远加载不到）。

5. **后端改动后必须重编译重启，且不要手动绕过 Makefile 的 PATH**（2026-08-26 追加）：
   - 修改 `platform/` 后，旧的 `metric-center` 二进制仍在跑，新逻辑不会生效；须先 `make build-metric-center`，再用 `make run-metric-center` 启动。Makefile 会自动把 `upstream/prometheus` 和 `upstream/blackbox_exporter` 加入 PATH，M09 草稿校验才能找到 `promtool` / `blackbox_exporter`。
   - 若手动启动二进制却忘了把上述两个目录加入 PATH，草稿会卡在 `validation_status=pending`，提示「promtool 不可调用」，导致无法确认发布。
   - 如果已有一张旧逻辑生成的 `pending` 草稿，即使重启了新二进制，`GenerateDraft` 也会按 checksum 幂等返回旧草稿（保活设计）。要看到新逻辑生成的 diff / 变更清单，需要先**废弃**旧单，再重新触发变更。废弃会按决策 43 回滚源数据（例如把禁用的 Job 恢复启用），所以常见验证动线是：**废弃旧单 → 重新禁用 Job → 生成新单 → 重校/确认**。

---

## 2. 启动环境（4 个进程）

```bash
cd /Users/chenrt/S-03Python/03\ AIopsAgent-study/CNCF_Monitor-feature

# 终端 1：Prometheus（数据面，:9090，config.file 指向 config-output/，已开 lifecycle）
make run-prometheus

# 终端 2：控制面（:8080，已带 --config.reload-url）
make run-metric-center

# 终端 3：前端（:5173，本手册以 API 为主，UI 动线见附录）
make dev-ui

# 终端 4：样本采集端（:9100，暴露 /metrics，供"UP"判据使用；simple-agent 是独立 Go module，须在其目录内启动）
cd platform/examples/simple-agent && ../../../.tools/go/bin/go run . -listen-address ":9100" -app-name "demo-app" -env "test"
```

> 也可以用 `upstream/node_exporter` 替代 simple-agent，端口同样保持 9100。

## 3. Step 0：环境自检（4 条全绿 + Step 0.5 通过再往下走）

```bash
# 0.1 控制面健康
curl -s http://localhost:8080/api/v1/health | jq .        # status=success
curl -s http://localhost:8080/api/v1/health/db | jq .     # DB 正常

# 0.2 Prometheus lifecycle 已开放（这条不过，后面 confirm 必 failed）
curl -s -X POST http://localhost:9090/-/reload -o /dev/null -w '%{http_code}\n'   # 期望 200

# 0.3 config-output 已 seed
ls config-output/prometheus.yml

# 0.4 default 域已预置且已纳管
curl -s 'http://localhost:8080/api/v2/platform/network-domains/default' | jq '.data | {id, channel, is_monitored, status}'
# 期望：channel=local, is_monitored=true, status=enabled
```

### Step 0.5：确认控制面是新二进制且校验工具在 PATH 中

每次修改 `platform/` 后，**不要直接复用旧进程**：

```bash
make build-metric-center
# 在另一个终端先停止旧 metric-center 进程，再：
make run-metric-center
```

验证控制面已加载新逻辑且 `promtool` 可被调用：

```bash
curl -s -X POST http://localhost:8080/api/v2/platform/config/drafts \
  -H 'Content-Type: application/json' \
  -d '{"network_domain_id":"default"}' | jq '.data.validation_status'
# 期望：passed（若源数据无变化则返回 errType=no_changes）
# 若返回 pending 且 message 含 "promtool 不可调用"，说明 PATH 未包含上游二进制目录
```

若存在旧逻辑生成的 `pending` 草稿，先**废弃**它，再重新触发变更（见事实 5）。

---

## 4. API 闭环动线（Step 1 ~ Step 8）

约定：

```bash
BASE=http://localhost:8080/api/v2/platform
```

### Step 1：创建资源（M07）

middleware 类型必填 `middleware_type/app_name/cluster/instance_ip/port`
（`config/resource/validate.go:170-195`）；`biz_code` 必须命中
`platform/config/business_domains.yaml` 中已启用条目（MVP 预置 `authorized-ops` /
`data-innovation-lab`）；`env ∈ dev/test/staging/prod`。

```bash
curl -s -X POST "$BASE/resources" -H 'Content-Type: application/json' -d '{
  "resource_category": "middleware",
  "network_domain_id": "default",
  "biz_code": "authorized-ops",
  "app_name": "demo-app",
  "cluster": "demo-cluster",
  "middleware_type": "kafka",
  "instance_ip": "127.0.0.1",
  "port": 9100,
  "env": "test",
  "status": "online"
}' | jq .
```

从响应提取资源业务 ID（后续步骤都要用）：

```bash
RESOURCE_ID=<上一步返回的 data.resource_id>
```

### Step 2：确认实例候选可收敛（M01）

`monitor_type=kafka` 推导资源类别为 middleware 且 `middleware_type=kafka`
（`models/monitor_type.go:98`），候选按同网域收敛：

```bash
curl -s "$BASE/scrape-jobs/instance-candidates?monitor_type=kafka&network_domain_id=default" | jq .
# 期望：列表中出现 127.0.0.1:9100 这条资源
```

### Step 3：创建采集 Job（M01）

standard 任务必填 `scrape_interval/scrape_timeout/metrics_path/scheme`
（`strategy/scrapejob/validate.go:61-72`）；网域必须已纳管且非冻结。

```bash
curl -s -X POST "$BASE/scrape-jobs" -H 'Content-Type: application/json' -d "{
  \"job_name\": \"demo-kafka-9100\",
  \"job_type\": \"standard\",
  \"monitor_type\": \"kafka\",
  \"network_domain_id\": \"default\",
  \"instance_selection_mode\": \"manual\",
  \"selected_instance_ids\": [\"$RESOURCE_ID\"],
  \"scrape_interval\": \"15s\",
  \"scrape_timeout\": \"10s\",
  \"metrics_path\": \"/metrics\",
  \"scheme\": \"http\",
  \"auth_type\": \"none\"
}" | jq .
```

```bash
JOB_ID=<上一步返回的 data.id>   # 数值主键
```

可选验证：

```bash
curl -s -X POST "$BASE/scrape-jobs/$JOB_ID/preview-targets" | jq .
# 期望：预览里出现 127.0.0.1:9100
```

### Step 4：安装确认（M01）

```bash
curl -s -X POST "$BASE/scrape-jobs/$JOB_ID/instances/$RESOURCE_ID/confirm" \
  -H 'Content-Type: application/json' \
  -d '{"confirmed_by": "tester", "actual_port": 9100}' | jq .
```

### Step 5：提交 ready（draft → ready + pending）

只有这一步之后，Job 才进入 M09 变更检测视野，且下发成功后才满足回写前提
（见 §1 事实 3）：

```bash
curl -s -X POST "$BASE/scrape-jobs/batch-draft-status" \
  -H 'Content-Type: application/json' \
  -d "{\"ids\": [$JOB_ID]}" | jq .
# 期望：data[0].draft_status=ready, change_status=pending
```

### Step 6：生成配置草稿（M09）

```bash
curl -s -X POST "$BASE/config/drafts" -H 'Content-Type: application/json' \
  -d '{"network_domain_id": "default"}' | jq .
```

```bash
CHANGE_NO=<上一步返回的 data.change_no>

# 查看变更明细（prometheus.yml / targets 文件内容）
curl -s "$BASE/config-drafts/$CHANGE_NO" | jq .
# 期望：status=pending，validation_status=passed，变更项包含 targets/demo-kafka-9100.json
```

> 若返回 `{"message": "当前无配置变更", "no_changes": true}`：说明 Step 5 没生效或该变更
> 已被之前的草稿覆盖，回 Step 5 检查 Job 状态。

### Step 7：确认下发（核心一步）

confirm 会：生成 ConfigVersion → DiskApplier 原子写 `config-output/prometheus.yml` +
`config-output/targets/<job>.json` → 结构变更触发 `POST /-/reload` → 生成 ConfigDeployment
记录 → success 后回写 Job `change_status=deployed`。

```bash
curl -s -X POST "$BASE/config-drafts/$CHANGE_NO/confirm" \
  -H 'Content-Type: application/json' \
  -d '{"confirmed_by": "tester"}' | jq .
# 期望：返回 ConfigVersion（草稿 status → confirmed）
```

### Step 8：核查下发记录

```bash
curl -s "$BASE/deployments?network_domain_id=default" | jq '.data.items[0] | {id, status, error_message, target_address}'
# 期望：status=success，error_message 为空，target_address=http://localhost:9090/-/reload
```

```bash
# Job 状态联动（M01 ↔ M09）
curl -s "$BASE/scrape-jobs" | jq ".data.items[] | select(.id==$JOB_ID) | {job_name, draft_status, change_status}"
# 期望：change_status=deployed
```

---

## 5. 数据面成功判据（全绿即闭环）

```bash
# 5.1 磁盘产物
ls config-output/prometheus.yml config-output/targets/
cat config-output/targets/demo-kafka-9100.json | jq .   # 含 127.0.0.1:9100

# 5.2 Prometheus 已加载新 job（file_sd 相对路径按 config-output/ 解析）
curl -s 'http://localhost:9090/api/v1/targets?state=active' \
  | jq '.data.activeTargets[] | select(.labels.job=="demo-kafka-9100") | {scrapeUrl, health}'
# 期望：health=up（simple-agent 在 9100 监听时）

# 5.3 采集链路真正通
curl -s 'http://localhost:9090/api/v1/query?query=up{job="demo-kafka-9100"}' \
  | jq '.data.result[0].value'
# 期望：["<ts>", "1"]
```

浏览器对照：`http://localhost:9090/targets` 出现 `demo-kafka-9100` 且 state=UP。

## 6. 可选：重试与回滚

```bash
# 重试（仅 status=failed 的记录可 retry；可临时停掉 Prometheus 制造 failed 再恢复）
curl -s -X POST "$BASE/deployments/<DEP_ID>/retry" -H 'Content-Type: application/json' \
  -d '{"triggered_by": "tester"}' | jq .

# 回滚到某个历史版本（:id 为 config_version_id）
curl -s -X POST "$BASE/deployments/<CONFIG_VERSION_ID>/rollback" -H 'Content-Type: application/json' \
  -d '{"triggered_by": "tester"}' | jq .
# 回滚后再看 5.2：targets 应回退到旧版本内容
```

## 7. 常见失败排查

| 现象 | 最可能原因 | 定位 |
|------|-----------|------|
| confirm 后 deployment `status=failed`，error 含 `refusing silent success` | metric-center 没带 `--config.reload-url` | 用 `make run-metric-center` 启动 |
| deployment `status=failed`，error 含 `unexpected status 403/404` 或连接拒绝 | Prometheus 没开 `--web.enable-lifecycle` 或没在跑 | Step 0.2 |
| deployment `success` 但 `/targets` 没有新 job | Prometheus 的 `--config.file` 没指向 `config-output/prometheus.yml`（假成功） | 用 `make run-prometheus` 启动 |
| job 显示 active 但 health=down | host 类资源 target 是裸 IP（:80）；或 9100 没有采集端在跑 | §1 事实 2；Step 2 终端 4 |
| 下发 success 但 Job 仍 `pending` | Job 不是 `draft_status=ready`，不满足回写前提 | §1 事实 3 |
| 生成草稿返回 `no_changes` | Job 未提交 ready，或变更已被已有草稿覆盖 | Step 5 |
| 创建 Job 报「网域未纳管」 | 误用了新建的 edge 域；local 闭环必须用 `default` | §1 事实 1 |

## 附录：UI 动线对照（前端 11 步）

API 全绿后，可按以下路由在 `:5173` 复走用户动线，验证页面与后端一致：

| 步 | 路由 | 对应本文步骤 |
|----|------|-------------|
| 网域管理 | `/admin/domains` | default 域已预置，只读核对 |
| 资源管理 | `/resources` | Step 1 |
| 标签模板 | `/label-templates` | seed 已预置 default-* 模板，可选 |
| 采集器管理 | `/collectors` | seed 已预置内置 exporter，只读核对 |
| 采集 Job | `/scrape-jobs` | Step 2~5 |
| 规则编辑 | `/rules` | 可选（规则并入 rules.yml 属结构变更，会触发 reload） |
| 网域纳管 | `/domain-onboarding` | default 已纳管；新建 edge 域走 agent_pull，不在本闭环内 |
| 配置变更确认 | `/config-preview` | Step 6~7 |
| 下发记录 | `/deployments` | Step 8、§6 |
| 首页 | `/` | `GET /dashboard/summary` 计数变化 |
| 数据面 | `:9090/targets`、`:9090/graph` | §5 |
