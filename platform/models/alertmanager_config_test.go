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

func TestAlertmanagerConfigVersionSerializationRoundTrip(t *testing.T) {
	now := time.Now().UTC()
	v := &AlertmanagerConfigVersion{
		BaseModel:      BaseModel{ID: 42, CreatedAt: now, UpdatedAt: now},
		Content:        "route:\n  receiver: default\n",
		Checksum:       "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
		Content:   "route:\n  receiver: default\n",
		Checksum:  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
