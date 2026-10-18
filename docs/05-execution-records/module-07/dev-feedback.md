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
- **状态**：**已收割**（2026-09-28 收割于 M07 PRD v2.48，落点 §5.2 / §5.12.1）

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
  - **状态**：M07 §5.2 已收割于 v2.48（落点 §5.8 `health_check_url` / `endpoint` / `port` / `protocol` 四字段）；M09 §3.3 / M01 §5.4 待对应模块回写（不在本次 M06/M07 范围）
- **存量影响（已按修订口径更新）**：见上「⚠ 修订」块——`health_check_url` 空值不再被拦；`port=0` 的存量 application 行编辑保存时需补采集端口。
- **影响模块（修订后）**：后端 `platform/config/resource`（必填口径调整 + 删除派生）、`platform/configcenter/generator`（target 地址来源）、`platform/strategy/scrapejob`（application_http 的 metrics_path 必填与展示地址）、前端 M07 应用表单与列表列头、前端 M01 采集 Job 表单、`Module_07` / `Module_09` / `Module_01` PRD 与 `api-contract-snapshot.md`
- **状态**：M07 §5.2 已收割于 v2.48；M09 §3.3 / M01 §5.4 待对应模块回写（不在本次 M06/M07 范围）

---

## 收割记录

| PRD 版本 | 日期 | 收割范围 | 落点 |
| --- | --- | --- | --- |
| v2.48 | 2026-09-28 | F-5 / F-11(a) | F-5：§5.2 `instance_name` 改以 §5.12.1 A 为准（生成 `instance_name` label）+ §5.12.1 通用行补适用范围括注（4 类静态资源，db/mw 取 `InstanceIP`，application 不适用）+ 移除 `hostname` 死键行；F-11(a)：§5.8 application `health_check_url` 恢复可选（仅资源画像/标签来源，不参与采集）、`endpoint`+`port` 为采集地址且必填（`port` 1~65535）、`protocol` 仅资源画像。F-11(b)(c) 归 M09/M01，待对应模块回写 |

---

## 13. 新增登记（2026-09-28，导航与资源列表 UX 梳理期发现）

> 触发：PM UX 梳理——导航层级顺序、「监控对象管理」子项图标、资源列表列组织与命名、云/服务列语义。
> 以下均为 **③ 实现/优化缺口**（不改 PRD / 原型契约），不涉及 PRD 内部矛盾。
> 优先级建议：F-15（合规）> F-12（导航层级）> F-13（列分组）> F-14（云列 tooltip）。
> **云归属 P0（网域登记表单缺字段）登记在 `module-06/dev-feedback.md` #15**（该字段权威在 M06，本条仅登记 M07 侧消费端）。

### F-12. 「监控对象管理」导航子项顺序与四层模型不符 + 四项图标重复（③ 优化）

- **位置**：`ui-custom/web/src/layouts/MainLayout.tsx` L128-140（`monitoring-object` 分组 `subItems`）；契约 M07 PRD §5.21（平台字典）/ §5.22（服务字典）与四层模型 `platform(1) → app(N) → service(M) → instance(K)`；原型 Module_07 MainLayout §3.23。
- **现状**：
  1. 子项顺序为「业务 → 应用 → 平台 → 服务」（L131-137），把**纵向组成链**（平台→应用→服务）与**横向归属维度**（业务）混排，且平台被排在应用**之后**，与四层模型自顶向下的层级不符；
  2. 四项图标**全部为 `AppstoreOutlined`**（L131/133/135/137），业务 / 应用 / 平台 / 服务无法靠图标区分。
- **建议**：
  - 顺序：`平台 → 应用 → 服务` 一组（纵向组成链，自顶向下）+ `业务` 单独成组或置后（横向归属维度）；
  - 图标区分（示意）：平台 `DeploymentUnitOutlined` / `ClusterOutlined`、应用 `AppstoreOutlined`（保留）、服务 `ApiOutlined` / `NodeIndexOutlined`、业务 `PartitionOutlined` / `TagOutlined`。
- **状态**：open（待 PM 确认方案后落地）

### F-13. 资源列表五类 Tab 列未按「技术属性 / 业务归属」分组（③ 优化）

- **位置**：`ui-custom/web/src/pages/resources/ResourcesPage.tsx` `buildColumns`（host L543-589 / database L590-613 / middleware L614-637 / application L638-710 / generic_target L711-752）；契约 M07 PRD §5.2（区分「技术属性」与「业务属性 / 归属」）。
- **原始现状**：五类 Tab 列**扁平混合**，技术属性（实例名 / IP / 端口 / OS / 类型 / 版本）与业务归属（业务 / 应用 / 平台 / 服务）**无分组**；host 列序为 `实例名 → IP 地址 → 操作系统 → 环境 → 集群 → 网域 → 业务名称 → 应用名称 → 平台 → 云 → 运行状态 → 采集状态 → 录入方式 → 操作`，五类列顺序也不统一。
- **原建议**：按「技术属性 / 业务归属」两组归并，用列头分组（`children`）或视觉分组呈现：
  - **技术属性组**：实例名 / IP、端口、OS / 类型、版本、网域、运行状态、采集状态（回答「怎么采、采到哪」）；
  - **业务归属组**：平台、应用、服务、业务、云（回答「属于谁、服务谁」）。
  - 注：「云」属**位置属性**（经所属网域 `cloud_code` 派生），严格说是「技术 / 位置」而非「业务归属」，建议归技术属性组或单列「位置」组。
- **状态**：~~open~~ → **2026-10-03 PM 裁定：列头分组方案撤销，改列显隐配置**。
  - 该方案已随 commit `1ebdee8` 提前落地（`GROUP_TECH = '技术属性 / 位置'` / `GROUP_BIZ = '业务归属'`，五类 Tab 全部经 `groupColumns()` 包父列），**属落地先于确认的流程偏差**，现予纠正。
  - **撤销理由**：①antd 父列分组把表头变成两行，**一列都没减**，与 `tablePresets.ts`「列数 ≤ 8，超出字段下沉详情 Drawer」既定规范正面冲突——分组是纯成本；②`scroll.x = 'max-content'` 下横向滚动时组标题与其下属列不在同一视口，分组语义归零；③组名「技术属性 / 位置」把位置属性（网域 / 云）与技术属性（IP / 端口 / OS）塞进同一标签，语义含混。
  - **替代方案**：改为**列显隐配置**（工具栏「列设置」勾选显示 / 隐藏列），已由用户拍板提前落地，见 **F-17**。
  - **测试连带影响（实施前必读）**：撤销分组会撞 **3 个 F-13 专属用例**，它们断言的正是「两级表头 / `scope=colgroup` / 组标题文本 / 组内列序」，撤组后必然变红，须一并处理：
    - `ResourcesPage.test.tsx` L558-575「F-13：五类 Tab『应用名称』『业务名称』同属业务归属组，组内应用名称在业务名称之前」——该用例的**业务意图（业务归属列的相对顺序）本身仍成立**，应改写为「不依赖分组、直接断言列序」而非删除；
    - L595-634「F-13：五类 Tab 列头呈技术属性/位置 + 业务归属两组，各列归属正确，操作列不归组」——断言 `scope=colgroup` 与组标题，**随分组撤销而失效**，应删除（其覆盖的 sticky 意图由下一条承接）；
    - L636+「F-13：分组后主标识列仍 fixed left、操作列仍 fixed right、scroll.x 生效」——**sticky 意图仍成立**，应保留并去掉「分组后」措辞。
  - 处置原则：撤组属**行为变更**，测试须同步重写，**不得为了让测试变绿而回填分组**。
  - **2026-10-03 已落地**：`ResourcesPage.tsx` 的 `GROUP_TECH` / `GROUP_BIZ` / `groupColumns()` 及 5 处 `...groupColumns(...)` 包裹全部移除，列改平铺；3 个用例按上述方案处置完毕 —— L558 改写为「不依赖分组、直接断言列序」、L595 分组形态用例删除、L636 sticky 用例保留并去掉「分组后」措辞。`grep技术属性` / `scope=colgroup` 在测试中零残留。
  - **2026-10-03 附带记录（非越界，勿误判）**：同轮 `ResourceDetailDrawer.tsx` 另含 125+ / 53- 的**UI 改造**（来源 `Tag` 扁平化 `bordered={false}`、字号 / 行高 / 内边距重设、来源说明改12px 单行省略截断、标签区加 `maxHeight:320 + overflowY:auto` 滚动容器），**不属 F-16 / F-13 / F-19 四项裁定范围，而是 PM 在另一会话中独立提出的需求**，经本次改动一并落在本分支。
    - **误判与更正**：复核时曾因该块不含在四项裁定内、且其注释含「保证文本仍可被 getByText 命中」字样，被判为「为让测试通过而改产品 UI」的越界改造并 `git checkout` 回退；**PM 已指出该判断有误——这是另一会话的需求，非越界**。已从 `/tmp/rd_before.tsx` 完整恢复（125+ / 53- 全量还原），并删除本条原「已回退」的错误留痕。
    - **纪律修正**：判断「越界改造」的判据应是**改动是否有人提出过的正当需求**，而非**改动量是否超出本轮任务清单**。工作区可能并存多会话的未提交改动，回退前**必须先向 PM 确认来源**，不得仅凭「不在本轮裁定内」即回退。
    - 该块与本轮 F-16 的 map 改名共存于同一文件，后续 commit 分组时按各自来源分别归档（map 改名归 F-16；UI 改造归 **F-20**「资源详情抽屉标签行过臃肿」，已于 2026-10-04 补登，详见 §14 F-20）。

### F-14. 资源列表「云」列缺 tooltip（③ 优化）

- **位置**：`ResourcesPage.tsx` `cloudColumn` L418-432；契约 M07 §5.20 / 决策 103。
- **现状**：列头仅「云」二字、**无 tooltip**（对比 `appColumn` L394-401、`platformColumn` L453-459 均已配 `InfoCircleOutlined` + tooltip）；列值实为 `cloud_name`（`resolveCloudName`，缺条目回退 `cloud_code`），用户无法分辨展示的是**云名还是云码**，也不知来源。
- **建议**：列头补 tooltip，例：「云归属经所属网域派生（网域登记时确定），资源侧只读」，并可注明「展示为云字典中的云名」。
- **状态**：open（待落地）

### F-15. 「应用」Tab 命名与 PRD 不符 + 「服务名 / 服务」两列歧义（③ 优化 + 合规）

- **位置**：`ResourcesPage.tsx` `RESOURCE_TYPE_MAP`（L96-102，`application: '应用'`）、Tabs `items`（L869-872）、`serviceColumn`（L435-449）、application Tab「服务名」列（L641-655）；契约 M07 PRD §5.1（L315）。
- **现状**：
  1. **Tab 命名不合规**：PRD M07 §5.1（L315）规定 `application` 的 UI 展示名为 **「应用服务」**，而生产 `RESOURCE_TYPE_MAP.application` 写死「**应用**」；Tab label 直接取自该 map（L872），与 PRD 不符。
  2. **两「服务」撞车**：application Tab 同屏并存「**服务名**」（`service_name` = 应用服务**实例名**，自由文本，参与判重键 `网域 + 服务名 + 地址:端口`，L641-655）与「**服务**」（`service_code` = **服务字典**归属，`svc` label 取值，L435-449），字面撞车、语义难分。
- **建议**：
  - ① Tab 改名「**应用服务**」（改 `RESOURCE_TYPE_MAP.application`），与 PRD §5.1 对齐；
  - ②「服务」列改「**所属服务**」（与「所属平台」措辞对齐），并补 tooltip「该资源归属的服务字典条目（`svc` 标签取值）」；
  - ③「服务名」列 tooltip 补区分句：「本应用服务实例名，参与判重；与服务字典归属（所属服务）是两个概念」；
  - ④「所属服务」列建议紧邻「服务名」或归入业务归属组，避免语义相关的两列被技术列隔开。
- **状态**：open（待 PM 确认后落地）
  - **2026-10-03 部分已修**：`application: '应用服务'` 与「所属服务」列改名 + tooltip 已随 `ab1e836` 落地；**`generic_target` 展示名仍为「通用目标」，与 PRD §5.1 L316「其他监控目标」不符**，转 **F-16** 跟踪。

---

## 14. 新增登记（2026-10-03，PM 四层动线与宽表体感复核）

> 触发：PM 对 M07 生产前端提出四点意见——①`generic_target` 命名以 PRD 为准；②资源列表宽表体感，列显隐非 MVP 功能、可提前做；③服务字典「所属应用 / 主业务」关系维护中，**主业务为过度设计**；④资源管理支持按四层筛选。
> 核查范围：`ui-custom/web/src/pages/resources/`（四字典页 + `ResourcesPage`）、`platform/config/resource/query.go`、`platform/models/`（`resource_base.go` / `service_dict.go`）、PRD §3.1.3 / §5.1 / §5.19–5.24 / §11.2。
> 优先级：**F-16（合规）> F-18（动线）> F-17（宽表体感）> F-19（关系维护）**。

### F-16. `generic_target` 展示名与 PRD §5.1 不符（③ 合规）

- **位置**：**生产代码共 6 处**同构展示名 map 副本（初稿只记了 2 处，实施前复核补全，见下表）；契约 PRD §5.1 L316「`generic_target` → **其他监控目标**」、§11.2「『其他监控目标』的 UI 展示名统一为『其他监控目标』」。

  | # | 文件 | map 变量名（行号） | 当前 `generic_target` | 当前 `application` |
  | --- | --- | --- | --- | --- |
  | 1 | `ResourcesPage.tsx` | `RESOURCE_TYPE_MAP`（L96） | 通用目标 | **应用服务**✅ |
  | 2 | `ResourceFormDrawer.tsx` | `RESOURCE_CATEGORY_MAP`（L56） | 通用目标 | 应用 ❌ |
  | 3 | `ResourceDetailDrawer.tsx` | `RESOURCE_CATEGORY_MAP`（L64） | 通用目标 | 应用 ❌ |
  | 4 | `ImportModal.tsx` | `RESOURCE_TYPE_MAP`（L29） | 通用目标 | 应用 ❌ |
  | 5 | `ImportRecordsPanel.tsx` | `RESOURCE_TYPE_MAP`（L36） | 通用目标 | 应用 ❌ |
  | 6 | `TemplateDownloadModal.tsx` | `RESOURCE_TYPE_MAP`（L11） | 通用目标 | 应用 ❌ |

- **现状**：6处map 均写「通用目标」。这些 map 是各类Tab / 弹窗 / 抽屉标题与label 的唯一来源，故**列表 Tab、资源表单、详情抽屉、导入弹窗、导入记录面板、模板下载弹窗六处UI 全部显示「通用目标」**，与 PRD 双重口径不符（§5.1 枚举表 + §11.2 全局行为规则均写「其他监控目标」）。
- **建议**：
  1. 6 处 map 的 `generic_target` 统一改为「**其他监控目标**」；
  2. **顺带补齐 `application`**：只有 `ResourcesPage.tsx` 一处已是 PRD 要求的「应用服务」，其余 5 处仍是「应用」——F-015①的 Tab 改名**只改了 6 处中的 1 处**，导致资源列表 Tab 显示「应用服务」而表单 / 详情 / 导入 / 模板弹窗显示「应用」，**同一资源类型两种叫法**。本轮一并对齐为「应用服务」（PM 已定口径为 PRD 的「应用服务」，见 F-15①）；
  3. 长期建议：6 份同构副本应收敛到单一模块（如 `resourceLabels.ts`）导出，本次至少在 dev-feedback 留痕，避免后续再漏改。
- **测试影响（实施前必读）**：`ResourcesPage.test.tsx` 有 **7 处**硬编码 `'通用目标'`（L429/564/581/601/628/986，另 L651 在 `ResourceFormDrawer.test.tsx` 为注释文本），改map 后这些Tab 点击断言会**全部变红**，必须同步替换为「其他监控目标」；`application` 相关断言同理。
- **裁定**：**PM 已拍板以 PRD 为准**，属必改项。
- **状态**：~~open~~ → **2026-10-03 已落地（resources/ 内 6 处）+ 2026-10-04 全量闭环（目录外 4 处）**。
- **2026-10-04 PM 裁定：跨模块一次性统一，10 处全改**（原挂「跨模块一致性缺口待决策」，PM 选定「一次性统一」而非「挂各模块待排期」）。目录外 4 处已改：`LabelTemplatesPage.tsx:37`、`labelTemplateConstants.ts:19`（export 共享常量，M01）、`strategyConstants.ts:30`（`CATEGORY_MAP`，export 共享常量，M09）、`CreateSilenceDrawer.tsx:136`（`CI_TYPE_OPTIONS`，M08）——四项均为 `generic_target → 其他监控目标`、`application → 应用服务`。
  - **连带测试修正**：`ScrapeJobFormDrawer.test.tsx:230` 的 `selectCategoryAndType('应用', 'HTTP 应用')` 按展示名选类别，随改名失效，已改 `'应用服务'`（该文件仅此一处用到 application 展示名，其余为主机 / 数据库）。
  - **验证**：`grep 通用目标` 全仓（含测试）**零残留**；10 处展示名 map 全部一致；`label-templates` + `strategy` + `alerts` 三模块 **370/370 通过**（含修正后 ScrapeJobFormDrawer 16/16）；`tsc --noEmit` exit 0；`eslint src` 0 error（1 warning 为 `alerts/RoutesPage.tsx:415` **既有告警**，与本轮无关）。
  - **完成判据已达成**：含 `labelTemplateConstants.ts` / `strategyConstants.ts` 两个 export 共享常量在内的 10 处全部对齐，**F-16 现为全量闭环**。
- **⚠️ 未消除的结构性问题（不阻塞，但建議后续收敛）**：10 处中 6 处在 `pages/resources/`、2 处在 `pages/label-templates/`（且 `LabelTemplatesPage.tsx` 与 `labelTemplateConstants.ts` 内容重复）、1 处 `strategyConstants.ts`、1 处 `CreateSilenceDrawer.tsx` 手抄数组——**同构展示名 map 共 5 组重复定义**。本次按 PM 裁定点对点改齐，但**未做收敛重构**（会跨 M01 / M07 / M09 三个模块改动 import 路径，超出本轮范围）。若后续再新增资源类型或改名，仍需改 5 处；建议单开一轮收敛为单一共享常量模块（如 `src/constants/resourceLabels.ts`），届时 F-16 方可视为根治。
- **⚠️ 实施中新发现：`resources/` 目录外另有 4 处同类展示名，本轮未改（跨模块，非 M07 职责）**：
  | # | 文件 | map 变量名（行号） | 当前值 | 归属模块 |
  | --- | --- | --- | --- | --- |
  | 7 | `pages/label-templates/LabelTemplatesPage.tsx` | `RESOURCE_TYPE_MAP`（L32） | 通用目标 / 应用 | M01 |
  | 8 | `pages/label-templates/labelTemplateConstants.ts` | `RESOURCE_TYPE_MAP`（L14，**已export**） | 通用目标 / 应用 | M01 |
  | 9 | `pages/strategy/strategyConstants.ts` | `CATEGORY_MAP`（L25，**已 export**） | 通用目标 / 应用 | M09 |
  | 10 | `pages/alerts/CreateSilenceDrawer.tsx` | L136 静默目标选项数组 | 通用目标 | M08 |
  - **影响面比 `resources/` 内更大**：`labelTemplateConstants.ts` 与 `strategyConstants.ts` 是**被跨文件 import 的共享常量**（`strategyConstants.ts` 亦含 `MONITOR_TYPE_DERIVATION_MAP` 等），标签模板页与策略管理页的类型下拉、静默创建抽屉的监控目标下拉**都显示「通用目标」**；且 `strategyConstants.ts` 的 `CATEGORY_MAP` 与 `labelTemplateConstants.ts` 的 `RESOURCE_TYPE_MAP` 本身也是**重复定义**。
  - **本轮未改的理由**：三个文件分属 M01 / M09 / M08 模块职责范围，M07 单方面改动会跨模块污染他线PRD 与执行记录；且 M09 策略侧 `CATEGORY_MAP` 可能被 M09 的 PRD 独立约定过口径。
  - **2026-10-04 PM 裁定：跨模块一次性统一，4 处全改**——PM 选定「一次性统一」而非「挂各模块待排期清单」。已改毕，全仓 `grep 通用目标` 零残留；连带修正 `ScrapeJobFormDrawer.test.tsx:230` 的类别文本断言。详见上方 F-16 状态。**F-16 现为全量闭环。**
- **F-16 全量闭环的完成判据**：上述 4 处中至少 2 处（含 `labelTemplateConstants.ts` / `strategyConstants.ts` 这类共享常量）完成对齐后，F-16 方可标为全量闭环。

### F-17. 资源列表宽表体感：列头分组撤销后改列显隐配置（③ 优化，PRD 原定 P1 / 用户同意提前）

- **背景**：PRD §3.1.3 L161 已登记「列显隐配置｜工具栏『列设置』勾选显示 / 隐藏列｜**P1｜后续版本**」——即该功能**契约上存在但明确排在 MVP 之后**。用户实操后反馈宽表影响观感，同意**提前落地**。
- **问题定性**：当前五类 Tab 列数为 host 14 / database 14 / middleware 14 / application 15 / generic_target 17（含操作列），**全部远超 `tablePresets.ts`「列数 ≤ 8，超出字段下沉详情 Drawer」**。原 F-13 的列头分组既未减列又多占一行表头（详见 F-13 撤销理由），撤除后**必须给出替代出口**，否则宽表体感问题原样留存。
- **建议**：
  - 工具栏增设「**列设置**」下拉（`Dropdown` + `Checkbox.Group`），按当前 Tab 列出该类型全部数据列（操作列与主标识列**不可关闭**），勾选结果按 `resource_category` 分别持久化；
  - **偏好持久化**：`localStorage` 记住用户上次勾选（PM 明确要求，避免每日重复配置）；键名按类型分区，切换 Tab 时各自恢复；
  - **默认列集合收敛**为 P0 高频列（主标识 + 状态 + 采集状态 + 业务归属 + 操作），其余转「可选」；
  - 恢复「按 F-13 原建议的语义分组」**作为勾选时的分组小标题**（下拉内分组展示，不占表头）——保留 F-13 想解决的「哪些列是业务归属」认知问题，同时不产生表头成本；
  - 契约处理：PRD §3.1.3 该行优先级由 `P1 / 后续版本` 改为 `P0 / MVP`（提前落地须落档，避免实现与契约再度背离）。
- **风险与约束**：
  - 属**提前交付 MVP 外功能**，须在 §3.1.3 留痕「用户体感驱动提前」，不得静默插入；
  - 偏好为**纯前端视图态**，不改变数据与默认列语义（沿用 PRD 原表述），不上传后端；
  - 需注意 `TABLE_SCROLL_X = { x: 'max-content' }` 下用户隐藏列后表宽重算，**主标识 `fixed:'left'` 与操作 `fixed:'right'` 的 sticky 结论不应回归**（F-13 实现注释已验证分组不破坏 sticky，抽除父列同理，但需实测）。
- **状态**：~~open（2026-10-04 PM 裁定暂缓）~~ → **2026-10-07 PM 决定本轮实施**
  - **2026-10-04 曾暂缓**：理由为撤组后宽表体感本轮可接受。**2026-10-07 复评后推翻暂缓、决定实施**，理由是F-18 落地后剩余的宽表问题只剩本条可解，且实施成本经核查为**低风险纯前端改造**（评估结论见下）。
  - **⚠️ 遗留风险（暂缓期间持续存在，实施后消解）**：五类 Tab 列数 host 14 / database 14 / middleware 14 / application 15 / generic_target 17（含操作列），**全部远超 `tablePresets.ts`「列数 ≤ 8，超出字段下沉详情 Drawer」规范**；撤组后用户**没有任何收敛宽表的手段**（无列显隐、无分组、无字段下沉），横向滚动是唯一出路。
  - **契约已就绪**：PRD §3.1.3 已于 v2.51 改为 `P0｜MVP` 并留痕「用户体感驱动提前」，实现时无须再动契约。
  - **实施可行性核查（2026-10-07，结论：难度不大）**：
    | 关键条件 | 核查结果 |
    | --- | --- |
    | 列定义结构 | 每类均为 `[identifier, ...typeColumns, 共享列 ×7, actionColumn]` 的**数组拼接**，非嵌套分组 → 过滤即 `columns.filter()` |
    | 列 key 可作持久化标识 | 10 个共享列 key **全唯一**（`status` / `source_type` / `service_code` / `platform_code` / `network_domain_id` / `monitor_state` / `cloud_code` / `biz_code` / `app_code` / `actions`），**无需补 `meta` 字段** |
    | 工具栏入口 | FilterBar 为独立区块，插入「列设置」`Dropdown` 无结构冲突 |
    | 后端改动 | **零** —— 纯客户端视图态，不上传后端 |
    | 规范依据 | `tablePresets.ts` 原文即「列数 ≤ 8，超出字段下沉详情 Drawer」，列显隐是**规范本身的要求** |
  - **PM 裁定的默认列集（P0 高频列，全部 ≤ 8 且含完整运维必需信息）**：
    | Tab | 默认保留 |进入「列设置」下拉 |
    | --- | --- | --- |
    | host | 实例名 + 操作系统 + 网域 + 运行状态 + 采集状态 + 操作（**6**） | IP 地址、环境、集群、云、平台、应用、业务、录入方式（8） |
    | database | 实例名 + **数据库类型** + 网域 + 运行状态 + 采集状态 + 操作（**6**） | IP 地址、端口、版本、云、平台、应用、业务、录入方式（8） |
    | middleware | 实例名 + **中间件类型** + 网域 + 运行状态 + 采集状态 + 操作（**6**） | IP 地址、端口、版本、云、平台、应用、业务、录入方式（8） |
    | application | 服务名 + 网域 + 运行状态 + 采集状态 + 所属服务 + 操作（**6**） | 健康检查 URL、协议、端点、端口、平台、应用、业务、录入方式（8） |
    | generic_target | 目标名称 + 网域 + 运行状态 + 采集状态 + 所属服务 + 操作（**6**） | Exporter 类型、IP 地址、端口、采集路径、协议、自定义标签、云、平台、应用、业务、录入方式（11） |
    - **⚠️ 本条表格已按代码事实修正**：原裁定写「host / database / middleware：实例名 + 操作系统 + …」，但 **database / middleware 模型无 `os_type` 列**（`buildColumns` 该两类只有 `database_type` / `middleware_type`；`SUBTYPE_FIELD` 亦印证 host=`os_type`、database=`database_type`、middleware=`middleware_type`）。**该位由各自类型专属列承担**——否则这两类默认列集只剩 5 列且丢失「这是个什么库 / 什么中间件」的首要判别信息。实施方已按此落地并留痕。
  - **✅ 2026-10-07 已落地**（`ResourcesPage.tsx` + 新增 `resourceColumnPrefs.ts` + `ResourcesPage.test.tsx`）：
    - **入口**：FilterBar 末位（与8 个筛选器同区，未塞表格浮层），`Dropdown` + `Checkbox.Group`，按钮文案 `列设置（已选/总数）`（如 `列设置（6/14）`）让用户感知偏好生效；`buildColumns` 结果经 `.filter()` 得到 `visibleColumns`。
    - **持久化**：键 `mc_res_list_cols_<resource_category>`（如 `mc_res_list_cols_host`），值为列 `key` 数组 JSON，**按 `resource_category` 分区**。三重兜底**全部静默不抛错**：① `localStorage` 访问本身抛错（隐私模式 / SSR）→ 默认列集仅内存态；② `JSON.parse` 失败 / 非数组 / 含非字符串 / 空数组 → 默认列集；③ 含已不存在的 key → **整体**回退默认列集（不做部分保留，半残偏好更难解释）。另加 `orderColumnKeys` 强制并入固定列，脏偏好也无法把主标识 / 操作挤出表头。
    - **不可关闭列**：主标识（`fixed:'left'`）+ 操作（`fixed:'right'`）**双重保障**——勾选项 `disabled` + 渲染前与可见集合取并集。
    - **下拉内分组小标题**（不占表头，沿用 F-13 撤销前口径）：**固定列**（主标识 + 操作）/ **技术属性·位置**（类型专属列 → 网域 → 运行状态 → 采集状态 → 录入方式 → 云）/ **业务归属**（平台 → 应用名称 → 所属服务 → 业务名称）。
    - **列标识**：直接用列 `key`，**未新增 `meta` 字段**（实施前已复核 10 个共享列 key 全唯一）。
  - **sticky 实测结论（已验证，不回退）**：`scroll.x='max-content'` 下隐藏列后 sticky **不回归**。验证方式为**破坏验证**——临时删除 host 主标识列的 `fixed:'left'`，跑 `-t "fixed left"` 确认用例变红（`expected 'ant-table-cell' to contain 'ant-table-cell-fix-left'`）后恢复。另做三组破坏验证确认新用例非空跑：移除固定列 `disabled` → 「不可取消勾选」红；分区键退化为固定 `host` → 「分区落库」红；移除脏数据回退保护 → 「脏数据回退」红。sticky 断言已写入测试（隐藏「网域」后复验首列 fix-left、末列 fix-right）。
  - **测试**：改写 **20 条**（原 61 条中因抽列变红）+ 新增 **10 条** F-17 专项，61 → **71 条**。关键手法：新增 `showColumnsByLabels` / `hideColumnsByLabels` 助手——验证特定列渲染时**先经 UI 勾选**再断言，**未回填任何列进默认集**（守住红线）；`beforeEach` 清理 5 个分区键避免跨用例污染。
  - **验证总表**：`vitest run src/pages/resources` **205/205（11 文件）**；`tsc --noEmit` exit 0；`eslint src/pages/resources` 0 error 0 warning。无「既有失败」需区分。
  - **✅ 附加：下拉底部「恢复默认列」（2026-10-08 补做）**：
    - **动因**：用户把列取消到极简后，若无此入口只能手动逐个勾回 P0 高频列（host / generic_target 各需勾 5 次），属可避免的重复操作。PRD §3.1.3 未要求，故最初未擅自加；PM 复核后要求补。
    - **实现**：`resourceColumnPrefs.ts` 增 `resetVisibleColumnKeys(category)`（**写入默认列集**而非 `removeItem` 清空——两者对 `loadVisibleColumnKeys` 结果等价，但写入后存储态与内存态始终一致，便于排查「用户是否重置过」，且复用 `orderColumnKeys` 归一化，默认集若含已下线列也能被正确过滤）；`isDefaultVisibleColumnKeys(category, keys)` 供禁用态判断。
    - **UI**：`Checkbox.Group` 下方 `Divider` 分隔 + `Button type="link"`（图标 `ReloadOutlined`，文案「恢复默认列」），**已是默认列集时 `disabled`**（避免无意义点击）。
    - **作用域**：仅作用于**当前 Tab**（按 `resource_category` 分区，与偏好存储口径一致），不会误伤其他 Tab 的偏好。
    - **测试**：新增 2 条（「一键回到默认集并落库」：先勾掉 4 列至极简 `['实例名','操作']` → 点击恢复 → 断言列序与落库值；「禁用态与 Tab 独立性」：初始禁用 → 改动解禁 → 切 database 仍禁用 → 切回 host 仍为非默认）。`ResourcesPage.test.tsx` 71 → **73 条**。
    - **验证**：`vitest run src/pages/resources` **207/207（11 文件）**；`tsc --noEmit` exit 0；`eslint src/pages/resources` 0 error 0 warning。

### F-18. 资源列表缺平台 / 应用 / 服务三维筛选，四层模型只管录入不管查询（③ 动线）

- **位置**：前端 `ResourcesPage.tsx` FilterBar（约 L820-905，现有 5 项：网域 / 业务 / 运行状态 / 采集状态 / 搜索）、`useResources.ts:73-79`（`ResourceFilters`）；后端 `platform/config/resource/query.go:37-47`（`ListFilter`）与 `:72-96`（`BuildListQuery`）；契约 PRD §6.1 资源列表 API、§11.1 页面状态矩阵。
- **现状**：四层模型（决策 110/ 111 / 112）在**录入侧完整**（资源表单已有「平台 → 应用 → 服务」三级级联，`ResourceFormDrawer.tsx:355-401`），但**查询侧完全缺位**：
  | 维度 | 录入 | 列表列展示 | 列表筛选 | 后端 `ListFilter` |
  | --- | --- | --- | --- | --- |
  | 平台 `platform_code` | ✅ 级联首项 | ✅ 有列 | ❌ | ❌ |
  | 应用 `app_code` | ✅ 级联第二项 | ✅ 有列 | ❌ | ❌ |
  | 服务 `service_code` | ✅ 级联第三项 | ✅ 有列（仅 application / generic_target） | ❌ | ❌ |
  | 业务 `biz_code` | ✅ | ✅ 有列 | ✅ 有 | ✅ 有 |
  | 网域 `network_domain_id` | ✅ | ✅ 有列 | ✅ 有 | ✅ 有 |
  - 即：**用户建好平台 / 应用后，在资源列表无法按其筛选**，只能逐页翻或用关键字模糊搜；「该平台下有哪些实例」这一最自然的问句无法自助回答。
  - 附带问题：`biz_code` / `status` 筛选当前是**前端过滤**（`useResources.ts:223-231` 注释明说「后端不支持该两筛选」），只对当页生效、总数不随筛选变化，属既有裁剪；新增三维筛选时应**一并下沉到后端**，否则筛选与分页总数不一致会加深误导。
- **建议**：
  - 后端 `ListFilter` 增`PlatformCode` / `AppCode` / `ServiceCode` 三字段，`BuildListQuery` 按类型追加等值条件（`service_code` 仅 application / generic_target 两类有该列，需按类型条件化，避免给 host / database / middleware 拼不存在的列导致 SQL 报错）；
  - 五类资源表**均已有** `platform_code` 与 `app_code` 列（`resource_base.go:22` + `AppName` 语义列、`host.go:17/21`、`resource.go:55/61/83/89`），无需schema 变更；`service_code` 仅 `application`（`resource.go:99`）/ `generic_target`（`generic_target.go:11`）持有；
  - 前端 FilterBar 增三个下拉，**按 Tab 条件化**：`service_code` 筛选仅在 application / generic_target 两类出现（与列口径一致）；`app_code` 下拉按所选 `platform_code` 级联过滤（复用 `app_platform_rel`，与表单级联同源）；
  - 顺带把 `biz_code` / `status` 从前端过滤下沉到后端，消除分页总数不一致。
  - 契约处理：PRD §6.1 资源列表查询参数表 + §11.1 「数据超量」行（现文只列关键字 / 网域 / 业务 / 状态）需同步补三维筛选。
- **状态**：open → **2026-10-04 排入本轮实施**（契约层已先行落档，见下）
  - **2026-10-03 契约层已先行落档**（PRD v2.51）：§6.1 查询参数表补`platform_code` / `app_code` / `service_code` 及条件化规则，并新增「列表筛选参数口径」段（四维对照表 +「筛选须下沉后端」条+ 条件化条）；§11.1「数据超量」行同步；§9.1 / §9.2 补验收项并标注「契约先落」。
  - **2026-10-04 PM 裁定实施范围：本轮 = 三维筛选 + `biz_code` / `status` 下沉后端一起做**（五字段一次到位）。理由：契约 §6.1 L1289 已写明「本版仅落参数契约，实现与该裁剪修复由后续轮次排期」，本轮既排实现，则缺陷修复同批落地；且分页总数不一致是用户可直接观察到的错误，`FilterBar` 上「业务」「运行状态」两个筛选器摆在那里却只对当页生效，不能长期挂着。
  - **范围锁定**（PM 已确认，按此实施）：
    | 字段 | 性质 | 后端 | 前端 |
    | --- | --- | --- | --- |
    | `platform_code` | 新增 | `ListFilter` + `BuildListQuery` 等值条件 | FilterBar 首级下拉 |
    | `app_code` | 新增 | 同上 | 下拉**按所选 platform_code 级联**（复用 `app_platform_rel`，与表单同源） |
    | `service_code` | 新增 | 同上，**按 category 条件化** | 下拉**仅 application / generic_target 出现** |
    | `biz_code` | **缺陷修复** | 由前端过滤改为后端等值条件 | **删除 `useResources.ts:223-231` 的前端过滤逻辑** |
    | `status` | **缺陷修复** | 同上 | 同上 |
  - **✅ 2026-10-07 已落地**（后端 `platform/config/resource/query.go` + 前端 `ResourcesPage.tsx` / `useResources.ts` / `api/resources.ts`）
  - **⚠️ 本条两处原始记载不准确，实施时以代码为准修正如下**（记此以免后续再次误判）：
    1. **`biz_code` / `status` 的后端能力本就存在，不是缺失**。`ListFilter.BizCode` / `Status` 与 `BuildListQuery` 的等值条件**早已就绪**（K-1 闭环时已加，注释与 `TestListResourcesBizCodeStatusFilter` 均可证），§4 也有「biz_code / status 筛选已闭环」的记载。**真实缺陷只在前端**——`load()` 从未把这两个 filter 放进请求参数，同时又在 `filteredList` 里当页过滤，**属后端能力空转**，而非「后端不支持」。故本轮后端**未重复实现**已有能力，只补三维；PRD §6.1 关于这两项的既有表述**无需改动**。
    2. **`app_code` 的物理列名按类别不同**，dev-feedback原记载只提示了 `service_code` 需条件化，**漏了这一点且影响面更大**：
       | 类别 | 物理列名 | 依据 |
       | --- | --- | --- |
       | host | **`app_code`** | `host.go` `AppCode`（决策92 后的新列） |
       | database / middleware / application / generic_target | **`app_name`** | `ResourceBase.AppName`（决策 92「物理列名不改名」，语义已切换为 app_code 编码） |
       - 若图省事直接写 `db.Where("app_code = ?")`，**host 正常而其余四类全部 SQL 报错**（4/5 类失效，比 `service_code` 的 3/5 更糟）。已抽 `appCodeColumn(category)` 按类别返回列名。
  - **实施要点**：
    - 后端：`ListFilter` 新增 `PlatformCode` / `AppCode` / `ServiceCode` 三字段（`ParseListFilter` 同步解析）；`BuildListQuery` 追加三段等值条件，`app_code` 走 `appCodeColumn(category)`、`service_code` 带 `&& hasServiceCode(category)` 守卫。
    - **反向验证**：实施中临时去掉 `&& hasServiceCode(category)`，host/database/middleware 三类立即复现 `no such column: service_code`（`list.go:114 count host resources`），随后恢复——证明新增回归用例确实咬住了该缺陷。
    - 前端：FilterBar 增平台 / 应用 / 服务三下拉（插在「网域」后、「业务」前），回退占位符 `全部平台` / `全部应用` / `全部服务`；`app_code` 下拉**按所选 `platform_code` 级联**（新增 `appPlatformRels` state + `appPlatformRelApi.list()`，与资源表单三级级联同源），**切换平台时清空 `app_code`**避免跨平台残留。
    - **衍生边界（PM 范围表未明说，按「按 Tab 条件化」原则一并处理）**：切到host / database / middleware 三类时**主动清空 `service_code`**——否则会带着一个下拉不可见的生效筛选器静默过滤行，用户无从感知也无法清除。
    - `useResources.ts` 的 `filteredList` memo 及其「后端不支持该两筛选」注释**整块删除**，`UseResourcesResult.filteredList` 字段一并移除；`ResourcesPage` 的 `coveredList` 改为基于 `data.list`（仅叠加 coverage 三态，属 M02 口径）。全仓 `grep filteredList` / 「后端不支持该两筛选」**零残留**。
  - **测试**：
    - 后端 4 个新用例，含 `TestListResourcesServiceCodeIgnoredOnNonServiceCategories`（逐类别 host/database/middleware 断言 200 + 条件被忽略）与 `TestHasServiceCodeAndAppCodeColumn`（把两个 schema 事实锁死，迁移破坏会先于运行时报错）；`go test ./platform/config/resource/...` **185 passed / 0 failed**。
    - 前端 10 个新用例，含「『服务』筛选器仅在应用服务/其他监控目标 Tab 出现」逐 Tab 遍历断言；`vitest run src/pages/resources` **195 passed / 11 files**、`src/api/resources.test.ts` 33 passed。
    - **行为变更的测试处置**：原 `filters rows by business client-side` 断言的正是前端过滤特征，随缺陷修复失效，已改写为两条「请求参数下发」断言并注明原特征已移除——**未为了让测试变绿把前端过滤加回来**。
  - **验证总表**：`go build ./platform/...` exit 0；`go test ./platform/config/resource/...` 185/185；`vitest run src/pages/resources` 195/195；`tsc --noEmit` exit 0；`eslint src/pages/resources` 0 error 0 warning。
  - **未做（有意留出裁定范围）**：`app_platform_rel` 每页多一次请求（MVP 分页从简下无影响，后续关系表变大可考虑惰性拉取或后端提供级联选项接口）；`is_monitored` 仍透传（M01 未实现时不生效）。
  - **2026-10-08 审查后处置（三项遗留）**：
    1. **`api-contract-snapshot.md` 已重新派生**（golang-reviewer 发现其滞后：只含 v2026-09-28 的**录入侧**增量，资源列表段缺本轮查询侧五参数，而前端以它为**第一权威**、漏字段会直接导致前端漏传参）。已在 §3 `GET /resources` 行补 `biz_code` / `status` / `platform_code` / `app_code` / `service_code`，并新增「四维筛选的类别条件化」说明表（含 `app_code` 物理列名按类别不同、`service_code` 仅两类生效、**其余三类静默忽略而非报错**），同时更新元信息的版本 / 生成方式 / 来源。**契约快照无生成脚本**（手工派生 + `scripts/review-precheck.sh` 校验），故本次为手工增量重派生。
    2. **Go侧 `appCodeColumn` 兜底方向已统一**（golang-reviewer LOW-1）：原 `if host / else` 会让**未知 / 新增类别静默落到 `app_name`**；已改为穷举 `switch` + `default` 返回 `""`，`BuildListQuery` 加 `col != ""` 守卫——降级方向与 `hasServiceCode` 一致（不加条件而非猜列）。**新增 `TestColumnSchemaHelpersCoverAllCategories`** 用 `ValidResourceCategories()` 做**枚举完整性断言**（原测试逐个硬断言，新增枚举不会失败）；另断言未知类别两函数均不给出有效列名 / 真值。破坏验证已做：从 switch 删掉 `application`/`generic_target` → 用例红并提示「未覆盖权威枚举 "generic_target"」，恢复后全绿。
    3. **`monitorState`（采集状态）前端过滤已**「**显式化**」**而非消除**（见下方遗留风险）**。
       - **为何不能下沉**：`monitor_state` 是 **M02 `GET /api/v1/health/coverage` 的派生字段**（= M01 选中关系 × Prometheus up 聚合），**M07 五类资源表无该列**（grep 确认：`platform/` 下无 `monitor_state` 列定义，仅在 coverage handler / 测试中出现）。要下沉需**跨 M01/M02/M07 三模块**（要么在 M07 表冗余落库、要么让 M02 提供可分页的服务端筛选接口），**超出 F-18 范围与本轮能力边界**。
       - **注意**：给 coverage API 传 `state` 参数（`CoverageHandler` 确实支持 `c.Query("state")`）**解决不了总数问题**——coverage 是**全量按 `resource_category` 返回**（前端 `page_size: 1000`），与 M07 列表的分页是**两套独立分页**，M02 无法回答「第 N 页中符合采集状态的行数」。
       - **本轮处置：消除静默误导**。此前该限制完全静默，用户会误以为看到的是全量筛选结果；现于选中「采集状态」时展示 `Alert`（type=info）明确提示「仅过滤当前页；分页总数仍为未按此条件过滤的总数」，并说明其余五维均已服务端过滤。测试 `F-18：选中采集状态时提示其为前端过滤` 覆盖（未选时不提示 / 选中后提示）。
       - **口径纠正（勿误读）**：F-18 修复的是 **5 个筛选维度中的 2 个**（`biz_code` / `status`）+ 新增 3 个（`platform_code` / `app_code` / `service_code`）共**五维走后端**；**「分页总数不一致」未被F-18 彻底消除**，`collection_status` 是唯一剩余的前端过滤维度。彻底消除的前置条件是 M02 提供可分页的服务端筛选接口或 M07 冗余落库状态列，**须单独立项跨模块评估**。

### F-19. 服务字典「所属应用 / 主业务」关系维护：主业务为过度设计，只做「所属应用」（④ 需设计确认）

- **位置**：`ServiceManagementPage.tsx` 表单仅 4 项（`service_code` / `service_name` / `description` / `enabled`，约 L358-398），**无 `app_code`、无 `biz_code`**；后端 `platform/config/resource/service.go:142-146`（Update 支持写入两字段）、`:190-212`（`validateServiceRelationRefs` 校验应用 / 业务引用有效性）、`platform/models/service_dict.go`（`AppCode` / `BizCode` 字段齐备）；契约 PRD §5.22 L1144-1145、§5.24 L1194-1195。
- **现状（契约 vs 实现）**：PRD §5.22 与 §5.24 明确「服务字典维护页新增『所属应用 / 主业务』关系维护（决策 112）」且版本落点表列为 **MVP**；后端已完全就绪，**前端零实现**——四个字典页中只有应用页（`ApplicationDictPage`）真正落了关系维护。属**契约已定、实现缺位**。
- **PM 裁定（拆分）**：
  - ✅ **「所属应用」（`app_code`）保留并落地**——应用↔服务 1:N 关系紧密，是服务字典不可缺的关系权威；
  - ❌ **「主业务」（`biz_code`）判定为过度设计，本轮不做**——服务与业务在当前场景**没有真实关联**，理由见下。
- **「主业务」判定为过度设计的依据（消费方核查）**：全仓grep `.BizCode` 的读取点，服务字典 `ServiceDict.BizCode` 的命中**仅在服务字典自身的 CRUD 与校验路径**（`service.go` 的 to / Create / Update / `validateServiceRelationRefs`），**无任何业务消费方**：
  - 标签生成（`config/label/generator*.go`）不读服务字典 `biz_code`——`svc` label 恒取 `service_code`，业务 label 走**资源行** `biz_code`；
  - 配置生成（`configcenter/generator/targets.go`）注入 `biz_code` 时取的是**资源行** `h.BizCode` / `d.BizCode` / `a.BizCode` / `g.BizCode`，非服务字典；
  - 仪表盘聚合（`dashboard/summary.go`）按**资源行** `biz_code` 归因，`ServiceDict.BizCode` 零参与；
  - 前端 `ResourceFormDrawer` 的服务下拉过滤只用 `app_code`（`enabledServiceDicts`，L392-401），**不用 `biz_code`**。
  - 结论：服务字典 `biz_code` 是一个**只写不读**的字段——写它需要用户在两个页面维护同一份业务归属（服务字典 + 资源行 / 表单），却没有任何功能消费，属于**制造维护负担而不产生价值**，符合「过度设计」判据。
- **建议**：
  - 本轮只做「所属应用」：服务管理页表单增「所属应用」下拉（数据源= 应用字典启用条目，参照 `ApplicationDictPage` 的多选平台实现），列表增「所属应用」列（展示 `app_name`，缺条目回退 `app_code`，停用加「（已停用）」）；
  - 「主业务」**从 MVP 范围移出**，PRD §5.22 L1145 / §5.24 L1195 的「服务↔业务 N:1 主归属」由「MVP 交付维护表单」降级为 `{v0.3+}`（与 B 层对象拓扑同批）或标注「暂不落地，待出现真实消费方（如按业务域聚合服务 / 服务域视图）后再评估」，避免契约长期挂着无实现的空头条目；
  - **后端不动**：`ServiceDict.BizCode` 字段与 CRUD 支持保留（不改 schema、不删接口，避免已落库数据与API 契约破坏），仅**前端不暴露入口**；待重新评估时该字段可直接启用。
- **待设计侧确认**：PRD 上述降级涉及 §5.22 / §5.24 正文与版本落点表，须由设计侧回改（PM 已裁定方向，文档改动待执行）。
- **状态**：~~open~~ → **2026-10-03 前端已落地**：`ServiceManagementPage.tsx` 新增 `applications` state（应用字典失败不阻塞主流程，缺条目按 `app_code` 回退）、「所属应用」下拉（仅启用应用可选、编辑态已停用历史归属保留为回显项并标「（已停用）」）、列表「所属应用」列（`app_name` → 回退 `app_code` → 未挂显示 `-`）；提交契约区分 `null`（摘除）/ `undefined`（不改）。**`biz_code` 前端零入口**（无字段、无列、无下拉）。后端 `ServiceDict.BizCode` 字段与 CRUD **未动**。
  - **测试**：`ServiceManagementPage.test.tsx` 补 5 个F-19 用例（回显 / 摘除提交 null / 未改动时原样提交 / 停用应用回显 / 列表列解析），16/16 通过。
  - **PRD 侧已同步**（v2.51）：§5.22 六处 + §5.24 四处 + 验收项 / 术语表 + 术语「服务↔业务」降级为 `{v0.3+}`，并写明「后端字段与 CRUD 保留不动，仅前端不暴露入口」。
  - **遗留**：见下方「待设计侧确认」—— PRD 改写由设计侧 agent 于同轮完成（v2.51），此项可视为已闭环。

### F-20. 资源详情抽屉标签行过臃肿：三行卡片改单行紧凑（③ 优化，**2026-10-03 已落地**）

- **来源**：PM 在**另一会话**独立提出（非本次四项裁定范围），用户原话反馈「资源详情抽屉的标签样式太高、太臃肿」。该需求此前**只记在会话记忆、从未登记 dev-feedback**，实施轮才被发现与本轮 F-16 的 map 改名落在同一文件（`ResourceDetailDrawer.tsx`），故于 2026-10-04 补登为 F-20，以便 commit 分组时按来源分别归档。
- **位置**：`ui-custom/web/src/pages/resources/ResourceDetailDrawer.tsx` 的 `renderLabelRow` / `renderSourceTag` / `renderAnnotation`（**逻辑零改动，纯样式与布局**）。
- **现状（改进前）**：标签行为**三行灰底卡片**（第一行 key + 来源 Tag + 锁 + 文字按钮 / 第二行来源说明 / 第三行 value），含 `8px` padding + **`#FAFAFA` 硬编码背景**（不随皮肤切换），**≈96px / 条**。标签条数多时抽屉内纵向占位过大，需频繁滚动。
- **改造要点**：
  - 三行 → **单行 flex**：`key = value` + 来源说明 + 右侧（Tag / 锁 / 图标按钮），`padding: 6px 10px`；
  - 去 `#FAFAFA` 硬编码色，改透明底 + `borderBottom: 1px solid tokens.colorBorderSecondary`——**顺带修掉硬编码色不随皮肤切换的既有问题**；
  - 来源 Tag 改 `bordered={false}` + 12px / 18px 行高（去实心块观感）；
  - 来源说明改 12px 次要色 + 单行 ellipsis，**仍保留在 DOM 中**（不可只塞进 Tooltip title，见下）；
  - 编辑 / 删除改 **icon-only 按钮**，必须显式 `aria-label`（antd 图标的 aria-label 会混入 accessible name，否则 `getByRole('button', { name: /编\s*辑/ })` 匹配失败——见 skill `antd-icon-accessible-name-testing`）；
  - 锁图标仅 `isApplication && !canEdit` 显示；编辑态整行替换为 `Space.Compact`，不叠加新行；
  - 列表容器 `size={4}` + `maxHeight: 320` / `overflowY: auto`。
  - **效果**：≈96px → **≈37px / 条**（降幅约 62%）。
- **硬约束（改动时不可违反）**：来源说明文字「系统 / 用户 / CMDB · v0.4+ 预留」「手动添加」「来自 X · Y」及各按钮名，均为测试用 `getByText` / `getByRole` 断言的**既有契约**——产物只能改样式，**不得删除或改写文本**。（可复用经验：改 UI 密度前先 grep 测试里的 `getByText` / `getByRole` 断言，先确定哪些文本是契约。）
- **状态**：~~open~~ → **2026-10-03 已落地**，`ResourceDetailDrawer.test.tsx` 28/28、`ResourcesPage.test.tsx` 50/50 通过，eslint 该文件无告警，**测试文件未改**（契约文本均未变动）。
- **⚠️ 误判与恢复记录**：2026-10-03 复核时曾因该块不在四项裁定内、且注释含「保证文本仍可被 getByText 命中」字样，被误判为「为让测试通过而改产品 UI」的越界改造并 `git checkout` 回退；**PM 已指出该判断有误**——它是 F-20 这个正当需求的实现。已全量恢复（125+ / 53- 完整还原），并改写 F-13 下的错误留痕为「非越界，勿误判」。
  - **纪律**：判断「越界」的判据应是**改动是否有人提出过的正当需求**，而非**改动量是否超出本轮任务清单**；本工作区常并存多会话未提交改动，回退前**必须先向 PM 确认来源**。

---

## 15. 新增登记（2026-10-09，资源删除「引用保护」B 方案决策）

### F-21. 资源删除：从 PRD §6.6.1 的 403 拦截改为「静默放行 + 知情确认」（② 决策已拍板，待 PRD 回写）

- **类别**：② 实现/产品已决策（**B 方案**）；PRD §6.6.1 文字与代码现状冲突，待产品侧收割回写。
- **背景 / 触发**：M07 资源软删（DELETE `/resources/:resource_id`）修复变更检测失明期间，复盘「被采集 Job 引用的资源能否删除」——
  - **现状冲突**：`delete.go` 的 `TODO(M01)`（L29-32、L43-45）写明「被 ScrapeJob 引用时 **403** data 返回引用 Job 名单」，但 **M01 从未实现该 403 拦截**，代码实际**静默放行**（直接软删、不反向查 ScrapeJob）；而 PRD §6.6.1（L1353）与 M07 契约快照 §3 DELETE 行仍写 `forbidden`：被引用时禁止删除 + 回传引用名单 + 「查看引用 Job」跳转。属「代码与契约文字冲突」类问题（同构已在前序轮次修过的模式）。
  - **同类口径割裂**：生成侧 `generator/targets.go:282` 已实现 `if rt.Status=="offline"` → 静默排除 target（`SkipReasonOffline`），即「资源下线」已是**静默自愈**；而「资源删除」在 PRD 文字上仍是 403 拦截，两者自相矛盾。
- **三方案对比（Orchestrator 提供）**：
  | 方案 | 行为 | 评价 |
  | --- | --- | --- |
  | A：按 PRD 落地 403 | 删除被引用资源 → 403 拦截，data 回传引用 Job 名单，前端「查看引用 Job」跳转 | 制造「孤儿陷阱」：删除是高频管理动作、引用关系常滞后；硬拦阻断合法清理/重排，且与 offline 静默口径割裂 |
  | **B（采用）：静默放行 + 知情确认** | 删除仍成功（软删）；删除二次确认弹窗**回显**「该资源正被 N 个采集 Job 引用，删除后这些 Job 将停止采集该实例」+「查看引用 Job」跳转（由只读反查接口支撑） | 与 offline 一致（同属「这台不再采集」意图，静默自愈 + 知情）；软删可恢复，误删有退路 |
  | C：纯静默不提示 | 删除成功，无任何引用提示 | 背离 PRD「告知」初衷，用户无感知地让 Job 失去实例 |
- **一致性原则（B 方案根基）**：`delete`（软删，可恢复）与 `offline`（status 置 offline）都表达「这台资源不再被采集」的意图，应统一为「**静默自愈 + 知情确认**」：
  - 生成侧 `targets.go:282` 已对 offline 静默排除 target；
  - 删除侧改为：删除成功（软删），但前端确认弹窗经只读接口预检引用关系并回显，让用户知情。
  - **推论**：后续若「资源状态从运行中改为未上线/已下线」（`status` 枚举仅 `online/offline/maintenance`，无独立「未上线」，通常归 `offline`），逻辑与 offline 同构——同为「不再采集」意图，也应静默、不做 403 拦截。
- **⚠️ 边界提醒（务必保留）**：若未来改为**硬 purge**（`db.Unscoped().Delete`，真删而非软删），则「删了就找不回」成立、403 论据重立，B 方案须回退为 403 或增加二次硬性确认。当前实现为软删（BaseModel.DeletedAt 置位），B 方案论据成立。
- **落地动作（本轮已做）**：
  - 后端（`platform/`，依 backend-developer.md）：新增只读反查接口 `GET /api/v2/platform/resources/:resource_id/referenced-by` → `{jobs:[{job_name,network_domain_id,enabled}],total}`（查 `scrape_jobs.selected_instance_ids` 含该 resource_id 且未软删的 Job；停用 Job 同样计入引用、软删 Job 不计——与 M07 标签模板引用保护 §6.6.3.1 同口径）；`delete.go` 的 `TODO(M01)` 注释改写为 B 方案静默放行口径（不再 403）；M07 契约快照 §3 同步：DELETE 行去掉 `forbidden`、新增 GET `referenced-by` 行。
  - 前端（`ui-custom/web/`，依 frontend-developer.md）：`resourceApi` 新增 `referencedBy(id)`；资源列表删除由 `Popconfirm` 改为「先调 `referencedBy` 预检 → 二次确认弹窗回显引用数 + 引用 Job 名单 + 『查看引用 Job』跳转（`/scrape-jobs`）」。
  - **PRD §6.6.1（L1353）文字修订由产品侧收割**：`forbidden` → 「允许删除；删除二次确认弹窗回显引用该资源的采集 Job 数（含『查看引用 Job』跳转）后放行」，与 offline 静默口径对齐。本分支不修改 PRD（红线）。
- **影响模块**：backend `platform/config/resource`、frontend `ui-custom/web/src/pages/resources`、契约 `module-07/api-contract-snapshot.md`；PRD §6.6.1 待用户统一修改。
- **状态**：后端 + 前端已落地 + 单测通过；PRD 文字待用户回写。

---

## 16. 新增登记（2026-10-13，四层模型落地后模板填写引导全面失准）

> 触发：chenrt 用户实测反馈——「m07 模块变成平台应用服务业务四层模型后，当前下载模板时候的提示、Excel 的填写示例均和实际情况没有对上；现在加入网域管理后，是否抽屉中的网域字段变成了必填项而不是选填项」。
> 本节定性：本次问题属 **F-7（2026-09-19 模板「字典值告知」治本工程）的遗留欠账**——F-7 治的是「字典值陈旧」，本轮暴露的是「**必填口径与字段语义失准**」，两者不同源。
> 用户已拍板边界：**Excel 表内填写示例不做实时同步**（格式限制，代价过高），本轮只做「下载时静态生成的示例行 + 必填标记 + 口径文案对齐」。

### 关键事实校正：四层模型的层级顺序与「网域」的真实定位

实施前必须先纠正一处认知，否则修复方向会错：

| 项 | 代码权威事实 | 依据 |
| --- | --- | --- |
| 四层顺序 | **`platform(1) → app(N) → service(M) → instance(K)`** | 决策 104，`platform/models/platform_dict.go:5-8` |
| 「网域」是否在四层内 | **不在**。网域是 M06 的独立实体，`ID string`（业务字符串主键），与四层是**平行的归属维度**而非层级节点 | `platform/models/network_domain.go:61-104` |
| 四层如何关联 | **用字符串编码字段，不用外键**：`platform_code` / `app_code` / `service_code` / `resource_id` | 全仓不存在 `parent_id` / `platform_id` / `app_id` / `service_id` / `domain_id` 任一命名；网域字段是**唯一** ID 型引用 `network_domain_id` |
| 云（cloud） | 由所属网域派生，资源侧**只读**，无写入口 | 决策 103 scheme-B |

**结论**：设计本身自洽，问题不在模型，而在**引导层没跟上模型**。

### F-22. 模板填写提示与后端真实必填口径全面失准（③ 实现/优化缺口，P0）

- **类别**：③ 实现/优化缺口（前端硬编码文案 vs 后端按 category 分化的真口径）
- **位置**：
  - 前端 [TemplateDownloadModal.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx#L24-L39) `FILLING_TIPS`
  - 后端真口径：[excel.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/excel.go#L267-L279)（决策 93/95）+ [validate.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/validate.go#L357-L476)（分类型校验）
- **根因**：`FILLING_TIPS` 的类型是 `Record<ResourceCategory, string[]>`（看似按类分化），但**五类填的是同一句**「所属业务（必填）、所属应用（可选）」；而后端口径**按 category 分化**，故该句对 **database / middleware / application / generic_target 四类全是错的**。

- **五类真值对照表（修复的唯一权威依据，勿凭印象改）**：

  | 类别 | `biz_code` 业务 | `app_code` 应用 | `platform_code` 平台 | `cluster` 集群 | 依据 |
  | --- | --- | --- | --- | --- | --- |
  | host | 可空后补 | 可空 | 可空（留空按所属应用主平台兜底） | 无要求 | `excel.go:270` 无 case 命中 |
  | database | 可空后补 | **必填** | 可空 | **必填** | `validate.go:387-392` |
  | middleware | 可空后补 | **必填** | 可空 | **必填** | `validate.go:403-408` |
  | application | **必填** | **必填** | 可空 | **必填** | `excel.go:272-275` + `validate.go:433-444` |
  | generic_target | **二选一必填**（与 app_code 至少填一个） | **二选一必填** | 可空 | 无要求 | `excel.go:276-279`（决策 95）+ `validate.go:470-476` |

- **附带失准 1：网域必填性存在两条动线相反的口径**（直接回答用户提问）
  - **表单侧：网域已变为无条件必填**——`ResourceFormDrawer.tsx:503` 为 `rules={[{ required: true, message: '请选择网域' }]}`，后端 `validate.go:186` `validateCommon` 亦要求 `network_domain_id` 必填。
  - **导入侧：网域可空**——`excel.go:251-253` 留空时自动填 `models.DefaultDomainID`（= `"default"`，见 `network_domain.go:45`）。
  - **隐藏坑**：若 `default` 网域未在 M06「系统设置 → 网域管理」登记，留空导入会**直接失败**——`excel.go:254-257` 的 `networkDomainExists` 校验报「网域 default 未登记，请先到『系统设置 → 网域管理』登记后重新导入」。而前端提示 L180-182 恰恰在教用户「网域可留空——留空时平台自动归属默认网域」，**把一个可能直接报错的操作教成安全操作**。
  - **判定**：不是「网域从选填变必填」的模型变更，而是**同一字段两条动线必填性相反**的认知分裂。
  - **修法**：提示改为「网域**强烈建议填写**（决定云归属与隔离）；留空将自动归入默认网域 `default`，**该网域未登记时导入会直接失败**」。

- **附带失准 2：`zone_env` 是幽灵列**
  - `template.go:34-62` 的 `TemplateColumns` 中 host 含 `zone_env` 列，`buildValueSheet` L146 也为其写了取值说明（INT/GOV）；
  - 但前端五类 Tab 与 `resourceColumnPrefs.ts` 均**无该列**，用户看不到任何 `zone_env` 概念；L146 说明本身已写「**不进标签、不作分区权威（权威值为所属网域 zone_type）**」。
  - 即：模板要求用户填一个平台自己都不用、UI 也不展示的列。属 F-7 之后新增的失准。

- **附带失准 3：`cluster` 前后端必填性矛盾（既存缺陷，本轮仅登记不改）**
  - 后端 `validateDatabase` / `validateMiddleware` / `validateApplication` 均要求 `cluster` 必填（`validate.go:390-392 / 406-408 / 442-444`）；
  - 前端 `ResourceFormDrawer.tsx:603` `cluster` **无 rules**（选填），提交空值 → 后端 400。
  - **口径需设计裁定**（属 PRD 契约问题，非纯实现缺口）：要么 `cluster` 降为选填（后端三处放宽），要么前端补必填。**本轮不动，留待设计侧裁定**。
- **建议**：
  1. **`FILLING_TIPS` 按五类分化重写**：每类给出该类真实的「必填 / 选填」字段清单，用用户语言（`IP 地址` 而非 `instance_ip`），必填项前置并加「必填」标记；
  2. **网域提示按附带失准 1 改写**，去掉「可留空即安全」的误导表述；
  3. **`zone_env` 处理**：本轮先在提示中标明「仅主机兼容列，平台不据此分区，权威值为所属网域」；是否从模板移除待设计裁定；
  4. **`cluster` 必填性矛盾上报设计侧裁定**，本轮不改代码。
- **PRD 影响**：需回写 §5.2（`cluster` 必填口径）+ §5.6/§5.8 等 excel 章节的必填标注，属设计侧收割项。
- **状态**：open（本轮修 1、2；3、4 待设计裁定）

### F-23. Excel 填写示例缺位 + 同步能力边界澄清（③ 实现缺口 + 用户已拍板边界）

- **类别**：③ 实现/优化缺口
- **位置**：后端 [template.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/template.go#L229-L268) `buildTemplateXLSX`
- **实测事实**：
  1. **`buildTemplateXLSX` 只写 sheet1 第 1 行列头，无任何示例数据行**（全仓无静态 `.xlsx`，模板由后端 excelize 实时生成）。故「示例和实际对不上」的准确表述是「**示例根本不存在**」，而非「示例过时」；
  2. **模板字典值不陈旧**：`buildValueSheet`（L116-215）实时读运行时字典（`bizStore.EnabledList()` L149 / `appStore.EnabledList()` L161 / `platformStore.EnabledList()` L178 / `svcStore.EnabledList()` L196），即 F-7 治本部分仍然有效。**问题全在「口径说明」与「示例」两处**；
  3. **列名为英文码**（`instance_ip` / `biz_code` / `os_type`…），与页面中文列名（「IP 地址」/「业务名称」/「操作系统」）对不上号，用户需二次翻译。
- **同步能力边界（回答用户「会不会随填写变化、能否同步」）**：

  | 能力 | 现状 | 结论 |
  | --- | --- | --- |
  | 抽屉内「平台 → 应用 → 服务」三级级联下拉 | ✅ 已实现（`ResourceFormDrawer.tsx:360-401`，`Form.useWatch` + 本地过滤，无网络请求） | 已同步 |
  | 列表筛选的平台/应用级联 | ✅ 已实现（F-18，2026-10-07 落地） | 已同步 |
  | 模板 sheet2 字典值 | ✅ 已实时（读运行时字典） | 已同步（但非「随本次填写」同步） |
  | 导入逐行错误反馈 | ✅ 已实现（后端 `fieldErr` 逐行定位） | 已同步（事后） |
  | **Excel 表内填写示例随填写变化** | ❌ 做不到 | **格式天花板** |

- **为什么做不到（三条硬约束，非实现取舍）**：
  1. xlsx 是**下载时刻的静态快照**，文件落到用户磁盘后与平台再无连接；
  2. Excel 数据验证（DataValidation）**只支持单列独立枚举，不支持跨列级联联动**——而四层模型恰恰是级联关系；
  3. 前端**无 Excel 解析通道**（`ImportModal.tsx:103-121` 仅取 `originFileObj` 直接 POST multipart，不解析字段），要「读用户填写内容再回写提示」需引入解析库 + 重写导入文件，远超收益。
- **用户拍板（2026-10-13）**：「Excel 表里面的填写示例**不用实时同步**，这个代价太高了」→ 本轮**只做下载时静态生成的示例行**。
- **建议**：
  1. **`buildTemplateXLSX` 在列头下补 1 行示例数据行**（示例值取字典首项或占位值，必填列有值、选填列留空），并在行尾或 sheet2 说明「示例行请删除后再填」；
  2. **列名加中文释义**：sheet2 每行补「列名（中文含义）」，如 `instance_ip（IP 地址）`，解决英文码对不上号；
  3. **② sheet2 按 category 过滤 + 行序与 sheet1 对齐 → 下一轮**（见 F-24，工作量较大不在本轮）；
  4. 长期可选（**非本轮**）：导入前在前端做「模板版本/必填列自检」，属事前可自检能力的补齐，代价远低于实时同步。
- **状态**：open（本轮修 1、2；3 下一轮；4 不做）

### F-24. sheet2「取值说明」与 sheet1 按类列表头不对应（③ 实现缺口，P1）

- **类别**：③ 实现/优化缺口
- **位置**：后端 [template.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/template.go#L116-L215) `buildValueSheet`
- **现状**：
  - sheet1 的列按 category 定义（host 14 列 / application 16 列 / generic_target 17 列，各不相同）；
  - sheet2「取值说明」**五类共用同一批行**，且行序（L138 起 `network_domain` → `zone_env` → `biz_code` → `app_code` → `platform_code` → `service_code` → `env` → `status` → `custom_labels`）与 sheet1 列序**不一致**。
  - 后果：用户需在两张表之间人工比对，且会看到**本类根本不存在的列**（如 host 表里出现「服务」`service_code`、database 表里出现「自定义标签」`custom_labels`）。
- **建议**：`buildValueSheet` 接收 `category` 参数，**只输出该类 sheet1 实际存在的列**，且**行序与 sheet1 完全一致**（便于逐列对读）。
- **状态**：open（本轮一并修复）

### 本节汇总：本轮派发修复范围

| 编号 | 问题 | 落点 | 本轮是否修 |
| --- | --- | --- | --- |
| F-22-① | `FILLING_TIPS` 五类共用一句必填说明，四类失准 | 前端 `TemplateDownloadModal.tsx` | ✅ 修 |
| F-22-② | 网域提示把「留空即安全」教成安全操作（`default` 未登记会直接失败） | 前端 `TemplateDownloadModal.tsx` | ✅ 修 |
| F-22-③ | `cluster` 前后端必填性矛盾 | 前端 `ResourceFormDrawer.tsx` + 后端 `validate.go` | ❌ 待设计裁定 |
| F-22-④ | `zone_env` 幽灵列（UI 不展示、平台不用） | 后端 `template.go` 提示 + 前端提示 | ⚠️ 仅补说明，是否移除待裁定 |
| F-23-① | 模板无任何示例数据行 | 后端 `template.go` `buildTemplateXLSX` | ✅ 修 |
| F-23-② | 列名英文码与页面中文列名对不上号 | 后端 `template.go` `buildValueSheet` | ✅ 修（补中文释义） |
| F-23-③ | sheet2 按类过滤 + 行序对齐 | 后端 `template.go` | ✅ 修（与 F-24 同批落地） |
| F-24 | sheet2 与 sheet1 列不对应 | 后端 `template.go` | ✅ 修 |

- **影响模块**：backend `platform/config/resource`（`template.go`）、frontend `ui-custom/web/src/pages/resources`（`TemplateDownloadModal.tsx`）。
- **契约影响**：`api-contract-snapshot.md` 的模板下载接口**签名与响应不变**（仍返回 xlsx blob），sheet 内容属实现细节，**无需改契约**。
- **PRD 影响**：F-22-③ `cluster` 必填口径、F-22-④ `zone_env` 列存废，需设计侧在下一轮 PRD 迭代收割。

---

## 17. 新增登记（2026-10-13，导入「未登记编码」引导闭环修复）

> 触发：chenrt 用户追问——「用户在模板里填了平台、应用、服务、网域等，如果未在平台侧创建就擅自填了内容，导入时校验要做到位，**要引导用户先在平台侧登记，用户补录后再上传就能成功**，代码中是否考虑到了？」
> 核查结论：**后端校验与引导文案基本闭环，前端呈现层有 3 处缺口**。本节登记并已全部修复。
> 附带查明并向设计侧澄清一项事实：**「声明 sheet」= 用户在下载的模板里自行新增的一个工作表页**（sheet 名固定为「业务声明」「应用声明」「平台声明」「服务声明」，列头 `code | name | 说明?`），用户**不必离开 Excel**，可在同一文件内声明新编码；后端在同一 SQLite 事务内先建字典再落资源，一次导入成功（`excel_declare.go` + `import.go` L105-L138）。

### 核查基线：五维校验已闭环（无需修复的部分）

| 维度 | 校验位置 | 未登记时的引导文案 | 已停用时是否区分 |
| --- | --- | --- | --- |
| 网域 | `excel.go` L290-L292 | 网域 X 未登记，请先到『系统设置 → 网域管理』登记后重新导入 | 不区分（M06 无停用态） |
| 业务 `biz_code` | `excel.go` L305-L329 | 引导『业务管理』登记 **或** 附『业务声明』sheet | ✅ 用 `Lookup` 区分 |
| 应用 `app_code` | `excel.go` L335-L358 | 引导『应用管理』登记 **或** 附『应用声明』sheet | ✅ 用 `Lookup` 区分 |
| 服务 `service_code` | `excel.go` L364-L385 | 引导『服务管理』登记 **或** 附『服务声明』sheet | ✅ 用 `Lookup` 区分 |
| 平台 `platform_code` | `validate.go` `validatePlatformCode` | **修复前**：仅引导『平台管理』登记 | ❌ 修复前混成一句 |

- 「补录后再上传即可成功」成立：五维错误均为**行级错误**（`fieldErr`），不阻断其余行；字典补录后重传，原失败行即可通过。
- 声明 sheet 自身出错为**整批拒绝**（bad_request，资源一行不落），与行级错误是两套语义，勿混。
- 声明 sheet 四条安全红线：声明内重码硬拒绝 / 与存量字典同名不一致绝不覆盖 / 停用条目不接受声明激活 / 编码规范校验。

### F-25. 平台 `platform_code` 报错文案未提「平台声明」sheet —— 文案与能力不一致（③ 实现缺口，P1，已修）

- **类别**：③ 实现/优化缺口
- **位置**：[validate.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/validate.go) `validatePlatformCode`
- **实测事实**：后端**事实上支持**在导入文件里加「平台声明」sheet 声明新平台（`excel_declare.go` 的 `platformDeclareSheet` 常量 + `applyDeclaredDicts` 与资源同事务落库），但 `validatePlatformCode` 的报错只叫用户去『平台管理』页，**完全没提这个可用通道**。业务/应用/服务三处的文案都提了。
- **影响**：用户被引导去平台侧多走一趟，浪费一次导入往返；文案与真实能力不一致，属信任损耗。
- **修法**：未登记文案对齐 biz/app/service 双路径口径——去『平台管理』页登记，**或**在本文件「平台声明」sheet 补充后重新导入，并保留「旧模板可能缺最新字典值，请重新下载模板」提示。
- **状态**：✅ 已修（commit `73b4593`）

### F-26. 平台 `platform_code` 把「未登记」与「已停用」混成一句（③ 实现缺口，P2，已修）

- **类别**：③ 实现/优化缺口
- **位置**：同上 `validatePlatformCode`
- **实测事实**：原文案为「平台 %s 未登记或已停用，请在『平台管理』页登记或启用后重试」，用户无法判断该「登记」还是「启用」。biz/app/service 三处均已用 `Lookup()` 做区分，平台未跟进 → 五维口径不统一。
- **修法**：对 `platform_code` 做同样的 `Lookup` 区分——已停用 → 引导「已停用，请在『平台管理』页启用后重新导入」（**不含「未登记」字样**，以免被前端 F-27 误标为待登记）；未登记 → 引导登记（并提声明 sheet）。平台 store 的 `Lookup` 已存在（`platform.go` L66，签名与 app/svc store 同构），**无需新增 store 方法**。
- **不变式**：末尾「平台须属于 app_code 关联平台」的自洽校验逻辑与文案**未动**，并加 `NotContains("未登记")` / `NotContains("已停用")` 作回归护栏，防止自洽校验被误判成未登记。
- **状态**：✅ 已修（commit `73b4593`）

### F-27. 前端「待登记清单」高亮只覆盖业务和应用，服务/平台/网域拿不到引导信号（③ 实现缺口，P0，已修）

- **类别**：③ 实现/优化缺口（**本节中唯一直接阻断用户诉求闭环的一项**）
- **位置**：[ImportModal.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/resources/ImportModal.tsx) `isPendingRegistrationReason`
- **实测事实**：原判定为 `reason.includes('未登记') && /业务|应用/.test(reason)`，正则只含「业务」「应用」二字，因此**服务、平台、网域的未登记错误全部不命中**，只按普通错误行灰显，**没有 warning 高亮 + 图标 + 可执行指引**。后端明明已给出正确文案，用户却拿不到「请先到平台侧登记」的视觉信号 → chenrt 需求在 UI 层断链。
- **修法**：判定改为 `isPendingRegistrationError(error)` 两段式——
  1. reason 必须含「未登记」（**总闸**：「已停用」「不属于关联平台」两类文案均不含此字样，天然排除）；
  2. 显式排除「已停用」（加固不变量，防后端将来合并文案后误标）；
  3. **field 优先**：命中 `biz_code` / `app_code` / `service_code` / `platform_code` / `network_domain_id` 五维集合即判定；field 存在但不在集合内直接判否；
  4. **reason 兜底**：field 为空时退到 `/业务|应用|服务|平台|网域/` 语义判定（`ImportErrorDetail.Field` 有 `json:"field"` 标签但可能为空，故兜底不可省）。
  渲染沿用文件既有分支（`WarningOutlined` + `EllipsisText type="warning"`），未另起样式。
- **破坏验证**：临时改回旧正则后，服务/平台/网域 3 例确实变红（`Unable to find an accessible element with the role "img" and name "warning"`），其余 21 例新旧均绿 —— 证明改动**只扩大命中面，未破坏原有行为**。
- **状态**：✅ 已修（commit `d4d1c13`）

### 本节汇总

| 编号 | 问题 | 落点 | 状态 |
| --- | --- | --- | --- |
| F-25 | 平台文案未提「平台声明」sheet | 后端 `validate.go` | ✅ commit `73b4593` |
| F-26 | 平台未登记/已停用混成一句 | 后端 `validate.go` | ✅ commit `73b4593` |
| F-27 | 前端待登记高亮只覆盖业务和应用 | 前端 `ImportModal.tsx` | ✅ commit `d4d1c13` |

- **契约影响**：无。错误响应结构 `models.ImportErrorDetail` 未变，仅 `platform_code` 的 reason 文案内容变化（前端已适配）；模板下载接口亦不变。
- **遗留待设计裁定**：
  1. `app_platform_rel.go` L201 的「平台 %s 未登记或已停用，请到『平台字典』登记或启用后重试」仍与 F-25/F-26 新文案不同构。该入口属「应用↔平台关联」写入路径（非导入），**是否也支持声明通道需 PRD 确认**，本轮未动。
  2. **网域无声明 sheet 通道**（`excel_declare.go` 只有业务/应用/平台/服务四个）。网域只能去 M06 登记 —— 符合 chenrt「引导去平台侧登记」的诉求，但需在 PRD 中明示，避免用户误以为网域也能在 Excel 内声明。
  3. F-22-③ `cluster` 前后端必填性矛盾、F-22-④ `zone_env` 列存废，仍待设计裁定。

---

## 18. 新增登记（2026-10-15，接口服务第 6 类资源 + 拨测改资源选择 + 删除服务字典）

> 本轮为**用户拍板的功能改动**（非缺陷），开发已落地代码；本节登记**需设计侧回写 PRD / 修订既有提案**的口径变更。三件事彼此正交，但同批交付。

### F-28. 新增第 6 类资源「接口服务」（② 决策已拍板，待 PRD 回写）

- **类别**：② 决策已拍板、待设计侧回写 `Module_07`
- **位置**：`platform/models/interface_service.go`（新建）、`platform/models/resource_category.go`、`config/resource/*`、`ui-custom/web/src/**`
- **字段定稿**：
  - 类型专属：`api_name` 接口名（必填）、`api_url` 接口地址（必填，**完整 URL 含 `?` 查询参数**）
  - 公共（UI 暴露）：`network_domain_id`（必填）、`biz_code`（必填）、`app_code`（必填）、`env`（必填）、`status`（必填）
  - 采集状态为**派生列**（覆盖率接口），非存储字段
  - 嵌入 `models.ResourceBase`；`cloud_code` / `platform_code` / `cluster` / `owner` 保留列但不暴露
- **Excel 列序**：`network_domain, api_name, api_url, biz_code, app_code, env, status`（**不含 `scrape_port`**，理由见 F-29 附注）
- **标签模板默认映射**：`resource_id / platform_code→platform / api_name / api_url / app_code→app / env / cluster / biz_code→biz`，**刻意不含 `instance_ip:port → instance` 组合映射**（拨测目标是完整 URL，组合映射对其不成立）
- **待设计侧**：`Module_07` PRD 补第 6 类资源的字段表、模板列序、标签默认映射；`Module_05` L0 卡「五类台账合计」文案改「六类」
- **正则/枚举影响**：`ValidResourceCategories()` 追加到**末尾**（顺序即契约，与 `dashboard/summary.go` 的 `resourceModels()` 按下标对齐）

### F-29. 拨测（blackbox）目标从「手填」改为「从接口服务资源选择」（② 决策已拍板，待 PRD 回写）

- **类别**：② 决策已拍板、待设计侧回写 `Module_01` / `Module_09`，并**修订既有提案**
- **位置**：`strategy/scrapejob/{validate,selection,installation,preview}.go`、`configcenter/generator/targets.go`、`dashboard/summary.go`、`ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`
- **变更**：拨测 Job 的目标由手填 `blackbox_targets` 改为选择「接口服务」资源（`selected_instance_ids` + `resource_type=interface_service`）。**手填入口彻底禁用**（前端移除、后端拒绝写入）。
- **生成侧收益（本次的核心目的）**：黑盒 target 从此**带标签**（`resource_id` / `network_domain` / `cloud` / `zone` + 标签模板展开）。改造前黑盒分支产出的是 `Labels: map[string]string{}` 空标签，导致拨测数据无业务归属、也无法做采集状态回连。
- **待设计侧回写**：
  1. `Module_01`：拨测 Job 表单口径（手填 → 选资源）
  2. `Module_09`：黑盒 target 现在会带标签 —— 既有「blackbox 目标标签为空」的表述失效
  3. **需修订** `module-05/design-proposals/probe-ownership-alignment.md`：其现行口径「拨测目标不是 M07 资源台账对象、无应用/业务域归属」应**限定为「组件连通性拨测」**（如 grafana / mysql 端口类）。理由：接口服务是**对外提供的业务接口**，本身就是业务资产，与「开源组件连通性」正交。该提案 §5 遗留的「M01 拨测 Job 是否需要业务域归属」应更新为「已由接口服务台账承载」。
- **口径澄清（首页「已监控」）**：拨测**计入**「已监控」。改造前 `dashboard/summary.go` 只统计 `standard` 类型的 Job，而 `query/coverage.go` 本就聚合所有 job_type —— 两处不一致但被「黑盒 `selected_instance_ids` 恒空」掩盖。本轮已统一为「波测资源模式的选择计入已监控」。**「采集状态」沿用 `up`**（平台有没有在采它），接口通不通属**告警**范畴（`probe_success`，首页「拨测态势」面板表达），两者不可混。
- **附注：`scrape_port` 为何不适用于接口服务** —— 拨测用的是**平台自带**的 blackbox_exporter（`render.go` 固定 relabel 到 `127.0.0.1:9115`），采集器跑在采集节点本机、目标即完整 URL，**不存在「另有一个 exporter 采集端口」的语义**。与 host/db/mw 不同（那三类的 exporter 装在被采机器上，各域可能改端口，故 `scrape_port` 有意义）。

### F-30. 删除服务字典（ServiceDict / `service_code` / `svc` 标签）（② 决策已拍板，待 PRD 回写，破坏性）

- **类别**：② 决策已拍板、**破坏性变更**、待设计侧回写
- **位置**：后端约 30 文件、前端约 20 文件；删除 `models/service_dict.go`、`config/resource/service.go`、`ui-custom/web/src/pages/resources/ServiceManagementPage.tsx` 及导航项
- **变更**：`ServiceDict` 表与 CRUD、`Application` / `GenericTarget` 的 `ServiceCode` 字段、`service_code` Excel 列与筛选、标签模板中 `service_code → svc` 映射（含 seed 的 `ensureSVCMapping`）**全部下掉**。**`svc` 标签从此不再存在。**
- **数据**：存量 `application` / `generic_target` 行的 `service_code` 列数据**丢弃**（GORM 不删列，仅不再映射）。
- **待设计侧回写**：`Module_07` 应用 / 其他监控目标字段表去掉 `service_code`；`Module_01` 标签映射去掉 `svc`；`Module_05` 相关展示。API 契约快照同步。
- **同步删除的既有反馈**：F-19（服务字典「所属应用 / 主业务」关系维护）、F-27 中「服务」维度的待登记高亮 —— 服务概念已不存在，相关登记项作废。

### 本节汇总

| 编号 | 事项 | 落点 | 状态 |
| --- | --- | --- | --- |
| F-28 | 新增第 6 类资源「接口服务」 | 全栈 | ✅ 已实现，待 PRD 回写 |
| F-29 | 拨测目标改走资源选择 + 黑盒 target 带标签 | M01 / M09 / M05 | ✅ 已实现，待 PRD 回写 + 提案修订 |
| F-30 | 删除服务字典（`service_code` / `svc` 标签） | 全栈 | ✅ 已实现，待 PRD 回写 |

### 遗留待设计裁定（用户明确「后续去商量」，本轮不做）

1. **`ResourceBase` 的结构性与业务性重切**。用户提出建模原则：**网域是结构性不变量**（建任何资源模型都必须带且必填，用于 agent 选址）；**其余字段的取舍与必填性由建模者自由指定**。现状 `ResourceBase` 把二者混在一起 —— `ScrapePort` / `CloudCode` / `PlatformCode` / `BizCode` / `AppName` / `Env` / `Cluster` / `Owner` / `Status` 这些业务字段被"结构性"地塞给每一类。另有一处不一致：`ResourceBase` 实际只被 `Database` / `GenericTarget` / `InterfaceService` 嵌入，`Host` / `Middleware` / `Application` 各自重抄了列（`ResourceBase` 注释自承"existing models keep their legacy layout"）。
2. **Job 侧 target 拼接模式改造**。用户口径：采集端口本质是 Job 侧拼 target 的事，不是资源台账的事；资源侧的 `scrape_port` 只是"有些实例端口不统一"的让步产物。
3. **`env` / `status` 被 `validateCommon` 全局强制**：按第 1 条原则属"平台替建模者做决定"。用户表示环境可以放过，故本轮未动。

## 19. 新增登记（2026-10-16，拨测资源类别收敛两类 + 探测地址字段写死）

> 本轮为用户拍板的功能改动（非缺陷），承接 §18 **F-29**「拨测改走资源选择」——把 F-29 留给
> 用户的两个选择项各砍掉一个：类别由六类 → 两类，地址字段由「任选」→ 写死。

### F-31. 拨测资源类别限「接口服务 / 应用服务」，探测地址字段写死

- **类别**：② 决策已拍板、待设计侧回写 `Module_01`
- **落点**：
  - **权威映射**：`platform/models/resource_category.go` 新增 `BlackboxProbeCategories()` /
    `BlackboxTargetField()` / `BlackboxCategoriesHint()`
  - **后端**：`strategy/scrapejob/validate.go`（类别门禁 + 按类别推导 `TargetField`）、
    `strategy/scrapejob/selection.go`（候选第二列按类别推导探测字段）
  - **前端**：`ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`（类别下拉只列两类、
    删除「探测地址字段」输入项）、`strategyConstants.ts`（展示文案常量）
- **变更**：
  1. `resource_type` 由「六类任一」收敛为 **interface_service / application** 两类；其余四类
     一律 `bad_request`（`拨测任务的资源类别只能是 interface_service/application，当前 "database"`）。
  2. 「探测地址字段」**不再由用户选择**：接口服务固定 `api_url`（接口地址）、应用服务固定
     `health_check_url`（健康检查 URL）。前端移除输入项、**不再提交 `target_field`**；后端在
     `validateJobRequest` 中按类别推导并**覆盖**客户端传值（原「字段须属该类别可读字段」的校验
     随之删除 —— 推导值构造上必然合法）。
- **理由（用户口径）**：只有这两类的地址字段本身就是**完整 URL**，可直接作为拨测目标；其余类别的
  地址是 IP / 端点，拨测需另拼协议与端口。且字段与类别**一对一**，不存在需要用户裁决的自由度。
- **兼容性**：
  - `target_field` 仍保留在请求体与响应中（响应供回显 / 追溯），**传了不生效**（被推导值覆盖）；
  - **存量 Job 生成侧不受影响**：`configcenter/generator/targets.go` 仍按 `job.TargetField` 原值解析，
    已有的非两类拨测 Job 照常产出配置；但**下次编辑保存时会被新门禁拦下**，需改选两类之一。
    按用户裁定**不做数据迁移**（存量仅 1 条接口服务 + 1 条应用服务，实际无受影响数据）。
- **测试**：后端将原 `TestCreateScrapeJobBlackboxNonInterfaceServiceCategory`（旧口径断言
  「database 类别可创建」）**反转为 400 拒绝**，并新增 `TestCreateScrapeJobBlackboxTargetFieldDerived`
  （三例：不传字段 → 推导 api_url / 传非法字段 → 仍被覆盖 / 应用服务 → 固定 health_check_url）；
  前端改写 3 条用例，新增「拨测类别只列两类」。
- **待设计侧回写**：
  1. `Module_01` §5.4 拨测表单口径（六类 → 两类；删除探测地址字段选择项）
  2. API 契约快照 blackbox 段：`target_field` 标注为**派生只读**字段

| 编号 | 事项 | 落点 | 状态 |
| --- | --- | --- | --- |
| F-31 | 拨测类别收敛两类 + 探测地址字段写死 | M01 / M07 | ✅ 已实现，待 PRD 回写 |

## 20. 新增登记（2026-10-18，标签模板新增「字典翻译」转换规则）

> 用户拍板：指标的标签值目前直接落字典编码（如 `app="ceshi"`、`env="prod"`），
> 面板上不可读。标签模板新增一种转换规则 `dict`（字典翻译），把引用字典 /
> 固定枚举的来源字段值翻译为展示名后再生成 Prometheus 标签；只改标签模板能力，
> 不改动其他页面。

### F-32. 标签模板转换规则新增 `dict`（字典翻译）

- **类别**：② 决策已拍板、待设计侧回写 `Module_07` §5.11 / API 契约快照
- **需求口径（用户 2026-10-18）**：
  - 只新增一种转换规则，选中后把字典编码翻译为中文展示名；
  - 仅对「字典或引用字段」生效，普通字段不提供该选项；
  - 存储层与 Prometheus 标签名不变，仅标签值在**配置生成时**翻译；
  - 不修改其他页面（资源详情 / 查询 / 告警等）的展示逻辑。
- **支持的来源字段（仅 `source_type=resource_field`）**：

  | 来源字段 | 翻译来源 | 示例 |
  | --- | --- | --- |
  | `app_code` / `app_name`（历史键名） | 应用字典 `app_code → app_name` | `ceshi` → 测试应用 |
  | `biz_code` | 业务字典 `code → name` | `authorized-ops` → 授权运营 |
  | `platform_code` | 平台字典 `platform_code → platform_name` | `k8s-prod` → 生产 K8s 平台 |
  | `network_domain_id` | 网域 `id → name` | `mc-a` → 政务网 A 区 |
  | `env` | 固定枚举（非 DB 字典） | `prod` → 生产 |

- **实现落点**：
  - **模型 / 校验**：`platform/models/label_rules.go` 新增 `LabelTransformDict`、
    可翻译字段集合与 `env` 中文枚举；`platform/config/label/mappings.go` 的
    transform 枚举增加 `dict`，并新增「dict 仅允许 resource_field + 支持字段」的
    组合校验（新增 / 编辑映射、模板级 mappings 校验三处入口）；
  - **配置生成**：新增 `platform/configcenter/generator/label_dict.go`（一次 Job
    生成内缓存应用 / 业务 / 平台 / 网域字典，避免 N+1）；`generator/labels.go`
    在 `expandLabelTemplate` 的 resource_field 分支应用翻译，字典未命中回退原始
    code；`generator/targets.go` 在目标解析前加载字典缓存；
  - **前端**：`labelTemplateConstants.ts` 增加 `dict` 选项与可翻译字段清单；
    `MappingDrawer.tsx` 仅对支持字段展示「字典翻译（显示名）」选项，切换来源
    类型 / 字段时自动清理不兼容规则；`TemplateDetailTabs.tsx` 转换规则列显示
    中文（字典翻译 / 转小写等）。
- **生成期边界**：
  - `composite` / `prometheus_builtin` / `cmdb_field` 来源使用 `dict` 会被
    后端 400 拒绝；
  - 字典缺条目 / 编码未登记时**回退原始 code**，不丢标签、不阻断生成；
  - `network_domain` / `cloud` / `zone` 三个标签由 system 层强制注入且受保护，
    模板层同名映射会被静默覆盖——如需翻译网域，请映射到自定义目标标签
    （如 `network_domain_id → domain_name`）；
  - 默认模板只读，需克隆后或使用自定义模板才能配置 `dict`。
- **顺带修复（字典翻译前置缺陷）**：`generator/targets.go` 的资源字段视图
  此前对 host / database / middleware / generic_target 只暴露历史键
  `app_name`，不含 §5.12.1 权威字段 `app_code`，导致默认模板的
  `app_code → app` 映射对这四类资源**恒不产出 `app` 标签**。本次补齐
  `app_code`（同时保留 `app_name` 兼容）与 `network_domain_id`。**行为影响**：
  四类资源重新生成配置后将按默认模板开始产出 `app` 标签，属修复而非回归。
- **测试**：
  - 后端：`platform/config/label` 新增 dict 合法 / 非字典字段拒绝 / composite
    拒绝用例；`platform/configcenter/generator` 新增 `dict` 翻译与未命中回退
    单测、host 生成链路 `app_code + dict` 端到端用例；
  - 前端：`MappingDrawer.test.tsx` 新增「支持字段显示 dict 选项并提交」
    「非字典字段不显示 dict 选项」；`TemplateDetailTabs.test.tsx` 断言
    `dict` / `lower` 中文展示。
  - 验证命令：`CGO_ENABLED=1 go test ./platform/config/label/...
    ./platform/configcenter/generator/...`；`pnpm --dir ui-custom/web test --
    src/pages/label-templates`。
- **待设计侧回写**：
  1. `Module_07` §5.11 转换规则枚举补 `dict`（字典翻译），并列出支持字段；
  2. API 契约快照 `transform_rule` 枚举补 `dict` 及组合约束（仅
     `resource_field` + 字典 / 枚举字段）；
  3. §5.12.1 明确 `app_code` 为 host / database / middleware / generic_target
     的字段视图键（`app_name` 仅历史兼容）。

| 编号 | 事项 | 落点 | 状态 |
| --- | --- | --- | --- |
| F-32 | 标签模板转换规则新增 `dict`（字典翻译） | M07 / M09 | ✅ 已实现，待 PRD 回写 |

## 21. 新增登记（2026-10-18，拨测 Job 标签模板选择缺失）

> 用户实测：在采集 Job 中配置「拨测」任务时，表单不显示标签模板选择区，
> 无法确认当前用的是哪套标签方案，也无法更换。经排查为前端条件渲染缺陷，
> 配置生成侧实际会回落到资源类别的默认模板。

### F-33. 拨测 Job 无法查看 / 更换标签模板

- **类别**：③ 实现缺口（前端），待设计侧确认 `Module_01` 拨测表单口径
- **根因（代码证据）**：
  - `ScrapeJobFormDrawer` 的 `resourceCategory` 仅由 `monitor_type` 推导；
  - 拨测分支隐藏 `monitor_type`、改用 `resource_type`（接口服务 / 应用服务），
    因此 `resourceCategory` 恒为 `undefined`，`filteredLabelTemplates` 为空；
  - 标签模板区渲染条件为 `monitorType && filteredLabelTemplates.length > 0`，
    拨测场景直接落入空态，选择器完全不渲染。
- **实际生效行为**：`configcenter/generator/data_source.go::LoadTemplateForJob` 在
  `job.LabelTemplateID == ""` 时回落 `LoadDefaultTemplate(db, job.ResourceType)`，
  即**拨测 Job 默认使用所选资源类别的默认标签模板**，但 UI 既不可见也不可改。
- **修复**：
  1. `resourceCategory` 在 `jobType === 'blackbox'` 时取 `resource_type`
     （`blackboxCategory`），采集场景仍取 `monitor_type` 推导值；
  2. 标签模板区抽取为 `renderLabelTemplateSection()`，采集 / 拨测两个分支共用；
  3. 空选项文案由「不关联标签模板」改为「使用默认标签模板（模板名）」，
     与生成侧回落语义一致；无默认模板时才显示「不关联」；
  4. 切换任务类型或拨测资源类别时把 `label_template_id` 重置为 `''`
     （回到默认模板），避免跨类别残留；表单初值同样为 `''`，保证默认态可见；
  5. 拨测类别变更同时清空已选实例（原有行为）与已选模板。
- **兼容性**：未改变提交契约 —— `label_template_id` 留空仍提交 `undefined`，
  生成侧回落逻辑不变；存量拨测 Job 未挂模板者继续使用类别默认模板。
- **测试**：`ScrapeJobFormDrawer.test.tsx` 新增「blackbox：按拨测资源类别展示
  标签模板并可切换方案」（断言只列所选类别模板、默认选项文案、切换后提交
  `label_template_id`）；原编辑态单选断言改为前缀匹配，避免命中默认选项文案。
- **待设计侧回写**：`Module_01` §5.4 拨测表单补「标签模板」选择项，并明确
  「留空 = 使用该资源类别默认标签模板」；API 契约无变化。

| 编号 | 事项 | 落点 | 状态 |
| --- | --- | --- | --- |
| F-33 | 拨测 Job 无法查看 / 更换标签模板 | M01 / M07 | ✅ 已实现，待 PRD 回写 |
