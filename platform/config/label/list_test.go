package label

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

// memDBCounter produces a unique in-memory DB name per test so sequential and
// parallel tests in one package never share the same backing database.
var memDBCounter int64

// openTestDB opens a per-test in-memory SQLite database with exactly the tables
// the label package touches.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:label_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.LabelTemplate{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	))
	return db
}

func newGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

// mountList mounts the LabelTemplate list handler for testing.
func mountList(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	r.GET("/api/v2/platform/label-templates", ListLabelTemplates(db))
	return r
}

// perform executes a GET request against the engine and returns the recorder.
func perform(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// listResponse mirrors the unified response envelope for the list endpoint.
type listResponse struct {
	Status string `json:"status"`
	Data   struct {
		List     []templateListItem `json:"list"`
		Total    int64              `json:"total"`
		Page     int                `json:"page"`
		PageSize int                `json:"page_size"`
	} `json:"data"`
}

// doList calls the list endpoint with the given query string ("" or starting
// with "?") and decodes the unified response.
func doList(t *testing.T, r *gin.Engine, query string) (int, listResponse) {
	t.Helper()
	w := perform(t, r, "/api/v2/platform/label-templates"+query)
	var out listResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

// seedTemplates persists the given templates directly as fixtures.
func seedTemplates(t *testing.T, db *gorm.DB, templates ...*models.LabelTemplate) {
	t.Helper()
	for _, tmpl := range templates {
		require.NoError(t, db.Create(tmpl).Error)
	}
}

// seedHost persists one host resource fixture. ServerID 有唯一索引，需与
// ResourceID 保持一致以便多条 fixture 共存。
func seedHost(t *testing.T, db *gorm.DB, resourceID string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       resourceID,
		ServerID:         resourceID,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     "host-" + resourceID,
		Status:           "online",
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
	}).Error)
}

// seedDatabase persists one database resource fixture.
func seedDatabase(t *testing.T, db *gorm.DB, resourceID string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID:       resourceID,
			ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID:  "default",
			BizCode:          "infra",
			Env:              "prod",
			Status:           "online",
			SourceType:       models.SourceTypeManual,
		},
		DatabaseType: "mysql",
		InstanceIP:   "10.0.0.1",
		Port:         3306,
		ResourceType: models.ResourceTypeDatabase,
	}).Error)
}

// hostTemplate builds a LabelTemplate fixture for the host category.
func hostTemplate(name string, isDefault bool) *models.LabelTemplate {
	return &models.LabelTemplate{
		Name:             name,
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        isDefault,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryHost),
	}
}

func TestListLabelTemplatesDefaultsAndMappings(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	seedTemplates(t, db,
		hostTemplate("default-host", true),
		hostTemplate("custom-host", false),
	)

	code, out := doList(t, r, "")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "success", out.Status)
	assert.Equal(t, int64(2), out.Data.Total)
	assert.Equal(t, 1, out.Data.Page, "page 默认 1")
	assert.Equal(t, defaultPageSize, out.Data.PageSize, "page_size 默认 50")
	require.Len(t, out.Data.List, 2)

	// 每条 item 含完整 mappings（serializer:json 解码后的完整映射）。
	for _, item := range out.Data.List {
		require.NotEmpty(t, item.Mappings, "item 必须含完整 mappings")
		for _, m := range item.Mappings {
			assert.NotEmpty(t, m.SourceField)
			assert.NotEmpty(t, m.TargetLabel)
		}
	}
}

func TestListLabelTemplatesResourceCategoryFilter(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	seedTemplates(t, db,
		hostTemplate("default-host", true),
		hostTemplate("custom-host", false),
		&models.LabelTemplate{
			Name:             "default-database",
			ResourceCategory: models.ResourceCategoryDatabase,
			IsDefault:        true,
			Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryDatabase),
		},
	)

	code, out := doList(t, r, "?resource_category=host")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(2), out.Data.Total)
	for _, item := range out.Data.List {
		assert.Equal(t, models.ResourceCategoryHost, item.ResourceCategory)
	}

	code, out = doList(t, r, "?resource_category=database")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, models.ResourceCategoryDatabase, out.Data.List[0].ResourceCategory)

	// 未匹配类型：空 list 而非 null。
	code, out = doList(t, r, "?resource_category=middleware")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.List)
}

func TestListLabelTemplatesIsDefaultFilter(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	seedTemplates(t, db,
		hostTemplate("default-host", true),
		hostTemplate("custom-host", false),
		hostTemplate("another-custom", false),
	)

	code, out := doList(t, r, "?is_default=true")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, int64(1), out.Data.Total)
	assert.True(t, out.Data.List[0].IsDefault)

	code, out = doList(t, r, "?is_default=false")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, int64(2), out.Data.Total)
	for _, item := range out.Data.List {
		assert.False(t, item.IsDefault)
	}
}

func TestListLabelTemplatesKeywordFilter(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	seedTemplates(t, db,
		hostTemplate("default-host", true),
		hostTemplate("custom-host", false),
		hostTemplate("payment-host", false),
	)

	code, out := doList(t, r, "?keyword=payment")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "payment-host", out.Data.List[0].Name)

	// keyword 无命中：空 list 而非 null。
	code, out = doList(t, r, "?keyword=nomatch")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(0), out.Data.Total)
	assert.Empty(t, out.Data.List)
}

func TestListLabelTemplatesPaginationAndPageSizeClamp(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	// 120 条自定义模板，验证分页与 page_size 上限 100。
	for i := 0; i < 120; i++ {
		seedTemplates(t, db, hostTemplate(fmt.Sprintf("tpl-%03d", i), false))
	}

	// page_size=200 被钳制到 100。
	code, out := doList(t, r, "?page=1&page_size=200")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(120), out.Data.Total)
	assert.Equal(t, 100, out.Data.PageSize, "page_size 上限 100")
	require.Len(t, out.Data.List, 100)

	// 第二页：剩余 20 条。
	code, out = doList(t, r, "?page=2&page_size=100")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.List, 20)

	// page/page_size 非法值回退默认 1/50。
	code, out = doList(t, r, "?page=abc&page_size=-1")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, defaultPageSize, out.Data.PageSize)
	require.Len(t, out.Data.List, defaultPageSize)
}

func TestListLabelTemplatesInstanceCount(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	seedTemplates(t, db,
		hostTemplate("default-host", true),
		hostTemplate("custom-host", false),
		&models.LabelTemplate{
			Name:             "default-database",
			ResourceCategory: models.ResourceCategoryDatabase,
			IsDefault:        true,
			Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryDatabase),
		},
	)
	// 2 台主机（其中 1 台软删）、1 个数据库 → host 计数=1、database 计数=1。
	seedHost(t, db, "host-1")
	seedHost(t, db, "host-2")
	seedDatabase(t, db, "db-1")
	require.NoError(t, db.Delete(&models.Host{}, "resource_id = ?", "host-2").Error)

	code, out := doList(t, r, "")
	require.Equal(t, http.StatusOK, code)
	counts := map[string]int64{}
	for _, item := range out.Data.List {
		counts[item.Name] = item.InstanceCount
	}
	assert.Equal(t, int64(1), counts["default-host"], "host 模板关联实例数应排除软删资源")
	assert.Equal(t, int64(1), counts["custom-host"])
	assert.Equal(t, int64(1), counts["default-database"])

	// 无资源类型：instance_count 为 0。
	seedTemplates(t, db, &models.LabelTemplate{
		Name:             "custom-application",
		ResourceCategory: models.ResourceCategoryApplication,
		IsDefault:        false,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryApplication),
	})
	code, out = doList(t, r, "?resource_category=application")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.List, 1)
	assert.Equal(t, int64(0), out.Data.List[0].InstanceCount)
}

func TestListLabelTemplatesSoftDeleteExcluded(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	tmpl := hostTemplate("doomed", false)
	seedTemplates(t, db, tmpl, hostTemplate("alive", false))

	// 软删一条模板。
	require.NoError(t, db.Delete(&models.LabelTemplate{}, "id = ?", tmpl.ID).Error)

	code, out := doList(t, r, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), out.Data.Total, "软删模板不进入列表")
	require.Len(t, out.Data.List, 1)
	assert.Equal(t, "alive", out.Data.List[0].Name)
}

// TestListLabelTemplatesMappingsSerialization asserts the JSON wire format of
// each item exposes the full mappings array (serializer:json round-trip).
func TestListLabelTemplatesMappingsSerialization(t *testing.T) {
	db := openTestDB(t)
	r := mountList(t, db)
	seedTemplates(t, db, hostTemplate("default-host", true))

	w := perform(t, r, "/api/v2/platform/label-templates")
	require.Equal(t, http.StatusOK, w.Code)

	var raw struct {
		Data struct {
			List []map[string]interface{} `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &raw))
	require.Len(t, raw.Data.List, 1)

	mappings, ok := raw.Data.List[0]["mappings"].([]interface{})
	require.True(t, ok, "mappings 应为 JSON 数组")
	require.NotEmpty(t, mappings)
	first := mappings[0].(map[string]interface{})
	assert.NotEmpty(t, first["source_field"])
	assert.NotEmpty(t, first["source_type"])
	assert.NotEmpty(t, first["target_label"])
	assert.Equal(t, true, first["enabled"])

	// instance_count 与各基础字段均暴露在 item 上。
	assert.Contains(t, raw.Data.List[0], "instance_count")
	assert.Contains(t, raw.Data.List[0], "name")
	assert.Contains(t, raw.Data.List[0], "resource_category")
	assert.Contains(t, raw.Data.List[0], "is_default")
}
