package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunSeedsCloudDictIdempotently(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))
	require.NoError(t, Run(db))

	var rows []models.CloudDict
	require.NoError(t, db.Order("cloud_code ASC").Find(&rows).Error)
	require.Len(t, rows, 2)
	assert.Equal(t, "GM-CU", rows[0].CloudCode)
	assert.Equal(t, "政务云（联通）", rows[0].CloudName)
	assert.Equal(t, models.CloudTypeGovernment, rows[0].CloudType)
	assert.Equal(t, models.CloudCarrierUnicom, rows[0].Carrier)
	assert.True(t, rows[0].Enabled)
	assert.Contains(t, rows[0].Description, "规划中")
	assert.Equal(t, "PUB-TX", rows[1].CloudCode)
	assert.Equal(t, "腾讯云", rows[1].CloudName)
	assert.Equal(t, models.CloudTypePublic, rows[1].CloudType)
	assert.Equal(t, models.CloudCarrierTencent, rows[1].Carrier)
	assert.True(t, rows[1].Enabled)

	for _, code := range []string{"GM-CM", "IND-TX", "PRI-TX"} {
		var count int64
		require.NoError(t, db.Model(&models.CloudDict{}).Where("cloud_code = ?", code).Count(&count).Error)
		assert.Zero(t, count, "%s 不应被预置", code)
	}
}

func TestRunCloudDictsRealignsPresetValues(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, runCloudDicts(db))
	require.NoError(t, db.Model(&models.CloudDict{}).Where("cloud_code = ?", "PUB-TX").Updates(map[string]interface{}{
		"cloud_name": "人工修改",
		"cloud_type": models.CloudTypePrivate,
		"carrier":    models.CloudCarrierMobile,
		"enabled":    false,
	}).Error)

	require.NoError(t, runCloudDicts(db))

	var got models.CloudDict
	require.NoError(t, db.Where("cloud_code = ?", "PUB-TX").First(&got).Error)
	assert.Equal(t, "腾讯云", got.CloudName)
	assert.Equal(t, models.CloudTypePublic, got.CloudType)
	assert.Equal(t, models.CloudCarrierTencent, got.Carrier)
	assert.True(t, got.Enabled)
}
