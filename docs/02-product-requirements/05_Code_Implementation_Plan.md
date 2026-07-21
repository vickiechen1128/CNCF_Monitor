# MetricCenter 代码实施计划

> 文档类型：工程实施计划  
> 依赖文档：[00_Global_Architecture.md](00_Global_Architecture.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)、[04_Implementation_Map.md](04_Implementation_Map.md)、[Modules/README.md](Modules/README.md)  
> 更新日期：2026-07-20

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
| **数据流驱动** | 按“资源 → 标签 → Job → 配置生成 → 下发 → 状态回显”主线推进 |
| **控制面与源码隔离** | 业务代码只写在 `platform/` 和 `ui-custom/`，上游源码尽量不碰 |
| **先 L1/L2，后 L3/L4** | 优先做 Prometheus 已支持、只需代理或生成配置的能力 |
| **每阶段可运行** | 每个 Phase 结束都应有一个可演示的闭环，不堆积半成品 |

### 2.2 模块优先级总览

```
Phase 0: 基础设施与数据模型
    │
Phase 1: 资源管理 + Excel 导入（Module 07）
    │
Phase 2: 标签模板 + 采集 Job + 拨测配置（Module 07 / Module 01）
    │
Phase 3: 配置生成与下发（Module 07）
    │
Phase 4: 采集状态与诊断（Module 01）
    │
Phase 5: 指标查询中心（Module 02）
    │
Phase 6: 告警状态查看（Module 08 MVP）
    │
Phase 7: 前端门户集成与 MVP 验收
```

---

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
| `security-reviewer` | 安全审查 | ❌ 只读 | Phase 3（配置下发）、Phase 6（告警通知）等关键节点 |

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
    └──► 将 feature/module-XX-<功能名> 以 --no-ff 合并到 develop
         （worktree 保留，切换到下一个模块分支继续复用）
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
| feature | `feature/module-07-resource-management` | 资源管理 | `develop` | `develop` |
| feature | `feature/module-07-label-template` | 标签模板 | `develop` | `develop` |
| feature | `feature/module-07-scrape-job` | 采集 Job | `develop` | `develop` |
| feature | `feature/module-07-probe-config` | 拨测配置 | `develop` | `develop` |
| feature | `feature/module-07-config-generator` | 配置生成/下发 | `develop` | `develop` |
| feature | `feature/module-01-collection-status` | 采集状态 | `develop` | `develop` |
| feature | `feature/module-02-query-center` | 指标查询 | `develop` | `develop` |
| feature | `feature/module-08-alerting` | 告警状态 | `develop` | `develop` |
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
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Phase 1 ~ 3 配置链路（核心）                    │
│  Module 07: 资源管理 → 标签模板 → 采集 Job → 拨测配置 → 配置生成/下发 │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       Phase 4 采集状态    Phase 5 指标查询   Phase 6 告警状态
       Module 01           Module 02          Module 08
              │               │               │
              └───────────────┴───────────────┘
                              │
                              ▼
              Phase 7 前端门户集成（Module 05）
```

### 3.1 关键依赖说明

| 依赖方 | 被依赖方 | 说明 |
|--------|----------|------|
| 标签模板 | 资源管理 | 标签映射依赖资源字段定义 |
| 采集 Job | 资源管理、标签模板 | Job 需要筛选资源和应用标签模板 |
| 拨测配置 | 应用服务资源 | 拨测目标来自 Application 表的 `health_check_url` |
| 配置生成 | 资源管理、标签模板、采集 Job、拨测配置 | 组装 `prometheus.yml` 需要全部配置输入 |
| 配置下发 | 配置生成 | 先生成配置，再触发 reload |
| 采集状态 | 配置下发 | 需要 Prometheus 已加载配置并开始抓取 |
| 指标查询 | 配置下发、Prometheus 运行 | 需要有指标数据才能查询 |
| 告警状态 | Prometheus rules.yml | 需要告警规则被 Prometheus 加载 |
| 前端门户 | 全部后端 API | 最后统一集成 |

---

## 4. 分阶段实施计划

### Phase 0：基础设施与数据模型（第 1 周）

**目标**：建立后端项目结构、数据库访问、统一 API 响应、基础模型。

**Agent 分工**：
- `planner`：规划数据库选型、模型结构、API 响应格式
- `backend-developer`：实现数据库、模型、统一响应、健康检查
- `frontend-developer`：建立前端目录结构与 API client 雏形
- `golang-reviewer`：审查后端基础设施代码

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 数据库初始化 | `platform/db/db.go` | SQLite 连接、迁移框架（gorm 或 sqlx） | 服务启动自动建表 |
| 统一模型层 | `platform/models/` | Resource、Host、Middleware、Application、LabelTemplate、ScrapeJob、BlackboxProbeConfig | 模型与 Module 07 数据模型一致 |
| 统一 API 响应 | `platform/api/response/` | JSON 统一封装、错误码 | 所有 API 返回统一格式 |
| 健康检查增强 | `platform/cmd/metric-center/main.go` | 增加 /api/v1/health/db 检查 DB | 能检测 DB 连通性 |
| 前端项目结构调整 | `ui-custom/web/src/api/`、`ui-custom/web/src/types/` | 建立 API 客户端与类型定义目录 | 目录规范确定 |

**风险点**：
- ORM 选型未完全确定，建议 MVP 用 GORM + SQLite，后续切 PostgreSQL 成本低。
- 模型字段一旦确定，Excel 模板和标签模板会强依赖，需在本阶段冻结最小字段集。

---

### Phase 1：资源管理 + Excel 导入（第 1 ~ 2 周）

**目标**：实现三类资源的最小化 CRUD 与 Excel 导入。

**Agent 分工**：
- `planner`：输出资源 API、Excel 模板、校验规则的详细规划
- `backend-developer`：实现资源 CRUD 与 Excel 导入后端
- `frontend-developer`：实现资源管理页面（列表、导入弹窗）
- `golang-reviewer`：审查后端 API 与 Excel 解析逻辑
- `frontend-reviewer`：审查前端资源页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 资源 API | `platform/config/resource/` | Host / Middleware / Application 的 CRUD | 可通过 HTTP 增删改查 |
| Excel 导入 | `platform/config/resource/excel.go` | 固定列模板解析、校验、批量写入 | 导入 100 条数据，错误行返回准确 |
| Excel 模板下载 | `platform/config/resource/template.go` | 按资源类型生成 CSV/Excel 模板 | 前端可下载模板 |
| 前端资源管理页 | `ui-custom/web/src/pages/resources/` | 三类资源列表、导入弹窗 | 可导入并展示资源 |

**接口预览**：

```http
GET    /api/v1/resources?type=host
POST   /api/v1/resources
PUT    /api/v1/resources/:id
DELETE /api/v1/resources/:id
POST   /api/v1/resources/:type/import
GET    /api/v1/resources/:type/template
```

**依赖**：Phase 0

---

### Phase 2：标签模板 + 采集 Job + 拨测配置（第 2 ~ 3 周）

**目标**：实现指标管理相关配置的编辑能力。

**Agent 分工**：
- `planner`：明确标签模板、Job、拨测配置的数据契约与 API 设计
- `backend-developer`：实现标签模板、Job、拨测配置 API
- `frontend-developer`：实现配置页面（标签/Job/拨测）
- `golang-reviewer`：审查配置相关后端逻辑
- `frontend-reviewer`：审查配置页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 标签模板 API | `platform/config/label/` | 按资源类型管理字段 → Label 映射 | 增删改查可用 |
| 采集 Job API | `platform/config/job/` | Job CRUD、筛选规则、标签模板关联 | 可创建 Job 并预览匹配资源 |
| 目标筛选 | `platform/config/job/filter.go` | 按资源字段筛选，返回匹配目标 | 筛选结果与资源表一致 |
| 拨测配置 API | `platform/config/probe/` | Blackbox 拨测目标与模块配置 | 可关联应用服务资源 |
| 采集模板 | `platform/config/template/` | 预置模板数据初始化 | node-exporter、mysqld-exporter、simple-agent、blackbox 模板可展示 |
| 前端配置页 | `ui-custom/web/src/pages/config/` | 标签模板、采集 Job、拨测配置页面 | 可完成配置 CRUD |

**接口预览**：

```http
GET/POST    /api/v1/label-templates
PUT/DELETE  /api/v1/label-templates/:id
GET/POST    /api/v1/scrape-jobs
PUT/DELETE  /api/v1/scrape-jobs/:id
POST        /api/v1/scrape-jobs/:id/preview-targets
GET/POST    /api/v1/probe-configs
GET/POST    /api/v1/scrape-templates
```

**依赖**：Phase 1

---

### Phase 3：配置生成与下发（第 3 ~ 4 周）

**目标**：将资源配置转换为 `prometheus.yml` 并触发 Prometheus 重载。

**Agent 分工**：
- `planner`：规划配置生成器输入/输出、下发方式、校验策略
- `backend-developer`：实现配置生成、校验、下发、历史记录
- `prometheus-developer`：评估是否需要 Prometheus 扩展；MVP 阶段通常只需生成配置，不修改源码
- `frontend-developer`：实现配置预览与一键下发页面
- `golang-reviewer`：审查配置生成与下发逻辑
- `security-reviewer`：审查配置下发安全性（文件写入、reload 触发权限）

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 配置生成器 | `platform/config/generator/generator.go` | 组装 global + scrape_configs（含 blackbox） | 生成 YAML 与 Module 07 示例一致 |
| 配置校验 | `platform/config/generator/validate.go` | 调用 `promtool check config` | 错误配置能被拦截 |
| 配置下发 | `platform/config/generator/reload.go` | 写文件、备份、触发 /-/reload 或 SIGHUP | Prometheus 成功 reload |
| 配置预览 API | `platform/config/generator/preview.go` | 返回生成的 prometheus.yml 文本 | 前端可预览 |
| 下发历史 | `platform/config/generator/history.go` | 记录每次下发内容与结果（P1，可简化） | 有历史记录表 |
| 前端配置预览/下发页 | `ui-custom/web/src/pages/config/preview.tsx` | 预览配置、一键下发 | 可下发后看到 targets 更新 |

**接口预览**：

```http
POST /api/v1/config/preview
POST /api/v1/config/apply
GET  /api/v1/config/history
```

**依赖**：Phase 2、本地 Prometheus 进程可运行

**风险点**：
- 本地开发需要能启动 Prometheus 并加载生成的配置，需同步准备 `deploy/prometheus.yml` 和启动脚本。
- 配置生成是 MVP 核心，需重点测试标签模板与 relabel 的正确性。

---

### Phase 4：采集状态与诊断（第 4 周）

**目标**：展示 Prometheus 运行时采集状态与拨测结果。

**Agent 分工**：
- `planner`：明确 targets 代理、拨测结果查询、状态聚合的需求
- `backend-developer`：实现 targets 代理、拨测结果查询、状态聚合
- `frontend-developer`：实现目标状态页面与拨测结果展示
- `golang-reviewer`：审查代理与聚合逻辑
- `frontend-reviewer`：审查目标状态页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| Targets 代理 API | `platform/gateway/proxy/targets.go` | 代理 `/api/v1/targets` | 返回目标列表、状态、错误信息 |
| 目标状态聚合 | `platform/collector/status.go` | 按 Job / env / app 聚合 | 筛选与统计可用 |
| 拨测结果查询 | `platform/collector/probe.go` | 代理 PromQL `probe_success`、`probe_duration` | 可展示拨测结果 |
| 前端目标状态页 | `ui-custom/web/src/pages/collection/` | 目标列表、状态筛选、拨测结果 | 与 Module 01 功能一致 |

**接口预览**：

```http
GET /api/v1/collection/targets
GET /api/v1/collection/targets/:id
GET /api/v1/collection/probe-results
```

**依赖**：Phase 3（需要 Prometheus 正在抓取）

---

### Phase 5：指标查询中心（第 4 ~ 5 周）

**目标**：提供 PromQL 查询入口与结果展示。

**Agent 分工**：
- `planner`：明确查询代理接口、元数据缓存、查询辅助策略
- `backend-developer`：实现 Query 代理、元数据代理、查询辅助
- `frontend-developer`：实现 PromQL 查询页面
- `golang-reviewer`：审查代理逻辑
- `frontend-reviewer`：审查查询页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| Query 代理 API | `platform/gateway/proxy/query.go` | 代理 `/api/v1/query`、`/api/v1/query_range`、labels、series | 返回与 Prometheus 兼容 |
| 指标元数据缓存 | `platform/gateway/proxy/metadata.go` | 代理 `/api/v1/metadata`、`/api/v1/labels` | 补全可用 |
| 查询辅助 | `platform/gateway/proxy/query.go` | 指标名/Label 建议 | 前端可联想 |
| 前端查询页 | `ui-custom/web/src/pages/query/` | PromQL 编辑器、结果表格/JSON | 可执行查询 |

**接口预览**：

```http
POST /api/v1/query
POST /api/v1/query_range
GET  /api/v1/labels
GET  /api/v1/label/:name/values
GET  /api/v1/series
```

**依赖**：Phase 3

---

### Phase 6：告警状态查看（第 5 周）

**目标**：MVP 阶段只展示当前告警。

**Agent 分工**：
- `planner`：明确告警状态代理、rules.yml 示例、前端展示需求
- `backend-developer`：实现 `/api/v1/alerts` 代理
- `frontend-developer`：实现告警状态页面
- `golang-reviewer`：审查告警代理逻辑
- `frontend-reviewer`：审查告警状态页面

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| Alerts 代理 API | `platform/gateway/proxy/alerts.go` | 代理 `/api/v1/alerts` | 返回当前告警 |
| rules.yml 示例 | `deploy/rules.yml` | 提供 MVP 示例规则 | Prometheus 加载后可触发测试告警 |
| 前端告警状态页 | `ui-custom/web/src/pages/alerts/` | 告警列表展示 | 可查看当前告警 |

**接口预览**：

```http
GET /api/v1/alerts
```

**依赖**：Phase 3、手动维护 `rules.yml`

---

### Phase 7：前端门户集成与 MVP 验收（第 5 ~ 6 周）

**目标**：把各页面串成完整门户，补齐导航、首页、错误处理。

**Agent 分工**：
- `planner`：规划门户布局、导航结构、首页 Dashboard 内容
- `frontend-developer`：实现统一布局、导航、首页、错误处理
- `backend-developer`：配合提供首页所需聚合数据 API
- `frontend-reviewer`：审查门户集成代码
- `build-resolver`：解决端到端验证中出现的构建/测试问题

| 任务 | 目录/文件 | 说明 | 验收标准 |
|------|-----------|------|----------|
| 统一布局 | `ui-custom/web/src/layouts/` | 侧边栏导航、顶部状态 | 页面切换流畅 |
| 首页 Dashboard | `ui-custom/web/src/pages/home/` | 资源数量、采集覆盖率、最近告警 | 数据真实 |
| 错误与加载状态 | `ui-custom/web/src/components/` | 统一 Loading / Error | 用户体验一致 |
| 端到端测试 | `tests/e2e/` 或手工 | 资源导入 → 配置生成 → 下发 → 查询 → 告警查看 | 主链路跑通 |
| 文档更新 | `README.md`、部署文档 | 补充启动步骤 | 新成员可按文档跑起来 |

**依赖**：Phase 1 ~ 6

---

## 5. 前后端入口与目录约定

### 5.1 后端目录

```
platform/
  cmd/metric-center/          # 主程序入口
  config/                     # Module 07 核心实现
    resource/                 # 资源管理
    label/                    # 标签模板
    job/                      # 采集 Job
    probe/                    # 拨测配置
    template/                 # 采集模板
    generator/                # 配置生成、校验、下发
  collector/                  # Module 01 运行时状态
  gateway/                    # Module 03 网关
    proxy/                    # 查询/告警/targets 代理
    auth/                     # 认证（未来）
    tenant/                   # 多租户（未来）
  models/                     # 数据模型
  db/                         # 数据库连接与迁移
  api/response/               # 统一响应
  examples/simple-agent/      # simple-agent 模板
```

### 5.2 前端目录

```
ui-custom/web/
  src/
    api/                      # API 客户端
    types/                    # TypeScript 类型
    pages/
      resources/              # 资源管理
      config/                 # 标签模板、Job、拨测、配置预览
      collection/             # 采集状态
      query/                  # 指标查询
      alerts/                 # 告警状态
      home/                   # 首页
    components/               # 通用组件
    layouts/                  # 布局
```

---

## 6. 开发顺序与并行建议

### 6.1 顺序约束

```
Phase 0 → Phase 1 → Phase 2 → Phase 3
                              │
                              ├──→ Phase 4
                              ├──→ Phase 5
                              ├──→ Phase 6
                              └──→ Phase 7
```

### 6.2 可并行任务

| 阶段 | 可并行项 |
|------|----------|
| Phase 1 | 后端资源 API 与前端资源页面可并行 |
| Phase 2 | 标签模板、采集 Job、拨测配置三个 API 可并行开发 |
| Phase 4 ~ 6 | 采集状态、指标查询、告警状态三个代理模块可并行 |
| Phase 7 | 前端集成与后端收尾可并行 |

### 6.3 Agent 驱动的开发节奏

> 以下按 **1 个 Orchestrator + 1 个 backend-developer + 1 个 frontend-developer** 的节奏编排。每个 Phase 内，Backend 与 Frontend 可在不同 worktree 中并行。

| 周次 | Orchestrator 动作 | backend-developer | frontend-developer | reviewer |
|------|-------------------|-------------------|--------------------|----------|
| 1 | 调用 planner 规划 Phase 0~1；创建 2 个 worktree | Phase 0：基础设施 + Phase 1 API | Phase 0：前端结构 + Phase 1 页面框架 | golang-reviewer 审查后端基础设施 |
| 2 | 汇总 Phase 1 结果；规划 Phase 2 | Phase 1 收尾 + Phase 2 后端 | Phase 1 页面完成 + Phase 2 配置页面 | frontend-reviewer 审查资源页面 |
| 3 | 规划 Phase 3；协调前后端契约 | Phase 2 收尾 + Phase 3 配置生成/下发 | Phase 2 配置页面完成 | golang-reviewer 审查配置逻辑 |
| 4 | 规划 Phase 4；本地 Prometheus 联调 | Phase 3 收尾 + Phase 4 采集状态 | Phase 3 配置预览/下发页面 + Phase 4 目标状态 | security-reviewer 审查配置下发 |
| 5 | 规划 Phase 5~6 | Phase 5 查询代理 + Phase 6 告警代理 | Phase 5 查询页面 + Phase 6 告警页面 | frontend-reviewer 审查查询/告警页面 |
| 6 | 规划 Phase 7；端到端验收 | 配合首页聚合数据 API | Phase 7 门户集成、首页、E2E 验证 | build-resolver 处理构建问题；双 reviewer 最终审查 |

> **关键**：Orchestrator 必须在每个 Phase 开始前调用 `planner`，并在 Developer 完成后立即调用 Reviewer，形成“规划 → 开发 → 审查 → 修复 → 合并”的闭环。

---

## 7. MVP 验收清单

- [ ] 可导入主机、中间件、应用服务三类资源
- [ ] 可维护标签模板、采集 Job、拨测配置
- [ ] 可预览并下发 `prometheus.yml`，Prometheus targets 正确更新
- [ ] 可查看采集目标状态（up/down）与拨测结果
- [ ] 可执行 PromQL 查询并查看结果
- [ ] 可查看当前告警状态
- [ ] 前端门户各页面连通，主链路端到端可用

---

## 8. 风险与规避

| 风险 | 影响 | 规避措施 |
|------|------|----------|
| 标签模板生成 relabel 错误 | 配置下发后 targets 标签不对 | Phase 3 增加 promtool 校验 + 单元测试 |
| 本地 Prometheus 启动困难 | 阻塞 Phase 3 ~ 6 | 第 1 周就准备 `deploy/` 启动脚本和示例配置 |
| Excel 字段后期变更 | 导致导入逻辑和模板返工 | Phase 1 冻结最小字段集，后续只增不改 |
| 前端等待后端 API | 串行阻塞 | Planner 在规划中明确 API 契约，Frontend Developer 使用 mock 数据并行开发 |
| 多 Agent 同时修改冲突 | 代码冲突、worktree 污染 | 采用单一 worktree，Agent 顺序进入；前后端按 `platform/` 与 `ui-custom/` 目录天然隔离 |
| Agent 误解需求 | 实现偏离 | 每个 Phase 开始前必须调用 `planner` 输出规划，并引用相关 PRD 文件 |
| Reviewer 与 Developer 标准不一致 | 反复修改 | Orchestrator 在启动时统一注入 `.kimi/skills/golang-coding-style` 和 `web-development` 规范 |
| Prometheus 源码被误改 | 未来升级困难 | 涉及源码时必须走 `prometheus-developer`，生成 patch 文件 |
| Worktree 残留 | 磁盘占用、分支混乱 | 采用单一 worktree 复用，MVP 完成后再清理；禁止为每个 Phase 新建 worktree |

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

## 9. 关联文档

- 实施难度分析：[04_Implementation_Map.md](04_Implementation_Map.md)
- 产品路线图：[02_Product_Roadmap.md](02_Product_Roadmap.md)
- 功能架构全景：[03_Functional_Architecture.md](03_Functional_Architecture.md)
- 模块详细需求：[Modules/README.md](Modules/README.md)
- Agent 团队定义：[.kimi/AGENTS.md](../../.kimi/AGENTS.md)
