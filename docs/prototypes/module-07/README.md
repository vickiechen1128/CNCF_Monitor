# MetricCenter Module 07 原型

> **验证的 PRD 版本**: [Module_07_Monitoring_Object_Management.md](../../02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) v2.36
> **覆盖的产品版本**: MVP / v0.4 / v1.0
> **原型版本**: v2.36
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-07
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5174/

## v2.36 变更说明（新增入口回归单按钮，决策 85，2026-09-16）

1. **「新增资源」恢复为单一按钮（决策 85，用户拍板保持原设计风格）**：点击后按**当前资源类型 Tab** 打开对应表单（5 类 Tab 1:1）——切换 Tab 再点按钮即登记不同类型，回归 v2.32 之前的单按钮 + 抽屉随 Tab 交互；移除 v2.35 的 5 项下拉入口。
2. **决策 84 实质不变**：K8s 集群仍不占类型入口、经「其他监控目标」表单首问「登记对象」分流（网络设备 SNMP / GPU 服务器 / 自定义 HTTP 端点 / K8s 集群，集群组件必填、编辑按 exporter_type 判别值反查回显）；端口 / 采集路径 / 协议等采集参数仍不在 M07 表单与详情出现（归 M01 默认采集配置）。
3. **文案与注释同步**：K8s 集群 Callout 引导语改为「节点 OS 层监控请切换到『主机』Tab 新增资源登记」；ReviewNote 补决策 85 条目；`package.json` 2.35.0→2.36.0；不改数据模型与接口契约。

## v2.35 变更说明（新增入口收敛 + 采集参数归位，决策 84，2026-09-15）

1. **新增入口收敛为 5 项、与列表 Tab 1:1**：「登记 K8s 集群」不再占类型入口（K8s 集群是部署形态而非资源类型），收编为「其他监控目标」表单首问「登记对象」的 K8s 集群子动线（决策 81 双入口收编）；入口 / Tab / 资源类型三层一致，消除「6 入口 vs 5 Tab」不对应感。
2. **「高级采集设置」彻底删除（端口 / 采集路径 / 协议不再出现在 M07 表单与详情抽屉）**：采集参数归 M01 默认采集配置统一承载（解析链：Job 覆盖 → CITypeExporterMapping → ExporterTemplate），M07 不做第二配置点，消除与 M01 的双头维护；实例偏差正规出口 = M01 映射端口编辑（MVP）/ Resource.scrape_port（{v0.2}）。
3. **预设精简**：`DEVICE_ENDPOINT_PRESETS` / `K8S_ENDPOINT_PRESETS` 仅承载 key / label / exporter_type 判别值，不再携带 default_port / metrics_path / scheme / custom / target_name_hint；保存逻辑不再写入 port / metrics_path / scheme（存量值随编辑原样保留但不展示）。
4. **表单结构**：「其他监控目标」表单统一为首问「登记对象」——网络设备（SNMP）/ GPU 服务器 / 自定义 HTTP 端点 / K8s 集群（集群级端点）；选 K8s 集群切集群级表单（集群组件必填、API Server 默认）；编辑时按 exporter_type 判别值反查首问（K8s 组件 / 端点类型命中则回显，未命中留空不强制重选）。
5. **mock 与测试**：单测断言同步改写（预设无采集参数字段 + K8s 集群子动线语义）；`package.json` 2.34.0→2.35.0；不改数据模型与接口契约。ReviewNote 补决策 84 条目。

## v2.34 变更说明（其他监控目标定位收窄 + M07/M01 字段边界，决策 83，2026-09-15）

1. **generic_target 展示名「通用目标」→「其他监控目标」（§5.9，内部枚举值不变）**：定位收窄为兜底类——① 网络设备与硬件（SNMP 交换机 / GPU 服务器等）② K8s 集群级端点（仍走「登记 K8s 集群」入口）③ 自定义 HTTP 指标端点；容器 / Pod / K8s 节点由 K8s Job 动态发现、不登记。列表 Tab、下拉项、详情抽屉、页头副标题、默认标签模板名同步更名。
2. **标准入口表单去 exporter 化（§5.9 / §11.2）**：只填目标名称、端点 IP / 域名 + 选择「端点类型」（`DEVICE_ENDPOINT_PRESETS`：网络设备 SNMP 9116·`/snmp` / GPU 服务器 DCGM 9400 / 自定义 HTTP 9100）；端口、采集路径、协议折叠进「高级采集设置（一般无需修改）」，自定义类型默认展开。`exporter_type` 收窄为隐藏的端点子类型判别值（hidden 字段随表提交），不再要求用户填写；编辑存量非标端点（如 haproxy / blackbox）时不强制重选、不覆盖原值。
3. **M07/M01 字段边界**：采集器软件登记、默认参数模板（ExporterTemplate / 默认采集配置）归 M01，M07 只登记端点资产；Oracle 等数据库统一归 database 类（不再双入口）；拨测 URL 由 M01 blackbox Job 的 blackbox_targets 承载、存量拨测资源不迁移。M01 §5.1 推导表扩展 k8s 三 monitor_type 枚举（k8s_apiserver / k8s_kube_state_metrics / k8s_etcd，{v0.2}，M01 PRD v3.42 已落地、M01 原型待同步）。
4. **展示反查函数**：`endpointTypeLabel(exporter_type)`——设备 / 集群预设反查中文名，`blackbox_exporter` 显「拨测目标」，空值显「自定义 HTTP 指标端点」，未知非空值显「自定义端点」；列表行内 Tag 与详情抽屉统一使用，原始 exporter_type 不对用户可见。
5. **mock 与测试**：新增 `DeviceEndpointPreset` / `DEVICE_ENDPOINT_PRESETS` / `endpointTypeLabel`；`RESOURCE_TYPE_MAP.generic_target` 改「其他监控目标」；存量 `res-gen-001/002/003`（snmp / haproxy / blackbox）保留不迁移；不改数据模型与接口契约。ReviewNote 补决策 83 条目。

## v2.33 变更说明（K8s 双域登记动线 + 网域字段可达性引导，决策 81，2026-09-15）

1. **资源新增双入口分流（§5.4 / §11.2，决策 81）**：「新增资源」改为下拉——置顶「登记主机」（→ host，OS 层 node_exporter `:9100`，含 K8s 节点主机 OS）与「登记 K8s 集群」（→ generic_target 集群级端点 API Server / kube-state-metrics / etcd），两入口语义互斥并各带链路说明；集群入口明示「节点 / Pod / 容器由该域 K8s 采集 Job（kubernetes_sd）动态发现、无需逐台登记」，主机入口注明只管 OS 层。从入口消除「K8s 节点算集群域还是主机域」的二选一。
2. **K8s 集群专属表单**：集群组件选择器联动带出 exporter_type / 端口（6443 / 8080 / 2379）/ 协议 / 采集路径；集群名（cluster）在该入口必填；抽屉标题与分组说明区分「K8s 集群（集群级端点）」。
3. **网域字段可达性引导（§5.4 / §11.2，对齐 M06 决策 73）**：网域字段以「采集端口从哪条链路够得着？」提问，下拉选项第二行标注链路说明（中心直连：平台直接采集 / 采集节点域：经该域节点中转）。
4. **instance_ip 实时 `ip_cidrs` 推导预览**：唯一命中显示「推导归属：XX 域（命中网段，最长前缀优先）」并提供「采用」；同前缀跨网命中（mock 中生产 / 测试集群共用 `10.244.0.0/16`）提示「命中多个网域、请人工选择」；无命中提示保存归默认网域兜底。预览仅辅助、不替代显式选择。
5. **mock 增补**：`NetworkDomain.domain_type`（management / edge）、生产 / 测试两个 K8s 集群网域、`domainReachabilityText()`、`previewDomainByIP()`、`K8S_ENDPOINT_PRESETS`；不改数据模型与接口契约。

## v2.25 变更说明（coverage 三态口径修订 + 默认模板 resource_id 补齐，2026-09-02）

1. **coverage 三态口径修订（planner 阻塞项闭环，用户拍板 A 方案）**：选中关系取 DB 当前值、不感知 M09 下发时序——「已下发未采到」覆盖「down / 待首次抓取 / 变更未确认下发」全部选中未采到情形；「待采集 vs 已下发未采到」的细分归 M01 Job 上下文回显（M01 §5.10），本模块 badge 保持三态。
2. **提醒文案同步**：「已下发未采到」badge Tooltip 与概览横幅说明改为「已选中但未采集到数据（含变更未确认下发情形），请检查变更下发状态、采集器安装与网络连通」。
3. **默认模板稳定身份标签**：PRD §5.13 五类默认标签模板补 `resource_id → resource_id` 映射（决策 47-3 coverage 回连前置）；原型为只读 mock 演示，映射数据由后端种子承载，本原型不涉及模板数据变更。
4. **ReviewNote**：决策清单补 3.25。

## v2.24 变更说明（决策 52：网域归属四级解析链 + 网域可留空推导 + 来源标注）

1. **网域字段可留空由平台推导（决策 52）**：资源新增 / 编辑表单「网域」改为可选（去必填、`allowClear`，占位「留空则由平台按归属自动推导」）；新增 / 编辑保存时网域留空则按归属解析链自动推导——显式指定 > 冲突告警 > 按资源 IP 与网域已登记网段最长前缀匹配 > 默认网域兜底；Blackbox 拨测目标取发起侧（采集 Job）网域、不参与推导。
2. **归属四级解析链 UI + 来源标注（决策 52）**：资源列表「网域」列旁新增「归属来源」列（列头 hover 提示解析链），按资源解析来源并着色 Tag（显式指定 / 冲突待处理 / 网段推导 / 默认兜底 / 发起侧指定），Tooltip 展示该来源的解析依据；资源详情抽屉同步标注「归属来源」。
3. **Excel 导入可留空推导（决策 52）**：导入模板说明由「未填写网域时自动归属默认网域」改为「网域列可留空、留空时按归属解析链自动推导」；导入结果弹窗校验项与推导说明同步更新，向用户预告网段推导 / 默认兜底 / 发起侧三类归属去向。
4. **mock 契约**：M07 `NetworkDomain` 新增 `ip_cidrs`（契约来自 Module_06 v2.5），新增 `DomainAttributionSource` / `DOMAIN_SOURCE_LABELS` / `DOMAIN_SOURCE_HINTS` 与 `resolveDomainFromIP` / `resolveDomainAttribution` 解析函数（最长前缀 + 冲突判歧义 + 默认兜底 + blackbox 例外）；新增 blackbox 拨测目标 mock（`res-gen-003`）演示「发起侧指定」来源。
5. **ReviewNote**：决策清单补 3.24（决策 52：网域归属解析链 + blackbox 例外 + 来源标注）。

## v2.23 变更说明（决策 47-3 三态 badge + 决策 48 业务管理页）

1. **资源列表「采集状态」三态 badge 改造（决策 47-3，修订决策 31-M1）**：`/resources` 列表「采集状态」列由二元（已监控 / 未监控）升级为三态——采集中（被 Job 选中且 up）/ 已下发未采到（被选中但 down 或待首次抓取）/ 未监控（未被任何 Job 选中）。
   - mock 层新增 `mockCollectionHealth`（M02 健康度/覆盖率聚合 API 模拟，按 `resource_id` 回连）与 `resolveCollectionStatus` 三态解析函数；
   - 列表列按三态渲染 badge，**异常驱动**——仅「已下发未采到」高饱和红并带 Tooltip 提醒（检查采集器安装与网络连通）；
   - 筛选器「采集状态」改为四选项（全部 / 采集中 / 已下发未采到 / 未监控）；
   - **采集状态概览横幅**：把原塞在 CI Tab 标签右侧的计数抽离，独立成 Tabs 上方的可点击徽标行（采集中 N · 已下发未采到 N · 未监控 N），点击某态即在当前 CI 内联动筛选（再点还原）；Tab 标签回归「类型 (总数)」简洁样式，「已下发未采到」异常态高饱和醒目；
   - 新建资源 `is_monitored` 默认改为 `false`（未监控）——新资源尚未被任何 Job 选中，语义更贴合三态；
   - 列表查询走聚合解析（模拟 M02 聚合 API），禁止逐行查询（TQ-6）。
2. **新增「业务管理」页（决策 48，MVP 提级）**：新页面 `/business-management` 维护业务分组字典（列表 + 登记 + 受限编辑 + 停用）。
   - **登记**：校验 `biz_code` 编码规范（小写字母 / 数字 / 连字符 ≤ 64）+ 重复校验，表单醒目提示「业务编码创建后不可修改」；
   - **受限编辑**：`biz_code` 只读展示（创建后不可改），仅开放 `biz_name` / `description` / 状态；
   - **停用不删除**：无删除入口，停用仅流转状态、存量资源保留历史值；
   - **infra 兜底条目禁止停用**：操作列与编辑状态选择均置灰 / 拦截；
   - `biz_name` 修改不触发监控配置重新生成（mock 演示字典为唯一权威）。
3. **导航 / 路由**：侧边栏「监控对象管理」组新增「业务管理 {v2.23}」菜单项，路由 `/business-management`。

## v2.21 变更说明（两段式评审返工：导入/表单去技术术语与差异化必填）

1. **host 导入模板补 `instance_name` 列**（R1）：`IMPORT_TEMPLATE_COLUMNS.host` 补齐 `instance_name`，与 PRD 字段契约一致。
2. **导入弹窗去除技术术语**（R2）：原「upsert / M01/M09 / offline」表述改为用户友好语言，说明按行增量更新、不删除资源、已消失行不自动清理、停止采集需改状态后重导。
3. **app_name / cluster 差异化必填**（R3）：`app_name`、`cluster` 仅对 application / database / middleware 必填，host / generic_target 可空（为空不注入标签），与 PRD 规则一致。

## v2.20 变更说明

对齐 PRD v2.20，本次在资源管理页（`/resources`）落地两项功能同步：

1. **资源「未监控」筛选（决策 31-M1）**：采集状态（`is_monitored`）由 Module_01（监控策略）维护、M07 只读映射，M07 不据此计算 / 不写回。
   - mock 资源新增只读字段 `is_monitored: boolean`（部分资源置 `false`）；
   - 资源列表筛选器新增「采集状态：全部 / 未监控」下拉，勾选「未监控」后仅展示 `is_monitored=false` 的资源；
   - 列表新增「采集状态」列（未监控标红 Tag）、Tab 标题展示各类型未监控资源数、空态在未监控筛选下显示「当前类型下暂无未监控资源」。
2. **offline 移除语义（决策 29，对齐 M01 / M09）**：资源状态为 offline 时，配置中心（Module_09）下一配置生成周期即将其从 `targets/*.json` 移除、不触发采集器 reload——批量下线动线为真，不再是目标语义。说明标注于资源页「设计说明」评审注记、mock 数据结构注释与设计决策清单（3.20 / 3.21）。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-07
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-07
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-07/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 07: 监控对象管理](../../02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) 的核心交互：

1. **资源管理（MVP / {v2.6} / {v2.18} 业务归属 / {v2.23} 三态）**：四类资源（主机 / 中间件 / 应用服务 / 通用指标目标）的固定列列表、新增 / 编辑 / 删除、网域归属；**{v2.23} 决策 47-3 采集状态三态 badge**：列表「采集状态」列只读展示三态（采集中 / 已下发未采到 / 未监控，异常驱动高亮）并提供三态筛选，数据 = M01 选中关系 + M02 健康度聚合 API。**{v2.6} 网域仅作为列表筛选器**：M07 顶部不再提供全局网域上下文切换器，资源列表操作区提供「网域筛选」下拉（默认「全部网域」、可切单个网域），与搜索框并列。**{v2.18} 网域与业务双归属正交维度**：新增「业务」列与「业务筛选」下拉，展示业务分组字典展示名（`biz_name`），停用业务以「（已停用）」标识；业务列取不可变编码 `biz_code`，仅启用字典项可选。
2. **标签模板管理（MVP）**：左右分栏——左侧模板列表（资源类型 Tab + 搜索框 + 默认/自定义筛选，展示模板 ID），右侧映射明细按来源类型分组（组合字段 / 资源字段）；模板与映射编辑统一使用右侧抽屉，保留上下文；字段来源 MVP 支持资源字段 / 组合字段（`cmdb_field` v0.4+ 预留，`prometheus_builtin` 由 Prometheus 原生注入、MVP 隐藏）；新增映射目标标签默认预填来源字段（composite 默认 instance）；转换规则下拉可留空（无/lower/upper，prefix/replace P1 置灰）；保存时校验保护 label 与同模板目标标签唯一；MVP 不做分页。
3. **资源标签管理（MVP / {v2.8} 双场景治理）**：
   - **应用服务资源**：开放自定义标签（user 来源可编辑 / 删除），标签口径说明含「双场景」条目；业务类型（`biz_code`，存不可变编码、展示取字典 `biz_name`）字段可在新增 / 编辑表单维护，详情展示，默认模板映射为 `biz` 标签（`biz_code → biz`，按业务类型聚合的关联键）；
   - **静态资源（主机 / 中间件 / 通用目标）**：标签只读（标题「自定义标签（静态资源只读）」），添加输入替换为「标签由 CMDB / Excel 治理，平台只读」提示，user 来源标签标注「Excel / CMDB 带入（只读）」并锁定；
   - 通用：key 校验（小写字母数字下划线、禁止 `__` 开头、长度 ≤128、禁止覆盖 Prometheus 内置 label），CMDB 冲突琥珀色提示，冲突优先级 CMDB > 用户 > 系统。
4. **Excel 导入（MVP / {v2.19}）**：按资源类型展示固定列模板（含 `network_domain`、必填 `biz_code` 列），模板为后端生成静态 xlsx、内置「取值说明 sheet」列出 `network_domain` / `biz_code` / `env` / `status` 合法值清单；导入结果弹窗演示校验项与状态映射（运行中→online、已停止→offline、维护中→maintenance），未登记业务报错给可执行指引（联系平台管理员在 `platform/config/business_domains.yaml` 添加后再导入），并声明 upsert 不删除 / 批量下线动线（status 置「已停止」后 upsert 导入）；设备类资源挂兜底业务 `infra`。导入记录页可查看错误报告明细。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | 当前原型 |
| 标签模板 | Module_07 | MVP | 当前原型 |
| 导入记录 | Module_07 | MVP | 当前原型 |
| 业务管理 | Module_07 | MVP（决策 48 提级） | 当前原型 |
| 监控策略 | Module_01 | MVP | `docs/prototypes/module-01/` |
| 配置中心 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |
| 指标查询 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警状态 | Module_08 | v0.3 | `docs/prototypes/module-08/` |
| 系统设置 | Module_06 / Module_04 | v0.4+ | `docs/prototypes/module-06/` |

## 核心页面

- `/resources`：资源管理（四类资源 Tab、按类型固定列、采集状态三态 badge、详情抽屉标签管理、新增/编辑/删除、Excel 导入与模板弹窗）
- `/label-templates`：标签模板（左侧模板列表 + 右侧 mappings 表格，模板级增删改）
- `/import-history`：导入记录（状态映射说明 + 错误报告详情）
- `/business-management`：业务管理（业务分组字典列表 + 登记 + 受限编辑 + 停用，红线硬化）

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API。
- Excel 导入为 mock 演示：不真实生成 / 上传文件，「下载模板」以弹窗展示固定列模板，「Excel 导入」直接展示导入结果（含校验项与状态映射说明）。
- v0.4+ 能力（CMDB 字段来源、`cmdb_ci_id` / `cmdb_business_path` / `cmdb_module_path` / `cmdb_maintainer` 字段、CMDB 同步标签）以占位 / {v0.4+} 标注形式展示。
- 网域生命周期由 Module_09 负责，本原型仅提供 `default` 与 `gov-cloud-a` 两个网域供资源归属选择。
