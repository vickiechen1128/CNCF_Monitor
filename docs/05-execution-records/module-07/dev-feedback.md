# Module 07 监控对象管理 — 开发侧反馈记录

> 本文记录 M07 开发阶段（feat/module-07-resource-management）发现的 PRD/原型空白、契约缺口与技术决策，
> 供产品/设计侧收割。依据项目约定：开发发现 PRD/原型空白或纯技术优化问题时须在此记录，PR 描述中附本链接。

| 字段 | 值 |
| --- | --- |
| 模块 | Module 07：监控对象管理 |
| 分支 | feat/module-07-resource-management |
| 记录时间 | 2026-08-22（reviewer 双审 + 修复循环后） |
| PRD 版本 | v2.21 |

> **设计侧回改（2026-08-26）**：F-1、F-2、§7、§9 四项需产品/设计确认的开放性口均已由设计侧收割并落档（`docs/05-execution-records/module-07/design-decisions.md` 决策 3.53/3.54/3.55），PRD 与原型已同步更新（**版本号不变**：PRD v2.21、原型 v2.8）。详见各条「⑤ 设计侧回改」标注。
>
> **设计侧回改（2026-08-28，integration 收割）**：联调问题 `docs/05-execution-records/integration/v0.1/issues.md` #9「labels 归属层级决策：挂 target 级（决策 D43）」同步到 M07 PRD §5.15 机制 A——标签模板映射产出自 M09 生成配置时按 `label_template_id` 转换为 **target 级 labels**（`targets/*.json` 每个 target 的 `labels`，Job 级仅保留系统字段），修正原「写入 `static_configs[].labels`」表述与 PRD §5.12 A「target 级 tenant 标签」及 M09 口径的一致性（**版本号不变**：PRD v2.21）。原型无对应展示改动（契约在 M09 配置产物层，同模块 UI 不变）。同批 #8 决策 45-4「M07 源数据静态校验」属 M07 独立任务立项（详见设计决策 45-4），PRD 契约暂不改动，落本节「遗留风险」追踪。

---

## 1. 需产品/设计确认（PRD 内部矛盾）

### F-1. PRD §5.2 与 §5.16.1 对 application 的 `app_name` 必填口径矛盾

- **矛盾点**：§5.2 将 `app_name` 标为 ✅*（application/database/middleware 必填）；§5.16.1 又明确「`app_name` 可留空（默认取 `service_name`）」。
- **实现取舍**：后端按严格必填口径实现（create/import 的 `validateApplication` 要求 app_name 必填），未实现「空则缺省取 service_name」逻辑；前端 `ResourceFormDrawer` 也未对 application 做差异化必填（五类统一可选）。
- **建议**：产品确认唯一口径后，后端补「缺省取 service_name」或前端按类型加差异化必填，并在 design-decisions.md 记录取舍。
- **⑤ 设计侧回改（2026-08-26）**：✅ **已闭环**——用户拍板**严格必填口径**（decision 3.54）：application/database/middleware 的 `app_name` 一律必填，删除「留空默认取 service_name / 可留空」表述（PRD §5.2/§5.16.1 已改）；后端严格必填实现保持不变，前端无需补缺省逻辑。

### F-2. PRD §6 与 03_API_Standard / L3 路由前缀不一致

- **矛盾点**：PRD 写 `/api/v1/resources`、`/api/v1/resources/import-templates/{category}`、`/api/v1/resources/import`、`/api/v1/business-domains`；实现按 03_API_Standard §1.2 与 L3 契约使用 `/api/v2/platform/resources`、`/resources/:type/template`、`/resources/:type/import`、`/api/v2/platform/business-domains`。
- **建议**：更新 PRD §6 路由清单为 v2 前缀（或追加 design-decision 说明以 API 标准为准），避免 M01/M09 对接时按 PRD 取路径。
- **⑤ 设计侧回改（2026-08-26）**：✅ **已闭环**——PRD §6 全量路由前缀 `v1→v2` 统一为 `/api/v2/platform/*`（decision 3.55），章节头注指向 03_API_Standard §1.2；`business-domains` / `label-templates` / `imports` / `scrape-jobs` 引用同步更新。

### F-4. 导入动线：「下载模板」与「Excel 导入」两个按钮打开同一弹窗，模板引导缺失（决策 92/96/97 相关）

- **现状**：`ResourcesPage` 工具栏「下载模板」「Excel 导入」两按钮均调用 `openImportModal()`，打开同一个 `ImportModal`（模板下载 + 上传 + 模式选择 + 结果展示一体化）；原型则是**独立「下载模板」Modal**（模板列清单表格 + 取值说明 sheet 说明）与**独立导入弹窗**两条动线。
- **用户痛点（平台侧）**：模板会持续演进（业务/应用两维字段、声明 sheet 等新契约靠模板告知用户），但用户新增时往往沿用旧模板直接填内容——旧模板缺字段 → 导入报错且用户不知道原因。因此「下载模板」动线必须**独立、醒目、带明确提示**，让用户意识到要下载最新模板。
- **用户建议**：拆分两条动线——「下载模板」直接下载最新模板并展示列清单/更新提示；「Excel 导入」专注上传导入。
- **⑤ 用户拍板（2026-09-19）**：按上述建议拆分，**第一轮**仅前端拆分弹窗/列名表/Alert（commit f883755，表面工程未治本）；**第二轮**用户评审确认：模板取值说明缺 `app_code` 实时字典、前端展示技术列名而非合法值、文案是设计黑话——完整治本方案见 **F-7**。

### F-5. 导入弹窗灰色释义无引导作用（对齐原型结构化表述）

- **现状**：`ImportModal` 内说明均为 `Text type="secondary"` 纯灰字（模板说明、上传提示等），视觉权重低，用户不会逐条阅读；原型的「下载模板」Modal 用**表格**（列顺序/列名）加 `strong` 关键句，信息结构化、可扫读。
- **用户建议**：下载模板区改为结构化引导——关键说明用 `strong` 前置、列清单用表格展示、模板演进提示用 Alert 醒目。
- **⑤ 用户拍板（2026-09-19）**：对齐原型结构化表述，**第一轮**仅灰字→strong 层级（commit f883755，未解决「灰色释义无指引」）；**第二轮**治本方案见 **F-7**（用户语言重写 + 当前字典可选值直显）。

### F-6. 主机 Tab「应用 / 环境 / 集群」组合列与「应用」列重复（决策 92/96）

- **现状**：host Tab 存在两处 app 信息——`app_env_cluster` 组合列（`app_code` + `env` + `cluster` 三个 Tag，ResourcesPage L431-441）与独立 `appColumn`（L444）重复展示 `app_code`。
- **用户建议**：全部拆分——组合列拆为独立的「环境」「集群」列（应用信息由独立 `appColumn` 承载），消除重复。
- **⑤ 用户拍板（2026-09-19）**：拆分组合列，开发已执行（见 §6 F-6 实现记录）。

### F-7. 模板「字典值告知」缺失 + 导入引导不闭环（治本方案，决策 92/96/97）

- **根因（代码证据）**：
  1. 后端 `platform/config/resource/template.go` `buildValueSheet`（L96-135）实时注入 `network_domain` / `biz_code`（业务字典）/ `env` / `status` / `custom_labels`，**唯独没有 `app_code`（应用字典）**——函数签名只有 `bizStore`、无 `appStore`。决策 92/96 引入应用维度后模板未同步，用户下载的模板「应用列能填什么」无处可查，这正是旧模板报错+用户无感知的深层原因。
  2. 前端 `TemplateDownloadModal.tsx`（F-4 产物）展示的是**技术列名清单**（`os_type` / `biz_code`…），用户要的是「每列能填什么值」——列名表是开发视角，不是填表人视角。
  3. 文案含「决策 97」「取值说明 sheet」「固定列模板」等设计/技术黑话，无引导作用。
- **用户拍板方案（2026-09-19，Orchestrator 落档）**：
  - **① 治本（后端）**：`buildValueSheet` 增加 `appStore` 注入，`app_code` 行与 `biz_code` 同构——列出应用字典全部**启用**条目 `code（名称）`，业务/应用两维既有字典都在模板内实时告知。
  - **② 直显（前端）**：模板弹窗直接展示「当前业务/应用可选值」——复用 ResourcesPage 已加载的 `businessDomains` / `applicationDomains` state，用户肉眼可见现在能填的字典值；技术列名表降级/删除。
  - **③ 用户语言（前端）**：弹窗文案改用户语汇（「主机名/IP/端口」而非 `os_type`），回答三问：怎么填 / 每列能填什么 / 为什么必须下最新；删除所有黑话。
  - **④ 兜底（后端+前端）**：导入报「业务/应用未登记」时，reason 补「若你用旧模板可能缺最新字典值，请重新下载模板」，与「去字典页登记 / 声明 sheet 补充」并列三条路径。
  - **⑤ 可选（前端）**：下载文件名加日期 `host_template_20260919.xlsx`，旧文件一眼识破。
- **⑤ 用户拍板（2026-09-19）**：按 ①②③④ 落地（⑤ 一并做），见 §6 F-7 实现记录。

### F-8. 导入弹窗黑话残留 + 列表列排序/命名（决策 92/96）

- **背景（用户实测 2026-09-19）**：F-7 治本后，用户继续发现三处问题：
  1. **Excel 导入弹窗黑话残留**：`ImportModal.tsx`「1. 下载模板」下 L192「模板由后端生成静态 xlsx，内置「取值说明 sheet」列出网域/业务/环境/状态等列的合法值清单」、L195「资源导入文件可内含「业务声明」/「应用声明」sheet…（决策 97）」——F-7 前端 agent 漏改，含「取值说明 sheet」「决策 97」等技术黑话；且该整块与**外层独立「下载模板」弹窗**内容完全重复（顶部 Alert 也重复了「状态中文取值」「先下载模板」两条）。
  2. **多余动线**：外层已有「下载模板」按钮，Excel 导入弹窗内无需再放下载模板块——导入校验基于上传 xlsx 的**列头+字段+字典**，与「是否点过下载」动作无关，下载模板是引导而非硬前置。
  3. **列表列排序/命名**：五类 Tab 列未按「技术/业务归属/运维状态」分组，`sourceColumn` 列头「来源」语义模糊（实为 source_type 录入方式），`businessColumn`/`appColumn` 列头「业务」「应用」未体现「名称」维度；application Tab 的 `service_name`（「服务名」）与归属维度「应用」列语义易混。
- **用户拍板方案（2026-09-19）**：
  - **导入弹窗（F-8-a）**：删「1. 下载模板」整块（含两处黑话 + 旧模板提示 + 下载按钮）；顶部 Alert 精简为 1 条（仅「导入按行增量更新、不删资源，批量下线把状态改『已停止』」）；上传区下加次级文字链接「没有模板？下载当前类型模板」直接触发下载（不嵌套弹窗）；「导入模式」文案中性化。
  - **列优化（F-8-b）**：五类 Tab 列统一分组为「标识/技术 → 业务归属（网域/业务/应用）→ 运维状态（运行状态/采集状态/**录入方式**）→ 操作」；`sourceColumn` 列头「来源」改「录入方式」并移到采集状态之后；`businessColumn` 列头改「业务名称」、`appColumn` 列头改「应用名称」。
  - **命名澄清（F-8-c）**：`appColumn` 加 tooltip「该资源归属的应用字典条目」；application Tab 「服务名」列加 tooltip「本应用资源实例的服务标识」（前端 tooltip 澄清，不改术语，避免触及决策 92/96 术语契约）。
  - **app_code dataIndex 澄清（不需改代码）**：`appColumn.dataIndex='app_code'` 是 AntD Table 的**取值键**（资源表存的归属是 app_code 外键），真正显示由 `render` 决定——`render` 已用 `resolveAppName(value)` 解析为 **app_name 展示**（字典未匹配才回退 code）。故屏幕显示已是名称，dataIndex 不可改 `app_name`（后端列表无该字段）。
- **⑤ 用户拍板（2026-09-19）**：按上述落地，见 §6 F-8 实现记录。

### F-9. 导入模式「仅新增 / 新增或更新」文案含黑话「判重键」，用户无法判断场景

- **背景（用户实测 2026-09-19）**：`ImportModal.tsx` 导入模式区（`MODE_OPTIONS`，§6.1 / §5.16.2）hint 文案：
  - 仅新增：「遇到已存在的数据（按**判重键**）则该行失败，不写入」
  - 新增或更新：「按**判重键**定位已有资源并覆盖更新」
  用户反馈：**「判重键」是技术黑话**——判重键即「IP / 服务名 / 地址:端口」等唯一标识组合（host=`网域+IP`；database/middleware=`网域+IP+端口`；application=`网域+服务名+地址:端口`；generic_target=`网域+IP+端口`，见 `DedupKey` validate.go L368），但用户无感；且 hint 只描述机制（命中→失败/覆盖），未描述**场景意图**（保守建档 vs 以文件为准刷新），「仅新增」与「新增或更新」对运维字面近乎同义，无法判断何时选哪个。
- **用户拍板方案（2026-09-19）**：导入模式区改**场景化文案 + 人话点题**：
  - 顶部点题句：「导入时，文件里已有的资源（按 IP / 服务名等唯一标识识别）怎么处理？」
  - 仅新增 hint → 「已存在的行会报错跳过，不会改动现有数据（适合首次批量建档）」
  - 新增或更新 hint → 「已存在的行会用文件内容覆盖更新（适合整体刷新）」
  - **标签保留**「仅新增 / 新增或更新」（与后端 mode 枚举 create_only / upsert 对应，不破坏 §6.1 契约）；**默认值保持 create_only**；删除「判重键」字样（代码注释可保留技术说明）。
- **⑤ 用户拍板（2026-09-19）**：按上述落地，见 §6 F-9 实现记录。

### F-10. M05 首页 L2 应用明细「业务域」列恒为 `-`：后端 by_app 未聚合 biz 维度（决策 92/93/95）

- **背景（M05-M07 跨模块依赖核查，2026-09-19）**：M05 首页 L2 应用明细表 [AppDetailTable.tsx:139-142](ui-custom/web/src/pages/home/AppDetailTable.tsx#L139-L142)「业务域」列恒渲染 `-`，注释「by_app 暂无 biz_code（后端待补）」。核查 PRD 权威口径：`Module_05_Custom_UI.md` v1.8 §5.1 定义 `by_app` 每项含 `app_code / app_name / biz_code / resource_count / monitored_count / coverage_rate`；原型 `DashboardPage.tsx` L2 列 `{ title: '业务域', dataIndex: 'bizName' }`；决策 93「biz_code 空计为未归类业务」由 M05 侧按资源 biz_code 空值消费。即 **by_app 的 biz 维度是 PRD/原型既定契约，后端一直欠账**（M07 完成业务/应用正交两维建模后具备补聚合条件）。
- **实现方案（2026-09-19 用户拍板）**：
  - **后端 `platform/dashboard/summary.go`**：`AppSummary` 增 `biz_code / biz_name` 字段；`appAgg` 增 biz 归属计数（按 `GetResourceField(res,"biz_code")` 累加，决策 92 收敛口径），组装 by_app 时取该应用下资源**占多数的 biz_code**（多数归因，空值不参与计数）为行业务域，`biz_name` join 业务字典（复用 summary 已加载的字典 map，缺失回落 `biz_code`）；同步 `summary_test.go` 断言。
  - **前端**：`api/dashboard.ts` `AppSummary` 补 `biz_code / biz_name`；`AppDetailTable.tsx` AppRow 增 biz 字段、「业务域」列渲染 `biz_name`（空显 `-`）；HomePage mock 与测试同步补 biz 字段。
- **⑤ 用户拍板（2026-09-19）**：按上述落地，见 §6 F-10 实现记录。

### F-3. PRD §5.2 `status`（运行状态）必填口径与前端实现不符

- **矛盾点**：PRD §5.2 将 `status` 标为 ✅ 必填（枚举 `online/offline/maintenance/orphan`，UI 展示名「运行状态」），§8.1 状态机要求资源有明确状态；前端 `ResourceFormDrawer` 共享字段 `status` 无 required 规则、`initialValue="online"`，新增态不选则默认 `online`，与「必填」口径不符。
- **实现现状**：新增/编辑表单 `status` 为可选项并预填 `online`；提交时未选回退 `'online'`（`buildCreateInput` 内 `|| 'online'`）；`app_name` 经核对为 ✅* 可空口径一致（generic_target 可空、空值不注入 `app` 标签），无问题。
- **处理结论（2026-09-17 已闭环）**：按 PRD §5.2 必填口径落地——前端「运行状态」改为**必填、不预填默认值、强制用户显式选择**：`ResourceFormDrawer` 移除 `initialValue="online"` 与 create 初始化预填 `status`，新增必填 rule，`buildCreateInput`/`buildUpdateInput` 移除 `|| 'online'` 兜底；后端 `validateCommon` 本就强制 status 必填 + 枚举，无需改动。前端单测由原默认 `online` 改为显式选择覆盖。

## 2. 已修复（reviewer 意见闭环）

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| R-1 | 导入记录状态类型缺失 `failed` 枚举（后端 `ImportStatusFailed` 存在但前端类型/展示/筛选缺失） | 前端 `ImportRecord.status` 补 `'failed'`，`STATUS_CONFIG` 补「失败（红）」，筛选下拉补选项 |
| R-2 | 资源详情 Drawer 宽 680 < 前端标准 §8（≥720） | 改为 720 |
| R-3 | 导入记录面板内点「下载模板/上传」→ 弹窗嵌套弹窗（违反 §8） | `openImportModal` 同步关闭 `recordsOpen` |
| R-4 | 上传 accept 含 `.xls/.csv`，后端仅 excelize 解析 xlsx，上传将报错 | accept 收窄为 `.xlsx`，文案注明暂不支持 xls/csv |
| R-5 | Excel 导入文件无大小限制，恶意超大 xlsx 内存耗尽 | 后端限制 ≤10MB（`maxImportFileSize`），超限 bad_request + 单测 |
| R-6 | 导入响应全成功时 `errors: null` 而非 `[]`（§7.2 空数组约定） | 后端规范化为空数组（响应 + 落库） |
| R-7 | PUT 更新注释「可空字段无输入时保留原值」与全量替换实际语义冲突 | 修正注释：明确 PUT 为整体替换语义、请求须携带全量可更新字段 |

## 3. 已验证契约（reviewer 关切的 HIGH 项已闭环）

### C-1. 映射 `mapping_id` 语义（前端 H-1）

- **关切**：前端以「渲染列表 globalIndex+1」充当 `mapping_id`，L3 未书面定义。
- **验证结论**：后端 `platform/config/label/mappings.go` 已明确「mapping_id 采用 1-based 数组位置」（`parseMappingID` + 单测覆盖编辑/删除/越界），与前端 `globalIndex + 1` 一致；变更后前端均重新拉取模板，无错位风险。契约已闭环，无需改动。

## 4. 已知裁剪 / MVP 近似（已注释声明，留待后续阶段）

| 编号 | 项 | 说明 |
| --- | --- | --- |
| K-1 | 资源列表「业务/运行状态」筛选为前端当前页过滤 | ~~后端列表接口仅支持 `network_domain_id`/`keyword`/`is_monitored`；PRD §11.1 要求服务端筛选。>50 条数据会漏筛。建议后端补 `biz_code/status` 查询参数~~ ✅ 已解决：后端 `ListFilter` 已补 `biz_code`/`status` 等值筛选（query.go），单测 + e2e 冒烟覆盖（TestListResourcesBizCodeStatusFilter / TestEndToEndSmoke） |
| K-2 | 标签模板「关联实例」Tab 搜索/状态筛选为前端当前页过滤 | ~~同 K-1，PRD §11.1/§3.2 要求关键字搜索+状态筛选。建议 T07-17 后端补 `keyword/status` 参数~~ ✅ 已解决：`ListTemplateResources` 已补 `keyword`（展示名模糊）/`status`（等值）服务端筛选（instances.go），单测 + e2e 冒烟覆盖（TestListTemplateResourcesKeywordStatusFilter / TestEndToEndSmoke） |
| K-3 | `parseEnvelope`/`toApiError` 与 `client.ts` 信封解析重复实现 | 二进制/multipart 走原生 fetch 必要，但信封/错误解析建议下沉 client.ts 复用，避免契约变更双处漂移 |
| K-4 | 资源类别/状态/来源展示名字典散点重复（6+ 处） | 建议抽到 `src/constants/resource.ts` 单点导出 |
| K-5 | 列表主标识列未 `fixed: 'left'`（操作列已 fixed right） | §9 建议主标识列固定，样式增强项 |
| K-6 | cmdb 来源 key 冲突实时提示（§3.3/§5.3）未实现 | cmdb 来源 MVP 仅占位无数据源，风险低；v0.4+ 前补 |

## 5. 遗留风险（非阻塞，建议记录）

| 编号 | 项 | 说明 |
| --- | --- | --- |
| L-1 | 模板变更主操作与快照写入非事务 | ✅ 已解决：全部 7 处调用点（create/update/delete/clone/mappings×3）已用 `db.Transaction` 包裹，快照失败回滚主操作；回滚单测 TestCreateLabelTemplateRollbackOnSnapshotFailure |
| L-2 | `LabelTemplate.description` 静默丢弃 | ✅ **已闭环**——PRD v2.27 / §6.6.3 明确 `description` 创建/更新必须落库，不再静默丢弃；后端需补模型落库（若尚未实现） |
| L-3 | 并发重复标签竞态 | ✅ 已解决：`ResourceLabel` 已加 `(resource_id, key, source)` 唯一索引（resource_label.go），并发直插兜底；单测 TestResourceLabelUniqueIndex |
| L-4 | `connection_string`/`os_version` 无 API 维护入口 | PRD §5.6/§5.7 契约字段模型存在但 `ResourceInput` 未暴露；MVP 接受，需确认产品口径 |
| L-5 | Host 模型 legacy 字段依赖字段映射 helper 归一化 | ✅ 已由 e2e 冒烟覆盖：`TestEndToEndSmoke` 经真实路由验证 `private_ip`/`image`/`env_flag`/`sub_app_code`/`app_code` → 前端规范字段名闭环 |
| L-6 | 分页默认值两套口径 | 资源/模板 50（T07-03）、导入记录 20（API 标准），前端已按各自契约取值 |
| L-7 | 端到端联调冒烟未做 | ✅ 已补：`TestEndToEndSmoke` 串联资源创建（legacy 归一化）、列表 biz_code/status 筛选、标签模板实例 keyword/status 筛选关键链路 |
| L-8 | M07 源数据静态校验立项（integration #8 决策 45-4） | 联调发现配置中心需校验 M07 源数据可采集性（资源字段合法性），已立项为 **M07 独立任务**（详见 design-decisions 决策 45-4）；PRD 契约本轮不改，后续按任务落地时评估是否补 §9.2 技术验收 |

## 6. 新增单测

- 后端：
  - `TestImportResource_OversizedFileRejected`（10MB 上限拒绝，R-5）。
  - `TestListResourcesBizCodeStatusFilter`（资源列表 biz_code/status 服务端筛选，K-1）。
  - `TestListTemplateResourcesKeywordStatusFilter`（标签模板实例 keyword/status 筛选，K-2）。
  - `TestCreateLabelTemplateRollbackOnSnapshotFailure`（快照失败回滚模板创建，L-1）。
  - `TestResourceLabelUniqueIndex`（(resource_id,key,source) 唯一索引，L-3）。
  - `TestEndToEndSmoke`（端到端冒烟：legacy 归一化 + 服务端筛选关键链路，L-5/L-7）。

---

## 7. PRD 不完善：host 的 `os_type` 标注非必填与采集实例定位依赖矛盾（已实施前后端必填）

> 触发：M07 测试发现「主机资源操作系统未填时，采集 Job 中选不到对应实例」。经对标 PRD 判定为 **PRD 标注不完善**，非执行失误。

- **PRD 章节**：Module_07 §5.6 字段表 `os_type` 标 **❌ 非必填**（L258）。
- **矛盾点**：采集实例定位**强依赖 os_type**——`platform/models/monitor_type.go` 将 host 的 `linux`/`windows` 监控类型推导为 `os_type` + `OSKeywords`，`platform/strategy/scrapejob/selection.go` 按 `image`（os_type legacy 列）关键词过滤实例候选。**os_type 为空的实例既 `linux` 也不 `windows`，被直接排除出候选 → 所选主机在采集 Job 中选不到**。
- **现状**：前端 `ResourceFormDrawer`（操作系统 Input）、后端 `validateHost` 均按 PRD 非必填实现（遵 PRD），证实是 PRD 口径问题。
- **已实施修复（开发侧）**：
  - 后端 `validateHost` 增加 `os_type 必填`；
  - 前端 host 表单「操作系统」增加 required 校验（placeholder 去除「（可选）」）。
- **请求结论**：请设计侧将 Module_07 §5.6 `os_type` 标注改为 **✅ 必填（host）**，并同步 M07 excel/monitor_type 相关描述。
- **⑤ 设计侧回改（2026-08-26）**：✅ **已闭环**——PRD §5.6 `os_type` 改 `✅` 必填（§5.2 基础字段改 `✅*` 差异化必填），并同步 excel/monitor_type 采集候选口径（decision 3.53）。

## 8. 待复现：资源（host）编辑仅回填「运行状态」，其余字段为空

> 触发：M07 测试，host 资源点「编辑」，抽屉**只有「运行状态」回填，其他字段（实例名/IP/操作系统/业务等）均未回显**。

- **代码层证据**：① 后端 `list.go buildListItem` 对 host 返回 `instance_name/hostname/instance_ip/os_type` 等全部字段（标准名）；② `TestEndToEndSmoke` 经真实 API 断言 create→list 后 os_type/instance_name/env/app_name/cluster 全部归一化读回有值；③ 前端 `ResourceFormDrawer` 编辑态 `recordToFormValues` 覆盖全字段 + `setFieldsValue` 回填，单测断言 instance_name/instance_ip 回显通过。故「仅回填 status」在完整 record 下前置不成立。
- **疑点聚焦**：`status` Form.Item 是唯一带 `initialValue="online"` 的字段（L376）。在 `form.resetFields()` 后，未注册/未 set 到的字段会落空，仅 status 由 initialValue 兜底为 "online"，与现象吻合 —— **指向真实 `record` 数据中其余字段为空**（如该 host 行经某入口创建/导入时未写差异化与共享业务字段），或极少数前端异步 race。
- **状态**：**待复现数据**。请提供该主机行的真实字段值（或允许用真实 DB 复现），以确定是「该行数据缺字段」还是「前端渲染缺陷」，再决定修复。**(2026-08-24 更新：用户复测问题已解决，无需继续。)**

## 9. PRD 补建议：操作系统改为「内置字典 + AutoComplete 下拉」而非自由文本

> 触发：用户反馈「操作系统填自由文本（如拼写错误的 `ubutund`）时，采集 Job 选 Linux 主机找不到对应实例」→ 结论需在采集端建立稳定匹配口径，故做内置字典。

- **原设计**：`os_type` 为自由文本 Input（§7 已修必填，但仍允许任意输入）。采集 Job 候选筛选靠 `monitor_type.go` 的 `OSKeywords` 做脆性 LOWER LIKE 匹配，**拼错或填带版本全名即匹配不到**，用户无法稳定把主机归入 `host_linux`/`host_windows` 候选。
- **已落地（开发侧，单一权威字典）**：
  - 后端 `platform/models/os_dict.go`：内置字典 `规范名 → 家族`（Ubuntu/CentOS/RedHat/openEuler/Kylin/AIX/Solaris…→linux；Windows Server 2016~2022/Windows 10/11…→windows）；
  - `NormalizeOSType`：精确名 → 前缀+版本归一（"ubuntu 22.04 LTS"→"Ubuntu"）→ 家族 token 回落（含 linux/unix/windows 的非字典值→"Linux"/"Windows"）→ 否则保留自定义；
  - `monitor_type.go` host 候选关键字改为字典动态推导 `OSKeywordsForLinux/Windows()`，替代硬编码 `OSKeywords`；
  - 配置接口 `GET /api/v2/platform/os-options`（`platform/config/resource/os_options.go`）；
  - 前端 host 表单「操作系统」改用 antd AutoComplete 下拉选择（可搜索、可自定义），写入后端归一化。
- **口径边界**：纯拼写错误且不含任何家族关键字（如 `ubutund`）无法自动映射——这正是用下拉+字典规避的点。若需兼容更多 Linux 写法，在 `osDict` 增补规范名即可（家族映射一并生效）。
- **请求结论**：请设计侧确认是否将 Module_07 §5.6 的 `os_type` 描述改为「内置字典选择（参考 `/os-options`），可按需扩展规范名」，并在 PRD 中说明字典口径，便于 M01/M09 采集候选匹配对齐。
- **⑤ 设计侧回改（2026-08-26）**：✅ **已闭环**——PRD §5.2/§5.6 `os_type` 已明确为「内置字典选择（AutoComplete 下拉，可搜索/自定义），参考 `/api/v2/platform/os-options`，规范名可按需扩展」，按「规范名→家族」归一化（decision 3.53）；原型 host 表单同步改必填 + AutoComplete 下拉。

## 10. 用户实测问题闭环（2026-09-07 热修）

### F-3. M07「下载模板」报 401「未认证或会话已失效」

- **触发**：用户在已登录状态下点击资源管理页「下载模板」，接口返回 401。
- **根因**：`ui-custom/web/src/api/resources.ts` 中模板下载（`downloadBlob`）与 Excel 导入（`requestMultipart`）为了处理二进制流 / multipart 请求，走了原生 `fetch`，但**没有附加 `Authorization: Bearer <token>` 认证头**；而 `/api/v2/platform/*` 全量受 Module 06 决策 44 的 au-02 认证中间件保护，缺少 token 即被拒绝。
- **修复**：
  - `ui-custom/web/src/api/client.ts` 新增导出 `rawRequest()`：原生 fetch 的认证变体，自动附加 Bearer Token，401 时统一清 token 跳转登录（与 `request` 语义一致）。
  - `ui-custom/web/src/api/resources.ts` 的模板下载与 Excel 导入改走 `rawRequest`。
- **新增单测**：
  - `src/api/resources.test.ts`：`resourceApi.template attaches Authorization Bearer token`
  - `src/api/resources.test.ts`：`resourceApi.importExcel attaches Authorization Bearer token`

### F-4. targets 已采集但 M07 状态仍显示「已下发未采到」

- **触发**：用户反馈 Prometheus targets 已 up，但 M07 资源列表「采集状态」badge 始终为「已下发未采到」。
- **根因**：M02 `/api/v1/health/coverage` 三态判定依赖 Prometheus `up` 序列上的 `resource_id` 标签回连资源（PRD §5.13、决策 47-3）。PRD 已要求五类默认标签模板包含 `resource_id → resource_id` 映射，实现中也存在该映射（`platform/models/label_template.go`），但 `platform/configcenter/generator/targets.go` 的 `resolveResource` 在构造标签模板字段视图时**漏了 `resource_id` 键**，导致 M09 生成 `targets/*.json` 时每个 target 的 `labels` 里没有 `resource_id`（如 `demo-middleware-9000.json` 中 `labels: {}`），`up{resource_id=...}` 不存在，coverage 恒判为 `pending_down`（已下发未采到）。
- **修复**：
  - `platform/configcenter/generator/targets.go`：将 `resource_id` 作为 **system 层身份标签强制注入**每个 target 组的 `labels`，不依赖 Job 是否挂载标签模板，也不可被模板映射覆盖。
  - `platform/configcenter/generator/labels.go`：调整 `mergeIntoLabels` 语义为 `system + templateLabels` 两层合并，复用 `mergeLabels` 的 system 保护逻辑。
- **新增单测**：
  - `platform/configcenter/generator/generator_test.go`：`TestResolveTargetsInjectsResourceID`（无模板也注入 resource_id；模板映射不可覆盖 resource_id）。
- **生效提示**：已下发的旧 Prometheus 配置里 targets 仍无 `resource_id` 标签，部署修复后需**废弃旧 pending 单并重新触发变更 → 确认下发**，使 Prometheus 重新加载新配置。

---

## 11. 新增登记（2026-09-11，M08 实例列对齐实施期发现）

### F-5. `instance_name` 标签映射：PRD 内部矛盾 + 适用范围建议（① 需设计确认）

- **类别**：① 需产品/设计确认（PRD 内部自相矛盾 + 适用范围未限定）
- **PRD 章节 / 文件位置**：`Module_07_Monitoring_Object_Management.md` §5.2 字段表 `instance_name` 行（L318）与 §5.12 A「Resource 字段」表 L621 行；实现侧 `platform/models/label_template.go` 的 `DefaultMappingBuilders`
- **触发**：M08「告警实例列与 M01 资源清单对齐」方案实施（M08 决策 70）时核对标签映射实现，发现下述矛盾，且该矛盾直接影响 M08 v1.15 三期增量（标签侧补 `instance_name`）的实施口径。
- **① PRD 内部矛盾（需择一为准）**：

  | 位置 | 原文要点 | 指向的 Prometheus Label |
  |------|----------|------------------------|
  | §5.2 字段表 `instance_name` 行 | 「可读实例名/展示名；host 模板中必填，对应 Excel `instance_name`，**生成 `hostname` label**」 | `hostname` |
  | §5.12 A 表通用行 | 「`instance_name` → **`instance_name`**；可读实例名；host 模板中必填」 | `instance_name` |

  - 两处对同一来源字段给出**不同的目标标签**。实现侧 `DefaultMappingBuilders`（`label_template.go:38-62`）**两条都没有实现**（host 类默认模板实际仅有 `instance_ip:port→instance` / `resource_id` / `app_name→app` / `env` / `cluster` / `biz_code→biz`）；即 §5.2 所称「生成 hostname label」在默认模板中**从不产出**，是**死键**。
  - 建议：以 §5.12 A 的「通用 `instance_name` → `instance_name`」为准，并同步修正 §5.2 的「生成 `hostname` label」表述；同时明确「主机 `hostname` → `hostname`」是否仍需保留（若保留应一并实现，否则应从 §5.12 A 表移除，避免第二处死键）。
- **② 适用范围建议（补括注）**：§5.12 A 的通用行未限定适用范围。经逐资源类型评估（M08 决策 70），建议明确为**仅 4 类静态资源**（host / database / middleware / generic_target）：
  - host 取 `InstanceName`；database / middleware **取 `InstanceIP`**（两个模型均无 `instance_name` 字段，与 `task-sequence.yaml:445` 展示口径一致）；generic_target 取 `TargetName`；
  - **application 不适用**：其默认模板已有 `service_name → service_name`，再加 `instance_name` 属同义重复，会让「哪个才是名字」成为新的歧义源；
  - 拨测（blackbox）URL 与容器类不在该表范围内，不适用。
- **请求结论**：请设计侧在下一轮 PRD 迭代中（a）择定 `instance_name` 的目标标签并修正 §5.2 矛盾；（b）为 §5.12 A 通用行补适用范围括注（4 类静态资源 + db/mw 取 `InstanceIP`）。
- **备注**：本次未直接修改 M07 PRD 正文与版本面——本分支为 M08 开发分支，避免触碰其他模块的 PRD 版本归口（跨模块冲突风险）；实现侧已按上述建议口径预留（M08 决策 70 三期范围收窄至 4 类静态资源）。
- **状态**：open（待设计侧收割）

---

## 12. 新增登记（2026-09-24，Edge 配置同步卡死根因定位期发现）

### F-11. 应用资源 `health_check_url` 命名与用途错位 + 可选致空值静默流入下游（① 需设计确认 + ② 实现偏差）

- **类别**：① 需产品/设计确认（字段命名与用途口径）+ ② 实现偏差（应用类别采集地址来源未明确、空值无拦截）
- **PRD 章节 / 文件位置**：`Module_07_Monitoring_Object_Management.md` §5.2（application 字段表）/ §5.13；实现侧 [validate.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/validate.go#L257-L287)（`validateApplication`）、[targets.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L83-L97)（`resolveResource`）、前端 [ResourcesPage.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/resources/ResourcesPage.tsx#L526-L532) 与应用表单
- **触发**：2026-09-24 边缘域采集节点「配置同步」永久「同步中」+ 主机 / 拨测在线数全 0 的线上故障定位（M09 F-31 / M11 F-17），溯源到 M07 应用资源字段口径。
- **实测事实**：
  1. **字段名与用途错位**：展示名为「健康检查 URL」（`health_check_url`），但 application 类别的采集目标地址**只取该字段**（`Address: application.HealthCheckURL`）；`protocol` / `endpoint` / `port` **完全不参与采集地址拼接**（对比 host/database/middleware 走 exporter 端口拼接）。用户按字面填 `/actuator/health`（JSON）会「地址非空但无样本」，正确应填 exporter 指标端点（如 `http://10.10.1.4:8081/actuator/prometheus`）。
  2. **可选字段 + 无拦截**：`validateApplication` 对 `health_check_url` 是「非空才校验格式」→ **可留空入库**；同函数中 `endpoint` 必填、`port` 仅校验范围（0 合法 → **实际非必填**）、`protocol` 空则跳过校验。
  3. **空值静默流入下游**：生成器对空地址实例 `continue` **静默跳过**（无日志、无提示）→ ① 单实例 Job → 产出空 targets（`[]`）→ 边缘拒收 → 配置永久卡死；② 多实例 Job → 其余实例正常、该实例**静默漏采**，列表显示「已下发未采到」。**用户实测该行即此表现**：`服务名=test1 / 健康检查URL "-"(空) / 协议=https / 端点=10.10.1.4 / 端口=8081 / 采集状态=已下发未采到`。
- **用户操作触发点**：**① 登记 / 编辑应用资源时 `health_check_url` 留空 → ② 该实例被某个采集 Job 选中**。两处均无拦截、无提示。
- **请求结论（PRD 口径）**：
  - （a）明确 application 的**采集地址权威来源**即该字段，并在 §5.2 / §5.13 写清语义为「exporter 指标端点 URL（非业务健康检查接口）」并给示例；
  - （b）确认 `endpoint` / `port` / `protocol` 在 application 下的**职责边界**（实测：`endpoint` 参与唯一定位键 `category|domain|service_name|endpoint`（[validate.go L378-L379](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/validate.go#L378-L379)）与标签映射；`port` / `protocol` 不参与采集地址、现状即非必填）；
  - （c）确认字段展示名是否由「健康检查 URL」改为语义更准的表述（如「采集地址（exporter 指标端点）」）。
- **落档与处置（2026-09-24）**：已写入 `docs/05-execution-records/module-11/design-proposals/config-sync-stall-and-empty-targets-guard.md` §4.5——**E-1** 语义引导 + 前后端必填；**E-2（已确认采纳）** 以 `health_check_url` 为唯一输入自动派生 `protocol` / `endpoint` / `port` 并置只读（不删字段、不动表结构与唯一键）。提案状态 `draft`，**本分支暂不改代码**，待 chenrt 评审后实施。（**2026-09-25 订正：本条 E-1 / E-2 设计与「暂不改代码」结论已于 2026-09-24 晚被下方「⚠ 修订」块推翻且已实现；提案头部状态已于 2026-09-25 订正为 `approved`，仅 PRD / 契约回写待设计条线。**）
- **⚠ 修订（2026-09-24 晚，chenrt 裁决，已实现）**：上述 E-1 / E-2 设计**已推翻并回退**。用户在实测后指出：**「采集地址」应在 M01 创建采集 Job 时填写**（「怎么抓」属采集策略），M07 台账管理的是**应用的实际 URL**（「部署在哪」）——按此动线，`health_check_url` 不应承载采集地址，其必填校验也不应落在 M07。
  - **终版口径（见提案 §4.5.2R，权威）**：
    - `health_check_url` **恢复可选**、语义为「应用实际 URL（业务健康检查）」，仅资源画像与标签来源，**不参与采集地址**（展示名保持「健康检查 URL」）；
    - `endpoint`（主机，IPv4/域名）+ `port`（**采集端口**，如 exporter 监听端 8081）共同构成 application 采集地址 `endpoint:port`，二者**均必填**（原 `port` 0 合法 → 改为必填 1~65535）；`protocol` 可选、仅资源画像；
    - M09 generator 对 application 的 target 地址由 `health_check_url` 改为 `endpoint:port`（与 database / middleware / generic_target 统一为「主机 + 端口」模型）；
    - M01 采集中 `monitor_type=application_http` 的 `metrics_path`（如 `/actuator/prometheus`）**必须显式填写**——`application_http` 无内置默认采集器映射，采集路径无通用默认值可继承（原「留空继承 `/metrics`」已禁用）；application 的实例候选 / 目标预览 / 安装确认展示地址同步改为 `endpoint:port`。
  - **红线未动**：表结构、唯一键 `category|domain|service_name|endpoint`、标签模板映射均不变。
  - **存量影响**：`health_check_url` 为空的存量行**不再被拦**；`port=0` 的存量 application 行在下次编辑保存时会被拦（需补采集端口）。不做数据回填脚本。
  - **请求结论（PRD 口径，修订）**：（a）M07 §5.2 明确 `health_check_url` 为「应用实际 URL」且可选、**不参与采集**；`endpoint` / `port` 明确为**采集地址主机与采集端口且必填**，`protocol` 标注仅资源画像；（b）M09 PRD §3.3 明确 application 的 target 地址来源为 `endpoint` + `port`；（c）M01 PRD §5.4 明确 `application_http` 的 `metrics_path` 必填、不参与「留空继承」层叠默认链。
  - **状态**：open（待设计侧按修订口径回写 M07 / M09 / M01 PRD）
- **存量影响（已按修订口径更新）**：见上「⚠ 修订」块——`health_check_url` 空值不再被拦；`port=0` 的存量 application 行编辑保存时需补采集端口。
- **影响模块（修订后）**：后端 `platform/config/resource`（必填口径调整 + 删除派生）、`platform/configcenter/generator`（target 地址来源）、`platform/strategy/scrapejob`（application_http 的 metrics_path 必填与展示地址）、前端 M07 应用表单与列表列头、前端 M01 采集 Job 表单、`Module_07` / `Module_09` / `Module_01` PRD 与 `api-contract-snapshot.md`
- **状态**：open（待设计侧确认 (a)(b)(c)）
