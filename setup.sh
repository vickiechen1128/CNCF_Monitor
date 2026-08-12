#!/usr/bin/env bash
# setup.sh - CNCF_Monitor 一键初始化脚本（跨平台：Windows / macOS / Linux）
#
# 工具链（Go / Node.js / pnpm / MinGW-w64）统一安装到仓库内的 .tools/ 目录，
# 不写入系统 PATH —— 项目级、可复现、不污染本机环境。
# Windows 用户请在 Git Bash 中运行本脚本（脚本会自动检测并安装缺失的 make）。
#
# 可覆盖环境变量（按需设置，无需修改脚本本身）：
#   REPO_DIR      仓库根目录（默认取脚本所在目录，无需设置；仅当脚本被复制到
#                 .tools/ 等子目录外运行时才需要显式指定）
#   GIT_MAKE_DIR  Git 安装的 mingw32-make 所在目录（如 "C:/Program Files/Git/mingw64/bin"）
#                 —— 当 Git 装在非标准路径且自动探测失败时使用
#   DL_PARALLEL   并行下载分片数（Windows 受限网络，默认 4）
#   DL_MAX_TIME   单分片单次超时秒数（默认 1800）
#   DL_RETRY      单分片最大尝试次数（默认 30）
#   GCC_MIRROR    首选下载镜像主机（默认自动选择 ghproxy 系列）
# 例：GIT_MAKE_DIR="D:/Git/mingw64/bin" bash setup.sh

set -e

# 0. 运行环境检测：本脚本需要 POSIX shell
# Windows 用户请使用 Git Bash；macOS/Linux 使用自带 Terminal。
# PowerShell / CMD 不兼容本项目的 Makefile（依赖 uname/curl/tar/unzip 等 POSIX 工具）。
UNAME_S="$(uname -s 2>/dev/null || echo UNKNOWN)"
if [ "$UNAME_S" = "UNKNOWN" ]; then
  echo ">>> ERROR: 无法检测操作系统，当前 shell 不是 POSIX shell。"
  echo "    Windows 用户请在 Git Bash 中运行："
  echo "      cd <你的仓库路径，如 D:/code/CNCF_Monitor-worktree>"
  echo "      bash setup.sh"
  echo "    不要直接在 PowerShell / CMD 中双击或执行 setup.sh。"
  exit 1
fi
case "$UNAME_S" in
  MINGW*|MSYS*|CYGWIN*|Linux|Darwin) ;;
  *)
    echo ">>> ERROR: 不支持的操作系统 '$UNAME_S'。"
    echo "    Windows 用户请在 Git Bash 中运行本脚本。"
    exit 1
    ;;
esac

echo ">>> CNCF_Monitor setup started (shell: $UNAME_S)"

# 0. 确保 make 可用（缺失则按平台尝试自动安装；参考 ensure-cgo 的跨平台探测思路）
# make 是构建编排器，不属于项目依赖，但本脚本全程依赖它来驱动 Makefile。
echo ">>> [Pre] Ensuring 'make' is available"
if ! command -v make >/dev/null 2>&1; then
  echo ">>> 'make' not found. Attempting auto-install..."
  UNAME_S="$(uname -s)"
  if [[ "$UNAME_S" == MINGW* ]] || [[ "$UNAME_S" == MSYS* ]] || [[ "$UNAME_S" == CYGWIN* ]]; then
    # Windows (Git Bash)
    # make 不是项目依赖，但需要它来驱动 Makefile。获取顺序：
    #   1) 复用 Git for Windows 自带的 mingw32-make.exe（零污染，首选）
    #   2) 下载 WinLibs MinGW-w64（含 mingw32-make.exe），与 CGO 工具链同源（仅下载一次）
    #   3) 包管理器回退：choco -> winget
    # 注意：本机 Git 自定义装在 G:\Git，且不随附 mingw32-make，因此实测会走第 2 条路径。
    #   下载统一走 scripts/dl-windows.sh（镜像感知：直连 GitHub -> ghproxy 国内镜像），以绕过
    #   github release 资源主机在国内网络常被拦截/TLS 重置的问题。
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # 仓库根目录自适应：脚本所在目录即仓库根；若被复制到子目录运行，可用 REPO_DIR 覆盖
    REPO_DIR="${REPO_DIR:-$SCRIPT_DIR}"
    TOOLS_BIN="$REPO_DIR/.tools/bin"
    GCC_DIR="$REPO_DIR/.tools/gcc"
    GCC_VERSION="16.2.0"
    GCC_URL="https://github.com/brechtsanders/winlibs_mingw/releases/download/${GCC_VERSION}posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-${GCC_VERSION}-mingw-w64ucrt-14.0.0-r1.zip"
    DL="$REPO_DIR/scripts/dl-windows.sh"
    DL_P="$REPO_DIR/scripts/dl-parallel-windows.sh"
    mkdir -p "$TOOLS_BIN"

    # 1) 探测 Git for Windows 自带的 make（git.exe 可能在 bin/ 或 mingw64/bin/ 两种布局）
    locate_git_make() {
      local c g gd
      # 环境变量优先：GIT_MAKE_DIR 显式指定 mingw32-make 所在目录（Git 装在非标准路径时用）
      if [ -n "${GIT_MAKE_DIR:-}" ]; then
        if [ -f "$GIT_MAKE_DIR/mingw32-make.exe" ]; then echo "$GIT_MAKE_DIR/mingw32-make.exe"; return 0; fi
        if [ -f "$GIT_MAKE_DIR/make.exe" ]; then echo "$GIT_MAKE_DIR/make.exe"; return 0; fi
        echo ">>> WARN: GIT_MAKE_DIR=$GIT_MAKE_DIR 下未找到 mingw32-make.exe / make.exe，继续自动探测。" >&2
      fi
      if command -v mingw32-make >/dev/null 2>&1; then command -v mingw32-make; return 0; fi
      if command -v make >/dev/null 2>&1; then command -v make; return 0; fi
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
        # 布局 A：git.exe 直接在 mingw64/bin/git.exe -> make 同目录
        gd="$(cd "$(dirname "$g")" 2>/dev/null && pwd || true)"
        [ -f "$gd/mingw32-make.exe" ] && { echo "$gd/mingw32-make.exe"; return 0; }
        [ -f "$gd/make.exe" ] && { echo "$gd/make.exe"; return 0; }
        # 布局 B：git.exe 在 bin/git.exe -> ../mingw64/bin
        gd="$(cd "$(dirname "$g")/../mingw64/bin" 2>/dev/null && pwd || true)"
        [ -f "$gd/mingw32-make.exe" ] && { echo "$gd/mingw32-make.exe"; return 0; }
        [ -f "$gd/make.exe" ] && { echo "$gd/make.exe"; return 0; }
      fi
      return 1
    }

    MAKE_SRC="$(locate_git_make || true)"
    if [ -n "$MAKE_SRC" ]; then
      echo ">>> Found Git's bundled make at: $MAKE_SRC"
      if [ ! -f "$TOOLS_BIN/make.exe" ]; then
        cp "$MAKE_SRC" "$TOOLS_BIN/make.exe"
        echo ">>> Copied -> $TOOLS_BIN/make.exe (project-local, no system pollution)"
      fi
      export PATH="$TOOLS_BIN:$PATH"
    else
      # 回退：下载 WinLibs MinGW-w64（CGO 也需要，仅下载一次，install-gcc 幂等复用）
      if [ ! -f "$GCC_DIR/bin/mingw32-make.exe" ] && [ ! -f "$GCC_DIR/bin/gcc.exe" ]; then
        echo ">>> 'make' not bundled with Git. Downloading WinLibs MinGW-w64 (includes mingw32-make) -> $GCC_DIR ..."
        TMPZ="$REPO_DIR/.tools/_gcc_make.zip"
        if command -v bash >/dev/null 2>&1 && [ -f "$DL_P" ]; then
          echo ">>> (parallel, range-supported mirror) "
          if bash "$DL_P" "$TMPZ" "$GCC_URL"; then
            echo ">>> Extracting WinLibs MinGW-w64 ..."
            unzip -o "$TMPZ" -d "$GCC_DIR" >/dev/null || true
            # WinLibs zip 顶层目录为 mingw64/，展平到 $GCC_DIR
            if [ -d "$GCC_DIR/mingw64" ]; then
              cp -r "$GCC_DIR/mingw64/." "$GCC_DIR/"
              rm -rf "$GCC_DIR/mingw64"
            fi
          else
            echo ">>> WARN: WinLibs GCC download failed on all mirrors (network?). Will fall back to choco/winget."
          fi
          rm -f "$TMPZ"
        else
          echo ">>> WARN: bash or scripts/dl-windows.sh not found; cannot download WinLibs GCC."
        fi
      fi
      if [ -f "$GCC_DIR/bin/mingw32-make.exe" ]; then
        if [ ! -f "$TOOLS_BIN/make.exe" ]; then
          cp "$GCC_DIR/bin/mingw32-make.exe" "$TOOLS_BIN/make.exe"
          echo ">>> Copied WinLibs mingw32-make -> $TOOLS_BIN/make.exe"
        fi
        # 把 gcc/bin 也加入 PATH，确保 make.exe 运行期能找到其依赖的 mingw 运行时 DLL
        export PATH="$TOOLS_BIN:$GCC_DIR/bin:$PATH"
      elif command -v choco >/dev/null 2>&1; then
        echo ">>> Installing make via chocolatey..."
        choco install -y make || true
        export PATH="$PATH:/c/ProgramData/chocolatey/bin"
      elif command -v winget >/dev/null 2>&1; then
        echo ">>> Installing make via winget (GnuWin32.make)..."
        winget install -e --id GnuWin32.make --accept-package-agreements --accept-source-agreements || true
        # GnuWin32 不自动加 PATH；幂等地把其 bin 目录持久化到【用户级】PATH（仅用户级，不影响系统）。
        GW_BIN="/c/Program Files (x86)/GnuWin32/bin"
        if [ -d "$GW_BIN" ] && ! echo "$PATH" | grep -q "GnuWin32/bin"; then
          powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', ([Environment]::GetEnvironmentVariable('PATH','User') + ';C:\Program Files (x86)\GnuWin32\bin'), 'User')" 2>/dev/null || true
          echo ">>> Added 'C:\Program Files (x86)\GnuWin32\bin' to User PATH (重启终端生效)."
        fi
        export PATH="$PATH:/c/Program Files (x86)/GnuWin32/bin"
      else
        echo ">>> ERROR: 'make' is required but could not be obtained."
        echo "    Git 未随附 mingw32-make；WinLibs 下载在所有镜像均失败（检查网络/代理）；且无 choco/winget。"
        echo "    手动方案（任选其一）："
        echo "      a) 浏览器下载 WinLibs："
        echo "         $GCC_URL"
        echo "         解压后将 mingw64/bin/mingw32-make.exe 复制到 $TOOLS_BIN/make.exe"
        echo "      b) 安装 MSYS2，用 pacman -S make（会落到 MSYS2 的 mingw64/bin）"
        echo "    完成后重跑 bash setup.sh"
        exit 1
      fi
    fi
  elif [ "$UNAME_S" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      echo ">>> Installing make via brew..."
      brew install make || true
    else
      echo ">>> ERROR: 'make' not found. Install Xcode Command Line Tools: xcode-select --install"
      exit 1
    fi
  else
    # Linux
    if command -v apt-get >/dev/null 2>&1; then
      echo ">>> Installing make via apt (may require sudo)..."
      sudo apt-get update && sudo apt-get install -y make || true
    elif command -v yum >/dev/null 2>&1; then
      echo ">>> Installing make via yum..."
      sudo yum install -y make || true
    elif command -v dnf >/dev/null 2>&1; then
      echo ">>> Installing make via dnf..."
      sudo dnf install -y make || true
    else
      echo ">>> ERROR: 'make' not found. Please install it via your distro's package manager."
      exit 1
    fi
  fi
  # 二次确认：安装后仍找不到则明确报错退出，避免后续静默失败
  if ! command -v make >/dev/null 2>&1; then
    echo ">>> ERROR: 'make' still not found after install attempt."
    echo "    Add its bin directory to PATH, or install make manually, then re-run."
    exit 1
  fi
else
  echo ">>> 'make' found: $(command -v make)"
fi

# 1. 安装工具链（Go + Node.js + pnpm；Windows 还会下载 MinGW-w64 到 .tools/gcc）
echo ">>> [1/6] Installing toolchains (Go, Node.js, pnpm) into .tools/"
make install-tools

# 2. 显式确认 C 编译器（CGO）
# 控制面 MetricCenter 使用 gorm + mattn/go-sqlite3，编译期依赖 CGO（C 编译器）。
# Windows 上 make install-tools 已一并下载 MinGW-w64；此处再显式检查并提示，
# 确保后续 go build 能开启 CGO（Windows: CGO_ENABLED=1 + .tools/gcc/bin）。
# macOS/Linux 使用系统自带 clang/gcc（缺失会给出安装提示）。
echo ">>> [2/6] Ensuring C compiler (CGO) for MetricCenter SQLite"
make ensure-cgo

# 3. 初始化 Git 子模块（upstream/prometheus、upstream/node_exporter 源码）
# 未初始化时 upstream/ 目录为空，编译/运行 Prometheus 会失败，必须先行拉取。
echo ">>> [3/6] Initializing git submodules (upstream/ source)"
git submodule update --init --recursive

# 4. 应用自研补丁到 upstream/prometheus（若存在）
echo ">>> [4/6] Applying custom patches to upstream/prometheus"
make apply-patches || true

# 5. 编译 MetricCenter 控制面后端（依赖 CGO）
echo ">>> [5/6] Building metric-center backend"
make build-metric-center

# 6. 构建 Custom UI（使用 .tools/pnpm，不依赖系统 PATH）
if [ -d "ui-custom/web" ]; then
    echo ">>> Building Custom UI"
    make build-ui
fi

# 7. 运行后端测试
echo ">>> Running backend tests"
make test-platform || true

# 8. 安装 Kimi hooks（AI 协作，可选）
if [ -f "install-hooks.sh" ]; then
    echo ">>> Installing Kimi hooks"
    bash install-hooks.sh
fi

echo ">>> CNCF_Monitor setup completed"
echo ""
echo "Next steps:"
echo "  make run-prometheus       # 启动 Prometheus（首次会自动构建 Web UI 资源）"
echo "  make run-metric-center    # 启动控制面"
echo "  make dev-ui               # 启动前端开发服务器"
