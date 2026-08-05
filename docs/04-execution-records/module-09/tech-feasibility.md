# 技术预研报告：module-09

## 预研信息

- 日期：2026-08-05
- 发起：Orchestrator（基于用户 Module_09 原型评审提出的问题 2、4）
- 执行角色：prometheus-developer（基于 Prometheus / VictoriaMetrics 官方文档与源码调研）
- 触发原因：PRD 与原型未明确抓取目标（targets）的定义模式（static_configs / file_sd / http_sd），以及多网域配置更新机制的实现载体

## 1. 待验证问题

| # | 问题 | 来源 |
|---|------|------|
| 1 | 抓取目标在 `prometheus.yml` 中应采用静态配置（`static_configs`）还是文件配置（`file_sd_configs`，JSON 实现）？从最佳实践角度哪个更优？ | 用户问题 4 |
| 2 | 多网域场景下，配置文件更新是脚本下发逻辑还是 API 服务？ | 用户问题 2 |
| 3 | （讨论中追加）采用 `http_sd_configs` 的可行性——"监控 job 更新后，通过中心 HTTP API 自动生成 target" 是否成立？ | 用户补充 |
| 4 | vmagent / Prometheus Agent Mode 的配置重载机制与 file_sd/http_sd 目标自动感知能力 | 派生自问题 1 |

## 2. 开源组件版本与文档依据

| 组件 | 版本要求 | 关键结论 | 文档依据 |
|------|----------|----------|----------|
| Prometheus（file_sd） | 全版本 | file_sd 通过磁盘监听（inotify/fsnotify）检测目标文件变化并**立即应用，无需 reload 主配置**；`refresh_interval` 默认 5m 仅为兜底轮询；目标文件支持 JSON/YAML，文件名须 `.json/.yml/.yaml` 结尾 | [Configuration §file_sd_config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#file_sd_config)、[Use file-based service discovery](https://prometheus.io/docs/guides/file-sd/) |
| Prometheus（http_sd） | ≥ 2.28（Agent Mode ≥ 2.32） | http_sd 通过 HTTP 接口返回 target groups JSON；`refresh_interval` 默认 1m；支持 basic_auth / authorization（Bearer）/ mTLS 等完整鉴权；**拉取失败保留最后成功列表**，但 200+`[]` 会被视为合法清空 | [Writing HTTP service discovery](https://prometheus.io/docs/prometheus/latest/http_sd/)、[Configuration §http_sd_config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#http_sd_config)、[2.28.0 Release Notes](https://github.com/prometheus/prometheus/releases/tag/v2.28.0) |
| Prometheus Agent Mode | ≥ 2.32 | Agent Mode 接受与 Server **相同的 scrape 配置与 discovery 选项**（含 file_sd / http_sd），仅禁用查询/告警/本地 TSDB；支持 SIGHUP 与 `POST /-/reload`（`--web.enable-lifecycle`） | [Prometheus Agent Mode](https://prometheus.io/docs/prometheus/latest/prometheus_agent/) |
| promtool | 当前版本 | `promtool check config` 对 file_sd **只做存在性检查**（文件缺失仅 WARNING、exit code 仍为 0），**不校验 SD 文件内容**；SD 内容校验为已知缺口（[prometheus#8950](https://github.com/prometheus/prometheus/issues/8950)） | [promtool 文档](https://prometheus.io/docs/prometheus/latest/command-line/promtool/) |
| VictoriaMetrics vmagent | 当前版本 | 完整支持 file_sd 与 http_sd；**不支持 SD 段内 `refresh_interval` 字段**（由全局 flag `-promscrape.fileSDCheckInterval` / `-promscrape.httpSDCheckInterval` 控制，http_sd 实际按 flag 的一半约 30s 拉取）；file_sd 为纯轮询、非磁盘监听；SD 读取失败保留上一次目标列表；支持在 file_sd/http_sd 的 `files`/`url` 中直接指向配置中心 | [VictoriaMetrics SD](https://docs.victoriametrics.com/sd_configs/)、[vmagent 文档](https://docs.victoriametrics.com/vmagent/)、[VM #503](https://github.com/VictoriaMetrics/VictoriaMetrics/issues/503)、[VM #2187](https://github.com/VictoriaMetrics/VictoriaMetrics/issues/2187)、[VM #10924](https://github.com/VictoriaMetrics/VictoriaMetrics/issues/10924) |
| vmagent / Prometheus 重载 | - | 两者均支持 SIGHUP 与 `POST /-/reload`；**file_sd/http_sd 目标变化走 SD 自身自动感知通道，不经过主配置 reload**；主配置 reload 只对 job 结构 / relabel / 抓取参数等变化有意义 | [Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)、[vmagent #configuration-update](https://docs.victoriametrics.com/vmagent/#configuration-update) |

## 3. 验证方法

| 项 | 方法 | 预期结果 | 状态 |
|----|------|----------|------|
| promtool 对 file_sd 的校验行为 | 构造含 `file_sd_configs` 引用的配置，`promtool check config <prometheus.yml>`（引用文件缺失 / 内容损坏两种情况） | 缺失/损坏均不阻止通过（仅 WARNING / 内容不校验）；已由社区 [prometheus#8950](https://github.com/prometheus/prometheus/issues/8950) 确认 | 预研确认，MVP 开发期实测复现 |
| file_sd 目标自动感知 | 启动 Prometheus/vmagent 加载含 file_sd 的配置 → 修改 targets JSON → 观察 target 列表与 reload 计数 | targets 变化自动生效，主配置 reload 计数不变 | MVP 集成验证 |
| http_sd 刷新失败语义 | 中心 API 返回 5xx / 200+`[]` 两种响应 | 5xx 保留旧列表；200+`[]` 清空 targets（**中心故障禁止返回空列表**） | 预研确认，MVP 开发期实测 |
| vmagent 不支持 `refresh_interval` | file_sd/http_sd 段写入 `refresh_interval` 字段 | 严格解析模式报错，需改用全局 flag | 预研确认（VM #503 / #10924） |

> 纯文档/源码调研项已在本次预研完成；上表标注"MVP 开发期实测"的项，将在 backend-developer 实现 configgen 与 edge 协议时以 `go test` + 集成验证闭环。

## 4. 结论

### 4.1 targets 模式：推荐 file_sd（JSON 目标文件）——可行且为最佳实践

| 维度 | static_configs | file_sd | http_sd |
|------|----------------|---------|---------|
| 目标变更 | 需改主配置 + **reload** | 文件变化自动感知（Prometheus 磁盘监听即时；vmagent 默认 1m 轮询），**免 reload** | agent 轮询中心 API（默认 1m；vmagent 实际 30s），**免 reload、免下发配置包** |
| 断网 + agent 重启 | - | **本地文件立即恢复** | targets 不落盘，重启后需网络恢复 |
| promtool 校验 | 完整校验 | 仅检查文件存在性（内容校验缺口由生成器弥补） | 由生成器/API 侧保证 |
| 鉴权 | - | 文件权限 | 每网域 Bearer Token（授权头） |
| 中心依赖 | 无 | 无 | 依赖中心 SD API 在线（200+`[]` 有清空风险） |

**结论**：
- **file_sd 为主方案**：目标来自 CMDB 动态增删，file_sd 是官方为"外部系统驱动目标"设计的桥接机制；目标增删免 reload、断网自恢复，满足政务/金融专网弱网自治要求。**决策采用**。
- **http_sd 技术可行**（"job 更新后由中心 API 自动生成 target"设想成立，且与 outbound-only 心跳通道同构），但**本项目暂不采用**：断网重启后 targets 丢失 + 依赖中心 API 在线，与弱网自治原则冲突；记录为未来演进选项。
- **static_configs 不采用**作为主模式：把"目标变更"与"结构变更"强耦合，违背"targets 最高频变化"的实际。

### 4.2 配置更新机制：API 服务（非脚本下发）——可行，与现有架构自洽

多网域配置更新由 **API 服务 + Agent 心跳 pull** 承载，PRD 6.1/6.2 已定义：Agent 30s 心跳上报 `config_version`，中心比对返回 `config_changed` 与下载 URL，Agent `GET /config` 拉包、校验 checksum、解压、触发本地采集器 reload。物理隔离网域下 server 无入站通道，脚本下发不可行；pull + 心跳回执（`config_sync_status`）形成可观测闭环。

### 4.3 重载机制（补充确认）

- vmagent 与 Prometheus 均支持 SIGHUP / `POST /-/reload`；
- **targets 增删走 file_sd 自动感知，不触发主配置 reload**；主配置 reload 仅对 job 结构 / relabel / 抓取参数等变化有意义；
- 该机制支撑"reload 策略分离"设计：仅结构文件变化才 reload，targets 变化只重写 JSON 文件。

## 5. 对 PRD 的建议修改

| # | 建议 | 影响章节 | 优先级 |
|---|------|----------|--------|
| 1 | 配置包结构新增 `targets/*.json`（file_sd 目标文件，固定文件名覆盖写），`prometheus.yml` 的 scrape_configs 以 `file_sd_configs` 引用 | 3.3、6.2 | P0 |
| 2 | 联合 checksum 算法纳入 targets 内容（`sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)`），保证内容一致裁决准确 | 3.3.3、4.4、4.5 | P0 |
| 3 | `ConfigDraft` / `ConfigVersion` 数据模型增加 targets 内容承载字段 | 4.4、4.5 | P0 |
| 4 | 配置生成器侧增加 targets JSON schema 校验（结构、host:port、labels 合法性），弥补 promtool 不校验 SD 内容的缺口 | 3.3、3.5.1 | P0 |
| 5 | 下发/Agent 行为补充 targets 原子写与替换、解析失败回滚保留旧文件；reload 策略分离（仅结构变化才 reload） | 3.5、6.3 | P0 |
| 6 | 明确"标签模板变更驱动 targets labels 变化、而非 prometheus.yml"（映射语义） | 3.3 配置生成说明 | P1 |
| 7 | http_sd 记录为未来演进选项（不在 MVP/PRD 主流程实现），断网自治为否决理由 | Change Log / 设计决策 | P1 |

## 6. 决策落地

- 2026-08-05 讨论确认：**采用 file_sd（JSON 目标文件）作为 targets 模式；暂不考虑 http_sd**（弱网自治优先）。已记录至 [design-decisions.md](design-decisions.md)（决策 3、4）。
- 多网域配置更新机制确认为 **API 服务 + Agent 心跳 pull**，与 PRD 5.2 / 6.x 一致，无脚本下发。
- PRD 更新（v1.7 → v1.8）与原型更新由 prototype-designer 执行，按本报告第 5 节落地。

## 关联文档

- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/04-execution-records/module-09/design-decisions.md`
- 原型：`docs/prototypes/module-09/`
