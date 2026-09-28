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

// TestApplicationDictPlatformParent 覆盖应用条目的可选父级 platform_code（决策 104 /
// 107）：可挂 / 可摘 / 可换；引用停用平台或未登记平台 → bad_request；未挂时正常。
func TestApplicationDictPlatformParent(t *testing.T) {
	db := openAppPlatformTestDB(t,
		[]models.PlatformDict{
			{PlatformCode: "cmp", PlatformName: "算力平台", Enabled: true},
			{PlatformCode: "data-hub", PlatformName: "数据平台", Enabled: true},
			{PlatformCode: "old-platform", PlatformName: "停用平台", Enabled: false},
		},
		[]models.ApplicationDict{
			{AppCode: "pay-web", AppName: "支付前端", Status: models.AppStatusEnabled},
		},
	)
	appStore := NewApplicationDictStore(db)
	platformStore := NewPlatformDictStore(db)
	r := gin.New()
	r.GET("/api/v2/platform/application-dict", ListApplicationDicts(appStore))
	r.POST("/api/v2/platform/application-dict", CreateApplicationDict(appStore, platformStore))
	r.PUT("/api/v2/platform/application-dict/:app_code", UpdateApplicationDict(appStore, platformStore))

	// 未挂父级：登记正常，platform_code 为空串（资源 platform label 不注入）。
	code, out := doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"order-web","app_name":"订单前端"}`)
	require.Equal(t, http.StatusOK, code, "未挂父级登记应成功：%v", out)
	assert.Equal(t, "", out["platform_code"])

	// 挂父级：引用启用平台条目。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"order-api","app_name":"订单接口","platform_code":"cmp"}`)
	require.Equal(t, http.StatusOK, code, "挂父级登记应成功：%v", out)
	assert.Equal(t, "cmp", out["platform_code"])

	// 引用停用平台 → bad_request（红线④：只允许引用未停用条目）。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"a1","app_name":"A1","platform_code":"old-platform"}`)
	require.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, out["error"], "old-platform")

	// 引用不存在的平台 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"a2","app_name":"A2","platform_code":"not-exist"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 换父级：cmp → data-hub。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/order-api", `{"platform_code":"data-hub"}`)
	require.Equal(t, http.StatusOK, code, "换父级应成功：%v", out)
	assert.Equal(t, "data-hub", out["platform_code"])

	// 摘父级：显式置空串即解除挂靠（不清 app_name）。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/order-api", `{"platform_code":""}`)
	require.Equal(t, http.StatusOK, code, "摘父级应成功：%v", out)
	assert.Equal(t, "", out["platform_code"])
	assert.Equal(t, "订单接口", out["app_name"])

	// 摘父级后再挂回（含同时改名称）：仍走硬校验。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/order-api", `{"app_name":"订单接口-改","platform_code":"cmp"}`)
	require.Equal(t, http.StatusOK, code, "再次挂父级应成功：%v", out)
	assert.Equal(t, "cmp", out["platform_code"])
	assert.Equal(t, "订单接口-改", out["app_name"])

	// 编辑换到停用平台 → bad_request（登记 / 编辑两处同校验）。
	code, _ = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/order-api", `{"platform_code":"old-platform"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 列表返回 platform_code，供前端解析 platform_name 展示。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/application-dict", "")
	require.Equal(t, http.StatusOK, code)
	list, ok := out["list"].([]interface{})
	require.True(t, ok)
	found := false
	for _, raw := range list {
		item := raw.(map[string]interface{})
		if item["app_code"] == "order-api" {
			found = true
			assert.Equal(t, "cmp", item["platform_code"])
		}
	}
	assert.True(t, found, "列表应返回携带 platform_code 的条目")
}
