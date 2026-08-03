# MetricCenter Module 01 原型

> **验证的 PRD 版本**: [Module_01_Metric_Collection_Center.md](../../02-product-requirements/Modules/Module_01_Metric_Collection_Center.md) v1.1
> **覆盖的产品版本**: MVP / v0.3 / v1.0
> **原型版本**: v1.1
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

1. **CI 类型 ↔ Exporter 模板绑定**：维护 `CITypeExporterMapping`，含默认端口/路径/协议/采集参数；内置绑定禁止删除。
2. **采集 Job 管理**：Job 增/改/删，关联 CI 类型、Exporter 模板、网域；实例选择 MVP 手动勾选，v0.3+ 预留 `instance_filter`；Export 安装确认（点状态徽标循环 + 弹窗填确认人/备注）。
3. **规则编辑**：告警 / 记录规则编辑，`rule_type=recording` 时隐藏 `duration` 与 `annotations`；Labels/Annotations key-value 动态表单；PromQL 交互式校验（成功/失败 Alert，失败给具体错误如「未知指标名 xxx」）；选 `exporter_template_id` 后从指标库过滤预览；P1「规则模板一键填充」占位按钮。
4. **指标元数据**：按 Exporter 分组浏览；新增/编辑用户扩展指标（`is_builtin=false`）；内置指标禁止编辑/删除；`enabled` 切换（禁用指标不参与规则提示）；按 `metric_type` 筛选。
5. **拨测配置**：Blackbox 探测目标 CRUD；目标归属网域关联；MVP 不展示拨测运行时结果（`probe_success`/`probe_duration` 由 Module_02 展示）。

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
- **网域 / 配置下发**：网域（NetworkDomain）由 Module_09 维护，本模块选择引用；Job 保存后由 Module_09 轮询生成配置草稿并下发。
- **PromQL 校验 / 指标预览样本**：依赖 Module_02 / Prometheus；当前原型以本地静态指标库模拟校验。
- **规则生命周期**：规则保存后由 Module_08 接管（启用/禁用、分组、静默、Alertmanager 路由、告警状态）。
- **运行时状态**：`ScrapeTarget`、`ScrapeLog`、`probe_success` / `probe_duration` 等运行时数据由 Module_02 展示；本原型仅展示其静态指标定义（如 `m-013 probe_success` 是合法指标定义，非运行时状态）。

## 核心页面

- `/ci-exporter-mapping`：CI 类型 ↔ Exporter 模板绑定管理
- `/scrape-jobs`：采集 Job 管理（含 Transfer 实例选择 + Exporter 安装确认）
- `/rules`：告警 / 记录规则编辑（PromQL 校验 + 指标预览 + Labels/Annotations key-value 动态表单）
- `/metric-library`：指标元数据（按 Exporter 分组 + 用户扩展 + metric_type 筛选）
- `/probes`：拨测配置（含网域关联）

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；CRUD 操作通过 `useState` 维护列表，刷新后回滚到 mock 初始值。
- `instance_selection_mode=filter` 为 v0.3+ 预留，MVP 仅支持手动勾选（`instance_filter` 恒为 `null`）。
- `relabel_configs` 为 P2 预留，原型以 Alert 提示形式占位。
- 规则模板一键填充为 P1，原型以 disabled 占位按钮呈现。
- PromQL 校验为本地启发式解析（剥除字符串字面量 / label selector / by/without 子句后识别标识符），仅校验指标名是否存在于所选 Exporter 指标库或全局启用指标库；不调用 Prometheus 真实语法校验。
- 网络域隔离下「Exporter 安装确认」的工单号/安装记录字段仅作笔记，不联动 Module_09 的下发链路。
