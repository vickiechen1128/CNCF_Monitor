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