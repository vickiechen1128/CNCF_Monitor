# 配置同步卡死治理：中心空 targets 阻断（C）+ 应用失败可观测（D）+ 应用资源字段治理（E） — 设计提案

> 状态：approved（2026-09-24 落档，E 于同日经 chenrt 追加确认；**2026-09-25 订正**：C / D / E 三个部分均已实施、门禁已跑通，状态由 `draft` 推进为 `approved`，待 §8-4 的 PRD / 契约回写完成后转 `merged`）
> **修订（2026-09-24 晚，chenrt 裁决）：E 推翻「M07 health_check_url 必填 + URL 派生」的原始设计，
> 改为「采集地址拆分」——M07 台账负责「部署在哪」（endpoint + port 必填、health_check_url 回归
> 应用实际 URL 语义且可选），M01 采集 Job 负责「怎么抓」（application_http 的 metrics_path 显式必填）。
> 详见 §4.5。C 与 D 不受影响，已按原设计实施。**
> 关联模块：M09 配置中心（配置生成 / 生成侧校验）+ M11 边缘接入（Agent 配置应用上报 / 采集节点状态页）+ M07 监控对象管理（应用资源字段语义与必填，E）+ M01 指标采集中心（采集 Job 采集路径，E 修订后新增）
> 关联反馈：`docs/05-execution-records/module-09/dev-feedback.md` F-31（C）、`docs/05-execution-records/module-11/dev-feedback.md` F-17（D）、`docs/05-execution-records/module-07/dev-feedback.md` F-11（E）
> 路线：Track B（缺陷治理 + 可观测性补强，轻量增量；验证通过后回写 M09 / M11 / M07 PRD 与契约快照）
> 前序：M11 dev-feedback F-16（「同步中」中间态，方案 A，2026-09-24 已实现）

---

## 1. 需求背景

### 1.1 现象

边缘域采集节点「配置同步」列长期停留**「同步中」**，且中心侧主机采集 / 拨测采集**在线数全为 0**（`count(up)` 为空、中心 Prometheus activeTargets=0），而节点本身在线、边缘本地抓取正常。

### 1.2 根因链（已实测证实）

| # | 环节 | 事实 |
|---|------|------|
| 1 | 源数据 | application 资源 `33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43`（app_name=1 / service_name=test1）**health_check_url 为空** |
| 2 | 中心生成 | [targets.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L82-L98) `resolveResource` 取 `Address = application.HealthCheckURL` → 空；[ResolveJobTargets L161-L163](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L161-L163) `if rt.Address == "" { continue }` **静默跳过** → 该 Job 目标组为 0 → [render.go L123-127](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/render.go#L123-L127) 落盘 `targets/test-app-01.json` 内容为 **`[]`** |
| 3 | 中心校验漏放 | [ValidateTargetGroups](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L33-L50) 遍历 0 组即返回 nil → **空数组被判合法**；promtool 亦不校验 file_sd 内容 → 草稿 passed → 可确认下发 |
| 4 | 边缘拒收 | Agent [ValidateTargetsJSON](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/extract.go#L83-L85) 对 `len(arr)==0` 报 **`empty array`** → `Deployer.Apply` 失败 → **回滚**，保留上一份可运行配置 |
| 5 | 版本冻结 | Agent 持续上报旧版本 `config_version`（v31 = `20260922-091425`），`config_deployments` #35/#36/#37 永久 `pending` |
| 6 | 中心状态机 | 心跳版本 ≠ 最新已确认版本 → [heartbeat_service.go L122-L139](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L122-L139) 写 `out_of_sync` + cause `pull_pending` → 前端按 F-16 展示**「同步中」**，且**永不自愈**（应用永远失败） |
| 7 | 数据面断流 | v31 的 vmagent 仍指向旧的（错误）remote_write 地址，且新采集配置从未生效 → 中心无 up 样本 → 在线数 0 |

**结论：根因是中心生成侧「静默产出空 targets 文件」+ 生成侧校验「空数组放行」的组合缺陷**；边缘拒收空数组是**正确的防御**，不是缺陷。前端「同步中」不是引导文案错误，而是**可观测性缺失**——中心拿不到「已拉包但应用失败」的信号，状态机无法区分「还在等拉取」与「一直应用失败」。

### 1.3 实测证据

- 配置包下载解包验算：`targets/test-app-01.json` 内容为 `[]`，checksum 与中心 metadata 一致（排除传输/篡改）。
- 中心配置接口实测 200、checksum 校验通过；metadata `remote_write_url` 已是正确的 9090 数据隧道 + `/api/v1/write`（排除中心接口与隧道问题）。
- 边缘 `edge_target_snapshots` 本地抓取正常（`tengxunyun-ceshi-host` 29/32 up）→ 边缘 vmagent 与目标网络均正常，问题在**配置应用**环节。
- `config_deployments` 最后一次 `success` 为 v31；#35/#36/#37 永久 `pending`。

### 1.4 方案取舍（为何选 C+D，不做 B）

| 方案 | 内容 | 判定 |
|------|------|------|
| B | 放宽边缘校验，允许空数组 targets 文件 | **不做**。空 file_sd 数组在语义上无意义，放宽会让「资源地址缺失」这类用户配置缺陷**静默通过**并以「在线数 0」的形式在数据面暴露，掩盖归因；边缘拒收是正确防御。 |
| **C** | **中心生成侧治本**：不再静默产出空 targets 文件，生成侧校验与边缘同口径拒收并给出可操作归因 | **做**（§3） |
| **D** | **可观测性补强**：Agent 上报「配置应用失败原因」，中心落库并更新同步成因，节点状态页展示具体失败原因 | **做**（§4） |

定位：**C 治本阻断**（缺陷配置到不了边缘），**D 兜底可观测**（任何其它应用失败原因——磁盘满、reload 失败、包损坏——都能被看见，不再表现为无限「同步中」）。

---

## 2. 设计范围

**包含**：

1. C-1：`ResolveJobTargets` 增加**跳过归因**（哪个实例、哪个资源、为什么没解析出地址）。
2. C-2：`ValidateTargetGroups` / `ValidateArtifacts` 与边缘同口径——**空 targets 数组判 `failed` + `user_config`**，`validation_details` 给出文件 / Job / 资源级归因。
3. D-1：Agent 心跳新增 `config_apply_error`（+ 失败版本），`Deployer.Apply` 失败时记录。
4. D-2：中心心跳处理落库错误并写入**新增成因 `apply_failed`**；成功应用时清空。
5. D-3：前端「配置同步」列 / 抽屉展示**「同步失败」+ 失败原因 + 引导动作**。
6. E：**采集地址拆分**（§4.5，2026-09-24 晚修订）——
   - **E-A（M07）**：`health_check_url` 回归「应用实际 URL（业务健康检查）」语义、恢复**可选**；`endpoint`（主机）+ `port`（采集端口）共同构成采集地址 `endpoint:port`，二者**均必填**；`protocol` 可选、仅资源画像；**删除一切由 URL 派生的逻辑**。
   - **E-B（M09）**：generator 对 application 的 target 地址由 `health_check_url` 改为 `instanceAddress(endpoint, port)`。
   - **E-C（M01）**：`monitor_type=application_http` 时 `metrics_path` **必须显式填写**（留空返回 bad_request），不再回落到全局兜底 `/metrics`；application 的实例候选 / 目标预览 / 安装确认展示地址同步改为 `endpoint:port`。

**不包含**：

- 不改边缘 agent 的空数组校验（不做 B）。
- 不改 v31 存量现场的在线数回补（属运维处置：修源数据 → 生成新版本 → 下发；本提案只保证同类问题不再发生且可诊断）。
- 不做「重试下发 / 自动回滚决策」等新功能（MVP 已有 rollback 语义，不扩展）。
- **不删除 / 不重构** application 的 `endpoint` / `port` / `protocol` 字段（属 schema 变更，影响唯一键与标签源）；E-2 只在「权威来源」上收敛，不动表结构与唯一键（见 §4.5.3）。

---

## 3. 详细设计 C：中心生成侧空 targets 阻断

### 3.1 C-1 跳过归因（`platform/configcenter/generator/targets.go`）

`ResolveJobTargets` 当前对三类实例**静默 `continue`**：`resource_not_found`（`rt == nil`）、`address_empty`、`offline`。前两类是一次**不可见的用户配置缺陷**，第三类是**设计预期**（决策 47-1 / M07 §8.1 已下线实例排除）。

设计：

- 新增跳过归因结构（包内）：

```go
// SkippedInstance 记录一次目标解析中未进入产物 targets 的实例及其归因。
type SkippedInstance struct {
    ResourceID string
    Category   string // host/database/middleware/application/generic_target（解析不到资源时为空）
    Reason     string // resource_not_found / address_empty / offline
    Detail     string // 人类可读补充（如「application 健康检查地址为空」）
}
```

- `ResolveJobTargets` 增加归因返回（保持现有 `(groups, err)` 语义不变，新增第三返回值或改为返回 `JobTargetResolution`；**实施时优先“新增第三返回值 + 保留旧函数名”以最小化调用点改动**）：

```go
func ResolveJobTargets(db *gorm.DB, job models.ScrapeJob, tmpl *models.LabelTemplate, exporterPort int) ([]TargetGroup, []SkippedInstance, error)
```

- 归因必须**精确到资源**：`address_empty` 携带 `ResourceID` 与 `Detail`——
  - application：`健康检查地址（health_check_url）为空`；
  - host/generic_target：`实例 IP 为空`；
  - database/middleware：`实例 IP 为空`。

### 3.2 C-2 生成侧与边缘同口径拒收空 targets

**判定点 1（权威，两条路径都覆盖）**：[`ValidateTargetGroups`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L33-L50) 增加零组判定——**空数组即非法**，与边缘 `ValidateTargetsJSON` 的 `empty array` 对齐：

```go
func ValidateTargetGroups(groups []TargetGroup) error {
    if len(groups) == 0 {
        return fmt.Errorf("targets 文件为空：未解析出任何有效采集目标")
    }
    ...
}
```

这样 `ValidateArtifacts` 现有的 targets 校验分支（[L132-L144](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L132-L144)）会自然产出 `failed` + `cause=user_config` + `validation_details[{File: targets/xxx.json, Source: targets}]`。

> 关键：该判定必须**置于 promtool 检查之前**（现有 targets 分支已在最前），保证不因外部工具缺失退化为 `pending`——空 targets 是**确定性用户配置缺陷**，与工具可用性无关。

**判定点 2（归因增强）**：为让 `validation_details` 从「文件级」升级为「资源级」，`ConfigArtifacts` 增加**非产物字段**承载归因：

```go
// TargetDiagnostics 是生成期目标解析归因（非产物内容：不参与 checksum、不落盘、不进 metadata）。
TargetDiagnostics []TargetDiagnostics
```

```go
type TargetDiagnostics struct {
    JobName   string
    FileName  string // targets/<job>.json
    Skipped   []SkippedInstance
}
```

- 由 `draft/service.go buildArtifacts` 在调用 `ResolveJobTargets` 后填充，经 `JobBuild` 传入 `Assemble`，聚合进 `ConfigArtifacts`。
- **安全性确认**：`ConfigArtifacts` 从未整体 JSON 序列化（仅 `PrometheusYML / RulesYML / BlackboxYML / TargetsFiles / AlertmanagerYML` 五个字段分别落库），`Checksum()` 也只拼接这五个字段 → 新增字段**不影响 checksum、不改变变更检测、不污染 stored metadata**。
- `ValidateArtifacts` 在命中空 targets 时优先用归因拼精度更高的 `Message`（含 `JobName` + `ResourceID` + `Detail`），无归因（如「重新校验」路径从 DB 重建产物）时回落通用文案。
- **一致性取舍**：`重新校验`（re-validate）从 DB 重建 `ConfigArtifacts`，`TargetDiagnostics` 为空 → 文案回落为通用版，但**判定结果（failed/user_config）完全一致**（判定不依赖归因）。这是可接受的降级，避免为持久化归因引入 schema 变更。

### 3.3 前端影响

**零改动**。M09 配置确认页已按 `validation_status` / `validation_cause` 驱动（决策 45）：`failed` + `user_config` → 禁用确认 + 展示 `validation_details` + 「前往修改」。C 只需产出正确的 `failed` / `details`，前端自动生效（`Source=targets` 沿用现有展示路径）。

### 3.4 需一并确认的口径（见 §7 决策 2）

「Job 已选实例**全部 offline**」也会产生 0 组 → 新判定同样判 `failed`。此为该设计的**已知行为变化**：现状是静默产出 `[]`（随后被边缘拒收、卡死），新行为是生成侧直接阻断并提示。**建议接受**（该配置在边缘必然无法应用，早失败优于静默卡死），但需在文案上区分成因（见 §7）。

**已裁决（chenrt，2026-09-24）：接受阻断**——全部 offline 与地址解析不出同口径判 `failed`，失败文案必须区分两类成因（「所有已选实例均已下线」/「实例采集地址为空」），并引导「移除该 Job 或恢复实例 / 补齐地址」。

---

## 4. 详细设计 D：Agent 配置应用失败可观测

### 4.1 现状缺口

- Agent 心跳契约 [`HeartbeatRequest`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/contract/contract.go#L49-L61) **无任何「配置应用结果」字段**；`Deployer.Apply` 失败只写本地日志（`journalctl -u edge-sync-agent` 可见），中心无从得知。
- 中心 `HeartbeatRequest` 有 `remote_write_last_error` 字段，但 **Agent 侧契约未定义、从不发送**（该字段当前恒空）——同类「契约单向定义」问题，D 一并规避。
- 结果：`config_sync_status` 只能在「版本不一致 → pull_pending」与「版本一致 → in_sync」间跳转，**没有第三种落点**，应用失败被永久表述为「等待拉取」。

### 4.2 D-1 Agent 侧（`platform/edge-sync-agent`）

1. `contract.HeartbeatRequest` 新增可选字段（**只增不改，向后兼容**）：

```go
ConfigApplyError         string `json:"config_apply_error,omitempty"`          // 最近一次配置应用失败原因（成功时为空）
ConfigApplyFailedVersion string `json:"config_apply_failed_version,omitempty"` // 应用失败的配置版本
```

2. Agent 维护「最近一次应用结果」的小状态（内存 + 落盘 `current/apply-state.json`，避免重启丢失诊断信息）：
   - puller / deployer 调用链在 `Apply` 返回 error 时记录 `{version, error, at}`；
   - `Apply` 成功时清空。
3. `cmd/edge-sync-agent/heartbeat.go buildHeartbeatRequest` 读取该状态填充上送。

### 4.3 D-2 中心侧（`platform/edge` + `platform/models`）

1. `models.OutOfSyncCause` **新增一档**：

```go
OutOfSyncCauseApplyFailed OutOfSyncCause = "apply_failed" // 已拉取但应用失败（已回滚至上一可用版本）
```

> 与 F-16「不新增枚举」的判断不同：F-16 复用的是**已有语义**（pull_pending 本就表示「等待拉取」），而「已拉取但失败」在现有五档 cause 中**无任何对应语义**，继续复用 `pull_pending` 会使「同步中」成为永久假象。故此处新增是必要的（需同步契约快照 + 前端类型 + PRD，见 §6）。

2. `HeartbeatService.Handle` 的心跳分支（[L120-L139](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L120-L139)）改为三态判定：

| 条件 | `config_sync_status` | `out_of_sync_cause` | 备注 |
|------|----------------------|---------------------|------|
| `req.ConfigVersion == latest` 且无 apply 错误 | `in_sync` | 清空 | 现有行为 |
| `req.ConfigVersion != latest` 且 `ConfigApplyError != ""` 且失败版本 == latest | `out_of_sync` | **`apply_failed`** | 新增分支（已拉到最新但应用失败） |
| `req.ConfigVersion != latest` 且无 apply 错误 | `out_of_sync` | `pull_pending` | 现有行为（F-16「同步中」） |

3. 错误文本落库：写入 `EdgeAgent.LastError`（模型已有该字段，当前无写入方），并提供给 `AgentView`；为避免与其它错误语义混淆，**建议新增专用字段 `ConfigApplyError`**（而非复用 `LastError`）——最终字段名在实施前随契约快照一并定版（见 §7 决策 3）。
4. 应用成功后**清空**错误文本（避免陈旧告警）。
5. 心跳过期降级（F-15 已有口径）不变：节点离线时组件状态降级为 `unknown`，`apply_failed` 成因仅在**节点在线**时有意义。

### 4.4 D-3 前端侧（`ui-custom/web/src/pages/config-center/nodes/`）

1. `types/edge.ts`：`OutOfSyncCause` 增加 `'apply_failed'`。
2. `edgeConstants.ts`：
   - 新增展示映射——`out_of_sync` + `apply_failed` → **「同步失败」** + badge `error`（红），与「同步中」（processing 蓝）、「未同步」（error 红）语义区分；
   - `outOfSyncCauseHint.apply_failed` → 「配置包已拉取，但 Agent 应用失败并已回滚至上一可用版本，请查看失败原因并修正后重新下发」；
   - `outOfSyncCauseAction.apply_failed` → 按钮「查看下发」→ `/deployments`（既有路由）。
   - `isConfigSyncInProgress` **不变**（仅 `pull_pending` 命中），避免「同步失败」被误判为进行中。
3. `EdgeAgentsPage.tsx`「配置同步」列：失败时以 Tooltip 展示错误摘要（列宽有限，长文走抽屉）。
4. `EdgeAgentDrawer.tsx`：详情区新增「配置应用」行——失败原因全文 + 失败版本 + 「查看下发」引导；`apply_failed` 时不展示 `pull_pending` 文案。
5. **「同步中」长停留提示（可选增强，见 §7 决策 4）**：`pull_pending` 且 `last_config_pull` 早于下发时间超过阈值时，提示「长时间未拉取，请检查 Agent 日志 / 网络」。

---

## 4.5 详细设计 E：M07 应用资源字段语义与必填治理（2026-09-24 chenrt 追加确认）

### 4.5.1 背景（用户实测暴露的第二个缺陷面）

用户实测场景：springboot 应用装了 exporter（端口 8081），M07 应用列表该行 `服务名=test1 / 健康检查URL="-"(空) / 协议=https / 端点=10.10.1.4 / 端口=8081 / 采集状态=已下发未采到`。

- **空值可入库**：[`validateApplication` L278-L282](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/validate.go#L278-L282) 对 `health_check_url` 是 `if 非空 { 校验格式 }` → **可选字段**；同函数对 `endpoint` 必填、`port` 仅校验范围（0 合法 → 实际非必填）、`protocol` 空则跳过。
- **字段命名错位**：字段叫「健康检查 URL」，但生成器对 application **地址只取该字段**（[targets.go L86](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L86)），`protocol` / `endpoint` / `port` **完全不参与地址拼接**。用户按字面填 `/actuator/health`（JSON）会「地址非空但抓不到样本」，填 exporter 的 `/actuator/prometheus` 才正确。
- **空值的两种表现**：该实例被静默丢弃（[targets.go L161-L163](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L161-L163)）→ ① 单实例 Job → 整包空 targets → 配置卡死（本轮主故障）；② 多实例 Job → 其余实例正常、该实例**静默漏采**，前端显示「已下发未采到」（**本截图那行很可能即此表现**）。

> 用户操作触发点：**① 登记/编辑应用资源时 `health_check_url` 留空 → ② 该实例被某个采集 Job 选中**。两处均无拦截、无提示。

### 4.5.2R 修订设计（**权威，2026-09-24 晚 chenrt 裁决**）：采集地址拆分

#### 4.5.2R.1 推翻原设计的理由

用户实测后指出：**「采集地址」本应在 M01 创建采集 Job 时由用户填写**（「怎么抓」是采集策略），而 M07 应用台账管理的是**应用的实际 URL**（「部署在哪」）。按此动线：

- 原设计让 M07 的 `health_check_url` 同时承担「业务健康检查地址」与「exporter 指标端点」两种语义，是**字段语义错位**；
- 且 `application_http` 在种子数据中**没有默认采集器映射**（[exporter.go L64-71](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/db/seed/exporter.go#L64-L71) 只有 host/mysql/redis/kafka/snmp），用户「应用类型不需要默认采集器模板」的直觉是对的——因此**采集路径不可能靠继承得到**，必须由 Job 显式给出。

**结论：字段职责重新切分** —— M07 台账负责「部署在哪」（`endpoint` + `port`），M01 采集 Job 负责「怎么抓」（`metrics_path` + `scheme`）。

#### 4.5.2R.2 字段职责终版

| 字段 | 归属 | 必填 | 参与采集地址 | 参与唯一键 | 标签模板源 | 说明 |
|------|------|------|------------|-----------|-----------|------|
| `endpoint` | M07 台账 | **是** | **是（主机）** | **是**（`category\|domain\|service_name\|endpoint`） | 是 | 采集地址主机（IPv4/域名） |
| `port` | M07 台账 | **是** | **是（端口）** | 否 | 是 | **采集端口**（exporter 指标端点监听端口，如 8081） |
| `health_check_url` | M07 台账 | 否（可选） | 否 | 否 | 是 | **应用实际 URL（业务健康检查地址）**，仅资源画像 |
| `protocol` | M07 台账 | 否 | 否 | 否 | 是 | 仅资源画像；采集协议取自 Job 的 `scheme` |
| `metrics_path` | M01 采集 Job | `application_http` 时**是** | 否（决定抓取路径） | 否 | — | 如 `/actuator/prometheus`；其它类型仍可留空继承 |
| `scheme` | M01 采集 Job | 否（默认 http） | 否（抓取协议） | 否 | — | 不变 |

生成器拼接口径：`target = instanceAddress(application.Endpoint, application.Port)` → `ip:port`，与 database / middleware / generic_target **统一为「主机 + 端口」模型**（不再有「塞完整 URL」的应用特例）。

#### 4.5.2R.3 落地改动

- **E-A（M07，`platform/config/resource/`）**：
  - `validateApplication`：`health_check_url` 恢复**可选**（非空时仍校验 http/https/tcp + 有主机）；`endpoint` 必填（文案点明「采集地址主机」）；`port` 由「0 合法」改为**必填 1~65535**（文案点明「采集端口」）；`protocol` 保持可选；**删除 `DeriveApplicationFields`** 及创建 / 更新 / Excel 导入三处调用。
  - 前端 `ResourceFormDrawer`：`health_check_url` 恢复「健康检查 URL」标签 + 可选 + 「不参与采集」提示；新增 `endpoint`（必填）+ `port`（必填，改回 `portRules`）；`protocol` 可选；删除全部派生与只读逻辑及 `deriveApplicationEndpoint` 工具。
  - 前端 `ResourcesPage`：应用列头恢复「健康检查 URL」，`endpoint`/`port` 列改名为「端点」「端口」并挂采集地址 Tooltip。
- **E-B（M09，`platform/configcenter/generator/targets.go`）**：application 的 `Address` 由 `application.HealthCheckURL` 改为 `instanceAddress(application.Endpoint, application.Port)`；`address_empty` 归因文案由「健康检查地址（health_check_url）为空」改为「采集地址为空（endpoint 主机或 port 采集端口未填写）」。
- **E-C（M01，`platform/strategy/scrapejob/`）**：
  - `resolveJobScrapeParams`：`application_http` **不回填**全局兜底 `metrics_path`；
  - `validateJobRequest`：`monitor_type=application_http` 且 `metrics_path` 为空 → `bad_request`；
  - `selection.go` / `installation.go` / `preview.go`：application 的展示地址统一改用 `applicationTargetAddress()`（`endpoint:port`），与生成器 target 同口径；
  - 前端 `ScrapeJobFormDrawer`：`application_http` 时 `metrics_path` 加 required 校验 + 应用专用 placeholder + 引导文案。
- **不动的部分（红线）**：表结构、唯一键 `category|domain|service_name|endpoint`、标签模板映射（`models/resource_fields.go`）均不变；`endpoint` 继续承担唯一键，非空性由必填保证。
- **存量影响（已知、可接受）**：历史 application 行的 `port` 若为 0，下次编辑保存时会被拦（需补采集端口）；`health_check_url` 存量为空的行**不再被拦**（该字段已恢复可选）。不做数据回填脚本。

### 4.5.2【已废弃】E-1 语义引导 + 必填（原设计，2026-09-24 晚被 §4.5.2R 取代）

- **前端 M07 应用表单**：
  - 字段文案与 placeholder 改为「采集地址（exporter 指标端点）」，Tooltip 给可复制示例 `http://10.10.1.4:8081/actuator/prometheus`，并显式排除 `/actuator/health`（JSON，无样本）；
  - 列头「健康检查 URL」同步加 Tooltip（当前 [渲染为 `v || '-'`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/resources/ResourcesPage.tsx#L526-L532)，零引导）；
  - 类别 = 应用时 `health_check_url` 设 `required`。
- **后端 `validateApplication`**：`health_check_url` 由「可选」改为**必填**（`bad_request`，message 说明用途），与前端一致。Excel 导入路径复用同一 `validate` → **自动同口径覆盖**，无需另改。
- **存量影响（已知、可接受）**：已存在的空值行在下次编辑保存时会被拦（需先补值）；**不做数据回填脚本**（避免猜测用户意图），在 dev-feedback 与本文件登记。

### 4.5.3【已废弃】E-2 字段职责收敛：URL 单一填写 + 自动派生（原设计，2026-09-24 晚被 §4.5.2R 取代）

`health_check_url` 必填后，`endpoint` / `port`（用户问的「ip + 端口」）是否还有必要？**实测职责如下**：

| 字段 | 参与采集地址拼接 | 参与唯一键 | 标签模板源 | 展示 | 结论 |
|------|------------------|-----------|-----------|------|------|
| `health_check_url` | **是（application 唯一来源）** | 否 | 是 | 是 | 采集权威字段（E-1 必填） |
| `endpoint`（用户所称 ip） | 否 | **是**（`category\|domain\|service_name\|endpoint`，[validate.go L378-L379](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/validate.go#L378-L379)；导入去重 [import.go L267](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/config/resource/import.go#L267)） | 是（[resource_fields.go L67](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/models/resource_fields.go#L67)） | 是 | **不可降级、不可删除**（去掉会让同名服务跨机器去重失效） |
| `port` | 否 | 否 | 是（[L68](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/models/resource_fields.go#L68)） | 是 | 语义冗余（**现状本就非必填**：0 合法） |
| `protocol` | 否 | 否 | 是（[L66](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/models/resource_fields.go#L66)） | 是 | 语义冗余（**现状本就非必填**：空跳过校验） |

**结论：不能简单把 `endpoint` 改为非必填**（唯一键需要它有值），但也不该让用户手填两遍。E-2 方案：

- 以 `health_check_url` 为**唯一权威输入**，保存时解析并**自动派生** `protocol`（scheme）/ `endpoint`（host）/ `port`（显式端口；URL 未带端口时 http→80 / https→443，`tcp` 无端口则报错提示必须显式带端口）；
- 前端联动：URL 变化时同步回填这三个字段并置为**只读**（保留可见与可映射标签能力）；后端做**兜底派生**（防绕过前端 / 导入路径）；
- 编辑态策略：仅当 URL 发生变化才重新派生覆盖，避免静默覆盖历史手工值，变更前给出提示；
- **不动表结构、不动唯一键、不动标签模板映射**（唯一键由派生后的 `endpoint` 继续承担，非空性由 E-1 必填与派生保证）。
- 若不采纳 E-2：退回「仅 E-1 必填 + 引导」，`endpoint` / `port` / `protocol` 保持手填不变（`endpoint` 仍必填、`port`/`protocol` 仍可选）。

### 4.5.4 与 C 的关系

**C 是拦截**（任何来源的空地址都到不了边缘，且在配置确认页给出资源级定位），**E 是预防**（最高频的空值来源——应用登记——进不了库）。两者互补不可替代：只做 E，历史空值 / 其它来源仍可能产出空包；只做 C，用户仍会「不知道要填什么」而被反复拦。

---

## 5. 验收标准

### 5.1 C（中心侧）

1. **单测**：application 资源 `health_check_url` 为空 的 standard Job → ① 产物不再出现 `[]`（`ValidateTargetGroups` 判非法）；② `ValidateArtifacts` 返回 `failed` + `cause=user_config`；③ `validation_details` 含文件/Job 名，生成路径下含 `ResourceID` 与原因文案。
2. **单测**：`targets/*.json` 为 `[]` 时 `ValidateTargetGroups` 必须报错（与边缘 `ValidateTargetsJSON` 口径对称回归）。
3. **单测**：Job 目标全部合法时不受影响（回归）；`offline` 实例仍按设计排除且**不产生** `address_empty` 归因。
4. **单测**：`Checksum()` 不因 `TargetDiagnostics` 内容变化而变化（守卫「非产物字段」设计）。
5. **端到端**：构造「空地址实例」源数据 → 自动变更检测生成草稿 → 配置确认页展示 `failed` + 具体原因 + 「前往修改」禁用确认；**不再产出 `[]` 包**，边缘不再进入无限回滚。
6. **回归**：正常域生成 / 确认 / 下发 / 节点 `in_sync` 全链路不变。

### 5.2 D（边缘 + 中心 + 前端）

1. **Agent 单测**：`Deployer.Apply` 失败 → `apply-state` 记录；心跳请求携带 `config_apply_error` + 失败版本；后续成功应用 → 字段清空。
2. **Agent 单测**：`contract` JSON round-trip 覆盖新字段；空值 `omitempty` 不产出键。
3. **中心单测**：心跳携带 apply 错误且失败版本 == 最新已确认版本 → agent 落 `out_of_sync` + cause `apply_failed` + 错误文本落库；**不**误判为 `pull_pending`。
4. **中心单测**：携带 apply 错误但失败版本 ≠ 最新（已有更新版本待拉取）→ 仍按 `pull_pending`（避免旧错误遮蔽新版本待拉取事实）；后续心跳版本一致且无错误 → 清空错误 + `in_sync`。
5. **前端单测**：`edgeConstants` 映射矩阵补 `apply_failed` → 「同步失败」+ badge `error`；`isConfigSyncInProgress('out_of_sync','apply_failed') === false`（反例，防止误判为同步中）；`EdgeAgentsPage` / `EdgeAgentDrawer` 断言失败原因与引导按钮。
6. **端到端**（跨主机联调手册动线）：构造一次真实应用失败（如手工放置非法包 / 制造磁盘写失败）→ 节点状态页在 ≤30s 内从「同步中」翻为**「同步失败」**并展示原因；修复后翻「已同步」。
7. **契约同步**：M11 `api-contract-snapshot.md` §1 补 `apply_failed` 与心跳新字段；前端类型与后端 DTO 同名同义。

### 5.3 E（采集地址拆分，§4.5.2R）

1. **后端单测（M07）**：`validateApplication` —— `health_check_url` 为空**通过**（可选）、非空但非法（`not-a-url` / `ftp://`）仍按格式错误返回；`endpoint` 为空 → `bad_request` 且文案含「采集地址」；`port` 为 0 或越界 → `bad_request` 且文案含「采集端口」；Excel 导入复用同一 validate，同口径被拦。
2. **后端单测（M09）**：application 的 target 地址为 `endpoint:port`（`TestResolveTargetsExporterPort` 回归）；`endpoint`/`port` 均为空时 → 0 组 + `address_empty` 归因（文案为「采集地址为空…」）+ `ValidateArtifacts` 判 `failed` + `user_config`。
3. **后端单测（M01）**：`monitor_type=application_http` 且 `metrics_path` 留空 → `bad_request`（文案含 `metrics_path`），且**不回填**全局兜底 `/metrics`；显式填写后创建成功（`scheme` 仍走全局兜底）；实例候选 / 目标预览展示地址为 `endpoint:port`。
4. **前端单测（M07）**：类别 = 应用时 `endpoint`/`port` 为空提交触发 required 校验；`health_check_url` 为空可提交；不存在「自动派生」「只读」文案；非应用类别不出现该必填。
5. **前端单测（M01）**：`monitor_type=application_http` 时 `metrics_path` 留空触发 required 校验并展示引导文案；非应用类型不出现该必填，且「留空=继承默认」文案不变。
6. **回归**：host / database / middleware / generic_target 的必填口径、唯一键与采集地址口径不受影响；标签模板中 `health_check_url` / `endpoint` / `port` / `protocol` 映射仍可取值；`application` 唯一键仍为 `category|domain|service_name|endpoint`（**不含 port**）。
7. **端到端**：应用登记页缺 `endpoint`/`port` 无法提交 → 补齐 `endpoint:port`（exporter 指标端点）→ 采集 Job 选中该实例并显式填写 `metrics_path`（如 `/actuator/prometheus`）→ 生成产物 `targets/*.json` 含 `ip:port` target → 中心在线数出现该实例（M07 采集状态从「已下发未采到」转为正常）。
8. **存量影响确认**：`health_check_url` 为空的存量行**不再**被拦；`port=0` 的存量 application 行在下次编辑保存时被拦（需补采集端口）。

### 5.4 门禁

- `make check-repo-map` + `go test ./platform/...` + `go vet ./platform/...`；
- `platform/edge-sync-agent` 模块 `go test ./...` + `GOOS=linux(amd64/arm64)` 交叉编译；
- 前端 `pnpm vitest run src/pages/config-center/nodes/` + `pnpm lint`。

---

## 6. 与现有 PRD / 契约的差异点

| # | 现有口径 | 本提案变化 | 需回写位置 |
|---|----------|-----------|-----------|
| 1 | M09 生成侧校验未明确「targets 空数组」合法性（promtool 不覆盖 file_sd 内容，`ValidateTargetGroups` 实际放行） | 明确：**空数组非法**，与边缘拒收口径**对称**；`failed` + `user_config` + 资源级 `details` | M09 PRD §3.5.1（下发前校验）、§3.3（配置生成） |
| 2 | `OutOfSyncCause` 三档（`pending_draft` / `pull_pending` / `local_reset`） | **新增 `apply_failed`** 一档 | M11 PRD（节点状态 / 同步成因）、M11 契约快照 §1、前端 `types/edge.ts` |
| 3 | 心跳契约（PRD §6.2）无「配置应用结果」字段 | 新增 `config_apply_error` / `config_apply_failed_version`（可选字段，向后兼容） | M11 PRD §6.2、M11 契约快照、`contract.go` |
| 4 | F-16 已定义的「同步中」中间态口径 | 补充边界：**仅 `pull_pending` 为「同步中」**；`apply_failed` 为「同步失败」(red)，非进行中 | M11 PRD（与 F-16 修订合并回写） |
| 5 | 中心 `remote_write_last_error` 字段单向定义（Agent 契约缺失、恒空） | 本提案**不顺手修**，仅登记为同类隐患（见 §7 决策 5） | M11 dev-feedback 备注 |
| 6 | M07 §5.2 application `health_check_url` 为**可选**字段（仅非空时校验格式） | **保持可选**（修订后）：明确其语义是**应用实际 URL（业务健康检查地址）**、仅资源画像与标签来源，**不参与采集地址** | M07 PRD §5.2 / §5.13、前端表单与列表列头、`api-contract-snapshot.md` |
| 7 | application 采集地址由 `health_check_url` 承载（生成器只取该字段） | **修订**：采集地址改为 `endpoint`（主机）+ `port`（采集端口）拼接，二者**必填**；`protocol` 仅资源画像 | M07 PRD（application 字段表与必填口径）、M09 PRD §3.3（target 地址来源）、前端表单与列表列头、`api-contract-snapshot.md` |
| 8 | M01 application_http 的 `metrics_path` 可留空继承（层叠默认链回落到全局 `/metrics`） | **修订**：`application_http` 的 `metrics_path` **必须显式填写**（应用指标端点无通用默认值，且 `application_http` 无内置默认采集器映射）；其它 monitor_type 不变 | M01 PRD §5.4（采集参数与层叠默认）、前端采集 Job 表单、`api-contract-snapshot.md` |

**注**：PRD 与 `docs/prototypes/` 一律由设计条线（prototype-designer / chenrt）回写，本文档仅提供建议文本，不直接修改（目录隔离铁律）。

---

## 7. 决策清单（2026-09-25 订正：全部已落定并实施，无遗留「待确认」）

| # | 决策点 | 结论 | 影响 |
|---|--------|---------|------|
| 1 | C 的归因返回形式：`ResolveJobTargets` 新增第三返回值 vs 返回聚合结构 | **已实施**：采纳「新增第三返回值」（`([]TargetGroup, []SkippedInstance, error)`，调用点仅 `buildArtifacts` + 测试，改动最小） | 后端实现 |
| 2 | 「Job 已选实例全部 offline」是否同样判 `failed` | **已裁决（chenrt 2026-09-24）：判 failed 阻断**，两类成因文案分离（「所有已选实例均已下线」/「实例采集地址为空」），分别引导「移除该 Job 或恢复实例」/「补齐地址」；**已实施** | 用户体感：此前静默、现在阻断 |
| 3 | D 的中心错误字段：复用 `EdgeAgent.LastError` vs 新增专用 `ConfigApplyError` | **已实施**：采纳「新增专用字段 `config_apply_error` / `config_apply_failed_version`」（`LastError` 语义过泛，易与后续其它错误混淆） | 模型 + 契约 + 前端 |
| 4 | D-3 第 5 条「同步中长停留提示」是否本轮做 | 本轮**不做**（先保证 `apply_failed` 可观测；阈值与文案需设计侧定版） | 前端范围 |
| 5 | 是否顺手修复 `remote_write_last_error` 单向定义 | 本轮**不做**，作为独立小项登记（避免与本提案搅在一起） | 排期 |
| 6 | E-1 存量空 `health_check_url` 数据是否回填 | **已失效（修订后）**：`health_check_url` 恢复可选，存量空值不再被拦，无需回填。新增存量影响：`port=0` 的历史 application 行在下次编辑保存时需补采集端口 | 存量数据 / 运营影响 |
| 7 | 采集地址落点：M07 `health_check_url` 承载 vs 拆分到 M07 `endpoint:port` + M01 `metrics_path` | **已裁决（chenrt 2026-09-24 晚）：采用拆分**——M07 台账负责「部署在哪」（`endpoint` + `port` 必填），M01 采集 Job 负责「怎么抓」（`application_http` 的 `metrics_path` 显式必填）；**不删字段、不动表结构与唯一键**；原 E-2「URL 派生 + 只读」设计**废弃并回退** | 前端 + 后端范围（M07 / M09 / M01） |
| 8 | 字段展示名是否由「健康检查 URL」改为「采集地址（exporter 指标端点）」 | **已失效（修订后）**：`health_check_url` 保持原名「健康检查 URL」（语义已恢复为应用实际 URL）；采集地址由新增/明确的「端点」+「端口」两列承载 | 前端文案 + M07 PRD |

---

## 8. 合并计划

1. **确认（2026-09-25 订正：已完成）**：§7 决策全部落定——2、7 由 chenrt 2026-09-24 裁决；3 按建议采用「新增专用字段」（移出待确认）；6、8 随 §4.5.2R 的 E 修订**失效**。状态由 `draft` 直接推进为 `approved`（`reviewing` 中间态未单独停留）。
2. **实施顺序**（单 feat 分支，建议合并进当前 `feat/module-09-config-center` 或后续批次）：
   - ① C-1 + C-2 后端（M09）+ 单测（**止血，优先级最高**）——✅ 已完成；
   - ② D-1 Agent（M11）+ 单测与交叉编译——✅ 已完成；
   - ③ D-2 中心（M11/M09 交界）+ 单测——✅ 已完成；
   - ④ D-3 前端（M11）+ 单测——✅ 已完成；
   - ⑤ **E 修订版**（§4.5.2R）：E-A M07 回退原始 E 必填/派生 + endpoint/port 必填 → E-B M09 generator 地址改 `endpoint:port` → E-C M01 `application_http` 的 `metrics_path` 显式必填与展示地址对齐——✅ 已完成；
   - ⑥ `make check-repo-map` / `go test ./platform/...` / `go vet` / edge-agent `go test ./...` + 交叉编译 / 前端 `vitest` + `lint` 全量收尾——✅ 已完成（**2026-09-25 复核**：`make check-repo-map`、`go test ./platform/...`、`go vet ./platform/...`、edge-agent 模块 `go test ./...`、前端 `pnpm vitest run src/pages/config-center/nodes/` 与 `pnpm lint` 均通过；edge-agent **交叉编译**未在本轮复跑，属打包脚本 F-19 / F-20 的验证范围）。
3. **验证**（截至 2026-09-25：单测与门禁已完成，见 §8-2⑥；**跨主机现场联调未留痕，待现场复现后补记**）：跨主机联调用例（§5.2-6）在真实边缘节点复现一例「应用失败 → 同步失败可见」，并在修复源数据后验证回到「已同步」；E 侧跑 §5.3-7 动线（缺 endpoint/port 提交被拦 → 补齐 → 采集 Job 显式填 metrics_path → 产物含 `ip:port` target → 在线数出现该实例）。
4. **回写**：按 §6 表格由设计条线回写 M09 / M11 / M07 / M01 PRD 与契约快照，本文档状态转 `merged`，并在三个模块 dev-feedback（M09 F-31 / M11 F-17 / M07 F-11）标注「已实现 + 提案已合并」，E 的修订另在 M07 dev-feedback 登记。
5. **归档**：合并后保留本文档于 `design-proposals/`，作为「空 targets 静默产出」缺陷的追溯记录。