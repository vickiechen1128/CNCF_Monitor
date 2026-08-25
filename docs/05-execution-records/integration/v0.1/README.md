# integration/v0.1：MVP 跨模块联调验收记录

> **分支**：`integration/v0.1`（从 `develop` 切出）  
> **目标版本**：MVP  
> **覆盖模块**：Module 06（网域登记）/ Module 07（监控对象管理）/ Module 01（监控策略）/ Module 09（网域与边缘配置中心，MVP 仅 `default` 域 `local` 通道）  
> **目标**：把上述模块页面串成可用动线，完成端到端验证、导航与首页补齐、文档更新  
> **状态**：进行中 / 已完成 / 已合并  

---

## 1. 联调范围与入口条件

### 1.1 主链路

```text
网域登记 → 资源导入 → 策略配置 → 配置生成 → 确认下发 → Prometheus reload → 指标查询
```

### 1.2 入口条件

- [ ] Phase 1 ~ 4 相关 `feat/module-XX` 已全部 `--no-ff` 合并到 `develop`
- [ ] 对应模块 PRD 修订表已标记「已冻结」
- [ ] `integration/v0.1` 已从 `develop` 切出
- [ ] chenrt 宣布「代码冻结 / 进入联调」

---

## 2. 关键文档索引

| 文档 | 说明 |
|------|------|
| `plan.md` | 联调动线、验收用例、任务分工 |
| `issues.md` | 联调过程中发现的问题、修复方案、责任人 |
| `e2e-results.md` | 端到端验证结果、截图/日志、通过/未通过项 |
| `../module-00-infrastructure/integration-branch-strategy.md` | 联调分支策略决策 |
| `../../02-product-requirements/05_Code_Implementation_Plan.md` | Phase 5 实施计划 |

---

## 3. 变更记录

| 日期 | 变更 | 作者 | 备注 |
|------|------|------|------|
| 2026-08-23 | 创建 `integration/v0.1` 分支与记录目录 | chenrt | 分支基于 origin/develop |
| 2026-08-25 | 回归修复：M09 后单取代前单 + watcher 自适应退避；M01 批量 ready/draft；NetworkDomainsPage `scrollIntoView` jsdom 兼容性修复；全部测试 310/310 通过 | backend-developer / frontend-developer | 详见 `issues.md` #3/#4/#5/#6 与 `e2e-results.md` 回归验证 |
| 2026-08-25 | 跨模块落地：M09 校验分层（instance 放行 + vMsg 透传 + pending 态操作出口 + validation_cause/details，决策 45）；M01 labels 挂 target 级（D43）+ 批量提交生效单向 + pending 期 job 锁定（D28/44）；M07 os_type 必填 + 内置字典 | backend-developer / frontend-developer | 详见 `issues.md` #7~#11；待 design 分支收割 PRD 修订项已逐条标注 |
