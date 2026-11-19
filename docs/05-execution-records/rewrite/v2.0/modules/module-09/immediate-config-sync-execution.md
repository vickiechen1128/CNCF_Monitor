# M09 即时配置同步（方案 A）执行记录

- 状态：implemented，待联调收尾
- 日期：2026-11-18
- 关联：M09 SRS v1.5 FR-10 / FR-12 / FR-13；M01 SRS v1.0 FR-12 / FR-16、NFR-03
- 范围：M09 快照生成 / M01 同步状态 / 中心规则 reload；**不包含**边缘采集节点生效

## 1. 目标

保存 M01 采集 Job / 规则后，不再只能等 30s watcher：

- 立即触发 M09 生成新快照；
- 立即回写 M01 `sync_status=synced/failed`；
- 中心规则立即写 `rules.yml` 并 reload 中心 Prometheus；
- watcher 保留为兜底，触发失败不阻断保存。

## 2. 后端实现

### 2.1 即时触发接口

`POST /api/v3/platform/config-sync/trigger`

```json
{ "scope": "domain", "network_domain_ids": ["mc-demo"], "wait": false }
```

- `scope=domain`：登录用户 + 网域授权；只允许 enabled edge domain；
- `scope=center`：admin；重算中心规则；
- `scope=all`：admin；全部 enabled edge domain + 中心规则；
- `wait=false`：进入 500ms debounce 队列，返回 `accepted=true`；
- `wait=true`：同步执行（默认 5s 超时），返回逐域/中心结果；超时则任务入队并返回 `completed=false`。

实现文件：

- `platform/modules/m09/service/config_trigger_service.go`
- `platform/modules/m09/handler/config_trigger_handler.go`
- `platform/modules/m09/dto/config_trigger.go`
- `platform/modules/m09/handler/routes.go`
- `platform/modules/m09/module.go`

服务端语义：

- 按 domain 合并 pending，避免批量保存触发 N 次 promtool；
- `scope=all` 通过 `ConfigSyncService.EdgeDomainIDs` 枚举；
- domain 生成复用 `SyncDomain` 的 per-domain mutex；
- 触发失败仅日志，30s watcher 兜底。

### 2.2 规则 job 引用校验修复

原 `configgen.Validate` 固定传 `platformJobs=nil`，导致任何引用 Job 的中心规则都会被判 failed。

修复：

- `configgen.Validate(artifacts, platformJobs []string)`；
- `Validator` 接口增加 `platformJobs` 参数；
- 域配置仍传 `nil`（域包不含 rules）；
- 中心规则在 `RulesYML` 非空时通过 `CenterRuleSource.EffectiveJobNames` 读取全平台 `enabled + draft_status=ready` Job 并集；
- `GORMCenterRuleSource.EffectiveJobNames` 新增实现。

### 2.3 中心规则并发锁

`CenterRulesService.Sync` 增加 `sync.Mutex`，串行化 watcher 与即时触发，避免同时观察到无 current 时插入重复快照。

## 3. 前端实现

### 3.1 触发层

`ui-custom/web/src/pages/config-center/preview/triggerConfigDraft.ts`：

- 由空实现改为调用 `configSyncTriggerApi.trigger`；
- `triggerConfigDrafts(ids)` → `scope=domain`；
- `triggerConfigDraftsForAllDomains()` → `scope=center`；
- 去重 / trim / 空数组跳过 / 异常静默（watcher 兜底）。

新增 API/类型：

- `ui-custom/web/src/api/configCenter.ts`：`configSyncTriggerApi`
- `ui-custom/web/src/types/config-center.ts`：`ConfigSyncTrigger*`

### 3.2 保存后状态轮询

新增 `ui-custom/web/src/pages/strategy/useSyncPolling.ts`：保存/启停/删除后 10s 内每 1s 刷新当前页，避免用户手动刷新才看到 `synced/failed`。

轮询必须走 **silent refresh**：`useScrapeJobs.reload({ silent: true })`、`loadGroups(true)`、`RulesPage.load(true)` 不置 `loading=true`，否则 Ant Table 会每秒闪一次 loading 遮罩/转圈。用户主动刷新仍显示 loading。

已接入：

- `ScrapeJobListPage`：表单保存、任务组保存、启停、删除；
- `JobGroupWizardDrawer`：保存后按所选实例所属网域触发；
- `RulesPage` / `RuleMountDrawer`：规则保存、启停、删除触发中心规则重算。
- `syncStatus.ts`：`pending` 描述改为「M09 正在同步，通常几秒内完成」。

## 4. 验证

已执行（按模块定向）：

```bash
go test ./platform/modules/m09/service ./platform/modules/m09/handler ./platform/modules/m09/configgen -count=1
go test ./platform/modules/m09/... -count=1
go vet ./platform/modules/m09/...
cd ui-custom/web
pnpm vitest run src/pages/config-center/preview/triggerConfigDraft.test.ts \
  src/pages/strategy/useSyncPolling.test.ts \
  src/pages/strategy/RulesPage.test.tsx \
  src/pages/strategy/ScrapeJobListPage.test.tsx \
  src/pages/strategy/ScrapeJobFormDrawer.test.tsx \
  src/pages/strategy/RuleMountDrawer.test.tsx
pnpm run typecheck:test
pnpm exec tsc --noEmit
pnpm exec eslint <changed files>
```

新增用例：

- `TestConfigTriggerDomainWaitSyncsOnlyRequestedDomain`
- `TestConfigTriggerCenterWaitSyncsRules`
- `TestConfigTriggerRejectsInvalidScopeAndEmptyDomains`
- `TestConfigTriggerEnforcesDomainAuthorization`
- `TestConfigTriggerAsyncCoalescesRapidRequests`
- `TestConfigTriggerEndpointWaitsAndReturnsResult`
- `TestConfigTriggerEndpointRejectsInvalidInput`
- `TestConfigTriggerEndpointHonorsDomainAuthorization`
- `TestCenterRulesSyncPassesEffectiveJobNames`
- `TestCenterRulesSyncConcurrentCallsShareOneSnapshot`
- `TestValidateCenterRulesUsesPlatformJobs`
- 前端 `triggerConfigDraft` / `useSyncPolling`

## 5. 待收尾

1. 用修复后二进制重启 8080 服务，登录后实际 POST 触发接口，核对 M01 `sync_status` 与 M09 当前快照；
2. M07 资源 / 标签模板 / Excel 导入 / 批量改归属/端口尚未接入即时触发，仍依赖 30s watcher；
3. 中心规则 `EffectiveJobNames` 只覆盖 Job 引用门禁；若规则修复动作发生在 Job 侧，规则指纹仍不会自动推进（既有行为）；
4. 本轮按用户要求未再跑全量 `pnpm test` / 全量后端测试。
