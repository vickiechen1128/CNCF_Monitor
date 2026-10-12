//go:build !windows

package storagelog

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// diskUsage 统计 dirPath 所在文件系统的总量/已用/可用字节（statfs）。
// 路径不存在时向上回溯到最近的已存在祖先目录，保证 TSDB 目录尚未创建时
// 也能展示其所在盘的用量。
func diskUsage(dirPath string) (total, used, free uint64, err error) {
	target := dirPath
	for {
		if _, statErr := os.Stat(target); statErr == nil {
			break
		}
		parent := filepath.Dir(target)
		if parent == target {
			return 0, 0, 0, fmt.Errorf("路径不存在: %s", dirPath)
		}
		target = parent
	}

	var st syscall.Statfs_t
	if err := syscall.Statfs(target, &st); err != nil {
		return 0, 0, 0, fmt.Errorf("统计磁盘用量失败: %w", err)
	}
	bsize := uint64(st.Bsize)
	total = uint64(st.Blocks) * bsize
	free = uint64(st.Bavail) * bsize
	if uint64(st.Blocks) > uint64(st.Bfree) {
		used = (uint64(st.Blocks) - uint64(st.Bfree)) * bsize
	}
	return total, used, free, nil
}
