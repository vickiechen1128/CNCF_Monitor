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