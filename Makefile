# MetricCenter - Unified Build Makefile
# 本 Makefile 负责管理 Go/Node.js/pnpm 工具链，并统一构建 Prometheus 后端与 Custom UI

PROJECT_ROOT := $(shell pwd)
TOOLS_DIR := $(PROJECT_ROOT)/.tools
GO_DIR := $(TOOLS_DIR)/go
NODE_DIR := $(TOOLS_DIR)/node
PNPM_DIR := $(TOOLS_DIR)/pnpm
GCC_DIR := $(TOOLS_DIR)/gcc
PROMU_DIR := $(TOOLS_DIR)/promu

# 中心 Prometheus TSDB 保留策略（开发态）。
#
# 时间 + 容量**双重兜底**，任一触发即淘汰最旧块：
#   - 容量 2GB：贴合本机开发实际（用户定期清理 / 磁盘吃紧），**刻意不与生产一致**——
#     生产打包件默认 10GB（scripts/package-center.sh:376PROM_RETENTION_SIZE），
#     开发机无需承载长期排障历史，2GB 足够看住"最近几小时到几天"的联调窗口；
#     超出即自动滚动淘汰，不等手工清理。
#   - 时间 15d：兜住"低频抓取下 2GB 很久也填不满"的极端情况，防无限增长。
# 需临时加大：`make run-prometheus PROM_RETENTION_TIME=30d PROM_RETENTION_SIZE=10GB`。
PROM_RETENTION_TIME ?= 15d
PROM_RETENTION_SIZE ?= 2GB

# MinGW-w64 (WinLibs 便携版，仅 Windows 需要；macOS/Linux 使用系统 C 编译器)
GCC_VERSION := 16.2.0
GCC_URL :=

GO_VERSION := 1.26.1
NODE_VERSION := 22.14.0

UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# M08 通知渲染桥（PL-3）运行配置：默认走本机 8080，令牌给一个**本地开发默认值**。
#
# ⚠ 为什么要默认值（2026-10-08）：三个变量原先没有任何默认值，`make` 展开即空串 →
#   - URL 空 → 平台**不物化** notify receivers（generate 侧判 BridgeURL == "" 直接跳过）；
#   - 令牌空 → 桥端点「一律 401」（bridge.go：Token 为空表示未启用），于是通知渠道页
#     对已启用渠道一律标「暂不可用」（receiver_snippet.go 的 token_configured=false）。
#   即「渠道配好了、路由也指向它了，但一条也发不出去」，且现象被分散在两个页面、
#   互相看不出来由（用户 2026-10-08 实测：路由页报「孤立接收人」、渠道页报「暂不可用」，
#   两处都看不出真正原因是令牌没配）。
#
# 全部用 `?=`：**环境变量可覆盖**默认值，且 `make VAR=x` 亦生效。
# 生产部署必须显式注入强随机令牌（package-center.sh / 部署文档已走环境变量路径），
# 此处默认值仅供本地开发，切勿用于生产。
NOTIFY_BRIDGE_URL ?= http://127.0.0.1:8080
NOTIFY_BRIDGE_TOKEN ?= local-dev-bridge-token
# 渲染时区：空 → 平台回落 UTC（告警卡片时间会显示 UTC 而非本地时）。
NOTIFY_RENDER_TIMEZONE ?= Asia/Shanghai

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
# 同时加入 upstream/prometheus 与 upstream/blackbox_exporter：M09 配置草稿校验
# 通过 exec.LookPath("promtool"/"blackbox_exporter") 调用上游二进制，须保证
# metric-center 进程的 PATH 能定位到 build-prometheus / build-promtool /
# build-blackbox-exporter 的产物；upstream/alertmanager 同理供
# exec.LookPath("amtool")（M08 AM 配置校验）定位 build-amtool 产物。
export PATH := $(GO_DIR)/bin:$(NODE_DIR)/bin:$(NODE_DIR):$(GCC_DIR)/bin:$(PROMU_DIR)/bin:$(PNPM_DIR)/bin:$(PROJECT_ROOT)/upstream/prometheus:$(PROJECT_ROOT)/upstream/alertmanager:$(PROJECT_ROOT)/upstream/blackbox_exporter:$(PATH)

# 显式锁定 GOROOT 到项目级工具链：屏蔽系统/用户环境里残留的 GOROOT（如手动安装的
# ~/sdk/goX.Y.Z），否则会出现 "compile: version goX does not match go tool version goY"。
export GOROOT := $(GO_DIR)

.PHONY: all help install-go install-node install-pnpm install-tools \
        install-gcc install-promu ensure-cgo \
        ensure-go ensure-node ensure-pnpm \
        apply-patches build-metric-center build-prometheus build-ui build-all \
        run-metric-center run-prometheus dev-ui test-platform clean repo-map \
        check-repo-map install-git-hooks \
        check-prd-hygiene check-prototype-notes check-prototype

all: build-all

help:
	@echo "MetricCenter Makefile"
	@echo ""
	@echo "  make install-tools      安装 Go + Node.js + pnpm 到 .tools/"
	@echo "  make apply-patches      应用 patches/prometheus/*.patch"
	@echo "  make build-metric-center  编译 MetricCenter 控制面后端"
	@echo "  make build-prometheus   编译上游 Prometheus"
	@echo "  make build-ui           构建 Custom UI"
	@echo "  make build-all          编译后端 + Prometheus + 前端"
	@echo "  make package-center     打包中心一体化交付产物 -> dist/metric-center-bundle-*.tar.gz（默认全量含 alertmanager/amtool/blackbox_exporter；WITH_ALERTMANAGER=0 / WITH_BLACKBOX=0 可裁剪）"
	@echo "  make run-metric-center  编译并启动 MetricCenter 控制面"
	@echo "  make run-prometheus     编译并启动上游 Prometheus"
	@echo "  make dev-ui             启动前端开发服务器"
	@echo "  make test-platform      运行 platform/ 测试"
	@echo "  make repo-map           生成业务代码符号地图 -> docs/04-source-architecture/repo-map.md"
	@echo "  make check-repo-map     校验符号地图是否与当前代码一致（pre-commit hook 与 CI 已强制）"
	@echo "  make install-git-hooks  启用项目级 git hooks（pre-commit 强制 repo-map 新鲜度）"
	@echo "  make check-prd-hygiene  检查 PRD 去历史化与章节冻结"
	@echo "  make check-prototype-notes  检查原型用户可见文案是否泄漏评审标记"
	@echo "  make check-prototype  检查原型标记泄漏 + 结构反模式（Alert 滥用/表格列数>8/筛选布局）"
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
			bash scripts/dl-parallel-windows.sh /tmp/go.zip "$(GO_URL)"; \
			mkdir -p /tmp/goextract; \
			unzip -q -o /tmp/go.zip -d /tmp/goextract; \
			cp -r /tmp/goextract/go/. "$(GO_DIR)/"; \
			rm -rf /tmp/goextract /tmp/go.zip; \
		else \
			bash scripts/dl-parallel-windows.sh /tmp/go.tar.gz "$(GO_URL)"; \
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
			bash scripts/dl-parallel-windows.sh /tmp/node.zip "$(NODE_URL)"; \
			mkdir -p /tmp/nodeextract; \
			unzip -q -o /tmp/node.zip -d /tmp/nodeextract; \
			cp -r /tmp/nodeextract/node-v$(NODE_VERSION)-win-x64/. "$(NODE_DIR)/"; \
			rm -rf /tmp/nodeextract /tmp/node.zip; \
		else \
			bash scripts/dl-parallel-windows.sh /tmp/node.tar.gz "$(NODE_URL)"; \
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
		for c in "$(PNPM_DIR)/lib/node_modules/pnpm/bin/pnpm.cjs" "$(PNPM_DIR)/node_modules/pnpm/bin/pnpm.cjs" "$(PNPM_DIR)/lib/node_modules/.bin/pnpm" "$(PNPM_DIR)/node_modules/.bin/pnpm" "$(PNPM_DIR)/pnpm" "$(PNPM_DIR)/pnpm.cjs"; do \
			if [ -f "$$c" ]; then PNPM_MAIN="$$c"; break; fi; \
		done; \
		if [ -z "$$PNPM_MAIN" ]; then \
			echo ">>> ERROR: pnpm executable not found after install. Contents of $(PNPM_DIR):"; \
			ls -la "$(PNPM_DIR)"; exit 1; \
		fi; \
		rm -f "$(PNPM_BIN)"; \
		printf '#!/usr/bin/env sh\nexec "%s" "%s" "$$@"\n' "$(NODE_BIN)" "$$PNPM_MAIN" > "$(PNPM_BIN)"; \
		chmod +x "$(PNPM_BIN)"; \
		if [ -n "$(USE_ZIP)" ]; then \
			printf '@"%s" "%s" %%%%*\n' "$(NODE_BIN)" "$$PNPM_MAIN" > "$(PNPM_DIR)/bin/pnpm.cmd"; \
		fi; \
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

build-prometheus: ensure-go ensure-pnpm
	@echo ">>> Building upstream Prometheus (Web UI assets embedded via builtinassets)"
	@cd "$(PROJECT_ROOT)/upstream/prometheus" && { [ -d web/ui/static ] || ( cd web/ui && "$(PNPM_BIN)" install && "$(PNPM_BIN)" run build:mantine-ui ); } && { [ -f web/ui/embed.go ] || printf '//go:build builtinassets\npackage ui\n\nimport "embed"\n\n//go:embed static\nvar EmbedFS embed.FS\n' > web/ui/embed.go; } && "$(GO_BIN)" build -tags builtinassets -o prometheus$(EXE) ./cmd/prometheus

# 构建 upstream promtool：M09 配置草稿校验（ValidateArtifacts）通过
# exec.LookPath("promtool") 调用本二进制做 promtool check config；缺失时
# 校验返回 pending + platform_fault（决策 42-2）。GOPROXY 走国内代理避免
# jsondiff 等新增依赖拉取超时。
# 说明：build-promtool / build-amtool 是强制重建入口（每次都跑 go build）；
# run-metric-center 启动链改依赖下面的文件目标（PROMTOOL_BIN / AMTOOL_BIN），
# 二进制已存在即跳过，避免网络慢时 GOPROXY 拉依赖挂死整个启动链
# （2026-10-12 诊断：make run-metric-center 卡死在重复构建 promtool 约 45 分钟）。
# 注意：文件目标必须用相对路径——PROJECT_ROOT 含空格（"03 AIopsAgent-study"），
# 绝对路径展开后会被 Make 按空格切成「目标 + 前置」两个词导致目标失配。
PROMTOOL_BIN := upstream/prometheus/promtool$(EXE)
AMTOOL_BIN := upstream/alertmanager/amtool$(EXE)

build-promtool: ensure-go
	@echo ">>> Building upstream promtool"
	@cd "$(PROJECT_ROOT)/upstream/prometheus" && GOPROXY=https://goproxy.cn,direct "$(GO_BIN)" build -o promtool$(EXE) ./cmd/promtool

# build-amtool: 构建上游 amtool（Alertmanager 配置校验命令行）；M08 Alertmanager
# 配置挂载校验通过 exec.LookPath("amtool") 调用本二进制做 amtool check-config，
# 缺失时校验返回校验失败并提示用户启动 Alertmanager 环境。
build-amtool: ensure-go
	@echo ">>> Building upstream amtool"
	@cd "$(PROJECT_ROOT)/upstream/alertmanager" && GOPROXY=https://goproxy.cn,direct "$(GO_BIN)" build -o amtool$(EXE) ./cmd/amtool

# 文件目标：仅当二进制缺失时才触发构建（子 make 调用 ensure-go 初始化工具链，
# 不列为前置依赖——phony 前置会使文件目标永远视为过期）。强制重建用 build-promtool。
$(PROMTOOL_BIN):
	@$(MAKE) --no-print-directory ensure-go
	@echo ">>> Building upstream promtool (missing)"
	@cd "$(PROJECT_ROOT)/upstream/prometheus" && GOPROXY=https://goproxy.cn,direct "$(GO_BIN)" build -o promtool$(EXE) ./cmd/promtool

$(AMTOOL_BIN):
	@$(MAKE) --no-print-directory ensure-go
	@echo ">>> Building upstream amtool (missing)"
	@cd "$(PROJECT_ROOT)/upstream/alertmanager" && GOPROXY=https://goproxy.cn,direct "$(GO_BIN)" build -o amtool$(EXE) ./cmd/amtool

build-ui: ensure-pnpm
	@echo ">>> Building Custom UI"
	@cd "$(PROJECT_ROOT)/ui-custom/web" && "$(PNPM_BIN)" install && "$(PNPM_BIN)" run build

# ---- Edge Sync Agent（Module_11：Edge Access & Agent Delivery）----
# 决策 88：MVP 采集器统一走 vmagent（VictoriaMetrics），与 blackbox_exporter 组成
# edge-sync-agent 守护的三件套。上游 v1.152.0（VictoriaMetrics 子模块 pinned d2bc8eef5）。
EDGE_AGENT_VERSION ?= v0.2.0
VMAgent_VERSION ?= v1.152.0
Blackbox_VERSION ?= v0.26.0
EDGE_DIST := $(PROJECT_ROOT)/platform/edge-sync-agent/dist

# build-edge-agent: 交叉编译 edge-sync-agent（linux/amd64 + linux/arm64）到 module 内 dist/。
# 该 module 零第三方 / 零 CGO 依赖，可安全 GOOS=linux 交叉编译，无需 zig。
build-edge-agent: ensure-go
	@echo ">>> Building edge-sync-agent (linux/amd64 + linux/arm64, version=$(EDGE_AGENT_VERSION))"
	@mkdir -p "$(EDGE_DIST)"
	@cd "$(PROJECT_ROOT)/platform/edge-sync-agent" && \
		CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$(GO_BIN)" build -trimpath \
			-ldflags "-X main.version=$(EDGE_AGENT_VERSION)" -o dist/edge-sync-agent-linux-amd64 ./cmd/edge-sync-agent && \
		CGO_ENABLED=0 GOOS=linux GOARCH=arm64 "$(GO_BIN)" build -trimpath \
			-ldflags "-X main.version=$(EDGE_AGENT_VERSION)" -o dist/edge-sync-agent-linux-arm64 ./cmd/edge-sync-agent

# build-vmagent: 交叉编译 vmagent（采集器，决策 88）linux/amd64 + linux/arm64 到 EDGE_DIST。
# VictoriaMetrics 为单个 Go module，入口 app/vmagent；纯 Go 可 CGO_ENABLED=0 交叉编译。
build-vmagent: ensure-go
	@echo ">>> Building vmagent (linux/amd64 + linux/arm64, version=$(VMAgent_VERSION))"
	@mkdir -p "$(EDGE_DIST)"
	@cd "$(PROJECT_ROOT)/upstream/victoria-metrics" && \
		GOPROXY=https://goproxy.cn,direct CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$(GO_BIN)" build -trimpath \
			-o "$(EDGE_DIST)/vmagent-linux-amd64" ./app/vmagent && \
		GOPROXY=https://goproxy.cn,direct CGO_ENABLED=0 GOOS=linux GOARCH=arm64 "$(GO_BIN)" build -trimpath \
			-o "$(EDGE_DIST)/vmagent-linux-arm64" ./app/vmagent

# build-blackbox-edge: 交叉编译 blackbox_exporter（拨测器）linux/amd64 + linux/arm64 到 EDGE_DIST。
# 区别于 build-blackbox-exporter（控制台用，构建主机架构单二进制）。
build-blackbox-edge: ensure-go
	@echo ">>> Building blackbox_exporter (linux/amd64 + linux/arm64, version=$(Blackbox_VERSION))"
	@mkdir -p "$(EDGE_DIST)"
	@cd "$(PROJECT_ROOT)/upstream/blackbox_exporter" && \
		GOPROXY=https://goproxy.cn,direct CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$(GO_BIN)" build -trimpath \
			-o "$(EDGE_DIST)/blackbox_exporter-linux-amd64" ./ && \
		GOPROXY=https://goproxy.cn,direct CGO_ENABLED=0 GOOS=linux GOARCH=arm64 "$(GO_BIN)" build -trimpath \
			-o "$(EDGE_DIST)/blackbox_exporter-linux-arm64" ./

# build-edge-package: 组装边缘一体化离线交付包（edge-sync-agent + vmagent + blackbox_exporter
# + packaging/*.service + start.sh/安装说明 + release_meta.json：版本 / sha256 / size_bytes /
# 组件清单，字段对齐中心 platform/edge packages_service.go 的 PackageArtifact / PackageComponent 契约）。
build-edge-package: build-edge-agent build-vmagent build-blackbox-edge
	@echo ">>> Packaging edge-sync-agent offline bundle"
	@EDGE_AGENT_VERSION="$(EDGE_AGENT_VERSION)" VMAgent_VERSION="$(VMAgent_VERSION)" Blackbox_VERSION="$(Blackbox_VERSION)" \
		bash "$(PROJECT_ROOT)/scripts/package-edge-agent.sh"

# Alertmanager 的 legacy Elm UI 使用 vite-plugin-elm 构建，其内部经
# pathToFileURL 对工作目录做 URL 编码；本项目路径含空格（"03 AIopsAgent-study"），
# 空格被转成 %20 导致 rolldown 打开 src/Main.elm 时 ENOENT。
# 因此 UI 构建改为在无空格的临时目录（/tmp）中执行，再把产物 dist/ 拷回
# upstream/alertmanager/ui/app/dist（go:embed app/dist 依赖该目录）。
ALERTMANAGER_UI_STAGING := /tmp/alertmanager-ui-app
build-alertmanager: ensure-go
	@echo ">>> Building upstream Alertmanager"
	@if [ ! -d "$(PROJECT_ROOT)/upstream/alertmanager/ui/app/dist" ]; then \
		echo ">>> Building Alertmanager legacy Elm UI in space-free staging dir"; \
		rm -rf "$(ALERTMANAGER_UI_STAGING)"; \
		mkdir -p "$(ALERTMANAGER_UI_STAGING)"; \
		cd "$(PROJECT_ROOT)/upstream/alertmanager/ui/app" && cp -R index.html package.json package-lock.json vite.config.mjs elm.json src public "$(ALERTMANAGER_UI_STAGING)/"; \
		cd "$(ALERTMANAGER_UI_STAGING)" && npm ci && npm run build; \
		rm -rf "$(PROJECT_ROOT)/upstream/alertmanager/ui/app/dist"; \
		cp -R "$(ALERTMANAGER_UI_STAGING)/dist" "$(PROJECT_ROOT)/upstream/alertmanager/ui/app/dist"; \
		rm -rf "$(ALERTMANAGER_UI_STAGING)"; \
	fi
	@cd "$(PROJECT_ROOT)/upstream/alertmanager" && "$(GO_BIN)" build -o alertmanager$(EXE) ./cmd/alertmanager
	@cd "$(PROJECT_ROOT)/upstream/alertmanager" && "$(GO_BIN)" build -o amtool$(EXE) ./cmd/amtool

build-blackbox-exporter: ensure-go
	@echo ">>> Building upstream blackbox_exporter"
	@cd "$(PROJECT_ROOT)/upstream/blackbox_exporter" && "$(GO_BIN)" build -o blackbox_exporter$(EXE) ./

# Center bundle: control plane + Prometheus + Alertmanager + blackbox exporter + Custom UI.
# Use this target when preparing a test/production deployment package.
build-center: build-metric-center build-prometheus build-alertmanager build-blackbox-exporter build-ui

build-all: build-metric-center build-prometheus build-ui

# Package the center bundle into dist/metric-center-bundle-<os>-<arch>-<timestamp>.tar.gz.
# Supports cross-compilation via CROSS=linux/amd64 (requires zig for CGO).
package-center:
	@echo ">>> Packaging center bundle"
	@bash "$(PROJECT_ROOT)/scripts/package-center.sh"

# -----------------------------------------------------------------------------
# 运行
# -----------------------------------------------------------------------------

# 依赖文件目标 $(PROMTOOL_BIN)/$(AMTOOL_BIN) 而非 build-promtool/build-amtool：
# 后者每次必跑 go build，GOPROXY 慢时会挂死启动链；文件目标二进制已存在即跳过。
run-metric-center: build-metric-center $(PROMTOOL_BIN) $(AMTOOL_BIN)
	@echo ">>> Starting metric-center"
	@cd "$(PROJECT_ROOT)" && \
		NOTIFY_BRIDGE_URL="$(NOTIFY_BRIDGE_URL)" \
		NOTIFY_BRIDGE_TOKEN="$(NOTIFY_BRIDGE_TOKEN)" \
		NOTIFY_RENDER_TIMEZONE="$(NOTIFY_RENDER_TIMEZONE)" \
		./platform/cmd/metric-center/metric-center$(EXE) \
		--config.reload-url=http://localhost:9090/-/reload

# M09 local 下发闭环：config.file 必须指向 config-output/prometheus.yml（控制面
# DiskApplier 的写盘目录），且 file_sd 相对路径 targets/*.json 按配置文件所在目录
# 解析；--web.enable-lifecycle 开放 /-/reload 供控制面在结构变更后触发热加载。
# G1（设计提案 §7-G1）：--web.enable-remote-write-receiver 开启中心 Prometheus 的
# remote_write 接收端，作为边缘 vmagent 指标上报入口，对接 edge-sync-agent
# probe.go 默认上报地址 http://127.0.0.1:9090/api/v1/write（自 Prometheus 2.40 起可用）。
# 回传延迟 p95 口径：--enable-feature=promql-experimental-functions 启用
# ts_of_last_over_time（F-40 延展 SampleLagQueryExpr 依赖；未开时延迟查询降级为无数据）。
run-prometheus: build-prometheus
	@echo ">>> Starting Prometheus"
	@mkdir -p "$(PROJECT_ROOT)/config-output"
	@if [ ! -f "$(PROJECT_ROOT)/config-output/prometheus.yml" ]; then \
		echo ">>> Seeding config-output/prometheus.yml from project template (deploy/prometheus/prometheus.yml)"; \
		cp "$(PROJECT_ROOT)/deploy/prometheus/prometheus.yml" \
			"$(PROJECT_ROOT)/config-output/prometheus.yml"; \
	fi
	# 非嵌入模式从 CWD 读取 Web UI，须在 upstream/prometheus 下启动才能加载
	# mantine-ui 静态资源；config.file 为绝对路径，file_sd 相对路径按其所在
	# directory（config-output）解析，均不受 CWD 影响。
	#
	# ⚠️ TSDB 必须显式给**绝对路径**且**放在子模块之外**（$(PROJECT_ROOT)/data/prometheus）：
	#   - 不设 --storage.tsdb.path 时 Prometheus 用默认相对路径 `data/`，会按 CWD 解析到
	#     upstream/prometheus/data/ —— 即**写在 git 子模块目录内**。清理上游目录 /
	#     子模块重置 / 换机都会连带丢掉全部历史（2026-10-09 实测：数据停在 9/30、
	#     maxTime 不前进，边缘 up 一条没落库，排查绕大弯）。
	#   - 与生产打包件对齐（scripts/package-center.sh:429 亦用绝对路径 $DATA_ROOT/prometheus）。
	@mkdir -p "$(PROJECT_ROOT)/data/prometheus"
	# M06 F-41：读取「存储与日志管理」页写入的保留策略 env 文件（config-output/prom-retention.env，
	# 页面保存 → 重启 Prometheus 生效）。优先级：命令行/环境变量显式覆盖 > env 文件 > 上方 ?= 默认。
	@RET_ENV="$(PROJECT_ROOT)/config-output/prom-retention.env"; \
		RET_TIME="$(PROM_RETENTION_TIME)"; \
		RET_SIZE="$(PROM_RETENTION_SIZE)"; \
		if [ -f "$$RET_ENV" ]; then \
			. "$$RET_ENV"; \
			if [ "$(origin PROM_RETENTION_TIME)" = "file" ]; then RET_TIME="$${PROM_RETENTION_TIME:-$$RET_TIME}"; fi; \
			if [ "$(origin PROM_RETENTION_SIZE)" = "file" ]; then RET_SIZE="$${PROM_RETENTION_SIZE:-$$RET_SIZE}"; fi; \
			echo ">>> TSDB retention from prom-retention.env: time=$$RET_TIME size=$$RET_SIZE"; \
		fi; \
		cd "$(PROJECT_ROOT)/upstream/prometheus" && ./prometheus$(EXE) \
			--config.file="$(PROJECT_ROOT)/config-output/prometheus.yml" \
			--storage.tsdb.path="$(PROJECT_ROOT)/data/prometheus" \
			--storage.tsdb.retention.time="$$RET_TIME" \
			--storage.tsdb.retention.size="$$RET_SIZE" \
			--enable-feature=promql-experimental-functions \
			--web.enable-lifecycle \
			--web.enable-remote-write-receiver \
			--web.listen-address=127.0.0.1:9090
# 注：--web.listen-address 收束至 127.0.0.1 —— remote_write receiver (--web.enable-remote-write-receiver)
# 无内置写认证，仅暴露给本机 metric-center 查询代理与受控边缘写方；对外暴露由 G2 nginx（IP 白名单 +
# TLS 终结 + per-domain Token）在生产部署承接。见 design-decisions 决策 1。

# 启动中心 Alertmanager（M08 静默代理 + AM 配置挂载 reload 目标）：控制面
# --alertmanager.url 缺省 http://localhost:9093；静默列表依赖本服务在线。
# config.file 指向 config-output/alertmanager.yml（DiskApplier 写盘目录）；
# Alertmanager 与 Prometheus 不同，无 --web.enable-lifecycle，配置变更由其在
# --config.file 写入后自动热加载（fsnotify 监视文件变更），/-/reload 亦可触发。
# amtool 已由依赖 build-alertmanager 一并构建，供 AM 配置校验使用。
run-alertmanager: build-alertmanager
	@echo ">>> Starting Alertmanager"
	@mkdir -p "$(PROJECT_ROOT)/config-output"
	@if [ ! -f "$(PROJECT_ROOT)/config-output/alertmanager.yml" ]; then \
		echo ">>> Seeding config-output/alertmanager.yml from project template (deploy/alertmanager/alertmanager.yml)"; \
		cp "$(PROJECT_ROOT)/deploy/alertmanager/alertmanager.yml" \
			"$(PROJECT_ROOT)/config-output/alertmanager.yml"; \
	fi
	@cd "$(PROJECT_ROOT)/upstream/alertmanager" && ./alertmanager$(EXE) \
		--config.file="$(PROJECT_ROOT)/config-output/alertmanager.yml" \
		--web.listen-address=:9093

dev-ui:
	@echo ">>> Starting Custom UI dev server"
	@cd "$(PROJECT_ROOT)/ui-custom/web" && \
	if [ -x "node_modules/.bin/vite" ]; then \
		echo ">>> node_modules present; skipping toolchain download and starting vite directly"; \
		exec "node_modules/.bin/vite"; \
	else \
		$(MAKE) ensure-pnpm && \
		"$(PNPM_BIN)" install && \
		exec "node_modules/.bin/vite"; \
	fi

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
	@rm -f "$(PROJECT_ROOT)/upstream/alertmanager/amtool"
	@rm -f "$(PROJECT_ROOT)/upstream/node_exporter/node_exporter$(EXE)"
	@rm -f "$(PROJECT_ROOT)/upstream/alertmanager/alertmanager$(EXE)"
	@rm -f "$(PROJECT_ROOT)/upstream/blackbox_exporter/blackbox_exporter$(EXE)"
	@rm -rf "$(PROJECT_ROOT)/ui-custom/web/dist"
	@rm -rf "$(PROJECT_ROOT)/ui-custom/web/node_modules"

# -----------------------------------------------------------------------------
# 文档与符号地图
# -----------------------------------------------------------------------------

# 生成业务代码符号地图（platform/ + ui-custom/web/src/），供 Agent 排障时
# 按「符号 → 文件」快速定位；upstream/ 上游子模块刻意不索引。
repo-map: ensure-go
	@echo ">>> Generating repo map"
	@cd "$(PROJECT_ROOT)" && "$(GO_BIN)" run ./scripts/repo-map -o docs/04-source-architecture/repo-map.md

# 校验符号地图新鲜度（重新生成并对比，忽略头部时间戳行）。
# 已被 pre-commit hook 与 CI（check-repo-map.yml）强制调用。
check-repo-map: ensure-go
	@echo ">>> Checking repo map freshness"
	@bash "$(PROJECT_ROOT)/scripts/check-repo-map.sh"

# 启用项目级 git hooks（core.hooksPath=scripts/git-hooks）
install-git-hooks:
	@bash "$(PROJECT_ROOT)/scripts/install-git-hooks.sh"

# -----------------------------------------------------------------------------
# 文档与原型规范检查
# -----------------------------------------------------------------------------

check-prd-hygiene:
	@echo ">>> Checking PRD hygiene (decision markers / frozen chapter structure)"
	@bash "$(PROJECT_ROOT)/scripts/check-prd-hygiene.sh"

check-prototype-notes:
	@echo ">>> Checking prototype user-visible notes for leaked decision markers"
	@bash "$(PROJECT_ROOT)/scripts/check-prototype-notes.sh"

check-prototype:
	@echo ">>> Checking prototype marker leaks + structural anti-patterns"
	@bash "$(PROJECT_ROOT)/scripts/check-prototype.sh"
