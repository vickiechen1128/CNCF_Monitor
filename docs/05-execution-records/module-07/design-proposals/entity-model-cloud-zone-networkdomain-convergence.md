# 实体模型收敛：云标识 / 网络分区 / 网域 的关系重定（2026-09-26）

> 来源：2026-09-26 产品负责人（chenrt）与设计的多轮对齐讨论；吸收 design-proposal `host-cloud-identity-and-zone-convergence`（2026-09-25，触发本轮）。
> 落版：Module_07 PRD v2.43→v2.44；Module_06 PRD v2.16→v2.17；新决策 **M07 决策 103** + **M06 决策 78**（互标，遵循决策 68 §5 治理纪律）。
> 原型：本轮为契约级实体模型修订，**原型无需同步**（位置三标签统一走 system 层，无新增用户可见字段）。

---

## 1. 背景与讨论链（一日收敛）

`host-cloud-identity-and-zone-convergence`（v2.43 配套）提出把 `cloud` 上提到五类资源共享字段（决策 102），引发了后续一连串追问，逐层收敛出今日结论：

1. `cloud` 标签是否与 `network_domain` 概念重复？→ 否。`network_domain` 是采集边界，`cloud` 是云归属，**N:1**（1 朵云内可有多网域、1 网域只属 1 朵云，受物理隔离约束），`cloud` 是合法的上卷（roll-up）维度，不是冗余。
2. 中心直连域（`default`）能否也带 `network_domain` 值？→ 能，但须用 **target 级注入**而非 `external_labels`（决策 68-§2.5 已验证 `external_labels` 不进本地 TSDB）。
3. 平台真实用户动线：先登记网域（网络类型分区、网段可选项）→ 再做资源管理时**只填云相关信息**（如「腾讯云·上海一区 / 政务云·政务外网区」），未先填网域也允许。
4. 腾讯云真实隔离边界是 **Region（地域）**：同地域内网互通、跨地域默认不通；同一 VPC 的资源可在同城不同 AZ；AZ 不参与划域。
5. 同一「云 + 隔离范围」内能否多网域？→ 能（VPC 强隔离常见场景）。
6. `internet` code（决策 83）进 label 有语义歧义？→ 保留 code（决策 83 命名不变），**展示层字典解析**消除歧义。
7. `zone_type` 是否转网域必填？→ **是**。
8. 资源导入时到底必填什么？→ 资源侧只必填 `network_domain`（+ 类型字段）；`cloud` / `zone` 全部由所属网域派生，用户不重复填。

---

## 2. 最终结论：四层实体模型 + 方案 B

### 2.1 四层实体模型

| 层 | 字段 | 承载主体 | 说明 |
|---|---|---|---|
| ① 云归属 | `cloud_code` | **NetworkDomain**（M06 行政字段，必填） | 部署云（如 `PUB-TX` 腾讯云 / `GM-CU` 政务云）；取值权威 = 云字典（M07 §5.20，部署级只读） |
| ② 网络分区 | `zone_type` | **NetworkDomain**（M06 行政字段，**必填**） | 网络隔离/位置语义分类标签；公有云 = Region（上海/北京…），政务云 = 安全分区（互联网区/政务外网区/专线区/DMZ）；AZ 不进 `zone_type` |
| ③ 网域 | `network_domain_id` | **Resource** 唯一归属字段（必填） | 采集边界；M06 维护行政定义、M09 负责纳管 |
| ④ 可用区 | `az` | 暂不入模型（{v0.4+} 评估） | 地域内部维度，非监控隔离边界，本期不建模 |

**NetworkDomain 是三者（云 / 分区 / 网域）的唯一枢纽**：资源只存 `network_domain_id`，`cloud` / `zone` 在配置生成时经网域**派生**，绝不冗余到资源表。

### 2.2 方案 B（推翻决策 102 的「云归属由资源自身承载」口径）

- 决策 102 把 `cloud_code` 上提为 `Resource` 五类共享字段、资源侧必填 → **撤销**。原因：①资源间上下游关系未建模，从主机派生云不可行（决策 102 自身承认）；②用户动线证明云是网域属性（先登记网域时即确定云与分区）；③N:1 上卷维度物化到资源会重复填写、且新实例无法自动枚举。
- `cloud_code` **上提为 NetworkDomain 行政字段（M06 §5.2，必填）**；资源侧 `cloud_code` 删除，改为**经网域派生**（join）。

### 2.3 Region ≡ zone_type（隔离边界对齐）

- 划域依据（M06 §3.2）= **可达性同质性 + 故障自治单元**；腾讯云语境下「真正隔离的是地域」→ **Region 即 zone_type 的取值之一**，与政务云安全分区同列于 `zone_type` 字典。
- AZ（可用区）**不参与划域**，不进 `zone_type`。
- 同 `{cloud, zone_type}` 内可有多网域（VPC 强隔离）。

### 2.4 位置三标签统一 system 层（推翻「zone 不进 label」「云走 LabelTemplate 默认映射」）

- `network_domain` / `cloud` / `zone` 三个位置标签**统一由配置生成器在 target 级注入（system 层）**，不依赖 LabelTemplate 默认映射 + 门禁，也不走 `external_labels`（不进本地 TSDB）。
- 注入点：`platform/configcenter/generator/targets.go` 的 `mergeIntoLabels`（system 层在生成配置时计算，不落库——沿用决策 3.29 的 system 标签实时计算口径）。
- 推论：**M07 主机默认模板删除 `cloud_code → cloud` 映射行**（决策 98 的「模板映射机制」被取代，cloud label 的用途不变）；`zone` 由「不进 label」改为「进 label（target 级）」。

### 2.5 `zone_type` 转网域必填

- `zone_type` 由「可选、可留空」（决策 76）改为 **网域登记必填**（决策 78）——位置身份不完整则规则/看板/告警不生效，用户须补录。
- `ip_cidrs`（M07 §5.16.4，{v0.3}）**不重复**：它是第一跳（属性→网域，IP 推导归属），方案 B 是第二跳（网域→云/分区），两者层级不同、互补。

---

## 3. 用户动线：谁填什么（结论）

| 动作 | 必填项 | 派生项 | 说明 |
|---|---|---|---|
| **网域登记（M06）** | 名称 + `cloud_code` + `zone_type`（+可选 `ip_cidrs`） | — | 网域的位置身份在此一次性确定 |
| **资源导入 / 录入（M07）** | `network_domain`（+ 类型字段如 `instance_ip` / `os_type` / `biz_code` 等） | `cloud` / `zone`（经网域派生，只读展示） | 用户**不再填 `cloud_code` 列**；原 Excel `cloud_code` 列回退（见 §5） |
| **查询 / 看板 / 告警** | — | `cloud` / `zone` / `network_domain` 三标签齐备 | 上卷与下钻均可用 |

---

## 4. 被取代 / 修订的决策（supersede map，遵循决策 68 §5 互标）

| 既有决策 | 状态 | 新口径 |
|---|---|---|
| **M07 决策 102**（云归属由资源自身承载、五类共享字段、资源侧必填） | **部分推翻** | 云归属改由网域承载（方案 B），资源侧删除 `cloud_code`；仅保留「云字典随部署预置、无任何管理页」与「必填分化思路」的治理精神 |
| **M07 决策 98**（主机 `cloud_code → cloud` 走 LabelTemplate 默认映射） | **机制取代** | cloud label 用途不变，但注入点从模板默认映射改为 system 层 target 级注入；主机模板删除该映射行 |
| **M06 决策 76**（zone_type 可选可留空、不下发、进 external_labels 供筛选） | **部分修订** | zone_type 改为网域必填；zone 改为 target 级注入（非 external_labels）；纯分类标签 / 两种部署形态 / AZ 不进 zone_type 仍成立 |
| **M06 决策 83**（zone_type 命名 `internet`/`extranet`） | **保留 + 补注** | 命名口径不变；新增「展示层字典解析消除 `internet` 公网歧义」+ region 取值（上海/北京…）纳入字典 |
| **M07 决策 101**（网络分区经网域只读派生） | **保留并扩展** | 派生口径不变；现 cloud 与 zone 同为网域派生，派生说明合并 |

---

## 5. 落版清单（PRD 改动点）

### Module_07（v2.43→v2.44）
- **§5.4** 区域属性单一事实来源：重写——三类位置属性（云/分区/网域）唯一事实来源均为 NetworkDomain，资源侧不冗余。
- **§5.6** Host 字段表：删除 `cloud_code` 行；物理列备注 `Host.cloud_code` 重述为「云由所属网域派生，物理列降级为兼容只读」；网络分区派生说明扩展为「云 + 分区」派生。
- **§5.13** 主机默认模板：删除 `cloud_code → cloud` 映射行；决策 98 注脚改为 system 层注入说明。
- **§5.16.1** 五类导入模板列：删除 `cloud_code` 列；删除「`cloud_code` 列（决策 102）」说明（回退 Excel B5）。
- **§5.20** 云字典承载位置：由「Resource 共享字段」改为「NetworkDomain 行政字段（M06 §5.2）」，资源经网域派生。
- **§6.1** 资源列表返回 `cloud_code` → 改为「返回派生 `cloud_code`（来自所属网域）」。
- **§9.1** 云必填验收项 → 改为「网域登记 `cloud_code` 必填；资源导入不再要求填云」。
- **Change Log** 新增 v2.44（v2.41 轮转至 design-decisions 完整历史）。

### Module_06（v2.16→v2.17）
- **§5.2** NetworkDomain 行政字段表：新增 `cloud_code`（必填）行；`zone_type` 改必填 + 说明改为「target 级注入 `zone` label（决策 78）」+ region 取值补充。
- **§3.2** zone_type 说明：由「可选、不下发」改为「必填、target 级注入」；划域原则补 Region≡隔离边界。
- **§10** 术语映射 `zone_type` 条目：必填 + zone 进 label + region 取值。
- **Change Log** 新增 v2.17（v2.14 轮转至 design-decisions 完整历史）。

---

## 6. 待办 / 回退项（代码侧，不在本文档范围）

- **Excel B5 回退**：`T07-102-B5` 给五类 Excel 模板加了 `cloud_code` 列 + `TX→PUB-TX`/`CU→GM-CU` 归一 → 须回退（资源 Excel 不再含 `cloud_code` 列；归一逻辑移至 NetworkDomain 登记时的云字典取值校验，由开发侧实施任务执行）。
- `platform/db/seed/label_template.go` 的 `ensureCloudMapping`（仅 host 加 `cloud_code→cloud`）→ 删除该默认映射（改 system 层注入）。
- `platform/models/resource_cloud_code_test.go:36` `TestDefaultMappingBuildersAddsCloudOnlyForHost` → 重写为「默认映射不含 cloud（cloud 由 system 层注入）」。
- `platform/models/resource_base.go` 若含 `CloudCode` 列 → 评估移除或标记派生（落库侧需与 M06 网域 `cloud_code` 对齐）。
- `platform/configcenter/generator/targets.go:167` 注入点：在 system 层追加 `cloud` / `zone`（与既有 `network_domain` 同路径）。

> 代码侧改动走 `feat/module-07` 开发轮次，本文档仅定契约；实施前须先按决策 68-§2.5 实测 `external_labels` 与 target 级同键碰撞（边缘回传 + 中心直连同 `network_domain`/`cloud`/`zone`）。
