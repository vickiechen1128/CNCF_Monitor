# Windows 10/11 环境初始化指南（CNCF_Monitor / MetricCenter）

> 适用对象：第一次在 **Windows 10 / 11** 上拉取并初始化本项目的协作者。
> 适用分支：`design/module-mvp-demo`（默认开发分支为 `develop`）。
> 目标：能在本地编译 **MetricCenter 控制面** 与 **上游 Prometheus 源码**，并跑起 Custom UI。
>
> ⚠️ **核心原则：所有工具链都装在项目内的 `.tools/` 目录，跟着仓库走，不污染系统。**
> 仓库根目录的 `Makefile` 已内置 **Windows 分支**（自动检测 `MINGW` / `MSYS` / `CYGWIN`），
> 通过一条 `make install-tools` 把 Go / Node / pnpm / MinGW-w64 全部下载安装到 `.tools/`，
> 且 `export PATH` 只在 `make` 进程内生效，**不会写入系统/用户 PATH**。
> 因此 Windows 与 macOS / Linux 同事的依赖**版本完全一致**（同源 `Makefile` 版本常量）。
>
> ⚠️ **必须在 Git Bash 中执行本文所有命令。** 本项目的 Makefile 使用 `uname`、`curl`、`tar`/`unzip`、`export PATH := ...:$(PATH)` 等 POSIX 工具与语法；PowerShell / CMD 无法正确解析这些指令。

---

## 0. 你当前的状态（排查用）

- `.tools/` 目录**不存在**是正常的——它是 `make install-tools` 的安装目标，且已被 `.gitignore` 忽略，每位协作者首次都要本地装。
- `upstream/prometheus` 与 `upstream/node_exporter` 目前是**空目录**（git 子模块未初始化）。**编译 Prometheus 前必须先拉取子模块。**
- `ui-custom/web/` 已存在且带 `pnpm-lock.yaml`，前端依赖走 `pnpm install` 即可（锁版本）。

---

## 1. 依赖版本（跨平台一致）

| 依赖 | 版本 | 用途 | 安装位置 |
|------|------|------|----------|
| `git` | 任意较新版本 | 克隆 / 子模块 | 系统（Git for Windows，已装） |
| `bash` / `make` / `curl` / `unzip` | — | 运行脚本、Makefile | **Git Bash 环境**（Git for Windows 自带 `bash`、`curl`；`make` 由 `setup.sh` 自动取得——优先复用 Git 的 `mingw32-make`，否则下载 WinLibs MinGW-w64 取其中的 `mingw32-make`，复制为项目级 `.tools/bin/make.exe`，见第 2.2 节；所有下载（Go/Node/WinLibs）经 `scripts/dl-windows.sh` 自动走国内可达镜像 ghproxy / golang.google.cn / npmmirror，无需手动配置） |
| PowerShell / CMD | — | ⚠️ **不要直接运行本项目的 `make` 命令** | 即使装了 `make.exe`，POSIX recipe 也会失败 |
| **Go** | **1.26.1（精确）** | 后端 & Prometheus 编译 | `.tools/go`（项目级） |
| **Node.js** | **22.14.0（精确）** | 前端运行时 | `.tools/node`（项目级） |
| **pnpm** | **9.x（精确 9）** | 前端包管理 | `.tools/pnpm`（项目级） |
| **MinGW-w64 (GCC)** | **16.2.0（仅 Windows）** | CGO 编译控制面 SQLite | `.tools/gcc`（项目级） |
| promu | latest（可选） | Prometheus 上游 `make build` 用 | `.tools/promu`（项目级） |
| Docker Desktop | 可选 | 容器化跑 Prometheus | 系统（可选；MVP 建议本地编译） |

> 版本来源：Go/Node/pnpm/GCC 版本号全部来自根 `Makefile` 的常量（`GO_VERSION` / `NODE_VERSION` / `GCC_VERSION` / `pnpm@9`），
> Windows 与 macOS/Linux 用的是**同一组数字**，所以三人小组无论用什么系统，工具版本都一致。
> Go 模块（go.mod/go.sum）与前端（pnpm-lock.yaml）也都有锁文件，保证字节级一致。

---

## 2. 一键初始化（推荐，项目级、零污染）

**只需两条命令**（在仓库根目录的 **Git Bash** 里执行）：

```bash
cd F:/code-program/CNCF_Monitor-worktree
make install-tools      # 装 Go/Node/pnpm 到 .tools/，并确保 C 编译器可用
```

`make install-tools` 内部会依次：

1. 下载 Go 1.26.1、Node 22.14.0 的 `.zip` 到 `.tools/`（Windows 包是 `.zip`，用 `unzip` 解压）；
2. 用 `npm` 把 pnpm 9 装到 `.tools/pnpm`；
3. **确保 C 编译器（CGO）可用**（见第 3 节）。

完成后验证：

```bash
# 这些命令走的是 .tools/ 里的工具，不需要系统 PATH 里有 go/node
make build-metric-center   # 应能成功编译出 platform/cmd/metric-center/metric-center.exe
make build-prometheus      # 应能成功编译出 upstream/prometheus/prometheus.exe
```

> 提示：`.tools/` 较大（Go≈170MB、Node≈100MB、MinGW-w64≈600MB 解压后），首次安装需耐心等待并联网。
> 若 `unzip` 缺失，先 `winget install unzip`。

### 2.1 为什么必须在 Git Bash？能否用 PowerShell / WSL2？

**macOS 能直接跑 `make`，是因为系统就是 Unix**：自带 `make`、`clang`、POSIX shell。Windows 不是 Unix，所以需要一个兼容层。

**Git Bash = 最轻量的兼容层**：它是 MSYS2 的精简版，自带 `bash`、`sh`、`curl`、`tar`、`uname`。本项目的 `Makefile` 大量依赖这些工具：
- `$(shell uname -s)` 判断操作系统；
- `export PATH := ...:$(PATH)` 在 make 进程内注入 `.tools/`；
- recipe 里使用 `./metric-center$(EXE)`、`rm -f`、`tar`/`unzip`。

**PowerShell / CMD 的问题**：
- 没有原生 `uname`，`$(shell uname -s)` 会返回空或报错；
- `export PATH := ...:$(PATH)` 中的 `:` 会和 Windows 盘符（如 `C:`）冲突；
- `rm`、`tar`、`unzip` 等命令行为与 POSIX 不一致。
> 所以即使你在 PowerShell 里通过 `winget install GnuWin32.make` 装上了 `make.exe`，**也不要从 PowerShell 跑本项目的 `make`**。

**WSL2（Ubuntu）是更好的“Linux CLI”选择**：
- 如果你希望获得接近 macOS 的完整 Linux 体验，可以安装 WSL2：
  ```powershell
  wsl --install -d Ubuntu
  ```
- WSL2 里本项目的 `Makefile` 几乎不用改（走 Linux 分支即可）。
- ⚠️ 但仓库放在 `F:\code-program` 时，WSL2 通过 `/mnt/f/...` 访问会有明显 I/O 性能损失；建议把仓库移到 WSL 内部文件系统（如 `~/CNCF_Monitor-worktree`），或继续使用 Git Bash。

**结论**：把仓库留在 `F:\code-program`，用 **Git Bash + 装 make** 是最简单、最一致的选择。

### 2.2 `make` 怎么来？零污染、不依赖系统包管理器

本项目只需要一个 `make` 命令（Go/Node/MinGW 全走 `.tools/`，不依赖系统包管理器）。`setup.sh` 按以下顺序自动取得 `make`，**全程不写系统/用户 PATH、不强制装任何包管理器**：

1. **首选：复用 Git for Windows 自带的 `mingw32-make.exe`**（若你的 Git 安装包含它）。脚本会检测 `mingw32-make`（含 PATH、已知安装目录、`git.exe` 反推三种探测方式），复制为项目级 `.tools/bin/make.exe`。

2. **回退（可靠路径）：下载 WinLibs MinGW-w64，取其中的 `mingw32-make.exe`。**
   - 本项目的 CGO（控制面编译 SQLite）**本来就要下载 WinLibs MinGW-w64**（见第 3 节 / Makefile 的 `install-gcc`，版本同源 `GCC_VERSION`）。
   - 因此 `setup.sh` 若发现 Git 没带 `mingw32-make`，就**直接下载这份 WinLibs 工具链**到 `.tools/gcc`，把其中的 `mingw32-make.exe` 复制为 `.tools/bin/make.exe`，并把 `.tools/gcc/bin` 也加进 PATH（供 make 运行期找依赖 DLL）。
   - 这次下载会被后续 `make ensure-cgo` **复用**（Makefile 的 `install-gcc` 幂等，检测到 `gcc.exe` 已存在即跳过），不会重复下载。
   - ✅ 信任链与 CGO 工具链一致（同一 WinLibs 官方发布）；✅ 零系统污染；✅ 无需 winget/choco。

3. **极少见再回退：chocolatey / winget**（仅当 WinLibs 下载失败，如本机无外网时）。按"安全/可维护"排序：
   - **chocolatey（社区）** —— 包全、自动加 PATH，但需先以管理员安装 choco 本体，信任链较长。
   - **winget（微软官方）** —— 系统自带、供应链最安全，但 `GnuWin32.make` 在部分机器的 winget 社区源里查不到（本次实测即遇到"找不到与输入条件匹配的程序包"），且 `GnuWin32\bin` 不自动进 PATH。

> 你本机实测：Git for Windows **未随附** `mingw32-make.exe`（已 `ls` 确认 `G:\Git\mingw64\bin\mingw32-make.exe` 不存在——你的 Git 自定义装在 `G:\Git`），且 winget 社区源查不到 `GnuWin32.make`，同时直连 GitHub 下载 WinLibs 在国内网络会被拦截（`curl: (35) Recv failure: Connection was aborted`）。所以脚本最终走**第 2 步（下载 WinLibs MinGW-w64 取 mingw32-make）**，并通过 `scripts/dl-windows.sh` 自动走 ghproxy 国内镜像完成下载——它顺带把 CGO 需要的编译器也准备好了。

### 2.3 成员自定义路径（环境变量覆盖，无需改脚本、无需生成个人脚本）

> **推荐做法（v1.25 起）**：`setup.sh` 是**路径参数化**的——仓库路径自动取脚本所在目录，Git/make 自动多布局探测。成员**不需要**让 AI 生成一份带自己路径的脚本副本（副本会随仓库更新而漂移），而是通过**环境变量**表达个性化差异，脚本保持唯一、跟仓库走。

| 场景 | 环境变量 | 用法 |
|------|----------|------|
| Git 装在非标准路径且自动探测失败（找不到 make） | `GIT_MAKE_DIR` | `GIT_MAKE_DIR="D:/Git/mingw64/bin" bash setup.sh`（指向含 `mingw32-make.exe` 的目录） |
| 脚本被复制到仓库外子目录运行 | `REPO_DIR` | `REPO_DIR="D:/code/CNCF_Monitor-worktree" bash setup.sh` |
| 受限网络并发下载 | `DL_PARALLEL` / `DL_MAX_TIME` / `DL_RETRY` | `DL_PARALLEL=3 bash setup.sh`（建议 2~4） |
| 指定首选下载镜像 | `GCC_MIRROR` | `GCC_MIRROR=ghproxy.com bash setup.sh` |

> **让 AI 帮你**：如果你的机器有特殊路径，直接在对话里告诉 AI「我的 Git 装在 `D:\Git`、仓库在 `D:\code\CNCF_Monitor-worktree`」，AI 会给出对应的环境变量命令——**不用生成整份脚本**。完整环境变量清单见 `setup.sh` 头部注释。

### 2.4 国内网络：下载自动走镜像（`scripts/dl-windows.sh`）

`make`/`Go`/`Node`/`WinLibs` 的二进制都要从外网下载，而国内网络常拦截 GitHub release 资源主机（`objects.githubusercontent.com`）或 `go.dev`/`nodejs.org`，表现为 `curl: (35) Recv failure` 或长时间超时。`scripts/dl-windows.sh` 是统一的镜像感知下载器，按 URL 主机自动选镜像，**无需你手动配置**：

- `github.com` / `githubusercontent.com` → `ghproxy.net` / `ghproxy.com` / `mirror.ghproxy.com`
- `go.dev` / `golang.org` → `golang.google.cn`（Google 中国镜像）
- `nodejs.org` → `registry.npmmirror.com`（淘宝 npm 镜像）

并自动复用系统/git 代理（`HTTPS_PROXY` / `HTTP_PROXY` / `git config http.proxy`）。若默认镜像仍不可用，可用环境变量 `GCC_MIRROR` 指定首选镜像。出错时脚本会逐个镜像重试，全部失败才报错退出。

> **受限网络加速（实测必备）**：若你的运营商对**单连接**限速（本机实测 `ghproxy.net` 单连接仅 ~12–13KB/s，而 `ghproxy.com`/`mirror.ghproxy.com`/其他 github 代理均被 TLS 拦截或超时），换镜像无效。此时 `setup.sh` 与 Makefile 的 GCC 下载改为调用 **`scripts/dl-parallel-windows.sh`**。它做三件事：**① 真正按 HTTP Range 把文件切成 N 段**（每段只下自己那一份，绝不会每段都下整文件）；**② 断点续传**（某段因超时/断流失败，下次只续传"还没下到的部分"，进度不丢）；**③ 503/429 自动退避 5 秒重试**。`DL_PARALLEL` 或第 3 参数控制并发（**默认 4**，并发越多越容易把免费公共镜像打爆致 503，建议 2~4）。可用 `DL_MAX_TIME`（单分片单次超时秒数，默认 1800）和 `DL_RETRY`（单分片最大尝试次数，默认 30，含续传）微调。若手动下载，推荐走 **方法一（直接解压到 `.tools/gcc`，见 2.5，已验证）**；若坚持用 `_gcc_make.zip` + `DL_SKIP_EXISTING` 让脚本解压（方法二，见 2.6），注意它**仅在 `make` 未安装时**才会跳过重下（详见 2.6「前提」），且文件必须**完整**否则脚本会沿用损坏文件。

#### 2.5 方法一（推荐·已验证）：手动解压到 `.tools/gcc`

> ✅ **已验证**：2026-08-10 用户在本机（Git 装在 `G:\Git`、无 `mingw32-make`）用此方法成功装上 gcc，`.tools/gcc/bin/gcc.exe` 就位；`setup.sh` 与 `make install-tools` 均正确复用、不再重复下载。推荐作为首选。

**为什么推荐它**：它把 `gcc.exe` 直接摆到 `setup.sh` 和 `make install-tools`→`install-gcc` **两处都会检测的位置**（`.tools/gcc/bin/gcc.exe`），因此**不依赖 `make` 是否已安装**，对团队任何成员的机器都稳。相比之下，方法二只在「`make` 未安装」这一特定场景下才复用手动包（详见 2.6）。

**操作步骤**（在 Git Bash 中执行；把 zip 路径换成你迅雷/aria2 实际下载到的位置，且必须是**下载完成的 `.zip`，不是迅雷的 `.xltd` 临时文件**）：

```bash
cd /f/code-program/CNCF_Monitor-worktree

# 0) 确认 unzip 可用（Git Bash 一般自带；缺失则另开 PowerShell 跑 winget install unzip）
command -v unzip || echo ">>> 需要 unzip：请 winget install unzip"

# 1) 先把下载好的 WinLibs 压缩包放到一个变量（路径按需修改）
ZIP="$HOME/Downloads/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip"
ls -lh "$ZIP"   # 应约 260~300 MB，确认是完整 zip

# 2) 解压，并把顶层 mingw64/ 展平进 .tools/gcc（关键！脚本期望 gcc.exe 在 .tools/gcc/bin/，不是 .tools/gcc/mingw64/bin/）
mkdir -p .tools/gcc
unzip -o "$ZIP" -d .tools/gcc
cp -r .tools/gcc/mingw64/. .tools/gcc/
rm -rf .tools/gcc/mingw64

# 3) 验证
ls .tools/gcc/bin/gcc.exe   # 应能看到 gcc.exe
```

完成后直接跑一键初始化即可（脚本检测到 gcc.exe 已存在会跳过 gcc 下载）：

```bash
bash setup.sh
```

> 若只想要分步控制，可改用 `make install-tools`（gcc 会被跳过）后继续第 4~8 节。

#### 2.6 方法二（备选·有前提）：`_gcc_make.zip` + `DL_SKIP_EXISTING`

> ⚠️ **前提（务必先读）**：方法二只有在**当前环境 `make` 未安装**时才复用手动包。原理是 `setup.sh` 仅在 `command -v make` 失败时进入「下载 WinLibs 顺带取 mingw32-make」分支，该分支才会读取 `.tools/_gcc_make.zip` 并尊重 `DL_SKIP_EXISTING`。若你的 Git 自带 `mingw32-make`（或已装 `make`），`setup.sh` 会跳过该分支，`make install-tools`→`install-gcc` 会**重新把 gcc 下载到 `/tmp/gcc.zip`**，你手动下的包被忽略。因此方法二更适合「像本机这样 `make` 缺失」的机器；通用场景请优先用 2.4 的方法一。

如果 `dl-parallel-windows.sh` 在你网络里仍频繁断流，可用 **aria2**（自带断点续传/重试）先把那份 WinLibs 压缩包下好，再让脚本跳过重复下载。**整条命令必须一行粘贴执行，不要带 `\` 续行符**（aria2 会把 `\` 当成 URI 报 `Unrecognized URI or unsupported protocol`）：

```bash
aria2c -x16 -s16 -d "F:/code-program/CNCF_Monitor-worktree/.tools" -o _gcc_make.zip "https://ghproxy.net/https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip"
```

**参数说明（哪些你能改，哪些必须原样保留）：**

| 参数 | 含义 | 能否改 | 说明 |
|------|------|--------|------|
| `-x16` | 单文件最大连接数 | ✅ 可改 | 网络允许就调大（如 `-x32`）以叠更多带宽；`-x` 与 `-s` 通常设成相等 |
| `-s16` | 分片数（同时下载的段数） | ✅ 可改 | 同上，一般与 `-x` 一致 |
| `-d "…/.tools"` | 输出目录 | ⚠️ 可改但**必须指向项目根的 `.tools`** | 即 `<你的仓库路径>/.tools`；脚本只在那里找文件。仓库挪位置就改成对应路径 |
| `-o _gcc_make.zip` | 输出文件名 | ❌ **不可改** | 脚本 `DL_SKIP_EXISTING` 固定按这个名字找，改名会导致脚本重新下载 |
| `https://ghproxy.net/https://github.com/…` | 下载地址（镜像前缀 + 原 GitHub release 路径） | ⚠️ 可换镜像前缀 | 把 `ghproxy.net` 换成你网络里可达的其它 GitHub 代理即可；**后面 `…/winlibs_mingw/releases/…/winlibs-x86_64-…zip` 这一段必须原样保留**（版本与文件名由 Makefile 的 `GCC_VERSION=16.2.0` 决定） |

下载完成后，在仓库根目录执行（⚠️ 仅当 `make` 未安装时脚本才会检测到 `.tools/_gcc_make.zip` 并跳过重下；若 `make` 已存在，此方式会失效，请改用 2.4 的方法一）：

```bash
cd /f/code-program/CNCF_Monitor-worktree
DL_SKIP_EXISTING=1 bash setup.sh
```

> 提示：本次实测下载卡住有**两个叠加原因**——**(a) 真·限速**：`ghproxy.net` 单连接只有 ~12–13KB/s，65MB 要 ~90 分钟，而旧脚本每条连接超时（600s）后从头重来，永远到不了 5%；**(b) 503 限流**：并发数过高会把免费公共镜像打爆。新脚本已同时解决：每段**只下自己的那一片**（如 4 段则每段 ~16MB 而非整 65MB），且**断点续传**——超时才只损失这 10 分钟进度、下次接着下，不再归零。并发建议保持 **4**（或 3）：`DL_PARALLEL=4 bash setup.sh`；并发越多越易 503。若你想让单次尝试拉更久再续传，可加大 `DL_MAX_TIME`（如 `DL_MAX_TIME=3600`）。aria2 因内置更稳的续传，是抖动网络下的首选替代（见下，`-c` 参数可续传）。

---

## 3. CGO / C 编译器（控制面必需，Prometheus 不需要）

> **这是 Windows 上最容易踩的坑，现已由 Makefile 自动处理。**

- 控制面（MetricCenter）用 `gorm.io/driver/sqlite` → `mattn/go-sqlite3`，**必须 CGO**，编译期需要 C 编译器（`gcc`/`clang`）。
- **Prometheus 是纯 Go，不需要 CGO**，`make build-prometheus` 不会触发 C 编译。

三端处理方式（由 `make ensure-cgo` 自动判断）：

| 系统 | C 编译器来源 | Makefile 行为 |
|------|-------------|---------------|
| **Windows** | 自动下载 **WinLibs MinGW-w64 (GCC 16.2.0)** 到 `.tools/gcc`，并 `export CGO_ENABLED=1` | 项目级，不污染系统 |
| **macOS** | 系统自带 `clang`（Xcode Command Line Tools） | 未安装则提示 `xcode-select --install` |
| **Linux** | 系统 `gcc`（build-essential） | 未安装则提示 `apt install build-essential` |

由于 Windows 走项目级 MinGW-w64，**你无需在系统里装任何 C/C++ 编译器**，也不会动系统环境变量。

---

## 4. 初始化 Git 子模块（关键，否则 Prometheus 无法编译）

Prometheus 与 node_exporter 是 **git submodule**，普通 `git clone` 不会拉取内容。在仓库根目录执行：

```bash
cd F:/code-program/CNCF_Monitor-worktree
git submodule update --init --recursive
```

执行后确认：

```bash
git submodule status
# 前面应为空格或 "+"（已初始化），不再是 "-"
ls upstream/prometheus/cmd/prometheus   # 能看到 prometheus 源码目录
```

---

## 5. 编译 MetricCenter 控制面（后端，Go + CGO）

直接走 make target（它会自动确保 go 与 C 编译器就位）：

```bash
cd F:/code-program/CNCF_Monitor-worktree
make build-metric-center
```

产物：`platform/cmd/metric-center/metric-center.exe`
启动（默认监听 `:8080`）：

```bash
./platform/cmd/metric-center/metric-center.exe
# 健康检查：浏览器打开 http://localhost:8080/health
```

> 注意：不要手写裸 `go build` 来编译控制面——因为 CGO 依赖 `.tools/gcc`，只有 `make` 进程内的 PATH 才包含它。
> 始终用 `make build-metric-center`（或 `make run-metric-center` 编译并直接启动）。

---

## 6. 应用上游 Patch（如需要）

若要在上游源码上叠加本项目的改造（`patches/prometheus/*.patch`），在编译 Prometheus **之前**应用：

```bash
cd F:/code-program/CNCF_Monitor-worktree
make apply-patches
```

> patch 是针对子模块当前 pin 的 commit 生成的；若 `git apply` 报冲突，说明上游 commit 已变动，需联系维护者更新 patch。

---

## 7. 编译上游 Prometheus 源码（MVP 重点）

> ⚠️ Prometheus 官方以 Linux/macOS 为主要构建环境。Windows 可以编译，但有个专属注意点：
> **Web UI 资源（embed）**：`web/ui` 的静态资源默认不存在，需先构建 UI，否则 `go build` 会报 `//go:embed static` 找不到目录的错误。

### 7.1 推荐：直接用 make target（最省事，无需 promu）

```bash
cd F:/code-program/CNCF_Monitor-worktree
make build-prometheus      # 内部执行 go build -o prometheus.exe ./cmd/prometheus
```

> 若报 `//go:embed static` 错误，先构建 Web UI（见 7.2），或用 7.3 的空目录绕过。

### 7.2 构建 Web UI 静态资源（需要 Node，已在 .tools/）

```bash
cd F:/code-program/CNCF_Monitor-worktree/upstream/prometheus
make ui-build              # 内部执行 npm ci && npm run build（用 .tools/node）
```

之后再 `make build-prometheus` 即可。

### 7.3 备选：跳过 UI，只关心抓取/查询能力

```bash
cd F:/code-program/CNCF_Monitor-worktree/upstream/prometheus
mkdir -p web/ui/static     # 创建占位目录，避免 //go:embed static 报错（Web 控制台将不可用）
make build-prometheus
```

### 7.4 运行 Prometheus

```bash
cd F:/code-program/CNCF_Monitor-worktree/upstream/prometheus
./prometheus.exe --config.file=prometheus.yml --web.listen-address=:9090
# 浏览器打开 http://localhost:9090
```

### 7.5 可选：用上游 `make build`（需要 promu，项目级）

如果你更习惯上游原生命令，可先把 promu 装到 `.tools/promu`（不污染系统），再走上游 Makefile：

```bash
cd F:/code-program/CNCF_Monitor-worktree
make install-promu        # 装 promu 到 .tools/promu，并加入 make 的 PATH
cd upstream/prometheus
make ui-build
make build                # 产物 ./prometheus（Windows 下 prometheus.exe）
```

---

## 8. 前端 Custom UI（React + Vite + TS + Ant Design）

```bash
cd F:/code-program/CNCF_Monitor-worktree/ui-custom/web
make dev-ui               # 等价于 pnpm install && pnpm dev，默认 http://localhost:5173
```

- 前端通过代理访问控制面 `http://localhost:8080/api/v1/status`，**需先启动 MetricCenter 控制面**。
- 生产构建：`make build-ui`（输出 `dist/`）。
- ⚠️ 必须用 `pnpm`（吃 `pnpm-lock.yaml` 锁版本），**不要用 `npm install`**，否则依赖版本会漂移、与团队成员不一致。

---

## 9. 一键启动（本地联调）

建议开三个终端（都在 **Git Bash** 里）：

| 终端 | 命令 | 端口 |
|------|------|------|
| ① 控制面 | `make run-metric-center` | 8080 |
| ② Prometheus | `cd upstream/prometheus && ./prometheus.exe --config.file=prometheus.yml --web.listen-address=:9090` | 9090 |
| ③ 前端 | `cd ui-custom/web && make dev-ui` | 5173 |

---

## 10. 初始化完成验证清单

- [ ] `make install-tools` 成功，`.tools/` 下出现 `go/`、`node/`、`pnpm/`、`gcc/`
- [ ] `git submodule status` 中 prometheus / node_exporter 前面不再是 `-`
- [ ] `make build-metric-center` 成功，生成 `metric-center.exe`
- [ ] `make build-prometheus` 成功，生成 `prometheus.exe`（或上游 `make build`）
- [ ] `ui-custom/web` 下 `make dev-ui` 能起服务（即 `pnpm install` 成功）
- [ ] 浏览器能打开 `:8080/health`、`:9090`、`:5173`

---

## 11. Windows 常见问题排错

**Q1：`make install-tools` 报空 URL / curl 失败**
A：检查网络是否能访问 go.dev / nodejs.org / github.com。代理环境可参考 Q5 配置 `HTTP_PROXY`/`HTTPS_PROXY`。

**Q2：编译控制面报 `gcc: command not found` 或 `cgo: C compiler "gcc" not found`**
A：说明 CGO 编译器不可用。`make install-tools` 在 Windows 会自动下载 MinGW-w64 到 `.tools/gcc`；
若失败，手动检查 `make ensure-cgo` 的输出，并确认 `.tools/gcc/bin/gcc.exe` 存在。
（macOS 报此错 → `xcode-select --install`；Linux → `sudo apt install build-essential`。）

**Q3：编译 Prometheus 报 `pattern static: no matching files` 或 `//go:embed` 错误**
A：Web UI 静态资源未构建。执行 `cd upstream/prometheus && make ui-build`，或用第 7.3 节的空 `web/ui/static` 目录绕过。

**Q4：`./prometheus` 不是可识别命令**
A：Windows 产物是 `prometheus.exe`，用 `./prometheus.exe`。

**Q5：Go 报 proxy / 下载模块超时**
A：国内可配置代理：
```bash
go env -w GOPROXY=https://goproxy.cn,direct
go env -w GOSUMDB=sum.golang.google.cn
```

**Q6：路径过长导致构建失败（Prometheus 依赖深）**
A：以管理员身份运行 `git config --system core.longpaths true`，或把仓库放到较短路径（如 `C:\dev\CNCF_Monitor`）。

---

## 附录 A：Makefile 的 Windows / 项目级支持（已实现）

仓库 `Makefile` 已内置完整支持，**无需手动修改**。行为如下：

- 在 Git Bash（`uname -s` 为 `MINGW64_NT-*` / `MSYS_NT-*` / `CYGWIN_NT-*`）下：
  - `make install-tools` 下载 Go/Node 的 `.zip` 与 **MinGW-w64 (GCC 16.2.0)** 的 `.zip` 到 `.tools/`，用 `unzip` 解压；
  - 安装 pnpm 9 到 `.tools/pnpm`；可选 `make install-promu` 装 promu 到 `.tools/promu`；
  - `export PATH` 在 `make` 进程内加入 `.tools/go/bin`、`.tools/node`、`..node/bin`、`..gcc/bin`、`..promu/bin`；
  - Windows 下 `export CGO_ENABLED=1` 且 `CC` 指向 `.tools/gcc/bin/gcc.exe`；
  - 编译 / 运行产物**自动带 `.exe`**。
- 所有工具均在仓库内的 `.tools/`，**不写系统/用户 PATH**，关掉项目即消失——满足"项目走、不污染系统"。
- macOS/Linux 走系统 C 编译器（clang/gcc），`make ensure-cgo` 会自动检测并提示缺失时的安装命令。

> 备注：本机执行 `make` 由 `setup.sh` 自动取得——优先复用 Git Bash 自带的 `mingw32-make`；若 Git 未随附（本机 Git 装在 `G:\Git` 即如此，已 `ls` 确认），则通过 `scripts/dl-windows.sh` 走 ghproxy 国内镜像自动下载 WinLibs MinGW-w64 取其中的 `mingw32-make`，复制为项目级 `.tools/bin/make.exe`，**无需手动安装任何包管理器**。若 `unzip` 缺失，可 `winget install unzip`（或 `choco install unzip`）。

---

## 附录 B：命令速查（一律用 make，避免裸命令找不到 .tools 里的工具）

```bash
# 一键装齐工具链（含 C 编译器）
make install-tools

# 子模块
git submodule update --init --recursive

# 后端（自动确保 go + CGO）
make build-metric-center
make run-metric-center

# 上游 Prometheus
cd upstream/prometheus
make ui-build            # 构建 Web UI（可选）
make build               # 或在本仓库根用：make build-prometheus
./prometheus.exe --config.file=prometheus.yml --web.listen-address=:9090
# 可选：make install-promu 后用上游 make build

# 前端
cd ui-custom/web
make dev-ui              # 或 make build-ui 生产构建

# 测试 / 清理
make test-platform
make clean
```

---

## 附录 C：系统级安装（备选，会装到系统，非默认）

如果你**确实**想用系统级 Go/Node/pnpm（而不是 `.tools/`），可自行安装并把它们加入系统 PATH，
之后仍用 `make` target 编译（make 会优先用 `.tools/`，没有时才回退到系统命令）。但注意：

- 系统装 Go/Node **不会**自动提供 C 编译器；Windows 上仍需单独装 MinGW-w64 或 TDM-GCC 并加入 PATH，
  才能编译控制面。这与"项目级 `.tools/gcc`"相比更费事且难保证团队版本一致。
- 因此**默认推荐附录 A 的 `.tools/` 路线**。

系统安装直链（仅供备选）：
- Go 1.26.1：https://go.dev/dl/go1.26.1.windows-amd64.msi
- Node 22.14.0：https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi
- pnpm 9：`npm install -g pnpm@9`
