package domain

import (
	"fmt"
	"strings"
)

// InhibitionRule is a platform-managed inhibit rule (FR-18). Rules are stored
// in their own table so they can be searched (D49); the generator renders them
// from the table, never by parsing the YAML back.
type InhibitionRule struct {
	ID             string
	Name           string
	SourceMatchers []Matcher
	TargetMatchers []Matcher
	Equal          []string
	Enabled        bool
	Builtin        bool
}

// ValidateInhibition validates a rule payload.
func ValidateInhibition(r *InhibitionRule) []ValidationIssue {
	var issues []ValidationIssue
	if strings.TrimSpace(r.Name) == "" {
		issues = append(issues, ValidationIssue{Field: "name", Message: "抑制规则名称不能为空"})
	}
	if len(r.SourceMatchers) == 0 {
		issues = append(issues, ValidationIssue{Field: "source_matchers", Message: "至少需要一个来源匹配条件"})
	}
	if len(r.TargetMatchers) == 0 {
		issues = append(issues, ValidationIssue{Field: "target_matchers", Message: "至少需要一个目标匹配条件"})
	}
	issues = append(issues, ValidateMatchers("source_matchers", r.SourceMatchers)...)
	issues = append(issues, ValidateMatchers("target_matchers", r.TargetMatchers)...)
	for i, label := range r.Equal {
		if !matcherNamePattern.MatchString(label) {
			issues = append(issues, ValidationIssue{
				Field:   fmt.Sprintf("equal[%d]", i),
				Message: fmt.Sprintf("equal 标签名 %q 非法", label),
			})
		}
	}
	return issues
}

// FirstNetworkDomain returns the first exact network_domain_id matcher value in
// the given matcher list, plus whether it was found.
func FirstNetworkDomain(matchers []Matcher) (string, bool) {
	return LabelValue(matchers, "network_domain_id")
}
