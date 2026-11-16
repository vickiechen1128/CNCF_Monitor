# M07 平台组织维度与应用归属完整性 — 执行记录（2026-11-16）

> 分支：`rewrite/v2.0`
> 决策：`docs/05-execution-records/rewrite/v2.0/decisions.md` **D41 / D42 / D43**
> 设计提案：`design-proposals/platform-org-dimension-and-app-membership.md`（draft）
> SRS：`Module_07_Monitoring_Object_Management_Requirements.md` **v1.1 → v1.2**
> 状态：代码 + 文档已落地，测试与静态检查通过

---

## 1. 背景

owner 澄清运维组织架构事实：**先有平台，再由应用运维团队组织保障，平台由「该有多少应用」聚合而成；应用不是孤立、人为随意定义的**。并提出来告警面板除按静态资源对象类型（主机 / 数据库 / 中间件 / 应用 / 接口）聚合外，还需按 **平台 / 应用 / 业务** 三维聚合。

据此修正首轮复核中「砍掉平台维度」的误判，并落三条决策：

| 决策 | 内容 |
|---|---|
| D41 | `platform` 是组织归属 / 告警分发的**第一维度**（与「排障下钻顺序」是两个问题），修正旧线决策 112 与顶层 T7 的片面结论 |
| D42 | 应用**必须归属平台**：I1 至少一关联、I2 主平台唯一必填（首个关联自动置主）、I3 转移主平台须显式（不自动提升） |
| D43 | `platform_code` 一等字段**收敛到静态资源**；组成型资源（application / interface_service）回归 app 主平台派生 |

---

## 2. 变更清单

### 2.1 后端（`platform/modules/m07/`）

| 文件 | 变更 |
|---|---|
| `domain/category.go` | 新增 `Category.IsComposed()` / `IsStatic()`，区分组成型与静态资源 |
| `dictionary/repository.go` | 新增 `ErrAppRequiresPlatform` / `ErrPrimaryPlatformTransferRequired`；`CreateApplication` 改事务（应用 + 平台关联原子创建）；抽出 `createAppPlatformRelTx`（首个关联强制置主、主平台唯一校验）；`CreateAppPlatformRel` 走事务；`DeleteAppPlatformRel` 加 I1 / I3 守卫；`SetPrimaryAppPlatformRel` 拒绝「取消主平台」（只能转移） |
| `dictionary/service.go` | `CreateApplication` 新增 `platformCodes []string`，`normalizePlatformCodes` 做去重 / 非空（I1）/ 平台存在且启用校验；空集合返回可执行提示 |
| `handler/dictionary_handler.go` | `POST /application-dict` 请求体新增 `platform_codes`；两条新错误映射为 409 |
| `service/platform_resolver.go`（新增） | `resolvePlatformFor`：组成型资源恒由 app 主平台派生（忽略显式输入）；静态资源显式优先、留空兜底；无主平台时记录可观测告警 |
| `service/resource_service.go`、`service/import_service.go` | 复用 `resolvePlatformFor`，删除重复兜底实现 |

**契约变化**：`POST /api/v3/platform/application-dict` 新增必填 `platform_codes: string[]`（≥1，首个即主平台）；`DELETE /app-platform-rel/:rel_id` 与 `PUT /app-platform-rel/:rel_id`（`is_primary=false`）新增 409 拒绝路径。

### 2.2 前端（`ui-custom/web/src/`）

| 文件 | 变更 |
|---|---|
| `api/resources.ts` | `ApplicationDictCreateInput` 增 `platform_codes`（必填）并注明 D42 |
| `pages/resources/ApplicationDictPage.tsx` | rel 同步顺序改「**新增 → 主平台切换 → 解绑**」（原「解绑 → 新增」会在切换唯一平台时触发 I1 拒绝）；登记改一次提交 `platform_codes`（主平台排首位，省一次 SetPrimary）；「所属平台 / 主平台」改必填，未选主平台时默认取首个已选平台 |
| `pages/resources/PlatformManagementPage.tsx` | 新增操作列「关联应用」+ `PlatformAppsDrawer`（经 `app_platform_rel` 反查，只读、含主平台标记）；Callout 文案去「可选」，改「应用必须归属平台」 |
| `pages/resources/ResourceFormDrawer.tsx`、`resourceFormFields.tsx` | 组成型资源（application）隐藏平台下拉，改只读展示「由所属应用的主平台自动决定」；静态资源保留显式下拉 |

### 2.3 文档

| 文件 | 变更 |
|---|---|
| `SRS/Module_07_..._Requirements.md` | v1.1 → v1.2：§3.2 组织定位（平台段 / 应用段 / 关系总结约束方向）、§4.1 角色（三者改运维自助维护）、§5.2 FR-07/08/09/10（组织语义 + 三条不变量 + 按类型分派）、**新增 §5.6 FR-23 三维聚合契约**、§6.6 **新增 NFR-18 应用归属完整性**、§7.2 / §7.3、§9.1 验收、Change Log |
| `rewrite/v2.0/decisions.md` | 新增 D41 / D42 / D43 + 待决清单（M08 / M05 消费侧挂账）+ 审计记录 |
| `modules/module-07/design-proposals/platform-org-dimension-and-app-membership.md` | 新增（draft），含论证、差异点、验收标准、合并计划 |

---

## 3. 验证结果

| 项 | 命令 | 结果 |
|---|---|---|
| 后端编译 | `go build ./platform/...` | ✅ 通过 |
| 后端静态检查 | `go vet ./platform/modules/m07/...` | ✅ 通过 |
| 后端测试 | `go test ./platform/modules/m07/...` | ✅ 8 包全绿 |
| 前端类型门禁 | `pnpm run typecheck:test` | ✅ 通过 |
| 前端 lint | `pnpm lint` | ✅ 通过（0 error / 0 warning） |
| 前端测试（本次涉及） | `pnpm vitest run src/pages/resources/{ApplicationDictPage,PlatformManagementPage,ResourceFormDrawer}.test.tsx src/api/resources.test.ts` | ✅ 全绿（16 + 9 + 数条 + 1） |

### 新增测试覆盖

**后端**

- `TestServiceAppPlatformRelCRUD`（重写）：首个关联强制置主、删除最后一个被拒（I1）、直接解绑主平台被拒（I3）、取消 `is_primary` 被拒、显式转移后可解绑。
- `TestCreateApplicationRequiresPlatforms`（新增）：缺平台 / 空白 / 停用平台拒绝；去重后首个为主平台；校验失败不落半个应用。
- `TestComposedResourceAlwaysDerivesPrimaryPlatform`（新增）：组成型资源忽略手填 `platform_code`，创建与更新均取 app 主平台。
- `TestStaticResourceKeepsExplicitPlatform`（新增）：静态资源显式优先、留空兜底。
- `TestV3DictionaryWriteLifecycle`（更新）：应用登记带 `platform_codes`；缺平台 → 400；登记后关联落库且首个为主平台。

**前端**

- 应用登记必须带平台（未选 → 拦截、不调 create）
- 未选主平台时默认取首个所属平台
- 清空全部平台被拒绝且不发起解绑（D42 I1）
- 解绑非主平台走 DELETE、主平台不被解绑（D42 I3）
- 平台页「关联应用」反查 + 主平台标记

---

## 4. 已知遗留

1. **M08 告警面板三维聚合**（D41 消费侧）：按 `platform` / `app` / `biz` 聚合展示分析、`platform` 为一级维度；资源类型维走 `resource_category` 回填字段。待 M08 owner 排期回填。
2. **M05 看板平台汇总卡**（D41 消费侧）：平台维作为一级汇总卡片，不再标注「可选顶层过滤器」。
3. **5 条云列相关前端测试为基线既有失败**（`ResourcesPage.test.tsx`：「决策 103：云列渲染云字典 cloud_name」等）。已用 HEAD 版本源码复跑确认与本轮改动无关，未在本轮修复。
4. **存量数据**：本轮只对新增 / 编辑路径强制不变量；若历史库存在「零平台归属的应用」，需后续补一次性巡检脚本（`PrimaryPlatformOfApp` 已在无主平台时打告警日志，可作观测入口）。

---

## 5. 回滚方式

- 代码：按本文件 §2 逐文件 revert（后端 6 个文件 + 新增 1 个；前端 4 个文件）。
- 数据：本轮无 schema 变更（不变量在服务层），回滚无需迁移。
- 文档：SRS 回退到 v1.2 之前的版本；`decisions.md` 删除 D41~D43 三行与对应审计记录。
