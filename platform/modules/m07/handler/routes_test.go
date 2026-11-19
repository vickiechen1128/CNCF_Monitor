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
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status) VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
		`INSERT INTO business_domains(code,name,enabled) VALUES ('payment','支付',1)`,
		`INSERT INTO application_dicts(app_code,app_name,status) VALUES ('order-service','订单服务','enabled')`,
		`INSERT INTO platform_dicts(platform_code,platform_name,enabled) VALUES ('ecommerce','电商平台',1)`,
		`INSERT INTO app_platform_rels(id,app_code,platform_code,is_primary) VALUES ('rel-1','order-service','ecommerce',1)`,
		`INSERT INTO cloud_dicts(cloud_code,cloud_name,cloud_type,carrier,description,enabled) VALUES ('PUB-TX','腾讯云','PUB','TX','预置',1)`,
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
	labelTemplateSvc := service.NewLabelTemplateService(repository.NewLabelTemplateRepository(gormDB), nil)
	attributeSvc := service.NewAttributeService(
		repository.NewAttributeDefinitionRepository(gormDB),
		repository.NewResourceAttributeRepository(gormDB),
		resourceRepo,
	)

	router := gin.New()
	group := router.Group("/api/v3/platform")
	RegisterRoutes(group,
		NewResourceHandler(resourceSvc, refs),
		NewDictionaryHandler(dictionarySvc),
		NewLabelHandler(labelSvc),
		NewImportHandler(importSvc),
		NewLabelTemplateHandler(labelTemplateSvc),
		NewAttributeHandler(attributeSvc),
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

	// M07 SRS v2.0：系统不再预置 infra，未知编码按 404 处理。
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-domains/infra", `{"enabled":false}`)
	assert.Equal(t, http.StatusNotFound, code, out)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-domains/missing", `{"name":"x"}`)
	assert.Equal(t, http.StatusNotFound, code, out)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.GreaterOrEqual(t, out["data"].(map[string]any)["total"].(float64), float64(2))

	// application-dict: create → status edit（D42：登记即须归属至少一个平台）。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/application-dict", `{
		"app_code":"inventory","app_name":"库存服务","description":"库存","platform_codes":["ecommerce"]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "enabled", out["data"].(map[string]any)["status"])

	// D42 I1：缺少 platform_codes 直接拒绝（应用不可孤立存在）。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/application-dict", `{
		"app_code":"orphan","app_name":"孤立应用"
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// 新建应用的平台归属应同时落为关联，且首个即主平台。
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/app-platform-rel?app_code=inventory", "")
	require.Equal(t, http.StatusOK, code, out)
	rels := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, rels, 1)
	assert.Equal(t, "ecommerce", rels[0].(map[string]any)["platform_code"])
	assert.Equal(t, true, rels[0].(map[string]any)["is_primary"])

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

// TestV3CloudDictReadView verifies the M07 read-only view carries the
// descriptive attributes required by the M06 admin page (D37).
func TestV3CloudDictReadView(t *testing.T) {
	router, _ := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/cloud-dict", "")
	require.Equal(t, http.StatusOK, code, out)
	list, ok := out["data"].(map[string]any)["list"].([]any)
	require.True(t, ok)
	require.Len(t, list, 1)
	item := list[0].(map[string]any)
	assert.Equal(t, "PUB-TX", item["cloud_code"])
	assert.Equal(t, "腾讯云", item["cloud_name"])
	assert.Equal(t, "PUB", item["cloud_type"])
	assert.Equal(t, "TX", item["carrier"])
	assert.Equal(t, "预置", item["description"])
	assert.Equal(t, true, item["enabled"])
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

// TestV3DictionaryLifecycleRoutes covers M07 SRS v2.0 §6.2~§6.4: zero-reference
// revoke, referenced revoke rejection, merge with reference migration and the
// audit log read view.
func TestV3DictionaryLifecycleRoutes(t *testing.T) {
	router, gormDB := newTestRouter(t)

	// 1. 零引用撤销成功率并返回 revoked。
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains/payment/revoke", "")
	require.Equal(t, http.StatusOK, code, out)
	revoked := out["data"].(map[string]any)
	assert.Equal(t, "revoked", revoked["status"])
	assert.Equal(t, false, revoked["enabled"])

	// 2. 终态重复撤销 → 409。
	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains/payment/revoke", "")
	assert.Equal(t, http.StatusConflict, code)

	// 3. 有引用撤销 → 409，错误文案包含引用数与下一步建议。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains", `{"code":"ops","name":"运维"}`)
	require.Equal(t, http.StatusOK, code, out)
	require.NoError(t, gormDB.Exec(`INSERT INTO resources(
		resource_id,resource_category,tenant_id,network_domain_id,biz_code,env,status,source_type,dedup_key
	) VALUES ('res-ops','host','platform_admin','mc-demo','ops','PRD','online','manual','host-ops')`).Error)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains/ops/revoke", "")
	assert.Equal(t, http.StatusConflict, code, out)
	assert.Contains(t, out["error"], "1")

	// 4. 合并：引用迁移 + 源条目终态 + 审计日志。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains", `{"code":"ops-v2","name":"运维V2"}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains/ops/merge", `{"target_code":"ops-v2"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, float64(1), out["data"].(map[string]any)["moved_references"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code, out)
	rows := out["data"].(map[string]any)["list"].([]any)
	var merged map[string]any
	for _, row := range rows {
		item := row.(map[string]any)
		if item["code"] == "ops" {
			merged = item
		}
	}
	require.NotNil(t, merged)
	assert.Equal(t, "merged", merged["status"])
	assert.Equal(t, "ops-v2", merged["merged_into"])
	assert.Equal(t, float64(0), merged["reference_count"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dictionary-audit-logs?dictionary_type=business&code=ops", "")
	require.Equal(t, http.StatusOK, code, out)
	logs := out["data"].(map[string]any)["list"].([]any)
	require.NotEmpty(t, logs)
	first := logs[0].(map[string]any)
	assert.Equal(t, "merge", first["action"])
	assert.Equal(t, "ops-v2", first["target_code"])
	assert.Equal(t, float64(1), first["reference_count"])

	// 5. 平台侧：应用归属也算引用，不能撤销。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/platform-dict/ecommerce/revoke", "")
	assert.Equal(t, http.StatusConflict, code, out)

	// 6. 应用侧：零资源引用可撤销（同时清理平台归属）。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/application-dict/order-service/revoke", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "revoked", out["data"].(map[string]any)["status"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dictionary-audit-logs?dictionary_type=bogus", "")
	assert.Equal(t, http.StatusBadRequest, code, out)
}

// TestV3CloudLifecycleRoutes covers the cloud extension of the dictionary
// lifecycle (migration 0018): zero-reference revoke, referenced revoke
// rejection, merge with authoritative-label migration and audit logs.
func TestV3CloudLifecycleRoutes(t *testing.T) {
	router, gormDB := newTestRouter(t)

	// Seed merge targets (M06 owns cloud creation; tests insert directly).
	require.NoError(t, gormDB.Exec(`INSERT INTO cloud_dicts(cloud_code,cloud_name,cloud_type,carrier,enabled)
		VALUES ('PUB-ALI','阿里云','PUB','ALI',1)`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,cloud_code,status)
		VALUES ('dom-a','测试域','edge','platform_admin','PUB-TX','enabled')`).Error)

	// 1. Referenced revoke → 409 with the reference count in the message.
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict/PUB-TX/revoke", "")
	assert.Equal(t, http.StatusConflict, code, out)
	assert.Contains(t, out["error"], "1")

	// 2. Merge migrates network_domains labels and returns the shared response.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict/PUB-TX/merge", `{"target_code":"PUB-ALI"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "PUB-TX", out["data"].(map[string]any)["source"])
	assert.Equal(t, "PUB-ALI", out["data"].(map[string]any)["target"])
	assert.Equal(t, float64(1), out["data"].(map[string]any)["moved_references"])

	var cloudCode string
	require.NoError(t, gormDB.Raw(`SELECT cloud_code FROM network_domains WHERE id = 'dom-a'`).
		Row().Scan(&cloudCode))
	assert.Equal(t, "PUB-ALI", cloudCode)

	// 3. Source dictionaries are terminal and expose merged_into in the list view.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/cloud-dict", "")
	require.Equal(t, http.StatusOK, code, out)
	for _, row := range out["data"].(map[string]any)["list"].([]any) {
		item := row.(map[string]any)
		if item["cloud_code"] == "PUB-TX" {
			assert.Equal(t, "merged", item["status"])
			assert.Equal(t, "PUB-ALI", item["merged_into"])
		}
	}

	// 4. Audit logs accept the dictionary_type value.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dictionary-audit-logs?dictionary_type=cloud&code=PUB-TX", "")
	require.Equal(t, http.StatusOK, code, out)
	logs := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, logs, 1)
	assert.Equal(t, "merge", logs[0].(map[string]any)["action"])

	// 5. Zero-reference dictionaries revoke successfully and become terminal.
	require.NoError(t, gormDB.Exec(`INSERT INTO cloud_dicts(cloud_code,cloud_name,cloud_type,carrier,enabled)
		VALUES ('PUB-ZERO','空闲云','PUB','ZZ',1)`).Error)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict/PUB-ZERO/revoke", "")
	require.Equal(t, http.StatusOK, code, out)
	revoked := out["data"].(map[string]any)
	assert.Equal(t, "revoked", revoked["status"])
	assert.Equal(t, false, revoked["enabled"])
	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict/PUB-ZERO/revoke", "")
	assert.Equal(t, http.StatusConflict, code)

	// 6. Self-merge is rejected as a bad request.
	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict/PUB-ALI/merge", `{"target_code":"PUB-ALI"}`)
	assert.Equal(t, http.StatusBadRequest, code)

	// 7. Unknown code → 404.
	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict/missing/revoke", "")
	assert.Equal(t, http.StatusNotFound, code)
}

// TestV3BulkReassignRoute covers M07 SRS v2.0 FR-28: enabled target required,
// all-or-nothing batch, composed resources cannot change platform directly,
// failure details are returned in data.failures, and app reassignment derives
// the platform of composed resources from the target app's primary platform.
func TestV3BulkReassignRoute(t *testing.T) {
	router, gormDB := newTestRouter(t)

	// Two static hosts pointing at business "ops".
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains", `{"code":"ops","name":"运维"}`)
	require.Equal(t, http.StatusOK, code, out)

	hostIDs := make([]string, 0, 2)
	for _, ip := range []string{"10.0.0.21", "10.0.0.22"} {
		code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources", `{
			"resource_category":"host",
			"network_domain_id":"mc-demo",
			"biz_code":"ops",
			"platform_code":"ecommerce",
			"env":"PRD",
			"attributes":{"hostname":"bulk-`+ip+`","instance_ip":"`+ip+`","os_type":"linux"}
		}`)
		require.Equal(t, http.StatusOK, code, out)
		hostIDs = append(hostIDs, out["data"].(map[string]any)["resource_id"].(string))
	}

	// 1. Happy path: both hosts move to the enabled "payment" business.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/bulk-reassign", `{
		"resource_ids":["`+hostIDs[0]+`","`+hostIDs[1]+`","`+hostIDs[0]+`"],
		"field":"biz_code",
		"target_code":"payment"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 2, out["data"].(map[string]any)["updated_count"])

	for _, id := range hostIDs {
		var biz *string
		require.NoError(t, gormDB.Raw(`SELECT biz_code FROM resources WHERE resource_id = ?`, id).Scan(&biz).Error)
		require.NotNil(t, biz)
		assert.Equal(t, "payment", *biz)
	}

	// 2. Missing resource rejects the whole batch and reports every failure.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/bulk-reassign", `{
		"resource_ids":["`+hostIDs[0]+`","missing-resource"],
		"field":"biz_code",
		"target_code":"ops"
	}`)
	require.Equal(t, http.StatusBadRequest, code, out)
	failures := out["data"].(map[string]any)["failures"].([]any)
	require.Len(t, failures, 1)
	assert.Equal(t, "missing-resource", failures[0].(map[string]any)["resource_id"])
	var biz *string
	require.NoError(t, gormDB.Raw(`SELECT biz_code FROM resources WHERE resource_id = ?`, hostIDs[0]).Scan(&biz).Error)
	require.NotNil(t, biz)
	assert.Equal(t, "payment", *biz, "整批失败不得产生部分写入")

	// 3. Disabled target is rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-domains", `{"code":"legacy","name":"旧业务"}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-domains/legacy", `{"enabled":false}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/bulk-reassign", `{
		"resource_ids":["`+hostIDs[0]+`"],
		"field":"biz_code",
		"target_code":"legacy"
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// 4. Composed resource cannot change platform_code directly.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources", `{
		"resource_category":"application",
		"network_domain_id":"mc-demo",
		"biz_code":"payment",
		"app_code":"order-service",
		"env":"PRD",
		"cluster":"prod-a",
		"attributes":{"service_name":"order-api","health_check_url":"https://order.example.com/health"}
	}`)
	require.Equal(t, http.StatusOK, code, out)
	appResourceID := out["data"].(map[string]any)["resource_id"].(string)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/bulk-reassign", `{
		"resource_ids":["`+appResourceID+`"],
		"field":"platform_code",
		"target_code":"ecommerce"
	}`)
	require.Equal(t, http.StatusBadRequest, code, out)
	failures = out["data"].(map[string]any)["failures"].([]any)
	assert.Contains(t, failures[0].(map[string]any)["reason"], "组成型资源")

	// 5. App reassignment derives composed platform from the target app.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/platform-dict", `{
		"platform_code":"warehouse","platform_name":"仓储平台"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/application-dict", `{
		"app_code":"inventory","app_name":"库存服务","platform_codes":["warehouse"]
	}`)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/bulk-reassign", `{
		"resource_ids":["`+appResourceID+`"],
		"field":"app_code",
		"target_code":"inventory"
	}`)
	require.Equal(t, http.StatusOK, code, out)

	var appCode, platformCode *string
	require.NoError(t, gormDB.Raw(`SELECT app_code, platform_code FROM resources WHERE resource_id = ?`, appResourceID).
		Row().Scan(&appCode, &platformCode))
	require.NotNil(t, appCode)
	require.NotNil(t, platformCode)
	assert.Equal(t, "inventory", *appCode)
	assert.Equal(t, "warehouse", *platformCode, "组成型资源平台须随目标应用主平台派生")

	// 6. Static host keeps its explicit platform, which is not associated with
	//    the target app → whole batch rejected with a resource-level reason.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/resources/bulk-reassign", `{
		"resource_ids":["`+hostIDs[0]+`"],
		"field":"app_code",
		"target_code":"inventory"
	}`)
	require.Equal(t, http.StatusBadRequest, code, out)
	failures = out["data"].(map[string]any)["failures"].([]any)
	assert.Contains(t, failures[0].(map[string]any)["reason"], "未关联目标应用")
}
