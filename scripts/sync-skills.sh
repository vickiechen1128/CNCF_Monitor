#!/usr/bin/env bash
# scripts/sync-skills.sh
# 将 .kimi/skills/ 同步到跨工具共享目录 .agents/skills/。
#
# 用法：
#   bash scripts/sync-skills.sh          # 同步
#   bash scripts/sync-skills.sh check    # 只校验，不修改

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MODE="${1:-sync}"

case "$MODE" in
    sync|check) ;;
    *)
        echo "用法: bash scripts/sync-skills.sh [sync|check]" >&2
        exit 2
        ;;
esac

if [[ ! -d .kimi/skills ]]; then
    echo "ERROR: .kimi/skills 不存在" >&2
    exit 1
fi

mkdir -p .agents/skills

write_readme() {
    cat > .agents/README.md <<'EOF'
# 跨工具共享资产

本目录中的 `skills/` 由 `scripts/sync-skills.sh` 从 `.kimi/skills/` 生成，**请勿直接修改**。

- 单一源：`.kimi/skills/`
- 共享镜像：`.agents/skills/`
- 同步：`bash scripts/sync-skills.sh`
- 校验：`bash scripts/sync-skills.sh check`

OpenCode、Trae、Kimi Code CLI 会自动发现 `.agents/skills/` 下的 `SKILL.md`。
EOF
}

check_frontmatter() {
    local failed=0
    local f
    for f in .kimi/skills/*/SKILL.md; do
        if ! grep -q '^name:' "$f"; then
            echo "ERROR: $f 缺少 name frontmatter" >&2
            failed=1
        fi
        if ! grep -q '^description:' "$f"; then
            echo "ERROR: $f 缺少 description frontmatter" >&2
            failed=1
        fi
    done
    return "$failed"
}

if [[ "$MODE" == "check" ]]; then
    if ! check_frontmatter; then
        exit 1
    fi

    if command -v rsync >/dev/null 2>&1; then
        output="$(rsync -a --dry-run --delete --exclude='.DS_Store' .kimi/skills/ .agents/skills/ 2>&1 || true)"
        if [[ -n "$output" ]]; then
            echo "ERROR: .agents/skills 与 .kimi/skills 不同步，请运行 bash scripts/sync-skills.sh" >&2
            echo "$output" >&2
            exit 1
        fi
    else
        # 无 rsync 时的降级校验：逐文件比较，忽略 .DS_Store
        diff_output="$(diff -rq .kimi/skills .agents/skills 2>&1 || true)"
        diff_output="$(printf '%s\n' "$diff_output" | grep -v 'Only in .agents/skills: .DS_Store' | grep -v 'Only in .kimi/skills: .DS_Store' || true)"
        if [[ -n "$diff_output" ]]; then
            echo "ERROR: .agents/skills 与 .kimi/skills 不同步，请运行 bash scripts/sync-skills.sh" >&2
            echo "$diff_output" >&2
            exit 1
        fi
    fi
    echo "OK: .agents/skills 与 .kimi/skills 已同步。"
    exit 0
fi

if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='.DS_Store' .kimi/skills/ .agents/skills/
else
    # 无 rsync 时的降级同步：清理旧目录后复制
    find .agents/skills -mindepth 1 -maxdepth 1 ! -name '.DS_Store' -exec rm -rf {} +
    find .kimi/skills -mindepth 1 -maxdepth 1 ! -name '.DS_Store' -exec cp -R {} .agents/skills/ \;
fi

write_readme
echo "OK: 已同步 .kimi/skills -> .agents/skills"
