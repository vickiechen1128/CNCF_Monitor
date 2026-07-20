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
