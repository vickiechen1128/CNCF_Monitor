# Module 09: 网域与边缘配置中心

> **PRD 状态**: `设计中`（原型已验证至 v1.23，待两段式评审与 ready 确认）
> **PRD 版本**: v1.30
> **产品版本覆盖**: MVP / v0.2 / v1.0
> **原型版本**: v1.23
> **更新日期**: 2026-08-15
> **对应原型**: `docs/prototypes/module-09/`

> **模块类型**: 核心能力模块（v0.2+）
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)
> **目标用户**: 运维架构师、运维工程师

---

## 1. 模块目标

管理 MetricCenter 的**网域（Network Domain）**生命周期与**边缘 Agent（Edge Agent）**接入状态，同时作为监控配置的**生成 / 预览 / 下发中心**，支撑政务网、跨专网、多 DMZ、弱网或物理隔离场景下的 Edge-Cloud 架构。

核心职责：

1. **网域监控纳管（{v1.29} 职责细化）**：从 M06 已存在的网域中选择并标记为「已纳管监控」，填写监控参数（`agent_type` / `remote_write_url` 等）、生成/重置 Edge Agent 认证 Token、提供安装指引；`default` 管理域由系统预置并默认视为已纳管。**M06 是 `NetworkDomain` 行政 Owner（创建/分配/配额），M09 是网域监控纳管 Owner。**
2. **租户-网域关联 {v0.2}**：`NetworkDomain` 数据模型由 M06 与 M09 共同维护，`tenant_id` 字段在 v0.2 必须落地，保证 1 租户 : N 网域、禁止跨租户共享网域、`network_domain_id` 全局唯一。
3. **边缘 Agent 生命周期**：记录每个网域部署的采集器类型（`vmagent` / `prometheus-agent`）、版本、在线状态。
4. **配置生成服务 {v0.2+}**：轮询 Module_01 的 ScrapeJobs / Rules 与 Module_07 的 Resources / LabelTemplates，按网域生成 `prometheus.yml`、`targets/*.json` 与 `rules.yml` 草稿。
5. **草稿与预览 {v0.2+}**：维护 draft 配置态，提供预览、diff 对比与人工确认，确认后再转为待下发版本。
6. **配置下发中心 {v0.2+}**：
   - 单网域 MVP：支持对中心 Prometheus 执行 SIGHUP / HTTP `/-/reload`；
   - 多网域场景：向 Edge Sync Agent 提供配置包下载接口。
7. **配置拉取服务**：为 Edge Sync Agent 提供安全的配置包下载接口。
8. **心跳与状态监控**：接收 Edge Sync Agent 心跳，展示 Agent 在线状态、WAL 积压、配置版本。
9. **安全基础**：Token 认证、拉取接口鉴权、未来支持 mTLS 证书轮转。

> **MVP 阶段**：本模块只实现网域数据模型和默认网域 `default`，不强制要求部署真实 Edge Agent；中心 Prometheus 配置由配置中心生成并通过 UI 确认后 reload。  
> **v0.2 阶段**：实现配置生成 / 预览 / 下发、Edge Sync Agent 配置拉取、心跳上报、Agent 状态列表展示。  
> **v0.4 阶段**：实现 mTLS、证书自动轮转、Token 轮换。

---

## 2. 用户故事

> {v1.24} 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.9 节**；本模块用户故事使用模块命名空间编码（`M09-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- **M09-ARCH-11**：从 M06 已存在的隔离网域中选择一个完成监控纳管，填写监控参数并生成 Edge Agent 接入 Token。
- **M09-ARCH-12**：查看所有网域列表及每个网域 Edge Agent 的在线状态（列表页形式）。
- **M09-OPS-11**：在 Agent 状态列表页查看某个网域 Edge Agent 的最后心跳、WAL 积压和配置版本。
- **M09-OPS-12**：当某个网域 Edge Agent 失联时，触发 `EdgeSiteOffline` 告警（告警规则由 Module_08 管理）。
- **M09-OPS-13**：重置某个网域的 Edge Agent Token。
- **M09-OPS-14**：查看按网域生成的配置草稿（`prometheus.yml` / `targets/*.json` / `rules.yml` 等），并与当前生效配置做按文件 diff 对比。
- **M09-OPS-15**：确认配置草稿后，一键下发并 reload 中心 Prometheus 或 Edge Agent。
- **M09-OPS-16**：查看历史配置版本与下发记录，必要时回滚到上一版本。

> **变更说明（v1.24）**：原 `ARCH-11/12、OPS-11~16` 编码与全局库产品级编码体系存在编号冲突风险（如 OPS-11 同时被 Module_04 使用、OPS-14/15 同时被 Module_10 使用），按全局用户故事编码规则（01_User_Stories.md §4）统一改为模块命名空间编码 `M09-ROLE-NN`。

---

## 3. 核心功能

### 3.1 网域管理

> **{v1.29} 职责边界**：M09 不创建 `NetworkDomain` 行政记录；网域必须先由 [Module_06](Module_06_Multi_Tenant.md) 创建并分配给租户，再由 M09 完成「监控纳管」。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **网域列表** | 展示本租户下所有被授权网域：ID、名称、**纳管状态**（`created` 已创建未纳管 / `monitored` 已纳管）、Agent 类型、最后心跳；未纳管网域可点击「纳管」进入监控参数配置 | P0 |
| **网域纳管（原「网域注册」，{v1.29} 更名）** | 从 M06 已存在的网域中选择一个，填写监控参数（`agent_type` / `remote_write_url` 等），生成认证 Token；**MVP 阶段采集器类型固定 `vmagent`**（Agent 类型下拉保留、仅 `vmagent` 一个选项，`prometheus-agent` 保留枚举、v0.2+ 开放）；**Remote Write URL 由平台自动推导**（中心 ingress 地址 + 网域路径，可手动覆盖）；纳管为**登记制**（生成网域监控参数与 Token，Agent IP / 主机名 / 状态 / 最后心跳由心跳上报补全），是「纳管 → 安装指引 → Agent 自动上线」闭环的必要前置步骤（见下方 3.1.1）；**纳管成功后自动滚动并高亮页面顶部「安装指引」提示区** | P0 |
| **网域编辑** | 修改网域监控参数（Agent 类型、Remote Write 目标、描述）；网域名称/租户/状态等行政字段由 [Module_06](Module_06_Multi_Tenant.md) 维护；表单仅维护**监控配置字段**，运行态字段（状态 / 最后心跳）只读展示 | P1 |
| **网域删除**（由 M06 承责） | 网域行政删除（含资源绑定约束）由 Module_06 「网域管理」执行；本页不提供删除，仅监控纳管状态切换 | — |
| **Token 管理** | 查看/重置 Edge Sync Agent 认证 Token；Token 在 UI 中**完全脱敏展示**（不显示任何明文片段），完整值仅可通过「复制」按钮获取 | **P0** |
| **安装指引** | **页面顶部常驻提示区**（决策 17，而非每行入口/弹窗）：网域管理页顶部展示「新网域接入操作流程」——**3 步人工步骤**① 下载并校验一体化离线包（含 Edge Sync Agent + 采集器 + blackbox exporter 可选）② 配置 `NETWORK_DOMAIN_ID` / `TOKEN` 环境变量 ③ 启动 Edge Sync Agent（systemd）（采集器与 blackbox exporter 由 Agent 启动后自动部署，并入第③步描述）；同时说明**边缘节点组件构成**（Edge Sync Agent 必装 + 采集器 + blackbox exporter 可选）与**凭据获取方式**（`NETWORK_DOMAIN_ID` = 对应网域 ID、`TOKEN` 经网域行内复制按钮获取，UI 完全脱敏）；**行内不再提供安装指引按钮** | P1 |
| **默认网域** | 系统初始化自动创建 `default` 网域，MVP 单网域场景无感知 | P0 |

> **字段语义（决策 16 / {v1.29} 调整）**：网域列表字段分两类——**监控配置字段**（Agent 类型 / Token / Remote Write URL / 描述，纳管或编辑时设置）与**运行态字段**（状态 / 最后心跳，由 Edge Sync Agent 心跳自动上报更新，纳管 / 安装指引完成前为 `unknown` / `-`）。行政字段（ID / 名称 / 租户 / 域类型 / 启用状态）由 [Module_06](Module_06_Multi_Tenant.md) 维护。纳管 / 编辑表单仅维护监控配置字段；运行态字段的来源与语义在列表列头与页脚标注，组件明细与诊断请查看「Agent 状态」页。

#### 3.1.1 纳管 → 安装指引 → 自动上线（登记制闭环，决策 14 / {v1.29} 调整）

**「网域纳管」不能由「安装指引」替代**，两者是「先有身份、再接入」的两个串行步骤：

1. **凭据前置签发**：Edge Sync Agent 启动时必须携带平台签发的 `NETWORK_DOMAIN_ID` 与 `TOKEN`（[6.3](#63-edge-sync-agent-本地行为) 第 2 条），这两个值由网域在 M09 纳管时生成；未预纳管的网域没有可验证身份，Agent 首次心跳 / 拉包无法通过鉴权，更不可能「自动抓取」。
2. **「自动注册」的对象是 Agent 实例而非网域**：Agent 首次成功握手后平台自动创建的是 `EdgeAgent` 运行态记录（上线 / 心跳 / 版本），而 `NetworkDomain`（网络边界 + 租户映射）必须先由 M06 创建并分配给租户——配置生成按网域分组并注入 `external_labels.network_domain/tenant_id`，依赖网域→租户映射先行落地。
3. **安全信任锚点**：不做「Agent 首包即自动建域」——陌生端点自报 domain_id 即可建域存在隐式信任问题，且与「网域 = CMDB 云区域 1:1（v0.4+，[4.7](#47-网域与-blueking-cloud-area-映射)）」的边界约束冲突。
4. **v0.4+ 演化而非取消**：网域与 CMDB 云区域 1:1 后，M06 的网域创建将演化为「从 CMDB 同步 / 校验」，M09 的纳管动作保留；v0.2 前 M06 手动创建网域仍是唯一来源。

闭环流程：**M06 创建网域（行政记录：网域名称 + 租户，`id` 按租户前缀自动生成）→ M09 纳管（登记制：填写监控参数、Token 自动签发、Remote Write URL 自动推导）→ 安装指引（下载一体化离线包 + 注入凭据 + systemd 部署）→ Agent 心跳自动上线（出现在「Agent 状态」页）**。

### 3.2 边缘 Agent 管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **Agent 注册** | Edge Sync Agent 首次拉取配置时自动注册到对应网域 | **P0** |
| **Agent 状态** | 展示在线/离线、最后心跳、最后配置拉取、当前配置版本 | **P0** |
| **配置同步状态** | 展示中心配置版本与边缘实际生效版本是否一致 | **P0** |
| **Agent 类型** | 按网域配置 `vmagent`（默认）或 `prometheus-agent` | **P0** |
| **Agent 状态列表页** | **多网域模式支持按网域与组件类型双筛选**（单网域模式固定 `default`、本页空态）；**仅展示部署了 Edge Agent 的网域**（default 管理域中心直接采集、无边缘 Agent，决策 16）；页面采用**「网域为主 + 组件分类」**结构（决策 15）：**一级表格按网域聚合**（在线 Agent / 采集器运行中 / 拨测器运行中 / 配置同步 / WAL 合计），**展开行按组件类型分类展示**该网域全部组件实例（Edge Sync Agent / 指标采集器 / 拨测器 blackbox exporter / v0.4+ 边缘告警组件 vmalert / alertmanager，含组件状态 / 版本 / 配置版本 / 最近错误）；**组件类型筛选联动展开明细与统计卡**，一级表对应列仅统计匹配组件；组件清单由 Edge Sync Agent 心跳附带上报（PRD 4.3）；页面对象为**边缘节点 Agent 部署实例**（Edge Sync Agent + 采集器组合，PRD 4.2） | **P0** |
| **WAL 与 Remote Write 参数配置** | 按网域配置 WAL 大小、批量、压缩、回传限速 | P1 |
| **WAL 积压监控** | 接收并展示 Agent WAL 积压字节数，反映弱网/断网程度 | P1 |
| **边缘诊断看板（图表/趋势）** | 心跳延迟 RTT 趋势、WAL 积压趋势、Remote Write 队列状态、24h 断网时长、最近错误等可视化图表 | P1/P2 |
| **采集器进程管理** | Edge Sync Agent 负责**本节点**采集器（`vmagent` / `prometheus-agent`）与 blackbox exporter 的进程生命周期管理：随一体化离线包安装、启动守护、健康检查、进程异常自动重启；采集器版本与运行状态纳入心跳上报与 Agent 状态展示（详见 3.9 一体化交付与职责边界） | **P0** |
| **版本管理** | 记录 Agent 版本，支持版本兼容性提示 | P2 |
| **本地告警规则下发** | 将 `scope=edge`/`both` 的告警规则随配置包下发到边缘 | P2 |
| **本地告警通知通道** | 边缘 Agent 支持配置本地飞书/钉钉 webhook，断网时独立通知 | P2 |

### 3.3 配置生成服务 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **轮询策略数据** | 定时轮询 Module_01（ScrapeJobs、Rules）与 Module_07（Resources、LabelTemplates）；读取各源表 `max(updated_at)` 作为「源数据版本」，仅当源数据版本变化时触发重算（预筛，避免无谓轮询） | **P0** |
| **按网域生成配置** | 为每个网域生成 `prometheus.yml`（含 scrape_configs、external_labels）与 `targets/*.json`（file_sd 目标文件）；scrape_configs 通过 `file_sd_configs` 引用本域 `targets/*.json`（固定文件名覆盖写），prometheus.yml 仅含 job 骨架（job_name、metrics_path、params、relabel、file_sd 引用），targets 列表统一放入 targets JSON 文件；`rules.yml` 按规则作用域生成：中心域（default）包含 `scope=central`/`both` 规则，边缘域仅当存在 `scope=edge`/`both` 规则时（v0.4+）随配置包生成，MVP 阶段中心统一求值 | **P0** |
| **标签注入** | 自动注入 `external_labels.network_domain`、租户标签、由 LabelTemplate 展开的标签 | **P0** |
| **实例过滤** | 根据 Job 中手动勾选的实例或筛选条件，从 Module_07 Resources 解析目标列表 | **P0** |
| **草稿生成** | 生成后先写入 `ConfigDraft`，不直接覆盖生效版本 | **P0** |
| **差异检测（版本触发 + checksum 裁决）** | 生成后计算配置内容联合 checksum，与当前生效 `ConfigVersion` 的 checksum 对比：内容一致则不生成新草稿 / 自动丢弃；不一致才进入待确认 | **P0** |
| **规则作用域过滤** | 下发到边缘时仅包含 `scope=edge`/`both` 的规则；中心仅包含 `scope=central`/`both` | P1 |
| **blackbox 配置生成** | 当网域存在 `job_type=blackbox` 的 ScrapeJob 时，生成并打包 `blackbox.yml` | **P0** |

> **scope 业务场景（决策 8）**：MVP~v0.3 阶段 `scope` 固定 `central`（中心统一求值，用户无需配置 scope）；`edge`/`both` 为 v0.4+（P2，由 Module_08 支持）预留，核心场景为**断网自治告警**（边缘 vmalert 本地求值 + 本地通知通道）；`both` 用于边缘快速响应 + 中心聚合（需以标签区分求值域去重）；`central` 用于跨域/全局聚合规则。详见 [Module_01 5.5 scope 字段说明](Module_01_Metric_Collection_Center.md#55-规则编辑模型monitoringrule)。

> **配置文件 × 源数据映射语义**：按网域生成的配置结果按「层级」分为两类文件，驱动源不同：
>
> - `prometheus.yml` = **网域级 + job 结构级**：`global.external_labels`（network_domain / tenant_id）与 `remote_write` 由 `NetworkDomain`（`agent_type`、`remote_write_url`、`tenant_id` 等）驱动；scrape_configs 的 job 骨架（job_name、metrics_path、params、relabel_configs、file_sd 引用）由 `ScrapeJob`、`CITypeExporterMapping`、`ExporterInstallationConfirmation` 驱动；
> - `targets/*.json` = **资源级 + 标签模板级**：目标列表由 `Resource` 实例选择（Job 中手动勾选的实例或筛选条件）驱动；targets 中的 labels 由 `LabelTemplate` 静态展开驱动。
>
> **推论**：`LabelTemplate` / `Resource` 变更触发的是 `targets/*.json` 中 labels 与目标列表的变化，**而非 `prometheus.yml` 结构变化**；相应差异体现在 targets 文件内容上（targets 内容已纳入联合 checksum 裁决，见 3.3.3）。`prometheus.yml` 仅在网域属性或 job 结构（job 增删、抓取参数、relabel 变化）变化时才改变。
>
> **业务指标标签规范消费（{v1.27}，对齐 Module\_07 5.15 / Module\_01 v3.4）**：业务指标（接口 QPS / 延迟 / 错误率）↔ 静态资源的关联在本模块配置生成侧落地——
>
> - **机制 A（MVP）**：`targets/*.json` 中每个 target 的 labels 由 LabelTemplate 静态展开（含 `app_name→app`、`business_domain→biz` 等映射，即 `static_configs[].labels` 注入）——Prometheus 抓取时自动附加到该 target 全部序列（业务指标自动带资源标签，零业务侧成本）；
> - **机制 B（兜底，MVP 提供）**：`metric_relabel_configs` 归一化业务侧非规范标签（如 `biz` / `service` → `app`）；关键限制：relabel 只能操作指标自带标签、**不能引入资源侧数据**（关联键值一致性依赖业务侧按规范埋点，见 Module\_07 5.15）；
> - **关联键**：`app`（值 = 平台 `app_name`）、`biz`（值 = `business_domain`）；**不用 `instance`**（动态实例漂移，v0.2+ 服务发现沿用同一规范）；
> - **v0.2+ 服务发现**：targets 由服务发现结果生成（K8s / Nacos），`__meta_*` → `app` / `service` 标签由 `relabel_configs` 映射（对应 Module\_01 5.4 `service_discovery` 预留）。

#### 3.3.1 `external_labels` 注入说明

`external_labels` 是 Prometheus / vmagent 在 `global` 段配置的一组全局标签，采集器在抓取每条时间序列后会自动把这些标签附加到 series 上，因此所有从该 Agent 回写的指标都会统一携带这些标签。

Module_09 在生成每个网域的 `prometheus.yml` 时，必须在该网域 Agent 配置文件的 `global.external_labels` 中注入以下标签：

```yaml
global:
  external_labels:
    network_domain: "gov-cloud-a"
    tenant_id: "tenant-a"
```

- `network_domain`：取值对应 `NetworkDomain.id`，用于标识指标来源网域。
- `tenant_id`：取值对应 `NetworkDomain.tenant_id`，用于标识指标所属租户。

注入效果：

- 边缘 Agent 抓取的所有指标在 Remote Write 到中心时都会自动携带 `network_domain` 和 `tenant_id` 标签。
- Module_02 查询中心 Prometheus 时，可基于 `network_domain` 标签对用户有权限的网域做进一步过滤或展示来源网域。
- 该机制是 Module_02 实现「按网域查询」与「租户数据隔离」的基础之一。

> **与 Module_10 的边界**：Module_09 只负责为**内部 Edge Agent**（vmagent / prometheus-agent）生成配置时注入 `external_labels`；Module_10 负责**外部异构监控源**（第三方 Prometheus、Zabbix、云监控等）接入时的标签归一化。详见 [7.4 与 Module_10 的边界](#74-与-module-10-的边界)。

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

> **http_sd 未来演进选项（v0.4+）**：由中心 HTTP API 动态下发 targets（`http_sd_configs`）记录为未来演进选项，当前**不采用**：政务/金融专网弱网自治要求下，http_sd 的 targets 不落本地磁盘，断网重启后 targets 丢失、且依赖中心 SD API 在线（中心返回 200+`[]` 有清空目标风险），与「断网自恢复、本地自治」原则冲突；故 MVP / v0.2 阶段 targets 统一采用 file_sd（JSON 目标文件）。

#### 3.3.3 变更检测与草稿去重说明

> **触发模式声明（pull 模式）**：变更检测采用 **pull 模式**——Module_09 异步轮询（默认 30s）检测 Module_01/07 各源表的 `updated_at` 变化，Module_01/07 **不主动通知、不感知 Module_09 的存在**，策略/资源写库即完成其职责。本文档（及设计决策 7）中「XX 变更触发 Module_09 重算」的表述，实际语义均为「Module_09 轮询时检测到 XX 的 `updated_at` 变化」，而非事件推送。

Module_09 采用**「源数据版本触发预筛 + 生成后 checksum 裁决」**的混合机制，避免两个问题：无谓轮询（版本未变化却重算）、草稿噪音（内容无变化却反复进入人工确认）。

**第一层：版本触发预筛（决定"要不要算"）**

- 配置中心定时（默认 30s）读取参与配置生成的各源表 `max(updated_at)`，聚合为「源数据版本」（`source_data_version`）；
- 参与聚合的源表（与设计决策 7 一致）：
  - `ScrapeJob`（含 blackbox 类型）、`MonitoringRule`（Module_01）；
  - `CITypeExporterMapping`（Module_01）；
  - `Resource`、`LabelTemplate`（Module_07）；
  - `ExporterInstallationConfirmation`（Module_01）；
- 仅当 `source_data_version` 大于「上次生成时间」时才触发该网域重新生成，否则跳过本轮。

**第二层：checksum 裁决（决定"算出来要不要确认"）**

- 生成完成后，对配置内容计算**联合 checksum**：`sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)`（按需拼接，缺失文件按空串处理；`targets 内容` 为按固定顺序拼接的本域全部 `targets/*.json` 文件内容，保证 targets 变化可被裁决覆盖）；
- 与当前生效 `ConfigVersion.metadata.checksum` 对比：
  - **一致**：内容无实际变化，不生成新草稿（或生成的草稿直接标记 `discarded`），仅更新 `source_data_version` 记录，不进入确认列表；
  - **不一致**：生成 `status=pending` 的 `ConfigDraft`，`metadata` 记录 `trigger_summary`（触发来源：变更的 job / rule / 表 + 时间），进入人工确认。

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
> - **检测结果**：本轮检测到变更 → 生成了哪些草稿（引用草稿 ID / 触发摘要）；未检测到变更 → 本轮无变更、跳过重算；checksum 一致 → 内容无变化、自动丢弃、不进入确认。

### 3.4 配置变更确认与预览 {v0.2+}

> **职责定位（决策 18）**：本环节面向**不了解 Prometheus 的运维工程师**，重点不是"理解配置如何生成"，而是做**变更发布审批（go/no-go）**。平台自动完成「检测变更 → 生成配置 → 校验 → 过滤无实际影响的变更」（自动生成）；运维负责对进入待确认列表的变更做**人工确认**（发布审批）——确认的对象是**「要不要上线」及「变更影响是否可接受」**，而非「配置怎么生成」。因此确认界面以**人话变更摘要与变更清单**为核心信息，**技术字段（源数据版本 / 生成器版本 / 联合 checksum / 触发摘要）下沉折叠**，仅供追溯排障。
>
> **{v1.28} 技术确认 vs 审批上下文（ITIL 边界声明）**：确认页的**配置预览 / Diff（YAML）是平台内技术确认的运维排查工具**（面向深入排查的运维，决策 19），**不构成审批上下文**——
>
> - **审批信息为主区**：人话变更摘要 + 变更清单（类型 / 对象 / 说明 / 风险等级）+ 影响范围，是确认动作（go/no-go）的决策依据；
> - **技术产物（配置 YAML / Diff / checksum / 源数据版本）为次级/折叠**：仅运维排查使用，不参与审批决策；
> - **未来对接外部审批平台（ITSM）时**：审批上下文**仅含人话摘要 + 影响范围 + 风险等级**（复用变更清单），**技术产物不传出平台**——平台内技术确认与业务审批分层（平台内 = 轻量技术确认 / ITSM = 业务审批流，集成路径待 v0.4+/v1.0 另行设计，本轮仅声明边界）。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **变更摘要（人话）** | 每项待确认变更提供**人话摘要**，回答「为什么发生了变更」，如「新增 1 台服务器（10.0.1.11）加入 node-exporter 采集」「HighCPUUsage 告警规则阈值由 80 调整为 85」；摘要由 configgen 对比「当前生效版本」与「新草稿」的**产物差异**生成（见下方「变更摘要生成机制」，决策 18） | **P0** |
| **变更清单（结构化 + 风险，决策 22）** | 每项变更拆分为结构化清单：变更类型（新增 / 修改 / 移除）、**变更对象 = 源数据对象统一枚举（决策 22：采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板，与 Module_01 采集 Job、规则编辑及 Module_07 资源、标签模板的功能对象对齐，非配置文件本身）**、**影响的配置文件（决策 22：configgen 对比产物差异派生，如仅 targets 变化 → `targets/*.json`）**、人话变更说明、**风险等级**（低风险=新增目标；高风险=删除目标导致监控断点、告警规则变更导致误报/漏报）；高风险变更在列表与详情中**醒目提示**，是运维确认的重点 | **P0** |
| **草稿列表** | 展示每个网域的变更：**变更单号（主标识，决策 20，如 `CHG-20260803-003`，用户可读唯一标识，用于沟通与审计追溯）**、变更摘要、状态、风险等级、确认人、**已发布版本（决策 22：确认后生成的配置版本号 `cv-xxx` + 「记录」入口直达该变更的发布 / 回滚记录）**、下发前校验、生成时间；**支持按变更状态筛选（决策 21，Segmented：待确认 / 已确认 / 已废弃 / 全部，默认待确认）**，替代原「待确认 / 历史」二分切换，状态维度清晰且可扩展 | **P0** |
| **按网域组织确认视图（{v1.26}/{v1.29} 细化）** | **多网域模式下，变更确认页按网域组织视图**——页面顶部提供「选择网域」切换器，**仅展示已纳管网域**（未纳管网域不生成配置草稿，不在切换器中出现；单网域模式直接面向 `default` 管理域，隐藏切换器并提示「单网域模式说明」）；列表展示**当前选中网域的变更单**（单网域上下文，变更单天然归属网域，见 4.1 `ConfigDraft.network_domain_id` 必填），行内保留**域类型标记**（管理域 / 边缘域）；确认动作仍为**变更单级**（决策 22 不变：一次确认 / 废弃整张变更单），与网域切换无关；**确认抽屉标注发布通道**——管理域「确认后立即 reload 生效」、边缘域「发布为配置包，待边缘 Agent 下次心跳拉取生效」；变更检测状态卡（决策 20）同步按选中网域展示 | **P0** |
| **变更详情（抽屉式，决策 20/22）** | 列表点击变更行 → **右侧抽屉**打开变更详情：标题=变更单号 + 状态/风险/校验标签 + 人话摘要；抽屉内以**变更清单（详情核心，含影响的配置文件列）**为首，依次为基本信息（已确认变更展示**已发布配置版本** `cv-xxx`）、技术信息（折叠）、配置产物结构、配置文件预览 / Diff（受影响文件高亮）、下发前校验说明；**确认 / 废弃按钮置于抽屉操作区**；已确认 / 已废弃变更提供**「查看发布记录」入口**（跳转下发记录页定位回滚）。**变更摘要 = 列表总览（一句话），变更清单 = 抽屉详情（逐条明细），职责分明** | **P0** |
| **配置预览（受影响文件高亮）** | 多文件只读预览：`prometheus.yml`、`targets/*.json`、`rules.yml`、`blackbox.yml`、`metadata.json`（YAML / JSON 高亮）；**决策 19：对比当前生效版本自动判定受影响的配置文件，受影响 Tab 加「变更」标记、默认聚焦第一个受影响文件、并提示「本次变更影响 N/M 个配置文件」**，用户优先看到实际变更内容，未受影响文件正常展示（面向需要深入排查的运维） | **P0** |
| **Diff 对比** | 与当前生效版本**按文件**并排 diff（`prometheus.yml` / targets 文件 / `rules.yml` / `blackbox.yml` 逐个文件对比），标红新增/删除/修改项 | **P0** |
| **PromQL 语法校验** | 对生成的 rules 做 PromQL 解析校验（调用 Module_02 或本地校验库） | P1 |
| **人工确认发布（决策 22：变更单级确认）** | **确认粒度为变更单级（一次确认 / 废弃整张变更单，go/no-go 发布审批）**：变更清单各行仅作影响信息展示，**不逐行确认、不拆分发布**；运维工程师确认后，draft 转为 `ConfigVersion`（继承 `change_no`，分配版本号 `cv-xxx`），进入待下发/已下发状态（发布门禁）；**确认动作记录确认人（决策 20：MVP 阶段预置登录用户上下文，Module_06 用户管理接入后同步为真实用户）** | **P0** |
| **草稿废弃** | 允许人工废弃当前 draft，保持当前生效版本不变 | P1 |
| **变更检测状态（引导性，决策 20）** | **定位为引导用户操作的状态说明，不记录检测历史**：有待确认变更 → 提示「检测到 N 个待确认变更，请前往下方列表确认后发布」（含高风险变更数）；无变更 → 提示「当前无待确认变更，策略/资源变更后将自动生成」；**与待确认列表联动形成操作引导流**（先看状态 → 再逐项确认）。上次检测时间、源数据版本、校验值裁决等技术信息折叠展示，供「确认了却没生效」时排障 | **P0** |

> **变更摘要生成机制（决策 18，产品实现方案）**：变更摘要**不是**"策略操作日志"，而是由 configgen 对比**配置产物差异**生成，与既有 pull 模式 / checksum 裁决架构一致、**不依赖 Module_01/07 改造**：
>
> - **数据层 diff**（非 YAML 文本 diff）：targets 为 JSON 数组 → 对比实例地址集合得出"新增/移除实例"；job 骨架为结构化对象列表 → 对比得出"新增/移除采集 job"；规则为结构化对象 → 按 alert 名匹配对比得出"规则新增/修改/移除"；
> - **话术模板**：将结构化变更项套用中文模板生成摘要（如 `新增 ${n} 台服务器（${ip}）加入 ${job} 采集`）；变更项同时产出 `change_items`（类型 / 对象 / 说明 / 风险等级）供确认页结构化展示；
> - **标签模板变更话术（决策 22 对象对齐，{v1.26}）**：`change_items.target=标签模板` 时，人话摘要示例——「标签模板「主机默认模板」修改映射（os_type→os_type 新增 / app→app 变更），影响引用它的采集任务 job-001 / job-002（共 N 个）」；风险等级建议标 **high**（标签变更穿透到引用 Job 的 target labels，可能改变监控数据归属与告警维度）；标签模板变更与 Module_07 模板页「被引用 Job」提示（Module_07 v2.7）联动，用户在模板页可见"待确认"状态；
> - **精度边界**：若规则阈值（如 80→85）只嵌在 PromQL 字符串中，精确提取需解析 PromQL，可退化为「HighCPUUsage 规则表达式已修改」级别；若规则模型将阈值参数结构化，则可直接生成「阈值由 80 调整为 85」——MVP 建议规则模型结构化阈值（Module_08 协同），原型以 mock 字段演示完整话术。

> **targets 前端数据驱动（决策 7）**：`targets/<job_name>.json` 由 configgen 按 job 名自动生成（固定文件名覆盖写）；前端预览的 targets 子 Tab **动态遍历 `ConfigDraft.targets_files` 数据渲染**，**新增 job 无需前端改动**（三层解耦：文件命名=后端生成、展示=数据驱动、用户入口=Module_01/07 策略配置）。

> **提示分区规范（决策 21）**：原型 / 产品页面中的提示按受众分三类，避免相互干扰——
>
> 1. **用户 UI 文案**：面向运维工程师，**不含「决策 X」「PRD X.X」等实现层引用**，讲人话（如「本页确认什么」「变更清单（本次变更的影响）」）；
> 2. **产品 / 技术评审说明**：设计决策依据与 PRD 引用**集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区**，默认折叠，用户无感知，产品评审与开发可展开；
> 3. **开发 / AI 注释**：代码注释与 PRD 数据模型 / 技术字段承载实现细节与决策引用，供后续代码开发（含 AI）理解。
>
> 此规范使**用户看到干净的"未来原型雏形"**，同时**开发侧（含 AI）可从代码注释与 PRD 获取完整设计依据**。

> **变更对象 = 源数据对象 + 影响的配置文件（决策 22）**：变更清单的「变更对象」统一为**源数据对象**（用户在 Module_01 / 07 中修改的根源对象），而非配置文件本身——因为 **targets 变化（新增实例）与抓取频率变化（job 骨架）源头都在「采集 Job」功能**，仅看变更对象无法区分影响范围。configgen 在生成 `change_items` 时同时派生**「影响的配置文件」**维度（对比当前生效版本与新草稿的产物差异：仅 targets 变化 → `targets/*.json`；job 骨架 / relabel 变化 → `prometheus.yml`；规则变化 → `rules.yml`；blackbox 模块变化 → `blackbox.yml`；可能多文件同时变化）。确认页以「变更对象（改了什么）+ 影响的配置文件（影响哪个产物）」两列并排呈现，用户无需理解 Prometheus 文件结构即可判断影响。

> **全链路关联（决策 22）**：变更确认与下发记录建立**双向可追溯**关联——`变更单号（CHG-xxx）→ 配置版本（cv-xxx）→ 下发记录（deploy-xxx）`：
>
> - `ConfigVersion` 继承来源 draft 的 `change_no`（确认时写入），用户看到「已确认」即知其发布版本号；
> - `ConfigDeployment` 记录 `source_change_no`（来源变更单号），下发记录页展示该列；
> - 变更确认页：已确认 / 已废弃变更展示**已发布配置版本**并提供**「查看发布记录」**入口（跳转下发记录页）；列表「已发布版本」列提供「记录」快捷入口；
> - 业务出问题时用户路径：从变更确认页按变更单号找到对应**配置版本号** → 进入下发记录页按版本一键**回滚**（回滚中心仍以下发记录页为主，变更页提供入口不重复实现）。

### 3.5 配置下发与分发 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **中心 Prometheus Reload {MVP}** | 单网域/中心模式：确认后执行 SIGHUP 或 POST `/-/reload` | **P0** |
| **下发记录（决策 22）** | 记录每次发布与回滚的**来源变更单号（`source_change_no`，自动生成：经 `config_version_id` → `ConfigVersion.change_no` 透传）**、配置版本、目标、操作人、时间、结果、失败原因；部署 ID（`deploy-xxx`）与配置版本号（`cv-xxx`）均为系统自动生成，用户不可手填 | **P0** |
| **版本回滚** | 支持选择历史 `ConfigVersion` 重新下发，覆盖当前生效配置（回滚动作本身也生成一条下发记录，状态 rolled_back） | **P0** |
| **回滚异步生效提示（{v1.26}）** | 回滚的生效语义**按域类型区分**：管理域（default）= 重新下发后**立即 reload 生效**；**边缘域 = 重新发布历史 `ConfigVersion`（生成对应配置包），生效依赖边缘 Agent 下次心跳拉取（准实时 30s）**；UI 在回滚动作后给出对应提示——管理域「已回滚，配置已 reload 生效」、边缘域「已发布历史版本，待边缘 Agent 下次心跳拉取生效」；生效进度由 `config_sync_status`（out_of_sync → in_sync）表达，Agent 状态列表可见（见 4.2） | **P0** |
| **多目标分发** | 按网域分发到对应 Edge Sync Agent；支持批量选择网域下发 | P1 |
| **配置包拉取接口** | `GET /api/v2/platform/edge/config?network_domain=<id>` | **P0** |
| **配置版本比对** | Edge Sync Agent 上报当前版本，无更新时返回 304 | **P0** |
| **配置包下载** | 返回包含 `prometheus.yml`、`targets/*.json`、`blackbox.yml`、`rules.yml`、`metadata.json` 的压缩包 | **P0** |
| **下发前校验** | 下发前调用 `promtool check config` 校验 `prometheus.yml`；存在 `blackbox.yml` 时调用 blackbox exporter `--config.check` 校验；targets JSON 由生成器侧 schema 校验（见 3.3 / 3.5.1） | **P0** |
| **blackbox 重载** | 配置包更新后，Edge Sync Agent 需触发 blackbox exporter 重载（SIGHUP 或对应 API） | **P0** |

> **下发记录定位（决策 19）**：下发记录是**配置变更执行台账 + 回滚中心**，而非日常高频流水页——每次「配置变更确认」发布到监控，以及每次回滚，均自动留痕（谁 / 何时 / 发布或回滚了哪个 `ConfigVersion` / 结果如何）。价值：
>
> 1. **变更审计（ITIL）**：生产配置发布必须留痕，用于合规审计；
> 2. **故障回溯**：监控出问题时排查「配置最后一次生效时间与结果」；
> 3. **回滚支撑**：回滚的前提是知道「发过哪些版本、发到哪个目标」，下发记录即回滚的目标选择依据；回滚 = 选择历史 `ConfigVersion` 重新下发，回滚动作本身也是一条下发记录（rolled_back）——类比 K8s rollout history / Git revert。
>
> **与 Module_06 全局审计的边界（决策 19）**：下发记录（`ConfigDeployment`）是 Module_09 的**领域业务对象**（有状态机 pending/success/failed/rolled_back、可操作回滚、含配置版本/目标/校验等结构化字段），承担**领域审计**（每个网域发过什么版本、结果如何）；Module_06 的**全局审计日志**是平台级横切操作留痕（actor/action/resource/time，P2，请求级事件由 Module_03 收集）。两者**联动不重复**：下发/回滚动作可同时写入一条全局审计日志，但领域数据不迁移、互不替代。

> **reload 策略分离（targets vs 结构）**：targets 变化（增删实例、标签变更）时，仅原子重写对应 `targets/*.json` 文件（临时文件 + rename，避免采集器读到半写文件），**不触发**采集器主配置 reload——file_sd 由采集器磁盘监听 / 轮询自动感知并应用；仅当 `prometheus.yml` 结构（job 骨架、external_labels、remote_write、relabel 等）变化时才触发 reload。

#### 3.5.1 下发前校验与 blackbox 重载说明

- 配置包生成后、下发或允许拉取前，必须先通过校验：
  - `promtool check config <prometheus.yml>` 确保 `prometheus.yml` 语法与引用合法；
  - `blackbox_exporter --config.check --config.file=<blackbox.yml>` 确保 `blackbox.yml` 模块定义合法；
  - **configgen 侧 targets schema 校验**：配置生成服务生成 targets JSON 时校验文件结构（JSON 顶层数组、`targets` / `labels` 字段）、`host:port` 地址格式与 labels 合法性（遵循标签命名规则，禁止覆盖 `__address__` 等内置标签），不通过则拒绝生成草稿。
- **promtool 校验缺口说明**：`promtool check config` 对 `file_sd_configs` 只检查文件**存在性**（文件缺失仅 WARNING），**不校验 SD 文件内容**（社区已知缺口）；该缺口由 configgen 侧的 targets schema 校验弥补（上一条）。
- 校验失败时，当前 `ConfigDraft` / `ConfigVersion` 保持原状态，不进入下发流程，并记录错误原因。
- **校验分层定位**：以上校验均为**中心内容校验**（防**生成错误**），与之对应的是 Edge Sync Agent 拉包后的**边缘传输校验**（防**传输损坏/篡改/半写文件**）；中心内容校验与边缘传输校验的分层关系与衔接见 [6.4](#64-中心边缘校验分层与衔接)。
- Edge Sync Agent 解压配置包后，需同步通知同域 blackbox exporter 重新加载 `blackbox.yml`（推荐 `SIGHUP`；如 blackbox exporter 提供 reload API，也可调用 API）；采集器（vmagent / prometheus-agent）仅当 `prometheus.yml` 结构变化时才需 reload，targets 文件变化由 file_sd 自动感知（见 3.5 reload 策略分离）。

### 3.6 本地手工兜底声明

平台**只保证通过 UI 下发并成功 reload 的配置与数据库期望态一致**。允许运维工程师在紧急情况下直接修改本地磁盘上的 `prometheus.yml` 或 Edge Agent 配置文件进行手工兜底；平台不会自动强制 reconcile 本地修改。

- 本地手工修改后，UI 展示的配置版本可能高于实际生效版本，配置同步状态显示为 `out_of_sync` 或 `manual_override`。
- 运维工程师需自行在 UI 重新确认并下发，以恢复平台一致性。
- 该策略用于防止平台自身 bug 导致监控系统整体不可用。

### 3.7 安全与证书（v0.4+）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **mTLS 证书下发** | 为 Edge Agent 签发客户端证书 | P2 |
| **证书自动轮转** | 证书到期前自动更新，Edge Sync Agent 热加载 | P2 |
| **Token 轮换** | 支持重置 Token 并强制 Edge Agent 重新认证 | P2 |

### 3.8 Agent 状态列表与边缘诊断看板

政务网/专网最常发生网络抖动或防火墙封堵，必须提供诊断能力。MVP 阶段以**Agent 状态列表页**满足基本可观测需求，图表/趋势类看板延后至 P1/P2。

#### 3.8.1 MVP：Agent 状态列表页（网域为主 + 组件分类）

页面采用**「网域为主 + 组件分类」**结构（决策 15），兼顾「网域边界可见」与「组件维度可分类」；**仅展示部署了 Edge Agent 的网域**——default 管理域由中心直接采集、不部署 Edge Agent，不产生 `EdgeAgent` 实例，故不出现在本页（决策 16）；单网域模式本页为空态（PRD 3.11 单网域模式隐藏「Agent 状态」入口）。

**筛选（决策 16）**：多网域模式支持**网域 + 组件类型双筛选**——组件类型（全部 / Edge Sync Agent / 指标采集器 / 拨测器 / v0.4+ 边缘告警组件）联动**展开明细与统计卡**，一级表对应列（采集器 / 拨测器）仅统计匹配类型组件；统计卡随筛选动态展示（筛选具体组件类型时仅显示该类型相关卡）。

**一级表格（网域聚合行）**

| 字段 | 说明 |
|------|------|
| 网域 | `network_domain_id` / 网域名称 + 域类型（边缘域；有 Agent 才展示） |
| 在线 Agent | 该网域 Edge Sync Agent（边缘节点）在线数 / 总数 |
| 采集器 | 指标采集器（vmagent / prometheus-agent）运行中数 / 总数 |
| 拨测器 | blackbox exporter 运行中数 / 总数；未部署表示该网域无 `job_type=blackbox` 的 ScrapeJob |
| 配置同步 | 该网域配置未同步（out_of_sync / manual_override）Agent 数或已同步 |
| WAL 积压（合计） | 该网域全部 Agent WAL 积压字节数合计 |
| 最后心跳 | 该网域最近一次心跳时间 |

**展开子表（组件分类明细）**：按组件类型分类展示该网域全部组件实例——Edge Sync Agent（必装独立组件）、指标采集器（vmagent / prometheus-agent）、拨测器（blackbox exporter，可选）、v0.4+ 边缘告警组件（vmalert / alertmanager）；每行含组件类型 Tag、组件实例、所属节点、组件状态、组件版本、配置版本、最近错误。组件清单由 Edge Sync Agent 心跳附带上报（PRD 4.3）。

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
> **Edge Sync Agent 部署定位（决策 9）**：Edge Sync Agent 是**部署在边缘监控代理节点的独立客户端程序**，**非中心平台内置进程**；与中心通过 **outbound HTTPS 443 + 每网域 Token** 通信（心跳 / 配置拉取 / remote_write 全部由边缘主动出站，中心无入站端口，无需开放防火墙入站规则）；**MVP 单网域不部署**（中心直接采集），**v0.2+ 多网域模式下每个边缘节点部署一个**（离线二进制包 + systemd 交付，见上表）。
>
> **边缘节点组件构成（v1.11）**：边缘监控代理节点由三部分构成——
>
> - **Edge Sync Agent（必装独立组件）**：部署在边缘节点的客户端程序，**非中心平台内置**；负责与中心通信（outbound HTTPS 443 + 每网域 Token 的心跳 / 配置拉取）、控制本地采集器 reload（PRD 3.9 交付方式 / 6.x 协议）；
> - **采集器（vmagent 或 prometheus-agent，二选一）**：由 `NetworkDomain.agent_type` 登记；负责抓取与 remote_write，由 Edge Sync Agent 控制；
> - **blackbox exporter（可选）**：网域存在 `job_type=blackbox` 的 ScrapeJob 时随离线包附带（见上）。
>
> **一体化交付 + 职责边界（v1.12）**：离线二进制包为**一体化包**（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），一次安装即完成边缘监控代理节点全部组件部署，**无需手动分别安装**采集器/blackbox。安装后由 Edge Sync Agent 自动部署并管理**本节点**采集器与 blackbox exporter 进程：随包安装、启动守护、健康检查、配置包更新时 reload、进程异常自动重启，采集器版本与运行状态纳入心跳上报与 Agent 状态展示（见 3.2 采集器进程管理）；启动顺序为 **blackbox exporter → 采集器**（与上述 systemd 启动依赖声明一致）。
>
> **组件清单随心跳上报（v1.15）**：Edge Sync Agent 心跳**附带上报本节点组件清单**（组件类型 / 版本 / 运行状态 / 配置版本 / 最近错误，见 [4.3](#43-心跳上报edgeheartbeat)），平台据此在「Agent 状态」页按组件类型分类展示（决策 15，见 3.2 / 3.8.1）；采集器与拨测器组件状态异常（stopped / 错误）可直接定位到具体组件，无需展开整个节点排查。
>
> **职责边界**：Edge Sync Agent 只管理**本节点**组件生命周期，**不做**下游节点 exporter 安装（目标主机 node-exporter 等由 Module_01 的 Exporter 安装流程负责，本轮因安全边界暂不纳入 Agent 管理范围）；**不做**指标抓取（采集器职责）；**不做**告警求值（MVP~v0.3 中心统一求值，v0.4+ 边缘自治由 vmalert 负责）。
>
> **登记语义**：网域在 M09 纳管时登记的 `agent_type` 是**采集器类型**（`vmagent` / `prometheus-agent`），Edge Sync Agent 为**必装组件、无需登记**；`EdgeAgent` 实例即代表「Edge Sync Agent + 采集器」组合（见 [4.2](#42-边缘-agentedgeagent)）。

### 3.10 WAL 与 Remote Write 参数（按网域配置）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `wal.max_size` | 20GB | 本地 WAL 最大磁盘占用 |
| `wal.min_backfill_age` | 1h | 只回传最近 1 小时内数据，避免历史风暴 |
| `remote_write.queue.max_samples_per_send` | 2000 | 每批次发送样本数 |
| `remote_write.queue.max_shards` | 50 | 并发发送分片数 |
| `remote_write.queue.retry_on_rate_limit` | true | 触发限流时自动退避重试 |
| `remote_write.compression` | snappy | 传输压缩算法 |

### 3.11 单网域与多网域模式 {MVP / v0.2}

MetricCenter 通过**租户级开关** `Tenant.multi_site_enabled` 区分两种部署模式，以兼顾单机简单场景与政务网/专网多隔离域场景。MVP 阶段仅有 `platform_admin` 租户，该开关对该租户生效；v0.2+ 各租户可独立开启多网域能力。

| 模式 | 开启条件 | 用户感知 | 数据模型 |
|---|---|---|---|
| **单网域模式（默认）** | `Tenant.multi_site_enabled=false` | 无网域/站点概念；不展示「网域管理」与「Agent 状态」菜单；配置下发中心直接面向中心 Prometheus | 仅存在 `default` 网域 |
| **多网域模式** | `Tenant.multi_site_enabled=true` | 展示「网域管理」、「Agent 状态」、「按网域配置下发」 | 多网域，每个网域独立 Agent 与配置包 |

#### 单网域模式行为

- 系统初始化时自动创建 `default` 网域，所有资源默认归属 `default`。
- Web 门户不展示「网域管理」菜单，用户看不到网域列表、Token、Agent 状态。
- 配置下发中心不展示网域选择器；配置草稿生成后仅触发中心 Prometheus 的 `/-/reload`。
- Edge Sync Agent 协议接口在 UI 中不暴露，但**后端保留协议能力**，便于用户后续从单网域扩展到多网域时无需重新部署 Agent。

#### 多网域模式行为

- 用户需先在 [Module_06](Module_06_Multi_Tenant.md) 创建网域，再在本模块完成监控纳管，生成 Edge Agent 认证 Token。
- 在隔离网域部署 Edge Sync Agent 后，心跳自动注册到对应网域。
- 在 [Module_07](Module_07_Monitoring_Object_Management.md) 配置资源时，资源必须选择归属网域（`default` 作为中心管理域继续存在）。
- 在 [Module_01](Module_01_Metric_Collection_Center.md) 配置 ScrapeJob 时，按网域筛选目标实例。
- 配置中心按网域生成 `ConfigDraft`，经确认后生成 `ConfigVersion`；中心管理域（`default`）走 `/-/reload`，边缘域由 Edge Sync Agent 拉取配置包。

#### 模式切换与数据兼容

- 从单网域切换到多网域：已有资源与配置保持归属 `default` 网域，用户可继续在 `default` 网域下管理中心 Prometheus 采集，或逐步迁移到新网域。
- 从多网域切换回单网域：系统仅展示 `default` 网域数据，其他网域数据不删除但隐藏；再次切回多网域后恢复显示。
- `default` 网域类型为 `management`（管理域），**禁止删除**；允许用户修改其 `name` 和 `description` 以与云区域命名保持一致。其他网域类型默认为 `edge`（边缘域）。
- **default 管理域不部署 Edge Agent（决策 16）**：default 由中心 Prometheus 直接采集，不产生 `EdgeAgent` 实例；「Agent 状态」页仅展示部署了 Edge Agent 的 `edge` 网域，default 管理域不出现在该页（单网域模式本页为空态）。

#### 配置产物形态分层（按域类型，决策 6）

配置产物形态**按域类型分层**，而非按单/多网域开关分层：

| 域类型 | 示例 | 配置产物形态 | 下发 / 校验机制 |
|--------|------|--------------|------------------|
| `management`（管理域） | `default` | **本地文件集**：`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml` | 直接写中心 Prometheus 配置目录，确认后 SIGHUP / `POST /-/reload`；**无 zip、无 metadata.json 下载校验**（版本一致性由 `ConfigVersion` 记录保证） |
| `edge`（边缘域） | 各隔离网域 | **zip 配置包**（含 `metadata.json`） | 由 Edge Sync Agent 心跳拉取，拉取后按 `metadata.json` 中的 checksum 做完整性校验 |

> 分层依据是**域类型**（`management`/`edge`），而非单/多网域开关：**多网域模式下的 `default` 管理域同样走本地文件集**（zip 与 metadata.json 仅对边缘域 Agent 拉取有意义）。

---

## 4. 数据模型

### 4.1 网域（NetworkDomain）

> **{v1.29} 职责边界**：`NetworkDomain` 数据模型由 **Module_06（行政 Owner）** 与 **Module_09（监控纳管 Owner）** 共同维护：
>
> - **M06 维护行政字段**：`id`、`name`、`description`、`domain_type`、`tenant_id`、配额与启用状态；网域创建/编辑/禁用/租户分配在 M06 完成。
> - **M09 维护监控纳管字段**：`agent_type`、`remote_write_url`、`token`、运行态字段（`status` / `last_heartbeat` / `agent_version`）及关联的 `EdgeAgent` 实例；网域监控纳管、配置生成、下发、Agent 生命周期在 M09 完成。
>
> M09 不创建新的 `NetworkDomain` 行政记录，只把 M06 已存在的网域标记为「已纳管监控」。

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 网域 ID | 网域唯一标识，必须全局唯一；v0.2 起建议采用租户前缀，如 `<tenant_id>-gov-cloud-a`、`default` |
| name | string | ✅ | 网域名称 | 网域展示名；`default` 网域的 `name` / `description` 允许修改以匹配客户云区域命名 |
| description | string | ❌ | 描述 | 网域描述 |
| domain_type | enum | ✅ | 域类型 | 网域类型：`management`（管理域，如 `default`）/ `edge`（边缘域）；`management` 类型网域禁止删除 |
| tenant_id | string | ✅ | 租户 | {v0.2} 所属租户 ID；`platform_admin` 表示平台默认租户，禁止跨租户共享网域 |
| cmdb_cloud_area_id | string | ❌ | 仅技术信息 | {v0.4+} 对应 BlueKing CMDB 云区域 ID（`bk_cloud_id`） |
| cmdb_cloud_area_path | string | ❌ | 仅技术信息 | {v0.4+} 对应 BlueKing CMDB 云区域路径 |
| token | string | ✅ | 认证 Token（脱敏） | Edge Sync Agent 拉取配置时的认证 Token |
| agent_type | enum | ✅ | Agent 类型 | 边缘采集器类型：**MVP 阶段固定 `vmagent`**（纳管时无需选择）；`prometheus-agent` 保留枚举、**v0.2+ 开放**为可选 |
| remote_write_url | string | ✅ | 回传地址 | 该网域 Agent Remote Write 目标地址 |
| status | enum | ✅ | 状态 | online / offline / unknown（运行态字段，由心跳上报更新） |
| last_heartbeat | datetime | ❌ | 最后心跳 | 边缘 Agent 最后心跳时间（运行态字段） |
| agent_version | string | ❌ | Agent 版本 | 边缘 Agent 版本 |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |
| updated_at | datetime | ✅ | 仅技术信息 | 更新时间 |

> **MVP 处理**：系统初始化时自动创建一个 `id=default`、`domain_type=management` 的默认网域，所有未指定网域的资源自动归属到默认网域，保证单网域场景无感知。默认网域 `default` 归属于 `platform_admin` 租户，所有未指定租户的资源默认继承该归属。`default` 网域的 `name` / `description` 允许用户修改以匹配云区域命名，但禁止删除。
>
> **归属约束**：一个网域必须且只能归属一个租户（1 租户 : N 网域），禁止跨租户共享网域；`network_domain_id` 必须全局唯一，建议创建时校验租户前缀。

### 4.2 边缘 Agent（EdgeAgent）

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
| config_sync_status | enum | 配置同步 | in_sync / out_of_sync / unknown / manual_override |
| wal_backlog_bytes | int | WAL 积压 | WAL 积压字节数 |
| remote_write_url | string | 回传地址 | Remote Write 目标地址 |
| last_error | string | 最近错误 | 最近错误信息 |
| components | json | 组件清单 | {v1.15} 本节点组件清单：组件类型 / 名称 / 运行状态 / 版本 / 配置版本 / 最近错误（由心跳附带上报，PRD 4.3）；Agent 状态页按组件类型分类展示（决策 15） |
| collector_status | enum | 采集器状态 | 顶层采集器运行状态（与 `components` 中 `type=collector` 的 status 一致；online / offline / unknown / not_deployed） |
| collector_version | string | 采集器版本 | 顶层采集器版本（与 `components` 中 `type=collector` 的 version 一致；未部署为空） |
| created_at | datetime | 仅技术信息 | 创建时间 |
| updated_at | datetime | 仅技术信息 | 更新时间 |

> **模型语义（v1.11/{v1.29} 调整）**：`EdgeAgent` 实例代表「**边缘节点上的 Agent 部署 = Edge Sync Agent + 采集器组合**」，即一个边缘监控代理节点上的完整 Agent 部署单元；`agent_type` 字段为**采集器类型**（`vmagent` / `prometheus-agent`），由网域在 M09 纳管时在 `NetworkDomain.agent_type` 登记（见 [4.1](#41-网域networkdomain)），Edge Sync Agent 为必装组件、无需单独登记。
> **default 管理域不产生实例（决策 16）**：`default` 由中心 Prometheus 直接采集、不部署 Edge Agent，因此不存在 `network_domain_id='default'` 的 `EdgeAgent` 实例；「Agent 状态」页仅展示有实例的 `edge` 网域。
> 心跳（[4.3](#43-心跳上报edgeheartbeat)）由 **Edge Sync Agent** 上报，携带采集器类型（`agent_type`）、版本（`version`）、`config_version`、WAL 积压（`wal_backlog_bytes`）等，用于更新 `EdgeAgent` 的在线状态、最后心跳、配置同步状态与 WAL 积压字段。
> **组件清单（v1.15）**：`components` 描述该边缘节点上全部组件实例（Edge Sync Agent 必装 + 采集器必装 + blackbox exporter 可选 + v0.4+ vmalert / alertmanager），由心跳附带上报（见 4.3），是「Agent 状态」页组件分类展示（决策 15）的数据来源；采集器组件状态 / 版本与顶层 `collector_status` / `collector_version` 保持一致。

### 4.3 心跳上报（EdgeHeartbeat）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|----------|------|
| network_domain_id | string | 仅技术信息 | 所属网域 ID |
| agent_type | enum | 仅技术信息 | `vmagent` / `prometheus-agent` |
| version | string | 仅技术信息 | Agent 版本 |
| config_version | string | 仅技术信息 | 当前生效配置版本 |
| wal_backlog_bytes | int | 仅技术信息 | WAL 积压字节数 |
| remote_write_queue_size | int | 仅技术信息 | Remote Write 发送队列长度 |
| remote_write_last_error | string | 仅技术信息 | 最近 Remote Write 错误 |
| components | json | 仅技术信息 | {v1.15} 本节点组件清单（组件类型 / 名称 / 运行状态 / 版本 / 配置版本 / 最近错误），用于更新 `EdgeAgent.components` 并支撑「Agent 状态」页组件分类展示（决策 15） |
| timestamp | datetime | 仅技术信息 | 心跳时间戳 |

### 4.4 配置草稿（ConfigDraft）{v0.2+}

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 仅技术信息 | 草稿唯一标识（内部技术键） |
| change_no | string | ✅ | 变更单号 | {v1.20} **变更单号**（决策 20）：用户可读唯一标识（如 `CHG-20260803-003`），类比工单号 / PR 号，用于变更沟通与审计追溯（「回滚变更单 CHG-20260803-003」）；**自动生成**（决策 21）：configgen 在生成草稿时自动分配（用户不可手填），格式 `CHG-{YYYYMMDD}-{当日序列}`（如 `CHG-20260803-003`），全局唯一 |
| network_domain_id | string | ✅ | 网域 | 所属网域 ID |
| source_version | string | ❌ | 仅技术信息 | 基于哪个 ConfigVersion 生成，可为空（首次生成） |
| prometheus_yml | text | ✅ | 仅技术信息 | 生成的 prometheus.yml 内容（仅 job 骨架，targets 见 `targets_files`） |
| rules_yml | text | ❌ | 仅技术信息 | 生成的 rules.yml 内容（可选） |
| blackbox_yml | text | ❌ | 仅技术信息 | 生成的 blackbox.yml 内容（可选） |
| targets_files | json | ❌ | 仅技术信息 | 生成的 targets 内容承载字段：按 job 名组织的 targets 列表（file_sd 目标文件，如 `{"node-exporter": [{"targets": [...], "labels": {...}}], "blackbox-http": [...]}`；网域无任何目标时为空对象） |
| metadata | json | ✅ | 仅技术信息 | 生成时间、生成器版本、`source_data_version`、`trigger_summary`（触发来源 job/rule/表 + 时间）、联合 checksum（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）、来源 job/rule 摘要 |
| summary | string | ✅ | 变更摘要 | {v1.18} **人话变更摘要**（决策 18）：由 configgen 对比当前生效版本与草稿的产物差异生成，面向运维回答「为什么发生了变更」，如「新增 1 台服务器（10.0.1.11）加入 node-exporter 采集」 |
| change_items | json | ✅ | 变更清单 | {v1.22} **结构化变更清单**（决策 18/22）：`[{type: add/modify/remove, target: 源数据对象枚举（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）, description, risk: low/high, affected_files: 影响的配置文件（prometheus.yml / targets / rules.yml / blackbox.yml）}]`，供「配置变更确认」页结构化展示（变更类型 / 变更对象 / 说明 / 风险等级 / 影响的配置文件） |
| status | enum | ✅ | 状态 | pending / confirmed / discarded |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |
| updated_at | datetime | ✅ | 仅技术信息 | 更新时间 |
| confirmed_by | string | ❌ | 确认人 | 确认人 |
| confirmed_at | datetime | ❌ | 确认时间 | 确认时间 |

> `blackbox_yml` 在所属网域存在 `job_type=blackbox` 的 ScrapeJob 时必填，且必须随 `prometheus.yml` 一同下发。
>
> `targets_files` 下发时按 job 名拆分为 `targets/<job_name>.json` 文件（固定文件名覆盖写），job 名中的非法文件名字符需做安全转换，保证文件名稳定可预测。

### 4.5 配置版本（ConfigVersion）{v0.2+}

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 配置版本 | 版本唯一标识（`cv-xxx`），建议作为配置包版本号 |
| network_domain_id | string | ✅ | 网域 | 所属网域 ID |
| draft_id | string | ✅ | 仅技术信息 | 来源 ConfigDraft ID |
| change_no | string | ✅ | 来源变更单号 | {v1.22} **来源变更单号**（决策 22）：确认时继承来源 draft 的 `change_no`，全链路追溯 `change_no → cv → deploy` |
| prometheus_yml | text | ✅ | 仅技术信息 | 生效的 prometheus.yml 内容 |
| rules_yml | text | ❌ | 仅技术信息 | 生效的 rules.yml 内容 |
| blackbox_yml | text | ❌ | 仅技术信息 | 生效的 blackbox.yml 内容 |
| targets_files | json | ❌ | 仅技术信息 | 生效的 targets 内容（按 job 名组织，与草稿一致；随配置包按 `targets/<job_name>.json` 落地） |
| metadata | json | ✅ | 仅技术信息 | 版本号、生成时间、联合 checksum（与草稿一致，供差异检测与边缘完整性校验；sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）、来源摘要 |
| created_at | datetime | ✅ | 仅技术信息 | 创建时间 |

> `blackbox_yml` 在所属网域存在 `job_type=blackbox` 的 ScrapeJob 时必填；下发记录需体现 `blackbox.yml` 是否参与本次下发及重载结果。
>
> **{v1.28} 版本一致性语义澄清**：版本模型为**网域级版本**——每个网域独立 `ConfigVersion`（配置按网域生成，各域内容不同，符合网域隔离设计），**一致性保障在网域内**：
>
> - **网域内一致性**：同一网域所有 Edge Agent 仅拉取该域**同一个经审批的 `ConfigVersion` 快照**（心跳 `config_version` 比对返回 304 + `metadata.checksum` 完整性校验，防传输损坏 / 篡改 / 半新半旧）；
> - **跨域同一批变更**：不同网域的 ConfigVersion 内容不同（各自域内产物），但同属一张变更单——`ConfigVersion.change_no`（继承来源 draft）透传，全链路可追溯「哪张变更单发了哪些域」；
> - **非全局同一版本**：不引入"所有网域共享同一 cv"的全局版本模型（与网域隔离设计冲突）；跨域变更节奏一致性由变更单确认流程保障（各域经确认后各自发布）。

### 4.6 配置下发记录（ConfigDeployment）{v0.2+}

| 字段 | 类型 | 必填 | UI 展示名 | 说明 |
|------|------|------|----------|------|
| id | string | ✅ | 部署 ID | 下发记录唯一标识（`deploy-xxx`，系统自动生成） |
| network_domain_id | string | ✅ | 网域 | 目标网域 ID |
| config_version_id | string | ✅ | 配置版本 | 下发的 ConfigVersion ID（`cv-xxx`，系统自动生成） |
| source_change_no | string | ✅ | 来源变更单号 | {v1.22} **来源变更单号**（决策 22）：经 `config_version_id` → `ConfigVersion.change_no` 透传，全链路可追溯「哪个变更单发的、回滚它」 |
| target_type | enum | ✅ | 目标类型 | central_prometheus / edge_agent |
| target_address | string | ❌ | 目标地址 | 目标地址，如 Prometheus reload URL 或 Edge Agent 标识 |
| status | enum | ✅ | 状态 | pending / running / success / failed / rolled_back |
| validation_status | enum | ✅ | 下发前校验 | {v1.23} 下发前校验结果：passed / failed / pending（与草稿 `validation_status` 衔接；失败时 `error_message` 记录校验失败原因） |
| includes_blackbox | boolean | ✅ | 含 blackbox.yml | {v1.23} 本次下发配置包是否包含 blackbox.yml（存在 `job_type=blackbox` 的 ScrapeJob 时必含） |
| error_message | text | ❌ | 错误信息 | 失败原因 |
| triggered_by | string | ✅ | 操作人 | 操作人/系统 |
| triggered_at | datetime | ✅ | 开始时间 | 触发时间 |
| completed_at | datetime | ❌ | 结束时间 | 完成时间 |

### 4.7 网域与 BlueKing Cloud Area 映射

> 本节映射关系在 v0.4+ 由 [Module_04](Module_04_Custom_Discovery.md) 同步时落地。

`NetworkDomain` 必须与 BlueKing CMDB 的云区域（Cloud Area）模型一一对应，保证 CMDB 作为监控对象唯一数据源时，网域边界与 CMDB 网络边界一致。

| MetricCenter 对象 | BlueKing CMDB 对象 | 映射规则 | 说明 |
|-------------------|-------------------|----------|------|
| NetworkDomain | Cloud Area（云区域） | 1:1 | 一个网域唯一对应一个蓝鲸云区域；`default` 网域可映射到默认云区域或保留为空 |
| Tenant | Business（业务） | 1:1 | 网域归属的租户对应蓝鲸业务，由 [Module_06](Module_06_Multi_Tenant.md#32-%E7%A7%9F%E6%88%B7%E4%B8%8E-blueking-cmdb-%E6%98%A0%E5%B0%84) 定义 |

> **约束 {v0.4+}**：禁止绕过 CMDB 云区域直接在 MetricCenter 中定义网络隔离边界；网域的创建与编辑应支持同步拉取/校验蓝鲸云区域信息。

### 4.8 数据模型状态机 {v1.24}

> **说明（v1.24）**：集中定义本模块核心对象的状态流转（与 5.2 时序图互为参照，供后端实现与前后端契约对齐）。所有状态机中的"操作"均为系统自动或用户操作触发，UI 展示状态标签与操作入口。

**① ConfigDraft（变更单）状态机**

```text
[生成] 检测到源数据变更 + 内容有实际差异（联合 checksum ≠ 生效版本）
   │
   ▼
 pending（待确认）─── 确认发布（人工，变更单级 go/no-go）───► confirmed（已确认）
   │   ▲                                                            │
   │   └────────── 内容无变化自动裁决（checksum 一致）──────────────► discarded（自动丢弃）
   │
   └────── 废弃（人工）───► discarded（已废弃）
```

| 状态 | 含义 | 进入条件 | 后续流转 |
|------|------|---------|---------|
| pending | 待确认 | configgen 检测到变更且产物有实际差异 | 确认 → confirmed；废弃 → discarded；自动丢弃（内容无变化不生成） |
| confirmed | 已确认 | 运维确认发布（记录确认人） | 生成 ConfigVersion（继承 change_no，分配 cv-xxx）→ 进入下发流程 |
| discarded | 已废弃 / 自动丢弃 | 人工废弃；或重算后 checksum 与生效版本一致自动丢弃 | 终态，保持当前生效配置不变 |

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
        ──► out_of_sync（中心版本 ≠ 边缘生效版本，待拉取 / 拉取失败）
        ──► manual_override（边缘本地手工修改，平台不强制回拉，需人工确认恢复）
```

**④ 网域运行态（NetworkDomain.status）状态机**

```text
unknown（未部署/纳管后）──► online（Agent 心跳上线）──► offline（失联超阈值，触发 EdgeSiteOffline 告警）
```

---

## 5. 配置生成与下发流程 {v0.2+}

### 5.1 轮询生成流程

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

### 5.2 确认与下发时序

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
                                               │    · 中心（default 域）：SIGHUP / POST /-/reload
                                               │    · 边缘域：Edge Sync Agent 心跳拉取配置包   │
                                               │ ⑨ 写入 ConfigDeployment 下发记录              │
                                               └────────────────────────────────────────────┘
```

1. **轮询触发**：配置中心定时（默认 30s）读取 Module_01 与 Module_07 的数据；先聚合各源表 `max(updated_at)` 为「源数据版本」，仅当源数据版本变化时才进入生成（详见 [3.3.3](#333-变更检测与草稿去重说明)）。
2. **草稿生成**：按网域聚合 ScrapeJobs、Rules、Resources、LabelTemplates，生成 `ConfigDraft`。
3. **差异检测**：计算草稿内容的联合 checksum，与当前生效 `ConfigVersion` 对比；一致则草稿标记 `discarded` 或丢弃（无实际变化），不一致则保持 `pending` 进入确认。
4. **人工确认**：运维在 UI 预览 draft，查看 diff，确认后 draft 状态变为 `confirmed`，并生成新的 `ConfigVersion`。
5. **下发执行**：
   - 中心 Prometheus：调用 `POST /-/reload` 或发送 `SIGHUP`；
   - 边缘网域：Edge Sync Agent 下次心跳检测到 `config_changed=true` 后拉取配置包。
6. **下发记录**：写入 `ConfigDeployment`，记录成功/失败状态。
7. **校验分层（v1.13）**：中心内容校验（下发前，见 [3.5.1](#351-下发前校验与-blackbox-重载说明)）与边缘传输校验（Agent 拉包后，见 [6.3](#63-edge-sync-agent-本地行为)）由同一份配置产物（ConfigVersion / zip 包）衔接，分层关系见 [6.4](#64-中心边缘校验分层与衔接)。

---

## 6. Edge Sync Agent 协议

### 6.1 心跳与配置检查接口

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
  "config_download_url": "/api/v2/platform/edge/config?network_domain=gov-cloud-a"
}
```

### 6.2 配置包拉取接口

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

> 本节描述的 **zip 配置包结构是边缘域 Agent 拉取**的配置载体：边缘域（`domain_type=edge`）确认下发后由 Edge Sync Agent 通过本接口心跳拉取。**中心管理域（`default`）为本地文件集**（`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml`，**不打包、无 metadata.json**），确认后直接写中心 Prometheus 配置目录并 SIGHUP / `POST /-/reload`，版本一致性由 `ConfigVersion` 记录保证（见 3.11 配置产物形态分层）。

配置包结构：

```
edge-config-<network_domain_id>.zip
├── prometheus.yml          # 本域 scrape_configs（仅 job 骨架，已注入 external_labels.network_domain；以 file_sd_configs 引用 targets/*.json）
├── targets/                # file_sd 目标文件（按 job 分文件，固定文件名覆盖写）
│   └── <job_name>.json     # 如 node-exporter.json / blackbox-http.json（targets 列表 + labels）
├── blackbox.yml            # 本域 Blackbox 探测模块（可选）
├── rules.yml               # 本域 edge/both 告警规则（v0.4+）
├── alertmanager.yml        # 本域通知路由（v0.4+）
└── metadata.json           # config_version、生成时间、agent_type、联合 checksum（sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)，供拉取后完整性校验）
```

### 6.3 Edge Sync Agent 本地行为

1. 启动后负责部署并守护**本节点**采集器（vmagent / prometheus-agent，按网域 `agent_type` 二选一）与 blackbox exporter 进程（一体化离线包自带，非手动安装；启动顺序 **blackbox exporter → 采集器**）；进程异常自动重启，并将采集器版本与运行状态纳入心跳上报；保留手动兜底（运维可手工替换采集器配置/二进制，见 3.6）。
2. 启动时从环境变量或配置文件读取 `NETWORK_DOMAIN_ID` 和 `TOKEN`。
3. 每 30s 向 MetricCenter 发送心跳，上报当前配置版本和 WAL 积压。
4. 若响应提示 `config_changed=true`，拉取最新配置包。
5. 校验配置包 checksum（`metadata.json` 中携带），失败则记录错误并保留最后一份有效配置，不进入解压步骤；通过后解压到本地目录。
6. 解压后对 `targets/*.json` 做解析校验（JSON 结构、`targets` / `labels` 字段合法性），校验失败则**回滚并保留旧 targets 文件**，避免采集器加载损坏文件导致目标丢失。
7. 仅当 `prometheus.yml` 结构变化时调用本地采集器 `/-/reload`（vmagent 与 Prometheus Agent Mode 均支持）；**targets 文件更新不触发采集器 reload**，由 file_sd 自动感知（磁盘监听 / 轮询）应用。
8. 若配置包包含 `blackbox.yml`，触发同域 blackbox exporter 重载（`SIGHUP` 或对应 API）。
9. 网络中断时保留最后一份有效配置，按原配置继续采集和 WAL 缓存。
10. 当配置包包含 `rules.yml` 与 `alertmanager.yml` 时，边缘 Agent 启动本地 vmalert/Alertmanager 实例，负责网域内自治告警。

> **{v1.28} 断网期间草稿/版本显式说明**：断网**不影响配置生成与草稿存储**——变更检测（pull 模式，中心轮询）与 `ConfigDraft` / `ConfigVersion` 持久化均在中心侧完成，断网期间生成的草稿 / 版本正常落库待确认 / 待发布；边缘侧断网时按第 9 条保留**最后一份有效配置**继续自治采集（本地快照，不依赖中心在线），网络恢复后心跳上报 `config_version` → 中心响应 `config_changed=true` → 拉取最新已审批版本（版本一致性见 4.5：网域内同一快照 + checksum 校验）。

### 6.4 中心/边缘校验分层与衔接

> **设计定位（决策 10）**：前端「配置生成/预览」对标的是**中心侧控制**（configgen 生成草稿 → 中心内容校验 → 前端预览/diff/确认 → 生成 ConfigVersion），Edge Sync Agent 对标的是**边缘侧消费**（心跳拉 zip → 边缘传输校验 → 原子替换 → 触发 reload → 回执 config_sync_status）；两者**不是**「对标 Agent 能力」，也**不是**「另一套独立校验」，而是由**同一份配置产物（ConfigVersion / zip 包）**衔接的同一条链路的两段——中心侧决定「产物对不对、是否可下发」，边缘侧决定「拉到的包完不完整、是否可应用」。

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
           同一份配置产物：ConfigVersion（边缘域 = zip 配置包，含 metadata.json）
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
| **边缘②传输校验** | 拉包后按 `metadata.json` 联合 checksum 做完整性校验（[6.3](#63-edge-sync-agent-本地行为) 第 5 条）；解压后 `targets/*.json` JSON 解析校验（结构、`targets` / `labels` 字段合法性，6.3 第 6 条） | **传输损坏 / 篡改 / 半写文件**（校验失败保留最后一份有效配置并记录错误，不进入解压 / 应用步骤） | Edge Sync Agent（边缘侧） | Agent 状态列表「最近错误」/ `config_sync_status` 异常态（out_of_sync / manual_override） |

> 分层依据：两类校验**防的是不同风险**——中心内容校验防「生成错误」（产物本身非法），边缘传输校验防「传输问题」（产物本身合法，但拉取过程被损坏 / 篡改 / 半写）；因此边缘侧无需重复中心的 promtool 级语法校验。

**设计要点**

1. **Agent 为「哑校验」**：Edge Sync Agent 只做**传输层机械校验**（`metadata.json` checksum 完整性 + targets JSON 解析），**不做 promtool 级语法校验**（不解析 `prometheus.yml` 完整语法、不调用 promtool / blackbox `--config.check`）；产物合法性由中心内容校验（校验①）保证——校验①失败会阻止确认下发，边缘侧拿到的必然是已通过中心校验的产物。哑校验降低边缘实现复杂度与依赖面（Agent 无需携带 promtool / blackbox exporter 校验工具，弱网边缘节点可离线自校验）。
2. **联合 checksum 双用途**：同一份联合 checksum（sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)）在两端各司其职——中心侧用于**草稿去重裁决**（[3.3.3](#333-变更检测与草稿去重说明)：内容与生效版本一致则不进入确认）；边缘侧用于**拉包完整性校验**（[6.3](#63-edge-sync-agent-本地行为) 第 5 条：拉到的字节与中心生成的产物一致）。同一算法、两个校验对象：中心校验「生成内容是否变化」，边缘校验「传输字节是否完整」。
3. **状态闭环**：`config_sync_status`（in_sync / out_of_sync / manual_override）是 Agent 的**应用回执**（随心跳上报，见 [3.8](#38-agent-状态列表与边缘诊断看板) / [4.2](#42-边缘-agentedgeagent)），与中心 `validation_status` 构成**闭环两端**——中心校验通过（validation_status=pass）→ 允许确认下发 → Agent 拉包、传输校验、原子替换、reload → 回执 `config_sync_status=in_sync`，闭环完成；任一端异常均可定位：`validation_status` 失败（中心产物问题，阻止下发）、`config_sync_status=out_of_sync` / `manual_override`（边缘应用或本地手工兜底问题，提示重新确认下发）。

### 6.5 管理面 REST API 详细契约 {v1.30}

> 本节补充前端「网域管理 / Agent 状态 / 配置变更确认 / 下发记录」所需的管理面 REST 契约。所有接口统一返回 `platform/api/response` 格式：
>
> ```json
> { "status": "success", "data": {} }
> { "status": "error", "errorType": "bad_request", "error": "human readable message" }
> ```
>
> 通用 `errorType`：`bad_request`、`unauthorized`、`forbidden`、`not_found`、`internal`。

#### 6.5.1 网域管理（监控纳管）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/network-domains` | Query: `tenant_id?`、`keyword`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 4.1（含 `is_monitored` / `token_masked`） | `forbidden`：越权访问其他租户 |
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
| POST | `/api/v2/platform/config-drafts/{change_no}/discard` | `{ discarded_by?: string }` | 废弃后的变更单 | `bad_request`：已非 pending；`not_found` |

#### 6.5.3 配置版本与下发记录（ConfigVersion / ConfigDeployment）

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/config-versions` | Query: `network_domain_id`、`change_no?`、`page`、`page_size` | `{ items: [...], total: N }` | — |
| GET | `/api/v2/platform/config-versions/{id}` | — | 配置版本详情（含完整产物，用于 diff） | `not_found` |
| GET | `/api/v2/platform/deployments` | Query: `network_domain_id`、`status?`、`change_no?`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 4.6 | — |
| POST | `/api/v2/platform/deployments/{config_version_id}/rollback` | `{ triggered_by: string }` | 新的 `ConfigDeployment`（`status=success`，回滚目标版本） | `not_found`；`bad_request`：目标版本不存在或不是同一网域 |

#### 6.5.4 Agent 状态查询

| 方法 | 路径 | Query / 请求体 | 响应 data 说明 | 业务错误 |
|------|------|----------------|----------------|----------|
| GET | `/api/v2/platform/edge-agents` | Query: `network_domain_id?`、`component_type?`、`status?`、`page`、`page_size` | `{ items: [...], total: N }`，item 字段见 4.2（含顶层 `collector_status` / `collector_version` 与 `components` 明细） | — |
| GET | `/api/v2/platform/edge-agents/{id}` | — | Agent 详情 | `not_found` |

---

## 7. 模块边界

### 7.1 与 Module_01 的边界 {v0.2+}

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

### 7.2 与 Module_07 的边界 {v0.2+}

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

### 7.3 与 Module_06 的边界

| 职责 | Module_06（租户与平台管理） | Module_09（网域与边缘配置中心） |
|------|------------------------------|--------------------------------|
| Tenant 数据模型定义 | ✅ | ❌ 仅引用 `tenant_id` |
| NetworkDomain 与 Tenant 关系 | ❌ 仅展示/校验 | ✅ 数据模型归属（`tenant_id` 在 NetworkDomain） |

### 7.4 与 Module_10 的边界

| 职责 | Module_09（网域与边缘配置中心） | Module_10（外部监控源接入与标签归一化） |
|------|--------------------------------|------------------------------------------|
| 内部 Edge Agent 的 `external_labels` 注入 | ✅ 在生成 `prometheus.yml` 时注入 `network_domain`、`tenant_id` 等 | ❌ |
| 外部异构监控源（第三方 Prometheus/Zabbix/云监控）接入 | ❌ | ✅ 负责标签归一化、映射、补全 |
| 外部来源的 `network_domain` / `tenant_id` 标签对齐 | ❌ 可提供网域/租户定义供引用 | ✅ 负责将外部指标映射到本网域模型 |

> **原则**：Module_09 管「内部 Agent 出身标签」，Module_10 管「外部来源入场标签」。两者都可能在指标上产生 `network_domain` 等标签，但生成时机和 responsibility 不同：Module_09 通过 Agent 配置注入，Module_10 通过接入网关/转换器在数据入平台时打标或改写。

---

## 8. 依赖

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

## 9. 验收标准

> **分层说明（v1.23，按 prototype-designer PRD 骨架规范）**：验收标准分「用户验收」（用户能在界面感知 / 操作 / 验证，对应原型演示）与「技术验收」（后端机制 / 协议 / 数据契约可验证，对应后端测试与接口验收）。

### 9.1 用户验收（用户可感知与操作）

- [ ] {P0} MVP 阶段系统存在默认网域 `default`，资源可无感知归属默认网域
- [ ] {P0} 网域行政创建/编辑/删除由 Module_06 负责，M09 不提供删除入口；M09 可从 M06 已存在的网域中选择并进行**监控纳管**（填写监控参数、生成/重置 Edge Agent Token、Remote Write URL）
- [ ] {P0} 可以为网域生成/重置 Edge Agent Token
- [ ] {P0} Token 在 UI 中完全脱敏展示（不显示任何明文片段，含首尾 6 位），完整值仅可通过复制按钮获取
- [ ] {P0} 草稿列表默认仅展示待确认（pending）草稿，历史草稿（confirmed / discarded）可切换查看；「人工确认下发」仅对 pending 草稿生效
- [ ] {P0} 变更检测状态可观测：UI 展示每个网域的上次检测时间、当前源数据版本（`source_data_version`）与检测结果（检测到变更生成草稿 / 无变更跳过重算 / checksum 一致自动丢弃）
- [ ] {P0} v0.2 阶段，UI 可多文件预览配置草稿（`prometheus.yml` / targets / `rules.yml` / `blackbox.yml`）并与当前生效版本按文件做 diff
- [ ] {P0} v0.2 阶段，Web 门户可查看各网域 Edge Agent 在线状态、配置版本、WAL 积压（MVP 以 Agent 状态列表页形式实现）
- [ ] {P0} 下发记录 `ConfigDeployment` 可查询成功/失败历史，支持查看失败原因
- [ ] {P1} 平台明确允许本地手工兜底，并在 UI 中展示 `manual_override` 状态
- [ ] {P0} 网域纳管页从 M06 已存在的网域中选择，提供安装指引，明确「边缘节点 = Edge Sync Agent（必装独立组件）+ 采集器（vmagent / prometheus-agent）+ blackbox exporter（可选）」组件构成与部署步骤（离线交付、校验和、`NETWORK_DOMAIN_ID` / `TOKEN` 环境变量、systemd），并消除「Agent 是中心内置」误解；纳管时登记的 `agent_type` 为采集器类型，Edge Sync Agent 无需登记
- [ ] {P0} 网域安装指引为 **3 步人工步骤**（① 下载并校验一体化离线包 ② 配置 `NETWORK_DOMAIN_ID` / `TOKEN` 环境变量 ③ 启动 Edge Sync Agent），采集器与 blackbox exporter 由 Agent 启动后自动部署（并入第③步描述，不单列为人工步骤），无需手动分步安装
- [ ] {P0} **MVP 阶段采集器类型固定 `vmagent`**（网域纳管时无需选择），`prometheus-agent` 保留枚举、v0.2+ 开放为可选；Agent 状态列表页多网域模式支持按网域筛选（单网域模式固定 `default`），采用**「网域为主 + 组件分类」**结构（一级按网域聚合、展开按组件类型分类，决策 15），展示对象为边缘节点 Agent 部署实例（Edge Sync Agent + 采集器组合，PRD 4.2）
- [ ] {P0} 离线二进制包为一体化包（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），安装后 Edge Sync Agent 自动部署并管理本节点采集器与 blackbox exporter 进程（启动守护、健康检查、配置 reload、进程异常自动重启），采集器健康/版本纳入 Agent 状态上报；安装指引为 3 步人工步骤，无需手动分步安装采集器
- [ ] {P0} **网域纳管为登记制闭环（决策 14 / {v1.29} 调整）**：网域行政记录由 M06 创建（必填网域名称 + 租户，`id` 按租户前缀自动生成）；M09 纳管表单最小化（填写监控参数、Token 自动签发、Remote Write URL 由平台自动推导可手动覆盖）；「网域纳管」为必要前置步骤，不可被「安装指引」替代（Token 需纳管时签发，Agent 启动必须携带 NETWORK_DOMAIN_ID / TOKEN）；M06 创建 → M09 纳管 → 安装指引 → Agent 心跳自动上线闭环成立，Agent IP / 主机名由心跳上报补全
- [ ] {P0} **Agent 状态页「网域为主 + 组件分类」（决策 15）**：一级表格按网域聚合（在线 Agent / 采集器运行中 / 拨测器运行中 / 配置同步 / WAL 合计），展开行按组件类型分类展示组件实例（Edge Sync Agent / 指标采集器 vmagent|prometheus-agent / 拨测器 blackbox exporter / v0.4+ vmalert / alertmanager，含组件状态 / 版本 / 配置版本 / 最近错误）；组件清单由心跳附带上报（`EdgeHeartbeat.components` → `EdgeAgent.components`），采集器组件状态 / 版本与顶层 `collector_status` / `collector_version` 一致；拨测器仅当网域存在 `job_type=blackbox` 的 ScrapeJob 时展示（否则展示「未部署」）
- [ ] {P0} **default 管理域不部署 Edge Agent / 字段对齐 / 安装指引入口 / 组件类型筛选（决策 16 / {v1.29} 调整）**：default 管理域由中心直接采集、无 `EdgeAgent` 实例（Agent 状态页仅展示有 Agent 的 `edge` 网域，单网域模式本页为空态）；纳管表单 Agent 类型下拉保留、MVP 仅 `vmagent` 可选（`prometheus-agent` 枚举保留、v0.2+ 开放）；纳管 / 编辑表单仅维护监控配置字段（描述 / Agent 类型 / Remote Write URL），行政字段（名称 / 租户 / 域类型 / 启用状态）由 [Module_06](Module_06_Multi_Tenant.md) 维护，运行态字段（状态 / 最后心跳）由心跳上报并在列头 / 页脚标注来源；Agent 状态页支持**网域 + 组件类型双筛选**（组件类型联动展开明细与统计卡，一级表对应列仅统计匹配组件）
- [ ] {P0} **安装指引为页面顶部常驻提示区（决策 17）**：网域管理页顶部常驻展示「新网域接入操作流程」（3 步人工步骤 + 边缘节点组件构成 + 凭据获取方式：`NETWORK_DOMAIN_ID`=对应网域 ID、`TOKEN` 经网域行内复制按钮获取），**行内不再提供安装指引按钮 / 弹窗**；纳管成功后自动滚动并高亮该提示区引导完成 Agent 接入
- [ ] {P0} **配置变更确认心智（决策 18）**：确认界面以**人话变更摘要**（`summary`）与**结构化变更清单**（`change_items`：变更类型 / 对象 / 说明 / 风险等级）为核心信息，回答「为什么变更」与「影响如何」；**技术字段（源数据版本 / 生成器版本 / 联合 checksum / 触发摘要）下沉折叠**仅供排障；变更检测状态人话化（检测到变更已生成待确认草稿 / 无新变更 / 内容无变化无需确认）；**高风险变更（删除目标 / 告警规则变更）醒目提示**；「确认发布到监控」语义 = 变更发布审批（go/no-go），与平台自动生成职责分离（平台保证生成内容 = 策略忠实翻译，运维决定是否上线）
- [ ] {P0} **变更对象 = 源数据对象 + 影响的配置文件 + 全链路关联（决策 22）**：变更清单「变更对象」为统一源数据对象枚举（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板，与 Module_01 / 07 功能对象对齐），每行携带**「影响的配置文件」**（configgen 产物差异派生：新增实例 → `targets/*.json`、改抓取频率 → `prometheus.yml`、规则变化 → `rules.yml`）；确认粒度为**变更单级**（一次确认 / 废弃整张变更单，不逐行确认、不拆分发布）；`ConfigVersion` 继承来源变更单号 `change_no`、`ConfigDeployment` 记录 `source_change_no`（均系统自动生成）——变更确认页展示「已发布配置版本」并提供「查看发布记录」入口，下发记录页展示「来源变更单号」列，业务出问题时从变更单直达回滚目标（回滚中心仍以下发记录页为主）
- [ ] {P0} **受影响配置文件高亮（决策 19）**：配置预览对比当前生效版本自动判定受影响的配置文件（prometheus.yml / targets / rules.yml / blackbox.yml），受影响 Tab 加「变更」标记、默认聚焦第一个受影响文件、提示「本次变更影响 N/M 个配置文件」；用户手动切换 Tab 后不再强制跳转
- [ ] {P0} **历史变更记录展示风险等级与确认人（决策 19）**：待确认 / 历史变更列表均展示「风险等级」（取该变更最高风险）与「确认人」（confirmed 显示确认人及确认时间，pending 显示未确认，discarded 显示已废弃），支撑变更审计复盘「谁确认了高风险变更」；确认发布动作记录确认人（当前登录用户）
- [ ] {P0} **下发记录定位为回滚中心 + 变更执行台账（决策 19）**：每次配置发布与回滚自动留痕（谁 / 何时 / 哪个配置版本 / 结果），支持按历史版本一键回滚（回滚动作本身也是记录）；与 Module_06 全局审计日志边界清晰（领域业务对象 vs 平台级操作留痕，联动不重复）
- [ ] {P0} **变更单号（决策 20）**：每个变更（草稿）分配用户可读唯一变更单号（`change_no`，如 `CHG-YYYYMMDD-NNN`），列表 / 详情 / 确认 / 回滚动作均以变更单号为沟通与审计标识（`id` 保留为内部技术键）
- [ ] {P0} **变更详情抽屉式（决策 20）**：列表点击变更行打开右侧抽屉查看详情——变更清单为详情核心（摘要=列表总览、清单=抽屉明细职责分明），配置预览 / Diff、技术信息折叠、确认 / 废弃按钮均收纳于抽屉
- [ ] {P0} **变更检测状态为引导性状态（决策 20）**：不记录检测历史；有待确认变更时提示「检测到 N 个待确认变更，请前往下方列表确认后发布」（含高风险数），无变更时提示「策略/资源变更后自动生成」；与待确认列表联动形成操作引导流；上次检测时间等技术信息折叠
- [ ] {P0} **确认人 MVP 预置（决策 20）**：MVP 阶段确认人 = 预置登录用户上下文（无用户管理），确认动作记录确认人；Module_06 用户管理接入后同步为真实用户
- [ ] {P0} **变更列表支持状态筛选（决策 21）**：按变更状态筛选（待确认 / 已确认 / 已废弃 / 全部，默认待确认），替代原「待确认 / 历史」二分切换；状态维度清晰、可扩展
- [ ] {P0} {v1.26} **按网域组织确认视图**：多网域模式下变更确认页提供「选择网域」切换器（单网域模式隐藏并提示「单网域模式说明」），列表展示当前选中网域的变更单（行内保留域类型标记：管理域 / 边缘域）；确认动作仍为变更单级（与网域切换无关）；确认抽屉标注发布通道——管理域「确认后立即 reload 生效」、边缘域「发布为配置包，待边缘 Agent 下次心跳拉取生效」
- [ ] {P0} {v1.26} **回滚异步生效提示**：回滚管理域（default）后提示「已回滚，配置已 reload 生效」；回滚边缘域后提示「已发布历史版本，待边缘 Agent 下次心跳拉取生效」，生效进度经 `config_sync_status`（out_of_sync → in_sync）在 Agent 状态列表可见
- [ ] {P0} **变更单号自动生成（决策 21）**：configgen 生成草稿时自动分配（用户不可手填），格式 `CHG-{YYYYMMDD}-{当日序列}`（如 `CHG-20260803-003`），全局唯一
- [ ] {P0} **提示分区规范（决策 21）**：用户可见文案不含「决策 X」「PRD X.X」等实现层引用；设计决策依据集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区（默认折叠）；代码注释与 PRD 承载实现细节供开发 / AI 参考
- [ ] {P2} P1/P2 阶段，边缘诊断看板可展示 WAL 积压趋势、Remote Write 队列状态、最近错误、24h 断网时长等图表

### 9.2 技术验收（后端机制 / 协议 / 数据契约可验证）

- [ ] {P2} {v0.2} `network_domain_id` 必须全局唯一，创建时建议校验租户前缀
- [ ] {P2} {v0.2} 一个网域必须且只能归属一个租户，禁止跨租户共享网域
- [ ] {P2} {v0.4+} 网域可维护 BlueKing CMDB 云区域 ID 与路径映射
- [ ] {P0} v0.2 阶段，配置中心可轮询 Module_01 与 Module_07 数据并生成按网域的 `prometheus.yml` 与 `targets/*.json` 草稿
- [ ] {P0} Module_01/07 策略/资源写库后无需主动通知 Module_09，配置生成由 Module_09 异步轮询（pull 模式）检测 `updated_at` 变化触发
- [ ] {P0} 策略变更到配置草稿生成（含确认前）的检测延迟不超过一个轮询周期（默认 30s）
- [ ] {P0} 配置中心按源数据版本（各源表 `max(updated_at)` 聚合）触发重算；源数据未变化时不产生无谓轮询
- [ ] {P0} 生成的草稿内容与当前生效 `ConfigVersion` 一致（联合 checksum 相同）时，不进入人工确认列表
- [ ] {P0} `ConfigDraft.metadata` 记录 `source_data_version`、`trigger_summary` 与联合 checksum，可用于追溯变更来源
- [ ] {P1} 边缘拉取配置包后按 `metadata.json` 中的 checksum 校验完整性，校验失败时保留旧配置并记录错误
- [ ] {P0} 中心管理域（default）配置产物为**本地文件集**（`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml`），直接写中心 Prometheus 配置目录，确认后 SIGHUP / `POST /-/reload`；不打包 zip、无 metadata.json 下载校验（版本一致性由 `ConfigVersion` 记录保证）
- [ ] {P1} 边缘域配置产物为 **zip 配置包**（含 `metadata.json` 供拉取后 checksum 校验），由 Edge Sync Agent 心跳拉取；配置产物形态按**域类型**（management/edge）分层，多网域模式下的 default 域同样走本地文件集
- [ ] {P1} v0.2 阶段，人工确认后配置中心可生成 `ConfigVersion` 并触发下发
- [ ] {P0} MVP 阶段，单网域场景下确认后的配置可通过 SIGHUP / HTTP reload 应用到中心 Prometheus
- [ ] {P1} v0.2 阶段，Edge Sync Agent 可通过 Token 拉取本域配置包
- [ ] {P1} v0.2 阶段，Edge Sync Agent 心跳可更新网域最后在线时间、配置版本、WAL 积压
- [ ] {P1} Edge Agent 失联超过阈值（默认 5 分钟）时，触发 `EdgeSiteOffline` 告警
- [ ] {P1} 配置包包含 `prometheus.yml`、`targets/*.json` 和 `metadata.json`，且 `prometheus.yml` 已注入 `external_labels.network_domain` 与 `external_labels.tenant_id`
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
- [ ] {P0} **变更摘要由产物 diff 生成（决策 18 实现方案）**：`summary` / `change_items` 由 configgen 对比「当前生效版本」与「新草稿」的**产物差异**生成（数据层 diff：targets 实例集合 / job 骨架 / 规则对象），**不依赖 Module_01/07 改造**；话术套用中文模板；规则阈值精确提取依赖规则模型结构化程度（MVP 建议规则模型结构化阈值）
- [ ] {P0} 提供离线二进制包 + systemd 服务文件的交付方式
- [ ] {P0} 不提供 `curl | bash` 一键部署脚本
- [ ] {P2} v0.4 阶段支持 mTLS 证书下发与自动轮转（可选）

## 10. 术语映射（用户词汇表）

> {v1.23} 后端术语 ↔ 用户语言的唯一权威对照（与 4.x 数据模型「UI 展示名」列一致）。用户可见文案、前端页面、接口文档均以本表对齐；「仅技术信息」术语只出现在技术层（折叠区 / 代码注释 / 接口契约），不作为用户界面文案。

| 后端术语 | 用户语言 | 说明 |
|---------|---------|------|
| `ConfigDraft` | 变更单 / 待确认变更 | 配置生成的草稿，进入人工确认的发布审批对象 |
| `change_no` | 变更单号 | `CHG-YYYYMMDD-NNN`，用户可读唯一标识（类比工单号） |
| `ConfigVersion` / `cv-xxx` | 配置版本 | 变更确认后生成的生效配置版本号 |
| `ConfigDeployment` / `deploy-xxx` | 发布记录 / 下发记录 | 每次发布或回滚的留痕记录 |
| `source_change_no` | 来源变更单号 | 发布记录追溯到其来源变更单 |
| `ConfigChangeItem.target` | 变更对象 | 源数据对象：采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板 |
| `ConfigChangeItem.affected_files` | 影响的配置文件 | prometheus.yml / targets/*.json / rules.yml / blackbox.yml |
| `ConfigChangeItem.risk` | 风险等级 | 低风险（新增目标）/ 高风险（删除目标 / 告警规则变更） |
| `validation_status` | 下发前校验 | 配置内容合法性与目标格式检查结果（通过 / 失败） |
| `config_sync_status` | 配置同步 | 边缘 Agent 实际生效版本与中心版本是否一致 |
| `manual_override` | 本地手工兜底 | 边缘节点本地手工修改过配置，平台不强制回拉 |
| `wal_backlog_bytes` | WAL 积压 | 弱网 / 断网期间边缘暂存的待回传数据量 |
| `job_type` | 采集 / 拨测 | `standard`=标准采集；`blackbox`=拨测 |
| `agent_type` | Agent 类型 | `vmagent` / `prometheus-agent`（采集器类型） |
| `domain_type` | 域类型 | 管理域 / 边缘域 |
| 「下发」（动词） | 下发语义分级（{v1.26}） | 本文「下发」在不同上下文承载四个语义，讨论 / 实现时按「域类型 + 环节」判定归属：**① 确认发布**（变更单 go/no-go 确认动作）；**② 中心 reload**（管理域应用：确认后 SIGHUP / `/-/reload` 立即生效）；**③ 边缘分发**（中心生成 zip 配置包并开放拉取接口）；**④ 边缘拉取**（Edge Sync Agent 心跳拉取 zip 应用）。④与②不重复——②是管理域通道、④是边缘域通道，二者由同一份 `ConfigVersion` 产物衔接（见 6.4） |
| `source_data_version` | 仅技术信息 | 各源表 `max(updated_at)` 聚合的触发版本 |
| 联合 checksum | 仅技术信息 | 配置内容完整性校验值（草稿去重 + 拉包校验） |
| `generator_version` | 仅技术信息 | 配置生成器版本 |
| `trigger_summary` / `source_summary` | 仅技术信息 | 变更触发来源摘要 |
| `metadata.json` | 仅技术信息 | 边缘配置包元数据（版本 / 校验值等） |
| `EdgeHeartbeat` | 仅技术信息 | 边缘 Agent 心跳上报协议 |
| `file_sd_configs` / `targets/*.json` | 仅技术信息 | 采集目标文件机制 |
| `external_labels` | 仅技术信息 | 回写指标自动携带的网域 / 租户标签 |

## Change Log

> **Change Log 定位（v1.24 / 精简执行）**：本表为业务沟通决策的精简记录（保留最近 3 版一句话摘要）；**完整历史（v1.25 及以前逐版详情）已迁移至 `docs/05-execution-records/module-09/design-decisions.md`「Change Log（完整历史）」小节**。Change Log 主要记录业务侧沟通决策与文档变更，**不承载开发契约**（开发契约见 4.x 数据模型 / 6.x 接口 / 8.x 状态机 / 9 验收标准）。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
| v1.30 | 2026-08-15 | 修改 | 内容缺口补齐（ready 前最后一次文档修正）：①4.2 补 `collector_status` / `collector_version` 字段；②4.6 `ConfigDeployment.status` 补 `running` 枚举与 4.8 状态机一致；③9.1 修正「创建/编辑/删除网域」残留验收项为 M06/M09 职责拆分口径；④6.4 后新增 6.5 管理面 REST API 详细契约（网域纳管 / 变更确认 / 版本下发 / Agent 状态）；⑤同步原型/总表版本至 v1.23 | MVP / v0.2 | 设计中 |
| v1.29.1 | 2026-08-15 | 修改（原型对齐） | 原型落地 v1.29 纳管模型：①module-09 原型移除「新增网域」（M09 不再创建 `NetworkDomain` 行政记录），页面主按钮改为「纳管网域」；②纳管弹窗从 M06 行政已创建（created）的网域中选择，填写监控参数（Agent 类型 MVP 固定 vmagent、Remote Write URL 自动推导），确认后自动签发 Token 并滚动高亮安装指引；③行内「纳管」按钮改为打开纳管弹窗（原为无参数确认框）；④编辑弹窗改为仅维护监控参数（描述/纳管状态/Agent 类型/Remote Write），名称/租户等行政字段只读展示；⑤全站「注册」措辞统一为「纳管」。网域行政创建入口见 [Module_06 v1.3.1](Module_06_Multi_Tenant.md)（原型新增「网域管理」页面） | 原型 `docs/prototypes/module-09/` | MVP / v0.2 | 设计中 |
| v1.29 | 2026-08-15 | 修改 | 网域职责边界细化与纳管模型（第二十轮需求对齐）：①明确 M06 是 `NetworkDomain` 行政 Owner（创建/分配/配额），M09 是网域监控纳管 Owner；②「网域注册」更名为「网域纳管」，从 M06 已存在网域中选择并填写监控参数；③网域列表增加「纳管状态」列；④配置变更确认视图切换器仅展示已纳管网域；⑤1/2/3.1/4.1/4.2/9 验收同步 | MVP / v0.2 | 设计中 |
