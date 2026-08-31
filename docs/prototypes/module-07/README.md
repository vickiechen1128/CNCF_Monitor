# MetricCenter Module 07 原型

> **验证的 PRD 版本**: [Module_07_Monitoring_Object_Management.md](../../02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) v2.24
> **覆盖的产品版本**: MVP / v0.4 / v1.0
> **原型版本**: v2.24
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-07
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5174/

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
