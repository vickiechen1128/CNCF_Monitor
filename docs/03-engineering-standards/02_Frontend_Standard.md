# MetricCenter 前端开发标准

> 文档类型：工程标准
> 目标：统一 Custom UI 的开发规范，确保前端代码可维护、可协作。
> 更新日期：2026-07-16

---

## 1. 技术栈

| 项目 | 选择 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| UI 组件库 | Ant Design 5 / Mantine（待定，建议尽快确定） |
| 图表库 | ECharts |
| 状态管理 | Zustand 或 React Query |
| HTTP 客户端 | Axios |
| 路由 | React Router 6 |

---

## 2. 目录结构

```
ui-custom/web/
├── public/                  # 静态资源
├── src/
│   ├── api/                 # API 客户端与接口定义
│   │   ├── client.ts        # axios 实例
│   │   ├── targets.ts
│   │   ├── query.ts
│   │   └── auth.ts
│   ├── components/          # 通用组件
│   │   ├── Common/
│   │   └── Layout/
│   │       └── MainLayout.tsx
│   ├── pages/               # 页面组件
│   │   ├── Login/
│   │   ├── Dashboard/
│   │   ├── Targets/
│   │   ├── Query/
│   │   └── Settings/
│   ├── stores/              # 状态管理
│   ├── hooks/               # 自定义 Hooks
│   ├── utils/               # 工具函数
│   ├── types/               # 全局类型定义
│   └── main.tsx             # 入口
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .env.development
```

---

## 3. 开发规范

### 3.1 组件编写

- 使用函数组件 + Hooks
- 组件文件使用 PascalCase：`TargetList.tsx`
- 工具文件使用 camelCase：`formatTime.ts`
- 每个页面一个目录，包含页面组件和样式

### 3.2 API 调用

- 所有 API 调用通过 `src/api/client.ts` 中的 axios 实例
- API 函数按业务模块分文件：`targets.ts`、`query.ts`
- 统一处理认证错误（401 跳转登录）

### 3.3 类型定义

- 优先使用 TypeScript 严格模式
- 后端返回的数据结构必须定义 interface
- DTO 类型放在 `src/types/` 或对应 API 文件中

### 3.4 环境变量

```
VITE_API_BASE_URL=http://localhost:9091/api
```

开发期 Gateway 监听端口建议为 9091，避免与 Prometheus 9090 冲突。

---

## 4. 与 Prometheus UI 的关系

| 场景 | 方案 |
|------|------|
| 完全产品化门户 | 使用 `ui-custom/`，独立部署 |
| 小改 Prometheus UI | 在 `patches/prometheus/ui/` 中管理 patch |
| 调试原生功能 | 直接访问 `http://localhost:9090` |

**第一版推荐独立 `ui-custom/` 门户。**
