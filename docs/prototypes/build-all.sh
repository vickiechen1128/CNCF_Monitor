#!/usr/bin/env bash
set -euo pipefail

# 构建 docs/prototypes/ 下的所有模块原型
# 用法：cd docs/prototypes && ./build-all.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

for module_dir in module-*/; do
  if [ -d "$module_dir" ]; then
    echo ""
    echo "==> 构建 $module_dir"
    cd "$module_dir"
    pnpm install
    pnpm run build
    cd "$SCRIPT_DIR"
  fi
done

echo ""
echo "==> 全部模块构建完成"
echo "可通过以下命令启动统一静态预览："
echo "  python3 -m http.server 8080"
echo "然后访问 http://localhost:8080/"
