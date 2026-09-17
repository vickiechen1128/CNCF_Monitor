# 安全审查结果：module-08（告警分发链路 M08+M09 + 采集状态 M01/M02/M07）

> Security Reviewer 首轮审查（严格只读，未修改任何被审查代码）。
> base: origin/develop → HEAD: feat/module-08-alert-dispatch（30 commit，93 个变更文件）。
> 审查输入：`review-precheck.md`、各 module 契约快照、`SKILL.md`、AGENTS.md §9。

## 摘要

- **审查范围文件**：重点深读 20+ 个高风险源码文件（`platform/alertmanager/**`、`platform/configcenter/{draft,deployment,generator}/**`、`platform/query/**`、`platform/gateway/auth/**`、`platform/cmd/metric-center/main.go`、`platform/config/resource/**`、`platform/strategy/scrapejob/installation.go`、`ui-custom/web/src/pages/alerts/CreateSilenceDrawer.tsx`、`api/alertmanager.ts`）。
- **结论**：**PASS（有条件）** —— 未发现可直接远程触发的 CRITICAL（命令注入、用户输入 SSRF、未鉴权写接口均不成立），但存在 **1 项 HIGH（管理类写接口仅认证、不授权）** 与若干 MEDIUM/LOW，须修复后方可视为收敛。
- **最高级别**：HIGH。
- **关键判定（预检命中复核）**：
  - `platform/query/routes.go / targets.go` 的 SSRF 预检命中为**误报**：代理/聚合目标 URL 全部来自服务端 flag（`--prometheus.url`），已过 `parseURL` scheme+host 校验，**无用户输入 SSRF**。
  - `alertmanager/config/validate.go`、`configcenter/generator/validate.go` 的命令注入预检为**误报**：`exec.Command` 全参数化传参、临时文件路径随机生成（`MkdirTemp`/`CreateTemp`），内容写文件后以**文件路径**传给校验工具，**不做 shell 拼接**。
  - **全局认证有效**：`main.go:156` `auth.AuthMiddleware` 对所有 `/api/*`（除 health/status/login/OPTIONS）强制 Bearer token → 全部 `/api/v2/platform/*` 写接口均已鉴权，**不满足「未鉴权写接口=CRITICAL」的严格触发条件**。但**仅认证、不授权**是本次 HIGH 根因。
  - **前端无 XSS**：全量检索 `dangerouslySetInnerHTML`/`eval`/`document.write`/`-innerHTML` **零命中**；`CreateSilenceDrawer.tsx` 用 React 文本节点转义，`api/alertmanager.ts` 路径用 `encodeURIComponent`。

以下按严重级别列出，每条含文件+行号+风险+可执行修复建议；未标注「误报」的均需处理。

---

### CRITICAL

本次未复现可直接远程利用的 CRITICAL。

说明：按 reviewer 特殊定级规则逐项复核——
- *未鉴权写接口 → CRITICAL* ：不成立。`AuthMiddleware`（`platform/gateway/auth/middleware.go:38-75`）对所有 `/api/*` 强制 Bearer，而 alertmanager「config submit/remount、silences POST/DELETE」、configcenter「draft generate/confirm/discard、deployment retry/rollback」均挂其下 → 已鉴权。
- *SSRF → HIGH*：不成立（服务端 flag 注入目标，见下）。
- *命令注入 → 不成立*。

真正的风险是「已鉴权但未授权」导致的管理操作越权，按越权定级为 **HIGH**（见下），并建议评审方按管控制度决定是否升级为 CRITICAL。

---

### HIGH

- [ ] **[授权缺失] 管理类写接口仅认证不授权，任意已登录（含非管理员）用户可修改、下发、回滚 Prometheus/Alertmanager 配置、删除静默**
  - 文件/行号：
    - `platform/cmd/metric-center/main.go:202-241`：`RequireAdmin()` 仅挂载于 `/users*`、`/tenants*`、`/login-logs*`（admin 子组），**alertmanager/configcenter/strategy/resource 的写路由均只挂全局认证、未授权**。
    - `platform/alertmanager/register.go:28-44`（config submit/remount、silences create/delete）。
    - `platform/configcenter/draft/handler.go:43-51`（generate/confirm/discard/revalidate）。
    - `platform/configcenter/deployment/handler.go:41-47`（retry/rollback）。
  - 风险：任何能登录系统（角色非 admin）的用户均可：提交/重挂 `alertmanager.yml`、创建/删除任意静默、**确认下发配置到中心 Prometheus 并写盘+reload**（`deployment.Dispatch`/`DiskApplier.Apply` 写 `config.dir` 下 `prometheus.yml`/`rules.yml`/`targets/*.json`）、回滚配置。这些是典型的**管理面高危操作**，超出普通用户权限边界，属**水平越权（管理职能混淆）**；且 `silence.DeleteHandler`（`platform/alertmanager/silence/handler.go:72-86`）完全无 scope 校验，可删任意静默。
  - 建议：对上述写端点统一追加 `auth.RequireAdmin()`（或在 `silence`/`draft`/`deployment`/`alertmanager.config` 的写路由组上加最小角色/权限点中间件）；决策 44「无角色/权限点体系」应至少对「配置下发/回滚、alertmanager 挂载、静默删除」补最小管理员授权门。

---

### MEDIUM

- [ ] **[敏感信息] 采集凭据（basic_auth 密码 / Bearer token）明文写入配置产物并落库、落盘，且对任意已登录用户可读**
  - 文件/行号：
    - `platform/configcenter/generator/render.go:140-145`：`job.Password`/`job.Token` 直接置入 prometheus.yml 的 `basic_auth.password`/`authorization.credentials`。
    - `platform/configcenter/draft/service.go:141-146`（`ConfigDraft.PrometheusYml` 落库）、`platform/configcenter/deployment/service.go:238-245`（`ConfigVersion.PrometheusYml` 落库）；`deployment/service.go:324` 落盘 `prometheus.yml`。
    - 读取侧：`draft/handler.go:89-98`（GET /config-drafts/:change_no 返回完整产物）、`deployment/handler.go:66-75`（GET /config-versions/:id）、`alertmanager/config/handler.go:80-92,113-131` + `platform/models/alertmanager_config.go:53-74`（完整 content，alertmanager.yml 内可含 webhook/notifier API 令牌）。
  - 风险：① DB 与磁盘明文存储凭据；② 在 HIGH「任意登录用户可读」前提下，非该 Job 的所有者也仅凭认证即可读取含凭据的完整配置 → **凭据越界披露**。
  - 建议：配置产物中凭据改外置 secret 引用（如 `env`/secret store），DB 层对 `PrometheusYml/AlertmanagerYml` 加密（剩余）或脱敏回显；读取类接口限管理员；至少避免普通用户读到 basic_auth/bearer 明文。

- [ ] **[身份/审计] `confirmed_by` / `triggered_by` 由客户端自由填写、未绑定认证身份，可伪造操作者审计记录**
  - 文件/行号：`platform/configcenter/draft/handler.go:102-110`（`ConfirmDraftHandler` 取 req.ConfirmedBy）；`platform/configcenter/deployment/handler.go:96-109,113-128`（`Retry`/`Rollback` 取 req.TriggeredBy）；`platform/alertmanager/config/handler.go:56-59`（submit/remount 的 `uploaded_by`）。
  - 风险：任何已登录用户可把 `confirmed_by` 写成任意管理员名/他人名，污染下发/挂载审计链路，削弱追责能力；且 `ConfirmDraft`/`Retry`/`Rollback` 在高风险审批语境下被单一调用方任意触发（配合 HIGH）。
  - 建议：从 gin context 的 `authUser`（`auth.ContextUserKey`，见 `auth/middleware.go:14,73`）读取当前真实用户，服务端赋值 `confirmed_by/triggered_by/uploaded_by`，不再信任请求体该字段。

---

### LOW

- [ ] **[防御纵深] 配置产物 targets 文件名写入点未二次清洗路径分隔符**
  - 文件/行号：`platform/configcenter/generator/validate.go:204`（`os.WriteFile(filepath.Join(targetsDir, name), …)`）、`platform/configcenter/deployment/service.go:346-361`（`writeTargets` 用 map key 直接 `filepath.Join(targetsDir, name)`）。
  - 风险：当前 key 由 `generator.normalizeJobFilename`（`generator.go:89-105`）把 `.`/`/` 归一为 `-`，正常路径无法注入目录穿越；但写入点复用未二次校验的 map key，若 DB/下游存入脏 key（含 `..`）可越界写文件（写系统目录/tmp 副作用，非 RCE）。
  - 建议：写入点对 `name` 再断言 `filepath.Base(name)==name && !strings.ContainsAny(name,"/\\")`，或直接以 `sanitizeFilename` 合计为准。

- [ ] **[配置面] 外部校验工具（promtool/amtool/blackbox_exporter）仅按 PATH 解析**
  - 文件/行号：`platform/configcenter/generator/validate.go:138-151`（`execLookPath("promtool")` 等）、`platform/alertmanager/config/validate.go:65`（`lookPathAmtool("amtool")`）。
  - 风险：若进程以危险 PATH 运行（如 CWD 含同名可执行文件）可能命中非预期二进制（内容为平台生成/用户挂载，经文件路径传入，无命令拼接）。属部署面，非远程触发。
  - 建议：以固定绝对路径构建校验工具名（或启动时 `exec.LookPath` 一次并缓存绝对路径），并确认生产 systemd/Docker 的 PATH 不含可写目录。

- [ ] **[部署] CORS 全放开**
  - 文件/行号：`platform/cmd/metric-center/main.go:151`（`r.Use(cors.Default())`）。
  - 风险：当前为 Bearer 令牌（非 Cookie）+ 服务端会话，浏览器跨源不会自动携带 → CSRF 实际风险低；但 `cors.Default()` 允许任意 Origin，登上公网后任何页面可发带自定义头的请求并读响应。属审计/加固项（源码注释也已注明 S2 应收紧）。
  - 建议：按部署拓扑（A2 同源 / 未来 S2 nginx 反代）将 CORS 收紧为白名单或移除。

---

### 误报 / 已通过项（L3 边界结论）

- **URL 校验 / SSRF**（复核通过）：`platform/cmd/metric-center/main.go:346-358 parseURL`、`platform/alertmanager/silence/proxy.go:76-91 NewProxy` —— 均强制 http/https + 非空 host；代理/查询/下发 reload 目标全部来自服务端 flag，非用户输入。`query/targets.go`、`query/coverage.go`、`alertmanager/silence/*` 无「用请求参数拼目标 URL」路径。
- **命令注入**（复核通过）：全参数化 `exec.Command`，无 shell；`fmt.Sprintf`+`sql` 命中为误报（`gorm` 全程参数化占位符，如 `db.Where("checksum = ?", …)`）。
- **SQL 注入**（无命中）：所有 DB 查询走 GORM 参数化 `?` 占位（`coverage/alertmanager/draft/deployment/resource` 抽查全部安全）。
- **XSS / CSRF**（通过）：前端零 `dangerouslySetInnerHTML`/`eval`；后端 Bearer 服务端会话不依赖 Cookie，CSRF 触发面弱（配合 LOW 的 CORS 建议更稳妥）。
- **M09 下发回调**（复核通过）：`configcenter/deployment/callback.go` 仅含 `writebackChangeStatus*/writebackAlertmanagerApplied` 等**内部回写函数，无任何 HTTP 回调端点、不消费外部输入** → 不存在伪造回调/CSRF 风险面。`buildReloadFunc`（`main.go:363-389`）POST 到配置的 reload 地址，scheme+host 已校验。
- **目录隔离**：违反项均落在安全无关的 `docs/`、`ui-custom/`（`review-precheck.md` 已列），本机未发现 `upstream/`、`patches/` 被改。
- **Patch 安全**：本分支未涉及上游 patch 应用。

---

### 遗留风险（供 round-2 或运管关注）

1. **授权体系缺失是系统性根因**（HIGH）：`AuthMiddleware` 只认证不授权、`RequireAdmin` 仅覆盖 `/users*`/`/tenants*`/`/login-logs*`。建议后续版本为「配置挂载/下发/回滚、静默删除、资源导入」引入最小权限点，或在现版本对高危写端点直接挂 `RequireAdmin()`。
2. **凭据明文存储/披露**（MEDIUM）需要产品在此次 MVP 合并前决策：至少对返回前对 `config-drafts/versions` 详情剥离 `basic_auth`/`authorization`/webhook 令牌明文，否则配合审计项 3 构成完整凭据泄露链。
3. **审计身份可信性**（MEDIUM）：`confirmed_by/triggered_by` 改由服务端从认证上下文填充后，下方记录才可采信。

---

*报告生成方式：静态代码走读（Security reviewer，只读）。未运行动态 fuzz/渗透；`go test ./platform/...`、`go vet` 由已验证清单信任（全绿）。修复完成后可发起 round-2 复核。*