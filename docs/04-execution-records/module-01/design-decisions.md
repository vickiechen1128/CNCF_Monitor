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
  - 技术可行性报告结论（`docs/04-execution-records/module-01/tech-feasibility.md`）；
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
  - Module_01 PRD 5.4 ScrapeJob 数据模型（网域约束统一）、用户故事 OPS-02、3.1 功能表、验收标准；
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
- `docs/04-execution-records/module-01/tech-feasibility.md`
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
