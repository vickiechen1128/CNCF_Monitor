# API 契约快照 — Module 08 告警收敛与通知管理（决策 59/60 MVP 增量）

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。
>
> MVP 边界：本快照覆盖 **决策 59/60 告警分发闭环** 的三块能力——①`alertmanager.yml` 文件挂载（+版本留痕/回滚）；②静默极简 UI（创建/列表/删除，API 直调 Alertmanager）；③跨端 M09 变更确认联动（内容 Owner=M08，管道 Owner=M09）。**v1.12 增量**：告警状态查看由 v0.3 提前至 MVP——M02 代理 Prometheus `/api/v1/alerts`（firing/pending）+ M08 代理 Alertmanager `/api/v2/alerts`（通知状态四态），契约见 §10。接收人/路由/抑制**表单化 UI** 仍归 **v0.3**，不在本快照。

## 0. 快照元信息

| 项     | 值                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase | Track B 增量（决策 59/60 告警分发 MVP 最小闭环）+ Track B+ 增量（v1.12 告警状态查看提前 MVP，强制 security-reviewer）                                                                                                                                                          |
| 模块    | module-08-alert-dispatch                                                                                                                                                                                                                                    |
| 分支    | feat/module-08-alert-dispatch                                                                                                                                                                                                                               |
| 版本    | v2026-09-11b（§4 新增 `GET /silences/label-options` 静默 matcher 标签选项聚合端点 + LabelOptionGroup 响应结构，Matcher 补 AND 语义与正则预检说明，v1.16 决策 71）叠加 v2026-09-11（§10.1/§10.2 实例字段扩展，决策 70：新增 `instance_address` / `resource_id` / `resource_name` / `resource_category` / `resource_ip` / `resource_port`，`instance_display` 语义修订为「`resource_name` 非空取之，否则取 `instance_address`」，`labels.instance` 明确为**采集地址**；不删旧字段、向后兼容）叠加 v2026-09-10（§10 网域取值口径修正：`labels.network_domain` 明确为服务端解析 + 回写，F-07；**同日决策 68-1 键名收敛**——`labels.network_domain_id` 定位修订为历史/兼容键、`network_domain` 为唯一标签键；字段名与响应形状不变）                                                                                                                                                                                                                                             |
| 生成方式  | planner 派生（决策 59/60，承接决策 47；开发期决策 61 修正 silence API 为 v2；v1.12 告警状态查看提前 MVP；2026-09-10 决策 68-1 键名口径收敛）                                                                                                                                                                                                                                |
| 来源    | PRD `Module_08_Alertmanager_Notification_Management.md`（v1.12）§1/§3.1/§5.1/§5.2/§5.4/§6.3/§6.6/§9；PRD `Module_02_Query_Center.md`（v1.12）§3.1/§6.1/§11；PRD `Module_09`（v1.52）§3.4/§5.4/§9.2；`design-decisions.md` 决策 49/55/56/59/60/61 + 分轨判定记录 2026-09-08；`03_API_Standard.md` §7；`05_Code_Implementation_Plan.md` §7.8/§7.9；`task-sequence.yaml` |

## 1. 通用契约

### 1.1 前缀与响应

- 管理面前缀：`/api/v2/platform/alertmanager/*`（本模块全部 REST 管理接口）；代理 Alertmanager 原生 **v2 silence API**（`/api/v2/silences`、`/api/v2/silence/{id}`）由本模块服务端承载，前端不直连 AM。Alertmanager ≥0.27 已移除 v1 silence 端点，禁止调用 `/api/v1/silences`。

- 统一响应：`{status: success, data}` / `{status: error, errorType, error}`（沿用 `platform/api/response`）。

- 前端不得直接请求 Alertmanager；所有读写经 M08 服务端（静默为运行时状态，经 M08 代理以进授权校验 / 规避直连，决策 56）。

### 1.2 errorType 枚举

`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict`

### 1.3 授权利令（决策 56）

- **读路径**：代理 Alertmanager 时服务端强制注入当前用户授权网域集合 filter（不信任前端传参）；授权集合 = 全部网域时不附加。

- **写路径（静默创建）**：服务端校验 matcher 收敛于授权网域集合，越权 matcher 直接 `bad_request` 拒绝。**MVP 单租户恒通过**，机制骨架保留。

- 当前前端登录态已由 M06/决策 44 轻量认证提供；告警接口命中认证中间件（`/api/v2/platform/*` 全局）。

### 1.4 分页信封

| 接口                                  | 信封      | 默认/上限                         |
| ----------------------------------- | ------- | ----------------------------- |
| `GET /alertmanager/config/versions` | `items` | page=1 / page\_size=20；上限=100 |
| `GET /alertmanager/silences`        | `items` | page=1 / page\_size=20；上限=100 |

> 空结果一律返回 `[]` 而非 `null`。

## 2. 路径与跨端边界说明

| 决策点                                                | 结论                                                                                      | 依据                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------- |
| `alertmanager.yml` 内容 Owner                        | **M08**（文件挂载 + `amtool check-config` 校验 + `AlertmanagerConfigVersion` 留痕）               | 决策 59/60            |
| `alertmanager.yml` 下发管道 Owner                      | **M09**（`ConfigDraft`（管理域 default scope）→ 人工确认 → 下发 reload → `change_status` 回写 M08）    | 决策 60               |
| 管理域 scope                                          | 变更单网域恒为管理域（`default`）；**不参与按网域扇出、不进** **`agent_pull`** **配置包**                          | 决策 60               |
| 静默                                                 | Alertmanager 运行时 API 状态，经 M08 服务端代理，**不进 M09 流水线**、即时生效                                 | 决策 59               |
| `AlertmanagerConfigVersion` 与 M09 `ConfigDraft` 边界 | 本表=**M08 内容侧留痕**（仅通过的挂载 + applied 态）；管道侧版本/下发状态以 M09 `ConfigDraft` / `ConfigVersion` 为准 | 决策 60，PRD §6.6 说明 2 |

## 3. Alertmanager 配置挂载与版本 API（config-mount service）

| 方法   | 路径                                                           | Query / 请求体                                                       | 响应 data                                                                      | 业务错误                                                             | PRD 源       |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| POST | `/api/v2/platform/alertmanager/config`                       | body `{ content: '<alertmanager.yml 全文>', uploaded_by?: string }` | 校验通过：写入的 `AlertmanagerConfigVersion`；M09 侧管理域变更单号 `source_change_no`（若本轮已生成） | `bad_request`：`amtool check-config` 校验失败（返回行级错误集合，**不落库、不进流水线**） | §5.1 / §9.2 |
| GET  | `/api/v2/platform/alertmanager/config/current`               | —                                                                 | 当前生效 `AlertmanagerConfigVersion`（最近一条 applied；无则 `{ content: '' }`）          | —                                                                | §6.6        |
| GET  | `/api/v2/platform/alertmanager/config/versions`              | Query: `page`、`page_size`                                         | `{ items: [AlertmanagerConfigVersionListItem], total }`                      | —                                                                | §6.6        |
| GET  | `/api/v2/platform/alertmanager/config/versions/{id}`         | —                                                                 | `AlertmanagerConfigVersion` 完整（含 `content` 只读视图）                             | `not_found`                                                      | §6.6        |
| POST | `/api/v2/platform/alertmanager/config/versions/{id}/remount` | body `{ uploaded_by?: string }`                                   | 重新挂载后的最新版本（再次走校验 + M09 变更单，P0 回滚动线）                                          | `bad_request`：校验失败；`not_found`                                   | §9.1 P0     |

### AlertmanagerConfigVersion（当前生效 / 详情）

| 字段                 | 类型       | 说明                                      |
| ------------------ | -------- | --------------------------------------- |
| `id`               | string   | 版本 ID                                   |
| `content`          | text     | `alertmanager.yml` 完整内容（详情返回；列表不返回以省流量） |
| `checksum`         | string   | 配置内容 sha256                             |
| `applied_at`       | datetime | 写入并 reload 成功时间（M09 下发回写后才回填）           |
| `applied_by`       | string   | 应用人（M09 下发回写）                           |
| `status`           | enum     | 本表恒为 `applied`（校验失败不落库，决策 60）           |
| `created_at`       | datetime | 挂载留痕时间                                  |
| `source_change_no` | string   | 关联 M09 变更单号（决策 60，管道侧确认后可见）             |

### 校验失败返回（行级错误）

```jsonc
// bad_request，error.data 形如：
{
  "items": [
    { "file": "alertmanager.yml", "line": 14, "message": "unknown receiver \"sre-critical\" referenced by route" }
  ],
  "note": "校验失败未保存、未生效；修改后请重新挂载"
}
```

> 前端按行定位高亮/列表展示；`file` 恒为 `alertmanager.yml`（单文件挂载），`line` 为 0 表示无行号。

## 4. 静默管理 API（silence service，代理 Alertmanager v2）

> 背景：Alertmanager ≥0.27 已移除 v1 silence 端点（返回 410 Gone），本模块代理必须走 **v2 API**。v2 与 v1 响应形状不同：列表为裸数组、单条为裸对象、创建成功返回 `{"silenceID": "..."}`。

| 方法     | 路径                                                    | Query / 请求体                                                              | 响应 data                        | 业务错误                             | PRD 源        |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ | -------------------------------- | ------------ |
| GET    | `/api/v2/platform/alertmanager/silences`              | Query: `page`、`page_size`；**缺省返回全量（含 pending/expired）**，显式 `active=true` 过滤活跃静默（转发至 AM `/api/v2/silences`） | `{ items: [Silence], total }`  | —                                | §5.2         |
| POST   | `/api/v2/platform/alertmanager/silences`              | body `{ matchers: [Matcher], starts_at, ends_at, comment, created_by? }`（转发至 AM `/api/v2/silences`） | 创建的 `Silence`（含 AM silence ID；由 AM `/api/v2/silences` 返回的 `silenceID` 构造） | `bad_request`：matcher 越权 / 参数不合法 | §5.2 / 决策 56 |
| DELETE | `/api/v2/platform/alertmanager/silences/{silence_id}` | —（转发至 AM `/api/v2/silence/{silence_id}`）                                                                        | 删除成功的静默 ID                     | `not_found`：不存在                  | §5.2         |
| GET    | `/api/v2/platform/alertmanager/silences/label-options` | —（只读聚合端点，仅认证；不代理 AM）                                            | `{ groups: [LabelOptionGroup] }` | —                                | §5.2.1 / 决策 71 |

### Silence

| 字段                      | 类型         | 说明                                               |
| ----------------------- | ---------- | ------------------------------------------------ |
| `id`                    | string     | Alertmanager silence ID                          |
| `matchers`              | \[Matcher] | 标签匹配条件                                           |
| `starts_at` / `ends_at` | datetime   | 生效/失效时间                                          |
| `created_by`            | string     | 创建人                                              |
| `comment`               | string     | 静默原因                                             |
| `status`                | enum       | 状态（active / pending / expired，MVP 列表主要展示 active） |

### Matcher

| 字段         | 类型     | 说明                      |
| ---------- | ------ | ----------------------- |
| `name`     | string | 标签名（如 `alertname`；可匹配键全集见下方「标签选项（决策 71）」） |
| `value`    | string | 匹配值                     |
| `is_equal` | bool   | true=`=`（相等）false=`!=`  |
| `is_regex` | bool   | true=正则匹配（前端预校验合法性，AM 侧 400 兜底） |

> 多条 matcher 之间为 **AND** 关系（同一静默内同时满足才命中）。

### LabelOptionGroup（静默 matcher 标签选项，v1.16 决策 71）

`GET /api/v2/platform/alertmanager/silences/label-options` 响应：`{ groups: [LabelOptionGroup] }`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source` | enum | 分组来源：`target_system` / `template` / `rule` / `external` |
| `label` | string | 分组展示名（系统与采集标签 / 标签模板产出 / 规则标签 / 网域标识） |
| `items` | \[LabelOption] | 该组可匹配键；`{ name, description }` |

聚合口径（**可匹配标签 = AM 收到告警时携带的标签全集，四层并集**，完整论证见 `design-decisions.md` 决策 71）：

1. `target_system`（固定清单）：`resource_id`（决策 47-3 system 强制，实例级静默推荐键）、`instance`（采集地址 `ip:exporter端口`，决策 70）、`job`。
2. `template`（动态）：**被 `enabled + draft_status=ready` 的 ScrapeJob 实际引用的标签模板中 enabled mappings 的 `target_label`**（模板解析同生成器 `LoadTemplateForJob`：显式挂载 → 类别默认模板；跨网域去重）；**不是「所有已生效模板的集合」**——未被生效 Job 引用 / 未下发模板的键不可匹配。该组随生效 Job 覆盖面变化，可为空。
3. `rule`（动态）：`alertname`（自动附加）∪ `enabled + draft_status=ready + scope central/both` 规则的 `severity` 与自定义 `labels` 键（同生成器 `LoadRules` 口径）。
4. `external`（固定清单）：`network_domain_id`、`zone_type`（发往 AM 出口附加的 external_labels；**AM 静默可按网域匹配**，但该层在 Prom `/api/v1/alerts` 中不可见）。

例外：blackbox Job 目标层 labels 为空 → 拨测类告警仅规则层 + external 键可匹配。

## 5. 跨端 M09 变更确认联动（决策 60，前端只读消费）

> 本小节说明前端如何承接「挂载 → M09 确认 → 回写」动线；实际 M09 API 定义见 `docs/05-execution-records/module-09/api-contract-snapshot.md` §12（不重复定义）。

- 挂载成功后，M09 生成**管理域（`default`）scope** `ConfigDraft`：`change_items` 含 `target: alertmanager_config`、`affected_files: ['alertmanager']`、`risk: low`。

- `ConfigDraftDetail` 增可选 `alertmanager_yml` 字段（内容预览 Tab）。

- `change_status` 回写 M08：M09 confirm→下发 reload 成功 → 最新 `AlertmanagerConfigVersion.applied_at/applied_by` 回填、`status=applied`；M08 页面「当前生效配置」从此版本读取。

- 前端动线：M08 告警配置页挂载成功 → 跨模块跳转 `#/config-preview`（管理域 default 变更单）→ 人工确认 → 下发记录可见 → 回 M08 applied（决策 60）。

## 6. 枚举字典

| 枚举                              | 取值                               | 说明                                           |
| ------------------------------- | -------------------------------- | -------------------------------------------- |
| 版本 `status`                     | `applied`                        | AlertmanagerConfigVersion 恒 applied（校验失败不落库） |
| 静默 `status`                     | `active` / `pending` / `expired` | Alertmanager 运行时状态                           |
| Matcher `is_equal` / `is_regex` | bool                             | 决定匹配语义                                       |
| 变更对象 `target`（M09 侧）            | `...` / `alertmanager_config`    | M09 变更单新增「告警配置」目标                            |
| 受影响文件（M09 侧）                    | `...` / `alertmanager`           | 含起始枚举扩展                                      |

## 7. 字段必填口径

- **挂载 POST /config**：`content` 必填（完整 `alertmanager.yml`）；空内容 `bad_request`。

- **静默 POST /silences**：`matchers` 非空、`starts_at`/`ends_at` 必填且 `ends_at > starts_at`、`comment` 必填；MVP 单租户下 matcher 授权校验恒通过。

- **remount**：`uploaded_by` 可选（默认当前登录用户）。

## 8. UI 展示名映射（字段 ↔ 用户语言）

| 接口字段                                   | UI 展示名 | 备注                                     |
| -------------------------------------- | ------ | -------------------------------------- |
| `AlertmanagerConfigVersion.status`     | 状态     | 已生效                                    |
| `AlertmanagerConfigVersion.applied_at` | 生效时间   | <br />                                 |
| `config/current` 空                     | 当前生效配置 | 无版本时显空态引导挂载                            |
| 校验错误 `line`                            | 行号     | 行级定位高亮                                 |
| Silence.status                         | 静默状态   | active=生效中 / pending=待生效 / expired=已过期 |
| 决策 56 授权                               | 静默影响范围 | 页面提示「静默影响当前授权网域」                       |
| `resource_name`                           | 实例名    | M01 资源清单口径（host=`instance_name` 等）；无 `resource_id` 时显示 `-`（v1.15 决策 70） |
| `labels.instance` / `instance_address`     | 采集地址   | Prometheus 抓取地址（`ip:exporter端口`）；表头须提示「采集器地址，非业务端口」（v1.15 决策 70） |

## 9. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`（v1.12）§1/§3.1/§5.1/§5.2/§5.4/§6.3/§6.6/§9

- PRD（v1.12 增量）：`docs/02-product-requirements/Modules/Module_02_Query_Center.md`（v1.12）§3.1/§6.1/§11.1#9/§11.2#5/#14

- M09 联动：`docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.52）§3.4/§5.4/§9.2

- 决策：`docs/05-execution-records/module-08/design-decisions.md`（决策 49/55/56/59/60/61 + 分轨判定记录 2026-09-08）

- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7

- 序列：`docs/05-execution-records/module-08/task-sequence.yaml`；M09 侧：`docs/05-execution-records/module-09/task-sequence.yaml`（T09-60-\*）

## 10. 告警状态查看 API（v1.12 MVP 增量，Track B+）

> 背景：MVP 试用反馈「前台缺少查看当前告警入口」，告警状态查看由 v0.3 提前至 MVP（M08 PRD v1.12 / M02 PRD v1.12）。告警状态页归属 M08（决策 55），双视图：Prometheus 触发告警（M02 代理，本节 §10.1）+ Alertmanager 通知状态（M08 代理，本节 §10.2）。两条均为**只读代理**，不改既有契约；分轨 Track B+，强制 security-reviewer。

### 10.1 M02 侧：Prometheus 当前触发告警代理

| 项 | 内容 |
|----|------|
| 方法 / 路径 | `GET /api/v1/alerts`（注册在 `/api/v1` 组，命中认证中间件；与决策 47 批次 `/api/v1/targets` 代理同构，`platform/query/`） |
| 上游 | Prometheus `GET /api/v1/alerts` |
| Query | `network_domain`（可选）：按告警 `labels.network_domain` 服务端本地过滤（缺失标签回落 `default`，与 targets 代理同构）；后端承担过滤，前端不重复过滤 |
| 注入 | 租户/网域上下文注入骨架 MVP 恒通过、机制保留（M02 §11.2#5）；**不代理 Alertmanager 通知状态**（M02 §11.2#14 边界） |
| 业务错误 | `internal`：上游不可达 / 非 success |

响应 `data`：`{ alerts: [PromAlertItem] }`（空结果返回 `[]` 而非 `null`）。`PromAlertItem` 为 Prometheus Alert 字段子集：

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| `labels` | map | — | 告警标签（含 `alertname` / `severity` / `network_domain` / `instance`） |
| `labels.alertname` | string | 告警名称 | 规则名 |
| `annotations` | map | — | 告警注解（`summary` / `description`） |
| `annotations.summary` | string | 摘要 | 页内说明列 |
| `state` | enum | 状态 | `firing`（触发中）/ `pending`（待处理） |
| `activeAt` | datetime | 激活时间 | 进入 pending 的时间 |
| `value` | string | 当前值 | 告警表达式当前求值 |
| `labels.network_domain` | string | 网域 | 缺失回落 `default`；**由服务端回写**（见下方「网域取值口径」） |
| `labels.instance` | string | 采集地址 | **Prometheus 抓取地址**：`ip:exporter端口`（host / database / middleware 默认 `:9100`）、generic_target 为 `ip:业务端口`、application / 拨测为完整 URL。**既不是实例名，端口也不是 M01 里用户填的业务端口**；UI 表头须提示「采集器地址，非业务端口」（v1.15） |
| `instance_address` | string | 采集地址（语义化字段） | = `labels.instance` 原文；缺失时依次回落 `instance_ip` → `nodename` → `device`。与 `labels.instance` 同值，供前端列渲染取用（v1.15） |
| `resource_id` | string | — | 告警标签 `resource_id`（决策 47-3 强制注入，system 层不可覆盖）；无则为空串。**服务端以此回连 M01 资源表**（v1.15） |
| `resource_name` | string | 实例名 | **M01 资源清单口径的实例名**：host=`instance_name`、database/middleware=`instance_ip`、application=`service_name`、generic_target=`target_name`（对齐 M07 §5.12 展示口径）；无 `resource_id` 或回连未命中时为空串（前端显示 `-`，**不回落成地址**）（v1.15） |
| `resource_category` | string | — | 五类资源枚举 `host` / `database` / `middleware` / `application` / `generic_target`；未命中为空串（v1.15） |
| `resource_ip` | string | — | 资源 IP（host=`private_ip`、database/middleware/generic_target=`instance_ip`）；未命中为空串（v1.15） |
| `resource_port` | int | — | 资源**业务**端口（与「采集地址」中的 exporter 端口不同）；`0` 表示该类别无业务端口（如 host）（v1.15） |
| `instance_display` | string | 实例展示值（兼容字段） | **语义修订**：`resource_name` 非空取之，否则取 `instance_address`；两者皆空为空串（聚合 / 全局告警）。既有消费方无需改动（v1.15） |

> **标签 `instance` 的语义（v1.15 决策 70）**：`instance` 是 Prometheus 标准语义的抓取目标地址，**本平台不改其取值**——中心 `alertmanager.yml` 的 `group_by: ['alertname','instance']`（聚合分组）与 `equal: ['instance']`（抑制规则）直接依赖它，改成可读名会破坏告警分组与抑制。因此「实例可读化」走**平行字段**（`resource_name` 回连回填），而非改写 `instance`。

> **网域取值口径（2026-09-10 缺陷修复 F-07；键名经决策 68-1 收敛）**：上游 Prometheus `GET /api/v1/alerts` 返回的是**规则求值标签**——Prometheus 仅在 remote write / federation / 发往 Alertmanager 时附加 `global.external_labels`，因此告警标签中通常**不含**网域键。代理若只做 `labels["network_domain"]` 读取，前端「网域」列对每一行都渲染 `-`（本次缺陷根因）。
>
> 服务端解析顺序（`models.ResolveNetworkDomain`，**唯一入口，双读为常驻过渡层**）：
>
> 1. `labels.network_domain`——**全平台唯一标签键口径**（M02 决策 4.4 注入标签 key 契约；M09 侧 `external_labels` 键名经**决策 68-1** 于 2026-09-10 由 `network_domain_id` 收敛为 `network_domain`，决策 19 的键名选择被 supersede），调用方已归一或显式注入时优先；
> 2. `labels.network_domain_id`——**历史/兼容键**：覆盖 2026-09-10 之前生成的部署级 `external_labels` 以及边缘网域经 vmagent `remote_write` 回传的存量序列所携带的网域；因存量序列会长期存在，本分支**永久保留、不随收敛删除**；
> 3. 兜底 `default`。
>
> 解析结果（含兜底值）**必须回写进响应 `labels.network_domain`**，语义与 `/api/v1/targets` 回写 `t["network_domain"]` 同构；否则前端无值可渲染。Query `network_domain` 过滤与授权收敛均以解析后的网域为准。
>
> **命名空间区分（不得混用）**：`network_domain_id` 仍是**对象 / API 字段**（`NetworkDomain.id`、`Resource.network_domain_id`、M09 管理面 Query 参数、`ConfigDraft` / `ConfigVersion` 字段），只是**不再是 Prometheus 标签键**。详见 `module-09/network-domain-label-key-convergence-and-alerting-wiring.md`。

### 10.2 M08 侧：Alertmanager 通知状态代理

| 项 | 内容 |
|----|------|
| 方法 / 路径 | `GET /api/v2/platform/alertmanager/alerts`（管理面前缀，命中认证中间件；读路径仅认证，挂法同静默列表） |
| 上游 | Alertmanager `GET /api/v2/alerts`（**v2 口径**，决策 61 对齐；v1 端点已移除，禁止调用） |
| Query | `network_domain`（可选，UX 筛选透传）；**授权过滤由服务端强制注入**（决策 56：当前用户授权网域集合 filter，授权=全部网域时不附加，不信任前端传参；MVP 单租户恒通过，骨架保留） |
| 业务错误 | `internal`：AM 不可达 / 非 2xx |

响应 `data`：`{ items: [AmAlertItem] }`（空结果返回 `[]` 而非 `null`）。`AmAlertItem` 为 AM v2 GettableAlert 字段子集 + 服务端归一 `notify_status`：

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| `labels` | map | — | 告警标签（`alertname` / `severity` / `network_domain` / `instance`）；`labels.instance` 语义同 §10.1（**采集地址，非实例名**，v1.15） |
| `labels.network_domain` | string | 网域 | 缺失回落 `default`；**由服务端归一后回写**，解析顺序同 §10.1（`network_domain` → `network_domain_id` → `default`） |
| `annotations` | map | — | 告警注解（`summary` / `description`） |
| `starts_at` | datetime | 开始时间 | 告警进入 AM 时间 |
| `ends_at` | datetime | 结束时间 | 告警预计结束时间 |
| `status.state` | enum | — | AM 原始态：`unprocessed` / `active` / `suppressed`（输入，不直接外露） |
| `status.silenced_by` | []string | — | 命中静默 ID 列表（输入） |
| `status.inhibited_by` | []string | — | 命中抑制告警 ID 列表（输入） |
| `notify_status` | enum | 通知状态 | **服务端归一四态**：`active`（通知中，state=active）/ `silenced`（静默，suppressed 且 silencedBy 非空）/ `inhibited`（抑制，suppressed 且 inhibitedBy 非空）/ `unprocessed`（待处理，state=unprocessed） |

> 四态映射优先级：`silenced` / `inhibited` 判定优先于 `active`；AM 侧 `suppressed` 不外露，由 silencedBy / inhibitedBy 拆解。原型既有「接收人」列在 AM v2 响应中**无数据源**（路由归属不回传），本轮裁剪（见 `frontend-prototype-map.md` §八）。
>
> **实例字段（v1.15 决策 70）**：本节响应同样包含 §10.1 的 `instance_address` / `resource_id` / `resource_name` / `resource_category` / `resource_ip` / `resource_port` / `instance_display` 七个字段，语义与取值口径完全一致（服务端按 `labels.resource_id` 批量回连 M01 五类资源表；无 `resource_id` 时 `resource_name` 为空串）。M08 侧需在注册时把 `*gorm.DB` 传给 `alerts.NewService`，回连查询为只读、不写 M01 任何表。

### 10.3 与既有章节的 diff

- 新增两条只读代理 API，既有 §3（配置挂载/版本）/ §4（静默）/ §5（M09 联动）契约不变。
- §1.3 授权利令的「读路径」条款自本节起有实际承载端点（此前仅静默写路径）。
- 枚举字典（§6）追加：`notify_status` = `active` / `silenced` / `inhibited` / `unprocessed`；Prometheus `state` = `firing` / `pending`。
- 来源：M08 PRD v1.12 §5.4/§9.1/§9.2；M02 PRD v1.12 §6.1/§11；决策 55/56/61。
- **2026-09-10 修正（F-07，§10.1/§10.2 网域取值口径）**：`labels.network_domain` 明确为「服务端解析 + 回写」字段，解析顺序 `network_domain` → `network_domain_id` → `default`。字段名与响应形状不变（无破坏性变更），仅补齐此前缺失的实现约定；同口径同步至 `/api/v1/alerts/history`（字段为顶层 `network_domain`）与 `/api/v1/targets` 的既有回写语义。
- **2026-09-11 扩展（决策 70，§10.1/§10.2 实例字段）**：三条告警读取链路（§10.1 `/api/v1/alerts`、`/api/v1/alerts/history`、§10.2 `/api/v2/platform/alertmanager/alerts`）新增 `instance_address` 与 `resource_id` / `resource_name` / `resource_category` / `resource_ip` / `resource_port` 六个字段，同口径同步至 `/api/v1/alerts/history`（该接口字段为顶层 `alertname` / `instance` / `network_domain` …，新增字段与之平级）。`instance_display` 由「回落链取值」修订为「`resource_name` 非空取之，否则取 `instance_address`」，**旧字段全部保留、无破坏性变更**。UI 侧「实例」列拆为「实例名」（`resource_name`，无则 `-`）+「采集地址」（`instance_address`，表头提示「采集器地址，非业务端口」）；历史告警页「实例」筛选参数 `instance` 的服务端语义扩展为**同时匹配 `instance_address` 与 `resource_name`**（`strings.Contains`，任一命中即保留）。回落链同步修订为 `instance_name → instance → instance_ip → service_name → nodename → device`（删除默认标签模板从不产出的死键 `hostname`、补入 application 实际产出的 `service_name`）。
- **2026-09-10 收敛（决策 68-1，§10.1/§10.2 键名口径）**：M09 生成侧 `external_labels` 键名由 `network_domain_id` 收敛为 `network_domain`，§10.1/§10.2 的解析顺序**不变**，但第 2 项 `labels.network_domain_id` 定位由「写入侧当前键」修订为「**历史/兼容键（永久保留）**」；`network_domain` 明确为全平台唯一 Prometheus 标签键，`network_domain_id` 自此仅作对象 / API 字段。字段名与响应形状仍不变（无破坏性变更）。本决策同时补齐 M08 PRD §9.1/§9.2 的投递接线验收（Prometheus → AM `alerting.alertmanagers`，承载方 M09），见 `module-09/network-domain-label-key-convergence-and-alerting-wiring.md`。

