package resource

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// appPlatformTestDBCounter 为每个「应用 + 平台」联合测试生成唯一的内存 DB 名。
var appPlatformTestDBCounter int64

// openAppPlatformTestDB 打开同时迁移 ApplicationDict 与 PlatformDict 的内存 DB，
// 并落给定的双字典 fixtures（父级校验需要两表同库）。
func openAppPlatformTestDB(t *testing.T, platforms []models.PlatformDict, apps []models.ApplicationDict) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&appPlatformTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_app_platform_%d?mode=memory&cache=shared", n)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ApplicationDict{}, &models.PlatformDict{}))
	for i := range platforms {
		require.NoError(t, db.Create(&platforms[i]).Error)
	}
	for i := range apps {
		require.NoError(t, db.Create(&apps[i]).Error)
	}
	return db
}

// TestApplicationDictPlatformCodeWriteIgnored 固化决策 110：应用字典 DTO 仅保留
// platform_code 供迁移读取，POST/PUT 写链路不再接收或校验该字段。
func TestApplicationDictPlatformCodeWriteIgnored(t *testing.T) {
	db := openAppPlatformTestDB(t,
		[]models.PlatformDict{
			{PlatformCode: "cmp", PlatformName: "算力平台", Enabled: true},
		},
		[]models.ApplicationDict{
			{AppCode: "legacy-app", AppName: "存量应用", Status: models.AppStatusEnabled, PlatformCode: "cmp"},
		},
	)
	appStore := NewApplicationDictStore(db)
	r := gin.New()
	r.POST("/api/v2/platform/application-dict", CreateApplicationDict(appStore))
	r.PUT("/api/v2/platform/application-dict/:app_code", UpdateApplicationDict(appStore))

	// 即使携带不存在的平台编码，POST 也应忽略且不报错。
	code, out := doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"new-app","app_name":"新应用","platform_code":"not-exist"}`)
	require.Equal(t, http.StatusOK, code, "废弃字段不应触发平台校验：%v", out)
	assert.Equal(t, "", out["platform_code"])

	var created models.ApplicationDict
	require.NoError(t, db.Where("app_code = ?", "new-app").First(&created).Error)
	assert.Empty(t, created.PlatformCode, "应用字典写链路不得落 platform_code")

	// PUT 中携带 platform_code 同样被忽略，存量迁移值不得被改写。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/legacy-app", `{"app_name":"存量应用-改","platform_code":"other"}`)
	require.Equal(t, http.StatusOK, code, "废弃字段不应触发平台校验：%v", out)
	assert.Equal(t, "cmp", out["platform_code"])
	assert.Equal(t, "存量应用-改", out["app_name"])

	var legacy models.ApplicationDict
	require.NoError(t, db.Where("app_code = ?", "legacy-app").First(&legacy).Error)
	assert.Equal(t, "cmp", legacy.PlatformCode, "存量迁移字段应保持只读")
}
