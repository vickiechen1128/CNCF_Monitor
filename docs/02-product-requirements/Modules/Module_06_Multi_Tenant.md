# Module 06: 系统与平台管理（含多租户）

> **PRD 状态**: `ready`（可开发版本）
> **PRD 版本**: v2.2
> **产品版本覆盖**: MVP / v0.2 / v0.4 / v1.0
> **原型版本**: v2.3（已对齐，见 Modules/README.md）
> **更新日期**: 2026-08-21
> **对应原型**: `docs/prototypes/module-06/`

> **模块类型**: 企业级能力模块
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_03_Gateway_and_Auth.md](Module_03_Gateway_and_Auth.md)
> **目标用户**: 运维架构师、平台管理员

---

## 1. 模块目标

提供 MetricCenter **租户与平台级管理**能力，重点是租户生命周期、租户-网域关联、平台全局策略与数据存储管理。用户/角色/权限策略可能由外部统一身份认证（IAM/SSO）承接，本模块只定义数据契约与租户边界；网关层鉴权、请求级审计事件收集由 [Module_03](Module_03_Gateway_and_Auth.md) 负责。

> **MVP 阶段**：以单租户 `platform_admin` 模式运行；`platform_admin` 是系统预置的默认租户，统一登记并持有 `default` 等部署级网域，所有未显式分配租户/网域的资源默认归属于该租户。MVP 阶段所有资源都在 `platform_admin` 租户内可见，但**这并不意味着存在跨租户的全局可见性**。**网域登记管理（创建 / 编辑 / 禁用网域，含区域属性 `zone_type`，`default` 不可禁用）纳入 MVP 范围**（2026-08-18 评审结论：网域 / 租户管理纳入 MVP，见 `docs/05-execution-records/module-07/design-decisions.md`「评审结论」E 组）——M07 资源导入 / 录入与 M09 监控纳管的网域引用由此闭环（M07 5.16.1 报错引导指向本入口）。
>
> **MVP 无鉴权声明（决策 8）**：MVP 不实现接口级鉴权（Module_03 网关鉴权未落地），依赖部署网络隔离（内网 / VPN），属**已知风险**；本文所述「不存在跨租户的全局可见性」描述的是**数据模型与设计目标**，不代表 MVP 已启用鉴权拦截。生产化前必须完成 Module_03 鉴权接入。
>
> **种子数据初始化（决策 23）**：`platform_admin` 租户与 `default` 管理域由后端启动时 **migration upsert** 保证存在（与 `platform/db` GORM 初始化路径一致，幂等、可重复执行、随代码版本演进），不依赖部署脚本 seed。
> **v0.2 阶段**：租户数据模型与租户-网域关联必须落地（支撑 Module_09 网域管理）；网域登记在 MVP 已提供，v0.2 扩展租户维度与配额管理。  
> **v1.0 阶段**：引入完整的用户/角色/权限、审计与平台配置能力。

> **关键约束**：MetricCenter 不存在跨租户的全局平台管理员身份。任何用户（包括 `platform_admin` 租户下的用户）都只能在所属租户及其**被授权使用**的网域范围内查看和管理资源；管理权限按租户作用域隔离。

---

## 2. 用户故事

> 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.9 节**；产品级用户故事使用产品编码（`ARCH-NN`），模块级故事使用模块命名空间编码（`M06-ROLE-NN`，全局唯一）。本模块仅在此列出编码与一句话摘要。

- **ARCH-01**：创建和管理租户，为不同团队隔离数据。
- **M06-ARCH-04**：为租户分配（授权使用）网域；网域为部署级资源、可跨租户共享，通过授权 scope 实现数据隔离。
- **ARCH-05**：管理用户权限与角色，控制数据访问范围（v1.0+ 或外部 IAM 承接）。

---

## 3. 核心功能

### 3.1 核心功能总表

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **租户管理** | 创建、编辑、禁用租户；v0.2 起必须落地 | P0/P1（v0.2） |
| **租户-网域关联** | 1 租户 : N 网域（授权使用）；网域为部署级资源、可跨租户共享；v0.2 起必须落地 | P0/P1（v0.2） |
| **用户与权限** | 租户内用户增删改查、角色/权限策略分配；可能由外部 IAM/SSO 承接 | P2 / 外部化 |
| **数据隔离** | 租户只能查看本租户数据；依赖 Module_03 label 注入，MVP 不启用 | P2 |
| **资源配额** | 限制租户的采集目标数、查询 QPS、存储时长 | P2 |
| **数据存储管理** | TSDB 状态查看、Retention、平台级 Remote Write 转发开关 | P2 |
| **审计日志** | 展示/归档关键操作、配置变更、登录日志；请求级审计事件由 Module_03 收集 | P2 |
| **平台配置** | 全局 scrape 策略限制、通知默认配置 | P2 |

### 3.2 租户与网域关系

> 本关系随 Module_09 v0.2 一起落地。

- **1 个租户（Tenant）可被授权使用 N 个网域（NetworkDomain）；网域是部署级资源，可跨租户共享**。租户通过授权 scope 使用网域，**授权 ≠ 拥有**——网域的登记所有权不随授权转移。
- `default` 等部署级网域由 `platform_admin` 统一登记并持有，用于承载平台级默认配置与未显式分配租户的资源；其他租户可通过授权使用这些网域（含 `default`），授权是使用范围，不改变网域的登记所有权，`platform_admin` 也不因此获得跨租户访问其他租户数据的能力。
- `network_domain_id` 必须全局唯一，建议采用部署级前缀（如 `<deploy_code>-<domain_code>`），避免不同环境/网域出现同名网域导致路由与数据混淆。
- **租户级多网域开关**：`Tenant.multi_site_enabled` 是该租户是否允许**被授权使用多个网域**的**行政能力开关**，不控制 Module_09 页面入口的显示/隐藏；Module_09 入口由数据驱动——「网域管理」入口常驻展示所有已授权网域，「Agent 状态」入口由是否存在 EdgeAgent 实例决定。`multi_site_enabled=false` 时，平台侧仅授权单个网域（通常为 `default`），M09 仍可查看 `default` 网域及其纳管状态；`multi_site_enabled=true` 时，可为该租户登记并授权多个网域，并在 M09 逐个完成监控纳管。MVP 阶段仅有 `platform_admin` 租户，v0.2+ 各租户独立配置。
- **M06 与 M09 职责边界**：
  - **M06（本模块）是 `NetworkDomain` 的行政 Owner**：负责网域的创建、编辑、禁用、租户授权与配额；网域创建/编辑表单只维护行政信息（ID、名称、登记归属、授权租户、状态、`zone_type`），不维护监控参数（`agent_type` / `remote_write_url` / `center_endpoint` 等）。
  - **M09 是网域的监控纳管 Owner**：负责把 M06 中已存在的网域标记为「已纳管监控」，填写监控参数、安装 Edge Sync Agent、生成并下发配置。M09 不创建新的 `NetworkDomain` 行政记录。
  - 因此，`Tenant.network_domain_ids` 表示「该租户被授权可使用的网域列表」，不等于这些网域都已接入监控；已纳管网域由 M09 的 `EdgeAgent` 实例与网域监控参数存在性决定。
- 示例：租户"卫健委"被授权使用"医院 A 专网"和"医院 B 专网"（两个网域也可同时授权给疾控中心等租户共享）；只有完成 M09 纳管后，这些网域才会出现在 M01/M09 的监控操作上下文中。
- **网域地位**：网域是**逻辑操作上下文与采集边界**，不是控制面层级；单租户内控制面仍为中心单一实例，网域不构成独立的管理面。

> **网域定义唯一入口原则（单一事实来源）**：网域/网络区域的**定义**（名称、登记归属、授权租户、`zone_type`）只在 M06 网域管理登记一次。下游模块（M07 资源导入/录入、M09 监控纳管、CMDB 同步）**只引用** `network_domain_id`，不得在其他入口新建网域或在资源上冗余区域属性（见 Module_07 5.4「区域属性单一事实来源」）。
>
> **网络区域类型 `zone_type`**：NetworkDomain 的行政分类字段，表达该网域的**网络隔离/位置语义**：
>
> - **不做死枚举**：值集为**部署级字典**（平台配置文件维护，UI 以下拉选择呈现），不同客户环境预置不同词汇——政务云预置 `internet`（互联网区）/ `extranet`（政务外网区）/ `private-line`（专线区）/ `dmz`；公有云预置按 region 划分（如 `cn-hangzhou`）；
> - **模型层只有一个概念**：NetworkDomain 即「监控视角的网络隔离/位置单元」——政务云里映射"区"，公有云里映射 region；AZ 是 region 内部可用性维度、不构成监控隔离边界，**不进入 NetworkDomain**，如客户需要可作为 Resource 普通属性/标签（v0.2+ 再评估）；
> - 一句话原则：**隔离边界建实体（NetworkDomain），位置维度建属性（`zone_type`），叫法建字典（部署级词汇表）**；
> - `zone_type` 由 M06 在网域创建/编辑时登记，M09 纳管时只读引用，并在配置生成时注入指标标签（见 Module_09 4.1 / 6.5）。

| 关系 | 说明 | 示例 |
|------|------|------|
| 1 租户 : N 网域 | 一个租户可被授权使用多个隔离网域 | 卫健委 → 医院 A 专网、医院 B 专网 |
| 1 网域 : N 租户 | 单个网域可被多个租户授权使用（跨租户共享）；登记所有权归 `platform_admin`，授权 ≠ 拥有 | 医院 A 专网 ← 卫健委、疾控中心 |
| `default` 网域 | 部署级默认网域由 `platform_admin` 登记持有，可授权其他租户使用；未显式指定网域的资源默认落在 `default` 网域，但 `platform_admin` 不因此获得跨租户访问其他租户数据的能力 | `default`（登记持有：`platform_admin`；授权使用：各租户） |

> **租户、网域、业务三者正交**：租户管权限边界、网域管采集边界、业务管监控对象分组，三者独立变化：
> - **网域由网络环境决定**（登记制，不是为某个业务创建的），低频固定；业务是组织管理维度，持续演进，可以由多个业务共用同一网域；
> - 每个资源有且仅有 **1 个网域归属 + 1 个业务归属**；多业务共用 1 个网域、1 个业务跨多网域均为正常状态，无需特殊处理；
> - 查询通过 `biz` + `network_domain` 标签组合过滤；**禁止把业务编码进网域命名，或把网域编码进业务命名**；
> - 业务的登记字典与资源归属由 [Module_07](Module_07_Monitoring_Object_Management.md) 维护（`biz_code` 经标签模板映射为 `biz` 标签，见 Module_07 §5.15）。

> **多运维团队共享网域的配置治理（决策 20）**：网域是物理边界、不是团队边界。多个运维团队（租户）可共享同一网域，配置影响按三层隔离：
> - **写权限**（M06）：网域行政记录仅登记方 / `platform_admin` 可修改；
> - **配置内容**（M09）：各租户在该网域下的 targets / relabel / rules 按租户命名空间分目录生成，只生成本租户包；
> - **下发动作**（M09）：Edge Agent 配置包 / Prometheus reload 只下发本租户包。
>
> MVP 单团队场景退化为仅 `platform_admin` 租户，所有配置都在该租户命名空间下，不存在跨团队覆盖问题。

### 3.3 租户、网域与 BlueKing CMDB 映射

> 本节映射关系在 v0.4+ 由 [Module_04](Module_04_Custom_Discovery.md) 同步时落地。

租户（Tenant）是**MetricCenter 内部的数据隔离与权限作用域单位**，对应一个运维团队/组织；业务（`biz_code` / `biz_name`）是**监控对象的分组维度**，对应 BlueKing CMDB 的业务（Business）。两者解耦，不可再一一对应：

- MVP 单租户 `platform_admin` 即为一套部署的单一项目空间，承载全部业务；
- 多租户场景下，一个租户可查看/管理其被授权网域内的多个业务；业务是资源分组维度、不与租户绑定，同一业务下的资源可分布在不同租户授权使用的网域中（与网域-业务正交原则一致）；
- 业务字典与业务归属由 [Module_07](Module_07_Monitoring_Object_Management.md) 维护，`biz_code` 经标签模板映射为 `biz` 标签，具体见 Module_07 §5.15。

| MetricCenter 对象 | BlueKing CMDB 对象 | 映射规则 | 说明 |
|-------------------|-------------------|----------|------|
| Tenant | — | 行政维护 | 租户是 MetricCenter 内部权限边界，MVP 固定为 `platform_admin`；不与 BlueKing Business 强制映射 |
| Business（`biz_code` / `biz_name`） | Business（业务） | 1:1（编码） | BlueKing `bk_biz_id` / `bk_biz_name` 映射为 [Module_07](Module_07_Monitoring_Object_Management.md) 业务分组字典的 `biz_code` / `biz_name`；资源通过 `biz_code` 字段归属业务 |
| NetworkDomain | Cloud Area（云区域） | 1:1 | 网域对应蓝鲸云区域，具体由 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md#41-%E7%BD%91%E5%9F%9Fnetworkdomain) 定义 |

> **约束 {v1.0+}**：禁止绕过 CMDB 业务/模块路径直接在 MetricCenter 中定义业务归属；ITSM 服务目录必须通过显式 CMDB 业务/模块路径与监控对象关联。
>
> **三维度正交原则**：租户管权限边界、网域管采集边界、业务管监控对象分组；三者独立变化（详见 [3.2](#32-租户与网域关系)）。

### 3.4 数据隔离方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 单实例 + tenant label | 成本低，部署简单 | 需要修改查询注入 label |
| 多实例隔离 | 完全隔离，安全性高 | 资源成本高，管理复杂 |

**建议第一版采用单实例 + tenant label 方案。**

在“单实例 + tenant label”方案下，查询需同时注入 `tenant` 与 `network_domain` 两个维度，确保租户只能看到其被授权使用的网域数据。**任何用户（包括 `platform_admin` 租户用户）都不应拥有 bypass 租户/网域隔离的能力**。

### 3.5 平台管理子能力

> 本节中的“平台管理”指 `platform_admin` 租户内可执行的配置与运维操作，作用于 `platform_admin` 租户及其登记持有的网域（如 `default`），不作用于其他租户。

#### 3.5.1 数据存储管理

| 功能 | 说明 |
|------|------|
| TSDB 状态查看 | 展示 Prometheus TSDB 状态（通过 `/api/v1/status/tsdb`），只读 |
| Retention 配置 | 设置数据保留周期 |
| Remote Write 转发开关 | 平台级开关：是否启用中心到长期存储的转发；具体 Edge Agent Remote Write 参数由 Module_09 负责，Ingestion Gateway 接收点由 Module_10 负责 |

#### 3.5.2 审计日志

| 功能 | 说明 |
|------|------|
| 操作记录 | 记录资源、配置、规则的增删改查 |
| 变更追踪 | 展示配置 Diff 与操作人 |
| 登录日志 | 记录用户登录行为 |

#### 3.5.3 平台配置

| 功能 | 说明 |
|------|------|
| 全局 scrape 策略限制 | 平台级最小/最大 `scrape_interval`、`scrape_timeout` 限制；具体 Job/模板默认值由 Module_01/07 定义 |
| 通知默认配置 | 默认接收人、告警模板 |

---

## 4. 核心流程

> 模块以**管理面操作**为主（租户/网域/平台配置的管理操作），核心流程为 v0.2+ 落地的行政管理链路；用户层流程与技术层时序可并存。

### 4.0 MVP 网域登记流程（MVP，闭环）

> 区别于 4.1 的 v0.2 全流程（含租户创建/授权），MVP 单租户下只做「网域登记」这一件事，四步闭环：

```text
① 登记：创建边缘域（行政信息：名称 / description / zone_type / 状态；id 按部署级前缀自动生成）
   │
   ▼
② 引用：M07 资源导入 / 录入时选择已登记网域（M06 单一事实来源）
   │
   ▼
③ 纠错：编辑行政信息（登记归属创建后不可变更）/ 禁用（冻结：拒绝新登记与新纳管，存量不受影响）/ 空网域删除
   │
   ▼
④ 纳管：交 Module_09 完成监控纳管（不在 M06 闭环）
```

- 纠错路径：行政信息填错 → 直接编辑（登记归属除外）；不再需要 / 误登记 → 空网域直接删除，有资源引用的网域走「禁用」冻结。

### 4.1 租户与网域行政管理流程（v0.2）

```text
① 创建租户（新业务团队接入，分配 multi_site_enabled）
   │
   ▼
② 创建并登记网域（M06 网域管理：名称 / 登记归属 / zone_type / 状态）
   │
   ▼
③ 将网域授权给租户（Tenant.network_domain_ids 维护「被授权可使用」列表；1 网域可授权多个租户共享）
   │
   ▼
④ 各网域仍属「未纳管」——由用户到 Module_09 逐个完成监控纳管
```
1. **创建租户**：平台管理员创建租户，设置展示名与 `multi_site_enabled`（是否允许多网域）等能力。
2. **登记网域**：平台管理员在「网域管理」登记网域行政信息（名称、登记归属、`zone_type`、状态），`id` 按部署级前缀自动生成。
3. **授权网域**：将已登记网域授权给一个或多个租户使用（`Tenant.network_domain_ids` 维护「被授权可使用」列表）；网域为部署级资源、可跨租户共享，**授权 ≠ 拥有**。
4. **移交纳管**：行政登记与授权完成后，由 Module_09 选择网域进行监控纳管并下发配置；本模块不参与采集配置。

### 4.2 多网域能力开关决策（v0.2）

- 管理员在创建/编辑租户时设定 `multi_site_enabled`：
  - `false`（单网域）：平台侧仅授权单个网域（通常为 `default`），M09 仍可查看 `default` 网域及其纳管状态。
  - `true`（多网域）：可为该租户登记并授权多个网域，M09 逐个完成监控纳管。
- 该开关仅约束**行政能力**，不控制 M09 页面入口的显示/隐藏（M09 入口由数据驱动）。

### 4.3 CMDB 业务与网域映射同步流程（v0.4+）

```text
① 外部 CMDB 同步（Module_04）读取 BlueKing 业务（Business）与云区域（Cloud Area）
   │
   ▼
② 映射：Business → M07 业务分组字典条目（biz_code / biz_name，1:1 编码），Cloud Area → NetworkDomain（1:1）
   │
   ▼
③ 校验网域定义唯一入口与 CMDB 路径一致
   │
   ▼
④ 落库并刷新业务字典条目的 cmdb_business_id / cmdb_business_path（供手工登记条目与 CMDB 匹配合并）
```

---

## 5. 数据模型

### 5.1 租户（Tenant）

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 租户 ID | 租户唯一标识；建议全局唯一，且不编码外部 CMDB Business 语义 |
| name | string | ✅ | 租户名称 | 租户展示名 |
| network_domain_ids | []string | ❌ | 被授权网域 | {v0.2} 该租户被授权可使用的网域 ID 列表（**授权 ≠ 拥有**；网域为部署级资源，登记所有权归 `platform_admin`，授权不转移所有权）；由 M06 维护授权关系，不表示这些网域都已接入监控（已纳管状态由 M09 决定） |
| multi_site_enabled | bool | ✅ | 多网域能力 | 是否允许该租户**被授权使用多个网域**的行政能力开关；`false` 时平台侧仅授权单个网域（通常为 `default`），M09 仍可查看 `default` 网域及其纳管状态；`true` 时开放多网域授权与 Edge Agent 管理。该开关不控制 M09 页面入口显示/隐藏，M09 入口由数据驱动 |
| is_platform_admin | bool | ✅ | 平台默认租户 | 标记该系统预置租户（默认租户），用于承载 `default` 网域与平台级默认配置。**该字段不表示跨租户的超级管理员权限**；`platform_admin` 租户的用户与其他租户用户一样，只能访问本租户内的资源 |
| status | enum | ✅ | 状态 | active / suspended / disabled（`suspended` 为预留值，MVP 无操作入口，v0.2 落地时补接口与验收） |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |
| updated_at | datetime | ✅ | 仅技术信息 | 更新时间 |

### 5.2 网域（NetworkDomain）行政字段

> **职责边界**：`NetworkDomain` 数据模型的完整字段由 **Module_09 [5.1](Module_09_Network_Domain_and_Edge_Config_Center.md#51-%E7%BD%91%E5%9F%9Fnetworkdomain)** 统一定义。M06 为本模块的**行政 Owner**，只维护以下行政字段；监控纳管字段（`channel` / `agent_type` / `remote_write_url` / `center_endpoint` / 运行态字段）由 M09 维护并填写。

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 网域 ID | 网域唯一标识，必须全局唯一；采用部署级前缀生成，规则 = `<deploy_code>-<domain_code>`（`deploy_code` 为部署级标识，在部署配置中设定——配置文件或环境变量 `METRIC_CENTER_DEPLOY_CODE`，默认 `mc`；`default` 管理域为历史预置例外，无前缀） |
| name | string | ✅ | 网域名称 | 网域展示名 |
| description | string | ❌ | 描述 | 网域描述 |
| domain_type | enum | ✅ | 域类型 | 管理域（`management`，如 `default`）/ 边缘域（`edge`）；管理域禁止删除 |
| zone_type | string | ❌ | 网络区域类型 | 网络隔离/位置语义分类，值集为部署级字典（政务云互联网区 / 政务外网区等，公有云 region），见 [3.2](#32-租户与网域关系)；下拉数据来自 `GET /api/v2/platform/zone-types` 只读接口（见 6.2），不开放自由文本 |
| tenant_id | string | ✅ | 登记归属 | 登记归属租户 ID（部署级登记方，MVP 固定 `platform_admin`）；表示网域由谁登记持有，不表示网域仅能由该租户使用——网域可授权多个租户共享（见 `authorized_tenant_ids`）。**创建后不可变更**（多租户场景如需调整登记归属，v0.2+ 走独立的归属转移动作，不通过普通编辑） |
| authorized_tenant_ids | []string | ❌ | 授权租户 | 被授权可使用该网域的租户 ID 列表（1 网域 : N 租户，可跨租户共享）；**可选，缺省 = 登记归属租户**（MVP 单租户下默认回填 `platform_admin`）；由 M06 维护授权关系，授权 ≠ 拥有，不等于已纳管 |
| status | enum | ✅ | 状态 | enabled / disabled |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |
| updated_at | datetime | ✅ | 仅技术信息 | 更新时间 |

---

## 6. 接口设计

> 租户管理 REST API 为 v0.2+ 落地；**网域管理-行政字段接口（6.2）MVP 提供登记能力**（评审结论 E 组）。MVP 阶段仅单租户 `platform_admin`，由 Module_03 网关统一鉴权。以下为接口骨架，作为前后端契约输入。

### 6.1 租户管理（v0.2+）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v2/platform/tenants` | 租户列表（分页 / 状态筛选） |
| POST | `/api/v2/platform/tenants` | 创建租户 |
| GET | `/api/v2/platform/tenants/:id` | 租户详情 |
| PUT | `/api/v2/platform/tenants/:id` | 编辑租户（含 `multi_site_enabled`） |
| PATCH | `/api/v2/platform/tenants/:id/status` | 禁用 / 恢复租户 |

### 6.2 网域管理-行政字段（MVP 提供登记，v0.2 扩展租户/配额）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v2/platform/zone-types` | **部署级字典只读接口（MVP）**：返回启用中的网络区域类型字典项 `[{code, display_name, description}]`；数据源 = 部署配置文件预置字典；响应走统一 `{status, data, ...}` 格式 |
| GET | `/api/v2/platform/network-domains` | 网域列表（分页 / 按租户 / zone_type 筛选） |
| POST | `/api/v2/platform/network-domains` | 登记网域（行政信息，`id` 自动生成；网域为部署级资源，登记归属固定 `platform_admin`，可授权多个租户共享，**创建时不校验网域只能归属一个租户**） |
| GET | `/api/v2/platform/network-domains/:id` | 网域详情 |
| PUT | `/api/v2/platform/network-domains/:id` | 编辑网域行政字段（`name` / `description` / `zone_type` / 授权租户）；**登记归属 `tenant_id` 创建后不可变更**，编辑请求不含该字段（v0.2+ 如需调整走独立的归属转移接口） |
| PATCH | `/api/v2/platform/network-domains/:id/status` | 启用 / 禁用网域（管理域不可禁用）。**禁用 = 冻结**：禁用时后端返回影响范围（该网域下 M07 资源数 / 已纳管 EdgeAgent 数），前端二次确认弹窗展示；禁用后不再接受新资源登记到该网域（M07 导入/录入校验拒绝）、不再接受新纳管；存量资源与采集配置不受影响、继续采集（是否停止采集由 M09 退纳管决定，不归 M06 禁用管） |
| DELETE | `/api/v2/platform/network-domains/:id` | 删除网域（**仅限空网域**）：前置校验无 M07 资源引用 且 无已纳管 EdgeAgent，否则拒绝并引导走「禁用」；采用软删（与 `BaseModel` 软删除体系一致）；`management`（`default`）管理域禁止删除 |

> 网域**监控纳管**及监控参数接口归属 Module_09，不进入本模块接口契约。

### 6.3 用户与权限（v1.0+ 或外部 IAM）

- 用户 / 角色 / 权限策略可完全外包给统一身份认证（IAM/SSO）；落地形式由 Module_03 网关与外部身份源决定，本模块仅定义数据契约（租户内角色、`network_domain_id` scope 预留，v1.0+ 评审）。

---

## 7. 依赖

- `platform/gateway/tenant/`
- `platform/gateway/auth/`
- `platform/models/`
- [Module 03: 网关与认证](Module_03_Gateway_and_Auth.md)
- [Module 09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)（网域监控纳管 Owner，`NetworkDomain` 完整数据模型）
- [Module 04: 自定义服务发现](Module_04_Custom_Discovery.md)（v0.4+ BlueKing CMDB 租户映射同步）

---

## 8. 数据模型状态机

> **说明**：集中定义本模块核心对象（租户 / 网域行政态）的状态流转，供后端实现与前后端契约对齐。监控纳管运行态（online/offline）由 Module_09 维护。

**① Tenant 租户状态机**

```text
active（启用）──► suspended（暂停）──► disabled（禁用）
   ▲                  │                    │
   └──────────────────┴────────────────────┘
           （可恢复到 active）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| active | 启用 | 创建或恢复 | 暂停 → suspended；禁用 → disabled |
| suspended | 暂停 | 平台管理员暂停 | 恢复 → active；禁用 → disabled |
| disabled | 禁用 | 平台管理员禁用 | 仅可恢复 → active（不可自动流转） |

**② NetworkDomain 网域状态机（行政态）**

```text
enabled（启用）──► disabled（禁用，不可再被纳管）
   ▲                    │
   └────────────────────┘（可恢复）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| enabled | 启用 | 登记创建/恢复 | 禁用 → disabled |
| disabled | 禁用 | 平台管理员禁用 | 恢复 → enabled；`management`（`default`）域禁止禁用 |
| `management`（默认 `default`） | 管理域 | 系统预置 | 禁止删除、禁止禁用；名称/描述可修改 |

---

## 9. 验收标准

> **分层说明**：验收标准分「用户验收」（用户能在界面感知 / 操作 / 验证，对应原型演示）与「技术验收」（后端机制 / 协议 / 数据契约可验证，对应后端测试与接口验收）。

### 9.1 用户验收（用户可感知与操作）

- [ ] {P0} MVP 阶段系统以单租户 `platform_admin` 模式运行，`platform_admin` 为系统预置默认租户，登记持有 `default` 网域，并遵循与其他租户相同的租户-网域隔离规则
- [ ] {P0} 不存在跨租户的全局管理员角色；`platform_admin` 租户管理员只能管理 `platform_admin` 租户及其登记持有的网域
- [ ] {P0} {v0.2} 租户内用户（含 `platform_admin` 租户用户）只能看到本租户及其被授权使用的网域内的目标和指标
- [ ] {P0} 「网域管理」页面可登记网域行政信息（名称 / 登记归属（MVP 固定 `platform_admin`）/ `zone_type` / 状态），并可启用/禁用网域；管理域（`default`）不可禁用（MVP 提供，2026-08-18 评审结论 E 组）
- [ ] {P0} 网域 `zone_type` 下拉数据来自 `GET /api/v2/platform/zone-types` 只读接口且只含启用项，不开放自由文本（MVP）
- [ ] {P0} 禁用网域时二次确认弹窗展示后端返回的影响范围（该网域下 M07 资源数 / 已纳管 EdgeAgent 数）；禁用后拒绝新资源登记与新纳管，存量资源与采集不受影响（MVP）
- [ ] {P0} 空网域（无 M07 资源引用、无已纳管 EdgeAgent）可删除，非空网域删除被拒并引导走「禁用」；管理域（`default`）不可删除（MVP）
- [ ] {P0} {v0.2} 1 个租户可被授权使用多个网域、1 个网域可授权多个租户共享（授权 ≠ 拥有）；界面可登记网域并授权给租户使用
- [ ] {P0} {v0.2} 网域创建/编辑表单可维护 `zone_type`（网络区域类型），选项来自部署级字典（政务云预置互联网区/政务外网区等，公有云预置 region 列表），不开放自由文本
- [ ] {P0} {v0.2} 网域定义为全平台唯一入口：M07 资源导入/录入、M09 纳管、CMDB 同步均只能引用已登记网域，不产生第二事实来源
- [ ] {P0} {v0.2} `multi_site_enabled=false` 时，平台侧仅授权该租户单个网域（通常为 `default`），租户仍可查看 `default` 网域及其纳管状态；`true` 时开放多网域授权
- [ ] {P1} {v1.0+ / 外部 IAM} 支持租户内用户角色分配
- [ ] {P1} 关键操作记录审计日志（操作记录 / 变更追踪 / 登录日志）
- [ ] {P1} 可查看 TSDB 状态与 Retention 配置
- [ ] {P1} 可配置平台级 Remote Write 转发目标
- [ ] {P1} 可维护平台全局 scrape 默认值
- [ ] {P2} {v0.4+} 租户可查看其资源的业务分组与 BlueKing CMDB 业务映射（业务字典条目由 [Module_07](Module_07_Monitoring_Object_Management.md) 维护，`cmdb_business_id` / `cmdb_business_path` 落在业务字典条目上，由 M04 同步填充）

### 9.2 技术验收（后端机制 / 协议 / 数据契约可验证）

- [ ] {P0} `GET /api/v2/platform/zone-types` 返回启用中的字典项 `[{code, display_name, description}]`，数据源为部署配置文件预置字典，响应走统一 `{status, data, ...}` 格式（MVP）
- [ ] {P0} 网域 `id` 按 `<deploy_code>-<domain_code>` 生成，`deploy_code` 来自部署配置（配置文件或环境变量 `METRIC_CENTER_DEPLOY_CODE`，默认 `mc`）；`default` 管理域为历史预置例外、无前缀（MVP）
- [ ] {P0} 网域禁用为**冻结语义**：禁用后 M07 导入/录入校验拒绝新资源登记到该网域、M09 拒绝新纳管；存量资源与采集配置不受影响、继续采集；禁用接口返回影响范围（M07 资源数 / 已纳管 EdgeAgent 数）；`management`（`default`）域禁止禁用（MVP）
- [ ] {P0} 网域禁用**跨模块联动用例**（决策 30-3）：禁用后 M01 新建 Job 无法选择该域实例（选不到该网域 / 冻结域禁止新建 Job、存量 Job 禁止新增该域实例）、M09 不生成新变更单（存量下发与回滚不受影响）；恢复启用后重新可选、恢复生成变更单（MVP）
- [ ] {P0} 网域删除前置校验：无 M07 资源引用 且 无已纳管 EdgeAgent 才允许删除，否则返回拒绝并引导走「禁用」；采用软删（与 `BaseModel` 软删除体系一致）；`management`（`default`）域禁止删除（MVP）
- [ ] {P0} 登记归属 `tenant_id` 创建后不可变更，编辑接口（PUT）不含该字段（MVP）
- [ ] {P0} `platform_admin` 租户与 `default` 管理域由后端启动时 migration upsert 保证存在，幂等可重复执行（MVP）
- [ ] {P0} {v0.2} `network_domain_id` 必须全局唯一，创建时支持部署级前缀校验
- [ ] {P0} {v0.2} 1 个网域可授权多个租户共享（1 网域 : N 租户授权关系，跨租户共享），创建/编辑时不校验网域只能归属一个租户；网域登记所有权归 `platform_admin`（部署级）
- [ ] {P0} {v0.2} `Tenant.network_domain_ids` 表示「被授权可使用的网域列表」，授权 ≠ 拥有，不等于已纳管；已纳管状态由 Module_09 的 `EdgeAgent` 实例与监控参数存在性决定
- [ ] {P1} 单实例 + tenant label 方案下，查询同时注入 `tenant` 与 `network_domain` 两个维度，确保租户只能看到其被授权使用网域的数据；任何用户（含 `platform_admin` 租户用户）不具备 bypass 租户/网域隔离的能力
- [ ] {P1} {v0.2} `multi_site_enabled` 为租户级行政能力开关：`false` 时平台侧仅授权该租户单个网域（通常为 `default`），但不影响 M09 对 `default` 网域的查看与纳管状态展示；该开关不控制 M09 页面入口显示/隐藏
- [ ] {P1} {v0.4+} **租户不与 BlueKing Business 强制映射**；BlueKing Business 映射为 [Module_07](Module_07_Monitoring_Object_Management.md) 业务分组字典条目（`biz_code` / `biz_name`），资源通过 `biz_code` 字段归属业务；`platform_admin` 租户不因此获得跨租户访问权限
- [ ] {P2} 关键管理操作可落审计日志，支持操作人 / 变更 Diff / 登录行为检索

---

## 10. 术语映射（用户词汇表）

> 后端术语 ↔ 用户语言的唯一权威对照（与 5.x 数据模型「UI 展示名」列一致）。用户可见文案、前端页面、接口文档均以本表对齐；「仅技术信息」术语只出现在技术层（折叠区 / 代码注释 / 接口契约），不作为用户界面文案。

| 后端术语 | 用户语言 | 说明 |
|---------|---------|------|
| `Tenant` | 租户 | 数据隔离与权限的作用域单位；MVP 单租户为 `platform_admin`，不直接对应 CMDB Business |
| `platform_admin` | 平台管理租户 / 默认租户 | 系统预置默认租户，承载 `default` 网域与平台级默认配置；不表示跨租户超级管理员 |
| `biz_code` / `biz_name` / `biz` | 业务 / 业务类型 | 监控对象的分组维度，对应 BlueKing CMDB Business；`biz_code` 为不可变编码（进 `biz` 标签）、`biz_name` 为展示名（可改、不进标签）；由 [Module_07](Module_07_Monitoring_Object_Management.md) 维护 |
| `NetworkDomain` | 网域 | 逻辑操作上下文与采集边界；M06 维护行政定义，M09 负责监控纳管 |
| `network_domain_ids` | 被授权网域 | 该租户被授权可使用的网域列表（授权 ≠ 拥有；不等于已纳管） |
| `authorized_tenant_ids` | 授权租户 | 被授权可使用该网域的租户列表（1 网域 : N 租户，可跨租户共享；授权 ≠ 拥有） |
| `multi_site_enabled` | 多网域能力 | 是否允许该租户被授权使用多个网域的行政开关 |
| `zone_type` | 网络区域类型 | 网络隔离/位置分类（互联网区 / 政务外网区 / region 等），部署级字典 |
| `domain_type` | 域类型 | 管理域（`default`）/ 边缘域（行政分类，M06 维护） |
| `is_platform_admin` | 平台默认租户 | 标记系统预置租户；不隐含超级管理权限 |
| `status`（租户/网域） | 状态 | 租户：启用/暂停/禁用；网域：启用/禁用 |
| `cmdb_business_id` / `cmdb_business_path` | 仅技术信息 | [Module_07](Module_07_Monitoring_Object_Management.md) 业务字典条目的 BlueKing CMDB 业务 ID / 业务路径（v0.4+ 由 M04 同步填充，用于手工登记条目与 CMDB 业务匹配合并） |
| 资源配额 | 配额 | 限制租户的采集目标数 / 查询 QPS / 存储时长（v0.4+） |
| 数据隔离 | 数据隔离 | 租户只能查看本租户数据；查询注入 `tenant` + `network_domain` |
| 审计日志 | 审计日志 | 关键操作 / 变更追踪 / 登录日志；请求级审计由 Module_03 收集 |

---

## 11. 前端交互契约

### 11.1 页面状态矩阵

| 页面 | 状态 | 表现与文案 |
|------|------|-----------|
| 租户管理 | 加载中 | 表格骨架屏 |
| 租户管理 | 空态 | 「暂无租户」，提供「新建租户」引导 |
| 租户管理 | 接口错误 | Alert 提示「租户列表加载失败，请稍后重试」，提供「重新加载」按钮 |
| 租户管理 | 权限不足 | 页面级空态提示「当前账号无此页面查看权限」 |
| 租户管理 | 数据超量 | 表格分页（默认 20 条/页），支持名称/状态筛选 |
| 网域管理 | 加载中 | 表格骨架屏 |
| 网域管理 | 空态 | 「暂无网域」，提供「登记网域」引导 |
| 网域管理 | 接口错误 | Alert 提示「网域列表加载失败，请稍后重试」，提供「重新加载」按钮 |
| 网域管理 | 权限不足 | 页面级空态提示「当前账号无此页面查看权限」 |
| 网域管理 | 数据超量 | 表格分页，支持按登记归属/zone_type/状态/授权租户筛选；新增网域为部署级登记能力，常驻可用 |
| 平台配置 | 加载中 | 区块骨架屏 |
| 平台配置 | 接口错误 | Alert 提示「配置加载失败，请稍后重试」 |
| 用户与权限 | 空态 | 「暂无用户 / 外部 IAM 未接入」引导 |
| 审计日志 | 数据超量 | 表格分页，支持按操作人/时间筛选 |

### 11.2 全局行为规则

- **破坏性操作二次确认**：禁用租户、禁用网域等操作前弹出 Modal 要求二次确认，并明确提示影响范围（管理域不可禁用；禁用网域时展示后端返回的该网域下资源数 / 已纳管 EdgeAgent 数）。
- **删除网域限制**：删除操作仅空网域可用（无 M07 资源引用、无已纳管 EdgeAgent）；非空网域删除按钮置灰并提示「存在资源引用 / 已纳管，请改用禁用」；管理域（`default`）不提供删除入口。
- **表单校验提示位置**：字段校验失败时错误提示置于字段下方；全局错误使用 Alert 置顶展示。
- **提交中防重复**：创建 / 编辑 / 禁用按钮在提交期间置为 loading 并禁用，等待接口返回后再恢复。
- **`zone_type` 选择**：下拉从部署级字典加载，不开放自由文本；无可用字典项时置灰并提示平台预置。
- **跨模块跳转**：网域列表可跳转 Module_09 网域纳管（预选该网域）；不重复提供网域纳管的监控参数维护入口。

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v2.2 | 2026-08-19 | 修改 | MVP 缺憾补漏落版（决策 23）：①§1 补「MVP 无鉴权声明（决策 8）」与「种子数据初始化（platform_admin + default 由后端启动 migration upsert）」；②§4 新增「4.0 MVP 网域登记流程」闭环小节（登记→引用→纠错→纳管）；③§5.1 `suspended` 标注为预留值；§5.2 网域 `id` 补 `deploy_code` 前缀来源定义（默认 `mc`）、`tenant_id` 登记归属标注「创建后不可变更」、`authorized_tenant_ids` 标注「可选，缺省 = 登记归属租户」；④§6.2 新增 `GET /api/v2/platform/zone-types` 只读字典接口、`PUT` 移除登记归属字段（不可变更）、`PATCH` 禁用改「冻结语义」（返回影响范围 / 拒绝新登记与新纳管 / 存量不受影响）、新增 `DELETE` 空网域删除（软删 + 前置校验，管理域禁删）；⑤§9 补 6 条 MVP 技术验收 + 3 条 MVP 用户验收；⑥§11.2 补「删除网域限制」规则与禁用影响范围展示 | 1 模块目标、4 核心流程、5 数据模型、6 接口设计、9 验收标准、11 前端交互契约 | MVP / v0.2 / v0.4 | 设计中 |
| v2.0 | 2026-08-19 | 修改 | 决策 18~20 落版（网域可跨租户共享、租户-网域-业务正交）：①§3.2 清除「1 网域 : 1 租户」「禁止跨租户共享网域」残留，改为网域为部署级资源、可跨租户共享，租户通过授权 scope 使用（授权 ≠ 拥有）；②§3.3/§3.4/§4 联动清理租户-网域归属与业务映射残留；③§5.1 `network_domain_ids` 语义改为「被授权可使用」（授权 ≠ 拥有）、`multi_site_enabled` 改为「被授权使用多个网域」+§5.2 新增 `authorized_tenant_ids`、`tenant_id` 语义改为登记归属；④§6.2 网域创建不再校验唯一租户归属；⑤§9/§10/§11 验收、术语、前端契约联动 | 3.2 租户与网域关系、3.3 CMDB 映射、4 核心流程、5 数据模型、6 接口设计、9 验收标准、10 术语映射、11 前端交互契约 | MVP / v0.2 / v0.4 | 设计中 |
| v1.9 | 2026-08-19 | 修改 | 决策 12~17 落版收尾：①§3.2 补充「租户、网域、业务三者正交」说明（业务为 M07 资源分组维度，多业务共用网域/业务跨网域为正常态）；②§4.3 CMDB 同步流程改为 Business → M07 业务字典（清除 Tenant 1:1 残留）；③§9.1 业务映射验收改指 M07 业务字典条目；④§10 术语表 `cmdb_business_id`/`cmdb_business_path` 语义改指 M07 业务字典条目 | 3.2 租户与网域关系、4.3 CMDB 同步流程、9.1 用户验收、10 术语映射 | MVP / v0.2 / v0.4 | 设计中 |

> 完整 Change Log 历史（v1.0 ~ v1.5）见 `docs/05-execution-records/module-06/design-decisions.md`「Change Log（完整历史）」。