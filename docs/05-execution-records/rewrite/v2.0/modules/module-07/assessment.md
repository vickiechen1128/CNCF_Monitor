# Module 07 资源管理 v2.0 重写评估（模块输入）

> **状态**：模块评估（已纳入 `rewrite/v2.0`；原“行为等价 / 不改 schema / 不改 PRD”约束不再适用）
> **评估日期**：2026-11-10
> **分支**：`rewrite/v2.0`（基线 `5dc058d` = `origin/develop`）
> **评估角色**：orchestrator
> **输入**：Module_07 PRD v2.55 / `api-contract-snapshot.md`（对齐 PRD v2.51）/ `feature-debt-control.md` / 现有代码与测试基线
> **上级章程**：`docs/05-execution-records/rewrite/v2.0/charter.md`
> **说明**：本文件只覆盖 M07 模块；产品级范围、API v3、schema 与 handover 规则以章程为准。

---

## 1. 结论

**M07 作为 v2.0 的首个模块推进，但不是“行为等价重构”，而是“模块级重写 + PRD/数据模型演进”。**

理由：

- 债务控制规范已明确把 `platform/config/resource/` 列为 repository/service 分层试点候选（`feature-debt-control.md` §7）；
- 现有测试是可靠安全网：后端 resource 包覆盖率 **78.9%**；前端 resources 目录 **12 个测试文件 / 244 用例全绿**（耗时 141s）；
- 但 M07 是高频热点（近 60 天后端 28 次提交、前端 44 次提交），一次性重写会与后续需求开发持续冲突；
- 前端 3 个核心文件已超过 800 行写入红线，**不先拆分，后续任何迭代都会先被工具链卡住**，所以前端拆分优先级最高。

---

## 2. 现状量化

### 2.1 后端 `platform/config/resource/`

| 指标 | 数值 | 说明 |
|------|------|------|
| 生产文件 | 24 个 / 5,700 行 | 单包混合 HTTP / 校验 / Excel / 模板 / 字典 |
| 测试文件 | 15 个 / 7,980 行 | 测试量大于生产代码 |
| 覆盖率 | 78.9% statements | `go test ./platform/config/resource/ -cover` |
| 单包测试耗时 | 1.8s（冷编译 36.8s） | 可作为每次重构后的快速回归 |
| handler 直连 DB | 12 个 handler + 5 个 store 接收 `*gorm.DB` | 违反 R1，无 service/repository 文件 |
| 动态字段访问 | 4 处实际调用（`list.go:209`、`update.go:158/159/162`） | 违反 R3；包装函数在 `validate.go:658-665` |
| 中央装配 | `main.go:327-331` 手工构造 5 个 store + `resource.RegisterRoutes` | 违反 R4，全 platform 无自注册机制 |
| 超大文件 | `validate.go` 689 / `excel.go` 613 / `template.go` 508 | 逼近 800 行红线，职责混杂 |

包外依赖很干净：仅依赖 `models`、`api/response`、`config/label`（1 处），适合在原地分层。

### 2.2 前端 `ui-custom/web/src/pages/resources/`

| 指标 | 数值 | 说明 |
|------|------|------|
| 文件规模 | 28 个 / 13,331 行（其中测试 5,227 行） | 生产约 8,100 行 |
| 超大文件 | `ResourcesPage.tsx` 1,538 / `ResourceFormDrawer.tsx` 1,096 / `ResourceDetailDrawer.tsx` 806 | 已超 Kimi hook 800 行写入上限 |
| 状态密度 | ResourcesPage 23 个 `useState`、FormDrawer 10 个、DetailDrawer 14 个 | 容器承担了筛选、字典、列偏好、导入、删除、抽屉编排 |
| 测试 | 12 文件 / 244 用例 / 141s | 页面 79、表单 54、详情 29 |
| 重复常量 | `RESOURCE_TYPE_MAP` 6 处、`STATUS_MAP` / `SOURCE_TYPE_MAP` / `statusColor` 各 2 处 | 类型展示口径分散 |
| 死代码 | `ResourcePage.tsx`（37 行）无任何引用 | 可安全删除 |

`ResourcesPage.tsx` 内部已有清晰可切分边界：列定义 `buildColumns`（约 600-1049 行）、字典加载与展示名解析（约 275-520 行）、列宽/列偏好（约 1051-1135 行）、删除引用预检（约 536-581 行）。

### 2.3 跨模块重复

`platform/dashboard/summary.go:298`、`:897` 注释自述与 `platform/config/resource/list.go` 的派生口径「同源」，实际是两份实现；重构时应抽成单一函数，避免后续口径漂移。该项会触碰 M02/M05 代码，建议单列任务、不并入首批。

---

## 3. 技术债清单

| 编号 | 债务 | 位置 | 规则 | 建议批次 |
|------|------|------|------|----------|
| D1 | 前端 3 个巨型文件 | `ResourcesPage.tsx` / `ResourceFormDrawer.tsx` / `ResourceDetailDrawer.tsx` | 800 行红线 + 可维护性 | P1 |
| D2 | 前端重复展示常量 / 死代码 | resources 目录 | DRY | P1 |
| D3 | handler 直连 DB、无 service/repository | resource 包 12 个 handler | R1 | P2/P3 |
| D4 | 业务链路动态字段访问 | `list.go`、`update.go` | R3 | P3 |
| D5 | 中央文件手工装配 | `main.go:327-331` | R4 | P4 |
| D6 | Excel / 模板 / 校验混杂在主包 | `excel.go`、`template.go`、`validate.go` | 单一职责 | P4 |
| D7 | 列表派生逻辑跨模块重复 | `dashboard/summary.go` vs `resource/list.go` | DRY / 口径一致性 | 后续单列 |

---

## 4. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 测试与实现强耦合 | 后端测试直接 `mount(handler(db))`，改分层需同步改大量装配；前端页面测试直接渲染整页 | Phase 1 前端只搬移；后端阶段按 v2.0 允许行为/契约演进，但保留项必须登记；测试改动与逻辑改动分开提交 |
| 分支混入无关提交 | 旧 `feature/chenrt` 含 module-08 代码 + 67 个未合并提交 | 已从 `develop` 重建 `rewrite/v2.0`；旧分支归档，不再合入 |
| PRD / 契约快照滞后 | 旧 PRD v2.55；L2 仍写 v2.30；旧快照对齐 v2.51 | 新 PRD 从业务需求重写；旧 PRD 仅参考；新线用 `/api/v3` 契约快照，旧 v2 仅作回归对照 |
| 前端交互细节多 | 列偏好 localStorage、皮肤 token、深链参数、AntD 动画 | Phase 1 保留 244 个用例作等价证明；后续允许按新 PRD 调整，但必须登记保留 / 变更 / 删除 |
| 热点冲突 | 近 60 天 72 次提交 | `rewrite/v2.0` 单线推进，模块串行；只有零耦合模块才开 `rewrite/v2.0-module-XX` |

---

## 5. 目标结构（三种深度）

### A. 保守（不动 import 路径）

```
platform/config/resource/
├── handler_*.go     # 从现有文件按职责拆出
├── service_*.go
├── repo_*.go
└── excel_*.go
```

前端仅把页面内部拆成 `components/` + `hooks/` + `resourceMeta.ts`，API 层不动。
**风险最低，但不能解决「包内职责混杂」和 R4。**

### B. 标准（推荐）

```
platform/config/resource/
├── module.go           # 组合根 + 模块自注册（R4 试点）
├── handler/            # 薄 HTTP 层
├── service/            # 业务规则编排
├── repository/         # GORM 访问
├── excel/              # 模板/解析/导入校验（允许动态字段）
├── dict/               # 四类字典
└── dto/                # 请求/响应 + 列表 item 组装
```

前端：

```
pages/resources/
├── ResourcesPage.tsx        # 容器，目标 < 300 行
├── components/              # 表格、筛选、列设置、删除确认
├── drawers/                 # Form / Detail / Import / Template
├── hooks/                   # useResources / useResourceDicts / useColumnPrefs
├── meta/resourceMeta.ts     # 类别、状态、来源、子类字段
└── api/                     # resources.ts 按资源/字典/导入拆分
```

### C. 彻底（模块化目录重排）

把 M07 相关代码统一迁到 `platform/modules/m07/`（含 label 模板、字典、导入），models 保持共享。
**收益最大但影响面最广，会触碰其他模块 import，不建议作为第一批。**

---

## 6. 分阶段计划（推荐 B，按批次独立提交）

| 批次 | 内容 | 预估 | 验证 |
|------|------|------|------|
| P0 基线冻结 | 建立 `rewrite/v2.0`；旧版打 tag；记录旧版 golden 响应作回归基线；写 R1-R4 checklist | 0.5 人日 | 基线全绿 |
| P1 前端止血 | 拆 ResourcesPage（columns/meta/hooks/components）；拆 FormDrawer 为共享字段 + 分类型字段；抽公共常量；删 `ResourcePage.tsx` | 1.5-2 人日 | `vitest run src/pages/resources` + `typecheck:test` + `lint` |
| P2 后端读路径分层 | list / query / 详情 / 字典只读 → repository + service；handler 变薄；测试装配适配 | 1-1.5 人日 | `go test ./platform/config/resource/` |
| P3 后端写路径分层 | create / update / delete / labels / import；引用检查独立；R3 收敛为 DTO 映射（Excel 保留动态字段） | 1.5-2 人日 | 同上 + 旧 vs 新行为矩阵 + v3 契约快照 |
| P4 模块化收口 | `module.go` 自注册试点；拆 excel/template 子包；main.go 保留兼容入口 | 1 人日 | `go test ./platform/...` + 服务启动 |
| P5 收尾 | 全量回归、旧 vs 新矩阵、handover、schema/migration 核对 | 0.5 人日 | 全量测试 + 冒烟 + handover |

**总计约 6-8 人日；若只做 P1（前端），约 2 人日。**

---

## 7. 验收口径（v2.0 模块重写）

1. 新 API 契约按 `/api/v3/platform/*` 设计；旧 `/api/v2` 仅作回归对照，不要求向后兼容（除非本模块明确要求）；
2. DB schema 允许演进；每个 schema 变更必须有 migration（Up/Down）、回滚说明与数据对账；
3. 后端 `go test ./platform/...` 全绿；新增/修改接口有目标测试与契约测试；
4. 前端目标目录测试全绿 + `typecheck:test` + `lint` + `build`；关键页面冒烟；
5. 旧版关键行为矩阵：保留项 / 有意变更项 / 删除项逐项登记（见 `regression.md`）；
6. 每个批次独立 commit：`docs:` / `refactor:` / `schema:` / `feat:` 分开；不修改 `upstream/`。

---

## 8. 已确认决策（2026-11-10）

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 1 | 重写深度 | **模块级重写** | 前端拆目录 + 后端分层 + 数据模型演进；不再受“行为等价”限制 |
| 2 | 优先级 | **前端先** | 3 个核心文件已超 800 行写入红线；先解除工具链阻塞，再推进后端与 schema |
| 3 | 分支 | **`rewrite/v2.0`** | 产品级重写分支；M07 是首个模块，不再使用 `refactor/module-07-*` |
| 4 | API 版本 | **`/api/v3/platform/*`** | 旧新并行 / 对外契约干净断代；旧 `/api/v2` 归档 |
| 5 | PRD | **可在 rewrite 分支直接更新** | 旧 PRD 仅参考；新 PRD 从业务需求重写，按里程碑版本化 |
| 6 | 跨模块重复（D7） | **后续单列** | 会触碰 M02/M05 代码，不纳入 M07 首批 scope |

### 分支核对记录

```text
git fetch origin --prune
git rev-list --left-right --count origin/develop...HEAD
→ 0    0     # 基线时 HEAD 与 origin/develop 一致
```

M07 的 v2.0 重写在 `rewrite/v2.0` 上提交；模块并行时使用 `rewrite/v2.0-module-07`，完成后合回主分支。

