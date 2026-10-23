#!/usr/bin/env bash
# scripts/ci/check-backend-arch.sh
# 检查后端增量代码是否符合 feature-debt-control.md 的 R1-R4 红线。

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

echo "=== Check Backend Architecture (R1-R4) ==="
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
MODEL_DIFF=$(git diff "$COMPARE" -- 'platform/models/*.go' ':!platform/models/*_test.go' || true)
if echo "$MODEL_DIFF" | grep -E '^\+.*(gorm:"|type\s+\w+\s+struct)' >/dev/null; then
    if ! echo "$DIFF_NAMES" | grep -q '^platform/db/migrations/'; then
        echo "ERROR [R2]: platform/models/ 出现新增 struct 或 gorm 字段，但未在 platform/db/migrations/ 提供 migration。"
        echo ""
        ERRORS=$((ERRORS + 1))
    fi
fi

# R3: 业务代码禁止新增字符串字段映射（resource_fields.go 自身除外）
FIELD_DIFF=$(git diff "$COMPARE" -- platform/ ':!platform/models/resource_fields.go' || true)
if echo "$FIELD_DIFF" | grep -E '^\+.*(GetResourceField|LegacyFieldMap)' >/dev/null; then
    echo "ERROR [R3]: 业务代码中新增 models.GetResourceField / LegacyFieldMap 调用，必须改为类型化方法。"
    echo "$FIELD_DIFF" | grep -E '^\+.*(GetResourceField|LegacyFieldMap)' || true
    echo ""
    ERRORS=$((ERRORS + 1))
fi

# R4: 禁止在中央文件新增注册 / AutoMigrate
MAIN_DIFF=$(git diff "$COMPARE" -- platform/cmd/metric-center/main.go || true)
DB_DIFF=$(git diff "$COMPARE" -- platform/db/db.go || true)
if echo "$MAIN_DIFF" | grep -E '^\+.*RegisterRoutes' >/dev/null; then
    echo "ERROR [R4]: platform/cmd/metric-center/main.go 新增 RegisterRoutes 调用，违反模块自注册原则。"
    echo ""
    ERRORS=$((ERRORS + 1))
fi
if echo "$DB_DIFF" | grep -E '^\+.*AutoMigrate' >/dev/null; then
    echo "ERROR [R4]: platform/db/db.go 新增 AutoMigrate 条目，违反 migration-first 原则。"
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
