package resource

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCloudDictStoreAndHandlerReturnAllEntries(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:resource_cloud_dict?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.CloudDict{}))
	require.NoError(t, db.Create(&[]models.CloudDict{
		{CloudCode: "PUB-TX", CloudName: "腾讯云", CloudType: models.CloudTypePublic, Carrier: models.CloudCarrierTencent, Enabled: true},
		{CloudCode: "GM-CU", CloudName: "政务云（联通）", CloudType: models.CloudTypeGovernment, Carrier: models.CloudCarrierUnicom, Enabled: false, Description: "规划中"},
	}).Error)

	store := NewCloudDictStore(db)
	enabled, err := store.GetEnabledMap()
	require.NoError(t, err)
	assert.Contains(t, enabled, "PUB-TX")
	assert.NotContains(t, enabled, "GM-CU")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/cloud-dict", ListCloudDicts(store))
	code, out := doJSON(t, r, http.MethodGet, "/api/v2/platform/cloud-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["total"])
	list, ok := out["list"].([]interface{})
	require.True(t, ok)
	require.Len(t, list, 2)
	second := list[1].(map[string]interface{})
	assert.Equal(t, "GM-CU", second["cloud_code"])
	assert.Equal(t, false, second["enabled"])
	assert.NotContains(t, second, "description")
}

func TestCloudDictStoreNilDBReturnsError(t *testing.T) {
	_, err := NewCloudDictStore(nil).GetEnabledMap()
	assert.Error(t, err)
}
