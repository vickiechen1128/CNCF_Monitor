# MVP 中心一体化交付包打包指导

> 目标：把 MetricCenter MVP 中心一体化交付包（**`metric-center` + `prometheus` + `alertmanager` + `blackbox_exporter` + Custom UI** 五件套）打包成可在 Ubuntu 服务器上直接运行的离线产物，并把产物保留在 `dist/` 目录下。
>
> 组件随包策略（与 `scripts/package-center.sh` 一致）：
> - **默认随包**：`metric-center`、`prometheus`、`promtool`（M09 草稿校验依赖）、Custom UI；
> - **`WITH_ALERTMANAGER=1` 时随包**：`alertmanager` + `amtool`（M08 AM 配置挂载校验依赖）+ `config/alertmanager.yml`（决策 60 下发落点）；
> - **`WITH_BLACKBOX=1` 时随包**：`blackbox_exporter` + `config/blackbox.yml`（M01/M09 拨测）。
>
> MVP 全量动线（含 M08 挂载下发、拨测）验证建议两者都带上。二进制编译等价命令为 `make build-center`（五件套全量编译，产物散落源码目录，供开发期验证）。
>
> 关联文档：
> - `Makefile` 中的 `package-center` / `build-center` / `build-all` 目标
> - `scripts/package-center.sh`
> - `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`
> - `docs/06-mvp-e2e-testing/README.md`
> - `docs/06-mvp-e2e-testing/frontend-backend-deploy-topology.md`（前端访问后端的拓扑决策：当前 A2、未来 nginx 反代）

---

## 1. 打包脚本说明

项目已新增 `scripts/package-center.sh`，并在 `Makefile` 中注册为 `make package-center`。脚本默认生成：

```text
dist/metric-center-bundle-<os>-<arch>-<timestamp>.tar.gz
dist/metric-center-bundle-<os>-<arch>-<timestamp>/   # 解压后的目录
```

包内结构（标注 `[WITH_*]` 的条目仅在对应环境变量开启时注入；Prometheus Web UI 已通过 `builtinassets` 编译进 prometheus 二进制，不再以静态文件随包）：

```text
metric-center-bundle-linux-amd64-<timestamp>/
├── bin/
│   ├── metric-center          # MetricCenter 控制面二进制（Go + CGO/SQLite）
│   ├── prometheus             # Prometheus 数据面二进制（Web UI 内嵌）
│   ├── promtool               # M09 草稿校验依赖（exec.LookPath("promtool")），随包常驻
│   ├── amtool                 # [WITH_ALERTMANAGER] M08 AM 配置挂载校验依赖
│   └── blackbox_exporter      # [WITH_BLACKBOX] M01/M09 拨测探测端
├── config/
│   ├── metric-center.yml      # 控制面配置示例
│   ├── prometheus.yml.example # Prometheus 种子配置（来自 deploy/prometheus/prometheus.yml）
│   ├── alertmanager.yml(.example)  # [WITH_ALERTMANAGER] M08 下发落点，与 AM --config.file 同一份
│   └── blackbox.yml(.example)      # [WITH_BLACKBOX] 拨测模块种子配置
├── scripts/
│   ├── start.sh               # 一键启动全部随包组件（:9090 prometheus，[:9093 alertmanager]，[:9115 blackbox_exporter]，:8080 metric-center）
│   └── stop.sh                # 优雅停止（遍历 logs/*.pid，覆盖全部随包组件）
├── web/
│   └── ui-custom/             # Custom UI 构建产物（由 metric-center --web.static-dir 托管）
└── README.md                  # 包内快速开始说明（含 M08/M09 段落，按 WITH_* 注入）
```

> 闭环要点：`alertmanager.yml` / `blackbox.yml` 随包预置后，M08 下发的 `alertmanager.yml` 与 M09 下发的 `blackbox.yml` 会写入组件正在读取的同一份文件（start.sh 已为 metric-center 注入 `--config.am-dir` / `--config.dir`，blackbox_exporter 带 `--config.enable-auto-reload`），形成「平台下发 → 组件生效」闭环。

---

## 2. 推荐：在 Ubuntu 上直接构建（最可靠）

由于 `metric-center` 依赖 CGO（`mattn/go-sqlite3`），**最可靠的做法是在 Ubuntu 本机执行打包**，避免交叉编译工具链的兼容性问题。

### 2.1 前置依赖

```bash
sudo apt-get update
sudo apt-get install -y make git curl build-essential
```

### 2.2 初始化仓库并打包

```bash
cd /path/to/CNCF_Monitor

# 一键安装 Go / Node.js / pnpm 到 .tools/，并初始化子模块
bash setup.sh

# 生成本地 Ubuntu 产物并保留在 dist/
make package-center

# 全量 MVP 产物（含 Alertmanager + blackbox_exporter，M08 挂载下发与拨测可闭环）
WITH_ALERTMANAGER=1 WITH_BLACKBOX=1 make package-center
```

产物示例：

```text
dist/metric-center-bundle-linux-amd64-20260828-170905.tar.gz
```

### 2.3 运行产物

```bash
cd dist
tar -xzf metric-center-bundle-linux-amd64-*.tar.gz
cd metric-center-bundle-linux-amd64-*/
./scripts/start.sh
```

访问（把 `<服务器IP>` 换成部署机实际可达的 IP 或域名，本机访问可用 `127.0.0.1`）：

- **Custom UI：http://<服务器IP>:8080**（UI 与 API 同源，单端口）
- Prometheus UI：http://<服务器IP>:9090
- Alertmanager：http://<服务器IP>:9093（仅 `WITH_ALERTMANAGER=1` 产物）
- Blackbox exporter：http://<服务器IP>:9115（仅 `WITH_BLACKBOX=1` 产物）
- MetricCenter API：http://<服务器IP>:8080/api
- 健康检查：http://<服务器IP>:8080/api/v1/health

> 前端产物由 `metric-center` 通过 `--web.static-dir` 直接托管（部署拓扑方案 A2），不再单独起 5173 静态服务。构建时**不注入** `VITE_API_BASE_URL`，页面内 API 请求走相对路径，自适应当前访问的 IP / 域名——同一份产物可部署到任意机器，无需重新打包，也无跨域问题。详见 `docs/06-mvp-e2e-testing/frontend-backend-deploy-topology.md`。

停止：

```bash
./scripts/stop.sh
```

---

## 3. 在 macOS 上交叉编译为 Ubuntu 产物

如果打包机是 macOS，可以通过 `zig` 作为交叉 C 工具链完成 CGO 交叉编译。

> ⚠️ **副作用提示（交叉打包会覆盖本机二进制）**：`CROSS=linux/amd64 make package-center` 会把源码目录里的本机二进制**覆盖为目标平台 ELF**（`platform/cmd/metric-center/metric-center`、`upstream/prometheus/prometheus`、`upstream/prometheus/promtool`、`upstream/alertmanager/{alertmanager,amtool}`、`upstream/blackbox_exporter/blackbox_exporter`），覆盖后 macOS 本地不能再直接运行这些二进制。恢复方法：在 macOS 上重跑一次原生 `make build-center` 即可。
>
> 定位说明：`package-center` 用于**产出放到 Ubuntu 环境执行测试/交付的安装包**，不属于 macOS 本地开发流程；本地开发验证用 `make run-*` / `make build-*` 原生编译即可。

### 3.1 安装 zig

```bash
brew install zig
```

Ubuntu 上安装 zig（如需要）：

```bash
snap install zig --classic
```

### 3.2 执行交叉打包

```bash
cd /path/to/CNCF_Monitor

# 先初始化工具链
bash setup.sh

# 交叉编译为 Ubuntu x86_64 产物
CROSS=linux/amd64 make package-center

# 交叉编译全量 MVP 产物
CROSS=linux/amd64 WITH_ALERTMANAGER=1 WITH_BLACKBOX=1 make package-center
```

产物示例：

```text
dist/metric-center-bundle-linux-amd64-20260828-170905.tar.gz
```

### 3.3 实测验证（macOS arm64 → Ubuntu x86_64）

在 macOS arm64 机器上执行：

```bash
CROSS=linux/amd64 make package-center
```

已验证结果：

```bash
$ file dist/metric-center-bundle-linux-amd64-*/bin/*
dist/metric-center-bundle-linux-amd64-*/bin/metric-center: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 2.0.0
dist/metric-center-bundle-linux-amd64-*/bin/prometheus:    ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked
```

- `metric-center`：通过 zig 完成 CGO 交叉编译，运行时依赖标准 glibc：`/lib64/ld-linux-x86-64.so.2`、`libc.so.6`、`libdl.so.2`、`libpthread.so.0`。Ubuntu 22.04/24.04 均自带。
- `prometheus`：`CGO_ENABLED=0` 静态链接，无额外动态库依赖；Prometheus Web UI 静态资源通过 `-tags builtinassets` 内嵌进二进制，交付包自包含。
- Custom UI 构建产物已正确收集到 `web/ui-custom/`；随包组件（alertmanager / blackbox_exporter，若开启对应 `WITH_*`）同样为静态链接 ELF。

> 注意：脚本默认使用 `https://goproxy.io,direct` 作为 Go 代理。若你的网络无法访问 `proxy.golang.org` 且 `goproxy.io` 也不可用，请设置自己的代理后再打包，例如 `GOPROXY=https://your-proxy,direct make package-center`。

### 3.4 常见限制

- `metric-center` 必须使用 zig 做交叉 C 编译；Prometheus / UI 静态资源不依赖 CGO，可普通交叉编译。
- 如果 zig 不可用，脚本会明确报错并给出安装提示。
- 交叉编译产物建议上传到 Ubuntu 环境后执行 `file bin/metric-center` 确认格式为 `ELF 64-bit`，并运行 `./scripts/start.sh` 做最终验证。

---

## 4. 产物保留建议

### 4.1 本地保留

`dist/` 目录已加入 `.gitignore`，不会被提交到 Git，适合作为本地产物仓库：

```bash
# 保留最近 5 个版本的产物，其余清理
ls -lt dist/*.tar.gz | tail -n +6 | awk '{print $NF}' | xargs -r rm
```

### 4.2 CI/CD 留存

推荐在 CI 中把产物作为 artifact 上传：

```yaml
# GitHub Actions 示例片段
- name: Build MVP bundle
  run: make package-center
- uses: actions/upload-artifact@v4
  with:
    name: metric-center-bundle-${{ runner.os }}-${{ runner.arch }}
    path: dist/*.tar.gz
```

### 4.3 版本命名

产物名已自动包含 `os-arch-timestamp`。如需追加版本号，可覆盖 `BUNDLE_NAME`：

```bash
BUNDLE_NAME=metric-center-mvp-v0.1.0-linux-amd64 make package-center
```

---

## 5. 验证清单

打包完成后，建议按以下清单确认产物可用：

```bash
cd dist/metric-center-bundle-linux-amd64-*/

# 1. 二进制格式正确
file bin/metric-center   # 期望 ELF 64-bit
file bin/prometheus    # 期望 ELF 64-bit
# 全量产物（WITH_*）额外确认：
file bin/alertmanager      # 期望 ELF 64-bit
file bin/blackbox_exporter # 期望 ELF 64-bit

# 2. 静态资源完整（Prometheus Web UI 已内嵌二进制，只需查 Custom UI）
ls web/ui-custom/index.html

# 3. 启动脚本可执行
chmod +x scripts/start.sh scripts/stop.sh

# 4. 启动并检查健康/前端（UI 与 API 同为 8080）
./scripts/start.sh
curl -s http://127.0.0.1:8080/api/v1/health | jq .
curl -s http://127.0.0.1:8080/ | head -1           # 期望返回 HTML（index.html）
curl -s http://127.0.0.1:8080/resources | head -1  # 子路由刷新同样返回 HTML，不应 404
curl -s http://127.0.0.1:8080/api/v9/unknown | jq .  # 未注册 API 返回 JSON 错误，不返回 HTML
curl -s http://127.0.0.1:9090/-/reload -o /dev/null -w '%{http_code}\n'
# 全量产物（WITH_*）额外确认：
curl -s http://127.0.0.1:9093/-/ready -o /dev/null -w '%{http_code}\n'   # Alertmanager
curl -s http://127.0.0.1:9115/     -o /dev/null -w '%{http_code}\n'   # Blackbox exporter

# 5. 非本机浏览器验证（关键回归点）
# 在另一台电脑访问 http://<服务器IP>:8080/ ，DevTools 中确认 API 请求地址为
# http://<服务器IP>:8080/api/...（相对路径自适应），状态 200，无 ERR_CONNECTION_REFUSED。
```

---

## 6. 与 `make build-center` 的区别

| 命令 | 输出 | 用途 |
|------|------|------|
| `make build-center` | 五件套二进制（metric-center + prometheus + alertmanager + blackbox_exporter + UI 产物，散落源码目录） | 开发期快速验证 |
| `make package-center` | 生成 `dist/*.tar.gz` 完整离线包（默认最小集；`WITH_ALERTMANAGER=1` / `WITH_BLACKBOX=1` 扩为全量五件套） | 测试/交付/保留产物 |

---

## 7. 已知注意事项

1. **必须本机构建或使用 zig 交叉**：`metric-center` 的 SQLite 驱动依赖 CGO，不能直接用 `GOOS=linux go build` 在 macOS 上完成。
2. **Prometheus Web UI 已内嵌二进制**：`build-prometheus` 通过 `-tags builtinassets` 把 `web/ui/static` 编译进 prometheus，交付包无需附带静态文件，也不再要求从特定目录启动 Prometheus。
3. **首次启动会自动 seed 配置**：`start.sh` 会在 `config/prometheus/` 下复制示例配置（含 `WITH_BLACKBOX` 时的 `blackbox.yml`），无需手动准备。
4. **数据目录会生成在包内**：运行后会出现 `data/`（SQLite + TSDB + Alertmanager storage）和 `logs/`，如需持久化，建议把包部署到固定目录。
5. **M08/M09 闭环依赖随包组件**：`alertmanager.yml` 下发（决策 60）需要 `WITH_ALERTMANAGER=1` 产物，否则 M08 配置挂载校验会因找不到 `amtool`/AM 环境而 pending；拨测下发需要 `WITH_BLACKBOX=1` 产物。
6. **交叉打包后须重建本机二进制**：`CROSS=...` 打包会把源码目录二进制覆盖为 ELF，macOS 本地 `make run-*` 会失败；重跑原生 `make build-center` 恢复（详见 §3 副作用提示）。
