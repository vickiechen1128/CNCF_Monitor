# MetricCenter Module 06 原型

> **验证的 PRD 版本**: [Module_06_Multi_Tenant.md](../../02-product-requirements/Modules/Module_06_Multi_Tenant.md) v2.2
> **覆盖的产品版本**: MVP / v0.2 / v0.4 / v1.0
> **原型版本**: v2.3
> **更新日期**: 2026-08-21
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-06
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5182/

## v2.3 变更说明（两段式评审返工 R1~R5，2026-08-21）

1. **R1 network_domain_id 前缀规范**：新建网域 ID 由 `nd-<name>` 改为按 `<deploy_code>-<domain_code>` 自动生成（deploy_code 默认 `mc`，如 `mc-edge`）；`default` 管理域为历史预置、**无前缀**——mock 数据 `nd-default` 改为 `default`，`nd-edge/finance/manufacturing` 改为 `mc-*`，与 PRD §9.2 / §5.2 技术验收对齐。
2. **R2 技术术语去裸暴露**：`message.error` 与「授权租户」`extra` 中的后端字段名 `multi_site_enabled=false` 改为「未开启多网域能力」用户语言。
3. **R3 去版本/阶段标记**：「登记归属」编辑只读 `extra` 的 `v0.2+ 走独立的归属转移动作` 改为面向用户的「请联系平台管理员走归属转移流程」。
4. **R4 补 M09 跳转入口**：未纳管网域行内新增「配置纳管（M09）」按钮，跳转 Module_09 网域纳管页并预选当前网域（M09 侧同步读取 `?network_domain=` 参数自动打开纳管弹窗）。
5. **R5 禁用=冻结传导告知**：禁用二次确认影响范围补充联动 Module_01（该网域禁止新建监控任务）与 Module_09（该网域不再生成新变更单，存量下发与回滚不受影响）一句，闭环决策 30 冻结语义。

## v2.2 变更说明（同步 PRD v2.1→v2.2，决策 23 MVP 缺憾补漏）

- **登记归属创建后不可变更（决策 23）**：编辑表单移除「登记归属」字段，编辑时仅只读展示原归属；新建时默认固定 platform_admin，extra 注明「创建后不可变更」。
- **授权租户改为可选（决策 23）**：`authorized_tenant_ids` 去必填（PRD：可选，缺省 = 登记归属租户），新建表单默认回填 platform_admin。
- **禁用 = 冻结语义（决策 23）**：禁用二次确认弹窗展示影响范围（M07 资源引用数 / 已纳管 EdgeAgent 数），文案明确「禁用后拒绝新资源登记与新纳管、存量资源与采集不受影响（停止采集由 Module_09 退纳管决定）」；成功提示改「已禁用（冻结）」。
- **空网域删除（决策 23）**：操作列新增「删除」，仅空网域（未纳管、无资源引用）可删（软删）；已纳管网域删除被拒并引导走「禁用」；`default` 管理域不可删除。
- **zone-type 只读接口来源标注（决策 23）**：mock `ZONE_TYPE_OPTIONS` 注释补「由 `GET /api/v2/platform/zone-types` 提供、仅返回启用项」。

## v2.1 变更说明（同步 PRD v1.9→v2.1，决策 21~22 落版 + §11.1 筛选补齐）

- **业务字典术语统一为 `biz_code` / `biz_name`（决策 21）**：PRD §4.3 / §9.2 / §10 将 `business_domain` 改为 `biz_code` / `biz_name`（指标标签保持 `biz`，`biz_name` 展示名可改、不进标签）；M06 页面不承载业务，mock 与页面注释同步术语。
- **列表筛选补齐（PRD §11.1）**：租户管理页新增名称 / 状态筛选；网域管理页新增登记归属 / 网络区域类型 / 状态 / 授权租户筛选；审计日志页新增操作类型 / 操作人 / 操作时间筛选。

## v2.0 变更说明（同步 PRD v1.9→v2.0，决策 18~20）

- **网域可跨租户共享（决策 18~20 落版）**：网域为部署级资源，登记归属（`tenant_id`）固定平台运营部（platform_admin），登记 ≠ 独占；通过新增「授权租户」（`authorized_tenant_ids`，1 网域 : N 租户）授权多个租户共享使用（授权 ≠ 拥有）。
  - 网域页：表格新增「授权租户」列，表单「所属租户」改为「登记归属」（MVP 固定 platform_admin）+ 新增「授权租户」多选；ID 按部署级前缀自动生成（`nd-<名称>`）；创建/编辑不再校验网域只能归属一个租户。
  - 租户页：`multi_site_enabled` 语义改为「是否允许该租户被授权使用多个网域」；「被授权网域」说明补充「授权 ≠ 拥有、网域可跨租户共享」。
  - mock 数据：`nd-default` 演示「1 网域 : N 租户」跨租户共享（授权使用：平台运营部 + 电商研发部）；`nd-finance` 登记归属改平台运营部、授权金融运维部使用。

## v1.9 变更说明（同步 PRD v1.7~v1.9）

- **网域登记纳入 MVP（PRD v1.7，评审结论 E 组）**：网域管理页提供行政登记（创建 / 编辑 / 禁用，`default` 管理域不可禁用），M06 为网域行政 Owner；租户页与网域页维持「授权 ≠ 已纳管」语义。
- **租户与业务解耦（PRD v1.8/v1.9，决策 12~17）**：租户页移除「CMDB 业务 ID / 业务路径」列与表单项；租户 mock 名称改为团队/组织语义（平台运营部 / 电商研发部 / 金融运维部），体现「租户 = 权限边界 ≠ 业务」；业务（`biz_code` / `biz_name`）为资源分组维度、由 Module_07 维护，不在本模块展示。
- 版本声明与 ReviewNote 决策清单更新到 v1.9。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-06
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-06
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-06/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 06: 系统与平台管理（含多租户）](../../02-product-requirements/Modules/Module_06_Multi_Tenant.md) 的核心交互（基于 PRD v2.2）：

1. **租户管理**：租户生命周期（创建 / 编辑 / 禁用）与「被授权网域」分配；`multi_site_enabled` 行政能力开关（关闭时仅被授权单个网域，但不影响 default 网域查看）；租户为权限/管理边界，不承载业务映射。
2. **网域管理（M06 行政 Owner）**：网域行政登记（名称 / 登记归属 / 授权租户 / `zone_type` / 状态，ID 按部署级前缀自动生成 `nd-<名称>`），网域为部署级资源、可跨租户共享（授权 ≠ 拥有），`default` 管理域不可禁用；监控纳管（Edge Agent / 凭据）由 Module_09 执行；`network_domain_id` 全局唯一、登记归属创建后不可变更；禁用 = 冻结（二次确认展示影响范围、拒绝新登记与新纳管、存量不受影响）；空网域可删除（软删）、非空网域引导走禁用。
3. **用户与权限（v1.0+ / 外部 IAM 承接）**：租户内角色分配占位。
4. **审计日志与平台配置**：操作 / 变更 / 登录日志，TSDB Retention / Remote Write / 全局 scrape 限制。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 系统设置-租户管理 | Module_06 | MVP / v0.2 | 当前原型 `/tenants` |
| 系统设置-网域管理 | Module_06 | MVP | 当前原型 `/network-domains` |
| 系统设置-用户与权限 | Module_06 | v1.0+ | 当前原型 `/users` |
| 系统设置-审计日志 | Module_06 | v0.2+ | 当前原型 `/audit-logs` |
| 系统设置-平台配置 | Module_06 | v0.2+ | 当前原型 `/platform-settings` |
| 配置中心-网域纳管 | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |

## 核心页面

- `/tenants`：租户管理 — 租户列表与新建/编辑表单（租户名称 / 被授权网域 / 多网域能力 / 状态），被授权网域数据源为网域管理页行政记录，选项标注纳管状态；网域可跨租户共享（授权 ≠ 拥有）。
- `/network-domains`：网域管理（行政登记）— 网域列表与新建/编辑表单（名称 / 登记归属 / 授权租户 / `zone_type` / 状态），`default` 不可禁用；登记归属 MVP 固定 platform_admin，授权租户支持多选（multi_site_enabled=false 的租户仅可被授权单个网域）。
- `/users`：用户与权限 — 用户列表与角色分配（平台管理员 / 租户管理员 / 运维工程师 / 只读用户）。
- `/audit-logs`：审计日志 — 操作 / 资源 / 操作人 / 变更 Diff 查看。
- `/platform-settings`：平台配置 — TSDB 保留 / Remote Write 转发 / 全局 scrape 限制。

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API。
- 用户 / 角色 / 权限策略可能由外部 IAM/SSO 承接，本原型以占位形式展示；请求级审计事件由 Module_03 收集。
- 网域监控纳管（Token / Remote Write / Edge Agent）为 Module_09 职责，本模块只做行政登记与「已纳管」状态回显。
