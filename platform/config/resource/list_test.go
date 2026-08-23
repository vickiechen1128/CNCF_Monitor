package resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// listTestDBCounter 为每个测试生成唯一的内存 DB 名，避免同包内测试共享同一库。
var listTestDBCounter int64

// openListTestDB 打开逐测试的内存 SQLite，并迁移本任务涉及的五个资源模型。
func openListTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&listTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_list_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	))
	return db
}

// mountListResources 挂载资源列表 handler 供测试。
func mountListResources(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/resources", ListResources(db))
	return r
}

// resourceListResponse 镜像资源列表接口的统一响应信封。
type resourceListResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		List     []map[string]interface{} `json:"list"`
		Total    int64                    `json:"total"`
		Page     int                      `json:"page"`
		PageSize int                      `json:"page_size"`
	} `json:"data"`
}

// doResourceList 以指定 query（"" 或 "?..."）请求列表接口并解码统一响应。
func doResourceList(t *testing.T, r *gin.Engine, query string) (*httptest.ResponseRecorder, resourceListResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out resourceListResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// seedHostList 落一条主机 fixture。ServerID 有唯一索引，与 ResourceID 保持一致以共存多条。
func seedHostList(t *testing.T, db *gorm.DB, id, domain, name, ip, status string) *models.Host {
	t.Helper()
	h := &models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domain,
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     name,
		Status:           status,
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        ip,
	}
	require.NoError(t, db.Create(h).Error)
	return h
}

// seedDatabaseList 落一条数据库 fixture。
func seedDatabaseList(t *testing.T, db *gorm.DB, id, domain, ip string, port int, status string) *models.Database {
	t.Helper()
	d := &models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID:       id,
			ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID:  domain,
			BizCode:          "infra",
			Env:              "prod",
			Status:           status,
			SourceType:       models.SourceTypeManual,
		},
		DatabaseType: "mysql",
		InstanceIP:   ip,
		Port:         port,
		ResourceType: models.ResourceTypeDatabase,
	}
	require.NoError(t, db.Create(d).Error)
	return d
}

// seedMiddlewareList 落一条中间件 fixture。
func seedMiddlewareList(t *testing.T, db *gorm.DB, id, domain, ip string, port int, status string) *models.Middleware {
	t.Helper()
	m := &models.Middleware{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeMiddleware,
		ResourceCategory: models.ResourceCategoryMiddleware,
		NetworkDomainID:  domain,
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		AppName:          "kafka-app",
		Env:              "prod",
		Cluster:          "kafka-cluster",
		Status:           status,
		MiddlewareType:   "kafka",
		InstanceIP:       ip,
		Port:             port,
	}
	require.NoError(t, db.Create(m).Error)
	return m
}

// seedApplicationList 落一条应用服务 fixture。
func seedApplicationList(t *testing.T, db *gorm.DB, id, domain, service, endpoint, status string) *models.Application {
	t.Helper()
	a := &models.Application{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeApplication,
		ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID:  domain,
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppName:          service,
		Env:              "prod",
		Cluster:          "pay-cluster",
		Status:           status,
		ServiceName:      service,
		HealthCheckURL:   "http://" + endpoint + "/health",
		Protocol:         "http",
		Endpoint:         endpoint,
	}
	require.NoError(t, db.Create(a).Error)
	return a
}

// seedGenericTargetList 落一条通用指标目标 fixture。
func seedGenericTargetList(t *testing.T, db *gorm.DB, id, domain, name, ip string, port int, status string) *models.GenericTarget {
	t.Helper()
	g := &models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID:       id,
			ResourceCategory: models.ResourceCategoryGenericTarget,
			NetworkDomainID:  domain,
			BizCode:          "infra",
			Env:              "prod",
			Status:           status,
			SourceType:       models.SourceTypeManual,
		},
		TargetName:   name,
		InstanceIP:   ip,
		Port:         port,
		MetricsPath:  "/metrics",
		Scheme:       "http",
		ExporterType: "snmp_exporter",
		CustomLabels: map[string]string{"device_type": "snmp_switch"},
		ResourceType: models.ResourceTypeGenericTarget,
	}
	require.NoError(t, db.Create(g).Error)
	return g
}

// TestListResourcesCategoryRequiredAndInvalid 验证 resource_category 必填/非法 → bad_request。
func TestListResourcesCategoryRequiredAndInvalid(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)

	// 缺失
	w, out := doResourceList(t, r, "")
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "resource_category")

	// 非法值
	w, out = doResourceList(t, r, "?resource_category=invalid")
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "resource_category")
}

// TestListResourcesEachCategory 验证按分类路由到五类表，且列表仅含对应类型。
func TestListResourcesEachCategory(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	seedDatabaseList(t, db, "db-1", "default", "10.0.0.2", 3306, "online")
	seedMiddlewareList(t, db, "mw-1", "default", "10.0.0.3", 9092, "online")
	seedApplicationList(t, db, "app-1", "default", "pay-service", "10.0.0.4:8080", "online")
	seedGenericTargetList(t, db, "gt-1", "default", "switch-1", "10.0.0.5", 161, "offline")

	for _, tc := range []struct {
		category string
		wantID   string
	}{
		{"host", "host-1"},
		{"database", "db-1"},
		{"middleware", "mw-1"},
		{"application", "app-1"},
		{"generic_target", "gt-1"},
	} {
		t.Run(tc.category, func(t *testing.T) {
			_, out := doResourceList(t, r, "?resource_category="+tc.category)
			require.Equal(t, "success", out.Status)
			require.Equal(t, int64(1), out.Data.Total)
			require.Len(t, out.Data.List, 1)
			assert.Equal(t, tc.category, out.Data.List[0]["resource_category"])
			assert.Equal(t, tc.wantID, out.Data.List[0]["resource_id"])
		})
	}
}

// TestListResourcesItemFields 验证 item 字段对齐 §5.2 共享字段与 host 差异化字段。
func TestListResourcesItemFields(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")

	_, out := doResourceList(t, r, "?resource_category=host")
	require.Len(t, out.Data.List, 1)
	item := out.Data.List[0]

	// §5.2 共享契约字段
	for _, f := range []string{
		"resource_id", "resource_category", "network_domain_id", "biz_code",
		"app_name", "env", "cluster", "owner", "status", "source_type",
	} {
		_, ok := item[f]
		assert.True(t, ok, "item 应含共享字段 %s", f)
	}

	// host 差异化字段（§5.6，legacy 映射：hostname=instance_name、instance_ip=private_ip、os_type=image）
	assert.Equal(t, "web-01", item["instance_name"])
	assert.Equal(t, "web-01", item["hostname"])
	assert.Equal(t, "10.0.0.1", item["instance_ip"])
	assert.Equal(t, "linux", item["os_type"])
	assert.Equal(t, "online", item["status"])
	assert.Equal(t, "manual", item["source_type"])
	assert.Equal(t, "infra", item["biz_code"])

	// Host 模型无 owner 列：以空串补齐，保持五类 item 契约字段稳定
	assert.Equal(t, "", item["owner"])
}

// TestListResourcesGenericItemCustomLabels 验证 generic_target 差异化字段与 custom_labels map。
func TestListResourcesGenericItemCustomLabels(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedGenericTargetList(t, db, "gt-1", "default", "switch-1", "10.0.0.5", 161, "offline")

	_, out := doResourceList(t, r, "?resource_category=generic_target")
	require.Len(t, out.Data.List, 1)
	item := out.Data.List[0]
	assert.Equal(t, "switch-1", item["target_name"])
	assert.Equal(t, float64(161), item["port"], "port 以 JSON 数字序列化")
	assert.Equal(t, "snmp_exporter", item["exporter_type"])
	assert.Equal(t, "http", item["scheme"])

	labels, ok := item["custom_labels"].(map[string]interface{})
	require.True(t, ok, "custom_labels 应为 JSON 对象")
	assert.Equal(t, "snmp_switch", labels["device_type"])
}

// TestListResourcesNetworkDomainFilter 验证 network_domain_id 等值筛选。
func TestListResourcesNetworkDomainFilter(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	seedHostList(t, db, "host-2", "dc-2", "web-02", "10.0.1.1", "online")
	seedDatabaseList(t, db, "db-1", "dc-2", "10.0.1.2", 3306, "online")

	_, out := doResourceList(t, r, "?resource_category=host&network_domain_id=dc-2")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-2", out.Data.List[0]["resource_id"])

	// 未传网域 → 全量
	_, out = doResourceList(t, r, "?resource_category=host")
	require.Equal(t, int64(2), out.Data.Total)
}

// TestListResourcesKeywordFilter 验证 keyword（名称+IP）模糊筛选。
func TestListResourcesKeywordFilter(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	seedHostList(t, db, "host-2", "default", "pay-01", "10.0.0.2", "online")
	seedDatabaseList(t, db, "db-1", "default", "10.0.0.3", 3306, "online")

	// keyword 命中主机名（host 名称 = instance_name）
	_, out := doResourceList(t, r, "?resource_category=host&keyword=pay")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "pay-01", out.Data.List[0]["instance_name"])

	// keyword 命中 IP（database 按 instance_ip 匹配）
	_, out = doResourceList(t, r, "?resource_category=database&keyword=10.0.0.3")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "db-1", out.Data.List[0]["resource_id"])
}

// TestListResourcesFilterCombination 验证网域 + 关键字组合筛选。
func TestListResourcesFilterCombination(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	seedHostList(t, db, "host-2", "default", "web-02", "10.0.0.2", "online")
	seedHostList(t, db, "host-3", "dc-2", "web-03", "10.0.1.1", "online")

	_, out := doResourceList(t, r, "?resource_category=host&network_domain_id=default&keyword=web-02")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-2", out.Data.List[0]["resource_id"])

	// 组合无命中 → 空
	_, out = doResourceList(t, r, "?resource_category=host&network_domain_id=default&keyword=web-03")
	require.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.List)
}

// TestListResourcesPagination 验证分页默认 50、上限 100、翻页与非法值回退。
func TestListResourcesPagination(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	for i := 0; i < 120; i++ {
		seedHostList(t, db, fmt.Sprintf("host-%03d", i), "default",
			fmt.Sprintf("web-%03d", i), fmt.Sprintf("10.0.0.%d", i%200+1), "online")
	}

	// 默认分页 page=1/page_size=50
	_, out := doResourceList(t, r, "?resource_category=host")
	require.Equal(t, int64(120), out.Data.Total)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, 50, out.Data.PageSize)
	require.Len(t, out.Data.List, 50)

	// page_size=200 钳制到 100
	_, out = doResourceList(t, r, "?resource_category=host&page=1&page_size=200")
	assert.Equal(t, 100, out.Data.PageSize)
	require.Len(t, out.Data.List, 100)

	// 第二页剩余 20 条
	_, out = doResourceList(t, r, "?resource_category=host&page=2&page_size=100")
	require.Len(t, out.Data.List, 20)

	// 非法 page/page_size 回退默认
	_, out = doResourceList(t, r, "?resource_category=host&page=abc&page_size=-1")
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, 50, out.Data.PageSize)
}

// TestListResourcesEmptyResult 验证空结果返回空 list 而非 null。
func TestListResourcesEmptyResult(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)

	// 无任何数据
	w, out := doResourceList(t, r, "?resource_category=host")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, int64(0), out.Data.Total)
	assert.NotNil(t, out.Data.List, "空结果应返回空 list 而非 null")
	assert.Empty(t, out.Data.List)

	// 筛选无命中
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	_, out = doResourceList(t, r, "?resource_category=host&keyword=nomatch")
	require.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.List)
}

// TestListResourcesSoftDeleteExcluded 验证已软删记录不进入列表。
func TestListResourcesSoftDeleteExcluded(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	h1 := seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	seedHostList(t, db, "host-2", "default", "web-02", "10.0.0.2", "online")

	require.NoError(t, db.Delete(&models.Host{}, "resource_id = ?", h1.ResourceID).Error)

	_, out := doResourceList(t, r, "?resource_category=host")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-2", out.Data.List[0]["resource_id"])
}

// TestListResourcesBizCodeStatusFilter 覆盖 biz_code / status 服务端等值筛选
// （PRD §11.1，K-1 闭环）：两参数可独立筛选、可与网域/关键字组合、可组合命中。
func TestListResourcesBizCodeStatusFilter(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	// host: infra/online、infra/offline、payment/online（server_id 与 resource_id 一致以共存）。
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")   // infra
	seedHostList(t, db, "host-2", "default", "web-02", "10.0.0.2", "offline")  // infra
	seedHostList(t, db, "host-3", "default", "web-03", "10.0.0.3", "online")   // infra
	h := &models.Host{
		ResourceID:       "host-4",
		ServerID:         "host-4",
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		InstanceName:     "web-04",
		Status:           "online",
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        "10.0.0.4",
	}
	require.NoError(t, db.Create(h).Error)

	// status=offline → 仅 host-2。
	_, out := doResourceList(t, r, "?resource_category=host&status=offline")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-2", out.Data.List[0]["resource_id"])

	// biz_code=payment → 仅 host-4。
	_, out = doResourceList(t, r, "?resource_category=host&biz_code=payment")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-4", out.Data.List[0]["resource_id"])

	// biz_code=infra + status=online → host-1/host-3。
	_, out = doResourceList(t, r, "?resource_category=host&biz_code=infra&status=online")
	require.Equal(t, int64(2), out.Data.Total)
	ids := map[string]bool{}
	for _, it := range out.Data.List {
		ids[it["resource_id"].(string)] = true
	}
	assert.True(t, ids["host-1"] && ids["host-3"])

	// 组合无命中 → 空。
	_, out = doResourceList(t, r, "?resource_category=host&biz_code=payment&status=offline")
	require.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.List)

	// 未传筛选 → 全量 4 条。
	_, out = doResourceList(t, r, "?resource_category=host")
	require.Equal(t, int64(4), out.Data.Total)
}

// TestListResourcesIsMonitoredPassthrough 验证 is_monitored 参数透传不报错，
// M01 未实现时不改变查询结果。
func TestListResourcesIsMonitoredPassthrough(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")

	for _, q := range []string{
		"?resource_category=host&is_monitored=true",
		"?resource_category=host&is_monitored=false",
		"?resource_category=host&is_monitored=1",
		"?resource_category=host&is_monitored=0",
		"?resource_category=host&is_monitored=yes",
		"?resource_category=host&is_monitored=",
	} {
		w, out := doResourceList(t, r, q)
		require.Equal(t, http.StatusOK, w.Code, "query %s 不应报错", q)
		assert.Equal(t, "success", out.Status, "query %s", q)
		assert.Equal(t, int64(1), out.Data.Total, "M01 未实现时 is_monitored 不生效，query %s", q)
	}
}

// TestParseIsMonitored 验证 is_monitored 参数解析（M01 未实现时的透传契约）。
func TestParseIsMonitored(t *testing.T) {
	for _, tc := range []struct {
		raw       string
		valid     bool
		monitored bool
	}{
		{"true", true, true},
		{"1", true, true},
		{"TRUE", true, true},
		{"false", true, false},
		{"0", true, false},
		{"FALSE", true, false},
		{"", false, false},
		{"yes", false, false},
	} {
		valid, monitored := ParseIsMonitored(tc.raw)
		assert.Equal(t, tc.valid, valid, "raw=%q", tc.raw)
		assert.Equal(t, tc.monitored, monitored, "raw=%q", tc.raw)
	}
}
