# 模块目录与版本对齐总表

> 文档类型：产品需求索引
> **定位**：本文件是各模块 PRD 的**目录 + 版本对齐快照**，回答"每个模块当前到什么版本、原型是否对齐、是否可开发"。它是 prototype-designer 的固定输入（见 `.kimi/agents/prototype-designer.md` Step 3）。
> **主控关系**：产品版本的定义/规划以 [02_Product_Roadmap.md](../02_Product_Roadmap.md) §1.5 功能-版本矩阵为准；各模块版本声明以其 PRD 头部为准；本表是两者的**跨模块快照**（详见 06 Gitflow §2.5）。
> 更新日期：2026-08-22（v1.43）

---

## 1. 版本对齐总表

| 模块 | PRD 版本 | 原型版本 | 对齐 | PRD 状态 | 产品版本覆盖 | 最近合并 PR |
|------|---------|---------|------|---------|-------------|------------|
| Module_00 模块职责与集成关系 | v1.3 | N/A | —（全局索引，无需原型） | draft | MVP/v0.2/v0.3/v0.4/v1.0 | #24 |
| Module_01 监控策略与指标管理 | v3.26 | v3.26 | ✅ 对齐（v3.26 已同步：采集认证/TLS 最小集——ScrapeJob 新增 `auth_type`（none/basic/bearer）＋`username`/`password` 或 `token`、`tls_skip_verify`、`ca_file`，表单「认证与 TLS」折叠区；冻结（禁用）网域禁止新建 Job、存量 Job 禁止新增该域实例；`change_status=deployed` 回写契约；v3.25 offline 排除提级 P0——决策 29：实例候选集中 `Resource.status=offline` 实例**显示但置灰不可选**（Transfer 数据项 disabled，标题/描述标注「已下线」）、已选实例转 offline 后 M09 配置生成跳过（offline 后下一生成周期即从 targets 移除），§3.1/§5.4/§8/§9 同步，新增 default 域 mysql 下线副本 res-mw-005 演示；v3.24 规则文件挂载 MVP——决策 38-1：规则编辑页新增「文件挂载」视图，上传/粘贴整文件 rules.yml（content_mode=yaml_passthrough + rule_content）落库，保存/启停/删除后由 M09 生成 rules.yml → 变更单人工确认 → 下发、change_status 全链路回写；基础 YAML 校验 + 规则条数启发式展示；「字段化编辑」为 v0.3 预览（structured）；手写规则不再绕过配置中心） | ready（可开发版本） | MVP/v0.2/v0.3/v1.0 | #24 |
| Module_02 查询中心 | v1.3 | v1.2 | ⚠️ 原型落后 | 设计中 | MVP/v0.2/v0.3 | #24 |
| Module_03 网关与认证 | v1.2 | v1.1 | ➖ Track B+ 免原型（决策 44） | dev-ready（2026-08-28 确认） | MVP/v0.2/v1.0 | #24 |
| Module_04 自定义服务发现 | v1.2 | v1.2 | ✅ 对齐 | 设计中 | v0.4+ | #24 |
| Module_05 自定义前端门户 | v1.1 | v1.1 | ✅ 对齐 | 设计中 | v0.3/v1.0 | #24 |
| Module_06 租户与平台管理 | v2.3 | v2.3 | ✅ 对齐（v1.7~v2.3 已同步：网域登记纳入 MVP、租户与业务解耦、网域可跨租户共享（决策 18~20：登记归属固定 platform_admin + 授权租户 authorized_tenant_ids、ID 部署级前缀 `deploy_code-domain_code` 默认 `mc`、`default` 管理域无前缀、multi_site_enabled 改为「被授权使用多个网域」）、业务字典术语 `biz_code` / `biz_name`（决策 21~22）、列表筛选补齐 §11.1、MVP 缺憾补漏（决策 23：zone-types 只读接口 / 禁用冻结语义 / 空网域删除 / 种子数据 migration upsert / 登记归属创建后不可变更 / 无鉴权风险声明 / deploy_code 前缀 / authorized_tenant_ids 可选缺省）、两段式评审返工（R4 行内「配置纳管（M09）」跳转 Module_09 预选该网域；R5 禁用=冻结传导 M01/M09 影响告知）） | dev-ready（Track B 增量 v2.3，2026-08-28 确认；≤v2.2 为 ready） | MVP/v0.2/v0.4/v1.0 | #24 |
| Module_07 监控对象管理 | v2.20 | v2.21 | ✅ 对齐（v2.21 已同步：两段式评审返工——host 导入模板补 `instance_name` 列、导入弹窗去除 upsert/M01/M09/offline 等技术术语、`app_name` / `cluster` 改差异化必填（application/database/middleware 必填、host/generic_target 可空）；v2.20 已同步：offline 排除提级 P0——offline 后下一配置生成周期即从 targets 移除、不触发 reload；资源列表「未监控」筛选——`is_monitored` 由 M01 维护、M07 只读映射；v2.16~v2.19 已同步：is_monitored 展示移除（采集状态归 M01/M02，已由 v2.20「未监控」筛选弱依赖取代）、business_domain 更名 biz_code/biz_name（决策 21/22）、业务字典 MVP 运维口径（配置 business_domains.yaml 热加载 + 兜底 infra + 未登记报错给可执行指引）、导出模板由后端生成静态 xlsx 内置取值说明 sheet、upsert 不删除 + 批量下线动线、simple-agent 示例补 biz_code、原型 v2.7→v2.21） | ready（可开发版本） | MVP/v0.4/v1.0 | #24 |
| Module_08 告警规则管理 | v1.2 | v1.1 | ⚠️ 原型待升级 | 设计中 | v0.3/v1.0 | #24 |
| Module_09 网域与边缘配置中心 | v1.50 | v1.50 | ✅ 对齐（v1.50 已同步：采集认证/TLS 最小集透传——`basic_auth` / `authorization` / `tls_config` 映射进 scrape_configs、blackbox 拨测同理透传 `tls_config`；冻结域不生成新变更单、存量下发与回滚不受影响；变更状态回写 `change_status=deployed` 提前到 MVP（决策 31-M2）；删除「未指定网域资源自动归 default」兜底、`network_domain_id` 必填以 M07 为准（决策 31-M3）；v1.49 网域契约结构性对齐决策 28 + offline 排除提级 P0 决策 29：NetworkDomain 行政模型以 Module_06 为单一事实来源、删除旧「1 租户:N 网域 / 禁止跨租户共享 / 租户前缀」语义；§3.3 实例过滤 offline 排除提级 MVP 必实现——生成 targets/*.json 时按 Resource.status=offline 过滤（offline 后下一生成周期即从 targets 移除）、「配置产物结构说明」ReviewNote 提级改写、targets mock 注释同步；v1.48 规则文件挂载联动——决策 38-1：rules.yml 生成改为「透传并入」，MVP 由 M01 规则文件挂载的 `MonitoringRule.rule_content`（content_mode=yaml_passthrough）原样并入、不按字段派生，保存/启停/删除后进入变更检测 → 变更单人工确认 → 下发、change_status 全链路回写 M01；v0.3 字段级编辑（structured）后恢复按字段派生分组） | ready（可开发版本） | MVP/v0.2/v1.0 | #24 |
| Module_10 监控源登记册 | v1.1 | v1.1 | ✅ 对齐 | 设计中 | v0.2/v0.4/v1.0 | #24 |

## 2. 对齐规则

- **原型版本必须与 PRD 修订版本一致**（prototype-designer 强制校验，见 `.kimi/agents/prototype-designer.md`「版本一致性检查」）。
- **产品版本覆盖**以 02_Product_Roadmap.md §1.5 功能-版本矩阵为准，各模块 PRD 头部声明需与之对齐。
- **PRD 状态**：draft / prototyping / ready / 已冻结。`已冻结` = 该轮 review 合并后由 chenrt 标记，是 zhangwq 开发与回退的基线（冻结行只增不改，见 06 Gitflow §2.5）。
- **最近合并 PR**：develop 最近一次合并轮次（PR 编号即追溯点：`git log --merges develop | grep "#<PR编号>"` 可定位该轮 merge commit）。每轮合并后由 chenrt 更新本列。

## 3. 维护纪律

- **更新时机**：任何模块 PRD 版本递增、原型版本变更、PRD 状态流转（ready / 已冻结）时，**与修订表同一次提交**更新本表对应行。
- **更新人**：prototype-designer（迭代后同步）；chenrt（标记已冻结、合并 PR 后同步）。

## 4. 模块 ↔ 代码目录映射

> 定位：回答「某个模块的代码落在哪个目录」。源码目录按功能域组织，模块归属由分支名 + commit message + 本表共同承载。
> 更新时机：新增/迁移模块源码目录时，**与功能代码同一次提交**更新本表。

| 模块 | 功能域 | 后端目录/包 | 前端目录 | 负责人 / 开发分支 |
|------|--------|------------|----------|------------------|
| Module_00 | 全局索引 | — | — | `design` / chenrt, prototype-designer |
| Module_01 | 监控策略与指标管理 | `platform/cmd/metric-center/`（Prometheus 代理入口）<br>`platform/models/`（共享模型） | `ui-custom/web/src/pages/collection/` | `feat/module-01-*` |
| Module_02 | 查询中心 | `platform/api/response/`（统一响应封装）<br>`platform/cmd/metric-center/`（查询代理） | `ui-custom/web/src/pages/query/` | `feat/module-02-*` |
| Module_03 | 网关与认证 | 预留 `platform/gateway/` | 共享路由/鉴权（`src/api/client.ts`、`src/layouts/`） | `feat/module-03-*` |
| Module_04 | 自定义服务发现 | 预留 `platform/discovery/` | `ui-custom/web/src/pages/resources/` | `feat/module-04-*` |
| Module_05 | 自定义前端门户 | — | `ui-custom/web/` 整体 | `feat/module-05-*` |
| Module_06 | 租户与平台管理 / 网域登记 | `platform/admin/networkdomain/` | `ui-custom/web/src/pages/admin/domains/` | `feat/module-06-*` / zhangwq |
| Module_07 | 监控对象管理 | `platform/models/`（共享模型）<br>预留 M07 目录待创建 | `ui-custom/web/src/pages/resources/` | `feat/module-07-*` |
| Module_08 | 告警规则管理 | 预留 `platform/config/` | `ui-custom/web/src/pages/alerts/` | `feat/module-08-*` |
| Module_09 | 网域与边缘配置中心 | 预留 `platform/collector/`<br>预留 `platform/config/` | 预留页面目录（`#/domain-onboarding`） | `feat/module-09-*` |
| Module_10 | 监控源登记册 | 预留 `platform/discovery/` | 预留 | `feat/module-10-*` |
| **共享基础设施** | 跨模块 | `platform/api/response/`、`platform/db/`、`platform/models/` | `ui-custom/web/src/layouts/`、`src/api/`、`src/components/` | `develop` / 各 Agent |

### 4.1 目录归属原则

1. **源码目录按功能域命名**，不按模块号命名。例如网域功能使用 `networkdomain/` 而非 `module-06/`。
2. **模块归属通过以下四层共同追溯**：
   - Git 分支：`feat/module-XX-*`；
   - Commit message：`feat(module-XX): ...`；
   - 执行记录：`docs/05-execution-records/module-XX/`；
   - 本表：模块到功能目录的映射。
3. **跨模块共享代码**（如 `models/`、`api/response/`、`layouts/`）不归入任何单一模块目录，由 `develop` 统一维护；修改时须在 commit / PR 描述中说明影响的模块。

## 5. Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.43 | 2026-08-22 | 新增 | 新增「模块 ↔ 代码目录映射」章节（§4）及目录归属原则：源码目录按功能域命名、不按模块号命名；模块归属由分支名 + commit message + 执行记录 + 本表四层追溯；跨模块共享代码不归入单一模块。同步更新 agent 规范：backend-developer.md 要求 Go 包注释注明模块/PRD 路径；frontend-developer.md 要求页面入口 JSDoc 注明模块/PRD 路径 | 全部模块 / Agent 规范 | 文档自身 | 使用中 |
| v1.42 | 2026-08-21 | 修改 | PRD 状态推进 ready（可开发）：Module_01（v3.26）、Module_06（v2.2/原型 v2.3）、Module_07（v2.21）、Module_09（v1.50）四模块 PRD 状态由 设计中/prototyping 流转为 `ready`（两段式评审通过、原型对齐、可用于后续 plan-maintainer 派生 Implementation Plan）；本表对应四行使序状态列同步更新，对齐保持「✅ 对齐」 | Module_01 / Module_06 / Module_07 / Module_09 | 文档自身 | 使用中 |
| v1.41 | 2026-08-21 | 修改 | 两段式评审返工修复 + 版本对齐：Module_07 原型 v2.20→v2.21（host 导入模板补 `instance_name` 列、导入弹窗去技术术语 upsert/M01/M09/offline、`app_name`/`cluster` 差异化必填）；Module_06 原型 v2.2→v2.3（R1 ID 前缀 `nd-*`→`<deploy_code>-<domain_code>` 默认 `mc`、`default` 无前缀；R2 `multi_site_enabled` 裸暴露去用户层；R3 去「v0.2+」阶段标记；R4 未纳管网域行内「配置纳管（M09）」跳转 Module_09 预选该网域——M09 `NetworkDomainsPage` 补读 `?network_domain=` 自动打开纳管弹窗；R5 禁用=冻结确认补充 M01/M09 传导影响）；Module_09 原型版本声明 v1.49→v1.50（对齐 PRD）。三模块对齐保持「✅ 对齐」 | Module_07 / Module_06 / Module_09 | 文档自身 | 使用中 |
| v1.40 | 2026-08-21 | 修改 | 原型同步落版（决策 28~31 / 31-M1~31-M3 / 30-3）：Module_01 原型 v3.25→v3.26（认证与TLS 折叠面板 auth_type/basic/bearer + tls_skip_verify + ca_file、冻结网域 Select 置灰+Tooltip、提交兜底校验冻结域/认证必填、mock 补 frozen legacy-dc 与 default 域下线 res-mw-005）；Module_07 原型 v2.9→v2.20（「未监控」筛选器 + 采集状态列 + Tab 未监控计数、资源列表 is_monitored 只读映射）；Module_09 原型 v1.49→v1.50（scrape_configs 透传 basic_auth/authorization/tls_config示例 + blackbox HTTP/HTTPS tls_config、ReviewNote 补冻结域不生成变更单/认证TLS透传/offline 排除说明）。三模块对齐均改「✅ 对齐」，原型版本与 PRD 版本拉齐 | Module_01 / Module_07 / Module_09 | 文档自身 | 使用中 |
| v1.39 | 2026-08-21 | 修改 | 同步 Module_01/M07/M09 四模块 MVP 残余缺陷收敛（决策 28~31，落地结构对齐决策 28 与 offline 提级决策 29 的剩余部分）。①PRD 落版：Module_01 PRD v3.25→v3.26（§5.4 新增认证/TLS 最小集 auth_type/username/password|token/tls_skip_verify/ca_file——决策 31、冻结域禁止新建 Job 及新增实例——决策 30、§6.2/§11/§9 同步）；Module_09 PRD v1.49→v1.50（§3.3 认证/TLS 透传映射进 scrape_configs——决策 31、§3.4 冻结域不生成新变更单——决策 30、§3.5 变更状态回写 deployed 提前 MVP——决策 31-M2、§5.1 删除未指定网域资源自动归 default 兜底——决策 31-M3）；Module_07 PRD v2.19→v2.20（§8.1 offline 排除提级 P0——决策 29、资源列表「未监控」筛选——决策 31-M1）。②原型：M01/M07/M09 原型本次未同步，对齐状态改「⚠️ 原型待同步」。③M06 §9.2 决策 30-3 联动用例已存在、无需新增 | Module_01 / Module_07 / Module_09 | 文档自身 | 使用中 |
| v1.38 | 2026-08-21 | 修改 | 同步 Module_01/M09 四模块 MVP 残余缺陷收敛（决策 28/29）。①PRD 落版：Module_01 PRD v3.24→v3.25（§3.1/§5.4/§8/§9 `offline` 排除提级 P0——候选集 `Resource.status=offline` 实例显示但置灰不可选、已选实例转 offline 后 M09 配置生成跳过）；Module_09 PRD v1.48→v1.49（§1/§3.1.1/§5.1 网域契约结构性对齐——NetworkDomain 行政模型以 Module_06 为单一事实来源、删除旧语义、ID 规则置 M06；§3.3 实例过滤 offline 排除提级 MVP 必实现）。②原型同步：Module_01 原型 v3.24→v3.25（实例候选 Transfer 对 offline 置灰 disabled + 标题/描述标「已下线」、实例选择区 ReviewNote 提级改写、新增 default 域 mysql 下线副本 res-mw-005 演示）；Module_09 原型 v1.48→v1.49（「配置产物结构说明」ReviewNote offline 提级改写、targets mock 注释补 offline 过滤语义、MainLayout 版本声明同步）。两模块对齐标记「✅ 对齐」 | Module_01 / Module_09 | 文档自身 | 使用中 |
| v1.37 | 2026-08-21 | 修改 | 同步 Module_01/M09 规则文件挂载（决策 38-1，MVP 补齐 M01↔M09 规则链路契约）：Module_01 PRD v3.23→v3.24 / 原型 v3.23→v3.24（§5.5 MonitoringRule 启用 content_mode=yaml_passthrough + rule_content、§3.1 新增「规则文件挂载」功能行、§3.2 澄清与 v0.3 字段级编辑边界、§6.2 规则 API 契约、§9 验收新增挂载项；原型规则编辑页新增「文件挂载」视图——粘贴/上传 rules.yml + 基础 YAML 校验 + 规则条数展示、保存/启停/删除后经 M09 变更单确认下发、change_status 全链路回写，「字段化编辑」为 v0.3 预览）；Module_09 PRD v1.47→v1.48 / 原型 v1.47→v1.48（rules.yml 生成改为 rule_content 原样透传并入、不按字段派生，v0.3 structured 后恢复派生；注释/ReviewNote/规则分组说明同步）；两模块对齐改「✅ 对齐」；产品路线图 §2.4 MVP 规则管理口径随决策 38-1 同步（roadmap v1.7） | Module_01 / Module_09 / Roadmap | 文档自身 | 使用中 |
| v1.36 | 2026-08-21 | 修改 | 同步 Module_09 MVP 缺憾补漏（决策 42 系列）：PRD v1.46→v1.47 / 原型 v1.46→v1.47（同域 pending「后单取代前单」superseded、校验失败草稿「重新校验/废弃」闭环、`local` reload 失败重试入口、configgen 异常「生成失败」态、§9 验收收敛 MVP 边界标注 {v0.2}），对齐保持「✅ 对齐」（本轮为契约与闭环补口子、不改原型行为） | Module_09 | 文档自身 | 使用中 |
| v1.35 | 2026-08-19 | 修改 | 同步 Module_06 决策 23 MVP 缺憾补漏：PRD v2.1→v2.2（§1 无鉴权声明 + 种子数据 migration upsert；§4 新增 4.0 MVP 网域登记流程；§5.1 suspended 预留标注；§5.2 id deploy_code 前缀来源 / 登记归属创建后不可变更 / authorized_tenant_ids 可选缺省；§6.2 新增 GET zone-types 只读接口 + DELETE 空域删除 + PUT 移除登记归属 + PATCH 禁用冻结语义；§9 补 6 条技术 + 3 条用户验收；§11.2 删除限制规则）/ 原型 v2.1→v2.2（登记归属编辑只读、授权租户去必填默认回填、禁用二次确认展示影响范围、空网域删除按钮、mock zone-types 接口来源注释），对齐保持「✅ 对齐」 | Module_06 | 文档自身 | 使用中 |：Module_01 PRD v3.22→v3.23 / 原型 v3.20→v3.23（§3.1 实例选择与实例选择方式补 offline/maintenance 排除目标语义、M01-ARCH-01「未纳入任何 Job」筛选器声明 MVP 不保证随本模块落地；实例选择区 ReviewNote + 版本声明同步）；Module_09 PRD v1.45→v1.46 / 原型 v1.45→v1.46（§3.3 实例过滤声明 offline 排除目标语义、MVP 不保证随 M01 节奏落地；配置产物结构 ReviewNote + 版本声明同步）；本轮为契约声明，不改原型行为，两模块对齐改「✅ 对齐」 | Module_01 / Module_09 | 文档自身 | 使用中 |
| v1.33 | 2026-08-19 | 修改 | 同步 Module_07 评审结论落版（2026-08-19 第三轮）：PRD v2.18→v2.19 / 原型 v2.8→v2.9（业务字典 MVP 运维口径——配置 business_domains.yaml 热加载 + 兜底 infra + 未登记报错可执行指引；导出模板后端生成静态 xlsx 内置取值说明 sheet；upsert 不删除 + 批量下线动线；offline 排除语义降级随 M01 节奏；5.17 示例补 biz_code），对齐改「✅ 对齐（v2.17~v2.19 已同步）」 | Module_07 | 文档自身 | 使用中 |
| v1.32 | 2026-08-19 | 修改 | 同步 Module_09 external_labels 标签集收敛（2026-08-19 决策 19/23）：PRD v1.44→v1.45（§3.3.1 external_labels 移除 tenant_id、保留 network_domain_id / zone_type / replica 部署级元数据；§3.3/§5 明确 biz 与 tenant 均由 M07 LabelTemplate 以 target 级注入、M09 不单独注入；§5 配置目录 MVP 按 network_domain 分目录、多租户命名空间 {v0.2+} 占位）/ 原型 v1.44→v1.45（prometheus.yml 各域 external_labels 收敛、targets 注入链路注释补全、测试断言与 ReviewNote 同步），对齐保持「✅ 对齐」 | Module_09 | 文档自身 | 使用中 |
| v1.31 | 2026-08-19 | 修改 | 同步 Module_06 决策 21~22 落版 + §11.1 筛选补齐：PRD v2.0→v2.1（§4.3/§9.2/§10 `business_domain` 改 `biz_code` / `biz_name`，指标标签保持 `biz`）/ 原型 v2.0→v2.1（租户页名称/状态筛选、网域页登记归属/网络区域类型/状态/授权租户筛选、审计日志页操作类型/操作人/操作时间筛选），对齐保持「✅ 对齐」 | Module_06 | 文档自身 | 使用中 |
| v1.30 | 2026-08-19 | 修改 | 同步 Module_06 决策 18~20 落版（网域可跨租户共享）：PRD v1.9→v2.0（§3.2 清除「1 网域 : 1 租户 / 禁止跨租户共享」残留，改网域为部署级资源、可跨租户共享、租户通过授权 scope 使用；§5.2 新增 `authorized_tenant_ids`、`tenant_id` 语义改登记归属；§6.2 创建不再校验唯一租户归属；§5.2 id 前缀改部署级）/ 原型 v1.9→v2.0（网域页「所属租户」改「登记归属」固定 platform_admin + 新增「授权租户」多选与表格列、ID 部署级前缀 nd-；租户页 multi_site_enabled 语义改「被授权使用多个网域」；mock nd-default 演示 1 网域 : N 租户共享），对齐保持「✅ 对齐」 | Module_06 | 文档自身 | 使用中 |
| v1.29 | 2026-08-19 | 修改 | 同步 Module_09 业务-网域正交性对齐（2026-08-19 业务登记与网域-业务正交性决策）：PRD v1.43→v1.44（§5.1 补「网域与业务正交」说明）/ 原型 v1.43→v1.44（biz 标签注入链路说明补全 + 多业务共用 1 网域演示 + 业务归属变更待确认草稿 draft-gov-004），对齐保持「✅ 对齐」 | Module_09 | 文档自身 | 使用中 |
| v1.28 | 2026-08-19 | 修改 | 同步 Module_06 原型对齐（PRD v1.7~v1.9）：原型 v1.3→v1.9（网域登记纳入 MVP、租户与业务解耦——移除 CMDB 业务列/表单项、租户 mock 与用户表 tenantName 改为团队/组织语义（平台运营部 / 电商研发部 / 金融运维部）、README 更新），对齐改「✅ 对齐（v1.7~v1.9 已同步）」 | Module_06 | 文档自身 | 使用中 |
| v1.27 | 2026-08-19 | 修改 | 同步 Module_06 决策 12~17 落版收尾：PRD v1.8→v1.9（§3.2 补「租户、网域、业务三者正交」说明；§10 术语表 `cmdb_business_id`/`cmdb_business_path` 改指 M07 业务字典条目），原型仍 v1.3，对齐保持「⚠️ 原型待同步（v1.7~v1.9）」 | Module_06 | 文档自身 | 使用中 |
| v1.26 | 2026-08-18 | 修改 | M07 评审结论落版跨模块同步：Module_07 PRD v2.15→v2.16（评审结论落版：导入 upsert、Application 粒度=服务实例、取消 is_monitored、status 行为语义、网域登记纳入 MVP、必填差异化、模板快照等，对齐改「⚠️ 原型待同步」）；Module_06 PRD v1.6→v1.7（网域登记纳入 MVP，原型待同步）；Roadmap v1.5→v1.6（五类资源、M06 MVP 补网域登记、去隐藏网域概念、排期待重估）；全局用户故事库 ARCH-03 落点调整；全局架构网域 Owner 口径回写（行政归 M06 / 纳管归 M09） | Module_06 / Module_07 / Roadmap / 全局库 / 全局架构 | 文档自身 | 使用中 |
| v1.25 | 2026-08-18 | 修改 | 同步 Module_09 PRD 与原型对齐（决策 41）：PRD v1.41→v1.42 / 原型 v1.40→v1.42（未同步按成因分档标签化展示：待确认变更 / 生效中 / 本地校验失败；进程异常行级高亮 + 抽屉高危横幅；平铺表新增 Edge Sync Agent 状态列；manual_override 术语统一「人工覆盖」），对齐改「✅ 对齐」 | Module_09 | 文档自身 | 使用中 |
| v1.24 | 2026-08-18 | 修改 | 同步 Module_01/M09 草稿/批量提交生效方案迭代：Module_01 PRD v3.21→v3.22（新增 `draft_status`/`change_status`，草稿仅新建阶段单向 draft→ready、不做快照；MVP 四态占位；v0.2 Job 草稿 + 批量提交生效 + 克隆 Job；v0.3 规则草稿），原型版本仍为 v3.20，对齐改「⚠️ 原型待同步」；Module_09 PRD v1.40→v1.41（配置生成过滤 draft_status=ready、change_status 扩展 deployed、回写 M01 规则），原型版本仍为 v1.40，对齐改「⚠️ 原型待同步」 | Module_01 / Module_09 | 文档自身 | 使用中 |
| v1.23 | 2026-08-18 | 修改 | 同步 Module_07 PRD 按 prototype-designer.md 骨架（章节 1-11 冻结 + Change Log）重构：PRD 版本 v2.14→v2.15，状态保持设计中，原型版本仍为 v2.7（结构改造不涉及原型），对齐改「⚠️ 原型待同步（v2.15 章节骨架结构改造，不涉及原型）」；完整历史迁 design-decisions.md（补迁 v2.7-v2.12）；本次为结构改造，不改变产品语义 | Module_07 | 文档自身 | 使用中 |
| v1.22 | 2026-08-18 | 修改 | 同步 Module_01 PRD 按 prototype-designer.md 骨架（章节 1-11 冻结 + Change Log）重构：PRD 版本 v3.20→v3.21，状态保持设计中，原型版本仍为 v3.20（结构改造不涉及原型），对齐改「⚠️ 原型待同步（v3.21 章节骨架结构改造，不涉及原型）」；完整历史迁 design-decisions.md（补迁 v3.16/v3.17/v3.18）；本次为结构改造，不改变产品语义 | Module_01 | 文档自身 | 使用中 |
| v1.21 | 2026-08-18 | 修改 | 同步 Module_06 PRD 按 prototype-designer.md 骨架（章节 1-11 冻结 + Change Log）重构：PRD 版本 v1.5→v1.6，状态保持设计中，原型版本仍为 v1.3（结构改造不涉及原型），对齐改「⚠️ 原型待同步（v1.6 章节骨架结构改造，不涉及原型）」；本次为结构改造，不改变产品语义 | Module_06 | 文档自身 | 使用中 |
| v1.20 | 2026-08-18 | 修改 | 同步 Module_09 PRD 按 prototype-designer.md v1.27+ 骨架改造：PRD 版本 v1.38→v1.40，状态保持 prototyping，原型版本同步 v1.40，对齐改「✅ 对齐（v1.40 已按 prototype-designer.md 骨架改造）」；本次为结构改造，不改变产品语义 | Module_09 | 文档自身 | 使用中 |
| v1.19 | 2026-08-17 | 修改 | 同步 Module_01/M09 版本与原型对齐：Module_01 v3.19→v3.20（决策 D28 规则编辑引导确认 + 规则列表下发状态列）；Module_09 v1.37→v1.38（决策 38 分级下发 target 自动生效 / 校验失败「重新校验」动线 / 重试语义）；两模块原型同步（M01 v3.20 / M09 v1.38），对齐保持 ✅ | Module_01 / Module_09 | 文档自身 | 使用中 |
| v1.18 | 2026-08-17 | 修改 | 同步 Module_01/M09 原型对齐（12 条断点修复）：Module_01 原型 v3.2→v3.19（下发状态列 + 保存/启停/删除引导「变更将由 M09 生成变更单」+ URL 网域预选 + multi_site_enabled=false）；Module_09 原型 v1.24→v1.37（配置变更确认页网域级配置同步状态 + 单域收敛 + 校验失败草稿迁至 default 域可达 + DeploymentsPage 重试/详情 Drawer/定位 + EdgeAgentsPage 五档同步状态引导修正 + mock 数据修复），对齐改「✅ 对齐」 | Module_01 / Module_09 | 文档自身 | 使用中 |
| v1.17 | 2026-08-17 | 修改 | 同步 Module_01/M09 版本对齐：Module_01 v3.18→v3.19（第二十九轮 MVP 单域动线闭环，决策 D27——规则编辑 UI 确认 v0.3 不进 MVP / change_status 提前 MVP + 保存引导 + §4 步骤 3 补人工确认 + pull 口径）；Module_09 v1.36→v1.37（决策 37——local 通道网域级配置同步状态承载于配置变更确认页 + reload 失败重试路径 + 检测状态可观测 P1→P0）；两模块原型本轮不修改，对齐改「⚠️ 原型待同步」 | Module_01 / Module_09 | 文档自身 | 使用中 |
| v1.16 | 2026-08-15 | 修改 | 同步 Module_09 原型对齐：PRD v1.31→v1.32 / 原型 v1.23→v1.24（v1.31 网闸拓扑 center_endpoint/zone_type/网闸约束 + v1.32 告警规则职责重构 rules group 派生/审批分级 alertmanager.yml 由 M08 管理），对齐改「✅ 对齐」 | Module_09 | 文档自身 | 使用中 |
| v1.15 | 2026-08-15 | 修改 | 网域两层关系落地同步（政务云互联网区/政务外网区需求讨论）：Module_06 v1.3→v1.4（zone_type 部署级字典 + 网域定义唯一入口）；Module_07 v2.11→v2.12（区域属性 SSOT + 网域列下拉 + 唯一性按网域收敛）；Module_09 v1.30→v1.31（center_endpoint + 绝对下载地址 + 网闸连接约束 + MVP 后实测标记）；三模块原型待同步，对齐改 ⚠️ | Module_06 / Module_07 / Module_09 | 文档自身 | 使用中 |
| v1.14 | 2026-08-15 | 修改 | ready 前内容缺口修正后同步：Module_01 PRD v3.9→v3.10 / 原型 v3.1→v3.2；Module_07 PRD v2.10→v2.11 / 原型 v2.6→v2.7；Module_09 PRD v1.29→v1.30 / 原型 v1.22→v1.23 | Module_01 / Module_07 / Module_09 | 文档自身 | 使用中 |
| v1.13 | 2026-08-14 | 修改 | 同步 Module_01 原型对齐：原型 v2.9→v3.0（双层锚点落地：指标库按 CI 类型分组 + 来源标注 + 语义域、默认采集器 UI + is_default、删「登记自定义模板 P2」占位入口、Job 手填模式），对齐改「✅ 对齐」 | Module_01 | 文档自身 | 使用中 |
| v1.12 | 2026-08-14 | 修改 | 同步 Module_01 版本对齐：v3.7→v3.8（指标库锚点演进 + Exporter 模板降级为采集实现，第十七轮 + 用户评审修正双层锚点；原型待同步 v3.0，对齐改 ⚠️） | Module_01 | 文档自身 | 使用中 |
| v1.11 | 2026-08-14 | 修改 | 同步 Module_01 版本对齐：v3.6→v3.7 + 原型 v2.8→v2.9（两库定位区分与导航归组 / 自定义微服务仍属 application_http + et-app-go 样本 / 业务视图 Tab + 采集落地列，第十六轮评审新问题落地） | Module_01 | 文档自身 | 使用中 |
| v1.10 | 2026-08-14 | 修改 | 同步 Module_04 原型对齐：原型 v1.1→v1.2（BlueKing 字段映射 business_domain 同步说明 + 待分类 CI 新类型引导闭环），对齐改「✅ 对齐」；补全 M07 完整历史 v2.5 行 | Module_04 / Module_07 | 文档自身 | 使用中 |
| v1.9 | 2026-08-14 | 修改 | 同步 Module_07 版本对齐：v2.8→v2.9 + 原型 v2.4→v2.5（组合字段 MVP 内部默认：前台隐藏 + 默认模板标注，第十七轮） | Module_07 | 文档自身 | 使用中 |
| v1.8 | 2026-08-14 | 修改 | 同步 Module_09 原型对齐：原型 v1.20→v1.21（targets labels 补 app/biz 注入 + 确认页 ITIL 边界声明 + Agent 断网自治说明），对齐改「✅ 对齐」 | Module_09 | 文档自身 | 使用中 |
| v1.7 | 2026-08-14 | 修改 | 同步 Module_09 版本对齐：v1.27→v1.28（审批分层 ITIL 边界声明 + 版本一致性语义 + 断网草稿说明，第十六轮；原型待同步） | Module_09 | 文档自身 | 使用中 |
| v1.6 | 2026-08-14 | 修改 | 同步 Module_01 原型对齐：原型 v2.7→v2.8（角色切换 + 业务指标库页 + application_http 语义 + biz 筛选），对齐改「✅ 对齐」；两段式评审通过（MVP 范围） | Module_01 | 文档自身 | 使用中 |
| v1.5 | 2026-08-14 | 修改 | 同步 Module_01 版本对齐：v3.5→v3.6（业务指标动线分离：登记动作≠语义所有权 + 聚合视图 v0.2+，第十五轮；原型待同步） | Module_01 | 文档自身 | 使用中 |
| v1.4 | 2026-08-14 | 修改 | 同步 Module_01 版本对齐：v3.4→v3.5（业务指标库 BusinessMetric，第十四轮；原型待同步） | Module_01 | 文档自身 | 使用中 |
| v1.3 | 2026-08-14 | 修改 | 同步跨模块版本对齐（第十三轮 + 评审前完善）：Module_09 v1.26→v1.27（业务指标标签规范消费标注，对齐）；Module_01 v3.4（application_http + filter + service_discovery，原型待同步）；Module_04 v1.2（business_domain 同步映射，原型落后） | Module_01 / Module_04 / Module_09 | 文档自身 | 使用中 |
| v1.2 | 2026-08-14 | 修改 | 同步跨模块版本对齐（第十三轮）：Module_01 v3.3→v3.4（application_http 语义 + 新类型引导闭环 + filter 字段语义 + service_discovery 预留，原型待同步）；Module_04 v1.1→v1.2（business_domain 同步映射，原型落后） | Module_01 / Module_04 | 文档自身 | 使用中 |
| v1.1 | 2026-08-14 | 修改 | 同步 Module_07 版本对齐：PRD v2.7→v2.8、原型 v2.3→v2.4、对齐改为「⚠️ 原型待同步」（第十二轮 标签双场景治理 + 业务指标关联，仅文档层落地） | Module_07 | 文档自身 | 使用中 |
| v1.0 | 2026-08-13 | 初始 | 创建模块目录与版本对齐总表 | 全部模块 | 文档自身 | 使用中 |
