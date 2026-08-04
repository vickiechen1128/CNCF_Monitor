# Module 01: 监控策略与指标管理

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.9
> **产品版本覆盖**: MVP / v0.2 / v0.3 / v1.0
> **原型版本**: v1.9
> **更新日期**: 2026-08-04
> **对应原型**: `docs/prototypes/module-01/`

> **模块类型**: 核心能力模块
> **依赖文档**: [00\_Global\_Architecture.md](../00_Global_Architecture.md)、[03\_Functional\_Architecture.md](../03_Functional_Architecture.md)、[Module\_07\_Monitoring\_Object\_Management.md](Module_07_Monitoring_Object_Management.md)、[Module\_09\_Network\_Domain\_and\_Edge\_Config\_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)、[Module\_08\_Alerting\_Rule\_Management.md](Module_08_Alerting_Rule_Management.md)
> **目标用户**: 运维工程师

***

## 1. 模块目标

本模块对应 **监控策略配置层**，回答「采什么、怎么采、怎么判」的问题：

1. **监控策略配置（MVP）**：建立 CI 类型与 Exporter 模板的绑定关系，基于该绑定创建并维护 `ScrapeJob`，在隔离网域场景下手动勾选需要监控的实例，并确认 Exporter 已完成安装/注册。
2. **指标库管理（P1）**：维护平台可识别的指标名、类型、HELP/UNIT，以及常见 Exporter 的内置指标库（静态库），为规则编辑提供指标提示与校验能力；必须先有指标库才能编写 PromQL。
3. **规则编辑 UI（MVP）**：提供告警规则与记录规则的类 YAML 表单编辑器，支持 PromQL 校验与指标实时预览；规则的生命周期管理（分组、静默、Alertmanager 配置、告警状态展示）由 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) 负责。

> **边界说明**：
>
> - 本模块**不负责** CMDB / Resource 的维护、标签模板（LabelTemplate）的编辑、或 `prometheus.yml` 的生成与下发。Resource 与 LabelTemplate 由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 负责；配置生成 / 预览 / 下发由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 负责。
> - 本模块**不再负责**运行时采集状态展示（目标列表、拨测结果、probe 结果、抓取诊断、Job 健康度、覆盖率），这些职责已分别移交至 [Module\_02: 查询中心](Module_02_Query_Center.md) 与 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。
> - 本模块持有 `ScrapeJob` 数据模型与编辑入口；MVP 之前该能力由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 承载，现已迁移到本模块。

***

## 2. 用户故事

- OPS-01：为指定 CI 类型（如 host / mysql / redis）选择默认 Exporter 模板，建立 CI 类型 ↔ Exporter 模板绑定。
- OPS-02：基于 CI 类型与 Exporter 模板创建一个 `ScrapeJob`，必须选择归属网域（`default` 或 edge 域），并配置 `scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme` 等参数。
- OPS-03：在 MVP 阶段手动勾选需要纳入该 `ScrapeJob` 监控的具体实例；后续版本支持按网域 / 环境 / 应用 / 标签等条件筛选实例。
- OPS-04：确认目标实例上 Exporter 已安装/已注册，避免生成大量 down 目标。
- OPS-05：查看并维护指标库（counter/gauge/histogram/summary、HELP、UNIT）以及 Exporter 内置指标库，为规则编写提供指标提示。
- OPS-06：使用类 YAML 表单编辑告警/记录规则，编辑时获得 PromQL 校验与指标实时预览。
- ARCH-01：在 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表上看到「已监控 / 未监控」badge，快速发现未被任何 `ScrapeJob` 选中的实例（v0.2+）。
- ARCH-02：v0.4+ 基于外部 CMDB 自动发现实例并推荐监控策略（自动规则生成），但仍由工程师在策略模块确认后生效。
- ARCH-03：v1.0 与 ITIL 流程结合，在变更/发布窗口中自动校验监控策略覆盖率。

***

## 3. 核心功能

### 3.1 监控策略配置（MVP）

| 功能                      | 说明                                                                                                                                      | 优先级        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CI 类型 ↔ Exporter 模板绑定   | 每种 `resource_type`（host / mysql / redis / kafka 等）映射到一个 ExporterTemplate，包含默认端口、metrics\_path、scheme、scrape\_interval、scrape\_timeout 等 | P0         |
| ScrapeJob 管理            | Job 创建/编辑、命名、启用/禁用、关联 CI 类型与 ExporterTemplate、实例选择模式、标签模板引用；Job 必须绑定且仅绑定单一网域                                                            | P0         |
| 实例选择                    | MVP 支持「手动勾选」；v0.3+ 支持按网域 / 环境 / 应用 / 标签等条件筛选并预览匹配结果                                                                                     | P0 / v0.3+ |
| Exporter 安装/注册确认        | 在 Resource 或 Target 上标记 exporter 是否已安装/已注册，生成配置前必须确认                                                                                    | P0         |
| ScrapeJob blackbox 类型支持 | Blackbox 拨测作为 `ScrapeJob` 的一种类型，通过 `job_type`、`blackbox_module`、`blackbox_targets` 配置；不再维护独立 `BlackboxTarget` 实体                        | P0         |
| 指标库管理                 | 指标名注册、类型标记（counter/gauge/histogram/summary）、HELP/UNIT                                                                                   | P1         |
| Exporter 指标库            | 静态内置库覆盖常见 Exporter（node-exporter、mysqld-exporter、redis-exporter 等），并提供用户扩展入口；完整管理页面放 P1/P2                                              | P1 / P2    |
| 高级 Relabel 管理           | 标签丢弃/保留/重写、正则替换、hashmod（未来）                                                                                                             | P2         |
| Exporter 市场             | Exporter 登记、版本管理、部署指南（未来）                                                                                                               | P2         |

### 3.2 规则编辑 UI（MVP）

| 功能        | 说明                                                                      | 优先级 |
| --------- | ----------------------------------------------------------------------- | --- |
| 类 YAML 表单 | 提供 expr / for / labels / annotations 字段，支持告警规则与记录规则编辑                   | P0  |
| PromQL 校验 | 调用 [Module\_02: 查询中心](Module_02_Query_Center.md) 或 Prometheus 接口校验表达式语法 | P0  |
| 指标实时预览    | 在编辑规则时展示指标名、标签键值提示与最近样本预览                                               | P0  |
| 规则模板      | 按 CI 类型 / Exporter 预置常用规则模板，支持一键填充（P1）                                  | P1  |
| 图形化规则构建器  | 拖拽式构建复杂规则（未来）                                                           | P2  |

> 规则编辑 UI 由本模块提供；规则保存后进入 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) 进行生命周期管理（启用/禁用、分组、静默、Alertmanager 路由、告警状态展示）。

### 3.3 运行时采集状态展示（已移出）

以下功能原属 Module\_01，现已移出：

| 功能                                     | 移交模块                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 目标列表、目标详情、状态筛选                         | [Module\_02: 查询中心](Module_02_Query_Center.md)                                                               |
| 拨测结果展示（probe\_success、probe\_duration） | [Module\_02: 查询中心](Module_02_Query_Center.md)                                                               |
| 采集诊断、抓取失败原因、HTTP 状态码                   | [Module\_02: 查询中心](Module_02_Query_Center.md)                                                               |
| Job 健康度、采集覆盖率                          | [Module\_02: 查询中心](Module_02_Query_Center.md) / [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) |
| 临时目标验证                                 | [Module\_02: 查询中心](Module_02_Query_Center.md)（P2）                                                           |
| 边缘 Agent 状态展示                          | [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)                                 |

***

## 4. 数据来源

1. [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 提供的 Resource、ResourceType、LabelTemplate 等对象数据。
2. 本模块自身维护的策略配置：CITypeExporterMapping、ScrapeJob、MonitoringRule、ExporterMetricLibrary 等。
3. Prometheus / Thanos / [Module\_02: 查询中心](Module_02_Query_Center.md) 提供的指标样本，用于 PromQL 校验与指标预览。
4. [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 返回的配置下发状态与版本信息。

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

***

## 5. 数据模型

### 5.1 CI 类型 ↔ Exporter 模板绑定（CITypeExporterMapping）

| 字段                        | 类型       | 来源               | 说明                                  |
| ------------------------- | -------- | ---------------- | ----------------------------------- |
| id                        | string   | 平台生成             | 唯一标识                                |
| resource\_type            | enum     | Module\_07       | host / mysql / redis / kafka / ...  |
| exporter\_template\_id    | string   | 平台生成             | 关联的 ExporterTemplate ID             |
| default\_port             | int      | ExporterTemplate | 默认监听端口，如 9100、9104                  |
| metrics\_path             | string   | ExporterTemplate | 默认 `/metrics`，可覆盖                   |
| scheme                    | string   | ExporterTemplate | http / https，默认 http                |
| scrape\_interval          | duration | 策略配置             | 默认 15s / 30s / 60s                  |
| scrape\_timeout           | duration | 策略配置             | 默认 scrape\_interval 的 80%           |
| label\_template\_id       | string   | Module\_07       | 生成 target labels 时引用的 LabelTemplate |
| is\_builtin               | bool     | 平台               | 是否平台内置绑定，用户可覆盖                      |
| created\_at / updated\_at | datetime | 平台               | 创建/更新时间                             |

> **模板层 vs 实例层**：CITypeExporterMapping 是**模板层（预设）**配置——为每种 CI 类型定义「默认用哪个 Exporter + 默认采集参数」，全局一份、由平台/管理员维护；ScrapeJob 是**实例层（运行态）**配置——基于该绑定继承默认值（`scrape_interval`、`scrape_timeout` 等）创建，再绑定具体网域与实例，允许覆盖。二者职责不同、**不重复**：映射被 Job 继承消费，Job 才是实际采集任务。
>
> **模板层定位与网域无关性（决策 13）**：
>
> - CITypeExporterMapping 为**模板层（平台级默认预设）**配置，**全局仅一份、不绑定网域**；
> - **v0.2** 新增 **`CITypeExporterMappingOverride`（网域级覆盖表）**：按 `network_domain_id` 覆盖映射默认值（`default_port` / `scheme` / `metrics_path` 等），**优先级高于映射默认值**（同网域内生效）；覆盖表跟随多网域能力（v0.2）落地，支撑不同网域差异化默认采集参数（如政务云强制 HTTPS、专网特殊端口）；
> - **MVP 仅预留上述说明、不实现覆盖表**（v0.2 落地，随网域管理/按网域配置生成一并交付）。
>
> **参数继承与同步策略（决策 14：创建时快照 + 显式覆盖 + 手动同步）**：
>
> - **创建时快照**：创建 ScrapeJob 时加载映射默认值（存在网域覆盖则用覆盖值）预填参数，用户可显式覆盖，保存后 Job 持有**快照值**；
> - **保护存量**：映射（含网域覆盖）后续变更**不影响已有 Job**；
> - **手动同步**：映射默认值变更时 UI 提示「映射默认值已变更」，由用户手动执行「同步映射默认值」，将 Job 参数刷新为最新默认值（手动覆盖过的字段不刷新）；
> - **优先级链**：网域覆盖 > 映射默认值 > Job 手动值。
>
> **标签模板继承链（决策 15）**：
>
> - `CITypeExporterMapping.label_template_id` 为该 CI 类型的**默认标签模板**：创建 Job 时自动预填、**允许覆盖**；
> - LabelTemplate 由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 维护，本模块**只读引用**、不维护其内容。
>
> **CI 类型来源与映射（决策 16：两套 CI 类型粒度体系 + CMDB 权威来源）**：
>
> - [Module\_07](Module_07_Monitoring_Object_Management.md) 的 Resource 采用**粗粒度四大类**（host / middleware / application / generic\_target）+ **细粒度** `middleware_type`（mysql / redis / kafka / ...）；
> - 本模块 `resource_type` 使用**细粒度 CI 类型**（host / mysql / redis / kafka / nginx / application\_http / snmp），直接映射 Exporter 绑定与指标库；
> - 映射表（`CI_TYPE_CATEGORY_MAP`）：
>
> | Module\_07 粗粒度（resource\_type + middleware\_type） | Module\_01 细粒度 resource\_type |
> | --- | --- |
> | host | host |
> | middleware + mysql | mysql |
> | middleware + redis | redis |
> | middleware + kafka | kafka |
> | middleware + elasticsearch | elasticsearch |
> | middleware + nginx | nginx |
> | application | application\_http |
> | generic\_target | snmp |
>
> - **v0.4+ CMDB 接入**：CMDB CI 类型为**唯一权威来源**；Module\_04 同步后向 Module\_07 写入四大类 + middleware\_type，并向本模块**刷新 resource\_type 映射**；MetricCenter **只维护映射、不增删类型**。
>
> **CI 类型选择交互（两级级联）**：本模块所有涉及 CI 类型的选择（CI-Exporter 模板映射、采集 Job、规则编辑、指标库筛选）统一采用**「资源类别 → 细粒度 CI 类型」两级级联**：先选资源类别（主机/中间件/应用/通用目标），再选该类别下的细粒度类型（MySQL/Redis/Kafka/...），避免「MySQL（middleware）」这类把类型与大类拼接的表述；选中细粒度类型后，通过 `CITypeExporterMapping` 自动带出该类型的默认 Exporter 模板（可覆盖）。该交互与 [Module\_07](Module_07_Monitoring_Object_Management.md) 的 Resource 选择体验一致。

### 5.2 Exporter 模板（ExporterTemplate）

| 字段                         | 类型      | 说明                                   |
| -------------------------- | ------- | ------------------------------------ |
| id                         | string  | 唯一标识                                 |
| name                       | string  | 模板名称，如 node-exporter、mysqld-exporter |
| version                    | string  | 版本，如 1.6.1                           |
| default\_port              | int     | 默认端口                                 |
| metrics\_path              | string  | 默认 `/metrics`                        |
| scheme                     | string  | http / https                         |
| supported\_resource\_types | \[]enum | 可绑定的 resource\_type 列表               |
| install\_guide             | text    | 离线/隔离网域安装说明                          |
| is\_builtin                | bool    | 是否平台内置                               |

### 5.3 Exporter 指标库（ExporterMetricLibrary）

| 字段                     | 类型        | 说明                                              |
| ---------------------- | --------- | ----------------------------------------------- |
| id                     | string    | 唯一标识                                            |
| exporter\_template\_id | string    | 归属的 ExporterTemplate                            |
| metric\_name           | string    | 指标名                                             |
| metric\_type           | enum      | counter / gauge / histogram / summary / unknown |
| help                   | string    | 指标 HELP 文本                                      |
| unit                   | string    | 单位，如 bytes、seconds、percent                      |
| labels                 | \[]string | 常见标签键列表                                         |
| is\_builtin            | bool      | 是否平台内置                                          |
| enabled                | bool      | 是否启用（用户扩展时可禁用）                                  |

> **MVP 指标库最小集**：内置范围**跟随当前 CMDB 的 CI 类型**（`host` / `middleware` / `application` / `generic_target`），为各 CI 类型可绑定的常见 Exporter 预置静态指标库，最小集如下：
>
> | CI 类型 | 内置 Exporter | 预置指标数量（约） | 备注 |
> |---------|---------------|--------------------|------|
> | host | node-exporter | 30~60 | 含 CPU / 内存 / 磁盘 / 网络 / 文件系统等核心指标 |
> | middleware（mysql） | mysqld-exporter | 30~50 | 含连接数 / 慢查询 / 缓冲池 / 复制状态等 |
> | middleware（redis） | redis-exporter | 20~40 | 含内存 / 命中率 / 连接数 / 键数量等 |
> | middleware（kafka） | kafka-exporter | 20~40 | 含分区 / 消费组 / 延迟等 |
> | application / generic_target | blackbox-exporter | 10~20 | 至少含 `probe_success`、`probe_duration_seconds`、`probe_http_status_code`、`probe_tcp_connection_established_seconds` 等，支撑拨测 Job 规则编辑与告警 |
>
> - 预置指标的具体条目以「CI 类型 ↔ Exporter 模板绑定」实际启用的模板为准，可在规则编辑时提示指标名与标签；
> - **筛选**：指标库支持按「资源类别 → CI 类型」两级筛选（经 `CITypeExporterMapping` 定位该类型可用 Exporter 的指标）与 `metric_type` 筛选，便于快速定位某类资源可用的监控指标；
> - **用户扩展保持现有能力**：P1/P2 提供指标库管理页面，支持用户**手动导入**（JSON/CSV 或从已部署 Exporter 抓取的 metrics 元数据）与**更新/覆盖/禁用**内置指标；MVP 阶段内置库为只读静态数据。

### 5.4 采集任务（ScrapeJob）

> 本数据模型由 Module\_01 持有并编辑；MVP 之前由 Module\_07 承载，现已迁移。

| 字段                        | 类型        | 来源                    | 说明                                                                 |
| ------------------------- | --------- | --------------------- | ------------------------------------------------------------------ |
| id                        | string    | 平台生成                  | 唯一标识                                                               |
| job\_name                 | string    | 用户输入                  | Prometheus job\_name                                               |
| resource\_type            | enum      | Module\_07            | 关联 CI 类型                                                           |
| exporter\_template\_id    | string    | CITypeExporterMapping | 关联 Exporter 模板                                                     |
| network\_domain\_id       | string    | Module\_09            | 归属网域；**必填**，所有 ScrapeJob 必须绑定且仅绑定单一网域（见下方「网域约束」）                   |
| instance\_selection\_mode | enum      | 策略配置                  | manual（MVP）/ filter（v0.3+）                                         |
| selected\_instance\_ids   | \[]string | Module\_07            | 手动勾选模式下选中的 Resource ID 列表                                          |
| instance\_filter          | object    | 策略配置                  | filter 模式下的筛选条件（v0.3+）                                             |
| scrape\_interval          | duration  | 继承/覆盖                 | 默认来自 CITypeExporterMapping                                         |
| scrape\_timeout           | duration  | 继承/覆盖                 | 默认来自 CITypeExporterMapping                                         |
| metrics\_path             | string    | 继承/覆盖                 | 默认来自 ExporterTemplate                                              |
| scheme                    | string    | 继承/覆盖                 | 默认来自 ExporterTemplate                                              |
| label\_template\_id       | string    | Module\_07            | 生成 labels 时引用的 LabelTemplate                                       |
| relabel\_configs          | \[]object | 策略配置                  | 高级 relabel 规则（P2）                                                  |
| job\_type                 | enum      | 策略配置                  | `standard` / `blackbox`，默认 `standard`                              |
| blackbox\_module          | string    | 策略配置                  | `job_type=blackbox` 时必填，引用 `blackbox.yml` 模块名，如 `http_2xx`         |
| blackbox\_targets         | \[]BlackboxTarget | 策略配置                  | `job_type=blackbox` 时必填；探测目标对象列表（含目标地址、协议、完整 URL），结构见下方「BlackboxTarget 结构」 |
| enabled                   | bool      | 用户                    | 是否启用                                                               |
| created\_at / updated\_at | datetime  | 平台                    | 创建/更新时间                                                            |

> **网域约束**：
>
> - 所有 ScrapeJob（`job_type=standard` 与 `job_type=blackbox`）必须绑定且仅绑定一个 `network_domain_id`，禁止跨网域共享采集目标/拨测目标；
> - `instance_selection_mode=manual` 实例选择模式下，`selected_instance_ids` 选中的 Resource 必须与 Job 同属一个网域，保存时校验。
>
> **blackbox Job 说明**：
>
> - `selected_instance_ids` 在 `job_type=blackbox` 时可置空，或复用为 `blackbox_targets` 的扁平存储（其拨测目标同样受上文「网域约束」，须归属本网域）。
>
> **BlackboxTarget 结构**：
>
> | 字段 | 类型 | 说明 |
> |------|------|------|
> | target | string | 探测目标地址 / IP / host:port，如 `10.0.1.11`、`redis-cache-01.mw:6379` |
> | protocol | enum | 探测协议：http / https / tcp / icmp / dns；须与 `blackbox_module` 的适用协议一致（如 `http_2xx` → http/https，`icmp_ping` → icmp，`tcp_connect` → tcp，`dns_query` → dns） |
> | url | string | 完整 URL（HTTP/HTTPS 模块时可选补充，如 `https://api.example.com/health`；`target` 已含完整地址时可为空） |
>
> 同一 blackbox Job 内可包含不同 `protocol` 的 target（均归属本 Job 网域）；[Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 生成 `blackbox.yml` 时按 `blackbox_module` 生成对应探测 module，并将对应 `static_configs.targets` 填充为 `blackbox_targets[].target`（HTTP/HTTPS 时优先使用 `url`）。

> **参数快照与标签模板继承（决策 14 / 15）**：
>
> - `scrape_interval` / `scrape_timeout` / `metrics_path` / `scheme` 等参数在创建时**继承映射默认值（含网域覆盖）预填**，用户可覆盖，保存后 Job 持有**快照值**；映射后续变更不影响本 Job（保护存量），需用户手动「同步映射默认值」刷新（详见 5.1）；
> - `label_template_id` 创建时**自动预填**为映射的默认标签模板，**允许覆盖**；LabelTemplate 由 Module\_07 维护，本模块只读引用。

### 5.5 规则编辑模型（MonitoringRule）

| 字段                        | 类型                  | 说明                            |
| ------------------------- | ------------------- | ----------------------------- |
| id                        | string              | 唯一标识                          |
| name                      | string              | 规则名                           |
| rule\_type                | enum                | alerting / recording          |
| expr                      | string              | PromQL 表达式                    |
| duration                  | duration            | `for` 字段，仅告警规则                |
| labels                    | map\<string,string> | 规则 labels                     |
| annotations               | map\<string,string> | 规则 annotations，仅告警规则          |
| resource\_type            | enum                | 适用 CI 类型                      |
| exporter\_template\_id    | string              | 关联 Exporter 模板，用于指标提示         |
| scope                    | enum                | `central` / `edge` / `both`；MVP~v0.3 固定 `central`（中心求值），`edge`/`both` 由 Module\_08 在 v0.4+ 支持（P2 预留） |
| enabled                   | bool                | 是否启用（由 Module\_08 管理生命周期时可覆盖） |
| created\_at / updated\_at | datetime            | 创建/更新时间                       |

> **网域无关性说明**（与 ScrapeJob「采集绑域」对照）：
>
> - 告警/记录规则由**中心侧对全网域聚合数据统一求值**，因此 `MonitoringRule` **不绑定** `network_domain_id`——采集发生在网域内（Job 绑域），求值发生在中心（规则不限域）；
> - 如需将规则限定到某个网域，在 `expr` 的 label selector 中按 `network_domain` 标签过滤（该标签由 [Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 生成 `prometheus.yml` 时作为 `external_labels` 自动注入，见 Module\_09 3.3.1）。
>
> **CI 类型 ↔ Exporter 模板联动**：规则编辑中「资源类型」同样采用两级级联选择；选中细粒度 CI 类型后，`exporter_template_id` 自动带出该类型映射的默认 Exporter 模板（可覆盖），并据此过滤指标预览与 PromQL 校验范围。

### 5.6 Exporter 安装/注册确认（ExporterInstallationConfirmation）

| 字段                     | 类型       | 说明                                                  |
| ---------------------- | -------- | --------------------------------------------------- |
| id                     | string   | 唯一标识                                                |
| resource\_id           | string   | 关联 Resource ID                                      |
| exporter\_template\_id | string   | 关联 Exporter 模板                                      |
| status                 | enum     | pending / installed / not\_installed / unregistered |
| confirmed\_by          | string   | 确认人                                                 |
| confirmed\_at          | datetime | 确认时间                                                |
| notes                  | string   | 备注（线下安装记录、工单号等）                                     |

> 该状态可在 Resource 上冗余展示，也可作为独立表存在。MVP 至少支持工程师手动勾选「已安装」。
>
> 该确认仅针对**标准 Exporter**；`job_type=blackbox` 的拨测 Job 不涉及目标实例的安装确认。边缘 blackbox exporter 进程/容器实例的健康状态由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的 EdgeAgent 维护。

### 5.7 采集目标（ScrapeTarget）【运行时数据，展示职责已移交】

| 字段                  | 类型       | 来源                   | 说明                              |
| ------------------- | -------- | -------------------- | ------------------------------- |
| id                  | string   | 平台生成                 | 唯一标识                            |
| resource\_id        | string   | CMDB                 | 关联的 CMDB 资源 ID                  |
| resource\_type      | enum     | CMDB                 | host / middleware / application |
| network\_domain\_id | string   | CMDB / NetworkDomain | 所属网域 ID                         |
| job                 | string   | Job 配置               | Prometheus job\_name            |
| instance            | string   | CMDB / 拨测 URL        | IP:Port 或健康检查 URL               |
| labels              | map      | CMDB + 标签模板          | Prometheus labels               |
| status              | enum     | Prometheus           | up / down / unknown             |
| last\_scrape        | datetime | Prometheus           | 最近抓取时间                          |
| last\_error         | string   | Prometheus           | 最近错误信息                          |
| probe\_success      | float    | Blackbox             | 拨测成功标识（仅拨测目标）                   |
| probe\_duration     | float    | Blackbox             | 拨测耗时（仅拨测目标）                     |

> **说明**：`ScrapeTarget` 由 Module\_01 的策略配置与 Module\_09 生成的配置共同决定，但**运行时状态展示**由 [Module\_02: 查询中心](Module_02_Query_Center.md) 负责。

### 5.8 采集日志（ScrapeLog）【运行时数据，展示职责已移交】

| 字段           | 类型       | 说明              |
| ------------ | -------- | --------------- |
| target\_id   | string   | 目标 ID           |
| timestamp    | datetime | 抓取时间            |
| status       | enum     | success / error |
| duration\_ms | int      | 抓取耗时            |
| http\_status | int      | HTTP 状态码        |
| error\_msg   | string   | 错误信息            |

> **说明**：采集日志由 Prometheus 运行时产生，展示职责由 [Module\_02: 查询中心](Module_02_Query_Center.md) 承担。

***

## 6. 模块边界

| 职责                            | Module\_01 监控策略与指标管理 | Module\_07 监控对象管理 | Module\_09 网域与边缘配置中心 | Module\_08 告警规则管理            |
| ----------------------------- | -------------------- | ----------------- | -------------------- | ---------------------------- |
| CMDB / Resource 维护            | ❌                    | ✅                 | ❌                    | ❌                            |
| Excel 导入 Resource             | ❌                    | ✅                 | ❌                    | ❌                            |
| LabelTemplate 编辑              | ❌                    | ✅                 | ❌                    | ❌                            |
| CI 类型 ↔ Exporter 模板绑定         | ✅                    | ❌                 | ❌                    | ❌                            |
| ScrapeJob 编辑                  | ✅                    | ❌                 | ❌                    | ❌                            |
| ScrapeJob blackbox 类型编辑       | ✅                    | ❌                 | ❌                    | ❌                            |
| 实例选择（手动/筛选）                   | ✅                    | ❌                 | ❌                    | ❌                            |
| Exporter 安装/注册确认              | ✅                    | ❌                 | ❌                    | ❌                            |
| 规则编辑 UI                       | ✅                    | ❌                 | ❌                    | ❌                            |
| 指标库（Exporter 指标库）          | ✅                    | ❌                 | ❌                    | ❌                            |
| Resource「已监控/未监控」badge        | 提供选中状态数据             | ✅ 展示              | ❌                    | ❌                            |
| 生成 prometheus.yml / rules.yml | ❌                    | ❌                 | ✅                    | ❌                            |
| 配置预览 / 人工确认 / 下发              | ❌                    | ❌                 | ✅                    | ❌                            |
| 运行时目标列表 / 拨测结果 / 采集诊断         | ❌                    | ❌                 | ❌                    | ✅（告警状态部分） / Module\_02（查询展示） |
| 告警规则生命周期（分组/静默/Alertmanager）  | ❌                    | ❌                 | ❌                    | ✅                            |

***

## 7. 依赖

- `platform/models`
- `upstream/prometheus/scrape/`
- `upstream/prometheus/web/api/v1/`
- `platform/gateway/proxy/`
- [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource / ResourceType / LabelTemplate API
- [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的配置下发与状态反馈 API
- [Module\_02: 查询中心](Module_02_Query_Center.md) 的 PromQL 校验与指标查询 API（规则编辑时调用）

***

## 8. 验收标准

- [ ] 模块名称与文档目录已更新为「监控策略与指标管理」。
- [ ] 可以为常见 CI 类型（host / mysql / redis 等）建立/编辑 CI 类型 ↔ Exporter 模板绑定，包含默认端口、metrics\_path、scheme、scrape\_interval、scrape\_timeout。
- [ ] 可以创建/编辑 `ScrapeJob`，指定 job\_name、resource\_type、exporter\_template\_id、网域、实例选择模式与标签模板引用。
- [ ] MVP 支持手动勾选实例；勾选结果持久化到 `ScrapeJob.selected_instance_ids`。
- [ ] 可以标记 Resource/Target 的 Exporter 安装/注册状态，未确认实例不生成 target。
- [ ] 规则编辑 UI 支持类 YAML 表单（expr / for / labels / annotations），调用查询中心进行 PromQL 校验，并提供指标实时预览。
- [ ] 指标库可注册/查看，包含 metric\_type、help、unit。
- [ ] MVP 指标库最小集跟随当前 CMDB CI 类型（host / middleware / application / generic\_target）预置：node-exporter、mysqld-exporter、redis-exporter、kafka-exporter、blackbox-exporter 的内置指标，规则编辑时可提示指标名与标签。
- [ ] MVP 内置 blackbox exporter 指标库，至少包含 `probe_success`、`probe_duration_seconds`、`probe_http_status_code`，规则编辑时可提示与校验。
- [ ] P1 支持用户手动导入（JSON/CSV 或抓取 metrics 元数据）与更新/覆盖/禁用指标库条目，MVP 阶段内置库为只读静态数据。
- [ ] [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表可展示「已监控 / 未监控」badge，数据来源为本模块的 `ScrapeJob` 选中状态。
- [ ] 策略配置写入 DB 后，[Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 能够轮询生成配置草稿，经人工确认后下发。
- [ ] 标准 ScrapeJob 与 blackbox ScrapeJob 均必须绑定单一 `network_domain_id`；`instance_selection_mode=manual` 保存时校验 `selected_instance_ids` 选中的 Resource 与 Job 同属一个网域。
- [ ] 支持创建 `job_type=blackbox` 的 `ScrapeJob`，可配置 `blackbox_module` 与 `blackbox_targets`，并绑定单一 `network_domain_id`。
- [ ] blackbox ScrapeJob 的创建/编辑/启停、模块或目标变更后，[Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 在下一轮询周期内检测到 `updated_at` 变化并重新生成对应网域配置（pull 模式，Module\_01 不主动通知）。
- [ ] 运行时目标状态、拨测结果、采集诊断不再由本模块负责展示，相关验收标准已迁移至 [Module\_02: 查询中心](Module_02_Query_Center.md) 与 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。
- [ ] v0.4+ 支持基于外部 CMDB 自动发现实例并推荐监控策略；v1.0 支持与 ITIL 流程联动校验监控策略覆盖率。

## Change Log

| 版本   | 日期         | 变更类型 | 变更内容                                                                                                                                                                   | 影响范围                | 产品版本影响            | 状态    |
| ---- | ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------- | ----- |
| v1.9 | 2026-08-04 | 修改   | 数据模型对齐：5.4 `blackbox_targets` 类型由 `[]string`（探测目标字符串）调整为 `[]BlackboxTarget` 对象数组（含 `target` / `protocol` / `url` 字段），新增「BlackboxTarget 结构」说明，支持同一 blackbox Job 内不同协议探测目标；Module_09 生成 `blackbox.yml` 时按 `blackbox_module` 生成对应 module、targets 填充为 `blackbox_targets[].target`（HTTP/HTTPS 优先 `url`）；原型版本同步 v1.9（含多网域模式开关、规则校验/预览动态化、详情只读视图） | 数据模型、验收标准、原型交互 | MVP | 设计中 |
| v1.8 | 2026-08-04 | 修改   | 统一 CI 类型选择交互为「资源类别 → 细粒度 CI 类型」两级级联（5.1 新增说明，覆盖 CI-Exporter 模板映射/采集 Job/规则编辑/指标库筛选四处，避免「MySQL（middleware）」拼接表述）；选中细粒度类型后自动带出映射默认 Exporter 模板（5.5 新增「CI 类型 ↔ Exporter 模板联动」）；指标库 5.3 新增按 CI 类型与 metric_type 筛选说明；UI 展示文案产品化（移除内部「决策 14」代号，功能名统一为「CI-Exporter 模板映射」） | 数据模型、功能范围、UI/UX | MVP / v0.2 / v0.3 / v1.0 | 设计中   |
| v1.7 | 2026-08-04 | 修改   | 决策 13 确认：`CITypeExporterMappingOverride`（网域级覆盖表）落地版本由 v0.3+ 调整为 **v0.2**（跟随多网域能力与按网域配置生成一并交付）；决策 14 确认：原型需完整演示「同步映射默认值」交互（创建时继承标记 + 映射变更提示 + 手动同步刷新） | 数据模型、功能范围、原型交互 | MVP / v0.2 / v0.3 / v1.0 | 设计中   |
| v1.6 | 2026-08-04 | 修改   | 落盘设计决策 13-16：5.1 明确模板层定位（全局一份、不绑定网域）并预留 v0.3+ 网域级覆盖表 `CITypeExporterMappingOverride`（按 `network_domain_id` 覆盖 `default_port`/scheme 等，优先级高于映射默认值，MVP 仅预留不实现）；补充参数继承与同步策略（创建时快照 + 显式覆盖 + 手动「同步映射默认值」，优先级链：网域覆盖 > 映射默认值 > Job 手动值，映射变更不影响存量 Job）；补充标签模板继承链（映射 `label_template_id` 为默认标签模板，创建 Job 自动预填、允许覆盖，LabelTemplate 由 Module_07 维护、本模块只读引用）；新增「CI 类型来源与映射」说明（两套粒度体系：Module_07 粗粒度四大类 + middleware_type，本模块细粒度 CI 类型 host/mysql/redis/kafka/nginx/application_http/snmp，映射表 CI_TYPE_CATEGORY_MAP；v0.4+ CMDB 为唯一权威来源，Module_04 同步后刷新映射，MetricCenter 只维护映射不增删类型）；5.4 补充参数快照与标签模板预填说明；确认决策 12 scope 规则作用域已完备（5.5 含 scope 字段与网域无关性说明，与 Module_09 v1.6 一致） | 数据模型、功能范围 | MVP / v0.3 / v1.0 | 设计中 |
| v1.5 | 2026-08-04 | 修改   | 统一「指标元数据」为「指标库」命名；补充 5.1「模板层 vs 实例层」说明（映射为预设绑定、Job 为实例任务，不重复）；5.5 补充「网域无关性说明」（规则由中心对全网域统一求值、不绑网域，限域通过 `network_domain` 标签过滤）并新增 `scope` 字段（MVP 固定 central，v0.4+ 支持 edge/both）；用户故事调整为「先指标库后规则编辑」；去重 blackbox 指标库验收标准；原型版本升级至 v1.2 | 数据模型、用户故事、功能范围、验收标准 | MVP / v0.3 / v1.0 | 设计中   |
| v1.4 | 2026-08-04 | 修改   | 明确 MVP 指标库最小集：内置范围跟随当前 CMDB CI 类型（host / middleware / application / generic\_target）预置 node-exporter / mysqld-exporter / redis-exporter / kafka-exporter / blackbox-exporter 指标（含数量范围）；P1 保留用户手动导入与更新/覆盖/禁用能力，MVP 阶段内置库只读 | 数据模型、验收标准 | MVP / P1 | 设计中   |
| v1.3 | 2026-08-04 | 修改   | 明确所有 ScrapeJob（standard + blackbox）必须绑定且仅绑定单一 `network_domain_id`，禁止跨网域共享采集/拨测目标；实例选择模式下 `selected_instance_ids` 选中的 Resource 须与 Job 同域并保存时校验；OPS-02 补充创建 Job 必须选择归属网域 | 数据模型、用户故事、功能范围、验收标准 | MVP               | 设计中   |
| v1.2 | 2026-08-04 | 修改   | 将 blackbox 拨测合并为 `ScrapeJob` 的 `job_type=blackbox` 类型，新增 `job_type`、`blackbox_module`、`blackbox_targets` 字段；明确 MVP 内置 blackbox exporter 指标库与 Module\_09 配置触发关系         | 数据模型、功能边界、验收标准      | MVP               | 设计中   |
| v1.1 | 2026-08-03 | 修改   | PRD 状态从 ready 修正为 设计中：尚未完成原型验证                                                                                                                                         | PRD 状态              | 文档自身              | 设计中   |
| v1.1 | 2026-08-02 | 新增   | 完成 Volcengine 风格原型验证，输出独立可点击原型                                                                                                                                         | PRD 状态、UI/UX、原型目录   | 文档自身              | 设计中   |
| v1.0 | 2026-07-31 | 初始   | 模块 PRD 初始版本                                                                                                                                                            | 全部                  | MVP / v0.3 / v1.0 | draft |

