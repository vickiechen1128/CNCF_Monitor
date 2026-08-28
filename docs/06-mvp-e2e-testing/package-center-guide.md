# MVP 中心一体化交付包打包指导

> 目标：把 MetricCenter MVP（`metric-center` + `prometheus` + Custom UI）打包成可在 Ubuntu 服务器上直接运行的离线产物，并把产物保留在 `dist/` 目录下。
>
> 关联文档：
> - `Makefile` 中的 `package-center` / `build-center` / `build-all` 目标
> - `scripts/package-center.sh`
> - `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`
> - `docs/06-mvp-e2e-testing/README.md`

---

## 1. 打包脚本说明

项目已新增 `scripts/package-center.sh`，并在 `Makefile` 中注册为 `make package-center`。脚本默认生成：

```text
dist/metric-center-bundle-<os>-<arch>-<timestamp>.tar.gz
dist/metric-center-bundle-<os>-<arch>-<timestamp>/   # 解压后的目录
```

包内结构（MVP 最小集）：

```text
metric-center-bundle-linux-amd64-20260828-170905/
├── bin/
│   ├── metric-center          # MetricCenter 控制面二进制（Go + CGO/SQLite）
│   └── prometheus             # Prometheus 数据面二进制
├── config/
│   ├── metric-center.yml      # 控制面配置示例
│   └── prometheus.yml.example # Prometheus 种子配置（来自 deploy/prometheus/prometheus.yml）
├── scripts/
│   ├── start.sh               # 一键启动 metric-center + prometheus
│   └── stop.sh                # 优雅停止
├── web/
│   ├── ui/                    # Prometheus Web UI 静态资源
│   └── ui-custom/             # Custom UI 构建产物
└── README.md                  # 包内快速开始说明
```

> MVP 默认不包含 `alertmanager` 和 `blackbox_exporter`。如需打包，可在调用时加环境变量 `WITH_ALERTMANAGER=1` / `WITH_BLACKBOX=1`。

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

访问：

- **Custom UI：http://127.0.0.1:5173**
- Prometheus UI：http://127.0.0.1:9090
- MetricCenter API：http://127.0.0.1:8080
- 健康检查：http://127.0.0.1:8080/api/v1/health

> `start.sh` 会自动用 `python3 -m http.server` 在 5173 端口提供前端静态资源；前端构建时已注入 `VITE_API_BASE_URL=http://127.0.0.1:8080`，页面内的 API 请求会直接打到本机 8080 的 `metric-center`。

停止：

```bash
./scripts/stop.sh
```

---

## 3. 在 macOS 上交叉编译为 Ubuntu 产物

如果打包机是 macOS，可以通过 `zig` 作为交叉 C 工具链完成 CGO 交叉编译。

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
- `prometheus`：`CGO_ENABLED=0` 静态链接，无额外动态库依赖。
- 静态资源（Prometheus Web UI + Custom UI）已正确收集到 `web/` 目录。

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

# 2. 静态资源完整
ls web/ui/static/mantine-ui/index.html
ls web/ui-custom/index.html

# 3. 启动脚本可执行
chmod +x scripts/start.sh scripts/stop.sh

# 4. 启动并检查健康/前端
./scripts/start.sh
curl -s http://127.0.0.1:8080/api/v1/health | jq .
curl -s http://127.0.0.1:9090/-/reload -o /dev/null -w '%{http_code}\n'
curl -s http://127.0.0.1:5173 | head -1   # 期望返回 HTML
```

---

## 6. 与 `make build-center` 的区别

| 命令 | 输出 | 用途 |
|------|------|------|
| `make build-center` | 只生成二进制（散落源码目录） | 开发期快速验证 |
| `make package-center` | 生成 `dist/*.tar.gz` 完整离线包 | 测试/交付/保留产物 |

---

## 7. 已知注意事项

1. **必须本机构建或使用 zig 交叉**：`metric-center` 的 SQLite 驱动依赖 CGO，不能直接用 `GOOS=linux go build` 在 macOS 上完成。
2. **Prometheus Web UI 静态资源**：启动脚本要求从包根目录启动，以确保 Prometheus 能读取 `web/ui/static`。
3. **首次启动会自动 seed 配置**：`start.sh` 会在 `config/prometheus/` 下复制示例配置，无需手动准备。
4. **数据目录会生成在包内**：运行后会出现 `data/`（SQLite + TSDB）和 `logs/`，如需持久化，建议把包部署到固定目录。
