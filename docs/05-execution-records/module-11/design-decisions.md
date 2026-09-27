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

### 决策 100：网域纳管地址语义收敛——`center_endpoint` 降级为 {v0.4+} 预留，心跳/回传地址 SSOT 厘清（2026-09-25）

- **问题**：PRD（v0.6）声称网域纳管时填 `center_endpoint`、中心据此合成 `config_download_url` 下发给 Agent；但生产实现与此脱节——①纳管表单 `OnboardDomainDrawer` 不填该字段（仅填 `remote_write_url`）；②中心合成下载地址用请求来源 `requestAuthority`（`platform/edge/helpers.go` 注释明说「不再依赖从未赋值的 dom.CenterEndpoint」）；③Agent 心跳地址靠安装时 `CENTER_ENDPOINT` 环境变量（`config.go` 必填三项之一）；④回传地址靠 `remote_write_url`（metadata.json 下发，方案 B）+ `CENTER_ENDPOINT` 兜底推导（方案 A，`probe.go` resolveRemoteWriteURL）。离线包为 1 个通用默认包、不含任何地址。即 `center_endpoint` 是「PRD 有、代码未消费」的僵尸字段，且地址被劈成「装包手填（心跳）+ 纳管登记（回传）」两处，PRD 未写明。
- **决策**：承认现状、砍掉僵尸语义、厘清地址 SSOT——①`center_endpoint` 字段**降级标注 {v0.4+} 网闸映射场景预留**（models 保留字段、前端类型保留，但不参与当前任何运行时链路，详情抽屉「中心接入地址」展示行移除）；②`CENTER_ENDPOINT` 环境变量**保持装包时手填**（Agent 心跳地址 + 回传地址方案 A 兜底）；③`remote_write_url` **保持纳管时登记**（留空自动推导，经 metadata.json 下发，方案 B）。
- **理由**：①`center_endpoint` 的「网闸转发侧地址」语义确实存在（节点够不到中心、须填转发侧地址），硬删会丢未来能力，降级预留最稳；②Agent 必须启动即知道中心在哪，且网闸场景地址是节点侧视角，装包时手填最自然；③数据面可能走独立代理，须经配置包下发、不能靠环境变量写死。三者各归其位，消除「既没被填、也没被读」的僵尸。
- **落地（代码 → PRD 先后顺序，按用户要求先改代码验证再回填）**：
  - 代码：`platform/models/network_domain.go`（CenterEndpoint 加预留注释）、`platform/configcenter/domain/service.go`（包注释）、`ui-custom/web/src/types/config-center.ts` / `domain.ts`（类型注释）、`ui-custom/web/src/pages/admin/domains/domainRules.ts`（删无效判据）、`ui-custom/web/src/pages/config-center/domains/NetworkDomainDetailDrawer.tsx`（删展示行）。验证：`go build ./platform/...` 通过、`go test` configcenter/domain + edge 通过、前端 tsc 通过、vitest 9 文件 66 测试全绿。
  - PRD（v0.6→v0.7）：§5.1 字段表 / §5.1 所有者声明 / §3.1 地址语义 / §6.1 地址约束同步标注；§6.2 `config_download_url` 合成规则由「center_endpoint + 路径」改为「请求来源 authority + 路径」；§6.4 第 1 条补 `CENTER_ENDPOINT` 三必填 + 方案 A 兜底（**补掉决策 73 遗留**「Agent 心跳地址传递机制 PRD 未显式定义」）。
- **影响范围**：`platform/models` / `platform/configcenter/domain` / `ui-custom/web/src`（类型与两页）；M11 PRD §3.1 / §5.1 / §6.1 / §6.2 / §6.4；**不改 API 契约**（`center_endpoint` 字段保留、`remote_write_url` 语义不变）。跨模块：M06（网域行政）不受影响，M09 只读 `channel` 不受影响。
- **遗留 / 待办**：①`Modules/README.md` 版本总表 M11 行 PRD 版本 v0.6→v0.7 待回写（属版本总表轮，另线推进）；②`center_endpoint` 的 {v0.4+} 网闸映射场景，届时需重定「写入时机 + 消费契约」（当前既无写入也无读取）。

---

### Change Log（完整历史）

> 主 PRD `Module_11_Edge_Access_and_Agent_Delivery.md` 的 Change Log 仅保留最近 3 版，更早版本迁至此表。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v0.2 | 2026-09-17 | 修订 | 语义保真回填：Token 完全脱敏口径、agent_type 枚举（prometheus-agent）、人工兜底不自动 reconcile、unknown 运行态；补默认网域处理、多网域能力开关、删除级联清退、网域编辑、三档聚合、成因三档引导、心跳 RTT / RW 队列字段、诊断看板占位 | §3 / §5 / §8 / §9 | 不变 | 设计中 |
| v0.3 | 2026-09-20 | 修订 | 四轮讨论结论回填：部署形态方案 A 入 §1.2（中心 + UI 同址 G2、A2 形态、UI 外移降级为演进备选）；MVP 不引入 PostgreSQL；采集器强制 vmagent 单一化；契约字段 `wal_backlog_bytes` → `queue_backlog_bytes`；发送队列落盘持久参数；中心 remote_write 接收端（{v0.2} 前置）；§9 验收补接收通路与断流续传 | §1.2 / §3.1 / §5 / §6.4 / §7.2 / §9 / §10 / §11.4 | MVP 不变；{v0.2} 微调 | 设计中 |
| v0.4 | 2026-09-20 | 修订 | 第五轮拍板回填：Agent 自升级由「不做」改为 {v0.3} 拉模式自升级（默认关闭 + 规模门槛 + 验签 / 原子回滚 / 按网域灰度）；§4.4 升级流程补自升级链路；§6.1 补中继选型一句话约束（应用层反代 + 存储转发、禁 L4/TCP） | §3.3 / §4.4 / §6.1 | {v0.3} | 设计中 |