# Module 09 API v3 契约快照（draft，待 G2 评审）

> **状态**：frozen（B0 评审通过，owner 2026-11-11 确认；D27/D28 + 退纳管 MVP 已锁定；进入 B1 实施）
> **分支**：`rewrite/v2.0`
> **前缀**：平台管理 `/api/v3/platform/*`；边缘协议 `/api/v3/edge/*`；Prometheus 兼容 `/api/v1/*`
> **旧线**：`/api/v2/platform/*` 兼容窗口内保留；`/api/v2/platform/edge/*` 不兼容（agent 需升级到 v1 协议）
> **上位文档**：`assessment.md`、`03_API_Standard.md`、M09 SRS v1.1
> **冲突处理**：与 SRS 冲突以 SRS 为准；与 03_API_Standard 冲突报告 Orchestrator，禁止擅自改契约

---

## 1. 通用约定

### 1.1 响应信封

平台管理接口与查询接口统一：

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

`errorType`：`bad_request` / `unauthorized` / `forbidden` / `not_found` /
`conflict` / `unavailable` / `internal` / `bad_gateway`（代理 Prometheus 失败）。

边缘协议接口（`/api/v3/edge/*`）采用相同信封，但错误面向机器：`errorType` 同上，`error` 为简短原因。

### 1.2 分页

- `page` 从 1 开始，默认 1；`page_size` 默认 20，上限 100（超出按 100 截断）。
- 响应：`{ "list": [], "total": 0, "page": 1, "page_size": 20 }`。
- 时间：RFC3339；空时间返回 `null`；禁止 Go 零值 `0001-01-01...`。
- 字段：snake_case；ID 以 `_id` 结尾。

### 1.3 查询响应 meta envelope（FR-19）

`/api/v1/query`、`/api/v1/query_range`、`/api/v1/labels`、`/api/v1/label/:name/values`、`/api/v1/series`、`/api/v1/alerts*` 成功时：

```json
{
  "status": "success",
  "data": { "...原生 Prometheus data..." },
  "meta": {
    "data_source": "prometheus",
    "freshness_at": "2026-11-11T10:00:00Z",
    "network_domains": ["mc-demo"]
  }
}
```

- `network_domains` 为本次查询实际覆盖的授权网域 ID 列表。
- Prometheus 原生 `status`/`data` 结构保持不变，仅在最外层追加 `meta`。

### 1.4 鉴权

| 面 | 鉴权 | 说明 |
|---|---|---|
| `/api/v3/platform/*` | 全局 `AuthMiddleware` + 租户上下文；写操作 `RequireAdmin` | 匿名 → 401；非 admin 写 → 403 |
| `/api/v3/edge/*` | `EdgeTokenMiddleware`（网域 Token，sha256 校验） | 不挂用户 AuthMiddleware；Token 失效 → 401 |
| `/api/v1/*`（查询/目标） | 全局 `AuthMiddleware` + 租户/网域授权过滤 | 匿名 → 401；越权 → 数据为空（非 403） |

租户标识唯一取法：`auth.CurrentUser(c).TenantID`；网域授权以 `network_domains.authorized_tenant_ids` 为权威（D17），不信任请求参数。

### 1.5 严格 JSON

所有写接口（POST/PUT/PATCH）使用 `DisallowUnknownFields`；出现契约外字段 → 400，不静默忽略。

---

## 2. 网域纳管（平台管理面）

> 网域行政字段（name/cloud_code/zone_type/...）由 M06 管理；本组只管理纳管与运行态。默认纳管列表与 M06 已登记域对齐，只展示 M06 `enabled` + `edge` 的网域；admin 可通过 `view=admin`（或 `status`）切到行政视角，查看启用/停用全量域（D34）。

### 2.1 纳管网域视图

```json
{
  "network_domain_id": "mc-demo",
  "name": "演示采集域",
  "description": "示例",
  "domain_type": "edge",
  "domain_type_label": "采集节点域",
  "tenant_id": "platform_admin",
  "authorized_tenant_ids": ["platform_admin"],
  "status": "enabled",
  "cloud_code": "aliyun",
  "zone_type": "beijing",
  "registration_status": "monitored",
  "monitored_at": "2026-11-11T10:00:00Z",
  "token_masked": "ab****89",
  "agent_count": 1,
  "online_agent_count": 1,
  "last_heartbeat_at": "2026-11-11T10:00:30Z",
  "last_config_version": "20261111-0a1b",
  "center_endpoint": "https://mc.example.com",
  "remote_write_url": "https://mc.example.com/api/v1/write",
  "created_at": "2026-11-11T10:00:00Z",
  "updated_at": "2026-11-11T10:00:00Z"
}
```

- `description` / `domain_type` / `domain_type_label` / `tenant_id` / `authorized_tenant_ids` / `status` 为 M06 行政字段，供 M06 管理页直接消费（D34）。
- `registration_status`：`created`（未纳管）/ `monitored`（已纳管）/ `retired`（已退纳管，仅审计）。
- `token_masked`：完全脱敏；**任何列表/详情接口不返回明文**。
- `last_config_version` 为该域当前生效快照版本。

### 2.2 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/network-domains` | 登录 | 默认纳管视角列表（`enabled` + `edge`）；筛选 `registration_status`/`keyword`/`cloud_code`/`zone_type`/`tenant_id` + 分页；`created_at asc` |
| GET | `/network-domains?view=admin` | admin | 行政视角列表：`domain_type IN (edge, collection)`，不默认过滤 `status`；可叠加 `status=enabled|disabled`；非 admin → 403（D34） |
| GET | `/network-domains/:id` | 登录 | 纳管详情；不存在或未授权 → 404 |
| POST | `/network-domains/:id/monitor` | admin | 纳管：签发 Token，返回明文一次 + 脱敏 + 安装指引 |
| POST | `/network-domains/:id/token/reset` | admin | 重置 Token：旧 Token 立即失效，返回新明文一次 |
| DELETE | `/network-domains/:id/monitor` | admin | 退纳管（MVP）：废止 Token，节点转 `retired`，状态归 `created`；与 M06 级联清退复用同一 service 路径 |

> `view=admin` 仅改变列表的行政可见范围，不改变纳管/退纳管前置条件（仍要求 `enabled` + `edge`，见 §2.3）。

### 2.3 纳管 POST 响应（明文仅本次返回）

```json
{
  "status": "success",
  "data": {
    "network_domain_id": "mc-demo",
    "registration_status": "monitored",
    "token": "mctok_v1_<32bytes-random-hex>",
    "token_masked": "ab****89",
    "center_endpoint": "https://mc.example.com",
    "remote_write_url": "https://mc.example.com/api/v1/write",
    "install_guide": {
      "steps": [
        "下载离线安装包",
        "解压部署到 /opt/apps/edge-sync-agent",
        "编辑 env/edge-sync-agent.env 填入网域 ID、接入 Token 与中心地址（其余变量已给推荐值）",
        "启动 Agent 并验证心跳回连"
      ],
      "package_download_url": "/api/v3/platform/edge-packages/latest"
    }
  }
}
```

- 纳管前校验：M06 域存在 + `status=enabled` + `domain_type=edge`；否则 400/404。
- 重复纳管幂等：已纳管网域再次 POST → 409（提示先重置 Token 或先退纳管）。
- Token 明文仅在本响应与重置响应中出现；服务端只存 `sha256(token)`。

### 2.4 重置 Token

```json
POST /network-domains/:id/token/reset
→ 200 { "data": { "token": "...", "token_masked": "...", "reset_at": "..." } }
```

- 重置后旧 Token 立即失效（覆盖 `token_hash`）；旧 agent 心跳鉴权失败转 offline。
- 需要 admin + 二次确认（前端）；后端不额外要求确认字段。

---

## 3. 采集节点（EdgeAgent）

### 3.1 节点视图

```json
{
  "id": 12,
  "network_domain_id": "mc-demo",
  "hostname": "edge-node-01",
  "ip": "10.0.0.5",
  "agent_type": "vmagent",
  "version": "v1.0.0",
  "status": "online",
  "last_heartbeat_at": "2026-11-11T10:00:30Z",
  "heartbeat_rtt_ms": 12,
  "config_version": "20261111-0a1b",
  "config_sync_status": "in_sync",
  "out_of_sync_cause": "",
  "config_apply_error": "",
  "collector_status": "running",
  "collector_version": "vmagent-1.101",
  "components": [
    {"type": "agent", "name": "edge-sync-agent", "status": "running", "version": "v1.0.0", "restart_count": 0},
    {"type": "collector", "name": "vmagent", "status": "running", "version": "vmagent-1.101", "restart_count": 1, "last_restart_at": "2026-11-11T09:00:00Z"},
    {"type": "blackbox_exporter", "name": "blackbox", "status": "not_deployed"}
  ],
  "queue_backlog_bytes": 1048576,
  "remote_write_dropped_total": 0,
  "remote_write_retries_total": 0,
  "remote_write_last_error": "",
  "vm_agent_restart_seq": 3,
  "flush_backlog_seq": 0,
  "last_error": "",
  "created_at": "2026-11-11T10:00:00Z",
  "updated_at": "2026-11-11T10:00:30Z"
}
```

- `status`：`online`/`offline`/`unknown`/`retired`（retired 终态，列表默认过滤）。
- `config_sync_status`：`in_sync`/`out_of_sync`/`unknown`/`manual_override`/`no_version`。
- `out_of_sync_cause`：`pending_draft`/`pull_pending`/`local_reset`/`apply_failed`/空。
- 组件 `status`：`running`/`restarting`/`crash_loop`/`not_deployed`（FR-08）。

### 3.2 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/edge-agents` | 登录 | 筛选 `network_domain_id`/`status`/`keyword` + 分页；默认过滤 `retired` |
| GET | `/edge-agents/:id` | 登录 | 详情；含组件、回传积压、配置版本 |
| PUT | `/edge-agents/:id/restart` | admin | 重启采集进程：递增 `vm_agent_restart_seq`，留痕（触发人/时间） |
| PUT | `/edge-agents/:id/flush-backlog` | admin | 清空回传积压：递增 `flush_backlog_seq`，留痕 |

- `restart` / `flush-backlog`：节点 `offline` 时禁用（400 + 可执行提示）；幂等由 seq 保证，重复触发递增 seq。
- 这两个是 outbound-only 指令：中心不主动连接节点，由节点下次心跳拉取执行（FR-09，NFR-03）。

---

## 4. 配置快照（只读历史）

> 配置同步为后台自动服务，无人工确认/回滚。本组只暴露只读快照。
>
> **源数据（2026-11-16 起）**：每域配置由 M01 `m01_scrape_jobs`（`ready + enabled + 未删`）驱动；targets 取 `selected_instance_ids` 对应的 M07 v3 资源，blackbox 使用资源的探测 URL。M09 生成/校验完成后通过 `SyncResultSink` 将 per-job 结果回写 M01 的 `sync_*` 列（D-2）。
>
> **中心规则（2026-11-16 起）**：规则为平台级全局对象（D35/D36），M09 后台服务读取 M01 `m01_monitoring_rules`（`enabled + ready`），以 `centerEvaluator=true` 生成 `rules.yml`，原子写入 `--config.dir/rules.yml` 并 `POST /-/reload` 中心 Prometheus；快照记录在 `config_snapshots` 的 `scope=center`（唯一 current），结果通过 `SyncResultSink.RecordRuleSync` 回写 M01。
>
> **告警配置（2026-11-17 起）**：M08 单份持久化 `alertmanager.yml` 快照（`scope=alertmanager`）；M09 统一历史只读引用同一份记录，**不再复制 `am-` 行、不二次落库、不触发 reload**，也不扇出边缘（D31 修订）。

### 4.1 快照视图

```json
{
  "id": 42,
  "network_domain_id": "mc-demo",
  "version": "20261111-0a1b",
  "checksum": "sha256:deadbeef",
  "validation_status": "passed",
  "validation_cause": "none",
  "validation_details": {},
  "is_current": true,
  "generated_by": "system",
  "created_at": "2026-11-11T10:00:00Z"
}
```

- `validation_status`：`passed`/`failed`。
- `validation_cause`：`user_config`/`platform_fault`/`none`（沿用既有归因）。
- 每域仅一个 `is_current=true`；保留最近 3~5 份（可配置），超出自动清理。

### 4.2 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/network-domains/:id/config-snapshots` | 登录 | 该域历史快照列表（最新在前），仅元数据 |
| GET | `/network-domains/:id/config-snapshots/:snapshot_id` | 登录 | 快照详情；`failed` 返回 `validation_details` |
| GET | `/network-domains/:id/config-snapshots/:snapshot_id/content` | admin | 快照内容下载（配置含凭据，需 admin）；**不提供回滚** |

- 不提供：`confirm`、`revalidate`、`discard`、`rollback`、`deployments` 端点（已删除）。
- `failed` 快照不对外作为当前版本发布，仅供排障展示。
- 旧端点保留兼容；统一历史/预览/导出使用 §4.3（2026-11-17 新增）。

### 4.3 统一配置产物历史与导出（2026-11-17）

> SRS v1.5 FR-13 / FR-13.1 / FR-13.2。三类产物同表（`config_snapshots`）：
> `scope=domain`（网域采集配置，`scope_key=network_domain_id`）、`scope=center`（中心规则）、
> `scope=alertmanager`（M08 告警配置，只读引用）。**无回滚/确认端点。**

#### 4.3.1 视图

```json
{
  "id": 42,
  "artifact_type": "domain",
  "network_domain_id": "mc-demo",
  "version": "20261117-0a1b",
  "checksum": "sha256:deadbeef",
  "validation_status": "passed",
  "validation_cause": "none",
  "validation_details": {},
  "is_current": true,
  "generated_by": "system",
  "generated_at": null,
  "created_at": "2026-11-17T10:00:00Z",
  "content_available": true
}
```

- `artifact_type`：`domain` / `center` / `alertmanager`；`network_domain_id` 仅 domain 有值。
- 列表/详情登录可见；内容预览、导出、恢复包仅 admin（产物含凭据明文）。
- 历史内容必须持久化：domain/center 存内容文件（`config-output/snapshots/<scope_key>/<version>.json`），alertmanager 存 DB `content` 列。
- **2026-11-18 起（SRS v1.7）**：domain/center 历史按自然日裁剪，保留最近 30 天、每天最多一份成功版本（时区默认 `Asia/Shanghai`，可用 `METRIC_CENTER_SNAPSHOT_TIMEZONE` / `METRIC_CENTER_SNAPSHOT_RETENTION_DAYS` 覆盖）；同一天多次成功变更只保留最后一份；**失败尝试不写入快照历史**，仅回写 M01 `sync_status` / `sync_error` 与日志。alertmanager 沿用 M08 的 20 份版本策略。

#### 4.3.2 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/config-artifacts` | 登录 | 统一历史列表；筛选 `artifact_type` / `network_domain_id` / `validation_status` / `limit`(≤500)，最新在前 |
| GET | `/config-artifacts/:id` | 登录 | 产物详情（元数据 + `content_available`） |
| GET | `/config-artifacts/:id/content` | admin | 内容预览：`{artifact, files:[{name,content}]}`，按文件 Tab |
| GET | `/config-artifacts/:id/export` | admin | 可直接落盘导出：domain→zip；center→rules.yml；alertmanager→alertmanager.yml |
| GET | `/config-artifacts/:id/export?raw=1` | admin | 次级下载：原始载荷（domain/center 为 JSON 包，alertmanager 为 YAML） |
| GET | `/config-artifacts/recovery-bundle` | admin | 中心一体化恢复包 zip：prometheus.yml + rules.yml + alertmanager.yml（可用时）+ targets/*.json + manifest.json |

- domain 导出 zip 内容：`prometheus.yml`、`targets/*.json`、`blackbox.yml`、`rules.yml`（如有）、`metadata.json`；解压到 Prometheus 配置目录即可加载。
- 导出 `Content-Disposition` 文件名：`<domain>-<version>.zip` / `<version>-rules.yml` / `<version>-alertmanager.yml` / `center-recovery-<version>.zip`。
- 中心恢复包取各类型**当前生效**版本；M08 不可用时省略 `alertmanager.yml` 并在 manifest 标注；无中心产物返回 404。
- 预览/导出不改变当前版本、不触发 reload。
- 非 admin 调用内容/导出/恢复包返回 `403 forbidden`。

### 4.4 即时同步触发（2026-11-18）

> 保存 M01 Job / 规则后由前端 best-effort 调用，缩短「待同步」窗口；
> 30s watcher 仍是最终兜底。触发失败不阻断保存动线。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/config-sync/trigger` | 登录（domain）/ admin（center/all） | 立即生成配置快照；`scope=domain` 需 `network_domain_ids`，`scope=center` 重算中心规则，`scope=all` 覆盖全部启用边缘域 + 中心规则 |

请求：

```json
{
  "scope": "domain",
  "network_domain_ids": ["mc-demo"],
  "wait": false
}
```

响应（`wait=false` 为 202 语义；`wait=true` 同步执行并返回结果）：

```json
{
  "accepted": true,
  "completed": true,
  "domains": [
    {
      "network_domain_id": "mc-demo",
      "version": "20261118-0a1b",
      "validation_status": "passed",
      "validation_cause": "none"
    }
  ],
  "center": {
    "version": "20261118-1c2d",
    "validation_status": "passed",
    "validation_cause": "none"
  }
}
```

- `scope=domain` 仅 admin 且网域必须存在、`domain_type=edge`、`status=enabled`。
- `scope=domain` 的请求会去重并限制最多 200 个网域；`scope=center/all` 不接受 `network_domain_ids`。
- `wait=false` 进入 500ms debounce 后台队列，同一网域的连续保存合并为一次生成。
- `completed=false` 表示等待超时但任务已入队，前端应轮询 M01 `sync_status`。
- 不改变现有只读历史/导出端点的语义；触发成功后的新快照仍按 §4.3 展示。

---

## 5. 离线包

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/edge-packages` | 登录 | 中心发布的 Edge Sync Agent 版本清单 |
| GET | `/edge-packages/latest` | 登录 | 最新版本元数据 + sha256 |
| GET | `/edge-packages/:file` | 登录（Token 校验后可匿名下载，见下） | 流式下载 tar.gz |

### 5.1 版本清单视图

```json
{
  "list": [
    {
      "version": "v1.0.0",
      "file": "edge-sync-agent-v1.0.0-linux-amd64.tar.gz",
      "sha256": "sha256:...",
      "size_bytes": 12345678,
      "released_at": "2026-11-11T10:00:00Z"
    }
  ],
  "total": 1
}
```

- 未打包时返回空数组 + 200（不硬编码占位）。
- 下载端点支持 `If-None-Match`（ETag = sha256），命中返回 304。
- 节点详情页展示节点当前版本与中心最新版本差异（FR-21），由 `/edge-agents/:id` 与本清单在前端比对。

---

## 6. 边缘协议（`/api/v3/edge/*`，机器对机器）

> 协议版本 v1；Agent 与中心共享 `edgeproto` DTO。Agent 通过 `Authorization: Bearer <domain-token>` 或约定 Header 携带 Token。

### 6.1 `POST /heartbeat`

请求：

```json
{
  "protocol_version": "v1",
  "agent_type": "vmagent",
  "version": "v1.0.0",
  "config_version": "20261111-0a1b",
  "hostname": "edge-node-01",
  "ip": "10.0.0.5",
  "components": [ ...EdgeComponent... ],
  "queue_backlog_bytes": 1048576,
  "remote_write_queue_size": 0,
  "remote_write_dropped_total": 0,
  "remote_write_retries_total": 0,
  "remote_write_last_error": "",
  "targets_collected": true,
  "targets": [ ...EdgeTargetSnapshot... ],
  "metadata_remote_write_url": "https://mc.example.com/api/v1/write",
  "metadata_max_disk_usage_per_url": "50GB",
  "timestamp": "2026-11-11T10:00:30Z"
}
```

响应：

```json
{
  "status": "success",
  "data": {
    "config_changed": true,
    "config_version": "20261111-0a1b",
    "config_checksum": "sha256:...",
    "config_download_url": "/api/v3/edge/config?network_domain=mc-demo",
    "vm_agent_restart_seq": 3,
    "flush_backlog_seq": 0,
    "server_time": "2026-11-11T10:00:30Z"
  }
}
```

- 首次有效 Token 心跳自动注册 `edge_agents`（FR-05）。
- `targets_collected=true` 时 clear-then-insert 该 agent 快照；`false` 时保留上轮快照（F-11 口径）。
- 心跳超时阈值判定 online/offline；超时后展示用组件状态覆写为 `unknown`。

### 6.2 `GET /config?network_domain=<id>`

- Token 校验通过后返回该域**当前生效且校验通过**的配置包（tar.gz 或 JSON 产物）。
- 支持 `If-None-Match: <checksum>` → 304（未变更）。
- 无当前版本或当前版本校验失败 → 404 + 可执行错误（引导「检查中心配置生成状态」）。
- 配置包含凭据明文，仅 Token 校验后返回（FR-11）。

### 6.3 协议错误

- Token 无效/过期 → 401 `unauthorized`；
- 当前域未纳管 → 403 `forbidden`；
- 协议版本不兼容 → 400 `bad_request`，`error` 含支持的版本列表。

---

## 7. 目标状态与查询（`/api/v1/*`，兼容路径）

> 路径保持 Prometheus 原生，但必须经认证与隔离；响应在外层追加 `meta`（§1.3）。

### 7.1 `GET /api/v1/targets`

融合中心 Prometheus targets（如存在）与边缘 `edge_target_snapshots`，按授权网域过滤。

查询参数：`network_domain`、`job`、`health`（`up`/`down`/`unknown`）、`keyword`、`page`、`page_size`。

响应（融合后列表，分页）：

```json
{
  "status": "success",
  "data": {
    "list": [
      {
        "job": "node-exporter",
        "instance": "10.0.0.5:9100",
        "network_domain": "mc-demo",
        "instance_name": "edge-node-01",
        "health": "up",
        "stale": false,
        "last_scrape": "2026-11-11T10:00:30Z",
        "last_error": "",
        "source": "edge"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 20
  }
}
```

- `source`：`prometheus`（中心）/ `edge`（边缘快照）。
- `stale`：`source=edge` 且 `last_report_at` 超过新鲜度阈值时为 `true`；`health` 保留最后上报的 `up/down/unknown`，不再降级为 `unknown`，前端展示“在线/离线（数据陈旧）”。
- `health` 过滤按原始 health 值匹配；`stale` 是独立维度，旧快照仍可按 up/down 筛选。
- 只返回当前用户被授权网域的数据；无授权 → 空列表（NFR-08）。

### 7.2 `GET /api/v1/health/coverage`

采集覆盖率四态明细 + 汇总（FR-16），供 M07 资源列表 badge 消费。按授权网域过滤后聚合，按 `resource_id` 关联 `edge_target_snapshots`。

查询参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `network_domain` | 空 | 按网域过滤；服务端仍在授权网域集内二次约束 |
| `resource_category` | 空 | `host/database/middleware/application/generic_target/interface_service`；非法值 → 400 |
| `state` | 空 | `collecting/partial_collecting/pending_down/not_monitored`；非法值 → 400 |
| `page` | 1 | 页码 |
| `page_size` | 500 | 上限 1000 |

```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "resource_id": "r-1",
        "resource_category": "host",
        "instance_name": "web-01",
        "monitor_state": "collecting",
        "health": "up",
        "last_error": ""
      }
    ],
    "total": 1,
    "summary": {
      "total": 1,
      "collecting": 1,
      "partial_collecting": 0,
      "pending_down": 0,
      "not_monitored": 0,
      "coverage_rate": 1
    },
    "collecting": 1,
    "deployed_not_collected": 0,
    "not_monitored": 0
  }
}
```

- 四态口径：存在新鲜 `up` 快照=采集中；多目标混合成功/失败=`partial_collecting`；有快照但无新鲜成功=`pending_down`；无任何快照=`not_monitored`。
- `summary` 按 `state` 筛选后的全量结果统计（非当前页）；`coverage_rate = (total - not_monitored) / total`，保留两位小数。
- 顶层 `collecting/deployed_not_collected/not_monitored` 为兼容窗口内保留的旧三态字段，现为 `summary` 的别名（资源级）：`collecting=summary.collecting`、`deployed_not_collected=summary.partial_collecting+summary.pending_down`、`not_monitored=summary.not_monitored`；新消费方统一使用 `items` + `summary`。

### 7.3 PromQL 查询代理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/v1/query` | instant query |
| GET/POST | `/api/v1/query_range` | range query |
| GET | `/api/v1/labels` | 标签名 |
| GET | `/api/v1/label/:name/values` | 标签值 |
| GET | `/api/v1/series` | 序列匹配 |
| GET | `/api/v1/alerts` | 告警状态 |
| GET | `/api/v1/alerts*` | 告警历史（沿用既有） |

- 转发前**只在 PromQL/匹配器中注入 `network_domain_id=~"<authorized domains>"` 一个约束**（D28/D33；`network_domain_id` 是写入侧 external_label 的真实标签名，API 参数/字段名仍沿用 `network_domain`）；授权网域集由服务端按当前租户解析（D17），不注入 `tenant` 标签（写入侧数据面无此标签）。
- 任何用户（含 `platform_admin`）无 bypass；无授权网域或数据未带网域标签时返回空数据（200 + 空），不报错。
- 代理目标 URL 走允许列表（仅中心 Prometheus），禁止用户可控 URL 透传（SSRF，api-standard §7）。
- **查询护栏（NFR-11，2026-11-22 起）**：表达式 ≤ 8 KiB、范围 ≤ 30 天、`step` ≥ 15s、每序列点数 ≤ 11000、上游超时 ≤ 30s。
  - 护栏命中 → 400 `bad_request`，`error` 含可执行建议（缩小范围 / 增大步长 / 建议步长）；护栏失败不请求 Prometheus。
  - 上游超时或不可达 → 502 `bad_gateway`；超时文案提示缩小范围或增大步长。
  - 非 `query` / `query_range` 的 `/labels`、`/series`、`/label/*` 仅校验时间范围（≤ 30 天）。
- **指标查询页（FR-22，2026-11-22 起）**：页面不提供网域选择器；一次查询覆盖当前用户全部授权网域，`meta.network_domains` 为本次覆盖网域。URL 契约见 `docs/07-design/design-notes/m09-query-page-ux.md` §3。
- Prometheus 不可达 → 502 `bad_gateway`。

---

## 8. 枚举与状态机

### 8.1 纳管状态 `registration_status`

`created` →（纳管）→ `monitored` →（退纳管）→ `created`；删除网域级联 → `retired`（终态）。

### 8.2 节点状态 `status`

`online` / `offline` / `unknown`（心跳超时覆写） / `retired`（终态）。`retired` 不可转回。

### 8.3 配置校验 `validation_status` / `validation_cause`

- `validation_status`：`passed` / `failed`。
- `validation_cause`：`user_config`（用户配置问题，展示「前往修改」）/ `platform_fault`（平台故障，展示「重新校验」）/ `none`。
- 仅 `passed` 且 `is_current=true` 的快照对外发布（FR-12）。

### 8.4 组件状态 `component.status`

`running` / `restarting` / `crash_loop` / `not_deployed`。

---

## 9. 旧 v2 → 新 v3 差异

| 能力 | v2 | v3 |
|---|---|---|
| 信封 | `{status,data}` / `{items,total}` | `{status,data}` / `{list,total,page,page_size}` + 查询类 `meta` |
| 网域类型/通道 | `management`/`edge`、`local`/`agent_pull` | 仅 `edge` + `agent_pull`；无 management/local/default |
| 配置变更 | 确认单/废弃/重新校验/部署/回滚 | 自动同步 + 只读历史快照；无确认/回滚端点 |
| Token | `network_domains.token` 明文列 | `network_domain_access.token_hash`（sha256）；明文仅签发/重置返回一次 |
| 边缘协议 | `/api/v2/platform/edge/*` | `/api/v3/edge/*`；协议 v1；旧 agent 不兼容 |
| 查询代理 | 裸透传，无隔离 | 按租户解析授权网域集，注入 `network_domain_id` 单标签约束（D33）；越权返回空；追加 meta |
| 采集节点 | 逻辑分散，部分占位 | m09 收敛；自动注册/组件/crash-loop/seq 指令 |
| 告警配置 | M09 生成并扇出 | M08 生成并单份持久化，M09 统一历史只读引用；不扇出边缘（D31/D51） |
| 鉴权 | edge 前缀对全局 auth 豁免 + Token | `/api/v3/edge` 仅 Token；`/api/v3/platform` 用户鉴权 + admin；`/api/v1` 用户鉴权 + 隔离 |

---

## 10. 冻结字段与不变量

- `network_domains`（M06）：M09 v3 **不写**其 legacy 纳管列（`channel`/`token`/`agent_type`/`remote_write_url`/`monitored_status`/`last_heartbeat`/`agent_version`/`is_monitored`/`registration_status`）；M09 纳管状态以 `network_domain_access` 行为准。
- `network_domain_access.domain_id` 创建后不可变；`token_hash` 重置即覆盖旧值。
- `config_snapshots`：`scope=domain/center/alertmanager`；每对象仅一个 `is_current`；历史只读，无回滚端点；三类产物统一历史与导出（D51）。
- `edge_agents`：`retired` 终态不可转回；`(network_domain_id, hostname)` 域内唯一。
- 查询与目标状态：无 bypass；始终按当前租户解析授权网域集，并注入 `network_domain_id` 标签过滤（D28/D33），不注入 `tenant`。
- 任何接口/日志不返回 Token 明文（仅签发/重置响应的 `token` 字段，且服务端不落明文）。
