# M09 配置产物历史与导出 / M08 快照单份持久化（执行记录）

- 状态：implemented，待评审 / 联调
- 日期：2026-11-17 ~ 2026-11-18
- 关联需求：M09 SRS v1.5 FR-13 / FR-13.1 / FR-13.2 / FR-14；M08 SRS v1.5 FR-05 / FR-06 / FR-08
- 关联决策：D51（新增）、D31（写入方式修订）
- 关联契约：`api-contract-snapshot-v3.md` §4.2 / §4.3

## 1. 目标

1. 不引入回滚，但保留三类配置产物的只读历史：网域采集配置、中心规则、告警配置。
2. 详情可直接预览内容，导出件可直接落盘：domain zip、center `rules.yml`、alertmanager `alertmanager.yml`、中心一体化恢复包。
3. 取消 M08 → M09 的 `am-` 二次写入：M08 单份持久化，M09 只读引用。
4. 中心规则快照持久化完整产物（`prometheus.yml + rules.yml + targets`），支持恢复包与历史导出。

## 2. 后端改动

### 2.1 M09 统一读模型

- 新增 `platform/modules/m09/repository/artifact_repository.go`
  - `ArtifactType`（domain / center / alertmanager）与 `ArtifactFilter`。
  - `ListArtifacts` / `GetArtifact` / `CurrentArtifact`：直接读统一表 `config_snapshots`（0016），平台 scope 恒可见，domain scope 受调用方授权网域集约束。
- 新增 `platform/modules/m09/service/artifact_service.go`
  - 统一列表 / 详情 / 预览 / 导出 / 中心恢复包。
  - domain/center 内容读 `ContentStore` 的 JSON payload；alertmanager 读 DB `content`。
  - domain 导出复用 `BuildZip`；center 导出 `rules.yml`；alertmanager 导出原始 YAML；`raw=1` 提供次级原始载荷。
  - 恢复包：center 当前生效 `prometheus.yml + rules.yml + targets`，叠加 alertmanager 当前生效版本，附 `manifest.json`。
- 新增 `platform/modules/m09/dto/config_artifact.go`、`handler/artifact_handler.go`，路由：
  - `GET /api/v3/platform/config-artifacts`
  - `GET /api/v3/platform/config-artifacts/:id`
  - `GET /api/v3/platform/config-artifacts/:id/content`（admin）
  - `GET /api/v3/platform/config-artifacts/:id/export`（admin，支持 `raw=1`）
  - `GET /api/v3/platform/config-artifacts/recovery-bundle`（admin）
- `OnboardingService.AllowedDomainIDs`：为跨域读模型提供租户授权网域集（nil = 平台管理员不受限）。
- `storage.ContentStore`：导出 `Payload`，新增 `ReadPayload` / `Exists`。

### 2.2 中心规则内容持久化

- `CenterRulesService` 注入 `ContentStore`；校验通过后先写完整产物（`center/<version>.json`），成功后才 publish `rules.yml` 并 reload。
- 持久化失败按 `platform_fault` 落失败快照，不发布无历史内容的版本。
- 中心历史按 5 份自动裁剪（保留当前）；`M09.Options.AlertmanagerAddr` 注入中心 AM 地址，使恢复包的 `prometheus.yml` 带 `alerting.alertmanagers`。

### 2.3 M08 取消二次写入

- 删除 `AlertmanagerSnapshotSink` 端口（M08/M09 两侧接口文件）、M08 `sink` / `CenterDomainID` / `DomainReader` 配置与 `--alertmanager.center-domain-id` flag。
- 删除 M08 `SaveOutcome.SnapshotSynced` 与响应字段 `snapshot_synced`；前端同步删除对应类型/映射。
- M08 快照仍写 `config_snapshots(scope=alertmanager)`，作为唯一权威历史；M09 统一历史只读引用。

## 3. 前端改动

- 新增 `ui-custom/web/src/pages/config-center/preview/useConfigArtifacts.ts`：单请求统一历史，映射三类产物展示名（网域名 / 中心规则 / 告警配置）。
- `ConfigPreviewPage.tsx`
  - 页面改为「配置产物历史」；新增类型筛选列与「类型」列；平台产物范围显示「中心」。
  - admin 增加「导出中心恢复包」入口。
- `SnapshotDetailDrawer.tsx`
  - 改用 `configArtifactApi`：详情 + 按文件 Tab 的内容预览。
  - admin 导出主按钮按类型切换（zip / rules.yml / alertmanager.yml），并提供次级「下载原始载荷」。
  - 非 admin 不展示预览/导出，提示仅管理员可见。
- `api/configCenter.ts`、`types/config-center.ts`：新增 `configArtifactApi` / `ConfigArtifact*` 类型。
- `AlertConfigPage.tsx`：版本详情增加「下载 alertmanager.yml」。
- 删除 `snapshot_synced` 前端类型字段。

## 4. 测试

### Go

- 新增 `platform/modules/m09/service/artifact_service_test.go`
  - 三类产物统一列表、租户过滤、domain 预览文件、domain zip、center/AM 导出、恢复包 zip 条目、缺失产物。
- 新增 `platform/modules/m09/handler/artifact_handler_test.go`
  - 列表/筛选/详情/预览/导出/恢复包；非 admin 403；非法筛选 400。
- 新增 `platform/modules/m09/repository/center_snapshot_repository_test.go`：中心历史裁剪保留最新 5 份 + 当前版本。
- 更新 `platform/modules/m08/service/config_test.go`、`platform/modules/m09/service/config_sync_service_test.go`：删除 sink 相关用例。

验证命令：

```bash
GOCACHE=$PWD/.cache/go-build GOFLAGS=-mod=mod .tools/go/bin/go test ./platform/...
GOCACHE=$PWD/.cache/go-build GOFLAGS=-mod=mod .tools/go/bin/go vet ./platform/modules/m08/... ./platform/modules/m09/...
```

结果：全量 `go test ./platform/...` 通过；vet 通过。

### 前端

- 更新 `ConfigPreviewPage.test.tsx`：类型筛选、平台产物展示、恢复包导出、详情文件 Tab、导出/401/403、非 admin 隐藏。
- 更新 `alertmanagerSmoke.test.tsx`：告警配置类型、详情预览、导出 alertmanager.yml。
- 更新 `AlertConfigPage.test.tsx`：版本详情下载。

验证命令：

```bash
cd ui-custom/web
pnpm vitest run src/pages/config-center/preview/ConfigPreviewPage.test.tsx \
  src/pages/config-center/preview/alertmanagerSmoke.test.tsx \
  src/pages/alerts/AlertConfigPage.test.tsx
pnpm run typecheck:test
```

结果：配置产物历史页 26 条 + 告警配置冒烟 2 条 + M08 告警配置页 13 条 + 旧快照 API/hook 15 条全部通过；`typecheck:test` 与 `tsc --noEmit` 通过；变更文件 ESLint 通过。

## 5. 兼容性与偏离

- 旧 per-domain 端点 `/network-domains/:id/config-snapshots*` 保留，未删除；新页面使用统一端点。
- 历史遗留 `am-` 行不再新增；若存在旧数据，统一列表按 `domain` scope 展示（`content_available=false` 时提示内容不可用）。
- `snapshot_synced` 字段删除：前端无展示依赖，删除后行为不变。
- 未实现数据库 migration：本次改动不涉及 schema（复用 0016 `config_snapshots`，center 内容落文件）。
- 未提交 commit：当前工作区含其他并行改动，待评审后按 `docs:` / `feat:` / `test:` 拆分提交。

## 6. 遗留风险

1. 中心历史已按 5 份裁剪；裁剪为 best-effort，失败只记日志，不影响已发布版本。
2. 恢复包依赖 center payload 已落盘；升级前已存在的 center 行没有内容文件，导出会返回 404。
3. M08 旧数据（`am-` 行）内容文件与 DB 记录仍在，未做数据迁移清洗；不影响新数据。
4. 前端统一历史一次拉取 `limit=200`，超大历史量场景需后续服务端分页。
