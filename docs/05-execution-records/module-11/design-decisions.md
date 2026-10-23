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

### 决策 102：回传链路可观测与远程指令通道——force_restart 边界翻转（F-39 / F-40 / F-42 / F-43，2026-10-13~15）

- **问题**：M09 dev-feedback 四项均触及 M11 契约：①F-39 心跳缺回传观测字段，回传丢弃 / 重试 / 积压口径不统一（`queue_backlog_bytes` 原为单分片磁盘队列口径，内存缓冲积压不可见）；②F-40 采集状态只有 up/down 二态，回传积压场景（如 2.8h 级积压）被误判为 down、误导用户查采集配置；③F-42 回传参数 `maxDiskUsagePerURL` 无产品化配置入口，老默认 20GB 过小；④中心无任何远程干预手段，积压 / 卡死只能上机处理。M11 §1.2 原边界明写「中心远程重启边缘进程指令通道**不做**」。
- **决策**：
  1. **F-39 心跳回传观测**：`HeartbeatRequest` 新增 `remote_write_dropped_total` / `remote_write_retries_total`（counter 求和、`omitempty` 向后兼容）；`queue_backlog_bytes` 升级为 **max 口径**（`max(内存缓冲, 磁盘持久队列)`，gauge 跨分片取 max）；`AgentView` 透出（离线保留）。心跳保存时对指令位六字段 **Omit 防覆盖**——指令位只由管理面接口写入。
  2. **F-40 回传延迟列**：节点列表新增「回传延迟」列 = `AgentView.remote_write_lag_seconds`，中心侧按 `max by (network_domain_id) (time() - timestamp(last_over_time(up[24h])))` 计算（24h 窗口覆盖小时级积压），30s TTL 缓存 + 3s 超时降级；三档着色 <5min / 5–30min / ≥30min，nil 展 `-`。M01 侧同步落三态 stale 口径（聚合 `online > down > stale > pending`），拨测 blackbox 不产 stale。
  3. **F-42 回传参数产品化 + 远程重启**：`maxDiskUsagePerURL` 分层默认（平台硬兜底 1–2GB / 生产 50GB，PM 拍板）；配置入口 = 网域详情 / 纳管抽屉「回传参数」分组；经 `metadata.json` 下发（复用 `remote_write_url` 四档解析先例）；supervisor diff **滚动重启 vmagent** 生效（agent 本体不重启、`tmpDataPath` 不变队列不丢），老版本 agent 不识别新字段维持默认。重启指令走 **seq 机制**：`PUT /api/v2/platform/edge-agents/:id/restart` → `vmagent_restart_seq` +1 → 心跳响应透传 → agent 本地持久化已执行 seq、**更大值才执行**（天然幂等，无 pending/回报状态机）。
  4. **F-43 清空回传积压**：`PUT /api/v2/platform/edge-agents/:id/flush-backlog` → `flush_backlog_seq` +1；agent 执行 **Stop vmagent → 删持久队列目录（从 `-remoteWrite.tmpDataPath` 推导，回落 `EDGE_WAL_DIR` / `vmagent-cache`）→ Start**；中心仅 `status=online` 可下发（400）+ RequireAdmin + 前端 danger 二次确认展示积压量（「永久丢弃，无法恢复」）；效果由下轮心跳 backlog 归零反映。
- **边界翻转说明（推翻 §1.2 已落版表述）**：原「中心远程重启边缘进程指令通道不做」→ 改为 **seq 心跳透传机制**。**安全边界不变**：中心仍**不主动入站**，指令只经心跳响应由边缘拉取（outbound-only）；翻转的仅是「是否有远程干预手段」，不是「中心能否连入边缘」。agent 本体重启仍不做（归人工 / systemd）。
- **理由**：①seq 单调递增天然幂等，重复响应不重复执行，比「指令 + 回报状态机」少一整套状态与竞态处理；②清空积压是破坏性操作，Stop→删→Start 全程在 agent 本地完成，中心只发「意图」，离线节点直接 400 拒发避免指令悬挂；③滚动重启 vmagent 而非 agent，保住 `tmpDataPath` 队列数据——参数变更与数据安全解耦；④outbound-only 边界维持，与决策 1（G1）remote-write 接收端安全、决策 100/101 地址语义正交。
- **落地**：PRD（M11 v0.8→v0.9）§1.2 / §3.1 / §3.2 / §5.2 / §5.3 / §6.2 / §6.3 / §6.4.1 / §6.5 / §9 / §11.4；M01 v3.51→v3.52 §5.10 三态口径；M09 v2.2→v2.3 §6.4.1。**原型本轮不同步**（待后续原型轮承接：节点列表回传延迟列、行内「更多」菜单、网域「回传参数」分组）。
- **影响范围**：`platform/models`（EdgeAgent / EdgeHeartbeat 指令位与观测字段）/ `platform/edge`（心跳透传 + Omit 防覆盖）/ `platform/admin`（restart / flush-backlog 端点，RequireAdmin）/ `ui-custom/web`（M09 节点列表 + M01 实例状态）；M11 / M09 / M01 三份 PRD 同步升版；代码实现已在 M09 dev-feedback 标记已实现（2026-10-13）。

---

### Change Log（完整历史）

> 主 PRD `Module_11_Edge_Access_and_Agent_Delivery.md` 的 Change Log 仅保留最近 3 版，更早版本迁至此表。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v0.2 | 2026-09-17 | 修订 | 语义保真回填：Token 完全脱敏口径、agent_type 枚举（prometheus-agent）、人工兜底不自动 reconcile、unknown 运行态；补默认网域处理、多网域能力开关、删除级联清退、网域编辑、三档聚合、成因三档引导、心跳 RTT / RW 队列字段、诊断看板占位 | §3 / §5 / §8 / §9 | 不变 | 设计中 |
| v0.3 | 2026-09-20 | 修订 | 四轮讨论结论回填：部署形态方案 A 入 §1.2（中心 + UI 同址 G2、A2 形态、UI 外移降级为演进备选）；MVP 不引入 PostgreSQL；采集器强制 vmagent 单一化；契约字段 `wal_backlog_bytes` → `queue_backlog_bytes`；发送队列落盘持久参数；中心 remote_write 接收端（{v0.2} 前置）；§9 验收补接收通路与断流续传 | §1.2 / §3.1 / §5 / §6.4 / §7.2 / §9 / §10 / §11.4 | MVP 不变；{v0.2} 微调 | 设计中 |
| v0.4 | 2026-09-20 | 修订 | 第五轮拍板回填：Agent 自升级由「不做」改为 {v0.3} 拉模式自升级（默认关闭 + 规模门槛 + 验签 / 原子回滚 / 按网域灰度）；§4.4 升级流程补自升级链路；§6.1 补中继选型一句话约束（应用层反代 + 存储转发、禁 L4/TCP） | §3.3 / §4.4 / §6.1 | {v0.3} | 设计中 |
| v0.5 | 2026-09-25 | 修订 | 吸收 dev-feedback F-7/F-15/F-16/F-17/F-21/F-22 与 design-proposal config-sync-stall（Track B，已 merged）：① 网域运行态枚举对齐四档（online→normal，新增 partial），由 offline_detector 聚合（§5.1 / §8.2）；② 边缘进程守护新增父死子亡机制（Linux Pdeathsig + systemd KillMode=control-group 兜底），心跳超时组件状态统一降级「未知」（§6.4.2 / §11.4）；③ 配置同步新增「同步中」（pull_pending，蓝）中间态与「同步失败」（apply_failed，红）终态，心跳契约新增 config_apply_error / config_apply_failed_version 可选字段，pull_pending 仅在节点存活时成立、离线 / 退纳管失效回落未同步（§5.2 / §5.3 / §6.2 / §8.1 / §11.4）；④ last_config_pull 写入口径（版本推进 / 应用失败留痕，同版本不刷新）与抽屉「最后心跳 / 最后配置拉取」展示（§5.2 / §11.4） | §5.1 / §5.2 / §5.3 / §6.2 / §6.4.2 / §8.1 / §8.2 / §9 / §11.4 | {v0.2} 微调 | 设计中 |
| v0.6 | 2026-09-25 | 修订 | 吸收 dev-feedback F-29/F-30：① 下载入口改为 agent_pull 网域行内「更多 → 下载安装包」，中心直连域（local）行不出现下载入口、页面顶部常驻「中心直连域无需部署采集节点」提示置于折叠区外、折叠标题限定为「边缘域接入操作流程（安装指引）」；② 安装指引 Steps 扩为 5 步、首步「复制并保存接入 Token」，Token 严格仅纳管 / 重置单次展示、不新增二次查看明文入口 | §3.1 / §3.3 / §9.1 / §11.3 | {v0.2} 微调 | 设计中 |
| v0.7 | 2026-09-25 | 修订 | 地址语义收敛（消除 PRD/实现脱节）：① §5.1 `center_endpoint` 由「agent_pull 必填、供合成下载地址」改为 {v0.4+} 网闸映射场景预留、当前不消费；② §6.2 `config_download_url` 合成规则由「center_endpoint + 路径」改为「请求来源 authority + 路径」；③ §6.4 第 1 条补 `CENTER_ENDPOINT` 环境变量（Agent 心跳地址 + 回传地址方案 A 兜底推导），补掉决策 73 遗留的地址传递机制缺口（2026-10-23 v0.11 落版后自 PRD Change Log 轮转迁入） | §5.1 / §6.2 / §6.4 | 实现对齐（不改契约） | 设计中 |
| v0.8 | 2026-09-30 | 修订 | 吸收 M09 dev-feedback 补录（F-26 / F-27 / F-37）：① `center_endpoint` 由「{v0.4+} 预留、不消费」**回归为优先消费**——配置包下载地址优先取网域 `center_endpoint`（取 `scheme://host`，空 / 非法回落请求来源 authority），与 Agent `CENTER_ENDPOINT` 同源、中心地址变更只需改此字段（§5.1 / §3.1 / §6.2 / §9.2 / §10）；② 新增「网域详情抽屉（采集节点情况）」区块（4 行，local 恒 `-`，纯前端信息补全）（§3.1 / §11.3 / §9.1）；③ 安装指引按接入方式双分支（中心直连域明示免部署可跳过；采集节点域 4 步动线 + Edge Sync Agent {v0.2} 交付口径）（§3.1 / §11.3 / §9.1）（2026-10-23 v0.11 落版后自 PRD Change Log 轮转迁入） | §3.1 / §5.1 / §6.2 / §9.1 / §9.2 / §10 / §11.3 | {v0.2} 微调 | 设计中 |
