# M01 采集模板化（取消 monitor_type）— 后端 P1 执行记录

> **任务**：按 owner 2026-11-20 拍板的 C 方案（退化为「采集模板 + 任务选择器」）完成后端改造
> **关联文档**：[M01 SRS v1.5](../../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)、[M07 SRS v2.3](../../02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md)、[M01 概要设计 v1.1](../../07-design/Module_01_Metric_Collection_Center_High_Level_Design.md)、[设计提案](design-proposals/collection-template-and-selector.md)、契约快照 `../rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md`
> **模式**：rewrite（分支 `rewrite/v2.0`）

---

## 1. 变更概览

| 层 | 变更 |
|----|------|
| schema | 新增 `0023_m01_collection_templates.{sqlite,postgres}.sql`：建 `m01_collection_templates`、`m01_scrape_jobs`/`m01_job_groups`/`m01_monitoring_rules` 的 `monitor_type → template_code`、新增 `selector` / `default_selector`、指标锚点 `monitor_types → collection_templates`、删 `supported_monitor_types`、删三张旧表（Up 期完成数据搬迁） |
| domain | 新增 `collection_template.go`、`selector.go`、`candidate_fields.go`、`builtin_collection_templates.go`；删除 `monitor_registry.go`、`scope_fields.go`、`builtin_monitor_types.go`、`monitor_type.go` |
| repository | 新增 `collection_template.go`；删除 `mapping.go`、`monitor_type.go`；job/rule/metric 记录与查询改 `template_code`；标签模板引用计数改读模板表 |
| service | 新增 `collection_template.go`；删除 `mapping.go`、`monitor_type.go`；JobService 改为「模板 → 导出器/参数/标签模板」并新增保存期选择器校验；RuleService 校验模板存在 |
| handler | 新增 `collection_template.go`（`/collection-templates` + `/candidate-fields`）；设备路由重写；删除 `mapping.go`、`monitor_type.go` |
| dto | 新增 `collection_template.go`（含 `SelectorDTO`）；Job/JobGroup/Candidate/Rule/Metric/Exporter 投影改 `template_code` + `selector` |
| seed | 内置模板种子（10 条，绑定 6 个内置导出器；npu/es/nginx/application_http 未绑定导出器，种子为停用态） |
| M09 | 端口解析改读 `m01_collection_templates`，Job 侧读 `template_code` |
| 兼容层 | `platform/models` 旧 v2 模型的 `MonitorType`/`MonitoredTypes` 字段同步改名；删除未使用的 `CITypeExporterMapping` |

## 2. 关键实现说明

1. **模板与范围分离**：`CollectionTemplate` 不含筛选条件；`default_selector` 只是新建任务的向导预填（`service.QueryCandidates` 在 selector 全缺省时取用），后端从不据它求值。
2. **一个模板一个采集实现**：取消「同类型多实现 + 默认标记」；`Catalog(templateCode)` 返回模板 + 导出器，Job 的 `exporter_template_id` / `label_template_id` 由模板派生。
3. **字段字典**：内置字段（`domain.FieldSpecs`，含归属类字段）+ M07 自定义字段（`m07_attribute_definitions` 只读）合并；内置字段走固定列映射，自定义字段走 `EXISTS (SELECT 1 FROM m07_resource_attributes …)`，key/value 全参数绑定。
4. **选择器两处校验同一入口**：保存 Job 时 `JobService.selectorValidator`、候选查询时 `references.resolveSelector`；两者都走 `domain.ValidateSelectorWith` + M07 自定义字段解析。
5. **迁移无损**：默认 mapping → 模板（`code = monitor_type`），同类型非默认 mapping → `<type>__<exporter>`；任务 `monitor_type` → `template_code`，旧类型规则 → 任务 `selector`（同一语义直接搬运）；指标锚点同值改名。
6. **管理写权限**：内置模板的 PUT/DELETE 由 service 判 `IsBuiltin` + 平台管理员（DELETE 内置一律 403），路由层对登录用户开放（同一路由承载两类资源）。

## 3. 新增/修改测试

- `platform/db/collection_template_migration_test.go`（新增）：在 schema 22 上种入「类型 + 规则 + 默认 mapping + 任务 + 指标锚点」，跑 0023 后断言模板/选择器/锚点/旧表删除，再断言 Down 恢复结构。
- `platform/db/monitor_type_registry_migration_test.go`：收敛为「迁移到 22」的历史切片（0023 已删该注册表）。
- `platform/db/m01_migration_test.go` / `migrate_test.go`：表清单与 mapping 断言改为 `m01_collection_templates`。
- `platform/modules/m09/references/source_reader_test.go`：端口来源夹具改模板表。
- `platform/modules/m01/**`：16 个测试文件适配模板/选择器模型（96 → 102 个测试函数，无删除）。

## 4. 验证命令与结果

```bash
export PATH="$PWD/.tools/go/bin:$PATH"; export GOROOT="$PWD/.tools/go"; export GOCACHE="$PWD/.cache/go-build"
go build ./platform/...            # 通过
go vet ./platform/...              # 通过
go test -count=1 ./platform/...    # 结果见 §5
```

## 5. 验证结果

| 项 | 命令 | 结果 |
|----|------|------|
| 编译 | `go build ./platform/...` | 通过 |
| 静态检查 | `go vet ./platform/...` | 通过（含测试） |
| 格式 | `gofmt -l platform/` | 无输出 |
| 全量后端测试 | `go test -count=1 ./platform/...` | 全部包通过（0 失败 / 0 skip） |
| 迁移测试 | `go test ./platform/db/ -run TestMigrateV3CollectionTemplates` | 通过（含 Up 数据搬迁与 Down 结构恢复） |
| 路由/启动 | `go test ./platform/cmd/metric-center/` | 通过：v3 路由挂载、`/collection-templates` 401、`/candidate-fields` 401、旧 `/monitor-types` 404、Bootstrap 种子可见 |
| 冒烟 | 独立二进制 + sqlite | **未执行**：`metric-center` 生产二进制不含 sqlite dialector（`platform/db/db.go` 明确 sqlite 为测试专用），启动验证由 `cmd/metric-center` 集成测试覆盖 |

> 说明：容器内 `go test` 需 `GOCACHE` 指向工作区（默认用户缓存被沙箱拒绝）。

## 6. 偏离与遗留

1. **旧路由不保留只读别名**：`/monitor-types*`、`/ci-exporter-mappings*` 直接下线（404）；前端同版本改造。概要设计已同步。
2. **未绑定导出器的内置模板**：`host_npu` / `elasticsearch` / `nginx` / `application_http` 在内置导出器池中没有实现，种子为停用态 + 文案提示，需管理员在采集模板页绑定导出器后启用（避免用 node-exporter 误采）。
3. **指标库 `resource_category` 过滤仍未落地**（既有缺口，非本次引入）；锚点 `template_code` 仅校验非空与去重。
4. **网域级参数覆盖（FR-04）仍未实现**（既有缺口）。
5. **前端 P2 已完成**（见 §7）。

---

## 7. 前端 P2（采集模板页 / 三步向导 / 指标库锚点 / 删除类型页）

### 7.1 结构变更

| 区域 | 变更 |
|------|------|
| 类型与 API | 新增 `types/collectionTemplate.ts`、`api/collectionTemplates.ts`（模板 CRUD + impact + `/candidate-fields`）；`types/strategy.ts` / `types/strategyV3.ts` 全量改 `template_code` + `selector`；删除 `api/monitorTypes.ts`、`api/ciExporterMappings.ts`、`types/monitorType.ts` |
| 共享组件 | 新增 `SelectorEditor`（条件行编辑器，字段来自字典、操作符按类型收敛）、`selectorUtils`（操作符/取值推导 + 摘要）、`useCollectionTemplateCatalog` / `useCandidateFields`（进程内缓存） |
| 采集模板页 | `CollectorTemplatesTab` 重写为「采集模板 / 采集实现」双 Tab；新增 `CollectionTemplateDrawer`（默认选择器为「推荐条件」预填）；`CollectorListPage` 文案；删除 `MappingDrawer` / `MonitorTypePage` / `LabelTemplateSelectDrawer` |
| 任务域 | `ScrapeJobFormDrawer` 改为选模板 → 自动带出导出器/标签模板/参数 → 选择器预填可改；`JobGroupWizardDrawer` 第 2 步改为「采集模板与范围」（模板 + SelectorEditor），候选查询与保存载荷改 `template_code` + `selector`；`InstanceSelector` / `ScrapeJobListPage` / `ScrapeJobDetailDrawer` / `JobGroupDetailDrawer` 列与筛选改采集模板 |
| 指标库 / 规则 | 指标锚点改「采集模板」多选 + 来源采集器，载荷 `collection_templates[]`；规则筛选/详情改 `template_code`；采集实现抽屉移除「支持监控类型」 |
| 导航 | `MainLayout` 菜单「采集器管理 → 采集模板」，删除「监控对象类型」；`App.tsx` 删除 `/monitor-types` 路由（旧书签落 404/通配回首页，不做重定向） |

### 7.2 验证

| 项 | 命令 | 结果 |
|----|------|------|
| 应用类型 | `pnpm exec tsc --noEmit` | 0 错误 |
| 测试类型门禁 | `pnpm run typecheck:test` | 0 错误 |
| Lint | `pnpm run lint` | 0 error / 0 warning |
| 构建 | `pnpm run build` | 成功（4.5s） |
| 定向测试（变更范围） | `vitest run src/pages/strategy src/layouts src/api` | 34 文件 / 302 用例全通过 |
| 后端未回归 | `go build ./platform/...` | 通过（本轮未改后端） |

> 说明：本机 homebrew pnpm 会尝试清空 `node_modules` 并因无 TTY 失败，验证统一使用项目工具链 `../../.tools/pnpm/bin/pnpm`（9.15.9）+ `CI=true`。

### 7.3 已知取舍

1. 「采集实现」Tab 目前只读（未挂登记入口），避免与任务抽屉的采集器登记动线重复；如需本页登记，后续单独接回。
2. 删除 3 个过时测试用例（监控对象类型下拉过滤、NPU 级联、抽屉内「登记采集器」内联入口），对应功能已不存在。
3. 旧书签 `/monitor-types` 不做重定向：概念已下线，直接落通配路由回首页。
