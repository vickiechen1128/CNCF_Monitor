# Module-08 告警分发 Golang 代码审查报告（Round 1）

## 审查结果

- 审查分支：`feat/module-08-alert-dispatch`（相对 `origin/develop`，30 commit，跨 M01/M02/M07/M08/M09）
- 审查范围：`platform/` 下 41 个变更文件（其中核心源码 20 个、测试 14 个、模型 4 个、路由装配 3 个）
- 审查方式：只读补跑审查，结合 `review-precheck.md` 预检清单与 `module-01/02/07/08/09/api-contract-snapshot.md` 契约逐模块核对
- **结论：REQUEST_CHANGES**（存在 1 处 HIGH 级逻辑缺陷，见下）
- 最高严重级别：**HIGH**
- 执行度量：
  - 高风险预标注 9/9 全部深读并给出结论；
  - SSRF / 命令注入 / SQL 注入高危项经逐一实读确认**安全**（详情见「遗留风险」）；
  - 测试覆盖抽查 4 个文件（`config/config_test.go`、`query/coverage_test.go`、`alertmanager_config_test.go`、`deployment/deployment_test.go`），三态口径、回写链路均有断言覆盖，质量合格。

---

## CRITICAL

无。

## HIGH

- [ ] `platform/alertmanager/config/handler.go` L54-76（SubmitHandler）/L136-172（RemountHandler）—— **errChangeTrigger 分支为死代码，且触发 M09 变更检测失败时误报 HTTP 500**。
  - 问题：`submitValidated`（`service.go` L103-105）在 `triggerChangeDetection` 失败时返回 `(v, errChangeTrigger)`，而 `Submit`/`Remount` 原样透传该错误。handler 中逻辑为：
    ```go
    v, err := Submit(db, req.Content, req.UploadedBy)
    if err != nil {          // err==errChangeTrigger 时命中此分支
        respondSubmitError(c, err)   // default 分支 → InternalServerError，返回 500
        return
    }
    if errors.Is(err, errChangeTrigger) { // 死代码：上面已 return，永不可达
        log.Printf(...)
    }
    ```
  - 影响：配置**实际已校验通过并成功落库留痕**（`AlertmanagerConfigVersion` 已写入），仅 M09 侧即时变更检测触发失败（后续 steady watcher 本可兜底），但前端却收到 500，且 `errors.Is(err, errChangeTrigger)` 的降级日志分支永远不执行——与设计注释「失败仅记录、不阻断挂载、照常返回成功」相悖（`service.go` L101-105）。用户在 500 下重试会命中幂等返回已有版本，反馈混乱。
  - 建议：将 errChangeTrigger 判定提前——把 `errors.Is(err, errChangeTrigger)` 检查移到 `if err != nil` 之前（或 service 层把「触发失败」与「校验失败」用不同错误族区分），命中 errChangeTrigger 时记录日志并照常 `response.OK(c, v)` 返回已留痕版本，不要落 500。两处 handler（Submit/Remount）一并修正。

## MEDIUM

- [ ] `platform/configcenter/generator/render.go` L140-145（jobScrapeConfig）—— **采集认证凭据明文写入配置产物并最终落盘**。
  - `BasicAuth{Username, Password}` 与 `Authorization{Credentials: job.Token}` 会进入 `prometheus.yml` 文本，经 `ConfigDraft`/`ConfigVersion` 存 DB、并经 `DiskApplier.writeStructural` 写盘，`AlertmanagerConfigVersion` 亦明文存 `content`。属 Prometheus 标准格式，功能必需，但为敏感静态凭据的持久化点。
  - 建议：MVP 至少确认三处防护——配置目录权限（`writeFile` 0o644 可评估收紧到 0o600）、DB 与产物中含凭据的表不进入审计导出/日志回显（当前日志仅打 method/path，未见内容回显，此项 OK）；并在 README/部署说明标注「配置文件含采集凭据，需保护写盘目录」。升级方向：接入 Secret 引用的 `authorization.credentials_file` / `tls_config` 外部化。

- [ ] `platform/strategy/scrapejob/installation.go` L93-96（ConfirmInstallation）—— **`confirmed_by` 硬编码 `platform_admin` 的伪鉴权**。
  - 仅校验请求体字段恰为 `"platform_admin"`，任何已全局认证（且非 admin）用户都可伪装该值完成「安装确认」登记。虽决策 47-1 已将该登记降级为「非生成闸门、不影响 target 组」，但越权写入伪造背书记录仍污染操作留痕。
  - 建议：从认证上下文（auth middleware 注入的用户标识）取 `confirmed_by`，而非信任请求体；或 MVP 明确该接口挂 `RequireAdmin` 门。若坚持读取请求体，应注释声明为 MVP 占位并在交付前替换。

- [ ] `platform/alertmanager/silence/proxy.go` L94-106 + `handler.go` L44-46—— **静默列表全量拉取后内存分页**。
  - `ListSilences` 拉取 Alertmanager 全部静默（含 active/pending/expired）到内存再 `paginate`。AM 静默量大时内存与网络开销线性增长，且列表默认仅展示 active，存在截断前先全量传输的浪费。
  - 建议：MVP 可接受；演进方向为向 AM 传 `filter`/`limit` 查询参数（AM 原生 `/api/v1/silences` 支持 filter），或服务端分页。短期可至少在 `List` 的 activeOnly 过滤前置到 SQL 不可行的情况下，将 active 过滤提前到解码阶段以减少内存滞留。

- [ ] `platform/configcenter/deployment/callback.go` L70-76—— **`db.Model(&cfg).Update(...).Update(...)` 链式多次 UPDATE**。
  - `Update("applied_at",...).Update("source_change_no",...)` 会生成两条独立 UPDATE（非原子），存在两步之间被其它并发写打断的窗口。
  - 建议：改用单条批量列更新 `db.Model(&cfg).Updates(map[string]interface{}{"applied_at": cfg.AppliedAt, "source_change_no": cfg.SourceChangeNo})`，原子且少一次往返。

## LOW

- [ ] `platform/query/coverage.go` L346-348 与 `coverage_test.go` L297-304—— **page_size 超限钳制值注释与实际不符**。
  - 实现将超限钳到 `maxCoveragePageSize=1000`，但测试注释写「传 2000 回退 500」；测试断言依赖元素总数 <1000 恰好通过，未真正覆盖钳制边界值。建议统一文案，并补一条 `page_size=1500 → 实际返回 ≤1000` 的精确断言。

- [ ] `platform/alertmanager/config/validate.go` L80-84（runCheckConfig）—— **`output, _ := runAmtoolCheckCmd(...)` 丢弃 cmd 错误、仅依赖输出含 `SUCCESS` 判定**。
  - 若 amtool 因非配置原因崩溃（如段错误/超时被杀）但输出恰无 `SUCCESS`，会被误判为「配置校验失败」而非「工具异常」。当前 `isSuccess(output)` + `parseCheckErrors` 逻辑可用，但建议捕获 cmd.error：`CombinedOutput` 返回非 nil 且输出无校验信息时，应归类为工具不可用（可观测失败 + dev-feedback），而非普通行级校验错误。

- [ ] `platform/configcenter/generator/change_detect.go` L24-28—— **基线表仍含 `ExporterInstallationConfirmation`（domainScoped=false）**。
  - 虽决策 47-1 已使其非生成闸门，但其 `updated_at` 仍参与 `SourceDataVersion` 聚合，登记/删除确认记录会推高源数据版本、触发一轮无谓的变更检测预筛（最终被 checksum 相同抑制，不产草稿）。注释已说明此权衡，但会造成低频无谓轮询。
  - 建议：将该表移出 `sourceTableScopes`（MVP 阶段确认登记不影响任何产物），从源头上消除无谓触发；若为保留审计用途，可改为不入版本聚合。

- [ ] `platform/alertmanager/config/version.go` L35 vs `platform/models/alertmanager_config.go` L53-74—— **版本时间格式不一致**。
  - 列表项 `created_at` 用 `time.RFC3339`（秒级），详情/当前生效视图 `MarshalJSON` 里 `time.Time` 原生输出为 RFC3339Nano（含纳秒）。前端若按字符串比较或展示会观察到两级精度不一致。建议统一为同一种格式（契约未强制，优先全 RFC3339）。

- [ ] `platform/cmd/metric-center/main.go` L202-236 全局认证中间件—— **M08/M09 写接口（静默创建/删除、alertmanager.yml 挂载、变更单 confirm）仅「全局认证、不授权」**。
  - 任何已认证用户均可操作全部跨模块写接口（`RequireAdmin` 仅覆盖 user/tenant 后台）。此为 MVP 单租户已声明边界（契约 §1.3、AGENTS §7），但建议在 `decision` 或交接文档中显式登记为「多租户/授权治理前必须加固」项，避免后续遗漏。

- [ ] `platform/configcenter/draft/change_items.go` L55-66—— **`diffAlertmanagerItems` risk 恒为 `low`，与注释矛盾**。
  - 注释称「告警收敛配置变更一律 high（契约 §8）」，但 `Risk` 字段写死 `models.RiskLow`。契约/PRD §3.4 强调变更单高/低危分级，管理域 alertmanager.yml 变更影响收敛链路，应默认 high。建议核对契约后修正 risk（depends on 契约口径，若契约明确 low 则仅修注释消除歧义）。

---

## 遗留风险

1. **SSRF（预检命中项，实读后确认为安全）**：`query/targets.go`、`query/coverage.go`、`alertmanager/silence/proxy.go`、`config/reload` 的所有上游 URL 均来自 main 装配配置（`parseURL`、`NewProxy` 校验 scheme=http/https + 非空 host），用户 query 参数（job/health/network_domain/state/category/state）仅作本地过滤或经 `url.Values.Encode` 编码透传，**不进入上游 URL 的 scheme/host**，无法构造 SSRF。`registerSPA` 的目录穿越防护（path.Clean + 前缀校验）亦核验通过。
2. **命令注入（预检命中项，实读后确认为安全）**：`generator/validate.go` 的 `promtool`/`blackbox_exporter`/`amtool`、`config/validate.go` 的 `amtool` 均以固定命令名（经 `exec.LookPath` 从 PATH 解析）执行，校验内容写入临时文件后以**路径参数**传入，无用户可控字符串拼接进 shell；无 `bash -c`/`sh -c`，故无命令注入。
3. **SQL 注入（实读确认安全）**：全部 `Where("…= ?", …)` 参数化；`nextChangeNo` 的 `change_no LIKE ?` 亦参数化，`prefix` 仅含日期数字，安全。
4. **data_source.go L138（已知 bug，已核验为已修复且健壮）**：`LoadLatestAlertmanagerConfigContent` 对 `gorm.ErrRecordNotFound`（→返回空串、不产生空产物）与系统性错误（表不存在/连接失败→`fmt.Errorf` 包装上抛）做了明确区分，无误吞错误分支；表缺失问题已由 `platform/db/db.go` L91 `AutoMigrate(&models.AlertmanagerConfigVersion{})` 修复（运行时启动建表）。此点**不阻断**。
5. **deployment/callback.go（预检「M09 回调解耦」项，实读确认安全）**：`writebackAlertmanagerApplied`/`writebackChangeStatuses` 并非外部 HTTP webhook，而是 `ConfirmDraft → DeployConfirmedVersion → dispatchVersion` 事务内的内部函数调用链，其对外暴露面仅 `confirm` 接口（走全局认证中间件），无独立回调 CSRF 面。写盘/写 DB 失败均降级到 `error_message` 记录、不整链 500（MEDIUM-1 review-fix 已落地）。
6. 决策 60 文件挂载边界：M08 挂载仅做「校验 + DB 留痕」，实际 `alertmanager.yml` 物理写盘与 reload 由 M09 `DiskApplier.writeAlertmanagerAndReload`（`deployment/service.go` L293-320，原子写 + 独立 AMReload）完成，与契约「内容 Owner=M08、管道 Owner=M09」一致，符合度良好。