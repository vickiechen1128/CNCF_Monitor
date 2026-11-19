# M07 CI 模型配置实现记录（SRS v2.2 FR-30~FR-34）

- 日期：2026-11-19
- 角色：backend-developer + frontend-developer（单会话连续实施）
- 输入：`docs/02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md` v2.2
  §3.5 / §5.8 FR-30~FR-34 / §6 NFR-23~26 / §7 / §8.7 / §9
- 分支：`rewrite/v2.0`
- 关键路径：P1 模型与迁移 → P2 服务与 API → P3 测试 → P4/P5 前端类型与 schema → P6 页面 → P7 详情 → P8 下线旧入口 → P9 验证

## 1. 提交清单

| commit | 范围 | 说明 |
| --- | --- | --- |
| `06ee7a5` | `docs/` | SRS v2.2 落档 CI 模型配置（FR-30~FR-34、NFR-23~26） |
| `09dcf63` | `platform/db/` | schema：`status` / `display_group` / `display_order` 三列 + `enabled=false → removed` 迁移；sqlite/postgres 双份 |
| `821c4fc` | `platform/modules/m07/` | 后端：CI 模型聚合 API、移除判定、同名恢复、内置字段 schema |
| （本次） | `ui-custom/web/` | 前端：CI 模型配置页、字段 schema、表单/详情适配、旧入口下线 |

## 2. 后端实现

### 2.1 数据模型

- `m07_attribute_definitions` 新增：
  - `status`（`active` / `removed`）：在模型中 / 已移出；
  - `display_group`：固定分组枚举（identity / ownership / runtime / collection / capability / profile）；
  - `display_order`：组内排序。
- `enabled` 列保留、不再写入，读取以 `status` 为准（`AttributeDefinition.EffectiveStatus()` 兜底历史行）。
- 不引入「停用」状态：SRS v2.2 明确自定义字段只有「在模型中 / 已移出」。

### 2.2 服务与接口

| 接口 | 行为 |
| --- | --- |
| `GET /api/v3/platform/ci-models` | 六类 CI 模型总览：内置字段（只读、含分组与排序）+ 在模型中的自定义字段 + 可选分组枚举 |
| `GET /api/v3/platform/ci-models/:category` | 单类模型；未知类别返回 400 |
| `GET /api/v3/platform/attribute-definitions?resource_category=&status=` | 自定义字段列表，支持状态过滤 |
| `POST /api/v3/platform/attribute-definitions` | 登记字段；同 key 命中「已移出」时自动恢复并更新元数据，不新建 |
| `PUT /api/v3/platform/attribute-definitions/:id` | 编辑展示名 / 值类型 / 分组 / 排序 / 必填 / 描述；key、类别、状态不可改 |
| `DELETE /api/v3/platform/attribute-definitions/:id` | 移除：引用数为 0 → 删除（`mode=deleted`）；>0 → 移出模型（`mode=removed`，值保留） |

- 内置字段 schema 落在 [`platform/modules/m07/domain/builtin_fields.go`](../../../platform/modules/m07/domain/builtin_fields.go)：
  六类 × 六组的字段清单、分组、顺序、必填与值类型；不落库。
- `ReplaceResourceAttributes` 与 Excel 导入均校验 `status=active`，已移出字段拒绝填值。

## 3. 前端实现

| 文件 | 变更 |
| --- | --- |
| [`resourceFieldSchema.ts`](../../../ui-custom/web/src/pages/resources/resourceFieldSchema.ts) | 新增：六类内置字段的 key / 分组 / 顺序 / 必填单一来源 |
| [`CIModelPage.tsx`](../../../ui-custom/web/src/pages/resources/CIModelPage.tsx) | 新增：左侧六类 CI、右侧内置字段只读 + 自定义字段增删改 + 「已移出」视图 |
| [`types/attribute.ts`](../../../ui-custom/web/src/types/attribute.ts) | 新增 `AttributeStatus` / `AttributeGroup` / `BuiltinField` / `CIModel` / `RemoveDefinitionResult` |
| [`api/attributes.ts`](../../../ui-custom/web/src/api/attributes.ts) | 新增 `ciModelApi`；`attributeDefinitionApi.list` 支持 status；`remove` 返回移除结果 |
| [`resourceFormFields.tsx`](../../../ui-custom/web/src/pages/resources/resourceFormFields.tsx) | 自定义字段按固定分组 + 组内排序渲染，带分组标题 |
| [`ResourceFormDrawer.tsx`](../../../ui-custom/web/src/pages/resources/ResourceFormDrawer.tsx) | 只加载在模型中的字段；已移出字段的已有值原样保留（复用既有 `existingAttributeValues` 保护） |
| [`ResourceDetailDrawer.tsx`](../../../ui-custom/web/src/pages/resources/ResourceDetailDrawer.tsx) | 自定义字段按展示名呈现；已移出字段进「历史字段（已移出模型）」区只读展示 |
| [`ResourceAttributesDrawer.tsx`](../../../ui-custom/web/src/pages/resources/ResourceAttributesDrawer.tsx) | 只渲染在模型中的字段；空态与文案指向 CI 模型配置 |
| [`ResourcesPage.tsx`](../../../ui-custom/web/src/pages/resources/ResourcesPage.tsx) | 下线「扩展属性字典」按钮与抽屉挂载 |
| [`App.tsx`](../../../ui-custom/web/src/App.tsx) / [`MainLayout.tsx`](../../../ui-custom/web/src/layouts/MainLayout.tsx) | 新增 `/ci-models` 路由与菜单项 |

删除：`src/pages/resources/AttributeDefinitionsDrawer.tsx`。

## 4. 实现期决策

1. **`enabled` 兼容**：迁移后不再写 `enabled`，读取统一走 `status`；避免 SQLite 删列风险与旧数据兼容问题。
2. **内置字段双份定义**：后端 `builtin_fields.go` 供 API / M01 读取，前端 `resourceFieldSchema.ts` 供表单分组与测试守护；两边 key 集合由前端 schema 测试 + 后端 handler 测试分别锁定。
3. **表单分组范围**：SRS FR-33 只要求自定义字段按分组渲染，内置字段保持既有表单顺序，避免大范围表单重排引发回归；模型页内置字段完整分组展示。
4. **移除单入口**：用户只点「移除」，由后端按引用数判定删除或移出，前端按返回 `mode` 提示。

## 5. 遇到的问题与解决

| 问题 | 解决 |
| --- | --- |
| GORM map-based `Update` 绕过 `serializer:json`，`enum_options` 写入 NULL 触发 NOT NULL | Update 显式 `json.Marshal` 后写字符串 |
| 新增 0022 迁移后，迁移测试对「最后一个迁移」的回滚顺序假设失效 | 测试改为先回滚 0022 再回滚 0021，末尾回滚顺序同步扩展 |
| `applyAttributeDefaults` 把负排序静默归零，负值校验测试无法通过 | 默认值只补分组，负排序交给 `Validate` 拒绝 |
| antd 两字按钮自动插入空格（「移 除」），按精确名称查不到 | 测试改用正则 `/移\s*除/` |
| 全量前端测试并行时 ResourcesPage 单用例超 15s | 分文件串行验证；全量结果见 §7 |

## 6. 与 SRS 的偏离

SRS v2.2 FR-30 的内置字段矩阵与现有表单字段存在三处补全，均为「PRD 空白」类：

1. application 画像信息组未列 `owner`，表单实际渲染，实现补入；
2. generic_target 采集信息组未列 `exporter_type`，实现补入；
3. interface_service 归属信息组未列 `cluster`，实现补入。

已登记 `dev-feedback.md` F-36，待 PRD 轮统一回填。

## 7. 验证结果

```bash
# 后端
go test ./platform/...        # 51 包通过，0 失败
go vet ./platform/...         # 通过

# 前端
pnpm exec tsc --noEmit        # 通过
pnpm run typecheck:test       # 通过
pnpm lint                     # 通过（0 warning）
pnpm vitest run src/pages/resources/ResourceFormDrawer.test.tsx   # 60 passed
pnpm vitest run src/pages/resources/ResourcesPage.test.tsx        # 84 passed
pnpm vitest run src/pages/resources/CIModelPage.test.tsx          # 5 passed
pnpm vitest run src/pages/resources/resourceFieldSchema.test.ts   # 6 passed
pnpm vitest run src/pages/resources/ResourceDetailDrawer.test.tsx \
  src/pages/resources/TemplateDownloadModal.test.tsx \
  src/pages/resources/ImportModal.test.tsx                        # 58 passed
pnpm test                     # 全量结果见下方追加
```

## 8. 遗留

1. **权限位与审计**：CI 模型配置沿用现有登录态，未加独立权限位；字段增删改未落只读快照（SRS 未强制）。
2. **画像字段迁移**：`version` / `owner` / `activated_at` / `go_live_at` / `protocol` 本版本仍为内置字段只读，迁移为自定义字段归后续版本。
3. **Excel 模板取值说明 sheet**：未追加「本类型自定义字段清单」，仅保留 `attributes` 列的既有说明。
4. **旧 `/api/v2`**：未评估兼容；v2 线已归档，本次仅 v3。

## 9. 全量前端回归

`pnpm test`：`Test Files 3 failed | 117 passed (120)`、`Tests 4 failed | 1199 passed (1203)`。

| 失败项 | 判定 | 处理 |
| --- | --- | --- |
| `src/api/resources.test.ts > resourceApi.create POSTs nested v3 payload` | 既有失败：v2.1 FR-30 起 `buildV3Attributes` 会显式写入 `has_npu` / `has_gpu`，测试期望体未同步 | 本轮同步期望体后该文件 37/37 通过 |
| `src/pages/config-center/preview/alertmanagerSmoke.test.tsx`（详情只读） | 既有失败：`git stash` 前端改动后基线复现，与本轮无关 | 未处理，建议 M08/M09 侧单独排查 |
| `ResourcesPage > F-17/F-13`、`F-17/F-8-b` 两例 17s 超时 | 并行资源竞争：单文件运行 84/84 通过 | 不处理；分文件验证已覆盖 |

其余 117 个测试文件、1199 个用例通过。
