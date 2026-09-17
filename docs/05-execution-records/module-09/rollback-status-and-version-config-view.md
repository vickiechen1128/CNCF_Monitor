# M09 回滚 rolled_back 状态落地 + 下发记录详情查看版本配置

> 分支：`feat/module-09-config-center`　日期：2026-09-08
> 依据：PRD Module_09 v1.58 §3.5 / §5.6 / §6.5.3 / §8 / §9（MVP 试用反馈：回滚后看不到回滚后的配置文件具体内容）

## 需求与改动

### 1. 后端：回滚动作生成的新下发记录落 `rolled_back`

- `platform/configcenter/deployment/service.go`：`dispatchVersion` 增加 `rollback bool` 参数区分来源——`Dispatch`/`Retry` 传 `false`（成功仍 `success`），`Rollback` 传 `true`（成功落 `DeploymentStatusRolledBack`，失败仍 `failed` + `error_message`）。被回滚的历史记录不改动（台账不可变）。
- **下游消费方逐一核对结论**：全库 grep `DeploymentStatusSuccess`，非测试代码中唯一出现处即 `service.go` 赋值点；其余消费方均不以下发 `status` 做过滤：
  - M01 `change_status` 回写 / M08 AM applied 回写（`callback.go`）：在 `dispatchVersion` 投递成功分支内无条件执行，`rolled_back` 天然视同 `success` 参与回写——仅更新三处函数注释把口径写明（PRD §8）。
  - 「最近成功版本」判定：代码中不存在按下发 status 过滤的查询（`draft/service.go` 的 `lastConfirmedVersion` 基于 `ConfigVersion` 表，与下发记录状态无关），无需补齐；新增测试用 `status IN (success, rolled_back)` 集合口径固化该语义。
  - `dashboard/summary.go` 最近下发记录：不按状态过滤，原样透传 `rolled_back`；`ListDeployments` 的 `status` 参数为透传筛选，前端枚举已含 `rolled_back`。
- `docs/05-execution-records/module-09/api-contract-snapshot.md`：rollback 接口响应描述补齐「成功时 `status=rolled_back`、失败时 `failed` + `error_message`、被回滚记录不变」（对齐 PRD §6.5.3）。
- 测试（`deployment_test.go`）：
  - `TestRollbackCreatesSuccessDeployment` → `TestRollbackCreatesRolledBackDeployment`：断言 rolled_back + change_status 照常回写 + 被回滚历史记录保持 success 不变。
  - 新增 `TestRollbackFailureRecordsFailed`：回滚投递失败落 `failed` + error_message，不回写。
  - 新增 `TestRolledBackCountsAsLatestSuccess`：固化「rolled_back 视同 success」判定口径。

### 2. 前端：详情抽屉「查看版本配置」（`DeploymentsPage.tsx`）

- 详情抽屉新增 `Collapse` 区块「查看版本配置（cv-xxx）」，**展开时懒调用** `deploymentApi.getConfigVersion(record.config_version_id)`，按文件分 Tab（`prometheus.yml` / `targets/*.json` / `rules.yml` / `blackbox.yml`，`alertmanager.yml` 仅产物含时展示，决策 60）只读展示。
- 代码块等宽 `<pre>` + `overflow: auto`（横向滚动），样式与配置预览页一致（前端规范 §9）；产物文本复用 `preview/configPreviewYaml.ts` 的 `fileTextByKey`（`ConfigVersion` 满足 `ArtifactSource`），targets 按 job 文件名拼接展示。
- 加载中 Spin、错误 Alert + 重试按钮；切换详情记录时重置缓存。

### 3. 前端：回滚交互修正

- 回滚确认弹窗文案由「回滚到上一可用配置版本」改为「回滚到所选版本 `cv-xxx`（来自变更单 `CHG-xxx`）」，成功提示同步改为「已回滚到所选版本」（PRD §3.5：不得出现与实际行为不符的表述）。
- 回滚按钮可用性：`rolled_back` 是有效回滚目标（PRD §8 可再次回滚），改为仅 `success`/`rolled_back` 可点（常量 `ROLLBACKABLE`），`pending`/`running`/`failed` 禁用；列表行与抽屉操作区同口径。
- 状态列：`rolled_back` → 「已回滚」标签（`configCenterConstants.ts` 既有映射，`warning` 色区别于 success 绿），无需改动。
- 测试（`DeploymentsPage.test.tsx`）：新增 4 例——弹窗文案指向所选版本、rolled_back 可回滚、failed/pending 禁用、版本配置懒加载成功 / 失败重试；`deploymentApi` mock 补 `getConfigVersion`。

## 验证结果

| 验证项 | 结果 |
|--------|------|
| `make test-platform` | ✅ 全部通过（含 configcenter/deployment 等） |
| `.tools/go/bin/go vet ./platform/...` | ✅ 无输出 |
| `pnpm test`（ui-custom/web） | ✅ 本改动相关 15/15 通过；全量 467/469 通过，2 例失败位于 `label-templates/MappingDrawer.test.tsx`，与本次改动无关（该文件不引用 config-center 任何模块，为预存失败） |
| `pnpm lint` | ✅ 无告警（--max-warnings 0） |
| `pnpm exec tsc --noEmit` | ✅ |
| `make repo-map && make check-repo-map` | ✅ 已重新生成，新鲜度校验通过 |

## 变更文件清单

- `platform/configcenter/deployment/service.go`（dispatchVersion 增加 rollback 来源参数 + 注释）
- `platform/configcenter/deployment/callback.go`（三处回写函数注释口径：rolled_back 视同 success）
- `platform/configcenter/deployment/deployment_test.go`（改 1 例 + 新增 2 例）
- `docs/05-execution-records/module-09/api-contract-snapshot.md`（rollback 响应描述）
- `ui-custom/web/src/pages/config-center/deployments/DeploymentsPage.tsx`（查看版本配置区块 + 回滚交互）
- `ui-custom/web/src/pages/config-center/deployments/DeploymentsPage.test.tsx`（新增 4 例）
- `docs/04-source-architecture/repo-map.md`（`make repo-map` 重新生成）

## 与 PRD 的出入

- 无功能性出入。PRD §3.5 提到「非管理员隐藏入口」：MVP 阶段用户为预置管理员，接口本身已在 `RequireAdmin` 组，前端未做权限隐藏（与任务口径一致）。
