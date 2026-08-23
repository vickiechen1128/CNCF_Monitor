# API 契约快照 — Module 01 监控策略与指标管理（Phase 3 MVP）

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前日。发生任一变更时旧版快照作废。

## 0. 快照元信息

| 项 | 值 |
|----|----|
| Phase | Phase 3（MVP 子集） |
| 模块 | module-01-strategy |
| 分支 | feat/module-01-strategy |
| 版本 | v2026-08-23（新建 / 第 1 版） |
| 生成方式 | planner Phase 2 派生（code-sequence-planner） |
| 来源 | PRD `Module_01_Metric_Collection_Center.md` v3.26 §3/§5/§6/§8/§9/§10/§11；`03_API_Standard.md` §3/§7；`task-sequence.yaml` |

> **本期范围外**：BusinessMetric 业务指标库（P2，无 API/UI）、字段化规则编辑 + PromQL 校验/预览（v0.3）、v0.2 能力（草稿 draft api/clone/批量提交/网域覆盖表/service_discovery）。

## 1. 通用契约

### 1.1 前缀与响应
- 前缀：`/api/v2/platform`（平台专属能力归平台组，与 M06/M07 已落地一致；PRD §6 原文 `/api/v1` 为偏差，见 §2）
- 统一响应：`{status: success, data}` / `{status: error, errorType, error}`

### 1.2 errorType 枚举
`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict`

### 1.3 分页信封（关键差异）
| 接口 | 信封 | 默认/上限 |
|------|------|-----------|
| 全部主资源列表（exporter-templates / ci-exporter-mappings / scrape-jobs / monitoring-rules / metric-library / scrape-jobs/instance-candidates） | `list` 键 | page 从 1；**默认 page_size=20**（PRD §11.1 + API 标准 §7.2），上限 100 |
| 子资源（`/scrape-jobs/:id/instances`） | `items` 键 | 不分页 |

> ⚠️ 前端必须按接口区分 `list`/`items` 信封；空结果一律 `[]` 而非 `null`。
> ⚠️ PRD §6.2 各表写 `{items,total}` 与 API 标准/已落地 M07 的 `list` 键冲突——**统一 `list` 键**。

## 2. 路径偏差说明（PRD → 实际实现）
| PRD §6 原文 | 实际实现（前端消费） | 原因 |
|-------------|---------------------|------|
| 前缀 `/api/v1` | 前缀 `/api/v2/platform` | 平台能力归平台组，与 M06/M07 一致（03_API_Standard §1） |
| `/probe-configs`（L2 接口预览） | 不采用，blackbox 为 ScrapeJob `job_type=blackbox` 字段 | PRD §5.4 权威：无独立拨测实体 |
| `POST/DELETE .../scrape-jobs/{job_id}/instances/{resource_id}/confirm` | `POST/DELETE /api/v2/platform/scrape-jobs/:id/instances/:resource_id/confirm` | 前缀迁移 |
| `GET .../scrape-jobs?label_template_id=` | 同上，前缀迁移 | 模板引用反查 |
| 实例候选查询（PRD 无独立端点） | 新增 `GET /scrape-jobs/instance-candidates` | 为 Job 表单提供候选（快照补充契约） |

## 3. ExporterTemplate API
| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/exporter-templates` | `monitor_type`、`source`(official/third_party/internal)、`page`、`page_size` | `{list,total,page,page_size}`，item=§5.2 字段 | — | §5.2/6.1 |
| POST | `/exporter-templates` | `ExporterTemplateInput` | 创建的完整对象 | `bad_request`：source=internal 缺 default_port/metrics_path/scheme；is_builtin 只读拒绝 | §5.2/9.1 |
| PUT | `/exporter-templates/:id` | 部分可改字段 | 更新后完整对象 | `not_found`；`forbidden`：内置 | §5.2 |
| DELETE | `/exporter-templates/:id` | — | `{id}` | `not_found`；`forbidden`：内置/被映射引用 | §5.2 |

字段：`name`(唯一)/`version`/`default_port`/`metrics_path`(默认 /metrics)/`scheme`(默认 http)/`supported_monitor_types[]`/`os`(linux/windows/any)/`arch`(amd64/arm64/any)/`download_url`/`homepage`/`install_guide`(唯一持有方)/`source`/`is_builtin`。

## 4. CITypeExporterMapping API
| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/ci-exporter-mappings` | `monitor_type`、`is_default`、`page`、`page_size` | `{list,...}`；item 附 `has_label_template` + `is_referenced`（未被引用标记） | — | §6.2.1 |
| POST | `/ci-exporter-mappings` | `{monitor_type, exporter_template_id, is_default?, default_port?, metrics_path?, scheme?, scrape_interval?, scrape_timeout?, label_template_id?}` | 创建后完整对象 | `bad_request`：同 monitor_type 多个 is_default=true | §6.2.1 |
| PUT | `/ci-exporter-mappings/:id` | 部分可改字段 | 更新后完整对象 | `not_found`；`bad_request`：同类型多个默认 | §6.2.1 |
| DELETE | `/ci-exporter-mappings/:id` | — | `{id}` | `bad_request`：内置默认禁删；`forbidden`：被 ScrapeJob 引用 | §6.2.1 |

**网域无关**：预设采集实现层，不绑网域；每 monitor_type 可多行，`is_default` 至多一个。`install_guide` 只读透传自 ExporterTemplate，本表不持有。

## 5. ScrapeJob API
| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/scrape-jobs` | `network_domain_id`(仅已纳管)、`monitor_type`、`job_type`、`enabled`、`keyword`、`page`、`page_size` | `{list,...}`；item 含 `change_status` | — | §6.2.2 |
| GET | `/scrape-jobs?label_template_id=` | `label_template_id`(必填) | `{list,...}`：引用该模板的 Job | `not_found`：模板不存在 | §6.2.2 |
| POST | `/scrape-jobs` | `ScrapeJobInput`（§5.4 全字段 + auth/TLS + blackbox） | 创建后完整对象（含 change_status/draft_status） | `bad_request`：网域未纳管/冻结、实例非同域、认证TLS非法、blackbox 缺字段 | §6.2.2 |
| PUT | `/scrape-jobs/:id` | 可改字段 | 更新后完整对象 | `not_found`；`bad_request`：同上 | §6.2.2 |
| DELETE | `/scrape-jobs/:id` | — | `{id}` | `not_found` | §6.2.2 |

关键字段（§5.4）：`job_name`(唯一)、`monitor_type`、`exporter_template_id?`(可空=手填)、`network_domain_id`(**必填，is_monitored=true 且 status=enabled**)、`instance_selection_mode`(manual)、`selected_instance_ids[]`、`scrape_interval`/`scrape_timeout`/`metrics_path`/`scheme`(继承映射快照可覆盖)、`auth_type`(none/basic/bearer)+`username`/`password`/`token`、`tls_skip_verify`(默认 false)/`ca_file`、`label_template_id`、`mapping_overrides[]`、`job_type`(standard/blackbox)、`blackbox_module`/`blackbox_targets[]`(blackbox 必填)、`enabled`、`draft_status`(默认 ready)、`change_status`。

认证TLS（决策31）：basic→username+password 必填；bearer→token 必填；**password/token 仅存储，JSON 不回显明文**。
blackbox：job_type=blackbox 时 monitor_type/exporter_template_id 置空；blackbox_module 必填 + blackbox_targets 非空（protocol∈{http,https,tcp,icmp,dns}）。
`BlackboxTarget`：`{target 必填, protocol∈{http,https,tcp,icmp,dns}, url 可选}`。

## 6. 实例选择 + Exporter 安装确认 API
| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/scrape-jobs/instance-candidates` | `monitor_type`(必填)、`network_domain_id`(必填)、`keyword`、`page`、`page_size` | `{list,...}`；item=InstanceCandidate{resource_id, instance_name, instance_ip, status, disabled}（status=offline 时 disabled=true 置灰） | — | §5.4/决策29 |
| GET | `/scrape-jobs/:id/instances` | — | `{items,total}`：已选实例 + 安装状态（unconfirmed/confirmed） | `not_found` | §6.2.5 |
| POST | `/scrape-jobs/:id/instances/:resource_id/confirm` | `{confirmed_by(必填), actual_port?, notes?}` | 确认记录 | `bad_request`：资源不在选中集/非同域；`not_found` | §6.2.5 |
| DELETE | `/scrape-jobs/:id/instances/:resource_id/confirm` | — | `{resource_id, job_id}` | `not_found` | §6.2.5 |
| POST | `/scrape-jobs/:id/preview-targets` | — | 解析后的目标清单（standard→实例地址；blackbox→targets） | `not_found` | L2 接口预览 |

**安装确认维度（用户决策）**：ExporterInstallationConfirmation 的 **PK = (resource_id, scrape_job_id)**，FK scrape_job_id→ScrapeJob.id；`exporter_template_id` 为冗余缓存（来自 ScrapeJob，不参与唯一性）；status∈{unconfirmed, confirmed, not_applicable}（blackbox/application_http 用 not_applicable，不落确认记录）。PRD §5.6 主键维度为过时表述，实施以本行 + §6.2.5/§8④ 为准（PRD 待修订，见 dev-feedback）。

实例候选自动收敛：同 monitor_type（推导到资源类别）+ 同网域；offline 显示但置灰不可选（决策29）。
安装确认状态机（§8 ④）：unconfirmed → confirmed；not_applicable 用于 blackbox/application。

## 7. MonitoringRule（MVP 文件挂载）API
| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/monitoring-rules` | `rule_type`、`enabled`、`keyword`、`page`、`page_size` | `{list,...}`；item 含 content_mode/name/enabled/change_status/draft_status | — | §6.2.4 |
| POST | `/monitoring-rules` | `{content_mode=yaml_passthrough, rule_content(必填), name?, enabled}` | 创建后完整对象（draft_status=ready，change_status=pending） | `bad_request`：rule_content 空/YAML 非法（groups 非数组） | §6.2.4 |
| PUT | `/monitoring-rules/:id` | `{name?, rule_content?, enabled?}` | 更新后完整对象 | `not_found`；`bad_request`：YAML 非法 | §6.2.4 |
| DELETE | `/monitoring-rules/:id` | — | `{id}` | `not_found` | §6.2.4 |
| POST | `/monitoring-rules/:id/validate-yaml` | `{rule_content}` | `{valid, error?}` | — | §6.2.4 |

字段：`content_mode∈{yaml_passthrough, structured}`、`rule_content`（yaml_passthrough 必填）、`name`(可空)、`scope=central`(固定)、`enabled`、`draft_status`(默认 ready)、`change_status`。structured 字段（rule_type/expr/duration/labels/annotations）v0.3 用，本期不在请求体。
> YAML 校验至少校验 `groups` 存在且为数组；不做 PromQL 语义校验（v0.3）。

## 8. 技术指标库（ExporterMetricLibrary）API
| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/metric-library` | `monitor_type`、`metric_type`、`category`(可选)、`keyword`、`page`、`page_size` | `{list,...}`；item=§5.3 字段 | — | §6.2.3 |
| POST | `/metric-library` | §5.3 字段（is_builtin=false 用户扩展） | 创建后完整对象 | `bad_request`：metric_name+monitor_types 重复 / monitor_type 不存在 | §6.2.3 |
| PUT | `/metric-library/:metric_id` | `enabled`/`help`/`unit`/`monitor_types`/`category` | 更新后完整对象 | `forbidden`：内置禁改；`not_found` | §6.2.3 |

字段（§5.3）：`metric_name`、`metric_type`(counter/gauge/histogram/summary/unknown)、`help`、`unit`、`labels[]`、`monitor_types[]`(锚点，多对多含 source_exporter 来源标注)、`category`(语义域，P1 可选)、`exporter_template_id`(建议采集器，可空)、`is_builtin`、`enabled`。同指标多 monitor_type 归属；同名不同义依赖 source_exporter 区分。

## 9. 枚举字典
| 枚举 | 取值 | 说明 |
|------|------|------|
| `monitor_type` | `host_linux`/`host_windows`/`mysql`/`redis`/`kafka`/`elasticsearch`/`nginx`/`application_http`/`snmp` | MONITOR_TYPE_DERIVATION_MAP 推导 |
| `job_type` | `standard`/`blackbox` | UI「采集 / 拨测」 |
| `auth_type` | `none`(默认)/`basic`/`bearer` | 决策31 |
| `blackbox_module` | `http_2xx`/`icmp_ping`/`tcp_connect`/`dns_query` 等 | blackbox.yml 模块名 |
| `BlackboxTarget.protocol` | `http`/`https`/`tcp`/`icmp`/`dns` | 拨测目标协议 |
| `instance_selection_mode` | `manual`(MVP)/`filter`(v0.3+) | |
| `source`(ExporterTemplate) | `official`/`third_party`/`internal` | 采集器来源 |
| `change_status` | `pending`/`confirmed`/`deployed`/`none` | 下发状态，M09 回写 |
| `draft_status` | `draft`/`ready` | MVP 默认 ready |
| `metric_type` | `counter`/`gauge`/`histogram`/`summary`/`unknown` | 指标类型 |
| `ExporterInstallation.status` | `unconfirmed`/`confirmed`/`not_applicable` | 安装确认状态（§8 统一枚举） |
| `confirmed_by` | 固定 `platform_admin` | MVP 无鉴权 |
| `content_mode` | `yaml_passthrough`(MVP)/`structured`(v0.3+) | 规则内容形态 |
| `scope` | `central`(固定)/`edge`/`both`(v0.4+) | 求值范围 |

## 10. 字段必填口径
- **ExporterTemplate 创建**：name/metrics_path/scheme 必填；source=internal 追加 default_port 必填；source=official|third_party 平台预置只读。
- **CITypeExporterMapping 创建**：monitor_type/exporter_template_id 必填；label_template_id 可选；每类型至多一个 is_default。
- **ScrapeJob 创建**：job_name/monitor_type/network_domain_id(已纳管非冻结)/instance_selection_mode/scrape_interval/scrape_timeout/metrics_path/scheme 必填；auth_type 默认 none；basic→username+password 必填、bearer→token 必填；job_type=blackbox→blackbox_module+blackbox_targets 必填、monitor_type/exporter 置空；selected_instance_ids 可选（manual 校验同域）。
- **ScrapeJob 更新**：均允许改；仅约束冻结域禁止新增该域实例、认证TLS/blackbox 组合校验一致。
- **MonitoringRule 创建**：content_mode(默认 yaml_passthrough)、rule_content 必填（yaml_passthrough 且 YAML 合法）；name 可选；scope=central 固定。
- **技术指标库创建**：metric_name/metric_type/monitor_types 必填；is_builtin=false；内置只读。

## 11. UI 展示名映射
| 接口字段 | UI 展示名 | 备注 |
|----------|-----------|------|
| `monitor_type` | 监控对象类型 | 两级级联（资源类别→细粒度） |
| `exporter_template_id` | 默认采集器 | 采集标签：node-exporter 等 |
| `network_domain_id` | 网域 | 下拉=已纳管 is_monitored=true |
| `scrape_interval`/`scrape_timeout` | 采集间隔 / 采集超时 | |
| `metrics_path`/`scheme` | 采集路径 / 协议 | |
| `auth_type` | 认证类型 | 决策31 |
| `tls_skip_verify`/`ca_file` | 跳过 TLS 校验 / CA 证书路径 | |
| `job_type` | 采集 / 拨测 | standard=采集 / blackbox=拨测 |
| `blackbox_module`/`blackbox_targets` | 拨测模块 / 拨测目标 | |
| `selected_instance_ids` | 已选实例 | |
| `instance_selection_mode` | 实例选择方式 | manual=手动选择 |
| `change_status` | 下发状态 | pending/confirmed/deployed/none |
| `draft_status` | 草稿状态 | MVP 仅 ready 三态占位 |
| `rule_content` | 规则文件内容 | rules.yml 整文件 |
| `content_mode` | 内容形态 | 文件透传 /（v0.3 字段化） |
| `metric_name`/`metric_type`/`help`/`unit` | 指标名 / 指标类型 / 指标说明 / 单位 | |
| `source_exporter` | 来源采集器 | 同名不同义区分展示 |
| `is_default` | 默认采集实现 | 每类型至多一个 |
| `has_label_template`/`label_template_id` | 标签模板 | M07 只读引用；待配置 badge |
| `is_referenced` | 未被引用 | 采集器池「未被引用」标记 |

## 12. 来源对照表
- PRD：`docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md` §3/§5/§6/§8/§9/§10/§11
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §3/§7
- 序列：`docs/05-execution-records/module-01/task-sequence.yaml`