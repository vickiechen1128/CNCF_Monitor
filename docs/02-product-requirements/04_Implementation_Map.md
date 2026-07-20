# MetricCenter 实施路线图

> 文档类型：产品需求文档 / 实施规划  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[00_Global_Architecture.md](00_Global_Architecture.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)、[02_Product_Roadmap.md](02_Product_Roadmap.md)  
> 更新日期：2026-07-17

---

## 与 02_Product_Roadmap.md 的分工

| 文档 | 聚焦问题 | 本文档是否涉及 |
|------|----------|----------------|
| [02_Product_Roadmap.md](02_Product_Roadmap.md) | 什么时候做？做到什么程度？分几个阶段？ | ❌ 本文档不写 |
| **04_Implementation_Map.md（本文档）** | 每个功能落地难不难？Prometheus 是否已支持？前后端各多少工作量？先做哪个？ | ✅ 本文档核心 |

> 阶段规划、里程碑、技术演进路线请查看 [02_Product_Roadmap.md](02_Product_Roadmap.md)。

---

## 1. 能力分层定义

按 **Prometheus 原生能力复用度** 将 MetricCenter 的工作分为四层：

| 分层 | 含义 | MetricCenter 工作量 |
|------|------|---------------------|
| **L1：纯代理层** | Prometheus / Alertmanager / Blackbox 已提供完整后端能力 | 只需 API 代理 + 前端页面 |
| **L2：配置生成层** | 原生支持该配置/规则，但需 MetricCenter 生成 | 写配置组装逻辑 + 前端表单 + 下发 |
| **L3：数据转换层** | 原生提供原始数据，需 MetricCenter 聚合/关联/增强 | 写后端聚合逻辑 + 前端展示 |
| **L4：完全自研层** | Prometheus 生态没有对应能力 | 从模型到前端都要自研 |

---

## 2. 各模块实施难度矩阵

### 2.1 资源管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 资源类型管理 | 主机/中间件/应用服务类型 | ❌ 无 | 自研类型枚举 + 差异化字段 | 中 | 低 | L4 |
| 主机资源管理 | CRUD / Excel 导入 | ❌ 无 | 自研表 + Excel 解析 | 中 | 低 | L4 |
| 中间件资源管理 | CRUD / Excel 导入 | ❌ 无 | 自研表 + 类型差异化 | 中 | 中 | L4 |
| 应用服务资源管理 | CRUD / 拨测 URL | ⚠️ Blackbox 做探测 | 自研表 + 生成 blackbox 配置 | 中 | 中 | L2/L4 |
| CMDB 接入源 | Excel / HTTP / 蓝鲸 | ⚠️ file_sd 可作为输入 | Provider 适配器 | 中 | 低 | L2/L3 |

> **关键判断**：资源管理是 MetricCenter 的核心自研域。Prometheus 只认 `static_configs` / `file_sd`，不认"资源模型"概念。

### 2.2 指标管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 采集 Job 管理 | Job CRUD | ✅ `scrape_configs` | 表单 → 生成 scrape_configs | 低 | 中 | L2 |
| 标签模板管理 | 字段映射 / transform | ✅ `relabel_configs` | 映射 UI → 生成 relabel | 中 | 中 | L2 |
| 目标筛选规则 | 按资源字段筛选 | ⚠️ 通过 static_configs 间接支持 | 查询资源 + 组装 targets | 中 | 低 | L3 |
| 采集模板管理 | 预置模板 / 示例代码 | ❌ 无 | 模板存储 + 代码示例管理 | 低 | 中 | L4 |
| 拨测配置管理 | Blackbox 配置生成 | ✅ Blackbox Exporter | 生成 blackbox scrape_config | 中 | 中 | L2 |
| 采集目标管理 | 目标列表 / 状态 | ✅ `/api/v1/targets` | 代理 API + 前端展示 | 低 | 低 | L1 |
| 指标元数据管理 | 指标名 / 类型 / HELP | ✅ `/api/v1/metadata` | 代理 + 缓存 + 前端 | 低 | 低 | L1/L3 |

> **关键判断**：采集 Job、标签模板、拨测配置都是 **L2 配置生成层**，Prometheus/Blackbox 后端已完全支持，MetricCenter 只需把 UI 操作翻译成配置。

### 2.3 配置中心

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 配置生成 | 生成 prometheus.yml | ⚠️ Prometheus 解析但不生成 | 组装全局配置 + scrape_configs | 中 | 中 | L2 |
| 配置校验 | YAML/语义校验 | ✅ `promtool check config` | 调用 promtool 或自行校验 | 低 | 低 | L1/L2 |
| 配置下发 | SIGHUP / /-/reload | ✅ 原生支持热重载 | 写文件 + 触发 reload | 低 | 低 | L1 |
| 配置版本 | 历史 / 对比 / 回滚 | ❌ 无 | 自研版本表 + Diff 逻辑 | 中 | 中 | L4 |
| 配置审计 | 变更记录 | ❌ 无 | 审计日志表 | 低 | 低 | L4 |

> **关键判断**：MVP 核心路径是 **生成 + 校验 + 下发**。校验和下发的后端工作量很小，真正的复杂度在"如何把资源+Job+标签模板正确组装成 prometheus.yml"。

### 2.4 指标查询

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| PromQL 查询 | Instant / Range | ✅ `/api/v1/query*` | 直接代理 | 低 | 中 | L1 |
| 查询辅助 | 指标补全 / Label 建议 | ✅ `/api/v1/labels` 等 | 代理 + 前端联想 | 低 | 中 | L1 |
| 结果展示 | 表格 / JSON / 折线 | ❌ 无图表库 | 前端渲染 | 无 | 中 | L4（前端） |
| Open API | REST 查询接口 | ✅ 复用 Query API | 代理 + API Key + 限流 | 中 | 低 | L1/L3 |

> **关键判断**：**指标查询是 Prometheus 原生能力复用度最高的模块**，MVP 几乎不需要复杂后端，主要工作量在前端页面和代理层。

### 2.5 告警规则管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 告警规则 CRUD | 规则 / for / labels / annotations | ✅ `rule_files` + Rule Manager | 表单 → 生成 rules.yml | 中 | 中 | L2 |
| Recording Rules | 预聚合规则 | ✅ 原生支持 | 表单 → 生成 recording rules | 中 | 中 | L2 |
| 告警状态查看 | 当前告警 / 历史 | ✅ `/api/v1/alerts` | 代理 + 展示 | 低 | 低 | L1 |
| 静默管理 | 创建/删除静默 | ✅ Alertmanager `/api/v1/silences` | 调用 API + UI | 中 | 中 | L1 |
| 通知渠道 | 飞书/钉钉/邮件 | ⚠️ Alertmanager 支持 webhook | 生成 alertmanager.yml | 中 | 中 | L2 |
| 告警收敛 | 分组 / 抑制 | ✅ Alertmanager 原生 | 生成 alertmanager.yml | 中 | 高 | L2 |

> **关键判断**：MVP 阶段**告警规则不写 UI，直接编辑 rules.yml**；告警收敛/静默/通知全部借助 Alertmanager，MetricCenter 未来只生成 `alertmanager.yml`。

### 2.6 采集状态与诊断

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 采集目标状态 | Up/Down 列表 | ✅ `/api/v1/targets` | 代理 + 前端筛选 | 低 | 低 | L1 |
| 采集诊断 | 错误信息 / HTTP 状态 | ✅ `/api/v1/targets` | 展示 + 简单统计 | 低 | 中 | L1/L3 |
| 拨测结果 | probe_success 等 | ✅ Blackbox Exporter | 代理 PromQL | 低 | 中 | L1 |
| 采集覆盖率 | 已接入 / 未接入 | ❌ 需关联 CMDB | CMDB 与 targets 比对 | 中 | 中 | L3/L4 |

> **关键判断**：**目标状态列表和拨测结果是 L1 低 hanging fruit**，应该优先做。覆盖率分析需要关联 CMDB，属于 L3/L4，可以延后。

### 2.7 平台管理

| 一级功能 | 二级功能 | Prometheus 原生支持 | MetricCenter 需做 | 后端难度 | 前端难度 | 实施层 |
|----------|----------|---------------------|-------------------|----------|----------|--------|
| 租户与权限 | 用户 / 角色 / 隔离 | ❌ 无 | 自研 RBAC | 高 | 中 | L4 |
| 数据存储管理 | TSDB 状态 / Remote Write | ✅ status API / config | 代理 + 配置 | 低 | 低 | L1/L2 |
| 审计日志 | 操作记录 | ❌ 无 | 自研审计表 | 中 | 低 | L4 |

---

## 3. 资源管理最小化设计

### 3.1 为外部 CMDB 预留接口

```go
type CMDBProvider interface {
    Name() string
    ListResources(ctx context.Context, filter Filter) ([]Resource, error)
}
```

MVP 实现：
- `ExcelProvider`：Excel 导入
- `SQLiteProvider`：本地 SQLite 存储

未来实现：
- `BlueKingProvider`：腾讯蓝鲸 CMDB
- `HTTPProvider`：通用 HTTP CMDB
- `NacosProvider`：Nacos 注册中心

### 3.2 三类资源的最小字段

#### 共同字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `resource_id` | ✅ | 唯一标识 |
| `resource_type` | ✅ | `host` / `middleware` / `application` |
| `app_name` | ✅ | 应用名 → `app` label |
| `env` | ✅ | 环境 → `env` label |
| `cluster` | ✅ | 集群 → `cluster` label |
| `owner` | ❌ | 负责人 |
| `status` | ✅ | online / offline / maintenance |

#### 主机（Host）

| 字段 | 必填 | 说明 |
|------|------|------|
| `hostname` | ✅ | 主机名 |
| `instance_ip` | ✅ | 管理 IP |
| `os_type` | ❌ | linux / windows |

#### 中间件（Middleware）

| 字段 | 必填 | 说明 |
|------|------|------|
| `middleware_type` | ✅ | mysql / redis / kafka / elasticsearch |
| `instance_ip` | ✅ | 服务 IP |
| `port` | ✅ | 服务端口 |
| `version` | ❌ | 版本 |

#### 应用服务（Application）

| 字段 | 必填 | 说明 |
|------|------|------|
| `service_name` | ✅ | 服务名 |
| `health_check_url` | ✅ | 拨测 URL |
| `protocol` | ✅ | http / https / tcp |
| `endpoint` | ❌ | 业务端点 |

### 3.3 Excel 导入简化

- **不做动态模板**：按资源类型提供固定模板
- **不做字段映射**：上传文件必须匹配固定列名
- **只做基础校验**：IP 格式、端口范围、必填项、重复检测
- **定位**：仅用于 MVP 快速验证，成功后迁移到外部 CMDB

---

## 4. 拨测设计

### 4.1 拨测能力来源

使用 **Blackbox Exporter**（Prometheus 官方组件），MetricCenter 只生成配置：

- `probe_http_*`：HTTP 连通性、状态码、TLS、响应时间
- `probe_tcp_*`：TCP 端口连通性
- `probe_icmp_*`：ICMP 存活检测

### 4.2 生成的 blackbox 配置示例

```yaml
scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - 'https://order-service.prod/api/health'
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - target_label: __address__
        replacement: blackbox-exporter:9115
      - source_labels: [__param_target]
        target_label: instance
```

---

## 5. 告警与 Alertmanager 分层（MVP 阶段）

| 能力 | 归属 | MetricCenter 策略 |
|------|------|-------------------|
| 告警规则 | Prometheus Rule Manager | MVP 手写 `rules.yml` |
| 告警求值 | Prometheus Rule Manager | 原生执行 |
| 告警状态查看 | Prometheus `/api/v1/alerts` | 代理展示 |
| 告警收敛 / 静默 / 通知 | Alertmanager | MVP 手写 `alertmanager.yml` |

> 未来演进（告警规则 UI、Alertmanager 配置生成）见 [02_Product_Roadmap.md](02_Product_Roadmap.md)。

---

## 6. 落地建议：按后端工作量排优先级

### 第一梯队：低后端工作量，快速见效

| 模块 | 功能 | 原因 |
|------|------|------|
| 指标查询 | PromQL 查询、查询辅助 | Prometheus 后端全包，MetricCenter 只做代理 |
| 采集状态 | 目标状态列表、拨测结果 | `/api/v1/targets` 直接返回 |
| 配置中心 | 配置下发（reload） | 一行命令即可触发 |
| 指标管理 | 采集 Job 基础 CRUD | 只是生成 scrape_configs 片段 |

### 第二梯队：核心但后端可控（MVP 必须）

| 模块 | 功能 | 原因 |
|------|------|------|
| 资源管理 | 三类资源最小表 + Excel 导入 | 产品差异点，必须自研 |
| 指标管理 | 标签模板 + 目标筛选 + 拨测配置 | 需要写配置组装逻辑 |
| 配置中心 | 配置生成 + 校验 | 组装逻辑是 MVP 核心 |

### 第三梯队：工作量大或依赖前置（延后）

| 模块 | 功能 | 原因 |
|------|------|------|
| 资源管理 | 腾讯蓝鲸 / K8s / Nacos 自动发现 | 需要写 Provider 适配器 |
| 告警规则 | 规则 UI、Recording Rules UI | MVP 手写规则即可 |
| 告警规则 | 静默管理 UI、通知渠道配置 | 依赖 Alertmanager API |
| 平台管理 | 多租户 / RBAC / 审计 | 完全自研 |

---

## 7. MVP 最小闭环

```
资源管理（三类对象固定字段）
    │
    ├──► 主机 ──► node-exporter 模板
    ├──► 中间件 ──► mysqld/redis/kafka-exporter 模板
    └──► 应用服务 ──► simple-agent / blackbox probe 模板
              │
              ▼
        标签模板（字段 → Label）
              │
              ▼
        采集 Job + 目标筛选
              │
              ▼
        配置中心（生成 prometheus.yml）
              │
              ▼
        Prometheus 数据面
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 采集状态   指标查询   告警状态
```

---

## 8. 关键结论

1. **后端最重的部分**：资源管理（三类资源表 + Excel 导入）和配置生成器
2. **后端最轻的部分**：指标查询、采集状态、告警状态查看（纯代理）
3. **MVP 应该避开**：告警规则 UI、多租户、外部 CMDB 接入、复杂图表
4. **最大杠杆点**：充分利用 Prometheus / Blackbox / Alertmanager 的原生能力，MetricCenter 只做"配置翻译"和"门户展示"

---

## 9. 关联文档

- 阶段规划与里程碑：[02_Product_Roadmap.md](02_Product_Roadmap.md)
- 功能完整清单：[03_Functional_Architecture.md](03_Functional_Architecture.md)
- 配置管理详细需求：[Module_07_Config_Management.md](Modules/Module_07_Config_Management.md)
- 完整代码实施计划：[05_Code_Implementation_Plan.md](05_Code_Implementation_Plan.md)
