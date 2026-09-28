# Module 08 backend-developer 执行记录

> 本文件按 micro-task 追加任务条目；Agent 调用结束后写总结性收尾。

---

## T08-06：M02 侧 Prometheus GET /api/v1/alerts 代理

- **commit**：未提交（任务卡要求本 Agent 不执行 git commit，由 Orchestrator 统一收口；回填 hash 待提交后补）
- **新增/修改文件**：
  - `platform/query/alerts.go`（新增）：`AlertsHandler` 代理中心 Prometheus `GET /api/v1/alerts`，`data.alerts` 返回字段子集 labels/annotations/state/activeAt/value；`network_domain` Query 服务端本地过滤（`labels.network_domain` 缺失回落 `default`，与 targets.go 同构）；租户/网域注入骨架 `tenantAuthorizedDomains`/`alertDomainAllowed`（MVP 恒通过，机制保留，M02 §11.2#5）；上游不可达/非 success → `internal`；空结果返回 `[]` 而非 null。
  - `platform/query/alerts_test.go`（新增）：6 个用例——字段子集透传、network_domain 过滤、缺失标签回落 default、空结果非 null、上游三类故障（status=error / HTTP 500 / 连接拒绝）→ internal、租户骨架锚点（nil=恒通过 / 非空集合按网域收敛）。
  - `platform/query/routes.go`（修改）：`RegisterRoutes` 追加 `GET /alerts`（apiV1 组，命中认证中间件，仅认证不授权）。
- **关键实现说明**：与既有 targets 代理同构（上游拉取 + 本地过滤 + 统一响应信封）；不代理 Alertmanager 通知状态（M02 §11.2#14 边界，归 T08-07）。
- **验证**：`go test ./platform/query/...` ok；`go vet ./platform/query/...` 通过。

## T08-07：M08 侧 Alertmanager GET /api/v2/alerts 通知状态代理 + 路由注册

- **commit**：未提交（同 T08-06，由 Orchestrator 统一收口）
- **新增/修改文件**：
  - `platform/alertmanager/alerts/proxy.go`（新增）：`Proxy`/`NewProxy`（scheme 仅 http/https + host 非空，SSRF 防护，与 silence.NewProxy 同口径）；`ListAlerts` 调 AM `GET /api/v2/alerts`（v2 口径裸数组解码，决策 61；非 2xx 错误脱敏截断）。
  - `platform/alertmanager/alerts/service.go`（新增）：`AlertItem` 契约视图（labels/annotations/starts_at/ends_at/status{state,silenced_by,inhibited_by}/notify_status，snake_case）；`normalizeNotifyStatus` 服务端归一四态（active/silenced/inhibited/unprocessed，suppressed 不外露，silenced 优先于 inhibited）；`domainInScope` 决策 56 读路径授权过滤骨架（AllDomains/nil 恒通过；非全量按 labels.network_domain 缺失回落 default 收敛）；network_domain UX 筛选在授权过滤之后执行（不构成权限依据）。
  - `platform/alertmanager/alerts/handler.go`（新增）：`ListHandler` → `GET /api/v2/platform/alertmanager/alerts`；`authorizedScopeForUser` 服务端强制注入授权网域集合（MVP 恒 AllDomains，不信任前端传参）；AM 不可达/非 2xx → `internal`；空结果 `items: []`。
  - `platform/alertmanager/alerts/alerts_test.go`（新增）：9 个用例——Proxy SSRF 校验、四态映射 + 字段子集、四态优先级（silenced 优先）、授权过滤锚点（AllDomains=5 条 / Domains={default}=2 条含无标签回落 / nil=全通过）、UX 筛选、AM 不可达错误、端点 happy（断言仅命中 /api/v2/alerts 路径）、空结果非 null、AM 故障 → internal。
  - `platform/alertmanager/register.go`（修改）：追加 `am.GET("/alerts", alerts.ListHandler(...))`（只读端点挂根组，仅全局认证，同静默列表挂法）；`RegisterRoutes(platform, db, amURL)` 签名不变，main.go 无需改。
  - `platform/cmd/metric-center/main_test.go`（修改）：`fakeAlertmanager` 增加 `GET /api/v2/alerts` 夹具；`fakePromUpstream` 增加 `/api/v1/alerts` 夹具；新增 `TestEndToEndAlertStatusSmoke` 经真实路由树验证双视图（字段子集 / network_domain 过滤 / 四态归一）。
- **关键实现说明**：读路径授权过滤在 service 层执行（`domainInScope`），scope 由 handler 从服务端上下文构建（当前 MVP 恒 AllDomains=true），前端 Query 仅作 UX 筛选透传。
- **验证**：`go test ./platform/alertmanager/...` ok；`go vet ./platform/alertmanager/...` 通过；`go test ./platform/cmd/metric-center/... -run TestEndToEnd` ok（含新增冒烟）。

---

## 总结性收尾（T08-06/T08-07 批次）

- **输入文档**：
  - `docs/05-execution-records/module-08/task-sequence.yaml`（T08-06/T08-07）
  - `docs/05-execution-records/module-08/api-contract-snapshot.md` §1 通用契约 / §10.1 / §10.2（第一权威）
  - `docs/03-engineering-standards/03_API_Standard.md` §7、`04_Testing_Standard.md` §4
  - 参考实现：`platform/query/targets.go`、`platform/alertmanager/silence/*`
- **全量验证**：
  - `go test ./platform/...` 全绿；`go vet ./platform/...` 通过；`go build ./platform/...` 通过。
  - 服务启动验证：新二进制 `--listen-address :18080`（8080 被既有 `make run-metric-center` 进程占用，未触碰）——`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；两新端点无 token 返回 401（证明已注册并命中认证中间件）；admin 登录后带 token 调 `GET /api/v1/alerts` 与 `GET /api/v2/platform/alertmanager/alerts` 均返回 `{"status":"success","data":{"alerts"/"items":[]}}`（本机 9090/9093 上游在线，空结果为非 null 空数组）。验证后已停服释放 18080。
- **遗留风险与下一步**：
  - 决策 56 授权集合当前 MVP 恒 AllDomains；多租户启用时需在 `alerts.authorizedScopeForUser` / `query.tenantAuthorizedDomains` 从认证上下文解析真实授权网域集合（测试锚点已就位）。
  - T08-F6/F7 前端双视图页可直接对接本批次两接口（契约 §10 字段已按快照实现）。
  - Track B+ 强制 security-reviewer 收尾（决策 56 授权骨架 + 代理 SSRF 面）待挂。
  - 本批次未 commit（任务卡要求），commit hash 待 Orchestrator 收口后回填。

---

## 迭代二 PL-3（通知渲染桥）批次：T08-08 ～ T08-11

> 契约权威：设计提案 `docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md` §3.3（PL-3 端点尚未写入 `api-contract-snapshot.md`，PRD 亦未回写，见 dev-feedback #17）。
> 已裁决口径：D-2 内置默认模板 + 用户可自定义 Go template（非脚本、无沙箱）；D-3 端点命名维持 `POST /api/v1/webhooks/notify`，定址参数走 query（`channel`/`template`/`token`）。

## T08-08：通知渠道 / 通知模板模型与迁移

- **commit**：`4e3d8ca`（feat(module-08): 新增通知渠道/通知模板模型与迁移（T08-08））
- **新增/修改文件**：
  - `platform/models/alertmanager_notify.go`（新增）：`NotifyChannel`（Name/Type/WebhookURL/Secret/Enabled，表 `notify_channels`，WebhookURL/Secret 仅平台侧存储）；`NotifyTemplate`（Name/ChannelType/Content/IsBuiltin/Checksum/Status，表 `notify_templates`，版本化留痕）；枚举 `NotifyChannelType`（feishu/dingtalk/wecom）+ `ValidNotifyChannelTypes`/`IsValidNotifyChannelType`；`NotifyTemplateStatus`（恒 `applied`，照抄决策 59/60）。checksum 复用 `AlertmanagerConfigChecksum`（sha256 十六进制小写）。
  - `platform/models/alertmanager_notify_test.go`（新增）：枚举合法性、TableName、字段缺省等单测。
  - `platform/db/db.go`（修改）：AutoMigrate 追加 `&models.NotifyChannel{}`、`&models.NotifyTemplate{}`。
- **验证**：`go test ./platform/models/... ./platform/db/...` ok；`go vet` 通过。

## T08-09：通知渠道 CRUD API（响应脱敏 + webhook_url SSRF 校验）+ 路由注册

- **commit**：`72afc55`（feat(module-08): 通知渠道 CRUD 接口与路由注册（T08-09））
- **新增/修改文件**：
  - `platform/alertmanager/notify/channel.go`（新增）：`ValidateWebhookURL`（仅 http/https + host 非空，SSRF 口径与 silence/alerts 代理一致）；`ChannelInput`/`UpdateChannelInput`（更新用指针字段，语义「仅更新显式提供字段」）；`CreateChannel`/`UpdateChannel`/`GetChannel`/`ListChannels`/`DeleteChannel`（软删除）；`ChannelView`+`ToChannelView`+`maskWebhookURL`（响应脱敏为 `scheme://host/***`，绝不回显 secret）。
  - `platform/alertmanager/notify/channel_handler.go`（新增）:`ListChannelsHandler`/`CreateChannelHandler`/`UpdateChannelHandler`/`DeleteChannelHandler`；`parseID`；`respondChannelError` 统一错误映射（not_found / bad_request / internal）。
  - `platform/alertmanager/notify/register.go`（新增）：`RegisterRoutes(am, db)` 挂 `/notify-channels*`——列表读端点仅全局认证，创建/更新/删除挂 `auth.RequireAdmin()`。
  - `platform/alertmanager/register.go`（修改）：末尾调 `notify.RegisterRoutes(am, db)`。
  - `platform/alertmanager/notify/channel_test.go`（新增）：服务层校验、脱敏视图、CRUD、更新语义、软删除等用例。
- **验证**：`go test ./platform/alertmanager/...` ok；`go vet` 通过。

## T08-10：通知模板 API（复用 config 校验工序 + 留痕/回滚）+ 内置飞书卡片模板

- **commit**：`28192cc`（feat(module-08): 通知模板提交/回滚接口与内置飞书卡片模板（T08-10））
- **新增/修改文件**：
  - `platform/alertmanager/config/template_validate.go`（新增）：`ValidateTemplate` —— 先 `text/template.Parse` 再复用 `runCheckConfig` 的 amtool 等价校验工序（可注入点 `lookPathAmtool`/`runAmtoolCheckCmd`/`devfeedback` 复用，不重造轮子）；`TemplateFuncs()` 导出校验侧与渲染侧共用的函数表（`jsonStr` 等），保证「校验即渲染」。
  - `platform/alertmanager/config/template_validate_test.go`（新增）。
  - `platform/alertmanager/notify/template.go`（新增）：`EnsureBuiltinTemplates`（幂等 seed，`findTemplateByChecksum` 去重）；`BuiltinTemplateForType`；`SubmitTemplate`（校验通过才落库，失败只回行级错误、不落库，照抄决策 59/60）；`RemountTemplate`（回滚=重提交历史版本，追加新 applied 记录）；`TemplateView`+`SubmitTemplateInput`；内置飞书卡片模板常量 `BuiltinFeishuCardTemplateName = "飞书卡片-默认"`。
  - `platform/alertmanager/notify/template_handler.go`（新增）：列表 / 提交 / 回滚 handler。
  - `platform/alertmanager/notify/register.go`（修改）：追加 `/notify-templates*`，装配时 `EnsureBuiltinTemplates`；写端点挂 `RequireAdmin()`。
  - `platform/alertmanager/notify/template_test.go`（新增）：内置模板 seed 幂等、校验失败不落库、提交/回滚留痕等。
- **验证**：`go test ./platform/alertmanager/...` ok；`go vet` 通过。

## T08-11：桥端点 /api/v1/webhooks/notify + 路由注册 + alertmanager.yml 生成侧接线

- **commit**：待提交（task id = T08-11）
- **新增/修改文件**：
  - `platform/alertmanager/notify/render.go`（新增）：`Render(templateContent, payload, loc)` —— 解码 Alertmanager 原生 webhook JSON（camelCase：version/groupKey/status/receiver/groupLabels/commonLabels/commonAnnotations/externalURL/alerts[]）为 `amWebhookPayload`，构造 `RenderData`（在 `RenderAlert` 上追加已本地化时间字段 `StartsAtLocal`/`EndsAtLocal`）；复用 `config.TemplateFuncs()` 渲染，渲染结果 TrimSpace 为空返回 `ErrRenderEmpty`（提示若用 `{{ define }}` 需在模板根处 `{{ template "名" . }}`）。默认时区 `DefaultRenderLocation = time.FixedZone("UTC+8", 8h)`，不依赖宿主机时区。
  - `platform/alertmanager/notify/client.go`（新增）：`outboundHTTPClient`（一处收敛出站 CA 配置，对应脚本 `certifi` 兜底问题）——`x509.SystemCertPool` + 可选 `NOTIFY_BRIDGE_CA_FILE`，克隆 `http.DefaultTransport` 后设 `TLSClientConfig{RootCAs, MinVersion: TLS1.2}`，Timeout 15s；`sendOutbound` POST JSON，非 2xx 返回状态码 + error，响应体 LimitReader 4096 丢弃（不泄露内网细节）。
  - `platform/alertmanager/notify/bridge.go`（新增）：`BridgeHandler(db, cfg)` 流程——`bridgeTokenValid`（`crypto/subtle` 常量时间比较，未带/错 token → 401）→ 遍历 `forbiddenTargetParams`（url/target/webhook_url/fsurl/to/dst/endpoint 命中 → 400，**SSRF 硬约束**）→ `parseUintQuery(channel)`（非法/非 ID → 400）→ `GetChannel`（不存在 → 404）→ 禁用 → 400 → `resolveBridgeTemplate`（显式模板须与渠道类型一致，否则 400）→ 读体 → `decodeWebhook` → `Render`（空 → 400）→ `sendOutbound`（失败 → 502 BadGateway 令 AM 重试，并记结构化失败日志）→ 200 `{success:1, fail:0, channel, template, alert_count}`。**无状态渲染转发，不落告警业务表**。`RegisterBridgeRoutes(v1, db, cfg)` 挂 `POST /webhooks/notify`。
  - `platform/alertmanager/notify/template.go`（修改）：**修复 T08-10 内置飞书卡片模板 JSON 缺陷**——line 51 `"text": {` 对象缺闭合 `}`（渲染出非法 JSON，见 dev-feedback #18），在 action `}}` 后补 `}`。
  - `platform/alertmanager/notify/render_test.go`（新增）：内置模板渲染合法 JSON + header 红/绿、时间本地化（东八区 / UTC）、`{{ define }}` 空产出 → `ErrRenderEmpty`、非法载荷、`TestRenderUsesSharedFuncMap`（jsonStr + toUpper）。
  - `platform/alertmanager/notify/bridge_test.go`（新增）：`fakeReceiver` 桩；401（缺/错 token）、**`TestBridgeRejectsArbitraryTargetURL`（显式 SSRF 用例：`?url=`/`target`/`webhook_url`/`fsurl`/`to` → 400 且 `rec.calls()==0`；`channel=<地址>` → 400）**、404、禁用 400、成功 200+出站一次（body 合法 JSON + 含 HighCPU + 本地化时间）、显式模板、模板/渠道类型不一致 400、出站失败 502 + 失败日志、成功结构化日志。
  - `platform/alertmanager/notify/channel_test.go`（修改）：`channelResp` 增加 `Error` 字段供 bridge 测试断言错误文案。
  - `platform/cmd/metric-center/main.go`（修改）：新增 import `notify`；flag `--notify.bridge-token` / `--notify.render-timezone`（env 覆盖 `NOTIFY_BRIDGE_TOKEN` / `NOTIFY_RENDER_TIMEZONE`）；`setupRouter` 签名增 `bridgeCfg notify.BridgeConfig`；`auth.PublicPathPrefixes` 追加 `/api/v1/webhooks/`（桥端点不挂认证态平台组）；apiV1 组内 `notify.RegisterBridgeRoutes(...)`，token 为空时 WARN；`loadRenderLocation(name)`（空→东八区，`time.LoadLocation` 失败回退并记日志）。
  - `platform/cmd/metric-center/main_test.go`（修改）：AutoMigrate 增 Notify 模型；engine 内装配桥路由；新增 `TestEndToEndNotifyBridgeSmoke`（内置模板 seed / 渠道创建脱敏 / 401 / SSRF 400 / 成功 200 且出站一次）+ 并发安全 `bridgeReceiver`。
- **生成侧接线说明（逃生门校验）**：M09 `configcenter/generator/render.go` 对 `alertmanager.yml` 为**透传**（不生成 receivers/webhook_configs）；`alertmanager/config/validate.go` 的 `runCheckConfig` 仅做 YAML/引用闭合校验、**不检查 webhook URL**。故 receiver 的 `webhook_configs.url` 仍可直接填外部地址（提案 §3.3.7 逃生门**天然成立**），**无需改动 validate.go 或生成侧代码**。
- **验证**：
  - `go test ./platform/...` 全绿（含 `cmd/metric-center` 新增集成测试 `TestEndToEndNotifyBridgeSmoke`）；`go vet ./platform/...` 通过；`go build ./platform/...` 通过。
  - 服务启动（`--listen-address :18080` + `NOTIFY_BRIDGE_TOKEN` + `NOTIFY_RENDER_TIMEZONE=Asia/Shanghai`）：`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；`POST /api/v1/webhooks/notify` 无 token → 401、错 token → 401、`?url=外部地址` → 400、`channel=外部地址` → 400、`channel=9999` → 404；admin 登录后创建渠道响应脱敏为 `http://127.0.0.1:19090/***`；带合法 `channel` + token 转发本地 fake receiver → 200 `{"success":1,"fail":0,"channel":"1","template":"1"}`，receiver 收到合法 JSON 卡片（header `red`、时间已本地化为 `2026-01-02 11:04:05 +08:00`）。验证后已停服释放 18080（临时 DB/日志已清理）。
- **遗留风险与下一步**：
  - 契约快照 `api-contract-snapshot.md` 与 PRD 均缺 PL-3 端点（`/notify-channels*`、`/notify-templates*`、`POST /api/v1/webhooks/notify`），**待回写**（dev-feedback #17）。
  - 取消渠道 WebhookURL/Secret 明文存储 + 响应脱敏的取舍登记见 dev-feedback #15；令牌/时区注入依赖 `env/env.sh`（当前交付包无该文件）见 dev-feedback #16。
  - Track B+ 强制 security-reviewer 收尾：桥端点 SSRF 面 + 内网令牌鉴权 + 出站 CA 收敛，建议随 T08-11 挂 security-reviewer。

## T08-12：通知渠道生成接收人配置片段端点

- **commit**：`eb8ff3b`（feat(module-08): 通知渠道生成接收人配置片段端点（T08-12））
- **背景**：PL-3 交付了渠道登记能力，但未把渠道接到 `alertmanager.yml` 的 receivers——用户既不知道为何要写 receiver，也无从知道 `channel` 的真实数字 ID 与桥 `token` 真值（前端骨架误写 `ch-default` 必被 `parseUintQuery` 判非法）。本端点服务端拼好完整可用的 receiver 片段（含真实 ID + 内网令牌）供用户复制粘贴（A 路线：不改 M09 生成逻辑）。
- **新增/修改文件**：
  - `platform/alertmanager/notify/receiver_snippet.go`（新增）：`ReceiverSnippetConfig`（BridgeURL + BridgeToken）/ `ReceiverSnippet`（receiver_name / url / snippet / token_configured）；`DeriveBridgeBaseURL(listenAddr)`（由监听地址推导桥基址：空/`0.0.0.0`/`::` 归一为 `127.0.0.1`，缺端口报错）；`sanitizeReceiverName`（转小写、非 `[a-z0-9]`→`-`、压缩连续、去首尾）；`BuildReceiverSnippet`（receiver 名 sanitize + 空名回落 `notify-<id>` + query 覆盖校验；URL 恒带真实数字 channel ID 与令牌，未配置令牌用占位符 `<未配置桥令牌>` 并置 `token_configured=false`；片段为相对 `receivers:` 缩进 2 空格的可粘贴 YAML）；`ReceiverSnippetHandler`（解析 `:id` → GetChannel → 生成，只读无副作用）。
  - `platform/alertmanager/notify/register.go`（修改）：`RegisterRoutes` 增 `snippetCfg ReceiverSnippetConfig`；admin 组追加 `GET /:id/receiver-snippet`（挂 `auth.RequireAdmin()`）。
  - `platform/alertmanager/notify/channel_handler.go`（修改）：`respondChannelError` 增 `ErrReceiverNameInvalid` → `bad_request` 映射。
  - `platform/alertmanager/register.go`（修改）：`RegisterRoutes` 增 `notifyCfg notify.ReceiverSnippetConfig` 参数并下传。
  - `platform/cmd/metric-center/main.go`（修改）：由 `--listen-address` 经 `notify.DeriveBridgeBaseURL` 推导桥基址（非法即启动失败）；`setupRouter` / `registerPlatformConfigRoutes` 增片段配置透传。
  - `platform/alertmanager/notify/receiver_snippet_test.go`（新增）：基址推导表驱动、receiver 名 sanitize（含中文名「SRE 飞书群」→`sre`）、空名回落、覆盖校验、令牌未配置占位符、URL↔bridge 参数口径闭环（把生成 URL 的 `channel` 喂回 `parseUintQuery`）、handler 鉴权（无身份/普通用户 403、管理员 200）、404/400、**amtool check-config 实测片段可接受（含令牌与占位符两态）**。
  - `platform/cmd/metric-center/main_test.go`（修改）：`alertmanager.RegisterRoutes` 调用补片段配置；`TestEndToEndNotifyBridgeSmoke` 增第 6 步断言片段端点返回真实 channel ID + 令牌 + `send_resolved: true`。
- **契约口径**：`GET /api/v2/platform/alertmanager/notify-channels/{id}/receiver-snippet`，鉴权 `RequireAdmin()`；成功 200 `data={receiver_name,url,snippet,token_configured}`；404 `not_found`（渠道不存在）；400 `bad_request`（ID 非法 / receiver_name 覆盖非法）。令牌封装在片段内、不作为独立字段单独暴露（用户裁决）。
- **验证结果**：
  - `go test ./platform/...` 全绿（含 `platform/alertmanager/notify` 新增用例与 `cmd/metric-center` 集成）；`go vet ./platform/...` 干净；`make repo-map` 已刷新、`make check-repo-map` OK。
  - 服务启动（`:18081` + `NOTIFY_BRIDGE_TOKEN=testbridge-123` + 临时 DB）：`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；admin 登录创建渠道（脱敏 `https://open.feishu.cn/***`）后 `GET .../notify-channels/1/receiver-snippet` → 200 `receiver_name=sre`、`url=http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1&token=testbridge-123`、`snippet` 含 `send_resolved: true`、`token_configured=true`；`/9999`→404、`/abc`→400、无 token→401、**普通用户 token→403 `forbidden`**。验证后已停服释放 18081（临时 DB 已清理）。
- **遇到的问题与解决**：
  - 片段在 AM 侧必须可直接粘贴且 `amtool check-config` 接受：`token_configured=false` 时占位符含尖括号，实测 `amtool check-config` 对该 URL 仍判 SUCCESS，遂保留醒目占位符（未做百分号转义，保证可读）。
- **遗留**：本端点属 PL-3 契约的新增端点，`api-contract-snapshot.md` / PRD 仍缺 PL-3 全部端点（见 dev-feedback #17，已在本端点追加其后登记）。
