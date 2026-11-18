# Module 07 字典生命周期与批量改归属实施记录

- 分支：`rewrite/v2.0`
- 日期：2026-11-17
- 设计依据：`docs/05-execution-records/module-07/design-proposals/dictionary-lifecycle-and-correction.md`
- 需求依据：`docs/02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md` v2.0（FR-24 ~ FR-29、NFR-19、NFR-21）

## 1. 实施范围

本轮落地设计提案中的 **P0 + P1**，P2 明确延后（见 §4）。

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0-1 | 删除业务字典预置数据（含 `infra`），空模板导入、缺失/空 YAML no-op | 已完成 |
| P0-2 | 修复「停用字典仍阻断存量引用编辑」问题（只校验变化字段） | 已完成 |
| P0-3 | 修正字典页「删除资源可删字典」的误导文案 | 已完成 |
| P0-4 | 应用抽屉改为单字段「关联平台」+ 星标主平台 | 已完成 |
| P0-5 | 引用数统计、零引用撤销、四态状态统一 | 已完成 |
| P1-1 | 合并 API、事务内引用迁移、审计日志 | 已完成 |
| P1-2 | 三个字典页的合并/撤销 UI、审计抽屉 | 已完成 |
| P1-3 | 资源批量改归属 API + 前端勾选与弹窗 | 已完成 |
| P2 | M08 matcher 影响扫描、存量演示数据清理指引 | 仅文档，未实现 |

## 2. 后端改动

### 2.1 数据与迁移

- `platform/db/seed/business_domain.go`：移除 `infra` 兜底；YAML 缺失或为空时直接 no-op；仅在业务字典表为空时导入，保持幂等。
- `platform/config/business_domains.yaml`：改为空模板，不再预置任何业务编码。
- `platform/models/business_domain.go`：删除 `InfraBizCode` 常量与相关特殊分支。
- `platform/db/migrations/v3/00011_m07_dictionary_lifecycle.{sqlite,postgres}.sql`：
  - `business_domains` / `platform_dicts` / `application_dicts` 增加 `merged_into`、`revoked_at`；
  - 新增 `m07_dictionary_audit_logs`（字典类型、编码、动作、操作人、引用迁移数、时间）。

### 2.2 领域与服务

- 生命周期状态派生：`revoked` 优先，其次 `merged`，否则按既有 `enabled` / `status` 落到 `enabled` / `disabled`；底层旧字段继续作为权威存储，避免破坏既有查询。
- `dictionary/repository.go`：
  - 引用数一次分组统计（排除软删除资源）；
  - 撤销：仅零引用可撤销，写 `revoked_at`；应用撤销同时软删除其有效 `app_platform_rels`；
  - 合并：单事务内把资源引用（含软删除行）迁移到目标编码，并同步刷新 `resources.updated_at`（M09 配置指纹依赖该字段感知变更，确保自动重新生成配置）；源条目写 `merged_into`，写审计日志；
  - 审计日志按字典类型 / 编码分页查询。
- `dictionary/service.go`：
  - `ValidateResourceUpdate`：仅校验本次变化的引用字段（FR-29），停用字典不再是编辑存量资源的无条件拦路石；
  - `ValidateReferenceTarget`、`PlatformBelongsToApp` 供批量改归属复用。
- `service/resource_service.go` + `repository/resource_repository.go`：
  - `BulkReassign`：字段限 `biz_code` / `app_code` / `platform_code`，单请求最多 200 条，目标必须启用；
  - 全量预校验后单事务更新，任一失败整体回滚；
  - 组成型资源（应用服务 / 接口服务）禁止直接改 `platform_code`；
  - 改 `app_code` 时，组成型资源的平台跟随目标应用主平台派生；静态资源保留显式平台，但该平台必须已关联目标应用；
  - 改 `platform_code` 时，静态资源若已有应用归属，目标平台必须已关联该应用（与 FR-29 常规编辑校验同一不变量，防止批量入口绕过）。
- HTTP：
  - `POST /api/v3/platform/resources/bulk-reassign`；
  - 失败返回 `400` + `data.failures[]`（`resource_id` / `reason`）；
  - 路由注册在 `/:resource_id` 之前，避免被通配吞掉。

### 2.3 兼容性

- 旧 v2 字典路由仍保留，但**不提供**生命周期能力；撤销/合并/审计只在 v3 暴露。
- 编码一经引用不物理删除、不复用；撤销是终态，历史 TSDB 不追溯改写。

## 3. 前端改动

- 类型与 API：`DictionaryStatus` 四态、`reference_count` / `merged_into` / `revoked_at`；`resourceApi.bulkReassign`。
- 共享生命周期模块：
  - `dictionaryLifecycle.ts`：四态文案、徽标色、终态判定、名称后缀；
  - `DictionaryLifecycleActions.tsx`：撤销按钮、合并弹窗、审计抽屉；
  - `DictLifecycleNotice.tsx`：字典页生命周期说明，替换误导性「删除」文案。
- 三个字典页（业务 / 应用 / 平台）：
  - 默认展示「有效条目」（启用 + 停用），可切「全部」查看已合并 / 已撤销；
  - 展示引用数；零引用才可撤销；终态行禁用编辑 / 启停 / 合并；
  - 合并弹窗展示影响预览与「TSDB 历史不重写」提示。
- 应用抽屉：只暴露一个「关联平台」多选框；星标切换主平台；仅一个平台时自动为主平台；停用平台不能新选为主平台。
- 资源表单：
  - 业务归属改为按类型分化：主机 / 数据库 / 中间件 / 应用服务可留空后补，仅接口服务必填，其他监控对象维持「应用或业务二选一」；
  - 业务下拉可清空，空值展示「未归属业务（可留空）」；表单内提供「登记业务」快捷入口，登记成功后自动回填并刷新下拉；
  - 新增「登记业务」复用的 `BusinessDomainDrawer`，从业务字典页抽出，避免两处维护同一套编码校验与提交语义。
- 资源列表：
  - 表格增加勾选列，选中后出现「已选 N 条 / 批量改归属 / 取消选择」工具条；
  - `BulkReassignModal` 只列启用目标，组成型资源禁用平台字段并提示派生规则；
  - 失败时逐条渲染 `data.failures`，整批未修改，不触发成功回调；
  - 成功后关闭弹窗、清空勾选并刷新列表。

## 4. P2 延后范围（本轮未实现）

### 4.1 M08 matcher 影响扫描

**目标**：在停用 / 合并业务、应用、平台前，提示受影响的告警规则与静默数量，避免改完字典才发现告警失配。

**建议实现**（后续排期）：

1. 在后端新增只读扫描服务，读取 M08 告警规则 matcher 与静默 matcher；
2. 按字典类型映射待查标签（业务 → `biz`、应用 → `app`、平台 → `platform`），并对等值 matcher 精确匹配；
3. 正则 / 非等值 matcher 采用保守口径，只标记「可能受影响」，不阻断操作；
4. 返回 `{ rule_count, silence_count, samples[] }`，接入合并 / 停用确认弹窗；
5. 标签键可能被标签模板改写，需先读取模板映射，不能硬编码三组标签名。

**边界**：影响扫描是提示能力，不改变「零引用可撤销、有引用只能停用/合并」的既有约束。

### 4.2 已有环境演示数据清理指引

本轮只提供指引，**不自动执行**任何清理。已有环境可能残留旧版预置的 `infra` 或演示业务 / 应用 / 平台条目，处理原则：

1. **先盘点**：通过三个字典页「全部」视图查看条目与引用数；引用数为 0 的才是可撤销候选。
2. **有引用的演示条目**：
   - 若存在真实归属，使用「合并」把引用迁移到真实编码（单事务，历史数据不改写）；
   - 若暂不确定归属，先「停用」，保留存量引用，禁止新增引用。
3. **零引用的演示条目**：使用「撤销」进入终态；编码永久保留、不可重新登记。
4. **`infra` 特例已取消**：不再有「禁止停用」保护。按上述普通条目处理即可；有引用时不能直接撤销。
5. **禁止**直接 SQL 物理删除字典行：会绕过引用迁移、审计与终态约束，并可能留下悬空 `biz_code` / `app_code` / `platform_code`。
6. 清理完成后，用资源列表「全部」视图确认没有资源仍指向已撤销编码；已合并条目展示 `已合并 → 目标编码`，属于预期别名。

## 5. 验证结果

| 检查 | 命令 | 结果 |
|------|------|------|
| 后端全量测试 | `.tools/go/bin/go test ./platform/...` | 通过 |
| 前端资源模块测试 | `pnpm vitest run src/pages/resources` | 13 个文件 / 259 个用例通过 |
| 测试类型门禁 | `pnpm run typecheck:test` | 通过 |
| ESLint | `pnpm lint` | 通过（0 error / 0 warning） |
| 应用类型检查 | `pnpm exec tsc --noEmit` | 通过 |

补充：本轮同时修正了资源页既有测试夹具与「云归属由所属网域派生」口径不一致的问题（云列、云卡下钻用例改为 mock 网域 `cloud_code`），以及标签模板 ID 断言（`lt-5`）与行勾选列带来的单元格/表头偏移。

## 6. 未提交状态

本轮及同分支既有改动均**未提交**。M07 相关未跟踪文件包括：

- `platform/db/migrations/v3/00011_m07_dictionary_lifecycle.{sqlite,postgres}.sql`
- `ui-custom/web/src/pages/resources/BulkReassignModal.{tsx,test.tsx}`
- `ui-custom/web/src/pages/resources/DictionaryLifecycleActions.tsx`
- `ui-custom/web/src/pages/resources/dictionaryLifecycle.ts`
- 本设计提案与实施记录

其余大量 M09 / 文档改动为本分支既有工作，未在本轮改动范围内。
