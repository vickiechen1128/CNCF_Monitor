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

// openServiceTestDB 打开逐测试的内存 SQLite 并迁移服务、应用和业务字典表；随后落服务 fixtures。
func openServiceTestDB(t *testing.T, fixtures ...models.ServiceDict) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&serviceTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_service_%d?mode=memory&cache=shared", n)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ServiceDict{}, &models.ApplicationDict{}, &models.BusinessDomain{}))
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
	appStore := NewApplicationDictStore(db)
	bizStore := NewBusinessDomainStore(db)
	require.NoError(t, db.Create(&[]models.ApplicationDict{
		{AppCode: "pay-app", AppName: "支付应用", Status: models.AppStatusEnabled},
		{AppCode: "old-app", AppName: "停用应用", Status: models.AppStatusDisabled},
	}).Error)
	require.NoError(t, db.Create(&[]models.BusinessDomain{
		{Code: "payment", Name: "支付业务", Enabled: true},
		{Code: "old-biz", Name: "停用业务", Enabled: false},
	}).Error)
	r := gin.New()
	r.GET("/api/v2/platform/service-dict", ListServiceDicts(store))
	r.POST("/api/v2/platform/service-dict", CreateServiceDict(store, appStore, bizStore))
	r.PUT("/api/v2/platform/service-dict/:service_code", UpdateServiceDict(store, appStore, bizStore))

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

	// 登记新服务（关系字段留空合法，默认 enabled）。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"user-api","service_name":"用户接口"}`)
	require.Equal(t, http.StatusOK, code, "登记应成功：%v", out)
	assert.Equal(t, "user-api", out["service_code"])
	assert.Equal(t, true, out["enabled"])
	assert.NotContains(t, out, "app_code")
	assert.NotContains(t, out, "biz_code")

	// 非空关系字段须命中启用的应用/业务字典条目。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"checkout-api","service_name":"结算接口","app_code":"pay-app","biz_code":"payment"}`)
	require.Equal(t, http.StatusOK, code, "带有效关系登记应成功：%v", out)
	assert.Equal(t, "pay-app", out["app_code"])
	assert.Equal(t, "payment", out["biz_code"])

	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{name: "应用未登记", body: `{"service_code":"missing-app-svc","service_name":"x","app_code":"missing-app"}`, want: "未登记或已停用，请到『应用字典』登记或启用后重试"},
		{name: "应用已停用", body: `{"service_code":"old-app-svc","service_name":"x","app_code":"old-app"}`, want: "未登记或已停用，请到『应用字典』登记或启用后重试"},
		{name: "业务未登记", body: `{"service_code":"missing-biz-svc","service_name":"x","biz_code":"missing-biz"}`, want: "未登记或已停用，请到『业务字典』登记或启用后重试"},
		{name: "业务已停用", body: `{"service_code":"old-biz-svc","service_name":"x","biz_code":"old-biz"}`, want: "未登记或已停用，请到『业务字典』登记或启用后重试"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gotCode, got := doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", tc.body)
			require.Equal(t, http.StatusBadRequest, gotCode)
			assert.Contains(t, got["error"], tc.want)
		})
	}

	// 重名 service_code 登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"user-api","service_name":"重复"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 非法 service_code（含下划线）登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"bad_code","service_name":"坏"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// service_name 缺失 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/service-dict", `{"service_code":"no-name"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 受限编辑：可改关系字段与 enabled；请求体中的 service_code 被忽略。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/service-dict/user-api", `{"service_code":"hijack","service_name":"用户接口-改","enabled":false,"app_code":"pay-app","biz_code":"payment"}`)
	require.Equal(t, http.StatusOK, code, "编辑应成功：%v", out)
	assert.Equal(t, "用户接口-改", out["service_name"])
	assert.Equal(t, false, out["enabled"])
	assert.Equal(t, "user-api", out["service_code"], "service_code 不可改")
	assert.Equal(t, "pay-app", out["app_code"])
	assert.Equal(t, "payment", out["biz_code"])

	// 关系字段可显式清空。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/service-dict/user-api", `{"app_code":"","biz_code":""}`)
	require.Equal(t, http.StatusOK, code, "清空关系字段应成功：%v", out)
	assert.NotContains(t, out, "app_code")
	assert.NotContains(t, out, "biz_code")

	// 更新为停用关系条目仍须拒绝。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/service-dict/user-api", `{"app_code":"old-app"}`)
	require.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, out["error"], "未登记或已停用，请到『应用字典』登记或启用后重试")

	// 不存在的 service_code 编辑 → not_found。
	code, _ = doJSON(t, r, http.MethodPut, "/api/v2/platform/service-dict/nope", `{"service_name":"x"}`)
	require.Equal(t, http.StatusNotFound, code)

	// 列表总数：2 fixture + 2 新登记 = 4。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/service-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(4), out["total"])
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

// TestServiceDictHasNullableRelationFields 固化决策 112：服务字典以可空 app_code /
// biz_code 承载应用↔服务和服务↔业务关系，不引入 platform_code。
func TestServiceDictHasNullableRelationFields(t *testing.T) {
	db := openServiceTestDB(t)
	assert.True(t, db.Migrator().HasColumn(&models.ServiceDict{}, "app_code"))
	assert.True(t, db.Migrator().HasColumn(&models.ServiceDict{}, "biz_code"))
	assert.False(t, db.Migrator().HasColumn(&models.ServiceDict{}, "platform_code"))

	columns, err := db.Migrator().ColumnTypes(&models.ServiceDict{})
	require.NoError(t, err)
	nullable := make(map[string]bool)
	for _, column := range columns {
		value, ok := column.Nullable()
		if ok {
			nullable[column.Name()] = value
		}
	}
	assert.True(t, nullable["app_code"], "app_code 应可空")
	assert.True(t, nullable["biz_code"], "biz_code 应可空")

	require.NoError(t, db.Create(&models.ServiceDict{
		ServiceCode: "nullable-service",
		ServiceName: "可空关系服务",
		Enabled:     true,
	}).Error)
}
