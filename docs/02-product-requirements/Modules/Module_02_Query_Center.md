# Module 02: 查询中心

> **模块类型**: 核心能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)  
> **目标用户**: 运维工程师、业务研发工程师、AI 应用开发工程师  
> **版本**: v2.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

提供统一的指标查询入口，降低 PromQL 使用门槛，支持 AI 应用通过 Open API 消费指标数据。

MVP 阶段聚焦基础 PromQL 查询与结果展示，**不引入复杂 Dashboard 编辑器**。

> **与 Module 08 的边界**：告警状态查看能力由 [Module 08: 告警规则管理](Module_08_Alerting_Rule_Management.md) 从功能上拥有；本模块在 MVP 阶段仅作为查询代理暴露 `/api/v1/alerts`。

---

## 2. 用户故事

- OPS-03：在门户中执行 PromQL 查询
- OPS-07：查看当前告警状态
- AI-01：通过稳定 API 获取指标数据
- AI-02：批量查询多个时间序列
- DEV-01：查看我负责服务的指标数据

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| PromQL 查询 | 支持 instant / range 查询 | P0 |
| 告警状态查看 | 代理 Prometheus `/api/v1/alerts`，展示当前告警；功能 Owner 为 Module 08 | P1 |
| 查询辅助 | 指标名补全、标签建议、常用查询模板 | P1 |
| 结果展示 | 表格视图、JSON 视图、简单折线图 | P1 |
| Open API | 提供 RESTful API 供外部系统调用 | P1 |
| 批量查询 | 支持一次查询多个表达式 | P2 |
| 复杂 Dashboard | 拖拽式面板编辑器 | P2（不做） |

---

## 4. 接口设计

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/v1/query | POST | 执行 PromQL instant query |
| /api/v1/query_range | POST | 执行 PromQL range query |
| /api/v1/labels | GET | 获取所有 label names |
| /api/v1/label/:name/values | GET | 获取 label 所有值 |
| /api/v1/series | GET | 查询匹配的 series |
| /api/v1/alerts | GET | 获取当前告警状态（MVP 只读） |

> 以上接口均为代理 Prometheus Query API，不修改返回格式。

---

## 5. 依赖

- `upstream/prometheus/promql/`
- `upstream/prometheus/web/api/`
- `platform/gateway/proxy/`

---

## 6. 验收标准

- [ ] 可以通过 Custom UI 执行 PromQL 查询并查看结果
- [ ] 可以查看当前告警状态列表
- [ ] Open API 返回与 Prometheus 兼容的数据格式
- [ ] 查询响应时间 P99 < 2s
