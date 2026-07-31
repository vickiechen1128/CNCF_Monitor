# Grill Record: 导入监控对象与 CMDB 结合的功能设计方案

- **Date**: 2026-07-30
- **Topic**: Resource 模型、CMDB CI 同步、类型映射、Label 适配 Prometheus
- **Output**: `docs/decisions/grill-2026-07-30-cmdb-resource-label.md`

---

## Summary of decisions

| # | Decision | Rationale | Stage / Impact |
|---|----------|-----------|----------------|
| 1 | `resource_id` 保持为稳定唯一键；展示名使用 `instance_name` / hostname | `resource_id` 可能是云平台 ID 或 CMDB CI ID，不便阅读；`instance_name` 含业务语义 | MVP / v0.4+ |
| 2 | `Resource` 增加可读名字段（如 `instance_name`、`hostname`），CMDB 同步时从 CMDB 对应字段取 | Excel 模板中 `instance_name` 必填，CMDB 接入后复用对应 name 字段 | MVP / v0.4+ |
| 3 | Prometheus `instance` label 是自动生成的目标地址，不用于展示 | Prometheus 用 `instance=<host:port>` 定位 target；展示查询用 `hostname`、`ip` 等业务字段 | 设计原则 |
| 4 | CMDB CI 类型 → `resource_type` 映射表由 Module_04 维护 | Module_04 负责外部 CMDB 引入；未映射类型进入待分类队列 | v0.4+ |
| 5 | Label 采用单表 + `source` 字段（`cmdb` / `user` / `system`） | Prometheus 只认扁平 label；内部需要区分来源以实现合并视图和 CMDB 权威覆盖 | MVP / v0.4+ |
| 6 | Label 数据模型和 CRUD 放在 Module_07；Module_04 只写入 `source=cmdb` 的条目 | `Resource` 与 Label 同属配置管理域；CMDB Provider 是写入方之一 | MVP / v0.4+ |
| 7 | 用户手动 label 禁止覆盖 Prometheus 内置 label；强制小写/下划线；冲突 key UI 提示将被 CMDB 覆盖 | 防止破坏 Prometheus 保留语义；CMDB 是权威来源 | MVP |
| 8 | Excel 模板保留 CMDB 字段但标为可选/预留；LabelTemplate 决定哪些字段生成 Prometheus label | Excel 是 CMDB 缩影，但 Prometheus 只需要部分字段作为 label；避免 MVP 导入必填过多 | MVP |
| 9 | host 模板最小必填集：`instance_name`、`private_ip`、`app_code`、`env_flag`、`sub_app_code/vpc`、`network_domain_id` | 保证生成 `app`/`env`/`cluster` label 和采集目标地址；其余规格字段改为可选 | MVP |
| 10 | `Resource.status` 是状态源头；Excel 中文状态通过可配置字典映射到 `online/offline/maintenance` | 不同客户 Excel/CMDB 状态值可能不同；字典先放 Module_07 配置层，UI 配置在 Module_05 系统设置（P2） | MVP / P2 |
| 11 | `network_domain_id` 在 MVP Excel 中可选，留空时系统默认填 `default`；v0.2+ 根据租户上下文自动填充或要求选择 | 减少 MVP 导入摩擦；未来与 BlueKing Cloud Area 对齐后由 Module_04/09 负责映射 | MVP / v0.2 |
| 12 | CMDB 同步采用事件触发 + 15 分钟轮询；轮询结果为准；未映射 CI 类型进入待分类队列 | 事件可能丢消息；轮询做最终一致性兜底；不阻塞同步 | v0.4+ |

---

## Open risks and trade-offs

1. **Label 冲突体验**：虽然 UI 会提示“该 key 将被 CMDB 覆盖”，但用户频繁看到提示可能产生挫败感。后续需观察是否真的需要“用户锁定”机制。
2. **Excel 字段膨胀**：模板保留大量 CMDB 字段可能导致用户困惑。需要在前端/模板说明中明确“必填 / 可选 / 仅元数据”。
3. **待分类队列管理**：如果 CMDB 新增大量 CI 类型，待分类队列可能堆积。需要平台管理员及时维护 Module_04 映射表。
4. **状态映射字典维护**：可配置字典在 MVP 可能以 YAML/配置表形式存在，没有 UI，运营人员需要直接修改配置。

---

## Action items

- [x] 更新 Module_07 `Resource` 数据模型：增加 `instance_name` / `hostname` 等可读名字段，明确 `resource_id` 与展示名分离。
- [x] 更新 Module_07 Label 设计：明确单表 + `source` 字段，定义 CMDB / user / system 来源规则。
- [x] 更新 Module_07 标签模板字段来源：增加 `instance_name`、`hostname` 等来源，并标注 CMDB 字段为 v0.4+。
- [x] 更新 Module_04：增加 CMDB CI 类型 → `resource_type` 映射表、待分类队列逻辑。
- [x] 更新 Module_04 CMDB 同步策略：补充事件触发 + 15 分钟轮询，轮询为准。
- [x] 修改 [host_template.md](../../assets/templates/excel/host_template.md)：调整必填/可选字段，增加 `network_domain_id` 可选列，补充 `cmdb_*` 预留可选列。
- [x] 在 Module_07 中定义 Excel 状态 → `Resource.status` 映射字典（默认 + 可配置）。
- [x] 在 Module_05/07 前端说明中提示：手动 label 禁止覆盖 Prometheus 内置 label。

---

## Full Q&A log

### Batch 1

**Q1**: 对象类型到底谁说了算？CMDB 有 50 种 CI 类型时如何映射到 `resource_type`？

**A1**: MVP 自定义 host/middleware/application 三类；v0.4+ 由 Module_04 维护 CMDB CI 类型 → `resource_type` 映射表。

**Q2**: “实例名”和 Prometheus `instance` label 关系？

**A2**: `instance` 是 Prometheus 自动生成的目标地址；展示名用 `hostname`、`ip` 等 CMDB/Excel 字段，不占用 `instance`。

**Q3**: Label 来源冲突如何解决？

**A3**: CMDB 字段优先级最高，用户可手动加 label；后续采用合并视图，区分来源。

**Q4**: MVP 没有 CMDB 时类型和 label 从哪来？

**A4**: MVP 用户手动选择 `resource_type`；Excel 导入；手工数据接入 CMDB 后保留 `source_type=manual`，CMDB 数据为准。

### Batch 2

**Q5**: `resource_id` 和展示名是否冗余？

**A5**: 不冗余。`resource_id` 是稳定唯一键；展示名用 `instance_name` / hostname。

**Q6**: 合并视图怎么落地？

**A6**: 采用单表 + `source` 字段，CMDB 同步只覆盖 `source=cmdb` 的条目。

**Q7**: Excel 最小必填字段集？

**A7**: 以 host 为例：`instance_name`、`private_ip`、`app_code`、`env_flag`、`sub_app_code/vpc`、`network_domain_id`；其余改为可选。

**Q8**: CMDB 新 CI 类型未映射时？

**A8**: 进入待分类队列，同步不阻塞。

### Batch 3

**Q9**: 用户手动 label 限制？

**A9**: 禁止覆盖 Prometheus 内置 label；小写/下划线；冲突 key UI 提示将被 CMDB 覆盖。

**Q10**: `status` 源头与映射？

**A10**: `Resource.status` 是源头；Excel 中文状态通过可配置字典映射；字典放 Module_07 配置层，UI 配置在 Module_05 系统设置（P2）。

**Q11**: Excel 中 `network_domain_id` 设计？

**A11**: MVP 可选，留空默认 `default`；v0.2+ 根据租户上下文自动填充或要求选择。
