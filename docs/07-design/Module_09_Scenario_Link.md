# 配置与查询中心 场景链接矩阵（Scenario Link）

> **状态**：ready（需求方已确认 5 个场景满足需求；P1 已修复复验）
> **Domain ID**：`DOMAIN-CFG-QUERY`
> **SRS**：[Module_09_Network_Domain_Access_and_Query_Center_Requirements.md](../02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md) v1.11
> **HLD**：[Module_09_Config_and_Query_Center_High_Level_Design.md](Module_09_Config_and_Query_Center_High_Level_Design.md) v1.1
> **演示脚本**：[scenario-walkthrough.md](../05-execution-records/module-09/scenario-walkthrough.md)
> **对外验收说明书**：[Module_09_Acceptance.md](Module_09_Acceptance.md)（派生，非追溯）
> **需求 Owner**：chenrt　**技术 Owner**：待指定
> **说明**：本表是双方唯一链接点；SRS/HLD 不再各自维护第二份追溯表。

---

## 1. 能力图例（技术内部）

| CAP | 意图 | 实现 |
|-----|------|------|
| CAP-EDGE-ACCESS | 网域纳管、凭据、节点注册/心跳、离线包 | m09 |
| CAP-CONFIG-PUBLISH | 配置生成、校验、发布、产物历史/导出 | m09 |
| CAP-OBS-TARGET | 目标状态、覆盖率、节点运行态 | m09 |
| CAP-QUERY-PROXY | PromQL 代理、网域注入、查询护栏 | m09 |
| CAP-UI-NAV | 导航、查询页、场景入口 | ui-custom/web |
| CAP-AUTH-TENANT | 鉴权、租户、网域授权 | m06 / foundation |

---

## 2. 场景链接矩阵

> 「验收结论」枚举：`—`（未走查）/ `pass` / `partial` / `failed`；与对外验收说明书映射：`pass → 通过`、`partial → 有条件通过`、`failed → 不通过`。

| SCN | 覆盖 FR/NFR | 验收（需求方语言） | 技术实现（CAP / mXX） | HLD 章节 | 演示 | 需求方反馈 | 验收结论 |
|-----|-------------|--------------------|------------------------|----------|------|------------|------|
| SCN-01 新网域接入监控 | FR-01~04、FR-10~14、FR-21 | 完成登记→纳管→安装节点→心跳上线→配置下发 | CAP-EDGE-ACCESS / CAP-CONFIG-PUBLISH / CAP-AUTH-TENANT；m06/m07/m09 | §4.2、§6.1、§6.3、§7.1 | SCN-01 | 已确认满足 | pass（P1 复验后） |
| SCN-02 排查采集节点离线 | FR-05~09、FR-10~14 | 看到最后心跳/积压/配置版本/组件状态，可远程重启或清积压 | CAP-EDGE-ACCESS / CAP-OBS-TARGET；m09 | §4.3、§6.2、§7.2、§8.2 | SCN-02 | 已确认满足 | pass（P1/P2 复验后） |
| SCN-03 查看监控目标状态 | FR-15~17 | 按网域/Job/健康状态筛选，离线/异常高亮 | CAP-OBS-TARGET；m09 | §4.2、§6.5、§7.4 | SCN-03 | 已确认满足 | partial（计数/陈旧已修复；四态未覆盖） |
| SCN-04 实时指标查询 | FR-18~20、FR-22 | PromQL 即时/区间查询、时序图、越权为空、来源与新鲜度可见 | CAP-QUERY-PROXY / CAP-UI-NAV；m09 | §4.4、§6.6、§6.7、§7.5 | SCN-04 | 已确认满足 | pass（基础查询/空态/URL） |
| SCN-05 指标中断与采集失败排障 | FR-15~20、FR-22 | 从告警/目标一键进查询，区分抓取失败与无数据，能分享复现 | CAP-QUERY-PROXY / CAP-OBS-TARGET / CAP-UI-NAV；m09 | §4.4、§6.5–§6.7、§7.4–§7.5 | SCN-05 | 已确认满足 | partial（真实中断窗口/深链未验证） |

---

## 3. NFR 覆盖

| NFR | 设计落点 | 覆盖场景 | 状态 |
|-----|----------|----------|------|
| NFR-01~09（隔离/安全/保留/导出等） | HLD §3、§9、§12 | 全部 | 待走查 |
| NFR-10（查询代理 P95） | HLD §10.2 | SCN-04/05 | 部分（压测待补） |
| NFR-11（查询护栏） | HLD §10.1 | SCN-04/05 | 已实现 |
| NFR-12（查询页性能） | HLD §6.7、§10.3 | SCN-04/05 | 部分（1000×20 压测待补） |
| NFR-13（业务语言/错误提示） | HLD §6.7、§6.9 | SCN-04/05 | 部分（全站文案检查待补） |

---

## 4. 新增能力论证

本轮无新建能力；SCN-01~05 均复用现有 `m09` / `m06` / `m07` / 前端导航能力。

后续如出现“必须新建能力”的需求，需在本表补充：

| CAP | 为什么不能复用/扩展现有能力 | 抽象/扩展点 | 变体点 | 决策 |
|-----|----------------------------|-------------|--------|------|

---

## 5. 未决问题 / 反馈

| # | 问题 | 场景 | Owner | 状态 |
|---|------|------|-------|------|
| 1 | P1（配置同步回写/AM 404）已修复复验；P2/P3 待排期 | 全部 | 技术 Owner | open |
| 2 | SCN-05 的告警/目标联动入口是否作为 MVP 验收硬指标 | SCN-05 | chenrt | open |
| 3 | 查询页深链入口与查询历史是否纳入本轮 | SCN-04/05 | chenrt | open |

---

## 6. 双方确认

- 需求 Owner：已确认 5 个场景满足需求（2026-11-22）
- 技术 Owner：P1 已修复复验（2026-11-22）
- 文档状态：ready（P2/P3 技术遗留另行排期）

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-11-22 | 创建 M09 场景链接矩阵；SCN-01~05；能力图例；NFR 覆盖；未决问题 |
| 2026-11-22 | 技术方完成 SCN-01~05 实测；需求方确认 5 个场景满足需求；P1/P2 修复复验（配置同步回写 / AM 404 / 采集器映射 / 覆盖率计数）；详见 [scenario-walkthrough](../05-execution-records/module-09/scenario-walkthrough.md) |
| 2026-11-22 | **模板对齐（P0）**：状态由 reviewed 归一为 ready；§2「结论」改「验收结论」并定义枚举（`—`/pass/partial/failed）；§6「结论」改「文档状态」；头部新增对外验收说明书引用 |
