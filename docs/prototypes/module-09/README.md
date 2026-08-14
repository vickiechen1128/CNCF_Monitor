# MetricCenter Module 09 原型

> **验证的 PRD 版本**: [Module_09_Network_Domain_and_Edge_Config_Center.md](../../02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) v1.28
> **覆盖的产品版本**: MVP / v0.2 / v1.0
> **原型版本**: v1.21
> **更新日期**: 2026-08-14
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-09
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5178/

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

验证 [Module 09: 网域与边缘配置中心](docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 的核心交互（基于 PRD v1.26）：

1. **单网域 / 多网域模式切换**：通过 `Tenant.multi_site_enabled` 开关演示两种模式下的 UI 差异。
2. **网域管理**：注册、编辑、删除网域；`default` 管理域可修改名称/描述但禁止删除；`domain_type` 区分管理域/边缘域；**安装指引为页面顶部常驻提示区（决策 17，而非每行入口/弹窗）**——网域管理页顶部常驻展示「新网域接入操作流程」（3 步人工步骤 + 边缘节点组件构成 + 凭据获取方式：`NETWORK_DOMAIN_ID`=对应网域 ID、`TOKEN` 经网域行内复制按钮获取），**行内不再提供安装指引按钮**（操作列收敛为「编辑 / 更多（重置 Token）/ 删除」），**注册成功后自动滚动并高亮顶部提示区**（guideHighlight 描边高亮 4s）；**注册为登记制 + 闭环（决策 14）**——注册表单最小化（网域名称 + 租户，`id` 按名称自动生成、Token 自动签发、**Remote Write URL 留空自动推导**（中心 ingress + 网域路径，可手动覆盖）），表单内置「注册 → 安装指引 → 自动上线」闭环 Alert；**Agent 类型下拉保留、MVP 仅 `vmagent` 可选（决策 12/16，下拉 disabled 仅一个选项；编辑 edge 域时可改，prometheus-agent 标注 v0.2+ 开放）**；**字段语义对齐（决策 16）**——列表字段分配置字段（注册/编辑设置）与运行态字段（状态/最后心跳，由心跳上报自动更新，列头 Tooltip + 页脚说明来源），编辑表单补全可编辑配置字段（Agent 类型、Remote Write 目标）；Token 在 UI 中**完全脱敏展示**（不显示任何明文片段，完整值仅可通过复制按钮获取）。
3. **Edge Agent 状态**：**仅展示部署了 Edge Agent 的网域（决策 16）**——default 管理域中心直接采集、无 Agent，不出现（单网域模式本页空态 Alert）；多网域模式支持**网域 + 组件类型双筛选（决策 16）**（「选择网域」+「组件类型」下拉，组件类型联动展开明细与统计卡、一级表对应列仅统计匹配组件，统计卡随筛选动态展示）；页面采用**「网域为主 + 组件分类」结构（决策 15）**——**一级表格按网域聚合**（网域名称 + 类型 Tag / 在线 Agent x/y / 采集器运行中 x/y / 拨测器运行中 x/y 或「未部署」/ 配置同步 / WAL 积压合计 / 最后心跳），**展开行按组件类型分类展示**该网域全部组件实例子表（组件类型 Tag + Tooltip / 组件实例 / 所属节点 / 状态 / 版本 / 配置版本 / 最近错误），组件类型包括 Edge Sync Agent（必装）、指标采集器（vmagent / prometheus-agent）、拨测器（blackbox exporter，仅 blackbox job 网域附带）、v0.4+ 边缘告警组件（vmalert / alertmanager）；组件清单由 Edge Sync Agent 心跳附带上报（PRD 4.3），展示对象为边缘节点 Agent 部署实例（= Edge Sync Agent + 采集器组合，PRD 4.2）；含「配置包 checksum 校验失败保留旧配置」（边缘传输校验失败演示，PRD 6.4 边缘②传输校验）与「本地手工兜底 manual_override」示例行。
4. **配置变更确认（决策 18/19/20/21/22，菜单 / 页面标题为「配置变更确认」）**：面向不了解 Prometheus 的运维工程师，明确「平台自动生成 + 运维人工审批（go/no-go）」职责边界——页面顶部人话说明「本页确认什么」；**变更列表以「变更单号」为主标识（决策 20，如 CHG-20260803-003）+ 人话变更摘要** + **「风险等级」「确认人」列（决策 19）**，**支持按变更状态筛选（决策 21：待确认 / 已确认 / 已废弃 / 全部，默认待确认）**；**变更对象 = 源数据对象统一枚举（决策 22：采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）+ 「影响的配置文件」派生列（targets/*.json / prometheus.yml / rules.yml / blackbox.yml）**，解决「新增实例与改抓取频率源头都在采集 Job」的影响范围不可见问题；**确认粒度为变更单级（决策 22：整单 go/no-go，不逐行确认）**；**点击变更行打开右侧抽屉查看详情（决策 20）**——变更清单（变更类型 / 变更对象 / 人话说明 / 风险等级 / 影响的配置文件）为详情核心（摘要=列表总览、清单=抽屉明细职责分明），配置预览 / Diff、技术信息折叠、确认/废弃按钮均收纳于抽屉；**YAML 预览受影响文件高亮（决策 19）**——受影响 Tab 加「变更」标记、默认聚焦第一个受影响文件、提示「本次变更影响 N/M 个配置文件」（用户手动切换后不强制跳转）；**变更检测状态为引导性状态（决策 20）**——不记历史，检测到 N 个待确认变更（含高风险数）→ 提示前往列表确认，无变更 → 提示策略/资源变更后自动生成；**全链路关联（决策 22）**——已确认变更展示「已发布配置版本」（cv-xxx）+ 列表「已发布版本」列「记录」快捷入口 + 抽屉「查看发布记录」按钮（跳转下发记录页定位回滚）；**提示分区（决策 21）**——用户可见文案不含「决策 X」「PRD X.X」实现层引用，设计决策依据集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区（默认折叠），代码注释保留决策引用供开发 / AI 参考。
5. **配置预览 / Diff / 下发**：`prometheus.yml` 为 file_sd 骨架（file_sd_configs 引用 targets/*.json，不内联 targets）；配置包结构含 `targets/` 目录（按 job 分文件）；多文件 Tabs 预览（prometheus.yml / targets / rules.yml / blackbox.yml / metadata.json），diff 跟随当前 Tab 与上一 ConfigVersion 按文件对比；确认后触发下发。
6. **下发前校验**：promtool check config（file_sd 仅查文件存在性）、blackbox_exporter --config.check、configgen 侧 targets schema 校验（PRD 3.5.1）；校验失败（如 mfg 域 targets JSON 语法错误）标注「中心内容校验失败（PRD 6.4）」并在对应文件 Tab 上定位提示，且禁止确认下发；页面补充「校验分层（PRD 6.4）」说明——中心①内容校验（validation_status，防生成错误，失败阻止确认下发）与边缘②传输校验（config_sync_status，防传输损坏/篡改/半写）由同一份配置产物衔接，Agent 为「哑校验」（不做 promtool 级语法校验）、联合 checksum 双用途（中心草稿去重裁决 + 边缘拉包完整性校验）。
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

## 模式开关

mock 数据中的 `currentTenant.multi_site_enabled` 控制原型演示模式：

- `false`：单网域模式，隐藏「网域管理」「Agent 状态」菜单，配置生成页不展示网域选择器。
- `true`：多网域模式，完整展示网域管理、Agent 状态、按网域配置下发。

## 核心页面

- `/network-domains`：网域管理（多网域模式下可见）— CRUD、Token 生成/重置（UI 完全脱敏展示，完整值仅通过复制按钮获取）、**安装指引为页面顶部常驻提示区（决策 17，而非每行入口/弹窗）**（「新网域接入操作流程」：3 步人工步骤 + 边缘节点组件构成 + 凭据获取方式，注册成功后自动滚动高亮）、**注册为登记制 + 闭环（决策 14）**（最小化表单：名称 + 租户，Agent 类型下拉 MVP 仅 vmagent 可选，Remote Write URL 留空自动推导可覆盖，内置「注册 → 安装指引 → Agent 自动上线」闭环 Alert）、**字段语义对齐（决策 16）**（配置字段 vs 运行态字段：状态/最后心跳列头 Tooltip 标注心跳上报来源、页脚说明；编辑表单补全 Agent 类型 / Remote Write URL 可编辑配置字段）、操作列收敛为「编辑 / 更多（重置 Token）/ 删除」、管理域禁止删除
- `/edge-agents`：Agent 状态（多网域模式下可见）— **仅展示有 Agent 的网域（决策 16，default 管理域中心直接采集无 Agent 不出现；单网域模式空态 Alert）**、**「网域 + 组件类型」双筛选（决策 16）**（组件类型联动展开明细与统计卡，统计卡随筛选动态展示）、**「网域为主 + 组件分类」结构（决策 15）**（一级表格按网域聚合：在线 Agent x/y / 采集器运行中 x/y / 拨测器运行中 x/y 或未部署 / 配置同步 / WAL 合计 / 最后心跳；展开行按组件类型分类展示组件实例子表：组件类型 Tag + Tooltip / 实例 / 所属节点 / 状态 / 版本 / 配置版本 / 最近错误，覆盖 Edge Sync Agent / 指标采集器 / 拨测器 / v0.4+ 边缘告警组件）、展示对象 = 边缘节点 Agent 部署实例（Edge Sync Agent + 采集器组合，PRD 4.2）、组件清单由心跳附带上报（PRD 4.3）、config_sync_status 说明、边缘传输校验（PRD 6.4 / 6.3 第 5、6 条）与采集器进程管理（PRD 3.2 / 6.3 第 1 条）说明、checksum 校验失败示例
- `/config-preview`：配置变更确认（决策 18/19/20/21/22）— **「变更单号」为主标识的变更列表（决策 20）** + 人话变更摘要 + **「风险等级」「确认人」列（决策 19）** + **「已发布版本」列（决策 22：已确认变更显示 cv-xxx + 「记录」快捷入口）**、**变更状态筛选（决策 21：待确认 / 已确认 / 已废弃 / 全部，默认待确认）**、**点击行打开右侧抽屉查看变更详情（决策 20：变更清单为核心 + 配置预览/diff + 技术信息折叠 + 确认/废弃按钮）**、**变更对象 = 源数据对象枚举 + 「影响的配置文件」列（决策 22）**、**变更单级确认（决策 22，整单 go/no-go）**、**抽屉「查看发布记录」入口（决策 22）**、**变更检测状态引导性（决策 20）**、**YAML 预览受影响文件高亮（决策 19）**、配置产物结构（按域类型分层：default 管理域=本地文件集，边缘域=zip 配置包含 metadata.json，含 targets/ 目录）、targets 前端数据驱动（动态遍历 targets_files 渲染子 Tab，新增 job 无需改前端）、file_sd 骨架与 targets 原子写说明、多文件 Tabs 预览 / 按文件 Diff、校验失败 Tab 定位、下发前校验提示、校验分层说明、**页面底部「原型与实现说明（面向产品 / 技术评审）」折叠区（决策 21：决策清单与 PRD 指引集中承载）**
- `/deployments`：配置发布与回滚记录（决策 19/22，回滚中心 + 配置变更执行台账）— 每次发布/回滚自动留痕（谁 / 何时 / 哪个版本 / 结果，含下发前校验结果与 blackbox.yml 参与字段）、**「来源变更单号」列（决策 22：change_no → cv → deploy 全链路追溯）**、页顶定位说明（领域审计 vs Module_06 平台级审计边界）、按历史版本一键回滚（回滚自身也是 rolled_back 记录）

## 设计意图 Banner

Content 顶部提供可关闭的「Module_09 设计意图」Alert：监控对象、采集策略与告警规则变更后配置自动生成并汇总为待确认变更；运维在「配置变更确认」页做发布审批（go/no-go）——平台保证生成内容与策略一致，运维确认变更影响后决定是否发布；配置按网域生成且**产物形态按域类型分层**（中心管理域 default=本地文件集、无 zip/metadata.json；边缘域=zip 配置包 + metadata.json）。

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；联合 checksum 为原型演示用伪 sha256（seed 按「prometheus.yml+rules_yml+blackbox_yml+targets 内容」拼接），校验结果（promtool / blackbox --config.check / targets schema）为静态演示数据。
- targets_files 特殊 string 值（未闭合 JSON）仅用于演示 configgen 侧 schema 校验失败，真实系统由生成器在生成时拦截。
- v0.4+ 的 mTLS 证书轮转、Token 轮换、边缘自治告警等能力以占位提示形式展示。
