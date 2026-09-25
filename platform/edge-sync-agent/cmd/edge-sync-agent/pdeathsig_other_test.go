//go:build !linux

package main

import (
	"os/exec"
	"testing"
)

// TestConfigureSysProcAttrNoopOnNonLinux 覆盖 F-15 进程层的跨平台回落：macOS /
// Windows 无 syscall.SysProcAttr.Pdeathsig 字段，configureSysProcAttr 保持 no-op
// （不设置 SysProcAttr），由 systemd KillMode=control-group 按 cgroup 兜底回收子进程。
func TestConfigureSysProcAttrNoopOnNonLinux(t *testing.T) {
	cmd := exec.Command("true")
	configureSysProcAttr(cmd)
	if cmd.SysProcAttr != nil {
		t.Fatalf("SysProcAttr should stay nil on non-linux, got %+v", cmd.SysProcAttr)
	}
}