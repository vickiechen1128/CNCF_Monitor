package resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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
		&models.NetworkDomain{},
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
		CloudCode:        "PUB-TX",
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
			CloudCode:        "PUB-TX",
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
		CloudCode:        "PUB-TX",
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
		CloudCode:        "PUB-TX",
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
			CloudCode:        "PUB-TX",
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

// TestListResourcesResourceIDStableMergeKey（decision 47-3）：五类资源列表 item 稳定
// 返回非空 `resource_id`，与 M02 coverage item.resource_id 同键——前端据此把三态采集
// 状态 badge 按 resource_id 合并到列表行；本接口不内嵌 up/down 时序字段。
func TestListResourcesResourceIDStableMergeKey(t *testing.T) {
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
			require.Len(t, out.Data.List, 1)
			rid, ok := out.Data.List[0]["resource_id"].(string)
			require.True(t, ok, "resource_id 应为稳定字符串键")
			assert.Equal(t, tc.wantID, rid)
			assert.NotEmpty(t, rid, "resource_id 不得为空（merge key）")
			// 本接口不内嵌时序/up 状态字段：仅暴露 resource_id 供 M02 coverage 合并。
			_, hasUp := out.Data.List[0]["up"]
			_, hasHealthy := out.Data.List[0]["health"]
			assert.False(t, hasUp, "不内嵌 up 时序字段（decision 47-3）")
			assert.False(t, hasHealthy, "不内嵌 health 字段（decision 47-3）")
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
		"resource_id", "resource_category", "network_domain_id", "cloud_code", "biz_code",
		"app_code", "env", "cluster", "owner", "status", "source_type",
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

func TestListResourcesCloudCodeAndHostZoneType(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "default", Name: "默认网域", DomainType: models.DomainTypeManagement,
		ZoneType: "internet", CloudCode: "PUB-TX", TenantID: models.PlatformAdminTenantID,
		Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled,
	}).Error)
	seedHostList(t, db, "host-zone", "default", "web-zone", "10.0.0.8", "online")
	seedHostList(t, db, "host-missing-zone", "missing-domain", "web-missing", "10.0.0.9", "online")
	seedDatabaseList(t, db, "db-zone", "default", "10.0.0.10", 3306, "online")

	_, out := doResourceList(t, r, "?resource_category=host")
	require.Len(t, out.Data.List, 2)
	hosts := make(map[string]map[string]interface{}, 2)
	for _, item := range out.Data.List {
		hosts[item["resource_id"].(string)] = item
	}
	assert.Equal(t, "PUB-TX", hosts["host-zone"]["cloud_code"])
	assert.Equal(t, "internet", hosts["host-zone"]["zone_type"])
	assert.Equal(t, "", hosts["host-missing-zone"]["zone_type"])

	_, out = doResourceList(t, r, "?resource_category=database")
	require.Len(t, out.Data.List, 1)
	assert.Equal(t, "PUB-TX", out.Data.List[0]["cloud_code"])
	// 决策 103 scheme-B：zone_type 经所属网域派生，对全部资源类型统一返回（host 之外
	// 的 database/middleware/application/generic_target 同样承载所属网域的 zone_type）。
	assert.Equal(t, "internet", out.Data.List[0]["zone_type"], "database 经网域派生 zone_type")
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
	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")  // infra
	seedHostList(t, db, "host-2", "default", "web-02", "10.0.0.2", "offline") // infra
	seedHostList(t, db, "host-3", "default", "web-03", "10.0.0.3", "online")  // infra
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

// TestResourceListServiceCode 覆盖决策 105 的列表返回口径：service_code 仅在
// application / generic_target 的列表 item 上返回（其余三类不挂、不返回该键）。
func TestResourceListServiceCode(t *testing.T) {
	db := openListTestDB(t)
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "app-1", ResourceCategory: models.ResourceCategoryApplication, NetworkDomainID: "default",
		BizCode: "payment", AppName: "pay-service", Cluster: "pay", Env: "prod", Status: "online",
		ServiceName: "pay-service", ServiceCode: "order-api", Endpoint: "10.0.0.20", Port: 8080,
	}).Error)
	require.NoError(t, db.Create(&models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID: "gt-1", ResourceCategory: models.ResourceCategoryGenericTarget, NetworkDomainID: "default",
			BizCode: "infra", Env: "prod", Status: "online", AppName: strPtr("app"),
		},
		TargetName: "snmp-01", ServiceCode: "pay-api", InstanceIP: "10.0.0.30", Port: 161,
	}).Error)
	require.NoError(t, db.Create(&models.Host{
		ResourceID: "host-1", ResourceCategory: models.ResourceCategoryHost, NetworkDomainID: "default",
		BizCode: "infra", AppCode: "app", EnvFlag: "prod", Status: "online", InstanceName: "web-01",
		PrivateIP: "10.0.0.1", Image: "Linux", ServerID: "host-1",
	}).Error)
	r := mountListResources(t, db)

	cases := []struct {
		category string
		wantCode string
		wantKey  bool
	}{
		{"application", "order-api", true},
		{"generic_target", "pay-api", true},
		{"host", "", false}, // 基础设施不挂服务：契约上不返回该键
	}
	for _, tc := range cases {
		t.Run(tc.category, func(t *testing.T) {
			_, out := doResourceList(t, r, "?resource_category="+tc.category)
			require.Len(t, out.Data.List, 1)
			item := out.Data.List[0]
			if !tc.wantKey {
				_, exists := item["service_code"]
				assert.False(t, exists, "%s 列表 item 不应含 service_code 键（不挂服务）", tc.category)
				return
			}
			assert.Equal(t, tc.wantCode, item["service_code"], "%s 应返回 service_code", tc.category)
		})
	}
}

// seedHostListPlatformApp 落一条带 platform_code / app_code 的主机 fixture。
// host 的 app_code 物理列名为 app_code（host.go AppCode），与其余四类的 app_name 不同。
func seedHostListPlatformApp(t *testing.T, db *gorm.DB, id, name, ip, platform, appCode, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID: id, ServerID: id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		PlatformCode:     platform,
		AppCode:          appCode,
		SourceType:       models.SourceTypeManual,
		InstanceName:     name,
		Status:           status,
		Region:           "cn", ZoneEnv: "dev", InstanceSpec: "2c4g", Image: "linux",
		VPC: "vpc-1", SecurityGroup: "sg-1", PrivateIP: ip,
	}).Error)
}

// seedAppWithFourDims 落一条四维齐全的 application fixture（平台 / 应用 / 服务 / 业务）。
// application 的 app_code 物理列名为 app_name（resource.go AppName）。
func seedAppWithFourDims(t *testing.T, db *gorm.DB, id, service, platform, appCode, svcCode, bizCode, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Application{
		ResourceID: id, ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID: "default",
		BizCode:         bizCode,
		PlatformCode:    platform,
		AppName:         appCode,
		SourceType:      models.SourceTypeManual,
		Env:             "prod", Cluster: "c1", Status: status,
		ServiceName: service, ServiceCode: svcCode,
		Endpoint: "10.0.0.1", Port: 8080, Protocol: "http",
		HealthCheckURL: "http://10.0.0.1/health",
	}).Error)
}

// TestListResourcesPlatformAppServiceFilter 覆盖 F-18 四层模型查询侧：
// platform_code / app_code / service_code 三个新维度在各自持有的类别上按等值条件生效。
//
// 其中 app_code 的**物理列名按类别不同**（host=app_code、其余四类=app_name，决策 92
// 只统一语义未改名），这是本用例除 service_code 外第二个易踩点：若按app_code 拼列，
// host 会命中而其余四类直接 SQL 报错。
func TestListResourcesPlatformAppServiceFilter(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)

	// host 两行：同平台不同应用 / 同应用不同平台
	seedHostListPlatformApp(t, db, "host-1", "web-01", "10.0.0.1", "ecommerce", "order", "online")
	seedHostListPlatformApp(t, db, "host-2", "web-02", "10.0.0.2", "ecommerce", "payment", "online")
	seedHostListPlatformApp(t, db, "host-3", "web-03", "10.0.0.3", "retail", "order", "online")
	// application 两行：四维齐全，服务不同
	seedAppWithFourDims(t, db, "app-1", "order-svc", "ecommerce", "order", "order-api", "payment", "online")
	seedAppWithFourDims(t, db, "app-2", "pay-svc", "ecommerce", "payment", "pay-api", "infra", "online")

	// platform_code：host 上按平台收敛。
	_, out := doResourceList(t, r, "?resource_category=host&platform_code=ecommerce")
	require.Equal(t, int64(2), out.Data.Total, "ecommerce 平台下应有 2 台主机")
	_, out = doResourceList(t, r, "?resource_category=host&platform_code=retail")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-3", out.Data.List[0]["resource_id"])

	// app_code：host 走 app_code 物理列。
	_, out = doResourceList(t, r, "?resource_category=host&app_code=order")
	require.Equal(t, int64(2), out.Data.Total, "order 应用横跨 ecommerce / retail 两个平台")
	// application 走 app_name 物理列，同一参数名同样生效。
	_, out = doResourceList(t, r, "?resource_category=application&app_code=payment")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "app-2", out.Data.List[0]["resource_id"])

	// service_code：仅 application / generic_target 生效。
	_, out = doResourceList(t, r, "?resource_category=application&service_code=pay-api")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "app-2", out.Data.List[0]["resource_id"])
	_, out = doResourceList(t, r, "?resource_category=application&service_code=order-api")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "app-1", out.Data.List[0]["resource_id"])

	// 四维 + 业务 + 状态组合（分页总数与筛选一致，替代此前前端过滤的口径缺陷）。
	_, out = doResourceList(t, r,
		"?resource_category=application&platform_code=ecommerce&app_code=payment&service_code=pay-api&biz_code=infra&status=online")
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "app-2", out.Data.List[0]["resource_id"])

	// 组合无命中 → 空列表而非报错。
	_, out = doResourceList(t, r,
		"?resource_category=application&platform_code=retail&service_code=pay-api")
	require.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.List)

	// 未传三维 → 全量。
	_, out = doResourceList(t, r, "?resource_category=host")
	require.Equal(t, int64(3), out.Data.Total)
}

// TestListResourcesServiceCodeIgnoredOnNonServiceCategories 是 F-18 的**核心回归防护**：
// service_code 仅 application（resource.go）/ generic_target（generic_target.go）持有该列，
// host / database / middleware **无该列**。若 BuildListQuery 无条件拼接 service_code，
// 这三类会因引用不存在的列直接 SQL 报错（列表接口 500）。
//
// 故断言：传入 service_code 时这三类必须 200 且结果与不传时一致（条件被安全忽略）。
func TestListResourcesServiceCodeIgnoredOnNonServiceCategories(t *testing.T) {
	db := openListTestDB(t)
	r := mountListResources(t, db)

	seedHostList(t, db, "host-1", "default", "web-01", "10.0.0.1", "online")
	seedDatabaseList(t, db, "db-1", "default", "10.0.0.2", 3306, "online")
	seedMiddlewareList(t, db, "mw-1", "default", "10.0.0.3", 9092, "online")
	// 另落两条承载 service_code 的行，验证「跨类别传同一个 service_code」不影响这三类。
	seedAppWithFourDims(t, db, "app-1", "order-svc", "ecommerce", "order", "shared-svc", "infra", "online")

	for _, category := range []string{"host", "database", "middleware"} {
		t.Run(category, func(t *testing.T) {
			w, base := doResourceList(t, r, "?resource_category="+category)
			require.Equal(t, http.StatusOK, w.Code, "%s 不传service_code 应正常", category)
			require.Equal(t, int64(1), base.Data.Total)

			// 传一个真实存在于 application 的 service_code：这三类不得报错，也不得被误筛掉。
			w, out := doResourceList(t, r, "?resource_category="+category+"&service_code=shared-svc")
			require.Equal(t, http.StatusOK, w.Code,
				"%s 无 service_code 列，传该参数不得导致 SQL 报错（F-18 回归防护点）", category)
			assert.Equal(t, "success", out.Status, "%s", category)
			assert.Equal(t, int64(1), out.Data.Total,
				"%s 不持有 service_code 列，该条件应被忽略而非过滤", category)
			require.Len(t, out.Data.List, 1)
			assert.Equal(t, base.Data.List[0]["resource_id"], out.Data.List[0]["resource_id"])
		})
	}
}

// TestParseListFilterFourDimensionFields 验证 F-18 五个筛选字段的 query 参数解析。
func TestParseListFilterFourDimensionFields(t *testing.T) {
	values, err := url.Parse(
		"?network_domain_id=mc-a&keyword=web&biz_code=infra&status=online" +
			"&platform_code=ecommerce&app_code=order&service_code=order-api&is_monitored=true")
	require.NoError(t, err)
	f := ParseListFilter(values.Query())

	assert.Equal(t, "mc-a", f.NetworkDomainID)
	assert.Equal(t, "web", f.Keyword)
	assert.Equal(t, "infra", f.BizCode)
	assert.Equal(t, "online", f.Status)
	assert.Equal(t, "ecommerce", f.PlatformCode)
	assert.Equal(t, "order", f.AppCode)
	assert.Equal(t, "order-api", f.ServiceCode)
	assert.Equal(t, "true", f.IsMonitored)

	// 缺失参数 → 零值（不拼等值条件）。
	empty := ParseListFilter(url.Values{})
	assert.Empty(t, empty.PlatformCode)
	assert.Empty(t, empty.AppCode)
	assert.Empty(t, empty.ServiceCode)
	assert.Empty(t, empty.BizCode)
	assert.Empty(t, empty.Status)
}

// TestHasServiceCodeAndAppCodeColumn 锁定两个 schema 事实（列持有与列名口径），
// 任何模型/迁移变更若破坏这两个假设，用例会先于运行时 SQL 报错给出信号。
func TestHasServiceCodeAndAppCodeColumn(t *testing.T) {
	// service_code 仅两类持有。
	assert.True(t, hasServiceCode(models.ResourceCategoryApplication))
	assert.True(t, hasServiceCode(models.ResourceCategoryGenericTarget))
	assert.False(t, hasServiceCode(models.ResourceCategoryHost))
	assert.False(t, hasServiceCode(models.ResourceCategoryDatabase))
	assert.False(t, hasServiceCode(models.ResourceCategoryMiddleware))

	// app_code 语义列的物理列名按类别不同（决策 92 只统一语义、未改名）。
	assert.Equal(t, "app_code", appCodeColumn(models.ResourceCategoryHost))
	for _, category := range []models.ResourceCategory{
		models.ResourceCategoryDatabase,
		models.ResourceCategoryMiddleware,
		models.ResourceCategoryApplication,
		models.ResourceCategoryGenericTarget,
	} {
		assert.Equal(t, "app_name", appCodeColumn(category), "category=%s", category)
	}
}

// TestColumnSchemaHelpersCoverAllCategories 是**枚举完整性断言**
// （golang-reviewer LOW-1）：原 TestHasServiceCodeAndAppCodeColumn 逐个枚举值硬断言，
// 新增 ResourceCategory 时该测试不会失败——appCodeColumn 的 `default` 分支会静默把
// 未知类别落到某个列名（或空串），属最难排查的 latent bug。
// 本测试遍历 ValidResourceCategories() 权威全集，要求：
//  1. hasServiceCode 与 appCodeColumn 都不得返回「未覆盖」信号
//     （appCodeColumn 对未知类别返回 ""，权威枚举内不允许出现空串）；
//  2. 未知类别（不在权威枚举内）两个函数都不应给出有效列名/真值——
//     即降级方向必须是「不加条件」而非「猜一列」。
func TestColumnSchemaHelpersCoverAllCategories(t *testing.T) {
	for _, category := range models.ValidResourceCategories() {
		col := appCodeColumn(category)
		assert.NotEmpty(t, col,
			"appCodeColumn 未覆盖权威枚举 %q——新增 ResourceCategory 时必须同步该switch", category)
		assert.NotEqual(t, "?", col,
			"appCodeColumn(%q) 返回了占位符，疑似漏改switch", category)
	}
	// 未知类别：降级方向须为「不加条件」（appCodeColumn 返回空串、hasServiceCode 为 false），
	// 不可像原先`if host / else` 那样静默落到 app_name（golang-reviewer LOW-1 的根因）。
	unknown := models.ResourceCategory("brand_new_category_not_in_enum")
	assert.Empty(t, appCodeColumn(unknown),
		"未知类别不得猜测列名，否则新增枚举时会静默错筛且不报错")
	assert.False(t, hasServiceCode(unknown),
		"未知类别不得报告持有 service_code，否则会拼不存在的列导致 SQL 报错")
}
