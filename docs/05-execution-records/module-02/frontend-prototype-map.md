# 原型 ↔ 生产 映射表：Module_02 指标查询中心（targets/coverage 采集状态）

> 依据 `frontend-developer.md` Step 3.5 六项核对，解决「原型视觉 / 列 / 入口与生产实现断层」问题。
> 本表作为 L3 规划与前端代码 review 的逐项勾验载体，反向从 `docs/prototypes/module-02` 与 `ui-custom/web/src/pages/query` 生成。
> 覆盖范围：前端 T02-F1（目标状态独立页 P1 极简列表 + targets/coverage API client + `types/query.ts`，决策 47）。
>
> 背景：Module_02 前端呈「多入口被各模块只读消费」形态。除 T02-F1 的 `TargetStatusPage` 外，
> `targetsApi` / `coverageApi` / `types/query.ts` 同时是 module-01（Job 实例采集状态，决策 47-2）
> 与 module-07（资源列表三态 badge，决策 47-3）的共享数据契约出口。后端对应：T02-01 targets 代理与本地过滤、
> T02-02 采集健康度三态聚合（commit `a8aa86e3` / `912edd26`）。

## 一、决策落版

| 决策 | 选择 | 落地说明 |
|------|------|----------|
| D1 视觉还原 | **a 强制** | 复用全站火山引擎 Token（主色 `#0ECDEB`、头部 `#0B1B2A`、内容背景 `#F7F8FA`）。生产 `src/theme.ts` 已全局注入。 |
| D2 原型定位 | **b 参考基底（极简裁剪）** | 决策 47-4：目标状态页由 P0 降 P1，仅落地「跨 Job 全局排障」的极简列表；原型复杂诊断视图（覆盖 Statistic 卡、拨测结果、标签列、详情抽屉、ReviewNote）达到 MVP 范围外（见「六、裁剪清单」）。 |
| D3 导航 | **a 不新增顶级 tab** | nav_contract：独立目标状态页为 P1，本期仅注册 API client 与可选极简页；**不新增顶部一级 tab**（状态知情入口由 M01/M07 回显承担）。生产 `TargetStatusPage` 作为 `/targets` 路由但无独立一级 tab 项。 |
| D4 数据契约所有权 | **a M02 独占出口** | `src/types/query.ts` 为 M02 前端独占类型出口（TargetItem / CoverageItem / CoverageState / CoverageSummary），被 module-01、module-07 只读消费（`import type`）。 |
| D5 极简列表边界 | **a 收敛为全局排障** | 决策 47-4：目标状态页定位跨 Job 全局排障入口（按 health/网域过滤极简列表），非唯一状态知情入口；过滤在 M02 后端完成，前端不重复过滤（targets.ts §1.3/§2.1 透传语义）。 |

## 二、文件级映射

| 原型文件（`docs/prototypes/module-02/src/`） | 生产对应（`ui-custom/web/src/`） | 处理 | 核对项 | 说明 / 理由 |
|---|---|---|---|---|
| `pages/TargetsPage.tsx` | `src/pages/query/TargetStatusPage.tsx` | **复制 + 极简裁剪** | 2 / 3 | 决策 47-4：仅保留「目标状态表格 + health/网域筛选」极简列表；裁剪覆盖 Statistic 卡、拨测结果/标签列、详情抽屉、ReviewNote（见「六、裁剪」）。行渲染用 `Badge`（在线/离线/未知）替代原型 `Tag` 图标。 |
| `pages/QueryPage.tsx` | `src/pages/query/QueryPage.tsx` | **参考（本期不落地）** | — | 原型 PromQL 查询中心（表达式执行 / Envelope / 三层注入 / 数据新鲜度）归 M02 查询相关子任务，本期 T02-F1 仅产出 target/coverage 相关；本表不作逐列对照。 |
| `mocks/module-02.ts`（scrapeTargets / coverageStats / TargetStatus / ScrapeTarget） | `src/api/targets.ts` / `src/api/coverage.ts` / `src/types/query.ts` | **替换** | 4 数据契约 | mock 数据替换为真实 API；类型契约落 `types/query.ts`（对齐 api-contract-snapshot §2）。 |
| — | `src/api/targets.ts`（`targetsApi.list`） | ➕生产新增 | 4 | `GET /api/v1/targets`，透传 Prometheus `activeTargets`，M02 后端按 job/network_domain/health 过滤并补全 network_domain（T02-F1，commit `6fc2d036`）。 |
| — | `src/api/coverage.ts`（`coverageApi.list`） | ➕生产新增 | 4 | `GET /api/v1/health/coverage` 三态聚合（collecting/pending_down/not_monitored），按 resource_id 回连五类资源（T02-F1）。 |
| — | `src/types/query.ts` | ➕生产新增 | 4 | T02-F1 新增：TargetItem / TargetsResponse / CoverageItem / CoverageState / CoverageSummary / CoverageListResponse。 |
| — | `src/pages/query/TargetStatusPage.{tsx,test.tsx}`、`src/api/targets.{ts,test.ts}`、`src/api/coverage.{ts,test.ts}` | ➕生产新增 | 4 / 验证 | T02-F1 生产实现及配套测试（commit `6fc2d036` 共 8 文件 +589）。 |
| — | `src/layouts/MainLayout.tsx` / `src/App.tsx` | **参考（不改一级 tab）** | 1 路由 / D3 | `MainLayout` 活跃模块解析 `/targets` 无一级 tab 项（回落某模块/首页）；`App.tsx` 注册 `/targets` 懒加载路由（decision 47-4）。 |

## 三、表格列 / 区块对照

### 3.1 目标状态表格（原型 `TargetsPage.tsx` vs 生产 `TargetStatusPage.tsx`）

| # | 原型列 / 区块 | 生产现状 | 处理 | 理由 |
|---|---|---|---|---|
| 1 | Job | ✅ 已有 | — | `job`。 |
| 2 | Instance | ✅ 已有 | — | 生产列头「实例地址」（`instance`，`Text code`）。 |
| 3 | 状态（up/down/unknown + 图标 Tag） | ✅ 已有 | 对齐 | 生产「采集状态」用 `Badge`（在线=success/离线=error/未知=warning），语义对齐原型。 |
| 4 | 最后采集 | ✅ 已有 | — | 生产「最后采集时间」（`lastScrape`）。 |
| 5 | 拨测结果（probe_success） | ❌ 缺失 | **裁剪** | 决策 47-4：P1 极简列表，blackbox 拨测归模块相关导航/详情，MVP 收敛。 |
| 6 | 最后错误 | ✅ 已有 | 对齐 | 生产「最后错误」（`lastError`，`EllipsisText`）。 |
| 7 | 网域 | ✅ 已有 | — | 生产「所属网域」（`network_domain`，默认 `default`）。 |
| 8 | 标签（labels Tag 组） | ❌ 缺失 | **裁剪** | 极简列表，标签列归详情/高级视图（不得超出 P1）。 |
| 9 | UDP 采集时长 / 诊断指标 | ✅ 已有（简化） | 对齐 | 生产「采集耗时」（`scrapeDuration`）；原型详情抽屉内「HTTP 状态码/scrape_duration」不落地。 |
| 10 | 顶部「监控覆盖率 Statistic 三卡」（已监控 Up/已监控 Down/未监控 + 覆盖率） | ❌ 缺失 | **裁剪** | 决策 47-4：覆盖率消费方为 M07 资源列表三态 badge（只读），不再在目标状态页重复展示（见「六、裁剪」）。 |
| 11 | 筛选（网域 / Job / 状态） | ⏭️ 部分实现 | 裁剪 | 生产仅「采集状态（health）」+「所属网域」两个筛选；「Job」筛选未落地（极简列表按需）。 |
| 12 | 行点击 → 详情抽屉（采集诊断） | ❌ 缺失 | **裁剪** | P1 极简列表不做行级诊断抽屉。 |
| 13 | 单网域模式提示 + 目标状态页定位说明 Alert | ⏭️ 替代 | 替换 | 生产 Header 副标题说明「跨 Job 全局排障」；网域模式由 M06/M09 承载，不做原型 tenants/multiSite 幻影。 |

### 3.2 API / 类型契约（T02-F1 独占新增）

| 契约项 | 生产实现 | 备注 |
|---|---|---|
| `TargetItem` | `types/query.ts` | `scrapePool/job/instance/network_domain/health/lastScrape/lastError/scrapeDuration/resource_id`（§2.1.1，透传 + network_domain 补全）。 |
| `TargetsResponse` | `types/query.ts` | `activeTargets/droppedTargets/targetsByJob`（对齐 Prometheus targets 响应，§2.1.2）。 |
| `targetsApi.list(params)` | `api/targets.ts` | `job/network_domain/health/state` 筛选；MVP 恒 active（§2.1）。 |
| `CoverageState` | `types/query.ts` | `collecting / pending_down / not_monitored`（§2.2.1）。 |
| `CoverageItem` | `types/query.ts` | `resource_id/resource_category/instance_name/monitor_state/health(可空)/last_error`。 |
| `CoverageSummary` | `types/query.ts` | `total/collecting/pending_down/not_monitored/coverage_rate`（§2.2.2）。 |
| `CoverageListResponse` | `types/query.ts` | `items/total/summary`（§2.2.3）。 |
| `coverageApi.list(params)` | `api/coverage.ts` | `network_domain/resource_category/state/page/page_size`（§2.2）。 |

## 四、导航与 IA 模型

### 4.1 顶部一级 tab（Header，本期不新增）

| 原型 / PRD 模块名 | 生产实现 | 备注 |
|---|---|---|
| 首页 / 系统与平台管理 / 监控对象管理 / 采集策略 / 网域与边缘配置中心 | `home` / `platform-admin` / `monitoring-object` / `monitoring-strategy` / `config-center` | 既有模块。 |
| 指标查询（查询中心） | **⚠️ 无独立一级 tab** | 决策 47-4 / nav_contract：目标状态页 P1 不新增顶部 tab；状态知情入口由 M01/M07 回显承担，查询入口由 M05 门户收口。 |

### 4.2 独立路由

| 页面 | 路径 | 生产现状 | 备注 |
|---|---|---|---|
| 目标状态（全局排障） | `/targets` | ✅ 已实现（懒加载） | `App.tsx` 注册（T02-F1，commit `6fc2d036`）。 |

## 五、视觉 Token 清单

与全站 `src/theme.ts` 共用同一套火山引擎 Token（与 module-07/08 一致）。`TargetStatusPage` 无独立新 Token：

| Token | 值 | 用途 | 来源文件 |
|---|---|---|---|
| 主色（Primary） | `#0ECDEB` | 主按钮、选中态 | `src/theme.ts` `colorPrimary` |
| 成功色 | `#00B578` | 在线（up） | `src/theme.ts` `colorSuccess` |
| 错误色 | `#FF4C3A` | 离线（down） | `src/theme.ts` `colorError` |
| 警告色 | `#FA8C16` | 未知（unknown） | `src/theme.ts` `colorWarning` |
| 页面背景 | `#F7F8FA` | Content 背景 | `src/theme.ts` `colorBgBase` |
| 次要文字 | `#4E5969` / `#86909C` | 辅助说明 | `src/theme.ts` `colorTextSecondary` / `colorTextTertiary` |

## 六、裁剪清单（原型中有但 MVP P1 生产未保留）

| 原型项 | 生产处理 | 理由 |
|---|---|---|
| 「监控覆盖率 Statistic 三卡」+ 覆盖率 | 裁剪 | 决策 47-3/47-4：覆盖率消费方为 M07 资源列表三态 badge；目标状态页 P1 收敛不再重复展示。 |
| 拨测结果（probe_success）列 | 裁剪 | P1 极简列表，blackbox 拨测归详情/高级视图。 |
| 标签（labels）列 | 裁剪 | 极简列表，标签列归详情视图。 |
| 行点击（详情抽屉：采集诊断 / HTTP 状态码 / 标签） | 裁剪 | P1 极简列表不做行级诊断抽屉。 |
| Job 筛选 + 网域/Job/状态三筛选 | 裁剪为 health + 网域 | 极简列表按需，M01/M07 已提供业务场景内状态知情。 |
| 单网域/多网域模式幻影（tenants/multiSite） | 裁剪 | 网域授权边界由 M06/M09 承载，T02-F1 不做。 |
| `ReviewNote` 设计说明区块 | 裁剪 | 原型评审脚手架，不进入生产。 |
| `mock/module-02.ts` 全量 mock | 替换为真实 API | MVP 必须对接后端（targets / coverage）。 |

## 七、开发验证待办清单

- [ ] D1：确认 `TargetStatusPage` 复用全站 Token，无 antd 默认 `#1677ff` 残留。
- [ ] D3：确认 `MainLayout` 无新增「指标查询/目标状态」一级 tab；`/targets` 路由懒加载可访问。
- [ ] 目标状态页：health / 网域筛选能透传后端（M02 后端过滤，前端不重复过滤）；表格列与「3.1」表一致。
- [ ] targets API：`targetsApi.list({job:…})` 在 M01 Job 实例采集状态回显（决策 47-2）中消费正常。
- [ ] coverage API：`coverageApi.list({resource_category})` 在 M07 资源列表三态 badge（决策 47-3）中 Map by resource_id 合并正常；coverage 加载失败不影响资源列表主渲染（降级 `-`）。
- [ ] `types/query.ts`：`TargetItem / CoverageItem / CoverageState / CoverageSummary` 与 api-contract-snapshot §2 一致，被 M01/M07 只读引用无破坏。
- [ ] 权限/错误状态：目标状态 / M01 回显 / M07 badge 的 加载中、空态、接口错误 状态矩阵与 PRD §5.3/§6.1 一致。
- [ ] `targets.test.ts` / `coverage.test.ts` / `TargetStatusPage.test.tsx` 通过（T02-F1 配套）。
- [ ] 全局：`make test-platform` + 前端 `pnpm test` / `pnpm lint` 通过；后端 run + 前端 dev 200。