# MetricCenter Module 02 原型

> **验证的 PRD 版本**: [Module\_02\_Query\_Center.md](../../02-product-requirements/Modules/Module_02_Query_Center.md) v1.6
> **覆盖的产品版本**: MVP / v0.2 / v0.3
> **原型版本**: v1.6
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-02
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: <http://localhost:5176/>

## 本次 v1.6 相对 v1.5 的关键变更（决策 51 / 52 交叉落版，与 M05 / M07 / M01 协同）

* **{v1.6} 可视化三层归属边界（决策 51）**：查询中心新增「查询能力归属」可视化卡，澄清三层边界——\*\*自研查询（M02）\*\*门户内 PromQL 查询页 + 轻量图表（ECharts/AntV 消费 `query_range`）；\*\*大屏嵌入（M05）\*\*Grafana iframe 嵌入「监控大屏」入口，数据源必须指向 M02 查询代理（禁止直连 Prometheus，否则租户/网域注入被绕过）；\*\*告警规则（M08）\*\*规则求值与通知不引向 Grafana（决策 49），由 M01/M08/M09 承接。同时补充跨网域业务看板说明：注入语义为「授权集合收敛」，用户 PromQL 不含网域 matcher 时默认覆盖全部授权网域，`sum by (biz)` 跨域聚合天然成立，网域仅作可选下钻维度（dashboard variable）。

* **{v1.6} blackbox 拨测网域语义（决策 52）**：目标状态页新增 blackbox 拨测说明——拨测指标（`probe_success` 等）上的 `network_domain` 表示「从哪个网域发起拨测」（探测路径），而非目标归属；查询/看板筛选拨测数据按发起侧网域聚合，目标归属不参与网域推导（M07 四级解析链不适用 blackbox target）。

* 对齐 Module\_02 PRD v1.6 / 原型 v1.6；本轮为原型行为同步，与 PRD 落版同步提交。

* **内容归置规范（决策 51/52 落版配套）**：查询能力归属边界、跨网域看板语义、拨测网域语义、决策 50 envelope 口径等设计说明一律折入 <ReviewNote>（右上角「评审说明」开关控制显隐，用户可见文案不含决策编号 / PRD 引用 / 版本标记），用户主区仅保留运维视角的必要提示。

## 本次 v1.5 相对 v1.4 的关键变更（决策 50：可视化收敛 + MVP envelope 最小口径；四类 MVP 欠债项落版）

* **{v1.5} 响应 envelope MVP 最小口径（决策 50 / PRD §8.2）**：查询页响应 Envelope 卡片新增 MVP 最小实现口径说明——`data_source` 恒为 `central_scrape`、`network_domains` 恒为 `["default"]`、`freshness_at` 取查询结果中最新的样本时间戳（结果为空时为 `null`）；`edge_remote_write` / `data_source_by_domain` 多网域细化明确标注为 v0.2 演示 overlay，MVP 即固定 envelope 结构，避免下游改动。

* **{v1.5} 可视化收敛（决策 50）**：MetricCenter 不自研拖拽式面板编辑器 / 可视化大屏——大屏走 Grafana iframe 嵌入且数据源必须指向 M02 查询代理（`/api/v1/query*`），禁止直连 Prometheus（防止绕过租户/网域注入）；门户轻量实时图表用 ECharts/AntV 消费 `query_range`（随 v0.3 首页 Dashboard 数据）。原型查询页「简单折线」Tab 即该轻量图表占位。

* 四类 MVP 欠债项已按既有契约落版原型并随 v1.5 对齐（见下节能力清单）：**placeholder 代理** **`/api/v1/targets`**（字段 + 按网域/Job/health 筛选）、**采集健康度/覆盖率查询 API**（三态，决策 47-3 提前）、**响应 envelope**（决策 50 最小口径）、**租户/网域注入骨架**（MVP 恒 default 网域 + platform\_admin 租户，注入 key `network_domain`/`tenant_id` 与 M09 external\_labels 对齐）。

* 对齐 Module\_02 PRD v1.5 / 原型 v1.5；本轮为原型行为同步，与 PRD 落版同步提交。

## 本次 v1.4 相对 v1.2 的关键变更（决策 47-3 / 47-4，与 M01 / M07 采集状态能力协同）

* **{v1.4} 独立目标状态页降为 P1（决策 47-4）**：本页定位收敛为「跨 Job 全局排障入口」——配置场景的实例采集状态知情权由 Module\_01 Job 详情/编辑抽屉回显承接（M01 §5.10），资产场景的采集状态由 Module\_07 资源列表三态 badge 承接；菜单「目标状态」加 `P1` 标记、页内新增定位说明 banner，极简列表即可，去 P0 唯一状态入口语义。

* **{v1.4} 采集健康度/覆盖率查询 API 提前到 MVP（决策 47-3）**：原 v0.2 交付的「已监控且 up / 已监控但 down / 未监控」三态健康度/覆盖率查询提前至 MVP，作为 Module\_07 badge（M07 §采集状态）与 M01 实例状态回显的共同数据来源；「监控覆盖率」卡片与说明的版本标注由 v0.2 改为 MVP。

* 对齐 Module\_02 PRD v1.4 / 原型 v1.4；本轮为原型行为同步，与 PRD 落版同步提交。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-02
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-02
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-02/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 02: 查询中心](../../02-product-requirements/Modules/Module_02_Query_Center.md) v1.4 的核心能力（与 PRD v1.4 对齐）：

1. **PromQL 查询代理（MVP）**：instant/range 查询、表格/JSON/折线视图；**自动注入提示**——单网域模式注入 `tenant_id="tenant-a"` + `network_domain="default"`（对用户透明）；多网域模式注入 `network_domain=~"default|gov-cloud-a"` 并提示「当前查询范围覆盖 N 个网域」（PRD 5.2）。
2. **响应 Envelope（MVP / v0.2）**：`network_domains` **多值数组**（v1.2 由单值调整）；`data_source` 演示切换（central\_scrape MVP 默认 / edge\_remote\_write v0.2），后者提示「边缘异步写入可能存在延迟」并联动 Module\_09 心跳（数据延迟 X 分钟、WAL 积压）；`data_source_by_domain` 展示数据来源细化到网域（v0.2）。
3. **目标状态页（P1 / MVP，决策 47-4）**：跨 Job 全局排障入口；按网域/Job/状态筛选；列含 health、last\_scrape、**采集时长**、**拨测结果**（probe\_success / probe\_duration，仅 blackbox Job）、last\_error；行点击打开**采集诊断 Drawer**（lastError / HTTP 状态码 / 采集时长 / 标签）。本页降为 P1——配置场景知情权由 Module\_01 Job 回显承接、资产场景由 Module\_07 badge 承接，页内提供定位说明 banner。
4. **监控覆盖率（MVP，决策 47-3 提前）**：三态统计卡（已监控且 Up / 已监控但 Down / 未监控），基于 `up` 指标聚合，标注「MVP · M07 三态 badge 联动」。
5. **告警状态查看（v0.3 占位）**：菜单与页面标注 `v0.3`，页面顶部提示「该能力由 Module\_02 代理 Prometheus /api/v1/alerts，与 Module\_08 对齐，MVP 不提供」；内容保留演示。
6. **查询辅助（v0.3 标注）**：常用查询模板区标注「查询辅助 v0.3」（指标名补全 / 标签建议 / 常用模板）。
7. **单网域/多网域模式**：Header 提供 `Tenant.multi_site_enabled` 租户级开关（与 Module\_09 一致）；单网域模式仅展示 default 网域数据、网域筛选禁用；多网域模式展示全部授权网域。
8. **查询能力归属边界（决策 51，v1.6）**：查询页「查询能力归属」卡可视化三层边界——自研查询（M02）/ 大屏嵌入（M05，Grafana iframe，数据源必须指向 M02 代理）/ 告警规则（M08，不引向 Grafana）；并说明跨网域业务看板不受网域注入影响（授权集合收敛语义下 `sum by (biz)` 跨域聚合天然成立，网域仅作可选下钻）。
9. **blackbox 拨测网域语义（决策 52，v1.6）**：目标状态页补充拨测说明——拨测指标 `network_domain` 表示发起侧网域（探测路径），目标归属不参与网域推导。

## 全局导航映射

| 菜单项  | 所属模块                    | 产品版本       | 原型页面路径                                      |
| ---- | ----------------------- | ---------- | ------------------------------------------- |
| 资源管理 | Module\_07              | MVP        | `docs/prototypes/module-07/`                |
| 监控策略 | Module\_01              | MVP / v0.3 | `docs/prototypes/module-01/`                |
| 配置中心 | Module\_09              | MVP / v0.2 | `docs/prototypes/module-09/`                |
| 指标查询 | Module\_02              | MVP / v0.3 | 当前原型                                        |
| 告警状态 | Module\_02 / Module\_08 | v0.3       | 当前原型（v0.3 占位）/ `docs/prototypes/module-08/` |
| 系统设置 | Module\_06              | v0.2+      | `docs/prototypes/module-06/`                |

> 本原型在左侧导航中保留上述跨模块入口的占位（点击提示对应原型路径），避免模块原型成为孤岛。

## 模块边界标注（PRD 9）

* **注入标签 key 契约**：自动注入使用 `network_domain` / `tenant_id`，与 Module\_09 `external_labels` 注入 key 对齐（v1.2 修复，v1.1 的 `network_domain_id` 已弃用）。

* **目标/拨测/采集诊断**：`ScrapeTarget` / `ScrapeLog` 模型由 Module\_01 定义，Module\_02 只读展示；MVP 使用 `/api/v1/targets` 代理语义（health / lastScrape / lastError），独立 ScrapeLog 日志存储 v0.3。

* **告警状态**：v0.3 由 Module\_02 代理 Prometheus `/api/v1/alerts`；Alertmanager 通知状态（分组/静默/抑制/接收人）归 Module\_08；边缘本地告警（P2）经 Module\_09 EdgeHeartbeat 上报，不归 Module\_02。

* **监控覆盖率**：MVP 起由 Module\_02 提供 `up` 聚合/健康度 API（决策 47-3 从 v0.2 提前），Module\_07 采集状态三态 badge 消费。

* **可视化三层归属（决策 51，v1.6）**：自研查询=M02（门户 PromQL 查询 + 轻量图表消费 `query_range`）；大屏嵌入=M05（Grafana iframe，数据源必须指向 M02 代理，禁止直连 Prometheus）；告警规则=M08（规则求值与通知由 M01/M08/M09 承接，不引向 Grafana）。**跨网域业务看板不受网域注入影响**——注入语义=授权集合收敛，`sum by (biz)` 跨域聚合天然成立，网域仅作可选下钻。

* **blackbox 拨测网域语义（决策 52，v1.6）**：拨测指标 `network_domain` 表示发起侧网域（探测路径），目标归属不参与网域推导（M07 四级解析链不适用 blackbox target）。

## 核心页面

* `/query`：PromQL 查询中心（注入提示 + Envelope/新鲜度演示 + 表格/JSON/折线）

* `/targets`：目标状态（全局排障入口 P1 · 覆盖率统计卡 MVP + 目标列表 + 采集诊断 Drawer）

* `/alert-status`：当前告警（v0.3 占位演示）

## 已知限制

* 所有数据为本地 mock，不调用真实后端 API；查询执行仅 `message.success` 提示，不产生真实查询。

* `data_source` 切换、多网域模式开关为演示开关，刷新页面后重置。

* 简单折线为占位区域（Dashboard 数据 v0.3 集成图表库后渲染）。

* PromQL 校验 / 指标预览（validate / preview 接口）为 v0.3 功能，本原型未实现，以「查询辅助 v0.3」标注。

* 批量查询（`/api/v1/batch_query`）、临时目标验证（P2）未纳入本原型页面。

