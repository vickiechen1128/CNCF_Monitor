# M11 api-contract-snapshot（v0.2 边缘交付增强）

> 生成：2026-09-25。对齐 `platform/edge/*` 现有实现与 PRD §6.2/§6.3/§3.3。
> 跨端任务 T11-21/22/23/24/25 以本文件为第一权威；与 PRD/API 标准冲突时以本文件为准，冲突需上报。
> 基准：`feat/module-09-config-center` 2026-09-25 状态。
> 修订：2026-09-25 吸收 design-proposal config-sync-stall（Track B）与 dev-feedback F-17/F-21，补充 `apply_failed` 成因与 `config_apply_error` / `config_apply_failed_version` 字段（向后兼容，与 PRD §5.3 / §8.1 同步）。

## 1. 采集节点状态接口（前端 T11-23/24/25 消费）

### GET /api/v2/platform/edge-agents

> **筛选口径（v0.2，golang-reviewer H1 定版）**：后端 `ListAgentsHandler` **不消费任何筛选 query**，恒返回全量（`summary`/`overall` 在**全量** `agents` 上计算）。前端五维筛选由客户端 `useEdgeAgents` 兜底实现（params 已对齐下方字段名，当前无参发送）。**服务端筛选见 {v0.3}**；在 {v0.3} 前，消费方不得把返回的 `summary`/`overall` 理解为「过滤后子集的聚合」。

请求（预留给服务端 {v0.3} 的筛选语义：
`?network_domain_id=<id>&status=&collector_status=&blackbox_status=&config_sync_status=`；v0.2 客户端过滤，不发送）

响应（`EdgeAgentsResponse`，对齐 `platform/edge/management_service.go`）：

```json
{
  "overall": "normal",
  "summary": { "total": 3, "online": 2, "partial": 1, "offline": 0 },
  "agents": [
    {
      "id": 1,
      "network_domain_id": "gov-cloud-a",
      "hostname": "edge01",
      "ip": "10.0.2.15",
      "agent_type": "vmagent",
      "version": "v1.2.0",
      "status": "online",
      "last_heartbeat": "2026-09-20T08:00:00Z",
      "heartbeat_rtt_ms": 45,
      "last_config_pull": "2026-09-20T07:59:30Z",
      "config_version": "20260920-120000",
      "config_sync_status": "in_sync",
      "out_of_sync_cause": "",
      "config_apply_error": "",
      "config_apply_failed_version": "",
      "queue_backlog_bytes": 1048576,
      "collector_status": "running",
      "collector_version": "v1.101.0",
      "last_error": "",
      "components": [
        {
          "type": "collector",
          "name": "vmagent",
          "status": "running",
          "version": "v1.101.0",
          "config_version": "20260920-120000",
          "restart_count": 0,
          "last_restart_at": "",
          "last_error": ""
        }
      ]
    }
  ]
}
```

关键枚举（前端 `types/edge.ts` 必须对齐）：
- `status`：`online` / `offline` / `unknown` / `retired`（`partial` 由 collector 异常派生，DTO 以 `overall`+`collector_status` 呈现）
- `overall`：`normal` / `partial` / `offline` / `unknown`
- `config_sync_status`：`in_sync` / `out_of_sync` / `unknown` / `manual_override` / `no_version`
- `out_of_sync_cause`：`pending_draft` / `pull_pending`（同步中，processing 蓝）/ `local_reset` / `apply_failed`（同步失败，error 红）
- `config_apply_error` / `config_apply_failed_version`：配置应用失败原因与版本（可选，成功时为空，`omitempty` 不发送）
- `components[].type`：`agent` / `collector` / `blackbox_exporter`
- `components[].status`：`running` / `restarting` / `crash_loop` / `not_deployed` / `unknown`

> **C5 字段改名（T11-21）**：`wal_backlog_bytes` → `queue_backlog_bytes`。前端展示名「WAL 积压」→「回传积压」，语义为 vmagent 磁盘持久发送队列积压。

### GET /api/v2/platform/edge-agents/:id

响应为单个 `agent` 对象（同上 `agents[0]` 结构，含完整 `components` 供抽屉）。

## 2. 离线包接口（前端 T11-22 消费）

> **清单来源**：后端读取构建产物目录（默认 `dist/edge-package`，可用 `--edge-packages.dir` flag 或 `EDGE_PACKAGE_DIR` 环境变量覆盖）下的 `release_meta.json`；**未打包（清单缺失或产物不可用）时清单为空数组 + 200**，前端走「暂无可下载的离线安装包」空态。产物形态为 **tar.gz 一体化离线包**（不再有 zip 形态）。

### GET /api/v2/platform/edge-packages

响应 data 为数组，每项为 `PackageArtifact`（对齐 `platform/edge/packages_service.go` ListPackages，经 `response.OK` 返回）。清单来自构建产物 `release_meta.json`（单版本，返回 1 条）：

```json
{
  "status": "success",
  "data": [
    {
      "id": "release-v0.2.0",
      "version": "v0.2.0",
      "file": "edge-sync-agent-v0.2.0-linux-amd64-20260922-121018.tar.gz",
      "sha256": "95e1ac…b0b3",
      "size_bytes": 64137158,
      "components": [
        { "name": "edge-sync-agent", "version": "v0.2.0" },
        { "name": "vmagent", "version": "v1.152.0" },
        { "name": "blackbox_exporter", "version": "v0.26.0" }
      ],
      "download_url": "/api/v2/platform/edge-packages/v0.2.0/download"
    }
  ]
}
```

- `file`：tarball 的**纯文件名**（不含路径），来自 `release_meta.json` 的 `file` 字段（文件名带构建时间戳，无法由 `version` 推导）。
- `size_bytes` / `sha256`：整包（tar.gz）字节数与校验和，直接取清单值（下载时复用，不重算）。
- 清单为空时 `data` 为空数组（`[]`），HTTP 200。

### GET /api/v2/platform/edge-packages/latest/download

流式下发最新离线包 **tar.gz**（`Content-Type: application/gzip`；`Content-Disposition: attachment; filename="<file>"` 用清单真实文件名；`ETag` + `X-Checksum-Sha256` 取清单 `sha256`；`Content-Length` 取清单 `size_bytes`），服务端按文件句柄流式输出，不整包读内存。

### GET /api/v2/platform/edge-packages/{version}/download

**（T11-20 新增）** 指定版本下载，保留 `/latest/download`。响应格式同 latest；版本不存在返回 404 `not_found`。

> 离线包下载接口需认证（平台用户鉴权）。下载响应 Content-Type: `application/gzip`。

## 3. F-42 增量（2026-10-10：回传参数产品化 + 人工重启采集进程）

> 对齐 `platform/edge/heartbeat_service.go` / `management_service.go` / `restart_handler.go` / `zipper.go` 与 `platform/edge-sync-agent/internal/contract/contract.go`。全部为**向后兼容增量**：老 Agent 忽略未知响应字段；老中心不携带新字段时 Agent 走内置兜底。

### 3.1 心跳契约（POST /api/v1/heartbeat，两侧对称）

**请求新增（Agent → 中心，回传参数指纹，omitempty）**：

```json
{
  "metadata_remote_write_url": "https://center:9090/api/v1/write",
  "metadata_max_disk_usage_per_url": "50GB"
}
```

- 取值为当前生效配置目录 `metadata.json` 中落盘的回传参数原样上报；未拉过包 / 老 Agent 不上报（键缺失）。
- 中心与网域当前配置（`remote_write_url` / `max_disk_usage_per_url`）比对：一致 → `params_changed=false` 并镜像落库指纹；不一致（含**空指纹 vs 网域有参数**）→ `params_changed=true`。

**响应新增（中心 → Agent，omitempty）**：

```json
{
  "config_changed": false,
  "config_version": "20260920-120000",
  "config_download_url": "…",
  "params_changed": true,
  "vm_agent_restart_seq": 3
}
```

- `params_changed`（bool，恒发送）：网域回传参数与 Agent 上报指纹不一致。Agent 见 true 时即使 `config_changed=false` 也强制拉包（网域参数变更不改配置版本号）。
- `vm_agent_restart_seq`（int64，0/缺失 = 无指令）：人工重启指令序号。Agent 发现响应序号 **大于本地已执行序号** 时幂等滚动重启 vmagent 采集子进程（仅采集进程，Agent 本体与持久队列不受影响），成功后本地持久化已执行序号（`<EDGE_CONFIG_ROOT>/restart-state.json` 的 `executed_vm_agent_restart_seq`）；失败不落盘，下轮心跳自动重试。

### 3.2 配置包 metadata.json 新增（下发通道）

`zipper.BuildConfigZip` 新增参数（F-42），metadata.json 在原有 `config_version / generated_at / agent_type / checksum / remote_write_url` 基础上新增：

```json
{ "max_disk_usage_per_url": "50GB" }
```

- 网域未显式配置时省略该键（Agent 按「metadata > `EDGE_REMOTE_WRITE_MAX_DISK_USAGE` 环境变量 > 2GB 兜底」解析）。
- `max_disk_usage_per_url` **不参与联合 checksum**（参数变更不改变 checksum，靠 `params_changed` 驱动拉包）；Deployer 侧把它与 `remote_write_url` 共同作为网域回传参数指纹，同版本重应用。

### 3.3 采集节点视图（AgentView，GET 列表/详情共用）新增字段

```json
{
  "metadata_remote_write_url": "https://center:9090/api/v1/write",
  "metadata_max_disk_usage_per_url": "50GB",
  "vm_agent_restart_seq": 3,
  "restart_requested_by": "admin-a",
  "restart_requested_at": "2026-10-10T12:00:00Z"
}
```

- `metadata_remote_write_url` / `metadata_max_disk_usage_per_url`：节点当前生效回传参数（心跳指纹镜像）；空 = 未下发，Agent 走内置兜底。
- `vm_agent_restart_seq` / `restart_requested_by` / `restart_requested_at`：人工重启指令位当前值与最近一次触发人/时间（留痕），供节点详情抽屉展示「最近人工重启」。

### 3.4 新增端点：PUT /api/v2/platform/edge-agents/:id/restart

人工滚动重启指令（F-42 seq 简化机制），**RequireAdmin** 门禁；请求体为空对象 `{}`。

- 成功（200）：`vm_agent_restart_seq` 原子 +1 并记录触发人/时间，返回重启后的节点视图（同 §3.3 AgentView，前端据此刷新）。
- 404 `not_found`：节点不存在（或已软删）。
- 400 `bad_request`：节点非 online（offline / unknown / retired）——指令位推进后要等节点上线心跳才会被执行，MVP 直接拒绝并提示先恢复在线。

### 3.5 网域模型（NetworkDomain）新增字段

- 响应与登记/更新载荷：`max_disk_usage_per_url`（string，可选，空 = Agent 内置兜底；格式校验对齐 vmagent `-remoteWrite.maxDiskUsagePerURL` 值域：数字 + 可选单位 KB/MB/GB/TB/…，大小写不敏感；非法格式 400）。
- 登记输入（`OnboardDomainInput`）与更新载荷（`UpdateDomainPayload`）同名承载；仅非 local 通道网域有意义（中心直连域不生成回传参数）；更新暂不支持置空（空串 = 不更新）。
- 网域参数变更**不修改配置版本号**，仅通过心跳指纹比对 → `params_changed=true` 驱动 Agent 强制拉包。