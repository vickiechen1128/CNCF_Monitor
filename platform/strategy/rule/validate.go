// Package rule implements Module_01 MonitoringRule（规则挂载）API：列表、CRUD、
// YAML 文件透传校验与 validate-yaml（PRD §5.5 / §6.2.4，api-contract-snapshot
// §7）。MVP 整文件 YAML 透传，至少校验 groups 存在且为数组；不做 PromQL 语义校验。
package rule

import (
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/rule/jobref"
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

// validateGroupNamesForCheck 是 validate-yaml 的组名唯一性预检入口（决策 69-1）。
//
// 与提交侧**同口径**：仅当目标规则**生效**（enabled=true AND draft_status=ready）时才
// 校验——停用规则不下发、不参与 rules.yml 合并，提交侧同样跳过（update.go:71）；若此处
// 无条件校验，会出现「预检报错、提交却能过」的反向不一致，用户将失去唯一出口。
//
// excludeID 为路由 :id（新建场景为 0，无自身可排除）；>0 时读取目标规则的启停与草稿
// 状态以镜像提交侧条件。目标规则不存在时按「新建」处理（enabled=true），与
// create.go 的「创建默认启用」口径一致。
func validateGroupNamesForCheck(db *gorm.DB, content string, excludeID uint) error {
	enabled, draftStatus := true, "ready"
	if excludeID > 0 {
		var r models.MonitoringRule
		if err := db.Select("enabled", "draft_status").First(&r, excludeID).Error; err == nil {
			enabled, draftStatus = r.Enabled, r.DraftStatus
		}
	}
	if !enabled || draftStatus != "ready" {
		return nil
	}
	return validateGroupNamesAvailable(db, content, excludeID)
}

// effectiveJobNames 返回指定规则 scope 下「校验用」的生效 Job 名集合（决策 67-4）：
//   - central（MVP 单域 / v0.2 多域）：**全域 job 并集**——规则是全局资源、会进入每个
//     网域的 rules.yml，故不能按单域名单判定（否则 v0.2 下引用 A 域 job 的规则在 B 域
//     必然被误判 error → failed）；
//   - edge / both（v0.4+）：本网域 job 名单（domainID 为空则不判定）。
//
// MVP 单域下 central 的「全域并集」= 全库查询，与历史实现等价、不改变现有行为。
// 本函数是 M01 保存校验与 M09 发布期校验的**统一输入集**，把决策 66 的「单一实现」
// 补完为「单一实现 + 同一输入集」。查询失败返回空集合（仅导致引用视为不存在）。
func effectiveJobNames(db *gorm.DB, scope models.ScopeType, domainID string) []string {
	query := db.Model(&models.ScrapeJob{}).
		Where("enabled = ? AND draft_status = ?", true, "ready")
	if scope == models.ScopeTypeEdge || scope == models.ScopeTypeBoth {
		if strings.TrimSpace(domainID) == "" {
			return nil
		}
		query = query.Where("network_domain_id = ?", domainID)
	}
	var names []string
	if err := query.Pluck("job_name", &names).Error; err != nil {
		return nil
	}
	return names
}

// ValidateRuleJobRefs 对 rule_content 执行 job 引用语义校验（决策 66），返回
// error/warning 两级问题；YAML 解析失败返回 nil。判定逻辑为单一实现（rule/jobref），
// 与 M09 发布期校验同口径、同输入集（决策 67-4：central 规则按全域 job 并集）。
func ValidateRuleJobRefs(db *gorm.DB, content string) []jobref.Issue {
	return ValidateRuleJobRefsForScope(db, content, models.ScopeTypeCentral, "")
}

// ValidateRuleJobRefsForScope 同 ValidateRuleJobRefs，但显式指定规则 scope 与网域
// （v0.2 逐域配置包校验用；MVP 恒 central + 空 domainID）。
func ValidateRuleJobRefsForScope(db *gorm.DB, content string, scope models.ScopeType, domainID string) []jobref.Issue {
	return jobref.Validate(content, effectiveJobNames(db, scope, domainID))
}

// FindRuleJobRefErrors 返回 rule_content 中 severity=error 的 job 引用问题
// （决策 67-2 提交门禁的判定入口）。
func FindRuleJobRefErrors(db *gorm.DB, content string) []jobref.Issue {
	var errs []jobref.Issue
	for _, it := range ValidateRuleJobRefs(db, content) {
		if it.Severity == jobref.SeverityError {
			errs = append(errs, it)
		}
	}
	return errs
}

// ErrJobRefUnresolved 标记「存在 error 级 job 引用且用户未显式确认」的提交门禁拒绝
// （决策 67-2）。HTTP 层据此返回 errorType=job_ref_unresolved，与普通 bad_request 区分。
var ErrJobRefUnresolved = errors.New("规则存在未确认的 job 引用错误")

// checkRuleJobRefGate 执行决策 67-2 的 M01 提交门禁：存在 error 级（存活类缺 job）
// job 引用且未显式确认（ack=false）时返回包装 ErrJobRefUnresolved 的错误；
// warning 级与 ack=true（逃生门）不阻断。
//
// 这是后端兜底（防绕过前端门禁）；前端门禁负责即时提示与逃生门勾选，两者共用
// 同一判定实现（FindRuleJobRefErrors → jobref.Validate）。
func checkRuleJobRefGate(db *gorm.DB, content string, ack bool) error {
	if ack {
		return nil
	}
	errs := FindRuleJobRefErrors(db, content)
	if len(errs) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(errs))
	refs := make([]string, 0, len(errs))
	for _, e := range errs {
		if _, dup := seen[e.ReferencedJob]; dup {
			continue
		}
		seen[e.ReferencedJob] = struct{}{}
		refs = append(refs, e.ReferencedJob)
	}
	return fmt.Errorf(
		"%w：存在 %d 条存活类规则的 job 引用错误（引用了不存在的 job：%s）；请先创建对应采集 Job 或修正规则；如确认「先挂规则，稍后补建 Job」，请勾选「已知晓」后重新提交",
		ErrJobRefUnresolved, len(errs), strings.Join(refs, "、"))
}