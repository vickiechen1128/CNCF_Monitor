package config

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestValidateTemplateValidPasses 覆盖合法模板（amtool 校验通过）→ 无错误。
func TestValidateTemplateValidPasses(t *testing.T) {
	stubAmtoolAvailable(t)
	err := ValidateTemplate(`{{ define "feishu.card" }}{{ .Status }}{{ end }}`)
	require.NoError(t, err)
}

// TestValidateTemplateRejectsEmpty 覆盖空模板 → 行级错误、不落库。
func TestValidateTemplateRejectsEmpty(t *testing.T) {
	stubAmtoolAvailable(t)
	err := ValidateTemplate("   \n")
	require.Error(t, err)
	var valErr *ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)
	assert.Contains(t, valErr.Items[0].Message, "不能为空")
}

// TestValidateTemplateRejectsSyntaxError 覆盖 Go 模板语法错误：即便 amtool 校验通过，
// 模板解析也必须拦截（「含模板解析」），返回行级错误。
func TestValidateTemplateRejectsSyntaxError(t *testing.T) {
	stubAmtoolAvailable(t)
	err := ValidateTemplate(`{{ .Status `) // 缺少闭合 }}
	require.Error(t, err)
	var valErr *ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)
	assert.True(t, strings.Contains(valErr.Items[0].Message, "模板解析失败"), valErr.Items[0].Message)
}

// TestValidateTemplateAmtoolUnavailable 覆盖 amtool 不可调用 → 校验失败（不落库）+ dev-feedback。
func TestValidateTemplateAmtoolUnavailable(t *testing.T) {
	stubAmtoolUnavailable(t)
	var fedback []string
	origDev := devfeedback
	devfeedback = func(msg string) { fedback = append(fedback, msg) }
	t.Cleanup(func() { devfeedback = origDev })

	err := ValidateTemplate(`{{ define "x" }}ok{{ end }}`)
	require.Error(t, err)
	var valErr *ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)
	require.NotEmpty(t, fedback)
}

// TestValidateTemplateAmtoolReportsError 覆盖 amtool 返回行级错误 → 透传行级错误。
func TestValidateTemplateAmtoolReportsError(t *testing.T) {
	stubAmtoolFails(t)
	err := ValidateTemplate(`{{ define "x" }}ok{{ end }}`)
	require.Error(t, err)
	var valErr *ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)
	assert.Equal(t, 14, valErr.Items[0].Line)
}

// TestTemplateFuncsJSONStr 覆盖 jsonStr 函数：字符串值被安全转义为 JSON 字面量。
func TestTemplateFuncsJSONStr(t *testing.T) {
	assert.Equal(t, `"red"`, templateJSONStr("red"))
	assert.Equal(t, `"a\"b"`, templateJSONStr(`a"b`))
	assert.Equal(t, "fallback", templateDefault("fallback", ""))
	assert.Equal(t, "v", templateDefault("fallback", "v"))
}