# API 契约快照 — Module 08 告警收敛与通知管理（决策 59/60 MVP 增量）

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。
>
> MVP 边界：本快照覆盖 **决策 59/60 告警分发闭环** 的三块能力——①`alertmanager.yml` 文件挂载（+版本留痕/回滚）；②静默极简 UI（创建/列表/删除，API 直调 Alertmanager）；③跨端 M09 变更确认联动（内容 Owner=M08，管道 Owner=M09）。接收人/路由/抑制**表单化 UI**、告警状态页（active/silenced/inhibited/unprocessed）均归 **v0.3**，不在本快照。

## 0. 快照元信息

| 项     | 值                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase | Track B 增量（决策 59/60 告警分发 MVP 最小闭环）                                                                                                                                                                                                                          |
| 模块    | module-08-alert-dispatch                                                                                                                                                                                                                                    |
| 分支    | feat/module-08-alert-dispatch                                                                                                                                                                                                                               |
| 版本    | v2026-09-01（新建）                                                                                                                                                                                                                                             |
| 生成方式  | planner 派生（决策 59/60，承接决策 47）                                                                                                                                                                                                                                |
| 来源    | PRD `Module_08_Alertmanager_Notification_Management.md`（v1.7）§1/§3.1/§5.1/§5.2/§6.3/§6.6/§9；PRD `Module_09`（v1.52）§3.4/§5.4/§9.2；`design-decisions.md` 决策 49/55/56/59/60；`03_API_Standard.md` §7；`05_Code_Implementation_Plan.md` §7.8；`task-sequence.yaml` |

## 1. 通用契约

### 1.1 前缀与响应

- 管理面前缀：`/api/v2/platform/alertmanager/*`（本模块全部 REST 管理接口）；代理 Alertmanager 原生 `/api/v1/silences` 亦由本模块服务端承载，前端不直连 AM。

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

## 4. 静默管理 API（silence service，代理 Alertmanager）

| 方法     | 路径                                                    | Query / 请求体                                                              | 响应 data                        | 业务错误                             | PRD 源        |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ | -------------------------------- | ------------ |
| GET    | `/api/v2/platform/alertmanager/silences`              | Query: `page`、`page_size`（服务端可追加 `active=true` 过滤活跃静默）                   | `{ items: [Silence], total }`  | —                                | §5.2         |
| POST   | `/api/v2/platform/alertmanager/silences`              | body `{ matchers: [Matcher], starts_at, ends_at, comment, created_by? }` | 创建的 `Silence`（含 AM silence ID） | `bad_request`：matcher 越权 / 参数不合法 | §5.2 / 决策 56 |
| DELETE | `/api/v2/platform/alertmanager/silences/{silence_id}` | —                                                                        | 删除成功的静默 ID                     | `not_found`：不存在                  | §5.2         |

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
| `name`     | string | 标签名（如 `network_domain`） |
| `value`    | string | 匹配值                     |
| `is_equal` | bool   | true=`=`（相等）false=`!=`  |
| `is_regex` | bool   | true=正则匹配               |

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

## 9. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`（v1.7）§1/§3.1/§5.1/§5.2/§6.3/§6.6/§9

- M09 联动：`docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.52）§3.4/§5.4/§9.2

- 决策：`docs/05-execution-records/module-08/design-decisions.md`（决策 49/55/56/59/60）

- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7

- 序列：`docs/05-execution-records/module-08/task-sequence.yaml`；M09 侧：`docs/05-execution-records/module-09/task-sequence.yaml`（T09-60-\*）

