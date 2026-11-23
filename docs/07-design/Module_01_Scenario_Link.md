# 监控策略与指标管理 场景链接矩阵（Scenario Link）

> **状态**：draft（骨架已建，待场景走查）
> **Domain ID**：`DOMAIN-M01`
> **SRS**：[Module_01_Metric_Collection_Center_Requirements.md](../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md) v1.8
> **HLD**：[Module_01_Metric_Collection_Center_High_Level_Design.md](Module_01_Metric_Collection_Center_High_Level_Design.md) v1.4
> **演示脚本**：[scenario-walkthrough.md](../05-execution-records/module-01/scenario-walkthrough.md)
> **对外验收说明书**：`docs/07-design/Module_01_Acceptance.md`（待创建，派生，非追溯）
> **需求 Owner**：chenrt　**技术 Owner**：待指定
> **说明**：本表是双方唯一链接点；SRS/HLD 不再各自维护第二份追溯表。

---

## 1. 能力图例（技术内部）

| CAP | 意图 | 实现/扩展点 |
|-----|------|-------------|
| CAP-COLLECTION-TEMPLATE | 采集模板、采集实现池、标签模板绑定、字段字典 | m01 |
| CAP-SELECTOR | 选择器求值、候选预览、实例快照 | m01 |
| CAP-JOB-ORCHESTRATION | 单域 Job、跨域任务组扇出、整组启停 | m01 |
| CAP-RULE-GATE | 规则结构/job 引用/PromQL 检查与提交门禁 | m01 + promtool |
| CAP-METRIC-CATALOG | 技术/业务指标库、指标锚点、用户扩展 | m01 |
| CAP-SYNC-STATUS | 同步状态回写与实例采集状态回显 | m01（消费 m09） |
| CAP-RECONCILE | 资源删除对账回收、失效域子任务停用 | m01 |
| CAP-UI-STRATEGY | 采集策略导航、任务向导、规则与指标库页面 | ui-custom/web |
| CAP-AUTH-ADMIN | 登录鉴权与管理员写权限 | foundation |

> 能力是技术内部复用抽象，不要求需求方理解。

---

## 2. 场景链接矩阵

> 「验收结论」枚举：`—`（未走查）/ `pass` / `partial` / `failed`；与对外验收说明书映射：`pass → 通过`、`partial → 有条件通过`、`failed → 不通过`。

| SCN | 覆盖 FR/NFR | 验收（需求方语言） | 技术实现（CAP / mXX） | HLD 章节 | 演示 | 需求方反馈 | 验收结论 |
|-----|-------------|--------------------|------------------------|----------|------|------------|------|
| SCN-01 新增一种采集能力（NPU） | FR-01、FR-02、FR-03、FR-07、FR-09、FR-10、FR-20、FR-21、FR-23；NFR-06、NFR-11 | 新增模板即可用，条件命中可见，同一主机可被 OS/NPU 两条任务同时采集，全程无代码变更 | CAP-COLLECTION-TEMPLATE / CAP-SELECTOR / CAP-JOB-ORCHESTRATION / CAP-METRIC-CATALOG；m01 | §4.2、§6.1、§6.2、§7.1 | SCN-01 | 待走查 | — |
| SCN-02 创建跨网域采集任务（对象优先） | FR-05~09、FR-11、FR-22、FR-25~28；NFR-02、NFR-05、NFR-07 | 跨域筛选与分域预览可见，保存后逐域子任务生成，整组启停生效 | CAP-JOB-ORCHESTRATION / CAP-SELECTOR；m01 | §4.3、§6.3、§7.2、§8.2 | SCN-02 | 待走查 | — |
| SCN-03 配置并检查告警规则 | FR-14~17；NFR-07、NFR-10 | 检查能定位组/规则，error 阻断、warning 高亮，保存后中心集中生效 | CAP-RULE-GATE；m01 + promtool | §4.4、§6.4、§7.4、§8.3 | SCN-03 | 待走查 | — |
| SCN-04 排查同步失败与采集异常 | FR-08、FR-12、FR-13、FR-27、FR-28；NFR-03、NFR-04、NFR-05 | 同步状态与失败原因可读，实例采集状态与端口来源可区分，删除资源后自动回收 | CAP-SYNC-STATUS / CAP-RECONCILE；m01（消费 m09） | §6.2、§6.6、§7.5、§8.4 | SCN-04 | 待走查 | — |
| SCN-05 采集模板治理与变更影响 | FR-07、FR-21、FR-24、FR-29；NFR-06、NFR-08、NFR-11 | 停用/改参/删除的影响面可预期，存量任务不被静默改变 | CAP-COLLECTION-TEMPLATE；m01 | §4.2、§6.1、§6.2、§9 | SCN-05 | 待走查 | — |
| SCN-06 维护技术指标库 | FR-18、FR-19、FR-29；NFR-08、NFR-09 | 内置只读、用户可扩展、锚点挂模板、重复登记被拒 | CAP-METRIC-CATALOG / CAP-AUTH-ADMIN；m01 | §4.5、§6.5 | SCN-06 | 待走查 | — |

> 网域级参数覆盖已删除（原 FR-04），不进入任何场景；域级差异通过域专用模板 + 按 `network_domain_id` 筛选，或实例级 `scrape_port` 表达。端口口径以 FR-08 三级链为准。

---

## 3. NFR 覆盖

| NFR | 设计落点 | 覆盖场景 | 状态 |
|-----|----------|----------|------|
| NFR-01 M01 只维护策略数据 | HLD §2.1、§6.6 | 全部 | 待走查 |
| NFR-02 Job 必须绑定采集节点域 | HLD §3、§6.2 | SCN-02、SCN-04 | 待走查 |
| NFR-03 源数据变更自动触发同步 | HLD §6.6、§7.5 | SCN-04 | 待走查 |
| NFR-04 同步失败不锁死源数据 | HLD §6.6 | SCN-04 | 待走查 |
| NFR-05 选中关系一致性 | HLD §6.6、§7.5 | SCN-02、SCN-04 | 待走查 |
| NFR-06 参数快照稳定性 | HLD §6.2 | SCN-01、SCN-05 | 待走查 |
| NFR-07 网域作用域校验 | HLD §3、§6.2、§6.3 | SCN-02、SCN-03 | 待走查 |
| NFR-08 权限控制 | HLD §9 | SCN-05、SCN-06 | 待走查 |
| NFR-09 用户语言一致性 | HLD §2.4、§9 | 全部 | 待走查 |
| NFR-10 错误提示可执行 | HLD §9 | 全部 | 待走查 |
| NFR-11 模板与选择器扩展不依赖代码变更 | HLD §6.1 | SCN-01、SCN-05、SCN-06 | 待走查 |

---

## 4. 新增能力论证

本轮无新建能力；SCN-01~06 均复用现有 `m01` / `ui-custom/web` / `foundation` 能力。

后续如出现“必须新建能力”的需求，需在本表补充：

| CAP | 为什么不能复用/扩展现有能力 | 抽象/扩展点 | 变体点 | 决策 |
|-----|----------------------------|-------------|--------|------|
| — | — | — | — | — |

---

## 5. 已收敛口径

| # | 口径 | 结论 | 落地位置 |
|---|------|------|----------|
| 1 | FR 重叠 | FR-01 只定义模板构成；FR-21 定义模板生命周期与权限；FR-22 只做选择器配置校验（求值见 FR-09）；FR-24 定义启停/删除的影响与引用保护 | SRS v1.8 §5.1 / §5.6；HLD v1.4 §3 |
| 2 | 网域级参数覆盖 | **不做，FR-04 已删除**；域级差异改用域专用模板 + 按 `network_domain_id` 筛选，或实例级 `scrape_port`；端口链固定为三级，不预留网域层 | SRS v1.8 §1.2 / FR-08；HLD v1.4 §3 / §6.2 |

## 6. 未决问题 / 反馈

| # | 问题 | 场景 | Owner | 状态 |
|---|------|------|-------|------|
| 1 | SCN-06 指标库维护是否作为 MVP 验收硬指标 | SCN-06 | 需求 Owner | open |
| 2 | SCN-04 实例采集状态依赖 M09 `/api/v1/targets` 联调，联调窗口待定 | SCN-04 | 技术 Owner | open |
| 3 | 场景演示脚本为骨架，尚未实测填结果 | 全部 | 技术 Owner | open |
| 4 | 端口来源内部标识 `mapping` 为历史命名，语义已是「模板默认端口」；UI 文案需统一为「模板默认」，本轮只收敛文档口径，不改代码 | SCN-01、SCN-04 | 技术 Owner | open |

---

## 7. 双方确认

- 需求 Owner：待确认
- 技术 Owner：待指定
- 文档状态：draft

## 8. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-11-22 | 创建 M01 场景链接矩阵骨架；SCN-01~06；能力图例；NFR 覆盖；未决问题 |
| 2026-11-22 | 收敛 FR 重叠与网域参数覆盖口径；映射按唯一职责重排；FR-04 标注 v0.2+ 不进本期验收 |
| 2026-11-22 | 删除 FR-04 网域级参数覆盖；域级差异改为域专用模板 + `network_domain_id` 筛选或实例 `scrape_port`；端口链固定三级 |
| 2026-11-22 | **模板对齐（P0）**：§2「结论」改「验收结论」并定义枚举（`—`/pass/partial/failed）；§7「结论」改「文档状态」；表头 HLD 章节移除旧 §2.5 引用（HLD 已退化为能力清单）；头部新增对外验收说明书引用 |
