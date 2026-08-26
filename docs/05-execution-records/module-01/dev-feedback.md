# Module_01 开发反馈（dev-feedback）

> 本文件记录开发/规划阶段发现的 PRD / 原型空白或需修订点，供 PM 在 `design/module-mvp-demo` 上按版本化迭代收割。①类（PRD 文档问题）记录于此，由 chenrt 在 design 分支修订后合入 develop 回流；②类（实现矛盾）必须事前走 CR，不以本文件兜底。

## 2026-08-23（Phase 3 规划派生）

### F-01：PRD §5.6 ExporterInstallationConfirmation 主键维度过时（① 类，已决策）
- **位置**：`Module_01_Metric_Collection_Center.md` §5.6 数据模型
- **问题**：§5.6 定义安装确认唯一维度为 `resource × exporter_template_id`（不分 Job），与 §6.2.5 API、§8 状态机、Phase 3 UI 动线（在某 Job 的已选实例上确认）矛盾。
- **已决策实现口径（用户批准）**：主键维度改为 `resource_id × scrape_job_id`，FK scrape_job_id→ScrapeJob.id；`exporter_template_id` 降为冗余缓存（来自 ScrapeJob，不参与唯一性）。
- **待 PRD 修订**：
  1. §5.6：主键维度与职责边界由「resource×exporter、不分 Job」改为「resource×ScrapeJob」；
  2. §5.6：状态枚举名与 §8 统一为 `unconfirmed / confirmed / not_applicable`（原 §5.6 枚举名不一致）；
  3. §6.2.5：路径保持不变，说明里「确认记录（5.6）」引用上下文对齐到 Job 维度（其本身已正确，仅需随 §5.6 同步说明）。
- **收割方式**：chenrt 在 `design/module-mvp-demo` 按上述修订 PRD + Change Log，合入 develop 后回流开发侧。

### F-02：ScrapeJob 网域「已纳管」校验依赖 M09 字段（① 类，已决策临时口径）
- **位置**：Module_01 §5.4 `network_domain_id` 必填口径、§8/§9 网域约束；Module_01 §1 边界（M09 负责配置生成）
- **问题**：`NetworkDomain.is_monitored` 为 M09（Phase 4 配置中心）维护字段，M09 尚未开发；本期 ScrapeJob 校验若硬依赖该字段会形成空依赖。
- **已决策临时口径（用户批准）**：MVP 由 seed 将 default 及示例 edge 域 `is_monitored=true` 预置，后端校验 `is_monitored=true` + `status=enabled`（非冻结）；M09 落地后由 M09 自然接管该字段维护。
- **待 PRD 修订**：在 §5.4/§9 补一句「is_monitored 由 M09 维护，MVP 阶段 seed 预置已纳管」的过渡说明（可选，用于消除评审疑问）。

## 2026-08-23（审查登记 ② 偏差，非阻断，MVP 阶段裁剪）

> 以下 3 项已由审查判定为与契约/验收相关但受 Phase 阶段限制，评为非阻断；仅登记说明原因，不强制改逻辑。

### F-03：M2 mapping_overrides 提交时未持久化
- **位置**：ScrapeJob 编辑抽屉参数覆盖（`mapping_overrides`）
- **问题**：列表「参数同步」列基于 `mapping_overrides.length` 概览，但提交时（新增/编辑）未随 body 持久化 `mapping_overrides`，故同步状态明细不回显。
- **登记原因**：`mapping_overrides` 详情的持久化与参数继承/覆盖闭环属 MVP 功能裁剪范围，当前仅展示概览态，不影响采集主链路。

### F-04：M3 validateYaml 新建场景无 id 无法调用，退化为本地规则预检
- **位置**：规则挂载侧写（RuleMountDrawer）YAML 预检
- **问题**：`validateYaml` 后端校验需要已存在规则 id；新建场景尚无 id，故退化为前端本地规则预检（断言为契约偏差，非逻辑缺陷）。
- **登记原因**：契约要求校验接口基于既有规则；新建态无 id 属接口/交互衔接差异，前端以本地预检兜底保证可用性。

### F-05：M4「前往配置变更确认」跳转占位
- **位置**：采集 Job 启停/删除成功提示后的跳转入口
- **问题**：「前往配置变更确认」为目标路由跳转占位，当前仅提示文案。
- **登记原因**：配置变更确认页属 M09（Phase 4）模块，M09 未落地前无法提供真实跳转目标，故以占位提示保留动线。

### F-06：NetworkDomain.token 明文回显（跨模块敏感项，M06/M09 跟进）
- **位置**：`platform/models/network_domain.go:64` `Token` 为 `json:"token,omitempty"`，`platform/admin/networkdomain/` create/detail/list/update 整体序列化 `models.NetworkDomain`，会回显该 token。
- **问题**：与本次 ScrapeJob 凭据修复（json:"-" 不回显）同一安全口径未覆盖到 M06/M09 管理域；security-reviewer 定向复审时发现，属本模块外遗留。
- **登记原因**：不在 module-01 改动范围，不阻塞本模块合并。建议在 M06/M09 对应模块上线前按同一决策收敛为 `json:"-"`（或确认存储即脱敏）。

## 2026-08-23（原型↔生产映射发现，已裁决）

### F-07：采集 Job「编辑态网域 disabled」与契约「PUT 可改网域」冲突（② 类，已定方案）
- **位置**：`ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`（编辑态网域 `disabled={isEdit}`）；契约 `api-contract-snapshot.md` §5/§10（`PUT /scrape-jobs/:id` 允许改 network_domain_id，仅当目标网域冻结时禁止新增该域实例）
- **问题**：生产将编辑态网域固定为只读（不可改），与契约/PRD 允许「改网域」的接口口径冲突。若按契约放开，则需处理跨域约束（目标网域已纳管 + 非冻结 + 实例同域一致性校验）；若维持只读，需在 PRD §5.4 锁定「Job 创建后不可改网域」并为契约对齐回显口径。
- **决策（chenrt/PM，2026-08-23）**：**选①按契约放开编辑态改网域**。T01-F11 已落地：`ScrapeJobFormDrawer` 网域字段去掉 `disabled={isEdit}`，编辑态可改网域（目标网域仍仅已纳管非冻结可选）。冻结核验与实例同域一致性由后端接口约束，前端沿用已纳管非冻结过滤。
- **验收口径**：与 frontend-prototype-map §6/§7（FIX-2）、task-sequence T01-F11 一致。

### F-08：采集 Job 表单 / 默认采集配置表单「资源类别+监控对象类型」被合并为单 Select（F1-8，T01-F13）
- **位置**：`ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`（单「监控对象类型」Select，OptGroup 级联）、`MappingDrawer.tsx`（单「监控类型」Select，OptGroup 级联）
- **问题**：原型为「资源类别 + 监控对象类型」两个独立字段（两级级联），生产一度合并为单个 Select（OptGroup），被 frontend-prototype-map §3.2/§6.1 记为偏离 F1-8，用户明确要求恢复两字段布局。
- **决策（chenrt，2026-08-23）**：拆回两个独立 Form.Item：`resource_category`（选项=MONITOR_TYPE_CASCADE 各 category，展示 CATEGORY_MAP）+ `monitor_type`（保留契约字段名，选项按已选 category 过滤，两级级联）；选定 monitor_type 仍沿用 handleMonitorTypeChange 带出默认采集器与参数；编辑态由 record.monitor_type 反推预填 resource_category；提交载荷仍为 single monitor_type（resource_category 仅表单级联用，不落后端字段）；MappingDrawer 编辑态两字段保持 disabled。
- **留痕**：T01-F13 落地，见 frontend-prototype-map §6.1/§7；影响文件按 `fe-fix-monitor-type-split` 分组。

### F-03 补充：参数同步列三态回显（T01-F12）
- **背景**：dev F-03 登记「`mapping_overrides` MVP 不持久化」。T01-F12 在未落库前提下纠前端口径：黑盒 Job 显「同步」；有覆盖显「已覆盖 n 项」（蓝）；无覆盖时对比默认映射快照（ciExporterMappings is_default）——不一致显「待同步」（橙）+ Tooltip「映射默认值已变更」，一致显「已同步」。
- **留痕**：`ScrapeJobListPage` 参数同步列按 `mapping_overrides.length` + 默认映射快照对比实现异常驱动三态；后续若后端落库 `mapping_overrides`（dev F-03 解除），可直接升级为按持久化覆盖数量回显。

## 2026-08-23（复审观察项 O1/O2/O3 修复，用户口径）
> 定向复审观察项 O1/O2/O3 已由用户裁定按 §6.5 待修复并完成 T01-F14~F16。

### O1/O2/O3 已按用户口径修复（T01-F14 ~ T01-F16）
- **O1（T01-F14）**：Job 列表「标签模板」列「待配置」橙 Tag 改异常驱动 —— 正常继承（job.label_template_id 命中）只显模板名、不显「待配置」Tag；仅当 Job 未关联标签模板、但该 monitor_type 默认映射已挂 label_template_id 时显橙色「待配置」（可点击补配引导）；其余显 `-`。复用 `labelTemplateById` / `defaultMappingByMonitorType`，不新增后端调用。
- **O2（T01-F15）**：`ExporterTemplateDrawer` 新增可选 prop `initialMonitorTypes?: MonitorType[]`，打开抽屉时预填 `supported_monitor_types`；`ScrapeJobFormDrawer` 登记调用以当前已选 `monitor_type`（useMemo 稳定引用）传入；`CollectorTemplatesTab` 直接登记不传（不预填，行为不变）。
- **O3（T01-F16）**：`ScrapeJobFormDrawer`「网域」空态引导由指向 M07 的文字改为指向 M06 的可点击链接（`useNavigate('/admin/domains')`，`系统与平台管理 → 网域管理`）；文案体现「默认域自动同步已纳管，未纳管请前往网域管理纳管」，不再写 M07。

## 2026-08-23（用户裁定：导航独立两页 + 标签模板口径偏离）

### F-09：采集器管理与采集 Job 由「页内 Tab」改为「两个独立页面」（① 类，已决策，待 design 更新原型）
- **位置**：`ui-custom/web/src/pages/strategy/CollectorTemplatesTab.tsx`（现为 `/scrape-jobs?tab=collectors` 页内 Tab）；`MainLayout.tsx` 采集策略一级 tab 的 Sider 二级；原型 `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx` 折叠子目录模型（D2/D4）
- **问题**：生产把「采集器管理」做成采集 Job 页内 Tab（`?tab=collectors`），与原型「采集分组折叠子项」及用户动线「先配置采集器管理、再配置采集 Job」不符；用户裁定不启用折叠，改为**两个独立页面**。
- **决策（chenrt，2026-08-23）**：采集器管理拆为独立页面（建议路由 `/collectors`），采集 Job 保持 `/scrape-jobs`；「采集策略」一级 tab 下 Sider 二级含「采集器管理 / 采集 Job / 规则编辑 / 指标库」四个子项；`CollectorTemplatesTab` 由页内 Tab 改挂独立路由（组件主体可复用）。动线保持「先采集器管理（登记+默认配置）→ 再采集 Job（创建时自动套用默认值）」。
- **待 design 分支更新原型**：原型折叠子目录模型 → 独立两页模型；导航 IA 同步 frontend-prototype-map §4。
- **收割/实现**：映射表 D2/D4 与 §4 导航 IA 同步更新；task-sequence 新增 T01-F17（导航拆分）。
- **补充裁定（chenrt，2026-08-23 21:4x）**：原型侧「采集策略」一级分组**取消**——采集器管理（/collectors）与采集 Job（/scrape-jobs）**提升为 Sider 一级导航项**，规则编辑为独立一级项（位于「指标库」之后，PRD §3.1）；原「四个子项」表述以本次裁定为准。生产实施（T01-F17）时「采集策略」分组是否保留按此裁定对齐。

### F-10：默认采集配置抽屉「标签模板」字段偏离原型（② 类，待修复）
- **位置**：`ui-custom/web/src/pages/strategy/MappingDrawer.tsx:211-213`（label_template_id 为裸 Input + `disabled={!isEdit}` 新增禁填）；原型 `ScrapeJobsPage.tsx` L2075-2106（Select 选择器 + 自动预填 + 无模板创建引导）；PRD §5.1 L236（已有模板自动预填默认模板、无模板触发创建引导）
- **问题**：生产把标签模板关联重心放在列表「查看/更换/补配」两行卡片，抽屉内 label_template_id 退化为「新增禁用 + 手填 ID」，丢失了 PRD/原型「新增即自动预填默认模板 + Select 选择器 + 无模板创建引导（立即创建/稍后再说）」的要求；Job 侧标签模板非必填（✅ 与 PRD 一致，无偏离）。
- **决策（chenrt，2026-08-23）**：MappingDrawer label_template_id 改为 Select 选择器（按资源类别过滤 + allowClear），新增态可预填/可选（不再 disabled）；无可用模板时提供「前往标签模板管理（M07）创建」引导；已有默认模板自动预填。标签模板仍非必填、与采集器正交。
- **实现**：task-sequence 新增 T01-F18。

## 2026-08-23（用户裁定：标签模板变更入口收敛，防双入口不同步）

### F-11：默认采集配置「编辑」抽屉剥离标签模板字段，标签模板变更入口收敛到「更换/补配」（② 类，已裁决）
- **位置**：`ui-custom/web/src/pages/strategy/MappingDrawer.tsx`（编辑默认采集配置抽屉）、`CollectorTemplatesTab.tsx`（列表「标签模板」列 查看/更换/补配）、`LabelTemplateSelectDrawer.tsx`（更换/补配轻量抽屉）、`platform/strategy/ci-exporter/update.go`（PUT 部分更新）
- **问题**：此前「更换/补配」与「编辑」都指向同一 mapping 的 `label_template_id`，两个入口写同一字段 → 界面数据易不同步；且「更换/补配」打开内容与「编辑」雷同，违背「换/配标签时不改采集器信息」的人工裁定。
- **决策（chenrt，2026-08-23，替代 F-10 的 MappingDrawer 内联编辑方案）**：
  1. **入口收敛**：`MappingDrawer`（新增+编辑）**完全移除 `label_template_id` 字段**，仅保留采集器/参数/默认标记；标签模板的**唯一变更入口** = 列表「标签模板」列「更换/补配」轻量抽屉（`LabelTemplateSelectDrawer`），后端 PUT 仍支持部分更新 `label_template_id`（§6.2.1）。
  2. **体验增强**：轻量抽屉带入上下文（监控对象类型 / 资源类别 / 默认采集器，只读），明确「在给哪条默认采集配置换/配标签」；「更换」模式高亮回显**当前已选模板**（PRD L241「更换=同资源类别其他模板」）；候选按资源类别过滤，空态提供「前往标签模板管理创建」引导。
- **深链核对结论**：生产未实现「打开本行编辑抽屉补配」的 `edit=`/`view=collectors` 深链——Job 表单标签引导（F1-4，`ScrapeJobFormDrawer.tsx:405`）仅为 `message.info` 提示「前往标签模板管理维护（M07）」，非映射编辑抽屉跳转；故无待重定向入口。
- **待 PRD/原型同步**：PRD §5.1 默认采集配置实体/§6.2.1 增补「标签模板经『更换/补配』轻量入口维护、编辑抽屉不含该字段」；原型配合收敛动线。
- **留痕**：`LabelTemplateSelectDrawer`、`MappingDrawer` 按此实现；F-10 内联 Select 方案被本项替代。另在 `MappingDrawer` 编辑态新增快照语义 info 提示「变更仅影响新建 Job，不影响已存在 Job…（如需存量 Job 采用新参数，请在采集 Job 内手动『同步映射默认值』）」，依据 PRD §5.4 参数继承与同步策略（L209-216/L465-467）——修饰该类配置时向用户说明为何无需 M09 变更确认。

## 2026-08-24（Phase 5 联调：标签模板选择/预览补齐映射明细与 M07 跨模块引导）

### F-12：标签模板选择/预览缺少映射明细与 M07 跨模块引导（② 类，已按 PRD §5.1 补齐）
- **位置**：`ui-custom/web/src/pages/strategy/CollectorTemplatesTab.tsx`（列表列 + 预览抽屉）、`LabelTemplateSelectDrawer.tsx`（更换/补配选择抽屉）、`ScrapeJobFormDrawer.tsx`（Job 表单标签模板 Radio 列表）
- **问题**：PRD §5.1 L228/L229/L240 要求「选择/查看标签模板时展示模板头部（名称 + 默认标记）+ 映射明细，并提供『前往标签模板管理（M07）』跨模块跳转」；但实现仅显示模板名（此前甚至只显「已挂模板」），**无映射明细、无 M07 引导入口**，模板不合适时用户无法前往 M07 深度管理，交互欠缺。
- **修正（已实施，锚定 PRD L228/L229/L240）**：
  1. 新增可复用 `LabelTemplatePreview` 组件：模板头部（名称 + 默认标记）+ 类别·模板ID + 映射明细表（来源字段 → 来源类型 → 目标标签 → 启用）+「前往标签模板管理（M07）」链接。
  2. `LabelTemplateSelectDrawer`：选中模板后内联展示 `LabelTemplatePreview`，随选择实时联动，可核对映射内容后再提交；空态保留「前往标签模板管理创建」引导。
  3. `CollectorTemplatesTab`：列表「标签模板」列显示具体模板名称 +「默认」标记（命中模板时）；预览抽屉由 `LabelTemplatePreview` 承载映射明细 + M07 链接，替代原「已挂模板」占位。
  4. Job 表单 Radio 列表已展示名称 + 默认标记 + 类别·映射数，空态/F1-4 已有 M07 引导，未重复改造（与 PRD L229 匹配）。
- **验证**：`tsc --noEmit`、`eslint` 通过；`vitest`（CollectorTemplatesTab + ScrapeJobFormDrawer，21 用例）通过。
- **收割方式**：实现已对齐 PRD L228/L229/L240，无待 PRD 修订项；供 PM 复核与原型动线校验（跨模块跳转沿用 `#/label-templates`，未落地统一导航配置为既有债务）。

## 2026-08-25（Phase 5 联调：草稿/批量提交生效提级 MVP，决策 D28）

### F-16：采集 Job 草稿与批量提交生效（P1 需求，方案 C 提级 MVP）

- **类别**：① PRD 空白判定（P1 需求，用户决策提前实现并提级 MVP）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.1「ScrapeJob 草稿与批量提交生效」/ §5.4 `draft_status` 字段 / §11.1 列表操作；源码 `platform/strategy/scrapejob/batch.go` / `routes.go`、`ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`、`ScrapeJobFormDrawer.tsx`
- **问题**：PRD 将「保存草稿 / 提交生效」双模式与批量提交生效定位为 v0.2 能力，MVP 仅四态占位（草稿灰显）。用户初次配置场景（job 量大）需要先批量编辑、再一次下发，MVP 缺少承载。
- **结论（用户拍板，详见 design-decisions D28）**：
  1. **方案 C 提级 MVP**：创建抽屉提供「保存草稿 / 提交生效」双按钮，默认仍为「提交生效」；草稿只做基础校验（字段类型 / 名称唯一性），提交生效做完整校验（必填 / 网域已纳管 / 实例同域）；draft 语义 = 新建阶段半成品暂存，不是变更安全闸口（闸口在 M09 变更单人工确认）。
  2. **批量接口收窄为「批量提交生效」（draft→ready 单向）**：本轮先落地的 `POST /api/v2/platform/scrape-jobs/batch-draft-status` 双向接口需收窄——已 ready 的 job 跳过/报错，不提供用户主动 ready→draft 回退（前端不暴露、后端拒绝）。回退诉求由 M09 变更单废弃承接（决策 43-3：新建未生效 job 随单自动回退 draft，为系统级唯一例外）。
  3. **批量下发诉求由变更单合并承载**：连续创建多个 ready job 由 M09「后单取代前单」合并进同一张 pending 变更单，最后一次人工确认全部下发；draft 中间态不是批量下发的必要条件。
- **影响模块**：后端（`platform/strategy/scrapejob/batch.go` 收窄 + 创建接口支持 draft 保存）、前端（`ScrapeJobFormDrawer.tsx` 双按钮、`ScrapeJobListPage.tsx` 批量提交生效）
- **发现场景**：用户实测 M09 配置预览行为后提出批量编写 job 的诉求；讨论中进一步明确「采集 job 不做日志记录，只保留干净的生效 job」的产品原则。
- **实现落库**：
  - 后端 `platform/strategy/scrapejob/batch.go`：`BatchUpdateDraftStatusHandler` 语义收窄为「批量提交生效」，请求体改为 `BatchSubmitReadyRequest{IDs}`；`BatchSubmitReady` 要求目标 job 当前 `draft_status=draft`，逐条做完整校验（all-or-nothing），成功后置 `draft_status=ready / change_status=pending`；不再提供 ready→draft 用户主动回退。
  - 后端 `platform/strategy/scrapejob/create.go`：`CreateScrapeJobRequest` 新增 `draft_status` 字段；`draft` 时仅做基础校验（job_name / job_type / 唯一性）并保存，`ready` 时做完整校验并进入 M09 变更管线。
  - 后端单测：`platform/strategy/scrapejob/batch_test.go` 重写为单向语义；`create.go` 分支通过既有测试覆盖。
  - 前端 `ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`：新增态 footer 改为「取消 / 保存草稿 / 提交生效」；「保存草稿」仅基础校验 + `draft_status: 'draft'` + 不触发 M09 变更单；「提交生效」保持完整校验 + 即时 best-effort 触发 `configDraftApi.create`。
  - 前端 `ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`：批量操作只剩「批量提交生效」，仅当选中项含 `draft_status === 'draft'` 时可用，调用 `batchSubmitReady`。
  - 前端类型/API：`ScrapeJobInput` 增加 `draft_status?: 'draft' | 'ready'`；`scrapeJobApi.batchDraftStatus` 改为 `batchSubmitReady({ ids })`。

## 收割状态
- [x] F-01 已收割（chenrt 修订 PRD §5.6 / §6.2.5：安装确认主键维度改 `resource_id×scrape_job_id`，状态枚举统一）
- [x] F-02 已收割（chenrt 修订 PRD §5.4 / §9：`is_monitored` 由 M09 维护、MVP seed 预置已纳管过渡说明）
- [ ] F-03 已登记（MVP 功能裁剪，`mapping_overrides` 不持久化）
- [ ] F-04 已登记（契约偏差，新建场景退化为本地预检）
- [ ] F-05 已登记（M09 未落地，跳转占位）
- [ ] F-06 已登记（NetworkDomain.token 回显，M06/M09 跟进）
- [ ] F-07 已裁决（编辑态网域按契约放开，T01-F11 落地）
- [x] F-11 已收割（chenrt 修订 PRD §6.2.1：`label_template_id` 唯一变更入口=列表「更换/补配」轻量抽屉，编辑抽屉不含该字段；原型动线已同步）
- [ ] F-12 已对齐 PRD L228/L229/L240（实现完整，供 PM 复核与原型动线校验；跨模块跳转未落地统一导航配置为既有债务）
- [x] F-16 已修正/实现 + 已收割（代码已落库；design 分支已落 PRD §5.1 版本归属 v0.2→MVP / §5.4 单向流转补系统随单回退例外 决策 43-3 / §11.1 批量提交生效，并同步原型 Job 抽屉双按钮 + 批量提交生效）
- [x] F-17 已收割（决策 D43 labels 归属层级：design 已落 M01 PRD §5.4 `label_template_id` 注「Job 级引用、labels 落 `targets/*.json` target 级」+ M09 PRD §3.4 补 target 级 labels 来源说明；原型 target 预览/详情展示仍待后续评估）
- [x] F-19 已收割（决策 44-1/44-4 pending 期锁定：design 已落 M01 PRD §5.4「pending 期锁定（MVP）」——pending 期间禁止编辑 / 启停 / 删除 Job，解锁路径=M09 变更单确认或废弃；原型 `ScrapeJobsPage` pending 行禁用编辑 / 启停 Switch / 删除 + Tooltip 已同步）
- [x] F-21 已修正/实现（变更清单按产物 diff 派生，禁用 Job 不再误报「无变化」）
- [x] F-22 已修正/实现（规则创建默认启用，按钮文案「提交生效」）
- [x] F-23 已收割（生产已对齐采集 Job 列；design 已更新原型 RulesPage：删除下发状态/启用状态两列，改「变更进度」+「生效状态」两列，启停改为文字按钮+二次确认）
- [x] F-24 已修正/实现 + 已收割（代码已落库；design 已落 PRD §5.5 多记录合并单份 rules.yml + 组名全局唯一，原型补资源类别/监控对象类型级联字段）
- [x] F-25 已决策 + 已收割 PRD（MVP 实现「停用可编辑」；规则草稿推迟 v0.3 不提前实现；PRD §5.5 已补规则 pending 期锁定语义同采集 Job；**规则后端 pending 409 兜底仍待开发侧跟进**）
- [x] F-26 已修正/实现 + 已收割（代码已落库：来源下拉仅内部自建 / exporter_template_id 字符串契约修复 / 登记→配置动线预填；design 已统一 PRD §5.2 L81↔L334 矛盾——用户登记仅 internal）
- [x] F-27 A/B/C 已修正/实现 + 已收割（删除入口 / 下拉类型过滤 / 映射类型校验已落库）；**F-27 D 仍待设计侧决策**（开放 official/third_party 登记 + 预置降级为初始数据，PRD §5.2 已登记为 v0.2+ 待设计方向，未实质放开）
- [x] F-28 已修正/实现 + 已收割（代码已落库：采集参数层叠默认 + 稀疏覆盖 / interval·timeout 真实渲染 / 查看抽屉 / 映射删除；design 已落 PRD §5.1/§5.4 层叠默认链与「留空=继承」口径 + 原型同步 placeholder 交互）
- [x] F-20 已收割（chenrt 修订 PRD §5.4「端口不在 Job 层的理由」按决策 46 统一端口口径——MVP 端口不进 `ScrapeJob` 快照、`mapping_overrides` 不含 `port`，由 M09 生成器按 `CITypeExporterMapping.default_port` → 回落 `ExporterTemplate.default_port` 解析；Job 级端口快照留待 v0.2+ 评估）

## 2026-08-26（采集参数三层简化：层叠默认 + 稀疏覆盖）

### F-28：采集参数「填 3 遍」简化——层叠默认 + 稀疏覆盖（② 类实现偏差修复 + ① 类 PRD 口径已收割）

- **类别**：② 实现偏差（B/C/D/E 已按用户拍板落地）+ ① PRD 空白（层叠默认链口径已由 design 收割）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.1（CITypeExporterMapping）/ §5.2（ExporterTemplate 预置参数）/ §5.4（ScrapeJob 参数字段表）；源码 `platform/strategy/scrapejob/{validate,create,update,batch}.go`、`platform/configcenter/generator/render.go`、`ui-custom/web/src/pages/strategy/{CollectorTemplatesTab,MappingDrawer,ScrapeJobFormDrawer}.tsx`
- **问题（用户实测提出）**：
  1. **端口/路径填 3 遍、间隔/超时填 2 遍**：采集器登记（模板层）→ 默认采集配置（映射层）→ 采集 Job 都要重复填写同义参数；且三处均为值预填/必填，用户无法「留空继承」；
  2. **间隔/超时从未生效（缺陷）**：generator `scrapeConf` 结构体无 `scrape_interval/scrape_timeout` 字段，Job 上填的间隔/超时**从未写入 prometheus.yml**（静默丢失，实际按 Prometheus 全局默认 1m 执行）；
  3. **更新/批量提交生效路径无回落**：`inheritDefaultsFromMapping` 仅 create 调用且只有「映射一层」回落；update 清空字段直接报「必填」；草稿批量提交生效不做参数解析；
  4. **登记采集器后无「查看」入口**：supported_monitor_types 等登记信息无法回显确认；
  5. **默认采集配置（映射行）无「删除」入口**：后端 DELETE 早已实现，前端未放按钮。
- **结论（用户拍板，方案 A / V1「层叠默认 + 稀疏覆盖」）**：
  - **层叠默认链**：Job → 默认采集配置（CITypeExporterMapping，is_default）→ 采集器模板（ExporterTemplate，仅 metrics_path/scheme 有模板级默认）→ 全局兜底常量（`models.DefaultScrapeInterval=15s` / `DefaultScrapeTimeout=10s` / `DefaultMetricsPath=/metrics` / `DefaultScheme=http`）。任一层留空 = 继承下一层。
  - **快照语义不变（决策 14 兼容）**：解析发生在 **Job 保存时**（create/update/batch-submit-ready 统一 `resolveJobScrapeParams`），落库即为该 Job 生效快照；映射/模板后续变更不自动影响存量 Job，存量 Job 采用新默认值仍需重新保存（清空字段保存 = 恢复继承）。
  - **端口不进 Job 快照**（维持决策 46）：端口解析仍在生成器 `LoadExporterPort`（映射层 → 模板层）。
- **已落地改动**：
  - **后端 `scrapejob`**：`validateJobRequest` 摘除 standard 任务 4 参数硬必填；`inheritDefaultsFromMapping` 升级为 `resolveJobScrapeParams`（三层回落 + 全局兜底，保证 ready 任务生效参数恒非空）；create / update / `BatchSubmitReady` 三入口统一调用（batch 路径同步把解析结果随状态翻转落库，保持 all-or-nothing）。
  - **后端 `generator`**：`scrapeConf` 补 `scrape_interval/scrape_timeout` 字段真实渲染进 prometheus.yml；空值按全局兜底常量回填（存量/异常数据防线）。
  - **前端 `MappingDrawer`**：F-26 值预填改为 **placeholder 展示所选采集器默认参数**（留空=继承）；协议改 allowClear Select；提交时空值显式归一为 `''`/`0`（编辑态清空 = 恢复继承）；新增「留空=继承」说明 Alert。
  - **前端 `ScrapeJobFormDrawer`**：参数区 4 字段摘除必填校验，placeholder 展示继承链下层生效值（映射 → 采集器/全局兜底）；`buildBody` 空值归一为 `''` 提交；`handleMonitorTypeChange` 不再值预填参数（默认采集器/标签模板仍自动带出）。
  - **前端 `CollectorTemplatesTab`**：模板行 + 映射行新增「查看」（只读详情抽屉：名称/版本/来源/支持的监控对象类型/端口/路径/协议/OS/架构/下载/文档/安装指南）；映射行新增「删除」（仅非内置，Popconfirm 二次确认，被 Job 引用由后端 forbidden 兜底）；采集参数列稀疏值显示「15s（默认）/10s（默认）」。
- **待 PRD 修订（① 类，design 分支收割）**：~~1. §5.1/§5.4 补「层叠默认链 + 留空=继承」口径：Job/映射参数字段可空，空 = 继承下一层，保存时解析为快照；2. §5.4 字段表 4 参数从「继承映射快照可覆盖」改为「可留空（继承）/ 可覆盖（快照）」；3. 原型 MappingDrawer/ScrapeJobFormDrawer 参数区同步 placeholder 继承交互~~ **已收割**（design 已落 PRD §5.1/§5.4 层叠默认链与「留空=继承」口径 + 原型 placeholder 继承交互，见收割状态 F-28 注记）。
- **验证**：后端 `go test ./platform/...` 全绿 + `go vet`（新增 `TestCreateScrapeJobGlobalDefaultFallback` / `TestCreateScrapeJobTemplateFallback` / `TestUpdateScrapeJobClearFieldReInherits` / `TestBatchSubmitReady_ResolvesEmptyScrapeParams` / `TestAssembleRendersScrapeIntervalTimeout`，改写 `TestBatchSubmitReady_ValidateBeforeReady` 失败用例改用 monitor_type）；前端 `pnpm test` 334/335（新增映射删除 / 查看抽屉 / 稀疏提交 / placeholder 继承 4 用例；唯一失败仍为改动前已存在的 `resources.test.ts` jsdom `Response.stream`）、`tsc --noEmit`、`pnpm lint` 通过。
- **影响模块**：M01 采集 Job / 默认采集配置（主）；M09 配置生成器（scrape_interval/timeout 渲染补齐，见 integration/v0.1 issues.md）。
- **发现场景**：用户系统性测试采集器管理 → 默认采集配置 → 采集 Job 动线，质疑参数重复填写与生效一致性。

### F-18：保存草稿时 `network_domain_id` 报必填（F-16 实现缺漏）

- **类别**：② 实现偏差修正
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.4 `network_domain_id` / §11.1 草稿保存；源码 `ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`
- **问题**：F-16 创建抽屉「保存草稿 / 提交生效」双按钮落地后，用户勾选默认网域并点「保存草稿」，前端仍报 `network_domain_id 必填（须为已纳管且非冻结的网域）`。
- **根因**：`Form.Item name="network_domain_id"` 内部同时放置了 `Select` 和提示 `Text` 两个子元素，触发 antd 警告「`Form.Item` with `name` must have a single child element」，导致 `Select` 的值未能正确绑定到 form。无论用户是否点选网域，`network_domain_id` 都为空，后端完整校验分支报错。
- **修复**：
  1. 标准/黑盒两个网域 `Form.Item` 都把提示文本移到 `extra` 属性，保证单个 child；
  2. `handleSaveDraft` 先用 `validateFields(['job_name','job_type'])` 做基础校验，再用 `form.getFieldsValue()` 取全量字段，避免 `validateFields(nameList)` 只返回指定字段导致网域丢失。
- **新增单测**：`ScrapeJobFormDrawer.test.tsx` 新增 `saves a standard job as draft with minimal validation and passes network_domain_id + draft_status`，断言保存草稿时请求体携带 `network_domain_id` 与 `draft_status: 'draft'`。
- **验证**：`pnpm exec vitest run src/pages/strategy/ScrapeJobFormDrawer.test.tsx` 12 用例全部通过；`pnpm tsc --noEmit`、`pnpm lint` 通过。
- **发现场景**：用户前端功能测试保存草稿步骤。

## 2026-08-25（M09 联调：labels 归属层级设计决策 D43）

### F-17：Job 级 labels vs target 级 labels 的设计决策（① 类，已决策，待 PRD / 原型同步）

- **类别**：① PRD 空白判定（产品/设计决策）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.4（ScrapeJob 字段与配置生成）、§9（Prometheus 配置模型）；`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.2/§9.1（targets/*.json 产物）；源码 `platform/configcenter/generator/`、`platform/models/scrape_job.go`
- **问题**：用户在配置 Job 时选择标签模板，但配置预览发现 `targets/*.json` 中 `labels: {}` 未取到标签模板映射值。讨论聚焦到「labels 应挂在 `prometheus.yml` 的 `job_name` 级，还是必须挂在 `targets/*.json` 的 target 级」。
- **分析过程**：
  1. Prometheus 语义：`scrape_configs[].job_name` 下可配置 `static_configs[].labels`（job 级，作用于该 job 全部 target），也可在 `file_sd_config` 指向的 `targets/*.json` 中给每个 target 配独立 `labels`。
  2. 标签模板（M07）定义的是「资源字段 → Prometheus label」的映射规则，其输入来自 CMDB 资源属性；同一 Job 下的不同 target 对应不同资源实例，资源属性可能不同，因此**映射值天然是 per-target**。
  3. 但 UI 当前在 Job 创建时只让用户选一个标签模板，没有逐 target 指定映射值；若直接把模板名挂在 job 级，所有 target 会获得同一组静态 labels，失去 per-instance 差异化能力。
  4. 工程实现：generator 已按 target 级生成 `targets/*.json`，只是尚未把标签模板映射解析到每个 target 的 `labels` 字段（取值来源 = 资源实例的属性字典按模板映射转换）。
- **决策（用户拍板）**：
  - **labels 最终挂在 target 级**（`targets/*.json` 中每个 target 的 `labels`），与 Prometheus file_sd 语义和资源实例级差异化一致；`prometheus.yml` 的 job 级 labels 仅保留系统必要字段（如 `network_domain_id`），不承载标签模板映射。
  - **标签模板与 Job 的绑定关系仍记录在 Job 级**（`ScrapeJob.label_template_id`），配置生成时按该模板把每个 target 对应资源的属性转换为 target 级 labels。
  - 当前预览中 `labels: {}` 为空是**实现缺漏**，不是设计层级错误；由 M01/M09 generator 侧补全标签模板映射解析（不在本次前端/配置废弃回写任务范围内）。
- **待 PRD / 原型同步**：~~1. `Module_01` PRD §5.4 明确 `label_template_id` 为 Job 级引用、labels 落 `targets/*.json` target 级；2. `Module_09` PRD §3.2/§9.1 补 `targets/*.json[].labels` 来源~~ **已收割**（M01 PRD §5.4 `label_template_id` 已注「Job 级引用、labels 落 target 级」；M09 PRD §3.4 已补 target 级 labels 来源说明，决策 D43）；3. 原型侧「每个 target 获得哪些 labels」的 target 预览/详情展示仍待后续评估（不在 Job 创建抽屉主路径）。
- **影响模块**：后端配置生成器（`platform/configcenter/generator/`）、M07 标签模板映射服务
- **发现场景**：M09 配置预览功能测试，用户发现 `targets/default.json` 中 `labels` 为空。
## 2026-08-25（M09 联调：pending 期间 job 锁定，决策 44-1/44-4）

### F-19：「待生效」job 仍可编辑/删除，与变更单状态脱节（② 类，已按决策 44-1/44-4 修正）

- **类别**：② 实现偏差修正 / ① PRD 空白判定
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.4（draft_status / change_status 流转）；源码 `platform/strategy/scrapejob/update.go`、`delete.go`、`ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`
- **问题（联调实测）**：
  1. job 生效状态为「待生效」（`change_status=pending`，变更单未确认）时编辑按钮仍可点击，点击保存报内部错误；
  2. 「待生效」job 可被删除，但配置中心的变更单不联动，成为幽灵单。
- **根因**：M01 的编辑/删除接口未检查 `change_status`；pending 语义（变更单已挂起、等待 M09 确认）没有传导到 M01 的操作约束。
- **结论（用户拍板，决策 44-1/44-4）**：pending 期间禁止编辑/启停/删除 job——变更单挂起期间改动源数据必然导致单实脱节，删除则产生幽灵单；解锁路径只有确认或废弃变更单。
- **实现落库**：
  - 后端 `scrapejob/update.go` / `delete.go`：`change_status=pending` 返回 409 Conflict，文案指引前往配置变更确认页处理；
  - 前端 `ScrapeJobListPage.tsx`：pending 行禁用「编辑 / 启停 Switch / 删除」，Tooltip 说明原因；
  - 单测：`scrapejob/scrape_job_test.go` 新增 `TestUpdateDeletePendingJobRejected`（409 + 数据未被修改/删除）；存量 update/delete 用例种子改为 `change_status=none`；`ScrapeJobListPage.test.tsx` 新增 pending 行禁用断言。
- **是否需设计侧确认**：~~需——M01 PRD §5.4 需补 pending 期间的锁定语义（编辑/删除/启停约束与引导文案）~~ **已收割**（M01 PRD §5.4 已补「pending 期锁定（MVP）」，见收割状态 F-19 注记）；原型 pending 行禁用态已同步（原型 `ScrapeJobsPage` 对 `change_status=pending` 行禁用编辑 / 启停 Switch / 删除并带 Tooltip 引导）。
- **影响模块**：M01 采集 Job 管理（前后端）、M09 变更单联动
- **发现场景**：用户对「job 状态 / 生效状态 / 配置变更单」三者关系与数据流转的联调测试。

## 2026-08-26（M09 联调：target 抓取地址缺端口，决策 46）

### F-20：ScrapeJob 无 port 字段，Host 采集 target 落到 80 端口 / PRD §5.4 端口口径内部冲突（① 类，已决策最小方案）

- **类别**：① PRD 空白 / 内部口径冲突；② 实现偏差
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.4（字段表 386-414 行无 `port` 字段；但 416 行「实际参数覆盖（端口 / 路径 / 协议 / 间隔 / 超时，快照 + 覆盖）」明确端口是 Job 参数覆盖项；`mapping_overrides` 可覆盖字段枚举（406 行）也未含 `port`）；`Module_07` §5.12C（instance 端口取 `CITypeExporterMapping.default_port`）；源码 `platform/configcenter/generator/targets.go`、`platform/models/scrape_job.go`、`ui-custom/web/src/api/scrapeJobs.ts`（`ScrapeJobInput` 无 port）
- **问题（联调实测）**：添加采集 Job 后 Prometheus 抓取报 `Get "http://1.15.94.116/metrics": dial tcp 1.15.94.116:80: connect: connection refused`——target 生成无端口，Prometheus 默认 80；而 node_exporter 实际监听 9100（用户实测可达）。targets JSON 产物为 `["1.15.94.116"]`，`instance` 标签同为无端口。
- **根因**：`resolveResource` 的 Host 分支 `Address = host.PrivateIP` 只取 IP；Database/Middleware 分支虽拼端口但用的是**资源业务端口**（3306/6379），按 PRD §5.12C 应为 exporter 监听端口（9104/9121）。`ScrapeJob` 模型与前端表单均无 `port` 字段，PRD §5.4 内部对「端口是否进 Job 快照」表述冲突（416 行 vs 字段表 / mapping_overrides）。
- **结论（用户拍板，决策 46）**：MVP 先取**生成器层最小方案**——不新增 ScrapeJob.port 字段（PRD §5.4 字段表与 mapping_overrides 口径冲突另行列项，待设计侧统一后再评估 Job 级端口快照），由 M09 生成器解析策略层端口：
  - `LoadExporterPort`：优先 `CITypeExporterMapping.default_port`（monitor_type 默认映射），回落 `ExporterTemplate.default_port`（exporter_template_id）；
  - `resolveResource`：Host/Database/Middleware 抓取地址统一拼接 exporter 端口（Database/Middleware 在 exporter 端口为 0 时回落业务端口）；Application 用健康检查 URL、GenericTarget 用登记服务端口（不变）；
  - `instance` 组合标签随地址自动带端口。
- **实现落库**：`generator/targets.go`（`LoadExporterPort` / `resolveResource` / `ResolveJobTargets` 签名 + 端口拼接）、`generator/data_source.go`（`LoadExporterPort`）、`draft/service.go`（buildArtifacts 传入 exporterPort）；单测 `generator_test.go` 新增 `TestResolveTargetsExporterPort` / `TestLoadExporterPortPriority`，并修正存量 host 断言（`10.0.1.1:9100`）。
- **是否需设计侧确认**：~~需——① PRD M01 §5.4 统一「端口是否进 ScrapeJob 字段 / mapping_overrides」口径~~ **已收割**（PRD §5.4「端口不在 Job 层的理由」已按决策 46 统一：MVP 端口**不进 `ScrapeJob` 快照**、`mapping_overrides` 亦**不含 `port`**，由 M09 生成器按 `CITypeExporterMapping.default_port` → 回落 `ExporterTemplate.default_port` 解析）；② 若确认 Job 级端口快照（v0.2+），补 ScrapeJob.port 字段与前端表单端口输入——仍待 v0.2+ 评估。
- **影响模块**：M01 采集 Job（模型/表单端口字段规划）、M07 §5.12C 契约（已按 default_port 对齐）、M09 配置生成
- **发现场景**：用户对「配置生成 targets 与实例实际 exporter 端口」一致性的联调测试。

## 2026-08-26（user-verify-fix）

### F-21：配置变更清单与产物 diff 不一致（M01 ↔ M09，② 实现偏差，已修正）

- **类别**：② 实现偏差修正
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §8（`enabled=false` 不参与配置生成）；`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.4（变更类型：新增/修改/移除，按产物差异派生）；源码 `platform/configcenter/draft/service.go`、`platform/configcenter/draft/change_items.go`、`ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`
- **问题（用户验收）**：禁用已生效采集 Job 后，配置变更确认页显示「本次配置无变化」，但版本对比 Tab 显示 scrape_config 确实被删除，两者矛盾。
- **根因**：`buildChangeItems` 仅罗列当前仍启用 Job 且全部标「新增」，不做新旧产物 diff；禁用后 Job 被过滤，清单为空 → `buildSummary` 误报「无变化」。
- **结论（PRD 无需改动，实现修正）**：
  - M09 后端：新增 `change_items.go`，按上一生效版本产物与本次产物 diff 派生 add/update/delete；移除已生效 Job 标记 high「监控断点风险」。
  - M01 前端：`ScrapeJobListPage` 启停改为有文字按钮「停用/启用」+ Popconfirm 二次确认（停用提示监控中断影响）。
- **影响模块**：M01 采集 Job 列表交互、M09 变更清单生成。
- **发现场景**：用户禁用 Job 后查看配置变更确认页。

### F-22：规则挂载「保存并下发」后规则状态为停用（② 实现偏差，已修正）

- **类别**：② 实现偏差修正
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.5/§8（规则创建默认启用）；源码 `platform/strategy/rule/create.go`、`ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`
- **问题（用户验收）**：规则挂载抽屉点击「保存并下发」后，规则列表显示「停用」。
- **根因**：前端创建请求漏传 `enabled`；后端 `Enabled` 为非指针 bool，缺省零值 false 落库。
- **结论（PRD 无需改动，实现修正）**：
  - 后端 `Enabled` 改为 `*bool`，缺省默认 `true`；
  - 前端请求显式传 `enabled: true`，按钮文案改为「提交生效」（与 Job 抽屉一致，需 M09 人工确认后下发）。
- **影响模块**：M01 规则管理。
- **发现场景**：用户新增规则后查看列表生效状态。

### F-23：规则编辑列表状态列与启停控件样式偏离原型（① 类，已收割）

- **类别**：① PRD / 原型待修订（UI 对齐采集 Job 列，需 design 更新原型）
- **PRD 章节 / 文件位置**：原型 `docs/prototypes/module-01/src/pages/RulesPage.tsx`（「下发状态」Tooltip 列 L311-315 +「启用状态」Switch 列 L325-330）；生产 `ui-custom/web/src/pages/strategy/RulesPage.tsx`（列与启停控件）
- **问题（用户验收）**：用户要求规则编辑列表按采集 Job UI 显示字段对齐——将「启用状态」「下发状态」两列改为「变更进度」「生效状态」，启停控件由 Switch 改为文字按钮「停用/启用」+ Popconfirm 二次确认。生产已按此对齐（复用采集 Job 的 `CHANGE_PROGRESS_MAP` / `aggregateJobStatus` / 文字按钮模式），与原型不一致。
- **结论（chenrt，2026-08-26）**：生产先按采集 Job 同源同机制落地（F-21 对齐），原型不一致项登记待 design 管道修复。
- **待 design 分支更新原型**：~~1. 原型规则列表删除「下发状态」Tooltip 列与「启用状态」Switch 列；2. 原型改为「变更进度」（无变更 / 待确认 / 已确认待下发 / 已下发）+「生效状态」（草稿 / 已停用 / 待生效 / 已生效）两列；3. 原型操作列启停控件由 Switch 改为文字按钮「停用 / 启用」+ Popconfirm（与采集 Job 一致）~~ **已收割**（design 已更新原型 RulesPage：删除两列、改「变更进度」+「生效状态」两列、启停改文字按钮 + 二次确认，见收割状态 F-23 注记）。
- **影响模块**：M01 规则编辑（前端 RulesPage 已实现对齐，3 用例通过 / tsc / eslint 通过）。
- **发现场景**：用户要求规则编辑 UI 与采集 Job UI 字段、控件对齐。

## 2026-08-26（规则管理增强：按 CI 类型组织 + 合并语义，用户拍板提级）

### F-24：规则按监控对象类型组织 + 多记录合并语义 + 组名全局唯一（① 类 PRD 空白 / ② 类实现补齐，已按用户口径落地）

- **类别**：① PRD 空白判定（多记录如何合并为 rules.yml 未定义）+ ② 实现补齐（v0.2 的 monitor_type 维度提级 MVP，用户拍板）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.5（规则挂载，L532 已明确透传模式 `monitor_type` 可空，但未定义**多条规则记录如何合并为单份 rules.yml**）；源码 `platform/configcenter/generator/render.go`、`platform/strategy/rule/`（validate/create/update/list）、`ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`、`RulesPage.tsx`
- **问题（用户验收 + DeepSeek 分析引出）**：
  1. `renderRules` 原样字符串拼接多条 `rule_content`，每条各带顶层 `groups:` 键 → 拼出**重复顶层键的非法 YAML**，promtool 校验失败、rules.yml 不可用；
  2. 模型已有 `monitor_type` 列（§5.5 透传模式可空），但创建/更新接口不接、列表不筛、前端无入口，用户无法按 CI 类型（资源类别）组织多条规则。
- **结论（用户拍板，方案 A）**：
  1. **合并语义**：`renderRules` 由字符串拼接改为「逐条解析 groups → 节点级（`yaml.Node`）合并为单个 `groups:` 文档」，各 group 内容不重排；
  2. **组名全局唯一**：保存时校验（创建 + 更新路径）——文件内重名 / 空 name 报错；与其他生效规则（`enabled=true AND draft_status=ready`，排除自身）撞名返回 bad_request 并点名占用方；停用规则不下发不校验，停用后组名释放；
  3. **monitor_type 提级 MVP（可空）**：POST/PUT 接收 `monitor_type`（非空时校验 `models.ValidMonitorType`），GET 列表支持 `monitor_type` 筛选；前端挂载抽屉加「资源类别 → 监控对象类型」两级级联（复用 `MONITOR_TYPE_CASCADE`，与 MappingDrawer/ScrapeJobFormDrawer F1-8 同源），列表加「监控对象类型」列与筛选、详情抽屉补一行；
  4. **产物形态不变**：仍是单文件 `rules.yml` + `prometheus.yml` 注入 `rule_files: ["rules.yml"]`；monitor_type 纯组织/筛选维度，不参与渲染；不持久化 `exporter_template_id`（MVP 无指标提示功能）。
- **待 PRD 修订**：~~§5.5 补一句「多条启用规则记录由生成器按 groups 解析合并为单份 rules.yml，组名（group name）全局唯一；同名组请写在同一条规则内容内」；原型规则挂载抽屉补「资源类别 / 监控对象类型」两字段（可空）~~ **已收割**（design 已落 PRD §5.5 多记录合并单份 rules.yml + 组名全局唯一，原型补资源类别/监控对象类型级联字段，见收割状态 F-24 注记）。
- **验证**：后端 `go test ./platform/...` 全绿（generator 合并用例 + rule 包组名唯一 / monitor_type 校验筛选 4 个新用例）+ `go vet` 通过；前端 `RuleMountDrawer` / `RulesPage` 9 用例通过、`pnpm lint`、`tsc --noEmit` 通过（全量 `pnpm test` 仅 `src/api/resources.test.ts` 1 个改动前已存在的 jsdom `Response.stream` 失败）。
- **影响模块**：M01 规则管理（前后端）、M09 配置生成（renderRules 合并语义）。
- **发现场景**：用户询问 `linux_host_alerts` 与 rules.yml 映射关系、能否按 CI 类型维护多条规则；决定把 v0.2 的分类 UI 提级 MVP。

## 2026-08-26（规则编辑 MVP 范围裁定：停用可编辑提级 MVP，规则草稿推迟 v0.3）

### F-25：规则「停用可编辑」MVP 落地，规则草稿（draft_status=draft）推迟至 v0.3（① 类，已决策）

- **类别**：① PRD 空白判定（MVP 范围裁定，用户拍板）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.5（draft_status：「MVP 文件挂载默认 ready…；v0.3 字段化编辑开放『保存草稿』」）；`api-contract-snapshot.md` §18（草稿 draft api / clone / 批量提交 列为 **v0.2 能力、本期范围外**）；源码 `platform/strategy/rule/create.go`、`update.go`、`ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`、`RulesPage.tsx`
- **问题（用户需求 + 范围评估）**：用户希望规则编辑效仿采集 Job——当规则显示「停用」状态时允许再次编辑；并咨询 MVP 阶段是否实现规则「保存草稿」（`draft_status=draft` → ready 批量提交流程）以及其难度/是否属 0.2 提级。
- **结论（chenrt，2026-08-26，用户拍板）**：
  1. **MVP 实现「停用可编辑」**：规则操作列新增「编辑」按钮，复用 `RuleMountDrawer` 编辑模式（回显 + PUT update，**不携带 enabled、不改启停状态**）；编辑可用性 = 除 `change_status=pending`（存在待确认变更单，锁定期）外均可编辑（停用 / 已生效 / 已下发均允许），与采集 Job F-19 / 决策 44-1 锁定语义一致。
  2. **规则草稿功能推迟至 v0.3，不提前实现**：MVP 不做规则「保存草稿 / 批量提交生效」；yaml_passthrough 整文件无「PromQL 半成品」场景，草稿价值绑在 v0.3 字段化编辑；api-contract 已将其列为 v0.2 能力、本期范围外，本次明确不提前。
- **实现落库**：
  - 前端 `RulesPage.tsx`：新增 `openEdit`（置 `editingRule` 并打开抽屉）、操作列「编辑」按钮（pending 禁用 + Tooltip 指引，停用/已生效可编辑）、「挂载规则」重置 `editingRule`、抽屉 onCancel/onSuccess 重置 `editingRule`；
  - 前端 `RuleMountDrawer.tsx`：编辑模式回显（名称 / 资源类别反推 / 监控对象类型 / 内容）并走 `monitoringRuleApi.update`；
  - 单测：`RulesPage.test.tsx` 新增编辑按钮用例（pending 禁用、停用规则可点开抽屉）；`RuleMountDrawer.test.tsx` 新增编辑模式用例（回显 + update 载荷不携带 enabled）；11 用例通过 + tsc + eslint 通过。
- **备注（待设计侧评估，需后续收割）**：采集 Job 的 pending 锁定已含后端 409 兜底（F-19 / 决策 44-1 / 44-4）；规则侧**当前仅前端禁用 pending 编辑，后端 PUT/DELETE 未加 pending 409 兜底**（后端仍允许改 pending 规则）——若确认规则与 Job 同锁语义，需补后端 409 + 对应单测；同时 PRD §5.5 建议补一句「规则 pending 期锁定编辑/启停/删除，同采集 Job」。
- **影响模块**：M01 规则编辑（前端 RulesPage / RuleMountDrawer）。
- **发现场景**：用户对规则编辑 MVP 范围与草稿功能难度的评估讨论。

## 2026-08-26（采集器管理三联问题：来源下拉 / 契约类型 / 动线断点）

### F-26：登记采集器来源下拉与后端限制矛盾 + 新增默认采集配置 400 + 登记后动线断点（② 类实现偏差，已按用户口径修正；① 类 PRD 矛盾已收割）

- **类别**：② 实现偏差修正（1/3 两项）+ ① PRD 内部矛盾登记（第 2 项）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.2（L323 source 枚举 / L334「official / third_party 由平台预置、只读维护」 vs L81 动线「登记采集器（仅自研 / 第三方需要）」**两处口径冲突**）；§5.1 默认采集配置；源码 `ui-custom/web/src/pages/strategy/{ExporterTemplateDrawer,MappingDrawer,CollectorTemplatesTab}.tsx`、`platform/strategy/exporter-template/validate.go`、`platform/strategy/ci-exporter/create.go`
- **问题（用户验收三连）**：
  1. **来源下拉误导**：登记抽屉「来源」下拉提供 官方（内置）/第三方/内部自建 三项，但后端 `validateCreateExporterTemplate` 只放行 `source=internal`（对齐 PRD L334），选前两项必报 400——展示了注定失败的路径；
  2. **新增默认采集配置 400**：`MappingDrawer` 采集器下拉 `Select.Option value={t.id}`（number），提交载荷 `exporter_template_id` 为 JSON number；后端 `CreateCITypeExporterMappingRequest.ExporterTemplateID` 是 string（字符串承载数字 ID + `strconv.ParseUint`）→ `json: cannot unmarshal number`。存量单测 fixture 误用字符串 id（`'exp-1'`）掩盖了该问题；
  3. **登记后动线断点**：模板行「去配置」（F1-5）与登记成功回调均不携带模板上下文——`openConfigureForTemplate()` 无参、`onSuccess={reload}` 丢弃 C1 回调的新模板对象，用户刚登记完还要在「新增默认采集配置」里重选一遍采集器。
- **结论（用户拍板，2026-08-26）**：
  1. 来源下拉**只保留「内部自建」**（对齐 PRD L334 与后端校验），表单 extra 标注「官方/第三方由平台预置、只读维护」；Steps 动线与空态按钮文案同步收敛为「登记内部自建采集器」。用户的「自行登记官方采集器 + 自定义默认端口」诉求不需要放开 official：端口以映射层 `CITypeExporterMapping.default_port` 优先生效（决策 46 `LoadExporterPort`），需要变体时用 `source=internal` 登记（PRD L173「登记即入池、同动线」）；
  2. `MappingDrawer` 下拉 `value={String(t.id)}`，测试 fixture 改数字 id 回归；
  3. 动线补齐：`MappingDrawer` 新增 `initialTemplate` prop（新增态预填采集器 + 模板默认端口/路径/协议——预置参数=官方默认值参考语义）；模板行「去配置」按行预填；登记成功自动打开「新增默认采集配置」并预填刚登记的采集器（复用 C1 回调参数）。
- **待 PRD 修订**：~~§5.2 L81 动线「仅自研 / 第三方需要」与 L334「third_party 平台预置只读」冲突，需设计侧统一为「用户登记仅 internal」~~ **已收割**（design 已统一 PRD §5.2——用户登记仅 `internal`，`official`/`third_party` 平台预置只读维护，见收割状态 F-26 注记）。
- **验证**：`pnpm vitest run`（MappingDrawer/ExporterTemplateDrawer/CollectorTemplatesTab）20 用例通过（新增「数字 id 提交字符串」「initialTemplate 预填」「来源仅内部自建」3 用例）；`pnpm test` 全量 325/326（唯一失败仍为改动前已存在的 `resources.test.ts` jsdom `Response.stream`）；`tsc --noEmit`、`pnpm lint` 通过。
- **影响模块**：M01 采集器管理 / 默认采集配置（纯前端修复；后端校验口径不变）。
- **发现场景**：用户测试登记采集器与新增默认采集配置动线。

## 2026-08-26（采集器管理问答与闭环优化：删除入口 / 类型对齐 / 端口路径语义）

### F-27：采集器管理能力闭环——删除入口、supported_monitor_types 约束、端口/路径分层语义（② 类补齐已落地 + ① 类产品方向待设计侧）

- **类别**：② 实现补齐（A/B/C 已按用户拍板落地）+ ① 产品方向登记（D 待设计侧决策）
- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.1（CITypeExporterMapping）/ §5.2（ExporterTemplate，L323 source 枚举 / L332 预置参数=官方默认值参考 / L334 预置只读）/ §10；源码 `platform/strategy/ci-exporter/`、`platform/strategy/exporter-template/`、`ui-custom/web/src/pages/strategy/{CollectorTemplatesTab,MappingDrawer}.tsx`
- **用户问答结论（已在会话中向用户澄清并获认可）**：
  1. **自建采集器无删除入口** = 纯前端缺口：后端 `DELETE /exporter-templates/:id` 早已实现（软删；内置 forbidden、被映射引用 forbidden），前端模板行只放了「去配置」；
  2. **`supported_monitor_types` 与映射不对齐的后果** = 此前该字段仅作预填/展示，无任何过滤与校验 → 可把「声明支持 MySQL」的模板绑到 Redis 默认配置，不报错但元数据失真（约束未闭环）；
  3. **登记时类型非必填 vs 默认配置必填** = 实体语义分层：ExporterTemplate 是「采集实现」（一个实现可支持多类型，允许先登记后绑定）；CITypeExporterMapping 是「类型 ↔ 默认实现」绑定，monitor_type 是主键维度必填——PRD 口径合理，不改；
  4. **监控对象类型不可手填** = monitor_type 是闭环枚举（`models/monitor_type.go` 9 项），驱动实例候选收敛（DeriveResourceFilter）/ 指标库分组 / 标签模板过滤；用户自带采集器（如 Spring Boot）归 `application_http`（PRD L594 免安装确认）。「自定义监控对象类型元管理」未设计，属 v0.2+；
  5. **登记端口 vs 默认采集配置端口** = 分层语义（模板=官方默认值参考 L332；映射=实际生效，决策 46 `LoadExporterPort` 映射层优先），F-26 起映射抽屉已从模板预填，默认一致、允许按环境覆盖——用户「应保持一致」的诉求即「默认一致」，已满足；路径（metrics_path）同构。
- **已落地优化（用户拍板 A+B+C）**：
  - **A（前端）**：模板行新增「删除」按钮（Popconfirm 二次确认；仅非内置显示，内置/被引用由后端 forbidden 兜底）；
  - **B（前端）**：MappingDrawer 采集器下拉按 `supported_monitor_types` 对齐所选 monitor_type（未标注的模板放行；已选中模板始终保留避免回显裸 ID；编辑态不过滤；空态引导「先登记采集器」）；
  - **C（后端）**：建/改映射校验——采集器 `supported_monitor_types` 非空且不含所选 `monitor_type` 时 bad_request（`ensureExporterSupportsType`；update 路径按最终生效值校验；`verifyExporter` 重构为 `loadExporterByID`）。
- **D（产品方向，待设计侧决策）**：用户提出——① 开放 `source=official/third_party` 用户登记（自定义端口变体不再借道 internal）；② 待「监控对象类型映射关系管理」功能设计落地后，平台预置采集器降级为初始数据（seed 写入、用户可改可删，`is_builtin` 从只读锁降级为来源标记）。本轮未动，登记待 design 分支修订 PRD §5.2。
- **验证**：后端 `go test ./platform/...` 全绿 + `go vet`（新增 `TestMappingExporterSupportTypeGuard`）；前端 `pnpm test` 327/328（新增删除入口、下拉过滤 2 用例；唯一失败仍为改动前已存在的 `resources.test.ts` jsdom `Response.stream`）、`tsc --noEmit`、`pnpm lint` 通过。
- **影响模块**：M01 采集器管理 / 默认采集配置。
- **发现场景**：用户系统性测试采集器管理功能并追问设计意图。

### F-29：登记采集器 internal error——软删残留占用 name 唯一索引（② 类实现偏差，已修复）

- **类别**：② 实现偏差（软删残留导致唯一索引冲突 500），已修复
- **PRD 章节 / 文件位置**：源码 `platform/strategy/exporter-template/{create,delete}.go`、`platform/strategy/exporter-template/exporter_template_test.go`；前端 `ui-custom/web/src/pages/strategy/ExporterTemplateDrawer.tsx`
- **问题**：登记采集器点击保存返回「登记失败 internal error」（500）。根因：采集器删除走软删（`deleted_at`），name 唯一索引仍被软删行占用；GORM 默认作用域（`deleted_at IS NULL`）查询不到软删行，导致同名重建时 INSERT 命中 DB 唯一约束，抛 500。
- **修复**：`create.go` 重复检查改 `Unscoped()` 连软删行一起查——仅软删残留时先物理清理旧行释放索引，再允许重建同名采集器；活跃同名仍返回 409 Conflict。与 scrapejob 软删重建行为对齐。
- **验证**：新增回归测试 `TestCreateExporterTemplateRecreateAfterSoftDelete`（软删→重建同名 200 成功→再建活跃同名 409）；`go test ./platform/...` 全绿；重新编译 metric-center 后登记功能恢复正常。
- **影响模块**：M01 采集器管理 / 登记采集器。
- **发现场景**：用户实测「删除采集器后重新登记同名」点击保存报 internal error。
- **状态**：closed（修复已合入源码，待重启 metric-center 生效）

### F-30：默认采集配置列表「端口/路径/协议」列渲染优先级反了——mapping 覆盖值被 template 遮蔽（② 类实现偏差，已修复）

- **类别**：② 实现偏差（列渲染逻辑优先级错误），已修复
- **PRD 章节 / 文件位置**：前端 `ui-custom/web/src/pages/strategy/CollectorTemplatesTab.tsx`（`default_port`/`metrics_path`/`scheme` 列 render）
- **问题**：用户在默认采集配置（MappingDrawer）编辑端口后界面提示「已更新」，但列表仍显示采集器登记时的原始端口。根因：三列的 render 对 mapping 行优先取 `template.default_port`，template 存在时 mapping 自身的覆盖值被完全遮蔽，用户永远看不到 mapping 实际生效的参数。
- **修复**：将三列优先级修正为「mapping 覆盖优先，无覆盖值才回落 template 继承」——`default_port`：mapping 值 > 0 时显示，否则回落 template；`metrics_path`/`scheme`：mapping 非空时显示，否则回落 template。与 F-28 稀疏覆盖语义一致。
- **验证**：`vitest run CollectorTemplatesTab.test.tsx` 14/14 通过；`tsc --noEmit`、`eslint` 通过。
- **影响模块**：M01 采集器管理 / 默认采集配置列表展示。
- **发现场景**：用户编辑默认采集配置端口后列表不刷新。
- **状态**：closed（前端修复已落地，需前端 dev server 刷新生效）
