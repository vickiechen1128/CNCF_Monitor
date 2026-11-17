package domain

import (
	"fmt"
	"strings"
	"text/template"
	"time"
)

// maxTemplateBytes bounds a template body (64 KiB); templates are code-like and
// should stay small.
const maxTemplateBytes = 64 * 1024

// Template is a notification template (FR-10). Templates are mutable entities
// and never enter alertmanager.yml.
type Template struct {
	ID          string
	Name        string
	ChannelType ChannelType
	Content     string
	Builtin     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// TemplateFuncMap returns the helper functions available to templates. The
// validator and the renderer share it so "valid during save" means "renderable
// at delivery time".
func TemplateFuncMap() template.FuncMap {
	return template.FuncMap{
		"upper":   strings.ToUpper,
		"lower":   strings.ToLower,
		"title":   strings.Title, //nolint:staticcheck // template helper, ASCII titles only
		"join":    func(sep string, values []string) string { return strings.Join(values, sep) },
		"default": func(fallback, value string) string {
			if strings.TrimSpace(value) == "" {
				return fallback
			}
			return value
		},
	}
}

// ValidateTemplate validates a template payload.
func ValidateTemplate(t *Template) []ValidationIssue {
	var issues []ValidationIssue
	if strings.TrimSpace(t.Name) == "" {
		issues = append(issues, ValidationIssue{Field: "name", Message: "模板名称不能为空"})
	}
	if !IsIM(t.ChannelType) {
		issues = append(issues, ValidationIssue{
			Field:   "channel_type",
			Message: fmt.Sprintf("模板仅适用于 IM 渠道（feishu/dingtalk/wecom），收到 %q", t.ChannelType),
		})
	}
	if strings.TrimSpace(t.Content) == "" {
		issues = append(issues, ValidationIssue{Field: "content", Message: "模板内容不能为空"})
	} else if len(t.Content) > maxTemplateBytes {
		issues = append(issues, ValidationIssue{Field: "content", Message: "模板内容不能超过 64KB"})
	} else if _, err := template.New("m08").Funcs(TemplateFuncMap()).Parse(t.Content); err != nil {
		issues = append(issues, ValidationIssue{Field: "content", Message: fmt.Sprintf("模板语法错误: %v", err)})
	}
	return issues
}
