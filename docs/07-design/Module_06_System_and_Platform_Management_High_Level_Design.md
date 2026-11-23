# 系统与平台管理（含多租户） 概要设计

> **文档类型**：概要设计（High-Level Design, HLD）
> **目标读者**：后端/前端开发工程师、测试工程师、运维架构师、代码审查者
> **文档版本**：v1.0
> **状态**：draft
> **编写日期**：2026-11-22
> **修订日期**：2026-11-22
> **Domain ID**：`DOMAIN-SYS-MGMT`
> **实现模块**：`m06` / `foundation`（+ `ui-custom/web`）
> **需求基线**：[系统与平台管理（含多租户）SRS](../02-product-requirements/Modules/SRS/Module_06_Multi_Tenant_Requirements.md)（v1.4）
> **场景链接（唯一链接点）**：[Module_06_Scenario_Link.md](Module_06_Scenario_Link.md)
> **场景演示脚本**：`docs/05-execution-records/module-06/scenario-walkthrough.md`（待创建）
> **对外验收说明书**：`docs/07-design/Module_06_Acceptance.md`（待创建，派生，非追溯）
> **关联决策**：决策 44（两级角色 + RequireAdmin）、D28/D33（查询按授权网域集注入 `network_domain_id`）、D32（网域读接口归 M09）、D37（云字典只增维护）、决策 64（生产目录规范）

---

## 1. 引言

### 1.1 目的

本文档描述系统与平台管理的**架构级设计**：模块边界、接口清单、数据归属、关键流程、状态机、安全与性能约束，以及**能力清单**；完整“场景 ↔ 设计 ↔ 演示 ↔ 验收”见 [Scenario Link](Module_06_Scenario_Link.md)。

本文档**不展开**字段级契约、DTO、算法伪代码和页面组件细节：

- 接口字段以 `api-contract-snapshot-v3.md` 为准；
- 数据库列以 `platform/db/migrations/v3/*.postgres.sql` 为准；
- 页面交互以 `ui-custom/web/src/pages/admin/` 为准。

### 1.2 范围

**覆盖**：登录与会话、角色门、租户台账与网域授权、网域行政字段与生命周期、云字典、用户管理、登录日志、存储与日志管理。

**不覆盖**：网域纳管/心跳/配置下发/查询（M09）、监控对象台账（M07）、采集策略（M01）、告警（M08）。

### 1.3 参考

- [SRS](../02-product-requirements/Modules/SRS/Module_06_Multi_Tenant_Requirements.md)
- [Scenario Link](Module_06_Scenario_Link.md)
- [后端架构与债务控制](../03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md)
- `platform/modules/m06/`、`platform/gateway/auth/`、`platform/models/`

---

## 2. 设计概述

### 2.1 系统上下文

```
浏览器 ──► AuthMiddleware（全局 Bearer 校验）──► /api/v3/platform/*
                │                                   │
                │                                   ├─ M06：租户 / 用户 / 网域行政 / 云字典 / 存储
                │                                   ├─ M09：网域读视图 / 纳管 / 配置 / 查询
                │                                   └─ M07：资源台账
                ▼
          sessions / users / tenants（PostgreSQL）

M06 删除网域 ──(引用检查)──► M07 资源
             └─(级联清退)──► M09 纳管状态 / Agent Token
```

### 2.2 组件职责

| 组件 | 职责 |
|------|------|
| `gateway/auth` | 登录/登出/当前用户/改密、会话签发与校验、登录限流、`RequireAdmin` |
| `m06/handler` | 租户、网域行政、用户、登录日志、存储、云字典路由 |
| `m06/service` | 网域生命周期与级联、租户-网域授权、用户与会话失效、云字典、保留策略 |
| `m06/repository` | GORM 持久化（`tenants` / `users` / `sessions` / `login_logs` / `network_domains`） |
| `foundation` | 统一响应、错误语义、模块注册、health/ready |
| `ui-custom/web/pages/admin` | 网域、租户、用户、登录日志、存储与日志、云字典页面 |

### 2.3 代码结构

```
platform/modules/m06/
├── module.go                 # 依赖组装与路由挂载
├── handler/                  # tenant / network_domain / user / login_log / storage / cloud_dict
├── service/                  # 同名服务 + 网域级联清退
├── repository/               # GORM 仓储
├── dto/                      # 请求/响应（含 cascade_impact / impact）
└── domain/                   # 状态、错误类型、不变量

platform/gateway/auth/        # 认证与会话（M03 重写前的过渡适配器）
```

### 2.4 前端信息架构

| 顺序 | 一级 | 二级页面 | 路由 |
|------|------|----------|------|
| 1 | 系统与平台管理 | 网域管理 | `/admin/domains` |
| 2 | 系统与平台管理 | 租户管理 | `/admin/tenants` |
| 3 | 系统与平台管理 | 用户管理 | `/admin/users` |
| 4 | 系统与平台管理 | 登录日志 | `/admin/login-logs` |
| 5 | 系统与平台管理 | 存储与日志 | `/admin/storage-logs` |
| 6 | 系统与平台管理 | 云字典 | `/admin/cloud-dict` |

### 2.5 能力清单

> 能力（CAP）是技术内部的复用抽象，不要求需求方理解；完整「场景 → 实现」映射见 [Module_06_Scenario_Link.md](Module_06_Scenario_Link.md)（唯一链接点），本文不维护第二份追溯表。

| CAP | 意图 | 实现模块 | 扩展点 |
|-----|------|----------|--------|
| CAP-AUTH-SESSION | 登录、会话、限流、改密、登出失效 | foundation / auth | 不透明 Token + 12h TTL |
| CAP-AUTHZ | 两级角色门（admin/user） | foundation | `RequireAdmin` 中间件 |
| CAP-TENANT | 租户台账、状态、多网域开关 | m06 | `tenants` 表 |
| CAP-DOMAIN-ADMIN | 网域行政字段、登记/编辑/禁用/删除 | m06 | 行政写接口（读视图归 M09） |
| CAP-DOMAIN-RETIRE | 引用检查 + 级联清退 Token/纳管 | m06 → m07/m09 | 同请求级联 |
| CAP-CLOUD-DICT | 云字典只增维护与停用保护 | m06 | 复合码校验 |
| CAP-STORAGE | TSDB 保留策略读写与生效提示 | m06 | `prom-retention.env` |
| CAP-UI-ADMIN | 管理后台页面 | ui-custom/web | 菜单/路由 |

> 本轮无新建能力；全部复用现有 `m06` / `foundation` 能力。若后续需要新建，必须在本文件说明为什么不能复用/扩展。

---

## 3. 约束与关键决策

| # | 决策 | 理由 / 影响 |
|---|------|-------------|
| 1 | MVP 仅两级角色（admin / user） | 不做权限点体系；管理接口统一 `RequireAdmin` |
| 2 | 网域读视图归 M09，写与影响读归 M06 | D32：列表/详情由 M09 提供富化视图，避免两套读口径 |
| 3 | 网域编码与登记归属创建后不可变 | 避免历史数据与资源引用漂移；变更走新建 + 迁移 |
| 4 | 网域删除 = 引用检查 + 级联清退 | 有 M07 引用硬拒绝；无引用软删并废止 Token、停止下发 |
| 5 | 下发通道由域类型派生 | `ChannelForDomainType`：管理域↔local，边缘域↔agent_pull |
| 6 | 云字典只增不改不删 | 已引用编码必须稳定；停用受引用检查保护 |
| 7 | 保留策略只写配置、不越权重启 | 避免管理面直接操作数据面进程 |
| 8 | 删除用户 / 网域为软删 | 保留审计与追溯 |

> **未决口径（需 owner 决策）**：SRS v1.3 主张取消 `management`（中心直连域）与预置 `default` 管理域，但当前实现仍保留 `domain_type=management`、`default` 预置域与 `local` 通道（见 `platform/models/network_domain.go::ChannelForDomainType`）。本文按**实现事实**描述；差异登记在 Scenario Link 未决问题 #1，决策后同步修订 SRS/HLD/代码。

---

## 4. 接口清单

### 4.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v3/platform/auth/login` | 用户名密码登录；失败限流；返回 token、用户、`tenant_id`、`role` |
| POST | `/api/v3/platform/auth/logout` | 登出并失效当前会话 |
| GET | `/api/v3/platform/auth/me` | 当前用户与租户上下文 |
| PUT | `/api/v3/platform/auth/password` | 修改密码；旧会话全部失效 |

全局 `AuthMiddleware` 对 `/api/*` 生效，豁免登录、health/ready/meta 与公开 edge 前缀。

### 4.2 管理 API（均需 admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/tenants` | 租户列表/创建 |
| GET/PUT | `/tenants/:id` | 租户详情/编辑 |
| PATCH | `/tenants/:id/status` | 租户状态变更 |
| GET | `/network-domains/:id/impact` | 网域影响读（非 admin 也可读，需登录） |
| POST/PUT | `/network-domains`、`/network-domains/:id` | 网域登记/编辑（行政字段） |
| PATCH | `/network-domains/:id/status` | 启用/禁用 |
| DELETE | `/network-domains/:id` | 软删 + 级联清退（返回 `cascade_impact`） |
| GET/POST | `/users` | 用户列表/创建 |
| PUT | `/users/:id` | 编辑用户 |
| PATCH | `/users/:id/status` | 启用/禁用 |
| PUT | `/users/:id/password` | 重置密码 |
| DELETE | `/users/:id` | 删除普通用户并失效会话 |
| GET | `/login-logs` | 登录日志（账号/结果/时间筛选） |
| POST | `/cloud-dict` | 云字典新增 |
| PUT | `/cloud-dict/:cloud_code` | 云字典停用（不允许改码/删除） |
| GET | `/storage-logs` | 存储概览（磁盘、日志轮转、期望值/运行时） |
| PUT | `/storage-logs/retention` | 更新保留策略并原子写 `prom-retention.env` |

> **边界**：`GET /network-domains`、`GET /network-domains/:id` 由 M09 提供富化读视图（D32）。

---

## 5. 数据设计

### 5.1 表与归属

| 表 | 归属 | 说明 |
|----|------|------|
| `tenants` | M06 | ID、名称、`network_domain_ids`、`multi_site_enabled`、状态、软删 |
| `users` | M06 | 用户名唯一、bcrypt 哈希、角色、租户、状态、软删 |
| `sessions` | M06 / auth | 不透明 Token（唯一索引）、用户、过期时间 |
| `login_logs` | M06 | 账号、成败、IP、失败原因、时间 |
| `network_domains` | M06 行政 + M09 监控同表 | 行政字段：名称、`domain_type`、`cloud_code`、`tenant_id`、授权租户、CIDR、状态；M09 字段：`channel`、`token`、`center_endpoint`、心跳、纳管状态等 |

### 5.2 保留与生命周期

- 租户、用户、网域删除均为软删；会话在登出、改密、用户禁用/删除时立即失效。
- 网域删除进入终态 `retired`（纳管状态），供审计；Token 明文不落响应，仅脱敏展示。
- 登录日志按时间保留，不随用户删除而清除。

### 5.3 编码规则

- 网域 ID 按 `<deploy_code>-<domain_code>` 生成，`default` 为历史例外。
- 租户 ID、`cloud_code`、网域 ID 创建后不可变更；展示名可改。
- 云编码采用 `{类型}-{载体}` 复合码（如 `PUB-TX`、`GM-CU`），全局唯一。

---

## 6. 关键设计

### 6.1 认证与会话

- 密码 bcrypt 校验；登录失败按用户名计数，5 次 / 15 分钟窗口触发 15 分钟锁定，返回 429。
- 失败原因统一为「用户名或密码错误」，不区分账号不存在/禁用/密码错误。
- 会话为服务端不透明 Token，TTL 12h；登出、改密、禁用用户即批量失效。

### 6.2 角色门

- `RequireAdmin` 读取认证上下文中的角色；非 admin 返回 403。
- 网域 `impact` 读接口不挂 admin 门，仅要求登录，便于普通用户预览影响。

### 6.3 租户与网域授权

- 租户通过 `network_domain_ids` 记录被授权网域；网域通过 `authorized_tenant_ids` 记录被授权租户，两侧保持一致。
- 授权 ≠ 拥有：网域登记归属 `tenant_id` 不变。
- M09 查询按当前租户解析授权网域集并注入 `network_domain_id` 约束，不注入 `tenant` 标签。

### 6.4 网域生命周期与级联

- **禁用**：行政冻结，拒绝新资源与新纳管，存量采集继续。
- **删除**：先查 M07 资源引用，有引用返回 409 + 清单；无引用软删，并在同一次请求内级联清退 M09 纳管状态（废止 Token、停止下发、Agent 转离线）。
- 删除响应带 `cascade_impact`：`edge_agent_count` 与最多 10 条 `will_retire_agents`。
- 网域名称大小写不敏感唯一；重名返回 409。
- `management` 域仅系统预置，普通登记 API 不允许创建。

### 6.5 云字典

- 仅支持新增与停用；禁止改码与删除；停用时校验网域引用，被引用返回 409。
- 新增校验复合码格式与全局唯一；M07 只读消费启用条目。

### 6.6 存储与日志

- 读取磁盘占用、日志轮转与保留策略期望值/运行时值。
- 保存保留策略时校验格式并原子写入 `prom-retention.env`，返回「待重启生效」提示；不提供重启按钮。

---

## 7. 关键流程

### 7.1 登录

用户名密码 → 限流检查 → bcrypt 校验 → 签发会话 → 写登录日志 → 返回 token/用户/租户/角色。

### 7.2 网域登记

填写行政字段 → 校验云编码/名称唯一/ID 规则 → 生成 ID 与通道 → 保存 → 返回接入引导（复制 Token、安装采集节点、跳转 M09）。

### 7.3 网域禁用/删除

选择动作 → 查看影响（资源引用数、Agent 数、将退役名单）→ 二次确认 → 禁用只改状态；删除执行引用检查 + 软删 + 级联清退。

### 7.4 用户生命周期

创建（用户名唯一、初始密码、角色）→ 登录 → 禁用/删除（失效全部会话）→ 登录日志留痕；`admin` 不可删除，仅可禁用。

### 7.5 保留策略更新

编辑 → 格式校验 → 原子写 `prom-retention.env` → 回显期望值/运行时 → 运维窗口重启生效。

---

## 8. 状态机

### 8.1 网域

```
行政状态：enabled ⇄ disabled
纳管状态：created ──► monitored ──► retired
运行态：  online / offline / unknown（心跳派生）
```

### 8.2 租户

```
active ⇄ suspended
   └──► disabled（软删终态）
```

### 8.3 用户与会话

```
用户：active ⇄ disabled ──► 删除（软删，仅 user 角色）
会话：签发 ──► 过期 / 登出 / 改密 / 用户禁用 → 失效
```

---

## 9. 安全

- 密码 bcrypt 存储；接口与日志不返回明文或哈希。
- 生产环境未配置 `METRIC_CENTER_ADMIN_PASSWORD` 时启动失败（需求口径；实现以部署环境校验为准）。
- 登录失败限流防暴力破解与账号枚举；登录日志记录成败与 IP。
- 网域 Token 仅服务端存取，列表/详情仅返回脱敏值；明文只在首次纳管或重置时展示一次。
- 管理接口统一 `RequireAdmin`；网域 `impact` 仅登录态可读。
- 编码不可变，防止历史数据语义漂移。

---

## 10. 性能与容量

| 项 | 目标 | 设计手段 |
|----|------|----------|
| 租户/网域/用户/日志列表首屏 | ≤ 1s（P95） | 分页 + 索引；避免 N+1 |
| 分页/筛选 | ≤ 500ms | 后端筛选后分页 |
| 网域影响读 | 单次聚合 | 资源计数 + Agent 快照汇总 |
| 登录 | 快速失败 | 内存限流表 + bcrypt 校验 |

---

## 11. 可观测性与运维

- 登录成败、用户/租户/网域变更、云字典动作均有日志或审计留痕。
- 网域删除级联清退结果在响应中返回，便于运维核对。
- 保留策略写入结果可回显；生效依赖人工重启，需在变更说明中提示影响（查询短暂不可用、队列补发不丢数据）。
- `/api/v3/platform/health` 与 `/ready` 提供存活与 DB/迁移就绪状态。

---

## 12. 测试与验证

> 本节只写测试策略与覆盖范围；测试清单与执行证据见 acceptance / walkthrough，不在本文复制。

- 单元：登录限流、bcrypt、会话失效、用户名/网域名唯一、网域状态流转、引用拒绝、云编码格式、保留策略格式。
- 集成：登录 → 访问管理接口（admin/user）；网域删除级联清退；用户删除失效会话；云字典停用引用保护。
- E2E/场景：按 SCN-01~05 走查。
- 迁移/回滚：`platform_admin` 与初始 admin 幂等 upsert；软删数据不影响历史查询。

---

## 13. 场景链接

场景与实现的完整映射见 [Module_06_Scenario_Link.md](Module_06_Scenario_Link.md) §2（本文不维护）；NFR 覆盖与未决问题见同文档 §3 / §5。

---

## 14. 附录

### A. 路由速查

见 §4；完整注册代码见 `platform/modules/m06/handler/routes.go` 与 `platform/gateway/auth/handler.go`。

### B. 错误语义

| 场景 | 语义 |
|------|------|
| 用户名/网域名重复 | 409 + 冲突字段 |
| 删除最后一个 admin / 删除 admin | 409 / 400 + 可执行提示 |
| 删除有 M07 引用的网域 | 409 + 引用清单 |
| 云编码重复 / 被引用停用 | 409 |
| 未登录访问 | 401 |
| 普通用户访问管理接口 | 403 |
| 登录连续失败 | 429 |

---

## 15. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-11-22 | 首版：按 M09 形态建立 M06 概要设计；覆盖认证/角色门/租户/网域行政与级联/云字典/存储；网域读归 M09 的边界；登记 management/default 口径未决问题 |
