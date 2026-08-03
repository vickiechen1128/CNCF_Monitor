# MetricCenter Module 09 原型

> **验证的 PRD 版本**: [Module_09_Network_Domain_and_Edge_Config_Center.md](../../02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) v1.2
> **覆盖的产品版本**: MVP / v0.2 / v1.0
> **原型版本**: v1.2
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-09
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5178/

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-09
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-09
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-09/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 09: 网域与边缘配置中心](docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 的核心交互：

1. **单网域 / 多网域模式切换**：通过 `Tenant.multi_site_enabled` 开关演示两种模式下的 UI 差异。
2. **网域管理**：注册、编辑、删除网域；`default` 管理域可修改名称/描述但禁止删除。
3. **Edge Agent 状态**：查看各网域 Agent 在线状态、配置同步、WAL 积压。
4. **配置生成 / 预览 / Diff / 下发**：按网域生成 `prometheus.yml` 草稿，人工确认后触发下发。
5. **下发记录与回滚**：查看历史下发记录并回滚到上一版本。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 资源管理 | Module_07 | MVP | `docs/prototypes/module-07/` |
| 监控策略 | Module_01 | MVP | `docs/prototypes/module-01/` |
| 配置中心 | Module_09 | MVP / v0.2 | 当前原型 |
| 指标查询 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警状态 | Module_08 | v0.3 | `docs/prototypes/module-08/` |
| 系统设置 | Module_06 / Module_04 | v0.4+ | `docs/prototypes/module-06/` |

> 本原型在左侧导航中保留上述入口的占位或跳转提示，避免模块原型成为孤岛。

## 模式开关

mock 数据中的 `currentTenant.multi_site_enabled` 控制原型演示模式：

- `false`：单网域模式，隐藏「网域管理」「Agent 状态」菜单，配置生成页不展示网域选择器。
- `true`：多网域模式，完整展示网域管理、Agent 状态、按网域配置下发。

## 核心页面

- `/network-domains`：网域管理（多网域模式下可见）
- `/edge-agents`：Agent 状态（多网域模式下可见）
- `/config-preview`：配置生成与预览
- `/deployments`：下发记录

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API。
- v0.4+ 的 mTLS 证书轮转、Token 轮换、边缘自治告警等能力以占位提示形式展示。
