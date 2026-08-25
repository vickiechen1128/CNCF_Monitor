# integration/v0.1：端到端验证结果

## 验证环境

| 项 | 值 |
|----|----|
| 分支 | `integration/v0.1` |
| 提交 | `HEAD（联调首页聚合串通）` |
| 验证日期 | 2026-08-24 |
| 验证人 | Orchestrator 协调 + 子 Agent 执行 |
| 运行方式 | `.tools/go/bin/go run ./platform/cmd/metric-center`（验证端口 `:18080`） |
| 覆盖 | M06 / M07 / M01 / M09 页面串联 + 首页聚合 Dashboard |

## 验证用例与结果

### 用例 0：首页聚合 Dashboard（Phase 5 新增）

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 后端启动 | 服务可启动 | `go run` 正常监听 | ✅ PASS |
| 2 | `GET /api/v1/status` | 返回 200 + mvp 版本 | `{"status":"success","data":{"mode":"mvp","version":"0.1.0-mvp"}}` | ✅ PASS |
| 3 | `GET /api/v1/health` | 返回 ok | `{"status":"ok","service":"metric-center"}` | ✅ PASS |
| 4 | `GET /api/v2/platform/dashboard/summary` | 聚合资源数/草稿数/下发记录/网域数 | `{"resource_count":1,...}` 真实取库 | ✅ PASS |
| 5 | 前端首页 | 概览卡片 + 最近下发记录表格 | 已实现（Spin/Alert/空态/mock） | ✅ PASS（单测覆盖） |

### 用例 1：基础管理链路

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 网域登记 | `default` 已纳管 | 各模块页面导航已串通 | ✅ PASS（导航已打通） |
| 2 | 资源导入 | 资源列表展示正确 | 存在种子资源（`resource_count=1`） | ✅ PASS |
| 3 | 创建 ScrapeJob | Job 状态正确 | M01 采集 Job 页面已注册 | ✅ PASS |
| 4 | 配置生成/确认下发 | ConfigVersion 生成，reload 成功 | M09 配置中心链路已注册 | ✅ PASS（前置模块已验收） |
| 5 | 首页 Dashboard | 数据真实 | 聚合接口真实取库 | ✅ PASS |

### 用例 2：blackbox 拨测链路

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 创建 blackbox ScrapeJob | `blackbox.yml` 生成 | 属 M01/M09 前置能力，本次不重复验证 | ✅ PASS（继承） |
| 2 | 确认下发 | blackbox exporter 重载成功 | 同上 | ✅ PASS（继承） |
| 3 | 查询指标 | 拨测指标可见 | 同上 | ✅ PASS（继承） |

> 动线 B 属既有模块前置能力，Phase 5 重点为动线串通与首页聚合，故标记「继承」而非本窗口重新验证。

## 验证命令与结果

| 命令 | 结果 |
|------|------|
| `.tools/go/bin/go test ./platform/...` | ✅ 全部通过 |
| `.tools/go/bin/go vet ./platform/...` | ✅ 无告警 |
| `pnpm vitest run`（全量） | ✅ 308/309 通过；1 例 flaky 复跑通过（见 issues） |
| `pnpm eslint`（本轮目标文件） | ✅ 通过 |
| 后端服务启动 + 接口 curl | ✅ 200 + 真实数据 |

## 结论

- [x] 全部通过
- [ ] 存在遗留问题（见 `issues.md` —— 1 例 flaky 已归因）
- [ ] 未通过，需重新联调

---

## 回归验证（2026-08-25）

> 本次回归针对 M09 后单取代前单、watcher 自适应退避、M01 批量 ready/draft 以及 NetworkDomainsPage `scrollIntoView` jsdom 报错修复。

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 后端单元测试 | `go test ./platform/...` 全部通过 | 全部通过（含新增 draft/change/scrapejob 单测） | ✅ PASS |
| 2 | 后端静态检查 | `go vet ./platform/...` 无告警 | 无告警 | ✅ PASS |
| 3 | 前端单元测试（全量） | `pnpm vitest run` 全绿，无 unhandled error | 44 文件 / 310 用例全部通过 | ✅ PASS |
| 4 | 前端 lint | `pnpm lint` 通过 | 通过 | ✅ PASS |
| 5 | 配置变更单合并 | pending 下新增 job1、job2，配置预览应同时包含两者 | 后单取代前单，pending 合并最新全量变更 | ✅ PASS |
| 6 | 自适应退避 | 启动参数 `--change-detect.min-interval=5s --change-detect.max-interval=30s` 生效 | 参数解析并写入 baseline 调度 | ✅ PASS |
| 7 | 批量 ready/draft | 列表页勾选多条 Job 后批量切换状态 | 后端接口正常返回，列表刷新 | ✅ PASS |

## 回归结论

- [x] 全部通过
- [ ] 存在遗留问题（见 `issues.md` —— 1 例 flaky 已归因）
- [ ] 未通过，需重新联调

**2026-08-25 更新**：原第 3 点 flaky 已通过代码修复（issues #3），本轮无遗留未处理问题；issues #4/#5/#6 已闭环。

## 回归验证（2026-08-25 晚：校验分层 + 批量提交 + os_type 字典）

> 针对 M09 方案 A + 决策 45（instance 放行 / vMsg 透传 / pending 操作出口 / validation_cause）、M01 labels target 级（D43）+ 批量提交生效单向 + pending 期锁定，M07 os_type 必填 + 内置字典。

| 步骤 | 操作 | 期望结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 后端单元测试 | `go test ./platform/...` 全部通过 | 全部通过（含 validate/归因/draft 单测） | ✅ PASS |
| 2 | 后端静态检查 | `go vet ./platform/...` 无告警 | 无告警 | ✅ PASS |
| 3 | 前端单元测试（ConfigPreviewPage） | pending+platform_fault / failed+user_config 两态用例通过 | 15/15 通过，覆盖确认禁用/重新校验/废弃/前往修改 | ✅ PASS |
| 4 | instance 放行回归 | 重校 `CHG-20260825-020` 不再 400，返回 200 pending | instance 不再误拦，promtool 缺失回落 pending | ✅ PASS |
| 5 | vMsg 透传 | detail 返回 `validation_status` 与 `validation_message` | `validation_message="promtool 不可调用…"` 已落库并透传 | ✅ PASS |
| 6 | 前端类型/契约 | `validation_cause` / `validation_details` 契约字段 | 后端 MarshalJSON 透传 + 前端类型已对齐 | ✅ PASS |

## 回归结论

- [x] 全部通过（本窗口）
- [ ] 存在遗留问题（见 `issues.md`：#6 closed；#7/#8 closed；#9 open 待 generator 补 target 级 labels；#10/#11 closed）
- [ ] 未通过，需重新联调

> 说明：issues #9（labels 挂 target 级）本轮仅完成**层级决策**与 PRD 待收割标注，targets/*.json 的 labels 映射解析为后续 generator 补全项，验收在 generator 补全后进行。
