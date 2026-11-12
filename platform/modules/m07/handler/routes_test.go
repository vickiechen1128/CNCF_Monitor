package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/importer"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newTestRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m07_handler.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		// M01-owned reference table: not part of the v3 M00/M07 migrations.
		`CREATE TABLE IF NOT EXISTS scrape_jobs (job_name TEXT, network_domain_id TEXT, enabled INTEGER, selected_instance_ids TEXT)`,
		// 00000 core tables already exist; only seed the rows M07 reads.
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status) VALUES ('mc-demo','演示采集域','edge','platform_admin','agent_pull','enabled')`,
		`INSERT INTO business_domains(code,name,enabled) VALUES ('payment','支付',1)`,
		`INSERT INTO application_dicts(app_code,app_name,status) VALUES ('order-service','订单服务','enabled')`,
		`INSERT INTO platform_dicts(platform_code,platform_name,enabled) VALUES ('ecommerce','电商平台',1)`,
		`INSERT INTO app_platform_rels(id,app_code,platform_code,is_primary) VALUES ('rel-1','order-service','ecommerce',1)`,
		`INSERT INTO cloud_dicts(cloud_code,cloud_name,cloud_type,carrier,enabled) VALUES ('PUB-TX','腾讯云','public','telecom',1)`,
		`INSERT INTO zone_types(code,display_name,enabled) VALUES ('internet','互联网区',1)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	resourceRepo := repository.NewGORMRepository(gormDB)
	dictionaryRepo := dictionary.NewGORMRepository(gormDB)
	dictionarySvc := dictionary.NewService(dictionaryRepo)
	resourceSvc := service.NewResourceService(resourceRepo, dictionarySvc)
	labelSvc := service.NewLabelService(repository.NewGORMLabelRepository(gormDB), resourceRepo)
	refs := references.NewGORMReader(gormDB)
	importSvc := service.NewImportService(resourceRepo, repository.NewGORMImportRepository(gormDB), dictionarySvc, dictionarySvc)

	router := gin.New()
	group := router.Group("/api/v3/platform")
	RegisterRoutes(group,
		NewResourceHandler(resourceSvc, refs),
		NewDictionaryHandler(dictionarySvc),
		NewLabelHandler(labelSvc),
		NewImportHandler(importSvc),
	)
	return router, gormDB
}

func doJSON(t *testing.T, router *gin.Engine, method, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return rec.Code, out
}

func TestV3ResourceAndLabelRoutes(t *testing.T) {
	router, gormDB := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/resources", `{
		"resource_category":"host",
		"network_domain_id":"mc-demo",
		"env":"PRD",
		"attributes":{"hostname":"web-01","instance_ip":"10.0.0.1","os_type":"linux"}
	}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	resourceID := data["resource_id"].(string)
	assert.NotEmpty(t, resourceID)
	assert.Equal(t, "host|mc-demo|10.0.0.1", data["dedup_key"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources?resource_category=host", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources/"+resourceID, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, resourceID, out["data"].(map[string]any)["resource_id"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/resources/"+resourceID, `{
		"resource_category":"host",
		"network_domain_id":"mc-demo",
		"env":"PRD",
		"status":"maintenance",
		"attributes":{"hostname":"web-01","instance_ip":"10.0.0.1","os_type":"linux"}
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "maintenance", out["data"].(map[string]any)["status"])

	// Host labels are read-only.
	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/"+resourceID+"/labels", `{"key":"team","value":"infra"}`)
	assert.Equal(t, http.StatusForbidden, code)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources", `{
		"resource_category":"application",
		"network_domain_id":"mc-demo",
		"biz_code":"payment",
		"app_code":"order-service",
		"platform_code":"ecommerce",
		"env":"PRD",
		"cluster":"prod-a",
		"attributes":{"service_name":"order-api","health_check_url":"https://order.example.com/health"}
	}`)
	require.Equal(t, http.StatusOK, code, out)
	appID := out["data"].(map[string]any)["resource_id"].(string)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/"+appID+"/labels", `{"key":"team","value":"payments"}`)
	require.Equal(t, http.StatusOK, code, out)
	labelID := out["data"].(map[string]any)["id"].(string)
	assert.NotEmpty(t, labelID)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources/"+appID+"/labels", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	require.NoError(t, gormDB.Exec(
		`INSERT INTO scrape_jobs(job_name,network_domain_id,enabled,selected_instance_ids) VALUES ('job-a','mc-demo',1,?)`,
		`["`+resourceID+`"]`,
	).Error)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources/"+resourceID+"/referenced-by", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])
}

func TestV3ImportRoute(t *testing.T) {
	router, _ := newTestRouter(t)
	data := buildImportXLSX(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "host.xlsx")
	require.NoError(t, err)
	_, err = part.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("resource_category", "host"))
	require.NoError(t, writer.WriteField("mode", "create_only"))
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/imports", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	dataMap := out["data"].(map[string]any)
	assert.EqualValues(t, 1, dataMap["total"])
	assert.EqualValues(t, 1, dataMap["success"])
	assert.Equal(t, "success", dataMap["status"])

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/imports", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])
}

func buildImportXLSX(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	require.NoError(t, f.SetSheetName(f.GetSheetName(0), "Sheet1"))
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at"},
		{"mc-demo", "web-01", "web-01", "10.0.0.9", "linux", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, ""},
	}
	for i := range rows {
		require.NoError(t, f.SetSheetRow("Sheet1", "A"+strconv.Itoa(i+1), &rows[i]))
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

func TestV3ResourceValidation(t *testing.T) {
	router, _ := newTestRouter(t)

	code, _ := doJSON(t, router, http.MethodPost, "/api/v3/platform/resources", `{
		"resource_category":"application",
		"network_domain_id":"mc-demo",
		"env":"PRD",
		"attributes":{"service_name":"order-api","health_check_url":"https://order.example.com/health"}
	}`)
	assert.Equal(t, http.StatusBadRequest, code)

	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources", "")
	assert.Equal(t, http.StatusBadRequest, code)
}

func TestV3DictionaryWriteLifecycle(t *testing.T) {
	router, gormDB := newTestRouter(t)

	// business-domains: create → duplicate conflict → restricted edit → list.
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains", `{
		"code":"logistics","name":"物流","description":"物流业务域"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	created := out["data"].(map[string]any)
	assert.Equal(t, "logistics", created["code"])
	assert.Equal(t, "物流业务域", created["description"])
	assert.Equal(t, true, created["enabled"])

	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains", `{
		"code":"logistics","name":"重复","description":""
	}`)
	assert.Equal(t, http.StatusConflict, code)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-domains/logistics", `{
		"name":"物流2","description":"改","enabled":false
	}`)
	require.Equal(t, http.StatusOK, code, out)
	updated := out["data"].(map[string]any)
	assert.Equal(t, "物流2", updated["name"])
	assert.Equal(t, "改", updated["description"])
	assert.Equal(t, false, updated["enabled"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-domains/infra", `{"enabled":false}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-domains/missing", `{"name":"x"}`)
	assert.Equal(t, http.StatusNotFound, code, out)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.GreaterOrEqual(t, out["data"].(map[string]any)["total"].(float64), float64(2))

	// application-dict: create → status edit.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/application-dict", `{
		"app_code":"inventory","app_name":"库存服务","description":"库存"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "enabled", out["data"].(map[string]any)["status"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/application-dict/inventory", `{
		"app_name":"库存服务2","status":"disabled"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "disabled", out["data"].(map[string]any)["status"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/application-dict/inventory", `{"status":"bogus"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// platform-dict: create → restricted edit.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/platform-dict", `{
		"platform_code":"warehouse","platform_name":"仓储平台","description":"仓储"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, true, out["data"].(map[string]any)["enabled"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/platform-dict/warehouse", `{
		"platform_name":"仓储平台2","enabled":false
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["enabled"])

	var count int64
	require.NoError(t, gormDB.Model(&struct{}{}).Table("business_domains").Where("code = ?", "logistics").Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestV3ImportTemplateXLSX(t *testing.T) {
	router, _ := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v3/platform/import-templates/host?format=xlsx", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Header().Get("Content-Type"), "spreadsheetml.sheet")
	assert.Contains(t, rec.Header().Get("Content-Disposition"), "host_template.xlsx")

	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	require.NoError(t, err)
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetName(0))
	require.NoError(t, err)
	require.Len(t, rows, 1)
	columns, ok := importer.ColumnsFor(domain.CategoryHost)
	require.True(t, ok)
	assert.Equal(t, columns, rows[0])
}
