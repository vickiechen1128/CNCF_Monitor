# 跨模块联调分支与冻结窗口策略决策

> 记录日期：2026-08-23  
> 参与人：chenrt（用户）、Kimi Code Agent  
> 决策性质：分支策略 / 协作流程决策，影响 `06_Gitflow_Branch_and_Rollback_Guide.md` 与 `05_Code_Implementation_Plan.md`  
> 触发原因：Phase 5「跨模块联调验收」是长期反复发生的工作（MVP / v0.2 / v0.3 等版本末均需要），原有规则未明确联调期间功能分支冻结与联调工作位，易导致冲突与基线污染。

---

## 1. 问题

根据 `docs/02-product-requirements/05_Code_Implementation_Plan.md`，每个版本末都需要进入 Phase 5「跨模块联调验收」：

> 目标：把 M06 / M07 / M01 / M09 页面串成可用动线，补齐导航、错误处理、端到端验证与文档。

原规则写明：

> 不创建独立 `feat/module-05-portal` 分支，直接在 `develop` 或临时 `feat/module-00-e2e` 分支完成。

`docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` 也明确：

> 不引入 `staging/acceptance-XX` 等额外业务验收分支，`develop` 承担 PRD、原型与已验收代码的集成基线。

但实际执行中存在两个缺口：

1. **没有固定的联调工作位**：直接在 `develop` 上联调，下一版本的 `feat/module-XX` 可能已从 `develop` 切出，联调修复与新功能开发互相踩踏。
2. **没有功能分支冻结机制**：口头约定「联调期间不要改 feat 分支」不可靠，容易出现冲突和重复合并。

---

## 2. 决策

引入**按版本切出的短生命周期联调分支 `integration/vX.Y`**，并配套**版本级代码冻结窗口**。

具体规则：

| 维度 | 规则 |
|------|------|
| 分支命名 | `integration/v0.1`（MVP）、`integration/v0.2`、`integration/v0.3` … 与产品版本对齐 |
| 来源 | 必须从 `develop` 切出，且切出前本版本所有相关 `feat/module-XX` 已 `--no-ff` 合并到 `develop` |
| 用途 | 承载 Phase 5 联调修复：页面串联、导航/首页调整、E2E 脚本、文档补齐、构建/测试问题修复 |
| 合并目标 | 联调验收通过后 `--no-ff` 合回 `develop`，随后删除该分支 |
| 唯一合并人 | chenrt（项目整体负责人 / 产品 Owner） |
| 冻结规则 | 进入 `integration/vX.Y` 后，已合并的 `feat/module-XX` 分支冻结，不再接受新提交 |

---

## 3. 详细依据

### 3.1 保留 `develop` 作为唯一持久 SSOT

`develop` 仍是 PRD、原型与已验收代码的集成基线。`integration/vX.Y` 不是第二个长期基线，而是**从 develop 短暂切出、完成后立即回合并删除**的临时工作区。这避免了 `staging/acceptance-XX` 长期分支常见的漂移和「到底以哪条线为准」的问题。

### 3.2 冻结窗口解决功能分支冲突

联调期间，所有相关功能代码已经合并到 `develop`，联调分支就是 `develop` 的一个快照。明确「原 `feat/module-XX` 冻结」后：

- 修复只进 `integration/vX.Y`；
- 不会有人再向已合并的 `feat/module-XX` 补提交，避免与联调改动冲突；
- 下一版本的功能分支可以从 `develop` 切出并行启动，但预期在 `integration/vX.Y` 合回后 rebase / 同步一次。

### 3.3 与现有 Gitflow 不冲突

该决策不是引入「验收分支」长期并行，而是把「验收」这个动作本身标准化为一个短生命周期的分支。因此它修正了 `06_Gitflow_Branch_and_Rollback_Guide.md` 中「不引入额外验收分支」的绝对化表述，但**保留了 develop SSOT 的核心设计意图**。

### 3.4 跨版本复用

MVP、v0.2、v0.3 每个版本末都会重复 Phase 5。通过版本化命名 `integration/v0.1`、`integration/v0.2` 等，同一套机制可持续复用；分支本身用完即删，不会堆积。

---

## 4. 入口 / 出口条件

### 4.1 入口条件（谁、什么时候创建）

1. 本版本范围内所有 `feat/module-XX` 已 `--no-ff` 合并到 `develop`。
2. 对应模块 PRD 修订表已标记为「已冻结」。
3. chenrt 正式宣布「代码冻结 / 进入联调」。
4. 从 `develop` 切出 `integration/vX.Y`：

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b integration/v0.1
   ```

### 4.2 窗口期规则

- ✅ 允许在 `integration/vX.Y` 上提交联调修复、E2E 脚本、文档更新。
- ✅ 允许产品经理/下一版本规划在本地做草稿，但不提交。
- ❌ 禁止向已合并的 `feat/module-XX` 分支提交新改动。
- ❌ 禁止在 `integration/vX.Y` 上进行大规模模块重构。
- ❌ 禁止未经协调重写 `develop` 历史。

### 4.3 出口条件（谁、什么时候合并）

1. Phase 5 验收清单全部完成。
2. chenrt 审批通过。
3. `--no-ff` 合并回 `develop`：

   ```bash
   git checkout develop
   git merge --no-ff integration/v0.1
   git push origin develop
   git branch -d integration/v0.1
   git push origin --delete integration/v0.1
   ```

4. 宣布解冻，下一版本 `feat/module-XX` 可正式推进。

---

## 5. 大改动回退路径

联调期间若发现某模块需要**实质性返工**（超出 bug 修复/边界补齐）：

1. 记录问题清单，让当前 `integration/vX.Y` 尽快收尾合回 `develop`。
2. 解冻后，从更新后的 `develop` 重新切 `feat/module-XX`（或走变更请求 CR）。
3. 必要时再开 `integration/vX.Y.1` 做第二轮联调。

**禁止**：在 `integration/vX.Y` 上大规模重写已合并模块，或私自重启已冻结的 `feat/module-XX`。

---

## 6. 已同步修改的文档

- `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`
  - §1 设计目标第 3 条更新：develop 仍是 SSOT，`integration/vX.Y` 为短生命周期分支
  - §2.1 分支表新增 `integration/*` 行
  - 新增 §2.6「跨模块联调分支（`integration/vX.Y`）」
  - §11 禁止事项新增第 10 条：冻结窗口内禁止向已冻结 feat 分支提交
- `docs/02-product-requirements/05_Code_Implementation_Plan.md`
  - §Phase 5 对应分支改为 `integration/v0.1`
  - 新增入口条件、冻结规则、回退路径
  - Gitflow 分支约定表新增 `integration/*` 行

---

## 7. 后续待办

1. 在 `develop` 上验证 `integration/v0.1` 分支流程（MVP 进入 Phase 5 时首次使用）。
2. 根据首次使用反馈，决定是否增加自动化脚本（如 `scripts/start-integration.sh`）或 GitHub branch protection 规则。
3. 在团队 README / onboarding 文档中补充冻结窗口与联调分支说明。
