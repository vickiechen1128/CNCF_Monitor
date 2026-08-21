# MetricCenter API 设计标准

> 文档类型：工程标准
> **目标读者**：后端开发工程师（API 实现必读）、前端开发工程师（API 对接必读）、技术架构师（路由规划 / 代理设计）
> 目标：统一 Gateway 对外 API 的风格，保持与 Prometheus 原生 API 的兼容性。
> 更新日期：2026-08-20

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

---

## 7. 字段与类型约定

> **v1.27 起（契约优先 / Contract-First）**：本节为前端类型定义与后端 API 实现的**共同权威约定**，两端必须同时遵守，禁止仅在单侧约定、由对端推断。

### 7.1 JSON 字段命名

- 所有 JSON 字段统一 **snake_case**（如 `target_id`、`instance_selection_mode`），Go 结构体必须显式写 `json:"snake_case"` 标签。
- ID 字段统一以 `_id` 结尾（如 `tenant_id`、`biz_code` 为字典主键，遵循 PRD 第 5 章字段表）。

### 7.2 列表 / 分页响应结构

- 分页请求参数：`page` 从 **1** 开始；默认 `page_size=20`；上限 `page_size=100`（超过按 100 截断）。
- 分页响应统一放在信封 `data` 内：

```json
{
  "status": "success",
  "data": {
    "list": [],
    "total": 0,
    "page": 1,
    "page_size": 20
  }
}
```

- `total` 为**全量总数**（非当前页条数），用于前端分页器。
- 平台业务接口统一使用 `page` / `page_size` 型分页；Prometheus `offset` 型透传仅限 `/api/v1/*` 代理。

### 7.3 时间格式

- API 请求 / 响应边界时间统一 **RFC3339** 字符串（如 `2026-08-20T10:30:00Z`），数据库内部允许 Unix 秒，但 HTTP 边界一律 RFC3339。
- 时间字段命名统一以 `_at` 结尾（如 `created_at`、`updated_at`）。
- **可空时间字段（如 `deleted_at`）**：值为 `null` 或 RFC3339 字符串，**禁止返回 Go 零值 `0001-01-01T00:00:00Z`**——两端须约定可空时间一律用指针 / 可空类型。

### 7.4 枚举序列化与写端校验

- HTTP 层枚举统一**小写字符串**（如 `"active"` / `"disabled"`），Go 端用 `type X string` 而非 int。
- 枚举的**取值集合必须在 PRD 第 5 章（数据模型）或任务卡契约段穷举**。
- **写接口校验**：收到未在契约中定义的枚举值，必须返回 `bad_request`，禁止静默接收或自行补齐——避免从写端混入不合法值。
- 未知枚举不要求兼容转发（不存在"尽量宽松"），契约未列的取值视为非法。

---

## 8. 遗留项（TODO）

- **[v0.2+ / 待并行开发推开] 端到端联调冒烟**：合并到 `develop` 前，前端 `VITE_API_BASE_URL` 指向本地真实后端跑一遍关键页面，兜住"各自都对、联调不通"。MVP 阶段暂缓（成本大于收益），`vercel.json` 已预留 `VITE_API_BASE_URL` 支持，升级成本低。
- **[待 planner 角色落地] task-sequence.yaml 契约模板固化**：当前 `契约:` 段仅在 orchestrator.md 任务卡中生效；等首个模块产出真实 `task-sequence.yaml` 后再固化 yaml 模板字段，避免设计无人使用的格式。
