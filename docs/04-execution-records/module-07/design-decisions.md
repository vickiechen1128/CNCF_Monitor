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
