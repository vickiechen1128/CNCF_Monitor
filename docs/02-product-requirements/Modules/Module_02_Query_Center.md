# Module 02: 查询中心

> **副标题**：带租户/网域上下文注入的 Prometheus Query API 代理  
> **模块类型**: 核心能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_06_Multi_Tenant.md](Module_06_Multi_Tenant.md)、[Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)  
> **目标用户**: 运维工程师、业务研发工程师、AI 应用开发工程师  
> **版本**: v2.1  
> **更新日期**: 2026-07-31

---

## 1. 模块目标

Module_02 在 MVP 阶段定位为**带租户/网域上下文注入的 Prometheus Query API 代理**。它提供统一的指标查询入口，但**不是透明代理**：在将查询转发给中心 Prometheus 之前，必须根据当前认证用户的身份自动注入 `tenant_id` 与有权限的网域标签，以保证多租户数据隔离。

MVP 阶段聚焦打通 Prometheus 查询链路，**不引入复杂 Dashboard 编辑器**；封装后的看板视图、高层查询 API 等后续迭代再引入。

### 与周边模块的边界

- **与 Module_09 的边界**：Module_02 查询的是**被监控对象**的指标与 exporter 采集健康度（例如 `up` 指标）；Module_09 负责**监控基础设施自身**的健康度，包括 Edge Agent 在线状态、最后心跳、WAL 积压、配置同步等。
- **与 Module_08 的边界**：Module_02 在 MVP 阶段仅代理 Prometheus `/api/v1/alerts`，返回当前 firing/pending 的告警实例；Alertmanager 的通知状态（分组、静默、抑制、接收人）由 Module_08 负责。

---

## 2. 用户故事

- OPS-03：在门户中执行 PromQL 查询
- OPS-07：查看当前告警状态（中心 Prometheus 聚合）
- AI-01：通过稳定 API 获取指标数据
- AI-02：批量查询多个时间序列
- DEV-01：查看我负责服务的指标数据

> 被监控对象的采集健康度（如 exporter `up/down`）通过 PromQL 查询 `up` 等指标查看，不通过独立模块提供。

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| PromQL 代理（含租户/网域注入） | 代理 instant / range 查询，自动注入 `tenant_id` 与有权限的网域标签 | P0 |
| `/api/v1/alerts` 代理 | 代理 Prometheus 当前触发/待处理告警实例，注入租户/网域上下文 | P0 |
| 查询辅助 | 指标名补全、标签建议、常用查询模板 | P1 |
| 结果展示 | 表格视图、JSON 视图、简单折线图 | P1 |
| Open API | 提供 RESTful API 供外部系统调用 | P1 |
| 批量查询 | 支持一次查询多个表达式 | P2 |
| 复杂 Dashboard | 拖拽式面板编辑器 | P2（不做） |

---

## 4. 接口设计

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/v1/query | POST | 执行 PromQL instant query |
| /api/v1/query_range | POST | 执行 PromQL range query |
| /api/v1/labels | GET | 获取所有 label names |
| /api/v1/label/:name/values | GET | 获取 label 所有值 |
| /api/v1/series | GET | 查询匹配的 series |
| /api/v1/alerts | GET | 获取当前告警状态（MVP 只读） |

> 以上接口均代理 Prometheus Query API，但 Module_02 会在转发前自动注入租户/网域选择器，并在返回结果外层包裹 envelope 元数据（见第 5 节）。

---

## 5. 自动注入规则

Module_02 在代理查询时，必须根据认证用户从 [Module_06](Module_06_Multi_Tenant.md) 与 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 获取的租户-网域关联，自动注入以下标签选择器：

1. **自动注入 `tenant_id`**  
   选择器为 `tenant_id="<用户所属租户 ID>"`。Module_02 不暴露跨租户查询能力，平台管理员也按租户维度管理。

2. **自动注入网域标签**  
   标签名与 Module_09 通过 `external_labels` 写入的网域 label key 保持一致（决策中记为 `network_domain_id`），值为该用户有权限的全部网域 ID。多网域时使用正则匹配：
   ```promql
   network_domain_id=~"domain-a|domain-b|domain-c"
   ```

3. **单网域场景**  
   若租户仅拥有 `default` 网域，Module_02 自动注入 `network_domain_id="default"`，对用户完全透明，无需在 PromQL 中显式写网域过滤。

4. **多网域场景**  
   若用户拥有多个网域权限且未在 PromQL 中显式指定网域过滤，Module_02 默认查询其**所有有权限网域**的数据。前端 UI 应明确提示当前查询范围覆盖 N 个网域。用户仍可在 PromQL 中进一步使用 `network_domain="x"`（或 `network_domain_id="x"`）手动筛选。

> **设计原则**：系统注入 = 权限隔离；用户过滤 = 业务筛选。

---

## 6. 响应 envelope 与数据新鲜度

Module_02 将 Prometheus 原始响应包裹为统一 envelope，在不污染 PromQL series 标签的前提下，向用户暴露数据来源与新鲜度差异。

### 6.1 Envelope 结构

```json
{
  "status": "success",
  "data": { "resultType": "matrix", "result": [...] },
  "meta": {
    "data_source": "central_scrape | edge_remote_write",
    "freshness_at": "2026-07-31T12:00:00Z",
    "network_domain": "default"
  }
}
```

| 字段 | 说明 |
|------|------|
| `data_source` | 数据来源：`central_scrape`（中心 Prometheus 直接抓取）或 `edge_remote_write`（Edge Agent 异步 remote write 到中心） |
| `freshness_at` | 该 series 最近一次样本的时间戳；边缘断网时该时间会停止更新 |
| `network_domain` | 数据 originating 的网域 |

### 6.2 数据来源说明

- **`central_scrape`**：中心 Prometheus 直接抓取目标。适用于单网域场景，或中心网络可达的目标，数据延迟低。
- **`edge_remote_write`**：Edge Agent 在边缘网域抓取目标后，通过 remote write 异步回写到中心 Prometheus。适用于多网域/隔离网域场景，可能存在分钟级延迟。

### 6.3 UI 提示要求

- 当 `data_source` 为 `edge_remote_write` 时，UI 应提示用户数据为边缘异步写入，可能存在延迟。
- 当 `freshness_at` 明显滞后于当前时间时，UI 应区分「无数据」与「数据旧」两种状态。

---

## 7. 依赖

- [Module_06_Multi_Tenant.md](Module_06_Multi_Tenant.md)：租户-网域模型与用户权限
- [Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)：Edge Agent `external_labels` 注入
- `upstream/prometheus/promql/`
- `upstream/prometheus/web/api/`
- `platform/gateway/proxy/`

---

## 8. 验收标准

- [ ] PromQL instant / range 查询自动注入 `tenant_id` 与有权限的 `network_domain_id`，未授权租户/网域的数据不可见
- [ ] 单网域租户对网域注入无感知，查询行为与直接查 Prometheus 一致
- [ ] 多网域租户默认查询全部授权网域，前端可进一步通过 PromQL 手动筛选
- [ ] `/api/v1/alerts` 仅代理 Prometheus 当前告警实例，不代理 Alertmanager 通知状态
- [ ] 查询响应包含 envelope 元数据：`data_source`、`freshness_at`、`network_domain`
- [ ] UI/API 能够区分 `central_scrape` 与 `edge_remote_write` 数据，并明确提示边缘异步延迟
- [ ] Open API 返回与 Prometheus 兼容的数据格式（原始数据位于 `data` 字段内）
- [ ] 查询响应时间 P99 < 2s
