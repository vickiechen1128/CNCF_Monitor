# MetricCenter Module 09 原型

> **验证的 PRD 版本**: [Module_09_Network_Domain_and_Edge_Config_Center.md](../../02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) v1.13
> **覆盖的产品版本**: MVP / v0.2 / v1.0
> **原型版本**: v1.9
> **更新日期**: 2026-08-05
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

验证 [Module 09: 网域与边缘配置中心](docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 的核心交互（基于 PRD v1.13）：

1. **单网域 / 多网域模式切换**：通过 `Tenant.multi_site_enabled` 开关演示两种模式下的 UI 差异。
2. **网域管理**：注册、编辑、删除网域；`default` 管理域可修改名称/描述但禁止删除；`domain_type` 区分管理域/边缘域；注册为登记制（Agent IP/主机名由心跳上报补全），`agent_type` 字段明确登记的是**采集器类型**（vmagent / prometheus-agent），Edge Sync Agent 为必装独立组件无需登记；Token 在 UI 中**完全脱敏展示**（不显示任何明文片段，完整值仅可通过复制按钮获取）；操作列收敛为「编辑 / 更多（安装指引、重置 Token）/ 删除」避免超出表格宽度；提供 Edge Agent 安装指引（Edge Sync Agent 部署定位：边缘监控代理节点独立客户端程序、outbound HTTPS 443 + 每网域 Token、中心无入站端口；**边缘节点组件构成**：Edge Sync Agent（必装）+ 采集器（vmagent/prometheus-agent）+ blackbox exporter（可选）；**一体化交付 + 职责边界**：离线二进制包为一体化包（Edge Sync Agent + 采集器二选一 + blackbox exporter 可选），安装后 Edge Sync Agent 自动部署并守护本节点采集器/blackbox 进程（启动顺序 blackbox → 采集器、异常自动重启并上报健康状态），不做下游节点 exporter 安装；安装指引为一步安装语义：① 安装一体化离线包（systemd、NETWORK_DOMAIN_ID / TOKEN 环境变量）② Agent 自动部署采集器（按网域 agent_type 选择，无需手动分别安装））。
3. **Edge Agent 状态**：查看各网域 Agent 在线状态、Agent IP（心跳登记，仅展示）、配置同步状态（in_sync / out_of_sync / manual_override）、WAL 积压、**采集器版本与运行状态**（PRD 3.2 采集器进程管理 / 6.3：本节点采集器由 Edge Sync Agent 部署守护，进程异常自动重启并上报健康状态，状态纳入 Agent 状态展示）；含「配置包 checksum 校验失败保留旧配置」（边缘传输校验失败演示，PRD 6.4 边缘②传输校验）与「本地手工兜底 manual_override」示例行。
4. **变更检测（pull 模式）**：展示 Module_09 异步轮询（默认 30s）检测 Module_01/07 各源表 `updated_at` 变化触发重算；「源数据版本触发预筛 + 生成后联合 checksum 裁决」两级机制，联合 checksum 纳入 targets 内容（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)）；变更检测状态可观测（上次检测时间 / 当前源数据版本 / 检测结果），三种结果均有演示：检测到变更生成草稿（gov / mfg）、无变更跳过重算（finance）、checksum 一致自动丢弃不进入确认（default，PRD 3.3.3「检测状态可观测」P1）。
5. **配置生成 / 预览 / Diff / 下发**：草稿列表展示所属网域（与下发记录页一致）、`source_data_version`、`trigger_summary`、联合 checksum 与下发前校验结果；默认仅展示待确认（pending）草稿，历史草稿（confirmed / discarded）可切换查看，确认/废弃仅对 pending 生效（PRD 3.4）；`prometheus.yml` 为 file_sd 骨架（file_sd_configs 引用 targets/*.json，不内联 targets）；配置包结构含 `targets/` 目录（按 job 分文件）；多文件 Tabs 预览（prometheus.yml / targets / rules.yml / blackbox.yml / metadata.json），diff 跟随当前 Tab 与上一 ConfigVersion 按文件对比；人工确认后触发下发。
6. **下发前校验**：promtool check config（file_sd 仅查文件存在性）、blackbox_exporter --config.check、configgen 侧 targets schema 校验（PRD 3.5.1）；校验失败（如 mfg 域 targets JSON 语法错误）标注「中心内容校验失败（PRD 6.4）」并在对应文件 Tab 上定位提示，且禁止确认下发；页面补充「校验分层（PRD 6.4）」说明——中心①内容校验（validation_status，防生成错误，失败阻止确认下发）与边缘②传输校验（config_sync_status，防传输损坏/篡改/半写）由同一份配置产物衔接，Agent 为「哑校验」（不做 promtool 级语法校验）、联合 checksum 双用途（中心草稿去重裁决 + 边缘拉包完整性校验）。
7. **下发记录与回滚**：查看历史下发记录（含下发前校验结果、blackbox.yml 是否参与）并回滚到上一版本。

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

- `/network-domains`：网域管理（多网域模式下可见）— CRUD、Token 生成/重置（UI 完全脱敏展示，完整值仅通过复制按钮获取）、操作列「编辑 / 更多（安装指引、重置 Token）/ 删除」、安装指引（Edge Sync Agent 部署定位 + 边缘节点组件构成（Edge Sync Agent 必装 + 采集器 + blackbox exporter 可选）+ 一体化交付与职责边界（Agent 管理本节点采集器/blackbox 进程，不做下游节点 exporter 安装）+ 一步安装）、管理域禁止删除
- `/edge-agents`：Agent 状态（多网域模式下可见）— 在线状态、Agent IP（心跳登记）、采集器版本（collector_version，Edge Sync Agent 版本经 Tooltip 展示，PRD 4.2 组合语义）、采集器状态（collector_status：running / stopped / unknown，Tooltip 说明「本节点采集器由 Edge Sync Agent 部署守护」）、config_sync_status 说明、边缘传输校验（PRD 6.4 / 6.3 第 5、6 条）与采集器进程管理（PRD 3.2 / 6.3 第 1 条）说明、checksum 校验失败示例
- `/config-preview`：配置生成与预览 — 变更检测状态（上次检测时间 / 源数据版本 / 检测结果，三种结果演示）、草稿列表（所属网域 / 默认仅待确认 / 历史草稿切换 / source_data_version / trigger_summary / 联合 checksum / 校验结果）、配置产物结构（按域类型分层：default 管理域=本地文件集，边缘域=zip 配置包含 metadata.json，含 targets/ 目录）、targets 前端数据驱动（动态遍历 targets_files 渲染子 Tab，新增 job 无需改前端）、file_sd 骨架与 targets 原子写说明、多文件 Tabs 预览 / 按文件 Diff、校验失败 Tab 定位、下发前校验提示、校验分层（PRD 6.4）说明（中心①内容校验 vs 边缘②传输校验、Agent 哑校验、联合 checksum 双用途）
- `/deployments`：下发记录 — 含下发前校验结果与 blackbox.yml 参与字段

## 设计意图 Banner

Content 顶部提供可关闭的「Module_09 设计意图」Alert（仿 Module_01 原型），说明：pull 模式异步轮询（默认 30s）检测 Module_01/07 各源表 `updated_at` 变化触发配置重算（Module_01/07 不主动通知）；变更检测采用「源数据版本触发预筛 + 生成后联合 checksum 裁决」；配置按网域生成且**产物形态按域类型分层**（中心管理域 default=本地文件集、无 zip/metadata.json；边缘域=zip 配置包 + metadata.json）；规则按 scope 分发（中心 central/both，边缘 edge/both v0.4+）。

## 已知限制

- 所有数据为本地 mock，不调用真实后端 API；联合 checksum 为原型演示用伪 sha256（seed 按「prometheus.yml+rules_yml+blackbox_yml+targets 内容」拼接），校验结果（promtool / blackbox --config.check / targets schema）为静态演示数据。
- targets_files 特殊 string 值（未闭合 JSON）仅用于演示 configgen 侧 schema 校验失败，真实系统由生成器在生成时拦截。
- v0.4+ 的 mTLS 证书轮转、Token 轮换、边缘自治告警等能力以占位提示形式展示。
