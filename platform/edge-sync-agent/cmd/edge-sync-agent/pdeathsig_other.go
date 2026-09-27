//go:build !linux

package main

import "os/exec"

// configureSysProcAttr 在非 Linux 平台为 no-op（F-15 进程层的跨平台回落）。
//
// macOS / Windows 无 syscall.SysProcAttr.Pdeathsig 字段，无法在 POSIX 层实现
// 「父死子亡」；这些平台依赖 systemd 单元 KillMode=control-group 兜底——主进程退出时
// 由 cgroup 统一回收同组子进程（unit 侧改动不在本模块职责内，见执行记录遗留项）。
func configureSysProcAttr(_ *exec.Cmd) {}