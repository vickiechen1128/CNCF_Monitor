# M09 中心交付包 blackbox_exporter 启动闭环修复

## 问题

此前 `WITH_BLACKBOX=1` 打包时只把 `blackbox_exporter` 二进制复制进 `bin/`，没有随包种子配置、没有启动段、没有把它加入 PATH，也没有给 `metric-center` 传 `--config.dir`。导致三个后果：

1. 草稿校验时 `generator/validate.go` 通过 `exec.LookPath("blackbox_exporter")` 找不到工具，含 blackbox job 的草稿永远 `pending`。
2. 生成的 `prometheus.yml` 把 blackbox job 的 `__address__` 硬编码为 `127.0.0.1:9115`，但交付包里没人监听 `:9115`，所有 blackbox target 全部 DOWN。
3. 最严重：`metric-center` 默认 `--config.dir=./config-output`，而交付包内 Prometheus 读的是 `$ROOT/config/prometheus/prometheus.yml`，file_sd 的 `targets/*.json` 也相对该目录解析。M09 本地下发写盘位置与读取位置不一致，整个下发链路在交付包场景失效，不止 blackbox。

## 改动

只改 `scripts/package-center.sh` 与 `deploy/center-bundle-deploy-checklist.md`，控制面 Go 代码零改动。

### scripts/package-center.sh

1. **种子配置**：`WITH_BLACKBOX=1` 时把 `upstream/blackbox_exporter/blackbox.yml` 复制为 `config/blackbox.yml` + `config/blackbox.yml.example`（缺失时生成最小兜底）。
2. **启动段**：`start.sh` 中注入 blackbox_exporter 启动命令：
   ```bash
   ./bin/blackbox_exporter \
       --config.file="$ROOT/config/prometheus/blackbox.yml" \
       --config.enable-auto-reload \
       --web.listen-address=:9115
   ```
   并写出 `logs/blackbox_exporter.pid`，`stop.sh` 自动覆盖。
3. **PATH**：`start.sh` 开头统一 `export PATH="$ROOT/bin:$PATH"`，同时解决 promtool / amtool / blackbox_exporter 的 `LookPath` 校验。
4. **`--config.dir`**：给 `metric-center` 追加 `--config.dir="$ROOT/config/prometheus"`，让 M09 下发的 `prometheus.yml`、`targets/*.json`、`blackbox.yml` 全部落在 Prometheus 实际读取的目录，修复交付包下发链路错位。
5. **README**：随包 README 条件注入 Blackbox 访问地址与 M01/M09 说明段。

### deploy/center-bundle-deploy-checklist.md

- 目录结构增加 `config/blackbox.yml` 与 `.example`。
- 启动与验证章节补充 `:9115` 与 `/-/healthy`。
- 防火墙端口表修正 `9091` → `9115`（原 typo）。
- 新增第 6.1 节「M01/M09 拨测（Blackbox exporter）」，说明三件自动化事项与单独拉起命令。

## 决策

- **不新增 `--config.blackbox-dir` flag**：blackbox.yml 本来就是 `DiskApplier` 写进 `config.dir` 的结构文件之一，沿用单一目录语义足够；独立目录 flag 只在边缘/异地部署场景有意义，MVP 不加。
- **使用 `--config.enable-auto-reload` 而非主动触发 blackbox reload**：blackbox_exporter 自身支持 30s 轮询自动重载，控制面无需新增 reload URL，实现最简。注意该 flag 默认关闭，start.sh 显式传入。
- **选择把 `--config.dir` 指向 `$ROOT/config/prometheus`（方案 A）**：与 AM 修复约定一致、与交付包 `config/` 布局一致、且只是 start.sh 参数变更，不影响 dev 态 `make run-*` 的默认行为。

## 第二轮：promtool / amtool 缺口（2026-09-04 补）

第一轮修复只解决了 blackbox 自身，复核时又发现一个直接影响**控制面校验**的缺口：

- `Makefile:282-291` 的 `build-promtool` / `build-amtool` 注释明说：M09 草稿校验靠 `exec.LookPath("promtool")` / `LookPath("blackbox_exporter")`，M08 AM 配置挂载校验靠 `LookPath("amtool")`——这些校验跑在**部署服务器的控制面进程内**。
- 但原 `package-center.sh` 只拷主二进制，`promtool` / `amtool` 根本没进包。即使 start.sh 已 `export PATH="$ROOT/bin:$PATH"`，`bin/` 里没有这两个二进制，M08/M09 草稿校验会一直 `pending`。

**修复**（与 blackbox 同构，只改 `scripts/package-center.sh`）：

- `build_optional()`：**常构建 promtool**（`upstream/prometheus/cmd/promtool`，M09 校验是核心功能、与 WITH_* 开关无关）；`WITH_ALERTMANAGER` 时构建 `amtool`（`upstream/alertmanager/cmd/amtool`）。交叉编译路径均走 `CGO_ENABLED=0 GOOS/GOARCH`；非交叉路径分别走 `make build-promtool` / `make build-alertmanager`（后者已在 Makefile:322 顺带产出 amtool）。
- `collect_bundle()`：常拷 `bin/promtool`；`AM_ENABLED` 时拷 `bin/amtool`；缺失时打印 WARNING 而非静默跳过。

## 重打产物与验证状态

- 新包：`dist/metric-center-bundle-linux-amd64-20260904-112307.tar.gz`（171 MB）。
  生成命令：`CROSS=linux/amd64 WITH_ALERTMANAGER=1 WITH_BLACKBOX=1 bash scripts/package-center.sh`（macOS + zig 0.16.0 交叉编译）。
- **已核验**：包内 `bin/` 共 6 个二进制（metric-center / prometheus / promtool / alertmanager / amtool / blackbox_exporter），`file` 确认全部 ELF x86-64（metric-center 动态链接，其余静态）；`config/` 含 blackbox.yml 种子；`start.sh` 语法检查通过且含全部启动段。
- **未真实验证（重要）**：以上仅为 macOS 构建机上的文件级核验，**尚未在 Ubuntu 24.04 目标机上实际解压运行**。`metric-center` 是动态链接（CGO / mattn/go-sqlite3），依赖目标机 glibc（Ubuntu 24.04 自带 glibc 2.39，理论满足，但未实测）。完整验证须按下方清单在 Ubuntu 上执行。

## 验证建议

1. 使用新包 `metric-center-bundle-linux-amd64-20260904-112307.tar.gz`（旧包 095100 / 111118 缺 promtool/amtool，勿用）。
2. 在目标机解压后 `./scripts/start.sh`，检查：
   - `curl -s http://<ip>:9115/-/healthy` 返回 200
   - `cat logs/blackbox_exporter.pid` 存在
   - `bin/promtool check config config/prometheus/prometheus.yml` 本机可执行（确认 PATH 命中）
   - 控制面能正常完成含 blackbox job 的草稿校验（先废弃旧 pending 单再重新触发）
   - 下发后在 `config/prometheus/` 下看到 `blackbox.yml` 被更新，blackbox target 最终变为 UP
