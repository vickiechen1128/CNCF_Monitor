package models

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCloudDictModel(t *testing.T) {
	assert.Equal(t, CloudType("PUB"), CloudTypePublic)
	assert.Equal(t, CloudType("GM"), CloudTypeGovernment)
	assert.Equal(t, CloudType("IND"), CloudTypeIndustry)
	assert.Equal(t, CloudType("PRI"), CloudTypePrivate)
	assert.Equal(t, CloudCarrier("TX"), CloudCarrierTencent)
	assert.Equal(t, CloudCarrier("CU"), CloudCarrierUnicom)
	assert.Equal(t, CloudCarrier("CM"), CloudCarrierMobile)

	row := CloudDict{
		CloudCode: "PUB-TX",
		CloudName: "腾讯云",
		CloudType: CloudTypePublic,
		Carrier:   CloudCarrierTencent,
		Enabled:   true,
	}
	body, err := json.Marshal(row)
	require.NoError(t, err)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &payload))
	assert.Equal(t, "PUB-TX", payload["cloud_code"])
	assert.Equal(t, "腾讯云", payload["cloud_name"])
	assert.Equal(t, "PUB", payload["cloud_type"])
	assert.Equal(t, "TX", payload["carrier"])
	assert.Equal(t, true, payload["enabled"])
}

func TestCloudDictDisabledPersistsWithoutGORMDefault(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:cloud_dict_model?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&CloudDict{}))

	row := CloudDict{
		CloudCode: "PRI-TX",
		CloudName: "私有云",
		CloudType: CloudTypePrivate,
		Carrier:   CloudCarrierTencent,
		Enabled:   false,
	}
	require.NoError(t, db.Create(&row).Error)

	var got CloudDict
	require.NoError(t, db.Where("cloud_code = ?", row.CloudCode).First(&got).Error)
	assert.False(t, got.Enabled)
}
