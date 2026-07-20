# MetricCenter 产品路线图

> 文档类型：产品需求文档  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)、[04_Implementation_Map.md](04_Implementation_Map.md)  
> 更新日期：2026-07-17

---

## 1. 里程碑规划

| 里程碑 | 目标 | 核心交付 | 技术栈 | 时间（预估） |
|--------|------|----------|--------|-------------|
| **MVP** | 三类资源管理 + 采集/拨测配置 + 配置下发 + 指标查询 | 可运行的配置管理中心；主机/中间件/应用服务资源管理；标签模板；采集 Job；Blackbox 拨测；prometheus.yml 生成与下发；PromQL 查询代理 | SQLite + Prometheus TSDB + Prometheus Server + Blackbox Exporter | 3 ~ 4 周 |
| **v0.2** | 采集状态展示与诊断 | Target 状态、拨测结果、采集诊断、simple-agent 端到端验证 | 保持 MVP 技术栈 | 1 ~ 2 周 |
| **v0.3** | 门户化查询与告警状态 | Custom UI 门户、PromQL 查询页、告警状态查看（代理 `/api/v1/alerts`） | 保持 MVP 技术栈 | 2 ~ 3 周 |
| **v0.4** | Open API 与外部集成 | 指标 Open API、外部 CMDB 接入预研（腾讯蓝鲸）、Remote Write 预研 | 评估 VictoriaMetrics / Mimir | 2 ~ 3 周 |
| **v1.0** | 企业级可用 | 告警规则 UI、Alertmanager 配置生成、多租户、权限、长期存储 | PostgreSQL / MySQL + VictoriaMetrics/Mimir + Agent Mode/OTel | 4 ~ 6 周 |

> 各功能落地难度、Prometheus 复用度、前后端工作量详见 [04_Implementation_Map.md](04_Implementation_Map.md)。

---

## 2. MVP 范围

### 2.1 目标

MVP 聚焦 **"三类资源管理 + 采集/拨测配置 + prometheus.yml 下发 + 指标查询"**，验证监控数据源从资源到 Prometheus 的完整闭环。

### 2.2 交付物

- **配置管理**（[Module 07](Modules/Module_07_Config_Management.md)）：
  - 主机 / 中间件 / 应用服务三类资源管理
  - 按资源类型的固定列 Excel 导入
  - 标签模板（按资源类型区分）
  - 采集 Job 管理 + 目标筛选
  - 应用服务 Blackbox 拨测配置
  - 预置采集模板（node-exporter、mysqld-exporter、simple-agent、blackbox）
  - `prometheus.yml` 自动生成与下发
- **指标查询**：Gateway 代理 Prometheus Query API
- **采集状态**：代理 `/api/v1/targets` 查看 Target 状态
- **代码入口**：
  - `platform/cmd/metric-center/main.go`
  - `platform/config/`（配置管理）
  - `platform/examples/simple-agent/`（标准采集端模板）
  - `ui-custom/web/`（配置管理前端页面）
- **本地运行**：`Makefile` + Docker Compose（Prometheus + Blackbox Exporter）
- **平台元数据**：SQLite，开发环境零运维

### 2.3 明确不做

- 动态资源模型与自定义字段扩展
- 告警规则编辑 UI（手写 `rules.yml`）
- Alertmanager 配置生成与静默管理 UI
- 多租户与持久化权限
- 复杂 Dashboard / 图表库
- Remote Write 转发
- K8s/Consul/Nacos 自动服务发现
- Redis 缓存

---

## 3. 模块开发顺序

```
Phase 1: 基础底座
├── 工程标准建立
├── 目录结构与 Makefile 完善
├── Prometheus + Blackbox Exporter 本地运行
└── platform 入口包装（metric-center）

Phase 2: MVP 核心 — 配置管理（Module 07）
├── 三类资源模型（Host / Middleware / Application）
├── 固定列 Excel 导入与校验
├── 标签模板管理（按资源类型）
├── 采集 Job 管理 + 目标筛选
├── 拨测配置（Blackbox Exporter）
├── prometheus.yml 生成
├── 配置下发与重载
└── 平台元数据使用 SQLite

Phase 3: 指标采集状态（Module 01）
├── Target 列表与状态展示
├── 拨测结果展示
├── 采集诊断
└── simple-agent 验证端到端链路

Phase 4: 查询与可视化（Module 02 / Module 05）
├── Gateway 查询代理
├── Custom UI 门户
└── 简单 PromQL 查询页

Phase 5: 告警状态与 Open API（v0.3 ~ v0.4）
├── 告警状态查看（代理 /api/v1/alerts）
├── 指标 Open API
└── 外部 CMDB 接入预研

Phase 6: 企业级能力（v1.0）
├── 告警规则 UI + Alertmanager 配置生成
├── 多租户与权限（Module 03 / Module 06）
├── 元数据迁移至 PostgreSQL / MySQL
├── 长期存储：VictoriaMetrics / Mimir（Remote Write）
├── 采集端演进：Prometheus Agent Mode / OpenTelemetry Collector
└── 部署与运维文档
```

---

## 4. 技术演进路线

> 本节只保留关键演进决策。每个功能的落地难度、自研 vs 复用分析见 [04_Implementation_Map.md](04_Implementation_Map.md)。

### 4.1 元数据存储

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **SQLite** | 开发期单机运行，零运维 |
| v0.4 ~ v1.0 | **PostgreSQL / MySQL** | 生产环境多实例、事务、审计需求 |

### 4.2 时序存储

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **Prometheus TSDB** | 本地开发、短期存储 |
| v0.4 ~ v1.0 | **VictoriaMetrics / Mimir** | Remote Write 对接，支持长期存储与集群查询 |

### 4.3 采集端

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **Prometheus Server** | 本地直接运行，便于调试 |
| v0.4 ~ v1.0 | **Prometheus Agent Mode / OpenTelemetry Collector** | 大规模分布式采集 |

### 4.4 拨测

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **Blackbox Exporter** | Prometheus 官方拨测组件，MetricCenter 只生成配置 |
| v1.0 | 保持 Blackbox / 或自研拨测网关 | 视企业定制需求决定 |

### 4.5 告警

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **手写 `rules.yml` + Alertmanager** | 规则手写，告警收敛/静默/通知走 Alertmanager |
| v0.4 | **告警状态查看** | 代理 `/api/v1/alerts` 到前端 |
| v1.0 | **告警规则 UI + 生成 `rules.yml` / `alertmanager.yml`** | 降低告警配置门槛 |

### 4.6 前端可视化

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.2 | **无图表** | 聚焦配置管理，文本/表格展示 |
| v0.3 | **简单 PromQL 结果展示** | 表格 + 简单折线 |
| v0.4 ~ v1.0 | **uPlot / ECharts** | 高性能时序图表 |

---

## 5. 核心原则

- **控制面与数据面严格分离**：无论底层存储和采集端如何演进，`platform/` 和 `ui-custom/` 保持稳定。
- **标准接口替换**：所有演进通过 Prometheus 生态标准接口（HTTP API、Remote Write、Service Discovery）完成。
- **MVP 不阻塞**：未来组件在 MVP 阶段只做架构预留，不影响当前开发节奏。
