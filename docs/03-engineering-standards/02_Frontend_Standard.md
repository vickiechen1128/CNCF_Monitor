# MetricCenter 前端开发标准

> 文档类型：工程标准
> **目标读者**：前端开发工程师（编码前必读）、技术架构师（前端技术选型 / 部署渠道）
> 目标：统一 Custom UI 的开发规范，确保前端代码可维护、可协作。
> 更新日期：2026-07-21（v1.25 去重）

---

## 1. 技术栈

| 项目 | 选择 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| UI 组件库 | Ant Design 5 |
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
VITE_API_BASE_URL=http://localhost:8080/api
```

开发期 MetricCenter Gateway 监听端口为 8080。

---

## 4. 包管理与 workspace 配置

### 4.1 pnpm v11 配置约束

本项目前端使用 **pnpm v11**。pnpm v11 要求：

1. 若存在 `pnpm-workspace.yaml`，**必须包含 `packages` 字段**，否则 `pnpm install` 会报错 `packages field missing or empty`。
2. pnpm v11 把构建脚本白名单从 `onlyBuiltDependencies` 数组改为 **`allowBuilds` 字典**，且 `.npmrc` 中除 auth/registry 外的大部分设置不再生效（详见 [pnpm 11.x settings](https://pnpm.io/11.x/settings)）。
3. `esbuild` 等原生依赖需要显式授权 postinstall 脚本。

单包项目（非 monorepo）的 `pnpm-workspace.yaml` 正确写法示例：

```yaml
packages:
  - '.'
allowBuilds:
  esbuild: true
```

**禁止**使用以下已废弃或无效写法：

```yaml
# 错误：缺少 packages 字段
allowBuilds:
  esbuild: true

# 错误：v11 已废弃 onlyBuiltDependencies
onlyBuiltDependencies:
  - esbuild

# 错误：.npmrc 里的 only-built-dependencies 在 v11 中不被读取
only-built-dependencies=esbuild
```

### 4.2 CI 环境

GitHub Actions 中使用 `pnpm install --frozen-lockfile`，不能执行交互式 `pnpm approve-builds`。因此必须在 `pnpm-workspace.yaml` 中静态声明 `allowBuilds`，否则 CI 会报 `ERR_PNPM_IGNORED_BUILDS`。

## 5. 部署渠道分工

前端存在两条预览/部署渠道，必须严格区分：

| 渠道 | 触发分支 | 用途 | 入口 |
|------|----------|------|------|
| GitHub Pages | `design/*`、`feature/prototype-*` | 产品经理/设计师预览原型 | `.github/workflows/deploy-prototype.yml`、`deploy-pages.yml` |
| Vercel | `feature/module-*`、`develop`、`main` | 开发工程师提交模块功能预览 | Vercel Git 集成 |

### 5.1 Vercel 忽略原型分支

为避免设计/原型分支触发 Vercel 构建，在 `vercel.json` 中配置 `ignoreCommand`：

```json
{
  "ignoreCommand": "if [[ \"$VERCEL_GIT_COMMIT_REF\" == design/* ]] || [[ \"$VERCEL_GIT_COMMIT_REF\" == feature/prototype-* ]]; then echo 'Skip prototype branch'; exit 0; else exit 1; fi"
}
```

规则：返回 `0` 跳过构建，返回 `1` 继续构建。`VERCEL_GIT_COMMIT_REF` 为当前分支名。

**Agent 必须遵守**：任何涉及 `design/*` 或 `feature/prototype-*` 分支的提交，不得让 Vercel 产生预览链接；原型预览统一走 GitHub Pages。

## 6. 提交前验证

> **v1.25 去重**：测试 / lint / dev server 启动验证的完整命令与流程见 [`04_Testing_Standard.md`](04_Testing_Standard.md) §4（前端部分）；本节仅保留要点提醒。

- 除 `pnpm test` 和 `pnpm lint` 外，必须验证前端 dev server 能实际启动并访问（`curl` 首页返回 200）；
- 如果模块新增/修改了页面，必须额外访问对应路由验证；
- 验证完成后必须停止服务，避免端口占用；
- 完整命令见 [`04_Testing_Standard.md`](04_Testing_Standard.md) §4.2。

## 7. 与 Prometheus UI 的关系

| 场景 | 方案 |
|------|------|
| 完全产品化门户 | 使用 `ui-custom/`，独立部署 |
| 小改 Prometheus UI | 在 `patches/prometheus/ui/` 中管理 patch |
| 调试原生功能 | 直接访问 `http://localhost:9090` |

**第一版推荐独立 `ui-custom/` 门户。**
