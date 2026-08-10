# MetricCenter - Unified Build Makefile
# 本 Makefile 负责管理 Go/Node.js/pnpm 工具链，并统一构建 Prometheus 后端与 Custom UI

PROJECT_ROOT := $(shell pwd)
TOOLS_DIR := $(PROJECT_ROOT)/.tools
GO_DIR := $(TOOLS_DIR)/go
NODE_DIR := $(TOOLS_DIR)/node
PNPM_DIR := $(TOOLS_DIR)/pnpm
GCC_DIR := $(TOOLS_DIR)/gcc
PROMU_DIR := $(TOOLS_DIR)/promu

# MinGW-w64 (WinLibs 便携版，仅 Windows 需要；macOS/Linux 使用系统 C 编译器)
GCC_VERSION := 16.2.0
GCC_URL :=

GO_VERSION := 1.26.1
NODE_VERSION := 22.14.0

UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# 默认（类 Unix：macOS / Linux）
GO_BIN := $(GO_DIR)/bin/go
NODE_BIN := $(NODE_DIR)/bin/node
NPM_BIN := $(NODE_DIR)/bin/npm
EXE :=
USE_ZIP :=

# 根据系统架构选择下载地址与可执行文件后缀
ifeq ($(UNAME_S),Darwin)
    ifeq ($(UNAME_M),arm64)
        GO_URL := https://go.dev/dl/go$(GO_VERSION).darwin-arm64.tar.gz
        NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-darwin-arm64.tar.gz
    else
        GO_URL := https://go.dev/dl/go$(GO_VERSION).darwin-amd64.tar.gz
        NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-darwin-x64.tar.gz
    endif
else ifeq ($(UNAME_S),Linux)
    ifeq ($(UNAME_M),aarch64)
        GO_URL := https://go.dev/dl/go$(GO_VERSION).linux-arm64.tar.gz
        NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-linux-arm64.tar.xz
    else
        GO_URL := https://go.dev/dl/go$(GO_VERSION).linux-amd64.tar.gz
        NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-linux-x64.tar.xz
    endif
else ifneq (,$(findstring MINGW,$(UNAME_S)))
    # Windows (Git Bash / MINGW)
    GO_URL := https://go.dev/dl/go$(GO_VERSION).windows-amd64.zip
    NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-win-x64.zip
    GO_BIN := $(GO_DIR)/bin/go.exe
    NODE_BIN := $(NODE_DIR)/node.exe
    NPM_BIN := $(NODE_DIR)/npm
    EXE := .exe
    USE_ZIP := 1
    GCC_URL := https://github.com/brechtsanders/winlibs_mingw/releases/download/$(GCC_VERSION)posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-$(GCC_VERSION)-mingw-w64ucrt-14.0.0-r1.zip
    CC := $(GCC_DIR)/bin/gcc.exe
    export CGO_ENABLED := 1
else ifneq (,$(findstring MSYS,$(UNAME_S)))
    GO_URL := https://go.dev/dl/go$(GO_VERSION).windows-amd64.zip
    NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-win-x64.zip
    GO_BIN := $(GO_DIR)/bin/go.exe
    NODE_BIN := $(NODE_DIR)/node.exe
    NPM_BIN := $(NODE_DIR)/npm
    EXE := .exe
    USE_ZIP := 1
    GCC_URL := https://github.com/brechtsanders/winlibs_mingw/releases/download/$(GCC_VERSION)posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-$(GCC_VERSION)-mingw-w64ucrt-14.0.0-r1.zip
    CC := $(GCC_DIR)/bin/gcc.exe
    export CGO_ENABLED := 1
else ifneq (,$(findstring CYGWIN,$(UNAME_S)))
    GO_URL := https://go.dev/dl/go$(GO_VERSION).windows-amd64.zip
    NODE_URL := https://nodejs.org/dist/v$(NODE_VERSION)/node-v$(NODE_VERSION)-win-x64.zip
    GO_BIN := $(GO_DIR)/bin/go.exe
    NODE_BIN := $(NODE_DIR)/node.exe
    NPM_BIN := $(NODE_DIR)/npm
    EXE := .exe
    USE_ZIP := 1
    GCC_URL := https://github.com/brechtsanders/winlibs_mingw/releases/download/$(GCC_VERSION)posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-$(GCC_VERSION)-mingw-w64ucrt-14.0.0-r1.zip
    CC := $(GCC_DIR)/bin/gcc.exe
    export CGO_ENABLED := 1
endif

PNPM_BIN := $(PNPM_DIR)/bin/pnpm

# 注：Windows 下 Node 解压到顶层（node.exe / npm），故 PATH 同时加入 $(NODE_DIR)
export PATH := $(GO_DIR)/bin:$(NODE_DIR)/bin:$(NODE_DIR):$(GCC_DIR)/bin:$(PROMU_DIR)/bin:$(PNPM_DIR)/bin:$(PATH)

.PHONY: all help install-go install-node install-pnpm install-tools \
        install-gcc install-promu ensure-cgo \
        ensure-go ensure-node ensure-pnpm \
        apply-patches build-metric-center build-prometheus build-ui build-all \
        run-metric-center run-prometheus dev-ui test-platform clean

all: build-all

help:
	@echo "MetricCenter Makefile"
	@echo ""
	@echo "  make install-tools      安装 Go + Node.js + pnpm 到 .tools/"
	@echo "  make apply-patches      应用 patches/prometheus/*.patch"
	@echo "  make build-metric-center  编译 MetricCenter 控制面后端"
	@echo "  make build-prometheus   编译上游 Prometheus"
	@echo "  make build-ui           构建 Custom UI"
	@echo "  make build-all          编译后端 + 前端"
	@echo "  make run-metric-center  编译并启动 MetricCenter 控制面"
	@echo "  make run-prometheus     编译并启动上游 Prometheus"
	@echo "  make dev-ui             启动前端开发服务器"
	@echo "  make test-platform      运行 platform/ 测试"
	@echo "  make clean              清理构建产物"

# -----------------------------------------------------------------------------
# 工具链安装
# -----------------------------------------------------------------------------

install-go:
	@if [ ! -f "$(GO_BIN)" ]; then \
		echo ">>> Installing Go $(GO_VERSION) to $(GO_DIR)"; \
		mkdir -p "$(GO_DIR)"; \
		rm -rf "$(GO_DIR)"/*; \
		if [ -n "$(USE_ZIP)" ]; then \
			bash scripts/dl-windows.sh /tmp/go.zip "$(GO_URL)"; \
			mkdir -p /tmp/goextract; \
			unzip -q -o /tmp/go.zip -d /tmp/goextract; \
			cp -r /tmp/goextract/go/. "$(GO_DIR)/"; \
			rm -rf /tmp/goextract /tmp/go.zip; \
		else \
			bash scripts/dl-windows.sh /tmp/go.tar.gz "$(GO_URL)"; \
			tar -C "$(GO_DIR)" --strip-components=1 -xzf /tmp/go.tar.gz; \
			rm /tmp/go.tar.gz; \
		fi; \
		"$(GO_BIN)" version; \
	else \
		echo ">>> Go already installed: $(GO_BIN)"; \
		"$(GO_BIN)" version; \
	fi

install-node:
	@if [ ! -f "$(NODE_BIN)" ]; then \
		echo ">>> Installing Node.js $(NODE_VERSION) to $(NODE_DIR)"; \
		mkdir -p "$(NODE_DIR)"; \
		rm -rf "$(NODE_DIR)"/*; \
		if [ -n "$(USE_ZIP)" ]; then \
			bash scripts/dl-windows.sh /tmp/node.zip "$(NODE_URL)"; \
			mkdir -p /tmp/nodeextract; \
			unzip -q -o /tmp/node.zip -d /tmp/nodeextract; \
			cp -r /tmp/nodeextract/node-v$(NODE_VERSION)-win-x64/. "$(NODE_DIR)/"; \
			rm -rf /tmp/nodeextract /tmp/node.zip; \
		else \
			bash scripts/dl-windows.sh /tmp/node.tar.gz "$(NODE_URL)"; \
			tar -C "$(NODE_DIR)" --strip-components=1 -xzf /tmp/node.tar.gz; \
			rm /tmp/node.tar.gz; \
		fi; \
		"$(NODE_BIN)" --version; \
	else \
		echo ">>> Node.js already installed: $(NODE_BIN)"; \
		"$(NODE_BIN)" --version; \
	fi

install-pnpm: install-node
	@if [ ! -f "$(PNPM_BIN)" ]; then \
		echo ">>> Installing pnpm to $(PNPM_DIR)"; \
		mkdir -p "$(PNPM_DIR)"; \
		"$(NPM_BIN)" install -g --prefix="$(PNPM_DIR)" pnpm@9 || true; \
		mkdir -p "$(PNPM_DIR)/bin"; \
		PNPM_MAIN=""; \
		for c in "$(PNPM_DIR)/node_modules/pnpm/bin/pnpm.cjs" "$(PNPM_DIR)/node_modules/.bin/pnpm" "$(PNPM_DIR)/pnpm" "$(PNPM_DIR)/pnpm.cjs"; do \
			if [ -f "$$c" ]; then PNPM_MAIN="$$c"; break; fi; \
		done; \
		if [ -z "$$PNPM_MAIN" ]; then \
			echo ">>> ERROR: pnpm executable not found after install. Contents of $(PNPM_DIR):"; \
			ls -la "$(PNPM_DIR)"; exit 1; \
		fi; \
		printf '#!/usr/bin/env sh\n"$(NODE_BIN)" "$$PNPM_MAIN" "$$@"\n' > "$(PNPM_BIN)"; \
		chmod +x "$(PNPM_BIN)"; \
		"$(PNPM_BIN)" --version; \
	else \
		echo ">>> pnpm already installed: $(PNPM_BIN)"; \
		"$(PNPM_BIN)" --version; \
	fi

install-tools: install-go install-node install-pnpm ensure-cgo

# 确保 C 编译器可用（CGO，控制面 SQLite 依赖）。Windows 下载 MinGW-w64 到 .tools/gcc；
# macOS/Linux 使用系统自带 clang/gcc，未安装则给出安装提示。
ensure-cgo:
	@echo ">>> Ensuring C compiler (CGO) is available"
	@if [ -n "$(GCC_URL)" ]; then \
		$(MAKE) install-gcc; \
	else \
		if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then \
			echo ">>> ERROR: no C compiler found on $(UNAME_S)."; \
			if [ "$(UNAME_S)" = "Darwin" ]; then echo "    Run: xcode-select --install"; fi; \
			if [ "$(UNAME_S)" = "Linux" ]; then echo "    Run: sudo apt install build-essential (Debian/Ubuntu)"; fi; \
			exit 1; \
		else \
			echo ">>> C compiler found: $$(command -v cc gcc clang 2>/dev/null | head -1)"; \
		fi; \
	fi

# 安装 MinGW-w64 (WinLibs 便携版) 到 .tools/gcc（项目级，不污染系统）
install-gcc:
	@if [ -n "$(GCC_URL)" ]; then \
		if [ ! -f "$(GCC_DIR)/bin/gcc.exe" ]; then \
			echo ">>> Installing MinGW-w64 GCC ($(GCC_VERSION)) to $(GCC_DIR)"; \
			mkdir -p "$(GCC_DIR)"; \
			rm -rf "$(GCC_DIR)"/*; \
			bash scripts/dl-parallel-windows.sh /tmp/gcc.zip "$(GCC_URL)"; \
			mkdir -p /tmp/gccextract; \
			unzip -q -o /tmp/gcc.zip -d /tmp/gccextract; \
			cp -r /tmp/gccextract/mingw64/. "$(GCC_DIR)/"; \
			rm -rf /tmp/gccextract /tmp/gcc.zip; \
			"$(GCC_DIR)/bin/gcc.exe" --version; \
		else \
			echo ">>> MinGW-w64 GCC already installed: $(GCC_DIR)/bin/gcc.exe"; \
		fi; \
	else \
		echo ">>> Skipping gcc install (use system C compiler on $(UNAME_S))"; \
	fi

# 安装 promu（Prometheus 构建工具）到 .tools/promu（项目级，不污染系统）
install-promu: ensure-go
	@if [ ! -f "$(PROMU_DIR)/bin/promu$(EXE)" ]; then \
		echo ">>> Installing promu to $(PROMU_DIR)"; \
		mkdir -p "$(PROMU_DIR)/bin"; \
		GOBIN="$(PROMU_DIR)/bin" "$(GO_BIN)" install github.com/prometheus/promu@latest; \
		"$(PROMU_DIR)/bin/promu$(EXE)" --version; \
	else \
		echo ">>> promu already installed: $(PROMU_DIR)/bin/promu$(EXE)"; \
	fi

ensure-go: install-go
ensure-node: install-node
ensure-pnpm: install-pnpm

# -----------------------------------------------------------------------------
# 构建
# -----------------------------------------------------------------------------

apply-patches:
	@echo ">>> Applying patches to upstream/prometheus"
	@cd "$(PROJECT_ROOT)/upstream/prometheus" && \
	for patch in "$(PROJECT_ROOT)/patches/prometheus"/*.patch; do \
		if [ -f "$$patch" ]; then \
			echo ">>> Applying $$patch"; \
			git apply "$$patch" || echo ">>> Warning: failed to apply $$patch"; \
		fi; \
	done

build-metric-center: ensure-go ensure-cgo
	@echo ">>> Building metric-center"
	@cd "$(PROJECT_ROOT)" && "$(GO_BIN)" build -o platform/cmd/metric-center/metric-center$(EXE) ./platform/cmd/metric-center

build-prometheus: ensure-go ensure-node
	@echo ">>> Building upstream Prometheus"
		@cd "$(PROJECT_ROOT)/upstream/prometheus" && { [ -d web/ui/static ] || ( cd web/ui && "$(NPM_BIN)" ci && "$(NPM_BIN)" run build ); } && "$(GO_BIN)" build -o prometheus$(EXE) ./cmd/prometheus

build-ui: ensure-pnpm
	@echo ">>> Building Custom UI"
	@cd "$(PROJECT_ROOT)/ui-custom/web" && "$(PNPM_BIN)" install && "$(PNPM_BIN)" run build

build-all: build-metric-center build-prometheus build-ui

# -----------------------------------------------------------------------------
# 运行
# -----------------------------------------------------------------------------

run-metric-center: build-metric-center
	@echo ">>> Starting metric-center"
	@cd "$(PROJECT_ROOT)" && ./platform/cmd/metric-center/metric-center$(EXE)

run-prometheus: build-prometheus
	@echo ">>> Starting Prometheus"
	@cd "$(PROJECT_ROOT)" && ./upstream/prometheus/prometheus$(EXE) \
		--config.file="$(PROJECT_ROOT)/upstream/prometheus/prometheus.yml" \
		--web.listen-address=:9090

dev-ui: ensure-pnpm
	@echo ">>> Starting Custom UI dev server"
	@cd "$(PROJECT_ROOT)/ui-custom/web" && "$(PNPM_BIN)" install && exec "$(PROJECT_ROOT)/ui-custom/web/node_modules/.bin/vite"

# -----------------------------------------------------------------------------
# 测试与清理
# -----------------------------------------------------------------------------

test-platform: ensure-go ensure-cgo
	@echo ">>> Running platform tests"
	@cd "$(PROJECT_ROOT)" && "$(GO_BIN)" test ./platform/...

clean:
	@echo ">>> Cleaning build artifacts"
	@rm -f "$(PROJECT_ROOT)/platform/cmd/metric-center/metric-center$(EXE)"
	@rm -f "$(PROJECT_ROOT)/upstream/prometheus/prometheus$(EXE)"
	@rm -f "$(PROJECT_ROOT)/upstream/prometheus/promtool"
	@rm -f "$(PROJECT_ROOT)/upstream/node_exporter/node_exporter"
	@rm -rf "$(PROJECT_ROOT)/ui-custom/web/dist"
	@rm -rf "$(PROJECT_ROOT)/ui-custom/web/node_modules"
