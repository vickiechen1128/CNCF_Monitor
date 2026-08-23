# Module 07 监控对象管理 — 开发侧反馈记录

> 本文记录 M07 开发阶段（feat/module-07-resource-management）发现的 PRD/原型空白、契约缺口与技术决策，
> 供产品/设计侧收割。依据项目约定：开发发现 PRD/原型空白或纯技术优化问题时须在此记录，PR 描述中附本链接。

| 字段 | 值 |
| --- | --- |
| 模块 | Module 07：监控对象管理 |
| 分支 | feat/module-07-resource-management |
| 记录时间 | 2026-08-22（reviewer 双审 + 修复循环后） |
| PRD 版本 | v2.21 |

---

## 1. 需产品/设计确认（PRD 内部矛盾）

### F-1. PRD §5.2 与 §5.16.1 对 application 的 `app_name` 必填口径矛盾

- **矛盾点**：§5.2 将 `app_name` 标为 ✅*（application/database/middleware 必填）；§5.16.1 又明确「`app_name` 可留空（默认取 `service_name`）」。
- **实现取舍**：后端按严格必填口径实现（create/import 的 `validateApplication` 要求 app_name 必填），未实现「空则缺省取 service_name」逻辑；前端 `ResourceFormDrawer` 也未对 application 做差异化必填（五类统一可选）。
- **建议**：产品确认唯一口径后，后端补「缺省取 service_name」或前端按类型加差异化必填，并在 design-decisions.md 记录取舍。

### F-2. PRD §6 与 03_API_Standard / L3 路由前缀不一致

- **矛盾点**：PRD 写 `/api/v1/resources`、`/api/v1/resources/import-templates/{category}`、`/api/v1/resources/import`、`/api/v1/business-domains`；实现按 03_API_Standard §1.2 与 L3 契约使用 `/api/v2/platform/resources`、`/resources/:type/template`、`/resources/:type/import`、`/api/v2/platform/business-domains`。
- **建议**：更新 PRD §6 路由清单为 v2 前缀（或追加 design-decision 说明以 API 标准为准），避免 M01/M09 对接时按 PRD 取路径。

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
| L-2 | `LabelTemplate.description` 静默丢弃 | 模型 TODO 未落库，前端传了无效果无提示；建议落库或从契约移除 |
| L-3 | 并发重复标签竞态 | ✅ 已解决：`ResourceLabel` 已加 `(resource_id, key, source)` 唯一索引（resource_label.go），并发直插兜底；单测 TestResourceLabelUniqueIndex |
| L-4 | `connection_string`/`os_version` 无 API 维护入口 | PRD §5.6/§5.7 契约字段模型存在但 `ResourceInput` 未暴露；MVP 接受，需确认产品口径 |
| L-5 | Host 模型 legacy 字段依赖字段映射 helper 归一化 | ✅ 已由 e2e 冒烟覆盖：`TestEndToEndSmoke` 经真实路由验证 `private_ip`/`image`/`env_flag`/`sub_app_code`/`app_code` → 前端规范字段名闭环 |
| L-6 | 分页默认值两套口径 | 资源/模板 50（T07-03）、导入记录 20（API 标准），前端已按各自契约取值 |
| L-7 | 端到端联调冒烟未做 | ✅ 已补：`TestEndToEndSmoke` 串联资源创建（legacy 归一化）、列表 biz_code/status 筛选、标签模板实例 keyword/status 筛选关键链路 |

## 6. 新增单测

- 后端：
  - `TestImportResource_OversizedFileRejected`（10MB 上限拒绝，R-5）。
  - `TestListResourcesBizCodeStatusFilter`（资源列表 biz_code/status 服务端筛选，K-1）。
  - `TestListTemplateResourcesKeywordStatusFilter`（标签模板实例 keyword/status 筛选，K-2）。
  - `TestCreateLabelTemplateRollbackOnSnapshotFailure`（快照失败回滚模板创建，L-1）。
  - `TestResourceLabelUniqueIndex`（(resource_id,key,source) 唯一索引，L-3）。
  - `TestEndToEndSmoke`（端到端冒烟：legacy 归一化 + 服务端筛选关键链路，L-5/L-7）。
