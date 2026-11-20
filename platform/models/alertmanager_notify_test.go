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
	}
	require.NoError(t, db.Create(&ch).Error)
	require.NotZero(t, ch.ID)

	var got NotifyChannel
	require.NoError(t, db.First(&got, ch.ID).Error)
	assert.Equal(t, "SRE 飞书群", got.Name)
	assert.Equal(t, NotifyChannelTypeFeishu, got.Type)
	assert.Equal(t, "s3cr3t", got.Secret)
	assert.Equal(t, "notify_channels", NotifyChannel{}.TableName())
}

// TestNotifyTemplateMigrateAndChecksum 覆盖模板建表 / checksum 落库 / status 恒 applied。
func TestNotifyTemplateMigrateAndChecksum(t *testing.T) {
	db := newNotifyModelDB(t)

	content := `{{ define "x" }}{{ .Status }}{{ end }}`
	tpl := NotifyTemplate{
		Name:        "飞书卡片-默认",
		ChannelType: NotifyChannelTypeFeishu,
		Content:     content,
		IsBuiltin:   true,
		Checksum:    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		Status:      NotifyTemplateStatusApplied,
	}
	require.NoError(t, db.Create(&tpl).Error)
	require.NotZero(t, tpl.ID)

	var got NotifyTemplate
	require.NoError(t, db.First(&got, tpl.ID).Error)
	assert.True(t, got.IsBuiltin)
	assert.Equal(t, NotifyTemplateStatusApplied, got.Status)
	assert.Len(t, got.Checksum, 64)
	assert.Equal(t, "notify_templates", NotifyTemplate{}.TableName())
}
