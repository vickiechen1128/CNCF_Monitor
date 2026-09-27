# 五类资源归属关系分型与 host 归属键澄清（2026-09-27）

> 来源：承接 design-proposal `service-biz-app-four-layer-hierarchy`（四层骨架，已吸收进 Module_07 PRD v2.45）落地后的复核——产品负责人（chenrt）指出「新增 platform / service 后，资源管理（五类）与其的管理关系需重新审视」。
> 状态：`merged`（2026-09-27 吸收落 Module_07 PRD v2.46 / Module_05 PRD v1.10）
> 影响范围：Module_07（资源归属关系口径）、Module_05（首页按云主机数聚合）、跨模块契约（M06 云权威、M02 覆盖率聚合）。
> 关联文档：`service-biz-app-four-layer-hierarchy.md`、`host-cloud-identity-and-zone-convergence.md`、`docs/05-execution-records/module-07/design-decisions.md`（决策 93 / 94 / 95 / 96 / 103 / 104~107）、`Module_05_Custom_UI.md` §5.1、`Module_06` §5.2、`Module_07_Monitoring_Object_Management.md` §5.2 / §5.6 / §5.8。
> 评审批注（2026-09-27，prototype-designer，per §8.1.1）：两段式评审**有条件通过**——2 处内部错误已当场修正（§1 #6 / §3.1 / §3.4 的 `platform` 缺位口径按 `app_code` 必填口径分化；§1 #3 / §3.2 的决策 94 归位修正，见 §3.4 修正说明）；遗留项（T-A2 / T-A5 / T-A6 / 跨模块契约）已在吸收阶段落地。详见 `design-decisions.md`「评审记录：2026-09-27（design-proposal `resource-ownership-relation-typing` 两段式评审）」。**状态已转 `merged`**（2026-09-27，吸收落 M07 v2.46 / M05 v1.10）。

---

## 1. 需求背景

上轮四层骨架（`platform → app → service → instance`）落地后，暴露一个此前被掩盖的问题：**五类资源被同一套 `app_code` / `biz_code` 字段一刀切地表达归属，但它们在四层骨架里的身位根本不同。**

同时本轮澄清两件事：

1. **修正一处此前的错误分析（必须纠正）**：上一轮讨论中曾提出「把 `database` / `middleware` 的 `app_code` 由必填改为可空、归属主键换成 `biz_code`」——**该建议方向错误，本提案正式撤回**。理由见 §3.1 / §3.2：资源立项归属是 **N:1**（多个资源挂在同一个子应用下），`app_code` 单值必填恰好表达它；`biz_code` 是「后发生、随业务演进多变」的弱属性，不能当资源归属主键。
2. **客户诉求**：M05 首页需要**按云展示各云名下的主机数量**。

### 结论摘要

| # | 议题 | 结论 | 状态 |
|---|------|------|------|
| 1 | `database` / `middleware` 归属主键 | **保持 `app_code` 必填，不改** —— 立项归属 N:1、申请时定死；撤回上轮「改可空 / 换 biz」建议 | ✅ 已澄清 |
| 2 | `biz_code` 的角色 | **辅助弱归属**（回答「服务谁」，可后补、随业务演进），**不作资源归属主键** | ✅ 已澄清 |
| 3 | 决策 94「多应用归属 1:N 装不下」的处置 | 那是**「多库 / 多 schema 分属不同应用」的资源粒度问题**（非纯运行期依赖边），已挂 **{v0.2+}** 并登记跨 M01 / M09 契约；**MVP 维持 1 实例 = 1 主 `app_code`、归属字段不改** | ✅ 已澄清（评审修正，见 §3.2） |
| 4 | 五类资源的归属关系分型 | 分三类：**组成**（application / generic_target）、**依赖**（database / middleware）、**部署**（host） | ✅ 待评审 |
| 5 | `host` 的归属键 | 身份键 = `instance_ip + network_domain_id`；归属主键 = **部署维度**（网域派生 `cloud` / `cluster`）；业务归属 `app_code` / `biz_code` 可空 | ✅ 待评审 |
| 6 | `platform` label 缺位口径 | **按资源类型分化**（见 §3.4）：`host` 因 `app_code` 可空、可缺位（属预期）；`database` / `middleware` 因 `app_code` **必填**、**通常正常派生** `platform`（仅所挂应用未登记父级平台时缺位）；`generic_target` 视 `app_code` / `biz_code` 二选一情形 | ✅ 待评审（评审已修正，原「三类一律缺位」表述作废） |
| 7 | M05 按云主机数 | 新增按云聚合字段 `by_cloud`；`cloud` 经网域 `cloud_code` 派生（**必填、零空洞**） | ✅ 待评审 |

---

## 2. 设计范围

- **在**：M07 五类资源与四层骨架的**关系分型口径**（组成 / 依赖 / 部署），及各自**归属键**的定档与澄清。
- **在**：`host` 归属键（身份键 / 归属主键 / 辅助键）的明确，以及 `platform` 派生降级口径的用户化表述。
- **在**：M05 首页**按云统计主机数量**的落点方案（新增 `by_cloud` 聚合）。
- **不在**：`service_dependency` 依赖边的实现（{v0.3+}，归 M07 对象层）；CMDB 同步实现（M04）；M05 具体页面视觉稿（由 prototype-designer 另行产出）。
- **不改**：五类资源的判重键、`app_code` / `biz_code` 必填口径（决策 93 / 95 保持）、资源表结构（**本提案零新增字段**）。

---

## 3. 详细设计

### 3.1 五类资源归属关系分型（核心）

四层骨架 `platform(1) → app(N) → service(M) → instance(K)` 是**业务系统的纵向组成链**。把五类资源放进这条链，只有 `application` 站在链上——其余四类是链**之外**的支撑层，与业务系统的关系性质各不相同：

| 资源类型 | 在骨架中的身位 | 归属关系类型 | 归属主键 | 辅助键 | 说明 |
|---|---|---|---|---|---|
| `application` | **service 的实例**（链末端） | **组成**（我是某服务 / 子系统的组成部分） | `app_code`（必填） | `biz_code` / `service_code`（可选） | 与四层骨架完全自洽，现状不动 |
| `generic_target` | 兜底，业务型同 application | **组成**（业务型）/ 无（自定义端点） | `app_code` / `biz_code` **二选一**（决策 95） | — | 保持二选一 |
| `database` | **被应用依赖的支撑基设** | **依赖**（谁在用它） | `app_code`（**必填，不改**） | `biz_code`（可后补弱属性） | 立项归属 N:1；共享消费归依赖边 |
| `middleware` | 被应用依赖的支撑基设 | **依赖** | `app_code`（**必填，不改**） | `biz_code`（可后补弱属性） | 同上 |
| `host` | **运行载体**（托管上面所有东西） | **部署**（跑在哪台机器） | 部署维度：`network_domain_id` → `cloud` / `cluster` | `app_code` / `biz_code`（均可空） | 多应用共用宿主机时无单一 app 归属 |

**关键判断**：`platform → app → service → instance` 这条链**只对 `application`（及业务型 generic_target）承诺完整**，它不是五类资源的统一归属模型。`database` / `middleware` / `host` 是骨架之外的支撑 / 运行层——它们与平台的关联是**间接**的（经被支撑的应用，或经 {v0.3+} 依赖边），**均不参与该组成链**。

> **但「不参与组成链」≠「`platform` 标签必缺位」（评审修正）**：`platform` 是经 `app_code` → 应用条目父级平台**派生**的标签（M07 §5.12.1，适用范围=**通用**），其有无**只取决于资源是否具备 `app_code`**，与「是否站在组成链上」无关。故：`host` 因 `app_code` 可空、可缺位；**`database` / `middleware` 因 `app_code` 必填、通常正常派生 `platform`**。详见 §3.4。

### 3.2 资源归属键定档（澄清，不改字段）

| 键类别 | 作用 | 字段 / 来源 | 是否必填 |
|---|---|---|---|
| **身份键** | 唯一识别一条资源（判重用） | `(network_domain_id, instance_ip, port)`（application 为 `(domain, service_name, endpoint)`） | 必填 |
| **归属主键** | 该资源「挂在谁账下」（立项 / 申请时定死，稳定） | `app_code`（子应用，N:1） | application / database / middleware **必填**；host / generic_target 按既有口径 |
| **辅助归属键** | 「服务谁」的语义归属（可后补、随业务演进） | `biz_code`（业务域弱属性） | 按类型分化（决策 93） |
| **部署键** | 该资源「跑在哪」（host 的归属主键） | `network_domain_id` → 派生 `cloud` / `cluster` | host：网域必填、`cluster` 必填 |

**为什么 `biz_code` 不能升格为 database / middleware 主键**：业务域是「应用上线稳定运行后才可能出现」的概念（决策 93 已确立其生命周期），且随业务形态演进会持续变化。用一个「后发生、会多变」的属性作资源立项主键，会造成台账随业务调整而漂移。**`biz_code` 恒为辅助弱归属，不升格。**

**决策 94「多应用归属 1:N 装不下」的归位（评审修正）**：决策 94 原文（`design-decisions.md` L2043-2047）描述的是**「多库 / 多 schema 分属不同应用」**——即**资源粒度是否按 schema 下沉**，这是**资源 / 归属建模问题，不是纯粹的「运行期依赖边」**；该问题已挂 **{v0.2+}**、登记**跨 M01 / M09 契约待确认**（「共享实例按 schema 下沉资源粒度」vs「exporter 采集层按库打 `app` 标签」需 M01 / M09 一起定）。**故不能把决策 94 整体归入 {v0.3+} `service_dependency`**。**MVP 处置**：维持「1 实例 = 1 行资源 = 1 个主 `app_code`」（决策 94 既定），**归属字段不改**；schema 级 1:N 待与 M01 / M09 对齐后再定。（初稿曾把 94 简化为「运行期共享消费边」，与原文不符，此处修正。）

### 3.3 `host` 归属键详解（CMDB + 运维视角）

| 键 | 字段 | 说明 |
|---|---|---|
| 身份键 | `instance_ip` + `network_domain_id` | 采集端点 IP + 从哪条网域可达，唯一识别一台主机（decision：资源身份 = 采集端点 × 采集路径） |
| **归属主键（部署维度）** | `network_domain_id` → 派生 `cloud_code` / `zone_type`；`cluster` | **host 是运行载体，其归属主键是「部署在哪」**（哪个网域 / 哪个云 / 哪个集群） |
| 业务归属（辅助） | `app_code`（可空）、`biz_code`（可空可后补） | 多应用共用宿主机时不存在单一 app 归属，故可空；空值不注入标签 |
| 运行属性 | `os_type`（必填）、`env`（必填）、`owner` | 操作系统 / 环境 / 负责人 |

> 一句话：**host 不属于任何应用，它承载应用**——归属看「部署在哪」（云 / 网域 / 集群），不看「属于哪个 app / service」。

### 3.4 `platform` 派生降级口径（用户化表述）

**机制（大白话）**：资源行上**没有「平台」这一列**（刻意不存，避免同一事实存两处）。要得到某资源属于哪个平台，系统「看它挂了哪个 `app_code` → 去应用字典查这个应用挂在哪平台下 → 得出 `platform`」。这种「绕一道查出来」即**派生**。

**降级规则（按 `app_code` 必填口径分化）**：`platform` 派生**只依赖资源自身是否有 `app_code`**（M07 §5.12.1：「资源无 `app_code` 或应用无父级平台时不注入」），与「是否参与组成链」无关。派生不出仅两种情形：① 资源未填 `app_code`（`host` 可空；`generic_target` 仅填 `biz_code` 时）；② 所挂应用未登记父级平台。**据此分型**：

- `host`：`app_code` 可空 → **未填时 `platform` 缺位，属预期正常态**；
- `database` / `middleware`：`app_code` **必填**（见 §3.2）→ **通常正常派生 `platform`**；仅当所挂应用未登记父级平台时缺位（该缺位与「应用未挂父级」的通用情形同源，**不是这两类资源特有的缺位**）；
- `generic_target`：`app_code` / `biz_code` 二选一 → 填 `app_code` 则派生、仅填 `biz_code` 则缺位。

**结论（评审修正）**：**原「`host` / `database` / `middleware` 三类 `platform` 缺位一律属预期」的表述作废**——「缺位属预期」**只对 `host`（及仅挂 `biz_code` 的 `generic_target`）成立**；`database` / `middleware` 因 `app_code` 必填，**正常参与 `platform` 派生、其 `platform` 标签应有值**，不得因其「不参与组成链」就推断其缺位。`host` 缺位**不是数据缺陷、不需硬凑回填**；平台视角看纯基设资产（如未挂应用的 host），仍可走**网域 / 云 / 未归类（orphan）视图**兜底。

> **修正说明（2026-09-27 评审，prototype-designer）**：本提案初稿存在**内部矛盾**——§1 结论 #6 与本节原文称「`host` / `database` / `middleware` 的 `platform` 缺位属预期」，但 §1 #1 / §3.1 / §3.2 同提案又写明 `database` / `middleware` 的 `app_code` **必填**；而 M07 §5.12.1 的 `platform` 派生映射行**适用范围为「通用」（全部资源类型）**，有必填 `app_code` 即能派生 `platform`。二者不能并存，故按上述分型修正 §1 #6、§3.1、§3.4。同时修正 §1 #3 / §3.2 对决策 94 的简化归位（决策 94 实为资源粒度问题，非纯运行期依赖边）。

### 3.5 M05 首页按云统计主机数量（客户诉求）

**客户诉求确认**：客户要看的是「**各云名下有多少台主机**」——即按主机的**云归属**分组计数，**不要求**区分「云主机 vs 物理机」（M07 `host` 类当前无「主机形态」字段，如需区分是另一需求）。

**可行性**：`cloud_code` 已是**网域必填行政字段**（决策 103 / M06 决策 78），主机经 `network_domain_id → cloud_code` 派生出的云归属**必填、零空洞**——比 `platform` 维度干净，聚合结果完整。

**落点方案**：M05 `dashboard/summary` 接口**新增按云聚合字段** `by_cloud`，与现有 `by_category` / `by_app` 并列：

| 字段 | 说明 |
|---|---|
| `by_cloud` | 按云归属分组的资源分布；每项含 `cloud_code` / `cloud_name`（取云字典，缺条目回退 `cloud_code`）/ `resource_count` / `monitored_count` / `coverage_rate`；本期**仅覆盖 host 类型**（chenrt 定档：本期不做五类，后续如需扩展另评） |

**展示位置（已定档）**：**M05 新增独立「按云分布」区块**（chenrt 定档，非 L1 主机卡内子类维度）——不占用既有「操作系统类型」子类语义（M05 §5.1 `by_subtype` 主机取 `os_type`），且云维度天然可复用。

**聚合实现归属**：`by_cloud` 由 `dashboard/summary`（metric-center 后端）经资源 → 网域关联聚合；`cloud` 的取值权威仍是云字典（M07 §5.20）与网域字段（M06 §5.2）。

---

## 4. 与现有 PRD 差异点

| 现有口径 | 变更 | 说明 |
|---|---|---|
| M07 §5.2 `app_code` 必填分化（决策 93） | **保持不变** | `database` / `middleware` 必填不动；撤回「改可空」建议 |
| M07 §5.2 `biz_code` 必填分化（决策 93） | **保持不变** | 恒为辅助弱归属，不升格为主键 |
| 决策 94「多应用归属 1:N 装不下」 | **归位澄清（评审修正）** | 属「多库 / 多 schema 分属不同应用」的**资源粒度**问题，已挂 {v0.2+} + 跨 M01 / M09 契约；MVP 维持 1 实例 = 1 主 `app_code`，不改归属字段 |
| M07 §5.2 / §5.6 归属说明 | **新增口径** | 补「五类资源归属关系分型（组成 / 依赖 / 部署）」说明；**零新增字段** |
| M07 §5.12.1 / §5.21 `platform` 派生说明 | **补降级口径（评审修正）** | 明确按 `app_code` 必填口径分化：`host` 可缺位（属预期）；**`database` / `middleware` 因 `app_code` 必填、正常派生**；`generic_target` 视二选一 |
| M05 §5.1 dashboard summary 字段 | **新增** | 新增 `by_cloud` 聚合字段（按云主机数，**本期仅 host**） |
| M05 §11.3 首页版式 | **新增** | 新增**独立「按云分布」区块**（chenrt 定档） |
| M07 §5.6 host 归属键说明 | **新增口径** | 明确 host 归属主键 = 部署维度（云 / 网域 / 集群），业务归属可空 |

---

## 5. 验收标准

- [ ] M07 §5.2（或 §5.4）新增「五类资源归属关系分型」说明：组成（application / generic_target）/ 依赖（database / middleware）/ 部署（host），且明确四层骨架只对 `application` 承诺完整。
- [ ] M07 明确 `database` / `middleware` 的 `app_code` **保持必填**，`biz_code` **恒为辅助弱归属**，并写明撤回依据（立项归属 N:1 vs 运行期共享 1:N）。
- [ ] M07 §5.6 明确 host 归属键：身份键 `(instance_ip, network_domain_id)`、归属主键 = 部署维度（`cloud` / `cluster`）、业务归属可空。
- [ ] M07 §5.12.1 / §5.21 补 `platform` 派生降级口径（**按 `app_code` 必填口径分化**）：`host` 缺位属预期、`database` / `middleware` 因 `app_code` 必填而正常派生、`generic_target` 视二选一；未挂应用的 `host` 走网域 / 云 / orphan 视图兜底。
- [ ] M05 §5.1 新增 `by_cloud` 字段（含 `cloud_code` / `cloud_name` / `resource_count` / `monitored_count` / `coverage_rate`），**本期仅覆盖 host**。
- [ ] M05 首页新增**独立「按云分布」区块**（chenrt 定档），驱动数据来自 `by_cloud`；本期仅覆盖 host。
- [ ] 跨模块契约登记：M06（`cloud_code` 为网域必填权威）、M02（`by_cloud` 覆盖率聚合是否复用现有聚合链路）在 `design-decisions.md` 顶层跨模块契约区挂账。

---

## 6. 合并计划

- **MVP（本轮）**：
  1. M07 补「五类资源归属关系分型」口径说明 + host 归属键说明 + `platform` 派生降级口径（**均为说明性增量，零新增字段、零改必填**）。
  2. M05 §5.1 新增 `by_cloud` 聚合字段；首页「按云分布」区块由 prototype-designer 产出视觉稿后落原型。
- **{v0.2}**：**不登记**「云主机 vs 物理机」需求（chenrt 定档：当前不需要区分，故 M07 `host` 不补「主机形态」字段）。**决策 94 的「多库 / 多 schema 分属不同应用」1:N 归 {v0.2+}**，届时与 M01 / M09 对齐（资源粒度是否按 schema 下沉）。
- **{v0.3+}**：`service_dependency` 依赖边落地后，database / middleware 的「**运行期**共享消费」由依赖边表达（**与决策 94 的 schema 级资源粒度问题分开**）。
- **合并动作**：评审通过后，由 prototype-designer 或原作者在 `design/module-mvp-demo` 分支吸收进 Module_07 PRD（版本 +1，Change Log 记录「吸收 design-proposal `resource-ownership-relation-typing`」）与 Module_05 PRD（`by_cloud`）；本文件状态改为 `merged` 归档。

---

> 待评审确认项（**2026-09-27 已由 chenrt 全部定档**）：
> 1. 「按云分布」展示位置 → **定档：独立区块**（非 L1 主机卡内子类维度）。
> 2. `by_cloud` 覆盖范围 → **定档：本期仅 host**（五类扩展后续另评）。
> 3. 「云主机 vs 物理机」是否登记为 {v0.2} 待评估需求 → **定档：不需登记**（M07 `host` 不补「主机形态」字段）。

---

> **合并记录**：2026-09-27 吸收完成——Module_07 PRD **v2.45 → v2.46**（§5.2 五类资源归属关系分型 + 资源归属键口径、§5.6 主机归属键、§5.12.1 `platform` 派生降级口径、§10 三分型术语行；决策 108）；Module_05 PRD **v1.9 → v1.10**（§5.1 `by_cloud[]` 字段 + §6 接口表 + §9 验收 + §10 术语 + §11.3 新增「按云分布」独立区块；M05 决策 100）；跨模块契约 **T5** 已挂账（M07 design-decisions 顶层契约区）。本文件状态转为 `merged` 归档。