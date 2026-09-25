# M11 api-contract-snapshot（v0.2 边缘交付增强）

> 生成：2026-09-20。对齐 `platform/edge/*` 现有实现与 PRD §6.2/§6.3/§3.3。
> 跨端任务 T11-21/22/23/24/25 以本文件为第一权威；与 PRD/API 标准冲突时以本文件为准，冲突需上报。
> 基准：`feat/module-09-config-center` 2026-09-20 状态。

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
- `out_of_sync_cause`：`pending_draft` / `pull_pending` / `local_reset`
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