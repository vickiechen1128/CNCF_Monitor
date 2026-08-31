# Module 09: 网域与边缘配置中心

> **PRD 状态**: `ready`（可开发版本）
> **PRD 版本**: v1.51
> **产品版本覆盖**: MVP / v0.2 / v1.0
> **原型版本**: v1.51（原型已对齐决策 54/53）
> **更新日期**: 2026-08-31
> **对应原型**: `docs/prototypes/module-09/`

> **模块类型**: 核心能力模块（v0.2+）
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)
> **目标用户**: 运维架构师、运维工程师

## 1. 模块目标

管理 MetricCenter 的**网域（Network Domain）**生命周期与**边缘 Agent（Edge Agent）**接入状态，同时作为监控配置的**生成 / 预览 / 下发中心**，支撑政务网、跨专网、多 DMZ、弱网或物理隔离场景下的 Edge-Cloud 架构。**整体架构为「中心控制面 + 网域级采集分组」**：所有配置变更与管控操作在中心控制面完成，网域作为逻辑操作上下文与采集边界，不构成独立控制面层级。

核心职责：

1. **网域监控纳管**：从 M06 已存在的网域中选择并标记为「已纳管监控」，**下发通道按网域确定**：`default` 固定 `local`，其他网域固定 `agent_pull`，并填写对应监控参数；`agent_pull` 通道生成/重置 Edge Agent 认证 Token、提供安装指引，`local` 通道（默认 `default`）不生成 Token；`default` 管理域由系统预置并默认视为已纳管。**M06 是 `NetworkDomain` 行政 Owner（创建/分配/配额），M09 是网域监控纳管 Owner。**
2. **网域行政模型（以 M06 为单一事实来源）**：`NetworkDomain` 行政字段（`id` / `name` / `domain_type` / `tenant_id` / `authorized_tenant_ids` / 启用状态等）及其全部约束语义（ID 规则、租户归属与跨租户共享等）由 [Module_06](Module_06_Multi_Tenant.md) 统一定义与维护，本模块不重复声明行政语义；M09 只持有监控纳管相关字段（`channel` / `agent_type` / `remote_write_url` / `token` / 运行态字段）。
3. **边缘 Agent 生命周期**：记录每个网域部署的采集器类型（`vmagent` / `prometheus-agent`）、版本、在线状态。
4. **配置生成服务**：轮询 Module_01 的 ScrapeJobs / MonitoringRules 与 Module_07 的 Resources / LabelTemplates，按网域生成 `prometheus.yml`、`targets/*.json` 与 `rules.yml` 草稿；规则按 Prometheus `group` 语法组织（M09 内部自动派生分组，MVP 不暴露用户可管理的 RuleGroup 实体）。
5. **草稿与预览**：维护 draft 配置态，提供预览、diff 对比与人工确认，确认后再转为待下发版本；`alertmanager.yml` 由 Module_08 直接管理，不进入本模块配置变更确认流程（详见 [3.4 节](#34-配置变更确认与预览-v02))。
6. **配置下发中心**：为每个网域的采集节点选择下发通道并执行配置生效：
 - `local` 通道（默认 `default` 域）：中心直接写盘并触发 Prometheus `SIGHUP` / HTTP `/-/reload`；
 - `agent_pull` 通道（远端/分布式采集节点）：向 Edge Sync Agent 提供配置包下载接口，由 Agent 心跳拉取。
 > 下发通道绑定到**采集节点位置**而非网域类型；MVP 阶段通道按网域固定：`default` 管理域固定 `local`，其他网域固定 `agent_pull`，不支持同一网域混合通道与通道切换；同一网域内多采集节点（规模分片、HA、拨测多探测点）属 v0.4+ 演化场景。
7. **配置拉取服务**：为 Edge Sync Agent 提供安全的配置包下载接口。
8. **心跳与状态监控**：接收 Edge Sync Agent 心跳，展示 Agent 在线状态、WAL 积压、配置版本。
9. **安全基础**：Token 认证、拉取接口鉴权、未来支持 mTLS 证书轮转。

> **MVP 阶段**：本模块只实现网域数据模型和默认网域 `default`，`default` 固定走 `local` 通道，不强制要求部署 Edge Sync Agent；MVP 不支持同一网域混合通道、不提供通道切换，单网域分布式采集为 v0.4+ 演化场景。中心 Prometheus 配置由配置中心生成并通过 UI 确认后 reload。
> **v0.2 阶段**：实现配置生成 / 预览 / 下发、Edge Sync Agent 配置拉取、心跳上报、采集节点状态列表展示。
> **v0.4 阶段**：实现 mTLS、证书自动轮转、Token 轮换。

---

## 2. 用户故事

> 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.9 节**；本模块用户故事使用模块命名空间编码（`M09-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- **M09-ARCH-11**：从 M06 已存在的隔离网域中选择一个完成监控纳管，填写监控参数并生成 Edge Agent 接入 Token。
- **M09-ARCH-12**：查看所有网域列表及每个网域 Edge Agent 的在线状态（列表页形式）。
- **M09-OPS-11**：在 采集节点状态列表页查看某个网域 Edge Agent 的最后心跳、WAL 积压和配置版本。
- **M09-OPS-12**：当某个网域 Edge Agent 失联时，触发 `EdgeSiteOffline` 告警（告警规则由 Module_08 管理）。
- **M09-OPS-13**：重置某个网域的 Edge Agent Token。
- **M09-OPS-14**：查看按网域生成的配置草稿（`prometheus.yml` / `targets/*.json` / `rules.yml` 等），并与当前生效配置做按文件 diff 对比。
- **M09-OPS-15**：确认配置草稿后，一键下发并 reload 中心 Prometheus 或 Edge Agent。
- **M09-OPS-16**：查看历史配置版本与下发记录，必要时回滚到上一版本。

## 3. 核心功能

> **导航/菜单结构**：M09 的 Web 门户菜单按职责分为两个一级菜单组：
>
> - **网域与节点管理**（接入面）：子菜单「网域纳管」、「采集节点状态」；
> - **配置下发**（配置面）：子菜单「配置变更确认」、「下发记录」。
>
> 「网域纳管」页面常驻并展示本租户下所有已授权网域；「采集节点状态」子菜单也常驻，无 `EdgeAgent` 实例时不隐藏入口，而是进入空态引导页，提示用户先到「网域纳管」完成纳管并按安装指引接入 Edge Sync Agent。

### 3.1 网域纳管

> **职责边界**：M09 不创建 `NetworkDomain` 行政记录；网域必须先由 [Module_06](Module_06_Multi_Tenant.md) 创建并分配给租户，再由 M09 完成「监控纳管」。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **网域列表** | 展示本租户下所有被授权网域；**列表列收敛为 7 列**——网域（名称 + ID 两行合并）、**网络区域类型（zone_type，Tag 展示——政务云场景按网络区域识别，公有云场景按 region 识别，为网域身份的并列识别维度）**、纳管状态、下发通道（`local` / `agent_pull`）、运行状态（状态 + 最后心跳合并，仅 `agent_pull` 展示）、凭据（脱敏 Token + 复制图标，仅 `agent_pull` 展示）、操作（**三槽位固定结构：主操作·详情·更多**——主操作=纳管/编辑随行状态变化，文本链接样式；详情常驻按钮；更多仅 `agent_pull` 已纳管行显示重置 Token+二次确认，local 行和未纳管行隐藏）；**中心接入地址、Remote Write URL、Agent 类型、描述等配置字段全部进右侧详情 Drawer**（渐进披露模式，与 M01/M07 一致）；**Token、Agent 类型、最后心跳等字段仅在 `channel=agent_pull` 时存在/展示；`local` 通道网域不生成 Token、不展示运行态心跳字段、不提供安装指引**；未纳管网域通过**行内「纳管」按钮**进入监控参数配置，**页面右上角不再提供「纳管网域」按钮** | P0 |
| **网域纳管（原「网域注册」，更名）** | 从 M06 已存在的网域中选择一个完成纳管；**下发通道按网域固定**：`default` 固定 `local`，其他网域固定 `agent_pull`，MVP 不提供通道选择/切换；`local` 通道不生成/不展示 Token、Remote Write URL、安装指引；`agent_pull` 通道填写监控参数（`agent_type` / `remote_write_url` 等），生成认证 Token；**MVP 阶段采集器类型固定 `vmagent`**（Agent 类型下拉保留、仅 `vmagent` 一个选项，`prometheus-agent` 保留枚举、v0.2+ 开放）；**Remote Write URL 由平台自动推导**（中心 ingress 地址 + 网域路径，可手动覆盖）；纳管为**登记制**（生成网域监控参数与 Token，Agent IP / 主机名 / 状态 / 最后心跳由心跳上报补全），是「纳管 → 安装指引 → Agent 自动上线」闭环的必要前置步骤（见下方 3.1.1）；**`agent_pull` 通道纳管成功后自动滚动并高亮页面顶部「安装指引」提示区** | P0 |
| **网域编辑** | 修改网域监控参数（Agent 类型、Remote Write 目标、描述）；**下发通道只读展示，MVP 不可编辑**：通道切换属 v0.4+ 演化场景，届时需定义历史版本与在途变更处理策略；网域名称/租户/状态等行政字段由 [Module_06](Module_06_Multi_Tenant.md) 维护；表单仅维护**监控配置字段**，运行态字段（状态 / 最后心跳）只读展示 | P1 |
| **网域删除**（由 M06 承责） | 网域行政删除（含资源绑定约束）由 Module_06 「网域管理」执行；本页不提供删除，仅监控纳管状态切换 | — |
| **Token 管理** | 仅对 `channel=agent_pull` 网域有效；查看/重置 Edge Sync Agent 认证 Token；Token 在 UI 中**完全脱敏展示**（不显示任何明文片段），完整值仅可通过「复制」按钮获取 | **P0** |
| **安装指引** | **页面顶部常驻提示区**（而非每行入口/弹窗），**仅在 `channel=agent_pull` 时展示**：网域纳管页顶部展示「新网域接入操作流程」——**3 步人工步骤**① 下载并校验一体化离线包（含 Edge Sync Agent + 采集器 + blackbox exporter 可选）② 配置 `NETWORK_DOMAIN_ID` / `TOKEN` 环境变量 ③ 启动 Edge Sync Agent（systemd）（采集器与 blackbox exporter 由 Agent 启动后自动部署，并入第③步描述）；同时说明**边缘节点组件构成**（Edge Sync Agent 必装 + 采集器 + blackbox exporter 可选）与**凭据获取方式**（`NETWORK_DOMAIN_ID` = 对应网域 ID、`TOKEN` 经网域行内复制按钮获取，UI 完全脱敏）；**行内不再提供安装指引按钮** | P1 |
| **默认网域** | 系统初始化自动创建 `default` 网域，MVP 单网域场景无感知 | P0 |

> **字段语义**：网域列表字段分两类——**监控配置字段**（**下发通道** / Agent 类型 / Token / Remote Write URL / 描述，纳管或编辑时设置）与**运行态字段**（状态 / 最后心跳，由 Edge Sync Agent 心跳自动上报更新，纳管 / 安装指引完成前为 `unknown` / `-`）。行政字段（ID / 名称 / 租户 / 域类型 / 启用状态）由 [Module_06](Module_06_Multi_Tenant.md) 维护。**Token、Agent 类型、最后心跳、安装指引等字段仅在 `channel=agent_pull` 时存在/展示；`channel=local` 的网域不生成 Token、不展示运行态心跳字段、不提供安装指引。** 纳管 / 编辑表单仅维护监控配置字段；运行态字段的来源与语义在列表列头与页脚标注，组件明细与诊断请查看「采集节点状态」页。

#### 3.1.1 纳管 → 安装指引 → 自动上线（登记制闭环）

**「网域纳管」不能由「安装指引」替代**，两者是「先有身份、再接入」的两个串行步骤：

1. **凭据前置签发**：Edge Sync Agent 启动时必须携带平台签发的 `NETWORK_DOMAIN_ID` 与 `TOKEN`（[[6.4](#64-edge-sync-agent-本地行为) 第 2 条），这两个值由网域在 M09 纳管时生成；未预纳管的网域没有可验证身份，Agent 首次心跳 / 拉包无法通过鉴权，更不可能「自动抓取」。
2. **「自动注册」的对象是 Agent 实例而非网域**：Agent 首次成功握手后平台自动创建的是 `EdgeAgent` 运行态记录（上线 / 心跳 / 版本），而 `NetworkDomain`（网络边界 + 租户映射）必须先由 M06 创建并分配给租户——配置生成按网域分组并注入 `external_labels.network_domain_id`，依赖网域→租户映射先行落地。
3. **安全信任锚点**：不做「Agent 首包即自动建域」——陌生端点自报 domain_id 即可建域存在隐式信任问题，且与「网域 = CMDB 云区域 1:1」的边界约束冲突。
4. **v0.4+ 演化而非取消**：网域与 CMDB 云区域 1:1 后，M06 的网域创建将演化为「从 CMDB 同步 / 校验」，M09 的纳管动作保留；v0.2 前 M06 手动创建网域仍是唯一来源。

闭环流程（`channel=agent_pull` 网域）：**M06 创建网域（行政记录：网域名称 + 租户归属/授权，ID 规则见 [Module_06](Module_06_Multi_Tenant.md)）→ M09 纳管（登记制：非 `default` 网域固定 `agent_pull` 通道、填写监控参数、Token 自动签发、Remote Write URL 自动推导）→ 安装指引（下载一体化离线包 + 注入凭据 + systemd 部署）→ Agent 心跳自动上线（出现在「采集节点状态」页）**。

`channel=local` 的网域（如默认 `default`）不经过安装指引 / Token 环节，配置确认后直接由中心写盘并 reload。

### 3.2 采集节点状态

> **定位**：本页属于一级菜单「网域与节点管理」下的子菜单，展示已接入监控的**边缘采集节点**（Edge Sync Agent + 采集器组合）运行状态；子菜单常驻，无 `EdgeAgent` 实例时进入空态引导页。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **采集节点注册** | Edge Sync Agent 首次拉取配置时自动注册到对应网域 | **P0** |
| **采集节点状态：节点平铺表 + 组件抽屉** | **主对象改为「采集节点」**（用户心智单元：在哪个机器上装了什么东西），一行一个节点——节点（主机名 / IP）、网域、**整体状态**（聚合三档：正常 / 部分异常 / 离线——规则：Agent 离线→离线；必装组件异常→部分异常）、采集器状态、拨测器状态、配置同步（含引导按钮）、WAL 积压、最后心跳；**组件明细进「查看」右侧抽屉**（不再用展开行嵌套子表），抽屉内列 Edge Sync Agent / vmagent / blackbox exporter 三个进程的状态、版本、配置版本、最近错误，并配组件关系说明：「Agent 是管理进程，负责拉取配置和守护另外两个进程。某个进程异常会被自动重启并在此处展示。」；**筛选全部作用于平铺列**：网域、整体状态、采集器状态、拨测器状态、配置同步 | **P0** |
| **配置同步状态与引导** | 展示中心配置版本与边缘实际生效版本是否一致（状态机见 §8），并按状态提供引导操作：`未下发配置`（`config_sync_status=no_version`：Agent 已上线但网域尚无成功下发过的 `ConfigVersion`）→ 操作按钮**「去配置采集 Job」**，跳转 M01 采集 Job 页并预选该网域；`未同步`（`config_sync_status=out_of_sync`）**按 `out_of_sync_cause` 分档展示差异化标签 + 引导按钮**（决策 41-1：避免三种按钮并存时统一显示「未同步」造成认知混淆）：*`pending_draft`*（中心存在待确认变更草稿）→ 标签**「待确认变更」**（gold）+「**前往配置确认**」；*`pull_pending`*（无待确认变更，Agent 拉包/生效延迟）→ 标签**「生效中」**（blue）+ 纯展示等待 +「**查看下发记录**」；*`local_reset`*（本地环境/地址变化、checksum 校验失败保留旧配置等）→ 标签**「本地校验失败」**（volcano）+「**立即同步**」（中心置 `force_pull` 标记，Agent 下次心跳强制重新拉包并 reload）；`已同步`（`in_sync`）/ `人工覆盖`（`manual_override`）/ `未知`（`unknown`）→ 纯展示；**进程健康与配置同步解耦**（决策 41-2）：采集器/拨测器进程异常属组件健康问题，不在本列给引导按钮，由「整体状态」列 + 行级高亮 + 详情抽屉高危横幅承载 | **P0** |
| **采集器类型** | 按网域配置 `vmagent`（默认）或 `prometheus-agent` | **P0** |
| **采集节点状态列表页** | 属于一级菜单「网域与节点管理」下的子菜单，**常驻展示**；无 `EdgeAgent` 实例时不隐藏入口，而是进入**空态引导页**，提示用户先到「网域纳管」完成纳管并按安装指引接入 Edge Sync Agent；存在实例后支持按网域、整体状态、采集器状态、拨测器状态、配置同步五维筛选；**仅展示有 Agent 的网域**（`channel=local` 的网域不产生 EdgeAgent 实例；页面顶部**可关闭 Alert 组件关系说明横幅，默认展示**（关闭后记住 `localStorage`）：「一次安装 = 三个进程：Edge Sync Agent（管理进程）+ 采集器 vmagent（采集指标）+ 拨测器 blackbox（可选）。Edge Sync Agent 负责拉取配置并守护另外两个进程，某个进程异常会被自动重启并在此处展示。」；组件清单由 Edge Sync Agent 心跳附带上报（PRD 5.3）；页面对象为**边缘节点 Agent 部署实例**（Edge Sync Agent + 采集器组合，PRD 5.2） | **P0** |
| **WAL 与 Remote Write 参数配置** | 按网域配置 WAL 大小、批量、压缩、回传限速 | P1 |
| **WAL 积压监控** | 接收并展示 Agent WAL 积压字节数，反映弱网/断网程度 | P1 |
| **边缘诊断看板（图表/趋势）** | 心跳延迟 RTT 趋势、WAL 积压趋势、Remote Write 队列状态、24h 断网时长、最近错误等可视化图表 | P1/P2 |
| **采集器进程管理** | Edge Sync Agent 负责**本节点**采集器（`vmagent` / `prometheus-agent`）与 blackbox exporter 的进程生命周期管理：随一体化离线包安装、启动守护、健康检查、进程异常自动重启；采集器版本与运行状态纳入心跳上报与采集节点状态展示（详见 3.9 一体化交付与职责边界） | **P0** |
| **版本管理** | 记录 Agent 版本，支持版本兼容性提示 | P2 |
| **本地告警规则下发** | 将 `scope=edge`/`both` 的告警规则随配置包下发到边缘 | P2 |
| **本地告警通知通道** | 边缘 Agent 支持配置本地飞书/钉钉 webhook，断网时独立通知 | P2 |

### 3.3 配置生成服务

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **轮询策略数据** | 定时轮询 Module_01（ScrapeJobs、`MonitoringRule`）与 Module_07（Resources、LabelTemplates）；读取各源表 `max(updated_at)` 作为「源数据版本」，仅当源数据版本变化时触发重算（预筛，避免无谓轮询） | **P0** |
| **按网域生成配置** | 为每个网域生成 `prometheus.yml`（含 scrape_configs、external_labels）与 `targets/*.json`（file_sd 目标文件）；scrape_configs 通过 `file_sd_configs` 引用本域 `targets/*.json`（固定文件名覆盖写），prometheus.yml 仅含 job 骨架（job_name、metrics_path、params、relabel、file_sd 引用），targets 列表统一放入 targets JSON 文件；**v0.2 起支持 Job 网域扇出（决策 54）**：M01 逻辑 Job 可绑定网域集合，生成器按网域自动拆分——为每个目标网域生成各自的 scrape_configs 片段与 targets 文件，分别进入各域的变更检测 / 校验 / 确认 / 下发流程（流程不变，无需用户按网域克隆 Job）；`rules.yml` 由 `MonitoringRule` 按 Prometheus `group` 语法组织（M09 内部自动派生规则分组，MVP 不暴露用户可管理的 RuleGroup 实体），按规则作用域与下发通道生成：所有 `scope=central`/`both` 的规则进入 `rules.yml` 候选集；`channel=local` 的网域直接包含候选集；`channel=agent_pull` 的网域在 v0.4+ 仅包含 `scope=edge`/`both` 规则（MVP 阶段 `scope` 固定 `central`，所有通道均包含同一套规则，中心统一求值）；**规则内容按 `content_mode` 分形态并入 `rules.yml`（MVP 起）：`content_mode=yaml_passthrough` 的规则将 `rule_content`（完整 `rules.yml` 内容，含 `groups`）原样并入；`content_mode=structured`（v0.3+）按字段化生成（对齐 [Module_01 5.5](Module_01_Metric_Collection_Center.md#55-规则编辑模型monitoringrule)）**；`alertmanager.yml` 由 Module_08 直接管理，不在本模块生成或审批；**配置生成候选集仅包含 `draft_status=ready` 的 `ScrapeJob` / `MonitoringRule`（v0.2 起 Job、v0.3 起规则），`draft_status=draft` 对象不参与配置生成** | **P0** |
| **标签注入** | 自动注入 `external_labels.network_domain_id`（登记 `zone_type` / 部署 `replica` 时同步注入）；实例级业务标签 `biz` 与租户标签 `tenant` 均由 M07 LabelTemplate 以 target 级注入（`business_domain → biz`、`tenant_id → tenant` 映射），注入 `targets/*.json` 的 `static_configs[].labels`，M09 不单独注入 | **P0** |
| **实例过滤** | 根据 Job 中手动勾选的实例或筛选条件，从 Module_07 Resources 解析目标列表；**v0.2 起 `instance_selection_mode=filter`（决策 53，由 v0.3+ 提前）**：按 Resource 属性条件表达式在**每次配置生成周期实时求值**——M07 新导入/同步进来的资源只要匹配条件即自动纳入 targets（无需编辑 Job），下线/属性变化同理自动移出；**`offline` 排除（MVP 必实现）**——生成 `targets/*.json` 时按 `Resource.status=offline` 过滤已下线实例，`offline` 后下一配置生成周期即从 targets 移除（跨模块契约，对齐 [Module_07 8.1](Module_07_Monitoring_Object_Management.md)）；`maintenance` 排除口径届时与 M01 一并对齐 | **P0** |
| **草稿生成** | 生成后先写入 `ConfigDraft`，不直接覆盖生效版本 | **P0** |
| **差异检测（版本触发 + checksum 裁决）** | 生成后计算配置内容联合 checksum，与当前生效 `ConfigVersion` 的 checksum 对比：内容一致则不生成新草稿 / 自动丢弃；不一致才进入待确认 | **P0** |
| **规则作用域过滤与分组** | `rules.yml` 按 `MonitoringRule` 字段自动派生 `group`（默认按 `resource_type` 或 `rule_type` 聚类，MVP 不暴露用户可管理分组）；下发到边缘时仅包含 `scope=edge`/`both` 的规则；中心仅包含 `scope=central`/`both` | P1 |
| **blackbox 配置生成** | 当网域存在 `job_type=blackbox` 的 ScrapeJob 时，生成并打包 `blackbox.yml` | **P0** |
| **认证/TLS 透传** | 将 `ScrapeJob` 的认证/TLS 最小集映射进对应 `scrape_configs`：`auth_type=basic` → `basic_auth`（username/password）、`auth_type=bearer` → `authorization`（Bearer token）、`tls_skip_verify` → `tls_config.insecure_skip_verify`、`ca_file` → `tls_config.ca_file`；全部可选、默认不启用（无认证裸 http 场景不受影响）——M09 仅透传映射、无新机制（决策 31）；blackbox 拨测的 HTTP/HTTPS 模块同理透传 `tls_config` | **P0** |

> **scope 业务场景**：MVP~v0.3 阶段 `scope` 固定 `central`（中心统一求值，用户无需配置 scope）；`edge`/`both` 为 v0.4+（P2）预留，核心场景为**断网自治告警**（边缘 vmalert 本地求值 + 本地通知通道）；`both` 用于边缘快速响应 + 中心聚合（需以标签区分求值域去重）；`central` 用于跨域/全局聚合规则。本模块按 `scope` 决定 `rules.yml` 随哪个网域配置包下发。详见 [Module_01 5.5 scope 字段说明](Module_01_Metric_Collection_Center.md#55-规则编辑模型monitoringrule)。

> **配置文件 × 源数据映射语义**：按网域生成的配置结果按「层级」分为两类文件，驱动源不同：
>
> - `prometheus.yml` = **网域级 + job 结构级**：`global.external_labels`（network_domain_id / zone_type / replica）与 `remote_write` 由 `NetworkDomain`（`agent_type`、`remote_write_url`、`tenant_id` 等）驱动；scrape_configs 的 job 骨架（job_name、metrics_path、params、relabel_configs、file_sd 引用）由 `ScrapeJob`、`CITypeExporterMapping`、`ExporterInstallationConfirmation` 驱动；
> - `targets/*.json` = **资源级 + 标签模板级**：目标列表由 `Resource` 实例选择（Job 中手动勾选的实例或筛选条件）驱动；targets 中的 labels 由 `LabelTemplate` 静态展开驱动；
> - `rules.yml` = **规则级（MonitoringRule）**：`content_mode=yaml_passthrough`（MVP）的规则将 `rule_content` 原样并入，`content_mode=structured`（v0.3+）按字段化生成；规则保存 / 启停 / 删除引起 `updated_at` 变化即触发本文件重算（pull 模式，对齐 Module_01 5.5「规则文件挂载」）。
>
> **推论**：`LabelTemplate` / `Resource` 变更触发的是 `targets/*.json` 中 labels 与目标列表的变化，**而非 `prometheus.yml` 结构变化**；相应差异体现在 targets 文件内容上（targets 内容已纳入联合 checksum 裁决，见 3.3.3）。`prometheus.yml` 仅在网域属性或 job 结构（job 增删、抓取参数、relabel 变化）变化时才改变。
>
> **业务指标标签规范消费（对齐 Module\_07 5.15 / Module\_01 v3.4）**：业务指标（接口 QPS / 延迟 / 错误率）↔ 静态资源的关联在本模块配置生成侧落地——
>
> - **机制 A（MVP）**：`targets/*.json` 中每个 target 的 labels 由 LabelTemplate 静态展开（含 `app_name→app`、`business_domain→biz` 等映射，即 `static_configs[].labels` 注入）——Prometheus 抓取时自动附加到该 target 全部序列（业务指标自动带资源标签，零业务侧成本）；
> - **机制 B（兜底，MVP 提供）**：`metric_relabel_configs` 归一化业务侧非规范标签（如 `biz` / `service` → `app`）；关键限制：relabel 只能操作指标自带标签、**不能引入资源侧数据**（关联键值一致性依赖业务侧按规范埋点，见 Module\_07 5.15）；
> - **关联键**：`app`（值 = 平台 `app_name`）、`biz`（值 = `business_domain`）；**不用 `instance`**（动态实例漂移，v0.2+ 服务发现沿用同一规范）；
> - **v0.2+ 服务发现**：targets 由服务发现结果生成（K8s / Nacos），`__meta_*` → `app` / `service` 标签由 `relabel_configs` 映射（对应 Module\_01 5.4 `service_discovery` 预留）。

#### 3.3.1 `external_labels` 注入说明

`external_labels` 是 Prometheus / vmagent 在 `global` 段配置的一组全局标签，采集器在抓取每条时间序列后会自动把这些标签附加到 series 上，因此所有从该 Agent 回写的指标都会统一携带这些标签。

Module_09 在生成每个网域的 `prometheus.yml` 时，必须在该网域 Agent 配置文件的 `global.external_labels` 中注入以下**部署级、物理维度的不可变元数据**（2026-08-19 决策：external_labels 不注入租户 / 业务标签）：

```yaml
global:
  external_labels:
    network_domain_id: "gov-cloud-a"
    zone_type: "extranet"     # 仅当网域登记了 zone_type 时注入
    replica: "replica-0"      # 部署级高可用副本标识
```

- `network_domain_id`：取值对应 `NetworkDomain.id`，用于标识指标来源网域。
- `zone_type`：网络区域类型（政务云 `internet` / `extranet` 等），仅当网域登记了 `zone_type` 时同步注入。
- `replica`：部署级高可用副本标识，随部署拓扑注入。

注入效果：

- 边缘 Agent 抓取的所有指标在 Remote Write 到中心时都会自动携带 `network_domain_id` / `zone_type` / `replica` 标签。
- Module_02 查询中心 Prometheus 时，可基于 `network_domain_id` 标签对用户有权限的网域做进一步过滤或展示来源网域。
- **租户 / 业务标签不由 `external_labels` 注入**：租户标签 `tenant`（`tenant_id → tenant`）与实例级业务标签 `biz`（`business_domain → biz`）均由 [Module_07](Module_07_Monitoring_Object_Management.md) LabelTemplate 以 **target 级**注入，在生成 `targets/*.json` 时作为 `static_configs[].labels` 注入，M09 不单独注入；MVP 单租户下 `tenant` 映射可选、不强制注入，租户数据隔离优先在 API Gateway / 查询代理层通过 PromQL 注入实现（决策 19）。

> **与 Module_10 的边界**：Module_09 只负责为**内部 Edge Agent**（vmagent / prometheus-agent）生成配置时注入 `external_labels`；Module_10 负责**外部异构监控源**（第三方 Prometheus、Zabbix、云监控等）接入时的标签归一化。详见 [[7.1.4 与 Module_10 的边界](#714-与-module-10-的边界)。

#### 3.3.2 blackbox 配置生成说明

当网域内存在 `job_type=blackbox` 的 `ScrapeJob` 时，Module_09 必须同时生成 `prometheus.yml` 中对应的 scrape_config、`targets/` 下对应的目标文件与同域 `blackbox.yml` 中的探测模块：

- blackbox Job 的 scrape_config 必须设置 `metrics_path: /probe`，并通过 `params.module` 引用 `blackbox.yml` 中的模块名；
- blackbox Job 的目标（`ScrapeJob.blackbox_targets`）与其他 job 一样写入 targets JSON 文件（如 `targets/blackbox-http.json`），`prometheus.yml` 的 blackbox scrape_config 保留 `metrics_path` / `params` / `relabel_configs` 骨架并用 `file_sd_configs` 引用该文件；
- 通过 `relabel_configs` 将原 `__address__` 写入 `__param_target`，并把 `__address__` 替换为本地 blackbox exporter 地址，例如 `127.0.0.1:9115`；
- `blackbox.yml` 仅写入本域 ScrapeJob 实际引用的模块，避免下发无关配置。

示例生成逻辑：

```yaml
# prometheus.yml（job 骨架，targets 不内联）
scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    file_sd_configs:
      - files:
          - 'targets/blackbox-http.json'
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: 127.0.0.1:9115
```

```json
// targets/blackbox-http.json（file_sd 目标文件）
[
  {
    "targets": ["https://api.example.com/health"],
    "labels": {}
  }
]
```

> **http_sd 未来演进选项**：由中心 HTTP API 动态下发 targets（`http_sd_configs`）记录为未来演进选项，当前**不采用**：政务/金融专网弱网自治要求下，http_sd 的 targets 不落本地磁盘，断网重启后 targets 丢失、且依赖中心 SD API 在线（中心返回 200+`[]` 有清空目标风险），与「断网自恢复、本地自治」原则冲突；故 MVP / v0.2 阶段 targets 统一采用 file_sd（JSON 目标文件）。

#### 3.3.3 变更检测与草稿去重说明

> **触发模式声明（pull 模式）**：变更检测采用 **pull 模式**——Module_09 异步轮询检测 Module_01/07 各源表的 `updated_at` 变化，Module_01/07 **不主动通知、不感知 Module_09 的存在**，策略/资源写库即完成其职责。本文档（及设计中「XX 变更触发 Module_09 重算」的表述，实际语义均为「Module_09 轮询时检测到 XX 的 `updated_at` 变化」，而非事件推送。轮询为**兜底保底**，配合前端保存后 best-effort 即时触发（见下「即时性优化」）保证变更单在合理时间内出现。

Module_09 采用**「源数据版本触发预筛 + 生成后 checksum 裁决」**的混合机制，避免两个问题：无谓轮询（版本未变化却重算）、草稿噪音（内容无变化却反复进入人工确认）。

**第一层：版本触发预筛（决定"要不要算"）**

- 配置中心异步轮询读取参与配置生成的各源表 `max(updated_at)`，聚合为「源数据版本」（`source_data_version`）；轮询间隔采用**自适应退避（决策 F-15）**：最近源数据有活动时按短间隔（默认 5s）检测，持续无变化时指数退避至最大间隔（默认 120s），兼顾单网域实时性与多网域资源开销；启动参数 `--change-detect.min-interval` / `--change-detect.max-interval` 与环境变量 `CONFIG_CHANGE_DETECT_MIN_INTERVAL_SECONDS` / `CONFIG_CHANGE_DETECT_MAX_INTERVAL_SECONDS` 可覆盖（兼容旧 `CONFIG_CHANGE_DETECT_INTERVAL_SECONDS`，作为最大间隔）。「检测延迟不超过一个轮询周期（默认 30s）」的历史表述随退避机制更新为「不超过当前退避间隔」；
- 参与聚合的源表（与设计一致）：
 - `ScrapeJob`（含 blackbox 类型）、`MonitoringRule`（Module_01）；
 - `CITypeExporterMapping`（Module_01）；
 - `Resource`、`LabelTemplate`（Module_07）；
 - `ExporterInstallationConfirmation`（Module_01）；
- 仅当 `source_data_version` 大于「上次生成时间」时才触发该网域重新生成，否则跳过本轮。
- **草稿状态过滤（v0.2/v0.3）**：生成配置时，`ScrapeJob` / `MonitoringRule` 候选集必须过滤为 `draft_status=ready` 且 `enabled=true`；`draft_status=draft` 或 `enabled=false` 的对象不参与配置生成，因此其 `updated_at` 变化不会触发有效配置变更；但 M09 仍可在 `source_data_version` 聚合中感知其变化，生成空跑后通过 checksum 裁决丢弃（内容无变化），避免草稿对象在确认页产生噪音。
- **即时性优化（MVP 落地，决策 F-19）**：轮询为**兜底保底**；用户在策略/资源页保存后，前端**best-effort 即时触发一次** `createDraft`（同域活 pending 保活约束保证不重复、不覆盖轮询语义），并提供「前往配置变更确认」跳转入口。即时触发仅做实时性优化，检测闭环不依赖它——即使触发失败，下一轮轮询仍会按源数据版本变化自动生成。

**第二层：checksum 裁决（决定"算出来要不要确认"）**

- 生成完成后，对配置内容计算**联合 checksum**：`sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)`（按需拼接，缺失文件按空串处理；`targets 内容` 为按固定顺序拼接的本域全部 `targets/*.json` 文件内容，保证 targets 变化可被裁决覆盖）；
- 与当前生效 `ConfigVersion.metadata.checksum` 对比：
 - **一致（空变更抑制，决策 F-19）**：内容无实际变化，**不生成新草稿 / 不落库、不进入确认列表**（`ErrNoChanges`）——watcher 推进检测基线但不落变更单；用户手动触发生成时返回 200 + `no_changes` 提示；仅更新 `source_data_version` 记录；
 - **不一致**：生成 `status=pending` 的 `ConfigDraft`，`metadata` 记录 `trigger_summary`（触发来源：变更的 job / rule / 表 + 时间），进入人工确认。

**第三层：同域 pending 取代（防堆积，决策 42-1 / F-19 checksum 比较取代）**

- watcher 或生成器遇**活 `pending`** 时，先对「当前源数据产物 checksum」与「既有 pending 产物 checksum」做比较（而非直接跳过）：
 - **checksum 相同**：源数据无实质变化，保持 `skipped_pending`、**不推进检测基线**（沿用 F-14 语义），不生成新单；
 - **checksum 不同**：源数据已前进，生成新 `pending` 草稿**取代旧单**——旧单置 `discarded(superseded)`，`metadata` 互记 `superseded_by_change_no`（旧单指向新单）/ `supersedes_change_no`（新单指向旧单）供审计追溯；
- 效果：同一网域**同时最多一张「活」的 `pending` 变更单**，确认页不会出现同域多张待确认单，运维确认的永远是最近一次源状态的发布审批（go/no-go），避免确认过期状态；被取代旧单在详情页以 Alert 提示「已被新变更单取代」。
- 边界：`superseded` 仅发生在「确认前」；已 `confirmed` / 已 `discarded` 的草稿不受影响；若无更早 `pending` 则无需取代。

**Edge Agent 侧（场景 B）与中心侧职责划分**

| 环节 | 机制 | 职责 |
|------|------|------|
| 中心：是否重新生成草稿 | `source_data_version` 触发预筛 + 联合 checksum 裁决 | 防无谓轮询、防草稿噪音 |
| 边缘：是否重新拉取 | `config_version`（`ConfigVersion.id`）比对，心跳返回 304 | 拉取协议最简 |
| 边缘：拉到的包是否正确 | `metadata.json.checksum` 完整性校验 | 防传输损坏 / 篡改 |

> **检测状态可观测 {P1}**：变更检测过程需向运维可观测（pull 模式检测为异步后台行为，不可见会引发"变更为什么没生效"的困惑）。配置预览页展示每个网域的检测状态：
>
> - **上次检测时间**：最近一次轮询执行时间；
> - **当前源数据版本**：`source_data_version`（各源表 `max(updated_at)` 聚合）；
> - **检测结果**：本轮检测到变更 → 生成了哪些草稿（引用草稿 ID / 触发摘要）；未检测到变更 → 本轮无变更、跳过重算；checksum 一致 → 内容无变化、**自动丢弃且不落库（空变更抑制）**、不进入确认；**生成失败（configgen 异常，非校验类）→ 提示「本次变更生成失败：<原因>，请查看日志」，对该轮**不推进** `source_data_version` 记录、标记失败待重算，下一轮重试（决策 42-4）。**

### 3.4 配置变更确认与预览

> **职责定位**：本环节面向**不了解 Prometheus 的运维工程师**，重点不是"理解配置如何生成"，而是做**变更发布审批（go/no-go）**。平台自动完成「检测变更 → 生成配置 → 校验 → 过滤无实际影响的变更」（自动生成）；运维负责对进入待确认列表的变更做**人工确认**（发布审批）——确认的对象是**「要不要上线」及「变更影响是否可接受」**，而非「配置怎么生成」。因此确认界面以**人话变更摘要与变更清单**为核心信息，**技术字段（源数据版本 / 生成器版本 / 联合 checksum / 触发摘要）下沉折叠**，仅供追溯排障。
>
> **审批分级策略（M01/M08/M09 职责重构）**：
>
> - **人工确认（go/no-go）**：`prometheus.yml`、`targets/*.json`、`rules.yml`、`blackbox.yml` 的变更进入待确认列表，由运维审批后发布；
> - **自动生效**：`alertmanager.yml` 由 [Module\_08: 告警收敛与通知管理](Module_08_Alertmanager_Notification_Management.md) 直接写文件并触发 Alertmanager reload，**不进入**本模块 `ConfigDraft` / 配置变更确认流程；
> - **混单规则**：若某次变更同时涉及人工确认文件与 `alertmanager.yml`（技术上不会同时出现在 M09 产物中，但为防御性说明），按高风险文件走人工确认；
> - **原因**：通知路由/接收人/静默/抑制调整频繁、风险低（仅影响告警体验，不影响采集/规则求值），且 M08 是 Alertmanager 配置的唯一 Owner。
>
> **规则变更风险说明**：`MonitoringRule` 变更（新增/修改/删除）生成 `rules.yml` 差异，属于高风险变更（可能导致误报/漏报），必须在变更清单中醒目提示。
>
> **技术确认 vs 审批上下文（ITIL 边界声明）**：确认页的**配置预览 / Diff（YAML）是平台内技术确认的运维排查工具**（面向深入排查的运维，**不构成审批上下文**——
> - **审批信息为主区**：人话变更摘要 + 变更清单（类型 / 对象 / 说明 / 风险等级）+ 影响范围，是确认动作（go/no-go）的决策依据；
> - **技术产物（配置 YAML / Diff / checksum / 源数据版本）为次级/折叠**：仅运维排查使用，不参与审批决策；
> - **未来对接外部审批平台（ITSM）时**：审批上下文**仅含人话摘要 + 影响范围 + 风险等级**（复用变更清单），**技术产物不传出平台**——平台内技术确认与业务审批分层（平台内 = 轻量技术确认 / ITSM = 业务审批流，集成路径待 v0.4+/v1.0 另行设计，本轮仅声明边界）。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **变更摘要（人话）** | 每项待确认变更提供**人话摘要**，回答「为什么发生了变更」，如「新增 1 台服务器（10.0.1.11）加入 node-exporter 采集」「HighCPUUsage 告警规则阈值由 80 调整为 85」；摘要由 configgen 对比「当前生效版本」与「新草稿」的**产物差异**生成（见下方「变更摘要生成机制」） | **P0** |
| **变更清单（结构化 + 风险）** | 每项变更拆分为结构化清单：变更类型（新增 / 修改 / 移除）、**变更对象 = 源数据对象统一枚举：采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板，与 Module_01 采集 Job、规则编辑及 Module_07 资源、标签模板的功能对象对齐，非配置文件本身**、**影响的配置文件**：configgen 对比产物差异派生，如仅 targets 变化 → `targets/*.json`**、人话变更说明、**风险等级**（低风险=新增目标；高风险=删除目标导致监控断点、告警规则变更导致误报/漏报）；高风险变更在列表与详情中**醒目提示**，是运维确认的重点 | **P0** |
| **草稿列表** | 展示每个网域的变更：**变更单号（主标识，如 `CHG-20260803-003`，用户可读唯一标识，用于沟通与审计追溯）**、变更摘要、状态、风险等级、确认人、**已发布版本**：确认后生成的配置版本号 `cv-xxx` + 「记录」入口直达该变更的发布 / 回滚记录、下发前校验、生成时间；**支持按变更状态筛选**（Segmented：待确认 / 已确认 / 已废弃 / 全部，默认待确认），替代原「待确认 / 历史」二分切换，状态维度清晰且可扩展 | **P0** |
| **按网域组织确认视图** | 变更确认页**按网域组织视图**——页面顶部提供「选择网域」切换器，**仅展示已纳管网域**（未纳管网域不生成配置草稿，不在切换器中出现；仅存在 `default` 单域时默认选中 `default`）；列表展示**当前选中网域的变更单**（单网域上下文，变更单天然归属网域，见 5.1 `ConfigDraft.network_domain_id` 必填），行内保留**下发通道标记**（`local` / `agent_pull`）；确认动作仍为**变更单级**（一次确认 / 废弃整张变更单），与网域切换无关；**确认抽屉标注发布通道**——`local`「确认后立即 reload 生效」、`agent_pull`「发布为配置包，待边缘 Agent 下次心跳拉取生效」；变更检测状态卡同步按选中网域展示 | **P0** |
| **变更详情（抽屉式）** | 列表点击变更行 → **右侧抽屉**打开变更详情：标题=变更单号 + 状态/风险/校验标签 + 人话摘要；抽屉内以**变更清单（详情核心，含影响的配置文件列）**为首，依次为基本信息（已确认变更展示**已发布配置版本** `cv-xxx`）、技术信息（折叠）、配置产物结构、配置文件预览 / Diff（受影响文件高亮）、下发前校验说明；**确认 / 废弃按钮置于抽屉操作区**；已确认 / 已废弃变更提供**「查看发布记录」入口**（跳转下发记录页定位回滚）；**被同域更晚 pending 取代的旧单（superseded）详情页顶部 Alert 提示「已被新变更单取代」（不再提供确认/废弃操作，仅展示）**。**变更摘要 = 列表总览（一句话），变更清单 = 抽屉详情（逐条明细），职责分明** | **P0** |
| **配置预览（受影响文件高亮）** | 多文件只读预览：`prometheus.yml`、`targets/*.json`、`rules.yml`、`blackbox.yml`、`metadata.json`（YAML / JSON 高亮）；**对比当前生效版本自动判定受影响的配置文件，受影响 Tab 加「变更」标记、默认聚焦第一个受影响文件、并提示「本次变更影响 N/M 个配置文件」**，用户优先看到实际变更内容，未受影响文件正常展示（面向需要深入排查的运维） | **P0** |
| **Diff 对比** | 与当前生效版本**按文件**并排 diff（`prometheus.yml` / targets 文件 / `rules.yml` / `blackbox.yml` 逐个文件对比），标红新增/删除/修改项 | **P0** |
| **PromQL 语法校验** | 对生成的 rules 做 PromQL 解析校验（调用 Module_02 或本地校验库） | P1 |
| **人工确认发布（变更单级确认）** | **确认粒度为变更单级（一次确认 / 废弃整张变更单，go/no-go 发布审批）**：变更清单各行仅作影响信息展示，**不逐行确认、不拆分发布**；运维工程师确认后，draft 转为 `ConfigVersion`（继承 `change_no`，分配版本号 `cv-xxx`），进入**待下发**状态；`local` 通道 reload 成功或 `agent_pull` 通道配置包被 Agent 成功应用后，对应 M01 对象的 `change_status` 回写为 `deployed`；**确认动作记录确认人（MVP 阶段预置登录用户上下文，Module_06 用户管理接入后同步为真实用户）** | **P0** |
| **草稿废弃** | 允许人工废弃当前 draft，保持当前生效版本不变；**废弃伴随源数据回写语义（决策 43 系列，详见 §3.5「废弃回写」）**——废弃前前端调 `discard-impact` 获取分类影响并弹窗知情告知，按分类回写：新建未生效 Job 随单回退 `draft`、已生效 Job 修改 MVP 提示+复现、删除/停用型自动恢复；**`change_status` 统一回写、不允许 `pending` 残留**；job 表不引入 rejected/discarded 终态，废弃审计历史由 M09 变更单承载 | P1 |
| **变更检测状态（引导性）** | **定位为引导用户操作的状态说明，不记录检测历史**：有待确认变更 → 提示「检测到 N 个待确认变更，请前往下方列表确认后发布」（含高风险变更数）；无变更 → 提示「当前无待确认变更，策略/资源变更后将自动生成」；**生成失败（决策 42-4）** → 提示「本次变更生成失败：<原因>，请查看日志」；**与待确认列表联动形成操作引导流**（先看状态 → 再逐项确认）。上次检测时间、源数据版本、校验值裁决等技术信息折叠展示，供「确认了却没生效」时排障 | **P0** |

> **变更摘要生成机制**：变更摘要**不是**"策略操作日志"，而是由 configgen 对比**配置产物差异**生成，与既有 pull 模式 / checksum 裁决架构一致、**不依赖 Module_01/07 改造**：
>
> - **数据层 diff**（非 YAML 文本 diff）：targets 为 JSON 数组 → 对比实例地址集合得出"新增/移除实例"；job 骨架为结构化对象列表 → 对比得出"新增/移除采集 job"；规则为结构化对象 → 按 alert 名匹配对比得出"规则新增/修改/移除"；
> - **话术模板**：将结构化变更项套用中文模板生成摘要（如 `新增 ${n} 台服务器（${ip}）加入 ${job} 采集`）；变更项同时产出 `change_items`（类型 / 对象 / 说明 / 风险等级）供确认页结构化展示；
> - **标签模板变更话术对象对齐**：`change_items.target=标签模板` 时，人话摘要示例——「标签模板「主机默认模板」修改映射（os_type→os_type 新增 / app→app 变更），影响引用它的采集任务 job-001 / job-002（共 N 个）」；风险等级建议标 **high**（标签变更穿透到引用 Job 的 target labels，可能改变监控数据归属与告警维度）；标签模板变更与 Module_07 模板页「被引用 Job」提示（Module_07 v2.7）联动，用户在模板页可见"待确认"状态；
> - **精度边界**：若规则阈值（如 80→85）只嵌在 PromQL 字符串中，精确提取需解析 PromQL，可退化为「HighCPUUsage 规则表达式已修改」级别；若规则模型将阈值参数结构化，则可直接生成「阈值由 80 调整为 85」——MVP 建议规则模型结构化阈值（Module_08 协同），原型以 mock 字段演示完整话术。

> **targets 前端数据驱动**：`targets/<job_name>.json` 由 configgen 按 job 名自动生成（固定文件名覆盖写）；前端预览的 targets 子 Tab **动态遍历 `ConfigDraft.targets_files` 数据渲染**，**新增 job 无需前端改动**（三层解耦：文件命名=后端生成、展示=数据驱动、用户入口=Module_01/07 策略配置）。
>
> **targets labels 归属层级（决策 D43，target 级）**：`targets/*.json` 中每个 target 的 `labels` **挂 target 级**（`[{"targets": [...], "labels": {...}}]`），与 Prometheus file_sd 语义 + 资源实例级差异化一致；**Job 级 labels 仅保留系统字段**。`ScrapeJob.label_template_id` 为 Job 级引用，配置生成时按该模板把**每个 target 对应资源属性**转换为 target 级 `labels`（`business_domain → biz`、`tenant_id → tenant` 等业务标签由 M07 LabelTemplate 注入，见 §3.3.1；`instance` 组合标签随地址自动带端口）。标签模板变更 → 命中引用 Job 的 target labels → 触发 `targets/*.json` 重写与变更单（变更对象=标签模板、风险 high）。

> **提示分区规范**：原型 / 产品页面中的提示按受众分三类，避免相互干扰——
>
> 1. **用户 UI 文案**：面向运维工程师，**不含「决策 X」「PRD X.X」等实现层引用**，讲人话（如「本页确认什么」「变更清单（本次变更的影响）」）；
> 2. **产品 / 技术评审说明**：设计决策依据与 PRD 引用**集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区**，默认折叠，用户无感知，产品评审与开发可展开；
> 3. **开发 / AI 注释**：代码注释与 PRD 数据模型 / 技术字段承载实现细节与决策引用，供后续代码开发（含 AI）理解。
>
> 此规范使**用户看到干净的"未来原型雏形"**，同时**开发侧（含 AI）可从代码注释与 PRD 获取完整设计依据**。

> **变更对象 = 源数据对象 + 影响的配置文件**：变更清单的「变更对象」统一为**源数据对象**（用户在 Module_01 / 07 中修改的根源对象），而非配置文件本身——因为 **targets 变化（新增实例）与抓取频率变化（job 骨架）源头都在「采集 Job」功能**，仅看变更对象无法区分影响范围。configgen 在生成 `change_items` 时同时派生**「影响的配置文件」**维度（对比当前生效版本与新草稿的产物差异：仅 targets 变化 → `targets/*.json`；job 骨架 / relabel 变化 → `prometheus.yml`；规则变化 → `rules.yml`；blackbox 模块变化 → `blackbox.yml`；可能多文件同时变化）。确认页以「变更对象（改了什么）+ 影响的配置文件（影响哪个产物）」两列并排呈现，用户无需理解 Prometheus 文件结构即可判断影响。

> **全链路关联**：变更确认与下发记录建立**双向可追溯**关联——`变更单号（CHG-xxx）→ 配置版本（cv-xxx）→ 下发记录（deploy-xxx）`：
>
> - `ConfigVersion` 继承来源 draft 的 `change_no`（确认时写入），用户看到「已确认」即知其发布版本号；
> - `ConfigDeployment` 记录 `source_change_no`（来源变更单号），下发记录页展示该列；
> - 变更确认页：已确认 / 已废弃变更展示**已发布配置版本**并提供**「查看发布记录」**入口（跳转下发记录页）；列表「已发布版本」列提供「记录」快捷入口；
> - 业务出问题时用户路径：从变更确认页按变更单号找到对应**配置版本号** → 进入下发记录页按版本一键**回滚**（回滚中心仍以下发记录页为主，变更页提供入口不重复实现）。

### 3.5 配置下发与分发

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **`local` 通道 Reload** | `channel=local` 网域（含默认 `default`）：确认后由中心将配置产物写中心 Prometheus 配置目录，执行 SIGHUP 或 POST `/-/reload` | **P0** |
| **下发记录** | 记录每次发布与回滚的**来源变更单号（`source_change_no`，自动生成：经 `config_version_id` → `ConfigVersion.change_no` 透传）**、配置版本、目标、操作人、时间、结果、失败原因；部署 ID（`deploy-xxx`）与配置版本号（`cv-xxx`）均为系统自动生成，用户不可手填 | **P0** |
| **变更状态回写 M01** | 配置生成 / 确认 / 下发全链路回写 `ScrapeJob` / `MonitoringRule` 的 `change_status`：生成 `ConfigDraft` 后回写 `pending`；确认后生成 `ConfigVersion` 回写 `confirmed`；`local` 通道 reload 成功或 `agent_pull` 通道配置包被 Edge Agent 成功应用后回写 `deployed`；无相关在途变更回写 `none`（**MVP 起即包含 `deployed`**，决策 31-M2——`ConfigDeployment.status=success` 即回写，消除「已生效 vs 无变更」歧义；v0.2 起 Job、v0.3 起规则精确按对象回写） | **P0** |
| **版本回滚** | 支持选择历史 `ConfigVersion` 重新下发，覆盖当前生效配置（回滚动作本身也生成一条下发记录，状态 rolled_back） | **P0** |
| **`local` 重试下发** | 下发记录页对 `status=failed` 的 **`local` 通道**下发记录提供**「重试」按钮**（决策 42-3）：复用最近一次该版本的下发动作（重新写盘 + reload），生成新的 `ConfigDeployment` 记录；`agent_pull` 通道**不提供重试**（中心不主动触达边缘，拉包/生效由边缘心跳驱动，见 6.1 / 决策 40-2） | **P0** |
| **回滚异步生效提示** | 回滚的生效语义**按下发通道区分**：`local` 通道 = 重新下发后**立即 reload 生效**；**`agent_pull` 通道 = 重新发布历史 `ConfigVersion`（生成对应配置包），生效依赖 Edge Sync Agent 下次心跳拉取（准实时 30s）**；UI 在回滚动作后给出对应提示——`local`「已回滚，配置已 reload 生效」、`agent_pull`「已发布历史版本，待 Edge Sync Agent 下次心跳拉取生效」；生效进度由 `config_sync_status`（out_of_sync → in_sync）表达，采集节点状态列表可见（见 5.2） | **P0** |
| **多目标分发** | 按网域分发到对应 Edge Sync Agent；支持批量选择网域下发 | P1 |
| **配置包拉取接口** | `GET /api/v2/platform/edge/config?network_domain=<id>` | **P0** |
| **配置版本比对** | Edge Sync Agent 上报当前版本，无更新时返回 304 | **P0** |
| **配置包下载** | 返回包含 `prometheus.yml`、`targets/*.json`、`blackbox.yml`、`rules.yml`、`metadata.json` 的压缩包 | **P0** |
| **下发前校验** | 下发前调用 `promtool check config` 校验 `prometheus.yml`；存在 `blackbox.yml` 时调用 blackbox exporter `--config.check` 校验；targets JSON 由生成器侧 schema 校验（见 3.3 / 3.5.1） | **P0** |
| **blackbox 重载** | 配置包更新后，Edge Sync Agent 需触发 blackbox exporter 重载（SIGHUP 或对应 API） | **P0** |

> **下发记录定位**：下发记录是**配置变更执行台账 + 回滚中心**，而非日常高频流水页——每次「配置变更确认」发布到监控，以及每次回滚，均自动留痕（谁 / 何时 / 发布或回滚了哪个 `ConfigVersion` / 结果如何）。价值：
>
> 1. **变更审计（ITIL）**：生产配置发布必须留痕，用于合规审计；
> 2. **故障回溯**：监控出问题时排查「配置最后一次生效时间与结果」；
> 3. **回滚支撑**：回滚的前提是知道「发过哪些版本、发到哪个目标」，下发记录即回滚的目标选择依据；回滚 = 选择历史 `ConfigVersion` 重新下发，回滚动作本身也是一条下发记录（rolled_back）——类比 K8s rollout history / Git revert。
>
> **与 Module_06 全局审计的边界**：下发记录（`ConfigDeployment`）是 Module_09 的**领域业务对象**（有状态机 pending/success/failed/rolled_back、可操作回滚、含配置版本/目标/校验等结构化字段），承担**领域审计**（每个网域发过什么版本、结果如何）；Module_06 的**全局审计日志**是平台级横切操作留痕（actor/action/resource/time，P2，请求级事件由 Module_03 收集）。两者**联动不重复**：下发/回滚动作可同时写入一条全局审计日志，但领域数据不迁移、互不替代。

> **reload 策略分离（targets vs 结构）**：targets 变化（增删实例、标签变更）时，仅原子重写对应 `targets/*.json` 文件（临时文件 + rename，避免采集器读到半写文件），**不触发**采集器主配置 reload——file_sd 由采集器磁盘监听 / 轮询自动感知并应用；仅当 `prometheus.yml` 结构（job 骨架、external_labels、remote_write、relabel 等）变化时才触发 reload。
>
> **废弃回写语义（决策 43-1~43-7，MVP 落地）**：变更单**废弃（discard）不是「数据不动只废单」**——full-render 模型下废弃不处理源数据必然导致鬼影复现（下一轮轮询因「源版本 > 基线」重新生成内容相同的变更单）。废弃必须伴随源数据分类回写，规则：
>
> - **分类判定**：废弃前由后端 `discard-impact` 计算影响分类，前端弹窗**分类知情告知**后再确认（`new_reverted` 新建未生效 / `modified_kept` 已生效修改 / `deleted_restored` 删除停用 / `missing` 未命中）；
> - **新建未生效 Job（new_reverted）**：随单回退 `draft`（撤回「提交生效」，等待下次提交）；
> - **已生效 Job 修改（modified_kept）**：MVP 选 **「提示 + 复现」**（2a）——提示「修改将不生效、随复现变更单再次进入确认」，并说明 `deployed_snapshot` + 「随单回滚」备注至 **v0.3**；
> - **删除 / 停用型（deleted_restored）**：自动恢复（删除恢复启用 / 停用恢复启用）；
> - **`change_status` 统一回写**：不允许 `pending` 残留（废弃即清除，防假锁）；job 表**不引入 rejected/discarded 终态**，废弃审计历史由 M09 变更单承载；废弃后下一轮轮询因「源版本=基线」不再复现空单。
> - **规则侧回写**：规则 `change_status` 与采集 Job 同口径——确认下发后回写 `deployed`（决策 31-M2 / issue #18），废弃场景的规则回滚登记待 v0.3（`deployed_snapshot`）。

#### 3.5.1 下发前校验与 blackbox 重载说明

- 配置包生成后、下发或允许拉取前，必须先通过校验：
 - `promtool check config <prometheus.yml>` 确保 `prometheus.yml` 语法与引用合法；
 - `blackbox_exporter --config.check --config.file=<blackbox.yml>` 确保 `blackbox.yml` 模块定义合法；
 - **configgen 侧 targets schema 校验**：配置生成服务生成 targets JSON 时校验文件结构（JSON 顶层数组、`targets` / `labels` 字段）、`host:port` 地址格式与 labels 合法性（遵循标签命名规则，禁止覆盖 `__address__` 等内置标签），不通过则拒绝生成草稿。
- **promtool 校验缺口说明**：`promtool check config` 对 `file_sd_configs` 只检查文件**存在性**（文件缺失仅 WARNING），**不校验 SD 文件内容**（社区已知缺口）；该缺口由 configgen 侧的 targets schema 校验弥补（上一条）。
- 校验失败时，当前 `ConfigDraft` 保持原状态（`validation_status=failed`），不进入下发流程，并记录错误原因；「变更确认」页该变更单展示失败态与失败原因，并提供**两个闭环出口（决策 42-2）**：
 - **重新校验**：对该草稿重新执行中心内容校验（仅重校、不重生成源内容），适用于"源数据未变但校验结果因环境/工具升级变化"的自愈；重新校验通过后恢复为可确认 `passed`；
 - **废弃**：明确「校验未通过，本次变更将保持当前生效配置不变」，将该草稿置 `discarded`。
 - 二者均为**变更单级**操作，避免 failed 草稿永久卡死在「待确认」列表、挡住后续发布（对应 6.6.2 校验失败相关接口）。
- `ValidationStatus` 状态含义（决策 45-1 三态操作出口）：`passed`（**可确认下发**）/ `failed`（阻止确认，提供「重新校验 + 废弃」出口）/ `pending`（未校验或生成中——**同样禁止确认下发**，提供「重新校验 + 废弃」出口，promtool/blackbox 暂不可用属「待环境就绪」而非失败，以 warning 提示）；**操作区判定为「仅 `validation_status=passed` 可确认发布」**，`failed`/`pending` 均不可确认。
- **校验失败归因（决策 45-3，对齐原型 v1.39）**：`ConfigDraft` 持久化 `validation_cause`（`user_config` = 用户配置问题，可修复，提供「重新校验 + 前往修改」/ `platform_fault` = 平台技术故障，**同样提供手动「重新校验」自愈出口**）与 `validation_details`（`[{file, line, message}]` 结构化定位，前端行内 Popover 定位并跳转 Module_01 修改源数据）；（MVP 归因判定：targets schema 类失败归 `user_config`，promtool/blackbox 不可用归 `platform_fault`）。校验信息 Alert 按状态分色——`failed`→error、`pending`→warning。
- **校验分层定位**：以上校验均为**中心内容校验**（防**生成错误**），与之对应的是 Edge Sync Agent 拉包后的**边缘传输校验**（防**传输损坏/篡改/半写文件**）；中心内容校验与边缘传输校验的分层关系与衔接见 [[6.5](#65-中心边缘校验分层与衔接)。
- Edge Sync Agent 解压配置包后，需同步通知同域 blackbox exporter 重新加载 `blackbox.yml`（推荐 `SIGHUP`；如 blackbox exporter 提供 reload API，也可调用 API）；采集器（vmagent / prometheus-agent）仅当 `prometheus.yml` 结构变化时才需 reload，targets 文件变化由 file_sd 自动感知（见 3.5 reload 策略分离）。

### 3.6 本地手工兜底声明

平台**只保证通过 UI 下发并成功 reload 的配置与数据库期望态一致**。允许运维工程师在紧急情况下直接修改本地磁盘上的 `prometheus.yml` 或 Edge Agent 配置文件进行手工兜底；平台不会自动强制 reconcile 本地修改。

- 本地手工修改后，UI 展示的配置版本可能高于实际生效版本，配置同步状态显示为 `out_of_sync` 或 `manual_override`。
- UI 统一将 `manual_override` 展示为**「人工覆盖」**（决策 41-4），原型与 PRD 不再混用「手工覆盖 / 手动覆盖」叫法。
- 运维工程师需自行在 UI 重新确认并下发，以恢复平台一致性。
- 该策略用于防止平台自身 bug 导致监控系统整体不可用。

### 3.7 安全与证书

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **mTLS 证书下发** | 为 Edge Agent 签发客户端证书 | P2 |
| **证书自动轮转** | 证书到期前自动更新，Edge Sync Agent 热加载 | P2 |
| **Token 轮换** | 支持重置 Token 并强制 Edge Agent 重新认证 | P2 |

### 3.8 采集节点状态列表与边缘诊断看板

政务网/专网最常发生网络抖动或防火墙封堵，必须提供诊断能力。MVP 阶段以**采集节点状态列表页**满足基本可观测需求，图表/趋势类看板延后至 P1/P2。

#### 3.8.1 MVP：采集节点状态列表页（节点平铺表 + 组件详情抽屉）

> **结构变更**：原「网域聚合 + 展开行组件子表」结构导致筛选器无法联动覆盖子表列，且用户心智的「采集节点」是物理安装单元（一台机器上的进程组）而非逻辑网域。现改为**节点平铺表 + 组件详情抽屉**，彻底解决筛选问题并让三个进程的关系在 UI 上自解释。

页面采用**节点平铺表**结构，主对象为**采集节点**（用户心智单元：在哪个机器上装了什么东西），一行一个节点；**仅展示部署了 Edge Agent 的网域**——`channel=local` 的网域由中心直接采集、不部署 Edge Agent，不产生 `EdgeAgent` 实例，故不出现在本页；**「采集节点状态」子菜单常驻**，无 `EdgeAgent` 实例时进入**空态引导页**（提示用户先完成网域纳管并按指引接入 Edge Sync Agent）。

**页面顶部组件关系说明横幅**：采用**可关闭 Alert 横幅**，默认展示，用户关闭后记住选择（`localStorage`），下次进入本页不再自动展开。文案：「一次安装 = 三个进程：Edge Sync Agent（管理进程）+ 采集器 vmagent（采集指标）+ 拨测器 blackbox（可选）。Edge Sync Agent 负责拉取配置并守护另外两个进程，某个进程异常会被自动重启并在此处展示。」

**筛选**：支持**网域、整体状态、采集器状态、拨测器状态、配置同步**五维筛选——所有筛选器均作用于平铺列，不存在嵌套子表导致的筛选失效问题；网域下拉仅列出存在 `EdgeAgent` 实例的网域；统计卡随筛选联动。

**平铺表列**

| 字段 | 说明 |
|------|------|
| 节点 | 主机名 / IP（两行合并） |
| 网域 | 网域名称 + 下发通道 Tag（`agent_pull`） |
| 整体状态 | 聚合三档：**正常**（所有组件正常，绿）、**部分异常**（必装组件异常，黄，如采集器 stopped）、**离线**（Agent 离线，红）；规则：Agent 离线→离线；必装组件异常→部分异常；**「部分异常」节点行级高亮**（浅红背景 + 左侧红边，决策 41-2） |
| Edge Sync Agent 状态 | online / offline（管理进程：心跳 / 配置拉取 / 守护采集器与拨测器；与抽屉组件分区一一对应，决策 41-3） |
| 采集器状态 | running / stopped / unknown；vmagent 或 prometheus-agent |
| 拨测器状态 | running / stopped / not_deployed / unknown；未部署表示该网域无 `job_type=blackbox` 的 ScrapeJob |
| 配置同步 | 五档状态 + 按成因分档标签与引导按钮（见 3.2 配置同步状态与引导，决策 41-1）；未下发配置（`no_version`）→「去配置采集 Job」；未同步（`out_of_sync`）按 `out_of_sync_cause` 区分：*`pending_draft`*→标签「待确认变更」+「前往配置确认」、*`pull_pending`*→标签「生效中」+纯展示等待 +「查看下发记录」、*`local_reset`*→标签「本地校验失败」+「立即同步」 |
| WAL 积压 | 该节点 WAL 积压字节数 |
| 最后心跳 | 最近一次心跳时间 |

**组件详情抽屉（替代展开行）**：点击行或「查看」按钮打开右侧 Drawer，展示：
- 组件关系说明：「Agent 是管理进程，负责拉取配置和守护另外两个进程。某个进程异常会被自动重启并在此处展示。」
- 节点基本信息：主机名、IP、网域、Agent 版本、整体状态、最后心跳、WAL 积压
- **组件列表按组件类型分区展示**（不再使用 Table 子表）：三个进程（Edge Sync Agent / vmagent / blackbox exporter）各占一个独立分区，每块展示——组件类型 Tag（附 Tooltip 描述其职责）、状态 Tag、**实例名（截断 + Tooltip 悬停看全）**、版本、配置版本；**「最近错误」分层展示**——抽屉内**仅显示最近一条错误的一句话摘要（截断约 80 字符）+ 时间**，旁边附带「查看错误详情」按钮；点击按钮用 **Modal 弹窗**（而非嵌套 Drawer）展示完整错误文本（等宽字体、可复制）、发生时间、所属组件、关联配置版本。组件清单由 Edge Sync Agent 心跳附带上报（PRD 5.3）。
- **进程维修提示**：MVP 阶段中心不主动入站控制边缘进程；若 Edge Sync Agent 自动重启采集器 / 拨测器进程后仍持续异常，抽屉内「最近错误」展示失败摘要，并提示运维人员到边缘节点通过 systemd 重启服务或按「网域纳管」安装指引重装离线包。中心侧远程重启进程按钮（`force_restart` 指令通道）留 v0.2+ 评审。
- **进程异常高危提示（决策 41-2）**：整体状态为「部分异常」的节点，详情抽屉顶部渲染红色 Alert 横幅「监控采集中断，需立即处理」——说明影响（指标停止采集与回传、相关告警与看板失效）、强调**与配置同步无关**（配置仍显示「已同步」）、平台无法远程修复；处理方式为登录边缘节点用 systemd 重启服务或按「网域纳管」安装指引重装离线包。该提示独立于配置同步状态，避免用户误将进程健康问题当作配置问题处理（错误点击「立即同步」）。

#### 3.8.2 P1/P2：边缘诊断看板（图表/趋势）

| 诊断指标 | 说明 | 优先级 |
|----------|------|--------|
| **心跳 RTT 趋势** | 边缘 Agent 到中心的网络延迟趋势图 | P1 |
| **WAL 积压趋势** | 本地磁盘未发送数据大小趋势图 | P1 |
| **Remote Write 队列状态** | 发送速率、失败重试次数、当前队列长度 | P1 |
| **最近错误列表** | 最近 N 条配置拉取或 Remote Write 错误 | P1 |
| **24h 断网时长统计** | 最近 24 小时累计断网时长 | P2 |
| **详细诊断仪表板** | 综合图表视图，支持按网域/时间范围下钻 | P2 |

### 3.9 边缘 Agent 交付方式

政务网/金融专网通常禁止 `curl | bash` 一键脚本，提供多种交付方式：

| 交付方式 | 适用场景 | 安全等级 | 优先级 |
|----------|----------|----------|--------|
| **离线二进制包 + systemd 服务文件** | 物理隔离政务网 | 高 | **P0** |
| **Docker / Docker Compose** | 有容器 runtime 的环境 | 高 | P1 |
| **RPM / DEB 安装包** | 标准化大规模部署 | 高 | P2 |
| **Helm Chart** | Kubernetes 环境 | 高 | P2 |

> **不提供** `curl | bash` 一键部署脚本。所有交付物均提供校验和与签名验证说明。
>
> **离线二进制包补充说明**：当网域存在 blackbox 拨测 Job 时，离线二进制包必须同时包含 blackbox exporter 二进制；安装脚本/文档中需提供 capability 设置示例（如 `setcap cap_net_raw+ep ./blackbox_exporter`），并在 systemd 单元中声明 blackbox exporter 为采集器（vmagent / prometheus-agent）的启动依赖，确保采集器启动前 blackbox exporter 已监听 `127.0.0.1:9115`。
>
> **Edge Sync Agent 部署定位**：Edge Sync Agent 是**部署在边缘监控代理节点的独立客户端程序**，**非中心平台内置进程**；与中心通过 **outbound HTTPS 443 + 每网域 Token** 通信（心跳 / 配置拉取 / remote_write 全部由边缘主动出站，中心无入站端口，无需开放防火墙入站规则）。部署场景有两类：
> - **隔离网域 / 多网域**：每个边缘节点部署一个 Edge Sync Agent；
> - **单网域分布式采集**：同一网域内无网络隔离时，也可能因规模分片、HA、blackbox 多探测点等场景在多个远端节点部署 Edge Sync Agent；MVP 不支持该场景（网域固定单通道、单逻辑采集组），届时与节点级通道一并评审。
>
> MVP 最小化单网域部署：`default` 域固定 `local` 通道，由中心 Prometheus 直接采集、无需部署 Edge Sync Agent。
>
> **边缘节点组件构成**：边缘监控代理节点由三部分构成——
>
> - **Edge Sync Agent（必装独立组件）**：部署在边缘节点的客户端程序，**非中心平台内置**；负责与中心通信（outbound HTTPS 443 + 每网域 Token 的心跳 / 配置拉取）、控制本地采集器 reload（PRD 3.9 交付方式 / 6.x 协议）；
> - **采集器（vmagent 或 prometheus-agent，二选一）**：由 `NetworkDomain.agent_type` 登记；负责抓取与 remote_write，由 Edge Sync Agent 控制；
> - **blackbox exporter（可选）**：网域存在 `job_type=blackbox` 的 ScrapeJob 时随离线包附带（见上）。
>
> **一体化交付 + 职责边界**：离线二进制包为**一体化包**（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），一次安装即完成边缘监控代理节点全部组件部署，**无需手动分别安装**采集器/blackbox。安装后由 Edge Sync Agent 自动部署并管理**本节点**采集器与 blackbox exporter 进程：随包安装、启动守护、健康检查、配置包更新时 reload、进程异常自动重启，采集器版本与运行状态纳入心跳上报与 采集节点状态展示（见 3.2 采集器进程管理）；启动顺序为 **blackbox exporter → 采集器**（与上述 systemd 启动依赖声明一致）。
>
> **组件清单随心跳上报**：Edge Sync Agent 心跳**附带上报本节点组件清单**（组件类型 / 版本 / 运行状态 / 配置版本 / 最近错误，见 [[5.3](#53-心跳上报edgeheartbeat)），平台据此在「采集节点状态」页按组件类型分类展示，见 3.2 / 3.8.1）；采集器与拨测器组件状态异常（stopped / 错误）可直接定位到具体组件，无需展开整个节点排查。
>
> **职责边界**：Edge Sync Agent 只管理**本节点**组件生命周期，**不做**下游节点 exporter 安装（目标主机 node-exporter 等由 Module_01 的 Exporter 安装流程负责，本轮因安全边界暂不纳入 Agent 管理范围）；**不做**指标抓取（采集器职责）；**不做**告警求值（MVP~v0.3 中心统一求值，v0.4+ 边缘自治由 vmalert 负责）。
>
> **登记语义**：网域在 M09 纳管时登记的 `agent_type` 是**采集器类型**（`vmagent` / `prometheus-agent`），Edge Sync Agent 为**必装组件、无需登记**；`EdgeAgent` 实例即代表「Edge Sync Agent + 采集器」组合（见 [[5.2](#52-边缘-agentedgeagent)）。

### 3.10 WAL 与 Remote Write 参数（按网域配置）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `wal.max_size` | 20GB | 本地 WAL 最大磁盘占用 |
| `wal.min_backfill_age` | 1h | 只回传最近 1 小时内数据，避免历史风暴 |
| `remote_write.queue.max_samples_per_send` | 2000 | 每批次发送样本数 |
| `remote_write.queue.max_shards` | 50 | 并发发送分片数 |
| `remote_write.queue.retry_on_rate_limit` | true | 触发限流时自动退避重试 |
| `remote_write.compression` | snappy | 传输压缩算法 |

### 3.11 网域能力开关与下发通道

MetricCenter 通过 [Module_06](Module_06_Multi_Tenant.md) 的**租户级行政开关** `Tenant.multi_site_enabled` 控制该租户是否允许创建多个 `NetworkDomain`，以兼顾单机简单场景与政务网/专网多隔离域场景。该开关**不是 UI 顶栏的运行时切换器**，module-09 内部不存在全局「单/多网域模式」切换控件；页面入口与字段展示由数据驱动。

| 能力 | 开启条件 | 用户感知 | 数据模型 |
|---|---|---|---|
| **单网域能力（默认）** | `Tenant.multi_site_enabled=false` | 系统预置并默认展示 `default` 网域；无法创建额外网域 | 仅存在 `default` 网域 |
| **多网域能力** | `Tenant.multi_site_enabled=true` | 可在 M06 创建多个网域，并在 M09 逐个完成监控纳管；「网域纳管」页面常驻、「采集节点状态」子菜单常驻（无 EdgeAgent 实例时进入空态引导） | 多网域，每个网域按类型确定下发通道（见下） |

#### 下发通道（`channel`）

通道绑定到**采集节点位置**而非网域类型：

| 通道 | 含义 | MVP 适用网域 | 配置产物形态 | 下发 / 校验机制 |
|---|---|---|---|---|
| `local` | 采集器与中心同机/同 Pod，中心可直接写盘并 reload | `default` 管理域（固定） | **本地文件集**：`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml` | 直接写中心 Prometheus 配置目录，确认后 SIGHUP / `POST /-/reload`；**无 zip、无 metadata.json 下载校验**（版本一致性由 `ConfigVersion` 记录保证） |
| `agent_pull` | 采集器位于中心无法直接触及的远端节点（隔离网域等） | 非 `default` 网域（固定） | **zip 配置包**（含 `metadata.json`） | 由 Edge Sync Agent 心跳拉取，拉取后按 `metadata.json` 中的 checksum 做完整性校验 |

- **MVP 边界**：一个网域同一时刻只有一种下发通道、对应一个逻辑采集组；`channel` 由网域确定（`default` 固定 `local`，其他网域固定 `agent_pull`），**不提供通道切换入口**；不支持同一网域内混合通道（`local` 与 `agent_pull` 并存）。
- **v0.4+ 演化**：同一网域内多采集节点（vmagent 分片、HA、blackbox 多探测点）、混合通道、`local` ↔ `agent_pull` 通道切换届时一并评审；影响面（M09 下发粒度细化到节点、M01 Job 分片/绑定、external_labels 节点标签、通道切换历史版本处理）已记录于 design-decisions的「v0.4+ 演化影响备忘」。

#### 入口与字段展示规则

- **网域纳管**：始终展示 `default` 网域及本租户下所有已授权网域，与 `multi_site_enabled` 无关。
- **采集节点状态**：不依赖「多网域能力」开关；子菜单常驻，当系统中存在至少一个 `EdgeAgent` 实例时展示列表页，否则进入空态引导页（提示用户先完成网域纳管并按指引接入 Edge Sync Agent）。
- **Token / 安装指引 / 运行态字段**：仅对 `channel=agent_pull` 网域展示；`channel=local` 网域不生成 Token、不提供安装指引、不展示最后心跳等运行态字段。
- **配置变更确认**：按网域组织视图，网域切换器列出所有已纳管网域；行内标注 `local` / `agent_pull` 通道及对应的生效提示。

#### 多网域能力与数据兼容

- 开启 `multi_site_enabled` 后：已有资源与配置保持归属 `default` 网域，用户可继续在 `default` 网域下管理中心 Prometheus 采集（`local` 通道），或逐步迁移到新网域（通常 `agent_pull` 通道）。
- 关闭 `multi_site_enabled` 后：系统仅展示 `default` 网域数据，其他网域数据不删除但隐藏；再次开启后恢复显示。
- `default` 网域类型为 `management`（管理域），**禁止删除**；允许用户修改其 `name` 和 `description` 以与云区域命名保持一致。其他网域类型默认为 `edge`（边缘域）。
- **default 管理域不产生 EdgeAgent 实例**：`default` 固定走 `local` 通道、由中心 Prometheus 直接采集，不存在 `network_domain_id='default'` 的 `EdgeAgent` 实例，不出现在「采集节点状态」页；MVP 不支持将 `default` 切换为 `agent_pull`。

---

## 4. 核心流程

### 4.1 轮询生成流程

```text
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐
│ Module_01   │     │ Module_07   │     │ Module_09 配置中心       │
│ ScrapeJobs  │     │ Resources   │     │                         │
│ Rules       │     │ LabelTemplates│    │ 1. 定时轮询              │
└──────┬──────┘     └──────┬──────┘     │ 2. 生成 ConfigDraft      │
       │                   │            │ 3. 人工确认              │
       └─────────┬─────────┘            │ 4. 生成 ConfigVersion    │
                 │                      │ 5. 下发 / Reload         │
                 ▼                      └────────────┬────────────┘
       ┌─────────────────────┐                       │
       │ 按 network_domain   │                       ▼
       │ 生成 prometheus.yml │         ┌─────────────────────────┐
       │ / targets / rules   │         │ 中心 Prometheus /       │
       │ .yml                │         │ Edge Sync Agent         │
       └─────────────────────┘         └─────────────────────────┘
```

### 4.2 确认与下发时序

> 以下为**变更检测与配置生成全链路时序**。除「人工确认」外，整条链路均为 **Module_09 异步轮询链路**（默认 30s 周期）；**人工确认是唯一同步环节**。

```text
┌───────────────────┐  写库并维护 updated_at   ┌────────────────────────────────────────────┐
│  Module_01 / 07   │ ──────────────────────▶  │  Module_09 异步轮询链路（默认 30s）          │
│ · ScrapeJobs      │  不主动通知 Module_09     │                                            │
│ · Rules           │                          │ ① 定时轮询                                  │
│ · Resources       │                          │    聚合各源表 max(updated_at)               │
│ · LabelTemplates  │                          │    计算「源数据版本」                        │
│ · ...            │                          │ ② 源数据版本聚合预筛（决定要不要算）           │
└───────────────────┘                          │    · 版本无变化 → 跳过本轮，等待下一周期      │
                                               │    · 版本有变化 → 进入生成                    │
                                               │ ③ 按网域生成配置                             │
                                               │    prometheus.yml / targets/*.json /         │
                                               │    rules.yml / blackbox.yml（按需）          │
                                               │ ④ 联合 checksum 裁决（决定要不要确认）        │
                                               │    · 与生效 ConfigVersion 一致                │
                                               │      → 丢弃，不产生新草稿（仅更新版本记录）    │
                                               │    · 不一致                                   │
                                               │      → 生成 status=pending 的 ConfigDraft     │
                                               │ ⑤ 草稿进入确认列表（异步链路结束，等待确认）   │
                                               └──────────────────────┬───────────────────────┘
                                                                      │ ⑥ 人工确认（唯一同步环节）
                                                                      │    UI 预览 / diff → confirmed
                                                                      ▼
                                               ┌────────────────────────────────────────────┐
                                               │ ⑦ 生成 ConfigVersion                        │
                                               │ ⑧ 下发                                      │
                                               │    · local 通道：SIGHUP / POST /-/reload
                                               │    · agent_pull 通道：Edge Sync Agent 心跳拉取配置包   │
                                               │ ⑨ 写入 ConfigDeployment 下发记录              │
                                               └────────────────────────────────────────────┘
```

1. **轮询触发**：配置中心定时（默认 30s）读取 Module_01 与 Module_07 的数据；先聚合各源表 `max(updated_at)` 为「源数据版本」，仅当源数据版本变化时才进入生成（详见 [3.3.3](#333-变更检测与草稿去重说明)）。
2. **草稿生成**：按网域聚合 ScrapeJobs、Rules、Resources、LabelTemplates，生成 `ConfigDraft`。
3. **差异检测**：计算草稿内容的联合 checksum，与当前生效 `ConfigVersion` 对比；一致则草稿标记 `discarded` 或丢弃（无实际变化），不一致则保持 `pending` 进入确认。
4. **人工确认**：运维在 UI 预览 draft，查看 diff，确认后 draft 状态变为 `confirmed`，并生成新的 `ConfigVersion`。
5. **下发执行**：
 - `local` 通道：将配置产物写中心 Prometheus 配置目录，调用 `POST /-/reload` 或发送 `SIGHUP`；
 - `agent_pull` 通道：Edge Sync Agent 下次心跳检测到 `config_changed=true` 后拉取配置包。
6. **下发记录**：写入 `ConfigDeployment`，记录成功/失败状态。
7. **校验分层**：中心内容校验（下发前，见 [3.5.1](#351-下发前校验与-blackbox-重载说明)）与边缘传输校验（Agent 拉包后，见 [[6.4](#64-edge-sync-agent-本地行为)）由同一份配置产物（ConfigVersion / zip 包）衔接，分层关系见 [[6.5](#65-中心边缘校验分层与衔接)。

---

## 5. 数据模型

### 5.1 网域（NetworkDomain）

> **职责边界**：`NetworkDomain` 数据模型由 **Module_06（行政 Owner）** 与 **Module_09（监控纳管 Owner）** 共同维护；**NetworkDomain 行政模型以 [Module_06](Module_06_Multi_Tenant.md) 为单一事实来源**——本模块不再重复声明行政字段表与行政约束（ID 规则、租户归属与跨租户共享等），下表仅列出本模块持有 / 纳管涉及的字段：
> >
> > - **M06 维护行政字段**：`id`、`name`、`description`、`domain_type`、`tenant_id`、`authorized_tenant_ids`、配额与启用状态；网域创建/编辑/禁用/租户分配在 M06 完成（字段表与约束语义见 [Module_06 5.1](Module_06_Multi_Tenant.md)）。
> > - **M09 维护监控纳管字段**：**`channel`**、`agent_type`、`remote_write_url`、`token`、运行态字段（`status` / `last_heartbeat` / `agent_version`）及关联的 `EdgeAgent` 实例；网域监控纳管、配置生成、下发、Agent 生命周期在 M09 完成。`channel` 决定哪些字段必填/展示。
> >
> > M09 不创建新的 `NetworkDomain` 行政记录，只把 M06 已存在的网域标记为「已纳管监控」。
> >
> > **网域地位**：NetworkDomain 是**逻辑操作上下文 + 采集边界**，MVP 阶段一个网域对应一个逻辑采集组；网域不是控制面层级，不构成独立管理面或独立控制面。

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 网域 ID | 网域唯一标识，必须全局唯一；ID 规则（含前缀约定）由 [Module_06](Module_06_Multi_Tenant.md) 统一定义，本模块只读引用 |
| name | string | ✅ | 网域名称 | 网域展示名；`default` 网域的 `name` / `description` 允许修改以匹配客户云区域命名 |
| description | string | ❌ | 描述 | 网域描述 |
| domain_type | enum | ✅ | 域类型 | 网域类型：`management`（管理域，如 `default`）/ `edge`（边缘域）；`management` 类型网域禁止删除 |
| zone_type | string | ❌ | 网络区域类型 | 网络隔离/位置语义分类，**M06 行政字段**（创建/编辑网域时登记，M09 纳管只读引用）；值集为部署级字典（政务云预置 `internet` 互联网区 / `extranet` 政务外网区等，公有云预置 region 列表），见 [Module_06 3.1](Module_06_Multi_Tenant.md)；配置生成时注入指标标签 |
| tenant_id | string | ✅ | 租户 | M06 行政字段（登记归属），本模块只读引用；租户归属 / 跨租户共享约束见 [Module_06 5.1](Module_06_Multi_Tenant.md) |
| cmdb_cloud_area_id | string | ❌ | 仅技术信息 | 对应 BlueKing CMDB 云区域 ID（`bk_cloud_id`） |
| cmdb_cloud_area_path | string | ❌ | 仅技术信息 | 对应 BlueKing CMDB 云区域路径 |
| **channel** | **enum** | **✅** | **下发通道** | **配置下发通道：`local`（中心同机写盘 reload）/ `agent_pull`（Edge Sync Agent 心跳拉包）；MVP 按网域固定（`default` 域 = `local`，其他网域 = `agent_pull`），不提供切换；同一网域混合通道与通道切换为 v0.4+ 演化场景** |
| token | string | ✅/❌ | 认证 Token（脱敏） | `channel=agent_pull` 时必填；Edge Sync Agent 拉取配置时的认证 Token。`channel=local` 时为空且不展示 |
| agent_type | enum | ✅/❌ | Agent 类型 | `channel=agent_pull` 时必填；边缘采集器类型：**MVP 阶段固定 `vmagent`**（纳管时无需选择）；`prometheus-agent` 保留枚举、**v0.2+ 开放**为可选。`channel=local` 时为空 |
| center_endpoint | string | ❌/✅ | 中心接入地址 | **该网域视角的中心可达地址**（如 `https://10.8.0.5:8443`，网闸/防火墙地址映射后的地址）；`channel=agent_pull` 时**必填**，由运维按该区网闸策略填写；用于合成心跳响应中的配置包绝对下载地址（见 6.2）；`channel=local` 时为空 |
| remote_write_url | string | ✅/❌ | 回传地址 | `channel=agent_pull` 时必填；该网域 Agent Remote Write 目标地址；语义为**该网域视角的可达地址**（网闸映射后地址），非中心自认地址。`channel=local` 时为空 |
| status | enum | ✅/❌ | 状态 | `channel=agent_pull` 时必填；online / offline / unknown（运行态字段，由心跳上报更新）。`channel=local` 时为空 |
| last_heartbeat | datetime | ❌ | 最后心跳 | `channel=agent_pull` 时由心跳上报更新；`channel=local` 时为空 |
| agent_version | string | ❌ | Agent 版本 | `channel=agent_pull` 时由心跳上报更新；`channel=local` 时为空 |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |
| updated_at | datetime | ✅ | 仅技术信息 | 更新时间 |

> **MVP 处理**：系统初始化时自动创建一个 `id=default`、`domain_type=management`、**`channel=local`** 的默认网域；**M09 不做「未指定网域资源自动归 default」的隐式归集**（决策 31-M3）——资源 `network_domain_id` 由 [Module_07](Module_07_Monitoring_Object_Management.md) 在导入校验强制必填（缺失即拒绝，避免掩盖导入漏填）；仅用户显式选择 `default` 网域的资源才归入默认网域。默认网域 `default` 的登记归属为 `platform_admin` 租户（行政语义见 Module_06）。`default` 网域的 `name` / `description` 允许用户修改以匹配云区域命名，但禁止删除；`channel` 固定 `local`，切换能力预留至 v0.4+。
>
> **行政约束以 M06 为单一事实来源**：网域租户归属 / 跨租户共享约束、`network_domain_id` 全局唯一与前缀规则均由 [Module_06](Module_06_Multi_Tenant.md) 定义并强制校验（决策 18~20），本模块不再重复声明；M09 仅校验「纳管」相关约束（如 `channel` 决定字段必填/展示）。
>
> **网域与业务正交（2026-08-19 决策）**：网域（由网络环境决定，登记制、低频变更）与业务（由组织管理需求决定、持续演进）是**两个正交维度**——每个资源有且仅有 1 个网域归属（`network_domain_id`）+ 1 个业务归属（`business_domain`，由 [Module_07](Module_07_Monitoring_Object_Management.md) 维护）。本模块配置生成**不把业务作为网域属性**：一个网域可承载多个业务的资源（多业务共用 1 网域为正常状态），一个业务也可跨多个网域；业务通过 `biz` 标签（M07 LabelTemplate 注入，见 3.3）与 `network_domain` 组合过滤与聚合。业务归属变更（资源换业务）只触发 `targets/*.json` 原子重写，不影响 `prometheus.yml` 骨架 / `rules.yml`（见 3.3.2）。
>
> **标签注入边界（2026-08-19 决策）**：本模块 `external_labels` 只注入**部署级、物理维度的不可变元数据**（`network_domain_id`、`zone_type`、`replica`），**不注入租户 / 业务标签**。租户标签 `tenant`（`tenant_id → tenant`）与实例级业务标签 `biz`（`business_domain → biz`）均由 [Module_07](Module_07_Monitoring_Object_Management.md) LabelTemplate 以 **target 级**注入 `targets/*.json` 的 `static_configs[].labels`，M09 不单独注入；MVP 单租户下 `tenant` 映射可选、不强制注入，租户数据隔离优先在查询网关层通过 PromQL 注入实现。
>
> **配置目录组织（MVP）**：配置产物**按 `network_domain` 分目录**组织（`edge-config-<network_domain_id>.zip` / 本地文件集，见 6.3）。**多租户命名空间（按 tenant + network_domain 分目录）为 {v0.2+} 占位**——原则：配置只随物理网域 / 采集目标变化而重新生成与下发，不因租户数量复制采集基础设施；详细目录 / 命名空间规则随多租户版本再定，MVP 不展开、不实现。

### 5.2 边缘 Agent（EdgeAgent）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|----------|------|
| id | string | 仅技术信息 | 唯一标识 |
| network_domain_id | string | 网域 | 所属网域 ID |
| agent_type | enum | Agent 类型 | `vmagent` / `prometheus-agent` |
| version | string | Agent 版本 | Agent 版本 |
| hostname | string | 部署主机名 | 部署主机名（可选） |
| status | enum | 状态 | online / offline / unknown（运行态字段） |
| last_heartbeat | datetime | 最后心跳 | 最后心跳时间（运行态字段） |
| heartbeat_rtt_ms | int | 心跳延迟 | 心跳往返延迟（毫秒） |
| last_config_pull | datetime | 最后拉取配置 | 最后配置拉取时间 |
| config_version | string | 配置版本 | 当前生效配置版本 |
| config_sync_status | enum | 配置同步 | `in_sync` / `out_of_sync` / `unknown` / `manual_override` / `no_version`（未下发配置：Agent 已上线但网域尚无成功下发过的 `ConfigVersion`） |
| out_of_sync_cause | enum | 未同步成因 | 仅当 `config_sync_status=out_of_sync` 时有值；三成因引导：`pending_draft`=中心存在待确认变更草稿 / `pull_pending`=无待确认变更、Agent 拉包/生效延迟 / `local_reset`=本地环境/地址变化、checksum 校验失败保留旧配置等；决定「立即同步」是否展示 |
| wal_backlog_bytes | int | WAL 积压 | WAL 积压字节数 |
| remote_write_url | string | 回传地址 | Remote Write 目标地址 |
| last_error | string | 最近错误 | 最近错误信息 |
| components | json | 组件清单 | 本节点组件清单：组件类型 / 名称 / 运行状态 / 版本 / 配置版本 / 最近错误（由心跳附带上报，PRD 5.3）；采集节点状态页按组件类型分类展示 |
| collector_status | enum | 采集器状态 | 顶层采集器运行状态（与 `components` 中 `type=collector` 的 status 一致；online / offline / unknown / not_deployed） |
| collector_version | string | 采集器版本 | 顶层采集器版本（与 `components` 中 `type=collector` 的 version 一致；未部署为空） |
| created_at | datetime | 仅技术信息 | 创建时间 |
| updated_at | datetime | 仅技术信息 | 更新时间 |

> **模型语义**：`EdgeAgent` 实例代表「**边缘节点上的 Agent 部署 = Edge Sync Agent + 采集器组合**」，即一个边缘监控代理节点上的完整 Agent 部署单元；`agent_type` 字段为**采集器类型**（`vmagent` / `prometheus-agent`），由网域在 M09 纳管时在 `NetworkDomain.agent_type` 登记（见 [[5.1](#51-网域networkdomain)），Edge Sync Agent 为必装组件、无需单独登记。
> **default 域不产生 EdgeAgent 实例**：`default` 固定走 `local` 通道、由中心 Prometheus 直接采集，因此不存在 `network_domain_id='default'` 的 `EdgeAgent` 实例（MVP 不支持通道切换，v0.4+ 再评审）。「采集节点状态」页展示所有存在 `EdgeAgent` 实例的网域，与 `domain_type` 无关。
> 心跳（[[5.3](#53-心跳上报edgeheartbeat)）由 **Edge Sync Agent** 上报，携带采集器类型（`agent_type`）、版本（`version`）、`config_version`、WAL 积压（`wal_backlog_bytes`）等，用于更新 `EdgeAgent` 的在线状态、最后心跳、配置同步状态与 WAL 积压字段。
> **组件清单**：`components` 描述该边缘节点上全部组件实例（Edge Sync Agent 必装 + 采集器必装 + blackbox exporter 可选 + v0.4+ vmalert / alertmanager），由心跳附带上报（见 5.3），是「采集节点状态」页组件分类展示的数据来源；采集器组件状态 / 版本与顶层 `collector_status` / `collector_version` 保持一致。

### 5.3 心跳上报（EdgeHeartbeat）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|----------|------|
| network_domain_id | string | 仅技术信息 | 所属网域 ID |
| agent_type | enum | 仅技术信息 | `vmagent` / `prometheus-agent` |
| version | string | 仅技术信息 | Agent 版本 |
| config_version | string | 仅技术信息 | 当前生效配置版本 |
| wal_backlog_bytes | int | 仅技术信息 | WAL 积压字节数 |
| remote_write_queue_size | int | 仅技术信息 | Remote Write 发送队列长度 |
| remote_write_last_error | string | 仅技术信息 | 最近 Remote Write 错误 |
| components | json | 仅技术信息 | 本节点组件清单（组件类型 / 名称 / 运行状态 / 版本 / 配置版本 / 最近错误），用于更新 `EdgeAgent.components` 并支撑「采集节点状态」页组件分类展示 |
| timestamp | datetime | 仅技术信息 | 心跳时间戳 |

### 5.4 配置草稿（ConfigDraft）

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 仅技术信息 | 草稿唯一标识（内部技术键） |
| change_no | string | ✅ | 变更单号 | **变更单号**：用户可读唯一标识（如 `CHG-20260803-003`），类比工单号 / PR 号，用于变更沟通与审计追溯（「回滚变更单 CHG-20260803-003」）；**自动生成**：configgen 在生成草稿时自动分配（用户不可手填），格式 `CHG-{YYYYMMDD}-{当日序列}`（如 `CHG-20260803-003`），全局唯一 |
| network_domain_id | string | ✅ | 网域 | 所属网域 ID |
| source_version | string | ❌ | 仅技术信息 | 基于哪个 ConfigVersion 生成，可为空（首次生成） |
| prometheus_yml | text | ✅ | 仅技术信息 | 生成的 prometheus.yml 内容（仅 job 骨架，targets 见 `targets_files`） |
| rules_yml | text | ❌ | 仅技术信息 | 生成的 rules.yml 内容（可选） |
| blackbox_yml | text | ❌ | 仅技术信息 | 生成的 blackbox.yml 内容（可选） |
| targets_files | json | ❌ | 仅技术信息 | 生成的 targets 内容承载字段：按 job 名组织的 targets 列表（file_sd 目标文件，如 `{"node-exporter": [{"targets": [...], "labels": {...}}], "blackbox-http": [...]}`；网域无任何目标时为空对象） |
| metadata | json | ✅ | 仅技术信息 | 生成时间、生成器版本、`source_data_version`、`trigger_summary`（触发来源 job/rule/表 + 时间）、联合 checksum（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）、来源 job/rule 摘要；被同域更晚 pending 取代时记录 `superseded_by_change_no`（指向新变更单号），新单记录 `supersedes_change_no`（指向被取代旧单） |
| summary | string | ✅ | 变更摘要 | **人话变更摘要**：由 configgen 对比当前生效版本与草稿的产物差异生成，面向运维回答「为什么发生了变更」，如「新增 1 台服务器（10.0.1.11）加入 node-exporter 采集」 |
| change_items | json | ✅ | 变更清单 | **结构化变更清单**：`[{type: add/modify/remove, target: 源数据对象枚举（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）, description, risk: low/high, affected_files: 影响的配置文件（prometheus.yml / targets / rules.yml / blackbox.yml）}]`，供「配置变更确认」页结构化展示（变更类型 / 变更对象 / 说明 / 风险等级 / 影响的配置文件） |
| validation_status | enum | ✅ | 校验 | 下发前校验结果：`passed` / `failed` / `pending`（见 3.5.1）；仅 `passed` 可确认发布 |
| validation_cause | enum | ❌ | 校验原因 | 校验失败归因（决策 45-3）：`user_config`（用户配置问题，可修复，提供「重新校验 + 前往修改」）/ `platform_fault`（平台技术故障，提供手动「重新校验」自愈出口）；MVP 判定：targets schema 类失败归 `user_config`、promtool/blackbox 不可用归 `platform_fault` |
| validation_details | json | ❌ | 校验详情 | 结构化校验失败定位：`[{file, line, message}]`，前端行内 Popover 定位并跳转 Module_01 修改源数据 |
| status | enum | ✅ | 状态 | pending / confirmed / discarded；`discarded` 承载四语义——人工废弃（含废弃回写源数据） / 内容无变化自动丢弃 / 校验失败后废弃 / **被同域更晚 pending 取代（superseded，决策 42-1）** |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |
| updated_at | datetime | ✅ | 仅技术信息 | 更新时间 |
| confirmed_by | string | ❌ | 确认人 | 确认人 |
| confirmed_at | datetime | ❌ | 确认时间 | 确认时间 |

> `blackbox_yml` 在所属网域存在 `job_type=blackbox` 的 ScrapeJob 时必填，且必须随 `prometheus.yml` 一同下发。
>
> `targets_files` 下发时按 job 名拆分为 `targets/<job_name>.json` 文件（固定文件名覆盖写），job 名中的非法文件名字符需做安全转换，保证文件名稳定可预测。

### 5.5 配置版本（ConfigVersion）

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 配置版本 | 版本唯一标识（`cv-xxx`），建议作为配置包版本号 |
| network_domain_id | string | ✅ | 网域 | 所属网域 ID |
| draft_id | string | ✅ | 仅技术信息 | 来源 ConfigDraft ID |
| change_no | string | ✅ | 来源变更单号 | **来源变更单号**：确认时继承来源 draft 的 `change_no`，全链路追溯 `change_no → cv → deploy` |
| prometheus_yml | text | ✅ | 仅技术信息 | 生效的 prometheus.yml 内容 |
| rules_yml | text | ❌ | 仅技术信息 | 生效的 rules.yml 内容 |
| blackbox_yml | text | ❌ | 仅技术信息 | 生效的 blackbox.yml 内容 |
| targets_files | json | ❌ | 仅技术信息 | 生效的 targets 内容（按 job 名组织，与草稿一致；随配置包按 `targets/<job_name>.json` 落地） |
| metadata | json | ✅ | 仅技术信息 | 版本号、生成时间、联合 checksum（与草稿一致，供差异检测与边缘完整性校验；sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）、来源摘要 |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |

> `blackbox_yml` 在所属网域存在 `job_type=blackbox` 的 ScrapeJob 时必填；下发记录需体现 `blackbox.yml` 是否参与本次下发及重载结果。
>
> **版本一致性语义澄清**：版本模型为**网域级版本**——每个网域独立 `ConfigVersion`（配置按网域生成，各域内容不同，符合网域隔离设计），**一致性保障在网域内**：
>
> - **网域内一致性**：同一网域所有 Edge Agent 仅拉取该域**同一个经审批的 `ConfigVersion` 快照**（心跳 `config_version` 比对返回 304 + `metadata.checksum` 完整性校验，防传输损坏 / 篡改 / 半新半旧）；
> - **跨域同一批变更**：不同网域的 ConfigVersion 内容不同（各自域内产物），但同属一张变更单——`ConfigVersion.change_no`（继承来源 draft）透传，全链路可追溯「哪张变更单发了哪些域」；
> - **非全局同一版本**：不引入"所有网域共享同一 cv"的全局版本模型（与网域隔离设计冲突）；跨域变更节奏一致性由变更单确认流程保障（各域经确认后各自发布）。

### 5.6 配置下发记录（ConfigDeployment）

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 部署 ID | 下发记录唯一标识（`deploy-xxx`，系统自动生成） |
| network_domain_id | string | ✅ | 网域 | 目标网域 ID |
| config_version_id | string | ✅ | 配置版本 | 下发的 ConfigVersion ID（`cv-xxx`，系统自动生成） |
| source_change_no | string | ✅ | 来源变更单号 | **来源变更单号**：经 `config_version_id` → `ConfigVersion.change_no` 透传，全链路可追溯「哪个变更单发的、回滚它」 |
| channel | enum | ✅ | 下发通道 | **** `local`（中心直接 reload）/ `agent_pull`（Edge Sync Agent 拉包），与对应 `NetworkDomain.channel` 一致 |
| target_address | string | ❌ | 目标地址 | 目标地址，`local` 通道记录 Prometheus reload URL；`agent_pull` 通道记录 Edge Agent 标识或留空 |
| status | enum | ✅ | 状态 | pending / running / success / failed / rolled_back |
| validation_status | enum | ✅ | 下发前校验 | 下发前校验结果：passed / failed / pending（与草稿 `validation_status` 衔接；失败时 `error_message` 记录校验失败原因） |
| includes_blackbox | boolean | ✅ | 含 blackbox.yml | 本次下发配置包是否包含 blackbox.yml（存在 `job_type=blackbox` 的 ScrapeJob 时必含） |
| error_message | text | ❌ | 错误信息 | 失败原因 |
| triggered_by | string | ✅ | 操作人 | 操作人/系统 |
| triggered_at | datetime | ✅ | 开始时间 | 触发时间 |
| completed_at | datetime | ❌ | 结束时间 | 完成时间 |

> **`change_status` 回写 M01 规则**：
> - `ConfigDraft` 生成后，M09 根据 `change_items` 中涉及的源数据对象（`ScrapeJob` / `MonitoringRule`），将其 `change_status` 回写为 `pending`；
> - `ConfigDraft` 确认并生成 `ConfigVersion` 后，回写为 `confirmed`；
> - `ConfigDeployment.status=success`（`local` 通道 reload 成功 / `agent_pull` 通道配置包被 Agent 成功应用）后，回写为 `deployed`（v0.2 起 Job、v0.3 起规则；MVP 阶段 `deployed` 由 `none` 占位，即确认下发成功后直接回写 `none`）；
> - 回滚到历史 `ConfigVersion` 同样生成新的 `ConfigDeployment`，成功后回写为 `deployed`；
> - 无相关在途变更时回写为 `none`；
> - 回写为异步 pull 模式（M09 不主动推送，M01 读取时由 M09 接口返回或 M01 本地冗余字段展示）。

### 5.7 网域与 BlueKing Cloud Area 映射

> 本节映射关系在 v0.4+ 由 [Module_04](Module_04_Custom_Discovery.md) 同步时落地。

`NetworkDomain` 必须与 BlueKing CMDB 的云区域（Cloud Area）模型一一对应，保证 CMDB 作为监控对象唯一数据源时，网域边界与 CMDB 网络边界一致。

| MetricCenter 对象 | BlueKing CMDB 对象 | 映射规则 | 说明 |
|-------------------|-------------------|----------|------|
| NetworkDomain | Cloud Area（云区域） | 1:1 | 一个网域唯一对应一个蓝鲸云区域；`default` 网域可映射到默认云区域或保留为空 |
| Tenant | Business（业务） | 1:1 | 网域归属的租户对应蓝鲸业务，由 [Module_06](Module_06_Multi_Tenant.md#32-%E7%A7%9F%E6%88%B7%E4%B8%8E-blueking-cmdb-%E6%98%A0%E5%B0%84) 定义 |

> **约束**：禁止绕过 CMDB 云区域直接在 MetricCenter 中定义网络隔离边界；网域的创建与编辑应支持同步拉取/校验蓝鲸云区域信息。
>
> **归属解析链（决策 52）**：`bk_cloud_id` → `NetworkDomain` 映射是资源网域归属四级解析链的第①级（字段映射 > 同步通道绑定 > IP 段推导 > 待分配队列），同步任务侧配置映射表，平台侧数据、不回写 CMDB；完整链路见 [Module_07 5.16.4](Module_07_Monitoring_Object_Management.md)。

## 6. 接口设计

### 6.1 网闸/隔离区连接约束与地址语义

> **网闸 / 隔离区连接约束（强制）**：在政务云等网闸隔离场景（互联网区 ↔ 政务外网区，双向网闸地址策略不同）下，**禁止任何中心 → 边缘方向的主动连接**——所有交互（心跳、配置拉取、指标 remote_write）一律由边缘 Agent 向中心发起（pull / push 上行）。中心侧不实现也不保留"主动触达边缘"的能力（如主动 reload、主动探测）；该约束同时是安全合规要求与网闸策略的现实约束（中心→区方向的映射地址通常不存在）。

### 6.2 心跳与配置检查接口

```http
POST /api/v2/platform/edge/heartbeat
Authorization: Bearer <NetworkDomain.token>
Content-Type: application/json

{
  "network_domain_id": "gov-cloud-a",
  "agent_type": "vmagent",
  "version": "v1.101.0",
  "config_version": "20260724-120000",
  "wal_backlog_bytes": 1048576,
  "components": [
    {
      "type": "edge_sync_agent",
      "name": "metric-center-edge-agent",
      "status": "online",
      "version": "v1.2.0",
      "config_version": "20260724-120000"
    },
    {
      "type": "collector",
      "name": "vmagent",
      "status": "running",
      "version": "v1.101.0",
      "config_version": "20260724-120000"
    },
    {
      "type": "blackbox_exporter",
      "name": "blackbox-exporter",
      "status": "running",
      "version": "v0.25.0",
      "config_version": "20260724-120000"
    }
  ]
}
```

响应：

```json
{
  "config_changed": true,
  "config_version": "20260724-121500",
  "config_download_url": "https://10.8.0.5:8443/api/v2/platform/edge/config?network_domain=gov-cloud-a"
}
```

> **`config_download_url` 合成规则**：返回**绝对地址** = 该网域 `center_endpoint`（该网域视角的中心可达地址，见 5.1）+ 固定相对路径 `/api/v2/platform/edge/config?network_domain=<id>`。禁止返回相对路径由 Agent 自行拼接——网闸场景下 Agent 无法推导中心映射地址。`center_endpoint` 缺失（如 `channel=local` 网域）时不走本协议。

### 6.3 配置包拉取接口

```http
GET /api/v2/platform/edge/config?network_domain=gov-cloud-a
Authorization: Bearer <NetworkDomain.token>
```

响应：

```
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="edge-config-gov-cloud-a.zip"

[zip body]
```

> 本节描述的 **zip 配置包结构是 `agent_pull` 通道 Agent 拉取**的配置载体：`channel=agent_pull` 的网域确认下发后由 Edge Sync Agent 通过本接口心跳拉取。**`channel=local` 的网域为本地文件集**（`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml`，**不打包、无 metadata.json**），确认后直接写中心 Prometheus 配置目录并 SIGHUP / `POST /-/reload`，版本一致性由 `ConfigVersion` 记录保证（见 3.11 配置产物形态分层）。`alertmanager.yml` 由 Module_08 直接管理，**不在本配置包中**。

配置包结构：

```
edge-config-<network_domain_id>.zip
├── prometheus.yml          # 本域 scrape_configs（仅 job 骨架，已注入 external_labels.network_domain_id / zone_type / replica；以 file_sd_configs 引用 targets/*.json）
├── targets/                # file_sd 目标文件（按 job 分文件，固定文件名覆盖写）
│   └── <job_name>.json     # 如 node-exporter.json / blackbox-http.json（targets 列表 + labels）
├── blackbox.yml            # 本域 Blackbox 探测模块（可选）
├── rules.yml               # 本域 edge/both 告警规则（v0.4+）
└── metadata.json           # config_version、生成时间、agent_type、联合 checksum（sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)，供拉取后完整性校验）
```

> ****：以下两点依赖真实政务云网闸环境，MVP 阶段按"标准 HTTPS 可穿透"假设设计，**待 MVP 后在客户环境实测验证**：
>
> 1. **网闸对长连接 / 大文件的支持**：remote_write 持续 HTTPS 数据流（边缘→中心上行）与配置包 zip 下载能否稳定穿过双向网闸（部分网闸基于协议代理 / 内容交换，可能截断长连接或限制文件大小）；
> 2. **互联网区代理服务器复用**：客户拓扑中互联网区的出访代理服务器是否可复用为监控流量出口；若网闸穿透实测不通过，备选方案为在互联网区侧部署监控专用的缓冲 / 转发组件（不影响 MVP 数据模型，`center_endpoint` / `remote_write_url` 的 per-domain 地址设计已为此预留）。

### 6.4 Edge Sync Agent 本地行为

1. 启动后负责部署并守护**本节点**采集器（vmagent / prometheus-agent，按网域 `agent_type` 二选一）与 blackbox exporter 进程（一体化离线包自带，非手动安装；启动顺序 **blackbox exporter → 采集器**）；进程异常自动重启，并将采集器版本与运行状态纳入心跳上报；保留手动兜底（运维可手工替换采集器配置/二进制，见 3.6）。
2. 启动时从环境变量或配置文件读取 `NETWORK_DOMAIN_ID` 和 `TOKEN`。
3. 每 30s 向 MetricCenter 发送心跳，上报当前配置版本和 WAL 积压。
4. 若响应提示 `config_changed=true`，拉取最新配置包。
5. 校验配置包 checksum（`metadata.json` 中携带），失败则记录错误并保留最后一份有效配置，不进入解压步骤；通过后解压到本地目录。
6. 解压后对 `targets/*.json` 做解析校验（JSON 结构、`targets` / `labels` 字段合法性），校验失败则**回滚并保留旧 targets 文件**，避免采集器加载损坏文件导致目标丢失。
7. 仅当 `prometheus.yml` 结构变化时调用本地采集器 `/-/reload`（vmagent 与 Prometheus Agent Mode 均支持）；**targets 文件更新不触发采集器 reload**，由 file_sd 自动感知（磁盘监听 / 轮询）应用。
8. 若配置包包含 `blackbox.yml`，触发同域 blackbox exporter 重载（`SIGHUP` 或对应 API）。
9. 网络中断时保留最后一份有效配置，按原配置继续采集和 WAL 缓存。
10. 当配置包包含 `rules.yml` 时，边缘 Agent 启动本地 vmalert 实例，负责网域内自治告警；`alertmanager.yml` 由 Module_08 单独管理，不随本配置包下发。

> **断网期间草稿/版本显式说明**：断网**不影响配置生成与草稿存储**——变更检测（pull 模式，中心轮询）与 `ConfigDraft` / `ConfigVersion` 持久化均在中心侧完成，断网期间生成的草稿 / 版本正常落库待确认 / 待发布；边缘侧断网时按第 9 条保留**最后一份有效配置**继续自治采集（本地快照，不依赖中心在线），网络恢复后心跳上报 `config_version` → 中心响应 `config_changed=true` → 拉取最新已审批版本（版本一致性见 5.5：网域内同一快照 + checksum 校验）。

### 6.5 中心/边缘校验分层与衔接

> **设计定位**：前端「配置生成/预览」对标的是**中心侧控制**（configgen 生成草稿 → 中心内容校验 → 前端预览/diff/确认 → 生成 ConfigVersion），Edge Sync Agent 对标的是**边缘侧消费**（心跳拉 zip → 边缘传输校验 → 原子替换 → 触发 reload → 回执 config_sync_status）；两者**不是**「对标 Agent 能力」，也**不是**「另一套独立校验」，而是由**同一份配置产物（ConfigVersion / zip 包）**衔接的同一条链路的两段——中心侧决定「产物对不对、是否可下发」，边缘侧决定「拉到的包完不完整、是否可应用」。

**同产物两段链路关系图**

```text
┌────────────────────── 中心侧控制（前端「配置生成/预览」） ──────────────────────┐
│                                                                               │
│  ① configgen 生成草稿       ② 中心内容校验           ③ 前端预览 / diff / 确认    │
│    prometheus.yml /           · promtool check config  · validation_status 展示 │
│    targets/*.json /           · blackbox_exporter      · 校验失败 → 阻止确认下发 │
│    rules.yml / blackbox.yml     --config.check          · 确认通过 → 生成         │
│                               · configgen targets        ConfigVersion          │
│                                 schema 校验                                    │
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │
           同一份配置产物：ConfigVersion（`agent_pull` 通道 = zip 配置包，含 metadata.json）
                                       │
                                       ▼
┌────────────────────── 边缘侧消费（Edge Sync Agent） ─────────────────────────────┐
│                                                                               │
│  ④ 心跳拉 zip              ⑤ 边缘传输校验            ⑥ 原子替换 + reload        │
│    config_changed 为真时      · metadata.json            · 解压校验通过后原子替换 │
│    拉取本域配置包              checksum 完整性校验         · 结构变化触发采集器      │
│                             · targets/*.json JSON        reload；targets 变更由  │
│                               解析校验                   file_sd 自动感知        │
│  ⑦ 应用回执 config_sync_status（in_sync / out_of_sync / manual_override）        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**分层校验对照表**

| 校验层 | 校验内容 | 防什么风险 | 谁执行 | 结果展示位置 |
|--------|----------|------------|--------|--------------|
| **中心①内容校验** | `promtool check config` 校验 `prometheus.yml`；存在 `blackbox.yml` 时 blackbox exporter `--config.check` 校验；configgen 侧 targets schema 校验（JSON 结构、`host:port` 地址格式、labels 合法性） | **生成错误**（语法 / 引用 / schema 非法；校验①失败会**阻止确认下发**，见 [3.5.1](#351-下发前校验与-blackbox-重载说明)） | 配置中心（configgen 生成时 + 下发前） | 前端配置生成/预览页 `validation_status` |
| **边缘②传输校验** | 拉包后按 `metadata.json` 联合 checksum 做完整性校验（[[6.4](#64-edge-sync-agent-本地行为) 第 5 条）；解压后 `targets/*.json` JSON 解析校验（结构、`targets` / `labels` 字段合法性，6.4 第 6 条） | **传输损坏 / 篡改 / 半写文件**（校验失败保留最后一份有效配置并记录错误，不进入解压 / 应用步骤） | Edge Sync Agent（边缘侧） | 采集节点状态列表「最近错误」/ `config_sync_status` 异常态（out_of_sync / manual_override） |

> 分层依据：两类校验**防的是不同风险**——中心内容校验防「生成错误」（产物本身非法），边缘传输校验防「传输问题」（产物本身合法，但拉取过程被损坏 / 篡改 / 半写）；因此边缘侧无需重复中心的 promtool 级语法校验。

**设计要点**

1. **Agent 为「哑校验」**：Edge Sync Agent 只做**传输层机械校验**（`metadata.json` checksum 完整性 + targets JSON 解析），**不做 promtool 级语法校验**（不解析 `prometheus.yml` 完整语法、不调用 promtool / blackbox `--config.check`）；产物合法性由中心内容校验（校验①）保证——校验①失败会阻止确认下发，边缘侧拿到的必然是已通过中心校验的产物。哑校验降低边缘实现复杂度与依赖面（Agent 无需携带 promtool / blackbox exporter 校验工具，弱网边缘节点可离线自校验）。
2. **联合 checksum 双用途**：同一份联合 checksum（sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)）在两端各司其职——中心侧用于**草稿去重裁决**（[3.3.3](#333-变更检测与草稿去重说明)：内容与生效版本一致则不进入确认）；边缘侧用于**拉包完整性校验**（[[6.4](#64-edge-sync-agent-本地行为) 第 5 条：拉到的字节与中心生成的产物一致）。同一算法、两个校验对象：中心校验「生成内容是否变化」，边缘校验「传输字节是否完整」。
3. **状态闭环**：`config_sync_status`（in_sync / out_of_sync / manual_override）是 Agent 的**应用回执**（随心跳上报，见 [3.8](#38-agent-状态列表与边缘诊断看板) / [[5.2](#52-边缘-agentedgeagent)），与中心 `validation_status` 构成**闭环两端**——中心校验通过（validation_status=pass）→ 允许确认下发 → Agent 拉包、传输校验、原子替换、reload → 回执 `config_sync_status=in_sync`，闭环完成；任一端异常均可定位：`validation_status` 失败（中心产物问题，阻止下发）、`config_sync_status=out_of_sync` / `manual_override`（边缘应用或本地手工兜底问题，提示重新确认下发）。

### 6.6 管理面 REST API 详细契约

> 本节补充前端「网域纳管 / 采集节点状态 / 配置变更确认 / 下发记录」所需的管理面 REST 契约。所有接口统一返回 `platform/api/response` 格式：
>
> ```json
> { "status": "success", "data": {} }
> { "status": "error", "errorType": "bad_request", "error": "human readable message" }
> ```
>
> 通用 `errorType`：`bad_request`、`unauthorized`、`forbidden`、`not_found`、`internal`。

#### 6.5.1 网域纳管

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/network-domains` | Query: `tenant_id?`、`keyword`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 5.1（含 `is_monitored` / `token_masked`） | `forbidden`：越权访问其他租户 |
| POST | `/api/v2/platform/network-domains/{id}/monitor` | `{ agent_type: 'vmagent', remote_write_url?: string, description?: string }` | 纳管后的网域（生成/返回 Token 一次） | `bad_request`：网域未在 M06 创建或已被纳管；`not_found` |
| PUT | `/api/v2/platform/network-domains/{id}/monitor` | `{ agent_type?, remote_write_url?, description?, is_monitored? }` | 更新监控参数 | `not_found`；`bad_request`：网域未纳管 |
| POST | `/api/v2/platform/network-domains/{id}/reset-token` | — | `{ token: '<一次性明文>', token_masked: '****abcd' }`（明文仅本次返回） | `not_found`；`bad_request`：非已纳管网域 |

> **MVP 阶段**：`agent_type` 仅允许 `vmagent`；`prometheus-agent` 为 v0.2+ 预留枚举。

#### 6.5.2 配置变更确认（ConfigDraft）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/config-drafts` | Query: `network_domain_id`、`status`（pending/confirmed/discarded/all，默认 pending）、`page`、`page_size` | `{ items: [...], total: N }`，item 含 `change_no`、`summary`、`risk`、`affected_files`、`created_at` | `bad_request`：未选择已纳管网域 |
| GET | `/api/v2/platform/config-drafts/{change_no}` | — | 变更单详情，含 `prometheus_yml`、`targets_files`、`rules_yml`、`blackbox_yml`、`change_items`、`metadata` | `not_found` |
| POST | `/api/v2/platform/config-drafts/{change_no}/confirm` | `{ confirmed_by: string }`（MVP 预置用户） | 生成的 `ConfigVersion`（含 `id`、`change_no`、`config_version`） | `bad_request`：`validation_status=failed` / 已非 pending；`not_found` |
| POST | `/api/v2/platform/config-drafts/{change_no}/revalidate` | — | 重新执行中心内容校验，返回新 `validation_status`；校验通过后该草稿恢复为可确认 `pending`，可继续 confirm | `bad_request`：校验仍 `failed` / 已非 failed 草稿；`not_found` |
| POST | `/api/v2/platform/config-drafts/{change_no}/discard` | `{ discarded_by?: string }` | 废弃后的变更单（含校验失败态草稿的废弃出口，决策 42-2） | `bad_request`：已非 pending（校验失败态 failed 亦可废弃）；`not_found` |

#### 6.5.3 配置版本与下发记录（ConfigVersion / ConfigDeployment）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/config-versions` | Query: `network_domain_id`、`change_no?`、`page`、`page_size` | `{ items: [...], total: N }` | — |
| GET | `/api/v2/platform/config-versions/{id}` | — | 配置版本详情（含完整产物，用于 diff） | `not_found` |
| GET | `/api/v2/platform/deployments` | Query: `network_domain_id`、`status?`、`change_no?`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 5.6 | — |
| POST | `/api/v2/platform/deployments/{config_version_id}/rollback` | `{ triggered_by: string }` | 新的 `ConfigDeployment`（`status=success`，回滚目标版本） | `not_found`；`bad_request`：目标版本不存在或不是同一网域 |
| POST | `/api/v2/platform/deployments/{deployment_id}/retry` | `{ triggered_by: string }` | 重新执行该下发（仅 `local` 通道，复用最近一次版本的下发动作），生成新的 `ConfigDeployment` | `bad_request`：非 `local` 通道 / 原记录非 failed；`not_found` |

#### 6.5.4 采集节点状态查询

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/edge-agents` | Query: `network_domain_id?`、`component_type?`、`status?`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 5.2（含顶层 `collector_status` / `collector_version` 与 `components` 明细） | — |
| GET | `/api/v2/platform/edge-agents/{id}` | — | Agent 详情 | `not_found` |

---

## 7. 依赖

### 7.1 模块边界与依赖关系

#### 7.1.1 与 Module_01 的边界

| 职责 | Module_01（监控策略与指标管理） | Module_09（网域与边缘配置中心） |
|------|----------------------------------|--------------------------------|
| ScrapeJob 数据模型定义 | ✅ | ❌ 仅读取 |
| 规则（Rule）数据模型定义 | ✅ | ❌ 仅读取 |
| CI 类型 ↔ Exporter 模板绑定 | ✅ | ❌ 仅消费 |
| 规则编辑 UI | ✅ | ❌ |
| 按网域生成 `prometheus.yml` / `targets/*.json` / `rules.yml` / `blackbox.yml` | ❌ | ✅ 读取 `ScrapeJob.job_type`、`blackbox_module`、`blackbox_targets` 生成 blackbox.yml、targets JSON 与对应 scrape_configs（file_sd 骨架） |
| 配置草稿 / 预览 / Diff | ❌ | ✅ |
| 配置下发 / Reload | ❌ | ✅ |
| 策略定义与实例选择 | ✅ | ❌ |
| 变更检测 / 配置生成触发 | ❌ 仅维护各源表 `updated_at`，不承担通知职责 | ✅ 异步轮询（pull 模式，默认 30s）消费 Module_01/07 各源表 `updated_at` 变化触发重算 |

#### 7.1.2 与 Module_07 的边界

| 职责 | Module_07（监控对象管理） | Module_09（网域与边缘配置中心） |
|------|---------------------------|--------------------------------|
| Resource 数据模型定义 | ✅ | ❌ 仅读取 |
| LabelTemplate 数据模型定义 | ✅ | ❌ 仅读取 |
| Resource CRUD / Excel 导入 | ✅ | ❌ |
| 「已监控 / 未监控」badge | ✅ 展示 | ❌ 消费 badge 状态辅助生成配置 |
| 按网域生成 `prometheus.yml` / `targets/*.json` | ❌ | ✅ |
| 配置包拉取接口 | ❌ | ✅ |
| Edge Sync Agent 协议 | ❌ | ✅ |
| Edge Agent 心跳接收与状态展示 | ❌ | ✅ |
| NetworkDomain 数据模型定义 | ❌ 仅引用 `id/name/status` | ✅ 数据模型归属 |
| NetworkDomain 生命周期 UI/API | ❌ | ✅ 功能 Owner |

#### 7.1.3 与 Module_06 的边界

| 职责 | Module_06（租户与平台管理） | Module_09（网域与边缘配置中心） |
|------|------------------------------|--------------------------------|
| Tenant 数据模型定义 | ✅ | ❌ 仅引用 `tenant_id` |
| NetworkDomain 与 Tenant 关系 | ❌ 仅展示/校验 | ✅ 数据模型归属（`tenant_id` 在 NetworkDomain） |

#### 7.1.4 与 Module_10 的边界

| 职责 | Module_09（网域与边缘配置中心） | Module_10（外部监控源接入与标签归一化） |
|------|--------------------------------|------------------------------------------|
| 内部 Edge Agent 的 `external_labels` 注入 | ✅ 在生成 `prometheus.yml` 时注入 `network_domain_id` / `zone_type` / `replica` 等部署级元数据 | ❌ |
| 外部异构监控源（第三方 Prometheus/Zabbix/云监控）接入 | ❌ | ✅ 负责标签归一化、映射、补全 |
| 外部来源的 `network_domain_id` / `tenant` 标签对齐 | ❌ 可提供网域/租户定义供引用 | ✅ 负责将外部指标映射到本网域模型 |

> **原则**：Module_09 管「内部 Agent 出身标签」，Module_10 管「外部来源入场标签」。两者都可能在指标上产生 `network_domain_id` 等标签，但生成时机和 responsibility 不同：Module_09 通过 Agent 配置注入，Module_10 通过接入网关/转换器在数据入平台时打标或改写。

---

### 7.2 技术依赖

- `platform/edge/`
- `platform/config/`（读取按网域生成的配置）
- `platform/configgen/`（配置生成服务）
- `platform/gateway/`（统一 API 入口、鉴权）
- `platform/models/`
- Module_01 API：读取 ScrapeJobs、Rules
- Module_07 API：读取 Resources、LabelTemplates
- 中心 Prometheus reload 接口（SIGHUP 或 HTTP `/-/reload`）
- `vmagent` 或 `prometheus-agent`（边缘部署）

---

## 8. 数据模型状态机

> **说明**：集中定义本模块核心对象的状态流转（与 4.2 时序图互为参照，供后端实现与前后端契约对齐）。所有状态机中的"操作"均为系统自动或用户操作触发，UI 展示状态标签与操作入口。

**① ConfigDraft（变更单）状态机**

```text
[生成] 检测到源数据变更 + 内容有实际差异（联合 checksum ≠ 生效版本，空变更抑制：无差异不落库）
   │  └── 遇活 pending：与既有 pending 产物 checksum 比较（决策 42-1 / F-19）——相同保持 skipped_pending 不推基线；不同生成新单取代旧单
   ▼
 pending（待确认）─── 确认发布（人工，变更单级 go/no-go；仅 validation_status=passed 可确认）───► confirmed（已确认）
   │   ▲                                                            │
   │   └──────── 内容无变化自动裁决（empty-change 抑制，不落库）──────►（不生成）
   │   └──────── 被同域更晚 pending 取代（superseded，metadata 互记）──► discarded（已取代）
   │
   └────── 校验失败后重新校验通过 或 校验失败后废弃（决策 42-2 / 45-1）
   └────── 废弃（人工）───► discarded（已废弃，伴随源数据分类回写，决策 43）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| pending | 待确认 | configgen 检测到变更且产物有实际差异；仅 `validation_status=passed` 可确认 | 确认 → confirmed（生成 ConfigVersion）；废弃 → discarded（分类回写源数据）；校验失败 / 未校验（pending）不可确认，提供「重新校验 + 废弃」（见 3.5.1 / 决策 45-1）；被同域更晚 pending 取代 → discarded(superseded) |
| confirmed | 已确认 | 运维确认发布（记录确认人，变更单级 go/no-go） | 生成 ConfigVersion（继承 change_no，分配 cv-xxx）→ 进入下发流程；下发成功后 M01 `change_status` 回写 `deployed`（决策 31-M2） |
| discarded | 已废弃 / 自动丢弃 / 已取代 | 人工废弃（**伴随源数据分类回写：新建回退 draft / 已生效修改保留提示复现 / 删除·停用自动恢复，`change_status` 清理防 pending 残留，决策 43**）；或重算后 checksum 与生效版本一致（空变更抑制、不落库）；或被同域更晚 pending 取代（superseded，`metadata.superseded_by_change_no` 指向新单，新单 `supersedes_change_no` 指向旧单） | 终态，保持当前生效配置不变；废弃审计历史由本变更单承载 |

**② ConfigDeployment（下发记录）状态机**

```text
pending（待执行）──► running（执行中）──► success（成功）──► rolled_back（已回滚）
                        │
                        └──► failed（失败，记录错误信息）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| pending | 待执行 | 确认发布后创建下发任务 | 执行 → running |
| running | 执行中 | 下发动作开始（reload / 推送 Agent） | 成功 → success；失败 → failed |
| success | 成功 | 下发成功 | 可被回滚 → rolled_back |
| failed | 失败 | 下发失败（记录 `error_message` / 校验失败） | 可重试 |
| rolled_back | 已回滚 | 对 success 版本执行回滚（回滚动作本身也生成一条 rolled_back 记录） | 终态 |

**③ 配置同步状态（config_sync_status）状态机**

```text
unknown ──► in_sync（中心版本 = 边缘生效版本）
        ──► out_of_sync（中心版本 ≠ 边缘生效版本，按 out_of_sync_cause 区分引导）
        │     pending_draft  → 中心存在待确认变更草稿 → 引导「前往配置确认」
        │     pull_pending     → 无待确认变更、Agent 拉包/生效延迟 → 纯展示等待 +「查看下发记录」
        │     local_reset      → 本地环境/地址变化、checksum 失败保留旧配置等 → 引导「立即同步」（force_pull）
        ──► manual_override（边缘本地手工修改，平台不强制回拉，需人工确认恢复）
        ──► no_version（Agent 已上线但网域尚无成功下发过的 ConfigVersion）→ 引导「去配置采集 Job」
```

**④ 网域运行态（NetworkDomain.status）状态机**

```text
unknown（未部署/纳管后）──► online（Agent 心跳上线）──► offline（失联超阈值，触发 EdgeSiteOffline 告警）
```

---

## 9. 验收标准

> **分层说明**：验收标准分「用户验收」（用户能在界面感知 / 操作 / 验证，对应原型演示）与「技术验收」（后端机制 / 协议 / 数据契约可验证，对应后端测试与接口验收）。

### 9.1 用户验收（用户可感知与操作）

> **MVP 验收范围收敛（决策 42-5）**：本模块 **P0 是主干能力排序，不等于 MVP 交付**。**MVP 子集 = `default` 域 + `local` 通道 + 配置生成/预览/确认/reload 全链路**——凡涉及 Edge Agent / `agent_pull` / 多网域 / 节点状态/Token/安装指引 的验收条目均标注 **{v0.2}**，MVP 仅验收本次子集内可闭合项（default 域存在、配置生成 → 变更检测 → 确认 → diff/preview → reload 生效、local 重试/回滚、下发记录）。
>
> 本清单内显式含「v0.2 阶段」「采集节点状态」「Edge Agent」「agent_pull」字样的条目**归属 v0.2 验收**，不阻塞 MVP。

- [ ] {P0} MVP 阶段系统存在默认网域 `default`，资源可无感知归属默认网域
- [ ] {P0} 网域行政创建/编辑/删除由 Module_06 负责，M09 不提供删除入口；M09 可从 M06 已存在的网域中选择并进行**监控纳管**（填写监控参数、生成/重置 Edge Agent Token、Remote Write URL）
- [ ] {P0} 可以为网域生成/重置 Edge Agent Token
- [ ] {P0} Token 在 UI 中完全脱敏展示（不显示任何明文片段，含首尾 6 位），完整值仅可通过复制按钮获取
- [ ] {P0} 草稿列表默认仅展示待确认（pending）草稿，历史草稿（confirmed / discarded）可切换查看；「人工确认下发」仅对 pending 草稿生效
- [ ] {P0} 变更检测状态可观测：UI 展示每个网域的上次检测时间、当前源数据版本（`source_data_version`）与检测结果（检测到变更生成草稿 / 无变更跳过重算 / checksum 一致自动丢弃）
- [ ] {P0} v0.2 阶段，UI 可多文件预览配置草稿（`prometheus.yml` / targets / `rules.yml` / `blackbox.yml`）并与当前生效版本按文件做 diff
- [ ] {P0} v0.2 阶段，Web 门户可查看各网域 Edge Agent 在线状态、配置版本、WAL 积压（MVP 以采集节点状态列表页形式实现）
- [ ] {P0} **导航结构**：M09 菜单分为两个一级组——「网域与节点管理」（子菜单：网域纳管、采集节点状态）与「配置下发」（子菜单：配置变更确认、下发记录）；「采集节点状态」子菜单常驻，无 EdgeAgent 实例时进入空态引导页
- [ ] {P0} **纳管入口单一化**：网域纳管页仅通过行内「纳管」按钮完成未纳管网域的监控参数配置，页面右上角不再提供「纳管网域」按钮
- [ ] {P0} **网域纳管页列收敛 + 详情抽屉**：网域纳管列表列收敛为 7 列——网域（名称+ID 两行合并）、**网络区域类型（zone_type，Tag 展示，为网域身份并列识别维度——政务云按网络区域、公有云按 region）**、纳管状态、下发通道、运行状态（状态+心跳合并，仅 `agent_pull` 展示）、凭据（脱敏 Token+复制图标，仅 `agent_pull` 展示）、操作（**三槽位固定结构：主操作=纳管/编辑随行状态变化（文本链接样式）+ 详情常驻 + 更多仅 agent_pull 已纳管行显示重置 Token+二次确认，local 行和未纳管行隐藏**）；中心接入地址、Remote Write URL、Agent 类型、描述等配置字段全部进右侧详情 Drawer
- [ ] {P0} **采集节点状态页改节点平铺表 + 组件分区抽屉 + 错误详情 Modal**：主对象改为「采集节点」，一行一个节点——节点（主机名/IP）、网域、整体状态（三档聚合）、采集器状态、拨测器状态、配置同步（含引导按钮）、WAL 积压、最后心跳；组件明细进「查看」右侧抽屉——**按组件类型分区展示（Edge Sync Agent / vmagent / blackbox exporter 各一独立分区，实例名截断+Tooltip）**，**最近错误仅显示一句话摘要（截断~80 字符）+「查看错误详情」按钮**，点击用 **Modal 弹窗**展示完整错误详情（等宽字体、可复制、含所属组件/关联配置版本/发生时间）；页面顶部**可关闭 Alert 组件关系横幅，默认展示，关闭后记住用户选择**；五维筛选全部作用于平铺列
- [ ] {P0} **采集节点状态页组件关系说明**：页面顶部**可关闭 Alert 横幅，默认展示，关闭后记住用户选择**——「一次安装 = 三个进程：Edge Sync Agent（管理进程）+ 采集器 vmagent（采集指标）+ 拨测器 blackbox（可选）。Edge Sync Agent 负责拉取配置并守护另外两个进程，某个进程异常会被自动重启并在此处展示。」；组件抽屉内附「Agent 是管理进程，负责拉取配置和守护另外两个进程」说明
- [ ] {P0} 下发记录 `ConfigDeployment` 可查询成功/失败历史，支持查看失败原因
- [ ] {P1} 平台明确允许本地手工兜底，并在 UI 中展示 `manual_override` 状态
- [ ] {P0} 网域纳管页从 M06 已存在的网域中选择，提供安装指引，明确「边缘节点 = Edge Sync Agent（必装独立组件）+ 采集器（vmagent / prometheus-agent）+ blackbox exporter（可选）」组件构成与部署步骤（离线交付、校验和、`NETWORK_DOMAIN_ID` / `TOKEN` 环境变量、systemd），并消除「Agent 是中心内置」误解；纳管时登记的 `agent_type` 为采集器类型，Edge Sync Agent 无需登记
- [ ] {P0} 网域安装指引为 **3 步人工步骤**（① 下载并校验一体化离线包 ② 配置 `NETWORK_DOMAIN_ID` / `TOKEN` 环境变量 ③ 启动 Edge Sync Agent），采集器与 blackbox exporter 由 Agent 启动后自动部署（并入第③步描述，不单列为人工步骤），无需手动分步安装
- [ ] {P0} **MVP 阶段采集器类型固定 `vmagent`**（`channel=agent_pull` 网域纳管时无需选择），`prometheus-agent` 保留枚举、v0.2+ 开放为可选；采集节点状态列表页按是否存在 EdgeAgent 实例渐进呈现，支持按网域筛选，采用**「网域为主 + 组件分类」**结构（一级按网域聚合、展开按组件类型分类，展示对象为边缘节点 Agent 部署实例（Edge Sync Agent + 采集器组合，PRD 5.2）
- [ ] {P0} 离线二进制包为一体化包（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），安装后 Edge Sync Agent 自动部署并管理本节点采集器与 blackbox exporter 进程（启动守护、健康检查、配置 reload、进程异常自动重启），采集器健康/版本纳入 采集节点状态上报；安装指引为 3 步人工步骤，无需手动分步安装采集器
- [ ] {P0} **进程维修提示（MVP 文档化路径）**：若 Edge Sync Agent 自动重启采集器 / 拨测器进程后仍持续异常，抽屉内「最近错误」展示失败摘要，并提示运维人员到边缘节点通过 systemd 重启服务或按「网域纳管」安装指引重装离线包；中心侧远程重启进程按钮（`force_restart` 指令通道）留 v0.2+ 评审
- [ ] {P0} **网域纳管为登记制闭环**：网域行政记录由 M06 创建（必填网域名称 + 租户归属/授权，ID 规则见 [Module_06](Module_06_Multi_Tenant.md)）；M09 纳管表单最小化（填写监控参数、Token 自动签发、Remote Write URL 由平台自动推导可手动覆盖）；「网域纳管」为必要前置步骤，不可被「安装指引」替代（Token 需纳管时签发，Agent 启动必须携带 NETWORK_DOMAIN_ID / TOKEN）；M06 创建 → M09 纳管 → 安装指引 → Agent 心跳自动上线闭环成立，Agent IP / 主机名由心跳上报补全
- [ ] {P0} **采集节点状态页组件分区抽屉**：点击行或「查看」按钮打开右侧 Drawer，按组件类型分区展示组件实例（Edge Sync Agent / 指标采集器 vmagent|prometheus-agent / 拨测器 blackbox exporter / v0.4+ vmalert / alertmanager，含组件状态 / 版本 / 配置版本 / 最近错误）；组件清单由心跳附带上报（`EdgeHeartbeat.components` → `EdgeAgent.components`），采集器组件状态 / 版本与顶层 `collector_status` / `collector_version` 一致；拨测器仅当网域存在 `job_type=blackbox` 的 ScrapeJob 时展示（否则展示「未部署」）
- [ ] {P0} **配置同步状态引导操作**：采集节点状态列表「配置同步」列展示 **5 档状态**并提供按成因引导按钮——`未下发配置`（`config_sync_status=no_version`）显示「去配置采集 Job」按钮并跳转 M01 采集 Job 页（预选该网域）；`未同步`（`config_sync_status=out_of_sync`）按 `out_of_sync_cause` 三成因区分：*`pending_draft`* 显示「前往配置确认」按钮、*`pull_pending`* 纯展示等待并附带「查看下发记录」链接、*`local_reset`* 显示「立即同步」按钮（中心置 `force_pull` 标记，Agent 下次心跳强制重新拉包并 reload）；`已同步` / `人工覆盖` / `未知` 纯展示
- [ ] {P0} **default 管理域固定 `local` 通道 / 字段条件化 / 安装指引入口 / 组件类型筛选**：`default` 管理域固定 `channel=local`、由中心直接采集、无 `EdgeAgent` 实例（MVP 不支持通道切换、不支持同域混合通道，单网域分布式采集为 v0.4+ 演化场景）；Token / Agent 类型 / Remote Write URL / 安装指引 / 运行态心跳字段仅对 `channel=agent_pull` 网域展示；纳管表单 Agent 类型下拉保留、MVP 仅 `vmagent` 可选（`prometheus-agent` 枚举保留、v0.2+ 开放）；纳管 / 编辑表单仅维护监控配置字段（描述 / Agent 类型 / Remote Write URL，下发通道只读展示），行政字段（名称 / 租户 / 域类型 / 启用状态）由 [Module_06](Module_06_Multi_Tenant.md) 维护，运行态字段（状态 / 最后心跳）由心跳上报并在列头 / 页脚标注来源；采集节点状态页支持**网域 + 组件类型双筛选**（组件类型联动展开明细与统计卡，一级表对应列仅统计匹配组件）
- [ ] {P0} **安装指引为页面顶部常驻提示区**：网域纳管页顶部常驻展示「新网域接入操作流程」（3 步人工步骤 + 边缘节点组件构成 + 凭据获取方式：`NETWORK_DOMAIN_ID`=对应网域 ID、`TOKEN` 经网域行内复制按钮获取），**行内不再提供安装指引按钮 / 弹窗**；纳管成功后自动滚动并高亮该提示区引导完成 Edge Sync Agent 接入
- [ ] {P0} **配置变更确认心智**：确认界面以**人话变更摘要**（`summary`）与**结构化变更清单**（`change_items`：变更类型 / 对象 / 说明 / 风险等级）为核心信息，回答「为什么变更」与「影响如何」；**技术字段（源数据版本 / 生成器版本 / 联合 checksum / 触发摘要）下沉折叠**仅供排障；变更检测状态人话化（检测到变更已生成待确认草稿 / 无新变更 / 内容无变化无需确认）；**高风险变更（删除目标 / 告警规则变更）醒目提示**；「确认发布到监控」语义 = 变更发布审批（go/no-go），与平台自动生成职责分离（平台保证生成内容 = 策略忠实翻译，运维决定是否上线）
- [ ] {P0} **变更对象 = 源数据对象 + 影响的配置文件 + 全链路关联**：变更清单「变更对象」为统一源数据对象枚举（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板，与 Module_01 / 07 功能对象对齐），每行携带**「影响的配置文件」**（configgen 产物差异派生：新增实例 → `targets/*.json`、改抓取频率 → `prometheus.yml`、规则变化 → `rules.yml`）；确认粒度为**变更单级**（一次确认 / 废弃整张变更单，不逐行确认、不拆分发布）；`ConfigVersion` 继承来源变更单号 `change_no`、`ConfigDeployment` 记录 `source_change_no`（均系统自动生成）——变更确认页展示「已发布配置版本」并提供「查看发布记录」入口，下发记录页展示「来源变更单号」列，业务出问题时从变更单直达回滚目标（回滚中心仍以下发记录页为主）
- [ ] {P0} **受影响配置文件高亮**：配置预览对比当前生效版本自动判定受影响的配置文件（prometheus.yml / targets / rules.yml / blackbox.yml），受影响 Tab 加「变更」标记、默认聚焦第一个受影响文件、提示「本次变更影响 N/M 个配置文件」；用户手动切换 Tab 后不再强制跳转
- [ ] {P0} **历史变更记录展示风险等级与确认人**：待确认 / 历史变更列表均展示「风险等级」（取该变更最高风险）与「确认人」（confirmed 显示确认人及确认时间，pending 显示未确认，discarded 显示已废弃），支撑变更审计复盘「谁确认了高风险变更」；确认发布动作记录确认人（当前登录用户）
- [ ] {P0} **下发记录定位为回滚中心 + 变更执行台账**：每次配置发布与回滚自动留痕（谁 / 何时 / 哪个配置版本 / 结果），支持按历史版本一键回滚（回滚动作本身也是记录）；与 Module_06 全局审计日志边界清晰（领域业务对象 vs 平台级操作留痕，联动不重复）
- [ ] {P0} **变更单号**：每个变更（草稿）分配用户可读唯一变更单号（`change_no`，如 `CHG-YYYYMMDD-NNN`），列表 / 详情 / 确认 / 回滚动作均以变更单号为沟通与审计标识（`id` 保留为内部技术键）
- [ ] {P0} **变更详情抽屉式**：列表点击变更行打开右侧抽屉查看详情——变更清单为详情核心（摘要=列表总览、清单=抽屉明细职责分明），配置预览 / Diff、技术信息折叠、确认 / 废弃按钮均收纳于抽屉
- [ ] {P0} **变更检测状态为引导性状态**：不记录检测历史；有待确认变更时提示「检测到 N 个待确认变更，请前往下方列表确认后发布」（含高风险数），无变更时提示「策略/资源变更后自动生成」；与待确认列表联动形成操作引导流；上次检测时间等技术信息折叠
- [ ] {P0} **确认人 MVP 预置**：MVP 阶段确认人 = 预置登录用户上下文（无用户管理），确认动作记录确认人；Module_06 用户管理接入后同步为真实用户
- [ ] {P0} **变更列表支持状态筛选**：按变更状态筛选（待确认 / 已确认 / 已废弃 / 全部，默认待确认），替代原「待确认 / 历史」二分切换；状态维度清晰、可扩展
- [ ] {P0} / **按网域组织确认视图**：变更确认页按网域组织视图，提供「选择网域」切换器，列表展示当前选中网域的变更单（行内保留下发通道标记：`local` / `agent_pull`）；确认动作仍为变更单级（与网域切换无关）；确认抽屉标注发布通道——`local`「确认后立即 reload 生效」、`agent_pull`「发布为配置包，待 Edge Agent 下次心跳拉取生效」
- [ ] {P0} / **回滚异步生效提示**：回滚 `local` 通道网域后提示「已回滚，配置已 reload 生效」；回滚 `agent_pull` 通道网域后提示「已发布历史版本，待 Edge Agent 下次心跳拉取生效」，生效进度经 `config_sync_status`（out_of_sync → in_sync）在 采集节点状态列表可见
- [ ] {P0} **变更单号自动生成**：configgen 生成草稿时自动分配（用户不可手填），格式 `CHG-{YYYYMMDD}-{当日序列}`（如 `CHG-20260803-003`），全局唯一
- [ ] {P0} **提示分区规范**：用户可见文案不含「决策 X」「PRD X.X」等实现层引用；设计决策依据集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区（默认折叠）；代码注释与 PRD 承载实现细节供开发 / AI 参考
- [ ] {P2} P1/P2 阶段，边缘诊断看板可展示 WAL 积压趋势、Remote Write 队列状态、最近错误、24h 断网时长等图表

> **MVP 缺憾补漏验收（决策 42 系列，均为 MVP 子集内可闭合项）**：

- [ ] {P0} **同域至多一张活 `pending` 变更单（决策 42-1）**：同一网域在确认周期内连续变更时，旧的 `pending` 草稿被更新的草稿自动置为 `discarded`（superseded，界面展示「已取代」），变更确认列表同时最多呈现一张待确认单，不会出现同域多张待确认单
- [ ] {P0} **校验失败草稿闭环（决策 42-2 / 45-1）**：`validation_status=failed` 的草稿不可确认，界面展示失败原因（含归因分类与结构化定位），并提供「重新校验」与「废弃」两出口；`pending`（未校验 / 生成中）同样不可确认，提供「重新校验 + 废弃」；重新校验通过后恢复可确认；废弃后保持当前生效配置不变
- [ ] {P0} **废弃回写知情告知（决策 43）**：废弃变更单前弹窗按分类告知源数据影响（新建回退草稿 / 已生效修改保留并提示复现 / 删除停用自动恢复），确认后源数据按分类回写，`change_status` 不再残留 pending；废弃后变更列表不再次出现内容相同的变更单
- [ ] {P0} **`local` 重试下发（决策 42-3）**：`channel=local` 且 `status=failed` 的下发记录提供「重试」按钮，重试复用最近一次版本的下发动作并生成新下发记录；`agent_pull` 通道不提供重试
- [ ] {P0} **变更检测「生成失败」可观测（决策 42-4）**：configgen 生成异常时，变更检测状态明确提示「本次变更生成失败 + 原因」，不推进 `source_data_version`，下一轮自动重试

### 9.2 技术验收（后端机制 / 协议 / 数据契约可验证）

- [ ] {P2} `network_domain_id` 必须全局唯一（ID 规则由 Module_06 统一定义并校验，本模块只读引用）
- [ ] {P0} 配置生成时排除 `Resource.status=offline` 资源：`offline` 资源不进入 `targets/*.json`，`offline` 后下一配置生成周期即从 targets 移除（对齐 [Module_07 8.1](Module_07_Monitoring_Object_Management.md)）
- [ ] {P2} 网域可维护 BlueKing CMDB 云区域 ID 与路径映射
- [ ] {P0} v0.2 阶段，配置中心可轮询 Module_01 与 Module_07 数据并生成按网域的 `prometheus.yml` 与 `targets/*.json` 草稿
- [ ] {P0} Module_01/07 策略/资源写库后无需主动通知 Module_09，配置生成由 Module_09 异步轮询（pull 模式）检测 `updated_at` 变化触发
- [ ] {P0} 策略变更到配置草稿生成（含确认前）的检测延迟不超过当前轮询间隔（自适应退避：有活动短间隔默认 5s，静默期指数退避至默认 120s；`--change-detect.min-interval` / `--change-detect.max-interval` 可覆盖）
- [ ] {P0} 配置中心按源数据版本（各源表 `max(updated_at)` 聚合）触发重算；源数据未变化时不产生无谓轮询
- [ ] {P0} 生成的草稿内容与当前生效 `ConfigVersion` 一致（联合 checksum 相同）时，不进入人工确认列表
- [ ] {P0} `ConfigDraft.metadata` 记录 `source_data_version`、`trigger_summary` 与联合 checksum，可用于追溯变更来源
- [ ] {P1} 边缘拉取配置包后按 `metadata.json` 中的 checksum 校验完整性，校验失败时保留旧配置并记录错误
- [ ] {P0} `channel=local` 网域配置产物为**本地文件集**（`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml`），直接写中心 Prometheus 配置目录，确认后 SIGHUP / `POST /-/reload`；不打包 zip、无 metadata.json 下载校验（版本一致性由 `ConfigVersion` 记录保证）
- [ ] {P1} `channel=agent_pull` 网域配置产物为 **zip 配置包**（含 `metadata.json` 供拉取后 checksum 校验），由 Edge Sync Agent 心跳拉取；配置产物形态按**下发通道**（`local` / `agent_pull`）分层，与域类型解耦；MVP 通道按网域固定（`default` = `local`，其他网域 = `agent_pull`），不支持同域混合通道与通道切换
- [ ] {P1} v0.2 阶段，人工确认后配置中心可生成 `ConfigVersion` 并触发下发
- [ ] {P0} MVP 阶段，单网域场景下确认后的配置可通过 SIGHUP / HTTP reload 应用到中心 Prometheus
- [ ] {P1} v0.2 阶段，Edge Sync Agent 可通过 Token 拉取本域配置包
- [ ] {P1} v0.2 阶段，Edge Sync Agent 心跳可更新网域最后在线时间、配置版本、WAL 积压
- [ ] {P1} Edge Agent 失联超过阈值（默认 5 分钟）时，触发 `EdgeSiteOffline` 告警
- [ ] {P1} 配置包包含 `prometheus.yml`、`targets/*.json` 和 `metadata.json`，且 `prometheus.yml` 已注入 `external_labels.network_domain_id`（`zone_type` / `replica` 按网域登记 / 部署拓扑注入），**不注入 `tenant_id` 与业务标签**
- [ ] {P0} **规则组织与交付**：M09 按 `MonitoringRule` 字段自动派生 Prometheus `group` 生成 `rules.yml`；**规则内容按 `content_mode` 分形态并入：`content_mode=yaml_passthrough`（MVP）将 `rule_content` 原样并入（含 `groups`，M09 不解析/不重排），`content_mode=structured`（v0.3+）按字段化生成**（对齐 Module_01 5.5「规则文件挂载」）；MVP 所有 `channel` 均包含全部 `enabled=true` 规则（`scope` 固定 `central`，中心统一求值）；v0.4+ `channel=agent_pull` 的网域仅包含 `scope=edge`/`both` 规则，`channel=local` 网域仍包含全部规则
- [ ] {P0} **`alertmanager.yml` 不进入 M09 配置产物**：ConfigDraft / ConfigVersion / 配置包中均不包含 `alertmanager.yml`；`alertmanager.yml` 由 Module_08 直接管理并触发 Alertmanager reload
- [ ] {P1} 心跳响应 `config_download_url` 为绝对地址（网域 `center_endpoint` + 相对路径合成）；网闸 / 隔离区场景下不存在中心→边缘的主动连接，所有交互由边缘发起
- [ ] {P0} 配置包必须包含 `targets/*.json`（按 job 分文件，固定文件名覆盖写），且 `prometheus.yml` 的 scrape_configs 以 `file_sd_configs` 引用 targets 文件、不内联 targets 列表
- [ ] {P0} 联合 checksum 涵盖 targets 内容（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)），targets 变化可通过 checksum 裁决进入草稿
- [ ] {P0} `LabelTemplate` / `Resource` 变更产生的差异体现在 `targets/*.json` 内容（labels / 目标列表）上，而非 `prometheus.yml` 结构
- [ ] {P1} targets 变更仅重写 `targets/*.json`（原子写：临时文件 + rename），不触发采集器 reload；仅 `prometheus.yml` 结构变化才触发 reload
- [ ] {P1} 配置生成服务生成 targets JSON 时执行 schema 校验（结构、`host:port`、labels 合法性），弥补 `promtool check config` 对 file_sd 内容不校验的缺口
- [ ] {P1} Edge Sync Agent 解压后对 `targets/*.json` 做解析校验，失败时回滚并保留旧 targets 文件
- [ ] {P0} 当网域存在 `job_type=blackbox` 的 ScrapeJob 时，配置包必须同时包含 `blackbox.yml`，且 `prometheus.yml` 中 blackbox job 的 `__address__` 指向本地 blackbox exporter（如 `127.0.0.1:9115`），blackbox 目标写入 targets JSON 并由 `file_sd_configs` 引用
- [ ] {P0} 下发前调用 `promtool check config` 校验 `prometheus.yml`；存在 `blackbox.yml` 时调用 blackbox exporter `--config.check` 校验；targets JSON 经 configgen 侧 schema 校验
- [ ] {P0} 中心内容校验（`validation_status`）与边缘传输校验（`config_sync_status`）分层清晰：Agent 为哑校验，仅做 `metadata.json` checksum 完整性 + `targets/*.json` 解析校验，不做 promtool 级语法校验（产物合法性由中心内容校验保证，校验失败阻止确认下发）
- [ ] {P1} Edge Sync Agent 在配置包更新后触发同域 blackbox exporter 重载（SIGHUP 或对应 API）
- [ ] {P1} 离线二进制包交付方式包含 blackbox exporter 二进制、capability 设置示例与 systemd 启动依赖
- [ ] {P0} **变更摘要由产物 diff 生成**：`summary` / `change_items` 由 configgen 对比「当前生效版本」与「新草稿」的**产物差异**生成（数据层 diff：targets 实例集合 / job 骨架 / 规则对象），**不依赖 Module_01/07 改造**；话术套用中文模板；规则阈值精确提取依赖规则模型结构化程度（MVP 建议规则模型结构化阈值）
- [ ] {P0} 提供离线二进制包 + systemd 服务文件的交付方式
- [ ] {P0} 不提供 `curl | bash` 一键部署脚本
- [ ] {P2} v0.4 阶段支持 mTLS 证书下发与自动轮转（可选）
- [ ] {P0} {v0.2} 配置生成候选集**仅包含** `draft_status=ready` 且 `enabled=true` 的 `ScrapeJob`；`draft_status=draft` 的 Job 不参与配置生成，不触发有效配置变更
- [ ] {P0} {v0.3} 配置生成候选集**仅包含** `draft_status=ready` 且 `enabled=true` 的 `MonitoringRule`；`draft_status=draft` 的规则不参与配置生成
- [ ] {P0} {v0.2} `ScrapeJob` / `MonitoringRule` 的 `updated_at` 变化且 `draft_status=draft` 时，M09 源数据版本聚合可感知变化，但生成配置时过滤掉草稿对象，通过 checksum 裁决避免产生噪音草稿
- [ ] {P0} {v0.2} 确认下发成功后，M09 将相关 `ScrapeJob` 的 `change_status` 回写为 `deployed`；`agent_pull` 通道在 Edge Agent 成功应用配置包后回写，`local` 通道在中心 reload 成功后回写
- [ ] {P0} {v0.2} 规则编辑 UI 落地后，M09 按同样逻辑回写 `MonitoringRule` 的 `change_status`

> **MVP 缺憾补漏技术验收（决策 42 系列）**：

- [ ] {P0} **同域 pending 取代（决策 42-1）**：生成新 `pending` 草稿且产物与生效版本有实质差异时，同域更早 `pending` 草稿自动置 `discarded(superseded)` 且 `metadata.superseded_by_change_no` 指向新单；同域不存在多于一张的活 `pending`
- [ ] {P0} **校验失败闭环（决策 42-2）**：`validation_status=failed` 草稿禁止 confirm；`revalidate` 仅重校、校验通过后恢复可确认；`discard` 支持校验失败态草稿
- [ ] {P0} **local 重试（决策 42-3）**：`retry` 仅对 `local` 通道 + 原记录 failed 生效，重试生成新 `ConfigDeployment`；`agent_pull` 通道 `retry` 返回 `bad_request`
- [ ] {P0} **生成失败不推进版本（决策 42-4）**：configgen 生成异常时不推进 `source_data_version`、标记失败待重算，下一轮轮询自动重试

> **MVP 缺憾补漏技术验收（决策 43 / 44 / 45 系列）**：

- [ ] {P0} **空变更抑制（决策 44 / F-19）**：产物与生效版本一致时不生成 / 不落库变更单（`ErrNoChanges`），watcher 推进检测基线但不落库；手动触发生成返回 200 + `no_changes`
- [ ] {P0} **pending 期源数据锁定（决策 44-1）**：`change_status=pending` 期间禁止编辑 / 启停 / 删除采集 Job（后端 409 + 前端禁用 Tooltip），避免变更单内容与现实脱节
- [ ] {P0} **同域 pending checksum 比较取代（决策 44 / F-19）**：watcher 遇活 pending 时比较「当前产物 checksum vs 既有 pending checksum」——相同保持 `skipped_pending` 不推进基线（F-14）；不同生成新单取代旧单，`metadata` 互记 `superseded_by_change_no` / `supersedes_change_no`；被取代旧单详情页 Alert「已被新变更单取代」
- [ ] {P0} **废弃分类回写源数据（决策 43 系列）**：`discard` 前经 `discard-impact` 计算分类并弹窗告知；新建未生效 Job 随单回退 `draft`、已生效修改提示+复现（`deployed_snapshot` 回滚备注 v0.3）、删除/停用自动恢复；`change_status` 清理、不允许 `pending` 残留；job 表不引入 rejected/discarded 终态，废弃后轮询不再复现空单
- [ ] {P0} **校验三态确认出口（决策 45-1）**：操作区「仅 `validation_status=passed` 可确认发布」；`pending`（promtool 不可用等未校验态）与 `failed` 均禁确认，提供「重新校验 + 废弃」出口；`platform_fault` 也提供手动「重新校验」自愈出口
- [ ] {P0} **校验归因字段（决策 45-3）**：`ConfigDraft` 持久化 `validation_cause`（`user_config` / `platform_fault`）与 `validation_details`（`[{file,line,message}]`），detail / revalidate 失败响应透传具体校验信息（替代无具象文案）
- [ ] {P0} **targets labels target 级（决策 D43）**：`targets/*.json` 每个 target 的 `labels` 由 `label_template_id` 按对应资源属性转换（target 级），Job 级 labels 仅保留系统字段；标签模板变更 → 命中引用 Job 的 target labels → 触发 `targets/*.json` 重写与变更单
- [ ] {P0} **规则 change_status 回写（决策 31-M2 / issue #18）**：确认下发成功后 `MonitoringRule.change_status` 同步回写 `deployed`（与采集 Job 同口径），废弃场景规则回滚登记待 v0.3

## 10. 术语映射（用户词汇表）

> 后端术语 ↔ 用户语言的唯一权威对照（与 4.x 数据模型「UI 展示名」列一致）。用户可见文案、前端页面、接口文档均以本表对齐；「仅技术信息」术语只出现在技术层（折叠区 / 代码注释 / 接口契约），不作为用户界面文案。

| 后端术语 | 用户语言 | 说明 |
|---------|---------|------|
| `ConfigDraft` | 变更单 / 待确认变更 | 配置生成的草稿，进入人工确认的发布审批对象 |
| `change_no` | 变更单号 | `CHG-YYYYMMDD-NNN`，用户可读唯一标识（类比工单号） |
| `ConfigVersion` / `cv-xxx` | 配置版本 | 变更确认后生成的生效配置版本号 |
| `ConfigDeployment` / `deploy-xxx` | 发布记录 / 下发记录 | 每次发布或回滚的留痕记录 |
| `source_change_no` | 来源变更单号 | 发布记录追溯到其来源变更单 |
| 网域监控纳管 | 网域纳管 | M09 将 M06 已存在的网域接入监控：填写监控参数、生成/重置 Edge Agent Token、提供安装指引；页面/菜单名，区别于 M06 的「网域管理」 |
| 采集节点状态页 | 采集节点状态 | 展示边缘采集节点（Edge Sync Agent + 采集器组合）在线状态、组件分类、配置同步与引导操作；原称「Agent 状态」 |
| `ConfigChangeItem.target` | 变更对象 | 源数据对象：采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板 |
| `ConfigChangeItem.affected_files` | 影响的配置文件 | prometheus.yml / targets/*.json / rules.yml / blackbox.yml |
| `ConfigChangeItem.risk` | 风险等级 | 低风险（新增目标）/ 高风险（删除目标 / 告警规则变更） |
| `validation_status` | 下发前校验 | 配置内容合法性与目标格式检查结果（通过 / 失败） |
| `config_sync_status` | 配置同步 | 边缘 Agent 实际生效版本与中心版本是否一致；五档：`in_sync` / `out_of_sync` / `unknown` / `manual_override` / `no_version`（未下发配置） |
| `out_of_sync_cause` | 未同步成因 | `out_of_sync` 时的引导成因，三档：`pending_draft`（中心存在待确认变更草稿）/ `pull_pending`（Agent 拉包/生效延迟）/ `local_reset`（本地环境/地址变化、checksum 失败保留旧配置等） |
| `manual_override` | 本地手工兜底 | 边缘节点本地手工修改过配置，平台不强制回拉 |
| `wal_backlog_bytes` | WAL 积压 | 弱网 / 断网期间边缘暂存的待回传数据量 |
| `job_type` | 采集 / 拨测 | `standard`=标准采集；`blackbox`=拨测 |
| `agent_type` | Agent 类型 | `vmagent` / `prometheus-agent`（采集器类型） |
| `domain_type` | 域类型 | 管理域 / 边缘域（行政分类，M06 维护） |
| `channel` | 下发通道 | `local`（中心同机写盘 + reload）/ `agent_pull`（Edge Sync Agent 心跳拉包）；决定 Token / Agent 字段 / 安装指引是否展示及配置产物形态 |
| 「下发」（动词） | 下发语义分级 | 本文「下发」在不同上下文承载四个语义，讨论 / 实现时按「下发通道 + 环节」判定归属：**① 确认发布**（变更单 go/no-go 确认动作）；**② local 通道 reload**（`channel=local`：确认后 SIGHUP / `/-/reload` 立即生效）；**③ agent_pull 分发**（中心生成 zip 配置包并开放拉取接口）；**④ agent_pull 拉取**（Edge Sync Agent 心跳拉取 zip 应用）。④与②不重复——②是 `local` 通道、④是 `agent_pull` 通道，二者由同一份 `ConfigVersion` 产物衔接（见 6.5） |
| `source_data_version` | 仅技术信息 | 各源表 `max(updated_at)` 聚合的触发版本 |
| `center_endpoint` | 中心接入地址 | / 该网域视角的中心可达地址（网闸映射后地址），`channel=agent_pull` 时必填，用于合成配置包绝对下载地址 |
| `zone_type` | 网络区域类型 | 网域行政分类（M06 登记）：互联网区 / 政务外网区 / region 等，部署级字典 |
| 联合 checksum | 仅技术信息 | 配置内容完整性校验值（草稿去重 + 拉包校验） |
| `generator_version` | 仅技术信息 | 配置生成器版本 |
| `trigger_summary` / `source_summary` | 仅技术信息 | 变更触发来源摘要 |
| `metadata.json` | 仅技术信息 | 边缘配置包元数据（版本 / 校验值等） |
| `EdgeHeartbeat` | 仅技术信息 | 边缘 Agent 心跳上报协议 |
| `file_sd_configs` / `targets/*.json` | 仅技术信息 | 采集目标文件机制 |
| `external_labels` | 仅技术信息 | 回写指标自动携带的网域 / 网络区域 / 副本标签 |

## 11. 前端交互契约

### 11.1 页面状态矩阵

| 页面 | 状态 | 表现与文案 |
|------|------|-----------|
| 网域纳管页 | 加载中 | 表格骨架屏；顶部提示区展示「加载网域列表中…」 |
| 网域纳管页 | 空态 | 暂无已授权网域；引导联系管理员在「租户与平台管理」中分配网域 |
| 网域纳管页 | 接口错误 | Alert 提示「网域列表加载失败，请稍后重试」；提供「重新加载」按钮 |
| 网域纳管页 | 权限不足 | 页面级空态提示「当前账号无此网域查看权限」 |
| 网域纳管页 | 数据超量 | 表格分页（默认 20 条/页）；支持按名称/网络区域类型筛选 |
| 采集节点状态页 | 加载中 | 表格骨架屏；可关闭 Alert 组件关系横幅默认展示，关闭状态由 `localStorage` 决定 |
| 采集节点状态页 | 空态 | 「尚未接入采集节点」引导卡片：提示先到「网域纳管」完成纳管并按安装指引接入 Edge Sync Agent |
| 采集节点状态页 | 接口错误 | Alert 提示「节点状态加载失败，请稍后重试」；提供「重新加载」按钮 |
| 采集节点状态页 | 权限不足 | 页面级空态提示「当前账号无此页面查看权限」 |
| 采集节点状态页 | 数据超量 | 表格分页；支持按网域/组件类型/状态筛选 |
| 配置变更确认页 | 加载中 | 网域切换器 skeleton + 变更单列表 skeleton |
| 配置变更确认页 | 空态（无待确认变更） | 提示「当前网域暂无待确认变更；策略/资源变更后将自动生成」 |
| 配置变更确认页 | 接口错误 | Alert 提示「变更单加载失败，请稍后重试」 |
| 配置变更确认页 | 权限不足 | 空态提示无权限 |
| 配置变更确认页 | 数据超量 | 列表分页；默认展示 pending，可切换全部/已确认/已废弃 |
| 下发记录页 | 加载中 | 表格 skeleton |
| 下发记录页 | 空态 | 「该网域暂无下发记录」 |
| 下发记录页 | 接口错误 | Alert 提示「下发记录加载失败，请稍后重试」 |
| 下发记录页 | 权限不足 | 空态提示无权限 |
| 下发记录页 | 数据超量 | 表格分页；支持按状态/来源变更单号筛选 |

### 11.2 全局行为规则

- **轮询间隔**：配置变更检测状态区域按自适应退避间隔自动刷新（有活动短间隔默认 5s，静默期指数退避至默认 120s）；采集节点状态页每 30s 自动刷新；下发记录页进入时刷新，不自动轮询。
- **保存后即时触发与跳转**：策略 / 资源页保存成功后，提供「前往配置变更确认」跳转入口，并 best-effort 即时触发一次 `createDraft`（同域活 pending 保活约束保证不重复，仅实时性优化；30s 轮询兜底）。
- **破坏性操作二次确认**：重置 Token、废弃变更单、回滚配置版本操作前弹出 Modal 要求用户二次确认，并明确提示影响范围。
- **表单校验提示位置**：表单字段校验失败时，错误提示置于字段下方；全局错误使用 Alert 置顶展示。
- **提交中防重复**：确认发布、重试下发、重置 Token 等按钮在提交期间置为 loading 并禁用，等待接口返回后再恢复。
- **跨模块跳转与网域预选**：从采集节点状态页点击「去配置采集 Job」跳转 Module_01 采集 Job 页并预选当前网域；点击「前往配置确认」跳转配置变更确认页并预选当前网域。

## Change Log

> 本表为业务沟通决策的精简记录，保留最近 3 版一句话摘要；完整历史见 `docs/05-execution-records/module-09/design-decisions.md`「Change Log（完整历史）」小节。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.51 | 2026-08-31 | 新增 | 决策 53/54 落版（v0.2 契约）：①§3.3「按网域生成配置」补 **Job 网域扇出**——M01 逻辑 Job 可绑定网域集合，生成器按网域自动拆分为各域 scrape_configs / targets / 变更单，分别走各域变更检测 / 校验 / 确认 / 下发（流程不变，跨网域复用不再依赖手工克隆）；②§3.3「实例过滤」补 **filter 模式实时求值**（决策 53 由 v0.3+ 提前 v0.2）——每次生成周期按条件表达式求值，M07 新增资源匹配即自动纳入 targets、属性变化自动移出；③§5.7 补资源网域归属四级解析链交叉引用（决策 52，`bk_cloud_id` 映射为第①级）；本轮为 v0.2 契约落版，MVP 行为不变 | 3.3 / 5.7 | v0.2 | prototyping |
| v1.50 | 2026-08-26 | 修改 | **版本号保持 v1.50（同步联调已拍板决策，非升版）**——按 `module-09/dev-feedback.md`（F-15/F-17/F-19/§8/§9）与 `integration/v0.1/issues.md`（#5/#8/#9/#18）同步正文：①§3.3.3 轮询改**自适应退避**（min 5s / max 120s，`--change-detect.min/max-interval` 可覆盖）、同域 pending 改 **checksum 比较取代**（相同不推基线 / 不同取代并 `supersedes_change_no` 互记）、补**保存后即时触发 + 前往配置变更确认跳转**、空变更抑制（`ErrNoChanges` 不落库）；②§3.4 变更详情补 superseded 旧单「已被新变更单取代」Alert、草稿废弃补**分类回写知情告知**（决策 43）、targets labels **target 级**来源说明（决策 D43）；③§3.5 补**废弃回写语义**（新建回退 draft / 已生效修改提示+复现备注 v0.3 / 删除停用自动恢复 / change_status 防 pending 残留 / 规则回写同口径）；④§3.5.1 补**校验三态操作出口**（仅 passed 可确认，pending 亦禁确认给「重新校验+废弃」）与 **`validation_cause` / `validation_details` 归因**（决策 45）；⑤§5.4 ConfigDraft 字段表补 `validation_status` / `validation_cause` / `validation_details`、metadata 补 `supersedes_change_no`；⑥§8 ConfigDraft 状态机补空变更抑制 / supersede 互记 / 废弃回写流转；⑦§9.1/§9.2/§11.2 验收与轮询表述对齐并补决策 43/44/45 验收项 | 3.3.3 / 3.4 / 3.5 / 3.5.1 / 5.4 / 8 / 9 / 11.2 | MVP / v0.2 | prototyping |
| v1.49 | 2026-08-21 | 修改 | M09 网域契约结构性对齐（决策 28）+ offline 排除提级 P0（决策 29）：①§1 / §3.1.1 / §5.1 删除「1 租户 : N 网域」「禁止跨租户共享网域」「租户前缀」「tenant_id=所属租户」「未指定继承 default」等旧语义，明确「NetworkDomain 行政模型以 Module_06 为单一事实来源」、ID 规则置 M06（id / tenant_id 字段只读引用、归属约束改为行政约束引用、MVP 处理去掉租户继承语义、§9.1/§9.2 同步）；②§3.3「实例过滤」与 9.2 验收将 `offline` 排除提级 MVP 必实现——生成 `targets/*.json` 时按 `Resource.status=offline` 过滤，`offline` 后下一配置生成周期即从 targets 移除；本轮为 PRD 契约落版，不涉及原型行为变更 | 1 / 3.1.1 / 3.3 / 5.1 / 9 | MVP / v0.2 | prototyping |


