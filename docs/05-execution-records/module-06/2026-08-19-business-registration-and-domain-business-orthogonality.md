# 设计对齐记录：M06/M07 业务登记入口与网域-业务正交性（2026-08-19）

## 对齐信息

- **日期**：2026-08-19
- **参与**：chenrt（产品/业务方）、AI 助手（后端/架构分析）
- **触发原因**：
  1. 用户明确 MVP 场景：项目交付、单一运维团队、网域固定、业务多样；
  2. 追问业务登记入口在 MVP 中放在哪里，以及后续蓝鲸 CMDB 对接时的映射方式；
  3. 明确"多业务共用 1 个网域"的处理方式。

## 已达成结论

### 结论 1：MVP 单租户 = 单一项目空间，租户不是业务

- MVP 单租户 `platform_admin` 的实际含义就是：**一套部署 = 一个项目空间**。
- 所有资源、网域、Job、指标在同一空间内可见；界面上无租户切换，查询不做租户隔离注入（数据隔离是 P2、MVP 不启用）。
- **租户 ≠ 业务**：租户是权限/管理边界（对应单一运维团队/组织），业务是监控对象的分组维度（对应 CMDB Business、项目条线）。MVP 租户固定为 `platform_admin`，业务可多个。

### 结论 2：业务登记入口归 M07，业务字段 MVP 必填

- 业务是**资源的分组维度**，资源的 Owner 是 M07，因此业务登记入口放在 M07，而不是 M06。
- MVP 形态：
  - MVP **不提供**业务分组维护页面；业务字典（业务编码 `business_domain` + 展示名 + 状态）由配置文件在交付时预置，新增业务走配置变更（2026-08-19 二轮确认：避免用户频繁改名引发配置下发，详见结论 6）；维护入口推迟到 v0.2+ 再评估；
  - 所有资源类型的 Excel 导入模板和手工录入表单中，`business_domain` 字段**必填**；
  - 导入校验发现未登记的 `business_domain` 时，报错并引导：「业务 xxx 未登记，请先到『资源管理 → 业务分组』登记后重新导入」——与 M07 5.16.1 网域报错引导完全对称。

### 结论 3：`business_domain` / `biz` 是受控字典，治理规则与 `zone_type` 同构

- `biz` 会通过 LabelTemplate 注入指标标签（M07 5.12 / 5.15、M09 3.3.1），因此必须受控，不能自由文本。
- 业务字典治理规则：
  1. 条目 = `business_domain`（进标签，创建后不可变）+ `display_name`（展示用，可改）+ `description`；
  2. 被资源引用的业务条目只能 `disabled`（停用），不能删除；
  3. 后端校验资源上的 `business_domain ∈ 启用字典项`。
- MVP 采用配置文件或初始化 SQL 预置字典 + 只读接口，v0.4+ 由 M04 同步蓝鲸业务后自动维护。

### 结论 4：网域与业务是两个正交维度，资源持有双归属

- **网域由网络环境决定**（登记制，不是创建制），固定、低频变更；**业务由组织管理需求决定**，持续演进、高频新增。
- 每个资源有且仅有：1 个网域归属（`network_domain_id`）+ 1 个业务归属（`business_domain`）。
- **多业务共用 1 个网域**：无需特殊处理，是正常状态。网域下会自然承载多个业务的资源；查询用 `biz` + `network_domain` 组合过滤。
- 业务跨多个网域：也是正常状态，业务指标通过 `biz` 标签跨网域聚合。

### 结论 5：对接蓝鲸 CMDB 时"比较简单"的真正含义

- 蓝鲸的 `bk_biz_id` / `bk_biz_name` 正好对应业务字典的 `business_domain` / `display_name`，结构天然对齐。
- v0.4+ M04 同步时：
  - CMDB Business → M07 业务分组字典条目；
  - 资源的 CMDB 业务路径 → 资源的 `business_domain` 字段；
  - LabelTemplate 自动把 `business_domain` 映射为 `biz` 标签（MVP 已有的 5.15 主路径）。
- MVP 手工登记的业务，建议在字典条目上**预留 `cmdb_business_id` 可空字段**，用于后续 CMDB 同步时做匹配合并，避免手工编码与 CMDB ID 撞车。

### 结论 6：`biz` 标签只承载不可变 code，业务名变更零配置影响（2026-08-19 二轮）

- **问题**：用户担心将来维护业务分组时，业务名频繁变化会通过 LabelTemplate 映射传导到 `static_configs[].labels`，引发监控配置重新生成与下发。
- **分析结论**：
  1. "业务归属作为 target label"符合 Prometheus 最佳实践（target labels 本就承载稳定、低基数的归属元数据）；风险只在于注入可变值；
  2. **红线：标签只注入不可变 `business_domain`（code），永不注入 `display_name`**——业务改名只改字典展示名，不进标签、不进配置，UI 展示时 join 字典；
  3. 唯一会动配置的业务操作是**资源换业务归属**（真实拓扑变化，本来就该变）；且按 M09 §3.5.1，targets 变化只原子重写 `targets/*.json`，file_sd 自动感知，**不触发采集器 reload**，`agent_pull` 通道下次心跳拉包即可，代价极低；
  4. MVP 不提供业务维护页面（字典配置文件预置），界面上不存在改名入口，该担忧在 MVP 物理上不会发生；
  5. v0.2+ 若开放维护页面，红线：只允许编辑 `display_name` / `description` / 状态，code 永不可改，停用不删除，查询/聚合一律用 code。

## 仍待明确的问题（需评审拍板）

1. ~~`business_domain` MVP 是否对所有五类资源必填？~~ → **已确认（2026-08-19 二轮）：五类资源全部必填**。
2. ~~M07 「业务分组」维护入口是否 MVP 必须提供页面？~~ → **已确认（2026-08-19 二轮）：MVP 不提供页面，字典由配置文件交付时预置**，避免用户频繁改名引发配置下发（见结论 6）。
3. ~~业务字典是否 MVP 就在数据库中建表？~~ → **已确认（2026-08-19 二轮）：MVP 配置文件承载、不建表**；v0.4+ 随 M04 CMDB 同步再评估建表。
4. M04 v0.4+ 同步时，若 CMDB 业务删除，本地业务字典条目是停用还是标记孤儿？资源上的 `business_domain` 是否保留历史值？
5. `business_domain` 当前命名是否保留，还是统一改为 `biz_code` + `biz_name` 以匹配 zone_type 字典风格？

## 对 PRD 的修改建议（按模块）

### M06：租户语义修正

- **§3.3「租户与 BlueKing CMDB 映射」**：把 Tenant ↔ Business 1:1 映射改为「Tenant 1:N Business；Business 作为资源业务维度，由 M07 维护」。
- **§10 术语映射**：补充「业务 / business_domain」词条，明确与「租户」的边界。
- **§3.2**：补充「租户、网域、业务三者正交」的说明。

### M07：业务分组与必填改造

- **§3.1 核心功能总表**：新增「业务分组字典」说明（MVP 配置文件预置、**不提供维护页面**；维护入口 v0.2+ 评估，开放时须遵守决策 17 红线：只改展示名、code 不可变、停用不删除）。
- **§3.3 资源标签管理 / 5.3 标签生成时机**：把 `business_domain` 明确纳入 `system` 标签来源，与 `app_name` 同层级。
- **§5.1 / 5.2 / 5.8 数据模型**：把所有资源类型的 `business_domain` 字段从「可选」改为「必填」（**五类资源全部必填**，2026-08-19 二轮确认）；增加说明：导入时填写为业务编码，展示时取字典 `display_name`。
- **§5.12 标签模板字段来源**：明确所有资源类型默认模板包含 `business_domain → biz` 映射（当前只有 application 表列了，主机/数据库/中间件模板需要补齐）。
- **§5.15 业务指标标签规范**：把 `biz` 从 application 专属扩展为全资源类型的通用业务标签；补充「`biz` 值为不可变编码，业务名变更不影响监控配置」（结论 6）。
- **§5.16.1 Excel 模板规则**：主机、数据库、中间件、通用指标目标模板增加 `business_domain` 列；应用服务模板中 `business_domain` 从「可选项」改为「必填项」。
- **§5.16.2 数据校验**：增加「业务存在性校验」行，规则为「必须已在 M07 业务分组字典中登记」；业务类型命名规范沿用当前小写/数字/连字符规则。
- **§6 接口设计**：新增业务分组字典**只读**接口（供录入/导入下拉与校验；MVP 无写接口）。
- **§11 前端交互契约**：资源列表/详情增加「业务」列/字段（MVP 无业务分组管理页）。

### M09：标签注入链路确认

- **§3.3.1 `external_labels` 注入说明**：保持不变（`network_domain`、`tenant_id`）。
- **§3.3 标签注入 / §5 配置生成**：确认 `biz` 标签通过 M07 LabelTemplate 的 `business_domain → biz` 映射进入 `static_configs[].labels`，不需要 M09 单独注入。在 3.3 中增加一句引用说明。
- **§5.1 NetworkDomain 数据模型**：无需新增字段，但可在注释中注明「网域与业务正交，配置生成时不把业务作为网域属性」。

### M04：CMDB 业务同步映射调整

- **§3 核心功能**：把「Tenant → BlueKing Business」映射从 Tenant 级别改为业务字典级别：BlueKing Business → M07 业务分组字典。
- **§4.1 Provider 同步规范 / §5 同步策略**：明确外部 Provider 必须把 CMDB 的 `bk_biz_id` / `bk_biz_name` 同步为 M07 业务分组字典条目，并把资源所属业务写入 `Resource.business_domain`。
- **§4.1 字段映射**：补充「业务路径同时映射为 `business_domain`」时，编码规则优先取 `bk_biz_id`，展示名取 `bk_biz_name`；如无法获取 `bk_biz_id` 则按业务路径生成稳定编码。
- **§5 同步失败容错**：增加业务字典同步失败的兜底规则（沿用旧业务字典，不影响配置生成）。

---

## 补充对齐：租户-网域-业务架构原则与多团队共享网域配置治理（2026-08-19 三轮）

### 背景

在前两轮对齐"业务登记入口"与"网域-业务正交"后，用户进一步追问：

1. MVP 单租户是否等价于单一项目空间？
2. 部门 1/部门 2 各有一个运维团队，物理上共用 1 个网域，团队 2 改配置会不会影响团队 1？
3. 加上租户体系后，网域概念是否让系统变复杂？租户和网域是否冲突？

本轮对齐把上述问题收敛为三条**架构原则级决策**，并已同步写入全局架构文档 `00_Global_Architecture.md §1.1` 与 `03_Functional_Architecture.md §1.6`。

### 结论 7：租户-网域-业务三维正交（决策 18）

| 维度 | 回答的问题 | 存在形态 | 是否进入采集拓扑 |
|------|-----------|----------|------------------|
| **租户 Tenant** | "谁能看/改？" | 治理/权限作用域；MVP 对应单一运维团队/组织/部门 | **否**：通过 target 级 `tenant` 标签 + 查询网关注入隔离 |
| **网域 NetworkDomain** | "采得到吗？" | 物理采集拓扑；配置生成与下发的唯一结构化单位 | **是**：采集器、配置包、`external_labels.network_domain` 都按网域组织 |
| **业务 `business_domain` / `biz`** | "归哪条业务线？" | 监控对象分组维度；对应 CMDB Business | **否**：作为 target 级 `biz` 标签注入 |

核心约束：

1. **网域是唯一的结构化采集维度**，不因租户数量而复制采集基础设施。
2. **租户不拥有网域**。网域是部署级资源，由 `platform_admin` 统一登记；租户通过授权 scope 使用网域，网域可跨租户共享。
3. **业务标签与租户、网域互不隶属**。查询时可按 `tenant`、`network_domain`、`biz` 任意组合切片。
4. **租户或业务的新增、改名、删除不触发配置重发**。配置只随物理网域/采集目标变化而重新生成/下发。

### 结论 8：租户不进入采集拓扑，`tenant` 标签走 target 级（决策 19）

- M09 `external_labels` 中**移除 `tenant_id`**；`external_labels` 只保留部署级、物理维度的不可变元数据（`network_domain_id`、`zone_type`、`replica` 等）。
- 未来多租户若需在指标上体现租户归属，由 M07 LabelTemplate 把资源字段 `tenant_id` 映射为 target 级 `tenant` 标签。
- MVP 单租户下此映射可选、不强制注入；租户隔离优先在 API Gateway / 查询代理层通过 PromQL 注入实现。
- 目的：确保组织/租户调整不会触发采集配置重新生成与下发。

### 结论 9：多运维团队共享网域的三层隔离模型（决策 20）

网域是物理边界，不是团队边界。多个运维团队（租户）可以共享同一个网域，配置影响按以下三层隔离：

| 隔离层 | 控制对象 | 团队 1 操作影响 | 团队 2 操作影响 | 实现归属 |
|--------|----------|-----------------|-----------------|----------|
| 写权限 | NetworkDomain 行政记录 | 仅 domain owner / platform_admin 可改 | 仅 domain owner / platform_admin 可改 | M06 |
| 配置内容 | 各租户在该网域下的 targets/relabel/rules | 只生成本租户命名空间配置 | 只生成本租户命名空间配置 | M09（按 tenant+network_domain 分目录） |
| 下发动作 | Edge Agent 配置包、Prometheus reload | 只下发本租户包 | 只下发本租户包 | M09 配置包通道 |

MVP 单团队场景退化为：只有 `platform_admin` 一个租户，所有配置都在该命名空间下，不存在跨团队覆盖问题。

### 仍待明确的问题（2026-08-19 三轮已全部收敛）

1. ~~`business_domain` 命名是否保留，还是统一为 `biz_code` + `biz_name` 以匹配 `zone_type` 字典风格？~~ → **已确认（决策 21）：改为 `biz_code` + `biz_name`，指标标签保持 `biz`**。
2. ~~M04 v0.4+ 同步时，若 CMDB 业务被删除，本地业务字典条目是停用还是标记孤儿？资源上的 `business_domain` 是否保留历史值？~~ → **已确认（决策 22，用户拍板）：字典停用不删除、资源保留历史 `biz_code`；停用条目不可新选；同 `bk_biz_id` 重建时复用原条目并重新启用**。
3. ~~决策 19 落地后，M09 `external_labels` 的最终字段清单需确认~~ → **已确认：移除 `tenant_id`，保留 `network_domain_id`、`zone_type`、`replica`**。
4. ~~决策 20 多团队场景下，配置命名空间的具体规则是否需要在 M09 中单独成章？~~ → **已确认：推迟到 v0.2+ 详细讨论，M09 PRD 仅留 {v0.2+} 占位说明，MVP 不实现**。

## 关联文档

- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md`
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/02-product-requirements/Modules/Module_04_Custom_Discovery.md`
- `docs/02-product-requirements/00_Global_Architecture.md`
- `docs/02-product-requirements/03_Functional_Architecture.md`
