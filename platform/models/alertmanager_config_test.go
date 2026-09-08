package models

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// --- T08-01: AlertmanagerConfigVersion ---

func TestAlertmanagerConfigStatusEnum(t *testing.T) {
	assert.Equal(t, AlertmanagerConfigStatus("applied"), AlertmanagerConfigStatusApplied)
	// 决策 60：状态枚举仅 applied，不存在 failed / error_msg。
	assert.Len(t, []string{
		string(AlertmanagerConfigStatusApplied),
	}, 1)
}

func TestAlertmanagerConfigChecksum(t *testing.T) {
	c1 := AlertmanagerConfigChecksum("global:\n  resolve_timeout: 5m\n")
	assert.NotEmpty(t, c1)
	assert.Len(t, c1, 64, "sha256 hex 应为 64 字符")
	// 同内容幂等、异内容不同。
	assert.Equal(t, c1, AlertmanagerConfigChecksum("global:\n  resolve_timeout: 5m\n"))
	assert.NotEqual(t, c1, AlertmanagerConfigChecksum("global:\n  resolve_timeout: 1m\n"))
}

func TestAlertmanagerConfigVersionSerializationRoundTrip(t *testing.T) {
	now := time.Now().UTC()
	v := &AlertmanagerConfigVersion{
		BaseModel:      BaseModel{ID: 42, CreatedAt: now, UpdatedAt: now},
		Content:        "route:\n  receiver: default\n",
		Checksum:       AlertmanagerConfigChecksum("route:\n  receiver: default\n"),
		AppliedBy:      "chenrt",
		Status:         AlertmanagerConfigStatusApplied,
		SourceChangeNo: "CHG-20260902-001",
		AppliedAt:      &now,
	}
	b, err := json.Marshal(v)
	require.NoError(t, err)
	s := string(b)
	// 契约视图：id 为字符串、字段齐全、不回显 deleted_at/updated_at。
	assert.Contains(t, s, `"id":"42"`)
	assert.Contains(t, s, `"content":"route:\n  receiver: default\n"`)
	assert.Contains(t, s, `"checksum":"`+v.Checksum+`"`)
	assert.Contains(t, s, `"status":"applied"`)
	assert.Contains(t, s, `"created_at":`)
	assert.Contains(t, s, `"source_change_no":"CHG-20260902-001"`)
	assert.NotContains(t, s, "updated_at")
	assert.NotContains(t, s, "deleted_at")

	var back AlertmanagerConfigVersionView
	require.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, "42", back.ID)
	assert.Equal(t, v.Content, back.Content)
	assert.Equal(t, v.Checksum, back.Checksum)
	assert.Equal(t, string(v.Status), back.Status)
	assert.Equal(t, v.SourceChangeNo, back.SourceChangeNo)
}

// AlertmanagerConfigVersionView 解密契约视图（unmarshal 目标）。
type AlertmanagerConfigVersionView struct {
	ID             string     `json:"id"`
	Content        string     `json:"content"`
	Checksum       string     `json:"checksum"`
	AppliedAt      *time.Time `json:"applied_at,omitempty"`
	AppliedBy      string     `json:"applied_by,omitempty"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
	SourceChangeNo string     `json:"source_change_no,omitempty"`
}

func TestAlertmanagerConfigVersionAutoMigrate(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AlertmanagerConfigVersion{}))

	v := &AlertmanagerConfigVersion{
		Content:  "route:\n  receiver: default\n",
		Checksum: AlertmanagerConfigChecksum("route:\n  receiver: default\n"),
		AppliedBy: "chenrt",
		Status:    AlertmanagerConfigStatusApplied,
	}
	require.NoError(t, db.Create(v).Error)
	assert.NotZero(t, v.ID)

	var got AlertmanagerConfigVersion
	require.NoError(t, db.First(&got, "id = ?", v.ID).Error)
	assert.Equal(t, AlertmanagerConfigStatusApplied, got.Status)
	assert.Equal(t, v.Checksum, got.Checksum)
}

// --- Silence matcher DTO ---

func TestSilenceMatcherJSONRoundTrip(t *testing.T) {
	m := SilenceMatcher{Name: "network_domain", Value: "finance", IsEqual: true, IsRegex: false}
	b, err := json.Marshal(m)
	require.NoError(t, err)
	assert.Contains(t, string(b), `"is_equal"`)
	assert.Contains(t, string(b), `"is_regex"`)

	var back SilenceMatcher
	require.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, m, back)
}

func TestSilenceStatusEnum(t *testing.T) {
	assert.Equal(t, SilenceStatus("active"), SilenceStatusActive)
	assert.Equal(t, SilenceStatus("pending"), SilenceStatusPending)
	assert.Equal(t, SilenceStatus("expired"), SilenceStatusExpired)
	assert.Equal(t, []string{"active", "pending", "expired"}, ValidSilenceStatus())
}

// --- AuthorizedMatcherScope（决策 56 骨架） ---

func TestAuthorizedMatcherScopeAllDomainsAlwaysPasses(t *testing.T) {
	// MVP 单租户：AllDomains=true 恒通过。
	scope := &AuthorizedMatcherScope{AllDomains: true}
	matchers := []SilenceMatcher{
		{Name: "network_domain", Value: "finance"},
		{Name: "severity", Value: "critical"},
	}
	assert.Empty(t, scope.Violations(matchers))
}

func TestAuthorizedMatcherScopeRestrictsNetworkDomain(t *testing.T) {
	scope := &AuthorizedMatcherScope{AllDomains: false, Domains: []string{"finance", "ops"}}
	// 越权 matcher 被判定。
	violations := scope.Violations([]SilenceMatcher{
		{Name: "network_domain", Value: "hr"},     // 不在授权集合 → 越权
		{Name: "severity", Value: "critical"},      // 非网域标签 → 不判
		{Name: "network_domain", Value: "finance"}, // 命中 → 合规
	})
	require.Len(t, violations, 1)
	assert.Equal(t, "hr", violations[0].Value)
}

func TestValidateErrorItemJSON(t *testing.T) {
	item := ValidateErrorItem{File: "alertmanager.yml", Line: 14, Message: "unknown receiver \"sre-critical\" referenced by route"}
	b, err := json.Marshal(item)
	require.NoError(t, err)
	assert.Contains(t, string(b), `"file":"alertmanager.yml"`)
	assert.Contains(t, string(b), `"line":14`)

	var back ValidateErrorItem
	require.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, item, back)
}