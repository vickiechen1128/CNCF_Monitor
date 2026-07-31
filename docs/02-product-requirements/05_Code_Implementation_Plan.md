# MetricCenter 代码实施计划

> 文档类型：工程实施计划  
> 依赖文档：[00_Global_Architecture.md](00_Global_Architecture.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)、[04_Implementation_Map.md](04_Implementation_Map.md)、[Modules/README.md](Modules/README.md)、[../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md)、[../decisions/grill-2026-07-31-query-center.md](../decisions/grill-2026-07-31-query-center.md)  
> 版本：v3.2  
> 更新日期：2026-07-31

---

## 1. 计划目标

在文档架构已对齐的前提下，给出从当前状态到 MVP 可运行的开发路径，明确：

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
| **数据流驱动** | 按“对象 → 标签 → 策略 → 配置生成 → 下发 → 查询/告警”主线推进 |
| **控制面与源码隔离** | 业务代码只写在 `platform/` 和 `ui-custom/`，上游源码尽量不碰 |
| **先 L1/L2，后 L3/L4** | 优先做 Prometheus 已支持、只需代理或生成配置的能力 |
| **每阶段可运行** | 每个 Phase 结束都应有一个可演示的闭环，不堆积半成品 |

### 2.2 模块优先级总览

本计划按 **功能子模块** 组织开发，每个模块对应一个 `feature/module-XX-<功能名>` 分支，由 Orchestrator 按顺序切分并合并到 `develop`。

```
feature/module-00-infrastructure          Phase 0: 基础设施与共享数据模型
        │
        ▼
feature/module-07-resource-management     Phase 1: 监控对象管理（Resource + Excel 导入 + LabelTemplate）
        │
        ▼
feature/module-01-strategy                Phase 2.1: 监控策略与指标管理
        │      （CI↔Exporter 绑定 + ScrapeJob + 实例选择 + 规则编辑 UI）
        │
        ▼
feature/module-09-config-center           Phase 2.2: 网域与边缘配置中心
        │      （配置生成 / 预览 / 下发 / NetworkDomain）
        │
        ├──► feature/module-02-query-center        Phase 3: 查询中心（含目标状态展示）
        │
        ├──► feature/module-08-alerting-lifecycle  Phase 4: 告警生命周期管理
        │
        ▼
feature/module-05-portal                  Phase 5: 前端门户集成与 MVP 验收
```

| 模块分支 | 对应 Phase | 功能 | 前置依赖 |
|----------|-----------|------|----------|
| `feature/module-00-infrastructure` | Phase 0 | 基础设施与共享数据模型 | - |
| `feature/module-07-resource-management` | Phase 1 | 监控对象管理：Resource CRUD + Excel 导入 + LabelTemplate + ResourceLabel 基础 CRUD + 状态映射 | Module 00 |
| `feature/module-01-strategy` | Phase 2.1 | 监控策略与指标管理：CI↔Exporter 绑定、`ScrapeJob`、实例选择、Exporter 安装确认、规则编辑 UI、静态指标库 | Module 07 |
| `feature/module-09-config-center` | Phase 2.2 | 网域与边缘配置中心：NetworkDomain、配置生成、草稿预览、人工确认、下发 reload | Module 07、Module 01 |
| `feature/module-02-query-center` | Phase 3 | 查询中心：带租户/网域上下文注入的 Prometheus Query API 代理 + 目标状态展示 | Module 09、中心 Prometheus 运行 |
| `feature/module-08-alerting-lifecycle` | Phase 4 | 告警生命周期管理：规则分组、静默、Alertmanager 配置、告警状态查看 | Module 01、Module 09 |
| `feature/module-05-portal` | Phase 5 | 前端门户集成与 MVP 验收 | 全部后端 API |

### 2.3 多 Agent 协作开发模式

本项目使用 `.kimi/agents/` 定义的 Agent 团队进行开发。当前统一走 **Trae IDE 对话面板**（未购买 Kimi CLI Agent 时，直接引用对应 `.md` 作为上下文）。

#### Agent 角色与职责

| Agent | 职责 | 写权限 | 在计划中的使用时机 |
|-------|------|--------|-------------------|
| `planner` | 输出实现计划、识别风险、拆分子任务 | ❌ 只读 | 每个 Phase 开始前，由 Orchestrator 调用 |
| `backend-developer` | Go 后端 TDD 开发 | ✅ | 后端 API、模型、配置生成等 |
| `frontend-developer` | React + TypeScript 前端开发 | ✅ | 页面组件、API 调用、布局 |
| `prometheus-developer` | Prometheus 扩展 / Patch | ✅ | 涉及 Prometheus 源码修改或扩展点时使用 |
| `build-resolver` | 修复构建/测试/lint 错误 | ✅ | 构建或测试失败时 |
| `golang-reviewer` | Go 代码审查 | ❌ 只读 | Backend Developer 完成后 |
| `frontend-reviewer` | 前端代码审查 | ❌ 只读 | Frontend Developer 完成后 |
| `security-reviewer` | 安全审查 | ❌ 只读 | Phase 2.2（配置下发）、Phase 4（告警通知）等关键节点 |

#### 标准工作流

```
Orchestrator（你）
    │
    ├──► 调用 planner 输出模块任务规划
    │         │
    │         ▼
    │    明确当前模块分支：feature/module-XX-<功能名>
    │
    ├──► 复用单一 git worktree
    │         │
    │         ▼
    │    在 worktree 内切换到当前模块 feature 分支
    │
    ├──► 调用 backend-developer 在 worktree 中 TDD 开发
    │         │
    │         ▼
    │    完成后提交到 feature/module-XX-<功能名>
    │
    ├──► 调用 golang-reviewer 审查
    │         │
    │         ▼
    │    如 REQUEST_CHANGES，返回 backend-developer 修复
    │
    ├──► 调用 frontend-developer 开发前端页面（可并行）
    │         │
    │         ▼
    │    完成后提交到 feature/module-XX-<功能名>
    │
    ├──► 调用 frontend-reviewer 审查
    │
    ├──► 在 worktree 中验证运行状态
    │         │
    │         ▼
    │    后端：go test/vet + 启动服务验证接口
    │    前端：pnpm test/lint + 启动 dev server 验证页面
    │
    ├──► 将 feature/module-XX-<功能名> 以 --no-ff 合并到 develop
    │         │
    │         ▼
    │    由 Orchestrator 在主仓库执行合并
    │
    ├──► 在 develop 环境中再次验证运行状态
    │         │
    │         ▼
    │    如验证失败，回退或修复；如通过，继续下一模块
    │
    └──► worktree 保留，切换到下一个模块分支继续复用
```

#### Worktree 使用规范

本项目采用**Gitflow + 单一 worktree + 按功能子模块拆分 feature 分支**模式（适合单人/小团队，避免目录堆积，同时保证每个模块可独立回退）：

```bash
# 由 Orchestrator 在主仓库执行（一次性初始化）
cd "../CNCF_Monitor"
git checkout develop

# 创建单一 worktree，目录固定，不随模块变化
git worktree add "../CNCF_Monitor-worktree" develop
cd "../CNCF_Monitor-worktree"

# 开始某个模块时，从 develop 切出对应 feature 分支
git checkout -b feature/module-XX-<功能名> origin/develop
```

##### Gitflow 分支约定

| 分支类型 | 命名示例 | 用途 | 来源 | 合并目标 |
|----------|----------|------|------|----------|
| `main` | `main` | 稳定/生产版本 | - | - |
| `develop` | `develop` | 集成/开发主线 | `main` | - |
| feature | `feature/module-00-infrastructure` | 基础设施 | `develop` | `develop` |
| feature | `feature/module-07-resource-management` | 监控对象管理 | `develop` | `develop` |
| feature | `feature/module-01-strategy` | 监控策略与指标管理 | `develop` | `develop` |
| feature | `feature/module-09-config-center` | 网域与边缘配置中心 | `develop` | `develop` |
| feature | `feature/module-02-query-center` | 查询中心 | `develop` | `develop` |
| feature | `feature/module-08-alerting-lifecycle` | 告警生命周期 | `develop` | `develop` |
| feature | `feature/module-05-portal` | 前端门户 | `develop` | `develop` |
| `release/*` | `release/v0.1.0` | 版本发布 | `develop` | `main` + `develop` |
| `hotfix/*` | `hotfix/v0.1.1` | 生产紧急修复 | `main` | `main` + `develop` |

- 每个功能子模块对应一个 feature 分支，分支内只包含该模块的改动
- 模块完成后，Orchestrator 将当前 feature 分支以 `--no-ff` 合并回 `develop`
- 严禁 feature 分支直接合入 `main`
- worktree 目录固定复用，通过切换分支完成不同模块开发
- 回退策略详见 [06_Gitflow_Branch_and_Rollback_Guide.md](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md)

Agent 进入 worktree 后必须先执行启动协议：

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

```
┌─────────────────────────────────────────────────────────────────┐
│                        Phase 0 基础设施                          │
│  platform/models/ · platform/db/ · platform/api/response         │
│  共享模型：Resource / LabelTemplate / ResourceLabel /            │
│  CITypeExporterMapping / ScrapeJob / MonitoringRule /            │
│  NetworkDomain / ConfigDraft / ConfigVersion                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Phase 1 监控对象管理（Module_07）                │
│  Resource CRUD · Excel 导入 · LabelTemplate · 状态映射 ·         │
│  ResourceLabel                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│       Phase 2.1 监控策略与指标管理（Module_01）                    │
│  CI↔Exporter 绑定 · ScrapeJob · 实例选择 · 规则编辑 UI            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│       Phase 2.2 网域与边缘配置中心（Module_09）                    │
│  NetworkDomain · 配置生成 · 草稿预览 · 人工确认 · 下发 reload     │
│  external_labels 注入 · Edge Agent 状态列表                      │
└─────────────────────────────────────────────────────────────────┘
              │               │
              ▼               ▼
   Phase 3 查询中心      Phase 4 告警生命周期
   Module_02            Module_08
   （带租户/网域注入的    （分组/静默/Alertmanager/告警状态）
    Prometheus Query
    API 代理 + 目标状态）
              │               │
              └───────┬───────┘
                      ▼
           Phase 5 前端门户集成（Module_05）
```

### 3.1 关键依赖说明

| 依赖方 | 被依赖方 | 说明 |
|--------|----------|------|
| 监控策略（Module_01） | 资源管理（Module_07） | `ScrapeJob` 需要读取 Resource、LabelTemplate、ResourceLabel |
| 配置中心（Module_09） | 资源管理、监控策略 | 组装 `prometheus.yml` / `rules.yml` 需要 Module_07 与 Module_01 的数据 |
| 查询中心（Module_02） | 配置中心（Module_09） | 需要 Module_09 已生成配置且中心 Prometheus 正在抓取，才能展示目标状态与指标；Module_02 代理时注入的 `network_domain` / `tenant_id` 标签依赖 Module_09 的 `external_labels` 注入 |
| 告警生命周期（Module_08） | 监控策略、配置中心 | 消费 Module_01 产出的规则记录，经配置中心下发，并通过查询中心展示告警状态 |
| 前端门户 | 全部后端 API | 最后统一集成 |

---

## 4. 分阶段实施计划

### Phase 0：基础设施与共享数据模型（第 1 周）

**对应模块分支**：`feature/module-00-infrastructure`

**目标**：建立后端项目结构、数据库访问、统一 API 响应，并冻结 MVP 核心共享模型。

**Agent 分工**：
- `planner`：规划数据库选型、模型结构、API 响应格式
- `backend-developer`：实现数据库、模型、统一响应、健康检查
- `frontend-developer`：建立前端目录结构与 API client 雏形
- `golang-reviewer`：审查后端基础设施代码

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 数据库初始化 | `platform/db/db.go` | SQLite 连接、迁移框架（gorm 或 sqlx） | 服务启动自动建表 |
| 统一模型层 | `platform/models/` | 共享模型：`Resource`、`ResourceLabel`、`LabelTemplate`、`NetworkDomain`、`CITypeExporterMapping`、`ExporterTemplate`、`ScrapeJob`、`MonitoringRule`、`ConfigDraft`、`ConfigVersion`、`ConfigDeployment`、`EdgeAgent` | 模型与 Module_01/07/09 PRD 一致 |
| 统一 API 响应 | `platform/api/response/` | JSON 统一封装、错误码；包含 `errorType` 枚举 | 所有 API 返回统一格式 |
| 健康检查增强 | `platform/cmd/metric-center/main.go` | 增加 `/api/v1/health/db` 检查 DB | 能检测 DB 连通性 |
| 前端项目结构调整 | `ui-custom/web/src/api/`、`ui-custom/web/src/types/` | 建立 API 客户端与类型定义目录 | 目录规范确定 |

**风险点**：
- ORM 选型未完全确定，建议 MVP 用 GORM + SQLite，后续切 PostgreSQL 成本低。
- 模型字段一旦确定，Excel 模板、标签模板、策略绑定表会强依赖，需在本阶段冻结最小字段集。

---

### Phase 1：监控对象管理（第 1 ~ 2 周）

**对应模块分支**：`feature/module-07-resource-management`

**目标**：实现四类资源的最小化 CRUD、Excel 导入、`ResourceLabel` 基础 CRUD、状态映射、LabelTemplate 管理，并在 Resource 列表预留「已监控 / 未监控」badge 展示字段。

> 本阶段对应 [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md)。`ScrapeJob`、配置生成、配置下发已不在本模块范围内。

**Agent 分工**：
- `planner`：输出资源 API、Excel 模板、校验规则、`ResourceLabel` / `LabelTemplate` 数据契约的详细规划
- `backend-developer`：实现资源 CRUD、Excel 导入、`ResourceLabel` API、LabelTemplate API、状态映射后端
- `frontend-developer`：实现资源管理页面（列表、导入弹窗、资源详情 Label 编辑）与标签模板页面
- `golang-reviewer`：审查后端 API、Excel 解析、Label 校验逻辑
- `frontend-reviewer`：审查前端资源页面与标签模板页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 资源 API | `platform/config/resource/` | Host / Middleware / Application / GenericTarget 的 CRUD | 可通过 HTTP 增删改查 |
| Excel 导入 | `platform/config/resource/excel.go` | 固定列模板解析、校验、批量写入；含可选 `network_domain_id` 与 `cmdb_*` 预留列 | 导入 100 条数据，错误行返回准确 |
| Excel 模板下载 | `platform/config/resource/template.go` | 按资源类型生成 CSV/Excel 模板 | 前端可下载模板 |
| 状态映射 | `platform/config/resource/status_mapping.go` | Excel/CMDB 状态 → `Resource.status` 默认 + 可配置规则 | 中文状态正确映射 |
| ResourceLabel API | `platform/config/resource/label.go` | Label CRUD；key 合规校验；来源 `system` / `user` | 可增删改查，冲突可检测 |
| 标签模板 API | `platform/config/label/` | 按资源类型管理字段 → Label 映射；字段来源 `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}` | 增删改查可用 |
| system label 生成器 | `platform/config/label/generator.go` | 根据模板为资源生成 `source=system` 的 `ResourceLabel` | 修改模板后 label 同步更新 |
| 已监控/未监控 badge 字段 | `platform/config/resource/monitored_badge.go` | 提供 `is_monitored` 只读展示字段（数据由 Module_01 维护关联关系） | Resource 列表可展示 badge |
| 前端资源管理页 | `ui-custom/web/src/pages/resources/` | 四类资源列表、导入弹窗、资源详情 Label 编辑与冲突提示 | 可导入并展示资源；Label key 冲突有提示 |
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
GET    /api/v2/platform/status-mapping/test?source=运行中&type=host
GET/POST    /api/v2/platform/label-templates
PUT/DELETE  /api/v2/platform/label-templates/:id
POST        /api/v2/platform/label-templates/:id/apply
```

**依赖**：Phase 0

---

### Phase 2：监控策略与配置中心（第 2 ~ 4 周）

本 Phase 合并 [Module_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md) 与 [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)。两个模块可以按顺序落地（推荐：先 Module_01，后 Module_09），也可以在接口契约冻结后部分并行开发。Module_09 的配置生成强依赖 Module_01 的 `ScrapeJob` / `MonitoringRule`，因此配置生成器必须在 Module_01 数据模型稳定后才能完整联调。

#### Phase 2.1：监控策略与指标管理（第 2 ~ 3 周）

**对应模块分支**：`feature/module-01-strategy`

**目标**：实现监控策略配置层，包括 CI 类型 ↔ Exporter 模板绑定、`ScrapeJob`、实例选择、Exporter 安装确认、规则编辑 UI、静态指标库。

> **边界说明**：
> - `ScrapeJob` 由 Module_01 持有并编辑，不再由 Module_07 承载。
> - Blackbox 拨测配置作为监控策略的一部分，由 Module_01 编辑。
> - 配置生成 / 预览 / 下发由 Module_09 负责；运行时目标状态展示由 Module_02 吸收。

**Agent 分工**：
- `planner`：明确 CI↔Exporter 绑定、`ScrapeJob`、实例选择、规则编辑的数据契约与 API
- `backend-developer`：实现策略 API、目标筛选、规则校验、静态指标库初始化
- `frontend-developer`：实现策略配置页面（CI 绑定、Job、实例选择、规则编辑）
- `golang-reviewer`：审查策略后端逻辑
- `frontend-reviewer`：审查策略前端页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| CI↔Exporter 模板绑定 API | `platform/strategy/ci-exporter/` | 按 `resource_type` 维护默认 Exporter、端口、metrics_path、scheme、scrape_interval、scrape_timeout | 常见 CI 类型（host/mysql/redis）可绑定 |
| Exporter 模板 API | `platform/strategy/exporter-template/` | ExporterTemplate CRUD、内置模板初始化 | node-exporter、mysqld-exporter、redis-exporter 模板可展示 |
| ScrapeJob API | `platform/strategy/scrapejob/` | Job CRUD、关联 CI↔Exporter 绑定、标签模板引用、实例选择模式 | 可创建 Job 并预览匹配资源 |
| 实例选择 | `platform/strategy/scrapejob/selection.go` | MVP 手动勾选 `Resource`；v0.3+ 支持按网域/环境/应用/标签筛选 | 勾选结果持久化到 `selected_instance_ids` |
| Exporter 安装/注册确认 | `platform/strategy/scrapejob/installation.go` | 标记 Resource/Target 的 Exporter 安装状态 | 未确认实例不生成 target |
| 拨测配置 API | `platform/strategy/probe/` | Blackbox probe 模板与拨测目标配置 | 可关联应用服务资源的 `health_check_url` |
| 规则编辑 API | `platform/strategy/rule/` | 告警/记录规则类 YAML 表单 CRUD；调用 Module_02 进行 PromQL 校验 | 规则记录可创建并校验 |
| 指标静态库 | `platform/strategy/metric-library/` | 内置常见 Exporter 指标（node/mysql/redis），规则编辑时提供提示 | 规则编辑可提示指标名与标签 |
| 前端策略配置页 | `ui-custom/web/src/pages/strategy/` | CI 绑定、ScrapeJob、实例选择、规则编辑、拨测配置页面 | 可完成策略配置闭环 |

**接口预览**：

```http
# CI 类型 ↔ Exporter 模板绑定
GET/POST    /api/v2/platform/ci-exporter-mappings
PUT/DELETE  /api/v2/platform/ci-exporter-mappings/:id

# Exporter 模板
GET/POST    /api/v2/platform/exporter-templates
PUT/DELETE  /api/v2/platform/exporter-templates/:id

# ScrapeJob
GET/POST    /api/v2/platform/scrape-jobs
PUT/DELETE  /api/v2/platform/scrape-jobs/:id
POST        /api/v2/platform/scrape-jobs/:id/preview-targets
POST        /api/v2/platform/scrape-jobs/:id/confirm-instances

# Exporter 安装确认
GET         /api/v2/platform/resources/:id/exporter-installation
PUT         /api/v2/platform/resources/:id/exporter-installation

# 拨测配置
GET/POST    /api/v2/platform/probe-configs
PUT/DELETE  /api/v2/platform/probe-configs/:id

# 规则编辑
GET/POST    /api/v2/platform/monitoring-rules
PUT/DELETE  /api/v2/platform/monitoring-rules/:id
POST        /api/v2/platform/monitoring-rules/:id/validate

# 指标库
GET         /api/v2/platform/exporter-metrics?exporter_template_id=
```

**依赖**：Phase 1

---

#### Phase 2.2：网域与边缘配置中心（第 3 ~ 4 周）

**对应模块分支**：`feature/module-09-config-center`

**目标**：实现配置生成 / 预览 / 下发能力，落地 `NetworkDomain` 默认网域，并注入 `external_labels.network_domain` / `external_labels.tenant_id`。

> **边界说明**：
> - Module_09 读取 Module_01 的 `ScrapeJob` / `MonitoringRule` 与 Module_07 的 `Resource` / `LabelTemplate`，轮询生成配置草稿。
> - 配置草稿需人工确认后再生成 `ConfigVersion` 并触发下发，防止平台 bug 导致监控整体失效。
> - MVP 阶段诊断看板降级为 **Agent 状态列表页**（在线状态、最后心跳、配置版本、WAL 积压、最近错误），图表/趋势看板放 P1/P2。

**Agent 分工**：
- `planner`：规划配置生成器输入/输出、下发方式、校验策略、NetworkDomain 数据契约
- `backend-developer`：实现配置生成、校验、下发、历史记录、NetworkDomain / EdgeAgent 基础 API
- `prometheus-developer`：评估是否需要 Prometheus 扩展；MVP 阶段通常只需生成配置，不修改源码
- `frontend-developer`：实现配置预览 / diff / 下发页面、网域管理页面、Agent 状态列表页
- `golang-reviewer`：审查配置生成与下发逻辑
- `security-reviewer`：审查配置下发安全性（文件写入、reload 触发权限、Token 鉴权）

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| NetworkDomain API | `platform/configcenter/domain/` | 网域 CRUD、默认网域 `default` 初始化、Token 生成/重置 | MVP 单网域无感知 |
| EdgeAgent 基础 API | `platform/configcenter/edge/` | Agent 注册、心跳接收、状态展示 | 心跳可更新在线状态 |
| 配置生成器 | `platform/configcenter/generator/` | 按网域组装 `prometheus.yml`（scrape_configs + external_labels）与 `rules.yml` | 生成 YAML 与 PRD 示例一致 |
| Label 合并器 | `platform/configcenter/generator/labels.go` | 合并 `system` / `user` / `cmdb {v0.4+}` label，优先级 `cmdb` > `user` > `system` | 冲突时按优先级合并 |
| 配置校验 | `platform/configcenter/generator/validate.go` | 调用 `promtool check config` | 错误配置能被拦截 |
| 配置草稿与预览 | `platform/configcenter/draft/` | 生成 `ConfigDraft`、YAML 预览、与当前版本 diff、人工确认/废弃 | UI 可预览并确认 |
| 配置下发 | `platform/configcenter/deployment/` | 确认后生成 `ConfigVersion`，触发中心 Prometheus reload | Prometheus 成功 reload |
| 下发历史 | `platform/configcenter/deployment/history.go` | 记录每次下发内容与结果 | 有历史记录表 |
| 配置包拉取接口 | `platform/configcenter/edge/pull.go` | Edge Sync Agent 通过 Token 拉取本域配置包 | 返回 zip 包与 304 |
| Agent 状态列表页 | `ui-custom/web/src/pages/config-center/agents/` | 分页表格展示各网域 Agent 在线状态、最后心跳、配置版本、WAL 积压、最近错误 | 可查看 Agent 状态 |
| 前端配置中心页 | `ui-custom/web/src/pages/config-center/` | 网域管理、草稿列表、配置预览/diff、一键下发、下发历史 | 可下发后看到 targets 更新 |

**接口预览**：

```http
# 网域管理
GET/POST    /api/v2/platform/network-domains
PUT/DELETE  /api/v2/platform/network-domains/:id
POST        /api/v2/platform/network-domains/:id/reset-token
GET         /api/v2/platform/network-domains/:id/edge-agents

# 配置草稿 / 预览 / 确认
GET/POST    /api/v2/platform/config/drafts
POST        /api/v2/platform/config/drafts/:id/confirm
POST        /api/v2/platform/config/drafts/:id/discard
GET         /api/v2/platform/config/preview?draft_id=

# 配置下发与历史
POST        /api/v2/platform/config/apply
GET         /api/v2/platform/config/history

# Edge Sync Agent 协议
POST        /api/v2/platform/edge/heartbeat
GET         /api/v2/platform/edge/config?network_domain=
```

**依赖**：Phase 2.1、本地 Prometheus 进程可运行

**风险点**：
- 本地开发需要能启动 Prometheus 并加载生成的配置，需同步准备 `deploy/` 启动脚本和示例配置。
- 配置生成是 MVP 核心，需重点测试标签模板与 relabel 的正确性。
- 配置中心引入人工确认步骤，需保证 UI diff 清晰，避免工程师误操作。

---

### Phase 3：查询中心（含目标状态展示）（第 4 周）

**对应模块分支**：`feature/module-02-query-center`

**目标**：提供统一的 Prometheus Query API 代理入口，在转发时自动注入租户/网域上下文以保证多租户隔离，并返回带数据来源与新鲜度 envelope 的响应；同时吸收原 Module_01 的运行时目标状态展示职责（目标列表、拨测结果、采集诊断）。

> 本阶段对应 [Module_02: 查询中心](Module_02_Query_Center.md)。原 `feature/module-01-collection-status` 分支取消，目标状态展示合并到本阶段。
>
> **注入行为**：Module_02 不是透明代理。转发前自动注入 `tenant_id` 与用户有权限的全部 `network_domain_id`；单网域场景对用户无感知，多网域场景默认查询全部授权网域，用户仍可在 PromQL 中手动进一步过滤。系统注入 = 权限隔离，用户过滤 = 业务筛选。

**Agent 分工**：
- `planner`：明确查询代理接口、注入规则、envelope 元数据、目标状态展示、拨测结果查询的需求
- `backend-developer`：实现 Query 代理、targets 代理、alerts 代理、元数据代理、拨测结果查询
- `frontend-developer`：实现 PromQL 查询页面与目标状态页面
- `golang-reviewer`：审查代理、注入与 envelope 逻辑
- `frontend-reviewer`：审查查询/目标状态页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| Query 代理 API | `platform/query/proxy.go` 或 `platform/gateway/proxy/query.go` | 代理 `/api/v1/query`、`/api/v1/query_range`、labels、series；自动注入 `tenant_id` 与有权限的 `network_domain_id` | 返回与 Prometheus 兼容且带 envelope 的响应 |
| 指标元数据缓存 | `platform/query/metadata.go` | 代理 `/api/v1/metadata`、`/api/v1/labels` | 补全可用 |
| Targets 代理 API | `platform/query/targets.go` | 代理 `/api/v1/targets` | 返回目标列表、状态、错误信息 |
| Alerts 代理 API | `platform/query/alerts.go` | 代理 Prometheus `/api/v1/alerts`；Alertmanager 通知状态不归本模块 | 返回当前 firing/pending 告警实例 |
| 目标状态聚合 | `platform/query/target-status.go` | 按 Job / env / app 聚合 | 筛选与统计可用 |
| 拨测结果查询 | `platform/query/probe.go` | 代理 PromQL `probe_success`、`probe_duration` | 可展示拨测结果 |
| 查询辅助 | `platform/query/autocomplete.go` | 指标名/Label 建议 | 前端可联想 |
| 响应 envelope | `platform/query/envelope.go` | 统一包裹 Prometheus 响应，附加 `meta.data_source` / `meta.freshness_at` / `meta.network_domain` | 不污染 series 标签 |
| 前端查询页 | `ui-custom/web/src/pages/query/` | PromQL 编辑器、结果表格/JSON、目标状态、拨测结果、数据来源提示 | 可执行查询并查看目标状态 |

**接口预览**：

```http
# 以下接口均代理 Prometheus Query API，Module_02 自动注入 tenant_id / network_domain_id，
# 并在原始响应外层包裹 envelope 元数据（data_source / freshness_at / network_domain）。
POST /api/v1/query
POST /api/v1/query_range
GET  /api/v1/labels
GET  /api/v1/label/:name/values
GET  /api/v1/series
GET  /api/v1/targets
GET  /api/v1/targets/:id
GET  /api/v1/alerts
GET  /api/v1/probe-results
```

**依赖**：Phase 2.2（需要 Module_09 已生成配置且中心 Prometheus 正在抓取）

**风险点**：
- PromQL 注入逻辑复杂（标签选择器拼接、与现有选择器合并、正则匹配多网域），需充分单元测试并覆盖边界情况。
- 响应 envelope 元数据可能带来性能开销（especially freshness_at 需要跨 series 计算最新时间戳），需在接入层做缓存或异步采样。
- Module_02 不存在跨租户全局管理员 bypass 逻辑，平台管理员按租户维度管理；如后续需求变化，需同步调整 Module_06 与注入逻辑。

---

### Phase 4：告警生命周期管理（第 5 周）

**对应模块分支**：`feature/module-08-alerting-lifecycle`

**目标**：管理告警规则生命周期（规则分组、启用/禁用、静默、Alertmanager 配置），并通过查询中心展示告警状态。

> 本阶段对应 [Module_08: 告警规则管理](Module_08_Alerting_Rule_Management.md)。规则编辑 UI 在 Module_01 中实现，Module_08 负责消费规则记录并完成后续生命周期管理。
>
> **边界说明**：Module_02 仅代理 Prometheus `/api/v1/alerts` 返回当前触发/待处理告警实例；Alertmanager 的通知状态（分组、静默、抑制、接收人）由 Module_08 负责。

**Agent 分工**：
- `planner`：明确告警规则分组、静默、Alertmanager 配置生成、告警状态展示的需求
- `backend-developer`：实现规则组、静默、Alertmanager 配置生成、`/api/v1/alerts` 代理（可复用 Module_02 代理能力）
- `frontend-developer`：实现告警规则组、静默、Alertmanager 配置与告警状态页面
- `golang-reviewer`：审查告警生命周期逻辑
- `frontend-reviewer`：审查告警页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 规则组 API | `platform/alerting/group.go` | 按网域/规则组聚合 Module_01 产出的规则记录 | 可创建/编辑规则组 |
| 规则生命周期 API | `platform/alerting/rule.go` | 规则启用/禁用、版本管理、按网域聚合 | 规则状态可控 |
| 静默管理 API | `platform/alerting/silence.go` | 调用 Alertmanager API 创建/删除静默规则 | 静默规则生效 |
| Alertmanager 配置生成 | `platform/alerting/alertmanager.go` | 基于通知渠道模板生成 `alertmanager.yml` | 配置可被 Alertmanager 加载 |
| 告警抑制规则生成 | `platform/alerting/inhibit.go` | 网域离线时自动生成 `inhibit_rules` | `EdgeSiteOffline` 可抑制可达性告警 |
| Alerts 代理 API | `platform/alerting/alerts.go`（可调用 `platform/query/`） | 代理 `/api/v1/alerts` | 返回当前告警 |
| rules.yml 示例 | `deploy/rules.yml` | 提供 MVP 示例规则 | Prometheus 加载后可触发测试告警 |
| 前端告警页 | `ui-custom/web/src/pages/alerts/` | 告警状态、规则组、静默、Alertmanager 配置页面 | 可查看当前告警并管理规则组 |

**接口预览**：

```http
GET         /api/v1/alerts
GET/POST    /api/v2/platform/alerting/groups
PUT/DELETE  /api/v2/platform/alerting/groups/:id
GET/POST    /api/v2/platform/alerting/silences
PUT/DELETE  /api/v2/platform/alerting/silences/:id
GET/POST    /api/v2/platform/alerting/alertmanager-config
GET         /api/v2/platform/alerting/rules
PUT         /api/v2/platform/alerting/rules/:id/enable
PUT         /api/v2/platform/alerting/rules/:id/disable
```

**依赖**：Phase 2.1、Phase 2.2

---

### Phase 5：前端门户集成与 MVP 验收（第 5 ~ 6 周）

**对应模块分支**：`feature/module-05-portal`

**目标**：把各页面串成完整门户，补齐导航、首页、错误处理，并完成端到端验收。

**Agent 分工**：
- `planner`：规划门户布局、导航结构、首页 Dashboard 内容
- `frontend-developer`：实现统一布局、导航、首页、错误处理
- `backend-developer`：配合提供首页所需聚合数据 API
- `frontend-reviewer`：审查门户集成代码
- `build-resolver`：解决端到端验证中出现的构建/测试问题

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 统一布局 | `ui-custom/web/src/layouts/` | 侧边栏导航、顶部状态 | 页面切换流畅 |
| 首页 Dashboard | `ui-custom/web/src/pages/home/` | 资源数量、采集覆盖率、最近告警、待确认配置草稿 | 数据真实 |
| 错误与加载状态 | `ui-custom/web/src/components/` | 统一 Loading / Error | 用户体验一致 |
| 端到端测试 | `tests/e2e/` 或手工 | 资源导入 → 策略配置 → 配置生成 → 下发 → 查询 → 告警查看 | 主链路跑通 |
| 文档更新 | `README.md`、部署文档 | 补充启动步骤 | 新成员可按文档跑起来 |

**依赖**：Phase 1 ~ 4

---

## 5. 前后端入口与目录约定

### 5.1 后端目录

```
platform/
  cmd/metric-center/          # 主程序入口
  config/                     # Module_07 监控对象管理
    resource/                 # 资源管理（含 Excel 导入、状态映射、ResourceLabel CRUD）
    label/                    # 标签模板 + system label 生成
  strategy/                   # Module_01 监控策略与指标管理
    ci-exporter/              # CI 类型 ↔ Exporter 模板绑定
    exporter-template/        # Exporter 模板管理
    scrapejob/                # ScrapeJob 与实例选择
    probe/                    # 拨测配置
    rule/                     # 规则编辑 UI 后端
    metric-library/           # 静态指标库
  configcenter/               # Module_09 网域与边缘配置中心
    domain/                   # NetworkDomain 生命周期
    edge/                     # Edge Agent 注册、心跳、配置拉取
    generator/                # 配置生成、校验、Label 合并
    draft/                    # 配置草稿与预览
    deployment/               # 配置下发、reload、历史记录
  query/                      # Module_02 查询中心
    proxy.go                  # Prometheus Query API 代理（含 tenant/network_domain 注入）
    envelope.go               # 响应 envelope 元数据
    metadata.go               # 指标/标签元数据代理
    targets.go                # /api/v1/targets 代理与目标状态聚合
    alerts.go                 # /api/v1/alerts 代理
    probe.go                  # 拨测结果查询
    autocomplete.go           # 指标名/Label 建议
  gateway/                    # 统一网关（Module_03 未来扩展）
    proxy/                    # 通用代理中间件（查询/告警/targets 代理优先放 platform/query/）
    auth/                     # 认证（未来）
    tenant/                   # 多租户（未来）
  models/                     # 数据模型
  db/                         # 数据库连接与迁移
  api/response/               # 统一响应（含 errorType 枚举）
  examples/simple-agent/      # simple-agent 模板
```

### 5.2 前端目录

```
ui-custom/web/
  src/
    api/                      # API 客户端
    types/                    # TypeScript 类型
    pages/
      resources/              # 资源管理（Module_07）
      label-templates/        # 标签模板（Module_07）
      strategy/               # 监控策略（Module_01）
        ci-exporter/
        scrape-jobs/
        rules/
        probe-configs/
      config-center/          # 网域与配置中心（Module_09）
        domains/
        drafts/
        preview/
        history/
        agents/               # Agent 状态列表页
      query/                  # 指标查询 + 目标状态（Module_02）
      alerts/                 # 告警生命周期（Module_08）
      home/                   # 首页
    components/               # 通用组件
    layouts/                  # 布局
```

---

## 6. 开发顺序与并行建议

### 6.1 顺序约束

```
Phase 0 → Phase 1 → Phase 2.1 → Phase 2.2
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                 Phase 3   Phase 4   （并行可开始）
                    │         │
                    └────┬────┘
                         ▼
                      Phase 5
```

### 6.2 可并行任务

| 阶段 | 可并行项 |
|------|----------|
| Phase 1 | 后端资源 API、LabelTemplate API 与前端资源页面、标签模板页面可并行 |
| Phase 2.1 | CI↔Exporter 绑定、ScrapeJob、规则编辑、拨测配置三个子能力可并行开发 |
| Phase 2.2 | 配置生成、配置预览/下发、Edge Agent 基础接口、Agent 状态列表页可并行 |
| Phase 2.1 与 2.2 | 在接口契约冻结后，Module_09 的 NetworkDomain / EdgeAgent 基础 API 可与 Module_01 部分并行；配置生成器必须等 Module_01 数据模型稳定 |
| Phase 3 ~ 4 | 查询中心与告警生命周期可并行（均依赖 Phase 2.2） |
| Phase 5 | 前端集成与后端收尾可并行 |

### 6.3 Agent 驱动的开发节奏

> 以下按 **1 个 Orchestrator + 1 个 backend-developer + 1 个 frontend-developer** 的节奏编排。每个 Phase 内，Backend 与 Frontend 可在不同 worktree 中并行。

| 周次 | Orchestrator 动作 | backend-developer | frontend-developer | reviewer |
|------|-------------------|-------------------|--------------------|----------|
| 1 | 调用 planner 规划 Phase 0~1；创建 2 个 worktree | Phase 0：基础设施 + Phase 1 API | Phase 0：前端结构 + Phase 1 页面框架 | golang-reviewer 审查后端基础设施 |
| 2 | 汇总 Phase 1 结果；规划 Phase 2.1 | Phase 1 收尾 + Phase 2.1 策略后端 | Phase 1 页面完成 + Phase 2.1 策略页面 | frontend-reviewer 审查资源/策略页面 |
| 3 | 规划 Phase 2.2；协调前后端契约 | Phase 2.1 收尾 + Phase 2.2 配置中心 | Phase 2.1 策略页面完成 + Phase 2.2 配置预览页 | golang-reviewer 审查配置逻辑 |
| 4 | 规划 Phase 3；本地 Prometheus 联调 | Phase 2.2 收尾 + Phase 3 查询/目标状态 | Phase 2.2 配置预览/下发/Agent 状态页 + Phase 3 查询/目标状态页 | security-reviewer 审查配置下发 |
| 5 | 规划 Phase 4/5 | Phase 4 告警生命周期 | Phase 4 告警页面 + Phase 5 门户集成 | frontend-reviewer 审查查询/告警/门户页面 |
| 6 | Phase 5 收尾；端到端验收 | 配合首页聚合数据 API | Phase 5 门户集成、首页、E2E 验证 | build-resolver 处理构建问题；双 reviewer 最终审查 |

> **关键**：Orchestrator 必须在每个 Phase 开始前调用 `planner`，并在 Developer 完成后立即调用 Reviewer，形成“规划 → 开发 → 审查 → 修复 → 合并”的闭环。

---

## 7. MVP 验收清单

- [ ] 可导入主机、中间件、应用服务、通用指标目标四类资源；Excel 状态正确映射到 `Resource.status`
- [ ] 资源列表以 `instance_name` / `hostname` 作为可读名展示，并展示「已监控 / 未监控」badge
- [ ] 可维护 `ResourceLabel`（`system` / `user` 来源），key 校验与冲突提示生效
- [ ] 可维护标签模板，修改模板后 `source=system` 的 ResourceLabel 同步更新
- [ ] 可为常见 CI 类型建立/编辑 CI 类型 ↔ Exporter 模板绑定
- [ ] 可创建/编辑 `ScrapeJob`，并手动勾选实例；勾选结果持久化
- [ ] 可标记 Resource 的 Exporter 安装/注册状态，未确认实例不生成 target
- [ ] 可维护 Blackbox 拨测配置
- [ ] 规则编辑 UI 支持类 YAML 表单（expr / for / labels / annotations），调用查询中心进行 PromQL 校验
- [ ] MVP 内置常见 Exporter 的静态指标库，规则编辑时可提示指标名与标签
- [ ] 配置中心可按网域生成 `prometheus.yml` 草稿，经人工确认后下发并 reload 中心 Prometheus
- [ ] 配置中心的 `prometheus.yml` 已正确注入 `external_labels.network_domain` 与 `external_labels.tenant_id`
- [ ] 下发记录可查询成功/失败历史与失败原因
- [ ] 可通过查询中心执行 PromQL 查询并查看结果；未授权租户/网域的数据不可见
- [ ] 查询响应包含 envelope 元数据：`data_source`、`freshness_at`、`network_domain`
- [ ] 可通过查询中心查看采集目标状态（up/down）与拨测结果
- [ ] 可查看当前告警状态（由 Module_02 代理 Prometheus `/api/v1/alerts`）
- [ ] Module_08 可按规则组与网域聚合生成 `rules.yml`，并生成 `alertmanager.yml`
- [ ] 前端门户各页面连通，主链路端到端可用

---

## 8. 风险与规避

| 风险 | 影响 | 规避措施 |
|------|------|----------|
| Module_07 / Module_01 / Module_09 边界混淆 | 代码耦合、职责重复 | Phase 0 冻结对象/策略/下发的数据契约；Phase 1/2 分别输出边界说明文档 |
| 标签模板生成 relabel 错误 | 配置下发后 targets 标签不对 | Phase 2.2 增加 promtool 校验 + 单元测试 |
| ResourceLabel 合并优先级错误 | CMDB/user/system 覆盖关系不符合预期 | Phase 1 明确 `cmdb` > `user` > `system` 规则并写单元测试覆盖 |
| Excel 状态映射遗漏 | 客户状态值无法导入 | Phase 1 提供默认映射 + 可配置规则；导入失败行明确返回 |
| 静态 Exporter 指标库过时 | 规则编辑时的指标提示误导用户 | 指标库按 Exporter 版本维护；MVP 内置常见版本，P1 提供管理入口 |
| 手动勾选实例导致监控覆盖延迟 | 新增资源长期处于未监控状态 | Resource 列表 badge 提示；流程上要求新实例录入后进入策略模块确认 |
| 本地手工兜底可能造成配置漂移 | DB 期望态与磁盘实际态不一致 | 允许本地兜底但 UI 标识 `manual_override`；工程师需重新确认下发以恢复一致性 |
| 配置中心草稿确认流程增加操作成本 | 配置变更延迟生效 | UI 提供清晰 diff 与一键确认；默认网域场景简化流程 |
| Module_01 与 Module_08 规则边界不清 | 规则编辑与生命周期管理重复或遗漏 | 明确 Module_01 产出规则记录，Module_08 负责分组/启用/禁用/下发 |
| 本地 Prometheus 启动困难 | 阻塞 Phase 2.2 ~ Phase 4 | 第 1 周就准备 `deploy/` 启动脚本和示例配置 |
| Excel 字段后期变更 | 导致导入逻辑和模板返工 | Phase 1 冻结最小字段集，后续只增不改 |
| 前端等待后端 API | 串行阻塞 | Planner 在规划中明确 API 契约，Frontend Developer 使用 mock 数据并行开发 |
| 多 Agent 同时修改冲突 | 代码冲突、worktree 污染 | 采用单一 worktree，Agent 顺序进入；前后端按 `platform/` 与 `ui-custom/` 目录天然隔离 |
| Agent 误解需求 | 实现偏离 | 每个 Phase 开始前必须调用 `planner` 输出规划，并引用相关 PRD 文件 |
| Reviewer 与 Developer 标准不一致 | 反复修改 | Orchestrator 在启动时统一注入 `.kimi/skills/golang-coding-style` 和 `web-development` 规范 |
| Prometheus 源码被误改 | 未来升级困难 | 涉及源码时必须走 `prometheus-developer`，生成 patch 文件 |
| Worktree 残留 | 磁盘占用、分支混乱 | 采用单一 worktree 复用，MVP 完成后再清理；禁止为每个 Phase 新建 worktree |
| PromQL 注入逻辑复杂 | 多网域正则选择器拼接、与已有选择器合并、标签名一致性容易出错 | Phase 3 对注入逻辑写充分单元测试；明确 label key 由 Module_09 `external_labels` 生成 |
| 响应 envelope 元数据性能开销 | 跨 series 计算 `freshness_at` 可能增加查询延迟 | 接入层做缓存或异步采样；P1 评估按需关闭 envelope |
| 不存在跨租户全局管理员 | 若 Module_06 仍保留“平台管理员可查看所有租户”验收标准，会与 Module_02 注入逻辑冲突 | 同步复核 Module_06；MVP 按“管理员即租户内管理员”实现，无 admin bypass |

### 8.1 Orchestrator 执行一个 Phase 的 Checklist

每个 Phase 开始前，Orchestrator 应按以下清单驱动 Agent：

- [ ] 明确本 Phase 要交付的功能和验收标准
- [ ] 调用 `planner`，提供相关 PRD 和上一 Phase 的输出
- [ ] 复用单一 git worktree（在 worktree 内切换到当前模块的 `feature/module-XX-<功能名>`）
- [ ] 向 `backend-developer` / `frontend-developer` 分配任务，并注入相关 skill 上下文
- [ ] 接收 Developer 完成汇报，检查测试与 lint 结果
- [ ] 调用对应 `reviewer` 进行代码审查
- [ ] 如审查不通过，返回 Developer 修复并重新审查
- [ ] 将当前 `feature/module-XX-<功能名>` 以 `--no-ff` 合并到 `develop`（保留 worktree 供下一模块复用）
- [ ] 更新本文件中的 MVP 验收清单状态

---

## 9. 变更记录

### v3.2（2026-07-31）

- 根据 `docs/decisions/grill-2026-07-31-query-center.md` 调整 Module_02/09 边界与开发阶段：
  - Phase 2 合并为“监控策略与配置中心”，包含 Module_01（Phase 2.1）与 Module_09（Phase 2.2），可顺序或部分并行开发。
  - Phase 3 改为 Module_02 查询中心，明确其依赖 Module_09 配置生成完成且中心 Prometheus 已运行。
  - Module_07 的标签模板能力归入 Phase 1（监控对象管理）。
- 新增并明确 `feature/module-02-query-center` 分支。
- 更新模块依赖图，补充 `Module_09 → Module_02` 依赖，强调 Module_02 注入的 `network_domain` / `tenant_id` 标签来自 Module_09 的 `external_labels`。
- 更新后端目录结构，新增 `platform/query/` 作为 Module_02 查询中心主目录。
- 更新 Module_02 API 预览，说明自动注入 tenant_id / network_domain_id 行为与响应 envelope 元数据（`data_source` / `freshness_at` / `network_domain`）。
- 更新 MVP 验收清单，补充查询响应 envelope、external_labels 注入、告警代理边界等条目。
- 更新风险表，新增“PromQL 注入逻辑复杂”、“响应 envelope 元数据性能开销”、“不存在跨租户全局管理员”三项风险。
- 同步更新 Agent 节奏与前端目录，增加 Agent 状态列表页。

### v3.1（2026-07-31）

- 根据 `docs/decisions/grill-2026-07-31-monitoring-strategy-management.md` 调整模块边界：
  - [Module_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md) 承担 CI↔Exporter 绑定、`ScrapeJob`、实例选择、规则编辑 UI。
  - [Module_07: 监控对象管理](Module_07_Monitoring_Object_Management.md) 聚焦 Resource、LabelTemplate、Excel 导入、「已监控/未监控」badge。
  - [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 承担配置生成 / 预览 / 下发。
- 调整开发阶段：Phase 2 拆分为 2a（标签模板）、2b（监控策略）、2c（配置中心）。
- 取消独立的 `feature/module-01-collection-status` 分支，目标状态展示由 Module_02 吸收。
- 将 Phase 3 改为“查询中心（含目标状态展示）”，Phase 4 改为“告警生命周期管理”。
- 更新模块依赖图为 `Module_07 → Module_01 → Module_09`。
- 更新 API 预览，补充 Module_01 策略 API 与 Module_09 配置中心 API。
- 更新 MVP 验收清单与风险表，突出静态指标库、手动实例选择、本地手工兜底、Module_01/08 边界等风险。

---

## 10. 关联文档

- 实施难度分析：[04_Implementation_Map.md](04_Implementation_Map.md)
- 产品路线图：[02_Product_Roadmap.md](02_Product_Roadmap.md)
- 功能架构全景：[03_Functional_Architecture.md](03_Functional_Architecture.md)
- 模块详细需求：[Modules/README.md](Modules/README.md)
- Agent 团队定义：[.kimi/AGENTS.md](../../.kimi/AGENTS.md)
- 查询中心设计决策：[../decisions/grill-2026-07-31-query-center.md](../decisions/grill-2026-07-31-query-center.md)
