package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// testAdmin is the authenticated platform admin used by the default test router.
// TenantID stays empty on purpose: M01 service actor scoping is exercised by the
// job-group tests, while these handler tests only need admin authorization.
func testAdmin() *models.User {
	return &models.User{
		ID:       "test-admin",
		Username: "admin",
		Role:     models.UserRoleAdmin,
		Status:   models.UserStatusActive,
	}
}

// testRegularUser is an authenticated non-admin used to assert RequireAdmin.
func testRegularUser() *models.User {
	return &models.User{
		ID:       "test-user",
		Username: "operator",
		Role:     models.UserRoleUser,
		Status:   models.UserStatusActive,
	}
}

func newTestRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	return newTestRouterAs(t, testAdmin())
}

// newTestRouterAs builds the M01 router with a stubbed authenticated user.
// Passing nil simulates an unauthenticated context so admin-gated routes 403.
func newTestRouterAs(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m01_handler.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
		`INSERT INTO network_domain_access(domain_id,token_hash,registration_status)
			VALUES ('mc-demo','hash','monitored')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	exporters := repository.NewExporterTemplateRepository(gormDB)
	mappings := repository.NewMappingRepository(gormDB)
	jobs := repository.NewJobRepository(gormDB)
	rules := repository.NewRuleRepository(gormDB)
	probes := repository.NewProbeModuleRepository(gormDB)
	installations := repository.NewInstallationRepository(gormDB)
	labelReader := references.NewLabelTemplateReader(gormDB)
	exporterSvc := service.NewExporterTemplateService(exporters, mappings)
	mappingSvc := service.NewMappingService(mappings, exporters, jobs, labelReader)
	jobSvc := service.NewJobService(
		jobs, exporters, mappings, probes, installations,
		references.NewResourceReader(gormDB), references.NewDomainReader(gormDB), labelReader,
	)
	jobSvc.SetJobGroupResolver(repository.NewJobGroupRepository(gormDB))
	ruleSvc := service.NewRuleService(rules, jobs, exporters, nil)
	metricSvc := service.NewMetricService(repository.NewMetricRepository(gormDB))
	businessSvc := service.NewBusinessMetricService(repository.NewBusinessMetricRepository(gormDB))
	probeSvc := service.NewProbeModuleService(probes, jobs)
	jobGroupSvc := service.NewJobGroupService(
		repository.NewJobGroupRepository(gormDB), jobSvc,
		references.NewResourceReader(gormDB), references.NewDomainReader(gormDB),
	)
	monitorTypeSvc := service.NewMonitorTypeService(repository.NewMonitorTypeRepository(gormDB))
	require.NoError(t, monitorTypeSvc.Refresh(context.Background()))

	router := gin.New()
	group := router.Group("/api/v3/platform")
	if user != nil {
		group.Use(func(c *gin.Context) {
			c.Set(auth.ContextUserKey, user)
			c.Next()
		})
	}
	RegisterRoutes(group,
		NewExporterTemplateHandler(exporterSvc),
		NewMappingHandler(mappingSvc),
		NewJobHandler(jobSvc),
		NewRuleHandler(ruleSvc),
		NewMetricHandler(metricSvc),
		NewBusinessMetricHandler(businessSvc),
		NewProbeModuleHandler(probeSvc),
		NewJobGroupHandler(jobGroupSvc),
		NewMonitorTypeHandler(monitorTypeSvc),
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
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return rec.Code, out
}

func TestExporterTemplateCRUDAndValidation(t *testing.T) {
	router, gormDB := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates", `{
		"name":"custom-exporter",
		"version":"1.0.0",
		"default_port":9191,
		"metrics_path":"/metrics",
		"scheme":"http",
		"supported_monitor_types":["host_linux"],
		"os":"linux",
		"arch":"amd64",
		"source":"third_party"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	id := data["id"].(string)
	assert.NotEmpty(t, id)
	assert.Equal(t, false, data["is_builtin"])
	assert.Equal(t, float64(9191), data["default_port"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/exporter-templates?keyword=custom", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])
	assert.EqualValues(t, 1, listData["page"])
	assert.EqualValues(t, 20, listData["page_size"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/exporter-templates/"+id, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, id, out["data"].(map[string]any)["id"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/exporter-templates/"+id, `{
		"name":"custom-exporter","version":"2.0.0","default_port":9292,
		"metrics_path":"/custom","scheme":"https","supported_monitor_types":["host_linux"],
		"os":"linux","arch":"amd64","source":"third_party"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "2.0.0", out["data"].(map[string]any)["version"])
	assert.Equal(t, float64(9292), out["data"].(map[string]any)["default_port"])

	// Duplicate name is a contract-level conflict.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"custom-exporter"}`)
	assert.Equal(t, http.StatusConflict, code, out)
	assert.Equal(t, "conflict", out["errorType"])

	// Invalid metrics path and unknown fields are rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"bad-path","metrics_path":"metrics"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"unknown-field","unexpected":true}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Built-in rows are read-only.
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_exporter_templates(id,name,is_builtin)
		VALUES ('builtin-exp','node-exporter',TRUE)`).Error)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/exporter-templates/builtin-exp",
		`{"name":"node-exporter","scheme":"http","os":"linux","arch":"amd64","source":"official"}`)
	assert.Equal(t, http.StatusForbidden, code, out)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/exporter-templates/builtin-exp", "")
	assert.Equal(t, http.StatusForbidden, code, out)

	// User rows can be deleted; repeat delete is 404.
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/exporter-templates/"+id, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, id, out["data"].(map[string]any)["id"])
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/exporter-templates/"+id, "")
	assert.Equal(t, http.StatusNotFound, code, out)
}

func TestMappingCRUDAndGuards(t *testing.T) {
	router, gormDB := newTestRouter(t)

	// Two exporters: one supports host_linux only, one supports mysql.
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"node-exporter","supported_monitor_types":["host_linux"]}`)
	require.Equal(t, http.StatusOK, code, out)
	nodeID := out["data"].(map[string]any)["id"].(string)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"mysqld-exporter","supported_monitor_types":["mysql"]}`)
	require.Equal(t, http.StatusOK, code, out)
	mysqlID := out["data"].(map[string]any)["id"].(string)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"node-exporter-2","supported_monitor_types":["host_linux"]}`)
	require.Equal(t, http.StatusOK, code, out)
	node2ID := out["data"].(map[string]any)["id"].(string)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/ci-exporter-mappings", fmt.Sprintf(`{
		"monitor_type":"host_linux","exporter_template_id":%q,"is_default":true,
		"default_port":9100,"metrics_path":"/metrics","scheme":"http",
		"scrape_interval":"15s","scrape_timeout":"10s"
	}`, nodeID))
	require.Equal(t, http.StatusOK, code, out)
	mapping := out["data"].(map[string]any)
	mappingID := mapping["id"].(string)
	assert.Equal(t, "node-exporter", mapping["exporter_template_name"])
	assert.Equal(t, true, mapping["is_default"])

	// Second default for the same monitor type is rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/ci-exporter-mappings", fmt.Sprintf(`{
		"monitor_type":"host_linux","exporter_template_id":%q,"is_default":true
	}`, node2ID))
	assert.Equal(t, http.StatusConflict, code, out)

	// Exporter that does not support the monitor type is rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/ci-exporter-mappings", fmt.Sprintf(`{
		"monitor_type":"redis","exporter_template_id":%q
	}`, nodeID))
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Invalid duration literal (bare number) is rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/ci-exporter-mappings", fmt.Sprintf(`{
		"monitor_type":"mysql","exporter_template_id":%q,"scrape_interval":"180"
	}`, mysqlID))
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Label template has a dedicated endpoint and must belong to the mapping's
	// resource category.
	require.NoError(t, gormDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-host','host-default','host')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-db','db-default','database')`).Error)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/ci-exporter-mappings/"+mappingID+"/label-template",
		`{"label_template_id":"lt-db"}`)
	assert.Equal(t, http.StatusBadRequest, code, out, "category mismatch must be rejected")

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/ci-exporter-mappings/"+mappingID+"/label-template",
		`{"label_template_id":"lt-host"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "lt-host", out["data"].(map[string]any)["label_template_id"])
	assert.Equal(t, "host-default", out["data"].(map[string]any)["label_template_name"])

	// Default mappings cannot be deleted.
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/ci-exporter-mappings/"+mappingID, "")
	assert.Equal(t, http.StatusConflict, code, out)

	// Clear the default flag, then deletion is allowed.
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/ci-exporter-mappings/"+mappingID, fmt.Sprintf(`{
		"monitor_type":"host_linux","exporter_template_id":%q,"is_default":false,
		"default_port":9100,"metrics_path":"/metrics","scheme":"http",
		"scrape_interval":"15s","scrape_timeout":"10s"
	}`, nodeID))
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "lt-host", out["data"].(map[string]any)["label_template_id"], "update must preserve the label template")

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/ci-exporter-mappings/"+mappingID, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/ci-exporter-mappings/"+mappingID, fmt.Sprintf(`{
		"monitor_type":"host_linux","exporter_template_id":%q
	}`, nodeID))
	assert.Equal(t, http.StatusNotFound, code, out)

	// A mapping referenced by a job cannot be deleted.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/ci-exporter-mappings", fmt.Sprintf(`{
		"monitor_type":"mysql","exporter_template_id":%q
	}`, mysqlID))
	require.Equal(t, http.StatusOK, code, out)
	referencedID := out["data"].(map[string]any)["id"].(string)
	require.NoError(t, gormDB.Exec(fmt.Sprintf(`INSERT INTO m01_scrape_jobs(
		id,job_name,resource_category,network_domain_id,monitor_type,exporter_template_id
	) VALUES ('job-1','mysql-prod','database','mc-demo','mysql',%q)`, mysqlID)).Error)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/ci-exporter-mappings/"+referencedID, "")
	assert.Equal(t, http.StatusConflict, code, out)

	// Built-in mappings are protected.
	require.NoError(t, gormDB.Exec(fmt.Sprintf(`INSERT INTO m01_ci_type_exporter_mappings(
		id,monitor_type,exporter_template_id,is_default,is_builtin
	) VALUES ('builtin-map','redis',%q,FALSE,TRUE)`, mysqlID)).Error)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/ci-exporter-mappings/builtin-map", "")
	assert.Equal(t, http.StatusForbidden, code, out)
}
