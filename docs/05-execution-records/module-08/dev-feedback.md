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
- **状态**：closed（代码已修复；运行侧恢复步骤：确保 `make run-alertmanager` 已拉起 :9093，再 `make run-metric-center` 重启后端使新二进制生效）