# Module 01: 监控策略与指标管理

> **PRD 状态**: `ready`（可开发版本）
> **PRD 版本**: v3.30
> **产品版本覆盖**: MVP / v0.2 / v0.3 / v1.0
> **原型版本**: v3.28（已对齐；v3.29 / v3.30 为契约收紧与 v0.2 范围收敛，原型行为不变）
> **更新日期**: 2026-09-02
> **对应原型**: `docs/prototypes/module-01/`

> **模块类型**: 核心能力模块
> **依赖文档**: [00\_Global\_Architecture.md](../00_Global_Architecture.md)、[03\_Functional\_Architecture.md](../03_Functional_Architecture.md)、[Module\_07\_Monitoring\_Object\_Management.md](Module_07_Monitoring_Object_Management.md)、[Module\_09\_Network\_Domain\_and\_Edge\_Config\_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)、[Module\_08\_Alertmanager\_Notification\_Management.md](Module_08_Alertmanager_Notification_Management.md)
> **目标用户**: 运维工程师

***

## 1. 模块目标

> 决策依据：design-decisions.md 决策 3

本模块对应 **监控策略配置层**，回答「采什么、怎么采、怎么判」的问题：

1. **监控策略配置（MVP）**：建立监控对象类型与默认采集器（采集实现）的绑定关系，基于该绑定创建并维护 `ScrapeJob`，在隔离网域场景下手动勾选需要监控的实例；**选中即生成 target**，实例采集状态（在线数 / 待采集 / up / down）在 Job 详情与编辑抽屉实时回显（决策 47-2），Exporter 安装确认降级为**可选登记**、不再作为生成 target 的前置（决策 47-1）。
2. **指标库管理（P1）**：维护平台可识别的指标名、类型、HELP/UNIT，以及常见采集实现的指标集（静态库），为规则编辑提供指标提示与校验能力；必须先有指标库才能编写 PromQL；指标锚点为监控对象类型（多对多带来源标注）。
3. **规则管理（MVP 文件挂载 / v0.3 字段化编辑）**：MVP 提供**规则文件挂载**——上传 / 粘贴完整 `rules.yml` 整文件透传落库 `MonitoringRule`，规则变更经 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 生成 / 确认 / 下发（**不绕过 M09**，保证 M09 完成所有配置文件更新与下发）；v0.3 升级为类 YAML 表单编辑器（expr / for / labels / annotations）+ PromQL 校验 + 指标实时预览。规则内容创作由本模块负责，静默、Alertmanager 配置、告警状态展示由 [Module\_08: 告警收敛与通知管理](Module_08_Alertmanager_Notification_Management.md) 负责。

> 规则编辑 UI 的**字段级形态**由 MVP 调整至 **v0.3**（与 [02_Product_Roadmap.md](../02_Product_Roadmap.md) 2.4「MVP 不做告警规则编辑 UI」及 [Module_08](Module_08_Alertmanager_Notification_Management.md) v0.3 落地对齐）；**MVP 已交付规则文件挂载（见 3.1）**——规则内容以整文件透传（`content_mode=yaml_passthrough`）经「规则编辑」页落库 `MonitoringRule`，保存 / 启停 / 删除即触发 Module\_09 生成 `rules.yml` 草稿、变更单人工确认与下发，不再手写绕过 M09。字段级规则编辑 UI 依赖的 [Module_02](Module_02_Query_Center.md) PromQL 校验与指标实时预览接口（`validate` / `preview`）随之 v0.3 启用。

> **边界说明**：
>
> - 本模块**不负责** CMDB / Resource 的维护、标签模板（LabelTemplate）的编辑、或 `prometheus.yml` 的生成与下发。Resource 与 LabelTemplate 由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 负责；配置生成 / 预览 / 下发由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 负责。
> - 本模块**不建设独立的**运行时采集状态页面（全局目标列表、拨测结果、probe 结果、抓取诊断、Job 健康度、覆盖率视图），这些职责已分别移交至 [Module\_02: 查询中心](Module_02_Query_Center.md) 与 [Module\_08: 告警收敛与通知管理](Module_08_Alertmanager_Notification_Management.md)；但 **Job 配置上下文内的只读采集状态回显**（实例状态列 + 在线数汇总，数据消费 Module_02 `/api/v1/targets` 代理）回流本模块（决策 47-2，见 5.10）。
> - 本模块持有 `ScrapeJob` 数据模型与编辑入口；MVP 之前该能力由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 承载，现已迁移到本模块。

***

## 2. 用户故事

> 决策依据：design-decisions.md 决策 29

> 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.1 节**；本模块用户故事使用模块命名空间编码（`M01-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- M01-OPS-01：为指定监控对象类型（如 `host_linux` / `host_windows` / mysql / redis）选择默认采集器（采集实现），维护默认采集配置（监控对象类型 ↔ 采集器 + 参数预设）。
- M01-OPS-02：基于监控对象类型与默认采集器创建一个 `ScrapeJob`，必须选择归属网域（`default` 或 edge 域），并配置 `scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme` 等参数（采集参数可手填覆盖）。
- M01-OPS-03：在 MVP 阶段手动勾选需要纳入该 `ScrapeJob` 监控的具体实例；后续版本支持按网域 / 环境 / 应用 / 标签等条件筛选实例。
- M01-OPS-04：可选登记目标实例的 Exporter 安装/注册情况（不再作为生成 target 的前置闸门，决策 47-1）。
- M01-OPS-08：在采集 Job 详情/编辑抽屉直接看到已选实例的采集状态（在线数 / 待采集 / up / down）与「已下发未采到」提醒（决策 47-2）。
- M01-OPS-05：查看并维护指标库（counter/gauge/histogram/summary、HELP、UNIT）以及 Exporter 内置指标库，为规则编写提供指标提示。
- M01-OPS-06：MVP 通过「规则编辑」页上传 / 粘贴完整 `rules.yml`（**整文件透传**）挂载告警/记录规则，保存 / 启停 / 删除后进入 Module\_09 生成与交付流程（变更单**人工确认**后下发，不绕过 M09）；v0.3 升级为类 YAML 表单编辑（expr / for / labels / annotations），编辑时获得 PromQL 校验与指标实时预览，同样进入 Module\_09 规则生成与交付流程。
- M01-OPS-07：v0.3+ 通过服务发现（K8s / Nacos 等）自动接入动态实例（微服务扩缩容），无需手动勾选（完整条目见全局库 §4.1）。
- M01-BIZ-01：业务负责人在业务指标库登记业务指标（名称/语义/阈值/所属业务域/负责人），把业务监控诉求明确传递给运维（完整条目见全局库 §4.1）。
- M01-BIZ-02：业务负责人 v0.3+ 按业务域查看业务指标健康度看板（完整条目见全局库 §4.1）。
- M01-BIZ-03：运维接业务负责人工单后代登记业务指标（owner 必填指向业务负责人），代办后请业务负责人确认语义（完整条目见全局库 §4.1）。
- M01-ARCH-01：快速发现未被任何 `ScrapeJob` 选中的实例——主落点为 [Module_07](Module_07_Monitoring_Object_Management.md) 资源列表三态「采集状态」badge 与筛选（决策 47-3）；本模块实例选择器「未纳入任何 Job」筛选为辅助落点（**目标语义，MVP 不保证，随本模块开发节奏落地**）。
- M01-ARCH-02：v0.4+ 基于外部 CMDB 自动发现实例并推荐监控策略（自动规则生成），但仍由工程师在策略模块确认后生效。
- M01-ARCH-03：v1.0 与 ITIL 流程结合，在变更/发布窗口中自动校验监控策略覆盖率。

***

## 3. 核心功能

> 决策依据：design-decisions.md D1/D11/D12/D13/D21/D22/D25/D26/D27-2/D28

### 3.1 监控策略配置（MVP）

| 功能                      | 说明                                                                                                                                      | 优先级        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 默认采集配置（入口并入采集 Job「采集器管理」Tab） | 每种 `monitor_type`（`host_linux` / `host_windows` / mysql / redis / kafka 等）的**默认采集器 + 采集参数 + 安装指南 / 下载地址**预设（按 OS 平台区分；一个监控对象类型可多个可选采集实现、`is_default` 标记默认）；**入口承载于「采集 Job」页「采集器管理」Tab**（不独立导航），承担**类型级采集器指引**（该装什么、怎么装、去哪下载）+ 预设维护；创建 Job 时自动套用默认值、可覆盖；**实例级安装登记在「采集 Job」选实例时进行（5.6，可选），本 Tab 不做登记、避免重复**；**列表展示采集实现池全貌**——数据源 = 映射行 + 已登记但未被任何映射引用的采集器（未引用行标记「未被引用」状态），保证「登记即入池」对用户可见 | P0         |
| 标签模板创建引导       | 新增默认采集配置时，系统检测该监控对象类型是否已有标签模板；无模板时弹出轻量提示引导用户创建，支持「立即创建」（预填推荐映射）或「稍后再说」（列表显示待配置 badge）                              | P0         |
| 标签模板展示列        | 默认采集配置列表新增「标签模板」列，展示模板名称 + 默认/自定义标记 + 类别·模板ID；支持查看（只读预览抽屉）、更换（**同资源类别**其他模板）、补配（重新触发创建流程）                        | P0         |
| ScrapeJob 管理            | Job 创建/编辑、命名、启用/禁用、关联监控对象类型与默认采集器、实例选择模式、标签模板引用；**MVP：Job 必须绑定且仅绑定单一已纳管网域**（未在 M09 完成监控纳管的网域不可选）；**v0.2 起放宽为网域集合（决策 54）**：一个逻辑 Job 可勾选多个已纳管网域，M09 生成器按网域自动拆分扇出（每域独立 scrape_configs / targets / 变更单），跨网域复用不再依赖手工克隆；**创建时自动套用该监控对象类型的默认采集配置**（页内「采集器管理」Tab 可维护预设与安装指南）；**选中实例即生成 target，实例采集状态在 Job 详情/编辑抽屉回显（5.10，决策 47-2）；Exporter 安装登记为可选（5.6，决策 47-1）**                                                            | P0         |
| ScrapeJob 草稿与批量提交生效 | **v0.3 开放用户交互**（`draft_status` / `ready` 字段本身 MVP 已落库、默认 `ready`，不变；挪到 v0.3 的仅是「保存草稿 + 批量提交生效」UI/交互能力）：**新建 Job**支持「保存草稿」与「提交生效」两种保存模式（**默认「提交生效」**）：草稿态仅做基础校验（字段类型 / 名称唯一性等），不进入 M09 配置生成，允许创建过程半成品暂存；提交生效时做完整校验（含必填项 / 网域已纳管 / 实例同域），状态转 `ready` 后进入 M09 变更检测管线；**草稿仅存在于新建阶段，对象一旦提交生效（`ready`）不再回退草稿态**，已生效对象的后续修改直接走正常变更管线（保存 → M09 变更单确认）；列表支持多选「批量提交生效」（draft→ready 单向，失败项保留 draft、成功项转 ready）；状态列按四态展示（草稿 / 待下发 / 已生效 / 已停用） | P0 / v0.3 |
| 克隆 Job | **移出 v0.2 范围，后续版本再评估是否提供**（决策 54 网域集合 + M09 按域扇出已覆盖跨网域复用主场景）。原方案要点（保留备查）：将已有 Job **一次性克隆**为新 Job（同网域或跨网域）——复制 `job_name`（自动追加后缀）、监控对象类型、采集实现、采集参数、标签模板；`network_domain_id` 可改选（跨网域克隆场景）；**`selected_instance_ids` 不携带**（Resource 是网域内对象），克隆后按目标网域自动收敛候选并需重新勾选；**Exporter 安装登记（可选）不携带，需对新实例重新登记**；克隆产物是独立 Job，与源 Job 无持续绑定；**不引入「Job 模板」持久实体**——复用通过一次性克隆完成，与 Job 参数快照保护语义（映射变更不穿透已存 Job）保持一致 | P0 / v0.3+ 待评估  |
| 实例选择                    | MVP 支持「按类型+网域自动收敛候选 + 手动勾选」（候选一键全选/反选、关键字筛选）；**`offline` 排除（MVP 必实现）**——候选集中 `Resource.status=offline` 实例**显示但置灰不可选**（`maintenance` 排除口径与 [Module_07 8.1](Module_07_Monitoring_Object_Management.md) 一并对齐、MVP 不保证）；已选实例转 `offline` 后 M09 配置生成跳过（见下方「实例选择方式」与 [Module_07 8.1](Module_07_Monitoring_Object_Management.md)）；**v0.2 起支持 `filter` 模式（决策 53，由 v0.3+ 提前）**——按资源属性（网域 / 环境 / 应用 / 业务类型等）条件表达式筛选并预览匹配结果，**每次配置生成周期实时求值**：M07 新导入/同步的资源匹配条件即自动纳入采集，无需编辑 Job；筛选字段为 Resource 属性字段，label 仅作 UI 别名，不写标签 | P0 / v0.2 |
| Exporter 安装/注册登记（可选）        | 在 Resource × Job 维度登记 exporter 安装/注册情况（`confirmed_by` / `notes` / `actual_port`），**纯留痕与人工背书，不作为生成 target 的前置**（决策 47-1）；未登记实例照常生成 target                                                                                    | P1         |
| 实例采集状态回显        | Job 详情/编辑抽屉的实例列表新增「采集状态」列 + 外层汇总（**在线数 up / 实例总数 / 待采集数**）：存量实例显示真实 up / down；新保存未下发的实例显示「待采集」；已下发但 down 时提醒「配置已下发但未采集到数据，请检查采集器安装与网络连通」（决策 47-2，设计见 5.10；数据源 = Module_02 `/api/v1/targets` 代理，只读消费）                                                                                    | P0         |
| ScrapeJob blackbox 类型支持 | Blackbox 拨测作为 `ScrapeJob` 的一种类型，通过 `job_type`、`blackbox_module`、`blackbox_targets` 配置；不再维护独立 `BlackboxTarget` 实体                        | P0         |
| 技术指标库管理 | 平台可识别的指标元数据（指标名 / 类型 counter/gauge/histogram/summary / HELP/UNIT），回答「能采到什么」；**分组锚点为监控对象类型（monitor_type，多对多、关联带来源采集器标注，见 5.3）**、规则编辑按监控对象类型提示指标与 PromQL 校验；与业务指标库（业务语义契约）**并列互补**——技术库回答"指标是什么"、业务库回答"业务要什么"，两者 UI 互链、动线归组于「指标库」 | P1 |
| 业务指标库 | 业务指标登记表（BusinessMetric）：业务负责人定义语义 / 阈值 / 所属业务域 / 负责人（owner 必填）；**登记不绑定角色——业务负责人自录或运维接工单代办（owner 仍指向业务负责人）**；运维消费后落地采集并标记「已上线」；登记表补「采集落地」列（online 显示关联 Job，语义契约 → 采集落地链路显性化）；**业务视图**（MVP 轻量聚合）：按 business_domain 聚合成员（微服务/中间件/主机）+ 业务指标 + 采集落地状态，语义层不改变采集配置逻辑；MVP 轻量版，v0.3+ 独立业务负责人角色入口 + 业务健康度看板 + 独立业务目录聚合视图 | P0 / v0.3+ |
| 规则文件挂载 | MVP 规则管理入口（承载于独立「规则编辑」页，导航位于「指标库」之后）：上传 / 粘贴完整 `rules.yml`（**整文件透传**，`content_mode=yaml_passthrough`）→ YAML 语法校验 → 落库 `MonitoringRule`（`draft_status=ready`）→ 触发 M09 变更检测，由 M09 生成 / 确认 / 下发 `rules.yml`（**人工确认档**，对齐决策 38-1）——**保证规则变更与采集 Job 一样走 M09 统一配置下发闭环，不绕过 M09**；列表展示规则名 / 规则条数 / 更新时间 / 启用状态 / 下发状态（`change_status`）；支持启停 / 删除 / 详情（YAML 只读视图）；**不做字段级 PromQL 创作编辑**（v0.3 升级 `structured` 字段化表单，见 3.2） | P0         |
| Exporter 指标库            | 静态内置库覆盖常见采集实现（node-exporter、mysqld-exporter、redis-exporter 等）的指标，按监控对象类型组织，并提供用户扩展入口（自定义指标集挂监控对象类型）；完整管理页面放 P1/P2                                              | P1 / P2    |
| 高级 Relabel 管理           | 标签丢弃/保留/重写、正则替换、hashmod（未来）                                                                                                             | P2         |

> **动线顺序与按钮层级**：「采集器管理」Tab 的**主流程**是「配置默认采集配置（监控对象类型 ↔ 采集器）」；「登记采集器」是**低频前置补救动作**，仅在没有合适采集器时执行。页面顶部**主按钮为「新增默认采集配置」**，「登记采集器」入口降级为次级按钮，并同时内置于采集器选择器的空态引导中；页面引导以编号动线说明呈现：「① 登记采集器（仅自研需要）→ ② 配置默认采集（监控对象类型绑定采集器 + 参数）→ ③ 到「采集 Job」创建任务并选实例（可选登记安装）→ ④ 保存后在 Job 详情查看采集状态回显」，一眼看清顺序与可选性。
>
> **空态依赖引导规范**：所有依赖外部模块的下拉选择器（网域来自 M09、标签模板来自 M07、采集器来自本 Tab 采集器池）在选项为空时，统一展示「说明文案 + 内联跳转/创建动作」，避免仅通过保存时的 `bad_request` 提示用户。例如：网域选择器空态显示「暂无已纳管网域，请先到网域管理完成纳管」并内联跳转 M09；采集器选择器空态显示「未找到合适的采集器？登记采集器」并内联打开登记表单；标签模板选择器空态显示「该监控对象类型尚无标签模板，请先创建」并内联打开创建抽屉。保存时校验（`bad_request`）作为兜底保留。
>
> **列表展示规范**：列表中的状态 / 同步 / 标签列采用**异常驱动**展示——正常态以低饱和标签或 `-` 呈现，异常态（如映射默认值已变更、标签模板待配置、网域未纳管）才使用高饱和 / 可点击 Tag；详情数据收进抽屉 / Tooltip，避免常驻高亮导致列表每行都很「吵」。

### 3.2 规则编辑 UI（v0.3）

| 功能        | 说明                                                                      | 优先级 / 版本 |
| --------- | ----------------------------------------------------------------------- | --- |
| 类 YAML 表单 | 提供 expr / for / labels / annotations 字段，支持告警规则与记录规则编辑（**v0.3 字段化形态，替代 MVP 的整文件透传挂载**，见 3.1「规则文件挂载」） | P0 / v0.3 |
| PromQL 校验 | 调用 [Module\_02: 查询中心](Module_02_Query_Center.md) 或 Prometheus 接口校验表达式语法 | P0 / v0.3 |
| 指标实时预览    | 在编辑规则时展示指标名、标签键值提示与最近样本预览                                               | P0 / v0.3 |
| 规则模板      | 按监控对象类型 / 采集实现预置常用规则模板，支持一键填充（P1）                                  | P1 / v0.3 |
| 图形化规则构建器  | 拖拽式构建复杂规则（未来）                                                           | P2 |

> 本节的**字段级规则编辑 UI**（类 YAML 表单 + PromQL 校验 + 指标预览）整体由 MVP 调整至 **v0.3**。**MVP 已交付「规则文件挂载」（见 3.1）：上传 / 粘贴完整 `rules.yml` 整文件透传落库，规则变更同样进入 M09 变更检测 → 确认 → 下发闭环**——MVP 不再"手写 rules.yml 绕过 M09"，规则创作体验（字段表单 / 校验 / 预览 / 模板）留待 v0.3 字段化编辑，规则编辑 UI、PromQL 校验、指标实时预览及规则模板随 [Module_08](Module_08_Alertmanager_Notification_Management.md)（v0.3）一同交付；PromQL 校验与指标预览调用 [Module_02](Module_02_Query_Center.md) v0.3 提供的 `validate` / `preview` 接口。
>
> 规则编辑 UI 由本模块提供；规则保存后（MVP 透传 / v0.3 字段化）由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 按规则内容与作用域生成并下发 `rules.yml`，静默、Alertmanager 配置与告警状态展示由 [Module\_08: 告警收敛与通知管理](Module_08_Alertmanager_Notification_Management.md) 负责。

### 3.3 运行时采集状态展示（已移出）

以下功能原属 Module\_01，现已移出：

| 功能                                     | 移交模块                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 目标列表、目标详情、状态筛选                         | [Module\_02: 查询中心](Module_02_Query_Center.md)                                                               |
| 拨测结果展示（probe\_success、probe\_duration） | [Module\_02: 查询中心](Module_02_Query_Center.md)                                                               |
| 采集诊断、抓取失败原因、HTTP 状态码                   | [Module\_02: 查询中心](Module_02_Query_Center.md)                                                               |
| Job 健康度、采集覆盖率                          | [Module\_02: 查询中心](Module_02_Query_Center.md) / [Module\_08: 告警规则管理](Module_08_Alertmanager_Notification_Management.md) |
| 临时目标验证                                 | [Module\_02: 查询中心](Module_02_Query_Center.md)（P2）                                                           |
| 边缘 Agent 状态展示                          | [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)                                 |

> **回显回流说明（决策 47-2）**：上表「独立页面/视图」职责仍归 M02 / M08 / M09；但 **Job 配置上下文内的只读采集状态回显**（实例状态列 + 在线数汇总，见 5.10）由本模块前端消费 Module_02 `/api/v1/targets` 代理实现——回显是配置闭环的一部分，不构成独立的运行时状态页面。
***

## 4. 核心流程

> 决策依据：design-decisions.md 决策 7 / 14 / 15 / 16

本模块的核心用户流程为「**监控对象类型接入 → 创建采集 Job → 配置生成下发 → 运行时采集**」：

1. **监控对象类型接入**：运维工程师选择资源类别 → 细粒度监控对象类型，创建/复用默认采集配置（含默认采集参数与标签模板；新监控对象类型无标签模板时触发创建引导，v0.4+ CMDB 新类型经 Module\_04 待分类队列进入同一流程）；
2. **创建采集 Job**：基于映射创建 ScrapeJob（快照继承默认参数），选择实例——MVP 手动勾选（同类型同网域候选收敛）→ v0.2 条件筛选（filter，决策 53）→ v0.3+ 服务发现（service_discovery，微服务动态实例）；
3. **配置生成与人工确认下发**：Module\_09 轮询感知策略变更（pull 模式——M01 写库仅维护 `updated_at`、不主动通知，**非"保存即触发生成草稿"**），生成 `prometheus.yml`（含 `static_configs[].labels` 注入 app/biz）**草稿**，**经人工确认后**下发（见 Module\_09 3.x）；
4. **运行时采集**：Prometheus/Edge Agent 抓取，全局目标状态与采集诊断视图由 Module\_02 提供；**Job 上下文采集状态回显**（实例 up / down / 待采集 + 在线数汇总）经 Module\_02 `/api/v1/targets` 代理回流到本模块 Job 详情/编辑抽屉（决策 47-2），闭合「配置 → 下发 → 验证」动线。

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

### 5.1 默认采集配置（CITypeExporterMapping）

> 决策依据：design-decisions.md 决策 13 / 14 / 15 / 16 / D2 / D3 / D7 / D10 / D17 / D18 / D19 / D20 / D22 / D23 / D24 / D25 / D26

**入口与命名**：本预设层为**独立页面「采集器管理」（`/collectors`）**，与「采集 Job」页（`/scrape-jobs`）**同为 Sider 一级导航项**（无「采集策略」分组）——创建 Job 时自动套用该监控对象类型的默认值，用户在独立页面内查看/维护预设（采集器 / 参数 / 安装指南 / 标签模板）。

> **安装动线指引与职责边界**：本 Tab 承担**类型级采集器指引**——"该监控对象类型该装什么采集器（默认/可选，已按 OS 平台区分）、怎么装、去哪下载（安装指南 / download_url / homepage 明显展示）"；**不做实例级安装登记**（那是 5.6 `ExporterInstallationConfirmation`，在「采集 Job」创建任务选实例时进行，`resource_id` × `scrape_job_id` 维度，可选）。动线闭环以**文案衔接**闭合：「看指南 → 去线下目标机安装/下载 → 回到「采集 Job」选实例（可选登记）→ 保存后看采集状态回显」——避免两处重复的登记 UI。

> **采集实现语义**：本表承载「监控对象类型 ↔ 采集实现（采集器）」配置。**多对多（双向）**——一个监控对象类型可配置多个可选采集实现（如 `host_linux` 下 node_exporter / Telegraf / 自研 Agent，安装方式、开放端口、离线包不同；`host_windows` 下 windows_exporter），**一个采集实现也可服务多个监控对象类型**（如 Telegraf 同时服务 host_linux / mysql）；通过 `is_default` 标记该监控对象类型下的默认采集实现；**install_guide / download_url / homepage / 默认参数 / 离线包归属采集实现**（不直接挂监控对象类型，避免"一类一种标准采集"的隐式假设）。

> **职责边界**：采集实现只约束「**采集 Job 怎么配**」（端口 / 路径 / 协议 / 安装指南），**不约束「指标库怎么组织」**（指标锚点见 5.3），**更不强制 CI 与采集实现一对一**——监控对象类型是用户视角的「我要监控什么」，采集实现是「怎么采」的可变实现细节；用户从 node_exporter 切换到 Telegraf 时，**指标库不应地震**（指标仍挂监控对象类型），只有采集 Job 的配置需要变。

> **两条来源动线统一（登记即入池）**：开源 / 第三方采集器走「看指南 / 下载 → 线下安装 → 创建 Job 自动带出默认参数 → 选实例（可选登记安装）→ 保存后看采集状态回显」；自研采集器先在本 Tab「登记采集器」（`source=internal`，表单引导见 5.2），登记完成即入池，**之后与官方采集器同一条动线**（同样被映射引用、同样预填 Job、同样走 5.6 可选安装登记）；预置参数为官方默认值参考，不随动线砍掉。

| 字段                        | 类型       | 来源               | UI 展示名        | 说明                                  |
| ------------------------- | -------- | ---------------- | -------------- | ----------------------------------- |
| id                        | string   | 平台生成             | 映射 ID         | 唯一标识                                |
| monitor\_type            | enum     | Module\_07（资源类别 + 子类型推导） | 监控对象类型     | `host_linux` / `host_windows` / mysql / redis / kafka / ...；派生的策略维度，由 M07 资源类别 + 子类型经推导表（`MONITOR_TYPE_DERIVATION_MAP`）得出，不回写 CMDB  |
| exporter\_template\_id    | string   | 平台生成             | 默认采集器        | 关联的采集实现（采集器）ID                |
| default\_port             | int      | 采集实现             | 默认端口         | 默认监听端口，如 9100、9104                  |
| metrics\_path             | string   | 采集实现             | 采集路径         | 默认 `/metrics`，可覆盖                   |
| scheme                    | string   | 采集实现             | 协议            | http / https，默认 http                |
| scrape\_interval          | duration | 策略配置             | 采集间隔         | 默认 15s / 30s / 60s                  |
| scrape\_timeout           | duration | 策略配置             | 采集超时         | 默认 scrape\_interval 的 80%           |
| label\_template\_id       | string   | Module\_07       | 标签模板         | 生成 target labels 时引用的 LabelTemplate；默认标签模板需包含稳定资源身份标签（`resource_id` / `hostname`），创建流程由 Module\_07 提示 |
| has\_label\_template      | bool     | 平台计算             | 仅技术信息        | 该监控对象类型是否已有标签模板，供前端判断是否提示创建引导 |
| is\_builtin               | bool     | 平台               | 内置映射         | 是否平台内置绑定，用户可覆盖                      |
| is\_default               | bool     | 平台               | 默认采集实现      | 该监控对象类型下是否默认采集实现（每类型至多一个默认；可多行并存表示可选采集实现） |
| created\_at / updated\_at | datetime | 平台               | 仅技术信息        | 创建/更新时间                             |
| （无 install\_guide 字段）   | —        | —                 | —              | **安装指南只读透传**：本表**不再持有** `install_guide` 字段，列表 / 表单展示时只读透传采集实现（`ExporterTemplate.install_guide`，单一持有方）；如需类型级补充说明，另用纯备注字段（如 `install_notes`），避免双写不一致 |

> **采集实现层 vs 实例层**：CITypeExporterMapping 是**采集实现层（预设）**配置——为每种监控对象类型定义「默认用哪个采集器 + 默认采集参数 + 安装指南」，全局一份、由平台/管理员维护（同一监控对象类型可多行表示多个可选采集实现，`is_default` 标记默认）；ScrapeJob 是**实例层（运行态）**配置——基于该绑定继承默认值（`scrape_interval`、`scrape_timeout` 等）创建，再绑定具体网域与实例，允许覆盖。二者职责不同、**不重复**：映射被 Job 继承消费，Job 才是实际采集任务。

> **采集实现层定位与网域无关性**：
>
> - CITypeExporterMapping 为**采集实现层（平台级默认预设）**配置，**不绑定网域**；每监控对象类型可**多行**（多个可选采集实现，`is_default` 标记默认）；
> - **v0.2** 新增 **`CITypeExporterMappingOverride`（网域级覆盖表）**：按 `network_domain_id` 覆盖映射默认值（`default_port` / `scheme` / `metrics_path` 等），**优先级高于映射默认值**（同网域内生效）；覆盖表跟随多网域能力（v0.2）落地，支撑不同网域差异化默认采集参数（如政务云强制 HTTPS、专网特殊端口），以及安全合规场景——不同网域因安全策略要求使用不同端口（**避开高危端口**）；
> - **MVP 仅预留上述说明、不实现覆盖表**（v0.2 落地，随网域管理/按网域配置生成一并交付）。

> **端口一致性说明**：
>
> - **问题**：映射 `default_port` 决定 `instance` 标签端口（Module\_07 组合字段，见 Module\_07 5.12 C）；当它与实例上 exporter 实际监听端口不一致时，instance 标签会错（如映射 9100、实例实际 19100）。
> - **三层解决手段**：
>   1. **映射层（MVP 已有）**：`CITypeExporterMapping.default_port` 在映射表单中可编辑（选 Exporter 后自动填充、可覆盖），解决"某监控对象类型普遍使用非标端口"；
>   2. **网域级覆盖（v0.2，已预留）**：`CITypeExporterMappingOverride` 按网域覆盖 `default_port`，解决"某网域统一非标端口"；
>   3. **实例级端口覆盖（v0.2，Resource 级 `scrape_port`）**：同一监控对象类型下个别实例端口不同（如 node\_exporter 一个 9100 一个 19100）时，支持按实例覆盖端口——方案定为 **Resource 级 `scrape_port`**：M07 Resource 增加**可选 `scrape_port` 字段**（M07 PRD 同步定义，本模块从 M01 视角引用）；M09 生成 target 时端口解析优先级：`Resource.scrape_port`（实例自带）→ 网域覆盖表 `CITypeExporterMappingOverride` → 映射默认 `CITypeExporterMapping.default_port`（回落 `ExporterTemplate.default_port`）；端口在 M07 资源登记 / 编辑 / Excel 导入时可选填写（留空走默认解析链），**M01 建 Job 动线不变**，Job 实例列表可只读回显「生效端口」；典型场景：同一主机运行多个同类实例（如两个 MySQL 3306/3307），M07 登记为两行资源各带各的端口。**Job 级端口映射表不做**——与 filter / service_discovery 动态纳入模式天然冲突（动态实例无法预配端口），且「台账归别人管、采集团队只有 Job 配置权限」的组织场景经确认不存在。
> - **Exporter 安装登记的职责边界**：安装登记（5.6，可选）是"状态登记 + 人工背书"，**不承担端口编辑**（登记主键维度为 `resource_id` × `scrape_job_id`，端口解决见第 1/2/3 层，不作为安装登记的可写字段）；可增量登记**实际监听端口**（仅记录，配置生成时若与生效端口不一致则提示，不自动改配置）。

> **参数继承与同步策略（创建时快照 + 显式覆盖 + 手动同步）**：
>
> - **创建时快照**：创建 ScrapeJob 时加载映射默认值（存在网域覆盖则用覆盖值）预填参数，用户可显式覆盖（采集参数本身可手填，见 5.1「手填模式」），保存后 Job 持有**快照值**；
> - **保护存量**：映射（含网域覆盖）后续变更**不影响已有 Job**；
> - **手动同步**：映射默认值变更时 UI 提示「映射默认值已变更」，由用户手动执行「同步映射默认值」，将 Job 参数刷新为最新默认值（**手动覆盖过的字段不刷新**，Job 需记录各字段的覆盖标记 `mapping_overrides`）；
> - **优先级（两段式，消除歧义）**：
>   - **创建预填来源优先级**：网域覆盖（v0.2）> 映射默认值 > 采集实现内置默认；
>   - **生效优先级**：Job 保存后其参数**快照值即为该 Job 的最终生效配置**（优先级最高），映射 / 网域覆盖后续变更**不自动覆盖**它，仅提示后由用户手动「同步映射默认值」刷新（未手动覆盖的字段）。
>
> **层叠默认链（Job → 映射 → 采集器模板 → 全局兜底）**：生效参数按以下层叠链解析，**任一层留空 = 继承下一层**，保存时解析为生效快照（决策 14 快照语义不变）：
>
> - **Job** 级（采集参数可覆盖）→ **默认采集配置 `CITypeExporterMapping`（`is_default` 行）** → **采集器模板 `ExporterTemplate`**（**仅 `metrics_path` / `scheme`**）→ **全局兜底常量**：`DefaultScrapeInterval=15s` / `DefaultScrapeTimeout=10s` / `DefaultMetricsPath=/metrics` / `DefaultScheme=http`；
> - 链上某层留空（如 `scrape_interval` / `scrape_timeout` 不来自映射或模板）即落到下一层直至全局常量；M09 生成 `prometheus.yml` 时按最终解析快照输出。

> **标签模板继承链（正交定位 + 类别兜底）**：
>
> - **正交关系**：标签模板（打什么标签，LabelTemplate 归 Module\_07 维护）与采集器（怎么采，ExporterTemplate）**正交**——采集器不决定标签模板、标签模板不决定采集器；`CITypeExporterMapping.label_template_id` **非强关联、非必填**，语义 = 该监控对象类型在该类别下的**默认模板**（创建 Job 时自动预填的快捷来源）；
> - 创建 Job 时自动预填、**允许覆盖**（换用其他模板）；LabelTemplate 由 [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 维护，本模块**只读引用**、不维护其内容；
> - **Job 自动预填顺序**：映射默认模板（`mapping.label_template_id`，监控对象类型级）→ **兜底同资源类别 `is_default` 模板**（映射未配置默认模板时）→ 都无则显示「暂未选择 / 待配置」引导；概要行显性说明「已自动匹配该监控对象类型的默认模板，可更换」。

> **标签模板关联 UX**：
>
> - 模板 ID（`label_template_id`）为**跨模块唯一稳定 FK**（名称在同一资源类别下可重复），保证用户可肉眼对应到 Module\_07 的具体模板；
> - **列表展示（两行卡片）**：默认采集配置列表的「标签模板」列改为两行信息——第一行模板名称 + 「默认/自定义」标记，第二行「类别 · 模板ID」；不使用状态徽标（避免"健康状态"语义混淆）；
> - **预览抽屉**：点击模板名称打开**只读预览抽屉**，展示模板映射明细（来源字段 → 目标标签 → 启用），无需进入编辑表单即可核对模板内容；
> - **表单内预览（紧凑卡片）**：Job 表单选择标签模板后，以紧凑卡片展示模板头部（名称 + ID + 默认标记）与映射明细（小表格/列表），替代 Tag 堆砌；并提供「前往标签模板管理」跨模块跳转（Module\_07 为模板 CRUD 归属方，本模块不重复编辑）。**映射 / 默认采集配置（新增 / 编辑）抽屉不含 `label_template_id` 字段**，其标签模板经列表「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`）维护。跨模块跳转由**统一导航配置承载**，原型可暂用相对路径演示，实现期不得在代码中写死路径，统一走导航/路由配置。

> **标签模板创建引导**：
>
> - **预设抽屉不含标签模板字段**：新增 / 编辑默认采集配置的表单（`MappingDrawer`）**完全移除 `label_template_id` 字段**（仅保留采集器 / 参数 / 默认标记）；标签模板的**唯一变更入口** = 默认采集配置列表「标签模板」列的「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`）。标签模板与采集器正交，取消字段是为了避免「更换/补配」与「编辑」双入口写同一字段导致界面数据不同步；
> - **补配入口收敛（一个动作两个触发点）**："补配"的本质是在映射层设置默认模板，**统一动作 = 打开该监控对象类型映射行的「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`，不打开编辑抽屉）**：①Job 表单缺模板 Alert 主按钮 / ②映射列表「补配」按钮 / 「待配置」badge → **均打开本行「更换 / 补配」轻量抽屉**；③「前往标签模板管理（M07）」**仅保留在轻量抽屉空态**（该类别真的无模板时才需要去 M07 创建，复用空态依赖引导）；
> - **触发时机**：用户新增默认采集配置时，系统检测该监控对象类型是否已有标签模板（`has_label_template`）；
> - **已有模板**：正常完成映射，`label_template_id` 由「更换 / 补配」轻量抽屉设置（或自动预填为该类型的默认模板）；
> - **无模板**：轻量抽屉空态提示「监控对象类型 "{类型}" 尚无标签模板。标签模板定义资源字段到监控标签的映射，建议先创建，否则监控数据将缺少归属标签。」并内联「前往标签模板管理（M07）创建」引导（复用空态依赖引导）；映射列表该行「标签模板」列显示「标签模板待配置」badge，用户可后续点击「补配」打开轻量抽屉重新设置；
> - **缺口类型区分与软引导**：Job 表单 Alert 文案按缺口区分——①映射有候选但未关联模板：「该监控对象类型的默认采集配置尚未关联标签模板」+ 主按钮「立即补配」（打开「更换/补配」轻量抽屉）；②该资源类别下无任何模板：「该资源类别尚无标签模板」+ 主按钮「前往创建模板」（M07，此时才是真阻塞）。**软引导、不阻塞保存**：缺模板只是监控数据缺归属标签，Job 仍可运行——保持 warning 提示、不升级为必填校验（与默认采集器必填不同）；
> - **更换模板**：已配置模板的映射行，用户可点击「更换」选择**同资源类别**的其他模板；
> - **跨模块跳转**：列表行和预览抽屉均提供「前往标签模板管理」链接，跳转至 Module\_07 进行深度管理（编辑/克隆/删除）。

> **标签选择两情形引导（新增 vs 已有监控对象类型）**：
>
> - **心智分叉**：监控对象类型**新增**（首次引入、无模板）时的正确动作是**创建模板**；监控对象类型**已有**（有模板）时的正确动作是**直接选择模板**（常态，无需重复创建）。此分叉必须在「标签模板」选择交互上显性化：
> - **选择器按资源类别过滤（类别驱动候选、类型驱动默认）**：标签模板内容（字段 → label 映射）由资源字段 schema 决定、锚定**粗粒度资源类别**（M07 `LabelTemplate.monitor_type` = 类别，避免 host\_linux / host\_windows 各建一套内容几乎相同的模板）；映射 / Job 表单的「标签模板」选择器**直接联动资源类别字段**——**选定资源类别即收敛候选**为该类别下所有模板（与「更换 = 同资源类别其他模板」约束一致）；**选定监控对象类型后预填默认模板**——`CITypeExporterMapping.label_template_id` 指定该监控对象类型在该类别下的默认模板（缺省时兜底同类别 `is_default` 模板），选择器选项对默认模板加「默认」Tag。下拉空态（该类别无模板）时，显示「该资源类别尚无标签模板，请先创建」+ 内联「创建标签模板」按钮（复用创建抽屉，预填推荐映射）；
> - **两情形提示文案（表单 extra / 空态）**：
>   - 有模板：「该资源类别已有 N 个标签模板，直接选择即可（已自动关联该监控对象类型的默认模板，可更换）」；
>   - 无模板：「该监控对象类型为新类型，其资源类别尚无标签模板；创建后采集 Job 将自动继承」；
> - **默认模板标记**：选择器选项对默认模板加「默认」Tag，用户一眼识别"已有 CI 就选这个"；
> - **创建引导文案强化「新 CI」语义**：弹窗标题 / 正文明确「检测到**新增**监控对象类型 "xx"，尚未创建标签模板」，弱化"已有类型重复创建"的心智。

> **监控对象类型来源与映射（两套粒度体系 + CMDB 权威来源 + 术语分层）**：
>
> - [Module\_07](Module_07_Monitoring_Object_Management.md) 的 Resource 采用**粗粒度资源类别**（`resource_category`：host / database / middleware / application / generic\_target，五大类）+ **细粒度子类型** `database_type` / `middleware_type`（mysql / redis / kafka / ...）；
> - 本模块 `monitor_type` 使用**细粒度监控对象类型**（`host_linux` / `host_windows` / mysql / redis / kafka / nginx / application\_http / snmp），直接映射 Exporter 绑定与指标库；
> - 映射表（`MONITOR_TYPE_DERIVATION_MAP`，监控对象类型**推导**表——名字即语义：这是由资源类别 + 子类型推导出来的策略维度，不是与 CMDB 的绑定；五大类 + 归类规则）：
>
> | Module\_07 粗粒度（resource\_category + database\_type / middleware\_type + os\_type） | Module\_01 细粒度 monitor\_type |
> | --- | --- |
> | host + os\_type=linux / unix | `host_linux` |
> | host + os\_type=windows | `host_windows` |
> | database + mysql | mysql |
> | database + redis | redis |
> | middleware + kafka | kafka |
> | middleware + elasticsearch | elasticsearch |
> | middleware + nginx | nginx |
> | application | application\_http |
> | generic\_target | snmp |
> | database + dm8（达梦，未来产品线示例，v0.4+ 随 CMDB 映射进入） | dm8 |
>
> - **五大类归类规则**：以**数据存储/查询为主语义、按产品线分采集器** → `database`（mysql、redis、postgresql、oracle、达梦 dm8、sqlserver、mongodb）；**消息/网关/协调/搜索** → `middleware`（kafka、nginx、zookeeper、elasticsearch）。边界案例已定：**redis → database**（缓存，业界多数 CMDB 放数据库/缓存侧）；elasticsearch 留 middleware。该规则在 M07 / M04 同步维护，避免每来一个新产品线都争一次归属。
> - **v0.4+ CMDB 接入**：CMDB CI 类型（`bk_obj_id`）为**唯一权威来源**；Module\_04 同步后向 Module\_07 写入五大类 + database\_type / middleware\_type，并向本模块**刷新 monitor\_type 映射**（推导链，见「监控对象类型推导表」）；MetricCenter **只维护映射、不增删类型**；新增产品线（如达梦）的动作是配两行映射（M04 映射表 + 本表），不改 CMDB 模型定义。

> **监控对象类型拆分边界**：监控对象类型是否拆分的判定轴是「**指标 schema / 采集实现是否不同**」。Linux 发行版（麒麟、统信、Ubuntu）及 x86/arm64 架构**不构成单独的监控对象类型**——其差异下沉到 `ExporterTemplate.os/arch` 与安装指南 / 下载包（见 5.2）；数据库产品线（MySQL、达梦、SQL Server）因采集器与指标集不同，**可拆分**为不同监控对象类型。

> **标签模板必须包含稳定资源身份**：为该监控对象类型创建的默认标签模板，应**至少映射一个网域内稳定的资源身份标签**（如 `resource_id` 或 `hostname`），用于跨网域 / 端口变更后的指标关联、排障与拓扑穿透视图；`instance`（ip:port）仅作为 Prometheus 抓取目标身份，**不作为稳定业务关联键**（见 5.4）。该约束由 Module\_07 的 LabelTemplate 创建流程提示，`label_template_id` 引用时本模块校验存在性。

> **采集器选择器空态引导**：新增 / 编辑默认采集配置时，若「默认采集器」下拉为空（当前监控对象类型无匹配采集实现或池为空），显示「未找到合适的采集器？前往登记采集器」内联按钮，登记完成后选择器自动刷新；保存时 `bad_request` 校验兜底（见 3.1「空态依赖引导规范」）。

> **空态登记必须携带发起上下文**：从「新增默认采集配置」/「采集 Job」表单的采集器空态发起登记时，登记表单**预填 `supported_monitor_types` = 当前监控对象类型**，保存成功后**自动回选 `exporter_template_id` 到来源表单**（预设抽屉回填并自动填充采集参数；Job 表单回填并预填参数）——否则登记完仍可能因 `supported_monitor_types.includes(当前监控对象类型)` 过滤不可见，空态补救失效。登记弹窗标题 / 字段说明需提示「已预填监控对象类型、保存后自动选中」。

> **application\_http 语义澄清**：`application_http` 对应"业务指标端点采集"（应用服务资源自带 `/metrics`，见 Module\_07 5.8 `endpoint`），其"采集实现"实为**HTTP 抓取**——业务应用无独立 exporter 进程，由 Prometheus client / 框架埋点暴露指标：
>
> - `default_port` 语义 = 业务指标端点端口（与实例 `endpoint` 的端口对应，可留空由实例 `endpoint` 决定）；
> - 标签模板默认映射含 `app_name → app`、`business_domain → biz`（Module\_07 5.12 A / 5.15 业务指标标签规范：机制 A 抓取注入 `static_configs[].labels`），Job 引用含该映射的采集实现即可让业务指标自动带资源标签，**无需新增采集模型**；
> - 业务维度标签（`path` / `method` / `status`）由指标自带，不参与资源关联（见 Module\_07 5.15）。
> - **自定义微服务仍属 application\_http（给技术工程师的显性约束）**：平台**不按语言/框架拆分监控对象类型**——Go / Python / 自研框架埋点的业务服务仍选 `application_http`，形态差异（采集路径 `/metrics` 非 `/actuator/prometheus`、非标端口、协议）通过**手填采集参数 / 多个可选采集实现**覆盖（5.1 `is_default` 多行），**无需新增监控对象类型，也无需"为挂指标而造模板"**（指标直接挂监控对象类型，见 5.3）。UI 侧在默认采集配置区对 `application_http` 显性提示该约束（表单 extra + 页面 Alert），避免技术工程师误以为需为每种语言建监控对象类型。
> - **application\_http 在「采集器管理」页面呈现为引导卡、不进登记流程**：`application_http` 不是采集器、无安装动作——页面内对该监控对象类型展示**引导卡**而非采集器登记入口：「业务应用自带 `/metrics` 端点，无需安装采集器；指标语义请前往业务指标库（5.9）登记；创建采集 Job 时端口 / 路径按应用实际 endpoint 手填」。避免用户把每个微服务登记成一个"采集器"。

> **v0.4+ 新监控对象类型引导闭环**：CMDB 新监控对象类型经 Module\_04「待分类队列」完成映射同步后，本模块需要形成**新类型接入引导闭环**（复用标签模板创建引导模式）：
>
> - 新类型无默认采集配置 → 列表显示「待配置」badge + 引导创建（推荐默认采集参数与标签模板，同 5.1「标签模板创建引导」流程）；
> - 新类型已有映射但无标签模板 → 复用标签模板创建引导；
> - 目的：CMDB 类型膨胀（环境/厂商变体）时，保证"新类型出现 → 管理员映射 → 自动可采集"闭环，避免类型静默无监控。

> **监控对象类型选择交互（两级级联）**：本模块所有涉及监控对象类型的选择（默认采集配置、采集 Job、规则编辑、指标库筛选）统一采用**「资源类别 → 细粒度监控对象类型」两级级联**：先选资源类别（主机/中间件/应用/通用目标），再选该类别下的细粒度类型（MySQL/Redis/Kafka/...），避免「MySQL（middleware）」这类把类型与大类拼接的表述；**第二级 label 为「监控对象类型」，extra 文案写明「由资源类别与子类型（主机另按操作系统）自动推导，用于绑定默认采集器与指标库」**——让用户理解这是监控平台的策略维度，不是 CMDB 的类型定义；选中细粒度类型后，通过 `CITypeExporterMapping` 自动带出该类型的默认采集器（可覆盖 / 可手填采集参数）。该交互与 [Module\_07](Module_07_Monitoring_Object_Management.md) 的 Resource 选择体验一致。

### 5.2 采集实现 / 采集器（ExporterTemplate）

> 决策依据：design-decisions.md D3 / D4 / D5 / D17 / D20 / 决策 3.53 / 3.54

`ExporterTemplate` 是**「采集实现（采集器）」轻量配置片段**：

- **不支撑指标库分组锚点**（指标锚点改监控对象类型，见 5.3）；无「Exporter 市场」运营概念；
- 承载**采集实现维度的知识沉淀**：`install_guide`（离线/隔离网域安装说明）、`download_url` / `homepage`（下载地址与官方文档入口）、`os` / `arch` 平台约束、默认采集参数、支持类型——**归属采集实现**（一个监控对象类型可多个采集实现，经 5.1 `CITypeExporterMapping` 多行 + `is_default` 关联）；
- MVP 采集实现 = **平台预置**（`is_builtin=true`，只读，按 `host_linux` / `host_windows` 等 OS 平台区分） + **用户登记**（`is_builtin=false`，含自研采集器，MVP 即开放） + **手填覆盖**（端口 / 路径 / 协议在映射 / Job 表单直接填写，无需新建模板）。

| 字段                         | 类型      | UI 展示名        | 说明                                   |
| -------------------------- | ------- | -------------- | ------------------------------------ |
| id                         | string  | 采集器 ID        | 唯一标识                                |
| name                       | string  | 采集器名称        | 如 node-exporter、mysqld-exporter       |
| version                    | string  | 版本            | 版本，如 1.6.1                           |
| default\_port              | int     | 默认端口         | 默认端口                                 |
| metrics\_path              | string  | 采集路径         | 默认 `/metrics`                        |
| scheme                     | string  | 协议            | http / https                         |
| supported\_monitor\_types | \[]enum | 支持的监控对象类型 | 可绑定的 monitor\_type 列表               |
| os                         | string  | 适用操作系统       | linux / windows / any；`any` 表示不区分平台           |
| arch                       | string  | 适用架构          | amd64 / arm64 / any；可空，默认 `any`                 |
| download\_url             | string  | 下载地址          | 第三方下载页 / 离线包路径 / 内部制品库地址（**归属采集实现**）      |
| homepage                   | string  | 官方文档 / 主页    | 采集器官方文档或搜索入口链接                          |
| install\_guide             | text    | 安装指南         | 离线/隔离网域安装说明（**归属采集实现**；**唯一持有方**——映射行不持有该字段、只读透传展示，见 5.1）              |
| is\_builtin                | bool    | 平台预置         | 是否平台预置                                |
| source                     | enum    | 来源            | `official`（开源官方）/ `third_party`（第三方）/ `internal`（自研）；内置采集器默认 `official` / `third_party`，用户登记默认 `internal` |

> **多架构 / 多发行版支持**：`os` / `arch` 用于描述采集器制品的**适用平台**，平台差异（麒麟 / 统信 / Ubuntu、x86 / arm64）**不上升为监控对象类型**（见 5.1），由 `ExporterTemplate.os/arch` 与安装指南 / 下载包承载。同一采集器在不同架构下可能使用**不同离线包**，因此 `download_url` 支持以下两种表达方式之一：
>
> - **方式①（MVP 推荐，改动最小）**：按 `os` / `arch` 组合登记**多条 `ExporterTemplate` 记录**（同一采集器不同平台各一条，`os` / `arch` 不同、`download_url` 指向对应离线包）；
> - **方式②（结构化）**：`download_url` 类型从 `string` 改为 `{ os: string, arch: string, url: string }[]` 结构。
>
> MVP 采用方式①，字段表保持不变；方式②作为 v0.2+ 演进选项预留（单条记录承载多平台包时启用）。

> **默认值参考语义**：`ExporterTemplate` 中的 `default_port` / `metrics_path` / `scheme` 等预置参数语义 = **官方默认值参考，不是强制值**——用户线下安装采集器时未改配置则与预置值一致，改了则在映射（5.1）/ Job（5.4）层覆盖；预置值同时承担"装完不知道默认端口 / 路径是什么"的知识参考作用。

> **登记表单按来源引导**：「采集器管理」Tab 列表支持按 **监控对象类型 + 来源** 筛选；登记 / 编辑表单按 `source` 做字段引导——`source=internal`（自研）时：`default_port` / `metrics_path` / `scheme` **必填**并提示「无官方默认值，请按实际部署填写」；`download_url` 提示填内部制品库地址或内网下载链接；`name` 建议 `xxx-exporter` 命名规范。`official` / `third_party` 来源由平台预置、只读维护。

> **登记来源口径（统一）**：用户登记**仅限 `internal`**（自研采集器）；`official` / `third_party` 采集器**由平台预置、只读维护、不可由用户登记**——「登记采集器」动作仅面向自研采集器（与 3.1 动线②「仅自研需要」一致）。
>
> **保守登记（预留，不开放）**：平台预置采集器（`official` / `third_party`）当前**只读维护**，用户登记仅 `internal`；「**开放 `official` / `third_party` 用户登记 + `is_builtin` 预置降级为初始数据**」作为 **v0.2+ 待设计方向**（当前不开放，避免「预置只读」与「用户写」双写不一致）。

> **登记表单支持上下文预填**：从「新增默认采集配置」/「采集 Job」表单的采集器空态发起登记时，登记表单 `supported_monitor_types` 预填为发起时的当前监控对象类型（可追加其他类型）；保存成功后自动回选到来源表单的采集器字段并预填采集参数（见 5.1）。

> **登记即入池**：自研采集器登记完成后即进入采集实现池，与平台预置采集器**同等待遇**——同样可被 `CITypeExporterMapping` 引用为默认 / 可选采集实现、创建 Job 时同样预填参数（快照 + 覆盖）、同样走 5.6 实例级安装登记（可选）。开源采集器与自研采集器不是两条动线，而是"一条动线 + 一个前置登记动作"。

### 5.3 技术指标库（ExporterMetricLibrary）

> 决策依据：design-decisions.md 决策 5 / 6

**两库定位区分（与业务指标库并列互补）**：技术指标库 = **技术元数据**（回答「能采到什么」：指标名 / 类型 / HELP / UNIT，**按监控对象类型组织**），服务规则编辑的提示与 PromQL 校验；业务指标库（5.9）= **业务语义契约**（回答「业务关心什么」：语义 / 阈值 / 业务域 / 负责人）。规则编辑同时消费两库——expr 指标校验用技术库、阈值参考用业务库（v0.3+）。UI 上两者互链（技术库页提示"业务语义见业务指标库"，业务库页提示"采集落地依赖技术指标库与采集 Job"）、导航归组于「指标库」（技术 / 业务二分）。

> **锚点演进（指标直接挂监控对象类型，多对多带来源标注）**：指标库分组锚点从 `exporter_template_id` **上移到监控对象类型（monitor_type）**——指标 ↔监控对象类型为**多对多**（同一指标可属多个监控对象类型，如 `go_goroutines` / `process_*` 属所有应用型类型），关联携带 **`source_exporter`（来源采集器）标注**解决「同名不同义」（Spring Boot 与 Go 都产出 `http_server_requests_seconds_count`，规则编辑提示时显示来源区分）；`exporter_template_id` **降级为「建议采集器」可空外键**（仅技术信息，不作分组锚点、不强制）。规则编辑（v0.3）按监控对象类型提示指标集。

> **语义域组织（按「语义域 +监控对象类型」组织，不按 Exporter）**：指标库在监控对象类型之下可再按**语义域**（`category`，如 cpu / memory / disk / network / 连接数等）分组——`host_linux` / `host_windows` 类型下 cpu 语义域聚合 `cpu_usage`（可能来自 node_exporter / windows_exporter / Telegraf / 自研 Agent，`source_exporter` 区分来源）；`category` 为**可选字段**（P1 增强，MVP 最小集可不填），用于指标分组浏览与规则编辑提示聚类，**不影响主锚点（监控对象类型）决策**。

| 字段                     | 类型        | UI 展示名        | 说明                                              |
| ---------------------- | --------- | -------------- | ----------------------------------------------- |
| id                     | string    | 指标 ID         | 唯一标识                                            |
| monitor\_types        | \[]object | 所属监控对象类型      | 主锚点：`[{ monitor_type, source_exporter? }]`，指标 ↔监控对象类型多对多；`source_exporter` 为来源采集器标注（解决同名不同义） |
| category               | string    | 语义域          | 可选（P1 增强）：cpu / memory / disk / network 等语义域，用于指标分组浏览与提示聚类；不影响主锚点 |
| exporter\_template\_id | string    | 建议采集器        | 降级为「建议采集器」可空外键（仅技术信息，不作分组锚点；兼容既有 Job/规则引用） |
| metric\_name           | string    | 指标名           | 指标名                                             |
| metric\_type           | enum      | 指标类型         | counter / gauge / histogram / summary / unknown |
| help                   | string    | 指标说明         | 指标 HELP 文本                                      |
| unit                   | string    | 单位            | 单位，如 bytes、seconds、percent                      |
| labels                 | \[]string | 常见标签         | 常见标签键列表                                         |
| is\_builtin            | bool      | 内置指标         | 是否平台内置                                          |
| enabled                | bool      | 启用状态         | 是否启用（用户扩展时可禁用）                                  |

> **MVP 指标库最小集**：内置范围**跟随当前 CMDB 的监控对象类型**（`host` / `middleware` / `application` / `generic_target`），按监控对象类型组织预置静态指标库，最小集如下：
>
> |监控对象类型 | 默认采集实现 | 预置指标数量（约） | 备注 |
> |---------|---------------|--------------------|------|
> | `host_linux` | node-exporter | 30~60 | 含 CPU / 内存 / 磁盘 / 网络 / 文件系统等核心指标；对应 Module_07 `host + os_type=linux` |
> | `host_windows` | windows-exporter | 30~60 | 含 CPU / 内存 / 磁盘 / 网络 / 服务等核心指标；对应 Module_07 `host + os_type=windows` |
> | mysql | mysqld-exporter | 30~50 | 含连接数 / 慢查询 / 缓冲池 / 复制状态等 |
> | redis | redis-exporter | 20~40 | 含内存 / 命中率 / 连接数 / 键数量等 |
> | kafka | kafka-exporter | 20~40 | 含分区 / 消费组 / 延迟等 |
> | snmp | snmp-exporter | 10~20 | 含接口流量 / 状态等 |
> | application\_http | HTTP 抓取（Spring Boot actuator / Go client 等） | 10~20 | 含 `app_http_requests_total`、`go_goroutines` 等；自定义微服务指标集直接挂本类型（来源标注区分），至少含 `probe_success`、`probe_duration_seconds`、`probe_http_status_code` 等拨测指标（blackbox 归 generic_target/application 拨测场景） |
>
> - 预置指标的具体条目以「默认采集配置」实际启用的采集实现为准，可在规则编辑时提示指标名与标签；
> - **筛选**：指标库支持按「资源类别 →监控对象类型」两级筛选（直接按 `monitor_types` 归属过滤）与 `metric_type` 筛选，便于快速定位某类资源可用的监控指标；
> - **同名不同义处理**：规则编辑提示 / 指标库列表对同名指标（不同 `source_exporter`）显示来源区分（如 `http_server_requests_seconds_count`（Spring Boot）/（Go））；
> - **用户扩展保持现有能力**：P1/P2 提供指标库管理页面，支持用户**手动导入**（JSON/CSV 或从已部署 Exporter 抓取的 metrics 元数据）与**更新/覆盖/禁用**内置指标；MVP 阶段内置库为只读静态数据；自定义微服务指标集登记 = 为 `application_http`（或对应监控对象类型）挂接自定义指标（带来源标注）。

### 5.4 采集任务（ScrapeJob）

> 决策依据：design-decisions.md 决策 14 / 15 / 34 / D1 / D2 / D6 / D9 / D16 / D21 / D25 / D26 / D27-2 / 决策 3.55 / 3.56

> 本数据模型由 Module\_01 持有并编辑；MVP 之前由 Module\_07 承载，现已迁移。

| 字段                        | 类型        | 来源                    | UI 展示名          | 说明                                                                 |
| ------------------------- | --------- | --------------------- | ---------------- | ------------------------------------------------------------------ |
| id                        | string    | 平台生成                  | Job ID           | 唯一标识                                                               |
| job\_name                 | string    | 用户输入                  | Job 名称          | Prometheus job\_name                                               |
| monitor\_type            | enum      | Module\_07（资源类别 + 子类型推导）            | 监控对象类型           | 关联监控对象类型（派生的策略维度）                                                           |
| exporter\_template\_id    | string    | CITypeExporterMapping | 默认采集器     | 关联默认采集器（采集实现）；可空（手填模式不选采集器，直接填采集参数）                     |
| network\_domain\_id       | string    | Module\_09            | 网域              | 归属网域；**必填**，MVP 所有 ScrapeJob 必须绑定且仅绑定单一**已纳管网域**（未在 M09 完成监控纳管的网域不可选，保存时校验）；**v0.2 起扩展为网域集合（决策 54）**——一个逻辑 Job 可勾选多个已纳管网域，M09 生成器按域拆分扇出（每域独立 scrape_configs / targets / 变更单），MVP 存量单值自动迁移为单元素集合；「采集 Job」列表页提供网域查询条件（选项 = 已纳管网域） |
| instance\_selection\_mode | enum      | 策略配置                  | 实例选择方式        | manual（MVP）/ **filter（v0.2，决策 53：条件表达式每生成周期实时求值，M07 新增资源匹配即自动纳入，无需编辑 Job）** / service_discovery（v0.3+ 预留）                                         |
| selected\_instance\_ids   | \[]string | Module\_07            | 已选实例           | 手动勾选模式下选中的 Resource ID 列表                                          |
| instance\_filter          | object    | 策略配置                  | 实例筛选条件        | filter 模式下的筛选条件（v0.3+）                                             |
| scrape\_interval          | duration  | 继承/覆盖                 | 采集间隔          | 默认来自 CITypeExporterMapping                                         |
| scrape\_timeout           | duration  | 继承/覆盖                 | 采集超时          | 默认来自 CITypeExporterMapping                                         |
| metrics\_path             | string    | 继承/覆盖                 | 采集路径          | 默认来自采集实现（ExporterTemplate）                                 |
| scheme                    | string    | 继承/覆盖                 | 协议             | 默认来自采集实现（ExporterTemplate）                                 |
| auth\_type                | enum      | 用户                    | 认证类型          | **采集认证/TLS 最小集（MVP 必实现，决策 31）**：`none` / `basic` / `bearer`，默认 `none`（无认证）；全部可选、默认不启用，不影响既有裸 http 场景 |
| username / password       | string    | 用户                    | Basic 认证账密   | `auth_type=basic` 时必填，映射 `basic_auth`；password 仅后端存储/下发，前端不回显明文 |
| token                     | string    | 用户                    | Bearer Token     | `auth_type=bearer` 时必填，映射 `authorization: Bearer <token>` |
| tls\_skip\_verify        | bool      | 用户                    | 跳过 TLS 校验     | https + 自签证书场景；默认 `false`，映射 `tls_config.insecure_skip_verify` |
| ca\_file                  | string    | 用户                    | CA 证书路径       | 可选，映射 `tls_config.ca_file`；`ca_file` 路径基准见 Module\_09 下发约定 |
| label\_template\_id       | string    | Module\_07            | 标签模板          | **Job 级引用**，但生成的 labels 落在 `targets/*.json` 的 **target 级**——按该模板将每个 target 对应资源属性转换为 target 级 labels                                       |
| mapping\_overrides        | \[]string | 策略配置                  | 仅技术信息         | 手动覆盖过映射默认值的参数字段名（scrape\_interval / scrape\_timeout / metrics\_path / scheme / label\_template\_id）；「同步映射默认值」时跳过这些字段；**不含 `port`**（MVP 端口不进快照，见下「端口不在 Job 层的理由」） |
| relabel\_configs          | \[]object | 策略配置                  | 仅技术信息         | 高级 relabel 规则（P2）                                                  |
| job\_type                 | enum      | 策略配置                  | 采集 / 拨测       | `standard` / `blackbox`，默认 `standard`                              |
| blackbox\_module          | string    | 策略配置                  | 拨测模块          | `job_type=blackbox` 时必填，引用 `blackbox.yml` 模块名，如 `http_2xx`         |
| blackbox\_targets         | \[]BlackboxTarget | 策略配置                  | 拨测目标          | `job_type=blackbox` 时必填；探测目标对象列表（含目标地址、协议、完整 URL），结构见下方「BlackboxTarget 结构」 |
| enabled                   | bool      | 用户                    | 启用状态          | 是否启用；与 `draft_status` 正交：草稿也可标记启用意图，但 `draft_status=draft` 时不参与配置生成                                       |
| draft\_status             | enum      | 用户/策略配置            | 草稿状态          | `draft`（编辑中；**字段 MVP 已落库、默认 `ready`，「保存草稿」交互 v0.3 开放**）/ `ready`（待下发）；默认 `ready`（**默认「提交生效」**）；**draft 单向流转 draft→ready，ready 不再回退**（仅新建阶段可为 `draft`，提交生效转 `ready`）；**例外：新建未生效 Job 随 M09 变更单废弃时，由系统自动回退为 `draft`**（决策 43-3）；已生效对象的后续修改直接更新主字段、走正常变更管线；仅 `ready` 状态的对象进入 M09 配置生成候选集 |
| change\_status            | enum      | Module\_09（回写）      | 下发状态          | `pending`（存在 M09 待确认变更单）/ `confirmed`（变更单已确认，待下发）/ `deployed`（已下发生效）/ `none`（无在途变更）；**MVP 阶段 M09 回写 `pending/confirmed/none/deployed`**（`deployed` 提前到 MVP，决策 31-M2），M09 依据 ConfigDeployment success 记录回写，消除「已生效 vs 无变更」歧义 |
| created\_at / updated\_at | datetime  | 平台                    | 仅技术信息         | 创建/更新时间；保存草稿同样更新 `updated_at`，但 M09 仅当 `draft_status=ready` 时才纳入源数据版本触发重算                            |

> **Job 是「关联三者」的运行时实例**：ScrapeJob 同时关联 **监控对象类型**（采什么）、**采集实现**（怎么采，`exporter_template_id` 引用、可空手填）、**实际参数覆盖**（端口 / 路径 / 协议 / 间隔 / 超时，快照 + 覆盖 + 手动同步）。Job 在创建时**引用**采集实现作为默认值预填，但监控对象类型**不拥有**采集实现（见 5.1 职责边界）——从 node_exporter 切到 Telegraf 只需改 Job / 映射，指标库不受影响。

> **网域约束（技术约束，不是管理偏好）**：
>
> - **网域绑定是技术约束，不是管理偏好**：隔离网域内目标只能被本网域的边缘采集器 / Prometheus 抓取（网络可达性）；Module_09 按网域生成并下发配置、断网自治——Job 不绑网域则配置无处下发。共性监控对象类型跨网域重复配置的痛点由既有机制收敛：映射层为网域无关全局预设（见 5.1）+ v0.2 网域覆盖表 + v0.2 Job 网域集合 + M09 按域扇出（决策 54，跨网域复用主场景）。
> - 所有 ScrapeJob（`job_type=standard` 与 `job_type=blackbox`）必须绑定且仅绑定一个**已纳管网域**的 `network_domain_id`，禁止跨网域共享采集目标/拨测目标；未在 M09 完成监控纳管的网域不可作为 Job 归属网域（保存时校验，提示用户「请先到网域管理完成纳管」）。
> - `instance_selection_mode=manual` 实例选择模式下，`selected_instance_ids` 选中的 Resource 必须与 Job 同属一个网域，保存时校验。
> - **v0.2 起（决策 54）**：单网域约束放宽为「网域集合」——Job 可勾选多个已纳管网域；`selected_instance_ids` / 拨测目标按各自资源归属网域自动归组，M09 生成器按域拆分扇出（每域独立 scrape_configs / targets / 变更单）；实例与网域的匹配校验由「全域同域」变为「逐域同域」（语义不变）。MVP 行为不变（单网域）。
> - **冻结（禁用）网域校验（MVP，决策 30）**：冻结网域**禁止新建 Job**（保存时 `bad_request`，提示该网域已冻结）；存量 Job **禁止新增该域实例**（`selected_instance_ids` 追加该域实例时校验拒绝），**允许移除该域实例、禁用/编辑 Job**（与「冻结不阻断存量采集、仅拒绝新纳管」的 M06 语义一致，见 M06 5.1 禁用冻结语义）。
> - **网域呈现收敛**：M01 内仅 ScrapeJob 绑网域（默认采集配置 / 技术指标库 / 业务指标库 / 告警规则均网域无关），**不提供顶部全局网域切换器**；「采集 Job」页改为**列表内网域查询条件**（下拉，选项 = 已纳管网域 `is_monitored=true`）+ 表单内 `network_domain_id` 必填（实例候选随之收敛）；全局网域概念由 M06 / M09 承载；将来 M01 出现第二个网域感知功能（如 v0.4 `scope=edge` 边缘规则）时再评估是否恢复全局切换器。
>
> **`is_monitored` 过渡说明**：网域 `NetworkDomain.is_monitored` 字段由 Module\_09 维护；MVP 阶段由 seed 将 `default` 及示例 edge 域**预置为已纳管（`true`）**，保证「采集 Job」创建动线开箱可用；正式纳管流程仍在 M09。

> **实例候选自动收敛（MVP）**：
>
> - Job 表单选定 `monitor_type` 与 `network_domain_id` 后，实例候选**自动收敛为「同监控对象类型 + 同网域」的资源**（与网域约束天然一致，避免选到跨网域无效项）；
> - **`offline` 实例显示但置灰不可选（MVP 必实现，决策 29）**：候选集中 `Resource.status=offline` 的实例照常展示（保证下线台账可见），但**置灰禁止勾选**（`maintenance` 排除口径与 [Module_07 8.1](Module_07_Monitoring_Object_Management.md) 一并对齐、MVP 不保证）；已选实例事后转 `offline` 的，M09 配置生成跳过（`offline` 后下一配置生成周期即从 `targets/*.json` 移除）；
> - 候选列表提供**一键全选 / 反选**与**关键字筛选**（实例名 / IP / 应用名），用户可在此基础上手动调整勾选；
> - 勾选结果仍持久化到 `selected_instance_ids`（manual 语义不变），仅候选呈现更智能——比 v0.3+ 的 `filter` 条件表达式模式更轻，不引入动态筛选规则；
> - 目的：**创建 Job 时少选实例、自动带出**，同时保证「模板 ↔ 实例」关联可见（模板按资源类别隐式关联，见 Module\_07 3.2 / 5.3）。

> **filter 模式字段语义（v0.2，决策 53 由 v0.3+ 提前）**：`instance_filter` 的筛选字段 = **Resource 属性字段**（`env` / `cluster` / `app_name` / `business_domain` / `service_name` / `middleware_type` 等，即标签模板映射的**源字段**），筛选**不写任何标签**、与标签管理正交（选择器 vs 描述器，见 Module\_07 5.3「标签配置唯一入口原则」）：
>
> - **label 仅作 UI 别名，自动派生、无需手动维护**：筛选器展示字段时，若该字段在当前监控对象类型标签模板存在映射（如 `app_name → app`、`business_domain → biz`），则别名列显示 label 名（如「应用（app）」「业务类型（biz）」），由模板 Mapping 只读派生；无映射字段直接显示字段名；
> - **筛选底层始终是字段**：**不用模板产出的 label 名做筛选键**——system 标签实时计算不落库 + 模板变更穿透 Job，绑定 label 名会导致筛选语义随模板漂移；模板变更后别名自动跟随，但筛选结果不变；
> - 筛选结果预览（匹配实例清单）后写入 `instance_filter`，`instance_selection_mode=filter` 时生成配置按表达式实时求值（v0.2）；
> - **新增资源自动纳入（决策 53 核心语义）**：filter 模式下 Job 不持有静态实例清单，M09 每次配置生成周期对条件表达式重新求值——M07 新导入 / 同步的资源匹配条件即自动进入 targets（无需编辑 Job），资源下线或属性变化导致不再匹配时自动移出；「待采集」回显（5.10）对自动纳入的新实例同样生效。

> **v0.3+ 服务发现模式预留（微服务动态实例）**：微服务（K8s 扩缩容、实例漂移）场景下，静态 `selected_instance_ids` 手动勾选无法覆盖动态目标。预留演进（v0.3+ 落地，与 Module\_07 5.12 B `prometheus_builtin` / Module\_04 `KubernetesProvider` 对齐）：
>
> - `instance_selection_mode` 扩展 **`service_discovery`**：Job 绑定服务发现源（K8s Service / Endpoints / Nacos 等），目标由发现结果 + `relabel_configs`（`__meta_*` → `app` / `service` 标签）动态生成，**不落 `selected_instance_ids`**；
> - 默认采集配置（类型 → 采集实现 + 标签模板）**采集实现层复用**——映射与"目标从哪来（静态 / 服务发现）"解耦，服务发现模式仅替换 Job 的目标选择方式；
> - 关联键沿用稳定业务标识（`app` / `biz`，不用 `instance`），与 Module\_07 5.15 业务指标标签规范一致。
> - **容器实例资源监控定位（v0.2 口径）**：v0.2 容器实例资源监控走 **cAdvisor 方案**——每台虚机部署 cAdvisor exporter，作为一个普通采集 Job 绑定主机类资源 + filter 模式自动纳入新主机；容器发现由 cAdvisor 在宿主机内部完成，平台不感知容器个体，**不需要 docker_sd**；
> - `docker_sd_configs` / `kubernetes_sd_configs` 降级为 v0.3+ 预留，仅当需要**直采容器内应用的 /metrics**（容器已发布端口或 host network 场景）时启用。

> **blackbox Job 说明**：
>
> - `selected_instance_ids` 在 `job_type=blackbox` 时可置空，或复用为 `blackbox_targets` 的扁平存储（其拨测目标同样受上文「网域约束」，须归属本网域）。

> **blackbox 不占用监控对象类型 / 采集器语义**：`job_type=blackbox` 时 `monitor_type` / `exporter_template_id` **留空**（不伪装为 `application_http` + `et-blackbox`）——拨测语义由 `job_type` + `blackbox_module` + `blackbox_targets` 完整承载；列表「监控对象类型」列显示 `-`。**验收与统计口径按 `job_type` 而非 `monitor_type` 计算**（如 application_http 覆盖率只统计 `job_type=standard` 且 `monitor_type=application_http` 的 Job），避免 blackbox 被错误计入某监控对象类型的覆盖率。

> **BlackboxTarget 结构**：
>
> | 字段 | 类型 | 说明 |
> |------|------|------|
> | target | string | 探测目标地址 / IP / host:port，如 `10.0.1.11`、`redis-cache-01.mw:6379` |
> | protocol | enum | 探测协议：http / https / tcp / icmp / dns；须与 `blackbox_module` 的适用协议一致（如 `http_2xx` → http/https，`icmp_ping` → icmp，`tcp_connect` → tcp，`dns_query` → dns） |
> | url | string | 完整 URL（HTTP/HTTPS 模块时可选补充，如 `https://api.example.com/health`；`target` 已含完整地址时可为空） |
>
> 同一 blackbox Job 内可包含不同 `protocol` 的 target（均归属本 Job 网域）；[Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 生成 `blackbox.yml` 时按 `blackbox_module` 生成对应探测 module，并将对应 `static_configs.targets` 填充为 `blackbox_targets[].target`（HTTP/HTTPS 时优先使用 `url`）。

> **参数快照与标签模板继承**：
>
> - `scrape_interval` / `scrape_timeout` / `metrics_path` / `scheme` 等参数在创建时**继承映射默认值（含网域覆盖）预填**，用户可覆盖，保存后 Job 持有**快照值**；映射后续变更不影响本 Job（保护存量），需用户手动「同步映射默认值」刷新（**仅刷新 `mapping_overrides` 之外的字段**，详见 5.1）；
> - `label_template_id` 创建时**自动预填**为映射的默认标签模板，**允许覆盖（换用其他模板）**；LabelTemplate 由 Module\_07 维护，本模块只读引用。Job 表单中选择标签模板后**内联只读展示映射内容**并提供「前往标签模板管理」跳转（UX 说明见 5.1「标签模板关联 UX」）。
>
> **生效参数层叠解析**：Job 保存时按「层叠默认链」将留空字段逐层继承到下一层、落入全局兜底常量（`DefaultScrapeInterval=15s` / `DefaultScrapeTimeout=10s` / `DefaultMetricsPath=/metrics` / `DefaultScheme=http`），保存即解析为生效快照（决策 14 快照语义不变）；层叠链详见 5.1「层叠默认链」。

> **默认采集器显式模式**：`exporter_template_id` **可空**（`application_http` / `blackbox` / 手填场景），但 UI **不能是"下拉留空"**——Job 表单中采集器选择为「**使用默认采集器（推荐）**」/「**手填采集参数**」显式二选一（Radio 切换），避免用户把"下拉留空"理解为"不需要采集器"；手填模式不选采集器、直接填写采集参数（间隔 / 超时 / 协议 / 路径）。

> **端口不在 Job 层的理由**：`scrape` 端口**不纳入 `ScrapeJob` 可覆盖字段**——端口是 target 级参数，且直接影响 Prometheus 的 `instance` 标签（ip:port），端口 / 漂移会使其不稳定；`instance` 仅作为 **Prometheus 抓取目标身份**，不作为业务关联身份（业务关联走 `app` / `biz` / 稳定资源身份标签，见 5.1）。**端口口径（MVP 决策 46 + v0.2 实例级覆盖落地）**：端口**不进 `ScrapeJob` 快照**（`mapping_overrides` 亦**不含 `port`**），由 M09 生成器按 **`Resource.scrape_port`（实例自带，v0.2）→ 网域覆盖表 `CITypeExporterMappingOverride` → `CITypeExporterMapping.default_port` → 回落 `ExporterTemplate.default_port`** 优先级解析；**Job 级端口映射表明确不做**——与 filter / service_discovery 动态纳入模式天然冲突（动态实例无法预配端口），且「台账归别人管、采集团队只有 Job 配置权限」的组织场景经确认不存在。端口分层解决网域 / 实例级差异：v0.2 通过 `CITypeExporterMappingOverride` 解决网域级端口（含安全 / 高危端口场景），实例级端口由 M07 Resource 可选 `scrape_port` 承载（v0.2，见 5.1「端口一致性说明」第 3 层）。Job 表单只提供 Job 级统一参数：间隔、超时、协议、指标路径。

> **网域选择器空态引导**：`network_domain_id` 下拉选项**仅包含 M09 已纳管网域**（`is_monitored=true`）。若当前无已纳管网域，选择器空态显示「暂无已纳管网域，请先到网域管理完成纳管」并**内联跳转 M09**；保存时仍保留 `bad_request` 校验作为兜底（见 6.2.2）。

> **手动选择含义**：`instance_selection_mode=manual` 的 UI 文案「手动选择」指"**手动勾选具体实例**"（候选按类型 + 网域自动收敛后手动调整），**而非"手动选择采集器"**——采集器选择是「使用默认 / 手填参数」二选一，两者不混淆；术语映射同步（见第 10 章）。

> **标签模板引用体验增强**：
>
> - **创建引导联动**：Job 创建时 `label_template_id` 自动预填为映射的默认标签模板（缺省时兜底同资源类别 `is_default` 模板）；若该监控对象类型尚无标签模板（`has_label_template=false` 且类别无默认模板），则 Job 表单中「标签模板」字段显示「待配置」提示，引导用户先前往默认采集配置区完成模板创建（见 5.1「标签模板创建引导」），或直接提供「立即创建」快捷入口（复用创建抽屉）；
> - **补配动作收敛**：Job 表单缺模板 Alert 的**主按钮 = 打开该映射行的「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`）**（带入监控对象类型 / 资源类别 / 默认采集器只读上下文，落位即开）；「前往标签模板管理（M07）」**不再作为 Alert 次级入口**（仅保留在轻量抽屉空态）；
> - **标签模板选择器增强**：Job 表单的标签模板下拉选择器改为**卡片式选择**——每个选项展示模板名称 + 资源类别 + 映射数量概览（如「主机 Linux 默认模板 · `host_linux` · 5 个映射」），选中后内联展示映射明细小表格；提供「刷新模板列表」按钮（映射新增/变更后无需关闭表单即可刷新）；
> - **更换模板体验**：已保存 Job 的编辑表单中，标签模板字段支持「更换」操作——点击后弹出模板选择器，仅展示同资源类别的可用模板，选中后自动更新内联预览；更换操作不影响已选实例列表。

> **标签配置引导落地（原型对齐）**：
>
> - **Job 表单主引导**：「标签模板」为空且对应监控对象类型映射未配置模板（`has_label_template=false`）时，显示「该监控对象类型尚未配置标签模板」提示，**主引导为「立即补配」（打开该映射行「更换 / 补配」轻量抽屉）**；「前往标签模板管理」不再并列于 Alert（仅轻量抽屉空态出现）；
> - **Job 列表与详情**：对引用无标签模板映射的 Job 显示「标签待配置」提示（列表列 / 详情视图），点击可跳转默认采集配置区；
> - **映射页补配入口**：默认采集配置列表「待配置」Badge 可点击重新触发补配引导，操作列提供「补配标签模板」按钮（见 5.1「标签模板创建引导」）。

> **标签模板引用语义澄清（对齐 Module\_07 标签治理）**：
>
> - `label_template_id` 的「允许覆盖」= **允许 Job 换用其他已存在的模板（引用级）**，用于同一监控对象类型不同监控场景（如 mysql 主/从用不同标签集）；**不提供 Job 内手写标签键值**（ScrapeJob 无 labels 字段）；
> - **标签内容编辑唯一入口在 Module\_07**：类型级改标签 → 编辑/新增模板；实例级差异 → 资源详情 `user` 标签；Job 仅引用模板，不编辑标签内容；
> - **不引入实例级模板**（每实例选不同模板）：MVP 与 v0.2+ 均不引入，避免配置入口分散导致歧义与溯源困难（见 Module\_07 5.3「标签配置唯一入口原则」）。

> **参数继承来源视觉标记**：
>
> - 编辑表单中，`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme`、`label_template_id` 五个继承字段的 label 旁增加 inline Tag，标记当前值的来源状态：
>   - **继承自映射**（灰色 Tag）：当前值来自默认采集配置的默认值，用户未手动修改；
>   - **已覆盖**（蓝色 Tag）：用户手动修改过该字段值，同步映射默认值时跳过；
>   - **待同步**（橙色 Tag）：映射默认值已变更且该字段未被用户覆盖，需手动执行同步刷新；
> - 列表页「参数同步」列增强：增加覆盖字段数量概览（如「2 个字段已自定义」）；
> - 详情视图同步：Job 详情 Descriptions 中每个参数字段同样显示对应的继承/覆盖/待同步标记。

> **下发状态感知（MVP 单域动线闭环）**：采集 Job 保存后到 M09 生效之间存在「变更单确认」gap，本模块需让用户感知动线去向——
>
> - **保存/启停/删除成功提示**：由纯 toast 改为「**变更将由 M09 生成变更单，需确认后生效**」+「**前往配置变更确认**」跳转按钮（引导到 M09 完成发布审批）；
> - **「状态」聚合列（MVP 四态占位）**：「采集 Job」列表新增「状态」聚合列，按以下规则展示四态：
>   - **草稿**（`draft_status=draft`，MVP 阶段无实例，状态列标签灰显并 Tooltip「v0.3 支持保存草稿」，状态筛选器中「草稿」选项禁用；v0.3 起真实草稿对象显示为正常 Tag 且可筛选）；
>   - **待下发**（`draft_status=ready` 且 `enabled=true` 且 `change_status=pending/confirmed`：存在 M09 待确认或已确认但未最终下发的变更单）；
>   - **已生效**（`draft_status=ready` 且 `enabled=true` 且 `change_status=none/deployed`：无在途变更或已确认并下发成功；`deployed` 提前到 MVP（决策 31-M2），确认下发成功后由 M09 依据 ConfigDeployment success 回写 `deployed`）；
>   - **已停用**（`enabled=false`）；
> - **数据回写来源**：`change_status` 由 M09 变更单 / 下发记录状态回写（pull 模式，列表查询时随 `GET /api/v1/scrape-jobs` 返回）；`deployed` 提前到 MVP（决策 31-M2），MVP 阶段 `change_status` 取 `pending/confirmed/deployed/none`，deployed 由 M09 依据 ConfigDeployment success 回写，消除「已生效 vs 无变更」歧义；
> - **规则列表同用该下发状态列（MVP 起）**：规则经「规则编辑」页整文件挂载（`content_mode=yaml_passthrough`）落库后，保存 / 启停 / 删除即进入 M09 变更检测，`change_status` 与采集 Job 同源同机制展示；v0.3 随字段化编辑增强（同 5.5）。
>
> **pending 期锁定（MVP）**：`change_status=pending`（待生效，存在 M09 待确认变更单）期间，**禁止编辑 / 启停 / 删除该 Job**（编辑表单 / 操作列禁用并提示「存在待确认变更单，请先完成确认或废弃」）；**解锁路径**：M09 变更单**确认（→ confirmed/deployed）**或**废弃**后解除锁定。

### 5.5 规则编辑模型（MonitoringRule）

> 决策依据：design-decisions.md 决策 35 / D28

> **MVP 启用说明（规则文件挂载形态）**：MVP 阶段 `MonitoringRule` 即作为规则的**实际载体**（不再仅是预留定义）——规则内容以**整文件透传**（`content_mode=yaml_passthrough`，上传 / 粘贴完整 `rules.yml`）方式经本模块「规则编辑」页挂载入库，保存即 `draft_status=ready` 进入 Module_09 变更检测管线，由 M09 生成 / 确认 / 下发 `rules.yml`——**保证规则变更同样走 M09 统一配置下发闭环，不绕过 M09**（对齐决策 38-1：规则变更属人工确认档，需 reload）。v0.3 起升级为**字段级结构化编辑**（`content_mode=structured`，类 YAML 表单 + PromQL 校验 + 指标预览，见 3.2），M09 生成逻辑结构化优先、透传兜底。

| 字段                        | 类型                  | 来源             | UI 展示名      | 说明                            |
| ------------------------- | ------------------- | --------------- | ------------ | ----------------------------- |
| id                        | string              | 平台生成         | 规则 ID       | 唯一标识                          |
| content\_mode             | enum                | 用户/策略配置     | 内容形态       | `yaml_passthrough`（MVP：整文件透传）/ `structured`（v0.3+：逐条字段化编辑）；MVP 默认 `yaml_passthrough` |
| rule\_content             | text                | 用户输入         | 规则文件内容   | `content_mode=yaml_passthrough` 时**必填**：完整 `rules.yml` 内容（含 `groups`），上传 / 粘贴保存；M09 生成 `rules.yml` 时原样并入该内容；`structured` 模式不填 |
| name                      | string              | 用户输入         | 规则名称       | `yaml_passthrough` 模式为展示名（可空，落库后可提取 `groups` 数展示）；`structured` 模式为规则名 |
| rule\_type                | enum                | 用户输入         | 规则类型       | alerting / recording（`structured` 模式） |
| expr                      | string              | 用户输入         | 表达式        | PromQL 表达式（`structured` 模式）                    |
| duration                  | duration            | 用户输入         | 持续时间       | `for` 字段，仅告警规则（`structured` 模式）                |
| labels                    | map\<string,string> | 用户输入         | 告警标签       | 规则 labels（UI 展示名用「告警标签」，与标签模板的「目标标签」区分；`structured` 模式） |
| annotations               | map\<string,string> | 用户输入         | 告警说明       | 规则 annotations，仅告警规则（`structured` 模式）          |
| monitor\_type            | enum                | M07 资源推导     | 监控对象类型       | 适用监控对象类型（派生的策略维度，透传模式可空）                      |
| exporter\_template\_id    | string              | 映射            | 默认采集器     | 关联默认采集器（采集实现），用于指标提示（可空，规则按监控对象类型提示指标集）         |
| scope                    | enum                | 用户/策略配置     | 求值范围       | `central` / `edge` / `both`；MVP~v0.3 固定 `central`（中心求值），`edge`/`both` 由 Module\_09 在生成 `rules.yml` 时按作用域下发到中心或边缘域（v0.4+） |
| enabled                   | bool                | 用户             | 启用状态       | 是否启用；由 Module\_09 管理规则是否参与配置生成（`rules.yml` 只包含 `enabled=true` 且 `draft_status=ready` 的规则）；透传模式禁用即从生成中摘除 |
| draft\_status             | enum                | 用户/策略配置     | 草稿状态       | `draft` / `ready`，默认 `ready`；MVP 文件挂载默认 `ready`（透传内容保存即进入 M09 变更管线）；v0.3 字段化编辑开放「保存草稿」；**仅新建阶段可为 `draft`**——PromQL 半成品可先存草稿，提交生效时做完整 PromQL 校验并转 `ready`，之后不再回退；已生效规则的后续修改直接走正常变更管线 |
| change\_status            | enum                | Module\_09（回写） | 下发状态       | `pending` / `confirmed` / `deployed` / `none`；**MVP 随规则文件挂载启用**——规则保存 / 启停 / 删除即触发 M09 变更单（同采集 Job 动线）；`change_status` 随 M09 **确认 / 下发 / 废弃**回写（`pending→confirmed→deployed` 或废弃，与采集 Job 同机制，见 5.4「下发状态感知」）；v0.3 随字段化编辑增强为逐条 |
| created\_at / updated\_at | datetime            | 平台             | 仅技术信息      | 创建/更新时间；保存草稿更新 `updated_at`，但 M09 仅当 `draft_status=ready` 时才纳入源数据版本触发重算 |

> **Labels/Annotations 语义说明与必填状态**：
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

> **规则变更引导确认（MVP 随规则文件挂载启用，v0.3 随字段化编辑增强）**：规则变更（`rules.yml` 变化）必须 reload，属 [Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 决策 38-1 的**人工确认档**（非 target 自动生效档）——
>
> - **保存 / 启停 / 删除后引导（MVP）**：规则文件挂载的保存 / 启停 / 删除操作成功提示「变更将由 M09 生成变更单，需确认后生效」+「前往配置变更确认」跳转（与采集 Job 同一套机制）；
> - **草稿与提交生效（v0.3）**：规则编辑 UI 新建规则时提供「保存草稿」与「提交生效」两种保存模式；草稿态允许 PromQL 半成品暂存，不做完整校验；提交生效时调用 Module\_02 进行 PromQL 语法/指标存在性校验，通过后 `draft_status` 转 `ready`；**草稿仅存在于新建阶段**，已生效规则的修改直接走正常变更管线；
> - **规则列表「下发状态」列**：展示 `change_status`（`pending`=待确认 / `confirmed`=已确认待下发 / `deployed`=已下发生效 / `none`=无变更，来自 M09 变更单与下发记录状态），与采集 Job 列表同源同机制；**MVP 即提供规则列表**（整文件挂载 + 下发状态），原型 RulesPage 同步承载文件挂载形态，v0.3 升级为逐条字段级表单。

> **scope 业务场景说明**：
>
> - **MVP~v0.3**：`scope` 固定 `central`（中心统一求值），用户无需配置 scope；
> - **`edge` / `both`（v0.4+，P2，由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 支持）**：核心场景为**断网自治告警**——物理隔离网域断网时中心无法求值，规则在边缘 vmalert 本地求值并走**本地通知通道**（本地飞书/钉钉 webhook），典型规则为主机存活 / 进程崩溃 / 磁盘满 / 本地服务不可用；
> - **`both`**：用于边缘快速响应 + 中心统一聚合，需以标签区分求值域（如 `eval_domain`）防止重复告警；
> - **`central`**：用于引用跨网域数据或全局聚合的规则；
> - **不适合 `edge` 的规则**：引用跨网域数据的规则、需长历史窗口的复杂计算、全局业务 SLA。

> **默认采集配置联动**：规则编辑中「监控对象类型」同样采用两级级联选择；选中细粒度监控对象类型后，`exporter_template_id` 自动带出该类型映射的默认采集器（可覆盖 / 可手填采集参数），并据此（按监控对象类型指标集 + 来源标注）过滤指标预览与 PromQL 校验范围。

> **多规则合并与组织**：多条仍 `enabled=true` 且 `draft_status=ready` 的规则记录，由 M09 生成器按 `rule_content` 内 **`groups` 解析合并为单份 `rules.yml`**；**组名（group name）全局唯一**——同名组请写在同一条规则内容内（避免生成时合并冲突丢规则）。`monitor_type` 作为**组织 / 筛选维度**（可空、透传，不参与 `rules.yml` 生成逻辑）。

> **规则启停 / 草稿 / 锁定口径**：
>
> - **「停用」可编辑提级 MVP**：规则**停用可编辑**（复用「编辑」模式，`enabled=false` 即从后续 `rules.yml` 生成中摘除），**不新增独立携带 `enabled` 的字段集**（沿用 `MonitoringRule.enabled`）；
> - **规则草稿（`draft`→`ready` 批量提交）推迟至 v0.3**：`MonitoringRule` 的「保存草稿 / 提交生效 + 批量提交」能力随 **v0.3** 字段化编辑交付，MVP 阶段规则仅 `ready`（文件挂载保存即 `ready`）；
> - **规则 pending 期锁定（同采集 Job）**：`change_status=pending` 期间**禁止编辑 / 启停 / 删除**该规则；解锁路径同采集 Job（M09 变更单确认或废弃，见 5.4「pending 期锁定」）。

### 5.6 Exporter 安装/注册登记（ExporterInstallationConfirmation，可选）

> 决策依据：design-decisions.md 决策 7 / 决策 47-1

> **定位修订（决策 47-1）**：本记录由「生成 target 的前置闸门」降级为**可选登记**——纯留痕与人工背书（谁承诺装好了、工单号），**不再阻断 target 生成**：`unconfirmed` 实例照常进入 M09 配置生成。「是否采到数据」的事实反馈由 5.10 采集状态回显承担（`up` / `down` 是真相反馈，登记只是口头背书）。

| 字段                     | 类型       | UI 展示名        | 说明                                                  |
| ---------------------- | -------- | -------------- | --------------------------------------------------- |
| id                     | string   | 登记记录 ID      | 唯一标识                                                |
| resource\_id           | string   | 资源            | 关联 Resource ID                                      |
| scrape\_job\_id        | string   | 采集 Job     | 关联 ScrapeJob（登记主键维度：`resource_id` × `scrape_job_id`）          |
| status                 | enum     | 安装状态         | `unconfirmed`（未登记，默认，**不影响 target 生成**）/ `confirmed`（已登记）/ `not\_applicable`（无需 Exporter）                    |
| confirmed\_by          | string   | 登记人           | 登记人（可选背书留痕）                                                 |
| confirmed\_at          | datetime | 登记时间         | 登记时间                                                |
| notes                  | string   | 备注            | 备注（线下安装记录、工单号等）                                     |
| actual\_port           | int      | 实际监听端口       | {P1} 登记实例上 exporter 实际监听端口；配置生成时与生效端口（映射 default\_port / 网域覆盖）不一致则提示，不自动改配置 |

> 该状态可作为独立表存在，也可在 Resource 上冗余展示。MVP 提供可选的「标记已安装」登记动作，不强制。

> **职责边界**：安装登记是"状态登记 + 人工背书"，**不承担端口编辑**（登记主键维度为 `resource_id` × `scrape_job_id`）；实际监听端口仅作登记与一致性提示，端口不一致的解决手段见 5.1「端口一致性说明」（映射层 default\_port 可编辑 → 网域覆盖 v0.2 → 实例级端口覆盖 v0.2，Resource 级 `scrape_port`）。

> 该登记针对**独立进程型采集实现**（含平台内置 Exporter 与用户登记的自研采集器）；`job_type=blackbox` 的拨测 Job 以及 `application_http` 业务指标端点抓取**不涉及目标实例的安装登记**（前者由 blackbox exporter 自身进程负责，后者无独立 exporter 进程，`not_applicable`）。边缘 blackbox exporter 进程/容器实例的健康状态由 [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的 EdgeAgent 维护。

### 5.7 采集目标（ScrapeTarget）【运行时数据，展示职责已移交】

> 决策依据：design-decisions.md 决策 7

| 字段                  | 类型       | 来源                   | UI 展示名        | 说明                              |
| ------------------- | -------- | -------------------- | -------------- | ------------------------------- |
| id                  | string   | 平台生成                 | 仅技术信息        | 唯一标识                            |
| resource\_id        | string   | CMDB                 | 资源            | 关联的 CMDB 资源 ID                  |
| resource\_category | enum     | CMDB（资源类别） | 资源类别         | host / database / middleware / application / generic\_target（五大类） |
| network\_domain\_id | string   | CMDB / NetworkDomain | 网域            | 所属网域 ID                         |
| job                 | string   | Job 配置               | Job            | Prometheus job\_name            |
| instance            | string   | CMDB / 拨测 URL        | 实例            | IP:Port 或健康检查 URL               |
| labels              | map      | CMDB + 标签模板          | 标签            | Prometheus labels               |
| status              | enum     | Prometheus           | 状态            | up / down / unknown             |
| last\_scrape        | datetime | Prometheus           | 最后抓取         | 最近抓取时间                          |
| last\_error         | string   | Prometheus           | 最近错误         | 最近错误信息                          |
| probe\_success      | float    | Blackbox             | 拨测成功         | 拨测成功标识（仅拨测目标）                   |
| probe\_duration     | float    | Blackbox             | 拨测耗时         | 拨测耗时（仅拨测目标）                     |

> **说明**：`ScrapeTarget` 由 Module\_01 的策略配置与 Module\_09 生成的配置共同决定，但**独立的运行时状态页面**由 [Module\_02: 查询中心](Module_02_Query_Center.md) 负责；本模块仅在 Job 上下文做**只读回显**（实例采集状态列 + 在线数汇总，消费 M02 `/api/v1/targets` 代理，见 5.10，决策 47-2）。

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

### 5.9 业务指标库（BusinessMetric）

> 决策依据：design-decisions.md 决策 5 / 6

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
| business\_domain | string | ✅ | 所属业务域 | 归属业务类型（payment / data-api），与 Module\_07 `business_domain` 对齐（v0.3+ 关联独立业务目录实体） |
| app\_name | string | ❌ | 关联应用 | 产出该指标的关联应用服务（值 = 平台 `app_name`） |
| threshold\_suggestion | string | ❌ | 建议阈值 | 业务负责人建议的告警阈值（如"成功率 ≥ 99.9%"），作为 v0.3+ 规则编辑的参考输入 |
| owner | string | ✅ | 业务负责人 | 指标语义责任人（**必填**，语义所有权不随录入者转移） |
| register\_source | enum | ✅ | 登记来源 | `self`（业务负责人自录）/ `agent`（运维工单代办，owner 仍指向业务负责人） |
| status | enum | ✅ | 埋点状态 | `pending`（待埋点）/ `instrumented`（已埋点，业务侧代码已输出）/ `online`（已上线，运维确认采集落地） |
| created\_at / updated\_at | datetime | ✅ | 仅技术信息 | 创建 / 更新时间 |

> **状态机与推进分工**：`pending` → `instrumented` → `online`，推进者按职责分工——**语义编辑权（description / threshold / owner）仅业务负责人或其委托**；`pending`（登记，自录或代办；代办后可选「请业务负责人确认语义」环节，确认前列表标「待确认」）；`instrumented`（业务侧埋点完成，业务负责人标记）；`online`（运维确认采集落地，指标可查）。`online` 后可回退 `instrumented`（采集下线）。

> **登记模式（登记动作 ≠ 语义所有权）**：登记不绑定角色——**业务负责人自录（`self`）或运维接工单代办（`agent`）均可**；`owner` 字段必填且指向业务负责人（语义所有权不随录入者转移）；运维代录后可选「请业务负责人确认语义」，业务人员不熟悉平台时由运维代录、语义责任不丢失。

> **业务域聚合视图版本归属**：MVP 提供**轻量业务视图**（业务指标库页内 Tab「登记表 / 业务视图」）——按 `business_domain` 自动聚合成员（应用服务/微服务 + 中间件 + 主机，从 Resource.business_domain 归并）+ 业务指标清单 + 埋点/采集落地状态，把"微服务是业务域的实现载体、业务域是微服务的语义聚合"在 MVP 即可感知；**v0.3+ 独立业务目录**（Module\_07 决策 3.46）提供完整业务域聚合视图——成员列表 + 健康度看板（M01-BIZ-02）+ 采集覆盖视图。**业务语义层不改变采集配置逻辑**（采集仍按监控对象类型 + 实例选择），仅影响视图 / 查询聚合（`biz`）/ 告警分组（v0.3+）/ 批量操作入口。

> **采集落地链路**：登记表「采集落地」列与业务视图展示业务指标 → 关联应用（`app_name`）→ 采集 Job（`ScrapeJob.selected_instance_ids` 覆盖该应用资源）→ 指标可查（查询中心）的落地链路，`online` 状态显示关联 Job；无关联 Job 的 `online` 仅标注"已上线 · 指标可查"。

> **MVP / v0.3+ 分层**：MVP = 最小登记表（自录 + 代办均可，`owner` 必填保证职责可溯）；v0.3+ = 独立业务负责人角色入口（配合 Module\_06 权限）+ 业务健康度看板 + 业务域聚合视图。

### 5.10 Job 实例采集状态回显（只读消费 Module_02）

> 决策依据：design-decisions.md 决策 47-2

> **定位**：配置闭环的「保存后验证」环节——用户保存 / 变更下发后，在 Job 详情与编辑抽屉直接看到已选实例的真实采集状态，获得「是否采到数据」的知情权；未采到的实例引导关注采集器安装与网络连通。**本小节为展示口径，非本模块持有的持久状态**；数据源 = [Module_02](Module_02_Query_Center.md) `GET /api/v1/targets` 代理（注入租户/网域上下文），本模块不直连 Prometheus。

**外层汇总指标（Job 详情/编辑抽屉实例区顶部）**：

- **在线数**：当前 `up` 的实例数 / 实例总数（如「在线 5 / 10」）；
- **待采集数**：已保存但变更单未确认下发、或刚下发尚未完成首次抓取的实例数。

**实例级「采集状态」列口径**：

| 展示状态 | 判定口径 | 说明 |
|----------|----------|------|
| 待采集 | 实例已入选 `selected_instance_ids`，但对应 target 尚未在 Prometheus 生效（变更单未确认下发 / 已下发未 reload / 未产生首次抓取） | 新勾选、新保存的实例默认进入该状态；在线数不含待采集实例 |
| 正常（up） | M02 `/api/v1/targets` 返回该 target `health=up` | 低饱和展示（异常驱动，见 3.1 列表展示规范） |
| 异常（down） | `health=down` | 高饱和展示，附 `lastError` 摘要（Tooltip / 抽屉）；**提醒文案**：「配置已下发但未采集到数据，请检查采集器安装与网络连通」 |
| 未知（unknown） | target 已生效但暂无抓取结果 | 少见过渡态，展示 `-` 并附最后抓取时间 |

**行为规则**：

- 回显为**只读**，前端定时刷新（建议 15~30s）或手动刷新；不阻断 Job 编辑与保存；
- 时序前提：采集状态只在「M09 变更单确认下发 → Prometheus reload → 首次抓取（一个 `scrape_interval`）」之后存在——创建/编辑 Job **选择实例时**新勾选实例无状态可看，统一显示「待采集」；存量已生效实例显示真实 up / down；
- blackbox Job 的拨测目标同口径展示（up/down 对应 `probe_success`），不涉及安装登记；
- 全局跨 Job 的排障视图（按 health / 网域过滤的全部 target 列表）归 Module_02 目标状态页（P1，见 M02 §3.1），本模块不做；
- **与 coverage 三态的边界（2026-09-02 口径）**：M02 `/api/v1/health/coverage` 与 M07 三态 badge **不区分「待采集」**——选中关系取 DB 当前值、不感知 M09 下发时序，选中未采到统一归「已下发未采到」；「待采集 vs 已下发未采到」的细分**仅由本模块回显承担**（本模块持有 `change_status`，可对「变更未确认下发」单独标识）。
***

## 6. 接口设计

> 决策依据：design-decisions.md 决策 7 / 14 / D1 / D27-2

### 6.1 接口设计总览

> 本模块是策略 Owner，主要接口为**写策略 + 被轮询消费 + 只读消费外部对象**。MVP 最小契约（统一 `/api/v1` 前缀，鉴权/错误码规范见 [00\_Global\_Architecture.md](../00_Global_Architecture.md)）：

| 方向 | 接口 | 说明 |
|------|------|------|
| 写（本模块） | `POST/PUT/DELETE /api/v1/ci-exporter-mappings` | 默认采集配置 CRUD（采集实现层，每类型可多行，不绑网域） |
| 写（本模块） | `POST/PUT/DELETE /api/v1/scrape-jobs` | ScrapeJob CRUD（含 instance_selection_mode / filter 表达式（v0.2）/ service_discovery 配置（v0.3+ 预留）等扩展字段） |
| 写（本模块） | `POST/PUT/DELETE /api/v1/monitoring-rules` | MonitoringRule CRUD（MVP 整文件透传：`content_mode` / `rule_content`；列表含下发状态 `change_status`，来自 M09 变更单） |
| 读（本模块） | `GET /api/v1/exporter-templates`、`GET /api/v1/metric-library` | 采集实现（ExporterTemplate）与指标库查询（指标库按监控对象类型过滤） |
| 读（本模块） | `GET /api/v1/scrape-jobs` | ScrapeJob 列表；Query 支持 `label_template_id` 反查引用本模板的 Job（含下发状态 `change_status`，MVP，来自 M09 变更单状态） |
| 消费（Module\_09 轮询） | 策略读取接口（ScrapeJob / CITypeExporterMapping / MonitoringRule / LabelTemplate 引用） | Module\_09 生成 `prometheus.yml` 与 `rules.yml` 的输入；本模块不主动通知（pull 模式） |
| 只读消费（本模块 ← Module\_07） | Resource / LabelTemplate GET 接口 | 实例候选、标签模板引用（Module\_07 6.1 / 6.3） |
| 只读消费（本模块 ← Module\_02） | `GET /api/v1/targets`（M02 代理） | Job 实例采集状态回显（5.10，决策 47-2）：按 Job 过滤取 health / lastScrape / lastError，本模块不直连 Prometheus |
| 调用（v0.3+） | Module\_02 `validate` / `preview` | 规则编辑时 PromQL 校验与指标预览 |

> **跨模块契约要点**：①`label_template_id` 为跨模块唯一 FK（Module\_07 维护）；②`instance_filter` 筛选字段仅限 Resource 属性字段（label 名仅 UI 别名，不落表达式，见 5.4）；③v0.3+ `service_discovery` 目标由发现结果 + relabel 动态生成（不落 `selected_instance_ids`）。

### 6.2 管理面 REST API 详细契约

> 本节为 MVP 后端可直接实现的请求 / 响应 / 错误码契约。所有接口统一返回 `platform/api/response` 格式：
>
> ```json
> { "status": "success", "data": {} }
> { "status": "error", "errorType": "bad_request", "error": "human readable message" }
> ```
>
> 通用 `errorType`：`bad_request`、`unauthorized`、`forbidden`、`not_found`、`internal`。下文仅列业务专属错误。

#### 6.2.1 默认采集配置（CITypeExporterMapping）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v1/ci-exporter-mappings` | Query: `monitor_type`、`is_default`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 5.1 | — |
| POST | `/api/v1/ci-exporter-mappings` | 5.1 字段（除 id/timestamps） | 创建后的完整对象 | `bad_request`：同监控对象类型存在多个 `is_default=true` |
| PUT | `/api/v1/ci-exporter-mappings/{id}` | 5.1 可更新字段 | 更新后的完整对象 | `not_found`；`bad_request`：同类型多个默认 |
| DELETE | `/api/v1/ci-exporter-mappings/{id}` | — | `{ id }` | `bad_request`：默认模板禁止删除；`forbidden`：被 Job 引用时禁止删除 |

> 说明：`label_template_id` 的**唯一变更入口为默认采集配置列表「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`）**；新增 / 编辑（`MappingDrawer`）抽屉**不包含 `label_template_id` 字段**，POST/PUT 请求体亦不接收该字段（避免「更换 / 补配」与「编辑」双入口写同一字段导致界面数据不同步，见 5.1「标签模板创建引导」）。

#### 6.2.2 采集 Job（ScrapeJob）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v1/scrape-jobs` | Query: `network_domain_id`、`monitor_type`、`job_type`、`enabled`、`keyword`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 5.2 / 5.4（**含下发状态 `change_status`，MVP**，见 5.4） | — |
| POST | `/api/v1/scrape-jobs` | 5.2 / 5.4 字段（除 id/timestamps） | 创建后的完整对象 | `bad_request`：`network_domain_id` 未在 M09 完成监控纳管；**创建到冻结（禁用）网域**（决策 30）；`instance_selection_mode=manual` 但 `selected_instance_ids` 与监控对象类型/网域不匹配；`auth_type=basic` 缺 `username/password` 或 `auth_type=bearer` 缺 `token`（决策 31） |
| PUT | `/api/v1/scrape-jobs/{id}` | 5.2 / 5.4 可更新字段 | 更新后的完整对象 | `not_found`；`bad_request`：网域未纳管 / 冻结网域禁止新增该域实例（决策 30，允许移除/删减）/ 实例不一致 / 认证、TLS 组合非法 |
| DELETE | `/api/v1/scrape-jobs/{id}` | — | `{ id }` | `not_found` |
| POST | `/api/v1/scrape-jobs/{id}/clone` | `{ job_name?: string, network_domain_id?: string }`（**v0.3+ 待评估**，已移出 v0.2 范围——决策 54 扇出已覆盖跨网域复用主场景；缺省 `job_name` 自动追加后缀，缺省网域 = 源网域） | 克隆产物的完整对象 | `not_found`；`bad_request`：目标网域未纳管 |
| GET | `/api/v1/scrape-jobs?label_template_id={template_id}` | Query: `label_template_id`（必填） | `{ items: [...] }`：引用该标签模板的 Job 列表，item 含 `change_status`（pending/confirmed/none/deployed，**MVP**，来自 M09 变更单状态，deployed 由 M09 依据 ConfigDeployment success 回写） | `not_found`：模板不存在 |

> **UI 空态引导优先**：除 `bad_request` 外，UI 层应优先通过网域选择器空态引导（「暂无已纳管网域，前往网域管理完成纳管」+ 内联跳转 M09）避免用户进入保存失败路径；`bad_request` 仅作兜底（见 3.1「空态依赖引导规范」）。

#### 6.2.3 指标库（ExporterMetricLibrary / BusinessMetric）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v1/metric-library` | Query: `monitor_type`、`metric_type`、`category`、`keyword`、`page`、`page_size` | `{ items: [...], total: N }`，字段见 5.3 | — |
| POST | `/api/v1/metric-library` | 5.3 字段（`is_builtin=false` 的用户扩展指标） | 创建后的完整对象 | `bad_request`：指标名重复 / 引用的 `monitor_types` 不存在 |
| PUT | `/api/v1/metric-library/{metric_id}` | 用户可更新字段（`enabled`、`help`、`unit`、`monitor_types`、`source_exporters`、`category`） | 更新后的完整对象 | `forbidden`：内置指标禁止修改；`not_found` |
| GET | `/api/v1/business-metrics` | Query: `business_domain`、`status`、`owner`、`page`、`page_size` | `{ items: [...], total: N }`，字段见 5.9 | — |
| POST | `/api/v1/business-metrics` | 5.9 字段（除 id/timestamps） | 创建后的完整对象 | `bad_request`：`metric_name` 重复 / `owner` 为空 |
| PUT | `/api/v1/business-metrics/{id}` | 5.9 可更新字段（按状态推进权限校验） | 更新后的完整对象 | `forbidden`：非业务负责人修改 pending/instrumented 语义字段；`bad_request`：状态流转非法 |

#### 6.2.4 规则（MonitoringRule）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v1/monitoring-rules` | Query: `rule_type`、`enabled`、`keyword`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 5.5（**含下发状态 `change_status`，MVP**，来自 M09 变更单） | — |
| POST | `/api/v1/monitoring-rules` | 5.5 字段（`content_mode=yaml_passthrough` 时**必填** `rule_content`） | 创建后的完整对象（保存即 `draft_status=ready`，进入 M09 变更检测） | `bad_request`：`rule_content` 为空 / YAML 语法非法（至少校验 `groups` 存在且为数组） |
| PUT | `/api/v1/monitoring-rules/{id}` | 5.5 可更新字段（`name`、`rule_content`、`enabled` 等） | 更新后的完整对象 | `not_found`；`bad_request`：YAML 非法 |
| DELETE | `/api/v1/monitoring-rules/{id}` | — | `{ id }` | `not_found` |

> 说明：MVP 的 MonitoringRule 变更（保存 / 启停 / 删除）即触发 Module\_09 变更检测 → 生成 `rules.yml` 草稿 → 变更单**人工确认** → 下发（人工确认档，决策 38-1，与采集 Job 同动线）。YAML 校验可复用 Module\_09 configgen `--config.check`，或后端 YAML 解析（至少校验 `groups` 存在且为数组）。

#### 6.2.5 Exporter 安装登记（可选）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| POST | `/api/v1/scrape-jobs/{job_id}/instances/{resource_id}/confirm` | `{ actual_port?: number, confirmed_by: string, notes?: string }` | 登记记录（5.6） | `bad_request`：资源不在该 Job 的 `selected_instance_ids` 中；`not_found` |
| DELETE | `/api/v1/scrape-jobs/{job_id}/instances/{resource_id}/confirm` | — | `{ resource_id, job_id }` | `not_found` |

> 说明：登记主键维度为 `resource_id` × `scrape_job_id`（同一实例被不同 Job 选中时分别登记，见 5.6）；登记状态机见 8 章 ④；`not_applicable` 状态由 Job 类型决定，不生成登记记录。**登记与否不影响 target 生成**（决策 47-1），接口仅承载可选留痕与 `actual_port` 登记。

***

## 7. 依赖

> 决策依据：design-decisions.md 决策 7

### 7.1 模块依赖

- `platform/models`
- `upstream/prometheus/scrape/`
- `upstream/prometheus/web/api/v1/`
- `platform/gateway/proxy/`
- [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource / ResourceType / LabelTemplate API
- [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的配置下发与状态反馈 API
- [Module\_02: 查询中心](Module_02_Query_Center.md) 的 PromQL 校验与指标查询 API（v0.3 起，规则编辑时调用）

### 7.2 模块边界

| 职责                            | Module\_01 监控策略与指标管理 | Module\_07 监控对象管理 | Module\_09 网域与边缘配置中心 | Module\_08 告警规则管理            |
| ----------------------------- | -------------------- | ----------------- | -------------------- | ---------------------------- |
| CMDB / Resource 维护            | ❌                    | ✅                 | ❌                    | ❌                            |
| Excel 导入 Resource             | ❌                    | ✅                 | ❌                    | ❌                            |
| LabelTemplate 编辑              | ❌                    | ✅                 | ❌                    | ❌                            |
| 默认采集配置       | ✅                    | ❌                 | ❌                    | ❌                            |
| ScrapeJob 编辑                  | ✅                    | ❌                 | ❌                    | ❌                            |
| ScrapeJob blackbox 类型编辑       | ✅                    | ❌                 | ❌                    | ❌                            |
| 实例选择（手动/筛选）                   | ✅                    | ❌                 | ❌                    | ❌                            |
| Exporter 安装/注册登记（可选）              | ✅                    | ❌                 | ❌                    | ❌                            |
| Job 实例采集状态回显（只读，消费 M02 targets 代理） | ✅                    | ❌                 | ❌                    | ❌                            |
| 规则管理（MVP 文件挂载 / v0.3 编辑 UI） | ✅                    | ❌                 | ❌                    | ❌                            |
| 指标库（Exporter 指标库）          | ✅                    | ❌                 | ❌                    | ❌                            |
| Resource 采集状态 badge（三态）        | 提供选中关系数据（`is_monitored`）             | ✅ 展示（up/down 聚合来自 Module\_02 健康度 API，决策 47-3）              | ❌                    | ❌                            |
| 生成 prometheus.yml / rules.yml | ❌                    | ❌                 | ✅                    | ❌                            |
| 配置预览 / 人工确认 / 下发              | ❌                    | ❌                 | ✅                    | ❌                            |
| 静默、Alertmanager 配置、告警通知状态 | ❌ | ❌ | ❌ | ✅（M08：告警收敛与通知管理） |
| 告警规则生命周期（分组 / 启用禁用 / 按网域生成 `rules.yml`） | ❌ | ❌ | ✅ | ❌（M08 仅负责告警收敛与通知管理） |
***

## 8. 数据模型状态机

> 决策依据：design-decisions.md 决策 7 / D27-2

> 集中定义本模块核心对象的状态流转，供后端实现与前后端契约对齐。

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

> **变更锁定语义（pending）**：`change_status=pending`（存在 M09 待确认变更单）时该 Job **锁定编辑 / 启停 / 删除**；**解锁仅由 M09 变更单确认（→ confirmed/deployed）或废弃触发**（见 5.4「pending 期锁定」）。该锁定不破坏「草稿 → ready」单向流转（草稿态无在途变更）。

**② instance_selection_mode（实例选择方式，随版本演进）**

```text
manual（MVP：手动勾选，候选按类型+网域收敛）
   │
   ├──► filter（v0.2，决策 53：按资源属性条件筛选，label 仅 UI 别名；每生成周期实时求值，新增资源自动纳入）
   │
   └──► service_discovery（v0.3+：服务发现 + relabel 动态生成，不落 selected_instance_ids）
```

> 三种模式互斥（同一 Job 仅一种）；演进向后兼容——manual 是 MVP 基线，filter / service_discovery 是扩展模式，均不影响标签管理（筛选/发现只决定"哪些实例被采集"，不写标签）。

> **`offline` 排除（MVP 必实现，决策 29）**：与 [Module_07 8.1](Module_07_Monitoring_Object_Management.md) 状态机行为语义对齐——「M01 实例选择候选集中 `offline` 实例**显示但置灰不可选**；已选实例转 `offline` 后 M09 配置生成跳过（`offline` 后下一配置生成周期即从 `targets/*.json` 移除，见 [Module_09 3.3 实例过滤](Module_09_Network_Domain_and_Edge_Config_Center.md)）」为 **MVP 必实现**。落地时点：候选集查询将 `offline` 实例置灰禁用（仍展示、不可勾选）；已选实例转 `offline` 后的生成跳过由 M09 configgen 承担。`maintenance` 排除口径与本条一并对齐（MVP 不保证）。

> **「未纳入任何 Job」筛选器（跨模块契约跟进项）**：[Module_07 5.2](Module_07_Monitoring_Object_Management.md) / 全局 ARCH-03 将「哪些机器还没被管」落点到本模块实例选择器——本模块规划实例选择「未纳入任何 Job」筛选器，**MVP 不保证，随本模块开发节奏落地**（或确认统一改指 [Module_02](Module_02_Query_Center.md) 目标状态页，见 M01-ARCH-01）。

**③ BusinessMetric.status（业务指标埋点/采集落地状态）**

```text
pending（待埋点） ── 业务负责人登记或运维代办 ──► instrumented（已埋点，业务侧完成）
                                                              │
                                                              │ 运维确认采集 Job 已落地 / 指标可查
                                                              ▼
                                                        online（已上线）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| pending | 待埋点 | 业务指标首次登记（`register_source=self/agent`，owner 必填） | 业务负责人（或运维代办）完成代码/端点埋点后标记 instrumented |
| instrumented | 已埋点 | 业务侧确认指标已在应用端产出 | 运维配置采集 Job 并确认指标可查后标记 online |
| online | 已上线 | 运维确认采集已落地、指标可在查询中心查到 | 终态；若采集 Job 删除/指标长期不可查可回退到 pending（v0.2+ 自动检测） |

> 状态推进权限：MVP 阶段不接入用户权限，由 UI 角色切换器演示「业务负责人」与「运维工程师」两动线；接入 Module_06 权限后，`pending→instrumented` 由业务负责人角色执行，`instrumented→online` 由运维角色执行。

**④ ExporterInstallationConfirmation.status（实例 Exporter 安装登记状态，可选）**

> **决策 47-1 修订**：登记不再作为生成 target 的前置——`unconfirmed` 实例**照常参与** M09 配置生成；target 生成只取决于 `selected_instance_ids`（+ `offline` 排除 + `enabled` + `draft_status`）。「是否采到数据」的事实反馈由 ⑥ 采集状态回显承担。

```text
unconfirmed（未登记，默认，不阻断 target 生成） ── 运维可选登记 ──► confirmed（已登记，背书留痕）
        │
        └──► not_applicable（该实例无需 Exporter，如 blackbox / application_http）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| unconfirmed | 未登记（默认） | 实例被 ScrapeJob 选中且未做安装登记 | 运维可选登记 → confirmed；实例被移除后删除登记记录；**照常生成 target** |
| confirmed | 已登记 | 运维填写 `actual_port` / 备注 / 登记人后保存 | 纯留痕；实例从 Job 移除后保留历史记录但不再生成 target |
| not_applicable | 不适用 | blackbox / application_http 等无需独立 Exporter 的 Job 类型 | 终态，不生成登记记录 |

> **登记粒度**：`resource_id` × `ScrapeJob` 维度；同一实例被多个 Job 选中时分别登记。

**⑤ ScrapeJob.draft_status（草稿状态；字段 MVP 已落库、默认 `ready`，「保存草稿 / 提交生效 / 批量提交」交互 v0.3 开放）**

```text
        新建对象点「保存草稿」（基础校验通过）
                    │
                    ▼
        draft（编辑中，不参与配置生成）
                    │
                    │ 提交生效（完整校验通过）
                    ▼
        ready（待下发，进入 M09 配置生成候选集）
                    │
                    │ 终态：不再回退 draft
                    │ 已生效对象的后续修改直接更新主字段
                    ▼
        ready（正常变更管线：保存 → M09 变更单确认）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| draft | 新建阶段的编辑中/半成品 | 新建对象点「保存草稿」 | 提交生效 → ready；删除时直接物理删除（草稿从未参与配置生成，删除不产生有效配置变更） |
| ready | 内容已完成，允许进入发布管线 | 新建/草稿对象点「提交生效」且完整校验通过 | 终态；后续编辑直接更新主字段并触发 M09 变更检测（正常变更管线） |

> 说明：
> - **草稿仅存在于新建阶段（单向流转）**：对象一旦 `ready` 不再回退 `draft`。已生效对象的修改不做草稿快照——Job 参数（采集频率 / 端口等）调整低频，直接保存走 M09 变更单确认即可，避免引入第二套继承/快照语义。
> - `draft_status` 与 `enabled` 正交：`enabled=false` 时无论 `draft_status` 如何均不参与配置生成，聚合状态显示「已停用」；`draft_status=draft` 时聚合状态显示「草稿」。
> - 草稿保存仅做基础校验（字段类型 / 名称唯一性 / 网域已纳管等），**不做完整必填业务字段校验**，避免用户因查资料、讨论而无法暂存半成品；提交生效时做完整校验（含必填项 / 网域已纳管 / 实例同域，规则含 PromQL 校验）。
> - `MonitoringRule` 采用同一状态机（MVP 随规则文件挂载启用——保存即 `ready` 进入 M09 变更管线；v0.3 随字段化编辑开放草稿）。

**⑥ Job 实例采集状态（展示口径，非持久状态，决策 47-2）**

```text
待采集（已入选，变更未下发/未首次抓取） ── 变更单确认下发 + reload + 首次抓取 ──► up（正常）/ down（异常）
```

| 展示状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| 待采集 | 实例已入选但 target 尚未生效或未产生首次抓取 | 新勾选保存 / 变更单 pending / 已下发未 reload | 首次抓取后 → up / down |
| up（正常） | 采集正常 | M02 `/api/v1/targets` 返回 `health=up` | 抓取失败 → down |
| down（异常） | 已下发但未采到数据（采集器未装 / 网络不通等） | `health=down` | 修复后 → up；提醒文案引导检查采集器与网络 |
| unknown（未知） | target 已生效但暂无抓取结果 | 少见过渡态 | 下一抓取周期 → up / down |

> 数据源为 Module_02 `/api/v1/targets` 代理（只读，按 Job 过滤）；外层汇总 = 在线数（up 数）/ 实例总数 + 待采集数；设计细则见 5.10。

***

## 9. 验收标准

> 决策依据：design-decisions.md 决策 14 / 15 / 16 / 35 / D1 / D2 / D7 / D11 / D12 / D13 / D16 / D17 / D18 / D19 / D20 / D21 / D22 / D25 / D26 / D27-2 / D28

### 9.1 用户验收（用户可在 UI 感知/操作）

- [ ] {P0} 模块名称与文档目录已更新为「监控策略与指标管理」。
- [ ] {P0} 可以为常见监控对象类型（`host_linux` / `host_windows` / mysql / redis 等）建立/编辑 默认采集配置，包含默认端口、metrics\_path、scheme、scrape\_interval、scrape\_timeout、安装指南 / 下载地址；同一监控对象类型可配置多个可选采集实现（`is_default` 标记默认）。
- [ ] {P0} 可以创建/编辑 `ScrapeJob`，指定 job\_name、monitor\_type、默认采集器（可空，手填模式）、网域、实例选择模式与标签模板引用；采集参数（端口/路径/协议）可直接手填覆盖。
- [ ] {P0} 采集 Job 支持配置认证/TLS 最小集（决策 31）：`auth_type`（none/basic/bearer）＋对应 `username`/`password` 或 `token`、`tls_skip_verify`、`ca_file`；全部可选、默认 `auth_type=none`，不配置时与既有裸 http 采集完全兼容；表单以「认证与 TLS」折叠面板承载。
- [ ] {P0} 冻结（禁用）网域禁止新建 Job、存量 Job 禁止新增该域实例（决策 30）；允许移除该域实例、禁用/编辑 Job；保存时给出明确错误提示。
- [ ] {P0} 默认采集配置与 Job 表单中，标签模板以「名称（类别 / 模板ID）」展示；选择模板后内联只读展示其映射内容，并提供「前往标签模板管理」跨模块跳转（模板 CRUD 归属 Module\_07）。
- [ ] {P0} 默认采集配置列表的「标签模板」列采用两行卡片展示（名称 + 默认/自定义标记 / 类别·模板ID），点击模板名称打开只读预览抽屉展示映射明细。
- [ ] {P0} MVP 支持手动勾选实例；勾选结果持久化到 `ScrapeJob.selected_instance_ids`。
- [ ] {P0} 选定 `monitor_type` 与 `network_domain_id` 后，实例候选自动收敛为「同类型 + 同网域」资源，支持一键全选/反选与关键字筛选（减少手动逐个勾选）
- [ ] {P0 / v0.2，决策 53} 采集 Job 支持 `filter` 实例选择模式：按资源属性条件表达式筛选并预览匹配结果；保存后 M07 新导入/同步的匹配资源在下一配置生成周期自动纳入 targets，无需编辑 Job；不再匹配的资源自动移出
- [ ] {P0 / v0.2，决策 54} 采集 Job 支持勾选多个已纳管网域；保存后 M09 按网域自动拆分生成各域配置与变更单，每域独立校验 / 确认 / 下发；MVP 单网域行为不变
- [ ] {P0} 实例候选集中 `Resource.status=offline` 实例**显示但置灰不可选**（保证下线台账可见、不可勾选）；已选实例转 `offline` 后 M09 配置生成跳过（`offline` 后下一配置生成周期即从 `targets/*.json` 移除，见 [Module_09 3.3 实例过滤](Module_09_Network_Domain_and_Edge_Config_Center.md)）
- [ ] {P0} 选中实例（`offline` 除外）**均生成 target**，安装登记不作为生成前置（决策 47-1）；可以选登记 Resource/Target 的采集器安装/注册状态（含自研独立 exporter），登记与否不影响 target 生成。
- [ ] {P0} Job 详情/编辑抽屉实例列表展示「采集状态」列（待采集 / up / down / unknown）与外层汇总（在线数 up / 实例总数 / 待采集数）；新保存未下发的实例显示「待采集」、在线数不变；变更下发并完成首次抓取后状态自动转为 up / down（决策 47-2）。
- [ ] {P0} 已下发但 down 的实例展示提醒「配置已下发但未采集到数据，请检查采集器安装与网络连通」，并附 `lastError` 摘要（决策 47-2）。
- [ ] {P1} 安装登记时可登记实例上 exporter 实际监听端口（actual\_port）；配置生成时与生效端口不一致时提示，不自动改配置。
- [ ] {P0 / v0.2} 实例级端口覆盖生效：M07 Resource 可选 `scrape_port` 字段登记 / 编辑 / Excel 导入（留空走默认解析链）；M09 生成 target 时端口解析优先级为 `Resource.scrape_port`（实例自带）→ 网域覆盖表 `CITypeExporterMappingOverride` → 映射默认 `CITypeExporterMapping.default_port`（回落 `ExporterTemplate.default_port`）；`scrape_port` 留空时按默认解析链回落；Job 实例列表只读回显「生效端口」；**不提供 Job 级端口映射表**
- [ ] {P0} {v0.3} 规则编辑 UI 支持类 YAML 表单（expr / for / labels / annotations），调用查询中心进行 PromQL 校验，并提供指标实时预览。
- [ ] {P0} 指标库可注册/查看，包含 metric\_type、help、unit。
- [ ] {P0} MVP 指标库最小集按监控对象类型组织（`host_linux` / `host_windows` / mysql / redis / kafka / snmp / application\_http）预置：node-exporter、windows-exporter、mysqld-exporter、redis-exporter、kafka-exporter、snmp-exporter 与 HTTP 抓取（application\_http）的指标，规则编辑时可提示指标名与标签。
- [ ] {P0} MVP 内置拨测指标（blackbox：`probe_success`、`probe_duration_seconds`、`probe_http_status_code`），规则编辑时可提示与校验。
- [ ] {P1} 支持用户手动导入（JSON/CSV 或抓取 metrics 元数据）与更新/覆盖/禁用指标库条目，MVP 阶段内置库为只读静态数据。
- [ ] {P0} [Module\_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 的 Resource 列表可展示三态「采集状态」badge（采集中 / 已下发未采到 / 未监控）：选中关系（`is_monitored`）来源于本模块的 `ScrapeJob`，up/down 聚合来源于 [Module_02](Module_02_Query_Center.md) 健康度 API（决策 47-3）。
- [ ] {P0} 支持创建 `job_type=blackbox` 的 `ScrapeJob`，可配置 `blackbox_module` 与 `blackbox_targets`，并绑定单一 `network_domain_id`。
- [ ] {P0} 采集 Job 编辑表单中，`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme`、`label_template_id` 五个继承字段的 label 旁显示来源状态 Tag（继承自映射/已覆盖/待同步），用户可直观感知哪些参数已自定义、哪些来自映射默认值。
- [ ] {P0} 采集 Job 列表页「参数同步」列增强，显示覆盖字段数量概览（如「2 个字段已自定义」）。
- [ ] {P0} 采集 Job 详情视图同步显示每个参数字段的继承/覆盖/待同步标记。
- [ ] {P0} 新增默认采集配置时，若该监控对象类型尚无标签模板，系统弹出轻量提示引导用户创建，支持「立即创建」（预填推荐映射）或「稍后再说」（列表显示待配置 badge）
- [ ] {P0} 默认采集配置列表新增「标签模板」列，展示模板名称 + 默认/自定义标记 + 类别·模板ID；支持查看（只读预览抽屉）、更换（同资源类别其他模板）、补配（重新触发创建流程）
- [ ] {P0} 标签模板创建抽屉预填监控对象类型、资源类别、推荐默认映射（composite: instance_ip:port → instance 等），用户可微调后保存
- [ ] {P0} ScrapeJob 表单中标签模板选择器改为卡片式选择（展示模板名称 + 资源类别 + 映射数量概览），选中后内联展示映射明细小表格
- [ ] {P0} ScrapeJob 编辑表单中标签模板支持「更换」操作，仅展示同资源类别的可用模板
- [ ] {P0} 引用无标签模板映射的 Job 在列表 / 详情中显示「标签待配置」提示；编辑表单提供「前往默认采集配置补配（Job 将自动继承）」主引导（同原型内跳转）与「前往标签模板管理」次级入口
- [ ] {P0} 映射 / Job 表单的「标签模板」选择器按**所属资源类别**过滤；选中类型无模板时下拉空态显示「该监控对象类型尚无标签模板，请先创建」并提供内联「创建标签模板」按钮
- [ ] {P0} 「标签模板」字段提示区分两情形：有模板显示「该资源类别已有 N 个标签模板，直接选择即可（已自动关联该监控对象类型的默认模板，可更换）」；无模板显示「该监控对象类型为新类型，其资源类别尚无标签模板；创建后采集 Job 将自动继承」
- [ ] {P0} 选择器选项对默认模板加「默认」标记（默认模板标记到监控对象类型）；创建引导弹窗文案明确「检测到新增监控对象类型，尚未创建标签模板」
- [ ] {P0} 默认采集配置列表「待配置」Badge 可点击重新触发补配引导，操作列提供「补配标签模板」按钮
- [ ] {P0} 规则编辑 UI 中，labels 区域上方显示语义说明卡片，明确区分「告警标签」与「目标标签」的差异，并标注必填状态（选填，推荐填写）与推荐 key。
- [ ] {P0} 规则编辑 UI 中，annotations 区域上方显示必要性说明卡片，说明其作用（人类可读信息，不参与路由判断），并标注必填状态（选填，推荐填写）与推荐 key。
- [ ] {P0} 规则编辑 UI 中，记录规则的 labels 区域显示特殊提示，说明记录规则 labels 的语义（附加到新时间序列的维度标签）。
- [ ] {P0} 默认采集配置区的新增/编辑表单使用 Drawer 抽屉承载，底部操作栏始终可见，关闭前有未保存提示。
- [ ] {P0} 规则编辑页的新增/编辑表单使用 Drawer 抽屉承载，底部操作栏始终可见，关闭前有未保存提示。
- [ ] {P0} 业务指标库可登记业务指标（指标名 / 语义 / 阈值 / 所属业务域 / 负责人必填），列表展示埋点状态（待埋点 / 已埋点 / 已上线）；运维可将业务指标标记「已上线」（确认采集落地）
- [ ] {P0} 技术指标库与业务指标库导航归组于「指标库」分组、两页互链；技术指标库页说明"技术元数据（能采到什么）vs 业务语义契约（业务关心什么）"的两库关系
- [ ] {P0} 业务指标库「登记表」展示采集落地列（online 显示关联采集 Job / 指标可查）；「业务视图」为独立页（`/business-view`，导航「指标库 → 业务视图」）按 business_domain 聚合成员（微服务/中间件/主机）+ 业务指标 + 埋点状态
- [ ] {P0} 默认采集配置区对 application_http 显性提示「业务服务（含自定义微服务）仍属 application_http、无需新增监控对象类型」；mock 提供自定义微服务指标集样本（application_http 挂接自定义指标，来源标注），自定义微服务可创建采集 Job 并展示采集落地
- [ ] {P0} 技术指标库支持指标 ↔监控对象类型多对多挂接（同一指标可属多个监控对象类型）；同名指标（不同来源采集器，如 Spring Boot / Go 的 `http_server_requests_seconds_count`）提示时显示来源区分
- [ ] {P0} 映射 / Job 表单支持「不使用默认采集器、直接手填采集参数」模式；采集参数手填值可被「同步映射默认值」保留（覆盖字段不刷新）
- [ ] {P0} M01 不提供顶部全局网域切换器；「采集 Job」页列表提供网域查询条件（选项 = 已纳管网域 `NetworkDomain.is_monitored=true`），Job 表单 `network_domain_id` 必填、实例候选按所选网域收敛
- [ ] {P0} 网域 `NetworkDomain.is_monitored` 由 M09 维护；MVP 阶段由 seed 将 `default` 及示例 edge 域**预置为已纳管（`true`）**，「采集 Job」网域下拉可直接选择（过渡说明，见 5.4）
- [ ] {P0} 默认采集配置**入口为独立页面「采集器管理」（`/collectors`），与「采集 Job」页（`/scrape-jobs`）同为 Sider 一级导航项**（无「采集策略」分组）；创建 Job 时自动套用该监控对象类型的默认采集配置，页面内可维护预设（采集器 / 参数 / 安装指南 / 标签模板）
- [ ] {P0} 「采集器管理」页面承担**类型级采集器指引**（该监控对象类型该装什么采集器、安装指南 / 下载地址 / 官方文档入口明显展示），**不做实例级安装登记**——登记（可选）在「采集 Job」选实例时进行（5.6），动线以文案衔接（看指南 → 线下安装/下载 → 选实例时可选登记 → 保存后看采集状态回显）
- [ ] {P0} 「采集器管理」页面列表支持按监控对象类型 + 来源（开源官方 / 第三方 / 自研）筛选；登记表单选择「自研」时默认端口 / 采集路径 / 协议必填并提示「按实际部署填写」；预置参数标注「官方默认值参考」
- [ ] {P0} 自研采集器登记后即入池：可被映射引用为默认采集器、创建 Job 时预填参数、可走实例级安装登记（可选，与平台预置采集器一致）
- [ ] {P0} `application_http` 在「采集器管理」页面呈现为引导卡（无需安装采集器 / 指标语义到业务指标库登记 / Job 参数按 endpoint 手填），不提供采集器登记入口
- [ ] {P0} 采集器管理按 OS 平台预置不同采集器（如 `host_linux`→node-exporter、`host_windows`→windows-exporter），展示对应的下载地址与安装指南；用户可登记自研采集器（`is_builtin=false`）并留痕。
- [ ] {P0} 网域选择器空态时显示「暂无已纳管网域，前往网域管理完成纳管」并内联跳转 M09
- [ ] {P0} 采集器 / 标签模板选择器空态时显示内联创建 / 登记入口（「未找到合适的采集器？登记采集器」/「该监控对象类型尚无标签模板，请先创建」）
- [ ] {P0} 新增 / 编辑默认采集配置时，采集器选择为「使用默认采集器（推荐）」或「手填采集参数」显式二选一
- [ ] {P0} 默认采集配置列表包含「标签模板」列，展示模板名称 + 默认/自定义标记 + 类别·模板ID，支持查看 / 更换 / 补配
- [ ] {P0} 默认采集配置列表的「类型」列与「来源」列不重复展示
- [ ] {P0} 列表中状态 / 同步类信息采用异常驱动展示：正常态低饱和 / `-`，异常态（映射默认值已变更 / 标签模板待配置 / 网域未纳管）才高饱和 / 可点击
- [ ] {P0} 采集器管理页面顶部主按钮为「新增默认采集配置」，「登记采集器」为次级入口且内置于选择器空态
- [ ] {P0} 默认标签模板必须包含 `resource_id` 稳定资源身份标签（决策 47-3 coverage 回连键；`hostname` 仅为可读别名、不替代 `resource_id`），`instance`（ip:port）不作为业务稳定关联键
- [ ] {P0} 登记表单从采集器空态发起时预填当前监控对象类型，保存成功后自动回选到来源表单的采集器字段并预填参数
- [ ] {P0} 「采集器管理」列表可看到已登记但未被任何映射引用的采集器，未引用行标记「未被引用」状态
- [ ] {P0} `job_type=blackbox` 的 Job 不产生 `application_http` / `exporter_template_id` 归属数据；覆盖率等统计按 `job_type` 而非 `monitor_type` 计算
- [ ] {P0} `install_guide` 单一来源：只存于采集实现（`ExporterTemplate`），映射行不持有该字段、展示时只读透传
- [ ] {P0} 新增 / 编辑默认采集配置抽屉（`MappingDrawer`）**不含 `label_template_id` 字段**；标签模板经默认采集配置列表「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`）维护（候选按资源类别过滤、空态引导前往标签模板管理创建）
- [ ] {P0} 创建采集 Job 时 `label_template_id` 自动预填 = 映射默认模板；映射未配置时兜底同资源类别 `is_default` 模板；概要行显性说明「已自动匹配默认模板，可更换」
- [ ] {P0} 「标签模板」选择器按资源类别过滤（选定资源类别即收敛候选），选定监控对象类型后预填并标记默认模板——类别驱动候选、类型驱动默认
- [ ] {P0} 标签模板不进入新增 / 编辑默认采集配置抽屉；其维护唯一入口 = 默认采集配置列表「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`），候选按资源类别过滤、空态引导前往标签模板管理创建
- [ ] {P0} 补配入口收敛：Job 表单缺模板 Alert 主按钮 / 映射列表「补配」/「待配置」badge 均打开该映射行「更换 / 补配」轻量抽屉（`LabelTemplateSelectDrawer`，带入监控对象类型 / 资源类别 / 默认采集器只读上下文）；「前往标签模板管理」仅保留在轻量抽屉空态
- [ ] {P0} Job 表单缺模板 Alert 按缺口类型区分文案（映射未关联 →「立即补配」；类别无模板 →「前往创建模板」），且为软引导不阻塞保存
- [ ] {P0} 采集 Job 保存/启停/删除成功后，提示「变更将由 M09 生成变更单，需确认后生效」并提供「前往配置变更确认」跳转按钮
- [ ] {P0} 「采集 Job」列表「状态」聚合列展示四态：草稿 / 待下发 / 已生效 / 已停用；MVP 阶段「草稿」态无实例，标签灰显并 Tooltip 提示「v0.3 支持保存草稿」，状态筛选器中「草稿」选项禁用；`change_status` 支持 `pending` / `confirmed` / `deployed` / `none` 四枚举（MVP 阶段 M09 回写 `pending/confirmed/none`，v0.2 起扩展 `deployed`）
- [ ] {P0} 「规则编辑」页支持上传 / 粘贴完整 `rules.yml`（**整文件透传**，`content_mode=yaml_passthrough`）挂载规则：YAML 语法非法时给出错误提示（至少校验 `groups` 存在且为数组）；保存即 `draft_status=ready` 进入 M09 变更检测管线
- [ ] {P0} 规则列表展示规则名 / 规则条数 / 更新时间 / 启用状态 / 下发状态（`change_status`），支持启停 / 删除 / 详情（YAML 只读视图）
- [ ] {P0} 规则文件挂载保存/启停/删除成功后，提示「变更将由 M09 生成变更单，需确认后生效」并提供「前往配置变更确认」跳转按钮；规则列表「下发状态」列展示 `change_status`（与采集 Job 同源同机制，MVP 起）
- [ ] {P0} 规则挂载后，M09 生成的 `rules.yml` 草稿包含该透传规则内容，支持变更单**人工确认**后下发生效（决策 38-1，与采集 Job 同动线）；下发后规则状态回写 `change_status`
- [ ] {P0} {v0.3} 采集 Job 新建表单提供「保存草稿」与「提交生效」两个主操作：「保存草稿」仅做基础校验，允许半成品暂存；「提交生效」做完整校验（含必填项、网域已纳管、实例同域等），通过后 `draft_status` 转 `ready` 并进入 M09 变更检测管线；已生效 Job 的编辑仅提供普通「保存」，直接走 M09 变更单确认管线（不做草稿快照）
- [ ] {P0} {v0.3} 采集 Job 列表支持多选「批量提交生效」：选中的 `draft_status=draft` 对象逐条校验，失败的给出逐条错误清单，成功的批量转 `ready`
- [ ] {P0} {v0.3+ 待评估} 采集 Job 列表操作列提供「克隆」入口：打开新建抽屉并预填源 Job 的采集参数 / 监控对象类型 / 采集实现 / 标签模板；同网域克隆可直接改选实例，跨网域克隆需改选目标网域、实例清空重选，并提示安装登记（可选）需重新进行
- [ ] {P0} {v0.3+ 待评估} 克隆产物为独立 Job，与源 Job 无绑定关系（源 Job 后续变更不影响克隆产物），不引入「Job 模板」持久实体
- [ ] {P0} {v0.3} 规则编辑 UI 同样提供「保存草稿」与「提交生效」（仅新建阶段）；草稿态允许 PromQL 半成品，提交生效时调用 Module_02 做 PromQL 校验

### 9.2 技术验收（后端/契约可验证）

- [ ] {P0} 策略配置写入 DB 后，[Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 能够轮询生成配置草稿，经人工确认后下发。
- [ ] {P0} 标准 ScrapeJob 与 blackbox ScrapeJob 均必须绑定单一已纳管网域的 `network_domain_id`；未纳管网域不可选，保存时校验并提示用户先到 M09 完成纳管；`instance_selection_mode=manual` 保存时校验 `selected_instance_ids` 选中的 Resource 与 Job 同属一个网域。
- [ ] {P0} blackbox ScrapeJob 的创建/编辑/启停、模块或目标变更后，[Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 在下一轮询周期内检测到 `updated_at` 变化并重新生成对应网域配置（pull 模式，Module\_01 不主动通知）。
- [ ] {P0} 独立的运行时目标状态页、拨测结果、采集诊断视图不由本模块建设，相关验收标准已迁移至 [Module\_02: 查询中心](Module_02_Query_Center.md) 与 [Module\_08: 告警规则管理](Module_08_Alertmanager_Notification_Management.md)；但 Job 上下文只读回显（5.10）由本模块前端消费 Module_02 `GET /api/v1/targets` 代理实现，**不直连 Prometheus**（决策 47-2）。
- [ ] {P0} M09 配置生成**不再过滤未登记安装的实例**（决策 47-1）：target 生成只取决于 `selected_instance_ids`（+ `offline` 排除 + `enabled` + `draft_status`）。
- [ ] {P1} v0.4+ 支持基于外部 CMDB 自动发现实例并推荐监控策略；v1.0 支持与 ITIL 流程联动校验监控策略覆盖率。
- [ ] {P1} `instance_filter`（v0.3+）筛选字段仅允许 Resource 属性字段（label 名仅作 UI 别名、由模板 Mapping 只读派生，不落筛选表达式）；筛选不写标签，与 Module\_07「标签配置唯一入口原则」一致。
- [ ] {P1} v0.3+ `service_discovery` 模式：目标由服务发现结果 + `relabel_configs` 动态生成（不落 `selected_instance_ids`），关联键沿用 `app` / `biz`（不用 `instance`），默认采集配置采集实现层复用。
- [ ] {P1} `BusinessMetric.owner` 必填校验；`business_domain` 与 Module\_07 资源 `business_domain` 对齐（同名同值）；状态机 `pending → instrumented → online` 流转可验证
- [ ] {P0} `ExporterTemplate` 增加 `os / arch / download_url / homepage` 字段并落库；`host` 粗粒度资源按 `os_type` 映射为 `host_linux` / `host_windows` 细粒度监控对象类型；自研采集器（`is_builtin=false`）可创建、查询并在「采集器管理」页面展示。
- [ ] {P0} `ExporterTemplate.source` 枚举（`official` / `third_party` / `internal`）落库；`source=internal` 创建时 `default_port` / `metrics_path` / `scheme` 必填校验；「采集 Job」列表接口支持 `network_domain_id` 查询参数（仅接受已纳管网域）。
- [ ] {P0} `GET /api/v1/scrape-jobs` 返回 item 级 `change_status`（`pending` / `confirmed` / `deployed` / `none`；MVP 阶段 M09 回写 `pending/confirmed/none`，v0.2 起扩展 `deployed`；由 M09 变更单 / 下发记录状态回写；pull 模式，M01 不主动通知）
- [ ] {P0} `ScrapeJob` / `MonitoringRule` 均含 `draft_status`（`draft`/`ready`）字段：**MVP 已落库、所有对象默认 `ready`**，MVP 阶段 UI 仅展示 `ready` 相关三态；「保存草稿 / 批量提交生效」交互 v0.3 开放
- [ ] {P0} [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 配置生成候选集**仅包含** `draft_status=ready` 的 `ScrapeJob` / `MonitoringRule`；`draft_status=draft` 对象及 `enabled=false` 对象均不参与配置生成（字段机制 MVP 已生效）
- [ ] {P0} {v0.3} 保存草稿时仅更新 `draft_status`/`updated_at`，**不触发** M09 源数据版本重算；提交生效时 `updated_at` 变化且 `draft_status=ready`，M09 下一周期将其纳入源数据版本并生成配置草稿
- [ ] {P0} {v0.3} `GET /api/v1/scrape-jobs` 返回 `draft_status`，前端据此与 `change_status` 聚合状态列「草稿」态
- [ ] {P0} {v0.3+ 待评估} `POST /api/v1/scrape-jobs/{id}/clone` 复制源 Job 的采集参数 / `job_type` / 监控对象类型 / 采集实现 / 标签模板，**不携带** `selected_instance_ids` 与安装登记记录；跨网域克隆时校验目标网域已纳管
- [ ] {P0} `MonitoringRule` 新增 `content_mode`（`yaml_passthrough` / `structured`）与 `rule_content` 字段并落库；`content_mode=yaml_passthrough` 保存时校验 `rule_content` 非空且 YAML 合法（至少 `groups` 存在且为数组）
- [ ] {P0} Module\_09 生成 `rules.yml` 时，`content_mode=yaml_passthrough` 的规则将 `rule_content` **原样并入**；规则保存 / 启停 / 删除引起 `updated_at` 变化后，M09 下一轮询周期检测并重新生成 `rules.yml` 草稿，经变更单**人工确认**后下发（pull 模式，M01 不主动通知；对齐决策 38-1）
- [ ] {P0} {v0.3} `MonitoringRule` 草稿机制与 `ScrapeJob` 一致（仅新建阶段），提交生效时调用 Module_02 PromQL 校验接口
***

## 10. 术语映射（用户词汇表）

> 决策依据：design-decisions.md 决策 16 / D2 / D6 / D7 / D16 / D19 / D21 / D24 / D27-2

> 后端术语 ↔ 用户语言的权威对照（与 5.x 数据模型「UI 展示名」列一致）。用户可见文案、前端页面、接口文档均以本表对齐；「仅技术信息」术语只出现在技术层（折叠区 / 代码注释 / 接口契约），不作为用户界面文案。

| 后端术语                                  | 用户语言             | 说明                                                           |
| ------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `CITypeExporterMapping`               | 默认采集配置 / 采集器管理 | 监控对象类型 ↔ 默认采集器（采集实现）的绑定；采集实现层预设，不绑网域；每类型可多行、`is_default` 标记默认；含安装指南；入口为独立「采集器管理」页面（`/collectors`），与「采集 Job」页（`/scrape-jobs`）同为 Sider 一级导航项（无「采集策略」分组），承担类型级采集器指引（该装什么、怎么装），实例级安装登记（可选）在选实例时（5.6） |
| `CITypeExporterMappingOverride`       | 网域级覆盖           | {v0.2} 按网域覆盖映射默认值（端口 / 协议 / 采集路径等），优先级高于映射默认值                |
| `monitor_type`（细粒度）                | 监控对象类型     | `host_linux` / `host_windows` / mysql / redis / kafka / nginx / application\_http / snmp；派生的策略维度，只存在于监控平台内部、不回写 CMDB |
| `resource_category`（粗粒度）                | 资源类别             | host / database / middleware / application / generic\_target（Module\_07 五大类） |
| `middleware_type`                     | 中间件类型            | kafka / elasticsearch / nginx / zookeeper 等（细粒度子类型） |
| `database_type`          | 数据库类型            | mysql / redis / postgresql / oracle / dm8（达梦）/ sqlserver / mongodb 等（细粒度子类型） |
| `ExporterTemplate`                    | 采集实现 / 采集器 | 采集实现的默认参数、安装指南、`download_url` / `homepage` / `os` / `arch`（归属采集实现，非监控对象类型）；MVP 支持平台预置（`is_builtin=true`）与用户登记的自研采集器（`is_builtin=false`）；预置参数 = 官方默认值参考；非市场运营对象，不支撑指标库分组锚点 |
| `ExporterTemplate.source`             | 采集器来源             | `official`（开源官方）/ `third_party`（第三方）/ `internal`（自研）；登记 / 编辑表单按来源引导（自研时默认端口 / 采集路径 / 协议必填并提示按实际部署填写）；登记即入池，与预置采集器同动线 |
| `ScrapeJob`                           | 采集 Job           | 实际采集任务（实例层），绑定单一网域                                        |
| `change_status`                       | 下发状态           | 采集 Job / 规则的变更下发状态：`pending`（存在 M09 待确认变更单）/ `confirmed`（变更单已确认，待下发）/ `deployed`（已下发生效，v0.2 起由 M09 下发记录回写）/ `none`（无在途变更）；MVP 阶段回写 `pending/confirmed/none`，v0.2 起扩展 `deployed` |
| `draft_status`                        | 草稿状态           | `draft`（编辑中，不参与配置生成）/ `ready`（待下发，进入 M09 配置生成候选集）；默认 `ready`；**仅新建阶段可为 `draft`**，`ready` 后不回退；**字段 MVP 已落库、默认 `ready`**，MVP 阶段 UI 仅展示 `ready` 相关三态，v0.3 开放用户保存草稿 |
| 保存草稿                              | 保存草稿           | 仅新建对象可用：将当前表单内容持久化并标记 `draft_status=draft`，仅做基础校验，允许半成品暂存 |
| 提交生效                              | 提交生效           | 对草稿对象做完整校验（含必填项，规则含 PromQL），通过后 `draft_status` 转 `ready` 且不再回退，进入 M09 变更检测与发布管线 |
| 克隆 Job                              | 克隆 Job           | {v0.3+ 待评估} 一次性复制源 Job 的采集参数 / 监控对象类型 / 采集实现 / 标签模板生成新 Job（非持久模板、与源 Job 无绑定）；实例选择与安装登记（可选）重做，跨网域克隆时目标网域改选；**已移出 v0.2 范围**（决策 54 扇出已覆盖跨网域复用主场景） |
| `job_type`                            | 采集 / 拨测           | `standard`=标准采集；`blackbox`=拨测                                |
| `blackbox_module`                     | 拨测模块             | 引用 `blackbox.yml` 模块名，如 `http_2xx` / `icmp_ping`             |
| `blackbox_targets`                    | 拨测目标             | 探测目标列表（地址 / 协议 / 完整 URL）                                  |
| `instance_selection_mode`             | 实例选择方式           | manual（手动勾选）/ filter（条件筛选，v0.3+）                            |
| `selected_instance_ids`               | 已选实例             | 手动勾选的 Resource ID 列表                                         |
| `mapping_overrides`                   | 仅技术信息            | 手动覆盖过映射默认值的字段名列表（「同步映射默认值」时跳过）                          |
| `ExporterMetricLibrary`               | 技术指标库 / 指标元数据      | 平台可识别的指标名、类型、HELP、UNIT 集合，回答「能采到什么」；与业务指标库（语义契约）并列互补、UI 互链；锚点 =监控对象类型（多对多带来源标注） |
| `BusinessMetric`                      | 业务指标库            | 业务指标语义契约登记处（语义/阈值/所属业务域/负责人必填/埋点状态）；与 Exporter 技术指标库并列，业务负责人定义、运维落地采集 |
| 自定义指标集 | 自定义指标集         | 业务服务（Go/Python/自研）仍属 application_http，自定义指标**直接挂监控对象类型**（`monitor_types` 多对多 + `source_exporter` 来源标注），无需模板 / 无需登记市场 |
| `register_source`                     | 登记来源             | 业务指标登记来源：`self`（业务负责人自录）/ `agent`（运维工单代办，owner 仍指向业务负责人） |
| 业务负责人（Business Owner）             | 业务负责人            | 业务指标语义所有权角色：定义语义 / 阈值 / 看板；语义编辑权不随录入者转移 |
| 业务域聚合视图                            | 仅技术信息            | v0.3+ 独立业务目录视图：成员列表（应用/微服务+中间件+主机）+ 健康度看板 + 采集覆盖；语义层不改变采集配置逻辑 |
| `metric_type`                         | 指标类型             | counter / gauge / histogram / summary / unknown               |
| `MetricLibraryItem.category`          | 语义域             | 可选（P1 增强）：cpu / memory / disk / network 等，指标分组浏览与提示聚类维度；按「语义域 +监控对象类型」组织，不按 Exporter |
| `MonitoringRule`                      | 告警 / 记录规则        | 规则编辑模型（MVP 起：整文件透传挂载 `content_mode=yaml_passthrough` + `rule_content`，保存即进入 M09 变更检测与下发；v0.3 起字段化 UI 逐条写入 `structured`）                    |
| `MonitoringRule.labels`               | 告警标签（Alert Labels） | 告警规则的元数据标签，用于分级/路由，**非** target 身份标签              |
| `MonitoringRule.annotations`          | 告警说明（Annotations） | 告警触发时附带的人类可读信息，用于通知展示，不参与路由判断                    |
| `LabelTemplate` 生成的 labels          | 目标标签（Target Labels） | 标识被监控资源身份的标签（instance/app/env），由采集 Job 的标签模板生成      |
| `rule_type`                           | 规则类型             | alerting（告警规则）/ recording（记录规则）                            |
| `scope`                               | 求值范围             | central（中心求值）/ edge / both（v0.4+，断网自治）                      |
| `ExporterInstallationConfirmation`    | Exporter 安装登记（可选）    | 目标实例独立进程型采集实现（内置 Exporter 或自研采集器）已安装/已注册的登记记录；**可选留痕，不作为生成 target 的前置**（决策 47-1）；`application_http` / `blackbox` 无需安装登记                 |
| 采集状态（Job 实例回显）    | 采集状态    | Job 详情/编辑抽屉实例列的真实采集状态：待采集 / 正常（up）/ 异常（down）/ 未知（unknown）；数据来自查询中心目标状态代理，只读（决策 47-2，见 5.10）                 |
| 在线数 / 待采集数    | 在线数 / 待采集数    | Job 实例区顶部汇总：在线数 = up 实例数 / 实例总数；待采集数 = 已保存但变更未下发或未首次抓取的实例数（决策 47-2）                 |
| `ScrapeTarget` / `ScrapeLog`          | 仅技术信息            | 运行时采集数据，独立状态页与诊断视图由 Module\_02 承担；Job 上下文只读回显见 5.10                               |
| `MONITOR_TYPE_DERIVATION_MAP`                | 仅技术信息            | 粗粒度类别（含 `os_type` / `database_type` / `middleware_type`） → 细粒度监控对象类型映射表；`host + linux` → `host_linux`，`host + windows` → `host_windows`，`database + mysql` → mysql |
| `instance_filter`                     | 实例筛选条件           | v0.3+ 条件筛选表达式：筛选字段 = Resource 属性字段（label 仅作 UI 别名，由模板映射只读派生），筛选不写标签 |
| `service_discovery`                   | 服务发现             | v0.3+ 实例选择模式：目标由服务发现结果 + relabel 动态生成（微服务动态实例），不落手动勾选 |
| `application_http`                    | HTTP 应用 / 业务指标采集 | application 细粒度监控对象类型：业务指标端点 HTTP 抓取（无独立 exporter，应用自带 /metrics，默认标签映射 app/biz）；业务服务（含自定义微服务）仍属本类型，形态差异用手填采集参数 / 多个可选采集实现覆盖，自定义指标直接挂本类型（来源标注），无需新增监控对象类型 |
| `instance_selection_mode=manual`      | 手动选择（实例）        | 手动勾选具体实例（候选按类型 + 网域自动收敛后手动调整）；**不是**手动选择采集器——采集器选择是「使用默认 / 手填参数」二选一 |
| `ExporterTemplate.os` / `arch`        | 适用平台 / 架构        | 制品维度，**不决定监控对象类型**——发行版 / 架构差异下沉到采集器层；同一采集器多平台按 os/arch 多行登记 |
| `instance` 标签                        | 抓取目标身份（ip:port）   | Prometheus 抓取目标身份，端口 / 漂移会导致不稳定；**不作为业务稳定关联键**——业务关联走 `app` / `biz` / 稳定资源身份标签 |

> **提示分区规范**：原型 / 产品页面中的提示按受众分三类，避免相互干扰——
>
> 1. **用户 UI 文案**：面向运维工程师，**不含「决策 X」「PRD X.X」等实现层引用**，讲人话；
> 2. **产品 / 技术评审说明**：设计决策依据与 PRD 引用**集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区**，默认折叠，用户无感知，产品评审与开发可展开；
> 3. **开发 / AI 注释**：代码注释与 PRD 数据模型 / 技术字段承载实现细节与决策引用，供后续代码开发（含 AI）理解。
>
> 此规范使**用户看到干净的"未来原型雏形"**，同时**开发侧（含 AI）可从代码注释与 PRD 获取完整设计依据**。本规范由 `.kimi/agents/prototype-designer.md`「提示分区规范」强制执行，原型 MainLayout 提供全局折叠区承载本模块决策清单。

***

## 11. 前端交互契约

> 决策依据：design-decisions.md D1 / D11 / D12 / D13 / D16 / D22 / D26 / D27-2

### 11.1 页面状态矩阵

| 页面 | 状态 | 表现与文案 |
|------|------|-----------|
| 采集 Job 列表 | 加载中 | 表格骨架屏 |
| 采集 Job 列表 | 空态 | 「暂无采集 Job」，提供「新建采集 Job」引导 |
| 采集 Job 列表 | 接口错误 | Alert 提示「采集 Job 列表加载失败，请稍后重试」，提供「重新加载」按钮 |
| 采集 Job 列表 | 数据超量 | 表格分页（默认 20 条/页），支持按网域/监控对象类型/关键词筛选 |
| 采集 Job 详情 | 加载中 | 表单骨架屏 |
| 采集 Job 详情 | 接口错误 | Alert 提示「Job 详情加载失败，请稍后重试」，提供「返回列表」按钮 |
| 采集器管理页面 | 加载中 | 表格骨架屏 |
| 采集器管理页面 | 空态 | 「暂无默认采集配置」，提供「新增默认采集配置」引导；「登记采集器」为次级入口 |
| 采集器管理页面 | 接口错误 | Alert 提示「采集器数据加载失败，请稍后重试」，提供「重新加载」按钮 |
| 采集器管理页面 | 数据超量 | 表格分页，支持按监控对象类型/来源筛选 |
| 技术指标库 | 加载中 | 表格骨架屏 |
| 技术指标库 | 空态 | 「暂无指标数据」，提供「导入指标」引导 |
| 技术指标库 | 接口错误 | Alert 提示「指标库加载失败，请稍后重试」 |
| 业务指标库 | 加载中 | 表格骨架屏 |
| 业务指标库 | 空态 | 「暂无业务指标」，提供「登记业务指标」引导 |
| 业务指标库 | 接口错误 | Alert 提示「业务指标加载失败，请稍后重试」 |
| 安装登记（可选） | 加载中 | 列表骨架屏 |
| 安装登记（可选） | 空态 | 「尚无安装登记记录；登记为可选项，不影响采集生效，采集状态以『采集状态』列为准」 |
| 采集 Job 详情/编辑抽屉 | 实例采集状态回显 | 实例区顶部显示「在线 X / 总数 Y · 待采集 Z」；实例列表「采集状态」列：正常（低饱和）/ 异常（高饱和 + `lastError` 摘要 + 提醒「配置已下发但未采集到数据，请检查采集器安装与网络连通」）/ 待采集 / 未知；只读，15~30s 定时刷新 + 手动刷新 |
| 规则编辑（文件挂载·MVP） | 加载中 | 表格骨架屏 |
| 规则编辑（文件挂载·MVP） | 空态 | 「暂无规则」，提供「上传 / 粘贴 rules.yml 挂载」引导 |
| 规则编辑（文件挂载·MVP） | 接口错误 | Alert 提示「规则列表加载失败，请稍后重试」 |
| 规则编辑（文件挂载·MVP） | 保存成功 | Toast「已挂载，将由 M09 生成变更单」+「前往配置变更确认」跳转按钮 |
| 规则编辑（文件挂载·MVP） | 保存失败（YAML 非法） | Alert 置顶提示 YAML 语法错误（至少校验 `groups` 存在且为数组），表单保持当前内容 |
| 采集 Job 列表 | 草稿态占位 | MVP 阶段状态列展示「草稿」标签但无实例，标签灰显并 Tooltip「v0.3 支持保存草稿」，状态筛选器中「草稿」选项禁用；v0.3 起真实草稿对象显示为橙色 Tag 且可筛选 |
| 采集 Job 编辑（v0.3） | 草稿保存成功 | Toast「草稿已保存，当前配置不会进入下发管线」；表单保持打开，可继续编辑 |
| 采集 Job 编辑（v0.3） | 提交生效成功 | Toast「已提交生效，将由 M09 生成变更单」+「前往配置变更确认」跳转按钮 |
| 采集 Job 编辑（v0.3） | 提交生效失败 | Alert 置顶展示逐条校验错误（含必填项 / 网域 / 实例同域 / 规则 PromQL 等），表单保持当前值 |
| 采集 Job 列表（v0.3） | 批量提交结果 | 抽屉展示批量提交结果：成功 N 条（已转 ready）、失败 N 条（仍 draft，附逐条错误） |
| 采集 Job 列表（v0.3） | 批量提交生效 | 工具栏「批量提交生效」：多选草稿态对象后提交，`draft→ready` 单向（成功项转 `ready`、失败项保留 `draft` 并附逐条错误；`ready` 不再回退） |
| 采集 Job 列表 | 克隆（v0.3+ 待评估） | 操作列「克隆」→ 打开新建抽屉并预填源 Job 参数；跨网域克隆时目标网域需改选、实例清空重选，并提示「安装登记（可选）需在新 Job 中重新进行」 |
| 规则编辑（v0.3 字段化） | 空态 | 「暂无规则」，提供「新建规则」引导 |
| 规则编辑（v0.3 字段化） | 草稿保存成功 | Toast「规则草稿已保存」；允许 PromQL 半成品暂存 |
| 规则编辑（v0.3 字段化） | 提交生效失败 | 校验失败时 Alert 置顶，PromQL 错误定位到 expr 字段下方 |

### 11.2 全局行为规则

- **破坏性操作二次确认**：删除/禁用 Job、删除默认采集配置等操作前弹出 Modal 要求二次确认，并明确提示影响范围（如「删除后引用该配置的 Job 将失去默认值来源」）。
- **表单校验提示位置**：字段校验失败时错误提示置于字段下方；全局错误使用 Alert 置顶展示。
- **提交中防重复**：创建 / 编辑 / 保存按钮在提交期间置为 loading 并禁用，等待接口返回后再恢复。
- **空态依赖引导**：所有依赖外部模块的下拉选择器（网域来自 M09、标签模板来自 M07、采集器来自本 Tab 采集器池）在选项为空时，统一展示「说明文案 + 内联跳转/创建动作」：
  - 网域选择器空态：「暂无已纳管网域，请先到网域管理完成纳管」+ 内联跳转 M09
  - 采集器选择器空态：「未找到合适的采集器？登记采集器」+ 内联打开登记表单
  - 标签模板选择器空态：「该监控对象类型尚无标签模板，请先创建」+ 内联打开创建抽屉
- **异常驱动展示**：列表中的状态/同步/标签列采用异常驱动展示——正常态以低饱和标签或 `-` 呈现，异常态（如映射默认值已变更、标签模板待配置、网域未纳管）才使用高饱和/可点击 Tag；详情数据收进抽屉/Tooltip。
- **跨模块跳转**：跨模块跳转由统一导航配置承载，原型可暂用相对路径演示，实现期不得在代码中写死路径，统一走导航/路由配置。
- **变更引导提示**：采集 Job 与规则（文件挂载）保存/启停/删除成功提示由纯 toast 改为「变更将由 M09 生成变更单，需确认后生效」+「前往配置变更确认」跳转按钮。
- **参数继承来源视觉标记**：编辑表单中继承字段的 label 旁增加 inline Tag，标记来源状态（继承自映射/已覆盖/待同步），详见 5.4「参数继承来源视觉标记」。
- **认证/TLS 表单折叠区（MVP，决策 31）**：采集 Job 表单底部提供「认证与 TLS」**折叠面板**（默认折叠，不展开不增加裸 http 用户的视觉负担）：
  - 认证类型 `auth_type` 三选一（无认证 / Basic / Bearer）；选 Basic 展开 `username`/`password`（password 掩码输入、提交后不回显明文、支持「重新设置或清除」）；选 Bearer 展开 `token` 输入；
  - TLS 区提供 `tls_skip_verify` 开关与 `ca_file` 输入（可选）；折叠面板内联说明「认证/TLS 仅对 https 或需鉴权的目标生效，配置后由 M09 映射进 scrape_configs」；
  - 全部字段可选、默认 `auth_type=none` + `tls_skip_verify=false`，与既有裸 http 采集完全兼容。
- **草稿与提交生效双按钮（v0.3，仅新建对象）**：新建 Job 表单底部固定「保存草稿」（次级按钮）与「提交生效」（主按钮）：
  - 点「保存草稿」→ 基础校验通过即持久化，`draft_status=draft`；
  - 点「提交生效」→ 做完整校验（含必填项 / 网域已纳管 / 实例同域），通过后 `draft_status=ready` 且不再回退，进入 M09 变更检测管线；
  - 已生效对象的编辑仅提供普通「保存」，直接走 M09 变更单确认管线（不做草稿快照）。
- **草稿态不参与下发**：`draft_status=draft` 的对象不进入 M09 配置生成；前端状态列通过 `draft_status` 与 `change_status` 聚合，草稿态对象不展示 M09 `change_status`。
- **保存后乐观更新（MVP 起）**：Job / 规则保存成功后，前端本地先将该对象状态标记为「待下发」，无需等待 M09 轮询回写；下次列表刷新时以 M09 回写的 `change_status` 校准。
- **批量提交生效（v0.3，draft→ready 单向）**：列表支持多选草稿态对象，toolbar 展示「批量提交生效」；提交失败项保留 `draft` 并给出逐条错误，成功项转 `ready`；`ready` 不再回退；批量提交不阻塞已成功的项。
- **规则编辑草稿（v0.3）**：规则编辑表单同样提供「保存草稿」/「提交生效」（仅新建阶段）；草稿态允许 PromQL 半成品；提交生效时调用 Module_02 PromQL 校验，失败后定位到 `expr` 字段。
- **克隆 Job（v0.3+ 待评估，已移出 v0.2 范围，决策 54 扇出已覆盖跨网域复用主场景）**：列表操作列提供「克隆」入口 → 打开新建抽屉并预填源 Job 的采集参数 / 监控对象类型 / 采集实现 / 标签模板；同网域克隆可直接改选实例，跨网域克隆需改选目标网域、实例清空重选，并提示「安装登记（可选）需重新进行」；克隆产物为独立 Job，不引入「Job 模板」持久实体。
- **实例采集状态回显（决策 47-2）**：Job 详情/编辑抽屉实例区展示「在线 X / 总数 Y · 待采集 Z」汇总与实例级「采集状态」列；回显只读、异常驱动展示（正常低饱和、异常高饱和并附 `lastError` 摘要与「配置已下发但未采集到数据，请检查采集器安装与网络连通」提醒）；数据来自 Module_02 `/api/v1/targets` 代理，定时刷新（15~30s）+ 手动刷新，不阻断编辑与保存。

***

## Change Log

> **Change Log 定位**：本表为业务沟通决策的精简记录（**保留最近 3 版**一句话摘要）；**完整历史（v3.25 及以前的逐版变更详情）已迁移至 `docs/05-execution-records/module-01/design-decisions.md`「Change Log（完整历史）」小节**。Change Log 主要记录业务侧沟通决策与文档变更，**不承载开发契约**（开发契约见 5.x 数据模型 / 9 验收标准 / 10 术语映射）。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
| v3.30 | 2026-09-02 | 修改 | v0.2 范围收敛决策落版：①**克隆 Job 移出 v0.2 范围**，后续版本再评估是否提供（决策 54 网域集合 + M09 按域扇出已覆盖跨网域复用主场景）——§3.1 克隆行 / §5.4 / §6.2.2 clone 接口 / §9 验收 / §10 术语 / §11 前端契约同步标注 {v0.3+ 待评估}；②**草稿与批量提交生效交互挪 v0.3**（`draft_status` / `ready` 字段本身 MVP 已落库、默认 `ready` 不变，挪移的仅是「开放用户保存草稿 + 批量提交生效」UI/交互能力）——§3.1 / §5.4 / §8 ⑤ / §9 / §10 / §11 同步；③**业务健康度看板 / 业务负责人角色入口 / 业务域聚合视图**由 v0.2+ 挪 v0.3+——§2 M01-BIZ-02 / §3.1 / §5.9 / §10 同步；④**`service_discovery` 服务模式降级 v0.3+ 预留**——v0.2 容器实例资源监控明确走 cAdvisor 方案（每台虚机部署 cAdvisor exporter，作为普通采集 Job 绑定主机类资源 + filter 模式自动纳入新主机，容器发现由 cAdvisor 在宿主机内部完成、平台不感知容器个体，不需要 docker_sd），`docker_sd_configs` / `kubernetes_sd_configs` 仅当需直采容器内应用 /metrics（容器已发布端口或 host network）时在 v0.3+ 启用；⑤filter（决策 53）/ Job 多网域绑定 + M09 扇出（决策 54）/ 网域覆盖表 `CITypeExporterMappingOverride` 维持 v0.2 不变；⑥**新增实例级端口覆盖 v0.2 落地**——M07 Resource 增加可选 `scrape_port`，M09 端口解析优先级 = `Resource.scrape_port` → 网域覆盖表 → 映射默认（回落 `ExporterTemplate.default_port`），明确「Job 级端口映射表不做」（与动态纳入模式冲突、相关组织场景经确认不存在），§9.1 新增 {P0 / v0.2} 验收 | 2 / 3.1 / 5.1 / 5.4 / 5.6 / 5.9 / 6 / 8 / 9 / 10 / 11 | v0.2 / v0.3 | 设计中 |
| v3.29 | 2026-09-02 | 修改 | coverage 口径修订 + 默认模板身份标签收紧（联动 M02 v1.8 / M07 v2.25）：①§5.10 行为规则新增「与 coverage 三态的边界」——coverage/M07 badge 不感知 M09 下发时序、不区分「待采集」，「待采集 vs 已下发未采到」细分仅由本模块 Job 回显承担（本模块持有 `change_status`）；②§9.1 默认标签模板稳定身份标签验收由「`resource_id` / `hostname` 二选一」收紧为**必须含 `resource_id`**（决策 47-3 coverage 回连键，`hostname` 仅为可读别名）；纯契约收紧，原型行为不变 | 5.10 / 9.1 | MVP | 设计中 |
| v3.28 | 2026-08-31 | 新增 | 决策 53/54 落版（v0.2 契约）：①**filter 选择模式提前至 v0.2（决策 53）**——§3.1 实例选择行 / §5.4 字段表 `instance_selection_mode` / filter 模式字段语义 / §8 ② 状态机同步；核心语义：每生成周期实时求值，M07 新增资源匹配即自动纳入 targets、无需编辑 Job；②**Job 网域绑定放宽为网域集合（决策 54）**——§3.1 ScrapeJob 管理行 / §5.4 网域字段与约束 / 克隆 Job 行同步：一个逻辑 Job 可勾选多个已纳管网域，M09 按域拆分扇出（每域独立 scrape_configs / targets / 变更单），跨网域复用不再依赖手工克隆（克隆降级为复制便利），MVP 存量单值自动迁移为单元素集合；③§9.1 新增 2 条 v0.2 验收；MVP 行为不变；原型待对齐 | 3.1 / 5.4 / 8 / 9.1 | v0.2 | 设计中 |

> 完整 Change Log 历史（v3.25 及以前）见 `docs/05-execution-records/module-01/design-decisions.md`「Change Log（完整历史）」。
