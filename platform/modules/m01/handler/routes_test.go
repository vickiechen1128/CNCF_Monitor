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
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/seed"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// testAdmin is the authenticated platform administrator used by the default test
// router. The platform-admin tenant is what makes handler.requestContext derive a
// platform-admin actor, which built-in collection template writes require (FR-29).
func testAdmin() *models.User {
	return &models.User{
		ID:       "test-admin",
		Username: "admin",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleAdmin,
		Status:   models.UserStatusActive,
	}
}

// testRegularUser is an authenticated non-admin used to assert both RequireAdmin
// and the built-in template guard.
func testRegularUser() *models.User {
	return &models.User{
		ID:       "test-user",
		Username: "operator",
		TenantID: "tenant-a",
		Role:     models.UserRoleUser,
		Status:   models.UserStatusActive,
	}
}

func newTestRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	return newTestRouterAs(t, testAdmin())
}

// seedHandlerTemplates mirrors seed.DefaultTemplates: these handler tests drive
// the real module, and a standard job can only be created from an enabled
// collection template that is bound to a real exporter row (FR-21).
func seedHandlerTemplates(t *testing.T, gormDB *gorm.DB) {
	t.Helper()
	ctx := context.Background()
	exporters := repository.NewExporterTemplateRepository(gormDB)
	templates := repository.NewCollectionTemplateRepository(gormDB)

	exporterByCode := map[string]string{}
	for _, item := range seed.DefaultTemplates() {
		if item.Exporter == "" {
			continue
		}
		exporter := &domain.ExporterTemplate{
			Name:        item.Exporter,
			DefaultPort: item.DefaultPort,
			MetricsPath: "/metrics",
			Scheme:      domain.SchemeHTTP,
			OS:          "any",
			Arch:        "any",
			Source:      domain.ExporterThirdParty,
		}
		require.NoError(t, exporters.Create(ctx, exporter))
		exporterByCode[item.Code] = exporter.ID
	}

	for _, item := range seed.DefaultTemplates() {
		builtin, ok := domain.BuiltinCollectionTemplate(item.Code)
		require.True(t, ok, item.Code)
		builtin.MetricsPath = item.MetricsPath
		builtin.ScrapeInterval = item.ScrapeInterval
		builtin.ScrapeTimeout = item.ScrapeTimeout
		builtin.Enabled = true
		if exporterID, bound := exporterByCode[item.Code]; bound {
			builtin.ExporterTemplateID = exporterID
			builtin.DefaultPort = item.DefaultPort
		} else {
			// No built-in implementation: visible but unusable until an admin
			// binds an exporter (FR-21).
			builtin.Enabled = false
		}
		require.NoError(t, templates.Create(ctx, &builtin))
	}
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
	seedHandlerTemplates(t, gormDB)

	exporters := repository.NewExporterTemplateRepository(gormDB)
	templates := repository.NewCollectionTemplateRepository(gormDB)
	jobs := repository.NewJobRepository(gormDB)
	rules := repository.NewRuleRepository(gormDB)
	probes := repository.NewProbeModuleRepository(gormDB)
	installations := repository.NewInstallationRepository(gormDB)
	groups := repository.NewJobGroupRepository(gormDB)
	labelReader := references.NewLabelTemplateReader(gormDB)
	resourceReader := references.NewResourceReader(gormDB)

	exporterSvc := service.NewExporterTemplateService(exporters, templates)
	templateSvc := service.NewCollectionTemplateService(templates, exporters, labelReader)
	jobSvc := service.NewJobService(
		jobs, exporters, templateSvc, probes, installations,
		resourceReader, references.NewDomainReader(gormDB), labelReader,
	)
	jobSvc.SetSelectorValidator(resourceReader)
	jobSvc.SetJobGroupResolver(groups)
	ruleSvc := service.NewRuleService(rules, jobs, exporters, templateSvc, nil)
	metricSvc := service.NewMetricService(repository.NewMetricRepository(gormDB))
	businessSvc := service.NewBusinessMetricService(repository.NewBusinessMetricRepository(gormDB))
	probeSvc := service.NewProbeModuleService(probes, jobs)
	jobGroupSvc := service.NewJobGroupService(groups, jobSvc, resourceReader, references.NewDomainReader(gormDB))

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
		NewCollectionTemplateHandler(templateSvc, references.NewCustomFieldReader(gormDB)),
		NewJobHandler(jobSvc),
		NewRuleHandler(ruleSvc),
		NewMetricHandler(metricSvc),
		NewBusinessMetricHandler(businessSvc),
		NewProbeModuleHandler(probeSvc),
		NewJobGroupHandler(jobGroupSvc),
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
		"metrics_path":"/custom","scheme":"https",
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
		VALUES ('builtin-exp','builtin-node-exporter',TRUE)`).Error)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/exporter-templates/builtin-exp",
		`{"name":"builtin-node-exporter","scheme":"http","os":"linux","arch":"amd64","source":"official"}`)
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

// The retired "monitor type + default mapping" endpoints became one collection
// template resource (FR-21 / FR-24): the template owns the exporter binding, the
// parameters and the wizard prefill selector.
func TestCollectionTemplateCRUDAndGuards(t *testing.T) {
	router, _ := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/candidate-fields", "")
	require.Equal(t, http.StatusOK, code, out)
	fields := out["data"].(map[string]any)["list"].([]any)
	keys := make([]string, 0, len(fields))
	for _, item := range fields {
		keys = append(keys, item.(map[string]any)["key"].(string))
	}
	assert.Contains(t, keys, "os_family")
	assert.Contains(t, keys, "has_npu")

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/exporter-templates",
		`{"name":"dpu-exporter","default_port":9400,"metrics_path":"/metrics","scheme":"http"}`)
	require.Equal(t, http.StatusOK, code, out)
	dpuExporterID := out["data"].(map[string]any)["id"].(string)

	createBody := fmt.Sprintf(`{
		"code":"host_dpu","name":"DPU 主机采集","resource_category":"host",
		"exporter_template_id":%q,"default_port":9400,"metrics_path":"/metrics","scheme":"http",
		"scrape_interval":"15s","scrape_timeout":"10s",
		"default_selector":{"logic":"all","filters":[{"field":"has_gpu","operator":"eq","values":["true"]}]},
		"description":"带 DPU 的主机"
	}`, dpuExporterID)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/collection-templates", createBody)
	require.Equal(t, http.StatusOK, code, out)
	created := out["data"].(map[string]any)
	assert.Equal(t, "host_dpu", created["code"])
	assert.Equal(t, false, created["is_builtin"])
	assert.Equal(t, true, created["enabled"])
	assert.Equal(t, "dpu-exporter", created["exporter_template_name"])
	selector := created["default_selector"].(map[string]any)
	assert.Equal(t, "all", selector["logic"])
	require.Len(t, selector["filters"].([]any), 1)
	assert.Equal(t, "has_gpu", selector["filters"].([]any)[0].(map[string]any)["field"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates?keyword=dpu", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])
	assert.EqualValues(t, 20, out["data"].(map[string]any)["page_size"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates/host_dpu", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "DPU 主机采集", out["data"].(map[string]any)["name"])

	// An illegal selector field is refused before anything is stored.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/collection-templates", fmt.Sprintf(`{
		"code":"host_bad","name":"坏模板","resource_category":"host",
		"exporter_template_id":%q,
		"default_selector":{"logic":"all","filters":[{"field":"1=1 OR r.status","operator":"eq","values":["online"]}]}
	}`, dpuExporterID))
	assert.Equal(t, http.StatusBadRequest, code, out)

	// A duplicate code is a conflict.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/collection-templates", createBody)
	assert.Equal(t, http.StatusConflict, code, out)

	// A template referenced by a job cannot be deleted.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"dpu-prod","job_type":"standard","resource_category":"host",
		"template_code":"host_dpu","network_domain_id":"mc-demo","draft_status":"draft"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	jobID := out["data"].(map[string]any)["id"].(string)
	assert.Equal(t, "host_dpu", out["data"].(map[string]any)["template_code"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates/host_dpu/impact", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["reference_jobs"])

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/collection-templates/host_dpu", "")
	assert.Equal(t, http.StatusConflict, code, out)

	// Update replaces the mutable fields; the code is immutable.
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/collection-templates/host_dpu", fmt.Sprintf(`{
		"code":"host_dpu_renamed","name":"DPU 主机采集 v2","resource_category":"host",
		"exporter_template_id":%q,"default_port":9401,"metrics_path":"/metrics","scheme":"http",
		"scrape_interval":"30s","scrape_timeout":"10s","enabled":false
	}`, dpuExporterID))
	require.Equal(t, http.StatusOK, code, out)
	updatedTemplate := out["data"].(map[string]any)
	assert.Equal(t, "host_dpu", updatedTemplate["code"], "the code is immutable")
	assert.Equal(t, "DPU 主机采集 v2", updatedTemplate["name"])
	assert.Equal(t, false, updatedTemplate["enabled"])
	assert.EqualValues(t, 9401, updatedTemplate["default_port"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates/does_not_exist", "")
	assert.Equal(t, http.StatusNotFound, code, out)

	// Once the only referencing job is gone the template can be deleted.
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/scrape-jobs/"+jobID, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/collection-templates/host_dpu", "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates/host_dpu", "")
	assert.Equal(t, http.StatusNotFound, code, out)

	// Built-in templates are protected: they can be edited by an administrator but
	// never deleted (FR-21 / FR-24).
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/collection-templates/host_linux", fmt.Sprintf(`{
		"name":"Linux 主机采集（改）","resource_category":"host",
		"exporter_template_id":%q,"default_port":9100,"metrics_path":"/metrics","scheme":"http"
	}`, dpuExporterID))
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, true, out["data"].(map[string]any)["is_builtin"])
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/collection-templates/host_linux", "")
	assert.Equal(t, http.StatusForbidden, code, out)
}
