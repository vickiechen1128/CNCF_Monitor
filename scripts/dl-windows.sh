#!/usr/bin/env bash
# dl-windows.sh - 镜像感知下载器（受限网络 / 中国大陆友好）
#
# 用法: bash dl-windows.sh <输出文件> <基础URL> [额外镜像URL ...]
#
# 按 URL 主机自动选择镜像：
#   - github.com / githubusercontent.com -> ghproxy.net / ghproxy.com / mirror.ghproxy.com
#   - go.dev / golang.org               -> golang.google.cn（Google 中国镜像，国内可达）
#   - nodejs.org                        -> registry.npmmirror.com（淘宝 npm 镜像，国内可达）
# 调用方可用额外参数追加自定义镜像（如 GCC_MIRROR）。
# 同时复用系统/Shell/git 代理（企业网 TLS 拦截场景关键）。
set -euo pipefail

OUT="${1:-}"
BASE="${2:-}"
if [ -z "$OUT" ] || [ -z "$BASE" ]; then
  echo ">>> dl-windows.sh usage: bash dl-windows.sh <out-file> <base-url> [extra-mirror ...]" >&2
  exit 2
fi
shift 2 || true

# 确保输出目录存在（避免 /tmp 等目录缺失导致 curl 无法写入）
mkdir -p "$(dirname "$OUT")"

# 复用已存在的文件（用户用迅雷/aria2 等多线程工具手动下好后，设 DL_SKIP_EXISTING=1 即可跳过重复下载）
if [ -n "${DL_SKIP_EXISTING:-}" ] && [ -s "$OUT" ]; then
  echo ">>>   DL_SKIP_EXISTING set and $OUT exists ($(wc -c < "$OUT" 2>/dev/null) bytes); reusing."
  exit 0
fi

# 按主机构造镜像列表：镜像优先、直连兜底（受限网络直连极慢，务必放最后）
LIST=()
# 1) 调用方显式传入的“首选自定义镜像”（如 GCC_MIRROR）最先尝试
LIST+=("$@")
case "$BASE" in
  *github.com*|*githubusercontent.com*)
    LIST+=("https://ghproxy.net/${BASE#https://}" "https://ghproxy.com/${BASE#https://}" "https://mirror.ghproxy.com/${BASE#https://}" "https://gh.api.99988866.xyz/${BASE#https://}" "https://github.moeyy.xyz/${BASE#https://}" "https://hub.gitmirror.com/${BASE#https://}") ;;
  *go.dev*|*golang.org*)
    LIST+=("${BASE/go.dev\//golang.google.cn/}" "${BASE/golang.org\//golang.google.cn/}") ;;
  *nodejs.org*)
    LIST+=("${BASE/nodejs.org\/dist\//registry.npmmirror.com\/-/binary\/node/}") ;;
esac
# 直连作为最后兜底（受限网络通常很慢，放最后）
LIST+=("$BASE")

# 代理探测：复用系统/Shell 代理与 git 代理（企业网 TLS 拦截场景关键）
PX=""
if [ -n "${HTTPS_PROXY:-}" ]; then
  PX="$HTTPS_PROXY"
elif [ -n "${HTTP_PROXY:-}" ]; then
  PX="$HTTP_PROXY"
else
  gp="$(git config --get http.proxy 2>/dev/null || true)"
  [ -n "$gp" ] && PX="$gp"
fi

ok=0
for u in "${LIST[@]}"; do
  [ -z "$u" ] && continue
  rm -f "$OUT"   # 避免跨镜像续传导致文件损坏
  echo ">>>   trying: $u"
  if curl -fL -C - --connect-timeout 20 --max-time 1800 --retry 3 --retry-delay 1 ${PX:+-x "$PX"} -o "$OUT" "$u"; then
    echo ">>>   download OK via: $u"
    ok=1
    break
  fi
  echo ">>>   failed, next mirror..."
done

if [ "$ok" -ne 1 ]; then
  echo ">>> ERROR: download failed on all mirrors: $BASE" >&2
  exit 1
fi
