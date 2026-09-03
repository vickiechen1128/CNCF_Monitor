package generator

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// ToolLookPath / ToolChecker 可注入，便于测试（含跨包测试，如 configcenter/draft）
// 模拟外部校验工具（promtool / blackbox_exporter）的可用性与执行结果。
// 测试替换后须用 t.Cleanup 恢复；包级变量非并发安全，勿与 t.Parallel 混用。
var (
	ToolLookPath = exec.LookPath
	ToolChecker  = runToolChecks
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
// instance 单独放行：它是 Prometheus 约定标签（非 `__` 前缀保留标签），
// 在 static_configs[].labels 中写入 instance 是标准用法；系统默认模板按
// PRD M07 §5.12C 组合字段生成 instance_ip:port → instance，与此保持一致。
// M09 PRD §3.5.1 仅禁止覆盖 `__address__` 等内置标签，不含 instance。
func validateLabelName(name string) error {
	if name == "" {
		return fmt.Errorf("标签名为空")
	}
	if name == "instance" {
		return nil
	}
	if models.IsProtectedLabel(name) {
		return fmt.Errorf("禁止覆盖内置标签 %q", name)
	}
	return nil
}

// ValidateArtifacts 对配置产物做中心内容校验，返回：
//   - status：passed/failed/pending（PRD §3.5.1 / 决策 42-2）；
//   - cause：故障归因（user_config 用户配置可修复 / platform_fault 平台技术故障，决策 45-3）；
//   - details：结构化校验失败定位（对齐原型 validation_details）；passed/pending 为空；
//   - message：人类可读说明。
//
// 归因规则：targets schema / 内容校验失败 → user_config；
// 外部校验工具不可调用 → platform_fault。
func ValidateArtifacts(ca *ConfigArtifacts, includeBlackbox bool) (models.ValidationStatus, models.ValidationCause, []models.ValidationDetail, string) {
	for name, content := range ca.TargetsFiles {
		var groups []TargetGroup
		if err := json.Unmarshal([]byte(content), &groups); err != nil {
			return models.ValidationStatusFailed, models.ValidationCauseUserConfig,
				[]models.ValidationDetail{{File: name, Message: fmt.Sprintf("解析失败: %v", err)}},
				fmt.Sprintf("targets 文件 %s 解析失败: %v", name, err)
		}
		if err := ValidateTargetGroups(groups); err != nil {
			return models.ValidationStatusFailed, models.ValidationCauseUserConfig,
				[]models.ValidationDetail{{File: name, Message: err.Error()}},
				fmt.Sprintf("targets 文件 %s 非法: %v", name, err)
		}
	}
	if _, err := ToolLookPath("promtool"); err != nil {
		return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil, "promtool 不可调用，待运维环境就绪后重校"
	}
	if includeBlackbox && ca.BlackboxYML != "" {
		if _, err := ToolLookPath("blackbox_exporter"); err != nil {
			return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil, "blackbox_exporter 不可调用，待环境就绪后重校"
		}
	}
	// 决策 60：存在 alertmanager.yml 时需 amtool 校验（管理域 default 范围）。
	if ca.AlertmanagerYML != "" {
		if _, err := ToolLookPath("amtool"); err != nil {
			return models.ValidationStatusPending, models.ValidationCausePlatformFault, nil, "amtool 不可调用，待环境就绪后重校"
		}
	}
	if ok, msg := ToolChecker(ca, includeBlackbox); !ok {
		return models.ValidationStatusFailed, models.ValidationCauseUserConfig,
			[]models.ValidationDetail{{File: "prometheus.yml", Message: msg}},
			fmt.Sprintf("外部校验未通过: %s", msg)
	}
	return models.ValidationStatusPassed, "", nil, ""
}

// runToolChecks 实际调用 promtool check config 与 blackbox --config.check。
// 失败返回 (false, 错误摘要)；成功返回 (true, "")。
func runToolChecks(ca *ConfigArtifacts, includeBlackbox bool) (bool, string) {
	if err := runPromtoolCheck(ca); err != nil {
		return false, fmt.Sprintf("promtool check config 失败: %v", err)
	}
	if includeBlackbox && ca.BlackboxYML != "" {
		if err := runBlackboxCheck(ca.BlackboxYML); err != nil {
			return false, fmt.Sprintf("blackbox --config.check 失败: %v", err)
		}
	}
	// 决策 60：存在 alertmanager.yml 时用 amtool 校验。
	if ca.AlertmanagerYML != "" {
		if err := runAmmtoolCheck(ca.AlertmanagerYML); err != nil {
			return false, fmt.Sprintf("amtool check-config 失败: %v", err)
		}
	}
	return true, ""
}

// runPromtoolCheck 将配置产物按真实下发目录结构写入临时目录
// （prometheus.yml + rules.yml + targets/*.json，与 deployment.writeStructural 一致），
// 再执行 promtool check config。prometheus.yml 通过 rule_files 引用同目录 rules.yml、
// file_sd_configs 引用 targets/*.json，缺文件会导致校验误报
// 「does not point to an existing file」，因此必须先把被引用文件写齐。
func runPromtoolCheck(ca *ConfigArtifacts) error {
	dir, err := os.MkdirTemp("", "promcheck-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	if err := os.WriteFile(filepath.Join(dir, "prometheus.yml"), []byte(ca.PrometheusYML), 0o644); err != nil {
		return err
	}
	if ca.RulesYML != "" {
		if err := os.WriteFile(filepath.Join(dir, "rules.yml"), []byte(ca.RulesYML), 0o644); err != nil {
			return err
		}
	}
	if len(ca.TargetsFiles) > 0 {
		targetsDir := filepath.Join(dir, "targets")
		if err := os.MkdirAll(targetsDir, 0o755); err != nil {
			return err
		}
		for name, content := range ca.TargetsFiles {
			// review-fix F6：落盘前二次断言纯文件名（写入点复用 map key 的防御纵深）。
			if err := EnsureTargetsFilename(name); err != nil {
				return err
			}
			if err := os.WriteFile(filepath.Join(targetsDir, name), []byte(content), 0o644); err != nil {
				return err
			}
		}
	}
	cmd := exec.Command("promtool", "check", "config", filepath.Join(dir, "prometheus.yml"))
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

// runAmmtoolCheck 用 amtool check-config 校验 alertmanager.yml 内容
// （决策 60：amtool 对应 amtool 随 Alertmanager 附带的校验入口，管理域 default 范围）。
func runAmmtoolCheck(alertmanagerYAML string) error {
	f, err := os.CreateTemp("", "amcheck-*.yml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(alertmanagerYAML); err != nil {
		f.Close()
		return err
	}
	f.Close()
	cmd := exec.Command("amtool", "check-config", f.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}