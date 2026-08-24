# API 契约快照 — Module 09 网域与边缘配置中心

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。

## 0. 快照元信息

| 项 | 值 |
|----|----|
| Phase | Phase 4（网域纳管 + 配置变更确认 + 下发记录） |
| 模块 | module-09-config-center |
| 分支 | feat/module-09-config-center |
| 版本 | v2026-08-23（新建） |
| 生成方式 | planner Phase 2 派生（code-sequence-planner） |
| 来源 | PRD `Module_09_Network_Domain_and_Edge_Config_Center.md` §3/§5/§6/§8/§9/§11；`03_API_Standard.md` §7；`05_Code_Implementation_Plan.md` Phase 4；`task-sequence.yaml` |

## 1. 通用契约

### 1.1 前缀与响应

- 管理面前缀：`/api/v2/platform/*`（本模块全部 REST 管理接口）；Prometheus 查询代理走 `/api/v1/*`，本模块不涉。
- 统一响应：`{status: success, data}` / `{status: error, errorType, error}`（沿用 `platform/api/response`）。

### 1.2 errorType 枚举

`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict`

### 1.3 分页信封

| 接口 | 信封 | 默认/上限 |
|------|------|-----------|
| `GET /network-domains` | `items` | page=1 / page_size=20；∥上限=100 |
| `GET /config-drafts` | `items` | page=1 / page_size=20；上限=100 |
| `GET /config-versions` | `items` | page=1 / page_size=20；上限=100 |
| `GET /deployments` | `items` | page=1 / page_size=20；上限=100 |
| `GET /edge-agents`（v0.2） | `items` | page=1 / page_size=20；上限=100 |

> ⚠️ 前端消费必须按接口区分信封——本模块均用 `items`（**非** `list`）；空结果一律返回 `[]` 而非 `null`。

## 2. 路径偏差说明（PRD → 实际实现）

| PRD §6/§6.6 原文 | 实际实现（前端消费） | 原因 |
|-------------------|---------------------|------|
| `POST /api/v2/platform/network-domains/{id}/monitor`（L2 §6.6.1 用 `onboard`） | 统一用 `/{id}/monitor`（纳管动词），reset-token 用 `/{id}/reset-token` | 决策拍平「onboard/monitor」为 `monitor`；L2 接口预览写的 `onboard` 收敛到本条 |
| `GET /api/v2/platform/config/preview?draft_id=`（L2 预置占位 L87-89） | 详情取数统一走 `GET /config-drafts/{change_no}`（含完整产物）；`/config/preview` 不再单独使用 | 变更详情本身即预览数据源，避免重复端点；旧占位在 T09-07 收敛 |
| `POST /api/v2/platform/config/apply`（L2 预置） | local 下发由 `confirm` 触发（确认即生成 ConfigVersion 并 reload）；不另设独立 apply | MVP default/local 下 confirm 与下发同一动作；历史/回滚/重试走 deployments |

## 3. 网域监控纳管 API（domain service）

> 行政字段（name / domain_type / tenant_id / enabled / zone_type）由 M06 维护，本模块**只读引用**；M09 仅维护监控纳管字段。列表 `GET /network-domains` 既返回行政字段（M06）也返回监控纳管字段（M09 合并）。

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/api/v2/platform/network-domains` | Query: `keyword?`、`page`、`page_size` | `{ items: [NetworkDomain], total }`；item 见下表 | `forbidden`：越权其他租户 | §6.5.1 |
| POST | `/api/v2/platform/network-domains/{id}/monitor` | body `{ agent_type, remote_write_url?, description? }` | 纳管后 NetworkDomain（含 `is_monitored:true`；`token`/`token_masked` 仅 agent_pull 签发一次） | `bad_request`：未在 M06 建 / 已纳管 / default 非 local 冲突；`not_found` | §6.5.1 |
| PUT | `/api/v2/platform/network-domains/{id}/monitor` | body `{ agent_type?, remote_write_url?, description?, is_monitored? }` | 更新后 NetworkDomain | `not_found`；`bad_request`：未纳管 | §6.5.1 |
| POST | `/api/v2/platform/network-domains/{id}/reset-token` | — | `{ token: '<一次性明文>', token_masked: '<完全脱敏>' }` | `not_found`；`bad_request`：非 agent_pull 已纳管 | §6.5.1 |

### NetworkDomain 关键字段（前端消费，合并 M06+M09）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 网域 ID（M06 生成，`<deploy_code>-<domain_code>`，`default` 例外） |
| `name` | string | ✅ | 网域名（M06，UI 两行合并展示 名称+ID） |
| `domain_type` | enum(management/edge) | ✅ | 管理域 / 边缘域（M06） |
| `zone_type` | string | ❌ | 网络区域类型（M06 字典，政务云/公有云；M09 只读展示） |
| `tenant_id` | string | ✅ | 归属租户（M06，创建后不可变） |
| `channel` | enum(local/agent_pull) | ✅ | `default` 固定 `local`；其他网域固定 `agent_pull` |
| `agent_type` | enum(vmagent/prometheus-agent) | ✅/❌ | MVP 固定 `vmagent`；agent_pull 必填，local 空 |
| `center_endpoint` | string | ❌/✅ | 中心接入地址；agent_pull 必填，local 空 |
| `remote_write_url` | string | ✅/❌ | agent_pull 必填；local 空 |
| `token` / `token_masked` | string | ❌ | agent_pull 专属；**完全脱敏**（不显明文片段），明文经 copy/reset 单次获取 |
| `is_monitored` | bool | ✅ | 已纳管监控标记（M09 写）；前端据此派生注册态 `monitored`/`created` |
| `monitored_status` | enum(online/offline/unknown) | ❌ | 运行态，agent_pull 心跳更新；MVP local 恒空 |
| `last_heartbeat` | datetime | ❌ | agent_pull 运行态 |
| `agent_version` | string | ❌ | agent_pull 运行态 |
| `status` | enum(enabled/disabled) | ✅ | 行政启用态（M06；disabled=冻结域，MVP 冻结域不生成新变更单） |
| `created_at` / `updated_at` | datetime | — | 时间戳 |

## 4. 配置变更确认 API（config-draft service）

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| POST | `/api/v2/platform/config/drafts` | body `{ network_domain_id }`（手动触发生成） | 新/已有 `ConfigDraft` | `bad_request`：未选已纳管网域 / 冻结网域 | §6.5.2 / 决策 30 |
| GET | `/api/v2/platform/config-drafts` | Query: `network_domain_id`、`status(pending/confirmed/discarded/all 默认 pending)`、`page`、`page_size` | `{ items: [DraftListItem], total }` | `bad_request`：未选已纳管网域 | §6.5.2 |
| GET | `/api/v2/platform/config-drafts/{change_no}` | — | `ConfigDraftDetail`（含产物） | `not_found` | §6.5.2 |
| POST | `/api/v2/platform/config-drafts/{change_no}/confirm` | body `{ confirmed_by }`（MVP 预置用户） | 生成的 `ConfigVersion`（含 `id`/`change_no`/产物） | `bad_request`：validation_status=failed / 已非 pending；`not_found` | §6.5.2 |
| POST | `/api/v2/platform/config-drafts/{change_no}/revalidate` | — | 返回新 `validation_status` | `bad_request`：校验仍 failed / 已非 failed；`not_found` | §6.5.2 |
| POST | `/api/v2/platform/config-drafts/{change_no}/discard` | body `{ discarded_by? }` | 废弃后的变更单 | `bad_request`：已非 pending/failed；`not_found` | §6.5.2 |

### DraftListItem（列表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `change_no` | string | 变更单号 `CHG-YYYYMMDD-NNN`，用户可读唯一标识 |
| `network_domain_id` / `network_domain_name` | string | 网域 |
| `channel` | enum | local/agent_pull（行内下发通道 Tag） |
| `status` | enum | pending/confirmed/discarded |
| `summary` | string | 人话变更摘要 |
| `risk` | enum | low/high（取该变更最高风险） |
| `affected_files` | [enum] | prometheus/targets/rules/blackbox |
| `validation_status` | enum | passed/failed/pending |
| `confirmed_by` | string | confirmed 时显示确认人；pending 显示未确认 |
| `confirmed_at` | datetime | |
| `created_at` | datetime | 生成时间 |

### ConfigDraftDetail（详情，含 preview 数据源与 diff 依据）

| 字段 | 类型 | 说明 |
|------|------|------|
| （上表全部字段） | | |
| `source_version` | string | 基于哪个 ConfigVersion；用于版本对比 Tab |
| `prometheus_yml` | string | prometheus.yml 文本 |
| `rules_yml` | string | rules.yml（可选） |
| `blackbox_yml` | string | blackbox.yml（可选） |
| `targets_files` | object | `<job_name>.json` → content 的映射（前端数据驱动遍历渲染子 Tab） |
| `metadata` | object | `{ source_data_version, trigger_summary, checksum, generator_version, superseded_by_change_no? }` 技术信息（折叠） |
| `change_items` | [ConfigChangeItem] | 结构化变更清单 |

### ConfigChangeItem

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | |
| `type` | enum(add/update/delete) | 变更类型 |
| `target` | enum | 变更对象：采集 Job `scrape_job` / 采集目标 `target_instance` / 告警规则 `monitoring_rule` / 拨测目标 `probe_target` / 标签模板 `label_template` |
| `description` | string | 变更说明（人话） |
| `affected_files` | [enum] | 影响的配置文件：prometheus / targets / rules / blackbox |
| `risk` | enum | low/high |

## 5. 配置版本与下发记录 API（config-version / deployment service）

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/api/v2/platform/config-versions` | Query: `network_domain_id`、`change_no?`、`page`、`page_size` | `{ items: [ConfigVersion], total }` | — | §6.5.3 |
| GET | `/api/v2/platform/config-versions/{id}` | — | ConfigVersion 详情（含完整产物，供 diff） | `not_found` | §6.5.3 |
| GET | `/api/v2/platform/deployments` | Query: `network_domain_id`、`status?`、`change_no?`、`page`、`page_size` | `{ items: [ConfigDeployment], total }` | — | §6.5.3 |
| POST | `/api/v2/platform/deployments/{deployment_id}/retry` | body `{ triggered_by }` | 新的 ConfigDeployment | `bad_request`：非 local / 原记录非 failed；`not_found` | §6.5.3 / 决策 42-3 |
| POST | `/api/v2/platform/deployments/{config_version_id}/rollback` | body `{ triggered_by }` | 新的 ConfigDeployment（回滚目标版本） | `not_found`；`bad_request`：目标版本不存在/不同网域 | §6.5.3 |

### ConfigDeployment（下发记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 部署/发布 ID（`deploy-xxx`） |
| `network_domain_id` | string | 网域 |
| `config_version_id` | string | 配置版本（`cv-xxx`） |
| `source_change_no` | string | 来源变更单号 |
| `channel` | enum | local/agent_pull |
| `status` | enum | pending / running / success / failed / rolled_back |
| `validation_status` | enum | passed/failed/pending |
| `includes_blackbox` | bool | |
| `error_message` | string | failed 时错误信息（前端 Tooltip） |
| `triggered_by` | string | 操作人 |
| `triggered_at` | datetime | 开始时间 |
| `completed_at` | datetime | |

### ConfigVersion

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 配置版本（cv-xxx） |
| `network_domain_id` | string | |
| `draft_id` / `change_no` | string | 来源草稿/变更单 |
| 产物字段 | string/object | prometheus_yml / rules_yml / blackbox_yml / targets_files（同 draft detail 结构） |

## 6. 采集节点状态查询 API（edge-agent，v0.2）

> **MVP 不实现**（`feat/module-09-edge-cloud`）。前端采集节点状态页 MVP 仅空态占位，不消费此接口。此处仅为契约占位、防前端在 MVP 误联调。

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 |
|------|------|----------------|-----------|----------|
| GET | `/api/v2/platform/edge-agents` | Query: `network_domain_id?`、`component_type?`、`status?`、`page`、`page_size` | `{ items: [EdgeAgent], total }` | — |
| GET | `/api/v2/platform/edge-agents/{id}` | — | Agent 详情 | `not_found` |

## 7. Edge Sync Agent 协议（v0.2，本分支不实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v2/platform/edge/heartbeat` | 心跳上报（30s） |
| GET | `/api/v2/platform/edge/config?network_domain=` | 配置包拉取 |

## 8. 枚举字典

| 枚举 | 取值 | 说明 |
|------|------|------|
| `channel` | `local` / `agent_pull` | 下发通道；`default`=local，其他=agent_pull |
| `agent_type` | `vmagent` / `prometheus-agent` | MVP 前端仅 vmagent |
| `domain_type` | `management` / `edge` | 管理域/边缘域（M06） |
| 网域注册态（前端派生） | `monitored`（is_monitored=true）/ `created` | 非接口枚举，前端由 is_monitored 派生 |
| 网域运行态 | `online` / `offline` / `unknown` | agent_pull 心跳 |
| 行政启用态 `status` | `enabled` / `disabled` | disabled=冻结域（M06，不生成新变更单） |
| 草稿 `status` | `pending` / `confirmed` / `discarded` | 同域保活一张 pending（后单取代前单） |
| `validation_status` | `passed` / `failed` / `pending` / `rejected` | 下发前校验 |
| 下发 `status` | `pending` / `running` / `success` / `failed` / `rolled_back` | ConfigDeployment |
| `config_sync_status`（v0.2） | `in_sync` / `out_of_sync` / `unknown` / `manual_override` / `no_version` | 五档 |
| `out_of_sync_cause`（v0.2） | `pending_draft` / `pull_pending` / `local_reset` | 未同步成因 |
| 变更对象 `target` | `scrape_job` / `target_instance` / `monitoring_rule` / `probe_target` / `label_template` | |
| 变更类型 type | `add` / `update` / `delete` | |
| 风险 `risk` | `low` / `high` | 删除目标/告警规则变更=high |
| 影响的配置文件 | `prometheus` / `targets` / `rules` / `blackbox` | |
| M01 `change_status` 回写 | `pending` / `confirmed` / `deployed` / `none` | confirm→pending→deployed（决策 31-M2） |

## 9. 字段必填口径

- **网域纳管 POST /monitor**：`agent_type` 必填（MVP 仅 vmagent）；`remote_write_url`/`description` 可选（agent_pull 域 MVP 登记即写）；`channel` 由网域固定（default=local），不随请求传入不提供切换。
- **更新 PUT /monitor**：可改 `agent_type`/`remote_write_url`/`description`/`is_monitored`；不可改 `id`/`name`/`tenant_id`/`domain_type`/`channel`（channel 固定）。
- **confirm**：必填 `confirmed_by`（MVP 预置用户）；仅 `status=pending && validation_status=passed` 可确认。
- **retry**：必填 `triggered_by`；仅 `local` 通道 + 原记录 `status=failed`。
- **rollback**：必填 `triggered_by`；目标版本须存在且与当前网域一致。
- **Token**：仅 `channel=agent_pull` 网域签发；`token_masked` 完全脱敏，明文仅签发/重置单次返回。

## 10. UI 展示名映射（字段 ↔ 用户语言）

| 接口字段（snake_case） | UI 展示名 | 备注 |
|------------------------|-----------|------|
| `NetworkDomain.channel` | 下发通道 | Tag：local=中性、agent_pull=蓝 |
| `NetworkDomain.zone_type` | 网络区域类型 | Tag 展示 |
| `NetworkDomain.is_monitored` | 纳管状态 | 派生 monitored=「已纳管」/ created=「未纳管」 |
| `NetworkDomain.monitored_status` | 运行状态 | 仅 agent_pull，local 显 `-` |
| `NetworkDomain.token_masked` | 凭据 | 完全脱敏 + 复制按钮，仅 agent_pull |
| `ConfigDraft.change_no` | 变更单号 | CHG-YYYYMMDD-NNN |
| `ConfigDraft.status` | 变更状态 | 待确认/已确认/已废弃/全部 |
| `ConfigDraft.summary` | 变更摘要 | 人话摘要 |
| `ConfigChangeItem.target` | 变更对象 | 采集 Job/采集目标/告警规则/拨测目标/标签模板 |
| `ConfigChangeItem.affected_files` | 影响的配置文件 | prometheus.yml/targets/rules.yml/blackbox.yml |
| `ConfigChangeItem.risk` | 风险等级 | 低风险/高风险 |
| `validation_status` | 下发前校验 | 通过/失败/待校验 |
| `ConfigDeployment.status` | 状态 | 待执行/执行中/成功/失败/已回滚 |
| `ConfigDeployment.source_change_no` | 来源变更单号 | |
| `config_sync_status` | 配置同步 | 已同步/未同步/人工覆盖/未知/未下发配置（v0.2） |
| 网域监控纳管 | 网域纳管 | 页面/菜单名，区别于 M06「网域管理」 |

## 11. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md` §3/§5/§6/§8/§9/§11
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7
- 序列：`docs/05-execution-records/module-09/task-sequence.yaml`
- 映射：`docs/05-execution-records/module-09/frontend-prototype-map.md`