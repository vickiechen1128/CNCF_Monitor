//go:build windows

package storagelog

import "fmt"

// diskUsage 在 Windows 开发态暂不支持磁盘用量统计，返回错误由上层以
// error 字段降级展示（M06 存储与日志管理页的运行环境为 Linux 生产机）。
func diskUsage(dirPath string) (total, used, free uint64, err error) {
	return 0, 0, 0, fmt.Errorf("当前平台不支持磁盘用量统计: %s", dirPath)
}
