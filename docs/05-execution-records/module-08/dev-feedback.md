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

## 16. 桥端点内网令牌 / 渲染时区注入依赖 env/env.sh，当前交付包无该文件（① 空白）

- **类别**：① 空白判定（部署交付面）
- **PRD 章节 / 文件位置**：设计提案 §3.3.6（内网调用令牌）/ §3.3.4（渲染时区）；落点 `platform/cmd/metric-center/main.go`（flag `--notify.bridge-token` / `--notify.render-timezone`）
- **现状 / 根因**：任务卡要求桥端点内网令牌由交付包 `env/env.sh` 注入（与既有 `DATA_ROOT`/`LOG_ROOT` 同源）。但当前工作区 **`env/` 目录不存在**（`env/env.sh` 尚未创建），无法按其注入。
- **判定（本迭代二执行口径）**：以 **flag + 环境变量**双通道注入作为兜底——`--notify.bridge-token`（env 覆盖 `NOTIFY_BRIDGE_TOKEN`）、`--notify.render-timezone`（env 覆盖 `NOTIFY_RENDER_TIMEZONE`）；令牌为空时桥端点一律 401（安全默认，不开放匿名转发）。待交付包补齐 `env/env.sh` 后，由其统一导出这两个环境变量即可，无需改代码。
- **影响模块**：M08 PL-3（桥端点部署面）；M09 / 交付包（`env/env.sh` 补齐）
- **发现场景**：T08-11 装配桥端点时，按任务卡尝试从 `env/env.sh` 读取令牌，确认该文件不存在
- **状态**：open（flag+env 兜底已落地；待 `env/env.sh` 补齐后本项 closed）

## 17. PL-3 新增端点未写入 api-contract-snapshot.md / PRD（① 空白，待回写）

- **类别**：① 空白判定（契约文档面）
- **PRD 章节 / 文件位置**：契约快照 `docs/05-execution-records/module-08/api-contract-snapshot.md`；PRD `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- **现状 / 根因**：PL-3 的四个新增端点——`GET/POST/PUT/DELETE /api/v2/platform/alertmanager/notify-channels*`、`GET/POST /api/v2/platform/alertmanager/notify-templates*`、`POST /api/v1/webhooks/notify`——**均未写入 `api-contract-snapshot.md`**，PRD 也未回写。本次以设计提案 §3.3 为契约权威实现。
- **判定（本迭代二执行口径）**：按提案 §3.3 实现；**待 PL-3 开发收口后由文档方（prototype-designer / Orchestrator）将端点补齐至 `api-contract-snapshot.md` 与 PRD**（含请求/响应字段、错误码、query 定址参数、脱敏口径）。
- **影响模块**：M08 PL-3；前端对接、security-reviewer 审查均以提案为准
- **发现场景**：T08-08～T08-11 开发前核对契约快照，确认 PL-3 端点缺失（任务卡已声明「契约快照缺 PL-3 端点，待回写」）
- **状态**：open（按提案实现，待回写契约快照与 PRD 后 closed）

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
