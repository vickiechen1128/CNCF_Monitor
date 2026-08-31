# MetricCenter 代码实施计划

> 文档类型：工程实施计划  
> 依赖文档：[00_Global_Architecture.md](00_Global_Architecture.md)、[02_Product_Roadmap.md](02_Product_Roadmap.md)、[04_Implementation_Map.md](04_Implementation_Map.md)、[00_Product_Vision.md](00_Product_Vision.md)  
>
> **各模块 PRD 版本**：Module_01 v3.26 · Module_06 v2.3 · Module_07 v2.21 · Module_09 v1.50 · Module_03 v1.2（Track B+ 增量，决策 44）
>
> Plan 版本：v2026-08-21  
> 更新日期：2026-08-21

---

## 1. 计划目标

在文档架构已对齐的前提下，给出从当前状态到 MVP 可运行、并持续演进到 v1.0 企业级可用的开发路径，明确：

1. 每个阶段要交付的模块与功能
2. 模块间的依赖关系与开发顺序
3. 前后端分工、入口目录、关键接口
4. 每个阶段的验收标准
5. 需要规避的风险与阻塞点

> **当前已具备的基础**：`platform/cmd/metric-center/main.go`、前端 `ui-custom/web/`、Go 模块、`Makefile`、前后端连通性验证通过。

---

## 2. 总体开发策略

### 2.1 核心原则

| 原则 | 说明 |
|------|------|
| **后端先行，前端跟上** | 先有稳定的 API 契约，再写前端页面 |
| **数据流驱动** | 按「网域登记 → 对象 → 标签 → 策略 → 配置生成 → 下发 → 验收」主线推进 |
| **控制面与源码隔离** | 业务代码只写在 `platform/` 和 `ui-custom/`，上游源码尽量不碰 |
| **先 L1/L2，后 L3/L4** | 优先做 Prometheus 已支持、只需代理或生成配置的能力 |
| **每阶段可运行** | 每个 Phase 结束都应有一个可演示的闭环，不堆积半成品 |
| **按里程碑交付** | MVP 优先跑通单机闭环；v0.2 ~ v1.0 再逐步叠加多网域、异构接入与企业级能力 |

### 2.2 模块优先级总览

```
feat/module-00-infrastructure          Phase 0: 基础设施与种子数据
        │
        ▼
feat/module-06-domain-registry         Phase 1: 网域登记管理（M06 MVP 子集）
        │
        ▼
feat/module-07-resource-management     Phase 2: 监控对象管理（五类资源）
        │
        ▼
feat/module-01-strategy                Phase 3: 监控策略与指标管理（规则文件挂载）
        │
        ▼
feat/module-09-config-center           Phase 4: 网域与边缘配置中心（default/local 闭环）
        │
        ▼
跨模块联调验收                          Phase 5: 无独立 portal 分支，用现有页面串链
        │
        ▼
v0.2 阶段
├──► feat/module-02-query-center        Phase 6.1: 查询中心（多租户/网域注入）
├──► feat/module-06-tenant-management   Phase 6.2: 租户-网域关联
├──► feat/module-09-edge-cloud          Phase 6.3: Edge Agent / agent_pull 全量
└──► feat/module-10-source-registry     Phase 6.4: 监控源登记册 + Ingestion Gateway
        │
        ▼
v0.3 阶段
├──► feat/module-05-portal              Phase 7.1: 门户化首页 / Dashboard / 导航
├──► feat/module-08-alerting-lifecycle  Phase 7.2: 告警状态 / Alertmanager 配置 / 静默
└──► feat/module-02-query-center-v03    Phase 7.3: 查询页图表 / PromQL 校验
        │
        ▼
v0.4 阶段
├──► feat/module-04-cmdb-discovery      Phase 8.1: 外部 CMDB 生命周期管理
└──► feat/module-10-heterogeneous       Phase 8.2: Zabbix / 云监控异构接入
        │
        ▼
v1.0 阶段
├──► feat/module-06-enterprise          Phase 9.1: 多租户权限 / 审计 / 平台配置
├──► feat/module-08-alerting-enterprise Phase 9.2: 完整告警规则 UI / 通知渠道
├──► feat/module-09-edge-autonomy       Phase 9.3: 边缘自治告警 / mTLS 自动轮转
└──► feat/module-06-storage             Phase 9.4: 元数据迁移 / 长期存储
```

| 模块分支 | 对应 Phase | 功能 | 前置依赖 |
|----------|-----------|------|----------|
| `feat/module-00-infrastructure` | Phase 0 | 基础设施、共享模型、种子数据 | - |
| `feat/module-06-domain-registry` | Phase 1 | 网域登记：租户/网域种子、`zone-types`、网域 CRUD、冻结语义 | Phase 0 |
| `feat/module-07-resource-management` | Phase 2 | 五类资源 CRUD + Excel 导入 + LabelTemplate + ResourceLabel + `biz_code` | Phase 1 |
| `feat/module-01-strategy` | Phase 3 | CI↔Exporter 绑定、ScrapeJob、认证/TLS、Blackbox、规则文件挂载 | Phase 2 |
| `feat/module-09-config-center` | Phase 4 | 配置生成、预览/Diff、确认、local reload、`change_status` 回写 | Phase 3 |
| `跨模块联调验收` | Phase 5 | 端到端验证、文档补齐、无独立 portal 分支 | Phase 4 |
| `feat/module-02-query-center` | Phase 6.1 | 多租户/网域 PromQL 注入、目标状态、响应 envelope | Phase 5 |
| `feat/module-06-tenant-management` | Phase 6.2 | 租户数据模型、租户-网域关联、multi_site_enabled | Phase 4 |
| `feat/module-09-edge-cloud` | Phase 6.3 | Edge Sync Agent、配置包拉取、心跳、Agent 状态列表 | Phase 6.2 |
| `feat/module-10-source-registry` | Phase 6.4 | 监控源登记册、Remote Write 接入、Ingestion Gateway | Phase 4 |
| `feat/module-05-portal` | Phase 7.1 | Custom UI 门户、首页 Dashboard、统一导航 | Phase 5 / 6 |
| `feat/module-08-alerting-lifecycle` | Phase 7.2 | Alertmanager 配置、静默、告警状态查看 | Phase 7.1 |
| `feat/module-04-cmdb-discovery` | Phase 8.1 | BlueKing/HTTP/Nacos Provider、CI 映射、待分类队列 | Phase 6.2 |
| `feat/module-10-heterogeneous` | Phase 8.2 | Zabbix / 云监控 Adapter、标签归一化 | Phase 8.1 |
| `feat/module-06-enterprise` | Phase 9.1 | 用户/角色/权限、审计、平台配置 | Phase 6.2 |
| `feat/module-08-alerting-enterprise` | Phase 9.2 | 完整告警规则 UI、通知渠道、Alertmanager 配置 | Phase 7.2 |
| `feat/module-09-edge-autonomy` | Phase 9.3 | 边缘自治告警、证书自动轮转、Token 轮换 | Phase 6.3 |
| `feat/module-06-storage` | Phase 9.4 | PostgreSQL/MySQL 迁移、长期存储 | Phase 6.4 / 9.1 |

### 2.3 多 Agent 协作开发模式

本项目使用 `.kimi/agents/` 定义的 Agent 团队进行开发。当前统一走 **Trae IDE 对话面板**（未购买 Kimi CLI Agent 时，直接引用对应 `.md` 作为上下文）。

#### Agent 角色与职责

| Agent | 职责 | 写权限 | 在计划中的使用时机 |
|-------|------|--------|-------------------|
| `planner` | 输出实现计划、识别风险、拆分子任务 | ❌ 只读 | 每个 Phase 开始前 |
| `backend-developer` | Go 后端 TDD 开发 | ✅ | 后端 API、模型、配置生成等 |
| `frontend-developer` | React + TypeScript 前端开发 | ✅ | 页面组件、API 调用、布局 |
| `prometheus-developer` | Prometheus 扩展 / Patch | ✅ | 涉及 Prometheus 源码修改或扩展点时使用 |
| `build-resolver` | 修复构建/测试/lint 错误 | ✅ | 构建或测试失败时 |
| `golang-reviewer` | Go 代码审查 | ❌ 只读 | Backend Developer 完成后 |
| `frontend-reviewer` | 前端代码审查 | ❌ 只读 | Frontend Developer 完成后 |
| `security-reviewer` | 安全审查 | ❌ 只读 | Phase 4（配置下发）、Phase 6（Token/证书）、Phase 9（权限/审计）等关键节点 |

#### 标准工作流

```text
Orchestrator（你）
    │
    ├──► 调用 planner 输出模块任务规划
    │         │
    │         ▼
    │    明确当前模块分支：feat/module-XX-<功能名>
    │
    ├──► [开发空间] 从 develop 切出当前模块 feat 分支
    │         │
    │         ▼
    │    cncf-git-workflow 双文件夹模型，开发在 CNCF_Monitor-feature
    │
    ├──► 调用 backend-developer 在开发空间 TDD 开发
    │         │
    │         ▼
    │    完成后提交到 feat/module-XX-<功能名>
    │
    ├──► 调用 golang-reviewer 审查
    │         │
    │         ▼
    │    如 REQUEST_CHANGES，返回 backend-developer 修复
    │
    ├──► 调用 frontend-developer 开发前端页面（可并行）
    │         │
    │         ▼
    │    完成后提交到 feat/module-XX-<功能名>
    │
    ├──► 调用 frontend-reviewer 审查
    │
    ├──► 在开发空间验证运行状态
    │         │
    │         ▼
    │    后端：go test/vet + 启动服务验证接口
    │    前端：pnpm test/lint + 启动 dev server 验证页面
    │
    ├──► 将 feat/module-XX-<功能名> 以 --no-ff 合并到 develop
    │         │
    │         ▼
    │    由 Orchestrator 在开发空间执行合并
    │
    ├──► 在 develop 环境中再次验证运行状态
    │         │
    │         ▼
    │    如验证失败，回退或修复；如通过，继续下一模块
    │
    └──► 开发空间 CNCF_Monitor-feature 保留，切换到下一个模块 feat 分支继续复用
```

#### 双文件夹隔离与开发空间规范

本项目采用 **双文件夹隔离 + 按功能子模块拆分 feature 分支** 模式。

- **设计空间** `CNCF_Monitor-worktree`：固定分支 `design/module-mvp-demo`，写 PRD、改原型。
- **开发空间** `CNCF_Monitor-feature`：`develop` + `feat/module-XX-<功能名>`，做 Vibe Coding（与设计空间物理隔离），**默认串行**——一个时间只开一个 feat 分支，任务按 task-sequence 先后顺序执行，保持线性历史，便于功能级回退。
- **并行是按需手段，不是默认流程**：仅当两个以上零耦合任务确需同时开发时，额外 `git worktree add` 独立目录，合并后即删。

```bash
# 开发空间初始化（主仓库 CNCF_Monitor 的 worktree，共享 .git 对象；等价于独立克隆的物理隔离）
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git worktree add ../CNCF_Monitor-feature develop

# 开始某个模块时，从最新 develop 切出对应 feature 分支（串行：同一时间只开一个）
cd ../CNCF_Monitor-feature
git fetch origin && git checkout -b feat/module-XX-<功能名> origin/develop
```

##### Gitflow 分支约定

| 分支类型 | 命名示例 | 用途 | 来源 | 合并目标 |
|----------|----------|------|------|----------|
| `main` | `main` | 稳定/生产版本 | - | - |
| `develop` | `develop` | 集成/开发主线 | `main` | - |
| feature | `feat/module-00-infrastructure` | 基础设施 | `develop` | `develop` |
| feature | `feat/module-06-domain-registry` | 网域登记 | `develop` | `develop` |
| feature | `feat/module-07-resource-management` | 监控对象管理 | `develop` | `develop` |
| feature | `feat/module-01-strategy` | 监控策略与指标管理 | `develop` | `develop` |
| feature | `feat/module-09-config-center` | 网域与边缘配置中心 | `develop` | `develop` |
| feature | `feat/module-02-query-center` | 查询中心 | `develop` | `develop` |
| feature | `feat/module-08-alerting-lifecycle` | 告警收敛与通知管理 | `develop` | `develop` |
| feature | `feat/module-05-portal` | 前端门户 | `develop` | `develop` |
| `integration/*` | `integration/v0.1` | 版本末跨模块联调 / E2E 验收 | `develop` | `develop` |
| `release/*` | `release/v0.1.0` | 版本发布 | `develop` | `main` + `develop` |
| `hotfix/*` | `hotfix/v0.1.1` | 生产紧急修复 | `main` | `main` + `develop` |

- 每个功能子模块对应一个 feature 分支，分支内只包含该模块的改动
- 模块完成后，Orchestrator 将当前 feature 分支以 `--no-ff` 合并回 `develop`
- 严禁 feature 分支直接合入 `main`
- 开发空间 `CNCF_Monitor-feature` 固定复用、**串行**切换 feat 分支完成不同模块开发（一个时间只开一个 feat 分支）；并行仅为按需 `git worktree add` 手段
- 回退策略详见 [06_Gitflow_Branch_and_Rollback_Guide.md](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md)

Agent 进入开发空间后必须先执行启动协议：

- **backend-developer**: `make install-tools && make build-prometheus && go test ./platform/...`
- **frontend-developer**: `cd ui-custom/web && pnpm install && pnpm lint`
- **prometheus-developer**: 先用 `prometheus-architecture-explorer` skill 分析扩展点

#### Agent 间协作规则

| 场景 | 规则 |
|------|------|
| 前端依赖后端 API | Frontend Developer 使用 mock 数据并行开发，API 契约由 Planner 在规划中明确 |
| 后端需要前端配合 | Backend Developer 完成后向 Orchestrator 报告，Orchestrator 再通知 Frontend Developer |
| 涉及 Prometheus 源码 | 必须先让 `prometheus-developer` 评估是否可用扩展点；必须 patch 时生成规范 patch 文件 |
| 构建失败 | 优先调用 `build-resolver` 修复，不引入新功能 |
| 跨 Phase 依赖 | 每个 Phase 必须有明确的输入/输出契约，下一阶段 Agent 先阅读上一阶段交付文档 |

#### 每个 Agent 完成后的汇报模板

**Backend Developer / Frontend Developer / Prometheus Developer**:

```markdown
## 完成汇报

1. 修改的文件列表
2. 新增/修改的测试
3. 测试结果（go test / pnpm test / lint）
4. 是否需要其他 Agent 配合
5. 已知问题或风险
```

**Reviewer**:

```markdown
## 审查结果

### CRITICAL
### HIGH
### MEDIUM
### LOW
### APPROVE / REQUEST_CHANGES
```

---

## 3. 模块依赖关系图

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Phase 0 基础设施                          │
│  platform/models/ · platform/db/ · platform/api/response           │
│  种子数据：platform_admin 租户、default 网域、zone_type 字典、      │
│  默认 LabelTemplate、内置 ExporterTemplate、CITypeExporterMapping  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Phase 1 网域登记管理（Module_06）                │
│  zone-types 字典 · NetworkDomain 行政 CRUD · 冻结语义 · 种子 upsert │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Phase 2 监控对象管理（Module_07）                │
│  五类资源 CRUD · Excel 导入 · LabelTemplate · ResourceLabel      │
│  biz_code 业务字典 · 状态映射 · is_monitored 只读映射             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│       Phase 3 监控策略与指标管理（Module_01）                      │
│  CI↔Exporter 绑定 · ScrapeJob · 认证/TLS · Blackbox · 规则文件挂载 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│       Phase 4 网域与边缘配置中心（Module_09）                      │
│  网域监控纳管 · 配置生成 · 草稿预览/Diff · 人工确认 · local reload  │
│  external_labels 注入 · agent_pull UI 占位 · change_status 回写  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Phase 5 跨模块联调验收                           │
│  无独立 portal 分支；用现有页面串链；端到端验证；文档补齐           │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        Phase 6.1          Phase 6.2         Phase 6.3/6.4
        Module_02          Module_06         Module_09 / Module_10
        （注入/查询）        （租户-网域）       （Edge / 监控源）
              │               │               │
              └───────────────┴───────────────┘
                              │
                              ▼
                        v0.3 / v0.4 / v1.0
```

### 3.1 关键依赖说明

| 依赖方 | 被依赖方 | 说明 |
|--------|----------|------|
| Module_06 网域登记 | Phase 0 | 需要 Tenant / NetworkDomain 行政模型与种子数据 |
| Module_07 资源管理 | Module_06 | Resource 的 `network_domain_id` 必须引用 M06 已登记网域 |
| Module_01 监控策略 | Module_07 | `ScrapeJob` 需要读取 Resource、LabelTemplate、ResourceLabel |
| Module_01 监控策略 | Module_06 | ScrapeJob 需校验网域是否已纳管 / 是否冻结 |
| Module_09 配置中心 | Module_01 / Module_07 | 组装 `prometheus.yml` / `rules.yml` 需要 M01 与 M07 的数据 |
| Module_09 配置中心 | Module_06 | `NetworkDomain` 行政字段由 M06 维护，M09 只读引用 |
| Module_02 查询中心（v0.2） | Module_09 / Module_06 | 注入 `network_domain` / `tenant` 标签依赖 M09 external_labels 与 M06 租户-网域关联 |
| Module_08 告警收敛（v0.3） | Module_01 / Module_09 | 消费 M01 规则记录，M08 负责 Alertmanager 配置 |

---

## 4. 分阶段实施计划

### Phase 0：基础设施与共享数据模型（第 1 周）

**对应模块分支**：`feat/module-00-infrastructure`

**目标**：建立后端项目结构、数据库访问、统一 API 响应，并冻结 MVP 核心共享模型；同时完成 MVP 所需种子数据的 upsert 机制。

**Agent 分工**：
- `planner`：规划数据库选型、模型结构、API 响应格式、种子数据清单
- `backend-developer`：实现数据库、模型、统一响应、健康检查、种子数据
- `frontend-developer`：确认前端目录结构与 API client 雏形
- `golang-reviewer`：审查后端基础设施代码

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 数据库初始化 | `platform/db/db.go` | SQLite 连接、GORM 迁移框架 | 服务启动自动建表 |
| 统一模型层 | `platform/models/` | Tenant、NetworkDomain、Resource、ResourceLabel、LabelTemplate、CITypeExporterMapping、ExporterTemplate、ScrapeJob、MonitoringRule、ConfigDraft、ConfigVersion、ConfigDeployment、EdgeAgent、BusinessMetric（预留） | 模型与 Module_01/06/07/09 PRD 一致 |
| 统一 API 响应 | `platform/api/response/` | JSON 统一封装、errorType 枚举 | 所有 API 返回统一格式 |
| 健康检查增强 | `platform/cmd/metric-center/main.go` | 增加 `/api/v1/health/db` 检查 DB | 能检测 DB 连通性 |
| 种子数据 upsert | `platform/db/seed/` | `platform_admin` 租户、`default` 网域（management/local）、zone_type 字典、默认 LabelTemplate、内置 ExporterTemplate、默认 CITypeExporterMapping | 后端启动后幂等生成，重复启动不报错 |
| 前端项目结构调整 | `ui-custom/web/src/api/`、`ui-custom/web/src/types/` | 建立 API 客户端与类型定义目录 | 目录规范确定 |

**风险点**：
- 模型字段一旦确定，Excel 模板、标签模板、策略绑定表会强依赖，需在本阶段冻结最小字段集。
- 种子数据涉及 M06/M07/M01 三模块默认值，需在 Phase 0 明确清单，避免后续模块重复初始化。

---

### Phase 1：网域登记管理（第 1 周）

**对应模块分支**：`feat/module-06-domain-registry`

**目标**：实现 MVP 所需的网域行政登记能力：`zone-types` 只读字典、`NetworkDomain` 行政 CRUD、禁用=冻结、空网域删除、种子数据 upsert。

> 本阶段对应 [Module_06: 系统与平台管理（含多租户）](Modules/Module_06_Multi_Tenant.md) 的 MVP 子集。完整租户生命周期、RBAC、审计放到 v0.2 及以后。

**Agent 分工**：
- `planner`：明确 NetworkDomain 行政字段、zone_type 字典来源、冻结语义、空网域删除规则
- `backend-developer`：实现 zone-types 接口、NetworkDomain 行政 API、种子 upsert、冻结联动校验
- `frontend-developer`：实现网域管理页面、禁用二次确认弹窗（展示 M07 资源数 / M09 已纳管 EdgeAgent 数）
- `golang-reviewer`：审查行政字段校验与跨模块约束

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| zone_type 字典 | `platform/admin/networkdomain/zone_type.go` | 部署级字典（政务云：`internet`/`extranet`/`private-line`/`dmz`；公有云按 region） | `GET /api/v2/platform/zone-types` 返回启用中字典项 |
| NetworkDomain 行政 API | `platform/admin/networkdomain/` | CRUD；`id` 按 `<deploy_code>-<domain_code>` 生成；`tenant_id` 创建后不可变 | 可通过 HTTP 增删改查 |
| 禁用=冻结 | `platform/admin/networkdomain/status.go` | 禁用网域时返回影响范围（M07 资源数 / M09 已纳管 EdgeAgent 数）；管理域 `default` 禁止禁用 | M07/M01/M09 校验生效 |
| 空网域删除 | `platform/admin/networkdomain/delete.go` | 仅当无 M07 资源引用且无已纳管 EdgeAgent 时允许删除；软删除 | 非空网域删除被拒并引导禁用 |
| 授权租户 | `platform/admin/networkdomain/authorized.go` | `authorized_tenant_ids` 维护（MVP 缺省 = 登记归属租户） | 可维护授权列表 |
| 种子数据完善 | `platform/db/seed/` | `default` 网域 `domain_type=management`、`channel=local`、登记归属 `platform_admin` | 系统启动后存在 |
| 前端网域管理页 | `ui-custom/web/src/pages/admin/domains/` | 列表、登记表单、禁用确认弹窗、空态引导 | 可完成网域登记闭环 |

**接口预览**：

```http
GET    /api/v2/platform/zone-types
GET    /api/v2/platform/network-domains
POST   /api/v2/platform/network-domains
GET    /api/v2/platform/network-domains/:id
PUT    /api/v2/platform/network-domains/:id
PATCH  /api/v2/platform/network-domains/:id/status
DELETE /api/v2/platform/network-domains/:id
```

**依赖**：Phase 0

**风险点**：
- `network_domain_id` 全局唯一且含部署前缀，需在生成逻辑中处理 `default` 例外。
- 禁用网域的跨模块联动校验必须同步落地，否则 M07/M01/M09 会出现行为不一致。

---

### Phase 2：监控对象管理（第 1 ~ 2 周）

**对应模块分支**：`feat/module-07-resource-management`

**目标**：实现五类资源的最小化 CRUD、Excel 导入 upsert、`ResourceLabel` 基础 CRUD、状态映射、LabelTemplate 管理、`biz_code` 业务字典、`is_monitored` 只读映射。

> 本阶段对应 [Module_07: 监控对象管理](Modules/Module_07_Monitoring_Object_Management.md)。`ScrapeJob`、配置生成、配置下发已不在本模块范围内。

**Agent 分工**：
- `planner`：输出资源 API、Excel 模板、校验规则、`ResourceLabel` / `LabelTemplate` 数据契约
- `backend-developer`：实现资源 CRUD、Excel 导入、`ResourceLabel` API、LabelTemplate API、状态映射后端
- `frontend-developer`：实现资源管理页面、导入弹窗、资源详情 Label 编辑、标签模板页面
- `golang-reviewer`：审查后端 API、Excel 解析、Label 校验逻辑
- `frontend-reviewer`：审查前端资源页面与标签模板页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 资源 API | `platform/config/resource/` | Host / Database / Middleware / Application / GenericTarget 的 CRUD | 可通过 HTTP 增删改查五类资源 |
| Excel 导入 | `platform/config/resource/excel.go` | 固定列模板解析、校验、批量写入、upsert、错误行返回 | 导入 100 条数据，错误行返回准确 |
| Excel 模板下载 | `platform/config/resource/template.go` | 按资源类型生成 xlsx/CSV 模板 | 前端可下载模板 |
| 状态映射 | `platform/config/resource/status_mapping.go` | Excel/CMDB 状态 → `Resource.status` 默认 + 可配置规则 | 中文状态正确映射 |
| ResourceLabel API | `platform/config/resource/label.go` | Label CRUD；key 合规校验；来源 `system` / `user`；仅 application 可写 user 标签 | 可增删改查，冲突可检测 |
| 标签模板 API | `platform/config/label/` | 按资源类别管理字段 → Label 映射；字段来源 `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}` | 增删改查可用 |
| system label 生成器 | `platform/config/label/generator.go` | 根据模板为资源生成 `source=system` 的 `ResourceLabel` | 修改模板后 label 同步更新 |
| `is_monitored` 只读映射 | `platform/config/resource/monitored.go` | 字段由 Module_01 维护关联关系，M07 只读展示并支持筛选 | Resource 列表可筛选「未监控」 |
| `biz_code` 业务字典 | `platform/config/resource/business.go` | 部署级字典，资源新增/编辑时校验存在性；停用条目不可新选 | 导入/录入时未登记业务报错 |
| 前端资源管理页 | `ui-custom/web/src/pages/resources/` | 五类资源列表、导入弹窗、资源详情 Label 编辑与冲突提示、网域/业务筛选 | 可导入并展示资源 |
| 前端标签模板页 | `ui-custom/web/src/pages/label-templates/` | 标签模板 CRUD 页面 | 可完成标签模板 CRUD |

**接口预览**：

```http
GET    /api/v2/platform/resources?type=host
POST   /api/v2/platform/resources
PUT    /api/v2/platform/resources/:id
DELETE /api/v2/platform/resources/:id
POST   /api/v2/platform/resources/:type/import
GET    /api/v2/platform/resources/:type/template
GET    /api/v2/platform/resources/:id/labels
POST   /api/v2/platform/resources/:id/labels
PUT    /api/v2/platform/resources/:id/labels/:key
DELETE /api/v2/platform/resources/:id/labels/:key
GET    /api/v2/platform/resources?is_monitored=false
GET    /api/v2/platform/label-templates
POST   /api/v2/platform/label-templates
PUT    /api/v2/platform/label-templates/:id
DELETE /api/v2/platform/label-templates/:id
```

**依赖**：Phase 1

**风险点**：
- 五类资源字段差异化较大，需通过 embedding 或 discriminator 模式共享基座表。
- `system` label 保护不可被 `user` 覆盖，合并逻辑需充分单元测试。
- `is_monitored` 由 M01 维护，M07 只读映射，两模块需就更新时机达成一致。

---

### Phase 3：监控策略与指标管理（第 2 ~ 3 周）

**对应模块分支**：`feat/module-01-strategy`

**目标**：实现监控策略配置层，包括 CI 类型 ↔ 默认采集器绑定、`ExporterTemplate`、`ScrapeJob`、实例选择、Exporter 安装确认、Blackbox 拨测、规则文件挂载、静态指标库。

> **边界说明**：
> - `ScrapeJob` 由 Module_01 持有并编辑，不再由 Module_07 承载。
> - Blackbox 拨测配置作为监控策略的一部分，由 Module_01 编辑。
> - 规则编辑改为「规则文件挂载」：整文件 `rules.yml` 透传落库 `MonitoringRule`，字段化编辑 + PromQL 校验移出 MVP。
> - 配置生成 / 预览 / 下发由 Module_09 负责。

**Agent 分工**：
- `planner`：明确 CI↔Exporter 绑定、`ScrapeJob`、实例选择、规则挂载的数据契约与 API
- `backend-developer`：实现策略 API、目标筛选、Blackbox、规则挂载、静态指标库初始化
- `frontend-developer`：实现策略配置页面（CI 绑定、Job、实例选择、规则挂载、拨测配置）
- `golang-reviewer`：审查策略后端逻辑
- `frontend-reviewer`：审查策略前端页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| CI↔Exporter 模板绑定 API | `platform/strategy/ci-exporter/` | 按 `monitor_type` 维护默认采集器、端口、metrics_path、scheme、scrape_interval、scrape_timeout、`label_template_id` | 常见 monitor_type 可绑定 |
| Exporter 模板 API | `platform/strategy/exporter-template/` | ExporterTemplate CRUD、内置模板初始化 | node-exporter、mysqld-exporter、redis-exporter、windows-exporter 模板可展示 |
| ScrapeJob API | `platform/strategy/scrapejob/` | Job CRUD、关联 CI↔Exporter 绑定、标签模板引用、实例选择模式 | 可创建 Job 并预览匹配资源 |
| 实例选择 | `platform/strategy/scrapejob/selection.go` | MVP 手动勾选 `Resource`；同 monitor_type + 同网域候选；`offline` 实例显示但置灰不可选 | 勾选结果持久化到 `selected_instance_ids` |
| 认证/TLS 透传 | `platform/strategy/scrapejob/auth.go` | `auth_type` none/basic/bearer、`username`/`password`/`token`、`tls_skip_verify`、`ca_file`；映射到 scrape_configs | 配置产物含 `basic_auth`/`authorization`/`tls_config` |
| 冻结网域校验 | `platform/strategy/scrapejob/domain.go` | 禁止在禁用网域新建 Job；禁止向禁用网域新增实例；允许移除/编辑/禁用 Job | 校验生效 |
| Exporter 安装/注册确认 | `platform/strategy/scrapejob/installation.go` | 标记 Resource×Exporter 的安装状态；未确认实例不生成 target | 未确认实例不进入 targets |
| 拨测配置 API | `platform/strategy/probe/` | Blackbox probe：job_type=blackbox、blackbox_module、blackbox_targets | 可关联应用服务资源的 `health_check_url` |
| 规则文件挂载 | `platform/strategy/rule/` | `MonitoringRule.content_mode=yaml_passthrough`；上传/粘贴完整 `rules.yml`；YAML 语法校验（至少 `groups` 存在且为数组）；保存即进入 M09 变更管线 | 规则保存后 M09 能生成 rules.yml |
| 静态指标库 | `platform/strategy/metric-library/` | 内置 host/database/middleware/application/generic 常见指标 | 规则挂载页面可提示指标名 |
| 前端策略配置页 | `ui-custom/web/src/pages/strategy/` | CI 绑定、ScrapeJob、实例选择、规则挂载、拨测配置页面 | 可完成策略配置闭环 |

**接口预览**：

```http
# CI 类型 ↔ 默认采集器绑定
GET/POST    /api/v2/platform/ci-exporter-mappings
PUT/DELETE  /api/v2/platform/ci-exporter-mappings/:id

# Exporter 模板
GET/POST    /api/v2/platform/exporter-templates
PUT/DELETE  /api/v2/platform/exporter-templates/:id

# ScrapeJob
GET/POST    /api/v2/platform/scrape-jobs
PUT/DELETE  /api/v2/platform/scrape-jobs/:id
POST        /api/v2/platform/scrape-jobs/:id/preview-targets

# Exporter 安装确认
GET         /api/v2/platform/resources/:id/exporter-installation
PUT         /api/v2/platform/resources/:id/exporter-installation

# 拨测配置
GET/POST    /api/v2/platform/probe-configs
PUT/DELETE  /api/v2/platform/probe-configs/:id

# 规则文件挂载
GET/POST    /api/v2/platform/monitoring-rules
PUT/DELETE  /api/v2/platform/monitoring-rules/:id
POST        /api/v2/platform/monitoring-rules/:id/validate-yaml
```

**依赖**：Phase 2

**风险点**：
- `monitor_type` 由 M07 资源类别 + 子类型推导，需在 M01 与 M07 间约定推导表 `MONITOR_TYPE_DERIVATION_MAP`。
- 认证/TLS 字段透传需与 M09 配置生成器契约对齐，避免 `tls_config` 路径基准不一致。
- 规则文件挂载只做 YAML 语法校验，不做 PromQL 语义校验；错误规则可能进入下发流程，需在 M09 的 promtool 校验阶段拦截。

---

### Phase 4：网域与边缘配置中心（第 3 ~ 4 周）

**对应模块分支**：`feat/module-09-config-center`

**目标**：实现配置生成 / 预览 / 下发能力。MVP 只保证 `default` 域 + `local` 通道闭环；`agent_pull` 网域纳管 UI 保留占位页，完整 Edge Agent 能力放到 v0.2。

> **边界说明**：
> - Module_09 读取 Module_01 的 `ScrapeJob` / `MonitoringRule` 与 Module_07 的 `Resource` / `LabelTemplate`，轮询生成配置草稿。
> - 配置草稿需人工确认后再生成 `ConfigVersion` 并触发下发，防止平台 bug 导致监控整体失效。
> - `external_labels` 只注入 `network_domain_id` / `zone_type` / `replica`，不注入 `tenant_id` 与业务标签。

**Agent 分工**：
- `planner`：规划配置生成器输入/输出、下发方式、校验策略、NetworkDomain 监控纳管契约
- `backend-developer`：实现配置生成、校验、下发、历史记录、NetworkDomain 监控纳管 API
- `prometheus-developer`：评估是否需要 Prometheus 扩展；MVP 阶段通常只需生成配置，不修改源码
- `frontend-developer`：实现配置预览 / diff / 下发页面、网域纳管页面、agent_pull 占位页
- `golang-reviewer`：审查配置生成与下发逻辑
- `security-reviewer`：审查配置下发安全性（文件写入、reload 触发权限、Token 鉴权）

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| NetworkDomain 监控纳管 API | `platform/configcenter/domain/` | 从 M06 已存在网域中选择；维护 `channel` / `agent_type` / `remote_write_url` / `token` / `center_endpoint`；`default` 固定 `local` | 可标记网域为已纳管 |
| agent_pull 占位页 | `ui-custom/web/src/pages/config-center/domains/` | 安装指引（3 步人工步骤）、Token 脱敏复制、采集节点状态空态引导 | 页面可展示但不实现心跳/拉包 |
| 配置生成器 | `platform/configcenter/generator/` | 按网域组装 `prometheus.yml`（scrape_configs + file_sd + external_labels）与 `rules.yml` | 生成 YAML 与 PRD 示例一致 |
| `external_labels` 注入 | `platform/configcenter/generator/labels.go` | 只注入 `network_domain_id`、`zone_type`、`replica` | 产物中无 `tenant_id` |
| `offline` 资源排除 | `platform/configcenter/generator/targets.go` | 生成 `targets/*.json` 时过滤 `Resource.status=offline` | offline 资源不出现在配置中 |
| Label 合并器 | `platform/configcenter/generator/labels.go` | 合并 `system` / `user` / `cmdb {v0.4+}` label，优先级 `cmdb` > `user` > `system`；`system` 不可被覆盖 | 冲突时按优先级合并 |
| 配置校验 | `platform/configcenter/generator/validate.go` | 调用 `promtool check config`、blackbox `--config.check`、targets JSON schema 校验 | 错误配置能被拦截 |
| 配置草稿与预览 | `platform/configcenter/draft/` | 生成 `ConfigDraft`、YAML 预览、与当前版本 diff、人工确认/废弃 | UI 可预览并确认 |
| 配置下发 | `platform/configcenter/deployment/` | 确认后生成 `ConfigVersion`；`local` 通道写盘并触发中心 Prometheus reload | Prometheus 成功 reload |
| 下发历史 | `platform/configcenter/deployment/history.go` | 记录每次下发内容与结果 | 有历史记录表 |
| `change_status` 回写 | `platform/configcenter/deployment/callback.go` | `ConfigDeployment.status=success` 后回写 M01 `ScrapeJob.change_status=deployed` | M01 列表状态正确 |
| 前端配置中心页 | `ui-custom/web/src/pages/config-center/` | 网域纳管、草稿列表、配置预览/diff、一键下发、下发历史 | 可下发后看到 targets 更新 |

**接口预览**：

```http
# 网域监控纳管
GET/POST    /api/v2/platform/network-domains/:id/onboard
PUT         /api/v2/platform/network-domains/:id/onboard
GET         /api/v2/platform/network-domains/:id/config-status

# 配置草稿 / 预览 / 确认
GET/POST    /api/v2/platform/config/drafts
POST        /api/v2/platform/config/drafts/:id/confirm
POST        /api/v2/platform/config/drafts/:id/discard
POST        /api/v2/platform/config/drafts/:id/revalidate
GET         /api/v2/platform/config/preview?draft_id=

# 配置下发与历史
POST        /api/v2/platform/config/apply
GET         /api/v2/platform/config/history
POST        /api/v2/platform/config/history/:id/retry

# Edge Sync Agent 协议（v0.2 实现）
POST        /api/v2/platform/edge/heartbeat
GET         /api/v2/platform/edge/config?network_domain=
```

**依赖**：Phase 3、本地 Prometheus 进程可运行

**风险点**：
- 本地开发需要能启动 Prometheus 并加载生成的配置，需同步准备 `deploy/` 启动脚本和示例配置。
- 配置生成是 MVP 核心，需重点测试标签模板与 relabel 的正确性。
- 配置中心引入人工确认步骤，需保证 UI diff 清晰，避免工程师误操作。
- `agent_pull` 占位页与后续 v0.2 真实能力需明确边界，避免用户误以为 MVP 支持边缘 Agent。

---

### Phase 5：跨模块联调验收（第 4 ~ 5 周）

**对应分支**：`integration/v0.1`（MVP）。从 `develop` 切出，承载版本末跨模块联调；验收通过后 `--no-ff` 合回 `develop` 并删除。v0.2 / v0.3 等后续版本复用同一机制，依次使用 `integration/v0.2`、`integration/v0.3` 等。

**目标**：把 M06 / M07 / M01 / M09 页面串成可用动线，补齐导航、错误处理、端到端验证与文档；同时建立跨版本可复用的「联调分支 + 冻结窗口」机制，避免联调期间功能分支继续改动造成冲突。

**入口条件**：
1. Phase 1 ~ 4 相关 `feat/module-XX` 已全部 `--no-ff` 合并到 `develop`。
2. 对应模块 PRD 修订表已标记「已冻结」。
3. chenrt 宣布「代码冻结 / 进入联调」，从 `develop` 切出 `integration/v0.1`。

**Agent 分工**：
- `planner`：规划联调动线、验收用例、文档更新清单
- `frontend-developer`：统一布局/导航调整、首页状态卡片、错误处理
- `backend-developer`：配合提供首页所需聚合数据 API（资源数、待确认变更单数）
- `frontend-reviewer`：审查门户串联代码
- `build-resolver`：解决端到端验证中出现的构建/测试问题

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 统一布局 | `ui-custom/web/src/layouts/` | 侧边栏导航：网域管理、资源管理、标签模板、策略、配置中心、查询 | 页面切换流畅 |
| 首页 Dashboard | `ui-custom/web/src/pages/home/` | 资源数量、待确认配置草稿数、最近下发记录 | 数据真实 |
| 错误与加载状态 | `ui-custom/web/src/components/` | 统一 Loading / Error / 空态 | 用户体验一致 |
| 端到端联调 | 手工 / 脚本 | 网域登记 → 资源导入 → 策略配置 → 配置生成 → 确认下发 → Prometheus reload → 指标查询 | 主链路跑通 |
| 文档更新 | `README.md`、部署文档 | 补充启动步骤与 MVP 范围说明 | 新成员可按文档跑起来 |

**依赖**：Phase 1 ~ 4

**风险点**：
- 联调期间发现需要实质性返工的模块时，必须走「先收尾 integration 回合 develop → 再重新切 feat 分支处理」的回退路径，禁止在 `integration/vX.Y` 上大规模重构或私自重启已冻结的 `feat/module-XX`。
- M02 查询代理仅保留现有能力，若 MVP 演示需要告警/目标状态页面，需明确哪些能力可用、哪些仅 placeholder。

---

### Phase 6：多网域 Edge-Cloud 与监控源登记册（v0.2，第 5 ~ 8 周）

本阶段对应 [02_Product_Roadmap.md](02_Product_Roadmap.md) 的 **v0.2** 里程碑：多网域 Edge-Cloud 架构落地、租户-网域关联、外部 Prometheus Remote Write 接入、中心 VictoriaMetrics 汇聚。建议拆分为 4 个并行的子 Phase。

#### Phase 6.1：查询中心（v0.2）

**对应模块分支**：`feat/module-02-query-center`

**目标**：提供统一的 Prometheus Query API 代理入口，在转发时自动注入租户/网域上下文以保证多租户隔离，并返回带数据来源与新鲜度 envelope 的响应；同时吸收目标状态展示职责。

**主要任务**：
- Query 代理 API：`platform/query/proxy.go`
- PromQL AST 注入 `tenant` / `network_domain`
- `/api/v1/targets` 代理与目标状态聚合
- 响应 envelope：`meta.data_source` / `meta.freshness_at` / `meta.network_domains`

**依赖**：Phase 5、Module_06 租户-网域关联（6.2）

#### Phase 6.2：租户与网域关联（v0.2）

**对应模块分支**：`feat/module-06-tenant-management`

**目标**：落地租户数据模型与 `NetworkDomain.tenant_id` / `authorized_tenant_ids` 关联，支撑多站点模式。

**主要任务**：
- Tenant CRUD：`platform/admin/tenant/`
- 租户-网域授权校验
- `multi_site_enabled` 能力开关
- 默认租户/网域数据迁移

**依赖**：Phase 4

#### Phase 6.3：边缘 Agent 接入与配置分发（v0.2）

**对应模块分支**：`feat/module-09-edge-cloud`

**目标**：让 Edge Sync Agent 能够通过 Token 拉取本域配置包，vmagent / Prometheus Agent Mode 接入，中心 VictoriaMetrics 接收 Remote Write，并展示 Agent 状态列表。

**主要任务**：
- EdgeHeartbeat 接口
- 配置包拉取（zip + metadata.json + checksum）
- 配置版本比对与 304 返回
- Remote Write 参数注入
- Agent 状态列表页完整实现

**依赖**：Phase 6.2、Phase 4

#### Phase 6.4：监控源登记册与 Ingestion Gateway（v0.2）

**对应模块分支**：`feat/module-10-source-registry`

**目标**：登记外部 Prometheus 等异构监控源，通过统一 Remote Write 接收点接入。

**主要任务**：
- MonitoringSource CRUD
- Ingestion Gateway `/api/v2/ingest/prometheus/:source_id`
- Token 鉴权与标签注入
- 接入源健康状态

**依赖**：Phase 4

---

### Phase 7：门户化查询与告警状态（v0.3，第 9 ~ 10 周）

#### Phase 7.1：自定义前端门户

**对应模块分支**：`feat/module-05-portal`

**目标**：补齐 Custom UI 门户体验，提供首页 Dashboard、统一导航、查询页图表、告警状态页。

**主要任务**：
- 门户首页 Dashboard
- PromQL 查询页增强（表格/简单折线/查询历史）
- 统一导航与权限入口占位

#### Phase 7.2：告警收敛与通知管理

**对应模块分支**：`feat/module-08-alerting-lifecycle`

**目标**：管理 Alertmanager 配置（路由/接收人/静默/抑制），并通过 M02 展示告警状态。

**主要任务**：
- Receiver / Route / Silence / InhibitionRule 数据模型
- `alertmanager.yml` 生成与 reload
- 告警状态页（调用 M02 `/api/v1/alerts`）

#### Phase 7.3：查询中心增强

**对应模块分支**：`feat/module-02-query-center-v03`

**目标**：PromQL 校验/预览接口、查询辅助、首页 Dashboard 数据。

**主要任务**：
- `/api/v1/query/validate`、`/api/v1/query/preview`
- 指标名/标签补全
- 批量查询接口

---

### Phase 8：外部 CMDB 与异构监控接入（v0.4，第 11 ~ 14 周）

#### Phase 8.1：自定义服务发现与外部 CMDB 生命周期管理

**对应模块分支**：`feat/module-04-cmdb-discovery`

**目标**：接入腾讯蓝鲸、HTTP、Nacos 等外部 CMDB，将权威 CI 同步为 MetricCenter Resource。

**主要任务**：
- CMDBProvider 接口
- BlueKing / HTTP / Nacos Provider
- CI 类型映射表、待分类队列、孤儿资源管理

#### Phase 8.2：Zabbix / 云监控异构接入

**对应模块分支**：`feat/module-10-heterogeneous`

**目标**：在监控源登记册基础上，引入 Zabbix Adapter 与云监控 Puller。

**主要任务**：
- 标签归一化管道
- Metric Drop Rules
- Zabbix / 云监控 Adapter 架构

---

### Phase 9：企业级能力（v1.0，第 15 ~ 20 周）

#### Phase 9.1：多租户权限与审计

**对应模块分支**：`feat/module-06-enterprise`

**目标**：完整用户/角色/权限策略、审计日志展示与归档、平台全局配置。

#### Phase 9.2：企业级告警能力

**对应模块分支**：`feat/module-08-alerting-enterprise`

**目标**：完整告警规则 UI、Alertmanager 配置生成、静默管理、通知渠道配置。

#### Phase 9.3：边缘自治告警与证书自动轮转

**对应模块分支**：`feat/module-09-edge-autonomy`

**目标**：在边缘网域实现断网自治告警（vmalert + 本地 Alertmanager），mTLS 证书自动轮转与 Token 轮换。

#### Phase 9.4：元数据迁移与长期存储

**对应模块分支**：`feat/module-06-storage`

**目标**：将元数据从 SQLite 迁移到 PostgreSQL / MySQL，并将长期时序存储切换到 VictoriaMetrics / Mimir 集群。

---

## 5. 前后端入口与目录约定

### 5.1 后端目录

```
platform/
  cmd/metric-center/          # 主程序入口
  cmd/migrate/                # v1.0 元数据迁移工具
  db/                         # 数据库连接、迁移、种子数据
    db.go
    seed/                     # platform_admin / default / zone_type / 默认模板 / 内置采集器
  api/response/               # 统一响应（含 errorType 枚举）
  models/                     # 共享 GORM 模型
  admin/                      # Module_06 系统与平台管理
    networkdomain/            # 网域登记行政 API（zone-types / network-domains）
    tenant/                   # v0.2+ 租户管理
    user/                     # v1.0+ 用户管理
    role/                     # v1.0+ 角色权限
    audit/                    # v1.0+ 审计日志
  config/                     # Module_07 监控对象管理
    resource/                 # 五类资源 CRUD + Excel 导入 + ResourceLabel
    label/                    # LabelTemplate + system label 生成
  strategy/                   # Module_01 监控策略与指标管理
    ci-exporter/              # CI 类型 ↔ 默认采集器绑定
    exporter-template/        # 采集实现 / 采集器
    scrapejob/                # ScrapeJob + 实例选择 + 认证/TLS
    probe/                    # Blackbox 拨测配置
    rule/                     # 规则文件挂载
    metric-library/           # 静态指标库
    installation/             # Exporter 安装确认
  configcenter/               # Module_09 网域与边缘配置中心
    domain/                   # 网域监控纳管
    generator/                # 配置生成、校验、Label 合并
    draft/                    # 配置草稿与预览
    deployment/               # 配置下发、reload、历史记录
    edge/                     # v0.2+ Edge Agent 心跳、配置包拉取
    cert/                     # v1.0 mTLS 证书签发与轮转
  query/                      # Module_02 查询中心（v0.2 起）
    proxy.go
    envelope.go
    metadata.go
    targets.go
  alerting/                   # Module_08 告警收敛（v0.3 起）
    receiver.go
    route.go
    silence.go
    inhibit.go
    alertmanager.go
  ingestion/                  # Module_10 监控源登记册（v0.2 起）
    source/
    gateway/
    auth.go
    injector.go
    normalization.go
  discovery/                  # Module_04 自定义服务发现（v0.4 起）
    provider/
    mapping.go
    pending.go
    orphan.go
  examples/simple-agent/      # simple-agent 模板
```

### 5.2 前端目录

```
ui-custom/web/
  src/
    api/                      # API 客户端
    types/                    # TypeScript 类型
    pages/
      admin/
        domains/              # Module_06 网域登记
        tenants/              # v0.2+ 租户管理
      resources/              # Module_07 资源管理
      label-templates/        # Module_07 标签模板
      strategy/               # Module_01 监控策略
        ci-exporter/
        scrape-jobs/
        rules/
        probe-configs/
      config-center/          # Module_09 配置中心
        domains/
        drafts/
        preview/
        history/
        agents/               # Agent 状态（MVP 占位，v0.2 完整）
      query/                  # Module_02 查询中心（保留现有能力）
      alerts/                 # Module_08 告警收敛（v0.3）
      home/                   # 首页 Dashboard
    components/               # 通用组件
    layouts/                  # 布局
```

---

## 6. 开发顺序与并行建议

### 6.1 顺序约束

```text
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
          Phase 6.1        Phase 6.2         Phase 6.3/6.4
          (Module_02)      (Module_06)       (Module_09/10)
              │               │               │
              └───────────────┴───────────────┘
                              │
                              ▼
                    Phase 7 / Phase 8 / Phase 9
```

### 6.2 可并行任务

| 阶段 | 可并行项 |
|------|----------|
| Phase 1 | 后端行政 API 与前端网域管理页可并行 |
| Phase 2 | 后端资源 API、LabelTemplate API 与前端资源页面、标签模板页面可并行 |
| Phase 3 | CI↔Exporter 绑定、ScrapeJob、Blackbox、规则挂载可并行开发 |
| Phase 3 与 Phase 4 | 在 M01 数据模型稳定后，M09 配置生成器可与 M01 剩余前端页面并行 |
| Phase 5 | 前端串联与后端聚合 API 可并行 |
| Phase 6 | 6.1/6.2/6.3/6.4 可并行；6.1 依赖 6.2 租户模型 |
| Phase 7 / 8 / 9 | 内部子阶段可并行 |

### 6.3 Agent 驱动的开发节奏

> 以下按 **1 个 Orchestrator + 1 个 backend-developer + 1 个 frontend-developer** 的节奏编排。

| 周次 | Orchestrator 动作 | backend-developer | frontend-developer | reviewer |
|------|-------------------|-------------------|--------------------|----------|
| 1 | 规划 Phase 0~1；在开发空间创建 feat 分支 | Phase 0：基础设施 + 种子数据 | Phase 0：前端结构 + 网域管理页框架 | golang-reviewer 审查后端基础设施 |
| 2 | 汇总 Phase 1；规划 Phase 2 | Phase 1：网域登记 API | Phase 1：网域管理页 | frontend-reviewer |
| 3 | 规划 Phase 3 | Phase 2：资源/标签模板/Excel 后端 | Phase 2：资源/标签模板页面 | golang-reviewer |
| 4 | 规划 Phase 4；协调前后端契约 | Phase 3：策略后端（CI/Job/规则挂载） | Phase 3：策略页面 | frontend-reviewer |
| 5 | 规划 Phase 5；本地 Prometheus 联调 | Phase 4：配置生成/下发 | Phase 4：配置中心页 + agent_pull 占位 | security-reviewer 审查配置下发 |
| 6 | Phase 5 收尾；端到端验收 | 配合首页聚合数据 API | Phase 5：门户串联、首页、E2E | build-resolver 处理构建问题 |

### 6.4 Track B 增量登记（v2.0 起）

> Track B/B+ 需求不重排既有 Phase 结构，在此登记增量；**版本末（integration/vX.Y 切出前）由 plan-maintainer 批量归并**进 Phase 结构并对齐 Plan 版本号。Track B 期间 Plan 主版本号保持不变，各增量项标注自身 PRD 版本。

| 登记日期 | 能力 | 模块 / PRD 版本 | 轨道 | feat 分支 | L3 路径 | 状态 |
|----------|------|----------------|------|-----------|---------|------|
| 2026-08-28 | 租户管理（单租户查看/编辑）+ 用户管理 + 登录日志 | Module_06 v2.3 | Track B | `feat/module-06-domain-registry`（复用既有分支名） | `docs/05-execution-records/module-06/track-b-increment-decision-44/task-sequence.yaml` | 待开发 |
| 2026-08-28 | 轻量认证（登录 / 会话 / 认证中间件 / 登录页） | Module_03 v1.2 | Track B+（强制 security-reviewer） | 同上（同一验收闭环，共用分支避免跨分支模型依赖） | 同上 | 待开发 |

> 分支说明：M03 认证依赖 M06 User 模型，二者构成同一验收闭环（登录 → 用户/租户管理），合并为单一 feat 分支。按用户决策（2026-08-28）**复用既有分支名 `feat/module-06-domain-registry`**——该分支已 `--no-ff` 合入 develop，复用时必须**从最新 develop 重建同名分支**（删除旧分支后重新切出），禁止在已合并的旧分支基线上继续提交。分支名与实际范围（租户/用户/认证）不完全对应，属已登记豁免。开发顺序：模型/种子 → 用户与认证 API → 认证中间件 → 前端页面（前端在契约快照就绪后可并行 mock 开发）。

---

## 7. MVP 验收清单

### 7.1 网域登记（Module_06）

- [ ] 系统启动后存在 `platform_admin` 租户与 `default` 管理域（`channel=local`）
- [ ] 可通过 `GET /api/v2/platform/zone-types` 获取网络区域类型字典
- [ ] 可登记/编辑/禁用网域；禁用=冻结，拒绝新资源登记、新 Job、新变更单
- [ ] `default` 管理域禁止禁用、禁止删除
- [ ] 空网域可删除，非空网域删除被拒并引导禁用
- [ ] `tenant_id` 创建后不可变更

### 7.2 监控对象管理（Module_07）

- [ ] 可维护主机 / 数据库 / 中间件 / 应用服务 / 通用指标目标五类资源
- [ ] 资源新增/编辑时 `network_domain_id` 与 `biz_code` 必填
- [ ] 可按资源类型下载固定列 Excel 模板并导入；支持 upsert 更新
- [ ] Excel 中文状态正确映射到 `Resource.status`
- [ ] 可维护标签模板；默认模板含 `biz_code → biz` 与 `instance_ip:port → instance`
- [ ] 资源详情可查看 `system` / `user` 来源 ResourceLabel；`system` 标签只读
- [ ] 仅 application 资源可添加/修改 `user` label
- [ ] 资源列表支持「未监控」筛选（`is_monitored` 由 M01 维护、M07 只读映射）

### 7.3 监控策略与指标管理（Module_01）

- [ ] 可为常见 monitor_type 建立/编辑 CI 类型 ↔ Exporter 模板绑定
- [ ] 可创建/编辑 `ScrapeJob`，手动勾选实例；`offline` 实例置灰不可选
- [ ] ScrapeJob 必须绑定已纳管网域；冻结网域禁止新建 Job / 新增该域实例
- [ ] 认证/TLS 字段可配置并透传进 scrape_configs
- [ ] 可维护 Blackbox 拨测配置
- [ ] 规则编辑页支持上传/粘贴完整 `rules.yml` 透传落库（`content_mode=yaml_passthrough`）
- [ ] 规则保存/启停/删除后进入 M09 变更管线，`change_status` 可被 M09 回写

### 7.4 网域与边缘配置中心（Module_09）

- [ ] 可对 `default` 域完成监控纳管（`channel=local`）
- [ ] 配置中心按网域生成 `prometheus.yml`、`targets/*.json`、`rules.yml` 草稿
- [ ] 生成的 `external_labels` 只包含 `network_domain_id` / `zone_type` / `replica`
- [ ] `offline` 资源不进入 `targets/*.json`
- [ ] 配置预览 / Diff / 人工确认可用
- [ ] 确认后 `local` 通道写盘并触发中心 Prometheus reload 成功
- [ ] 下发记录可查询成功/失败历史与失败原因
- [ ] 下发成功后回写 M01 `ScrapeJob.change_status=deployed`
- [ ] `agent_pull` 网域纳管 UI 占位页可展示安装指引与 Token 复制入口

### 7.5 跨模块联调验收（Phase 5）

- [ ] 网域登记 → 资源导入 → 策略配置 → 配置生成 → 确认下发 → Prometheus reload → 指标可见 主链路跑通
- [ ] 各页面可通过统一导航切换
- [ ] 首页展示资源数量、待确认草稿数等聚合数据
- [ ] `go test ./platform/...`、`go vet ./platform/...`、`pnpm test`、`pnpm lint` 全部通过
- [ ] 后端服务能启动，关键接口返回 200；前端 dev server 能启动，首页返回 200

### 7.6 Track B 增量验收（决策 44：轻量认证 + 租户/用户管理）

- [ ] 登录页可用 `admin` / 初始密码登录；未登录访问任何页面跳转登录页，登录成功后回跳原页面
- [ ] 匿名请求（除 `POST /api/v2/platform/auth/login` 与 `/api/v1/health*` 外）被认证中间件拒绝并返回 401；持有效 Token 可正常访问
- [ ] 「用户管理」页可创建 / 编辑 / 禁用 / 启用用户并重置密码；被禁用用户无法登录且已有会话失效
- [ ] 「租户管理」页可查看 / 编辑 `platform_admin` 租户；无「新建租户」与「禁用」入口
- [ ] 「登录日志」页可查看账号 / 时间 / 来源 IP / 成败结果
- [ ] 密码 bcrypt 哈希存储，任何接口 / 日志不返回明文或哈希；Token 不透明、12h 过期，登出 / 改密 / 禁用即失效
- [ ] 无授权隔离：所有登录用户等价（MVP 已知风险，决策 44）
- [ ] 初始管理员 `admin` 由后端启动 migration upsert 幂等预置，重复启动不报错
- [ ] 登录 / 会话 / 密码相关代码已通过 security-reviewer 审查（Track B+ 强制关卡）

---

## 8. 风险与规避

| 风险 | 影响 | 规避措施 |
|------|------|----------|
| M06 / M07 / M01 / M09 网域边界混淆 | 代码耦合、职责重复 | Phase 0 冻结对象/策略/下发的数据契约；M06 行政、M07 只读引用、M09 监控纳管职责写入各模块接口注释 |
| M06 禁用网域跨模块联动遗漏 | 禁用后 M07/M01/M09 行为不一致 | Phase 1 明确冻结语义并在各模块写校验；联调阶段专门验证 |
| 标签模板生成 relabel / instance 标签错误 | 配置下发后 targets 标签不对 | Phase 4 增加 promtool 校验 + 单元测试；用 simple-agent 验证端到端 |
| ResourceLabel 合并优先级错误 | CMDB/user/system 覆盖关系不符合预期 | Phase 2 明确 `cmdb` > `user` > `system`、`system` 不可被 user 覆盖，并写单元测试 |
| 规则文件挂载只做语法校验，错误规则进入下发 | Prometheus reload 失败或规则不生效 | M09 promtool 校验作为兜底；MVP 内在 UI 提示「请确保 YAML 语法正确」 |
| `agent_pull` 占位页与真实能力边界不清 | 用户误以为 MVP 支持边缘 Agent | 占位页明确标注「v0.2 启用」；按钮/入口置灰或引导文档 |
| M01 与 M09 `change_status` 回写延迟 | 用户看到的状态不准确 | 采用 pull 模式异步回写；UI 提示「状态可能存在延迟，可刷新查看最新」 |
| Excel 字段后期变更 | 导致导入逻辑和模板返工 | Phase 2 冻结最小字段集，后续只增不改 |
| 前端等待后端 API | 串行阻塞 | Planner 在规划中明确 API 契约，Frontend Developer 使用 mock 数据并行开发 |
| 多 Agent 同时修改冲突 | 代码冲突、空间/分支污染 | 采用双文件夹隔离，开发集中在 `CNCF_Monitor-feature` 按 Phase 顺序进入；前后端按 `platform/` 与 `ui-custom/` 目录天然隔离 |
| Agent 误解需求 | 实现偏离 | 每个 Phase 开始前必须调用 `planner` 输出规划，并引用相关 PRD 文件 |
| Reviewer 与 Developer 标准不一致 | 反复修改 | Orchestrator 在启动时统一注入 `.kimi/skills/golang-coding-style` 和 `web-development` 规范 |
| Prometheus 源码被误改 | 未来升级困难 | 涉及源码时必须走 `prometheus-developer`，生成 patch 文件 |
| 配置中心草稿确认流程增加操作成本 | 配置变更延迟生效 | UI 提供清晰 diff 与一键确认；default 域场景简化流程 |
| 本地 Prometheus 启动困难 | 阻塞 Phase 4 ~ 5 | 第 1 周就准备 `deploy/` 启动脚本和示例配置 |

### 8.1 Orchestrator 执行一个 Phase 的 Checklist

每个 Phase 开始前，Orchestrator 应按以下清单驱动 Agent：

- [ ] 明确本 Phase 要交付的功能和验收标准
- [ ] 调用 `planner`，提供相关 PRD 和上一 Phase 的输出
- [ ] 在开发空间 `CNCF_Monitor-feature` 内切换到当前模块的 `feat/module-XX-<功能名>`
- [ ] 向 `backend-developer` / `frontend-developer` 分配任务，并注入相关 skill 上下文
- [ ] 接收 Developer 完成汇报，检查测试与 lint 结果
- [ ] 调用对应 `reviewer` 进行代码审查
- [ ] 如审查不通过，返回 Developer 修复并重新审查
- [ ] 将当前 `feat/module-XX-<功能名>` 以 `--no-ff` 合并到 `develop`（开发空间保留供下一模块复用）
- [ ] 更新本文件中的 MVP 验收清单状态

---

## 9. 变更记录

### v2026-08-21

- 按用户最新决策重派生 MVP 实施计划：
  - MVP 范围收缩为 M01 / M06 / M07 / M09 的部分能力；M02 / M05 / M08 不列为 MVP 新开发任务。
  - 模块顺序重写为 Phase 0 → M06 → M07 → M01 → M09 → 跨模块联调验收。
  - 新增 `feat/module-06-domain-registry` 分支承载网域登记；移除原 `feat/module-05-portal` MVP 独立分支。
  - M01 规则编辑任务改为「规则文件挂载」；字段化编辑 + PromQL 校验移出 MVP。
  - M09 任务裁剪到 `default/local` 通道闭环；`agent_pull` 网域纳管 UI 保留占位页。
  - M07 资源模型改五类（补 Database），补充 `biz_code`、`is_monitored` 只读筛选、`zone_type` 等字段。
  - M06 网域登记纳入 MVP：`zone-types` 字典、`authorized_tenant_ids`、禁用=冻结、种子 upsert。
  - `external_labels` 明确只注入 `network_domain_id` / `zone_type` / `replica`。
  - 重写 §7 MVP 验收清单与 §8 风险表。
- PRD 版本对齐：M01 v3.26 / M06 v2.2 / M07 v2.21 / M09 v1.50。

### v3.3（2026-08-02）

- 同步 Module PRD 7 月 31 日版本，更新模块名称与路径引用。
- 扩展实施计划为 9 个 Phase，覆盖 MVP ~ v1.0。
- 更新模块依赖图、目录约定、风险表。
- 变更人：chenrt
