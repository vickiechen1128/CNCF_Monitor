#!/usr/bin/env bash
# scripts/ci/check-backend-arch.sh
# 检查后端增量代码是否符合
# docs/03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md
# 的 V3 架构红线（R1/R2/R4）。

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BASE_REF="${GITHUB_BASE_REF:-develop}"
REMOTE_BASE="origin/${BASE_REF}"

if git rev-parse --verify "$REMOTE_BASE" >/dev/null 2>&1; then
    COMPARE="$REMOTE_BASE...HEAD"
else
    # 本地测试或 base 不可用时回退到上一个 commit
    COMPARE="HEAD~1"
fi

DIFF_NAMES=$(git diff --name-only --diff-filter=ACMRT "$COMPARE" || true)
if [[ -z "$DIFF_NAMES" ]]; then
    echo "No changed files to check."
    exit 0
fi

ERRORS=0

echo "=== Check Backend Architecture (R1/R2/R4) ==="
echo "compare range: $COMPARE"
echo ""

# R1: 新增 handler 禁止直接依赖 *gorm.DB
HANDLER_DIFF=$(git diff "$COMPARE" -- 'platform/**/*.go' ':!platform/**/*_test.go' || true)
if echo "$HANDLER_DIFF" | grep -E '^\+.*func .*gin\.HandlerFunc' | grep -E 'db \*gorm\.DB' >/dev/null; then
    echo "ERROR [R1]: 新增 handler 直接依赖 *gorm.DB，必须改为 service 注入。"
    echo "$HANDLER_DIFF" | grep -E '^\+.*func .*gin\.HandlerFunc' | grep -E 'db \*gorm\.DB' || true
    echo ""
    ERRORS=$((ERRORS + 1))
fi

# R2: 模型 schema 变更必须提供 migration
MODEL_DIFF=$(git diff "$COMPARE" -- 'platform/models/*.go' 'platform/modules/**/*.go' ':!platform/**/*_test.go' || true)
if echo "$MODEL_DIFF" | grep -E '^\+.*gorm:"' >/dev/null; then
    if ! echo "$DIFF_NAMES" | grep -q '^platform/db/migrations/v3/'; then
        echo "ERROR [R2]: 新增 gorm 字段/模型，但未在 platform/db/migrations/v3/ 提供 migration。"
        echo ""
        ERRORS=$((ERRORS + 1))
    fi
fi

# R4: 禁止在 main.go 新增逐条路由注册（模块应通过 foundation/module.Registry 注册）
MAIN_DIFF=$(git diff "$COMPARE" -- platform/cmd/metric-center/main.go || true)
if echo "$MAIN_DIFF" | grep -E '^\+.*RegisterRoutes' >/dev/null; then
    echo "ERROR [R4]: platform/cmd/metric-center/main.go 新增 RegisterRoutes 调用，违反模块自注册原则。"
    echo ""
    ERRORS=$((ERRORS + 1))
fi

if [[ "$ERRORS" -eq 0 ]]; then
    echo "PASS: 后端架构红线检查通过。"
    exit 0
else
    echo "Total errors: $ERRORS"
    exit 1
fi
