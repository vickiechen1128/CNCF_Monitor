# Phase 0 - Backend Developer 执行记录

> 日期：2026-07-21  
> 角色：Backend Developer Agent  
> 分支：`feature/module-00-infrastructure`  
> Worktree：`/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree`

## 任务

完成 Phase 0 后端基础设施改造：统一 API 响应格式、调整平台能力接口路径、按标准注册 Prometheus 代理路由、补充测试。

## 修改文件

### 1. `platform/api/response/response.go`

- 响应格式从 `code/message/data` 改为 `status/data/error/errorType`。
- 新增 `StatusSuccess`/`StatusError` 常量。
- 新增 `ErrorType*` 错误类型常量。
- `Fail` 改为接收 `errorType` + `error`。

### 2. `platform/api/response/response_test.go`

- 全部断言迁移到新字段。
- 新增 `TestJSONSerializationError`、`TestUnauthorized`、`TestForbidden`、`TestNotFound`、`TestStatusAndErrorTypeConstants`。
- 新增 `TestStrError`，覆盖非空与空字符串边界。

### 3. `platform/cmd/metric-center/main.go`

- 将 `/api/v1/config/*` 占位接口迁移到 `/api/v2/platform/config/*`。
- Prometheus Query 代理按 API 标准逐条注册：
  - `/api/v1/query`
  - `/api/v1/query_range`
  - `/api/v1/labels`
  - `/api/v1/label/:name/values`
  - `/api/v1/series`
- `mustParseURL` 重构为 `parseURL(raw string) (*url.URL, error)`，增加 scheme（仅 http/https）和 host 非空校验。
- `main` 中校验 `prometheusURL`，无效时输出可读日志并 `log.Fatalf` 退出。
- 新增 `newPrometheusProxy`，配置 `ErrorHandler` 与 `ModifyResponse`。
- 在代理 handler 中添加转发日志。
- 添加 TODO 注释，标注未来需接入认证/多租户隔离。

### 4. `platform/cmd/metric-center/main_test.go`

- 重写 `TestMainFlags`：使用独立 `flag.FlagSet` 真正调用 `Parse()` 并断言默认值与自定义值。
- 新增 `TestParseURL`，覆盖有效/无效 URL、非法 scheme、空 host。
- 新增 `TestPrometheusProxyRoutes`，使用 mock Prometheus 验证 5 条标准路由正确转发。
- 新增 `TestPrometheusProxyErrorHandling`，验证后端不可用时返回 502 统一错误响应。
- 所有 `setupRouter()` 调用改为传入解析后的 URL。

## 测试结果

```bash
$ GOPROXY=off go test ./platform/...
ok      github.com/metriccenter/metriccenter/platform/api/response
ok      github.com/metriccenter/metriccenter/platform/cmd/metric-center
ok      github.com/metriccenter/metriccenter/platform/db
ok      github.com/metriccenter/metriccenter/platform/models

$ GOPROXY=off go vet ./platform/...
# 无输出，通过
```

## 阻塞与处理

- **首次启动协议阻塞**：`make build-prometheus` 失败，原因为当前 worktree 缺少 `upstream/prometheus`。
- **处理**：Orchestrator 已补充 `.gitmodules` 并复制主仓库 `CNCF_Monitor` 的 `upstream/prometheus` 与 `upstream/node_exporter` 内容到当前 worktree；后续 `make build-prometheus` 可正常执行。

## 已知问题

- 当前环境下连续发起 `go test` 会被系统判定为执行时间过长而跳过，但首次完整运行及分包子集运行均已验证通过。
