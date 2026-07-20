# MetricCenter 全局架构

> 文档类型：产品需求文档 / 全局架构  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)  
> 更新日期：2026-07-20

---

## 1. 架构目标

1. **以 Prometheus 为引擎**：复用其成熟的采集、存储、查询能力
2. **业务与源码隔离**：所有改造代码位于 `platform/`，上游源码保持可升级
3. **可扩展**：通过插件化机制支持自定义发现、采集、存储、前端
4. **可协作**：目录结构与文档体系适配 AI Agent 开发模式

---

## 2. 总体架构：控制面 + 数据面

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            用户访问层                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │
│  │  Web 门户    │  │  Open API    │  │  管理后台                      │   │
│  │  (React)     │  │  (REST)      │  │  (配置 / 资源 / 权限)          │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘   │
└─────────┼─────────────────┼─────────────────────────┼───────────────────┘
          │                 │                         │
          └─────────────────┼─────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         控制面（Control Plane）                           │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │              API Gateway（platform/gateway）                      │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │    │
│  │  │ 认证鉴权 │  │ 租户隔离 │  │ 查询代理 │  │ 配置管理 / CMDB  │ │    │
│  │  │ auth/    │  │ tenant/  │  │ proxy/   │  │ config/          │ │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                    │                                      │
│                                生成 prometheus.yml                        │
│                                下发配置 / 触发 reload                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          数据面（Data Plane）                             │
│  ┌─────────────────────────┐  ┌─────────────────────┐  ┌──────────────┐ │
│  │   Prometheus Server     │  │   Blackbox          │  │ Alertmanager │ │
│  │   · 服务发现            │  │   Exporter          │  │              │ │
│  │   · 指标抓取            │  │   · HTTP/TCP 拨测   │  │ · 告警收敛   │ │
│  │   · TSDB 时序存储       │  │   · 存活性探测      │  │ · 静默/抑制  │ │
│  │   · PromQL 查询         │  │                     │  │ · 通知路由   │ │
│  │   · 告警规则求值        │  │                     │  │              │ │
│  └───────────┬─────────────┘  └─────────────────────┘  └──────┬───────┘ │
│              │                                                │         │
│              │         ┌─────────────────────────────────┐    │         │
│              │         │  可选：长期存储（Remote Write）   │    │         │
│              │         │  · VictoriaMetrics              │    │         │
│              │         │  · Mimir                        │    │         │
│              │         │  · Thanos                       │    │         │
│              │         └─────────────────────────────────┘    │         │
│              │                            ↑                     │         │
│              └──────── Remote Read / Remote Write ─────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 分层说明

- **控制面**：所有 MetricCenter 自研代码，位于 `platform/` 和 `ui-custom/`，负责把用户的 UI 操作转化为 Prometheus 生态可识别的配置。
- **数据面**：Prometheus 及其生态组件，负责实际执行指标抓取、拨测、存储、查询、告警求值、告警收敛与通知。
- **交互方式**：
  - 控制面通过生成 `prometheus.yml` 驱动 Prometheus，调用 `/-/reload` 热重载
  - 控制面生成 Blackbox Exporter 的拨测配置
  - MVP 阶段告警规则手写 `rules.yml`，告警收敛/静默/通知借助 Alertmanager 原生能力

---

## 3. 模块划分

| 模块 | 职责 | 对应目录 | 优先级 |
|------|------|----------|--------|
| **配置管理** | 三类资源管理、Excel 导入、标签模板、拨测配置、配置生成与下发 | `platform/config/` | **P0 (MVP 核心)** |
| 指标采集中心 | 展示采集目标、采集状态、采集诊断、拨测结果 | `platform/discovery/`, `platform/collector/` | P0 |
| 查询中心 | 提供统一查询入口、查询代理、结果展示 | `platform/gateway/proxy/` | P0 |
| 告警规则管理 | 告警状态查看（MVP）；未来生成 rules.yml / alertmanager.yml | `platform/config/rules/` | P1/P2 |
| 网关与认证 | 统一入口、鉴权、多租户、审计 | `platform/gateway/` | P2 |
| 自定义服务发现 | 对接腾讯蓝鲸、Nacos、K8s 等外部 CMDB | `platform/discovery/cmdb/` | P2 |
| 自定义前端 | 门户化 UI、配置管理页面、查询页面 | `ui-custom/` | P0/P1 |
| 系统与平台管理 | 多租户、权限、审计、数据存储管理、平台全局配置 | `platform/gateway/tenant/` | P2 |

---

## 4. 数据流

### 4.1 配置下发流（MVP 核心）

```
用户 ──► Custom UI ──► API Gateway ──► platform/config/（配置管理）
                                              │
                                              ▼
                                      读取三类资源（Host/Middleware/Application）
                                      读取标签模板 / Job 定义
                                      读取拨测配置
                                              │
                                              ▼
                                      生成 prometheus.yml
                                      （普通 scrape_configs + blackbox scrape_configs）
                                              │
                                              ▼
                                      写入 upstream/prometheus/
                                      触发 POST /-/reload
                                              │
                                              ▼
                                      Prometheus Server 重载配置
```

### 4.2 指标采集流（数据面）

```
Prometheus Server
       │
       ├──► Service Discovery ──► 静态配置 / 未来扩展 K8s/CMDB
       │
       ├──► Scrape Manager ──► Target ──► scrapeLoop 抓取
       │                                    │
       │                                    ▼
       │                                 TSDB 存储
       │                                    │
       ├──► PromQL Engine ◄─────────────────┘
       │
       ├──► Rule Manager ──► 告警求值（MVP 复用原生告警）
       │
       └──► Blackbox Probe Job ──► Blackbox Exporter ──► 探测应用服务
                                          │
                                          ▼
                                       返回 probe 指标
```

### 4.3 拨测流

```
应用服务资源 ──► health_check_url
                       │
                       ▼
            BlackboxProbeConfig
                       │
                       ▼
            Prometheus scrape_configs
                       │
                       ▼
            Blackbox Exporter ──► 执行 HTTP/TCP 探测
                       │
                       ▼
            Prometheus TSDB（存储 probe_success / probe_duration 等指标）
```

### 4.4 告警流

```
Prometheus Rule Manager
       │
       ├──► 评估 Alerting Rules ──► 触发告警 ──► Alertmanager
       │                                            │
       │                                            ├──► 分组（group）
       │                                            ├──► 抑制（inhibit）
       │                                            ├──► 静默（silence）
       │                                            └──► 路由到 Receiver
       │                                                    │
       │                                                    ▼
       │                                             飞书/钉钉/邮件/企业微信
       │
       └──► 评估 Recording Rules ──► 预聚合指标 ──► TSDB

MVP 阶段：
- Alerting Rules 手写 rules.yml
- Alertmanager 配置手写 alertmanager.yml
- MetricCenter 只提供告警状态查看（代理 /api/v1/alerts）
```

### 4.5 用户查询流（控制面代理）

```
用户 ──► Custom UI ──► API Gateway ──► 鉴权 / 租户路由（未来）
                                              │
                                              ▼
                                      Prometheus Query API
                                              │
                                              ▼
                                      返回指标数据 ──► Custom UI 渲染
```

### 4.6 未来演进：Remote Write 流

```
Prometheus Server ──► Remote Write ──► VictoriaMetrics / Mimir / Thanos
                                              │
                                              ▼
                                      长期存储 / 集群查询 / 数据湖
```

---

## 5. 技术栈

### 5.1 MVP 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端引擎 | Prometheus（Go） | 数据面核心，负责抓取、TSDB、PromQL、告警求值 |
| 拨测引擎 | Blackbox Exporter | Prometheus 官方拨测组件，负责 HTTP/TCP/ICMP 探测 |
| 告警收敛 | Alertmanager | Prometheus 官方告警管理组件，负责收敛、静默、通知路由 |
| 控制面后端 | Go 1.25+ | 轻量，优先保持简单 |
| Gateway | Go + Gin | 统一入口、鉴权、查询代理、配置管理 API |
| 前端 | React 18 + TypeScript | 门户化配置管理页面 |
| UI 组件库 | Ant Design | 企业级后台组件库 |
| 数据库（平台数据） | SQLite | 开发期使用，零运维、单机可运行 |
| 部署 | Docker / Docker Compose | 本地开发与测试 |

### 5.2 未来演进选型

| 层级 | MVP 选型 | 未来演进 | 触发条件 |
|------|---------|---------|---------|
| 元数据存储 | SQLite | PostgreSQL / MySQL | 生产部署、多实例、需要事务与审计 |
| 缓存 | 无 | Redis | 会话管理、配置缓存、采集状态缓存 |
| 时序存储 | Prometheus TSDB | VictoriaMetrics / Mimir | 长期存储、集群查询、高基数场景 |
| 采集端 | Prometheus Server | Prometheus Agent Mode / OpenTelemetry Collector | 大规模分布式采集、多信号统一（Metrics/Logs/Traces） |
| 告警收敛/通知 | Alertmanager 原生 | MetricCenter 生成 alertmanager.yml + 静默管理 UI | 需要统一配置告警路由、接收器、静默策略 |
| 告警规则编辑 | 手写 rules.yml | MetricCenter 规则编辑器生成 rules.yml | 需要降低告警规则编写门槛 |
| 图表 | 无 | uPlot / ECharts | 需要高性能时序图表时选型 |

> **选型原则**：MVP 阶段优先使用最轻量、最易本地运行的组合，所有生产级组件通过标准接口（Remote Write、Service Discovery、HTTP API）逐步替换，不侵入现有控制面代码。

---

## 6. 与源码的边界

| 位置 | 内容 | 是否可修改 |
|------|------|-----------|
| `upstream/prometheus/` | Prometheus 原始源码 | 尽量不改，必要修改 patch 化 |
| `platform/` | MetricCenter 业务扩展代码 | 可自由修改 |
| `ui-custom/` | 独立前端门户 | 可自由修改 |
| `patches/prometheus/` | 对上游源码的必要 patch | 每次升级需重新验证 |
| `deploy/` | 部署脚本与配置 | 可自由修改 |
