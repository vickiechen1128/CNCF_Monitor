# 边缘目标状态快照清理修复（M02 / M09 / M11）

- 日期：2026-10-22
- 分支：feature/zwq
- 涉及模块：M02 监控目标状态、M09 配置下发、M11 边缘 Agent 心跳

## 问题

删除资源或采集 Job 后，「监控目标状态」页仍持续展示对应的边缘 target；agent 退纳管 /
删除后旧目标也不会消失。页面上的记录 `health=unknown`，最后采集时间停留在旧时间。

## 根因

1. 中心收到心跳时，`targets` 为空直接跳过落库（`persistEdgeTargetSnapshots`），而 Agent
   侧 `targets` 带 `omitempty`，空列表不会发出。删除该网域全部目标后，旧快照永远没有
   新一轮数据来覆盖，90s 后仅降级为 unknown，行继续展示。
2. 删除资源、删除 Job、退纳管、删除网域等路径均未清理 `edge_target_snapshots`。
3. 快照清理按 `edge_agent_id` 维度执行；同网域换 Agent / 重注册后旧 ID 的行残留，既继续
   展示旧目标，也会与新 Agent 插入同键快照时触发唯一索引冲突。

## 修复

- 心跳契约新增 `targets_collected`：Agent 明确上报本轮 targets 采集是否成功（vmagent
  正常响应且解析成功，包括空列表）。
- 中心落库改为：
  - 非空 targets 或 `targets_collected=true`（含空列表）→ clear-then-insert；
  - 空 targets 且未上报成功标记（采集失败 / 老 Agent）→ 保留旧快照，避免误清。
- 删除资源时按 `resource_id` 清理快照；删除 Job 时按 `(network_domain_id, job)` 清理；
  退纳管 / 级联删除网域时按 `network_domain_id` 清理。
- 快照清理统一改为按网域维度，覆盖换 Agent / 重注册场景。
- 老 Agent 未上报 `targets_collected` 时保持原有行为，向后兼容。

## 验证

- `go test ./platform/config/resource ./platform/strategy/scrapejob ./platform/edge ./platform/admin/networkdomain ./platform/query`
- Agent：`go test ./cmd/edge-sync-agent ./internal/contract ./internal/puller`
- `go build ./platform/...`、Agent 模块 `go build ./...`、`go vet` 通过
- `repo-map` 已重新生成并通过新鲜度校验
