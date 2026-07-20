#!/bin/bash
# protect-env.sh
# 阻止直接修改敏感文件
# 事件：PreToolUse (Write/Edit)

set -e

FILE="$1"

# 需要保护的文件模式
PATTERNS=(
    ".env"
    ".env.*"
    "*credentials*"
    "*secret*"
    "*.pem"
    "*.key"
)

for pattern in "${PATTERNS[@]}"; do
    if [[ "$(basename "$FILE")" == $pattern ]]; then
        echo "[protect-env] ERROR: Direct modification of sensitive file $FILE is not allowed"
        echo "Use environment variables or a secret management tool instead."
        exit 1
    fi
done
