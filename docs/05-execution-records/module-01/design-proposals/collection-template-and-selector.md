# 采集模板化：取消监控对象类型，改为「采集模板 + 任务选择器」

> **状态**：approved（owner 2026-11-20 拍板；SRS 与概要设计已回填）
> **关联需求**：[M01 SRS v1.5](../../../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)（§3.1 / §5.1 / §5.6）、[M07 SRS v2.3](../../../02-product-requirements/Modules/SRS/Module_07_Monitoring_Object_Management_Requirements.md)（§3.5 / §5.8 / NFR-23）
> **关联设计**：[M01 概要设计 v1.1](../../../07-design/Module_01_Metric_Collection_Center_High_Level_Design.md)（§6.1 / §6.2）
> **影响模块**：M01（主）、M09（端口解析一行）、M05（零改动）、M07（零改动，仅口径）

---

## 1. 背景：为什么要拆掉「监控对象类型」

上一版（M01 SRS v1.3）把 `monitor_type` 做成「类型定义 + 推导规则」，方向是"让类型可配置"，但留下三个结构性问题：

| # | 问题 | 证据 |
|---|------|------|
| 1 | **M01 依赖 M07 的物理列，而非 M07 发布的字段字典** | `platform/modules/m01/domain/scope_fields.go` 直接写 `h.os_type` / `d.database_type` / `m.middleware_type`；`references/resource.go` 硬编码六表 JOIN。M07 改表即静默失效 |
| 2 | **规格承诺的自定义字段推导没有实现（跨模块悬空契约）** | M01 SRS v1.4 §3.1.2 / FR-22 写「通用扩展属性 key」；M07 SRS v2.2 NFR-23 写「对 M01 提供可参与推导字段清单接口」。实际 `AttributeDefinition` 无 `derivable`，M01 无 `m07_resource_attributes` 查询 |
| 3 | **类型层成为「资源是什么」的第二事实源** | 规则配错 → 候选为空 → 用户以为没资源（SRS v1.4 §10.2 风险表已登记） |

根因不是耦合方向（M07 不知道 M01，方向是对的），而是**耦合发生在错误的切面**：类型规则本质上是"选哪些对象"，被建模成了"这些对象是什么"。

---

## 2. 决策（owner 2026-11-20 拍板）

1. **取消 `monitor_type` 概念**（类型定义、推导规则、类型注册表、`/monitor-types` 页全部下线），改为两层：**采集模板**（怎么采）+ **任务选择器**（采哪些）。
2. **模板不带适用范围**（红线）：模板上不存任何筛选条件，范围只在任务上；否则「监控对象类型」会以另一个名字复活。
3. **模板与采集实现 1:1**：需要第二套采集器或参数就新增第二个模板；取消「同类型多实现 + 默认标记」。
4. **标签模板只在模板上引用一次**，任务只读预览（消除现有 Job / mapping 双写）。
5. **字段白名单从两份合并为一份「字段字典」**：内置字段（M07 内置字段 + 跨类别归属字段）走服务端固定列映射；自定义字段走 `资源 × key × value` 的 `EXISTS` 子查询。
6. **权限**：内置模板仅平台管理员可改；自定义模板与采集任务同权（登录用户可建）。

> 选型对照：这等价于把 Prometheus Operator 的 `ServiceMonitor.selector` 拆成「模板（endpoint 配置）+ 任务（selector）」两件对象。Operator 能合并是因为它没有"任务组 + 多域扇出"这一层；M01 有，所以必须分开。

---

## 3. 目标对象模型

| 对象 | 回答什么 | 关键字段 |
|------|----------|----------|
| `ExporterTemplate`（采集实现） | 有哪些采集器、怎么装 | 名称、来源、OS/Arch、下载地址、安装指南、默认端口 |
| `CollectionTemplate`（采集模板） | 这类对象怎么采 | `code`（不可变）、`name`、`resource_category`、`exporter_template_id`（1 个）、参数集（端口/路径/协议/间隔/超时/认证/TLS）、`label_template_id`（1 个）、启用、内置标记 |
| `ScrapeJob`（采集任务） | 采哪些、在哪采 | 名称、`template_code`、`network_domain_id`、**selector** `{category, logic, filters[]}`、参数快照、`selected_instance_ids`、启停与草稿状态 |
| 指标库锚点 | 指标属于哪套采集 | `{template_code, source_exporter}` |

`selector` 语义：`filters` 为 `{field, op, values}` 列表，`logic` 为 `all` / `any`；`category` 由模板继承并强校验一致；保存时把命中实例固化为快照，条件变更不改写存量快照。

---

## 4. 现状 → 目标映射（无损迁移）

| 现状 | 迁移动作 | 语义损失 |
|------|----------|----------|
| `m01_ci_type_exporter_mappings` 默认行 | → 一个模板，`code = monitor_type`（沿用 10 个内置 slug） | 无 |
| 同类型非默认行 | → `<monitor_type>__<exporter_slug>` | 无 |
| `m01_monitor_types` | → 模板的 `name` / `resource_category` / `enabled` / `is_builtin` | 无 |
| `m01_monitor_type_rules` | → 每条存量任务的 `selector`（规则数组原样复制） | 无，候选集合不变 |
| `m01_metric_library.monitor_types[].monitor_type` | → `template_code`（同值） | 无 |
| M09 `mappingPorts[job.monitor_type]` | → `job.template.default_port` | 无（一行改动） |
| M05 `by_subtype` | 不动（走 M07 扩展表列，与 `monitor_type` 无关） | 零改动 |
| `monitor_type` 作为 Prometheus label | 本就不存在（M09 仅用作端口查表键） | 无存量规则失效 |

---

## 5. 分阶段实施

| 阶段 | 内容 | 说明 |
|------|------|------|
| **P1 数据与后端** | migration `0022_m01_collection_templates`；数据搬迁（映射表 + 类型/规则 → 模板 + 任务 selector）；`selector` 落 Job；字段字典合并（`scopeFieldSpecs` + `candidateFilterColumns` → 一份）；指标锚点改名；删除类型注册表与规则校验；M09 端口解析改模板 | 删除多于新增 |
| **P2 前端 IA** | `/collectors` 语义升级「采集模板」（页内：模板 / 采集实现）；删除 `/monitor-types` 页；任务向导改三步（选模板 → 定条件 → 确认实例）；指标库锚点改选模板 | 组件可复用：`MappingDrawer` → 模板抽屉、`InstanceSelector` → 第三步、`QueryCandidates` 的 domainHits → 分域预览 |
| **P3 清理** | 删表 / 删 API 别名 / 契约快照更新 / 本提案状态置 merged | 旧接口别名仅保留一个版本 |

API 变更（相对现状）：

- 新增 `/collection-templates`（GET/POST/PUT/DELETE）、`/collection-templates/:code/impact`、`/candidate-fields`；
- 下线 `/monitor-types*`、`/monitor-types/scope-fields`、`/ci-exporter-mappings*`（迁移期保留只读别名，写请求提示改用模板）；
- `/scrape-jobs` 请求体：`monitor_type` → `template_code` + `selector`。

---

## 6. 验证口径（回归必须给出数字）

1. **候选集合零变化**：对 10 个内置模板，分别用旧规则与新 selector 查询候选并比对 `count` 与 `resource_id` 集合，必须完全相等（含 `offline` 置灰、`maintenance` 默认排除口径）。
2. **网域与授权收敛不变**：同一条件下按域计数（`domainHits`）逐域相等。
3. **自定义字段筛选打通**：在 M07 登记 `dpu_model` → 任务加条件 `dpu_model = BlueField-3` → 命中数与 M07 资源列表同条件筛选一致；该链路不涉及 M01 代码改动。
4. **权限矩阵**：admin / 非 admin × 内置 / 自定义模板 × 增删改查，期望 403 与成功一致。
5. **M09 端口解析**：迁移后同一 Job 生成的 `instance`（`ip:port`）与迁移前逐条相等。

---

## 7. 遗留决策（待后续版本）

| # | 事项 | 倾向 |
|---|------|------|
| 1 | 旧接口别名保留时长 | 一个版本；下个版本直接 410 |
| 2 | 自定义字段筛选的性能保护 | 需 `(resource_id, attribute_key)` 索引；高频字段评估生成列；可按"同时可用的自定义条件数"设配额 |
| 3 | 模板 code 是否允许改名 | 不允许（与任务、指标锚点、导出文件绑定） |
| 4 | 模板是否需要"复制为新模板" | 需要（多参数变体的主要入口），属交互增强而非模型变更 |

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-11-20 | 首版：owner 拍板 C 方案（退化为模板 + selector）与权限口径后，汇总为可执行提案；同步回填 M01 SRS v1.5、M07 SRS v2.3、M01 HLD v1.1 |
