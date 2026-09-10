// Package jobref 提供「规则 job 引用」的单一判定实现（决策 66，门禁口径经决策 67-2 修订）。
//
// 目标：解析规则 PromQL 中的 job="..." / job=~"..." matcher，与当前生效的
// 采集 Job 比对，输出 error / warning 两级问题：
//   - 存活类规则（expr 含 up，如 up{job="x"} / absent(up{job=~"x"})）引用不存在的
//     job = error；其余规则引用不存在 job = warning；
//   - M01 编辑期（决策 67-2 修订）：error **默认阻断**「提交生效」/「保存变更」，
//     用户可经逃生门（ack_job_ref_errors=true）显式覆盖后放行并降级为 warning 留痕；
//     warning 维持只提示；
//   - M09 发布期：error 阻断确认发布；warning 允许确认但高亮提示（不变）。
//
// 该判定为单一实现，被两处复用（M01 validate-yaml 预检 + M09 ConfigDraft 校验），
// 避免口径漂移。包级依赖仅 yaml.v3 + regexp，不引 gorm，避免在 M09 configcenter
// 侧引入重依赖或无导入环。
package jobref

import (
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Severity 表示规则 job 引用问题的严重级。
type Severity string

const (
	// SeverityError 存活类（up / absent(up)）规则引用了不存在的 job，发布期将阻断。
	SeverityError Severity = "error"
	// SeverityWarning 非存活类规则引用了不存在的 job，仅提示不阻断。
	SeverityWarning Severity = "warning"
)

// Issue 表示一条规则 job 引用校验问题。
type Issue struct {
	Group         string   `json:"group"`
	RuleName      string   `json:"rule_name"`
	Expr          string   `json:"expr"`
	Matcher       string   `json:"matcher"`        // 原始 matcher 文本，如 job="app"
	ReferencedJob string   `json:"referenced_job"` // 引用的 job 名
	Type          string   `json:"type"`           // literal 精确 / regex 正则
	Severity      Severity `json:"severity"`       // error / warning
	Message       string   `json:"message"`
	// NetworkDomainID / NetworkDomainName 为 v0.2 多域预留（决策 67-4）：MVP 单域下恒为空，
	// 前端留空不渲染。多域落地后由 scope 感知的名单函数按域回填，用于逐域问题定位。
	NetworkDomainID   string `json:"network_domain_id,omitempty"`
	NetworkDomainName string `json:"network_domain_name,omitempty"`
}

var (
	// jobMatcherRe 匹配 expr 中的 job="..." / job=~"..."。
	// 组 1 = 比较符（= 或 =~），组 2 = 引用的 job 名。
	jobMatcherRe = regexp.MustCompile(`job\s*(=~|=)\s*"([^"]*)"`)
	// livenessRe 启发式识别「存活类」规则（覆盖 up{...} / absent(up{...}) / up == 0）。
	livenessRe = regexp.MustCompile(`\bup\b`)
)

// ruleEntry 是 rules.yml 单条规则的 YAML 载体。
type ruleEntry struct {
	Alert  string `yaml:"alert"`
	Record string `yaml:"record"`
	Expr   string `yaml:"expr"`
}

// ruleGroup 是 rules.yml 单个 group 的 YAML 载体。
type ruleGroup struct {
	Name  string      `yaml:"name"`
	Rules []ruleEntry `yaml:"rules"`
}

// rulesFile 是 rules.yml 顶层结构。
type rulesFile struct {
	Groups []ruleGroup `yaml:"groups"`
}

// Validate 校验 rulesContent 中全部规则对 job 的引用是否存在于 jobNames，返回
// 按 group → rule → matcher 首次出现顺序稳定的问题列表。以下情况不做判定：
//   - YAML 解析失败 / 非 rules 结构；
//   - 规则无 expr 或无 job= matcher；
//   - 引用的 job 存在于 jobNames；
//   - 正则 matcher 无法编译（跳过，不误报）。
func Validate(rulesContent string, jobNames []string) []Issue {
	var f rulesFile
	if err := yaml.Unmarshal([]byte(rulesContent), &f); err != nil {
		return nil
	}
	jobs := make(map[string]struct{}, len(jobNames))
	for _, n := range jobNames {
		jobs[n] = struct{}{}
	}
	var issues []Issue
	for _, g := range f.Groups {
		for _, rule := range g.Rules {
			if strings.TrimSpace(rule.Expr) == "" {
				continue
			}
			issues = append(issues, validateRule(g.Name, rule, jobs)...)
		}
	}
	return issues
}

// validateRule 校验单条规则的 expr 中引用的 job 是否存在。
func validateRule(group string, rule ruleEntry, jobs map[string]struct{}) []Issue {
	name := rule.Alert
	if name == "" {
		name = rule.Record
	}
	liveness := livenessRe.MatchString(rule.Expr)
	var out []Issue
	seen := make(map[string]struct{})
	for _, m := range jobMatcherRe.FindAllStringSubmatch(rule.Expr, -1) {
		op := m[1] // =~ 或 =
		ref := m[2] // 引用的 job 名
		if _, dup := seen[op+":"+ref]; dup {
			continue
		}
		seen[op+":"+ref] = struct{}{}
		hit, determinable := jobExists(jobs, op, ref)
		if !determinable {
			continue // 非法正则无法判定，跳过不误报（否则会在决策 67-2 下误阻断保存）
		}
		if hit {
			continue
		}
		jtype := "literal"
		if op == "=~" {
			jtype = "regex"
		}
		sev := SeverityWarning
		msg := fmt.Sprintf(
			"规则 %q 的查询表达式引用的 job %q 不存在；建议先创建对应采集 Job（仅提示，不阻断提交）",
			name, ref)
		if liveness {
			sev = SeverityError
			msg = fmt.Sprintf(
				"规则 %q 的查询表达式引用的 job %q 不存在；存活类规则缺 job 会导致告警恒触发，提交将被阻断（如确认「先挂规则、后建 Job」，可勾选逃生门后放行，但 M09 发布确认前仍会阻断）",
				name, ref)
		}
		out = append(out, Issue{
			Group: group, RuleName: name, Matcher: m[0], ReferencedJob: ref,
			Expr: rule.Expr, Type: jtype, Severity: sev, Message: msg,
		})
	}
	return out
}

// jobExists 判断 op（= 精确 / =~ 正则）下的引用 ref 是否命中任一 job 名。
// determinable=false 表示该引用无法判定（正则无法编译），调用方应跳过、不误报。
func jobExists(jobs map[string]struct{}, op, ref string) (hit bool, determinable bool) {
	if op == "=" {
		_, hit = jobs[ref]
		return hit, true
	}
	re, err := regexp.Compile(ref)
	if err != nil {
		return false, false // 非法正则无法判定，跳过不误报
	}
	for name := range jobs {
		if re.MatchString(name) {
			return true, true
		}
	}
	return false, true
}