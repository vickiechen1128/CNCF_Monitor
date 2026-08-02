# Module 01: 监控策略与指标管理

> **PRD 状态**: `ready`（已通过原型验证）
> **PRD 版本**: v1.1
> **更新日期**: 2026-08-02
> **对应原型**: `docs/prototypes/module-01/`

> **模块类型**: 核心能力模块
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)、[Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)、[Module_08_Alerting_Rule_Management.md](Module_08_Alerting_Rule_Management.md)
> **目标用户**: 运维工程师

---

## 1. 模块目标

本模块对应 **监控策略配置层**，回答「采什么、怎么采、怎么判」的问题：

1. **监控策略配置（MVP）**：建立 CI 类型与 Exporter 模板的绑定关系，基于该绑定创建并维护 `ScrapeJob`，在隔离网域场景下手动勾选需要监控的实例，并确认 Exporter 已完成安装/注册。
2. **指标元数据管理（P1）**：维护平台可识别的指标名、类型、HELP/UNIT，以及常见 Exporter 的内置指标库（静态库），为规则编辑提供指标提示与校验能力。
3. **规则编辑 UI（MVP）**：提供告警规则与记录规则的类 YAML 表单编辑器，支持 PromQL 校验与指标实时预览；规则的生命周期管理（分组、静默、Alertmanager 配置、告警状态展示）由 [Module_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) 负责。

> **边界说明**：
> - 本模块**不负责** CMDB / Resource 的维护、标签模板（LabelTemplate）的编辑、或 `prometheus.yml` 的生成与下发。Resource 与 LabelTemplate 由 [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 负责；配置生成 / 预览 / 下发由 [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 负责。
> - 本模块**不再负责**运行时采集状态展示（目标列表、拨测结果、probe 结果、抓取诊断、Job 健康度、覆盖率），这些职责已分别移交至 [Module_02: 查询中心](Module_02_Query_Center.md) 与 [Module_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。
> - 本模块持有 `ScrapeJob` 数据模型与编辑入口；MVP 之前该能力由 [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 承载，现已迁移到本模块。

---

## 2. 用户故事

- OPS-01：为指定 CI 类型（如 host / mysql / redis）选择默认 Exporter 模板，建立 CI 类型 ↔ Exporter 模板绑定。
- OPS-02：基于 CI 类型与 Exporter 模板创建一个 `ScrapeJob`，配置 `scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme` 等参数。
- OPS-03：在 MVP 阶段手动勾选需要纳入该 `ScrapeJob` 监控的具体实例；后续版本支持按网域 / 环境 / 应用 / 标签等条件筛选实例。
- OPS-04：确认目标实例上 Exporter 已安装/已注册，避免生成大量 down 目标。
- OPS-05：使用类 YAML 表单编辑告警/记录规则，编辑时获得 PromQL 校验与指标实时预览。
- OPS-06：查看并维护指标元数据（counter/gauge/histogram/summary、HELP、UNIT）以及 Exporter 内置指标库。
- ARCH-01：在 [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表上看到「已监控 / 未监控」badge，快速发现未被任何 `ScrapeJob` 选中的实例（v0.2+）。
- ARCH-02：v0.4+ 基于外部 CMDB 自动发现实例并推荐监控策略（自动规则生成），但仍由工程师在策略模块确认后生效。
- ARCH-03：v1.0 与 ITIL 流程结合，在变更/发布窗口中自动校验监控策略覆盖率。

---

## 3. 核心功能

### 3.1 监控策略配置（MVP）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| CI 类型 ↔ Exporter 模板绑定 | 每种 `resource_type`（host / mysql / redis / kafka 等）映射到一个 ExporterTemplate，包含默认端口、metrics_path、scheme、scrape_interval、scrape_timeout 等 | P0 |
| ScrapeJob 管理 | Job 创建/编辑、命名、启用/禁用、关联 CI 类型与 ExporterTemplate、实例选择模式、标签模板引用 | P0 |
| 实例选择 | MVP 支持「手动勾选」；v0.3+ 支持按网域 / 环境 / 应用 / 标签等条件筛选并预览匹配结果 | P0 / v0.3+ |
| Exporter 安装/注册确认 | 在 Resource 或 Target 上标记 exporter 是否已安装/已注册，生成配置前必须确认 | P0 |
| 拨测配置管理 | Blackbox Exporter 的 probe 模板与拨测目标配置，作为监控策略的一部分由本模块编辑 | P0 |
| 指标元数据管理 | 指标名注册、类型标记（counter/gauge/histogram/summary）、HELP/UNIT | P1 |
| Exporter 指标库 | 静态内置库覆盖常见 Exporter（node-exporter、mysqld-exporter、redis-exporter 等），并提供用户扩展入口；完整管理页面放 P1/P2 | P1 / P2 |
| 高级 Relabel 管理 | 标签丢弃/保留/重写、正则替换、hashmod（未来） | P2 |
| Exporter 市场 | Exporter 登记、版本管理、部署指南（未来） | P2 |

### 3.2 规则编辑 UI（MVP）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 类 YAML 表单 | 提供 expr / for / labels / annotations 字段，支持告警规则与记录规则编辑 | P0 |
| PromQL 校验 | 调用 [Module_02: 查询中心](Module_02_Query_Center.md) 或 Prometheus 接口校验表达式语法 | P0 |
| 指标实时预览 | 在编辑规则时展示指标名、标签键值提示与最近样本预览 | P0 |
| 规则模板 | 按 CI 类型 / Exporter 预置常用规则模板，支持一键填充（P1） | P1 |
| 图形化规则构建器 | 拖拽式构建复杂规则（未来） | P2 |

> 规则编辑 UI 由本模块提供；规则保存后进入 [Module_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) 进行生命周期管理（启用/禁用、分组、静默、Alertmanager 路由、告警状态展示）。

### 3.3 运行时采集状态展示（已移出）

以下功能原属 Module_01，现已移出：

| 功能 | 移交模块 |
|------|----------|
| 目标列表、目标详情、状态筛选 | [Module_02: 查询中心](Module_02_Query_Center.md) |
| 拨测结果展示（probe_success、probe_duration） | [Module_02: 查询中心](Module_02_Query_Center.md) |
| 采集诊断、抓取失败原因、HTTP 状态码 | [Module_02: 查询中心](Module_02_Query_Center.md) |
| Job 健康度、采集覆盖率 | [Module_02: 查询中心](Module_02_Query_Center.md) / [Module_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) |
| 临时目标验证 | [Module_02: 查询中心](Module_02_Query_Center.md)（P2） |
| 边缘 Agent 状态展示 | [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) |

---

## 4. 数据来源

本模块数据来源：

1. [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 提供的 Resource、ResourceType、LabelTemplate 等对象数据。
2. 本模块自身维护的策略配置：CITypeExporterMapping、ScrapeJob、MonitoringRule、ExporterMetricLibrary 等。
3. Prometheus / Thanos / [Module_02: 查询中心](Module_02_Query_Center.md) 提供的指标样本，用于 PromQL 校验与指标预览。
4. [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 返回的配置下发状态与版本信息。

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  Module_07 监控对象管理      │     │  Module_01 监控策略与指标管理 │
│  · Resource / ResourceType   │ --> │  · CITypeExporterMapping     │
│  · LabelTemplate             │     │  · ScrapeJob                 │
│                              │     │  · MonitoringRule            │
└─────────────────────────────┘     │  · ExporterMetricLibrary     │
                                    └──────────────┬──────────────┘
                                                   │ 策略写入 DB
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │  Module_09 网域与边缘配置中心 │
                                    │  · 轮询生成配置草稿           │
                                    │  · 配置预览 / 人工确认        │
                                    │  · 下发 / reload             │
                                    └──────────────┬──────────────┘
                                                   │
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │   Prometheus / Edge Agent    │
                                    │   （运行时采集）              │
                                    └─────────────────────────────┘
```

---

## 5. 数据模型

### 5.1 CI 类型 ↔ Exporter 模板绑定（CITypeExporterMapping）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| id | string | 平台生成 | 唯一标识 |
| resource_type | enum | Module_07 | host / mysql / redis / kafka / ... |
| exporter_template_id | string | 平台生成 | 关联的 ExporterTemplate ID |
| default_port | int | ExporterTemplate | 默认监听端口，如 9100、9104 |
| metrics_path | string | ExporterTemplate | 默认 `/metrics`，可覆盖 |
| scheme | string | ExporterTemplate | http / https，默认 http |
| scrape_interval | duration | 策略配置 | 默认 15s / 30s / 60s |
| scrape_timeout | duration | 策略配置 | 默认 scrape_interval 的 80% |
| label_template_id | string | Module_07 | 生成 target labels 时引用的 LabelTemplate |
| is_builtin | bool | 平台 | 是否平台内置绑定，用户可覆盖 |
| created_at / updated_at | datetime | 平台 | 创建/更新时间 |

### 5.2 Exporter 模板（ExporterTemplate）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 模板名称，如 node-exporter、mysqld-exporter |
| version | string | 版本，如 1.6.1 |
| default_port | int | 默认端口 |
| metrics_path | string | 默认 `/metrics` |
| scheme | string | http / https |
| supported_resource_types | []enum | 可绑定的 resource_type 列表 |
| install_guide | text | 离线/隔离网域安装说明 |
| is_builtin | bool | 是否平台内置 |

### 5.3 Exporter 指标库（ExporterMetricLibrary）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| exporter_template_id | string | 归属的 ExporterTemplate |
| metric_name | string | 指标名 |
| metric_type | enum | counter / gauge / histogram / summary / unknown |
| help | string | 指标 HELP 文本 |
| unit | string | 单位，如 bytes、seconds、percent |
| labels | []string | 常见标签键列表 |
| is_builtin | bool | 是否平台内置 |
| enabled | bool | 是否启用（用户扩展时可禁用） |

> MVP 内置常见 Exporter 的静态指标库；P1/P2 提供管理页面，允许用户通过配置扩展或覆盖。

### 5.4 采集任务（ScrapeJob）

> 本数据模型由 Module_01 持有并编辑；MVP 之前由 Module_07 承载，现已迁移。

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| id | string | 平台生成 | 唯一标识 |
| job_name | string | 用户输入 | Prometheus job_name |
| resource_type | enum | Module_07 | 关联 CI 类型 |
| exporter_template_id | string | CITypeExporterMapping | 关联 Exporter 模板 |
| network_domain_id | string | Module_09 | 归属网域 |
| instance_selection_mode | enum | 策略配置 | manual（MVP）/ filter（v0.3+） |
| selected_instance_ids | []string | Module_07 | 手动勾选模式下选中的 Resource ID 列表 |
| instance_filter | object | 策略配置 | filter 模式下的筛选条件（v0.3+） |
| scrape_interval | duration | 继承/覆盖 | 默认来自 CITypeExporterMapping |
| scrape_timeout | duration | 继承/覆盖 | 默认来自 CITypeExporterMapping |
| metrics_path | string | 继承/覆盖 | 默认来自 ExporterTemplate |
| scheme | string | 继承/覆盖 | 默认来自 ExporterTemplate |
| label_template_id | string | Module_07 | 生成 labels 时引用的 LabelTemplate |
| relabel_configs | []object | 策略配置 | 高级 relabel 规则（P2） |
| enabled | bool | 用户 | 是否启用 |
| created_at / updated_at | datetime | 平台 | 创建/更新时间 |

### 5.5 规则编辑模型（MonitoringRule）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 规则名 |
| rule_type | enum | alerting / recording |
| expr | string | PromQL 表达式 |
| duration | duration | `for` 字段，仅告警规则 |
| labels | map<string,string> | 规则 labels |
| annotations | map<string,string> | 规则 annotations，仅告警规则 |
| resource_type | enum | 适用 CI 类型 |
| exporter_template_id | string | 关联 Exporter 模板，用于指标提示 |
| enabled | bool | 是否启用（由 Module_08 管理生命周期时可覆盖） |
| created_at / updated_at | datetime | 创建/更新时间 |

### 5.6 Exporter 安装/注册确认（ExporterInstallationConfirmation）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| resource_id | string | 关联 Resource ID |
| exporter_template_id | string | 关联 Exporter 模板 |
| status | enum | pending / installed / not_installed / unregistered |
| confirmed_by | string | 确认人 |
| confirmed_at | datetime | 确认时间 |
| notes | string | 备注（线下安装记录、工单号等） |

> 该状态可在 Resource 上冗余展示，也可作为独立表存在。MVP 至少支持工程师手动勾选「已安装」。

### 5.7 采集目标（ScrapeTarget）【运行时数据，展示职责已移交】

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| id | string | 平台生成 | 唯一标识 |
| resource_id | string | CMDB | 关联的 CMDB 资源 ID |
| resource_type | enum | CMDB | host / middleware / application |
| network_domain_id | string | CMDB / NetworkDomain | 所属网域 ID |
| job | string | Job 配置 | Prometheus job_name |
| instance | string | CMDB / 拨测 URL | IP:Port 或健康检查 URL |
| labels | map | CMDB + 标签模板 | Prometheus labels |
| status | enum | Prometheus | up / down / unknown |
| last_scrape | datetime | Prometheus | 最近抓取时间 |
| last_error | string | Prometheus | 最近错误信息 |
| probe_success | float | Blackbox | 拨测成功标识（仅拨测目标） |
| probe_duration | float | Blackbox | 拨测耗时（仅拨测目标） |

> **说明**：`ScrapeTarget` 由 Module_01 的策略配置与 Module_09 生成的配置共同决定，但**运行时状态展示**由 [Module_02: 查询中心](Module_02_Query_Center.md) 负责。

### 5.8 采集日志（ScrapeLog）【运行时数据，展示职责已移交】

| 字段 | 类型 | 说明 |
|------|------|------|
| target_id | string | 目标 ID |
| timestamp | datetime | 抓取时间 |
| status | enum | success / error |
| duration_ms | int | 抓取耗时 |
| http_status | int | HTTP 状态码 |
| error_msg | string | 错误信息 |

> **说明**：采集日志由 Prometheus 运行时产生，展示职责由 [Module_02: 查询中心](Module_02_Query_Center.md) 承担。

---

## 6. 模块边界

| 职责 | Module_01 监控策略与指标管理 | Module_07 监控对象管理 | Module_09 网域与边缘配置中心 | Module_08 告警规则管理 |
|------|-----------------------------|----------------------|---------------------------|----------------------|
| CMDB / Resource 维护 | ❌ | ✅ | ❌ | ❌ |
| Excel 导入 Resource | ❌ | ✅ | ❌ | ❌ |
| LabelTemplate 编辑 | ❌ | ✅ | ❌ | ❌ |
| CI 类型 ↔ Exporter 模板绑定 | ✅ | ❌ | ❌ | ❌ |
| ScrapeJob 编辑 | ✅ | ❌ | ❌ | ❌ |
| 实例选择（手动/筛选） | ✅ | ❌ | ❌ | ❌ |
| Exporter 安装/注册确认 | ✅ | ❌ | ❌ | ❌ |
| 规则编辑 UI | ✅ | ❌ | ❌ | ❌ |
| 指标元数据 / Exporter 指标库 | ✅ | ❌ | ❌ | ❌ |
| Resource「已监控/未监控」badge | 提供选中状态数据 | ✅ 展示 | ❌ | ❌ |
| 生成 prometheus.yml / rules.yml | ❌ | ❌ | ✅ | ❌ |
| 配置预览 / 人工确认 / 下发 | ❌ | ❌ | ✅ | ❌ |
| 运行时目标列表 / 拨测结果 / 采集诊断 | ❌ | ❌ | ❌ | ✅（告警状态部分） / Module_02（查询展示） |
| 告警规则生命周期（分组/静默/Alertmanager） | ❌ | ❌ | ❌ | ✅ |

---

## 7. 依赖

- `platform/models`
- `upstream/prometheus/scrape/`
- `upstream/prometheus/web/api/v1/`
- `platform/gateway/proxy/`
- [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource / ResourceType / LabelTemplate API
- [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的配置下发与状态反馈 API
- [Module_02: 查询中心](Module_02_Query_Center.md) 的 PromQL 校验与指标查询 API（规则编辑时调用）

---

## 8. 验收标准

- [ ] 模块名称与文档目录已更新为「监控策略与指标管理」。
- [ ] 可以为常见 CI 类型（host / mysql / redis 等）建立/编辑 CI 类型 ↔ Exporter 模板绑定，包含默认端口、metrics_path、scheme、scrape_interval、scrape_timeout。
- [ ] 可以创建/编辑 `ScrapeJob`，指定 job_name、resource_type、exporter_template_id、网域、实例选择模式与标签模板引用。
- [ ] MVP 支持手动勾选实例；勾选结果持久化到 `ScrapeJob.selected_instance_ids`。
- [ ] 可以标记 Resource/Target 的 Exporter 安装/注册状态，未确认实例不生成 target。
- [ ] 规则编辑 UI 支持类 YAML 表单（expr / for / labels / annotations），调用查询中心进行 PromQL 校验，并提供指标实时预览。
- [ ] 指标元数据可注册/查看，包含 metric_type、help、unit。
- [ ] MVP 内置常见 Exporter 的静态指标库，规则编辑时可提示指标名与标签。
- [ ] [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表可展示「已监控 / 未监控」badge，数据来源为本模块的 `ScrapeJob` 选中状态。
- [ ] 策略配置写入 DB 后，[Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 能够轮询生成配置草稿，经人工确认后下发。
- [ ] 运行时目标状态、拨测结果、采集诊断不再由本模块负责展示，相关验收标准已迁移至 [Module_02: 查询中心](Module_02_Query_Center.md) 与 [Module_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。
- [ ] v0.4+ 支持基于外部 CMDB 自动发现实例并推荐监控策略；v1.0 支持与 ITIL 流程联动校验监控策略覆盖率。

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 状态 |
|------|------|----------|----------|----------|------|
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | ready |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | draft |
