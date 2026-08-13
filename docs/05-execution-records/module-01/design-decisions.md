# 设计决策记录：module-01

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-01/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-04

- **参与 Agent**：orchestrator
- **触发原因**：用户基于 Module_01 原型分析提出三点问题，进行需求对齐与决策记录

### 关键决策

#### 决策 4：拨测配置合并为 ScrapeJob 的 blackbox 类型

- **问题**：拨测配置是否与采集规则配置重复/能否合并？
- **结论**：将拨测配置合并到 `ScrapeJob` 中，新增 `job_type` 字段（`standard` / `blackbox`）。blackbox 拨测不再作为独立配置实体，而是 ScrapeJob 的一种类型。
- **依据**：
  - 用户在原型中发现「采集类型 = 应用」与「应用拨测」存在功能重叠；
  - Prometheus 实践中 Blackbox Exporter 探测本质上也是一种 scrape job（`metrics_path=/probe`，通过 relabel 注入 target）。
- **影响范围**：
  - PRD 3.1 移除独立「拨测配置管理」条目，改为 ScrapeJob 的 blackbox 类型说明；
  - 数据模型 `ScrapeJob` 增加 `job_type` 字段；
  - 需新增/明确 blackbox target 的数据结构（URL / 域名 / IP:Port / module / protocol）；
  - Module_09 生成配置时，blackbox Job 生成 scrape_configs + 生成/更新 `blackbox.yml` 中的 modules；
  - 原型 `ProbesPage.tsx` 需合并到 `ScrapeJobsPage.tsx` 或改为 blackbox Job 专属视图。

#### 决策 5：指标库是规则编辑的前置依赖，MVP 强依赖内置库

- **问题**：指标元数据是否应改为指标库，且先有指标库才能写 PromQL？
- **结论**：
  - 规则编辑保存时，`expr` 引用的指标必须先存在于 `ExporterMetricLibrary`（内置库）；
  - MVP 通过内置常见 Exporter 静态指标库保证规则编辑可用；
  - P1 开放用户扩展指标库，支持新增/覆盖/禁用指标。
- **依据**：
  - 企业级平台需要统一的指标命名、类型、单位、标签规范；
  - 规则编辑的 PromQL 校验应同时检查语法正确性和指标是否被平台识别。
- **影响范围**：
  - `RulesPage.tsx` 保存逻辑增加「指标存在性校验」，未命中指标库时返回明确错误；
  - MVP 必须内置 node-exporter、mysqld-exporter、redis-exporter、blackbox-exporter 等常见 Exporter 的完整指标库；
  - `ExporterMetricLibrary.enabled=false` 的指标不参与提示与校验。

#### 决策 6：保留「指标元数据」概念，内部实现为「指标库」

- **问题**：术语统一为「指标库」还是保留「指标元数据」？
- **结论**：保留「指标元数据」作为管理能力名称（页面/菜单可继续叫「指标元数据」），其底层数据集合称为「指标库 / ExporterMetricLibrary」。
- **依据**：
  - 「指标元数据」更贴近用户对产品管理能力的理解（维护指标名、类型、HELP、UNIT、标签）；
  - 「指标库」更贴近数据模型与规则编辑时的调用语义。
- **影响范围**：
  - PRD 中统一说明：指标元数据管理能力由 `ExporterMetricLibrary` 指标库实现；
  - 页面标题保留「指标元数据」，模型/接口命名使用 `MetricLibrary`。

#### 决策 7：Module_01 / Module_07 的七类变更均触发 Module_09 配置重算

- **问题**：不同网域的监控策略配置会触发或影响哪些配置文件修改？
- **结论**：以下变更都会触发 Module_09 为对应 `network_domain_id` 重新生成 `ConfigDraft`：
  1. `ScrapeJob` / `MonitoringRule` / Blackbox Probe 的 CRUD 与启停；
  2. `CITypeExporterMapping` 变更；
  3. `LabelTemplate` 变更（Module_07）；
  4. `Resource` 变更（Module_07）；
  5. `ExporterInstallationConfirmation` 状态变更。
- **依据**：
  - Module_09 按网域聚合策略数据生成 `prometheus.yml` / `rules.yml` / `blackbox.yml`；
  - 上述变更分别影响 target 列表、labels、scrape 参数、规则内容。
- **影响范围**：
  - Module_09 轮询逻辑需覆盖上述数据源，并设计变更检测机制（checksum / 版本号 / updated_at）；
  - 各类变更影响的配置文件不同：
    - `ScrapeJob` / blackbox Job → `prometheus.yml`（+ `blackbox.yml` 若含 blackbox module）；
    - `MonitoringRule` → `rules.yml`；
    - `CITypeExporterMapping` / `LabelTemplate` / `Resource` / `ExporterInstallationConfirmation` → `prometheus.yml` 的 targets/labels/scrape 参数。

#### 决策 8：blackbox exporter 与采集器同域部署

- **问题**：blackbox exporter 应该在每个网域边缘同域部署，还是在中心统一探测所有网域目标？
- **结论**：采用方案 A，每个网域（含中心 `default`）同域部署 blackbox exporter；Module_09 下发的配置包同时包含 `prometheus.yml` 与按需生成的 `blackbox.yml`。
- **依据**：
  - 技术可行性报告结论（`docs/05-execution-records/module-01/tech-feasibility.md`）；
  - 同域部署能真实反映该网域对目标的可达性，不引入跨网域探测流量，适配政务网/专网隔离要求；
  - 中心远程探测会导致流量回环、单点、路径不一致等问题。
- **影响范围**：
  - Module_09 配置包按需包含 `blackbox.yml`，并生成 `metrics_path=/probe` 的 blackbox scrape_configs；
  - Edge Sync Agent 启动脚本需负责拉起 blackbox exporter，并在配置更新后触发其重载；
  - ICMP 探测需在交付物中显式授予 `CAP_NET_RAW` 或 root 权限。

#### 决策 9：变更检测采用「源数据版本触发 + 联合 checksum 裁决」混合机制

- **问题**：Module_09 变更检测应采用 checksum 对比还是版本号/`updated_at` 对比？
- **结论**：采用混合机制，按场景分工：
  - **中心生成侧（场景 A）**：第一层用「源数据版本」（各源表 `max(updated_at)` 聚合）做触发预筛，决定"要不要算"；第二层生成后用联合 checksum（`sha256(prometheus.yml+rules_yml+blackbox_yml)`）与生效 `ConfigVersion` 对比裁决，决定"要不要确认"。内容一致则不生成新草稿，避免草稿噪音。
  - **边缘拉取侧（场景 B）**：用 `ConfigVersion.id`（版本号）做拉取比对（心跳返回 304）；`metadata.json` 中的 checksum 做拉取后完整性校验。
- **依据**：
  - 版本号/`updated_at` 检测成本低但误报多（任意 touch 都触发重算）、漏报风险（新增源表未纳入聚合）；
  - checksum 裁决精确（内容未变即判定无变化）且天然幂等，但必须先生成完整配置才能对比；
  - 两者职责互补：版本号管"要不要算 / 要不要拉"，checksum 管"算出来变没变 / 拉的对不对"。
- **影响范围**：
  - PRD 3.3 差异检测优先级由 P1 提升为 P0；
  - `ConfigDraft.metadata` 增加 `source_data_version`、`trigger_summary` 字段；`ConfigVersion.metadata.checksum` 作为差异检测与边缘完整性校验的统一基准；
  - Edge Sync Agent 拉取配置包后必须先校验 checksum，失败保留旧配置并记录错误。

#### 决策 10：采集 Job 网域约束与配置触发职责边界

- **问题**：
  - Module_01 中标准 `ScrapeJob` 的 `network_domain_id` 只有字段定义、无约束说明（仅 blackbox 类型有显式约束），是否所有 ScrapeJob 都必须绑定网域？
  - 采集 Job 功能是绑定「管理域」还是「网域」维度？
  - "触发 Module_09 配置变化"由哪个模块主负责？边界如何划分？触发是否为异步轮询？
- **结论**：
  1. **绑定维度**：采集 Job（含规则编辑）绑定的是「网域」维度（`network_domain_id`），非特指管理域 `default`；`default` 只是中心管理域，存在其他 `edge` 域。
  2. **网域约束**：所有 ScrapeJob（`standard` + `blackbox`）必须绑定且仅绑定单一 `network_domain_id`，禁止跨网域共享采集/拨测目标；`instance_selection_mode=manual` 时 `selected_instance_ids` 选中的 Resource 必须与 Job 同域，保存时校验。
  3. **职责边界**：Module_01/07 为**数据写入方**（Source of Truth），只负责策略/资源落库并维护 `updated_at`，不主动通知、不感知 Module_09；Module_09 为**配置唯一生成者**，负责「变更检测 → 生成 → checksum 裁决 → 草稿 → 人工确认 → 下发」全链路。
  4. **触发机制**：**pull 模式异步轮询**（默认 30s）。决策 7 中"XX 变更触发 Module_09 重算"的语义 =「Module_09 轮询时检测到 XX 的 `updated_at` 变化」，而非事件推送；人工确认 / 中心 reload 为同步，草稿检测与边缘拉取为异步。
- **依据**：
  - 网域隔离是产品核心约束（Module_09 归属约束：`network_domain_id` 全局唯一、1 租户 : N 网域）；
  - pull 轮询将 01/07 与 09 解耦，01/07 完全无需感知 09，符合弱网/政务网最终一致架构。
- **影响范围**：
  - Module_01 PRD 5.4 ScrapeJob 数据模型（网域约束统一）、用户故事 M01-OPS-02、3.1 功能表、验收标准；
  - Module_09 PRD 3.3.3（触发模式声明）、5.2（时序图）、7.1（边界表）、验收标准。

#### 决策 11：MVP 指标库最小集范围与用户扩展机制

- **问题**：MVP 内置 Exporter 指标库（ExporterMetricLibrary）的范围与指标数量如何界定？
- **结论**：
  1. **范围跟随当前 CMDB 的 CI 类型**（`host` / `middleware` / `application` / `generic_target`），为各 CI 类型可绑定的常见 Exporter 预置静态指标库：node-exporter（host，30~60）、mysqld-exporter / redis-exporter / kafka-exporter（middleware 细分，各 20~50）、blackbox-exporter（application / generic_target，10~20）；
  2. **保留现有用户扩展能力**：P1/P2 提供指标库管理页面，支持用户**手动导入**（JSON/CSV 或抓取已部署 Exporter 的 metrics 元数据）与**更新/覆盖/禁用**内置指标；MVP 阶段内置库为只读静态数据。
- **依据**：
  - 当前 CMDB `ResourceType` 枚举为 host / middleware / application（platform/models/resource.go），Module_07 另有 generic_target；
  - 指标库是规则编辑 PromQL 校验与指标提示的前置依赖（决策 5），内置范围应以平台实际管理的 CI 类型为界，避免预置无关 Exporter。
- **影响范围**：
  - Module_01 PRD 5.3（MVP 指标库最小集清单）、验收标准。

### 已确认项（2026-08-04）

- [x] blackbox target 内嵌到 `ScrapeJob`，通过 `job_type=blackbox`、`blackbox_module`、`blackbox_targets` 配置，不再维护独立 `BlackboxTarget` 实体。
- [x] 所有 ScrapeJob（standard + blackbox）必须绑定且仅绑定单一 `network_domain_id`，禁止跨网域共享采集/拨测目标；manual 模式资源须同域校验。
- [x] 原型中将独立「拨测」入口合并到「采集 Job」页面，以 blackbox 类型视图呈现。
- [x] Module_09 变更检测采用「源数据版本触发预筛 + 生成后联合 checksum 裁决」混合机制（详见决策 9）。
- [x] 配置触发职责边界：Module_01/07 只写库维护 `updated_at`，不主动通知；Module_09 异步轮询（pull 模式）检测并生成配置（详见决策 10）。
- [x] MVP 指标库最小集：跟随当前 CMDB CI 类型预置常见 Exporter 指标；P1 保留用户手动导入/更新/覆盖/禁用能力（详见决策 11）。

### 仍待确认项

- 无（本阶段设计决策已全部书面化）

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-04（第二轮）

- **参与 Agent**：orchestrator、prototype-designer
- **触发原因**：用户基于 Module_01 原型提出三组问题（rules.yml 生成语义冲突、模板层/实例层关系、CI 类型一致性），并进行企业级架构决策

### 关键决策

#### 决策 12：规则作用域分层（scope）解决「每域生成 rules.yml」与「规则不绑网域」冲突

- **问题**：Module_01 规则不绑定网域、由中心统一求值；但 Module_09 原文「为每个网域生成 rules.yml」。物理隔离网域断网后，边缘站点告警是否失效？两个方案哪个更合理？
- **结论**：采用 **scope 分层方案**（center/edge/both），当前 PRD v1.6 已正确表述，二者不冲突：
  - 规则是**同一份**，由 `scope` 决定**谁求值**：`central` → 中心 Prometheus（跨域聚合/全局告警）；`edge` → 边缘 Agent 本地评估（断网自治）；`both` → 两端都跑（如节点宕机）。
  - Module_09 按 scope 分发 `rules.yml`：中心域含 `central`/`both`；边缘域仅当存在 `edge`/`both` 规则时（v0.4+）随配置包生成。
  - MVP ~ v0.3 阶段 `scope` 固定 `central`，不暴露给用户（Module_01 数据模型已预留 `scope` 字段）。
- **依据**：政务云/金融专网断网自治诉求 + Prometheus/Thanos 社区 scope 求值实践；纯中心求值在隔离网域断网时告警全失效，纯边缘求值无法跑跨域聚合规则。
- **影响范围**：Module_01 5.5（`MonitoringRule` 增加 `scope` 字段）；Module_09 3.3（rules.yml 按作用域生成）、5.2 时序图、验收标准。

#### 决策 13：CI-Exporter 映射（模板层）不绑定网域，v0.3+ 提供网域级覆盖表

- **问题**：模板层是否需要绑定网域？采集 Job（实例层）参数（端口/路径/协议/间隔/超时）可被映射覆盖，参数到底以哪个数据为准？
- **结论**：
  1. **MVP：映射不绑定网域**。映射是「平台级默认预设」，全局一份，绑域会破坏全局复用性；
  2. **v0.3+：新增 `CITypeExporterMappingOverride`（网域级覆盖表）**，支持按 `network_domain_id` 覆盖默认端口/scheme 等参数（如 gov-cloud-a 强制 HTTPS）。覆盖表优先于映射默认值。
- **依据**：模板层职责是「预设默认值」，不同网域环境差异（安全策略/端口）通过覆盖表表达，而非把网域塞入主表。
- **影响范围**：Module_01 5.1 数据模型（新增覆盖表说明，MVP 不实现）。

#### 决策 14：参数优先级采用「创建时快照 + 显式覆盖 + 手动同步」模型

- **问题**：ScrapeJob 参数继承映射默认值并可覆盖，映射后续变更如何同步到已有 Job？
- **结论**：**不自动同步，采用显式同步**：
  - 创建 ScrapeJob 时：加载映射默认值 →（若有网域覆盖则用覆盖值）→ 用户可修改任一字段 → 保存后 Job 持有**快照值**；
  - 映射修改后：已有 Job **不受影响**（避免批量变更导致大面积采集中断），UI 提示「映射默认值已变更」，用户可手动点击「同步映射默认值」重置；
  - 优先级链：**网域覆盖 > 映射默认值 > Job 手动值（保存后即为 Job 自身值）**。
- **依据**：企业级产品保护存量原则——改一个默认端口不应静默改变所有存量 Job；变更必须显式确认。
- **影响范围**：Module_01 5.1/5.4 数据模型说明、原型 ScrapeJobsPage 交互（创建时预填 + 覆盖标记 + 同步提示）。

#### 决策 15：标签模板在映射与 Job 中同时出现是「继承链」设计，两者都需要

- **问题**：CI-Exporter 映射和采集 Job 都有「标签模板」选项，是否冗余？
- **结论**：**不是冗余，是参数继承链的标准设计**：
  - `CITypeExporterMapping.label_template_id` 定义该 CI 类型的**默认**标签模板（如中间件通用模板）；
  - 创建 Job 时自动预填该值，用户可按需覆盖为更精确的模板（如 Redis 自定义模板）；
  - 模板数据由 Module_07 维护，Module_01 只读引用；原型已实现「创建 Job 时预填映射值、允许覆盖」。
- **依据**：与决策 14 的参数继承模型一致；LabelTemplate 作为「标签契约」必须在生成 Job 时稳定可用。
- **影响范围**：Module_01 5.1/5.4 说明文案（MVP 原型已实现，无需改交互）。

#### 决策 16：Module_01 与 Module_07 采用两套不同粒度的 CI 类型体系，通过映射关系对齐

- **问题**：Module_01 的 CI 类型与 Module_07 是否一致？未来来源都是 CMDB，数据同步如何保持？
- **结论**：
  - **Module_07 Resource 用粗粒度四大类**（`host` / `middleware` / `application` / `generic_target`）+ 细粒度 `middleware_type`（mysql / redis / kafka / ...）；
  - **Module_01 resource_type 用细粒度 CI 类型**（`host` / `mysql` / `redis` / `kafka` / `nginx` / `application_http` / `snmp`），直接映射到 Exporter 绑定与指标库；
  - 两套类型通过 **CI 类型映射关系**（`CI_TYPE_CATEGORY_MAP`，原型已实现）对齐：`category(middleware) + middleware_type(redis) → resource_type(redis)`；
  - **未来 CMDB 来源（v0.4+）**：Module_04 同步 CMDB 时，向 Module_07 写入四大类 + middleware_type，同时向 Module_01 写入/刷新细粒度 resource_type 映射表；两类类型定义均以 CMDB CI 类型为唯一权威来源，MetricCenter 侧仅维护映射关系，不做类型增删。
- **依据**：对象管理层（粗粒度）与策略层（细粒度，需精确匹配 Exporter）关注点不同；CMDB 作为权威来源后，类型枚举由 CMDB 驱动，MetricCenter 只做映射。
- **影响范围**：Module_01 数据来源说明、Module_07 资源模型说明、Global Architecture 或 Module_01 需补充类型映射关系表。

### 已确认项（2026-08-04 第二轮）

- [x] rules.yml 与「规则不绑网域」通过 scope 分层解决，Module_01/09 已同步（Module_01 v1.5、Module_09 v1.6）。
- [x] CI-Exporter 映射为模板层、不绑网域；v0.3+ 预留网域覆盖表。
- [x] 参数同步采用「创建时快照 + 显式覆盖 + 手动同步」，不自动同步。
- [x] 标签模板继承链设计确认（映射默认 → Job 覆盖）。
- [x] 两套 CI 类型粒度体系确认，以 CMDB 为权威来源，MetricCenter 维护映射关系。

### 仍待确认项

- [ ] 决策 13 网域覆盖表是否在 v0.3 落地（当前仅 PRD 预留说明）。
- [ ] 决策 14 的「同步映射默认值」交互是否需要原型演示（当前原型仅以 Alert 提示）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v1.5）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.2）
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.6）
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-04（第三轮）

- **参与 Agent**：orchestrator、prototype-designer
- **触发原因**：用户基于 Module_01 原型提出 5 个 UI/体验问题，经 AskUserQuestion 确认方案后执行

### 关键决策

#### 决策 17：CI 类型选择统一为「资源类别 → 细粒度类型」两级级联

- **问题**：中间件类型（mysql/redis 等）与资源类别是 1:N 关系，前台显示「MySQL（middleware）」把类型与大类拼接，观感奇怪；用户建议先选中间件再选子类型。
- **结论**：Module_01 所有涉及 CI 类型的选择（CI-Exporter 模板映射、采集 Job、规则编辑、指标库筛选）统一改为**「资源类别 → 细粒度 CI 类型」两级级联**：先选资源类别（主机/中间件/应用/通用目标），再选该类别下的细粒度类型；选中后通过 `CITypeExporterMapping` 自动带出默认 Exporter 模板（可覆盖）。
- **依据**：与 Module_07 的 Resource 选择体验一致；消除「MySQL（middleware）」这类拼接表述；两级结构天然表达 middleware → mysql/redis 的 1:N 关系。
- **影响范围**：原型 ScrapeJobsPage / CiExporterMappingPage / RulesPage / MetricLibraryPage 四处的 CI 类型选择；Module_01 PRD 5.1 新增交互说明（v1.8）。

#### 决策 18：指标库支持按「资源类别 → CI 类型」两级筛选

- **问题**：指标库当前仅按 Exporter 分组与 metric_type 筛选，无法按 CI 类型定位某类资源可用的监控指标。
- **结论**：指标库筛选区新增「资源类别 → CI 类型」两级级联下拉；选中 CI 类型后，经 `CITypeExporterMapping` 定位该类型可用的 Exporter 模板集合，过滤其指标，与 metric_type 筛选叠加。
- **影响范围**：原型 MetricLibraryPage；Module_01 PRD 5.3 新增筛选说明（v1.8）。

#### 决策 19：规则编辑的 CI 类型与 Exporter 模板联动

- **问题**：规则编辑中「资源类型」和「关联 Exporter 模板」是两个独立下拉，无联动。
- **结论**：规则编辑同样采用两级级联选择资源类型；选中细粒度 CI 类型后 `exporter_template_id` 自动带出该类型映射的默认 Exporter（可覆盖），并据此过滤指标预览与 PromQL 校验范围。
- **影响范围**：原型 RulesPage；Module_01 PRD 5.5 新增「CI 类型 ↔ Exporter 模板联动」说明（v1.8）。

#### 决策 20：UI 文案产品化与功能命名

- **问题**：原型 UI 中出现内部代号「决策 14」（参数同步列名）；「CI-Exporter 映射」功能名缺少「模板」二字，弱化模板层定位。
- **结论**：
  1. UI 展示文案**移除内部决策编号**：列表列名「参数同步（决策 14）」→「参数同步」，仅代码注释/测试名保留决策编号；
  2. 功能名统一为 **「CI-Exporter 模板映射」**（菜单、页面标题、Modal 标题），强化「模板层预设」定位，与采集 Job（实例层）区分。
- **影响范围**：原型 MainLayout / CiExporterMappingPage / ScrapeJobsPage；Module_01 PRD 3.1/5.1 功能表述（v1.8）。

#### 决策 21：CMDB 侧保持细粒度 CI 类型，category 仅为 MetricCenter 内部维度

- **问题**：中间件 1:N 在 CMDB 中是否也要设计为「中间件 → MySQL」父子模型？
- **结论**：**CMDB 侧不需要**——CMDB 的 CI 类型本身是细粒度的（BlueKing `bk_obj_id` 直接是 mysql/redis/mongodb 等独立模型），不存在父子分类表达；MetricCenter 的粗粒度四大类（category）**仅是内部资源管理维度**（四类资源 CRUD 页面、标签模板归属、孤儿资源分组），不是 CMDB 概念；`middleware_type`（细粒度）来自 CMDB `bk_obj_id`（v0.4+）或 Excel 导入列（MVP），`resource_type`（粗粒度）由 Module_04 的「CMDB CI 类型映射表」将细粒度 CI 归类。
- **依据**：CMDB 作为权威来源时类型枚举由 CMDB 驱动，MetricCenter 只维护映射（Module_04 7.1 映射表已确认细粒度 → 粗粒度）。
- **影响范围**：Module_07 PRD 5.1 新增「CMDB 侧边界」说明（v1.4）；Module_01 PRD 5.1 类型映射说明（v1.8）。

### 已确认项（2026-08-04 第三轮）

- [x] CI 类型选择统一两级级联（决策 17），四处 UI 均已实现。
- [x] 指标库两级筛选（决策 18），原型 MetricLibraryPage 已实现。
- [x] 规则编辑 CI 类型 → Exporter 联动（决策 19），原型 RulesPage 已实现。
- [x] UI 文案产品化（决策 20）：移除「决策 14」字眼，功能名改为「CI-Exporter 模板映射」。
- [x] CMDB 细粒度边界确认（决策 21），Module_07 v1.4 已落档。

### 仍待确认项

- 无（本阶段决策已全部书面化并落地原型与 PRD）

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v1.8）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.4）
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-04（第四轮）

- **参与 Agent**：prototype-designer
- **触发原因**：用户确认 Module_01 原型优化方向（多网域模式开关 / 规则校验预览动态化 / 详情只读视图 / blackbox_targets 模型对齐 / 版本同步 v1.9）

### 关键决策

#### 决策 22：blackbox_targets 数据模型由 `[]string` 调整为 `[]BlackboxTarget` 对象数组

- **问题**：PRD 5.4 定义 `blackbox_targets` 为 `[]string`（探测目标字符串），而原型已实现为对象数组 `{target, protocol, url}`；同一 blackbox Job 内需要区分不同协议的探测目标，字符串数组无法表达。
- **结论**：PRD 对齐原型，`blackbox_targets` 类型调整为 `[]BlackboxTarget`（字段：`target` 地址/IP/host:port、`protocol` http/https/tcp/icmp/dns、`url` 完整 URL 可选）；PRD 5.4 新增「BlackboxTarget 结构」说明；Module_09 生成 `blackbox.yml` 时按 `blackbox_module` 生成对应 module，`static_configs.targets` 填充为 `blackbox_targets[].target`（HTTP/HTTPS 优先 `url`）。
- **依据**：blackbox 探测需按协议区分（module 与 target 一一对应）；原型交互已验证对象数组更贴合实际操作。
- **影响范围**：Module_01 PRD 5.4（v1.9）、验收标准；原型 mock 类型与测试（新增 protocol 合法性断言）。

#### 决策 23：指标库数据提升为模块级共享 store，规则校验/预览实时联动

- **问题**：RulesPage 的 PromQL 校验与指标预览基于静态 `mockMetricLibrary`，用户在指标库页新增/禁用指标后，规则编辑无法实时感知，违背「先指标库后 PromQL」的产品语义。
- **结论**：mock 新增模块级共享容器 `metricLibraryStore`（刷新后随 mock 重置）；MetricLibraryPage 的增删改（`syncStore`）同步写入该容器；RulesPage 的校验与预览实时读取该容器。跨页面联动演示「指标库存在性校验」闭环。
- **依据**：决策 5（规则编辑保存时 expr 引用的指标必须存在于指标库）；原型需演示动态依赖关系，避免开发输入失真。
- **影响范围**：原型 mock（`metricLibraryStore`）、MetricLibraryPage、RulesPage。

#### 决策 24：Module_01 原型增加单网域/多网域模式开关（Tenant.multi_site_enabled）

- **问题**：web-development 规范要求 mock 包含 `Tenant.multi_site_enabled` 租户级开关演示单/多网域模式差异；Module_09 已实现，Module_01 缺失。
- **结论**：mock 新增 `currentTenant`（含 `multi_site_enabled`，默认 true）；MainLayout Header 增加 Switch 开关（切网域模式），切换时派发 `tenant-mode-change` 全局事件；单网域模式下采集/拨测 Job 网域下拉禁用且仅 `default`，若表单已选边缘域则强制切回 `default` 并清空已选实例。
- **依据**：web-development 规范；Module_09 原型实现方式（`currentTenant.multi_site_enabled` 模块级可变 + Header Switch）。
- **影响范围**：原型 mock、MainLayout、ScrapeJobsPage。

#### 决策 25：采集 Job「详情」改为只读视图，与「编辑」抽屉区分

- **问题**：列表「详情」按钮与「编辑」行为相同（都打开编辑抽屉），交互语义重复。
- **结论**：详情改为只读 Modal（Descriptions 展示 Job 全字段 + 已选实例/拨测目标列表 + 安装状态徽标），编辑抽屉仅用于编辑。
- **依据**：UI/UX 一致性（决策 20 文案产品化的延续）。
- **影响范围**：原型 ScrapeJobsPage。

#### 决策 26：原型/PRD 版本同步 v1.9

- **问题**：PRD 已至 v1.8，原型 README/package.json/mock 注释仍标 v1.4 / v1.2，版本滞后导致评审混淆。
- **结论**：因 blackbox_targets 数据模型变更 PRD 升至 v1.9；原型 package.json / README / mock 注释 / 测试标题同步 v1.9；`MonitoringRule` mock 补齐 PRD 5.5 的 `scope` 字段（MVP 固定 `central`）。
- **影响范围**：Module_01 PRD v1.9、原型全部标注。

### 已确认项（2026-08-04 第四轮）

- [x] blackbox_targets 对象数组模型对齐（决策 22），PRD v1.9 + 原型 + 测试同步。
- [x] 指标库共享 store 实时联动（决策 23），跨页面演示「先指标库后 PromQL」。
- [x] 单网域/多网域模式开关（决策 24），与 Module_09 对齐。
- [x] Job 详情只读视图（决策 25）。
- [x] 版本同步 v1.9（决策 26），验证通过（test 20/20、lint、build、dev server、统一入口、浏览器实测）。

### 仍待确认项

- [ ] PRD 状态推进：用户于 2026-08-04 在《原型验证结论》汇报后确认**暂不推进** PRD 至 `ready`，当前保持「设计中」；待领导/业务评审反馈后再行确认（PRD v1.9 顶部状态与 Change Log 状态列暂不修改）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v1.9）
- `docs/05-execution-records/module-01/tech-feasibility.md`
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-04（第五轮）

- **参与 Agent**：prototype-designer
- **触发原因**：用户确认 Module_01 参数优先级语义（采集 Job 参数优先级高于模板；Job 参数更新不回写模板），并发现 PRD「优先级链」表述歧义与原型同步行为不一致

### 关键决策

#### 决策 27：参数优先级表述改为「两段式」，消除歧义

- **问题**：PRD 5.1 原文「优先级链：网域覆盖 > 映射默认值 > Job 手动值」将「Job 手动值」排在链尾，字面上会被误读为「模板可覆盖 Job 手动值」，与「Job 快照为最终生效值」的设计矛盾。
- **结论**：改为两段式表述：
  - **创建预填来源优先级**：网域覆盖（v0.2）> 映射默认值 > Exporter 模板内置默认；
  - **生效优先级**：Job 保存后参数快照即为该 Job 最终生效配置（最高），映射/网域覆盖后续变更**不自动覆盖**，仅提示后由用户手动「同步映射默认值」刷新。
- **依据**：用户确认「采集 Job 参数优先级高于模板」；决策 14 保护存量原则。
- **影响范围**：Module_01 PRD 5.1（v2.0）。

#### 决策 28：同步映射默认值仅刷新未手动覆盖的字段，Job 记录 mapping_overrides

- **问题**：决策 14 要求「手动覆盖过的字段不刷新」，但原型 `syncFromMapping` 为全量刷新；且需要数据结构记录覆盖标记。
- **结论**：
  1. `ScrapeJob` 新增 `mapping_overrides: []string` 字段（手动覆盖过的映射继承参数名：scrape_interval / scrape_timeout / metrics_path / scheme / label_template_id）；
  2. 原型表单通过 `onFieldsChange` + `touched` 标记用户手动修改的字段，保存时写入 `mapping_overrides`；
  3. `syncFromMapping` 仅刷新不在 `mapping_overrides` 中的字段，覆盖字段保持用户值，同步提示展示被保护字段；
  4. **同步方向单向**：Job 参数更新（含手动覆盖）**不回写** CI-Exporter 模板映射（模板为平台级默认预设，Job 为独立快照）。
- **依据**：用户确认「采集 Job 参数更新不会同步给 CI-Exporter」；决策 14。
- **影响范围**：Module_01 PRD 5.4（v2.0）、原型 ScrapeJobsPage 与 mock（`mapping_overrides`）。

### 已确认项（2026-08-04 第五轮）

- [x] 参数优先级两段式表述（决策 27），PRD v2.0 落档。
- [x] `mapping_overrides` 覆盖保护（决策 28），PRD v2.0 + 原型 + 测试同步（test 21/21、lint、build 通过）。
- [x] Job 参数不回写模板（单向继承），无反向同步。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（用户 2026-08-04 确认暂不推进至 ready，待领导/业务评审）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.0）
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-07（第六轮）

- **参与 Agent**：orchestrator、prototype-designer
- **触发原因**：用户要求核查 Module_01 PRD 的用户故事编码是否已统一为 `Mxx-ROLE-NN` 新格式、无旧编码遗留，并确认文档已按 prototype-designer PRD 骨架规范完成骨架调整；如有缺口则补齐

### 关键决策

#### 决策 29：用户故事编码统一为模块命名空间 `Mxx-ROLE-NN`

- **问题**：Module_01 用户故事编码是否已全部更新为 `Mxx-ROLE-NN` 新格式，有无遗留旧编码（`OPS-XX` / `ARCH-XX`）？
- **结论**：
  - Module_01 第 2 章用户故事已全部使用 `M01-OPS-01~06` / `M01-ARCH-01~03` 模块命名空间编码（全局唯一），旧编码 `OPS-01~06` / `ARCH-01~03` 已全部替换，无正文遗留；
  - 完整故事条目（角色 / 我希望 / 以便于）注册于全局用户故事库 `01_User_Stories.md` §4.1，模块 PRD 第 2 章仅列编码 + 一句话摘要（本轮补充引用说明）；
  - 历史变更记录中的旧编码仅存在于已迁移至本文件的「Change Log（完整历史）」（v2.1 及以前版本当时使用的编码，属历史快照，不做追溯改写）。
- **依据**：全局用户故事编码规则（`01_User_Stories.md` §4，v1.24 固化）：产品级故事由全局库统一维护，模块级故事使用 `Mxx-ROLE-NN`，禁止复用产品级编码但语义不同。
- **影响范围**：Module_01 PRD 第 2 章、全局用户故事库 §4.1、Change Log。

#### 决策 30：Module_01 PRD 按 prototype-designer 骨架规范补齐

- **问题**：prototype-designer 要求 PRD 包含背景与目标、用户故事、功能范围、UI/UX 规范、数据模型、API 规范、验收标准等章节；Module_09（v1.24）/ Module_07（v1.6）已按新骨架规范落地（数据模型加「UI 展示名」列、术语映射章节、验收标准分层），Module_01 尚未对齐。
- **结论**：Module_01 PRD 升版 v2.4，落地以下骨架调整：
  1. 数据模型 5.1~5.8 字段表统一新增「UI 展示名」列（与技术字段 / 仅技术信息标注对齐，参照 Module_09 4.x / Module_07 5.x）；
  2. 新增「术语映射（用户词汇表）」章节（后端术语 ↔ 用户语言权威对照，与「UI 展示名」列一致）；
  3. 验收标准分层：8.1 用户验收（UI 可感知）/ 8.2 技术验收（后端/契约可验证），并补 P0/P1 标注；
  4. 第 2 章用户故事补充全局用户故事库引用说明；
  5. Change Log 精简为最近 3 版一句话摘要，完整历史（v2.1 及以前逐版详情）迁移至本文件「Change Log（完整历史）」小节。
- **依据**：prototype-designer PRD 状态守护职责（Change Log 规范、骨架要求）；Module_09 design-decisions「第十三轮评审」遗留项：骨架规范（UI 展示名 / 术语映射 / 验收分层）需推广到 Module_01/02/07 等其他模块 PRD。
- **影响范围**：Module_01 PRD v2.4 正文各章节、`docs/05-execution-records/module-01/design-decisions.md`。

### 已确认项（2026-08-07 第六轮）

- [x] 用户故事编码已全部统一为 `M01-ROLE-NN`，正文无旧编码遗留。
- [x] Module_01 PRD 骨架调整落地（v2.4）：UI 展示名、术语映射、验收分层、用户故事引用全局库、Change Log 精简。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（尚未完成原型验证，待领导/业务评审）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.4）
- `docs/02-product-requirements/01_User_Stories.md`（§4.1）
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-11（第七轮）

- **参与 Agent**：prototype-designer
- **触发原因**：用户基于 Module_07 标签模板需求分析确认「模板管理归属保持 Module_07 + UX 补齐」，本模块落地标签模板关联体验

### 关键决策

#### 决策 31：标签模板关联 UX 补齐（名称+ID 展示、内联只读预览、跨模块跳转；模板 ID 为跨模块唯一 FK）

- **问题**：CI-Exporter 映射与 Job 表单关联标签模板后看不到模板信息，模板列表不展示 ID，用户无法确认关联的是哪个模板；是否应将标签模板管理整体迁至本模块？
- **结论**：管理归属保持 Module_07（依据见 Module_07 决策 3.10），本模块落地：
  1. 标签模板以「名称（类别 / 模板ID）」展示（映射列表列与表单下拉）；
  2. 选择模板后**内联只读展示映射内容**（来源字段 → 目标标签）+ 「前往标签模板管理」跨模块跳转（统一静态入口生效；dev 独立端口下跳转不生效，属原型隔离的已知限制）；
  3. `label_template_id` 明确为**跨模块唯一稳定 FK**（名称在同一资源类型下可重复，ID 为唯一关联键）。
- **依据**：决策 15（标签模板继承链：映射默认 → Job 覆盖）；Module_07 决策 3.10。
- **影响范围**：Module_01 PRD 5.1 / 5.4（v2.5）、8.1 验收标准；原型 CiExporterMappingPage / ScrapeJobsPage / mock（LabelTemplate 补 mappings 预览数据）/ 测试。

### 已确认项（2026-08-11 第七轮）

- [x] 模板管理归属保持 Module_07，本模块只读关联（用户选择「保持 Module_07 + UX 补齐」）。
- [x] 标签模板关联 UX 落地（名称+ID、只读预览、跨模块跳转），验证通过（test 23/23、lint、build、dev server 200）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（尚未完成完整两段评审，待领导/业务评审）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.5）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.7）
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-11（第八轮 UI/UX）

- **参与 Agent**：prototype-designer
- **触发原因**：用户指出 CI-Exporter 映射页标签模板展示样式不佳（状态徽标语义错位、表单内 Tag 堆砌不清晰），经 AskUserQuestion 确认方向后落地 PRD

### 关键决策

#### 决策 32：CI-Exporter 映射页标签模板展示改「两行卡片 + 预览抽屉 + 表单紧凑卡片」

- **问题**：列表列用 `Badge status="success"` 标模板名（健康状态语义错位）、名称与 ID 挤一行可读性差；表单内选中模板后用 Alert + Tag 堆砌映射，长模板换行混乱无层级。
- **结论**：
  1. **列表列（两行卡片）**：第一行模板名称 + 「默认/自定义」标记，第二行「类别 · 模板ID」；不使用状态徽标；
  2. **预览抽屉**：点击模板名称打开只读预览抽屉，展示模板映射明细（来源字段 → 目标标签 → 启用）；
  3. **表单内紧凑卡片**：选中模板后以紧凑卡片展示头部（名称 + ID + 默认标记）与映射明细（小表格/列表），替代 Tag 堆砌，并保留「前往标签模板管理」跨模块跳转。
- **依据**：与 Module_07 v1.8 的抽屉编辑/分组展示方向一致；用户视角设计规范（渐进式披露、信息层级）。
- **影响范围**：Module_01 PRD 5.1 / 8.1（v2.6）；原型 CiExporterMappingPage / ScrapeJobsPage（待 v2.2 落地）。

### 已确认项（2026-08-11 第八轮）

- [x] 标签模板展示方向：两行卡片 + 预览抽屉 + 表单紧凑卡片（用户选择）。
- [x] 与 Module_07 v1.8（抽屉编辑 / 映射分组展示）对齐。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v2.2 落地与验证（用户确认后执行，原型需符合 PRD v2.6）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.6）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.8）
- `docs/prototypes/module-01/`

---

## 补充对齐：2026-08-11（第九轮 端口一致性）

- **参与 Agent**：prototype-designer
- **触发原因**：用户基于 Module_07 组合字段讨论提出「映射 default_port 与实际监听端口不一致时 instance 标签会错，Module_01「Exporter 安装确认」功能是否具备端口编辑手段」，经讨论确认后合并落地 PRD

### 关键决策

#### 决策 33：端口一致性三层解法 + 安装确认登记实际端口（不承担端口编辑）

- **问题**：映射 `default_port` 决定 instance 标签端口（Module_07 组合字段）；当与实例上 exporter 实际监听端口不一致时（映射 9100、实例实际 19100），instance 标签会错。Exporter 安装确认功能是否需要/能否承担端口编辑？
- **结论**：
  1. **三层解法**：映射层 `default_port` 可编辑（MVP 已有，解决"某 CI 类型统一非标端口"）→ 网域级覆盖 `CITypeExporterMappingOverride`（v0.2，已预留，解决"某网域统一非标"）→ **实例级端口覆盖（v0.2+ 建议新增**，解决"个别实例非标"，落地方式待评估：Resource 可选 `scrape_port` 或 Job 级 target 端口映射）；
  2. **安装确认不承担端口编辑**：它是"状态登记 + 人工背书"，维度为 resource×exporter、不分 Job，塞入端口会在多 Job 场景互相覆盖；
  3. **增量登记**：安装确认新增 `actual_port`（P1）登记实际监听端口，配置生成时与生效端口不一致**仅提示**、不自动改配置。
- **依据**：职责边界（状态登记 vs 配置项）；用户选择「三层解法 + 确认登记提示」。
- **影响范围**：Module_01 PRD 5.1（端口一致性说明）/ 5.6（actual_port）/ 8.1（v2.7）；Module_07 PRD 5.12 C 取值时序引用。

### 已确认项（2026-08-11 第九轮）

- [x] 端口不一致三层解法（映射层 MVP / 网域覆盖 v0.2 / 实例级覆盖 v0.2+）。
- [x] 安装确认登记 actual_port（P1）仅提示不自动改；不承担端口编辑。
- [x] 与 Module_07 v1.9（组合字段取值时序）对齐。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v2.3 落地与验证（用户确认后执行，原型需符合 PRD v2.7）。
- [ ] 实例级端口覆盖的落地方式（Resource `scrape_port` 或 Job 级 target 端口映射）待 v0.2 评估。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.7）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v1.9）
- `docs/prototypes/module-01/`

---

## 评审记录

### 2026-08-11（标签模板关联 UX 轮）

- **评审时间 / 版本**：2026-08-11；PRD v2.5、原型 v2.1；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户确认关联模板时需能看到模板信息（映射内容）；模板 ID 应可追溯；模板管理归属保持 Module_07 后，本模块以只读预览 + 跳转补齐体验，用户可理解。
- **第二段技术核对结论**：`label_template_id` 为跨模块唯一 FK；本模块 mock 的 LabelTemplate 契约（含 mappings 预览数据）与 Module_07 默认模板一致；跨模块跳转链接在统一静态入口生效（dev 独立端口下跳转 404，为原型隔离已知限制，已写入 README 已知限制）。可开发性结论：预览为前端只读展示，不引入后端变更。
- **问题清单与处理结果**：已修复——模板 ID 展示（列表列 + 表单下拉）、选中模板只读预览映射内容、跨模块跳转入口。
- **遗留项**：无。

### 2026-08-11（UI/UX 优化轮）

- **评审时间 / 版本**：2026-08-11；PRD v2.6、原型 v2.2（规划）；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户指出列表列 `Badge status="success"` 语义错位（模板名不是健康状态）、名称与 ID 挤一行不清晰、表单内 Tag 堆砌无法扫读；确认「两行卡片 + 预览抽屉 + 表单紧凑卡片」方向。
- **第二段技术核对结论**：两行卡片 / 预览抽屉 / 紧凑卡片均为前端展示层改造，不涉及后端模型与 API；预览数据复用既有 LabelTemplate.mappings（v2.1 已引入）。可开发性结论：纯前端，原型可验证。
- **问题清单与处理结果**：已修复（PRD 层面，决策 32）；原型 v2.2 待用户确认后落地。
- **遗留项**：无。

### 2026-08-11（端口一致性轮）

- **评审时间 / 版本**：2026-08-11；PRD v2.7、原型 v2.3（规划）；参与方：用户（chenrt）+ prototype-designer。
- **第一段用户走查结论**：用户确认「安装确认不承担端口编辑」的职责边界；接受三层解法（映射层 MVP / 网域覆盖 v0.2 / 实例级覆盖 v0.2+）；确认安装确认登记 actual_port 仅提示不自动改。
- **第二段技术核对结论**：`actual_port` 为安装确认表新增可选字段（P1），不改变既有状态机与配置生成主链；端口一致性说明与 Module_07 5.12 C 取值时序互相引用，契约一致；实例级端口覆盖落地方式（Resource `scrape_port` 或 Job 级 target 端口映射）留待 v0.2 评估，MVP 不影响。
- **问题清单与处理结果**：已修复（PRD 层面，决策 33）；原型 v2.3 待用户确认后落地。
- **遗留项**：实例级端口覆盖落地方式评估（v0.2）；actual_port 一致性提示（P1，随原型落地）。

---

## 补充对齐：2026-08-11（第十轮 UI/UX 易用性）

- **参与 Agent**：prototype-designer
- **触发原因**：用户基于 Module_01 原型提出两个易用性问题——(1) 采集/拨测间隔的自定义值与模板默认值在 UI 上缺乏视觉区分，用户无法直观感知哪些参数已被覆盖；(2) 规则编辑中的 labels/annotations 与「标签模板」中的 labels 语义不同，需在 UI 上明确告知用户其差异与必要性，并从易用性角度考虑用户词汇表转义。

### 关键决策

#### 决策 34：采集/拨测间隔等参数增加「继承来源」视觉标记，区分模板默认值与用户自定义值

- **问题**：采集 Job 编辑表单中，`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme` 等参数在创建时从 CI-Exporter 映射继承默认值并预填，用户可覆盖。但当前 UI 中所有字段外观一致，用户无法直观区分：
  - 哪些字段当前使用的是**映射模板默认值**（未修改）；
  - 哪些字段已被用户**手动覆盖**（自定义值）；
  - 哪些字段因映射默认值已变更而**处于「待同步」状态**。

  这导致用户在编辑存量 Job 时，不清楚自己的自定义配置是否被保护，也不清楚「同步映射默认值」操作会刷新哪些字段。

- **结论**：在表单字段级别增加三层视觉区分体系：

  1. **继承标记（未修改）**：字段值来自映射默认值且用户未触碰时，在标签（label）旁显示 `<Tag color="default">继承自映射</Tag>` 浅灰色标记，鼠标悬停显示 tooltip 说明来源（如「来自 CI-Exporter 映射 host → node_exporter 的默认值」）；

  2. **覆盖标记（已自定义）**：用户手动修改过字段值后，标记自动切换为 `<Tag color="processing">已覆盖</Tag>` 蓝色标记，tooltip 显示「该字段已被手动覆盖，同步映射默认值时将跳过」；

  3. **待同步标记（映射已变更）**：当映射默认值已变更（`mapping_synced_at < mapping.updated_at`）且该字段**未**被用户覆盖时，显示 `<Tag color="warning">待同步</Tag>` 橙色标记，提示用户执行「同步映射默认值」操作可刷新该字段。

  具体 UI 方案：

  - **表单字段标签行**：每个可继承参数（`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme`、`label_template_id`）的 label 右侧增加一个 inline Tag，状态自动跟随：
    - 创建模式：所有字段初始显示「继承自映射」（因刚预填，用户尚未触碰）；
    - 编辑模式：根据 `mapping_overrides` 和 `isMappingChanged()` 动态计算每个字段的状态标记；
    - 用户修改字段后：通过 `onFieldsChange` 的 `touched` 标记，该字段标记立即切换为「已覆盖」；
    - 执行「同步映射默认值」后：被刷新的字段标记切回「继承自映射」，被跳过的字段保持「已覆盖」。

  - **列表列增强**：当前「参数同步」列仅显示 Job 级别的整体状态（已同步/映射默认值已变更），建议增加第二行小字展示覆盖字段数量概览，如「2 个字段已自定义」或「3 个字段待同步」，让用户在列表页即可感知自定义程度。

  - **详情视图同步**：Job 详情 Modal 的 Descriptions 中，每个参数字段同样显示对应的继承/覆盖/待同步标记，与编辑表单一致。

- **依据**：
  - 用户反馈「不知道修改了/覆盖了哪些部分」——当前 UI 仅在保存时记录 `mapping_overrides`，但编辑态和列表态均无视觉反馈；
  - 决策 14/28 已建立「创建时快照 + 显式覆盖 + 手动同步」的底层机制，UI 层需要将这一机制**可视化**，让用户感知到「保护存量」策略在起作用；
  - 企业级产品中，参数继承链的透明度直接影响用户对「模板修改会不会影响我的 Job」的信任感。

- **影响范围**：
  - 原型 `ScrapeJobsPage.tsx`：表单字段标签行增加动态 Tag、列表「参数同步」列增强、详情视图同步；
  - 原型 mock `module-01.ts`：无需新增字段，复用现有 `mapping_overrides` 和 `mapping_synced_at`；
  - Module_01 PRD 5.4：补充「参数继承视觉标记」说明（v2.8）；
  - 验收标准 8.1 新增：用户可在编辑表单中直观区分继承值与自定义值。

- **交互细节**：
  - 标记颜色语义：灰色=继承（默认/安全）、蓝色=已覆盖（用户主动行为）、橙色=待同步（需关注）；
  - 标记不占用额外表单宽度，嵌入 label 行内，使用 `<Space size={4}>` 紧贴 label 文字；
  - 创建模式下，用户修改字段后标记从「继承自映射」变为「已覆盖」，不可逆（即使改回原值也视为已覆盖，因为用户已主动介入）；
  - 编辑模式下，若映射默认值已变更且该字段未覆盖，标记显示「待同步」，用户执行同步后变为「继承自映射」；
  - `label_template_id` 字段同样适用此标记体系，但标记文案为「继承自映射默认模板」/「已覆盖」/「待同步」。

#### 决策 35：规则编辑中 labels/annotations 与标签模板的语义区分及 UI 注释

- **问题**：规则编辑表单中，`labels` 和 `annotations` 以简单的 key-value 动态表单呈现，placeholder 示例为 `severity`/`warning` 和 `summary`/`主机 CPU 过高`。但用户容易混淆：
  1. **规则 labels**（`MonitoringRule.labels`）与 **标签模板 labels**（`LabelTemplate` 生成的 target labels）是**完全不同层级**的概念——前者是**告警元数据**（决定告警路由、严重等级、接收人），后者是**目标身份标签**（标识被监控资源的 instance/app/env 等身份信息）；
  2. **annotations** 是 Prometheus 告警规则的**人类可读信息**（摘要、描述、故障处理手册链接），非机器消费的标签，但当前 UI 未说明其用途与必要性；
  3. 用户不清楚哪些 labels 是 Prometheus 最佳实践推荐的（如 `severity`、`team`），哪些是可选扩展的。

- **结论**：

  1. **Labels 区域增加语义说明卡片**：
     - 在 labels 表单区域上方增加一个 `Alert type="info"` 卡片，文案为：
       > **规则 Labels 与标签模板的区别**：此处的 labels 是**告警元数据**（如 `severity=critical`、`team=sre`），用于告警分级、路由与接收人匹配；**不是**标签模板中生成的 target 身份标签（如 `instance`、`app`、`env`）。标签模板生成的 labels 由 Module_07 管理，在采集 Job 中配置，无需在此处重复设置。
     - 在卡片中明确必填状态：
       > **必填状态**：labels 整体为**选填**（推荐填写），每个 key 和 value 均为选填。但若填写，建议遵循 Prometheus 最佳实践使用推荐 key。
     - 在 labels 表单下方增加 Prometheus 最佳实践提示：
       > **推荐 labels**：`severity`（严重等级：critical/warning/info）、`team`（负责团队名）。更多 labels 可按需扩展。

  2. **Annotations 区域增加必要性说明卡片**：
     - 在 annotations 表单区域上方增加 `Alert type="info"` 卡片，文案为：
       > **Annotations 的作用**：annotations 是告警触发时附带的**人类可读信息**，用于告警通知中的展示内容。推荐包含 `summary`（一句话摘要）、`description`（详细描述，可引用 `{{ $labels }}` 和 `{{ $value }}` 模板变量）、`runbook_url`（故障处理手册链接）。annotations **不参与告警路由判断**，仅用于通知展示。
     - 在卡片中明确必填状态：
       > **必填状态**：annotations 整体为**选填**（推荐填写），每个 key 和 value 均为选填。但若填写，建议遵循 Prometheus 最佳实践使用推荐 key。
     - 在 annotations 表单下方增加模板变量提示：
       > **模板变量**：description 中可使用 `{{ $labels.instance }}` 引用标签值、`{{ $value }}` 引用当前指标值，实现动态告警描述。

  3. **用户词汇表转义**：
     - 当前 PRD 术语映射表（§术语映射）中，`MonitoringRule.labels` 映射为「规则标签」，`MonitoringRule.annotations` 映射为「告警说明」；
     - 建议在 UI 文案中进一步区分：
       - 规则编辑页面的 labels 区域标题改为 **「告警标签（Alert Labels）」**，副标题小字「用于告警分级与路由」；
       - 规则编辑页面的 annotations 区域标题改为 **「告警说明（Annotations）」**，副标题小字「用于通知展示，支持模板变量」；
       - 标签模板（Module_07）中的 labels 保持 **「标签模板」** 命名，与规则 labels 形成语义区隔；
     - 在 PRD 术语映射表中补充一行：

       | 后端术语 | 用户语言 | 说明 |
       |---|---|---|
       | `MonitoringRule.labels` | 告警标签（Alert Labels） | 告警规则的元数据标签，用于分级/路由，**非** target 身份标签 |
       | `MonitoringRule.annotations` | 告警说明（Annotations） | 告警触发时附带的**人类可读信息**，用于通知展示，不参与路由判断 |
       | `LabelTemplate` 生成的 labels | 目标标签（Target Labels） | 标识被监控资源身份的标签（instance/app/env），由采集 Job 的标签模板生成 |

  4. **记录规则的特殊处理**：
     - 记录规则（`rule_type=recording`）的 labels 语义与告警规则不同——记录规则的 labels 是**新时间序列的附加标签**，用于标识计算结果的维度；
     - 当前原型已隐藏记录规则的 annotations 和 duration 字段，但 labels 区域未做区分说明；
     - 建议在记录规则的 labels 区域增加提示：
       > **记录规则 Labels**：此处的 labels 将附加到记录规则生成的新时间序列上，用于标识计算结果的维度（如 `team`、`datacenter`）。与告警规则的 labels 语义不同，不参与告警路由。

- **依据**：
  - Prometheus 官方最佳实践：`severity` 是告警规则 labels 的**必需推荐项**，用于告警分级（critical/warning/info）；`team` 用于路由到对应接收人；
  - Prometheus 官方文档：annotations 是「人类可读的信息」，典型键为 `summary`、`description`、`runbook_url`，**不参与告警路由判断**；
  - 用户反馈「labels 和标签模板中的 labels 意义不一样」——当前 UI 未做任何语义区分，用户容易误将 target 身份标签填入规则 labels，或反之；
  - 决策 15/31 已明确标签模板（LabelTemplate）是「目标身份标签」的生成契约，与规则 labels 是不同层级的概念，UI 层需要显式告知用户。

- **影响范围**：
  - 原型 `RulesPage.tsx`：labels 和 annotations 区域增加语义说明卡片、标题优化、记录规则特殊提示；
  - 原型 mock `module-01.ts`：无需修改数据模型，纯 UI 展示层变更；
  - Module_01 PRD §5.5（`MonitoringRule` 数据模型说明）：补充 labels/annotations 的语义说明与最佳实践推荐（v2.8）；
  - Module_01 PRD §术语映射：补充规则 labels/annotations 与标签模板 labels 的区分对照（v2.8）；
  - 验收标准 8.1 新增：用户可在规则编辑界面清晰理解 labels 和 annotations 的用途与区别。

- **交互细节**：
  - 语义说明卡片使用 `Alert type="info"` 风格，与当前原型中「规则不绑定网域」的说明卡片风格一致，保持 UI 一致性；
  - 卡片默认展开，不折叠（因信息重要，用户首次接触规则编辑时必须看到）；
  - 卡片文案遵循「提示分区规范」——面向运维工程师，不含「决策 X」「PRD X.X」等实现层引用；
  - 记录规则的 labels 提示使用 `Alert type="warning"` 风格，与告警规则的 info 风格区分，强调语义差异。

#### 决策 36：CI-Exporter 映射页与规则编辑页的新增/编辑表单由 Modal 改为 Drawer

- **问题**：当前 CI-Exporter 映射页（`CiExporterMappingPage.tsx`）和规则编辑页（`RulesPage.tsx`）的新增/编辑操作均使用 `Modal` 弹窗承载表单。随着表单内容增加（CI-Exporter 映射表单含 8 个字段 + 标签模板预览卡片，规则编辑表单含 10+ 字段 + 指标预览 + PromQL 校验结果），Modal 的垂直空间不足，用户需要滚动才能看到完整表单，且 Modal 无法承载侧边辅助信息。

- **结论**：将两个页面的新增/编辑表单容器从 `Modal` 改为 `Drawer`（抽屉），具体方案：

 1. **CI-Exporter 映射页**（`CiExporterMappingPage.tsx`）：
    - 将 `<Modal>` 替换为 `<Drawer>`，宽度 640px，placement 为 `right`；
    - 底部操作栏保留「取消」和「保存」按钮，通过 `extra` 属性放置在 Drawer 底部；
    - 表单内容不变（资源类别、CI 类型、Exporter 模板、默认端口、协议、指标路径、采集间隔、采集超时、标签模板 + 只读预览卡片）；
    - 标题文案：「新增 CI-Exporter 模板映射」/「编辑 CI-Exporter 模板映射」。

 2. **规则编辑页**（`RulesPage.tsx`）：
    - 将 `<Modal>` 替换为 `<Drawer>`，宽度 760px，placement 为 `right`；
    - 底部操作栏保留「取消」「规则模板（P1）」「指标预览」「校验 PromQL」「保存」五个按钮，通过 `extra` 或 `footer` 属性放置在 Drawer 底部；
    - 表单内容不变（规则名称、规则类型、资源类别、CI 类型、Exporter 模板、持续时间、PromQL 表达式、labels、annotations、启用状态 + 指标预览 + 校验结果）；
    - 标题文案：「新增规则」/「编辑规则」。

 3. **交互细节**：
    - Drawer 打开时，背景遮罩不可点击关闭（`maskClosable={false}`），防止误操作丢失未保存数据；
    - Drawer 关闭前，若表单有未保存修改，弹出确认提示「有未保存的修改，确定关闭吗？」；
    - Drawer 宽度适配表单内容：CI-Exporter 映射 640px，规则编辑 760px（与当前 Modal 宽度一致）；
    - 表单内部滚动而非 Drawer 整体滚动，保持底部操作栏始终可见。

- **依据**：
 - 用户反馈「新增模板/新增规则操作希望更便捷」——Modal 在表单内容较多时体验不佳，Drawer 提供更流畅的编辑体验，用户可在不离开列表页上下文的情况下完成编辑；
 - 采集 Job 编辑已使用 Drawer（`ScrapeJobsPage.tsx`），CI-Exporter 映射和规则编辑改为 Drawer 后，Module_01 三个主要编辑表单的交互模式统一，降低用户学习成本；
 - 规则编辑表单包含指标预览和 PromQL 校验结果等动态内容，Drawer 的侧边布局比 Modal 更适合承载这类辅助信息。

- **影响范围**：
 - 原型 `CiExporterMappingPage.tsx`：Modal → Drawer 改造；
 - 原型 `RulesPage.tsx`：Modal → Drawer 改造；
 - 原型 mock `module-01.ts`：无需修改数据模型，纯 UI 容器变更；
 - Module_01 PRD：无需修改数据模型，可在 v2.8 的 UI/UX 说明中补充 Drawer 交互说明；
 - 验收标准 8.1 新增：新增/编辑操作使用 Drawer 承载，底部操作栏始终可见，关闭前有未保存提示。

### 已确认项（2026-08-11 第十轮）

- [x] 采集/拨测间隔等参数增加「继承来源」视觉标记（决策 34）：三层标记体系（继承自映射/已覆盖/待同步），表单字段标签行 inline Tag + 列表列增强 + 详情视图同步。
- [x] 规则编辑 labels/annotations 语义区分（决策 35）：labels 区域增加「与标签模板的区别」说明 + 必填状态说明 + 最佳实践推荐；annotations 区域增加必要性说明 + 必填状态说明 + 模板变量提示；用户词汇表转义区分「告警标签」「告警说明」「目标标签」三层概念；记录规则 labels 特殊提示。
- [x] CI-Exporter 映射页与规则编辑页新增/编辑表单由 Modal 改为 Drawer（决策 36）：统一 Module_01 三个主要编辑表单的交互模式为 Drawer，底部操作栏始终可见，关闭前有未保存提示。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v2.4 落地与验证（用户确认后执行，原型需符合 PRD v2.8）。
- [ ] 决策 36 Drawer 改造的 UI 细节评审（关闭前未保存提示文案、Drawer 内部滚动 vs 整体滚动）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v2.8 待更新，含 Drawer 交互说明）
- `docs/prototypes/module-01/src/pages/CiExporterMappingPage.tsx`（v2.4 待落地：Modal → Drawer）
- `docs/prototypes/module-01/src/pages/RulesPage.tsx`（v2.4 待落地：Modal → Drawer + labels/annotations 语义卡片）
- `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx`（v2.4 待落地：继承来源视觉标记）
- `docs/05-execution-records/module-01/design-decisions.md`（本轮决策 34/35/36）

---

## 补充对齐：2026-08-12（第十一轮 标签配置引导落地）

- **参与 Agent**：prototype-designer
- **触发原因**：用户指出①标签配置引导应落在 CI-Exporter 映射页、采集 Job 页应更凸显引导先关联 CI-Exporter 映射，且原型缺 mock 数据无法触发 v3.1 引导；②资源详情标签来源（CMDB/user/系统）与标签模板映射字段来源口径脱节。经分析确认方向后落地（问题 2 见 Module_07 决策 3.20）。

### 关键决策

#### 决策 37：标签配置引导落在映射层，Job 层做继承提示；补充「无模板」mock 演示数据

- **问题**：
  1. mock 8 条 `CITypeExporterMapping` 全部 `has_label_template=true`，「标签模板创建引导 / 待配置 Badge / 补配」逻辑永远无法触发，用户无法感受"什么条件下去做标签管理"；
  2. ScrapeJobsPage 无标签模板时 Alert「暂未选择标签模板 → 前往创建」**直跳 Module_07 模板管理**，与 PRD 5.4 {v3.1}「引导用户先前往 CI-Exporter 映射页完成模板创建（Job 自动继承）」不符。
- **结论**：
  1. **mock 数据**：`map-006`（nginx）改为 `has_label_template=false` 且 `label_template_id=undefined`（非内置映射，语义合理），新增 `res-mw-004` nginx 资源与引用它的 `job-006 prod-nginx`（`label_template_id` 为空），完整演示「新增映射→创建引导→稍后再说→待配置 Badge→建 Job 引导补配→补配后自动继承」闭环；
  2. **Job 表单主引导**：无模板且对应映射未配置时，Alert 改为主引导「前往 CI-Exporter 映射补配（Job 将自动继承）」（同原型内 `useNavigate('/ci-exporter-mapping')`），「前往标签模板管理」保留为深度管理次级入口；
  3. **Job 列表 / 详情**：新增「标签模板」列（黑 box 场景显示「标签待配置」Tag，点击跳映射页），详情视图同步提示；
  4. **映射页补配入口**：「待配置」Badge 可点击重新触发补配引导，操作列新增「补配标签模板」按钮；
  5. **口径修正**：创建引导文案「将 CMDB 资源字段映射为 Prometheus 标签」→「将平台资源字段（app_name / env / cluster）映射为 Prometheus 标签」（MVP 不从 CMDB 导入，与 Module_07 决策 3.20 统一口径一致）。
- **依据**：PRD 5.1 / 5.4 {v3.1} 标签模板创建引导；决策 15（标签模板继承链：映射默认 → Job 自动继承）；用户反馈「缺少 mock 数据让我感受什么条件下去 module01 做标签管理」。
- **影响范围**：Module_01 PRD 5.4 / 8.1 / Change Log（v3.2）；原型 mock `module-01.ts`、`ScrapeJobsPage.tsx`、`CiExporterMappingPage.tsx`、测试（label_template_id 引用 FK 断言兼容 undefined）。

### 已确认项（2026-08-12 第十一轮）

- [x] mock 新增 nginx 无模板映射 + 引用它的 Job（演示「待配置」链路）。
- [x] Job 表单无模板时主引导「前往 CI-Exporter 映射补配（自动继承）」，模块-07 为次级入口。
- [x] Job 列表/详情「标签待配置」提示；映射页「待配置」Badge 可点击补配 + 操作列补配按钮。
- [x] 创建引导文案口径修正（平台资源字段，非 CMDB）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 原型 v2.6 构建验证与统一入口验证（随本轮一并执行）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.2）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.6）
- `docs/prototypes/module-01/`（v2.6）
- `docs/05-execution-records/module-07/design-decisions.md`（决策 3.20）

---

## 补充对齐：2026-08-13（第十二轮 标签选择两情形引导）

- **参与 Agent**：prototype-designer
- **触发原因**：用户指出 Module_01 ci-exporter 映射的「标签选择」应提示——**CI 新增时去创建新模板、已有 CI 时直接选择模板即可**。现状问题：表单「标签模板」下拉遍历**全量模板、未按 CI 类型过滤**（用户看不出哪些模板适用于当前类型）；「已有 CI 直接选模板」语义无任何文案/交互体现（用户可能重复创建）；创建引导弹窗无「新增 CI 类型」心智。经 AskUserQuestion 确认「严格同类型过滤」后落地。

### 关键决策

#### 决策 38：标签选择两情形引导——新增 CI 创建模板 / 已有 CI 直接选择；选择器严格按 CI 类型过滤

- **问题**：
  1. 表单标签模板 Select 展示 mockLabelTemplates 全量，未按 CI 类型（resource_type）过滤，用户选 mysql 映射时看到 host/application 模板，不知道选哪个；
  2. v3.1 创建引导（has_label_template=false → 立即创建/稍后再说）逻辑上区分了「无模板创建」，但「已有模板直接选择」的文案/交互缺失，且下拉无「默认模板」标记；
  3. 已有 CI 类型（映射已存在且有模板）重新新增映射时，未自动预填默认模板（PRD 5.1 契约「已有模板自动预填默认」未在原型落实）。
- **结论**（用户确认「严格同类型过滤」）：
  1. **选择器按 CI 类型严格过滤**：联动 `resource_type`（细粒度）→ `CI_TYPE_CATEGORY_MAP` 定位资源类别 → 仅展示该类别模板（与「更换=同资源类型其他模板」约束一致）；未选 CI 类型时提示「请先选择 CI 类型」；
  2. **无模板空态 + 内联创建**：选中 CI 类型且该类型无模板时，下拉 notFoundContent 显示「该 CI 类型尚无标签模板，请先创建」+「创建标签模板」按钮（复用创建抽屉，openLabelCreateDrawer 支持从当前表单兜底取 CI 类型）；
  3. **两情形提示文案（表单 extra）**：有模板「该 CI 类型已有 N 个标签模板，直接选择即可（已自动关联默认模板，可更换）」；无模板「该 CI 类型为新类型，尚无标签模板；创建后采集 Job 将自动继承」；
  4. **默认模板 Tag 标记**：下拉选项对默认模板加「默认」Tag；
  5. **创建引导文案强化「新增 CI」语义**：Modal 标题「新增 CI 类型，尚未创建标签模板」+ 正文「已有模板的 CI 类型直接选择模板即可，无需重复创建」；
  6. **已有 CI 自动预填默认模板**：handleCiTypeChange 检测到该 CI 类型映射已有模板时 `form.setFieldsValue({ label_template_id: 默认模板 })`（落实 PRD 5.1 契约），无模板时清空并触发创建引导；
  7. **新建模板即时可见**：mockLabelTemplates 改由 state 承载，创建引导保存的新模板即时进入选择器与列表列。
- **依据**：心智模型差异识别（①用户以为每个 CI 都要创建模板 vs 系统"新增才创建、已有直接引用"；②隐含默认行为：创建映射自动预填默认模板、Job 创建自动继承，需显性化）；JTBD（为 CI 类型配置标签方案：新 CI 建一次、已有 CI 常态选择）；用户确认「严格同类型过滤」。
- **影响范围**：Module_01 PRD 5.1「{v3.3} 标签选择两情形引导」/ 8.1 验收（4 条）/ Change Log（v3.3）；原型 CiExporterMappingPage / mock / README / test（v2.7）。

### 已确认项（2026-08-13 第十二轮）

- [x] 下拉严格同类型过滤（用户确认）。
- [x] 无模板空态 + 内联创建按钮；有模板提示「直接选择即可」；默认模板 Tag。
- [x] 创建引导文案强化「新增 CI 类型」；已有 CI 自动预填默认模板。
- [x] 新建模板 state 承载即时可见。
- [x] 原型落地 + 验证（tsc/lint/build/test）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] 两段评审（用户走查 + 技术核对）随原型验证一并执行。
- [ ] Job 表单（ScrapeJobsPage）标签模板选择器同样严格过滤（v3.1 已要求「仅同资源类型可用模板」，本轮聚焦映射页；Job 页同步评估）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.3）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.7）
- `docs/prototypes/module-01/`（v2.7）

---

## Change Log（完整历史）

> v2.4 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v2.1 及以前的逐版完整变更详情（业务沟通决策记录）。

| 版本   | 日期         | 变更类型 | 变更内容                                                                                                                                                                   | 影响范围                | 产品版本影响            | 状态    |
| ---- | ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------- | ----- |
| v2.1 | 2026-08-05 | 修改   | 5.5 `scope` 字段补充业务场景说明：MVP~v0.3 固定 `central`（中心统一求值，用户无需配置 scope）；`edge`/`both` 为 v0.4+（P2，由 Module_08 支持）预留，核心场景为断网自治告警（边缘 vmalert 本地求值 + 本地通知通道，典型规则为主机存活/进程崩溃/磁盘满/本地服务不可用）；`both` 用于边缘快速响应 + 中心聚合（以标签区分求值域防重复告警）；`central` 用于引用跨网域数据或全局聚合的规则；补充不适合 edge 的规则类型（引用跨网域数据、需长历史窗口的复杂计算、全局业务 SLA） | 数据模型说明 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.0 | 2026-08-04 | 修改   | 参数优先级表述修正：5.1「优先级链：网域覆盖 > 映射默认值 > Job 手动值」改为**两段式**（创建预填来源优先级：网域覆盖 > 映射默认值 > Exporter 内置默认；生效优先级：Job 保存后快照即为最终生效配置，映射/网域覆盖不自动覆盖，仅手动同步刷新）；5.4 新增 `mapping_overrides` 字段（手动覆盖字段名列表，同步映射默认值时跳过，与决策 14 对齐）；原型同步行为改为「同步仅刷新未手动覆盖字段」 | 数据模型、功能范围、原型交互 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v1.9 | 2026-08-04 | 修改   | 数据模型对齐：5.4 `blackbox_targets` 类型由 `[]string`（探测目标字符串）调整为 `[]BlackboxTarget` 对象数组（含 `target` / `protocol` / `url` 字段），新增「BlackboxTarget 结构」说明，支持同一 blackbox Job 内不同协议探测目标；Module_09 生成 `blackbox.yml` 时按 `blackbox_module` 生成对应 module、targets 填充为 `blackbox_targets[].target`（HTTP/HTTPS 优先 `url`）；原型版本同步 v1.9（含多网域模式开关、规则校验/预览动态化、详情只读视图） | 数据模型、验收标准、原型交互 | MVP | 设计中 |
| v1.8 | 2026-08-04 | 修改   | 统一 CI 类型选择交互为「资源类别 → 细粒度 CI 类型」两级级联（5.1 新增说明，覆盖 CI-Exporter 模板映射/采集 Job/规则编辑/指标库筛选四处，避免「MySQL（middleware）」拼接表述）；选中细粒度类型后自动带出映射默认 Exporter 模板（5.5 新增「CI 类型 ↔ Exporter 模板联动」）；指标库 5.3 新增按 CI 类型与 metric_type 筛选说明；UI 展示文案产品化（移除内部「决策 14」代号，功能名统一为「CI-Exporter 模板映射」） | 数据模型、功能范围、UI/UX | MVP / v0.2 / v0.3 / v1.0 | 设计中   |
| v1.7 | 2026-08-04 | 修改   | 决策 13 确认：`CITypeExporterMappingOverride`（网域级覆盖表）落地版本由 v0.3+ 调整为 **v0.2**（跟随多网域能力与按网域配置生成一并交付）；决策 14 确认：原型需完整演示「同步映射默认值」交互（创建时继承标记 + 映射变更提示 + 手动同步刷新） | 数据模型、功能范围、原型交互 | MVP / v0.2 / v0.3 / v1.0 | 设计中   |
| v1.6 | 2026-08-04 | 修改   | 落盘设计决策 13-16：5.1 明确模板层定位（全局一份、不绑定网域）并预留 v0.3+ 网域级覆盖表 `CITypeExporterMappingOverride`（按 `network_domain_id` 覆盖 `default_port`/scheme 等，优先级高于映射默认值，MVP 仅预留不实现）；补充参数继承与同步策略（创建时快照 + 显式覆盖 + 手动「同步映射默认值」，优先级链：网域覆盖 > 映射默认值 > Job 手动值，映射变更不影响存量 Job）；补充标签模板继承链（映射 `label_template_id` 为默认标签模板，创建 Job 自动预填、允许覆盖，LabelTemplate 由 Module_07 维护、本模块只读引用）；新增「CI 类型来源与映射」说明（两套粒度体系：Module_07 粗粒度四大类 + middleware_type，本模块细粒度 CI 类型 host/mysql/redis/kafka/nginx/application_http/snmp，映射表 CI_TYPE_CATEGORY_MAP；v0.4+ CMDB 为唯一权威来源，Module_04 同步后刷新映射，MetricCenter 只维护映射不增删类型）；5.4 补充参数快照与标签模板预填说明；确认决策 12 scope 规则作用域已完备（5.5 含 scope 字段与网域无关性说明，与 Module_09 v1.6 一致） | 数据模型、功能范围 | MVP / v0.3 / v1.0 | 设计中 |
| v1.5 | 2026-08-04 | 修改   | 统一「指标元数据」为「指标库」命名；补充 5.1「模板层 vs 实例层」说明（映射为预设绑定、Job 为实例任务，不重复）；5.5 补充「网域无关性说明」（规则由中心对全网域统一求值、不绑网域，限域通过 `network_domain` 标签过滤）并新增 `scope` 字段（MVP 固定 central，v0.4+ 支持 edge/both）；用户故事调整为「先指标库后规则编辑」；去重 blackbox 指标库验收标准；原型版本升级至 v1.2 | 数据模型、用户故事、功能范围、验收标准 | MVP / v0.3 / v1.0 | 设计中   |
| v1.4 | 2026-08-04 | 修改   | 明确 MVP 指标库最小集：内置范围跟随当前 CMDB CI 类型（host / middleware / application / generic\_target）预置 node-exporter / mysqld-exporter / redis-exporter / kafka-exporter / blackbox-exporter 指标（含数量范围）；P1 保留用户手动导入与更新/覆盖/禁用能力，MVP 阶段内置库只读 | 数据模型、验收标准 | MVP / P1 | 设计中   |
| v1.3 | 2026-08-04 | 修改   | 明确所有 ScrapeJob（standard + blackbox）必须绑定且仅绑定单一 `network_domain_id`，禁止跨网域共享采集/拨测目标；实例选择模式下 `selected_instance_ids` 选中的 Resource 须与 Job 同域并保存时校验；OPS-02 补充创建 Job 必须选择归属网域 | 数据模型、用户故事、功能范围、验收标准 | MVP               | 设计中   |
| v1.2 | 2026-08-04 | 修改   | 将 blackbox 拨测合并为 `ScrapeJob` 的 `job_type=blackbox` 类型，新增 `job_type`、`blackbox_module`、`blackbox_targets` 字段；明确 MVP 内置 blackbox exporter 指标库与 Module\_09 配置触发关系         | 数据模型、功能边界、验收标准      | MVP               | 设计中   |
| v1.1 | 2026-08-03 | 修改   | PRD 状态从 ready 修正为 设计中：尚未完成原型验证                                                                                                                                         | PRD 状态              | 文档自身              | 设计中   |
| v1.1 | 2026-08-02 | 新增   | 完成 Volcengine 风格原型验证，输出独立可点击原型                                                                                                                                         | PRD 状态、UI/UX、原型目录   | 文档自身              | 设计中   |
| v1.0 | 2026-07-31 | 初始   | 模块 PRD 初始版本                                                                                                                                                            | 全部                  | MVP / v0.3 / v1.0 | draft |
