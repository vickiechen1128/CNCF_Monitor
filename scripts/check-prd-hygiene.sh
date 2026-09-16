#!/usr/bin/env bash
# 检查 PRD 是否满足规范：去历史化（v1.27）、章节编号冻结、前端交互契约、§3 防叠加（v1.34）。
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

# 支持 --changelog-only：仅做 Change Log 收敛检查（供 pre-commit 门禁使用，
# 避免被正文内联标注 / 章节等独立的去历史化规则连坐阻断）。
focus_changelog=0
if [ "${1:-}" = "--changelog-only" ]; then
  focus_changelog=1
  shift
fi

# 若传入文件参数，则只检查这些文件（供 pre-commit 仅校验暂存 PRD）；
# 否则检查目录下全部 Module PRD（供手动 `make check-prd-hygiene`）。
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=("$PRD_DIR"/Module_*.md)
fi

for file in "${files[@]}"; do
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
  # 计数前须整行排除「豁免载体」，依据：规范 prototype-designer.md L226「门禁既有口径」
  #   (a) 行首 '>' 的引用行——含要求 8 允许的章节开头「> 决策依据：」指针行，
  #       以及要求 11 界定的备注 / 引用块（引用块本身不是违规载体）；
  #   (b) 表格行——「章节表格『来源』列使用 决策 NN」属既定口径。
  # 未排除的正文散文（列表项 / 段落）里出现的 决策 NN 才是真正的「内联决策标注」违规。
  if [ "$focus_changelog" -eq 0 ]; then
    body_scan=$(grep -v -E '^[[:space:]]*[>]' <<< "$body" | grep -v -E '^[[:space:]]*[|]' || true)
    decision_count=$(grep -oE '决策[[:space:]]*[0-9]' <<< "$body_scan" 2>/dev/null | wc -l | awk '{print $1}') || true
    # 版本标记仅作可见性统计、不作失败条件：正则 \{vX.Y\} 匹配的正是要求 12-5 规定的
    # 「花括号交付范围标记」（含 §9 验收标准中的 {vX.Y} 验收口径标记），该形态按 L226
    # 「正文 {MVP} / {v0.x} / {v0.x+} 交付范围标记属既定口径，不视为违规」——凡被本正则
    # 命中的形态本身就是合规的，作为失败条件必然误报（实测修复前 10 模块 9 个非零）。
    version_count=$(grep -oE '\{v[0-9]+\.[^}]+\}' <<< "$body_scan" 2>/dev/null | wc -l | awk '{print $1}') || true
    decision_count=${decision_count:-0}
    version_count=${version_count:-0}
    echo "  内联决策标注数（豁免载体已排除）: $decision_count"
    echo "  交付范围标记数（既定口径，仅统计）: $version_count"
    if [ "$decision_count" -gt 0 ]; then
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
  fi

  # 3. Change Log 存在性
  if ! grep -qE '^## Change Log' "$file"; then
    echo "    [缺] Change Log 章节"
    status=1
  fi

  # 4. Change Log 收敛检查：版本条目（表格行）应 ≤ 3，超出部分迁 design-decisions.md
  cl_count=0
  in_cl=0
  while IFS= read -r line; do
    if [ "$in_cl" -eq 0 ]; then
      if echo "$line" | grep -qE '^## Change Log'; then in_cl=1; fi
      continue
    fi
    # Change Log 为文末章节；遇下一段落标题即停止
    if echo "$line" | grep -qE '^## '; then break; fi
    # 版本数据行：首单元格为 vX.Y（排除表头「版本」与分隔线）
    if echo "$line" | grep -qE '^\|[[:space:]]*v[0-9]+(\.[0-9]+)*[[:space:]]*\|'; then
      cl_count=$((cl_count + 1))
    fi
  done < "$file"
  echo "  Change Log 版本条目数: $cl_count"
  if [ "$cl_count" -gt 3 ]; then
    echo "    [偏] Change Log 版本条目数 $cl_count > 3；主 PRD 仅保留最近 3 个版本，更早版本应迁至 design-decisions.md"
    status=1
  fi

  # 5. §3 核心功能卫生检查（v1.34 防叠加纪律）
  # 仅在非 --changelog-only 模式下执行；快速扫描，不做结构感知深度分析（后者由 T4 流程完成）
  if [ "$focus_changelog" -eq 0 ]; then
    sec3_start=$(grep -n "^## 3\. 核心功能" "$file" | head -1 | cut -d: -f1)
    sec3_end=$(awk 'NR>'"$sec3_start"' && /^## 4\./ {print NR; exit}' "$file")
    if [ -n "$sec3_start" ] && [ -n "$sec3_end" ]; then
      sec3_body=$(sed -n "$((sec3_start+1)),$((sec3_end-1))p" "$file")

      fence_count=$(grep -cE '^```' <<< "$sec3_body" 2>/dev/null || true)
      fence_count=$((fence_count / 2))
      echo "  §3 内 code fence 数: $fence_count"
      if [ "$fence_count" -gt 0 ]; then
        echo "    [偏] §3 内存在 code fence（技术实现物不应出现在用户层章节，见要求 12）"
        status=1
      fi

      api_count=$(grep -oE '(GET|POST|PUT|DELETE)\s+/api/' <<< "$sec3_body" 2>/dev/null | wc -l | awk '{print $1}' || true)
      api_count=${api_count:-0}
      echo "  §3 内 API 路径数: $api_count"
      if [ "$api_count" -gt 0 ]; then
        echo "    [偏] §3 内存在 API 路径（应归位 §6 接口设计，见要求 12）"
        status=1
      fi

      neg_count=0
      neg_lines=""
      for w in "不再" "原先" "原列名" "替代原" "此前只" "不再单列" "历史表述"; do
        hits=$(grep -n "$w" <<< "$sec3_body" 2>/dev/null || true)
        if [ -n "$hits" ]; then
          hit_c=$(echo "$hits" | wc -l | awk '{print $1}')
          neg_count=$((neg_count + hit_c))
          neg_lines="${neg_lines}${hits}"$'\n'
        fi
      done
      echo "  §3 内否定式演变词命中: $neg_count"
      if [ "$neg_count" -gt 0 ]; then
        echo "    [偏] §3 内存在否定式/历史对照表述（应重写为当前结论句，见要求 12）："
        echo "$neg_lines" | sed 's/^/      L/'
        status=1
      fi

      # 5d. 功能表超长单元格检测（>400 字符硬上限，目标 ≤300；按字符数而非字节，
      #     macOS awk length 按字节计数会误伤中文，故用 python3 计字符数）
      long_cells=$(echo "$sec3_body" | python3 -c "
import sys
for line in sys.stdin:
    line = line.rstrip('\n')
    if not line.startswith('|'):
        continue
    cells = [c.strip() for c in line.split('|')[1:-1]]
    if not cells:
        continue
    # 跳过分隔线行（| --- | --- |）
    if all(set(c) <= set('-: ') for c in cells):
        continue
    for c in cells:
        if len(c) > 400:
            print(f'{len(c)}|{c[:40]}...')
")
      long_count=$(echo -n "$long_cells" | grep -c . 2>/dev/null || true)
      long_count=${long_count:-0}
      echo "  §3 功能表超长单元格(>400字符)数: $long_count"
      if [ "$long_count" -gt 0 ]; then
        echo "    [偏] §3 存在超长单元格（应拆为列表+内链下沉，见要求 12）："
        echo "$long_cells" | head -5 | sed 's/^/      /'
        status=1
      fi
    else
      echo "  §3 卫生: [跳过] 未找到「## 3. 核心功能」章节边界"
    fi
  fi

  # 6. 核心章节形态检查（v1.37 要求 13：§1 / §4 / §5 / §7 / §8）
  #    口径：存量 FAIL 是「迁移进度指标」（与检查 1 同性质），不阻断提交；
  #    新改动或新注册模块须达标。pre-commit 钩子走 --changelog-only，本项不参与。
  #    失败条件 = 4 项形态违规（多行引用块占章比 >20% / §5 字段表非 5 列 / §5 go fence /
  #    §8 状态机节缺 stateDiagram-v2）；单章占比 >35% 只作「归属审计」诊断值、不判失败。
  #    误报豁免：①「引用块占比」只统计**连续 ≥2 行**的引用块——单行引用块
  #    （`> 决策依据…` / `> 说明…` / 要求 12 规定的 `> **用户价值**：`）是合规形态；
  #    ②「字段表」严格判定首列 == `字段`（`| 内置字段 | 说明 |` 这类说明表不算字段表）；
  #    ③ §5 的 fence 只把 `go`（Go struct 定义模型）计为失败条件，yaml/json 属产物示例、仅统计。
  if [ "$focus_changelog" -eq 0 ]; then
    # 注意：本段 python 以 exit 7 表达「偏」，而脚本有 set -e —— 直接调用会被 set -e
    # 当作失败命令立即终止整个脚本（吞掉 [偏] 说明行、status 也不会置 1，最终退出码 7 而非 1）。
    # 故用 `|| pyrc=$?` 把它放进 `||` 列表屏蔽 set -e。
    pyrc=0
    python3 - "$file" <<'PYEOF' || pyrc=$?
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
L = p.read_text(encoding='utf-8').split('\n')
idx = [(int(m.group(1)), i) for i, l in enumerate(L, 1) if (m := re.match(r'^## (\d+)\.', l))]
if not idx:
    print("  核心章节形态: [跳过] 未找到「## N.」章节结构")
    sys.exit(0)
b = {n: (ln, idx[k+1][1]-1 if k+1 < len(idx) else len(L)) for k, (n, ln) in enumerate(idx)}
def seg(n):
    a, z = b[n]; return L[a-1:z]
tot = len('\n'.join(L))

# 6a 单章字符占比（>35% 触发归属审计；**不作失败条件**——机器无法区分「层放错」
#    与「对象多」：M07 §5 = 49% 但 17 个子节分布均匀（最大 13.9%），属固有权重）
big = []
for n in sorted(b):
    t = '\n'.join(seg(n))
    if not t: continue
    r = len(t) / tot * 100
    if r > 35: big.append(f"§{n} {r:.1f}%")
print(f"  [诊断] 单章字符占比 >35%（须做归属审计，非违规）: {len(big)}" + (f"  → {', '.join(big)}" if big else ""))

# 6b 多行引用块占章字符比（>20% 视为引用块承载规格正文；单行引用块豁免）
qbig = []
for n in sorted(b):
    lines = seg(n)
    t = '\n'.join(lines)
    if not t: continue
    q = 0; run_start = None
    for i, l in enumerate(list(lines) + ['']):
        if l.strip().startswith('>'):
            if run_start is None: run_start = i
        else:
            if run_start is not None:
                if i - run_start >= 2:
                    q += sum(len(x) + 1 for x in lines[run_start:i])
                run_start = None
    r = q / len(t) * 100
    if r > 20: qbig.append(f"§{n} {r:.0f}%")
print(f"  多行引用块占章比 >20%: {len(qbig)}" + (f"  → {', '.join(qbig)}" if qbig else ""))

# 6c §5 字段表表头（首列 == `字段` 时固定 5 列：字段/类型/必填/UI 展示名/说明）
bad_hdr = []
if 5 in b:
    s5 = seg(5)
    for i in range(len(s5) - 1):
        cur, nxt = s5[i].strip(), s5[i+1].strip()
        if not cur.startswith('|') or not re.match(r'^\|[\s:|-]+\|$', nxt): continue
        cols = [c.strip() for c in cur.strip('|').split('|')]
        if cols and cols[0] == '字段' and len(cols) != 5:
            bad_hdr.append(f"{len(cols)}列@L{b[5][0]+i}")
print(f"  §5 字段表非 5 列表头: {len(bad_hdr)}" + (f"  → {', '.join(bad_hdr[:5])}" if bad_hdr else ""))

# 6d §5 内模型定义类 code fence（go struct 计为失败条件；yaml/json 产物示例仅统计）
go_fence = sample_fence = 0
if 5 in b:
    f5 = re.findall(r'^```(\w*)', '\n'.join(seg(5)), re.M)
    go_fence = sum(1 for x in f5 if x == 'go')
    sample_fence = sum(1 for x in f5 if x in ('yaml', 'json'))
print(f"  §5 内 go fence（模型定义）: {go_fence}" + (f"  [产物示例 yaml/json: {sample_fence}，仅统计]" if sample_fence else ""))

# 6e §8 状态机节缺 stateDiagram-v2
miss = []
if 8 in b:
    s8 = seg(8)
    marks = [(i, l.strip()) for i, l in enumerate(s8) if re.match(r'^### 8\.\d+', l)]
    for k, (i, t) in enumerate(marks):
        e = marks[k+1][0] if k+1 < len(marks) else len(s8)
        if 'stateDiagram-v2' not in '\n'.join(s8[i:e]):
            miss.append(t[:26])
print(f"  §8 状态机节缺 stateDiagram-v2: {len(miss)}" + (f"  → {miss}" if miss else ""))

if len(qbig) + len(bad_hdr) + go_fence + len(miss) > 0:
    sys.exit(7)
PYEOF
    if [ "$pyrc" -ne 0 ]; then
      echo "    [偏] 核心章节形态未达标（存量属迁移进度指标；新改动模块须达标，见要求 13）"
      status=1
    fi
  fi

  echo ""
done

if [ "$status" -ne 0 ]; then
  if [ "$focus_changelog" -eq 1 ]; then
    echo "发现 Change Log 收敛问题：主 PRD 仅保留最近 3 个版本，更早版本应迁至对应 design-decisions.md「Change Log（完整历史）」小节。"
  else
    echo "发现需整改项。请按 prototype-designer.md 规范（v1.27 去历史化 + v1.34 §3 防叠加）进行 PRD 整改。"
  fi
fi
exit "$status"
