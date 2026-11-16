# 平台作为运维组织第一维度与应用必归属平台约束（2026-11-16）

> 状态：`draft`（待 owner 评审）
> 分支：`rewrite/v2.0`
> 来源：owner（chenrt）2026-11-16 会话——在 M07 功能设计复核中提出两点业务事实：①**运维组织架构是先有平台概念，再由应用运维团队组织保障，平台由「该有多少应用」聚合而成，应用不是孤立、人为随意定义的**；②将来告警面板除按静态资源对象类型（主机 / 数据库 / 中间件 / 应用 / 接口）聚合外，还需按**平台 / 应用 / 业务**三维聚合展示分析。
> 关联文档：`Module_07_Monitoring_Object_Management_Requirements.md`（SRS，本次回填至 v1.2）、`Module_07_Monitoring_Object_Management.md`（历史技术 PRD v2.55）、`docs/05-execution-records/rewrite/v2.0/decisions.md`（新增 D41 / D42 / D43）、`docs/05-execution-records/module-07/design-decisions.md`（决策 110 / 111 / 112，旧线）。
> 影响范围：Module_07（M07 SRS + `platform/modules/m07/` + `ui-custom/web/src/pages/resources/`）、Module_08（告警面板维度，契约级建议）、Module_05（看板维度建议）。

---

## 1. 需求背景

### 1.1 业务事实（owner 定档）

平台在 MetricCenter 中**不是「事后把应用归归类」的标签**，而是**运维组织的第一划分原则**：

```
平台（组织根节点：等保 / 安测 / 统一运维主体）
  └── 应用运维团队（组织保障单元，按平台划分职责）
        └── 应用（平台该有多少应用 → 由平台团队定义，应用是平台的组织单元）
              └── 接口服务（应用对外暴露的数据 API，blackbox 拨测载体）
```

由此推出两条硬性组织事实：

1. **应用不可能脱离平台存在**——「先有平台、再有应用」；把应用当孤立实体随意注册，组织上不成立。
2. **告警的组织归属第一问是「哪个平台」**——告警来了先回答归属哪个平台（派给哪个平台的运维团队），再下钻到应用 / 实例。

### 1.2 上一轮分析的误判与修正

2026-11-16 首轮复核时，曾基于**纯技术排障视角**（排障只需 `app` / `instance`，`platform` 是多余的一层）建议「砍掉平台维度、退回应用主平台派生」。该建议**作废**——它把「排障下钻顺序」误当成「数据聚合 / 组织归属的优先级」，未纳入运维组织视角。

修正后的定位对照：

| 视角 | `platform` 的角色 | 对告警面板的意义 |
|---|---|---|
| 纯技术排障（误判） | 粗粒度冗余维度 | 可选过滤器 |
| **运维组织（真实口径）** | **组织的根节点 / 第一归属** | **第一聚合与分发维度** |

### 1.3 现状缺口（代码实证）

| # | 缺口 | 证据 |
|---|---|---|
| G1 | **孤立应用合法存在**：应用可零平台关联，系统不拦截 | `dictionary/repository.go` `CreateAppPlatformRel`（L442）只校验「同 app 同 platform 不重复」与「主平台唯一」；`DeleteAppPlatformRel`（L515）允许删光关联；`PrimaryPlatformOfApp`（L173）无主平台返回 `("", false, nil)`；`service/resource_service.go` `resolvePlatform`（L132-143）把「应用无主平台 → platform 留空」当合法分支 |
| G2 | **`platform_code` 对组成型资源冗余**：`application` / `interface_service` 的 `app_code` 必填、app 主平台唯一 ⇒ 其 platform 恒可稳定派生，资源行再填一手工字段纯冗余且可能不一致 | `domain/resource.go` `validateOwnership`（L64-86）对 `platform_code` 零约束，全类型可空 + 统一兜底 |
| G3 | **前端允许清空全部平台**：应用表单「所属平台」可全取消 | `ui-custom/web/src/pages/resources/ApplicationDictPage.tsx` `syncAppPlatformRels`（L48-69）对空数组直接逐条解绑 |
| G4 | **平台页看不到「本平台有哪些应用」**：违背「平台 = 应用聚合」的查看诉求 | `PlatformManagementPage.tsx` 无关联应用入口（历史技术 PRD §5.21 曾承诺，未实现） |
| G5 | **UI 文案与组织原则冲突**：平台页写「应用通过『所属平台』挂靠（**可选**）」 | `PlatformManagementPage.tsx` L191 / L40 |

### 1.4 结论摘要

| # | 议题 | 结论 |
|---|---|---|
| 1 | `platform` 维度定位 | **保留并升格**：运维组织第一维度；告警面板第一聚合 / 分发维度（**修正**旧线决策 112「platform 非排障主维度」的片面结论） |
| 2 | 应用 ↔ 平台关系 | **应用必须归属平台、且恰有一个主平台**（数据层硬约束，堵 G1）；首个关联自动成为主平台 |
| 3 | `platform_code` 一等字段 | **收敛到静态资源**（host / database / middleware / generic_target）；组成型资源（application / interface_service）回归 app 主平台派生（消 G2） |
| 4 | 前端连带 | 应用表单平台必选 ≥1（G3）；平台页补「关联应用列表」（G4）；文案去「可选」（G5） |
| 5 | 告警面板三维聚合 | **应用 / 业务：直接做**；**平台：作为第一组织维度做**（不再降为「可选过滤器」）；资源类型维走 `resource_category` 回填字段，与标签治理解耦 |

---

## 2. 设计范围

**在**：

- `platform` 维度的**组织定位修正**（跨模块契约：M08 告警面板 / M05 看板维度）；
- `app_platform_rel` 的**组织归属硬约束**（应用必归属平台 + 主平台唯一必填）；
- `platform_code` 一等字段的**适用范围收窄**（组成型资源改为派生）；
- 前端三处连带（应用表单校验 / 平台页关联应用列表 / 文案口径）；
- M07 SRS 回填（5 处业务口径）。

**不在**：

- 不砍平台维度、不撤销 `app_platform_rel` M:N；
- 不改字典红线（编码不可变 / 展示名必填 / 停用不删除 / `source` 审计）；
- 不改资源判重键；不改 `platform` label 注入机制（仍走标签模板 `resource_field` 映射）；
- 不实现 {v0.2} 聚合拓扑视图、不实现 {v0.3+} 资源实例边；
- 不改 M08 / M05 PRD 正文（仅登记契约建议，由对应 owner 回填）。

---

## 3. 详细设计

### 3.1 D41：`platform` 定位修正——运维组织第一维度（契约级）

**修正对象**：旧线决策 112（`docs/05-execution-records/module-07/design-decisions.md`）「`platform` 是**高维 / 粗粒度**维度，**不应作为告警分析 / 看板的默认下钻入口**，退为**顶层可选过滤器**」，以及顶层契约 T7 的同款措辞。

**修正后口径**：

| 场景 | `platform` 的地位 |
|---|---|
| **组织归属 / 告警分发** | **第一维度**——告警先归平台、派给该平台的运维团队，再下钻应用 / 实例 |
| **告警面板聚合展示** | **一级聚合维度**（与应用 / 业务并列，不再是「可选过滤器」） |
| **故障排障下钻到实例** | 背景维度——下钻路径仍是 `app → resource_id`，此时 platform 不作为下钻键 |

**为什么原结论片面**：原结论只回答了「排障时从哪个维度下钻到实例」（答案确实是 `app` / `resource_id`），却把该答案外推成「告警分析 / 看板的默认维度都不能是 platform」。运维组织按平台划分后，**告警的组织归属与派单必须先按平台收敛**——这与「排障下钻顺序」是两个不同问题，不能互相推导。

**三层 label 维度分层修订**（原「高维 / 中维 / 低维」保留，读者与用途列修正）：

| 层级 | label | 读者 | 用途 |
|---|---|---|---|
| **组织维（第一）** | `platform` | 平台负责人 / 运维团队 | **组织归属、告警分发、平台整体健康** |
| **横切维** | `biz` | 业务负责人 / 管理层 | 业务域健康（为谁服务） |
| **应用维** | `app` / `env` / `cluster` / `network_domain` | 应用负责人 / 运维架构师 | 应用级 / 环境级 / 位置级聚合与过滤、排障下钻 |
| **实例维（细粒度）** | `resource_id` | 运维工程师 | 排障到实例 |

**跨模块建议（登记为契约）**：

- **M08 告警面板**：按 `platform` / `app` / `biz` 三维提供聚合展示分析；`platform` 为**一级聚合维度**，默认视图可含「按平台」；资源类型维（主机 / 数据库 / 中间件 / 应用 / 接口）走 `resource_category` 回填字段，不经 label 聚合。
- **M05 看板**：平台维作为一级汇总卡（管理层视角），不再标注为「可选顶层过滤器」。

> 契约级：M08 / M05 正文由各自 owner 回填，本提案只登记口径。

### 3.2 D42：应用必归属平台 + 主平台唯一（数据层硬约束）

**核心不变量（必须由服务端强制，不能只靠 UI）**：

| # | 不变量 | 违规处理 |
|---|---|---|
| I1 | **应用至少归属一个平台**（`app_platform_rel` 中每个 `app_code` 至少 1 行） | 删除最后一个关联 → 拒绝（`ErrAppRequiresPlatform`）；登记应用时未给平台 → 400 |
| I2 | **应用恰有一个主平台**（`is_primary=true` 恰好 1 行） | 首个关联由服务端**强制置为主平台**；`is_primary` 唯一性沿用 DB 部分唯一索引 + 服务端事务校验 |
| I3 | **主平台转移必须显式**（不允许删掉主平台后应用处于无主平台态） | 删除主平台且仍有其他关联 → 拒绝（`ErrPrimaryPlatformTransferRequired`），提示「请先将其他平台设为主平台，再解绑当前主平台」 |

**为什么选「显式拒绝」而不是「自动提升」**：组织治理场景下主平台决定告警派单归属，自动提升会让运维在不知情的情况下改变派单方向；显式拒绝 + 可执行提示更安全。

**落地**

| 层 | 改动 |
|---|---|
| DB | 无需新增迁移（`uq_app_platform_rel_primary` 已保证「至多一个主平台」；I1 / I3 为跨行约束，SQLite / PostgreSQL 均不便用 CHECK 表达，放服务层） |
| Repository | `CreateAppPlatformRel`：若该 app 无任何关联 → 强制 `is_primary=true`；`DeleteAppPlatformRel`：加载目标行，按 I1 / I3 校验后删除（事务内） |
| Service | `CreateApplication` 增加 `platformCodes []string`（≥1），事务内原子创建应用 + 关联（首个为主平台）；平台须存在且启用 |
| Handler / DTO | `POST /application-dict` 请求体新增 `platform_codes`（必填非空）；错误码：`bad_request`（缺平台 / 平台不存在或停用）、`conflict`（编码重复） |
| 前端 | 应用登记表单「所属平台」改为**新建时必填 ≥1**；`syncAppPlatformRels` 顺序改为「**①新增 → ②主平台切换 → ③解绑**」（原「解绑 → 新增」会在切换唯一平台时触发 I1 拒绝） |

### 3.3 D43：`platform_code` 一等字段收敛到静态资源

**论证**：组成型资源（`application` / `interface_service`）的 `app_code` **必填**（`domain/resource.go` `validateOwnership`），且每个 app 恰有一个主平台（D42 I2）⇒ 其 `platform` **恒等于「app 主平台」，唯一确定、零歧义**。因此：

- 对组成型资源，`platform_code` 一等字段**冗余**，且手填值可能与 app 主平台不一致，制造数据冲突；
- 决策 110 之所以把 `platform_code` 下沉为「全类型一等字段」，理由是「应用↔平台改 M:N 后派生链在 `sum by (platform)` 歧义」——该论证**对组成型资源不成立**（主平台唯一 ⇒ 派生无歧义），歧义只发生在**静态资源**（host 可能承载多应用、database / middleware 的 app 归属不唯一）。

**收敛方案**：

| 资源类型 | `platform_code` 取值 | 登记表单 |
|---|---|---|
| `application` / `interface_service` | **派生**：恒取 `app_code` 的主平台（服务端 `resolvePlatform` 物化） | 不展示平台输入（只读展示"由应用主平台决定"） |
| `host` / `database` / `middleware` / `generic_target` | **一等字段**：显式填写（可空，便于存量） | 保留平台输入 |

**不变**：`platform` label 注入机制（标签模板 `platform_code → platform`）不变；Excel 五类模板保留 `platform_code` 可空列（组成型资源该列读入后由服务端以主平台覆盖，避免旧模板报错）；判重键不变。

**附加（防御）**：`resolvePlatform` 在「app 存在但无主平台」时不再静默留空——D42 落地后该分支理论上不可达，保留为**告警日志 + 导入报告 warning**，作为数据治理缺口的可观测兜底。

### 3.4 前端连带项

| # | 页面 / 文件 | 改动 |
|---|---|---|
| F1 | `ApplicationDictPage.tsx` | 新建时「所属平台」必填 ≥1（错误文案：「应用必须归属至少一个平台，首个即主平台」）；`syncAppPlatformRels` 顺序改「新增 → 主平台切换 → 解绑」 |
| F2 | `PlatformManagementPage.tsx` | 列表增「关联应用」入口（Drawer 展示 `appPlatformRelApi.list({ platform_code })` 反查结果，含主平台标记）；纯前端，后端接口已有 |
| F3 | `PlatformManagementPage.tsx` L191 / L40 | 文案去「可选」：「应用必须归属至少一个平台（首个即主平台）」 |
| F4 | `ResourceFormDrawer.tsx` | 组成型资源隐藏平台输入，改为只读展示「由所属应用主平台决定」（D43） |

### 3.5 版本落点

| 项 | 版本 |
|---|---|
| D41 契约登记 + D42 服务端约束 + D43 收敛 + F1 / F3 | **MVP（本轮）** |
| F2 平台页关联应用列表 | **MVP（本轮，纯前端）** |
| F4 组成型资源隐藏平台输入 | **MVP（本轮）** |
| 平台 / 应用详情聚合拓扑视图 | {v0.2}（维持原切分） |
| 资源实例边 + 连线拓扑图 | {v0.3+}（维持原切分） |

---

## 4. 与现有文档差异点

| 现有口径 | 变更 | 说明 |
|---|---|---|
| 旧线决策 112 / 顶层 T7：「`platform` 非排障主维度、退为顶层可选过滤器」 | **定性修正** | 区分「组织归属 / 告警分发」（platform 第一维）与「排障下钻到实例」（platform 为背景），不再一刀切降级 |
| M07 历史技术 PRD §5.24「`platform` 是**高维 / 粗粒度**维度……不应作为告警分析 / 看板的默认下钻入口」 | **同上修正** | 同上 |
| M07 历史技术 PRD §5.24 / §5.19：应用可零平台关联（「未填且应用无主平台时不注入」被视为合法态） | **改为非法态** | 应用必须归属平台；删除最后一个关联被拒绝 |
| M07 历史技术 PRD §5.2 / §5.24：`platform_code` 为**全类型**资源行一等字段 | **收敛到静态资源** | 组成型资源改派生（主平台唯一 ⇒ 无歧义） |
| M07 历史技术 PRD §6.1 `POST /application-dict` 仅 `app_code` / `app_name` / `description` | **新增 `platform_codes`（必填）** | 应用登记即完成平台归属，堵孤立应用 |
| M07 SRS（v1.1）§3.2 平台段：仅「等保 / 安测 / 统一运维视角的最高层聚合维度」 | **补组织视角** | 平台 = 运维组织根节点；应用 = 平台的组织单元 |
| M07 SRS §4.1：字典维护主力角色为「平台管理员」 | **改为运维工程师** | 与 M07-OPS-10 及 owner 口径一致（三者由运维自维护） |
| M07 SRS §7.3：`platform` 用途「平台级聚合」 | **补「告警组织归属第一维度」** | 数据治理与告警消费显式接起来 |

---

## 5. 验收标准

- [ ] `platform` 维度定位修正落 `rewrite/v2.0/decisions.md`（D41），并登记 M08 / M05 契约建议。
- [ ] 服务端强制 I1 / I2 / I3：应用零平台关联不可产生；首个关联必为主平台；删除主平台须先转移；删除最后一个关联被拒绝（含单测覆盖三条拒绝路径）。
- [ ] `POST /application-dict` 要求 `platform_codes` ≥1，事务内原子创建应用 + 关联（失败整体回滚）。
- [ ] 组成型资源（application / interface_service）的 `platform_code` 由 app 主平台派生，不再接受独立输入；静态资源保留显式字段。
- [ ] `resolvePlatform` 在无主平台时产出可观测告警（不静默留空）。
- [ ] 前端：应用新建必填平台（F1）、平台页关联应用列表（F2）、文案去「可选」（F3）、组成型资源隐藏平台输入（F4）。
- [ ] M07 SRS 回填 5 处（版本 v1.1 → v1.2，Change Log 记录）。
- [ ] 目标测试通过：`go test ./platform/modules/m07/...`；前端 `pnpm vitest run src/pages/resources`。

---

## 6. 合并计划

- **本轮（MVP）**：落 D41 / D42 / D43 决策 → 回填 M07 SRS v1.2 → 实现服务端 I1 / I2 / I3 + `platform_codes` 契约 + `resolvePlatform` 收敛 → 前端 F1~F4 → 测试与验证。
- **评审**：orchastrator / prototype-designer 复核后，SRS 状态转 ready；决策状态由 draft 转 confirmed。
- **跨模块跟进**：M08 告警面板三维聚合（`platform` 一级维度）由 M08 owner 在 {v0.2+} 回填；M05 看板平台汇总卡同步。
- **归档**：合并完成后本文件状态改 `merged`，保留在 `design-proposals/` 供追溯。
