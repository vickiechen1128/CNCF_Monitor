# M01 Job 组落地（第一阶段：数据地基 + 唯一性收敛）

> 日期：2026-11-17
> 关联模块：Module 01 监控策略与指标管理（v3 重写线 `rewrite/v2.0`）
> 需求依据：[Module_01_Job_Group_and_Object_First_SRS.md](../../02-product-requirements/Modules/SRS/Module_01_Job_Group_and_Object_First_SRS.md)（增量 SRS v1.0，方案 B：意图 + 按域派生子 Job）
> 前置工作：[M09 扇出 P0](../module-09/config-sync-fanout-p0.md)

---

## 1. 本阶段范围

只做「数据地基 + 唯一性收敛」，不含组 CRUD 的 service / HTTP / 前端（下一阶段）：

1. 新增 `m01_job_groups`（监控意图：公共采集参数 + 维护单元）；
2. `m01_scrape_jobs` 增加 `job_group_id`（可空，NULL = 传统单域 Job）；
3. `job_name` 唯一性由「全局唯一」收敛为「**同域唯一**」`(network_domain_id, job_name)`；
4. 领域实体 `JobGroup` / `JobGroupStatus` / `Job.JobGroupID`；
5. 仓储 `JobGroupRepository`（Create/Get/List/Update/SoftDelete/CountByName）。

**没有**改 M09：它仍按 `network_domain_id` 读取单域 Job 生成每域配置包（SRS §2.2 的核心约束）。

---

## 2. 变更清单

| 文件 | 变更 |
|---|---|
| `platform/db/migrations/v3/00012_m01_job_groups.sqlite.sql` | 新表 + `job_group_id` 列 + 索引重建（Up/Down 完整） |
| `platform/db/migrations/v3/00012_m01_job_groups.postgres.sql` | 同义 Postgres 变体 |
| `platform/modules/m01/domain/entities.go` | 新增 `JobGroup`；`Job.JobGroupID` |
| `platform/modules/m01/domain/enums.go` | 新增 `JobGroupStatus`（enabled/disabled）+ `Valid()` |
| `platform/modules/m01/repository/models.go` | `jobRecord.JobGroupID *string`（空串会违反 FK，必须 NULL）+ 双向映射 |
| `platform/modules/m01/repository/job_group.go`（新） | `JobGroupRepository` + GORM 实现 + 记录映射（枚举默认值兜底，避免 CHECK 失败） |
| `platform/modules/m01/repository/errors.go` | `nilIfEmpty` / `derefString` 小工具 |

### 关键 DDL 决策

- **为什么允许跨域同名**：同组子 Job 复用同一 `job_name`，看板可用同一个 `job` 标签跨域聚合；每域配置包独立，不会冲突。
- **Down 的破坏性**：回滚要恢复「全局唯一」，若回滚窗口内已存在跨域同名行会被拒绝（预期行为，不静默删数据），注释已写明。
- **NULL 语义**：`job_group_id` 为空必须是 SQL NULL；空串会触发 `FOREIGN KEY constraint failed`（本次测试直接踩到并修正）。

---

## 3. 测试

| 测试 | 断言 |
|---|---|
| `TestJobNameUniquePerDomain`（repository） | 同域名 job_name 在两个域合法；同域重复 → `ConflictError`；软删后可重建 |
| `TestJobGroupIDRoundTrip`（repository） | `job_group_id` 往返一致；传统 Job 读出为空串（NULL） |
| `TestJobGroupRepository`（repository） | 组 CRUD、名称全局唯一冲突、软删后同名可重建、列表关键词过滤 |
| 迁移测试（`platform/db`） | 00012 Up/Down 全绿；`m01_job_groups` 在 Up 后存在、00012 Down 后消失，`m01_scrape_jobs` 保留 |

---

## 4. 验证

| 项 | 命令 | 结果 |
|---|---|---|
| 全量后端 | `GOCACHE=/tmp/mc-go-cache go test ./platform/...` | 通过（exit 0） |
| 目标包 | `go test ./platform/modules/m01/repository/ ./platform/db/` | 通过（新增 3 例） |
| 静态 | `go vet ./platform/modules/m01/... ./platform/db/` | 通过 |
| 格式 | `gofmt -l platform/modules/m01 platform/db` | 无输出 |

---

## 5. 下一阶段（待做）

| 步骤 | 说明 |
|---|---|
| 组 service | `CreateJobGroup`（按实例所属域分组 → 事务内 1 组 + N 子 Job）、`UpdateJobGroup`（公共参数扇出 + 实例增量对账）、`DeleteJobGroup`（级联软删）；需先引入事务边界（现 `JobRepository` 无 tx 注入） |
| HTTP + DTO | `/api/v3/platform/job-groups` 增删改查 + 组级聚合状态视图（派生，不落库） |
| 契约与 PRD | 更新 M01 API 契约与基线 SRS（PRD owner 主笔，本记录只提供实现依据） |
| 前端 | 对象优先动线（跨域筛选多选 + 分域预览 + 分组列表） |
| 兼容迁移 | 存量单域 Job 加入组 / 拆出（SRS §10 P2） |

---

## 6. 第二阶段：组 service + 事务边界（2026-11-17 追加）

### 6.1 事务边界：`GroupPlan` + `Apply`

没有引入 ctx 级 TxManager（会让所有仓储的每个方法都要感知事务），改为在组仓储里提供一个**原子计划**：

```go
type GroupPlan struct {
    Group         *domain.JobGroup
    CreateGroup   bool
    UpdateGroup   bool
    DeleteGroup   bool
    JobsToCreate  []*domain.Job
    JobsToUpdate  []*domain.Job
    JobsToDelete  []string
}
func (r *GORMJobGroupRepository) Apply(ctx, plan) error   // 单事务提交
```

- service 只负责**算 delta**（哪些域新建 / 更新 / 删除），仓储负责**一次性落库**；
- 组行与 N 条子 Job 同事务，杜绝「建了一半的组」（SRS NFR-JG-01）；
- 子 Job 的创建/更新复用 `jobFromDomain`（与 `JobRepository` 同一 mapper），行为一致。

### 6.2 service 能力（`platform/modules/m01/service/job_group.go`）

| 方法 | 行为 |
|---|---|
| `Create` | 校验组名全局唯一 → 按实例 `network_domain_id` 归组 → 每域一条子 Job（复用 `JobService.prepare` 做完整校验：域资格/参数解析/标签模板/实例同域/凭据加密）→ 单事务落库 |
| `Update` | 重算 delta：已有域更新、新域新建、实例清零的域删除子 Job；公共参数（间隔/超时/path/scheme/认证/TLS/模板/模块）一次性扇出；组参数取首个已解析子 Job，保证组视图与子 Job 快照一致 |
| `Delete` | 组 + 全部子 Job 同事务软删（级联） |
| `Get` | 组 + 逐域子 Job + 派生状态（含域名回填） |
| `DeriveGroupSyncSummary` | SRS FR-JG-05 派生规则：`disabled > empty > draft > partial > failed > pending > synced`，**不落库** |

### 6.3 装配

- `Repositories` 增加 `JobGroups`；`Module` 构造 `JobGroupService` 并暴露 `JobGroupService()` 访问器；
- HTTP 路由 / DTO 留到下一阶段（当前 service 可被 handler 与测试直接消费）。

### 6.4 测试（新增 5 例，`service/job_group_test.go`）

| 测试 | 断言 |
|---|---|
| `TestCreateJobGroupFansOutOneChildPerDomain` | 跨两域一次提交 → 1 组 + 2 子 Job；同 `job_name` 跨域合法；参数一致；组状态 `pending`；组名重复 409 |
| `TestUpdateJobGroupReconcilesChildren` | 改参数扇出到全部子 Job；某域实例清零 → 该域子 Job 软删（组保留）；重新加回 → 该域子 Job 重建 |
| `TestDeleteJobGroupCascadesToChildren` | 删组后组 404、子 Job 无存活行 |
| `TestCreateJobGroupDisabledDisablesChildren` | 停用组 → 子 Job 全部 `enabled=false` + `draft`，组状态 `disabled` |
| `TestDeriveGroupSyncSummary` | 7 组状态派生表驱动 |

### 6.5 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0） |
| `go vet ./platform/modules/m01/...` | 通过 |
| `gofmt -l platform/modules/m01` | 无输出 |

### 6.6 尚未实现（下一阶段）

| 项 | 说明 |
|---|---|
| HTTP + DTO | `POST/PUT/DELETE/GET /api/v3/platform/job-groups`、组列表聚合视图；需同步 API 契约 |
| 组内子 Job 受限编辑 | 目前 `JobService.Update` 仍可直改子 Job；SRS §11 要求组内子 Job 仅允许实例/排障动作，需在 handler 层加「属于组 → 拒绝改公共参数」 |
| 域不可用联动 | 域被禁用时子 Job 自动停用 + 标注（SRS FR-JG-07），需在 reconcile 循环读取域状态 |
| 前端 | 对象优先动线 + 分域预览 + 分组列表 |
| 存量 Job 入组/拆出 | SRS §10 P2 |

---

## 7. 第三阶段：HTTP / DTO / 契约（2026-11-17 追加）

### 7.1 端点（`/api/v3/platform/job-groups`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/job-groups` | 列表：`status` / `keyword` / 分页；每行带 `domains` 与派生 `sync` |
| POST | `/job-groups` | 创建：公共参数 + 跨域实例 → 单事务 1 组 + N 子 Job |
| GET | `/job-groups/:id` | 详情 |
| PUT | `/job-groups/:id` | 更新：参数扇出 + 实例增量对账 |
| DELETE | `/job-groups/:id` | 软删组 + 全部子 Job |

### 7.2 实现

| 文件 | 内容 |
|---|---|
| `dto/job_group.go`（新） | `JobGroupRequest` / `JobGroupResponse` / `JobGroupChildResponse` / `JobGroupSyncResponse` |
| `handler/job_group.go`（新） | 五个 handler + 请求/响应转换（`sync` 只出现在响应，派生不落库） |
| `handler/routes.go` | 注册 `/job-groups`（静态路由在 `:id` 之前） |
| `service/job_group.go` | 新增 `List`：组分页 + **批量**加载子 Job（`ListJobsByGroups`，避免 N+1）+ 域名缓存 |
| `module.go` | 装配 `JobGroupHandler` 并传入 `RegisterRoutes` |
| `handler/routes_test.go` | 测试 router 同步装配组 handler |

### 7.3 契约

- 已写入 `docs/05-execution-records/rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md` §4.1（端点 / 请求 / 响应 / 错误 / 不变量）；
- 同时修订 §10 第 1 条：`job_name` 由「全局唯一」改为「**同域唯一**」（00012 起）。
- 响应字段：`job_name` 取自子 Job（组表不冗余存储）；`sync.status` 派生（`disabled > empty > draft > partial > failed > pending > synced`）。

### 7.4 测试

| 测试 | 覆盖 |
|---|---|
| `TestJobGroupLifecycle`（handler，端到端） | 跨两域一次 POST → 2 条子 Job；GET 列表（keyword）；PUT 后某域实例清零 → 该域子 Job 软删、参数 30s 扇出；重名 POST → **409**；DELETE → 组 **404** 且子 Job 全部软删 |

### 7.5 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0） |
| `go vet ./platform/...` | 通过（含测试文件） |
| `gofmt -l platform/modules/m01 platform/db` | 无输出 |

### 7.6 下一阶段

1. **组内子 Job 受限编辑**：组内子 Job 拒绝修改公共参数（只允许实例 / 排障动作），在 `JobService.Update` 或 handler 层拦截。
2. **域不可用联动**（FR-JG-07）：域禁用 / 退纳管时子 Job 自动停用并标注。
3. **前端**：对象优先动线（跨域筛选多选 → 分域预览 → 分组列表）。
4. M09 扇出 P1（探测模块校验去重、回写不推进 `updated_at`）。

---

## 8. 第四阶段：组内子 Job 受限编辑 + 域不可用联动（2026-11-17 追加）

### 8.1 组内子 Job 受限编辑（SRS JG v1.0 §11）

`JobService.Update` / `Delete` 增加组边界校验（`enforceGroupChildEditScope`）：

| 操作 | 结果 |
|---|---|
| 改 `selected_instance_ids`（同域内） | ✅ 允许 |
| 改公共参数（间隔/超时/path/scheme/类型/模板/blackbox/凭据/TLS） | ❌ `400`，提示 `is managed by the job group; edit the group instead` |
| 改 `enabled` | ❌ `400`，提示 `disable the group instead` |
| 直接 `DELETE /scrape-jobs/:id`（组内子 Job） | ❌ `400`，提示改用组编辑（清空该域实例）或删组 |

- 约定：请求里**空字段 = 未提供**（与企业既有不可变字段校验一致），避免前端整对象回传误判；
- 单域 Job（`job_group_id` 为空）完全不受影响，仍可自由改参数；
- 拦截放在 service 层（不是 handler），任何调用方（HTTP / 内部）都受约束。

### 8.2 域不可用联动（FR-JG-07）

`ReconcileService`（D40 拉取循环，默认 60s）新增域可用性 pass：

- 只处理**组内子 Job**（`job_group_id != ""`）且当前 `enabled=true` 的行；
- 域 `Eligible()` 为假（未启用 / 非 edge|collection / 未纳管）→ 子 Job `enabled=false` + `sync=draft`，**保留不删**（便于域恢复后人工重新启用）；
- 单域 Job 维持既有行为（不自动停用），避免影响存量动线；
- 域恢复后**不自动拉起**（SRS FR-JG-07 要求人工确认）。

### 8.3 测试（新增 2 例）

| 测试 | 断言 |
|---|---|
| `TestGroupChildJobRestrictedEdit` | 子 Job 改参数/凭据/启用态均被拒；只改实例通过；直接删子 Job 被拒；单域 Job 改参数回归通过 |
| `TestReconcileDisablesGroupChildrenWhenDomainUnavailable` | 域 B 被禁用 → 组内子 Job 自动停用 + draft；同域单域 Job 不受影响；`changed == 1` |

### 8.4 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0） |
| `go vet ./platform/...` | 通过 |
| `gofmt -l platform/modules/m01 platform/db` | 无输出 |

### 8.5 剩余

1. **前端**：对象优先动线（跨域筛选多选 → 分域预览 → 分组列表），按契约 §4.1 对接。
2. 组详情页「域不可用」显式标记（当前由「子 Job 停用 + draft」派生，未新增字段）。
3. M09 扇出 P1 两项（探测模块校验去重、回写不推进 `updated_at`）。

---

## 9. 第五阶段：组合筛选后端（SRS v1.1 §5.3，2026-11-17 追加）

> 需求已回填 SRS：`Module_01_Job_Group_and_Object_First_SRS.md` v1.1 §5.3（FR-JG-11~14）、
> NFR-JG-11~14、§7.2（条件不落库）、§8.5、§9 验收、§10 分期、§11 风险。
> 契约同步：`api-contract-snapshot-v3.md` §5.1.1。

### 9.1 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/scrape-jobs/instance-candidates/filter-schema` | 服务端下发可筛选字段清单（schema 驱动） |
| POST | `/scrape-jobs/instance-candidates/query` | 组合筛选（AND）+ 分页 + 分域计数 |
| POST | `/scrape-jobs/instance-candidates/query/ids` | 全选：同条件解析为实例 ID（上限 2000，带 `truncated`） |
| GET | `/scrape-jobs/instance-candidates` | 老接口保留（单网域、必填） |

### 9.2 实现要点

| 位置 | 内容 |
|---|---|
| `domain/resource.go` | `CandidateFilter{Field,Op,Values}`、`CandidatePage{Refs,Total,DomainHits,IDs,Truncated}`、`CandidateQuery` 增加 `Filters/TenantIDs/IDsOnly/MaxIDs` |
| `references/resource.go` | **字段→列白名单**（杜绝列名拼接）；`in/eq/contains` 三种操作符；未筛状态时默认排除 `maintenance`；`GROUP BY network_domain_id` 分域计数；ids 查询上限 +1 试探截断 |
| `service/job.go` | `CandidateFilterSchema()`（字段/操作符/枚举/默认值）、`QueryCandidates()`；同字段同操作符 **AND 合并（交集）**；`status`/`env` 枚举白名单校验；分域计数回填域名 |
| `handler/candidate_query.go` | 三个 handler + 请求/响应映射；`page_size` 上限 100 |
| `handler/routes.go` | 静态路由注册在 `:id` 之前 |

### 9.3 授权收敛（已完成）

- 会话租户 → `TenantIDs` 传入候选查询（非 platform_admin 按 `resources.tenant_id` 收敛）；
- **actor 注入**：`service.Actor{TenantID, IsPlatformAdmin}` + `WithActor/ActorFrom`；handler 的 `requestContext(c)` 从会话派生，候选查询 / Job 创建更新 / 组创建更新统一使用；
- **域共享授权**：`DomainRef.AuthorizedFor(tenant)`（登记归属或 `authorized_tenant_ids` 显式授权），在 `requireDomain` 中 fail-closed 校验；
- **实例归属**：`validateInstances` 校验 `ResourceRef.TenantID`，跨租户实例一律 400；
- 平台管理员（`platform_admin` 租户）不受限；无 actor 的内部/兼容路径保持原行为。

### 9.4 测试

| 测试 | 覆盖 |
|---|---|
| `TestCandidateQueryWithComposableFilters` | schema 字段；`状态+网域多选+应用` AND 组合命中 2 台；分域计数与域名；默认排除维护中；ids 全选（3 台、`truncated=false`、`max_ids=2000`） |
| `TestCandidateQueryRejectsInvalidFilters` | 未知字段 / 不支持的 op / 空 values / 非法 status / 非法 env → 全部 400 |

### 9.5 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0） |
| `go vet ./platform/...` | 通过 |
| `gofmt -l platform/modules/m01 platform/db` | 无输出 |

### 9.6 下一步

1. **前端 P0**：条件构建器（schema 驱动）+ 结果表（跨页多选）+ 已选/分域汇总 + 「全选筛选结果」+ 保存为 Job 组。
2. 授权收敛剩余两件（域级授权交叉校验、create/update 实例归属校验）。
3. OR 分组 / 筛选模板（SRS P2）、动态成员（P3）。

---

## 10. 第六阶段：SRS v1.2 澄清 + 授权收敛收口（2026-11-17 追加）

### 10.1 SRS v1.2（筛选与派生的边界）

回填 `Module_01_Job_Group_and_Object_First_SRS.md` v1.2：

1. **网域条件定位红线**：只收窄本次可选实例，**不得理解为「绑定下发域」**；子 Job 的域由所选资源的 `network_domain_id` 在保存时派生；界面必须标注，并以分域预览为唯一可信来源。
2. **默认值下沉**：默认条件只有「状态 = 运行中/已停止」；网域**不默认、不置顶、不可必填**。
3. **选择集与筛选变化**：筛选变化不清空已选，标注「已选 N 台，其中 M 台不在当前筛选内」并提供一键清理；保存以实际已选为准。
4. **云/可用区不单独建字段**：折叠进网域选项标签（`域A（阿里云/北京）`）；P1 再评估 join 过滤或「选云→自动填域」。
5. 同步补充验收 3 条、风险 1 条、变更记录 v1.2。

### 10.2 授权收敛（后端已完成）

| 位置 | 内容 |
|---|---|
| `service/actor.go`（新） | `Actor` + `WithActor/ActorFrom`（上下文注入，避免改所有 service 签名） |
| `handler/actor.go`（新） | `requestContext(c)`：从会话派生 actor（`platform_admin` → 管理员） |
| `handler/job.go`、`candidate_query.go`、`job_group.go` | 候选查询 / Job 增改 / 组增改统一使用 `requestContext(c)` |
| `domain/resource.go` | `ResourceRef.TenantID`、`DomainRef.TenantID/AuthorizedTenantIDs` + `AuthorizedFor()` |
| `references/domain.go` / `resource.go` | 读取 `tenant_id` 与 `authorized_tenant_ids`（JSON，容错解析） |
| `service/job.go` | `requireDomain` 校验域授权；`validateInstances` 校验资源归属 |

### 10.3 测试

| 测试 | 断言 |
|---|---|
| `TestJobTenantScopeEnforced`（service） | 租户 A + 自有资源 + 被授权域 → 通过；同域内他租户资源 → `belongs to another tenant`；未授权域 → `not authorized for this tenant`；平台管理员不受限；无 actor 保持原行为 |

### 10.4 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0） |
| `go vet ./platform/...` | 通过 |
| `gofmt -l platform/modules/m01 platform/db` | 无输出 |

### 10.5 下一步

1. **前端 P0**（按 SRS v1.2 + 契约 §5.1.1）：条件构建器（schema 驱动、网域条件不默认不置顶 + 定位提示）、结果表（跨页多选、已选汇总、不在筛选内标注/清理）、「全选筛选结果」、分域预览、保存为 Job 组。
2. 组列表分组视图与组详情（前端）。
3. OR 分组 / 筛选模板（P2）、动态成员（P3）。

---

## 11. 第七阶段：前端 P0（对象优先动线 + 组合筛选 UI，2026-11-17 追加）

### 11.1 新增/修改文件

| 文件 | 内容 |
|---|---|
| `src/types/jobGroup.ts`（新） | 筛选字段/条件、候选查询结果、Job 组与逐域子任务类型 |
| `src/api/jobGroups.ts`（新） | `filterSchema / queryCandidates / candidateIds / list / get / create / update / remove` |
| `src/pages/strategy/JobGroupWizardDrawer.tsx`（新） | 新建向导：对象类型 → 组合筛选 → 跨页多选（含全选）→ 分域预览 → 公共参数 → 保存 |
| `src/pages/strategy/JobGroupsPage.tsx`（新） | 任务组列表：覆盖网域数、实例数、派生同步状态、展开逐域子任务与失败原因、删除 |
| `src/App.tsx` | 注册 `/job-groups` |
| `src/layouts/MainLayout.tsx` | 「采集策略」下新增「监控任务组」入口（`ClusterOutlined`） |

### 11.2 与 SRS v1.2 的对齐

- 默认条件只有「运行状态 = 运行中/已停止」；**网域不默认、不置顶**，在「+ 添加条件」中可选；
- 网域条件旁固定提示「只收窄本次可选实例；实际下发哪些网域由所选实例所属网域决定」；
- 筛选变化不清空已选：顶部提示「筛选条件已变化，已选实例仍保留」+「清理不在筛选内的已选」（走 ids 接口精确清理，超限时拒绝）；
- 分域预览用**所选实例**聚合（真实下发域），并额外展示「当前筛选命中」；
- 全选调用 `query/ids`，超 2000 提示收窄（`truncated`）；
- 跨页选择用行级 `onSelect/onSelectAll` 维护选择集（避免聚合回调覆盖已选）；
- 保存提交 `selected_instance_ids` 实际已选 + 公共参数，成功后提示「覆盖 N 个网域，最长 30s 内自动下发」。

### 11.3 测试

`src/pages/strategy/JobGroupsPage.test.tsx`（4 例）：

| 用例 | 断言 |
|---|---|
| 列表与展开 | 组行显示覆盖网域数 / 派生状态「部分失败」；展开可见逐域子任务与失败原因 |
| 条件构建器 | 默认只有「运行状态」、无网域条件；添加「网域」后出现定位提示 |
| 选择与保存 | 勾两行 → 分域预览「域A 1 台 / 域B 1 台」→ 填参数保存 → `create` 收到 `selected_instance_ids=['r-a1','r-b1']` |
| 全选 | 调用 `query/ids` → 已选纳入 → 行勾选态为选中 |

### 11.4 验证

| 项 | 命令 | 结果 |
|---|---|---|
| 测试类型 | `tsc -p tsconfig.test.json --noEmit` | 通过 |
| 应用类型 | `tsc --noEmit` | 通过 |
| 目标测试 | `vitest run src/pages/strategy src/layouts` | 19 文件 / 189 例通过 |
| Lint | `eslint`（改动文件，max-warnings 0） | 通过 |
| 构建 | `vite build` | 通过（6.33s） |

### 11.5 下一步

1. 组详情抽屉（编辑公共参数 / 停用 / 解散）+ 组内子任务受限编辑的前端体现；
2. 列表按组折叠视图与「所属组 / 覆盖网域数」筛选；
3. 条件 OR 分组、筛选模板（SRS P2）；动态成员（P3）；
4. M09 扇出 P1（探测模块校验去重、回写不推进 `updated_at`）。

---

## 12. 合并任务列表 · 步骤 0：暴露 job_group_id（2026-11-17 追加）

> 背景：采集 Job 页与监控任务组页合并的前置。合并前 `GET /scrape-jobs` 不返回 `job_group_id`，
> 前端无法判断"哪些 Job 属于哪个组、哪些是未分组"，任何合并方案都无法落地。

### 12.1 变更

| 位置 | 变更 |
|---|---|
| `dto/job.go` | `JobResponse` 新增 `job_group_id` / `job_group_name`（`omitempty`）；`FromJob` 增加 `groupName` 参数，组 ID 直接取 `job.JobGroupID` |
| `service/job.go` | `JobView.GroupName`；新增 `SetJobGroupResolver(repository.JobGroupRepository)`（可选依赖，未注入时组名为空）；`view()` 按 `JobGroupID` 解析组名（NotFound 容错，其它错误上抛） |
| `handler/job.go` | 4 处 `dto.FromJob(...)` 透传 `view.GroupName` |
| `module.go` | 装配 `jobSvc.SetJobGroupResolver(repos.JobGroups)` |
| `handler/routes_test.go` | 测试 router 同步装配（否则组名恒空） |
| `ui-custom/web/src/types/strategyV3.ts` | `ScrapeJobV3` 增加 `job_group_id?` / `job_group_name?` |

### 12.2 测试

`TestJobGroupLifecycle` 增补断言：创建组后

- `GET /scrape-jobs/{child_job_id}` 返回 `job_group_id` = 组 ID、`job_group_name` = 组名；
- `GET /scrape-jobs?keyword=host-base` 列表中每行都带同样的两个字段。

### 12.3 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0） |
| `go vet ./platform/modules/m01/...` | 通过 |
| `gofmt -l platform/modules/m01` | 无输出 |
| 前端 `tsc -p tsconfig.test.json --noEmit` | 通过 |

### 12.4 下一步（合并步骤 1~4）

| 步 | 内容 | 关键风险 |
|---|---|---|
| 1 | 抽 `JobParamsFields`（来自 `ScrapeJobFormDrawer` 的认证/TLS/标签模板/采集器/blackbox/mapping 字段）+ `InstancePicker`（单域 / 跨域两模式） | 现有 866 行表单抽屉回归必须全绿 |
| 2 | 组视图并入 `ScrapeJobListPage`：`groups` 区（展开子任务）+ `standalone` 区（未分组 Job），组级采集/同步状态 | 双源分页不得混排（未分组独立查询） |
| 3 | 抽屉三合一（新建/编辑/详情；组与单域分支；向导补齐全量参数；子 Job 受限编辑只留实例） | 710 + 759 行旧测试大改，先补新测试再退役旧断言 |
| 4 | 后端 `GET /monitoring-tasks` 双段返回，前端切单源、删 `/job-groups` 独立页与导航入口 | 契约新增一节；避免异构行统一排序 |

---

## 13. 合并任务列表 · 步骤 1：抽取共享参数组件（2026-11-17 追加）

> 目标：让「单域采集 Job 抽屉」与「跨域任务组向导」共用同一套采集参数字段，
> 消除"向导只有 4 个参数"的缺口与两处字段漂移。

### 13.1 变更

| 文件 | 变更 |
|---|---|
| `src/pages/strategy/JobParamsFields.tsx`（新） | `ScrapeParamFields`（间隔/超时/采集路径/协议 + 继承说明 + `application_http` 路径必填）、`AuthTlsFields`（认证类型/用户名密码/Token/跳过 TLS/CA，`Form.useWatch` 跟随切换）、`JobParamsFields`（组合导出） |
| `ScrapeJobFormDrawer.tsx` | 采集参数块与「认证与 TLS」折叠面板改为消费共享组件；删除本地重复 JSX 与不再使用的 `SCRAPE_PARAM_FIELDS` / `Collapse` / `AuthType` 导入（**DOM 结构保持一致**，便于旧测试回归） |
| `JobGroupWizardDrawer.tsx` | 公共参数区改为 antd `Form` + `JobParamsFields`：新增采集间隔/超时/路径/协议/认证/TLS/凭证字段；保存改为 `validateFields()` 后提交 |

### 13.2 行为变化

- 向导保存现在会带上 `scrape_interval` / `scrape_timeout` / `metrics_path` / `scheme` / `auth_type` / 凭证 / `label_template_id` / `blackbox_module`（此前仅 4 项，DB/Middleware 类任务无法直接建组）；
- 参数默认值仍由后端解析（留空 = 继承），前端 placeholder 提示继承链。

### 13.3 测试

| 测试 | 断言 |
|---|---|
| `ScrapeJobFormDrawer.test.tsx`（25 例）+ `blackboxEdit.test.tsx`（2 例） | 组件抽取后行为不变，全绿（回归门槛） |
| `JobGroupsPage.test.tsx` 新增 1 例 | 向导内可见「采集间隔/采集超时/采集路径/协议/认证与 TLS」，证明复用共享字段 |
| 既有 4 例 | 默认条件、定位提示、跨页选择 + 保存载荷、全选 → 全部保持通过 |

### 13.4 验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `vitest run src/pages/strategy src/layouts` | **19 文件 / 190 例通过** |
| `eslint`（改动文件，0 告警） | 通过 |
| `vite build` | 通过 |

### 13.5 下一步

| 步 | 内容 |
|---|---|
| 2 | 组视图并入 `ScrapeJobListPage`（`groups` + `standalone` 双段、展开子任务、组级采集/同步状态） |
| 3 | 抽屉三合一（新建/编辑/详情；组与单域分支；子 Job 受限编辑只留实例） |
| 4 | 后端 `GET /monitoring-tasks` 双段返回，删 `/job-groups` 独立页与导航入口 |

---

## 14. 合并任务列表 · 步骤 2：组视图并入采集 Job 页（2026-11-17 追加）

> 目标：一个页面承载「按任务组」与「按 Job」两种视图；组视图下未分组单域 Job 独立查询，不与组的分页混排。

### 14.1 后端：未分组过滤

| 位置 | 变更 |
|---|---|
| `repository/job.go` | `JobFilter.Ungrouped` → `WHERE job_group_id IS NULL` |
| `handler/job.go` | `GET /scrape-jobs?ungrouped=true` 解析 |
| `handler/job_group_test.go` | 建组后再建一条单域 Job：`ungrouped=true` 只返回该单域 Job，且 `job_group_id` 为空 |

### 14.2 前端：双视图合并

| 文件 | 变更 |
|---|---|
| `JobGroupsSection.tsx`（新） | 由原 `JobGroupsPage` 主体抽出（组表格 + 向导），去掉 `MainLayout/ConfigProvider` 外壳，供两处复用 |
| `JobGroupsPage.tsx` | 降级为壳（`MainLayout` + `JobGroupsSection`），路由暂留作过渡 |
| `UngroupedJobsSection.tsx`（新） | 「未分组的单域任务」区：`useScrapeJobs({ ungrouped: true })` 独立分页，列含任务名/网域/监控类型/已选实例/同步状态 |
| `useScrapeJobs.ts` / `api/scrapeJobs.ts` | 筛选与请求参数支持 `ungrouped` |
| `ScrapeJobListPage.tsx` | 顶部 `Segmented`：**按 Job（默认，保持既有动线）** / **按任务组**；组视图渲染 `JobGroupsSection + UngroupedJobsSection` |

### 14.3 设计取舍

- **组视图不混排未分组 Job**：两类数据源分页/排序语义不同，混排会让"组内子任务聚合"算不准；改为视觉分区 + 各自分页（对应 SRS v1.2 的"双段"思路）。
- **默认仍是「按 Job」**：既有 710 行列表测试与用户习惯不变；组视图作为对象优先动线入口，后续可在产品确认后切换默认值。
- 组行的「实例采集状态」聚合列**未在本步实现**（子任务不在当前 jobs 列表中，需按子 Job 拉取），留到步骤 3 的组详情抽屉统一处理；当前组行展示覆盖网域数 / 实例数 / 派生同步状态。

### 14.4 测试

| 测试 | 断言 |
|---|---|
| `ScrapeJobListPage.test.tsx` 新增 1 例 | 默认「按 Job」；切「按任务组」后出现「监控任务组」与「未分组的单域任务」，且未分组区调用 `ungrouped: true`；切回正常 |
| 既有 23 例 | 全部保持通过（默认视图不变） |
| `JobGroupsPage.test.tsx` 5 例 | 抽出 section 后行为不变 |

### 14.5 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/modules/m01/...` | 通过 |
| `go vet ./platform/modules/m01/...` / `gofmt -l` | 通过 / 无输出 |
| `tsc -p tsconfig.test.json --noEmit` | 通过 |
| `vitest run src/pages/strategy src/layouts` | **19 文件 / 191 例通过** |
| `eslint src/pages/strategy`（0 告警） | 通过 |
| `vite build` | 通过（4.93s） |

### 14.6 下一步

| 步 | 内容 |
|---|---|
| 3 | 抽屉三合一（新建/编辑/详情；组详情含逐域采集状态聚合；子 Job 受限编辑只留实例） |
| 4 | 删除 `/job-groups` 独立页与导航入口；后端 `GET /monitoring-tasks` 双段返回 |

---

## 15. 合并任务列表 · 步骤 3+4：抽屉三合一 + 单源双段列表（2026-11-17 追加）

### 15.1 后端：`GET /monitoring-tasks`（单源双段）

- 新 `MonitoringTaskHandler`：一次请求返回 `groups[]` + `standalone[]`，两段**各自分页**
  （`groups_page` / `jobs_page`），共享 `keyword`（组名/任务名/域名）与 `monitor_type` / `network_domain_id` 过滤；
- 组段复用 `JobGroupService.List`（含派生 `sync`），未分组段复用 `JobService.List` + `Ungrouped: true`；
- 契约字段：`groups / groups_total / standalone / standalone_total / groups_page / jobs_page / page_size`。

### 15.2 前端：单页、单源、三抽屉

| 文件 | 变更 |
|---|---|
| `MonitoringTasksSection.tsx`（新） | 合并列表：组表（详情/编辑/删除 + 展开逐域）+ 未分组表；单源 `jobGroupApi.monitoringTasks` |
| `JobGroupDetailDrawer.tsx`（新） | 组参数摘要 + 逐域子任务（实例数/同步状态/失败原因）+ 编辑/删除入口 |
| `JobGroupWizardDrawer.tsx` | 增加**编辑态**（`record`）：预填公共参数；按子任务反查 `selected_instance_ids` 预填跨域已选；保存走 `update` |
| `ScrapeJobListPage.tsx` | 「按任务组」视图改为渲染 `MonitoringTasksSection`（替代双组件拼装） |
| 删除 | `JobGroupsPage.tsx` / `JobGroupsSection.tsx` / `UngroupedJobsSection.tsx`；路由 `/job-groups` 与导航「监控任务组」 |

### 15.3 测试

| 测试 | 断言 |
|---|---|
| `TestJobGroupLifecycle`（Go） | `/monitoring-tasks` 返回 1 组 + 1 未分组；`keyword` 同时作用于两段 |
| `MonitoringTasksSection.test.tsx`（7 例） | 列表/条件构建/选择保存/全选（沿用）+ **组详情**（参数、逐域、失败原因、编辑/删除入口）+ **组编辑**（预填参数、跨域实例反查、`update` 载荷） |
| `ScrapeJobListPage.test.tsx`（24 例） | 视图切换改为断言 `monitoringTasks` 单源调用 |

### 15.4 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/...` | 通过（exit 0，75 包 ok） |
| `go vet ./platform/modules/m01/...` / `gofmt -l` | 通过 / 无输出 |
| `tsc -p tsconfig.test.json --noEmit` | 通过 |
| `vitest run src/pages/strategy src/layouts` | **19 文件 / 193 例通过** |
| `eslint`（改动范围，0 告警） | 通过 |
| `vite build` | 通过（7.60s） |

### 15.5 合并整体完成度

| 步 | 状态 |
|---|---|
| 0 暴露 `job_group_id/name` | ✅ |
| 1 共享参数组件 | ✅ |
| 2 双视图并入采集 Job 页 | ✅ |
| 3 组详情 + 组编辑（向导编辑态） | ✅（组级采集状态聚合留在子任务详情，见下） |
| 4 单源 `monitoring-tasks` + 删独立页/路由/导航 | ✅ |

### 15.6 遗留

1. **组级实例采集状态列**：组行目前展示同步状态与实例数；采集状态需按子任务聚合（`useJobScrapeStatus` 需完整子 Job 对象），留待组详情增强或后端聚合字段。
2. 子 Job「受限编辑」前端未做专门入口（后端已 400 拦截公共参数；详情抽屉为只读）。
3. 组列表「按组建模的筛选」（所属组/覆盖网域数）未加。

---

## 16. 概念收口 · SRS v1.3 + 统一采集任务视图（2026-11-17 追加）

### 16.1 SRS v1.3（提出即落档）

`Module_01_Job_Group_and_Object_First_SRS.md` v1.3：

- 用户概念统一为「**采集任务（Job）**」；`job_group_id` 降为**内部字段**（不进表单/列/筛选/文案）；
- **取消「未分组 / 组内」二分**，存量单域 Job 与跨域任务表现形式一致；
- **单一「新建采集任务」入口**，任务类型仍为 采集 / 拨测（`job_type` 语义不变）；
- 新增 **FR-JG-04 单域→多域晋升**（编辑时同事务建承载、复用原 Job 行）；
- 列表改为**单视图**：无「按组/按 Job」切换、无「所属任务组/未分组」列，跨域任务以「覆盖网域」表达；
- NFR-JG-09 增加红线：界面不出现「任务组 / 组内 / 未分组 / 子任务」。

### 16.2 后端：晋升接口

| 位置 | 变更 |
|---|---|
| `service/job_group.go` | 新增 `Adopt(ctx, jobID, input)`：校验原 Job 无承载 → 复用其行作为所属域子任务 → 其余域新建子任务 → 单事务落库 |
| `dto/job_group.go` | `AdoptJobGroupRequest{job_id, JobGroupRequest}` |
| `handler/job_group.go` / `routes.go` | `POST /job-groups/from-job`（静态路由先于 `:id`）；重复晋升 → 400 |
| `handler/job_group_test.go` | 单域 Job 晋升为跨域任务：原 Job id 复用、`job_group_id` 挂接；重复晋升 400 |

### 16.3 前端：统一采集任务视图

| 文件 | 变更 |
|---|---|
| `ScrapeJobListPage.tsx` | 重写为**单视图单表**：行 = 采集任务（跨域任务 / 单域任务）；列：任务名 / 类型（采集·拨测）/ **覆盖网域** / 监控类型 / 已选实例 / 实例采集状态（跨域聚合）/ 间隔 / 启用 / 同步（跨域聚合）/ 操作；展开 = 逐域执行情况（域 / 实例数 / 采集状态 / 同步 / 失败原因） |
| `JobGroupWizardDrawer.tsx` | 顶部**任务类型切换（采集/拨测）**：拨测走资源类别（接口服务/应用服务）+ 拨测模块；新增 `adoptJobId` 晋升保存；文案统一「采集任务」 |
| `JobGroupDetailDrawer.tsx` | 文案统一「任务详情 / 编辑任务 / 删除任务 / 各网域执行情况」 |
| `api/jobGroups.ts` | 新增 `adoptFromJob(jobId, input)` |
| 删除 | 「新增单域任务」按钮、「所属任务组」列、「未分组」概念、「按组/按 Job」切换 |

### 16.4 测试

| 测试 | 断言 |
|---|---|
| `ScrapeJobListPage.test.tsx`（重写，7 例） | 单一入口 + 采集/拨测切换；单视图（覆盖网域、展开逐域、无未分组/所属任务组/视图切换）；单域任务同表展示；编辑跨域任务预填；编辑单域任务（晋升路径入口）；删除跨域任务级联；组详情入口 |
| Go `TestJobGroupLifecycle` | 晋升接口：原 Job 行复用 + `job_group_id` 挂接 + 重复晋升 400 |

### 16.5 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/modules/m01/...` | 通过 |
| `go vet ./platform/modules/m01/...` / `gofmt -l` | 通过 / 无输出 |
| `tsc -p tsconfig.test.json --noEmit` | 通过 |
| `vitest run src/pages/strategy src/layouts` | **18 文件 / 169 例通过**（旧 24 例被单视图新用例替换） |
| `eslint`（改动范围，0 告警） | 通过 |
| `vite build` | 通过（6.46s） |

### 16.6 遗留

1. **参数 UI 对等**：统一向导已含采集参数/认证 TLS，但「采集器使用默认/手填」「标签模板卡片」「生效端口回显」「实例安装确认」仍在旧 `ScrapeJobFormDrawer`（本轮保留为高级入口，未并入向导）。
2. `/monitoring-tasks` 接口在前端已不使用（单视图直接读 `/scrape-jobs` + `/job-groups`），建议下轮删除或保留为组聚合外部 API。
3. 拨测任务的候选校验（`target_field`/URL 必填）依赖后端，向导前端未做前置提示。

---

## 17. 向导体验修复 + 死代码清理（2026-11-17 追加）

### 17.1 「任务名称」与「下发任务名」合并

- 向导第 4 段只保留 **任务名称**（全局唯一，列表/详情展示）；
- 指标里的 `job` 标签（`job_name`）收进「高级：下发任务名（job 标签）」折叠：
  **留空 = 与任务名称一致**；提示"创建后改名会让历史序列按新 job 断档、且需同域唯一"；
- 保存逻辑：`job_name = 高级值 || 任务名称`，前端不再强制用户填两个名字。

### 17.2 「分域预览」→「将下发到的网域」并合并进已选摘要

- 原独立区块标题改为「3. 将下发到的网域」，删除"保存后将按域生成子任务"表述（内部概念不外泄）；
- 已选摘要一行内直接展示：`已选 N 台 · 覆盖 M 个网域（域A 12 台 / 域B 7 台）`；
- 仍保留"当前条件命中"对照，便于确认筛选与选择集的差异。

### 17.3 新增机器匹配不到（诊断与修复）

根因是三处隐式过滤，向导此前无法让用户看见：

| 原因 | 处理 |
|---|---|
| 对象类型默认 `Linux 主机`，强制 `os_type='linux'` | **未选类型前不查询**，显式选择后才发候选请求（避免"默认已过滤"） |
| 默认状态条件 `运行中/已停止` 排除维护中 | 空态文案点名该条件 |
| 网域条件与机器所在域不一致 | 空态列出**当前全部生效条件** |

- 候选为空时展示诊断：`当前条件：采集 / Linux 主机 · 运行状态=online、offline · 网域=…；主机按操作系统区分（Linux/Windows），类型不符或状态为「维护中」都会被排除`。

### 17.4 参数 UI 对齐（并入向导，消除重复入口）

- 向导新增：**采集器（使用默认 / 手填）**、**标签模板**（按资源类别过滤，留空 = 类别默认模板）；
- 采集参数与认证/TLS 复用 `JobParamsFields`（上一步已抽取）；
- 旧 `ScrapeJobFormDrawer` 不再出现在创建动线（页面仅保留组件与测试，作为端口回显/安装确认的后续承载点）；
- **已知未并入**：生效端口回显、实例安装确认（见 §16.6）。

### 17.5 拨测前置校验

- 拨测任务未填**拨测模块**时：输入框红色高亮 + 行内错误提示，且保存按钮禁用；
- 保存可用性条件收敛为：已选实例 > 0、任务名称非空、类型已选（标准任务）、拨测模块非空（拨测任务）。

### 17.6 删除 `/monitoring-tasks` 死接口

- 删除 `handler/monitoring_tasks.go`、路由、`Module.monitoringAPI`、`DTO.MonitoringTasksResponse`、前端 `jobGroupApi.monitoringTasks` 与 `MonitoringTasks` 类型；
- 能力由「单视图直接读 `/scrape-jobs`（含组内任务）+ `/job-groups`」承担，无功能损失。

### 17.7 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/modules/m01/...` | 通过 |
| `go vet ./platform/modules/m01/...` / `gofmt -l` | 通过 / 无输出 |
| `tsc -p tsconfig.test.json --noEmit` | 通过 |
| `vitest run src/pages/strategy src/layouts` | **18 文件 / 169 例通过** |
| `eslint`（改动范围，0 告警） | 通过 |
| `vite build` | 通过（7.84s） |

### 17.8 遗留

1. 生效端口回显 / 实例安装确认尚未并入向导（旧抽屉保留为后续承载点）；
2. 向导重置未复位「任务类型/对象类型」（再次打开沿用上次选择，影响小、待优化）；
3. `/scrape-jobs` 仍返回组内子任务，与组列表存在重复计数风险（当前列表用"组行 + 单域行"组合，未重复展示）。

---

## 18. 收尾三项（2026-11-17 追加）

### 18.1 端口回显与安装确认并入向导（编辑态）

- 编辑任务时新增第 4 段「**各网域实例与生效端口**」：按域折叠，逐实例展示
  名称 / 采集地址 / **生效端口** / 安装确认状态；
- 数据源为 `GET /scrape-jobs/{id}/instances`（按域级子任务并发拉取），确认动作走
  `POST /scrape-jobs/{id}/instances/{resource_id}/confirm`（`confirmed_by` 取当前登录账号）；
- 说明：v3 实例 DTO 无 `port_source` 来源标注（四级解析链来源仅在 store 层），故本面板只回显端口值。

### 18.2 旧抽屉定位（不再重复，但保留能力）

- 创建/编辑主流程已统一到向导；旧 `ScrapeJobFormDrawer` 改由任务行「**高级**」入口按需打开，
  承载映射默认值、采集器登记、安装确认面板等高级能力（不再出现在创建动线，消除重复入口）。

### 18.3 向导重开复位

- 关闭时复位：任务类型 → 采集、对象类型 → 未选、拨测类别/模块、采集器模式、实例明细缓存；
- 避免"沿用上次类型/模块"造成的误判（此前重开仍保留上次拨测模块）。

### 18.4 分组口径显式化

- `JobFilter` 新增 `GroupedOnly`（`job_group_id IS NOT NULL`），`GET /scrape-jobs?grouped=true`；
- 与既有 `ungrouped=true` 对称：调用方统计"任务内执行行/单域任务"时口径显式，避免混算；
- 测试：`grouped=true` 只返回带 `job_group_id` 的行。

### 18.5 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/modules/m01/...` | 通过 |
| `go vet` / `gofmt -l` | 通过 / 无输出 |
| `tsc -p tsconfig.test.json --noEmit` | 通过 |
| `vitest run src/pages/strategy src/layouts` | **18 文件 / 170 例通过**（新增逐域实例与安装确认用例） |
| `eslint`（改动范围，0 告警） | 通过 |
| `vite build` | 通过（8.82s） |

### 18.6 剩余

1. 实例面板未展示 `port_source` 来源标注（v3 DTO 缺字段，如需可后端补）；
2. 「高级」入口目前只对单域任务开放；跨域任务的逐域子任务走详情抽屉查看（未提供逐域高级编辑）。

---

## 19. 向导结构重排 + 拨测下拉恢复 + 状态默认收紧 + 端口列后置（2026-11-17 追加）

### 19.1 拨测模块恢复下拉预置

- 上一轮为快速补参数把拨测模块改成了自由输入（回归），本轮恢复为 `Select`：
  选项来自 `GET /blackbox-modules`，**停用模块禁用并标注「（已停用）」**，支持搜索；
- 未选择时红字提示「拨测任务必须选择拨测模块」，保存按钮禁用（`canSave` 条件）。

### 19.2 默认筛选条件收紧为「运行中」

- 原默认 `status ∈ {运行中, 已停止}` → 现默认 **仅 `online`**；
- 理由：已停止/维护中机器选中也采不到，默认纳入只会制造误选；需要时由用户显式添加条件；
- 空态诊断继续列出当前生效条件。

### 19.3 监控对象改为「资源类别 → 监控对象类型」两级

- 与采集器管理/资源管理口径一致：先选资源类别（主机/数据库/中间件/应用服务/其他监控目标），
  再按类别过滤监控对象类型；
- 拨测任务：资源类别限「接口服务 / 应用服务」，监控对象类型位置替换为拨测模块下拉；
- 候选查询载荷统一使用 `resource_category`（不再由 monitor_type 反推），切换类别即清空已选。

### 19.4 向导段落重排（信息前置）

| 新顺序 | 段落 | 说明 |
|---|---|---|
| 1 | 任务 | 任务名称 + 采集/拨测 + 高级：下发任务名（job 标签） |
| 2 | 监控对象 | 资源类别 → 监控对象类型（拨测为类别 + 模块） |
| 3 | 筛选与实例 | 条件构建器 + 已选摘要（含「将下发到的网域」内联）+ 候选表 |
| 4 | 采集参数 | 采集器 / 标签模板 / 采集参数 / 认证与 TLS |
| 5 | 各网域实例与生效端口（编辑态） | 按域折叠，端口来源标注 + 去资源管理 |

- 删除独立的「将下发到的网域」段（并入第 3 段摘要），段落数 5→4（编辑态额外第 5 段）；
- 任务名称由 `Form.Item` 改为受控状态（脱离参数表单），避免"参数表单里填任务名"的倒置。

### 19.5 M07 采集端口列后置

- 资源列表「采集端口」列从类型专属列（IP/端口之后）移到 **「采集状态」之后**；
- `resourceColumns.tsx` 抽出共享 `scrapePortColumn`，接口服务不展示；
- 同步更新 `ResourcesPage.test.tsx` 五类列序期望（采集端口 → 采集状态之后）。

### 19.6 验证

| 项 | 结果 |
|---|---|
| `go test ./platform/modules/m01/... ./platform/modules/m07/...` | 通过 |
| `go vet` / `gofmt -l` | 通过 / 无输出 |
| `tsc --noEmit` | 通过（仅 `admin/zonetype` 未跟踪新文件有并发告警，非本次改动） |
| `vitest run src/pages/strategy/ScrapeJobListPage.test.tsx` | 8 例通过 |
| `vitest run src/pages/resources/ResourcesPage.test.tsx` | 84 例通过（单测复跑；全量并行时出现过超时抖动） |
| `eslint`（改动范围，0 告警） | 通过 |
| `vite build` | 通过（6.46s） |

### 19.7 遗留

1. 向导「采集器手填」仍只接受模板 ID（未接入采集器下拉）；
2. 资源页批量设置采集端口已提供后端接口与弹窗，尚未补前端单测；
3. `admin/zonetype` 为其他并行任务新增文件，其未使用变量告警会导致全量 `tsc` 失败，与本模块无关。
