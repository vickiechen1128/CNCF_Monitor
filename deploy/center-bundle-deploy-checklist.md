# MetricCenter 中心交付包 · 部署清单（Ubuntu / linux-amd64）

> 适用产物：`metric-center-bundle-linux-amd64-20260904-112307.tar.gz`（首个含 promtool/amtool 的完整包；
> 此前的 095100 / 111118 缺 promtool/amtool，M08/M09 草稿校验会 pending，请勿再使用）
> 生成命令：`CROSS=linux/amd64 WITH_ALERTMANAGER=1 WITH_BLACKBOX=1 make package-center`
> 来源分支：`feat/module-08-alert-dispatch`（M08 告警分发，含 alertmanager + blackbox_exporter）
> 产物大小：约 176 MB，全部二进制为 `ELF 64-bit LSB executable, x86-64`（linux/amd64）；其中 promtool / amtool / blackbox_exporter / prometheus / alertmanager 静态链接，metric-center 动态链接（需 glibc ≥ 2.28，Ubuntu 24.04 自带 2.39）

---

## 1. 传输到目标服务器
```bash
scp dist/metric-center-bundle-linux-amd64-20260904-112307.tar.gz <user>@<ubuntu-ip>:/opt/metric-center/
```

## 2. 解压
```bash
ssh <user>@<ubuntu-ip> 'cd /opt/metric-center && tar -xzf metric-center-bundle-linux-amd64-20260904-112307.tar.gz'
cd /opt/metric-center/metric-center-bundle-linux-amd64-20260904-112307
```

## 3. 目录结构（解压后）
```
metric-center-bundle-linux-amd64-20260904-112307/
├── bin/
│   ├── metric-center        # 控制面（动态链接，需 glibc ≥ 2.28，24.04 自带 2.39）
│   ├── prometheus           # Prometheus（静态链接，Web UI 内嵌）
│   ├── promtool             # M09 草稿校验依赖（exec.LookPath，由 start.sh PATH 命中）
│   ├── alertmanager         # Alertmanager（M08，静态链接）★
│   ├── amtool               # M08 AM 配置挂载校验依赖（★ 随 AM 启用）★
│   └── blackbox_exporter    # Blackbox 探测（静态链接）★
├── config/
│   ├── metric-center.yml          # 控制面示例配置
│   ├── prometheus.yml.example
│   ├── prometheus/
│   ├── alertmanager.yml           # M08 AM 配置，开箱即用 ★
│   ├── alertmanager.yml.example   # 默认模板，误改后可恢复 ★
│   ├── blackbox.yml               # M01/M09 拨测模块种子，开箱即用 ★
│   └── blackbox.yml.example       # 默认模板，误改后可恢复 ★
├── scripts/
│   ├── start.sh                   # 一键启动（已含 AM 段，见第 4 节）
│   └── stop.sh                    # 通用停止：遍历 logs/*.pid，自动覆盖 AM
└── web/ui-custom/           # Custom UI 静态资源（相对路径，随访问 IP 自适应）
```
★ = 因 `WITH_ALERTMANAGER` / `WITH_BLACKBOX` 带入。AM 配置文件与启动段已由
`scripts/package-center.sh` 自动写入，**无需手工补齐**（详见第 6 节）。

## 4. 启动（一键：prometheus + alertmanager + blackbox_exporter + metric-center）
```bash
./scripts/start.sh
```
- 启动 `prometheus` → `:9090`（`--web.enable-lifecycle` 已开，支持 `/-/reload`）
- 启动 `alertmanager` → `:9093`（M08；仅 `WITH_ALERTMANAGER=1` 打包时存在，读取 `config/alertmanager.yml`）
- 启动 `blackbox_exporter` → `:9115`（M01/M09；仅 `WITH_BLACKBOX=1` 打包时存在，读取 `config/prometheus/blackbox.yml`）
- 启动 `metric-center` → `:8080`（通过 `--web.static-dir` 托管 UI + API 同源）
  并自动追加 `--config.dir=$ROOT/config/prometheus`，使 M09 下发的 prometheus.yml、
  targets/*.json、blackbox.yml 全部落在 Prometheus 正在读取的目录；同时随包启用 AM 时追加
  `--config.am-dir=$ROOT/config --config.am-reload-url=http://127.0.0.1:9093/-/reload`，
  使 M08 下发的 alertmanager.yml 直接落盘到 AM 正在读取的文件并触发 reload，无需手工干预。

## 5. 验证
```bash
curl -s http://<ip>:8080/api/v1/health        # 期望 {"status":"success",...}
curl -s http://<ip>:9090/-/ready              # Prometheus 就绪
curl -s http://<ip>:9093/-/ready              # Alertmanager 就绪（M08）
curl -s http://<ip>:9115/-/healthy            # blackbox_exporter 就绪（WITH_BLACKBOX=1）
cat logs/*.pid                                 # 进程 PID（含 logs/alertmanager.pid / blackbox_exporter.pid）
ls bin/promtool bin/amtool                      # M09/M08 草稿校验依赖，须存在；否则校验会 pending
```
浏览器访问：
- Custom UI：    http://<ip>:8080
- Prometheus UI：http://<ip>:9090
- Alertmanager： http://<ip>:9093（M08）
- Blackbox：     http://<ip>:9115（M01/M09）
- MetricCenter API：http://<ip>:8080/api

## 6. M08 告警分发（已自动化，无需手工补齐）
`scripts/package-center.sh` 已增强：`WITH_ALERTMANAGER=1` 打包时自动完成三件事——
1. 写入 `config/alertmanager.yml`（＋ `.example` 模板；种子来自 `deploy/alertmanager/alertmanager.yml`，缺失时生成最小兜底）；
2. 在 `start.sh` 注入 `:9093` 启动段，并写出 `logs/alertmanager.pid`；
3. 给 `metric-center` 追加 `--config.am-dir` / `--config.am-reload-url`。

因此**解压后直接 `./scripts/start.sh` 即完成 M08 一键启动**；`stop.sh` 遍历 `logs/*.pid`，会一并停止 AM。
未传 `WITH_ALERTMANAGER` 时这三件全部跳过（`AM_ARGS=""`），默认（MVP）包行为不变。

排查时如需单独拉起 AM：
```bash
mkdir -p data/alertmanager
nohup ./bin/alertmanager \
  --config.file="$PWD/config/alertmanager.yml" \
  --storage.path="$PWD/data/alertmanager" \
  --web.listen-address=:9093 \
  > logs/alertmanager.log 2>&1 &
echo $! > logs/alertmanager.pid
```

## 6.1 M01/M09 拨测（Blackbox exporter，已自动化，无需手工补齐）
`scripts/package-center.sh` 已增强：`WITH_BLACKBOX=1` 打包时自动完成三件事——
1. 写入 `config/blackbox.yml`（＋ `.example` 模板；种子来自 `upstream/blackbox_exporter/blackbox.yml`）；
2. 在 `start.sh` 注入 `:9115` 启动段，并写出 `logs/blackbox_exporter.pid`；
3. 给 `metric-center` 追加 `--config.dir=$ROOT/config/prometheus`，保证 M09 下发的
   `blackbox.yml` 与 `prometheus.yml`、`targets/*.json` 落在同一目录；blackbox_exporter 自身通过
   `--config.enable-auto-reload` 自动感知变更，形成闭环。

因此**解压后直接 `./scripts/start.sh` 即完成 blackbox_exporter 一键启动**；`stop.sh` 遍历 `logs/*.pid`，会一并停止 blackbox。
未传 `WITH_BLACKBOX` 时启动段不存在，默认（MVP）包行为不变。

> 注：`--config.dir` 与 blackbox 是否随包无关，任何交付包的 `start.sh` 都会追加它——
> 它修的是 M09 下发目录与 Prometheus 读取目录错位的问题。

排查时如需单独拉起 blackbox：
```bash
[ -f config/prometheus/blackbox.yml ] || cp config/blackbox.yml.example config/prometheus/blackbox.yml
nohup ./bin/blackbox_exporter \
  --config.file="$PWD/config/prometheus/blackbox.yml" \
  --config.enable-auto-reload \
  --web.listen-address=:9115 \
  > logs/blackbox_exporter.log 2>&1 &
echo $! > logs/blackbox_exporter.pid
```

## 7. 防火墙 / 端口
| 端口 | 服务 | 建议暴露 |
|------|------|----------|
| 8080 | UI + API（同源） | 对外 |
| 9090 | Prometheus | 按需（建议仅内网） |
| 9093 | Alertmanager（M08） | 仅内网 |
| 9115 | blackbox_exporter（M01/M09） | 仅内网 |

## 8. 持久化与升级
- `data/`：SQLite（`metric_center.db`）+ Prometheus TSDB + alertmanager 数据
- `logs/`：进程日志与 pid 文件
- 升级：重新打包 → 覆盖 `bin/` 与 `web/`，**保留 `data/`**
- 依赖：`metric-center` 为动态链接（CGO / mattn/go-sqlite3），需目标机 glibc（Ubuntu 默认满足）；
  `prometheus` / `alertmanager` / `blackbox_exporter` 均为静态链接，无额外依赖

## 9. 停止
```bash
./scripts/stop.sh
```
