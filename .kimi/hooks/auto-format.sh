#!/bin/bash
# auto-format.sh
# 在 Write/Edit 工具后自动格式化代码
# 事件：PostToolUse

set -e

# 获取变更的文件列表（简化版，实际由 Kimi hook 框架注入）
FILES="$@"

for file in $FILES; do
    case "$file" in
        *.go)
            echo "[auto-format] Formatting $file"
            gofmt -w "$file" || true
            ;;
        *.ts|*.tsx|*.js|*.jsx)
            echo "[auto-format] Formatting $file"
            cd ui-custom/web && pnpm prettier --write "$file" || true
            ;;
    esac
done
