# MetricCenter - Unified Build Makefile
# 本 Makefile 负责管理 Go/Node.js/pnpm 工具链，并统一构建 Prometheus 后端与 Custom UI

PROJECT_ROOT := $(shell pwd)
TOOLS_DIR := $(PROJECT_ROOT)/.tools
GO_DIR := $(TOOLS_DIR)/go
NODE_DIR := $(TOOLS_DIR)/node
PNPM_DIR := $(TOOLS_DIR)/pnpm

GO_VERSION := 1.26.1
NODE_VERSION := 22.14.0

UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# 根据系统架构选择下载地址
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
endif

GO_BIN := $(GO_DIR)/bin/go
NODE_BIN := $(NODE_DIR)/bin/node
NPM_BIN := $(NODE_DIR)/bin/npm
PNPM_BIN := $(PNPM_DIR)/bin/pnpm

export PATH := $(GO_DIR)/bin:$(NODE_DIR)/bin:$(PNPM_DIR)/bin:$(PATH)

.PHONY: all help install-go install-node install-pnpm install-tools \
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
		curl -L -o /tmp/go.tar.gz "$(GO_URL)"; \
		tar -C "$(GO_DIR)" --strip-components=1 -xzf /tmp/go.tar.gz; \
		rm /tmp/go.tar.gz; \
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
		curl -L -o /tmp/node.tar.gz "$(NODE_URL)"; \
		tar -C "$(NODE_DIR)" --strip-components=1 -xzf /tmp/node.tar.gz; \
		rm /tmp/node.tar.gz; \
		"$(NODE_BIN)" --version; \
	else \
		echo ">>> Node.js already installed: $(NODE_BIN)"; \
		"$(NODE_BIN)" --version; \
	fi

install-pnpm: install-node
	@if [ ! -f "$(PNPM_BIN)" ]; then \
		echo ">>> Installing pnpm to $(PNPM_DIR)"; \
		mkdir -p "$(PNPM_DIR)"; \
		"$(NPM_BIN)" install -g --prefix="$(PNPM_DIR)" pnpm@9; \
		"$(PNPM_BIN)" --version; \
	else \
		echo ">>> pnpm already installed: $(PNPM_BIN)"; \
		"$(PNPM_BIN)" --version; \
	fi

install-tools: install-go install-node install-pnpm

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

build-metric-center: ensure-go
	@echo ">>> Building metric-center"
	@cd "$(PROJECT_ROOT)" && "$(GO_BIN)" build -o platform/cmd/metric-center/metric-center ./platform/cmd/metric-center

build-prometheus: ensure-go
	@echo ">>> Building upstream Prometheus"
	@cd "$(PROJECT_ROOT)/upstream/prometheus" && "$(GO_BIN)" build -o prometheus ./cmd/prometheus

build-ui: ensure-pnpm
	@echo ">>> Building Custom UI"
	@cd "$(PROJECT_ROOT)/ui-custom/web" && "$(PNPM_BIN)" install && "$(PNPM_BIN)" run build

build-all: build-metric-center build-prometheus build-ui

# -----------------------------------------------------------------------------
# 运行
# -----------------------------------------------------------------------------

run-metric-center: build-metric-center
	@echo ">>> Starting metric-center"
	@cd "$(PROJECT_ROOT)" && ./platform/cmd/metric-center/metric-center

run-prometheus: build-prometheus
	@echo ">>> Starting Prometheus"
	@cd "$(PROJECT_ROOT)" && ./upstream/prometheus/prometheus \
		--config.file="$(PROJECT_ROOT)/upstream/prometheus/prometheus.yml" \
		--web.listen-address=:9090

dev-ui: ensure-pnpm
	@echo ">>> Starting Custom UI dev server"
	@cd "$(PROJECT_ROOT)/ui-custom/web" && "$(PNPM_BIN)" install && exec "$(PROJECT_ROOT)/ui-custom/web/node_modules/.bin/vite"

# -----------------------------------------------------------------------------
# 测试与清理
# -----------------------------------------------------------------------------

test-platform: ensure-go
	@echo ">>> Running platform tests"
	@cd "$(PROJECT_ROOT)" && "$(GO_BIN)" test ./platform/...

clean:
	@echo ">>> Cleaning build artifacts"
	@rm -f "$(PROJECT_ROOT)/platform/cmd/metric-center/metric-center"
	@rm -f "$(PROJECT_ROOT)/upstream/prometheus/prometheus"
	@rm -f "$(PROJECT_ROOT)/upstream/prometheus/promtool"
	@rm -f "$(PROJECT_ROOT)/upstream/node_exporter/node_exporter"
	@rm -rf "$(PROJECT_ROOT)/ui-custom/web/dist"
	@rm -rf "$(PROJECT_ROOT)/ui-custom/web/node_modules"
