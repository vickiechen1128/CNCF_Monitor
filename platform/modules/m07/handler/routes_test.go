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
		`CREATE TABLE tenants (id TEXT PRIMARY KEY)`,
		`CREATE TABLE network_domains (id TEXT PRIMARY KEY, deleted_at TIMESTAMP)`,
		`CREATE TABLE business_domains (code TEXT PRIMARY KEY, name TEXT, enabled INTEGER)`,
		`CREATE TABLE application_dicts (app_code TEXT PRIMARY KEY, app_name TEXT, status TEXT)`,
		`CREATE TABLE platform_dicts (platform_code TEXT PRIMARY KEY, platform_name TEXT, enabled INTEGER)`,
		`CREATE TABLE cloud_dicts (cloud_code TEXT PRIMARY KEY, cloud_name TEXT, enabled INTEGER)`,
		`CREATE TABLE zone_types (code TEXT PRIMARY KEY, display_name TEXT, enabled INTEGER)`,
		`CREATE TABLE scrape_jobs (job_name TEXT, network_domain_id TEXT, enabled INTEGER, selected_instance_ids TEXT)`,
		`INSERT INTO tenants(id) VALUES ('platform_admin')`,
		`INSERT INTO network_domains(id) VALUES ('default')`,
		`INSERT INTO business_domains(code,name,enabled) VALUES ('payment','支付',1)`,
		`INSERT INTO application_dicts(app_code,app_name,status) VALUES ('order-service','订单服务','enabled')`,
		`INSERT INTO platform_dicts(platform_code,platform_name,enabled) VALUES ('ecommerce','电商平台',1)`,
		`INSERT INTO app_platform_rels(id,app_code,platform_code,is_primary) VALUES ('rel-1','order-service','ecommerce',1)`,
		`INSERT INTO cloud_dicts(cloud_code,cloud_name,enabled) VALUES ('PUB-TX','腾讯云',1)`,
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
		"network_domain_id":"default",
		"env":"PRD",
		"attributes":{"hostname":"web-01","instance_ip":"10.0.0.1","os_type":"linux"}
	}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	resourceID := data["resource_id"].(string)
	assert.NotEmpty(t, resourceID)
	assert.Equal(t, "host|default|10.0.0.1", data["dedup_key"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources?resource_category=host", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources/"+resourceID, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, resourceID, out["data"].(map[string]any)["resource_id"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/resources/"+resourceID, `{
		"resource_category":"host",
		"network_domain_id":"default",
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
		"network_domain_id":"default",
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
		`INSERT INTO scrape_jobs(job_name,network_domain_id,enabled,selected_instance_ids) VALUES ('job-a','default',1,?)`,
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
		{"default", "web-01", "web-01", "10.0.0.9", "linux", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, ""},
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
		"network_domain_id":"default",
		"env":"PRD",
		"attributes":{"service_name":"order-api","health_check_url":"https://order.example.com/health"}
	}`)
	assert.Equal(t, http.StatusBadRequest, code)

	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources", "")
	assert.Equal(t, http.StatusBadRequest, code)
}
