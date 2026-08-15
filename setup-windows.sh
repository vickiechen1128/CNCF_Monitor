#!/usr/bin/env bash
# setup-windows.sh — CNCF_Monitor Windows 10/11 一键初始化脚本（仅在 Git Bash 中运行）
#
# 本脚本严格对齐 SETUP_WINDOWS.md 的三条核心约定：
#   约定 1) 目标：一次完成 Windows 10/11 协作者的本地初始化，最终可编译
#           MetricCenter 控制面、上游 Prometheus 源码，并跑起 Custom UI。
#   约定 2) 零系统污染：Go / Node / pnpm / MinGW-w64 全部装入仓库内 .tools/，
#           不写入系统/用户 PATH，不安装系统包管理器，关掉项目即消失。
#   约定 3) 仅限 Git Bash：Makefile 依赖 uname/curl/tar/unzip 等 POSIX 工具，
#           PowerShell / CMD 无法解析，务必在 Git Bash 中执行。
#
# 可覆盖环境变量（无需改脚本）：
#   REPO_DIR      仓库根目录（默认取脚本所在目录）
#   GIT_MAKE_DIR  Git 自带 mingw32-make 所在目录（Git 装在非标准路径时用）
#   DL_PARALLEL   并行下载分片数（默认 4，受限网络建议 2~4）
#   DL_MAX_TIME   单分片单次超时秒数（默认 1800）
#   DL_RETRY      单分片最大尝试次数（默认 30）
#   GCC_MIRROR    首选下载镜像前缀
# 例：GIT_MAKE_DIR="D:/Git/mingw64/bin" bash setup-windows.sh

set -e

# ---------------------------------------------------------------------------
# 约定 3：必须运行在 Git Bash（POSIX）中
# ---------------------------------------------------------------------------
UNAME_S="$(uname -s 2>/dev/null || echo UNKNOWN)"
case "$UNAME_S" in
  MINGW*|MSYS*|CYGWIN*)
    echo ">>> Git Bash detected: $UNAME_S"
    ;;
  Linux|Darwin)
    echo ">>> 当前为 $UNAME_S，本脚本面向 Windows 10/11 + Git Bash；"
    echo "    macOS/Linux 请改用仓库根的 setup.sh。"
    exit 1
    ;;
  *)
    echo ">>> ERROR: 无法识别 shell（$UNAME_S）。"
    echo "    请在 Git Bash 中运行，切勿在 PowerShell / CMD 中执行："
    echo "      cd <仓库路径>"
    echo "      bash setup-windows.sh"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 约定 2：所有工具链进 .tools/，不写系统/用户 PATH。
# 先定位并进入仓库根，保证 make/git 在正确目录执行（Makefile 用 $(shell pwd)）。
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$SCRIPT_DIR}"
cd "$REPO_DIR"
echo ">>> Repo root: $REPO_DIR"

TOOLS_BIN="$REPO_DIR/.tools/bin"
GCC_DIR="$REPO_DIR/.tools/gcc"
GCC_VERSION="16.2.0"
GCC_URL="https://github.com/brechtsanders/winlibs_mingw/releases/download/${GCC_VERSION}posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-${GCC_VERSION}-mingw-w64ucrt-14.0.0-r1.zip"
DL_P="$REPO_DIR/scripts/dl-parallel-windows.sh"

# 前置工具自检（curl/unzip/git 为下载与子模块的硬依赖）
MISSING=""
for t in curl unzip git; do
  command -v "$t" >/dev/null 2>&1 || MISSING="$MISSING $t"
done
if [ -n "$MISSING" ]; then
  echo ">>> ERROR: 缺少必需工具:$MISSING"
  echo "    - curl / unzip：Git Bash 一般自带；若 unzip 缺失可 winget install unzip"
  echo "    - git：请先安装 Git for Windows 并在 Git Bash 中运行"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. 确保 make 可用（项目级、零系统污染）
#    优先级：Git 自带 mingw32-make > 下载 WinLibs 取 mingw32-make > 手动指引
# ---------------------------------------------------------------------------
echo ">>> [1/8] Ensuring 'make' is available (project-local)"
if ! command -v make >/dev/null 2>&1; then
  locate_git_make() {
    local c g gd
    if [ -n "${GIT_MAKE_DIR:-}" ]; then
      if [ -f "$GIT_MAKE_DIR/mingw32-make.exe" ]; then echo "$GIT_MAKE_DIR/mingw32-make.exe"; return 0; fi
      if [ -f "$GIT_MAKE_DIR/make.exe" ]; then echo "$GIT_MAKE_DIR/make.exe"; return 0; fi
      echo ">>> WARN: GIT_MAKE_DIR=$GIT_MAKE_DIR 下未找到 make，继续自动探测。" >&2
    fi
    if command -v mingw32-make >/dev/null 2>&1; then command -v mingw32-make; return 0; fi
    for c in \
      "/c/Program Files/Git/mingw64/bin/mingw32-make.exe" \
      "/c/Program Files/Git/bin/mingw32-make.exe" \
      "/c/Program Files (x86)/Git/mingw64/bin/mingw32-make.exe" \
      "/c/Program Files (x86)/Git/bin/mingw32-make.exe" \
      "/g/Git/mingw64/bin/mingw32-make.exe" \
      "/g/Git/bin/mingw32-make.exe" ; do
      [ -f "$c" ] && { echo "$c"; return 0; }
    done
    g="$(command -v git 2>/dev/null || true)"
    if [ -n "$g" ]; then
      gd="$(cd "$(dirname "$g")" 2>/dev/null && pwd || true)"
      [ -f "$gd/mingw32-make.exe" ] && { echo "$gd/mingw32-make.exe"; return 0; }
      [ -f "$gd/make.exe" ] && { echo "$gd/make.exe"; return 0; }
      gd="$(cd "$(dirname "$g")/../mingw64/bin" 2>/dev/null && pwd || true)"
      [ -f "$gd/mingw32-make.exe" ] && { echo "$gd/mingw32-make.exe"; return 0; }
      [ -f "$gd/make.exe" ] && { echo "$gd/make.exe"; return 0; }
    fi
    return 1
  }

  mkdir -p "$TOOLS_BIN"
  MAKE_SRC="$(locate_git_make || true)"
  if [ -n "$MAKE_SRC" ]; then
    echo ">>> 复用 Git 自带 make: $MAKE_SRC"
    if [ ! -f "$TOOLS_BIN/make.exe" ]; then
      cp "$MAKE_SRC" "$TOOLS_BIN/make.exe"
    fi
    export PATH="$TOOLS_BIN:$PATH"
  else
    # 回退：下载 WinLibs（与 CGO 工具链同源，仅这一次，后续 install-gcc 幂等复用）
    if [ ! -f "$GCC_DIR/bin/mingw32-make.exe" ] && [ ! -f "$GCC_DIR/bin/gcc.exe" ]; then
      echo ">>> Git 未随附 make，下载 WinLibs MinGW-w64（含 mingw32-make）→ $GCC_DIR"
      if [ -f "$DL_P" ]; then
        TMPZ="$REPO_DIR/.tools/_gcc_make.zip"
        if bash "$DL_P" "$TMPZ" "$GCC_URL"; then
          unzip -q -o "$TMPZ" -d "$GCC_DIR" || true
          if [ -d "$GCC_DIR/mingw64" ]; then
            cp -r "$GCC_DIR/mingw64/." "$GCC_DIR/"
            rm -rf "$GCC_DIR/mingw64"
          fi
        else
          echo ">>> WARN: WinLibs 下载失败（所有镜像均不可达），转手动指引。"
        fi
        rm -f "$TMPZ"
      fi
    fi
    if [ -f "$GCC_DIR/bin/mingw32-make.exe" ]; then
      if [ ! -f "$TOOLS_BIN/make.exe" ]; then
        cp "$GCC_DIR/bin/mingw32-make.exe" "$TOOLS_BIN/make.exe"
      fi
      # 同时加入 gcc/bin，供 make.exe 运行期查找其依赖的 mingw 运行时 DLL
      export PATH="$TOOLS_BIN:$GCC_DIR/bin:$PATH"
    elif command -v choco >/dev/null 2>&1; then
      # 回退 3a（SETUP_WINDOWS.md §2.2）：chocolatey。PATH 仅进程内生效，不写用户 PATH（约定 2）
      echo ">>> Installing make via chocolatey..."
      choco install -y make || true
      export PATH="$PATH:/c/ProgramData/chocolatey/bin"
    elif command -v winget >/dev/null 2>&1; then
      # 回退 3b（SETUP_WINDOWS.md §2.2）：winget（供应链最安全）。
      # 注意：GnuWin32 不自动加 PATH；此处仅进程内 export，不持久化写用户 PATH（约定 2）。
      echo ">>> Installing make via winget (GnuWin32.make)..."
      winget install -e --id GnuWin32.make --accept-package-agreements --accept-source-agreements || true
      export PATH="$PATH:/c/Program Files (x86)/GnuWin32/bin"
    else
      echo ">>> ERROR: 无法以项目级方式取得 make。"
      echo "    手动方案（任选其一，均不污染系统，详见 SETUP_WINDOWS.md 2.5 节）："
      echo "      a) 浏览器下载 WinLibs 并解压到 .tools/gcc："
      echo "         $GCC_URL"
      echo "      b) 将任意 mingw32-make.exe 复制为 $TOOLS_BIN/make.exe"
      echo "    完成后重跑 bash setup-windows.sh"
      exit 1
    fi
  fi
else
  echo ">>> 已检测到 make: $(command -v make)"
fi

# 二次确认（安装/复制后仍不可用则明确报错）
if ! command -v make >/dev/null 2>&1; then
  echo ">>> ERROR: make 仍不可用，请按上文手动方案处理后重试。"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2~8. 工具链安装 → CGO → 子模块 → 补丁 → 编译三端（对应约定 1 / 2）
# ---------------------------------------------------------------------------
echo ">>> [2/8] Installing toolchains (Go/Node/pnpm/MinGW-w64) into .tools/"
make install-tools

# 国内网络：配置 Go 模块代理（SETUP_WINDOWS.md 第 11 节 Q5）。
# 仅当 GOPROXY 仍为官方默认值时改写（幂等；已自定义代理的用户不受影响）。
GO_BIN="$REPO_DIR/.tools/go/bin/go.exe"
if [ -f "$GO_BIN" ]; then
  CUR_PROXY="$("$GO_BIN" env GOPROXY 2>/dev/null || true)"
  case "$CUR_PROXY" in
    "https://proxy.golang.org,direct")
      "$GO_BIN" env -w GOPROXY=https://goproxy.cn,direct
      "$GO_BIN" env -w GOSUMDB=sum.golang.google.cn
      echo ">>> GOPROXY 已配置为国内镜像（goproxy.cn / sum.golang.google.cn）"
      ;;
    "https://goproxy.cn,direct")
      echo ">>> GOPROXY 已是国内镜像，无需修改"
      ;;
    *)
      echo ">>> GOPROXY 已自定义（$CUR_PROXY），保持不变"
      ;;
  esac
fi

echo ">>> [3/8] Verifying C compiler (CGO) for MetricCenter SQLite"
make ensure-cgo

echo ">>> [4/8] Initializing git submodules (upstream/ source)"
# 分支提醒（只读，不自动切换）：不同分支对子模块 pin 的 commit 可能不同，
# 文档适用分支为 design/module-mvp-demo（默认开发分支 develop）。
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
case "$CUR_BRANCH" in
  design/module-mvp-demo|develop|HEAD|"")
    [ "$CUR_BRANCH" = "HEAD" ] && echo ">>> WARN: 当前处于 detached HEAD，子模块将按此 commit 的 pin 拉取，请自行确认。"
    ;;
  *)
    echo ">>> WARN: 当前分支 '$CUR_BRANCH' 不是 design/module-mvp-demo / develop，"
    echo "    子模块将按当前分支 pin 的 commit 拉取，请确认是否符合预期。"
    ;;
esac
git submodule update --init --recursive

# 子模块状态核验（SETUP_WINDOWS.md §4 / §10 验证清单第 2 项）：
# status 输出前缀 '-' 表示未初始化，需报错让用户重试，而非等到编译期才失败。
SM_STATUS="$(git submodule status 2>/dev/null || true)"
if echo "$SM_STATUS" | grep -q '^-'; then
  echo ">>> ERROR: 以下子模块未初始化（前缀 '-'）："
  echo "$SM_STATUS" | grep '^-'
  echo "    请检查网络后重跑：git submodule update --init --recursive"
  exit 1
fi
echo ">>> 子模块状态核验通过："
echo "$SM_STATUS"

echo ">>> [5/8] Applying custom patches to upstream/prometheus"
make apply-patches || true

echo ">>> [6/8] Building MetricCenter control-plane backend"
make build-metric-center

echo ">>> [7/8] Building upstream Prometheus"
make build-prometheus

echo ">>> [8/8] Building Custom UI"
if [ -d "ui-custom/web" ]; then
  make build-ui
fi

# ---------------------------------------------------------------------------
# 收尾：后端测试 + 可选 hooks
# ---------------------------------------------------------------------------
echo ">>> Running backend tests"
make test-platform || true

if [ -f "install-hooks.sh" ]; then
  echo ">>> Installing Kimi hooks"
  bash install-hooks.sh
fi

echo ""
echo ">>> setup-windows.sh 完成"
echo "    一键启动（建议开三个 Git Bash 终端）："
echo "      ① 控制面      make run-metric-center"
echo "      ② Prometheus  make run-prometheus"
echo "      ③ 前端        make dev-ui"
