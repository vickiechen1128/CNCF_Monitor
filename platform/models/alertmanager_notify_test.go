package models

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var notifyModelDBCounter int64

// newNotifyModelDB 打开逐测试独享的内存 SQLite 并迁移 PL-3 通知模型表。
func newNotifyModelDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:notify_model_%d?mode=memory&cache=shared", atomic.AddInt64(&notifyModelDBCounter, 1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&NotifyChannel{}, &NotifyTemplate{}))
	return db
}

// TestNotifyChannelMigrateAndPersist 覆盖渠道建表 / 字段落库 / 主键。
func TestNotifyChannelMigrateAndPersist(t *testing.T) {
	db := newNotifyModelDB(t)

	ch := NotifyChannel{
		Name:       "SRE 飞书群",
		Type:       NotifyChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
		Secret:     "s3cr3t",
		Enabled:    true,
	}
	require.NoError(t, db.Create(&ch).Error)
	require.NotZero(t, ch.ID)

	var got NotifyChannel
	require.NoError(t, db.First(&got, ch.ID).Error)
	assert.Equal(t, "SRE 飞书群", got.Name)
	assert.Equal(t, NotifyChannelTypeFeishu, got.Type)
	assert.Equal(t, "s3cr3t", got.Secret)
	assert.True(t, got.Enabled)
	assert.Equal(t, "notify_channels", NotifyChannel{}.TableName())
}

// TestNotifyChannelEnabledFalsePersists 覆盖 enabled=false 不被默认值覆盖。
func TestNotifyChannelEnabledFalsePersists(t *testing.T) {
	db := newNotifyModelDB(t)

	ch := NotifyChannel{Name: "disabled", Type: NotifyChannelTypeWecom, WebhookURL: "https://qyapi.weixin.qq.com/x", Enabled: false}
	require.NoError(t, db.Create(&ch).Error)

	var got NotifyChannel
	require.NoError(t, db.First(&got, ch.ID).Error)
	assert.False(t, got.Enabled)
}

// TestNotifyTemplateMigrateAndChecksum 覆盖模板建表 / checksum 复用 config 口径 / status 恒 applied。
func TestNotifyTemplateMigrateAndChecksum(t *testing.T) {
	db := newNotifyModelDB(t)

	content := `{{ define "x" }}{{ .Status }}{{ end }}`
	tpl := NotifyTemplate{
		Name:        "飞书卡片-默认",
		ChannelType: NotifyChannelTypeFeishu,
		Content:     content,
		IsBuiltin:   true,
		Checksum:    AlertmanagerConfigChecksum(content),
		Status:      NotifyTemplateStatusApplied,
	}
	require.NoError(t, db.Create(&tpl).Error)
	require.NotZero(t, tpl.ID)

	var got NotifyTemplate
	require.NoError(t, db.First(&got, tpl.ID).Error)
	assert.True(t, got.IsBuiltin)
	assert.Equal(t, NotifyTemplateStatusApplied, got.Status)
	// checksum 复用 AlertmanagerConfigChecksum（sha256 十六进制小写，64 字节）。
	assert.Equal(t, AlertmanagerConfigChecksum(content), got.Checksum)
	assert.Len(t, got.Checksum, 64)
	assert.Equal(t, "notify_templates", NotifyTemplate{}.TableName())
}

// TestValidNotifyChannelTypes 覆盖渠道类型枚举校验。
func TestValidNotifyChannelTypes(t *testing.T) {
	assert.True(t, IsValidNotifyChannelType("feishu"))
	assert.True(t, IsValidNotifyChannelType("dingtalk"))
	assert.True(t, IsValidNotifyChannelType("wecom"))
	assert.False(t, IsValidNotifyChannelType("email"))
	assert.False(t, IsValidNotifyChannelType(""))

	types := ValidNotifyChannelTypes()
	assert.ElementsMatch(t, []string{"feishu", "dingtalk", "wecom"}, types)
}