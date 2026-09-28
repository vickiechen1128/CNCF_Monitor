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

// serviceTestDBCounter 为每个服务字典测试生成唯一的内存 DB 名，避免同包测试共享串扰。
var serviceTestDBCounter int64

// openServiceTestDB 打开逐测试的内存 SQLite 并迁移 ServiceDict 表；随后落 fixtures。
func openServiceTestDB(t *testing.T, fixtures ...models.ServiceDict) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&serviceTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_service_%d?mode=memory&cache=shared", n)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ServiceDict{}))
	if len(fixtures) == 0 {
		fixtures = []models.ServiceDict{
			{ServiceCode: "order-api", ServiceName: "订单接口", Enabled: true},
			{ServiceCode: "pay-api", ServiceName: "支付接口", Enabled: true},
			{ServiceCode: "legacy-api", ServiceName: "遗留接口", Enabled: false},
		}
	}
	for i := range fixtures {
		require.NoError(t, db.Create(&fixtures[i]).Error)
	}
	return db
}

// newSvcStore 构造带默认 fixtures 的服务字典 store。
func newSvcStore(t *testing.T) *ServiceDictStore {
	t.Helper()
	return NewServiceDictStore(openServiceTestDB(t))
}

// TestServiceDictEndpoints 覆盖服务字典端点（决策 105，契约快照 §5D）：
// 只读列表 + 登记 + 受限编辑（仅 service_name/description/enabled）；
// service_code 创建后不可改、无 DELETE 入口（停用不删除）。
func TestServiceDictEndpoints(t *testing.T) {
	db := openServiceTestDB(t,
		models.ServiceDict{ServiceCode: "order-api", ServiceName: "订单接口", Enabled: true},
		models.ServiceDict{ServiceCode: "legacy-api", ServiceName: "遗留接口", Enabled: false},
	)
	store := NewServiceDictStore(db)
	r := gin.New()
	r.GET("/api/v2/platform/service-dict", ListServiceDicts(store))
	r.POST("/api/v2/platform/service-dict", CreateServiceDict(store))
	r.PUT("/api/v2/platform/service-dict/:service_code", UpdateServiceDict(store))

	// 初始列表：2 条 fixture（含停用项）。
	code, out := doJSON(t, r, http.MethodGet, "/api/v2/platform/service-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["total"])
	list, ok := out["list"].([]interface{})
	require.True(t, ok)
	require.Len(t, list, 2)
	first := list[0].(map[string]interface{})
	assert.Equal(t, "order-api", first["service_code"])
	assert.Equal(t, "订单接口", first["service_name"])
	assert.Equal(t, true, first["enabled"])

	// 登记新服务（默认 enabled）。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"user-api","service_name":"用户接口"}`)
	require.Equal(t, http.StatusOK, code, "登记应成功：%v", out)
	assert.Equal(t, "user-api", out["service_code"])
	assert.Equal(t, true, out["enabled"])

	// 重名 service_code 登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"user-api","service_name":"重复"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 非法 service_code（含下划线）登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"bad_code","service_name":"坏"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// service_name 缺失 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"no-name"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 受限编辑：改 service_name 与 enabled（停用）；service_code 不可改。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/service-dict/user-api", `{"service_name":"用户接口-改","enabled":false}`)
	require.Equal(t, http.StatusOK, code, "编辑应成功：%v", out)
	assert.Equal(t, "用户接口-改", out["service_name"])
	assert.Equal(t, false, out["enabled"])
	assert.Equal(t, "user-api", out["service_code"], "service_code 不可改")

	// 不存在的 service_code 编辑 → not_found。
	code, _ = doJSON(t, r, http.MethodPut, "/api/v2/platform/service-dict/nope", `{"service_name":"x"}`)
	require.Equal(t, http.StatusNotFound, code)

	// 列表总数：2 fixture + 1 新登记 = 3。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/service-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(3), out["total"])
}

// TestServiceDictStoreEnabledSemantics 覆盖停用语义（决策 105 红线④）：停用条目不可
// 被新资源选用（不进入 EnabledList / GetEnabledMap），但仍可查得（停用不删除）。
func TestServiceDictStoreEnabledSemantics(t *testing.T) {
	store := newSvcStore(t)

	enabled, err := store.EnabledList()
	require.NoError(t, err)
	require.Len(t, enabled, 2)
	for _, e := range enabled {
		assert.NotEqual(t, "legacy-api", e.ServiceCode, "停用项不进入 EnabledList")
	}

	m, err := store.GetEnabledMap()
	require.NoError(t, err)
	_, ok := m["legacy-api"]
	assert.False(t, ok, "停用项不进入 GetEnabledMap（不可新选）")
	_, ok = m["order-api"]
	assert.True(t, ok)

	entry, found, err := store.Lookup("legacy-api")
	require.NoError(t, err)
	require.True(t, found)
	assert.False(t, entry.Enabled, "停用条目仍可查得（停用不删除）")
}

// TestServiceDictHasNoParentField 固化「服务字典不设父子字段」口径（决策 105）：
// 服务与应用的关联经资源行 app_code + service_code 承载，字典模型不得引入
// app_code / platform_code 父级字段。
func TestServiceDictHasNoParentField(t *testing.T) {
	db := openServiceTestDB(t)
	cols := []string{"app_code", "platform_code", "parent_code"}
	for _, c := range cols {
		assert.False(t, db.Migrator().HasColumn(&models.ServiceDict{}, c),
			"服务字典不应存在父级列 %s（关联经资源行承载）", c)
	}
}
