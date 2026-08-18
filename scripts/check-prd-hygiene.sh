#!/usr/bin/env bash
# 检查 PRD 是否满足 v1.27 规范：去历史化、章节编号冻结、前端交互契约。
# 只检测，不自动改写；输出是非零当存在需整改项。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRD_DIR="$ROOT_DIR/docs/02-product-requirements/Modules"

EXPECTED_CHAPTERS=(
  "模块目标"
  "用户故事"
  "核心功能"
  "核心流程"
  "数据模型"
  "接口设计"
  "依赖"
  "数据模型状态机"
  "验收标准"
  "术语映射"
  "前端交互契约"
)

# 将标题结尾的括号注释、版本标记、空白去掉，仅比较核心名称
normalize_title() {
  echo "$1" | sed -E 's/[[:space:]]*(（[^）]*）|\{[^}]*\})*$//' | sed -E 's/[[:space:]]+$//'
}

status=0

for file in "$PRD_DIR"/Module_*.md; do
  [ -f "$file" ] || continue
  name=$(basename "$file")

  # Module_00 是集成地图，不走模块 PRD 骨架
  if [ "$name" = "Module_00_Integration_Map.md" ]; then
    echo "== $name =="
    echo "  （集成地图，不按模块 PRD 骨架检查）"
    echo ""
    continue
  fi

  echo "== $name =="

  # 正文 = Change Log 之前的部分
  body=$(awk '/^## Change Log/{exit} {print}' "$file")

  # 1. 内联决策/版本标注计数（按出现次数而非行数）
  decision_count=$(grep -oE '决策[[:space:]]*[0-9]' <<< "$body" 2>/dev/null | wc -l | awk '{print $1}') || true
  version_count=$(grep -oE '\{v[0-9]+\.[^}]+\}' <<< "$body" 2>/dev/null | wc -l | awk '{print $1}') || true
  decision_count=${decision_count:-0}
  version_count=${version_count:-0}
  echo "  内联决策标注数: $decision_count"
  echo "  内联版本标记数: $version_count"
  if [ "$decision_count" -gt 0 ] || [ "$version_count" -gt 0 ]; then
    status=1
  fi

  # 2. 章节结构核对：收集所有 "## N. 标题" 行
  echo "  章节结构:"
  actual_titles=()
  for ((i = 0; i <= ${#EXPECTED_CHAPTERS[@]}; i++)); do
    actual_titles+=("")
  done
  changelog_numbered=0

  while IFS= read -r line; do
    chap_num=$(echo "$line" | sed -E 's/^[0-9]+:## ([0-9]+)\. .*/\1/')
    chap_title=$(echo "$line" | sed -E 's/^[0-9]+:## [0-9]+\. //')
    normalized=$(normalize_title "$chap_title")
    if [ "$normalized" = "Change Log" ]; then
      changelog_numbered=1
      continue
    fi
    if [ "$chap_num" -ge 1 ] && [ "$chap_num" -le ${#EXPECTED_CHAPTERS[@]} ]; then
      actual_titles[$chap_num]="$normalized"
    fi
  done < <(grep -nE '^## [0-9]+\. ' "$file" || true)

  for i in "${!EXPECTED_CHAPTERS[@]}"; do
    idx=$((i + 1))
    expected_title="${EXPECTED_CHAPTERS[$i]}"
    actual_title="${actual_titles[$idx]}"
    if [ -z "$actual_title" ]; then
      echo "    [缺] 第 $idx 章 $expected_title"
      status=1
    elif [ "$actual_title" != "$expected_title" ]; then
      echo "    [偏] 第 $idx 章期望: $expected_title, 实际: $actual_title"
      status=1
    else
      echo "    [OK] $idx. $actual_title"
    fi
  done

  if [ "$changelog_numbered" -eq 1 ]; then
    echo "    [偏] Change Log 作为编号章节出现；应为 ## Change Log（无编号）"
    status=1
  fi

  # 3. Change Log 存在性
  if ! grep -qE '^## Change Log' "$file"; then
    echo "    [缺] Change Log 章节"
    status=1
  fi

  echo ""
done

if [ "$status" -ne 0 ]; then
  echo "发现需整改项。请按 prototype-designer.md v1.27 规范进行 PRD 去历史化与章节对齐。"
fi
exit "$status"
