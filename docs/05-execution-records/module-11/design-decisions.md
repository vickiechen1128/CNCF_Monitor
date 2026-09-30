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

### 决策 101：`center_endpoint` 回归优先消费——单一来源合成配置包下载地址（2026-09-30）

- **问题**：决策 100（2026-09-25）把 `center_endpoint` 降级为 {v0.4+} 预留、`config_download_url` 合成改为「仅按请求来源 authority」。5 天后（2026-09-30）dev-feedback F-37 暴露 **生产病灶**：中心地址经网闸隧道换过多次，`center_endpoint` 每次都在腾讯采集节点域 `mc-edge-debug` 更新 agent 配置里的 `CENTER_ENDPOINT` 环境变量，但中心下发的 `config_download_url` 由请求来源合成、与之脱钩——Agent 拉包静默失败、版本冻结，且无 `apply_error`。根因：**两套独立的地址来源无法保证同步**，任何一方漂移即隐性断链。
- **决策**：**推翻决策 100 关于 `center_endpoint` 不消费的定论**，回归为——`center_endpoint` 字段与 Agent `CENTER_ENDPOINT` 环境变量**同源**（须填同一值），中心侧合成 `config_download_url` 时**优先取网域 `center_endpoint`**（取其 `scheme://host` authority，含路径只取 authority 部分）；为空 / 非法（缺 scheme / 缺 host）时**回落**请求来源 authority。**单一来源**：中心地址变更只需改 `center_endpoint`（DB 字段 + Agent 环境变量同步更新），无需改代码。
- **理由**：①F-37 提供了**生产级反例**——决策 100 的「僵尸字段清理」假设 `center_endpoint` 从未被填、也从未被读，但生产网域 `mc-edge-debug.center_endpoint` 已填过、且 agent 环境变量与它同源（用户填的时候自然会两边对齐）；②「请求来源 authority 合成」的本质是**信任入站请求的 Host / X-Forwarded-* 头**，但网闸隧道场景下入站 Host 是隧道端口号、不是 Agent 可达的公网地址；③单一来源是最简单、最不聪明的解决方案——中心侧写一次、Agent 侧写一次、二者必须一致，比「推导」更可预测、更好排查。
- **决策 100 遗留清理**：决策 100 的 PRD 修订（§5.1 字段标注 / §6.2 合成规则 / §3.1 地址语义 / §6.1 地址约束）**全部推翻**；决策 100 关于 `CENTER_ENDPOINT` 环境变量三必填 + 方案 A 兜底的 PRD 修订（§6.4）**维持有效**（Agent 端地址来源仍由环境变量提供，本次只改中心下发地址的合成来源）。决策 100 的「`center_endpoint` 降级 {v0.4+} 预留」标注**删除**（字段现被 MVP 消费）。
- **落地（代码 → PRD 同步，F-37 已落代码，本次补 PRD）**：
  - 代码：`platform/edge/helpers.go`（新增 `resolveDownloadAuthority` / `authorityHost`，优先 `center_endpoint`）、`platform/edge/heartbeat_handler.go`（改调用 `resolveDownloadAuthority`）、`platform/models/network_domain.go`（删除 `center_endpoint` 字段「MVP 不消费」注释）、`platform/admin/networkdomain/{create,update}.go`（开放 `center_endpoint` 到 API + 校验 scheme / host）。
  - 测试：`edge_test.go` / `TestResolveDownloadAuthorityPrefersCenterEndpoint`（4 子例：合法优先 / 含路径只取 authority / 空回落转发头 / 非法回落请求 Host）。
  - PRD（M11 v0.7→v0.8）：§5.1 所有者声明 + 字段行 / §3.1 地址语义 / §6.1 地址约束 / §6.2 合成规则（**显式保留两次口径变更的明文记录，供后续评审固化**）/ §9.2 技术验收 / §10 术语表。
- **与决策 104（M10 / G1）方向不同**：决策 100 / 101 管的是**边缘侧「中心在哪」**的地址传递；决策 1（G1）管的是**中心 Prometheus remote_write 接收端的安全**。二者正交，互不影响。
- **影响范围**：`platform/models` / `platform/edge` / `platform/admin/networkdomain`（API 开放字段）；M11 PRD v0.8（§3.1 / §5.1 / §6.1 / §6.2 / §9.2 / §10）；**不改 API 契约**（`center_endpoint` 字段语义收敛，是契约修订而非扩展）；**不影响 M09**（M09 只读 `channel`，不消费 `center_endpoint`）；**不影响 M08**（桥地址走独立的 `notify.bridge-url` 参数，与本决策无关）。
- **新发现（决策 101 附带）**：M09 dev-feedback F-36 暴露的「桥基础地址变化导致 receiver 物化幂等识别失效」与本决策同根——**多个组件各自推导中心地址**，无统一权威。已在 M09 PRD §7.1.5 登记边界，但**桥地址 SSOT 须由 M08 / 全局配置决策层补**，不在本决策范围（已在 prototype-designer.md 标注为「跨模块待决」）。

---

### Change Log（完整历史）

> 主 PRD `Module_11_Edge_Access_and_Agent_Delivery.md` 的 Change Log 仅保留最近 3 版，更早版本迁至此表。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v0.2 | 2026-09-17 | 修订 | 语义保真回填：Token 完全脱敏口径、agent_type 枚举（prometheus-agent）、人工兜底不自动 reconcile、unknown 运行态；补默认网域处理、多网域能力开关、删除级联清退、网域编辑、三档聚合、成因三档引导、心跳 RTT / RW 队列字段、诊断看板占位 | §3 / §5 / §8 / §9 | 不变 | 设计中 |
| v0.3 | 2026-09-20 | 修订 | 四轮讨论结论回填：部署形态方案 A 入 §1.2（中心 + UI 同址 G2、A2 形态、UI 外移降级为演进备选）；MVP 不引入 PostgreSQL；采集器强制 vmagent 单一化；契约字段 `wal_backlog_bytes` → `queue_backlog_bytes`；发送队列落盘持久参数；中心 remote_write 接收端（{v0.2} 前置）；§9 验收补接收通路与断流续传 | §1.2 / §3.1 / §5 / §6.4 / §7.2 / §9 / §10 / §11.4 | MVP 不变；{v0.2} 微调 | 设计中 |
| v0.4 | 2026-09-20 | 修订 | 第五轮拍板回填：Agent 自升级由「不做」改为 {v0.3} 拉模式自升级（默认关闭 + 规模门槛 + 验签 / 原子回滚 / 按网域灰度）；§4.4 升级流程补自升级链路；§6.1 补中继选型一句话约束（应用层反代 + 存储转发、禁 L4/TCP） | §3.3 / §4.4 / §6.1 | {v0.3} | 设计中 |