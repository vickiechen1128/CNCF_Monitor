#!/usr/bin/env bash
# scripts/review-precheck.sh
# Orchestrator 审查预检脚本：输出结构化预检报告，供 reviewer 采信命中清单。
# 本脚本只读，不修改源码；由 orchestrator 在派发 reviewer 前调用。

set -euo pipefail

BASE_BRANCH="develop"
MODULE=""
OUT_FILE=""
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  echo "Usage: $0 [-b <base_branch>] [-m <module-XX>] [-o <output.md>]" >&2
  exit 1
}

while getopts ":b:m:o:" opt; do
  case $opt in
    b) BASE_BRANCH="$OPTARG" ;;
    m) MODULE="$OPTARG" ;;
    o) OUT_FILE="$OPTARG" ;;
    *) usage ;;
  esac
done

cd "$REPO_ROOT"

# Detect module from current branch if not provided
if [[ -z "$MODULE" ]]; then
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [[ "$current_branch" =~ ^feat/module-([0-9]{2})$ ]]; then
    MODULE="module-${BASH_REMATCH[1]}"
  else
    echo "ERROR: cannot detect module from branch '$current_branch'; use -m module-XX" >&2
    exit 1
  fi
fi

if [[ -z "$OUT_FILE" ]]; then
  OUT_FILE="$REPO_ROOT/docs/05-execution-records/$MODULE/review-precheck.md"
fi

mkdir -p "$(dirname "$OUT_FILE")"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: not a git repository" >&2
  exit 1
fi

CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD -- 2>/dev/null || true)

current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# 安全扫描只关注实际代码目录，避免 docs/.kimi/ 等干扰
SCAN_PREFIXES=("platform/" "ui-custom/web/" "deploy/" "patches/prometheus/")

in_scan_scope() {
  local f="$1"
  for p in "${SCAN_PREFIXES[@]}"; do
    [[ "$f" == "$p"* ]] && return 0
  done
  return 1
}

# Directory isolation: allowed prefixes by reviewer scope
check_isolation() {
  local scope="$1"
  local allowed="$2"
  local violations=""
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    local ok=0
    for p in $allowed; do
      if [[ "$f" == "$p"* ]]; then ok=1; break; fi
    done
    if [[ $ok -eq 0 ]]; then
      violations="${violations}\n- $f"
    fi
  done <<< "$CHANGED_FILES"

  if [[ -n "$violations" ]]; then
    echo -e "- **$scope** 目录隔离：检测到越界文件$violations"
  else
    echo "- **$scope** 目录隔离：通过"
  fi
}

# Grep for SSRF / URL validation
check_ssrf() {
  local hits=""
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    in_scan_scope "$f" || continue
    if grep -IEq 'url\.Parse\(|http\.Get\(|http\.Post\(|http\.Client|httputil\.ReverseProxy|ProxyPass' "$f"; then
      if ! grep -IEq 'scheme|host|ValidateURL|allowedHosts|URL whitelist' "$f"; then
        hits="${hits}\n- $f: 存在 URL 解析/请求入口，未在文件中同时发现 scheme/host 校验关键词"
      fi
    fi
  done <<< "$CHANGED_FILES"

  if [[ -n "$hits" ]]; then
    echo -e "- **SSRF 预检**：命中$hits"
  else
    echo "- **SSRF 预检**：未命中"
  fi
}

# Hardcoded secrets
check_secrets() {
  local tmp_pat
  tmp_pat=$(mktemp)
  cat > "$tmp_pat" <<'EOF'
password[[:space:]]*=[[:space:]]*["'][^"']{4,}
secret[[:space:]]*=[[:space:]]*["'][^"']{4,}
api[-_]?key[[:space:]]*=[[:space:]]*["'][^"']{4,}
token[[:space:]]*=[[:space:]]*["'][^"']{4,}
private[-_]?key
-----BEGIN
EOF

  local hits=""
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    in_scan_scope "$f" || continue
    local found=""
    found=$(grep -IEnf "$tmp_pat" "$f" 2>/dev/null || true)
    if [[ -n "$found" ]]; then
      hits="${hits}\n- $f: 发现疑似硬编码敏感信息\n\`\`\`\n$found\n\`\`\`"
    fi
  done <<< "$CHANGED_FILES"

  rm -f "$tmp_pat"

  if [[ -n "$hits" ]]; then
    echo -e "- **敏感信息预检**：命中$hits"
  else
    echo "- **敏感信息预检**：未命中"
  fi
}

# Injection patterns
check_injection() {
  local hits=""
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    in_scan_scope "$f" || continue
    if grep -IEq 'fmt\.Sprintf.*(SELECT|INSERT|UPDATE|DELETE|WHERE|DROP|UNION)|exec\.Command\(|sh -c|bash -c|os\.Command' "$f"; then
      hits="${hits}\n- $f: 存在潜在注入/命令执行模式（fmt.Sprintf+SQL 或 exec.Command/os.Command）"
    fi
  done <<< "$CHANGED_FILES"

  if [[ -n "$hits" ]]; then
    echo -e "- **注入风险预检**：命中$hits"
  else
    echo "- **注入风险预检**：未命中"
  fi
}

# File upload validation
check_upload() {
  local hits=""
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    in_scan_scope "$f" || continue
    if grep -IEq 'multipart\.FormFile|ParseMultipartForm|Upload|\.xlsx|\.csv' "$f"; then
      if ! grep -IEq 'ContentType|Size|filename|ValidateExt|MaxSize|FileType' "$f"; then
        hits="${hits}\n- $f: 存在文件上传/解析入口，未在文件中发现类型/大小/文件名校验关键词"
      fi
    fi
  done <<< "$CHANGED_FILES"

  if [[ -n "$hits" ]]; then
    echo -e "- **文件上传预检**：命中$hits"
  else
    echo "- **文件上传预检**：未命中"
  fi
}

# Contract snapshot presence
SNAPSHOT="docs/05-execution-records/$MODULE/api-contract-snapshot.md"
if [[ -f "$SNAPSHOT" ]]; then
  # 注意：bash 3.2 在中文全角标点紧接变量扩展时会误报 unbound variable，这里用 ASCII 括号/冒号
  SNAPSHOT_STATUS="存在 (path: $SNAPSHOT)"
else
  SNAPSHOT_STATUS="缺失"
fi

changed_count=0
if [[ -n "$CHANGED_FILES" ]]; then
  changed_count=$(echo "$CHANGED_FILES" | grep -c '^' || true)
fi

{
  echo "# 审查预检报告：$MODULE"
  echo ""
  echo "## 执行元数据"
  echo "- base branch：$BASE_BRANCH"
  echo "- current branch：$current_branch"
  echo "- commit range：$BASE_BRANCH...HEAD"
  echo "- generated at：$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- changed files count：$changed_count"
  echo "- 契约快照：$SNAPSHOT_STATUS"
  echo ""
  echo "## 变更文件清单"
  if [[ -n "$CHANGED_FILES" ]]; then
    echo "$CHANGED_FILES" | sed 's/^/- /'
  else
    echo "- （无）"
  fi
  echo ""
  echo "## 目录隔离检查"
  check_isolation "backend-reviewer" "platform/ patches/prometheus/"
  check_isolation "frontend-reviewer" "ui-custom/web/"
  check_isolation "security-reviewer" "platform/ ui-custom/web/ deploy/ patches/prometheus/"
  echo ""
  echo "## 安全预检"
  check_secrets
  check_ssrf
  check_injection
  check_upload
  echo ""
  echo "## 审查预检结论"
  echo "- 预检报告用于 reviewer 快速采信；命中项需要 reviewer 人工确认，未命中项不替代 LLM 对鉴权/越权/业务安全的判断。"
  echo "- 文件路径：$OUT_FILE"
} > "$OUT_FILE"

echo "Precheck report written to: $OUT_FILE"
