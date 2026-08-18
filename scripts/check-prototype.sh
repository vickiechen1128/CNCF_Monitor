#!/usr/bin/env bash
# 原型规范检查入口（文案泄漏 + 结构反模式）。
# 用法: check-prototype.sh [module-XX] [--markers-only|--structure-only] [--strict]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/check-prototype.py" "$@"
