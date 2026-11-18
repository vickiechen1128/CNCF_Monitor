# Module 08 告警收敛与通知管理 — v3 重写现状评估

> **状态**：doing（B0 起草，待 owner 评审冻结）
> **分支**：`rewrite/v2.0`
> **里程碑**：v2.0-m3
> **schema_change**：breaking（新增 `00009_m08_alerting`；不复用 legacy `platform/models` 的 3 张告警表）
> **data_migration**：none（D7：v3 从空库 + seed 开始，不迁移旧 v2 数据）
> **API 版本**：v3（平台管理 `/api/v3/platform/alertmanager/*`；渲染桥 `/api/v3/platform/webhooks/*`；旧 `/api/v2/platform/alertmanager/*` 仅兼容窗口）
> **权威需求**：`docs/02-product-requirements/Modules/SRS/Module_08_Alertmanager_Notification_Management_Requirements.md` v1.3（评审通过后冻结）
> **历史参考**：`Module_08_Alertmanager_Notification_Management.md` v1.22（字段级技术 PRD）；冲突以 SRS 为准
> **关联决策**：D7 / D31 / D35 / D38 / D41 / D44 / D45 / D46 / D47 / D48（见 `docs/05-execution-records/rewrite/v2.0/decisions.md`）
> **更新日期**：2026-11-16

---

## 1. 结论摘要

1. **M08 此前从未进入 v2.0 重写**：`platform/modules/m08/` 不存在，v3 模块注册表只有 system/m06/m07/m01/m09/auth；M08 仍以 legacy `platform/alertmanager/*` 挂在 `/api/v2/platform/alertmanager/*`，plan.md 与 handover.md 均为 `todo`。
2. **legacy 做过 7 轮「功能重构」，但不是结构重写**：唯一生成规则收敛、渠道/模板/路由解耦、架构红线修复、事件表单一事实源、抑制独立等都在旧技术栈内完成，依赖 `platform/models` 全局模型 + `configcenter/draft/change` + SQLite `AutoMigrate`，不满足 v3 分层与 PG 目标。
3. **新建 `platform/modules/m08/`**，按 `domain / dto / repository / service / handler / references / apply / configgen` 分层；legacy `platform/alertmanager/*` 冻结保留，只服务 `/api/v2/*` 兼容窗口，**不在原包上做大改**。
4. **内部 Reload 子模块是本次唯一「从零建」的能力**：legacy 的写盘 + reload 在 M09（`configcenter/deployment.writeAlertmanagerAndReload`），且**无结果校验、无失败回退、无 reload 日志**；v3 按 FR-07 / D46 在 M08 内重建，并删除对 `configcenter` 的依赖。
5. **权限与数据口径随 v3 收敛**：配置历史只读不可回滚（删 `applied/discarded/applied_at` 两段式）；`route_tree` 随快照 JSON 持久化（D47）；事件表 `alert_events` 为唯一事实源并保留 180 天；快照由 M08 单份持久化，M09 统一历史只读引用（D31 经 D51 修订）。
6. **两项能力明确延后**：告警面板 `platform/app/biz` 三维聚合按 **D44** 延后（当前 Grafana 手工配置替代，M08 只留 `resource_category` 回填字段）；渠道密钥加密存储按 **D45** 承接至全局凭据加密改造，本模块只保证接口/日志零明文。

预计实施量：**后端 15–19 人日 + 前端 3–4 人日**（含抑制规则建表检索、静默留痕审计、手动重载；B6/B7 复用 legacy 逻辑越充分越接近下限；不含 M01/M07 资源链路与全局加密项）。

---

## 2. 需求画像（SRS v1.3）

| 维度 | 内容 |
|---|---|
| 功能域 | 配置管理 FR-01~08；渠道与模板 FR-09~12；路由 FR-13~15；静默 FR-16~17；抑制 FR-18~20；事件留痕与对账 FR-21~25；AM 代理兼容 FR-26 → **26 条** |
| 非功能 | 配置安全一致性 NFR-01~05；隔离与安全 NFR-06~08；性能与可用性 NFR-09~12 → **12 条** |
| 核心实体 | Route / InhibitionRule / NotifyChannel / NotifyTemplate / AlertmanagerConfigSnapshot / AlertmanagerReloadLog / Silence（运行时）/ AlertEvent |
| 关键流程 | 路由·抑制保存 + 内部 Reload；渠道模板变更；静默；事件写入与对账；告警查询 |
| 验收 | SRS §9（9.1 功能 15 条 / 9.2 非功能 8 条）→ 映射见 `acceptance.md` |

---

## 3. 现状盘点（legacy 基线）

### 3.1 代码规模

| 包 | 文件 | 非测试行 | 职责 | 主要问题 | v3 处理 |
|---|---|---|---|---|---|
| `alertmanager/alerts` | 3 | 366 | AM `/api/v2/alerts` 代理 + 四态归一 | 代理层直接拼 HTTP；无超时/重试策略 | 重写进 `m08/service` + `m08/references` |
| `alertmanager/config` | 5 | 694 | amtool 校验 + 版本留痕 + 触发 M09 | 依赖 `configcenter/{change,draft,generator}`、`domainregistry`；`applied/discarded` 两段式；无 reload 验证/回退/日志 | 拆为 `configgen`（生成）+ `apply`（reload）+ `service`（快照） |
| `alertmanager/history` | 5 | 1496 | webhook 留痕 + 分钟级对账 + 七态 + stats + 180 天清理 | 包级函数直传 `*gorm.DB`（`ListEvents`/`Ingest`/`PurgeExpired`），分层不彻底；模型在 `platform/models` | 重写进 `m08/service/event` + `m08/repository` |
| `alertmanager/inhibition` | 3 | 211 | 抑制规则 CRUD | 规则不落库，靠解析 `alertmanager.yml` 反推（与 route 同构问题） | 规则随快照 JSON 持久化（D-M08-02） |
| `alertmanager/notify` | 10 | 1783 | 渠道/模板 CRUD、渲染桥、SSRF、加签 | `NotifyChannel.Secret` 明文列；模板校验复用 config 包（跨包耦合） | 重写进 `m08/service/notify`，加密承接 D45 |
| `alertmanager/route` | 7 | 1330 | 路由树编辑、YAML 生成、`base_checksum` 乐观锁 | 树从 YAML 反推（`parse.go` 393 行），编辑态与生效态易漂移 | `route_tree` 随快照持久化（D47） |
| `alertmanager/silence` | 5 | 715 | AM 静默代理 + matcher 授权收敛 | 授权逻辑与 legacy `models.AuthorizedMatcherScope` 绑定 | 重写进 `m08/service/silence` + `m06` 授权端口 |
| `alertmanager/register.go` | 1 | 95 | 路由总装 | 单文件挂载全部子域，粒度粗 | 拆为 `m08/handler/routes.go` 分组注册 |

合计：**65 个 Go 文件 / 12,457 行（含测试），非测试 6,690 行**。前端 `ui-custom/web/src/pages/alerts/` 15 个 tsx / 5,434 行（非测试）+ 3 个 API 客户端。

### 3.2 质量热点

1. `route/parse.go`（393 行）：从 YAML 反推路由树，树的真源是「上一次生成的 YAML」→ 编辑与生效状态天然易漂移；且无法表达未被 AM 支持的中间态（如禁用节点）。
2. `history/handler.go`（510 行）：handler + 查询函数混排，`ListEvents(db, q)` 以包级函数形式接收 `*gorm.DB`，绕过 service 边界（违反 R1 分层）。
3. `config/service.go`（266 行）：`Submit` 既是校验入口又是 M09 流水线触发器（`triggerChangeDetection`），跨模块反向依赖，v3 必须切断。
4. `notify/channel.go`（343 行）：`Secret` 明文入库；仅靠视图层脱敏，DB 快照/备份即泄露。
5. 无 reload 观测面：写盘 + reload 失败仅返回错误，无记录、无回退，AM 可能处于「文件已换、进程未加载」的错位状态。

---

## 4. 新 SRS vs legacy 差异矩阵

| # | 能力 | legacy（v1.22） | SRS v1.3 | v3 处理 |
|---|---|---|---|---|
| 1 | 整份配置挂载 | 已收敛（v1.20 删导入/重挂/模式切换） | 彻底取消（NFR-02） | 保持；清理残留模型与 v2 端点 |
| 2 | 内部 Reload | 无（在 legacy M09 `DiskApplier`） | FR-07：原子写→reload→验证→日志→失败回退 | 新建 `m08/apply`，判据按 D46 |
| 3 | 配置快照同步 | 走 M09 变更单（draft/change） | FR-08：M08 单份持久化，M09 只读引用 | D51：不再调 `AlertmanagerSnapshotSink`；统一历史/导出由 M09 读 `scope=alertmanager` |
| 4 | 配置历史状态机 | `applied` / `discarded` + `applied_at` 回写 | FR-06 / NFR-04：只读、不可回滚 | 删两段式；current + 最近 N 份只读历史 |
| 5 | 路由树存储 | 从 YAML 反推 | FR-13：树形表单为唯一编辑入口 | `route_tree` 随快照 JSON 持久化（D47） |
| 6 | 抑制规则存储 | 从 YAML 反推 | FR-18：独立页面 CRUD | `inhibit_rules` 随快照 JSON 持久化（D-M08-02） |
| 7 | 事件表 | 已实现（`alert_events` + 对账 + 180 天） | FR-21~25：唯一事实源 | 迁入 m08 并重建 v3 表（`m08_alert_events`） |
| 8 | 当前/历史告警 | `alert-events` / `/current` / `/stats` | FR-23~25 同构 | 路径迁 v3，**字段与 stats 口径冻结**（M05 首页依赖） |
| 9 | 通知渠道 | CRUD + SSRF + 引用 409 | FR-09 同构 | 迁移；`Secret` 加密承接 D45 |
| 10 | 通知模板 | 可变实体、内置只读、绑定禁删 | FR-10 同构 | 迁移；校验内聚，不再复用 config 包 |
| 11 | 静默 | AM v2 代理 + matcher 授权 | FR-16/17 同构 | 迁移；授权端口改为 m06 引用 |
| 12 | AM 通知状态 | `/alerts` 四态代理 | FR-26：兼容保留 | 保留（读多写零），前端不作主视图 |
| 13 | API 前缀 | `/api/v2/platform/alertmanager/*` | D38：v3 前缀 | 全量重挂 + v2→v3 映射表 |
| 14 | 告警面板三维聚合 | 无 | **不在本模块**（D44 延后） | 仅保留 `resource_category` 回填字段 |

---

## 5. 重写范围与非目标

**在范围**：FR-01~26 / NFR-01~12（NFR-08 拆分承接，见下）；后端 m08 模块 + 前端 alerts 页切 v3；`00009` 迁移；M09 端口接线；事件对账与保留循环；reload 子模块。

**非目标 / 延后**：

| 项 | 处置 | 依据 |
|---|---|---|
| 告警面板 `platform/app/biz` 三维聚合 | **延后**（Grafana 手工配置替代），M08 不建聚合面板/端点 | D44 |
| 渠道密钥加密存储 | **承接全局凭据加密改造**（M01/M07/M08 一套），本模块只保证零明文 | D45 |
| 配置历史回滚 / 恢复 | 明确不做 | NFR-04 |
| 整份 YAML 导入 / 手写 route / 模式切换 | 明确不做 | NFR-02 |
| 边缘 Alertmanager 分发 | 不做（M09 仅留痕） | D31 |

**NFR-08 拆分口径**：本期验收 = 接口/列表/日志零明文 + 视图脱敏；「加密存储」一栏标记为 `deferred → D45`，在安全审查与 handover 已知问题中登记，不构成 M08 验收失败。

---

## 6. 目标结构

```text
platform/modules/m08/
├── module.go              # 装配（Options）+ RegisterRoutes / RegisterWebhookRoutes
├── domain/                # 实体、枚举、校验纯函数、状态机
├── dto/                   # 请求/响应 + {list,total,page,page_size}
├── repository/            # GORM + 双 dialect；m08_* 表；软删
├── service/               # snapshot / configgen / validate / notify / silence / inhibition / event / reconcile / reload
├── handler/               # 薄 handler；错误经 foundation/httpapi 统一映射
├── references/            # DomainAuthorizer(m06) / ResourceNamer(m07|m01)
└── apply/                 # 内部 Reload：原子写、reload、验证、回退、日志
```

表清单（`00009_m08_alerting`，`.sqlite.sql` / `.postgres.sql` 双份）：

| 表 | 用途 |
|---|---|
| `m08_notify_channels` | 通知渠道（`secret` 列本期明文 + 零明文暴露） |
| `m08_notify_templates` | 通知模板（内置只读 + 自定义） |
| `m08_config_snapshots` | 配置快照（`content` / `checksum` / `route_tree` JSON / `is_current`） |
| `m08_reload_logs` | Reload 记录（版本、时间、操作人、触发、状态、失败原因） |
| `m08_alert_events` | 告警事件（`occurrence_key` 唯一、七态、`resource_category`） |
| `m08_inhibition_rules` | 抑制规则（**独立表 + 检索分页**，D49；`builtin` 标记预置规则） |
| `m08_silence_audits` | 静默操作留痕（**含越权拒绝**，只读，D50） |

---

## 7. 决策引用与 B0 新增

**已定（decisions.md）**：D7（不迁移）、D31（M09 仅留痕）、D35（中心求值）、D38（v3 路径）、D41+D44（三维聚合延后）、D45（加密延后）、D46（reload 判据）、D47（route 树持久化）、D48（amtool 降级）。

**B0 拟新增（实现层，owner 已授权实现）**：

| 编号 | 决策 | 说明 |
|---|---|---|
| D-M08-01 | 中心域 ID 由装配注入 | `m08.Options.CenterDomainID`；启动与保存前校验该网域存在且 `status=enabled`（只读端口），为空/非法时**跳过** M09 快照同步并记 warn，不阻断保存（v3 无 `is_center` 标记，不按表派生） |
| D-M08-02 | ~~抑制规则随快照持久化~~ **已作废** | 被 **D49** 取代：抑制规则独立建表 + 检索分页 |
| D-M08-03 | 事件契约冻结 | `alert-events`、`alert-events/current`、`alert-events/stats` 字段与四指标口径在 v3 保持不变，仅前缀迁移；M05 首页消费方零改造 |
| D-M08-04 | CSV 导出留在前端 | 不新增服务端导出端点（沿用当前实现），分页拉取 + 前端拼装 |
| D-M08-05 | 迁移编号 `00009` | 7 张表 + 索引；`is_current` 部分唯一索引；`occurrence_key` 唯一；Up/Down 可逆 |
| D-M08-06 | 手动重载端点纳入首版 | `POST /alertmanager/config/reload`（admin）：用当前生效快照重跑 apply，不产生新版本，写 `trigger=manual` 日志 |
| D-M08-07 | 静默留痕纳入本期 | 见 **D50**：`m08_silence_audits` 只读，含越权拒绝；查询端点 `GET /silence-audits` |
| D-M08-08 | 行级校验错误提升共享 | `response.BadRequestWithDetails`（additive）；`03_API_Standard.md` §3 已同步 |

---

## 8. 依赖与风险

### 8.1 依赖就绪度

| 依赖 | 内容 | 状态 |
|---|---|---|
| M09 | 统一配置产物历史只读引用 `scope=alertmanager`（D51） | **已就绪**，M08 无需接线 |
| M06 | 网域授权集合（静默/抑制 matcher 作用域校验） | 就绪（m06 已 done），需 M08 定义 `DomainAuthorizer` 端口 |
| M07 / M01 | 资源台账（`resource_id` → 实例名 / `resource_category` 回填） | 表已就绪；M08 用只读 `ResourceNamer` 端口（不反向依赖） |
| M01 | 中心求值规则 → 告警产生 | doing，不阻塞 M08 B0–B5 |
| Alertmanager 二进制 | `amtool` 校验 / `/-/reload` / v2 API | 运维装配；缺失按 D48 降级 |

### 8.2 风险

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | SRS 仍为「初稿」 | G2 不通过，契约反复 | 本轮出 v1.3 评审稿，owner 确认后冻结 |
| R2 | Reload 验证语义依赖 AM 行为差异 | 回退判定误判 | D46 定死判据 + 可注入 fake；集成用例用真实 AM 跑一次 |
| R3 | `amtool` 版本与 AM 版本不一致 | 校验通过但 AM 加载失败 | D48 + B5 真实 reload 验证兜底（校验不是唯一门） |
| R4 | 事件表与 M05 首页强耦合 | 静默断链 | D-M08-03 冻结字段；B6 契约测试锁 stats 四指标 |
| R5 | 全局加密项长期不落地 | 安全测评卡 NFR-08 | D45 登记 handover 已知问题 + 发布门前置检查项 |
| R6 | legacy 冻结期间双写风险 | 新旧行为不一致 | v3-only 模式不挂 `/api/v2`；legacy 表不参与 v3 迁移 |

---

## 9. 估时

| 批次 | 人日 |
|---|---|
| B0 评估 + 契约 + 决策 | 1.5 |
| B1 迁移 00009（7 表） | 2.0 |
| B2 骨架 + 注册 | 1 |
| B3 渠道/模板 | 2 |
| B4 生成器 + 校验 | 3 |
| B5 内部 Reload + 手动重载 | 2.5 |
| B6 事件 + 对账 | 3 |
| B7 静默（含留痕）+ 抑制（含检索） | 2.5 |
| B8 M09 快照接线 | 0.5 |
| V1 验收/回归 | 1.5 |
| **后端小计** | **19.5（估 15–19，视 B6/B7 复用 legacy 程度）** |
| F1 前端切 v3 | 3–4 |

---

## 10. 下一步

1. owner 评审本评估 + SRS v1.3，冻结 `api-contract-snapshot-v3.md`。
2. 落 `backend-task-sequence.yaml`（B0–B8 / V1）并回填 `plan.md` 状态。
3. 进 B1：`00009` 迁移 + 迁移测试（Up/Down ×2）。
