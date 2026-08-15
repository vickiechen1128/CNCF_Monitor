# Module 06: 系统与平台管理（含多租户）

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.3
> **产品版本覆盖**: MVP / v0.2 / v0.4 / v1.0
> **原型版本**: v1.3
> **更新日期**: 2026-08-15
> **对应原型**: `docs/prototypes/module-06/`

> **模块类型**: 企业级能力模块
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_03_Gateway_and_Auth.md](Module_03_Gateway_and_Auth.md)
> **目标用户**: 运维架构师、平台管理员

---

## 1. 模块目标

提供 MetricCenter **租户与平台级管理**能力，重点是租户生命周期、租户-网域关联、平台全局策略与数据存储管理。用户/角色/权限策略可能由外部统一身份认证（IAM/SSO）承接，本模块只定义数据契约与租户边界；网关层鉴权、请求级审计事件收集由 [Module_03](Module_03_Gateway_and_Auth.md) 负责。

> **MVP 阶段**：本模块不做完整功能。MetricCenter 在 MVP 阶段以单租户 `platform_admin` 模式运行；`platform_admin` 是系统预置的默认租户，拥有 `default` 网域，所有未显式分配租户/网域的资源默认归属于该租户。MVP 阶段所有资源都在 `platform_admin` 租户内可见，但**这并不意味着存在跨租户的全局可见性**。  
> **v0.2 阶段**：租户数据模型与租户-网域关联必须落地（支撑 Module_09 网域管理）。  
> **v1.0 阶段**：引入完整的用户/角色/权限、审计与平台配置能力。

> **关键约束**：MetricCenter 不存在跨租户的全局平台管理员身份。任何用户（包括 `platform_admin` 租户下的用户）都只能在所属租户及其拥有的网域范围内查看和管理资源；管理权限按租户作用域隔离。

---

## 2. 用户故事

- ARCH-01：创建和管理租户
- M06-ARCH-04：为租户分配网域，确保网域不跨租户
- ARCH-05：管理用户权限与角色（v1.0+ 或外部 IAM）

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **租户管理** | 创建、编辑、禁用租户；v0.2 起必须落地 | P0/P1（v0.2） |
| **租户-网域关联** | 1 租户 : N 网域，禁止跨租户共享网域；v0.2 起必须落地 | P0/P1（v0.2） |
| **用户与权限** | 租户内用户增删改查、角色/权限策略分配；可能由外部 IAM/SSO 承接 | P2 / 外部化 |
| **数据隔离** | 租户只能查看本租户数据；依赖 Module_03 label 注入，MVP 不启用 | P2 |
| **资源配额** | 限制租户的采集目标数、查询 QPS、存储时长 | P2 |
| **数据存储管理** | TSDB 状态查看、Retention、平台级 Remote Write 转发开关 | P2 |
| **审计日志** | 展示/归档关键操作、配置变更、登录日志；请求级审计事件由 Module_03 收集 | P2 |
| **平台配置** | 全局 scrape 策略限制、通知默认配置 | P2 |

---

### 3.1 租户与网域关系

> 本关系随 Module_09 v0.2 一起落地。

- **1 个租户（Tenant）可以拥有 N 个网域（NetworkDomain），禁止跨租户共享网域**。
- `default` 等默认网域归属 `platform_admin` 租户，`platform_admin` 是系统预置租户，用于承载平台级默认配置与未显式分配租户的资源。`platform_admin` 租户本身仍遵循“1 网域 : 1 租户”的单一归属原则，不能作为多个租户的共享租户或共享网域。
- `network_domain_id` 必须全局唯一，建议采用租户前缀（如 `<tenant_id>-<domain_code>`），避免不同租户下出现同名网域导致路由与数据混淆。
- **租户级多网域开关**：`Tenant.multi_site_enabled` 控制该租户是否开启多网域能力。关闭时，租户内仅展示 `default` 管理域，隐藏「网域管理」与「Agent 状态」入口；开启时，可注册多个网域并接入 Edge Agent。MVP 阶段仅有 `platform_admin` 租户，v0.2+ 各租户独立配置。
- **M06 与 M09 职责边界（v1.3）**：
  - **M06（本模块）是 `NetworkDomain` 的行政 Owner**：负责网域的创建、编辑、禁用、租户分配与配额；网域创建/编辑表单只维护行政信息（ID、名称、租户、状态），不维护监控参数（`agent_type` / `remote_write_url` 等）。
  - **M09 是网域的监控纳管 Owner**：负责把 M06 中已存在的网域标记为「已纳管监控」，填写监控参数、安装 Edge Sync Agent、生成并下发配置。M09 不创建新的 `NetworkDomain` 行政记录。
  - 因此，`Tenant.network_domain_ids` 表示「该租户被授权可使用的网域列表」，不等于这些网域都已接入监控；已纳管网域由 M09 的 `EdgeAgent` 实例与网域监控参数存在性决定。
- 示例：租户“卫健委”拥有“医院 A 专网”和“医院 B 专网”；只有完成 M09 纳管后，这两个网域才会出现在 M01/M09 的监控操作上下文中。

| 关系 | 说明 | 示例 |
|------|------|------|
| 1 租户 : N 网域 | 一个租户可管理多个隔离网域 | 卫健委 → 医院 A 专网、医院 B 专网 |
| 1 网域 : 1 租户 | 单个网域必须且只能归属一个租户 | 医院 A 专网 → 卫健委 |
| `default` 网域 | 系统默认网域归属 `platform_admin` 租户；未指定租户的资源默认继承该归属，但并不意味着 `platform_admin` 可跨租户访问其他租户数据 | `default` → `platform_admin` |

### 3.2 租户与 BlueKing CMDB 映射

> 本节映射关系在 v0.4+ 由 [Module_04](Module_04_Custom_Discovery.md) 同步时落地。

MetricCenter 的租户模型必须与 BlueKing CMDB 业务（Business）模型一一对应，保证 CMDB 作为监控对象唯一数据源时，租户边界与 CMDB 业务边界一致。

| MetricCenter 对象 | BlueKing CMDB 对象 | 映射规则 | 说明 |
|-------------------|-------------------|----------|------|
| Tenant | Business（业务） | 1:1 | 一个租户唯一对应一个蓝鲸业务；`platform_admin` 租户可映射到蓝鲸的“平台管理”业务或保留为空。该映射仅用于 CMDB 同步，不赋予 `platform_admin` 跨租户访问权限 |
| NetworkDomain | Cloud Area（云区域） | 1:1 | 网域对应蓝鲸云区域，具体由 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md#41-%E7%BD%91%E5%9F%9Fnetworkdomain) 定义 |

> **约束 {v1.0+}**：禁止绕过 CMDB 业务/模块路径直接在 MetricCenter 中定义业务归属；ITSM 服务目录必须通过显式 CMDB 业务/模块路径与监控对象关联。

---

## 4. 隔离方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 单实例 + tenant label | 成本低，部署简单 | 需要修改查询注入 label |
| 多实例隔离 | 完全隔离，安全性高 | 资源成本高，管理复杂 |

**建议第一版采用单实例 + tenant label 方案。**

在“单实例 + tenant label”方案下，查询需同时注入 `tenant` 与 `network_domain` 两个维度，确保租户只能看到其拥有的网域数据。**任何用户（包括 `platform_admin` 租户用户）都不应拥有 bypass 租户/网域隔离的能力**。

---

## 4.1 平台管理子能力

> 本节中的“平台管理”指 `platform_admin` 租户内可执行的配置与运维操作，作用于 `platform_admin` 租户及其拥有的网域（如 `default`），不作用于其他租户。

### 4.1.1 数据存储管理

| 功能 | 说明 |
|------|------|
| TSDB 状态查看 | 展示 Prometheus TSDB 状态（通过 `/api/v1/status/tsdb`），只读 |
| Retention 配置 | 设置数据保留周期 |
| Remote Write 转发开关 | 平台级开关：是否启用中心到长期存储的转发；具体 Edge Agent Remote Write 参数由 Module_09 负责，Ingestion Gateway 接收点由 Module_10 负责 |

### 4.1.2 审计日志

| 功能 | 说明 |
|------|------|
| 操作记录 | 记录资源、配置、规则的增删改查 |
| 变更追踪 | 展示配置 Diff 与操作人 |
| 登录日志 | 记录用户登录行为 |

### 4.1.3 平台配置

| 功能 | 说明 |
|------|------|
| 全局 scrape 策略限制 | 平台级最小/最大 `scrape_interval`、`scrape_timeout` 限制；具体 Job/模板默认值由 Module_01/07 定义 |
| 通知默认配置 | 默认接收人、告警模板 |

---

## 5. 数据模型

### 5.1 租户（Tenant）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 租户唯一标识；v0.4+ 建议与 BlueKing Business 编码保持一致 |
| name | string | ✅ | 租户展示名 |
| network_domain_ids | []string | ❌ | {v0.2} 该租户被授权可使用的网域 ID 列表；由 M06 维护，不表示这些网域都已接入监控（已纳管状态由 M09 决定） |
| multi_site_enabled | bool | ✅ | 是否开启多网域能力；`false` 时租户内仅使用 `default` 管理域并隐藏网域/Agent 管理入口；`true` 时开放多网域与 Edge Agent 管理 |
| cmdb_business_id | string | ❌ | {v0.4+} 对应 BlueKing CMDB 业务 ID（bk_biz_id） |
| cmdb_business_path | string | ❌ | {v0.4+} 对应 BlueKing CMDB 业务路径，如 `政务云/卫健委` |
| is_platform_admin | bool | ✅ | 标记该系统预置租户（默认租户），用于承载 `default` 网域与平台级默认配置。**该字段不表示跨租户的超级管理员权限**；`platform_admin` 租户的用户与其他租户用户一样，只能访问本租户内的资源 |
| status | enum | ✅ | active / suspended / disabled |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |

---

## 6. 依赖

- `platform/gateway/tenant/`
- `platform/gateway/auth/`
- `platform/models/`
- [Module 03: 网关与认证](Module_03_Gateway_and_Auth.md)

---

## 7. 验收标准

- [ ] {v0.2} 1 个租户可关联多个网域，1 个网域必须且只能归属 1 个租户，禁止跨租户共享网域
- [ ] {v0.2} `network_domain_id` 全局唯一，建议支持租户前缀校验
- [ ] {v0.2} `platform_admin` 是系统预置默认租户，拥有 `default` 网域，并遵循与其他租户相同的租户-网域隔离规则
- [ ] {P2} 租户内用户（含 `platform_admin` 租户用户）只能看到本租户及其拥有的网域内的目标和指标
- [ ] {P2 / 外部 IAM} 支持租户内用户角色分配
- [ ] {P2} 关键操作记录审计日志
- [ ] {P2} 可查看 TSDB 状态与 Retention 配置
- [ ] {P2} 可配置 Remote Write 转发目标
- [ ] {P2} 可维护平台全局 scrape 默认值
- [ ] {v0.4+} 租户可维护 BlueKing CMDB 业务 ID 与业务路径映射
- [ ] {P2} 不存在跨租户的全局管理员角色；`platform_admin` 租户管理员只能管理 `platform_admin` 租户及其拥有的网域

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.3.1 | 2026-08-15 | 修改（原型对齐） | 原型落地 v1.3 职责边界：①module-06 原型新增「网域管理」页面（网域行政唯一创建入口：名称/租户/状态/描述，ID 按租户前缀自动生成，编辑/禁用，管理域不可禁用）；②租户表单「被授权网域」下拉数据源从硬编码改为网域管理行政记录，选项标注纳管状态；③module-09 原型同步移除「新增网域」，改为「纳管网域」（见 Module_09 v1.29.1） | 原型 `docs/prototypes/module-06/` | MVP / v0.2 | 设计中 |
| v1.3 | 2026-08-15 | 修改 | 明确 M06 与 M09 网域职责边界：M06 为 `NetworkDomain` 行政 Owner（创建/分配/配额），M09 为监控纳管 Owner；`Tenant.network_domain_ids` 含义改为「被授权可使用的网域列表」，不等于已纳管；网域创建/编辑表单只维护行政信息 | 3.1 租户与网域关系、5.1 数据模型 | MVP / v0.2 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | 新增 `Tenant.multi_site_enabled` 字段，明确多网域能力为租户级开关 | 数据模型、租户-网域关系 | MVP / v0.2 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | MVP / v0.2 / v0.4 / v1.0 | draft |
