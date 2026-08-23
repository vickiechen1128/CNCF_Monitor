// Package rule implements Module_01 MonitoringRule（规则挂载）API：列表、CRUD、
// YAML 文件透传校验与 validate-yaml（PRD §5.5 / §6.2.4，api-contract-snapshot
// §7）。MVP 整文件 YAML 透传，至少校验 groups 存在且为数组；不做 PromQL 语义校验。
package rule

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// ruleFile 是 Prometheus 规则文件的顶层结构（仅校验需用到的键）。
type ruleFile struct {
	Groups []yaml.Node `yaml:"groups"`
}

// validateRuleYAML 校验 rule_content 为合法 Prometheus 规则 YAML：yaml 语法合法，
// 且顶层 groups 存在并为数组（api-contract-snapshot §7 注）。返回校验错误，nil 表示通过。
func validateRuleYAML(content string) error {
	if strings.TrimSpace(content) == "" {
		return fmt.Errorf("rule_content 不能为空")
	}
	var file ruleFile
	if err := yaml.Unmarshal([]byte(content), &file); err != nil {
		return fmt.Errorf("rule_content 不是合法 YAML: %w", err)
	}
	// groups 须存在且为非空数组。
	if len(file.Groups) == 0 {
		return fmt.Errorf("rule_content 顶层须包含 groups 且为数组")
	}
	return nil
}