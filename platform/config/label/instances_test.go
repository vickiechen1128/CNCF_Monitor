package label

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// mountTemplateResources 挂载关联实例查询 handler 供测试。
func mountTemplateResources(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	r.GET("/api/v2/platform/label-templates/:template_id/resources", ListTemplateResources(db))
	return r
}

// templateResourcesResponse 镜像关联实例接口的统一响应信封。
type templateResourcesResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Items    []templateInstanceItem `json:"items"`
		Total    int64                  `json:"total"`
		Page     int                    `json:"page"`
		PageSize int                    `json:"page_size"`
	} `json:"data"`
}

// doTemplateResources 以 templateID 调用关联实例接口并解码统一响应。
func doTemplateResources(t *testing.T, r *gin.Engine, templateID uint, query string) (int, templateResourcesResponse) {
	t.Helper()
	w := perform(t, r, fmt.Sprintf("/api/v2/platform/label-templates/%d/resources%s", templateID, query))
	var out templateResourcesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

// templateFor 构造指定 resource_category 的模板 fixture。
func templateFor(name string, cat models.ResourceCategory, isDefault bool) *models.LabelTemplate {
	return &models.LabelTemplate{
		Name:             name,
		ResourceCategory: cat,
		IsDefault:        isDefault,
		Mappings:         models.DefaultMappingBuilders(cat),
	}
}

// seedHostInstance 持久化一台主机资源（展示名=InstanceName）。
func seedHostInstance(t *testing.T, db *gorm.DB, resourceID, instanceName, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       resourceID,
		ServerID:         resourceID,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     instanceName,
		Status:           status,
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
	}).Error)
}

// seedDatabaseInstance 持久化一个数据库资源（展示名=InstanceIP）。
func seedDatabaseInstance(t *testing.T, db *gorm.DB, resourceID, instanceIP, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID:       resourceID,
			ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID:  "default",
			BizCode:          "infra",
			Env:              "prod",
			Status:           status,
			SourceType:       models.SourceTypeManual,
		},
		DatabaseType: "mysql",
		InstanceIP:   instanceIP,
		Port:         3306,
		ResourceType: models.ResourceTypeDatabase,
	}).Error)
}

// seedMiddlewareInstance 持久化一个中间件资源（展示名=InstanceIP）。
func seedMiddlewareInstance(t *testing.T, db *gorm.DB, resourceID, instanceIP, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID:       resourceID,
		ResourceType:     models.ResourceTypeMiddleware,
		ResourceCategory: models.ResourceCategoryMiddleware,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		AppName:          "kafka",
		Env:              "prod",
		Cluster:          "cluster-a",
		Status:           status,
		MiddlewareType:   "kafka",
		InstanceIP:       instanceIP,
		Port:             9092,
	}).Error)
}

// seedApplicationInstance 持久化一个应用服务资源（展示名=ServiceName）。
func seedApplicationInstance(t *testing.T, db *gorm.DB, resourceID, serviceName, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Application{
		ResourceID:       resourceID,
		ResourceType:     models.ResourceTypeApplication,
		ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		AppName:          serviceName,
		Env:              "staging",
		Cluster:          "cluster-b",
		Status:           status,
		ServiceName:      serviceName,
		HealthCheckURL:   "http://10.0.0.1:8080/healthz",
		Protocol:         "http",
	}).Error)
}

// seedGenericInstance 持久化一个通用指标目标资源（展示名=TargetName）。
func seedGenericInstance(t *testing.T, db *gorm.DB, resourceID, targetName, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID:       resourceID,
			ResourceCategory: models.ResourceCategoryGenericTarget,
			NetworkDomainID:  "default",
			BizCode:          "infra",
			Env:              "prod",
			Status:           status,
			SourceType:       models.SourceTypeManual,
		},
		TargetName:   targetName,
		InstanceIP:   "10.0.0.9",
		Port:         9100,
		MetricsPath:  "/metrics",
		Scheme:       "http",
		ExporterType: "node_exporter",
		ResourceType: models.ResourceTypeGenericTarget,
	}).Error)
}

// TestListTemplateResourcesDisplayNameByCategory 覆盖五类资源的展示名口径
// （Module_07 §5 展示口径）：host=instance_name、application=service_name、
// database/middleware=instance_ip、generic_target=target_name；status 原样透传。
func TestListTemplateResourcesDisplayNameByCategory(t *testing.T) {
	db := openTestDB(t)
	r := mountTemplateResources(t, db)

	tmpls := []*models.LabelTemplate{
		templateFor("host-tpl", models.ResourceCategoryHost, false),
		templateFor("db-tpl", models.ResourceCategoryDatabase, false),
		templateFor("mw-tpl", models.ResourceCategoryMiddleware, false),
		templateFor("app-tpl", models.ResourceCategoryApplication, false),
		templateFor("gen-tpl", models.ResourceCategoryGenericTarget, false),
	}
	seedTemplates(t, db, tmpls...)
	seedHostInstance(t, db, "h-1", "host-name-1", "online")
	seedDatabaseInstance(t, db, "d-1", "10.1.1.1", "online")
	seedMiddlewareInstance(t, db, "m-1", "10.1.1.2", "offline")
	seedApplicationInstance(t, db, "a-1", "order-svc", "online")
	seedGenericInstance(t, db, "g-1", "node-exporter-01", "maintenance")

	// host：展示名 = instance_name。
	code, out := doTemplateResources(t, r, tmpls[0].ID, "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "h-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "host-name-1", out.Data.Items[0].InstanceName)
	assert.Equal(t, "online", out.Data.Items[0].Status)

	// database：展示名 = instance_ip。
	code, out = doTemplateResources(t, r, tmpls[1].ID, "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "d-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "10.1.1.1", out.Data.Items[0].InstanceName)

	// middleware：展示名 = instance_ip。
	code, out = doTemplateResources(t, r, tmpls[2].ID, "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "m-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "10.1.1.2", out.Data.Items[0].InstanceName)
	assert.Equal(t, "offline", out.Data.Items[0].Status)

	// application：展示名 = service_name。
	code, out = doTemplateResources(t, r, tmpls[3].ID, "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "a-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "order-svc", out.Data.Items[0].InstanceName)

	// generic_target：展示名 = target_name。
	code, out = doTemplateResources(t, r, tmpls[4].ID, "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "g-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "node-exporter-01", out.Data.Items[0].InstanceName)
	assert.Equal(t, "maintenance", out.Data.Items[0].Status)
}

// TestListTemplateResourcesHostExcludesSoftDeleted 覆盖：软删资源不进入关联清单，
// 模板的 resource_category 决定查询哪张表（隐式关联，§3.2）。
func TestListTemplateResourcesHostExcludesSoftDeleted(t *testing.T) {
	db := openTestDB(t)
	r := mountTemplateResources(t, db)
	tmpl := templateFor("host-tpl", models.ResourceCategoryHost, false)
	seedTemplates(t, db, tmpl)
	seedHostInstance(t, db, "h-1", "alive-01", "online")
	seedHostInstance(t, db, "h-2", "doomed-02", "offline")
	require.NoError(t, db.Delete(&models.Host{}, "resource_id = ?", "h-2").Error)

	code, out := doTemplateResources(t, r, tmpl.ID, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "h-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "alive-01", out.Data.Items[0].InstanceName)
	assert.Equal(t, "online", out.Data.Items[0].Status)
}

// TestListTemplateResourcesPaginationAndDefaults 覆盖分页：默认 page=1/page_size=10
// （Module_07 §11.1 关联实例 Table pageSize=10）、page_size 上限 100、非法参数回退。
func TestListTemplateResourcesPaginationAndDefaults(t *testing.T) {
	db := openTestDB(t)
	r := mountTemplateResources(t, db)
	tmpl := templateFor("host-tpl", models.ResourceCategoryHost, false)
	seedTemplates(t, db, tmpl)
	for i := 0; i < 25; i++ {
		seedHostInstance(t, db, fmt.Sprintf("h-%02d", i), fmt.Sprintf("host-%02d", i), "online")
	}

	// 默认 page_size=10。
	code, out := doTemplateResources(t, r, tmpl.ID, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(25), out.Data.Total)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, defaultInstancePageSize, out.Data.PageSize)
	require.Len(t, out.Data.Items, 10)

	// 第三页 page_size=10：剩余 5 条。
	code, out = doTemplateResources(t, r, tmpl.ID, "?page=3&page_size=10")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 5)

	// page_size=200 被钳制到 100。
	code, out = doTemplateResources(t, r, tmpl.ID, "?page=1&page_size=200")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, 100, out.Data.PageSize)

	// 非法 page/page_size 回退默认 1/10。
	code, out = doTemplateResources(t, r, tmpl.ID, "?page=abc&page_size=0")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, defaultInstancePageSize, out.Data.PageSize)
}

// TestListTemplateResourcesKeywordStatusFilter 覆盖 keyword / status 服务端筛选
// （PRD §11.1，K-2 闭环）：keyword 按展示名列（host=instance_name）模糊、status
// 等值匹配，可独立/组合筛选。
func TestListTemplateResourcesKeywordStatusFilter(t *testing.T) {
	db := openTestDB(t)
	r := mountTemplateResources(t, db)
	tmpl := templateFor("host-tpl", models.ResourceCategoryHost, false)
	seedTemplates(t, db, tmpl)
	seedHostInstance(t, db, "h-1", "web-online-01", "online")
	seedHostInstance(t, db, "h-2", "web-offline-02", "offline")
	seedHostInstance(t, db, "h-3", "pay-online-03", "online")

	// keyword 模糊命中展示名。
	code, out := doTemplateResources(t, r, tmpl.ID, "?keyword=pay")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "h-3", out.Data.Items[0].ResourceID)

	// status 等值筛选。
	code, out = doTemplateResources(t, r, tmpl.ID, "?status=offline")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "h-2", out.Data.Items[0].ResourceID)

	// keyword + status 组合。
	code, out = doTemplateResources(t, r, tmpl.ID, "?keyword=web&status=online")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "h-1", out.Data.Items[0].ResourceID)

	// 组合无命中 → 空。
	code, out = doTemplateResources(t, r, tmpl.ID, "?keyword=pay&status=offline")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.Items)

	// 未传筛选 → 全量 3 条。
	code, out = doTemplateResources(t, r, tmpl.ID, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(3), out.Data.Total)
}

// TestListTemplateResourcesEmptyCategory 覆盖：该类型下无资源返回空 list（items
// 序列化为 [] 而非 null）、total=0。
func TestListTemplateResourcesEmptyCategory(t *testing.T) {
	db := openTestDB(t)
	r := mountTemplateResources(t, db)
	tmpl := templateFor("app-tpl", models.ResourceCategoryApplication, false)
	seedTemplates(t, db, tmpl)

	code, out := doTemplateResources(t, r, tmpl.ID, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.Items)
	assert.NotNil(t, out.Data.Items, "空结果 items 应为 [] 而非 null")
}

// TestListTemplateResourcesTemplateNotFoundAndSoftDeleted 覆盖：模板不存在/已软删
// 返回 not_found；template_id 非法返回 bad_request。
func TestListTemplateResourcesTemplateNotFoundAndSoftDeleted(t *testing.T) {
	db := openTestDB(t)
	r := mountTemplateResources(t, db)

	// 不存在 → not_found。
	code, out := doTemplateResources(t, r, 9999, "")
	require.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)

	// 已软删模板 → not_found（db.First 自动追加 deleted_at IS NULL）。
	tmpl := templateFor("doomed", models.ResourceCategoryHost, false)
	seedTemplates(t, db, tmpl)
	require.NoError(t, db.Delete(&models.LabelTemplate{}, "id = ?", tmpl.ID).Error)
	code, out = doTemplateResources(t, r, tmpl.ID, "")
	require.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)

	// template_id 非法（非数字）→ bad_request。
	w := perform(t, r, "/api/v2/platform/label-templates/abc/resources")
	require.Equal(t, http.StatusBadRequest, w.Code)
}
