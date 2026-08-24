# dev-feedback 登记单 — Module_09 网域与边缘配置中心

> 归属：backend-developer（Agent 可写区 `docs/05-execution-records/module-09/`）
> 登记原则：① PRD 未规定的空白/细节判决策、③ 原型纯技术优化在此留痕；② PRD 已规定但实现发现矛盾需实现前报告 Orchestrator，禁止事后当既成事实塞入。

## 格式约定

| 字段 | 说明 |
|------|------|
| 类别 | ① 空白判定 / ③ 技术优化 / 契约口径确认 |
| PRD 章节 / 文件位置 | 来源 |
| 现状 | 实现当前行为 |
| 建议 / 结论 | 判定或建议 |
| 影响模块 | 前端 / 后端 |
| 发现场景 | 何时定位 |

---

## 1. 契约口径确认：list 接口不返回明文 token

- **类别**：契约口径确认（回应 frontend-reviewer 询问）
- **PRD 章节 / 文件位置**：`docs/05-execution-records/module-09/api-contract-snapshot.md` §3 NetworkDomain 字段表（`token`/`token_masked`）、§9 必填口径「Token」；源码 `platform/models/network_domain.go`
- **现状**：`NetworkDomain.Token` 序列化标签为 `json:"-"`，明文 token **不会**进入任何 list / detail 响应；`token_masked` 由 `AfterFind` 钩子从库中读出时派生。明文仅两处单次返回：`POST /api/v2/platform/network-domains/{id}/monitor`（MonitorOutcome 携带 `token`）与 `POST /api/v2/platform/network-domains/{id}/reset-token`（`TokenResult{token, token_masked}`）。
- **结论**：**list（GET /network-domains）不返回明文 token，仅携带 `token_masked`（完全脱敏）**；明文只在 /monitor 与 /reset-token 单次返回。该口径已满足契约 §3/§9，无需改动网络域序列化。
- **影响模块**：前端（确认消费 `token_masked` 做展示；明文仅从 /monitor 与 /reset-token 响应取）
- **发现场景**：golang-reviewer 审查时前端 reviewer 提出「list 是否返回明文 token」之疑，后端核对模型序列化后确认。

---

## 2. 部署路由 param 名统一

- **类别**：③ 技术优化（内部实现）
- **PRD 章节 / 文件位置**：契约 §5 `POST /deployments/{deployment_id}/retry`、`POST /deployments/{config_version_id}/rollback`
- **现状**：gin 同一路径段 `:id` 的通配符名必须一致，故 retry/rollback 统一用 `:id`（语义由 handler 依请求区分）。
- **结论**：URL 形态对前端不受影响，`retry` 仍走 deployment_id、`rollback` 仍走 config_version_id。
- **影响模块**：前端（无感知）
- **发现场景**：T09-06 实现期。

---

## 3. promtool / blackbox 校验态

- **类别**：① 空白判定（MVP 硬约束第 11 条）
- **PRD 章节 / 文件位置**：PRD §3.4 / 决策 42-2
- **现状**：本环境无 promtool / blackbox 二进制，生成草稿校验返回 `validation_status=pending`，集成冒烟中以直接落库 passed 等价模拟 revalidate 通过。
- **结论**：MVP 不阻断；生产需随中心 Prometheus 部署具备 promtool 才走真实校验。
- **影响模块**：后端
- **发现场景**：T09 测试/验收环境。

---

## 4. 契约口径确认：source_version 语义与版本查询兼容

- **类别**：契约口径确认（回应定向复审残留缺陷）
- **PRD 章节 / 文件位置**：契约 `api-contract-snapshot.md` §4 ConfigDraftDetail.`source_version`、§5 `GET /config-versions/{id}`；源码 `platform/configcenter/draft/service.go` GenerateDraft/ConfirmDraft、`platform/configcenter/deployment/history.go` GetVersion
- **现状修复**：此前 GenerateDraft 从不设置 `source_version`，仅 ConfirmDraft 把它置为草稿自身 `change_no`（错误）；前端按数字主键 id 调 `GET /config-versions/{id}` 拉基线不命中 → diff Tab 降级。
- **结论 / 口径**：
  1. `source_version` = 生成草稿时回填**上一已确认 ConfigVersion 的 change_no**（该网域按 created_at 取最近 confirm 生成的版本）；无历史版本为空。
  2. `GET /config-versions/{id}` 的 `{id}` 兼容两种 ref：纯数字按主键 id 命中，否则按 `change_no` 命中；`source_version`（change_no）透传直接命中。
  3. ConfirmDraft 不再覆盖 `source_version`（确认不改变基线指向）。
- **影响模块**：前端（`deploymentApi.getConfigVersion(source_version)` → `/config-versions/:id` 传 change_no 字符串，后端已兼容，前端无需改动）
- **发现场景**：T09-05 定向复审确认版本对比 Diff 永不渲染真实 diff。

---

## 5. 契约口径空白：禁用网域后纳管状态保持不变

- **类别**：① 空白判定 / 契约口径确认
- **PRD 章节 / 文件位置**：Module_09 §3.1 字段语义（行政区状态由 M06 维护、纳管状态由 M09 维护）；Module_06「网域管理」；源码 `platform/models/network_domain.go`（`Status` vs `IsMonitored`）
- **现状**：在「网域管理」（M06）将边缘域禁用（`Status=disabled`）后，M09「网域纳管」页该域**仍显示「已纳管」**并保留监控参数 / Token。根因：`NetworkDomain.Status`（M06 行政启用状态）与 `IsMonitored`（M09 监控纳管状态）是**独立字段**，M06 禁用操作不联动取消 M09 纳管，且 PRD 未对「禁用是否应取消纳管 / 冻结 Token」作出规定。
- **建议 / 结论**：认定为契约口径空白（用户判定其违反契约，属产品口径待决），先登记后评审，暂不改动。候选口径——① 禁用即取消纳管并冻结 Token；② 禁用仅行政停用、纳管与 Token 保留（当前行为）。需在后续评审中拍板。
- **影响模块**：前端（网域管理 → 网域纳管状态联动）、后端（M06 网域状态变更钩子）
- **发现场景**：M09 测试，禁用边缘域后观察网域纳管状态

---

## 6. MVP 缺漏：自动变更检测（§3.3.3 30s 轮询）+ 保存后跳转动线

- **类别**：① 空白判定 / MVP 缺漏（联调期跨模块闭环缺口）
- **PRD 章节 / 文件位置**：PRD §3.3.3（源数据版本触发检测，30s 轮询，P0）、§9.1（确认动线）；决策 42-1（活 pending 保活）、42-4（生成失败可观测）、42-5（MVP 子集含「配置生成→变更检测→确认→diff→reload」全链路）；源码 `platform/configcenter/generator/change_detect.go`（SourceDataVersion / NeedsRegeneration）、`draft/service.go`
- **现状缺漏**：`NeedsRegeneration` 全仓库**无调用方**——仅有 `GenerateDraft` 内部用 `SourceDataVersion` 给草稿 metadata 打版本戳，没有「用版本比对来触发重新生成」的链路；且 `ScrapeJobFormDrawer` 成功提示注释声明「前往配置变更确认」跳转但**未实现**、配置确认页（`useConfigDrafts.ts`）也无调 `createDraft` 的入口。净效果：用户保存采集 Job / 改资源后，UI 上没有任何途径让变更单出现，超出 30s 也不会自动生成。
- **结论（联调落地）**：**方案 A 为主 + 吸收方案 B**。
  - 后端：新增 `ConfigChangeBaseline` 持久化检测基线（DB 派生，重启/首启不误判不误生成），`configcenter/change` 包提供 30s 轮询 goroutine（`--change-detect.interval` / `CONFIG_CHANGE_DETECT_INTERVAL_SECONDS`），单域裁决后复用 `GenerateDraft`；失败记 failed 可观测状态、不推进版本、下轮重试。
  - 前端：`ScrapeJobFormDrawer` 保存后提供「前往配置变更确认」跳转并 best-effort 即时触发一次 `createDraft`（保活保证不重复，仅即时性优化）。
- **是否需设计侧确认**：需在 PRD 明确「保存即时生成 vs 30s 轮询」的即时性表述；该条目定位为 MVP 欠账补足，非 v0.2 新功能。
- **影响模块**：后端（新增 watcher + 基线表）、前端（跳转动线）
- **发现场景**：M09 联调，新增采集 Job 后配置确认页仍为「当前无待确认变更」。