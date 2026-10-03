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
| 版本    | v2026-09-29（**新增 §11**：PL-3 通知渲染桥与渠道 / 模板管理全部端点 + 字段 + 鉴权 + B 路线 M09 物化行为，决策 74 方案 B；H-1 令牌改 `Authorization: Bearer` 请求头、M-2 webhook 私网拒绝）叠加 v2026-09-18（§10.4 补登 `GET /api/v1/alerts/history` 请求参数与 envelope + 「7d 窗口 × 默认步长」点数上限约束，决策 90）叠加 v2026-09-11b（§4 新增 `GET /silences/label-options` 静默 matcher 标签选项聚合端点 + LabelOptionGroup 响应结构，Matcher 补 AND 语义与正则预检说明，v1.16 决策 71）叠加 v2026-09-11（§10.1/§10.2 实例字段扩展，决策 70：新增 `instance_address` / `resource_id` / `resource_name` / `resource_category` / `resource_ip` / `resource_port`，`instance_display` 语义修订为「`resource_name` 非空取之，否则取 `instance_address`」，`labels.instance` 明确为**采集地址**；不删旧字段、向后兼容）叠加 v2026-09-10（§10 网域取值口径修正：`labels.network_domain` 明确为服务端解析 + 回写，F-07；**同日决策 68-1 键名收敛**——`labels.network_domain_id` 定位修订为历史/兼容键、`network_domain` 为唯一标签键；字段名与响应形状不变）                                                                                                                                                                                                                                             |
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
| POST | `/api/v2/platform/alertmanager/config`                       | body `{ content: '<alertmanager.yml 全文>', uploaded_by?: string }` | 校验通过：写入的 `AlertmanagerConfigVersion`；M09 侧管理域变更单号 `source_change_no`（若本轮已生成） | `bad_request`：`amtool check-config` 校验失败（返回行级错误集合，**不落库、不进流水线**） | §5.1 / §9.2 |
| GET  | `/api/v2/platform/alertmanager/config/current`               | —                                                                 | 当前生效 `AlertmanagerConfigVersion`（最近一条 applied；无则 `{ content: '' }`）          | —                                                                | §6.6        |
| GET  | `/api/v2/platform/alertmanager/config/versions`              | Query: `page`、`page_size`                                         | `{ items: [AlertmanagerConfigVersionListItem], total }`                      | —                                                                | §6.6        |
| GET  | `/api/v2/platform/alertmanager/config/versions/{id}`         | —                                                                 | `AlertmanagerConfigVersion` 完整（含 `content` 只读视图）                             | `not_found`                                                      | §6.6        |
| POST | `/api/v2/platform/alertmanager/config/versions/{id}/remount` | body `{ uploaded_by?: string }`                                   | 重新挂载后的最新版本（再次走校验 + M09 变更单，P0 回滚动线）                                          | `bad_request`：校验失败；`not_found`                                   | §9.1 P0     |

> **⚠️ `.../{id}/remount` 已无前端调用方（2026-10-02，dev-feedback #39）**：告警配置页按用户意见移除了「重新挂载此版本」入口——
> 重新提交历史配置改走「`GET .../versions/{id}` 看内容 → 改 → `POST /config` 导入」，与本表第 1 行同一条调用链，
> 专用端点属过度设计。后端实现**保留不动、不下线**（用户 2026-10-02 拍板：契约 §3 保留至 v0.3 再决定）；
> 前端 `api/alertmanager.ts` 的 `alertmanagerConfigApi.remount` 作为**契约镜像**保留并标 `@deprecated`。
> ⚠️ **勿与 `POST /api/v2/platform/alertmanager/notify-templates/{id}/remount`（§11.1）混淆**：后者是**通知模板版本回滚**，
> 语义完全不同、**仍在用**，不得一并下线。

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

- **M08 apply = 收录 + 自动下发管理域（dev-feedback §25 方案 A）**：挂载校验通过落库（`status=applied` 仅表示「已收录为 M09 源」）后，M08 自动对管理域 `default` 复用/生成 pending 草稿并确认下发（`GenerateDraft`→`ConfirmDraft`→`DiskApplier` 写 `config-output/alertmanager.yml` + AM reload），无需人工确认；**配置是否真实生效以 `applied_at` 为准**（写盘成功后由 `writebackAlertmanagerApplied` 回填）。自动下发失败不阻断收录（降级仅记日志，由 30s watcher / 人工确认兜底）。

- 前端动线：M08 告警配置页挂载成功 → 管理域 `default` 自动确认下发（落盘 + AM reload）→ 回 M08 读 `applied_at` 判定「已生效 / 已提交待确认下发」（决策 60 / §25）。

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
| GET | `/api/v2/platform/alertmanager/notify-channels` | — | `{ items: [ChannelView] }` | 全局认证（读） | — |
| POST | `/api/v2/platform/alertmanager/notify-channels` | `{ name, type, webhook_url, secret?, enabled?, default_template_id? }` | `ChannelView` | `RequireAdmin` | `bad_request`：名称空 / 类型非法 / webhook 非法（含私网、环回、link-local、云元数据地址，见 §11.5）/ 绑定模板不存在或类型与渠道不一致（见 §11.3、§11.8） |
| PUT | `/api/v2/platform/alertmanager/notify-channels/{id}` | 同 POST，字段**指针语义**（仅更新显式提供项；`webhook_url`/`secret` 留空表示不改）；`default_template_id` 不传=保留原绑定 / `0`=解绑（回落内置默认）/ `>0`=改绑 | `ChannelView` | `RequireAdmin` | `bad_request`；`not_found` |
| DELETE | `/api/v2/platform/alertmanager/notify-channels/{id}` | — | `{}` | `RequireAdmin` | `not_found` |
| GET | `/api/v2/platform/alertmanager/notify-channels/{id}/receiver-snippet` | — | `ReceiverSnippet`（见 §11.4） | `RequireAdmin` | `not_found` |
| GET | `/api/v2/platform/alertmanager/notify-templates` | — | `{ items: [TemplateView] }` | 全局认证（读） | — |
| POST | `/api/v2/platform/alertmanager/notify-templates` | `{ name, channel_type, content }` | `TemplateView` | `RequireAdmin` | `bad_request`：Go template 语法校验失败 / 渠道类型非法 |
| POST | `/api/v2/platform/alertmanager/notify-templates/{id}/remount` | — | `TemplateView`（回滚后的新版本） | `RequireAdmin` | `bad_request`；`not_found` |
| POST | `/api/v1/webhooks/notify` | Query `channel`（必需，真实数字渠道 ID）；`template`（可选，模板数字 ID）；body = AM 原生 webhook 载荷 | `{ success, fail }` | **内网令牌**（`Authorization: Bearer <token>`，见 §11.2） | `unauthorized`（缺 / 错令牌）；`bad_request`（渠道缺失或禁用 / 携带请求方目标地址参数 / 模板与渠道类型不匹配）；`not_found`（渠道未登记）；`bad_gateway`（出站失败） |
| GET | `/api/v2/platform/alertmanager/route-setting` | — | `RouteSettingView`（见 §11.9） | 全局认证（读） | — |
| PUT | `/api/v2/platform/alertmanager/route-setting` | `{ default_receiver_channel_id: number\|null }` | `RouteSettingView` | `RequireAdmin` | `bad_request`：目标渠道不存在 / 未启用；`unauthorized`：未认证；`forbidden`：非管理员 |
| GET | `/api/v2/platform/alertmanager/routes` | — | 成功 `{ mode, items: [RouteNode], dead_receivers: [DeadReceiver] }`；解析失败 **200** `{ mode, parse_error, raw_yaml }`（见 §11.9） | 全局认证（只读、无写能力） | —（解析失败仍 200，非 500） |

> 注：`/route-setting` 与 `/routes` 的字段表、鉴权语义与 `/routes` **数据源口径**见 §11.9；`route` / `receivers` 归属边界表见 §11.10。

### 11.2 桥端点鉴权（H-1 修订，2026-09-29）

- 调用方为**中心 Alertmanager**，凭据为平台内部通知桥令牌，由 `--notify.bridge-token`（env 覆盖 `NOTIFY_BRIDGE_TOKEN`）注入；**令牌为空时桥端点一律 401**（安全默认，不开放匿名转发）。
- **令牌经请求头 `Authorization: Bearer <token>` 传递，绝不写入 URL query**（`gin.Default()` 访问日志会明文落盘 RawQuery；此项为 security-reviewer H-1 必修）。AM 侧对应 `webhook_configs.http_config.authorization`（`type: Bearer` + `credentials`），由 M09 物化或用户手写片段产出。
- 常量时间比较校验令牌；鉴权失败不产生任何出站。

### 11.3 ChannelView / TemplateView

| ChannelView 字段 | 类型 | 说明 |
| ---------------- | ---- | ---- |
| `id` | string | 渠道 ID（**数字串**；桥 URL query 与物化 receiver 均引用此值） |
| `name` | string | 渠道名（用户可见；平台派生 receiver 名由此归一，见 §11.6） |
| `type` | enum | `feishu` / `dingtalk` / `wecom` |
| `webhook_url` | string | **脱敏**为 `scheme://host/***`，绝不回显完整地址与 token |
| `secret_set` | bool | 是否已设置加签密钥（**不回显 secret**） |
| `enabled` | bool | 是否启用（仅 enabled 渠道参与 M09 物化） |
| `default_template_id` | number? | 绑定的通知模板 ID（**缺省/`null` = 用该渠道类型的内置默认模板**）；非空须与渠道类型一致。经 M09 物化写进 receiver URL 的 `&template=<ID>`，是「渠道 ↔ 模板一等绑定」的载体（见 §11.8） |
| `created_at` | datetime | 创建时间 |

| TemplateView 字段 | 类型 | 说明 |
| ----------------- | ---- | ---- |
| `id` / `name` | string | 模板 ID / 名称 |
| `channel_type` | enum | 适用渠道类型（渲染时须与渠道类型一致，否则桥 400） |
| `content` | string | Go `text/template` 内容（白名单 FuncMap，含 `jsonStr` 等） |
| `is_builtin` | bool | 是否内置（内置模板不可删除；模板为 append-only，无删除端点） |
| `checksum` | string | 内容 sha256（版本留痕；**UI 不展示**） |
| `status` | enum | 版本状态（`applied` 等） |
| `created_at` | datetime | 创建时间 |

### 11.4 ReceiverSnippet（手写自定义 receiver 的参考片段）

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `receiver_name` | string | 建议接收人名（渠道名归一为安全字符集；为空回落 `notify-<ID>`） |
| `url` | string | 桥地址 + 真实数字渠道 ID（`?channel=<id>`；渠道绑定了模板时附 `&template=<id>`；**不含令牌**） |
| `snippet` | string | 可参考的 `receivers:` YAML 片段，内含 `webhook_configs.url` + `send_resolved` + `http_config.authorization`（`type: Bearer`） |
| `token_configured` | bool | 桥令牌是否已配置；`false` 时 UI 必须显式告警（片段不可直接使用） |

> 令牌未配置时 credentials 用醒目占位符（`REPLACE_WITH_BRIDGE_TOKEN`），不伪装为可用值。

### 11.5 渠道 webhook 地址校验（M-2 修订）

- 仅允许 `http` / `https` scheme 且 host 非空。
- **默认拒绝**私网（`10./172.16-31./192.168.`）、环回（`127.0.0.1` / `localhost` / `[::1]`）、link-local、未指定（`0.0.0.0`）、云元数据（`169.254.169.254`）地址——SSRF 防护（AGENTS.md §9）。
- 内网自建机器人属业务例外，提供**显式允许开关**（进程内 `SetAllowPrivateWebhookTargets`，测试 / 内网部署显式开启）。

### 11.6 B 路线：M09 物化 receivers + 根 route.receiver 单键（决策 74 定稿 + 决策 113 口径 C）

管理域（`default`）存在已留痕的 `alertmanager.yml` 时，M09 配置生成（`ConfigDraft` 生成与「重新校验」两条路径）执行（第 1–6 条为 receivers 物化；**在其之后、Checksum 之前**执行第 7 条的根兜底单键替换，见 `platform/configcenter/draft/service.go::buildArtifacts`）：

1. 读**已启用**通知渠道（`enabled=true`，按 id 升序，保证 checksum 可复现）；
2. 为每个渠道追加一个 receiver：`name` = 渠道名归一（`[^a-z0-9]+`→`-`，空则 `notify-<ID>`），`webhook_configs[].url` = 桥地址 + `?channel=<真实数字ID>`（+ 可选 `&template=<模板ID>`），令牌走 `http_config.authorization`（令牌为空则**不写**该段，绝不伪造占位值）；
3. **用户手写 receivers 原样保留**；
4. **重名即失败**（绝不静默覆盖 / 合并）：平台名与手写名冲突、或平台内部两条渠道归一后同名 → 整体不写入，草稿校验置 `failed` / `validation_cause=user_config`，附 `alertmanager.yml` **行级错误**（`{file, line, message}`，同 §3 校验失败返回）；
5. **幂等与地址演进（L2，决策 74 定稿补充）**：平台槽位以「receiver 名 ∈ 平台 `ReceiverName()` 集合（= 各已启用渠道名归一结果）」判定，不再依赖「名称 + 桥 URL 全等」。同名且 URL 属平台桥地址形态（`/api/v1/webhooks/notify` 路径）者视为平台自身产物：URL 相同 → 跳过（幂等）；URL 不同（桥地址演进，如 host/端口变化）→ **原地更新**该 receiver 的 `url` 与 `http_config.authorization`，**不报重名冲突**，变更由下游 diff 记入 `alertmanager_config` 变更项（保证「重新校验」从草稿产物复现同一结论）。同名但 URL **非**平台桥地址形态（确系用户手写、指向别处）者，仍按第 4 条 `failed + user_config` + 行级错误处理（决策 74「绝不静默覆盖/合并」语义不变）；
6. 渠道 / 模板变更纳入 M09 源数据版本聚合（`NotifyChannel` / `NotifyTemplate` 进 `sourceTableScopes`），触发重算与变更检测。
7. **根兜底单键替换（决策 113 口径 C，T08-09 / T08-10）**：在 receivers 物化**之后**，按管理域单例设定（默认接收人，`AlertmanagerRouteSetting{NetworkDomainID=default, DefaultReceiverChannelID *uint}`，`*nil = 不接管`）执行生成器纯函数 `MaterializeRootRouteReceiver(baseYAML, RootRouteInput{Enabled, DefaultReceiver, PlatformReceiverNames})`（`platform/configcenter/generator/notify_route_skeleton.go`）：
   - **开关开启**（用户已选定默认接收人）且目标 receiver 名 **∈ 可达集合**（文件既有 `receivers[].name` ∪ 本次平台物化名）→ **原地替换**根 `route.receiver` 这**一个标量键**；
   - 目标 **不在可达集合** / YAML 非法 / 无 `route` 节点 / 根 route 无 `receiver` 标量 → **跳过 + 诊断**（**不返回 error**、不阻断挂载路径，避免 amtool 校验整单 `failed`）；
   - 根 route 的 `group_by` / `group_wait` / `group_interval` / `repeat_interval` / `continue` 及**所有 `route.routes[]`** 逐字保留（注释 / 节点顺序 / 样式不变）；
   - **幂等**：值已等于目标时原样返回，连跑两次输出字节一致（保证 Checksum 可复现）；
   - **开关关闭**（`DefaultReceiverChannelID=nil`）或目标渠道被禁用 / 删除 → 产物**字节级不变**（护栏③，语义见下方注）。

> **护栏③语义（以决策 114 第 1 条为准）**：关闭接管 = 平台**停止替换**、不主动改写 / 回滚文件；此后若发生**自然重算**（源数据变更触发的生成下发），产物根 `receiver` 会回落为用户手写值——这是「停止替换」的必然结果，而非平台主动删除动作。平台**不引入「最后写入值」的额外持久化状态**（保持实现最简、无新增状态机）。决策 113 原文「不删最后写入的值」易被误读为「永久保留已写入值」，本注为准。

> **⚠️ 关键非直觉事实：根兜底接管「不判 `mode`」（2026-10-02 显式补登，dev-feedback #38 / 提案 §6.3）**
> 第 7 条的门禁**只判 `Enabled && DefaultReceiver != ""`，与路由模式 `mode` 无关**——代码级依据：
> `platform/configcenter/generator/notify_route_skeleton.go::MaterializeRootRouteReceiver`（`if !in.Enabled || in.DefaultReceiver == ""` 即返回，函数签名内**无 `mode` 入参**）；
> `platform/configcenter/draft/service.go`（`buildArtifacts` 调用点不判 mode）；`platform/models/alertmanager_route_setting.go::EffectiveDefaultReceiver` 同样不判 mode。
> ⇒ **即使 `mode=handwritten`（路由规则由用户手写维护），只要开关开启，平台仍会替换根 `route.receiver` 这一个键。**
> 「手写模式」不等于「平台零写入」——它只保证平台不写 `route.routes[]`（§11.10 显式红线），**不**豁免根兜底单键。
> 对照：完整预置种子 `SeedManagedRoutePreset`（dev-feedback #33）**有** managed 门禁（`platform/configcenter/draft/service.go`），两者不可类比。
> **消费侧要求**：任何 UI / 文档表述不得据此声称「手写模式下平台不接管」；告警配置页 `policySummary` 与 §6.3 回归用例即为此护栏。
> **若将来给该函数补 `mode` 门禁**，属契约变更：须同步 §11.10 归属边界表、告警配置页状态句口径与 `AlertConfigPage.test.tsx` 的「§6.3」用例。

> **UI 口径（2026-10-02 更新，dev-feedback #39）**：「平台自动生成的接收人」只读预览已**由告警配置页迁至「通知渠道」页**（作为渠道表格「平台接收人」列，列内只给结论；片段 YAML 与复制仍由该页行内「接收人配置」抽屉承载，单一来源）。告警配置页不再展示派生产物预览，仅保留前往渠道页的链接。

### 11.7 渠道 ↔ 模板一等绑定（dev-feedback #30 增量，2026-09-30）

把桥早已支持的 `?template=` 从「隐藏 query」升级为**渠道属性**，让「复制并自定义模板 → 渠道绑定 → 真正生效」形成闭环：

- **数据**：`NotifyChannel.default_template_id`（`null` / 缺省 = 用内置默认模板，存量零影响；迁移为 SQLite ADD COLUMN nullable，不回填）。渠道 CRUD 前置校验「模板存在 + `channel_type` 与渠道一致」，否则 `bad_request`（见 §11.1）。
- **桥选模板优先级**：显式 `?template=` > 渠道 `default_template_id` > 该渠道类型的内置默认模板。第 2 级**优雅回落**——绑定指向已删/类型不符/脏数据时记 warning 并回落内置默认，**不返回 4xx**（绑定失效不应让该渠道告警整体投递失败、令 AM 无限重试）。
- **M09 物化**：`bridgeReceiverURL` 对已绑定渠道输出 `?channel=<ID>&template=<ID>`；绑定变化由 §11.6 第 5 条的「平台 receiver 地址演进原地更新」承载，因此**绑定随物化持久、不被重算覆写**。
- **接收人片段**：§11.4 的 `url` / `snippet` 与 M09 物化同源，绑定时同样带 `&template=<ID>`（避免「参考片段」与实际下发口径漂移）。
- **前端**：渠道新增/编辑抽屉在「渠道类型」与「机器人 Webhook」之间提供「通知模板」下拉（仅列该渠道类型的模板，内置置顶标注「平台内置默认」；切换类型重置该下拉）；模板页内置区补「复制出的模板需在通知渠道中绑定才会生效」引流链接（双向引流）。
- **来源**：设计提案 `design-proposals/notify-template-channel-binding.md`（方案 B）。

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
- **待设计侧回写**：本节为开发空间契约快照补登；PRD `Module_08_Alertmanager_Notification_Management.md`（`docs/02-product-requirements/`，开发 Agent 不可写）的 §3.3.5 / §5 / §6 需由 design 侧（prototype-designer / Orchestrator）同步 PL-3 端点与 B 路线物化行为。

### 11.9 路由设定与只读路由视图端点（决策 113 口径 C / 决策 114）

**`GET|PUT /api/v2/platform/alertmanager/route-setting`**（`platform/alertmanager/route/setting_handler.go`；注册 `platform/alertmanager/register.go`）——默认接收人 = 授权平台接管根兜底 `route.receiver` 单键。

`RouteSettingView`（响应 `data`）：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enabled` | bool | 平台当前是否**正在接管**根兜底（= `effective_source == explicit`） |
| `default_receiver_channel_id` | number? | 持久化的设定值（**`null` = 不接管**；显式设定的渠道被停用 / 删除后**原值保留、不回写库**） |
| `effective_receiver_name` | string | 实际（或建议）写入根 `route.receiver` 的 AM receiver 名（`NotifyChannel.ReceiverName()`，与 §11.6 receivers 物化同源） |
| `effective_source` | enum | `explicit` / `auto_first_enabled` / `none`（见下） |

- **GET（仅全局认证）**：派生三态——
  - `explicit`：已显式设定且目标渠道存在且 `enabled=true` → `enabled=true`，平台接管中；
  - `auto_first_enabled`：**未设定**但存在已启用渠道 → 取已启用渠道按 id 升序第一个作 `effective_receiver_name`，**仅 UI 建议**，`enabled=false`（**产物字节不变**）；
  - `none`：无生效接收人（显式目标渠道停用 / 删除，或平台无任何已启用渠道）。
  - **响应不含桥令牌等敏感值**。
- **PUT（挂 `RequireAdmin`）**：收 `{ default_receiver_channel_id: number | null }`；`null` = 关闭接管（护栏③）；非 `null` 时校验目标渠道存在且已启用，否则 `bad_request`；未认证 `401` / 非 admin `403`。写入后**与挂载同构 autoApply**（触发 M09 管理域变更重算 + 自动确认下发 + AM reload），**响应不含下发状态**（决策 60 冻结：M08 不驱动下发状态）。

**`GET /api/v2/platform/alertmanager/routes`**（`platform/alertmanager/route/handler.go`；仅全局认证、**只读、无写能力**）：

- 成功 → `{ mode, items: [RouteNode], dead_receivers: [DeadReceiver] }`；`mode ∈ { handwritten, platform }`（本期恒 `handwritten`，接入真实模式来源后按实返回）。
- 解析失败 / 非常规结构 → **200** + `{ mode, parse_error, raw_yaml }`（前端降级为原文只读展示，**绝不 500、不白屏**）。
- `items` 为**前序扁平数组**，`items[0]` 恒为根路由。

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

`dead_receivers`：平台命名空间（已启用渠道 `ReceiverName()` 集合）中**不被任何 route 节点 `receiver` 引用**（**含根兜底引用判定**）者；`{ name, url }`，`url` **已脱敏**（保留 `scheme://host`，路径 / 查询以 `/***` 替代）。

> **数据源口径（决策 114 第 3 条，缺陷修复）**：`/routes` 的**数据源为「平台最新产物视图」**，按新鲜度解析——管理域最近一条**未废弃草稿**产物 → 管理域最近一条 `ConfigVersion` 产物 → 两者取新 → 都无时退化为 M08 挂载留痕（`platform/alertmanager/route/handler.go::effectiveAlertmanagerYAML`）。**不是**挂载留痕原文——留痕原文既不含 receivers 物化、也不含根兜底接管结果，会让页面根 `receiver` 与磁盘实际生效配置（`config-output/alertmanager.yml`）不一致，并把**已被根路由引用的平台 receiver 误报为死配置**（与原实现缺陷、与本功能立身点「消解死接收人」直接相冲）。教训：「当前生效」必须锚定 M09 **产物**，而非 M08 **挂载留痕**。

### 11.10 归属边界表（对齐 PRD §4.1.1 权威规则表，决策 113）

> **前置事实**：平台恒只写 `config-output/alertmanager.yml` **一个文件**（`platform/configcenter/deployment/service.go`）；Alertmanager 顶层键仅 `global / route / inhibit_rules / receivers / templates / mute_time_intervals / time_intervals`，**无 `route_files`**（`upstream/alertmanager/config/config.go`）。故 PRD 早期「手写模式经 `route_files` 合并平台片段」表述在现网形态下不可实现，已废；正确落点为「开关开启时原地替换根 `route.receiver` 单键」。

| 段 | 作者 | 平台行为 | 用户行为 | 冲突处理 |
| ---- | ---- | ---- | ---- | ---- |
| `global` | 平台 | 生成 | 只读 | 手改被平台下次生成覆盖（仅限平台拥有的键） |
| `route` | **单一作者**（模式决定） | 平台模式：整棵生成；手写模式：**仅原地替换根 `route.receiver` 单键** | 手写模式：整棵手写；平台模式：只读 | 由模式决定，**不存在同时写** |
| `receivers` | **双作者**（命名空间区分） | 追加 / 更新**平台槽位** | 手写自有 receiver | 平台槽位：**原地更新**（地址演进不算冲突）；非平台槽位同名 → `failed + user_config` + 行级错误，**绝不覆盖** |
| `inhibit_rules` | 平台 | 自动生成（网域离线场景） | 可手写追加 | 现状不变 |
| `templates` / `mute_time_intervals` | 用户 | 不触碰 | 手写 | — |

- **根兜底归属**：具体分流 `route.routes[]` = 用户（平台管理模式 = 前端表单生成；手写模式 = 手写）；**根兜底 `route.receiver`** 在用户选定默认接收人（开关开启）后由平台接管。
  - ⚠️ **该接管不判 `mode`**（显式声明见 §11.6 护栏③之后的「关键非直觉事实」注）：**手写模式下开关开启，平台同样替换根 `route.receiver`**。
    本表 `route` 行「手写模式：仅原地替换根 `route.receiver` 单键」即此意——手写模式**保留**这一项替换，**不是**「平台完全不写 route」。
- **显式红线（不可越）**：平台**绝不写 `route.routes[]`**、绝不触碰根 route 的 `group_by` / `group_wait` / `group_interval` / `repeat_interval` / `continue`；**仅替换根 `receiver`**。变更单会明示「根兜底被平台重建」（护栏②，复用 §4.5 既有「route 被外部改动不静默」机制，不新增机制）。
