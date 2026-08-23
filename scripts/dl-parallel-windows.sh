#!/usr/bin/env bash
# dl-parallel-windows.sh - 受限网络下的并行分片下载器（纯 curl，无需 aria2）
#
# 用法: bash dl-parallel-windows.sh <输出文件> <基础URL> [并发数]
#
# 设计要点（针对 ~10KB/s 的限速网络）：
#   - 真正按 HTTP Range 把文件切成 N 段，每段只下自己那一份（绝不每段都下整文件）。
#   - 每段“断点续传”：超时/断流后用续传 Range 接着下，进度不丢。
#   - 先发 1 字节探测服务器是否真的遵守 Range；若不遵守，自动退化为单流续传。
#   - 503/429（镜像过载）退避 5s，其余失败退避 1s 后续传。
#
# 可调环境变量：
#   DL_PARALLEL=N     并发分片数（默认 4；带宽受限时并太多反而触发 503，建议 2~4）
#   DL_MAX_TIME=N     单分片单次尝试最长秒数（默认 1800）
#   DL_RETRY=N        单分片最大尝试次数（默认 30，含续传）
#   DL_SKIP_EXISTING=1  若输出文件已存在则直接复用（配合 aria2/迅雷手动下）
#   GCC_MIRROR=URL    首选镜像前缀（覆盖 ghproxy）
set -uo pipefail

# 便携 sleep：若系统无 sleep 命令，用 perl/python 兜底（仅做延迟）
if ! command -v sleep >/dev/null 2>&1; then
  sleep() { local s="${1:-1}"; perl -e "select(undef,undef,undef,$s)" 2>/dev/null \
            || python3 -c "import time,sys;time.sleep(float(sys.argv[1]))" "$s" 2>/dev/null \
            || python -c "import time,sys;time.sleep(float(sys.argv[1]))" "$s" 2>/dev/null \
            || true; }
fi

OUT="${1:-}"
BASE="${2:-}"
CONN="${3:-${DL_PARALLEL:-4}}"
MT="${DL_MAX_TIME:-1800}"
MAXTRY="${DL_RETRY:-30}"

if [ -z "$OUT" ] || [ -z "$BASE" ]; then
  echo ">>> dl-parallel-windows.sh usage: bash dl-parallel-windows.sh <out-file> <base-url> [conn]" >&2
  exit 2
fi

# 复用已存在文件
if [ -n "${DL_SKIP_EXISTING:-}" ] && [ -s "$OUT" ]; then
  echo ">>>   DL_SKIP_EXISTING set and $OUT exists ($(wc -c < "$OUT" 2>/dev/null) bytes); reusing."
  exit 0
fi

mkdir -p "$(dirname "$OUT")"

# 选择实际下载 URL（与 dl-windows.sh 相同的镜像映射规则，保证国内可达性一致）
URL="$BASE"
if [ -n "${GCC_MIRROR:-}" ]; then
  URL="$GCC_MIRROR"
else
  case "$BASE" in
    *github.com*|*githubusercontent.com*)
      URL="https://ghproxy.net/${BASE#https://}" ;;
    *go.dev*|*golang.org*)
      URL="${BASE/go.dev\//golang.google.cn/}"
      URL="${URL/golang.org\//golang.google.cn/}" ;;
    *nodejs.org*)
      URL="${BASE/nodejs.org\/dist\//registry.npmmirror.com/-/binary/node/}" ;;
  esac
fi

# 代理探测
PX=""
if [ -n "${HTTPS_PROXY:-}" ]; then PX="$HTTPS_PROXY"
elif [ -n "${HTTP_PROXY:-}" ]; then PX="$HTTP_PROXY"
else PX="$(git config --get http.proxy 2>/dev/null || true)"; fi

PXARG=""
[ -n "$PX" ] && PXARG="-x $PX"

# 探测：单个 GET 下 1 字节（PROBE_SIZE 应为 1，证明服务器真遵守 Range），
# 同时从响应头解析总大小（用 GET 而非 HEAD，兼容只实现 GET 的服务器）
PROBE="$OUT.probe"; rm -f "$PROBE"
HEADERS=$(curl -s -r 0-0 $PXARG -D - -o "$PROBE" "$URL" 2>/dev/null) || true
PROBE_SIZE=$(wc -c < "$PROBE" 2>/dev/null || echo 0)
SIZE=$(printf '%s\n' "$HEADERS" | tr -d '\r' \
        | awk 'tolower($0) ~ /content-range/ { split($0,a,"/"); gsub(/[ \r]/,"",a[2]); print a[2] }' | head -n1)
rm -f "$PROBE"

if [ "$PROBE_SIZE" != "1" ] || ! [[ "$SIZE" =~ ^[0-9]+$ ]] || [ "$SIZE" -lt 1000000 ]; then
  echo ">>> Range not truly honored by $URL (probe_size=$PROBE_SIZE, size=$SIZE)"
  echo ">>> falling back to single-stream download with resume..."
  attempt=0
  while [ "$attempt" -lt "$MAXTRY" ]; do
    curl -fL -C - --connect-timeout 20 --max-time "$MT" $PXARG -o "$OUT" "$URL"
    rc=$?
    if [ "$rc" -eq 0 ]; then echo ">>> download OK (single-stream, resume)"; exit 0; fi
    attempt=$(( attempt + 1 ))
    [ "$rc" -eq 33 ] && rm -f "$OUT"   # resume 失败（服务器回 200 覆盖），清空重下
    if [ "$rc" -eq 22 ]; then echo ">>>   attempt $attempt failed (HTTP 503/429, backoff 5s)..."; sleep 5
    else echo ">>>   attempt $attempt failed (rc=$rc), resuming..."; sleep 1; fi
  done
  echo ">>> ERROR: single-stream download failed after $MAXTRY attempts" >&2
  rm -f "$OUT"
  exit 1
fi
echo ">>> total size: $SIZE bytes; $CONN parallel connections via $URL"

TMPD="$OUT.dlparts"
rm -rf "$TMPD"; mkdir -p "$TMPD"
cleanup() { rm -rf "$TMPD"; }
trap cleanup EXIT

# 单分片下载（带断点续传 + 重试）
#   - 用「显式续传 Range + >> 追加」避免 curl -C - 与 -r 的歧义
#   - 每次尝试只下「还没下到的部分」，进度不丢
dl_chunk() {
  local idx="$1" start="$2" end="$3" url="$4" px="$5"
  local part="$TMPD/part_$idx"
  local want=$(( end - start + 1 ))
  local attempt=0
  : > "$part"   # 先清空，后续一律追加
  while [ "$attempt" -lt "$MAXTRY" ]; do
    local got=0
    got=$(wc -c < "$part" 2>/dev/null || echo 0)
    [ "$got" -ge "$want" ] && { echo ">>>   chunk $idx done ($got bytes)"; return 0; }
    local rstart=$(( start + got ))
    [ "$rstart" -gt "$end" ] && rstart=$end
    curl -fL --connect-timeout 20 --max-time "$MT" ${px:+-x "$px"} -r "${rstart}-${end}" >> "$part" "$url"
    local rc=$?
    got=$(wc -c < "$part" 2>/dev/null || echo 0)
    if [ "$rc" -eq 0 ] && [ "$got" -eq "$want" ]; then
      echo ">>>   chunk $idx done ($got bytes)"
      return 0
    fi
    attempt=$(( attempt + 1 ))
    if [ "$rc" -eq 22 ]; then
      echo ">>>   chunk $idx attempt $attempt failed (HTTP 503/429, backoff 5s)..."
      sleep 5
    else
      echo ">>>   chunk $idx attempt $attempt incomplete (got=$got/$want), resuming..."
      sleep 1
    fi
  done
  echo ">>>   chunk $idx gave up after $MAXTRY attempts" >&2
  return 1
}

CHUNK=$(( (SIZE + CONN - 1) / CONN ))
PIDS=()
for ((i=0; i<CONN; i++)); do
  START=$(( i * CHUNK ))
  END=$(( START + CHUNK - 1 ))
  [ "$END" -ge "$SIZE" ] && END=$(( SIZE - 1 ))
  echo ">>>   launching chunk $i: bytes $START-$END (want=$(( END - START + 1 )))"
  dl_chunk "$i" "$START" "$END" "$URL" "$PX" &
  PIDS+=($!)
  sleep 0.3   # 轻微错峰，降低镜像瞬时并发压力（避免 503）
done

FAIL=0
for p in "${PIDS[@]}"; do
  if ! wait "$p"; then FAIL=1; fi
done
if [ "$FAIL" -ne 0 ]; then
  echo ">>> ERROR: one or more parallel chunks failed after retries on $URL" >&2
  rm -f "$OUT"
  exit 1
fi

# 按序拼接
: > "$OUT"
for ((i=0; i<CONN; i++)); do
  if [ ! -s "$TMPD/part_$i" ]; then
    echo ">>> ERROR: chunk $i missing/empty" >&2
    rm -f "$OUT"
    exit 1
  fi
  cat "$TMPD/part_$i" >> "$OUT"
done

GOT=$(wc -c < "$OUT")
if [ "$GOT" -ne "$SIZE" ]; then
  echo ">>> ERROR: size mismatch got=$GOT want=$SIZE" >&2
  rm -f "$OUT"
  exit 1
fi
echo ">>> parallel download OK: $GOT bytes via $CONN connections"
