//go:build linux

package main

import (
	"os/exec"
	"syscall"
	"testing"
)

// TestConfigureSysProcAttrSetsPdeathsig 覆盖 F-15 进程层根因：Linux 下
// configureSysProcAttr 必须为子进程设置 Pdeathsig=SIGKILL，保证 edge-sync-agent
// 主进程被强杀（SIGKILL）时内核向 vmagent / blackbox_exporter 子进程发 SIGKILL，
// 避免子进程被 re-parent 后成孤儿继续运行。
func TestConfigureSysProcAttrSetsPdeathsig(t *testing.T) {
	cmd := exec.Command("true")
	configureSysProcAttr(cmd)
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr should be set on linux to carry Pdeathsig")
	}
	if cmd.SysProcAttr.Pdeathsig != syscall.SIGKILL {
		t.Fatalf("Pdeathsig = %v, want SIGKILL", cmd.SysProcAttr.Pdeathsig)
	}
}