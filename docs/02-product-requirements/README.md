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
| [Modules/SRS/_TEMPLATE.md](Modules/SRS/_TEMPLATE.md) | SRS 模板：场景 SCN、FR/NFR、非目标、验收；不写实现细节 | 需求方、技术方 | 不写具体模块内容 |
| [Modules/SRS/*.md](Modules/SRS/) | 需求规格说明书（SRS）：业务场景（SCN）、FR/NFR、验收；不写接口/字段/页面实现 | 产品、测试、开发（了解范围） | 设计细节（在 [docs/07-design/](../07-design/)） |
| [Domain_Map.md](Domain_Map.md) | 业务域（DOMAIN）↔ 实现模块（mXX）映射 | 需求方、技术方 | 不写需求细节 |
| [Modules/Module_00_Integration_Map.md](Modules/Module_00_Integration_Map.md) | 历史模块职责矩阵（索引性质；11 个 PRD 已移除） | 架构师、AI Agent | 不写新需求（以 SRS 为准） |

> **需求与设计分层**：SRS 只放需求；接口契约、字段、数据模型、算法、状态机、页面交互、测试设计等放在 [docs/07-design/](../07-design/)。两者通过 FR/NFR 编号追溯，不互相复制。

---

## 模块文档（Modules/）

> **2026-11-20 文档收敛**：11 个历史 PRD（`Module_01` ~ `Module_11`）已移除，Git 历史可追溯；需求以 `Modules/SRS/` 下的 SRS 为唯一基线，设计以 `docs/07-design/` 为准。`Module_00` 保留为历史集成索引。

| 模块 | 文档 | 主题 |
|------|------|------|
| Module 00 | [Module_00_Integration_Map.md](Modules/Module_00_Integration_Map.md) | 历史模块职责矩阵（索引性质） |
| Module 01 | [SRS](Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md) | 采集策略与指标管理 |
| Module 02 | [SRS（并入 M09）](Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) | 查询中心 |
| Module 03 | —（PRD 已移除，无 SRS） | 网关与认证 |
| Module 04 | —（PRD 已移除，无 SRS） | 自定义服务发现 |
| Module 05 | [SRS](Modules/SRS/Module_05_Visualization_Center_Requirements.md) | 可视化中心 |
| Module 06 | [SRS](Modules/SRS/Module_06_Multi_Tenant_Requirements.md) | 系统与平台管理（含多租户） |
| Module 07 | [SRS](Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md) | 监控对象管理 |
| Module 08 | [SRS](Modules/SRS/Module_08_Alertmanager_Notification_Management_Requirements.md) | 告警收敛与通知管理 |
| Module 09 | [SRS](Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) | 配置与查询中心 |
| Module 10 | —（PRD 已移除，无 SRS） | 监控源登记册 |
| Module 11 | [SRS（并入 M09）](Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) | 网域边缘接入 |

---

## 关键决策归属

遇到以下问题时，应优先查看对应文档：

| 问题 | 查看文档 |
|------|----------|
| 这个产品要解决什么问题？目标用户是谁？ | [00_Product_Vision.md](00_Product_Vision.md) |
| 控制面和数据面如何划分？技术栈是什么？ | [00_Global_Architecture.md](00_Global_Architecture.md) |
| MVP 要做到什么？未来分几阶段？ | [02_Product_Roadmap.md](02_Product_Roadmap.md) |
| 有哪些模块和功能？ | [Modules/SRS/](Modules/SRS/) + [00_Global_Architecture.md](00_Global_Architecture.md) |
| 这个功能落地难不难？是否需要自研后端？ | [docs/07-design/](../07-design/) + 模块 SRS |
| 按什么顺序开发？ | [02_Product_Roadmap.md](02_Product_Roadmap.md) + `docs/05-execution-records/rewrite/v2.0/plan.md` |
| 这个模块的需求与验收是什么？ | [Modules/SRS/](Modules/SRS/) |

---

## 防止重复的约定

1. **00_Product_Vision.md 只写"为什么"和"是什么"**：不写架构图、不写功能清单细节、不写技术演进表格。
2. **00_Global_Architecture.md 只写"整体怎么搭"**：不写具体字段、不写每个功能的二级菜单。
3. **02_Product_Roadmap.md 只写"什么时候做"和"做到什么程度"**：不写实施难度矩阵。
4. **Modules/SRS/*.md 只写"这个模块做什么、验收什么"**：不写接口、字段、算法与页面实现。
5. **开发顺序与拆分**：以 `docs/05-execution-records/rewrite/v2.0/plan.md` + 模块 `task-sequence.yaml` 为准，不在本目录重复维护。

---

## 阅读顺序

### 首次了解项目

1. [00_Product_Vision.md](00_Product_Vision.md) — 理解产品定位
2. [00_Global_Architecture.md](00_Global_Architecture.md) — 理解技术架构
3. [02_Product_Roadmap.md](02_Product_Roadmap.md) — 理解阶段规划

### 准备开发某个模块

1. [Modules/SRS/对应模块.md](Modules/SRS/) — 查看需求与验收
2. [docs/07-design/](../07-design/) — 查看接口/数据/流程设计
3. `docs/05-execution-records/rewrite/v2.0/plan.md` + 模块 `task-sequence.yaml` — 查看当前开发顺序与任务拆分

### 历史规划（已归档）

- [V2 功能架构 / 实施地图 / 代码计划](../05-execution-records/archive/v2-planning/) — 仅作历史追溯，不再维护

---

## MVP 关键结论速查

- **资源管理**：三类固定资源（Host / Middleware / Application），Excel 导入，字段固定，必须归属网域（MVP 默认 `default`）
- **网域模型**：MVP 预置默认网域 `default`，数据模型已为多网域物理隔离场景预留扩展
- **告警规则**：MVP 不写 UI，直接编辑 `rules.yml`
- **告警收敛/静默/通知**：MVP 借助 Alertmanager 原生能力
- **拨测**：使用 Blackbox Exporter，MetricCenter 只生成配置
- **时序存储**：MVP 用 Prometheus TSDB；多网域场景演进为 VictoriaMetrics / Mimir
- **平台元数据**：PostgreSQL（生产与测试统一，SQLite 已移除）
- **代码隔离**：所有业务代码在 `platform/` 和 `ui-custom/`，不修改 `upstream/`
