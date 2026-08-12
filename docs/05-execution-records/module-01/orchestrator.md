# 执行记录：module-01 网域约束与配置触发边界对齐

## 日期

2026-08-04

## 触发

用户对 Module_01 监控策略管理的网域约束、采集 Job 绑定关系，以及 Module_09 配置生成触发职责边界提出疑问。

## 问题记录

1. **标准 ScrapeJob 缺少网域约束**：Module_01 PRD 5.4 中 `network_domain_id` 仅有字段定义（归属网域），无"必填 / 单一 / 禁跨域"约束说明；仅 `job_type=blackbox` 类型有显式约束。PRD 存在不一致缺口。
2. **绑定维度不清**：用户不确定采集 Job / 规则编辑功能是否与"管理域"绑定。
3. **触发职责边界不清**：用户不确定"触发 Module_09 配置变化"由哪个模块主负责（Module_09 还是 Module_01），边界如何划分。
4. **触发机制待澄清**：是否为异步轮询。

## 对齐结论（与用户确认）

1. **绑定维度**：采集 Job 绑定「网域」维度（`network_domain_id`），非特指管理域 `default`；`default` 只是中心管理域，存在其他 `edge` 域。
2. **网域约束**：所有 ScrapeJob（`standard` + `blackbox`）必须绑定且仅绑定单一 `network_domain_id`；实例选择时 `selected_instance_ids` 的 Resource 必须与 Job 同域。
3. **职责边界**：
   - Module_01/07 = 数据写入方（Source of Truth）：只负责策略/资源落库并维护 `updated_at`，**不主动通知、不感知 Module_09**；
   - Module_09 = 配置唯一生成者（Consumer）：负责「变更检测 → 生成 → checksum 裁决 → 草稿 → 人工确认 → 下发」全链路。
4. **触发机制**：**pull 模式异步轮询**（默认 30s）。决策 7 中"XX 变更触发 Module_09 重算"的语义 =「Module_09 轮询时检测到 XX 的 `updated_at` 变化」，而非事件推送。人工确认 / 中心 reload 为同步操作，草稿检测与边缘拉取为异步。

## 待办

- [x] 需求对齐并记录结论（本文件 + design-decisions.md 决策 10）
- [x] prototype-designer 更新 Module_01 PRD：标准 ScrapeJob 网域约束（v1.3）
- [x] prototype-designer 更新 Module_09 PRD：触发语义澄清、边界职责、时序流程图（v1.5）

## 补充对齐：MVP 指标库最小集（2026-08-04）

用户确认：指标库内置列表的 Exporter 范围**跟随当前 CMDB 的 CI 类型**（host / middleware / application / generic_target），按 CI 类型预置指标数量；后续保持现有能力，用户可手动导入和更新指标库。

- [x] Module_01 PRD 更新至 **v1.4**：5.3 新增「MVP 指标库最小集」清单表（node-exporter / mysqld-exporter / redis-exporter / kafka-exporter / blackbox-exporter 及数量范围）、用户手动导入/更新/覆盖/禁用机制（P1），验收标准同步更新
- [x] design-decisions.md 新增决策 11，全部待确认项已勾除

## 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/05-execution-records/module-01/design-decisions.md`
