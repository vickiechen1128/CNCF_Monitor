# MetricCenter Module 02 原型

> **验证的 PRD 版本**: [Module_02_Query_Center.md](../../02-product-requirements/Modules/Module_02_Query_Center.md) v1.2
> **覆盖的产品版本**: MVP / v0.2 / v0.3
> **原型版本**: v1.2
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-02
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5176/

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

验证 [Module 02: 查询中心](../../02-product-requirements/Modules/Module_02_Query_Center.md) v1.2 的核心能力（与 PRD v1.2 对齐）：

1. **PromQL 查询代理（MVP）**：instant/range 查询、表格/JSON/折线视图；**自动注入提示**——单网域模式注入 `tenant_id="tenant-a"` + `network_domain="default"`（对用户透明）；多网域模式注入 `network_domain=~"default|gov-cloud-a"` 并提示「当前查询范围覆盖 N 个网域」（PRD 5.2）。
2. **响应 Envelope（MVP / v0.2）**：`network_domains` **多值数组**（v1.2 由单值调整）；`data_source` 演示切换（central_scrape MVP 默认 / edge_remote_write v0.2），后者提示「边缘异步写入可能存在延迟」并联动 Module_09 心跳（数据延迟 X 分钟、WAL 积压）；`data_source_by_domain` 展示数据来源细化到网域（v0.2）。
3. **目标状态展示（MVP，承接 Module_01 移交）**：代理 `/api/v1/targets` 语义；按网域/Job/状态筛选；列含 health、last_scrape、**采集时长**、**拨测结果**（probe_success / probe_duration，仅 blackbox Job）、last_error；行点击打开**采集诊断 Drawer**（lastError / HTTP 状态码 / 采集时长 / 标签）。
4. **监控覆盖率（v0.2 演示）**：三态统计卡（已监控且 Up / 已监控但 Down / 未监控），基于 `up` 指标聚合，标注「v0.2 交付 · M07 三态 badge 联动」。
5. **告警状态查看（v0.3 占位）**：菜单与页面标注 `v0.3`，页面顶部提示「该能力由 Module_02 代理 Prometheus /api/v1/alerts，与 Module_08 对齐，MVP 不提供」；内容保留演示。
6. **查询辅助（v0.3 标注）**：常用查询模板区标注「查询辅助 v0.3」（指标名补全 / 标签建议 / 常用模板）。
7. **单网域/多网域模式**：Header 提供 `Tenant.multi_site_enabled` 租户级开关（与 Module_09 一致）；单网域模式仅展示 default 网域数据、网域筛选禁用；多网域模式展示全部授权网域。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | `docs/prototypes/module-07/` |
| 监控策略 | Module_01 | MVP / v0.3 | `docs/prototypes/module-01/` |
| 配置中心 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |
| 指标查询 | Module_02 | MVP / v0.3 | 当前原型 |
| 告警状态 | Module_02 / Module_08 | v0.3 | 当前原型（v0.3 占位）/ `docs/prototypes/module-08/` |
| 系统设置 | Module_06 | v0.2+ | `docs/prototypes/module-06/` |

> 本原型在左侧导航中保留上述跨模块入口的占位（点击提示对应原型路径），避免模块原型成为孤岛。

## 模块边界标注（PRD 9）

- **注入标签 key 契约**：自动注入使用 `network_domain` / `tenant_id`，与 Module_09 `external_labels` 注入 key 对齐（v1.2 修复，v1.1 的 `network_domain_id` 已弃用）。
- **目标/拨测/采集诊断**：`ScrapeTarget` / `ScrapeLog` 模型由 Module_01 定义，Module_02 只读展示；MVP 使用 `/api/v1/targets` 代理语义（health / lastScrape / lastError），独立 ScrapeLog 日志存储 v0.3。
- **告警状态**：v0.3 由 Module_02 代理 Prometheus `/api/v1/alerts`；Alertmanager 通知状态（分组/静默/抑制/接收人）归 Module_08；边缘本地告警（P2）经 Module_09 EdgeHeartbeat 上报，不归 Module_02。
- **监控覆盖率**：v0.2 由 Module_02 提供 `up` 聚合 API，Module_07 `is_monitored` badge 三态增强消费（MVP badge 保持二元）。

## 核心页面

- `/query`：PromQL 查询中心（注入提示 + Envelope/新鲜度演示 + 表格/JSON/折线）
- `/targets`：目标状态（覆盖率统计卡 v0.2 + 目标列表 + 采集诊断 Drawer）
- `/alert-status`：当前告警（v0.3 占位演示）

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；查询执行仅 `message.success` 提示，不产生真实查询。
- `data_source` 切换、多网域模式开关为演示开关，刷新页面后重置。
- 简单折线为占位区域（Dashboard 数据 v0.3 集成图表库后渲染）。
- PromQL 校验 / 指标预览（validate / preview 接口）为 v0.3 功能，本原型未实现，以「查询辅助 v0.3」标注。
- 批量查询（`/api/v1/batch_query`）、临时目标验证（P2）未纳入本原型页面。
