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

var appPlatformRelTestDBCounter int64

func openAppPlatformRelTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&appPlatformRelTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_app_platform_rel_%d?mode=memory&cache=shared", n)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ApplicationDict{}, &models.PlatformDict{}, &models.AppPlatformRel{}))
	require.NoError(t, db.Create(&[]models.ApplicationDict{
		{AppCode: "app-a", AppName: "应用 A", Status: models.AppStatusEnabled},
		{AppCode: "app-b", AppName: "应用 B", Status: models.AppStatusEnabled},
		{AppCode: "old-app", AppName: "停用应用", Status: models.AppStatusDisabled},
	}).Error)
	require.NoError(t, db.Create(&[]models.PlatformDict{
		{PlatformCode: "platform-a", PlatformName: "平台 A", Enabled: true},
		{PlatformCode: "platform-b", PlatformName: "平台 B", Enabled: true},
		{PlatformCode: "platform-c", PlatformName: "平台 C", Enabled: true},
		{PlatformCode: "old-platform", PlatformName: "停用平台", Enabled: false},
	}).Error)
	return db
}

// newAppPlatformStore 构造带 app_platform_rel 表与关联夹具的关联 store，供资源
// 写链路（POST/PUT/导入）注入平台自洽校验依赖（决策 110）。
func newAppPlatformStore(t *testing.T) *AppPlatformStore {
	t.Helper()
	return NewAppPlatformStore(openAppPlatformRelTestDB(t))
}

func TestAppPlatformRelEndpoints(t *testing.T) {
	db := openAppPlatformRelTestDB(t)
	store := NewAppPlatformStore(db)
	appStore := NewApplicationDictStore(db)
	platformStore := NewPlatformDictStore(db)
	r := gin.New()
	r.GET("/api/v2/platform/app-platform-rel", ListAppPlatformRels(store))
	r.POST("/api/v2/platform/app-platform-rel", CreateAppPlatformRel(store, appStore, platformStore))
	r.PUT("/api/v2/platform/app-platform-rel/:rel_id", UpdateAppPlatformRel(store))
	r.DELETE("/api/v2/platform/app-platform-rel/:rel_id", DeleteAppPlatformRel(store))

	// 同一应用可挂两个平台，is_primary 缺省为 false。
	code, first := doJSON(t, r, http.MethodPost, "/api/v2/platform/app-platform-rel", `{"app_code":"app-a","platform_code":"platform-a","is_primary":true}`)
	require.Equal(t, http.StatusOK, code, "创建主平台关联应成功：%v", first)
	assert.Equal(t, true, first["is_primary"])
	firstID := uint(first["rel_id"].(float64))

	code, second := doJSON(t, r, http.MethodPost, "/api/v2/platform/app-platform-rel", `{"app_code":"app-a","platform_code":"platform-b"}`)
	require.Equal(t, http.StatusOK, code, "一应用挂第二个平台应成功：%v", second)
	assert.Equal(t, false, second["is_primary"])
	secondID := uint(second["rel_id"].(float64))

	// 重复关联拒绝。
	code, out := doJSON(t, r, http.MethodPost, "/api/v2/platform/app-platform-rel", `{"app_code":"app-a","platform_code":"platform-a"}`)
	require.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, out["error"], "已关联")

	// POST 新主平台时，已有主平台必须显式拒绝，不能静默降级。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/app-platform-rel", `{"app_code":"app-a","platform_code":"platform-c","is_primary":true}`)
	require.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, out["error"], "已存在主平台")

	// 停用平台与停用应用均不可建立新关联。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/app-platform-rel", `{"app_code":"app-b","platform_code":"old-platform"}`)
	require.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, out["error"], "未登记或已停用")
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/app-platform-rel", `{"app_code":"old-app","platform_code":"platform-a"}`)
	require.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, out["error"], "未登记或已停用")

	// GET 支持 app_code / platform_code 组合过滤，且信封使用 list 键。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/app-platform-rel?app_code=app-a&platform_code=platform-b", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["total"])
	list := out["list"].([]interface{})
	require.Len(t, list, 1)
	assert.Equal(t, "platform-b", list[0].(map[string]interface{})["platform_code"])
	assert.NotEmpty(t, list[0].(map[string]interface{})["created_at"])

	// PUT true 必须在同一事务内先清旧主平台再设置当前行。
	code, out = doJSON(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/app-platform-rel/%d", secondID), `{"is_primary":true}`)
	require.Equal(t, http.StatusOK, code, "切换主平台应成功：%v", out)
	assert.Equal(t, true, out["is_primary"])
	var rows []models.AppPlatformRel
	require.NoError(t, db.Where("app_code = ?", "app-a").Order("id ASC").Find(&rows).Error)
	require.Len(t, rows, 2)
	assert.False(t, rows[0].IsPrimary)
	assert.True(t, rows[1].IsPrimary)

	// DELETE 返回非 null 空 warnings，且解除关联。
	code, out = doJSON(t, r, http.MethodDelete, fmt.Sprintf("/api/v2/platform/app-platform-rel/%d", firstID), "")
	require.Equal(t, http.StatusOK, code, "解绑应成功：%v", out)
	assert.Equal(t, float64(firstID), out["rel_id"])
	warnings, ok := out["warnings"].([]interface{})
	require.True(t, ok, "warnings 必须为空数组而非 null")
	assert.Empty(t, warnings)

	var count int64
	require.NoError(t, db.Model(&models.AppPlatformRel{}).Where("app_code = ?", "app-a").Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

// TestAppPlatformStorePrimaryPlatformOf 覆盖决策 110 兜底取值核心路径：
// 无关联 / 仅非主平台关联 → ("", false)；设定主平台 → (code, true)；
// 切换主平台 → 返回新主平台；nil store 安全返回 ("", false, nil)。
func TestAppPlatformStorePrimaryPlatformOf(t *testing.T) {
	store := newAppPlatformStore(t)

	// 1. 应用无任何关联 → 返回 ("", false, nil)。
	code, ok, err := store.PrimaryPlatformOf("app-a")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Equal(t, "", code)

	// 2. 应用仅挂非主平台关联（无主平台）→ 仍返回 ("", false, nil)。
	_, err = store.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: false})
	require.NoError(t, err)
	code, ok, err = store.PrimaryPlatformOf("app-a")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Equal(t, "", code)

	// 3. 把该关联设为主平台 → 返回 (platform-a, true)。
	rels, err := store.List("app-a", "")
	require.NoError(t, err)
	require.Len(t, rels, 1)
	_, err = store.SetPrimary(rels[0].RelID, true)
	require.NoError(t, err)
	code, ok, err = store.PrimaryPlatformOf("app-a")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "platform-a", code)

	// 4. 再挂第二个平台并切换主平台 → 返回新主平台 (platform-b)。
	_, err = store.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-b", IsPrimary: false})
	require.NoError(t, err)
	rels, err = store.List("app-a", "platform-b")
	require.NoError(t, err)
	require.Len(t, rels, 1)
	_, err = store.SetPrimary(rels[0].RelID, true)
	require.NoError(t, err)
	code, ok, err = store.PrimaryPlatformOf("app-a")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "platform-b", code)

	// 5. nil store 必须安全返回 ("", false, nil)，不 panic。
	var nilStore *AppPlatformStore
	code, ok, err = nilStore.PrimaryPlatformOf("app-a")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Equal(t, "", code)
}
