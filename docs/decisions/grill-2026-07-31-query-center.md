# Grill Record: 查询中心模块设计 —— 单网域 vs 多网域查询范围

- **Date**: 2026-07-31
- **Topic**: 查询中心（Module_02）与网域/边缘配置中心（Module_09）的职责边界、网域隔离、采集健康度与告警查询设计
- **Document**: `docs/decisions/grill-2026-07-31-query-center.md`

## Summary of decisions

| # | Decision | Rationale | Stage / Impact |
|---|----------|-----------|----------------|
| 1 | 租户-网域模型：**1 租户 : N 网域，1 网域 : 1 租户** | 与 [Module_06](Module_06_Multi_Tenant.md) 硬约束一致；纠正了用户最初「一个网域多个租户」的口误 | MVP / v0.2 |
| 2 | Module_02 不是透明代理，需在代理 Prometheus Query API 时自动注入 `tenant_id` 和用户有权限的全部 `network_domain_id` | 保证多租户数据隔离；用户不想在 Module_03 网关层 rewrite PromQL | MVP |
| 3 | 若用户属于多个网域且未指定，Module_02 查询其所有有权限网域的数据，由前端 UI 手动二次筛选 | 兼顾灵活性与隔离；`network_domain="x"` 等过滤由用户通过 PromQL 或 UI 分类手动完成 | MVP |
| 4 | 不存在跨租户全局平台管理员查看所有租户告警/指标的需求 | 管理员按租户管理；Module_02 无需 admin bypass 逻辑 | MVP / 需同步复核 Module_06 |
| 5 | Module_02 MVP = 带租户上下文注入的 Prometheus Query API 代理 | 先打通 Prometheus 查询链路；封装后的看板/高层 API 后续再引入 | MVP |
| 6 | Module_02 负责「被监控对象的采集健康度」（exporter `up/down`），Module_09 负责「监控基础设施自身健康度」（Edge Agent 在线、WAL、配置同步） | 两层抽象必须分开 | MVP |
| 7 | Module_09 MVP 诊断能力降级为 **Agent 状态列表页**（表格：在线状态、最后心跳、配置版本、WAL 积压、最近错误） | 图表/趋势看板不阻塞 MVP，放 P1/P2 | MVP |
| 8 | MVP 告警状态查询由 Module_02 代理 Prometheus `/api/v1/alerts`；Alertmanager 通知状态归 Module_08；边缘本地告警（断网场景，P2）由 Module_09 心跳上报 | 「告警状态信息」关注当前触发哪些规则，由 Prometheus 提供；通知路由由 Alertmanager 负责 | MVP |
| 9 | Module_02 查询响应增加外层 envelope 元数据：`data_source`（`central_scrape` / `edge_remote_write`）、`freshness_at`、来源 `network_domain` | 让用户感知中心实时 scrape 与边缘异步 Remote Write 的数据差异，同时不污染 PromQL series 标签 | MVP |
| 10 | `external_labels` 由 Module_09 在生成 Edge Agent `prometheus.yml` 时注入；Module_10 只负责外部异构监控源接入时的标签归一化 | Module_09 管内部 Agent 出身标签；Module_10 管外部来源入场标签 | MVP / v0.4+ |

## 调整后模块边界

| 模块 | 查询相关职责 | 不做什么 |
|------|-------------|----------|
| **Module_02 查询中心** | Prometheus Query API 代理；自动注入 tenant/network_domain；返回带数据来源/新鲜度 envelope 的结果；代理 `/api/v1/alerts` | 不直接查 Alertmanager；不做复杂 Dashboard；不做 Edge Agent 基础设施健康 |
| **Module_09 网域与边缘配置中心** | Edge Agent 心跳接收；Agent 状态列表；配置生成/预览/下发；`external_labels` 注入 | 不执行 PromQL 查询；不替代 Prometheus alert 评估 |
| **Module_08 告警规则管理** | Alertmanager 集成、通知状态、静默/抑制、告警规则生命周期 | 规则编辑 UI（Module_01）；中心 Prometheus alert 代理（Module_02） |
| **Module_05 自定义前端门户** | 查询页面、Agent 状态列表页、告警状态页 | 不定义业务规则 |

## Open risks and trade-offs

- **自动注入 `network_domain_id` 的语义问题**：如果用户属于 10 个网域，Module_02 默认查询 10 个网域的全量数据，可能返回大量 series，性能压力大。需要前端明确提示「当前查询范围：N 个网域」。
- **PromQL 注入 vs 用户手动过滤的边界**：Module_02 自动注入租户/网域标签后，用户仍可在 PromQL 里写 `network_domain="x"` 进一步过滤。需要文档明确「系统注入 = 权限隔离，用户过滤 = 业务筛选」。
- **`platform_admin` 租户模型需复核**：Module_06 验收标准提到「平台管理员租户可管理所有网域」，但本次 grilling 中用户明确「不存在跨租户全局管理员」。需要同步 Module_06，否则 Module_02 的注入逻辑与租户模型冲突。
- **边缘断网时的数据新鲜度歧义**：`freshness_at` 在边缘断网时会停止更新，UI 需要明确区分「无数据」和「数据旧」两种状态。
- **中心 Prometheus 评估边缘规则的延迟**：边缘 Agent Remote Write 可能有分钟级延迟，中心 Prometheus 评估规则时可能使用旧数据，导致告警延迟。这需要在告警策略文档中说明。

## Action items

- [x] 更新 `Module_02_Query_Center.md`：重新定义 MVP 为「带租户上下文注入的 Prometheus Query API 代理」；新增自动注入规则、响应 envelope 元数据、数据来源/新鲜度说明；明确 `/api/v1/alerts` 代理边界。
- [x] 更新 `Module_09_Network_Domain_and_Edge_Config_Center.md`：将「边缘诊断看板」MVP 降级为「Agent 状态列表页」；明确图表/趋势看板为 P1/P2；补充 `external_labels` 注入说明。
- [x] 更新 `Module_08_Alerting_Rule_Management.md`：明确 Alertmanager 查询/通知状态由 Module_08 负责，Module_02 只代理 Prometheus `/api/v1/alerts`。
- [x] 复核/同步 `Module_06_Multi_Tenant.md`：澄清是否存在跨租户全局平台管理员；如无，移除相关验收标准；Module_02 注入逻辑按「管理员即租户内管理员」设计。
- [x] 将 `external_labels`、Module_09 与 Module_10 的标签职责边界说明补充到 `Module_00_Integration_Map.md` 或 `03_Functional_Architecture.md`。
- [x] 更新 `03_Functional_Architecture.md`、`04_Implementation_Map.md`、`05_Code_Implementation_Plan.md` 中 Module_02/09 相关章节。
- [x] 在 Module_02 API 设计中明确响应 envelope 结构（含 `data_source` / `freshness_at` / `network_domain`）。

## Full Q&A log

### Batch 1：查询中心范围、网域隔离与状态分层

**Q1**：Module_02 目前 API 没有 `network_domain_id` 参数，多网域下是否需要自动注入网域过滤？

**A**：Module_02 现在复用 Prometheus 能力，所以很薄。默认一个租户多网域，一个网域默认一个租户。多网域情况下 Prometheus server 统一只在一个互联网网域便于管理。

**Q2**：Module_02 负责被监控对象采集健康度，Module_09 负责基础设施健康度，这个边界是否确认？

**A**：是的，这是两个不同的抽象层，Module_02 只想实现「被监控对象的采集健康度」，Module_09 是监控基础设施自身的健康度。

**Q3**：多网域下用户主要关心 Edge Agent 状态，是否意味着 Exporter up/down 不展示了？

**A**：按照技术标准，可以依靠 Agent 回传，Exporter 的 up/down 状态是可以取到的，展示在 Module_02 中，Module_02 的主要功能之一就是展示采集健康度。

**Q4**：告警状态查询放在 Module_02 还是分离？

**A**：告警状态的查询是非常重要的核心功能。因为无法穿越隔离网域，所以边缘如果一旦断网，技术上也只能查看聚合的告警。

**Q5**：`external_labels` 是什么，为什么 Module_09 负责注入，和 Module_10 什么关系？

**A**：请解释技术细节。

### Batch 2：租户-网域模型、告警归属、网域过滤接口

**Q1**：你说「一个网域多个租户」与项目硬约束冲突，哪个正确？

**A**：是我说错了，一个租户多网域，一个网域默认一个租户，参见 Module_06。

**Q2**：中心 Prometheus 模式是否需要 Module_02 增加网域查询能力？

**A**：我接受用 PromQL 手动拼 `network_domain="x"`，因为除了网域查询可能还有环境标识等筛选，就是 external-label 映射出来的，这个 label 是手动设置的，我还没想好前端必需的分类 UI 有哪些。

**Q3**：采集健康度展示形态是什么？专门 API 还是让用户写 PromQL？

**A**：我想先知道 Module_09 的诊断看板是怎么实现的，因为我可以接受列表形式的数据，看板功能并不着急。

**Q4**：告警状态到底查 Prometheus 还是 Alertmanager？

**A**：技术上我想知道通过 PromQL 查询到的是不是就是告警，还是告警是通过 Alertmanager 查询到的。

**Q5**：是否需要暴露实时 vs 异步的数据差异？

**A**：按你说的既然数据源不同，而且一个是实时一个是异步，肯定是要向用户暴露这种差异的。

### Batch 3：租户隔离、Module_02 价值、诊断看板形态、告警聚合、数据新鲜度

**Q1**：数据隔离在哪里保证？Module_03 网关 rewrite 还是 Module_02 注入？

**A**：我不想选择 Module_03 网关在调用 Module_02 之前强制 rewrite PromQL，而是在 Module_02 代理时自动注入比较好。

**Q2**：如果过滤都手动，Module_02 的价值是什么？

**A**：我接受 Module_02 在 MVP 就是带租户上下文注入的 Prometheus Query API 代理。将来可以提供封装后的看板视图等高层 API，现在不重要，MVP 先把 Prometheus 链路打通。

**Q3**：Module_09 诊断看板能否降级为列表？

**A**：接受 MVP 只做一个 Agent 状态列表页，图表和趋势分析放到 P1/P2。

**Q4**：告警状态页面由谁负责？

**A**：更关心告警状态代表的信息而不是告警实例本身。

**Q5**：数据新鲜度方案 A/B/C 选哪个？

**A**：B 对用户过于技术，分不清两种差别。把 A 和 C 结合一下，在 UI 展示和技术上都能保证合理性。

### Batch 4：注入规则、Admin 特例、新鲜度元数据、MVP API 最终形态

**Q1**：用户属于多个网域且未指定时，Module_02 查询范围是什么？

**A**：同时注入该用户所有有权限的 `network_domain_id`。如果用户没有指定 network_domain 且属于多个网域，Module_02 查询所有他有权限的网域，前端 UI 再手动筛选。

**Q2**：平台管理员是否需要全局 bypass？

**A**：这个平台管理员的定义在哪里？目前我们考虑的是将管理员对应租户去管理，不存在一个平台的管理员身份去看全局所有租户的告警。

**Q3**：是否接受 Module_02 只代理 Prometheus `/api/v1/alerts`，Alertmanager 归 Module_08，边缘本地告警 P2 归 Module_09？

**A**：接受，请把这个方案也标注清楚。

**Q4**：是否接受响应 envelope 元数据方案（`data_source` / `freshness_at` / `network_domain`）？

**A**：接受。

**Q5**：Module_02 MVP API 是否锁定为：透明代理 + 自动注入 + envelope 元数据 + 无高层 API？

**A**：请你再看下（确认收敛）。
