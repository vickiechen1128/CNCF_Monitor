---
name: web-development
description: "MetricCenter 前端开发规范：技术栈、目录、契约优先、场景优先、Ant Design 测试稳定模式、forceRender 与测试范围控制"
---

# 前端开发规范

本 Skill 适用于 `ui-custom/web/` 生产前端。核心原则：**场景优先，功能后置**——页面按业务场景组织，而不是按功能堆叠；原型（V2）已归档，不作为当前输入。生产代码的 API 契约以 `api-standard` 为准，测试以 `testing-tdd` 为准。

---

## 1. 技术栈

- React 18 + TypeScript 严格模式
- Vite
- Ant Design 5
- ECharts
- Zustand / React Query
- `fetch` 封装的 `src/api/client.ts`

---

## 2. 目录结构

```text
ui-custom/web/src/
├── api/           # API 客户端与按模块封装
├── components/    # 通用组件（EllipsisText、FilterBar、tablePresets 等）
├── pages/         # 页面组件（每个页面一个目录，按场景组织）
├── stores/        # 状态管理
├── hooks/         # 自定义 Hooks
├── utils/         # 工具函数
├── test/          # 测试工具（antdTestUtils.tsx）
└── types/         # 类型定义
```

- 页面组件：`src/pages/`
- 通用组件：`src/components/`
- API 封装：`src/api/`
- 状态管理：`src/stores/`
- 类型定义：`src/types/`
- 模块归属可追溯：页面入口文件顶部 JSDoc 注明归属模块与 SRS/HLD 场景。
- 范围控制：只改任务要求的文件和目录；不借机新增 ESLint / Vitest / 构建配置。

---

## 3. 编码规范

- 函数组件 + Hooks。
- 组件文件 PascalCase：`TargetList.tsx`；工具文件 camelCase：`formatTime.ts`。
- 优先使用 TypeScript 严格类型；禁止随意 `any`。
- 所有 API 调用统一走 `src/api/client.ts` 或按模块封装的 API 文件。
- 长文本截断、表格列配置优先复用 `src/components/` 共享件，禁止散点手写内联样式。
- 表格列超出一屏时启用 `scroll={{ x: ... }}` 横向滚动 + 固定列。
- 页面必须处理 loading / empty / error / 权限不足 / 数据超量等状态，不能只画 happy path。

---

## 4. 契约优先（Contract-First）

- 契约来源：模块契约快照 > SRS 第 5/6 章 > `03_API_Standard.md`。
- 接口语义来自 HLD 接口清单；字段级来自 `api-contract-snapshot*`。
- 禁止反向读取 `platform/models/*.go` 拉齐字段。
- 前端类型、字段名（snake_case）、枚举值、响应结构必须与契约快照一致。
- 实现与契约不一致时报告 Orchestrator，禁止擅自对齐对端代码。

---

## 5. 场景优先（页面组织）

- 页面以**业务场景（SCN）**为组织单位，不以“功能”为组织单位。
- 开发前先回答：这个页面服务哪个 SCN？用户怎么走通？场景验收是什么？
- 禁止为了“功能完整”补场景用不到的页面/按钮/列。
- UI 展示名用 SRS 字段表的「UI 展示名」+ 场景用户语言，禁止把 snake_case 字段名当文案。
- 用户可见文案不出现内部字段名、模板 ID、checksum、决策编号、SRS 版本等技术术语。
- 状态语义用「颜色 + 文字标签」，不能只靠颜色。
- 百级以上关联清单用 `Table` + 分页/搜索，不用 `Popover` 承载大列表。

---

## 6. 基线差异分析（开发前）

前端开发开工第一步，先读基线再动手：

| 轨道 | 第一参照物 |
|------|-----------|
| rewrite | SRS 场景 + HLD + Scenario Link + `/api/v3` 契约快照 |
| 标准/增量 | SRS 场景 + 契约快照 + 任务卡 |

- 实现与场景/契约冲突时停止并报告 Orchestrator，禁止默认沿用旧实现续作。
- rewrite 模式旧版 UI 仅作行为对照；保留/变更/删除项登记在 `regression.md`。

---

## 7. Form 抽屉 / 弹窗强制 forceRender

**触发场景**：包含 Form 且通过 `useEffect(open)`（或 `useEffect([record])`）执行 `setFieldsValue` 回显 / 预填的 Drawer / Modal。

**规则**：

1. 必须设置 `forceRender`，保证 Form 常驻挂载、首次打开即正确回显。
2. 禁止使用 `destroyOnHidden` / `destroyOnClose`；如需重置表单，在 `useEffect(open)` 内 `form.resetFields()` 后 `setFieldsValue`。
3. 每个 Form 抽屉 / 弹窗必须配套「关闭 → 打开切换回显」回归测试。
4. 例外：无 Form 的确认 / 展示弹窗可继续使用 `destroyOnHidden` / `destroyOnClose`。

---

## 8. API 调用

```typescript
// src/api/targets.ts
import { apiClient } from './client';

export const listTargets = () => apiClient.get('/api/v3/platform/targets');
```

- 统一解析后端 `{status, data, errorType, error}` 信封。
- 错误提示使用 `errorType` 映射，不直接把后端原始错误暴露给用户。
- 不新增 `/api/v2` 调用；历史调用在迁移完成前保留时，必须标注迁移任务。

---

## 9. 测试与验证

- 开发中默认跑单文件或目录级测试；提交前至少 `pnpm lint` + 相关 vitest + `typecheck:test` + dev server 页面 200。
- 全量 `pnpm test` 仅在用户明确要求、合并前把关、或改动跨 ≥3 顶层目录 / 触及 `src/api/`、`src/types/`、`src/test/` 共享层时执行。
- 全量约 17 分钟；禁止调高 `maxWorkers`、关闭 `isolate`、删测试、加 `.skip` 或用 `--bail`。
- 按场景写验收断言：每个 SCN 至少一条端到端交互测试。

---

## 10. Ant Design 组件测试稳定模式

### 10.1 必须使用 `src/test/antdTestUtils.tsx`

```typescript
import { render, screen } from '@testing-library/react';
import { setupAntdTest, mockAntdModal } from '@/test/antdTestUtils';
import userEvent from '@testing-library/user-event';

setupAntdTest();
```

`setupAntdTest()` 自动处理：`matchMedia`、`getComputedStyle`、`scrollTo`、`ResizeObserver`，并在每个用例后 cleanup。

### 10.2 异步断言优先 `findBy*` / `waitFor`

antd 的 `Select`、`Drawer`、`Modal`、`Table` 有过渡动画和异步渲染，禁止用同步 `getBy*` 断言内部元素。

### 10.3 Modal 静态方法统一 mock

`Modal.confirm` / `Modal.info` / `Modal.warning` 在 jsdom 下会残留全局 DOM，统一用 `mockAntdModal()`。

### 10.4 用户事件使用 `userEvent.setup()`

```typescript
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: '提交' }));
```

### 10.5 表单提交等待

antd `Form.validateFields` / `scrollToField` 是异步的，提交后必须 `await waitFor(...)` 断言 `onSubmit` 被调用。

---

## 11. 常见反模式

- 把后端字段名直接当 UI 文案。
- 只画 happy path，不处理 loading / empty / error / 权限不足。
- 为“功能完整”补场景用不到的页面/按钮。
- 用 `Popover` 承载百级关联列表。
- 用颜色作为唯一状态语义（Badge 无文字）。
- 为提速调高 vitest worker 或关闭 isolate。
- 为绕过类型检查使用 `any`。
