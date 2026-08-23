# 前端开发规范

## 技术栈

- React 18 + TypeScript
- Vite
- Ant Design / Mantine（待定）
- ECharts
- Zustand 或 React Query
- Axios

## 目录结构

```
ui-custom/web/src/
├── api/           # API 客户端
├── components/    # 通用组件
├── pages/         # 页面组件
├── stores/        # 状态管理
├── hooks/         # 自定义 Hooks
├── utils/         # 工具函数
└── types/         # 类型定义
```

## 原型项目规范

> 适用于 `docs/prototypes/module-XX/` 下的快速原型，不完全等同于生产前端代码。

- **版本声明**：`package.json` 的 `version` 必须与验证的 PRD 版本保持一致；`README.md` 顶部注明：
  - 验证的 PRD 版本
  - 覆盖的产品版本（如 MVP / v0.2 / v0.4 / v1.0）
  - 本地启动命令与访问地址
- **全局导航**：每个模块原型必须包含跨模块导航壳（Shell），至少提供以下入口的链接或占位：资源管理、监控策略、配置中心、指标查询、告警状态、系统设置。
- **版本占位页**：v0.2+ 功能以占位页或 disabled 菜单呈现，页面标题标注 `{v0.2}`、`{v0.4+}` 等阶段标签。
- **模式开关**：mock 数据中应包含 `Tenant.multi_site_enabled` 等租户级开关，以便一键演示单网域/多网域等模式差异。

## 编码规范

- 函数组件 + Hooks
- 组件文件 PascalCase：`TargetList.tsx`
- 工具文件 camelCase：`formatTime.ts`
- 每个页面一个目录
- 优先使用 TypeScript 严格模式

## API 调用

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

## 组件示例

```typescript
// src/pages/Targets/TargetList.tsx
import { useEffect, useState } from 'react';
import { listTargets } from '../../api/targets';

export function TargetList() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listTargets()
      .then(res => setTargets(res.data.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {targets.map(t => <li key={t.id}>{t.instance}</li>)}
    </ul>
  );
}
```

---

## Ant Design 组件测试稳定模式

> 适用于 `ui-custom/web` 的 Vitest + React Testing Library + jsdom 环境。目标：消除 antd 组件在 jsdom 下最常见的 flaky 问题，避免每个测试文件重复踩坑。

### 1. 必须使用 `src/test/antdTestUtils.tsx`

每个涉及 antd 组件的测试文件顶部导入：

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

    // 模拟用户点击「确定」
    const onOk = modal.confirm.mock.calls[0][0].onOk;
    await onOk?.();
  });
});
```

`setupAntdTest()` 会自动处理：
- `window.matchMedia` mock（响应式布局组件需要）
- `window.getComputedStyle` stub（antd Tooltip/Popover 需要）
- `window.scrollTo` stub
- `ResizeObserver` polyfill
- 每个用例后自动 cleanup

### 2. 异步断言优先使用 `findBy*` / `waitFor`

antd 的 `Select`、`Drawer`、`Modal`、`Table` 等组件存在过渡动画和异步渲染，禁止使用同步 `getBy*` 断言这些组件的内部元素。

```typescript
// ❌ 错误：可能因动画/异步渲染失败
expect(screen.getByText('选项 A')).toBeInTheDocument();

// ✅ 正确：等待元素出现
expect(await screen.findByText('选项 A')).toBeInTheDocument();
await waitFor(() => expect(screen.getByText('选项 A')).toBeInTheDocument());
```

### 3. Modal 静态方法统一 mock

`Modal.confirm`、`Modal.info`、`Modal.warning` 等静态方法在 jsdom 下会创建全局 DOM 节点，跨用例残留导致 flaky。统一使用 `mockAntdModal()`：

```typescript
const modal = mockAntdModal();
// ... 触发删除
expect(modal.confirm).toHaveBeenCalledWith(
  expect.objectContaining({ title: '确认删除' })
);
```

不要直接 `vi.spyOn(Modal, 'confirm')` 后又不 restore。

### 4. Select 组件交互模式

antd `Select` 下拉是 portal 渲染，必须：

1. 点击 Select 打开面板；
2. 使用 `await screen.findByText` 等待选项出现在 document.body；
3. 再点击选项。

```typescript
const select = screen.getByRole('combobox');
await userEvent.click(select);
const option = await screen.findByText('选项 A');
await userEvent.click(option);
```

禁止直接 `fireEvent.mouseDown(select)` 等 hack。

### 5. 用户事件必须使用 `userEvent.setup()`

```typescript
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: '提交' }));
```

不要直接使用 `userEvent.click(...)` 的旧用法。

### 6. 表单提交等待验证

antd `Form` 的 `validateFields` / `scrollToField` 是异步的，提交后必须等待：

```typescript
await user.click(screen.getByRole('button', { name: '提交' }));
await waitFor(() => {
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'foo' }));
});
```

### 7. 已知必须 mock 的全局 API

`setupAntdTest()` 已经覆盖，但如果某个测试还需要额外 stub，在测试文件里显式声明：

```typescript
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', vi.fn(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

### 8. flaky 测试处理原则

- 发现 flaky 后优先按本模式修根因；
- 若暂时无法根除，隔离到 `*.flaky.test.tsx` 或加显式 `// FLAKY:` 注释，并在 `docs/05-execution-records/module-XX/frontend-developer.md` 中挂账；
- 不得以「连续跑 2 次通过」作为常规验收标准。

### 9. 单文件测试命令

开发期每个任务只跑相关测试文件：

```bash
pnpm vitest run src/pages/resources/__tests__/ResourceFormDrawer.test.tsx
```

全量 `pnpm test` 仅在 Phase 收尾、合并前、CI 中执行。
