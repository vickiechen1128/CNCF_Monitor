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

---

## 任务 T07-97-F1：Excel 导入声明 sheet 引导 + 待登记清单错误指引

- 角色：frontend-developer
- 任务 ID：T07-97-F1（决策 97 Excel 声明导入前端支撑）
- 分支：`feat/module-07-resource-management`
- 日期：2026-09-19

## 输入文档

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §5.16.1 / §5.16.2 / §11（决策 97：资源导入文件内联「业务声明」/「应用声明」sheet，一次导入声明全新业务/应用）
- 决策：`docs/05-execution-records/module-07/design-decisions.md` 决策 97
- 契约：`docs/05-execution-records/module-07/api-contract-snapshot.md`（ImportResult.errors[].reason 为待登记清单引导文案）
- 任务卡权威：`docs/05-execution-records/module-07/task-sequence.yaml` T07-97-F1

## 改动文件列表

- 修改 `ui-custom/web/src/pages/resources/ImportModal.tsx`
- 修改 `ui-custom/web/src/pages/resources/ImportModal.test.tsx`（增补 2 个用例）

## 关键实现说明

- **模板下载提示补充**：「1. 下载模板」区新增一行说明——「资源导入文件可内含『业务声明』/『应用声明』sheet，一次导入即可声明全新业务/应用（决策 97）」（文案与 PRD §5.16.1 / 决策 97 原文一致）。
- **待登记清单错误指引**：新增 `isPendingRegistrationReason(reason)` 判定——reason 含「未登记」且指向业务/应用（`/业务|应用/`；网域未登记文案不含业务/应用字样，不命中）。命中时原因列渲染 `WarningOutlined` 图标 + `EllipsisText type="warning"` 高亮；可执行指引文案由后端 reason 透传（「请到『业务管理』/『应用管理』页登记，或在文件声明 sheet 补充后重新导入」），前后端一致。
- 错误行表格保留行号/字段/值/原因四列；未新建可视化声明编辑（clipping：声明内容在 xlsx 内由后端解析，前端仅引导与错误指引）。

## 遇到的问题与解决

- 无阻塞项。

## 验证结果

- `pnpm vitest run src/pages/resources/ImportModal.test.tsx`：11 个用例全绿（含新增 2 个）
- `pnpm lint`（--max-warnings 0）：通过
- `pnpm test` 全量：3 个文件 28 个用例失败为基线既有问题（MainLayout / AppearanceSettingsPage / productNamePreference，与本次改动无关，stash 前后对比确认一致）

## 遗留风险 / 待确认

- 待登记清单命中依赖后端 reason 文案含「未登记」+ 业务/应用字样；若后端文案变更（如去掉「未登记」关键词），需同步调整 `isPendingRegistrationReason` 判定。

---

## 任务 T07-F3-应用列：资源列表五类 Tab 补「应用」列（决策 92/96 正交两维缺口修复）

- 角色：frontend-developer
- 任务 ID：T07-F3（增量修复，Track A 原型同步缺口）
- 分支：`feat/module-07-resource-management`
- 日期：2026-09-19
- Commit：`27592bf`

## 输入文档

- 契约：`docs/05-execution-records/module-07/api-contract-snapshot.md` §5A（应用字典 API）/ §11（`app_code` UI 展示名）/ §9（`app_code` 规范）
- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §5.19（应用字典）/ §11.2（业务 / 应用列展示，决策 93/95/96）/ Change Log v2.40~v2.41（决策 92~97）
- 原型基底：`docs/prototypes/module-07/src/pages/ResourcesPage.tsx` L1299~1326（businessColumn / appColumn）/ L1734~1780（FilterBar，确认**无「全部应用」筛选**）
- 映射表：`docs/05-execution-records/module-07/frontend-prototype-map.md` §3.1（第 16 项业务列 ✅；应用列缺失——本任务补上，映射表 3.1 需后续追加「应用」列条目）
- 任务边界：`docs/05-execution-records/module-07/task-sequence.yaml` delta_v241（前端原型已同步决策 92~96，资源页 app 列）

## 改动文件列表

- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.tsx`
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.test.tsx`（增补 5 个用例）

## 关键实现说明

- **应用字典 state + 加载**：新增 `applicationDomains` state，与网域 / 业务字典同批 `Promise.all` 加载 `applicationDictApi.list()`（`GET /api/v2/platform/application-dict`），catch 静默——字典加载失败不阻塞列表（与业务字典同一降级口径）。
- **辅助函数**：`resolveAppName(code)`——命中字典返回 `app_name`、缺条目回退 `app_code`、空值 `-`；`isAppDisabled(code)`——`status === 'disabled'`（与 `resolveBizName` / `isBizDisabled` 同构）。
- **appColumn**：`title='应用'`、`dataIndex='app_code'`、`key='app_code'`、`width=150`；有值渲染 Tag（停用 `default` / 启用 `cyan`）+ `resolveAppName` + 停用追加「（已停用）」，空值渲染 `-`——逐字对齐原型 appColumn（L1313~1326）。
- **五类 Tab 共享**：host / database / middleware / application / generic_target 五个列集合统一在 `businessColumn` 后插入 `appColumn`（对齐原型列序 1447/1471/1494/1522/1545）；共享列注释同步补「应用」。
- **筛选区核对结论**：原型 FilterBar（L1734~1780）仅含网域 / 业务 / 采集状态 / 搜索，**无「全部应用」筛选**——生产不新增筛选器（与任务卡核对项一致）。
- **类型与 API 复用**：`ResourceListItem.app_code?: string` 与 `applicationDictApi` 均已存在，本次零新增类型 / API 文件。

## 遇到的问题与解决

- **契约快照内部小差异（已按 PRD 裁决，非阻塞）**：快照 §5A 应用字典条目字段写 `enabled`，而 PRD §5.19 字段表与既有 `types/resource.ts` `ApplicationDict` 均为 `status: 'enabled' | 'disabled'`。按 frontend-developer.md「契约快照内部矛盾时以 PRD 第 5/6 章为最高权威」——采用 `status` 字段（与生产 ApplicationDictPage 一致），仅在前端类型 / 解析处消费，未改契约快照（planner 后续重派生快照时建议对齐 §5A 字段为 `status`）。
- **host Tab 组合列并存**：host Tab 既有「应用 / 环境 / 集群」组合列（渲染 app_code 原始 Tag，原型下沉详情、生产保留为列表列）。本任务为最小补丁，仅新增独立「应用」列（PRD §11.2 host 显「应用」列），未删组合列；该差异已在原型映射表 §3.1 之外记录，供后续迭代评估是否将组合列下沉详情。

## 验证结果

- `pnpm vitest run src/pages/resources/ResourcesPage.test.tsx`：**27 用例全绿**（新增 5 个：app_name 渲染 / 停用「（已停用）」/ 缺条目回退 app_code / 空值 `-` / 五类 Tab 列序断言）
- `pnpm lint`（--max-warnings 0）：通过
- dev server：`vite --host` 启动，`/` 与 `/resources` 均返回 200；验证后已停止服务释放端口（5173）

## 遗留风险 / 待确认

- 应用列依赖 `GET /application-dict` 成功加载；接口失败时应用列回退展示 `app_code`（resolveAppName 缺条目回退逻辑天然兜底），不阻塞列表。
- `frontend-prototype-map.md` §3.1 共享列定义（「网域 / 业务 / 来源 / 运行状态 / 操作」）待补「应用」列条目（本任务遵循最小补丁未改映射表，建议下次映射表更新时同步）。

---

## 任务 F-4/F-5：拆分「下载模板」与「Excel 导入」动线 + ImportModal 结构化引导

- 角色：frontend-developer
- 任务 ID：F-4 / F-5（用户拍板，dev-feedback.md §1 记录）
- 分支：`feat/module-07-resource-management`
- 日期：2026-09-19
- Commit：`f883755`

## 输入文档

- 反馈单：`docs/05-execution-records/module-07/dev-feedback.md` §1（F-4 现状/痛点/用户拍板；F-5 灰色释义无引导）
- 原型基底：`docs/prototypes/module-07/src/pages/ResourcesPage.tsx` L2210~2242（独立「下载模板」Modal：固定列清单表格 + 取值说明 + sheet 说明）；`docs/prototypes/module-07/src/mocks/module-07.ts` L636~642（`IMPORT_TEMPLATE_COLUMNS` 五类列名）
- 契约：`docs/05-execution-records/module-07/api-contract-snapshot.md` §6.1（`GET /resources/:type/template` 二进制下载）；PRD `Module_07_Monitoring_Object_Management.md` §5.16.1/§6.1（固定列模板、业务/应用声明 sheet，决策 97）
- 后端列名核对：`platform/config/resource/template.go` `TemplateColumns`（只读核对，确认与原型常量逐字一致）

## 改动文件列表

- 新增 `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx`
- 新增 `ui-custom/web/src/utils/triggerBlobDownload.ts`（自 ImportModal 提取，两组件共享）
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.tsx`（工具栏/空态「下载模板」→ `openTemplateModal`；渲染 TemplateDownloadModal）
- 修改 `ui-custom/web/src/pages/resources/ImportModal.tsx`（F-5 结构化引导；删除内部 triggerBlobDownload 改引用共享工具）
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.test.tsx`（新增 4 个 F-4 用例）
- 修改 `docs/04-source-architecture/repo-map.md`（`make repo-map` 生成，pre-commit 强制）

## 关键实现说明

- **F-4 动线拆分**：工具栏与空态「下载模板」改调 `openTemplateModal`（新增 `templateOpen` state），打开独立 `TemplateDownloadModal`；「Excel 导入」保持 `openImportModal` 打开 ImportModal（专注上传 + 模式 + 结果）；两条动线互不打开对方弹窗（测试断言互斥）。
- **TemplateDownloadModal**：标题「下载模板 - {类别}」；顶部 `Alert type="warning"` 模板演进提示（「模板会随版本更新——请下载最新模板，旧模板可能缺列导致导入报错」）；固定列清单 Table（列顺序/列名，`IMPORT_TEMPLATE_COLUMNS[category]` 渲染 Text code）；取值说明（custom_labels 格式 / status 中文值 / biz_code 必填 / app_code 应用字典条目）；「业务声明」/「应用声明」sheet 说明（决策 97）；footer「下载模板」按钮触发 `resourceApi.template(category)` + `triggerBlobDownload(blob, \`${category}_template.xlsx\`)`。
- **IMPORT_TEMPLATE_COLUMNS 常量**：按 ResourceCategory 映射五类列名数组，与后端 `template.go` `TemplateColumns` 及原型常量逐字一致（host 11 列 / database 11 列 / middleware 11 列 / application 12 列 / generic_target 14 列）。
- **F-5 结构化引导**：ImportModal「1. 下载模板」区关键句 `<Text strong>请下载最新模板，按固定列填写后上传</Text>` 前置 + 次要说明保留 secondary 小字；「2. 上传文件」区 `<Text strong>仅支持 .xlsx 文件，每次选择一个文件</Text>` + secondary 小字说明；业务/应用声明 sheet 说明原句保留（决策 97）。
- **triggerBlobDownload 下沉**：提取至 `src/utils/triggerBlobDownload.ts`，TemplateDownloadModal 与 ImportModal 共用，消除双处实现漂移（dev-feedback K-3 同类问题的模板下载点收敛）。

## 遇到的问题与解决

- **pre-commit 拦截 repo-map 过期**：新增 TS 文件触发 `make check-repo-map` 失败——运行 `make repo-map` 重新生成后随 commit 一并提交（项目流程强制，非异常）。
- **ImportModal.test.tsx 零改动**：F-5 重构保留「资源导入文件可内含「业务声明」/「应用声明」sheet，一次导入即可声明全新业务/应用（决策 97）」原句与「下载模板」按钮，既有断言语义等价全绿，无需同步更新。

## 验证结果

- `pnpm vitest run src/pages/resources/ResourcesPage.test.tsx src/pages/resources/ImportModal.test.tsx`：**42 用例全绿**（ResourcesPage 新增 4 个 F-4 用例：工具栏打开模板 Modal / Modal 内下载触发 resourceApi.template / 空态打开模板 Modal / Excel 导入打开导入弹窗且互斥）
- `pnpm lint`（--max-warnings 0）：通过
- dev server：`vite --host` 启动，`/` 与 `/resources` 均返回 200；验证后已停止服务释放端口（5173）

## 遗留风险 / 待确认

- 模板列清单为前端常量表（后端无列元数据接口）；若后端 `TemplateColumns` 后续增删列，需同步本常量（建议 v0.2+ 后端暴露列元数据接口消除双处漂移）。

---

## 任务 F-6：host Tab 拆分「应用 / 环境 / 集群」组合列

- 角色：frontend-developer
- 任务 ID：F-6（用户拍板，dev-feedback.md §1 记录）
- 分支：`feat/module-07-resource-management`
- 日期：2026-09-19
- Commit：`31d0192`
- 前置：F-4/F-5 commit `f883755`

## 输入文档

- 反馈单：`docs/05-execution-records/module-07/dev-feedback.md` §1（F-6：host 组合列与独立「应用」列重复展示 app_code）
- 原型基底：`docs/prototypes/module-07/src/pages/ResourcesPage.tsx` L1934~1935（详情 Drawer 环境/集群项）
- PRD：`Module_07_Monitoring_Object_Management.md` §11.2（业务 / 应用列展示，决策 92/96）

## 改动文件列表

- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.tsx`（host 列集合：删组合列，增独立「环境」「集群」列）
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.test.tsx`（新增 2 个 F-6 用例 + 修正旧注释）
- 修改 `docs/04-source-architecture/repo-map.md`（`make repo-map` 生成）

## 关键实现说明

- 删除 host 分支 `app_env_cluster` 组合列（原渲染 app_code + env + cluster 三个 Tag，其中 app_code 与共享 `appColumn` 重复）。
- 新增独立「环境」列（`dataIndex='env'`，有值 `<Tag color="blue">`，空值 `-`）与「集群」列（`dataIndex='cluster'`，有值 `<Tag color="purple">`，空值 `-`），位置在原组合列处（操作系统之后、网域之前，与共享列 appColumn 邻近）；Tag 色沿用组合列口径。
- `ResourceListItem` 已有 `env?` / `cluster?` 字段，零类型改动。
- **其他 Tab 排查**：database / middleware / application / generic_target 四类均无组合列，仅共享 `appColumn`，无同类重复问题，保持最小补丁未动。

## 遇到的问题与解决

- 旧测试「决策 92/96：字典缺条目回退显示 app_code」注释引用组合列渲染 app_code Tag——组合列删除后注释失实，同步修正注释（断言 `>= 1` 仍成立：应用列唯一承载回退值）。

## 验证结果

- `pnpm vitest run src/pages/resources/`：**7 文件 96 用例全绿**（新增 2 个 F-6 用例：组合列头移除 + 环境/集群独立列渲染 / 空值 `-`）
- `pnpm lint`（--max-warnings 0）：通过
- dev server：`vite --host` 启动，`/` 与 `/resources` 均返回 200；验证后已停止服务释放端口（5173）

## 遗留风险 / 待确认

- host Tab 列数由 11 增至 12（环境/集群独立成列），与原型 v2.32「8 列收敛、环境/集群下沉详情」方向相反——本任务按用户拍板（F-6）执行；若后续列表列数治理要求收敛，可在映射表记录评估下沉。

---

## 任务 F-7：模板弹窗展示当前业务/应用可选值 + 用户语言重写 + 下载文件名带日期

- 角色：frontend-developer
- 任务 ID：F-7 ②③④⑤ 前端部分（用户拍板治本方案，dev-feedback.md §1 记录；commit 95d5b74 落档）
- 分支：`feat/module-07-resource-management`
- 日期：2026-09-19
- Commit：`040414d`
- 前置：F-4/F-5 commit `f883755`（仅换皮被否）、F-6 commit `31d0192`；后端并行 agent 在改 `platform/config/resource/template.go`（① app_code 实时字典注入），前端不依赖其产物、未触碰 platform/

## 输入文档

- 反馈单：`docs/05-execution-records/module-07/dev-feedback.md` §1（F-7 根因：前端展示技术列名而非合法值、文案设计黑话、模板缺 app_code 实时字典；②直显 ③用户语言 ④兜底 ⑤日期文件名）
- 前端类型：`ui-custom/web/src/types/resource.ts`（`BusinessDomain {code,name,enabled}` / `ApplicationDict {app_code,app_name,status}`，与 ResourcesPage state 同型）

## 改动文件列表

- 重写 `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx`（用户语言三问 + 字典可选值直显 + 日期文件名；删除技术列名表与黑话）
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.tsx`（模板弹窗传入 `businessDomains` / `applicationDomains`）
- 修改 `ui-custom/web/src/pages/resources/ImportModal.tsx`（「1. 下载模板」区补旧模板提示句，F-7-④）
- 新增 `ui-custom/web/src/pages/resources/TemplateDownloadModal.test.tsx`（7 用例）
- 修改 `ui-custom/web/src/pages/resources/ResourcesPage.test.tsx`（F-4 用例同步为 F-4/F-7 用户语言断言 + 新增 F-7-② 字典直显用例）
- repo-map 未变更（仅改组件内部逻辑与测试，不涉导出符号，`make check-repo-map` 通过）

## 关键实现说明

- **② 当前可选值直显**：组件新增 props `businessDomains?` / `applicationDomains?`（缺省 `[]`，防御 ResourcesPage 字典加载失败时的 undefined）；启用条目过滤口径与列表页一致——业务 `enabled === true`、应用 `status === 'enabled'`；渲染「当前业务」「当前应用」双面板（Tag 编码 + 名称，色对齐列表页 geekblue / cyan），可滚动小区域（maxHeight 130 + overflowY auto）+ 名称省略展示（ellipsis + title），保持 560 宽度可读。
- **③ 用户语言三问**：①这模板怎么填——按类别「填写要点」短列表（主机名 / IP 地址 / 端口…）+ 网域留空自动归属 + 状态中文取值；②每列能填什么值——字典可选值直显，空则「暂无已登记业务/应用」+ 声明表引导（「也可在导入文件里附『业务声明/应用声明』表，一次导入直接声明新业务/应用」，用户语言无「决策 97」字样）；③为什么必须下最新——warning Alert 保留，文案改「模板会随版本更新——旧模板可能缺列或缺最新字典值，导致导入报错——请下载最新模板后填写」。
- **黑话清理**：删除技术列名表 `IMPORT_TEMPLATE_COLUMNS` 及「固定列模板」「取值说明 sheet」「决策 97」字样，技术列名（os_type / biz_code / instance_ip…）不再作为可见文案。
- **⑤ 下载文件名带日期**：`${category}_template_${YYYYMMDD}.xlsx`（`todayStamp()`，如 host_template_20260919.xlsx）。
- **④ ImportModal 提示句**：「1. 下载模板」区 `Text strong` 关键句保留，其后的次要说明改为「——若你正在使用旧模板，可能缺少最新字段或字典值，请下载最新模板后填写。」；既有测试无该句精确断言，ImportModal.test.tsx 零改动。

## 遇到的问题与解决

- **ResourcesPage F-4 用例断言技术列名表**（`列顺序` / `network_domain` 等）：删除列表后断言失效，同步改写为 F-4/F-7 用户语言断言（三问标题 + 空字典占位 + 黑话/技术列名 `queryBy*` 为 null）。
- **repo-map 新鲜度**：仅改组件内部逻辑（导出符号未变）且测试文件不入图，`make check-repo-map` 直接通过，无需重新生成（避免卷入并行后端 agent 的 platform 变更）。

## 验证结果

- `pnpm vitest run src/pages/resources/`：**8 文件 104 用例全绿**（新增 TemplateDownloadModal.test.tsx 7 用例：用户语言三问无黑话 / 用户语汇填写要点 / 字典启用条目直显停用隐藏 / 空字典占位 + 声明表引导 / undefined 防御 / 日期文件名（host、application 两类别）；ResourcesPage 新增 F-7-② 字典直显用例）
- `pnpm lint`（--max-warnings 0）：通过
- `pnpm exec tsc --noEmit`：通过
- dev server：`vite --host` 启动，`/` 与 `/resources` 均返回 200；验证后已停止服务释放端口（5173）

## 遗留风险 / 待确认

- ~~模板弹窗「当前可选值」依赖 ResourcesPage 首屏已加载的字典 state（page_size 100）~~ **已核验为非问题（2026-09-19 Orchestrator）**：业务/应用字典接口均为**全量非分页**——前端 `businessDomainApi.list()` / `applicationDictApi.list()` 不带 page_size、`setBusinessDomains/ApplicationDomains` 无切片；后端 `ListBusinessDomains`（business.go L143）与 `ListApplicationDicts`（application_dict.go L174）均 `store.List()` 全量返回（`total=len(list)`）。模板弹窗直显与列表页解析拿到同一份全量字典，不存在 100 条窗口截断。`page_size:100` 仅作用于 `networkDomainApi.list`（网域，L229），网域不参与弹窗直显。弹窗 `enabledBusinesses/enabledApps` 仅做启用过滤、无 slice。**残余确认项**：模板 xlsx「取值说明」的 app_code 行由后端 `ApplicationDictStore.EnabledList`（全量）生成，与弹窗直显启用口径一致，联调时抽查核对即可。


