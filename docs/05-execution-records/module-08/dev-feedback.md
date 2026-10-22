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
- **状态**：~~open（方案 A 已确认、待实现）~~ → **2026-10-09 部分回退**：方案 A 的「自动闭环」子项已实现并上线，但当日经用户裁决**关闭自动确认**（见 #43）：告警配置提交不再自动 `ConfirmDraft`，改由 M09 人工确认。#25 中「状态去误导」子项（前端改读 `applied_at`）**仍然有效并保留**；「自动闭环」子项作废。

## 26. 平台物化的通知 receiver **没有任何 route 引用** → 死配置，且成为 F-36 误报的触发物（② 实现偏差 / 跨模块契约缺口，2026-09-30 用户裁决「明确 route 由用户写」）

- **类别**：② 实现偏差（跨模块契约缺口）
- **PRD 章节 / 文件位置**：决策 74 定稿补充第 1 条（receivers 合并 / 冲突策略，仅规定 receivers）；实现 `platform/configcenter/generator/notify_receivers.go`（只操作 `receivers:` 序列，见 `:86-115`）
- **现状 / 根因**：平台按「已启用渠道」物化 `receivers[]`，但**完全不触碰 `route` / `routes`**。实测线上 `config-output/alertmanager.yml` 的 4 处 `receiver:` 全部指向用户手写的 `feishu`（`:30/:76/:84/:92/:100`），平台生成的 `notify-1` **无任何 route 引用 → 永不投递**。结果：同一个启用渠道（`id=1`）出现「一个活 receiver（手写 `feishu`）+ 一个死 receiver（平台 `notify-1`）」，而**死的那一个恰好是 F-36 误报「重名冲突」的触发物**。
- **判定（用户 2026-09-30 裁决）**：一期**明确为「平台只提供 receiver 定义，`route` 由用户书写并指向」**——零代码改动，仅在 UI 与文档写明：
  1. 前端：接收人片段抽屉 / 告警配置页补一句「平台自动写入的是 `receivers` 定义；要让通知真正生效，需在 `route`/`routes` 中把 `receiver` 指向它」；
  2. 文档：M08 PRD（PL-2 三块必写 + PL-3 物化）与 `api-contract-snapshot.md` §11.6 明确 receivers 与 route 的归属边界；
  3. 原型 M08 同步该文案。
- **备选（记 v0.2，不在本期）**：平台连 `route` 一起物化（真正端到端自动生效）——须先定义「平台 route 与用户手写 route / routes 的合并与冲突策略」，复杂度高，需再过一轮设计提案。
- **⚠️ 口径升级（2026-09-30，以决策 113 为准）：原登记为「计划」，现状态更新为「已落地（T08-09 / T08-10）」**——该「备选」已被**收窄后提前至本期并落地**，不再做「平台连整棵 `route` 一起物化」，改为 **决策 113 口径 C**：默认（手写）模式 + 用户显式开关（与 PRD P3「默认接收人」合并为同一件事）下，平台**只原地替换根 `route.receiver` 单键**（生成器 `platform/configcenter/generator/notify_route_skeleton.go::MaterializeRootRouteReceiver`，接线 `platform/configcenter/draft/service.go::materializeRootRouteReceiver`，端点 `GET|PUT /api/v2/platform/alertmanager/route-setting`），**绝不写 `route.routes[]`**。故本条「route 由用户写」的表述修订为「**具体分流 `routes[]` 由用户写；根兜底 `receiver` 在开关开启时由平台接管**」。落地细节、三条护栏位置与决策 114 补充见 `## 31.`。
- **影响模块**：M08（决策 74 定稿补充第 1 条注释 + PRD §3.3/§4 + 契约快照 §11.6 + 前端抽屉文案 + 原型）；M09（`notify_receivers.go` 维持「只物化 receivers」不变）。
- **发现场景**：用户 2026-09-30 报 receiver 重名冲突，对照线上 `route` 段（4 处 `receiver: 'feishu'`）与草稿产物 `receivers` 段（`feishu` + `notify-1`）时发现平台 receiver 无引用。
- **状态的聚合登记**：本项 = **`## 28.`【第一步 · 止血】的 L3**（零代码文案/文档收敛；与 `## 27.` 的抽屉信息架构重排**同批落地**，见 #28.5）。route 物化的备选方案见第二步设计草案 `module-08/design-proposals/alert-route-frontend-editor.md`。
- **状态**：**landed（2026-09-30，L3 已落）**——ReceiverSnippetDrawer/AlertConfigPage 已补 L3 文案（文案已随 T08-F9 二次改写为骨架口径，见 #28.5）；PRD §3.3/§4 与 `api-contract-snapshot.md` §11.6 / §11.10 已明 receivers/route 归属边界；原型 M08 文案同步。**根兜底单键接管**已随决策 113 口径 C 落地（见 `## 31.`）；**整棵 `route` / `routes[]` 物化**仍记 v0.3+（第二步/第三步），不在本期。

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
- **状态**：**landed（2026-09-30）**——`ui-custom/web/src/pages/alerts/ReceiverSnippetDrawer.tsx` 头注释（`:14-16`）与实现已按本项落地：**常驻 `Alert` 数 3 → 0**（原 info「这段配置要用在哪」→ 抽屉副标题 `drawerDescription`（`:86-92`，渲染 `:116`）；原 warning「通知暂不可用」→ **单行状态条**「色点 + 文本」（`:154-180`）；原 warning「含内网凭据」→ 片段标题右侧**行内 `Tag` + `Tooltip`**（`:213-215`））；抽屉内仅保留**阻断态、且互斥**的两块 `Alert`——权限不足（403，`:119-126`）与取数失败（`:128-140`）。

## 28. 【第一步 · 止血】通知链路上「平台自动填的」与「你手写的」分账（L1 + L2 + L3 打包落地，**不改产品形态**）

- **类别**：索引型聚合条目（汇总 ② 跨模块契约缺口 + ① 空白判定；本身不含新设计，只固定三项的边界 / 顺序 / 依赖 / 验收）
- **背景 / 触发**：用户 2026-09-30 报障（变更单 `CHG-20260930-001` 校验失败 + 桥地址回落 + 抽屉黄条）后，与其逐层复盘到根因，并拍定**三步修复路线**（见下方「三步路线」）。本条把其中的**第一步（止血）**三项打包登记，目的是让三处不各自为战：三项分居 M08 #16/#16.1、M09 F-36、M08 #26，**单看每一条都像独立缺陷，合起来才是同一条界线**。
- **三步路线（用户 2026-09-30 定调，供对齐边界）**：
  1. **第一步 · 止血（本条）**：把「平台自动填的」和「你手写的」划清，补上 L1 / L2 / L3。**不改任何产品形态**——不加 UI 入口、不改数据模型、不改 API 签名。
  2. **第二步 · route 前台化**：把 route 的可视化编辑做成前台能力（设计草案另落 `module-08/design-proposals/alert-route-frontend-editor.md`）。
  3. **第三步 · v0.3+**：平台连 `route` 一起物化，真正端到端自动生效（须先定义平台 route 与手写 route 的合并/冲突策略；本提案只登记，不展开）。**⚠️ 2026-09-30 修订**：该步已**部分提前**——「**根兜底 `route.receiver` 单键**」按**决策 113 口径 C** 提前至本期（默认手写模式 + 显式开关，只替换根 `receiver`，不写 `routes[]`）；「整棵 `route` / `routes[]` 物化」仍留在本步 v0.3+。

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
  - 前端（L3）：`ui-custom/web/src/pages/alerts/ReceiverSnippetDrawer.tsx`、`AlertConfigPage.tsx` 文案；（L3 文案落地时**与 `## 27.` 的抽屉信息架构重排一并做**，避免二次改同一抽屉）。**注意：L3 文案已随 T08-F9 二次改写为骨架口径**——现文案为「具体分流 `route.routes[]` 由你写；根兜底 `route.receiver` 在你选定默认接收人后由平台接管」，**非**旧「平台只负责 `receivers`、`route` 由用户写」文案；后人核对/回归请按现文案（`alertSmoke.test.tsx` 已锁该断言），勿按旧文案回归。
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

## 31. 最小运行骨架自动布缆（决策 113 口径 C）落地：根兜底 `route.receiver` 单键接管 + 三条护栏（② 契约缺口落地 / ① 空白判定，2026-09-30，已落地）

- **类别**：② 契约缺口落地（`route` 段单一作者的「根兜底」部分；原 #26「一期 route 由用户写」的过渡裁决已被决策 113 取代）+ ① 空白判定（护栏③语义）
- **PRD 章节 / 文件位置**：决策 113（口径 C）+ 决策 114（护栏③语义 / `/routes` 数据源修正）；PRD `Module_08_*.md` §4.1.1；契约快照 `docs/05-execution-records/module-08/api-contract-snapshot.md` §11.6 / §11.9 / §11.10
- **落地内容（口径 C：默认手写模式 + 用户显式开关，只原地替换根 `route.receiver` 单键）**：
  - **模型**：`platform/models/alertmanager_route_setting.go` — `AlertmanagerRouteSetting{NetworkDomainID, DefaultReceiverChannelID *uint}`（表 `alertmanager_route_settings`，管理域 `default` 单例）；`*nil = 不接管`；纯函数 `EffectiveDefaultReceiver(channels) (string, bool)`（目标渠道不存在 / 未启用 → `false`，设定原值保留、不回写库）。
  - **生成器**：`platform/configcenter/generator/notify_route_skeleton.go` — `MaterializeRootRouteReceiver(baseYAML, RootRouteInput{Enabled, DefaultReceiver, PlatformReceiverNames})`：仅原地替换根 `route.receiver` 单键；目标不在可达集合 / YAML 非法 / 无 `route` 节点 / 根 route 无 `receiver` 标量 → **跳过 + 诊断，不返回 error**；幂等。
  - **接线**：`platform/configcenter/draft/service.go` — receivers 物化（`materializeNotifyReceivers`）→ **根兜底注入**（`materializeRootRouteReceiver`）→ Checksum 的顺序；`buildArtifacts` 与重校（`artifactsFromDraft`）两条路径均执行。
  - **端点**：`GET|PUT /api/v2/platform/alertmanager/route-setting`（`platform/alertmanager/route/setting_handler.go`；注册 `platform/alertmanager/register.go`）；`GET /api/v2/platform/alertmanager/routes`（`platform/alertmanager/route/handler.go`，仅全局认证、只读）。
- **三条护栏落地位置**：
  | 护栏 | 语义 | 落地位置 |
  | ---- | ---- | ---- |
  | ① 二次确认 | 选定默认接收人 = 授权平台接管根兜底，须二次确认并明示注入点（只替换根 `receiver` 单键） | 前端 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx::handleDefaultReceiverChange`（`:144-172`，`Modal.confirm` `:155-171`；控件 `:477-525`） |
  | ② 变更单明示 | 开关开启后用户手改根 `receiver`，下次生成覆盖时在变更单写明「根兜底被平台重建」 | `platform/configcenter/draft/service.go::appendRootRouteRebuiltItem`（`:348-362`，`Description: "根兜底被平台重建（route.receiver 已按默认接收人替换）"`） |
  | ③ 关闭语义 | 关闭 = 平台停止替换，不主动改写 / 回滚文件（语义以**决策 114 第 1 条**为准） | `platform/alertmanager/route/setting_handler.go::PutRouteSetting`（`nil` = 关闭接管）；`models.EffectiveDefaultReceiver` / `draft.materializeRootRouteReceiver`（渠道停用 → 产物字节级不变） |
- **`route_files` 已废弃说明**：Alertmanager 顶层键无 `route_files`（`upstream/alertmanager/config/config.go`），且进程只接受单个 `--config.file`、平台只写 `config-output/alertmanager.yml` **一个**文件（`platform/configcenter/deployment/service.go`）——PRD 早期「手写模式经 `route_files` 合并平台片段」表述**在现网形态下不可实现、已废**；正确口径为「开关开启时原地替换根 `route.receiver` 单键」。PRD 侧 §4.1.1 的 `route_files` 残留由 T08-D2 回写清除（本项不写 `docs/02-product-requirements/`）。
- **决策 114 的护栏③语义澄清**：原护栏③「关闭 = 停止替换、不删最后写入的值」易被误读为「永久保留已写入值」；**权威语义 =「关闭 = 停止替换；不主动改写 / 回滚文件；后续自然重算按正常产物生成」**（实测磁盘上平台上次写入的值会被自然重算覆盖，这是「停止替换」的必然结果，非平台主动删除）。不引入「最后写入值」的额外持久化状态。
- **决策 114 的 `/routes` 数据源修正**：原实现读 `config.LatestApplied` 的**挂载留痕原文** → 修正为「**平台最新产物视图**」（管理域最近一条未废弃草稿产物 → 最近一条 `ConfigVersion` 产物 → 取新 → 都无时退化留痕），修复「设定生效后页面根 `receiver` 仍显示手写值 + 把已被根路由引用的平台 receiver 误报为死配置」（与 v0.3-a「消解死接收人」立身点相冲）。**教训**：AM 场景「当前生效」必须锚定 M09 **产物**，而非 M08 **挂载留痕**。
- **验证**：`go test ./platform/...` 全通过、`go vet ./platform/...` 干净；`vitest run src/pages/alerts` 全绿（`AlertConfigPage.test.tsx` 覆盖护栏①二次确认 / 护栏③关闭 / 400 兜底；`alertSmoke.test.tsx` 覆盖控件就位与 L3 文案）。
- **影响模块**：M08（模型 / 生成器 / 草稿接线 / 端点 / 告警配置页 / 接收人片段抽屉）、M09（`alertmanager.yml` 生成，`notify_receivers.go` 维持「只物化 receivers」不变）。
- **发现场景**：用户就「最小运行骨架自动布缆」的落地形态（A/B/C 三口径）要求复评后采纳 C（决策 113）；端到端联调（独立 SQLite + `config-output` + Prometheus/Alertmanager/metric-center）暴露护栏③措辞与 `/routes` 数据源两处问题后由用户逐项拍板（决策 114）。
- **状态**：**landed（2026-09-30）**——代码 + 测试 + 契约快照 §11.6 / §11.9 / §11.10 已落；未提交。

## 32. 派生预览（告警配置页）未展示"渠道↔模板"绑定，造成"模板没被纳入"错觉（① 空白判定 / UX 信息缺口，open）

- **类别**：① 空白判定（派生预览作用域未覆盖与 receivers 强相关的模板绑定）+ ③ 技术优化（UX 信息架构）
- **PRD 章节 / 文件位置**：派生预览卡片 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`（`:560-631`）；数据 Hook `ui-custom/web/src/pages/alerts/useDerivedReceivers.ts`；后端 `platform/alertmanager/notify/receiver_snippet.go`（`:105-112` 把 `&template=<ID>` 编进 receiver URL）；渠道↔模板一等绑定见 #30；现状分层口径见 `docs/05-execution-records/module-08/design-decisions.md` 及 2026-10-01 设计澄清。
- **现状 / 根因**：派生预览只渲染「平台将写入 `alertmanager.yml` 的 `receivers` + 默认 `route.receiver`」，逐渠道展示 receiver 名 + YAML 片段，**未展示该渠道绑定的通知模板**。但渠道↔模板是一等绑定（#30 已落地）：后端 `BuildReceiverSnippet`→`buildBridgeURL`（`receiver_snippet.go:105-112`）在渠道 `DefaultTemplateID != nil && != 0` 时把 `&template=<ID>` 编进 receiver 的 webhook URL，桥（`notify/bridge.go:97` `resolveBridgeTemplate`）据此渲染；且前端 `NotifyChannel.default_template_id`（`types/alertmanager.ts:263`）**已由 `notifyChannelsApi.list()` 透传**。即「平台为这条渠道派生的 receiver 绑定了哪个模板」数据完全在前端可取，却未在派生预览呈现 —— 用户在 2026-10-01 走查后追问，明确产生"模板没被纳入派生"的错觉。
- **结论 / 建议**：派生预览每个渠道派生块，除 receiver 名外，**解析并展示"绑定模板：X（模板名）"**；未绑定（`default_template_id` 缺省 / 0）时显式提示"未绑定（回落该渠道类型内置默认模板）"。**前端零后端改动即可实现**：
  - `useDerivedReceivers.ts`：`DerivedReceiverRow` 增加 `defaultTemplateId?: number` 与 `channelType?: NotifyChannelType`，取自 `notifyChannelsApi.list()` 已返回的 `channel.default_template_id` / `channel.type`；
  - `AlertConfigPage.tsx`：引入 `useNotifyTemplates` 构建 id→name 映射（含内置模板），在派生预览卡片 `derivedRows.map` 处渲染"绑定模板：X"；未绑定时用 `notifyChannelTypeLabel[channelType]` 提示内置默认；`useNotifyTemplates` 的 `permissionDenied` 态降级为仅显示模板 ID，不阻断整页。
  - 文案/样式对齐现有派生预览（`Typography.Text` `type="secondary"`，中文）。
- **影响模块**：前端（告警配置页 · 派生预览卡片）
- **发现场景**：2026-10-01 用户就"路由规则 / 派生预览"设计追问（"派生功能为什么只提示路由情况，不说明通知渠道模版的情况"）；经代码核实事属 UX 信息缺口——模板本就不进 `alertmanager.yml`（由桥渲染，属分层设计非后端遗漏），但绑定关系埋在 receiver URL 的 `&template=<ID>` 参数里未展开，派生预览只讲了 receivers/route 的"有/无"而没讲"绑定了哪个模板"。
- **状态**：**open**——待 agent 开发（前端增强，已定位、路径明确；后端无需改动）。

## 33. 三层配置模型缺口：最小运行骨架 → 含分流的完整预置示例（① 空白判定 / 预置种子，open，与 T08-F12 模式开关同排期）

- **类别**：① 空白判定（最小运行骨架 ≠ 完整预置示例；平台缺"标准模板库"种子配置，对应 2026-10-02 用户三层配置模型第 ① 层）+ ③ 技术优化（可选：注入时机/种子结构）
- **PRD 章节 / 文件位置**：决策 113（口径 C，最小运行骨架）/ #31（根兜底单键接管）；PRD §4.1.1（段级所有权）、§11.6（逃生舱）、§11.7（模板不进文件）；T08-F12（`route-setting` 无 `mode` 字段、`GET /routes` 恒返回 `ModeHandwritten`，模式开关无持久化通道）；设计提案 `docs/05-execution-records/module-08/design-proposals/alert-config-three-layer-model.md`（2026-10-02 落 feat 工作树，PRD 冻结期只构思）。
- **现状 / 根因**：用户 2026-10-02 就「告警配置页」提出三层配置模型（① 预设标准 alertmanager 配置文件模板库 / ② 平台派生配置 / ③ 高级用户自己挂载）。经核对已决策 PRD 基线：第 ③ 层 = §11.6 逃生舱（已存在）；第 ② 层 = §4.1.1 托管模式 `receivers` 双作者 + `route` 模式开关（已基本存在，缺模式开关持久化）；**第 ① 层 = 缺口**——#31 / 决策 113 仅落地「最小运行骨架自动布缆」（原地替换根 `route.receiver` 单键），平台**没有任何**含 matchers / 分流示例 / receivers 示例 / inhibit 示例的「完整预置 alertmanager.yml 片段」。即用户提案的"标准模板库"在现网形态下只有"骨架"口径，无"完整示例"交付物。
- **结论 / 建议**：把第 ① 层落地为「**托管模式预置种子（preset seed）**」——一份含分流示例的完整 `alertmanager.yml` 片段，在全新/空配置域由平台注入托管模式产物；语义与 #31 根兜底单键接管互补（骨架管"兜底 receiver"，种子管"完整示例"）。**该缺口必须与 T08-F12 模式开关同排期**：当前 `GET /routes` 恒返回 `ModeHandwritten`、模型无 `mode` 字段，模式开关无持久化通道——这是"骨架 vs 预置 vs 手写"三态无法落地的根因；预置种子依赖模式开关区分"托管基线"与"手写接管"。详见设计提案 §3/§9.1（方案 A：预置种子 + 模式级失活，拒绝逐实体禁用）。**提案已于同日 17:34 合并「议题二：告警配置页信息架构」（§1.2/§6/§7），本条对应提案的议题一，页面 IA 侧见 #38。**
- **影响模块**：M08（托管模式产物/种子配置/模式开关/告警配置页/路由页）、M09（`alertmanager.yml` 生成，维持只物化 receivers 不变）、端点 `route-setting` / `routes`（模式开关字段）。
- **发现场景**：2026-10-02 用户就"告警配置页"提三层配置模型 + SSOT/禁用疑问；分析（`alert-config-three-layer-model.md`）确认 ① 缺完整预置示例、与 T08-F12 模式开关同排期；"禁用"诉求被既有段级模式开关吸收，无需逐实体禁用。
- **状态**：**landed（2026-10-02，未提交）**——T08-F12 模式开关先落地后本项已解阻。新增 `generator.SeedManagedRoutePreset`（`notify_route_preset.go`，`RoutePresetInput{Mode,DefaultReceiver,PlatformReceiverNames}`）+ 接线 `buildArtifacts`/`artifactsFromDraft`/`RevalidateDraft`（顺序 receivers → 根兜底 #31 → 预置种子，置于根兜底之后以免整段替换丢弃决策 113 接管值）+ 变更单「预置示例已注入」。仅 managed 模式生效（handwritten 字节级不变，守 §11.6 逃生门）；不覆盖已有 route（`routes:` 非空 / 根 `matchers:` 非空 / `continue:true` 视为用户意图，空 `routes:[]` 不算）；接收人仅取文件 `receivers:` 已声明名（不信平台名，避免桥地址未配时产出 amtool 拒绝配置）。`go test ./platform/...`+`go vet` 全绿；前端零改动（`GET /routes` 读生效产物，种子路由经 `# 路由名称:` 注释在路由页可见/可编辑）。

## 34. 后端路由解析/校验链修复（golang-reviewer 审查 blocking/HIGH 打包，fix 轮 open）

- **类别**：② 实现偏差（B1 跨 T08-12 边界）/ ③ 技术优化（H1/H2/H3）
- **PRD 章节 / 文件位置**：`platform/alertmanager/route/parse.go`（B1 `RouteNode` 解析）、`platform/configcenter/generator/notify_route_generate.go`（H1 `RouteEditNode`，:61）、`platform/alertmanager/route/validate.go`（H2 `ValidateRouteTree`，:83）、`platform/alertmanager/route/validate_test.go:270`（`toEditNodes` 仅测试）、路由保存链/产物生成。
- **现状 / 根因（golang-reviewer 2026-10-01 REQUEST_CHANGES）**：
  - **B1**：`parse.go` 解析 route 段时**静默丢弃未建模键**（`match:`、route 级 `mute_time_intervals:`）→ 用户手写配置经「导入→保存」会**丢失配置**，跨 T08-12 边界（用户配置不可丢）。
  - **H1**：生产代码**缺 `RouteNode→RouteEditNode` 转换器**，仅 `validate_test.go:270 toEditNodes` 在测试里存在；保存链/产物生成若直接用测试转换器或类型不匹配会出错。
  - **H2**：`ValidateRouteTree(nodes []RouteNode)` 入参为 `[]RouteNode`，但保存链持有 `[]RouteEditNode` → 校验与保存类型错位，会产出 amtool 拒绝的 `="x"` 字面量。
  - **H3**：`RouteEditNode.Enabled` 用 `bool` 零值（`false`）携带语义，零值歧义（"未设"与"关"不可分）。
- **结论 / 建议**：B1 改为 **fail-closed**（未知键报错或原样保留到原始通道，不静默丢弃）；H1 在 `notify_route_generate.go` 落地生产级 `ToEditNodes`/`ToRouteNodes` 转换器并单测；H2 统一 `ValidateRouteTree` 入参与保存链类型（改签 `[]RouteEditNode` 或显式转换）；H3 `Enabled` 改 `*bool` 或明确零值语义并在转换处处理。四者打包后端 fix 轮。
- **影响模块**：M08（路由解析/校验/生成）
- **发现场景**：golang-reviewer 审查 T08-13 产物（4 新文件）返回 REQUEST_CHANGES，blocking=B1、HIGH=H1/H2/H3。
- **状态**：**landed（fix 轮，2026-10-02，未提交）**——B1（parse.go 无损保留未建模键）/ H1（生产 RouteNode↔RouteEditNode 转换器 `route/convert.go`）/ H2（`ValidateRouteTree` 改签 `[]RouteEditNode`）/ H3（`Enabled *bool`）已落地；`go test ./platform/...` + `go vet` 全绿。

## 35. 前端路由编辑/保存修复（frontend-reviewer 审查 blocking/HIGH 打包，fix 轮 open，依赖 #34 + T08-F12）

- **类别**：② 实现偏差（C1 跨模块）/ ③ 技术优化（H1/H2/H3/H4）
- **PRD 章节 / 文件位置**：`ui-custom/web/src/pages/alerts/useRoutes.ts`（C1 `:189` save 基源 / H1 `:212` knownReceivers）、`RoutesPage.tsx`（H2 列表「未定义」红字 / C1 基源）、`RouteEditorDrawer.tsx`（H3 根 receiver 必填 / H4 部分导入护栏）、`routeTree.ts`（knownReceivers 校验）、`notifyChannelsApi.getReceiverSnippet`（admin-only N+1）。
- **现状 / 根因（frontend-reviewer 2026-10-01 REQUEST_CHANGES）**：
  - **C1**：`useRoutes.ts:189` 保存链 `generateRouteSection(tree)` → `GET /config/current`（**挂载留痕原文**）作基座，而列表读 `effectiveAlertmanagerYAML`（**平台产物视图**）→ 合并会把平台已物化的 `receivers` **回滚**掉（需后端增量提供产物视图基座）。
  - **H1**：`knownReceivers` 经 `getReceiverSnippet(channel.id)` **逐渠道 N+1**、且接口 **admin-only** → 非管理员取不到、`F13` 验收①失败。
  - **H2**：`RoutesPage` 列表对"引用了未定义 receiver"**缺红色「未定义」提示**。
  - **H3**：`RouteEditorDrawer` **根 route 的 receiver 必填未校验**（可提交空 receiver）。
  - **H4**：部分导入保存**无护栏**，会直接覆盖原 route（应提示/确认）。
- **结论 / 建议**：C1 改基源为后端产物视图基座（#34 后端增量配套）；H1 改取**非管理员可用**的 receivers 清单（批量端点或放宽权限，避免 N+1）；H2 列表补红字；H3 抽屉校验根 receiver 必填；H4 部分导入保存前加确认/差异展示护栏。五者打包前端 fix 轮，依赖 #34 与 T08-F12。
- **影响模块**：前端（路由页/抽屉/useRoutes/routeTree）
- **发现场景**：frontend-reviewer 审查 F11/F13 产物返回 REQUEST_CHANGES，blocking=C1、HIGH=H1/H2/H3/H4。
- **状态**：**landed（fix 轮，2026-10-02，未提交）**——C1/H1/H2/H3/H4 已落地（`useRoutes.ts` save 基源改走 admin `getProduct`、knownReceivers 改 `notifyChannelsApi.list()`、H2 红字、H3 根 receiver 必填、H4 部分导入护栏）；`tsc --noEmit` 0 错、`vitest run src/pages/alerts` 全绿。
- **安全收敛（C1 关键修正）**：fix 轮初版把含凭据的 `effective_alertmanager_yaml` 透传进**非 admin** `GET /routes`，被既有安全门 `TestListRoutesHandler_NoSensitiveValues`（禁止桥令牌/出站密钥出现在非 admin 响应）拦截——已改为**合并基只从 admin `GET /config/product`（及回落同样 admin 的 `/config/current`）获取**，非 admin `GET /routes` 不再透传凭据；保存提交 `POST /config` 本就 RequireAdmin，故保存链路整体 admin 一致（非 admin 仅查看/编辑、不能提交），零凭据泄漏。

## 36. T08-F12 模式开关持久化（后端 mode 字段 + GET /routes + 前端控件，fix 轮 open，与 #33 绑定）

- **类别**：② 契约缺口落地（route 段模式开关无持久化通道）
- **PRD 章节 / 文件位置**：`platform/models/alertmanager_route_setting.go:21-24`（仅 `{NetworkDomainID, DefaultReceiverChannelID}`，无 `Mode`）；`platform/alertmanager/route/handler.go:48,58,69`（`GET /routes` 恒硬编码 `mode: ModeHandwritten`）；`platform/alertmanager/route/parse.go:32-35`（注释明示 T08-F12 未实现、本期恒手写）；`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx` / `RoutesPage.tsx`（前端模式开关控件缺失）。
- **现状 / 根因**：`AlertmanagerRouteSetting` 模型**无 `Mode` 字段**，`GET /api/v2/platform/alertmanager/routes` **恒返回 `ModeHandwritten`**（不读存储）。→ 模式开关**无持久化通道**：用户在 UI 切 managed/handwritten 无法落库、下次读取又被重置为手写；F11/F13 的可写 UI 在真实环境**不可达**（测试绿 ≠ 功能可用），与 dev-feedback #33「骨架/预置/手写三态」落地直接挂钩。
- **结论 / 建议**：`AlertmanagerRouteSetting` 加 `Mode RouteMode`（`gorm` 列，默认 `handwritten`，经 `AutoMigrate` 迁移，存量零影响）；`GET /routes` 据存储返回 `mode`（非硬编码）；`route-setting` `PUT` 同时写 `mode`；前端 `AlertConfigPage`/`RoutesPage` 加模式开关控件（managed↔handwritten），切手写即整段让出（守卫③不删内容，§11.6）。与 #33 同批设计/同批排期。
- **影响模块**：M08（模型/端点/告警配置页/路由页）
- **发现场景**：golang/frontend reviewer 共同 blocker；dev-feedback #33 已登记「模式开关缺失是三态落地根因」。
- **状态**：**landed（fix轮，2026-10-02，未提交）**——后端 `AlertmanagerRouteSetting` 加 `Mode RouteMode`（`handwritten`/`managed`，AutoMigrate，存量零影响）、`GET /routes` 据存储返回、route-setting PUT 写 mode；前端 `useRouteSetting.ts` + `AlertConfigPage.tsx` 模式开关控件（managed↔handwritten，切手写不删内容 §11.6）。详见 #34/#35 落地记录。

## 37. 抑制规则无独立 UI（三块必写中唯一未 UI 化项，open）

- **类别**：① 空白判定（能力缺口）
- **PRD 章节 / 文件位置**：PRD §4.1.1（`inhibit_rules` = 平台生成 + 用户可追加）、§11.7；`ui-custom/web/src/pages/alerts/alertmanagerConstants.ts:341-347`（`ALERT_CONFIG_REQUIRED_BLOCKS` 第 3 项「收敛（告警抑制）」`path: null` = 无平台内替代入口）；`ui-custom/web/src/types/alertmanager.ts:180,186,200`（`NotifyStatus` 四态含 `inhibited`，仅通知状态非配置能力）；`MainLayout.tsx:208-224`（M08 菜单 7 项无抑制规则入口）；`platform/configcenter/generator/notify_route_preset.go:41`（`inhibitRulesSectionKey`，预置种子内置 1 条 inhibit 示例，仅 managed 模式注入）。
- **现状 / 根因**：全仓核对 `ui-custom/web/src/` 下 `inhibit` 仅命中**通知状态枚举**（`inhibited` 语义），**无任何抑制规则配置页/接口**。→「三块必写」中 `receivers`（→ 通知渠道页）、`route`（→ 路由规则页）均已 UI 化，**仅 `inhibit_rules` 仍只能手写文件**。而 `alert-config-scope-and-notification-bridge.md` §3.2.2 把「收敛」列为必写块、§3.2.4 预言三块 UI 化后挂载页退化——**该块是「三块 UI 化」唯一未兑现项**，也是「写配置前必读」折叠区**不能整体删除**的唯一理由（否则手写用户失去唯一仍需手写的说明）。
- **结论 / 建议**：本期**只标注不实现**——① 告警配置页动线卡中「抑制规则」项显式标「即将支持」，不静默消失（避免用户以为配完了）；②「写配置前必读」改为**按模式条件化**：managed 只讲「抑制规则由平台自动维护（预置示例已内置 1 条），自定义需在高级区编辑」，handwritten 才展开完整「三块必写 + 两块豁免」；③ 抑制规则 UI 化（表单：根因/次生匹配条件 + 目标接收人，含平台自动生成规则的可视化与覆盖）排 **v0.3-c**，与「continue 可视化」「免打扰时段」同批（见 `alert-route-frontend-editor.md` §5 分期）。**不得**因本项缺失而动 P7 段级所有权（`inhibit_rules` 仍为平台 + 用户可追加）。
- **影响模块**：M08（告警配置页动线卡/ 折叠区策略 / 新增抑制规则页）；M09（`alertmanager.yml` `inhibit_rules` 段生成维持现状不变）
- **发现场景**：2026-10-02 用户就告警配置页信息架构提出「信息杂乱无章、没有逻辑性」，核对提案 §3.2.4 预言的三块 UI 化进度时发现本项未兑现，为该轮唯一能力缺口。
- **状态**：**open**——2026-10-02 用户拍板：本期**只标注不实现**，v0.3-c 排期。UI 侧标注已随 #38 落地：动线卡内以 `Tag color="warning"`「即将支持」显式呈现（**不静默消失**，否则用户以为配完了）；高级区「手写配置说明」在 managed 模式下只讲本缺口、handwritten 模式才展开完整三块必写。能力本体（抑制规则 UI）仍待 v0.3-c。

## 38. 告警配置页信息架构重构 + 术语去技术化（landed 2026-10-02）

- **类别**：① 空白判定（页面 IA 与能力分层倒挂）
- **PRD 章节 / 文件位置**：`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx:398-417`（页头主按钮=「挂载新配置」`type="primary"`）、`:421-497`（「写配置前必读：三块必写 + 两块豁免」折叠栏）、`:538-646`（「当前生效配置」卡内嵌两个策略控件 `:553-585` + 完整 YAML 常驻展开 `:641`）、`:672-720`（派生预览）、`:722-744`（版本历史）；`alertmanagerConstants.ts:323-371`（必写/豁免块定义，字段名与用户语言并列）、`:430-450`（派生预览文案）；`MainLayout.tsx:219-223`（M08 菜单顺序）。
- **现状 / 根因**（三条，逐条有代码级依据）：
  1. **主操作与能力分层倒置**——三层模型里「挂载整份文件」是第三层（逃生舱），却是页头唯一主按钮；而第一层（预置种子，#33 已落地）在页面上完全不可见，用户打开只看到「请上传文件」。
  2. **策略控件被埋进版本元数据卡，且两个控件语义关系未显式化**——`AlertConfigPage.tsx:553-585` 把「默认兜底接收人」（Select）与「路由规则作者模式」（Switch）平铺为并列项，但模型上二者**非平级**：`notify_route_skeleton.go:79` 门禁只判 `in.Enabled && DefaultReceiver != ""`、**不判 mode**；`draft/service.go:319-321` 与 `EffectiveDefaultReceiver`（`alertmanager_route_setting.go:54-64`）同样不判 mode。⇒ **手写模式下平台仍会替换根 `route.receiver` 单键**（决策 113口径 C 的设计意图），UI 唯一提示仅 `:565` 一个「平台接管中」Tag。Switch 的「开/关」亦无法表达「两种模式二选一」。
  3. **术语全实现视角 + YAML 全文散落四处**——折叠栏骨架 / 完整配置 / 派生预览片段 / 插入示例，用户无法判断哪一处才是「现在生效的那份」。
- **结论 / 建议**：重构为四卡——① **策略卡**（提级为页面级，**不改 `MainLayout` 全局设置**：`route-setting` 是管理域单例、中心 AM 全局唯一，挂全局会误以为影响多实例/多网域）；「未匹配规则的告警发给谁」+「路由规则由 我手写 | 平台管理」Segmented，并以**一行状态句**显式化三者关系。② **动线卡**（通知渠道/路由规则/通知模板 + 抑制规则标「即将支持」=#37）。③ **现状卡**（瘦身，完整 YAML 默认折叠）。④ **高级区**（默认收起，含原「挂载新配置」+ 说明 + 派生预览 + 版本历史）。**页头不再挂 `type="primary"` 按钮**。「写配置前必读」**按模式条件化**（managed 讲抑制规则、handwritten 才展开完整三块必写，见 #37）。术语替换表见提案 §7.5。**明确不改**：C1 保存语义（admin-only，改它牵动 M09 变更单权限模型，属独立议题）。
- **影响模块**：M08（`AlertConfigPage.tsx` / `alertmanagerConstants.ts` / `AlertConfigPage.test.tsx`；`useRouteSetting.ts` 零改动——`NONE_RECEIVER_VALUE` 语义不变，仅页面侧换控件；`MainLayout.tsx` 零改动）；M09（零改动）
- **发现场景**：2026-10-02 用户就 `/alert-config` 页提出「是否可降级挂载新配置、优先引导 UI 控制」「三个子功能信息杂乱无章」「两个按钮为何不是全局按钮、是否提级」「UI 术语过于技术化」，四项一并登记；已与 #33（三层配置模型）合并落 `design-proposals/alert-config-three-layer-model.md`（§1.3 说明两议题的关联性）。
- **状态**：**landed（2026-10-02）**——用户当日拍板 6/6 全采纳（提案 §12），IA 先行落地，**零后端改动**：
  - 四卡结构（策略卡 / 动线卡 / 瘦身现状卡 / 高级区）已落地；**页头不再挂 `type="primary"` 按钮**，「导入整份配置文件」降级进默认收起的高级区（**永久保留**，PRD §11.6 逃生舱不删）。
  - 模式控件 Switch → **Segmented**（`我手写 | 平台管理`），表达二选一模式。
  - 术语去技术化按 §7.5 对照表全部替换；块名改用 Alertmanager 官方中文名。
  - 策略卡新增 `policySummary` **状态句**，显式化「手写模式下平台仍接管兜底接收人单键」这一非直觉事实（本条根因 2 的直接对策）。
  - 手写说明按模式条件化（managed 只讲抑制规则缺口 = #37 缺口显式化；handwritten 展开完整三块必写 + 两块豁免 + 最小骨架）。
  - 动线卡对抑制规则打 `即将支持` Tag，**不静默消失**。
  - 明确未改：C1 保存语义（admin-only，属独立议题）；`MainLayout` 全局设置（方案 B 已否决）。
  - 额外修两处实现缺陷：① 嵌套 `Collapse` 点击冒泡导致点开内层后高级区整体收起（修法：在内层 Collapse **之外**加 `stopPropagation` 包裹层，**不可**挂在内层 label 上）；② 「配置版本历史」被误放进「平台自动生成的接收人」折叠面板内，已提回为高级区直接子项。
  - 回归：`AlertConfigPage.test.tsx` **33/33 通过**（`vitest --maxWorkers=1`），`tsc --noEmit` 通过；文案断言逐条对齐而非删除，定位统一改用 `data-testid`（清单见提案 §12.2）。
  - 遗留：`api-contract-snapshot.md` 待补「手写模式仍接管根兜底单键」显式声明（提案 §11.1）。

## 39. 告警三页后续三点意见：版本历史提级 + 删配置重挂载 + 派生预览归位 + 说明区统一（landed 2026-10-02）

- **类别**：③ 技术优化 / 信息架构
- **PRD 章节 / 文件位置**：`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`（高级区 `:719-941` 内嵌「平台自动生成的接收人」与「配置版本历史」；版本表操作列 `:474-484` 的「重新挂载此版本」）；`NotifyChannelsPage.tsx:175-193`（说明塞在卡片正文里）；`RoutesPage.tsx:436-475`（`page-header` div + 常驻 info Alert）；`NotifyTemplatesPage.tsx:229-276`（问句式折叠标题 + 卡片）；`alertmanagerConstants.ts:330-378`（必写/豁免块 desc）、`:420-426`（手写说明引导句）、`:486-506`（派生预览文案）。
- **现状 / 根因**（用户原话三点 → 三条根因，逐条有代码级依据）：
  1. **「配置版本历史」被塞进「高级」折叠区，但它与「高级」无关**——内容侧留痕是**全局只读能力**（每个导入过的版本都应可见），而高级区是「手写逃生舱」（三层模型第③ 层，PRD §11.6）。放进折叠区等于把全局能力藏在高级用户专属入口里。
  2. **「重新挂载此版本」是过度设计，且与通知模板页同名能力语义冲突**——配置侧 remount 只是「把历史版本内容再提交一次」，与首屏「导入整份配置文件」走同一条调用链（`submit`），恢复路径完全可用「查看内容 → 改 → 导入」替代；为此却多维护一条专用端点 + 二次确认 Modal + 行级错误区。更糟的是它与 `NotifyTemplatesPage.tsx:191-198` 的「重新挂载」（**模板版本回滚**，语义不同、有独立价值）同名，两个页面同一个词两个意思。
  3. **「平台自动生成的接收人」放错页 + 与渠道页 `ReceiverSnippetDrawer` 同源能力两份**——它是**渠道的产物**（每个已启用渠道派生一个 receiver），只在渠道上下文里读得懂；放在告警配置页高级区既割裂，又与 `NotifyChannelsPage` 行内「接收人配置」抽屉展示同一个 `getReceiverSnippet` 结果。且其三段文案（`DESC` / `SCOPE` / 左蓝线三句）说的都是同一件事。
  4. **四页说明区四种形态、同一事实多处表述**——告警配置把说明塞进页头卡 / 路由规则用常驻 info Alert（且标题是「对应 Alertmanager 的 route: 本体」这类技术表述）/ 通知渠道塞在卡片正文 / 通知模板用「「通知模板」是什么？」（问句式标题）。同一事实常有 2~3 处表述：如「已启用渠道的接收人由平台自动写入」在手写说明引导句、必写块 desc、骨架注释、抽屉说明里各出现一次。
- **结论 / 建议**（用户通过 AskUserQuestion 拍板，三项全采纳推荐项）：
  1. 「配置版本历史」移出高级区 → 页面级常驻卡，位置在现状卡之后、高级区之前；同步删除「重新挂载此版本」操作列（保留版本详情抽屉）。
  2. 「平台自动生成的接收人」迁出告警配置页 → 「通知渠道」页表格新增「平台接收人」列：列内只给结论（接收人名 + 模板绑定 + 可用性），片段 YAML 与复制仍由该页行内「接收人配置」抽屉承载（**单一来源**）。告警配置页只留手写说明里的通往链接。
  3. 新增共享组件 `src/components/PageIntro.tsx`，四页统一为「**页头（标题 + 一行副标 + 右侧操作位）+ 可折叠说明区（默认收起，标题「这个页面管什么」）+ 主内容**」。
  4. 手写说明按「**每个事实只在一处说**」去重：策略卡 / `policySummary` 已说过的不复述；「已启用渠道由平台自动写入」只在手写说明引导句说一次。
- **影响模块**：M08 前端（`AlertConfigPage.tsx` / `NotifyChannelsPage.tsx` / `RoutesPage.tsx` / `NotifyTemplatesPage.tsx` / `AlertConfigDrawer.tsx` / `useAlertConfig.ts` / `alertmanagerConstants.ts` / 四个测试文件 / 新增 `components/PageIntro.tsx`）；**后端零改动**
- **发现场景**：2026-10-02 用户在 #38 落地后继续走查 `/alert-config`、`/notify-channels`、`/routes`、`/notify-templates` 四页，就「版本历史位置」「重新挂载去留」「平台自动生成的接收人放在高级区很奇怪」「三页说明如何让用户更好理解、排版统一」提出意见。
- **状态**：**landed（2026-10-02）**：
  - 版本历史提级为常驻卡（`data-testid="alert-versions-card"`，测试用 DOM 顺序断言「现状卡 → 版本历史卡 → 高级区」）；「重新挂载此版本」连同 `handleRemount` / `remounting` / `remountErrors` / remount 行级错误区一并删除。
  - `useAlertConfig` 移除 `remount` 暴露（无调用方）；`api/alertmanager.ts` 的 `alertmanagerConfigApi.remount` 保留为**契约镜像**并标 `@deprecated`（后端端点仍在，未删），注释显式区分 `notifyTemplatesApi.remount`（模板回滚，**仍在用**）。
  - `AlertConfigDrawer` 的 `mountName.startsWith('remount-')` 死分支与 `mountName` prop 一并删除（唯一调用方 `openMount()` 不传参，该分支永不可达）。
  - 派生预览迁入通知渠道页「平台接收人」列：`ALERT_DERIVED_PREVIEW_*` 常量改写为 `CHANNEL_DERIVED_RECEIVER_*`（标题去技术化：「平台自动生成的接收人」→「平台接收人」）；403 降级为单元格内「需管理员权限查看」+ Tooltip，停用渠道显示「停用后不再生成」，令牌未配置标「暂不可用」。
  - 新增 `components/PageIntro.tsx` 并落地四页；`testId` 约定 `<page>-intro` / `-intro-subtitle` / `-intro-guide-label` / `-intro-guide-points`。
  - 手写说明去重：`ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO` 改为「已启用渠道的接收人由平台自动写入，通常不用手写。整份配置里，你只需关注这三块：」；`ALERT_ADVANCED_GUIDE_MANAGED` 去掉与策略卡重复的「路由规则由平台管理」与自指的「才使用下方的手写说明」；接收人 / 抑制两块 desc 精简。
  - 术语去技术化：`ROUTE_ROOT_LOCK_TIP` 去掉「route: 本体」。
  - 回归：`AlertConfigPage` 32 + `NotifyChannelsPage` 22 + `RoutesPage` 25 + `NotifyTemplatesPage` 10 全绿；`tsc --noEmit` 通过；eslint 仅剩 1 个**既有** warning（RoutesPage `knownReceiverSet` 依赖，非本轮改动）。
- **遗留（2026-10-02 用户已拍板，非待决）**：
  1. `POST /config/versions/{id}/remount` 后端端点**保留、不下线**，待 **v0.3** 再决定。契约 §3 已标注「已无前端调用方」并显式区分 §11.1 的模板 remount（语义不同、仍在用）。
  2. 四页各保留一处**随状态变化的**常驻 `Alert`（如路由规则页的「顺序即优先级 + 模式徽标」），按 `PageIntro` 契约第三条硬约束**有意不并入**说明区（只有随状态变化的信息才允许常驻）。

## 40. 路由规则页实测阻断三连：「新建按钮恒灰」+「手写 receiver 误判悬空」+「我手写」歧义（landed 2026-10-08）

- **类别**：② 实现缺陷（阻断级，两条）+ ① 空白判定 / UX 信息缺口（一条）
- **PRD 章节 / 文件位置**：`ui-custom/web/src/pages/alerts/RoutesPage.tsx`（操作区 `:558-590`、说明区 `:440-479`、只读/可编辑分支 `description`）；`useRoutes.ts`（`useRouteEditor` 首屏导入门控、`knownReceivers` 派生、编辑态初始化）；`routeTree.ts:240-258`（`validateRouteReceivers` 悬空判据）；`AlertConfigPage.tsx:277-294`（`policySummary`）、`:254-287`（模式切换二次确认）、策略卡模式控件区；`alertmanagerConstants.ts:398-424`（模式选项文案）；`platform/alertmanager/route/handler.go`（`ListRoutes` / `deadReceivers`）、新增 `platform/alertmanager/route/declared_receivers.go`。
- **现状 / 根因**（2026-10-08 用户实测三点 → 三条独立根因，均有代码级依据）：

  1. **「新建路由规则」按钮首屏恒灰**——`RoutesPage.tsx:562` 与「保存并提交变更」均为 `disabled={!editing}`，而 `editing = editor.importState !== 'empty'`（`useRoutes.ts:159`）。`importState` 此前恒从 `'empty'` 起步 ⇒ 两个主按钮**首屏必然灰**。用户必须先点「从当前配置导入」才进入编辑态，而该按钮在首屏语境下更像「可选的导入动作」而非「开始编辑的前置步骤」。⚠ 附带的同源缺陷：该按钮会**静默丢弃**用户已有编辑（无二次确认），构成第二条数据丢失路径。
  2. **导入后报 5 项「接收人 feishu 未定义」，页面进入死锁**——`useRouteEditor` 的 `knownReceivers` 此前**只取平台物化名**（已启用渠道 `ReceiverName()` 集合）。实测本机生效配置（`config_drafts` id=103）的 `receivers:` 段同时声明了**手写** `feishu`（指向用户自建通知脚本 `metricam.chenrt.dpdns.org:8080`）与平台物化 `notify-1`（渠道名「腾讯云边缘域-飞书」全中文 → `SanitizeReceiverName` 归一为空 → 回落 `notify-<id>`）；而根路由 + 4 条子路由**全部引用 `feishu`** → 5 个节点全命中 `routeTree.ts:240-258` 的 `receiver_dangling`（error 级）⇒ 保存被预检阻断；新建按钮又依赖编辑态 ⇒ **既不能新建也不能保存**，页面完全不可用。**根因是口径漂移**：生成侧 `generator/notify_route_skeleton.go::RootRouteInput` 早已定义「可达 receiver 集合 = 文件 `receivers` ∪ `PlatformReceiverNames`」，前端是这套口径的**唯一例外**。
  3. **「我手写」模式选项造成歧义**——旧措辞「我手写 / 平台管理」中，「我手写」天然承诺"由我在页面里手写"，而实际含义是"平台别生成 route 段、我自己去告警配置页高级区手写 YAML"，该层含义**只写在二次确认弹窗里**。用户选「我手写」后发现路由规则页变只读，判为功能故障。另：策略卡 `policySummary` 一行塞了三段话（可达 60+ 字），用户反馈"信息量过大、非常费力"。
- **结论 / 建议**（用户同意按 P0 → P1 顺序修复，方案 A「改名 + 明说页面可编辑性」拍板）：
  1. **P0 首屏自动导入**——只读树加载完成（`useRoutes().ready = !loading`，失败也算终态否则网络错误时永不进编辑态）且**解析成功** → `useRouteEditor` 自动导入。`autoImportedRef` 幂等锁保证只触发一次、不冲掉用户正在进行的编辑；**解析失败刻意不自动导入**（降级事实须让用户知晓，静默塞空白树会让降级不可见）。按钮文案随之按态切换：未进入编辑态 = 「从当前配置导入」+ 下方说明如何进入；已导入 = 「重新载入」+ `confirmReload` 二次确认（丢弃未保存编辑属破坏性操作）。
  2. **P0 统一可达集合口径**——后端 `GET /routes` 新增 `declared_receivers`（从生效 YAML `receivers:` 段解析，**含手写**；实现 `ParseDeclaredReceivers`，吞错降级为空、绝不返回 error、不牵连主响应；非敏感故维持「仅全局认证」鉴权级别）。前端 `knownReceivers = declared_receivers ∪ 平台物化名`（平台物化名**必须**并入：渠道已启用但配置尚未重新生成时名字还没落盘）。⚠ **`dead_receivers` 口径故意不同、勿合并**：它是平台命名空间**子集**（平台物化却无人指向），**不含**手写 receiver——用户手写 receiver 的存废归用户，平台无权判其为死配置（#26 边界）。两者皆空时前端**不判悬空**（不阻断）。
  3. **P1 模式改名 + 策略卡瘦身**——选项「我手写 / 平台管理」→「**我来编辑 / 平台生成**」（底层枚举 `handwritten` / `managed` **不变**，仅用户可见词变）。措辞锚定"**谁来产出**"这一可见结果，与页面可编辑性一一对应，控件含义由新增的 `ALERT_POLICY_MODE_TIP` 常驻提示行承载（按 PageIntro 契约第三条：随状态变化的信息才允许常驻，不收进默认收起说明区）。二次确认弹窗改为**明说页面可编辑性**（"路由规则页变为只读视图" / "你在路由规则页直接增删改"），不再只讲产物归属。`policySummary` 压缩：只给结论、**不复述控件字面含义**（遵循「每个事实只在一处说」）。
- **影响模块**：M08（`GET /routes` 响应契约 / 路由页 / 告警配置页 / 模式文案）
- **回填清单**：
  - `platform/alertmanager/route/handler.go`：`ListRoutes` 增 `declared_receivers`（成功与降级两个分支都带）；`deadReceivers` 补口径分工注释。**前端实测名**：`RoutesPage.tsx:161-196`。
  - `platform/alertmanager/route/declared_receivers.go`（新增）+ `declared_receivers_test.go`（新增，9 子用例：手写与平台物化共存 / 去重 / 缺 name / 元素非映射 / 无 receivers 段 / receivers 非列表 / YAML 非法 / 顶层非映射 / 空输入）。
  - `ui-custom/web/src/types/alertmanager.ts`：`RouteTreeData` 增 `declared_receivers?: string[]` + 两字段口径分工注释。**前端实测名**：`types/alertmanager.ts:446-470`。
  - `ui-custom/web/src/pages/alerts/useRoutes.ts`：`useRoutes` 增 `ready`；`UseRouteEditorOptions` 增 `ready` / `declaredReceivers` / `confirmReload`；`doImport` 抽出 + `autoImportedRef` 自动导入门控；`importFromCurrent` 加二次确认；`reset` 复位幂等锁；`knownReceivers` 改并集。**前端实测名**：`useRoutes.ts:146-175`（options）、`:222-296`（取数与并集）、`:298-370`（导入门控）、`:94-140`（`ready`）。
  - `ui-custom/web/src/pages/alerts/RoutesPage.tsx`：`confirmReload` 二次确认；接 `ready` / `declaredReceivers`；按钮文案按态切换 + 底部说明按态切换；模式徽标与说明区文案对齐新词；文件头注记两处修订。**前端实测名**：`RoutesPage.tsx:135-197`。
  - `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`：模式选项改名 + 新增 `ALERT_POLICY_MODE_TIP`。
  - `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`：`policySummary` 压缩；模式控件下新增 `policy-mode-tip` 行；二次确认文案改为明说可编辑性（且**不得**出现「route 段」等实现术语——见下方测试护栏）。
  - 契约：`api-contract-snapshot.md` §11.9 补 `declared_receivers` 字段定义、`declared` vs `dead` 口径对照表、mode 用户可见词 ≠ 枚举值说明、首屏自动导入护栏。
- **测试护栏**（新增 6 + 5 + 2 例）：
  - `useRoutes.test.ts`「接收人可达集合口径」3 例：手写 `feishu` 不再判悬空且**能真正保存**（submit 被调用）/ 真正悬空（`ghost`）**仍**阻断（校验不被放宽成摆设）/ 平台已启用但未落盘也算可达。
  - `useRoutes.test.ts`「首屏自动导入」5 例：`ready=true` 自动进 `imported` / `ready=false` 不导入 / **解析失败不自动导入** / **只触发一次**（`sourceItems` 后续变化不冲掉用户编辑）/ 重新载有二确认（取消保留、确认丢弃）。
  - `RoutesPage.test.tsx`「接线」4 例：`ready` 与 `declaredReceivers` 透传、`ready=false` 不触发、解析失败传 `parseError`；另修正「未导入时按钮禁用」用例的语义（首屏自动导入后，未导入只在解析失败降级时出现）。
  - `AlertConfigPage.test.tsx` 模式改名相关断言全量同步（`modeSegment` 标签字面量、`policy-summary` 断言、弹窗标题断言）；新增 2 例：`policy-mode-tip` 随 mode 切换措辞、二次确认明说可编辑性。
  - ⚠ **术语护栏首次实战生效**：`AlertConfigPage.test.tsx` 既有用例断言弹窗 `content` **不得含「route 段」**，在我首版弹窗文案里写了「你手写整份 YAML」+「route 段」被该护栏拦下 → 说明这层护栏在文案迭代中**确实有效**，已改为「手写整份配置」。**后续改此文案须保留该断言。**
- **⚠ 未解决 / 后续**：
  - **「产物归属」与「页面可编辑性」仍是同一根轴**（`isRouteEditable(mode)`）。本次仅把话说清楚（改名 + 明说后果），**未解开耦合**——真解开需回到提案 §4.3「route 段单一作者」裁决，属 v0.3 议题。
  - `alertSmoke.test.tsx` 存量 4 条陈旧断言（「挂载新配置」「默认兜底接收人」「派生预览：平台将写入的接收人」自 #38 起已陈旧）**本轮未修**，与本次改动无关但会持续污染全量回归判读。
  - 「三块必写」中的 `inhibit_rules` 仍无 UI（#37，v0.3-c）。
- **状态**：**landed（2026-10-08，未提交）**——`go vet ./platform/alertmanager/...` exit 0；`go test ./platform/configcenter/... ./platform/models/... ./platform/alertmanager/...` 11 包全部 ok；`go build ./platform/...` 通过；`tsc --noEmit` exit 0；`vitest run src/pages/alerts`（`--maxWorkers=2 --minWorkers=1`，325s）**15 文件 236 例全过**（改动前为 221 例，本次净增 15 例；仅 antd `act(...)` 警告，非失败）。
## 41. 桥令牌无默认值导致通知全链路哑火 + 策略卡「界面不清晰」瘦身（landed 2026-10-08）

- **类别**：① 空白判定 / 契约缺口（阻断级，用户环境实测）+ ③ 信息架构瘦身
- **PRD 章节 / 文件位置**：`Makefile:31-46`（新增三个 `?=` 默认值）、`platform/cmd/metric-center/main.go:62,104`（`NOTIFY_BRIDGE_TOKEN` 读取）；`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`（策略卡结构、`policySummary`、新增 `fallbackConclusion`）、`alertmanagerConstants.ts:537-548`（令牌缺失提示）、`RoutesPage.tsx`（接收人卡文案）。
- **现状 / 根因**（用户 2026-10-08 第二轮反馈三个现象 → 三个独立根因）：

  1. **通知渠道页对已启用渠道一律标「暂不可用」**——`NOTIFY_BRIDGE_TOKEN` 在 `Makefile` 里**只有引用、没有默认值**，`make` 展开即空串 → `main.go:104` 的 `os.Getenv` 覆盖不生效 → `TokenConfigured = (BridgeToken != "")` 为 false（`notify/receiver_snippet.go:97`）→ 桥端点「一律 401」（`notify/bridge.go:38-39,63-64`）。**现象被分散在两个页面且互相看不出来由**：路由页报「孤立接收人」、渠道页报「暂不可用」，而两者其实是**两根正交的轴**（路由指向轴 vs 可用性轴）。同理 `NOTIFY_BRIDGE_URL` 空还会让平台**完全不物化** notify receivers（`generator/notify_receivers.go` 判 `BridgeURL == ""` 跳过）。
  2. **「有接收人没有路由指向它」文案主语错位**——旧文案「孤立接收人（平台已生成但没有任何路由指向）」主语是「平台」，用户实测读成「平台内置了路由规则却没指向它」。实际是**用户的路由全指向了别的接收人**（本例为手写 `feishu`），平台那条通道空着。旧文案还只说「去通知渠道页处理」，而那只是两种消解方式之一（想用这个接收人得新建/编辑路由）。
  3. **策略卡「界面不清晰」**（用户原话）——表面是信息量，实为**一处自相矛盾 + 三处冗余**：
     - **矛盾（最严重）**：`auto_first_enabled` 按契约 §11.9 语义是「**仅作 UI 预填建议、平台不接管、产物字节不变**」，但旧 `policySummary` 一律渲染成「发往 X」。实测卡内：下拉框显示「不接管」、状态句说「发往 notify-1」→ 用户当场判为界面不可信。**属文案与契约不符，非设计如此**。
     - **冗余**：「未匹配规则的告警发给谁」这一个事实被说了 **4 遍**（顶部状态句 / 控件下状态行 / 底部蓝线 80+ 字长段 / 控件本身），卡高 305px。
- **结论 / 建议**（用户拍板：两条一起做 + Makefile 加默认值 + 改 info 那条路由）：
  1. **Makefile 补默认值**（用 `?=`，环境变量与 `make VAR=x` 均可覆盖）：`NOTIFY_BRIDGE_URL=http://127.0.0.1:8080`、`NOTIFY_BRIDGE_TOKEN=local-dev-bridge-token`、`NOTIFY_RENDER_TIMEZONE=Asia/Shanghai`。生产必须显式注入强随机令牌，默认值仅供本地开发。**实测**：重启后 `token_configured=true`；桥自检 `POST /api/v1/webhooks/notify?channel=1` 正确令牌 200 且飞书实发 1 条（`success=1`，自动挂 template=1），错误令牌 401。
  2. **接收人卡文案改写**：标题「有接收人没有路由指向它」；正文讲清「平台为渠道生成了接收人，但路由一条都没指向它 → **该渠道收不到告警**」，并显式补一句「若你看到路由都指向另一个手写的接收人，那说明告警正走你自己的通道」；**补两种消解方式**（① 想用它 → 新建/编辑路由把接收人选成它；② 暂不用 → 去渠道页停用/删除）。渠道页令牌缺失提示改为**只讲可用性轴、不提路由**（两轴解耦）。
  3. **策略卡瘦身到两行**（每行 = 控件 + 一句结论）：
     - 顶部状态句 → **视觉隐藏**（screen-reader only，仍留卡内 DOM）：它是两个开关的「关系」而非「当前状态」，常驻会与控件各自结论争抢注意力；读屏与测试仍可拿到（`policy-summary` testId 保留）。
     - 控件下状态行 → **并入控件行右侧** `fallback-conclusion` Tag（控件值与结论并排可对照）。
     - 底部蓝线诚实口径长段 → **移入 `PageIntro.points`**（默认收起）。
     - `policySummary` 按三态分别给结论并**严格区分「已生效」与「建议值」**：`none`→不接管 / `auto_first_enabled`→**「未指定…未接管，X 只是建议值，选定后才会生效」**（不再说「发往」）/ `explicit+enabled`→才说「发往 X」。新增 `fallbackConclusion`（`on`/`off`/`none` 三态 Tag）。
- **影响模块**：M08（Makefile 启动配置 / 路由页 / 告警配置页 / 通知渠道页）；数据侧改了本机 `config_drafts` id=103
- **回填清单**：
  - `Makefile:31-46`：三个 `?=` 默认值 + 长注释（说明为何需要默认值、为何 `?=`、生产须覆盖）。
  - `alertmanagerConstants.ts:537-548`：`CHANNEL_DERIVED_RECEIVER_TOKEN_MISSING` 重写（讲可用性轴、不提路由、注明与「孤立接收人」正交）。
  - `RoutesPage.tsx`：接收人卡标题/正文重写 + 消解方式两条（含 `dead-receiver-channels-link` testId 替代原 `dead-receiver-<name>`）。
  - `AlertConfigPage.tsx`：策略卡结构重写（`Space` → `div` 包裹使结论 Tag 与控件同行）；新增 `fallbackConclusion`；`policySummary` 三态口径 + 视觉隐藏 span；`PageIntro.points` 增至 5 条（收进诚实口径 + 「两个开关独立」提示）。
  - 数据：本机 `config_drafts` id=103 的 `severity="info"` 子路由 `receiver: 'feishu'` → `notify-1`（**经平台正规端点 `POST /api/v2/platform/alertmanager/config` 提交，生成 version 10，未直接改库**；`amtool check-config` SUCCESS 2 receivers 引用闭合）。改前已备份 `/tmp/m08-backup/{metric_center.db.bak,draft103.yml,draft103.new.yml}`。
- **测试护栏**（新增 3 例 + 改 4 例）：
  - 新增「未接管时不得把建议值渲染成生效值（不得出现『发往』）」——锁死 §11.9 契约不符不会复发；
  - 新增「已接管（explicit + enabled）时才可说『发往』」；
  - 新增「策略卡瘦身：不再有独立状态行与蓝线长段常驻」；
  - 改 4 例旧断言（`平台接管中` Tag → `fallback-conclusion`；`已启用渠道的第一个` → `建议值`；`当前为…（来源：…）` 状态行已并入；`孤立接收人（…）` 标题已改写）。
  - ⚠️ **jsdom 陷阱（新踩）**：判「元素是否视觉隐藏」**不可用 `getBoundingClientRect()`**——jsdom 下所有元素 rect 恒 0×0，会把每个叶子节点都判成隐藏（`visibleText` 变空串）。改用 inline style 判定（`position:absolute` + `overflow:hidden` + 1px），已封装为测试辅助 `isVisuallyHidden`。**凡引入 screen-reader only 元素，"卡内不含 X"类断言必须走这个辅助**（隐藏元素仍在 `card.textContent` 里）。
- **⚠ 未解决 / 后续**：
  - **配置改动尚未真正下发**：`POST /config` 生成 version 10，但 `source_change_no` 为空 → 需到「配置变更确认」页确认变更单后，才会写盘 `config-output/alertmanager.yml` 并 reload AM。**在此之前 AM 仍加载旧文件**（info 仍走手写 `feishu`）。
  - **生产令牌强度**：`local-dev-bridge-token` 仅本地开发用；生产部署必须显式注入强随机值（`package-center.sh` / 部署文档已走环境变量路径）。
  - **「产物归属」与「页面可编辑性」仍耦合在 `isRouteEditable(mode)` 一根轴**（见 #40），本轮仍未解开。
- **状态**：**landed（2026-10-08，未提交）**——`make -n run-metric-center` 验证默认值与环境变量覆盖均正确；`tsc --noEmit` exit 0；`AlertConfigPage.test.tsx` + `RoutesPage.test.tsx` **66 例全过**；策略卡截图复核：卡内 4 段文字 → **2 行**，自相矛盾消除。
## 42. 兜底控件「用户不知道这就是兜底策略」+ 渠道命名误导（landed 2026-10-08）

- **类别**：③ 信息架构 / 用户认知断层（用户实测截图指认）+ ① 数据命名误导
- **PRD 章节 / 文件位置**：`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`（`fallbackConclusion`、`handleDefaultReceiverChange` 确认弹窗）、`useRouteSetting.ts`（`RouteSettingOption`、选项构造、`ROUTE_SETTING_NONE_LABEL`）、`alertmanagerConstants.ts:396-399`（控件 label）；数据侧 `notify_channels` id=1 的 `name`。
- **现状 / 根因**（用户 2026-10-08 第三轮反馈，附截图红框两处：「用户角度，如何知道腾讯云边缘域就是平台兜底的策略」）：

  1. **认知断层（UI 侧，主因）**——控件行是两个**并列且无连接**的独立元素：左边下拉框显示渠道名、右边结论 Tag 显示内部接收人名，界面上**没有任何一处明说「二者是同一个」**，用户被迫做一道连线题。更糟的是结论里复述了内部标识（`notify-1`），既无信息量又像技术串。**上一轮只修了「自相矛盾」，没修「两个元素对不上」。**
  2. **命名误导（数据侧，用户截图里点名的「腾讯云边缘域」）**——查库确认：`notify_channels` 仅 1 条，名为「腾讯云边缘域-飞书」，`webhook_url` 是 `open.feishu.cn/.../bot/v2/hook/...`，即**一张飞书机器人卡片**；`network_domains` 表里的「腾讯云调试边缘域」与它**无任何关联**（渠道表无网域字段，`ReceiverName()` 只看渠道名本身）。⇒ 「边缘域」三字纯属起名误导，看着像一个网域、而非一张飞书卡片，用户自然困惑它跟「全局兜底」有什么关系。**答案：没关系。**
- **结论 / 建议**（用户拍板渠道名 = `运维告警飞书群`，「继续」）：
  1. **数据侧改名**（经平台正规端点 `PUT /api/v2/platform/alertmanager/notify-channels/1`，未直接改库）。**改名安全性已验证**：`SanitizeReceiverName("运维告警飞书群")` = `""`（纯中文归一为空）→ 回落 `notify-<id>` = **`notify-1` 不变** ⇒ 配置零影响、无需重新下发。实测 `receiver_name` 改名后仍为 `notify-1`，`declared`/`dead` 与 5 条路由引用全部无变化。
  2. **UI 侧消除连线题**（三处协同，缺一不可）：
     - 结论 Tag **只说状态、用「你选中的渠道」回指控件**，不复述渠道名 / 接收人名；
     - 下拉框选项**只展示渠道名**，去掉「（接收人 X）」后缀 → 并**顺带摘除逐渠道调 admin-only `getReceiverSnippet` 的 N+1**（该请求失去唯一消费方）；
     - 控件 label 补「渠道」二字：「未匹配规则的告警发给谁」→「**没匹配到具体规则的告警，发给哪个渠道**」（控件词与选项内容用同一名词）。
  3. **顺带去术语**：`ROUTE_SETTING_NONE_LABEL` 「不接管（保留**我手写**的**兜底**配置）」→「不接管（保留配置文件里已有的值）」。前者同时踩了两个已记录的坑：**「我手写」是模式选项歧义的同源词**（承诺"我来写"却不说在哪写）、**「兜底」是实现视角术语**（提案 §7.5 要求用户视图不用）。
- **影响模块**：M08（告警配置页 / 兜底设定 Hook / 通知渠道数据）
- **回填清单**：
  - 数据：`notify_channels` id=1 `name`: `腾讯云边缘域-飞书` → `运维告警飞书群`（receiver_name 不变）。
  - `AlertConfigPage.tsx`：`fallbackConclusion` 改为「已接管：这类告警发往你选中的渠道」/「未接管（已启用渠道里的第一个是建议值，选定后生效）」；`handleDefaultReceiverChange` 确认弹窗标题「确认由平台指定未匹配规则的告警接收人」→「确认由平台接管这类告警？」且**展示渠道名**（原取 `option.receiverName`，字段已摘除）；`PageIntro.points` 去「兜底」措辞。
  - `useRouteSetting.ts`：`RouteSettingOption` **删除 `receiverName` 字段**；选项改 `map` 一行构造（**摘除 N+1 的 `getReceiverSnippet` 循环**）；`ROUTE_SETTING_NONE_LABEL` 去「我手写 / 兜底」。
  - `alertmanagerConstants.ts`：`ALERT_POLICY_FALLBACK_LABEL` 补「渠道」。
  - 测试：label 改名波及 14 处定位（`AlertConfigPage.test.tsx` 11 + `alertSmoke.test.tsx` 3）+ 首项文案 6 处，机械替换同步；`useRouteSetting.test.ts` 2 条 options 断言重写（字段已不存在）。
- **测试护栏**（新增 1 例 + 改 3 例）：
  - 新增「结论 Tag 只说状态、不复述渠道名」——锁死 `conclusion` 含「你选中的渠道」且**不含** `notify-1`。若将来有人"为更明确"把名称加回，本例失败。
  - 改 `useRouteSetting.test.ts`「选项只展示渠道名」并加 `expect(snippetMock).not.toHaveBeenCalled()`（N+1 摘除的旁证）。
  - ⚠️ **403 降级用例语义已变**：原「片段接口 403 → 降级为渠道名」失去被测对象（片段接口已不调用），改为「渠道列表 403 → 整体错误态」。改写时**发现既有行为与我的初版假设不符**：`list` 与 `get` 在同一 `Promise.all` 里，list 失败 → 整体 reject → **`setting` 被清空**（"设定已取到却因列表失败被丢弃"）。**本轮如实断言现状、未改行为**，记为独立可改进点。
- **⚠ 未解决 / 后续**：
  - **「设定已取到却因渠道列表失败而被整体丢弃」**：`useRouteSetting` 的 `Promise.all` 无独立降级。建议 `allSettled` 化（列表失败仅让选项退化为「不接管」，设定照常可读）——本轮未做，属独立议题。
  - **渠道改名只在数据层，代码无感知**：若将来有别处硬编码「腾讯云边缘域」需一并核对（全仓 grep 无残留）。
  - **`alertSmoke.test.tsx` 存量 4 条陈旧断言**（自 #38 起）仍未修。
- **状态**：**landed（2026-10-08，未提交）**——`tsc --noEmit` exit 0；`vitest run src/pages/alerts` **15 文件 240 例全过**（上一轮 239，净增 1）；真浏览器走查（真后端 + Vite + puppeteer）确认：结论 = 「已接管：这类告警发往你选中的渠道」、下拉选项 = `['不接管（保留配置文件里已有的值）', '运维告警飞书群']`（**无内部标识**）、选中项 = `运维告警飞书群`，三者一致。

## 43. 路由规则提交后M09「配置变更确认」查不到该单：#25 自动闭环把pending 单自动确认掉了（② 实现偏差 / 跨模块职责倒置，2026-10-09 用户裁决立场 1 关闭自动闭环）

- **类别**：② 实现偏差（跨模块状态/动作断点；且M09 人工闸门被绕过）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.1（文件挂载契约）/ §9.2；dev-feedback #25（本次为其「自动闭环」子项的回退）；源码见下逐项
- **发现场景**：用户在「路由规则」页调整子路由上下顺序并保存，前端提示「**已提交，待变更单确认下发**……进入变更单人工确认后下发生效（不即时生效）」，但前往 M09「配置变更确认」页**找不到这条记录**（2026-10-09）。
- **现状 / 根因**（DB 实证，非推测）：
  - 该次提交**确实生成了变更单** `CHG-20261009-006`（`network_domain_id=default`，09:43:22），但 `status=confirmed`——**不是 `pending`**。M09 列表默认按 `status=pending` 过滤，故查不到。
  - 全表状态分布：`confirmed` 69 / `discarded` 43 / `pending`仅 1 条（且那条属 `mc-edge-debug` 域的采集 Job 变更，与告警路由无关）。
  - 该版本 `applied_at=2026-10-09 09:43:22` 已回填、磁盘 `config-output/alertmanager.yml` 同期被改写 → **配置其实已自动写盘 + reload 生效了**，无需人工确认。
  - 根因：`#25 方案 A` 在 `submitValidated`（`platform/alertmanager/config/service.go`）末尾调`autoApplyManagementDomain`，该工序 `GenerateDraft` 后**直接 `ConfirmDraft`**，把刚生成的 pending 单瞬间确认掉。于是：前端文案要用户去 M09 确认 → M09 却已被系统自己确认 → 用户误判「功能故障/记录丢失」。
  -附带发现：M09 变更检测（`change.ProcessDomain`）其实**不会**为alertmanager 变更生成草稿——`generator.SourceDataVersion` 的 `sourceTableScopes` 聚合表**不含 `AlertmanagerConfigVersion`**，提交新配置不推进源数据版本，该步直接跳过。真正生成并确认草稿的是 `autoApplyManagementDomain` 直连路径。
- **结论 / 推荐修复（立场 1：保留人工闸门，用户 2026-10-09 拍板）**：告警路由结构调整与默认兜底接收人变更**均属高危**（改错即「该响的不响」或「未匹配规则的告警发错地方」，系统自身也把alertmanager_config 变更标`risk: high`），不应未经用户复核即自动上线；且M09「配置变更确认」的存在意义正是拦住这类改动。**关闭自动确认**，提交只负责「收录为 M09 源 + 产 pending 草稿」，生效一律由用户在 M09 人工 `ConfirmDraft`。
  - 附带一致性：`route/setting_handler.go`（默认兜底接收人PUT）原也调同一 `AutoApplyManagementDomain`，一并移除——否则留下「路由要确认、兜底接收人却自动生效」的新不一致。
  - 保留项：`triggerChangeDetection` 仍触发（产出 pending 草稿）；同域 pending 保活/取代口径（决策 42-1 / 44-2）不变；`errAutoApply` 哨兵与 handler 降级分支保留作防御（当前不可达）。
- **影响模块**：M08（配置提交/兜底设定写路径）、M09（`alertmanager.yml` 变更单由人工确认下发）、前端路由页/告警配置页文案。
- **回填清单**：
  - 后端：`platform/alertmanager/config/service.go`（`submitValidated` 移除 `autoApplyManagementDomain` 调用；删除随之失去引用的 `autoApplyManagementDomain` seam / `applyManagementDomainConfig` / `AutoApplyManagementDomain` 导出包装，并清理 `draft`/`generator` 两个不再使用的 import）；`platform/alertmanager/route/setting_handler.go`（`PutRouteSettingHandler` 移除自动确认、清理 `auth` import 与 `autoApplyManagementDomain` seam，seam 仅留 `triggerChangeDetection`）。
  - 前端：`RoutesPage.tsx`（保存结果 message 改「已提交，等待你在「配置变更确认」中确认下发」+ description 内嵌 `<Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>`；编辑态辅助文案改「需在「配置变更确认」中人工确认后才会写入并 reload」）；`useRoutes.ts`（`saveResult.message` 同步修订，去「不即时生效」歧义表述、明确「不会自动生效—���请前往 M09 人工确认」）。
  - 测试：`platform/alertmanager/config/autoapply_test.go` **整份删除**（6 例全测已移除的自动确认，保留会永远断言「已自动确认」）；`config_test.go` `stubChangeTrigger` 去掉对已删 seam 的短路；`platform/alertmanager/route/setting_handler_test.go`（`pipelineRecorder` 去掉 `autoApplyCalls`/`autoApplyBy` 字段与 seam 替换；4 处断言改为 `triggerCalls`）。
  - 契约：`api-contract-snapshot.md` §5.1 三处（端点表 `source_change_no` 补「pending 待人工确认」/ 原「M08 apply = 收录 + 自动下发管理域」段改写为「收录 + 产 pending 变更单」并附修订原因 / §11.6 route-setting 的「与挂载同构 autoApply」改为「不再自动确认下发」）；本条目 #25 状态行标注「自动闭环子项作废、状态去误导子项保留」。
- **测试护栏**：
  - `RoutesPage.test.tsx`「保存结果」用例重写并**新增 M09 跳转入口断言**（`within(result).getByRole('link', { name: '前往「配置变更确认」' })` + `toHaveAttribute('href', '/config-preview')`）——锁死「成功提示必须给出可点的 M09 入口」，否则将来易再次出现「提示要去确认却无路可走」。
  - `setting_handler_test.go` 断言「写入成功 → `triggerCalls=1`」，且**不再**断言自动确认发生。
- **⚠ 未解决 / 后续**：
  - **旧文案残留**：`AlertConfigDrawer.tsx:197` 仍写「提交后……在「配置变更确认」中人工确认后才正式生效」——该文案本就与「自动闭环」时期一致，关闭自动闭环后**恰好变为正确**，无需改动；但 `AlertConfigPage` 的「已提交，待确认下发」等派生口径依赖 `applied_at`，需在真机复核一次（关闭自动闭环后，提交后 `applied_at` 恒为空 → 该状态将持续显示，属预期）。
  - **真机端到端复核未做**：本轮为代码 + 单测层验证（后端两包 + 前端 5 个相关文件全绿）；未重启后端在真浏览器走「保存 → M09 出现 pending 单 → 确认 → 写盘 reload」完整动线。
  - `alertSmoke.test.tsx` 存量 4 条陈旧断言（自 #38 起）仍未修。
- **⚠️ 追加（2026-10-09 11:2x，同日修复自身的断链）**：本条目落地后**实测又暴露一个更严重的断链**——修复前的自查只到「单测通过」，未做真机端到端。
  - **现象**：用户重启后端、重新调整路由顺序，M09 配置变更确认页**依旧找不到记录**，且此时 `pending` 总数为 **0**（不是状态过滤问题，而是**根本没生成变更单**）。
  - **根因（我的修复疏漏）**：上一轮把 `autoApplyManagementDomain` **整体删除**，但它内部同时承担了两个职责——① 自动 `ConfirmDraft`（要删的）② `GenerateDraft` 产 pending 草稿（**要留的**）。我只删了整个函数，②无人接手；而 `triggerChangeDetection` → `change.ProcessDomain` 因`sourceTableScopes` **不含 `AlertmanagerConfigVersion`** 恒判定「源数据无变化」直接跳过，**永远不会**为告警配置变更产草稿→ 提交链路变成「落库版本 → 触发检测（空转）→ 结束」，既不产草稿也不生效。注释甚至写着「产出 pending 草稿」而代码没做，**注释与实现脱节**。
  - **修复**：新增 `ensurePendingDraft`（`service.go`；var 包裹 + `generateOrReusePendingDraft` 实现，便于测试注入），在 `submitValidated` 中 `triggerChangeDetection` 之后显式调用——**只产/复用 pending 草稿，绝不 ConfirmDraft**；`ErrNoChanges` 视为合法（幂等重复提交）不报错，其余错误降级记日志不阻断挂载。同时导出 `EnsurePendingDraft` 包装供 `route/setting_handler.go` 复用（兜底接收人路径同样断链，一并补上）。
  - **端到端实测（真机，非单测）**：重启后端 → `POST /config` 提交改过路由的配置 → 库中立即出现 `CHG-20261009-007`（`status=pending`、`validation=passed`）、`AlertmanagerConfigVersion.applied_at` 为**空**（未生效，符合立场 1）→ 调 `POST /config-drafts/CHG-20261009-007/confirm` → 草稿转 `confirmed`、`applied_at` 回填、磁盘 `config-output/alertmanager.yml` 同期改写。**两段式（提交→产pending→人工确认→写盘reload）完整成立**。
  - **新增回归护栏** `platform/alertmanager/config/pendingdraft_test.go`（5 例）：提交须「触发变更检测 + 产pending 草稿」各 1 次（防断链重现）、产草稿失败/`ErrNoChanges` 均不阻断提交、`ensurePendingDraft` 无 live pending 时确实进入 `GenerateDraft` 分支。
  - **教训**：**单测全绿 ≠ 功能可用**。上一轮自查停在「go test 通过 + 文案已改」，未跑真机；而「删除一个函数」比「修改一行」风险大得多——它可能同时承担多个职责。移除既有函数前必须先确认它的**全部调用点与职责**（本例中 `GenerateDraft` 是隐式职责，只看提交路径察觉不到）。凡关闭既有机制，必须端到端验证「替代职责是否有人接手」。
- **状态**：**landed（2026-10-09，未提交）**——`go vet` 干净；`go build ./platform/...` exit 0；`go test ./platform/alertmanager/... ./platform/configcenter/...` **10 包全过**；前端 `tsc --noEmit` exit 0；告警模块 5 文件 101 例全过（RoutesPage 29 / useRoutes 16 / useRouteSetting 8 / RouteEditorDrawer 33 / alertmanagerConstants 15），另AlertConfigPage 38 + ConfigPreviewPage 18 + AlertConfigDrawer 2 亦全过；**真机端到端已验证两段式成立**（见上）。

## 44. M09「告警配置」遗留版本 id=18 显示「已提交，待确认下发」但 M09 查不到变更记录：变更单已被废弃，而废弃链路不处理告警配置留痕（① 数据形态误判 / ② 实现偏差，2026-10-13 修复）

- **类别**：① 数据形态误判（用户初见判为脏数据）+ ② 实现偏差（跨模块状态断点：M09 废弃不联动 M08 留痕）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.1 / §6.6；源码见回填清单
- **发现场景**：用户在 M08 告警配置页版本历史看到 id=18 状态为「已提交，待确认下发」，但前往 M09「配置变更确认」页**查不到对应变更记录**，疑为脏数据或代码 BUG（2026-10-13）。
- **现状 / 根因**（DB 实证，非推测）：
  - **不是脏数据，变更记录存在**：`config_drafts` id=134 = `CHG-20261013-002`，11:18:42.971 创建（与版本 18 的 11:18:42.694 同秒，即 `submitValidated → ensurePendingDraft` 同步生成），`validation_status=passed`、变更项「变更告警收敛配置 alertmanager.yml」（high）；但 **17 秒后（11:18:59.055）被用户在 M09 点「废弃」→ `status=discarded`**。M09 列表默认按 `status=pending` 过滤（`useConfigDrafts.ts`），废弃单只在切「已废弃 / 全部」筛选时可见——故「查不到」。id=17 同形态（CHG-20261013-001，10:54 被弃）。
  - **是代码问题（设计缺口）**：`DiscardDraft` 只按决策 43 分类回写 M01 源数据（ScrapeJob 三类 + MonitoringRule 清锁），**完全不处理 `alertmanager_config_versions`**；而 `applied_at` 仅由 `writebackAlertmanagerApplied`（`deployment/callback.go`）在确认下发成功后回填 → 单一经废弃，留痕 `status=applied, applied_at=NULL` 永真，前端按 `applied_at` 派生恒显示「已提交，待确认下发」。
  - **无自动恢复路径**：① watcher 的 `sourceTableScopes`（`generator/change_detect.go`）不含 `AlertmanagerConfigVersion` → `ProcessDomain` 恒判「源数据无变化」跳过，**永远不会**为告警配置变更重新产草稿（#43 已记载）；② 幂等 `Submit` 对同 checksum 直接返回旧版本（`config/service.go`），**不走** `ensurePendingDraft` → 重新提交同样内容也不产新单。→ 留痕成为孤儿，唯一恢复是重新导入/Remount（产新版本 + 新单）或改策略/资源触发产草稿（#44 修复后，重新导入同样内容即可走通该路径）。
  - **历史同模式共 4 条**：id=8（09-29，修复前时代无单）、id=15（10-09，CHG-20261009-009 次日被弃）、id=17、id=18（本次）。
  - **附带缺陷（本次一并修）**：`writebackAlertmanagerApplied` 回填「最新一条 applied 留痕」而非随单下发版本——reuse 路径（同产物骑窗版本复用旧单）下来源版本反而遗留「已提交，待确认下发」；且会覆盖已生效版本的 `applied_at` 时间戳。
- **结论 / 修复（三项，B 选项「废弃后自动补产草稿」不做——违背用户废弃意图，恢复走显式路径）**：
  - **A 废弃联动（修）**：`DiscardDraft` 事务内（管理域 default scope）把「已无活单可确认」的留痕（`status=applied AND applied_at IS NULL AND source_change_no 为空`）标记 `discarded` 终态；取代路径（`reconcileWithExistingPending`）同规则并**保护新单来源版本**。`DiscardDraft` 增补 per-domain 锁（与 `GenerateDraft` 共用）消除竞态。存量 4 条孤儿由数据清理 SQL 一次性标记。另修恢复路径两处（同属 #44）：`findVersionByChecksum` 幂等查询仅认 `status=applied`——被废弃留痕不再满足幂等，「重新导入同样内容」可产新版本 + 新单（最自然的恢复动作，修复前会被静默吞掉）；`LatestApplied` 排除 discarded——已废弃留痕的内容不在磁盘上，不得作为「当前生效」呈现。
  - **C 精确回填（修）**：`ConfigDraft` 新增 `alertmanager_source_version_id`（生成时与产物内容同一次加载，`ConfigArtifacts.AlertmanagerSourceVersionID` 非产物字段承载）；确认下发后按它精确回填来源版本，并一并标记「创建时间不早于来源版本、仍待确认」的骑窗兄弟版本（其产物与本单 checksum 相同、内容同样随本单下发；`status=applied` 条件避免 resurrect discarded）。存量单回落旧口径但仅补未生效留痕。
  - **D 废弃告知（修）**：M09 废弃二次确认弹窗（`DiscardImpactSummary`）在含 `alertmanager` 受影响文件时追加终态与恢复路径说明。
- **影响模块**：M08（版本历史状态派生 / 留痕终态）、M09（变更单废弃联动 / 详情新增内部追溯字段）、前端两页。
- **回填清单**：
  - 后端：`platform/models/alertmanager_config.go`（status 枚举扩 `discarded` + 注释修订）；`platform/models/config.go`（`ConfigDraft.AlertmanagerSourceVersionID` 字段 + MarshalJSON 透传）；`platform/configcenter/generator/generator.go`（`ConfigArtifacts.AlertmanagerSourceVersionID` 非产物字段）；`platform/configcenter/generator/data_source.go`（新增 `LoadLatestAlertmanagerConfigVersion`，原 Content 加载改为委托）；`platform/configcenter/draft/service.go`（`buildArtifacts` 填充来源 ID；`GenerateDraft`/`reconcileWithExistingPending` 回填；新增 `discardOrphanAlertmanagerVersions` / `protectedVersionIDsFromLivePending`；`DiscardDraft` 加域锁 + 废弃联动；supersede 事务保护新单来源）；`platform/configcenter/deployment/callback.go`（`writebackAlertmanagerApplied` 拆为精确路径 + 存量回落，新增 `draftAlertmanagerSourceID` / `writebackAlertmanagerSource` / `applyAlertmanagerWriteback`）。
  - 前端：`ui-custom/web/src/types/alertmanager.ts`（`AlertmanagerConfigStatus` 扩 `discarded`）；`alertmanagerConstants.ts`（`configStatusLabel/Color` 扩 discarded；`CONFIG_STATUS_DISCARDED_LABEL/TIP`；`configStatusView(appliedAt, status?)` 第二参 + `ConfigStatusView.discarded`）；`AlertConfigPage.tsx`（`renderConfigStatus` 传 status；discarded 只呈终态 + 恢复指引，**不给确认入口**——无在途单可确认，不造死链）；`ConfigPreviewPage.tsx`（`DiscardImpactSummary` 增 `hasAlertmanager`，废弃弹窗传 `affectedFileSet(detail).has('alertmanager')`）。
  - 契约：module-08 `api-contract-snapshot.md` §3 字段表 / §5 回写口径 / §6 枚举 / §8 展示名；module-09 `api-contract-snapshot.md` §4 ConfigDraftDetail 增 `alertmanager_source_version_id`（内部追溯字段，前端不消费）。
  - 数据：一次性清理 SQL 标记存量 4 条孤儿（id 8/15/17/18）`status=discarded`（执行前已确认 default 域无活 pending 单）。
- **测试护栏**：
  - 后端新增 `platform/configcenter/draft/service_alertmanager_discard_test.go`（7 例）：废弃标记孤儿留痕（id=18 回归）/ 已生效留痕不受影响 / 非管理域不触碰 / 双活单竞态保护另一张活单来源 / 取代路径保护新单来源 / GenerateDraft 回填来源 ID / 无留痕时来源为 0。
  - 后端新增 `platform/configcenter/deployment/callback_alertmanager_test.go`（5 例）：reuse 路径来源 + 骑窗版本均标记（旧口径下来源反而遗留——防回归）/ discarded 兄弟不被 resurrect / 存量回落不覆盖已生效时间戳 / discarded 来源被确认后自愈 applied。
  - 前端：`alertmanagerConstants.test.ts` 扩 discarded 派生 3 例（终态优先于 applied_at / status 缺省回落旧口径）；`AlertConfigPage.test.tsx` 新增「discarded → 已废弃 + 恢复指引，且无待确认提示/确认入口」；`ConfigPreviewPage.test.tsx` 新增含/不含告警配置的废弃影响正反 2 例。
- **状态**：**landed（2026-10-13，未提交）**——`go build ./platform/...` exit 0；`go test ./platform/configcenter/... ./platform/models/... ./platform/alertmanager/...` **13 包全过**（新增 12 例）；前端 `alertmanagerConstants` 18 + `AlertConfigPage` 39 + `ConfigPreviewPage` 20 全过（另：`tsc -p tsconfig.test.json` 存量 9 错均在未触碰文件，属 HEAD/WIP 遗留，与本次无关）；`make repo-map` 已刷新且 `make check-repo-map` 通过。⚠️ 真机端到端（重启后端 AutoMigrate 加列 → 挂载 → 废弃 → 版本历史显示「已废弃」）待用户重启后复核。

## 45. 路由树保存仍由前端生成 YAML + 默认告警配置未落库：只读/编辑两态割裂、历史 receiver 仍可被选中（② 实现偏差 / ① 数据空白，2026-10-22 修复）

- **类别**：② 实现偏差（前端/后端双份 YAML 生成；接收人合法集合含历史声明）+ ① 数据空白（平台无默认告警配置记录）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §5.1 / §9.1；源码见回填清单
- **发现场景**：
  - 告警配置页删除导入能力后，路由页只读态显示 0 节点，点「编辑路由」却出现 1 个根节点，放弃编辑又回到 0 节点；
  - 根路由预检报「根路由必须指定兜底接收人」，用户质疑默认配置为何不是配置；
  - 接收人下拉仍可能出现已停用渠道 / 历史手写 receiver，用户明确要求「默认 + 已启用渠道」之外不允许选择。
- **根因**：
  - **默认配置不在数据库**：`alertmanager_config_versions` 无 seed 记录；磁盘 `deploy/alertmanager/alertmanager.yml` 只被 `make run-alertmanager` 使用，平台路由页读不到。根路由由前端 `emptyRouteTree()` 临时合成，导致只读/编辑两态不一致。
  - **YAML 由前端生成**：`useRoutes.save()` 调用 `routeTree.ts` 的 `generateRouteSection` / `mergeRouteSection`，再以整份 `content` 调 `POST /config`；Go 侧 `GenerateRouteSection` 是另一份镜像，后端无法验证 YAML 是否忠实反映树。
  - **接收人合法集合过宽**：`knownReceivers` 并入了当前 YAML `receivers:` 段的历史声明（为修复 2026-10-08 手写 receiver 误判），导入能力删除后该口径变成「已停用渠道/历史手写 receiver 仍可选」。
- **结论 / 修复**：
  - **默认配置入库**：新增 `seed.EnsureDefaultAlertmanagerConfig`（`db.Init → seed.Run`），无 applied 版本时写入与 `deploy/alertmanager/alertmanager.yml` 一致的默认配置，`status=applied`、`applied_at=seed 时间`、`applied_by=system`；单测守卫模板漂移。路由页删除「未配置」标签与合成占位，只读/编辑均读 DB。
  - **后端生成 YAML**：新增 `POST /api/v2/platform/alertmanager/routes`（RequireAdmin），请求只携带 `{ base_checksum, route_tree }`。后端依次：乐观锁校验 → 树/接收人校验 → `GenerateRouteSection` → `MergeRouteSection` → `EnsureReceiverNames`（渠道 receiver 先补空占位，真实 webhook 由 M09 物化）→ `config.Submit`（amtool 校验 + 落版本 + 触发 M09）。前端删除保存链路中的 YAML 生成/合并。
  - **接收人收口**：前端与后端统一为 `default ∪ 已启用渠道 receiver_name`；`declared_receivers` 不再参与可选集合与合法性校验。已停用/删除渠道与历史手写 receiver 判 `receiver_dangling` 并阻断保存。
  - **交互调整**：路由页默认只读，仅「编辑路由」入口；编辑态只保留「新建 / 保存 / 放弃」；删除「重新载入当前配置」；进入编辑先刷新 `GET /routes` 并用回传的最新数据载入；保存成功回只读态并提示待确认；`GET /routes` 新增 `effective_checksum` 与 `pending`，有 pending 时展示「当前显示的是待确认版本」横幅。
  - **清理**：删除 `AlertmanagerRouteSetting` 模型、`/route-setting` API、根 receiver 物化与托管模式预置示例注入；告警配置页删除导入卡/抽屉/手写说明。
- **影响模块**：M08（路由页 / 告警配置页 / 通知渠道页）、M09（变更单 pending 视图消费）、DB seed。
- **回填清单**：
  - 后端：`platform/db/seed/alertmanager_default.go`、`platform/db/seed/seed.go`；`platform/alertmanager/route/save_handler.go`、`handler.go`、`validate.go`、`register.go`；`platform/configcenter/generator/default_receiver.go`、`notify_route_generate.go`；`platform/alertmanager/config/service.go`；删除 `setting_handler.go`、`models/alertmanager_route_setting.go`、`notify_route_skeleton.go`、`notify_route_preset.go`。
  - 前端：`RoutesPage.tsx`、`useRoutes.ts`、`routeTree.ts`、`RouteEditorDrawer.tsx`、`api/alertmanager.ts`、`types/alertmanager.ts`；删除 `useRouteSetting.ts`、`AlertConfigDrawer.tsx`；告警配置页与通知渠道页去除导入/兜底接管能力。
  - API：新增 `POST /api/v2/platform/alertmanager/routes`；`GET /routes` 增 `effective_checksum` / `pending`；删除 `GET/PUT /route-setting`。
- **测试护栏**：
  - 后端：`seed` 默认配置写入/幂等/不覆盖 + 模板漂移；`generator` 默认接收人补齐、receiver 占位、空 base 合并；`route` 乐观锁 409、树校验、悬空接收人、生成并保留非 route 段；`cmd/metric-center` 冒烟改为默认版本非空。
  - 前端：alerts 目录 14 文件 214 例全过；覆盖只读/编辑两态、进入编辑刷新、保存只提交树 + `base_checksum`、pending 横幅、默认接收人文案。
- **状态**：**landed（2026-10-22，未提交）**——`go build ./platform/...` exit 0；`make test-platform` 相关包全过（仅剩既有环境基线失败：`admin/storagelog`、`db.TestInitDefaultPath`、`strategy/rule` promtool 桩脚本）；前端 `tsc --noEmit` exit 0，alerts 214 例全过；`make check-repo-map` 通过；本机重启后 `GET /routes` 返回默认根路由、`effective_checksum` 非空、`pending=null`。
- **后续**：下发后读回校验（写盘/reload 后比对 AM 实际加载配置）未实现；`routeTree.ts` 的 `generateRouteSection` / `mergeRouteSection` 已退出保存链路，保留为与 Go 生成器对齐的纯函数测试镜像。

## 46. 通知模板页信息架构重做 + 渠道/模板/路由解耦：去版本历史、去模板 ID 入 yml、渠道 CRUD 不再触发配置变更（2026-10-22 用户拍板）

- **类别**：① 数据形态/交互设计（模板被做成 append-only 留痕表，前端直接暴露原始版本行）+ ② 实现偏差（模板 ID 写入 receiver URL，导致换绑模板也要改 yml）
- **PRD 章节 / 文件位置**：`Module_08_Alertmanager_Notification_Management.md` §3.1 / §9.1；源码见回填清单
- **发现场景**：用户走查 `/notify-templates` 指出：内置模板上下重复展示；「提交自定义模板」实为新增但无编辑入口；没有编辑却有「历史版本 / 重新挂载」，语义无法理解；进一步追问「receiver 为什么既有 `notify-<id>` 又有 `channel=<id>`」，并明确「模板改了就是改了，不需要下发/审批」。
- **结论 / 用户拍板**：
  - **模板是可变实体，不是版本留痕**：去掉版本历史 / remount / status / checksum 展示；模板新建、编辑、复制、删除均原地生效。
  - **模板页 = 一个清单 + 按渠道类型分 Tab**：内置与自定义同表展示；内置置顶只读、只能查看/复制；自定义可新建/编辑/复制/删除；删除被渠道绑定的模板时阻止，提示先去通知渠道改绑；编辑时渠道类型锁死（创建后不可变）。
  - **模板彻底退出 alertmanager.yml**：receiver URL 只带 `?id=<渠道ID>`；模板内容与绑定由桥在投递时按渠道 ID 实时读 DB（渠道 `default_template_id` → 内置默认）。换绑模板 / 改模板内容立即生效，不产生 M09 变更单、不 reload。
  - **receiver 名恒为 `notify-<渠道ID>`**：不再由渠道名派生、不接受覆盖；渠道改名 / 改 webhook / 改类型 / 换绑模板均不影响 yml。
  - **只物化被路由引用的渠道**：新增渠道本身不写 yml；未被路由引用的渠道不物化、不产生 receiver；路由引用集合变化才触发 yml/M09。
  - **渠道删除保护**：被当前生效/待确认路由树引用时拒绝删除（409），要求先去路由规则页改绑；渠道列表返回 `route_reference_count` 供前端前置提示。
  - **删除渠道启停状态**：移除 UI Switch、列表列与 API `enabled` 字段；启动迁移显式删除 `notify_channels.enabled` 列（GORM AutoMigrate 只增不删）。
  - **源数据聚合收口**：`NotifyChannel` / `NotifyTemplate` 移出 M09 `sourceTableScopes`；渠道/模板 CRUD 不再空跑变更检测。
  - **路由页删除「有渠道未被任何路由引用」提示**（用户 2026-10-22 追加反馈：未被引用是正常状态，不应提示）：`GET /routes` 不再返回 `dead_receivers`，前端删除该卡片；通知渠道页也只在被引用时显示「被 N 条路由引用」，未引用不再打标记。
- **回填清单**：
  - 模型/DB：`platform/models/alertmanager_notify.go`（去 `Enabled`；`ReceiverName()` 恒 `notify-<id>`）；`platform/db/db.go`（启动迁移 DROP `notify_channels.enabled`）。
  - 后端：`platform/alertmanager/notify/channel.go`（去 enabled；删除前路由引用检查）、`channel_handler.go`、`bridge.go`（只按 `id` 解析渠道；去 `?template=`）、`receiver_snippet.go`（`?id=`、固定 `notify-<id>`、去 name 覆盖）、`template.go`（Create/Update/Delete/List/Detail + 名称唯一 + 内置/绑定保护 + `CompactTemplateVersions`）、`template_handler.go`、`register.go`；`platform/configcenter/generator/notify_receivers.go`（只物化被引用渠道、清理未引用平台 receiver、`?id=`）、`route_receivers.go`（收集 route receiver）、`data_source.go`（`LoadNotifyChannels`）、`change_detect.go`；`platform/alertmanager/route/refs.go`（路由引用收集）与 `handler.go` / `save_handler.go` 适配。
  - 前端：`types/alertmanager.ts`、`api/alertmanager.ts`、`useNotifyTemplates.ts`、`NotifyTemplatesPage.tsx`（Tab + 单表 + 内置只读 + CRUD）、`NotifyTemplateDrawer.tsx`（新建/编辑/复制）、`NotifyChannelsPage.tsx`（去启停、路由引用列、删除拦截）、`NotifyChannelDrawer.tsx`（去启停）、`useRoutes.ts`（去 enabled 过滤）；删除 `useDerivedReceivers.ts`。
  - 契约：`api-contract-snapshot.md` §11 同步（模板端点、渠道字段、桥参数 `id`、去 template、只物化被引用渠道、删除保护）。
- **测试**：
  - 后端 `notify` / `route` / `configcenter/generator` / `configcenter/draft` / `models` / `cmd/metric-center` 目标包通过（CGO 环境）。
  - 前端 `tsc -p tsconfig.test.json --noEmit` 通过；`NotifyTemplatesPage` / `NotifyChannelsPage` 用例重写并全过；全量 vitest 待收口。
- **状态**：**landed（2026-10-22，未提交）**——后端 `alertmanager` / `configcenter` / `models` / `cmd/metric-center` 相关包全过；前端 `tsc -p tsconfig.test.json --noEmit` 与改动文件 eslint 通过，`NotifyTemplatesPage` / `NotifyChannelsPage` / `useRoutes` / `RoutesPage` / `ReceiverSnippetDrawer` 用例全过（全量 vitest 1104 passed / 4 failed，失败均在未触碰文件：`InstanceSelector`、`ResourcesPage` 超时、`ScrapeJobFormDrawer.blackboxEdit`，属既有环境基线）；`make repo-map` 已刷新且 `check-repo-map.sh` 通过。**真机迁移已验证**：用当前 `metric_center.db` 副本启动新二进制后，`notify_channels.enabled` 列被自动删除、渠道/模板数据保持、新模板路由（GET 详情 / PUT / 无 remount）注册成功；`notify-<id>` 与 `?id=` 口径已生效。

## 47. 通知渠道列表通用化 + 删除接收人配置 + 去掉内部桥令牌 + 钉钉加签（2026-10-23 用户拍板）

- **类别**：① 信息架构（列表展示类型独有字段）+ ① 交互缺口（签名无法关闭）+ ② 实现偏差（钉钉 secret 存而未用）
- **发现场景**：用户走查通知渠道页指出：列表是「钉钉式配置表」，应只保留渠道名称 / 渠道类型 / 被引用次数 / 创建时间；Webhook、签名、模板等类型独有字段应进编辑抽屉；「接收人配置」不需要；内部 token 也不需要；钉钉要能用。
- **结论 / 用户拍板**：
  - **列表只保留通用列**：渠道名称 / 渠道类型 / 被引用次数（0 显示 0）/ 创建时间 / 操作（编辑、删除）。去掉 Webhook、签名密钥、接收人、模板绑定列。
  - **删除「接收人配置」**：前端抽屉、API 方法、类型全部删除；后端 `GET /notify-channels/{id}/receiver-snippet` 端点及相关代码全部删除（保留 `DeriveBridgeBaseURL` 供 M09 物化使用）。
  - **删除控制面 ↔ Alertmanager 内部桥令牌**：去掉 `NOTIFY_BRIDGE_TOKEN` / `--notify.bridge-token`、桥端点 Bearer 校验、M09 receiver 的 `http_config.authorization` 写入、Makefile / 交付包 env 中的令牌配置。桥端点改为依赖部署层（同机 / 内网防火墙）限制访问；**安全提示**：任何能访问 `/api/v1/webhooks/notify` 的人都能伪造通知，生产必须做网络层限制。
  - **钉钉加签**：补实现（timestamp + sign 追加到 webhook URL query；key=secret，msg=timestamp+"\n"+secret）；仅在填写 secret 时启用。飞书保持 body 注入签名。
  - **签名开关**：飞书 / 钉钉编辑抽屉增加「签名设置」开关；关闭时隐藏密钥输入并显式提交 `secret: ""` 清空已存密钥，解决「填过之后无法关闭」的问题。企业微信没有加签，隐藏开关；切换渠道类型时关闭签名并清空旧密钥。
  - **内置模板**：不新增钉钉内置模板；保留飞书现有内置模板；企业微信暂无内置模板（用户尚未拍板）。
- **回填清单**：
  - 后端：`platform/alertmanager/notify/{bridge.go,client.go,register.go,channel.go}`、删除 `receiver_snippet.go`、新增 `bridge_url.go`；`platform/alertmanager/register.go`；`platform/cmd/metric-center/main.go`；`platform/configcenter/draft/service.go`；`platform/configcenter/generator/notify_receivers.go`；`Makefile`；`scripts/package-center.sh`（env.sh / start.sh / README 模板）。
  - 前端：`NotifyChannelsPage.tsx`（五列表格）、`NotifyChannelDrawer.tsx`（Webhook 地址、签名开关、按类型显示密钥）、删除 `ReceiverSnippetDrawer.tsx`；`api/alertmanager.ts` / `types/alertmanager.ts` / `alertmanagerConstants.ts` 清理。
  - 测试：后端 notify / generator / draft / cmd 相关包；前端渠道页、路由页、useRoutes、模板页。
- **状态**：**landed（2026-10-23，未提交）**——后端受影响包全过；前端 `tsc -p tsconfig.test.json` 通过，渠道页 / 模板页 / 路由页 / useRoutes 用例全过（68 例）；钉钉加签固定向量与「有/无 secret」两条桥用例通过。

## 48. 自定义 Webhook 类型 + 模板/签名字段必填与掩码交互（2026-10-23 用户拍板）

- **类别**：① 能力缺口（缺自定义 Webhook 渠道）+ ① 校验/交互缺口（模板、地址、签名未统一必填，已存值不可见）
- **发现场景**：用户走查渠道编辑抽屉指出：类型只有飞书/钉钉/企微，没有自定义 Webhook；模板、Webhook 地址、签名密钥的必填与 `*` 标记不一致；已配置的 Webhook/密钥看不到，无法判断是否已填。
- **结论 / 用户拍板**：
  - **新增 `webhook` 渠道类型（自定义 Webhook）**：只填名称、类型、Webhook 地址；不显示模板、签名开关/密钥；桥把 Alertmanager 原始 JSON 原样 POST 到该地址，不渲染、不签名、不判 `code`/`errcode` 业务错误；只看 HTTP 状态码；不做自定义 header/鉴权（本期）。
  - **内置类型模板必填**：飞书/钉钉/企业微信创建/更新必须绑定模板。飞书自动选中内置「飞书卡片-默认」；钉钉/企业微信无内置模板，必须选自定义模板，否则前端/后端均拒绝。
  - **自定义 Webhook 禁止模板**：后端拒绝给 webhook 绑定模板；从 IM 类型切到 webhook 自动清空模板。
  - **地址与密钥可见**：编辑 IM 渠道时回填脱敏 Webhook 地址（`scheme://host/***`）与密钥占位 `***`，用户能看到「已配置」；保持原值=不修改，清空则触发必填校验；自定义 Webhook 地址返回/回填完整地址，编辑同样必填。
  - **必填标记**：Webhook 地址、通知模板、签名密钥（开关打开时）均显示 `*`；签名开关关闭时密钥字段隐藏、不校验，保存时清空。
- **回填清单**：
  - 后端：`models/alertmanager_notify.go`（webhook 类型 / IsTemplateChannelType）；`notify/channel.go`（模板必填 / webhook 不允许模板 / IM 脱敏、webhook 明文）；`notify/bridge.go`（webhook 原样转发分支）；`notify/client.go`（`sendOutboundRaw`，跳过 IM 业务错误码）；`notify/template.go`（模板类型排除 webhook）；测试。
  - 前端：`types/alertmanager.ts` / `alertmanagerConstants.ts`（webhook 类型与展示名）；`NotifyChannelDrawer.tsx`（条件字段、模板必填、飞书自动选内置模板、URL/密钥掩码回填与清空校验）；`NotifyChannelsPage.test.tsx`（webhook、模板必填、清空校验）。
- **状态**：**landed（2026-10-23，未提交）**——后端受影响包全过；前端 `tsc -p tsconfig.test.json` 通过，渠道页/模板页/路由页/useRoutes 共 72 例通过；接口实测：创建 `type=webhook` 返回 200 且 `webhook_url` 明文，删除成功。
