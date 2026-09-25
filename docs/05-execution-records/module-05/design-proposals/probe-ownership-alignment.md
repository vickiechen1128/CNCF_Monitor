# M05 首页「拨测态势」归属口径对齐（网域为主，应用/业务域移出）

> **状态**: draft
> **日期**: 2026-09-22
> **触发**: 首页 L3「拨测态势」面板 `biz_name` / `app_name` 恒空（`-`），产品负责人复核后判定「拨测态势不应与业务字典 / 应用强关联」
> **关联反馈**: `docs/05-execution-records/module-05/dev-feedback.md` 反馈 8
> **关联 PRD**: `docs/02-product-requirements/Modules/Module_05_Custom_UI.md` v1.8（决策 93）、`Module_01_*.md`（拨测采集 Job）
> **角色**: backend-developer（实现者）
> **说明**: 本文件为设计提案；「只上报、暂不实现 PRD 侧流程改动」已由产品负责人确认，PRD 合并计划见 §6。

---

## 1. 需求背景

M05 首页 L3「拨测态势」面板（决策 93）的明细行当前含 5 列：拨测目标、状态、**业务域**、**应用**、最近拨测。

- `状态` / `最近拨测` 已由 F-13 修复（取自中心 Prometheus 的 `probe_success`）填充；
- `业务域`（`biz_name`）、`应用`（`app_name`）在后端 `summary.go` 中**无数据来源**，恒为空串，前端固定显示 `-`。

产品负责人复核结论（领域洞察）：

> 应用字典（M07 §5.19）是为 **Java Spring Boot 应用监控**（`application` 资源类别）服务的；拨测（blackbox）是为了**开源组件连通性**（如 grafana、mysql 端口）服务的。二者是**正交维度**——拨测目标不是 M07 资源台账对象，没有「应用 / 业务域」归属，强行关联会制造错误心智模型。

因此本提案的核心口径是：**归属以「网域」为主（必然有值），业务域可选，应用维度整体移出拨测态势面板**。

---

## 2. 设计范围

**范围内**：

- `probe_targets[]` 明细字段调整：移除 `biz_name` / `app_name`，新增 `network_domain_id` / `network_domain_name`。
- M05 首页 `ProbePanel` 列调整：移除「业务域」「应用」两列，新增「归属网域」列。
- 相关后端 / 前端测试与静态预览 mock 同步。

**范围外**（本次不做，仅登记）：

- M01 拨测 Job 表单新增「业务域」归属字段（PRD 未定义，属跨模块契约缺口，见 §5）。
- M07 应用字典与拨测目标的关联动线设计。
- `probe_target_abnormal_count` 口径（F-13 已定，本次不动）。

---

## 3. 详细设计

### 3.1 归属口径

| 维度 | 是否适用 | 取值来源 | 理由 |
|------|----------|----------|------|
| 归属网域 | **必填** | `ScrapeJob.NetworkDomainID`（`not null`）→ `network_domains.name` | M01 已强制拨测 Job 归属网域，**必然有值**，是拨测目标的天然归属 |
| 业务域 | 可选（本次移出） | 无来源 | 拨测面向组件连通性，业务域归属非必需；M01 PRD 未定义该字段 |
| 应用 | **移出** | 无来源 | 应用字典服务应用监控（Java Spring Boot），与拨测维度正交，不应强关联 |

**关键依据**：M07 中 `host` / `database` / `middleware` / `generic_target` 的 `app_code` 本就可空，说明「资源 → 应用」并非普遍强制关系；拨测目标更不属于五类资源，因此不承载应用维度是自洽的。

### 3.2 接口契约变更（`GET /api/v2/platform/dashboard/summary`）

`data.probe_targets[]` 单条结构：

```jsonc
{
  "url": "http://172.16.102.2:3000/login",   // 拨测目标展示地址（URL 优先，否则 protocol+target）
  "status": "up",                            // up / down / ""（无 probe_success 样本 = 未知）
  "network_domain_id": "mc-edge-debug",      // 归属网域 ID（ScrapeJob.NetworkDomainID，not null）
  "network_domain_name": "腾讯云调试边缘域",   // 归属网域展示名（字典缺条目回落 ID）
  "last_probe_at": "2026-09-22T10:14:30+08:00" // 最近拨测时间；无样本为 null
}
```

**移除字段**：`biz_name`、`app_name`。

**兼容性**：新增字段为向后兼容；移除的两个字段原本恒为空串，无真实消费方，前端同步删除列即可。

### 3.3 后端实现（`platform/dashboard/summary.go`）

1. `ProbeTargetItem` 结构体：删除 `BizName` / `AppName`，新增 `NetworkDomainID` / `NetworkDomainName`（json tag 为 snake_case）。
2. 拨测段落（步骤 7）：加载 `network_domains` 构建 `ID → Name` 映射（复用既有 `models.NetworkDomain` 查询模式），逐条填充：
   - `NetworkDomainID = j.NetworkDomainID`；
   - `NetworkDomainName = domainNames[id]`，**字典缺条目回落为网域 ID**（与 `by_app` 的 `app_name` 回落 `app_code` 同源，不留空、不编造）。
3. 保持既有降级策略：`probe_success` 查询失败不阻断聚合接口，`status` 留空（前端显示「未知」）。

### 3.4 前端实现

- `ui-custom/web/src/api/dashboard.ts`：`ProbeTargetItem` 类型同步（去 `biz_name` / `app_name`，加 `network_domain_id` / `network_domain_name`）。
- `ui-custom/web/src/pages/home/ProbePanel.tsx`：列改为「拨测目标 / 状态 / **归属网域** / 最近拨测」；`network_domain_name` 空串时降级 `-`（防御旧后端）。
- `ui-custom/web/src/pages/home/HomePage.tsx`：静态预览 `DASHBOARD_MOCK.probe_targets` 字段同步。

---

## 4. 验收标准

1. 后端 `summary.go` 输出的 `probe_targets[]` 每条均含非空 `network_domain_id` 与 `network_domain_name`（`network_domains` 无对应条目时回落为 ID）。
2. `biz_name` / `app_name` 不再出现在接口响应与前端类型定义中。
3. 首页「拨测态势」面板所有列均有真实数据来源，不再出现「整列恒 `-`」的观感问题。
4. 既有不变量不被破坏：拨测目标不进 `resource_count` / `monitored_count` / 覆盖率；`status` 不臆造 `up` / `down`。
5. `go test ./platform/...`、前端 `pnpm vitest run`、`pnpm lint`、`tsc --noEmit`、`make check-repo-map` 全通过。

---

## 5. 与现有 PRD 差异点

| 项 | PRD v1.8（决策 93） | 本提案 | 说明 |
|----|---------------------|--------|------|
| `probe_targets[]` 归属字段 | `biz_name` / `app_name` | `network_domain_id` / `network_domain_name` | 归属口径由「业务域 + 应用」改为「网域」 |
| 面板列 | 拨测目标 / 状态 / 业务域 / 应用 / 最近拨测 | 拨测目标 / 状态 / 归属网域 / 最近拨测 | 列数由 5 减为 4 |
| M01 拨测 Job 业务域归属 | 未定义 | **仍未定义** | 跨模块契约缺口，本次「只上报、暂不实现」 |

> 注：M05 决策 93 的原始 PRD 文本可能未显式列出 `biz_name` / `app_name`（原型 mock 中存在）。本提案以**代码实现与原型 mock 的现状**为差异基线，具体文本差异由 prototype-designer 在合并时核对。

---

## 6. 合并计划

1. **代码先行**（本提案随附实现）：后端字段与前端列调整、测试同步，落地后首页拨测态势不再有恒空列。
2. **PRD 反向修订**：由 prototype-designer 在 `design/module-mvp-demo` 分支将 §3.2 契约与 §3.1 口径写入 `Module_05_Custom_UI.md`（决策 93 条目更新），版本 +1，Change Log 记录「吸收 design-proposal probe-ownership-alignment」。
3. **M01 契约缺口跟踪**：拨测 Job 是否需要「业务域」可选归属，作为独立议题在 `Module_01_*.md` 或后续版本评估；本提案不阻塞。
4. 合并后本提案状态改为 `merged`，保留于 `design-proposals/` 作为历史追溯。
