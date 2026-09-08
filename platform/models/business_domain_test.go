package models

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBusinessDomainJSONTags 断言 BusinessDomain 持久化模型的 JSON 字段为 snake_case
// （决策 48：JSON 字段沿用 code/name/description/enabled，不引入 biz_code）。
func TestBusinessDomainJSONTags(t *testing.T) {
	d := BusinessDomain{
		Code:        "infra",
		Name:        "公共基础设施",
		Description: "兜底",
		Enabled:     true,
	}
	b, err := json.Marshal(d)
	require.NoError(t, err)
	var got map[string]interface{}
	require.NoError(t, json.Unmarshal(b, &got))

	// 字典字段（风格契约）
	assert.Equal(t, "infra", got["code"])
	assert.Equal(t, "公共基础设施", got["name"])
	assert.Equal(t, "兜底", got["description"])
	assert.Equal(t, true, got["enabled"])
	// 一律 snake_case；绝不出现 biz_code JSON 键。
	assert.NotContains(t, got, "biz_code")
	assert.Contains(t, got, "created_at")
}

// TestInfraBizCodeConstant 断言 infra 兜底编码约定。
func TestInfraBizCodeConstant(t *testing.T) {
	assert.Equal(t, "infra", InfraBizCode)
}