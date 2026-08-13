# MetricCenter Module 07 原型

> **验证的 PRD 版本**: [Module_07_Monitoring_Object_Management.md](../../02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) v2.7
> **覆盖的产品版本**: MVP / v0.4 / v1.0
> **原型版本**: v2.3
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-07
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5174/

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-07
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-07
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-07/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 07: 监控对象管理](../../02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) 的核心交互：

1. **资源管理（MVP）**：四类资源（主机 / 中间件 / 应用服务 / 通用指标目标）的固定列列表、新增 / 编辑 / 删除、网域归属、已监控 badge；`is_monitored` 由 Module_01 维护，Module_07 只读展示。
2. **标签模板管理（MVP）**：左右分栏——左侧模板列表（资源类型 Tab + 搜索框 + 默认/自定义筛选，展示模板 ID），右侧映射明细按来源类型分组（组合字段 / 资源字段）；模板与映射编辑统一使用右侧抽屉，保留上下文；字段来源 MVP 支持资源字段 / 组合字段（`cmdb_field` v0.4+ 预留，`prometheus_builtin` 由 Prometheus 原生注入、MVP 隐藏）；新增映射目标标签默认预填来源字段（composite 默认 instance）；转换规则下拉可留空（无/lower/upper，prefix/replace P1 置灰）；保存时校验保护 label 与同模板目标标签唯一；MVP 不做分页。
3. **资源标签管理（MVP）**：为单个资源添加 / 编辑 / 删除 label，key 校验（小写字母数字下划线、禁止 `__` 开头、长度 ≤128、禁止覆盖 Prometheus 内置 label），CMDB 冲突琥珀色提示，冲突优先级 CMDB > 用户 > 系统。
4. **Excel 导入（MVP）**：按资源类型展示固定列模板（含 `network_domain` 列），导入结果弹窗演示校验项与状态映射（运行中→online、已停止→offline、维护中→maintenance），导入记录页可查看错误报告明细。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | 当前原型 |
| 标签模板 | Module_07 | MVP | 当前原型 |
| 导入记录 | Module_07 | MVP | 当前原型 |
| 监控策略 | Module_01 | MVP | `docs/prototypes/module-01/` |
| 配置中心 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |
| 指标查询 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警状态 | Module_08 | v0.3 | `docs/prototypes/module-08/` |
| 系统设置 | Module_06 / Module_04 | v0.4+ | `docs/prototypes/module-06/` |

## 核心页面

- `/resources`：资源管理（四类资源 Tab、按类型固定列、详情抽屉标签管理、新增/编辑/删除、Excel 导入与模板弹窗）
- `/label-templates`：标签模板（左侧模板列表 + 右侧 mappings 表格，模板级增删改）
- `/import-history`：导入记录（状态映射说明 + 错误报告详情）

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API。
- Excel 导入为 mock 演示：不真实生成 / 上传文件，「下载模板」以弹窗展示固定列模板，「Excel 导入」直接展示导入结果（含校验项与状态映射说明）。
- v0.4+ 能力（CMDB 字段来源、`cmdb_ci_id` / `cmdb_business_path` / `cmdb_module_path` / `cmdb_maintainer` 字段、CMDB 同步标签）以占位 / {v0.4+} 标注形式展示。
- 网域生命周期由 Module_09 负责，本原型仅提供 `default` 与 `gov-cloud-a` 两个网域供资源归属选择。
