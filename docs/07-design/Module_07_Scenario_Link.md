# 监控对象管理（CMDB） 场景链接矩阵（Scenario Link）

> **状态**：draft（骨架已建，待场景走查）
> **Domain ID**：`DOMAIN-CMDB`
> **SRS**：[Module_07_Monitoring_Object_Management_Requirements.md](../02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md) v2.4
> **HLD**：[Module_07_Monitoring_Object_Management_High_Level_Design.md](Module_07_Monitoring_Object_Management_High_Level_Design.md) v1.0
> **演示脚本**：`docs/05-execution-records/module-07/scenario-walkthrough.md`（待创建）
> **对外验收说明书**：`docs/07-design/Module_07_Acceptance.md`（待创建，派生，非追溯）
> **需求 Owner**：chenrt　**技术 Owner**：待指定
> **说明**：本表是双方唯一链接点；SRS/HLD 不再各自维护第二份追溯表。

---

## 1. 能力图例（技术内部）

| CAP | 意图 | 实现 |
|-----|------|------|
| CAP-RESOURCE-LEDGER | 六类资源台账、判重、软删、引用回显 | m07 |
| CAP-DICTIONARY | 三本字典、四态生命周期、引用数 | m07 |
| CAP-LABEL-GOVERNANCE | 标签模板映射、来源优先级、实例级 user 标签 | m07 |
| CAP-BULK-IMPORT | Excel 模板、create_only/upsert、声明 sheet | m07 |
| CAP-CI-MODEL | 内置字段只读 + 自定义字段登记/移出 | m07 |
| CAP-CHANGE-NOTIFY | 变更后 best-effort 通知 M01 对账 / M09 重算 | m07 → m01/m09 |
| CAP-UI-CMDB | 资源、字典、模板、CI 模型页面 | ui-custom/web |

---

## 2. 场景链接矩阵

> 「验收结论」枚举：`—`（未走查）/ `pass` / `partial` / `failed`；与对外验收说明书映射：`pass → 通过`、`partial → 有条件通过`、`failed → 不通过`。

| SCN | 覆盖 FR/NFR | 验收（需求方语言） | 技术实现（CAP / mXX） | HLD 章节 | 演示 | 需求方反馈 | 验收结论 |
|-----|-------------|--------------------|------------------------|----------|------|------------|----------|
| SCN-01 批量录入资源 | FR-01、FR-03、FR-06、FR-16~19、FR-20~22；NFR-03、NFR-05、NFR-12 | 按类型导入成功；归属可筛选；失败行可定位；声明 sheet 可随批次建字典 | CAP-RESOURCE-LEDGER / CAP-BULK-IMPORT / CAP-CHANGE-NOTIFY；m07 | §4.2、§6.1、§6.4、§7.2 | SCN-01 | 待走查 | — |
| SCN-02 登记应用与接口服务 | FR-02、FR-10、FR-23；NFR-18 | 应用挂平台且主平台正确；接口挂应用；M01 拨测任务可选到接口 | CAP-RESOURCE-LEDGER / CAP-DICTIONARY；m07 | §4.2、§6.1、§9 | SCN-02 | 待走查 | — |
| SCN-03 统一业务标签口径 | FR-11~15、FR-23；NFR-09、NFR-16 | 模板保存即生效；Job 自动带出关键标签；查询可按业务聚合 | CAP-LABEL-GOVERNANCE / CAP-CHANGE-NOTIFY；m07 | §4.2、§6.3、§6.6、§7.1 | SCN-03 | 待走查 | — |
| SCN-04 发现未监控资源 | FR-04、FR-05、FR-20、FR-21；NFR-06 | 三态可辨；可筛出未监控；可从资源详情跳转补建任务 | CAP-RESOURCE-LEDGER / CAP-UI-CMDB；m07 | §2.4、§4.2、§6.7、§10 | SCN-04 | 待走查 | — |
| SCN-05 新增描述字段 | FR-28、FR-30~34；NFR-23~26 | 登记即出现在表单；不改表不发版；可导入、可筛选；移除后历史值保留 | CAP-CI-MODEL；m07 | §4.2、§6.5、§7.5、§8.2 | SCN-05 | 待走查 | — |
| SCN-06 字典错建与重码治理 | FR-07~09、FR-24~29；NFR-01~02、NFR-19~21 | 引用数可见；零引用可撤销；有引用可合并且单事务迁移；标签随重算更新 | CAP-DICTIONARY / CAP-CHANGE-NOTIFY；m07 | §4.2、§6.2、§7.3、§8.1 | SCN-06 | 待走查 | — |

---

## 3. NFR 覆盖

| NFR | 设计落点 | 覆盖场景 | 状态 |
|-----|----------|----------|------|
| NFR-01~03（编码不可变 / 生命周期不破坏历史 / 判重一致） | HLD §6.1、§6.2、§8.1 | SCN-05/06 | 设计覆盖 |
| NFR-04~06（列表 / 导入 / 采集状态性能） | HLD §10 | SCN-01/04 | 设计覆盖 |
| NFR-07~09（新类型预留 / 外部 CMDB 预留 / 模板可扩展） | HLD §3、§6.3、§6.5 | SCN-03/05 | 设计覆盖 |
| NFR-10~12（写权限 / 数据隔离 / 导入安全） | HLD §9 | SCN-01/02 | 部分（M07 路由缺 admin 门，见未决问题 #2） |
| NFR-13~15（业务语言 / 错误可执行 / 表单引导） | HLD §6.7、§14 B | 全部 | 设计覆盖 |
| NFR-16~17（留痕 / 模块边界） | HLD §6.6、§11 | SCN-03/06 | 设计覆盖 |
| NFR-18（应用归属完整性） | HLD §3、§6.1、§9 | SCN-02 | 设计覆盖 |
| NFR-19~22（原子性 / 引用数 / 文案 / 可访问性） | HLD §6.2、§7.4、§10 | SCN-06 | 设计覆盖 |
| NFR-23~26（字段扩展 / 内置只读 / 移出保护 / 排序稳定） | HLD §6.5、§8.2 | SCN-05 | 设计覆盖 |

---

## 4. 新增能力论证

本轮无新建能力；SCN-01~06 均复用现有 `m07` / `m01` / `m09` 能力。

后续如出现“必须新建能力”的需求，需在本表补充：

| CAP | 为什么不能复用/扩展现有能力 | 抽象/扩展点 | 变体点 | 决策 |
|-----|----------------------------|-------------|--------|------|

---

## 5. 未决问题 / 反馈

| # | 问题 | 场景 | Owner | 状态 |
|---|------|------|-------|------|
| 1 | 场景演示脚本与实测结果尚未建立，SCN-01~06 未走查 | 全部 | 技术 Owner | open |
| 2 | SRS 要求内置模板与内置字段仅 admin 可改，但 M07 路由组未挂 `RequireAdmin`，当前仅靠登录态与前端入口约束 | SCN-03/05 | 技术 Owner | open |
| 3 | 资源多租户隔离为 v0.2+ 能力，当前按 `tenant_id` 预留，尚无跨租户可见性验收 | 全部 | 技术 Owner | open |
| 4 | 存量 `infra` 等演示字典的清理需在真实环境执行，清理步骤未纳入本轮验收 | SCN-06 | 需求 Owner | open |

---

## 6. 双方确认

- 需求 Owner：待确认
- 技术 Owner：待指定
- 文档状态：draft

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-11-22 | 创建 M07 场景链接矩阵；SCN-01~06；能力图例；NFR 覆盖；未决问题 |
