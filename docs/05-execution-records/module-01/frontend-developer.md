# frontend-developer 执行记录 — Module_01（MVP）

> 归属：MetricCenter 前端开发（frontend-developer）
> 范围：`ui-custom/web/` 策略域页面（采集 Job / 规则等）的验收修复记录。

## 2026-08-26（user-verify-fix）

### 采集 Job 启停操作可发现性 + 二次确认；规则挂载提交默认启用

#### 问题
1. 用户验收反馈：采集 Job 列表的启用/停用是一个挤在操作列里的小号无文字 `Switch`，显示不明显，且点击直接生效无确认。M01 PRD（破坏性操作二次确认）要求禁用 Job 前弹确认并提示影响范围。
2. 规则挂载抽屉按钮文案「保存并下发」名不副实（实际只到 M09 变更单 pending，下发需人工确认），且创建请求漏传 `enabled`，叠加后端零值导致规则保存后变「停用」（后端修复见 `backend-developer.md`）。

#### 修复
- `src/pages/strategy/ScrapeJobListPage.tsx`：
  - 启停控件由小号无文字 `Switch` 改为有文字链接按钮「停用」（danger）/「启用」，与「编辑/删除」按钮风格一致，提升可发现性；
  - 增加 `Popconfirm` 二次确认：停用提示「将从下发配置中移除，相关监控中断；需到配置变更页确认后生效」，启用提示「将重新纳入配置下发」；okText「确认停用/确认启用」（停用 danger）。
  - `change_status=pending` 的禁用守卫（决策 44-1）保持不变。
- `src/pages/strategy/RuleMountDrawer.tsx`：
  - 创建请求显式携带 `enabled: true`（M01 PRD §8「创建默认启用」，与采集 Job 抽屉 `ScrapeJobFormDrawer.buildBody` 口径对齐）；
  - 按钮文案「保存并下发」→「提交生效」（与采集 Job 抽屉一致；成功提示仍引导「变更将由 M09 生成变更单并下发」）。

#### 新增/修改测试
- `ScrapeJobListPage.test.tsx`：
  - 既有「pending 禁用守卫」用例的 `getAllByRole('switch')` 改为按「停用」按钮断言；
  - 新增「停用需 Popconfirm 二次确认」用例：点击「停用」仅弹确认（提示监控中断、不调接口），点「确认停用」后才以 `enabled: false` 调用 update。
- `RuleMountDrawer.test.tsx`：按钮文案断言改为「提交生效」；创建断言补 `enabled: true`。

#### 验证
- `pnpm vitest run`（ScrapeJobListPage / RuleMountDrawer / RulesPage）18 个用例通过；`pnpm lint` 通过；`pnpm test` 全量 317/318 通过，唯一失败 `src/api/resources.test.ts`（`new Response(blob)` 在 jsdom 环境 `object.stream is not a function`）为本次改动前已存在的问题，与本次修复无关。

## 2026-08-26（规则管理增强 F-24：资源类别级联 + 类型列/筛选）

### 背景
- 后端 F-24 落地 `monitor_type` 接收与筛选、组名唯一校验（见 `backend-developer.md`）；前端按 v0.2 设计提级 MVP，补齐 CI 类型组织入口。

### 实现
- `src/api/monitoringRules.ts`：`MonitoringRuleInput` / `MonitoringRuleListParams` 增加 `monitor_type`。
- `src/pages/strategy/RuleMountDrawer.tsx`：新增「资源类别 → 监控对象类型」两级级联（复用 `MONITOR_TYPE_CASCADE` / `CATEGORY_MAP` / `MONITOR_TYPE_MAP`，与 MappingDrawer/ScrapeJobFormDrawer F1-8 同源）；均可选——切换类别清空已选类型，未选类别时类型平铺全部候选；提交载荷仅 `monitor_type`（`resource_category` 仅表单级联，不入库）；类型字段 extra 提示「所有启用规则将合并为同一份 rules.yml，组名须全局唯一」。
- `src/pages/strategy/RulesPage.tsx`：列表新增「监控对象类型」列（`MONITOR_TYPE_MAP` 映射，空显 `-`）；FilterBar 新增「监控对象类型」筛选（平铺全部类型）；详情抽屉补「监控对象类型」行。

### 新增/修改测试
- `RuleMountDrawer.test.tsx`：新增级联用例（选「数据库」→ 候选收敛、选 MySQL → 提交载荷含 `monitor_type: 'mysql'`、不含 `resource_category`）。
- `RulesPage.test.tsx`：首用例补 `monitor_type: 'mysql'` 断言列表映射展示「MySQL」。

### 验证
- `pnpm vitest run`（RuleMountDrawer / RulesPage）9 用例通过；`pnpm test` 全量 321/322 通过（唯一失败仍为改动前已存在的 `src/api/resources.test.ts` jsdom `Response.stream` 问题）；`pnpm lint`、`tsc --noEmit` 通过。

## 2026-08-26（采集器管理三联修复 F-26）

### 背景
- 用户测试「登记采集器 → 新增默认采集配置」动线发现三个问题（分析见 dev-feedback F-26）：来源下拉提供必然 400 的 official/third_party 选项；新增默认采集配置提交报 `cannot unmarshal number into ... exporter_template_id of type string`；登记/「去配置」后抽屉不携带模板上下文。

### 实现（纯前端，后端校验口径不变）
- `src/pages/strategy/MappingDrawer.tsx`：
  - 采集器下拉 `Select.Option value={String(t.id)}`——契约口径为字符串承载数字 ID，修复 JSON number 导致的 400；
  - 新增 `initialTemplate?: ExporterTemplate | null` prop：新增态预填采集器 + 模板默认端口/采集路径/协议（预置参数=官方默认值参考，可改）。
- `src/pages/strategy/ExporterTemplateDrawer.tsx`：`SOURCE_OPTIONS` 收敛为仅「内部自建」（对齐 PRD §5.2 L334 与后端校验），extra 标注「官方/第三方由平台预置、只读维护」。
- `src/pages/strategy/CollectorTemplatesTab.tsx`：新增 `prefillTemplate` 状态；模板行「去配置」按行预填；登记成功自动打开「新增默认采集配置」并预填新采集器（复用 C1 回调参数）；Steps 动线描述与空态按钮文案收敛为「登记内部自建采集器（官方/第三方由平台预置）」。

### 新增/修改测试
- `MappingDrawer.test.tsx`：模板 fixture id 改 number（回归真实 JSON），断言提交 `exporter_template_id === '5'`；新增 initialTemplate 预填用例（选中项回显名称 + 默认端口/路径带入）。
- `ExporterTemplateDrawer.test.tsx`：新增「来源下拉仅内部自建，无官方/第三方」用例。
- `CollectorTemplatesTab.test.tsx`：空态按钮文案断言同步为「登记内部自建采集器」。

### 验证
- `pnpm vitest run`（MappingDrawer/ExporterTemplateDrawer/CollectorTemplatesTab）20 用例通过；`pnpm test` 全量 325/326（唯一失败为改动前已存在的 `src/api/resources.test.ts` jsdom `Response.stream` 问题）；`tsc --noEmit`、`pnpm lint` 通过。

## 2026-08-26（F-27 A/B：采集器删除入口 + 映射抽屉类型过滤）

### 背景
- 用户发现自建采集器无删除入口（后端 DELETE 早已就绪，纯前端缺口）；supported_monitor_types 无任何消费约束。用户拍板 A+B+C（后端 C 见 backend-developer.md）。

### 实现
- `src/pages/strategy/CollectorTemplatesTab.tsx`（A）：模板行操作列加「删除」（Popconfirm 二次确认，仅 `is_builtin=false` 显示；内置/被引用由后端 forbidden 兜底并以 message 呈现）；操作列宽 100→150。
- `src/pages/strategy/MappingDrawer.tsx`（B）：采集器下拉按所选 monitor_type 过滤——保留声明支持该类型的 + 未标注类型（空数组）的模板；已选中模板始终保留避免回显裸 ID；编辑态不过滤；空态 notFoundContent 引导「先登记采集器」；extra 说明过滤口径。

### 新增/修改测试
- `CollectorTemplatesTab.test.tsx`：新增「删除按钮仅非内置显示 + Popconfirm 确认后调 remove」用例（mock 补 `exporterTemplateApi.remove`）。
- `MappingDrawer.test.tsx`：新增「按 supported_monitor_types 过滤下拉候选」用例（mysql 类型下 node-exporter 不出现、未标注模板保留）。

### 验证
- `pnpm test` 全量 327/328（唯一失败仍为改动前已存在的 `resources.test.ts` jsdom 问题）；`tsc --noEmit`、`pnpm lint` 通过。

## 2026-08-26（F-28：参数区稀疏继承 placeholder + 查看抽屉 + 映射行删除）

### 背景
- 用户质疑采集参数重复填写（采集器→默认采集配置→Job 三遍），并要求：登记采集器后可「查看」登记信息（含 supported_monitor_types）；默认采集配置行可删除。配合后端层叠默认链（见 backend-developer.md F-28）。

### 实现
- `src/pages/strategy/MappingDrawer.tsx`：F-26 值预填改为 placeholder 稀疏继承——「去配置」/登记成功引导仅预填采集器选择；默认端口/采集路径/协议 placeholder 展示所选采集器默认参数（`selectedTemplate` 派生），协议改 allowClear Select；间隔/超时 placeholder 提示全局默认 15s/10s；新增「留空=继承」说明 Alert；提交时空值显式归一为 `''`/`0`（编辑态清空=恢复继承）。
- `src/pages/strategy/ScrapeJobFormDrawer.tsx`：参数区 4 字段摘除必填；`handleMonitorTypeChange` 不再值预填参数（默认采集器/标签模板仍自动带出），改为 `mappingDefaults` state 驱动 placeholder（映射有值显「留空继承默认采集配置（x）」，否则显采集器/全局兜底提示）；`buildBody` 空值归一为 `''` 提交；参数区下加继承语义说明。
- `src/pages/strategy/CollectorTemplatesTab.tsx`：模板行 + 映射行新增「查看」只读详情抽屉（Descriptions 全字段：名称/版本/来源/内置标记/支持的监控对象类型 Tags/端口/路径/协议/OS/架构/下载/文档/安装指南）；映射行新增「删除」（仅非内置，Popconfirm 确认，调 `ciExporterMappingApi.remove`）；操作列宽 150→210；采集参数列稀疏值显示「15s（默认）/10s（默认）」。

### 新增/修改测试
- `MappingDrawer.test.tsx`：F-26 预填用例改写为 placeholder 语义（无 display value）；新增「留空提交稀疏值（''/0）」用例。
- `ScrapeJobFormDrawer.test.tsx`：新增「参数可留空 + placeholder 继承提示 + 稀疏提交 + 默认采集器带出」用例。
- `CollectorTemplatesTab.test.tsx`：mock 补 `ciExporterMappingApi.remove`；新增「映射行删除（仅非内置）」「查看抽屉含 supported_monitor_types」2 用例。

### 验证
- `pnpm test` 全量 334/335（唯一失败仍为改动前已存在的 `resources.test.ts` jsdom `Response.stream` 问题）；`tsc --noEmit`、`pnpm lint` 通过。
