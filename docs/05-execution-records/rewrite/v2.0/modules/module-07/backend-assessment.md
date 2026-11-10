# Module 07 后端与数据模型重写评估（v2.0）

> **状态**：approved（2026-11-10，chenrt 确认；旧数据不迁移）
> **分支**：`rewrite/v2.0`
> **上级章程**：`docs/05-execution-records/rewrite/v2.0/charter.md`
> **范围**：M07 资源管理后端、数据模型、API v3、导入、字典、标签、迁移与 handover
> **原则**：按“可移交给正式开发团队”的产品级标准维护，不按一次性项目脚本标准。

---

## 1. 现状证据（为什么必须重写）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | 六类资源表重复共享字段 | Host / Database / Middleware / Application / GenericTarget / InterfaceService 各自维护 `network_domain_id` / `biz_code` / `app_code` / `env` / `cluster` / `status` / `source_type` 等 | 改一个共享字段要改 6 处；跨类别查询/约束无法统一 |
| 2 | 物理列名与语义漂移 | `app_name` 物理列实际存 `app_code`；`sub_app_code` 实际存 `cluster`；`env_flag` 实际存 `env`；`cloud_code` 已上提网域但资源表仍保留 | 新人/AI 极易误读；查询、标签、导入各写一套映射 |
| 3 | 无全局资源主表 | `resource_id` 仅在单表唯一；`ResourceLabel` / `EdgeTargetSnapshot` 以裸字符串引用 | 无法用 FK 保证一致性；跨表定位要循环查 6 张表 |
| 4 | 判重键只在应用层 | `DedupKey` 由字符串拼接，`findExistingByDedupKey` 先查后写；DB 无唯一索引 | 并发导入/重复请求可能产生重复资源 |
| 5 | 引用完整性弱 | `app_code` / `biz_code` / `platform_code` / `network_domain_id` 无 FK；`app_platform_rel.is_primary` 仅应用层唯一 | 孤儿数据、双主平台、字典停用/删除边界靠代码自觉 |
| 6 | 分层缺失 | 12+ handler 直接接收 `*gorm.DB`；`validate.go` 689 行、`excel.go` 613 行、`template.go` 508 行 | 业务规则、HTTP、SQL、Excel 混在一起，无法独立测试/复用 |
| 7 | 动态字段访问 | `models.GetResourceField` / `LegacyFieldMap` 在列表、更新、标签、生成器中使用 | R3 违规；字段调整靠全局搜索；类型安全弱 |
| 8 | DTO 缺失 | 列表返回 `map[string]interface{}`，字段靠反射拼装 | 契约漂移无法编译期发现；v3 无法稳定演进 |
| 9 | 迁移不可控 | 运行时靠 `AutoMigrate`；`platform/db/migrations/` 只是文件记录，无版本表/回滚 | 升级、回滚、重放不可靠 |
| 10 | 敏感字段 | `connection_string` 明文存储（Database/Middleware） | 凭证泄露风险；API 回显/日志需脱敏 |
| 11 | 死表/死列 | 服务字典已删除，但旧库可能残留 `service_dicts` / `service_code`；`cloud_code` 兼容列仍在 | schema 越来越难解释；handover 成本高 |
| 12 | API 版本与契约 | 现有 `/api/v2/platform/*`；分页默认 50（API 标准默认 20）；`is_monitored` 参数解析但不生效 | 旧新并行/契约断代不清晰；分页语义不一致 |

**结论**：M07 后端不是“局部优化”能解决，需要一次**数据模型 + 分层 + API v3**的整体重写。旧 v2 代码冻结，新 v3 在新包中实现，避免边改边坏。

---

## 2. 目标原则

1. **一个资源主表 + 六类扩展表**：共享字段只存一份，类型专属字段放扩展表。
2. **resource_id 全局唯一**：作为跨模块稳定键；标签、快照、关系表都引用它。
3. **约束下沉到 DB**：唯一键、外键、部分唯一索引、check 约束能下沉就不只靠应用层。
4. **domain 不依赖 GORM**：领域模型、校验、判重键、错误类型独立；repository 负责持久化。
5. **handler 只做 HTTP**：解析、鉴权、调用 service、映射响应；不碰 SQL。
6. **DTO 显式**：v3 请求/响应全部 typed DTO；禁止 `map[string]interface{}` 作为对外契约。
7. **导入是独立用例**：解析/校验/写入分层；批处理、幂等、可重试、错误可查询。
8. **迁移优先**：生产 schema 由版本化 migration 管理；`AutoMigrate` 只用于测试/本地基线。
9. **旧新并行**：v2 旧包冻结；v3 新包独立；通过 `/api/v2` 与 `/api/v3` 并存过渡。
10. **可交接**：数据模型、API、迁移、runbook、已知问题齐全，不依赖原作者记忆。

---

## 3. 目标数据模型（建议基线）

> 字段清单以 B0-1 评审为准；这里固定的是**结构原则**，不是最终字段全集。

### 3.1 资源主表 `resources`

| 字段 | 类型 | 说明 |
|---|---|---|
| `resource_id` | TEXT PK | UUID，全局唯一，创建后不可变 |
| `resource_category` | TEXT NOT NULL | host/database/middleware/application/generic_target/interface_service |
| `tenant_id` | TEXT NOT NULL | 租户；MVP 固定 platform_admin，但 schema 预留 |
| `network_domain_id` | TEXT NOT NULL | FK → network_domains(id) |
| `biz_code` | TEXT NULL | FK → business_domains(code)；可空按类型分化 |
| `app_code` | TEXT NULL | FK → application_dicts(app_code)；可空按类型分化 |
| `platform_code` | TEXT NULL | FK → platform_dicts(platform_code) |
| `env` | TEXT NOT NULL | OPS/PRD/UAT |
| `cluster` | TEXT NULL | 集群；不再使用 `sub_app_code` |
| `owner` | TEXT NULL | 负责人 |
| `status` | TEXT NOT NULL | online/offline/maintenance |
| `source_type` | TEXT NOT NULL | manual/import/cmdb |
| `scrape_port` | INTEGER NOT NULL DEFAULT 0 | 实例级采集端口覆盖 |
| `dedup_key` | TEXT NOT NULL | 规范判重键；与 category 组成唯一索引 |
| `created_at` / `updated_at` / `deleted_at` | DATETIME | 软删 |

**约束**：

- PK `resource_id`。
- UNIQUE `(resource_category, dedup_key)` WHERE `deleted_at IS NULL`。
- INDEX `(tenant_id, resource_category, status)`、`(network_domain_id)`、`(app_code)`、`(biz_code)`、`(platform_code)`。
- FK 到字典/网域/租户；SQLite 连接开启 `PRAGMA foreign_keys=ON`。

### 3.2 六类扩展表（1:1）

| 表 | 关键字段 |
|---|---|
| `host_resources` | `resource_id` PK/FK, `hostname`, `instance_ip`, `os_type`, `os_version`, `activated_at` |
| `database_resources` | `resource_id` PK/FK, `database_type`, `instance_ip`, `port`, `version`, `connection_secret_ref` |
| `middleware_resources` | `resource_id` PK/FK, `middleware_type`, `instance_ip`, `port`, `version`, `connection_secret_ref` |
| `application_resources` | `resource_id` PK/FK, `service_name`, `health_check_url`, `protocol`, `endpoint`, `port`, `owner1/2`, `ops_person`, `go_live_at` |
| `generic_target_resources` | `resource_id` PK/FK, `target_name`, `instance_ip`, `port`, `metrics_path`, `scheme`, `exporter_type` |
| `interface_service_resources` | `resource_id` PK/FK, `api_name`, `api_url` |

- 扩展表主键 = `resource_id`，FK → `resources(resource_id)`。
- 类型专属唯一键可放扩展表（如 host `(network_domain_id, instance_ip)` 需要 join 主表；也可只用 `dedup_key` 统一）。
- `custom_labels` 不再用 JSON 存在扩展表：统一进 `resource_labels`（source=user/system/cmdb），避免两套标签模型。

### 3.3 字典与关系

- `business_domains` / `application_dicts` / `platform_dicts` / `cloud_dicts` / `os_dicts` / `zone_types` 保留；资源主表通过 code FK 引用。
- `app_platform_rel`：`app_code` + `platform_code` 唯一；部分唯一索引 `(app_code) WHERE is_primary=1 AND deleted_at IS NULL`，DB 兜底“至多一个主平台”。
- `resource_labels`：`resource_id` FK；UNIQUE `(resource_id, key, source)`；system 标签仍实时计算、不落库。
- `resource_audit_logs`（建议）：`resource_id`, `operation`, `before/after` JSON, `operator`, `created_at`；用于 handover 与追责。MVP 可后置。

### 3.4 旧字段处置

| 旧字段/表 | 处置 |
|---|---|
| `app_name`（存 app_code） | 新表统一 `app_code`；旧列不迁移，v2 旧库保留 |
| `sub_app_code` | 新表统一 `cluster`；旧列不迁移 |
| `env_flag` | 新表统一 `env` |
| `cloud_code`（资源表） | 删除；cloud 经 `network_domain_id` 派生 |
| `service_code` / `service_dicts` | 删除；服务字典已废弃 |
| `resource_type`（过渡列） | 删除；只保留 `resource_category` |
| `host.region` / `host.zone_env` | 默认删除；若业务仍需区域属性，经网域派生或新增明确字段 |
| `connection_string` | 改为 `connection_secret_ref` 或加密存储；API 只回显脱敏 |

---

## 4. 目标代码架构

**新 v3 代码放新包，旧 v2 包冻结**：

```text
platform/modules/m07/
├── module.go                 # 依赖装配 + 路由注册（R4 自注册）
├── domain/                   # 实体、值对象、判重键、校验、错误
├── dto/                      # v3 请求/响应 DTO + mapper
├── repository/               # GORM/SQL；接口 + 实现
├── service/                  # 用例编排、事务边界
├── handler/                  # HTTP 适配
├── importer/                 # Excel 解析/校验/导入
├── dictionary/               # 字典解析/校验
└── references/               # M01/M09 只读适配器
```

旧 `platform/config/resource` 保留为 v2 legacy，不再加新功能；v2.0 发布后按兼容窗口决定是否删除。

### 分层职责

- **domain**：`Resource`、`ResourceCategory`、`DedupKey`、`ValidationError`、`ConflictError`；不依赖 GORM/Gin。
- **repository**：`ResourceRepository`（base + extension 事务写入/读取）、`LabelRepository`、`DictionaryRepository`、`ImportRepository`；返回 domain 对象。
- **service**：`ResourceService`（List/Get/Create/Update/Delete）、`ImportService`、`LabelService`、`DictionaryService`；事务边界在 service。
- **handler**：解析 v3 请求、调用 service、映射错误到 `platform/api/response`；不出现 `*gorm.DB`。
- **dto**：按 category 的 typed response；列表不再返回 map。
- **module.go**：构造 repo/service/handler，注册 `/api/v3/platform/*`。

### 关键替换

| 当前 | 目标 |
|---|---|
| `findResourceByID` 循环 6 表 | `resources` 主表一次查询 + 扩展表 join/批量加载 |
| `GetResourceField` / `LegacyFieldMap` 业务调用 | domain typed accessors；仅 importer/exporter 保留字段映射适配器 |
| `updatableColumns` 物理列清单 | service 按 domain 字段更新；repository 负责列映射 |
| `map[string]interface{}` 列表 | typed `ResourceListItem` / `ResourceDetail` |
| handler `*gorm.DB` | handler → service → repository |
| `AutoMigrate` | 版本化 migration runner |

---

## 5. API v3 契约方向

- 前缀：`/api/v3/platform/*`。
- 资源：
  - `GET /resources?resource_category=...`
  - `POST /resources`
  - `GET /resources/{resource_id}`
  - `PUT /resources/{resource_id}`
  - `DELETE /resources/{resource_id}`
  - `GET /resources/{resource_id}/referenced-by`
- 标签：`/resources/{resource_id}/labels`
- 字典：`/business-domains`、`/application-dict`、`/platform-dict`、`/cloud-dict`、`/os-options`
- 导入：`/resources/import`、`/imports`、`/imports/{id}`
- 分页：默认 20、上限 100（对齐 `03_API_Standard`）。
- 响应：统一 `{status,data,errorType,error}`；错误码 `bad_request` / `not_found` / `conflict`（判重）/ `forbidden` / `internal`。
- 资源响应建议：公共字段 + `attributes` typed object（按 category），避免六套完全不同的顶层字段；最终以 B0-2 契约为准。

---

## 6. 迁移策略

**推荐：新 schema + 可选 legacy import，不做旧表原地 ALTER。**

理由：

- 旧表列名/死列/约束历史复杂，原地迁移风险高；
- v2.0 是重写，不是旧库升级；旧版本已归档；
- 新 schema 可以直接按产品级标准建，避免继承历史债。

步骤：

1. B1-1 接入 migration runner（内置 SQL runner，兼容 goose 标记），建立 `schema_migrations`。
2. B1-2 新建 v3 schema baseline（`resources` + 扩展表 + 字典 FK + 索引）。
3. B1-3（可选）`cmd/legacy-import`：读旧库 → 映射 → 校验 → 写新库；支持 dry-run、计数、错误报告；不修改旧库。
4. B1-4 migration 测试：空库 Up、基线库 Up/Down、约束/索引验证。
5. 发布前：旧库备份；新库初始化；如导入旧数据，执行 legacy import + 对账。

**已确认 `data_migration: none`（2026-11-10，chenrt）**：M07 旧数据不迁移；v3 从新 schema 开始。旧库只做备份/归档；`cmd/legacy-import` 保留为可选工具，不在本轮执行。

---

## 7. 安全与可观测性

- **凭证**：`connection_string` 不落明文；改为 secret ref 或 AES-GCM 加密；API 回显脱敏；日志不打印。
- **鉴权**：资源写接口、字典写接口按 PRD 鉴权；v3 路由显式挂中间件，不依赖全局默认。
- **SSRF**：`health_check_url` / `api_url` 继续校验 scheme/host；导入同样校验。
- **审计**：建议 `resource_audit_logs` 记录 create/update/delete/import；至少记录 operator、resource_id、操作、时间。
- **日志**：结构化字段 `resource_id` / `category` / `operation` / `tenant_id`；导入记录耗时/成功/失败。
- **指标**：CRUD 计数、导入耗时、判重冲突数（可选，P2）。

---

## 8. 任务拆分

> 详细 YAML 见 `backend-task-sequence.yaml`。阶段 B0–B6，按依赖顺序推进。

| 阶段 | 任务 | 产出 | 预估 |
|---|---|---|---|
| B0 | B0-1 数据模型基线 / ADR | `backend-assessment.md` 定稿 + `decisions.md` D6/D7 | 1-2d |
| B0 | B0-2 API v3 契约草案 | `api-contract-snapshot-v3.md` | 1-2d |
| B1 | B1-1 migration runner | `make migrate*` + `schema_migrations` | 1-2d |
| B1 | B1-2 v3 schema baseline | migration + 索引/约束/FK | 2-3d |
| B1 | B1-3 legacy import（可选） | `cmd/legacy-import` + dry-run/对账 | 2-3d |
| B1 | B1-4 migration 测试 | 空库/基线库 Up/Down 测试 | 1d |
| B2 | B2-1 domain 模型 | 实体/值对象/判重键/错误 | 1-2d |
| B2 | B2-2 repository | base+extension 事务读写 | 2-3d |
| B2 | B2-3 字典 service/repo | 字典解析/校验 | 1-2d |
| B2 | B2-4 resource service | CRUD/事务/判重冲突 | 2-3d |
| B2 | B2-5 label service/repo | 标签策略/唯一索引 | 1-2d |
| B3 | B3-1 DTO + mapper | 六类 typed DTO | 1-2d |
| B3 | B3-2 资源 handler v3 | list/get/create/update/delete | 2-3d |
| B3 | B3-3 字典 handler v3 | 字典 + app-platform-rel | 1-2d |
| B3 | B3-4 标签 handler v3 | labels + referenced-by | 1-2d |
| B4 | B4-1 importer 解析/校验 | Excel 解析 + 声明 sheet | 2-3d |
| B4 | B4-2 import service | create_only/upsert/批量/幂等 | 2-3d |
| B4 | B4-3 import handler v3 | 导入接口 + 记录查询 | 1-2d |
| B5 | B5-1 module 自注册 | `module.go`，main 去手工装配 | 1-2d |
| B5 | B5-2 跨模块适配器 | ScrapeJob / EdgeTargetSnapshot 只读接口 | 1-2d |
| B5 | B5-3 v3 路由挂载 | `/api/v3/platform/*` | 0.5d |
| B6 | B6-1 契约/回归测试 | v3 golden + 旧 vs 新矩阵 | 2-3d |
| B6 | B6-2 集成/并发测试 | 约束/事务/判重/迁移 | 2-3d |
| B6 | B6-3 安全审查 | 凭证/鉴权/SSRF/上传 | 1-2d |
| B6 | B6-4 handover 文档 | 数据模型/API/迁移/runbook | 1-2d |

**总量约 30-45 人日**；可按阶段交付：

- **Stage 1（核心）**：B0 + B1 + B2 + B3-1/B3-2 → 可用的 v3 CRUD。
- **Stage 2（完整）**：B3-3/B3-4 + B4 + B5 → 字典/标签/导入/自注册。
- **Stage 3（交接）**：B6 → 回归、安全、handover。

---

## 9. 需要拍板的问题

1. **旧数据是否迁移**：默认 `none`；若需要，启用 B1-3 legacy import。
2. **资源响应形态**：公共字段 + `attributes` 嵌套，还是六类扁平 DTO？建议嵌套，减少顶层字段爆炸。
3. **`connection_string` 安全**：secret ref / 加密 / 暂不存储，三选一。
4. **审计日志**：MVP 是否纳入 `resource_audit_logs`；建议纳入，成本低、handover 价值高。
5. **v2 旧包保留窗口**：v2.0 发布后保留 `/api/v2` 多久；建议一个版本窗口，之后删除旧包。
