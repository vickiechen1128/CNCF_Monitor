# M07 字典生命周期与纠错设计提案

> **状态**：draft
> **日期**：2026-11-17
> **关联模块**：Module 07 监控对象管理
> **关联 SRS**：`docs/02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md` v2.0
> **代码落点**：`platform/modules/m07/dictionary/`、`platform/modules/m07/handler/`、`platform/modules/m07/service/`、`ui-custom/web/src/pages/resources/`

---

## 1. 背景

M07 的平台、应用、业务三本字典是资源归属与监控标签（`platform` / `app` / `biz`）的取值权威。当前实现存在五个具体问题：

1. **预置数据污染**：`business_domains.yaml` 预置 `authorized-ops`、`data-innovation-lab`，启动逻辑还强制补一条 `infra` 兜底。所有环境（含客户现场）都会凭空出现三条业务字典，与「字典由运维自助维护」的定位冲突。
2. **`infra` 特殊逻辑扩散**：后端禁止停用、前端禁用按钮并加 Tooltip、测试断言专门覆盖，形成一条没有业务价值的硬编码分支。
3. **停用引用导致编辑被误拒**：资源编辑时后端无条件调用 `ValidateResource`，只要资源当前引用了已停用字典，即使本次编辑没有修改该字段也会被拒绝，用户无法修改负责人、状态等无关字段。
4. **说明文案误导**：字典页提示「需要删除请到『资源管理』删除资源实例」，但删除资源并不会删除字典条目，用户按提示操作后什么也不会发生。
5. **缺少生命周期与纠错手段**：字典只有启用/停用，没有「零引用撤销」与「合并纠错」；错建、重码、历史遗留编码只能永久留在下拉里。

本轮目标是把字典从「只能启停的配置表」升级为**可治理的编码资产**：编码一旦被监控数据引用就永久保留，零引用条目可以撤销，错建/重码可以合并，所有生命周期动作留痕。

---

## 2. 设计原则

### 2.1 编码是监控数据的一部分

字典编码会通过标签模板注入到每一条指标与告警序列。删除或复用编码会导致：

- 历史时序出现「同一编码指向不同对象」的语义漂移；
- 告警静默、看板筛选、聚合查询按编码回溯时命中错误对象；
- 已归档的告警/事件无法解释。

因此本设计确定一条红线：

> **编码一经被资源或应用平台关联引用，永不物理删除、永不复用。**

### 2.2 零引用条目可以撤销

从未被引用的条目（例如刚建错、尚未投入使用）允许撤销。撤销是**终态**：

- 条目从可选下拉中消失；
- 列表仍保留（默认筛选「有效」时不显示，切换「全部」可见）；
- 编码不释放、不允许重新登记，避免「撤销后重建」造成审计断点。

### 2.3 有引用只能停用或合并

已被引用的条目不允许撤销，只能：

- **停用**：存量引用保留，禁止新增引用；
- **合并**：把引用迁移到另一个有效条目，源条目转为「已合并」终态。

### 2.4 状态与可编辑性一致

| 状态 | 含义 | 可编辑名称/描述 | 可启停 | 可撤销 | 可合并（作为源） |
|------|------|----------------|--------|--------|------------------|
| `enabled` | 启用 | 是 | 是 | 仅零引用 | 是 |
| `disabled` | 停用 | 是 | 是 | 仅零引用 | 是 |
| `merged` | 已合并（别名） | 否 | 否 | 否 | 否 |
| `revoked` | 已撤销 | 否 | 否 | 否 | 否 |

---

## 3. 状态机

```
                  ┌──────────────┐
     登记 ───────▶│   enabled    │◀──── 启用 ────┐
                  └──────┬───────┘               │
                         │ 停用                   │
                         ▼                       │
                  ┌──────────────┐               │
                  │   disabled   │───────────────┘
                  └───┬──────┬───┘
        零引用撤销     │      │ 合并（可跨启用/停用）
                      ▼      ▼
              ┌──────────┐  ┌──────────┐
              │ revoked  │  │  merged  │
              └──────────┘  └──────────┘
                 （终态）        （终态）
```

约束：

- `merged` / `revoked` 为终态，不能再次启用、编辑或合并；
- 合并目标必须是同类型、`enabled`、非 `merged` / `revoked` 的条目；
- 合并源不能等于目标；
- 撤销前实时计算引用数，引用数 > 0 返回 409 并给出「先停用/合并」的可执行提示。

---

## 4. 引用模型

### 4.1 引用来源

| 字典类型 | 引用来源 | 统计口径 |
|----------|----------|----------|
| 业务 | `resources.biz_code` | 未软删资源行数 |
| 应用 | `resources.app_code` | 未软删资源行数 |
| 平台 | `resources.platform_code` + `app_platform_rels.platform_code` | 资源行数 + 未软删关联数 |

说明：

- `app_platform_rels` 是平台字典的「组织引用」，即使没有资源落在该平台，只要应用还挂在上面，平台也不能撤销；
- 统计排除软删资源与软删关联；
- 列表接口返回 `reference_count`，服务端一次分组查询完成，禁止逐行查询。

### 4.2 合并时的引用迁移

合并必须在**单事务**内完成：

1. 校验源/目标合法；
2. 业务：`UPDATE resources SET biz_code = target WHERE biz_code = source`；
3. 应用：`UPDATE resources SET app_code = target WHERE app_code = source`，并迁移 `app_platform_rels`：
   - 目标应用已有同平台关联 → 软删源关联；
   - 否则 → 把源关联的 `app_code` 改为目标；
   - 保证目标应用仍「至少一个平台、恰一个主平台」；
4. 平台：`UPDATE resources SET platform_code = target WHERE platform_code = source`，并迁移 `app_platform_rels`（同平台冲突时软删源关联）；
5. 源条目写 `merged_into = target`、`enabled = false`（应用写 `status = 'merged'`）；
6. 写审计日志；
7. 提交后触发 M09 配置同步（资源归属变化会影响标签，需重新生成配置）。

### 4.3 TSDB 历史不重写

合并只改**元数据引用**，不重写已写入 TSDB 的历史序列：

- 历史指标仍带旧编码；
- 计数器类指标（`*_total`）在合并点可能出现不连续；
- 看板按新编码查询时，合并前的数据不会被自动归并。

这是有意的取舍：重写历史成本高、风险大，且会破坏不可变性。产品侧需在合并确认弹窗中明确提示「历史数据不会追溯改写」。

---

## 5. 应用抽屉单字段交互

### 5.1 现状问题

应用抽屉当前有「所属平台」多选 + 「主平台」单选两个必填字段。用户需要：

1. 先选一遍平台集合；
2. 再在子集里选一次主平台。

两个字段表达的是同一件事（应用与平台的关系），只是主平台多了一个标记，认知负担重复。

### 5.2 目标形态

只保留一个字段：**关联平台（多选）**。

- 下拉仅列启用平台；已停用的历史关联仍回显，但不可新选；
- 每个已选平台以 Tag 展示，Tag 左侧有星标：
  - ★ 实心 = 当前主平台；
  - ☆ 空心 = 非主平台，点击后切换主平台；
- 只选一个平台时自动成为主平台，不显示额外提示；
- 清空全部平台时校验拒绝：「应用必须归属至少一个平台」；
- 提交顺序仍把主平台排在最前，复用服务端「首个关联自动置主」的规则，减少一次 `SetPrimary` 往返。

### 5.3 可访问性

- 星标按钮提供 `aria-label`：`设为主平台 <平台名>`；
- 主平台 Tag 提供 `Tooltip`：「主平台：决定资源兜底归属与告警派单方向」；
- 键盘可达：星标为真实 `button`，支持 Tab + Enter。

---

## 6. 接口设计

### 6.1 列表增强

三个列表接口的条目新增：

```json
{
  "code": "payment",
  "name": "支付业务",
  "enabled": true,
  "status": "enabled",
  "reference_count": 12,
  "merged_into": ""
}
```

- `status`：`enabled` / `disabled` / `merged` / `revoked`；
- `reference_count`：实时引用数；
- `merged_into`：仅 `merged` 状态非空。

### 6.2 撤销

```
POST /api/v3/platform/business-domains/:code/revoke
POST /api/v3/platform/application-dict/:app_code/revoke
POST /api/v3/platform/platform-dict/:platform_code/revoke
```

- 无请求体；
- 引用数 > 0 → `409 Conflict`，`error` 文案包含引用数与建议动作；
- 已是 `merged` / `revoked` → `409 Conflict`；
- 成功返回更新后的条目。

### 6.3 合并

```
POST /api/v3/platform/business-domains/:code/merge
POST /api/v3/platform/application-dict/:app_code/merge
POST /api/v3/platform/platform-dict/:platform_code/merge

{"target_code": "payment-v2"}
```

- 源/目标同类型、存在、非终态、目标启用；
- 源 = 目标 → `400 Bad Request`；
- 成功返回 `{source, target, moved_references}`；
- 失败整体回滚，不留下部分迁移。

### 6.4 审计日志

```
GET /api/v3/platform/dictionary-audit-logs?dictionary_type=business&code=payment&limit=50
```

返回最近的生命周期动作：`action`（`enable` / `disable` / `revoke` / `merge`）、源编码、目标编码、引用数、操作人、时间、说明。

### 6.5 批量改归属

```
POST /api/v3/platform/resources/bulk-reassign

{
  "resource_ids": ["res-1", "res-2"],
  "field": "biz_code",
  "target_code": "payment-v2"
}
```

- `field` ∈ `biz_code` / `app_code` / `platform_code`；
- 目标必须存在且启用；
- 组成型资源（应用服务 / 接口服务）不允许批量改 `platform_code`（平台由应用主平台派生）；
- 静态资源批量改 `platform_code` 时，若已有应用归属，目标平台须已关联该应用；
- 单事务提交，任一资源校验失败整体回滚；
- 返回成功数、失败明细（资源 ID / 原因）。

---

## 7. 数据模型

新增迁移 `00011_m07_dictionary_lifecycle.{sqlite,postgres}.sql`：

```sql
ALTER TABLE business_domains  ADD COLUMN merged_into TEXT;
ALTER TABLE business_domains  ADD COLUMN revoked_at  TIMESTAMP;
ALTER TABLE application_dicts ADD COLUMN merged_into TEXT;
ALTER TABLE application_dicts ADD COLUMN revoked_at  TIMESTAMP;
ALTER TABLE platform_dicts    ADD COLUMN merged_into TEXT;
ALTER TABLE platform_dicts    ADD COLUMN revoked_at  TIMESTAMP;

CREATE TABLE m07_dictionary_audit_logs (
  id              TEXT PRIMARY KEY,
  dictionary_type TEXT NOT NULL CHECK (dictionary_type IN ('business','application','platform')),
  action          TEXT NOT NULL CHECK (action IN ('enable','disable','revoke','merge')),
  source_code     TEXT NOT NULL,
  target_code     TEXT NOT NULL DEFAULT '',
  reference_count INTEGER NOT NULL DEFAULT 0,
  operator        TEXT NOT NULL DEFAULT '',
  detail          TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

不新增 `status` 列：业务/平台继续用 `enabled`，应用继续用 `status`，服务端统一派生 `status` 视图。这样迁移最小，且不破坏既有 SQL 与前端字段。

---

## 8. 兼容与迁移

### 8.1 预置数据清理

- `platform/config/business_domains.yaml` 清空为模板，只保留字段说明；
- 删除 `infraFallback` 强制预置逻辑；
- 删除后端 `InfraBizCode` 常量与前端 `INFRA_CODE` 特殊分支；
- 已有环境中的 `infra` / `authorized-ops` / `data-innovation-lab` **不自动删除**（可能已被资源引用），由运维在页面上按「零引用撤销 / 有引用合并」处理。提供一次性清理脚本说明，但不自动执行。

### 8.2 编辑校验

资源更新时只校验**发生变化的引用字段**：

- `biz_code` 变化 → 校验业务字典启用；
- `app_code` 变化 → 校验应用字典启用；
- `platform_code` 变化，或 `app_code` 变化导致平台需重新校验 → 校验平台启用及应用-平台关联；
- `network_domain_id` 变化 → 校验网域可用。

未变化的字段即使当前字典已停用，也不阻断编辑。

### 8.3 API 兼容

- 列表响应只增字段，不删字段；
- 现有 `PUT` 启停接口保持不变；
- 不新增 `DELETE`，撤销走 `POST .../revoke`，避免误用物理删除语义。

---

## 9. 验收标准

### 9.1 P0

- [ ] 全新数据库启动后，业务字典为空；不存在 `infra`、`authorized-ops`、`data-innovation-lab`。
- [ ] 资源编辑时未修改已停用字典字段，可以正常保存负责人/状态等字段。
- [ ] 字典页说明文案不再出现「删除资源即可删除字典」的误导表述。
- [ ] 应用抽屉只有一个「关联平台」多选字段，星标可切换主平台；只选一个平台时自动为主平台。
- [ ] 三个字典列表展示引用数与状态；零引用条目可撤销，有引用条目撤销返回 409。

### 9.2 P1

- [ ] 业务字典为空时，资源登记不再被业务必填阻断：主机 / 数据库 / 中间件 / 应用服务可留空，接口服务必填，其他监控对象与应用归属二选一；表单内可快捷登记业务。
- [ ] 错建/重码条目可合并，引用在事务内迁移，源条目显示「已合并 → 目标」。
- [ ] 合并/撤销写审计日志，可按字典类型与编码查询。
- [ ] 资源支持按 ID 批量改业务/应用/平台归属，失败整体回滚。
- [ ] 三个字典的状态字段在 API 视图中统一为 `enabled/disabled/merged/revoked`。

### 9.3 P2

- [ ] M08 提供 matcher 影响扫描：合并/停用平台、应用、业务前，提示受影响的告警路由/静默数量。
- [ ] 提供已有环境的一次性演示数据清理说明（不自动执行）。

---

## 10. 实施拆分

| 阶段 | 内容 | 代码落点 |
|------|------|----------|
| P0-1 | 清理业务 seed 与 `infra` 特殊逻辑 | `platform/db/seed/business_domain.go`、`platform/config/business_domains.yaml`、`platform/models/business_domain.go`、`BusinessDomainPage.tsx` |
| P0-2 | 修复停用引用编辑校验 | `dictionary/service.go`、`service/resource_service.go` |
| P0-3 | 修正字典说明文案 | `DictLifecycleNotice.tsx` |
| P0-4 | 应用抽屉单字段星标主平台 | `ApplicationDictPage.tsx` |
| P0-5 | 引用数 + 零引用撤销 | migration、dictionary repository/service/handler、三个字典页 |
| P1-1 | 合并 API + 事务迁移 + 审计 | dictionary repository/service/handler、migration |
| P1-2 | 合并/撤销 UI + 审计抽屉 | 三个字典页、共享组件 |
| P1-3 | 批量改归属 API/UI | resource service/repository/handler、资源列表 |
| P2 | M08 matcher 影响扫描、存量演示数据清理指引 | M08 references、执行记录 |

---

## 11. 风险与取舍

| 风险 | 影响 | 应对 |
|------|------|------|
| 合并改写资源归属导致 M09 配置未及时同步 | 采集标签短暂不一致 | 合并成功后标记相关 Job `pending`，由 M09 自动同步；失败进入 `failed` 并提示 |
| 撤销后编码不可复用 | 用户误撤销后无法恢复 | 撤销确认弹窗明确「编码将永久保留、不可重新登记」；仅零引用可撤销 |
| 历史 TSDB 不重写 | 合并前后数据不连续 | 合并弹窗明示；报表侧按合并点解释 |
| 现有环境残留 `infra` | 与新口径不一致 | 不自动删；页面提供引用数与撤销/合并动作，执行记录给出清理步骤 |
| 批量改归属跨类型规则复杂 | 部分资源不适用 | 服务端逐条校验并整体回滚，返回失败明细 |

---

## 12. 与现有 PRD 的差异

| 现有口径 | 本提案 |
|----------|--------|
| 字典只有启用/停用 | 增加 `merged` / `revoked` 终态 |
| 字典无删除入口，但文案暗示删资源可删字典 | 明确「零引用可撤销、有引用只能停用/合并」 |
| 业务字典预置三条（含 `infra`） | 不预置任何业务字典 |
| 应用抽屉「所属平台 + 主平台」两字段 | 单字段「关联平台」+ 星标主平台 |
| 编辑资源无条件校验字典 | 只校验发生变化的引用字段 |
| 无引用统计/合并/审计 | 引用数、合并、撤销、审计日志 |

---

## 13. 合并计划

1. 本提案评审通过后，将 §2～§6、§8.2、§9 的口径合入 M07 SRS v2.0；
2. P0 代码与 SRS 同轮落地；
3. P1 合并/审计/批量改归属在独立提交中落地；
4. P2 影响扫描与存量清理指引单独排期。
