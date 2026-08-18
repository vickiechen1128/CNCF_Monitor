# MetricCenter Module 01 原型

> **验证的 PRD 版本**: [Module_01_Metric_Collection_Center.md](../../02-product-requirements/Modules/Module_01_Metric_Collection_Center.md) v3.22
> **覆盖的产品版本**: MVP / v0.2 / v0.3 / v1.0
> **原型版本**: v3.22
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-01
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5175/

## 本次 v3.22 相对 v3.20 的关键变更（自 v3.14 起多轮原型变更累计，v3.22 = 草稿/克隆/批量提交 + 乐观更新闭环）

- **{v3.22} 状态列四态聚合（决策 D29 原型侧）**：采集 Job 列表「状态」列聚合四态（草稿 / 待下发 / 已生效 / 已停用）——MVP 无真实草稿实例，草稿标签灰显 + Tooltip「v0.2 支持保存草稿」；状态查询器中「草稿」选项置灰禁用（v0.2 支持保存草稿）。
- **{v3.22} 乐观更新 toast（决策 D29 原型侧）**：保存 / 启停 / 删除成功的 toast 改为乐观更新——本地先把该 Job / 规则标为「待下发」，附「前往配置变更确认」跳转（M09），不再等待服务端确认。
- **{v3.22} 克隆 Job（v0.2 角标，决策 D29 原型侧）**：操作列新增「克隆」——点击打开新建抽屉并预填源 Job 参数；演示两条路径：同网域克隆直接改选实例分组；跨网域克隆网域重选、实例清空重选、提示「安装确认需重新进行」。
- **{v3.22} 多选 + 批量提交生效（v0.2 角标，决策 D29 原型侧）**：Job 列表支持多选，toolbar「批量提交生效」一键提交，弹结果抽屉成功 N 条 / 失败 N 条逐错误清单（草稿不可勾选）。
- **{v3.22} Job / 规则表单双按钮（决策 D29 原型侧）**：「保存草稿（v0.2，基础校验，草稿不入下发管线）/ 提交生效（完整校验）」。Job 保存草稿后表单保持打开；提交生效失败时 Alert 置顶逐条错误。规则页（v0.3 预览）草稿允许 PromQL 半成品暂存，提交生效失败错误定位到 expr 字段下方。
- **{v3.22} mock 数据补 draft_status / change_status**：Job / 规则对象补 `draft_status`、`change_status` 字段；新增 1-2 条 `draft_status=draft` 草稿演示数据与 1 条克隆演示数据（跨网域克隆 `prod-hosts-linux-gov-clone`）；MVP 演示态下 `change_status` 仅用 pending / confirmed / none。
- **{v3.20} 规则编辑引导确认（决策 D28）**：规则保存 / 启停 / 删除成功提示改为「变更将由 M09 生成变更单，需确认后生效」+ 内联「前往配置变更确认」跳转（rules.yml 变更必须 reload、走 M09 人工确认档，决策 38-1）；规则列表新增「下发状态」列（待确认 / 已确认 / 无变更，mock 以 `change_status` 承载，rule-001 已确认 / rule-004 待确认演示）；保存 / 启停 / 删除后规则置「待确认」。
- **{v3.19} 下发状态感知（决策 D27-2）**：采集 Job 列表新增「下发状态」列（待确认 / 已确认 / 无变更，来自 M09 变更单状态，mock 以 `change_status` 承载）；保存 / 启停 / 删除成功提示改为「变更将由 M09 生成变更单，需确认后生效」+ 内联「前往配置变更确认」跳转（跨模块链接 module-09）；保存 / 启停 / 删除后 Job 置「待确认」；支持 URL 预选网域（`?view=jobs&network_domain=<id>`，供 M09「去配置采集 Job」跳转）；`currentTenant.multi_site_enabled=false`（单域 MVP 演示）。
- **对齐 PRD v3.13**：主机 CI 类型按 OS 平台拆分为 `host_linux` / `host_windows`；ExporterTemplate 增加 `os`、`arch`、`download_url`、`homepage`、`source`（official / third_party / internal）字段与对应 mock 数据。
- **网域呈现收敛（v3.12）**：移除顶部全局网域切换器 / 多网域开关；Header 仅保留角色切换器，网域作为采集 Job 列表查询条件与 Job 表单必填字段。
- **采集器管理增强**：增加 `application_http` 引导卡、按 CI 类型 + 来源筛选、「登记采集器」Modal（自研采集器登记后进入 `exporterTemplates` 池）。
- **规则生命周期职责明确**：规则 CRUD 归属 M01，`rules.yml` 生成与下发归属 M09，告警收敛（启用/禁用/分组/静默/路由）归属 M08。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-01
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-01
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-01/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 01: 监控策略与指标管理](../../02-product-requirements/Modules/Module_01_Metric_Collection_Center.md) 的核心交互：

1. **采集器管理（{v3.8} 入口合一，导航「采集」分组子项 + 采集 Job 页内下拉视图）**：每个 CI 类型的默认采集器 + 采集参数 + 安装指南预设（采集实现层，每 CI 类型可多行、`is_default` 标记默认）；导航「**采集**」父分组下「**采集器管理**」/「**采集 Job**」子项（样式对齐指标库分组，`?view=` 区分，采集器管理默认、安装动线起点），页内下拉切换视图；安装指南 Popover 明显展示（**类型级采集器指引**：该装什么、怎么装）；创建 Job 时选 CI 类型自动套用默认值（决策 14）；**实例级安装确认在选实例时进行（5.6），此处不做确认避免重复**。**标签模板关联**：预设列表「标签模板」列以两行卡片展示（名称+默认/自定义标记 / 类别·模板ID），点击模板名打开只读预览抽屉查看映射明细；表单内选中模板后以紧凑卡片展示映射，并提供「前往标签模板管理」跨模块跳转（模板 CRUD 归属 Module_07）。
2. **采集 Job 管理**：Job 增/改/删，关联 CI 类型、默认采集器（{v3.8}，可空手填模式）、网域；CI 类型两级级联选择（先选资源类别，再选 MySQL/Redis 等细粒度类型，选中后自动带出映射默认采集器，可换/可空手填采集参数）；`job_type=standard/blackbox`，blackbox 拨测目标内嵌在 Job 中（`BlackboxTarget[]` 对象数组：target / protocol / url）；实例选择 MVP 手动勾选，v0.3+ 预留 `instance_filter`；Exporter 安装确认（点状态徽标循环 + 弹窗填确认人/备注/实际监听端口 `actual_port` {P1}）；**详情只读视图**（列表「详情」按钮打开只读 Descriptions，区分编辑抽屉）；**参数继承与同步演示**：创建 Job 时从 CI 类型默认采集器继承默认参数（间隔/超时/路径/协议/标签模板）并快照，用户手动修改过的字段记录到 `mapping_overrides`；映射默认值变更后 Job 列表显示「映射默认值已变更」Tag、编辑抽屉提供「同步映射默认值」按钮手动刷新（**仅刷新未手动覆盖字段，覆盖字段保持用户值**）。
3. **规则编辑**：告警 / 记录规则编辑，`rule_type=recording` 时隐藏 `duration` 与 `annotations`；Labels/Annotations key-value 动态表单；资源类型两级级联选择，选中 CI 类型后自动带出映射默认采集器（可覆盖）；PromQL 保存前强制校验，expr 引用的指标必须存在于指标库（失败给具体错误如「未知指标名 xxx」；{v3.8} 按 CI 类型校验，同名指标显示来源区分）；指标库数据基于**当前页面状态**（用户新增/禁用实时生效）；{v3.8} 选中 CI 类型后按该类型指标集过滤预览；P1「规则模板一键填充」占位按钮。**{v3.13} 规则生命周期职责拆分**：M01 负责规则 CRUD 与 PromQL 语义校验；M09 将规则渲染为对应网域的 `rules.yml` 并下发；M08 负责启用/禁用、分组、静默、Alertmanager 路由与告警收敛。
4. **技术指标库（{v3.7 改名}/{v3.8 锚点演进}）**：**按 CI 类型分组**（主锚点 = `MetricLibraryItem.resource_types`，多对多、关联带来源采集器标注；可选语义域 `category` 筛选）；支持「资源类别 → CI 类型」两级筛选与 metric_type / 语义域筛选；新增/编辑用户扩展指标（`is_builtin=false`，表单选「所属 CI 类型」多选 + 来源采集器 + 语义域）；内置指标禁止编辑/删除；`enabled` 切换（禁用指标不参与规则提示）；MVP 内置库只读，必须先有指标库才能编写 PromQL；顶部说明两库关系（技术元数据「能采到什么」 vs 业务语义契约「业务关心什么」）并提供跳转业务指标库。
5. **业务指标库（{v3.5}/{v3.6}/{v3.7}）**：业务指标（BusinessMetric）登记与状态推进；**两角色动线**（Header 角色切换器演示）——业务负责人：登记/更新业务指标（语义/阈值/业务域/负责人必填）、标记埋点完成（pending→instrumented），不配置采集任务；运维工程师：可查看全部指标库、配置采集任务，业务指标语义只读、确认采集上线（instrumented→online）、可代办登记（`register_source=agent`，owner 仍指向业务负责人）。状态机 pending→instrumented→online 按职责分工推进。登记表补「采集落地」列（online 显示关联采集 Job / 指标可查）。
6. **业务视图（{v3.7} 独立页，导航「指标库 → 业务视图」）**：按 business_domain 聚合成员（微服务/中间件/主机，Resource.business_domain 归并）+ 业务指标 + 埋点/采集落地状态（MVP 轻量版，完整版 v0.2+ 独立业务目录 + 健康度看板）；与业务指标库登记表职责分离（登记表 = 语义契约维护，本页 = 业务域聚合视图）。
7. **单网域/多网域模式 + 当前网域上下文（{v3.1}/{v3.12}）**：{v3.12} 网域呈现收敛后，Header 不再放置全局网域切换器 / 多网域开关，仅保留角色切换器；网域作为**采集 Job 列表的查询条件**（`listDomainFilter`），下拉仅展示已纳管监控的网域（`NetworkDomain.is_monitored=true`）。创建 / 编辑 Job 时 `network_domain_id` 为必填字段，仅允许选择已纳管网域，未纳管网域提示先到 Module_09 完成纳管。多网域租户仍可在 Job 维度绑定 default / 边缘网域，单网域租户由后端固定为 default 管理域。
8. **{v3.4}/{v3.7}/{v3.8} application_http 语义**：CI 类型 ↔ 默认采集器页对 `application_http`（HTTP 应用）显性提示「业务服务（含自定义微服务）仍属 application_http，用手填采集参数 / 多个可选采集实现覆盖形态差异，无需新增 CI 类型」（表单 extra + 页面 Alert）；采集 Job 实例选择新增「按业务类型（biz）筛选」（筛选字段 = Resource 属性字段 `business_domain`，label 名作 UI 别名）。
9. **{v3.7}/{v3.8} 自定义微服务样本（采集实现）**：mock 提供采集实现 `et-app-go`（Go 微服务指标端点，is_builtin=false、/metrics、端口 9090）+ 映射 `map-009`（application_http → et-app-go，is_builtin=false、非默认采集实现）+ 采集 Job `job-007`（prod-go-microservices，引用 order-go-service 实例）+ 指标库 `goAppMetrics`（go_goroutines / go_memstats_alloc_bytes / order_creation_total，挂 application_http + 来源标注），演示「业务服务仍属 application_http、多个采集实现 + 手填参数覆盖形态差异」的完整采集链路；自定义指标直接挂 CI 类型（无「Exporter 市场」登记概念，{v3.8} 删占位入口）。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | `docs/prototypes/module-07/` |
| 监控策略 | Module_01 | MVP | 当前原型 |
| 配置中心 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |
| 指标查询 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警状态 | Module_08 | v0.3 | `docs/prototypes/module-08/` |
| 系统设置 | Module_06 / Module_04 | v0.4+ | `docs/prototypes/module-06/` |

> 本原型在左侧导航中保留上述入口的占位（disabled + Tooltip），避免模块原型成为孤岛；运行时状态（last_scrape / last_error / probe 值）由 Module_02 负责，不在本原型展示。

## 模块边界标注

- **Resource / LabelTemplate**：由 Module_07 提供，本模块只读引用（通过下拉选择）。
- **网域 / 配置下发**：网域（NetworkDomain）由 Module_09 维护，本模块选择引用；所有 ScrapeJob 必须绑定单一网域，实例选择已按网域过滤。Job 保存后由 Module_09 通过异步轮询（pull 模式）感知变更并生成对应网域的配置草稿，Module_01 不直接触发下发。
- **PromQL 校验 / 指标预览样本**：依赖 Module_02 / Prometheus；当前原型以本地静态指标库模拟校验。
- **规则生命周期**：规则保存后由 Module_08 接管（启用/禁用、分组、静默、Alertmanager 路由、告警状态）。
- **运行时状态**：`ScrapeTarget`、`ScrapeLog`、`probe_success` / `probe_duration` 等运行时数据由 Module_02 展示；本原型仅展示其静态指标定义（如 `m-013 probe_success` 是合法指标定义，非运行时状态）。

## 核心页面

- `/scrape-jobs`：采集 Job 管理（导航「采集」分组 → 子项「采集器管理」/「采集 Job」，页内下拉切换视图（样式对齐指标库筛选）——采集器管理默认（类型级采集器指引 + 安装指南 + 预设维护，安装动线起点）/ 采集 Job（Transfer 实例选择 + Exporter 安装确认，{v3.8} 入口合一））
- `/rules`：告警 / 记录规则编辑（PromQL 校验 + 指标预览 + Labels/Annotations key-value 动态表单；{v3.8} 按 CI 类型指标集提示）
- `/metric-library`：技术指标库（按 CI 类型分组 + 来源采集器标注 + 语义域筛选 + 用户扩展，{v3.8}）
- `/business-metrics`：业务指标库（登记表：登记/代办登记 + 采集落地列 + 状态推进；Header 角色切换器演示业务负责人 / 运维两动线）
- `/business-view`：业务视图（独立页，按 business_domain 聚合成员 + 业务指标 + 埋点状态；导航「指标库 → 业务视图」）

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；CRUD 操作通过 `useState` 维护列表，刷新后回滚到 mock 初始值。
- `instance_selection_mode=filter` 为 v0.3+ 预留，MVP 仅支持手动勾选（`instance_filter` 恒为 `null`）。
- `relabel_configs` 为 P2 预留，原型以 Alert 提示形式占位。
- 规则模板一键填充为 P1，原型以 disabled 占位按钮呈现。
- PromQL 校验为本地启发式解析（剥除字符串字面量 / label selector / by/without 子句后识别标识符），仅校验指标名是否存在于所选 Exporter 指标库或全局启用指标库；不调用 Prometheus 真实语法校验。
- 网络域隔离下「Exporter 安装确认」的工单号/安装记录字段仅作笔记，不联动 Module_09 的下发链路。
- 单网域/多网域模式开关（`Tenant.multi_site_enabled`）为演示开关，通过修改内存 mock 生效，刷新页面后重置为默认多网域模式。
- 标签模板的「前往标签模板管理」跨模块跳转链接指向 `../module-07/dist/index.html`，仅在统一静态入口 / GitHub Pages 部署结构下生效；dev 独立端口（5175）下该链接不可达（模块原型隔离所致）。
