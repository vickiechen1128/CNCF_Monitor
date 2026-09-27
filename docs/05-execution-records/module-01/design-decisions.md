# 设计决策记录：module-01

> **优化说明（2026-09-25）**：原文档 2033 行、约 87 条决策按 30 个「补充对齐」轮次平铺，无索引、编号体系并存三套且不连续、每轮重复 boilerplate。
> 本次优化**保留全部决策编号与原文**，仅做：①顶部加「决策总览索引」；②按主题分组；③去掉每轮重复的「参与 Agent / 触发原因 / 已确认项 / 关联文档」噪音；④压缩「评审记录」为摘要表。
>
> **编号体系说明（重要）**：因 PRD 与其它模块 design-decisions 已引用这些编号，本次**不重编号**。现有三套编号并存：
> - `决策 1–43`：早期逐条决策；
> - `决策 3.49–3.58`：原为「v3.x 第 49–58 条」的误写，实际是独立决策（49–58）；
> - `决策 D1–D29`：批量决策（D1–D23 为表格、D24–D29 为条目），其中 **D28 出现两次**（规则编辑引导 / 草稿批量提交生效），均保留；
> - 零散 `决策 47 / 53 / 54 / 63 / 83`：后期追加决策。
> 跨模块追溯请以原编号为准。

## 决策总览索引

> 按主题分组；编号保留原貌。点主题名可跳转到下方详录。

### T0 ｜ 原型与模块定位

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 1 | 1 | 原型风格与呈现方式 | 2026-08-02 |
| 2 | 2 | 模块原型独立拆分 | 2026-08-02 |
| 3 | 3 | 当前 PRD 范围确认 | 2026-08-02 |

### T1 ｜ 数据模型与概念合并（blackbox / 指标库 / CI 类型）

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 4 | 4 | 拨测配置合并为 ScrapeJob 的 blackbox 类型 | 2026-08-04 |
| 5 | 5 | 指标库是规则编辑的前置依赖，MVP 强依赖内置库 | 2026-08-04 |
| 6 | 6 | 保留「指标元数据」概念，内部实现为「指标库」 | 2026-08-04 |
| 7 | 11 | MVP 指标库最小集范围与用户扩展机制 | 2026-08-04 |
| 8 | 22 | blackbox_targets 数据模型由 `[]string` 调整为 `[]BlackboxTarget` 对象数组 | 2026-08-04 |

### T2 ｜ 网域约束与配置生成职责（Module_09 协同）

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 9 | 7 | Module_01 / Module_07 的七类变更均触发 Module_09 配置重算 | 2026-08-04 |
| 10 | 8 | blackbox exporter 与采集器同域部署 | 2026-08-04 |
| 11 | 9 | 变更检测采用「源数据版本触发 + 联合 checksum 裁决」混合机制 | 2026-08-04 |
| 12 | 10 | 采集 Job 网域约束与配置触发职责边界 | 2026-08-04 |
| 13 | 12 | 规则作用域分层（scope）解决「每域生成 rules.yml」与「规则不绑网域」冲突 | 2026-08-04 |

### T3 ｜ 参数继承与映射层

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 14 | 13 | CI-Exporter 映射（模板层）不绑定网域，v0.3+ 提供网域级覆盖表 | 2026-08-04 |
| 15 | 14 | 参数优先级采用「创建时快照 + 显式覆盖 + 手动同步」模型 | 2026-08-04 |
| 16 | 15 | 标签模板在映射与 Job 中同时出现是「继承链」设计，两者都需要 | 2026-08-04 |
| 17 | 16 | Module_01 与 Module_07 采用两套不同粒度的 CI 类型体系，通过映射关系对齐 | 2026-08-04 |
| 18 | 27 | 参数优先级表述改为「两段式」，消除歧义 | 2026-08-04 |
| 19 | 28 | 同步映射默认值仅刷新未手动覆盖的字段，Job 记录 mapping_overrides | 2026-08-04 |

### T4 ｜ UI·UX 交互与表单

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 20 | 17 | CI 类型选择统一为「资源类别 → 细粒度类型」两级级联 | 2026-08-04 |
| 21 | 18 | 指标库支持按「资源类别 → CI 类型」两级筛选 | 2026-08-04 |
| 22 | 19 | 规则编辑的 CI 类型与 Exporter 模板联动 | 2026-08-04 |
| 23 | 20 | UI 文案产品化与功能命名 | 2026-08-04 |
| 24 | 23 | 指标库数据提升为模块级共享 store，规则校验/预览实时联动 | 2026-08-04 |
| 25 | 24 | Module_01 原型增加单网域/多网域模式开关（Tenant.multi_site_enabled） | 2026-08-04 |
| 26 | 25 | 采集 Job「详情」改为只读视图，与「编辑」抽屉区分 | 2026-08-04 |
| 27 | 26 | 原型/PRD 版本同步 v1.9 | 2026-08-04 |
| 28 | 34 | 采集/拨测间隔等参数增加「继承来源」视觉标记，区分模板默认值与用户自定义值 | 2026-08-11 |
| 29 | 35 | 规则编辑中 labels/annotations 与标签模板的语义区分及 UI 注释 | 2026-08-11 |
| 30 | 36 | CI-Exporter 映射页与规则编辑页的新增/编辑表单由 Modal 改为 Drawer | 2026-08-11 |

### T7 ｜ 采集器管理与网域呈现

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 31 | 21 | CMDB 侧保持细粒度 CI 类型，category 仅为 MetricCenter 内部维度 | 2026-08-04 |
| 32 | 3.49 | M01 顶部网域上下文仅展示已纳管网域 | 2026-08-15 |
| 33 | 3.50 | 告警规则不继承 M01 网域上下文 | 2026-08-15 |
| 34 | 3.51 | host 按 OS 拆分为 host_linux / host_windows 两个细粒度 CI 类型 | 2026-08-15 |
| 35 | 3.52 | 采集实现（ExporterTemplate）支持 OS/下载地址/主页，自研采集器登记纳入 MVP | 2026-08-15 |
| 36 | 3.53 | 预置采集参数 = 官方默认值参考；采集器登记表单按「来源」做字段引导 | 2026-08-15 |
| 37 | 3.54 | 动线统一为「登记即入池」；application_http 走引导卡、不进登记流程 | 2026-08-15 |
| 38 | 3.55 | ScrapeJob 绑网域是技术约束；「克隆到其他网域」暂不实现 | 2026-08-15 |
| 39 | 3.56 | 撤掉 M01 顶部全局网域切换器，网域收敛为采集 Job 页内查询条件（取代决策 3.49） | 2026-08-15 |
| 40 | D1-D16 | 决策表 D1-D16 | 2026-08-16 |
| 41 | D17-D23 | 决策表 D17-D23 | 2026-08-16 |
| 42 | D27 | MVP 单域动线闭环（M01 侧） | 2026-08-17 |
| 43 | D28 | 规则编辑保存引导 + 规则列表「下发状态」列（v0.3 落地，原型 RulesPage 同步实现） | 2026-08-17 |
| 44 | D28 | 「保存草稿 / 提交生效」双按钮提级 MVP（方案 C） | 2026-08-25 |
| 45 | 47 | 采集状态回显前置与安装确认降级 | 2026-08-28 |
| 46 | 63 | 导航分组以生产为准 | 2026-09-05 |
| 47 | 83 | generic_target 端点子类型判别与 k8s monitor_type 枚举 | 2026-09-15 |

### T9 ｜ 术语分层与 PRD 结构改造

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 48 | 29 | 用户故事编码统一为模块命名空间 `Mxx-ROLE-NN` | 2026-08-07 |
| 49 | 30 | Module_01 PRD 按 prototype-designer 骨架规范补齐 | 2026-08-07 |
| 50 | D24 | 术语分层与字段改名 | 2026-08-16 |

### T5 ｜ 标签模板与关联体验

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 51 | 31 | 标签模板关联 UX 补齐（名称+ID 展示、内联只读预览、跨模块跳转；模板 ID 为跨模块唯一 FK） | 2026-08-11 |
| 52 | 32 | CI-Exporter 映射页标签模板展示改「两行卡片 + 预览抽屉 + 表单紧凑卡片」 | 2026-08-11 |
| 53 | 33 | 端口一致性三层解法 + 安装确认登记实际端口（不承担端口编辑） | 2026-08-11 |
| 54 | 37 | 标签配置引导落在映射层，Job 层做继承提示；补充「无模板」mock 演示数据 | 2026-08-12 |
| 55 | 38 | 标签选择两情形引导——新增 CI 创建模板 / 已有 CI 直接选择；选择器严格按 CI 类型过滤 | 2026-08-13 |
| 56 | D25 | 标签模板三环节定位（A+C+D） | 2026-08-16 |
| 57 | D26 | 补配入口收敛（一个动作、两个触发点） | 2026-08-16 |

### T6 ｜ 业务指标库与跨模块对齐

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 58 | 39 | application_http 语义澄清 + v0.4 新 CI 类型引导闭环 | 2026-08-14 |
| 59 | 40 | instance_filter 字段语义——Resource 属性字段为主，label 仅 UI 别名 | 2026-08-14 |
| 60 | 41 | v0.4 business_domain 由 CMDB 业务路径同步 | 2026-08-14 |
| 61 | 42 | 新增业务指标库（BusinessMetric）——业务负责人定义语义、运维落地采集 | 2026-08-14 |
| 62 | 43 | 业务指标动线分离——两角色分工 + 登记动作与语义所有权分离 + 聚合视图版本归属 | 2026-08-14 |

### T8 ｜ 告警规则三轴重构

| 序号 | 编号 | 决策标题 | 日期 |
| --- | --- | --- | --- |
| 63 | 3.58 | M01/M08/M09 告警规则职责按三轴重构 | 2026-08-15 |
| 64 | 3.57 | M01/M08/M09 告警规则职责按三轴重构（M08 退回纯 Alertmanager 收敛/分发域） | 2026-08-15 |

## 决策详录

## T0 ｜ 原型与模块定位

### 决策 1：原型风格与呈现方式

> 📅 日期：2026-08-02 ｜ 轮次：关键决策

## 关键决策


- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-01/ 全部页面

---

### 决策 2：模块原型独立拆分

> 📅 日期：2026-08-02 ｜ 轮次：关键决策

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

---

### 决策 3：当前 PRD 范围确认

> 📅 日期：2026-08-02 ｜ 轮次：关键决策

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md
- 影响范围：原型页面范围

---

## T1 ｜ 数据模型与概念合并（blackbox / 指标库 / CI 类型）

### 决策 4：拨测配置合并为 ScrapeJob 的 blackbox 类型

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

---

### 决策 5：指标库是规则编辑的前置依赖，MVP 强依赖内置库

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

---

### 决策 6：保留「指标元数据」概念，内部实现为「指标库」

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

- **问题**：术语统一为「指标库」还是保留「指标元数据」？
- **结论**：保留「指标元数据」作为管理能力名称（页面/菜单可继续叫「指标元数据」），其底层数据集合称为「指标库 / ExporterMetricLibrary」。
- **依据**：
  - 「指标元数据」更贴近用户对产品管理能力的理解（维护指标名、类型、HELP、UNIT、标签）；
  - 「指标库」更贴近数据模型与规则编辑时的调用语义。
- **影响范围**：
  - PRD 中统一说明：指标元数据管理能力由 `ExporterMetricLibrary` 指标库实现；
  - 页面标题保留「指标元数据」，模型/接口命名使用 `MetricLibrary`。

---

### 决策 11：MVP 指标库最小集范围与用户扩展机制

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

### 决策 22：blackbox_targets 数据模型由 `[]string` 调整为 `[]BlackboxTarget` 对象数组

> 📅 日期：2026-08-04 ｜ 轮次：第四轮

- **问题**：PRD 5.4 定义 `blackbox_targets` 为 `[]string`（探测目标字符串），而原型已实现为对象数组 `{target, protocol, url}`；同一 blackbox Job 内需要区分不同协议的探测目标，字符串数组无法表达。
- **结论**：PRD 对齐原型，`blackbox_targets` 类型调整为 `[]BlackboxTarget`（字段：`target` 地址/IP/host:port、`protocol` http/https/tcp/icmp/dns、`url` 完整 URL 可选）；PRD 5.4 新增「BlackboxTarget 结构」说明；Module_09 生成 `blackbox.yml` 时按 `blackbox_module` 生成对应 module，`static_configs.targets` 填充为 `blackbox_targets[].target`（HTTP/HTTPS 优先 `url`）。
- **依据**：blackbox 探测需按协议区分（module 与 target 一一对应）；原型交互已验证对象数组更贴合实际操作。
- **影响范围**：Module_01 PRD 5.4（v1.9）、验收标准；原型 mock 类型与测试（新增 protocol 合法性断言）。

---

## T2 ｜ 网域约束与配置生成职责（Module_09 协同）

### 决策 7：Module_01 / Module_07 的七类变更均触发 Module_09 配置重算

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

---

### 决策 8：blackbox exporter 与采集器同域部署

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

---

### 决策 9：变更检测采用「源数据版本触发 + 联合 checksum 裁决」混合机制

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

---

### 决策 10：采集 Job 网域约束与配置触发职责边界

> 📅 日期：2026-08-04 ｜ 轮次：补充对齐：2026-08-04

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

---

### 决策 12：规则作用域分层（scope）解决「每域生成 rules.yml」与「规则不绑网域」冲突

> 📅 日期：2026-08-04 ｜ 轮次：第二轮

- **问题**：Module_01 规则不绑定网域、由中心统一求值；但 Module_09 原文「为每个网域生成 rules.yml」。物理隔离网域断网后，边缘站点告警是否失效？两个方案哪个更合理？
- **结论**：采用 **scope 分层方案**（center/edge/both），当前 PRD v1.6 已正确表述，二者不冲突：
  - 规则是**同一份**，由 `scope` 决定**谁求值**：`central` → 中心 Prometheus（跨域聚合/全局告警）；`edge` → 边缘 Agent 本地评估（断网自治）；`both` → 两端都跑（如节点宕机）。
  - Module_09 按 scope 分发 `rules.yml`：中心域含 `central`/`both`；边缘域仅当存在 `edge`/`both` 规则时（v0.4+）随配置包生成。
  - MVP ~ v0.3 阶段 `scope` 固定 `central`，不暴露给用户（Module_01 数据模型已预留 `scope` 字段）。
- **依据**：政务云/金融专网断网自治诉求 + Prometheus/Thanos 社区 scope 求值实践；纯中心求值在隔离网域断网时告警全失效，纯边缘求值无法跑跨域聚合规则。
- **影响范围**：Module_01 5.5（`MonitoringRule` 增加 `scope` 字段）；Module_09 3.3（rules.yml 按作用域生成）、5.2 时序图、验收标准。

---

## T3 ｜ 参数继承与映射层

### 决策 13：CI-Exporter 映射（模板层）不绑定网域，v0.3+ 提供网域级覆盖表

> 📅 日期：2026-08-04 ｜ 轮次：第二轮

- **问题**：模板层是否需要绑定网域？采集 Job（实例层）参数（端口/路径/协议/间隔/超时）可被映射覆盖，参数到底以哪个数据为准？
- **结论**：
  1. **MVP：映射不绑定网域**。映射是「平台级默认预设」，全局一份，绑域会破坏全局复用性；
  2. **v0.3+：新增 `CITypeExporterMappingOverride`（网域级覆盖表）**，支持按 `network_domain_id` 覆盖默认端口/scheme 等参数（如 gov-cloud-a 强制 HTTPS）。覆盖表优先于映射默认值。
- **依据**：模板层职责是「预设默认值」，不同网域环境差异（安全策略/端口）通过覆盖表表达，而非把网域塞入主表。
- **影响范围**：Module_01 5.1 数据模型（新增覆盖表说明，MVP 不实现）。

---

### 决策 14：参数优先级采用「创建时快照 + 显式覆盖 + 手动同步」模型

> 📅 日期：2026-08-04 ｜ 轮次：第二轮

- **问题**：ScrapeJob 参数继承映射默认值并可覆盖，映射后续变更如何同步到已有 Job？
- **结论**：**不自动同步，采用显式同步**：
  - 创建 ScrapeJob 时：加载映射默认值 →（若有网域覆盖则用覆盖值）→ 用户可修改任一字段 → 保存后 Job 持有**快照值**；
  - 映射修改后：已有 Job **不受影响**（避免批量变更导致大面积采集中断），UI 提示「映射默认值已变更」，用户可手动点击「同步映射默认值」重置；
  - 优先级链：**网域覆盖 > 映射默认值 > Job 手动值（保存后即为 Job 自身值）**。
- **依据**：企业级产品保护存量原则——改一个默认端口不应静默改变所有存量 Job；变更必须显式确认。
- **影响范围**：Module_01 5.1/5.4 数据模型说明、原型 ScrapeJobsPage 交互（创建时预填 + 覆盖标记 + 同步提示）。

---

### 决策 15：标签模板在映射与 Job 中同时出现是「继承链」设计，两者都需要

> 📅 日期：2026-08-04 ｜ 轮次：第二轮

- **问题**：CI-Exporter 映射和采集 Job 都有「标签模板」选项，是否冗余？
- **结论**：**不是冗余，是参数继承链的标准设计**：
  - `CITypeExporterMapping.label_template_id` 定义该 CI 类型的**默认**标签模板（如中间件通用模板）；
  - 创建 Job 时自动预填该值，用户可按需覆盖为更精确的模板（如 Redis 自定义模板）；
  - 模板数据由 Module_07 维护，Module_01 只读引用；原型已实现「创建 Job 时预填映射值、允许覆盖」。
- **依据**：与决策 14 的参数继承模型一致；LabelTemplate 作为「标签契约」必须在生成 Job 时稳定可用。
- **影响范围**：Module_01 5.1/5.4 说明文案（MVP 原型已实现，无需改交互）。

---

### 决策 16：Module_01 与 Module_07 采用两套不同粒度的 CI 类型体系，通过映射关系对齐

> 📅 日期：2026-08-04 ｜ 轮次：第二轮

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

### 决策 27：参数优先级表述改为「两段式」，消除歧义

> 📅 日期：2026-08-04 ｜ 轮次：第五轮

- **问题**：PRD 5.1 原文「优先级链：网域覆盖 > 映射默认值 > Job 手动值」将「Job 手动值」排在链尾，字面上会被误读为「模板可覆盖 Job 手动值」，与「Job 快照为最终生效值」的设计矛盾。
- **结论**：改为两段式表述：
  - **创建预填来源优先级**：网域覆盖（v0.2）> 映射默认值 > Exporter 模板内置默认；
  - **生效优先级**：Job 保存后参数快照即为该 Job 最终生效配置（最高），映射/网域覆盖后续变更**不自动覆盖**，仅提示后由用户手动「同步映射默认值」刷新。
- **依据**：用户确认「采集 Job 参数优先级高于模板」；决策 14 保护存量原则。
- **影响范围**：Module_01 PRD 5.1（v2.0）。

---

### 决策 28：同步映射默认值仅刷新未手动覆盖的字段，Job 记录 mapping_overrides

> 📅 日期：2026-08-04 ｜ 轮次：第五轮

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

## T4 ｜ UI·UX 交互与表单

### 决策 17：CI 类型选择统一为「资源类别 → 细粒度类型」两级级联

> 📅 日期：2026-08-04 ｜ 轮次：第三轮

- **问题**：中间件类型（mysql/redis 等）与资源类别是 1:N 关系，前台显示「MySQL（middleware）」把类型与大类拼接，观感奇怪；用户建议先选中间件再选子类型。
- **结论**：Module_01 所有涉及 CI 类型的选择（CI-Exporter 模板映射、采集 Job、规则编辑、指标库筛选）统一改为**「资源类别 → 细粒度 CI 类型」两级级联**：先选资源类别（主机/中间件/应用/通用目标），再选该类别下的细粒度类型；选中后通过 `CITypeExporterMapping` 自动带出默认 Exporter 模板（可覆盖）。
- **依据**：与 Module_07 的 Resource 选择体验一致；消除「MySQL（middleware）」这类拼接表述；两级结构天然表达 middleware → mysql/redis 的 1:N 关系。
- **影响范围**：原型 ScrapeJobsPage / CiExporterMappingPage / RulesPage / MetricLibraryPage 四处的 CI 类型选择；Module_01 PRD 5.1 新增交互说明（v1.8）。

---

### 决策 18：指标库支持按「资源类别 → CI 类型」两级筛选

> 📅 日期：2026-08-04 ｜ 轮次：第三轮

- **问题**：指标库当前仅按 Exporter 分组与 metric_type 筛选，无法按 CI 类型定位某类资源可用的监控指标。
- **结论**：指标库筛选区新增「资源类别 → CI 类型」两级级联下拉；选中 CI 类型后，经 `CITypeExporterMapping` 定位该类型可用的 Exporter 模板集合，过滤其指标，与 metric_type 筛选叠加。
- **影响范围**：原型 MetricLibraryPage；Module_01 PRD 5.3 新增筛选说明（v1.8）。

---

### 决策 19：规则编辑的 CI 类型与 Exporter 模板联动

> 📅 日期：2026-08-04 ｜ 轮次：第三轮

- **问题**：规则编辑中「资源类型」和「关联 Exporter 模板」是两个独立下拉，无联动。
- **结论**：规则编辑同样采用两级级联选择资源类型；选中细粒度 CI 类型后 `exporter_template_id` 自动带出该类型映射的默认 Exporter（可覆盖），并据此过滤指标预览与 PromQL 校验范围。
- **影响范围**：原型 RulesPage；Module_01 PRD 5.5 新增「CI 类型 ↔ Exporter 模板联动」说明（v1.8）。

---

### 决策 20：UI 文案产品化与功能命名

> 📅 日期：2026-08-04 ｜ 轮次：第三轮

- **问题**：原型 UI 中出现内部代号「决策 14」（参数同步列名）；「CI-Exporter 映射」功能名缺少「模板」二字，弱化模板层定位。
- **结论**：
  1. UI 展示文案**移除内部决策编号**：列表列名「参数同步（决策 14）」→「参数同步」，仅代码注释/测试名保留决策编号；
  2. 功能名统一为 **「CI-Exporter 模板映射」**（菜单、页面标题、Modal 标题），强化「模板层预设」定位，与采集 Job（实例层）区分。
- **影响范围**：原型 MainLayout / CiExporterMappingPage / ScrapeJobsPage；Module_01 PRD 3.1/5.1 功能表述（v1.8）。

---

### 决策 23：指标库数据提升为模块级共享 store，规则校验/预览实时联动

> 📅 日期：2026-08-04 ｜ 轮次：第四轮

- **问题**：RulesPage 的 PromQL 校验与指标预览基于静态 `mockMetricLibrary`，用户在指标库页新增/禁用指标后，规则编辑无法实时感知，违背「先指标库后 PromQL」的产品语义。
- **结论**：mock 新增模块级共享容器 `metricLibraryStore`（刷新后随 mock 重置）；MetricLibraryPage 的增删改（`syncStore`）同步写入该容器；RulesPage 的校验与预览实时读取该容器。跨页面联动演示「指标库存在性校验」闭环。
- **依据**：决策 5（规则编辑保存时 expr 引用的指标必须存在于指标库）；原型需演示动态依赖关系，避免开发输入失真。
- **影响范围**：原型 mock（`metricLibraryStore`）、MetricLibraryPage、RulesPage。

---

### 决策 24：Module_01 原型增加单网域/多网域模式开关（Tenant.multi_site_enabled）

> 📅 日期：2026-08-04 ｜ 轮次：第四轮

- **问题**：web-development 规范要求 mock 包含 `Tenant.multi_site_enabled` 租户级开关演示单/多网域模式差异；Module_09 已实现，Module_01 缺失。
- **结论**：mock 新增 `currentTenant`（含 `multi_site_enabled`，默认 true）；MainLayout Header 增加 Switch 开关（切网域模式），切换时派发 `tenant-mode-change` 全局事件；单网域模式下采集/拨测 Job 网域下拉禁用且仅 `default`，若表单已选边缘域则强制切回 `default` 并清空已选实例。
- **依据**：web-development 规范；Module_09 原型实现方式（`currentTenant.multi_site_enabled` 模块级可变 + Header Switch）。
- **影响范围**：原型 mock、MainLayout、ScrapeJobsPage。

---

### 决策 25：采集 Job「详情」改为只读视图，与「编辑」抽屉区分

> 📅 日期：2026-08-04 ｜ 轮次：第四轮

- **问题**：列表「详情」按钮与「编辑」行为相同（都打开编辑抽屉），交互语义重复。
- **结论**：详情改为只读 Modal（Descriptions 展示 Job 全字段 + 已选实例/拨测目标列表 + 安装状态徽标），编辑抽屉仅用于编辑。
- **依据**：UI/UX 一致性（决策 20 文案产品化的延续）。
- **影响范围**：原型 ScrapeJobsPage。

---

### 决策 26：原型/PRD 版本同步 v1.9

> 📅 日期：2026-08-04 ｜ 轮次：第四轮

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

### 决策 34：采集/拨测间隔等参数增加「继承来源」视觉标记，区分模板默认值与用户自定义值

> 📅 日期：2026-08-11 ｜ 轮次：第十轮 UI/UX 易用性

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

---

### 决策 35：规则编辑中 labels/annotations 与标签模板的语义区分及 UI 注释

> 📅 日期：2026-08-11 ｜ 轮次：第十轮 UI/UX 易用性

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

---

### 决策 36：CI-Exporter 映射页与规则编辑页的新增/编辑表单由 Modal 改为 Drawer

> 📅 日期：2026-08-11 ｜ 轮次：第十轮 UI/UX 易用性

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

## T7 ｜ 采集器管理与网域呈现

### 决策 21：CMDB 侧保持细粒度 CI 类型，category 仅为 MetricCenter 内部维度

> 📅 日期：2026-08-04 ｜ 轮次：第三轮

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

### 决策 3.49：M01 顶部网域上下文仅展示已纳管网域

> 📅 日期：2026-08-15 ｜ 轮次：M01 网域上下文与已纳管网域

- **问题**：M01 是否应在顶部增加全局网域上下文栏？展示哪些网域？
- **结论**：
  1. M01 采用**强网域上下文**模式：顶部上下文栏展示当前用户有权限且**已完成 M09 监控纳管**的网域。
  2. 单网域租户仅展示 `default`，不可切换。
  3. 多网域租户若存在未纳管网域，应在下拉中灰显或隐藏，并提示「如需监控，请先到网域管理完成纳管」。
  4. 创建 ScrapeJob 时，`network_domain_id` 选项同样仅展示已纳管网域；保存时校验所选 Resource 与 Job 同属该域（既有约束保留）。
- **依据**：ScrapeJob 必须绑定单一网域；未纳管网域没有采集通道，绑定后无法下发配置。
- **影响范围**：M01 PRD 3.1 / 5.4；ScrapeJobsPage 顶部上下文栏与创建表单；原型 v3.0+ 同步。

---

### 决策 3.50：告警规则不继承 M01 网域上下文

> 📅 日期：2026-08-15 ｜ 轮次：M01 网域上下文与已纳管网域

- **问题**：告警规则编辑页是否也要随顶部网域上下文过滤？
- **结论**：**不继承**。`MonitoringRule` 由中心统一求值、不绑定网域；规则列表默认展示全部规则，仅提供 `network_domain` 标签筛选器；编辑页面提示用户「如需限定网域，请在 PromQL 中使用 `network_domain` 标签过滤」。
- **依据**：M01 PRD 5.5「网域无关性说明」已明确规则不限域。
- **影响范围**：M01 PRD 5.5；RulesPage UI 提示文案。

### 已确认项（2026-08-15）

- [x] M01 顶部网域上下文仅展示已纳管网域（用户确认）。
- [x] 告警规则不限域，仅提供标签筛选器（用户确认）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/05-execution-records/module-09/design-decisions.md`（决策 25/26/27/28，跨模块主记录）


---

### 决策 3.51：host 按 OS 拆分为 host_linux / host_windows 两个细粒度 CI 类型

> 📅 日期：2026-08-15 ｜ 轮次：采集器管理 OS 平台细分与自研采集器登记 MVP

- **问题**：开源采集器（如 node_exporter vs windows_exporter）在不同操作系统下的项目、指标集、下载地址均不同，是否应在 CI 类型层面拆分？
- **结论**：采用方案 A，将 Module_01 的细粒度 CI 类型 `host` 拆分为 `host_linux` 与 `host_windows`。Module_07 的 `Resource` 仍为 `resource_type=host`，并通过 `os_type` 字段区分操作系统；Module_01 的 `CI_TYPE_CATEGORY_MAP` 增加 `os_type` 条件映射：
  - host + os_type=Linux/Unix → `host_linux`
  - host + os_type=Windows → `host_windows`
- **依据**：
  - Module_07 主机资源已存在 `os_type`（linux / windows）字段；
  - Linux 的 node_exporter 与 Windows 的 windows_exporter 是两个不同项目，指标前缀（`node_*` vs `windows_*`）与语义完全不同，若合并到同一 `host` CI 类型，指标库按 `source_exporter` 区分会让规则提示与指标浏览变脏；
  - CI 类型是「用户视角的我要监控什么」，OS 平台差异是资源固有属性，应作为类型边界。
- **影响范围**：
  - Module_01 PRD 5.1 决策 16 映射表增加 `os_type` 条件列；
  - 术语映射 `resource_type` 列举由 `host` 改为 `host_linux / host_windows`；
  - 8.1 验收、5.3 MVP 指标库最小集由 `host` 改为 `host_linux`（node-exporter） / `host_windows`（windows-exporter）；
  - 原型与后端枚举同步增加 `host_linux`、`host_windows`；MVP 内置采集器预置数据需分别维护。

---

### 决策 3.52：采集实现（ExporterTemplate）支持 OS/下载地址/主页，自研采集器登记纳入 MVP

> 📅 日期：2026-08-15 ｜ 轮次：采集器管理 OS 平台细分与自研采集器登记 MVP

- **问题**：用户希望开源采集器能提供名称、搜索/下载地址、安装指南，并按 Linux/Windows 区分；自研采集器希望开发后在平台登记留痕。
- **结论**：
  1. 5.2 `ExporterTemplate` 增加结构化字段：`os`（适用操作系统，如 linux / windows / any）、`arch`（适用架构，如 amd64 / arm64 / any，可空）、`download_url`（下载地址/离线包路径）、`homepage`（官方文档/搜索入口地址），这些字段归属采集实现，不挂 CI 类型。
  2. 「采集器管理」Tab 对每种 CI 类型展示匹配的采集实现（按 `supported_resource_types` + `os` 过滤），并提供「如何获取」引导文案 + 下载/主页链接。
  3. 用户自定义采集实现（含自研采集器）登记从 P2 提前到 **MVP**，通过 `is_builtin=false` 的 ExporterTemplate 创建表单实现；字段与内置采集器一致，自研采集器通常填写内部制品库地址或内网下载链接。
  4. 自研独立 exporter 进程纳入 5.6 `ExporterInstallationConfirmation` 安装确认范围；业务应用内嵌埋点（`application_http`）无需安装确认，走 5.9 业务指标库登记。
- **依据**：
  - 采集器管理的本质是「类型级采集器指引」，安装指南必须明确、可下载地址结构化；
  - 自研采集器需要登记留痕，否则后续运维无法识别实例上运行的是哪个采集器；
  - 应用内嵌埋点没有独立进程，与独立 exporter 的安装确认维度不同。
- **影响范围**：
  - Module_01 PRD 5.2 数据模型增加 `os / arch / download_url / homepage` 字段；
  - 5.2 删除「用户自定义采集实现的登记属可选能力（P2）」表述，改为 MVP 支持；
  - 5.1 默认采集配置描述补充：平台预置按 OS 区分的采集器数据，用户可登记自研采集器；
  - 5.6 安装确认范围从「仅标准 Exporter」改为「独立进程型采集实现（含内置与自研）」；
  - 8.1 验收增加：MVP 支持按 OS 预置采集器下载地址与安装指南、支持用户登记自研采集器；
  - 原型与 mock 数据需同步增加 `host_linux` / `host_windows` 的预置采集器与下载地址。

### 已确认项（2026-08-15）

- [x] `host` 拆分为 `host_linux` / `host_windows`（用户确认方案 A）。
- [x] 自研采集器登记纳入 MVP（用户确认）。
- [x] 新增 `os / arch / download_url / homepage` 字段用于开源采集器指引。

### 仍待确认项

- 无（本阶段设计决策已全部书面化）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`


---

### 决策 3.53：预置采集参数 = 官方默认值参考；采集器登记表单按「来源」做字段引导

> 📅 日期：2026-08-15 ｜ 轮次：采集器动线统一与 M01 网域呈现收敛

- **问题**：开源/第三方采集器的端口、路径、协议、采集参数是用户装完后人工回填，还是平台预置？自研采集器无官方默认值，如何引导填写？
- **结论**：
  1. 保留三层结构（`ExporterTemplate` 预置默认值 → `CITypeExporterMapping` 可调预设 → `ScrapeJob` 快照 + 覆盖），并在 PRD 显性化「**预置参数 = 官方默认值参考，不是强制值**」——用户装采集器时未改配置则直接用默认值，改了则在映射 / Job 层覆盖；
  2. `ExporterTemplate` 新增 `source` 字段（`official` 开源官方 / `third_party` 第三方 / `internal` 自研）；登记 / 编辑表单按 `source` 引导：来源为自研时 `default_port` / `metrics_path` / `scheme` 必填并提示「按实际部署填写」，`download_url` 提示填内部制品库地址，名称建议 `xxx-exporter` 命名规范；
  3. 「采集器管理」Tab 列表支持按 CI 类型 + 来源筛选。
- **依据**：官方采集器参数有权威来源可预置；自研采集器无权威默认值，必填 + 提示比留空更不易出错。
- **影响范围**：PRD 5.2 字段表与表单引导规则、5.1 Tab 筛选说明、8.1 / 8.2 验收、术语映射。

---

### 决策 3.54：动线统一为「登记即入池」；application_http 走引导卡、不进登记流程

> 📅 日期：2026-08-15 ｜ 轮次：采集器动线统一与 M01 网域呈现收敛

- **问题**：开源采集器与自研采集器两条动线割裂，是否应砍掉采集器管理中的参数默认值、全部放到 Job 配置时填写？
- **结论**：
  1. **不砍默认值信息**——砍掉后用户装完采集器将失去默认端口 / 路径参考；
  2. 动线统一为「**登记即入池**」：自研采集器在采集器管理登记（`is_builtin=false`）后，与官方采集器完全同等待遇——同样被映射引用、创建 Job 时同样预填参数、同样走 5.6 安装确认；割裂不是两条流程，而是"一条流程 + 一个前置登记动作"；
  3. `application_http` 不是采集器、无安装动作：采集器管理 Tab 对其展示**引导卡**（业务应用自带 `/metrics`，无需安装；指标语义到业务指标库登记；Job 端口 / 路径按实际 endpoint 手填），**不进入登记表单流程**，避免每个微服务被登记成一个"采集器"。
- **依据**：采集器管理的核心价值是类型级知识库（该装什么、默认参数、去哪下载），砍掉则价值归零。
- **影响范围**：PRD 5.1（动线说明、application_http 引导卡）、5.2、8.1 验收。

---

### 决策 3.55：ScrapeJob 绑网域是技术约束；「克隆到其他网域」暂不实现

> 📅 日期：2026-08-15 ｜ 轮次：采集器动线统一与 M01 网域呈现收敛

- **问题**：ScrapeJob 必须绑单一网域，是技术限制还是管理限制？共性 CI 类型跨网域重复配置的痛点如何解？
- **结论**：
  1. **技术约束**：隔离网域内目标只能被本网域边缘采集器 / Prometheus 抓取（网络可达性）；Module_09 按网域生成并下发配置、断网自治——Job 不绑网域则配置无处下发；
  2. PRD 5.4 显性补充该约束说明；
  3. 共性配置靠既有机制收敛：映射层全局预设（决策 13）+ v0.2 网域覆盖表（决策 13 预留）；
  4. 「克隆到其他网域」（一键复制 Job、重新勾实例）**本轮不实现**（用户确认：非功能性需求先不加，后续按实际痛点评估）。
- **依据**：放开网域维度等于隐藏技术约束，会在配置生成层爆开；跨网域逻辑 Job + M09 展开方案不推荐（实例选择跨域拆分、安装确认分域、断网部分生效状态无法表达）。
- **影响范围**：PRD 5.4 网域约束说明。

---

### 决策 3.56：撤掉 M01 顶部全局网域切换器，网域收敛为采集 Job 页内查询条件（取代决策 3.49）

> 📅 日期：2026-08-15 ｜ 轮次：采集器动线统一与 M01 网域呈现收敛

- **问题**：M01 顶部全局网域上下文切换器是否过度设计？
- **结论**：**撤掉**。M01 内仅 ScrapeJob 绑网域（决策 3.50 已明确规则不继承）；默认采集配置、技术指标库、业务指标库均网域无关——全局切换器会让其他页面被迫响应与自己无关的状态。改为：
  1. 「采集 Job」页列表加网域查询条件（下拉，选项 = 已纳管网域 `is_monitored=true`）；
  2. Job 表单 `network_domain_id` 必填（维持现状），实例候选按表单所选网域收敛（维持现状）；
  3. M01 不提供顶部全局网域切换器；全局网域概念由 M06 / M09 承载；
  4. 将来 M01 出现第二个网域感知功能（如 v0.4 `scope=edge` 边缘规则）时再评估是否恢复。
- **依据**：单一消费者不应驱动全局 UI 状态；决策 3.49 由本决策取代。
- **影响范围**：PRD 5.4 网域约束段 / 8.1 验收（v3.9 切换器条目替换为页内查询条件）；原型移除 M01 顶部切换器。

### 已确认项（2026-08-15）

- [x] 预置采集参数 = 官方默认值参考，语义显性化；登记表单按来源引导（决策 3.53）。
- [x] 动线统一「登记即入池」；application_http 引导卡、不进登记流程（决策 3.54）。
- [x] ScrapeJob 绑网域 = 技术约束；「克隆到其他网域」暂不实现（决策 3.55）。
- [x] 撤掉 M01 顶部网域切换器，改为采集 Job 页内查询条件，取代决策 3.49（决策 3.56）。

### 仍待确认项

- 无。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`


---

### 决策 D1-D16：决策表 D1-D16

> 📅 日期：2026-08-16 ｜ 轮次：第二十四轮：列表列优化 + 动线主次分离 + 空态依赖引导，决策 D1-D16

| 编号 | 决策 | 结论 | 影响版本 | PRD 落点 |
|---|---|---|---|---|
| D1 | 依赖未就绪空态统一规范 | 网域 / 标签模板 / 采集器选择器遇依赖缺失时统一「说明文案 + 内联跳转/创建动作」，保存时 `bad_request` 仅兜底 | MVP | 3.1 / 5.4 / 6.2.2 |
| D2 | 默认采集器可空但需显式模式 | `exporter_template_id` 可空合理，UI 用「使用默认采集器（推荐）/ 手填采集参数」显式二选一，不做"下拉留空" | MVP | 5.4 / 8.1 |
| D3 | CI 类型拆分轴 = 指标/采集器 schema 差异 | 麒麟/统信/Ubuntu、arm64/x86 不拆 CI 类型；达梦/SQL Server/MySQL 因采集器与指标集不同可拆 | MVP | 5.1 |
| D4 | 架构/发行版差异下沉采集器层 | 差异由 `ExporterTemplate.os/arch/install_guide/download_url` 承载，不上升 CI 类型 | MVP | 5.2 |
| D5 | 采集器支持按 os/arch 多行或结构化下载地址 | 单一 `download_url` 无法表达多架构离线包；MVP 方式①（按 os/arch 多行登记），方式②（结构化数组）v0.2+ 预留 | MVP | 5.2 |
| D6 | `instance = ip:port` 仅作抓取身份，非业务关联身份 | Prometheus 原生默认行为，端口/漂移不稳定；业务关联走 `app`/`biz`/稳定资源身份 | MVP | 5.4 / 术语映射 |
| D7 | 标签模板必须包含稳定资源身份标签 | 默认标签模板至少映射一个网域内稳定资源身份（`resource_id`/`hostname`），供拓扑穿透/跨网域关联 | MVP | 5.1 / 8.1 / Module_07 约束 |
| D8 | 资源层级/拓扑由 CMDB/APM 承载，监控只携带 join key | 不在 metric 标签层硬编码拓扑（避免基数爆炸）；监控经 `app`/`biz`/resource identity 关联 CMDB | v0.2+ | 模块边界 / 本记录 |
| D9 | MVP 不实现实例级端口覆盖 | 同 CI 类型多端口 MVP 非高频；端口变更走 v0.2 网域级覆盖 + 实例级覆盖 | MVP/v0.2 | 5.1 / 5.4 |
| D10 | 网域级覆盖表驱动场景增加"安全/高危端口" | 不同网域因安全策略要求不同端口（避开高危端口）是 v0.2 `CITypeExporterMappingOverride` 关键驱动 | v0.2 | 5.1 |
| D11 | 列表状态列"异常驱动"展示 | 正常态收为 `-`/低饱和标签，异常/可行动态才醒目；详情收进抽屉/Tooltip | MVP | 3.1 / 8.1 |
| D12 | 采集器管理按钮动线主次分离 | 主按钮「新增默认采集配置」；「登记采集器」降级次级按钮 + 选择器空态内联；页面编号动线说明（①登记→②配置默认→③创建 Job 选实例确认安装） | MVP | 3.1 / 5.1 |
| D13 | 采集器登记入口 inline 在选择器空态 | 默认采集配置/Job 表单采集器下拉为空时显示「未找到？前往登记采集器」内联动作 | MVP | 5.1 / 5.4 / 8.1 |
| D14 | Job 列表与默认采集配置列表列字段优化 | 去重复 Tag（Job 名称 blackbox Tag、采集器来源/类型双列）、合并同义列、端口/路径/协议合并 compact endpoint 文本、操作列图标化 | MVP | 8.1 |
| D15 | 默认采集配置列表补齐标签模板列 | 原型缺 PRD v3.1 已验收列；按决策 15 两行卡片补齐（名称 + 默认/自定义标记 / 类别·模板ID，查看/更换/补配） | MVP | 8.1 / 原型 |
| D16 | `手动选择` = `instance_selection_mode=manual` 实例手动勾选 | 非"手动选择采集器"；术语映射与 UI 文案明确（与 D2 采集器二选一区分） | MVP | 术语映射 / 5.4 |

### 决策要点补充

- **D3/D4 边界一句话**：隔离边界建实体（CI 类型），位置/平台维度建属性（os/arch），叫法建部署/制品字典——与 M06 网域 `zone_type` 的「隔离边界建实体、位置维度建属性、叫法建字典」原则同构。
- **D8 落点**：本轮不新增 metric 标签；仅记录边界——资源层级/拓扑由 CMDB/APM 承载，监控平台标签层只带 join key（`app`/`biz`/稳定资源身份），v0.2+ 在跨模块文档（M07/M04）细化。
- **D9/D10 端口分层**：类型级 `default_port`（MVP）→ 网域级 `CITypeExporterMappingOverride`（v0.2，含安全/高危端口驱动）→ 实例级端口覆盖（v0.2+ 评估）；Job 表单不提供端口字段（D6）。

### 已确认项（2026-08-16）

- [x] D1-D16 全部确认，PRD v3.14 按 2.1-2.7 落位（3.1 / 5.1 / 5.2 / 5.4 / 6.2.2 / 8.1 / 术语映射）。
- [x] 原型落地：Job 列表列收敛、采集器管理列表合并重复列 + 补齐标签模板列、按钮主次分离 + 空态内联登记、Job 表单采集器显式二选一（D2）、网域/标签模板选择器空态引导（D1/D13）、手动选择文案（D16）。
- [x] 原型「默认采集配置」表补「标签模板」列，与 PRD v3.1 验收对齐（D15）。
- [x] 设计决策记录沉淀 D1-D16（本小节）。

### 仍待确认项

- [ ] D8（资源层级/拓扑由 CMDB/APM 承载）需在 Module_07 / Module_04 的跨模块文档中同步细化（v0.2+ 落地时）。
- [ ] D5 方式②（`download_url` 结构化数组）在 v0.2+ 引入时需同步字段类型与后端契约。
- [ ] Module_07 LabelTemplate 创建流程需增加「稳定资源身份标签」提示（D7 约束落地）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.14）
- `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx`（原型同步）
- `docs/05-execution-records/module-01/design-decisions.md`（本记录）


---

### 决策 D17-D23：决策表 D17-D23

> 📅 日期：2026-08-16 ｜ 轮次：第二十五轮：CMDB 分类轴两级映射推导 + 标签模板锚点粒度 + 五大类拆分 + 原型检查问题，决策 D17-D23

### 分析过程：CMDB 分类轴与监控采集轴的两级映射推导（不统一分类法）

用户确认：CMDB 不会按监控采集实现定义 CI 类型，统一靠映射推导，整条链两跳——

```
CMDB bk_obj_id（细粒度，资源本质轴：mysql / redis / 达梦）
  → M04「CMDB CI 类型映射表」归类 → M07 粗粒度类别 + middleware_type
  → M01 CI_TYPE_CATEGORY_MAP 推导 → M01 细粒度 CI 类型（mysql / host_linux ...）
```

- CMDB 侧**永远不需要知道"采集实现"概念**（M07 5.1 已写明：CMDB 不存在父子分类表达，也无需引入 category）；
- M01 细粒度 CI 类型是**派生的策略维度**，只存在于监控平台内部，**不回写 CMDB**；
- 新增产品线（如达梦）时动作是**配两行映射**（M04 映射表 + M01 CI_TYPE_CATEGORY_MAP），不是改 CMDB 模型定义；M04「待分类队列」承接"CMDB 出现映射表里没有的新类型"的缓冲。

### 检查发现：标签模板锚点粒度三处不一致

| 位置 | 锚点粒度 |
|---|---|
| M07 PRD 5.10 | `LabelTemplate.resource_type` = **粗粒度类别**（且 M07 明确"标签模板归属"是四大类的用途之一） |
| M01 PRD v3.3 | 选择器"按 CI 类型严格过滤（仅同类型模板）"——**细粒度** |
| M01 原型 | Job 表单选择器完全不过滤（列出全部模板）；采集器管理 Tab「更换」按粗粒度类别过滤 |

若严格执行"按细粒度 CI 类型过滤"，host_linux / host_windows 需各建一套内容几乎相同的模板——而标签模板内容（字段 → label 映射）由资源字段 schema 决定，是**类别级**的（M07 5.12 A 字段来源表按 主机/中间件/应用服务 组织）。→ 见决策 D18。

### 检查发现：原型 P1-P5（按严重度）

- **P1**：「采集器管理」Tab 列表只展示映射（`filteredPresets`），登记入池的采集器本身不可见（未引用时无法在"采集器管理"页面看到）→ D22。
- **P2**：`install_guide` 双写冗余（PRD 5.1 映射表有该字段、5.2 又明确归属采集实现；原型预设抽屉可编辑、列表读映射行）→ D20。
- **P3**：blackbox Job 硬塞 `application_http` + `et-blackbox`（表单切换时强制写入），与列表/PRD 语义不一致，会污染 application_http 覆盖率统计 → D21。
- **P4**：Job 表单标签模板选择器完全不过滤，与 PRD v3.3 不符——修复取决于 D18 锚点粒度决策，两者一起改。
- **P5**：跨模块跳转硬编码相对路径（原型演示够用），实现期应走统一导航配置 → D23。


| 编号 | 决策 | 内容 | 状态 |
|---|---|---|---|
| D17 | 空态补救必须携带发起上下文 | 从「新增默认采集配置」/「采集 Job」表单的采集器空态发起登记时，登记表单预填 `supported_resource_types` = 当前 CI 类型，保存成功后自动回选到来源表单的采集器字段；否则登记完仍可能因过滤不可见，空态补救失效 | 已确认（原型已实现） |
| D18 | 标签模板锚点粒度 = 粗粒度资源类别 | 标签模板内容（字段 → label 映射）由资源字段 schema 决定，是类别级的；M07 `LabelTemplate.resource_type` 保持粗粒度类别（M07 模型不动），M01 映射按 CI 类型指定该类别下的默认模板，选择器按「所属类别」过滤而非"按 CI 类型严格过滤"。避免 host_linux / host_windows 重复建模板。**需修订 M01 PRD v3.3 既有措辞** | **建议，待用户确认** |
| D19 | 资源分类四大类改五大类，数据库独立成类 | `host` / `database` / `middleware` / `application` / `generic_target` 五大类；归类规则：以数据存储/查询为主语义、按产品线分采集器 → database（mysql、postgresql、oracle、达梦 dm8、sqlserver、mongodb、**redis**）；消息/网关/协调/搜索 → middleware（kafka、nginx、zookeeper、**elasticsearch**）。M07 `middleware_type` 拆为 `database_type` + `middleware_type` 两个细粒度字段；M01 `CI_TYPE_CATEGORY_MAP` 相应调整 | redis→database 已确认；ES 留 middleware 为**建议默认值** |
| D20 | `install_guide` 单一持有方 = 采集实现 | `install_guide` 只存于 `ExporterTemplate`，映射行（`CITypeExporterMapping`）删除该字段、只读透传展示；类型级补充说明另用纯备注字段，避免双写不一致 | 已确认 |
| D21 | blackbox Job 不占用 application_http / 采集器语义 | `job_type=blackbox` 时 `resource_type` / `exporter_template_id` 留空，不伪装为 `application_http` + `et-blackbox`；拨测语义由 `job_type` + `blackbox_module` + `blackbox_targets` 完整承载 | 已确认 |
| D22 | 采集器管理列表 = 映射 + 池全貌 | 「采集器管理」列表需展示已登记但未被任何映射引用的采集器（标记「未被引用」状态），否则"登记即入池"对用户不可见 | 已确认 |
| D23 | 跨模块跳转由统一导航配置承载 | 原型可暂用相对路径，PRD 明确实现期不写死路径 | 已确认 |

### 决策要点补充

- **D19 拆分理由**：数据库按产品线重度扩张（达梦 / Oracle / SQL Server / PG / MongoDB），与消息/网关类中间件（kafka / nginx）的资源性质、采集器生态、使用人心智不同，混在"中间件"里会越来越别扭；趁 MVP 无存量数据，改枚举成本最低。
- **D19 涟漪影响清单**（改之前要有数）：M07 资源类型枚举与字段表、M01 `CI_TYPE_CATEGORY_MAP` / 两级级联 / 指标库最小集表、M04 CMDB CI 类型映射表、Excel 导入模板列、标签模板类别归属、业务视图"微服务/中间件/主机"聚合措辞、全局架构文档与术语映射、所有原型 mocks。**对 CMDB 兼容性无影响**——bk_obj_id 不变，只是映射表多一个目标类别值。
- **D18 与 P4 的关系**：Job 表单标签模板选择器修复（加过滤）与 D18 锚点粒度决策一起做——若 D18 通过，选择器按「Job 所属资源类别」过滤 + 默认模板标记到 CI 类型。

### 已确认项（2026-08-16）

- [x] D17：空态登记携带发起上下文（原型已实现：openTemplateRegister(ctx) 预填 supported_resource_types + 保存后回选）。
- [x] **D18：用户给出具体修改意见并指示执行**——M01 PRD v3.3「按 CI 类型严格过滤」修订为「按所属资源类别过滤，默认模板标记到 CI 类型」，M07 `LabelTemplate.resource_type` 保持粗粒度类别不动；已按 v3.15 / v2.13 落地。
- [x] **D19：五大类拆分落地**——redis → database（用户确认）；elasticsearch 按建议默认值留 middleware（用户修改意见的归类规则 middleware 含 elasticsearch）；M01 v3.15 / M07 v2.13 / M04 v1.3 三份 PRD 已同步。
- [x] D20 / D21 / D22 / D23：决策确认，PRD 修改已执行（M01 v3.15：install_guide 只读透传 / blackbox 留空 / 池全貌 / 跨模块跳转说明）。

### 仍待确认项

- [ ] **原型 mocks 同步（D19 涟漪，待执行）**：module-01 / module-07 / module-04 等原型 mocks 的 CI 类型、类别枚举、资源 mock 需从四大类调整为五大类（database 独立 + database_type / middleware_type 拆分）——PRD 契约已改，原型待同步。
- [ ] D18 原型侧：Job 表单标签模板选择器改为按「所属资源类别」过滤 + 默认模板标记到 CI 类型（与 PRD v3.15 措辞一致后原型需同步）。
- [ ] D20 原型侧：预设抽屉 install_guide 编辑入口收敛为只读透传（含类型级 install_notes 备注字段评估）。
- [ ] D21 原型侧：blackbox Job 表单不再写入 application_http + et-blackbox（留空）。
- [ ] D22 原型侧：采集器管理列表 = 映射 + 池全貌（未引用标记）。
- [ ] D19 落库后 M07 `middleware_type` → `database_type` + `middleware_type` 的字段拆分与 M04 映射表同步（PRD 已改，跨模块验证）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.15）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.13）
- `docs/02-product-requirements/Modules/Module_04_Custom_Discovery.md`（v1.3）
- `docs/05-execution-records/module-07/design-decisions.md`（D19 同步）
- `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx`（D17 已实现）


---

### 决策 D27：MVP 单域动线闭环（M01 侧）

> 📅 日期：2026-08-17 ｜ 轮次：第二十九轮：MVP 单域动线闭环，决策 D27

**D27-1 规则编辑 UI 版本归属（用户拍板：v0.3，不进 MVP）**

- **决策**：规则编辑 UI = **v0.3，不是 MVP 版本**。MVP 动线 = M01 采集 Job 管理（不含规则编辑 UI）+ 手写 `rules.yml` → M09 配置变更确认/下发。
- **解决三方矛盾（PRD / 原型 / 后端契约）**：PRD 四处明确「规则编辑 UI = v0.3、MVP 手写 rules.yml」（Module_01 PRD:22/24/483/798）保持不变，为**权威口径**；原型 RulesPage 已完整实现规则编辑 = **原型超前（v0.3 预览）**——本轮**不修改原型**，MVP demo 不进规则编辑页，原型规则编辑 UI 与 MVP 动线的差异留待 v0.3 迭代轮对齐（RulesPage 保留为 v0.3 预览）；**§6.2 不补 rules 写接口契约**（MVP 后端不实现 rules 写接口，随 v0.3 规则编辑 UI 一并补）。
- **依据**：规则编辑 UI 依赖 Module_02 `validate` / `preview` 接口（v0.3 启用）与指标库成熟度，提为 MVP 会扩大单域 demo 范围且与已冻结路线图（2.4「MVP 不做告警规则编辑 UI」）冲突；用户明确拍板按 v0.3 归属。

**D27-2 M01 保存后引导 + 下发状态感知（MVP 最小方案）**

- **决策**：
  1. 保存/启停/删除成功提示由纯 toast 改为「**变更将由 M09 生成变更单，需确认后生效**」+「**前往配置变更确认**」跳转按钮（引导到 M09 完成发布审批）；
  2. `change_status`（pending / confirmed / none，来自 M09 变更单状态）从 **v0.2+ 提前到 MVP**，「采集 Job」列表新增轻量「下发状态」列；
  3. **规则列表的下发状态列无 MVP UI 载体**（规则编辑 UI 不在 MVP、规则为手写 `rules.yml`）→ 随 v0.3 规则编辑 UI 一并落地（同一 `change_status` 机制，不单独为 MVP 造规则列表页）。
- **依据**：M01 保存动作到 M09 生效之间存在「变更单确认」gap，无引导时用户保存完不知道要去 M09 确认，动线在 UI 上断裂；提前 `change_status` 改动最小（M09 变更单状态已是既有数据，只需回写 + 列表展示）。

**D27-3 M01 §4 步骤 3 文字修订（人工确认 + pull/push 口径统一）**

- **决策**：§4 步骤 3「配置生成下发」改为「**配置生成与人工确认下发**」——补「生成草稿 → **人工确认** → 下发」环节（与 8.2 验收「经人工确认后下发」自洽）；措辞统一 pull 口径——「保存」≠「触发 M09 生成草稿」，正确表述 = **M09 轮询感知 `updated_at` 变化（pull 模式），M01 写库仅维护 `updated_at`、不主动通知**。
- **依据**：PRD:113 原文只写"生成并下发"、漏了唯一同步环节（人工确认），与验收 :857 不自洽；「保存触发生成草稿」式 push 措辞会误导后端实现（M09 3.3.3 已声明 pull 模式）。

### 已确认项（2026-08-17）

- [x] D27-1 规则编辑 UI = v0.3 不进 MVP（用户拍板）；PRD 保持权威、原型本轮不动、§6.2 不补 rules 写接口。
- [x] D27-2 change_status 提前 MVP + 保存引导 + Job 列表下发状态列；规则列表下发状态列随 v0.3 落地。
- [x] D27-3 M01 §4 步骤 3 补人工确认 + pull 口径统一。
- [x] M01 PRD 升 v3.19；M09 PRD 升 v1.37（决策 37，见 module-09）；版本总表 README 同步 ⚠️。

### 仍待确认项

- [ ] 原型本轮不修改：RulesPage（规则编辑 UI，v0.3 预览）与 MVP 动线的差异留待 v0.3 迭代轮对齐；ScrapeJobsPage 的保存引导/下发状态列、MainLayout「配置中心」菜单激活随下一轮原型同步落地（PRD 先行）。
- [ ] MVP demo 动线脚本需显式避开规则编辑页（RulesPage），以「采集 Job 管理 → M09 配置变更确认」演示单域闭环。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.19）
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.37，决策 37）
- `docs/05-execution-records/module-09/design-decisions.md`（决策 37）
- `docs/prototypes/module-01/`（本轮不修改）


---

### 决策 D28：规则编辑保存引导 + 规则列表「下发状态」列（v0.3 落地，原型 RulesPage 同步实现）

> 📅 日期：2026-08-17 ｜ 轮次：第三十轮：规则编辑引导确认 + 分级下发联动，决策 D28

- **决策**：
  1. **规则保存/启停/删除后引导确认**：成功提示改为「变更将由 M09 生成变更单，需确认后生效」+「前往配置变更确认」跳转（与 Job 同机制，D27-2 同一套引导组件/文案）；规则变更（`rules.yml` 变化）必须 reload，属决策 38-1 的**人工确认档**（非自动生效档）；
  2. **规则列表新增「下发状态」列**（`change_status`，与 Job 同源同机制）——D27-2 原定「随 v0.3 规则编辑 UI 落地」，本轮明确为规则编辑 UI（v0.3）的组成部分；MVP 阶段规则为手写 `rules.yml`、无规则列表 UI 载体，规则编辑 UI 上线时一并提供；
  3. **原型先行**：RulesPage 为 v0.3 预览，本轮同步实现保存引导与「下发状态」列（规则 mock 补 `change_status`）。
- **依据**：规则变更属高风险（误报/漏报）且必须 reload，必须走人工确认（决策 38-1）；与 Job 共用同一套引导机制无技术障碍；规则列表下发状态列与 Job 列表同源（M09 变更单状态回写），实现成本一致。

### 已确认项（2026-08-17）

- [x] D28 规则编辑保存引导 + 规则列表「下发状态」列（v0.3 落地；原型 RulesPage 本轮同步实现）。
- [x] M01 PRD 升 v3.20（5.5 规则编辑模型补引导契约 + 验收）；M09 PRD 升 v1.38（决策 38）。

### 仍待确认项

- [ ] 规则编辑 UI 属 v0.3（D27-1 拍板），MVP demo 不进规则编辑页；规则侧引导与下发状态列的验收随 v0.3 规则编辑 UI 评审。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.20）
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.38，决策 38）
- `docs/05-execution-records/module-09/design-decisions.md`（决策 38）
- `docs/prototypes/module-01/src/pages/RulesPage.tsx`（D28 原型侧）


---

### 决策 D28：「保存草稿 / 提交生效」双按钮提级 MVP（方案 C）

> 📅 日期：2026-08-25 ｜ 轮次：第三十轮：草稿/批量提交生效提级 MVP，决策 D28

**D28-1 draft 的语义边界：半成品暂存，不是变更安全闸口**

- **决策**：`draft` 的唯一定位 =「**新建阶段的半成品暂存**」（只做字段类型 / 名称唯一性基础校验，允许创建过程半成品保存）；变更安全的闸口在 **M09 变更单人工确认**（批次级 go/no-go，防平台 bug 导致监控整体失效），`ready` 只决定「进不进 M09 配置生成候选集」，不决定生效。动线为两层控制：

  ```
  draft ──(提交生效/批量提交生效)──► ready ──(watcher 轮询)──► 变更单(pending) ──(人工确认)──► 下发 reload
     对象级：参不参与生成                       批次级：go/no-go
  ```

- **依据**：M01 PRD §5.4 原文「MVP 阶段所有对象默认 ready；仅新建阶段可为 draft，提交生效转为 ready 后不再回退」；M09 PRD「配置草稿需人工确认后再生成 ConfigVersion 并触发下发，防止平台 bug 导致监控整体失效」。用户在联调中实测「创建 job 后立刻出现待确认变更单」是 watcher 正常行为而非缺陷——自动的只是「生成待确认草稿」，下发永远要人工确认。

**D28-2 方案 C 提级：创建表单「保存草稿 / 提交生效」双按钮，默认值保持「提交生效」**

- **决策（用户拍板）**：MVP 提前开放 v0.2 的「保存草稿 / 提交生效」双保存模式——创建抽屉底部两个按钮：「保存草稿」（基础校验，落 `draft_status=draft`，不进入 M09 配置生成）与「提交生效」（完整校验：必填项 / 网域已纳管 / 实例同域，落 `draft_status=ready`，进入变更检测管线）；**默认动作仍为「提交生效」**，不给所有用户强加草稿中间态。编辑抽屉（已 ready 对象）保持单按钮不变——已生效对象的后续修改直接走正常变更管线，无草稿概念。
- **否决方案 B（新建一律默认落 draft）**：违背 PRD 已冻结的「默认 ready」与单向流转约束；给 90% 不需要暂存的用户强加一步操作；把「半成品暂存」需求误当「变更控制」使用。
- **批量下发诉求的承载方式**：用户「初次配置 job 量大、一起编辑好再一次下发」的诉求由 **M09 变更单合并（后单取代前单，决策 42-1 / F-13）** 覆盖——连续创建多个 ready job 会合并进同一张 pending 变更单，最后一次人工确认全部下发；draft 中间态不是达成批量下发的必要条件。
- **依据**：方案 C 即 PRD v0.2 原生设计（§5.1「ScrapeJob 草稿与批量提交生效」行），提级不改变语义只提前交付；与已冻结的「pull 模式、M01 不主动通知」架构决策（D27-3）无冲突。

**D28-3 批量接口收窄为「批量提交生效」，移除用户主动 ready→draft 回退**

- **决策（用户拍板）**：本轮已实现的 `POST /api/v2/platform/scrape-jobs/batch-draft-status` 从「双向设置 draft_status」收窄为**「批量提交生效」（draft→ready 单向）**——入参中已 `ready` 的 job 跳过（或报错提示已提交生效），提交生效时执行完整校验；**不提供 ready→draft 用户主动回退**（前端不暴露入口，后端拒绝该方向）。
- **理由**：方案 C 落地后「误进 ready 想撤回」在源头被消除（创建时用户自选保存模式）；已 ready job 的撤回诉求由 M09 侧既有动线承接——废弃对应 pending 变更单（决策 43-1~43-7）或编辑/删除走正常变更管线；ready→draft 回退在 PRD 语义里没有合法落点，且会制造 PRD 未定义的灰色状态（ready 过又变回 draft 的 job，change_status 无法定义）。
- **唯一例外的区分**：M09 变更单废弃时「新建未生效 job 随单自动回退 draft」（决策 43-3）是**系统级回退**——审批结果的执行动作，仅作用于从未生效对象；与 D28-3 移除的「用户随手批量回退」是两回事，PRD 收割时需在 §5.4 单向流转条款补此例外注记。

### 已确认项（2026-08-25）

- [x] D28-1 draft = 半成品暂存；变更闸口在 M09 人工确认（ready ≠ 生效）（用户确认）。
- [x] D28-2 方案 C 提级 MVP：创建双按钮、默认提交生效；方案 B 否决；批量下发由变更单合并承载（用户拍板）。
- [x] D28-3 批量接口收窄为「批量提交生效」单向；用户主动 ready→draft 回退移除（用户拍板）。
- [x] M09 变更单废弃的源数据回写语义（决策 43-1~43-7，含 43-4 长期项 `deployed_snapshot` 备注 v0.3）见 module-09 design-decisions（用户拍板）。

### 仍待确认项

- [ ] design 分支收割 M01 PRD：§5.1「ScrapeJob 草稿与批量提交生效」行的版本归属由 v0.2 改为 MVP（双按钮 + 批量提交生效）；§5.4 `draft_status` 字段说明补「系统随单回退例外」（决策 43-3）；§11.1 列表操作补「批量提交生效」；状态四态列中「草稿」由灰显占位改为真实可用态。
- [ ] design 分支同步原型：创建抽屉双按钮、列表多选 + 批量提交生效入口。
- [ ] 代码实现待执行：批量接口收窄（ready→draft 拒绝 + 完整校验）+ 创建抽屉双按钮 + 后端 draft 保存走基础校验（本轮仅落文档）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（§5.1 / §5.4 / §11.1 待 design 分支修订）
- `docs/05-execution-records/module-09/design-decisions.md`（决策 43 系列：废弃回写语义）
- `docs/05-execution-records/module-01/dev-feedback.md`（F-16 修订）


---

### 决策 47：采集状态回显前置与安装确认降级

> 📅 日期：2026-08-28 ｜ 轮次：第三十一轮：采集状态回显前置——知情权替代人工确认闸门，决策 47

**47-1 安装确认拆闸门：选中即生成 target，确认降级为可选登记**

- **决策（用户拍板）**：`ExporterInstallationConfirmation` 由「生成 target 的前置闸门」降级为**可选登记**（「状态登记 + 人工背书」定位不变，客户流程无强制追责背书需求）——`unconfirmed` 不再阻断 target 生成；M09 配置生成只看 `selected_instance_ids`（+ `offline` 排除 + `enabled` + `draft_status`）。修订 M01 §9.1 原 P0 验收「未确认实例不生成 target」。
- **actual_port 新家（用户授权自选）**：仍挂在可选登记表单上（`ExporterInstallationConfirmation.actual_port`，P1 不变）——确认记录实体保留，仅失去闸门语义；端口一致性提示逻辑（与生效端口不一致则提示、不自动改配置）不变。
- **理由**：人工确认是「口头背书」不是事实，`up/down` 才是事实；闸门藏拙（未确认实例不出现在配置里）反而剥夺了用户发现问题的机会。down 噪音在有了状态回显后变成可操作信息。

**47-2 M01 Job 上下文采集状态回显（只读消费 M02）**

- **决策（用户拍板）**：「采集 Job」详情/编辑抽屉的实例列表新增「采集状态」列 + 外层汇总指标（在线数 / 实例总数 / 待采集数）：
  - 存量已生效实例显示真实 up / down；
  - 新保存 / 新勾选、变更单未确认下发的实例显示「待采集」，在线数不变；
  - 变更已确认下发但仍 down（采集器未装 / 网络故障）时，提醒「配置已下发但未采集到数据，请检查采集器安装与网络连通」，引导用户关注采集器状态。
- **数据源**：Module_02 `GET /api/v1/targets` 代理（按 Job 过滤），M01 不直连 Prometheus；回显为展示口径、非持久状态。
- **时序说明**：采集状态只在「M09 变更单确认下发 → Prometheus reload → 首次抓取」之后存在，故回显是「保存后验证」闭环而非选择时辅助；「待采集」为显式状态，避免用户把 unknown 误读为异常。

**47-3 M07 资源列表采集状态 badge 三态化（修订决策 31-M1）**

- **决策（用户拍板）**：M07 资源列表「采集状态」列由「未监控」二元筛选（决策 31-M1，`is_monitored` 选中关系）升级为**三态 badge**：`采集中`（被 Job 选中且 target up）/ `已下发未采到`（被选中但 down 或待首次抓取）/ `未监控`（未被任何 Job 选中）；三态数据 = M01 选中关系（`is_monitored`）+ M02 健康度/覆盖率 API（`up` 聚合，按 `resource_id` 标签回连资源），M07 只读消费、**不直连时序数据**（M02/M07 边界不变）。
- **配套**：M02「采集健康度/覆盖率查询 API」由 v0.2 **提前到 MVP**；资源↔target 回连依赖 LabelTemplate 默认模板含 `resource_id` 稳定身份标签（M01 §9.1 已有 P0 验收）；列表级查询必须走聚合 API，禁止逐行查询（TQ-6 N+1 教训）。

**47-4 M02 目标状态：API 保留 MVP，独立页面降级 P1**

- **决策（用户拍板）**：`GET /api/v1/targets` 代理**保留 MVP P0**（M01 回显与 M07 badge 的共同数据源，租户/网域注入仍由 M02 承担）；**独立「目标状态页」前端由 P0/MVP 降为 P1**（极简列表即可），其价值收敛为「跨 Job 全局排障入口」（按 health / 网域聚合过滤，与配置场景、资产场景互补），不再是唯一的状态知情入口。

### 已确认项（2026-08-28）

- [x] 47-1 ~ 47-4 全部经用户拍板（本轮对话逐条确认）。
- [x] M01 PRD v3.27 / M02 PRD v1.4 / M07 PRD v2.22 / 全局用户故事库已落版。

### 仍待确认项 / 跟进

- [ ] 原型对齐：module-01（Job 实例列表采集状态列 + 在线数汇总 + 安装确认改可选登记）、module-07（资源列表采集状态三态 badge）、module-02（目标状态页降 P1 标注）原型同步。
- [ ] 开发侧影响：integration/v0.1 已按「未确认实例不生成 target」实现——闸门拆除需排期 rework（M09 configgen 不再过滤未确认实例；M01 回显消费 M02 targets API；M07 badge 消费 M02 健康度 API）。
- [ ] 决策 31-M1 被 47-3 修订（二元筛选 → 三态 badge）；决策 7 相关「安装确认」语义以 47-1 为准。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.27）
- `docs/02-product-requirements/Modules/Module_02_Query_Center.md`（v1.4）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.22）
- `docs/02-product-requirements/01_User_Stories.md`（ARCH-03 落点说明、M01-OPS-04、M01-OPS-08、M02-OPS-08）
- `docs/05-execution-records/module-02/design-decisions.md` / `docs/05-execution-records/module-07/design-decisions.md`（决策 47 交叉引用）


---

### 决策 63：导航分组以生产为准

> 📅 日期：2026-09-05 ｜ 轮次：导航分组以生产为准，决策 63

- **背景**：F-09（采集器管理 / 采集 Job 拆独立页面）主决策已全链路落地；但 2026-08-23 的**补充裁定**（「取消『采集策略』一级分组、采集器管理 / 采集 Job / 规则编辑提升为 Sider 一级导航项」）只在 PRD/原型落地，生产 `ui-custom/web/src/layouts/MainLayout.tsx` 仍保留「采集策略」一级模块（Sider 二级四项：采集器管理 / 采集 Job / 规则编辑 / 指标库）。终验核对时两侧不一致（module-01 dev-feedback F-09）。
- **结论（决策 63，2026-09-05，chenrt 终验拍板）**：**以生产导航为准**——保留「采集策略」一级分组，撤销补充裁定的「取消分组」部分；主决策（两独立页面 `/collectors` + `/scrape-jobs`）不变。
- **落点**：Module_01 PRD v3.36（§5.1 入口与命名 / §9 验收 / §10 术语映射）；原型 module-01 {v3.36}（MainLayout 回改 + README 导航描述）；module-01 dev-feedback F-09 裁定修订注记。
- **依据**：生产导航已随用户多轮验收稳定使用，且「采集策略」分组承载四项采集域功能的 IA 认知一致性优于扁平一级；契约层只需保证「两个独立页面」这一主决策，分组层级属实现侧 IA 细节。


---

### 决策 83：generic_target 端点子类型判别与 k8s monitor_type 枚举

> 📅 日期：2026-09-15 ｜ 轮次：generic_target 端点子类型判别与 k8s monitor_type 枚举，决策 83

> **主记录在 `docs/05-execution-records/module-07/design-decisions.md`「generic_target 定位收窄与 M07/M01 字段边界（2026-09-15，决策 83）」**，本节仅登记 M01 侧落点，结论以主记录为准。

- **背景**：M07 走查发现「通用目标」表单要求用户填 exporter_type / port / metrics_path / scheme，与 M01 采集器登记 / 默认采集配置字段重复；决策 77 声称 generic_target + M01 `monitor_type=k8s` 可表达 K8s 集群健康监控，但 M01 推导表只有 `generic_target → snmp` 单值行、无 k8s 监控对象类型，契约缺口。
- **M01 侧结论**：
  1. §5.1 `MONITOR_TYPE_DERIVATION_MAP` 的 generic_target 行扩展为**端点子类型判别**，判别键 = M07 `GenericTarget.exporter_type`（M07 表单对用户隐藏的技术字段，由端点类型预设写入）：`snmp_exporter → snmp`（MVP 可走完整映射）、`kubernetes-apiserver → k8s_apiserver`、`kube-state-metrics → k8s_kube_state_metrics`、`etcd → k8s_etcd`（三枚举 {v0.2} 随决策 81 K8s 集群登记双入口落地）、其他 / 空 → 无默认映射 Job 手填。
  2. **落地形态 = monitor_type 枚举值扩展 + 内置 ExporterTemplate / CITypeExporterMapping 映射种子新增**，模型字段不变；三个 k8s 种子由 M01 侧配置。
  3. blackbox 拨测不经推导表（`job_type=blackbox` 的 `blackbox_targets` 直接承载）；M01 采集器是平台级软件实现目录（不绑网域），M07 generic_target 是被采集资产对象，两者不合并。
- **落点**：Module_01 PRD v3.42（§5.1 推导表 + 枚举说明、§10 术语 monitor_type 行、Change Log v3.42；v3.39 轮转迁入本文件完整历史）；**M01 原型待同步 v3.42**（三枚举与判别逻辑，{v0.2} 不阻塞当前 MVP 原型）。
- **关联**：决策 81（K8s 双域归属与登记双入口，主记录 module-07）、决策 77（K8s 不设第六资源类型）、决策 52（拨测目标取发起侧网域）。

---

## T9 ｜ 术语分层与 PRD 结构改造

### 决策 29：用户故事编码统一为模块命名空间 `Mxx-ROLE-NN`

> 📅 日期：2026-08-07 ｜ 轮次：第六轮

- **问题**：Module_01 用户故事编码是否已全部更新为 `Mxx-ROLE-NN` 新格式，有无遗留旧编码（`OPS-XX` / `ARCH-XX`）？
- **结论**：
  - Module_01 第 2 章用户故事已全部使用 `M01-OPS-01~06` / `M01-ARCH-01~03` 模块命名空间编码（全局唯一），旧编码 `OPS-01~06` / `ARCH-01~03` 已全部替换，无正文遗留；
  - 完整故事条目（角色 / 我希望 / 以便于）注册于全局用户故事库 `01_User_Stories.md` §4.1，模块 PRD 第 2 章仅列编码 + 一句话摘要（本轮补充引用说明）；
  - 历史变更记录中的旧编码仅存在于已迁移至本文件的「Change Log（完整历史）」（v2.1 及以前版本当时使用的编码，属历史快照，不做追溯改写）。
- **依据**：全局用户故事编码规则（`01_User_Stories.md` §4，v1.24 固化）：产品级故事由全局库统一维护，模块级故事使用 `Mxx-ROLE-NN`，禁止复用产品级编码但语义不同。
- **影响范围**：Module_01 PRD 第 2 章、全局用户故事库 §4.1、Change Log。

---

### 决策 30：Module_01 PRD 按 prototype-designer 骨架规范补齐

> 📅 日期：2026-08-07 ｜ 轮次：第六轮

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

### 决策 D24：术语分层与字段改名

> 📅 日期：2026-08-16 ｜ 轮次：第二十六轮：术语分层与字段改名，决策 D24

### 术语分层（三层各归其主，互不借用）

| 层 | 术语（UI 文案） | 技术字段 | 归属 | 含义 |
|---|---|---|---|---|
| CMDB | **CI 类型**（bk_obj_id） | `bk_obj_id` / `cmdb_ci_type` | CMDB / M04 | 资源本质分类（mysql / redis / 达梦），权威来源，监控平台只读 |
| M07 | **资源类别 + 子类型** | `resource_category` + `database_type` / `middleware_type` / `os_type` | M07 | 内部资源管理维度（数据库 / 中间件 / 主机 / 应用 / 通用目标） |
| M01 | **监控对象类型**（不再叫 CI 类型） | `monitor_type` | M01 | 派生的策略维度（host_linux / mysql / application_http），用于绑定采集器、指标库、标签模板 |

**规则一句话**：「CI 类型」这个词只允许出现在 CMDB/M04 的上下文里；M01/M07 的页面、表单、术语映射一律不再使用。


- **M01**：`resource_type` → **`monitor_type`**（字段表 / API query / 数据模型 / 术语映射）；`CI_TYPE_CATEGORY_MAP` → **`MONITOR_TYPE_DERIVATION_MAP`**（监控对象类型推导表——名字即"这是推导演出，不是绑定"）；「CI 类型」→「监控对象类型」（M01 上下文，CMDB/M04 引用保留）；UI 展示名「资源类型」→「监控对象类型 / 资源类别」。
- **M07**：`Resource.resource_type`（粗粒度）→ **`resource_category`**（枚举类型与常量同步 `ResourceCategory`、5.2 字段表、5.10 LabelTemplate 锚点、5.12 A 表头、6.x API、Excel 状态映射、术语映射）——消除与 M01 细粒度 `resource_type` 同名不同粒度的 API 层歧义；M01 细粒度维度引用改 `monitor_type`、推导表改 `MONITOR_TYPE_DERIVATION_MAP`。
- **M04**：CMDB CI 类型映射表改**三列完整推导链**——`CI 类型（bk_obj_id，只读）→ 资源类别 + 子类型（管理员配置）→ 监控对象类型（只读，由推导表实时计算）`，第三列只读不可编辑；待分类队列引导文案改为「为 CI 类型指派资源类别与子类型」（非"创建 CI 类型"）；孤儿分组字段 `resource_type` → `resource_category`。
- **全局**：`00_Global_Architecture.md` 新增「术语归属与禁用规则」小节（三层术语表 + 推导链 + 归属与禁用规则）；`03_Functional_Architecture.md` 相关表述同步（「CI 类型 ↔ Exporter 模板绑定」→「监控对象类型 ↔ 默认采集器绑定」、「四类资源」→「五类资源」）。

### UX 补充建议（链路显性化，原型侧落地）

1. **M04 映射表三列展示完整推导链**，第三列只读——用户一眼看到"我配的是前两列，监控对象类型是自动推出来的"。
2. **M01 两级级联**：第二级 label「监控对象类型」，extra 写明"由资源类别与子类型（主机另按操作系统）自动推导"。
3. **M04 待分类队列**：引导语说清楚动作是"为 CI 类型指派资源类别与子类型"。
4. **M07 资源详情只读展示派生的监控对象类型**（如「监控对象类型：mysql（由 数据库 + mysql 推导）」）。
5. **全局术语规范**：00_Global_Architecture 加「术语归属与禁用规则」（已落地）。

### 已确认项（2026-08-16）

- [x] D24 决策确认，PRD 修改已执行：M01 v3.16 / M07 v2.14 / M04 v1.4 / 00_Global_Architecture（第 7 章）/ 03_Functional_Architecture。
- [x] 字段改名全量落地（monitor_type / MONITOR_TYPE_DERIVATION_MAP / resource_category / ResourceCategory），历史 Change Log 行保持原貌未被污染。
- [x] 「CI 类型」仅在 CMDB/M04 上下文保留（M01 258 行 CMDB 接入段、M07 CMDB 侧边界段、M04 映射表首列）。

### 仍待确认项

- [ ] **原型 mocks 术语同步（D24 涟漪，待执行）**：module-01 / module-07 原型 mocks 的 `resource_type` → `monitor_type` / `resource_category`、`CI_TYPE_CATEGORY_MAP` → `MONITOR_TYPE_DERIVATION_MAP`、两级级联 label 文案「监控对象类型」+ extra 推导说明、M04 映射表三列化（原型 v1.1 未建，PRD 先行）。
- [ ] M07 资源详情展示「派生的监控对象类型」（UX 建议第 4 条）随原型同步。
- [ ] 全局术语规则在后续模块 PRD（M02/M08/M09 等）中的历史遗留「CI 类型」表述清理（版本修订时顺带）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.16）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.14）
- `docs/02-product-requirements/Modules/Module_04_Custom_Discovery.md`（v1.4）
- `docs/02-product-requirements/00_Global_Architecture.md`（第 7 章术语归属与禁用规则）
- `docs/02-product-requirements/03_Functional_Architecture.md`（术语同步）


---

## T5 ｜ 标签模板与关联体验

### 决策 31：标签模板关联 UX 补齐（名称+ID 展示、内联只读预览、跨模块跳转；模板 ID 为跨模块唯一 FK）

> 📅 日期：2026-08-11 ｜ 轮次：第七轮

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

### 决策 32：CI-Exporter 映射页标签模板展示改「两行卡片 + 预览抽屉 + 表单紧凑卡片」

> 📅 日期：2026-08-11 ｜ 轮次：第八轮 UI/UX

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

### 决策 33：端口一致性三层解法 + 安装确认登记实际端口（不承担端口编辑）

> 📅 日期：2026-08-11 ｜ 轮次：第九轮 端口一致性

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

### 决策 37：标签配置引导落在映射层，Job 层做继承提示；补充「无模板」mock 演示数据

> 📅 日期：2026-08-12 ｜ 轮次：第十一轮 标签配置引导落地

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

### 决策 38：标签选择两情形引导——新增 CI 创建模板 / 已有 CI 直接选择；选择器严格按 CI 类型过滤

> 📅 日期：2026-08-13 ｜ 轮次：第十二轮 标签选择两情形引导

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

### 决策 D25：标签模板三环节定位（A+C+D）

> 📅 日期：2026-08-16 ｜ 轮次：第二十七轮：标签模板三环节定位澄清，决策 D25

- **正交关系定性**：标签模板（打什么标签，LabelTemplate 归 M07 维护）与采集器（怎么采，ExporterTemplate）**正交**；`CITypeExporterMapping.label_template_id` 的语义 = **该监控对象类型在该类别下的「默认模板」**（创建 Job 时自动预填的快捷来源），**非强关联、非必填**。
- **A｜预设抽屉补「默认标签模板（可选）」字段**：不隐藏、不强制；按**资源类别**过滤候选（该类别下所有模板），extra 说明「该监控对象类型的默认标签模板：创建采集 Job 时自动预填，可更换；不选则创建 Job 时再选择」。让「默认模板标记到 CI 类型」（D18）在映射层可落地——现状断链：预设抽屉无该字段但 `handlePresetSave` 读 `values.label_template_id`，新建映射 `has_label_template` 恒 false、列表全显「标签模板待配置」。
- **C｜Job 动线：自动预填 + 类别兜底 + 显性化 + 可更换**：创建 Job 自动预填顺序 = 映射默认模板（`mapping.label_template_id`，CI 类型级）→ **兜底同类别 `is_default` 模板**（映射未配置时）；概要行显性说明「已自动匹配该监控对象类型的默认模板，可更换」；用户可换用其他模板（引用级）。
- **D｜选择器按「资源类别」过滤（类别驱动候选、类型驱动默认）**：标签模板锚定粗粒度类别（D18），选择器候选 = 当前资源类别下所有模板（选类别即收敛）；选定监控对象类型后预填/标记默认模板。与 D18 完全对齐——**不按「监控对象类型」触发过滤**（现状 `watchResourceType` 等价但交互时机晚、语义反）。

### 已确认项（2026-08-16）

- [x] A+C+D 拍板；决策落档本小节，PRD v3.17 与原型同步执行。

### 仍待确认项

- [ ] 无（本轮闭环）；原型同步后预览验证。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.17）
- `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx`（A/C/D 原型侧）


---

### 决策 D26：补配入口收敛（一个动作、两个触发点）

> 📅 日期：2026-08-16 ｜ 轮次：第二十八轮：标签模板补配入口收敛 + D25-A 分组展示，决策 D26

- **统一动作 = 打开该监控对象类型映射行的编辑抽屉**——"补配"的本质是在映射层设置默认模板，唯一落点就是映射行，不需要第三个页面；
- **触发点 1｜Job 表单 Alert**：主按钮 → 跳采集器管理并**自动打开该映射的编辑抽屉**（带参 `?view=collectors&edit=<mapping_id>`）；落位即开，不要求用户自己找映射行；
- **触发点 2｜映射列表「补配」按钮 / 「待配置」badge**：**同页直接打开本行编辑抽屉**（修复当前空跳转）；
- **M07 创建入口收敛**：「前往标签模板管理（M07）」从 Job 表单 Alert **拿掉**，只保留在抽屉内标签模板选择器的**空态**（notFoundContent）——只有"该类别下真的一个模板都没有"时才需要去 M07 创建，复用空态依赖引导规范（D1）；
- **Alert 文案按缺口类型区分**：①映射有候选但未关联模板 → 主按钮「立即补配」（打开映射编辑抽屉）；②该资源类别下无任何模板 → 主按钮「前往创建模板」（M07，此时才是真阻塞）——D25-C 类别兜底已让"映射未关联"不再是硬缺口；
- **软引导不阻塞保存（确认边界）**：缺标签模板只是监控数据缺归属标签，Job 仍可运行——保持 warning Alert 提示、**不升级为必填校验**（与默认采集器必填不同）；
- **D25-A 分组展示**：预设抽屉「默认标签模板（可选）」用 `Divider` 与采集参数隔开（分隔标题「标签模板（与采集器正交，可选）」），视觉上声明"这不是采集器的一部分"。

### 已确认项（2026-08-16）

- [x] D26 决策确认；PRD v3.18 与原型（补配入口收敛 + Divider）同步执行。

### 仍待确认项

- [ ] 无（本轮闭环）；原型构建 + 预览验证。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.18）
- `docs/prototypes/module-01/src/pages/ScrapeJobsPage.tsx`（入口收敛 + Divider）


---

## T6 ｜ 业务指标库与跨模块对齐

### 决策 39：application_http 语义澄清 + v0.4 新 CI 类型引导闭环

> 📅 日期：2026-08-14 ｜ 轮次：第十三轮 跨模块对齐：CI-Exporter 适配 / 实例筛选语义 / 服务发现预留

### 讨论过程

1. **静态 app 场景**：`application_http` 已在 CI_TYPE_CATEGORY_MAP；其"Exporter 模板"实为 HTTP 抓取模板（业务应用无独立 exporter，Prometheus client 暴露 /metrics）；v2.8 5.15 机制 A（抓取注入 app/biz）在 M01 侧 = Job 引用含映射的模板，无需新增模型。
2. **微服务动态场景**：静态 `selected_instance_ids` 手动勾选无法覆盖动态实例；但 CI-Exporter 映射是"模板层"，与"目标从哪来"解耦，映射可复用，需扩展 Job 实例选择模式（v0.2+ service_discovery + relabel）。
3. **v0.4 CMDB**：类型权威在 CMDB、MetricCenter 只维护"类型→采集模板"映射 = 业界标准做法；缺 3 个衔接：新类型引导闭环、类型映射可扩展注册、business_domain 从 CMDB 业务路径同步。
4. **实例筛选 vs 标签管理**：筛选（选择器）与标签（描述器）正交；筛选字段 = Resource 属性字段（恰好是模板映射源字段），label 仅作 UI 别名（由模板 Mapping 只读派生、无需手动维护）；不用 label 名做筛选键（system 标签实时计算不落库 + 模板变更穿透 Job，绑定 label 名导致筛选漂移）。



- **问题**：application_http 无独立 exporter（业务应用自带 /metrics），且 v0.4 CMDB 新类型接入缺引导。
- **结论**：①application_http = 业务指标端点 HTTP 抓取模板，`default_port` 对应业务端口（可空由 endpoint 决定），默认模板含 `app_name→app`、`business_domain→biz`（机制 A 落地）；②v0.4 新 CI 类型经 Module_04 待分类队列映射后，触发「CI-Exporter 映射创建引导」闭环（复用 v3.1 标签模板引导模式），避免新类型静默无监控。
- **依据**：用户确认；Module_07 v2.8 5.15 业务指标标签规范；Module_04 待分类队列。
- **影响范围**：Module_01 PRD 5.1 / 8.2（v3.4）。

---

### 决策 40：instance_filter 字段语义——Resource 属性字段为主，label 仅 UI 别名

> 📅 日期：2026-08-14 ｜ 轮次：第十三轮 跨模块对齐：CI-Exporter 适配 / 实例筛选语义 / 服务发现预留

- **问题**：v0.3+ filter 筛选字段来源未明确，用户担心与标签管理耦合。
- **结论**：①筛选字段 = Resource 属性字段（env/cluster/app_name/business_domain/service_name/middleware_type 等，即模板映射源字段），筛选不写标签、与标签管理正交（保持"标签配置唯一入口原则"）；②label 仅作 UI 别名（app↔app_name、biz↔business_domain），由模板 Mapping 只读派生、无需手动维护；③**不用 label 名做筛选键**——防模板变更穿透导致筛选语义漂移（system 标签实时计算不落库 + 模板变更穿透 Job）；④v0.2+ service_discovery 模式预留（微服务动态实例：目标由服务发现 + relabel 动态生成，不落 selected_instance_ids，映射模板复用，关联键 app/biz 不用 instance）。
- **依据**：用户确认「字段为主 + label 别名（无需手动维护，由模板映射派生）」；Module_07 决策 3.29/3.44。
- **影响范围**：Module_01 PRD 5.4 / 3.1 / 8.2（v3.4）。

---

### 决策 41：v0.4 business_domain 由 CMDB 业务路径同步

> 📅 日期：2026-08-14 ｜ 轮次：第十三轮 跨模块对齐：CI-Exporter 适配 / 实例筛选语义 / 服务发现预留

- **问题**：v2.8 Module_07 新增 business_domain 字段，v0.4 CMDB 场景下应随资源落地而非手动维护。
- **结论**：Module_04 BlueKing 字段映射与 Provider 同步规范补「业务路径 → `business_domain`」——CMDB 同步后业务类型随资源落地（供 biz 标签生成），平台不手动维护；与 Module_07 v2.8 衔接。
- **依据**：用户确认；Module_07 v2.8 5.2 business_domain。
- **影响范围**：Module_04 PRD 3.x / 4.1（v1.2）。

### 已确认项（2026-08-14 第十三轮）

- [x] 微服务动态场景：M01 5.4 补 v0.2+ service_discovery 模式预留（用户确认）。
- [x] v0.4 CMDB 衔接：M01 application_http 语义 + 新类型引导闭环 + M04 business_domain 同步（用户确认）。
- [x] 实例筛选：字段为主 + label 别名自动派生（用户确认，别名无需手动维护）。
- [x] 落档范围：M01 PRD v3.4 + M04 v1.2 + design-decisions（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] filter 模式表达式语法（v0.3+ 详细设计，含 label 别名映射表）待后续迭代。
- [ ] v0.2+ service_discovery 模式（K8s 服务发现源、relabel 模板）待后续迭代设计。
- [ ] 原型同步：M01 原型（v2.8）application_http 语义文案 + 筛选字段枚举（下轮执行）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.4）
- `docs/02-product-requirements/Modules/Module_04_Custom_Discovery.md`（v1.2）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.8）
- `docs/prototypes/module-01/`（v2.7，同步待下轮 v2.8）


---

### 决策 42：新增业务指标库（BusinessMetric）——业务负责人定义语义、运维落地采集

> 📅 日期：2026-08-14 ｜ 轮次：第十四轮 业务指标库——业务负责人与运维的职责分工

### 讨论过程

1. **职责分工（两段式）**：业务负责人 = 定义层（业务指标语义只有业务侧知道）；运维 = 落地层（采集配置）。现有 ExporterMetricLibrary 只登记技术指标，业务指标无登记处、无 owner、无语义——职责断开的根源。
2. **业务域 ≠ CI 类型**：CI 类型是技术部署形态（东西是什么），业务域是业务语义归属（为谁服务），两个维度；运维不会把业务域当 CI 类型配模板；CI-Exporter 模板是采集落地环节、不是业务域入口。业务域入口 = 业务指标库登记（业务侧定义）+ 应用服务资源 business_domain 归属（运维侧）。
3. **微服务 ⊂ 业务域**：微服务是业务域的实现载体（技术层），业务域是语义聚合（业务层）；一个业务域由多个微服务组成，微服务可被多业务共享但主归属一个；v0.2+ service_discovery 采集动态实例后仍带 biz 标签归属业务域（采集方式不同、归属维度一致）。
4. **业务指标采集**：业务指标不来自独立 exporter，而是业务应用埋点（application_http 抓取），机制 A（Job 引用含 app/biz 模板）注入——采集已解决，缺的是"业务语义 → 运维"的契约传递。



- **问题**：业务监控指标只有业务负责人知道，运维无法凭空确定监控什么；现有 ExporterMetricLibrary 只登记技术指标，职责断开。
- **结论**：
  1. **新增 `BusinessMetric` 实体（Module_01，与 ExporterMetricLibrary 并列）**：字段含指标名 / 语义说明（业务人话）/ 类型单位 / 所属业务域（business_domain）/ 关联应用（app_name）/ 建议阈值 / **业务负责人（owner 必填）** / 埋点状态（pending → instrumented → online）；
  2. **职责分工**：业务负责人登记 + 定义语义/阈值（业务侧 input）；运维消费业务指标 → 确认埋点 → 采集落地（CI-Exporter application_http + Job 引用模板）→ 标记「已上线」（M01-BIZ-01/02）；
  3. **版本分层**：MVP = 最小登记表（运维代登记、owner 必填保证职责可溯）；v0.2+ = 独立业务负责人角色入口（Module_06 权限）+ 业务健康度看板；
  4. **业务指标采集不新增模型**：采集走机制 A（application_http + app/biz 模板注入，见决策 39 / Module_07 5.15），BusinessMetric 只登记语义契约。
- **依据**：用户确认「新增 BusinessMetric」「MVP 登记表 + v0.2 完整」「M01 v3.5 落档」；业务指标库解决"语义契约传递"而非采集。
- **影响范围**：Module_01 PRD 5.9 / 3.1 / 8 / 术语映射（v3.5）；全局故事库 M01-BIZ-01/02；v0.2+ 业务负责人角色与看板待后续迭代。

### 已确认项（2026-08-14 第十四轮）

- [x] 业务指标库新增 BusinessMetric 实体（用户确认）。
- [x] MVP 最小登记表（owner 必填）+ v0.2+ 独立业务负责人入口/看板（用户确认）。
- [x] 业务域 ≠ CI 类型（维度澄清）；微服务 ⊂ 业务域（实现载体）（用户确认）。
- [x] 落档：M01 PRD v3.5 + 全局故事库 + design-decisions（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] v0.2+ 业务负责人角色/权限（Module_06）与业务健康度看板（M01-BIZ-02）设计待后续迭代。
- [ ] 业务指标库原型（M01 原型 v2.8 一并落地：业务指标库登记页）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.5）
- `docs/02-product-requirements/01_User_Stories.md`（M01-BIZ-01/02）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.8）
- `docs/prototypes/module-01/`（v2.7，同步待下轮 v2.8）


---

### 决策 43：业务指标动线分离——两角色分工 + 登记动作与语义所有权分离 + 聚合视图版本归属

> 📅 日期：2026-08-14 ｜ 轮次：第十五轮 业务指标动线分离——登记动作 vs 语义所有权 + 业务域聚合视图

### 讨论过程

1. **两动线分离**：当前原型是单一运维视角动线（CI-Exporter → Job → 指标库 → 规则），无业务负责人入口、无角色概念。分离方案——业务负责人动线（业务指标库登记/更新 + v0.2+ 看板）、运维动线（技术指标库 CRUD + 业务指标库只读语义 + 状态推进 + 采集配置）。
2. **登记动作 ≠ 语义所有权**：登记不绑定角色——业务负责人自录（self）或运维接工单代办（agent）均可；`owner` 必填指向业务负责人（语义所有权不随录入者转移）；代办后可选「请业务负责人确认语义」环节。
3. **业务语义层（业务域聚合）**：MVP 仅 business_domain 资源字段 + biz 标签；v0.2+ 独立业务目录提供业务域聚合视图（成员列表 + 健康度看板 + 采集覆盖）。**语义层不改变采集配置逻辑**（采集仍按 CI 类型 + 实例选择），仅影响视图 / 查询聚合（biz）/ 告警分组（v0.3+）/ 批量操作入口。



- **问题**：业务人员与技术人员的权限/动线未分离（职责分工不显性）；业务指标登记是否只能业务负责人自录？业务域聚合（微服务 ⊂ 业务域）如何 UI 体现、对采集配置有何影响？
- **结论**：
  1. **两动线分离**：业务负责人 = 业务指标库登记/更新（限自己业务域）+ v0.2+ 健康度看板；运维 = 技术指标库 CRUD + 业务指标库**只读语义 + 状态推进**（确认埋点/上线）+ CI-Exporter/采集 Job/规则；原型以「当前角色」切换器演示（v0.2+ 真实权限依赖 Module_06）；
  2. **登记动作 ≠ 语义所有权**：`register_source` = `self`（自录）/ `agent`（工单代办）；`owner` 必填且语义编辑权仅业务负责人或其委托；代办后可选确认环节（M01-BIZ-03）；
  3. **业务域聚合视图 v0.2+**（随 Module_07 决策 3.46 独立业务目录）：成员列表（应用/微服务 + 中间件 + 主机）+ 健康度看板 + 采集覆盖；**不改变采集配置逻辑**（采集按 CI 类型 + 实例选择，business_domain 仅注入 biz 标签），影响仅限视图 / 查询聚合 / 告警分组 / 批量入口。
- **依据**：用户确认「自录 + 工单代办」「v0.2+ 聚合视图」「PRD v3.6 落档」；职责分工两段式（定义层 vs 落地层）。
- **影响范围**：Module_01 PRD 5.9 / 3.1 / 术语映射（v3.6）；全局故事库 M01-BIZ-03；原型 v2.8（角色切换 + 业务指标库页 + 登记抽屉 + 状态推进，下轮同步）。

### 已确认项（2026-08-14 第十五轮）

- [x] 两动线分离：业务负责人（登记/看板）vs 运维（采集/全指标可见 + 业务指标状态推进）（用户确认）。
- [x] 登记模式：自录 + 工单代办，owner 必填指向业务负责人（用户确认）。
- [x] 业务域聚合视图 v0.2+（语义层不改变采集配置逻辑）（用户确认）。
- [x] 落档：M01 PRD v3.6 + 全局故事库 + design-decisions（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [x] 原型 v2.8（2026-08-14 完成）：MainLayout 角色切换器 + 业务指标库页（登记抽屉/状态推进/登记来源）+ 指标库导航分离 + application_http 语义提示 + 实例选择业务类型筛选；test 26/26、lint、build、tsc、统一入口验证通过。
- [ ] v0.2+ 业务域聚合视图与独立业务目录（Module_07 决策 3.46）详细设计待后续迭代。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.6）
- `docs/02-product-requirements/01_User_Stories.md`（M01-BIZ-01/02/03）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（v2.8）
- `docs/prototypes/module-01/`（v2.8，已同步）


---

## T8 ｜ 告警规则三轴重构

### 决策 3.58：M01/M08/M09 告警规则职责按三轴重构

> 📅 日期：2026-08-15 ｜ 轮次：第二十三轮 M01/M08/M09 告警规则职责三轴重构

- **问题**：
  1. M01 5.5 `MonitoringRule` 与 M08 6.1 `AlertingRule`/`RecordingRule` 字段大面积重复（expr / duration / labels / annotations / scope / enabled），权威来源不清；
  2. M08 同时声明生成 `rules.yml`（§4/5.1），与 M01 决策 10 的「Module_09 为配置唯一生成者」冲突；
  3. M01 与 M08 均出现「告警规则」命名，用户入口混淆；
  4. M08 原本承载规则编辑 UI、规则生命周期、规则分组、rules.yml 生成、Alertmanager 配置，职责过重。
- **结论**：
  1. **三轴正交拆分**：
     - **A. 规则内容创作**（expr / for / severity / labels / annotations / resource_type）：归属 **M01**（与 M01「采什么、怎么采、怎么判」的「怎么判」对齐）；
     - **B. 规则组织与交付**（分组、启停、版本、按网域生成 `rules.yml`）：归属 **M09**（配置唯一生成者，决策 10）；M09 内部按 Prometheus `group` 语法自动派生规则分组，MVP 不暴露用户可管理的 RuleGroup 实体；
     - **C. 告警收敛与分发**（Alertmanager：`alertmanager.yml`、路由、静默、抑制、接收人、通知状态）：归属 **M08**（M08 退回纯 Alertmanager 域，用户的原意）。
  2. **单一权威记录**：由 M01 的 `MonitoringRule` 持有规则内容字段；M08 的 `AlertingRule`/`RecordingRule`/`RuleGroup` 等模型删除，改为 `Receiver`/`Route`/`Silence`/`InhibitionRule`/`AlertmanagerConfigVersion` 等 Alertmanager 相关模型；M09 消费 `MonitoringRule` 生成 `rules.yml`。
  3. **规则编辑唯一入口在 M01**（页面名「监控规则编辑」/「判定规则编辑」，覆盖 alerting + recording）；M08 的规则视图只读，提供「前往 M01 编辑」跳转；M09 不暴露规则编辑 UI。
  4. **规则启用状态**：由 M01 `MonitoringRule.enabled` 字段表达，M09 在生成 `rules.yml` 时过滤（只包含 enabled=true 的规则）。
  5. **`alertmanager.yml` 由 M08 直接管理**：MVP 单域阶段 M08 写文件并触发 Alertmanager reload，不进入 M09 的 `ConfigDraft` / 配置变更确认流程；调整频繁、风险低（仅影响告警体验，不影响采集/规则求值）。
- **依据**：单一职责原则；M09 已是配置唯一生成者（决策 10）；M08 复用 Alertmanager 更适合收敛/分发（用户原意）；M01 的指标库 / PromQL 校验能力天然属于规则内容创作侧。
- **影响范围**：
  - M01 PRD v3.13：§1 边界说明、§3.2 规则编辑动线、§5.5 `MonitoringRule` 字段说明（`scope`/`enabled` 指向 M09）、§6 模块边界表、M01-OPS-06 用户故事、Change Log；
  - M08 PRD v1.3：模块名改为「告警收敛与通知管理」、全部章节重写、数据模型替换；
  - M09 PRD v1.32：§1/§3.3 增加规则组织与交付职责、§3.4 审批分级策略、§6.2 配置包结构删除 `alertmanager.yml`、Change Log；
  - 全局文档：Roadmap/功能架构/集成图/依赖链接中 M08 模块名与文件名同步更新。

### 已确认项

- [x] 规则内容创作归 M01，M08 退回纯 Alertmanager 收敛/分发域（用户确认）。
- [x] 规则组织 / 下发 `rules.yml` 归 M09，M08 不再生成 `rules.yml`（用户确认）。
- [x] 规则编辑唯一入口在 M01，M08 只读引用 + 跳转（用户确认）。
- [x] M08 模块名称改为「告警收敛与通知管理」，PRD 重写并同步文件重命名（用户确认）。
- [x] MVP 单域阶段 `alertmanager.yml` 由 M08 直写 reload，不进入 M09 审批（用户确认）。
- [x] M09 内部自动派生规则分组，MVP 不暴露 RuleGroup 用户实体（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待领导/业务评审）。
- [ ] v0.4+ 多网域边缘 `alertmanager.yml` 分发方式：由 M08 直接推送还是随 M09 配置包下发（MVP 阶段不讨论）。
- [ ] 全局 Roadmap/功能架构/集成图需人工复核 M08 新名称与职责边界是否已同步。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（v3.13）
- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`（v1.3）
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（v1.32）
- `docs/05-execution-records/module-08/design-decisions.md`
- `docs/05-execution-records/module-09/design-decisions.md`

---

### 决策 3.57：M01/M08/M09 告警规则职责按三轴重构（M08 退回纯 Alertmanager 收敛/分发域）

> 📅 日期：2026-08-15 ｜ 轮次：第二十三轮 M01/M08/M09 告警规则职责三轴重构

- **问题**：M01 5.5 `MonitoringRule` 与 M08 6.1 `AlertingRule`/`RecordingRule` 字段大面积重复（expr / duration / labels / annotations / scope / enabled），权威来源不清；M08 同时声明生成 `rules.yml`（M08 §4/5.1），与 M01 决策 10 的 Module_09 唯一配置生成者冲突；M01 与 M08 均出现「告警规则」命名，用户入口混淆。
- **结论**：
  1. 将规则相关职责拆为三根正交轴：
     - **A. 规则内容创作**（expr / for / severity / labels / annotations / resource_type）：归属 **M01**（与 M01「采什么、怎么采、怎么判」的「怎么判」对齐）；
     - **B. 规则组织与交付**（分组、启停、版本、按网域下发 `rules.yml`）：归属 **M09**（配置唯一生成者，决策 10；M08 不再生成 `rules.yml`）；
     - **C. 告警收敛与分发**（Alertmanager：`alertmanager.yml`、路由、静默、抑制、接收人、通知状态）：归属 **M08**（M08 退回纯 Alertmanager 域，用户的原意）。
  2. 单一权威记录：由 M01 的 `MonitoringRule` 持有规则内容字段；M08 的 `AlertingRule`/`RecordingRule` 不再重复内容字段，改为 **规则 ID 引用 + 组织/通知属性**（group_id、网域聚合、抑制、通知状态等）；`scope` 字段只保留在 M01 记录中，M08/M09 仅消费。
  3. 规则编辑唯一入口在 M01（页面名「监控规则编辑」/「判定规则编辑」，覆盖 alerting + recording）；M08 的规则视图只读，提供「前往 M01 编辑」跳转；M08 功能名称改为「告警收敛与通知管理」，明确与规则内容编辑无关。
  4. 规则编辑不在采集策略配置流程内触发，是独立创作流程，但依赖采集落地后的指标库；M01 可在采集 Job 详情 / 指标库提供「基于此建规则」快捷跳转，作为入口补充。
  5. 历史表述修正：M08 的「告警规则生命周期管理」中的分组 / 版本 / 下发能力转移给 M09 承担；M08 保留生命周期中与 Alertmanager 相关的部分（通知状态、静默启停、路由变更）。
- **依据**：单一职责原则；M09 已是配置唯一生成者（决策 10）；M08 复用 Alertmanager 更适合收敛/分发（用户原意）；M01 的指标库 / PromQL 校验能力天然属于内容创作侧。
- **影响范围**：M01 PRD 5.5（MonitoringRule 字段、scope、规则编辑动线）、术语映射；M08 PRD 全部（角色定位、边界表、数据模型、用户故事、功能表、实现方式、Change Log）；M09 PRD 需补规则分组 / 按网域下发模型（从 M08 迁入）；M02 PRD 代理 `/api/v1/alerts` 展示触发告警状态，保持不变。

### 已确认项（2026-08-15）

- [x] 规则内容创作归 M01，M08 退回纯 Alertmanager 收敛/分发域（用户确认）。
- [x] 规则组织 / 下发 `rules.yml` 归 M09，M08 不再生成 `rules.yml`（用户确认）。
- [x] 规则编辑唯一入口在 M01，M08 只读引用 + 跳转（用户确认）。
- [x] M08 模块名称改为「告警收敛与通知管理」（用户确认）。

### 仍待确认项

- 无（需同步修改 M01/M08/M09 PRD 与全局 Roadmap/术语映射）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/02-product-requirements/Modules/Module_02_Query_Center.md`


---

## 评审记录摘要

> 原「评审记录」四段走查 prose 已压缩为下表（结论与遗留项）。

| 日期 | 版本 | 评审结论 | 遗留项 |
| --- | --- | --- | --- |
| 2026-08-11 | v2.5 / 原型 v2.1 | 标签模板关联 UX：只读预览 + 跨模块跳转 + 模板 ID 为跨模块唯一 FK | 无 |
| 2026-08-11 | v2.6 / 原型 v2.2 | UI/UX：标签模板两行卡片 + 预览抽屉 + 表单紧凑卡片 | 原型 v2.2 待落地 |
| 2026-08-11 | v2.7 / 原型 v2.3 | 端口一致性三层解法 + 安装确认登记 actual_port（不编辑端口） | 实例级端口覆盖落地方式 v0.2 评估 |
| 2026-08-14 | v3.6 / 原型 v2.8 | MVP 单域动线闭环（运维 + 业务负责人双动线）评审通过 | 跨模块端到端串联演示 P2；filter/service_discovery UI 后续 |
| 2026-08-14 | v3.7 / 原型 v2.9 | 两库定位（技术/业务）+ 自定义微服务仍属 application_http + 业务视图独立成页 | 业务域聚合视图完整版 v0.2+ |
| 2026-08-21 | v3.26 / 原型 v3.25 | 采集认证/TLS 最小集、冻结网域校验、deployed 回写、规则文件挂载评审通过（含 1 返工：RulesPage Alert 术语裸暴露） | PRD v3.26 §9 内部表述统一（2026-09-05 终验闭环） |
| 2026-08-31 | v3.28 | ready 回归确认：PRD 状态 设计中 → ready（可开发版本） | 无 |

## 关联文档（汇总）


- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（PRD 主文档）
- `docs/prototypes/module-01/`（可点击原型）
- `docs/05-execution-records/module-01/dev-feedback.md`（开发反馈 F 系列）

## 遗留 / 待确认项汇总

> 原各轮「仍待确认项」中仍有效的条目归集如下（已落档/已关闭项已省略）。

- [ ] PRD 状态推进：保持「设计中」，待领导/业务评审书面确认后转 ready。
- [ ] 原型同步普遍滞后于 PRD（v3.0+ / v3.42 等多轮 PRD 已落版，原型待对齐），见各决策「待执行」注记。
- [ ] D8：资源层级/拓扑由 CMDB/APM 承载，需在 Module_07/Module_04 跨模块文档细化（v0.2+）。
- [ ] D5 方式②（download_url 结构化数组）v0.2+ 引入时需同步字段类型与后端契约。
- [ ] Module_07 LabelTemplate 创建流程需增加「稳定资源身份标签」提示（D7 约束落地）。
- [ ] v0.2+ 业务域聚合视图完整版（独立业务目录 + 健康度看板）详细设计待迭代（多轮遗留）。
- [ ] MVP demo 动线需显式避开规则编辑页（D27-1：规则编辑 UI = v0.3），以「采集 Job → M09 配置变更确认」演示闭环。
- [ ] 决策 47 开发侧影响：integration/v0.1 已按「未确认实例不生成 target」实现，闸门拆除需排期 rework。
- [ ] 决策 53/54 落地：filter 模式提前 v0.2 + Job 网域扇出，需 Module_01/09 PRD 与 Roadmap 同步。

## Change Log（完整历史）


> v2.4 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v3.18 及以前的逐版完整变更详情（业务沟通决策记录）。2026-08-18 结构改造后，PRD 仅保留 v3.19-v3.21 最近 3 版，v3.16 / v3.17 / v3.18 本轮补迁入本表；此后历次轮转迁出的版本（如 v3.37 / v3.38 / v3.39）亦按「自 PRD Change Log 轮转迁入」标注并入本表（v3.39 于 2026-09-15 v3.42 落版后补迁）。 v3.44 于 2026-09-18 v3.47 落版后自 PRD Change Log 轮转迁入本表。
| 版本   | 日期         | 变更类型 | 变更内容                                                                                                                                                                   | 影响范围                | 产品版本影响            | 状态    |
| ---- | ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------- | ----- |
| v3.44 | 2026-09-16 | 文档 | 按 prototype-designer 规范「核心章节形态纪律 T6」对 §1/§3/§5/§6 做章节形态归位：拍平第 1/3/5/6 章大段引用块为正文（去 `>` 前缀，保字段表、枚举值、优先级、`{P0}/{v0.x}` 标记与各章「决策依据」行逐字不变），消除「大段说明与释义字体凌乱」观感；不改任何模型、接口与功能结论。（2026-09-18 v3.47 落版后自 PRD Change Log 轮转迁入） | 1 / 3 / 5 / 6 | 文档自身 | 使用中 |
| v3.39 | 2026-09-09 | 修改 | 规则 job 引用校验双层模型（决策 66）：§3.1「规则文件挂载」补充编辑期 job 引用语义校验（`up`/`absent(up)` 不匹配 = error，其他 = warning；提示不阻断保存）；§3.2 PromQL 校验行扩展为「PromQL 校验 + job 引用校验」；新增「双层校验模型（M01 编辑期提示 + M09 发布期门禁）」与「推荐先 Job 后规则、但不强制」注记（2026-09-15 v3.42 落版后自 PRD Change Log 轮转迁入） | 3.1 / 3.2 | 文档自身 | 设计中 |
| v3.38 | 2026-09-09 | 修改 | 规则粒度与模块边界对齐（决策 65）：§3.2 新增「规则粒度说明」注记与 per-instance 规则模板行（P1/v0.3）；§5.5 新增「规则粒度与前端展示」对照表——聚合规则（如 `absent(up{job=...})`）无 instance 标签，告警 instance 列显示「全局/聚合」，per-instance 规则（如 `up{job=...} == 0`）携带 instance 标签，显示故障实例 IP/名称；规则编辑入口归本模块（MVP yaml_passthrough，v0.3 字段化），per-instance 可视化编辑归 v0.3 规则 UI（自 PRD Change Log 轮转迁入） | 3.2 / 5.5 | 文档自身 | 设计中 |
| v3.37 | 2026-09-05 | 修改 | 开发反馈 F-37 契约落版（design 补齐，与生产实现对齐）：「采集 Job」/「规则编辑」列表「状态」聚合列拆分为「生效状态」（用户视角生命周期四态）+「变更进度」（M09 管线视角 change_status 四枚举映射）两列，列序 间隔→生效状态→变更进度→参数同步，两列均带列头 Tooltip 角标（含批量确认口径）；§5.4 下发状态感知、§9 验收同步修订；§9 / §10 残留的「v0.2 起扩展 deployed」旧表述按决策 31-M2 统一为「MVP 回写 pending/confirmed/none/deployed」；原型 module-01 同步（{v3.37}）（自 PRD Change Log 轮转迁入） | 5.4 / 9 / 10 | 文档自身 | 设计中 |
| v3.33 | 2026-09-04 | 修改 | §0「需求背景与典型场景」深化：基于 dev-feedback 与 design-decisions 真实记录，新增「用户需求的演进过程」（接入期→配置期→联调期→优化期）与 6 个真实场景（含来源标注）；将抽象功能描述转化为循序渐进的业务叙事 | 0 | 文档自身 | 设计中 |
| v3.32 | 2026-09-04 | 新增 | 补充 §0「需求背景与典型场景」：面向产品经理/新工程师的业务叙事层，包含模块痛点、3 个典型场景（批量接入/参数调整/规则管理）与涉及用户故事编码索引；不改变技术契约 | 0 | 文档自身 | 设计中 |
| v3.31 | 2026-09-04 | 修改 | 开发反馈 F-32 落版：采集器登记来源由「仅 `internal` 开放」修正为 **MVP 即开放 `official` / `third_party` / `internal` 三种来源**——解决同一监控对象类型下用户需选用社区/厂商采集器作为备选的场景，名称与平台预置 seed 冲突时由唯一索引返回 409 Conflict；同步更新 §3.1 动线引导、§5.2 字段表与来源口径说明、§9.1 技术验收、§10 术语映射 | 3.1 / 5.2 / 9.1 / 10 | MVP | 设计中 |
| v3.30 | 2026-09-02 | 修改 | v0.2 范围收敛决策落版：①**克隆 Job 移出 v0.2 范围**，后续版本再评估是否提供（决策 54 网域集合 + M09 按域扇出已覆盖跨网域复用主场景）——§3.1 克隆行 / §5.4 / §6.2.2 clone 接口 / §9 验收 / §10 术语 / §11 前端契约同步标注 {v0.3+ 待评估}；②**草稿与批量提交生效交互挪 v0.3**（`draft_status` / `ready` 字段本身 MVP 已落库、默认 `ready` 不变，挪移的仅是「开放用户保存草稿 + 批量提交生效」UI/交互能力）——§3.1 / §5.4 / §8 ⑤ / §9 / §10 / §11 同步；③**业务健康度看板 / 业务负责人角色入口 / 业务域聚合视图**由 v0.2+ 挪 v0.3+——§2 M01-BIZ-02 / §3.1 / §5.9 / §10 同步；④**`service_discovery` 服务模式降级 v0.3+ 预留**——v0.2 容器实例资源监控明确走 cAdvisor 方案（每台虚机部署 cAdvisor exporter，作为普通采集 Job 绑定主机类资源 + filter 模式自动纳入新主机，容器发现由 cAdvisor 在宿主机内部完成、平台不感知容器个体，不需要 docker_sd），`docker_sd_configs` / `kubernetes_sd_configs` 仅当需直采容器内应用 /metrics（容器已发布端口或 host network）时在 v0.3+ 启用；⑤filter（决策 53）/ Job 多网域绑定 + M09 扇出（决策 54）/ 网域覆盖表 `CITypeExporterMappingOverride` 维持 v0.2 不变；⑥**新增实例级端口覆盖 v0.2 落地**——M07 Resource 增加可选 `scrape_port`，M09 端口解析优先级 = `Resource.scrape_port` → 网域覆盖表 → 映射默认（回落 `ExporterTemplate.default_port`），明确「Job 级端口映射表不做」（与动态纳入模式冲突、相关组织场景经确认不存在），§9.1 新增 {P0 / v0.2} 验收 | 2 / 3.1 / 5.1 / 5.4 / 5.6 / 5.9 / 6 / 8 / 9 / 10 / 11 | v0.2 / v0.3 | 设计中 |
| v3.29 | 2026-09-02 | 修改 | coverage 口径修订 + 默认模板身份标签收紧（联动 M02 v1.8 / M07 v2.25）：①§5.10 行为规则新增「与 coverage 三态的边界」——coverage/M07 badge 不感知 M09 下发时序、不区分「待采集」，「待采集 vs 已下发未采到」细分仅由本模块 Job 回显承担（本模块持有 `change_status`）；②§9.1 默认标签模板稳定身份标签验收由「`resource_id` / `hostname` 二选一」收紧为**必须含 `resource_id`**（决策 47-3 coverage 回连键，`hostname` 仅为可读别名）；纯契约收紧，原型行为不变 | 5.10 / 9.1 | MVP | 设计中 |
| v3.27 | 2026-08-28 | 修改 | 决策 47 落版（采集状态回显前置）：①**安装确认拆闸门**（47-1）——§5.6 安装确认降级为可选登记（留痕/背书定位不变，`actual_port` 仍挂登记表单），`unconfirmed` 不再阻断 target 生成，§9.1 原「未确认实例不生成 target」验收改写、§9.2 新增「M09 不再过滤未登记实例」；②**Job 实例采集状态回显**（47-2）——新增 §5.10 + §8 ⑥ 状态机：实例状态列（待采集/up/down/unknown）+ 在线数/待采集汇总 + down 提醒文案，数据源 = M02 `/api/v1/targets` 代理（只读，不直连 Prometheus），§3.1 功能行 / §6.1 接口 / §9.1 验收 / §10 术语 / §11 前端契约同步；③M07 badge 三态化（47-3）跨模块口径同步（§7.2 边界表、§9.1 M07 badge 验收）；④M01-OPS-04 改写 + 新增 M01-OPS-08、M01-ARCH-01 落点改指 M07 三态 badge；原型待对齐（头部原型版本标注未对齐） | MVP / v0.2 / v0.3 | MVP / v0.2 | 设计中 |
| v3.26 | 2026-08-21 | 修改 | 决策 30/31 落版：①采集认证/TLS 最小集（决策 31，MVP 必实现）——ScrapeJob 新增 `auth_type`（none/basic/bearer，默认 none）/`username`/`password`/`token`/`tls_skip_verify`（默认 false）/`ca_file`，全部可选、默认无认证；§5.4 字段表、§6.2.2 POST/PUT 错误契约（认证/TLS 组合校验）、§11.2 表单「认证与 TLS」折叠面板、§9 P0 验收同步，M09 configgen 透明映射 `basic_auth`/`authorization`/`tls_config`；②网域冻结校验（决策 30）——冻结网域禁止新建 Job、存量 Job 禁止新增该域实例（允许移除/禁用/编辑），§5.4 网域约束 + §6.2.2 + §9 P0 验收；③`change_status=deployed` 回写提前到 MVP（决策 31-M2），M09 依据 ConfigDeployment success 回写 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.25 | 2026-08-21 | 修改 | `offline` 排除提级 MVP 必实现（决策 29）：①§3.1「实例选择」行与实例选择方式说明——候选集中 `Resource.status=offline` 实例**显示但置灰不可选**（保证下线台账可见、不可勾选），删除「MVP 不保证」表述；②§5.4 实例候选自动收敛新增「`offline` 实例显示但置灰不可选」条款，已选实例转 `offline` 后 M09 配置生成跳过；③§8 状态语义将 `offline` 排除提级 MVP 必实现（`maintenance` 排除口径仍与 Module_07 8.1 一并对齐、MVP 不保证）；④§9 验收新增「实例候选集中 offline 实例显示但置灰不可选」P0 验收项；本轮为 PRD 契约落版，不涉及原型行为变更 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.24 | 2026-08-20 | 新增 | **规则进入 M09 配置下发闭环**（解决手写 `rules.yml` 绕过 M09 的契约空白）：新增「规则文件挂载」——MVP 通过「规则编辑」页上传/粘贴完整 `rules.yml`（整文件透传 `content_mode=yaml_passthrough` + `rule_content`）落库 `MonitoringRule`，YAML 校验（至少 `groups` 存在且为数组）后保存即 `draft_status=ready`；规则保存/启停/删除触发 M09 变更检测 → 生成 `rules.yml` → 变更单**人工确认**（决策 38-1）→ 下发，回写 `change_status`，与采集 Job 同源同机制；`MonitoringRule` 新增 `content_mode` / `rule_content` / `change_status` 字段，新增 6.2.4 规则 CRUD 契约，3.1 新增功能行、5.5 修订模型、9 验收与 11 前端契约同步；v0.3 升级为 `structured` 字段化编辑 UI | MVP / v0.3 / v1.0 | 设计中 |
| v3.23 | 2026-08-19 | 修改 | 回写跨模块契约（Module_07 8.1 / 第三轮评审 K 组）：`offline` / `maintenance` 排除与「未纳入任何 Job」筛选器声明为**目标语义、MVP 不保证、随本模块节奏落地**——①§3.1「实例选择」行与实例选择方式说明补 `offline` 候选集排除 + 已选实例转 `offline` 后 M09 生成跳过；②M01-ARCH-01 更新为实例选择器「未纳入任何 Job」筛选（原 M07 已监控/未监控 badge 已随 is_monitored 取消；不落 M01 则改指 M02 目标状态页）；本轮为契约声明，不涉及原型行为变更 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.22 | 2026-08-18 | 新增 | 采集 Job / 规则草稿（仅新建阶段，单向 draft→ready，不做快照）与批量提交生效方案；克隆 Job（同网域 / 跨网域一次性复制，不引入模板实体）；新增 `draft_status` / `change_status` 字段与状态机；Job 草稿、批量提交生效与克隆归 v0.2；规则草稿归 v0.3；MVP 阶段状态列按四态占位展示（草稿标签灰显、筛选禁用）；M09 `change_status` 扩展为 `pending/confirmed/deployed/none` | MVP / v0.2 / v0.3 | 设计中 |
| v3.21 | 2026-08-18 | 结构改造 | 按 prototype-designer.md 冻结骨架（章节 1-11 编号冻结）重构：正文本体去演变标注（移除 `{v3.x}` / `{v3.x} 更名` / `（决策 N）` / `（v3.x）` 等 PRD 演变标注）；每章开头保留一行决策依据引用；新增第 11 章「前端交互契约」；Change Log 精简为最近 3 版，完整历史已迁移至 design-decisions.md | 文档自身 | 设计中 |
| v3.20 | 2026-08-17 | 修改 | 规则编辑引导确认（第三十轮需求对齐，决策 D28，与 M09 决策 38 联动） | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.18 | 2026-08-16 | 修改 | 标签模板补配入口收敛 + D25-A 分组展示（第二十八轮需求对齐，决策 D26）：①补配统一动作 = 打开该监控对象类型映射行的编辑抽屉（触发点 1｜Job 表单 Alert 带 `?view=collectors&edit=<mapping_id>` 落位即开；触发点 2｜映射列表「补配」按钮 /「待配置」badge 同页直开，修复空跳转）；②M07 创建入口收敛（「前往标签模板管理」从 Job 表单 Alert 拿掉，仅保留抽屉内选择器空态）；③Alert 文案按缺口类型区分（映射未关联模板 →「立即补配」/ 类别下无模板 →「前往创建模板」）；④软引导不阻塞保存（warning Alert、不升必填）；⑤预设抽屉「默认标签模板（可选）」用 Divider 与采集参数隔开 | 5.1/5.4/8.1 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.17 | 2026-08-16 | 修改 | 标签模板三环节定位澄清（第二十七轮需求对齐，决策 D25，A+C+D）：①正交关系定性（标签模板与采集器正交，`label_template_id` = 默认模板，非强关联非必填）；②A｜预设抽屉补「默认标签模板（可选）」字段（按资源类别过滤候选）；③C｜Job 动线自动预填 = 映射默认模板 → 兜底同类别 `is_default` 模板，概要行显性说明可更换；④D｜选择器按「资源类别」过滤（类别驱动候选、类型驱动默认） | 5.1/5.4/5.5 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.16 | 2026-08-16 | 修改 | 术语分层与字段改名（第二十六轮需求对齐，决策 D24）：①M01 `resource_type` → `monitor_type`（字段表 / API / 数据模型 / 术语映射）；②`CI_TYPE_CATEGORY_MAP` → `MONITOR_TYPE_DERIVATION_MAP`（监控对象类型推导表）；③「CI 类型」→「监控对象类型」（M01 上下文，「CI 类型」仅保留在 CMDB/M04 上下文）；④M07 `Resource.resource_type`（粗粒度）→ `resource_category`；⑤M04 映射表三列完整推导链（CI 类型只读 → 资源类别+子类型 → 监控对象类型只读）；⑥全局架构补「术语归属与禁用规则」小节 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.15 | 2026-08-16 | 修改 | 五大类拆分 + 原型检查问题收敛（第二十五轮需求对齐，决策 D17-D23，自 PRD Change Log 轮转迁入）：①5.1 五大类（host/database/middleware/application/generic_target）+ 归类规则 + 达梦示例行（v0.4+）；②空态引导补 D17（登记携带发起上下文：预填 CI 类型 + 保存后回选）；③字段表删映射行 `install_guide` 改只读透传（D20）；④5.2 登记表单支持上下文预填（D17）；⑤3.1 采集器管理 Tab 补 D22（列表 = 映射 + 池全貌，未引用标记）；⑥5.4 blackbox 补 D21（留空，统计按 job_type）；⑦标签模板锚点粒度修订（按资源类别过滤、默认模板标记到 CI 类型，D18）；⑧术语映射补 database/database_type；⑨8.1 新增 4 条验收；⑩全局补 D23 | 5.1/5.2/5.4/3.1/8.1/术语映射 | MVP / v0.2 / v0.4 / v1.0 | 设计中 |
| v3.12 | 2026-08-15 | 修改 | 采集器动线统一 + M01 网域呈现收敛（第二十二轮需求对齐，自 PRD Change Log 轮转迁入）：①5.2 `ExporterTemplate` 新增 `source`（official/third_party/internal）、登记表单按来源引导；「预置参数 = 官方默认值参考」；②决策 3.54 登记即入池；`application_http` 引导卡；③决策 3.55 ScrapeJob 绑网域 = 技术约束；④决策 3.56 撤掉 M01 顶部全局网域切换器，改列表网域查询条件 + 表单必填；⑤5.1/5.2/5.4/8.1/8.2/术语映射同步 | 全部 | MVP / v0.2 | 设计中 |
| v3.5 | 2026-08-14 | 新增 | 业务指标库（第十四轮需求讨论，解决职责断开）：新增 5.9 业务指标库（BusinessMetric）实体——业务负责人定义指标语义/阈值/所属业务域/负责人（owner 必填）、运维消费落地采集并标记「已上线」；与 ExporterMetricLibrary（技术指标库）并列；状态机 pending→instrumented→online；3.1 功能表新增业务指标库行（MVP 最小登记表 / v0.2+ 独立业务负责人入口 + 看板）；全局故事库回写 M01-BIZ-01/02 + 第 2 章引用；8 验收 2 条；术语映射补 BusinessMetric | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.4 | 2026-08-14 | 修改 | 跨模块对齐（第十三轮需求讨论，与 Module_07 v2.8 / Module_04 对齐）：5.1 新增 application_http 语义澄清（业务指标端点 HTTP 抓取模板、非独立 exporter、默认模板含 app/biz 映射即机制 A 落地）+ v0.4 新 CI 类型引导闭环（CMDB 待分类队列 → 映射创建引导）；5.4 新增 filter 模式字段语义（v0.3+ 筛选字段 = Resource 属性字段、label 仅 UI 别名自动派生、不用 label 名做筛选键防模板漂移）+ v0.2+ service_discovery 模式预留（微服务动态实例，prometheus_builtin + relabel，映射模板复用）；3.1 实例选择行补充；8.2 新增 2 条技术验收。评审前完善：Roadmap §1.5 登记 filter/service_discovery + application_http；术语映射补 instance_filter/service_discovery/application_http；骨架补齐（4 核心流程、5.9 状态机、6.1 接口设计）；全局故事库注册 M01-OPS-07 + 第 2 章引用 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.3 | 2026-08-13 | 修改 | 标签选择两情形引导（用户反馈 + 需求对齐）：5.1 新增「{v3.3} 标签选择两情形引导」——选择器按 CI 类型严格过滤（仅同类型模板）、无模板空态 + 内联创建按钮、有模板提示「直接选择即可」、默认模板 Tag 标记、创建引导文案强化「新增 CI 类型」语义；8.1 新增 4 条验收项；原型同步 v2.7 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.2 | 2026-08-12 | 修改 | 标签配置引导落地（用户反馈 + 原型对齐）：mock 新增 nginx 无标签模板映射与引用它的 Job（演示「待配置」链路）；Job 表单无模板时主引导改为「前往 CI-Exporter 映射补配（自动继承）」；Job 列表/详情新增「标签待配置」提示；映射页「待配置」Badge 可点击补配 + 操作列补配按钮；引导文案口径修正（平台资源字段，非 CMDB） | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v3.0 | 2026-08-11 | 修改 | 实例选择增强（第七轮需求讨论，与 Module_07 v2.3 对齐）：5.2 补充「实例候选自动收敛」——选定类型+网域后候选收敛为同类型同网域资源，支持一键全选/反选与关键字筛选（MVP，比 v0.3+ filter 轻）；3.1 功能表与验收标准同步 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.9 | 2026-08-11 | 修改 | 标签模板引用语义澄清（与 Module_07 v2.2 标签治理对齐）：「允许覆盖」= 允许 Job 换用其他模板（引用级），不提供 Job 内标签编辑；标签内容编辑唯一入口在 Module_07；不引入实例级模板 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.8 | 2026-08-11 | 修改 | UI/UX 易用性优化（决策 34/35/36）：5.4 补充参数继承来源视觉标记说明（三层 Tag：继承自映射/已覆盖/待同步）；5.5 补充 labels/annotations 语义区分与必填状态说明（告警标签 vs 目标标签、推荐 key、模板变量）；术语映射新增 `MonitoringRule.labels`/`annotations`/`LabelTemplate` 标签三层区分；验收标准新增继承标记、语义卡片、Drawer 改造条目；原型待同步 v2.4 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.7 | 2026-08-11 | 修改 | 端口一致性说明（与 Module_07 v1.9 对齐）：映射 default_port 决定 instance 端口，三层解法（映射层可编辑 MVP / 网域覆盖 v0.2 / 实例级端口覆盖 v0.2+ 建议）；安装确认新增 actual_port 登记（P1）仅提示不自动改，明确不承担端口编辑；原型待同步 v2.3 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.6 | 2026-08-11 | 修改 | 标签模板展示样式落地（与 Module_07 v1.8 对齐）：映射列表「标签模板」列改两行卡片（名称+默认标记 / 类别·模板ID）、点击模板名打开只读预览抽屉、表单内预览改紧凑卡片替代 Tag 堆砌；原型待同步 v2.2 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.5 | 2026-08-11 | 修改 | 标签模板关联体验补齐（与 Module_07 v1.7 对齐）：模板以「名称（类别 / 模板ID）」展示，选择后内联只读预览映射内容 + 跨模块跳转；模板 ID 明确为跨模块唯一 FK | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.4 | 2026-08-07 | 修改 | 按 prototype-designer PRD 骨架规范补齐：第 2 章用户故事引用全局库（M01- 编码）、5.x 字段表加「UI 展示名」列、验收标准分层（8.1 用户 / 8.2 技术）+ P0/P1 标注、新增「术语映射」章节、Change Log 精简（完整历史迁移 design-decisions.md） | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
| v2.3 | 2026-08-07 | 新增 | 补充「提示分区规范」章节 + 原型清理用户可见文案中决策/PRD 引用 + MainLayout 全局折叠区 | 全部 | 文档自身 | 设计中 |
| v2.2 | 2026-08-06 | 修改 | 规则编辑 UI 版本调整至 v0.3（与 Module_02 v1.2 / 路线图 2.4 对齐），5.5 新增 `MonitoringRule` MVP 预留说明 | 全部 | MVP / v0.2 / v0.3 / v1.0 | 设计中 |
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


---

