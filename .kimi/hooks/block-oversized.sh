#!/bin/bash
# block-oversized.sh
# 阻止写入超过 800 行的文件
# 事件：PreToolUse (Write)

set -e

FILE="$1"
MAX_LINES=800

if [ -f "$FILE" ]; then
    LINES=$(wc -l < "$FILE")
    if [ "$LINES" -gt "$MAX_LINES" ]; then
        echo "[block-oversized] ERROR: $FILE has $LINES lines, exceeding max $MAX_LINES"
        echo "Please split this file into smaller modules."
        exit 1
    fi
fi
