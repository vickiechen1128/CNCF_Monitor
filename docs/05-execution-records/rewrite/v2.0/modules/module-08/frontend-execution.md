# Module 08 前端 F1 执行记录（API 适配层 + 告警页）

> **状态**：done（F1 主体完成；配置页 reload 历史视图未做）
> **分支**：`rewrite/v2.0`
> **执行日期**：2026-11-16
> **契约**：`api-contract-snapshot-v3.md`（v3 前缀 + 30/32 端点）
> **范围**：`ui-custom/web/src/api/alertmanager.ts`、`src/api/inhibitions.ts`、`src/types/alertmanager.ts`、`src/pages/alerts/*`

---

## 1. 策略：在 API 边界做形状适配，页面零重写

v3 与页面沿用的 v2 视图差异集中在信封与路由树形态，因此**不逐个重写 15 个页面**，
而是在 `src/api/alertmanager.ts` 内完成映射：

| 差异 | 适配 |
|---|---|
| 前缀 `/api/v2` → `/api/v3` | 常量 `BASE`，全部端点迁移 |
| 列表 `{items}` ← `{list}` | 静默 / 渠道 / 模板 / 历史版本 / reload 日志统一映射 |
| 路由树：v3 嵌套 `children` ↔ 页面扁平 `RouteNode[]` | `flattenWireRouteTree` / `nestEditRouteTree` 双向转换（`parent_id`/`order` 由遍历位置生成） |
| `GET /config/current` → `GET /config`，字段换 `version/route_tree/reload` | `toConfigVersion` 映射为页面沿用的版本视图 |
| `GET /config/product` 已删除 | 由 `/config.content` 派生（保留方法，暂无页面依赖） |
| 保存 = 即时 apply（无变更单） | 响应映射补 `applied` / `reload_status` / `pending_sections`；`useRoutes` 提示改为「已保存并生效」 |
| 渠道 `type` → `channel_type`、`template_id` → `default_template_id`（UUID 字符串） | `toChannelPayload` 映射；IM 未选模板时**自动回落到同类型内置模板**，满足 v3「IM 必填模板」 |
| 抑制规则：整表保存 → 单条 CRUD | `inhibitionsApi.save` 拉取服务端现状后做 diff：新增 POST / 变更 PUT / 删除 DELETE；预置规则跳过删除 |

## 2. 连带的后端补齐（F1 期间发现）

| 项 | 说明 |
|---|---|
| `Matcher.is_equal` | 前端路由条件支持 `!=` / `!~`，v3 原 `Matcher` 只有 `is_regex` 导致取反语义丢失 → 增加可选 `is_equal`（缺省 true），`configgen` 渲染四种运算符；契约 §3.2 已加注 |
| 预置抑制规则 seed | FR-19 要求「网域离线抑制次生告警」预置规则 → `service.Seed` 幂等写入 `builtin=true` 规则（来源 `alertname=NetworkDomainDown`、目标 `inhibitable=true`、`equal=[network_domain_id]`） |
| 渠道 secret 语义修正 | 前端「关闭签名」提交空 secret 原会被后端当成「保留」，导致密钥残留 → 后端改为：`sign_enabled=false` 时清空密钥，`true` 且空则保留；补 `channel_test.go` 两例 |

## 3. 验证证据

> ⚠️ 必须用**项目工具链 Node 22**（`.tools/node/bin/node`）跑前端测试；系统 Node 25 + 当前 jsdom 会让 `window.localStorage` 退化为空对象，导致 HomePage 56 例在 `afterEach` 全部报错（环境问题，非用例失败）。

| 项 | 命令 | 结果 |
|---|---|---|
| 类型门禁 | `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 通过 |
| 目标回归 | `node node_modules/vitest/vitest.mjs run src/pages/home src/pages/alerts src/api` | **33 文件 / 393 例全绿** |
| Lint（变更范围） | `eslint src/api/alertmanager.ts src/api/inhibitions.ts src/types/alertmanager.ts src/pages/alerts` | 0 error / 0 warning |
| 全量 lint | `eslint .` | 5 个 **既有**错误，全部位于未提交的 `src/pages/visualization/`（非 F1 变更，见 `git status`） |
| 后端回归 | `go test ./platform/...` + `go vet` | **69 包 ok / 0 FAIL**，vet 无输出（F1 期间的后端补齐后复跑） |

## 4. 变更清单

- `src/api/alertmanager.ts`：v3 适配层（配置 / 静默 / 告警 / 渠道 / 模板 / 路由 + `readValidateErrors` 支持 `data.validation`）
- `src/api/inhibitions.ts`：diff 式整表保存
- `src/types/alertmanager.ts`：模板 ID 改字符串；`SaveRoutesResult` 增 `applied/reload_status/pending_sections/snapshot_synced`
- `src/pages/alerts/useRoutes.ts`：保存成功提示改为「已保存并生效」
- `src/pages/alerts/NotifyChannelDrawer.tsx`：模板下拉使用字符串 ID
- 测试：`HomePage.test.tsx` 路径常量 v2→v3、渠道用例模板 ID 字符串化、`useRoutes.test.ts` 断言即时生效

## 5. 遗留

| # | 项 | 说明 |
|---|---|---|
| 1 | 配置页「reload 历史」视图 | API 已备（`getReloadLogs` / `reload()`），页面未接入；可作为 v0.3 增量 |
| 2 | 抑制规则 `effective_checksum` | v3 单条保存不带整表 checksum，页面乐观锁对抑制表退化为无锁（路由保存仍有 409） |
| 3 | 全量 lint | 依赖 `src/pages/visualization/` 的归属确认（未提交目录），不是 F1 引入 |
