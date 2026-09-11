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

## 8. 告警「实例」列口径对齐 M01 资源清单（① 空白判定 / ② 跨模块实现偏差，落地中）

- **类别**：① 空白判定（契约未定义 `labels.instance` 语义）+ ② 跨模块实现偏差（详情见 M01 `dev-feedback.md` F-38）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.4/§9.1/§9.2/§10（v1.15 增量，决策 70）；`docs/05-execution-records/module-08/api-contract-snapshot.md` §10.1/§10.2/§10.3；源码 `platform/query/alerts.go`、`platform/query/alerts_history.go`、`platform/alertmanager/alerts/service.go`、`ui-custom/web/src/pages/alerts/{AlertStatusPage,HistoryAlertsPage}.tsx`
- **现状 / 根因**：告警列表「实例」列直接展示 Prometheus `instance` 标签，取值链为 `_address__ = file_sd targets[] = generator.instanceAddress(ip, exporterPort)`，即 **`ip:exporter端口`**（host/database/middleware 默认 `:9100`）。两个问题叠加：① **不是实例名**——用户在 M01 看到的 `ceshi` 在告警里丢失；② **端口语义错位**——`:9100` 是采集器端口，用户从未填写，M01 里 MySQL 写 `3306`、告警里同一台机显示 `9100`，会被当成「配错了端口」或「另一台机器」。契约 §10.1/§10.2 原文对 `labels.instance` 的说明只有「告警实例」四字，**未定义语义**；且全文 grep `resource_id` = 0 次——回连 M01 的键（决策 47-3 强制注入）从未进入 M08 契约。
- **结论（决策 70，用户 2026-09-11 书面确认）**：三个视图统一拆「实例名 + 采集地址」两列；服务端按 `resource_id` **批量**回连 M01 五类资源表回填 `resource_name`（A 方案，覆盖存量告警、与改名实时一致）；「采集地址」表头挂 tooltip「采集器地址，非业务端口」；无 `resource_id` 时不回落成地址；历史告警「实例」筛选同时匹配实例名与采集地址；**不改 `instance` 标签本身**（`alertmanager.yml` 的 `group_by` / `equal` 依赖它）；不做实例→M01 深链。标签侧补 `instance_name`（M07 §5.12 A 已声明未实现）降为三期、范围收窄至 4 类静态资源。
- **跨模块连带（同批修复，详见 M01 `dev-feedback.md` F-38）**：
  1. M01 database / middleware Tab「实例名」列恒显示 `-`（列绑后端不产出的键）→ 改绑 `instance_ip`；
  2. M01 host Tab 副行 `hostname` 与主行 `instance_name` 同值 → 删除副行；
  3. `instanceDisplayOf` 回落链含死键 `hostname`、漏真键 `service_name` → 键序修订为 `instance_name → instance → instance_ip → service_name → nodename → device`（与三期共用同一段代码）。
- **影响模块**：M02 告警代理（`/api/v1/alerts`、`/api/v1/alerts/history`）、M08 告警状态页两视图 + 历史告警页、M01 资源列表三处（连带）、M07 PRD §5.12 A 口径澄清（已登记 M07 `dev-feedback.md` F-5，待设计侧收割）。
- **发现场景**：用户提问「M08 历史告警与状态告警中的实例字段代表实例名还是 IP+端口？建议与 M01 对齐」，核对取值链与契约后发现契约缺口与端口误导。
- **状态**：in_progress（契约快照 + PRD + 决策已落；代码与测试随本轮落地）
## 9. 告警状态 / 历史告警 / 静默管理说明框收敛与页签名友好化（② 实现偏差，用户驱动，已落地）

- **类别**：② 实现偏差（UI 文案与信息架构，用户书面确认 2026-09-11）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §3.2（两视图语义区分说明）/ §5.4；`docs/05-execution-records/module-08/task-sequence.yaml:446`（「Tab 说明区明确两视图语义区分」）；源码 `ui-custom/web/src/pages/alerts/{AlertStatusPage,HistoryAlertsPage,SilencesPage,CreateSilenceDrawer,AlertConfigDrawer}.tsx`
- **现状 / 根因**：用户三轮反馈收敛——①「每个子模块的蓝色说明条对用户不友好，参考 M01 折叠栏」；②「3 个页面顶部（内容区右侧最上）的独立说明板块没有必要，但折叠栏 / 列头角标等指引形式仍需要；说明文字与页签名（Alertmanager 通知状态 / Prometheus 当前触发告警）过于技术化」。即：**说明文字不占独立常驻空间，指引以可收起的折叠栏与 hover 提示承载**。
- **落地改动（最终形态）**：
  1. 三页页头只保留页面标题，删除标题下的独立说明文字板块。
  2. 告警状态页：恢复「两个页签分别看什么？」折叠栏（默认展开，可收起），承载两视图语义区分 + 授权网域约束；页签名改为「通知状态」「当前告警」（不再用 Alertmanager / Prometheus 组件名），hover 提示分别改为「通知发出去了吗？谁在收到、谁被拦下了」「现在什么出了问题（系统实时检查结果）」。
  3. 历史告警页：恢复「恢复时间是估算值，仅供参考」折叠栏（默认收起）；列头「恢复时间（按 Prometheus 求值）」改为「恢复时间（估算）」+ 列头角标 hover 说明（自动推算、可能有偏差、超保留期不可查）——折叠栏与列头角标双入口。
  4. 静默管理页：恢复「静默只对你有权限的网域生效」折叠栏（默认收起，授权约束 = 决策 56）；新建静默抽屉内保留默认收起的折叠栏说明。
  5. 挂载配置抽屉：成功态文案去「amtool / M09」内部术语；用户可见文案统一移除内部编号引用（决策 56 / M09 / amtool）。
- **验证**：`tsc --noEmit` 通过；`vitest run src/pages/alerts` 6 文件 58 例全过；eslint 0 告警。测试断言同步（AlertStatusPage.test / HistoryAlertsPage.test / alertSmoke.test 页签名与文案断言）。
- **影响模块**：M08 前端三个页面 + 两个抽屉；不改任何 API / 契约数据结构（页签 key `am` / `prom` 不变，仅展示名变化）。
- **发现场景**：用户试用反馈（2026-09-11 两轮：先要求参考 M01 折叠栏收敛蓝条，后确认说明大框整体没有必要）。
- **状态**：closed（如 PRD §3.2 语义说明条表述需回写，待设计侧下版 PRD 迭代收割）
