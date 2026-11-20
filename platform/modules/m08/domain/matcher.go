package domain

import (
	"fmt"
	"regexp"
)

// matcherNamePattern is the label-name grammar accepted by Alertmanager.
var matcherNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// Matcher is one label matcher used by routes, silences and inhibition rules.
type Matcher struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	IsRegex bool   `json:"is_regex"`
	// IsEqual is optional and defaults to true. A false value renders the
	// negative operator (!= / !~); Alertmanager's newer matcher syntax supports
	// it for routes and inhibit rules. Silences cannot express negation, so the
	// silence path ignores it.
	IsEqual *bool `json:"is_equal,omitempty"`
}

// IsEqualMatch reports whether the matcher is a positive match (default true).
func (m Matcher) IsEqualMatch() bool { return m.IsEqual == nil || *m.IsEqual }

// Validate checks the matcher grammar.
func (m Matcher) Validate(field string) []ValidationIssue {
	var issues []ValidationIssue
	if m.Name == "" {
		issues = append(issues, ValidationIssue{Field: field + ".name", Message: "匹配条件的标签名不能为空"})
	} else if !matcherNamePattern.MatchString(m.Name) {
		issues = append(issues, ValidationIssue{
			Field:   field + ".name",
			Message: fmt.Sprintf("标签名 %q 非法：仅允许字母、数字与下划线，且不能以数字开头", m.Name),
		})
	}
	if m.IsRegex && m.Value != "" {
		if _, err := regexp.Compile(m.Value); err != nil {
			issues = append(issues, ValidationIssue{
				Field:   field + ".value",
				Message: fmt.Sprintf("正则 %q 无法编译: %v", m.Value, err),
			})
		}
	}
	return issues
}

// ValidateMatchers validates a matcher list.
func ValidateMatchers(field string, matchers []Matcher) []ValidationIssue {
	var issues []ValidationIssue
	for i, m := range matchers {
		issues = append(issues, m.Validate(fmt.Sprintf("%s[%d]", field, i))...)
	}
	return issues
}

// LabelValue returns the matcher value for the given label name (exact
// matchers only); used for network-domain scoping checks.
func LabelValue(matchers []Matcher, name string) (string, bool) {
	for _, m := range matchers {
		if m.Name == name && !m.IsRegex {
			return m.Value, true
		}
	}
	return "", false
}
