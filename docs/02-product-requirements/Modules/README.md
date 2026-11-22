# 模块文档索引

> **2026-11-20 文档收敛**：11 个历史 PRD（`Module_01` ~ `Module_11`）已移除，Git 历史可追溯。当前需求以 `SRS/` 为唯一基线，设计以 `docs/07-design/` 为准；`Module_00` 保留为历史集成索引。

## 1. 需求规格说明书（SRS）

| 模块 | 文档 | 说明 |
|------|------|------|
| Module 01 | [Module_01_Metric_Collection_Center_Requirements.md](SRS/Module_01_Metric_Collection_Center_Requirements.md) | 采集策略与指标管理 |
| Module 01 | [Module_01_Job_Group_and_Object_First_SRS.md](SRS/Module_01_Job_Group_and_Object_First_SRS.md) | 任务组 / 对象优先补充 SRS |
| Module 05 | [Module_05_Visualization_Center_Requirements.md](SRS/Module_05_Visualization_Center_Requirements.md) | 可视化中心 |
| Module 06 | [Module_06_Multi_Tenant_Requirements.md](SRS/Module_06_Multi_Tenant_Requirements.md) | 系统与平台管理（含多租户） |
| Module 07 | [Module_07_Monitoring_Object_Management_Requirements.md](SRS/Module_07_Monitoring_Object_Management_Requirements.md) | 监控对象管理 |
| Module 08 | [Module_08_Alertmanager_Notification_Management_Requirements.md](SRS/Module_08_Alertmanager_Notification_Management_Requirements.md) | 告警收敛与通知管理 |
| Module 09 | [Module_09_Network_Domain_Access_and_Query_Center_Requirements.md](SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) | 配置与查询中心 |

> Module 02（查询中心）与 Module 11（网域边缘接入）已并入 M09 SRS；Module 03/04/10 历史 PRD 已移除且暂无 SRS。

## 2. 概要设计

| 模块 | 文档 | 说明 |
|------|------|------|
| Module 09 | [Module_09_Config_and_Query_Center_High_Level_Design.md](../../07-design/Module_09_Config_and_Query_Center_High_Level_Design.md) | 概要设计（接口清单 / 数据归属 / 关键流程 / 追溯） |
| Module 09 | [design-notes/](../../07-design/design-notes/) | 3 个关键设计专题 |

## 3. 历史索引

| 文档 | 说明 |
|------|------|
| [Module_00_Integration_Map.md](Module_00_Integration_Map.md) | 历史模块职责矩阵（索引性质；PRD 已移除） |

## 4. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v2.02 | 2026-11-20 | 移除 11 个历史 PRD，索引收敛为 SRS + 概要设计；M09 SRS v1.10、HLD v1.0 |
| v2.01 | 2026-11-20 | M09 SRS v1.9：SRS/详细设计分层试点；模块改名「配置与查询中心」；新增 FR-22 |
