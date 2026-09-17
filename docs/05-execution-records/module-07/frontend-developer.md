# frontend-developer 执行记录：module-07

## 任务

- 角色：frontend-developer
- 任务 ID：T07-F1（前端资源 API client + types + 单测）
- 分支：`feat/module-07-resource-management`
- 日期：2026-08-22

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`
  - §3 核心功能、§5 数据模型、§6 接口设计、§9 验收标准、§11 前端交互契约
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` 的 T07-F1 及后端契约 T07-02/05/06/07/08/10/11/12 的 contract 段
- 工程标准：`docs/03-engineering-standards/03_API_Standard.md`、`docs/03-engineering-standards/02_Frontend_Standard.md`
- 复用模式：`src/api/client.ts`、`src/api/domain.ts`、`src/api/health.ts`、`src/types/resource.ts`、`src/types/api.ts`、`src/types/domain.ts`

## 改动文件列表

- 新建 `ui-custom/web/src/api/resources.ts`
- 新建 `ui-custom/web/src/api/resources.test.ts`
- 追加 `ui-custom/web/src/types/resource.ts`（仅在末尾追加，未改动既有 Resource 类型族）

## 关键实现说明

### 类型（types/resource.ts 追加）

- `ResourceStatus`：`'online' | 'offline' | 'maintenance'`
- `ResourceCreateInput`：按 `resource_category` 判别联合（host/database/middleware/application/generic_target × 差异化字段），`resource_category` 创建必传、`biz_code` 全类型必填；差异化字段与 PRD §5.6~§5.9 对齐（host: instance_name/hostname/instance_ip/os_type；database: database_type/instance_ip/port/version；middleware: middleware_type/instance_ip/port/version；application: service_name/endpoint/health_check_url/protocol/port；generic: target_name/instance_ip/port/metrics_path/scheme/exporter_type/custom_labels）
- `ResourceUpdateInput`：各类型字段均可选的部分更新联合（不含 resource_category/source_type——创建后不可改，T07-06）
- `ImportError` / `ImportResult`（`updated?` 仅 upsert）/ `ImportMode` / `ImportRecord`
- `BusinessDomain {code,name,description?,enabled}`
- `ResourceLabelItem {id,key,value,source,source_map?}`（system 标签带 source_map 供「app_name→app」联动标注，§5.3）

### API（api/resources.ts）

- `resourceApi`：`list`（GET /api/v2/platform/resources，参数 resource_category/network_domain_id/keyword/is_monitored/page/page_size）、`create`、`update`、`remove`（DELETE :resource_id）
- `resourceApi.template`：GET `/:type/template`，**原生 fetch + response.blob()** 返回 `Blob`（该接口响应不是统一 JSON 信封）；失败时解析统一错误信封抛 `ApiError`
- `resourceApi.importExcel`：POST `/:type/import`，**原生 FormData（file + mode）**，不手动设置 Content-Type（浏览器自动带 boundary）、不做 JSON 序列化；响应按统一信封解析，失败抛 `ApiError`
- `resourceApi.labels`（GET 返回 `{items,total}`）/ `createLabel`（{key,value}）/ `updateLabel`（{value}）/ `removeLabel`（DELETE 返回 `{label_id}`）
- `businessDomainApi.list`（GET /business-domains，`{list,total}` 非分页信封）
- `importApi.list`（params: resource_category/status/page/page_size）/ `get`（/:import_id）

## 遇到的问题与解决

- **client.ts 的 `buildUrl` / `parseResponse` 未导出**：模板下载与 Excel 导入无法复用统一 `request()`（会强制 JSON 序列化 body、只能处理 JSON 信封）。在 `resources.ts` 内实现了轻量 `parseEnvelope` / `requestMultipart` / `downloadBlob` / `toApiError` 辅助函数，语义与 client 一致（含 `!res.ok || status==='error'` 抛 ApiError）。受「禁止修改 client.ts / index.ts」约束，未外提公共函数，留待编排者收口时评估。
- **相对路径 URL**：原生 fetch 使用相对路径（`/api/v2/...`），浏览器按当前 origin 解析；jsdom 测试中 `new URL(call[0], window.location.origin)` 统一解析相对/绝对 URL。
- **`is_monitored=false` 参数**：client 的 `buildUrl` 只丢弃 undefined/null/''，布尔 `false` 会被序列化为 `"false"` 正常透传，已用单测覆盖。

## 验证结果

- `cd ui-custom/web && pnpm lint`：通过（`--max-warnings 0`，无告警）
- `cd ui-custom/web && pnpm test`：**11 个测试文件 / 70 个用例全部通过**（其中 `src/api/resources.test.ts` 16 个用例）
- `pnpm exec tsc --noEmit`：通过（业务代码类型检查无错误）
- 基线：改动前 9 文件 / 45 用例全绿；本次新增 16 个用例，其余为并行 Agent 新增页面用例（均通过）

## 遗留风险 / 待确认

- **importExcel 的 multipart 字段**：本任务按输入要求仅传 `file + mode`；后端契约 T07-10 提到 multipart 解析 `file + resource_category + mode`，而路径 `/:type/import` 已带 type。若后端实际要求表单内再带 `resource_category`，需在 F5 联调时补字段。
- **business-domains 响应形态**：按 T07-02 contract 定为 `{list,total}`；PRD §6.1 未给出响应结构，若后端实际返回原始数组，需调整 `BusinessDomainsResponse` 解析。
- **ID 类型**：`ResourceLabelItem.id` / `ImportRecord.id` 采用 `number`（与既有 `ResourceLabel.id`、`ResourceBaseShape.id` 一致）；PRD §5.3 将 label `id` 记为 string，需在联调时确认后端 JSON 实际类型。
- **路径前缀**：PRD §6 写 `/api/v1/*`，任务卡与后端 contract 统一为 `/api/v2/platform/*`，本实现以任务卡为准（`/api/v2/platform/...`）。
- **template 下载错误处理**：按统一错误信封解析失败时抛 `ApiError`；若后端模板接口错误体为非 JSON，将回退 statusText。

---

## 任务 T07-F7：标签模板页左栏列表

- 角色：frontend-developer
- 任务 ID：T07-F7（标签模板页左栏列表）
- 分支：`feat/module-07-resource-management`
- 日期：2026-08-22

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3.2（标签模板）/ §5（数据模型）/ §6（接口）/ §11.1（前端交互契约）
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` 的 T07-F7 及后端契约 T07-08（labelTemplateApi 契约）
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`（复用共享组件，禁止散点 Space wrap）
- 复用模式：`src/pages/resources/ResourcesPage.tsx` + `useResources.ts`（列表 + 抓取模式）、`src/components/EllipsisText.tsx`

## 改动文件列表

- 新建 `ui-custom/web/src/pages/label-templates/LabelTemplatesPage.tsx`（页面入口：资源类别 Tab + 新增模板 Drawer + 左右栏布局）
- 新建 `ui-custom/web/src/pages/label-templates/TemplateList.tsx`（左栏模板列表：搜索 / 筛选 / 卡片 / 分页 / 克隆 / 删除）
- 新建 `ui-custom/web/src/pages/label-templates/LabelTemplatesPage.test.tsx`（12 个单测）

## 关键实现说明

### 页面结构（LabelTemplatesPage.tsx）

- 五类资源 Tab（host/database/middleware/application/generic_target），横向 Tab + 右上「新增模板」按钮
- 左右栏布局：左 9 栏 TemplateList（模板列表），右 15 栏模板详情占位（TODO T07-F8）
- 新增模板走 Drawer：名称 + 资源类别（Select 默认取当前 Tab），创建成功后 message 提示并触发左栏 `reloadKey` 自增重载；默认模板由系统预置不可手动创建（表单文案说明）

### 左栏列表（TemplateList.tsx）

- 数据抓取：`labelTemplateApi.list({ resource_category, is_default, keyword, page, page_size: 50 })`，`useCallback` + effect 模式（沿用 useDomains / useResources 风格）；资源类别 Tab 切换时回到第 1 页并显示骨架屏
- 搜索：`Input.Search` 回车触发（keyword）+「全部 / 默认 / 自定义」筛选（is_default 参数），变更时回到第 1 页
- 模板卡片：名称（EllipsisText）+ 默认 / 自定义 Tag + 映射数（mappings.length，Badge）+ 关联实例数（instance_count，Badge）
- 分页从简：`pagination` pageSize 50、showSizeChanger=false、total 取后端
- 操作：克隆（clone 后 message 并重载）/ 删除（Modal 二次确认；默认模板按钮置灰 + Tooltip「默认模板禁止删除」）
- 状态：加载骨架屏（Skeleton）/ 空态（Empty「暂无标签模板」+ 新建引导按钮）/ 接口错误（Alert + 重新加载）

## 遇到的问题与解决

- **Tooltip 包禁用 Button 不弹提示（真实 bug）**：antd 禁用按钮 `pointer-events:none` 会吞掉鼠标事件，Tooltip 直接包裹禁用按钮无法触发。按 antd 官方模式在 Tooltip 内再套 `<span>` 修复（浏览器与测试均生效）。
- **`destroyOnClose` 弃用告警**：antd 5.29 已弃用 `destroyOnClose`，改用 `destroyOnHidden` 消除告警。
- **Tooltip 单测事件模拟**：React 合成 `onMouseEnter` 由 `mouseover` 事件触发，测试用 `fireEvent.mouseOver` 而非 `mouseEnter`。

## 验证结果

- `cd ui-custom/web && pnpm lint`：通过（`--max-warnings 0`，无告警）
- `cd ui-custom/web && pnpm test`：label-templates 单测 **12/12 通过**；全量 94/95 通过，剩余 1 个失败为并行 Agent 的 `src/pages/resources/ResourcesPage.test.tsx`「shows permission denied empty state」（T07-05 范围，与本任务无关）
- `cd ui-custom/web && pnpm build`：通过（tsc + vite build 成功产出 dist/）

## 遗留风险 / 待确认

- 右栏模板详情（映射明细 / 关联实例 / 被引用 Job）为 T07-F8 范围，本任务仅占位。
- 新增模板 Drawer 中资源类别默认取当前 Tab 且可改选；若需与「创建后不可修改」契约强一致，可在 F 阶段确认是否锁定 Select。

---

## 任务 T07-F3：资源管理列表页

- 角色：frontend-developer
- 任务 ID：T07-F3（资源管理列表页：五类 Tab + 差异化列 + 筛选 + 分页 + 状态）
- 分支：`feat/module-07-resource-management`
- 日期：2026-08-22

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3.1 / §5.2（列表契约）/ §11.1（页面状态矩阵）/ §11.2（交互契约，网域/业务筛选记忆）
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` 的 T07-F3 及后端契约 T07-05（列表）/ T07-03（host legacy 映射）
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`（复用 FilterBar / tablePresets / EllipsisText，禁止散点 Space wrap）
- 复用模式：`src/pages/domains/useDomains.ts` + `DomainsPage.tsx`（列表抓取 + 状态模式）、`src/components/FilterBar.tsx`、`src/components/tablePresets.ts`

## 改动文件列表

- 新建 `ui-custom/web/src/pages/resources/useResources.ts`（列表数据 Hook）
- 新建 `ui-custom/web/src/pages/resources/ResourcesPage.tsx`（列表页主组件）
- 新建 `ui-custom/web/src/pages/resources/ResourcesPage.test.tsx`（13 个单测）

## 关键实现说明

### 页面（ResourcesPage.tsx）

- 五类资源 Tab（host/database/middleware/application/generic_target），切换后带 `resource_category` 重新请求列表；Tab 文案用 PRD 模块名（主机/数据库/中间件/应用/通用目标）
- 差异化列：host（实例名/主机名、IP、OS、应用/环境/集群）、database/middleware（实例名、类型、IP、端口、版本）、application（服务名、健康检查 URL、协议、端点、端口）、generic_target（目标名、Exporter 类型、IP、端口、采集路径、协议、自定义标签）
- 共享列：网域（默认展示不可隐藏）、业务（展示 biz_name，停用加「（已停用）」）、来源、运行状态（表头 hover 标注数据来源，决策 32）、操作（详情/编辑占位 + 删除 Popconfirm 二次确认，调 DELETE）
- 筛选区复用 FilterBar：网域 / 业务 / 运行状态 / 采集状态（未监控）/ 关键字搜索（回车触发）
- 状态矩阵（§11.1）：加载骨架屏 / 空态「暂无资源」+ 新增/下载模板/Excel 导入引导 / 接口错误 Alert + 重新加载 / 权限不足（403）空态「当前账号无此页面查看权限」
- 分页：默认 50/页（PRD §11.2），total 取服务端全量总数

### 数据 Hook（useResources.ts）

- 网域 / 业务筛选默认记忆上次选择（PRD §5.4 / §11.2）：localStorage 持久化 `network_domain_id` / `biz_code`，进页面默认按上次选择过滤，仍可切「全部网域/全部业务」；损坏数据 / 隐私模式降级为默认（全部）
- 网域 / 关键字 / 未监控走后端（T07-05 支持 network_domain_id / keyword / is_monitored）；业务 / 运行状态后端列表接口未提供，前端在当前页数据上过滤（MVP 分页从简，PRD §11.2，数据量小场景近似可接受）

## 遇到的问题与解决

- **权限不足用例未覆盖（mock 路径错误）**：`ResourcesPage.test.tsx` 中 `vi.mock('../../../api/client')` 相对路径多写了一层 `../`，解析到不存在的 `ui-custom/web/api/client`，导致 mock 从未生效；`useResources` 实际使用真实的 `isApiError`（`instanceof ApiError`），测试侧构造的 `new Error` + `code=403` 无法命中 403 分支。修正为 `vi.mock('../../api/client')` 后用例通过。
- **jsdom 的 localStorage 不真正存储**：无法验证「网域/业务」筛选记忆；以内存 Map 自定义 `window.localStorage` 桩，使记忆持久化在用例内可验证。
- **eslint react-hooks set-state-in-effect**：沿用模块内既有模式，在异步请求回调内 setState，effect 内仅触发 load（加 eslint-disable 注释说明）。

## 验证结果

- `cd ui-custom/web && pnpm lint`：通过（`--max-warnings 0`，无告警）
- `cd ui-custom/web && pnpm test`：**13 个测试文件 / 95 个用例全部通过**（其中 `src/pages/resources/ResourcesPage.test.tsx` 13 个用例）
- `cd ui-custom/web && pnpm build`：通过（tsc + vite build 成功产出 dist/）

## 遗留风险 / 待确认

- 新增 / 编辑（T07-F4）、下载模板 / Excel 导入（T07-F5）、详情抽屉（T07-F6）本任务仅占位，接入见对应任务。
- 运行状态筛选下拉仅含「在线 / 离线 / 维护中」（PRD 状态含 orphan 孤儿，列表页筛选是否提供孤儿选项待确认）。
- 删除被 ScrapeJob 引用资源时后端返回 403 + 引用 Job 名单，提供「查看引用 Job」跳转（§6.6.1）为 TODO，接入见后续任务。

---

## 任务 T07-F5：Excel 导入弹窗 + 导入记录面板

- 角色：frontend-developer
- 任务 ID：T07-F5（Excel 导入弹窗 + 导入记录面板）
- 分支：`feat/module-07-resource-management`
- 日期：2026-08-22

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §5.16（导入流程）/ §6.1（模板与导入接口）/ §6.4（导入记录）/ §11.1（页面状态矩阵）/ §11.2（交互契约）
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` 的 T07-F5 及后端契约 T07-08/10/11/12 的 contract 段
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`（复用 FilterBar / tablePresets / EllipsisText，禁止散点 Space wrap）
- 复用模式：`src/components/FilterBar.tsx`、`src/components/tablePresets.ts`、`src/components/EllipsisText.tsx`、`src/pages/resources/useResources.ts`（抓取 effect 模式）

## 改动文件列表

- 新建 `ui-custom/web/src/pages/resources/ImportModal.tsx`（Excel 导入弹窗）
- 新建 `ui-custom/web/src/pages/resources/ImportRecordsPanel.tsx`（导入记录面板）
- 新建 `ui-custom/web/src/pages/resources/ImportModal.test.tsx`（单测）
- 新建 `ui-custom/web/src/pages/resources/ImportRecordsPanel.test.tsx`（单测）
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.tsx`（接入 T07-F5，替换占位）

## 关键实现说明

### ImportModal.tsx

- 资源类型联动模板下载：`resourceApi.template(category)` 返回 Blob，经 `URL.createObjectURL` + 临时 `<a download>` 触发浏览器下载（`<category>_template.xlsx`），下载中 loading 防重复
- 上传：`Upload`（accept .xlsx/.xls/.csv，maxCount 1，`beforeUpload={() => false}` 不自动上传）；提交时取 `fileList[0].originFileObj`，经 `resourceApi.importExcel(category, file, mode)` 以 FormData 提交
- 模式选择：Radio（默认 `create_only`「仅新增」/ `upsert`「新增或更新」），各带 hint 文案（§5.16.2）
- 结果展示（§5.16.3）：total / success / updated（create_only 显示「-」）/ failed 四统计卡片 + 错误行 Table（行号/字段/值/原因），失败原因透传后端引导文案（未登记网域→M06 网域管理入口、未登记业务→维护业务字典）
- 状态流转：表单态 ↔ 结果态（「再次导入」重置回表单态）；提交 loading 防重复；打开弹窗兜底重置待导入状态

### ImportRecordsPanel.tsx

- 列表：`importApi.list({ resource_category, status, page, page_size: 20 })`，按资源类别 / 状态（成功 / 部分成功）筛选，筛选变更回第 1 页
- 详情：`importApi.get(id)` 拉取含 `errors` 明细的完整记录，Modal 内 Descriptions + 错误行 Table（§5.16.3 同款列）
- 状态矩阵（§11.1）：加载 Skeleton / 空态「暂无导入记录」+「下载模板」/「上传 Excel」引导 / 接口错误 Alert「导入记录加载失败，请稍后重试」+「重新加载」
- 复用 FilterBar / tablePresets（TABLE_PAGINATION / TABLE_SCROLL_X）/ EllipsisText

### ResourcesPage.tsx 接入

- Card extra 四按钮：下载模板 / Excel 导入（均打开 ImportModal，模板下载在弹窗内按当前 Tab 类型）、导入记录（打开导入记录 Modal）、新增资源（T07-F4 Drawer）
- 空态引导三按钮（新增资源 / 下载模板 / Excel 导入）
- `<ImportModal open={importOpen} category={category} onCancel onSuccess={reload} />` 与 `<Modal open={recordsOpen} title="导入记录"><ImportRecordsPanel onDownloadTemplate={openImportModal} onUploadExcel={openImportModal} /></Modal>` 挂载于 MainLayout 内、ResourceFormDrawer 之后

## 遇到的问题与解决

- **ResourcesPage.tsx 的 T07-F5 接入 JSX 缺失**：本次任务开始时发现 imports / state（`Modal`/`ImportModal`/`ImportRecordsPanel`/`importOpen`/`recordsOpen`）已存在但 JSX 未挂载（lint 报 unused），已补回 Modal 挂载块并接通 onSuccess/reload 与空态引导
- **rc-upload 异步处理 beforeUpload**：单测中选择文件后需等待文件名出现在 UI 再点击「开始导入」，否则 `fileList[0].originFileObj` 尚未就绪导致未提交
- **scroll.x 测宽表头重复渲染**：错误行 Table 表头（行号/字段/原因）因测宽表出现两份，断言改用 `getAllByText(...).length > 0`
- **记录行锚点**：导入记录列表不含导入编号列，测试以 `created_at` 时间戳为行锚点定位
- **eslint react-hooks/set-state-in-effect**：打开弹窗重置 / effect 内触发 load 两处沿用模块既有 eslint-disable 注释模式

## 验证结果

- 本任务 5 个文件单独 lint：通过（`--max-warnings 0`，无告警）
- `cd ui-custom/web && pnpm test`：**16 个测试文件 / 123 个用例全部通过**（基线 13 文件 / 95 用例，新增 ImportModal / ImportRecordsPanel 单测，全量不回退）
- `cd ui-custom/web && pnpm build`：通过（tsc + vite build 成功产出 dist/）

## 遗留风险 / 待确认（阻塞项）

- **全量 `pnpm lint` 仍有一个错误**：`src/pages/resources/ResourceFormDrawer.tsx:284` `react-hooks/set-state-in-effect`（`setSubmitError(null)` 位于 useEffect 同步调用，缺 eslint-disable 注释）。该文件属 T07-F4 交付物，本任务明确禁止修改，未越权处理；需路由回 T07-F4 负责人补充 `// eslint-disable-next-line react-hooks/set-state-in-effect`（与本任务 ImportModal/ImportRecordsPanel 同款模式）后全量 lint 即可通过。
- **模板下载 / 导入若后端模板接口错误体非 JSON，将回退 statusText（T07-F1 遗留，联调确认）。

---

## 任务 T07-F8：标签模板页右栏三 Tab + 映射抽屉 + 保存影响反馈

- 角色：frontend-developer
- 任务 ID：T07-F8（标签模板页右栏三 Tab（映射明细 / 关联实例 / 被引用 Job）+ 映射抽屉编辑 + 保存影响反馈）
- 分支：`feat/module-07-resource-management`
- 日期：2026-08-22

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3.2（标签模板）/ §5.11（转换规则）/ §5.12（映射字段来源）/ §6.5 / §9.1 / §11.1 / §11.2（交互契约）
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` 的 T07-F8
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`（复用 FilterBar / tablePresets / EllipsisText，禁止散点 Space wrap）
- 复用模式：`src/pages/resources/ResourcesPage.tsx`（状态矩阵）、`src/components/FilterBar.tsx`、`src/components/tablePresets.ts`、`src/components/EllipsisText.tsx`

## 改动文件列表

- 新建 `ui-custom/web/src/pages/label-templates/labelTemplateConstants.ts`（共享常量：保护 label / 来源类型 / 转换规则 / 资源字段选项等）
- 新建 `ui-custom/web/src/pages/label-templates/MappingDrawer.tsx`（映射新增/编辑抽屉 + 前端预校验）
- 新建 `ui-custom/web/src/pages/label-templates/TemplateDetailTabs.tsx`（右栏三 Tab + 影响反馈 Alert + 抽屉/删除接入）
- 修改 `ui-custom/web/src/pages/label-templates/TemplateList.tsx`（增加 `selectedId` / `onSelect` 选中回调 + 高亮样式，操作按钮 stopPropagation）
- 修改 `ui-custom/web/src/pages/label-templates/LabelTemplatesPage.tsx`（右栏占位替换为 TemplateDetailTabs，选中模板联动 + 映射变更回写）
- 新建 `ui-custom/web/src/pages/label-templates/TemplateDetailTabs.test.tsx`（9 个单测）
- 新建 `ui-custom/web/src/pages/label-templates/MappingDrawer.test.tsx`（6 个单测）
- 新建 `ui-custom/web/src/pages/label-templates/TemplateList.test.tsx`（4 个选中回调单测）

## 关键实现说明

### 共享常量（labelTemplateConstants.ts）

- `PROTECTED_PROMETHEUS_LABELS`（7 项，与后端一致；composite→instance 例外）
- `SOURCE_TYPE_LABEL` / `SOURCE_TYPE_COLOR` / `MAPPING_SOURCE_TYPE_OPTIONS`（MVP 新增仅开放 resource_field，cmdb_field disabled）
- `TRANSFORM_OPTIONS`（无/lower/upper；prefix/replace 置灰 P1）
- `RESOURCE_FIELD_OPTIONS`（五类资源字段来源）、`COMPOSITE_OPTIONS`（instance_ip:port）、`CMDB_FIELD_OPTIONS`、`PROMETHEUS_BUILTIN_OPTIONS`
- `INSTANCE_STATUS_MAP` / `INSTANCE_STATUS_OPTIONS`（关联实例状态筛选）

### TemplateDetailTabs.tsx

- **Tab1 映射明细**：按来源类型分组（composite / resource_field / 其他），每组 Divider + Table（来源字段 / 来源类型 Tag / 目标标签 / 转换规则 / 启用 / 操作）；默认模板只读保护（无操作列，新增映射按钮禁用 + Tooltip）
- **Tab2 关联实例**：`labelTemplateApi.resources` 服务端分页（pageSize=10）+ 关键字搜索 + 状态筛选（MVP 对当前页前端过滤）；Tab 顶部隐式关联说明（§3.2）；空态「该类型下暂无实例」
- **Tab3 被引用 Job**：M01 数据源未实现（`GET /api/v1/scrape-jobs?label_template_id=` 留接口注释），本阶段空态占位 + 完整说明文案
- **保存影响反馈**：`impactVisible` 控制 Alert（被 N 个采集 Job 引用 / MVP 立即生效 / 无版本回滚能力）+「查看引用 Job」按钮跳转 Tab3；映射新增/编辑（MappingDrawer onSaved）与删除（Modal 二次确认）后均展示
- **mapping_id 映射**：后端以 1-based 数组下标为 mapping_id，前端用 `globalIndex + 1` 对齐

### MappingDrawer.tsx

- 保留模板上下文（资源类别字段选项 + 同模板唯一性校验）；新增默认 resource_field / 无转换 / 启用；编辑回填存量映射
- 目标标签默认预填来源字段（resource_field），composite 锁定 instance；来源类型选择切换联动字段选项
- 前端预校验：保护 label 拒绝（composite→instance 例外）、同模板 target_label 唯一（编辑排除自身，editingIndex 为 1-based）；校验错误置于目标标签字段下方
- 保存成功 `labelTemplateApi.addMapping` / `updateMapping` 后由 `onSaved(mappings)` 透传全量映射

### 页面接入（LabelTemplatesPage.tsx）

- `selectedTemplate` 状态：左栏 `onSelect` 选中 → 右栏 `TemplateDetailTabs` 展示详情，`selectedId` 联动左栏高亮
- `handleMappingsChange`：回写选中模板 mappings + `reloadKey` 自增刷新左栏映射数 badge

## 遇到的问题与解决

- **右栏删除按钮定位**：Tab1 分组按 composite 在前、resource_field 在后渲染，`findAllByRole` 首元素是 composite 行（mapping_id 2）；测试改为按行内文本定位 resource_field 行的删除按钮，断言 `removeMapping(1, 1)` 稳定
- **Select 首选项 `findByText` 重复匹配**：antd Select 打开下拉后首选项同时带 `aria-label` 与内容节点，`getByText` 命中两个元素；`selectOption` 改为取 `findAllByText` 最后一个（选项内容）点击
- **Alert 描述跨多节点**：JSX Fragment 中嵌套 `<Text strong>{count}</Text>` 使「被 3 个采集 Job 引用」被拆成多个文本节点，正则无法整段匹配；改对 `.ant-alert-description` 的整段 `textContent` 做 `toContain` 断言

## 验证结果

- `cd ui-custom/web && pnpm lint`：通过（`--max-warnings 0`，无告警）
- `cd ui-custom/web && pnpm test`：**19 个测试文件 / 142 个用例全部通过**（label-templates 31 个：新增 TemplateDetailTabs 9 + MappingDrawer 6 + TemplateList 4 + 既有 LabelTemplatesPage 12；基线 16 文件 / 123 用例，全量不回退）
- `cd ui-custom/web && pnpm build`：通过（tsc + vite build 成功产出 dist/）

## 遗留风险 / 待确认

- **Tab3 被引用 Job 数据源**：M01 未实现（`GET /api/v1/scrape-jobs?label_template_id=`），当前为空态占位 + 说明文案；接 M01 后替换为完整 Table（Job 名 / 网域 / 启用状态 / 变更状态，分页 pageSize=10）。`referencingJobCount` 现由父页面默认传 0。
- **关联实例搜索 / 状态筛选为前端过滤**：MVP 后端 resources 仅支持 page/page_size（§3.2 分页策略），搜索与状态筛选对当前服务端页过滤，数据量大时结果可能不完整；后端支持服务端筛选后可下沉。
- **默认模板只读保护**：映射变更入口已隐藏/禁用，如需「基于默认模板克隆后操作」引导已由 Tooltip 文案覆盖。

---

## 任务 T07-F9：页面挂载与导航入口

- 角色：frontend-developer
- 任务 ID：T07-F9（页面挂载与导航入口：资源管理 + 标签模板页可达）
- 分支：`feat/module-07-resource-management`
- 日期：2026-08-22

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §11 交互契约（页面状态矩阵 + 全局行为规则）；模块名「监控对象管理」（PRD 标题）
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` 的 T07-F9（Phase 5 统一导航前先提供最小可达入口，复用 MainLayout 模块化导航）
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`；角色规范 Step 3.5 第 7 项「导航与模块名核对」（顶部一级 tab 必须用 PRD 模块名，禁止用功能页名）
- 复用模式：M06 的 MainLayout 接入模式（`src/layouts/MainLayout.tsx` MODULES + resolveActiveModule）

## 改动文件列表

- 修改 `ui-custom/web/src/App.tsx`（注册 `/resources`、`/label-templates` 路由）
- 修改 `ui-custom/web/src/layouts/MainLayout.tsx`（MODULES 新增一级模块 + resolveActiveModule 扩展）

> 页面组件 `src/pages/resources/ResourcesPage.tsx`、`src/pages/label-templates/LabelTemplatesPage.tsx` 为已就绪交付物，本任务未改动（禁改目录）。

## 关键实现说明

### App.tsx

- 新增 import：`ResourcesPage` / `LabelTemplatesPage`（两页面均为 `export default`）
- 注册路由：`/resources` → ResourcesPage、`/label-templates` → LabelTemplatesPage；保留首页 `/` 与 `/admin/domains`（M06 网域管理）
- 未引入占位 `ResourcePage.tsx`（该占位文件为遗留，App 不再引用；受「禁止修改 src/pages/resources/」约束不删除）

### MainLayout.tsx

- MODULES 在「系统与平台管理」之后新增一级模块：
  - `monitoring-object` / **「监控对象管理」**（PRD 模块名，禁止用功能页名）
  - 二级子项：资源管理（`/resources`，DatabaseOutlined）、标签模板（`/label-templates`，TagsOutlined）
  - 一级 tab 与「系统与平台管理」并列；「首页」保持 MODULES[0] 第一个 tab
- `resolveActiveModule` 扩展：`/admin/domains` → MODULES[1]；`/resources`、`/label-templates` → MODULES[2]；其余 → 首页（对齐 M06 的 MODULES 索引模式，未引入跨模块职责）
- 模块 JSDoc 注释同步更新（D3 占位说明改为「首页 / 系统与平台管理 / 监控对象管理」三个一级模块）

## 遇到的问题与解决

- **dev server 验证 curl 返回 000**：终端环境存在 `HTTP_PROXY=http://127.0.0.1:7890` 等代理变量，curl 走代理连不上本机端口；改用 `curl --noproxy '*'` 后 `/`、`/resources`、`/label-templates`、`/admin/domains` 均返回 200。
- **占位 ResourcePage 处置**：App 原无 `ResourcePage` 引用（任务卡写「替换既有占位 ResourcePage 引用」，实际占位仅存在于 `src/pages/resources/ResourcePage.tsx` 且未被引用）；因禁改 `src/pages/resources/`，保留该文件不动，App 直接渲染已就绪的 `ResourcesPage`。

## 验证结果

- `cd ui-custom/web && pnpm lint`：通过（`--max-warnings 0`，无告警）
- `cd ui-custom/web && pnpm test`：**19 个测试文件 / 142 个用例全部通过**（与基线 19/142 完全一致，无回退；无 App/MainLayout 相关测试文件）
- `cd ui-custom/web && pnpm build`：通过（tsc + vite build 成功产出 dist/，仅 chunk 体积 >500kB 的常规警告）
- dev server：`vite --host --port 5173` 启动成功；`curl --noproxy '*'` 验证 `/`、`/resources`、`/label-templates`、`/admin/domains` 均 200；验证后已停止服务释放端口

## 遗留风险 / 待确认

- 无阻塞项。后续 Phase 5 统一导航（M05 自定义门户）落地后可收口 MODULES，移除本阶段 D3 占位导航。

---

## 任务 T07-48-B：业务管理页「业务分组字典」CRUD 闭环

- 角色：frontend-developer
- 任务 ID：T07-48-B（决策 48：业务分组字典维护，列表+登记+受限编辑+停用）
- 分支：`feat/module-08-alert-dispatch`
- 日期：2026-09-02
- 后端配合：`45eff29b`（登记 POST /api/v2/platform/business-domains、受限编辑 PUT /:code，字段 code/name/description/enabled）

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §11.1/§11.2（页面状态矩阵 + 交互契约）
- 契约权威：`docs/05-execution-records/module-07/api-contract-snapshot.md`（如存在）；决策 48
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`（复用 FilterBar / tablePresets / EllipsisText，禁止散点 Space wrap）

## 改动文件列表

- 扩展 `ui-custom/web/src/api/resources.ts` 的 `businessDomainApi`：`create`（POST /business-domains {code,name,description}）、`update`（PUT /:code {name,description,enabled}）
- 新建 `ui-custom/web/src/pages/resources/BusinessDomainPage.tsx`（业务分组字典维护页）
- 新建 `ui-custom/web/src/pages/resources/BusinessDomainPage.test.tsx`（156 行单测）
- 挂载 `ui-custom/web/src/layouts/MainLayout.tsx`「监控对象管理」二级导航「业务管理」（/business-domains）
- 路由 `ui-custom/web/src/App.tsx` 注册 `/business-domains`

## 关键实现说明

- 登记表单：code 校验 `^[a-z0-9-]{1,64}`，字段提示「编码创建后不可改」（编辑态 code 只读）；编辑仅开放 name/description/状态
- 不提供删除；`infra` 条目禁用「停用」按钮并提示「infra 为无业务归属设备的兜底分组，不可停用」
- 停用业务列表以「name（已停用）」标识
- 状态矩阵：加载骨架 / 空态「暂无业务分组」+ 登记引导 / 接口错误 Alert
- 交互组件复用 FilterBar / tablePresets / EllipsisText；Form 抽屉 forceRender
- 归属模块 JSDoc：Module_07

## 遇到的问题与解决

- **Drawer 提交按钮定位失败**：antd 动画时序 + 中文按钮自动插空，改用 `findByText(/提\s*交/ / 保\s*存/)` 正则匹配并直接渲染 Drawer 断言。

## 验证结果

- `pnpm vitest run`（BusinessDomainPage）+ `pnpm lint` 通过；dev server 验证 /business-domains 200（`curl --noproxy '*'`）。

## 遗留风险 / 待确认

- 无阻塞项。
