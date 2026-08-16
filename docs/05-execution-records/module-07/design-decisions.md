# Module 07 监控对象管理 — 原型设计决策记录

| 字段 | 值 |
|------|-----|
| 模块 | Module 07：监控对象管理 |
| PRD 版本 | v1.2 |
| 原型分支 | design/module-mvp-demo |
| 执行日期 | 2026-08-03 |
| 执行 Agent | prototype-designer |
| PRD 状态 | 设计中 → 原型验证中 |

---

## 1. 执行目标

按照 PRD v1.2 优化 Module 07 原型，确保：
1. **数据字段定义清晰** — 所有数据模型、枚举、字段对齐 PRD，v0.4+ 预留字段明确标注
2. **功能设置合理** — MVP 功能完整，P1/P2 功能以占位形式展示，模块边界清晰
3. **需求理解到位** — 模块间职责划分、数据流向、只读字段等约束在 UI 中可视化说明

---

## 2. Gap 分析（PRD vs 原型）

### 2.1 数据字段层面

| Gap | PRD 依据 | 修复方式 |
|-----|---------|---------|
| `SourceType` 缺少 `cmdb` 枚举值 | PRD 5.2 | 补充 `cmdb` 为 v0.4+ 预留 |
| `ResourceStatus` 缺少 `orphan` 枚举值 | PRD 5.2 | 补充 `orphan` 为 v0.4+ 预留 |
| `ResourceLabel` 缺少 `created_at`/`updated_at` | PRD 5.3 | 补充时间戳字段，更新全部 mock 数据 |
| 缺少 `StatusMappingRule`/`StatusMappingConfig` 数据结构 | PRD 5.5.2/5.5.3 | 新增接口定义与 mock 配置 |
| 缺少 `CMDBProvider` 接口 | PRD 8 | 新增接口定义与 `MOCK_PROVIDERS` 列表 |
| 缺少 `LABEL_SOURCE_PRIORITY` 常量 | PRD 5.3 | 新增 `cmdb > user > system` 优先级映射 |
| 缺少 `ALL_STATUS_VALUES`/`CMDB_FIELD_OPTIONS` 常量 | PRD 5.2/5.12 | 新增用于只读展示与 v0.4+ 字段选项 |

### 2.2 功能设置层面

| Gap | PRD 依据 | 修复方式 |
|-----|---------|---------|
| 缺少 P1 批量标签编辑占位 | PRD 3.3（P1） | ResourcesPage Drawer 中新增 Alert 占位 |
| 缺少 P1 模板克隆功能 | 模板管理增强 | LabelTemplatesPage 新增克隆按钮 |
| 默认模板可被删除 | PRD 6.1 | 新增删除保护，默认模板不可删 |
| 保护 Prometheus label 未校验 | PRD 5.3/3.3 | 映射保存时校验 target_label |
| CMDB 字段选项返回空数组 | PRD 5.12 A | 改为返回 `CMDB_FIELD_OPTIONS` |
| 状态映射可配置规则未在 UI 展示 | PRD 5.5.2/5.5.3 | LabelTemplatesPage 新增说明 Alert |

### 2.3 需求理解层面

| Gap | PRD 依据 | 修复方式 |
|-----|---------|---------|
| 缺少模块边界说明 | PRD 1/3.1 | 三个页面均新增模块边界 Alert |
| `is_monitored` 未标注只读 | PRD 3.1/5.2 | 表头新增 Tooltip 说明由 Module_01 维护 |
| 导入校验演示不完整 | PRD 6.2 | 补充重复检测、网域存在性校验错误示例 |
| 缺少跨模块导航占位 | Agent Phase 4 | MainLayout 补充 Module_01/09/02/08/06/Dashboard 占位 |
| 表单字段缺少 PRD 引用 | PRD 5.6-5.9 | 所有表单字段新增 `extra` 提示 |

### 2.4 测试覆盖层面

| Gap | PRD 依据 | 修复方式 |
|-----|---------|---------|
| 缺少状态映射规则测试 | PRD 5.5.1-5.5.4 | 新增 5 条测试 |
| 缺少保护 label 测试 | PRD 5.3/3.3 | 新增 2 条测试 |
| 缺少导入模板列测试 | PRD 6.1 | 新增 6 条测试 |
| 缺少 ResourceLabel 时间戳/优先级测试 | PRD 5.3 | 新增 5 条测试 |
| 缺少 CMDBProvider 测试 | PRD 8 | 新增 2 条测试 |
| 缺少 is_monitored/CMDB 字段测试 | PRD 3.1/5.2/8 | 新增 2 条测试 |

---

## 3. 关键设计决策

### 3.1 v0.4+ 预留字段处理策略

**决策**：所有 v0.4+ 预留的枚举值（`cmdb`、`orphan`、`cmdb_field`）在类型定义中存在，但在 MVP mock 数据中不使用。UI 中以 `{v0.4+}` 标签标注，表单选项中 `disabled` 或不展示。

**理由**：类型完整性保证未来扩展不需要破坏性变更；mock 数据不使用避免 MVP 阶段产生混淆。

### 3.2 模块边界可视化

**决策**：在 ResourcesPage、LabelTemplatesPage、ImportHistoryPage 三个页面顶部均添加模块边界 Alert，明确说明：
- Module_07 是被动数据提供方
- `is_monitored` 由 Module_01 维护，只读展示
- 不生成/下发 Prometheus 配置
- CMDB 同步由 Module_04 负责

**理由**：原型评审时让所有参与者直观理解模块职责划分，避免越界设计。

### 3.3 状态映射可配置说明放置位置

**决策**：在 LabelTemplatesPage 和 ImportHistoryPage 均展示状态映射规则说明，但 UI 配置入口标记为 P2（PRD 5.5.5）。

**理由**：状态映射与 Excel 导入强相关，在导入记录页展示符合用户操作路径；在标签模板页展示是因为模板管理是配置类操作的集中入口。

### 3.4 保护 Prometheus label 校验

**决策**：在 LabelTemplatesPage 的映射保存逻辑中校验 `target_label` 不在 `PROTECTED_PROMETHEUS_LABELS` 列表中。例外：`composite` 来源的 `instance_ip:port → instance` 映射允许（因为这是 Prometheus 的标准 instance 映射方式）。

**理由**：PRD 5.3/3.3 明确要求保护内置 label，但 `instance` label 通过组合字段映射是 Prometheus 的标准实践。

### 3.5 跨模块导航占位

**决策**：MainLayout 侧边栏展示全部模块的导航结构，非 Module_07 的菜单项以 `disabled` 状态展示，并标注版本（`{MVP}`/`{v0.2}`/`{v0.3}`/`{v0.4+}`）。

**理由**：Agent Phase 4 要求全局信息架构完整，让评审者理解 Module_07 在整个产品中的位置。

---

## 4. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/mocks/module-07.ts` | 完全重写 | 补全枚举/接口/常量/mock 数据 |
| `src/layouts/MainLayout.tsx` | 完全重写 | 补充跨模块导航占位 |
| `src/pages/ResourcesPage.tsx` | 完全重写 | 模块边界/导入校验/P1占位/is_monitored标注 |
| `src/pages/LabelTemplatesPage.tsx` | 完全重写 | 模块边界/状态映射说明/克隆/删除保护/label校验 |
| `src/mocks/module-07.test.ts` | 完全重写 | 测试用例从 12 条扩展到 35+ 条 |

---

## 5. PRD 待确认项

以下在原型过程中发现的 PRD 待确认/建议调整项，需用户确认后更新 PRD：

1. **P1 模板克隆**：PRD 未明确编号，原型中作为模板管理增强添加，是否纳入 P1？
2. **保护 label 例外**：`composite → instance` 映射是否应作为保护 label 的例外允许？当前原型允许。
3. **状态映射 UI 配置入口**：PRD 5.5.5 标记为 P2，原型中仅展示说明不可编辑，是否符合预期？

---

## 6. 验收标准对照

| PRD 验收标准（§11） | 原型覆盖 |
|---------------------|---------|
| 四类资源 CRUD | ✅ ResourcesPage 完整实现 |
| 标签模板按资源类型管理 | ✅ LabelTemplatesPage 完整实现 |
| 资源标签三来源 + 优先级 | ✅ mocks + ResourcesPage Drawer 展示 |
| Excel 导入 + 校验 + 状态映射 | ✅ ImportHistoryPage + 导入弹窗演示 |
| is_monitored 只读 | ✅ 表头 Tooltip + 只读展示 |
| 模块边界（不生成/下发配置） | ✅ 三页面 Alert + MainLayout 底部说明 |
| v0.4+ 预留字段标注 | ✅ 全部 v0.4+ 字段/枚举/选项标注 `{v0.4+}` |

---

## 补充对齐：2026-08-11（标签模板需求澄清轮）

- **参与 Agent**：prototype-designer
- **触发原因**：用户基于 Module_07 / Module_01 需求提出四组问题——①模板列表「默认模板 vs 采集参数/内置参数」划分与规定工作流；②「组合字段」含义；③模板列表不展示模板 ID、Module_01 如何关联；④标签模板管理是否应迁至 Module_01。经 AskUserQuestion 确认三项决定（归属保持 Module_07、删除示例模板、UX 改进一并落地）后落地。

### 关键决策

#### 决策 3.6：模板列表不存在「默认模板 / 采集参数·内置参数」类别划分；示例模板清理

- **问题**：原型 mock 中「主机内置字段（示例）」「通用目标采集参数（示例）」等模板使模板列表呈现"默认模板 vs 采集参数/内置参数"两个类别，PRD 无此设计。
- **结论**：字段来源（resource_field / prometheus_builtin / composite / cmdb_field）是**映射级**维度，不是**模板级**分类维度；模板列表只有「默认模板（is_default）」与「自定义模板」之分。删除 4 个示例模板，新增有业务语义的自定义模板「Redis 高可用标签模板」。
- **影响范围**：Module_07 原型 mock（module-07.ts）、PRD 3.2（v1.7）。

#### 决策 3.7：Prometheus 内置字段由 Prometheus 原生注入，MVP 模板不做内置字段透传映射

- **问题**：把 `job` / `__scheme__` / `__metrics_path__` 映射到自身是否必要？
- **结论**：内置字段由 Prometheus 从 Job 配置与 scrape 配置**原生注入**，模板映射到自身是空操作；`source_type=prometheus_builtin` 保留为 v0.2+ 服务发现 / relabel 场景预留。MVP 默认/自定义模板均不使用该来源。
- **影响范围**：Module_07 PRD 3.2 / 5.12 B（v1.7）、原型 mock 与测试。

#### 决策 3.8：新增映射时目标标签默认 = 来源字段（resource_field），composite 默认 instance

- **问题**：多数 resource_field 映射目标标签与来源字段同名（env→env、cluster→cluster），逐个输入冗余。
- **结论**：新增映射时 `target_label` 自动预填来源字段名（用户可修改，不覆盖手输值）；`composite` 来源固定预填 `instance`。
- **影响范围**：Module_07 原型 LabelTemplatesPage、PRD 5.11（v1.7）、验收标准。

#### 决策 3.9：同一模板内 target_label 必须唯一，保存时校验

- **问题**：同一模板两个映射输出同一 label 会产生覆盖歧义。
- **结论**：保存映射时校验 `target_label` 唯一（编辑自身排除）；与既有保护 label 校验（composite→instance 例外）共同构成模板校验规则。
- **影响范围**：Module_07 原型 LabelTemplatesPage、PRD 3.2 / 5.11（v1.7）。

#### 决策 3.10：模板管理归属保持 Module_07；模板列表展示模板 ID；Module_01 只读关联预览 + 跨模块跳转

- **问题**：模板列表不展示 `template_id`（名称在同一资源类型下可重复），Module_01 关联模板后看不到模板信息；是否应将标签模板管理整体迁至 Module_01？
- **结论**：
  1. **管理归属保持 Module_07**——`ResourceLabel.source=system` 由 LabelTemplate 生成（标签数据与生成规则同层），模板字段词汇表同源于 Resource 数据模型；Module_01 已承载 CI 映射 / Job / 指标库 / 规则编辑，迁移会进一步加重且割裂对象层；
  2. Module_07 模板列表与详情卡片展示 `template_id`（code 样式，可复制）；
  3. Module_01 以「名称（类别 / 模板ID）」展示，选择模板后**内联只读预览映射内容** + 「前往标签模板管理」跨模块跳转（Module_01 只读引用，不重复编辑）。
- **依据**：Module_01 决策 15（标签模板继承链）；对象层（标签契约）与策略层（标签引用）职责划分。
- **影响范围**：Module_07 PRD 5.10 / 11 验收标准（v1.7）、Module_01 PRD 5.1/5.4（v2.5）、两模块原型。

#### 决策 3.11：组合字段为跨层解析契约（Resource.instance_ip + 策略层 default_port）

- **问题**：host 资源无 `port` 字段，`instance` 的端口从何而来？
- **结论**：组合字段 `instance` = `Resource.instance_ip` + Module_01 `CITypeExporterMapping.default_port`（或 Job 覆盖值），最终由 Module_09 生成配置时解析。MVP 保留单一预设 `instance_ip:port → instance`；v0.2+ 可扩展为表达式语法（如 `${instance_ip}:${port}`）或按资源类型的有限预设集。
- **影响范围**：Module_07 PRD 5.12 C（v1.7）。

### 已确认项（2026-08-11）

- [x] 模板管理归属保持 Module_07（用户选择「保持 Module_07 + UX 补齐」）。
- [x] 删除示例模板（用户选择），MVP mock 仅保留四类默认模板 + 「Redis 高可用标签模板」。
- [x] 目标标签默认值 + 映射校验一并落地 PRD 与原型（用户选择「一起落地」）。
- [x] 验证通过：test 46/46、lint、build、dev server 200。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（尚未完成完整两段评审，待领导/业务评审反馈）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.7）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.5）
- `docs/prototypes/module-07/`

---

## 补充对齐：2026-08-11（第二轮 UI/UX 优化）

- **参与 Agent**：prototype-designer
- **触发原因**：用户基于标签模板页与 CI-Exporter 映射页展示提出 UI/UX 优化诉求，经 AskUserQuestion 确认三项方向（M01 模板展示改两行卡片+预览抽屉、M07 分栏+搜索筛选+抽屉编辑、不做分页），并补充确认资源管理页布局与「列显隐配置」范围后落地 PRD

### 关键决策

#### 决策 3.12：标签模板页改为「左右分栏 + 搜索/筛选 + 抽屉编辑 + 映射分组展示」

- **问题**：标签模板页左侧模板 List（无搜索/筛选）+ 右侧映射 Table（无分组），模板与映射编辑用 Modal 会遮住映射表格，无法对照编辑。
- **结论**：
  1. 左侧模板列表：按资源类型 Tab + **搜索框** + **默认/自定义筛选**；
  2. 右侧映射明细：按**来源类型分组**（资源字段 / 组合字段）展示，来源与目标标签对照清晰；
  3. 模板级（新增/改名/克隆/删除）与映射级（新增/编辑/删除）操作统一改为**右侧抽屉（Drawer）**，编辑时保留模板与映射上下文。
- **依据**：用户视角设计规范（任务导向、编辑时保留上下文）；Modal 遮挡上下文是明确的反模式。
- **影响范围**：Module_07 PRD 3.2 / 9 / 11（v1.8）；原型 LabelTemplatesPage（待 v1.4 落地）。

#### 决策 3.13：MVP 不做分页（搜索/筛选优先）

- **问题**：模板列表与映射表格是否需要分页？
- **结论**：MVP 不做分页——每类资源模板通常 1~5 个、映射 5~15 条，分页收益低；模板规模化后（v0.2+）通过搜索/筛选而非分页解决。
- **依据**：数据量分析；用户选择「不做分页」。
- **影响范围**：Module_07 PRD 3.2（v1.8）。

#### 决策 3.14：资源新增/编辑改为抽屉；资源列表保持「Tab + 表格 + 详情抽屉」结构

- **问题**：Module_07 资源管理页布局是否要与标签模板页统一？
- **结论**：任务不同（资源页是对象 CRUD + 标签，模板页是配置编辑），不强求同布局——资源列表保持「资源类型 Tab + 表格 + 行点击详情抽屉（含标签管理）」；但资源**新增/编辑改为右侧抽屉**，与模板页抽屉编辑方式统一。
- **依据**：四类资源字段差异大，左右分栏信息密度失衡；编辑容器统一为抽屉即可保证交互一致性。
- **影响范围**：Module_07 PRD 3.1 / 9 / 11（v1.8）；原型 ResourcesPage（待 v1.4 落地）。

#### 决策 3.15：资源列表新增「列显隐配置」（P1）

- **问题**：资源列表固定列无法满足不同用户查看不同字段的诉求（如中间件类型、网域、来源、CMDB 字段）。
- **结论**：列表工具栏提供「列设置」入口，用户可勾选显示/隐藏列（含中间件类型、网域、来源等）；隐藏仅影响当前用户视图，不改变数据与默认列。「网域」列默认展示，隐藏需用户主动关闭（不推翻决策「单网域模式网域列不可隐藏」的默认展示要求）。
- **依据**：用户确认「CI 的展示可以让用户选择是否在前端展示」即列显隐配置；企业产品列表列配置常见实践。
- **影响范围**：Module_07 PRD 3.1 / 11（v1.8，P1）；原型 ResourcesPage（待 v1.4 落地，P1 可占位）。

### 已确认项（2026-08-11 第二轮）

- [x] M01 标签模板展示：两行卡片 + 预览抽屉（用户选择）。
- [x] M07 标签模板页：分栏 + 搜索筛选 + 抽屉编辑（用户选择）。
- [x] 不分页（用户选择）。
- [x] 资源管理页：保留现布局 + 编辑改抽屉（用户选择）。
- [x] 「CI 展示可配置」= 资源列表列显隐配置（P1）（用户选择）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v1.4 落地与验证（用户确认后执行，原型需符合 PRD v1.8）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.8）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.6）
- `docs/prototypes/module-07/`

---

## 补充对齐：2026-08-11（第三轮 需求澄清）

- **参与 Agent**：prototype-designer
- **触发原因**：用户基于 Module_07 提出四组需求疑问（Excel 状态映射可配置规则的实现版本、转换规则含义与交互、组合字段跨层取值时序、Prometheus 内置字段来源），并追加讨论端口不一致的解决手段；经讨论与 AskUserQuestion 确认后合并落地 PRD

### 关键决策

#### 决策 3.16：Excel 状态映射保持 MVP 配置层 + UI 只读；明确 Excel 枚举一致性规则

- **问题**：Excel 状态映射可配置规则前端是否要做？在哪个版本实现？MVP 是否规定 Excel 字段/枚举与线上一致？
- **结论**：
  1. 前端现状为**只读展示**（导入记录页 / 标签模板页说明区），MVP 无 UI 编辑入口——映射字典 MVP 由配置/SQL 管理，**v0.4+ 在 Module_05 系统设置提供映射规则管理**（P2）；
  2. Excel 枚举一致性：`status` 列**允许**业务语言（运行中/已停止/维护中）经映射转线上枚举；其他枚举列（`env`/`protocol`/`scheme`）**强制与线上一致**，不一致导入报错；固定列结构必须与模板一致。
- **依据**：MVP 范围控制；用户选择「保持 MVP 配置层 + UI 只读」。
- **影响范围**：Module_07 PRD 5.5.5（v1.9）。

#### 决策 3.17：转换规则（transform）交互改为下拉选择且可留空

- **问题**：当前原型 transform 为自由 Input，用户手填不准确；transform 是否必填？
- **结论**：**可留空**（留空 = 原样透传，绝大多数映射不需要变换）；UI 改为下拉「无（默认）/ lower / upper / prefix {P1} / replace {P1}」；`prefix`/`replace` 需要参数（前缀值 / pattern+replacement），参数化编辑 P1，MVP 置灰。
- **依据**：transform 语义为对标签值做字符串变换（大小写/前缀/正则替换），用于对齐字段值与标签格式；用户确认「下拉+可留空，P1 参数化」。
- **影响范围**：Module_07 PRD 5.11 / 11.1（v1.9）；原型 LabelTemplatesPage（待落地）。

#### 决策 3.18：组合字段取值时序写入 PRD（port 取映射 default_port，与 Job/Exporter 无关）

- **问题**：用户创建映射时尚未配置采集 Job / 安装 Exporter，组合字段取值是否有问题？
- **结论**：**不会取不到值**——模板定义只声明规则；`port` 来自映射层预设 `default_port`（创建映射时已填），与 Job/Exporter 状态无关；真正出值在 Module_09 生成配置时逐个实例拼接。唯一风险是配置正确性（default_port 与实际监听端口不一致 → instance 错），解决手段见 Module_01 5.1「端口一致性说明」。PRD 5.12 C 补充「取值时序」。
- **依据**：跨层契约（Resource.instance_ip + 策略层 default_port）；用户确认「PRD 明确时序语义」。
- **影响范围**：Module_07 PRD 5.12 C（v1.9）。

#### 决策 3.19：prometheus_builtin 在 MVP 新增映射时隐藏，枚举保留数据模型

- **问题**：Prometheus 内置字段来源是静态还是动态？用户是否不需要手动映射？
- **结论**：内置字段为**静态枚举**（`__address__`/`__scheme__`/`__metrics_path__`/`job`/`instance`），由 Prometheus **原生注入**，用户**不需要**手动映射；MVP 新增映射时**隐藏 `prometheus_builtin` 来源**（只保留资源字段/组合字段，cmdb_field v0.4+ disabled），枚举保留在数据模型供 v0.2+ 服务发现 / relabel 场景启用。
- **依据**：用户确认「隐藏，数据模型保留」；与决策 3.7 一致。
- **影响范围**：Module_07 PRD 5.12 B / 3.2 / 11.1（v1.9）；原型 LabelTemplatesPage（待落地）。

### 已确认项（2026-08-11 第三轮）

- [x] Excel 状态映射保持 MVP 配置层 + UI 只读（用户选择）。
- [x] transform 下拉 + 可留空，prefix/replace P1 参数化（用户选择）。
- [x] 组合字段取值时序写入 PRD（用户选择）。
- [x] prometheus_builtin MVP 隐藏、数据模型保留（用户选择）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v1.5 落地与验证（用户确认后执行，原型需符合 PRD v1.9）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.9）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.7）
- `docs/prototypes/module-07/`

---

## 补充对齐：2026-08-11（第四轮 合规闭环）

- **参与 Agent**：prototype-designer（基于用户对 6 项优化建议的确认实施）
- **触发原因**：用户要求将上一轮检查提出的 6 项优化建议全部落地（接口设计章节、原型版本对齐、原型文案技术术语清理、组合字段用户层说明、组合字段出值技术验收、标签模板用户故事回写），PRD 升版 v2.0、原型同步 v2.0。

### 关键决策

#### 决策 3.20：PRD 新增「6. 接口设计」章节（MVP 最小 REST 契约）

- **问题**：PRD 骨架规范要求"内容至少包含…API 规范"，Module_07 仅有 6.x Excel 规范与 8 CMDBProvider Go 接口，无 Resource / LabelTemplate / ResourceLabel 的 REST 契约；对比 Module_02/10 均有独立接口章节。
- **结论**：新增第 6 章「接口设计」，包含 6.1 资源管理 API（CRUD + Excel 导入 + 模板下载）、6.2 资源标签 API（user 来源可写，system/cmdb 只读）、6.3 标签模板 API（含映射子资源与克隆）、6.4 导入记录 API、6.5 Module_01/09 只读消费契约；原 6~11 章顺延为 7~12，正文引用（见 6.2 / 6.1 模板列）同步更新。
- **影响范围**：Module_07 PRD 章节编号、原型注释中的 PRD 引用（6.x → 7.x）。

#### 决策 3.21：原型版本号与 PRD 版本号对齐 v2.0

- **问题**：完成后汇报要求"原型版本号必须与 PRD 版本号一致"；此前 PRD v1.9 vs 原型 v1.5，mock 头注释仍写「对齐 PRD v1.5」，design-decisions 中"原型 v1.5 落地与验证"长期待确认。
- **结论**：本次 PRD 升版 v2.0 后，原型版本同步 v2.0；`module-07.ts` 头注释、`module-07.test.ts` describe、README 声明均更新为 v2.0；原型已实际包含 v1.8/v1.9 的 UI/UX（分栏 + 抽屉 + 分组 + transform 下拉 + prometheus_builtin 隐藏），本轮清理文案后重新验证 tsc/lint/build/test（47/47）通过。
- **影响范围**：Module_07 原型 mock / README / test。

#### 决策 3.22：原型用户可见文案按「提示分区规范」清理实现层引用

- **问题**：LabelTemplatesPage / ResourcesPage / ImportHistoryPage 用户可见 Alert / extra / Tooltip 中残留 `LabelTemplate`、`Module_01/04/09`、`Resource.status`、`mock`、`{P1}`、`{v0.4+}` 等实现层引用，违反提示分区规范（用户 UI 文案讲人话、不含决策/PRD/模块引用）。
- **结论**：页面主区 Alert 与表单 extra 全部改为用户语言（如「标签模板怎么用」「本页只维护监控对象数据」「组合字段 = 由多个字段拼接生成的标签，无需填写数值」）；技术细节与完整决策清单（3.1~3.19）集中在 MainLayout 全局折叠区「原型与实现说明」；版本标注由「{v0.4+} / {P1}」改为「后续版本开放」。
- **影响范围**：Module_07 原型三页面 + MainLayout；PRD 提示分区规范（v1.5 已含，本轮在原型落地）。

#### 决策 3.23：组合字段用户层说明 + 出值技术验收写入 PRD

- **问题**：组合字段完整说明集中在技术层 5.12 C，用户层（3.2 功能表）只有「字段来源配置」一行；12.2 技术验收无组合字段出值验证项。
- **结论**：3.2 增加组合字段用户语言说明（组合字段 = 由多个字段拼接生成的标签，如实例标识 instance = 目标 IP + 端口；用户只需选择预设组合，无需填写数值）；12.2 新增 {P1} 技术验收「组合字段出值」——模板 API 仅存规则不存实例值，生成配置阶段 instance = Resource.instance_ip + 策略层 default_port（契约见 5.12 C / 6.3）。
- **影响范围**：Module_07 PRD 3.2 / 12.2（v2.0）。

#### 决策 3.24：标签模板管理用户故事回写全局库（M07-OPS-07）

- **问题**：标签模板管理为 P0 核心功能，但模块级用户故事仅三条（导入 / 临时添加 / 覆盖率），无对应故事条目，JTBD 对齐不完整。
- **结论**：在 `01_User_Stories.md` §4.7 注册 `M07-OPS-07`（运维工程师：为资源类型创建/编辑标签模板，定义字段到监控标签的映射，以便监控数据带统一归属标签），PRD 第 2 章引用该编码（遵守「先回写全局库再引用」约束）。
- **影响范围**：01_User_Stories.md §4.7、Module_07 PRD 第 2 章（v2.0）。

### 已确认项（2026-08-11 第四轮）

- [x] PRD 新增接口设计章节（决策 3.20）。
- [x] 原型版本对齐 v2.0 + 重新验证通过（决策 3.21）。
- [x] 原型用户可见文案技术术语下沉折叠区（决策 3.22）。
- [x] 组合字段用户层说明 + 出值技术验收（决策 3.23）。
- [x] 标签模板用户故事回写全局库 M07-OPS-07（决策 3.24）。
- [x] 验证通过：test 47/47、lint、build、tsc。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 dist 统一入口访问验证（GitHub Pages 结构）待最终评审时确认。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.0）
- `docs/02-product-requirements/01_User_Stories.md`（§4.7）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.7）
- `docs/prototypes/module-07/`

---

## 补充对齐：2026-08-11（第五轮 组合字段交互修复）

- **参与 Agent**：prototype-designer
- **触发原因**：用户走查原型发现「组合字段」交互与 PRD 不一致——①目标标签是否默认不可改、直接代入；②port 非资源字段时组合字段枚举从何而来、是否按 CI 类型内置。经流程分析确认两处原型 Bug，用户确认落地修复。

### 关键决策

#### 决策 3.25：composite 来源时目标标签锁定为 instance（不可编辑）

- **问题**：PRD 5.12 C 规定组合字段 `target_label` 固定为 `instance`，但原型映射抽屉中目标标签输入框未锁定，用户可改，与"固定"语义不符。
- **结论**：选择 `source_type=composite` 时，目标标签输入框 `disabled` 锁定为 `instance`（表单 extra 提示「组合字段固定生成 instance 标签，无需修改」）；切回 `resource_field` 时恢复可编辑并预填来源字段。PRD 5.11 同步澄清「composite 来源目标标签锁定为 instance、不可编辑」（v2.1）。
- **影响范围**：Module_07 原型 LabelTemplatesPage（mapping 抽屉）；PRD 5.11 / 12.1（v2.1）。

#### 决策 3.26：保存校验补全 composite→instance 例外（修复拦截 Bug）

- **问题**：`instance` 在 `PROTECTED_PROMETHEUS_LABELS` 保护列表中，原型保存校验未实现决策 3.4 的「composite→instance 例外」，导致选择组合字段后保存被拦截报错、映射无法创建——这是原型实际运行 Bug（用户在原型上无法新增 composite 映射）。
- **结论**：`handleSaveMapping` 中，当 `source_type === 'composite' && target_label === 'instance'` 时跳过保护标签拦截（其余保护标签仍拦截）；与测试断言（module-07.test.ts 已有 composite→instance 例外用例）一致。PRD 12.2 新增「composite→instance 例外校验」技术验收（v2.1）。
- **影响范围**：Module_07 原型 LabelTemplatesPage（保存校验逻辑）；PRD 12.2（v2.1）。

### 已确认项（2026-08-11 第五轮）

- [x] composite 来源目标标签锁定 instance（决策 3.25）。
- [x] 保存校验补全 composite→instance 例外（决策 3.26）。
- [x] 验证通过：test 47/47、lint、build、tsc。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 dist 统一入口访问验证（GitHub Pages 结构）待最终评审时确认。
- [ ] 组合字段枚举是否按 CI 类型开放预设集（v0.2+ 决策，MVP 维持单一预设，不落地）。

### 关联文档

- `docs/05-execution-records/module-07/design-decisions.md`（本文件）
- `docs/prototypes/module-07/src/pages/LabelTemplatesPage.tsx`
- Module_07 PRD v2.0 5.12 C / 3.2

---

## 补充对齐：2026-08-11（第六轮 标签治理收敛）

- **参与 Agent**：prototype-designer（基于用户对资源详情标签管理与标签模板断层问题的需求讨论）
- **触发原因**：用户指出资源详情「标签管理」的来源分类（cmdb / 用户 / 系统）与标签模板的字段来源分类（组合字段 / 资源字段）对不上，要求澄清二者交互与联动；经心智模型差异识别与需求对齐确认四项决策后，落地文档层修改（PRD v2.2 + Module_01 v2.9），原型改动下轮执行。

### 关键决策

#### 决策 3.27：资源标签（实例层）与标签模板（规则层）是同一体系的「规则→实例」关系

- **问题**：资源详情标签管理（来源：system/user/cmdb）与标签模板页（来源类型：resource_field/composite/cmdb_field）分类维度不同，用户无法对应。
- **结论**：两者是**规则层 vs 实例层**的同一体系——模板中 resource_field/composite 映射实例化到每个资源 → 生成该资源 system 来源标签；cmdb_field → cmdb 来源（v0.4+）；user 标签为资源级手动附加（模板层无对应）。MVP 原型/PRD 未展示该联动，需补充标注与引导。
- **影响范围**：Module_07 PRD 3.3 / 5.3（v2.2）、原型（下轮）。

#### 决策 3.28：修正 5.3 与 5.14 矛盾——system 为系统保护标签，user 不可覆盖

- **问题**：5.3 表述「冲突优先级 cmdb > user > system（用户可覆盖系统 label）」与 5.14「system 为系统保护标签不可被覆盖」矛盾；原型按 5.14 实现（system is_editable=false）。
- **结论**：统一为 **system 不可被 user 覆盖**（与 5.14 一致）；冲突优先级表述改为 `cmdb` > `user`（对非 system 标签）。用户需改 system 标签值时应修改模板或使用不同 key 的新标签。
- **影响范围**：Module_07 PRD 5.3 / 3.3 / 12.2（v2.2）。

#### 决策 3.29：system 标签实时计算、不落库（生成配置时计算）

- **问题**：system 标签的生成时机未明确——落库重算（模板变更需批量任务）还是实时计算？
- **结论**：**实时计算、不落库**——Module_09 生成 `prometheus.yml` 时按 Job 引用的模板对 `selected_instance_ids` 逐个实例计算；模板变更立即生效于下次生成（无批量重算任务）；模板变更穿透引用它的 Job，使配置产生 diff，纳入 Module_09「配置变更确认→下发」流程。
- **影响范围**：Module_07 PRD 5.3（v2.2）；与 Module_09 3.3.1 约定对齐。

#### 决策 3.30：标签配置唯一入口原则——类型级走模板、实例级走 user 标签、Job 仅引用模板

- **问题**：用户诉求——引导用户通过「新增/编辑模板」管理标签，而非实例级配置；避免配置入口过多引发歧义与溯源困难；标签管理集中在 Module_07。
- **结论**：确立「标签配置唯一入口原则」：①类型级标签唯一编辑入口 = 标签模板（Module_07）；②实例级标签唯一编辑入口 = 资源详情 user 标签（system/cmdb 只读）；③策略层（Job）仅引用模板（允许换用其他模板，引用级），不提供 Job 内标签编辑；④**不引入实例级模板**（MVP 与 v0.2+ 均不引入）。
- **依据**：单一事实来源 / 分层治理 / 防配置漂移最佳实践；用户确认「仅文档层落地」「保留 Job 换模板」。
- **影响范围**：Module_07 PRD 5.3（v2.2）、Module_01 PRD 5.2 标签模板引用语义澄清（v2.9）。

#### 决策 3.31：资源详情标签管理联动呈现——来源标注 + 模板跳转 + 类型级变更引导

- **问题**：如何在 UI 上消除「系统/用户/CMDB」与「资源字段/组合字段」的断层，且引导用户走模板而非实例级覆盖？
- **结论**：①system 标签标注「来自 XX 模板 · app_name→app」+「前往标签模板管理」跳转；②user 标注「手动添加」、cmdb 标注「CMDB 同步（后续版本）」；③用户添加标签 key 与模板映射目标冲突时提示「该标签由标签模板生成，如需修改请前往标签模板管理」，引导类型级变更。资源详情展示全量标签、仅 user 可编辑（12.1 验收补充）。
- **影响范围**：Module_07 PRD 3.3 / 12.1（v2.2）；原型 ResourcesPage（下轮落地）。

### 已确认项（2026-08-11 第六轮）

- [x] 联动呈现：标注来源映射 + 跳转模板页（用户确认）。
- [x] 生成时机：实时计算写入 PRD，同步 Module_09 约定（用户确认）。
- [x] 标签管理收敛：引导新增模板、Module_07 集中管理、不引入实例级模板（用户确认）。
- [x] Job 换模板：保留（引用级，不编辑内容）（用户确认）。
- [x] 落地范围：仅文档层（PRD v2.2 + Module_01 v2.9 + 本记录）；原型改动下轮执行。
- [x] 原型落地（2026-08-11 下午确认执行）：
  - Module_07 ResourcesPage：新增 `findTemplateSource` / `isTemplateMappedLabel` 辅助（按资源类型+标签 key 查模板映射）；system 标签标注「来自 XX 模板 · source_field→target_label」+ 点击跳转 `/label-templates`；user 标注「手动添加」、cmdb 标注「CMDB 同步（后续版本）」；新增标签 key 与模板映射目标冲突时弹窗引导「前往标签模板管理」；
  - Module_01 CiExporterMappingPage / ScrapeJobsPage：`label_template_id` extra 文案按 v2.9 澄清（可换用其他模板（引用级）、标签内容编辑唯一入口在 Module_07）；
  - 验证：module-07 tsc/lint/test 47/47/build ✅；module-01 tsc/lint/test 24/24/build ✅。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 dist 统一入口访问验证（GitHub Pages 结构）待最终评审时确认。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.2）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.9）
- `docs/prototypes/module-07/`

---

## 补充对齐：2026-08-11（第七轮 模板↔实例关联）

- **参与 Agent**：prototype-designer（基于用户对「标签模板如何关联实例」的两个问题讨论）
- **触发原因**：用户提出①Module_07 标签管理如何关联实例、批量修改如何批量关联；②Module_01 选完标签模板后如何自动关联实例而非手动选择，核心诉求「保证模板与实例的关联关系」。经讨论确认 A（显式展示）+ C（Job 层自动带出）组合，落地 PRD v2.3 / v3.0 与两模块原型。

### 关键决策

#### 决策 3.32：模板↔实例通过 resource_type 隐式关联，本模块负责显式展示

- **问题**：模板与实例的关联关系目前是隐式的（模板挂在资源类型上，该类型所有实例自动适用），用户看不到"哪些实例用了哪个模板"。
- **结论**：**不引入模板→实例显式绑定**（避免与 Job 选实例逻辑重复、破坏标签配置唯一入口原则）；Module_07 负责把关联**显式展示**：①标签模板页每个模板显示「关联实例 N 个」+ 可展开实例清单（实例名/IP/状态）；②资源详情新增「适用模板」行（默认模板名 + 模板 ID）。接口补充 `GET /label-templates/{id}/resources`。
- **影响范围**：Module_07 PRD 3.1 / 3.2 / 6.3 / 12.1（v2.3）。

#### 决策 3.33：Module_01 实例选择增强——候选自动收敛（MVP，比 filter 轻）

- **问题**：用户希望"选完类型/模板后自动带出实例，而不是手动逐个选"。
- **结论**：Job 表单选定 `resource_type` + `network_domain_id` 后，实例候选**自动收敛为「同类型 + 同网域」资源**，提供一键全选/反选与关键字筛选；勾选结果仍持久化到 `selected_instance_ids`（manual 语义不变）。比 v0.3+ 的 `filter` 条件表达式模式更轻，MVP 落地。
- **影响范围**：Module_01 PRD 3.1 / 5.2 / 12（v3.0）。

#### 决策 3.34：模板与实例关联的职责分层确认

- **问题**：模板↔实例关联应在哪一层建立？选项：A 按类型隐式关联+显式展示；B 模板显式绑定实例；C Job 层自动带出。
- **结论**：**A + C 组合**（用户确认）——模板层按 resource_type 隐式关联（A 展示可见性），Job 层自动收敛候选实例（C 减少手动操作）；不做 B（模板显式绑实例，与 Job 选实例重复、破坏唯一入口原则）。
- **影响范围**：Module_07 PRD v2.3、Module_01 PRD v3.0、两模块原型。

### 已确认项（2026-08-11 第七轮）

- [x] A 展示粒度：模板页「关联实例 N 个」可展开清单 + 资源详情「适用模板」行（用户确认）。
- [x] C 落地版本：MVP 落地（自动带出候选 + 全选/反选 + 关键字筛选）（用户确认）。
- [x] 候选范围：同 resource_type + 同 network_domain_id 收敛（用户确认）。
- [x] 原型落地：module-07 LabelTemplatesPage 关联实例 Popover、ResourcesPage 适用模板行；module-01 ScrapeJobsPage Transfer 加 showSearch + 候选文案更新。
- [x] 验证通过：module-07 test 47/47、lint、build、tsc；module-01 test 24/24、lint、build、tsc。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 dist 统一入口访问验证（GitHub Pages 结构）待最终评审时确认。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.3）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.0）
- `docs/prototypes/module-07/`、`docs/prototypes/module-01/`

---

## 补充对齐：2026-08-11（第八轮 标签模板页布局重构）

- **参与 Agent**：prototype-designer（基于用户对标签模板页布局的反馈）
- **触发原因**：用户反馈标签模板页左右两栏展示不清晰、关联实例用 Popover 弹窗无法承载大量实例，要求从最佳实践推荐布局。经讨论确认「右栏 Tab 化 + 左栏精简 + 关联实例 Table 化」三项方向后落地 PRD v2.4 与原型。

### 关键决策

#### 决策 3.35：右栏 Tab 化（映射明细 / 关联实例），关联实例用完整 Table 承载

- **问题**：标签模板页右栏仅展示映射明细，关联实例以 Popover 弹窗内嵌在左栏模板卡片中——实例多时弹窗无法滚动/分页/筛选，且悬浮态不持久。
- **结论**：右栏改为 `Tabs`：**Tab1 映射明细**（按来源类型分组）、**Tab2 关联实例**（完整 Table：分页 pageSize=10 + 关键字搜索 + 状态筛选，未来可扩展虚拟滚动）；关联实例从"列表项附属弹窗"提升为"选中模板后的主区内容"（master-detail 模式）。
- **影响范围**：Module_07 PRD 3.2 UI/UX（v2.4）、原型 LabelTemplatesPage。

#### 决策 3.36：左栏模板卡片精简（去掉 Popover，badge 化）

- **问题**：左栏模板卡片堆叠模板名 + ID + 映射数 + 创建时间 + 关联实例 Popover，信息过载、层级不清。
- **结论**：卡片精简为「名称 + 默认/自定义 Tag + 映射数 badge + 关联实例数 badge」；模板 ID / 创建时间等次要信息移除或下沉；关联实例明细统一在右侧 Tab 查看（信息分层：列表摘要 → 详情 Tab → 抽屉编辑）。
- **影响范围**：Module_07 PRD 3.2 UI/UX（v2.4）、原型 LabelTemplatesPage。

### 已确认项（2026-08-11 第八轮）

- [x] 右栏 Tab 化（映射明细 / 关联实例）（用户确认）。
- [x] 关联实例 Table 能力：分页 + 搜索 + 状态筛选（用户确认）。
- [x] 左栏精简 + badge（用户确认）。
- [x] 原型落地 + 验证通过：module-07 test 47/47、lint、build、tsc。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 关联实例 Table 虚拟滚动（实例量达千级时评估，v0.2+）。
- [ ] 原型 dist 统一入口访问验证（GitHub Pages 结构）待最终评审时确认。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.4）
- `docs/prototypes/module-07/src/pages/LabelTemplatesPage.tsx`

---

## 补充对齐：2026-08-12（第九轮 标签模板用户动线优化）

- **参与 Agent**：prototype-designer（基于用户对标签模板关联断层的反馈）
- **触发原因**：用户走查 Module_07 标签模板功能时发现核心断层——标签模板的消费场景在 Module_01（策略管理），但管理入口在 Module_07（资源管理），用户动线断裂；隐式关联不透明，用户以为要逐台手动配置；资源管理页出现标签操作入口令人困惑。
- **讨论过程**：经四轮方向讨论（双入口、隐式关联显性化、资源页瘦身、用户打标弱化），用户确认全部方向，并特别指出创建标签模板的触发入口应放在 Module_01 CI-Exporter 映射页（首次引入 CI 类型时自然需要定义标签映射）。

### 问题背景

用户走查 Module_07 标签模板功能时，感知到以下四个核心断层：

| # | 问题 | 用户感受 |
|---|------|---------|
| 1 | **标签模板的消费场景在 Module_01（策略管理）**，但管理入口在 Module_07（资源管理） | 配采集策略时想顺带配标签模板，却要跳到资源管理模块，动线断裂 |
| 2 | **隐式关联不透明** | 用户不知道"模板是通过 CI 类型自动关联实例的"，看到关联实例列表以为要逐台手动配置 |
| 3 | **资源管理页出现标签操作入口** | 在资源管理页看到"关联标签模板"和"打用户标签"，觉得奇怪——资源管理应该只做导入/CRUD |
| 4 | **打标不是强制工作流** | 用户层面的打标应该弱化，不是每个实例都需要手动打标 |

用户期望：标签模板 = 解决 CMDB 字段语义差别的映射工具，字段无歧义时应自动带出；隐式关联 = 按 CI 类型自动关联，无需手动逐台绑定；资源管理页只做导入/CRUD；打标操作弱化，非强制工作流。

### 四项优化方向

| 方向 | 核心思路 | 关键变化 |
|------|---------|---------|
| **方向 1：创建入口迁移** | 标签模板创建触发入口放在 Module_01 CI-Exporter 映射页 | 首次引入 CI 类型时检测无模板 → 引导创建（预填默认映射）；Module_07 保留深度管理能力 |
| **方向 2：隐式关联显性化** | 关联实例 Tab 顶部增加说明文案 | 明确告知用户"模板通过 resource_type 自动关联，无需手动配置" |
| **方向 3：资源页文案弱化** | 保留功能但降低感知强度 | 用户标签入口从「标签管理」改为「自定义标签（非必须）」+ 引导提示 |
| **方向 4：用户打标弱化感知** | 保持 P0 但优化文案引导 | 明确告知"大多数场景下标签模板已自动生成所需标签，仅当个别实例需要额外标签时使用" |

### 关键决策

#### 决策 3.37：标签模板创建入口放在 Module_01 CI-Exporter 映射页

- **问题**：用户需要预先在 Module_07 创建好标签模板，再到 Module_01 引用，动线断裂。
- **结论**：创建触发入口放在 Module_01「CI-Exporter 映射页」——用户新增 CI-Exporter 映射时，系统检测该 CI 类型是否已有标签模板（`has_label_template`）；无模板时弹出轻量提示引导创建，支持「立即创建」（预填 CI 类型 + 推荐默认映射）或「稍后再说」（列表显示「标签模板待配置」badge）；Module_07 保留完整编辑/克隆/删除能力作为深度管理入口。
- **理由**：CI-Exporter 映射页是用户首次引入 CI 类型的场景，此时自然需要定义"这个 CI 类型的字段怎么映射成标签"；标签模板通常只在首次引入时创建一次，节奏与 CI-Exporter 映射一致；避免在 ScrapeJob 创建页触发（用户正在选实例时被拉去创建模板，体验中断）。
- **影响范围**：Module_01 PRD 3.1 功能表、5.1 数据模型（新增 `has_label_template` 字段）、5.4 ScrapeJob 标签模板引用体验增强、8.1 验收标准；Module_07 PRD 3.2 关联实例 Tab 说明文案。

#### 决策 3.38：隐式关联显性化——关联实例 Tab 增加说明文案

- **问题**：用户不知道"模板通过 CI 类型自动关联实例"，看到关联实例列表以为要逐台手动配置。
- **结论**：标签模板页「关联实例」Tab 顶部增加明确说明——「本模板适用于 {资源类型} 类型，该类型下所有 {N} 个实例自动适用本模板的标签映射，无需手动关联。如需查看具体实例清单，请浏览下方列表。」去掉任何"手动关联/解关联"的操作按钮，实例列表保持只读展示。
- **影响范围**：Module_07 PRD 3.2 UI/UX（v2.5）、原型 LabelTemplatesPage。

#### 决策 3.39：资源管理页标签操作文案弱化

- **问题**：用户在资源管理页看到"关联标签模板"和"打用户标签"，觉得奇怪——资源管理应该只做导入/CRUD。
- **结论**：保留「适用模板」展示行（告知用户标签来源），但用户标签编辑入口文案从「标签管理」调整为「自定义标签（非必须）」，并增加引导提示——「大多数场景下，标签模板已自动生成所需标签；仅当个别实例需要额外标签时使用」。不折叠/不降级，观察用户反馈后再决定是否进一步弱化。
- **影响范围**：Module_07 PRD 3.3 UI/UX（v2.5）、12.1 验收标准、原型 ResourcesPage。

#### 决策 3.40：用户打标保持 P0 但弱化感知

- **问题**：用户层面的打标不是强制工作流，但当前入口强度让用户误以为每台实例都需要手动打标。
- **结论**：功能重要性保持 P0 不变，仅优化入口文案和引导提示，不改变交互层级。明确告知用户「大多数场景下标签模板已自动生成所需标签，仅当个别实例需要额外标签时使用」。
- **影响范围**：Module_07 PRD 3.3 UI/UX（v2.5）、12.1 验收标准。

#### 决策 3.41：CI-Exporter 映射列表新增「标签模板」展示列

- **问题**：用户无法在 CI-Exporter 映射列表中直观看到每个 CI 类型关联的标签模板状态。
- **结论**：映射列表新增「标签模板」列，采用两行卡片展示（模板名称 + 默认/自定义标记 + 类别·模板ID）；支持查看（只读预览抽屉）、更换（同资源类型其他模板）、补配（重新触发创建流程）。
- **影响范围**：Module_01 PRD 3.1 功能表、5.1 标签模板关联 UX、8.1 验收标准、原型 CiExporterMappingPage。

#### 决策 3.42：ScrapeJob 标签模板引用体验增强

- **问题**：ScrapeJob 表单中标签模板选择体验不够直观，用户无法快速了解模板内容。
- **结论**：Job 表单标签模板选择器改为卡片式选择（展示模板名称 + 资源类别 + 映射数量概览），选中后内联展示映射明细小表格；提供「刷新模板列表」按钮；编辑表单支持「更换」操作（仅展示同资源类型可用模板）。
- **影响范围**：Module_01 PRD 5.4 标签模板引用体验增强（v3.1）、8.1 验收标准、原型 ScrapeJobsPage。

### 详细交互设计

#### CI-Exporter 映射页 — 创建标签模板引导

用户新增 CI-Exporter 映射时，选择 CI 类型后系统检测该类型尚无标签模板，弹出轻量提示：

```
「CI 类型 "mysql" 尚无标签模板。
 标签模板定义资源字段到监控标签的映射，
 建议立即创建，否则监控数据将缺少归属标签。
 [立即创建] [稍后再说]」
```

- **立即创建** → 打开创建抽屉，自动预填：模板名称（"mysql 默认标签模板"，可改）、资源类型（锁定为 middleware）、推荐默认映射（composite: instance_ip:port→instance + resource_field: app_name→app / env→env / cluster→cluster / middleware_type→middleware_type）。用户可增删改映射后保存。
- **稍后再说** → 映射列表该 CI 类型显示「标签模板待配置」badge（可点击重新触发创建流程）。

#### CI-Exporter 映射页 — 标签模板展示列

映射列表新增「标签模板」列，展示格式：

| CI 类型 | Exporter | 标签模板 | 操作 |
|---------|----------|---------|------|
| mysql | mysqld_exporter | 标签模板待配置 ⚠️ | [补配] |
| redis | redis_exporter | Redis 默认模板（tpl_redis_default） | [查看] [更换] |
| host | node_exporter | 主机默认模板（tpl_host_default） | [查看] [更换] |

- **查看**：抽屉内只读预览模板的映射内容
- **更换**：可选同资源类型的其他模板
- **补配**：重新触发创建流程

#### 标签模板页 — 关联实例 Tab 说明文案

关联实例 Tab 顶部增加 Alert 说明：

```
💡 本模板适用于「主机」类型
该类型下所有 1,284 个实例自动适用本模板的标签映射，无需手动关联。
如需查看具体实例清单，请浏览下方列表。
```

去掉任何"手动关联/解关联"的操作按钮，实例列表保持只读展示。

#### 资源详情 — 用户标签文案弱化

资源详情 Drawer 中标签区域改为：

```
── 标签信息 ──
system 标签（由标签模板自动生成）：
• app → order-service
• env → prod
• cluster → bj-01

自定义标签（非必须）：                    ← 文案从"标签管理"改为"自定义标签（非必须）"
[添加自定义标签]                          ← 文案从"添加"改为"添加自定义标签"
• 已有 user 标签列表...
• 提示：大多数场景下标签模板已自动生成所需
  标签，仅当个别实例需要额外标签时使用
```

### 已确认项（2026-08-12 第九轮）

- [x] 标签模板创建入口放在 Module_01 CI-Exporter 映射页（用户确认）。
- [x] 隐式关联显性化——关联实例 Tab 增加说明文案（用户确认）。
- [x] 资源管理页标签操作文案弱化（用户确认）。
- [x] 用户打标保持 P0 但弱化感知（用户确认）。
- [x] CI-Exporter 映射列表新增「标签模板」展示列（用户确认）。
- [x] ScrapeJob 标签模板引用体验增强（用户确认）。
- [x] 问题背景与四项优化方向已记录至本文件（合并自独立方案文档）。
- [x] Module_07 PRD 已更新至 v2.5。
- [x] Module_01 PRD 已更新至 v3.1。
- [x] Module_07 原型已更新（关联实例 Tab 说明文案 + 资源详情用户标签弱化）。
- [x] Module_01 原型已更新（CI-Exporter 映射页创建引导 + 标签模板列 + ScrapeJob 标签模板选择增强）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 两段评审（用户走查 + 技术核对）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.5）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.1）
- `docs/prototypes/module-07/src/pages/LabelTemplatesPage.tsx`
- `docs/prototypes/module-07/src/pages/ResourcesPage.tsx`
- `docs/prototypes/module-01/src/pages/CiExporterMappingPage.tsx`
- `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx`

---

## 评审记录

### 2026-08-11（标签模板需求澄清轮）

- **评审时间 / 版本**：2026-08-11；PRD v1.7、原型 v1.3；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户指出模板列表「默认/内置参数」分类令人困惑（命名误导）；模板列表无 ID、Module_01 关联后看不到模板信息，无法追溯；确认目标标签默认=来源字段与映射校验是合理 UX 改进；确认模板管理归属保持 Module_07。问题均在本轮修复，无返工。
- **第二段技术核对结论**：`template_id` 确认为跨模块唯一 FK（名称同一资源类型下可重复）；组合字段 `instance` 依赖 Module_01 `default_port`（host 无 port 字段）为跨层契约；原型 mock 契约与 PRD 字段（含 UI 展示名）一致；可开发性结论：模板校验规则（保护 label / target_label 唯一）与 target_label 默认预填均为前端表单逻辑，不涉及后端模型变更。
- **问题清单与处理结果**：已修复——示例模板清理（决策 3.6/3.7）、模板 ID 展示（决策 3.10）、新增映射默认预填与重复校验（决策 3.8/3.9）、组合字段跨层说明（决策 3.11）。
- **遗留项**：组合字段表达式语法扩展（v0.2+，P2）；`source_type=prometheus_builtin` 服务发现 / relabel 场景（v0.2+，预留不实现）。

### 2026-08-11（UI/UX 优化轮）

- **评审时间 / 版本**：2026-08-11；PRD v1.8、原型 v1.4（规划）；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户指出 M01 标签模板展示样式不佳（状态徽标语义错位、Tag 堆砌不清晰）、M07 模板页编辑用 Modal 遮挡上下文、是否分页存疑；确认「两行卡片 + 预览抽屉」「分栏 + 搜索筛选 + 抽屉编辑」「不做分页」；补充要求资源页布局一致性与「CI 展示可配置」经澄清后明确为列显隐配置（P1）。
- **第二段技术核对结论**：抽屉编辑（Drawer）为前端交互改造，不涉及后端模型；列显隐配置为纯前端视图层能力（不影响默认列与数据契约）；映射按来源类型分组为展示层分组，不改数据模型。可开发性结论：均在原型可验证范围内。
- **问题清单与处理结果**：已修复（PRD 层面，决策 3.12~3.15）；原型 v1.4 待用户确认后落地。
- **遗留项**：列显隐配置（P1）原型占位；模板规模化后的分页/虚拟滚动评估（v0.2+）。

### 2026-08-11（需求澄清轮）

- **评审时间 / 版本**：2026-08-11；PRD v1.9、原型 v1.5（规划）；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户提出四组需求疑问（状态映射版本、转换规则交互、组合字段取值时序、内置字段来源），并追问端口不一致的解决手段；经解释后确认「状态映射保持配置层+UI 只读」「transform 下拉可留空」「组合字段时序写入 PRD」「内置字段 MVP 隐藏」。
- **第二段技术核对结论**：transform 语义（字符串变换）与可空性（透传）不涉及数据模型变更；组合字段取值时序（port 来自映射 default_port、与 Job/Exporter 无关）已在 5.12 C 明确；prometheus_builtin 隐藏为 UI 层行为，枚举保留数据模型（向后兼容）；状态映射版本规划与 5.5.5 一致。
- **问题清单与处理结果**：已修复（PRD 层面，决策 3.16~3.19）；原型 v1.5 待用户确认后落地。
- **遗留项**：prefix/replace 参数化（P1）；v0.4+ 状态映射 UI 管理（P2）；实例级端口覆盖评估（v0.2+，随 Module_01 落地）。

### 2026-08-11（合规闭环轮）

- **评审时间 / 版本**：2026-08-11；PRD v2.0、原型 v2.0；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户确认实施 6 项优化建议（接口设计章节、原型版本对齐、原型文案技术术语清理、组合字段用户层说明、组合字段出值技术验收、标签模板用户故事回写）；本次走查为文档/原型合规性复核，无新增用户任务层面的返工。
- **第二段技术核对结论**：新增接口设计章节为纯契约补充（不影响数据模型）；原型版本 v2.0 与 PRD v2.0 对齐，mock 头注释/README/test 描述同步；组合字段出值技术验收将跨层契约（instance = instance_ip + default_port，5.12 C / 6.3）固化为可验证项；M07-OPS-07 回写全局库 §4.7 且 PRD 引用编码一致。可开发性结论：均在原型可验证范围内，重新验证通过（test 47/47、lint、build、tsc）。
- **问题清单与处理结果**：已修复（PRD / 原型 / 全局库，决策 3.20~3.24）。
- **遗留项**：PRD 状态推进待领导/业务评审；原型 dist 统一入口访问验证（GitHub Pages 结构）待最终评审确认。

---

## 补充对齐：2026-08-12（第十轮 标签口径统一）

- **参与 Agent**：prototype-designer
- **触发原因**：用户指出资源详情标签来源（CMDB / user / 系统）与「标签管理」（标签模板映射）的字段类型（资源字段 / 组合字段 / CMDB 字段）口径脱节、容易引发歧义，需统一清晰定义（系统 = 默认模板产物、MVP 不从 CMDB 导入而用平台资源管理字段、用户 = 自定义），并追问「标签管理是否也应有用户自定义字段」。经分析确认方向后落地。

### 关键决策

#### 决策 3.43：标签来源 vs 映射字段来源统一口径；模板映射不新增「用户自定义字段」

- **问题**：资源详情标签卡的「来源」（`ResourceLabel.source`：system / user / cmdb）与标签模板映射的「来源类型」（`Mapping.source_type`：resource_field / composite / cmdb_field）叫法相近、看不出对应关系，用户误以为同一概念；且 MVP mock 中 cmdb 来源标签在跑，易误以为 MVP 已接入 CMDB。
- **结论**：
  1. **统一定义**：
     - `system` = 标签模板映射产物（MVP 字段来源 = 平台资源字段 `resource_field` + 组合字段 `composite`，即「MVP 不从 CMDB 导入、使用平台资源管理字段」）；
     - `user` = 实例级自定义标签（资源详情手加 + 通用目标 `custom_labels` 透传），**不进入模板映射**；
     - `cmdb` = v0.4+ CMDB 同步，对应 `cmdb_field`；MVP mock 中 cmdb 来源标签统一以「v0.4+ 预留」占位样式展示（数据模型与冲突优先级保留）。
  2. **模板映射不新增 `user_field` 来源枚举**：Resource 字段固定（MVP 无资源级自定义字段）+ 用户标签已有唯一入口（详情手加 / custom_labels 透传），新增会破坏「标签配置唯一入口原则」（类型级走模板、实例级走 user）；类型级用户标签诉求走 P1 批量标签编辑（按资源类型批量打 user 标签）。
  3. **UI 落地**：资源详情「自定义标签」区新增「标签口径说明」图例（三来源与字段来源的对应）；cmdb 标签 Tag 改为「CMDB · v0.4+ 预留」灰色占位 + 副文案「CMDB 同步（v0.4+ 接入后生效）」；user 副文案「手动添加」→「资源自定义（实例级）」；模板页「标签模板怎么用」与映射抽屉「来源类型」extra 补充口径文案。
- **依据**：PRD 5.3 来源说明与「标签配置唯一入口原则」；Module_01 决策 15（继承链）；用户提出的口径提案（系统 = 默认模板、MVP 用平台资源字段、用户 = 自定义）。
- **影响范围**：Module_07 PRD 3.3 / 5.3 / 术语映射 / Change Log（v2.6）；原型 `ResourcesPage.tsx`、`LabelTemplatesPage.tsx`；与 Module_01 决策 37（引导文案口径）对齐。

### 已确认项（2026-08-12 第十轮）

- [x] 统一口径：系统 = 模板产物（字段来源：资源字段/组合字段）、用户 = 实例级自定义（不走模板）、CMDB = v0.4+ 预留（占位展示）。
- [x] 模板映射不新增「用户自定义字段」来源枚举；类型级自定义走 P1 批量标签编辑。
- [x] 原型 UI 落地：口径图例 + cmdb 标签 v0.4+ 占位 + user 文案「资源自定义」+ 模板页口径文案。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v2.2 构建验证与统一入口验证（随本轮一并执行）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.6）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.2）
- `docs/prototypes/module-07/`（v2.2）
- `docs/05-execution-records/module-01/design-decisions.md`（决策 37）

---

## 补充对齐：2026-08-13（第十一轮 模板变更影响闭环）

- **参与 Agent**：prototype-designer
- **触发原因**：用户提出①标签模板每次变更的内容用户在 UI 看不出，需要让用户知道要去 Module_09 做配置变更确认；②Module_01 ci-exporter 映射的「标签选择」应提示"CI 新增时创建新模板、已有 CI 时直接选择模板"。经 AskUserQuestion 确认三项决策后落地（本文件为问题 ① 决策，问题 ② 见 Module_01 决策 38）。

### 关键决策

#### 决策 3.44：模板变更影响反馈 + 被引用 Job 展示（MVP/v0.2+ 双层标注）

- **问题**：模板变更穿透引用它的 Job（Module_07 5.3 契约已写明），但用户在 Module_07 保存模板后零反馈——看不到影响哪些采集任务、不知道要去 Module_09 配置中心确认发布；且 M09 配置变更确认 UI 为 v0.2+ 能力（3.4 {v0.2+}），MVP 阶段改模板即重新生成 + reload 直接生效、无确认环节。
- **结论**（用户确认「PRD 双层标注 + MVP 先做影响提示」「新增被引用 Tab」）：
  1. **保存后影响提示**：模板/映射保存成功时反馈「本模板被 N 个采集 Job 引用（M 个网域），将按新映射重新生成标签」+「查看引用 Job」入口；生效语义按版本区分——**MVP = 重新生成配置并立即生效**（无 M09 跳转），**v0.2+ = 前往配置中心确认后生效**（跳转 Module_09 变更确认页）；
  2. **被引用 Job 展示**：模板详情右栏 Tab 化扩展为三 Tab（映射明细 / 关联实例 / **被引用采集 Job**），展示 Job 名/网域/启用状态/变更状态；模板修改后引用 Job 显示「模板已变更，待确认」badge（v0.2+ 与 M09 变更单联动，MVP 显示「已变更」）；左栏模板卡片同步增加被引用数 badge；
  3. **接口补充**：`GET /label-templates/{template_id}/jobs`（被引用 Job 查询，变更状态由 M09 变更单派生）；
  4. **跨模块词汇**：术语映射补充「配置变更确认 / 变更单」（ConfigDraft / change_no，跨模块词汇，与 Module_09 对齐）。
- **依据**：心智模型差异识别（四问②系统隐含行为显性化：模板变更穿透 Job、需人工确认、pull 轮询延迟；④规则层 vs 策略层/发布层显性化：模板→Job→配置三级链路）；用户选择「PRD 双层标注 + MVP 先做影响提示」。
- **影响范围**：Module_07 PRD 3.2 / 5.3 / 6.3 / 12.1 / 术语映射 / Change Log（v2.7）；Module_09 PRD 3.4 变更摘要补充标签模板话术（v1.25）；M07 原型 LabelTemplatesPage / mock / README / test（v2.3）。

### 已确认项（2026-08-13 第十一轮）

- [x] PRD 双层标注 + MVP 先做影响提示（用户确认）。
- [x] M07 模板详情新增「被引用 Job」Tab（用户确认）。
- [x] 下拉严格同类型过滤（用户确认，对应 M01 决策 38）。
- [x] M07 原型落地：被引用 Job Tab + 保存影响提示 + 左栏 badge + mock 引用数据（tpl-host-default 演示「待确认」）；M01 原型落地：标签选择两情形（见 Module_01 决策 38）。
- [x] M09 PRD 3.4 变更摘要补「标签模板变更话术」示例与风险等级建议（v1.25）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 两段评审（用户走查 + 技术核对）随原型验证一并执行。
- [ ] v0.2+「前往配置中心确认」跳转待 M09 变更确认 UI 落地时启用（本轮 MVP 原型以文案提示 + 评审折叠区说明承载）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.7）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.3）
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.25）
- `docs/prototypes/module-07/`（v2.3）

---

## 补充对齐：2026-08-14（第十二轮 标签双场景治理 + 业务指标关联）

- **参与 Agent**：prototype-designer
- **触发原因**：用户提出两个设计方向讨论——①标签管理需按"静态资源类型"与"业务用户关心的业务类型"双场景区分（静态资源标签治理在 CMDB 侧、平台不引导二次打标；自定义标签仅对业务类型触发）；②业务侧包装的服务接口/微服务场景下，业务指标带业务属性，如何实现 Prometheus "业务指标 ↔ 静态资源"关联。经三轮讨论（含 APM 全链路 vs 业务域辨析）确认八项决策后落地。

### 讨论过程

1. **标签双场景**：静态资源（host/middleware/generic_target）标签权威在 CMDB（MVP = Excel 导入带入作为前置形态），平台只读；业务类型资源（application）开放 user 自定义标签；标签模板与"谁治理标签数据"解耦（模板仍是"字段 → Prometheus Label"技术契约，Module_01/09 生成配置的输入）。
2. **业务类型概念辨析**：用户澄清"业务类型" ≠ application 资源类型，而是**业务域概念**（支付业务、数据接口业务）。与 APM 全链路监控（无侵入 Trace）辨析后确认：**APM = 垂直切片**（调用链、技术性能指标、服务拓扑自动发现），**业务域 = 水平切片**（业务归属、业务语义指标[成功率/交易量 APM 采不到]、跨技术栈聚合[应用+中间件+主机]、治理属性[负责人/核心链路/告警路由]），**两者互补非替代**；微服务场景下业务域反而必要——拆分粒度是技术边界（一个共享服务被多业务使用）、业务指标归属与共享基础设施归属需业务语义承载。
3. **业务指标关联**：Prometheus 一切关联靠 label；推荐**机制 A 抓取注入为主**（业务端点注册为 application 资源 + 标签模板注入，Module_09 写入 `static_configs[].labels`，抓取自动附加到全部序列）+ **机制 B 埋点标签规范 + `metric_relabel_configs` 归一化兜底**；关键限制：`metric_relabel_configs` 只能改指标自带标签、**不能引入资源侧数据**；关联键用稳定业务标识 `app`/`biz`、不用 `instance`（动态实例漂移，为 v0.2+ 服务发现铺路）。

### 关键决策

#### 决策 3.45：标签管理双场景治理边界——静态资源 CMDB 治理、业务类型平台治理

- **问题**：标签管理单一体系（system/user/cmdb）下，用户无法区分"静态资源标签（应由 CMDB 治理）"与"业务类型标签（业务用户关心、平台治理）"，且引导用户在平台重新打静态资源标签与 CMDB 数据治理冲突。
- **结论**：
  1. **静态资源（host/middleware/generic_target）**：标签治理在 CMDB 侧（MVP = Excel 导入列带入，v0.4+ = Module_04 同步），平台**只读展示来源、收回实例级打标入口**——ResourceLabel 写接口按 `resource_type` 校验，非 application 返回 403；
  2. **业务类型资源（application）**：开放 `user` 来源自定义标签（资源详情「自定义标签」），承载业务用户关心的业务维度标注；
  3. **标签模板保留**：与"谁治理标签数据"解耦——模板是"CMDB/Excel 字段 → Prometheus Label"技术契约（Module_01/09 生成配置的输入），不因静态资源只读而移除。
- **依据**：v2.2 标签配置唯一入口原则 + v2.5 打标弱化方向延续；用户确认「静态资源标签直接收掉（只读）」。
- **影响范围**：Module_07 PRD 3.3 / 5.3 / 6.2 / 12 / 术语映射（v2.8）。

#### 决策 3.46：业务类型（业务域）概念引入——MVP business_domain 字段 + v0.2+ 独立业务目录

- **问题**：用户澄清"业务类型" = 业务域概念（支付业务、数据接口业务），非 application 资源类型；该概念是否引入、如何建模待定。
- **结论**：
  1. **引入（2A）**：MVP 引入 `business_domain` 维度（Resource 基础字段，任意资源类型可挂、MVP 以 application 为主），标签模板映射 `biz` label，支持"按业务类型聚合监控"（如支付业务整体 QPS/延迟）；
  2. **建模（3C 组合）**：MVP 用字段打底（`business_domain`），**v0.2+ 演进独立业务目录**（业务类型实体 + 资源归属关系 + 业务类型自定义标签：核心链路/负责人等挂在业务实体上）；
  3. **聚合范围（4A）**：业务类型可聚合**任意资源类型**（应用服务 + 依赖中间件 + 主机），与"支付业务 = 应用 + 依赖中间件"现实一致；
  4. **标签落地（5A）**：MVP 只做 `biz` 聚合，业务类型自定义标签 v0.2+ 独立业务目录承载。
- **依据**：APM 全链路 vs 业务域辨析（垂直切片 vs 水平切片，互补非替代）；用户确认 2A/3C/4A/5A。
- **影响范围**：Module_07 PRD 5.2 / 5.8 / 5.12 A / 术语映射（v2.8）；v0.2+ 独立业务目录（业务类型实体 + 自定义标签）待后续迭代设计。

#### 决策 3.47：业务指标 ↔ 静态资源关联——机制 A 抓取注入为主 + 机制 B 埋点规范兜底（5.15 业务指标标签规范）

- **问题**：业务侧包装的服务接口/微服务场景下，业务指标（接口 QPS/延迟/错误率）带业务属性，如何实现 Prometheus "业务指标 ↔ 静态资源" 关联。
- **结论**：
  1. **机制 A（推荐，MVP 主路径）**：业务指标端点注册为 application 资源（`endpoint` 字段），标签模板映射 `app_name`/`business_domain`/`env`/`cluster`，Module_09 生成配置时写入 `static_configs[].labels`，抓取自动附加到该 target 全部序列（零业务侧成本，现有 5.8/5.12 设计已支撑）；
  2. **机制 B（兜底）**：业务埋点按规范携带 `app`（= 平台 app_name）等关联标签，`metric_relabel_configs` 归一化兜底（如 `biz`/`service` → `app`）；关键限制——relabel 只能改指标自带标签、不能引入资源侧数据；
  3. **关联键**：`app`（指标 ↔ 应用服务资源）、`biz`（指标 ↔ 业务类型）；**不用 `instance`**（动态实例漂移，稳定业务标识为 v0.2+ 服务发现铺路，与 5.12 B `prometheus_builtin` 对齐）；
  4. **业务属性分两类**：资源属性（app/biz/env/cluster，参与关联聚合）与业务维度属性（path/method/status，仅查询分析，不参与资源关联）；
  5. **规范落地（7A）**：新增 PRD 5.15「业务指标标签规范」独立小节。
- **依据**：Prometheus 标签关联最佳实践（target labels 注入 / relabel 两阶段 / PromQL join）；用户确认 6A/7A。
- **影响范围**：Module_07 PRD 5.15 / 5.12 A / 12（v2.8）；Module_01/09 消费侧后续对齐（relabel 归一化兜底配置、biz 聚合查询）。

### 已确认项（2026-08-14 第十二轮）

- [x] 静态资源标签只读、收回实例级打标入口（用户确认）。
- [x] 业务类型概念引入（2A）；MVP `business_domain` 字段 + v0.2+ 独立业务目录（3C）；聚合任意资源类型（4A）；MVP 只做 biz 聚合（5A）。
- [x] 关联机制：抓取注入为主 + 埋点规范兜底（6A）；标签规范写入 PRD 5.15（7A）。
- [x] 落档范围：PRD v2.8 + design-decisions（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [x] 原型同步（v2.4，2026-08-14 完成）：ResourcesPage 静态资源标签只读 + application business_domain 字段 + LabelTemplatesPage biz 映射 + mock 数据；test 47/47、lint、build、tsc、统一入口验证通过。
- [ ] v0.2+ 独立业务目录（业务类型实体 + 资源归属 + 业务类型自定义标签）设计待后续迭代。
- [ ] Module_01/09 业务指标标签规范消费侧对齐（relabel 归一化兜底配置、biz 聚合查询）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.8）
- `docs/prototypes/module-07/`（v2.4，已同步）

---

## 补充对齐：2026-08-14（第十七轮 组合字段 MVP 内部默认——Prometheus 默认字段不前台告知）

- **参与 Agent**：prototype-designer
- **触发原因**：用户提出组合字段异议——不了解为什么有该选项（猜测是单容器多服务端口区分场景）；并指出原 PRD 要求 Prometheus 默认字段（如 instance）不用在前台告知用户，质问组合字段设计到前台的必要性。
- **讨论过程**：
  1. **技术澄清**：instance 是 Prometheus 内置/保留标签（抓取时自动注入 = 抓取地址 host:port，出现在全部序列），作用是采集目标身份标识；同 IP 多服务（单容器多服务/多端口）靠端口区分身份避免指标冲突——用户猜测正确；端口确实写进 labels（instance 值 = host:port）；
  2. **矛盾承认**：MVP 直连抓取下，Prometheus 自动注入的 instance（= 抓取地址 资源IP:default_port）与组合字段拼接结果**完全一致**——组合字段前台可见性确实无必要性（与 prometheus_builtin 隐藏模式不一致）；
  3. **区别**：prometheus_builtin = 空操作透传（隐藏）；composite = 生成规则（instance 端口来源有决策），但 MVP 下决策有默认值（default_port），用户无需配置；
  4. **必要性时机**：v0.2+ 服务发现（__meta_* 派生）、代理/统一出口抓取（抓取地址 ≠ 资源身份）、实例级端口覆盖——需要身份定制时 composite 才需前台开放；
  5. **端口配置点确认**：composite 隐藏不影响端口链路——端口一直配置在 Module_01 CI-Exporter 映射 default_port（映射表单可编辑 → Job 快照继承 → M09 生成拼接），用户确认。

### 关键决策

#### 决策 3.48：组合字段 MVP 内部默认——前台隐藏，v0.2+ 身份定制开放

- **问题**：组合字段（composite→instance）前台可见性与"Prometheus 默认字段不前台告知"矛盾；用户不理解选项意义。
- **结论**：
  1. **MVP 前台隐藏**：新增映射时不展示「组合字段」来源选项（同 prometheus_builtin 隐藏模式）；`source_type` 枚举与数据模型保留（含 composite），v0.2+ 服务发现/代理抓取/端口覆盖场景启用；
  2. **内部默认行为**：composite→instance 为内部默认（生成配置时默认 `instance = 资源IP + default_port`，用户无感知）；默认模板 composite 行标注「内置默认」；
  3. **端口配置点不变**：instance 端口取自 Module_01 映射 default_port（→ Job 快照继承 → M09 拼接），组合字段隐藏不影响链路；
  4. **说明沉淀**：5.12 C 补用户语言说明（instance 身份机制、同 IP 多服务端口区分、内置默认语义）。
- **依据**：Prometheus instance 内置标签机制（抓取地址自动注入）；用户确认「MVP 隐藏 + 默认模板标注内置默认 + PRD v2.9 落档」；与 5.12 B prometheus_builtin 隐藏模式对齐。
- **影响范围**：Module_07 PRD 5.12 C / 5.13（v2.9）；原型 LabelTemplatesPage（v2.5：新增映射隐藏组合字段选项 + 默认模板「内置默认」标注）；Module_01 5.1 端口一致性说明关联（引用仍成立，不改）。

### 已确认项（2026-08-14 第十七轮）

- [x] 组合字段 MVP 前台隐藏（同 prometheus_builtin 模式）（用户确认）。
- [x] 默认模板 composite 行标注「内置默认」（用户确认）。
- [x] 端口配置点不变：CI-Exporter 映射 default_port（用户确认）。
- [x] application 不补 composite（endpoint 自带端口，免配）（用户确认）。
- [x] 落档：M07 PRD v2.9 + 原型 v2.5 + design-decisions（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] v0.2+ 组合字段开放场景（服务发现/代理抓取/端口覆盖的身份定制）详细设计待后续迭代。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.9）
- `docs/prototypes/module-07/`（v2.5，已同步）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（5.1 端口一致性说明）

---

## 补充对齐：2026-08-15（M07 网域作为筛选器而非上下文）

- **参与 Agent**：prototype-designer
- **触发原因**：讨论网域跨模块一致性时，明确 M07 不应采用 M01/M09 的顶部网域上下文切换器。
- **关联模块**：Module_06、Module_09、Module_01。

### 关键决策

#### 决策 3.51：M07 资源列表采用网域筛选器模式

- **问题**：M07 是否应在顶部增加「当前网域」上下文栏？
- **结论**：
  1. **M07 不采用顶部网域上下文栏**。资源是全局配置（MVP 本地维护 / v0.4+ CMDB 同步），用户需要跨域搜索和全局查看能力。
  2. 资源列表提供「网域」筛选器：默认记忆用户上次选择（可为当前用户有权限的某个域），但始终可切换为「全部网域」。
  3. 「网域」列保留且不可隐藏，作为资源的基础属性展示。
  4. 资源详情页将「网域」字段置顶展示，避免淹没在其他 CMDB 字段中。
- **依据**：M07 核心任务是维护监控对象，不是为某个域配置策略；Resource 有 `network_domain_id` 字段但本质是全局对象。
- **影响范围**：M07 PRD 3.1 / 5.2；ResourcesPage 列表筛选器与详情页布局；原型 v2.5+ 同步。

#### 决策 3.52：Excel 导入与网域字段

- **问题**：Excel 导入时 `network_domain` 列如何处理？
- **结论**：
  - Excel 模板保留 `network_domain` 列；
  - 导入时校验该网域是否已在 M06 存在（属于当前租户）；
  - 未填写时可默认归 `default` 或提示必填（视 MVP 策略后续在 PRD 中明确）。
- **依据**：`Resource.network_domain_id` 为必填字段；M07 不维护网域生命周期，只消费 M06 已存在网域。
- **影响范围**：M07 PRD 6.1 Excel 导入说明。

### 已确认项（2026-08-15）

- [x] M07 不采用顶部网域上下文栏，改用列表内筛选器（用户确认）。
- [x] 资源列表默认可按网域记忆筛选，但支持「全部网域」（用户确认）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`
- `docs/05-execution-records/module-09/design-decisions.md`（决策 25/26/27/28，跨模块主记录）

---

## 补充对齐：2026-08-16（M07 侧：资源分类五大类拆分 + 标签模板锚点粒度确认，决策 D18/D19）

- **参与 Agent**：用户、prototype-designer
- **触发原因**：M01 第二十五轮讨论（决策 D18/D19 主记录在 `docs/05-execution-records/module-01/design-decisions.md`）涉及 M07 数据模型的两处变更，需在本模块落档同步。
- **关联模块**：Module_01、Module_04、Module_07。

### 分析背景：CMDB 分类轴与监控采集轴两级映射推导（不统一分类法）

- CMDB `bk_obj_id`（细粒度资源本质轴）→ M04「CMDB CI 类型映射表」归类 → M07 粗粒度类别 + 细粒度子类型 → M01 `CI_TYPE_CATEGORY_MAP` 推导 → M01 细粒度 CI 类型。
- CMDB 侧永远不需要知道"采集实现"概念；M01 细粒度 CI 类型是派生策略维度、不回写 CMDB；新增产品线只配两行映射（M04 + M01），不改 CMDB 模型定义。
- 本模块（M07）处于链中游：维护粗粒度类别 + 细粒度子类型字段（`middleware_type`，拟拆 `database_type` + `middleware_type`），是资源字段 schema 的归属方。

### 关键决策

#### 决策 D19（M07 侧）：资源分类四大类改五大类，数据库独立成类；`middleware_type` 拆为 `database_type` + `middleware_type`

- **结论**：
  1. 资源类别由四大类改为**五大类**：`host` / `database` / `middleware` / `application` / `generic_target`；
  2. **归类规则**（写进规则避免每来一个新产品线都争一次）：以**数据存储/查询为主语义、按产品线分采集器** → database（mysql、postgresql、oracle、达梦 dm8、sqlserver、mongodb、**redis**）；**消息/网关/协调/搜索** → middleware（kafka、nginx、zookeeper、**elasticsearch**）；
  3. M07 细粒度子类型字段由 `middleware_type` 拆为 **`database_type` + `middleware_type`** 两个字段（Resource 资源字段 schema、Excel 导入模板列、枚举同步调整）；
  4. **边界案例**：redis → database（缓存，业界多数 CMDB 放数据库/缓存侧，用户已确认）；elasticsearch → middleware（建议默认值，**已按该默认值落地**，后续如调整仅改归类规则与映射表）。
- **依据**：数据库按产品线重度扩张（达梦 / Oracle / SQL Server / PG / MongoDB），与消息/网关类中间件资源性质、采集器生态、使用人心智不同；趁 MVP 无存量数据改枚举成本最低。
- **涟漪影响清单**：M07 资源类型枚举与字段表、Excel 导入模板列、标签模板类别归属（`LabelTemplate.resource_category`）、业务视图聚合措辞、M01 `CI_TYPE_CATEGORY_MAP` / 两级级联 / 指标库最小集表、M04 CMDB CI 类型映射表、全局架构文档与术语映射、所有原型 mocks。**对 CMDB 兼容性无影响**——`bk_obj_id` 不变，仅映射表多一个目标类别值。
- **影响范围**：M07 PRD 5.x 资源类型枚举与字段表、6.1 Excel 导入说明；原型 mocks（module-07 / module-01 / module-04 等）。

#### 决策 D18（M07 侧配合）：标签模板锚点粒度 = 粗粒度资源类别，M07 模型不动

- **结论**：`LabelTemplate.resource_type` 保持**粗粒度类别**锚点（现状不变）——标签模板内容（字段 → label 映射）由资源字段 schema 决定、是类别级的（M07 5.12 A 字段来源表按 主机/中间件/应用服务 组织）；M01 映射按 CI 类型指定该类别下的默认模板、选择器按「所属类别」过滤（修订 M01 PRD v3.3「按 CI 类型严格过滤」措辞）。避免 host_linux / host_windows 各建一套内容几乎相同的模板。
- **影响范围**：M07 模型**不动**；M01 侧 PRD 措辞修订 + 原型选择器过滤逻辑。
- **状态**：**建议，待用户确认**（M01 主记录同步）。

### 已确认项（2026-08-16）

- [x] 资源分类五大类拆分（D19）确认；redis → database（用户确认）。
- [x] 标签模板锚点 = 粗粒度类别、M07 `LabelTemplate.resource_type` 不动（D18 的 M07 侧结论）。
- [x] **D18/D19 已按用户修改意见落地**：M07 PRD v2.13（5.1 枚举五大类 + CMDB 侧边界、5.2 字段表新增 database_type、5.7.1 数据库资源、5.10 锚点说明、5.12 A 字段来源拆分、5.13 数据库默认模板、7.1 数据库导入模板列、术语映射）；M01 v3.15 / M04 v1.3 同步；elasticsearch 按建议默认值留 middleware。

### 仍待确认项

- [ ] **原型 mocks 同步（D19 涟漪，待执行）**：module-07 / module-01 / module-04 原型 mocks 的 CI 类型、类别枚举、资源 mock 需从四大类调整为五大类（database 独立 + database_type / middleware_type 拆分）。
- [ ] D19 落库后跨模块验证：M01 `CI_TYPE_CATEGORY_MAP` / 两级级联 / 指标库最小集表、M04 映射表与 M07 字段拆分的一致性（PRD 已改，验证与原型同步待执行）。

### 关联文档

- `docs/05-execution-records/module-01/design-decisions.md`（D17-D23 主记录，第二十五轮；D24 主记录，第二十六轮）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.14）
- `docs/02-product-requirements/Modules/Module_04_Custom_Discovery.md`（v1.4，CMDB CI 类型映射表同步）

---

## 补充对齐：2026-08-16（M07 侧：术语分层与字段改名，决策 D24 同步）

- **触发原因**：M01 第二十六轮决策 D24（术语分层：CI 类型专属 CMDB/M04、资源类别归 M07、监控对象类型归 M01）涉及 M07 字段改名，主记录见 `module-01/design-decisions.md`。
- **M07 侧结论**：
  1. `Resource.resource_type`（粗粒度）→ **`resource_category`**：枚举类型 `ResourceType` → `ResourceCategory`（常量 `ResourceTypeHost` → `ResourceCategoryHost` 等）、5.2 字段表、5.10 `LabelTemplate.resource_category`、5.12 A 表头、6.x API query / 错误码、Excel 状态映射、孤儿资源分组、术语映射全量同步；UI 展示名「资源类型」→「资源类别」。
  2. 5.1 细粒度维度引用改为 M01 `monitor_type`、推导表改 `MONITOR_TYPE_DERIVATION_MAP`（消除与 M01 细粒度 `resource_type` 同名不同粒度的 API 歧义）。
  3. 「CI 类型」仅在 CMDB / M04 上下文保留（CMDB 侧边界段不变）；M07 资源详情可只读展示派生的监控对象类型（UX 建议，随原型落地）。
- **状态**：已确认并落地（M07 PRD v2.14）。原型 mocks 术语同步待执行。

---

## Change Log（完整历史）

> v1.6 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.3 及以前的逐版完整变更详情（业务沟通决策记录）。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v2.6 | 2026-08-12 | 修改 | 标签口径统一（用户反馈）：3.3 / 5.3 新增「标签来源 vs 映射字段来源」统一口径——system = 模板产物（MVP 字段来源 = 资源字段/组合字段）、user = 实例级自定义（不走模板）、cmdb = v0.4+ 预留（mock 占位展示）；明确模板映射不新增 user\_field（Resource 字段固定 + 唯一入口原则，类型级自定义走 P1 批量标签编辑）；术语映射补充 Mapping.source\_type 行；原型资源详情新增「标签口径说明」图例、cmdb 标签降级 v0.4+ 占位、user 文案改「资源自定义」 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v2.5 | 2026-08-12 | 修改 | 标签模板用户动线优化（第九轮需求讨论）：标签模板创建入口放 Module_01 CI-Exporter 映射页（首次引入 CI 类型时引导创建，决策 3.37）；关联实例 Tab 隐式关联显性化说明（3.38）；资源页标签操作文案弱化「自定义标签（非必须）」+ 引导提示（3.39/3.40）；CI-Exporter 映射列表新增「标签模板」展示列（3.41）；ScrapeJob 标签模板引用体验增强（3.42）；原型同步 v2.1 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v2.4 | 2026-08-11 | 修改 | 标签模板页布局重构（第八轮需求讨论）：右栏 Tab 化（映射明细 / 关联实例 Table 含分页+搜索+状态筛选）；左栏模板卡片精简为名称+Tag+映射数+实例数 badge（去掉 Popover 弹窗，实例多时无法承载）；原型同步 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v2.3 | 2026-08-11 | 新增 | 模板↔实例关联显式展示（第七轮需求讨论）：3.2 新增「关联实例展示」（模板页显示关联实例 N 个 + 可展开清单）；3.1 新增「适用模板展示」（资源详情显示默认模板名+ID）；6.3 新增模板关联实例查询接口；12.1 验收补充（模板与实例仍按 resource\_type 隐式关联，不引入显式绑定） | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v2.2 | 2026-08-11 | 修改 | 标签治理收敛（第六轮需求讨论）：修正 5.3/5.14 矛盾（system 保护标签不可被 user 覆盖，冲突优先级 cmdb>user）；补充 system 标签实时计算生成时机（Module\_09 生成配置时，模板变更穿透 Job 配置）；新增「标签配置唯一入口原则」（类型级走模板/实例级走 user 标签/Job 仅引用模板、不引入实例级模板）；3.3 补充来源标注与模板联动、类型级变更引导；12.1 验收补充（与 Module\_01 v2.9 对齐） | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v2.1 | 2026-08-11 | 修改 | 组合字段交互契约澄清（原型修复同步）：5.11 composite 来源目标标签锁定为 instance 不可编辑（理由：预置规则，改动破坏 Prometheus 标准 instance 语义）；12.1 新增「组合字段目标标签锁定」用户验收；12.2 新增「composite→instance 例外校验」技术验收（决策 3.4） | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v2.0 | 2026-08-11 | 新增 | 需求闭环：新增第 6 章「接口设计」（Resource / ResourceLabel / LabelTemplate / 导入记录 REST 契约 + Module\_01/09 只读消费契约，原 6\~11 章顺延为 7\~12）；3.2 组合字段补充用户语言说明；12.2 新增组合字段出值技术验收（instance = instance\_ip + default\_port）；用户故事新增 M07-OPS-07（标签模板管理，已回写全局库 §4.7）；原型版本对齐 v2.0 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v1.9 | 2026-08-11 | 修改 | 需求澄清：Excel 状态映射保持 MVP 配置层+UI 只读并明确枚举一致性规则（仅 status 可映射，其他枚举列强制一致）；转换规则改为下拉可留空（prefix/replace P1 参数化）；组合字段补充取值时序（port 取映射 default\_port，与 Job/Exporter 无关）；prometheus\_builtin MVP 隐藏、枚举保留；原型待同步 v1.5 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v1.8 | 2026-08-11 | 修改 | UI/UX 布局落地：标签模板页左右分栏 + 搜索/默认·自定义筛选 + 模板与映射抽屉编辑 + 映射按来源类型分组（MVP 不分页）；资源新增/编辑改抽屉；资源列表新增「列显隐配置」（P1）；原型待同步 v1.4 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v1.7 | 2026-08-11 | 修改 | 标签模板需求澄清：明确「默认模板/内置参数模板」非设计类别（内置字段由 Prometheus 原生注入无需映射，示例模板清理）；新增映射时目标标签默认=来源字段、同模板目标标签唯一校验；模板列表展示模板 ID；组合字段补充跨层解析说明 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v1.6 | 2026-08-07 | 新增 | 按 prototype-designer PRD 骨架规范补齐：5.x 字段表加「UI 展示名」列、新增 5.14 数据模型状态机、新增「术语映射」章节、验收标准分层（11.1 用户 / 11.2 技术）+ P0/P1 标注、第 2 章用户故事引用全局库（M07- 编码）、Change Log 精简 | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v1.5 | 2026-08-07 | 新增 | 补充「提示分区规范」章节 + 原型清理用户可见文案中决策/PRD 引用（46 处）+ MainLayout 全局折叠区 | 全部 | 文档自身 | 设计中 |
| v1.4 | 2026-08-04 | 修改 | 补充「CMDB 侧边界」说明（CMDB 细粒度 CI 类型 vs MetricCenter 粗粒度四大类） | 全部 | MVP / v0.4 / v1.0 | 设计中 |
| v1.3 | 2026-08-04 | 修改 | 落盘设计决策 16：明确两套 CI 类型粒度体系——`Resource.resource_type` 为粗粒度四大类（host/middleware/application/generic_target）+ `middleware_type` 细粒度子类型（mysql/redis/kafka/...），细粒度 CI 类型映射到 Module_01（策略层）的 resource_type（映射表 CI_TYPE_CATEGORY_MAP 见 Module_01 5.1）；v0.4+ CMDB 为唯一权威来源（Module_04 同步后写入四大类 + middleware_type，MetricCenter 只维护映射不增删类型） | 数据模型、模块边界 | MVP / v0.4 / v1.0 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | 明确单网域模式下 Resource 列表仍展示「网域」列，网域作为云区域概念不可隐藏 | 功能范围、UI/UX、Excel 模板 | MVP | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | MVP / v0.4 / v1.0 | draft |
