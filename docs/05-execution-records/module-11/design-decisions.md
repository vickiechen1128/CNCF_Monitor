# M11 设计决策记录（design-decisions）

> 本文件记录 M11 边缘交付拓扑与 Agent 升级相关的跨模块契约决策。
> 来源：设计提案 `edge-delivery-topology-and-agent-upgrade.md` §7-G1、G1 独立批次（T11-G1-01~05）审查结论。

---

### 决策 1：G1 remote-write 接收端安全让步——跃迁临时写入口按「内网可信 + M10 收敛」接受，绑定最小暴露面

- **问题**：中心 Prometheus 开启 `--web.enable-remote-write-receiver`（T11-G1-01）后，`/api/v1/write` 为无内置写认证的注入入口（任何可达客户端可 POST 任意 job/label/指标名/时间戳，并伪造 `network_domain_id` 标签，存 TSDB 投毒 / 告警规避面）。该入口为反向写方向（边缘→中心），AGENTS.md §9 的「控制面代查 Prometheus」SSRF/代理鉴权条款不直接覆盖，属新暴露面。
- **决策**：接受「内网可信 + 后续 M10 统一摄取网关收敛」让步，当前状态可合入；同时执行最小暴露面控制——`run-prometheus` 将 `--web.listen-address` 由 `:9090` 收束为 `127.0.0.1:9090`，仅暴露给本机/同区控制面代理与受控写方（已随 G1 批次回灌，见 Makefile run-prometheus）。
- **理由**：① G1 是 MVP 跃迁临时接收端，M10 统一摄取网关就绪后整体替换，作为「跃迁让步」成本合理；② 当前写方为受控边缘 vmagent + 管理域直连，正常路径无暴露；③ 收束监听零功能影响、成本近零，是列表最低的缓解项。
- **让步（明确接受）**：写入口无 per-domain Token/Basic 鉴权，明文 HTTP 走内网；`network_domain_id` 由 G1-c 随传输保留但无强校验，单一来源内网受控时风险降为 LOW。
- **M10 收敛点**：M10 统一摄取网关就绪即替换本 receiver；其鉴权方案（每网域独立 Token / mTLS / 指标白名单）届时落闸，本让步解锁。
- **安全边界**：生产多网域动线（网闸/G2 公网）**必须**走 G2 nginx：来源 IP 白名单 + TLS 终结 + 每网域独立 Token（对应网络域模型 `Token` 字段），UI/agent 接口分流——列为生产部署红线，凡 receiver 跨出单机/可信内网即触发硬化。
- **影响范围**：`Makefile`（run-prometheus listen-address 收束，已回灌）、`docs` 决策记录、M10 摄取网关验收标准；不涉及 `upstream/prometheus`。

---

### Change Log（完整历史）

> 主 PRD `Module_11_Edge_Access_and_Agent_Delivery.md` 的 Change Log 仅保留最近 3 版，更早版本迁至此表。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v0.2 | 2026-09-17 | 修订 | 语义保真回填：Token 完全脱敏口径、agent_type 枚举（prometheus-agent）、人工兜底不自动 reconcile、unknown 运行态；补默认网域处理、多网域能力开关、删除级联清退、网域编辑、三档聚合、成因三档引导、心跳 RTT / RW 队列字段、诊断看板占位 | §3 / §5 / §8 / §9 | 不变 | 设计中 |