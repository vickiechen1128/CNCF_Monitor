# MetricCenter API 设计标准

> 文档类型：工程标准
> **目标读者**：后端开发工程师（API 实现必读）、前端开发工程师（API 对接必读）、技术架构师（路由规划 / 代理设计）
> 目标：统一 Gateway 对外 API 的风格，保持与 Prometheus 原生 API 的兼容性。
> 更新日期：2026-07-21

---

## 1. 总体原则

1. **兼容 Prometheus API**：查询类接口尽量复用 `/api/v1/*` 路径和返回格式
2. **新增能力使用 `/api/v2/platform/*`**：平台专属能力与 Prometheus 原生 API 区分
3. **统一返回格式**：所有接口返回 JSON，包含 `status`、`data`、`error` 字段

---

## 2. 路由规划

| 路径前缀 | 用途 |
|----------|------|
| `/api/v1/query` | PromQL 查询（代理到 Prometheus） |
| `/api/v1/query_range` | PromQL 范围查询（代理到 Prometheus） |
| `/api/v1/labels` | 获取 label names（代理到 Prometheus） |
| `/api/v1/label/:name/values` | 获取 label values（代理到 Prometheus） |
| `/api/v1/series` | 查询 series（代理到 Prometheus） |
| `/api/v2/platform/targets` | 采集目标管理 |
| `/api/v2/platform/discovery-sources` | 发现源管理 |
| `/api/v2/platform/tenants` | 租户管理 |
| `/api/v2/platform/users` | 用户管理 |
| `/api/v2/auth/login` | 登录 |
| `/api/v2/auth/logout` | 登出 |

---

## 3. 返回格式

### 成功响应

```json
{
  "status": "success",
  "data": {}
}
```

### 错误响应

```json
{
  "status": "error",
  "errorType": "bad_request",
  "error": "target instance is required"
}
```

### errorType 枚举

| errorType | HTTP 状态码 | 使用场景 |
|-----------|-------------|----------|
| `bad_request` | 400 | 请求参数校验失败 |
| `unauthorized` | 401 | 未认证或 Token 失效 |
| `forbidden` | 403 | 无权限访问 |
| `not_found` | 404 | 资源不存在 |
| `conflict` | 409 | 资源冲突（如重复创建） |
| `internal` | 500 | 服务器内部错误 |
| `bad_gateway` | 502 | 代理到 Prometheus 失败 |

---

## 4. 认证方式

开发期：Bearer Token 或 Session Cookie
生产期：对接企业 SSO / OAuth2

---

## 5. 多租户标识

- Header 传递：`X-Tenant-ID`
- 或从 JWT Token 中解析 tenant claim
- Gateway 负责将 tenant 注入查询或路由

---

## 6. Prometheus 代理说明

Gateway 对 Prometheus 的代理：

- 查询类接口直接透传
- 写类接口（如 target 管理）由 platform 自己实现
- 所有代理请求需经过认证和租户隔离处理
