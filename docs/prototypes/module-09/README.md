# MetricCenter Module 09 原型

> **验证的 PRD 版本**: [Module_09_Network_Domain_and_Edge_Config_Center.md](../../02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) v1.51
> **覆盖的产品版本**: MVP / v0.2 / v1.0
> **原型版本**: v1.51
> **更新日期**: 2026-08-31
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-09
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5178/

## v1.51 变更说明（决策 54/53：配置按域拆分扇出 + filter 实时求值写入实例过滤契约，2026-08-31）

- **配置生成改为按域拆分扇出（决策 54，v0.2 起）**：M01 逻辑采集 Job 可一次绑定多个已纳管网域，配置生成器按网域自动拆分——为每个目标网域分别生成独立的 `scrape_configs` 片段 / `targets/*.json` / 变更单，各自进入本域的变更检测 / 校验 / 确认 / 下发流程；**无需为每个网域手工克隆 Job**。待确认列表天然按网域分组，多域 Job 的变更摘要标记来源逻辑 Job（purple Tag）。新增演示：逻辑 Job「prod-server-exporter」绑定 {gov-cloud-a, finance-dmz}，本周期生成两份独立待确认草稿 `draft-gov-005`（CHG-20260803-011）+ `draft-finance-002`（CHG-20260803-012）。
- **filter 模式实时求值写入实例过滤契约（决策 53，由 v0.3+ 提前到 v0.2）**：条件式采集策略（`instance_selection_mode=filter`）不持有静态实例清单，每次配置生成周期对条件表达式实时求值——监控对象新增 / 同步进来只要匹配条件即自动纳入 targets（无需编辑策略），下线 / 属性变化不再匹配时自动移出。配置产物结构说明 / 检测状态用户语 / 变更摘要均新增说明；`ConfigDraft` 新增可选字段 `selection_mode` / `source_logical_job` / `filter_condition`。
- 本批为 M01/M07 契约的同步呈现 + 契约声明，v0.2 随开发节奏实现；版本声明 / ReviewNote / 原型版本同步 v1.51。

## v1.50 变更说明（决策 31/30/31-M2/31-M3：M01/M07 契约的同步呈现，2026-08-21）

- **采集认证 / TLS 透传（决策 31，MVP 必实现）**：配置预览（prometheus.yml / scrape_configs）把 ScrapeJob 的认证 / TLS 字段映射进去——`auth_type=basic`→`basic_auth`(username/password)、`auth_type=bearer`→`authorization`(Bearer token)、`tls_skip_verify`→`tls_config.insecure_skip_verify`、`ca_file`→`tls_config.ca_file`；全部可选默认不启用；blackbox 拨测 HTTP/HTTPS 模块同理透传 `tls_config`（gov-cloud-a 域 node-exporter job 演示 basic_auth + tls_config、blackbox-http job 演示 tls_config 透传）。认证 / TLS 由 M01（ScrapeJob）配置，本模块仅透传映射、无新机制——ReviewNote 已标注。
- **冻结（禁用）网域不生成新变更单（决策 30）**：配置变更确认对冻结（禁用）域不生成新变更单；存量下发与回滚不受影响。ReviewNote 已标注「网域已冻结（禁用），不生成新变更单；存量下发与回滚不受影响」。
- **变更状态回写 deployed 提前到 MVP（决策 31-M2）**：变更单 / 配置状态在成功下发后回写 deployed（MVP 生效），消除「已生效 vs 无变更」歧义——原 v1.43「MVP 由 none 占位、v0.2 起精确回写」由 v1.50 取代；changeStatusEnumDemo / 界面样例已同步。
- **删除「未指定网域资源自动归 default」兜底（决策 31-M3）**：未指定网域的资源不再自动归 default；`network_domain_id` 由 M07 导入校验强制必填（缺失资源在导入阶段被拦截）。ReviewNote 已标注。
- **网域纳管预选（配合 Module_06 R4）**：网域纳管页支持 `#/domain-onboarding?network_domain=<id>` 定位参数——从 Module_06 跳转（行内「配置纳管（M09）」）进入时按该网域自动打开纳管弹窗并滚动定位到网域表格；仅对行政已创建（registration_status=created）的网域生效。
- 本批为 M01 / M07 契约的同步呈现，无新机制；版本声明 / ReviewNote / 原型版本同步 v1.50。

## v1.49 变更说明（决策 28/29：网域契约对齐 + offline 排除提级 P0，2026-08-21）

- **网域契约结构性对齐（决策 28）**：`NetworkDomain` 行政模型以 Module_06 为单一事实来源——本模块不再重复声明行政字段表（ID 规则 / 租户归属 / 跨租户共享见 [Module_06](../../02-product-requirements/Modules/Module_06_Multi_Tenant.md)），顶部设计说明同步对齐。
- **offline 排除提级 MVP 必实现（决策 29）**：生成 `targets/*.json` 时按 `Resource.status=offline` 过滤已下线实例——`offline` 不进入 targets，`offline` 后下一配置生成周期即从 targets 移除（对齐 Module_07 8.1 / Module_01 3.1）。`maintenance` 排除口径与 Module_07 8.1 一并对齐（MVP 不保证）。「配置产物结构说明」ReviewNote 已提级改写，v1.46「目标语义、MVP 不保证」措辞由 v1.49 取代。
- 本轮与 Module_01 PRD v3.25 / 原型 v3.25 同步落版。

## v1.48 变更说明（决策 38-1 规则文件挂载，MVP 补齐 M01↔M09 规则链路契约，2026-08-21）

- **rules.yml 生成改为「透传并入」**：MVP 阶段 M01 规则编辑页以「文件挂载」形态（`content_mode=yaml_passthrough`）把整份 `rules.yml` 存于 `MonitoringRule.rule_content`；M09 生成 `rules.yml` 时把各「已提交生效」的 `rule_content` **原样透传并入**（group 随文件自带，不按字段派生）。手写规则不再绕过配置中心：保存 / 启停 / 删除规则 → 变更检测 → 变更单人工确认 → 下发，`change_status` 全链路回写 M01。v0.3 字段级编辑（`content_mode=structured`）落地后恢复按字段派生分组（`rulesGroupDerivationNote` 已同步标注）。本版联动 M01 原型 v3.24，不改变本模块行为逻辑。

## v1.47 变更说明（MVP 缺憾补漏，2026-08-21 决策 42 系列）

- **契约与闭环补口子（不改原型行为）**：①同域 `pending` 草稿「后单取代前单」（superseded）防堆积；②校验失败草稿补「重新校验 / 废弃」闭环（6.6.2 `revalidate`）；③`local` 通道 failed 下发记录补「重试」入口（6.6.3 `retry`，`agent_pull` 不提供）；④configgen 生成异常新增「生成失败」态且不推进版本、下轮重试；⑤PRD §9 验收收敛 MVP 边界标注 {v0.2}。版本声明 / ReviewNote 同步 v1.47；本批为契约与闭环补口子，原型行为不变，不做新交互演示，待 v0.2 实现随开发节奏落地。

## v1.46 变更说明（实例过滤 offline 排除目标语义契约声明，2026-08-19 第四轮评审 K 组）

- **`offline` 排除为目标语义（契约声明，不改行为）**：配置产物结构说明新增——生成 `targets/*.json` 时按 `Resource.status=offline` 过滤已下线实例（跨模块契约，对齐 Module_07 8.1）为**目标语义，MVP 不保证**（offline 资源仍生成被抓取，触发频率极低，MVP 仅靠 Excel 再导入触发下线），随 M01 开发节奏落地。版本声明 / ReviewNote 同步 v1.46；本轮为契约声明，不涉及原型行为变更。

## v1.45 变更说明（external_labels 标签集收敛 + 配置目录组织占位，2026-08-19 决策 19/23）

- **external_labels 移除 tenant_id**：`prometheus.yml` 的 `global.external_labels` 仅注入**部署级 / 物理维度的不可变元数据**——`network_domain_id`（必注入）、`zone_type`（仅网域登记了才注入）、`replica`（部署拓扑注入）；**不再注入 `tenant_id` 与业务标签**（PRD 3.3.1）。
- **biz 与 tenant 均由 M07 LabelTemplate 以 target 级注入**：实例级业务标签 `biz`（`business_domain→biz`）与租户标签 `tenant`（`tenant_id→tenant`）在生成 `targets/*.json` 时注入 `static_configs[].labels`，M09 不单独注入；MVP 单租户下 `tenant` 映射可选、不强制注入（PRD 3.3/§5）。
- **配置目录组织（MVP）**：配置产物按 `network_domain` 分目录组织；**多租户命名空间（按 tenant + network_domain 分目录）为 {v0.2+} 占位**——原则一句话（配置只随物理网域 / 采集目标变化而重新生成与下发，不因租户数量复制采集基础设施），详细规则随多租户版本再定，MVP 不展开、不实现（PRD 3.3/§5）。
- 原型演示数据同步：prometheus.yml 各域 external_labels 收敛（去 tenant_id、network_domain→network_domain_id、补 replica）；版本声明 / ReviewNote / 测试断言同步 v1.45。

## v1.44 变更说明（业务-网域正交性对齐，联动 M06/M07 业务登记决策）

- **biz 标签注入链路说明补全**：配置变更确认抽屉「本抽屉设计说明」与「配置产物结构说明」补注——实例级业务标签 `biz` 由 Module_07 标签模板的 `business_domain→biz` 映射注入 `targets/*.json` 的 `static_configs[].labels`，**不经过 M09 `external_labels`**（external_labels 仅注入 network_domain / tenant_id，登记 zone_type 时注入 zone_type；该 external_labels 描述在 v1.45 已进一步收敛为 network_domain_id / zone_type / replica）。
- **多业务共用 1 网域演示**：gov-cloud-a 域 targets 同时承载 data-api（10.0.1.10 / blackbox-http）与 risk（10.0.1.11）两个业务——网域与业务正交，一个网域承载多个业务为正常状态。
- **业务归属变更演示**：新增待确认草稿 `draft-gov-004`（CHG-20260803-010）——10.0.1.11 业务归属由 data-api 调整为 risk（biz 标签 data-api→risk），仅原子重写 `targets/node-exporter.json`（低风险、file_sd 自动感知不触发 reload），prometheus.yml 骨架 / rules.yml 不变；变更检测状态同步指向该草稿。
- 版本声明与 ReviewNote 决策清单更新到 v1.44；PRD 同步 v1.44（§5.1 网域与业务正交说明）。

## v1.43 变更说明（联动 M01 草稿，改动很小，无结构性变化）

- **配置变更确认页「变更检测状态」卡补说明**：草稿对象（draft_status=draft，v0.2 支持保存草稿）不参与生成配置变更，仅「已提交」（draft_status=ready）的采集 Job / 规则提交生效后才纳入变更检测生成变更单——解释为什么编辑中的 Job / 不出现在变更单里（PRD 3.3）。
- **change_status 枚举演示补 deployed 样例（v0.2 角标）**：mock 新增 `changeStatusEnumDemo`（pending / confirmed / deployed / none 全链路回写 M01，PRD 3.3/3.4/3.5），deployed 旁标 v0.2 角标并说明——MVP 阶段 deployed 由 none 占位，即确认下发成功后直接回写 none（M01 列表「下发状态=无变更」）。
- 版本声明与 ReviewNote 决策清单更新到 v1.43；本版只读主字段，快照删除对其无影响。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-09
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-09
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-09/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 09: 网域与边缘配置中心](docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 的核心交互（基于 PRD v1.36）：

1. **网域纳管（{v1.22} M06 行政创建 → M09 监控纳管，决策 36-1：列收敛 + 详情抽屉）**：**Module_09 不直接创建网域行政记录**——网域的行政创建与租户分配由 Module_06 负责；本页将已存在的网域接入监控（生成 Token / Remote Write URL / 安装 Edge Agent）。**列表列收敛为 7 列**——网域（名称+ID 两行合并）、网络区域类型（zone_type Tag 展示）、纳管状态（created/monitored）、下发通道（local/agent_pull）、运行状态（状态+心跳合并，仅 agent_pull）、凭据（脱敏 Token+复制图标，仅 agent_pull）、操作（三槽位固定结构：主操作=纳管/编辑随行状态变化+文本链接样式+详情常驻+更多仅 agent_pull 已纳管行显示重置 Token+二次确认）；center_endpoint/remote_write_url/agent_type/description 等低频配置字段进右侧详情 Drawer；**安装指引为页面顶部常驻提示区（决策 17，而非每行入口/弹窗）**——页面顶部常驻展示「新网域接入操作流程」（3 步人工步骤 + 边缘节点组件构成 + 凭据获取方式），注册成功后自动滚动高亮；**登记制 + 闭环（决策 14 / {v1.29}）**——新增网域表单区分「仅行政登记」与「立即监控纳管」；纳管时生成 Token 与 Remote Write URL（留空自动推导），仅行政登记时不生成凭据；Agent IP / 主机名 / 状态 / 最后心跳由 Edge Sync Agent 心跳上报自动补全；**Agent 类型下拉保留、MVP 仅 `vmagent` 可选（决策 12/16，下拉 disabled 仅一个选项；编辑 edge 域时可改，prometheus-agent 标注 v0.2+ 开放）**；**字段语义对齐（决策 16）**——列表字段分配置字段（注册/编辑设置）与运行态字段（状态/最后心跳，由心跳上报自动更新，列头 Tooltip + 页脚说明来源），编辑表单补全可编辑配置字段（纳管状态、Agent 类型、Remote Write 目标）；Token 在 UI 中**完全脱敏展示**（不显示任何明文片段，完整值仅可通过复制按钮获取）；**网闸拓扑（{v1.31}）**——纳管表单 `center_endpoint` 必填，安装指引提示区新增「网闸 / 隔离区连接约束」说明（禁止中心→边缘主动连接，全部交互由边缘 Agent 发起，pull / push 上行，中心无入站端口）。
3. **采集节点状态（决策 36-2：节点平铺表 + 组件抽屉）**：**主对象改为「采集节点」**，一行一个节点——节点（主机名/IP）、网域、整体状态（三档聚合：正常/部分异常/离线）、采集器状态、拨测器状态、配置同步（含引导按钮）、WAL 积压、最后心跳；**组件明细进「查看」右侧抽屉**——按组件类型分区展示（Edge Sync Agent / vmagent / blackbox exporter 各一独立分区，实例名截断+Tooltip），**最近错误仅显示一句话摘要（截断约 80 字符）+「查看错误详情」按钮**，点击用 **Modal 弹窗**展示完整错误详情（等宽字体、可复制、含所属组件/关联配置版本/发生时间）；**五维筛选（网域/整体状态/采集器状态/拨测器状态/配置同步）全部作用于平铺列**，不存在嵌套子表导致的筛选失效问题；**页面顶部常驻组件关系横幅**；组件清单由 Edge Sync Agent 心跳附带上报（PRD 4.3）；含「配置包 checksum 校验失败保留旧配置」（边缘传输校验失败演示，PRD 6.4 边缘②传输校验）与「本地手工兜底 manual_override」示例行；页面说明补充**网闸 / 隔离区连接约束（{v1.31}）**与**边缘告警组件职责（{v1.32}）**——vmalert 随配置包 `rules.yml`（scope=edge/both，分组自动派生）下发，alertmanager.yml 由 Module_08 统一管理、不随本模块配置包下发。
4. **配置变更确认（决策 18/19/20/21/22，菜单 / 页面标题为「配置变更确认」）**：面向不了解 Prometheus 的运维工程师，明确「平台自动生成 + 运维人工审批（go/no-go）」职责边界——页面顶部人话说明「本页确认什么」；**审批分级策略（{v1.32} M01/M08/M09 告警规则职责重构）**——prometheus.yml / targets / rules.yml / blackbox.yml 人工确认（go/no-go），alertmanager.yml 由 Module_08（告警收敛与通知管理）直接写文件并触发 Alertmanager reload、**不进入本模块变更单 / 配置变更确认流程**（自动生效），混单规则按高风险文件走人工确认，原因：通知路由调整频繁、风险低、M08 是 Alertmanager 配置唯一 Owner；**rules.yml 按 Prometheus `group` 语法组织（{v1.32}）**——M09 自动派生分组（默认按 resource_type / rule_type 聚类）、MVP 不暴露用户可管理的 RuleGroup 实体，按作用域生成（中心域 scope=central/both，边缘域 scope=edge/both v0.4+）；**网域选择器仅展示已纳管网域（{v1.22}）**，未纳管网域不会出现在此页；**变更列表以「变更单号」为主标识（决策 20，如 CHG-20260803-003）+ 人话变更摘要** + **「风险等级」「确认人」列（决策 19）**，**支持按变更状态筛选（决策 21：待确认 / 已确认 / 已废弃 / 全部，默认待确认）**；**变更对象 = 源数据对象统一枚举（决策 22：采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）+ 「影响的配置文件」派生列（targets/*.json / prometheus.yml / rules.yml / blackbox.yml）**，解决「新增实例与改抓取频率源头都在采集 Job」的影响范围不可见问题；**确认粒度为变更单级（决策 22：整单 go/no-go，不逐行确认）**；**点击变更行打开右侧抽屉查看详情（决策 20）**——变更清单（变更类型 / 变更对象 / 人话说明 / 风险等级 / 影响的配置文件）为详情核心（摘要=列表总览、清单=抽屉明细职责分明），配置预览 / Diff、技术信息折叠、确认/废弃按钮均收纳于抽屉；**YAML 预览受影响文件高亮（决策 19）**——受影响 Tab 加「变更」标记、默认聚焦第一个受影响文件、提示「本次变更影响 N/M 个配置文件」（用户手动切换后不强制跳转）；**变更检测状态为引导性状态（决策 20）**——不记历史，检测到 N 个待确认变更（含高风险数）→ 提示前往列表确认，无变更 → 提示策略/资源变更后自动生成；**全链路关联（决策 22）**——已确认变更展示「已发布配置版本」（cv-xxx）+ 列表「已发布版本」列「记录」快捷入口 + 抽屉「查看发布记录」按钮（跳转下发记录页定位回滚）；**提示分区（决策 21）**——用户可见文案不含「决策 X」「PRD X.X」实现层引用，设计决策依据集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区（默认折叠），代码注释保留决策引用供开发 / AI 参考。
5. **配置预览 / Diff / 下发**：`prometheus.yml` 为 file_sd 骨架（file_sd_configs 引用 targets/*.json，不内联 targets）；配置包结构含 `targets/` 目录（按 job 分文件）；多文件 Tabs 预览（prometheus.yml / targets / rules.yml / blackbox.yml / metadata.json），diff 跟随当前 Tab 与上一 ConfigVersion 按文件对比；确认后触发下发；配置产物形态按域类型分层（决策 6）——中心管理域（default）= 本地文件集（无 zip / metadata.json），边缘域 = zip 配置包（含 metadata.json）；**external_labels 注入（{v1.31}/{v1.45}）**——network_domain_id / replica 注入，网域登记了 zone_type 时同步注入 zone_type，**不注入 tenant_id / 业务标签**（PRD 3.3.1，tenant/biz 由 M07 LabelTemplate 以 target 级注入）；配置包 / 本地文件集中**均不包含 alertmanager.yml**（{v1.32}，由 Module_08 管理）。
6. **下发前校验（{v1.39} 决策 39-1/39-2/39-3 行内闭环）**：promtool check config（file_sd 仅查文件存在性）、blackbox_exporter --config.check、configgen 侧 targets schema 校验（PRD 3.5.1）；**校验失败行内闭环**——点击红色「失败」Tag 弹出 Popover 展示失败文件 + 行号 + 错误信息 + 归因分类 + 引导：用户配置问题（`user_config`，如 default 域 targets JSON 未闭合）→「前往修改」跳 M01 修复源数据后回来点「重新校验」（按钮原地转 loading、行内结果原地刷新，先重新生成产物再校验）；平台技术故障（`platform_fault`，如 gov 域 promtool 校验服务不可用）→ 校验层自动重试（30s/2min/5min 指数退避，用户无感）、持续失败仅提示联系平台侧，**不展示「重新校验」**；校验失败不产生下发记录（决策 39-2）；页面补充「校验分层（PRD 6.4）」说明——中心①内容校验（validation_status，防生成错误，失败阻止确认下发）与边缘②传输校验（config_sync_status，防传输损坏/篡改/半写）由同一份配置产物衔接，Agent 为「哑校验」（不做 promtool 级语法校验）、联合 checksum 双用途（中心草稿去重裁决 + 边缘拉包完整性校验）；抽屉补充「网闸 / 隔离区连接约束（{v1.31}）」说明（边缘域发布通道：全部交互由边缘 Agent 发起）。
7. **配置发布与回滚记录（决策 19/22，定位为回滚中心 + 配置变更执行台账）**：每次「配置变更确认」发布到监控与每次回滚自动留痕（谁 / 何时 / 哪个配置版本 / 结果，含下发前校验结果与 blackbox.yml 是否参与）；**新增「来源变更单号」列（决策 22，经 config_version_id → ConfigVersion.change_no 透传）**，与变更确认页的「已发布配置版本」「查看发布记录」入口形成 **change_no → cv → deploy 双向可追溯**，业务出问题时从变更单直达回滚目标；页顶 Alert 说明定位（回滚中心 + 变更执行台账 + 与 Module_06 全局审计边界：领域审计 vs 平台级操作留痕）；支持按历史版本一键回滚（回滚动作本身也是一条 rolled_back 记录）。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | `docs/prototypes/module-07/` |
| 监控策略 | Module_01 | MVP | `docs/prototypes/module-01/` |
| 配置中心 | Module_09 | MVP / v0.2 | 当前原型 |
| 指标查询 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警状态 | Module_08 | v0.3 | `docs/prototypes/module-08/` |
| 系统设置 | Module_06 / Module_04 | v0.4+ | `docs/prototypes/module-06/` |

> 本原型在左侧导航中保留上述入口的占位或跳转提示，避免模块原型成为孤岛。

## 数据驱动模式（决策 31/34/35）

菜单结构与页面入口由数据驱动，无运行时开关：

- 菜单两个一级组（网域与节点管理 / 配置下发）**常驻展示**，不依赖 `multi_site_enabled` 开关。
- **「采集节点状态」子菜单常驻**，无 `EdgeAgent` 实例时展示空态引导页，提示用户先完成网域纳管并按指引接入 Edge Sync Agent。
- **网域选择器**仅列出存在 `EdgeAgent` 实例的网域（采集节点状态页）或已纳管网域（配置变更确认页），未纳管网域不出现在关联页面中。

## 核心页面

- `/network-domains`：网域纳管（决策 34/35，菜单常驻）— 列表列收敛为 7 列（决策 36-1）：网域（名称+ID 两行合并）、网络区域类型（zone_type Tag 展示，为网域身份并列识别维度）、纳管状态、下发通道（local/agent_pull）、运行状态（状态+最后心跳合并，仅 agent_pull 展示）、凭据（脱敏 Token+复制图标，仅 agent_pull 展示）、操作（三槽位固定结构：主操作=纳管/编辑随行状态变化+文本链接样式+详情常驻+更多仅 agent_pull 已纳管行显示重置 Token+二次确认）；center_endpoint/remote_write_url/agent_type/description 等低频配置字段进右侧详情 Drawer；Token 在 UI 中完全脱敏展示（不显示任何明文片段，完整值仅可通过复制按钮获取）；安装指引为页面顶部常驻提示区（决策 17，而非每行入口/弹窗）——「新网域接入操作流程」：3 步人工步骤 + 边缘节点组件构成 + 凭据获取方式，注册成功后自动滚动高亮；登记制+闭环（决策 14）：最小化表单，Agent 类型下拉 MVP 仅 vmagent 可选；字段语义对齐（决策 16）：配置字段 vs 运行态字段，列头 Tooltip + 页脚说明来源；网闸拓扑（{v1.31}）：纳管表单 center_endpoint 必填，安装指引含网闸/隔离区连接约束说明
- `/edge-agents`：采集节点状态（决策 34/35，子菜单常驻，无实例时空态引导）— **节点平铺表结构（决策 36-2）**：主对象为「采集节点」，一行一个节点——节点（主机名/IP）、网域、整体状态（三档聚合：正常/部分异常/离线）、采集器状态、拨测器状态、配置同步（含引导按钮）、WAL 积压、最后心跳；**组件明细进「查看」右侧抽屉**——按组件类型分区展示（Edge Sync Agent/vmagent/blackbox exporter 各一独立分区，实例名截断+Tooltip），最近错误仅显示一句话摘要（截断~80 字符）+「查看错误详情」按钮，点击用 Modal 弹窗展示完整错误详情（等宽字体、可复制、含所属组件/关联配置版本/发生时间）；页面顶部常驻组件关系横幅；五维筛选（网域/整体状态/采集器状态/拨测器状态/配置同步）全部作用于平铺列；组件清单由心跳附带上报（PRD 4.3）
- `/config-preview`：配置变更确认（决策 18/19/20/21/22）— **「变更单号」为主标识的变更列表（决策 20）** + 人话变更摘要 + **「风险等级」「确认人」列（决策 19）** + **「已发布版本」列（决策 22：已确认变更显示 cv-xxx + 「记录」快捷入口）**、**变更状态筛选（决策 21：待确认 / 已确认 / 已废弃 / 全部，默认待确认）**、**点击行打开右侧抽屉查看变更详情（决策 20：变更清单为核心 + 配置预览/diff + 技术信息折叠 + 确认/废弃按钮）**、**变更对象 = 源数据对象枚举 + 「影响的配置文件」列（决策 22）**、**变更单级确认（决策 22，整单 go/no-go）**、**抽屉「查看发布记录」入口（决策 22）**、**变更检测状态引导性（决策 20）**、**YAML 预览受影响文件高亮（决策 19）**、**审批分级策略（{v1.32}）**（prometheus.yml / targets / rules.yml / blackbox.yml 人工确认；alertmanager.yml 由 Module_08 直接管理、不进入本模块变更确认流程）、**rules.yml 按 Prometheus group 语法组织（{v1.32}，分组自动派生、MVP 不暴露 RuleGroup 实体）**、配置产物结构（按域类型分层：default 管理域=本地文件集，边缘域=zip 配置包含 metadata.json，含 targets/ 目录；**均不包含 alertmanager.yml**）、**external_labels 注入 zone_type（{v1.31}，登记了才注入）**、targets 前端数据驱动（动态遍历 targets_files 渲染子 Tab，新增 job 无需改前端）、file_sd 骨架与 targets 原子写说明、多文件 Tabs 预览 / 按文件 Diff、校验失败 Tab 定位、下发前校验提示、校验分层说明、**网闸 / 隔离区连接约束（{v1.31}，边缘域发布通道）**、**页面底部「原型与实现说明（面向产品 / 技术评审）」折叠区（决策 21：决策清单与 PRD 指引集中承载）**
- `/deployments`：配置发布与回滚记录（决策 19/22，回滚中心 + 配置变更执行台账）— 每次发布/回滚自动留痕（谁 / 何时 / 哪个版本 / 结果，含下发前校验结果与 blackbox.yml 参与字段）、**「来源变更单号」列（决策 22：change_no → cv → deploy 全链路追溯）**、页顶定位说明（领域审计 vs Module_06 平台级审计边界）、按历史版本一键回滚（回滚自身也是 rolled_back 记录）

## 设计意图 Banner

Content 顶部提供可关闭的「Module_09 设计意图」Alert：监控对象、采集策略与告警规则变更后配置自动生成并汇总为待确认变更；运维在「配置变更确认」页做发布审批（go/no-go）——平台保证生成内容与策略一致，运维确认变更影响后决定是否发布；配置按网域生成且**产物形态按域类型分层**（中心管理域 default=本地文件集、无 zip/metadata.json；边缘域=zip 配置包 + metadata.json）；**审批分级（{v1.32}）**——prometheus.yml / targets / rules.yml / blackbox.yml 人工确认，alertmanager.yml 由 Module_08 直接管理、不进入本模块变更确认流程。

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；联合 checksum 为原型演示用伪 sha256（seed 按「prometheus.yml+rules_yml+blackbox_yml+targets 内容」拼接），校验结果（promtool / blackbox --config.check / targets schema）为静态演示数据。
- targets_files 特殊 string 值（未闭合 JSON）仅用于演示 configgen 侧 schema 校验失败，真实系统由生成器在生成时拦截。
- v0.4+ 的 mTLS 证书轮转、Token 轮换、边缘自治告警（vmalert / 本地通知）等能力以占位提示形式展示；`rules.yml` 中 `scope=edge/both` 的边缘下发为 v0.4+ 预留（MVP 中心统一求值），原型演示固定 `central` 作用域规则。
- {v1.31} 网闸长连接 / 大文件穿透与互联网区代理复用两点依赖真实政务云网闸环境实测（PRD 6.2 标记），MVP 阶段按「标准 HTTPS 可穿透」假设设计，原型不做实测验证。
