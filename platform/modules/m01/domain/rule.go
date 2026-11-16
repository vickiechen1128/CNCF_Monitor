package domain

import (
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// RuleGroup is one `groups[]` entry in a rules file.
type RuleGroup struct {
	Name  string      `yaml:"name"`
	Rules []RuleEntry `yaml:"rules"`
}

// RuleEntry is one alerting / recording rule.
type RuleEntry struct {
	Alert       string            `yaml:"alert,omitempty"`
	Record      string            `yaml:"record,omitempty"`
	Expr        string            `yaml:"expr"`
	For         string            `yaml:"for,omitempty"`
	Labels      map[string]string `yaml:"labels,omitempty"`
	Annotations map[string]string `yaml:"annotations,omitempty"`
}

// RuleFile is the top-level rules.yml structure.
type RuleFile struct {
	Groups []RuleGroup `yaml:"groups"`
}

// JobRefIssue is one `job` reference that does not match an active job.
type JobRefIssue struct {
	Group         string `json:"group"`
	RuleName      string `json:"rule_name"`
	Expr          string `json:"expr"`
	Matcher       string `json:"matcher"`
	ReferencedJob string `json:"referenced_job"`
	Type          string `json:"type"`
	Severity      string `json:"severity"`
	Message       string `json:"message"`
}

var (
	jobMatcherRe = regexp.MustCompile(`job\s*(=~|=)\s*"([^"]*)"`)
	livenessRe   = regexp.MustCompile(`\bup\b`)
)

// ParseRules parses and structurally validates a YAML rules file.
func ParseRules(content string) (*RuleFile, error) {
	if strings.TrimSpace(content) == "" {
		return nil, NewValidationError("rule_content", "is required")
	}
	if len(content) > 1<<20 {
		return nil, NewValidationError("rule_content", "must be at most 1MB")
	}
	var file RuleFile
	if err := yaml.Unmarshal([]byte(content), &file); err != nil {
		return nil, NewValidationErrorf("rule_content", "invalid YAML: %v", err)
	}
	if len(file.Groups) == 0 {
		return nil, NewValidationError("rule_content", "groups must be a non-empty array")
	}
	groupNames := make(map[string]struct{}, len(file.Groups))
	for i, group := range file.Groups {
		group.Name = strings.TrimSpace(group.Name)
		if group.Name == "" {
			return nil, NewValidationErrorf("rule_content", "groups[%d].name is required", i)
		}
		if _, duplicate := groupNames[group.Name]; duplicate {
			return nil, NewValidationErrorf("rule_content", "duplicate group name %q", group.Name)
		}
		groupNames[group.Name] = struct{}{}
		if len(group.Rules) == 0 {
			return nil, NewValidationErrorf("rule_content", "group %q has no rules", group.Name)
		}
		for j, rule := range group.Rules {
			if strings.TrimSpace(rule.Expr) == "" {
				return nil, NewValidationErrorf("rule_content", "groups[%d].rules[%d].expr is required", i, j)
			}
			if (rule.Alert == "") == (rule.Record == "") {
				return nil, NewValidationErrorf("rule_content",
					"groups[%d].rules[%d] must set exactly one of alert or record", i, j)
			}
		}
	}
	return &file, nil
}

// GroupNames returns the group names in file order.
func (f *RuleFile) GroupNames() []string {
	out := make([]string, 0, len(f.Groups))
	for _, group := range f.Groups {
		out = append(out, group.Name)
	}
	return out
}

// RuleCount returns the total number of rules.
func (f *RuleFile) RuleCount() int {
	total := 0
	for _, group := range f.Groups {
		total += len(group.Rules)
	}
	return total
}

// JobRefIssues compares `job` matchers in every expression against the active
// job name set. Liveness rules (`up`) produce error severity; other rules warn.
func (f *RuleFile) JobRefIssues(jobNames []string) []JobRefIssue {
	jobs := make(map[string]struct{}, len(jobNames))
	for _, name := range jobNames {
		jobs[name] = struct{}{}
	}
	var out []JobRefIssue
	for _, group := range f.Groups {
		for _, rule := range group.Rules {
			out = append(out, ruleJobRefIssues(group.Name, rule, jobs)...)
		}
	}
	return out
}

func ruleJobRefIssues(group string, rule RuleEntry, jobs map[string]struct{}) []JobRefIssue {
	name := rule.Alert
	if name == "" {
		name = rule.Record
	}
	liveness := livenessRe.MatchString(rule.Expr)
	var out []JobRefIssue
	seen := make(map[string]struct{})
	for _, match := range jobMatcherRe.FindAllStringSubmatch(rule.Expr, -1) {
		op, ref := match[1], match[2]
		if _, duplicate := seen[op+":"+ref]; duplicate {
			continue
		}
		seen[op+":"+ref] = struct{}{}
		hit, determinable := jobExists(jobs, op, ref)
		if !determinable || hit {
			continue
		}
		issueType := "literal"
		if op == "=~" {
			issueType = "regex"
		}
		severity := "warning"
		message := fmt.Sprintf("规则 %q 引用的 job %q 不存在；建议先创建对应采集 Job（仅提示）", name, ref)
		if liveness {
			severity = "error"
			message = fmt.Sprintf("存活类规则 %q 引用的 job %q 不存在；提交将被阻断，可勾选逃生门放行", name, ref)
		}
		out = append(out, JobRefIssue{
			Group: group, RuleName: name, Expr: rule.Expr, Matcher: match[0],
			ReferencedJob: ref, Type: issueType, Severity: severity, Message: message,
		})
	}
	return out
}

func jobExists(jobs map[string]struct{}, op, ref string) (bool, bool) {
	if op == "=" {
		_, hit := jobs[ref]
		return hit, true
	}
	re, err := regexp.Compile(ref)
	if err != nil {
		return false, false
	}
	for name := range jobs {
		if re.MatchString(name) {
			return true, true
		}
	}
	return false, true
}
