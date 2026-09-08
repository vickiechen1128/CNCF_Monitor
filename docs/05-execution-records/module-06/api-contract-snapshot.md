# API 契约快照 — Module 06 系统与平台管理（含多租户）

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。
>
> 模板：`docs/05-execution-records/_api-contract-snapshot.template.md`；决策 44 增量契约（认证细节 / 限流文案）另见 `docs/05-execution-records/module-06/track-b-increment-decision-44/api-contract-snapshot.md`（同源，冲突以本文件 + PRD v2.9 为准）。

## 0. 快照元信息

| 项 | 值 |
|----|----|
| Phase | Phase 1（MVP 子集：网域登记行政层）+ Track B（决策 44：轻量认证 / 租户 / 用户 / 登录日志） |
| 模块 | module-06-domain-registry |
| 分支 | feat/module-06-domain-registry |
| 版本 | v2026-09-05（新建 / 第 1 版，对齐 PRD v2.9） |
| 生成方式 | 按 PRD v2.9 §5/§6 重派生（planner 派生 → 复审：v2.4 DELETE users、v2.5/v2.6 `ip_cidrs` 纳入；v2.7~v2.9 为 §0 叙事层、无契约影响） |
| 来源 | PRD `Module_06_Multi_Tenant.md` v2.9 §1/§3/§5/§6/§8/§9/§11；`03_API_Standard.md` §7；`task-sequence.yaml`（顶层 Phase 1 + track-b-increment-decision-44） |

> **职责边界**：本快照只承载 M06 **行政面**契约（租户 / 网域行政字段 / 用户 / 登录日志 / zone-types 字典）。网域**监控纳管**字段与接口（`monitor` / `reset-token` / 运行态）归 Module_09 快照，不进入本文件；`NetworkDomain` 完整数据模型由 Module_09 §5.1 统一定义，本模块只维护行政字段。

## 1. 通用契约

### 1.1 前缀与响应

- 前缀：`/api/v2/platform`（PRD §6 表格即此前缀，无偏差；登录/登出/会话接口同前缀，归 Module_03 网关承接）
- 统一响应：`{status: success, data}` / `{status: error, errorType, error}`（`platform/api/response`）

### 1.2 errorType 枚举

`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict` / `too_many_requests`（登录限流 M-1，见 §3）

### 1.3 分页信封

| 接口 | 信封 | 默认/上限 |
|------|------|-----------|
| 全部列表（tenants / network-domains / users / login-logs） | `items` 键 | page 从 1；默认 page_size=20（M06 §11 各页「表格分页默认 20 条/页」），上限 100 |

> ⚠️ 前端必须按接口区分信封；空结果一律 `[]` 而非 `null`。

## 2. 路径偏差说明（PRD → 实际实现）

| PRD §6 原文 | 实际实现（前端消费） | 原因 |
|-------------|---------------------|------|
| （无前缀偏差）`/api/v2/platform/...` | 同左 | PRD §6 与已落地路由一致 |
| `POST /api/v2/platform/network-domains`（登记） | 登记请求体**不含** `tenant_id`（服务端固定登记归属 `platform_admin`），`id` 由服务端生成 | 网域为部署级资源，登记归属不可由客户端指定（§5.2/§6.2） |

## 3. 认证接口（Module_03 承接，跨模块消费契约）

> 详细错误文案 / 限流窗口见决策 44 增量快照 §1；本节仅列本模块前端消费所需契约。会话对象 = `{token, expires_at, user{id, username, display_name, tenant_id, role}}`。

| 方法 | 路径 | 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|--------|-----------|----------|--------|
| POST | `/auth/login` | `{username, password}` | `{token, expires_at, user{...role}}` | `unauthorized`：统一「用户名或密码错误」不区分原因（防账号枚举 M-2）；`too_many_requests`：同用户名连续失败 5 次/15 分钟窗口锁定 15 分钟（M-1） | Module_03 §4.0 |
| POST | `/auth/logout` | —（Header Bearer） | `null` | — | Module_03 §4.0 |
| GET | `/auth/me` | — | `{id, username, display_name, tenant_id, last_login_at}` | `unauthorized` | Module_03 §4.0 |
| PUT | `/auth/password` | `{old_password, new_password}` | `null`；改密后旧会话全部失效 | `bad_request`(新密码不合规) / `unauthorized`(旧密码错误) | Module_03 §4.0 |

> 初始管理员：`admin` 由后端 migration upsert 幂等预置（角色固定 `admin`）；初始密码 = 部署配置项（环境变量 `METRIC_CENTER_ADMIN_PASSWORD`，非生产缺省回退 `admin123`），首次登录引导改密。**H-1 生产模式拒绝弱默认**：`METRIC_CENTER_ENV=production` 且未显式配置 `METRIC_CENTER_ADMIN_PASSWORD` 时后端启动即失败终止。

## 4. 租户管理 API（MVP 落地单租户子集，决策 44）

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/tenants` | `status`（active/suspended/disabled，可选）、`page`、`page_size` | `{items:[Tenant], total}` | `forbidden`：非 `admin`（RequireAdmin 门 H-2） | §6.1 |
| GET | `/tenants/:id` | — | `{Tenant}` | `not_found` | §6.1 |
| PUT | `/tenants/:id` | `{name?, multi_site_enabled?}`（仅编辑展示名与行政开关） | 更新后 Tenant | `not_found`；`forbidden`：非 admin | §6.1 |
| POST | `/tenants` | —（**不开放**：MVP 唯一租户禁止新建，v0.2+ 契约预留） | 收到返回 `errorType=forbidden` | — | §6.1 |
| PATCH | `/tenants/:id/status` | —（**不开放**：唯一租户禁止禁用，v0.2+ 契约预留） | 收到返回 `errorType=forbidden` | — | §6.1 |

`Tenant` 字段（§5.1）：`id`(唯一) / `name` / `network_domain_ids[]`({v0.2} 被授权网域，授权≠拥有) / `multi_site_enabled`(bool) / `is_platform_admin`(标记平台预置租户；**不代表跨租户超级管理员**) / `status`(active/suspended/disabled) / `created_at` / `updated_at`。MVP 仅 `platform_admin` 单租户；`suspended` 为预留值无 MVP 操作入口。

## 5. 网域管理-行政字段 API（MVP 登记，决策 30/52 口径）

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/zone-types` | — | `[{code, display_name, description}]`（部署级启用中字典项） | — | §6.2 |
| GET | `/network-domains` | `tenant_id`、`zone_type`、`status`、`keyword`?、`page`、`page_size` | `{items:[NetworkDomain], total}` | `forbidden`：越权其他租户 | §6.2 |
| POST | `/network-domains` | 行政字段：`name`(必填)、`description?`、`domain_type`(management/edge)、`zone_type?`、`authorized_tenant_ids?`（缺省=登记归属租户回填 `platform_admin`）；**不含 `tenant_id`**（服务端固定登记归属 `platform_admin`）、**不含 `id`**（服务端生成 `<deploy_code>-<domain_code>`，`deploy_code` 来自部署配置/`METRIC_CENTER_DEPLOY_CODE`，默认 `mc`；`default` 为历史预置例外无前缀） | 创建后完整对象（含 `status=enabled`） | `bad_request`：必填缺失 / `zone_type` 非字典项；`conflict`：`id` 或 `name` 重复 | §6.2 |
| GET | `/network-domains/:id` | — | `{NetworkDomain}` | `not_found` | §6.2 |
| PUT | `/network-domains/:id` | `{name?, description?, zone_type?, authorized_tenant_ids?}`（**v0.3 起含 `ip_cidrs`**，决策 52）；**不含 `tenant_id`**（登记归属创建后不可变更，v0.2+ 调整走独立归属转移接口） | 更新后对象 | `not_found`；`bad_request` | §6.2 |
| PATCH | `/network-domains/:id/status` | `{status: enabled|disabled}` | 更新后对象；**禁用时返回影响范围**（该网域下 M07 资源数 / 已纳管 EdgeAgent 数，供前端二次确认弹窗） | `bad_request`：管理域（`default`）不可禁用；`forbidden`：非 admin | §6.2 |
| DELETE | `/network-domains/:id` | — | `{id}` | `bad_request`：管理域（`default`）禁止删除；`forbidden`：非空网域（有 M07 资源引用或有已纳管 EdgeAgent，拒绝并引导走「禁用」） | §6.2 |

**NetworkDomain 行政字段（§5.2，完整模型见 Module_09 §5.1）**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 全局唯一；`<deploy_code>-<domain_code>`（`default` 管理域无前缀） |
| name | string | ✅ | 展示名 |
| description | string | ❌ | 描述 |
| domain_type | enum | ✅ | `management`（如 default，禁止删除/禁用）/ `edge` |
| zone_type | string | ❌ | 网络区域语义分类；值集 = 部署级字典（`GET /zone-types`），不开放自由文本；v0.2+ K8s 场景字典增 `k8s` 项（划域指导原则：overlay CNI 集群独立建域，VPC 原生 CNI 并入所在 VM 网域） |
| ip_cidrs | []string | ❌ | **{v0.3}（决策 52/58，v2.5 引入后 v2.6 由 v0.2 后移 v0.3）**：网域覆盖 CIDR 列表，供 M07 资源导入/同步按 IP 推导归属；最长前缀优先、同前缀跨域冲突判「歧义」不猜测；可手工维护或由 M07「待分配队列」一键生成；纯平台侧数据不回写 CMDB；MVP 不启用（资源网域仍手动选择） |
| tenant_id | string | ✅ | 登记归属租户（部署级登记方，MVP 固定 `platform_admin`）；**创建后不可变更**；授权≠拥有 |
| authorized_tenant_ids | []string | ❌ | 被授权可使用该网域的租户列表（1:N 可跨租户共享）；缺省 = 登记归属租户；≠ 已纳管 |
| status | enum | ✅ | `enabled` / `disabled`（**禁用 = 冻结**：不再接受新资源登记/新纳管，存量资源与采集不受影响；是否停止采集由 M09 退纳管决定） |
| created_at / updated_at | datetime | ✅ | 技术字段 |

> **M07 消费说明**：M07 资源新增/编辑表单的网域下拉消费本接口时传 `status=enabled`——禁用/冻结网域不可作为新建资源归属。监控纳管字段（channel/agent_type/remote_write_url/center_endpoint/运行态）由 M09 维护，`GET /network-domains` 列表由 M09 侧合并返回（见 M09 快照）。

## 6. 用户管理 API（MVP，决策 44 CRUD + H-2 访问控制门）

> `RequireAdmin` 最小授权门（H-2）：管理后台接口（用户 / 租户 / 登录日志）仅 `role=admin` 可访问，非 admin 返回 403 `forbidden`。MVP 无业务权限点/数据隔离。

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/users` | `keyword`?、`status`?、`page`、`page_size` | `{items:[UserListItem], total}`；**任何字段不含 password_hash** | `forbidden`：非 admin | §6.3 |
| POST | `/users` | `{username, display_name, password, role?}`（初始密码创建者设定，bcrypt 落库） | 创建后完整对象 | `conflict`：username 全局唯一冲突；`bad_request`：密码不合规 / role 非法 | §6.3 |
| PUT | `/users/:id` | `{display_name?}`（`username` 创建后不可变更，请求含该字段视为 400） | 更新后对象 | `not_found`；`forbidden`：非 admin | §6.3 |
| PATCH | `/users/:id/status` | `{status: active|disabled}` | 更新后对象；禁用后无法登录且**已有会话立即失效** | `not_found`；`forbidden`：非 admin | §6.3 |
| PUT | `/users/:id/password` | `{new_password}`（管理员重置密码） | `null`；重置后该用户旧会话失效 | `not_found`；`bad_request`：密码不合规 | §6.3 |
| DELETE | `/users/:id` | — | `{id}` | `bad_request`：`role=admin` 账号不可删除（文案「admin 账号不可删除，请用禁用替代」，防误删唯一管理入口）；`not_found`；`forbidden`：非 admin | §6.3 |

> **删除用户（会话安全）**：删除 = **软删除普通用户（`role=user`）并立即失效其全部会话**（`DeletedAt` 软删 + `DeleteSessionsByUserID`）；`admin` 角色不提供删除（服务层 400）。前端：删除为二次确认破坏性操作；`admin` 账号不展示删除入口（FB-05）。

`User` 字段（§5.3）：`id` / `tenant_id`(MVP 固定 `platform_admin`) / `username`(全局唯一，不可变更) / `password_hash`(bcrypt，任何接口/日志不返回) / `role`(`admin`/`user`) / `display_name` / `status`(active/disabled) / `last_login_at`? / `created_at` / `updated_at`。列表项不含 `password_hash`。

## 7. 登录日志 API（MVP，决策 44）

| 方法 | 路径 | Query | 响应 data | PRD 源 |
|------|------|-------|-----------|--------|
| GET | `/login-logs` | `username`（可选）、`success`（可选）、`page`、`page_size` | `{items:[LoginLog], total}`，按时间倒序 | §5.4/6.3 |

`LoginLog` 字段：`{id, username, success(bool), ip, message?, created_at}`；`message` 一律入库统一文案（成功/失败区分见上，失败统一「用户名或密码错误」，防账号枚举 M-2）。

## 8. 数据模型状态机（行政态）

- **Tenant**：`active ⇄ suspended → disabled`（suspended 预留；仅可恢复 active）
- **NetworkDomain（行政态）**：`enabled → disabled`（禁用 = 冻结，不可再被纳管/接受新资源；可恢复 enabled）；监控纳管运行态归 Module_09
- **User**：`active ⇄ disabled`（disabled 无法登录 + 会话失效）
- **会话失效触发**：登出 / 改密 / 密码被重置 / 用户被禁用 / 用户被删除

## 9. 枚举字典

| 枚举 | 取值 | 说明 |
|------|------|------|
| `Tenant.status` | `active` / `suspended` / `disabled` | suspended MVP 无操作入口（预留） |
| `NetworkDomain.domain_type` | `management` / `edge` | 管理域（`default`）禁止删除与禁用 |
| `NetworkDomain.status` | `enabled` / `disabled` | 禁用=冻结（决策 30） |
| `zone_type` | 部署级字典（`GET /zone-types`） | 政务云分区 / 公有云 region / {v0.2+} `k8s` |
| `User.role` | `admin` / `user` | H-2 两级访问控制门；非业务角色体系 |
| `User.status` | `active` / `disabled` | |
| 登录日志 `success` | `true` / `false` | 失败文案统一「用户名或密码错误」（M-2） |

## 10. UI 展示名映射与页面契约（§11）

| 接口字段（snake_case） | UI 展示名 | 备注 |
|------------------------|-----------|------|
| 侧边栏二级导航 | 租户管理 / 网域管理 / 用户管理 / 登录日志 | §11.0 权威命名；审计日志 / 平台配置为 P2 **MVP 不占位** |
| `domain_type` | 域类型 | management=管理域 / edge=边缘域 |
| `zone_type` | 网络区域类型 | 下拉 = `GET /zone-types` |
| `status`（网域） | 状态 | 禁用 = 冻结；禁用前二次确认弹窗展示影响范围 |
| `tenant_id` | 登记归属 | 仅技术信息/部署级登记方 |
| `authorized_tenant_ids` | 授权租户 | 授权 ≠ 拥有 |
| `role` | 角色 | admin / user（两级门） |
| `collection_status` 相关 | （网域侧无此字段） | 采集状态属 M07 资源列表，非本模块 |

权限不足表现：页面级空态「当前账号无此页面查看权限」（`RequireAdmin` 403 兜底）。列表默认 20 条/页。

## 11. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` v2.9 §1/§3（心智原则与划域指导原则）/ §5（数据模型）/ §6（接口设计）/ §8（状态机）/ §9（验收）/ §11（前端交互契约）
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7
- 序列：`docs/05-execution-records/module-06/task-sequence.yaml`（Phase 1 网域登记）；`docs/05-execution-records/module-06/track-b-increment-decision-44/task-sequence.yaml`（决策 44 认证/租户/用户）
- 相关：`docs/05-execution-records/module-06/track-b-increment-decision-44/api-contract-snapshot.md`（决策 44 增量同源契约）；`docs/05-execution-records/module-09/api-contract-snapshot.md`（网域监控纳管面）
