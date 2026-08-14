# MetricCenter Module 01 原型

> **验证的 PRD 版本**: [Module_01_Metric_Collection_Center.md](../../02-product-requirements/Modules/Module_01_Metric_Collection_Center.md) v3.6
> **覆盖的产品版本**: MVP / v0.2 / v0.3 / v1.0
> **原型版本**: v2.8
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-01
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5175/

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-01
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-01
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-01/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 01: 监控策略与指标管理](../../02-product-requirements/Modules/Module_01_Metric_Collection_Center.md) 的核心交互：

1. **CI 类型 ↔ Exporter 模板绑定（CI-Exporter 模板映射）**：维护 `CITypeExporterMapping`，含默认端口/路径/协议/采集参数；内置绑定禁止删除；CI 类型以「资源类别 → 细粒度类型」两级级联选择。**标签模板关联**：列表「标签模板」列以两行卡片展示（名称+默认/自定义标记 / 类别·模板ID），点击模板名打开只读预览抽屉查看映射明细；表单内选中模板后以紧凑卡片展示映射，并提供「前往标签模板管理」跨模块跳转（模板 CRUD 归属 Module_07）。
2. **采集 Job 管理**：Job 增/改/删，关联 CI 类型、Exporter 模板、网域；CI 类型两级级联选择（先选资源类别，再选 MySQL/Redis 等细粒度类型，选中后自动带出映射默认 Exporter）；`job_type=standard/blackbox`，blackbox 拨测目标内嵌在 Job 中（`BlackboxTarget[]` 对象数组：target / protocol / url）；实例选择 MVP 手动勾选，v0.3+ 预留 `instance_filter`；Exporter 安装确认（点状态徽标循环 + 弹窗填确认人/备注/实际监听端口 `actual_port` {P1}）；**详情只读视图**（列表「详情」按钮打开只读 Descriptions，区分编辑抽屉）；**参数继承与同步演示**：创建 Job 时从 CI-Exporter 模板映射继承默认参数（间隔/超时/路径/协议/标签模板）并快照，用户手动修改过的字段记录到 `mapping_overrides`；映射默认值变更后 Job 列表显示「映射默认值已变更」Tag、编辑抽屉提供「同步映射默认值」按钮手动刷新（**仅刷新未手动覆盖字段，覆盖字段保持用户值**）。
3. **规则编辑**：告警 / 记录规则编辑，`rule_type=recording` 时隐藏 `duration` 与 `annotations`；Labels/Annotations key-value 动态表单；资源类型两级级联选择，选中 CI 类型后自动带出映射默认 Exporter 模板（可覆盖）；PromQL 保存前强制校验，expr 引用的指标必须存在于指标库（失败给具体错误如「未知指标名 xxx」）；指标库数据基于**当前页面状态**（用户新增/禁用实时生效）；选 `exporter_template_id` 后从指标库过滤预览；P1「规则模板一键填充」占位按钮。
4. **指标库**：按 Exporter 分组浏览；支持「资源类别 → CI 类型」两级筛选与 metric_type 筛选；新增/编辑用户扩展指标（`is_builtin=false`）；内置指标禁止编辑/删除；`enabled` 切换（禁用指标不参与规则提示）；MVP 内置指标库只读，必须先有指标库才能编写 PromQL。
5. **业务指标库（{v3.5}/{v3.6} 动线分离）**：业务指标（BusinessMetric）登记与状态推进；**两角色动线**（Header 角色切换器演示）——业务负责人：登记/更新业务指标（语义/阈值/业务域/负责人必填）、标记埋点完成（pending→instrumented），不配置采集任务；运维工程师：可查看全部指标库、配置采集任务，业务指标语义只读、确认采集上线（instrumented→online）、可代办登记（`register_source=agent`，owner 仍指向业务负责人）。状态机 pending→instrumented→online 按职责分工推进。
6. **单网域/多网域模式**：Header 提供 `Tenant.multi_site_enabled` 租户级开关（与 Module_09 一致）；多网域模式 Job 可绑定 default / 边缘网域，单网域模式仅允许 default 管理域（网域下拉禁用）。
7. **{v3.4} application_http 语义**：CI-Exporter 映射选择 `application_http`（HTTP 应用）时表单提示「业务指标端点采集：应用自带 /metrics，无独立 exporter，标签模板注入 app/biz」；采集 Job 实例选择新增「按业务类型（biz）筛选」（筛选字段 = Resource 属性字段 `business_domain`，label 名作 UI 别名）。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | `docs/prototypes/module-07/` |
| 监控策略 | Module_01 | MVP | 当前原型 |
| 配置中心 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |
| 指标查询 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警状态 | Module_08 | v0.3 | `docs/prototypes/module-08/` |
| 系统设置 | Module_06 / Module_04 | v0.4+ | `docs/prototypes/module-06/` |

> 本原型在左侧导航中保留上述入口的占位（disabled + Tooltip），避免模块原型成为孤岛；运行时状态（last_scrape / last_error / probe 值）由 Module_02 负责，不在本原型展示。

## 模块边界标注

- **Resource / LabelTemplate**：由 Module_07 提供，本模块只读引用（通过下拉选择）。
- **网域 / 配置下发**：网域（NetworkDomain）由 Module_09 维护，本模块选择引用；所有 ScrapeJob 必须绑定单一网域，实例选择已按网域过滤。Job 保存后由 Module_09 通过异步轮询（pull 模式）感知变更并生成对应网域的配置草稿，Module_01 不直接触发下发。
- **PromQL 校验 / 指标预览样本**：依赖 Module_02 / Prometheus；当前原型以本地静态指标库模拟校验。
- **规则生命周期**：规则保存后由 Module_08 接管（启用/禁用、分组、静默、Alertmanager 路由、告警状态）。
- **运行时状态**：`ScrapeTarget`、`ScrapeLog`、`probe_success` / `probe_duration` 等运行时数据由 Module_02 展示；本原型仅展示其静态指标定义（如 `m-013 probe_success` 是合法指标定义，非运行时状态）。

## 核心页面

- `/ci-exporter-mapping`：CI-Exporter 模板映射（CI 类型 ↔ Exporter 模板绑定管理）
- `/scrape-jobs`：采集 Job 管理（含 Transfer 实例选择 + Exporter 安装确认）
- `/rules`：告警 / 记录规则编辑（PromQL 校验 + 指标预览 + Labels/Annotations key-value 动态表单）
- `/metric-library`：指标库（按 Exporter 分组 + 用户扩展 + metric_type 筛选）

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；CRUD 操作通过 `useState` 维护列表，刷新后回滚到 mock 初始值。
- `instance_selection_mode=filter` 为 v0.3+ 预留，MVP 仅支持手动勾选（`instance_filter` 恒为 `null`）。
- `relabel_configs` 为 P2 预留，原型以 Alert 提示形式占位。
- 规则模板一键填充为 P1，原型以 disabled 占位按钮呈现。
- PromQL 校验为本地启发式解析（剥除字符串字面量 / label selector / by/without 子句后识别标识符），仅校验指标名是否存在于所选 Exporter 指标库或全局启用指标库；不调用 Prometheus 真实语法校验。
- 网络域隔离下「Exporter 安装确认」的工单号/安装记录字段仅作笔记，不联动 Module_09 的下发链路。
- 单网域/多网域模式开关（`Tenant.multi_site_enabled`）为演示开关，通过修改内存 mock 生效，刷新页面后重置为默认多网域模式。
- 标签模板的「前往标签模板管理」跨模块跳转链接指向 `../module-07/dist/index.html`，仅在统一静态入口 / GitHub Pages 部署结构下生效；dev 独立端口（5175）下该链接不可达（模块原型隔离所致）。
