// Package rule implements Module_01 MonitoringRule（规则挂载）API：列表、CRUD、
// YAML 文件透传校验与 validate-yaml（PRD §5.5 / §6.2.4，api-contract-snapshot
// §7）。MVP 整文件 YAML 透传，至少校验 groups 存在且为数组；不做 PromQL 语义校验。
package rule

import (
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
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

// groupNamesFile 仅取各 group 的 name（合并唯一性校验用）。
type groupNamesFile struct {
	Groups []struct {
		Name string `yaml:"name"`
	} `yaml:"groups"`
}

// extractGroupNames 提取 rule_content 中全部 group 名：空 name 或文件内重名报错。
// 合并后的 rules.yml 为单文档（generator.renderRules），Prometheus 要求组名全局唯一。
func extractGroupNames(content string) ([]string, error) {
	var f groupNamesFile
	if err := yaml.Unmarshal([]byte(content), &f); err != nil {
		return nil, fmt.Errorf("rule_content 不是合法 YAML: %w", err)
	}
	seen := make(map[string]struct{}, len(f.Groups))
	names := make([]string, 0, len(f.Groups))
	for _, g := range f.Groups {
		name := strings.TrimSpace(g.Name)
		if name == "" {
			return nil, fmt.Errorf("rule_content 存在未命名 group（name 为空）")
		}
		if _, dup := seen[name]; dup {
			return nil, fmt.Errorf("rule_content 内 group 名 %q 重复", name)
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	return names, nil
}

// validateGroupNamesAvailable 校验 content 的 group 名在全部生效规则
// （enabled=true AND draft_status=ready，排除 excludeID 自身）中无重名。
// 返回冲突错误，nil 表示可用；存量脏数据（解析失败的历史规则）不阻塞新规则。
func validateGroupNamesAvailable(db *gorm.DB, content string, excludeID uint) error {
	names, err := extractGroupNames(content)
	if err != nil {
		return err
	}
	var others []models.MonitoringRule
	if err := db.Select("id", "name", "rule_content").
		Where("enabled = ? AND draft_status = ?", true, "ready").
		Not("id = ?", excludeID).
		Find(&others).Error; err != nil {
		return fmt.Errorf("query existing monitoring rules: %w", err)
	}
	used := make(map[string]string) // group 名 → 占用规则展示名
	for _, o := range others {
		onames, err := extractGroupNames(o.RuleContent)
		if err != nil {
			continue
		}
		owner := strings.TrimSpace(o.Name)
		if owner == "" {
			owner = fmt.Sprintf("#%d", o.ID)
		}
		for _, n := range onames {
			used[n] = owner
		}
	}
	for _, n := range names {
		if owner, ok := used[n]; ok {
			return fmt.Errorf("规则组名 %q 已被规则「%s」占用；所有生效规则会合并为同一份 rules.yml，组名须全局唯一，请修改 group name 后再保存", n, owner)
		}
	}
	return nil
}