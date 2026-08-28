# MetricCenter 实施路线图

> 文档类型：产品需求文档 / 实施规划  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[00_Global_Architecture.md](00_Global_Architecture.md)、[02_Product_Roadmap.md](02_Product_Roadmap.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)  
>
> **各模块 PRD 版本**：Module_01 v3.26 · Module_06 v2.3 · Module_07 v2.21 · Module_09 v1.50 · Module_03 v1.2（Track B+ 增量，决策 44）
>
> Plan 版本：v2026-08-21  
> 更新日期：2026-08-21

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
| **L1：纯代理层** | Prometheus / Blackbox 已提供完整后端能力 | 只需 API 代理 + 前端页面 |
| **L2：配置生成层** | 原生支持该配置/规则，但需 MetricCenter 生成 | 写配置组装逻辑 + 前端表单 + 下发 |
| **L3：数据转换层** | 原生提供原始数据，需 MetricCenter 聚合/关联/增强 | 写后端聚合逻辑 + 前端展示 |
| **L4：完全自研层** | Prometheus 生态没有对应能力 | 从模型到前端都要自研 |

---

## 2. 各模块实施难度矩阵

> 本版矩阵已按 MVP 范围重定（M01 / M06 / M07 / M09），M02 / M05 / M08 移出 MVP，作为后续 Roadmap 保留。  
> 详细数据模型与接口约定以各模块 PRD 第 5~6 章为准。

### 2.1 Module_07：监控对象管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 资源类型管理 | 主机 / 数据库 / 中间件 / 应用服务 / 通用指标目标五类 | ❌ 无 | 自研类型枚举 + 差异化字段 | 中 | 低 | L4 |
| 五类资源 CRUD | 固定字段、按类别差异化表单 | ❌ 无 | 自研 5 张资源表 + 统一 Resource 基座 | 中 | 中 | L4 |
| Excel 导入 | 固定列模板、状态映射、upsert、必填校验 | ❌ 无 | Excel/CSV 解析 + 批量写入 + 校验报告 | 中 | 中 | L4 |
| 业务字典 `biz_code` | 所有资源必填 `biz_code`，展示名 `biz_name` | ❌ 无 | 部署级字典 + 存在性校验 | 低 | 低 | L4 |
| `ResourceLabel` 管理 | `system` / `user` / `cmdb {v0.4+}` 来源、冲突合并 | ❌ 无 | 自研单表 + `source` 字段 + 优先级合并 | 中 | 中 | L4 |
| 标签模板管理 | 字段映射 / transform；按粗粒度资源类别 | ✅ `relabel_configs` | 映射 UI → 生成 target labels | 中 | 中 | L2 |
| 「未监控」筛选 | 列表支持 `is_monitored=false` 筛选 | ⚠️ 需关联 ScrapeJob | 字段由 M01 维护关联关系，M07 只读映射展示 | 低 | 低 | L3 |
| 状态映射字典 | Excel 中文状态 → `Resource.status` | ❌ 无 | 可配置规则表 + 正则匹配 | 低 | 低 | L4 |
| CMDB 接入源 | Excel / HTTP / 蓝鲸（v0.4+） | ⚠️ file_sd 可作为输入 | Provider 适配器 + CI 类型映射 + 待分类队列 | 高 | 中 | L2/L4 |

> **关键判断**：MVP 内资源模型从四类扩为五类（新增 Database），`biz_code` 作为全资源类型必填的业务归属字段；`is_monitored` 改为由 Module_01 维护、Module_07 只读映射的筛选字段，避免 M07 台账与「采集状态」概念混淆。

### 2.2 Module_01：监控策略与指标管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| CI 类型 ↔ 默认采集器绑定 | `CITypeExporterMapping` CRUD、默认端口 / metrics_path / scheme | ❌ 无 | 自研绑定表 + 推荐逻辑 | 中 | 中 | L4 |
| 采集实现登记 | `ExporterTemplate` CRUD、版本、安装指南、os/arch | ❌ 无 | 模板存储 + 代码示例管理 | 低 | 中 | L4 |
| 采集 Job 管理 | Job CRUD、监控对象类型、网域、实例选择、标签模板 | ✅ `scrape_configs` | 表单 → 生成 scrape_configs 片段 | 中 | 中 | L2 |
| 实例选择 | 手动勾选（MVP）；按属性筛选（v0.3+） | ⚠️ 通过 static_configs 间接支持 | 查询资源 + 组装 `selected_instance_ids` | 中 | 低 | L3 |
| 认证 / TLS 最小集 | `auth_type` none/basic/bearer + `tls_skip_verify` + `ca_file` | ✅ 原生支持 | 透传进 `scrape_configs` | 低 | 低 | L2 |
| 冻结网域校验 | 禁用网域禁止新建 Job / 新增该域实例 | ❌ 无 | M06 状态联动校验 | 低 | 低 | L4 |
| Exporter 安装/注册确认 | `ExporterInstallationConfirmation` 状态维护 | ❌ 无 | 自研状态表；未确认不生成 target | 低 | 低 | L4 |
| Blackbox 拨测配置 | Blackbox 配置生成 | ✅ Blackbox Exporter | 生成 blackbox scrape_config / `blackbox.yml` | 中 | 中 | L2 |
| 指标静态库 | `ExporterMetricLibrary` 内置常见 exporter 指标 | ❌ 无 | 静态库表 + 用户扩展机制 | 中 | 中 | L4 |
| 规则文件挂载 | 整文件 `rules.yml` 透传落库 `MonitoringRule` | ✅ `rule_files` + Rule Manager | 文件上传/粘贴 + YAML 语法校验 + 随 M09 生成/确认/下发 | 低 | 中 | L2 |
| 字段化规则编辑 UI | 类 YAML 表单 + PromQL 校验 + 实时预览 | ✅ `rule_files` | 表单 → 生成规则记录 | 中 | 高 | L2 |

> **关键判断**：MVP 内规则编辑退化为「规则文件挂载」（`content_mode=yaml_passthrough`），字段化编辑 + PromQL 校验随 Module_02 能力在 v0.3 启用。采集 Job 必须绑定已纳管网域，并受冻结网域与 `offline` 资源排除约束。

### 2.3 Module_09：网域与边缘配置中心

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 网域监控纳管 | 从 M06 已登记网域中选择、配置 `channel`/`agent_type`/`remote_write_url` | ❌ 无 | 纳管表单 + Token 生成 | 低 | 低 | L4 |
| `default` 管理域 | 固定 `channel=local`，中心直接写盘 reload | ✅ SIGHUP / `/-/reload` | 默认网域初始化 + 本地文件下发 | 低 | 低 | L2 |
| `agent_pull` 网域 UI 占位 | 安装指引、Token 复制、采集节点状态页空态 | ❌ 无 | 占位页面 + 3 步安装指引文案 | 低 | 低 | L4 |
| 配置生成服务 | 轮询 M01/M07 数据，按网域生成 `prometheus.yml` / `targets/*.json` / `rules.yml` | ⚠️ Prometheus 解析但不生成 | 按网域组装配置 + file_sd + external_labels | 高 | 中 | L2/L3 |
| `external_labels` 注入 | 注入 `network_domain_id` / `zone_type` / `replica` | ✅ `global.external_labels` | 配置生成时按网域写入 | 低 | 无 | L2 |
| 配置草稿 / Diff / 确认 | `ConfigDraft` 预览、与 `ConfigVersion` diff、人工确认 | ❌ 无 | 自研草稿表 + Diff 逻辑 | 中 | 中 | L4 |
| 配置校验 | YAML/语义校验、promtool、blackbox config check | ✅ `promtool check config` | 调用 promtool / blackbox check | 低 | 低 | L1/L2 |
| 配置下发 | `channel=local` 写盘 + reload；`agent_pull` 生成 zip 包 | ✅ 原生支持热重载 | 写文件 + 触发 reload + `ConfigDeployment` 记录 | 中 | 低 | L1/L4 |
| `change_status` 回写 | 下发成功后回写 M01 `ScrapeJob.change_status=deployed` | ❌ 无 | 下发记录成功后异步回写 | 低 | 低 | L3 |
| 配置版本 / 下发历史 | `ConfigVersion` / `ConfigDeployment` 查询 | ❌ 无 | 版本表 + 下发记录表 | 中 | 低 | L4 |

> **关键判断**：MVP 内 M09 的主干是 **default 域 + local 通道的配置生成 / 预览 / 确认 / reload 全链路**。`agent_pull` 网域纳管 UI 保留占位页，但 Edge Agent 心跳、配置包拉取、WAL 监控等完整能力放到 v0.2。`external_labels` 不再注入 `tenant_id`，只注入部署级元数据 `network_domain_id` / `zone_type` / `replica`。

### 2.4 Module_06：系统与平台管理（网域登记）

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 种子数据初始化 | `platform_admin` 租户 + `default` 网域 upsert | ❌ 无 | migration 幂等种子 | 低 | 无 | L4 |
| 网络区域类型字典 | `GET /api/v2/platform/zone-types` 只读接口 | ❌ 无 | 部署级字典 + 接口 | 低 | 低 | L4 |
| 网域行政登记 | CRUD / 禁用=冻结 / 空网域删除 | ❌ 无 | `NetworkDomain` 行政字段 API | 低 | 低 | L4 |
| `zone_type` 下拉 | 字典驱动、不开放自由文本 | ❌ 无 | 下拉组件 + 后端校验 | 低 | 低 | L4 |
| 登记归属与授权租户 | `tenant_id` 创建后不可变、`authorized_tenant_ids` | ❌ 无 | 字段校验 + 授权列表 | 低 | 低 | L4 |
| 跨模块联动 | 禁用网域时 M07 拒绝新资源、M01 拒绝新建 Job / 新增实例、M09 不生成新变更单 | ❌ 无 | 状态机 + 各模块校验 | 中 | 低 | L4 |

> **关键判断**：MVP 内 M06 落地「网域登记管理」+「租户/用户管理单租户子集（轻量认证，决策 44，Track B 增量）」；完整租户生命周期 / RBAC / 审计放到 v0.2 及以后（轻量登录 + 单租户管理 ≠ 完整 RBAC）。网域是部署级资源，登记所有权归 `platform_admin`，可授权给多租户共享（授权 ≠ 拥有）。

### 2.5 Module_02：查询中心（MVP 不新增开发）

| 一级功能 | 二级功能 | 当前状态 | 后续安排 |
|----------|----------|----------|----------|
| PromQL 查询代理 | Instant / Range，注入 `tenant` / `network_domain` | 已有 `/api/v1/query*` 代理骨架 | v0.2 补全多租户注入语义 |
| 目标状态展示 | `/api/v1/targets` 代理 | 已有代理 | v0.2 增强按网域/Job 筛选 |
| 响应 envelope | `data_source` / `freshness_at` / `network_domains` | 预留字段 | v0.2 细化多网域来源 |
| 告警状态 / PromQL 校验 | `/api/v1/alerts`、`/api/v1/query/validate` | 未实现 | v0.3 随 M08 / M01 字段化规则编辑启用 |

> **关键判断**：MVP 不新增查询中心开发任务，现有 `/api/v1/query*` 代理保留运行。注入逻辑在 v0.2 随 M06 租户-网域关联一起落地。

### 2.6 Module_08：告警收敛与通知管理（MVP 不做）

| 一级功能 | 当前状态 | 后续安排 |
|----------|----------|----------|
| Alertmanager 配置生成 / 路由 / 静默 / 抑制 | 未实现 | v0.3 起逐步落地 |
| 告警状态查看（Prometheus `/api/v1/alerts`） | 由 M02 代理，MVP 不开发页面 | v0.3 随 M02 / M05 门户化 |
| 通知渠道 / 通知模板 | 未实现 | v1.0 |

> **关键判断**：MVP 阶段告警规则通过 M01「规则文件挂载」生成 `rules.yml`，由 Prometheus 原生求值；通知收敛 / 静默 / 路由 / Alertmanager 配置管理全部后移。

### 2.7 Module_05：自定义前端门户（MVP 不做独立分支）

| 一级功能 | 当前状态 | 后续安排 |
|----------|----------|----------|
| 门户化首页 / Dashboard / 统一导航 | 已有独立页面骨架 | MVP 跨模块联调阶段用现有页面串链 |
| 复杂图表 / 告警中心 / 看板编辑器 | 未实现 | v0.3 / v1.0 按 Roadmap 落地 |

> **关键判断**：MVP 不保留独立 `feat/module-05-portal` 分支。各模块前端页面在跨模块联调阶段由 Orchestrator 统一串成可用动线。

---

## 3. 新增/调整数据模型设计任务

以下模型为本次范围重定后新增或强化，需要优先落地：

| 数据模型 | 归属模块 | 设计要点 | 优先级 |
|----------|----------|----------|--------|
| `Tenant` | Module_06 | `id` / `name` / `is_platform_admin` / `multi_site_enabled` / `status`；MVP 仅预置 `platform_admin` | P0 |
| `NetworkDomain` 行政字段 | Module_06 / Module_09 | `id` / `name` / `domain_type` / `zone_type` / `tenant_id` / `authorized_tenant_ids` / `status`；ID 规则 `<deploy_code>-<domain_code>`；`tenant_id` 创建后不可变 | P0 |
| `ZoneType` 字典 | Module_06 | 部署级字典：`code` / `display_name` / `description` / `enabled` | P0 |
| `Resource` 五类基础 + 差异化字段 | Module_07 | `resource_category`（host/database/middleware/application/generic_target）、`biz_code`（必填）、`network_domain_id`（必填）、`status` 含 offline | P0 |
| `ResourceStatusMapping` | Module_07 | 来源状态 → `online/offline/maintenance` 映射；支持按 `resource_category` 与优先级 | P0 |
| `ResourceLabel` | Module_07 | `resource_id` / `key` / `value` / `source`（system/user/cmdb）；`system` 保护不可被 user 覆盖 | P0 |
| `LabelTemplate` / `Mapping` | Module_07 | 锚定粗粒度资源类别；来源 `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}`；默认含 `biz_code → biz`、`instance_ip:port → instance` | P0 |
| `CITypeExporterMapping` | Module_01 | `monitor_type` ↔ `exporter_template_id`；含默认端口、metrics_path、scheme、scrape_interval、scrape_timeout、`label_template_id`、`is_default` | P0 |
| `ExporterTemplate` | Module_01 | 名称、版本、默认端口、metrics_path、scheme、supported_monitor_types、os/arch、install_guide、source | P0 |
| `ExporterMetricLibrary` | Module_01 | 锚点 = `monitor_type`；指标名、类型、HELP、UNIT、常见标签、source_exporter | P1 |
| `ScrapeJob` | Module_01 | job_name、monitor_type、network_domain_id（必填且已纳管）、selected_instance_ids、auth_type/basic/bearer、tls_skip_verify、ca_file、`change_status` | P0 |
| `MonitoringRule` | Module_01 | `content_mode=yaml_passthrough`（MVP）、`rule_content` 整文件、`scope=central`（固定）、`enabled` / `draft_status` / `change_status` | P0 |
| `ExporterInstallationConfirmation` | Module_01 | resource_id × exporter_template_id 安装状态 | P0 |
| `ConfigDraft` | Module_09 | 所属网域、change_no、prometheus_yml、rules_yml、blackbox_yml、targets_files、metadata、summary、change_items、status | P0 |
| `ConfigVersion` | Module_09 | 来源 draft、生效配置内容、metadata、联合 checksum | P0 |
| `ConfigDeployment` | Module_09 | 目标网域、config_version_id、channel、status、validation_status、error_message | P0 |
| `NetworkDomain` 监控纳管字段 | Module_09 | `channel` / `agent_type` / `remote_write_url` / `token` / `center_endpoint` / 运行态字段 | P0 |
| `EdgeAgent` / `EdgeHeartbeat` | Module_09 | v0.2 完整实现；MVP 仅 UI 占位与模型预留 | P1（MVP 占位） |
| `BusinessMetric` | Module_01 | 业务指标语义契约（语义/阈值/负责人）；MVP 不做 UI，仅模型预留 | P2 |

> **关键判断**：数据模型是模块边界落地的核心。`biz_code` 与 `network_domain_id` 成为 MVP 资源表的必填字段；`external_labels` 只保留部署级元数据；M01 的 `change_status` 与 M09 的下发记录形成闭环。

---

## 4. 监控对象管理最小化设计（Module_07）

### 4.1 为外部 CMDB 预留接口

```go
type CMDBProvider interface {
    Name() string
    ListResources(ctx context.Context, resourceType ResourceType, networkDomainID string, filter Filter) ([]Resource, error)
}
```

MVP 实现：
- `ExcelProvider`：固定列 Excel 导入；保留 `cmdb_ci_id`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer` 等预留字段，但不生成 label。
- `SQLiteProvider`：本地 SQLite 存储。

v0.4+ 实现：
- `BlueKingProvider` / `HTTPProvider` / `NacosProvider`：由 Module_04 负责。

### 4.2 五类资源的最小字段

#### 共同字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `resource_id` | ✅ | 稳定唯一键；MVP 由服务端生成 uuid |
| `resource_category` | ✅ | `host` / `database` / `middleware` / `application` / `generic_target` |
| `network_domain_id` | ✅ | 所属网域；MVP 默认 `default`，导入时缺失即拒绝 |
| `source_type` | ✅ | `manual` / `import` / `cmdb {v0.4+}`；MVP 默认 `manual` |
| `instance_name` | ❌ | 可读实例名；host 模板中必填 |
| `biz_code` | ✅ | 业务归属不可变编码；经标签模板映射为 `biz` label |
| `app_name` | ✅* | application / database / middleware 必填；host / generic_target 可空 |
| `env` | ✅ | 环境 → `env` label |
| `cluster` | ✅* | 集群/子应用 → `cluster` label；host 场景下 `sub_app_code` 为空时取 `vpc` |
| `owner` | ❌ | 负责人 |
| `status` | ✅ | `online` / `offline` / `maintenance` / `orphan {v0.4+}` |
| `is_monitored` | ❌ | 是否被任意 ScrapeJob 选中；由 Module_01 维护，Module_07 只读映射 |
| `cmdb_*` | ❌ | v0.4+ / v1.0+ CMDB 预留字段 |

#### 主机（Host）

| 字段 | 必填 | 说明 |
|------|------|------|
| `hostname` | ✅ | 主机名；host 场景下默认与 `instance_name` 一致 |
| `instance_ip` | ✅ | 管理 IP / 目标地址 |
| `os_type` | ❌ | linux / windows |

#### 数据库（Database）{新增}

| 字段 | 必填 | 说明 |
|------|------|------|
| `database_type` | ✅ | mysql / redis / postgresql / oracle / dm8 / sqlserver / mongodb |
| `instance_ip` | ✅ | 服务 IP |
| `port` | ✅ | 服务端口 |
| `version` | ❌ | 版本 |

#### 中间件（Middleware）

| 字段 | 必填 | 说明 |
|------|------|------|
| `middleware_type` | ✅ | kafka / elasticsearch / nginx / zookeeper |
| `instance_ip` | ✅ | 服务 IP |
| `port` | ✅ | 服务端口 |
| `version` | ❌ | 版本 |

#### 应用服务（Application）

| 字段 | 必填 | 说明 |
|------|------|------|
| `service_name` | ✅ | 服务名 |
| `endpoint` | ✅ | 业务指标端点（host:port）；一行一实例 |
| `health_check_url` | ❌ | 拨测 URL |
| `protocol` | ❌ | http / https / tcp |

#### 通用指标目标（Generic Target）

| 字段 | 必填 | 说明 |
|------|------|------|
| `target_name` | ✅ | 目标名称 |
| `instance_ip` | ✅ | 目标 IP 或域名 |
| `port` | ❌ | 服务端口 |
| `metrics_path` | ❌ | 自定义拉取路径；默认 `/metrics` |
| `scheme` | ❌ | `http` / `https`，默认 `http` |
| `custom_labels` | ❌ | 自定义标签，如 `device_type=snmp_switch` |

### 4.3 Excel 导入简化

- **不做动态模板**：按资源类型提供固定列模板。
- **不做字段映射**：上传文件必须匹配固定列名。
- **只做基础校验**：IP 格式、端口范围、必填项、重复检测、Label key 合规性（小写/下划线、禁止 `__` 开头）。
- **upsert 模式**：按类型判重键覆盖更新，结果返回 `updated` 计数。
  - host：`network_domain_id` + `instance_ip`
  - database / middleware / generic_target：`network_domain_id` + `instance_ip` + `port`
  - application：`network_domain_id` + `service_name` + `endpoint`
- **主机模板最小必填集**：`instance_name`、`hostname`、`instance_ip`、`biz_code`、`env`、`cluster`、`network_domain_id`。
- **状态映射**：Excel 中文状态通过可配置字典映射到 `Resource.status`。
- **定位**：MVP 快速验证；v0.4+ 迁移到外部 CMDB 后，Excel 作为临时补充入口。

### 4.4 Label 冲突与合并

MetricCenter 内部维护 `ResourceLabel` 单表，通过 `source` 字段区分三类来源：

| 来源 | 写入方 | 说明 |
|------|--------|------|
| `system` | Module_07 标签模板 | 由 Resource 字段按模板自动生成，如 `app`、`env`、`cluster`、`hostname`、`biz` |
| `user` | Module_07 UI / Excel 导入 | 用户手动添加；**仅 `resource_category=application` 资源可写** |
| `cmdb` | Module_04 CMDB Provider {v0.4+} | CMDB 同步写入；优先级最高 |

**同 key 冲突优先级**：`cmdb` > `user` > `system`，但 **`system` 为系统保护标签，不可被 `user` 覆盖**。

**用户手动 label 限制**：
- key 强制小写、下划线连接；禁止以 `__` 开头；最大长度 128。
- 禁止覆盖 Prometheus 内置 label（`__address__`、`instance`、`job`、`scheme` 等）。
- 与 `source=cmdb` 的 key 冲突时，UI 实时提示"该 key 将由 CMDB 覆盖，建议更换"。

---

## 5. 拨测设计（Module_01）

使用 **Blackbox Exporter**（Prometheus 官方组件），MetricCenter 只生成配置：

- `probe_http_*`：HTTP 连通性、状态码、TLS、响应时间
- `probe_tcp_*`：TCP 端口连通性
- `probe_icmp_*`：ICMP 存活检测

MVP 内 Blackbox Job 不受 `exporter_template_id` 约束，通过 `job_type=blackbox` + `blackbox_module` + `blackbox_targets` 承载，由 M09 生成 `blackbox.yml` 并注入 `prometheus.yml` 的 blackbox scrape_configs。

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

| 能力 | MVP | v0.3+ | v1.0 |
|------|-----|-------|------|
| 告警规则内容创作 | ❌ 不做字段化编辑 | 字段化 UI + PromQL 校验 | 完整编辑器 |
| `rules.yml` 生成与下发 | ✅ 通过 M01 规则文件挂载 + M09 生成 | 结构化生成 | 结构化 + 边缘 scope |
| Alertmanager 配置（路由/接收人/静默/抑制） | ❌ 不做 | 基础配置 | 完整 UI |
| 告警状态查看 | ❌ 不做 | 由 M02 代理 `/api/v1/alerts` | 完整告警中心 |
| 边缘自治告警 | ❌ 不做 | ❌ 不做 | v0.4+ / v1.0 |

> MVP 阶段告警规则通过「规则文件挂载」进入 Prometheus Rule Manager，通知收敛/静默/路由完全依赖原生 Alertmanager，MetricCenter 不做配置管理。

---

## 7. 落地建议：按后端工作量排优先级

### 第一梯队：低后端工作量，快速见效

| 模块 | 功能 | 原因 |
|------|------|------|
| Module_06 网域登记 | `zone-types` 字典、`NetworkDomain` 行政 CRUD、种子 upsert | 纯自研表，工作量小，是后续模块的前置 |
| Module_09 配置中心 | `default` 域 local 通道 reload | 原生 Prometheus 已支持 |
| Module_01 监控策略 | 采集 Job 基础 CRUD、规则文件挂载 | 主要是生成 scrape_configs / rules.yml 片段 |

### 第二梯队：核心但后端可控（MVP 必须）

| 模块 | 功能 | 原因 |
|------|------|------|
| Module_07 监控对象管理 | 五类资源表 + Excel 导入 + `ResourceLabel` 合并 + 标签模板 | 产品差异点，必须自研 |
| Module_01 监控策略 | CI↔Exporter 绑定、实例选择、Blackbox 拨测、认证/TLS 透传 | 策略层核心 |
| Module_09 配置中心 | 配置生成 + 预览/Diff + 校验 + `external_labels` 注入 + 下发历史 | 组装逻辑是 MVP 核心 |
| Module_06 网域登记 | 冻结（禁用）联动校验、空网域删除、登记归属不可变 | 跨模块契约关键节点 |

### 第三梯队：工作量大或依赖前置（延后）

| 模块 | 功能 | 原因 |
|------|------|------|
| Module_04 自定义服务发现 | 腾讯蓝鲸 / K8s / Nacos 自动发现 | 需要写 Provider 适配器 |
| Module_01 监控策略 | 指标元数据管理、Exporter 指标库管理页面、字段化规则编辑 | P1/P2，静态库先内置 |
| Module_08 告警规则管理 | 静默管理 UI、通知渠道配置、Alertmanager 配置 | 依赖 Alertmanager API 与 Module_01 字段化编辑 |
| Module_09 边缘诊断 | WAL 积压/心跳 RTT/断网时长图表看板 | P1/P2，MVP 仅列表占位 |
| Module_06 平台管理 | 完整 RBAC / 审计 / 资源配额 | 完全自研 |

---

## 8. MVP 最小闭环

```
Module_06 网域登记管理
    │
    ├──► 预置 default 网域（management / local）
    ├──► 登记其他网域（edge / agent_pull，UI 占位）
    └──► 禁用网域 = 冻结：拒绝新资源 / 新 Job / 新变更单
              │
              ▼
Module_07 监控对象管理
    │
    ├──► 主机 / 数据库 / 中间件 / 应用服务 / 通用指标目标
    ├──► Excel 导入 upsert、状态映射、biz_code 必填
    ├──► LabelTemplate 生成 system 标签
    └──► ResourceLabel（system / user / cmdb 预留）
              │
              ▼
Module_01 监控策略与指标管理
    │
    ├──► CI 类型 ↔ Exporter 模板绑定
    ├──► ScrapeJob（手动勾选实例、认证/TLS、Blackbox 拨测）
    ├──► Exporter 安装确认
    ├──► 规则文件挂载（整文件 rules.yml 透传）
    └──► 静态指标库（内置常见 Exporter 指标）
              │
              ▼
Module_09 网域与边缘配置中心
    │
    ├──► 配置生成器：读取 M01/M07 数据
    ├──► 按 network_domain 生成 prometheus.yml + targets/*.json + rules.yml
    ├──► external_labels 注入 network_domain_id / zone_type / replica
    ├──► 配置预览 / Diff / 人工确认
    ├──► local 通道：写盘 + reload 中心 Prometheus
    └──► agent_pull 通道：UI 占位（v0.2 实现拉包）
              │
              ▼
        Prometheus 数据面
              │
    ┌─────────┴─────────┐
    ▼                   ▼
  M02 查询代理          跨模块联调验收
（保留现有能力）      （无独立 portal 分支）
```

> **模块边界**：MVP 闭环终点是「M09 下发后中心 Prometheus 成功 reload 并产生指标」。M02 查询代理保留现有能力但不新增开发；M08 告警收敛/通知管理不在 MVP；M05 门户不保留独立 feature 分支，联调阶段用现有页面串链。

---

## 9. 关键结论

1. **后端最重的部分**：Module_07 五类资源表 + Excel 导入 + `ResourceLabel` 合并、Module_09 配置生成器、Module_01 `ScrapeJob` 与冻结网域联动。
2. **后端最轻的部分**：Module_06 网域登记行政 CRUD、Module_09 `default` 域 local reload、Module_01 规则文件挂载。
3. **MVP 应该避开**：字段化规则编辑 UI、Alertmanager 配置管理、完整多租户 RBAC、外部 CMDB 同步、复杂 Dashboard、Edge Agent 完整能力（注：决策 44 已将**轻量登录 + 单租户/用户管理**纳入 MVP，与「完整多租户 RBAC」区分——前者只认证不授权，后者仍后移）。
4. **新增自研点**：`NetworkDomain` 行政模型 + `zone_type` 字典、五类资源模型 + `biz_code`、`CITypeExporterMapping`、`ExporterTemplate`、`ScrapeJob` 认证/TLS、`MonitoringRule` 文件挂载、`ConfigDraft`/`ConfigVersion`/`ConfigDeployment`、冻结网域跨模块校验。
5. **最大杠杆点**：充分利用 Prometheus / Blackbox 的原生能力，MetricCenter 只做「配置翻译」和「门户展示」。
6. **跨模块契约**：M06 是网域行政 Owner；M07 只读取 `network_domain_id`；M01 的 ScrapeJob 必须绑定 M09 已纳管网域；M09 生成配置时排除 `offline` 资源并注入部署级 `external_labels`。
7. **多租户原则**：MVP 以单租户 `platform_admin` 运行；租户/业务标签不进入 `external_labels`，通过 M07 LabelTemplate 以 target 级标签注入，隔离优先在 v0.2 后的查询网关实现。

---

## 10. 关联文档

- 阶段规划与里程碑：[02_Product_Roadmap.md](02_Product_Roadmap.md)
- 功能完整清单：[03_Functional_Architecture.md](03_Functional_Architecture.md)
- 产品愿景：[00_Product_Vision.md](00_Product_Vision.md)
- 全局架构：[00_Global_Architecture.md](00_Global_Architecture.md)
- 监控策略与指标管理：[Module_01_Metric_Collection_Center.md](Modules/Module_01_Metric_Collection_Center.md)
- 系统与平台管理（含多租户）：[Module_06_Multi_Tenant.md](Modules/Module_06_Multi_Tenant.md)
- 监控对象管理：[Module_07_Monitoring_Object_Management.md](Modules/Module_07_Monitoring_Object_Management.md)
- 网域与边缘配置中心：[Module_09_Network_Domain_and_Edge_Config_Center.md](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md)
- 查询中心：[Module_02_Query_Center.md](Modules/Module_02_Query_Center.md)
- 告警收敛与通知管理：[Module_08_Alertmanager_Notification_Management.md](Modules/Module_08_Alertmanager_Notification_Management.md)
- 自定义前端门户：[Module_05_Custom_UI.md](Modules/Module_05_Custom_UI.md)
- 代码实施计划：[05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md)
- 代码隔离标准：[../03-engineering-standards/01_Code_Isolation_Standard.md](../03-engineering-standards/01_Code_Isolation_Standard.md)
- API 设计标准：[../03-engineering-standards/03_API_Standard.md](../03-engineering-standards/03_API_Standard.md)
- 测试标准：[../03-engineering-standards/04_Testing_Standard.md](../03-engineering-standards/04_Testing_Standard.md)

---

## 11. 变更日志

| 日期 | 变更内容 | 变更人 |
|------|----------|--------|
| 2026-08-21 | 按用户决策重派生 MVP 实施路线图：MVP 范围收缩为 M01/M06/M07/M09；模块顺序改为 Phase 0 → M06 → M07 → M01 → M09 → 跨模块联调；M01 规则编辑改为规则文件挂载；M06 网域登记纳入 MVP；M09 裁剪到 default/local 通道闭环；M02/M05/M08 移出 MVP；资源模型改五类；新增 `biz_code`、`zone_type`、冻结网域、`external_labels` 仅注入 network_domain_id/zone_type/replica 等关键字段；重写 MVP 最小闭环图与数据模型表 | — |
| 2026-07-31 | 按监控策略管理方案决策记录重新划分模块职责：Module_01 改名为「监控策略与指标管理」、Module_07 改名为「监控对象管理」、Module_09 改名为「网域与边缘配置中心」；更新各模块实施矩阵；新增数据模型设计任务章节 | — |
