#!/bin/bash
# setup.sh - CNCF_Monitor 一键初始化脚本

set -e

echo ">>> CNCF_Monitor setup started"

# 1. 安装工具链
echo ">>> Installing toolchains (Go, Node.js, pnpm)"
make install-tools

# 2. 编译 MetricCenter 控制面后端
echo ">>> Building metric-center backend"
make build-metric-center

# 3. 初始化前端（如果存在）
if [ -d "ui-custom/web" ]; then
    echo ">>> Installing frontend dependencies"
    cd ui-custom/web
    pnpm install
    cd ../..
fi

# 4. 运行后端测试
echo ">>> Running backend tests"
make test-platform || true

# 5. 安装 Kimi hooks
echo ">>> Installing Kimi hooks"
bash install-hooks.sh

echo ">>> CNCF_Monitor setup completed"
echo ""
echo "Next steps:"
echo "  make run-prometheus       # 启动 Prometheus"
echo "  make dev-ui               # 启动前端开发服务器"
