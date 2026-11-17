# Module 08 API v3 契约快照（draft，待 G2 评审冻结）

> **状态**：draft（B0 起草，待 owner 评审）
> **分支**：`rewrite/v2.0`
> **前缀**：平台管理 `/api/v3/platform/alertmanager/*`；渲染桥 `/api/v3/platform/webhooks/*`
> **旧线**：`/api/v2/platform/alertmanager/*` 与 `/api/v1/webhooks/*` 仅在兼容窗口保留，v3-only 模式不挂载
> **上位文档**：`assessment.md`、`docs/03-engineering-standards/03_API_Standard.md`、M08 SRS v1.3
> **冲突处理**：与 SRS 冲突以 SRS 为准；与 API 标准冲突报 Orchestrator，禁止擅自改契约
> **更新日期**：2026-11-16

---

## 1. 通用约定

### 1.1 响应信封

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

`errorType` 取值：`bad_request` / `unauthorized` / `forbidden` / `not_found` / `conflict` /
`unavailable` / `internal` / `bad_gateway`。

**M08 扩展（行级校验错误，FR-04）**：`amtool` 校验失败时在错误信封上追加结构化 `data`，其余错误不带：

```json
{
  "status": "error",
  "errorType": "bad_request",
  "error": "第 12 行: receiver 'notify-9' not found",
  "data": {
    "validation": {
      "cause": "user_config",
      "note": "配置未保存，当前生效版本未被覆盖",
      "items": [{ "line": 12, "field": "route.receiver", "message": "receiver 'notify-9' not found" }]
    }
  }
}
```

- `cause`：`user_config`（用户可改）/ `platform_fault`（amtool 缺失等，用户不可修）。
- 实现方式：统一由共享 helper `response.BadRequestWithDetails` 输出（已提升至 `platform/api/response`，additive，不改现有签名）；`03_API_Standard.md` §3 已同步该扩展。

### 1.2 分页 / 时间 / 字段

- `page` 从 1 开始，默认 1；`page_size` 默认 20、上限 100（超出截断为 100）。
- 分页信封：`{ "list": [], "total": 0, "page": 1, "page_size": 20 }`。
- 时间：RFC3339（含时区）；空值返回 `null`，禁止 Go 零值。
- 字段：snake_case；ID 以 `_id` 结尾；对外 ID 一律字符串（`alert_events.id` 亦序列化为字符串）。

### 1.3 鉴权

| 面 | 鉴权 | 说明 |
|---|---|---|
| `/api/v3/platform/alertmanager/*` 读 | 全局 `AuthMiddleware` | 匿名 401 |
| 含凭据的读（`/config`、`/config/versions/:id`、`/config/reload-logs`） | 额外 `RequireAdmin` | 内容含 `basic_auth` / `bearer_token` / 加签密钥 |
| 审计读（`/silence-audits`） | 额外 `RequireAdmin` | 操作人 / 拒绝原因属审计数据，不对普通用户开放 |
| 写操作（路由、抑制、渠道、模板、静默创建/删除） | 额外 `RequireAdmin` | 非 admin 403 |
| `POST /api/v3/platform/webhooks/notify` | **无用户认证**（AM 回调） | 仅接受 `id=<渠道ID>`；挂 `auth.PublicPathPrefixes` |
| `POST /api/v3/platform/webhooks/alerts` | **无用户认证**（AM 回调） | 恒返回 2xx（FR-21） |

> 静默 matcher 的**网域作用域**在服务层校验（FR-17 / NFR-06），与 admin 与否无关：admin 也受授权网域集合约束。

### 1.4 路径映射原则

- 与 legacy 同构的端点**只改前缀**，字段与语义不变（尤其 `alert-events*`，M05 首页消费方零改造，D-M08-03）。
- 已删除的 legacy 端点（`/config/product`、`/config/edges`、导入/重挂/模式切换、`route-setting`）**不提供 v3 版本**。
- 原生 AM 语义路径（`/silences`、`/alerts`）保留同名，仅换前缀。

---

## 2. 端点总表

| # | 方法 + 路径（省略前缀 `/api/v3/platform`） | 鉴权 | FR | 说明 |
|---|---|---|---|---|
| 1 | `GET /alertmanager/config` | admin | FR-05 | 当前生效配置（content + checksum + 元信息） |
| 2 | `GET /alertmanager/config/versions` | 登录 | FR-06 | 只读历史列表（不含 content） |
| 3 | `GET /alertmanager/config/versions/:id` | admin | FR-06 | 历史版本详情（含 content） |
| 4 | `GET /alertmanager/config/reload-logs` | admin | FR-07 | Reload 记录（只读、倒序） |
| 5 | `GET /alertmanager/routes` | 登录 | FR-13 | 路由树视图 + `base_checksum` |
| 6 | `POST /alertmanager/routes` | admin | FR-02/13/14 | 保存路由树（生成→校验→快照→reload→同步 M09） |
| 7 | `GET /alertmanager/inhibitions`（`keyword` / `enabled` / `page` / `page_size`） | 登录 | FR-18 | 抑制规则**检索**：名称 + 匹配条件关键字 + 启停过滤 + 分页 |
| 8 | `POST /alertmanager/inhibitions` | admin | FR-18 | 新增抑制规则 |
| 9 | `PUT /alertmanager/inhibitions/:id` | admin | FR-18 | 编辑抑制规则 |
| 10 | `PATCH /alertmanager/inhibitions/:id/status` | admin | FR-18/19 | 启停（预置规则可启停不可删） |
| 11 | `DELETE /alertmanager/inhibitions/:id` | admin | FR-18/19 | 删除（预置规则 409） |
| 12 | `GET /alertmanager/notify-channels` | 登录 | FR-09 | 渠道列表（含引用计数，`secret` 永不返回） |
| 13 | `POST /alertmanager/notify-channels` | admin | FR-09 | 新建渠道（SSRF 校验） |
| 14 | `PUT /alertmanager/notify-channels/:id` | admin | FR-09 | 编辑渠道 |
| 15 | `DELETE /alertmanager/notify-channels/:id` | admin | FR-09 | 删除（被路由引用 → 409） |
| 16 | `GET /alertmanager/notify-templates` | 登录 | FR-10 | 模板列表（按 `channel_type` 筛选） |
| 17 | `GET /alertmanager/notify-templates/:id` | 登录 | FR-10 | 模板详情（含 content） |
| 18 | `POST /alertmanager/notify-templates` | admin | FR-10 | 新建模板 |
| 19 | `PUT /alertmanager/notify-templates/:id` | admin | FR-10 | 编辑（内置模板 → 403） |
| 20 | `DELETE /alertmanager/notify-templates/:id` | admin | FR-10 | 删除（被渠道绑定 → 409） |
| 21 | `GET /alertmanager/silences` | 登录 | FR-16 | 静默列表（代理 AM，按授权网域过滤） |
| 22 | `GET /alertmanager/silences/label-options` | 登录 | FR-16 | matcher 标签联想（本地聚合） |
| 23 | `POST /alertmanager/silences` | admin | FR-16/17 | 创建静默（网域授权校验） |
| 24 | `DELETE /alertmanager/silences/:silence_id` | admin | FR-16 | 删除静默（代理 AM v2） |
| 25 | `GET /alertmanager/alert-events` | 登录 | FR-24 | 历史告警分页查询 |
| 26 | `GET /alertmanager/alert-events/current` | 登录 | FR-23 | 当前告警（未结三态，不分页） |
| 27 | `GET /alertmanager/alert-events/stats` | 登录 | FR-23 | 首页统计四指标 + 未结分组计数 |
| 28 | `GET /alertmanager/alerts` | 登录 | FR-26 | AM 通知状态代理（四态，兼容保留） |
| 29 | `POST /webhooks/notify?id=<channel_id>` | 无（公开前缀） | FR-12 | 渲染桥：按渠道类型渲染并投递 |
| 30 | `POST /webhooks/alerts` | 无（公开前缀） | FR-21 | 内置留痕 webhook，恒 2xx |
| 31 | `POST /alertmanager/config/reload` | admin | FR-07 | 手动重载：用当前生效快照重跑 apply（不产生新版本） |
| 32 | `GET /alertmanager/silence-audits` | admin | FR-16 | 静默操作审计留痕查询（只读） |

> 无服务端 CSV 导出端点：历史告警导出由前端按当前筛选分页拉取后生成（D-M08-04）。

---

## 3. 关键契约

### 3.1 配置快照（#1–#4）

`GET /alertmanager/config` → `data`：

```json
{
  "id": "18",
  "checksum": "9f2a…",
  "content": "route:\n  receiver: default\n…",
  "route_tree": [{ "id": "root", "receiver": "default", "children": [] }],
  "inhibit_rules": [{ "name": "网域离线抑制", "enabled": true }],
  "generated_at": "2026-11-16T10:00:00+08:00",
  "generated_by": "chenrt",
  "reload": { "status": "succeeded", "at": "2026-11-16T10:00:01+08:00" }
}
```

- `route_tree` / `inhibit_rules` 为**快照内的持久化段**（D47 / D-M08-02），是编辑态的权威来源；`content` 是生成产物，只读。
- 历史列表项**不含** `content`（防泄露 + 体积）；详情含 `content`，但 `secret` 类字段一律掩码为 `***`。

`GET /alertmanager/config/reload-logs?page=&page_size=` → `data.list[]`：

```json
{
  "id": "7",
  "config_version": "20261116-0a1b",
  "status": "succeeded",            // succeeded | failed | rolled_back
  "trigger": "route_save",          // route_save | inhibition_save | manual | m09_sync
  "operator": "chenrt",
  "started_at": "2026-11-16T10:00:00+08:00",
  "finished_at": "2026-11-16T10:00:01+08:00",
  "duration_ms": 980,
  "error": ""
}
```

### 3.2 路由保存（#6，核心写链路）

请求：

```json
{
  "base_checksum": "9f2a…",
  "route_tree": [
    {
      "id": "root",
      "name": "根路由",
      "matchers": [],
      "receiver": "default",
      "group_by": ["alertname", "network_domain_id"],
      "group_wait": "30s",
      "group_interval": "5m",
      "repeat_interval": "4h",
      "continue": false,
      "enabled": true,
      "children": []
    }
  ]
}
```

matcher 支持可选 `is_equal`（缺省 `true`；`false` 渲染 `!=` / `!~`），供前端表达取反匹配。

响应 `data`：

```json
{
  "config_checksum": "b71c…",
  "config_version": "20261116-0f3d",
  "pending_sections": ["route_changed"],
  "reload": { "status": "succeeded", "duration_ms": 980 },
  "snapshot_synced": true
}
```

错误矩阵：

| HTTP | errorType | 触发 |
|---|---|---|
| 400 | `bad_request` | 结构非法 / matcher 标签名为空 / receiver 不可达 / 时长格式错误 |
| 400 + `data.validation` | `bad_request` | `amtool check-config` 失败（行级） |
| 409 | `conflict` | `base_checksum` 与当前生效版本不一致（FR-14），提示刷新重试 |
| 503 | `unavailable` | `amtool` 不可用（D48）或 reload 目标未配置（D46） |
| 502 | `bad_gateway` | reload 请求已发出但 AM 不可达 |

> 校验失败**不落库、不 reload、不覆盖当前生效文件**（NFR-05）。reload 失败时：回写上一生效配置 → 二次 reload → 记 `rolled_back` → 返回 502/503，响应 `data.reload.status = "rolled_back"`。

### 3.3 抑制规则（#7–#11）

```json
{
  "id": "3",
  "name": "网域离线抑制次生告警",
  "source_matchers": [{ "name": "alertname", "value": "NetworkDomainDown" }],
  "target_matchers": [{ "name": "inhibitable", "value": "true" }],
  "equal": ["network_domain_id"],
  "enabled": true,
  "builtin": true
}
```

- 保存语义：单条变更 → 与服务端现存规则集合并 → 整份重建 `alertmanager.yml`（保留当前路由段）→ 校验 → 快照 → reload（FR-20）。
- 规则**独立表**存储（`m08_inhibition_rules`，D49），不再从 `alertmanager.yml` 反推；检索参数：`keyword`（匹配名称与 matcher 值）、`enabled`，分页信封同 §1.2。
- 响应同 3.2，`pending_sections: ["inhibit_rules_changed"]`。
- `builtin=true` 的规则：允许 `PATCH status` 与 `PUT` 调整参数，`DELETE` → **409**（FR-19）。
- 显式清空：`DELETE` 全部非内置规则即等价于空数组语义。

### 3.4 通知渠道（#12–#15）

```json
{
  "id": "9",
  "name": "SRE 飞书群",
  "channel_type": "feishu",          // feishu | dingtalk | wecom | webhook
  "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/***",
  "sign_enabled": true,
  "secret_set": true,                 // 只回显「是否已配置」，永不返回 secret 原文
  "template_id": "2",                 // IM 类必填；webhook 类型必须为 null
  "receiver_name": "notify-9",
  "referenced_by_routes": 2
}
```

- 无 `enabled` 字段（FR-09）。
- `webhook_url` 做 SSRF 校验：默认拒绝私网 / 环回 / link-local / 云元数据；显式放行内网需管理员开关（NFR-07）。
- 删除被引用渠道 → **409**，`error` 含引用位置（路由节点名列表）。

### 3.5 通知模板（#16–#20）

```json
{
  "id": "2",
  "name": "飞书默认卡片",
  "channel_type": "feishu",
  "content": "{{ define \"feishu.card\" }}…{{ end }}",
  "builtin": false,
  "bound_channels": 3
}
```

- 内置模板：`PUT`/`DELETE` → 403 / 409；「复制」由前端「读取 content → POST 新建」完成，不新增端点。
- 模板为可变实体，**不进入** `alertmanager.yml`（FR-10）。

### 3.6 静默（#21–#24）

```json
{
  "id": "b3c1…",                       // AM silence ID
  "matchers": [{ "name": "network_domain_id", "value": "mc-a", "is_regex": false }],
  "starts_at": "2026-11-16T22:00:00+08:00",
  "ends_at": "2026-11-17T02:00:00+08:00",
  "created_by": "chenrt",
  "comment": "计划内数据库迁移",
  "status": "active"
}
```

- 创建时校验 matcher 中 `network_domain_id` 落在当前用户授权集合内，越权 → **403**（FR-17 / NFR-06）。
- 不进 reload 链路：直接代理 AM `/api/v2/silences` 与 `/api/v2/silence/:id`（DELETE）（FR-16）。
- AM 不可达 → **502** `bad_gateway`。

### 3.7 告警事件（#25–#27，字段冻结，D-M08-03）

`GET /alertmanager/alert-events` 查询参数：
`status`（单态：`firing`/`silenced`/`inhibited`/`resolved`/`silenced_closed`/`inhibited_closed`/`resolved_unknown`）、
`status_group=open`（未结三态，与 `status` 互斥）、`severity`、`alert_name`、`summary`、`description`、
`network_domain`、`starts_from`、`starts_to`、`ends_from`、`ends_to`、`sort`（`starts_at asc|desc`）、`page`、`page_size`。

列表项 `data.list[]`：

```json
{
  "id": "1024",
  "alert_name": "HostDown",
  "status": "firing",
  "severity": "critical",
  "summary": "主机不可达",
  "description": "…",
  "network_domain": "mc-a",
  "starts_at": "2026-11-16T09:00:00+08:00",
  "ends_at": null,
  "closed_at": null,
  "updated_at": "2026-11-16T09:05:00+08:00",
  "duration_seconds": null,
  "fingerprint": "ab12…",
  "labels": { "resource_id": "mc-a-host-01", "instance": "10.0.0.1:9100" },
  "annotations": { "summary": "…" },
  "instance_address": "10.0.0.1:9100",
  "instance_display": "host-01",
  "resource_id": "mc-a-host-01",
  "resource_name": "host-01",
  "resource_category": "host"
}
```

`/alert-events/current` → `{ "list": [...], "total": N }`（不分页，未结三态）。

`/alert-events/stats` →（字段名与 legacy 完全一致，冻结）：

```json
{
  "today_total": 12,
  "today_resolved_total": 5,
  "today_resolved_real": 4,
  "today_resolved_inferred": 1,
  "open_total": 7, "open_firing": 3, "open_silenced": 2, "open_inhibited": 2,
  "legacy_open_total": 9, "legacy_open_firing": 5,
  "legacy_open_silenced": 2, "legacy_open_inhibited": 2
}
```

> 四指标互斥口径（今日告警 / 今日告警今日恢复 / 历史遗留告警 / 历史遗留今日恢复）由既有实现冻结，M08 v3 不改口径，只迁前缀；M05 首页 `AlertStatusCard` 直接消费（见 §6.2）。

### 3.8 渲染桥（#29–#30）

`POST /webhooks/notify?id=<channel_id>`：AM 投递 → 按渠道类型取模板渲染 → 加签（如需）→ 投递。
- 仅接受 `id`；不接受 URL 参数（防 SSRF 绕过，与 legacy 一致）；未知 ID → 404；渲染失败 → 502。
- `POST /webhooks/alerts`：留痕入口，**任何情况返回 2xx**（FR-21），失败仅记日志与对账补偿。

### 3.9 手动重载（#31）

`POST /alertmanager/config/reload`（admin）——用**当前生效快照**重跑一次 apply，不产生新配置版本：

```json
{ "reload": { "status": "succeeded", "duration_ms": 870, "trigger": "manual" } }
```

- 用途：AM 重启后配置未回放、或运行态与磁盘文件漂移时的运维兜底；
- 错误矩阵同 §3.2：无生效配置 400 / 依赖未就绪 503 / AM 不可达 502；
- 每次调用写 `m08_reload_logs`（`trigger=manual`），失败同样走回退链路。

### 3.10 静默操作留痕（#32，D50）

每次静默创建 / 删除（**含越权被拒**）写 `m08_silence_audits`；管理员可查：

`GET /alertmanager/silence-audits?operator=&action=&silence_id=&from=&to=&page=&page_size=`

```json
{
  "id": "18",
  "action": "create",              // create | delete
  "result": "success",             // success | rejected
  "operator": "chenrt",
  "silence_id": "b3c1…",
  "matchers": [{ "name": "network_domain_id", "value": "mc-a", "is_regex": false }],
  "reason": "计划内数据库迁移",
  "failure_reason": "",
  "at": "2026-11-16T22:00:00+08:00"
}
```

- 留痕**只读**：无 PUT / DELETE 端点（NFR-04 同口径）；
- 越权拒绝也留痕（`result=rejected`，`failure_reason` 记拒绝原因），供审计追溯；
- 保留策略：随事件表 180 天（可配），仅清理超期行。

---

## 4. 枚举

| 枚举 | 取值 |
|---|---|
| `channel_type` | `feishu` / `dingtalk` / `wecom` / `webhook` |
| `alert_event.status` | 未结：`firing` / `silenced` / `inhibited`；终态：`resolved` / `silenced_closed` / `inhibited_closed` / `resolved_unknown` |
| `reload.status` | `succeeded` / `failed` / `rolled_back` |
| `reload.trigger` | `route_save` / `inhibition_save` / `manual` / `m09_sync` |
| `pending_sections` | `route_changed` / `inhibit_rules_changed` |
| `validation.cause` | `user_config` / `platform_fault` |

---

## 5. v2 → v3 映射

| legacy（v2） | v3 | 变化 |
|---|---|---|
| `GET /alertmanager/config/current` | `GET /alertmanager/config` | 改名；响应追加 `route_tree` / `inhibit_rules` |
| `GET /alertmanager/config/versions` | 同名 | 仅前缀 |
| `GET /alertmanager/config/versions/:id` | 同名 | 仅前缀 |
| `GET /alertmanager/config/product` | **删除** | 路由保存改为服务端内部合并，前端不再拉产品视图（NFR-02） |
| `GET /alertmanager/routes` | 同名 | 响应增 `base_checksum` 与完整树 |
| `POST /alertmanager/routes` | 同名 | 响应增 `config_version` / `pending_sections` / `reload` / `snapshot_synced` |
| `GET /alertmanager/inhibitions` | 同名 | 响应改为条目数组（含 `builtin` / `id`） |
| `POST /alertmanager/inhibitions` | 拆为 POST/PUT/DELETE/PATCH | 单条 CRUD + 启停（FR-18） |
| `GET /alertmanager/notify-channels` | 同名 | 仅前缀；`secret` 恒缺省 |
| `POST/PUT/DELETE /notify-channels*` | 同名 | 仅前缀 |
| `GET /alertmanager/notify-templates*` | 同名 | 仅前缀 |
| `GET /alertmanager/silences*` | 同名 | 仅前缀 |
| `GET /alertmanager/alert-events*` | 同名 | **字段冻结**，仅前缀（D-M08-03） |
| `GET /alertmanager/alerts` | 同名 | 仅前缀 |
| `POST /api/v1/webhooks/notify` | `POST /api/v3/platform/webhooks/notify` | 前缀（D38） |
| `POST /api/v1/webhooks/alerts` | `POST /api/v3/platform/webhooks/alerts` | 前缀（D38） |
| 导入 / 重挂 / 模式切换 / `route-setting` | **不提供** | v1.20 已删，v3 不复活 |

---

## 6. 跨模块契约

### 6.1 M09：快照留痕（D31）

- M08 在「校验通过 + 快照落库」后调用 `references.AlertmanagerSnapshotSink.SaveAlertmanagerSnapshot(ctx, domainID, content, checksum, generatedBy)`。
- `domainID` 取装配注入的 `Options.CenterDomainID`；启动时与每次保存前校验该网域**存在且 `status=enabled`**（经只读端口），为空或非法时**跳过**同步并记 warn，**不阻断**保存（D-M08-01）。v3 无 `is_center` 标记，故不按网域表派生（派生即猜测）。
- M09 只存只读历史、不切换 current、不扇出边缘；返回错误不影响 M08 保存结果，响应 `snapshot_synced=false`。

### 6.2 M05：首页告警卡（D-M08-03）

- 消费 `alert-events/stats` 与 `alert-events/current`；v3 字段完全兼容，M05 只改前缀。
- 契约变更（新增/删除字段）需先登记 decisions.md，禁止静默改。

### 6.3 M06：网域授权

- M08 定义 `references.DomainAuthorizer`：`AuthorizedDomains(ctx, actor) ([]string, bool, error)`；由装配注入 m06 实现（或 m06 暴露的读端口）。
- 静默 matcher、抑制规则 matcher 的 `network_domain_id` 必须落在授权集合内。

### 6.4 M07 / M01：实例名回填（FR-25）

- M08 定义 `references.ResourceNamer`：`GetMany(ctx, ids) (map[string]ResourceInfo, error)`，只读，不反向依赖。
- `resource_category` 随回填返回，作为 D41 后续聚合的载体字段（当前不建聚合）。

---

## 7. B0 评审项处置（已决）

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 行级校验 `data.validation` | **提升为共享** `response.BadRequestWithDetails`（additive），`03_API_Standard.md` §3 已同步 | D-M08-08（实现层自决） |
| 2 | `POST /config/reload` 手动重放 | **纳入首版**（#31）；复用 apply，不产生新版本，写 `trigger=manual` 日志 | D-M08-06（实现层自决） |
| 3 | 抑制规则存储 | **独立表** `m08_inhibition_rules` + 检索分页；B0 草案 D-M08-02 作废 | **D49（owner 确认）** |
| 4 | 静默操作留痕 | **纳入本期**：`m08_silence_audits` 记录创建/删除（含越权拒绝），只读；查询端点 #32 | **D50（owner 确认）** |
| 5 | `CenterDomainID` 取值 | **装配参数 + 存在性校验**；v3 无 `is_center` 标记，不按表派生 | D-M08-01（实现层自决） |
