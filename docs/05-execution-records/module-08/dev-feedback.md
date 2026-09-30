# dev-feedback 登记单 — Module_08 Alertmanager 通知收敛

> 归属：backend-developer / frontend-developer（Agent 可写区 `docs/05-execution-records/module-08/`）
> 登记原则：① PRD 未规定的空白/细节判决策、③ 原型纯技术优化在此留痕；② PRD 已规定但实现发现矛盾需实现前报告 Orchestrator，禁止事后当既成事实塞入。
> **权威副本（2026-09-30 约定）**：本文件以 **`feat/*` 开发分支**为唯一权威写入点；`develop` / `design` 分支上的同名副本为**只读镜像**，由 feat 单向同步，**不要在那些副本上新增条目**（否则必然分叉）。

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

## 10. 创建静默抽屉「匹配条件」渲染死锁 + 默认时间冻结（① 缺陷，已修复，随决策 71 一并落地）

- **类别**：① 缺陷判定（PRD/契约未规定实现层缺陷，前端实现 bug，随决策 71 修复）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.2/§5.2.1（v1.16，决策 71）；源码 `ui-custom/web/src/pages/alerts/CreateSilenceDrawer.tsx`
- **现状 / 根因**：用户实测「抽屉中点击匹配条件（添加行），没有弹出任何内容」。两个叠加 bug：
  1. **渲染死锁**：原实现用 `Form.useWatch('matchers', form) || []` 驱动 matcher 行渲染，形成鸡生蛋——rc-field-form 的 `useWatch` 内部经 `getFieldsValue()` 取值，而 `cloneByNamePathList` **只返回已挂载 Field 路径上的值**；初始 0 行 → `['matchers', i, ...]` Field 永不挂载 → watch 恒空 → `setFieldValue` 写入 store 后 notifyWatch 回调里 `getFieldsValue()` 仍取到 `{}` → stringify 相等不触发 re-render（对照：`getFieldValue` 直读 store 有值）。4 个临时 vitest 探针实证（初始 0 行、点击无反应、最小无 Drawer 复现、生命周期仅渲染 1 次）。
  2. **默认时间冻结（次生）**：`initialValues` 含 `dayjs()` 在模块层求值，值随 SPA 停留时长漂移——抽屉打开时刻 ≠ 组件模块加载时刻。
- **结论 / 修复（决策 71 第 5 条）**：
  1. matcher 行渲染改用 antd **`Form.List`**（render prop 天然随行数 re-render，绕开 useWatch 注册实体过滤）；
  2. `initialValues` 改为 `useState(makeInitialValues)` 工厂模式，每次组件挂载重建（`dayjs()` 在挂载时求值）。
- **测试补充**：原 `SilencesPage.test` 完全未覆盖抽屉交互（死锁逃逸原因）；新增 `CreateSilenceDrawer.test.tsx` 6 用例，首条即死锁回归（「打开即渲染 1 行匹配条件，点『添加匹配条件』出现第 2 行」），另覆盖 payload 组装 / AND 提示 / 分组联想 / 正则预检 / 按实例选择。
- **验证**：`tsc --noEmit` 通过；eslint 干净；`vitest run src/pages/alerts` 7 文件 64 例全绿。
- **影响模块**：M08 前端静默管理（CreateSilenceDrawer）；不改 API / 契约。
- **发现场景**：用户实测静默管理抽屉（2026-09-11）；测试逃逸原因 = 原测试零抽屉交互覆盖。
- **状态**：closed（随决策 71 落地；`Form.useWatch` 驱动动态 Form.List 行渲染是通用反模式，其他模块同构代码可按此排查）
## 11. 静默「创建成功」却报 `message.success is not a function`：生产入口缺 antd App 上下文（② 实现缺陷，已修复）

- **类别**：② 实现缺陷（前端，已修复）
- **PRD 章节位置**：§5 静默管理（创建反馈提示）；§9.2 技术验收
- **现状**：用户对主机 ceshi 创建静默，抽屉报「创建失败 message.success is not a function」，但静默实际已生效。故障链路：抽屉 `handleFinish` → 页面 `create(payload)` 成功 → 页面成功 toast `message.success(...)` 抛 TypeError → 冒泡被抽屉 catch 当作创建失败展示（`e.message` 直接进错误 Alert）。
- **根因**：`App.useApp()`（antd）必须处于 antd `<App>` 组件树内，否则解构出的 `message/notification/modal` 为 `undefined`。生产入口 `main.tsx` 只渲染了项目路由组件 `<App />`（`./App.tsx`），从未包裹 antd `<App>`；而所有相关测试（`SilencesPage.test` / `CreateSilenceDrawer.test` / `AlertConfigPage.test` / `alertSmoke.test`）都显式包裹了 `<App>`，故全部通过——典型的「测试补齐了生产缺失的上下文」逃逸。同链路 `AlertConfigPage.tsx:45` 同样受影响（页面内任何 message 调用都会炸）。
- **结论 / 修复**：
  1. `main.tsx` 以 antd `<AntApp>` 包裹应用根组件（ConfigProvider 内层）；
  2. 去除双重成功 toast（页面 `handleCreate` 与抽屉各弹一次，保留抽屉侧，页面只 `await create`）；
  3. 新增入口静态断言守卫 `src/antdAppContext.test.ts`（断言 main.tsx 含 `<AntApp>` 且在外层）——页面级测试无法拦截此类逃逸，只能守入口。
- **验证**：`tsc --noEmit` / eslint 干净；`vitest src/pages/alerts` + 新守卫用例全绿。
- **影响模块**：M08 前端（SilencesPage / CreateSilenceDrawer / AlertConfigPage）、应用入口 main.tsx；不改 API / 契约。
- **发现场景**：用户实测创建静默（2026-09-11）；测试逃逸原因 = 测试环境显式包裹 antd `<App>`、生产入口未包裹。
- **状态**：closed（约定：凡使用 `App.useApp()` 的新页面，须确认入口 `<AntApp>` 守卫仍在；同构风险：其他若将来引入静态 `message` 与 `useApp` 混用需注意渲染上下文一致性）


## 12. 历史告警页宽窗口取数缺 `step`：用户把时间范围拉到 7d 即整体加载失败（② 实现缺陷，已修复，决策 90）

- **类别**：② 实现缺陷（跨模块：M02 接口参数与 Prometheus 点数上限互斥；M08 页面未传参）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.4；`Module_02_Query_Center.md` §5.4/§6.1/§11.2；`docs/05-execution-records/module-08/api-contract-snapshot.md` §10.4（本轮新增）；源码 `ui-custom/web/src/pages/alerts/useHistoryAlerts.ts`、`platform/query/alerts_history.go`
- **现状 / 根因**：历史告警页时间范围上限 7d（`MAX_WINDOW_HOURS = 7 * 24`），但 `useHistoryAlerts` 只传 `start`/`end`/分页，**不传 `step`** → 服务端按默认 `step=30s` 展开 `7d` → `20160` 点 > Prometheus `query_range` 单序列上限 `11000` → 上游 400 → 接口 500 → 页面整片「历史告警加载失败」。同一根因让首页「当日 / 近 7 天告警」恒为 0（该链路恒用满 7d 窗口）。
  - 默认 24h 窗口（2880 点）不触发，故该缺陷只在用户拉宽时间范围时暴露——属「宽窗口才复现」的必现缺陷，非偶发。
- **结论 / 修复**：
  1. **前端（本模块页面）**：`useHistoryAlerts` 取数显式透传 `step`，取值统一取 `ALERT_HISTORY_STEP_SECONDS = 30`（`src/api/alertmanager.ts` 新增常量，与首页告警卡共用同一来源，避免两处各写一个字面量漂移）。30s = PRD 默认步长，窄窗口保持 30s 估算精度；拉宽到 7d 时由服务端抬到 55s（同批口径由 60s 改定为 30s，见 `module-02/design-decisions.md` 决策 90 同日补充）。
  2. **服务端兜底（A，M02）**：新增 `normalizeHistoryStep`，窗口裁剪后按需抬高步长（只抬高不压低），使任何调用方都不会再踩上限；响应新增附加字段 `data.step` 回显实际生效步长，供本页「恢复时间（估算）」口径自查。
  3. **精度口径（已闭环，无需产品另行确认）**：原方案统一传 60s，会把本页**默认 24h 窗口**的估算粒度也拉到 60s（2880 点远低于上限，本无抬高必要）；现改为调用侧统一传 **30s**、宽窗口由服务端抬高——**窄窗口 30s、宽窗口自动变粗，无精度妥协**，原先登记的「待产品确认」一项关闭。
- **影响模块**：M08 历史告警页（取数参数）；M02 `/api/v1/alerts/history`（服务端兜底 + 响应字段）；M05 首页告警卡（同根因，见 `module-05/dev-feedback.md` 反馈 7）
- **验证**：`tsc --noEmit` 通过；`eslint` 0 告警；`vitest run src/pages/alerts` 7 文件全过（`HistoryAlertsPage.test.tsx` 新增 1 例断言请求携带 `step`）；`go test ./platform/...` 27 包全通过
- **发现场景**：用户实测首页当日 / 近 7 天告警恒为 0 后排查同一接口发现（2026-09-18）；本页侧为同根因的必然复现路径（把时间范围拉到 7d）
- **状态**：closed（代码 + 测试 + 契约快照 §10.4 已落地；步长口径已定为 30s，无遗留待确认项）

## 13. PL-3 通知渲染桥实现前的治理门禁：决策 74 未落档（按用户指示暂缓补录，登记待办）

- **类别**：契约口径确认（治理门禁 / 跨模块契约面）
- **PRD 章节 / 文件位置**：设计提案 `docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md` §6「跨模块登记要求」（拟编号**决策 74：告警配置口径与通知渲染桥**）；落档目标 `docs/05-execution-records/module-08/design-decisions.md`
- **现状 / 根因**：提案 §6 规定 PL-3（通知渠道 NotifyChannel / 通知模板 NotifyTemplate / 平台内置桥端点 `POST /api/v1/webhooks/notify` / SSRF 与内网令牌防护）属**跨模块契约面**（涉 M09 校验与生成、`alertmanager.yml` 模板引用段、通知标签竞合面），须**先在 `design-decisions.md` 落档决策 74 后，方可进入迭代二的实现与评审**。当前 `design-decisions.md` 最大编号止于决策 71，**决策 74 尚未落档**。
- **结论（用户 chenrt 2026-09-28 指示）**：**决策 74 本次不补录**。按用户明确要求，PL-3 先进入开发（迭代二），该门禁以本反馈单登记留痕；**待 PL-3 开发完成后，再在 `design/module-mvp-demo` 设计分支统一补录决策 74**（含本提案 §3.3 全部已裁决内容：D-2 内置模板 + 可自定义 Go template、D-3 端点命名维持、D-4 交付节奏）。
- **影响模块**：M08（PL-3 前后端）、M09（`alertmanager.yml` 生成侧模板引用 / 校验）
- **发现场景**：Orchestrator 派发 PL-3 开发前核对提案 §6 门禁，发现决策 74 缺失并上报用户拍板
- **状态**：open（门禁暂缓，登记待办；PL-3 开发完成后须在设计分支补录决策 74，本项方可 closed）
- **状态更新（2026-09-29，用户书面确认方案 B）**：**门禁解除（转为待同步）**——用户 2026-09-29 书面确认「我同意这个方案 B，还请继续执行」，即按提案 §6 先行补录决策 74。决策 74（告警配置口径与通知渲染桥）**已落档**至开发空间 `docs/05-execution-records/module-08/design-decisions.md`（本文件末尾「补充对齐：2026-09-29」），内容含 D-1/D-2/D-3/D-4 裁决 + **方案 B（M09 自动物化通知渠道/模板生效引用）** + 未决项（合并/冲突策略）。**遗留待办**：当前 Agent 可编辑范围限于开发空间工作目录，`design/module-mvp-demo` 设计分支的同名 `design-decisions.md`（与本副本此前逐字一致）**需在设计侧收尾时同步该补充块**；同步完成后本项完全 closed。原文保留，仅追加本状态更新。
- **状态更新（2026-09-29，方案 B 定稿并落地）**：方案 B 契约**已定稿并实现**——决策 74 补充块补齐三条锁定口径（① receivers 合并策略：平台生成 + 保留手写 + **重名即草稿校验失败（行级错误），绝不静默覆盖/合并**；② 模板物化口径：只把 template ID 写进 receiver URL query，不生成 AM `templates:` 段、不写模板文件；③ UI 口径：告警配置页「UI 控制 → 派生 alertmanager.yml 预览」，手写/上传内容原样透传不解析）。后端物化落地于 `platform/configcenter/generator/notify_receivers.go`（+ `validate.go` 行级错误、`data_source.go` / `change_detect.go` / `draft/service.go` / `main.go` 装配），契约写入 `api-contract-snapshot.md` §11.6；前端「派生预览」落地于 `useDerivedReceivers.ts` + `AlertConfigPage.tsx`。安全侧同批修复 H-1/M-1/M-2/M-3（见 #24）。**遗留不变**：设计分支 `design-decisions.md` 的同名补充块待设计侧同步。

## 14. 迭代一 PL-2「通知模板」豁免项前向引用：文案已出、入口暂无（空白判定，不制造死链）

- **类别**：空白判定 / 决策口径（前向引用）
- **PRD 章节 / 文件位置**：设计提案 §3.2.2「两块豁免」表第 5 行（通知模板内容 templates，由 PL-3「通知模板」独立承载）；落点 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`（配置说明卡豁免块）、`ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`（`ALERT_CONFIG_EXEMPT_BLOCKS`）
- **现状 / 根因**：PL-2 验收要求说明卡显式列出「两块豁免」，其中豁免项 ⑤「通知模板内容（templates）」的承载页属**迭代二 PL-3**（NotifyTemplate / NotifyChannel 前端管理页），本迭代一（PL-1 + PL-2，纯前端）**尚无对应路由**。若按其他豁免项（④ 静默 → `/silences`）同形给出入口链接，将产生**指向不存在路由的死链**。
- **判定（本迭代一执行口径）**：豁免项 ⑤ **只出文案、不产生链接**——`ALERT_CONFIG_EXEMPT_BLOCKS` 中该项 `path` 置 `null`，渲染层据此不渲染 `<Link>`；同时**不新增** NotifyTemplate 相关路由占位页（避免死链与「点了没内容」的更差体验）。豁免项 ④ 静默已有页面，正常给出 `/silences` 入口。
- **影响模块**：M08（PL-3 前端落地后需回补豁免项 ⑤ 的入口指向）
- **发现场景**：T08-F9 实现 PL-2 说明卡豁免块时，按「迭代一不制造死链」纪律显式区分「有页面可链」与「暂无页面」，并对模板项采用只出文案策略
- **状态**：open（迭代一按「只出文案不链接」落地；**待 PL-3 通知模板页落地后，回补豁免项 ⑤ 的入口链接**，本项方可 closed）
- **状态更新（2026-09-28，T08-F12 前端）**：**closed**——PL-3 通知模板页 `/notify-templates` 已落地（`NotifyTemplatesPage.tsx`），`ALERT_CONFIG_EXEMPT_BLOCKS` 的 `templates` 项已回填 `path = NOTIFY_TEMPLATES_PATH`、`linkText = '通知模板'`，告警配置页豁免项 ⑤ 现渲染真实链接（`AlertConfigPage.test.tsx` 已断言 `href=/notify-templates`）。同时 `AlertConfigScopeBlock` 新增 `linkText` 字段，替换渲染层原先写死的「静默管理」链接文案，避免跨块文案错位。原文保留，仅追加本状态更新。

## 15. 通知渠道 WebhookURL / Secret 服务端明文存储 + 响应脱敏（① 空白判定，取舍留痕）

- **类别**：① 空白判定（存储与回显口径，PL-3 迭代二实现期选择）
- **PRD 章节 / 文件位置**：设计提案 `alert-config-scope-and-notification-bridge.md` §3.3.2 / §3.3.8；落点 `platform/models/alertmanager_notify.go`（NotifyChannel）、`platform/alertmanager/notify/channel.go`（`ToChannelView`/`maskWebhookURL`）
- **现状 / 根因**：通知渠道需持久化机器人 WebhookURL（含 token）与加签 Secret。设计提案未规定「存储是否加密 / 响应是否回显」。若明文存储且原样回显，会在列表接口泄露凭据；若加密存储，MVP 期缺乏密钥管理基础设施（与决策 60 明文留痕 AA 配置同源约束）。
- **判定（本迭代二执行口径，已按任务卡指派选择）**：**服务端明文存储、响应严格脱敏**——`WebhookURL`/`Secret` 在库中按原值存储（与决策 60 的 alertmanager.yml 明文留痕一致，不引入密钥管理）；API 响应经 `ToChannelView` 走 `maskWebhookURL` 脱敏为 `scheme://host/***`，**绝不回显 secret**（`secret_set` 只回布尔「是否已设置」）。更新端点采用指针字段语义（仅更新显式提供的字段），前端无需回显原凭据。
- **影响模块**：M08 PL-3（NotifyChannel CRUD）；后续若引入凭据加密 / KMS，需迁移存储与视图。
- **发现场景**：T08-09 实现渠道 CRUD 时，凭「最小凭据暴露」原则确定明文存储 + 脱敏回显口径；任务卡要求将该取舍作为 ① 空白登记
- **状态**：open（MVP 口径已落地；加密存储 / KMS 属后续迭代，届时本项 closed）

## 16. 桥端点内网令牌 / 渲染时区 / 桥基础地址注入依赖 env/env.sh，交付包与本地启动脚本**至今零接线**（① 空白；2026-09-30 复核确认未闭环，升级为现场故障地基）

- **类别**：① 空白判定（部署交付面）
- **PRD 章节 / 文件位置**：设计提案 §3.3.6（内网调用令牌）/ §3.3.4（渲染时区）；决策 74 定稿补充第 6 条（令牌与桥地址注入口径）；落点 `platform/cmd/metric-center/main.go`（flag `--notify.bridge-token` / `--notify.render-timezone` / `--notify.bridge-url`）
- **现状 / 根因**：任务卡要求桥端点内网令牌由交付包 `env/env.sh` 注入（与既有 `DATA_ROOT`/`LOG_ROOT` 同源）。但当前工作区 **`env/` 目录不存在**（`env/env.sh` 尚未创建），无法按其注入。
- **判定（本迭代二执行口径）**：以 **flag + 环境变量**双通道注入作为兜底——`--notify.bridge-token`（env 覆盖 `NOTIFY_BRIDGE_TOKEN`）、`--notify.render-timezone`（env 覆盖 `NOTIFY_RENDER_TIMEZONE`）；令牌为空时桥端点一律 401（安全默认，不开放匿名转发）。待交付包补齐 `env/env.sh` 后，由其统一导出这两个环境变量即可，无需改代码。
- **影响模块**：M08 PL-3（桥端点部署面）；M09 / 交付包（`env/env.sh` 补齐）
- **发现场景**：T08-11 装配桥端点时，按任务卡尝试从 `env/env.sh` 读取令牌，确认该文件不存在

### 16.1 2026-09-30 现场复核：「待交付包补齐」从未发生，且新增的桥地址 flag 同样零接线（① 空白，2026-09-30 L1 已落，闭环）

- **触发**：用户现场报「变更单 `CHG-20260930-001` 校验失败 → 通知 receiver `notify-1` 重名冲突」+「通知渠道为什么又用 `http://127.0.0.1:8080/api/v1/webhooks/notify?channel=1`」+「抽屉黄条提示未配置桥令牌」。三者经核对为**同一条根因链**（详见 M09 dev-feedback **F-36** 的链条复盘）。
- **复核结论（证据级）**：`NOTIFY_BRIDGE_URL` / `NOTIFY_BRIDGE_TOKEN` / `NOTIFY_RENDER_TIMEZONE` **全仓库只出现在 `platform/cmd/metric-center/main.go`**（`:64` flag 定义、`:104-112` env 读取），**任何启动 / 打包 / 部署脚本都没有接线**：
  1. `Makefile:387` `run-metric-center` 只传 `--config.reload-url` —— 即**项目文档给出的标准本地启动方式必然回落回环地址、且无令牌**；`main.go:175` 在 `--notify.bridge-url` 为空时走 `notify.DeriveBridgeBaseURL(":8080")`，host 为空/通配 → 回落 `127.0.0.1`（`alertmanager/notify/receiver_snippet.go:56-59`），`main.go:185` 打 WARN。
  2. `scripts/package-center.sh:525` 生成的 `env/env.sh.example` 仅含 `DATA_ROOT` / `LOG_ROOT` / `PROM_RETENTION_*` / `*_PORT` / `METRIC_CENTER_DB_DSN`，**不含任何 `NOTIFY_*`**；`start.sh` 亦无导出。→ 即交付包**已生成**（本项原前提「`env/` 目录不存在」已过期），但**依然没有注入点**，「待交付包补齐」这一闭环动作**从未发生**。
  3. `--notify.bridge-url`（2026-09-29 新增，用于跨网域把桥地址指到公网可达地址）**同样未被任何脚本接线**，只能命令行临时手传 → 任何一次不带参数的正常重启都会把地址退回 `127.0.0.1:8080`。
- **后果（现场实证）**：桥地址不稳定 → 历史草稿产物中的平台 receiver URL 与当次重算的 URL 不一致 → M09 物化幂等识别失败 → **误报「手写 receiver 重名冲突」并 `failed + user_config`**（见 M09 F-36）；同时抽屉出现「通知暂不可用」黄条。
- **建议修法（L1，待排期；本轮仅留痕不改代码）**：
  1. `Makefile:run-metric-center` 透传 `NOTIFY_BRIDGE_URL` / `NOTIFY_BRIDGE_TOKEN`（已由 env 读取，无需改 Go；未设时保持现状，但**建议启动日志显式打印生效桥地址**，让"回落到 127.0.0.1"可见）。
  2. `scripts/package-center.sh` 的 `env.sh.example` 补 `NOTIFY_BRIDGE_URL`（默认 = 中心对外可达地址，非 `127.0.0.1`）/ `NOTIFY_BRIDGE_TOKEN` / `NOTIFY_RENDER_TIMEZONE`，并在 `start.sh` 导出；bundle README 增「桥地址/令牌配置」小节。
  3. 桥地址与令牌建议**单一来源**（`env/env.sh` 集中定义，与端口/保留策略同源），避免 flag / env / DB 三处漂移。
  4. `install.sh` 的端口自定义机制（F-33）可顺带扩一个 `--notify-bridge-url` 安装期参数，降低运维手改成本（可选）。
- **影响模块**：交付包（`scripts/package-center.sh` 生成物 `env/env.sh.example` / `start.sh` / bundle README）、本地开发（`Makefile`）、M08 PL-3 部署面、M09 物化输入。
- **发现场景**：用户 2026-09-30 现场报障，核对 `main.go` → `Makefile:387` → `package-center.sh:525` 后确认脚本零接线。
- **状态**：**landed（2026-09-30，L1 已落）**——`Makefile` `run-metric-center` 透传 `NOTIFY_BRIDGE_URL`/`NOTIFY_BRIDGE_TOKEN`/`NOTIFY_RENDER_TIMEZONE`；`scripts/package-center.sh` 的 `env.sh.example`/`start.sh`/bundle README 已接线；`main.go` 启动日志显式打印生效桥地址。按文档部署不再回落 `127.0.0.1`，本项（含 #16）闭环。
- **聚合登记**：本项 = **`## 28.`【第一步 · 止血】的 L1**（子项边界、执行顺序、验收与回填清单见 #28）。

## 17. PL-3 新增端点未写入 api-contract-snapshot.md / PRD（① 空白，待回写）

- **类别**：① 空白判定（契约文档面）
- **PRD 章节 / 文件位置**：契约快照 `docs/05-execution-records/module-08/api-contract-snapshot.md`；PRD `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- **现状 / 根因**：PL-3 的四个新增端点——`GET/POST/PUT/DELETE /api/v2/platform/alertmanager/notify-channels*`、`GET/POST /api/v2/platform/alertmanager/notify-templates*`、`POST /api/v1/webhooks/notify`——**均未写入 `api-contract-snapshot.md`**，PRD 也未回写。本次以设计提案 §3.3 为契约权威实现。
- **判定（本迭代二执行口径）**：按提案 §3.3 实现；**待 PL-3 开发收口后由文档方（prototype-designer / Orchestrator）将端点补齐至 `api-contract-snapshot.md` 与 PRD**（含请求/响应字段、错误码、query 定址参数、脱敏口径）。
- **影响模块**：M08 PL-3；前端对接、security-reviewer 审查均以提案为准
- **发现场景**：T08-08～T08-11 开发前核对契约快照，确认 PL-3 端点缺失（任务卡已声明「契约快照缺 PL-3 端点，待回写」）
- **状态**：closed（按提案实现，待回写契约快照与 PRD 后 closed）
- **状态更新（2026-09-29，方案 B 落地）**：**closed（快照侧已回写）**——`api-contract-snapshot.md` 新增 **§11**（PL-3 全部端点 + 字段 + 鉴权 + 错误码 + B 路线物化行为），版本号推进至 `v2026-09-29`。**遗留**：PRD `Module_08_*.md`（`docs/02-product-requirements/`，开发 Agent 不可写）的 §3.3.5/§5/§6 由 design 侧同步（本项已转化为设计侧待办，开发侧闭环）。原文保留。

## 18. 内置飞书卡片模板 JSON 未闭合（② 实现缺陷，T08-11 渲染首暴露并修复）

- **类别**：② 实现缺陷（已修复）
- **PRD 章节 / 文件位置**：`platform/alertmanager/notify/template.go`（内置飞书卡片模板常量）；发现于 `platform/alertmanager/notify/render_test.go::TestRenderBuiltinFeishuCardTemplate`
- **现状 / 根因**：T08-10 落地的内置飞书卡片模板中，每条告警的 `"text": { "tag": "lark_md", "content": {{ jsonStr (...) }}` **缺闭合 JSON 对象 `}`**（只闭合了外层 div 数组元素，`]` 提前出现），导致渲染产物为非法 JSON（`invalid character ']' after object key:value pair`）。T08-10 的校验仅覆盖 Go template 语法（`text/template.Parse` + amtool 等价工序），**未覆盖渲染内容是否合法 JSON**，故未被当时测试拦截；T08-11 新增渲染测试首次暴露。
- **结论 / 修复**：在模板该 action `}}` 后补 JSON 对象闭合 `}`；新增 `TestRenderBuiltinFeishuCardTemplate` 断言渲染结果为合法 JSON + header 红/绿，锁定回归。注：模板内容变更后其 checksum 改变，T08-10 的 seed 用 `findTemplateByChecksum` 幂等，不受影响。
- **影响模块**：M08 PL-3（内置模板 + 渲染桥）
- **发现场景**：T08-11 为桥端点编写渲染测试时首跑内置模板用例即失败（2026-09-28）
- **状态**：closed（模板已修复 + 渲染测试锁定）

## 19. 通知模板「校验和（checksum）」不在 UI 展示（③ 技术优化 / 用户文案规范）

- **类别**：③ 技术优化（展示层裁剪）
- **PRD 章节 / 文件位置**：设计提案 §3.3.2（NotifyTemplate.checksum = sha256）；落点 `ui-custom/web/src/pages/alerts/NotifyTemplatesPage.tsx`（模板列表列集合）
- **现状 / 根因**：`TemplateView.checksum` 是服务端版本留痕用的技术字段（sha256），对用户无业务含义；且 `frontend-developer.md` Step 3.5 第 2 项要求页面可见文案不得出现 `checksum` 等技术术语。列表已通过「创建时间 + 模板来源 + 状态」表达版本可追溯性，无需再暴露摘要。
- **判定（本迭代二执行口径）**：模板列表**不展示 checksum 列**（列表列集合 = 原型 ∩ MVP，技术字段不下沉为用户文案）。若后续用户需核对「当前生效模板内容指纹」，可在「查看内容」抽屉内以 `shortChecksum` 形式补充，并配 Tooltip 解释；当前不做。
- **影响模块**：M08 PL-3（通知模板页展示层）；不改契约字段与接口
- **发现场景**：T08-F11 实现模板列表列集合时，按用户文案规范判定技术字段不展示
- **状态**：closed（不展示即落地；如需补充属后续体验优化）

## 20. 通知模板无删除端点：内置模板「不可删除」通过「不提供删除操作 + 内置标记」体现（① 空白判定）

- **类别**：① 空白判定（能力边界）
- **PRD 章节 / 文件位置**：设计提案 §3.3.2（NotifyTemplate 版本化留痕）/ §3.3.8（接口清单：仅 GET / POST / POST remount）；落点 `ui-custom/web/src/pages/alerts/NotifyTemplatesPage.tsx`
- **现状 / 根因**：任务卡要求「内置模板（is_builtin=true）**不可删除**」，但 PL-3 实测 wire 契约**未提供模板删除端点**（仅列表 / 提交 / 回滚三端点，模板采用「校验通过才留痕、版本可回滚」的 append-only 模型）。若前端为自定义模板渲染一个「删除」按钮，将调用不存在的端点（死链）。
- **判定（本迭代二执行口径）**：模板页**不提供任何删除操作**（与后端 append-only 语义一致）；内置模板的「不可删除」以两处体现——① 列表「模板来源」列的内置 `Tag` 挂 Tooltip「平台内置模板随版本升级，系统统一维护，不可删除」；② 内置模板区常驻说明同一提示。测试以「内置行展示『内置』标记 + 页面无删除按钮」锁定回归。
- **影响模块**：M08 PL-3（通知模板页）；若后续需支持删除，须先在后端补 DELETE 端点并回写契约快照
- **发现场景**：T08-F11 按任务卡「内置模板不可删除」逐项落地时，核对 wire 契约确认无删除端点
- **状态**：closed（按 append-only 口径落地；删除能力属后续迭代，届时本项重开）

## 21. 接收人配置片段端点（T08-12）为 PL-3 契约新增，api-contract-snapshot 仍缺 PL-3 全部端点（① 空白，待回写）

- **类别**：① 空白判定（契约文档面）
- **PRD 章节 / 文件位置**：契约快照 `docs/05-execution-records/module-08/api-contract-snapshot.md`；PRD `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`；实现 `platform/alertmanager/notify/receiver_snippet.go`
- **现状 / 根因**：T08-12 新增只读端点 `GET /api/v2/platform/alertmanager/notify-channels/{id}/receiver-snippet`（服务端拼好可粘贴的 receiver YAML 片段，含真实数字 channel ID 与桥内网令牌；挂 `RequireAdmin()`）。该端点属 PL-3 通知渲染桥契约面（同 #17 所列 `/notify-channels*`、`/notify-templates*`、`POST /api/v1/webhooks/notify`），**本端点追加于 #17 缺口的端点清单之后**，同样**未写入 `api-contract-snapshot.md` / PRD**。
- **判定（本迭代二执行口径）**：本次以任务卡 + 设计提案 §3.3.5 为契约权威实现（A 路线：不改 M09 `alertmanager.yml` 生成逻辑）；**待 PL-3 开发收口后由文档方（prototype-designer / Orchestrator）将 PL-3 全部端点（含本端点）一并补齐至 `api-contract-snapshot.md` 与 PRD**（含请求/响应字段、错误码、鉴权、令牌占位口径）。
- **影响模块**：M08 PL-3（后端端点 + 前端片段展示按钮对接）；文档方回写契约快照与 PRD
- **发现场景**：T08-12 实现接收人片段端点时，核对契约快照确认 PL-3 端点整体缺失（延续 #17）
- **状态**：open（按任务卡/提案实现，待回写契约快照与 PRD 后 closed；与 #17 同批收口）
- **状态更新（2026-09-29，方案 B 落地）**：**closed**——接收人片段端点已随 PL-3 全端点一并写入 `api-contract-snapshot.md` **§11.1 / §11.4**；并随 H-1 修订，片段 URL 去 token、令牌改走 `http_config.authorization`（§11.2 / §11.4）。原文保留。

## 22. 「接收人配置」片段在「桥令牌未配置」时的可用性口径 + 片段凭据外发提示未规定（① 空白判定）

- **类别**：① 空白判定（契约与文案口径，T08-F14 实现期选择）
- **PRD 章节 / 文件位置**：设计提案 `alert-config-scope-and-notification-bridge.md` §3.3.5（接收人片段）；任务卡 §3 wire 契约（`token_configured`）；落点 `ui-custom/web/src/pages/alerts/ReceiverSnippetDrawer.tsx`
- **现状 / 根因**：契约只规定 `token_configured=false` 时「snippet 用占位符、UI 须提示用户先配置令牌」，**未规定**：① 此状态下「复制配置片段」按钮应保留还是禁用；② 片段内嵌平台内网令牌时是否必须给出「勿外发」安全提示（令牌不作为独立字段暴露，提示语也无处可依）。
- **判定（本轮执行口径）**：① 复制按钮**保留可点**（用户仍可先复制片段骨架、待管理员配置令牌后再刷新获取真实地址），但以 `Alert warning` 明确告知「该片段当前不可用（地址里的令牌是占位符）」，不把占位符伪装成可用；② 在片段下方固定给出安全提示「**该片段含平台内网凭据，请勿外发**」（附「请勿转发到聊天群、工单或文档」解释）。二者均由测试锁定（令牌未配置告警 / 安全提示文案）。
- **影响模块**：M08 PL-3（接收人配置片段展示层）；若后续统一改为「令牌未配置即禁用复制」，只需改本抽屉 + 对应用例
- **发现场景**：T08-F14 定稿片段抽屉（Drawer 化）时，逐条对照任务卡要求核对 UI 文案，确认契约未覆盖上述两点
- **状态**：open（本轮按上述口径落地；待提案 / 契约快照补齐该口径后 closed）
- **状态更新（2026-09-29，方案 B 落地）**：**closed**——口径已按 B 路线收敛并写入 `api-contract-snapshot.md` **§11.4 / §11.2**：① 令牌未配置时 `token_configured=false`、credentials 用占位符、UI 显式告警（复制按钮保留可点）；② 令牌不再进 URL，片段改走 `http_config.authorization`，「勿外发」安全提示文案改为「令牌是平台内部通知桥凭据（随 authorization 请求头下发）」。前端 `ReceiverSnippetDrawer.tsx` 已同步，`NotifyChannelsPage.test.tsx` 已锁定「令牌走 authorization 头且 URL 不含 token」。原文保留。

## 23. 通知渠道列表操作列新增第 3 个按钮后固定列宽 210 偏窄（③ 技术优化，已随 T08-F15 修正）

- **类别**：③ 技术优化（列表布局）
- **PRD 章节 / 文件位置**：`ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`（操作列 `width`）；规范依据 `docs/03-engineering-standards/02_Frontend_Standard.md` 第 9 章（行高 / 截断 / 横向滚动）
- **现状 / 根因**：操作列由「编辑 / 删除」扩为「接收人配置 / 编辑 / 删除」三个带图标文字按钮后，仍沿用 210px 固定宽度，实际内容宽约 220px，单元格会换行撑高行高（违反「禁止单元格换行撑高行高」）。
- **判定（本轮执行口径）**：放宽到 240px；表格继续用 `TABLE_SCROLL_X`（`x: 'max-content'`）兜底横向滚动，其余列宽不动。
- **影响模块**：M08 PL-3（通知渠道列表展示层）；不改契约与接口
- **发现场景**：T08-F15 复核渠道页指引一致性时顺带核对操作列布局
- **状态**：closed（已随 T08-F15 调整）

## 24. PL-3 安全审查发现登记：H-1 桥令牌 query 明文落日志（必修）+ M-1/M-2/M-3（② 实现缺陷 / 契约口径确认（安全））

- **类别**：② 实现缺陷（安全）/ 契约口径确认（安全）
- **来源**：`docs/05-execution-records/module-08/security-review-pl3.md`（Track B+ 强制安全审查，总体结论 **FAIL（有条件）/ HIGH**：SSRF 调用侧硬约束、空令牌即拒 + 常量时间比较、写端点均 `RequireAdmin`、响应脱敏、`text/template` 白名单 FuncMap、前端零 `dangerouslySetInnerHTML` 均已核实成立）
- **PRD 章节 / 文件位置**：决策 74 定稿补充第 3 条 / 第 7 条；源码见下逐项
- **逐项与必修标记**：
  - **H-1（HIGH，必修，合并前完成）桥内网令牌经 URL query 传递，被 `gin.Default()` 访问日志明文落盘**：`platform/cmd/metric-center/main.go:200`（全局默认 Logger）+ `platform/alertmanager/notify/bridge.go:58`（`c.Query("token")`）+ `platform/alertmanager/notify/receiver_snippet.go:107-116`（`buildBridgeURL` 把真实令牌拼进 query）。**修法（决策 74 定稿补充第 3 条）**：令牌改请求头 `Authorization: Bearer <token>`（AM 侧 `webhook_configs.http_config.authorization`），`bridge.go` 自 `c.GetHeader("Authorization")` 解析、`receiver_snippet.go` 片段改为写 `http_config` 且 URL 去掉 `token` query、M09 物化 receivers 同步；同步更新 `bridge_test.go` / `receiver_snippet_test.go`。**不采用**「自定义 Logger 剔除 query」为主修法。
  - **M-1（MEDIUM，同批修）出站传输错误 `err=%v` 把含 webhook 明文（bot token）的错误写日志**，违反 `bridgeLogf` 自述：`bridge.go:115-121` + `notify/client.go:46-49`（`*url.Error.Error()` 含完整 URL）+ `platform/api/response/response.go:151`。修法：失败日志只记 `ch.ID/type/tpl.ID/http_status` 与脱敏错误类别（`net.Error`/`x509`/`timeout`），或对 err 做 URL 剥离，不原样 `%v`；`BadGateway` 侧避免重复落明文。补传输层失败用例（现有 `TestBridgeSendFailureReturnsBadGateway` 走非 2xx，未覆盖传输错误）。
  - **M-2（MEDIUM，同批修）`ValidateWebhookURL`（`notify/channel.go:35-47`）仅校验 scheme/host，未限私网 / 环回 / `169.254.169.254`**：当前出站目标仅能来自已登记渠道（需管理员写权限，风险受限），但按 AGENTS.md §9 SSRF 防护应收紧——拒绝私网 / 环回 / link-local / 元数据地址（或按配置放行「内网自建机器人地址」这一业务例外，需显式开关）。**落地口径**：默认拒绝，如与「内网机器人」业务冲突，则提供显式允许开关并在文案说明。
  - **M-3（MEDIUM，同批修）出站客户端跟随重定向**（`notify/client.go:32-34` 克隆 `http.DefaultTransport`）：应设 `CheckRedirect` 禁止跟随（或限制跳数 + 每跳重校验 `ValidateWebhookURL`），避免重定向绕过目标白名单把渲染内容投到任意地址。
- **影响模块**：M08 PL-3（桥端点 / 接收人片段 / 渠道校验 / 出站客户端）、M09（`alertmanager.yml` 物化 receivers 的 `http_config`）
- **发现场景**：PL-3 迭代二 security-reviewer 审查（2026-09-29）
- **状态**：open（**H-1 必修**——合并前完成；M-1/M-2/M-3 同批修复；修完由 security-reviewer 复检后 closed）
- **状态更新（2026-09-29，四项已全部修复，待复检）**：**fixed_pending_review**——H-1 / M-1 / M-2 / M-3 均已在代码落地并有测试锁定：
  - **H-1（已修）**：`bridge.go` 改为自请求头解析（`bearerToken(c.Request)`，`Authorization: Bearer <token>`，常量时间比较），URL query 不再承载令牌；`receiver_snippet.go` 的 `buildBridgeURL` 只带 `channel`、片段改写 `http_config.authorization`；M09 物化 receivers 同步走 `http_config.authorization`（`notify_receivers.go`）。新增/更新测试：`bridge_test.go`（`doBridgeJSON` 统一带 Bearer、`TestBridgeRejectsMissingOrWrongToken`）、`receiver_snippet_test.go`（断言 URL 无 token + Bearer 闭环）、`NotifyChannelsPage.test.tsx`（前端断言）。
  - **M-1（已修）**：`client.go` 新增 `sanitizeOutboundError`，剥离 `*url.Error` 中的完整 URL（只留 `op + host + 底层错误`），阻断含 webhook 明文的错误落日志。测试：`TestSanitizeOutboundErrorStripsURL`。
  - **M-2（已修）**：`channel.go` 新增 `rejectPrivateHost`，默认拒绝私网 / 环回 / link-local / 未指定 / 云元数据（`169.254.169.254`）地址；内网自建机器人经显式开关 `SetAllowPrivateWebhookTargets` 放行。测试：`TestValidateWebhookURLRejectsPrivateTargets`。
  - **M-3（已修）**：`client.go` 的 `newOutboundHTTPClient` 设 `CheckRedirect → http.ErrUseLastResponse`，出站不跟随重定向。测试：`TestOutboundClientDoesNotFollowRedirects`。
  - 验证：`go test ./platform/...` 全通过、`go vet ./platform/...` 干净；契约口径已写入 `api-contract-snapshot.md` §11.2 / §11.5。
  - **遗留**：由 **security-reviewer 复检**确认后可置 closed。

## 25. M08 告警配置「应用」与 Alertmanager 实际加载文件断链：status=applied 早于落盘 + 缺自动闭环（② 实现偏差 / 跨模块状态断点，方案 A 待落地）

- **类别**：② 实现偏差（跨模块状态/动作断点；命名语义误导导致用户误判已生效）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.1（文件挂载契约）/ §6.6 / §9.1 / §9.2；决策 59/60/74；源码见下逐项
- **现状 / 根因**：用户疑问「M08 apply 不写回 AM 实际加载的 alertmanager.yml，到底是什么问题」。核对代码后定位为**两步动作被一个误导性的 `applied` 状态隔断，且中间无自动闭环**：

  1. **M08 `Submit`/`Remount` 只落库 + 生成 pending 草稿，不写盘**（`platform/alertmanager/config/service.go`）：
     - `Submit`：`:55-71`（同 checksum 幂等返回）；`Remount`：`:76-82`（总是写新版本 + 重触发）。
     - 共同工序 `submitValidated`：`:84-107`。`:87` amtool 校验，`:91-99` 落库 `AlertmanagerConfigVersion{Content,Checksum,Status: applied}`，**`:94` 这一步就把 `Status` 置为 `applied`**；`:103` `triggerChangeDetection(db)` → `change.ProcessDomain(db, managementDomainID)`（`:43-45`，管理域恒为 `default`）。
     - 即：M08 的「应用」在此刻**只把配置收录进 DB 当 M09 生成的源数据**，并触发变更检测去生成一张 `pending` 草稿。磁盘上的 `alertmanager.yml` 此时**完全没动**，AM 仍加载旧文件。

  2. **变更检测只生成草稿、永不自动确认**（``platform/configcenter/change/watcher.go``）：
     - `ProcessDomainWithIntervals`：`:120-210`。版本推进后 `:197` 调 `draft.GenerateDraft(db, domainID)` 产 `pending` 草稿；全程**只 generate、不 confirm、不写盘**。
     - 首跑基线为空时 `:131-136` 仅初始化基线并 `return`，**本轮直接跳过不生成草稿**——M08 submit 的即时触发在第一次提交时甚至不会产生草稿，要等 30s 轮询下一轮（`change.Start` 调 `runDetectionPass`，`:92-104`）才生成。
     - 轮询全程**无 `ConfirmDraft` 调用**：草稿必须人工确认。

  3. **真正写盘 + 热加载发生在独立的「确认下发」动作**（`platform/configcenter/draft/service.go:616` `ConfirmDraft`）：
     - 触发入口 = `POST /api/v2/platform/config-drafts/:change_no/confirm`（`platform/configcenter/draft/handler.go:56,111`）——**人工确认步骤**，非 M08 submit 自动发起。
     - `ConfirmDraft` → `deployment.DeployConfirmedVersion`（`deployment/service.go:71`）→ `Dispatch` → `DefaultApplier.Apply` → `DiskApplier.Apply`（`deployment/service.go:315`）→ `writeAlertmanagerAndReload`（`deployment/service.go:345-372`，写 `AMDir/alertmanager.yml` + 调 `AMReload`）。
     - **唯一的「真实生效」回写**：`deployment/service.go:211-219` 的 `writebackAlertmanagerApplied` 在**写盘成功后**才回填 `AlertmanagerConfigVersion.applied_at / source_change_no`。也就是说系统里有两个"applied"信号——`:94` 的 `Status=applied`（早、误导）与这里的 `applied_at`（晚、真实），而前端/接口读的是早的那个。

  4. **写盘路径本身正确（排除误判）**：`AMDir` 默认 = `config.dir` = `./config-output`（`main.go:59` 默认 `./config-output`、`:65` `config.am-dir` 默认空、`:142-144` 回落 `configDir`）；AM 加载的正是 `--config.file=.../config-output/alertmanager.yml`（`Makefile:433`）；reload 接 `alertmanager.url/-/reload`（`main.go:138-140`）。故 `AMDir/alertmanager.yml` 与 AM 实际加载文件**完全一致**，且一旦 confirm 执行写盘 + 热加载正确生效。**问题不在写到哪/怎么 reload，而在「谁去触发 confirm」这个断点。**

- **结论 / 推荐修复（方案 A：自动闭环 + 状态去误导，用户 2026-09-29 书面确认执行）**：
  1. **自动闭环**：M08 `submitValidated`（`:103` 触发变更检测之后）对管理域 `default` 增加「生成并确认草稿」步骤——即 `draft.GenerateDraft(db,"default")` 后再 `draft.ConfirmDraft(db, changeNo, uploadedBy)`，使 M08 一次 apply 端到端落盘。须规避两处陷阱：① 首跑基线未初始化导致 `ProcessDomain` 不产草稿 → 直接调 `GenerateDraft` 而非依赖 watcher；② 与 30s 轮询的 `live pending` 竞态 → 确认前先查 `draft.LatestLivePending(db,"default")`，已有活 pending 则跳过重复生成、仅确认既有草稿（`ShouldSupersedePending` 同 `watcher.go:174` 口径）。管理域为 local 通道、自动应用符合决策 31-M2 的 local 直发语义；edge 域仍走人工确认不变。
  2. **状态去误导**：保留 `AlertmanagerConfigVersion.Status=applied` 作为「已收录为 M09 源」的内部标记（M09 `LoadLatestAlertmanagerConfigContent` 仍按 `status=applied` 读源，决策 60/74 不变）；**前端「配置状态」改为读 `applied_at` 派生**——`applied_at != nil` 显示「已生效」，否则显示「已提交，待确认下发」并附 M09 配置变更单跳转。使展示语义与真实落盘对齐，消除「看到 applied 以为已生效」的误判。
  3. **幂等/降级**：自动 confirm 失败不应回滚 M08 收录（收录已成功），按 `errChangeTrigger`（`service.go:111`）同款降级——仅记日志、由 30s watcher 下一轮兜底重试 confirm。

- **回填清单（落地时同步）**：
  - 后端：`platform/alertmanager/config/service.go`（新增「生成并确认 default 草稿」helper，复用 `draft.GenerateDraft`/`ConfirmDraft` + `LatestLivePending`/`ShouldSupersedePending`）、`platform/configcenter/draft/service.go`（确认 `ConfirmDraft` 对管理域可被外部安全调用）、`platform/configcenter/deployment/service.go`（确认 `writebackAlertmanagerApplied` 在 local 自动应用路径照常触发）。
  - 前端：`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx` + 对应 query/hook（状态展示改读 `applied_at`、缺省态文案 + 跳转 M09 变更单）。
  - 契约快照：`docs/05-execution-records/module-08/api-contract-snapshot.md`（§5.1/§6.6 明确「M08 apply = 收录 + 自动下发；生效以 applied_at 为准」）。
  - 测试：新增 `config/service_test.go` 断言「submit 后 AM 磁盘文件被更新 + applied_at 回填」；`deployment_test.go` 已覆盖 `DiskApplier` 写 AM 分支（`TestDiskApplierWritesAlertmanagerReloadsSeparately`），可复用。
- **影响模块**：M08（配置提交/状态展示）、M09（`alertmanager.yml` 生成与确认下发，local 通道）、前端告警配置页；不动写盘路径与 reload 机制。
- **发现场景**：用户追问「M08 apply 不写回 AM 实际加载的 alertmanager.yml 具体是什么问题」，核对 `alertmanager/config/service.go` → `configcenter/change/watcher.go` → `configcenter/draft/service.go` → `configcenter/deployment/service.go` 全链路后定位（2026-09-29）。
- **状态**：open（方案 A 已确认、待实现；实现期为 feat 收尾后的独立修复，不在当前冻结期 PRD 改动范围内。落地后由 `writebackAlertmanagerApplied` 的 `applied_at` 回填路径验证闭环，本项 closed）

## 26. 平台物化的通知 receiver **没有任何 route 引用** → 死配置，且成为 F-36 误报的触发物（② 实现偏差 / 跨模块契约缺口，2026-09-30 用户裁决「明确 route 由用户写」）

- **类别**：② 实现偏差（跨模块契约缺口）
- **PRD 章节 / 文件位置**：决策 74 定稿补充第 1 条（receivers 合并 / 冲突策略，仅规定 receivers）；实现 `platform/configcenter/generator/notify_receivers.go`（只操作 `receivers:` 序列，见 `:86-115`）
- **现状 / 根因**：平台按「已启用渠道」物化 `receivers[]`，但**完全不触碰 `route` / `routes`**。实测线上 `config-output/alertmanager.yml` 的 4 处 `receiver:` 全部指向用户手写的 `feishu`（`:30/:76/:84/:92/:100`），平台生成的 `notify-1` **无任何 route 引用 → 永不投递**。结果：同一个启用渠道（`id=1`）出现「一个活 receiver（手写 `feishu`）+ 一个死 receiver（平台 `notify-1`）」，而**死的那一个恰好是 F-36 误报「重名冲突」的触发物**。
- **判定（用户 2026-09-30 裁决）**：一期**明确为「平台只提供 receiver 定义，`route` 由用户书写并指向」**——零代码改动，仅在 UI 与文档写明：
  1. 前端：接收人片段抽屉 / 告警配置页补一句「平台自动写入的是 `receivers` 定义；要让通知真正生效，需在 `route`/`routes` 中把 `receiver` 指向它」；
  2. 文档：M08 PRD（PL-2 三块必写 + PL-3 物化）与 `api-contract-snapshot.md` §11.6 明确 receivers 与 route 的归属边界；
  3. 原型 M08 同步该文案。
- **备选（记 v0.2，不在本期）**：平台连 `route` 一起物化（真正端到端自动生效）——须先定义「平台 route 与用户手写 route / routes 的合并与冲突策略」，复杂度高，需再过一轮设计提案。
- **影响模块**：M08（决策 74 定稿补充第 1 条注释 + PRD §3.3/§4 + 契约快照 §11.6 + 前端抽屉文案 + 原型）；M09（`notify_receivers.go` 维持「只物化 receivers」不变）。
- **发现场景**：用户 2026-09-30 报 receiver 重名冲突，对照线上 `route` 段（4 处 `receiver: 'feishu'`）与草稿产物 `receivers` 段（`feishu` + `notify-1`）时发现平台 receiver 无引用。
- **状态的聚合登记**：本项 = **`## 28.`【第一步 · 止血】的 L3**（零代码文案/文档收敛；与 `## 27.` 的抽屉信息架构重排**同批落地**，见 #28.5）。route 物化的备选方案见第二步设计草案 `module-08/design-proposals/alert-route-frontend-editor.md`。
- **状态**：**landed（2026-09-30，L3 已落）**——ReceiverSnippetDrawer/AlertConfigPage 已补「平台只写 receivers、route 由你手写」文案；PRD §3.3/§4 与 `api-contract-snapshot.md` §11.6 已明 receivers/route 归属边界；原型 M08 文案同步。route 物化仍记 v0.2（第二步/三步），不在本期。

## 27. 「接收人配置片段」抽屉告警块堆叠（最多 5 个 `<Alert>`，令牌未配置时 3 块常驻）+ 非阻断提示误用阻断态视觉（③ 技术优化 / 信息架构，2026-09-30 用户提出，范围裁决「只改该抽屉」）

- **类别**：③ 技术优化（信息架构 / 视觉层级）
- **PRD 章节 / 文件位置**：前端 `ui-custom/web/src/pages/alerts/ReceiverSnippetDrawer.tsx`；关联原 `## 22.`（该抽屉「令牌未配置时片段可用性口径 + 凭据外发提示」的原始口径留痕）
- **现状 / 根因**：该抽屉共 **5 个 `<Alert>`**——`:98` info「这段配置要用在哪」（常驻）、`:113` warning「权限不足」（403）、`:122` error「接收人配置获取失败 + 重试」、`:147` warning「通知暂不可用 / 平台尚未配置通知桥令牌」（令牌为空时）、`:180` warning「该片段含平台内网凭据，请勿外发」（常驻）。**令牌未配置时 3 块常驻告警叠加**（info + warning + warning），与 `Descriptions` / 片段块争夺视觉权重。
- **用户反馈（2026-09-30）**：「黄色的 alert 标志『通知暂不可用…』**这不是阻断的配置，只是提醒用户**；现在抽屉里多个 alert，样式和信息也很凌乱，还请优化设计」。
- **结论 / 设计原则（用户裁决范围：只改「接收人片段抽屉」）**：
  1. **一个抽屉最多一块 Alert**——只有「拿不到数据」才算阻断态（403 / 取数失败），才用 `Alert`；
  2. 常驻提示降级为三档，不占 Alert 视觉位：**抽屉副标题（description）→ 单行状态条 → 行内 tag**；
  3. 状态用「**色点 + 文本**」表达，不用整块背景色（`Alert type=warning` 的整块底被读作"出事了"）；
  4. 风险提示贴到**它保护的对象**上，而不是页面级 Alert。
- **字段级映射（现状 → 建议）**：
  | 现状 | 建议 |
  |---|---|
  | info「这段配置要用在哪」 | → 抽屉 `description`（标题下方副标题，一句话） |
  | warning「通知暂不可用」 | → **单行状态条**：色点 + 「桥令牌未配置 · 片段暂不可复制」+ 末尾「如何配置」入口 |
  | warning「含内网凭据，请勿外发」 | → 「配置片段」标题行右侧 **行内 tag**（`含内网凭据`）+ `Tooltip` 展开说明 |
  | error「取数失败」/ warning「权限不足」 | **保留 `Alert`**，且与其余态**互斥**（这两个才是阻断态） |
  | 常驻 Alert 数 | **3 → 0** |
- **影响模块**：M08 前端（`ReceiverSnippetDrawer.tsx`；`alertSmoke.test.tsx` / 该抽屉相关断言需同步）；后端零改动；原型 M08 对应抽屉同步。
- **发现场景**：用户 2026-09-30 现场反馈（伴随 F-36 报障一并提出）。
- **状态**：open（待排期；用户本轮选择「只落记录、暂不改代码」）

## 28. 【第一步 · 止血】通知链路上「平台自动填的」与「你手写的」分账（L1 + L2 + L3 打包落地，**不改产品形态**）

- **类别**：索引型聚合条目（汇总 ② 跨模块契约缺口 + ① 空白判定；本身不含新设计，只固定三项的边界 / 顺序 / 依赖 / 验收）
- **背景 / 触发**：用户 2026-09-30 报障（变更单 `CHG-20260930-001` 校验失败 + 桥地址回落 + 抽屉黄条）后，与其逐层复盘到根因，并拍定**三步修复路线**（见下方「三步路线」）。本条把其中的**第一步（止血）**三项打包登记，目的是让三处不各自为战：三项分居 M08 #16/#16.1、M09 F-36、M08 #26，**单看每一条都像独立缺陷，合起来才是同一条界线**。
- **三步路线（用户 2026-09-30 定调，供对齐边界）**：
  1. **第一步 · 止血（本条）**：把「平台自动填的」和「你手写的」划清，补上 L1 / L2 / L3。**不改任何产品形态**——不加 UI 入口、不改数据模型、不改 API 签名。
  2. **第二步 · route 前台化**：把 route 的可视化编辑做成前台能力（设计草案另落 `module-08/design-proposals/alert-route-frontend-editor.md`）。
  3. **第三步 · v0.3+**：平台连 `route` 一起物化，真正端到端自动生效（须先定义平台 route 与手写 route 的合并/冲突策略；本提案只登记，不展开）。

### 28.1 为什么叫「分账」

现场故障的表层是「`notify-1` 与第 114 行手写 receiver 重名冲突」，**根因是同一份 `alertmanager.yml` 里平台产物与用户产物无法被区分**：

| 分不清的地方 | 具体表现 | 对应子项 |
|---|---|---|
| **地址** 分不清 | 桥 base URL 是进程级临时参数，每次重启可能变；产物里那条到底是「平台上次写的」还是「手写的」无从判断 | L1 |
| **身份** 分不清 | 「平台自身产物」的识别条件是「name + URL 全等」，URL 一变即失效 → 平台自己的产物被读成用户手写 | L2 |
| **归属** 分不清 | 平台只写 `receivers` 不写 `route`，用户不知道「我该写什么、平台负责什么」 | L3 |

三项合起来才是把这条界线划清；任何一项单独修，故障都会从另一个口子再冒出来。

### 28.2 三个子项与落点

| 子项 | 一句话 | 归属条目（权威登记处） | 改动层 | 是否需契约修订 |
|---|---|---|---|---|
| **L1** 桥地址/令牌**持久化可配置** | 桥 base URL 与令牌从「进程级临时参数」升为「交付包 `env` 单一来源」，并接线到 `Makefile` / `package-center.sh` / `start.sh` | 本条 + **#16 / #16.1** | 构建 / 交付脚本（**零 Go 业务改动**） | 否 |
| **L2** 物化判据**认平台命名空间** | 「平台自身产物」由「name + URL 全等」改为「**receiver 名 ∈ 本次物化将生成的平台名集合**」：URL 同则跳过，URL 异则**原地更新该 receiver 的 url / http_config.authorization** 并写进变更项，**不再报冲突** | 本条 + **M09 F-36** | 生成逻辑 `configcenter/generator/notify_receivers.go` + 单测 | **是**（决策 74 定稿补充第 1 条） |
| **L3** 明确「**平台只负责 receivers，route 由用户写并引用**」 | 一期零代码：UI 与文档写明「平台自动写入的是 `receivers` 定义；要让通知真正生效，需在 `route`/`routes` 中把 `receiver` 指向它」 | 本条 + **#26** | 纯文案 + 文档（前端 + PRD + 契约快照 + 原型） | 否（属文档回填） |

### 28.3 执行顺序与依赖（**关键：L2 不可先行**）

```
L1（脚本接线）  ──┐
                  ├─→ 桥地址稳定 → F-36 触发频率↓（但不消除）
L3（纯文案文档）──┘        │
                            ↓
              L2（判据改造，须契约先修订）
              └─ 前置：M08 设计侧回写「决策 74 定稿补充第 1 条」
                       补一句「同名且 URL 属平台桥地址形态者视为平台产物，
                       按地址演进原地更新，不算重名」
```

1. **L1 先行（最独立、收益最大、零契约风险）**：纯脚本/环境改动。落地后 `make run-metric-center` 与交付包不再把地址退回 `127.0.0.1`，`CHG-20260930-001` 这类「地址漂移」诱因消失。**但判据缺陷独立存在**——换网域/换地址仍会复现（F-36 结论原文）。
2. **L3 可与 L1 并行（零代码、零阻塞）**：纯文案 + 文档回填，不受任何前置约束，可先发；且它同时是第二步（route 前台化）的**文案地基**，越早发越好。
3. **L2 必须最后**：其结论第 4 条要求修订决策 74 定稿补充第 1 条——**契约文字修订属 M08 设计侧职责，须先回写定稿，M09 才能动 `notify_receivers.go`**；否则改判据会与现行契约「重名即校验失败」直接冲突，变成「代码对了但契约说你错」。（**建议 L2 等第二步设计草案定稿后一并实现**，因为草案必然要重新定义 route/receiver 的归属与合并规则，L2 判据正好复用同一套命名空间约定。）

### 28.4 分项验收（落地判定）

| 子项 | 验收动作 | 通过判据 |
|---|---|---|
| L1 | `make run-metric-center` 启动后查看启动日志 | 显示**生效桥地址**（非 `127.0.0.1`）；`env/env.sh.example` 含 `NOTIFY_BRIDGE_URL` / `NOTIFY_BRIDGE_TOKEN` / `NOTIFY_RENDER_TIMEZONE` 三项；`start.sh` 已导出；bundle README 有「桥地址/令牌配置」小节 |
| L1 | 交付包按 README 部署 | 不带任何额外命令行参数启动，桥地址即为配置值（不复现「按文档启动必回落回环」） |
| L2 | 新增单测：桥地址 A→B 的草稿重校 | receiver 被**原地更新**且写进变更项，**不**产生 `failed + user_config` / 不报重名 |
| L2 | 新增单测：手写同名 receiver 指向非平台地址 | 仍判 `failed + user_config` + 行级错误（决策 74「绝不静默覆盖」语义不变） |
| L2 | 契约核对 | 决策 74 定稿补充第 1 条已含「同名且 URL 属平台桥地址形态者视为平台产物」 |
| L3 | 前端 + 文档 + 原型核对 | 接收人片段抽屉 / 告警配置页有「route 需指向」文案；PRD §3.3/§4 与 `api-contract-snapshot.md` §11.6 明确 receivers / route 归属边界；原型 M08 文案同步 |

### 28.5 回填清单（第一步各项落地时同步）

- **M08（本条 / L1 / L3）**：
  - 代码：`Makefile`（`run-metric-center` 透传 `NOTIFY_*`）、`scripts/package-center.sh`（`env.sh.example` + `start.sh` + bundle README）、`platform/cmd/metric-center/main.go`（启动日志显式打印生效桥地址，**无逻辑改动**）。
  - 前端（L3）：`ui-custom/web/src/pages/alerts/ReceiverSnippetDrawer.tsx`、`AlertConfigPage.tsx` 文案；（L3 文案落地时**与 `## 27.` 的抽屉信息架构重排一并做**，避免二次改同一抽屉）。
  - 原型：`docs/prototypes/module-08/`（L3 文案；`RoutesPage.tsx` 归属说明留给第二步草案）。
- **M09（L2）**：`platform/configcenter/generator/notify_receivers.go` + `notify_receivers_test.go` / `generator_test.go`（补「地址演进 → 原地更新」与「真重名 → 仍冲突」两组用例）。
- **契约 / 文档面**：决策 74 定稿补充第 1 条（L2 前置）、PRD §3.3/§4 + §11.6（L3）、`api-contract-snapshot.md` §11.6（L3）。
- **跨模块**：L2 契约修订由 M08 设计侧出、M09 实现；L1 由交付/构建侧；L3 由前端 + 文档侧。**三者的 Owner 不同，排期需分别落，不能合成一个 PR。**
- **影响模块**：M08（前端文案 + 交付脚本 + 决策/PRD/契约文档）、M09（判据改造 + 单测）、构建/交付（`Makefile` / `package-center.sh`）。
- **发现场景**：用户 2026-09-30 报障后逐层复盘，并拍定三步修复路线；本条按用户指示「第一步（止血）落 dev-feedback」建立聚合登记。
- **状态**：**landed（2026-09-30，第一步三项全部落地于 `feat/module-08-alert-dispatch`，未提交）**。子项状态：**L1 landed（#16 / #16.1，`Makefile`+`package-center.sh`+`main.go` 桥地址持久化与日志）**；**L2 landed（M09 F-36，`notify_receivers.go` 平台命名空间判据 + 决策 74 第 1 条 + 契约快照 §11.6）**；**L3 landed（#26，前端/PRD/契约文案分流）**。第二步（route 前台化）与第三步（平台连 route 物化）仍按设计草案推进。

## 29. 「通知模板 · 复制并自定义」克隆内置模板原样保存被去重拦截，副本永不落库（② 实现缺陷，根因已定位，待修复）

- **类别**：② 实现缺陷（后端保存路径去重逻辑误伤「复制并自定义」主路径）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §3.3.2（通知模板版本化留痕 + 复制内置模板自定义）；设计提案 `alert-config-scope-and-notification-bridge.md` §3.3.2；源码 `platform/alertmanager/notify/template.go`（`SubmitTemplate` :142-171、`findTemplateByChecksum` :240-251）、`platform/models/alertmanager_notify.go`（`NotifyTemplate` :105-113）；前端 `ui-custom/web/src/pages/alerts/NotifyTemplatesPage.tsx`（内置区「复制并自定义」`openClone` :84-89）、`NotifyTemplateDrawer.tsx`（clone 回填 :47-55）
- **现状 / 根因**：用户反馈「通知模板的『复制并自定义模板』并没有生效」。逐项核对后定位为**保存侧去重误伤**，与前端无关：
  1. **前端回填正常**：`openClone` 预填 `{name: 原名称+（副本）, channelType, content: 原content}`；抽屉 `useEffect` 经 `form.setFieldsValue` 回填；既有测试 `NotifyTemplatesPage.test.tsx::抽屉关闭后重新打开仍正确回显` 已锁定「点击克隆 → 名称/内容正确预填」。故「抽屉打不开 / 不回填」假设不成立。
  2. **真正的 bug 在后端 `SubmitTemplate`**：该校验通过后才落库，落库前调 `findTemplateByChecksum(db, in.ChannelType, checksum)` 去重——**去重键只有 `(channel_type, checksum)`，完全忽略 `name`**；命中即 `return existing, nil`，**不新建行**。
  3. **命中路径**：克隆内置「飞书卡片-默认」→ 抽屉名预填「飞书卡片-默认（副本）」、内容原样（= 内置 `BuiltinFeishuCardTemplate`）。保存时 `channel_type=feishu` 且 `checksum` 与内置模板完全一致 → `findTemplateByChecksum` 命中内置模板 → 直接返回内置模板本身（id=内置行 id），**副本留痕从未写入**；前端 `useNotifyTemplates.submit` 拿到返回后即 `reload` 列表，列表里没有「副本」，用户看到「点了没反应 / 没生效」。
  - **实证**：临时复现测试（seed 内置模板 → `SubmitTemplate(Name="飞书卡片-默认（副本）", ChannelType=feishu, Content=内置content)`）断言应返回副本且库内 2 行，结果返回 name="飞书卡片-默认"、库内仅 1 行 → 复现失败即坐实根因（复现测试已清理，未留存）。
  - **前置条件**：`NotifyTemplate` 模型 `name` **无唯一约束**（`:107` 仅 `size:100;not null`），故「不同名 + 同内容」共存于 DB 本就合法，不应被去重。
  - **触发边界**：仅当**克隆后内容原样未改**才复现；若用户在副本里改了模板内容（checksum 变化）则能正常落库——这恰是「复制并自定义」最常见用法（把内置模板当起点、原样先存一份）被卡死。
- **结论 / 推荐修法（待用户确认后实施）**：把 `SubmitTemplate` 去重键从 `(channel_type, checksum)` 收窄为 `(name, channel_type, checksum)`，使「同名同内容」才幂等、不同名（含副本）一律新建：
  1. `findTemplateByChecksum` 增加 `name` 形参并加入 WHERE（`db.Where("name = ? AND channel_type = ? AND checksum = ?", name, channelType, checksum)`）；该函数**仅被 `SubmitTemplate` 调用**（全仓 grep 唯一调用点 :153），改动无扩散风险。
  2. 语义自洽：① 同一模板**原样重提**（同名同内容）→ 幂等不重复（维持原行为）；② 克隆内置**改个名** → 新建副本（修掉本缺陷）；③ 同名**改了内容** → checksum 不同 → 新建一版（契合「版本化 append-only 留痕」口径，与 `RemountTemplate` 恒新建一致）。
  3. `NotifyTemplate` 不改结构、不加唯一约束。
- **回填清单（修复时同步）**：
  - 后端：`platform/alertmanager/notify/template.go`（`findTemplateByChecksum` 加 `name` 形参 + WHERE；`SubmitTemplate` 调用点透传 `in.Name`）。
  - 测试：新增 `template_test.go::TestSubmitTemplateDistinctNameSameContentCreatesNewRow`（seed 内置 → 提交同名同内容应幂等 / 提交改名同内容应新建）+ 在 `TestSubmitTemplateValidatesAndPersists` 旁补「同名同内容重复提交幂等」断言；`go test ./platform/alertmanager/notify/...` 全绿。
  - 前端：无需改动（`NotifyTemplatesPage.test.tsx` 克隆回显用例已覆盖 UI；可顺带补一条「克隆后原样保存 → 列表出现副本」的集成断言）。
- **影响模块**：M08 通知模板（PL-3 保存路径）；前端零改动。
- **发现场景**：用户 2026-09-30 反馈「M08 通知模板『复制并自定义模板』并没有生效」；核对 `NotifyTemplatesPage`/`NotifyTemplateDrawer` 回填（正常）→ 追踪到 `SubmitTemplate` 去重键忽略 name → 临时复现测试实锤。
- **落地（2026-09-30，已修）**：`platform/alertmanager/notify/template.go` 去重键由 `(channel_type, checksum)` 收窄为 `(name, channel_type, checksum)`——`findTemplateByChecksum` 加 `name` 形参 + WHERE，仅 `SubmitTemplate` 一处调用（grep 确认）；同名同内容仍幂等、改名同内容（克隆）新建、同名改内容新建一版（append-only）。同步更新原 `TestSubmitTemplateIdempotent`（旧断言误锁错误语义）为「同名同内容幂等 / 改名同内容新建」，新增 `TestSubmitTemplateCloneBuiltinVerbatimCreatesNewRow` 直击本缺陷。验证：`go test ./platform/alertmanager/notify/...` 全过、`go vet` 干净、`go test ./platform/alertmanager/...` 全过；改动未提交（WIP）。
- **状态**：landed（修复已落 `feat/module-08-alert-dispatch`，未提交；回归测试已锁。配套设计缺口见 #30）

## 30. 通知「多模板」能力半截：渠道↔模板无绑定，自定义模板在自动链路里恒哑火（① 空白判定 / 跨模块设计缺口，2026-09-30 用户拍板方案 B 并已落地）

- **类别**：① 空白判定（PRD 声明多模板 + 克隆自定义能力，但「渠道选哪个模板」的绑定/路由机制缺失）+ 跨模块契约缺口（M08 模板 ↔ M09 receiver 物化 ↔ 桥渲染）
- **PRD 章节 / 文件位置**：设计提案 `alert-config-scope-and-notification-bridge.md` §3.3.2（NotifyTemplate 版本化留痕 + 复制内置模板自定义，声明多模板能力）；落点证据：
  - `platform/models/alertmanager_notify.go`（`NotifyChannel` :76-83 **无 `template_id` 字段**；`NotifyTemplate` :105-113 仅 `is_builtin` 区分）
  - `platform/alertmanager/notify/bridge.go:186-204` `resolveBridgeTemplate`：URL 无 `?template=` 时恒走 `BuiltinTemplateForType`（按 `is_builtin=true` 取最近一条），**自定义模板（`is_builtin=false`）绝不会被自动选中**
  - `platform/configcenter/generator/notify_receivers.go:207-210` `bridgeReceiverURL`：M09 物化 receiver 只写 `?channel=<ID>`、**不写 template 参数**
  - 前端 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`：渠道增改表单**无任何「绑定模板」选择器**（grep `template|模板` 零命中）
- **现状 / 根因**：用户就 #29 克隆修复追问——① 新增飞书模板后默认模板是否还生效？② 产品是否允许多模板？③ 渠道是否要按多模板 match、是否需要引导动线？④ 默认模板与自建模板2 是否会冲突？逐项实证：
  1. **默认模板永远生效**：auto 链路（M09 物化 receiver → AM 投递 → 桥渲染）全程不带 `template` 参数 → `resolveBridgeTemplate` 回落内置默认；自定义模板2（`is_builtin=false`）**永远不会被自动选中**。
  2. **「多模板」结构性允许、功能性半残**：模型/UI/克隆均支持建多条（`dev-feedback #19` 已确认技术字段不展示、`#20` 确认 append-only 无删除）；但**没有任何把「某渠道 → 某模板」关联起来的机制**——渠道模型无 `template_id`、M09 不写 `template`、前端无选择器、桥只在显式 `?template=` 时才用非默认。即「能建多个，但平台自动链路只会用内置默认」。
  3. **没有冲突，但比冲突更隐蔽——静默失效（dead config）**：默认与模板2 不互相覆盖（`BuiltinTemplateForType` 只认 `is_builtin=true`），故**不会冲突**；但用户「默认信息不全、再建模板2 补足」的心智模型**完全落空**——模板2 建了却恒不生效，用户误以为已配置。更糟：若用户手改 receiver URL 加 `?template=2`，下次 M09 重算（平台命名空间 receiver 地址演进识别）会把 URL 覆写回 `?channel=<ID>`，**手动绑定不持久**。
  4. **缺引导动线**：从「建模板」到「让某渠道真正用上它」之间无任何 UI/数据通路，用户只能手改 URL（且不持久）或改内置（系统维护、不可改）。
- **结论 / 推荐设计（待用户拍板，非立即实现）**：引入**渠道↔模板一等绑定**，把 `?template=` 从「隐藏 query」升级为「渠道属性」：
  - 模型：`NotifyChannel` 新增 `DefaultTemplateID *uint`（`null` = 用内置默认）；约束 `template.channel_type = channel.type`（桥已校验 mismatch）。
  - 桥 `resolveBridgeTemplate`：渠道有绑定且类型匹配 → 用绑定模板；否则回落内置默认（维持零配置 Happy Path）。
  - M09 `bridgeReceiverURL`：渠道有绑定时输出 `?channel=<ID>&template=<绑定ID>`，否则 `?channel=<ID>`（地址演进识别仍成立，绑定随之持久）。
  - 前端：渠道增改表单新增「通知模板」下拉（按渠道类型过滤，内置默认置顶并标注「平台内置」、自定义可选、默认=用内置），并显式提示「未选则使用平台内置默认模板」。
  - 引导动线闭环：复制并自定义 → 在渠道里选该模板 → receiver 自动带 `template` 参数 → 桥按绑定渲染；并在渠道表单模板下拉旁加「没有合适的？去复制内置模板」入口，模板页与渠道页互相引流。
- **回填清单（拍板后实施时）**：
  - 后端：`alertmanager_notify.go`（加列 + 迁移）、`bridge.go`（`resolveBridgeTemplate` 读绑定）、`notify_receivers.go`（`bridgeReceiverURL` 带绑定 ID）
  - 前端：`NotifyChannelsPage.tsx`（渠道表单模板下拉 + 引流）、`NotifyTemplatesPage.tsx`（反向入口）
  - 契约：`api-contract-snapshot.md` §11（channel 响应/请求新增 `default_template_id`；bridge 渲染选模板口径）
  - 测试：`bridge_test.go`（绑定时用绑定模板 / 未绑定时用内置 / 类型不符仍 mismatch）、`generator` 测试（带绑定输出 `&template=`）
- **影响模块**：M08（模板页/渠道页/桥）、M09（receiver 物化）、数据模型（`NotifyChannel` 加列 + 迁移）；不动渲染函数与 default 回落语义。
- **发现场景**：用户 2026-09-30 就 #29 克隆修复追问「多模板是否允许 / 渠道如何 match / 默认与自建是否冲突 / 是否需要引导动线」。
- **设计草案**：已落 `docs/05-execution-records/module-08/design-proposals/notify-template-channel-binding.md`（方案 B：渠道↔模板一等绑定 + 双向引流动线；含数据模型/桥口径/M09 物化/前端下拉/兼容迁移/契约/验证/回填清单/P1-P3 待决）。推荐 `NotifyChannel.DefaultTemplateID *uint`（null=内置默认）+ 桥读绑定 + M09 输出 `&template=` + 前端渠道表单模板下拉 + 双向引流；绑定失效优雅回落内置默认（不 400）。
- **状态**：landed（2026-09-30，用户拍板方案 B 并已实现，配套测试已锁。与 #29 配合——#29 修「能建副本」，本项修「副本能被用上」）
- **落地（2026-09-30，方案 B 已实现）**：
  - 模型：`NotifyChannel.DefaultTemplateID *uint`（`json: default_template_id,omitempty`；迁移经 `db.AutoMigrate`，存量 `null` → 回落内置默认，零影响）。
  - 渠道 CRUD：新增/更新校验「模板存在 + `channel_type` 与渠道一致」（不存在/不符 → `bad_request`）；`ChannelView` 回显 `default_template_id`；更新语义「不传=保留 / `0`=解绑 / `>0`=改绑」。
  - 桥：`resolveBridgeTemplate` 改为三级优先级（显式 `?template=` > 渠道 `default_template_id` > 内置默认）；绑定失效（被删 / 类型不符 / 脏数据）**优雅回落内置默认并记 warning，不返回 4xx**（否则 AM 无限重试、该渠道告警整体丢失）。
  - M09：`bridgeReceiverURL` 对已绑定渠道输出 `?channel=<ID>&template=<ID>`；绑定变化经「平台 receiver 地址演进原地更新」承载 → **绑定随物化持久、不被重算覆写**。接收人片段 `buildBridgeURL` 同源（避免参考片段与实际下发口径漂移）。
  - 前端：渠道抽屉在「渠道类型」与「机器人 Webhook」间加「通知模板」下拉（按渠道类型过滤、内置置顶标注、切换类型重置、可清空解绑）；模板页内置区补「复制出的模板需在通知渠道中绑定才会生效」引流链接（双向引流）。
  - 契约：`api-contract-snapshot.md` §11.1 / §11.3 / §11.4 / 新增 §11.7 已回写。
  - 验证：`go test ./platform/...`、`go vet ./platform/...`、`tsc --noEmit`、`vitest run src/pages/alerts`（126 passed）全绿。
  - 待 design 侧回写：PRD §3.3.2（多模板 + 渠道绑定）/ 原型 M08 渠道抽屉（开发 Agent 不写 PRD）。
