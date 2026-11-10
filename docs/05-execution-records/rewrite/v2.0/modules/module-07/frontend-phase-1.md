# Module 07 前端 Phase 1 执行记录（v2.0）

> **状态**：done（2026-11-10）
> **分支**：`rewrite/v2.0`（基线 `5dc058d` = `origin/develop`）
> **任务序列**：`docs/05-execution-records/rewrite/v2.0/modules/module-07/task-sequence.yaml`（T07-R0 ~ R9 全部 done）
> **约束**：本阶段（Phase 1 子阶段）只做前端结构重写，暂不改 API 契约 / DB schema / PRD / 原型；行为等价由既有 244 个用例守护。整体 `rewrite/v2.0` 不受此限，后续模块阶段允许 API v3 / schema / PRD 演进。

---

## 1. 结果概览

三个超过 800 行写入红线的文件全部拆解，页面收敛为容器：

| 文件 | 重构前 | 重构后 |
|---|---:|---:|
| `ResourcesPage.tsx` | 1,538 | **294** |
| `ResourceFormDrawer.tsx` | 1,096 | **319** |
| `ResourceDetailDrawer.tsx` | 806 | **318** |

新增/拆出的模块（均 < 800 行）：

| 文件 | 行数 | 职责 |
|---|---:|---|
| `resourceMeta.ts` | 74 | 类别 / 状态 / 来源展示元数据与主标识 |
| `resourceColumns.tsx` | 575 | 六类资源列表列定义 + `ResourceColumnContext` |
| `useResourceDictionaries.ts` | 199 | 6 个字典加载 + 展示名解析（F-18 降级语义） |
| `useResourceColumnPrefs.ts` | 205 | 列显隐偏好 / 列宽 / ResizeObserver（F-17） |
| `useResourceDelete.tsx` | 72 | 引用预检 + 二次确认 + DELETE |
| `DeleteResourceConfirm.tsx` | 49 | 删除确认弹窗内容 |
| `ResourceFilterBar.tsx` | 268 | 筛选区 + 列设置浮层 |
| `ResourceListAlerts.tsx` | 107 | 采集状态 / 深链提示 Alert |
| `ResourceTable.tsx` | 99 | 表格 + 分页 + 空态 |
| `ResourceCategoryTabs.tsx` | 25 | 资源类别 Tab |
| `resourceFormMappers.ts` | 213 | 表单输入 / 回显纯映射 |
| `resourceFormFields.tsx` | 632 | 共享字段 + 六类差异化字段渲染 |
| `useResourceLabels.ts` | 259 | 标签状态 / 加载 / 增删改 / 模板冲突 / 403 |
| `ResourceLabelsTab.tsx` | 303 | 标签区展示与编辑行 |

删除死代码：`ResourcePage.tsx`（14 行，无任何引用）。

---

## 2. 验证结果（2026-11-10）

| 命令（`ui-custom/web/`） | 结果 |
|---|---|
| `pnpm vitest run src/pages/resources` | ✅ 12 文件 / 244 用例全绿（126–141s） |
| `pnpm run typecheck:test` | ✅ 通过 |
| `pnpm exec eslint src/pages/resources --max-warnings 0` | ✅ 0 error / 0 warning |
| `pnpm build` | ✅ 9.26s（仅有既存 chunk >500kB 提示） |
| dev server `GET /` / `GET /resources` | ✅ 均 200，验证后已停止并释放端口 |

已知基线问题（未修，超出本轮 scope）：`src/pages/strategy/InstanceSelector.tsx:94` 存在既有 `react-hooks/exhaustive-deps` warning，导致全量 `pnpm lint` 非零；目录级 eslint 为 0/0。

测试抖动：重交互的 F-17 用例在宿主机高负载时偶发 15s 超时，单独复跑或重跑目录即通过；未改测试超时配置。

---

## 3. 行为等价说明

- 所有用户可见文案、列 key/顺序/宽度/fixed/render、Tooltip、Tag 颜色、空值 `-` 兜底逐字保留。
- localStorage 键名与脏数据回退、固定列不可取消、列设置浮层受控展开语义不变。
- 删除引用预检失败不阻断、确认弹窗文案与 `/scrape-jobs` 跳转不变。
- 表单字段顺序、`rules`、`forceRender`、回显顺序、级联逻辑不变。
- 标签区请求路径/参数、模板冲突 Modal、403 静态资源提示、来源描边色不变。

唯一的非用户可感知差异（T07-R8）：详情抽屉原单一 effect 拆为「标签 + 模板」与「云/分区/平台字典」两个 effect（依赖均为 `[open, record]`），跨组请求发起顺序由「标签→云→分区→平台→模板」变为「标签→模板→云→分区→平台」；请求条数、路径、参数不变。

---

## 4. 遗留事项

1. 工作区改动**尚未提交**；建议按「文档」与「前端重构」拆两个 commit（文件交叉较多，不建议强行按 R1–R9 拆 9 个 commit）。
2. 后端 Phase 2（R1 分层 / R3 字段访问收敛 / module.go 自注册）尚未启动，待用户确认。
3. 跨模块重复（`dashboard/summary.go` vs `resource/list.go`）仍按原计划单列任务。
