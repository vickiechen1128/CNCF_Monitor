# <业务域名称> 场景链接矩阵（Scenario Link）

> **状态**：draft / reviewing / ready / baseline
> **Domain ID**：`DOMAIN-<NAME>`
> **SRS**：`docs/02-product-requirements/Modules/SRS/Module_XX_Requirements.md` vX.Y
> **HLD**：`docs/07-design/Module_XX_High_Level_Design.md` vX.Y
> **演示脚本**：`docs/05-execution-records/module-XX/scenario-walkthrough.md`
> **对外验收说明书**：`docs/07-design/Module_XX_Acceptance.md`（派生，非追溯）
> **需求 Owner**：<name>　**技术 Owner**：<name>
> **说明**：本表是双方唯一链接点；SRS/HLD 不再各自维护第二份追溯表。

---

## 1. 能力图例（技术内部）

| CAP | 意图 | 实现/扩展点 |
|-----|------|-------------|
| CAP-... | | |

> 能力是技术内部复用抽象，不要求需求方理解。

---

## 2. 场景链接矩阵

> 「验收结论」枚举：`—`（未走查）/ `pass`（满足）/ `partial`（部分满足）/ `failed`（不满足）。与对外验收说明书映射：`pass → 通过`、`partial → 有条件通过`、`failed → 不通过`。

| SCN | 覆盖 FR/NFR | 验收（需求方语言） | 技术实现（CAP / mXX） | HLD 章节 | 演示 | 需求方反馈 | 验收结论 |
|-----|-------------|--------------------|------------------------|----------|------|------------|----------|
| SCN-01 | FR-01~... | | CAP-... / mXX | §... | SCN-01 | 待走查 | pass |
| SCN-02 | FR-... | | | | SCN-02 | 待走查 | pass |

---

## 3. NFR 覆盖

| NFR | 设计落点 | 覆盖场景 | 状态 |
|-----|----------|----------|------|
| NFR-01 | §... | 全部 | 待走查 |

---

## 4. 新增能力论证

> 本轮无新建能力时写“无”；有则补齐。

| CAP | 为什么不能复用/扩展现有能力 | 抽象/扩展点 | 变体点 | 决策 |
|-----|----------------------------|-------------|--------|------|
| | | | | |

---

## 5. 未决问题 / 反馈

| # | 问题 | 场景 | Owner | 状态 |
|---|------|------|-------|------|
| 1 | | | | open |

---

## 6. 双方确认

- 需求 Owner：
- 技术 Owner：
- 文档状态：draft / reviewing / ready / baseline

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| YYYY-MM-DD | 创建 |
