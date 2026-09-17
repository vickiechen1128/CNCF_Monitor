#!/usr/bin/env bash
# scripts/install-git-hooks.sh
# 启用项目级 git hooks：将 core.hooksPath 指向仓库内的 scripts/git-hooks/。
# 幂等，可重复执行；worktree 场景下相对路径按各 worktree 根解析。
# 如需停用：git config --unset core.hooksPath

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

chmod +x scripts/git-hooks/pre-commit
git config core.hooksPath scripts/git-hooks

echo ">>> git hooks installed: core.hooksPath=$(git config core.hooksPath)"
echo ">>> 停用方式：git config --unset core.hooksPath"
