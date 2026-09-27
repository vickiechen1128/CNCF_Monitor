//go:build linux

package main

import (
	"os/exec"
	"syscall"
)

// configureSysProcAttr 为子进程设置「父死子亡」信号（F-15 进程层根因修复）。
//
// Linux 专有：设置 cmd.SysProcAttr.Pdeathsig = SIGKILL，使 edge-sync-agent 主进程
// 异常退出（含被 SIGKILL 强杀、defer StopAll 不触发）时，内核自动向 vmagent /
// blackbox_exporter 子进程发送 SIGKILL，避免子进程被 re-parent 到 init/systemd 后
// 成孤儿继续运行（否则孤儿 vmagent 仍会持续采集、占用资源，并掩盖节点已离线的事实）。
func configureSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}