# Module 04: 自定义服务发现与外部 CMDB 生命周期管理

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.1
> **产品版本覆盖**: v0.4+
> **原型版本**: v1.1
> **更新日期**: 2026-08-02
> **对应原型**: `docs/prototypes/module-04/`

> **模块类型**: 扩展能力模块（v0.4+）
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)
> **目标用户**: 运维工程师、运维架构师

---

## 1. 模块目标

让 MetricCenter 能够对接企业外部的 CMDB、Nacos、HTTP 注册中心等，自动发现采集目标，并承担外部数据源的**全生命周期管理**（同步策略、失败容错、孤儿资源清理）。

外部 CMDB（腾讯蓝鲸）是监控对象的**唯一数据源**。本模块的 Provider 负责：
1. 将权威 CMDB CI 同步为 MetricCenter `Resource` 模型；
2. 定义并执行同步失败处理策略；
3. 管理孤儿虚拟 CI 的分组、保留与清理。

[Module_07](Module_07_Monitoring_Object_Management.md) 只消费同步后的 `Resource` 数据并生成配置，不处理外部数据源生命周期。

> **MVP 阶段**：本模块不做。资源通过 [Module 07: 配置管理](Module_07_Monitoring_Object_Management.md) 的 Excel 导入功能维护。  
> **v0.4 阶段**：引入外部 CMDB 同步与生命周期管理，优先支持腾讯蓝鲸 CMDB 和通用 HTTP 接口。

---

## 2. 用户故事

- OPS-02：从外部 CMDB 批量同步采集目标
- M04-OPS-10：CMDB 同步失败后仍保持监控不中断
- M04-OPS-11：清理已下线的孤儿虚拟 CI
- ARCH-03：查看平台整体采集覆盖率

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 外部 CMDB 同步与发现 | 从腾讯蓝鲸等 CMDB 拉取应用系统与实例列表；BlueKing CMDB 为权威数据源 | P2 |
| BlueKing CMDB 字段映射 | Tenant → BlueKing Business；NetworkDomain → BlueKing Cloud Area；CI 字段映射到 `cmdb_ci_id`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer` | P2 |
| Nacos 发现 | 从 Nacos 注册中心发现服务实例 | P2 |
| HTTP 发现 | 从自定义 HTTP 接口获取目标列表 | P2 |
| 目标转换 | 将外部数据格式转换为 MetricCenter Resource 模型，保留 CMDB CI ID、业务/模块路径、维护人 | P2 |
| 同步策略 | 全量同步、增量同步、定时同步；支持事件触发 + 定时轮询双保险 | P2 |
| 同步失败容错 | 同步失败时继续使用旧对象；对象在 CMDB 中删除/失联 7 天后进入孤儿资源管理 | P2 |
| 孤儿虚拟 CI 拆分 | 孤儿资源按 `network_domain_id` + `resource_type` 分组展示与管理 | P2 |
| CMDB CI 类型映射 | 维护 CMDB CI 类型 → MetricCenter `resource_type` 映射表；未映射类型进入待分类队列 | P2 |
| 待分类 CI 队列 | 新 CI 类型或无法识别的 CI 进入待分类队列，等待管理员映射后再同步，不阻塞同步任务 | P2 |

---

## 4. 接口抽象

本模块的 Provider 接口与 [Module 07 第 10 节](Module_07_Monitoring_Object_Management.md) 中定义的 `CMDBProvider` 对齐，必须包含 `networkDomainID` 参数以适配多网域核心维度。

```go
// platform/discovery/provider/provider.go
type Provider interface {
    Name() string
    ListResources(ctx context.Context, resourceType ResourceType, networkDomainID string, filter Filter) ([]Resource, error)
}
```

MVP 阶段由 Module 07 提供本地录入 Provider：
- `ExcelProvider`：Excel 导入
- `SQLiteProvider`：本地 SQLite 存储

v0.4+ 由本模块扩展外部 Provider（须遵循 Module 07 接口定义）：
- `BlueKingProvider`：腾讯蓝鲸 CMDB
- `HTTPProvider`：通用 HTTP CMDB
- `NacosProvider`：Nacos 注册中心
- `KubernetesProvider`：K8s Endpoints/Service

### 4.1 Provider 同步规范

所有外部 Provider 必须将 CMDB 视为监控对象的唯一数据源，并遵循本模块定义的同步失败处理策略：

| 要求 | 说明 |
|------|------|
| 失败继续采集 | CMDB/注册中心同步失败时，必须保留上一次成功同步结果，不得清空或跳过旧对象 |
| 7 天保留期 | CMDB 中已删除或连续 7 天无法同步的对象，进入 `orphan` 状态 |
| 孤儿分组 | 孤儿虚拟 CI 按 `network_domain_id` + `resource_type` 拆分，便于分网域、分资源类型清理 |
| 字段映射 | 必须将外部 CI 的维护人、业务路径、模块路径映射到 `cmdb_maintainer`、`cmdb_business_path`、`cmdb_module_path` |

---

## 5. CMDB 同步策略与失败处理

外部 CMDB 是监控对象的**唯一数据源**，MetricCenter 本地资源是其只读/缓存镜像。同步策略必须保证配置连续性与数据可审计：

| 场景 | 处理规则 |
|------|----------|
| 正常同步 | 按全量或增量方式拉取 CMDB CI，更新本地 `Resource` 镜像；标签模板从 CMDB 字段生成 Prometheus Label |
| 同步失败（CMDB 不可达、接口超时、鉴权失败） | **继续使用上一次成功同步的资源快照**生成配置并下发，保证采集不中断；同步失败事件进入审计日志 |
| 对象在 CMDB 中被删除或长期无法同步 | 保留该对象 **7 天**（可配置），期间继续按旧快照采集；超过 7 天后标记为 `status=orphan`，进入孤儿资源管理 |
| 对象恢复同步 | 自动取消 `orphan` 标记，恢复为 `online` 并按最新 CMDB 数据更新 |

> **设计原则**：CMDB 同步失败不得导致监控中断；旧对象的保留期限默认 7 天，平台管理员可调整。

### 5.1 事件触发 + 定时轮询

BlueKing CMDB 支持事件订阅/事件回调，可在 CI 变更时通知 MetricCenter。由于事件可能丢消息、乱序或积压，必须配合定时轮询作为最终一致性兜底：

| 机制 | 作用 | 频率/触发条件 | 结果冲突时以谁为准 |
|------|------|---------------|-------------------|
| 事件触发 | 加速感知 CMDB CI 变更 | CMDB 推送事件（如 CI 新增/修改/删除） | 辅助 |
| 定时轮询 | 兜底同步、修正事件丢失/乱序 | 默认 15 分钟一次 | **以轮询结果为准** |

**处理规则**：
1. 收到 CMDB 事件后，立即触发增量同步该 CI。
2. 15 分钟轮询时拉取全量或增量快照，覆盖事件触发的结果。
3. 事件与轮询结果冲突时，以轮询结果为准。
4. 轮询失败时按 [5. CMDB 同步策略与失败处理](#5-cmdb-同步策略与失败处理) 的规则继续使用旧快照。

## 6. 孤儿虚拟 CI 管理

超过保留期的对象形成**孤儿虚拟 CI**，按 `network_domain_id` + `resource_type` 拆分为独立视图，便于分网域、分资源类型清理与审计：

| 字段 | 说明 |
|------|------|
| `orphan_group_id` | 孤儿分组标识，格式 `<network_domain_id>:<resource_type>` |
| `network_domain_id` | 孤儿资源原属网域 |
| `resource_type` | 资源类型（host / middleware / application / generic_target） |
| `orphan_objects` | 该分组下的孤儿 CI 列表 |
| `orphan_since` | 首次标记为孤儿的时间 |
| `retention_deadline` | 达到最终清理的截止时间（默认再保留 7 天） |

**孤儿资源生命周期**：
1. CMDB 同步任务检测到某 CI 连续 7 天未返回 → 标记 `status=orphan` 并按 `network_domain_id:resource_type` 分组。
2. 孤儿资源不再进入新生成的 `prometheus.yml`（或单独进入 `orphan` scrape job，仅用于定位）。
3. 平台管理员可在孤儿视图中手动确认：恢复（CI 重新出现）、转为手动资源（`source_type=manual`）或彻底删除。
4. 超过再保留期仍未处理的孤儿资源，由后台任务自动清理。

## 7. BlueKing CMDB 映射规范

腾讯蓝鲸 CMDB 接入时，必须遵循以下映射：

| MetricCenter 概念 | BlueKing CMDB 概念 | 说明 |
|-------------------|--------------------|------|
| Tenant | Business（业务） | 一个 Tenant 对应一个 BlueKing Business；映射关系由 [Module_06](Module_06_Multi_Tenant.md) 维护 |
| NetworkDomain | Cloud Area（云区域） | 一个 NetworkDomain 对应一个 BlueKing Cloud Area；映射关系由 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 维护 |
| Resource | CI（配置项） | CI 字段映射到 Resource 的 `cmdb_ci_id`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer` |

> 注：Tenant/NetworkDomain 到 BlueKing 的映射关系在 v0.2 就需要具备（租户数据模型 + 网域关联），但 BlueKing 字段填充与同步由本模块在 v0.4+ 实现。

### 7.1 CMDB CI 类型映射表

BlueKing CMDB 中的 CI 模型（`bk_obj_id`）需要映射到 MetricCenter 的 `resource_type`。映射表由本模块维护，支持管理员自定义扩展：

| BlueKing CI 类型（`bk_obj_id`） | MetricCenter `resource_type` | 默认启用 | 说明 |
|--------------------------------|------------------------------|----------|------|
| `host` / `bk_host` | `host` | ✅ | 物理机/虚拟机 |
| `mysql`、`redis`、`mongodb` 等中间件 | `middleware` | ✅ | 数据库/缓存/消息队列等 |
| `biz`、`module` 等业务/模块对象 | `application` | ❌ | 通常不直接作为采集目标；可选映射 |
| 未知/未配置 CI 类型 | — | — | 进入 [7.2 待分类 CI 队列](#72-待分类-ci-队列) |

**映射规则**：
- 一个 BlueKing CI 类型只能映射到一个 MetricCenter `resource_type`。
- 映射表支持按 `network_domain_id` 覆盖（例如不同网域对同一 CI 类型采用不同映射）。
- 管理员可在 UI 中启用/禁用某条映射；禁用的 CI 类型同步时直接进入待分类队列。

### 7.2 待分类 CI 队列

当同步任务遇到以下情况时，该 CI 不进入 `Resource` 主表，而是进入**待分类 CI 队列**：

| 场景 | 处理方式 |
|------|----------|
| BlueKing CI 类型未在映射表中配置 | 进入待分类队列，等待管理员配置映射 |
| 映射表已存在但该映射被禁用 | 进入待分类队列 |
| CI 关键字段缺失（如缺少 `bk_inst_id`、无可用 IP） | 进入待分类队列，并记录缺失字段 |
| 管理员主动将某 CI 移入待分类 | 暂停同步该 CI，保留在队列中 |

**待分类队列字段**：

| 字段 | 说明 |
|------|------|
| `pending_ci_id` | 待分类 CI 唯一标识 |
| `provider_id` | 来源 Provider（如 `blueking`、`http`、`nacos`） |
| `network_domain_id` | 所属网域 |
| `external_ci_type` | 外部 CI 类型名（如 BlueKing `bk_obj_id`） |
| `external_ci_id` | 外部 CI ID（如 BlueKing `bk_inst_id`） |
| `raw_data` | 原始 CI 数据快照，便于管理员判断 |
| `reason` | 进入队列原因：`unmapped_type` / `disabled_mapping` / `missing_field` / `manual` |
| `created_at` | 进入队列时间 |
| `resolved_at` | 处理完成时间 |
| `status` | `pending` / `mapped` / `ignored` |

**处理流程**：
1. 管理员在待分类队列中查看原始 CI 数据。
2. 选择“映射到现有类型”：在映射表中新增/启用一条规则，该 CI 下次轮询时进入 `Resource` 主表。
3. 选择“忽略”：该 CI 不再同步，但保留审计记录。
4. 同步任务**不阻塞**：即使存在待分类 CI，其他已映射 CI 仍正常同步。

---

## 8. 依赖

- `upstream/prometheus/discovery/discovery.go`
- `upstream/prometheus/discovery/targetgroup/`
- `platform/discovery/`
- `platform/config/cmdb_provider.go`
- `platform/models/`（Resource、NetworkDomain、Tenant）

---

## 9. 验收标准

- [ ] 实现至少一种外部 Provider（腾讯蓝鲸 或 HTTP）
- [ ] Provider 输出能被转换为 MetricCenter Resource 模型
- [ ] 新增/删除目标能自动同步到资源管理模块
- [ ] 同步后的目标可通过配置管理模块生成 prometheus.yml
- [ ] 同步失败时继续使用上一次成功快照，不中断采集
- [ ] 支持事件触发 + 15 分钟定时轮询双保险；事件与轮询冲突时以轮询为准
- [ ] CMDB 中删除/长期失联的对象保留 7 天后标记为 `orphan`
- [ ] 孤儿资源按 `network_domain_id` + `resource_type` 分组展示，支持恢复、转手动、删除
- [ ] BlueKing CMDB 字段正确映射到 `cmdb_ci_id`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer`
- [ ] 维护 CMDB CI 类型 → `resource_type` 映射表；未映射或禁用的 CI 类型进入待分类队列
- [ ] 待分类 CI 队列支持查看原始数据、映射到现有类型、忽略；同步任务不被阻塞

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | v0.4+ | draft |
