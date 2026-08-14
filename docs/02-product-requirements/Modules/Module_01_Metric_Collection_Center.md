# Module 01: 监控策略与指标管理

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v3.6
> **产品版本覆盖**: MVP / v0.2 / v0.3 / v1.0
> **原型版本**: v2.7
> **更新日期**: 2026-08-14
> **对应原型**: `docs/prototypes/module-01/`

> **模块类型**: 核心能力模块
> **依赖文档**: [00\_Global\_Architecture.md](../00_Global_Architecture.md)、[03\_Functional\_Architecture.md](../03_Functional_Architecture.md)、[Module\_07\_Monitoring\_Object\_Management.md](Module_07_Monitoring_Object_Management.md)、[Module\_09\_Network\_Domain\_and\_Edge\_Config\_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)、[Module\_08\_Alerting\_Rule\_Management.md](Module_08_Alerting_Rule_Management.md)
> **目标用户**: 运维工程师

***

## 1. 模块目标

本模块对应 **监控策略配置层**，回答「采什么、怎么采、怎么判」的问题：

1. **监控策略配置（MVP）**：建立 CI 类型与 Exporter 模板的绑定关系，基于该绑定创建并维护 `ScrapeJob`，在隔离网域场景下手动勾选需要监控的实例，并确认 Exporter 已完成安装/注册。
2. **指标库管理（P1）**：维护平台可识别的指标名、类型、HELP/UNIT，以及常见 Exporter 的内置指标库（静态库），为规则编辑提供指标提示与校验能力；必须先有指标库才能编写 PromQL。
3. **规则编辑 UI（v0.3）**：提供告警规则与记录规则的类 YAML 表单编辑器，支持 PromQL 校验与指标实时预览；规则的生命周期管理（分组、静默、Alertmanager 配置、告警状态展示）由 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md) 负责。

> **版本调整（v2.2）**：规则编辑 UI 由 MVP 调整至 **v0.3**（与 [02_Product_Roadmap.md](../02_Product_Roadmap.md) 2.4「MVP 不做告警规则编辑 UI」及 [Module_08](Module_08_Alerting_Rule_Management.md) v0.3 落地对齐）；MVP 阶段告警/记录规则以手写 `rules.yml` + Alertmanager 方式使用。规则编辑 UI 依赖的 [Module_02](Module_02_Query_Center.md) PromQL 校验与指标实时预览接口（`validate` / `preview`）随之 v0.3 启用。

> **边界说明**：
>
> - 本模块**不负责** CMDB / Resource 的维护、标签模板（LabelTemplate）的编辑、或 `prometheus.yml` 的生成与下发。Resource 与 LabelTemplate 由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 负责；配置生成 / 预览 / 下发由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 负责。
> - 本模块**不再负责**运行时采集状态展示（目标列表、拨测结果、probe 结果、抓取诊断、Job 健康度、覆盖率），这些职责已分别移交至 [Module\_02: 查询中心](Module_02_Query_Center.md) 与 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。
> - 本模块持有 `ScrapeJob` 数据模型与编辑入口；MVP 之前该能力由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 承载，现已迁移到本模块。

***

## 2. 用户故事

> {v2.4} 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.1 节**；本模块用户故事使用模块命名空间编码（`M01-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- M01-OPS-01：为指定 CI 类型（如 host / mysql / redis）选择默认 Exporter 模板，建立 CI 类型 ↔ Exporter 模板绑定。
- M01-OPS-02：基于 CI 类型与 Exporter 模板创建一个 `ScrapeJob`，必须选择归属网域（`default` 或 edge 域），并配置 `scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme` 等参数。
- M01-OPS-03：在 MVP 阶段手动勾选需要纳入该 `ScrapeJob` 监控的具体实例；后续版本支持按网域 / 环境 / 应用 / 标签等条件筛选实例。
- M01-OPS-04：确认目标实例上 Exporter 已安装/已注册，避免生成大量 down 目标。
- M01-OPS-05：查看并维护指标库（counter/gauge/histogram/summary、HELP、UNIT）以及 Exporter 内置指标库，为规则编写提供指标提示。
- M01-OPS-06：使用类 YAML 表单编辑告警/记录规则，编辑时获得 PromQL 校验与指标实时预览（v0.3）。
- M01-OPS-07：v0.2+ 通过服务发现（K8s / Nacos 等）自动接入动态实例（微服务扩缩容），无需手动勾选（完整条目见全局库 §4.1；{v3.4}）。
- M01-BIZ-01：业务负责人在业务指标库登记业务指标（名称/语义/阈值/所属业务域/负责人），把业务监控诉求明确传递给运维（完整条目见全局库 §4.1；{v3.5}）。
- M01-BIZ-02：业务负责人 v0.2+ 按业务域查看业务指标健康度看板（完整条目见全局库 §4.1；{v3.5}）。
- M01-BIZ-03：运维接业务负责人工单后代登记业务指标（owner 必填指向业务负责人），代办后请业务负责人确认语义（完整条目见全局库 §4.1；{v3.6}）。
- M01-ARCH-01：在 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表上看到「已监控 / 未监控」badge，快速发现未被任何 `ScrapeJob` 选中的实例（v0.2+）。
- M01-ARCH-02：v0.4+ 基于外部 CMDB 自动发现实例并推荐监控策略（自动规则生成），但仍由工程师在策略模块确认后生效。
- M01-ARCH-03：v1.0 与 ITIL 流程结合，在变更/发布窗口中自动校验监控策略覆盖率。

***

## 3. 核心功能

### 3.1 监控策略配置（MVP）

| 功能                      | 说明                                                                                                                                      | 优先级        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CI 类型 ↔ Exporter 模板绑定   | 每种 `resource_type`（host / mysql / redis / kafka 等）映射到一个 ExporterTemplate，包含默认端口、metrics\_path、scheme、scrape\_interval、scrape\_timeout 等 | P0         |
| 标签模板创建引导（{v3.1}）       | 新增 CI-Exporter 映射时，系统检测该 CI 类型是否已有标签模板；无模板时弹出轻量提示引导用户创建，支持「立即创建」（预填推荐映射）或「稍后再说」（列表显示待配置 badge）                              | P0         |
| 标签模板展示列（{v3.1}）        | CI-Exporter 映射列表新增「标签模板」列，展示模板名称 + 默认/自定义标记 + 类别·模板ID；支持查看（只读预览抽屉）、更换（同资源类型其他模板）、补配（重新触发创建流程）                        | P0         |
| ScrapeJob 管理            | Job 创建/编辑、命名、启用/禁用、关联 CI 类型与 ExporterTemplate、实例选择模式、标签模板引用；Job 必须绑定且仅绑定单一网域                                                            | P0         |
| 实例选择                    | MVP 支持「按类型+网域自动收敛候选 + 手动勾选」（候选一键全选/反选、关键字筛选）；v0.3+ 支持按资源属性（网域 / 环境 / 应用 / 业务类型等）条件筛选并预览匹配结果——筛选字段为 Resource 属性字段，label 仅作 UI 别名（{v3.4}），不写标签                                                                                     | P0 / v0.3+ |
| Exporter 安装/注册确认        | 在 Resource 或 Target 上标记 exporter 是否已安装/已注册，生成配置前必须确认                                                                                    | P0         |
| ScrapeJob blackbox 类型支持 | Blackbox 拨测作为 `ScrapeJob` 的一种类型，通过 `job_type`、`blackbox_module`、`blackbox_targets` 配置；不再维护独立 `BlackboxTarget` 实体                        | P0         |
| 指标库管理                 | 指标名注册、类型标记（counter/gauge/histogram/summary）、HELP/UNIT                                                                                   | P1         |
| 业务指标库（{v3.5}/{v3.6}）        | 业务指标登记表（BusinessMetric）：业务负责人定义语义 / 阈值 / 所属业务域 / 负责人（owner 必填）；**登记不绑定角色——业务负责人自录或运维接工单代办（owner 仍指向业务负责人）**；运维消费后落地采集并标记「已上线」；MVP 最小登记表，v0.2+ 独立业务负责人角色入口 + 业务健康度看板 + 业务域聚合视图（语义层不改变采集配置逻辑） | P0 / v0.2+ |
| Exporter 指标库            | 静态内置库覆盖常见 Exporter（node-exporter、mysqld-exporter、redis-exporter 等），并提供用户扩展入口；完整管理页面放 P1/P2                                              | P1 / P2    |
| 高级 Relabel 管理           | 标签丢弃/保留/重写、正则替换、hashmod（未来）                                                                                                             | P2         |
| Exporter 市场             | Exporter 登记、版本管理、部署指南（未来）                                                                                                               | P2         |

### 3.2 规则编辑 UI（v0.3）

| 功能        | 说明                                                                      | 优先级 / 版本 |
| --------- | ----------------------------------------------------------------------- | --- |
| 类 YAML 表单 | 提供 expr / for / labels / annotations 字段，支持告警规则与记录规则编辑                   | P0 / v0.3 |
| PromQL 校验 | 调用 [Module\_02: 查询中心](Module_02_Query_Center.md) 或 Prometheus 接口校验表达式语法 | P0 / v0.3 |
| 指标实时预览    | 在编辑规则时展示指标名、标签键值提示与最近样本预览                                               | P0 / v0.3 |
| 规则模板      | 按 CI 类型 / Exporter 预置常用规则模板，支持一键填充（P1）                                  | P1 / v0.3 |
| 图形化规则构建器  | 拖拽式构建复杂规则（未来）                                                           | P2 |

> **版本调整（v2.2）**：规则编辑 UI 整体由 MVP 调整至 **v0.3**——MVP 阶段告警/记录规则手写 `rules.yml`（路线图 2.4），规则编辑 UI、PromQL 校验、指标实时预览及规则模板随 [Module_08](Module_08_Alerting_Rule_Management.md)（v0.3）一同交付；PromQL 校验与指标预览调用 [Module_02](Module_02_Query_Center.md) v0.3 提供的 `validate` / `preview` 接口。
>
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

## 4. 核心流程与数据来源

> **核心流程（{v3.4} 骨架补齐）**：本模块的核心用户流程为「**CI 类型接入 → 创建采集 Job → 配置生成下发 → 运行时采集**」——
>
> 1. **CI 类型接入**：运维工程师选择资源类别 → 细粒度 CI 类型，创建/复用 CI-Exporter 映射（含默认采集参数与标签模板；新 CI 类型无标签模板时触发创建引导，v0.4+ CMDB 新类型经 Module\_04 待分类队列进入同一流程）；
> 2. **创建采集 Job**：基于映射创建 ScrapeJob（快照继承默认参数），选择实例——MVP 手动勾选（同类型同网域候选收敛）→ v0.3+ 条件筛选（filter）→ v0.2+ 服务发现（service_discovery，微服务动态实例）；
> 3. **配置生成下发**：Module\_09 轮询策略变更，生成 `prometheus.yml`（含 `static_configs[].labels` 注入 app/biz）并下发（见 Module\_09 3.x）；
> 4. **运行时采集**：Prometheus/Edge Agent 抓取，目标状态与采集诊断由 Module\_02 展示。
>
> 数据来源（本模块的输入）：

1. [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 提供的 Resource、ResourceType、LabelTemplate 等对象数据。
2. 本模块自身维护的策略配置：CITypeExporterMapping、ScrapeJob、MonitoringRule、ExporterMetricLibrary 等。
3. Prometheus / Thanos / [Module\_02: 查询中心](Module_02_Query_Center.md) 提供的指标样本，用于 PromQL 校验与指标预览（v0.3，随规则编辑 UI 启用）。
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

| 字段                        | 类型       | 来源               | UI 展示名        | 说明                                  |
| ------------------------- | -------- | ---------------- | -------------- | ----------------------------------- |
| id                        | string   | 平台生成             | 映射 ID         | 唯一标识                                |
| resource\_type            | enum     | Module\_07       | 资源类型         | host / mysql / redis / kafka / ...  |
| exporter\_template\_id    | string   | 平台生成             | Exporter 模板   | 关联的 ExporterTemplate ID             |
| default\_port             | int      | ExporterTemplate | 默认端口         | 默认监听端口，如 9100、9104                  |
| metrics\_path             | string   | ExporterTemplate | 采集路径         | 默认 `/metrics`，可覆盖                   |
| scheme                    | string   | ExporterTemplate | 协议            | http / https，默认 http                |
| scrape\_interval          | duration | 策略配置             | 采集间隔         | 默认 15s / 30s / 60s                  |
| scrape\_timeout           | duration | 策略配置             | 采集超时         | 默认 scrape\_interval 的 80%           |
| label\_template\_id       | string   | Module\_07       | 标签模板         | 生成 target labels 时引用的 LabelTemplate |
| has\_label\_template      | bool     | 平台计算             | 仅技术信息        | {v3.1} 该 CI 类型是否已有标签模板，供前端判断是否提示创建引导 |
| is\_builtin               | bool     | 平台               | 内置映射         | 是否平台内置绑定，用户可覆盖                      |
| created\_at / updated\_at | datetime | 平台               | 仅技术信息        | 创建/更新时间                             |

> **模板层 vs 实例层**：CITypeExporterMapping 是**模板层（预设）**配置——为每种 CI 类型定义「默认用哪个 Exporter + 默认采集参数」，全局一份、由平台/管理员维护；ScrapeJob 是**实例层（运行态）**配置——基于该绑定继承默认值（`scrape_interval`、`scrape_timeout` 等）创建，再绑定具体网域与实例，允许覆盖。二者职责不同、**不重复**：映射被 Job 继承消费，Job 才是实际采集任务。
>
> **模板层定位与网域无关性（决策 13）**：
>
> - CITypeExporterMapping 为**模板层（平台级默认预设）**配置，**全局仅一份、不绑定网域**；
> - **v0.2** 新增 **`CITypeExporterMappingOverride`（网域级覆盖表）**：按 `network_domain_id` 覆盖映射默认值（`default_port` / `scheme` / `metrics_path` 等），**优先级高于映射默认值**（同网域内生效）；覆盖表跟随多网域能力（v0.2）落地，支撑不同网域差异化默认采集参数（如政务云强制 HTTPS、专网特殊端口）；
> - **MVP 仅预留上述说明、不实现覆盖表**（v0.2 落地，随网域管理/按网域配置生成一并交付）。
>
> **端口一致性说明（v2.7）**：
>
> - **问题**：映射 `default_port` 决定 `instance` 标签端口（Module\_07 组合字段，见 Module\_07 5.12 C）；当它与实例上 exporter 实际监听端口不一致时，instance 标签会错（如映射 9100、实例实际 19100）。
> - **三层解决手段**：
>   1. **映射层（MVP 已有）**：`CITypeExporterMapping.default_port` 在映射表单中可编辑（选 Exporter 后自动填充、可覆盖），解决"某 CI 类型普遍使用非标端口"；
>   2. **网域级覆盖（v0.2，已预留）**：`CITypeExporterMappingOverride` 按网域覆盖 `default_port`，解决"某网域统一非标端口"；
>   3. **实例级端口覆盖（v0.2+，建议新增）**：同一 CI 类型下个别实例端口不同（如 node\_exporter 一个 9100 一个 19100）时，支持按实例覆盖端口；MVP 不实现，v0.2+ 随多网域能力评估落地方式（Resource 增加可选 `scrape_port` 或 Job 级 target 端口映射）。
> - **Exporter 安装确认的职责边界**：安装确认（5.6）是"状态登记 + 人工背书"，**不承担端口编辑**（维度为 resource×exporter、不分 Job，塞入端口会造成多 Job 场景互相覆盖）；可增量登记**实际监听端口**（仅记录，配置生成时若与生效端口不一致则提示，不自动改配置）。
>
> **参数继承与同步策略（决策 14：创建时快照 + 显式覆盖 + 手动同步）**：
>
> - **创建时快照**：创建 ScrapeJob 时加载映射默认值（存在网域覆盖则用覆盖值）预填参数，用户可显式覆盖，保存后 Job 持有**快照值**；
> - **保护存量**：映射（含网域覆盖）后续变更**不影响已有 Job**；
> - **手动同步**：映射默认值变更时 UI 提示「映射默认值已变更」，由用户手动执行「同步映射默认值」，将 Job 参数刷新为最新默认值（**手动覆盖过的字段不刷新**，Job 需记录各字段的覆盖标记 `mapping_overrides`）；
> - **优先级（两段式，消除歧义）**：
>   - **创建预填来源优先级**：网域覆盖（v0.2）> 映射默认值 > Exporter 模板内置默认；
>   - **生效优先级**：Job 保存后其参数**快照值即为该 Job 的最终生效配置**（优先级最高），映射 / 网域覆盖后续变更**不自动覆盖**它，仅提示后由用户手动「同步映射默认值」刷新（未手动覆盖的字段）。
>
> **标签模板继承链（决策 15）**：
>
> - `CITypeExporterMapping.label_template_id` 为该 CI 类型的**默认标签模板**：创建 Job 时自动预填、**允许覆盖**；
> - LabelTemplate 由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 维护，本模块**只读引用**、不维护其内容。
>
> **标签模板关联 UX（决策 15 补充）**：
>
> - 模板 ID（`label_template_id`）为**跨模块唯一稳定 FK**（名称在同一资源类型下可重复），保证用户可肉眼对应到 Module\_07 的具体模板；
> - **列表展示（两行卡片）**：CI-Exporter 映射列表的「标签模板」列改为两行信息——第一行模板名称 + 「默认/自定义」标记，第二行「类别 · 模板ID」；不使用状态徽标（避免"健康状态"语义混淆）；
> - **预览抽屉**：点击模板名称打开**只读预览抽屉**，展示模板映射明细（来源字段 → 目标标签 → 启用），无需进入编辑表单即可核对模板内容；
> - **表单内预览（紧凑卡片）**：映射 / Job 表单选择标签模板后，以紧凑卡片展示模板头部（名称 + ID + 默认标记）与映射明细（小表格/列表），替代 Tag 堆砌；并提供「前往标签模板管理」跨模块跳转（Module\_07 为模板 CRUD 归属方，本模块不重复编辑）。
>
> **{v3.1} 标签模板创建引导**：
>
> - **触发时机**：用户新增 CI-Exporter 映射时，系统检测该 CI 类型是否已有标签模板（`has_label_template`）；
> - **已有模板**：正常完成映射，`label_template_id` 自动预填为该类型的默认模板；
> - **无模板**：弹出轻量提示（Alert/Modal）——「CI 类型 "{类型}" 尚无标签模板。标签模板定义资源字段到监控标签的映射，建议立即创建，否则监控数据将缺少归属标签。」提供两个选项：
>   - **「立即创建」**：打开创建抽屉，预填 CI 类型、资源类别、推荐默认映射（composite: instance_ip:port → instance、resource_field: app_name → app 等），用户确认/微调后保存；保存后自动关联该 CI 类型；
>   - **「稍后再说」**：关闭提示，映射列表该行「标签模板」列显示「标签模板待配置」badge，用户可后续点击「补配」重新触发创建流程；
> - **更换模板**：已配置模板的映射行，用户可点击「更换」选择同资源类型的其他模板；
> - **跨模块跳转**：列表行和预览抽屉均提供「前往标签模板管理」链接，跳转至 Module\_07 进行深度管理（编辑/克隆/删除）。
>
> **{v3.3} 标签选择两情形引导（新增 vs 已有 CI）**：
>
> - **心智分叉**：CI 类型**新增**（首次引入、无模板）时的正确动作是**创建模板**；CI 类型**已有**（有模板）时的正确动作是**直接选择模板**（常态，无需重复创建）。此分叉必须在「标签模板」选择交互上显性化：
> - **选择器按 CI 类型严格过滤**：映射 / Job 表单的「标签模板」选择器联动 `resource_type`，**仅展示同类型模板**（与「更换 = 同资源类型其他模板」约束一致）；选中 CI 类型后下拉空态（该类型无模板）时，显示「该 CI 类型尚无标签模板，请先创建」+ 内联「创建标签模板」按钮（复用 {v3.1} 创建抽屉，预填推荐映射）；
> - **两情形提示文案（表单 extra / 空态）**：
>   - 有模板：「该 CI 类型已有 N 个标签模板，直接选择即可（已自动关联默认模板，可更换）」；
>   - 无模板：「该 CI 类型为新类型，尚无标签模板；创建后采集 Job 将自动继承」；
> - **默认模板标记**：选择器选项对默认模板加「默认」Tag，用户一眼识别"已有 CI 就选这个"；
> - **创建引导文案强化「新 CI」语义**：{v3.1} 弹窗标题 / 正文明确「检测到**新增** CI 类型 "xx"，尚未创建标签模板」，弱化"已有类型重复创建"的心智。
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
> **application\_http 语义澄清（{v3.4}）**：`application_http` 对应"业务指标端点采集"（应用服务资源自带 `/metrics`，见 Module\_07 5.8 `endpoint`），其"Exporter 模板"实为**HTTP 抓取模板**——业务应用无独立 exporter 进程，由 Prometheus client / 框架埋点暴露指标：
>
> - `default_port` 语义 = 业务指标端点端口（与实例 `endpoint` 的端口对应，可留空由实例 `endpoint` 决定）；
> - 标签模板默认映射含 `app_name → app`、`business_domain → biz`（{v2.8} Module\_07 5.12 A / 5.15 业务指标标签规范：机制 A 抓取注入 `static_configs[].labels`），Job 引用含该映射的模板即可让业务指标自动带资源标签，**无需新增采集模型**；
> - 业务维度标签（`path` / `method` / `status`）由指标自带，不参与资源关联（见 Module\_07 5.15）。
>
> **v0.4+ 新 CI 类型引导闭环（{v3.4}）**：CMDB 新 CI 类型经 Module\_04「待分类队列」完成映射同步后，本模块需要形成**新类型接入引导闭环**（复用 {v3.1} 标签模板创建引导模式）：
>
> - 新类型无 CI-Exporter 映射 → 映射列表显示「待配置」badge + 引导创建（推荐默认采集参数与标签模板，同 5.1「标签模板创建引导」流程）；
> - 新类型已有映射但无标签模板 → 复用 {v3.1} 标签模板创建引导；
> - 目的：CMDB 类型膨胀（环境/厂商变体）时，保证"新类型出现 → 管理员映射 → 自动可采集"闭环，避免类型静默无监控。
>
> **CI 类型选择交互（两级级联）**：本模块所有涉及 CI 类型的选择（CI-Exporter 模板映射、采集 Job、规则编辑、指标库筛选）统一采用**「资源类别 → 细粒度 CI 类型」两级级联**：先选资源类别（主机/中间件/应用/通用目标），再选该类别下的细粒度类型（MySQL/Redis/Kafka/...），避免「MySQL（middleware）」这类把类型与大类拼接的表述；选中细粒度类型后，通过 `CITypeExporterMapping` 自动带出该类型的默认 Exporter 模板（可覆盖）。该交互与 [Module\_07](Module_07_Monitoring_Object_Management.md) 的 Resource 选择体验一致。

### 5.2 Exporter 模板（ExporterTemplate）

| 字段                         | 类型      | UI 展示名        | 说明                                   |
| -------------------------- | ------- | -------------- | ------------------------------------ |
| id                         | string  | 模板 ID         | 唯一标识                                 |
| name                       | string  | 模板名称         | 模板名称，如 node-exporter、mysqld-exporter |
| version                    | string  | 版本            | 版本，如 1.6.1                           |
| default\_port              | int     | 默认端口         | 默认端口                                 |
| metrics\_path              | string  | 采集路径         | 默认 `/metrics`                        |
| scheme                     | string  | 协议            | http / https                         |
| supported\_resource\_types | \[]enum | 支持的资源类型     | 可绑定的 resource\_type 列表               |
| install\_guide             | text    | 安装指南         | 离线/隔离网域安装说明                          |
| is\_builtin                | bool    | 内置模板         | 是否平台内置                               |

### 5.3 Exporter 指标库（ExporterMetricLibrary）

| 字段                     | 类型        | UI 展示名        | 说明                                              |
| ---------------------- | --------- | -------------- | ----------------------------------------------- |
| id                     | string    | 指标 ID         | 唯一标识                                            |
| exporter\_template\_id | string    | Exporter 模板   | 归属的 ExporterTemplate                            |
| metric\_name           | string    | 指标名           | 指标名                                             |
| metric\_type           | enum      | 指标类型         | counter / gauge / histogram / summary / unknown |
| help                   | string    | 指标说明         | 指标 HELP 文本                                      |
| unit                   | string    | 单位            | 单位，如 bytes、seconds、percent                      |
| labels                 | \[]string | 常见标签         | 常见标签键列表                                         |
| is\_builtin            | bool      | 内置指标         | 是否平台内置                                          |
| enabled                | bool      | 启用状态         | 是否启用（用户扩展时可禁用）                                  |

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

| 字段                        | 类型        | 来源                    | UI 展示名          | 说明                                                                 |
| ------------------------- | --------- | --------------------- | ---------------- | ------------------------------------------------------------------ |
| id                        | string    | 平台生成                  | Job ID           | 唯一标识                                                               |
| job\_name                 | string    | 用户输入                  | Job 名称          | Prometheus job\_name                                               |
| resource\_type            | enum      | Module\_07            | 资源类型           | 关联 CI 类型                                                           |
| exporter\_template\_id    | string    | CITypeExporterMapping | Exporter 模板     | 关联 Exporter 模板                                                     |
| network\_domain\_id       | string    | Module\_09            | 网域              | 归属网域；**必填**，所有 ScrapeJob 必须绑定且仅绑定单一网域（见下方「网域约束」）                   |
| instance\_selection\_mode | enum      | 策略配置                  | 实例选择方式        | manual（MVP）/ filter（v0.3+）                                         |
| selected\_instance\_ids   | \[]string | Module\_07            | 已选实例           | 手动勾选模式下选中的 Resource ID 列表                                          |
| instance\_filter          | object    | 策略配置                  | 实例筛选条件        | filter 模式下的筛选条件（v0.3+）                                             |
| scrape\_interval          | duration  | 继承/覆盖                 | 采集间隔          | 默认来自 CITypeExporterMapping                                         |
| scrape\_timeout           | duration  | 继承/覆盖                 | 采集超时          | 默认来自 CITypeExporterMapping                                         |
| metrics\_path             | string    | 继承/覆盖                 | 采集路径          | 默认来自 ExporterTemplate                                              |
| scheme                    | string    | 继承/覆盖                 | 协议             | 默认来自 ExporterTemplate                                              |
| label\_template\_id       | string    | Module\_07            | 标签模板          | 生成 labels 时引用的 LabelTemplate                                       |
| mapping\_overrides        | \[]string | 策略配置                  | 仅技术信息         | 手动覆盖过映射默认值的参数字段名（scrape\_interval / scrape\_timeout / metrics\_path / scheme / label\_template\_id）；「同步映射默认值」时跳过这些字段（决策 14） |
| relabel\_configs          | \[]object | 策略配置                  | 仅技术信息         | 高级 relabel 规则（P2）                                                  |
| job\_type                 | enum      | 策略配置                  | 采集 / 拨测       | `standard` / `blackbox`，默认 `standard`                              |
| blackbox\_module          | string    | 策略配置                  | 拨测模块          | `job_type=blackbox` 时必填，引用 `blackbox.yml` 模块名，如 `http_2xx`         |
| blackbox\_targets         | \[]BlackboxTarget | 策略配置                  | 拨测目标          | `job_type=blackbox` 时必填；探测目标对象列表（含目标地址、协议、完整 URL），结构见下方「BlackboxTarget 结构」 |
| enabled                   | bool      | 用户                    | 启用状态          | 是否启用                                                               |
| created\_at / updated\_at | datetime  | 平台                    | 仅技术信息         | 创建/更新时间                                                            |

> **网域约束**：
>
> - 所有 ScrapeJob（`job_type=standard` 与 `job_type=blackbox`）必须绑定且仅绑定一个 `network_domain_id`，禁止跨网域共享采集目标/拨测目标；
> - `instance_selection_mode=manual` 实例选择模式下，`selected_instance_ids` 选中的 Resource 必须与 Job 同属一个网域，保存时校验。
>
> **实例候选自动收敛（{v3.0}，MVP）**：
>
> - Job 表单选定 `resource_type` 与 `network_domain_id` 后，实例候选**自动收敛为「同资源类型 + 同网域」的资源**（与网域约束天然一致，避免选到跨网域无效项）；
> - 候选列表提供**一键全选 / 反选**与**关键字筛选**（实例名 / IP / 应用名），用户可在此基础上手动调整勾选；
> - 勾选结果仍持久化到 `selected_instance_ids`（manual 语义不变），仅候选呈现更智能——比 v0.3+ 的 `filter` 条件表达式模式更轻，不引入动态筛选规则；
> - 目的：**创建 Job 时少选实例、自动带出**，同时保证「模板 ↔ 实例」关联可见（模板按资源类型隐式关联，见 Module\_07 3.2 / 5.3）。
>
> **{v3.4} filter 模式字段语义（v0.3+）**：`instance_filter` 的筛选字段 = **Resource 属性字段**（`env` / `cluster` / `app_name` / `business_domain` / `service_name` / `middleware_type` 等，即标签模板映射的**源字段**），筛选**不写任何标签**、与标签管理正交（选择器 vs 描述器，见 Module\_07 5.3「标签配置唯一入口原则」）：
>
> - **label 仅作 UI 别名，自动派生、无需手动维护**：筛选器展示字段时，若该字段在当前 CI 类型标签模板存在映射（如 `app_name → app`、`business_domain → biz`），则别名列显示 label 名（如「应用（app）」「业务类型（biz）」），由模板 Mapping 只读派生；无映射字段直接显示字段名；
> - **筛选底层始终是字段**：**不用模板产出的 label 名做筛选键**——system 标签实时计算不落库（Module\_07 决策 3.29）+ 模板变更穿透 Job（Module\_07 决策 3.44），绑定 label 名会导致筛选语义随模板漂移；模板变更后别名自动跟随，但筛选结果不变；
> - 筛选结果预览（匹配实例清单）后写入 `instance_filter`，`instance_selection_mode=filter` 时生成配置按表达式实时求值（v0.3+）。
>
> **{v3.4} v0.2+ 服务发现模式预留（微服务动态实例）**：微服务（K8s 扩缩容、实例漂移）场景下，静态 `selected_instance_ids` 手动勾选无法覆盖动态目标。预留演进（v0.2+ 落地，与 Module\_07 5.12 B `prometheus_builtin` / Module\_04 `KubernetesProvider` 对齐）：
>
> - `instance_selection_mode` 扩展 **`service_discovery`**：Job 绑定服务发现源（K8s Service / Endpoints / Nacos 等），目标由发现结果 + `relabel_configs`（`__meta_*` → `app` / `service` 标签）动态生成，**不落 `selected_instance_ids`**；
> - CI-Exporter 映射（类型 → 抓取模板 + 标签模板）**模板层复用**——映射与"目标从哪来（静态 / 服务发现）"解耦，服务发现模式仅替换 Job 的目标选择方式；
> - 关联键沿用稳定业务标识（`app` / `biz`，不用 `instance`），与 Module\_07 5.15 业务指标标签规范一致。
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
> - `scrape_interval` / `scrape_timeout` / `metrics_path` / `scheme` 等参数在创建时**继承映射默认值（含网域覆盖）预填**，用户可覆盖，保存后 Job 持有**快照值**；映射后续变更不影响本 Job（保护存量），需用户手动「同步映射默认值」刷新（**仅刷新 `mapping_overrides` 之外的字段**，详见 5.1）；
> - `label_template_id` 创建时**自动预填**为映射的默认标签模板，**允许覆盖（换用其他模板）**；LabelTemplate 由 Module\_07 维护，本模块只读引用。Job 表单中选择标签模板后**内联只读展示映射内容**并提供「前往标签模板管理」跳转（UX 说明见 5.1「标签模板关联 UX」）。
>
> **{v3.1} 标签模板引用体验增强**：
>
> - **创建引导联动**：Job 创建时 `label_template_id` 自动预填为映射的默认标签模板；若该 CI 类型尚无标签模板（`has_label_template=false`），则 Job 表单中「标签模板」字段显示「待配置」提示，引导用户先前往 CI-Exporter 映射页完成模板创建（见 5.1「标签模板创建引导」），或直接提供「立即创建」快捷入口（复用创建抽屉）；
> - **标签模板选择器增强**：Job 表单的标签模板下拉选择器改为**卡片式选择**——每个选项展示模板名称 + 资源类别 + 映射数量概览（如「主机默认模板 · host · 5 个映射」），选中后内联展示映射明细小表格；提供「刷新模板列表」按钮（映射新增/变更后无需关闭表单即可刷新）；
> - **更换模板体验**：已保存 Job 的编辑表单中，标签模板字段支持「更换」操作——点击后弹出模板选择器，仅展示同资源类型的可用模板，选中后自动更新内联预览；更换操作不影响已选实例列表。
>
> **{v3.2} 标签配置引导落地（原型对齐）**：
>
> - **Job 表单主引导**：「标签模板」为空且对应 CI 类型映射未配置模板（`has_label_template=false`）时，显示「该 CI 类型尚未配置标签模板」提示，**主引导为「前往 CI-Exporter 映射补配（Job 将自动继承）」**（同原型内跳转），「前往标签模板管理」保留为深度管理次级入口；
> - **Job 列表与详情**：对引用无标签模板映射的 Job 显示「标签待配置」提示（列表列 / 详情视图），点击可跳转 CI-Exporter 映射页；
> - **映射页补配入口**：CI-Exporter 映射列表「待配置」Badge 可点击重新触发补配引导，操作列提供「补配标签模板」按钮（见 5.1「标签模板创建引导」）。
>
> **{v2.9} 标签模板引用语义澄清（对齐 Module\_07 v2.2 标签治理）**：
>
> - `label_template_id` 的「允许覆盖」= **允许 Job 换用其他已存在的模板（引用级）**，用于同一 CI 类型不同监控场景（如 mysql 主/从用不同标签集）；**不提供 Job 内手写标签键值**（ScrapeJob 无 labels 字段）；
> - **标签内容编辑唯一入口在 Module\_07**：类型级改标签 → 编辑/新增模板；实例级差异 → 资源详情 `user` 标签；Job 仅引用模板，不编辑标签内容；
> - **不引入实例级模板**（每实例选不同模板）：MVP 与 v0.2+ 均不引入，避免配置入口分散导致歧义与溯源困难（见 Module\_07 5.3「标签配置唯一入口原则」）。
>
> **参数继承来源视觉标记（v2.8，决策 34）**：
>
> - 编辑表单中，`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme`、`label_template_id` 五个继承字段的 label 旁增加 inline Tag，标记当前值的来源状态：
>   - **继承自映射**（灰色 Tag）：当前值来自 CI-Exporter 映射默认值，用户未手动修改；
>   - **已覆盖**（蓝色 Tag）：用户手动修改过该字段值，同步映射默认值时跳过；
>   - **待同步**（橙色 Tag）：映射默认值已变更且该字段未被用户覆盖，需手动执行同步刷新；
> - 列表页「参数同步」列增强：增加覆盖字段数量概览（如「2 个字段已自定义」）；
> - 详情视图同步：Job 详情 Descriptions 中每个参数字段同样显示对应的继承/覆盖/待同步标记。

### 5.5 规则编辑模型（MonitoringRule）

> **MVP 预留说明（v2.2）**：规则编辑 UI 于 v0.3 交付（见 3.2），`MonitoringRule` 数据模型在 MVP 阶段**预留定义**——便于 Module_09 配置生成源表与 v0.3 规则编辑 UI 无缝衔接；MVP 阶段告警/记录规则以手写 `rules.yml` + Alertmanager 方式使用，不通过 UI 写入本模型。

| 字段                        | 类型                  | UI 展示名      | 说明                            |
| ------------------------- | ------------------- | ------------ | ----------------------------- |
| id                        | string              | 规则 ID       | 唯一标识                          |
| name                      | string              | 规则名称       | 规则名                           |
| rule\_type                | enum                | 规则类型       | alerting / recording          |
| expr                      | string              | 表达式        | PromQL 表达式                    |
| duration                  | duration            | 持续时间       | `for` 字段，仅告警规则                |
| labels                    | map\<string,string> | 告警标签       | 规则 labels（v2.8 UI 展示名从「规则标签」改为「告警标签」，与标签模板的「目标标签」区分） |
| annotations               | map\<string,string> | 告警说明       | 规则 annotations，仅告警规则          |
| resource\_type            | enum                | 资源类型       | 适用 CI 类型                      |
| exporter\_template\_id    | string              | Exporter 模板 | 关联 Exporter 模板，用于指标提示         |
| scope                    | enum                | 求值范围       | `central` / `edge` / `both`；MVP~v0.3 固定 `central`（中心求值），`edge`/`both` 由 Module\_08 在 v0.4+ 支持（P2 预留） |
| enabled                   | bool                | 启用状态       | 是否启用（由 Module\_08 管理生命周期时可覆盖） |
| created\_at / updated\_at | datetime            | 仅技术信息      | 创建/更新时间                       |

> **Labels/Annotations 语义说明与必填状态（v2.8，决策 35）**：
>
> - **Labels（告警标签）**：
>   - **必填状态**：整体为**选填**（推荐填写），每个 key 和 value 均为选填。但若填写，建议遵循 Prometheus 最佳实践使用推荐 key；
>   - **语义区分**：此处的 labels 是**告警元数据**（如 `severity=critical`、`team=sre`），用于告警分级、路由与接收人匹配；**不是**标签模板中生成的 target 身份标签（如 `instance`、`app`、`env`）。标签模板生成的 labels 由 Module_07 管理，在采集 Job 中配置，无需在规则中重复设置；
>   - **推荐 key**：`severity`（严重等级：critical/warning/info）、`team`（负责团队名）。更多 labels 可按需扩展；
>   - **记录规则特殊说明**：记录规则的 labels 语义与告警规则不同——记录规则的 labels 是**新时间序列的附加标签**，用于标识计算结果的维度（如 `team`、`datacenter`），不参与告警路由。
>
> - **Annotations（告警说明）**：
>   - **必填状态**：整体为**选填**（推荐填写），每个 key 和 value 均为选填。但若填写，建议遵循 Prometheus 最佳实践使用推荐 key；
>   - **作用**：annotations 是告警触发时附带的**人类可读信息**，用于告警通知中的展示内容。**不参与告警路由判断**，仅用于通知展示；
>   - **推荐 key**：`summary`（一句话摘要）、`description`（详细描述）、`runbook_url`（故障处理手册链接）；
>   - **模板变量**：description 中可使用 `{{ $labels.instance }}` 引用标签值、`{{ $value }}` 引用当前指标值，实现动态告警描述。

> **网域无关性说明**（与 ScrapeJob「采集绑域」对照）：
>
> - 告警/记录规则由**中心侧对全网域聚合数据统一求值**，因此 `MonitoringRule` **不绑定** `network_domain_id`——采集发生在网域内（Job 绑域），求值发生在中心（规则不限域）；
> - 如需将规则限定到某个网域，在 `expr` 的 label selector 中按 `network_domain` 标签过滤（该标签由 [Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 生成 `prometheus.yml` 时作为 `external_labels` 自动注入，见 Module\_09 3.3.1）。

> **scope 业务场景说明**：
>
> - **MVP~v0.3**：`scope` 固定 `central`（中心统一求值），用户无需配置 scope；
> - **`edge` / `both`（v0.4+，P2，由 [Module\_08](Module_08_Alerting_Rule_Management.md) 支持）**：核心场景为**断网自治告警**——物理隔离网域断网时中心无法求值，规则在边缘 vmalert 本地求值并走**本地通知通道**（本地飞书/钉钉 webhook），典型规则为主机存活 / 进程崩溃 / 磁盘满 / 本地服务不可用；
> - **`both`**：用于边缘快速响应 + 中心统一聚合，需以标签区分求值域（如 `eval_domain`）防止重复告警；
> - **`central`**：用于引用跨网域数据或全局聚合的规则；
> - **不适合 `edge` 的规则**：引用跨网域数据的规则、需长历史窗口的复杂计算、全局业务 SLA。

> **CI 类型 ↔ Exporter 模板联动**：规则编辑中「资源类型」同样采用两级级联选择；选中细粒度 CI 类型后，`exporter_template_id` 自动带出该类型映射的默认 Exporter 模板（可覆盖），并据此过滤指标预览与 PromQL 校验范围。

### 5.6 Exporter 安装/注册确认（ExporterInstallationConfirmation）

| 字段                     | 类型       | UI 展示名        | 说明                                                  |
| ---------------------- | -------- | -------------- | --------------------------------------------------- |
| id                     | string   | 确认记录 ID      | 唯一标识                                                |
| resource\_id           | string   | 资源            | 关联 Resource ID                                      |
| exporter\_template\_id | string   | Exporter 模板   | 关联 Exporter 模板                                      |
| status                 | enum     | 安装状态         | pending / installed / not\_installed / unregistered |
| confirmed\_by          | string   | 确认人           | 确认人                                                 |
| confirmed\_at          | datetime | 确认时间         | 确认时间                                                |
| notes                  | string   | 备注            | 备注（线下安装记录、工单号等）                                     |
| actual\_port           | int      | 实际监听端口       | {P1} 安装确认时登记的实例上 exporter 实际监听端口；配置生成时与生效端口（映射 default\_port / 网域覆盖）不一致则提示，不自动改配置 |

> 该状态可在 Resource 上冗余展示，也可作为独立表存在。MVP 至少支持工程师手动勾选「已安装」。
>
> **职责边界（v2.7）**：安装确认是"状态登记 + 人工背书"，**不承担端口编辑**（维度为 resource×exporter、不分 Job）；实际监听端口仅作登记与一致性提示，端口不一致的解决手段见 5.1「端口一致性说明」（映射层 default\_port 可编辑 → 网域覆盖 v0.2 → 实例级端口覆盖 v0.2+）。
>
> 该确认仅针对**标准 Exporter**；`job_type=blackbox` 的拨测 Job 不涉及目标实例的安装确认。边缘 blackbox exporter 进程/容器实例的健康状态由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的 EdgeAgent 维护。

### 5.7 采集目标（ScrapeTarget）【运行时数据，展示职责已移交】

| 字段                  | 类型       | 来源                   | UI 展示名        | 说明                              |
| ------------------- | -------- | -------------------- | -------------- | ------------------------------- |
| id                  | string   | 平台生成                 | 仅技术信息        | 唯一标识                            |
| resource\_id        | string   | CMDB                 | 资源            | 关联的 CMDB 资源 ID                  |
| resource\_type      | enum     | CMDB                 | 资源类型         | host / middleware / application |
| network\_domain\_id | string   | CMDB / NetworkDomain | 网域            | 所属网域 ID                         |
| job                 | string   | Job 配置               | Job            | Prometheus job\_name            |
| instance            | string   | CMDB / 拨测 URL        | 实例            | IP:Port 或健康检查 URL               |
| labels              | map      | CMDB + 标签模板          | 标签            | Prometheus labels               |
| status              | enum     | Prometheus           | 状态            | up / down / unknown             |
| last\_scrape        | datetime | Prometheus           | 最后抓取         | 最近抓取时间                          |
| last\_error         | string   | Prometheus           | 最近错误         | 最近错误信息                          |
| probe\_success      | float    | Blackbox             | 拨测成功         | 拨测成功标识（仅拨测目标）                   |
| probe\_duration     | float    | Blackbox             | 拨测耗时         | 拨测耗时（仅拨测目标）                     |

> **说明**：`ScrapeTarget` 由 Module\_01 的策略配置与 Module\_09 生成的配置共同决定，但**运行时状态展示**由 [Module\_02: 查询中心](Module_02_Query_Center.md) 负责。

### 5.8 采集日志（ScrapeLog）【运行时数据，展示职责已移交】

| 字段           | 类型       | UI 展示名   | 说明              |
| ------------ | -------- | --------- | --------------- |
| target\_id   | string   | 仅技术信息   | 目标 ID           |
| timestamp    | datetime | 抓取时间     | 抓取时间            |
| status       | enum     | 抓取状态     | success / error |
| duration\_ms | int      | 抓取耗时     | 抓取耗时            |
| http\_status | int      | HTTP 状态码 | HTTP 状态码        |
| error\_msg   | string   | 错误信息     | 错误信息            |

> **说明**：采集日志由 Prometheus 运行时产生，展示职责由 [Module\_02: 查询中心](Module_02_Query_Center.md) 承担。

### 5.9 业务指标库（BusinessMetric）{v3.5}

> **定位**：业务指标（如支付成功率、下单量）的**业务语义契约登记处**，与 5.3 ExporterMetricLibrary（技术指标库）**并列**。解决"业务监控指标只有业务负责人知道、运维无法凭空确定"的职责断开问题——业务负责人登记语义，运维消费落地采集（职责分工见 3.1「业务指标库」功能行）。
>
> **采集方式**：业务指标不来自独立 exporter，而是业务应用埋点（Prometheus client 暴露 `/metrics`，见 5.1 application\_http 语义）；采集落地走机制 A（Job 引用含 `app`/`biz` 映射的标签模板，抓取注入，见 Module\_07 5.15）。本实体**只登记语义契约、不承载采集配置**（采集配置在 ScrapeJob）。

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| metric\_id | string | ✅ | 指标 ID | 唯一标识 |
| metric\_name | string | ✅ | 指标名 | Prometheus 指标名（业务埋点输出，如 `payment_success_rate`） |
| description | string | ✅ | 指标语义 | **业务人话**说明（如"支付成功率 = 支付成功笔数 / 支付总笔数"），由业务负责人填写 |
| metric\_type | enum | ✅ | 指标类型 | counter / gauge / histogram / summary |
| unit | string | ❌ | 单位 | 如 % / 笔 / 元 |
| business\_domain | string | ✅ | 所属业务域 | 归属业务类型（payment / data-api），与 Module\_07 `business_domain` 对齐（v0.2+ 关联独立业务目录实体） |
| app\_name | string | ❌ | 关联应用 | 产出该指标的关联应用服务（值 = 平台 `app_name`） |
| threshold\_suggestion | string | ❌ | 建议阈值 | 业务负责人建议的告警阈值（如"成功率 ≥ 99.9%"），作为 v0.3+ 规则编辑的参考输入 |
| owner | string | ✅ | 业务负责人 | 指标语义责任人（**必填**，语义所有权不随录入者转移） |
| register\_source | enum | ✅ | 登记来源 | {v3.6} `self`（业务负责人自录）/ `agent`（运维工单代办，owner 仍指向业务负责人） |
| status | enum | ✅ | 埋点状态 | `pending`（待埋点）/ `instrumented`（已埋点，业务侧代码已输出）/ `online`（已上线，运维确认采集落地） |
| created\_at / updated\_at | datetime | ✅ | 仅技术信息 | 创建 / 更新时间 |

> **状态机与推进分工（{v3.6}）**：`pending` → `instrumented` → `online`，推进者按职责分工——**语义编辑权（description / threshold / owner）仅业务负责人或其委托**；`pending`（登记，自录或代办；代办后可选「请业务负责人确认语义」环节，确认前列表标「待确认」）；`instrumented`（业务侧埋点完成，业务负责人标记）；`online`（运维确认采集落地，指标可查）。`online` 后可回退 `instrumented`（采集下线）。
>
> **登记模式（{v3.6}：登记动作 ≠ 语义所有权）**：登记不绑定角色——**业务负责人自录（`self`）或运维接工单代办（`agent`）均可**；`owner` 字段必填且指向业务负责人（语义所有权不随录入者转移）；运维代录后可选「请业务负责人确认语义」，业务人员不熟悉平台时由运维代录、语义责任不丢失。
>
> **业务域聚合视图版本归属（{v3.6}）**：MVP 仅 `business_domain` 资源字段 + `biz` 标签（不做聚合视图）；**v0.2+ 独立业务目录**（Module\_07 决策 3.46）提供业务域聚合视图——成员列表（应用服务/微服务 + 中间件 + 主机，按 business\_domain 归属自动聚合）+ 健康度看板（M01-BIZ-02）+ 采集覆盖视图；微服务是业务域的实现载体、业务域是微服务的语义聚合在该视图显性化。**业务语义层不改变采集配置逻辑**（采集仍按 CI 类型 + 实例选择），仅影响视图 / 查询聚合（`biz`）/ 告警分组（v0.3+）/ 批量操作入口。
>
> **MVP / v0.2+ 分层**：MVP = 最小登记表（自录 + 代办均可，`owner` 必填保证职责可溯）；v0.2+ = 独立业务负责人角色入口（配合 Module\_06 权限）+ 业务健康度看板 + 业务域聚合视图。

### 5.10 数据模型状态机 {v3.4}

> **说明（{v3.4} 骨架补齐）**：集中定义本模块核心对象的状态流转，供后端实现与前后端契约对齐。

**① ScrapeJob.enabled（采集任务启用状态）**

```text
            创建（继承映射默认值）
                    │
                    ▼
      enabled（启用） ◄──────────┐
          │                     │
          │ 禁用                 │ 启用
          ▼                     │
      disabled（停用） ──────────┘
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| enabled | 启用（参与配置生成） | 创建默认启用 / 手动启用 | 可切 disabled / 删除 |
| disabled | 停用（不参与配置生成） | 手动停用 | 可切 enabled / 删除 |

> 删除约束：被删除的 Job 由 Module\_09 在下一轮询周期感知 `updated_at`/删除事件并重新生成配置（pull 模式，本模块不主动通知）。

**② instance_selection_mode（实例选择方式，随版本演进）**

```text
manual（MVP：手动勾选，候选按类型+网域收敛）
   │
   ├──► filter（v0.3+：按资源属性条件筛选，label 仅 UI 别名）
   │
   └──► service_discovery（v0.2+：服务发现 + relabel 动态生成，不落 selected_instance_ids）
```

> 三种模式互斥（同一 Job 仅一种）；演进向后兼容——manual 是 MVP 基线，filter / service_discovery 是扩展模式，均不影响标签管理（筛选/发现只决定"哪些实例被采集"，不写标签）。

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

### 6.1 接口设计 {v3.4}

> **说明（{v3.4} 骨架补齐）**：本模块是策略 Owner，主要接口为**写策略 + 被轮询消费 + 只读消费外部对象**。MVP 最小契约（统一 `/api/v1` 前缀，鉴权/错误码规范见 [00\_Global\_Architecture.md](../00_Global_Architecture.md)）：

| 方向 | 接口 | 说明 |
|------|------|------|
| 写（本模块） | `POST/PUT/DELETE /api/v1/ci-exporter-mappings` | CI-Exporter 映射 CRUD（模板层，全局一份） |
| 写（本模块） | `POST/PUT/DELETE /api/v1/scrape-jobs` | ScrapeJob CRUD（含 instance_selection_mode / filter 表达式 / service_discovery 配置，v0.3+/v0.2+ 扩展字段） |
| 读（本模块） | `GET /api/v1/exporter-templates`、`GET /api/v1/metric-library` | Exporter 模板与指标库查询 |
| 消费（Module\_09 轮询） | 策略读取接口（ScrapeJob / CITypeExporterMapping / LabelTemplate 引用） | Module\_09 生成 `prometheus.yml` 的输入；本模块不主动通知（pull 模式） |
| 只读消费（本模块 ← Module\_07） | Resource / LabelTemplate GET 接口 | 实例候选、标签模板引用（Module\_07 6.1 / 6.3） |
| 调用（v0.3+） | Module\_02 `validate` / `preview` | 规则编辑时 PromQL 校验与指标预览 |

> **跨模块契约要点**：①`label_template_id` 为跨模块唯一 FK（Module\_07 维护）；②`instance_filter` 筛选字段仅限 Resource 属性字段（label 名仅 UI 别名，不落表达式，见 5.4）；③v0.2+ `service_discovery` 目标由发现结果 + relabel 动态生成（不落 `selected_instance_ids`）。

***

## 7. 依赖

- `platform/models`
- `upstream/prometheus/scrape/`
- `upstream/prometheus/web/api/v1/`
- `platform/gateway/proxy/`
- [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource / ResourceType / LabelTemplate API
- [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的配置下发与状态反馈 API
- [Module\_02: 查询中心](Module_02_Query_Center.md) 的 PromQL 校验与指标查询 API（v0.3 起，规则编辑时调用）

***

## 8. 验收标准

### 8.1 用户验收（用户可在 UI 感知/操作）

- [ ] {P0} 模块名称与文档目录已更新为「监控策略与指标管理」。
- [ ] {P0} 可以为常见 CI 类型（host / mysql / redis 等）建立/编辑 CI 类型 ↔ Exporter 模板绑定，包含默认端口、metrics\_path、scheme、scrape\_interval、scrape\_timeout。
- [ ] {P0} 可以创建/编辑 `ScrapeJob`，指定 job\_name、resource\_type、exporter\_template\_id、网域、实例选择模式与标签模板引用。
- [ ] {P0} CI-Exporter 映射与 Job 表单中，标签模板以「名称（类别 / 模板ID）」展示；选择模板后内联只读展示其映射内容，并提供「前往标签模板管理」跨模块跳转（模板 CRUD 归属 Module\_07）。
- [ ] {P0} CI-Exporter 映射列表的「标签模板」列采用两行卡片展示（名称 + 默认/自定义标记 / 类别·模板ID），点击模板名称打开只读预览抽屉展示映射明细。
- [ ] {P0} MVP 支持手动勾选实例；勾选结果持久化到 `ScrapeJob.selected_instance_ids`。
- [ ] {P0} {v3.0} 选定 `resource_type` 与 `network_domain_id` 后，实例候选自动收敛为「同类型 + 同网域」资源，支持一键全选/反选与关键字筛选（减少手动逐个勾选）
- [ ] {P0} 可以标记 Resource/Target 的 Exporter 安装/注册状态，未确认实例不生成 target。
- [ ] {P1} 安装确认时可登记实例上 exporter 实际监听端口（actual\_port）；配置生成时与生效端口不一致时提示，不自动改配置。
- [ ] {P0} {v0.3} 规则编辑 UI 支持类 YAML 表单（expr / for / labels / annotations），调用查询中心进行 PromQL 校验，并提供指标实时预览。
- [ ] {P0} 指标库可注册/查看，包含 metric\_type、help、unit。
- [ ] {P0} MVP 指标库最小集跟随当前 CMDB CI 类型（host / middleware / application / generic\_target）预置：node-exporter、mysqld-exporter、redis-exporter、kafka-exporter、blackbox-exporter 的内置指标，规则编辑时可提示指标名与标签。
- [ ] {P0} MVP 内置 blackbox exporter 指标库，至少包含 `probe_success`、`probe_duration_seconds`、`probe_http_status_code`，规则编辑时可提示与校验。
- [ ] {P1} 支持用户手动导入（JSON/CSV 或抓取 metrics 元数据）与更新/覆盖/禁用指标库条目，MVP 阶段内置库为只读静态数据。
- [ ] {P0} [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表可展示「已监控 / 未监控」badge，数据来源为本模块的 `ScrapeJob` 选中状态。
- [ ] {P0} 支持创建 `job_type=blackbox` 的 `ScrapeJob`，可配置 `blackbox_module` 与 `blackbox_targets`，并绑定单一 `network_domain_id`。
- [ ] {P0} {v2.4} 采集 Job 编辑表单中，`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme`、`label_template_id` 五个继承字段的 label 旁显示来源状态 Tag（继承自映射/已覆盖/待同步），用户可直观感知哪些参数已自定义、哪些来自映射默认值。
- [ ] {P0} {v2.4} 采集 Job 列表页「参数同步」列增强，显示覆盖字段数量概览（如「2 个字段已自定义」）。
- [ ] {P0} {v2.4} 采集 Job 详情视图同步显示每个参数字段的继承/覆盖/待同步标记。
- [ ] {P0} {v3.1} 新增 CI-Exporter 映射时，若该 CI 类型尚无标签模板，系统弹出轻量提示引导用户创建，支持「立即创建」（预填推荐映射）或「稍后再说」（列表显示待配置 badge）
- [ ] {P0} {v3.1} CI-Exporter 映射列表新增「标签模板」列，展示模板名称 + 默认/自定义标记 + 类别·模板ID；支持查看（只读预览抽屉）、更换（同资源类型其他模板）、补配（重新触发创建流程）
- [ ] {P0} {v3.1} 标签模板创建抽屉预填 CI 类型、资源类别、推荐默认映射（composite: instance_ip:port → instance 等），用户可微调后保存
- [ ] {P0} {v3.1} ScrapeJob 表单中标签模板选择器改为卡片式选择（展示模板名称 + 资源类别 + 映射数量概览），选中后内联展示映射明细小表格
- [ ] {P0} {v3.1} ScrapeJob 编辑表单中标签模板支持「更换」操作，仅展示同资源类型的可用模板
- [ ] {P0} {v3.2} 引用无标签模板映射的 Job 在列表 / 详情中显示「标签待配置」提示；编辑表单提供「前往 CI-Exporter 映射补配（Job 将自动继承）」主引导（同原型内跳转）与「前往标签模板管理」次级入口
- [ ] {P0} {v3.3} 映射 / Job 表单的「标签模板」选择器按 CI 类型严格过滤（仅同类型模板）；选中类型无模板时下拉空态显示「该 CI 类型尚无标签模板，请先创建」并提供内联「创建标签模板」按钮
- [ ] {P0} {v3.3} 「标签模板」字段提示区分两情形：有模板显示「该 CI 类型已有 N 个标签模板，直接选择即可（已自动关联默认模板，可更换）」；无模板显示「该 CI 类型为新类型，尚无标签模板；创建后采集 Job 将自动继承」
- [ ] {P0} {v3.3} 选择器选项对默认模板加「默认」标记；创建引导弹窗文案明确「检测到新增 CI 类型，尚未创建标签模板」
- [ ] {P0} {v3.2} CI-Exporter 映射列表「待配置」Badge 可点击重新触发补配引导，操作列提供「补配标签模板」按钮
- [ ] {P0} {v2.4} 规则编辑 UI 中，labels 区域上方显示语义说明卡片，明确区分「告警标签」与「目标标签」的差异，并标注必填状态（选填，推荐填写）与推荐 key。
- [ ] {P0} {v2.4} 规则编辑 UI 中，annotations 区域上方显示必要性说明卡片，说明其作用（人类可读信息，不参与路由判断），并标注必填状态（选填，推荐填写）与推荐 key。
- [ ] {P0} {v2.4} 规则编辑 UI 中，记录规则的 labels 区域显示特殊提示，说明记录规则 labels 的语义（附加到新时间序列的维度标签）。
- [ ] {P0} {v2.4} CI-Exporter 映射页的新增/编辑表单使用 Drawer 抽屉承载，底部操作栏始终可见，关闭前有未保存提示。
- [ ] {P0} {v2.4} 规则编辑页的新增/编辑表单使用 Drawer 抽屉承载，底部操作栏始终可见，关闭前有未保存提示。
- [ ] {P0} {v3.5} 业务指标库可登记业务指标（指标名 / 语义 / 阈值 / 所属业务域 / 负责人必填），列表展示埋点状态（待埋点 / 已埋点 / 已上线）；运维可将业务指标标记「已上线」（确认采集落地）

### 8.2 技术验收（后端/契约可验证）

- [ ] {P0} 策略配置写入 DB 后，[Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 能够轮询生成配置草稿，经人工确认后下发。
- [ ] {P0} 标准 ScrapeJob 与 blackbox ScrapeJob 均必须绑定单一 `network_domain_id`；`instance_selection_mode=manual` 保存时校验 `selected_instance_ids` 选中的 Resource 与 Job 同属一个网域。
- [ ] {P0} blackbox ScrapeJob 的创建/编辑/启停、模块或目标变更后，[Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 在下一轮询周期内检测到 `updated_at` 变化并重新生成对应网域配置（pull 模式，Module\_01 不主动通知）。
- [ ] {P0} 运行时目标状态、拨测结果、采集诊断不再由本模块负责展示，相关验收标准已迁移至 [Module\_02: 查询中心](Module_02_Query_Center.md) 与 [Module\_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。
- [ ] {P1} v0.4+ 支持基于外部 CMDB 自动发现实例并推荐监控策略；v1.0 支持与 ITIL 流程联动校验监控策略覆盖率。
- [ ] {P1} {v3.4} `instance_filter`（v0.3+）筛选字段仅允许 Resource 属性字段（label 名仅作 UI 别名、由模板 Mapping 只读派生，不落筛选表达式）；筛选不写标签，与 Module\_07「标签配置唯一入口原则」一致。
- [ ] {P1} {v3.4} v0.2+ `service_discovery` 模式：目标由服务发现结果 + `relabel_configs` 动态生成（不落 `selected_instance_ids`），关联键沿用 `app` / `biz`（不用 `instance`），CI-Exporter 映射模板层复用。
- [ ] {P1} {v3.5} `BusinessMetric.owner` 必填校验；`business_domain` 与 Module\_07 资源 `business_domain` 对齐（同名同值）；状态机 `pending → instrumented → online` 流转可验证

## 术语映射（用户词汇表）

> {v2.4} 后端术语 ↔ 用户语言的权威对照（与 5.x 数据模型「UI 展示名」列一致）。用户可见文案、前端页面、接口文档均以本表对齐；「仅技术信息」术语只出现在技术层（折叠区 / 代码注释 / 接口契约），不作为用户界面文案。

| 后端术语                                  | 用户语言             | 说明                                                           |
| ------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `CITypeExporterMapping`               | CI-Exporter 模板映射 | 资源类型 ↔ Exporter 模板的绑定（模板层预设，全局一份、不绑网域）                    |
| `CITypeExporterMappingOverride`       | 网域级覆盖           | {v0.2} 按网域覆盖映射默认值（端口 / 协议 / 采集路径等），优先级高于映射默认值                |
| `resource_type`（细粒度）                | 资源类型 / CI 类型     | host / mysql / redis / kafka / nginx / application\_http / snmp |
| `resource_type`（粗粒度）                | 资源类别             | host / middleware / application / generic\_target（Module\_07 四大类） |
| `middleware_type`                     | 中间件类型            | mysql / redis / kafka / elasticsearch 等（细粒度子类型）              |
| `ExporterTemplate`                    | Exporter 模板       | Exporter 的默认参数与安装指南模板                                      |
| `ScrapeJob`                           | 采集 Job           | 实际采集任务（实例层），绑定单一网域                                        |
| `job_type`                            | 采集 / 拨测           | `standard`=标准采集；`blackbox`=拨测                                |
| `blackbox_module`                     | 拨测模块             | 引用 `blackbox.yml` 模块名，如 `http_2xx` / `icmp_ping`             |
| `blackbox_targets`                    | 拨测目标             | 探测目标列表（地址 / 协议 / 完整 URL）                                  |
| `instance_selection_mode`             | 实例选择方式           | manual（手动勾选）/ filter（条件筛选，v0.3+）                            |
| `selected_instance_ids`               | 已选实例             | 手动勾选的 Resource ID 列表                                         |
| `mapping_overrides`                   | 仅技术信息            | 手动覆盖过映射默认值的字段名列表（「同步映射默认值」时跳过）                          |
| `ExporterMetricLibrary`               | 指标库 / 指标元数据      | 平台可识别的指标名、类型、HELP、UNIT 集合                                |
| `BusinessMetric`                      | 业务指标库            | {v3.5} 业务指标语义契约登记处（语义/阈值/所属业务域/负责人必填/埋点状态）；与 Exporter 技术指标库并列，业务负责人定义、运维落地采集 |
| `register_source`                     | 登记来源             | {v3.6} 业务指标登记来源：`self`（业务负责人自录）/ `agent`（运维工单代办，owner 仍指向业务负责人） |
| 业务负责人（Business Owner）             | 业务负责人            | {v3.6} 业务指标语义所有权角色：定义语义 / 阈值 / 看板；语义编辑权不随录入者转移 |
| 业务域聚合视图                            | 仅技术信息            | {v3.6} v0.2+ 独立业务目录视图：成员列表（应用/微服务+中间件+主机）+ 健康度看板 + 采集覆盖；语义层不改变采集配置逻辑 |
| `metric_type`                         | 指标类型             | counter / gauge / histogram / summary / unknown               |
| `MonitoringRule`                      | 告警 / 记录规则        | 规则编辑模型（v0.3 起 UI 写入，MVP 手写 `rules.yml`）                    |
| `MonitoringRule.labels`               | 告警标签（Alert Labels） | 告警规则的元数据标签，用于分级/路由，**非** target 身份标签（v2.8 新增）              |
| `MonitoringRule.annotations`          | 告警说明（Annotations） | 告警触发时附带的人类可读信息，用于通知展示，不参与路由判断（v2.8 新增）                    |
| `LabelTemplate` 生成的 labels          | 目标标签（Target Labels） | 标识被监控资源身份的标签（instance/app/env），由采集 Job 的标签模板生成（v2.8 新增）      |
| `rule_type`                           | 规则类型             | alerting（告警规则）/ recording（记录规则）                            |
| `scope`                               | 求值范围             | central（中心求值）/ edge / both（v0.4+，断网自治）                      |
| `ExporterInstallationConfirmation`    | Exporter 安装确认    | 目标实例 Exporter 已安装/已注册的确认记录（仅标准 Exporter）                 |
| `ScrapeTarget` / `ScrapeLog`          | 仅技术信息            | 运行时采集数据，展示职责由 Module\_02 承担                               |
| `CI_TYPE_CATEGORY_MAP`                | 仅技术信息            | 粗粒度类别 → 细粒度 CI 类型映射表                                       |
| `instance_filter`                     | 实例筛选条件           | {v3.4} v0.3+ 条件筛选表达式：筛选字段 = Resource 属性字段（label 仅作 UI 别名，由模板映射只读派生），筛选不写标签 |
| `service_discovery`                   | 服务发现             | {v3.4} v0.2+ 实例选择模式：目标由服务发现结果 + relabel 动态生成（微服务动态实例），不落手动勾选 |
| `application_http`                    | HTTP 应用 / 业务指标采集 | {v3.4} application 细粒度 CI 类型：业务指标端点 HTTP 抓取模板（无独立 exporter，应用自带 /metrics，默认模板映射 app/biz） |

## 提示分区规范

原型 / 产品页面中的提示按受众分三类，避免相互干扰——

1. **用户 UI 文案**：面向运维工程师，**不含「决策 X」「PRD X.X」等实现层引用**，讲人话；
2. **产品 / 技术评审说明**：设计决策依据与 PRD 引用**集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区**，默认折叠，用户无感知，产品评审与开发可展开；
3. **开发 / AI 注释**：代码注释与 PRD 数据模型 / 技术字段承载实现细节与决策引用，供后续代码开发（含 AI）理解。

此规范使**用户看到干净的"未来原型雏形"**，同时**开发侧（含 AI）可从代码注释与 PRD 获取完整设计依据**。本规范由 `.kimi/agents/prototype-designer.md`「提示分区规范」强制执行，原型 MainLayout 提供全局折叠区承载本模块决策清单。

## Change Log

> **Change Log 定位（v2.4 / 精简执行）**：本表为业务沟通决策的精简记录（**保留最近 3 版**一句话摘要）；**完整历史（v3.3 及以前的逐版变更详情）已迁移至 `docs/05-execution-records/module-01/design-decisions.md`「Change Log（完整历史）」小节**。Change Log 主要记录业务侧沟通决策与文档变更，**不承载开发契约**（开发契约见 5.x 数据模型 / 8 验收标准 / 术语映射）。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
| v3.6 | 2026-08-14 | 修改   | 业务指标动线分离（第十五轮需求讨论）：5.9 补「登记模式」——登记动作 ≠ 语义所有权（业务负责人自录 `self` / 运维工单代办 `agent`，owner 必填指向业务负责人、代办后可选确认环节）；状态机补推进分工（语义编辑权仅业务负责人或其委托，pending/instrumented 业务侧、online 运维）；补业务域聚合视图版本归属（v0.2+ 独立业务目录，语义层不改变采集配置逻辑）；3.1 功能行同步；全局故事库补 M01-BIZ-03 + 第 2 章引用；术语映射补 register_source/业务负责人/聚合视图 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.5 | 2026-08-14 | 新增   | 业务指标库（第十四轮需求讨论，解决职责断开）：新增 5.9 业务指标库（BusinessMetric）实体——业务负责人定义指标语义/阈值/所属业务域/负责人（owner 必填）、运维消费落地采集并标记「已上线」；与 ExporterMetricLibrary（技术指标库）并列；状态机 pending→instrumented→online；3.1 功能表新增业务指标库行（MVP 最小登记表 / v0.2+ 独立业务负责人入口 + 看板）；全局故事库回写 M01-BIZ-01/02 + 第 2 章引用；8 验收 2 条；术语映射补 BusinessMetric | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.4 | 2026-08-14 | 修改   | 跨模块对齐（第十三轮需求讨论，与 Module_07 v2.8 / Module_04 对齐）：5.1 新增 application_http 语义澄清（业务指标端点 HTTP 抓取模板、非独立 exporter、默认模板含 app/biz 映射即机制 A 落地）+ v0.4 新 CI 类型引导闭环（CMDB 待分类队列 → 映射创建引导）；5.4 新增 filter 模式字段语义（v0.3+ 筛选字段 = Resource 属性字段、label 仅 UI 别名自动派生、不用 label 名做筛选键防模板漂移）+ v0.2+ service_discovery 模式预留（微服务动态实例，prometheus_builtin + relabel，映射模板复用）；3.1 实例选择行补充；8.2 新增 2 条技术验收。评审前完善：Roadmap §1.5 登记 filter/service_discovery + application_http；术语映射补 instance_filter/service_discovery/application_http；骨架补齐（4 核心流程、5.9 状态机、6.1 接口设计）；全局故事库注册 M01-OPS-07 + 第 2 章引用 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |

