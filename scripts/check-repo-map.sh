#!/usr/bin/env bash
# scripts/check-repo-map.sh
# 校验 repo-map 新鲜度：重新生成到临时文件，与已提交版本对比。
# 头部「生成时间 / commit」行每次生成都变化，对比前剥离；其余内容（符号清单）
# 有任何差异即视为过期。本脚本只读（临时文件用完即删），不修改仓库内容。
#
# 退出码：0 = 新鲜；1 = 过期/缺失/环境不可用。
#
# 调用方：git pre-commit hook、CI（check-repo-map.yml）、review-precheck.sh、
# 以及手动执行 `make check-repo-map`。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

MAP="docs/04-source-architecture/repo-map.md"

# Go 选择：优先项目级工具链 .tools/go/bin/go(.exe)，回退 PATH 中的 go（CI 走 setup-go）
GO=""
for c in ".tools/go/bin/go" ".tools/go/bin/go.exe"; do
  if [ -x "$c" ]; then GO="$c"; break; fi
done
if [ -z "$GO" ]; then
  GO="$(command -v go || true)"
fi
if [ -z "$GO" ]; then
  echo "ERROR: 未找到 go（.tools/go/bin/go 或 PATH），无法重新生成 repo-map 进行校验" >&2
  exit 1
fi

if [ ! -f "$MAP" ]; then
  echo "ERROR: $MAP 不存在。请运行 make repo-map 生成并提交。" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

"$GO" run ./scripts/repo-map -o "$TMP" >/dev/null

# 剥离含时间戳/commit 的头部行（每次生成都不同，不属于代码漂移）
strip_header() {
  grep -v '^> 生成时间:' "$1"
}

if ! diff <(strip_header "$MAP") <(strip_header "$TMP") >/dev/null; then
  echo "ERROR: repo-map 已过期 —— $MAP 中的符号清单与当前代码不一致。" >&2
  echo "修复：make repo-map && git add $MAP" >&2
  exit 1
fi

echo "OK: repo-map 与当前业务代码一致"
