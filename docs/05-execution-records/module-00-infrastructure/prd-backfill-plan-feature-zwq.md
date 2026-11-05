# feature/zwq 10-24 后 PRD 回填计划

> **状态**：待执行（draft，2026-11-05）
> **范围**：`docs/02-product-requirements/Modules/Module_01/02/03/05/07/08/11`、`Modules/README.md`
> **依据**：`origin/feature/zwq` 2026-10-24 之后提交 + `docs/05-execution-records/module-*/` 执行记录与 design-proposal
> **执行角色**：proposal-designer（项目无独立 Agent 文件，按 `prototype-designer` 规则执行）
> **原则**：本轮只回填 PRD，不改 `platform/`、不改 `ui-custom/web/`、不同步原型；一批一个可独立 revert 的 commit。

---

## 1. 范围结论

### 1.1 已确认纳入（12 项）

| 序号 | 用户问题 | 结论 | 主要提交 |
|---|---|---|---|
| 1 | 告警面板改为当日已发生 / 当日已恢复 / 历史待处理 / 历史告警今日已恢复 | 已落地，回填 M08 + M05 | `0ba1fc6`、`881cea8`、`3376b8d`、`fde2dd5` |
| 3 | 应用服务健康检查地址是否可多选 | **不做多选**；只回填「一行一个 URL，多环境登记多行」 | `af2df21` |
| 4 | 应用服务 URL 必填、IP/端口选填 | 已落地，回填 M07 | `af2df21` |
| 5 | 监控目标状态中没有拨测监控 | 已落地，回填 M02 + M11 | `5c499eb` |
| 6 | 新增告警抑制、面板挂载 | 已落地，分别回填 M08 / M05 | `070c76a`、`4a58a77`、`13b0215` |
| 7 | 今日恢复统计范围改为「今日发生的告警」 | 已落地，回填 M08 + M05 | `a8a7508`、`881cea8` |
| 8 | 历史告警增加导出 | 已落地，回填 M08 | `a8a7508`、`d2b6335` |
| 9 | 采集器新增 NPU node | 已落地（新增监控类型，不新增采集器登记页），回填 M01 | `51f4eed` |
| 11 | 应用服务面板增加负责人 / 运维人 / 联系方式 / 上线时间 | 已落地，回填 M07 | `be87202`、`da24ef2` |
| 12 | 资源开通时间加入 CMDB 字段（先做主机） | 已落地，回填 M07 | `da24ef2`、`6644437` |
| 13 | 资源标签映射改为批量添加 | 已落地，回填 M07 | `5828ab6` |
| 14 | 新增账号登出 | 已落地，回填 M03 | `2c2a107` |

### 1.2 已确认不做（2 项）

| 序号 | 用户问题 | 结论 |
|---|---|---|
| 2 | 静默选择主机名后回显 `resource_id` 不直观 | **不做**；PRD 维持现有 `resource_id` matcher 口径，不写成已优化。10-24 后也无可对应提交。 |
| 10 | Grafana 的拨测面板信息优化 | **不做**；确认与本产品无关，不纳入任何 PRD 批次。 |

### 1.3 关联但未纳入本轮的提交

以下提交与上述功能同批出现，但不在用户确认的 14 项内。默认**不纳入**，如需同步另行确认：

- M01 拨测模块管理与页面归属/保存下发：`9476e9e`、`dac2242`
- M02 部分采集中（`partial_collecting`）：`b1594e3`
- M09 网域/云/区域中文展示标签：`4550111`
- M11 删除「回传延迟」列：`ffb991e`
- M07 删除预置默认标签模板、资源筛选导出 CSV：`be87202`
- M08 配置回退幂等修复：`8ec61cd`
- M09 blackbox 抓取地址 19115：`b2d636a`

> 这些提交若不同步，PRD 会与 as-built 存在局部偏差；但为避免本轮范围失控，先单独挂账。

---

## 2. 分批计划

> 建议执行顺序：**A → B → C → D → E → F → G → H**。
> 若希望先验证回填流程，可先做 H / G 两个小批次，再回到 A。

| 批次 | 覆盖项 | 模块 / 版本建议 | 提交单元 |
|---|---|---|---|
| A | 1、7、8 | M08 v1.20→v1.21；M05 v1.13→v1.14 | `docs(module-08): PRD 回填 - 告警事件模型与首页四指标` + 同 commit 的 M05 章节 |
| B | 6（告警抑制） | M08 v1.21→v1.22 | `docs(module-08): PRD 回填 - 告警抑制独立页面与 API` |
| C | 3、4、11、12 | M07 v2.53→v2.54 | `docs(module-07): PRD 回填 - 应用服务字段与主机开通时间` |
| D | 13 | M07 v2.54→v2.55 | `docs(module-07): PRD 回填 - 标签映射批量编辑` |
| E | 6（面板挂载） | M05 v1.14→v1.15 | `docs(module-05): PRD 回填 - Grafana 面板挂载 MVP 化` |
| F | 5 | M02 v1.18→v1.19；M11 v0.11→v0.12 | `docs(module-02/11): PRD 回填 - 目标状态纳入拨测与心跳保留` |
| G | 9 | M01 v3.53→v3.54 | `docs(module-01): PRD 回填 - 新增 NPU 监控类型` |
| H | 14 | M03 v1.4→v1.5 | `docs(module-03): PRD 回填 - 账号菜单退出登录` |

> 版本号按实际执行顺序递增；若调整批次顺序，以当前文件头版本为起点重新计算。

---

## 3. 分批详细落点

### 批次 A：M08 告警事件模型 + 首页四指标 + 历史告警导出

**覆盖项**：1、7、8

**依据**
- Design-proposal：`docs/05-execution-records/module-08/design-proposals/alert-history-model-and-home-metrics.md`（approved 2026-10-26）
- Design-proposal：`docs/05-execution-records/module-08/design-proposals/alert-event-single-source.md`（approved 2026-10-29）
- Dev-feedback：M08 #53~#60
- 提交：`82f2e67`、`0ba1fc6`、`447333f`、`fa46eb1`、`a8a7508`、`881cea8`、`d2b6335`、`3376b8d`、`fde2dd5`

**M08 PRD 落点**
- §3.1 / §3.2：历史告警数据源由 Prometheus `ALERTS` 反推改为 `alert_events` 单一事实源；当前告警改为 event 表未结三态（告警中 / 静默中 / 抑制中）。
- §4.4：当前告警与历史告警的数据流重写；取消 AM 通知四态视图，Prometheus 规则求值保留为「规则评估」参考。
- §5.4：补 `AlertEvent` 模型：`occurrence_key`、`closed_at`、七态（firing / silenced / inhibited / resolved / silenced_closed / inhibited_closed / lost）、UTC+8 时间存储、保留清理。
- §6.x：补 `/alert-events`、`/alert-events/current`、`/alert-events/stats`；`status=open` 分组；`description` 搜索；历史导出为前端 CSV。
- §9.1 / §9.2：四指标口径、当前告警三态、历史七态、导出列、失败降级、互斥口径验收。
- §10：补「今日告警」「今日告警今日恢复」「历史遗留告警」「历史遗留今日恢复」「当前告警」。
- §11.3 / §11.4：告警状态页页签收敛；历史告警页列、筛选、关闭时间、实例名、导出。
- §11.1：页面矩阵状态词同步。

**M05 PRD 落点**
- §4.2：告警状态卡数据流改为 `GET /alert-events/stats` + `GET /alert-events/current`；删除 AM 通知四态与 M02 历史链路。
- §9：首页告警卡验收改为四格 + 当前告警卡内滚动、不分页。
- §10：术语同步。
- §11.3：四格文案按 as-landed：**今日告警 / 今日告警今日恢复 / 历史遗留告警 / 历史遗留今日恢复**；右栏「当前告警」为 event 表未结三态，取消分页、卡内滚动。

**关键口径**
- 今日告警：`starts_at` 落在今天自然日内。
- 今日告警今日恢复：今天开始且今天关闭；**不含昨天开始、今天恢复的告警**。
- 历史遗留告警：今天 0 点前开始，且当前未结或今天关闭。
- 历史遗留今日恢复：历史遗留告警中今天关闭的子集。
- 首页右栏只展示 event 表未结三态；无未结告警时显示「当前无告警」。

**收尾**
- 两个 design-proposal 状态改 `merged`；PRD Change Log 记录「吸收 design-proposal `alert-history-model-and-home-metrics` / `alert-event-single-source`」。
- 旧 `/api/v1/alerts/history` 标注为兼容保留、首页不再消费，避免与 M02 §5.4 冲突。

---

### 批次 B：M08 告警抑制独立功能

**覆盖项**：6（告警抑制）

**依据**
- Dev-feedback：M08 #55
- 提交：`070c76a`
- 契约快照：`docs/05-execution-records/module-08/api-contract-snapshot.md` §12

**PRD 落点**
- §3.1：抑制从「仅网域离线自动生成」改为「独立页面 + 独立 API + 可编辑规则」。
- §4.3：重写抑制规则管理——路由树与抑制规则共用同一 `alertmanager.yml` 生成器；保存路由保留当前抑制，保存抑制保留当前路由；统一走 amtool、版本留痕、M09 pending 变更单、人工确认、写盘与 reload。
- §5.4：`InhibitionRule` 字段按 as-landed 对齐（`source_matchers` / `target_matchers` / `equal` / `enabled`；名称用注释往返保留）；删除与实现不符的 `is_builtin` 口径。
- §6.x：补 `/inhibitions` 查询 / 保存接口；`effective_checksum` 乐观锁；A/B 分段 pending 提示（`route_changed` / `inhibit_rules_changed`）。
- §9：补抑制规则保存、启停、空数组清空、路由/抑制互不覆盖、amtool 校验、变更单验收。
- §11.1 / 新增 §11.8：新增「告警抑制」页面契约（只读 → 编辑 → 批量增删改 → 保存/放弃）。

**明确不做**
- 不把抑制字段塞进 `/routes` 请求体。
- 不新增数据库表；以最新产品视图 YAML 为配置源。
- 静默 `resource_id` 回显不修改；§4.2.1 / §11.5 维持现状。

---

### 批次 C：M07 应用服务字段 / 校验 + 主机开通时间

**覆盖项**：3、4、11、12

**依据**
- Dev-feedback：M07 F-34、F-35 前的字段变更
- 提交：`af2df21`、`be87202`、`da24ef2`、`6644437`
- 契约快照：`docs/05-execution-records/module-07/api-contract-snapshot.md`

**PRD 落点**
- §5.6 主机资源：新增可选 `activated_at`（开通时间），仅主机；详情、Excel 模板、CSV 导出、标签来源同步。
- §5.8 应用服务：
  - `health_check_url` 改为**必填**，作为 blackbox 拨测目标地址；
  - `endpoint` / `port` 改为**选填**，`port=0` 表示未设置；standard 指标采集使用 `endpoint:port`；
  - application 判重键改为 `(network_domain_id, service_name, health_check_url)`；
  - 新增 `owner1` / `owner1_contact` / `owner2` / `owner2_contact` / `ops_person` / `ops_person_contact` / `go_live_at`；
  - 旧 `owner` 保留，存量 migration 回填 `owner1`；
  - 明确「一行一个健康检查地址；多环境 = 多行」，**不做单行多选**。
- §5.12.1：资源字段来源补齐上述字段；空值不注入标签。
- §5.16.1 / §5.16.2：Excel 模板列、必填校验、导入 upsert 定位键同步。
- §9.1 / §9.2：URL 必填、端点/端口可选、多环境多行、负责人/运维/上线时间、主机开通时间验收。
- §11.2：应用表单负责人/运维人员横排（左姓名右联系方式）；主机表单开通时间。

**明确不做**
- 不新增 `health_check_urls[]` 多值字段。
- 不改变 standard / blackbox 双 Job 口径：blackbox 用 `health_check_url`，standard 用 `endpoint + port`；仅 URL 的资源不冒充指标端点。

**挂账**
- `be87202` 同时删除预置默认标签模板、增加资源筛选 CSV 导出；本批不处理，另行确认。

---

### 批次 D：M07 标签映射批量编辑

**覆盖项**：13

**依据**
- Dev-feedback：M07 F-35
- 提交：`5828ab6`
- 后端记录：`docs/05-execution-records/module-07/backend-developer.md` F-35

**PRD 落点**
- §3.2.1：标签映射交互由「逐条新增立即保存」改为「编辑进入表格，本地草稿，批量增删改后统一保存」；取消或校验失败不落库且保留编辑内容。
- §5.11：映射模型与校验规则不变；补「整组替换」语义。
- §6.3 / §6.6.3：新增 `PUT /api/v2/platform/label-templates/{template_id}/mappings`，请求 `{mappings: MappingInput[]}`，完整替换，空数组表示清空；整组校验、模板写入与本批审计快照同事务；默认模板只读；原单条接口保留兼容。
- §9.1 / §9.2：批量新增/修改/删除、清空、重复 target_label、保护 label、默认模板只读、事务回滚、no-op 不写快照。
- §11.2：标签模板页交互细则同步。

---

### 批次 E：M05 Grafana 面板挂载 MVP 化

**覆盖项**：6（面板挂载）

**依据**
- Dev-feedback：M05 反馈 13、14
- 提交：`4a58a77`、`13b0215`、`6a82c45`
- 契约快照：`docs/05-execution-records/module-05/api-contract-snapshot.md` §5

**PRD 落点**
- §1 / §3.1：面板挂载从 `{v0.3}` 提前到 **MVP**；管理员配置「面板名称 + Grafana URL」，首页「自定义大屏」下生成动态菜单。
- §4.3：导航层级补动态大屏菜单；保留「概览 Dashboard」为首页子页。
- §5.3：新增 `dashboard_panels` 模型（`id` / `name` / `url` / 创建时间 / 更新时间）。
- §6：新增 `GET/POST /api/v2/platform/dashboard/panels`、`GET/PUT /api/v2/platform/dashboard/panels/:id`；管理员写、普通用户只读。
- §9：面板新增、重名、URL 校验、编辑回显、普通用户 403、iframe kiosk/hideLogo、同源双击/Esc 屏蔽验收。
- §11.1：新增「自定义大屏 / 面板管理」与动态展示页；§11.4 由「v0.3 预置模板」改写为「MVP 用户挂载 URL + 后续预置模板演进」。
- 跨文档：`02_Product_Roadmap.md` 与 `Modules/README.md` 的 M05 版本覆盖同步「面板挂载提前到 MVP」。

**明确不做**
- 不做 Grafana 账号托管、面板编辑、预置模板 provisioning 改造。
- Grafana 登录与 `allow_embedding` 由 Grafana 侧负责，平台不绕过。
- 拨测面板优化不纳入本批（已确认与本产品无关）。

---

### 批次 F：M02 + M11 监控目标状态纳入拨测

**覆盖项**：5

**依据**
- Dev-feedback：M11 F-25
- 提交：`5c499eb`

**PRD 落点**
- M02 §3.2：删除「`job_type=blackbox` 的 target 不入融合结果」旧口径；standard / blackbox 统一进入目标状态融合。
- M02 §5.3：明确 `health` 表示采集链路状态（抓取是否成功），不等于 `probe_success` 的业务拨测结果；拨测业务结果仍由 M01 实例状态 / 首页拨测面板消费。
- M02 §6.1 / §9.1 / §9.2：补 blackbox target 可见、local/edge 去重、按 Job/网域/health 筛选验收。
- M11 §5.3：补心跳历史保留策略——默认 7 天、`EDGE_HEARTBEAT_RETENTION_DAYS` 可调、启动即清理 + 每 24 小时、每批 1000 条、单网域最多 10 万条、`(network_domain_id, timestamp)` 索引。
- M11 §6.2 / §9.2：目标快照包含 blackbox target；保留清理不影响 `edge_agents` 最新状态与 `edge_target_snapshots`。

---

### 批次 G：M01 新增 NPU 监控类型

**覆盖项**：9

**依据**
- 后端记录：`docs/05-execution-records/module-01/backend-developer.md` M01-NPU-01
- 提交：`51f4eed`
- 契约快照：`docs/05-execution-records/module-01/api-contract-snapshot.md`

**PRD 落点**
- §5.1.8：`monitor_type` 列表增加 `npu`；映射表补 `host + npu`；NPU 作为主机附加采集能力，候选主机全集，不按 OS / 型号过滤。
- §5.2：ScrapeJob `monitor_type` 枚举与选择器同步。
- §9：Job 创建/编辑可选 NPU、主机候选覆盖验收。
- §10：术语同步。
- API 契约快照：`monitor_type` 枚举增加 `npu`。

**明确不做**
- 不新增 NPU 采集器登记页 / 安装页；采集参数沿用现有主机 Job 流程。

---

### 批次 H：M03 账号菜单退出登录

**覆盖项**：14

**依据**
- 提交：`2c2a107`

**PRD 落点**
- §4.1：补登出交互——账号下拉菜单提供「退出登录」；先尽力调用服务端销毁会话，再清本地 Token / 用户缓存；服务端调用失败不阻断本地登出。
- §6：`POST /api/v2/platform/auth/logout` 已存在，本次只补 UI 入口与失败降级，不新增后端契约。
- §9：补验收——登出后回登录页、Token 清除、服务端失败仍可本地退出。
- §11：补账号下拉菜单交互与文案。

---

## 4. 每批执行清单

- [ ] 阅读目标 PRD 当前章节、头部版本、Change Log、相关 design-decisions。
- [ ] 对照 `api-contract-snapshot.md` 与 dev-feedback，确认 as-landed 字段/接口/文案。
- [ ] 修改 PRD 正文；只动相关章节，不借机重构全文。
- [ ] 更新头部：PRD 版本 +1、更新日期、原型版本说明（本轮不同步原型）。
- [ ] Change Log 新增一行；超过 3 版时按现有规则轮转到 `design-decisions.md`。
- [ ] 更新 `docs/02-product-requirements/Modules/README.md` §1 总表对应行 + §5 Change Log。
- [ ] 跨模块一致性检查（见 §5）。
- [ ] `git diff --check`；确认无代码/原型改动。
- [ ] 提交一个独立 commit，commit message 按批次表。
- [ ] 执行记录：在本文件对应批次勾选，并记录 commit hash。

---

## 5. 跨模块一致性检查矩阵

| 批次 | 主模块 | 需同步检查 |
|---|---|---|
| A | M08、M05 | M02 `/api/v1/alerts/history` 兼容口径；M05 首页告警卡；M08 历史/当前页状态词 |
| B | M08 | M09 配置变更单；M01 规则标签 `inhibitable`；M08 路由保存 |
| C | M07 | M01 标签模板来源字段；M09 target 生成；M05 资源详情/导出 |
| D | M07 | M01 Job 引用模板；M07 标签模板页/详情页 |
| E | M05 | `02_Product_Roadmap.md`；M06 菜单/权限；M02 数据源红线（若涉及 Grafana datasource） |
| F | M02、M11 | M01 实例状态 / `probe_success`；M05 拨测深链；M09 目标状态页 |
| G | M01 | M07 host 资源类型；M01 默认采集配置 / 标签模板 |
| H | M03 | M06 用户管理；M05 全局布局 |

---

## 6. 回滚与提交规范

- 每批一个 commit；跨模块批次（A、F）仍合并为一个 commit，便于整批回滚。
- 回滚方式：`git revert <commit>`；因为只改文档，不涉及代码回退。
- 若某批需要拆分，允许按模块拆成两个 commit，但需在本文件记录拆分原因。
- 本轮不修改 `docs/prototypes/`；原型同步统一留到后续原型轮。

---

## 7. 待办勾选

- [ ] 批次 A：M08 事件模型 + M05 首页四指标 / 历史导出
- [ ] 批次 B：M08 告警抑制
- [ ] 批次 C：M07 应用服务字段 / 校验 + 主机开通时间
- [ ] 批次 D：M07 标签映射批量编辑
- [ ] 批次 E：M05 Grafana 面板挂载
- [ ] 批次 F：M02 / M11 目标状态纳入拨测
- [ ] 批次 G：M01 NPU 监控类型
- [ ] 批次 H：M03 账号登出

---

## 8. 变更记录

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-11-05 | 初稿 | 基于 `origin/feature/zwq` 2026-10-24 后提交整理；确认健康检查多选不做、Grafana 拨测面板不纳入、静默 `resource_id` 回显不做 |
