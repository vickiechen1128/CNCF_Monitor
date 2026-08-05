# Module 09: 网域与边缘配置中心

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.13
> **产品版本覆盖**: MVP / v0.2 / v1.0
> **原型版本**: v1.9
> **更新日期**: 2026-08-05
> **对应原型**: `docs/prototypes/module-09/`

> **模块类型**: 核心能力模块（v0.2+）
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)
> **目标用户**: 运维架构师、运维工程师

---

## 1. 模块目标

管理 MetricCenter 的**网域（Network Domain）**生命周期与**边缘 Agent（Edge Agent）**接入状态，同时作为监控配置的**生成 / 预览 / 下发中心**，支撑政务网、跨专网、多 DMZ、弱网或物理隔离场景下的 Edge-Cloud 架构。

核心职责：

1. **网域管理**：注册、编辑、删除网域，生成/重置 Edge Agent 认证 Token，预置默认网域 `default`。
2. **租户-网域关联 {v0.2}**：`NetworkDomain` 数据模型归属本模块，`tenant_id` 字段在 v0.2 必须落地，保证 1 租户 : N 网域、禁止跨租户共享网域、`network_domain_id` 全局唯一。
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

- ARCH-11：注册一个新的隔离网域并生成 Edge Agent 接入 Token。
- ARCH-12：查看所有网域列表及每个网域 Edge Agent 的在线状态（列表页形式）。
- OPS-11：在 Agent 状态列表页查看某个网域 Edge Agent 的最后心跳、WAL 积压和配置版本。
- OPS-12：当某个网域 Edge Agent 失联时，触发 `EdgeSiteOffline` 告警（告警规则由 Module_08 管理）。
- OPS-13：重置某个网域的 Edge Agent Token。
- OPS-14：查看按网域生成的配置草稿（`prometheus.yml` / `targets/*.json` / `rules.yml` 等），并与当前生效配置做按文件 diff 对比。
- OPS-15：确认配置草稿后，一键下发并 reload 中心 Prometheus 或 Edge Agent。
- OPS-16：查看历史配置版本与下发记录，必要时回滚到上一版本。

---

## 3. 核心功能

### 3.1 网域管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **网域列表** | 展示所有网域：ID、名称、状态、Agent 类型、最后心跳 | P0 |
| **网域注册** | 创建新网域，生成唯一 `id` 和认证 Token | P0 |
| **网域编辑** | 修改网域名称、描述、Agent 类型、Remote Write 目标 | P1 |
| **网域删除** | 删除无资源绑定的网域；有资源绑定时禁止删除 | P1 |
| **Token 管理** | 查看/重置 Edge Sync Agent 认证 Token；Token 在 UI 中**完全脱敏展示**（不显示任何明文片段），完整值仅可通过「复制」按钮获取 | **P0** |
| **安装指引** | 为网域提供 Edge Agent 安装指引：离线交付方式（离线二进制包 + systemd）、校验和、`NETWORK_DOMAIN_ID` / `TOKEN` 环境变量、systemd 部署步骤、blackbox exporter 附带说明；明确「边缘节点 = Edge Sync Agent（必装独立组件）+ 采集器（vmagent / prometheus-agent）+ blackbox exporter（可选）」组件构成与部署步骤，消除「Agent 是中心内置」误解（详见 3.9 边缘节点组件构成） | P1 |
| **默认网域** | 系统初始化自动创建 `default` 网域，MVP 单网域场景无感知 | P0 |

### 3.2 边缘 Agent 管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **Agent 注册** | Edge Sync Agent 首次拉取配置时自动注册到对应网域 | **P0** |
| **Agent 状态** | 展示在线/离线、最后心跳、最后配置拉取、当前配置版本 | **P0** |
| **配置同步状态** | 展示中心配置版本与边缘实际生效版本是否一致 | **P0** |
| **Agent 类型** | 按网域配置 `vmagent`（默认）或 `prometheus-agent` | **P0** |
| **Agent 状态列表页** | 分页表格展示各网域 Agent 在线状态、最后心跳、配置版本、配置同步状态、WAL 积压、最近错误 | **P0** |
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

### 3.4 配置预览与确认 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **草稿列表** | 展示每个网域的配置草稿：**所属网域**（草稿按网域生成，列表显式展示所属网域）、状态、生成时间、触发来源；**默认仅展示待确认（pending）草稿**，「人工确认下发」语义仅在 pending 草稿上生效；历史草稿（confirmed / discarded）可通过「查看历史草稿」切换展示 | **P0** |
| **配置预览** | 多文件只读预览：`prometheus.yml`、`targets/*.json`、`rules.yml`、`blackbox.yml`、`metadata.json`（YAML / JSON 高亮） | **P0** |
| **Diff 对比** | 与当前生效版本**按文件**并排 diff（`prometheus.yml` / targets 文件 / `rules.yml` / `blackbox.yml` 逐个文件对比），标红新增/删除/修改项 | **P0** |
| **PromQL 语法校验** | 对生成的 rules 做 PromQL 解析校验（调用 Module_02 或本地校验库） | P1 |
| **人工确认下发** | 运维工程师确认后，draft 转为 `ConfigVersion`，进入待下发/已下发状态 | **P0** |
| **草稿废弃** | 允许人工废弃当前 draft，保持当前生效版本不变 | P1 |

> **targets 前端数据驱动（决策 7）**：`targets/<job_name>.json` 由 configgen 按 job 名自动生成（固定文件名覆盖写）；前端预览的 targets 子 Tab **动态遍历 `ConfigDraft.targets_files` 数据渲染**，**新增 job 无需前端改动**（三层解耦：文件命名=后端生成、展示=数据驱动、用户入口=Module_01/07 策略配置）。

### 3.5 配置下发与分发 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **中心 Prometheus Reload {MVP}** | 单网域/中心模式：确认后执行 SIGHUP 或 POST `/-/reload` | **P0** |
| **下发记录** | 记录每次下发的时间、目标、操作人、结果、失败原因 | **P0** |
| **版本回滚** | 支持选择历史 `ConfigVersion` 重新下发，覆盖当前生效配置 | P1 |
| **多目标分发** | 按网域分发到对应 Edge Sync Agent；支持批量选择网域下发 | P1 |
| **配置包拉取接口** | `GET /api/v2/platform/edge/config?network_domain=<id>` | **P0** |
| **配置版本比对** | Edge Sync Agent 上报当前版本，无更新时返回 304 | **P0** |
| **配置包下载** | 返回包含 `prometheus.yml`、`targets/*.json`、`blackbox.yml`、`rules.yml`、`metadata.json` 的压缩包 | **P0** |
| **下发前校验** | 下发前调用 `promtool check config` 校验 `prometheus.yml`；存在 `blackbox.yml` 时调用 blackbox exporter `--config.check` 校验；targets JSON 由生成器侧 schema 校验（见 3.3 / 3.5.1） | **P0** |
| **blackbox 重载** | 配置包更新后，Edge Sync Agent 需触发 blackbox exporter 重载（SIGHUP 或对应 API） | **P0** |

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

#### 3.8.1 MVP：Agent 状态列表页

以分页表格展示每个网域的 Edge Agent 核心状态：

| 字段 | 说明 |
|------|------|
| 网域 | `network_domain_id` / 网域名称 |
| 在线状态 | online / offline / unknown |
| 最后心跳 | 距现在的时间差 |
| 配置版本 | 当前生效的 `config_version` |
| 配置同步状态 | In-Sync / Out-of-Sync / Manual-Override / Unknown |
| WAL 积压量 | 本地磁盘未发送数据大小（字节） |
| 最近错误 | 最后一条配置拉取或 Remote Write 错误摘要 |

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
> **职责边界**：Edge Sync Agent 只管理**本节点**组件生命周期，**不做**下游节点 exporter 安装（目标主机 node-exporter 等由 Module_01 的 Exporter 安装流程负责，本轮因安全边界暂不纳入 Agent 管理范围）；**不做**指标抓取（采集器职责）；**不做**告警求值（MVP~v0.3 中心统一求值，v0.4+ 边缘自治由 vmalert 负责）。
>
> **登记语义**：网域注册时登记的 `agent_type` 是**采集器类型**（`vmagent` / `prometheus-agent`），Edge Sync Agent 为**必装组件、无需登记**；`EdgeAgent` 实例即代表「Edge Sync Agent + 采集器」组合（见 [4.2](#42-边缘-agentedgeagent)）。

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

- 用户需先在「网域管理」注册网域，生成 Edge Agent 认证 Token。
- 在隔离网域部署 Edge Sync Agent 后，心跳自动注册到对应网域。
- 在 [Module_07](Module_07_Monitoring_Object_Management.md) 配置资源时，资源必须选择归属网域（`default` 作为中心管理域继续存在）。
- 在 [Module_01](Module_01_Metric_Collection_Center.md) 配置 ScrapeJob 时，按网域筛选目标实例。
- 配置中心按网域生成 `ConfigDraft`，经确认后生成 `ConfigVersion`；中心管理域（`default`）走 `/-/reload`，边缘域由 Edge Sync Agent 拉取配置包。

#### 模式切换与数据兼容

- 从单网域切换到多网域：已有资源与配置保持归属 `default` 网域，用户可继续在 `default` 网域下管理中心 Prometheus 采集，或逐步迁移到新网域。
- 从多网域切换回单网域：系统仅展示 `default` 网域数据，其他网域数据不删除但隐藏；再次切回多网域后恢复显示。
- `default` 网域类型为 `management`（管理域），**禁止删除**；允许用户修改其 `name` 和 `description` 以与云区域命名保持一致。其他网域类型默认为 `edge`（边缘域）。

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

本模块是 `NetworkDomain` 数据模型与生命周期的唯一 Owner。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 网域唯一标识，必须全局唯一；v0.2 起建议采用租户前缀，如 `<tenant_id>-gov-cloud-a`、`default` |
| name | string | ✅ | 网域展示名；`default` 网域的 `name` / `description` 允许修改以匹配客户云区域命名 |
| description | string | ❌ | 网域描述 |
| domain_type | enum | ✅ | 网域类型：`management`（管理域，如 `default`）/ `edge`（边缘域）；`management` 类型网域禁止删除 |
| tenant_id | string | ✅ | {v0.2} 所属租户 ID；`platform_admin` 表示平台默认租户，禁止跨租户共享网域 |
| cmdb_cloud_area_id | string | ❌ | {v0.4+} 对应 BlueKing CMDB 云区域 ID（`bk_cloud_id`） |
| cmdb_cloud_area_path | string | ❌ | {v0.4+} 对应 BlueKing CMDB 云区域路径 |
| token | string | ✅ | Edge Sync Agent 拉取配置时的认证 Token |
| agent_type | enum | ✅ | 边缘采集器类型：`vmagent`（默认）/ `prometheus-agent` |
| remote_write_url | string | ✅ | 该网域 Agent Remote Write 目标地址 |
| status | enum | ✅ | online / offline / unknown |
| last_heartbeat | datetime | ❌ | 边缘 Agent 最后心跳时间 |
| agent_version | string | ❌ | 边缘 Agent 版本 |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |

> **MVP 处理**：系统初始化时自动创建一个 `id=default`、`domain_type=management` 的默认网域，所有未指定网域的资源自动归属到默认网域，保证单网域场景无感知。默认网域 `default` 归属于 `platform_admin` 租户，所有未指定租户的资源默认继承该归属。`default` 网域的 `name` / `description` 允许用户修改以匹配云区域命名，但禁止删除。
>
> **归属约束**：一个网域必须且只能归属一个租户（1 租户 : N 网域），禁止跨租户共享网域；`network_domain_id` 必须全局唯一，建议创建时校验租户前缀。

### 4.2 边缘 Agent（EdgeAgent）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| network_domain_id | string | 所属网域 ID |
| agent_type | enum | `vmagent` / `prometheus-agent` |
| version | string | Agent 版本 |
| hostname | string | 部署主机名（可选） |
| status | enum | online / offline / unknown |
| last_heartbeat | datetime | 最后心跳时间 |
| heartbeat_rtt_ms | int | 心跳往返延迟（毫秒） |
| last_config_pull | datetime | 最后配置拉取时间 |
| config_version | string | 当前生效配置版本 |
| config_sync_status | enum | in_sync / out_of_sync / unknown / manual_override |
| wal_backlog_bytes | int | WAL 积压字节数 |
| remote_write_url | string | Remote Write 目标地址 |
| last_error | string | 最近错误信息 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

> **模型语义（v1.11）**：`EdgeAgent` 实例代表「**边缘节点上的 Agent 部署 = Edge Sync Agent + 采集器组合**」，即一个边缘监控代理节点上的完整 Agent 部署单元；`agent_type` 字段为**采集器类型**（`vmagent` / `prometheus-agent`），由网域注册时在 `NetworkDomain.agent_type` 登记（见 [4.1](#41-网域networkdomain)），Edge Sync Agent 为必装组件、无需单独登记。
> 心跳（[4.3](#43-心跳上报edgeheartbeat)）由 **Edge Sync Agent** 上报，携带采集器类型（`agent_type`）、版本（`version`）、`config_version`、WAL 积压（`wal_backlog_bytes`）等，用于更新 `EdgeAgent` 的在线状态、最后心跳、配置同步状态与 WAL 积压字段。

### 4.3 心跳上报（EdgeHeartbeat）

| 字段 | 类型 | 说明 |
|------|------|------|
| network_domain_id | string | 所属网域 ID |
| agent_type | enum | `vmagent` / `prometheus-agent` |
| version | string | Agent 版本 |
| config_version | string | 当前生效配置版本 |
| wal_backlog_bytes | int | WAL 积压字节数 |
| remote_write_queue_size | int | Remote Write 发送队列长度 |
| remote_write_last_error | string | 最近 Remote Write 错误 |
| timestamp | datetime | 心跳时间戳 |

### 4.4 配置草稿（ConfigDraft）{v0.2+}

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 草稿唯一标识 |
| network_domain_id | string | ✅ | 所属网域 ID |
| source_version | string | ❌ | 基于哪个 ConfigVersion 生成，可为空（首次生成） |
| prometheus_yml | text | ✅ | 生成的 prometheus.yml 内容（仅 job 骨架，targets 见 `targets_files`） |
| rules_yml | text | ❌ | 生成的 rules.yml 内容（可选） |
| blackbox_yml | text | ❌ | 生成的 blackbox.yml 内容（可选） |
| targets_files | json | ❌ | 生成的 targets 内容承载字段：按 job 名组织的 targets 列表（file_sd 目标文件，如 `{"node-exporter": [{"targets": [...], "labels": {...}}], "blackbox-http": [...]}`；网域无任何目标时为空对象） |
| metadata | json | ✅ | 生成时间、生成器版本、`source_data_version`、`trigger_summary`（触发来源 job/rule/表 + 时间）、联合 checksum（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）、来源 job/rule 摘要 |
| status | enum | ✅ | pending / confirmed / discarded |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |
| confirmed_by | string | ❌ | 确认人 |
| confirmed_at | datetime | ❌ | 确认时间 |

> `blackbox_yml` 在所属网域存在 `job_type=blackbox` 的 ScrapeJob 时必填，且必须随 `prometheus.yml` 一同下发。
>
> `targets_files` 下发时按 job 名拆分为 `targets/<job_name>.json` 文件（固定文件名覆盖写），job 名中的非法文件名字符需做安全转换，保证文件名稳定可预测。

### 4.5 配置版本（ConfigVersion）{v0.2+}

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 版本唯一标识，建议作为配置包版本号 |
| network_domain_id | string | ✅ | 所属网域 ID |
| draft_id | string | ✅ | 来源 ConfigDraft ID |
| prometheus_yml | text | ✅ | 生效的 prometheus.yml 内容 |
| rules_yml | text | ❌ | 生效的 rules.yml 内容 |
| blackbox_yml | text | ❌ | 生效的 blackbox.yml 内容 |
| targets_files | json | ❌ | 生效的 targets 内容（按 job 名组织，与草稿一致；随配置包按 `targets/<job_name>.json` 落地） |
| metadata | json | ✅ | 版本号、生成时间、联合 checksum（与草稿一致，供差异检测与边缘完整性校验；sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）、来源摘要 |
| created_at | datetime | ✅ | 创建时间 |

> `blackbox_yml` 在所属网域存在 `job_type=blackbox` 的 ScrapeJob 时必填；下发记录需体现 `blackbox.yml` 是否参与本次下发及重载结果。

### 4.6 配置下发记录（ConfigDeployment）{v0.2+}

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 下发记录唯一标识 |
| network_domain_id | string | ✅ | 目标网域 ID |
| config_version_id | string | ✅ | 下发的 ConfigVersion ID |
| target_type | enum | ✅ | central_prometheus / edge_agent |
| target_address | string | ❌ | 目标地址，如 Prometheus reload URL 或 Edge Agent 标识 |
| status | enum | ✅ | pending / success / failed |
| error_message | text | ❌ | 失败原因 |
| triggered_by | string | ✅ | 操作人/系统 |
| triggered_at | datetime | ✅ | 触发时间 |
| completed_at | datetime | ❌ | 完成时间 |

### 4.7 网域与 BlueKing Cloud Area 映射

> 本节映射关系在 v0.4+ 由 [Module_04](Module_04_Custom_Discovery.md) 同步时落地。

`NetworkDomain` 必须与 BlueKing CMDB 的云区域（Cloud Area）模型一一对应，保证 CMDB 作为监控对象唯一数据源时，网域边界与 CMDB 网络边界一致。

| MetricCenter 对象 | BlueKing CMDB 对象 | 映射规则 | 说明 |
|-------------------|-------------------|----------|------|
| NetworkDomain | Cloud Area（云区域） | 1:1 | 一个网域唯一对应一个蓝鲸云区域；`default` 网域可映射到默认云区域或保留为空 |
| Tenant | Business（业务） | 1:1 | 网域归属的租户对应蓝鲸业务，由 [Module_06](Module_06_Multi_Tenant.md#32-%E7%A7%9F%E6%88%B7%E4%B8%8E-blueking-cmdb-%E6%98%A0%E5%B0%84) 定义 |

> **约束 {v0.4+}**：禁止绕过 CMDB 云区域直接在 MetricCenter 中定义网络隔离边界；网域的创建与编辑应支持同步拉取/校验蓝鲸云区域信息。

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
  "wal_backlog_bytes": 1048576
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

- [ ] MVP 阶段系统存在默认网域 `default`，资源可无感知归属默认网域
- [ ] {v0.2} `network_domain_id` 必须全局唯一，创建时建议校验租户前缀
- [ ] {v0.2} 一个网域必须且只能归属一个租户，禁止跨租户共享网域
- [ ] {v0.4+} 网域可维护 BlueKing CMDB 云区域 ID 与路径映射
- [ ] 可以创建/编辑/删除网域，删除前校验无资源绑定
- [ ] 可以为网域生成/重置 Edge Agent Token
- [ ] Token 在 UI 中完全脱敏展示（不显示任何明文片段，含首尾 6 位），完整值仅可通过复制按钮获取
- [ ] v0.2 阶段，配置中心可轮询 Module_01 与 Module_07 数据并生成按网域的 `prometheus.yml` 与 `targets/*.json` 草稿
- [ ] Module_01/07 策略/资源写库后无需主动通知 Module_09，配置生成由 Module_09 异步轮询（pull 模式）检测 `updated_at` 变化触发
- [ ] 策略变更到配置草稿生成（含确认前）的检测延迟不超过一个轮询周期（默认 30s）
- [ ] 配置中心按源数据版本（各源表 `max(updated_at)` 聚合）触发重算；源数据未变化时不产生无谓轮询
- [ ] 生成的草稿内容与当前生效 `ConfigVersion` 一致（联合 checksum 相同）时，不进入人工确认列表
- [ ] 草稿列表默认仅展示待确认（pending）草稿，历史草稿（confirmed / discarded）可切换查看；「人工确认下发」仅对 pending 草稿生效
- [ ] 变更检测状态可观测：UI 展示每个网域的上次检测时间、当前源数据版本（`source_data_version`）与检测结果（检测到变更生成草稿 / 无变更跳过重算 / checksum 一致自动丢弃）
- [ ] `ConfigDraft.metadata` 记录 `source_data_version`、`trigger_summary` 与联合 checksum，可用于追溯变更来源
- [ ] 边缘拉取配置包后按 `metadata.json` 中的 checksum 校验完整性，校验失败时保留旧配置并记录错误
- [ ] 中心管理域（default）配置产物为**本地文件集**（`prometheus.yml` + `targets/*.json` + `rules.yml` + `blackbox.yml`），直接写中心 Prometheus 配置目录，确认后 SIGHUP / `POST /-/reload`；不打包 zip、无 metadata.json 下载校验（版本一致性由 `ConfigVersion` 记录保证）
- [ ] 边缘域配置产物为 **zip 配置包**（含 `metadata.json` 供拉取后 checksum 校验），由 Edge Sync Agent 心跳拉取；配置产物形态按**域类型**（management/edge）分层，多网域模式下的 default 域同样走本地文件集
- [ ] v0.2 阶段，UI 可多文件预览配置草稿（`prometheus.yml` / targets / `rules.yml` / `blackbox.yml`）并与当前生效版本按文件做 diff
- [ ] v0.2 阶段，人工确认后配置中心可生成 `ConfigVersion` 并触发下发
- [ ] MVP 阶段，单网域场景下确认后的配置可通过 SIGHUP / HTTP reload 应用到中心 Prometheus
- [ ] v0.2 阶段，Edge Sync Agent 可通过 Token 拉取本域配置包
- [ ] v0.2 阶段，Edge Sync Agent 心跳可更新网域最后在线时间、配置版本、WAL 积压
- [ ] v0.2 阶段，Web 门户可查看各网域 Edge Agent 在线状态、配置版本、WAL 积压（MVP 以 Agent 状态列表页形式实现）
- [ ] P1/P2 阶段，边缘诊断看板可展示 WAL 积压趋势、Remote Write 队列状态、最近错误、24h 断网时长等图表
- [ ] Edge Agent 失联超过阈值（默认 5 分钟）时，触发 `EdgeSiteOffline` 告警
- [ ] 配置包包含 `prometheus.yml`、`targets/*.json` 和 `metadata.json`，且 `prometheus.yml` 已注入 `external_labels.network_domain` 与 `external_labels.tenant_id`
- [ ] 配置包必须包含 `targets/*.json`（按 job 分文件，固定文件名覆盖写），且 `prometheus.yml` 的 scrape_configs 以 `file_sd_configs` 引用 targets 文件、不内联 targets 列表
- [ ] 联合 checksum 涵盖 targets 内容（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)），targets 变化可通过 checksum 裁决进入草稿
- [ ] `LabelTemplate` / `Resource` 变更产生的差异体现在 `targets/*.json` 内容（labels / 目标列表）上，而非 `prometheus.yml` 结构
- [ ] targets 变更仅重写 `targets/*.json`（原子写：临时文件 + rename），不触发采集器 reload；仅 `prometheus.yml` 结构变化才触发 reload
- [ ] 配置生成服务生成 targets JSON 时执行 schema 校验（结构、`host:port`、labels 合法性），弥补 `promtool check config` 对 file_sd 内容不校验的缺口
- [ ] Edge Sync Agent 解压后对 `targets/*.json` 做解析校验，失败时回滚并保留旧 targets 文件
- [ ] 当网域存在 `job_type=blackbox` 的 ScrapeJob 时，配置包必须同时包含 `blackbox.yml`，且 `prometheus.yml` 中 blackbox job 的 `__address__` 指向本地 blackbox exporter（如 `127.0.0.1:9115`），blackbox 目标写入 targets JSON 并由 `file_sd_configs` 引用
- [ ] 下发前调用 `promtool check config` 校验 `prometheus.yml`；存在 `blackbox.yml` 时调用 blackbox exporter `--config.check` 校验；targets JSON 经 configgen 侧 schema 校验
- [ ] 中心内容校验（`validation_status`）与边缘传输校验（`config_sync_status`）分层清晰：Agent 为哑校验，仅做 `metadata.json` checksum 完整性 + `targets/*.json` 解析校验，不做 promtool 级语法校验（产物合法性由中心内容校验保证，校验失败阻止确认下发）
- [ ] Edge Sync Agent 在配置包更新后触发同域 blackbox exporter 重载（SIGHUP 或对应 API）
- [ ] 离线二进制包交付方式包含 blackbox exporter 二进制、capability 设置示例与 systemd 启动依赖
- [ ] 下发记录 `ConfigDeployment` 可查询成功/失败历史，支持查看失败原因
- [ ] 平台明确允许本地手工兜底，并在 UI 中展示 `manual_override` 状态
- [ ] 提供离线二进制包 + systemd 服务文件的交付方式
- [ ] 不提供 `curl | bash` 一键部署脚本
- [ ] 网域注册页提供安装指引，明确「边缘节点 = Edge Sync Agent（必装独立组件）+ 采集器（vmagent / prometheus-agent）+ blackbox exporter（可选）」组件构成与部署步骤（离线交付、校验和、`NETWORK_DOMAIN_ID` / `TOKEN` 环境变量、systemd），并消除「Agent 是中心内置」误解；注册时登记的 `agent_type` 为采集器类型，Edge Sync Agent 无需登记
- [ ] 离线二进制包为一体化包（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），安装后 Edge Sync Agent 自动部署并管理本节点采集器与 blackbox exporter 进程（启动守护、健康检查、配置 reload、进程异常自动重启），采集器健康/版本纳入 Agent 状态上报；安装指引为一步安装语义，无需手动分别安装采集器
- [ ] v0.4 阶段支持 mTLS 证书下发与自动轮转（可选）

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.13 | 2026-08-05 | 修改 | 新增 6.4「中心/边缘校验分层与衔接」（决策 10 固化）：同产物两段链路关系图（中心侧控制 → 配置产物 → 边缘侧消费）+ 分层校验对照表（中心①内容校验防生成错误、边缘②传输校验防传输损坏/篡改/半写），明确设计要点（Agent 哑校验不做 promtool 级语法校验、联合 checksum 双用途、config_sync_status 与 validation_status 构成闭环两端）；3.5.1 补充交叉引用（中心内容校验与边缘传输校验的分层关系见 6.4）；5.2 时序步骤后补充指向 6.4 的引用；验收标准补充校验分层条目 | 6.3/6.4/3.5.1/5.2/验收标准 | MVP / v0.2 | 设计中 |
| v1.13 | 2026-08-05 | 修改 | 原型 v1.9 同步更新：配置生成/预览页补充「校验分层（PRD 6.4）」说明（中心①内容校验结果以 validation_status 展示、失败阻止确认下发；边缘②传输校验体现于 Agent 状态页 config_sync_status；Agent 哑校验；联合 checksum 双用途），校验失败 Alert 与 mfg 域 targets schema 失败案例文案标注「中心内容校验失败」；Agent 状态页新增「采集器版本」列（collector_version，EdgeAgent.version 保留为 Edge Sync Agent 版本经 Tooltip 展示，PRD 4.2 组合语义）与「采集器状态」列（collector_status：running/stopped/unknown，Tooltip 说明本节点采集器由 Edge Sync Agent 部署守护），页脚补充边缘传输校验与采集器进程管理（PRD 3.2/6.3）说明；EdgeAgent 数据模型新增 collector_version / collector_status 字段 | 原型目录、数据模型、UI/UX | MVP / v0.2 | 设计中 |
| v1.12 | 2026-08-05 | 修改 | Edge Sync Agent 职责范围明确（三层：① 通信层—心跳上报、配置拉取 checksum 校验、状态回执；② 配置应用层—写配置、原子替换、触发采集器/blackbox reload；③ 本节点组件管理层—一体化交付后管理本节点采集器与 blackbox exporter 进程生命周期）；3.2 新增「采集器进程管理」功能（P0，随一体化离线包安装、启动守护、健康检查、异常自动重启，版本/运行状态纳入心跳上报与 Agent 状态展示）；3.9 补充「一体化交付 + 职责边界」（离线二进制包为一体化包，安装后 Agent 自动部署本节点采集器/blackbox 进程，启动顺序 blackbox → 采集器，不做下游节点 exporter 安装）；6.3 新增第 1 条本节点组件部署守护行为（保留手动兜底），原有编号顺延；安装指引改为一步安装语义（原型 v1.8 同步更新）；验收标准补充一体化交付条目 | 3.2/3.9/6.3/验收标准 | MVP / v0.2 | 设计中 |
| v1.11 | 2026-08-05 | 修改 | 原型 v1.7 同步更新（UI 修复）：3.1「Token 管理」补充 Token 在 UI 中完全脱敏展示（不显示任何明文片段，含首尾 6 位），完整值仅可通过「复制」按钮获取；网域列表操作列收敛为「编辑 / 更多（安装指引、重置 Token）/ 删除」，避免操作按钮超出表格宽度；验收标准补充 Token 完全脱敏条目 | 3.1/验收标准 | MVP / v0.2 | 设计中 |
| v1.11 | 2026-08-05 | 修改 | 原型 v1.6 同步更新：3.1 新增「安装指引」功能（P1，离线交付方式/校验和/`NETWORK_DOMAIN_ID`/`TOKEN` 环境变量/systemd 部署步骤/blackbox exporter 附带说明）；3.9 补充「边缘节点组件构成」说明段（边缘监控代理节点 = Edge Sync Agent 必装独立组件（非中心内置，负责心跳/配置拉取/控制采集器）+ 采集器（vmagent 或 prometheus-agent，由 `NetworkDomain.agent_type` 登记，二选一）+ blackbox exporter（可选，blackbox job 时附带）；明确注册时登记的 `agent_type` 是采集器类型，Edge Sync Agent 为必装组件、无需登记）；4.2 补充 EdgeAgent 模型语义（实例代表「边缘节点上的 Agent 部署 = Edge Sync Agent + 采集器组合」，`agent_type` 为采集器类型，心跳由 Edge Sync Agent 上报携带采集器类型/版本/config_version/WAL 积压）；验收标准补充安装指引与组件构成条目 | 3.1/3.9/4.2/验收标准 | MVP / v0.2 | 设计中 |
| v1.10 | 2026-08-05 | 修改 | 原型 v1.5 同步更新：配置产物形态按域类型分层（3.11/6.2：中心管理域 default=本地文件集、无 zip/metadata.json，边缘域=zip 配置包含 metadata.json，分层依据为域类型而非单/多网域开关）；3.9 补充 Edge Sync Agent 部署定位（边缘监控代理节点独立客户端程序、outbound HTTPS 443 + 每网域 Token 通信、中心无入站端口，MVP 单网域不部署、v0.2+ 多网域每边缘节点一个）；3.3 补充 scope 业务场景（MVP~v0.3 固定 central，edge/both 为 v0.4+ P2 断网自治告警预留，链接 Module_01 5.5）；3.4 补充 targets 前端数据驱动说明（targets/<job_name>.json 由 configgen 生成，前端动态遍历 targets_files 渲染，新增 job 无需改前端）；验收标准补充配置产物形态分层条目 | 3.3/3.4/3.9/3.11/6.2/验收标准 | MVP / v0.2 | 设计中 |
| v1.9 | 2026-08-05 | 修改 | 原型 v1.4 同步更新：3.4 草稿列表显式展示所属网域并定义默认仅展示待确认（pending）草稿、历史草稿（confirmed/discarded）可切换查看、「人工确认下发」仅对 pending 生效；3.3.3 补充变更检测状态可观测（上次检测时间、源数据版本、检测结果，P1）；验收标准补充草稿默认待确认过滤与检测状态可观测条目 | 3.3/3.4/验收标准 | MVP / v0.2 | 设计中 |
| v1.8 | 2026-08-05 | 修改 | 原型 v1.3 同步更新：配置预览改为多文件 Tabs（prometheus.yml / targets / rules.yml / blackbox.yml / metadata.json）并按文件 diff；配置包结构树与预览含 `targets/` 目录（file_sd 目标文件）；targets_files 数据模型落地（按 job 组织、文件_sd 骨架、联合 checksum 纳入 targets 内容）；校验失败定位到对应文件 Tab；网域注册新增安装指引（离线交付 + systemd + 环境变量 + 心跳认领三步）；Agent 状态列表新增 Agent IP 列（心跳登记） | 原型目录、UI/UX | 文档自身 | 设计中 |
| v1.8 | 2026-08-05 | 修改 | targets 采用 file_sd（JSON 目标文件）：3.3「按网域生成配置」明确 scrape_configs 以 `file_sd_configs` 引用本域 `targets/*.json`（固定文件名覆盖写），prometheus.yml 仅含 job 骨架；3.3.2 blackbox 目标同样写入 targets JSON；新增「配置文件 × 源数据」映射语义（prometheus.yml=网域级+job 结构级，targets=资源级+标签模板级，LabelTemplate 变更驱动 targets labels 而非 prometheus.yml 结构）；联合 checksum 纳入 targets 内容（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）；ConfigDraft / ConfigVersion 新增 `targets_files` 承载字段；configgen 侧新增 targets JSON schema 校验并说明 promtool 对 file_sd 只查存在性的缺口；3.5 明确 targets 原子写与 reload 策略分离（仅结构变化触发 reload），6.3 补充 Edge Agent 解压后 targets 解析校验失败回滚、targets 更新不触发 reload；3.4 配置预览扩展为多文件预览与按文件 diff；http_sd 记录为未来演进选项（v0.4+），因弱网自治要求暂不采用 | 配置生成、配置包结构、数据模型、下发流程、验收标准 | MVP / v0.2 | 设计中 |
| v1.7 | 2026-08-04 | 修改 | 确认设计决策 12 规则作用域分层（scope）：3.3「按网域生成配置」中 `rules.yml` 按 `scope` 生成的语义已于 v1.6 澄清（中心域含 `central`/`both`，边缘域 v0.4+ 含 `edge`/`both`），与 Module_01 5.5 `MonitoringRule.scope` 字段及网域无关性说明一致；本轮仅记录确认、正文无需再调整 | 配置生成 | MVP / v0.2 | 设计中 |
| v1.6 | 2026-08-04 | 修改 | 澄清 3.3「按网域生成配置」中 `rules.yml` 的生成语义：规则由中心统一求值，`rules.yml` 按规则作用域生成（中心域含 `central`/`both`，边缘域仅当存在 `edge`/`both` 规则时 v0.4+ 随包下发），避免与「规则不绑网域」设计冲突 | 配置生成 | MVP / v0.2 | 设计中 |
| v1.5 | 2026-08-04 | 修改 | 澄清变更检测为 pull 模式：Module_09 异步轮询（默认 30s）检测 Module_01/07 各源表 `updated_at` 变化，Module_01/07 不主动通知、不感知 Module_09，写库即完成职责；补充 5.2 变更检测与配置生成全链路时序图（人工确认为唯一同步环节）；7.1 边界表新增「变更检测/配置生成触发」行；验收标准新增轮询触发与检测延迟约束 | 配置生成、模块边界、下发时序、验收标准 | MVP / v0.2 | 设计中 |
| v1.4 | 2026-08-04 | 修改 | 明确变更检测采用「源数据版本触发预筛 + 生成后联合 checksum 裁决」混合机制，差异检测优先级从 P1 提升为 P0；新增 3.3.3 变更检测与草稿去重说明；细化 `ConfigDraft` / `ConfigVersion` metadata 字段（`source_data_version`、`trigger_summary`、联合 checksum）；明确 Edge Agent 拉取包 checksum 完整性校验行为 | 配置生成、数据模型、下发时序、验收标准 | MVP / v0.2 | 设计中 |
| v1.3 | 2026-08-04 | 修改 | 明确 blackbox exporter 同域部署：配置包按需包含 `blackbox.yml`；blackbox job 生成 `metrics_path=/probe` 的 scrape_config 并将 `__address__` 指向本地 blackbox exporter；增加下发前 `promtool` / `--config.check` 校验与 Edge Sync Agent 触发 blackbox 重载要求；补充离线交付物中 blackbox 二进制、capability 与 systemd 依赖说明 | 配置生成、下发流程、交付物、数据模型、验收标准 | MVP / v0.2 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | 新增 3.11 节：明确单网域/多网域模式行为；将开关从平台级 feature flag 调整为租户级 `Tenant.multi_site_enabled`；`default` 网域新增 `domain_type=management` 且允许修改名称/描述、禁止删除；Edge Sync Agent 协议后端保留能力、UI 隐藏 | 功能范围、UI/UX、MVP 边界、数据模型 | MVP / v0.2 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | MVP / v0.2 / v1.0 | draft |
