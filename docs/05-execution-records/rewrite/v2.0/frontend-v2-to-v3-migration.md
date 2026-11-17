# 前端残留 /api/v2 → v3 迁移记录

> **分支**：`rewrite/v2.0`
> **日期**：2026-11-16
> **目标**：`make run-metric-center-v3`（v3-only）下不再出现「页面 404」，把仍有 v3 对应能力的前端模块全部切到 `/api/v3`；v3 不存在的看板能力补齐后端，被删除的草稿/下发机制改为快照视图。

---

## 1. 背景

v3-only 启动只挂 `/api/v3`，但前端仍有 6 组模块指向 `/api/v2`，导致页面 404。迁移前盘点：

| 模块 | 原客户端 | v3 处置 |
|---|---|---|
| 用户 / 租户 / 登录日志 | `api/admin.ts` | 直接迁移（M06 v3 已有） |
| 存储与日志 | `api/storage.ts` | 直接迁移（M06 v3 已有） |
| 标签模板 | `api/labelTemplates.ts` | 迁移 + 语义收敛（M07 v3 契约不同） |
| 首页 / 看板 / 可视化 | `api/dashboard.ts`、`api/dashboardPanels.ts` | v3 无后端 → 新增 M05 v3 模块 |
| 配置预览 / 下发记录 | `api/configCenter.ts` | v3 删除草稿机制 → 改为快照视图 |

---

## 2. 各项改动

### 2.1 M06 管理面（用户 / 租户 / 登录日志）

- 路径全量切 `/api/v3/platform/*`；列表信封 `{items,total}` → `{list,total,page,page_size}`。
- `UserItem` 补 `tenant_id`、`role` 必填、`last_login_at` 允许 `null`；`LoginLogItem.ip` 可选。
- 写请求按 v3 严格解码收敛：用户 PUT 只带 `display_name/role`，租户 PUT 只带 `name/multi_site_enabled`。
- 用户列表筛选移除 v3 不支持的 `username`，改 `keyword`。

### 2.2 M06 存储与日志

- 仅路径切换（`/api/v3/platform/storage-logs*`），响应结构与前端类型完全一致，无 UI 改动。

### 2.3 M07 标签模板

v3 契约与 v2 差异较大，按契约收敛：

- 模板 ID `number → string`；列表信封 `{list,total,page,page_size}`；模板**无 `description`、无 `deleted_at`**。
- v3 **无 mapping 子端点**：`addMapping/replaceMappings/updateMapping/removeMapping` 改为「GET 模板 → 改 `mappings` 数组 → PUT 整模板」，映射按下标定位。
- v3 **无 clone 端点**：客户端用 GET → POST 复制实现（默认名 `${原名} 副本`）。
- v3 **无 `/:id/resources`（关联实例）端点**，且模板在 v3 语义下由 M01 Job/映射引用、不绑定资源：移除「关联实例」Tab、实例 badge 与相关类型。
- PUT 全量提交，且不提交 `resource_category`（不可变，传了 400）；删除被引用 409 已透出为可读错误。

### 2.4 M05 v3 看板后端（新增）

- 迁移 `00010_m05_dashboard.{sqlite,postgres}.sql`：`m05_dashboard_panels`。
- 新模块 `platform/modules/m05`：
  - `GET /api/v3/platform/dashboard/summary`（登录）
  - `GET /api/v3/platform/dashboard/panels`、`/:id`（登录）；`POST`、`PUT`（admin）
- Summary 直接复用 `platform/dashboard` 的导出结构体，JSON 与前端 `DashboardSummary` 逐字段一致；聚合改为 v3 表（`resources` + 六类扩展表、`m01_scrape_jobs.selected_instance_ids`、`network_domains`、字典表）。
- 口径与 v2 对齐处：六类固定顺序、已监控集合 = ready+enabled Job 选中实例 ∩ 存活资源、`by_cloud` 仅主机且「未指定云」兜底、`by_platform_app` Top4 + 其他 + 未指定、`collection_health` 注入 PromURL 才查询（失败省略，绝不误报 0）。
- 降级项：拨测 `status`/`last_probe_at` 暂为未知（未接 `probe_success`），`probe_target_abnormal_count` 恒 0。

### 2.5 M09 配置中心 → 快照视图

- v3 已删除 drafts/versions/deployments/confirm/revalidate/discard/rollback 端点；替代为每域只读 `config-snapshots`（含 `content` 下载，admin）。
- 配置预览页改为「配置快照」：网域下拉 → 快照列表（版本/校验状态/当前生效/生成来源/checksum）→ 只读详情 Drawer + admin 内容下载。
- 下发记录页改为「快照历史」：并发拉取全部已纳管网域的快照、合并倒序、前端分页与筛选；单域失败降级不影响其他行。
- 删除 v2 草稿/版本/下发客户端与实体类型；`triggerConfigDraft` 保留为 no-op 兼容层（采集策略页仍在引用，属范围外）。
- MainLayout 菜单文案同步：配置快照 / 快照历史。

---

## 3. 验证

| 门禁 | 结果 |
|---|---|
| `go test ./platform/...` | 全绿（含 m05 新增与迁移回滚链） |
| `go vet ./platform/modules/m05/... ./platform/cmd/metric-center/...` | 通过 |
| `gofmt -l`（新增/改动后端文件） | 无输出 |
| `tsc -p tsconfig.json --noEmit` | 0 错误 |
| `tsc -p tsconfig.test.json --noEmit` | 0 错误 |
| 前端 scoped vitest（admin/label-templates/config-center/strategy/home/dashboard/visualization/layouts） | 79 文件 / 651 用例通过 |
| eslint（71 个改动文件） | 0 告警 |

> 注意：系统 Node v25 直接跑 vitest 会因全局 `localStorage` 与 jsdom 冲突导致 HomePage 等用例全挂；必须使用项目工具链 Node 22（`.tools/node/bin/node` 或 `make` 注入的 PATH），这是环境问题不是代码问题。

v3-only 实测（`METRIC_CENTER_DB_MODE=v3` + 全新 SQLite）：

| 检查 | 结果 |
|---|---|
| `/api/v3/platform/ready` | `schema_version=10` |
| `/api/v3/platform/meta` | `[system,m06,m07,m01,m09,m08,m05,auth]` |
| users / tenants / login-logs / storage-logs / label-templates | 200 |
| `dashboard/summary`、`dashboard/panels` | 200；面板创建 200、重名 409 |
| `network-domains/:id/config-snapshots` | 200（建域后自动生成快照） |
| `/api/v2/platform/users` | 404（符合 v3-only 预期） |

---

## 4. 遗留 / 后续

1. **M05 契约快照未更新**：`docs/05-execution-records/module-05/api-contract-snapshot.md` 仍是 v2 路径（且当前有他人未提交改动），需补 v3 段落（dashboard summary/panels）。
2. **拨测实时态**：`probe_targets.status` / `abnormal_count` / `last_probe_at` 仍是降级值，需接 Prometheus `probe_success` 查询。
3. **转换规则 `dict`**：v3 `LabelTemplate.Validate` 白名单不含 `dict`，前端已置灰并标注「v3 暂不支持」；若产品需要字典翻译，需后端补白名单与生成语义。
4. **列表分页**：用户/租户/登录日志页仍是「取首屏 + 客户端分页」（迁移前既有行为）；要真翻页需 hook 传 `page/page_size`。
5. **配置中心常量模块**：`configCenterConstants.ts` 仍引用 v2 枚举，实体类型已删；待随 v3 收敛一并清理。
6. **PostgreSQL**：迁移只做了静态校验，本机无 PG 环境未跑真库（`migrate_postgres_test` 已同步，需 `METRIC_CENTER_TEST_POSTGRES_DSN`）。
7. `client.test.ts` 仍以 `/api/v2/...` 作为「非 2xx 抛错」的任意 URL 样本，与契约无关。
