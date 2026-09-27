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

### F-5：网域纳管页「安装指引」缺可操作命令 + 环境变量注入文案与实际不符（② 实现矛盾，随本批修复）

- **现状**：`NetworkDomainsPage`「新网域接入操作流程」Steps 仅 4 步文字（下载/解压部署/启动守护/心跳回连），「解压部署」「启动/守护」两步**无可执行命令**——用户下载离线包后不知道需执行 `tar` 解包、按架构 symlink `bin/edge-sync-agent-linux-<arch>`、以环境变量注入接入配置、`systemctl` 拉起等步骤；`EdgePackageDownloadPanel` 仅提供下载按钮+版本清单，无部署命令。
- **影响**：指引与实测部署动线（`/opt/apps` 程序只读 + `/opt/data` 数据可写 + symlink + `NETWORK_DOMAIN_ID/TOKEN/CENTER_ENDPOINT` 环境变量/systemd Environment 注入）脱节；第 2 步文案「Token / 中心地址 / Remote Write URL 在纳管时自动签发写入 Agent 配置」与实现不符（实际为**环境变量/systemd Environment 注入**，非「写入 Agent 配置」）。
- **处理**：① 在 Steps 的「解压部署」「启动/守护」两步内嵌**可复制 shell 命令块**，命令口径对齐 unit 布局（`/opt/apps/edge-sync-agent` 程序 + `/opt/data/edge-sync-agent` 数据 + symlink `bin/edge-sync-agent-linux-<arch>` + 环境变量 exports/systemd Environment 覆盖）；② 修正第 2 步文案为「接入配置以环境变量 / systemd Environment 注入（Token / 中心地址 / Remote Write URL）」。随本批前端修复落地。

### F-6：agent_pull 下发记录永久停留「待执行」（② 实现缺口→随本批后端修复）

- **现状**：`platform/configcenter/deployment/service.go` `dispatchVersion` 对 `agent_pull` 通道**仅登记一条 `pending` 占位记录**（[L148-154](../../../platform/configcenter/deployment/service.go#L148-L154)），无任何翻转为 `success` 的连接点——`success/failed` 只存在于 `local` 通道的 `applySafe` 分支。跨主机联调复现：中心「配置发布与回滚记录」页 `agent_pull` 域记录（如 `deploy-20260921-002`，版本 13，变更单 `CHG-20260921-005`）一直「待执行」，即便节点配置同步已显示「已同步」。
- **影响**：前端「配置同步（节点侧）」与「下发记录状态（config_deployments 表）」两套口径不一致，运维侧无法从下发记录确认边缘配置已生效。
- **处理**：在 `platform/edge/heartbeat_service.go` `Handle` 内新增 `writebackAgentPullDeployments`——agent 心跳上报的 `config_version` 已与网域最新已确认 `ConfigVersion` 一致（`!changed`）时，将该网域对应该版本的 `pending` agent_pull 下发记录回写为 `success` + `completed_at`；未同步时不动，回写失败降级不阻断心跳。已补单测 `TestHeartbeatWritebackAgentPullDeployment`（edge_test.go）：① 同步→success；② 上报旧版本→保持 pending。随本批后端修复落地，需升级 `platform/edge` 与 `platform/configcenter/deployment` 关联契约。

### F-7：网域「采集节点在线」前后端运行态枚举不一致（② 实现矛盾→随本批前端修复 + 对齐 PRD 契约）

- **现状**：后端 `platform/edge/offline_detector.go` 聚合网域运行态为**四档** `normal/partial/offline/unknown`（`DomainRuntimeNormal=normal`、`DomainRuntimePartial=partial`、`DomainRuntimeOffline=offline`、`DomainRuntimeUnknown=unknown`，`StartOfflineDetector` 已在 `main.go:142` 接线）。但前端三处只认**三档旧枚举** `online/offline/unknown`：① `configCenterConstants.ts` `monitoredStatusLabel/monitoredStatusColor` 无 `normal/partial`；② `types/config-center.ts` `MonitoredStatus` 与 `types/domain.ts` `NetworkDomain.monitored_status` 类型仍为 `'online'|'offline'|'unknown'`；③ `pages/admin/domains/domainRules.ts isVacantDomain` 用 `=== 'online'` 判空域。
- **影响**：跨主机调试中 `mc-edge-debug` 域经心跳 + 离线探测器算出 `monitored_status=normal`（节点全部在线），前端 `label['normal']` 为 `undefined` →「采集节点在线」列 Tag 空白，肉眼等同「-」，被误判为「网域纳管的采集器状态不同步」。后端数据实际正确（curl 验证 list 返回 `normal`），问题纯在**前端枚举未随后端四档收敛**。
- **处理（前端）**：① `configCenterConstants.ts` 对齐四档——`normal`→在线/success、`partial`→部分离线/warning、`offline`→离线/error、`unknown`→未知/default；② 两个 TS 类型文件 `MonitoredStatus` 与 `NetworkDomain.monitored_status` 改为 `'normal'|'partial'|'offline'|'unknown'`；③ `isVacantDomain` 改为「非 empty 且非 `unknown` 即非空域」（normal/partial/offline 均表明已纳管监控）。同步更新 2 个测试 fixture（`'online'`→`'normal'`）。tsc + vitest（7 文件/50 断言）全绿。**需联动更新 M11 PRD 接口契约**：运行态枚举以后端四档为权威（此四处此前未随后端收敛，属实现偏差）。
- **来源**：跨主机联调（edge-agent-cross-host-e2e）「采集节点在线」列空白问题；curl 后端命中 `mc-edge-debug monitored_status=normal`。

#### F-7 附：M11 PRD 接口契约修订建议（运行态枚举对齐四档）

> 供 prototype-designer / chenrt 应用到 M11 PRD；本处落档作为追溯，不直接改 PRD（目录隔离铁律）。

**变更点 1｜`monitored_status`（网域运行态）枚举**：以四档为权威——

| 取值 | 含义 | 前端展示 | Tag 颜色 |
|------|------|----------|----------|
| `normal` | 正常：采集节点全部在线 | 在线 | success（绿） |
| `partial` | 部分异常：在线/离线混合 | 部分离线 | warning（黄） |
| `offline` | 离线：全部失联 | 离线 | error（红） |
| `unknown` | 无节点或状态未知 | 未知 | default（灰） |

> 增量说明：新增 `partial` 档；原 `online` 更名 `normal`。仅 agent_pull 已纳管域有此字段；`local` 通道恒空。

**变更点 2｜运行态来源**：`monitored_status` 由 `offline_detector` 定时聚合（扫描 `EdgeAgent.last_heartbeat` 超阈值置离线，按节点聚合），恢复心跳自动回 `normal/partial`。前端「采集节点在线」列 + 详情抽屉「采集节点情况」区块共同消费。

**变更点 3｜前端 TS 类型与空域判定**：`MonitoredStatus`/`NetworkDomain.monitored_status` = `'normal'|'partial'|'offline'|'unknown'`；`isVacantDomain` 改为「存在且 ≠ `unknown` 即非空域」。

### F-8：agent_pull 下发确认后 ScrapeJob.change_status 未回写，前端永久「待确认」（② 实现矛盾→随本批后端修复）

- **现状**：`platform/configcenter/deployment/service.go` `dispatchVersion` 对 `agent_pull`（非 local）通道仅 `db.Create(dep)` 登记 pending 占位下发记录后直接 `return dep`（L152-163），**未调用 `writebackChangeStatuses`**。该回写入口（L184/callback.go）只在 **local** 通道成功下发后执行，故 `ScrapeJob`/`MonitoringRule` 的 `change_status` 对 agent_pull 网域始终停留在 `pending`。
- **影响**：跨主机联调中 `tengxunyun-ceshi-host`（属 `mc-edge-debug`，agent_pull）确认下发后：后端 `config_deployments` 有成功记录、后台已无 pending 变更单，但该 Job「变更进度=待确认」「生效状态=待生效」永久卡住。前端 `ScrapeJobListPage` 的 `CHANGE_PROGRESS_MAP` `pending→待确认` 直接把该字段如实展示，故与后台 state 冲突。
- **根因归类**：同 F-6——agent_pull 通道的下发/生效回写不完整。agent_pull 语义为「确认即纳入待拉包生效队列」，确认时即应回写 `change_status=deployed`（与 local 分支一致），而非仅登记占位。
- **处理**：在 `dispatchVersion` agent_pull 分支 `db.Create(dep)` 后追加 `writebackChangeStatuses(db, version.NetworkDomainID)`，语义同 local 分支——仅把 `change_status=pending && draft_status=ready` 的 Job/规则回写为 `deployed`（`none` 保持不变）；回写失败降级记录 `error_message` 且不整链 500（与 local 分支 MEDIUM-1 解耦策略一致）。已扩展单测 `TestDispatchAgentPullPlaceholder`（deployment_test.go）：挂一台 pending + 一台 none，agent_pull 确认后 pending→deployed、none→none。
- **来源**：跨主机联调（edge-agent-cross-host-e2e）`tengxunyun-ceshi-host` 采集 Job 状态卡「待确认」；结合 subagent 定位 dispatchVersion/callback.go 回写支配。

### F-9：agent 落盘 metadata.json 丢 remote_write_url + reload 不重启 vmagent，导致监控目标为空（② 实现矛盾→随本批 edge agent 修复）

- **现状**：跨主机联调中边缘域新增的采集 Job 确认下发成功后：中心 9090 查询 `up{network_domain_id=mc-edge-debug}` **无数据**、前端监控目标为空；腾讯云 `ps aux` 显示 vmagent 命令行 `-remoteWrite.url=featuring-…:8080`（仍是控制面隧道/center_endpoint 推导地址，非 9090 数据隧道）。根因是 edge agent 侧**双缺陷叠加**：
  - **缺陷①** `platform/edge-sync-agent/internal/deployer/validate.go` `marshalMetadata` 重写落盘 `current/metadata.json` 时**只序列化 config_version/generated_at/agent_type/checksum**，把中心 `zipper.go` 已下发的 `remote_write_url`（网域 RemoteWriteURL，config_handler.go L61 已透传）**丢弃**。probe `metadataRemoteWriteURL` 从 disk 读到空值 → `resolveRemoteWriteURL` 回落到 center_endpoint 推导（8080 控制面地址）→ vmagent 样本发往 8080，中心 9090 收不到。
  - **缺陷②** `promReload`（main.go）对新版本**仅 SIGHUP / /-/reload 热加载**，vmagent `-remoteWrite.url` 是**进程启动时固定的 CLI 参数**，SIGHUP 无法更新；supervisor `tick` 只在进程失活/不健康时才重启，不因版本切换重启。故即便 metadata 修对，运行中 vmagent 仍保持旧地址。
- **处理**：① `marshalMetadata` 增加 `RemoteWriteURL` 字段透传（`json:"remote_write_url,omitempty"`）；② 新增 `ProcProbe.Reload(typ)`——比较运行实例 `lastArgs` 与当前生效目录 `spec.args(configDir)` 派生参数：一致则 SIGHUP 热加载（仅 prometheus.yml 变更），**不一致则 Stop+Start 重启**应用新 `-remoteWrite.url`；`promReload` 改为调用 `probe.Reload(collector)`。blackbox 参数只随 configDir 同形路径，跨版本不变，仍走热加载。**重拉需新 config_version 串**（中心按版本串判 config_changed），用新版本包下发后 vmagent 自动重启指向 9090。
- **补充清单**：中心 `zipper.go`/`config_handler.go` 已正确下发 remote_write_url（edge_test.go `TestBuildConfigZipRemoteWriteURL` 覆盖），**无需中心改动**。已补单测：`deployer_test.go TestApplyMetadataRemoteWriteURLPersisted`（Apply 落盘后读回 remote_write_url）、`probe_test.go TestSameArgs/TestProcProbeReloadNotRunning`。edge-sync-agent 模块 `go test ./...` 全绿。
- **遗留可选优化**：联合 checksum 现不涵盖 remote_write_url，中心判定 config_changed 用 config_version 串（已随新版本触发重拉），无需强制纳入；如需 remote_write_url 单独变更也触发 agent 重拉，后续可在 zipper checksum 纳入该字段另登记 F 项。
- **来源**：跨主机联调（edge-agent-cross-host-e2e）边缘域监控目标为空 + 腾讯云抓包 vmagent 旧命令行；subagent 定位 marshalMetadata + triggerReload。

### F-10：边缘域 Job「实例采集状态」恒 0/x —— 边缘 target 状态数据源错位（① 设计缺口→待决策，跨 M01/M02/M11）

- **现状**：数据面已打通（中心 9090 能查到边缘 vmagent remote_write 上来的 `up{job="tengxunyun-ceshi-host"}` 2 个 target 均 up=1），但前端采集 Job 列表「实例采集状态」仍显示「在线 0 / 总数 2」（红）。
- **根因**：前端 [useJobScrapeStatus.ts](../../../ui-custom/web/src/pages/strategy/useJobScrapeStatus.ts) 复用 M02 `GET /api/v1/targets`（代理**中心 Prometheus `/api/v1/targets`**，见 [targets.ts](../../../ui-custom/web/src/api/targets.ts)），按 `target.health==='up'` 推导「采集中」。但这套数据源只对 **local 通道**（中心 Prometheus 直接 scrape target）成立；**边缘域（agent_pull）由边缘 vmagent 抓取，经 remote_write 只推送指标样本（`up`/`probe_success` 等），不向中心上报 target 元数据**，中心 Prometheus 自身 `activeTargets=0`（curl `127.0.0.1:9090/api/v1/targets` 已验证），导致 `targets.find` 永远匹配不到实例 → 全 `pending` → `online=0`。
- **影响**：边缘域所有 Job 实例采集状态误报为空/离线，与后端实际「已生效、已下发、样本已到」冲突；`pending` 数量未被列表列展示，症状收敛为「在线 0 / 总数 N」。
- **关键判据**：`up` 指标（remote_write 样本）是边缘域唯一能反映「某实例是否在采集」的中心侧信号，而 `/api/v1/targets` 的 `health` 字段对边缘域恒为「无此 target」。
- **待决策方向**（跨模块，需 orchestrator/prototype 拍板，本批先登记不改）：
  - **A（前端改查 `up` 指标）**：Job 实例状态由 `/api/v1/query?query=up{job="<job_name>",network_domain_id="<id>"}` 按 `resource_id/instance` 标签聚合推导 up/down/pending；`up` 缺样本段=未采集。改动小，但需处理「target down 时 vmagent 仍上报 up=0」与「未配置 target 无样本」的区分语义。
  - **B（agent 心跳上报 vmagent 本地 target 状态）**：edge agent 读取 vmagent 本地 `/api/v1/targets`（边缘 8429）→ 随心跳上报中心 → 中心落库边缘 target 状态，前端从边缘 target 状态接口读。语义完整（可区分 up/down/unknown），改动大，涉及心跳契约扩展。
- **来源**：跨主机联调（edge-agent-cross-host-e2e）数据面已通但前端「实例采集状态」仍 0/2；curl 验证中心 9090 `up` 有数据、`/api/v1/targets` activeTargets=0。

### F-10 定版（2026-09-21，chenrt 拍板 + 读 M02/M07 PRD 复核）：方向收敛为 **A 方案**，B 方案不适用于本题

> 读 [Module_02](../../../docs/02-product-requirements/Modules/Module_02_Query_Center.md) §118/§140/§124 与 [Module_07](../../../docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) §1088/§1325 后定版，纠正上文「A/B 待决策」的唯一性。

**PRD 权威边界（定版依据）**：

1. **被监控对象的采集健康度**（exporter up/down）归 **M02** 职责，权威数据源是 **`up` 指标 PromQL**（M02 §140 明确「采集健康度通过 PromQL 查询 `up` 等指标」；M07 §1088/§1325 明确 badge 数据 = M01 选中关系 + **M02 采集健康度/覆盖率 API（up 聚合，按 resource_id 回连）**）。消费方：M01 Job 实例采集状态回显 + M07 资源列表三态 badge。
2. **采集/接入节点自身健康度**（Edge Agent 在线/心跳/WAL 积压/配置同步）归 **M11** 职责（M02 §118 边界条款明文），靠**心跳上报**，已实现于 M09 前端 EdgeAgentsPage。
3. **实测佐证**：后端早已落地 A 方案的现成实现——`platform/query/coverage.go` `GET /api/v1/health/coverage` 用 `fetchUpAgg`（`queryInstantVector("up")`）按 `resource_id` 聚合三态 `collecting/pending_down/not_monitored`，对 remote_write 边缘域天然成立。

**定版结论**：

- **A 方案**（up 指标）＝被监控对象采集健康度＝本题唯一正解；且后端已有 coverage API 同源实现，M01 Job 回显应**收敛到 up 指标语义**（而非 `/api/v1/targets` 代理的 target health）。
- **B 方案不适用**：用「agent 上报 vmagent target 状态」去救「实例采集状态」是概念错位——那属于 M11 采集节点自身健康度（已走心跳实现），不是被监控对象健康度；扩心跳上报 target 元数据是张冠李戴、重复造轮子。
- **连带 PRD 修订**：决策 47 把 `/api/v1/targets` 代理定为「M01 Job 回显的数据源」的口径隐含「中心 Prometheus 亲自抓 target（local 通道）」前提，边缘域 remote_write 打破该前提；需在 M02 PRD 标注「`/api/v1/targets` 代理仅 local 通道有效，边缘域被监控对象采集健康度一律经 `up` 指标/coverage API 判定」。此项随 F-10 修复一并落 PRD 修订建议（目录隔离铁律：由 prototype-designer/chenrt 应用，本处仅登记）。

### F-10 修复完成（2026-09-21，前端数据源收敛为 up 指标）

> 按 A 方案实施，纯前端改造，未改心跳契约、未动后端。三处改动 + 单测全绿 + tsc/eslint 干净。

- **新增** `ui-custom/web/src/pages/strategy/upStatus.ts`：共享推导（F-10 权威实现）—— `upQueryForJob(jobName)` 构造 `up{job="<job_name>"}`；`statusFromUp(upItems, it)` 把 Job 的 up 样本向量映射到三态 `collecting/down/pending`（up=1→collecting、up=0→down、无样本→pending；实例↔序列匹配优先 `resource_id` 标签回连、回落 host 匹配）；`hostOf` 抽出复用。
- **改** `ui-custom/web/src/pages/strategy/useScrapeJobStatus.ts`（Job 抽屉实例状态）：数据源 `targetsApi.list({job})` → `queryApi.query({query: upQueryForJob(jobName)})`，按 up 值推导三态。江湖口径注释更新为 F-10。
- **改** `ui-custom/web/src/pages/strategy/useJobScrapeStatus.ts`（Job 列表『实例采集状态』聚合）：`targetsApi.list` → `queryApi.query`（`up{job}`），`aggregateView` 复用 `statusFromUp`。
- **测试**：重写 `useScrapeJobStatus.test.ts`、`useJobScrapeStatus.test.ts`，mock `queryApi`，覆盖—未下发不请求 / up=1→collecting / up=0→down / 无样本→pending / resource_id 缺失回落 host / query 失败降级待采集 / 自动刷新 tick。同步迁移消费方 `ScrapeJobListPage.test.tsx`、`ExporterInstallationPanel.test.tsx` 的 mock（targets→query）。`strategy` 目录全量 107 例通过。
- **校验**：`pnpm exec tsc --noEmit` 无错、`pnpm lint` 干净。
- **遗留（可选，未做）**：`/api/v1/targets` 代理仍被 M01 其他只读消费（如 target 列表/排障视图）使用，不受影响；M02 PRD「targets 仅 local 通道」标注建议已在上节登记，待 prototype-designer/chenrt 应用。

### F-11：M09「监控目标状态」页边缘域恒空 —— 需心跳上报 vmagent target 抓取详情（① 设计缺口，2026-09-21 chenrt 定版 B 方案，暂不开发）

- **现状**：M09「网域与节点管理」组下「监控目标状态」页（`/targets` 路由 → [TargetStatusPage.tsx](../../../ui-custom/web/src/pages/query/TargetStatusPage.tsx)）对边缘域恒显示「暂无采集目标」，即便数据面已打通（中心 9090 有边缘 remote_write 上来的 `up` 样本）。
- **根因**：该页消费 `targetsApi.list`（`/api/v1/targets`）→ 后端 [targets.go](../../../platform/query/targets.go) `TargetsHandler` 代理**中心 Prometheus `/api/v1/targets?state=active`**。边缘域由 vmagent 抓取、remote_write 只推 `up` 指标样本、**不向中心上报 target 元数据**，中心 Prometheus 自身 `/api/v1/targets` 对边缘 target 恒空（同 F-10 的 source of truth 门槛）。
- **与 F-10 的**本质差异（为何 up 指标救不了本页）：F-10「实例采集状态」只需 up/down/pending 三态，up 指标足够；而「监控目标状态」页是**全局排障入口**，7 列（Job / 实例 / 网域 / 状态 / **最后采集时间 lastScrape** / **最后错误 lastError** / **采集耗时 scrapeDuration**）中后三列是 Prometheus targets API 独有的抓取详情，**remote_write 样本与 `up` 指标都不携带**——up 指标只能补「采集状态」一列，掩盖不了「为什么离线」。
- **信息唯一栖息地**：边缘 target 的 health/lastScrape/lastError/scrapeDuration 只存在于**边缘 vmagent 本地** `http://127.0.0.1:8429/api/v1/targets`；中心反向拉取不可行（边缘 vmagent 仅监听 127.0.0.1，且中心→边缘网络经隧道不通，违背安全模型）。
- **决策（2026-09-21，chenrt 拍板）**：走 **B 方案——agent 心跳上报 vmagent target 抓取详情**，暂不开发，先登记待独立排期。
- **B 方案设计要点（待 PRD 落档后实施）**：
  1. **agent 侧**：心跳采集时读本地 vmagent `http://127.0.0.1:8429/api/v1/targets`（`state=active`），取每 target 的 `labels`（job/instance/network_domain_id/resource_id 等）、`health`、`lastScrape`、`lastError`、`scrapeDuration`，组装 target 快照随心跳上报。
  2. **契约扩展**：`edge` 侧 `HeartbeatRequest`（[heartbeat_service.go](../../../platform/edge/heartbeat_service.go)）与 agent `contract.HeartbeatRequest` 同步新增 `targets []EdgeTargetSnapshot`（或并入 collector Component 的 `targets` 字段）。
  3. **中心侧**：心跳落库边缘 target 快照（可复用 `edge_heartbeats` 或独立轻量表，带 `network_domain_id` + 心跳时间戳）；`TargetsHandler` 融合 `local Prometheus targets + 边缘上报 targets`（按 network_domain 归并、边缘 lastScrape/lastError/scrapeDuration 直取快照）。
  4. **前端**：`/targets` 页无需改数据结构，7 列自动生效；边缘 target 的 `health` 由 vmagent 直报（up/down/unknown 三态齐备，优于 up 指标）。
  5. **待定子项**：① 心跳体积（target 多时需分页/增量/压缩，MVP 先全量+上限截断并标注）；② local/边缘同 job 去重键（`network_domain_id + job + instance`）；③ 快照有效期（agent 离线后边缘 target 需过期降级，防脏数据常驻）；④ 与 F-10「up 指标回显」的取舍——「实例采集状态」继续用 up 指标（轻量），「监控目标状态」改用 target 快照（排障），二者语义与数据源并存、不冲突。
- **来源**：跨主机联调数据面已通但 M09「监控目标状态」页边缘域仍空；curl 验证中心 `/api/v1/targets` activeTargets=0、`up` 有 2 样本。

### F-11 定版子项 + 中心侧落库实施（2026-09-21，backend-developer F-11 批次）

> 上节 5 个「待定子项」落定口径（见 §②⑤），并落实第 3 条「中心侧心跳落库边缘 target 快照」。agent 侧上报已完成（edge-sync-agent contract + heartbeat 采集），本批只做中心侧 `edge_heartbeats` 独立轻量表持久化，**不改 `/api/v1/targets` 融合接口**（融合归下一阶段，与 F-10 并存口径见 §④）。

**子项落定**：
① **心跳体积/分页**——MVP 全量上报 + 中心侧上限截断：常量 `maxSnapshotsPerHeartbeat = 1000`，超出的 target 快照丢弃不入库（注释说明）；表结构扁平、不分区。v0.3 再按分页/增量压缩评估，防单心跳 JSON 过大。
② **去重键**——`(network_domain_id, job, instance)`：vmagent target 唯一标识为 `job`+`instance`，`resource_id` 是 prometheus.yml 注入标签、可能缺失，故不作去重键；建 `uniqueIndex:idx_etargets_uniq(network_domain_id, job, instance)` 作数据完整性兜底。
③ **快照有效期/清理**——采用 **clear-then-insert**：每轮心跳在单事务内 `Unscoped()` 硬删该 `edge_agent_id` 上轮全部快照，再批量插入本轮快照；row 级保留 `last_report_at`（中心接收时间）供后续融合阶段做「离线过期降级 health=unknown」判断。**targets 为空时不清库也不插库**（vmagent 拉取失败/未启动会上报空，误清会丢 „真实为空"与„获取失败"的分野），保留上轮快照。快照属高频瞬时状态，无审计价值，故硬删而非软删（软删会占用唯一索引导致重插冲突）。
④ **与 F-10 并存**——不冲突：F-10 前端「实例采集状态」走 `up` 指标（轻量）；F-11「监控目标状态」页（M09 排障）消费 target 快照的 lastScrape/lastError/scrapeDuration。二者语义与数据源并存。
⑤ **agent 维度**——表存 `edge_agent_id`（关联 `edge_agents.id`）冗余 agent 维度；当前模型一个网域一个 agent（`findOrRegisterAgent` 按 `network_domain_id` 唯一），故 `network_domain_id` 已能唯一定位，`edge_agent_id` 供审计/追溯留档。

**新增/修改（中心侧）**：
- 新增 `platform/models/edge_target_snapshot.go`：`models.EdgeTargetSnapshot`（表 `edge_target_snapshots`），字段对齐上报契约 snake_case（network_domain_id / edge_agent_id / job / instance / resource_id / health / last_scrape / last_error / scrape_duration_seconds / last_report_at）。
- 改 `platform/db/db.go`：`AutoMigrate` 注册 `EdgeTargetSnapshot`。
- 改 `platform/edge/heartbeat_service.go`：`Handle` 落库 `req.Targets`（调用新增 `persistEdgeTargetSnapshots`，clear-then-insert + 上限截断 + 空不落）；落库失败降级不阻断心跳（同 `writebackAgentPullDeployments` 解耦口径）。
- 改 `platform/edge/edge_test.go`：`newEdgeTestDB` 注册新表 + 新增落库用例（落库成功 / 二次心跳 upsert 覆盖 / 清理 / 空不落 / 独立性与降级）。

### F-12：blackbox 拨测 Job 无执行状态回显，前端恒显示「-」（① 设计缺口→随本批前端修复，2026-09-21）

- **现象**：前端新增 blackbox 拨测 Job（实测 `grafana` → `http://172.16.102.2:3000/login`，归属腾讯云调试边缘域 `mc-edge-debug`）后，采集 Job 列表「实例采集状态」列恒显示 `-`，Job 详情抽屉「拨测目标」只列目标地址、无成功/失败状态，用户误判后台未运行。
- **根因（三点）**：① 列表列对 `job_type === 'blackbox'` 硬编码 `return '-'`；② 详情抽屉 blackbox 分支只渲染 `blackbox_targets` 的 URL，未查询探测结果；③ 状态推导统一走 `up{job=...}`，而拨测结果的真值是 `probe_success`（`up` 仅代表「抓取 blackbox_exporter 本身是否成功」，不能表达拨测结果）。
- **后台实测（排除故障）**：中心 Prometheus 已有 `probe_success{job="grafana", instance="http://172.16.102.2:3000/login", network_domain_id="mc-edge-debug"}=1`、`up{job="grafana"}=1`；DB 中该 Job `change_status=deployed`。链路（拉包 → blackbox_exporter → vmagent → remote_write）全程正常。
- **修复（本批前端）**：
  1. `upStatus.ts` 新增 `probeQueryForJob(jobName)`（构造 `probe_success{job="<job_name>"}`）与 `probeStatusOfTarget(probeItems, target)`（按 `instance` 匹配拨测目标，`url` 优先、回落 `target`；1→通过 / 0→失败 / 无样本→待拨测）。
  2. `useJobScrapeStatus.ts` 新增 blackbox 分支：按 `blackbox_targets` + `probe_success` 聚合，`online` 语义 = 拨测通过数；未下发时不查指标。
  3. `ScrapeJobListPage.tsx`「实例采集状态」列对拨测 Job 渲染「通过 x / 总数 y」（红/绿配色同标准 Job），列头 `COLLECTION_STATUS_TOOLTIP` 补充拨测口径。
  4. `ScrapeJobDetailDrawer.tsx` 拨测 Job 改查 `probe_success`，顶部汇总「通过 X / 总数 Y · 待拨测 Z · 失败 W」+ 每目标状态 Tag（通过 / 待拨测 / 失败）+ 手动与 20s 自动刷新；未下发时不查指标、统一「待拨测」。
- **验收**：`pnpm vitest run`（4 个相关文件）34 用例全绿，含新增拨测聚合、详情回显、未下发不查询等 4 例；`eslint` 0 告警；`tsc --noEmit` 通过。
- **与 F-10/F-11 的关系**：F-10 收敛标准 Job 的实例状态到 `up` 指标；F-11（待独立排期）解决 M09「监控目标状态」页的边缘 target 抓取详情；本项补齐拨测 Job 的 `probe_success` 口径，三者数据源互补、语义不冲突。

### F-13：M09「监控目标状态」页剥离 blackbox 拨测 target（① 设计缺口→方案 A，2026-09-22 chenrt 拍板 + 随本批后端实现）

- **现象**：F-11 融合后，边缘 blackbox 拨测 target 也会被 vmagent 上报进 `/api/v1/targets`，在 M09「监控目标状态」页被 `health` 直接标为「在线/离线」，造成语义误导——blackbox target 的 `health` 只表达「抓取 blackbox_exporter 动作是否成功」，**≠ 目标可用性**（目标 404/超时但 exporter 正常 → 误显「在线」；exporter 挂 → 误显「离线」）。
- **分析（chenrt + 主线程 2026-09-22）**：采集任务存在两个正交维度——`job_type`（standard / blackbox）与 `resource_category`（host / database / middleware / application / generic_target）。application 走 standard 拉模型，与 host/db/mw 完全同构，target 元数据（lastScrape/lastError/scrapeDuration）齐全，**应正常显示在 M09**；仅 blackbox 拨测在 M09 存在语义错位，其真实结果已由 M01 实例采集状态（`probe_success`，F-12）与 F-13 首页拨测态势正确承载。
- **定版方案 A（最小改动）**：`/api/v1/targets` 融合边缘快照时**过滤 `job_type=blackbox` 的 job**，M09 页定位收敛为「standard（含 application）拉模型抓取的排障入口」。
- **实现（本批后端，commit 54dee4f）**：
  1. 前置核实：配置生成器不改写 job 名（`platform/configcenter/generator/render.go` 的 `jobScrapeConfig` 原样透传 `JobName`）→ 黑名单可按 `ScrapeJob.JobName` 精确匹配。
  2. `platform/query/targets.go` 新增 `fetchBlackboxJobNames`（`WHERE job_type='blackbox'` Pluck job_name）；融合边缘快照循环中精确命中黑名单即跳过；仅存在快照时才查询（纯 local 路径零额外 DB 开销）。
  3. 仅过滤边缘快照；local 侧 blackbox target 仍透传上游原始值（本方案边界，后续展示策略另议）。
- **验收**：`platform/query/targets_test.go` 新增 6 例（blackbox 排除 / standard 保留 / 混合 / 无 blackbox 全保留 / 精确匹配大小写边界 / 仅过滤边缘不碰 local）；`go test ./platform/...` 28 包全绿、vet/build 通过；真实环境注入 blackbox+standard 快照 curl 验证过滤生效，测试数据已清理。
- **与 F-12 的关系**：F-12 补齐拨测结果的 M01 回显（`probe_success`）；本项将拨测 target 从 M09 排障入口剥离，二者互补，避免拨测结果双口径。

### F-14：central 告警规则引用边缘域 job 被 M09 jobref 门禁误阻断（① 设计缺口→实现前待决策，2026-09-22）

- **现象**：在默认网域（default，local 通道）新增 `scope=central` 告警规则，expr 引用**边缘域**（mc-edge-debug）已部署采集 Job `tengxunyun-ceshi-host`，M09 配置下发校验返回**校验失败**：「规则 job 引用错误：`tengxunyun-ceshi-host` 不存在」，2 条存活类规则（expr 含 `up`）被判 error 级阻断，无法确认发布。
- **根因（实现层，已核实代码）**：M09 发布期 jobref 门禁（[validate.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L164-L165) 决策 66）的生效 Job 集合 = `scrapeConfigJobNames(ca.PrometheusYML)`，即**当前变更单所在网域**的 prometheus.yml `scrape_configs[].job_name`。default 域产物只含 `ceshi`（job_name 全局唯一、`scrape_jobs.job_name` 唯一索引），不含边缘域 job → `tengxunyun-ceshi-host` 判「不存在」→ 存活类 → error 阻断。
- **设计缺口（本质）**：**中心求值器的全局语义 vs jobref 校验的按域集合语义，二者未协调**。
  - 决策 68-2/68-3 既定：规则 `scope=central`（[回调注释](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/deployment/callback.go#L30) 明确「规则为全局 scope=central、无网域列」）由**中心求值器**（`centerEvaluator := dom.Channel == local`，[draft/service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/draft/service.go#L220)）求值；中心 Prometheus 的 TSDB **包含所有网域 remote_write 上来的数据**（实测 `up{job="tengxunyun-ceshi-host", network_domain_id="mc-edge-debug"}` 已在中心）。→ central 规则**语义上应能引用任意网域的 job**。
  - 但 jobref 门禁（决策 66）的校验基准是「草稿所在域的产物 job 集合」，而非「全平台生效 job」。→ 跨域引用的 central 规则被误判 error。
  - 两者的冲突点：`jobref.Issue` 已预留 `NetworkDomainID/NetworkDomainName` 字段（[jobref.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/strategy/rule/jobref/jobref.go#L45-L48) 决策 67-4 注释「MVP 单域下恒为空」），说明团队已预见多域，但校验生效集合仍用单域。
- **死结（阻断当前验证的关键）**：若把规则变更单改挂边缘域（mc-edge-debug，agent_pull 通道）草稿 → jobref 会通过（该域产物含 `tengxunyun-ceshi-host`），但**边缘通道 `centerEvaluator=false`，不生成 rule_files/alerting**（决策 68-2），中心不会加载该规则 → 告警不生效。即「挂 default 域被误判阻断、挂边缘域规则不生效」，跨域 central 规则当前**无合法发布路径**。
- **需决策的问题（实现前，② 类语义矛盾，暂不改码）**：
  1. **central 规则的 jobref 生效集合，应改为「全平台全量 deployed job 并集」还是维持「草稿所在域 job 集合」？** 这是核心——决定了 central 规则能否跨域引用，以及与「中心求值器全局语义」是否自洽。
  2. **central 规则的变更单网域归属**：是否固定挂 default（local 中心求值器）域发布？若固定，则 jobref 基准必须配合改为全平台并集，否则跨域规则永远被阻断。
  3. **边缘域草稿是否还应携带 RulesYML**：当前每条规则进所有域产物（含边缘），但边缘无 rule_files 引用、无求值器，属于死文件；是否在 Assemble 层对边缘域直接置空 RulesYML（消除冗余 + 避免边缘域草稿误通过 jobref）。
- **解决方案分析**：
  - **方案 A（推荐，语义自洽）**：将 M09 发布期 jobref 的生效集合从「解析本草稿 prometheus.yml」改为「按全平台查询 deployed `scrape_jobs.job_name` 并集」（跨域，含所有 local + edge 域已部署 job）。central 规则本就由全局中心求值器求值，引用任意已部署 job 均合法；存活类 error 判定保持（引用**全平台都不存在**的 job 仍阻断）。改动点：`validate.go` 的 `scrapeConfigJobNames` 改由 `db` 查询（需把 `db` 传入校验链）；jobref.go 本身不改（本域集合已由调用方给定）。副作用：非存活类规则跨域引用 warning 也会相应消失，符合语义。
  - **方案 B（保守，改契约约束）**：维持按域校验，但文档 + 前端约束「central 规则仅能引用 default 域 job」，跨域引用一律按 error 处理。与「中心全局求值」的既定架构语义相悖，且边缘 job 无法被 central 规则告警，不推荐。
  - **方案 C（过度设计，暂不做）**：给规则增加「求值作用域」维度（central-global / central-per-domain），区分「全局数据求值」与「本域数据求值」两种 central 规则。当前无此需求，仅记录。
- **当前验证 workaround（不改码、可先跑通链路）**：临时把验证规则的 `job` 换成 default 域已有 job（如 `ceshi`），或把规则 expr 改用**不带 job 选择器**的全局表达式（如 `up{network_domain_id="mc-edge-debug"} == 0`，仅按域标签过滤、不引用具体 job，可绕开 jobref 的 job= matcher 判定），先验证「规则加载 → 中心求值 → 告警 → Alertmanager」链路，再回头决策方案 A/B 落地跨域引用。
- **来源**：真实边缘联调验证 → 前端下发配置报错 → 代码核实（validate.go / jobref.go / render.go / draft service.go / callback.go）。
- **处置（2026-09-23 已定版并实现）**：经设计提案 `cross-domain-central-rule-jobref-validation.md`（Track B）评审定版两个互补改动，commit `b708693`（feat(module-09)）：
  - **改动 Y**：`ValidateArtifacts` 的 jobref 输入集从「解析本域产物 prometheus.yml」切换为 `rule.EffectiveJobNames(db, ScopeTypeCentral, "")`（central 全域并集 = 全库 enabled+ready job）；删除 `scrapeConfigJobNames`。跨域引用边缘域已部署 job 不再误判 error。
  - **改动 X**：`buildArtifacts` 对非 centerEvaluator 域（边缘）`rules = nil`——清掉边缘域 rules.yml 死文件，规则变更不再触发边缘域变更单；含 v0.4 edge scope 落地时反向恢复的注释预留。
  - 配套：新增导出 `EffectiveJobNames`；generator/draft 层单测补齐（跨域通过 / 全局不存在 error / 非存活 warning / 边缘域无 rules）；3 个既有测试适配改动 X 行为。
  - 验证：`go test ./platform/...` 28 包全绿、vet/build 干净、服务启动三接口 200。执行记录见 `docs/05-execution-records/module-11/backend-developer.md`。
- **PRD 回写修订建议（2026-09-23，供设计侧合入 M09 PRD，版本号 +1）**：修订建议文本如下，按定位章节插入，Change Log 追加「吸收 design-proposal cross-domain-central-rule-jobref-validation.md（track B）」。内容与已实现代码（commit `b708693` + 既有决策 60/68-2/68-3）完全一致。
  - **① §3.3 新增小节 3.3.4「规则与告警配置的域归属（中心集中告警链路）」**：central 规则与 AM 告警收敛配置均属中心集中链路，只随中心管理域（default/local）下发，不进入采集节点域（边缘/agent_pull）。边缘域产物仅含 prometheus.yml（scrape_configs + file_sd）、targets/*.json、metadata.json，不含 rules.yml / alertmanager.yml / rule_files / alerting 段（决策 68-2/68-3 + 60）。边缘数据 remote_write 上中心后统一由中心求值、中心 AM 收敛分发。
  - **② §3.4 新增「规则 job 引用校验口径（0.2 多域）」**：central 规则生效 Job 集合 = 全平台已部署 job 并集（enabled+ready，跨 local/edge 域），与变更单所在域无关；跨域引用合法；引用全平台不存在 job 仍 error（存活类）/warning（非存活类）判定。
  - **③ §6.5 新增「规则变更的变更单网域归属」**：central 规则变更只触发 default 域变更单，不触发任何边缘域变更单；边缘域变更单仅反映该域自身采集 Job/target 变化。
  - **④ §9.2 技术验收新增**：跨域引用规则校验 passed 可下发（部署 success）；边缘产物纯净（无 rules/AM/alerting）；规则变更单收敛（仅 default 域）。
  - **⑤ Change Log**：吸收 design-proposal cross-domain-central-rule-jobref-validation.md（track B，2026-09-23）。

### F-15：M09「采集节点离线但采集器/拨测器仍显示运行中」——agent 主进程强杀后子进程成孤儿 + 中心侧组件状态无过期降级（① 设计缺口→待决策，2026-09-24）

- **现象**：采集节点状态页某节点「状态/离线、配置同步/未同步、最后心跳/1 天前」，但同行的「采集器」「拨测器」列仍显示「运行中」。
- **排查定性**（chenrt 确认为进程问题）：edge-sync-agent 主进程被强杀，其守护的 vmagent / blackbox_exporter 子进程成为孤儿进程继续运行。
- **两层缺陷（根因 + 症状，二者需分别修）**：
  1. **进程层（根因）**：[probe.go `ProcProbe.Start`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/cmd/edge-sync-agent/probe.go#L145-L166) 用 `exec.Command + cmd.Start()` 拉起子进程，**未设置 `SysProcAttr.Pdeathsig`（父死子亡信号），也未 Setsid/Setpgid**。main 被 SIGKILL 时 `defer StopAll()`（[probe.go L231-L242](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/cmd/edge-sync-agent/probe.go#L231-L242)）不触发，子进程被 re-parent 到 init/systemd 继续运行。仅优雅退出（Stop→`cmd.Process.Kill()`）才会停子进程。
  2. **显示层（症状）**：[management_service.go `agentView`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_service.go#L73-L123) 直接透传 DB 里 `CollectorStatus`/`Components` 的历史心跳值，**心跳过期不做降级**，故「运行中」是最后心跳时刻的过期快照（对比 F-11 边缘 target 快照有 `last_report_at` 过期降级，agent 组件列没有）；[agentViewStatus](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_service.go#L125-L139) 只把节点档判 offline，不联动降级组件列。
- **A 方案评估（chenrt 已同意方向，但为治标，需补根因层）**：
  - A 方案（中心侧心跳过期时把 `CollectorStatus`/`Components` 组件状态降级为 `unknown`）**合理但只治标**——解决「离线却运行中」的认知冲突，但**不杀死孤儿进程**，孤儿 vmagent 仍在采集（反而可能掩盖问题）、持续占用资源。
  - **优化结论：需两层修复并存**：
    1. 根因：`ProcProbe.Start` 设置 `cmd.SysProcAttr.Pdeathsig = syscall.SIGKILL`（Linux 父死子亡；需跨平台条件编译或运行时判断，macOS/Windows 不支持 Pdeathsig 时回落依赖 systemd `KillMode=control-group` 兜底）。
    2. 显示：`agentView` 心跳超时（复用离线心跳超时口径，勿另起常量）时覆写组件状态为 `unknown`，**展示层降级、不改 DB 原始上报**（agent 恢复心跳后自然回真实值）；同步补心跳过期组件降级单测（现有 [management_test.go L236-259](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_test.go#L236-L259) 仅覆盖节点档 offline，缺组件降级分支）。
- **处置（2026-09-24 已实现，commit `a039125`，两层并存修复）**：
  - **进程层（根因）**：新增 `configureSysProcAttr`——[pdeathsig_linux.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/cmd/edge-sync-agent/pdeathsig_linux.go)（`//go:build linux`，落 `SysProcAttr.Pdeathsig=SIGKILL`）与 [pdeathsig_other.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/cmd/edge-sync-agent/pdeathsig_other.go)（`//go:build !linux`，no-op）按 build tag 拆分；[probe.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/cmd/edge-sync-agent/probe.go) `ProcProbe.Start` 在 `cmd.Start()` 前调用。非 Linux（macOS/Windows 无该字段）回落依赖 systemd `KillMode=control-group` 由 cgroup 兜底。
  - **显示层（症状）**：[management_service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_service.go) `agentView` 复用 `agentLiveStatus` + 传入的 `DefaultOfflineThreshold`（复用离线阈值，不新造常量）判活；心跳过期时把展示用 `CollectorStatus` 与 `Components[].status` 覆写为 `unknown`（`degradeComponentsToUnknown` 返回副本，`componentStatusUnknown` 为展示层派生值，不落库、不属于上报契约枚举），只改展示、不改 DB 原始上报，agent 恢复心跳后自然回真实值。
  - **测试**：`pdeathsig_linux_test.go`（断言 `Pdeathsig=SIGKILL`）、`pdeathsig_other_test.go`（断言 no-op）；`management_test.go` 新增「心跳过期组件降级 unknown 且 DB 原始值不变」「心跳新鲜不降级」两例，补上既有测试缺失的组件降级分支。
  - **验证**：`go test ./platform/...` 全绿、`platform/edge-sync-agent` 模块 `go test ./...` 全绿、`GOOS=linux(amd64/arm64)/windows` 交叉编译通过、`go vet` 通过、服务启动三接口 200。执行记录见 `docs/05-execution-records/module-11/backend-developer.md`。
- **PRD 回写修订建议（2026-09-24，供 design 条线合入 M11 PRD）**：① **边缘采集节点进程守护机制要求**明确为「主进程终止（含被强杀）时，其守护的子进程（vmagent / blackbox_exporter）必须随之终止」——Linux 落 `Pdeathsig`，容器 / systemd 环境以 cgroup `KillMode=control-group` 兜底；② **节点档与组件列状态一致性口径**：心跳超过离线阈值时，节点档置「离线」，采集器 / 拨测器等组件状态**统一降级展示为「未知」**，不沿用最后一次心跳的快照值。
- **遗留（非 backend 职责）**：systemd unit 侧 `KillMode=control-group` 兜底属 packaging 条线，单元文件当前未含该项，需在打包批次一并补入。

### F-16：「配置同步」列确认下发后仍显示「已同步」——需「同步中」中间态（① 设计缺口→chenrt 拍板方案 A，2026-09-24）

- **现象**：确认配置文件下发后，「采集节点状态」页「配置同步」列仍显示「已同步」，而「下发记录」侧显示「待执行」。直到 agent 下次心跳（≤30s）拉到配置应用后，该列才翻转为「已同步」。
- **根因（确认下发动作没触发状态翻转）**：`config_sync_status` 唯一更新点是 agent 心跳（[heartbeat_service.go L122-139](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L122-L139)：上报版本与中心最新比对 → 不一致写 `out_of_sync`+cause=pull_pending，一致写 `in_sync`）；而「确认下发」[dispatchVersion L152-163](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/deployment/service.go#L152-L163) 对 agent_pull 域**仅登记 pending 占位 + 回写 change_status，完全不动 `ConfigSyncStatus`**。故确认后、心跳前的窗口内该字段仍是上轮 `in_sync`。
- **关键发现**：「同步中」语义已内建但未单独展示——`out_of_sync` 的成因 `pull_pending`（[edgeConstants.ts L58-73](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/edgeConstants.ts#L58-L73)）文案即「新配置包已就绪，等待 Agent 下次心跳拉取（准实时 30s）」，前端却一律把 `out_of_sync` 显示成「未同步」，未把 `pull_pending` 单列。
- **方案 A 定版（chenrt 拍板，复用已有 pull_pending 语义，不新增枚举）**：
  1. 后端：[dispatchVersion](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/deployment/service.go#L129-L163) agent_pull 分支登记占位后，批量 `Update` 该网域 agents：`ConfigSyncStatus=out_of_sync` + `out_of_sync_cause=pull_pending`（0 行更新也无害）。
  2. 前端：「配置同步」列对 `out_of_sync`+cause=`pull_pending` 展示为「同步中」（badge 色区分，如蓝色/processing），其余 `out_of_sync` 仍「未同步」。
  3. 心跳兜底天然成立：agent 拉到配置上报版本一致后，[heartbeat_service.go L122-139](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L122-L139) 已写回 `in_sync`，无需额外逻辑。
- **影响面**：后端 1 处（agent_pull 分支 Update）+ 前端 2 处（badge 文案/颜色）。`ConfigSyncStatus` 五档枚举（in_sync/out_of_sync/unknown/manual_override/no_version）不变，`pull_pending` cause 已是 `out_of_sync` 的成因枚举之一。
- **处置（2026-09-24 已实现，commit `c03492b` 后端 + `4d7ae09` 前端）**：
  - **后端**：[dispatchVersion](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/deployment/service.go#L152-L174) agent_pull 分支登记 pending 占位后新增 `markAgentsPullPending(db, version.NetworkDomainID)`——批量 Update 该网域全部 `EdgeAgent` 为 `config_sync_status=out_of_sync` + `out_of_sync_cause=pull_pending`（0 行更新无害，网域尚无 agent 时无副作用）；失败仅记录 `error_message`，不整链 500（降级口径同 `writebackChangeStatuses`）。心跳拉到配置后由 `heartbeat_service` 写回 `in_sync` 兜底，无需额外逻辑。
  - **前端**：[edgeConstants.ts](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/edgeConstants.ts) 新增 cause 感知映射 `isConfigSyncInProgress` / `configSyncDisplayLabel` / `configSyncDisplayBadgeStatus`——`out_of_sync` + cause=`pull_pending` → 「同步中」+ `processing`（蓝），其余 `out_of_sync`（`pending_draft` / `local_reset` / 空）仍「未同步」+ `error`（红）；[EdgeAgentsPage.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/EdgeAgentsPage.tsx)「配置同步」列与 [EdgeAgentDrawer.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/EdgeAgentDrawer.tsx) 详情字段改用同一映射（单一映射源）。原 `configSyncStatusLabel/BadgeStatus` 两表保留，供筛选下拉与状态枚举展示使用。
  - **测试**：后端 `deployment_test.go` 补「agent_pull 确认下发 → agent 变 out_of_sync/pull_pending」与「local 通道不受影响」；前端 `edgeConstants.test.ts` 补映射矩阵（含 `isConfigSyncInProgress` 命中/不命中）、`EdgeAgentsPage.test.tsx` 补 `pull_pending`→同步中（badge `processing` 断言）+ `pending_draft`→未同步反例、`EdgeAgentDrawer.test.tsx` 补抽屉同步中。
  - **验证**：`go test ./platform/...` 全绿、`go vet` 通过；前端 `pnpm vitest run src/pages/config-center/nodes/` 3 文件 24 用例全绿。
- **PRD 回写修订建议（2026-09-24，供 design 条线合入 M11 PRD）**：「配置同步」列需定义**「同步中」中间态展示口径**——确认下发成功后、Agent 下次心跳拉包生效前，该列展示「同步中」（蓝色 processing）；Agent 上报配置版本与中心最新已确认版本一致后翻转为「已同步」。该中间态复用 `out_of_sync` 的 `pull_pending` 成因，`ConfigSyncStatus` 五档枚举（in_sync / out_of_sync / unknown / manual_override / no_version）不新增。前端建议同步在 `api-contract-snapshot.md` §1 补该展示口径文本。
- **遗留（待设计侧确认）**：筛选下拉「配置同步」选项文案目前仍是状态枚举口径「未同步」，与列展示口径（`pull_pending`→「同步中」）未对齐；是否需在筛选项拆分/改名，待设计侧定版。

### F-17：节点「配置同步」永久停留「同步中」——Agent 配置**应用失败**原因不可观测（① 设计缺口 + ② 实现缺口，2026-09-24 落档，2026-09-25 订正为已实现）

- **现象**：边缘域采集节点「配置同步」列长期显示**「同步中」**（F-16 中间态），长时间不回落到「已同步」；同时中心侧主机采集 / 拨测采集**在线数全为 0**（`count(up)` 空、activeTargets=0），而节点在线、边缘本地抓取正常（`edge_target_snapshots` 29/32 up）。
- **根因链（已实测证实，完整链条与本条归属）**：源数据 application 资源 `33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43`（service_name=test1）**健康检查地址为空** → 中心生成器静默产出 `targets/test-app-01.json = []`（**归属 M09，见 `module-09/dev-feedback.md` F-31**）→ Agent [ValidateTargetsJSON](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/extract.go#L83-L85) 对空数组报 `empty array` → `Deployer.Apply` **失败并回滚**（保留上一份可运行配置）→ Agent 持续上报旧版本 v31 → 中心 [heartbeat_service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L134-L152) 判 `out_of_sync` + `pull_pending` → 前端「同步中」**永不自愈**；v31 的 vmagent 仍指向旧 remote_write 地址 → 中心无 up 样本 → 在线数 0。
- **本条（M11）负责的缺陷**：心跳契约 [`HeartbeatRequest`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/contract/contract.go#L49-L66) 当时**无任何「配置应用结果」字段**（2026-09-25 已补，见下方处置 D-1）——`Deployer.Apply` 失败只写本地日志（`journalctl -u edge-sync-agent`），中心**无从得知**；`config_sync_status` 只能在「版本不一致→pull_pending」与「版本一致→in_sync」间跳转，**没有第三种落点**，于是「已拉包但应用失败」被永久表述为「等待拉取」。
- **定性**：**属可观测性缺失，不是前端引导文案错误**（F-16 的「同步中」文案在其自身语义下正确；错在缺少让状态机走出该中间态的失败信号）。边缘拒收空数组（不做「方案 B 放宽校验」）是**正确防御**，不放宽。
- **方案（详见设计提案）**：C（M09 治本阻断空 targets 产出，缺陷配置到不了边缘）+ D（M11 可观测兜底：Agent 上报 `config_apply_error` / 失败版本 → 中心新增成因 `apply_failed` 并落库 → 节点状态页展示「同步失败」+ 具体原因 + 「查看下发」引导）。
- **落档（2026-09-24）**：`docs/05-execution-records/module-11/design-proposals/config-sync-stall-and-empty-targets-guard.md`（C / D 已按提案原设计实施；提案头部状态已于 2026-09-25 订正为 `approved`，**仅 §6 的 PRD / 契约回写待设计条线**）。
- **处置（2026-09-25 订正：已实现，原「待确认后实施」已过期）**：按提案 C → D-1 → D-2 → D-3 顺序落地（单 feat 分支）；§7 决策 3 采纳提案建议，用**新增专用字段**而非复用语义过泛的 `LastError`。
  - **C（M09 治本，本条只登记归属）**：[`ValidateTargetGroups`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L40-L43) 零组即判非法、[`ResolveJobTargets`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L178-L217) 新增 `SkippedInstance` 跳过归因（`resource_not_found` / `address_empty` / `offline`）——缺陷配置到不了边缘；明细见 `module-09/dev-feedback.md` **F-31**。
  - **D-1（Agent）**：[contract.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/contract/contract.go#L61-L65) 心跳新增可选 `config_apply_error` / `config_apply_failed_version`（`omitempty`，应用成功不产出键，向后兼容）；[deployer.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/deployer.go#L36-L48) 新增 `ApplyState`，[记录失败](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/deployer.go#L224-L245) / [成功清空](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/deployer.go#L247-L259) / [启动恢复](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/deployer.go#L261-L283) 三段式落盘（`config-<id>/current/apply-state.json`，尚无生效版本时回落网域目录），崩溃 / 重启不丢诊断；[heartbeat.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/cmd/edge-sync-agent/heartbeat.go#L29-L44) 心跳请求由 `Deployer.ApplyState()` 填充。
  - **D-2（中心）**：`models.OutOfSyncCauseApplyFailed` 新增成因 [`apply_failed`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/models/config_center_rules.go#L72-L75)；[heartbeat_service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L128-L152) 三态判定——版本一致 → `in_sync` + 清空成因与应用错误文本；失败版本 == 最新 → `out_of_sync` + `apply_failed`；其余 → `pull_pending`（失败版本 ≠ 最新时不被陈旧错误覆盖真因）；`config_apply_error` / `config_apply_failed_version` 镜像落库，成功即清空。
  - **D-3（前端）**：[edgeConstants.ts](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/edgeConstants.ts#L74-L113) 新增 `isConfigSyncApplyFailed` → 「同步失败」+ badge `error` 红（与「同步中」processing 蓝、「未同步」error 红在成因上区分），补 `outOfSyncCauseHint` / `outOfSyncCauseAction.apply_failed`（「查看下发」→ `/deployments`），`isConfigSyncInProgress` **保持只认 `pull_pending`**（不把失败误判为进行中）；`types/edge.ts` 补 `apply_failed`；[EdgeAgentsPage.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/EdgeAgentsPage.tsx#L143-L184) 配置同步列在有 `config_apply_error` 时以 Tooltip 露出错误摘要；[EdgeAgentDrawer.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/EdgeAgentDrawer.tsx#L205-L228) 新增「配置应用」行（原因全文 + 失败版本 + 「查看下发」），`apply_failed` 时不再重复渲染通用「同步引导」行。
- **验证（2026-09-25 复核）**：`go test ./platform/...` 全绿（含 `TestHeartbeatApplyFailedCause`、`TestHeartbeatApplyFailedOlderVersionStaysPullPending`）；`platform/edge-sync-agent` 模块 `go test ./...` 全绿（含 apply-state 记录 / 落盘 / Restore 读回 / 成功清空）；前端 `pnpm vitest run src/pages/config-center/nodes/` 全绿（含「同步失败」映射与抽屉「配置应用」行）。
- **PRD 回写修订建议（供 design 条线合入 M11 PRD；实施已完成，仅余回写）**：① 心跳契约（§6.2）新增「配置应用结果」可选字段；② `OutOfSyncCause` 增 `apply_failed` 一档，并明确「同步中」中间态**仅** `pull_pending` 命中（与 F-16 修订合并回写）；③ 节点状态页「配置同步」需能展示应用失败原因与失败版本。
- **同类隐患（登记，不在本条修）**：中心 `HeartbeatRequest.RemoteWriteLastError`（`remote_write_last_error`）在 Agent 侧契约**未定义、从不发送**，该字段恒空——契约单向定义问题，建议独立小项处理。

### F-18：T11-08 离线包清单为硬编码占位，未接真实构建产物（② 实现偏差修正，2026-09-24，已修复）

- **发现场景**：用户实测点「下载安装包」（M11 节点状态页离线包入口），发现清单/下载的不是真实构建产物。
- **原现状**：`platform/edge/packages_service.go` 用硬编码 `packageRegistry`（v0.1.0 / v0.2.0），组件二进制是 `metriccenter-component-placeholder:<name>:<version>` 假字符串，`ListPackages()` 在内存现拼几百字节小 zip 返回；**完全不读磁盘上的真实构建产物**（`dist/edge-package/release_meta.json` + 64MB tar.gz）。产物形态也与交付不一致（zip vs tar.gz）。
- **处置（已实现）**：后端改读 `dist/edge-package/release_meta.json`（单版本清单，`file` 字段定位 tarball），`ListPackages/LatestPackage/FindPackage` 全部接受包目录参数；下载端点改**流式下发真实 tar.gz**（`http.ServeContent` + 文件句柄，`Content-Type: application/gzip`、`Content-Disposition` 用真实文件名、`ETag`/`X-Checksum-Sha256` 取清单 sha256、`Content-Length` 取清单 size），删除全部占位 zip 逻辑；未打包时清单返回空数组 + 200（前端空态）。打包脚本 `scripts/package-edge-agent.sh` 的 `release_meta.json` 补 `file` 字段；契约 `api-contract-snapshot.md` §2 同步为 tar.gz 口径。
- **影响模块**：后端（`platform/edge/` 清单与下载 + `cmd/metric-center` 新增 `--edge-packages.dir` / `EDGE_PACKAGE_DIR`）、打包脚本、前端（T11-22 消费 `file` 字段）。

### F-19：包内文档与代码不一致 + 两份 README 各自漂移（② 实现偏差修正，2026-09-24，已修复）

- **发现场景**：用户复盘离线包交付（承接 F-18），问「当前 edge agent 边缘采集节点包使用的端口有哪些，需修改默认的 vm/blackbox 端口」，核对包内 README 与源码发现多处不一致。
- **原现状**：打包脚本 `scripts/package-edge-agent.sh` 用 heredoc **再生成一份包内 README**，与 `platform/edge-sync-agent/packaging/README.md` 是两份会各自漂移的文档。包内 README 存在 4 处与代码不一致：
  1. `EDGE_COLLECTOR_ADDR` 完全缺失（代码默认 `127.0.0.1:8429`，`cmd/edge-sync-agent/probe.go`）；
  2. `EDGE_PROM_HEALTH_URL` 误写默认 `http://127.0.0.1:9090/-/healthy`（实际 `http://127.0.0.1:8429/health`）；
  3. `EDGE_PROM_RELOAD_URL` 列入文档但**代码未接线**（仅 `probe_test.go` 出现，生产不读）；
  4. `EDGE_BLACKBOX_ADDR` 写 `:9115` 未限回环（实际默认 `127.0.0.1:9115`）。
- **处置（已实现，用户三项裁决：只文档化默认值不动 / 两份 README 合一 / 打包清理旧产物）**：
  - **文档单一来源**：`scripts/package-edge-agent.sh` 删除 heredoc README 与旧 sed 块，改为 `cp` 仓库内唯一权威 `platform/edge-sync-agent/packaging/README.md`，并对 README 与 `edge-sync-agent.service` **统一做 `__VERSION__` 占位符 sed 注入**（脚本头部注释 + 打包前自检「无 `__VERSION__` 残留」兜底）。
  - **unit 修正**：`EDGE_AGENT_VERSION=v0.2.0` 写死 → `__VERSION__` 注入；`EDGE_COLLECTOR_BIN=prometheus`（决策 88 已统一 vmagent）→ `vmagent`；新增三个端口变量注释行（`EDGE_COLLECTOR_ADDR` / `EDGE_PROM_HEALTH_URL` / `EDGE_BLACKBOX_ADDR`），含「改 ADDR 必须同步改健康 URL」警示。
  - **权威 README 修正**：可选变量表补 `EDGE_COLLECTOR_ADDR=127.0.0.1:8429`、修正 `EDGE_PROM_HEALTH_URL`、删除未接线的 `EDGE_PROM_RELOAD_URL` 行、修正 `EDGE_BLACKBOX_ADDR=127.0.0.1:9115`；**新增「端口与网络策略」章节**：本机监听表（vmagent 8429 / blackbox 9115 / agent 不监听 outbound-only）+ 需打通的出站表（→ `CENTER_ENDPOINT` 中心 `:8080` 心跳拉包、→ remote_write 中心 `:9090`、→ 被采集目标端口如 `:9100`）+ 自定义端口示例（`EDGE_COLLECTOR_ADDR=127.0.0.1:18429` + 同步覆盖健康 URL 警示）。
  - **产物清理**：打包脚本新增「只保留最新一份」——清历史 `edge-sync-agent-*.tar.gz` 与历史解压目录（放在二进制检查之后，避免检查失败反而清掉上一份可用产物）。
- **影响模块**：`scripts/package-edge-agent.sh`、`platform/edge-sync-agent/packaging/{README.md,edge-sync-agent.service}`。
- **验证**：重跑打包脚本——包内 README/unit 无 `__VERSION__` 残留、版本号正确注入、旧产物仅剩最新一份、release_meta.json 单版本。
- **答复用户（端口事实）**：采集节点**默认仅绑回环**（8429/9115 不占对外端口，无需网络策略放通）；用户可用环境变量自定义端口（`EDGE_COLLECTOR_ADDR` / `EDGE_PROM_HEALTH_URL` / `EDGE_BLACKBOX_ADDR`，改 vmagent 端口必须同步改健康 URL）；默认需打通的**出站**为：采集节点 → 中心 `:8080`（`CENTER_ENDPOINT` 心跳/拉包）+ 采集节点 → 中心 Prometheus `:9090`（remote write）+ 采集节点 → 被采集目标端口（如 node_exporter `:9100`）。

### F-20：离线包 `start.sh` 未指导端口自定义，且改 vmagent 端口易漏改健康探活（③ 交付可用性，2026-09-24，已实现）

- **发现场景**：用户要求「edge agent 打包之后生成的安装脚本里，要指导用户怎么修改默认端口」（承接 F-19 的端口文档化，从 README 延伸到安装脚本本身）。
- **原现状**：生成的 `start.sh` 只校验三项必填后直接 `exec` 二进制——端口（vmagent 8429 / blackbox 9115）既无说明也无自检；运维改端口只能翻 README，且极易**只改 `EDGE_COLLECTOR_ADDR` 而忘记同步 `EDGE_PROM_HEALTH_URL`**，结果是探活打到旧端口、组件被反复判为不健康并触发重启。
- **处置（2026-09-24 已实现）**：
  1. **脚本头部新增两段说明**（部署机可直接 `cat start.sh` 查阅）：「端口（可选自定义）」列出三个变量、默认值与 export 示例，并写明「只改 ADDR 不改健康 URL」的后果；「出站网络策略」列出需放通的三个出站方向。systemd 场景则指明改 unit 的 `Environment=` 注释行。
  2. **运行期回显**：启动前打印本机监听生效端口（vmagent / blackbox）与「agent 自身不监听端口，仅主动出站」，让运维一眼确认实际生效值。
  3. **一致性自检**：纯 bash 提取 `EDGE_PROM_HEALTH_URL` 与 `EDGE_COLLECTOR_ADDR` 的端口号比对，不一致时打 WARNING 并给出建议值 `http://${COLLECTOR_ADDR}/health`。仅告警不阻断——避免误拦合法写法（无外部依赖，不引入 sed/awk）。
- **影响模块**：`scripts/package-edge-agent.sh`（生成物 `start.sh`）。
- **验证（抽取 start.sh 实测四例）**：全默认 → 打印默认端口、无 WARNING；只改 `EDGE_COLLECTOR_ADDR=127.0.0.1:18429` → 打出端口不一致 WARNING；三端口一起改 → 无 WARNING 且子进程收到新值；缺 `TOKEN` → 中止并准确报出缺失变量名。
- **关联**：中心侧同类能力见 `module-09/dev-feedback.md` **F-33**（`install.sh` 安装期自定义端口）；两处共同的 `$var`+全角字符输出缺陷见 M09 **F-34**。

### F-21：离线 / 退纳管节点「配置同步」永久停留「同步中」——进行时成因无失效机制（① 设计缺口 + ② 展示层降级不完整，2026-09-25，已实现）

- **现象**：用户实测截图——采集节点 `GL-OPS-GITLAB-01-X86`（网域 `mc-edge-debug` / 172.16.102.4）「状态=离线、采集器=未知、拨测器=未知」，但同行「配置同步」仍显示**「同步中」**（蓝点）+「查看下发」按钮；用户判定该显示应为「未同步」。
- **实测数据**（直查 `metric_center.db`）：`config_sync_status=out_of_sync`、`out_of_sync_cause=pull_pending`、`config_version=20260922-091425`（= 中心版本 id 31）、`last_heartbeat=2026-09-24 09:32:36 UTC`（已断连 1 天余）、`last_config_pull` 为空；中心最新已确认版本为 id 34（`CHG-20260923-009`，09-23 13:49）。即**「未同步」的事实判定本身正确**，被错误地渲染成了进行态。
- **根因链（三层叠加，缺一不可）**：
  1. **成因无失效机制**：[heartbeat_service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L134-L142) 中 `pull_pending` 的语义是「已确认下发、等 Agent 下次心跳拉取（准实时 ≤30s）」，属**带时限的进行时断言**；但该字段只在心跳到来时才被重写，节点停跳后**永久冻结**。
  2. **离线降级不完整**：[management_service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_service.go#L122-L139) 的 F-15 降级分支只覆写 `CollectorStatus` / `Components[].status`（故截图「采集器/拨测器=未知」是正确的），`ConfigSyncStatus` / `OutOfSyncCause` 原样透出——设计提案 §4.3 第 5 条虽写了「节点离线时组件状态降级」，但**配置同步侧那一半从未落地**。
  3. **前端无离线感知**：[edgeConstants.ts](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/edgeConstants.ts#L62-L67) `isConfigSyncInProgress = out_of_sync && cause === 'pull_pending'`，只看成因不看存活态，于是「离线」与「同步中」可以同时成立。
- **定性**：**展示层缺陷 + 设计缺口**（不是状态机算错——落库成因在当时是真实的；错在无人将其失效）。
- **处置（2026-09-25 已实现）**：
  - **展示层失效进行时成因**：`agentView` 在 `live ∈ {offline, retired}` 且成因 == `pull_pending` 时清空 `out_of_sync_cause` → 前端自然回落 `configSyncStatusLabel.out_of_sync` = **「未同步」**（error 红），且 `outOfSyncCauseAction` 为空 → 误导性的「查看下发」按钮一并消失。**只改展示结果、不改 DB 原始上报值**，Agent 恢复心跳后自然回真实值（沿用 F-15 既有口径与离线判定 `agentLiveStatus`，未另起常量）。
  - **仅失效进行时成因**：`apply_failed`（「同步失败」）是**已发生的终态事实**，离线/退纳管后仍透出，保留排障信息。
  - **retired 口径统一**：组件降级条件由 `offline` 扩为 `offline || retired`——retired 节点可能残留孤儿进程仍上报「运行中」，与「已退纳」并排即 F-15 同一类认知冲突；两处条件合并进同一分支，避免条件双写漂移。
- **前端零改动**：列表页与抽屉均按 `configSyncDisplayLabel` / `configSyncDisplayBadgeStatus` 单一映射源渲染，成因清空后自动回落；抽屉侧 `{cause && ...}` 已有兜底，无空引用风险。
- **测试**：`platform/edge/management_test.go` 新增 [TestAgentViewDegradesPullPendingCauseWhenHeartbeatExpired](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_test.go#L343-L401)（离线→成因失效 / DB 原值不变 / `apply_failed` 不降级 / 在线不降级 / retired 失效）与 [TestAgentViewDegradesComponentsWhenRetired](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/management_test.go#L403-L428)（心跳新鲜也降级，证明 retired 是终态、与心跳时效无关）。
- **验证**：`go vet ./platform/...`、`go test ./platform/...`、`make check-repo-map`、前端 `pnpm vitest run src/pages/config-center/nodes/`（3 文件 29 例）+ `pnpm lint`（`--max-warnings 0`）全绿。
- **PRD / 契约回写建议（供 design 条线合入 M11 PRD）**：在 §8.1（或与 F-16 修订合并处）补一条边界——**`pull_pending` 成因仅在节点存活（online/partial）时成立；节点离线（心跳超时）或已退纳管时展示层失效该成因，回落「未同步」**。`ConfigSyncStatus` / `OutOfSyncCause` 枚举与契约字段**均不变**（`api-contract-snapshot.md` 字段表无需改，仅建议补一句展示口径说明）。
- **关联**：F-15（离线组件降级，本条沿用其口径并补齐配置同步侧）、F-16（「同步中」中间态定义）、F-17（「同步中」长效停留的另一条路径：应用失败不可观测，已由 `apply_failed` 治理）。三条合起来才把「同步中」的三种假象（离线冻结 / 退纳管冻结 / 应用失败）收敛完。

### F-22：`last_config_pull` 全链路无写入方 + 抽屉未渲染「最后心跳 / 最后配置拉取」（② 实现缺口，2026-09-25，已实现）

- **发现场景**：排查 F-21 时确认「同步中」缺少**时限佐证**——中心无法区分「刚下发、马上会拉」与「迟迟拉不到」。
- **原现状**：
  1. `last_config_pull` 在 model（`EdgeAgent.LastConfigPull`）、`AgentView` DTO、前端 `types/edge.ts` **三处齐备但全链路无任何写入方**，落库恒空——与 F-17 登记的 `remote_write_last_error` 同属**契约单向定义**隐患。
  2. `EdgeAgentDrawer` 节点概览**既未渲染 `last_config_pull` 也未渲染 `last_heartbeat`**（字段有、屏上无），PRD §5.2 已定义二者却无展示出口。
- **处置（2026-09-25 已实现）**：
  1. **补写入方**（[heartbeat_service.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/heartbeat_service.go#L151-L163)）：心跳落库时判定「中心观测到发生过一次拉取」，写入**中心接收时间**（对齐 PRD §5.2「以中心接收时间为准」）。可观测线索两条——① 上报版本**推进**到最新已确认版本（正常拉包并应用成功，以更新运行态前留存的 `prevConfigVersion` 比对）；② 上报「最新版本应用失败」（已拉包但应用失败并回滚、上报版本停留旧值——**仅靠版本推进看不到**，以上一次落库的失败版本比对）。
  2. **以「事件首次出现」为界**：同版本持续心跳、同一失败版本重复上报均**不刷新**时间，避免该字段退化为「恒定显示刚刚拉取」而丧失时限佐证价值。
  3. **不编造时间**：自动注册的首次心跳报的即为最新版本时**不留痕**（中心从未观测到拉取动作）。
  4. **补渲染**（[EdgeAgentDrawer.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/EdgeAgentDrawer.tsx#L201-L204)）：「最后配置拉取」置于「配置同步」之后（紧邻成因，正是判断卡死的时限佐证位），[「最后心跳」](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/nodes/EdgeAgentDrawer.tsx#L236-L239)置于「心跳 RTT」之前；复用列表页同款 `formatRelativeTime`（不引入新格式化工具），缺省展示 `-`。
- **测试**：`platform/edge/edge_test.go` 新增 [TestHeartbeatRecordsLastConfigPullOnVersionAdvance](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/edge_test.go#L215-L259)（无事件不留痕 → 版本推进留痕且取中心接收时间 → 同版本心跳不刷新）与 [TestHeartbeatRecordsLastConfigPullOnApplyFailed](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge/edge_test.go#L262-L294)（应用失败也留痕 → 同一失败版本重复上报不刷新）；前端 `EdgeAgentDrawer.test.tsx` 新增相对时间渲染、缺省 `-` 两例。
- **验证**：同 F-21（全量门禁全绿）。
- **PRD / 契约回写建议（供 design 条线合入 M11 PRD）**：§5.2 该字段已定义「最后拉取配置 / 以中心接收时间为准」，**建议补写入口径**——中心在「上报版本推进到最新已确认版本」或「上报最新版本应用失败」时留痕一次，同版本持续心跳不刷新；节点状态页抽屉需展示「最后心跳」「最后配置拉取」。契约字段无需变更。
- **遗留（登记，不在本条修）**：① `remote_write_last_error` 仍为契约单向定义（F-17 已登记）；② 「同步中」长停留提示（阈值告警）按设计提案决策 4 本轮不做——本条的 `last_config_pull` 已为其备好数据基础。