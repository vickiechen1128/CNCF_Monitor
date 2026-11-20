# 设计文档目录（概要设计 + 关键设计专题）

> 本目录存放各模块的**概要设计（HLD）**与**关键设计专题**。需求在 `docs/02-product-requirements/Modules/SRS/`，字段级契约以 `api-contract-snapshot-v3.md` 为准。

---

## 1. 分层约定

| 文档 | 回答的问题 | 维护频率 | 位置 |
|------|------------|----------|------|
| SRS | 做什么、为什么、验收 | 需求变更 | `docs/02-product-requirements/Modules/SRS/` |
| 概要设计（HLD） | 模块边界、接口清单、数据归属、关键流程、约束、风险 | 架构/接口变更 | 本目录 |
| 关键设计专题 | 高风险/反直觉/易回归的实现 | 算法或交互变更 | `design-notes/` |
| 接口契约 | 字段、错误码、分页 | 接口变更（机器可校验） | `api-contract-snapshot-v3.md` / OpenAPI |
| 决策记录（ADR） | 为什么这么选、放弃了什么 | 决策变更 | `docs/05-execution-records/*/design-decisions.md` |
| 测试 | 可执行的边界与契约 | 随代码 | 代码 |

原则：**代码与测试是实现细节的最终事实来源**；概要设计只保留稳定、需要跨人协作的上下文，不复制字段表/组件/用例清单。

---

## 2. 命名与结构

```text
docs/07-design/
├── README.md
├── Module_XX_<Module_Name>_High_Level_Design.md
└── design-notes/
    └── mXX-<topic>.md
```

体量建议：

- 概要设计 ≤ 10 页（约 300–500 行）；
- 单个专题 ≤ 3 页；
- 决策记录 1 页/条。

---

## 3. 索引

| 模块 | 概要设计 | 关键设计专题 | 对应 SRS |
|------|----------|--------------|----------|
| Module 01 监控策略与指标管理 | [Module_01_Metric_Collection_Center_High_Level_Design.md](Module_01_Metric_Collection_Center_High_Level_Design.md) | [规则检查与提交门禁](design-notes/m01-rule-validation-gate.md) | [M01 SRS](../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)、[任务组增量 SRS](../02-product-requirements/Modules/SRS/Module_01_Job_Group_and_Object_First_SRS.md) |
| Module 09 配置与查询中心 | [Module_09_Config_and_Query_Center_High_Level_Design.md](Module_09_Config_and_Query_Center_High_Level_Design.md) | [PromQL 网域注入](design-notes/m09-promql-domain-injection.md)、[配置生成与原子发布](design-notes/m09-config-generation-and-publish.md)、[指标查询页交互](design-notes/m09-query-page-ux.md) | [M09 SRS](../02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) |

> 其他模块按同一模板逐步补齐。

---

## 4. 维护规则

- **只在稳定内容上写**：接口/数据/决策/安全变更才更新；代码重构不改文档。
- **字段不抄**：接口字段以契约为准；文档只写接口清单 + 语义 + 错误策略。
- **不写测试清单**：测试矩阵放在专题或测试代码，避免第二套用例。
- **专题触发**：安全隔离、状态机、算法、复杂交互才开专题；CRUD 不开。
- **AI 上下文**：SRS + HLD + 契约 + 相关代码/测试；不要喂整份历史详细设计。
- **历史文档**：旧 PRD 与旧详细设计目录已移除；Git 历史可追溯，不再维护。
