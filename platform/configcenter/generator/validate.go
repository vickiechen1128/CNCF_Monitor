package generator

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// execLookPath / toolCheckerFn 可注入，便于测试模拟外部校验工具
// （promtool / blackbox_exporter）的可用性与执行结果。
var (
	execLookPath  = exec.LookPath
	toolCheckerFn = runToolChecks
	// errToolMissing 表示外部校验工具（promtool / blackbox_exporter）不可调用，
	// 此时中心内容校验返回 validation_status=pending（决策 42-2）。
	errToolMissing = errors.New("external validation tool not found")
)

// ValidateTargetGroups 对 file_sd 目标文件做 schema 校验（弥补 promtool 不校验
// SD 内容的缺口，PRD §3.3 / §3.5.1）：
//   - 每组必须有 targets；
//   - 地址格式合法（URL 或 host / host:port）；
//   - labels 命名合法（禁止覆盖 __address__ 等内置标签）。
func ValidateTargetGroups(groups []TargetGroup) error {
	for _, g := range groups {
		if len(g.Targets) == 0 {
			return fmt.Errorf("target group 缺少 targets")
		}
		for _, t := range g.Targets {
			if err := validateTargetAddress(t); err != nil {
				return err
			}
		}
		for k := range g.Labels {
			if err := validateLabelName(k); err != nil {
				return err
			}
		}
	}
	return nil
}

// validateTargetAddress 校验单个目标地址：允许 URL（blackbox），否则 host / host:port。
func validateTargetAddress(addr string) error {
	if addr == "" {
		return fmt.Errorf("目标地址为空")
	}
	if strings.Contains(addr, "://") {
		return nil // blackbox 拨测 URL
	}
	host := addr
	if i := strings.LastIndex(addr, ":"); i != -1 {
		h, _, err := net.SplitHostPort(addr)
		if err != nil {
			// 不含端口的裸 host（仅一个冒号在最后）也接受；否则视为非法。
			if strings.Count(addr, ":") == 1 {
				host = addr[:i]
			} else {
				return fmt.Errorf("目标地址 %q 非法", addr)
			}
		} else {
			host = h
		}
	}
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("目标地址 %q 缺少 host", addr)
	}
	if !validTargetHost(host) {
		return fmt.Errorf("目标地址 %q 含非法字符", addr)
	}
	return nil
}

// validTargetHost 校验 host 仅含合法主机名/地址字符（字母数字、点、连字符、冒号），
// 用于拒绝 `__bad__` 这类含下划线的非法目标（PRD §3.3 targets schema 校验）。
func validTargetHost(host string) bool {
	if host == "" {
		return false
	}
	for _, r := range host {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '-', r == ':':
		default:
			return false
		}
	}
	return true
}

// validateLabelName 校验标签名合法且不覆盖内置标签。
func validateLabelName(name string) error {
	if name == "" {
		return fmt.Errorf("标签名为空")
	}
	if models.IsProtectedLabel(name) {
		return fmt.Errorf("禁止覆盖内置标签 %q", name)
	}
	return nil
}

// ValidateArtifacts 对配置产物做中心内容校验，返回 validation_status 与说明
// （PRD §3.5.1 / 决策 42-2）：
//   - targets schema 校验失败 → failed；
//   - 外部校验工具不可调用 → pending；
//   - 工具可调用但校验失败 → failed；通过 → passed。
func ValidateArtifacts(ca *ConfigArtifacts, includeBlackbox bool) (models.ValidationStatus, string) {
	for name, content := range ca.TargetsFiles {
		var groups []TargetGroup
		if err := json.Unmarshal([]byte(content), &groups); err != nil {
			return models.ValidationStatusFailed, fmt.Sprintf("targets 文件 %s 解析失败: %v", name, err)
		}
		if err := ValidateTargetGroups(groups); err != nil {
			return models.ValidationStatusFailed, fmt.Sprintf("targets 文件 %s 非法: %v", name, err)
		}
	}
	if _, err := execLookPath("promtool"); err != nil {
		return models.ValidationStatusPending, "promtool 不可调用，待运维环境就绪后重校"
	}
	if includeBlackbox && ca.BlackboxYML != "" {
		if _, err := execLookPath("blackbox_exporter"); err != nil {
			return models.ValidationStatusPending, "blackbox_exporter 不可调用，待环境就绪后重校"
		}
	}
	if ok, msg := toolCheckerFn(ca.PrometheusYML, ca.BlackboxYML, includeBlackbox); !ok {
		return models.ValidationStatusFailed, fmt.Sprintf("外部校验未通过: %s", msg)
	}
	return models.ValidationStatusPassed, ""
}

// runToolChecks 实际调用 promtool check config 与 blackbox --config.check。
// 失败返回 (false, 错误摘要)；成功返回 (true, "")。
func runToolChecks(promYAML, blackboxYAML string, includeBlackbox bool) (bool, string) {
	if err := runPromtoolCheck(promYAML); err != nil {
		return false, fmt.Sprintf("promtool check config 失败: %v", err)
	}
	if includeBlackbox && blackboxYAML != "" {
		if err := runBlackboxCheck(blackboxYAML); err != nil {
			return false, fmt.Sprintf("blackbox --config.check 失败: %v", err)
		}
	}
	return true, ""
}

func runPromtoolCheck(promYAML string) error {
	f, err := os.CreateTemp("", "promcheck-*.yml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(promYAML); err != nil {
		f.Close()
		return err
	}
	f.Close()
	cmd := exec.Command("promtool", "check", "config", f.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}

func runBlackboxCheck(blackboxYAML string) error {
	f, err := os.CreateTemp("", "bbcheck-*.yml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(blackboxYAML); err != nil {
		f.Close()
		return err
	}
	f.Close()
	cmd := exec.Command("blackbox_exporter", "--config.check", "--config.file="+f.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}