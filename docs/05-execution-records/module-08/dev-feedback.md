# dev-feedback 登记单 — Module_08 Alertmanager 通知收敛

> 归属：backend-developer / frontend-developer（Agent 可写区 `docs/05-execution-records/module-08/`）
> 登记原则：① PRD 未规定的空白/细节判决策、③ 原型纯技术优化在此留痕；② PRD 已规定但实现发现矛盾需实现前报告 Orchestrator，禁止事后当既成事实塞入。

## 格式约定

| 字段 | 说明 |
|------|------|
| 类别 | ① 空白判定 / ③ 技术优化 / 契约口径确认 / 环境与构建 |
| PRD 章节 / 文件位置 | 来源 |
| 现状 | 实现当前行为 |
| 建议 / 结论 | 判定或建议 |
| 影响模块 | 前端 / 后端 / 构建 |
| 发现场景 | 何时定位 |

---

## 1. Alertmanager 配置挂载校验：amtool 环境与运行目标（F-08 基础设施）

- **类别**：③ 技术优化 / 环境与构建
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §3.4（配置挂载校验，效仿 M09 promtool 先例）；源码 `Makefile`、`deploy/alertmanager/alertmanager.yml`（新增）
- **现状 / 结论**：为支撑 AM 配置挂载校验与本地运行，补齐环境目标：
  - `build-amtool`：构建上游 `amtool`（`amtool check-config` 命令行）到 `upstream/alertmanager/amtool`，GOPROXY 走国内代理（对齐 `build-promtool`）；
  - `build-alertmanager` 内置追加 `amtool` 编译，`build-center` 交付包随之携带；
  - `run-metric-center` 依赖链补 `build-amtool`，并在 PATH 注入 `upstream/alertmanager`，使配置挂载校验经 `exec.LookPath("amtool")` 可定位 `amtool`（同 M09 promtool）；
  - 新增 `deploy/alertmanager/alertmanager.yml` 模板并新增 `run-alertmanager` 目标：首跑把模板 seed 到 `config-output/alertmanager.yml`（DiskApplier 写盘目录），以 `--config.file` 指向并监听 `:9093`，供 M08 静默代理与 AM 配置挂载 reload 使用；`run-alertmanager` 依赖 `build-alertmanager`（其中已含 amtool，不再重复编译）。
  - `clean` 补删 `upstream/alertmanager/amtool`。
- **影响模块**：构建（Makefile）、后端（AM 配置挂载校验）
- **发现场景**：M08 AM 配置挂载校验缺 amtool 可调用与本地 Alertmanager 环境；用户原始告警「`dingtalk_configs not found in type config.plain`」实为挂载了非法接收器字段，正确修复为 `receivers[].webhook_configs`（官方 Alertmanager 不原生支持 `dingtalk_configs`），与 amtool 环境是否就绪无关——amoutl 仅负责结构校验，非法字段仍需前端/用户改写。

---

## 2. Alertmanager ElM UI 构建：操作空间路径含空格导致 vite-plugin-elm 读不到 src/Main.elm

- **类别**：③ 技术优化 / 环境与构建（避坑）
- **PRD 章节 / 文件位置**：`build-alertmanager`（`upstream/alertmanager/ui/app`，`npm ci && npm run build`）
- **现状**：本项目操作空间路径含空格（`/Users/.../03 AIopsAgent-study/CNCF_Monitor-feature`）。上游 Alertmanager 的 ElM UI 构建依赖 `vite-plugin-elm`，其解析 `src/Main.elm` 时对含空格路径处理不稳，直接 `npm ci && npm run build` 会失败。
- **结论**：`build-alertmanager` 改为「先判断 `ui/app/dist` 是否存在：已存在则跳过 UI 构建，直接编译 Go 二进制」。团队预先将构建好的 UI 产物放入 `upstream/alertmanager/ui/app/dist`，从而绕过含空格路径下的 ElM 构建失败。注意 `ui/app/dist` 在上游子模块内，不进主仓库版本控制，CI/新协作者首次构建仍需处理或预置。
- **影响模块**：构建（Makefile `build-alertmanager`）
- **发现场景**：首次执行 `make build-alertmanager` 时 vite-plugin-elm 读不到 `src/Main.elm` 构建中断。

## 3. 静默管理代理对接的 Alertmanager API 版本已从 v1 迁移到 v2（② 实现偏差，已修复）

- **类别**：② 实现偏差（底层依赖的 API 淘汰导致接口必然失效）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.2/§6.3/§9.1/§9.2、`docs/05-execution-records/module-08/api-contract-snapshot.md` §4；源码 `platform/alertmanager/silence/proxy.go`、`silence/service.go`、`silence_test.go`、`platform/cmd/metric-center/main_test.go`（fake Alertmanager）
- **现状 / 根因**：用户反馈「静默列表加载失败：中心 Alertmanager 服务不可达或未启动」。排查后发现两层原因叠加：
  1. **需先启动 Alertmanager**：静默管理是 metric-center → Alertmanager(:9093) 的代理，仅启动 metric-center(8080)/Prometheus(9090) 不够，必须 `make run-alertmanager` 拉起 :9093（此前 9093 未就绪即报「不可达」502）。
  2. **真正的持久 bug——代理仍调用了已被移除的 v1 API**：当前 Alertmanager（≥0.27）已删除 `GET/POST /api/v1/silences`、`GET/DELETE /api/v1/silence/{id}`，这些路径现返回 **HTTP 410 Gone**；`proxy.go` 未适配，导致即便 AM 已在运行，静默列表/创建/删除仍一律 502（`解码到非 200` 判错）。v2 与 v1 响应形状也不同，不能只改路径前缀。
- **落地改动（v1 → v2 迁移）**：
  - 端点：`/api/v1/silences` → `/api/v2/silences`、`/api/v1/silence/{id}` → `/api/v2/silence/{id}`（List/Create/Get/Delete 四处）。
  - 响应 DTO：v2 列表为**裸数组**（`decodeList` 直接解码 `[]amSilence`，不再用 v1 的 `{status,data}` 信封 `amListResponse`，已移除该类型）；v2 单条为**裸对象**（`GetSilence` 直接解码 `amSilence`）；v2 创建直接返回 `{"silenceID":...}`（`amCreateSilenceResponse` 改为 `{SilenceID string \`json:"silenceID"\`}`，非 v1 的 `{status,data:{silenceID}}`）。
  - 同步更新两处测试 fake：`silence_test.go` 的 `fakeAM.handler()` 与 `main_test.go` 的 `fakeAlertmanager` 均改为 `/api/v2/*` 路由 + 裸数组/裸对象/裸 create 形状。
- **验证**：`go test ./platform/alertmanager/silence/...` 通过；`go test ./platform/cmd/metric-center/... -run TestEndToEndAlertmanagerSmoke` 通过；`go test ./platform/...` 全量通过；`go vet` 干净；已重新编译 `metric-center` 二进制。
- **影响模块**：M08 静默管理（列表 / 创建 / 删除）。需重启后端生效：`make run-metric-center`（会先停旧进程再启动新二进制）。
- **发现场景**：M08 静默管理实测报错，用户提示「后端已启动」。
- **状态**：closed（代码已修复；PRD v1.8 / api-contract-snapshot v2026-09-04 / design-decisions 决策 61 已同步 v1→v2 迁移；运行侧恢复步骤：确保 `make run-alertmanager` 已拉起 :9093，再 `make run-metric-center` 重启后端使新二进制生效）

## 4. 告警状态代理 `io.ReadAll` 无大小上限（③ 技术优化 / LOW，golang-reviewer）

- **类别**：③ 技术优化
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §9.2（告警状态查看）；源码 `platform/alertmanager/alerts/proxy.go`（`ListAlerts`）
- **现状**：`ListAlerts` 对 Alertmanager `GET /api/v2/alerts` 响应使用 `io.ReadAll(b)` 一次性读入，无大小上限；当 AM 告警列表超大时存在内存耗尽风险。
- **结论**：MVP 可接受，暂不改动；建议后续为响应体加 `http.MaxBytesReader` 上限，或通过 AM 支持的状态/过滤参数（active/silenced/inhibited/unprocessed）与服务端分页减少全量拉取。
- **影响模块**：后端（告警状态代理）
- **发现场景**：M08 告警状态查看 golang-reviewer 审查（LOW）

## 5. 前端 effect 内触发 setState 未包 `act()`（③ 技术优化 / LOW，frontend-reviewer）

- **类别**：③ 技术优化
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §9.2；源码 `ui-custom/web/src/pages/alerts/useAlertStatus.ts`（`useAlertView` effect 内 `void load()`）
- **现状**：`useAlertView` 在 `useEffect` 中触发异步 `load()`（后置 setState），antd 组件测试中出现 "An update ... not wrapped in act(...)" 警告（非阻塞，测试已全部通过）。已通过 `eslint-disable-next-line react-hooks/set-state-in-effect` 规避 lint。
- **结论**：非阻塞，测试通过即保持现状；后续如需消除警告，可在测试侧以 `waitFor`/`act` 包住断言，或重构为请求后计算派生状态。
- **影响模块**：前端（告警状态页）
- **发现场景**：M08 告警状态查看 frontend-reviewer 审查（LOW）

## 6. 告警状态授权恒 AllDomains 与 CURRENT_USER 硬编码（契约口径确认 / LOW，security-reviewer）

- **类别**：契约口径确认（安全）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §9.2、决策 56/19；源码 `platform/alertmanager/alerts/handler.go`（`authorizedScopeForUser`）、`ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`（`CURRENT_USER`）
- **现状**：
  1. `authorizedScopeForUser` 恒返回 `AllDomains=true`（MVP 单租户恒通过，决策 56 骨架保留）；多租户时需从认证上下文解析真实授权网域集合，否则存在越权敞口。
  2. `alertmanagerConstants.ts#CURRENT_USER = '张伟（运维）'` 为 MVP 预置应用人/创建人硬编码（决策 19 文档化妥协），接入 M06 登录后须改用真实账号。
- **结论**：MVP 单租户 + 全局认证下均非实际风险，记为 LOW；多租户落地 / M06 登录接入时必须移除。
- **影响模块**：后端（告警状态授权骨架）、前端（登录接入）
- **发现场景**：M08 告警状态查看 security-reviewer 审查（LOW）

## 7. 告警状态页「网域」列无数据：代理只读标签不回写（② 实现偏差，已修复）

- **类别**：② 实现偏差（跨模块标签键口径 + 代理回写语义缺失，已修复）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.4/§9.2；`Module_02_Query_Center.md` §6.1/§11.2#5；`docs/05-execution-records/module-08/api-contract-snapshot.md` §10.1/§10.2；源码 `platform/query/alerts.go`、`platform/query/alerts_history.go`、`platform/alertmanager/alerts/service.go`、新增 `platform/models/network_domain_label.go`
- **现状 / 根因**：用户反馈「M08 Prometheus 当前触发告警中的『网域』字段没有取到数据」。实测 `GET http://localhost:9090/api/v1/alerts` 的告警标签为 `{alertname, app, biz, category, env, instance, job, resource_id, severity, team}`——**不含任何网域键**。三层原因叠加：
  1. **上游不携带 external_labels**：Prometheus 仅在 remote write / federation / 发往 Alertmanager 时附加 `global.external_labels`；`GET /api/v1/alerts` 返回的是规则求值标签（`rules/alerting.go` 的 `lb = metric 标签 + rule labels + alertname`），天然无网域键。
  2. **标签键口径不一致**：M09 生成 `global.external_labels.network_domain_id`（决策 19 / PRD §3.3.1，实测 `config-output/prometheus.yml` 亦为 `network_domain_id: default`），而 M02/M08 代理按 `labels.network_domain` 读取（M02 决策 4.4 契约键）——即便某条链路带上了网域标签也对不上。
  3. **代理未回写回落值**：`platform/query/alerts.go` 与 `platform/alertmanager/alerts/service.go` 把缺失标签回落为 `default` **仅用于服务端过滤**，从未把结果写回响应 `labels`；前端 `labelOf(r,'network_domain')` 读到空值 → 「网域」列对每一行渲染 `-`。而同构的 `platform/query/targets.go` 是回写的（`t["network_domain"] = resDomain`）——同族代理行为不一致。
- **落地改动**：
  - 新增共享解析器 `platform/models/network_domain_label.go`：常量 `NetworkDomainLabelKey`（`network_domain`）/ `NetworkDomainIDLabelKey`（`network_domain_id`），`ResolveNetworkDomain`（`network_domain` → `network_domain_id` → `default`，nil map 安全）与 `EnsureNetworkDomain`（回写并返回映射，nil 时新建）。
  - `platform/query/alerts.go`：改用共享解析器，并把解析结果回写 `labels.network_domain`（契约 §10.1 的 UI 展示字段）。
  - `platform/alertmanager/alerts/service.go`：同上（契约 §10.2 展示名同 §10.1），AM 侧标签由通知链路附加 external_labels 构成、键为 `network_domain_id`，归一后回写。
  - `platform/query/alerts_history.go`：`rebuildIntervals` / `buildHistoryItem` 两处回落逻辑收敛到共享解析器（历史告警 `network_domain` 为顶层字段，原已回落 `default`，本次补 `network_domain_id` 识别）。
- **验证**：新增 `platform/models/network_domain_label_test.go`、`platform/query/alerts_test.go`（`TestAlertsNetworkDomainWriteBack` / `TestAlertsNetworkDomainFromExternalLabelKey`）、`platform/alertmanager/alerts/alerts_test.go`（`TestServiceListNetworkDomainWriteBack` / `TestServiceListNetworkDomainFromExternalLabelKey`）、`platform/query/alerts_history_test.go`（`TestAlertHistoryNetworkDomainFromExternalLabelKey`）；`go test ./platform/...` 27 包全通过、`go vet` 干净。
- **遗留决策点（待用户拍板，未擅自改动）**：M02 决策 4.4 规定注入标签 key 统一为 `network_domain`（并声明 v1.1 的 `network_domain_id` 已弃用），而 M09 决策 19 / v1.45 又将 `external_labels` 收敛为 `network_domain_id`——两侧契约对同一概念给出不同键名。本次以「消费侧读 `network_domain`、兼容写入侧 `network_domain_id`」的归一方式绕开冲突，未改任何一侧契约；建议后续在 M02/M09 之间正式收敛为一套键名并在 `Modules/README.md` 快照同步。
- **影响模块**：M02 查询代理（alerts / alerts_history）、M08 告警状态页（两视图）、M09 external_labels 口径（仅遗留决策点）
- **发现场景**：M08 告警状态页「Prometheus 当前触发告警」实测（本地 Prometheus :9090 有 2 条 firing 告警，但「网域」列全空）
- **状态**：closed（代码 + 契约快照 §10 + 测试已同步；需重启后端生效：`make run-metric-center`）
- **发现场景**：M08 告警状态查看 security-reviewer 审查（LOW）