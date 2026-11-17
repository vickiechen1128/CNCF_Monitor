# Module 08 后端重写执行记录（B1–B8）

> **状态**：done（后端 B1–B8 完成；前端 F1 未开始）
> **分支**：`rewrite/v2.0`
> **执行日期**：2026-11-16
> **权威需求**：M08 SRS v1.4
> **契约**：`api-contract-snapshot-v3.md`（32 端点）
> **任务序列**：`backend-task-sequence.yaml`（34 任务）

---

## 1. 交付物

```text
platform/db/migrations/v3/
├── 00009_m08_alerting.sqlite.sql      # 7 张表 + 索引（SQLite）
└── 00009_m08_alerting.postgres.sql    # BIGSERIAL + jsonb（PostgreSQL）

platform/db/m08_migration_test.go      # Up/Down + 约束断言

platform/modules/m08/
├── module.go                          # Options / NewModule / 路由 + webhook + 后台循环
├── domain/                            # 实体、枚举、校验（route/channel/template/inhibition/event）
├── dto/                               # 冻结的事件投影、保存响应、审计投影
├── repository/                        # 7 张表 CRUD + 事件统计/保留 + 审计
├── service/
│   ├── config.go                      # 生成 → 校验 → apply → 快照 → M09 同步
│   ├── seed.go                        # 默认配置 + 内置模板幂等 seed
│   ├── channel.go / template.go       # 渠道/模板（SSRF、引用 409、零明文）
│   ├── bridge.go                      # 通知渲染桥（IM 渲染/加签、webhook 原样转发）
│   ├── validate.go                    # amtool check-config（缺失 → 503）
│   ├── inhibition.go                  # 抑制规则 CRUD + 检索 + 重建配置
│   ├── event.go / reconcile.go        # 事件入库/对账/查询/统计/保留
│   ├── silence.go                     # 静默代理 + 网域作用域 + 审计留痕
│   └── am.go                          # Alertmanager v2 客户端
├── handler/                           # 32 端点（读登录 / 写 admin / webhook 公开）
├── configgen/                         # 纯生成器（route_tree + inhibit + receivers）
├── apply/                             # 内部 Reload：原子写/验证/回退/日志
└── references/                        # M09 快照流、M06 网域读与授权、M01 资源回填
```

接线：`platform/cmd/metric-center/v3.go` 注册 m08（system → m06 → m07 → m01 → m09 → **m08** → auth），
webhook 前缀加入 `auth.PublicPathPrefixes`；`m09.Module.AlertmanagerSnapshotSink()` 暴露 D31 端口。

---

## 2. 批次结果

| 批次 | 内容 | 结果 |
|---|---|---|
| B1 | `00009` 7 张表、部分唯一索引（`is_current`）、`occurrence_key` 唯一、审计/检索索引 | 完成；Up/Down ×2、约束断言通过 |
| B2 | 分层骨架、`Options`、v3 注册、webhook 公开挂载、seed（默认配置 + 3 个内置模板）、后台循环接线 | 完成；`/meta` 模块列表含 `m08` |
| B3 | 渠道 CRUD（SSRF 默认拒私网、引用计数 409、`secret_set` 零明文）、模板 CRUD（内置只读/绑定 409）、渲染桥（IM 渲染 + 钉钉加签 + webhook 原样转发） | 完成 |
| B4 | `configgen`（仅物化被引用渠道、每 receiver 追加事件 webhook、禁用分支跳过）、`amtool` 校验（行级错误、缺工具 503）、快照+乐观锁+`pending_sections` | 完成；golden 单测通过 |
| B5 | `apply` 原子写 → reload → `/-/healthy` 验证 → 失败回写上一版 + 二次 reload → `m08_reload_logs`；保存编排；手动重载（不产生新版本） | 完成；四路单测通过 |
| B6 | webhook 入库（恒 2xx、`occurrence_key` 去重）、分钟级对账（补插/关闭/对齐）、七态、列表/current/stats（字段冻结）、180 天保留 | 完成 |
| B7 | 静默代理（创建/删除/列表 + 网域作用域）、审计留痕（含越权拒绝、只读查询）、抑制规则独立表 + 检索、AM `/alerts` 四态代理 | 完成 |
| B8 | M09 快照接线（`CenterDomainID` 存在性校验，失败仅 warn 不阻断）、`snapshot_synced` 回显 | 完成 |

---

## 3. 验证证据

| 项 | 命令 | 结果 |
|---|---|---|
| M08 单测 | `go test ./platform/modules/m08/...` | 4 包全绿（apply / configgen / domain / service） |
| 迁移 | `go test ./platform/db -run TestMigrateV3M08Alerting` | 通过（Up/Down + 唯一索引 + CHECK 断言） |
| 全量 | `go test ./platform/...` | **69 包 ok / 0 FAIL** |
| 静态 | `go vet ./platform/...` | 无输出 |
| 启动 | `--database.mode=v3` 启动 | `/api/v3/platform/meta` → `["system","m06","m07","m01","m09","m08","auth"]` |
| 冒烟 | admin 登录后 GET `config` / `routes` / `stats` / `notify-templates` | 200；默认配置含 `route` + `default` receiver + 事件 webhook |
| 降级 | 无 amtool 时 POST `routes` | **503 unavailable**（D48） |
| SSRF | 创建 `http://127.0.0.1` 渠道 | **400**；公网 URL 200，`webhook_url` 掩码 `***` |
| 静默越权 | `network_domain_id=nope` | **403 forbidden** + 审计 `rejected` |
| AM 不可达 | 合法 matcher 创建静默 | **502 bad_gateway**（修正前为 500） |

---

## 4. 实现取舍与偏差（需在验收时确认）

1. **持久化顺序与 SRS §8.1 不同**：SRS 写「先落快照 → reload」，实现改为「校验 → apply → 落快照」。
   理由：历史只应包含真正被 Alertmanager 接受的版本，避免 `is_current` 指向未加载的配置；
   失败路径下当前版本与磁盘文件保持一致。**回滚仍按 D46 写回上一版并二次 reload。**
2. **版本号**：`<UTC 日期>-<4 hex>`，由服务端生成（非 checksum 截断），用于 reload 日志与历史展示。
3. **渠道 ID 使用 UUID**（v3 惯例），receiver 名为 `notify-<uuid>`；`receiver_name` 由接口回显，前端不应自行拼接。
4. **渠道更新时 `secret` 为空表示保留原密钥**（列表永不回显密钥，客户端无法重发）；清除密钥需后续显式字段，本期不做。
5. **静默审计写失败不阻断操作**（日志由 handler 记录）；审计查询 admin-only。
6. **对账关闭有 2 分钟宽限**，避免 webhook 与对账竞态误关。
7. **`amtool` 不在 CI 安装**：单测用注入 runner 覆盖三态；真实二进制仅在部署环境验证（冒烟已覆盖缺失路径）。
8. **PostgreSQL 迁移仅提供 DDL**：本地无 PG 环境，按 M09 同口径待 `METRIC_CENTER_TEST_POSTGRES_DSN`。

---

## 5. 遗留与下一步

| # | 项 | 说明 |
|---|---|---|
| 1 | **前端 F1（未开始）** | 15 个 alerts 页面 + 3 个 API 客户端切 `/api/v3/platform/alertmanager`；契约 §5 映射表已给出删除端点 |
| 2 | PG 迁移验证 | 00009 双 dialect 待 PG 环境跑 `TestMigrateV3Postgres` |
| 3 | amtool 集成回归 | 部署环境装 amtool 后跑一次真实 `check-config` + 真实 AM reload/回退 |
| 4 | D45 加密 | 渠道密钥仍为明文列，接口/日志零明文；待全局加密落地迁移 |
| 5 | D41/D44 聚合 | 事件表已存 `resource_category` 并在查询时回填；聚合面板按 D44 延后 |
| 6 | 执行记录回填 | `acceptance.md` 证据列待按上表逐条回填后置 `done` |

---

## 6. 代码质量注记

- 无 legacy 包导入（`platform/alertmanager/*`、`platform/models` 均未引用）；事件/渠道等模型均由 m08 自持。
- 模块自注册（`Name()`/`RegisterRoutes`）符合 R4；handler 不持有 `*gorm.DB`。
- 行级校验通过共享 `response.BadRequestWithDetails` 输出 `data.validation`（D-M08-08，`03_API_Standard.md` §3 已同步）。
