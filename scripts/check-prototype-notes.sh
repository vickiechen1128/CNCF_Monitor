#!/usr/bin/env bash
# 兼容入口：仅做"用户可见文案泄漏"检查。
# 实际逻辑在 check-prototype.py（多行 JSX 属性感知）。
# 用法: check-prototype-notes.sh [module-XX]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/check-prototype.py" --markers-only "$@"
