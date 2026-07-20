# Module 05: 自定义前端门户

> **模块类型**: 核心能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)  
> **目标用户**: 运维工程师、业务研发工程师  
> **版本**: v2.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

提供门户化的 Web 界面，替代原生 Prometheus UI，让非专家用户也能轻松使用指标查询与采集管理功能。

MVP 阶段聚焦配置管理、指标查询、采集状态展示，**不引入复杂 Dashboard 编辑器**。

---

## 2. 用户故事

- OPS-01：通过 Web 门户查看所有采集目标状态
- OPS-03：在门户中执行 PromQL 查询
- OPS-06：查看应用服务的拨测结果
- DEV-01：查看我负责服务的指标数据

---

## 3. 核心功能

| 页面 | 功能 | 优先级 |
|------|------|--------|
| 资源管理页 | 主机 / 中间件 / 应用服务资源的 CRUD、Excel 导入 | P0 |
| 标签模板页 | 按资源类型配置字段到 Label 的映射 | P0 |
| 采集 Job 页 | Job 创建/编辑、目标筛选、标签模板关联 | P0 |
| 拨测配置页 | Blackbox 拨测目标与模块配置 | P0 |
| 配置预览页 | 实时预览生成的 `prometheus.yml` | P1 |
| 目标状态页 | 查看所有采集目标状态、拨测结果 | P0 |
| 查询页 | PromQL 编辑器、查询结果（表格/JSON/简单折线） | P0 |
| 告警状态页 | 查看当前告警列表（代理 `/api/v1/alerts`）；功能 Owner 为 Module 08 | P1 |
| 首页 / Dashboard | 展示平台状态、采集覆盖率 | P2（MVP 不做） |
| 看板页 | 预置服务看板、拖拽式面板 | P2（MVP 不做） |
| 系统设置页 | 发现源配置、用户管理 | P2（MVP 不做） |

---

## 4. 技术方案

- 框架：React 18 + TypeScript
- 构建工具：Vite
- UI 组件库：Ant Design 5.x
- 图表库：MVP 阶段不使用复杂图表库，仅简单折线（可用 ECharts 轻量版）
- 状态管理：React Query（服务端状态）+ Zustand（客户端状态）
- HTTP 客户端：Fetch / Axios

---

## 5. 依赖

- `ui-custom/web/`
- `platform/gateway/`（API）

---

## 6. 验收标准

- [ ] 可以通过 Web 门户管理三类资源
- [ ] 可以配置标签模板、采集 Job、拨测配置
- [ ] 可以预览生成的 `prometheus.yml`
- [ ] 可以查看采集目标列表和拨测结果
- [ ] 可以在查询页执行 PromQL 并查看结果
- [ ] 可以查看当前告警状态
