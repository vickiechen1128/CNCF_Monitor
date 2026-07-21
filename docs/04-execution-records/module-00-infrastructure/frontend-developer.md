# Phase 0 - Frontend Developer 执行记录

> 日期：2026-07-21  
> 角色：Frontend Developer Agent  
> 分支：`feature/module-00-infrastructure`  
> Worktree：`/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree`

## 任务

完成 Phase 0 前端基础设施改造：适配后端新的统一响应格式、支持 `/api/v1` 与 `/api/v2/platform` 双前缀、补齐三类资源类型定义、建立 ESLint/Vitest 测试体系。

## 修改文件

### 业务代码

- **`ui-custom/web/src/types/api.ts`**
  - `ApiResponse<T>` 对齐新格式 `{ status, data, error?, errorType? }`。
  - 新增 `ApiErrorResponse` 类型别名。

- **`ui-custom/web/src/api/client.ts`**
  - `parseResponse` 优先读取后端 `status` 字段，HTTP 2xx 但 `status: 'error'` 时同样按错误处理。
  - `request` 在 `!res.ok || data.status === 'error'` 时抛出 `ApiError`。
  - `BASE_URL = ''`，由调用方传入完整前缀，同时支持 `/api/v1/*` 与 `/api/v2/platform/*`。
  - 新增 `isApiError` 类型守卫。

- **`ui-custom/web/src/types/resource.ts`**
  - `Host` 补充云主机完整字段（与 `assets/templates/excel/host_template.md` 及后端 `platform/models/host.go` 一致）。
  - `Middleware` 字段与后端 `platform/models/resource.go` 一致。
  - `Application` 字段与后端 `platform/models/resource.go` 一致。
  - 统一使用 snake_case 字段名以匹配后端 JSON。
  - 统一补充 `deleted_at?: string`，与后端 `BaseModel` 一致。

- **`ui-custom/web/src/pages/home/HomePage.tsx`**
  - 状态接口路径保持 `/api/v1/status`。
  - 显式判断 `res.status === 'success'` 后再使用 `res.data`。

### 基础设施与配置

为跑通 lint/test 必需：

- `ui-custom/web/package.json`
  - 新增 `test: vitest run` 脚本。
  - 新增 devDependencies：`eslint`、`typescript-eslint`、`@eslint/js`、`eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`、`globals`、`vitest`、`@testing-library/react`、`@testing-library/jest-dom`、`jsdom`。
- `ui-custom/web/eslint.config.js`（新增）—— flat config。
- `ui-custom/web/vitest.config.ts`（新增）。
- `ui-custom/web/src/setupTests.ts`（新增）。
- `ui-custom/web/.npmrc`（新增）—— 允许 esbuild 构建脚本。
- `ui-custom/web/pnpm-workspace.yaml` —— 修正原占位配置。
- `ui-custom/web/pnpm-lock.yaml` —— 随依赖安装更新。

### 新增测试

- `ui-custom/web/src/api/client.test.ts`
  - 覆盖成功响应、HTTP 200 但 `status: error`、非 2xx、非 JSON 响应、查询参数过滤、v1/v2 路径前缀保留。
- `ui-custom/web/src/pages/home/HomePage.test.tsx`
  - 覆盖正常渲染、API 返回 error 状态、请求异常三种场景。

## 测试结果

```bash
$ pnpm lint
# 通过，0 error / 0 warning

$ pnpm test
# 通过，2 test files / 9 tests passed

$ pnpm build
# 通过（额外验证）
```

## 已知问题

- Ant Design Spin 组件 `tip="加载中..."` 在测试中触发 antd stderr 警告（`tip only work in nest or fullscreen pattern`），不影响测试通过。
- 工作树中存在其他既有未提交改动（`go.mod`、`go.sum`、`ui-custom/web/src/App.tsx` 等），不在本次任务范围内，未做改动。
- esbuild 构建脚本授权：已通过 `pnpm-workspace.yaml` + `.npmrc` 处理；新环境首次 `pnpm install` 如仍提示 ignored builds，需执行 `pnpm approve-builds esbuild`。
