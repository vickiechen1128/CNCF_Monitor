# 产品需求文档目录

> 本目录存放 MetricCenter 的产品需求文档（PRD）。  
> 为避免文档重复和理解偏差，各文档有明确职责边界。开发前应优先阅读本页。

---

## 文档职责一览

| 文档 | 职责 | 谁应该看 | 不重复写什么 |
|------|------|----------|--------------|
| [00_Product_Vision.md](00_Product_Vision.md) | 产品定位、核心价值、目标用户、边界、成功指标 | 所有人 | 不写具体技术架构、不写详细功能清单、不写开发顺序 |
| [00_Global_Architecture.md](00_Global_Architecture.md) | 系统总体架构、控制面/数据面分层、数据流、技术栈 | 架构师、后端开发、AI 开发 | 不写详细功能点、不写具体字段模型 |
| [01_User_Stories.md](01_User_Stories.md) | 用户故事、使用场景 | 产品经理、开发 | 不写实现方案 |
| [02_Product_Roadmap.md](02_Product_Roadmap.md) | 里程碑、开发顺序、各阶段交付物 | 项目经理、开发负责人 | 不写详细功能设计、不写实施难度矩阵 |
| [03_Functional_Architecture.md](03_Functional_Architecture.md) | 全量功能架构：模块 → 一级功能 → 二级功能 | 产品经理、开发 | 不写 Prometheus 复用度、不写落地难度 |
| [04_Implementation_Map.md](04_Implementation_Map.md) | 实施难度地图：Prometheus 复用度、前后端工作量、落地优先级 | 技术负责人、开发 | 不写功能详细定义、不写完整数据模型 |
| [05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md) | 代码实施计划（开发路径）：阶段划分、模块依赖与开发顺序、前后端分工、各阶段验收标准与风险规避 | 技术负责人、开发工程师、AI 开发（Orchestrator/子 Agent） | 不写功能详细定义（在 03 / Modules）、不写系统架构（在 00_Global_Architecture）、不写实施难度矩阵（在 04）、不写里程碑路线（在 02） |
| [Modules/*.md](Modules/) | 各模块详细需求：数据模型、接口、验收标准 | 对应模块开发 | 不写整体架构、不写演进路线 |

---

## 模块总览（Modules/）

共 11 个模块文档，详细需求、数据模型与验收标准见各模块文件：

| 模块 | 文档 | 主题 |
|------|------|------|
| Module 00 | [Module_00_Integration_Map.md](Modules/Module_00_Integration_Map.md) | 模块职责矩阵与集成关系 |
| Module 01 | [Module_01_Metric_Collection_Center.md](Modules/Module_01_Metric_Collection_Center.md) | 监控策略与指标管理 |
| Module 02 | [Module_02_Query_Center.md](Modules/Module_02_Query_Center.md) | 查询中心 |
| Module 03 | [Module_03_Gateway_and_Auth.md](Modules/Module_03_Gateway_and_Auth.md) | 网关与认证 |
| Module 04 | [Module_04_Custom_Discovery.md](Modules/Module_04_Custom_Discovery.md) | 自定义服务发现与外部 CMDB 生命周期管理 |
| Module 05 | [Module_05_Custom_UI.md](Modules/Module_05_Custom_UI.md) | 自定义前端门户 |
| Module 06 | [Module_06_Multi_Tenant.md](Modules/Module_06_Multi_Tenant.md) | 系统与平台管理（含多租户） |
| Module 07 | [Module_07_Monitoring_Object_Management.md](Modules/Module_07_Monitoring_Object_Management.md) | 监控对象管理 |
| Module 08 | [Module_08_Alertmanager_Notification_Management.md](Modules/Module_08_Alertmanager_Notification_Management.md) | 告警规则管理 |
| Module 09 | [Module_09_Network_Domain_and_Edge_Config_Center.md](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) | 网域与边缘配置中心 |
| Module 10 | [Module_10_Monitoring_Source_Registry.md](Modules/Module_10_Monitoring_Source_Registry.md) | 监控源登记册与异构接入 |

---

## 关键决策归属

遇到以下问题时，应优先查看对应文档：

| 问题 | 查看文档 |
|------|----------|
| 这个产品要解决什么问题？目标用户是谁？ | [00_Product_Vision.md](00_Product_Vision.md) |
| 控制面和数据面如何划分？技术栈是什么？ | [00_Global_Architecture.md](00_Global_Architecture.md) |
| MVP 要做到什么？未来分几阶段？ | [02_Product_Roadmap.md](02_Product_Roadmap.md) |
| 有哪些模块和功能？ | [03_Functional_Architecture.md](03_Functional_Architecture.md) |
| 这个功能落地难不难？是否需要自研后端？ | [04_Implementation_Map.md](04_Implementation_Map.md) |
| 按什么顺序开发？每个阶段交付什么、怎么验收、前后端怎么分工？ | [05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md) |
| 这个模块的字段、接口、验收标准是什么？ | [Modules/对应模块.md](Modules/) |

---

## 防止重复的约定

1. **00_Product_Vision.md 只写"为什么"和"是什么"**：不写架构图、不写功能清单细节、不写技术演进表格。
2. **00_Global_Architecture.md 只写"整体怎么搭"**：不写具体字段、不写每个功能的二级菜单。
3. **02_Product_Roadmap.md 只写"什么时候做"和"做到什么程度"**：不写实施难度矩阵（在 04_Implementation_Map 中）。
4. **03_Functional_Architecture.md 只写"有什么功能"**：不写 Prometheus 复用度评估。
5. **04_Implementation_Map.md 只写"落地难度和优先级"**：不写功能完整定义。
6. **Modules/*.md 只写"这个模块怎么做"**：不写整体架构、不写演进路线。
7. **05_Code_Implementation_Plan.md 只写"怎么落地开发"**：不写功能完整定义（在 03 / Modules）、不写系统架构（在 00_Global_Architecture）、不写实施难度矩阵（在 04）、不写里程碑路线（在 02）。

---

## 阅读顺序

### 首次了解项目

1. [00_Product_Vision.md](00_Product_Vision.md) — 理解产品定位
2. [00_Global_Architecture.md](00_Global_Architecture.md) — 理解技术架构
3. [02_Product_Roadmap.md](02_Product_Roadmap.md) — 理解阶段规划

### 查看整体开发路径与阶段

1. [05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md) — 从当前状态到 MVP / v1.0 的开发阶段、模块依赖顺序、前后端分工、各阶段验收标准

### 准备开发某个模块

1. [03_Functional_Architecture.md](03_Functional_Architecture.md) — 找到对应模块的功能范围
2. [04_Implementation_Map.md](04_Implementation_Map.md) — 评估落地难度和优先级
3. [05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md) — 查看该模块所属开发阶段、前后端分工与验收标准
4. [Modules/对应模块.md](Modules/) — 查看详细需求、数据模型、验收标准

---

## MVP 关键结论速查

- **资源管理**：三类固定资源（Host / Middleware / Application），Excel 导入，字段固定，必须归属网域（MVP 默认 `default`）
- **网域模型**：MVP 预置默认网域 `default`，数据模型已为多网域物理隔离场景预留扩展
- **告警规则**：MVP 不写 UI，直接编辑 `rules.yml`
- **告警收敛/静默/通知**：MVP 借助 Alertmanager 原生能力
- **拨测**：使用 Blackbox Exporter，MetricCenter 只生成配置
- **时序存储**：MVP 用 Prometheus TSDB；多网域场景演进为 VictoriaMetrics / Mimir
- **平台元数据**：MVP 用 SQLite
- **代码隔离**：所有业务代码在 `platform/` 和 `ui-custom/`，不修改 `upstream/`
