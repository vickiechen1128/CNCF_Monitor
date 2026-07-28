# Module 01: 指标管理与采集状态中心

> **模块类型**: 核心能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_07_Config_Management.md](Module_07_Config_Management.md)  
> **目标用户**: 运维工程师  
> **版本**: v2.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

从功能架构上，本模块对应 **02 指标管理** 与 **06 采集状态与诊断** 两大能力域：

1. **指标管理**：定义“怎么采、采什么”，包括采集 Job、标签模板、目标筛选、采集模板、拨测配置、指标元数据等。MVP 阶段这些配置的编辑入口由 [Module 07: 配置管理](Module_07_Config_Management.md) 承载，本模块作为功能Owner明确能力边界与数据契约。
2. **采集状态与诊断**：集中展示所有指标采集目标与 Blackbox 拨测目标的健康状态、抓取详情与诊断信息。

> **边界说明**：本模块**不负责**维护 CMDB 资源、标签模板的具体编辑、或 `prometheus.yml` 的生成与下发，这些能力由 [Module 07: 配置管理](Module_07_Config_Management.md) 负责。本模块消费 Module 07 产生的配置与 Prometheus 运行时状态。

---

## 2. 用户故事

- OPS-01：查看所有采集目标状态
- OPS-04：查看目标采集日志与失败原因
- OPS-05：临时添加一个采集目标（用于验证）
- OPS-06：查看应用服务的拨测结果
- ARCH-07：按网域筛选采集目标与拨测结果
- ARCH-08：在采集诊断页面引用 [Module_09](Module_09_Network_Domain_and_Edge_Agent.md) 提供的边缘 Agent 状态（v0.2+）

---

## 3. 核心功能

### 3.1 指标管理（功能 Owner）

> 配置编辑入口在 MVP 阶段由 [Module 07: 配置管理](Module_07_Config_Management.md) 承载，本模块明确能力边界与数据契约。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 采集 Job 管理 | Job 创建/编辑、`scrape_interval`、`scrape_timeout`、`metrics_path`、`scheme`、启用/禁用 | P0 |
| 标签模板管理 | CMDB 字段映射、Prometheus 内置字段、组合字段、transform 规则、按资源类型区分 | P0 |
| 目标筛选规则 | 按网域、资源类型、`env`、`app`、`cluster` 等字段筛选、多条件组合、预览匹配结果 | P0 |
| 采集模板管理 | 预置模板（node-exporter、mysqld-exporter、simple-agent、blackbox）、自定义模板 | P0/P1 |
| 边缘采集器类型 | 按网域配置 `vmagent`（默认）或 `prometheus-agent` | P1/P2 |
| 拨测配置管理 | Blackbox Exporter 配置生成、HTTP/TCP 拨测目标、probe 模板 | P0 |
| 采集目标管理 | 目标列表、目标状态、目标详情、临时目标（用于验证） | P1 |
| 指标元数据管理 | 指标名注册、类型标记（counter/gauge/histogram/summary）、HELP/UNIT | P1 |
| 高级 Relabel 管理 | 标签丢弃/保留/重写、正则替换、hashmod（未来） | P2 |
| Exporter 市场 | Exporter 登记、版本管理、部署指南（未来） | P2 |

### 3.2 采集状态与诊断

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 目标列表 | 展示所有采集目标、所属网域、所属 Job、状态、最近抓取时间 | P0 |
| 状态筛选 | 按网域、Job、环境、应用、状态（up/down）筛选 | P0 |
| 拨测结果展示 | 展示 Blackbox 拨测结果（probe_success、probe_duration），支持按网域筛选 | P0 |
| 采集诊断 | 展示抓取失败原因、HTTP 状态码、错误日志 | P1 |
| 目标详情 | 查看某个 target 的 labels、最后样本、错误信息 | P1 |
| Job 健康度 | Job 维度成功率、目标覆盖率 | P1 |
| 采集覆盖率 | 按网域/环境/应用统计已接入/未接入资源 | P1 |
| 边缘 Agent 状态（引用） | 在采集诊断页面聚合展示 [Module_09](Module_09_Network_Domain_and_Edge_Agent.md) 提供的 Edge Agent 在线状态、WAL 积压、配置版本（v0.2+）；本模块不持有该数据模型 | P1 |
| 临时目标 | 支持手动添加临时采集目标（不持久化到 CMDB） | P2 |
| Trace 级诊断 | 抓取请求详情、响应体预览 | P2 |

---

## 4. 数据来源

本模块数据来源：

1. **配置管理模块**生成的 `prometheus.yml`
2. Prometheus 运行时通过 `/api/v1/targets` 暴露的采集状态
3. Blackbox Exporter 生成的 `probe_*` 指标

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  配置管理模块    │ --> │  prometheus.yml │ --> │   Prometheus    │
│  (CMDB + Job)   │     │ (含 blackbox    │     │  (运行时状态)   │
│                 │     │  scrape_configs)│     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  指标采集中心    │
│                                              │  · 目标列表      │
│                                              │  · 拨测结果      │
│                                              │  · 采集诊断      │
                                               └─────────────────┘
```

---

## 5. 数据模型

### 5.1 采集目标（ScrapeTarget）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| id | string | 平台生成 | 唯一标识 |
| resource_id | string | CMDB | 关联的 CMDB 资源 ID |
| resource_type | enum | CMDB | host / middleware / application |
| network_domain_id | string | CMDB / NetworkDomain | 所属网域 ID |
| job | string | Job 配置 | Prometheus job_name |
| instance | string | CMDB / 拨测 URL | IP:Port 或健康检查 URL |
| labels | map | CMDB + 标签模板 | Prometheus labels |
| status | enum | Prometheus | up / down / unknown |
| last_scrape | datetime | Prometheus | 最近抓取时间 |
| last_error | string | Prometheus | 最近错误信息 |
| probe_success | float | Blackbox | 拨测成功标识（仅拨测目标） |
| probe_duration | float | Blackbox | 拨测耗时（仅拨测目标） |

### 5.2 采集日志（ScrapeLog）

| 字段 | 类型 | 说明 |
|------|------|------|
| target_id | string | 目标 ID |
| timestamp | datetime | 抓取时间 |
| status | enum | success / error |
| duration_ms | int | 抓取耗时 |
| http_status | int | HTTP 状态码 |
| error_msg | string | 错误信息 |

### 5.3 边缘 Agent 状态引用（v0.2+）

边缘 Agent 的数据模型、心跳接收、状态展示由 [Module_09: 网域与边缘 Agent 管理](Module_09_Network_Domain_and_Edge_Agent.md) 负责。本模块在采集诊断页面按需聚合展示，不持有 `EdgeAgent` 数据模型。

---

## 6. 与配置管理模块的关系

| 职责 | 配置管理模块（Module 07） | 指标管理与采集状态中心（Module 01） |
|------|---------------------------|-------------------------------------|
| CMDB 资源维护 | ✅ 实现 | ❌ |
| Excel 导入 | ✅ 实现 | ❌ |
| 标签模板编辑 | ✅ MVP 阶段实现 | 功能 Owner，定义数据契约 |
| 采集 Job 编辑 | ✅ MVP 阶段实现 | 功能 Owner，定义数据契约 |
| 拨测配置编辑 | ✅ MVP 阶段实现 | 功能 Owner，定义数据契约 |
| 生成 prometheus.yml | ✅ 实现 | ❌ |
| 下发配置到 Prometheus | ✅ 实现 | ❌ |
| 查看目标列表 | ❌ | ✅ 运行时展示 |
| 查看拨测结果 | ❌ | ✅ 运行时展示 |
| 查看采集状态 | ❌ | ✅ 运行时展示 |
| 采集诊断 | ❌ | ✅ 运行时展示 |
| 临时目标验证 | ❌ | ✅ 运行时展示 |

---

## 7. 依赖

- `upstream/prometheus/scrape/`
- `upstream/prometheus/web/api/v1/`
- `platform/gateway/proxy/`
- `platform/models/`

---

## 8. 验收标准

- [ ] 可以通过 Web 门户查看所有采集目标列表
- [ ] 目标列表展示所属网域（`network_domain_id`）
- [ ] 可以按网域、Job、环境、应用、状态筛选目标
- [ ] 可以看到目标的采集状态（up/down）和最近抓取时间
- [ ] 可以看到应用服务的拨测结果（probe_success、probe_duration），支持按网域筛选
- [ ] 采集失败时可以看到错误原因
- [ ] 临时添加的目标可以立即生效（开发验证用途）
- [ ] 多网域场景下，可以在采集诊断页面引用并查看 [Module_09](Module_09_Network_Domain_and_Edge_Agent.md) 提供的各网域 Edge Agent 在线状态、最后心跳、WAL 积压
- [ ] 边缘 Agent 失联告警（`EdgeSiteOffline`）由 [Module_08](Module_08_Alerting_Rule_Management.md) 管理，触发条件由 [Module_09](Module_09_Network_Domain_and_Edge_Agent.md) 定义
