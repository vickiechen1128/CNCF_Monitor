# 安全审查结果：feat/module-08-alert-dispatch（PL-3 通知渲染桥，T08-08 ~ T08-15）

> Security Reviewer（Track B+ 强制安全审查），严格只读，未修改任何被审查代码（仅写本报告文件）。
> 范围：M08 PL-3「通知渲染桥」11 个后端变更文件 + 3 个前端变更文件（**未**使用 `git diff develop...HEAD`，分支离 develop 过远）。
> 输入：任务卡变更清单 + 高风险预标注、`security-reviewer.md`、`.kimi/skills/security-review`、AGENTS.md §9、PRD §5.1、`api-contract-snapshot.md`（PL-3 端点缺失，已知）、`dev-feedback.md` #15/#16/#22、`security-review-round1.md`。

## 摘要

- **审查文件数：14**（深读 14 / 抽查 1：`bridge_test.go`；另深读 6 个支撑文件：`gateway/auth/{middleware,admin_middleware}.go`、`api/response/response.go`、`alertmanager/config/template_validate.go`、`models/alertmanager_notify.go`、gin v1.10.1 `logger.go`）。
- **总体结论：FAIL（有条件）** —— SSRF 硬约束、桥令牌鉴权（空即拒 / 常量时间）、所有 `/api/v2/platform/alertmanager/*` 写接口挂 `RequireAdmin`、响应脱敏、模板注入面均已核实成立（未发现 CRITICAL）；但存在 **1 项 HIGH（桥内网令牌经 query 传递，被 gin 默认访问日志明文落盘）**，须修复后方可进入 Git Guardian。
- **最高严重级别：HIGH**。
- **执行度量：** 起止 ~单轮；重试 0；token 估算 ~中（14 文件深读 + 关键支撑/依赖源码定点核对）。

**关键判定（预检命中与信任边界复核）**

- **SSRF（调用侧）：通过。** `bridge.go:63-70` 显式拒绝请求方传入的目标地址参数；`bridge.go:71-77` `channel` 必须解析为平台内登记 ID；目标地址恒取自 `ch.WebhookURL`（DB），`bridge.go:114-115`。出站目标不接受任何请求参数 → 「用户输入 SSRF」不成立。测试 `TestBridgeRejectsArbitraryTargetURL` 覆盖（抽查确认）。
- **鉴权：通过（无 CRITICAL）。** `register.go:24-39` 渠道创建/更新/删除 + 模板提交/回滚 + receiver-snippet 全部挂 `auth.RequireAdmin()`；读端点（列表）仅全局认证。`main.go:214` 桥前缀豁免全局用户认证，但 `bridge.go:57-62` 由内网令牌自校验，`bridgeTokenValid`（`bridge.go:144-149`）任一侧为空即拒 → 不构成「未鉴权写接口 / 未鉴权桥转发」。
- **注入：通过。** `render.go:130` 与 `template_validate.go:66` 使用 `text/template` + **白名单 FuncMap**（`template_validate.go:17-28`：toUpper/toLower/title/trimSpace/join/contains/default/jsonStr），无文件/命令/网络类函数；渲染上下文为纯 struct（`RenderData`/`RenderAlert`）→ 无任意文件读 / RCE。`ValidateTemplate` 以 `exec.Command` 参数化调用 amtool、路径为 `MkdirTemp` 随机目录，无 shell 拼接 → 无命令注入。
- **前端：通过。** 三页面（`NotifyChannelsPage.tsx` / `NotifyTemplatesPage.tsx` / `ReceiverSnippetDrawer.tsx`）全部用 React 文本节点渲染（含 `<pre>{detail.content}</pre>` / `{data.snippet}`），全仓 `ui-custom/web/src` 对 `dangerouslySetInnerHTML/innerHTML/eval/document.write` **零命中** → 无存储型/反射型 XSS。
- **SQL/ORM：通过。** `channel.go`/`template.go` 全部 GORM 参数化占位（`Where("channel_type = ? AND checksum = ?", …)`），无字符串拼接 SQL。

---

### CRITICAL

本次未复现可直接远程利用的 CRITICAL。逐项对照 `security-reviewer.md` 特殊规则：未鉴权写接口、命令/SQL/NoSQL 注入、用户输入 SSRF、越权写管理接口 **均不成立**（见上「关键判定」）。

---

### HIGH

- [ ] **H-1 桥内网令牌经 URL query 传递，被 gin 默认访问日志明文落盘（每次调用都泄露）**
  - 文件/行号：
    - `platform/cmd/metric-center/main.go:200`：`r := gin.Default()`（全局安装 gin 默认 Logger）。
    - `platform/alertmanager/notify/bridge.go:58`：`bridgeTokenValid(cfg.Token, c.Query("token"))` —— 令牌取自 query。
    - `platform/alertmanager/notify/receiver_snippet.go:107-116`：`buildBridgeURL` 把**真实令牌**拼进 `…?channel=<id>&token=<token>`，写入片段供 AM 调用。
    - 佐证（依赖源码）：`github.com/gin-gonic/gin@v1.10.1/logger.go:273-275` 将 `RawQuery` 追加进日志 `param.Path`，默认 Logger 无 `SkipPaths`/脱敏。
  - 风险：中心 Alertmanager 每次向桥投递通知，都会以 `POST /api/v1/webhooks/notify?channel=…&token=<平台内网令牌>` 触发一条 gin 访问日志，**令牌以明文写入 stdout / journald / 日志采集系统**。任何可读日志的运维/日志下游（其权限边界通常弱于 DB）即取得桥内网令牌，可**绕过平台边界**向任意已登记渠道伪造投递（通知欺骗 / 钓鱼）。这直接击穿本桥的鉴权设计（令牌是唯一门禁），且发生在**主链路 happy path**，非仅错误分支。
  - 建议修复（任一，优先前者）：① 令牌改由**请求头**承载（Alertmanager `webhook_configs.http_config.authorization.credentials` 或自定义 `headers`），`bridge.go` 从 `c.GetHeader` 读取、`receiver_snippet.go` 同步改为生成带 `http_config` 的片段；② 若暂保留 query，必须装配**自定义 Logger**（或 `LoggerConfig.SkipPaths` + 自定义 formatter）剔除 query，并确保前置反代不记录 query。修复后同步更新 `bridge_test.go` 与片段用例。

---

### MEDIUM

- [ ] **M-1 出站失败时把含 webhook 明文（含 bot token）的错误写日志，违反 `bridgeLogf`「绝不记录 webhook 明文」自述**
  - 文件/行号：`platform/alertmanager/notify/bridge.go:115-121`（`sendOutbound` err 经 `bridgeLogf(... err=%v)`）；`platform/alertmanager/notify/client.go:46-49`（`http.Client.Do` 出错返回 `*url.Error`，其 `Error()` 含 `Op + " " + URL + ": " + Err`）；`platform/api/response/response.go:151-154`（`BadGateway` 再次 `log.Printf("upstream dependency error: %v", err)`）。
  - 风险：网络不可达 / TLS 失败等**传输层错误**下，`err.Error()` 含完整 `https://open.feishu.cn/…/hook/<token>`（bot 凭据），被双重写入日志，与 `bridge.go:47-49` 注释「绝不记录 webhook 明文地址或 secret」相矛盾。现有测试 `TestBridgeSendFailureReturnsBadGateway` 用非 2xx（httptest 可达）路径，未覆盖传输错误，故漏网。
  - 建议：失败日志只记 `ch.ID/type/tpl.ID/http_status` 与**脱敏后的错误类别**（如 `net.Error`/`x509`/`timeout`），或对 `err` 做 URL 剥离（`errors.Unwrap` 到 `*url.Error` 后仅取 `Err`），不要把 `%v` 原样落日志；`BadGateway` 侧同样处理。

- [ ] **M-2 登记侧 SSRF：`ValidateWebhookURL` 不限制私网/环回/链路本地/云元数据地址**
  - 文件/行号：`platform/alertmanager/notify/channel.go:35-47`（仅校验 scheme∈{http,https} 与 `Host!=""`）。
  - 风险：这是**登记侧（调用侧之外）的 SSRF 二级面**——管理员（`RequireAdmin`）登记渠道时可把 `WebhookURL` 指向 `127.0.0.1`、`10.0.0.0/8`、`169.254.169.254`（云元数据）等，桥端点随后会把**由外部告警内容渲染出的报文**POST 到该内网地址，形成对内网的探针/投递通道。设计意图（飞书/钉钉/企微机器人）与之明显不符，且载荷含可被规则内容影响的字段。
  - 建议：在 `ValidateWebhookURL` 增加地址类限制——拒绝 loopback / private / link-local / multicast / unspecified（可解析 host 的 IP 或域名解析后判定），或改为**域名白名单**（`open.feishu.cn` / `oapi.dingtalk.com` / `qyapi.weixin.qq.com` 等）；如确需自定义中继，走显式配置开关 + 记录审计。

- [ ] **M-3 出站客户端默认跟随重定向，可从已登记目标 302 到内网/任意主机**
  - 文件/行号：`platform/alertmanager/notify/client.go:32-34`（`http.DefaultTransport.Clone()` + `http.Client{Transport, Timeout}`，未设 `CheckRedirect`）。
  - 风险：Go 默认 `CheckRedirect` 允许最多 10 次跳转且**不限制跨主机**。即便修复 M-2 收紧了初始目标，攻击者/被攻陷的目标仍可用 3xx 把出站请求重定向到内网地址或另一主机（携带告警报文），绕过初始目标校验。
  - 建议：设置 `CheckRedirect` 拒绝跨 host（或直接 `return http.ErrUseLastResponse` 不跟随），并限制跳转次数。

---

### LOW

- [ ] **L-1 桥端点请求体无大小上限（`io.ReadAll(c.Request.Body)`）→ 令牌已知时可内存 DoS**
  - 文件/行号：`platform/alertmanager/notify/bridge.go:97`。
  - 风险：无 `MaxBytesReader` 限制，超大 body 触发内存放大（鉴权在前，需令牌，故非匿名可触发）。
  - 建议：`c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, N)`（如 1–4 MiB）后再读。

- [ ] **L-2 receiver-snippet 以 GET 返回含令牌密钥的响应体，未设缓存控制**
  - 文件/行号：`platform/alertmanager/notify/receiver_snippet.go:133-151`。
  - 风险：GET 响应默认可被浏览器/中间缓存留存；虽端点已挂 `RequireAdmin`（按 Authorization 头，共享缓存默认不跨用户命中），仍建议显式禁止缓存。
  - 建议：响应加 `Cache-Control: no-store`。

- [ ] **L-3 `forbiddenTargetParams` 比对大小写敏感，属纵深防御缺口（当前无可利用性）**
  - 文件/行号：`platform/alertmanager/notify/bridge.go:45,64-70`（`c.Query` 大小写敏感）。
  - 风险：`?URL=` / `?Target=` 不会命中拒绝名单；但 handler 除 `channel`/`template` 外**从不读取**这些参数，目标恒取自 DB，故无实际绕过。仅影响「显式拒绝」的语义完整性。
  - 建议：改为大小写不敏感遍历 `c.Request.URL.Query()` 键名，或在注释中明确「拒绝名单为防御纵深，非安全依赖项」。

- [ ] **L-4 `bridgeTokenValid` 长度不等即返回（长度侧信道）**
  - 文件/行号：`platform/alertmanager/notify/bridge.go:144-149`（`subtle.ConstantTimeCompare` 长度不等会提前返回 0）。
  - 风险：可推断令牌长度，实际不可利用（值比较仍恒定时间）。
  - 建议：如需严格，先对双方做等长哈希（如 sha256）再 `ConstantTimeCompare`。可忽略。

---

### 已登记取舍的安全可接受性评估（不重复登记为新发现）

- **#15 渠道 WebhookURL / Secret 服务端明文存储 + 响应脱敏回显 —— 可接受（有条件）。** 脱敏实现正确：`ToChannelView`（`channel.go:181-191`）不回显 secret，仅 `secret_set` 布尔；`maskWebhookURL`（`channel.go:194-200`）仅保留 `scheme://host`、路径与 query（含 token）以 `/***` 替代，且 Go `url.Host` 天然剔除 userinfo → 无凭据经列表接口泄露。明文入库与决策 60 同源、MVP 可接受；但**叠加 H-1/M-1（凭据入日志）后整体凭据暴露面偏高**，建议后续版本对 URL/Secret 加密或外置 secret store。
- **#16 桥令牌 flag + 环境变量兜底 —— 可接受（生产建议仅用 env）。** `--notify.bridge-token` 会出现在 `ps`/进程参数（本机可读）；`NOTIFY_BRIDGE_TOKEN`（`main.go:103-105`）为更优通道。空令牌一律 401（`bridge.go:57-62`）为安全默认。建议交付包优先以 env 注入，flag 仅供本地调试。
- **#22 令牌未配置用占位符 + 片段「勿外发」提示 —— 可接受。** `token_configured=false` + 占位符 `<未配置桥令牌>`（`receiver_snippet.go:23,100`）+ UI 双重提示（`ReceiverSnippetDrawer.tsx:144-152,178-184`）均已落地；`RequireAdmin` 限制片段仅管理员可取。

---

### 遗留风险

1. **契约快照缺 PL-3 端点**（README 已注明「待回写」）：本次 PL-3 的鉴权/权限/错误码按 PRD §5.1 + 设计提案摘要 + `03_API_Standard.md` 评估，**未能与 `api-contract-snapshot.md` 逐字段比对**；建议由文档方补齐端点的鉴权字段（含 `receiver-snippet` 的 admin 门、桥端点的内网令牌与 401 语义）与错误码清单后再复核一次。
2. **H-1 的连带项**：桥令牌同时存在于「query 日志」（H-1）与「receiver-snippet 片段文本」两处；即使改头部承载，仍应审查交付包 `env/env.sh` / 生成日志是否把令牌写入世界可读文件。令牌轮换机制当前缺失（无失效/轮换入口），建议纳入后续版本。
3. **CORS 全放开 / 认证只认证不授权**（`main.go:201-207`）为 round-1 已登记项，PL-3 写端点已通过 `RequireAdmin` 局部缓解，此处不重复登记。

---

*报告生成方式：静态代码走读 + 依赖源码定点核对（Security reviewer，只读）。未运行动态 fuzz/渗透；`go test ./platform/...` / `go vet` 沿用开发侧已验证清单（抽查 `bridge_test.go` 通过，但该测试未覆盖 H-1 的「query 入日志」与 M-1 的「传输错误日志」路径）。修复 H-1（及建议一并修复 M-1/M-2/M-3）后可发起定向复审。*