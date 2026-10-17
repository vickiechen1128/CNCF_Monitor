#!/usr/bin/env bash
# scripts/lib/packaging-clean.sh — 交付包「洁净打包」公共函数
#
# 被 package-center.sh / package-edge-agent.sh source 复用。解决的问题：
# 在 macOS 上打包、在 Linux 上交付，宿主系统的元数据被一起带进生产包。
# 2026-10-17 实测的三个残留源（均有包内证据）：
#
#   1) 扩展属性（xattr）：macOS 给每个文件挂 com.apple.provenance，bsdtar 默认以 pax
#      格式把它写成 SCHILY.xattr.* / LIBARCHIVE.xattr.* 扩展头。Linux 侧 GNU tar 解压时
#      刷 "Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'"，
#      在不支持 xattr 的 FS 上还会 setxattr 失败。实测 dist 下生产包 50 条。
#   2) 属主/属组：tar 记录的是打包机身份（chenrt/staff = 501/20）。root 解压且未加
#      --no-same-owner 时，/opt/apps 下会留一批 uid 501 的文件；install.sh 的 chown 只在
#      程序账户已存在时才执行，属兜底而非保证。
#   3) 目录元数据文件：Finder 浏览过 dist/ 后会在包目录（含 web/）留 .DS_Store，cp -r 也会
#      带走；同族还有 ._* AppleDouble（exFAT/网络卷或 zip 往返产生）、__MACOSX（zip 往返）、
#      .Spotlight-V100 / .Trashes / .fseventsd（整卷打包才出现）。
#
# 提供三个函数：
#   prune_mac_metadata    <dir>                              打包前删除上述元数据文件
#   create_clean_tarball  <workdir> <out.tar.gz> <member>     无 xattr + 属主 root 打包
#   verify_clean_tarball  <tarball>                           复核，不洁返回 1
#
# 用法（调用方脚本）：
#   . "$(dirname "$0")/lib/packaging-clean.sh"
#   prune_mac_metadata "$BUNDLE_DIR"
#   create_clean_tarball "$DIST_DIR" "$TARBALL" "$(basename "$BUNDLE_DIR")"
#   verify_clean_tarball "$TARBALL" || exit 1

# 需要在包内剔除的宿主系统元数据文件名（glob，find -name 语义）
PACKAGING_METADATA_PATTERNS=(
    '.DS_Store'
    '._*'
    '__MACOSX'
    '.Spotlight-V100'
    '.Trashes'
    '.fseventsd'
    '.AppleDouble'
    'Thumbs.db'      # Windows 缩略图缓存（U 盘/共享盘往返）
    'desktop.ini'    # Windows 目录配置
)

# prune_mac_metadata <dir>
# 打包前清理。用 -prune：__MACOSX 这类目录整体删除，不进去逐项遍历。
prune_mac_metadata() {
    local dir="$1" p
    [ -d "$dir" ] || return 0
    for p in "${PACKAGING_METADATA_PATTERNS[@]}"; do
        find "$dir" -name "$p" -prune -exec rm -rf {} + 2>/dev/null || true
    done
    return 0
}

# create_clean_tarball <workdir> <out.tar.gz> <member>
#   workdir 归档根目录（归档内条目为 member 相对该目录的路径）
#   member  要归档的目录名，如 metric-center-bundle-prod-linux-arm64-.../
# 得到的 tar 不含 xattr 扩展头，属主属组统一为 root:root。
create_clean_tarball() {
    local workdir="$1" tarball="$2" member="$3"

    # tarball 必须是绝对路径：下面要 cd 进 workdir，相对路径会被解析到别处
    case "$tarball" in
        /*) : ;;
        *) tarball="$(cd "$(dirname "$tarball")" && pwd)/$(basename "$tarball")" ;;
    esac

    if tar --version 2>/dev/null | grep -qi bsdtar; then
        # bsdtar（macOS 自带）：--no-xattrs 不写 SCHILY.xattr.*；--format=ustar 进一步把
        # 归档钉在「无扩展头机制」的格式上——ustar 根本没有地方存放 xattr，从结构上杜绝。
        # 属主用 --uid/--gid/--uname/--gname 显式归一化（--numeric-owner 只影响解压侧，不够）。
        ( cd "$workdir" && tar --format=ustar --no-xattrs \
            --uid 0 --gid 0 --uname root --gname root \
            -czf "$tarball" "$member" )
    else
        # GNU tar（Linux / CI）：--format=ustar 同样不带扩展头，--xattrs-exclude='*' 双保险，
        # --owner/--group 归一化属主。
        ( cd "$workdir" && tar --format=ustar --xattrs-exclude='*' \
            --owner=0 --group=0 \
            -czf "$tarball" "$member" )
    fi
}

# verify_clean_tarball <tarball>
# 打包后复核三道：条目名黑名单 / xattr 扩展头 / 属主归一化。不洁返回 1（由调用方决定处置）。
verify_clean_tarball() {
    local tarball="$1" bad=0 hits owners fmt
    [ -f "$tarball" ] || { echo ">>> ERROR: 归档不存在: $tarball" >&2; return 1; }

    # 1) 条目名黑名单
    hits=$(tar -tzf "$tarball" | LC_ALL=C grep -aE \
        '(^|/)(\.DS_Store|\._[^/]*|__MACOSX|\.Spotlight-V100|\.Trashes|\.fseventsd|\.AppleDouble|Thumbs\.db|desktop\.ini)(/|$)' \
        || true)
    if [ -n "$hits" ]; then
        echo ">>> ERROR: 交付包含宿主系统元数据条目:" >&2
        printf '%s\n' "$hits" | sed 's/^/      /' >&2
        bad=1
    fi

    # 2) 扩展属性头：不做内容 grep——Go 编译出来的二进制内含 "SCHILY.xattr." 常量
    #    （archive/tar 的前缀常量），在 180MB 归档流里必命中，属结构性假阳性（实测踩过）。
    #    改为断言归档格式为 ustar：ustar 没有扩展头机制，xattr 结构上无处存放。
    if command -v bsdtar >/dev/null 2>&1; then
        fmt=$(bsdtar -tvvv -f "$tarball" 2>/dev/null | tail -1)
        case "$fmt" in
            *ustar*) : ;;
            *)
                echo ">>> ERROR: 归档非 ustar 格式，可能携带 pax 扩展头（xattr）: ${fmt:-格式未知}" >&2
                bad=1
                ;;
        esac
    fi

    # 3) 属主/属组归一化。两种 tar 的列位不同，必须分别解析：
    #    BSD tar: drwxr-xr-x  0 root   root        0 Oct ...   （$2=硬链接数，$3=owner，$4=group）
    #    GNU tar: drwxr-xr-x root/root 0 Oct ...               （$2=owner/group）
    owners=$(tar -tvzf "$tarball" 2>/dev/null | awk '
        $1 ~ /^[-dlpscb]/ {
            if ($2 ~ /^[0-9]+$/ && NF >= 4) print $3"/"$4;
            else if ($2 ~ /\//) print $2;
            else print $2"/"$3;
        }' | sort -u)
    if [ -n "$owners" ] && [ "$owners" != "root/root" ]; then
        echo ">>> ERROR: 属主未归一化（Linux 解压会留下非 root 属主）: $(printf '%s' "$owners" | tr '\n' ' ')" >&2
        bad=1
    fi

    if [ "$bad" -eq 0 ]; then
        echo ">>> 洁净度校验通过：无 .DS_Store/._/__MACOSX，无 xattr 扩展头，属主 root:root"
    fi
    return "$bad"
}
