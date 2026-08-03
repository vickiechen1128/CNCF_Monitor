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
