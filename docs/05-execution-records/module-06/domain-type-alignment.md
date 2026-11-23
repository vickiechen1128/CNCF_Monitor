# M06 网域类型口径收敛执行记录（移除 management / default / local）

- **执行角色**：backend-developer + frontend-developer（同一收敛任务）
- **分支**：`rewrite/v2.0`
- **关联问题**：M06 SRS v1.3 起主张取消中心直连域（`management` / 预置 `default` / `local` 通道），实现仍保留模型常量与派生逻辑，差异登记在 SRS §3.3、HLD §3 与 Scenario Link 未决问题 #1
- **变更范围**：`platform/models/`、`platform/modules/m06/domain/`、`platform/db/seed/`、`platform/foundation/apiresponse/`、`platform/modules/m09/configcenter/generator/`（注释）、`ui-custom/web/src/pages/`、M06 SRS / HLD / Scenario Link
- **状态**：已完成（含防回退测试）

---

## 1. 背景与结论

需求方向已明确：v3 只有采集节点域（`edge`），所有网域都必须通过采集节点纳管，不存在中心直连的管理域、预置 `default` 域或 `local` 下发通道。

本次按 **SRS 方向收敛实现**，不反向修改需求：

- 不新增 migration：历史数据归一由 `00004` 承担，`domain_type` CHECK 收紧由 `0013` 承担，运行态字段移除由 `0014` 承担。
- 不重写历史执行记录；M09 历史文档中的管理域描述保留原貌，仅同步当前代码注释与设计文档口径。
- 前端仅修正与需求冲突且事实错误的引导文案（导入并不存在「留空归入中心直连域」的兜底）。

---

## 2. 变更清单

### 2.1 后端模型与领域常量

`platform/models/network_domain.go`

- `DomainType` 仅保留 `DomainTypeEdge`；删除 `DomainTypeManagement`。
- `ChannelType` 仅保留 `ChannelTypeAgentPull`；删除 `ChannelTypeLocal`。
- 删除 `DefaultDomainID`、`ChannelForDomainType`、`IsManagement`。
- 删除已由 migration 0014 从 `network_domains` 表移除的运行态字段：`Channel`、`Token`、`TokenMaskedView`、`AgentType`、`CenterEndpoint`、`RemoteWriteURL`、`MaxDiskUsagePerURL`、`MonitoredStatus`、`LastHeartbeat`、`AgentVersion`、`IsMonitored`、`RegistrationStatus`。
- 删除依赖 `Token` 的 `AfterFind`；这些运行态字段归属 M09 `network_domain_access`。
- 该清理同时修复了潜在问题：migration 0014 之后模型仍带旧字段，GORM 写入会引用已删除列。

`platform/modules/m06/domain/ids.go`

- `DefaultDomainID` 重命名为 `LegacyDefaultDomainID`，语义改为「仅为承接历史迁移行而保留，不再创建/预置」。
- 新建网域的 `domain_code` 仍拒绝该保留值，避免与历史行冲突。

`platform/db/seed/ten_domain.go`

- 注释改为「不再预置或支持中心直连域；所有网域按 `edge` 登记」，不再描述「按需登记 default 管理域」。

### 2.2 跨模块注释口径

以下文件仅注释调整，无行为变化：

- `platform/foundation/apiresponse/response.go`：409 冲突说明去掉「管理域」措辞。
- `platform/models/config.go`、`config_center_rules.go`、`alertmanager_config.go`：`alertmanager.yml` 归属改为平台级 `scope=alertmanager`，不再描述为「管理域 default scope」。
- `platform/modules/m09/configcenter/generator/{generator.go,render.go,validate.go}`：同步为平台级 `scope=alertmanager`。

### 2.3 数据库迁移（复用现有版本，无新增）

| 迁移 | 作用 |
|------|------|
| `00004_m06_domain_administration.postgres.sql` | 历史 `management` → `edge`、`local` → `agent_pull`，清理 token / 纳管态，保留资源引用与历史行 |
| `0013_m06_domain_type_alignment.postgres.sql` | `domain_type` CHECK 收紧为仅 `edge`，拒绝写入 `management` |
| `0014_m06_drop_legacy_domain_columns.postgres.sql` | 从 `network_domains` 移除 M09 运行态列，迁移到 `network_domain_access` |

`platform/db/migrate_test.go` 已覆盖数据归一、CHECK 拒绝与列移除，不需要新增迁移测试。

### 2.4 前端文案与测试

`ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx`

- 导入说明由「网域强烈建议填写 / 留空自动归入中心直连域」改为「网域必填 / 导入同样不能留空」。
- 引导改为「须先登记并纳管网域；未登记、未启用或未纳管会导致整行导入失败」。

`ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`

- 两处空态文案由「登记中心直连域或采集节点域」改为「登记并纳管网域」。

对应测试同步更新，并新增「页面不再出现『中心直连域』」断言。

### 2.5 文档

- `Module_06_Multi_Tenant_Requirements.md`：v1.5；§3.3 实现现状改为已收敛；风险表改为防回退护栏；变更日志记录本次收敛。
- `Module_06_System_and_Platform_Management_High_Level_Design.md`：v1.1；决策表、数据归属、编码规则、登记流程与变更日志同步。
- `Module_06_Scenario_Link.md`：NFR-01~02 标记已收敛；未决问题 #1 关闭并记录收敛范围。

---

## 3. 验证记录

| 验证项 | 命令 | 结果 |
|--------|------|------|
| 后端全量测试 | `METRIC_CENTER_TEST_POSTGRES_DSN=... go test ./platform/... -count=1` | 全部通过 |
| 后端静态检查 | `go vet ./platform/...` | 无输出（通过） |
| 后端启动冒烟 | 空库应用全部 migration 后启动 `metric-center`，`GET /api/v3/platform/health`、`GET /api/v3/platform/ready` | 均返回 200 |
| 前端目标测试 | `vitest run src/pages/resources/TemplateDownloadModal.test.tsx src/pages/strategy/ScrapeJobFormDrawer.test.tsx` | 2 文件 / 35 测试通过 |
| 前端测试类型门禁 | `pnpm run typecheck:test` | 通过 |
| 前端 lint | `pnpm lint` | 通过（`--max-warnings 0`） |
| 前端 dev server | `pnpm dev --host 127.0.0.1`，`GET /` | 200 |
| 符号地图 | `make repo-map` | 已重新生成；确认无 `ChannelForDomainType` / `TestChannelForDomainType` / `DefaultDomainID` 等已删除符号 |

前端目标测试仅有既有 React `act(...)` 警告，无失败。

---

## 4. 防回退护栏

1. `platform/models/models_test.go::TestNetworkDomainModelMatchesV3Schema`
   - 通过 `testdb.Open` 使用真实 migration 后的 schema；
   - 若模型重新引入 `channel` 等已删列，GORM 写入会直接报列不存在，测试失败。
2. `platform/db/migrate_test.go`
   - 锁定历史 `management` / `local` 数据归一结果；
   - 锁定 `management` 插入被 CHECK 拒绝；
   - 锁定历史资源引用不丢失。
3. M06 登记接口测试
   - 非 `edge` 创建请求（含 `collection` / `management`）被拒绝，服务层固定写入 `edge`。
4. 前端测试
   - 导入说明与采集 Job 空态均断言不再出现「中心直连域」。
5. SRS 风险表
   - 原「实现仍保留 default 管理域 / local 通道」风险项改为「后续回退引入 management/default/local」的护栏说明。

---

## 5. 边界与遗留说明

- `platform/modules/m06/domain/network_domain.go` 仍保留 `DomainTypeCollection` 作为**读兼容**：历史客户端可能提交 `collection`，解析层可识别后由服务层明确拒绝；创建路径只写 `edge`。本次不删除该读兼容常量。
- `models.ChannelType` 保留用于历史 `ConfigDeployment.Channel` 字段，当前仅剩 `agent_pull`。
- 历史执行记录（如 `2026-08-18-tenant-and-network-domain-alignment.md`）仍可能描述管理域/边缘域旧口径，属于历史留痕，不随本次回写。
- `docs/04-source-architecture/repo-map.md` 本次重新生成时基线较旧（上次生成于 `5aef68a`），因此 diff 较大；该文件为自动生成产物，不作为提交门禁。

---

## 6. 提交记录

| Commit | 内容 |
|--------|------|
| `13dd69e` | `refactor(m06): 清理网域类型 management/default/local 残留，统一 v3 口径`（模型、领域常量、seed 与注释、回归测试） |
| `997e638` | `refactor(web): 收敛网域引导文案，移除中心直连域表述`（导入说明、采集 Job 空态与测试） |
| `8e81fa8` | `docs(repo-map): 重新生成业务代码符号地图`（自动生成产物） |
| 本次 docs 提交 | SRS v1.5 / HLD v1.1 / Scenario Link 未决问题 #1 关闭 + 本执行记录 |

---

## 7. 关联文件

- `platform/models/network_domain.go`
- `platform/models/models_test.go`
- `platform/models/config.go`
- `platform/models/config_center_rules.go`
- `platform/models/alertmanager_config.go`
- `platform/modules/m06/domain/ids.go`
- `platform/db/seed/ten_domain.go`
- `platform/db/migrations/v3/00004_m06_domain_administration.postgres.sql`
- `platform/db/migrations/v3/0013_m06_domain_type_alignment.postgres.sql`
- `platform/db/migrations/v3/0014_m06_drop_legacy_domain_columns.postgres.sql`
- `platform/db/migrate_test.go`
- `platform/foundation/apiresponse/response.go`
- `platform/modules/m09/configcenter/generator/{generator.go,render.go,validate.go}`
- `ui-custom/web/src/pages/resources/TemplateDownloadModal.{tsx,test.tsx}`
- `ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.{tsx,test.tsx}`
- `docs/02-product-requirements/Modules/SRS/Module_06_Multi_Tenant_Requirements.md`
- `docs/07-design/Module_06_System_and_Platform_Management_High_Level_Design.md`
- `docs/07-design/Module_06_Scenario_Link.md`
