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

## 收割状态
- [ ] F-01 已收割（chenrt 修订 PRD §5.6 / §6.2.5）
- [ ] F-02 已收割（chenrt 修订 PRD §5.4 / §9）
- [ ] F-03 已登记（MVP 功能裁剪，`mapping_overrides` 不持久化）
- [ ] F-04 已登记（契约偏差，新建场景退化为本地预检）
- [ ] F-05 已登记（M09 未落地，跳转占位）
- [ ] F-06 已登记（NetworkDomain.token 回显，M06/M09 跟进）
- [ ] F-07 已裁决（编辑态网域按契约放开，T01-F11 落地）
- [ ] F-11 未收割（chenrt 修订 PRD §5.1/§6.2.1：编辑抽屉剥离标签模板字段，更换/补配轻量抽屉为唯一入口；同步原型动线）
- [ ] F-12 已对齐 PRD L228/L229/L240（实现完整，供 PM 复核与原型动线校验；跨模块跳转未落地统一导航配置为既有债务）