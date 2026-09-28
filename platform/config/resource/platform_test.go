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

// platformTestDBCounter 为每个平台字典测试生成唯一的内存 DB 名，避免同包测试共享串扰。
var platformTestDBCounter int64

// openPlatformTestDB 打开逐测试的内存 SQLite 并迁移 PlatformDict 表；随后落 fixtures。
func openPlatformTestDB(t *testing.T, fixtures ...models.PlatformDict) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&platformTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_platform_%d?mode=memory&cache=shared", n)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.PlatformDict{}))
	if len(fixtures) == 0 {
		fixtures = []models.PlatformDict{
			{PlatformCode: "cmp", PlatformName: "统一算力平台", Enabled: true},
			{PlatformCode: "data-platform", PlatformName: "数据平台", Enabled: true},
			{PlatformCode: "legacy-platform", PlatformName: "遗留平台", Enabled: false},
		}
	}
	for i := range fixtures {
		require.NoError(t, db.Create(&fixtures[i]).Error)
	}
	return db
}

// newPlatformStore 构造带默认 fixtures 的平台字典 store。
func newPlatformStore(t *testing.T) *PlatformDictStore {
	t.Helper()
	return NewPlatformDictStore(openPlatformTestDB(t))
}

// TestPlatformDictEndpoints 覆盖平台字典端点（决策 104，契约快照 §5C）：
// 只读列表 + 登记 + 受限编辑（仅 platform_name/description/enabled）；
// platform_code 创建后不可改、无 DELETE 入口（停用不删除）。
func TestPlatformDictEndpoints(t *testing.T) {
	db := openPlatformTestDB(t,
		models.PlatformDict{PlatformCode: "cmp", PlatformName: "统一算力平台", Enabled: true},
		models.PlatformDict{PlatformCode: "legacy-platform", PlatformName: "遗留平台", Enabled: false},
	)
	store := NewPlatformDictStore(db)
	r := gin.New()
	r.GET("/api/v2/platform/platform-dict", ListPlatformDicts(store))
	r.POST("/api/v2/platform/platform-dict", CreatePlatformDict(store))
	r.PUT("/api/v2/platform/platform-dict/:platform_code", UpdatePlatformDict(store))

	// 初始列表：2 条 fixture（含停用项）。
	code, out := doJSON(t, r, http.MethodGet, "/api/v2/platform/platform-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["total"])
	list, ok := out["list"].([]interface{})
	require.True(t, ok, "list 应为数组")
	require.Len(t, list, 2)
	first := list[0].(map[string]interface{})
	assert.Equal(t, "cmp", first["platform_code"])
	assert.Equal(t, "统一算力平台", first["platform_name"])
	assert.Equal(t, true, first["enabled"])

	// 登记新平台（默认 enabled）。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/platform-dict", `{"platform_code":"edge-platform","platform_name":"边缘平台"}`)
	require.Equal(t, http.StatusOK, code, "登记应成功：%v", out)
	assert.Equal(t, "edge-platform", out["platform_code"])
	assert.Equal(t, true, out["enabled"])

	// 重名 platform_code 登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/platform-dict", `{"platform_code":"edge-platform","platform_name":"重复"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 非法 platform_code（大写）登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/platform-dict", `{"platform_code":"BAD","platform_name":"坏"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// platform_name 缺失 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/platform-dict", `{"platform_code":"no-name"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 受限编辑：改 platform_name 与 enabled（停用）；platform_code 不可改。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/platform-dict/edge-platform", `{"platform_name":"边缘平台-改","enabled":false}`)
	require.Equal(t, http.StatusOK, code, "编辑应成功：%v", out)
	assert.Equal(t, "边缘平台-改", out["platform_name"])
	assert.Equal(t, false, out["enabled"])
	assert.Equal(t, "edge-platform", out["platform_code"], "platform_code 不可改")

	// 不存在的 platform_code 编辑 → not_found。
	code, _ = doJSON(t, r, http.MethodPut, "/api/v2/platform/platform-dict/nope", `{"platform_name":"x"}`)
	require.Equal(t, http.StatusNotFound, code)

	// 列表总数：2 fixture + 1 新登记 = 3。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/platform-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(3), out["total"])
}

// TestPlatformDictStoreEnabledSemantics 覆盖停用语义（决策 104 红线）：停用条目不进入
// EnabledList / GetEnabledMap，但仍在 List 中可见（停用不删除）。
func TestPlatformDictStoreEnabledSemantics(t *testing.T) {
	store := newPlatformStore(t)

	enabled, err := store.EnabledList()
	require.NoError(t, err)
	require.Len(t, enabled, 2)
	for _, e := range enabled {
		assert.NotEqual(t, "legacy-platform", e.PlatformCode, "停用项不进入 EnabledList")
	}

	m, err := store.GetEnabledMap()
	require.NoError(t, err)
	_, ok := m["legacy-platform"]
	assert.False(t, ok, "停用项不进入 GetEnabledMap")
	_, ok = m["cmp"]
	assert.True(t, ok)

	entry, found, err := store.Lookup("legacy-platform")
	require.NoError(t, err)
	require.True(t, found)
	assert.False(t, entry.Enabled, "停用条目仍可查得（停用不删除）")

	_, found, err = store.Lookup("not-exist")
	require.NoError(t, err)
	assert.False(t, found)
}
