# Grill Record: 监控策略管理方案设计

- **Date**: 2026-07-31
- **Topic**: 监控策略管理方案设计 —— 基于 CI 的采集 Job、Exporter、指标与规则管理
- **Document**: `docs/decisions/grill-2026-07-31-monitoring-strategy-management.md`

## Summary of decisions

| # | Decision | Rationale | Stage / Impact |
|---|----------|-----------|----------------|
| 1 | Job 与 Exporter 强绑定，因此与 CI 类型挂钩 | Prometheus scrape job 的本质是指定 exporter endpoint + 抓取参数；不同 CI 类型（host / mysql / redis）对应不同 exporter | MVP |
| 2 | 新增 **CI 类型 ↔ Exporter 模板** 绑定表 | 工程师选定 CI 类型后，系统才能推荐合适的 Exporter、默认端口和采集路径 | MVP 数据模型扩展 |
| 3 | 监控策略功能由 **Module_01** 承担，Module_01 改名为「**监控策略与指标管理**」 | 与监控对象管理（Module_07）、配置下发（Module_09）解耦，形成独立策略层 | MVP 架构调整 |
| 4 | **Module_07** 改名为「**监控对象管理**」，聚焦 Resource + LabelTemplate + Excel 导入 | 策略模块不再兼任对象管理；对象层只负责资源本身和标签模板 | MVP 架构调整 |
| 5 | Module_01 原有运行时展示功能（目标状态列表、拨测结果展示）被 **Module_02 / Module_08** 吸收 | 避免 Module_01 职责过载；Module_02 代理查询、Module_08 代理告警状态 | MVP |
| 6 | 策略模块把 Job 写入 DB，**Module_09 轮询生成配置**、提供预览、人工确认后下发 | 策略与配置下发解耦；支持人工兜底，避免平台 bug 导致整个监控 down | MVP |
| 7 | 增加 **Exporter 安装确认 / 注册** 步骤 | 隔离网域下 exporter 只能线下安装，平台需要知道目标上是否已安装 exporter，避免 target 全部 down | MVP |
| 8 | MVP 规则编辑形态：**类 YAML 表单 + PromQL 校验 + 指标实时预览** | 完全图形化规则构建器工作量大；类 YAML 表单可降低门槛又不引入复杂数据模型 | MVP |
| 9 | Exporter 指标映射为**静态库表**；MVP 内置常见 exporter 指标，完整管理页面放 P1/P2 | 平台无法直接读取各 exporter；静态库是必要妥协 | MVP / P1 |
| 10 | MVP 先做**手动勾选实例**，筛选模式后续支持；CMDB/Excel 新增实例需进入策略模块「确认勾选」 | 自动纳入监控在隔离网域下风险高；人工确认更可控 | MVP |
| 11 | MVP 在 **Resource 列表展示「已监控 / 未监控」badge** | 让工程师快速发现哪些实例尚未被任何 Job 选中 | MVP |
| 12 | **Module_09 改名为「网域与边缘配置中心」**，承担配置生成 / 预览 / 下发 | 与 Edge Agent 配置拉取天然关联；MVP 默认单网域也成立 | MVP 命名调整 |
| 13 | 平台只保证「通过 UI 下发的配置」一致，**允许本地手工兜底** | 防止平台自身故障导致监控系统整体失效 | MVP |

## 调整后模块职责

| 模块 | 新名称 | MVP 核心职责 | 不做什么 |
|------|--------|-------------|----------|
| Module_01 | 监控策略与指标管理 | CI 类型 ↔ Exporter 模板绑定、ScrapeJob 配置、实例选择、规则编辑 UI、指标元数据管理（P1） | 目标状态运行时展示、配置下发 |
| Module_07 | 监控对象管理 | Resource CRUD、Excel 导入、LabelTemplate、Resource「已监控/未监控」badge | ScrapeJob 配置、规则编辑、配置生成下发 |
| Module_09 | 网域与边缘配置中心 | NetworkDomain / EdgeAgent 生命周期、配置生成 / 预览 / 下发 | CI/Job/Rule 的策略定义 |
| Module_02 | 查询中心 | PromQL 代理、目标状态展示（吸收原 Module_01 运行时展示） | 策略配置 |
| Module_08 | 告警规则管理 | 告警规则生命周期（分组、静默、Alertmanager 配置）、告警状态展示 | 规则编辑 UI（移交 Module_01） |
| Module_04 | 自定义服务发现与外部 CMDB 生命周期管理 | v0.4+ CMDB 同步、Provider 扩展、待分类 CI 队列 | 策略配置、对象 CRUD |

## Open risks and trade-offs

- **静态 Exporter 指标库可能过时**：不同 exporter 版本指标集合不同，MVP 内置库需要随版本升级维护，否则规则编辑时的指标提示会误导用户。
- **手动勾选实例导致监控覆盖延迟**：CMDB/Excel 新增实例后，若工程师未及时进入策略模块确认，这些实例会长期处于未监控状态。
- **本地手工兜底可能造成配置漂移**：DB 是期望状态，磁盘是实际状态，若允许工程师直接改 `prometheus.yml`，平台不强制 reconcile，可能出现「UI 显示已下发但实际不生效」的隐患。
- **Module_01 职责仍然较宽**：策略配置 + 指标元数据 + 规则编辑 UI 都归 Module_01，后续需要关注是否再次膨胀。
- **Module_01 与 Module_08 边界需细化**：规则编辑 UI 在 Module_01，告警规则生命周期（分组、静默、Alertmanager）在 Module_08，两者的接口和状态同步需要明确。
- **Module_07 向 Module_01/09 提供数据契约**：Module_07 的 Resource 和 LabelTemplate 是策略模块与配置中心的基础依赖，其稳定性变得更加关键。

## Action items

- [x] 更新 `Module_01_Metric_Collection_Center.md`：改名为「监控策略与指标管理」；重新定义职责范围；新增 CI 类型 ↔ Exporter 模板绑定、ScrapeJob 配置、实例选择、规则编辑 UI 章节。
- [x] 更新 `Module_07_Monitoring_Object_Management.md`：改名为「监控对象管理」；移除 ScrapeJob / 配置生成 / 配置下发职责；保留 Resource、LabelTemplate、Excel 导入；新增 Resource「已监控 / 未监控」badge。
- [x] 更新 `Module_09_Network_Domain_and_Edge_Config_Center.md`：改名为「网域与边缘配置中心」；新增配置生成 / 预览 / 下发流程与 API。
- [x] 更新 `Module_08_Alerting_Rule_Management.md`：明确规则编辑 UI 移交 Module_01；Module_08 聚焦告警规则生命周期、分组、静默、Alertmanager 配置。
- [x] 更新 `Module_00_Integration_Map.md`：重新划分模块职责矩阵与跨模块引用关系。
- [x] 更新 `03_Functional_Architecture.md`、`04_Implementation_Map.md`、`05_Code_Implementation_Plan.md`：按新模块划分调整流程、实施矩阵与开发顺序。
- [x] 设计 CI 类型 ↔ Exporter 模板绑定数据模型（含默认端口、metrics_path、scheme、标签模板引用）。
- [x] 设计 Exporter 指标静态库数据模型（内置指标 + 用户扩展机制）。
- [x] 设计 Exporter 安装确认状态字段（Resource 或独立 TargetRegistration 表）。
- [x] 设计配置中心轮询生成配置的机制（期望态 DB → 草稿预览 → 人工确认 → 下发 reload）。

## Full Q&A log

### Batch 1：监控策略主流程与模块边界

**Q1**：你描述的流程是 CI → Job → Target → Metric → Rule，但当前 Module_07 的 Job 管理是「按资源类型 / env / app / cluster 筛选目标」，而不是「先选定某个 CI 再指定 Job」。MVP 工程师到底是在配筛选规则，还是在手动勾选实例？

**A**：Job 的配置是和 Exporter 强绑定的，既然和 Exporter 强绑定，就会和 CI 挂钩。

**Q2**：Module_01 和 Module_07 都把「采集 Job 管理」「标签模板管理」列为核心功能，未来边界如何切分？

**A**：标签模板管理放在 Module_07，可以叫做监控对象管理；监控策略功能单独设置，采集 Job 管理可以是策略模块的核心功能。

**Q3**：你说「按 CI 模型安装 Exporter 引入指标」，但 PRD 里 Exporter 市场是 P2，MVP 怎么落地？

**A**：隔离网域下安装 exporter 是线下手动安装，平台上是否只能是口号，请从技术判断。

**Q4**：MVP 手写 `rules.yml`，但指标元数据管理是 P1，监控策略是否只完成了「采」没有完成「策」？

**A**：希望在 UI 上针对指标配置检测规则，但考虑指标量大、UI 复杂。如果工作量可控，就不需要手写 `rules.yml`。`rules.yml` 原计划是一个编辑版面，不同 CI 配置对应采集 Job 后，在简单 UI 上手动编辑 rules。

**Q5**：Module_07 流程图显示 `API -> CMDB: 存储资源`，但 CMDB 同步是 v0.4+ 能力，MVP 目标到底来自哪里？

**A**：MVP Target 来自 Excel 导入的 Resource；v0.4+ 才引入 Provider 接口能力。

### Batch 2：Job 与 Exporter 的绑定、策略模块的归属、规则 UI 的 MVP 形态

**Q1**：Job 既然与 Exporter 强绑定，MVP 是否必须有一张 CI 类型 → Exporter 模板的绑定表？

**A**：对，需要有一张表把模板和 `resource_type` 关联起来。

**Q2**：策略模块独立后，配置生成与下发该跟谁走？

**A**：配置下发中心是重要核心功能。监控策略管理跟着 CI 和监控对象走；配置生成和下发中心是对不同监控 agent 和监控 server 端进行关联。生成配置文件的接口肯定和采集 Job 关联，这个核心功能本想等监控策略想清楚后再重点设计。

**Q3**：隔离网域下 Exporter 线下安装，平台怎么知道目标上真的跑了 Exporter？

**A**：请加上「Exporter 安装确认 / 注册」，哪怕只是工程师手动勾选「已安装」。

**Q4**：MVP 规则编辑 UI 的最低可行形态是什么？

**A**：接受类 YAML 的表单（expr / for / labels / annotations）+ PromQL 校验 + 指标实时预览。

**Q5**：四个模块（Module_07/01/09/08）同时触碰 Job/Rule/配置生成，是否更清晰？监控策略模块的最小职责是什么？

**A**：监控策略模块在 MVP 的最小职责是帮助工程师对引入的 CI 对象做好采集 Job 的配置，映射到 Exporter 对应的指标，并让其勾选需要监控的具体实例，且提供 rules 的 UI 编辑界面。绝不做针对监控边缘 agent 和监控 server 端的配置下发和管理。

### Batch 3：策略模块与配置下发的边界、Exporter 指标库、实例选择模式

**Q1**：策略模块写 Job 到 DB 后，由谁生成配置并下发？

**A**：策略模块把 job 写入 DB 后由配置中心定时轮询生成比较合理；配置中心会形成草稿状态供预览，人工确认后再下发。

**Q2**：Exporter 版本和指标是否需要管理页面？

**A**：是否需要一个管理页面，专门让运维管理人员维护 Exporter 的版本和指标，可以提出建议。

**Q3**：实例选择是筛选还是手动勾选？新增实例如何处理？

**A**：筛选和手动选择都支持，MVP 先做手动勾选。CMDB 发现新实例后，监控平台需要手动确认，进入策略模块「确认勾选」。监控平台要能看到实例未被监控的状态。

**Q4**：标签模板留在 Module_07，策略模块消费它， Module_07 是否变成 Label-as-a-Service？

**A**：按目前构思，Module_01 的功能就不是必须的功能，优先级可以降低。

**Q5**：Module_01 在 MVP 是否还需要？

**A**：倾向于 Module_01 在 MVP 不作为一个独立开发模块，运行时展示功能被 Module_02 和 Module_08 吸收。

### Batch 4：配置漂移、未监控状态、Exporter 指标库、Module_01 的去留

**Q1**：策略模块只写下发配置，若工程师直接修改磁盘上的 `prometheus.yml`，平台是否强制覆盖？

**A**：平台只保证「通过 UI 下发的配置」一致，允许本地手工兜底，以防止平台出现 bug 导致整个监控系统 down 掉。

**Q2**：Exporter 版本和指标管理页面是否必须进入 MVP？

**A**：接受折中：MVP 内置静态库，完整管理页面放 P1/P2。

**Q3**：「未监控实例」状态是否必须在 MVP 完整实现？

**A**：接受 MVP 只做一个简单的 Resource 列表上的「已监控 / 未监控」badge。

**Q4**：Module_01 是否降级？

**A**：倾向于 Module_01 在 MVP 不作为一个独立开发模块，运行时展示功能被 Module_02 和 Module_08 吸收。

**Q5**：策略模块作为新模块还是合并到现有模块？

**A**：想把策略模块合并到现有模块，把 Module_01 原有的功能拆分后，Module_01 改名为「监控策略与指标管理」。

### Batch 5：配置中心的归属与 Module_09 命名

**Q**：配置生成 / 预览 / 下发中心放到哪个模块？

**A**：放到 Module_09（网域与边缘 Agent 管理）比较合适，因为天然涉及配置下发。

**Q**：Module_09 的新名称是什么？

**A**：选择「网域与边缘配置中心」。
