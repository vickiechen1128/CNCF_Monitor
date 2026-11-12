# MetricCenter v2.0 重写决策记录

> 本文件记录 rewrite 期的产品 / 架构 / 契约决策；不建 CR。
> 跨模块契约、数据迁移、安全敏感面变更必须在此登记，并同步对应 PRD / API 快照。

| # | 日期 | 决策 | 结论 | 影响 |
|---|---|---|---|---|
| D1 | 2026-11-10 | 分支模型 | 使用 `rewrite/v2.0`，旧版本归档不维护 | Gitflow / Agent Skill |
| D2 | 2026-11-10 | API 版本 | 新线统一 `/api/v3/platform/*`；旧 `/api/v2/*` 归档 | 前后端 / 契约快照 |
| D3 | 2026-11-10 | 计划重量 | 轻量 `plan.md` + 模块 `task-sequence.yaml`，不跑完整 L2 矩阵 | Planner / Orchestrator |
| D4 | 2026-11-10 | PRD 定位 | 新 PRD 为 living document；旧 PRD 仅参考 | PRD / 原型 |
| D5 | 2026-11-10 | schema | 允许直接演进；必须 migration + 回滚 + 数据对账 | 后端 / DB |
| D6 | 2026-11-10 | M07 数据模型 | `resources` 主表 + 六类扩展表；`resource_id` 全局主键；`dedup_key` 唯一；字典 FK；`cloud_code` 不落资源表 | 后端 / DB |
| D7 | 2026-11-10 | 旧数据 | **不迁移**；v3 从新 schema 开始；旧库仅备份/归档 | DB / 迁移 |
| D8 | 2026-11-10 | API v3 | 资源响应采用公共字段 + `attributes` 嵌套；分页默认 20、上限 100 | 前后端 / 契约 |
| D9 | 2026-11-10 | 安全 / 审计 | `connection_string` 改为 secret ref 或加密存储；纳入 `resource_audit_logs` | 后端 / 安全 |
| D10 | 2026-11-10 | v2 保留 | v2.0 发布后保留一个版本兼容窗口，再删除旧 v2 包 | Gitflow / 发布 |
| D11 | 2026-11-10 | 数据库目标 | **PostgreSQL 为 v3 生产目标；SQLite 仅开发/测试**；旧 v2 继续 SQLite | 后端 / 部署 / CI |
| D12 | 2026-11-11 | v3 schema 归属 | M00 拥有共享参考 / 身份表 baseline（`00000_m00_platform_core`，版本 0）；业务语义归 M06/M03；迁移文件按 dialect 后缀加载（`.sqlite.sql` / `.postgres.sql`）；不引入 goose 依赖，保留其标记 | 后端 / DB / 迁移 |
| D13 | 2026-11-11 | 启动模式 | 默认 `legacy`（旧 v2 功能面 + 增量 v3 迁移）；`METRIC_CENTER_DB_MODE=v3` 或 `--database.mode=v3` 启用 v3-only（`InitV3` + `CoreV3` seed + 模块注册表，不挂 `/api/v2`、不启动旧后台任务） | 后端 / 部署 / 运维 |
| D14 | 2026-11-11 | 过渡期认证 | v3-only 模式复用 legacy auth handler 适配为 `auth` 模块，登录 `POST /api/v3/platform/auth/login`；M03 v3 模块落地后替换，路径不变 | 后端 / 安全 |
| D15 | 2026-11-11 | M06 模块归属 | 新建 `platform/modules/m06/`（tenant/user/network-domain/storage/log/auth 能力）；legacy `platform/admin/*` 冻结保留，只服务 v2 兼容窗口 | 后端 / 架构 |
| D16 | 2026-11-11 | 网域 schema 演进 | 新增 `00004`；`management` 由服务层 + SQLite 触发器 / PostgreSQL CHECK 双重拒绝；历史行转 `edge` + `agent_pull` 并保留 ID；不再 seed `default` | DB / M06 / M07 |
| D17 | 2026-11-11 | 租户-网域授权 | `network_domains.authorized_tenant_ids` 为唯一权威；`tenants.network_domain_ids` 为派生缓存，`seed.CoreV3` 启动对账（含登记 owner） | DB / M06 |
| D18 | 2026-11-11 | M07 消费口径 | 网域可用 = 存在 + `status=enabled` + `domain_type IN (edge,collection)`；Excel 导入不再回落 `default`，空网域为行级错误 | M07 / M06 |
| D19 | 2026-11-11 | M09/M11 边界 | 网域删除级联通过 `MonitoringRetirer` 端口；M09 v3 未落地时 no-op + `monitoring_available=false` | M06 / M09 / M11 |
| D20 | 2026-11-11 | M06 v3 契约 | 分页 `{list,total,page,page_size}`；不可变字段（`cloud_code`/`tenant_id`/`domain_type`/`id`/`username`）出现变更即 400；删除被引用网域 409 | 前后端 / 契约 |
| D21 | 2026-11-11 | 管理员安全 | 禁用/删除最后一个 active admin、把最后一个 active admin 降级为 user → 409；admin 删除（非最后）→ 400；用户禁用/删除/改密后事务内清会话 | 后端 / 安全 |
| D22 | 2026-11-11 | 网域创建类型 | M06 v3 只创建 `edge` + `agent_pull`；`collection` 仅保留读兼容（供未来导入/迁移），创建请求显式传非 `edge` → 400 | M06 / 契约 |
| D23 | 2026-11-11 | M09 v3 模块归属 | 新建 `platform/modules/m09/`（合并原 M09 配置面 / M11 接入面 / M02 查询面）；legacy `platform/{edge,query,configcenter,domainregistry}` 与 `admin/networkdomain` 纳管部分冻结，只服务 v2 兼容窗口 | 后端 / 架构 |
| D24 | 2026-11-11 | 纳管字段归属 | 新增 `network_domain_access` 1:1 表（FK `network_domains(id)` ON DELETE CASCADE）承载 M09 纳管/运行态字段；v3 不写 `network_domains` 的 legacy 纳管列（channel/token/agent_type/...） | DB / M09 / M06 |
| D25 | 2026-11-11 | 配置同步去确认化 | 删除 `ConfigDraft` 确认/废弃、`Deployment` 重试/回滚；改为「源变更→生成→校验→原子切换当前快照→保留最近 3~5 份只读历史」，不支持回滚；校验失败不覆盖当前版本 | 后端 / M09 / 契约 |
| D26 | 2026-11-11 | 通道与网域类型 | v3 只产生 `agent_pull`；不出现 `management`/`local`/`default`；中心节点所在网域也必须部署采集节点（NFR-01/02） | DB / M09 / 契约 |
| D27 | 2026-11-11 | 边缘协议 | 前缀 `/api/v3/edge/*`；仅 Token（sha256）鉴权，不挂用户 AuthMiddleware；协议版本 v1，DTO 与 `edge-sync-agent/internal/contract` 共享；旧 `/api/v2/platform/edge/*` 不兼容 | 后端 / Agent / 契约 |
| D28 | 2026-11-11 | 查询与目标隔离（单维度） | 查询 / targets / coverage 隔离**只注入 `network_domain` 一个标签匹配器**：服务端按当前租户解析被授权网域集（D17：`d.tenant_id==T` 或 `T∈d.authorized_tenant_ids`），注入 `network_domain=~"<authorized>"`；**不注入 `tenant` 标签**——写入侧 `external_labels` 仅含 `network_domain_id`（`configcenter/generator` 决策 19，明确不注入 tenant），数据面无 tenant 标签，注入 `tenant=...` 会对所有查询匹配空。任何用户（含 platform_admin）无 bypass；越权或未带网域标签的数据返回空（200），非 403。**与 SRS NFR-08 / §9 「tenant + network_domain 双重」措辞冲突，以本决策为准，由 owner 回填 PRD**（见审计记录）。 | 后端 / 安全 / 契约 |
| D29 | 2026-11-11 | Token 存储与展示 | 只存 `sha256(token)` + 脱敏值；明文仅在签发/重置响应返回一次；重置/废止立即覆盖旧 hash，旧 Token 心跳鉴权失败；任何接口/日志不返回明文 | 后端 / 安全 |
| D30 | 2026-11-11 | 心跳与快照清理 | 心跳历史保留 7 天（可配）自动清理；target 快照在资源删除 / Job 清空 / 退纳管 / 网域删除时同步清理，避免残留 | 后端 / M09 |
| D31 | 2026-11-11 | M08 边界 | `alertmanager.yml` 由 M08 生成，M09 仅快照留存与分发，不扇出到边缘域配置包；M08 通过 `AlertmanagerSnapshotSink` 端口写入 | M08 / M09 / 契约 |
| D32 | 2026-11-12 | m09/m06 网域读路由归属 | 冻结契约 §2.2 列 m09 `GET /network-domains`、`GET /network-domains/:id`，但 m06 v3 已在同一 group `/api/v3/platform` 注册同路径 → gin 重复路由 panic。B2 只注册 m09 不冲突的 platform 路由（edge-agents / edge-packages / monitor / token-reset / config-snapshots）；**B3 由 m06 让出这两条行政读**，改由 m09 提供「行政字段 + 运行态」enriched 视图（契约 §2.1），m06 保留行政写（POST/PUT/PATCH/DELETE），同步更新 m06 e2e 对这两条 GET 的断言 | 后端 / M09 / M06 / 契约 |
| D33 | 2026-11-12 | 查询隔离注入的标签名 | 契约/SRS 原写「注入 `network_domain` 匹配器」，但写入侧 `configcenter/generator.buildExternalLabels` 实际注入的 external label 是 **`network_domain_id`**（决策 19）。**owner 2026-11-12 授权统一用词**：注入匹配器改为 `network_domain_id=~"<授权域>"`，SRS（v1.2）/契约快照同步更正；API 入参/响应 meta 字段名仍为 `network_domain` / `network_domains`，语义等价 | 后端 / M09 / 契约 |
| D34 | 2026-11-12 | M09 网域列表双视角 | M09 `GET /network-domains` 默认保持纳管视角（`status=enabled` + `domain_type=edge`）；admin 显式传 `view=admin` 或 `status` 时切换为行政视角（`status` 可选过滤、`domain_type IN (edge, collection)`），响应补 `description` / `domain_type` / `domain_type_label` / `tenant_id` / `authorized_tenant_ids` / `status`。非 admin 请求行政视角 → 403；M06 已让出该读端点（D32），M06 管理页以该视图承载启用/停用全量列表 | 后端 / M09 / M06 / 契约 |
| D35 | 2026-11-12 | 告警/记录规则求值拓扑 | **规则统一在中心 Prometheus 求值**（基于 remote-write 回传数据），边缘配置包**不含 rules.yml**（vmagent 不求值规则，下发无求值者；且「网域离线抑制」类存活检测只能在中心侧做）。M09 配置同步服务在中心侧生成 rules 产物并本地 reload 中心 Prometheus（走 `--web.enable-lifecycle`，同 M08 内部 Reload 子模块对 AM 的模式）；中心 Prometheus `alerting` 指向中心 Alertmanager。边界澄清：NFR「中心不直接采集」仅禁止 scrape/probe，规则求值属存储面职责，不违反 D26。owner 2026-11-12 确认 | M01 / M09 / M08 / 契约 |
| D36 | 2026-11-12 | MonitoringRule 网域归属 | **规则为平台级全局对象，不绑 `network_domain_id`**（D35 中心求值后域绑定失去意义）；`job` 引用校验基准 = 全平台 `ready+enabled` Job 并集（允许跨域引用），存活类（`up`/`absent(up)`）不匹配 error 阻断、其余 warning，保留逃生门。取代 M01 SRS FR-15「仅本网域」口径。租户级规则归属推迟至多租户版本再议。owner 2026-11-12 确认 | M01 / M09 / 契约 |
| D37 | 2026-11-12 | 云字典维护入口 | 云字典从「MVP 只读」升级为 **admin 只增维护**：M06 系统管理提供维护入口，仅支持**新增**与**停用**，禁止修改/删除历史条目（已被网域引用的编码必须稳定）；新增时服务端校验复合码格式 `{类型}-{载体}` 与全局唯一性；普通用户只读。解决「`cloud_code` 必填但字典只读」的鸡生蛋问题，避免新云上线需改库。owner 2026-11-12 确认 | M06 / 后端 |
| D38 | 2026-11-12 | API 版本口径统一 v3 | 新线统一 `/api/v3/platform/*`（用户认证）+ `/api/v3/edge/*`（边缘 Token，D2 重申）；SRS 正文中的 `/api/v1/query*`、`/api/v1/targets`、`/api/v1/webhooks/*` 等视为**原生语义子路径**，B 阶段实施时统一挂载 v3 前缀，权威路径以 api-contract-snapshot-v3 为准；SRS 不逐一改写，仅在端点枚举处加注。owner 2026-11-12 确认 | 契约 / 全部模块 |
| D39 | 2026-11-12 | 接入 Token 仅存哈希 | 网域接入 Token 数据库**仅存哈希**（SHA-256），明文仅在纳管成功/重置时完整展示一次，任何接口/日志不返回明文；校验按哈希比对。收紧 M09 NFR-07 原「可存哈希或明文」措辞。owner 2026-11-12 确认 | M09 / 安全 |
| D40 | 2026-11-12 | 资源删除回收机制 | M07 删除资源后，由 **M01 内置对账循环（pull，默认 60s 可配置）**发现已选中实例失效并自动从各 Job `selected_instance_ids` 回收；M07 不反向依赖 M01（无跨模块同步调用、不引入外键/触发器）；Job 保存与 targets 生成时保留实例存在性强校验兜底。与 M09 配置同步的 pull 偏好一致，保持单向依赖。owner 2026-11-12 确认 | M01 / M07 / 后端 |

---

## 待决

- [ ] 各模块 API v3 路径与旧 v2 的映射表（B0-2）。
- [ ] 模块重写顺序与里程碑确认。
- [x] M09 边缘协议前缀 `/api/v3/edge/*`（D27）—— owner 2026-11-11 确认采用，旧 agent 同步升级。
- [x] 查询隔离维度（D28）—— owner 2026-11-11 确认采用 A 方案：只注入 `network_domain`，不注入 `tenant`（详见 D28 与审计记录）。
- [x] 退纳管（DELETE /network-domains/:id/monitor）—— owner 2026-11-11 确认 MVP 实现幂等废止，与 M06 级联清退复用同一 service 路径。
- [x] m09/m06 网域读路由归属（D32）—— owner 2026-11-11 确认（「按这个方案执行」）；**B3 已落地**：m06 让出 `GET /network-domains` 与 `GET /network-domains/:id`，改由 m09 enriched 视图承载，m06 保留 impact 与行政写，m06 测试同步调整。
- [x] 查询隔离注入标签名（D33）—— owner 2026-11-12 授权统一用词：SRS 升至 v1.2、契约快照 §7.3/§9/§10 已改为 `network_domain_id`；实现与文档一致（API 字段名仍为 `network_domain`）。
- [x] M09 网域列表双视角（D34）—— P0 实施中确认：默认纳管视角不变，admin 通过 `view=admin` / `status` 查看全量行政视角，M06 管理页消费该视图。
- [x] 告警求值拓扑（D35）—— owner 2026-11-12 确认：规则统一在中心 Prometheus 求值，边缘配置包不含 rules.yml。
- [x] MonitoringRule 网域归属（D36）—— owner 2026-11-12 确认：规则平台级全局，job 引用校验按全平台生效 Job 并集，待回填 M01 SRS FR-15 / M09 SRS FR-10。
- [x] 云字典维护入口（D37）—— owner 2026-11-12 确认：admin 只增维护（新增/停用，禁止改删），已回填 M06 SRS v1.2。
- [x] API 版本口径统一 v3（D38）—— owner 2026-11-12 确认：SRS 路径视为原生语义子路径，实施期统一挂 `/api/v3/*` 前缀，已在 M09 FR-18 / M08 FR-12 加注。
- [x] 接入 Token 仅存哈希（D39）—— owner 2026-11-12 确认，已回填 M09 SRS v1.4 NFR-07。
- [x] 资源删除回收机制（D40）—— owner 2026-11-12 确认：M01 周期对账 pull 模式，已回填 M01 SRS v1.2 §8.5。

## 审计记录

- **2026-11-11 D28 与 SRS 冲突对齐（已回填）**：M09 SRS v1.0 NFR-08（L346）与 §9（L430）原写「`tenant` + `network_domain` 双重隔离 / 在 PromQL 注入两个标签约束」。经核查写入侧事实：`platform/configcenter/generator` 的 `external_labels` 仅注入 `network_domain_id`（决策 19，注释明确「不注入 tenant_id」），数据面无 `tenant` 标签，注入 `tenant=...` 会导致所有查询匹配空。owner 确认采用 D28 单维度口径（服务端按租户解析授权网域集 + 查询注入 `network_domain`），并授权直接回填 PRD。**已回填**：M09 SRS 升至 v1.1（FR-20 / NFR-08 / §8.5 / 验收清单），见 SRS §11 变更记录。
- **2026-11-12 D32 路由冲突发现（B2 实施中）**：B2 接入 m09 骨架时发现冻结契约 `api-contract-snapshot-v3.md` §2.2 列 m09 `GET /network-domains` 与 `GET /network-domains/:id`，但 m06 v3 已在同一 group `/api/v3/platform` 注册同路径（`m06/handler/routes.go`），gin 对重复路由会 panic，B0 未识别。B2 回避：只注册 m09 不冲突的 platform 路由，冲突的两条读端点推迟到 B3。推荐方案（D32）：B3 由 m06 让出这两条行政读，m09 提供 enriched 视图（行政字段 + 运行态），m06 保留行政写。待 owner 确认；确认前 B2 不改动 m06 以避免破坏其现有绿测。
- **2026-11-12 D33 标签名对齐（B6 实施中）**：核查 `configcenter/generator/buildExternalLabels` 实际 external label 为 `network_domain_id`（非契约用词 `network_domain`）。为避免「注入即匹配空」的 D28 同类事故，B6 查询代理按 `network_domain_id` 注入；对外字段（targets.network_domain、meta.network_domains、筛选参数 network_domain）保持契约命名。待 owner 确认是否将 SRS/契约用词统一为 `network_domain_id`。
- **2026-11-12 D35/D36 决策与 SRS 全量回填（owner 授权）**：SRS 评审发现两处架构级缺口——①告警求值拓扑未定义（边缘 vmagent 不求值规则，M08 FR-19「网域离线抑制」只能中心侧检测）；②MonitoringRule 网域归属未建模。owner 确认 D35（规则统一在中心 Prometheus 集中求值，边缘配置包不含规则文件，M09 中心侧生成 rules 产物并 reload）与 D36（规则平台级全局、job 引用校验按全平台生效 Job 并集）。**已回填 6 份 SRS**：M01 v1.1（FR-15/NFR-07/§8.2/依赖表/风险表）、M09 v1.3（§3.4/FR-10/FR-14/FR-15/验收清单，含 v1.1 漏改的「注入租户/网域标签」残留）、M06 v1.1（NFR-03 双重注入旧口径修正为 D28/D33 单标签、清理 M02/M11 残留引用）、M08 v1.1（matcher 标签名 `network_domain`→`network_domain_id`、M02 依赖并入 M09、依赖表「边缘分发」措辞按 D31 收敛）、M05 v1.1（配置预览/下发页→配置与同步状态页、六步引导补纳管装节点、移除 pending_draft_count、M02 依赖并入 M09）、M07 v1.1（采集状态 badge 数据源改指 M09）。
