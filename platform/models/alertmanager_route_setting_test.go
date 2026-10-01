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

var routeSettingDBCounter int64

// newRouteSettingDB 打开逐测试独享的内存 SQLite 并迁移根兜底接管设定相关表。
func newRouteSettingDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:route_setting_%d?mode=memory&cache=shared", atomic.AddInt64(&routeSettingDBCounter, 1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AlertmanagerRouteSetting{}, &NotifyChannel{}))
	return db
}

// TestAlertmanagerRouteSettingMigrateAndPersist 覆盖建表 / 字段落库 / 主键 / 表名。
func TestAlertmanagerRouteSettingMigrateAndPersist(t *testing.T) {
	db := newRouteSettingDB(t)

	ch := NotifyChannel{Name: "SRE 飞书群", Type: NotifyChannelTypeFeishu, WebhookURL: "https://x", Enabled: true}
	require.NoError(t, db.Create(&ch).Error)

	s := AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID, DefaultReceiverChannelID: &ch.ID}
	require.NoError(t, db.Create(&s).Error)
	require.NotZero(t, s.ID)

	var got AlertmanagerRouteSetting
	require.NoError(t, db.First(&got, s.ID).Error)
	require.NotNil(t, got.DefaultReceiverChannelID)
	assert.Equal(t, ch.ID, *got.DefaultReceiverChannelID)
	assert.Equal(t, DefaultDomainID, got.NetworkDomainID)
	assert.Equal(t, "alertmanager_route_settings", AlertmanagerRouteSetting{}.TableName())
}

// TestAlertmanagerRouteSettingNilMeansNoTakeover 覆盖默认零值（nil）= 不接管、存量零影响。
func TestAlertmanagerRouteSettingNilMeansNoTakeover(t *testing.T) {
	db := newRouteSettingDB(t)

	s := AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID}
	require.NoError(t, db.Create(&s).Error)

	var got AlertmanagerRouteSetting
	require.NoError(t, db.First(&got, s.ID).Error)
	assert.Nil(t, got.DefaultReceiverChannelID)

	name, ok := got.EffectiveDefaultReceiver([]NotifyChannel{{BaseModel: BaseModel{ID: 1}, Name: "ops", Enabled: true}})
	assert.False(t, ok, "nil 设定不得接管根兜底")
	assert.Empty(t, name)
}

// TestAlertmanagerRouteSettingEffectiveReceiverEnabled 覆盖目标渠道启用 → 取渠道 AM receiver 名。
func TestAlertmanagerRouteSettingEffectiveReceiverEnabled(t *testing.T) {
	chID := uint(7)
	s := AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID, DefaultReceiverChannelID: &chID}

	channels := []NotifyChannel{
		{BaseModel: BaseModel{ID: 3}, Name: "ops-webhook", Enabled: true},
		{BaseModel: BaseModel{ID: 7}, Name: "SRE 飞书群", Enabled: true},
	}
	name, ok := s.EffectiveDefaultReceiver(channels)
	require.True(t, ok)
	// ReceiverName() 与 M09 receivers 物化同源（决策 74 定稿第 1 条）：sanitize 后为 "sre"。
	assert.Equal(t, "sre", name)
}

// TestAlertmanagerRouteSettingEffectiveReceiverUnavailable 覆盖目标渠道禁用 / 不存在 → 回落不接管，
// 且设定原值保留（不回写库、不报错，决策 113 护栏③）。
func TestAlertmanagerRouteSettingEffectiveReceiverUnavailable(t *testing.T) {
	chID := uint(7)
	s := AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID, DefaultReceiverChannelID: &chID}

	// 目标渠道被禁用 → 不接管。
	name, ok := s.EffectiveDefaultReceiver([]NotifyChannel{{BaseModel: BaseModel{ID: 7}, Name: "sre", Enabled: false}})
	assert.False(t, ok, "渠道禁用时应回落为不接管")
	assert.Empty(t, name)

	// 目标渠道已被删除（集合中不存在）→ 不接管。
	name, ok = s.EffectiveDefaultReceiver([]NotifyChannel{{BaseModel: BaseModel{ID: 9}, Name: "other", Enabled: true}})
	assert.False(t, ok, "渠道不存在时应回落为不接管")
	assert.Empty(t, name)

	// 设定原值保留，待渠道恢复启用后自动重新生效。
	require.NotNil(t, s.DefaultReceiverChannelID)
	assert.Equal(t, uint(7), *s.DefaultReceiverChannelID)
}

// TestAlertmanagerRouteSettingUniquePerDomain 覆盖 network_domain_id 唯一索引（管理域单例），
// 且不同网域可各持一条。
func TestAlertmanagerRouteSettingUniquePerDomain(t *testing.T) {
	db := newRouteSettingDB(t)

	require.NoError(t, db.Create(&AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID}).Error)
	err := db.Create(&AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID}).Error
	require.Error(t, err, "同网域重复写入应被唯一索引拒绝")

	require.NoError(t, db.Create(&AlertmanagerRouteSetting{NetworkDomainID: "domain-b"}).Error)
}

// TestAlertmanagerRouteSettingReceiverNameFallback 覆盖渠道名 sanitize 为空 → 回落 notify-<id>。
func TestAlertmanagerRouteSettingReceiverNameFallback(t *testing.T) {
	chID := uint(7)
	s := AlertmanagerRouteSetting{NetworkDomainID: DefaultDomainID, DefaultReceiverChannelID: &chID}

	name, ok := s.EffectiveDefaultReceiver([]NotifyChannel{{BaseModel: BaseModel{ID: 7}, Name: "飞书群", Enabled: true}})
	require.True(t, ok)
	assert.Equal(t, "notify-7", name)
}