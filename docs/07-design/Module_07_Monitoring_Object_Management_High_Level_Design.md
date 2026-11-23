# 监控对象管理（CMDB） 概要设计

> **文档类型**：概要设计（High-Level Design, HLD）
> **目标读者**：后端/前端开发工程师、测试工程师、运维架构师、代码审查者
> **文档版本**：v1.0
> **状态**：draft
> **编写日期**：2026-11-22
> **修订日期**：2026-11-22
> **Domain ID**：`DOMAIN-CMDB`
> **实现模块**：`m07`（+ `ui-custom/web`）
> **需求基线**：[监控对象管理（CMDB）SRS](../02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md)（v2.4）
> **场景链接（唯一链接点）**：[Module_07_Scenario_Link.md](Module_07_Scenario_Link.md)
> **场景演示脚本**：`docs/05-execution-records/module-07/scenario-walkthrough.md`（待创建）
> **对外验收说明书**：`docs/07-design/Module_07_Acceptance.md`（待创建，派生，非追溯）
> **关联决策**：D40（资源删除 M01 对账回收）、D41/D42/D43（平台组织维度与应用归属完整性）、决策 44（RequireAdmin 最小授权）、决策 103（`cloud` 标签经网域派生）、M01 v1.5 采集模板化（M07 不感知模板/任务）

---

## 1. 引言

### 1.1 目的

本文档描述监控对象管理的**架构级设计**：模块边界、接口清单、数据归属、关键流程、状态机、安全与性能约束，以及**能力清单**；完整“场景 ↔ 设计 ↔ 演示 ↔ 验收”见 [Scenario Link](Module_07_Scenario_Link.md)。

本文档**不展开**字段级契约、DTO、算法伪代码和页面组件细节：

- 接口字段以 `api-contract-snapshot-v3.md` 为准；
- 数据库列以 `platform/db/migrations/v3/*.postgres.sql` 为准；
- 页面交互以 `ui-custom/web/src/pages/resources/` 为准。

### 1.2 范围

**覆盖**：六类监控对象台账、平台/应用/业务三本字典、标签模板与受控标签、Excel 批量导入、CI 模型与自定义字段、批量改归属与采集端口、变更通知与对账。

**不覆盖**：采集模板与采集任务（M01）、配置生成与下发（M09）、告警规则与通知（M08）、外部 CMDB 同步（M04，v0.4+）。

### 1.3 参考

- [SRS](../02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md)
- [Scenario Link](Module_07_Scenario_Link.md)
- [后端架构与债务控制](../03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md)
- `platform/modules/m07/`、`platform/models/`、`platform/db/migrations/v3/`

---

## 2. 设计概述

### 2.1 系统上下文

```
M06 网域管理 ──(network_domain_id 行政数据)──┐
                                            ▼
  前端（资源管理 / 字典 / 标签模板 / CI 模型）──► M07 监控对象台账（事实源）
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                             ▼
      M01 采集策略（只读消费）        M09 配置生成（只读消费）       M05/M08（经标签聚合）
      资源 + 字段字典 + 标签模板      资源 + 标签 + 归属编码          platform/app/biz 标签
```

M07 是监控对象事实的唯一来源：M01 只读消费字段与标签，M09 只读消费资源生成 `prometheus.yml` 与 targets；M07 不存采集模板/任务标识，不回写策略字段。

### 2.2 组件职责

| 组件 | 职责 |
|------|------|
| `m07/handler` | HTTP 路由、参数解析、统一响应与错误语义 |
| `m07/service` | 资源台账、字典生命周期、标签模板、导入、CI 模型与自定义字段 |
| `m07/repository` | GORM 持久化；主表 + 六类子表 + 字典/模板/属性/导入记录 |
| `references.ResourceChangeNotifier` | best-effort 通知 M01 对账与 M09 配置重算 |
| `foundation` | 统一响应、错误、鉴权上下文 |
| `ui-custom/web/pages/resources` | 资源列表/详情/表单、字典、导入、CI 模型配置 |

### 2.3 代码结构

```
platform/modules/m07/
├── module.go                 # 依赖组装与路由挂载
├── handler/                  # resource / dictionary / label / label_template / import / attribute
├── service/                  # resource / import / attribute / label / ci_model / label_template
├── repository/               # models.go + 各仓储实现
├── dto/                      # 请求/响应结构
└── domain/                   # 资源类型、状态、字典、标签等领域枚举
```

### 2.4 前端信息架构

| 顺序 | 一级 | 二级页面 | 路由 |
|------|------|----------|------|
| 1 | 资源管理 | 资源台账（六类 Tab） | `/resources` |
| 2 | 资源管理 | CI 模型配置 | `/ci-models` |
| 3 | 资源管理 | 标签模板 | `/label-templates` |
| 4 | 资源管理 | 业务字典 | `/business-domains` |
| 5 | 资源管理 | 应用字典 | `/application-dict` |
| 6 | 资源管理 | 平台字典 | `/platform-dict` |
| 7 | 资源管理 | 导入记录 | 资源页内抽屉 |

### 2.5 能力清单

> 能力（CAP）是技术内部的复用抽象，不要求需求方理解；完整「场景 → 实现」映射见 [Module_07_Scenario_Link.md](Module_07_Scenario_Link.md)（唯一链接点），本文不维护第二份追溯表。

| CAP | 意图 | 实现模块 | 扩展点 |
|-----|------|----------|--------|
| CAP-RESOURCE-LEDGER | 六类资源台账、判重、软删、引用回显 | m07 | 主表 + 六类子表 |
| CAP-DICTIONARY | 平台/应用/业务字典、四态生命周期、引用数 | m07 | 启用/停用/合并/撤销 |
| CAP-LABEL-GOVERNANCE | 标签模板映射、来源优先级、实例级 user 标签 | m07 | 模板克隆 + 整组校验 |
| CAP-BULK-IMPORT | Excel 模板、create_only/upsert、声明 sheet、行级错误 | m07 | 导入记录 + 行校验 |
| CAP-CI-MODEL | 内置字段只读 + 自定义字段登记/移出 | m07 | 字段定义 + 资源属性 |
| CAP-CHANGE-NOTIFY | 变更后 best-effort 通知 M01 对账 / M09 重算 | m07 → m01/m09 | ResourceChangeNotifier |
| CAP-UI-CMDB | 资源、字典、模板、CI 模型页面 | ui-custom/web | 菜单/路由注册 |

> 本轮无新建能力；全部在既有 `m07` 能力内扩展。若后续需要新建，必须在本文件说明为什么不能复用/扩展。

---

## 3. 约束与关键决策

| # | 决策 | 理由 / 影响 |
|---|------|-------------|
| 1 | M07 是监控对象事实唯一来源 | M01/M09 只读消费；禁止在策略侧复制资源字段 |
| 2 | M07 不感知采集模板与任务 | 资源只描述事实，不描述采集策略；一个资源可被多条 Job 匹配 |
| 3 | 标签模板是标签唯一引用点 | 采集 Job 不直接持有标签映射；模板变更影响面可计算 |
| 4 | 字典编码一经引用不可变、不可复用 | 避免历史时序语义漂移；零引用可撤销、有引用只能停用/合并 |
| 5 | 内置字段只读、自定义字段免发版 | 平台依赖字段随版本发布；描述性字段登记即生效 |
| 6 | 资源删除为软删 + 变更通知 | 保留审计；M01 对账回收、M09 重算；失败由 watcher 兜底 |
| 7 | 静态资源标签只读 | 避免 CMDB 治理之外二次打标造成口径混乱 |
| 8 | 应用至少一个平台、恰一个主平台 | 服务端强制不变量，禁止静默改写告警派单归属 |

> **安全遗留（需关注）**：SRS 要求内置模板与内置字段仅 admin 可改（决策 44），但当前 M07 路由组未挂 `RequireAdmin`，仅依赖登录态与前端入口约束；列为 Scenario Link 未决问题 #2。

---

## 4. 接口清单

### 4.1 鉴权

- 所有 M07 路由挂在 `/api/v3/platform`，由全局 `AuthMiddleware` 建立用户上下文；匿名请求 401。
- M07 路由层当前无额外 `RequireAdmin`；管理员专属写操作的收口为遗留项（见 §3 安全遗留）。

### 4.2 平台 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/resources` | 资源列表（类型/平台/应用/业务/网域/状态/采集状态筛选） |
| POST | `/resources` | 新增资源 |
| GET | `/resources/:id` | 资源详情 |
| PUT | `/resources/:id` | 编辑资源 |
| DELETE | `/resources/:id` | 软删资源 |
| GET | `/resources/:id/referenced-by` | 被采集任务引用情况 |
| POST | `/resources/bulk-reassign` | 批量改归属 |
| POST | `/resources/bulk-scrape-port` | 批量设置采集端口 |
| GET/PUT | `/resources/:id/attributes` | 自定义字段值读取/整体替换 |
| GET/POST | `/resources/:id/labels` | 实例级标签列表/新增 |
| PUT/DELETE | `/resources/:id/labels/:label_id` | 编辑/删除 user 标签 |
| GET/POST | `/label-templates` | 标签模板列表/新增 |
| GET/PUT/DELETE | `/label-templates/:id` | 标签模板详情/编辑/删除 |
| GET/POST | `/attribute-definitions` | 自定义字段定义列表/新增 |
| PUT/DELETE | `/attribute-definitions/:id` | 编辑/移除自定义字段 |
| GET | `/ci-models` | 六类 CI 模型列表 |
| GET | `/ci-models/:category` | 单类 CI 模型（内置字段只读 + 自定义字段） |
| GET/POST | `/business-domains` | 业务字典列表/新增 |
| PUT | `/business-domains/:code` | 编辑业务字典 |
| POST | `/business-domains/:code/revoke` | 零引用撤销 |
| POST | `/business-domains/:code/merge` | 合并到目标编码 |
| GET/POST | `/application-dict` | 应用字典列表/新增 |
| PUT | `/application-dict/:app_code` | 编辑应用字典 |
| POST | `/application-dict/:app_code/revoke` | 撤销 |
| POST | `/application-dict/:app_code/merge` | 合并 |
| GET/POST | `/platform-dict` | 平台字典列表/新增 |
| PUT | `/platform-dict/:platform_code` | 编辑平台字典 |
| POST | `/platform-dict/:platform_code/revoke` | 撤销 |
| POST | `/platform-dict/:platform_code/merge` | 合并 |
| GET | `/dictionary-audit-logs` | 字典生命周期审计 |
| GET | `/cloud-dict` | 云字典只读列表（维护在 M06） |
| POST | `/cloud-dict/:code/revoke`、`/merge` | 云字典生命周期动作 |
| GET | `/os-options` | 操作系统选项（主机表单） |
| GET/POST | `/app-platform-rel` | 应用-平台关联列表/新增 |
| PUT/DELETE | `/app-platform-rel/:rel_id` | 编辑/删除关联 |
| GET | `/import-templates/:category` | 下载固定列 Excel 模板 |
| POST | `/imports` | 上传并导入 |
| GET | `/imports`、`/imports/:id` | 导入记录列表/详情 |

---

## 5. 数据设计

### 5.1 表与归属

| 表 | 归属 | 说明 |
|----|------|------|
| `resources` | M07 | 资源主表：类型、租户、网域、归属编码、状态、端口、判重键、软删 |
| `host_resources` / `database_resources` / `middleware_resources` / `application_resources` / `interface_service_resources` / `generic_target_resources` | M07 | 六类子表，1:1 扩展主表 |
| `resource_labels` | M07 | 实例标签：key/value/source（system/user/cmdb） |
| `m07_label_templates` | M07 | 标签模板（按资源类型，含默认标记） |
| `platform_dicts` / `application_dicts` / `business_domains` | M07 | 三本字典（编码、名称、生命周期、`merged_into`） |
| `app_platform_rels` | M07 | 应用-平台多对多；`is_primary` 主平台唯一 |
| `m07_dictionary_audit_logs` | M07 | 撤销/合并审计 |
| `m07_attribute_definitions` | M07 | 自定义字段定义（类型、值类型、分组、状态） |
| `m07_resource_attributes` | M07 | 资源 × 字段 key × 值 |
| `import_records` | M07 | 导入批次与行级结果 |
| `resource_audit_logs` | M07 | 资源写操作留痕 |

### 5.2 保留与生命周期

- 资源、字典、用户可见条目均以软删或状态位保留，不做物理删除。
- 字典编码进入终态（已合并/已撤销）后不复用，`merged_into` 指向目标编码。
- 自定义字段被引用时只能「移出模型」，历史值保留；零引用才删除定义。
- 标签模板变更写只读快照；资源删除保留审计记录。

### 5.3 内容存储

- 资源事实字段落主表与子表固定列；自定义字段走 `m07_resource_attributes` 键值存储。
- 标签不入资源表，统一存 `resource_labels`，由模板 + 实例标签合成。
- 导入声明 sheet 的字典条目与资源落库在同一事务内完成。

---

## 6. 关键设计

### 6.1 资源台账与判重

- 六类资源各有独立字段集与判重键；判重键由服务端统一生成 `dedup_key`，手动录入、Excel 导入、API 调用三路径共用同一规则。
- 资源保存前校验：必填字段、IP/端口/URL 格式、字典存在且启用、应用-平台不变量、网域可用。
- 编辑只校验**本次发生变化**的引用字段：已停用字典的存量引用不阻断无关字段编辑。

### 6.2 字典生命周期

- 四态：`enabled` / `disabled` / `merged` / `revoked`；仅 `enabled` 出现在可选下拉。
- 引用数由服务端一次分组查询返回；撤销仅限零引用，合并要求源≠目标且目标启用。
- 合并单事务迁移资源与应用-平台关联，写审计日志；历史 TSDB 数据不追溯改写。

### 6.3 标签模板与受控标签

- 每类资源预置默认模板；自定义模板可克隆、编辑、删除，默认模板只读。
- 映射整组校验：目标标签不冲突、不覆盖 Prometheus 内置 label。
- 标签来源优先级 `cmdb > user > system`；仅应用服务/接口服务开放 user 标签写入口。

### 6.4 Excel 导入

- 固定列模板 + 取值说明 sheet；支持 `create_only` 与 `upsert`。
- 行级校验必填、格式、字典存在性；失败明细记录行号/字段/值/原因。
- 声明 sheet（平台/应用/业务）随批次原子创建，只增不覆盖。
- 导入完成后写 `import_records` 并 best-effort 通知 M01 对账 + M09 重算。

### 6.5 CI 模型与自定义字段

- 内置字段由代码定义，接口只读返回，不落字段定义表。
- 自定义字段登记 key、展示名、值类型、分组、排序、必填；登记后表单自动渲染。
- 值校验按类型执行（布尔/数值/文本/枚举）；不注入 Prometheus 标签。
- 移除时按引用数自动判定：零引用删除定义；有引用移出模型并保留历史值。

### 6.6 变更通知与对账

- 资源/标签/模板/导入/批量改归属成功后，best-effort 调用 `ResourceChangeNotifier`：
  - 通知 M01 对账（静态选例不会自动加入新资源）；
  - 通知 M09 重算相关网域配置。
- 通知失败不回滚业务事务，由 M09 30s watcher 兜底；失败状态在同步/变更检测中可见。

### 6.7 前端页面

- `ResourcesPage`：六类 Tab、筛选栏、列偏好记忆、三态采集 badge、批量操作。
- 字典页：引用数、四态筛选、撤销/合并入口与影响预览。
- `CIModelPage`：左侧六类 CI、右侧内置字段只读区 + 自定义字段区。
- 标签模板页：映射表格批量编辑、引用实例/Job 提示。

---

## 7. 关键流程

### 7.1 资源录入

选择类型 → 填写字段与归属 → 服务端校验/判重 → 生成 system 标签 → 保存 → best-effort 通知（失败由 watcher 兜底）。

### 7.2 Excel 导入

下载模板 → 填写 + 声明 sheet → 选择模式上传 → 行校验 → 创建/更新资源与字典 → 写导入记录 → 通知对账/重算。

### 7.3 字典纠错

查看引用数 → 零引用撤销（二次确认）／有引用合并（影响预览 + 单事务迁移 + 审计）→ 通知 M09 重算。

### 7.4 批量改归属

勾选同类型资源 → 选择维度与目标字典 → 服务端校验（组成型资源不可直接改平台）→ 单事务提交 → 失败整体回滚并返回明细。

### 7.5 自定义字段维护

CI 模型配置新增字段 → 表单/导入立即生效 → 需要移除时按引用数删除或移出模型 → 同名 key 重新登记时历史值恢复。

---

## 8. 状态机

### 8.1 字典条目

```
enabled ⇄ disabled
   │          │
   └──► merged ◄──┘   （终态，引用已迁移）
   └──► revoked       （终态，仅零引用可进入）
```

### 8.2 自定义字段

```
在模型中 ⇄ 已移出（有引用时移除）
在模型中 ──► 删除（零引用时移除）
```

### 8.3 资源生命周期

```
新建/导入 ──► 在用 ──► 软删（引用 Job 对账回收）
                 └──► 运行状态：online / offline / maintenance
```

---

## 9. 安全

- 资源写操作要求有效登录态；管理类写操作应叠加 admin 门（当前为遗留项，见 §3）。
- 静态资源 user 标签写操作拒绝（403）。
- 导入文件校验格式、字段长度、非法字符；导入结果与日志不含连接串等敏感明文。
- 字典编码不可通过编辑接口修改；内置字段改操作拒绝并返回可执行提示。
- 多租户资源隔离为 v0.2+ 能力，当前按 `tenant_id` 预留。

---

## 10. 性能与容量

| 项 | 目标 | 设计手段 |
|----|------|----------|
| 资源列表首屏 | ≤ 1s（P95） | 主表分页 + 子表按需 join；索引覆盖常用筛选 |
| 筛选/分页 | ≤ 500ms | 后端全量筛选后分页，避免前端过滤 |
| Excel 导入 | 1000 行 ≤ 30s | 批量校验 + 批量写入；导入异步记录 |
| 字典引用数 | 一次查询 | 分组统计，禁止逐行 N+1 |
| 采集状态 badge | 一次聚合 | 消费 M09 覆盖率接口，禁止逐行查时序 |

---

## 11. 可观测性与运维

- 字典撤销/合并、资源写操作、导入批次均有留痕（`m07_dictionary_audit_logs` / `resource_audit_logs` / `import_records`）。
- 导入失败返回行级明细，便于运维修正后重试。
- 变更通知失败不改变业务结果，但需在日志与 M09 变更检测状态中可见。
- 存量 `infra` 等演示字典不自动删除，页面通过引用数与撤销/合并动作处理。

---

## 12. 测试与验证

> 本节只写测试策略与覆盖范围；测试清单与执行证据见 acceptance / walkthrough，不在本文复制。

- 单元：判重键、字段校验、字典四态与引用数、合并事务、标签来源优先级、导入行校验、自定义字段值类型、移出/恢复。
- 集成：资源 CRUD + 标签生成 + 通知；导入 create_only/upsert + 声明 sheet；批量改归属回滚；字典合并后资源归属迁移。
- E2E/场景：按 SCN-01~06 走查。
- 迁移/回滚：v3 migration 可重复执行；软删与状态位不破坏历史数据。

---

## 13. 场景链接

场景与实现的完整映射见 [Module_07_Scenario_Link.md](Module_07_Scenario_Link.md) §2（本文不维护）；NFR 覆盖与未决问题见同文档 §3 / §5。

---

## 14. 附录

### A. 路由速查

见 §4.2；完整注册代码见 `platform/modules/m07/handler/routes.go`。

### B. 错误语义

| 场景 | 语义 |
|------|------|
| 判重冲突 | 409 + 已存在资源标识 |
| 字典不存在/停用 | 400 + 字段与下一步指引 |
| 零引用校验失败（撤销） | 409 + 引用数与建议（停用/合并） |
| 合并源=目标 | 400 |
| 修改内置字段 | 400 + 「平台内置字段不可修改」 |
| 静态资源写 user 标签 | 403 |
| 删除模板被引用 | 409 + 引用清单 |

---

## 15. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-11-22 | 首版：按 M09 形态建立 M07 概要设计；覆盖模块边界、接口清单、数据归属、关键设计、流程、状态机、安全与性能；场景映射交由 Scenario Link；登记 M07 路由缺 admin 门的安全遗留 |
