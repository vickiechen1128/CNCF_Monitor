# MetricCenter Module 08 原型

> **验证的 PRD 版本**: [Module_08_Alertmanager_Notification_Management.md](../../02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md) v1.7
> **覆盖的产品版本**: MVP / v0.3 / v1.0
> **原型版本**: v1.7
> **更新日期**: 2026-09-01
> **本地启动命令**:
>
> ```bash
> cd docs/prototypes/module-08
> pnpm install
> pnpm dev
> ```
>
> **访问地址**: http://localhost:5177/

## v1.7 变更说明（决策 59/60：文件挂载 + M09 变更确认管道，2026-09-01）

- **MVP 交付形态 = 文件挂载（决策 59）**：接收人 / 路由 / 抑制策略以整份 `alertmanager.yml` 文件挂载（上传或粘贴）方式提交，`amtool check-config` 等价校验（原型本地模拟，含行号定位）通过后才允许提交；校验失败保留上一版内容并记录失败原因（内容侧留痕），不进入变更单。
- **alertmanager.yml 纳入 M09 变更确认（决策 60）**：挂载提交后生成配置中心（M09）变更单（管理域 default scope），人工确认后由 M09 写中心 Alertmanager 配置路径并触发 reload，`change_status` 全链路回写本模块「下发状态」列（待确认 / 已确认待下发 / 已下发 / 已拒绝），点击「待确认」直达 M09 配置变更确认页（`#/config-preview`）。
- **历史版本回滚 = 重新挂载**：版本历史「查看」抽屉提供「重新挂载此版本」——把该版本内容填入挂载抽屉，重新走校验 + 提交流程（生成新变更单），而非直接覆盖生效。
- 静默规则提供极简 UI（API 直调语义），其余页面为只读演示。

## 构建产物验证

`pnpm build` 生成的 `dist/` 必须在 HTTP 服务下验证，且需同时验证**独立访问**与**统一入口访问**（与 GitHub Pages 部署结构一致）：

```bash
# 1. 构建
cd docs/prototypes/module-08
pnpm build

# 2. 独立访问验证
cd docs/prototypes/module-08
python3 -m http.server 8080 --directory dist
# 浏览器打开 http://localhost:8080/

# 3. 统一入口验证（推荐，模拟 GitHub Pages 统一视图）
cd docs/prototypes
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/module-08/dist/index.html
```

> ⚠️ 不要直接双击 `dist/index.html` 用 `file://` 协议打开，否则 ES Module 安全策略会导致白屏。

## 原型目标

验证 [Module 08: 告警收敛与通知管理](../../02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md) 的核心交互（基于 PRD v1.7）：

1. **告警通知状态**：Alertmanager 通知状态（active / silenced / inhibited / unprocessed）四态统计与列表，按通知状态 / 网域筛选；通知状态已按授权网域集合过滤（授权 = 全部网域时不附加过滤，决策 56 MVP 骨架提示）；当前触发规则（firing / pending）由 Module_02 查询中心代理 Prometheus `/api/v1/alerts` 展示，本模块不重复实现。
2. **路由规则**：Alertmanager route 树的只读展示（匹配条件 / 接收人 / group 参数 / continue）。
3. **通知渠道**：接收人（webhook / 飞书 / 钉钉 / 邮件 / 企业微信）列表与启停状态展示。
4. **静默规则**：极简 UI（创建 / 到期 / 失效语义，API 直调），状态 active / expired / pending。
5. **告警抑制**：抑制规则（含内置「网域离线抑制可达性风暴」）展示，source / target matchers 与 equal 字段。
6. **配置管理（Alertmanager 配置）**：文件挂载整份 `alertmanager.yml`（上传 / 粘贴）→ `amtool check-config` 校验（行号定位）→ 提交 M09 变更单（管理域 scope）→ 人工确认后由配置中心写中心 Alertmanager 配置路径并触发 reload；版本历史内容侧留痕（checksum / 操作人 / 校验失败原因）+ M09 回写的下发状态 + 「重新挂载此版本」回滚入口。

## 全局导航映射

| 菜单项 | 所属模块 | 产品版本 | 原型页面路径 |
|--------|----------|----------|--------------|
| 监控策略 | Module_01 | MVP | `docs/prototypes/module-01/` |
| 指标查询 / 当前告警 | Module_02 | MVP / v0.3 | `docs/prototypes/module-02/` |
| 告警收敛与通知 | Module_08 | MVP / v0.3 | 当前原型 |
| 配置中心（变更确认与下发） | Module_09 | MVP / v0.2 | `docs/prototypes/module-09/` |

## 核心页面

- `/alerts`：告警状态（Alertmanager 通知状态四态，授权网域过滤提示）
- `/routes`：路由规则（route 树只读展示）
- `/notifiers`：通知渠道（接收人列表）
- `/silences`：静默规则（极简 UI）
- `/inhibitions`：告警抑制（含内置规则）
- `/config`：Alertmanager 配置管理（文件挂载 + amtool 校验 + M09 变更单联动 + 历史版本重新挂载）

## 模块边界

- **Module_01**：告警规则内容创作（expr / for / labels）归 Module_01，本模块不再维护 AlertingRule / RuleGroup。
- **Module_02**：仅对外提供注入代理 API（当前触发告警由 M02 代理 Prometheus `/api/v1/alerts` 展示），本模块不重复实现 firing / pending 视图。
- **Module_09**：变更确认与下发管道 Owner——`alertmanager.yml` 作为管理域 default scope 产物进入 M09 变更确认（决策 60），人工确认后由 M09 下发并触发 Alertmanager reload，`change_status` 回写本模块；`rules.yml` 的生成与下发也由 M09 负责。
- **本模块（Module_08）**：Alertmanager 域内容 Owner——接收人 / 路由 / 静默 / 抑制的内容定义与 `alertmanager.yml` 文件挂载、校验、内容侧版本留痕。

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；amtool 校验为前端本地模拟（仅示意 receiver 引用闭合 / 顶层 route、receivers 段检查与行号定位），非真实 amtool。
- 授权网域过滤（决策 56）为 MVP 骨架提示文案，原型不做真实的授权集合过滤。
- 接收人 / 路由 / 抑制的表单化编辑 UI 为 v0.3 演示目标，MVP 以文件挂载为准。
- v1.0 的通知模板管理与通知升级（escalation）能力未在本原型呈现。
