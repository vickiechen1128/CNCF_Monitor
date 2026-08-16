# MetricCenter 实施路线图

> 文档类型：产品需求文档 / 实施规划  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[00_Global_Architecture.md](00_Global_Architecture.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)、[02_Product_Roadmap.md](02_Product_Roadmap.md)  
> 更新日期：2026-07-31

---

## 与 02_Product_Roadmap.md 的分工

| 文档 | 聚焦问题 | 本文档是否涉及 |
|------|----------|----------------|
| [02_Product_Roadmap.md](02_Product_Roadmap.md) | 什么时候做？做到什么程度？分几个阶段？ | ❌ 本文档不写 |
| **04_Implementation_Map.md（本文档）** | 每个功能落地难不难？Prometheus 是否已支持？前后端各多少工作量？先做哪个？ | ✅ 本文档核心 |

> 阶段规划、里程碑、技术演进路线请查看 [02_Product_Roadmap.md](02_Product_Roadmap.md)。

---

## 1. 能力分层定义

按 **Prometheus 原生能力复用度** 将 MetricCenter 的工作分为四层：

| 分层 | 含义 | MetricCenter 工作量 |
|------|------|---------------------|
| **L1：纯代理层** | Prometheus / Alertmanager / Blackbox 已提供完整后端能力 | 只需 API 代理 + 前端页面 |
| **L2：配置生成层** | 原生支持该配置/规则，但需 MetricCenter 生成 | 写配置组装逻辑 + 前端表单 + 下发 |
| **L3：数据转换层** | 原生提供原始数据，需 MetricCenter 聚合/关联/增强 | 写后端聚合逻辑 + 前端展示 |
| **L4：完全自研层** | Prometheus 生态没有对应能力 | 从模型到前端都要自研 |

---

## 2. 各模块实施难度矩阵

> 模块职责已按 [监控策略管理方案决策记录](../decisions/grill-2026-07-31-monitoring-strategy-management.md) 与 [查询中心设计决策记录](../decisions/grill-2026-07-31-query-center.md) 重新划分：
> - **Module_01**：监控策略与指标管理
> - **Module_02**：查询中心（吸收原 Module_01 运行时展示）
> - **Module_06**：系统与平台管理（含多租户）
> - **Module_07**：监控对象管理
> - **Module_08**：告警规则管理
> - **Module_09**：网域与边缘配置中心

### 2.1 Module_07：监控对象管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 资源类型管理 | 主机/中间件/应用服务/通用指标目标类型 | ❌ 无 | 自研类型枚举 + 差异化字段 | 中 | 低 | L4 |
| 主机资源管理 | CRUD / Excel 导入（含 `instance_name` / `hostname` / `os_type`） | ❌ 无 | 自研表 + Excel 解析 | 中 | 低 | L4 |
| 中间件资源管理 | CRUD / Excel 导入 | ❌ 无 | 自研表 + 类型差异化 | 中 | 中 | L4 |
| 应用服务资源管理 | CRUD / Excel 导入 | ⚠️ Blackbox 做探测 | 自研表 + 生成 blackbox 配置 | 中 | 中 | L2/L4 |
| 通用指标目标管理 | CRUD / 自定义 IP、端口、metrics_path、Label | ❌ 无 | 自研表 + 自定义字段 | 中 | 中 | L4 |
| 资源 Label 管理 | `ResourceLabel` CRUD / 来源合并 / 冲突检测 | ❌ 无 | 自研单表 + `source` 字段 + 优先级合并 | 中 | 中 | L4 |
| 标签模板管理 | 字段映射 / transform | ✅ `relabel_configs` | 映射 UI → 生成 relabel | 中 | 中 | L2 |
| 已监控/未监控 badge | Resource 列表展示 `is_monitored` 状态 | ❌ 需关联 ScrapeJob | 读取 Module_01 关联关系并展示 | 低 | 低 | L3/L4 |
| 状态映射字典 | Excel/CMDB 状态 → `Resource.status` | ❌ 无 | 可配置规则表 + 正则匹配 | 低 | 低 | L4 |
| CMDB 接入源 | Excel / HTTP / 蓝鲸（v0.4+） | ⚠️ file_sd 可作为输入 | Provider 适配器 + CI 类型映射 + 待分类队列 | 高 | 中 | L2/L4 |

> **关键判断**：监控对象管理是 MetricCenter 的核心自研域。Prometheus 只认 `static_configs` / `file_sd`，不认"资源模型"概念。ScrapeJob、配置生成、规则编辑已移出本模块。

### 2.2 Module_01：监控策略与指标管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| CI 类型 ↔ Exporter 模板绑定 | `CITypeExporterMapping` CRUD / 默认端口 / metrics_path / scheme | ❌ 无 | 自研绑定表 + 推荐逻辑 | 中 | 中 | L4 |
| Exporter 模板管理 | `ExporterTemplate` CRUD / 版本 / 安装说明 | ❌ 无 | 模板存储 + 代码示例管理 | 低 | 中 | L4 |
| ScrapeJob 管理 | Job 创建/编辑、关联 CI 类型与 ExporterTemplate、标签模板引用 | ✅ `scrape_configs` | 表单 → 生成 scrape_configs | 中 | 中 | L2 |
| 实例选择 | 手动勾选实例（MVP）；按网域/env/app/标签筛选（v0.3+） | ⚠️ 通过 static_configs 间接支持 | 查询资源 + 组装 targets | 中 | 低 | L3 |
| Exporter 安装/注册确认 | `ExporterInstallationConfirmation` 状态维护 | ❌ 无 | 自研状态表 + 未确认不生成 target | 低 | 低 | L4 |
| 拨测配置管理 | Blackbox 配置生成 | ✅ Blackbox Exporter | 生成 blackbox scrape_config | 中 | 中 | L2 |
| 指标元数据管理 | 指标名 / 类型 / HELP / UNIT | ✅ `/api/v1/metadata` | 代理 + 缓存 + 前端 | 低 | 低 | L1/L3 |
| Exporter 指标静态库 | `ExporterMetricLibrary` 内置常见 exporter 指标 | ❌ 无 | 静态库表 + 用户扩展机制 | 中 | 中 | L4 |
| 规则编辑 UI | 类 YAML 表单（expr / for / labels / annotations）+ PromQL 校验 + 指标实时预览 | ✅ `rule_files` + Rule Manager | 表单 → 生成规则记录 | 中 | 高 | L2 |

> **关键判断**：Module_01 是**策略配置层**，核心是把「CI → Exporter → Job → 实例 → Rule」翻译成 DB 记录与最终配置片段。运行时目标状态展示已移交 Module_02，配置生成/下发移交 Module_09。

### 2.3 Module_09：网域与边缘配置中心

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 网域管理 | 网域 CRUD / Token 管理 | ❌ 无 | 自研表 + Token 生成 | 低 | 低 | L4 |
| 租户-网域关联 | 1 租户 : N 网域，禁止跨租户共享 | ❌ 无 | `NetworkDomain.tenant_id` 字段 + 校验 | 低 | 低 | L4 |
| 配置生成服务 | 轮询 Module_01/Module_07 数据，按网域生成 `prometheus.yml` / `rules.yml` 草稿 | ⚠️ Prometheus 解析但不生成 | 按网域组装配置 + scrape_configs + `external_labels` | 高 | 中 | L2/L3 |
| `external_labels` 注入 | 在 `prometheus.yml` 中注入 `network_domain` / `tenant_id` | ✅ `global.external_labels` | 配置生成时按网域写入 | 低 | 无 | L2 |
| 配置预览 / Diff | `ConfigDraft` 预览、与 `ConfigVersion` diff 对比 | ❌ 无 | 自研草稿表 + Diff 逻辑 | 中 | 中 | L4 |
| 配置校验 | YAML/语义校验 | ✅ `promtool check config` | 调用 promtool 或自行校验 | 低 | 低 | L1/L2 |
| 配置下发 | SIGHUP / /-/reload / Edge Agent 分发 | ✅ 原生支持热重载 | 写文件 + 触发 reload + `ConfigDeployment` 记录 | 中 | 低 | L1/L4 |
| 配置拉取 | Edge Sync Agent 轮询拉取配置包 | ❌ 无 | 配置包接口 + Token 鉴权 + 304 缓存 | 中 | 低 | L4 |
| 配置版本 | `ConfigVersion` 历史 / 对比 / 回滚 | ❌ 无 | 自研版本表 + 回滚逻辑 | 中 | 中 | L4 |
| Agent 状态列表页 | 表格展示在线状态、最后心跳、配置版本、WAL 积压、最近错误 | ❌ 无 | 心跳接收 + 状态计算 + 列表页 | 中 | 低 | L4 |
| 边缘诊断看板 | 心跳 RTT / WAL 积压 / Remote Write 队列 / 24h 断网时长图表 | ❌ 无 | 趋势存储 + 图表展示 | 中 | 中 | L4 |
| 配置审计 | 变更记录 | ❌ 无 | 审计日志表 | 低 | 低 | L4 |

> **关键判断**：MVP 核心路径是 **轮询生成 → 草稿预览 → 人工确认 → 下发**。配置中心把 Module_01 的策略记录与 Module_07 的对象数据组装成最终配置，是跨模块集成的关键节点。边缘 Agent 可观测性 MVP 以**列表页**实现，图表/趋势看板延后至 P1/P2。

### 2.4 Module_02：查询中心

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| PromQL 查询代理 | Instant / Range，自动注入 `tenant_id` 与有权限的 `network_domain_id` | ✅ `/api/v1/query*` | 代理 + 认证上下文 + PromQL 注入 | 中 | 中 | L1/L3 |
| `/api/v1/alerts` 代理 | 代理 Prometheus 当前 firing/pending 告警实例 | ✅ `/api/v1/alerts` | 代理 + 租户/网域注入 + 展示 | 低 | 低 | L1 |
| 查询辅助 | 指标名补全 / Label 建议 / 常用查询模板 | ✅ `/api/v1/labels` 等 | 代理 + 前端联想 | 低 | 中 | L1 |
| 结果展示 | 表格 / JSON / 简单折线图 | ❌ 无图表库 | 前端渲染 | 无 | 中 | L4（前端） |
| 响应 envelope | 包裹 `data_source` / `freshness_at` / `network_domain` 元数据 | ❌ 无 | 后端封装统一响应 | 低 | 低 | L3 |
| 采集目标状态 | 目标列表 / 状态 / 筛选 | ✅ `/api/v1/targets` | 代理 + 前端筛选 | 低 | 低 | L1 |
| 采集诊断 | 错误信息 / HTTP 状态 | ✅ `/api/v1/targets` | 展示 + 简单统计 | 低 | 中 | L1/L3 |
| 拨测结果 | `probe_success` 等 | ✅ Blackbox Exporter | 代理 PromQL | 低 | 中 | L1 |
| Open API | REST 查询接口 | ✅ 复用 Query API | 代理 + API Key + 限流 | 中 | 低 | L1/L3 |

> **关键判断**：Module_02 MVP 是**带租户/网域上下文注入的 Prometheus Query API 代理**，不是透明代理。查询响应需加 envelope 暴露数据来源与新鲜度；`/api/v1/alerts` 只代理 Prometheus，Alertmanager 通知状态归 Module_08。运行时目标状态展示、拨测结果、采集诊断已从 Module_01 移至 Module_02。

### 2.5 Module_08：告警规则管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 告警规则生命周期 | RuleGroup / 启用禁用 / 按网域聚合 | ✅ `rule_files` + Rule Manager | 规则记录持久化 + 分组管理 | 中 | 中 | L2 |
| `rules.yml` 生成 | 按 RuleGroup 与 `network_domain_id` 聚合生成 | ✅ 原生支持 | 组装规则文件 | 中 | 中 | L2 |
| 告警状态查看（Prometheus） | 当前告警 / 历史 | ✅ `/api/v1/alerts` | 由 Module_02 代理 + 展示 | 低 | 低 | L1 |
| Alertmanager 通知状态 | 代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API | ✅ Alertmanager API | 调用 API + UI | 中 | 中 | L1/L3 |
| 静默管理 | 创建/删除静默 | ✅ Alertmanager `/api/v1/silences` | 调用 API + UI | 中 | 中 | L1 |
| Alertmanager 配置 | 通知渠道 / 收敛 / 抑制 / `alertmanager.yml` | ⚠️ Alertmanager 原生支持 webhook | 生成 alertmanager.yml | 中 | 高 | L2 |
| Recording Rules | 预聚合规则 | ✅ 原生支持 | 表单 → 生成 recording rules | 中 | 中 | L2 |
| 边缘本地告警状态 | 断网场景下边缘 Agent 本地告警状态，通过 Module_09 心跳上报 | ❌ 无 | EdgeHeartbeat 扩展字段 + 状态展示 | 中 | 低 | L4 |

> **关键判断**：Module_08 聚焦**告警规则生命周期管理**、Alertmanager 配置生成与通知状态；规则编辑 UI 已移交 Module_01，Prometheus 当前告警状态通过 Module_02 代理。边缘本地告警（P2）通过 Module_09 EdgeHeartbeat 上报并在 Module_09/Module_08 展示。

### 2.6 Module_06：系统与平台管理（含多租户）

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 租户管理 | 租户 CRUD / 禁用 / 状态 | ❌ 无 | 自研 `Tenant` 表 | 低 | 低 | L4 |
| 租户-网域关联 | 1 租户 : N 网域，1 网域 : 1 租户 | ❌ 无 | `Tenant.network_domain_ids` + `NetworkDomain.tenant_id` 双向校验 | 低 | 低 | L4 |
| 用户与权限 | 租户内用户 / 角色 / 权限 | ❌ 无，可能外部 IAM/SSO 承接 | 数据契约 + 租户作用域校验 | 中 | 中 | L4 |
| 数据隔离 | 租户只能查看本租户及其网域数据 | ❌ 无 | 依赖 Module_02/03 标签注入与鉴权 | 中 | 低 | L3/L4 |
| 数据存储管理 | TSDB 状态 / Remote Write | ✅ status API / config | 代理 + 配置 | 低 | 低 | L1/L2 |
| 审计日志 | 操作记录 | ❌ 无 | 自研审计表 | 中 | 低 | L4 |

> **关键判断**：Module_06 在 MVP 以单租户 `platform_admin` 模式运行，**不存在跨租户的全局平台管理员**。管理员按租户维度管理，只能访问本租户及其拥有的网域；Module_02 注入逻辑无需 admin bypass。v0.2 必须落地租户-网域关联。

---

## 3. 新增数据模型设计任务

以下数据模型为模块边界调整后新增或强化，需要在后端设计阶段优先落地：

| 数据模型 | 归属模块 | 设计要点 | 优先级 |
|----------|----------|----------|--------|
| `CITypeExporterMapping` | Module_01 | `resource_type` ↔ `ExporterTemplate` 绑定；包含默认端口、metrics_path、scheme、scrape_interval、scrape_timeout、label_template_id | P0 |
| `ExporterTemplate` | Module_01 | Exporter 名称、版本、默认端口、metrics_path、scheme、支持的 resource_type 列表、安装说明、是否内置 | P0 |
| `ExporterMetricLibrary` | Module_01 | 归属 `ExporterTemplate`；指标名、类型、HELP、UNIT、常见标签、是否内置、是否启用 | P1 |
| `ScrapeJob` | Module_01 | job_name、resource_type、exporter_template_id、network_domain_id、实例选择模式、selected_instance_ids、标签模板引用、relabel_configs | P0 |
| `MonitoringRule` | Module_01 | 规则名、rule_type（alerting/recording）、expr、duration、labels、annotations、resource_type、exporter_template_id | P0 |
| `ExporterInstallationConfirmation` | Module_01 | resource_id、exporter_template_id、status、确认人/时间、备注 | P0 |
| `ConfigDraft` | Module_09 | 所属网域、来源版本、prometheus_yml、rules_yml、blackbox_yml、metadata、status（pending/confirmed/discarded） | P0 |
| `ConfigVersion` | Module_09 | 所属网域、来源 draft_id、生效配置内容、metadata、版本号 | P0 |
| `ConfigDeployment` | Module_09 | 目标网域、config_version_id、target_type、target_address、status、错误信息、触发人/时间 | P0 |
| `Resource.is_monitored` / badge 逻辑 | Module_07 展示 / Module_01 维护 | 计算资源是否被任意 ScrapeJob 选中；Module_01 写入关联关系，Module_07 只读展示 | P0 |
| `QueryResponseEnvelope` | Module_02 | 统一查询响应外层：`status`、`data`（Prometheus 原始响应）、`meta.data_source` / `meta.freshness_at` / `meta.network_domain` | P0 |
| `EdgeHeartbeat` 扩展字段 | Module_09 | 边缘本地告警状态字段：`local_alerts_active`（当前本地触发告警数）、`local_alertmanager_status`（up/down/unknown）、`last_local_alert_at` | P2 |

> **关键判断**：数据模型是模块边界落地的核心。`CITypeExporterMapping`、`ScrapeJob`、`MonitoringRule` 支撑策略层；`ConfigDraft`/`ConfigVersion`/`ConfigDeployment` 支撑配置中心的人工确认与审计；`is_monitored` 是 Module_01 与 Module_07 的关键跨模块契约；`QueryResponseEnvelope` 是 Module_02 暴露数据来源与新鲜度的关键；`EdgeHeartbeat` 扩展字段支撑 P2 边缘自治告警状态回传。

---

## 4. 监控对象管理最小化设计（Module_07）

### 4.1 为外部 CMDB 预留接口

```go
type CMDBProvider interface {
    Name() string
    ListResources(ctx context.Context, resourceType ResourceType, networkDomainID string, filter Filter) ([]Resource, error)
}

MVP 实现：
- `ExcelProvider`：Excel 导入；保留 `cmdb_ci_id`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer` 等预留字段，但不生成 label
- `SQLiteProvider`：本地 SQLite 存储

v0.4+ 实现：
- `BlueKingProvider`：腾讯蓝鲸 CMDB；负责 CI 类型映射、待分类队列、事件触发 + 15 分钟轮询同步
- `HTTPProvider`：通用 HTTP CMDB
- `NacosProvider`：Nacos 注册中心
```

> **关键判断**：CMDB Provider 扩展的难点不在于单条数据拉取，而在于 CI 类型到 `resource_type` 的映射策略、未映射类型的待分类队列、以及同步失败后的孤儿资源生命周期。

### 4.2 三类资源的最小字段

#### 共同字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `resource_id` | ✅ | 稳定唯一键；MVP 取自 `server_id` / `instance_name`；v0.4+ 复用 `cmdb_ci_id` |
| `resource_type` | ✅ | `host` / `middleware` / `application` / `generic_target` |
| `network_domain_id` | ✅ | 所属网域；MVP 默认 `default`，v0.2+ 按租户上下文填充 |
| `source_type` | ✅ | `manual` / `import` / `cmdb {v0.4+}`；MVP 默认 `manual` |
| `instance_name` | ❌ | 可读实例名/展示名；host 模板中必填 |
| `app_name` | ✅ | 应用名 → `app` label |
| `env` | ✅ | 环境 → `env` label |
| `cluster` | ✅ | 集群/子应用 → `cluster` label；host 场景下 `sub_app_code` 为空时取 `vpc` |
| `owner` | ❌ | 负责人；v0.4+ 优先取自 `cmdb_maintainer` |
| `status` | ✅ | `online` / `offline` / `maintenance` / `orphan {v0.4+}` |
| `is_monitored` | ❌ | 是否被任意 ScrapeJob 选中；由 Module_01 维护，Module_07 只读展示 |
| `cmdb_ci_id` | ❌ | {v0.4+} BlueKing CMDB 的 CI ID |
| `cmdb_business_path` | ❌ | {v1.0+} CMDB 业务路径 |
| `cmdb_module_path` | ❌ | {v1.0+} CMDB 模块路径 |
| `cmdb_maintainer` | ❌ | {v1.0+} CMDB 维护人 |

#### 主机（Host）

| 字段 | 必填 | 说明 |
|------|------|------|
| `hostname` | ❌ | 主机名；host 场景下默认与 `instance_name` 一致；也可从 CMDB `bk_host_name` 同步 |
| `instance_ip` | ✅ | 管理 IP / 目标地址 |
| `os_type` | ❌ | linux / windows；从 Excel `image` 或 CMDB 同步 |

#### 中间件（Middleware）

| 字段 | 必填 | 说明 |
|------|------|------|
| `middleware_type` | ✅ | mysql / redis / kafka / elasticsearch |
| `instance_ip` | ✅ | 服务 IP |
| `port` | ✅ | 服务端口 |
| `version` | ❌ | 版本 |

#### 应用服务（Application）

| 字段 | 必填 | 说明 |
|------|------|------|
| `service_name` | ✅ | 服务名 |
| `health_check_url` | ✅ | 拨测 URL |
| `protocol` | ✅ | http / https / tcp |
| `endpoint` | ❌ | 业务端点 |

#### 通用指标目标（Generic Target）

| 字段 | 必填 | 说明 |
|------|------|------|
| `instance_ip` | ✅ | 目标 IP 或域名 |
| `metrics_path` | ❌ | 自定义拉取路径；默认 `/metrics` |
| `port` | ✅ | 暴露端口 |

### 4.3 Excel 导入简化

- **不做动态模板**：按资源类型提供固定模板
- **不做字段映射**：上传文件必须匹配固定列名
- **只做基础校验**：IP 格式、端口范围、必填项、重复检测、Label key 合规性（小写/下划线、禁止 `__` 开头）
- **主机模板最小必填集**：`instance_name`、`private_ip`、`app_code`、`env_flag`、`sub_app_code/vpc`、`network_domain_id`（可选，留空默认 `default`）
- **预留 CMDB 字段**：`cmdb_ci_id`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer` 在模板中标记为可选/预留，MVP 不生成 label
- **状态映射**：Excel 中文状态（如 `运行中` / `已停止` / `维护中`）通过可配置字典映射到 `Resource.status`
- **定位**：MVP 快速验证；v0.4+ 迁移到外部 CMDB 后，Excel 作为临时补充入口

### 4.4 Label 冲突与合并

MetricCenter 内部维护 `ResourceLabel` 单表，通过 `source` 字段区分三类来源：

| 来源 | 写入方 | 说明 |
|------|--------|------|
| `system` | Module_07 标签模板 | 由 Resource 字段按模板自动生成，如 `app`、`env`、`cluster`、`hostname` |
| `user` | Module_05 UI / Excel 导入 | 用户手动添加；可覆盖 `system` 来源的同名 key |
| `cmdb` | Module_04 CMDB Provider {v0.4+} | CMDB 同步写入；优先级最高，可覆盖 `user` 和 `system` |

**同 key 冲突优先级**：`cmdb` > `user` > `system`。

**用户手动 label 限制**：
- key 强制小写、下划线连接；禁止以 `__` 开头；最大长度 128
- 禁止覆盖 Prometheus 内置 label（`__address__`、`instance`、`job`、`scheme` 等）
- 与 `source=cmdb` 的 key 冲突时，UI 实时提示"该 key 将由 CMDB 覆盖，建议更换"

**实施难度**：L4（自研）。需要单独维护 Label 表、合并逻辑、前端冲突提示，并在配置生成时正确打平为 Prometheus 标签。

---

## 5. 拨测设计（Module_01）

### 5.1 拨测能力来源

使用 **Blackbox Exporter**（Prometheus 官方组件），MetricCenter 只生成配置：

- `probe_http_*`：HTTP 连通性、状态码、TLS、响应时间
- `probe_tcp_*`：TCP 端口连通性
- `probe_icmp_*`：ICMP 存活检测

### 5.2 生成的 blackbox 配置示例

```yaml
scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - 'https://order-service.prod/api/health'
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - target_label: __address__
        replacement: blackbox-exporter:9115
      - source_labels: [__param_target]
        target_label: instance
```

---

## 6. 告警与 Alertmanager 分层（Module_08）

| 能力 | 归属 | MetricCenter 策略 |
|------|------|-------------------|
| 告警规则编辑 UI | Module_01 | 类 YAML 表单 + PromQL 校验 + 指标实时预览 |
| 告警规则生命周期 | Module_08 | 规则分组、启用/禁用、`rules.yml` 生成 |
| 告警求值 | Prometheus Rule Manager | 原生执行 |
| Prometheus 告警状态查看 | Module_02 | 代理 `/api/v1/alerts` 展示 |
| Alertmanager 通知状态 | Module_08 | 代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API |
| 边缘本地告警状态 | Module_09 / Module_08 | 通过 EdgeHeartbeat 上报，P2 展示 |
| 告警收敛 / 静默 / 通知 | Alertmanager / Module_08 | Module_08 生成 `alertmanager.yml` |

> 规则编辑 UI 由 Module_01 提供，规则记录产出后由 Module_08 进行生命周期管理与下发协同；Alertmanager 配置生成由 Module_08 负责；Prometheus 当前告警状态由 Module_02 代理。未来演进见 [02_Product_Roadmap.md](02_Product_Roadmap.md)。

---

## 7. 落地建议：按后端工作量排优先级

### 第一梯队：低后端工作量，快速见效

| 模块 | 功能 | 原因 |
|------|------|------|
| Module_02 查询中心 | PromQL 代理（含 tenant/network_domain 注入）、结果 envelope、`/api/v1/alerts` 代理 | Prometheus 后端全包，MetricCenter 只做代理 + 注入 + 封装 |
| Module_09 配置中心 | 配置下发（reload） | 一行命令即可触发 |
| Module_01 监控策略 | 采集 Job 基础 CRUD | 只是生成 scrape_configs 片段 |

### 第二梯队：核心但后端可控（MVP 必须）

| 模块 | 功能 | 原因 |
|------|------|------|
| Module_07 监控对象管理 | 四类资源最小表 + Excel 导入 + `ResourceLabel` 合并 | 产品差异点，必须自研 |
| Module_01 监控策略 | CI↔Exporter 绑定、实例选择、规则编辑 UI | 策略层核心，定义"采什么、怎么采、怎么判" |
| Module_09 配置中心 | 配置生成 + 预览/Diff + 校验 + `external_labels` 注入 | 组装逻辑是 MVP 核心 |
| Module_08 告警规则管理 | `rules.yml` 生成 + Alertmanager 配置 | 依赖 Module_01 规则记录 |
| Module_06 多租户 | 租户-网域关联模型 | v0.2 支撑 Module_02/09 注入逻辑 |

### 第三梯队：工作量大或依赖前置（延后）

| 模块 | 功能 | 原因 |
|------|------|------|
| Module_04 自定义服务发现 | 腾讯蓝鲸 / K8s / Nacos 自动发现 | 需要写 Provider 适配器 |
| Module_01 监控策略 | 指标元数据管理、Exporter 指标库管理页面 | P1/P2，静态库先内置 |
| Module_08 告警规则管理 | 静默管理 UI、通知渠道配置、Recording Rules UI | 依赖 Alertmanager API 与 Module_01 |
| Module_09 边缘诊断 | WAL 积压/心跳 RTT/断网时长图表看板 | P1/P2，MVP 列表页已满足基本可观测 |
| Module_06 平台管理 | 完整 RBAC / 审计 / 资源配额 | 完全自研 |

---

## 8. MVP 最小闭环

```
Module_07 监控对象管理（四类对象固定字段 + LabelTemplate + ResourceLabel）
    │
    ├──► 主机 ──► node-exporter 模板
    ├──► 中间件 ──► mysqld/redis/kafka-exporter 模板
    └──► 应用服务 ──► simple-agent / blackbox probe 模板
              │
              ▼
        Module_01 监控策略与指标管理
        · CI 类型 ↔ Exporter 模板绑定
        · ScrapeJob + 实例选择
        · 规则编辑 UI
              │
              ▼
        Module_09 网域与边缘配置中心
        · 轮询 Module_01/07 数据
        · 按网域生成配置草稿（注入 external_labels）
        · 配置预览 / Diff / 人工确认
        · 下发 / Reload → 中心 Prometheus / Edge Agent
              │
              ▼
        Prometheus / Edge Agent 数据面
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 Module_02  Module_02  Module_02/08
 指标查询   采集状态   告警状态
 · PromQL   · /targets · /api/v1/alerts
 · envelope · up/down  · Alertmanager 通知状态 (Module_08)
```

> **模块边界**：Module_02 负责被监控对象的指标查询与采集健康度（`up` 等），并代理 Prometheus `/api/v1/alerts`；Module_09 负责 Edge Agent 基础设施健康度（在线、WAL、配置同步）；Module_08 负责 Alertmanager 通知状态与告警规则生命周期。

---

## 9. 关键结论

1. **后端最重的部分**：Module_07 监控对象管理（四类资源表 + Excel 导入 + `ResourceLabel` 合并）、Module_09 配置生成器、Module_04 CMDB Provider 扩展（v0.4+）
2. **后端最轻的部分**：Module_02 指标查询/目标状态/拨测结果（纯代理 + 注入 + envelope 封装）
3. **MVP 应该避开**：复杂图表、完整多租户 RBAC、外部 CMDB 同步、完整的 Exporter 指标库管理页面
4. **新增自研点**：`CITypeExporterMapping`、`ExporterTemplate`、`ExporterMetricLibrary`、`MonitoringRule`、`ConfigDraft`/`ConfigVersion`/`ConfigDeployment`、`is_monitored` badge 逻辑、`QueryResponseEnvelope`、`EdgeHeartbeat` 告警状态字段
5. **最大杠杆点**：充分利用 Prometheus / Blackbox / Alertmanager 的原生能力，MetricCenter 只做"配置翻译"和"门户展示"
6. **跨模块契约**：Module_07 的 Resource/LabelTemplate/ResourceLabel 是 Module_01 与 Module_09 的基础依赖；Module_09 的 `external_labels` 注入是 Module_02 多租户隔离的基础；其稳定性至关重要
7. **多租户原则**：不存在跨租户全局管理员；Module_02 无需 admin bypass，所有查询均注入 `tenant_id` 与有权限的 `network_domain_id`

---

## 10. 关联文档

- 阶段规划与里程碑：[02_Product_Roadmap.md](02_Product_Roadmap.md)
- 功能完整清单：[03_Functional_Architecture.md](03_Functional_Architecture.md)
- 监控策略与指标管理：[Module_01_Metric_Collection_Center.md](Modules/Module_01_Metric_Collection_Center.md)
- 查询中心：[Module_02_Query_Center.md](Modules/Module_02_Query_Center.md)
- 自定义服务发现与外部 CMDB 生命周期管理：[Module_04_Custom_Discovery.md](Modules/Module_04_Custom_Discovery.md)
- 系统与平台管理（含多租户）：[Module_06_Multi_Tenant.md](Modules/Module_06_Multi_Tenant.md)
- 监控对象管理：[Module_07_Monitoring_Object_Management.md](Modules/Module_07_Monitoring_Object_Management.md)
- 告警规则管理：[Module_08_Alertmanager_Notification_Management.md](Modules/Module_08_Alertmanager_Notification_Management.md)
- 网域与边缘配置中心：[Module_09_Network_Domain_and_Edge_Config_Center.md](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md)
- 完整代码实施计划：[05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md)
- 监控策略管理方案决策记录：[../decisions/grill-2026-07-31-monitoring-strategy-management.md](../decisions/grill-2026-07-31-monitoring-strategy-management.md)
- 查询中心设计决策记录：[../decisions/grill-2026-07-31-query-center.md](../decisions/grill-2026-07-31-query-center.md)

---

## 11. 变更日志

| 日期 | 变更内容 | 变更人 |
|------|----------|--------|
| 2026-07-31 | 按监控策略管理方案决策记录重新划分模块职责：Module_01 改名为「监控策略与指标管理」、Module_07 改名为「监控对象管理」、Module_09 改名为「网域与边缘配置中心」；更新各模块实施矩阵；新增数据模型设计任务章节；Module_02 吸收运行时目标状态展示 | — |
| 2026-07-31 | 按查询中心设计决策记录更新：Module_02 增加租户/网域注入、响应 envelope、`/api/v1/alerts` 代理、查询辅助与结果展示；Module_09 增加 Agent 状态列表页、边缘诊断看板、external_labels 注入、配置生成/预览/下发；Module_08 增加 Alertmanager 通知状态 API、边缘本地告警心跳上报；新增 Module_06 租户-网域关联矩阵并移除全局管理员实现任务；新增 `QueryResponseEnvelope` 与 `EdgeHeartbeat` 告警字段数据模型；更新 MVP 闭环流程图 | — |
