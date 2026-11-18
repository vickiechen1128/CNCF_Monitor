# M09 前端导航平铺 + 配置快照合并 + 中心直连域文案清理（执行记录）

> 日期：2026-11-17
> 关联模块：Module 09 网域接入与查询中心（v3 重写线 `rewrite/v2.0`）
> 需求来源：chenrt 2026-11-17 对话（三项要求，均经确认后执行）
> 需求权威：`docs/02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md`
> 契约权威：`docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md` §4

---

## 1. 三项决策（用户拍板）

| # | 要求 | 决策 |
|---|------|------|
| 1 | 「配置快照」与「快照历史」合并 | **合并为一页，页面名「配置快照」**；跨域/单域差异由页面内「网域」筛选承接（默认全部网域） |
| 2 | 网域与节点管理中残留的「中心直连域」说明 | **替换为正确口径**（所有网域均为采集节点域；平台只管理与存储），不是裸删 |
| 3 | 侧边栏分 2 类折叠 | **改为平铺**（与其它模块一致），折叠机制保留给「自定义大屏」 |

补充约束（用户确认）：
- 本轮「中心直连域」清理范围 = M09「网域与节点管理」两个页面（网域纳管 / 采集节点状态），跨模块残留另立单；
- 恒真分支（`channel === 'agent_pull'`）与 `management` / `local` 键一并清理。

---

## 2. 依据（为什么这些改动是「纠错」而非「改口味」）

- **中心直连域已被 PRD 取消**：M09 SRS §2.3 / §3.2 / NFR-02 / §9.2 明确「不存在中心直连域 / 管理域」「不再区分中心直连域/采集节点域」；M06 SRS NFR-02 进一步要求「用户界面不再出现『中心直连域 / 管理域』文案」。
- **后端已物理删除该概念**：`platform/modules/m06/domain/network_domain.go` 的 `ParseDomainType` 拒绝 `management`（v3 只创建 edge 域）。
- **前端自己也不再产出该值**：`src/api/configCenter.ts` 的 `toNetworkDomain` 恒写 `domain_type='edge'` / `channel='agent_pull'`，因此所有 `local` 分支与「中心直连域」文案都是**不可达的死分支**，却常驻展示并自相矛盾（同一提示既说「本页只展示采集节点域」又说「中心直连域无需部署」）。
- **两页是同一份数据**：两页共用同一后端接口（`GET /network-domains/:id/config-snapshots`）、同一组列、同一个 `SnapshotDetailDrawer`，差别只有「单域 / 全部域」的取数范围。

---

## 3. 变更清单

### 3.1 导航平铺（`src/layouts/MainLayout.tsx`）

- 删除 `ACCESS_PLANE_KEY` / `DELIVERY_PLANE_KEY` 两个 SubMenu 组及 `SendOutlined` 依赖；`config-center` 改为平铺 4 项，顺序「接入 → 观测 → 追溯」：
  网域纳管 `/domain-onboarding` → 采集节点状态 `/node-status` → 监控目标状态 `/targets` → 配置快照 `/config-snapshots`。
- `COLLAPSIBLE_GROUPS` 只保留 `custom-dashboards`（可视化大屏 · 自定义大屏），自动展开 / 尊重手动开合的机制保留。
- `resolveActiveModule`：`/config-preview`、`/deployments` 换成 `/config-snapshots`。

### 3.2 配置快照与快照历史合并

- `preview/useConfigSnapshots.ts` 重写为唯一数据源：`domainFilter` 为空 → 并发拉取全部已纳管网域并合并倒序（单域失败降级 `partialErrors`，全 403 判权限不足）；选中某一网域 → 只发 1 条请求（保留原单域页低成本路径）；深链 `initialDomainId` 未命中已纳管网域时回落「全部网域」。
- `preview/ConfigPreviewPage.tsx` 改为合并页：网域（可清空 = 全部）+ 校验状态 + 关键字筛选、网域列、详情抽屉、admin 内容下载；空态按「无已纳管网域 / 该网域无快照 / 无匹配 / 无明显原因」分档。
- 删除 `pages/config-center/deployments/`（`DeploymentsPage.tsx`、`useSnapshotHistory.ts` 及其测试）。
- 路由：`/config-snapshots` 为唯一注册路由；`/config-preview`、`/deployments` 以 `<Navigate replace>` 重定向（避免老书签落到首页通配路由）。
- 深链回指：采集节点状态页 `outOfSyncCauseAction` 与详情抽屉「查看配置快照」统一指向 `/config-snapshots`，抽屉跳转带 `?network_domain=<id>` 预筛（原「查看下发」文案与 `/deployments` 目标一并下线）。

### 3.3 中心直连域文案与死分支清理

| 文件 | 变更 |
|------|------|
| `domains/NetworkDomainsPage.tsx` | 常驻提示改为「所有网域均为采集节点域：平台只负责管理与存储，监控目标由部署在网域内的采集节点抓取并回传。纳管后请按下方指引部署采集节点。」；指引标题改「采集节点接入操作流程（安装指引）」；删除 3 处 `record.channel === 'agent_pull'` 恒真判断（运行态列 / 凭据列 / 「更多」菜单） |
| `nodes/EdgeAgentsPage.tsx` | 删除「暂无 agent_pull 网域（中心直连域）」空态分支与 `hasAgentPullDomain`，空态收敛为「筛选后无匹配 / 尚未接入采集节点」 |
| `domains/NetworkDomainDetailDrawer.tsx` | 删除「域类型」行（唯一类型无信息量）；下发通道展示「采集节点拉取」而非 `agent_pull`；`ConfigValue` 不再按通道裁剪 |
| `configCenterConstants.ts` | `channelLabel` / `channelTip` / `channelColor` 只保留 `agent_pull` 且改为用户语言；删除 `domainTypeLabel` / `domainTypeColor`、`DOMAIN_FIELD_TIP.channelLocal` / `agentTypeLocal` |
| `types/config-center.ts` | `Channel = 'agent_pull'`、`DomainType = 'edge'`（类型层面禁止再写回 local/management） |
| `nodes/edgeConstants.ts` | `outOfSyncCauseAction` 目标统一 `/config-snapshots`、文案改「查看配置快照」；`pending_draft` 提示去掉「变更单确认」v2 语义 |

### 3.4 空态引导出口（2026-11-17 追加，用户反馈「网域纳管无网域时按钮点不动」）

- `domains/NetworkDomainsPage.tsx`：空态按钮由 `disabled` 占位改为「**去网域管理登记**」，点击跳 `/admin/domains`（M06 行政登记页）——本页只消费 M06 已登记网域，无网域时留在本页无事可做。
- `nodes/EdgeAgentsPage.tsx`：空态出口按前置条件分流——一个网域都未登记 → 「去网域管理登记」（`/admin/domains`）；有网域但无采集节点 → 仍为「去网域纳管」（`/domain-onboarding`）。

### 3.5 测试

- 新增/重写：`preview/ConfigPreviewPage.test.tsx`（22 例，覆盖合并后的单域/跨域/筛选/分页/深链/权限/下载）、`preview/useConfigSnapshots.test.ts`（11 例，覆盖聚合、单域、深链回落、部分失败、403、reload）。
- 改写：`MainLayout.test.tsx`（原 6 条分组折叠断言改写为平铺 4 项 / 无 SubMenu / 选中态 / 模块归属）、`configCenterConstants.test.ts`、`NetworkDomainsPage.test.tsx`、`NetworkDomainDetailDrawer.test.tsx`、`EdgeAgentsPage.test.tsx`、`EdgeAgentDrawer.test.tsx`、`edgeConstants.test.ts`、`alertmanagerSmoke.test.tsx`。
- 断言方向调整：不再断言「中心直连域」存在（原断言把违规固化），改为断言其不出现。
- 空态出口：`NetworkDomainsPage.test.tsx` / `EdgeAgentsPage.test.tsx` 新增导航断言（`/admin/domains` 与 `/domain-onboarding` 分流）。

---

## 3.6 快照生成链路两处缺陷修复（2026-11-17 追加，后端）

### 3.6.1 M07 资源软删不触发重新生成（已修）

- **问题**：`GORMSourceReader.Fingerprint` 只查 `resources.updated_at`（且 `deleted_at IS NULL`）；M07 v3 删除只写 `deleted_at`、不碰 `updated_at`、也不回写 Job。删掉一个仍被 Job 选中的资源后指纹可能不前移甚至回退 → 该域不会重新生成，采集节点继续抓已删 target，直到别的变更把指纹推上去。对照：规则指纹（`m01_monitoring_rules`）与 Job 指纹都已补 `deleted_at` 查询，只有 resources / probe_modules 漏了。
- **修复**：`Fingerprint` 补两条对称查询——`resources.deleted_at`（按网域）与 `m01_probe_modules.deleted_at`（全局）；并在函数注释写明「GORM 软删只写 deleted_at，必须显式覆盖」的红线。
- **测试**：`source_reader_test.go` 新增 2 例（资源软删 / 探测模块软删必须让指纹前进），修复前 RED、修复后 GREEN。

### 3.6.2 保留策略被 am- 行挤占（已修）

- **问题**：`PruneSnapshots` 按整表 `created_at` 保留最新 5 条，而 M08 告警配置留痕（`am-` 行）也在 `domain_config_snapshots` 同表且通常更新 → 频繁保存告警配置会把真正的采集配置历史挤掉。另外 `am-` 行的 sink 网域可能不在 watch 集合内，永远不会走 `SyncDomain` 的裁剪，行数会无界增长。
- **修复**：
  1. `repository.AlertmanagerVersionPrefix = "am-"` + `isAlertmanagerSnapshot()`，`PruneSnapshots` 改为**按族各自保留 `keep` 条**（采集配置 / 告警配置留痕），且当前生效版本永不删除；
  2. `SaveAlertmanagerSnapshot` 插入后立即按同一保留窗口裁剪并清理旧内容文件（不再依赖 watch 集合）；
  3. 版本号生成改用 `repository.AlertmanagerVersionPrefix`，前缀不再散落字面量。
- **测试**：新增 `repository/snapshot_repository_test.go`（3 例：am 增长不驱逐配置历史 / 当前版本超出窗口仍保留 / 无 am 行时行为不变）+ `service` 1 例（多次告警配置留痕后窗口受限且配置快照与 current 不丢）。修复前 2 例 RED。

> 未纳入本轮：`am-` 行的「生成来源」列显示的是保存人用户名（M08 以 operator 作为 `generated_by` 传入），页面 `SNAPSHOT_GENERATOR_LABEL` 的 `alertmanager → 告警配置同步` 分支只对字面量 `alertmanager` 生效。若要统一为「告警配置同步」，需在 DTO 层把 am- 行的生成来源归一（保留 operator 供审计）或新增 `content_type` 视图字段，属契约增量，另议。

---

## 4. 验证

| 项 | 命令 | 结果 |
|----|------|------|
| 测试类型门禁 | `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit` | 通过 |
| 目标测试 | `vitest run src/pages/config-center src/layouts` | 14 文件 / 158 例通过 |
| 相关回归 | `vitest run src/pages/alerts/AlertConfigPage.test.tsx src/pages/alerts/RoutesPage.test.tsx` | 2 文件 / 47 例通过 |
| Lint | `./node_modules/.bin/eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0` | 通过 |
| 构建 | `./node_modules/.bin/tsc && ./node_modules/.bin/vite build` | 通过 |
| 服务启动 | `vite --port 5199` + `curl /`、`/config-snapshots` | 均 200，验证后已停服释放端口 |
| 后端 M09 | `GOCACHE=/tmp/mc-go-cache go test ./platform/modules/m09/...` | 7 包全通过（新增 6 例） |
| 后端静态 | `go vet ./platform/modules/m09/...` | 通过 |

> 说明：`pnpm` 在本机因 store 版本不匹配要求重装依赖（无 TTY 中止），验证改用 `ui-custom/web/node_modules/.bin/*` 等价命令；未改动依赖。

---

## 5. 遗留（本轮不做，建议另立单）

1. **跨模块「中心直连域」残留**（违反 M06 SRS NFR-02，但属 M07/M01 与后端）：
   - `pages/resources/TemplateDownloadModal.tsx:221/224`（导入留空归入中心直连域）；
   - `pages/strategy/ScrapeJobFormDrawer.tsx:609/823`（空态引导登记中心直连域）；
   - `platform/config/resource/excel.go:338`（导入失败报错文案）。
2. **M08 死链与 v2 术语**：`alertmanagerConstants.CONFIG_PREVIEW_PATH = '/config-preview'`（现依赖重定向可达），`RoutesPage` / `InhibitionsPage` 三处「前往『配置变更确认』」，`AlertConfigPage` 仍拼 `?change_no=`（v3 页面不消费）。
3. **快照聚合上限**：M09 单域快照接口硬编码 50 条、网域列表 `page_size=100`；合并后「全部网域」成为默认视图，超 100 域会静默漏域、域数多时首屏并发 = 域数。彻底解需后端加全局快照列表端点。
4. **v2 遗留常量**：`configCenterConstants.ts` 中 draft / deployment / change 系列映射已无 v3 消费方，待整文件收敛时删除。
5. **PRD 侧收口**：`docs/02-product-requirements/` 归 prototype-designer / chenrt；本次以执行记录 + `frontend-prototype-map.md` N2 作废注记落地，导航 4 项与合并页需在下次 PRD 轮同步。
