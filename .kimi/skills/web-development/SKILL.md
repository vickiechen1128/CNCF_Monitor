---
name: web-development
description: "MetricCenter 前端开发规范：技术栈、目录、契约优先、原型一致性、Ant Design 测试稳定模式、forceRender 与测试范围控制"
---

# 前端开发规范

本 Skill 适用于 `ui-custom/web/` 生产前端与 `docs/prototypes/module-XX/` 原型。生产代码的 API 契约以 `api-standard` 为准，测试流程以 `testing-tdd` 为准。

---

## 1. 技术栈

- React 18 + TypeScript 严格模式
- Vite
- Ant Design 5
- ECharts
- Zustand / React Query
- Axios / `fetch` 封装的 `src/api/client.ts`

---

## 2. 目录结构

```text
ui-custom/web/src/
├── api/           # API 客户端与按模块封装
├── components/    # 通用组件（EllipsisText、FilterBar、tablePresets 等）
├── pages/         # 页面组件（每个页面一个目录）
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
- 模块归属可追溯：页面入口文件顶部 JSDoc 注明归属模块与 PRD 路径；跨模块复用页面注明「跨模块共享」。
- 范围控制：只改当前任务要求的文件和目录；不要借机新增 ESLint / Vitest / 构建配置，除非任务明确要求或项目完全无法运行。

---

## 3. 编码规范

- 函数组件 + Hooks。
- 组件文件 PascalCase：`TargetList.tsx`；工具文件 camelCase：`formatTime.ts`。
- 优先使用 TypeScript 严格类型；禁止随意 `any`。
- 所有 API 调用统一走 `src/api/client.ts` 或按模块封装的 API 文件。
- 长文本截断、表格列配置优先复用 `src/components/` 共享件（如 `EllipsisText`），禁止散点手写 `maxWidth` 内联样式。
- 表格列超出一屏时按 `02_Frontend_Standard.md` 第 9 章启用 `scroll={{ x: ... }}` 横向滚动 + 固定列。
- 页面必须处理 loading / empty / error / 权限不足 / 数据超量等状态，不能只画 happy path。

---

## 4. 契约优先（Contract-First）

- 唯一契约来源：`docs/05-execution-records/module-XX/api-contract-snapshot.md` > PRD 第 5/6 章 > `03_API_Standard.md`。
- 禁止反向读取 `platform/models/*.go` 拉齐字段；并行开发时后端可能尚未实现或正在变更。
- 前端类型、字段名（snake_case）、枚举值、响应结构必须与契约快照一致。
- 契约快照缺失或内部矛盾时，以 PRD 第 5/6 章为最高权威，并在汇报中标注。
- 实现与契约不一致时报告 Orchestrator，禁止擅自对齐对端代码。

---

## 5. 原型项目规范

> 适用于 `docs/prototypes/module-XX/` 下的快速原型，不完全等同于生产前端代码。

- **版本声明**：`package.json` 的 `version` 必须与验证的 PRD 版本保持一致；`README.md` 顶部注明验证的 PRD 版本、覆盖的产品版本、本地启动命令与访问地址。
- **全局导航**：每个模块原型必须包含跨模块导航壳（Shell），至少提供资源管理、监控策略、配置中心、指标查询、告警状态、系统设置等入口的链接或占位。
- **版本占位页**：v0.2+ 功能以占位页或 disabled 菜单呈现，页面标题标注 `{v0.2}`、`{v0.4+}` 等阶段标签。
- **模式开关**：mock 数据中应包含 `Tenant.multi_site_enabled` 等租户级开关，以便演示单网域 / 多网域模式差异。
- **用户视角**：原型页面按用户任务组织，不按数据表 / 配置文件组织；用户可见文案不出现内部字段名、模板 ID、checksum 等技术术语。
- **提示分区**：用户 UI 文案、产品/技术评审说明（`<ReviewNote>` 折叠区）、开发/AI 注释三类分离；用户可见文案不得出现「决策 X」「PRD X.X」等引用。
- **数据规模 → 组件选型**：百级以上关联清单用 `Table` + 分页/搜索，不用 `Popover` 承载大列表；只读结构化详情用 `Card` / `Descriptions` / `Tabs`；状态语义用「颜色 + 文字标签」，不能只靠颜色。

---

## 6. 基线差异分析（开发前 BLOCKING）

前端开发开工第一步，必须按轨道读基线 → 差异认知 → 再动手：

| 轨道 | 第一参照物 | 核对方式 |
|------|-----------|---------|
| **Track A** | 原型页面 + `frontend-prototype-map.md` | 按 Planner 产出的差异矩阵（S/A/B 分级）逐项核对；S 级未解决必须停止并报告 Orchestrator |
| **Track B/B+** | `dev-ready` 轻量规格 PRD 章节 + `api-contract-snapshot.md` | 核对字段表 / 接口清单 / 验收清单与当前实现的一致性；无原型不阻断 |

发现实现与轨道基线冲突时（Track A：原型已改但前端未同步；Track B：轻量规格 / 契约快照与代码冲突），必须停止并报告 Orchestrator，禁止默认沿用旧实现续作。

---

## 7. 原型-实现一致性核对（Track A 强制）

开发页面组件前，对照 `frontend-prototype-map.md` + task-sequence 的 `prototype_pages` / `ui_contract` / `nav_contract` / `clipping` + PRD 逐项核对。原型是页面实现基底（优先复制页面结构 / 列集合 / 视觉 Token），但必须删 mock、换真实 API、去评审体系、按 MVP 裁剪。

1. **UI 展示名**：字段标签使用 PRD 字段表「UI 展示名」+ 原型用户语言，禁止把后端 snake_case 字段名当文案。
2. **用户文案**：页面可见文案不得出现原型折叠区 / PRD 技术层术语（模板 ID、内部枚举、模块代号、checksum 等）；不确定时查 PRD 术语映射。
3. **交互组件**：按 `02_Frontend_Standard.md` 第 8 章选择 Drawer / Modal / 独立页面，按第 9 章处理列表、长文本、横向滚动；原型做法与全局标准冲突时以标准为准，并报告 Orchestrator 修正原型。
4. **视觉 Token**：复用原型的全局主题（主色 / 深色头部 / 状态色 / 背景）注入 `ConfigProvider`，禁止沿用 antd 默认色；原型无 theme 时以全局标准为准。
5. **列 / 区块完整性**：实现列集合 = 原型列集合 ∩ PRD MVP 范围；删减必须逐列标注理由；后端 DTO 已返回而 UI 未渲染的字段必须补渲染。
6. **导航与模块名**：顶部一级 tab / banner 文案必须用 PRD 模块名，禁止用功能页名或随手起名；首页作为第一个 tab。
7. **共享组件复用**：筛选区、表格、长文本复用原型共享组件（`FilterBar` / `FilterItem` / `tablePresets` / `EllipsisText`）；缺组件时先复制，不另起炉灶。
8. **冲突报告**：原型与 PRD 不一致（字段名、交互、布局）时报告 Orchestrator，禁止自行二选一；偏离必须写入 `dev-feedback.md` 或 `frontend-prototype-map.md` 偏离记录区。

---

## 8. Form 抽屉 / 弹窗强制 forceRender

**触发场景**：包含 Form 且通过 `useEffect(open)`（或 `useEffect([record])`）执行 `setFieldsValue` 回显 / 预填的 Drawer / Modal。

**根因**：antd Drawer / Modal 首次打开时内容惰性挂载，`setFieldsValue` 可能在 Form 字段注册前被静默丢弃，导致首次打开回显为空、二次才出现。

**规则**：

1. 必须设置 `forceRender`，保证 Form 常驻挂载、首次打开即正确回显。
2. 禁止使用 `destroyOnHidden` / `destroyOnClose`；如需重置表单，在 `useEffect(open)` 内 `form.resetFields()` 后 `setFieldsValue`。
3. 每个 Form 抽屉 / 弹窗必须配套「关闭 → 打开切换回显」回归测试，首次打开即断言 `findByDisplayValue` 命中编辑值。
4. 例外：无 Form 的确认 / 展示弹窗（删除确认、克隆、明文 Token 展示）可继续使用 `destroyOnHidden` / `destroyOnClose`。

---

## 9. API 调用

```typescript
// src/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

// src/api/targets.ts
import { apiClient } from './client';

export const listTargets = () => apiClient.get('/api/v2/platform/targets');
```

- 统一解析后端 `{status, data, errorType, error}` 信封。
- 错误提示使用 `errorType` 映射，不直接把后端原始错误暴露给用户。
- 字段类型以契约快照为准，snake_case 与后端 JSON 一致。

---

## 10. 测试与验证

- 开发中默认跑单文件或目录级测试，不无条件跑全量。
- 提交前至少：`pnpm lint` + 相关 vitest + `pnpm run typecheck:test` + dev server 页面 200。
- `pnpm test` 全量仅在用户明确要求、合并前把关、或改动跨 ≥3 顶层目录 / 触及 `src/api/`、`src/types/`、`src/test/` 共享层时执行。
- 全量约 17 分钟；禁止调高 `maxWorkers`、关闭 `isolate`、删测试、加 `.skip` 或用 `--bail`。
- 详细命令与 flaky 处理见 `testing-tdd`。
- 依赖安装：`pnpm install`；若提示 `ignored builds`，在 `pnpm-workspace.yaml` 声明 `allowBuilds: { esbuild: true }` 并包含 `packages: ['.']`。

---

## 11. Ant Design 组件测试稳定模式

> 适用于 `ui-custom/web` 的 Vitest + React Testing Library + jsdom 环境。目标：消除 antd 组件在 jsdom 下最常见的 flaky 问题。

### 11.1 必须使用 `src/test/antdTestUtils.tsx`

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { setupAntdTest, mockAntdModal } from '@/test/antdTestUtils';
import userEvent from '@testing-library/user-event';

describe('MyPage', () => {
  setupAntdTest();

  it('confirms deletion', async () => {
    const modal = mockAntdModal();
    render(<MyPage />);

    await userEvent.click(screen.getByText('删除'));
    expect(modal.confirm).toHaveBeenCalled();

    const onOk = modal.confirm.mock.calls[0][0].onOk;
    await onOk?.();
  });
});
```

`setupAntdTest()` 自动处理：`matchMedia`、`getComputedStyle`、`scrollTo`、`ResizeObserver`，并在每个用例后 cleanup。

### 11.2 异步断言优先 `findBy*` / `waitFor`

antd 的 `Select`、`Drawer`、`Modal`、`Table` 存在过渡动画和异步渲染，禁止用同步 `getBy*` 断言内部元素。

```typescript
// ❌ 可能因动画 / 异步渲染失败
expect(screen.getByText('选项 A')).toBeInTheDocument();

// ✅ 等待元素出现
expect(await screen.findByText('选项 A')).toBeInTheDocument();
```

### 11.3 Modal 静态方法统一 mock

`Modal.confirm` / `Modal.info` / `Modal.warning` 在 jsdom 下会创建全局 DOM 节点，跨用例残留导致 flaky。统一使用 `mockAntdModal()`，不要直接 `vi.spyOn(Modal, 'confirm')` 后不 restore。

### 11.4 Select 交互

1. 点击 Select 打开面板；
2. 用 `await screen.findByText` 等待选项出现在 `document.body`；
3. 再点击选项。

禁止直接 `fireEvent.mouseDown(select)` 等 hack。

### 11.5 用户事件使用 `userEvent.setup()`

```typescript
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: '提交' }));
```

### 11.6 表单提交等待

antd `Form.validateFields` / `scrollToField` 是异步的，提交后必须 `await waitFor(...)` 断言 `onSubmit` 被调用。

### 11.7 额外全局 API

`setupAntdTest()` 未覆盖的 API 在测试文件内显式 stub，并在 `afterEach` 中 `vi.unstubAllGlobals()`。

### 11.8 单文件测试命令

```bash
pnpm vitest run src/pages/resources/__tests__/ResourceFormDrawer.test.tsx
```

---

## 12. 常见反模式

- 把后端字段名直接当 UI 文案。
- 只画 happy path，不处理 loading / empty / error / 权限不足。
- 用 `Popover` 承载百级关联列表。
- 用颜色作为唯一状态语义（Badge 无文字）。
- 为提速调高 vitest worker 或关闭 isolate。
- 原型代码直接混入 `ui-custom/web/`。
- 为绕过类型检查使用 `any`。
