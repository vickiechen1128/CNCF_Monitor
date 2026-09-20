# module-11 dev-feedback

> 关联设计提案：`docs/05-execution-records/module-11/design-proposals/edge-delivery-topology-and-agent-upgrade.md`。
> 收割：非空反馈随 feat PR 描述链接；② 类（实现矛盾）走 CR。

## F-组 1：边缘交付增强（v0.2 增量，2026-09-20）

### ② 阻断级前置 —— G1：中心 remote_write 接收端缺失（单独排期，不并入本批）

- **现状**（核对 `feat/module-09-config-center`）：`Makefile run-prometheus` 仅 `--web.enable-lifecycle`，未开 `--web.enable-remote-write-receiver`；`platform/` 下无 ingest 实现。
- **影响**：边缘 vmagent 采集的指标通过 remote_write 回传中心，但中心**无处接收落地**；DER 提案 §7-G1 判定为**阻断级**。A/A′/B 部署方案全部依赖此项。
- **与选型关系**：采集器单一化为 vmagent 后，vmagent 仍走 remote_write 协议 → **G1 在中心侧、与选型无关，仍然必做**。
- **处理**：**单独排期**（不混入离线下载包批次）。本批仅登记，不发改。建议 {v0.2} 内单独立项：Makefile 开 `--web.enable-remote-write-receiver` + `platform/` 新增 `/api/v1/write` 接收通路。
- **来源**：设计提案 §7-G1；参考对话「edge agent 离线下载包」讨论。

### F-2：诊断看板（§3.2 P1/P2）本批不做

- **现状**：PRD §3.2「边缘诊断看板」（心跳 RTT 趋势、回传积压趋势、RW 队列、24h 断网时长等）为 P1/P2，交付版本后续。
- **处理**：本批（v0.2 采集节点状态页）仅实现 P0 平铺表/抽屉/筛选，诊断看板保留后续版本；采集节点状态页实连后 RTT / 积压数据源已具备，后续批次可直接消费。

### F-3：前端采集节点状态页空态文案指向不存在的元素（引用设计提案 §3.5 / G6）

- **现状**：EdgeAgentsPage 空态文案「按页面顶部『安装指引』…」，但安装指引区在网域纳管页顶部，采集节点状态页无该元素。
- **处理**：随 T11-25 空态三支改版时一并修正为「前往网域纳管页查看安装指引」。

### F-4：/edge-agents 后端未实现服务端五维筛选（golang-reviewer H1 定版→方案 b）

- **现状**：`ListAgentsHandler`（platform/edge/management_handler.go）不解析任何筛选 query 参数，恒返回全量；PRD §3.2 + 契约快照 §1 定义的五维筛选（network_domain_id / status / collector_status / blackbox_status / config_sync_status）当前由前端 `useEdgeAgents` 做客户端过滤兜底。
- **影响**：功能可用，但页面数据量大时存在全量拉取 + 前端过滤的性能回退；契约快照宣告的服务端筛选能力未落地。golang-reviewer H1 复核补充：后端 `summary`/`overall` 在**全量** agents 上计算，若调用方按筛选语义消费会得到与过滤后 agents 不一致的失真聚合。
- **处理**：**方案 b（2026-09-20 定版）**——契约快照 §1 明确标注「筛选为客户端过滤、服务端 {v0.3} 实现」，并注明 {v0.3} 前不得将 summary/overall 理解为过滤后子集聚合。前端已收敛为纯客户端过滤（edgeAgents.ts 无参 list，见 T11-23/24/25 修复）。** {v0.3}** 在 `ListAgentsHandler` 增加 query 参数解析与条件过滤（先过滤再聚合），并保持与契约快照 §1 一致。