---
name: api-standard
description: "MetricCenter API 契约与接口规范：路由前缀、响应信封、字段命名、分页、枚举、鉴权、SSRF 与契约优先原则"
---

# API 契约与接口规范

本 Skill 是前后端共同的 API 契约基线。实现或对接 API 前必须读取；与 PRD 冲突时按「契约优先级」处理，禁止自行猜测。

---

## 1. 契约优先级

| 场景 | 第一权威 | 第二权威 | 禁止 |
|------|----------|----------|------|
| 后端实现 | PRD 第 5/6 章 + `api-contract-snapshot.md` | `docs/03-engineering-standards/03_API_Standard.md` | 反向读取前端代码对齐字段 |
| 前端对接 | `api-contract-snapshot.md` | PRD 第 5/6 章 + `03_API_Standard.md` | 反向读取 `platform/models/*.go` 拉齐字段 |
| 快照缺失 | PRD 第 5/6 章 | `03_API_Standard.md` | 以对端实现为准 |

- 契约快照路径：`docs/05-execution-records/module-XX/api-contract-snapshot.md`
- 对端实现与契约不一致时，报告 Orchestrator 决策，禁止擅自改契约或照抄对端代码。
- 新增/修改接口必须同步更新契约快照；PRD 第 5/6 章、API 标准或后端模型变更后，旧快照作废。

### 1.1 增量/修复阶段的契约规则（PRD 滞后回填）

项目存在「代码先行、PRD 每周回填」的增量/修复阶段（任务卡标记 `mode: incremental`）。该阶段的分层口径：

| 变更类型 | `api-contract-snapshot.md` | PRD 章节 |
|----------|---------------------------|----------|
| 跨端契约变更（新增 / 修改路由、字段、枚举、响应结构、errorType） | **必须随代码同步更新** | 可滞后，由 chenrt 每周收割 commit + `dev-feedback.md` 统一回填 |
| 纯单端变更（仅前端 UI / 仅后端内部逻辑，不影响对端） | 无需更新 | 可滞后 |

- 快照是前后端对接的 as-built 事实，**不允许拖到 PRD 回填时一起补**。
- 已提交 PRD 的既有约定仍然有效；实现与 PRD 冲突时先报告 Orchestrator，不直接覆盖 PRD 意图。
- PRD 回填以快照 + `dev-feedback.md` + commit 信息为事实来源；回填后快照与 PRD 章节必须一致。

---

## 2. 路由规划

| 路径前缀 | 用途 | 说明 |
|----------|------|------|
| `/api/v1/query`、`/api/v1/query_range` | PromQL 查询 | 代理到 Prometheus，保持原生格式 |
| `/api/v1/labels`、`/api/v1/label/:name/values`、`/api/v1/series` | 元数据查询 | 代理到 Prometheus |
| `/api/v2/platform/*` | 平台业务能力 | 采集目标、发现源、租户、用户等 |
| `/api/v2/auth/*` | 认证 | 登录 / 登出 |

- 平台能力不得塞进 `/api/v1/*`；Prometheus 代理不得改写成平台信封以外的格式。
- 代理接口必须经过认证与租户隔离，禁止裸透传。

---

## 3. 响应信封

所有平台接口（成功 / 错误）统一通过 `platform/api/response` 封装。

成功：

```json
{
  "status": "success",
  "data": {}
}
```

错误：

```json
{
  "status": "error",
  "errorType": "bad_request",
  "error": "target instance is required"
}
```

`errorType` 枚举：

| errorType | HTTP | 场景 |
|-----------|------|------|
| `bad_request` | 400 | 参数校验失败、非法枚举值 |
| `unauthorized` | 401 | 未认证 / Token 失效 |
| `forbidden` | 403 | 无权限 |
| `not_found` | 404 | 资源不存在 |
| `conflict` | 409 | 资源冲突 / 重复创建 |
| `internal` | 500 | 服务器内部错误 |
| `bad_gateway` | 502 | 代理 Prometheus 失败 |

禁止裸返回、自定义信封、直接裸 HTTP 状态码或自定义错误码。

---

## 4. 字段与类型约定

- JSON 字段统一 **snake_case**；Go 结构体必须显式写 `json:"snake_case"` 标签。
- ID 字段统一以 `_id` 结尾（如 `tenant_id`）。
- 时间字段统一以 `_at` 结尾；HTTP 边界使用 **RFC3339** 字符串。
- 可空时间返回 `null` 或 RFC3339，禁止 Go 零值 `0001-01-01T00:00:00Z`。
- 枚举在 HTTP 层统一小写字符串（如 `"active"` / `"disabled"`），Go 使用 `type X string`。
- 枚举取值必须在 PRD 第 5 章或任务卡契约段穷举；写接口收到未定义值必须返回 `bad_request`，禁止静默接收。
- 字段契约以 PRD 字段表 + 契约快照为准；UI 展示名使用 PRD 字段表「UI 展示名」列，禁止把后端字段名直接当文案。

---

## 5. 分页

- 请求参数：`page` 从 1 开始；默认 `page_size=20`；上限 100（超出按 100 截断）。
- 响应放在 `data` 内：

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

- `total` 为全量总数，不是当前页条数。
- 平台业务接口统一 `page` / `page_size`；Prometheus `offset` 型透传仅限 `/api/v1/*`。

---

## 6. 认证与多租户

- 开发期：Bearer Token 或 Session Cookie；生产期对接企业 SSO / OAuth2。
- 租户标识：`X-Tenant-ID` Header，或从 JWT claim 解析。
- Gateway / 代理层负责注入租户并隔离查询范围。
- 所有写接口必须鉴权；配置下发、资源导入等核心写接口未鉴权视为 CRITICAL。

---

## 7. SSRF 与 URL 校验

- 仅允许 `http` / `https` scheme。
- host 必须非空；代理目标应走允许列表。
- 禁止把用户可控 URL 直接传给后端 HTTP 客户端。
- URL 解析 / 反向代理未校验 scheme 与 host 视为 HIGH（SSRF 风险）。

---

## 8. 兼容性与变更

- 已发布接口只做向后兼容的增量变更；删除/重命名字段必须走版本化或 CR。
- 新增字段必须可缺省，前端不得假定字段一定存在。
- 破坏性变更必须更新契约快照、PRD 第 6 章和 API 标准，并通知前后端。
- API 路径、响应信封、errorType 的变更属于跨端契约变更，必须由 Orchestrator 协调。

---

## 9. 提交前自检

- [ ] 路由前缀正确（`/api/v2/platform/*` 或 `/api/v1/*` 代理）
- [ ] 成功 / 错误响应均走 `platform/api/response`
- [ ] JSON 字段 snake_case 且有显式 tag
- [ ] 枚举小写字符串，写接口拒绝未定义值
- [ ] 分页结构符合 `list/total/page/page_size`
- [ ] 时间字段 RFC3339，可空时间返回 null
- [ ] 写接口有鉴权 / 租户隔离
- [ ] URL 仅允许 http/https 且校验 host
- [ ] 契约快照已同步更新
