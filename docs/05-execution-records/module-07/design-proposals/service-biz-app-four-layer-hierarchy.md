# 服务层升格与「业务 / 应用 / 服务 / 实例」四层实体层级收敛（2026-09-27）

> 来源：2026-09-27 产品负责人（chenrt）与 AI 助手的多轮讨论，针对 M07「业务管理 / 应用管理 / 资源管理」三者关系模糊的真实客户场景展开。
> 状态：`approved`（已吸收进 Module_07 PRD v2.45 / 2026-09-27）
> 影响范围：Module_07（实体模型 / 术语映射）、Module_01（业务域语义）、跨模块契约（M01 / M09 / M05 / M02）。
> 合并目标：**已执行**——吸收进 Module_07 PRD v2.45（Change Log 记录「吸收 design-proposal `service-biz-app-four-layer-hierarchy`」），并同步修订 Module_01 相关小节（业务域语义）。
> 开放项定档（2026-09-27，chenrt 拍定 + 消解阻塞项后的最终处置）：
> 1. **T1 顶层命名 = `platform`（平台）**——字典 `PlatformDict`、编码 `platform_code`、label `platform`；**放弃 `system`**（撞名 `ResourceLabel.source=system` / 「system 层」/ `os_dict`）。
> 2. **T2 服务标签 = `svc`**——字典 `ServiceDict`（复用 `ApplicationDict` 同构）、label `svc`（值 = `service_code`）；**放弃 `service`**（撞名 §5.15 机制 B 归一规则与既有 `service_name`）；§5.15 机制 B 修订为「`service` 标签归一目标改 `svc`，`biz→app` 不变」。
> 3. **T3 决策 96 正名**：决策 96 裁定的是 biz↔app **横向正交**（「应用挂业务、业务挂应用」两向都不引入）；本提案新增的 `platform(1) → app(N)` 是**纵向组成分解**，属另一维度、不冲突。
> 4. **T4 1:N 边界契约登记**（不改模型）：service 跨 app / app 跨 platform 装不下、主归属唯一下非主归属表达——登记到 `design-decisions.md` 顶层跨模块契约区。
> 5. **T5 影响面逐项落**（已吸收进 PRD v2.45）：`service_code` 可选、缺省即自由文本；资源行 `service_name` 不动、仍参与判重键 `(domain, service_name, endpoint)`；适用范围仅 application / generic\_target；决策 97 Excel 声明 sheet 由两扩为四。
> 6. **`service_dependency`** 归 **M07 对象层关系**，**MVP 明确不实现**（仅登记模型 + 归属口径）。
> 评审批注（2026-09-27，prototype-designer，per §8.1.1）：两段式评审**通过**（阻塞项 T1 / T2 已由 chenrt 定名 `platform` / `svc` 消解，T3 / T5 已吸收进 PRD v2.45，T4 已登记跨模块契约），详见 `docs/05-execution-records/module-07/design-decisions.md` 的「评审记录：2026-09-27（design-proposal `service-biz-app-four-layer-hierarchy` 两段式评审）」。

---

## 1. 需求背景

客户侧的真实诉求暴露出 M07 现有「业务 / 应用 / 资源」三层概念的语义错位：

1. **「应用」= 平台级系统集成**：客户口中的「应用」是「公共数据授权运营平台」，而技术侧理解它由「数据开发利用系统、接口包装系统、门户系统」等组成——是一个**系统集成**概念，天然带**子应用 / 子系统分解**。
2. **「业务」= 平台承载的单个服务**：客户理解的「业务」是「教师身份核验接口 API」，它由「公共数据授权运营平台」里的「接口包装系统」包装而成——是**比平台低一个层级**的单个服务。
3. **资源与应用 N:1**：从资源管理角度，资源（实例）与应用是 **N 对 1** 关系。

这三条诉求，与现有模型的落差在于：**客户的术语和平台的词典发生了系统性错位**——客户说「应用」指的是平台（顶层），说「业务」指的是单个服务（底层），而 M07 现有的 `app`（应用字典）被钉死为「应用实例级聚合键」、`biz`（业务分组字典）被钉死为「业务域聚合（服务谁）」，两者都接不住客户原话里的那个粒度。

---

## 2. 设计范围

- **在**：M07 的监控对象层（实体模型与术语映射），明确「平台 → 子系统 → 服务 → 实例」的纵向层级骨架。
- **在**：把目前飘在 `Application.service_name` 上的「服务」升格为一等公民（稳定字典 + 独立 label）。
- **在**：把「业务域（biz）」从模糊的聚合，明确为「由上下游关联服务构成的服务子图」的语义归属维度，并预留「服务依赖边」建模。
- **不在**：采集配置生成、配置下发、ScrapeJob、告警规则等（仍归 M01 / M09）；外部 CMDB 同步实现（仍归 M04）；服务依赖的自动拓扑发现（{v0.3+} 另议）。
- **不推翻**：决策 92 / 93 / 94 / 95 / 96 / 97 的既有结论（详见 §6）。

---

## 3. 详细设计

### 3.1 四层实体层级模型（纵向「组成」维度）

| 层 | 概念 | 承载 | 客户语言锚点 | 交付版本 |
|---|---|---|---|---|
| ① 平台 | `platform`（平台） | 新增父层字典 `PlatformDict`（可选父级） | 「应用」= 公共数据授权运营平台 | MVP（字典本体；分层可视化界面 {v0.2}） |
| ② 子系统 / 应用 | `app` | 现有 `ApplicationDict`（升格为可挂父 `platform`） | 数据开发利用系统 / 接口包装系统 / 门户系统 | MVP（现有） |
| ③ 服务 | `svc`（服务） | **新增服务字典 `ServiceDict`**（复用 `ApplicationDict` 同构） | 「业务」= 教师身份核验接口 API | MVP |
| ④ 实例 | `instance` | 现有 `Resource`（一行一实例） | 资源 | MVP（现有） |

- `platform(1) → app(N) → service(M) → instance(K)`，三者都是 1:N 的纵向分解。
- **注意**：这是「应用自身的纵向分解」，与「业务挂在应用下」是**两个不同维度**——决策 96 砍掉的是后者（业务与应用横向正交），**并不妨碍**前者（应用/平台的子系统分解）。

### 3.2 业务域（biz）保留为正交维度（横向「归属」维度）

- `biz`（业务域）**不改名、不降级**，M07 的 `biz_code` / `BusinessDomain` 与 M01 的 `business_domain` 是**同一份字典、同一个 `biz` label**，本就是同源引用，不存在「一边保留另一边改名」。
- `biz` 回答「为谁服务 / 属于哪个业务场景」，是横切维度，与纵向的 `service` 正交：`service : biz = N:1`（主归属唯一，可被跨业务共享，沿用 M01「微服务可被多业务共享但主归属一个」）。
- 语义升级（写进 M01 §5.9 / M07 §5.18 说明，不改字段结构）：`business_domain` = 「一条业务服务链路」——由**一组上下游关联的 `service` 构成的服务子图**。

### 3.3 服务依赖边（`service_dependency`，新增 / MVP 不实现）

- **归属定档**：作为**监控对象层的关系模型，归 M07**（与 `service` 实体同址，内聚性优先）。
- **交付版本定档**：**MVP 明确不实现**——本轮仅在 PRD 登记模型形态与归属口径（P2 预留），不落表、不做界面、不做自动推导。
- 模型形态（{v0.3+} 实现）：关系表 `{ from_service, to_service, type(调用/数据/事件), weight }`，表达服务间上下游依赖。
- 「业务域 = 服务子图」因此成立：业务域 = `service` 节点 + `service_dependency` 边的连通子段。
- 价值：影响面分析、根因定位、告警降噪（上游故障 → 下游受影响/泡沫告警压平）的基础。
- **原则**：依赖关系**不靠静态 label 硬标**（必脏）；{v0.3+} 由调用链 / 服务拓扑（trace / 服务发现）自动推导，对齐 Prometheus 生态 SkyWalking 等服务拓扑的成熟做法。

### 3.4 术语四列对照（客户语言 ↔ 平台 / CMDB / 标签）

| 客户语言 | 平台概念（建议） | CMDB 对应（蓝鲸） | Prometheus 标签 |
|---|---|---|---|
| 「业务」（API，如教师身份核验） | 服务 `service` | 进程 / 服务实例 | `svc` label |
| 「应用」系统（接口包装系统等） | 应用 `app`（子系统） | 模块 Module | `app` label |
| 「应用」平台（公共数据授权运营平台） | 平台 `platform` | 业务 bk_biz（顶层系统） | `platform` label（派生） |
| 资源（隐） | 资源 `instance` | 主机 / 实例 | `instance` label |

> 关键结论：**蓝鲸的「业务」≈ 客户的「应用（平台）」，客户的「业务（API）」≈ 蓝鲸的「服务实例」**。命名不可生搬蓝鲸，层级骨架可对照参考。`platform` / `svc` / `service_dependency` 为**技术术语**（label 名 / 字段名），只出现在折叠区 / 代码注释 / §10「仅技术信息」列，不作 UI 文案（评审 U1）。

### 3.5 标签黄金分层（Prometheus 最佳实践）

- 纵向：`instance ⊂ service ⊂ app ⊂ platform`，保证四层都能 `sum by (...)` 无歧义聚合。
- 横向/正交：`env`（环境）、`cluster`（部署形态）、`biz`（业务归属，可后补，不注入假业务）。
- `cluster` 红线保持不动（只表达集群，禁止复用承载子应用/服务维度）。

---

## 4. 与现有 PRD 差异点

| 现有口径 | 变更 | 说明 |
|---|---|---|
| 决策 96：应用字典不加父子、业务应用正交 M:N | **保留不变（正名，T3）** | 决策 96 裁定的是 biz↔app **横向正交**（「应用挂业务、业务挂应用」两向都不引入）；本文的 `platform(1) → app(N)` 是**纵向组成分解**，属另一维度、不冲突 |
| 决策 92：`app_code` 双层编码 + 应用字典 | **保留 + 微调** | `app` 升格为「可挂父 `platform` 的子系统」（新增可选 `platform_code`）；编码不可变 / 停用不删除 / 展示名不参与 label 等红线不变 |
| 决策 93 / 95：`biz_code` 必填按类型分化、app/biz 二选一 | **保留不变** | 「业务在应用上线后才出现」的生命周期口径继续成立 |
| PRD 5.8：「服务是逻辑概念，不落资源表，由 app/biz 标签聚合表达」 | **演进** | 「服务」升格为一等公民：新增 `service_code`（**可选**）/ `svc` label，application / generic_target 资源行可挂 `service_code`（留空即纯自由文本） |
| M07 5.18 / M01 5.9：`biz` 语义 =「业务域聚合（服务谁）」 | **语义升级（结构不变，决策 106）** | 补一句「业务域 = 一组上下游关联的服务构成的服务子图」；字段名、`biz` label 映射均不变 |
| 术语映射 §10：`business_domain` 无独立服务行 | **新增** | 补 `service_code` / `svc` / `platform_code` / `platform` / `service_dependency` 等术语行 + 四列对照 |

---

## 5. 验收标准

> 以下验收项均已由 Module_07 PRD v2.45 落位（本节保留为吸收核对清单）。

- [x] 术语映射表新增服务 / 平台 / 服务依赖术语行，且含「客户语言 ↔ 平台 / CMDB / 标签」四列对照。
- [x] `service` 升格：新增 `ServiceDict`（**复用 `ApplicationDict` 同构**：编码不可变 + 展示名必填 + 停用不删除 + `source` 来源审计）；application / generic_target 资源行可挂**可选** `service_code`，`svc` label 经标签模板映射注入（与 `app` / `biz` 同规约：编码不可变、展示名不参与 label）。
- [x] `app` 升格：应用字典支持可选父级 `platform_code`，`platform(1) → app(N)` 可表达，且不引入「业务挂应用下的父子」。
- [x] `platform` 定档：父层实体命名 = `platform`（平台，**放弃 `system`**），字典 `PlatformDict` 结构与 `biz` / `app` / `cloud` 同规约。
- [x] `svc` 定档：服务 label = `svc`（**放弃 `service`**，消解与 §5.15 机制 B 归一规则 / 既有 `service_name` 的撞名）；§5.15 机制 B 修订为「`service` 标签归一目标改 `svc`，`biz→app` 不变」。
- [x] `biz` 语义升级落位：M07 5.18 与 M01 5.9 的 `business_domain` 说明补「业务域 = 服务子图」，字段结构、`biz` label、必填口径零改动。
- [x] `service_dependency` 关系模型：**归属 M07 对象层关系**已定档、**MVP 明确不实现**，仅作为 {v0.3+} 的 P2 预留条目登记模型形态（PRD §5.23）。
- [x] 跨模块契约登记：M01（标签注入 / `svc` + `platform` 标签）、M09（target 生成对新增 label 的透传）、M05（应用明细表是否回显服务 / 平台维度）、M02（覆盖率聚合是否感知 `svc` / `platform`），以及 **T4 1:N 边界契约**（service 跨 app / app 跨 platform），在 `design-decisions.md` 顶层跨模块契约区挂账。

---

## 6. 合并计划

- **MVP（本轮，契约 + 最小结构）**：**已执行**
  1. PRD 术语映射表落四层对照（§10）。
  2. 应用字典加 `platform_code` 可选父级（决策 96 不冲突）。
  3. `service` 升格：新增 `ServiceDict`（复用 `ApplicationDict` 同构）+ application/generic_target 行加 `service_code`（可选）；`svc` label 进默认标签模板（`platform` 为派生标签，不入模板）。
  4. `biz` 语义说明升级（结构零改动）。
- **{v0.2}**：平台字典「平台 → 子系统」分层可视化界面与生命周期状态机（`未出现 / 出现中 / 稳定`，业务后补演进）——字典本体（登记 / 受限编辑 / 停用）已随 MVP 交付。
- **{v0.3+}**：`service_dependency` 边（**归 M07 对象层关系**）+ 服务拓扑自动发现（依赖调用链 / 服务发现推导），落地影响面分析 / 根因定位 / 告警降噪。
- **合并动作**：**已执行**——本提案已吸收进 Module_07 PRD v2.45（Change Log 记录），Module_01 相关小节同步修订；本文件状态 = `approved`，归档保留。

---

> 开放项定档结论（2026-09-27，chenrt 拍定 + 消解阻塞项，已回写 §3 / §5 / §6）：
> 1. 顶层命名 = **`platform`（平台）**，放弃 `system`（撞名既有语义，评审 T1）。
> 2. 服务标签 = **`svc`**，字典 = **`ServiceDict`（复用 `ApplicationDict` 同构）**，放弃 `service`（撞名 §5.15 机制 B / `service_name`，评审 T2）。
> 3. `service_dependency` = **归 M07 对象层关系**，认可其内聚性；**MVP 明确不实现**，仅登记模型 + 归属口径，{v0.3+} 再落地。
> 4. 决策 96 **正名**：裁定 biz↔app 横向正交，与本文 `platform → app` 纵向分解不冲突（评审 T3）。
> 5. T4 1:N 边界契约已登记 `design-decisions.md` 顶层跨模块契约区；T5 影响面已逐项吸收进 PRD v2.45。
> 合并结果：吸收进 **Module_07 PRD v2.45**，本文件状态 `approved`。