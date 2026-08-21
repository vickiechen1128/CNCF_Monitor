# MetricCenter Module 04 原型

> **验证的 PRD 版本**: [Module_04_Custom_Discovery.md](../../02-product-requirements/Modules/Module_04_Custom_Discovery.md) v1.5
> **覆盖的产品版本**: v0.4+
> **原型版本**: v1.5
> **更新日期**: 2026-08-19
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-04
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5181/

## v1.5 变更说明（同步 PRD v1.4→v1.5，决策 D12~D17 落版）

- **业务登记与网域-业务正交（决策 D12~D17，2026-08-19）**：
  - Tenant 不再与 BlueKing Business 强制映射（租户 ≠ 业务）；蓝鲸同步不再把 Tenant 作为业务映射维度；
  - NetworkDomain → 云区域（Cloud Area）映射保留；CI 字段 → `cmdb_ci_id` / `cmdb_business_path` / `cmdb_module_path` / `cmdb_maintainer`；
  - BlueKing Business（`bk_biz_id` / `bk_biz_name`）→ M07 业务分组字典（`business_domain` = `bk_biz_id` / `display_name` = `bk_biz_name`），资源 `business_domain` 取自 `bk_biz_id`（或稳定业务路径编码），供 M07 LabelTemplate 生成 `biz` 标签；
  - 业务失败容错：同步失败时业务字典沿用旧快照，不影响标签生成与配置下发。
- Provider 配置页 BlueKing 字段映射说明与文案同步更新。

## 架构与字段映射

| MetricCenter 概念 | 外部概念 | 说明 |
|-------------------|----------|------|
| NetworkDomain | BlueKing Cloud Area（云区域） | 网域归属映射，同步维度保留 |
| Resource | BlueKing CI | `cmdb_ci_id` / `cmdb_business_path` / `cmdb_module_path` / `cmdb_maintainer` |
| 业务分组字典（M07） | BlueKing Business | `business_domain` = `bk_biz_id` / `display_name` = `bk_biz_name`；资源 `business_domain` 取自 `bk_biz_id`，供 `biz` 标签生成 |

> 决策依据与完整性说明见 `docs/05-execution-records/module-04/design-decisions.md`（评审说明由 MainLayout 右上角「评审说明」开关控制显隐）。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-04
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-04
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-04/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 04: 自定义服务发现与外部 CMDB 生命周期管理](../../02-product-requirements/Modules/Module_04_Custom_Discovery.md) 的核心交互（v0.4+ 扩展能力模块）：

1. **Provider 配置**：外部数据源（BlueKing / HTTP / Nacos / Kubernetes）的新增、配置与网域归属；BlueKing 字段映射说明。
2. **同步策略**：同步策略的新增、立即触发与失败处理展示。
3. **CMDB CI 类型映射**：三列完整推导链（CI 类型 `bk_obj_id` 只读 → 资源类别 + 子类型 → 监控对象类型只读推导）。
4. **待分类 CI 队列**：未映射 / 禁用 / 缺字段的 CI 原始数据预览、指派资源类别与子类型、忽略。
5. **孤儿资源**：按网域 + 资源类别分组的孤儿虚拟 CI 与保留期管理。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| Provider 配置 | Module_04 | v0.4+ | 当前原型 `/providers` |
| 同步策略 | Module_04 | v0.4+ | 当前原型 `/sync-policies` |
| CI 类型映射 | Module_04 | v0.4+ | 当前原型 `/cmdb-mapping` |
| 待分类 CI | Module_04 | v0.4+ | 当前原型 `/pending-ci` |
| 孤儿资源 | Module_04 | v0.4+ | 当前原型 `/orphans` |
| 资源管理 | Module_07 | MVP | `docs/prototypes/module-07/` |
| 配置中心 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |
| 系统设置 | Module_06 | v0.4+ | `docs/prototypes/module-06/` |

## 核心页面

- `/providers`：Provider 配置 — 外部数据源列表与新增/编辑表单（类型、网域、同步周期、连接参数），BlueKing 字段映射说明。
- `/sync-policies`：同步策略 — 策略列表、立即同步、失败处理展示。
- `/cmdb-mapping`：CMDB CI 类型映射 — 三列推导链、启用/禁用、为 CI 类型指派资源类别与子类型。
- `/pending-ci`：待分类 CI 队列 — 原始数据预览、指派、忽略；新类型接入闭环引导。
- `/orphans`：孤儿资源 — 按网域 + 资源类别分组、恢复 / 转手动 / 删除。

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API。
- 本模块为 v0.4+ 扩展能力模块，MVP 阶段资源由 Module_07 Excel 导入维护，不在本原型演示。
- 业务分组字典（`business_domain` / `display_name`）的维护入口在 Module_07，本模块只消费同步结果。
- K8s / Nacos 发现仅提供 Provider 配置占位，未实现运行态交互。