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
| 版本    | v2026-10-23（**§11 as-landed 同步（dev-feedback #45–#52）**：默认 alertmanager.yml seed 入库、新增 `POST /routes` 后端整份生成（`base_checksum` + route_tree）、接收人合法集合 = `default` ∪ `notify-<ID>`、模板改可变实体并退出 yml（`?id=` 单参数）、只物化被路由引用渠道、去 `enabled` / 去内部桥令牌 / 去 receiver-snippet / 去 route-setting / 去导入与重挂端点、新增 `webhook` 渠道类型 + IM 模板必填 + 钉钉加签补实现、`BuildAlertmanagerConfig` 唯一生成规则）叠加 v2026-09-29（**新增 §11**：PL-3 通知渲染桥与渠道 / 模板管理全部端点 + 字段 + 鉴权 + B 路线 M09 物化行为，决策 74 方案 B；H-1 令牌改 `Authorization: Bearer` 请求头、M-2 webhook 私网拒绝）叠加 v2026-09-18（§10.4 补登 `GET /api/v1/alerts/history` 请求参数与 envelope + 「7d 窗口 × 默认步长」点数上限约束，决策 90）叠加 v2026-09-11b（§4 新增 `GET /silences/label-options` 静默 matcher 标签选项聚合端点 + LabelOptionGroup 响应结构，Matcher 补 AND 语义与正则预检说明，v1.16 决策 71）叠加 v2026-09-11（§10.1/§10.2 实例字段扩展，决策 70：新增 `instance_address` / `resource_id` / `resource_name` / `resource_category` / `resource_ip` / `resource_port`，`instance_display` 语义修订为「`resource_name` 非空取之，否则取 `instance_address`」，`labels.instance` 明确为**采集地址**；不删旧字段、向后兼容）叠加 v2026-09-10（§10 网域取值口径修正：`labels.network_domain` 明确为服务端解析 + 回写，F-07；**同日决策 68-1 键名收敛**——`labels.network_domain_id` 定位修订为历史/兼容键、`network_domain` 为唯一标签键；字段名与响应形状不变）                                                                                                                                                                                                                                             |
| 生成方式  | planner 派生（决策 59/60，承接决策 47；开发期决策 61 修正 silence API 为 v2；v1.12 告警状态查看提前 MVP；2026-09-10 决策 68-1 键名口径收敛；2026-09-29 开发侧补登 PL-3 端点与物化行为，决策 74）                                                                                                                                                                                                                                |
| 来源    | PRD `Module_08_Alertmanager_Notification_Management.md`（v1.12）§1/§3.1/§5.1/§5.2/§5.4/§6.3/§6.6/§9；PRD `Module_02_Query_Center.md`（v1.12）§3.1/§6.1/§11；PRD `Module_09`（v1.52）§3.4/§5.4/§9.2；`design-decisions.md` 决策 49/55/56/59/60/61/74 + 分轨判定记录 2026-09-08；`design-proposals/alert-config-scope-and-notification-bridge.md` §3.3；`security-review-pl3.md`；`03_API_Standard.md` §7；`05_Code_Implementation_Plan.md` §7.8/§7.9；`task-sequence.yaml` |

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
| GET  | `/api/v2/platform/alertmanager/config/current`               | —                                                                 | 当前生效 `AlertmanagerConfigVersion`（最近一条 applied；无则 `{ content: '' }`）          | —                                                                | §6.6        |
| GET  | `/api/v2/platform/alertmanager/config/versions`              | Query: `page`、`page_size`                                         | `{ items: [AlertmanagerConfigVersionListItem], total }`                      | —                                                                | §6.6        |
| GET  | `/api/v2/platform/alertmanager/config/versions/{id}`         | —                                                                 | `AlertmanagerConfigVersion` 完整（含 `content` 只读视图）                             | `not_found`                                                      | §6.6        |

> **⚠️ 导入 / 重新挂载入口已删除（2026-10-23，dev-feedback #51 / #52）**：alertmanager.yml 收敛为**唯一生成规则**（`generator.BuildAlertmanagerConfig`，见 §11.6）后，配置唯一写入口 = **路由规则页保存（`POST /routes`）**；本表原「`POST /config` 导入整份」与「`POST .../versions/{id}/remount` 重新挂载」两行端点整体删除，前端对应方法一并删除。内部 `config.Submit` 保留，仅作为路由保存链路的「amtool 校验 + 版本留痕 + 触发 M09」工序，不再对外暴露。2026-10-02「remount 已无前端调用方、保留不下线、`POST /config` 导入」的过渡口径随之废止。

### AlertmanagerConfigVersion（当前生效 / 详情）

| 字段                 | 类型       | 说明                                      |
| ------------------ | -------- | --------------------------------------- |
| `id`               | string   | 版本 ID                                   |
| `content`          | text     | `alertmanager.yml` 完整内容（详情返回；列表不返回以省流量） |
| `checksum`         | string   | 配置内容 sha256                             |
| `applied_at`       | datetime | 写入并 reload 成功时间（M09 下发回写后才回填）           |
| `applied_by`       | string   | 应用人（M09 下发回写）                           |
| `status`           | enum     | `applied`（已收录为 M09 下发源；`applied_at` 空 = 待确认下发，有值 = 已生效）或 `discarded`（已废弃终态，2026-10-13 dev-feedback #44 废弃联动：变更单被废弃/被取代后，已无活 pending 单可确认的留痕由后端标记，前端展示「已废弃」并给恢复指引，不再显示「已提交，待确认下发」） |
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

- `change_status` 回写 M08：M09 confirm→下发 reload 成功 → **本单来源** `AlertmanagerConfigVersion.applied_at/applied_by/source_change_no` 回填（2026-10-13 dev-feedback #44 修订：原为「最新一条 applied 留痕」无条件回填，在 reuse 路径（同产物骑窗版本复用旧单）下来源版本反而遗留「已提交，待确认下发」；现按草稿登记的 `alertmanager_source_version_id` 精确回填来源版本，并一并标记创建时间不早于来源的待确认骑窗版本——它们产物与本单 checksum 相同、内容同样随本单下发；存量单回落旧口径但仅补未生效留痕，不覆盖已生效版本时间戳）；M08 页面「当前生效配置」从此版本读取。

- **M08 apply = 收录 + 产 pending 变更单（2026-10-09 修订，原为「收录 + 自动下发管理域」）**：挂载校验通过落库（`status=applied` 仅表示「已收录为 M09 源」）后，M08 触发 M09 管理域 `default` 变更检测，产出（或复用/取代）一张 **pending** 变更单；**不再自动确认下发**。变更单须由用户在 M09「配置变更确认」页人工 `ConfirmDraft` 后，才走 `DiskApplier` 写 `config-output/alertmanager.yml` + AM reload。**配置是否真实生效以 `applied_at` 为准**（写盘成功后由 `writebackAlertmanagerApplied` 回填）。

  > **修订原因（本条为口径变更，非措辞调整）**：原 dev-feedback §25 方案 A 在此实现「提交即自动 `ConfirmDraft`」，导致 ①高危变更（路由结构调整 / 默认兜底接收人）未经用户复核即自动上线；②与前端「待变更单确认下发」文案自相矛盾——文案要求用户去 M09 确认，但该单已被系统自行确认，M09「待确认」视图里查不到，用户误判为功能故障。2026-10-09 用户裁决立场 1（保留人工闸门）后关闭自动闭环。同域多单取代口径（决策 42-1 / 44-2）不变。

- 前端动线：M08 告警配置页 / 路由规则页提交成功 → 生成 M09 `default` pending 变更单（**不即时生效**）→ 用户前往 M09「配置变更确认」人工确认 → 落盘 + AM reload → 回 M08 读 `applied_at` 判定「已生效」（`applied_at` 为空即仍待确认）。

## 6. 枚举字典

| 枚举                              | 取值                               | 说明                                           |
| ------------------------------- | -------------------------------- | -------------------------------------------- |
| 版本 `status`                     | `applied` / `discarded`          | applied：已收录（`applied_at` 空 = 待确认下发 / 有值 = 已生效）；discarded：已废弃终态（#44 废弃联动） |
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
| `AlertmanagerConfigVersion.status`     | 状态     | 派生展示（dev-feedback §25 + #44）：`discarded`=已废弃；`applied` 且 `applied_at` 有值=已生效；`applied` 且为空=已提交，待确认下发 |
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

- **2026-09-18 补登与约束（决策 90，新增 §10.4）**：补登 `/api/v1/alerts/history` 的**请求参数与 envelope**（该端点自 v1.13 起上线，此前无契约快照承载，仅 M02 PRD §5.4 有字段表）；明确「**7d 窗口 + 默认 30s 步长**」超出 Prometheus `query_range` 单序列 11000 点上限、必返 400，故**调用方必须显式传 `step`**（前端统一 `ALERT_HISTORY_STEP_SECONDS = 60`），服务端同时按窗口抬高步长兜底并回显 `data.step`。既有字段名与响应形状**不变**（`step` 为附加字段），§10.1/§10.2 无改动。

### 10.4 M02 侧：历史告警代理（`GET /api/v1/alerts/history`，v1.13 增量，2026-09-18 补登）

> **本节补登（2026-09-18，决策 90）**：该端点自 v1.13 起由 M02 交付、由 M08 历史告警页与 M05 首页告警卡消费，但**此前未进任何契约快照**——M02 快照 §4 把两条告警代理的字段口径统一指向本文件 §10.1，而 §10.1 只覆盖 `/api/v1/alerts`。此处补登**请求参数与 envelope**；告警条目字段清单的权威仍在 `Module_02_Query_Center.md` §5.4（含 v1.15 决策 70 的实例字段），本节不重复登记以免两处漂移。

| 项 | 内容 |
|----|------|
| 方法 / 路径 | `GET /api/v1/alerts/history`（注册在 `/api/v1` 组，命中认证中间件） |
| 上游 | Prometheus `GET /api/v1/query_range`，`query = ALERTS{alertstate="firing"}`；另调 `GET /api/v1/rules` 回填 `summary`（失败降级，不阻塞列表） |
| Query | `network_domain`（可选，授权集合收敛，决策 56）／`alertname`／`instance`（**同时匹配实例名与采集地址**，v1.15 决策 70）／`state`（`all`/`firing`/`resolved`，默认 `all`）／`start`・`end`（RFC3339，默认最近 24h、最大 7d）／`step`（秒，**期望粒度**，默认 30、最小 15；服务端可按窗口抬高，见下）／`page`・`page_size`（默认 1/50，上限 200） |
| 响应 `data` | `{ list: [AlertHistoryItem], total, page, page_size, step }`；空结果 `list=[]`（非 `null`） |
| `data.step` | **实际生效**的 `query_range` 步长（整数秒）。服务端会把过密步长按窗口抬高，使 `floor(window/step) + 1 ≤ 11000`（Prometheus `query_range` 单序列点数上限，upstream `maxPointsPerTs`）。**附加字段，向后兼容**（2026-09-18 决策 90） |
| 业务错误 | `bad_request`：`state`/`start`/`end`/`step` 非法；`internal`：上游不可达 / 非 success（含上游 400 点数超限） |

> **调用方约束（决策 90，强制）**：「最大窗口（7d）＋ 默认步长（30s）」是**超出上游点数上限的非法组合**（20160 点 > 11000），上游直接返回 400 → 本接口 500 → 消费方整页/整卡不可用（2026-09-18 实测缺陷）。因此：
>
> 1. **调用方必须显式传 `step`** —— 前端统一取 `ALERT_HISTORY_STEP_SECONDS = 30`（`ui-custom/web/src/api/alertmanager.ts`；= PRD 默认步长，细粒度）；
> 2. **服务端有兜底** —— 即使未传、或传得过密，也会按窗口抬高步长（**只抬高、不压低**），保证该组合恒能返回 200；实际生效值一律以 `data.step` 为准（7d 窗口下传入 30s 会被抬到 55s）；
> 3. **`step` 的语义是「期望粒度」而非「必须满足上限的取值」** —— 调用方只需表达想要的粒度（前端取 30s，窄窗口保持精度），点数上限由服务端保证；`step` 默认 30s 的入参语义不变（未传时取 30、小于 15 时抬到 15）。
>
> **估算精度**：「恢复时间（估算）」= 最后一个 firing 样本时间 + 一个**实际生效 step**；「持续时长」同样以 step 为粒度。**窄窗口（< 约 91.6h）实际生效 step 为 30s**（调用方传入的期望粒度原样保留，默认 24h 窗口不受影响）；宽窗口被抬高（7d → 55s）时估算偏差点上限随之变大——本页已按「估算值」对用户披露（决策 9），`data.step` 供消费方自查。

## 11. PL-3 通知渲染桥与渠道 / 模板管理 API（v2026-09-29 增量，决策 74）

> **本节补登（2026-09-29，决策 74 方案 B）**：PL-3（通知渠道 / 通知模板 / 平台内置渲染桥）此前仅在**设计提案**中定义（`design-proposals/alert-config-scope-and-notification-bridge.md` §3.3），未进任何契约快照（dev-feedback #17 / #21）。本节按已落地的实现与**决策 74 定稿补充**（`design-decisions.md`，2026-09-29）补登全部端点、字段、鉴权与错误码；**权威以本节为准**，提案降为设计背景。
>
> **方案 B 口径（决策 74 定稿）**：已启用渠道的接收人生效引用由 **M09 配置生成器自动物化**进管理域（`default`）的 `alertmanager.yml`（配置即生效，与 M07 `LabelTemplate` 同范式）；「接收人配置片段」端点降为用户**手写自定义 receiver** 时的参考。物化行为见 §11.6。

### 11.1 端点总表

| 方法 | 路径 | 请求体 / Query | 响应 data | 鉴权 | 业务错误 |
| ---- | ---- | -------------- | --------- | ---- | -------- |
| GET | `/api/v2/platform/alertmanager/notify-channels` | — | `{ items: [ChannelView] }`（含 `route_reference_count`，#46） | 全局认证（读） | — |
| POST | `/api/v2/platform/alertmanager/notify-channels` | `{ name, type, webhook_url, secret?, default_template_id? }`（`type` 含新增 `webhook` 自定义渠道，#48；**无 `enabled`**，#46） | `ChannelView` | `RequireAdmin` | `bad_request`：名称空 / 类型非法 / webhook 非法（含私网、环回、link-local、云元数据地址，见 §11.5）/ **IM 类型模板必填**（缺省且无内置默认时拒绝，#48）/ `webhook` 类型禁止绑定模板（#48） |
| PUT | `/api/v2/platform/alertmanager/notify-channels/{id}` | 字段**指针语义**（仅更新显式提供项）；编辑回填**脱敏**值（IM：`webhook_url`=`scheme://host/***`、`secret`=`***`），**保持原值=不修改、显式提交空串=清空并触发必填校验**（#48）；签名开关关闭 = 显式提交 `secret: ""` 清空已存密钥（#47）；`channel_type` 切换时关闭签名并清空旧密钥（#47） | `ChannelView` | `RequireAdmin` | `bad_request`；`not_found` |
| DELETE | `/api/v2/platform/alertmanager/notify-channels/{id}` | — | `{}` | `RequireAdmin` | `not_found`；**`409`：被当前生效 / 待确认路由树引用时拒绝删除**，须先到路由规则页改绑（#46 删除保护；`route_reference_count` 供前端前置提示） |
| GET | `/api/v2/platform/alertmanager/notify-templates` | — | `{ items: [TemplateView] }` | 全局认证（读） | — |
| POST | `/api/v2/platform/alertmanager/notify-templates` | `{ name, channel_type, content }` | `TemplateView` | `RequireAdmin` | `bad_request`：Go template 语法校验失败 / 渠道类型非法 / 名称重复（#46） |
| PUT | `/api/v2/platform/alertmanager/notify-templates/{id}` | `{ name?, content? }`（`channel_type` **创建后锁定不可改**，#46） | `TemplateView` | `RequireAdmin` | `bad_request`：语法失败；内置模板只读不可编辑 |
| DELETE | `/api/v2/platform/alertmanager/notify-templates/{id}` | — | `{}` | `RequireAdmin` | `bad_request`：被渠道绑定引用、须先改绑（#46）；内置模板不可删除 |
| POST | `/api/v1/webhooks/notify` | Query `id`（必需，真实数字渠道 ID；原 `channel` / `template` 参数随 #46 退出）；body = AM 原生 webhook 载荷 | `{ success, fail }` | **无内部令牌**（2026-10-23 #47 起删除令牌校验，访问安全由部署层网络限制承载，见 §11.2；生产必须做网络层限制） | `bad_request`（渠道缺失 / 携带请求方目标地址参数 / 模板与渠道类型不匹配）；`not_found`（渠道未登记）；`bad_gateway`（出站失败） |
| GET | `/api/v2/platform/alertmanager/routes` | — | 成功 `{ items: [RouteNode], declared_receivers: [string], effective_checksum: string, pending: { change_no, created_at }\|null }`；解析失败 **200** `{ parse_error, raw_yaml, declared_receivers, effective_checksum, pending }`（见 §11.9；`mode` / `dead_receivers` 字段已删除，#45/#46） | 全局认证（只读） | —（解析失败仍 200，非 500） |
| POST | `/api/v2/platform/alertmanager/routes` | `{ base_checksum: string, route_tree: [RouteEditNode] }`（`base_checksum` = 进入编辑时 `GET /routes` 回传的 `effective_checksum`，仅作乐观锁） | `{ version: AlertmanagerConfigVersion, change_no? }`——**YAML 由后端生成**（#45）：树 / 接收人校验 → `GenerateRouteSection` → `BuildAlertmanagerConfig`（#51 唯一规则） → `config.Submit`（amtool 校验 + 落版本 + 触发 M09 变更单，`pending` 待人工确认） | `RequireAdmin` | `409` 乐观锁冲突；`bad_request`：树校验失败 / `receiver_dangling`（合法集合 = `default` ∪ `notify-<ID>`） |

> 注：`/routes` 字段表与数据源口径见 §11.9；`route` / `receivers` 归属边界（2026-10-23 起收敛为「平台唯一作者」）见 §11.10。
>
> **以下端点已删除（2026-10-22/23）**：`GET /notify-channels/{id}/receiver-snippet`（#47 去「接收人配置」）、`GET|PUT /route-setting`（#45 删根兜底接管设定）、`POST /notify-templates/{id}/remount`（#46 模板改可变实体去版本留痕）、`POST /config`（导入整份）与 `POST /config/versions/{id}/remount`（#52，见 §3）。

### 11.2 桥端点鉴权

> **2026-10-23（#47）：内部桥令牌整体删除。** 移除 `NOTIFY_BRIDGE_TOKEN` / `--notify.bridge-token` 启动配置、`/api/v1/webhooks/notify` 的 Bearer 校验、M09 receiver `http_config.authorization` 写入、Makefile / 交付包 env.sh 的令牌配置。桥端点访问安全改由**部署层承载**（同机部署 / 内网防火墙限制）。**⚠️ 安全提示**：任何能访问 `/api/v1/webhooks/notify` 的人都能伪造通知，生产部署必须做网络层访问限制。
>
> ———— 以下为 2026-09-29 H-1 令牌口径，**已废止，仅留档** ————

- 【留档·已废止】调用方为**中心 Alertmanager**，凭据为平台内部通知桥令牌，由 `--notify.bridge-token`（env 覆盖 `NOTIFY_BRIDGE_TOKEN`）注入；**令牌为空时桥端点一律 401**（安全默认，不开放匿名转发）。
- 【留档·已废止】**令牌经请求头 `Authorization: Bearer <token>` 传递，绝不写入 URL query**（`gin.Default()` 访问日志会明文落盘 RawQuery；此项为 security-reviewer H-1 必修）。AM 侧对应 `webhook_configs.http_config.authorization`（`type: Bearer` + `credentials`），由 M09 物化或用户手写片段产出。
- 【留档·已废止】常量时间比较校验令牌；鉴权失败不产生任何出站。

### 11.3 ChannelView / TemplateView

| ChannelView 字段 | 类型 | 说明 |
| ---------------- | ---- | ---- |
| `id` | string | 渠道 ID（**数字串**；桥 URL query 与物化 receiver 均引用此值） |
| `name` | string | 渠道名（用户可见；receiver 名与渠道名**解耦**——恒 `notify-<ID>`，#46） |
| `type` | enum | `feishu` / `dingtalk` / `wecom` / `webhook`（自定义 Webhook，#48） |
| `webhook_url` | string | IM 类型**脱敏**回填 `scheme://host/***`（绝不回显完整地址与 token）；`webhook` 类型**明文**返回（#48）——用户能看到「已配置」 |
| `secret_set` | bool | 是否已设置加签密钥（**不回显 secret**，展示 `***` 占位）；`webhook` 类型无签名概念 |
| `default_template_id` | number? | 绑定的通知模板 ID（**缺省/`null` = 用该渠道类型的内置默认模板**）；**IM 类型必填**（飞书自动选中内置「飞书卡片-默认」；钉钉 / 企微无内置模板、必须选自定义模板，#48）；`webhook` 类型禁止绑定。桥投递时按渠道 ID 实时读 DB——写进 / 换绑 / 改模板内容**不进 yml、不触发 M09**（#46） |
| `route_reference_count` | int | 被当前生效 / 待确认路由树引用的次数（删除保护前置提示；`0` = 未被引用，为正常状态不打标记，#46） |
| `created_at` | datetime | 创建时间 |

> **2026-10-22/23（#46/#47）**：`enabled` 字段删除（渠道无启停概念，启动迁移显式 DROP `notify_channels.enabled`）；前端列表收敛为五列通用列——渠道名称 / 渠道类型 / 被引用次数（0 显示 0）/ 创建时间 / 操作（编辑、删除）；Webhook、签名、模板等类型独有字段只在编辑抽屉；「接收人配置」能力删除（见 §11.4）。

| TemplateView 字段 | 类型 | 说明 |
| ----------------- | ---- | ---- |
| `id` / `name` | string | 模板 ID / 名称（名称唯一，#46） |
| `channel_type` | enum | 适用渠道类型（渲染时须与渠道类型一致，否则桥 400）；**创建后锁定不可改**（#46） |
| `content` | string | Go `text/template` 内容（白名单 FuncMap，含 `jsonStr` 等） |
| `is_builtin` | bool | 是否内置（**内置模板置顶只读**：仅可查看 / 复制，不可编辑删除；飞书有内置默认模板，钉钉 / 企微暂无内置模板，#47） |
| `created_at` | datetime | 创建时间 |

> **2026-10-23（#46）：模板是可变实体、不是版本留痕。** `checksum` / `status` / 版本历史 / remount 端点全部删除；新建、编辑、复制、删除均**原地生效**——改模板内容立即生效（桥投递时实时读 DB），不产生 M09 变更单、不 reload。原「append-only + checksum/status 版本留痕」口径废止。

### 11.4 ReceiverSnippet（手写自定义 receiver 的参考片段）

> **已删除（#47，2026-10-23）**：「接收人配置」能力与 `GET /notify-channels/{id}/receiver-snippet` 端点**整体移除**——receiver 名已恒为 `notify-<ID>` 且 URL 由唯一生成器统一产出（`NotifyBridgeURL` + `?id=<渠道ID>`，#51），参考片段失去存在意义（保留 `DeriveBridgeBaseURL` 仅供 M09 物化使用）。原字段表（`receiver_name` 归一 / `?channel=` / `?template=` / 令牌占位 `REPLACE_WITH_BRIDGE_TOKEN` 等）语义均已演进或废止，仅属历史留档，不再赘述。

### 11.5 渠道 webhook 地址校验（M-2 修订）

- 仅允许 `http` / `https` scheme 且 host 非空。
- **默认拒绝**私网（`10./172.16-31./192.168.`）、环回（`127.0.0.1` / `localhost` / `[::1]`）、link-local、未指定（`0.0.0.0`）、云元数据（`169.254.169.254`）地址——SSRF 防护（AGENTS.md §9）。
- 内网自建机器人属业务例外，提供**显式允许开关**（进程内 `SetAllowPrivateWebhookTargets`，测试 / 内网部署显式开启）。

### 11.6 alertmanager.yml 唯一生成规则 + receivers 物化（2026-10-22/23 收口：#45 / #46 / #51 / #52）

M09 管理域生成与路由保存共用**同一套唯一生成器** `generator.BuildAlertmanagerConfig(AlertmanagerConfigInput)`——全局任何重新生成路径（保存路由 / M09 生成 / 重校）输出**同一份完整 `alertmanager.yml`**，不存在模板 / 骨架内的局部 patch：

- **产物结构（#51）**：`global.resolve_timeout: 5m`（平台固定）+ `route`（输入段）+ `receivers` = 内置空 `default` + route 引用渠道的 `notify-<渠道ID>`（按渠道 ID 升序）。
- **两入口只做输入转换**（#51）：保存路由 = `GenerateRouteSection(路由树)` → `BuildAlertmanagerConfig`；M09 生成 / 重校 = `ExtractRouteSection(存量 yml)` → `BuildAlertmanagerConfig`（共用装配 `generator.LoadAlertmanagerConfigInput`：加载渠道 + 入口地址，避免口径漂移）。
- **桥地址与 URL（#46/#52）**：`webhook_configs[].url` = `NotifyBridgeURL`（generator 运行时配置，启动注入，保存 / 生成两入口同值）+ `?id=<渠道ID>` ——**保存期直接写完整 URL，不再「先 name 占位、下发再补全」**；原 `?channel=` / `?template=` 参数、`http_config.authorization` 令牌段全部退出。
- **只物化被路由引用的渠道**（#46）：渠道本身不写 yml；新增渠道不产生 receiver、未被引用的渠道不物化；**路由引用集合变化才触发 yml / M09 变更单**；`NotifyChannel` / `NotifyTemplate` 移出 M09 `sourceTableScopes`——渠道 / 模板 CRUD 不再空跑变更检测（改模板 / 换绑模板经桥实时读 DB、即时生效）。
- **receiver 名恒为 `notify-<渠道ID>`**（#46）：不再按渠道名归一、不接受覆盖；渠道改名 / 改 webhook / 改类型 / 换绑模板均不影响 yml。
- **不再保留任何非 route 输入的旧段**（#51）：旧 `receivers`（含手写同名 receiver，被平台产物**直接覆盖**）/ `inhibit_rules` / `templates` / `mute_time_intervals` 一律不保留；`NotifyReceiverConflict` 重名失败、`MergeRouteSection` / `EnsureReceiverNames` / `MaterializeNotifyReceivers` / 根兜底单键替换等**旁路纯函数与冲突校验全部删除**。`inhibit_rules` / `templates` 能力尚未 UI 化，未来接入时在唯一生成规则内统一增加生成。
- **写入口唯一化（#45/#52）**：配置唯一写入口 = `POST /routes`（路由规则页，`base_checksum` 仅乐观锁）；M09 变更单经 `config.Submit` 生成后**待人工确认**（2026-10-09 起不自动确认下发）。
- **接收人合法集合（#45 落地、#46/#47 收窄）**：`default ∪ notify-<全量渠道ID>`（后端 `route/validate.go` 与前端下拉双端同源）；悬空接收人 `receiver_dangling` 阻断保存；“已启用渠道”限定随 #46 删除启停概念而改为全量渠道。

> **已被替代的历史口径（留档索引）**：①「决策 74 B 路线逐槽位物化」——`?channel=` / `?template=` / 令牌 `http_config.authorization`、手写 receiver 原样保留、重名即 `failed + user_config` + 行级错误、平台槽位「地址演进原地更新」；②「根 `route.receiver` 单键接管」——`AlertmanagerRouteSetting` 模型 / `GET|PUT /route-setting` / `notify_route_skeleton.go::MaterializeRootRouteReceiver` / `SeedManagedRoutePreset` 预置示例，随 #45 整体删除，根兜底接收人现由**路由树根节点的 `receiver` 字段**直接承载（根节点也是 `POST /routes` 的 route_tree 输入之一）。配套的护栏③ / 「mode 不判」注 / 死接收人提示逻辑一并失效（`dead_receivers` 字段自 `GET /routes` 删除，#46：未被引用是正常状态）。历史细节见 git 历史与 dev-feedback #38–#44 对应补登。

### 11.7 渠道 ↔ 模板绑定（演进后口径：绑定不进 yml，桥投递时实时解析，#46/#48）

- **数据**：`NotifyChannel.default_template_id`（`null` / 缺省 = 用该渠道类型的内置默认模板；迁移为 SQLite ADD COLUMN nullable，不回填）。渠道 CRUD 前置校验「模板存在 + `channel_type` 与渠道一致」，否则 `bad_request`（见 §11.1）。
- **选模板优先级**（桥投递时**实时读 DB**，#46）：渠道 `default_template_id` → 该渠道类型的内置默认模板。第 2 级**优雅回落**——绑定指向已删 / 类型不符 / 脏数据时记 warning 并回落内置默认，**不返回 4xx**（绑定失效不应拖垮该渠道整条投递、令 AM 无限重试）。
- **URL 口径（#46）**：receiver `webhook_configs.url` **只带 `?id=<渠道ID>`**——原 `?channel=` / `&template=` 参数退出，模板不再进 yml；换绑模板 / 改模板内容**立即生效**，不产生 M09 变更单、不 reload。`webhook` 类型不涉及模板（#48 禁止绑定，IM 切到 `webhook` 自动清空）。
- **模板规则（#48）**：IM 类型（飞书 / 钉钉 / 企业微信）创建 / 编辑**必须绑定模板**——飞书自动选中内置「飞书卡片-默认」；钉钉 / 企业微信无内置模板（#47 拍板不新增），必须选自定义模板，否则前端 / 后端均拒绝；贴图模板改绑时同样执行上述校验。
- **前端**：渠道编辑抽屉「通知模板」下拉只列该渠道类型的模板（内置置顶标注「平台内置默认」；切换类型重置该下拉并按 #48 必填规则执行）；模板页内置区保留「复制出的模板需在通知渠道中绑定才会生效」引流（双向引流保留）。
- **来源**：设计提案 `design-proposals/notify-template-channel-binding.md`（方案 B，`?template=` 隐藏阶段）+ 2026-10-22/23 #46/#48 收口。

### 11.8 与既有章节的 diff

- 新增 §11（PL-3 全部端点 + 字段 + 鉴权 + 物化行为）；§1–§10 契约**不变**。
- §1.3 授权利令补充：PL-3 写端点与接收人片段均挂 `RequireAdmin`，读端点（渠道 / 模板列表）仅全局认证。
- 追加枚举：`NotifyChannelType` = `feishu` / `dingtalk` / `wecom`；桥端点 `errorType` 追加 `unauthorized` / `bad_gateway` 的实际承载。
- 来源：`design-proposals/alert-config-scope-and-notification-bridge.md` §3.3；`design-proposals/notify-template-channel-binding.md`（渠道 ↔ 模板一等绑定，§11.7）；`design-decisions.md` 决策 74 + 定稿补充（2026-09-29）；`security-review-pl3.md`（H-1/M-1/M-2/M-3）；dev-feedback #17 / #21 / #22 / #24 / #30。
- **2026-09-30 增量（决策 113 口径 C / 决策 114）**：§11.6 由「M09 物化 receivers」扩为「**+ 根 `route.receiver` 单键**」（新增第 7 条骨架行为 + 护栏③语义注）；§11.1 新增 `GET|PUT /route-setting`、`GET /routes` 两行；新增 **§11.9**（端点字段 + `/routes` 数据源口径）与 **§11.10**（`route` / `receivers` 归属边界表，对齐 PRD §4.1.1 权威规则表）。§1–§10 与 §11.1–§11.7 既有契约**不变**。
- **2026-10-02 增量（dev-feedback #38 / #39，补登，无端点变更）**：
  - §11.6 补「**关键非直觉事实：根兜底接管不判 `mode`**」显式声明（含三处代码级依据 + 消费侧要求 + 「将来补门禁视同契约变更」的提示），补齐提案 §11.1 挂账项；§11.10 归属边界表补同口径交叉引用，消除「手写模式 = 平台零写入」的误读空间。
  - §3 标注 `POST .../config/versions/{id}/remount` **已无前端调用方**（保留不下线，v0.3 再决定），并显式区分 §11.1 的模板 remount（语义不同、仍在用）。
  - §11.6 UI 口径更新：派生产物预览由告警配置页迁至通知渠道页。
  - **端点 / 字段 / 鉴权全部零变更**，纯口径补登。
- **2026-10-22/23 as-landed 同步（dev-feedback #45–#52，端点 / 字段 / 鉴权大变更）**：§3 / §11.1 / §11.2 / §11.3 / §11.4 / §11.6 / §11.7 / §11.9 / §11.10 已按 as-landed 契约全面重写——①默认配置 seed 入库（`seed.EnsureDefaultAlertmanagerConfig`），路由页只读 / 编辑同源，删除「未配置」合成占位；②`POST /routes` 后端生成 YAML，删前端生成链路与「重新载入当前配置」；③接收人合法集合 = `default` ∪ `notify-<ID>`；④模板改可变实体（去 checksum / status / remount）并退出 yml（`?id=` 单参数）；⑤只物化被路由引用渠道、去 `enabled`、去 `dead_receivers` 提示；⑥渠道五列通用化 + 删除保护（409）+ 去内部桥令牌 + 钉钉加签补实现；⑦`webhook` 渠道类型 + IM 模板必填 + 脱敏回填；⑧`BuildAlertmanagerConfig` 唯一生成规则 + 删导入 / 重挂端点（§3）。被替代的历史口径在各节以「留档 / 已废止」标注保留（2026-10-02「无端点变更」补登中的护栏③ / mode 注 / dead_receivers 口径随之失效）。
- **待设计侧回写**：本节为开发空间契约快照补登；PRD `Module_08_Alertmanager_Notification_Management.md`（`docs/02-product-requirements/`，开发 Agent 不可写）的 §3.3.5 / §5 / §6 需由 design 侧（prototype-designer / Orchestrator）同步 PL-3 端点与 B 路线物化行为。

### 11.9 路由视图与保存端点（`POST /routes` 收口 #45；只读视图字段更新）

> 历史 **`GET|PUT /route-setting`**（根兜底接管设定，决策 113 口径 C / 决策 114）已随 #45 **整体删除**——根 `route.receiver` 由路由树根节点的 `receiver` 字段直接承载（同属 `POST /routes` 的 route_tree 输入），不再有独立接管开关；`AlertmanagerRouteSetting` 模型、`setting_handler.go` 一并删除。原 `RouteSettingView` 字段表与 `explicit` / `auto_first_enabled` / `none` 三态派生口径仅属历史留档，不再赘述。

**`GET /api/v2/platform/alertmanager/routes`**（`platform/alertmanager/route/handler.go`；仅全局认证、**只读、无写能力**）：

- 成功 → `{ items: [RouteNode], declared_receivers: [string], effective_checksum: string, pending: { change_no, created_at } | null }`；
- 解析失败 / 非常规结构 → **200** + `{ parse_error, raw_yaml, declared_receivers, effective_checksum, pending }`（前端降级为原文只读展示，**绝不 500、不白屏**）——`declared_receivers` 与 route 解析**相互独立**，降级分支同样携带；
- `items` 为**前序扁平数组**，`items[0]` 恒为根路由；响应不含 webhook URL / 桥凭据等敏感值。
- **新增字段（#45）**：`effective_checksum` = 当前产物 `alertmanager.yml` 的 checksum（进入编辑时由前端保存为 `base_checksum`，提交 `POST /routes` 作乐观锁基线）；`pending` 非空 = 管理域存在存活 pending 变更单 → 前端展示「**当前显示的是待确认版本**」横幅。
- **删除字段**：`mode`（`handwritten` / `managed` 随 `AlertmanagerRouteSetting` 删除；2026-10-08 用户可见词「我来编辑 / 平台生成」失去枚举对应，随节留档失效）；`dead_receivers`（#46：未被路由引用是正常状态，不再提示「渠道开了却无规则指向」，字段与前端卡片一同删除——2026-10-08「`declared_receivers` 与 `dead_receivers` 口径故意不同」注随之失效）。

`RouteNode` 字段：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 根 = `"root"`；子 = `<parent_id>/<同层下标>` |
| `parent_id` | string | 父节点 ID（根为空串） |
| `name` | string | 从注释 `# 路由名称: xxx` 还原；无则空串（**不造值**） |
| `matchers` | [RouteMatcher] | `{ name, value, is_equal, is_regex }`；**兼容新式 `matchers:[{...}]` 与字符串简写 `severity="critical"` 双形态** |
| `receiver` | string | 该节点 receiver |
| `group_by` | [string] | 分组键 |
| `group_wait` / `group_interval` / `repeat_interval` | string | 时间字段 |
| `continue` | bool | — |
| `order` | int | 同级 `routes[]` 下标（0-based；根恒 0） |
| `locked` | bool | 根路由 `true`（不可删、不可移） |

`declared_receivers`：**生效配置 `receivers:` 段已声明的接收人名全集**（按声明顺序、去重；解析实现 `platform/alertmanager/route/declared_receivers.go::ParseDeclaredReceivers`）。非敏感：只回显 AM 里本就公开的标识符，**不含 webhook URL / 桥凭据**。

> **接收人悬空判定合法集合（#45 / #46 收口后）**：`default` ∪ 全量渠道 `notify-<ID>`——后端 `route/validate.go` / `save_handler.go` 与前端接收人下拉、保存预检**双端同源**；悬空 `receiver_dangling` 阻断保存。2026-10-08「knownReceivers = `declared_receivers` ∪ 平台物化名」口径废止——#51 唯一生成规则下产物 `receivers:` 段恒为 `default` + 平台物化名，**不再存在手写 receiver**（历史手写名由整份重建覆盖移除），声明集合与合法集合天然一致；2026-10-08 的手写 receiver 误判死锁属已被根因消除的历史缺陷，dev-feedback #26「手写 receiver 存废」边界一并失效。

> **数据源口径（决策 114 第 3 条，保留）**：`/routes` 的数据源为「**平台最新产物视图**」，按新鲜度解析——管理域最近一条**未废弃草稿**产物 → 管理域最近一条 `ConfigVersion` 产物 → 两者取新 → 都无时退化到 **seed 默认配置**（#45 起 `seed.EnsureDefaultAlertmanagerConfig` 在无 applied 版本时写入与 `deploy/alertmanager/alertmanager.yml` 一致的默认根路由——默认配置入库，磁盘文件退出运行时事实源；路由页删除「未配置」标签与 `emptyRouteTree()` 合成占位；M08 挂载留痕原文仅作末端兜底）（`platform/alertmanager/route/handler.go::effectiveAlertmanagerYAML`）。教训不变：「当前生效」必须锚定 M09 **产物**，而非 M08 **挂载留痕**。

> **前端交互流（#45，取代 2026-10-08「首屏自动导入」口径）**：路由页**默认只读**，仅保留「编辑路由」入口；进入编辑先刷新 `GET /routes` 并以回传的最新数据载入；编辑态只保留「新建 / 保存 / 放弃」，删除「重新载入当前配置」按钮与 `confirmReload` 二次确认；保存成功回只读态并提示待确认；`pending` 非空时展示「当前显示的是待确认版本」横幅，变更单确认 / 废弃后横幅自动消失。「新建 / 保存按钮首屏恒灰」的历史缺陷随交互流重做一并消除。

**`POST /api/v2/platform/alertmanager/routes`**（`platform/alertmanager/route/save_handler.go`；`RequireAdmin`，#45 新增）：

- 请求 `{ base_checksum: string, route_tree: [RouteEditNode] }`——**前端不再生成任何 YAML**（原前端 `routeTree.ts::generateRouteSection` / `mergeRouteSection` 退出保存链路，仅保留为与 Go 生成器对齐的纯函数测试镜像），只提交树 + 乐观锁基线。
- 后端链路（#51 定稿）：乐观锁校验（`base_checksum` ≠ 当前生效 checksum → **409** 冲突，提示刷新后重试）→ 树 / 接收人校验（合法集合见上，`receiver_dangling` 阻断）→ `generator.GenerateRouteSection` → `generator.BuildAlertmanagerConfig`（#51 唯一规则）→ `config.Submit`（`amtool check-config` 校验 + 版本落库留痕 + 触发 M09 管理域变更单，状态 `pending` **待人工确认**，不自动确认下发）。
- 响应 `{ version: <AlertmanagerConfigVersion>, change_no? }`；校验失败 → `bad_request` + amtool 行级错误（同 §3「校验失败返回」口径）。
- 历史「前端生成 YAML 整份提交 `POST /config` 导入」保存链路废止（端点本身随 #52 删除）。

### 11.10 归属边界表（2026-10-23 起收敛为「平台唯一作者」，#51 / #52）

> **前置事实**：平台恒只写 `config-output/alertmanager.yml` **一个文件**（`platform/configcenter/deployment/service.go`）；Alertmanager 顶层键仅 `global / route / inhibit_rules / receivers / templates / mute_time_intervals / time_intervals`，**无 `route_files`**（`upstream/alertmanager/config/config.go`），PRD 早期「手写模式经 `route_files` 合并平台片段」表述早已不可实现。**2026-10-23（#51）**：alertmanager.yml 收敛为**唯一生成规则**——任何重新生成路径都输出同一份完整文件，「手写段保留 / 根 receiver 单键替换」历史口径废止，`mode` 单一作者模型随之删除；告警配置唯一写入口 = 路由规则页（导入 / 重新挂载端点已删，#52，见 §3）。

| 段 | 作者 | 平台行为 | 用户行为 | 冲突处理 |
| ---- | ---- | ---- | ---- | ---- |
| `global` | 平台 | 生成（当前固定 `resolve_timeout: 5m`） | 只读 | 不存在冲突——整份重建即覆盖 |
| `route` | **平台唯一作者** | 保存 / 生成两入口统一经 `BuildAlertmanagerConfig` 整棵生成 | 经路由规则页编辑（唯一写入口） | 手改磁盘文件只维持到下次重算即被整份覆盖（决策 114 挂载留痕不追认） |
| `receivers` | **平台唯一作者** | `default`（空）+ 被路由引用渠道 `notify-<ID>`（按渠道 ID 升序，完整桥 URL） | 无 | 历史手写同名 receiver 由平台产物直接覆盖（#51 同步删除「绝不覆盖」冲突校验与行级错误分支） |
| `inhibit_rules` / `templates` / `mute_time_intervals` | — | 不生成（能力未 UI 化，未来接入时在唯一生成规则内统一增加） | 无 | 存量内容在整份重建中丢弃（#51；升级前已存在的 pending 单需重新保存） |

- 历史口径（留档废止）：「route / receivers 双作者 + 根兜底单键替换 + 手写段保留」——随 #45（删 route-setting / mode）与 #51（唯一生成规则）失效；「绝不写 `route.routes[]`」「该接管不判 `mode`」两条显式红线注随之作废（平台现在整棵写 `route`，这正是「平台唯一作者」收口的目的）。

---

## 12. 告警抑制规则（2026-10-26，M08-INHIBIT-01）

### 12.1 数据对象与页面

```ts
interface InhibitionRule {
  id: string
  name: string
  source_matchers: RouteEditMatcher[]
  target_matchers: RouteEditMatcher[]
  equal: string[]
  enabled: boolean
}
```

独立页面 `/inhibitions`（「告警收敛与通知管理 → 告警抑制」），初始只读；编辑后可新增、编辑、删除、启停，支持保存提交和放弃编辑。禁用项与编辑态 ID 不进入 YAML，名称以 `# 抑制规则名称: ...` 注释保留。

### 12.2 独立 API、共用生成与下发

| 方法 | 路径 | 权限 | 请求 / 响应 |
|------|------|------|-------------|
| GET | `/api/v2/platform/alertmanager/inhibitions` | 已登录 | `data={items,effective_checksum,pending}` |
| POST | `/api/v2/platform/alertmanager/inhibitions` | 管理员 | 请求 `{base_checksum,inhibit_rules}`；响应 `{version,change_no?}` |

- `/routes` 请求契约不变，仍为 `{base_checksum,route_tree}`；`/inhibitions` 不接收路由树。
- 底层共用 `route.SaveAlertmanagerConfig(routeTree,inhibitRules,...)`：保存路由时使用修改后路由并保留当前抑制；保存抑制时保留当前路由并使用修改后抑制。
- 保存路由时 `inhibit_rules=nil` 表示保留当前规则；共享函数收到显式空数组表示清空。M09 草稿生成/重校同样提取并保留抑制规则。
- 两端都经 `generator.BuildAlertmanagerConfig` 整份生成 `global + route + inhibit_rules + receivers`，然后复用 `config.Submit` 的 amtool、版本留痕和 M09 人工确认下发链，不即时生效。
- 源/目标 matcher 均至少一条，标签名和值非空，正则合法，equal 标签非空且不重复；失败返回 400 `bad_request`，checksum 冲突返回 409 `conflict`，非管理员写入返回 403。

本节取代 §11.10 中 `inhibit_rules`「未 UI 化、不生成」的旧口径；`templates` / `mute_time_intervals` 仍不生成。

### 12.3 分配置段的 pending 提示

`pending` 增加 `route_changed` / `inhibit_rules_changed` 布尔字段，由后端比较当前 pending 与上一确认版本的对应配置段。路由页仅在 `route_changed !== false` 时显示待确认提示，抑制页仅在 `inhibit_rules_changed !== false` 时显示；两段都变化则两页都显示。字段缺省兼容旧客户端按 true 处理。变更单仍只有一个，确认仍针对完整 YAML。
