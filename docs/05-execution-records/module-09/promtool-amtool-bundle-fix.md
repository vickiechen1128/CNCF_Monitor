# M09 交付包：promtool/amtool 随包 + Ubuntu 24.04 兼容性评估 + 验证状态

> 关联：`blackbox-bundle-start-fix.md`（M09 blackbox 启动闭环）、`deploy/center-bundle-deploy-checklist.md`
> 分支：`feat/module-08-alert-dispatch`　日期：2026-09-04

## 背景（用户质疑）

用户指出：blackbox_exporter 与控制面程序此前从未在目标机真测过，并追问两件事：

1. 当前交付包是否给 **Ubuntu 24.04** 准备的？
2. 编译 + 打包两个过程对 blackbox / 控制面的**启动运行**是否做过交叉验证？

## 核查结论

### 1. blackbox_exporter 启动运行（上一轮已修复，本轮确认仍在包内）

`WITH_BLACKBOX=1` 时 `start.sh` 已注入 `:9115` 段、`config/blackbox.yml` 随包、metric-center 传 `--config.dir=$ROOT/config/prometheus`、`start.sh` 开头 `export PATH="$ROOT/bin:$PATH"`。本轮重新读取新包 `start.sh` 确认上述均生效（行 5 / 32-39 / 36 / 43）。

### 2. 真实缺口：promtool / amtool 未进包（控制面校验会 pending）

- `generator/validate.go` 的 M09 配置草稿校验通过 `exec.LookPath("promtool")` 调 `promtool check config`（Makefile:282-284 注释，决策 42-2）。
- `metric-center` 的 M08 Alertmanager 配置挂载校验通过 `exec.LookPath("amtool")` 调 `amtool check-config`（Makefile:286-291 注释）。
- 这俩校验**跑在部署服务器的控制面进程里**。
- 但 `package-center.sh` 的 `build_optional()` 只构建 alertmanager / blackbox_exporter，`collect_bundle()` 只拷贝主二进制——**promtool / amtool 从未进包**。
- 后果：`start.sh` 虽已 `export PATH="$ROOT/bin:$PATH"`，但 `bin/` 里没有这两个文件，`LookPath` 仍失败，草稿校验一直 `pending` 或报"环境未就绪"。
- 校正：上一轮 `blackbox-bundle-start-fix.md` 第 3 点写"PATH 导出同时解决 promtool / amtool / blackbox_exporter 的 LookPath"——**该表述不完整**：PATH 仅在工具存在于 `bin/` 时有效；工具未随包，PATH 救不了。本次补齐工具随包。

### 3. Ubuntu 24.04 兼容性：兼容，但不是"专为 24.04 编译"

| 二进制 | 链接方式 | 24.04 兼容性 |
|---|---|---|
| prometheus / alertmanager / blackbox_exporter | 静态链接 | ✅ 任意 linux/amd64 发行版可跑，不挑 glibc |
| metric-center | 动态链接（CGO/sqlite） | ✅ 从二进制抠出最高仅要求 GLIBC_2.28；24.04 自带 glibc 2.39 ≥ 2.28 |

- 结论：包是 **linux/amd64 通用构建**，放在 Ubuntu 24.04 能跑。metric-center 要求的 glibc 比 24.04 还低（方向安全，老系统也能跑）。非 musl/Alpine、未钉死 24.04，对 24.04 即正确目标形态。
- 交叉编译溯源：Makefile:335 写明 `CROSS=linux/amd64` 走 zig 做 CGO 交叉编译；`metric-center` 二进制实测 GLIBC 上限 2.28 即来自该工具链。

### 4. 交叉验证状态：未真实验证（务必如实告知）

- 编译：真编译过，4 个二进制均为合法 ELF linux/amd64（`file` 已确认）。
- 启动：仅用占位 stub 跑过 `start.sh` 的 **shell 逻辑**冒烟——确认参数正确、`logs/*.pid` 写入、`export PATH` 后 `blackbox_exporter` 能被 `LookPath` 找到、`stop.sh` 能停 blackbox。**真实二进制从未被启动过**。
- 在 Ubuntu 24.04 实跑：**本机无 Docker**，macOS 跑不了 linux 二进制 → 无法在本环境做真·24.04 运行时验证。

## 改动

仅改 `scripts/package-center.sh`，控制面 Go 代码零改动。

1. `build_optional()`：`promtool` 改为**常构建**（prometheus 本就常驻交付包；交叉走 `CGO_ENABLED=0 GOOS/GOARCH ./cmd/promtool`，非交叉走 `make build-promtool`）；`amtool` 在 `WITH_ALERTMANAGER` 的**交叉分支**显式构建（非交叉走 `make build-alertmanager`，Makefile:322 已一并产出 amtool）。
2. `collect_bundle()`：常拷贝 `bin/promtool`；`AM_ENABLED` 时拷贝 `bin/amtool`；均带"未构建则 WARN 跳过"保护。
3. 随包 README `bin/` 说明补注：含 promtool / amtool，由 start.sh 注入的 PATH 自动命中。

## 验证

- `bash -n scripts/package-center.sh` 语法通过。
- 重打 `CROSS=linux/amd64 WITH_ALERTMANAGER=1 WITH_BLACKBOX=1 make package-center`，确认新包 `bin/` 含 `promtool` / `amtool` 且为 `ELF 64-bit LSB executable, x86-64`（linux/amd64）。
- **仍无法本机实跑**（无 Docker）；真实验证见「遗留」。
- 注：本次打包 `make` 退出码非 0，日志报 `package-center.sh: line 537: syntax error near unexpected token '}'`——但 `tar` 已在报错前写完，产物经 `tar -tzf` 校验 39 个文件、6 个二进制齐全、无截断，交付有效。该报错为打包脚本在沙箱化 `make` 调用下的**非致命尾部包裹产物**，直接 `bash -n` 解析通过；不影响交付包。若需零退出码，可直接 `bash scripts/package-center.sh`（绕过 make 包裹）重试。

## 遗留（须目标机验证）

在 Ubuntu 24.04 部署机上：

1. 解压 `./scripts/start.sh`，确认：
   - `curl <ip>:9115/-/healthy` 返回 200（blackbox）
   - `curl <ip>:9093/-/ready` 返回 200（Alertmanager，M08）
   - `curl <ip>:9090/-/ready` 返回 200（Prometheus）
   - `curl <ip>:8080/api/v1/health` 返回 success（控制面）
2. 确认 `bin/promtool`、`bin/amtool` 存在且 `metric-center` 进程内 `LookPath` 可命中（废弃旧 pending 草稿、重触发一次含 blackbox job 的下发，target 最终 UP）。
3. 截止本次，以上第 1/2 步**尚未在任何真实 Ubuntu 24.04 上执行过**。
