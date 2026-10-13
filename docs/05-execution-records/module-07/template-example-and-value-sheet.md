# M07 资源导入模板：补示例行 + sheet2 按类取值说明（F-23 / F-24）

- 状态：已完成（代码 + 测试 + 破坏验证）
- 作者：backend-developer
- 关联分支：`feat/module-08-alert-dispatch`
- 变更范围：`platform/config/resource/template.go`、`platform/config/resource/excel.go`、`platform/config/resource/template_test.go`

---

## 1. 三类问题根因

### F-23-① 模板缺示例行，用户不知道每格填什么

**现象**：下载到的 xlsx 只有表头行 + 一个「取值说明」sheet。用户打开后面对
`network_domain / instance_name / os_type / biz_code ...` 一串英文列码，没有任何一行
真实形态的样例； sheet2 的说明文字（如「源状态 → 目标状态」「key1=value1;key2=value2」）
是描述性语句，不是可直接照抄的填法。

**根因**：`buildTemplateXLSX` 原实现只写第 1 行表头（`for i, col := range columns {...}`），
第 2 行起留空；MVP 阶段刻意没做 dataValidation 下拉（§5.16.1「挪 v0.2+ 评估」），
于是「列头 ↔ 填法」之间没有任何桥梁。

**修复**：sheet1 第 2 行写入示例数据行，由新函数 `templateExampleRow(category)` 从
`TemplateColumns[category]` 的列序推导（**必填列有值、选填列一律留空**），整行套浅色
斜体底纹（`Fill=F2F2F2` + `Font.Italic` + 灰色字）标注为示例。

示例值取值口径：
- 易被误认为真实字典的编码/名称类字段统一带「示例」或 `example` 字样
  （`example-biz` / `example-app` / `示例-cluster` / `示例-pay-service`）；
- IP 一律用 RFC 5737 文档保留段 `192.0.2.0/24`（`192.0.2.1` / `.2` / `.3` / `.20` / `.30`），
  真实内网网段不会出现；
- `generic_target` 的 `app_code` / `biz_code` 是「二选一」，示例行只演示 `biz_code`
  一侧、`app_code` 留空，直观呈现最小满足形态。

### F-23-② sheet2 只有英文码，没有中文释义，英文码对不上号

**现象**：原 sheet2 表头只有两列「取值字段 / 合法值 / 格式说明」，第一列直接是
`biz_code`、`os_type` 这种英文码。用户抱怨「英文码对不上号」——页面里叫「业务名称」、
「操作系统」，Excel 里写 `biz_code`、`os_type`，没有映射关系。

**根因**：sheet2 缺少一列显式的「中文含义」，且没有权威的列码 → 中文名映射表，
每加一列都要在多处手写中文名。

**修复**：新增静态说明表 `templateColumnDocs map[string]templateColumnDoc{Label, Hint}`
（中文含义对齐 `ui-custom/web/src/pages/resources/resourceColumnPrefs.ts` 的列 label 与
`ResourceFormDrawer.tsx` 的表单项 label，只读参考未改动前端），sheet2 表头扩为四列
`取值字段 / 中文含义 / 必填口径 / 合法值 / 格式说明`。配套
`templateColumnRequiredLabel(category, col)` 输出逐列必填口径（必填 / 可留空 / 二选一 /
可留空（留空按 default 网域导入）等），口径真值取自 `excel.go` 的必填分化与 `validate.go`
各 `validate*` 分派函数，**不取自前端表单**。

新增列若漏登记中文含义，由 `TestTemplateColumnDocsCoverAllColumns` 双向拦下
（`TemplateColumns` 有而 `templateColumnDocs` 无 → 失败；反之 `templateColumnDocs` 有而
任何类别都不用 → 失败，防残留死条目）。

### F-24 sheet2 与 sheet1 不对应

**现象**：原 sheet2 是**一份全局固定清单**（network_domain / zone_env / biz_code /
app_code / env / status / custom_labels），不随资源类型变化。下载 `host` 模板，sheet2
里赫然出现 `custom_labels` 的 `key1=value1;key2=value2` 说明——但 host 模板根本没有这一列；
反过来 `zone_env` 只在 host 有，却出现在所有类型的 sheet2 里。用户无法把 sheet2 的行
和 sheet1 的列一一对应。

**根因**：`buildValueSheet` 原来没有 `category` 参数（签名是
`buildValueSheet(bizStore, appStore, platformStore, svcStore, listDomains)`），只能输出
一份与类别无关的固定行序。

**修复**：见下节。

---

## 2. sheet2 按类过滤的实现方式（单一权威来源）

**关键约束：不得引入第二份手写的「类别 → 列」映射**，否则就是新的漂移点。

实现方式：
1. `buildValueSheet` / `buildTemplateXLSX` 的首参从「列数组」改为 `category`
   （`buildTemplateXLSX(columns []string, ...)` → `buildTemplateXLSX(category, ...)`），
   两个函数内部统一从 `TemplateColumns[category]` 取列序。
2. `buildValueSheet` 用 `TemplateColumns[category]` 构造 `present` 集合，字典实时注入
   （network_domain / biz_code / app_code / platform_code / service_code / env / status）
   全部改为 `if present["xxx"] { ... }` 守卫——**只对该类别实际存在的列查询与输出**，
   避免为不存在的列白跑一次 DB 查询。
3. 末尾按 `for _, col := range columns` 逐列输出，保证 **sheet2 行序 ≡ sheet1 列序**。

即：`TemplateColumns` 是 sheet1 列头、sheet1 示例行、sheet2 行序与过滤的**唯一权威来源**，
三者共用同一份列定义，结构上不可能漂移。`TestDownloadTemplateValueSheetColumnsPerCategory`
断言「取值说明行数 == 该类别列数」且逐行 `rows[i][0] == TemplateColumns[cat][i]`。

**降级行为**（字典为空 / store 为 nil / listDomains 为 nil 均不 panic）：
- `listDomains == nil` → 跳过网域清单查询；
- `platformStore == nil` → 只输出静态兜底说明「可空列，留空按所属应用主平台兜底」；
- `svcStore == nil` → 只输出「可选列，留空不填」；
- `appStore` 启用项为空 → 输出占位引导「暂无已登记应用」（而非空串）；
- 全部四张字典表为空时仍产出完整 `len(columns)+2` 行。

由 `TestBuildValueSheetEmptyDictsNoPanic` 三个子测试覆盖。

> 一处**行为变更**需说明：原断言 `custom_labels 格式说明在所有类别的 sheet2 中都存在`
> 已改写为 `TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget`——F-24 按类
> 过滤后，`key1=value1;key2=value2` 只应出现在 `generic_target` 的 sheet2 中，host 等类别
> 不应出现。这是修复目标本身，不是删断言凑绿。

---

## 3. 示例行防误导入策略

用户在 Excel 里**看不见样式**（底纹/斜体在部分客户端不渲染），所以「提示删除示例行」
不能只靠视觉，必须在解析侧兜住。

策略：**逐格全等判定**（`isTemplateExampleRow`，`excel.go`）：
- 与 `templateExampleRow(category)` 逐格比对到模板列数为止，缺失的尾部单元格视为空串；
- 超出模板列数的多余非空单元格一律视为非示例行；
- **任一格不相等即返回 false** —— 用户只要改动任一格（含按真实字典填码），
  该行即按普通数据行走原有校验流程，行为与改造前**完全一致**。

`ParseExcel` 在 `allEmpty` 之后、`applyCells` 之前插入该判定并 `continue` 跳过。
只影响行的取舍，**不改动后续行级校验规则与错误文案**；行号仍取 `i+1`，错误反馈行号不变。

示例值与判定逻辑的一致性由**构造方式**保证：`isTemplateExampleRow` 直接调用
`templateExampleRow(category)`，二者读同一个函数、同一份列定义，不存在两处手抄的
常量副本，因此**任何一侧改动都会同步生效**，不会出现「示例行被当真实数据导入」或
「用户真实数据被吞」。

示例行的必填/选填取值不是硬编码的 `if`，而是按 `templateColumnRequiredLabel(cat, col)`
这份必填口径表反推——`TestDownloadTemplateExampleRow` 就是拿同一个口径函数逐列校验
示例行的空/非空，保证「口径说必填 ⇒ 示例行有值」「口径说可留空 ⇒ 示例行为空」。

`TestDownloadedTemplateParsesToZeroRows` 是端到端护栏：真实下载的模板原样上传，
解析结果必须为 0 行，确保 sheet2 的提示文案（「导入解析会自动跳过与示例行完全一致的数据行」）
与实现一致。

---

## 4. 破坏验证（真实执行结果）

三轮临时破坏，每次确认对应测试变红后立即恢复。命令统一为
`go test ./platform/config/resource/...`。

### 破坏 A：sheet2 不按类过滤（临时把 `columns` 换成全量列并集）

```
--- FAIL: TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget (0.01s)
    --- FAIL: TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget/host (0.00s)
--- FAIL: TestDownloadTemplateValueSheetColumnsPerCategory (0.02s)
    --- FAIL: TestDownloadTemplateValueSheetColumnsPerCategory/host (0.00s)
    --- FAIL: TestDownloadTemplateValueSheetColumnsPerCategory/database (0.00s)
    --- FAIL: TestDownloadTemplateValueSheetColumnsPerCategory/middleware (0.00s)
    --- FAIL: TestDownloadTemplateValueSheetColumnsPerCategory/application (0.00s)
    --- FAIL: TestDownloadTemplateValueSheetColumnsPerCategory/generic_target (0.00s)
--- FAIL: TestBuildValueSheetEmptyDictsNoPanic (0.00s)
    --- FAIL: TestBuildValueSheetEmptyDictsNoPanic/全部字典与网域清单为空 (0.00s)
    --- FAIL: TestBuildValueSheetEmptyDictsNoPanic/平台与服务字典_store_为_nil (0.00s)
    --- FAIL: TestBuildValueSheetEmptyDictsNoPanic/listDomains_为_nil (0.00s)
FAIL	github.com/metriccenter/metriccenter/platform/config/resource	0.991s
```

典型失败信息（host）：

```
Error: "…|custom_labels|自定义标签|可留空|key1=value1;key2=value2|…"
       should not contain "custom_labels"
Test:  TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget/host

Error: "…28 items…" should have 14 item(s), but has 28
Messages: 取值说明行数应等于该类别 sheet1 列数（不允许混入其他类别的列）
Test:    TestDownloadTemplateValueSheetColumnsPerCategory/host
```

### 破坏 B：示例行必填格留空（临时删掉 host 示例行的 `os_type` 取值）

```
--- FAIL: TestDownloadTemplateExampleRow (0.02s)
    --- FAIL: TestDownloadTemplateExampleRow/host (0.00s)
FAIL	github.com/metriccenter/metriccenter/platform/config/resource	1.419s
```

### 破坏 C：关闭示例行跳过（`isTemplateExampleRow` 直接 `return false`）

```
--- FAIL: TestParseExcelSkipsTemplateExampleRow (0.02s)
    --- FAIL: TestParseExcelSkipsTemplateExampleRow/host (0.00s)
    --- FAIL: TestParseExcelSkipsTemplateExampleRow/database (0.00s)
    --- FAIL: TestParseExcelSkipsTemplateExampleRow/middleware (0.00s)
    --- FAIL: TestParseExcelSkipsTemplateExampleRow/application (0.00s)
    --- FAIL: TestParseExcelSkipsTemplateExampleRow/generic_target (0.00s)
--- FAIL: TestDownloadedTemplateParsesToZeroRows (0.02s)
    --- FAIL: TestDownloadedTemplateParsesToZeroRows/host (0.00s)
    --- FAIL: TestDownloadedTemplateParsesToZeroRows/database (0.00s)
    --- FAIL: TestDownloadedTemplateParsesToZeroRows/middleware (0.00s)
    --- FAIL: TestDownloadedTemplateParsesToZeroRows/application (0.00s)
    --- FAIL: TestDownloadedTemplateParsesToZeroRows/generic_target (0.00s)
FAIL	github.com/metriccenter/metriccenter/platform/config/resource	1.398s
```

三轮破坏均被新测试捕获，恢复后 `grep -rn "BREAK-" platform/config/resource/` 返回 CLEAN，
`go test -count=1` 回到 `ok`。

---

## 5. 测试真实输出（恢复后）

```
$ export PATH="$(pwd)/.tools/go/bin:/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH"
$ go build ./platform/...
（无输出，exit 0）
$ go vet ./platform/config/resource/...
（无输出）
$ go test ./platform/config/resource/... -count=1
ok  	github.com/metriccenter/metriccenter/platform/config/resource	1.205s
```

新增 / 改写测试清单（均在 `template_test.go`）：

| 测试 | 覆盖 |
|------|------|
| `TestTemplateColumnDocsCoverAllColumns` | 列码 ↔ 中文含义双向覆盖，无遗漏无死条目（F-23-②） |
| `TestDownloadTemplateValueSheetColumnsPerCategory` | 五类 sheet2 行数 == sheet1 列数、行序逐列一致（F-24 核心护栏） |
| `TestDownloadTemplateValueSheetHasChineseLabel` | 每行中文含义非空且与静态说明表一致，抽样对齐页面展示名（F-23-②） |
| `TestDownloadTemplateValueSheetRequiredLabel` | 逐列必填口径如实反映后端口径（含 generic_target 二选一） |
| `TestDownloadTemplateValueSheetNoteRow` | sheet2 顶部示例行提示存在 |
| `TestDownloadTemplateExampleRow` | 必填列有值、选填列留空（F-23-①，与必填口径同源） |
| `TestDownloadTemplateExampleRowStyle` | 示例行带浅色底纹 + 斜体 |
| `TestParseExcelSkipsTemplateExampleRow` | 仅示例行→0 行；示例+真实→只留真实且行号为原始行号；改任一格→走正常流程 |
| `TestDownloadedTemplateParsesToZeroRows` | 端到端：原样上传真实模板解析出 0 行 |
| `TestBuildValueSheetEmptyDictsNoPanic` | 字典全空 / platform+svc store 为 nil / listDomains 为 nil 均不 panic |
| `TestDownloadTemplateValueSheet_CustomLabelsOnlyForGenericTarget` | custom_labels 说明只出现在 generic_target（改写原「所有类别都有」断言） |

---

## 6. 未做项（待设计裁定，本轮不动）

1. **`cluster` 必填性矛盾**：`templateColumnRequiredLabel` 对
   database / middleware / application 输出「必填」（后端 `ValidateResourceInput` 的真实
   口径），但前端 `ResourceFormDrawer` 表单里 cluster 是选填。本轮**如实按后端口径标注**，
   不改任一侧口径。矛盾需设计侧裁定后再回填 PRD §5.16.1 与前端。
2. **`zone_env` 列存废**：决策 101 保留 host 兼容导入列（不进标签、不作分区权威，权威值
   为所属网域 `zone_type`）。本轮只在 sheet2 如实标注其含义与「兼容列」定性，
   **不删列**。是否彻底移除待裁定。
3. **dataValidation 下拉**：仍按 §5.16.1 挪 v0.2+ 评估，本轮只做示例行 + 文案，
   未引入 Excel 原生下拉（避免 excelize 兼容性风险）。
4. **示例行与「真实数据恰好全等」的歧义**：理论上用户若逐格填出与示例行完全相同的
   内容（如真的把主机命名为 `示例-web-01`、IP 为 `192.0.2.1`），该行会被跳过。示例值已用
   RFC 5737 保留段 + 「示例」字样把概率压到极低，且 sheet2 已提示删除示例行，本轮接受
   该权衡。若后续反馈真实碰撞，可改为「仅当整表只有示例行时才跳过」的更保守口径。
