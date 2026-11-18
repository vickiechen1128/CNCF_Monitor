package generator

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// InhibitionRule is the editable form of one Alertmanager inhibit_rules entry.
type InhibitionRule struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	SourceMatchers []RouteEditMatcher `json:"source_matchers"`
	TargetMatchers []RouteEditMatcher `json:"target_matchers"`
	Equal          []string           `json:"equal"`
	Enabled        *bool              `json:"enabled"`
}

type inhibitRuleYAML struct {
	SourceMatchers []string `yaml:"source_matchers"`
	TargetMatchers []string `yaml:"target_matchers"`
	Equal          []string `yaml:"equal,omitempty"`
}

func inhibitRulesNode(rules []InhibitionRule) (*yaml.Node, error) {
	seq := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	for _, rule := range rules {
		if rule.Enabled != nil && !*rule.Enabled {
			continue
		}
		item := inhibitRuleYAML{Equal: rule.Equal}
		for _, m := range rule.SourceMatchers {
			item.SourceMatchers = append(item.SourceMatchers, matcherShorthand(m))
		}
		for _, m := range rule.TargetMatchers {
			item.TargetMatchers = append(item.TargetMatchers, matcherShorthand(m))
		}
		raw, err := yaml.Marshal(item)
		if err != nil {
			return nil, fmt.Errorf("序列化抑制规则失败: %w", err)
		}
		var doc yaml.Node
		if err := yaml.Unmarshal(raw, &doc); err != nil {
			return nil, fmt.Errorf("生成抑制规则节点失败: %w", err)
		}
		node := doc.Content[0]
		if strings.TrimSpace(rule.Name) != "" {
			node.HeadComment = "抑制规则名称: " + strings.TrimSpace(rule.Name)
		}
		seq.Content = append(seq.Content, node)
	}
	return seq, nil
}

// ParseInhibitRules extracts editable inhibit rules from alertmanager.yml.
func ParseInhibitRules(baseYAML string) ([]InhibitionRule, error) {
	rules := make([]InhibitionRule, 0)
	if strings.TrimSpace(baseYAML) == "" {
		return rules, nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return nil, fmt.Errorf("解析 alertmanager.yml 失败: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("alertmanager.yml 顶层不是映射")
	}
	root := doc.Content[0]
	vi := mappingValueIndex(root, "inhibit_rules")
	if vi < 0 {
		return rules, nil
	}
	seq := root.Content[vi]
	if seq.Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("inhibit_rules 必须是列表")
	}
	for i, node := range seq.Content {
		if node.Kind != yaml.MappingNode {
			return nil, fmt.Errorf("inhibit_rules 第 %d 项不是映射", i+1)
		}
		enabled := true
		rule := InhibitionRule{ID: fmt.Sprintf("inhibit-%d", i+1), Name: inhibitName(node.HeadComment), Enabled: &enabled}
		var err error
		rule.SourceMatchers, err = inhibitMatchers(node, "source_matchers")
		if err != nil {
			return nil, fmt.Errorf("inhibit_rules 第 %d 项: %w", i+1, err)
		}
		rule.TargetMatchers, err = inhibitMatchers(node, "target_matchers")
		if err != nil {
			return nil, fmt.Errorf("inhibit_rules 第 %d 项: %w", i+1, err)
		}
		if ei := mappingValueIndex(node, "equal"); ei >= 0 {
			equal := node.Content[ei]
			if equal.Kind != yaml.SequenceNode {
				return nil, fmt.Errorf("inhibit_rules 第 %d 项 equal 必须是列表", i+1)
			}
			for _, label := range equal.Content {
				if label.Kind != yaml.ScalarNode || label.Tag != "!!str" {
					return nil, fmt.Errorf("inhibit_rules 第 %d 项 equal 含非字符串标签", i+1)
				}
				rule.Equal = append(rule.Equal, label.Value)
			}
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

func inhibitMatchers(node *yaml.Node, key string) ([]RouteEditMatcher, error) {
	vi := mappingValueIndex(node, key)
	if vi < 0 {
		return []RouteEditMatcher{}, nil
	}
	seq := node.Content[vi]
	if seq.Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("%s 必须是列表", key)
	}
	out := make([]RouteEditMatcher, 0, len(seq.Content))
	for _, item := range seq.Content {
		if item.Kind != yaml.ScalarNode || item.Tag != "!!str" {
			return nil, fmt.Errorf("%s 仅支持字符串 matcher", key)
		}
		m, err := parseInhibitMatcher(item.Value)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

var inhibitMatcherRE = regexp.MustCompile(`^\s*([^=!~]+?)\s*(=~|!~|!=|=)\s*(.*)$`)

func parseInhibitMatcher(raw string) (RouteEditMatcher, error) {
	parts := inhibitMatcherRE.FindStringSubmatch(raw)
	if len(parts) != 4 {
		return RouteEditMatcher{}, fmt.Errorf("无法解析 matcher %q", raw)
	}
	value := strings.TrimSpace(parts[3])
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	} else {
		value = strings.Trim(value, `"`)
	}
	return RouteEditMatcher{
		Name: strings.TrimSpace(parts[1]), Value: value,
		IsEqual: parts[2] == "=" || parts[2] == "=~",
		IsRegex: parts[2] == "=~" || parts[2] == "!~",
	}, nil
}

func inhibitName(comment string) string {
	for _, line := range strings.Split(comment, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "#"))
		if strings.HasPrefix(line, "抑制规则名称:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "抑制规则名称:"))
		}
	}
	return ""
}
