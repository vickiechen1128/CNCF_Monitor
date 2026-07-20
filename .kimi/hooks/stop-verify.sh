#!/bin/bash
# stop-verify.sh
# 会话结束前自动运行测试和 lint
# 事件：Stop

set -e

echo "[stop-verify] Running platform tests..."
go test ./platform/... || {
    echo "[stop-verify] ERROR: platform tests failed"
    exit 1
}

echo "[stop-verify] Running go vet..."
go vet ./platform/... || {
    echo "[stop-verify] ERROR: go vet failed"
    exit 1
}

if [ -d "ui-custom/web" ]; then
    echo "[stop-verify] Running frontend lint..."
    cd ui-custom/web
    pnpm lint || {
        echo "[stop-verify] ERROR: frontend lint failed"
        exit 1
    }
fi

echo "[stop-verify] All checks passed"
