# Module 05: 自定义前端门户

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.1
> **产品版本覆盖**: v0.3 / v1.0
> **原型版本**: v1.1
> **更新日期**: 2026-08-02
> **对应原型**: `docs/prototypes/module-05/`

> **模块类型**: 核心能力模块
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md)、[Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md)、[Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)
> **目标用户**: 运维工程师、业务研发工程师

---

## 1. 模块目标

提供门户化的 Web 界面，替代原生 Prometheus UI，让非专家用户也能轻松使用指标查询与采集管理功能。本模块为前端页面组织与交互设计层，不重新定义后端能力边界，所有业务规则以后端模块 PRD 为准。

MVP 阶段聚焦配置管理、指标查询、采集状态展示，**不引入复杂 Dashboard 编辑器**。

---

## 2. 用户故事

- OPS-01：通过 Web 门户查看所有采集目标状态
- OPS-03：在门户中执行 PromQL 查询
- M05-OPS-06：查看应用服务的拨测结果
- M05-OPS-07：在资源列表中识别「已监控 / 未监控」实例
- M05-OPS-08：配置 CI 类型与 Exporter 模板的绑定关系
- DEV-01：查看我负责服务的指标数据

---

## 3. 核心功能

| 页面 | 功能 | 后端 Owner | 优先级 |
|------|------|------------|--------|
| 资源管理页 | 主机 / 中间件 / 应用服务资源的 CRUD、Excel 导入；展示 `instance_name` / `hostname` 作为可读名；支持按资源类型编辑 ResourceLabel；展示「已监控 / 未监控」badge | Module 07 | P0 |
| 标签模板页 | 按资源类型配置 Resource 字段 → Label 的映射（`resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}`） | Module 07 | P0 |
| CI-Exporter 映射页 | 维护 CI 类型 ↔ Exporter 模板绑定：默认端口、metrics_path、scheme、标签模板引用 | Module 01 | P0 |
| 采集 Job 页 | Job 创建/编辑、CI-Exporter 模板选择、实例选择、标签模板关联 | Module 01 | P0 |
| 实例选择 / 拨测配置页 | 手动勾选监控实例、Blackbox 拨测目标与模块配置 | Module 01 | P0 |
| 规则编辑页 | 类 YAML 表单编辑告警/记录规则，PromQL 校验，指标实时预览 | Module 01 | P0 |
| 配置预览 / 下发页 | 实时预览生成的 `prometheus.yml`，diff 对比当前生效版本，人工确认后下发 | Module 09 | P0 |
| 配置版本 / 回滚页 | 查看历史配置版本与下发记录，回滚到指定版本 | Module 09 | P1（v0.2） |
| 目标状态页 | 查看所有采集目标状态、拨测结果 | Module 02 | P0 |
| 查询页 | PromQL 编辑器、查询结果（表格/JSON/简单折线） | Module 02 | P0 |
| 告警状态页 | 查看当前告警列表（代理 `/api/v1/alerts`） | Module 08 | P1 |
| 网域管理页 | 网域注册、Token 管理、Edge Agent 状态、租户-网域关联展示 {v0.2} | Module 09 | P0（v0.2） |
| 监控源登记册页 | 外部 Prometheus / Zabbix / 云监控接入管理 | Module 10 | P0（集成模式） |
| 首页 / Dashboard | 展示平台状态、采集覆盖率 | Module 01/06/09/10（数据） | P2（MVP 不做） |
| 看板页 | 预置服务看板、拖拽式面板 | Module 02/05 | P2（MVP 不做） |
| 系统设置页 | CMDB Provider 配置、CI 类型映射、状态映射字典、发现源配置、用户/角色/租户管理 | Module 04/06/07/09 | P2（MVP 不做） |

> **系统设置页职责细分**：
> - CMDB Provider、CI 类型映射、待分类 CI 队列、状态映射字典 → [Module 04](Module_04_Custom_Discovery.md)
> - 租户 / 用户 / 角色 / 权限 → [Module 06](Module_06_Multi_Tenant.md)
> - 标签模板管理入口 → [Module 07](Module_07_Monitoring_Object_Management.md)
> - 网域 / Edge Agent 生命周期 → [Module 09](Module_09_Network_Domain_and_Edge_Config_Center.md)

### 3.1 关键前端交互

#### ResourceLabel 编辑（资源详情页 / 批量编辑）

- Label 列表按 `source` 展示徽章：`system`（模板生成）、`user`（用户手动）、`cmdb {v0.4+}`（CMDB 同步）。
- `system` 和 `cmdb` 来源的 label **默认只读**；用户可通过新增同名 key 的 `user` label 进行覆盖（遵循 `cmdb` > `user` > `system` 优先级）。
- 手动新增 label 时：
  - key 校验：小写字母、数字、下划线；禁止以 `__` 开头；禁止与 Prometheus 内置 label（`instance`、`job`、`scheme`、`__address__` 等）同名。
  - 当输入的 key 已存在 `source=cmdb` 的 label 时，实时提示“该 key 将由 CMDB 覆盖，建议更换”。
  - 当输入的 key 已存在 `source=system` 的 label 时，提示“将覆盖模板生成的 label”。

#### 标签模板页

- 字段来源下拉选项：
  - `resource_field`：Resource 模型字段（MVP 主要来源）
  - `composite`：组合字段（如 `instance_ip:port` → `instance`）
  - `prometheus_builtin`：Prometheus 内置字段
  - `cmdb_field {v0.4+}`：CMDB 字段，v0.4 前置灰或隐藏
- 每个映射行展示目标 Label、来源字段、transform 规则、启用状态。

#### CI-Exporter 映射页

- 表格展示 `resource_type` ↔ Exporter 模板绑定关系：Exporter 名称、默认端口、metrics_path、scheme、标签模板引用。
- 支持为同一 CI 类型配置多个 Exporter 模板（如 Linux host 同时绑定 node_exporter 与 process-exporter），但仅有一个为默认模板。
- 新增 / 编辑绑定关系时，自动填充 Exporter 指标库中的常用指标与默认采集参数。

#### 状态映射字典配置页（P2）

- 表格展示 `source_status` → `target_status` 规则，支持按资源类型过滤。
- 提供“测试映射”功能：输入任意状态字符串，返回映射结果。
- 内置规则禁止删除但可禁用；自定义规则可增删改。

#### CMDB 同步配置页（P2 / v0.4+）

- **Provider 配置**：BlueKing / HTTP / Nacos 接入参数、轮询周期（默认 15 分钟）、事件订阅开关。
- **CI 类型映射表**：BlueKing `bk_obj_id` → MetricCenter `resource_type`，支持启用/禁用、按网域覆盖。
- **待分类 CI 队列**：展示未映射/禁用/字段缺失的 CI 列表，支持查看原始数据、映射到现有类型、忽略。

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

- [ ] 可以通过 Web 门户管理三类资源，资源列表展示 `instance_name` / `hostname` 与「已监控 / 未监控」badge
- [ ] 可以配置标签模板，字段来源包含 `resource_field` / `composite` / `prometheus_builtin`
- [ ] 可以在资源详情页查看并编辑 ResourceLabel，`system` / `cmdb` 来源 label 只读，`user` label 受 key 校验与冲突提示
- [ ] 可以配置 CI 类型 ↔ Exporter 模板映射
- [ ] 可以配置采集 Job、实例选择、Blackbox 拨测配置
- [ ] 可以在规则编辑页使用类 YAML 表单编辑规则，并获得 PromQL 校验与指标预览
- [ ] 可以在配置预览页查看 `prometheus.yml` 草稿，通过 diff 对比后人工确认下发
- [ ] 可以查看配置版本历史与下发记录，支持回滚到历史版本
- [ ] 可以查看采集目标列表和拨测结果
- [ ] 可以在查询页执行 PromQL 并查看结果
- [ ] 可以查看当前告警状态
- [ ] 可以管理网域、查看 Edge Agent 在线状态与配置同步状态

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | v0.3 / v1.0 | draft |
