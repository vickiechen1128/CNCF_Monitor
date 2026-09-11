# 网域标签键收敛 + 租户标签键统一 + Prometheus→Alertmanager 投递接线（决策 68）

> **定位**：设计落版记录（决策依据 + 证据索引 + 影响面 + 验收口径），供后续开发分支落地与 zhangwq 对齐。
> **状态**：设计已确认，**本轮不改代码**（代码改动在开发分支按本记录的落地设计执行）。
> **日期**：2026-09-10
> **决策号**：决策 68（登记于 `docs/05-execution-records/module-09/design-decisions.md`）
> **子决策**：**68-1** 网域标签键收敛（§2）／**68-2** `alerting` 投递接线（§3）／**68-3** v0.2 口径约定（§4）／**68-4** 落档纪律（§5）／**68-5** 租户标签键统一 + 命名规约泛化 + fail-closed 严格派（§9）
> **关联**：M02 决策 4.4（注入标签 key 契约，本决策确认其为最终口径）、M06/M09 决策 19（`external_labels` 字段清单，其**键名选择**被本决策 supersede，其「移除 `tenant_id`」结论被 68-5 定版延续）、决策 55/56（告警状态归属与授权过滤）、决策 59/60（告警分发 MVP 闭环）、决策 61（AM v2 API 口径）、决策 64（交付包 `env/env.sh` 集中环境定义）、决策 66/67（规则 job 引用校验双层模型与动线修复）、F-07（M08 网域列缺陷修复）
> **落地分支**：`feat/module-08-alert-dispatch`（M09 侧改动随 M09 分支；本记录列出双侧文件）

---

## 1. 触发

2026-09-10，用户在 M08「Prometheus 当前触发告警」网域列缺陷（F-07）修复合入评审时，对修复说明中抛出的两个遗留发现逐条核实并拍板：

| # | 问题 | 核实结论 | 用户拍板 |
|---|------|----------|----------|
| 一 | `network_domain` vs `network_domain_id` 键名冲突 | 兼容双读已是正确分层，需收敛到单一键名 | **统一到 `network_domain`**（M02 决策 4.4 为准） |
| 二 | `prometheus.yml` 缺 `alerting:` 段 | 是缺口而非有意，M08 P0 验收在当前生成器下永远拿不到数据 | **确认纳入本期**；AM 地址走 `env/env.sh` 注入 |
| 三 | `tenant_id`（查询注入 matcher）vs `tenant`（序列标签）不一致 | 两侧**均无代码落地**（查询侧骨架恒通过、写入侧无 tenant 映射），是纯契约问题 | **现在就定版**：统一为 `tenant` + 命名规约泛化 + fail-closed 严格派（决策 68-5） |

**第三项的升级过程**：问题三最初以「⚠️ 遗留待决」形式记录（原 §9.1），理由是「改 `tenant_id` → `tenant` 会改变硬隔离边界定义，属产品决策，不擅改」。用户随后核实**两侧都只是契约层、零代码**（详见 §9.1），判定属于「趁免费窗口把契约定版」而非「改代码 + 迁数据」，遂要求**从遗留待决升级为正式决策**——改动全为文档、风险为零，收益是 v0.2 不再需要回头翻案。

同时确认：三个问题的**共性根因是「决策落档不同步」**——决策之间各说各话、无互标作废、闭环缺最后一环而无人验收。用户要求在 **`docs/05-execution-records/module-09/` 以一份设计记录** 把三件事与 v0.2 口径约定一并落档，并同步决策、PRD 与快照。**本轮不改代码。**

---

## 2. 问题一：网域标签键双名（`network_domain` vs `network_domain_id`）

### 2.1 现状核实：分层已经是对的

| 层 | 落点 | 现值 |
|----|------|------|
| 写入侧（唯一） | `platform/configcenter/generator/generator.go:42-51 buildExternalLabels` | `labels["network_domain_id"] = domainID` |
| 消费侧（唯一入口） | `platform/models/network_domain_label.go` → `ResolveNetworkDomain`（`network_domain` → `network_domain_id` → `default`，nil map 安全）+ `EnsureNetworkDomain`（回写） | 双读 + 回写 |
| 调用点 | `platform/query/alerts.go`、`platform/query/alerts_history.go`、`platform/alertmanager/alerts/service.go`；`platform/query/targets.go` 为同构回写先例 | 全部收敛于共享解析器 |

**判断**：兼容逻辑没有散落各处，全部收敛在唯一入口，**这不是临时补丁，已经是永久容错层的形态**——本决策不撤销它。

### 2.2 三层命名空间辨析：真正冲突的只有「标签键」这一层

| # | 命名空间 | 现状 | 处置 |
|---|----------|------|------|
| ① | **DB 列 / API JSON 字段** | `NetworkDomain.id`、`Resource.network_domain_id`、M09 管理面 Query `network_domain_id`、`ConfigDraft`/`ConfigVersion` 字段；`NetworkDomain.tenant_id`、`Tenant.id` | **保留 `_id` 后缀**——它们是 ID，语义正确，无歧义 |
| ② | **Prometheus 标签键**（`external_labels` + 查询注入 matcher + 静默 matcher） | 网域：M09 写 `network_domain_id`、M02/M08/Excel 模板/静默 matcher/targets 回写读 `network_domain`；租户：序列侧 `tenant`（M07 target 级）、查询注入 matcher 侧 `tenant_id`（M02 §7.2 第 1 条） | **收敛为 `network_domain` / `tenant`**（本决策 68-1 / 68-5） |
| ③ | **Query 参数 / Excel 列 / envelope 字段** | 网域 `network_domain`；租户 `tenant` | 保留（对齐 ②，不得带 `_id`） |

> **通用规约（决策 68-5-1 泛化，见 §9.2）**：**Prometheus 标签键（②）与对齐标签的 Query 参数 / Excel 列 / envelope 字段（③）一律不带 `_id` 后缀；`_id` 后缀只属于 DB 列与 API JSON 字段（①）。** 本表的网域行是这条规约的首次落地，租户行（§9）是第二次——规约确立后，后续新增标签无需再逐次评审命名。

**证据：②层是孤例，不是势均力敌的分歧。**

- 侧契约侧全为 `network_domain`：M02 PRD v1.13 §7.1「注入标签 key 契约」明确「注入的标签 key 必须与 Module_09 3.3.1 `external_labels` 注入的 key 完全一致」，并已写明「v1.2 起统一为 `network_domain`；v1.1 曾以 `network_domain_id` 作查询注入标签，会导致注入匹配不到数据（模块注入 = 权限隔离，失效即跨租户数据泄露或全空）」——即 **M02 决策 4.4 早已预警过本次发现的问题**。
- 同向的其他口径：M08 代理消费键、`/api/v1/alerts` 与 `/api/v1/alerts/history` 的网域字段、M07 Excel 导入模板列、静默 matcher、`targets/*.json` 回写、M02 envelope `meta.network_domains`。
- 反向支持：M01 `tech-feasibility.md` §7.2 建议 3 当年向 M09 提的注入建议本就是「注入标签名为 `network_domain`」。
- **孤例只有一处**：M06 `2026-08-19-business-registration-and-domain-business-orthogonality.md` 结论 8（登记为决策 19）把键名定为 `network_domain_id`，并由它派生到 M09 PRD §3.3.1、`generator.go:43`、`04_Implementation_Map.md` L88/L404、`03_Functional_Architecture.md` §7。

> 需要区分清楚：决策 19 的**字段清单**结论（移除 `tenant_id`，只保留部署级物理维度元数据）是正确的、本决策**不变**；被 supersede 的**仅其键名选择**。

### 2.3 决策 68-1：标签键收敛到 `network_domain`

1. **标签键统一为 `network_domain`**（M02 决策 4.4 为准），适用于 `global.external_labels` 与所有依赖该键的注入/matcher/消费面。
2. **代码改动只有一处**：`generator.go:43` 的 `labels["network_domain_id"]` → `labels["network_domain"]`。
3. **`ResolveNetworkDomain` 的双读永久保留**：历史 TSDB 序列与边缘网域经 vmagent `remote_write` 回传的序列仍携带旧键 `network_domain_id`，双读即**过渡层**（而非临时补丁），不得以「已收敛」为由删除。
4. **三层命名空间边界写入 PRD**（M09 §3.3.1 注记）：对象字段/API 字段用 `network_domain_id`（ID），Prometheus 标签键与 Query 参数用 `network_domain`，两者不得混用。

### 2.4 时序：现在改最便宜

- 尚无生产数据，`external_labels` 只影响**新生成**的样本；
- 键名变更**不需要数据迁移**（旧样本由双读兼容）；
- 越晚改，边缘回传历史越长、双读兼容期越长。

### 2.5 心理预期：标签键真正影响的链路

`external_labels` 只在 **remote write / federation / 发往 Alertmanager** 时附加；`GET /api/v1/alerts` 返回的是**规则求值标签**，本身不携带（F-07 已实测坐实）。因此标签键真正影响的是两条链路：

1. **Prometheus → Alertmanager 通知**（`upstream/prometheus/notifier/alert.go` 的 `relabelAlerts` 附加 `external_labels`）；
2. **边缘 Agent `remote_write` 回传**的中心存储序列。

—— 恰好与问题二咬合：这两条链路都必须先有 `alerting.alertmanagers` 接线才有数据。

---

## 3. 问题二：`prometheus.yml` 缺 `alerting:` 段

### 3.1 现状核实（代码 + 文档双侧）

| 侧 | 证据 | 事实 |
|----|------|------|
| 代码 | `platform/configcenter/generator/render.go:18-22 cfgFile` | 结构体只有 `Global` / `RuleFiles` / `ScrapeConfigs` 三个键，**没有 `Alerting`** |
| 代码 | `render.go:78-124 Assemble` | 不生成 `alerting.alertmanagers`；对照 `rule_files` 的**条件注入**先例在 `render.go:104-109` |
| 文档 | M08 `design-decisions.md`「分轨判定记录：2026-09-09（历史告警 MVP 增量）」关键决策 1 | 团队当时**已经知道**「当前部署未配置 `alerting.alertmanagers` 时完全无数据」——但那是**选历史告警数据源时的规避理由**（用于否决 AM `/api/v2/alerts?active=false` 方案） |
| 文档 | M08 PRD v1.12（2026-09-08）§9.1/§9.2 | 「Alertmanager 通知状态」由 v0.3 **提前到 MVP** 并列为 **P0 验收** |
| 实测 | `GET http://127.0.0.1:9093/api/v2/alerts`（2026-09-10） | 返回 **0 条** |

### 3.2 结论：是缺口，不是有意

- 决策 59/60 的「告警分发最小闭环」**只完成了 AM 侧配置挂载**（内容 Owner = M08、管道 Owner = M09，`alertmanager.yml` 落盘 + `amtool` 校验 + reload），**Prometheus → Alertmanager 的投递接线从未生成**。
- 后果：
  - M08 Tab1「Alertmanager 通知状态」是**死 UI**；
  - M08 PRD §9.1 的 P0 验收「端到端告警链路可验证：触发一条告警规则 → Alertmanager 按挂载配置路由 → 接收人 Webhook 实际收到通知」**无法 E2E 验收**。

### 3.3 决策 68-2：纳入本期，方案要点

1. **结构**：`cfgFile` 增 `Alerting *cfgAlerting \`yaml:"alerting,omitempty"\``，对应 `alerting.alertmanagers[].static_configs[].targets`。
2. **条件注入**（与 `rule_files` 对称，`render.go:104-109`）：**仅当 `alertmanagerYML` 非空时**才生成 `alerting` 段，避免指向不存在的 AM。
3. **AM 地址必须参数化，禁止硬编码 `127.0.0.1:9093`**：`Assemble` 增 `alertmanagerAddr string` 入参（现签名 `render.go:78`），调用点 `platform/configcenter/draft/service.go:210`。
4. **仅中心生成开关（v0.2 硬约束的口子）**：`alerting` 段只进**中心求值器**的 `prometheus.yml`；边缘包（`channel=agent_pull`）**永不生成**。
   依据：`docs/05-execution-records/module-01/tech-feasibility.md` §4.2（vmagent 对 `alerting`/`rule_files`/`remote_read` 不支持，需 `-promscrape.config.strictParse=false` 忽略；prometheus-agent Agent Mode **禁止** `alerting`、`rule_files`、`remote_read`）与 §7.2 建议 2（明确边缘 `prometheus.yml` 不应包含这三段）。
   落地形态 = **一个 `alertmanagerAddr` 入参 + 一个「仅中心生成」开关**——这就是本问题该留的 v0.2 口子。
5. **MVP 单机地址来源**：`env/env.sh`（对齐决策 64「集中定义，只改这一个文件」）。现有 `scripts/package-center.sh` 生成的 `env/env.sh.example` 已有 `AM_PORT`（默认 `9093`），`start.sh` 已用 `--alertmanager.url=http://127.0.0.1:${AM_PORT}` 传给后端；生成器入参复用同一来源（建议直接取 `alertmanager.url` flag 值或由 `AM_PORT` 合成），v0.2 多域时改为注入中心 AM 地址。
6. **校验链路不用动**：`promtool check config` 正常校验 `alerting` 段；草稿生成/重校路径（`draft/service.go` → `generator.Assemble`）自动覆盖。

### 3.4 配套

- Module_09 PRD §3.3 增「alerting 投递接线」条目 + §3.3.1 边界说明；§9 加验收条目。
- Module_08 PRD §9.1/§9.2 增 E2E 验收：**触发测试告警 → AM `:9093` 可见**。
- `docs/06-mvp-e2e-testing/` 相关清单同步该验收动作。

### 3.5 与规则锁修复（决策 67）的关系

**相互独立**：文件面不同、验收面不同（决策 67 在 `draft/service.go` 的校验/锁语义，决策 68 在 `generator/render.go` 的产物结构），可同分支独立提交。

---

## 4. v0.2 口径约定（决策 68-3）

| 项 | MVP | v0.2 / v0.4+ |
|----|-----|--------------|
| `alerting` 段生成范围 | **仅中心**（`channel=local` 的中心求值器配置） | 同（中心求值器唯一） |
| AM 地址来源 | `env/env.sh`（单机 `127.0.0.1:9093`，经 `AM_PORT`） | 注入**中心 AM 地址**（多域多采集节点共用中心 AM） |
| 边缘配置包（`agent_pull`） | **永不生成** `alerting` / `rule_files` | 同（vmagent / prometheus-agent 硬限制） |
| 开关粒度 | 全局「是否中心」 | 与决策 67-4 的 `effectiveJobNames(db, scope, domainID)` 同构的 scope 感知入参 |
| 标签键兼容 | 读 `network_domain` → 兼容 `network_domain_id` → 兜底 `default` | 同（双读常驻，覆盖历史回传序列） |

> **约定纪律**：`alerting` 与 `rule_files` 的生成条件**必须由同一处「是否中心」判定驱动**，禁止在任一文件各自 if——否则 v0.2 加边缘通道时必然出现「一段生成了、另一段没生成」的半残配置（与决策 67-4「单一实现 + 同一输入集」同一条教训）。

---

## 5. 共性根因：决策落档不同步

三个现象指向同一治理问题：

| 现象 | 根因 | 本次处置 |
|------|------|----------|
| 标签键冲突（网域） | M02 决策 4.4（2026-08-06）与 M06 登记 / M09 决策 19（2026-08-19）**各说各话、无互标作废** | 决策 68-1 收敛到 `network_domain`；**两处互标**（M06 结论 8 标 supersede、M02 决策 4.4 标 confirmed） |
| 标签键冲突（租户） | 同一类：M02 §7.1/§7.2 写 `tenant_id`，M06 结论 8 / M09 §3.3.1 / M07 §5.12 写 `tenant`，**同样无互标** | 决策 68-5 收敛到 `tenant` + **命名规约泛化**（标签键不带 `_id`），从根上停掉这类评审需求 |
| 校验「函数统一、输入不统一」 | 决策 66 只统一了**单一实现**，未统一**输入集** | 已在决策 67-4 处置（`effectiveJobNames`），本决策引用不重复 |
| 告警分发闭环缺最后一环 | 决策 59/60 只落 AM 侧挂载，Prometheus → AM 投递**无人验收** | 决策 68-2 纳入本期 + M08 PRD 补 E2E 验收 |

**治理教训（写入纪律）**：

1. 跨模块决策若覆盖同一命名空间（键名 / 字段名 / 判定集合），**必须在两侧决策记录互标**（`本决策 supersede 决策 X 的第 N 条` / `本决策第 N 条已被决策 Y supersede`），而非只在新决策里写一句。
2. 「最小闭环」类决策必须写明**链路两端**与**验收动作**（谁产生、谁消费、如何看到），不能只写其中一侧的产物 Owner。
3. **命名类冲突应沉淀为规约、而非逐个评审**：同类问题出现第二次（网域 → 租户）即应抽象出可机械套用的规约（本决策 68-5-1「标签键不带 `_id` 后缀」），并落到**同源常量**上（68-5-3①）——把「靠人记住」换成「靠机制拦下」，否则第三、第四次仍会发生。

---

## 6. 影响范围

### 6.1 本轮（仅文档）

| 文件 | 改动 |
|------|------|
| `docs/05-execution-records/module-09/network-domain-label-key-convergence-and-alerting-wiring.md` | **新增**（本记录） |
| `docs/05-execution-records/module-09/design-decisions.md` | 追加「决策登记：2026-09-10（决策 68）」 |
| `docs/05-execution-records/module-06/2026-08-19-business-registration-and-domain-business-orthogonality.md` | 结论 8 与「仍待明确的问题」3 补 **supersede 标注**（仅键名，字段清单结论不变） |
| `docs/05-execution-records/module-02/design-decisions.md` | 决策 4.4 行补 **经决策 68 复核确认为最终口径** 标注 |
| `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md` | v1.64：§3.3 标签注入行 / §3.3.1 全节 / 配置文件映射语义 / 新增「alerting 投递接线」注记 / §6.3 配置包结构 / §7.1.4 边界表 / §9 验收 / §10 术语 + Change Log |
| `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md` | v1.14：§9.1/§9.2 增投递接线 E2E 验收 + Change Log |
| `docs/02-product-requirements/Modules/Module_02_Query_Center.md` | v1.14：§7.1 补决策 68 交叉引用 + Change Log（**决策 68-5 追加**：v1.15——§7.1 租户行定版为 `tenant`、§7.2 第 1 条 matcher 同步 + fail-closed 严格派、全文注入名校正） |
| `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` | **决策 68-5 新增**：v2.31——§5.11 / §5.12 A / §5.13 落 `tenant_id → tenant` 内置默认映射前瞻口径与命名规约；§9 验收；Change Log |
| `docs/05-execution-records/module-08/api-contract-snapshot.md` | §10.1/§10.2「网域取值口径」按收敛后口径重写 + §10.3 diff 追加 |
| `docs/02-product-requirements/Modules/README.md` | 跨模块快照：M02/M07/M08/M09 行版本与摘要、更新日期 |
| `docs/02-product-requirements/03_Functional_Architecture.md` | §7 `external_labels` 口径修正（标签键 + `tenant_id` 过时 + `alerting` 边界）+ 决策 68-5 注入名校正 + 变更日志 |
| `docs/02-product-requirements/04_Implementation_Map.md` | L88/L97/L404 标签键修正 + 租户标签口径 + 变更日志 |

### 6.2 代码落点（本轮**不动**，待授权后在开发分支执行）

| 文件 | 改动 |
|------|------|
| `platform/configcenter/generator/render.go` | `cfgFile` 增 `Alerting`；`Assemble` 增 `alertmanagerAddr` 入参 + 条件注入 + 仅中心开关 |
| `platform/configcenter/generator/generator.go:43` | 标签键 `network_domain_id` → `network_domain`（同步注释） |
| `platform/configcenter/draft/service.go:210` | 传入 AM 地址 + 下发通道/是否中心判定 |
| `platform/models/network_domain_label.go` | **不动**（双读永久保留，注释补「过渡层常驻」说明）；**决策 68-5 追加**：按同一模式增 `TenantLabelKey = "tenant"`（与 `NetworkDomainLabelKey` 并列，同源常量） |
| `platform/query/alerts.go`（v0.2） | 注入侧 matcher 名引用 `models.TenantLabelKey`，**禁止硬编码**；`tenantAuthorizedDomains` 骨架替换为认证上下文解析 + fail-closed 严格派语义（68-5-4） |
| `platform/models/label_template.go`（v0.2） | `DefaultMappingBuilders` 五类默认模板增 `tenant_id → tenant` 映射（前瞻口径，v0.2 开启多租户时生效） |
| `platform/configcenter/generator/`（v0.2） | 生成期门禁：被引用 Job 的标签模板缺 `tenant` 映射 → `validation_status=failed`（与 jobref 门禁同模式，接入决策 67 的 `validation_details.source` 路由） |
| 测试 | `generator` / `render` 单测断标签键与 `alerting` 段条件生成；边缘通道断言不生成；v0.2 补 tenant matcher 名与门禁单测 |
| `scripts/package-center.sh`（`env.sh.example` / `start.sh`） | 如需新增 env 变量则同步（优先复用既有 `AM_PORT` / `--alertmanager.url`） |

---

## 7. 验收口径

**标签键收敛（68-1）**

- [ ] 新生成的 `config-output/prometheus.yml` 的 `global.external_labels` 含 `network_domain`，**不含** `network_domain_id`。
- [ ] `ResolveNetworkDomain` 对仅带旧键 `network_domain_id` 的标签仍解析出网域（历史序列兼容），兜底 `default`。
- [ ] `GET /api/v1/alerts`、`/api/v1/alerts/history`、`/api/v2/platform/alertmanager/alerts` 的网域字段仍由服务端回写（F-07 行为不回退）。

**alerting 投递接线（68-2）**

- [ ] 中心 `prometheus.yml` 含 `alerting.alertmanagers[].static_configs[].targets`，值为注入的 AM 地址（非硬编码 `127.0.0.1:9093`）。
- [ ] `alertmanager.yml` 为空（M08 无挂载内容）时**不生成** `alerting` 段。
- [ ] 边缘通道（`agent_pull`）配置产物中**不含** `alerting` 与 `rule_files`。
- [ ] `promtool check config` 对含 `alerting` 段的产物校验通过。

**租户标签键统一（68-5，v0.2 生效）**

- [ ] **契约层（本轮即可核）**：M02 §7.1 表与 §7.2 第 1 条的租户标签名为 `tenant`；M07 §5.12 / §5.13 的映射目标为 `tenant`；M09 §3.3.1 明确 `external_labels` 不承担租户标签。全仓 `docs/` 无「作为标签名的 `tenant_id`」残留。
- [ ] **命名规约**：新增标签键一律不带 `_id` 后缀（①层字段除外）。
- [ ] v0.2：注入 matcher 名为 `tenant`（引用 `models.TenantLabelKey`，全仓无硬编码字符串）。
- [ ] v0.2：被引用 Job 的标签模板缺 `tenant` 映射时生成期**阻断**（`validation_status=failed`），「前往修改」按 `source` 路由回 M07。
- [ ] v0.2：无 `tenant` 标签的序列对**普通租户不可见**；平台自身基础设施 Job 显式携带 `tenant="platform_admin"`（严格派 fail-closed，68-5-4）。

**E2E**

- [ ] 触发一条测试告警规则 → `GET http://<AM>:9093/api/v2/alerts` 返回非空 → M08 告警状态页 Tab1「Alertmanager 通知状态」可见该告警。

**回归**

- [ ] `go test ./platform/...` 全绿；`go vet` 干净。

---

## 8. 本轮明确不做

- **不修改任何代码**（用户指令：先不改代码）。
- 不做历史数据迁移（无需，双读兼容）。
- 不删除 `ResolveNetworkDomain` 的旧键双读。
- 不改决策 19 的**字段清单**结论（`tenant_id` 移除仍有效；决策 68-5 定版延续该结论）。
- **不实现任何 v0.2 语义**（tenant matcher 注入、生成期门禁、fail-closed 判定）——本轮只把契约定版并写明落点，代码留 v0.2。
- 不新增前端行为（`tenant` 注入对用户不可见不可改，无 UI 变更）。
- 不处理 04_Implementation_Map 头部「各模块 PRD 版本」串的既有陈旧（Module_01 v3.35 / M02 v1.12 / M08 v1.12 / M09 v1.56 等，与本轮无关的既有欠账），仅修本决策直接相关的标签键行。

---

## 9. 问题三：租户标签键 `tenant_id` / `tenant`（决策 68-5，已定版）

> **本节前身**：原「⚠️ 遗留待决（本轮取证发现，不擅改，待用户拍板）」。用户核实两侧均为**纯契约层、零代码**后，判定属「趁免费窗口把契约定版」，于 2026-09-10 要求**升级为正式决策 68-5**（编号接 68-4 落档纪律）。

### 9.1 现状核实：两侧都只是契约层，代码一行都还没有

| 侧 | 现状 | 证据 |
|----|------|------|
| **查询侧（M02）** | 租户 matcher 注入**仍是骨架恒通过**，不做实际注入 | `platform/query/alerts.go:127-131` `tenantAuthorizedDomains` 恒返回 `nil`（`alertDomainAllowed` 对空授权集合恒通过）；`platform/query/*.go` 中**没有任何 `tenant=` / `tenant_id=` matcher 构造代码**（实测 grep 为空）；仅有 `TestAlertsTenantScopeSkeleton` 锚点 |
| **写入侧（M07）** | LabelTemplate 默认映射里**根本没有 tenant 映射** | `platform/models/label_template.go:38-63` `DefaultMappingBuilders` 五类模板均无 tenant 项（实测 grep `tenant` 为空）；`tenant_id → tenant` 目前只是 M07 PRD §5.12 A 注记的**纸面约定** |
| **文档侧** | 序列标签名写 `tenant`、查询注入 matcher 名写 `tenant_id`，两处不一致 | M02 PRD §7.1 表第 2 行 + §7.2 第 1 条（写 `tenant_id`）；M06 结论 8（决策 19）、M09 PRD §3.3.1、M07 PRD §5.12 A（写 `tenant`） |

**关键判断**：这不是「改代码 + 迁数据」的问题，是「**趁免费窗口把契约定版**」的问题——

- 无存量序列带 `tenant` / `tenant_id` 标签（写入侧尚未生成任何 tenant 标签）；
- 无已上线的 matcher（查询侧骨架恒通过，未真实注入）；
- 故**不涉及数据迁移、不涉及契约兼容**，定版成本 ≈ 0；v0.2 再定则须付「迁移存量标签 + 处理已上线 matcher」的代价。

### 9.2 决策 68-5-1：通用命名规约——标签键一律不带 `_id` 后缀

**规约**：**`_id` 后缀只用于 DB 列与 API JSON 字段（ID 语义）；Prometheus 标签键、以及与之对齐的 Query 参数 / Excel 列 / envelope 字段，一律不带 `_id` 后缀。**

| 命名空间 | 网域（68-1 首次落地） | 租户（68-5 第二次落地） |
|----------|----------------------|------------------------|
| ① DB 列 / API JSON 字段 | `network_domain_id`（`NetworkDomain.id`、`Resource.network_domain_id`） | `tenant_id`（`Tenant.id`、`NetworkDomain.tenant_id`） |
| ② Prometheus 标签键 | **`network_domain`** | **`tenant`** |
| ③ Query 参数 / Excel 列 / envelope | `network_domain` | `tenant` |

**目的（用户明确要求）**：把「每次新增标签都要评审一次命名」换成**可机械套用的规约**——下次再有人加标签，只要遵守「②③层不带 `_id`」即自洽，**不需要再评审**。三层各自自洽，正是 `network_domain` 收敛时确立的分层（§2.2）。

> **落地要求**：本规约写入 M02 §7.1（标签键权威表所在处）、M09 §3.3.1（写入侧）、M07 §5.11（映射定义处）三处，使其成为**跨模块共同基线**而非单模块约定。

### 9.3 决策 68-5-2：统一为 `tenant`

1. **M02 §7.1 表**租户行标签 key：`tenant_id` → **`tenant`**；**来源**由「Module_09 `external_labels` 注入」更正为「**Module_07 LabelTemplate 以 target 级注入**」。
2. **M02 §7.2 第 1 条**matcher：`tenant_id="<用户所属租户 ID>"` → **`tenant="<用户所属租户 ID>"`**；硬隔离边界的**语义不变**（永远存在、用户不可见不可改）。
3. **M07 §5.12 / §5.13**：把 `tenant_id → tenant` 从「可选映射注记」升格为**内置默认映射的前瞻口径**（见 9.4①）。
4. **M09 §3.3.1**：注明 `external_labels` **不再承担租户标签**（决策 19 结论维持）；**租户标签唯一来源 = M07 target 级注入**。
5. **M06 结论 8（决策 19）**：补「经决策 68-5 定版确认」标注——其「`tenant` 标签走 target 级」的定性被本决策**明确定版**。

**与决策 19 的关系**：决策 19 已给出正确答案（`tenant` 走 target 级），但其**键名被决策 68-1 supersede 的那次修订**只改了网域键、未回头修正 M02 侧的租户 matcher 名。本决策补上这一处遗漏，**不推翻决策 19 的任何结论**。

### 9.4 决策 68-5-3：fail-closed 要成立，光统一名字不够——三个配套

| # | 配套 | 内容 | 解决的问题 |
|---|------|------|-----------|
| ① | **同源常量** | `platform/models` 增 `TenantLabelKey = "tenant"`（与既有 `NetworkDomainLabelKey` 同模式）；M02 注入侧与 M07 模板校验侧**均引用同一常量**，**禁止在 M02 硬编码 matcher 名** | 从机制上杜绝再次漂移——「靠人记住键名」→「靠编译器拦下」 |
| ② | **生成期门禁** | v0.2 开启多租户时，M09 生成期校验「被引用 Job 的标签模板含 `tenant` 映射」，**缺失则 `validation_status=failed`**（与 jobref 门禁同一模式，接入决策 67 的 `validation_details.source` 路由，可「前往修改」跳回 M07） | 消除**静默丢失**：模板没配 tenant 映射 → 该 job 序列无 `tenant` 标签 → 租户查不到自己的数据（且当前无任何报错） |
| ③ | **matcher 注入强制化** | v0.2 时 `tenant="<当前租户>"` **永远存在、用户不可见不可改**（M02 §7.2 第 1 条既有语义，只把 key 改对） | 避免「忘了注入」导致 fail-open |

### 9.5 决策 68-5-4：产品语义——fail-closed **严格派**（用户拍板）

**分叉**：没有 `tenant` 标签的序列算什么？两个选项：

| 选项 | 语义 | 评价 |
|------|------|------|
| 共享派 | 无标签 = 平台公共数据，所有租户可见。matcher 写成 `{tenant=~"\|<当前租户>"}` | 语义更贴合实际，但**实现与审计都更绕**；且**一开就收不回来** |
| **严格派（采纳）** | 无 `tenant` 标签 = **任何普通租户都不可见**（真 fail-closed） | 简单、安全；代价是平台基础设施自身的指标需显式打标 |

**决定：采纳严格派**（用户原话：「v0.2 初期宁可让平台指标对普通租户不可见（平台管理员租户仍可见），也不要开一个『无标签即公共』的隐式共享口，后者一旦开了就收不回来。」）

**连带的必做动作**：平台基础设施自身的指标（如监控平台自己的 `node_exporter`）**必须显式承载 `tenant="platform_admin"`**——即为中心 `default` 网域的平台自身 Job 单独注入该标签，而**不能依赖「无标签即公共」**。此动作纳入 v0.2 多租户落地方案（本记录登记，不在 MVP 实施）。

### 9.6 其他既有欠账（不在本轮范围，仅登记）

| 项 | 说明 |
|----|------|
| `04_Implementation_Map.md` 头部「各模块 PRD 版本」串陈旧 | 仍列 M01 v3.35 / M02 v1.12 / M08 v1.12 / M09 v1.56（`Modules/README.md` 已至 v3.40 / v1.14 / v1.14 / v1.64），且与 `05_Code_Implementation_Plan.md` 要求「逐字一致」。本轮仅修正该文件内本决策直接相关的标签键行，版本串另案刷新 |
| M08 PRD / M08 design-decisions 的 Change Log 表头列数与行数据不匹配 | 表头 6 列（缺「影响范围」），行数据 7 字段；影响渲染观感，不影响语义 |
| 各模块 design-decisions「Change Log（完整历史）」小节的引导语版本号陈旧 | 如 M02 写「承载 v1.4 及以前」但实际已含 v1.10；引导语未随历次轮转更新 |

---

## 附录 A：证据索引（文件:行）

**标签键写入/消费**

| 位置 | 内容 |
|------|------|
| `platform/configcenter/generator/generator.go:42-51` | `buildExternalLabels`，唯一写入点，现为 `network_domain_id` |
| `platform/models/network_domain_label.go` | `ResolveNetworkDomain` / `EnsureNetworkDomain`（消费侧唯一入口） |
| `platform/query/alerts.go` / `platform/query/alerts_history.go` / `platform/alertmanager/alerts/service.go` | 三处调用点 |
| `platform/query/targets.go` | 同构回写先例（`t["network_domain"] = resDomain`） |
| `docs/02-product-requirements/Modules/Module_02_Query_Center.md` §7.1 | 注入标签 key 契约（`network_domain`），含 v1.1→v1.2 修复说明 |
| `docs/05-execution-records/module-06/2026-08-19-...-orthogonality.md` 结论 8 | 决策 19：`external_labels` 键名定为 `network_domain_id` |
| `upstream/prometheus/notifier/alert.go` | `relabelAlerts` —— `external_labels` 发往 AM 的唯一附加点 |

**alerting 接线**

| 位置 | 内容 |
|------|------|
| `platform/configcenter/generator/render.go:18-22` | `cfgFile` 无 `Alerting` |
| `platform/configcenter/generator/render.go:78-124` | `Assemble` 不生成 `alerting.alertmanagers` |
| `platform/configcenter/generator/render.go:104-109` | `rule_files` 条件注入先例（对称模板） |
| `platform/configcenter/draft/service.go:210` | `generator.Assemble` 唯一调用点 |
| `docs/05-execution-records/module-01/tech-feasibility.md` §4.2 / §7.2 建议 2 | vmagent / prometheus-agent 禁 `alerting`、`rule_files` |
| `docs/05-execution-records/module-08/design-decisions.md`「分轨判定记录：2026-09-09」关键决策 1 | 「未配置 `alerting.alertmanagers` 时完全无数据」的既有记录 |
| `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md` §9.1 | P0 端到端告警链路验收（当前无法满足） |
| `scripts/package-center.sh`（`env/env.sh.example`、`start.sh` 生成段） | `AM_PORT` 既有定义与 `--alertmanager.url` 传参 |

**租户标签键（68-5）**

| 位置 | 内容 |
|------|------|
| `platform/query/alerts.go:127-131` | `tenantAuthorizedDomains` 恒返回 `nil`——租户注入**骨架**，无真实 matcher |
| `platform/query/alerts.go:134-143` | `alertDomainAllowed`——空授权集合恒通过（MVP 单租户语义） |
| `platform/query/*.go` | **无任何 `tenant=` / `tenant_id=` matcher 构造**（实测 grep 为空，印证「纯契约层」） |
| `platform/query/alerts_test.go` | `TestAlertsTenantScopeSkeleton` 骨架锚点测试 |
| `platform/models/label_template.go:38-63` | `DefaultMappingBuilders`——五类默认模板**均无 tenant 映射**（实测 grep `tenant` 为空） |
| `docs/02-product-requirements/Modules/Module_02_Query_Center.md` §7.1 / §7.2 | 注入标签 key 契约 + 硬隔离边界（原写 `tenant_id`，本决策定版为 `tenant`） |
| `docs/05-execution-records/module-06/2026-08-19-...-orthogonality.md` 结论 8（决策 19） | 「租户不进入采集拓扑，`tenant` 标签走 target 级」——本决策定版确认 |
| `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §5.12 A | `tenant_id → tenant` 映射注记（原为「可选」，本决策升格为内置默认前瞻口径） |
| `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md` §3.3.1 | `external_labels` 不注入租户 / 业务标签（决策 19 → 68-5 定版） |

---

## 附录 B：本轮文档改动对照（快速索引）

| 主题 | 收敛前 | 收敛后 |
|------|--------|--------|
| Prometheus 标签键（网域） | `external_labels.network_domain_id` | `external_labels.network_domain` |
| 对象/API 字段（网域） | `network_domain_id` | `network_domain_id`（不变） |
| 消费侧解析（网域） | `network_domain`（读不到则回落 `default`） | `network_domain` → 兼容 `network_domain_id` → `default`（口径显式写入 PRD/契约） |
| **标签键（租户）** | 序列侧 `tenant` / matcher 侧 `tenant_id`（不一致） | **两侧统一 `tenant`** |
| **租户标签来源** | 「M09 `external_labels` 注入 `tenant_id`」（M02 §7.1 表旧标注，已失效） | **M07 LabelTemplate target 级注入 `tenant`（`tenant_id → tenant`）**，M09 不承担 |
| **命名规约** | 逐次评审（网域一次、租户一次） | **标签键一律不带 `_id` 后缀**（`_id` 只属 DB 列 / API 字段） |
| **fail-closed 语义** | 未定义（骨架恒通过） | **严格派**：无 `tenant` 标签 = 普通租户不可见；平台自身 Job 显式 `tenant="platform_admin"` |
| `external_labels` 字段集 | `network_domain_id` / `zone_type` / `replica` | `network_domain` / `zone_type` / `replica`（字段集不变，仅键名） |
| Prometheus → AM 投递 | 无 `alerting` 段 | 中心生成 `alerting.alertmanagers`（条件 + 参数化 + 仅中心） |
