package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/admin/networkdomain"
	"github.com/metriccenter/metriccenter/platform/alertmanager"
	"github.com/metriccenter/metriccenter/platform/config/label"
	"github.com/metriccenter/metriccenter/platform/config/resource"
	"github.com/metriccenter/metriccenter/platform/configcenter"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/query"
	"github.com/metriccenter/metriccenter/platform/strategy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// businessDomainsTestPath 指向仓库内真实业务分组字典（相对本测试包目录，
// go test 以包目录为 cwd 运行）。
const businessDomainsTestPath = "../../config/business_domains.yaml"

// integrationTestDBCounter 为每个集成测试生成唯一的内存 DB 名，避免不同测试
// 共享同一内存库造成数据串扰（与 platform/config/resource 包内测试同约定）。
var integrationTestDBCounter int64

func buildIntegrationEngine(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	n := atomic.AddInt64(&integrationTestDBCounter, 1)
	dsn := fmt.Sprintf("file:metric_center_int_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		// 共享基础模型（M06）
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ZoneType{},
		&models.ResourceStatusMapping{},
		// 业务分组字典（决策 48）
		&models.BusinessDomain{},
		// 用户认证（Module_06 §5.3，tu-01；seed.Run 会写入初始管理员 admin）
		&models.User{},
		// 五类资源（M07）
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.ResourceLabel{},
		// 标签模板与导入（M07）
		&models.LabelTemplate{},
		&models.LabelTemplateSnapshot{},
		&models.ImportRecord{},
		&models.ExporterTemplate{},
		&models.CITypeExporterMapping{},
		// M06 扩展
		&models.EdgeAgent{},
		// 策略域模型（seed.Run 会写入内置技术指标库 + Module_01 strategy 路由）
		&models.ExporterMetricLibrary{},
		&models.ScrapeJob{},
		&models.MonitoringRule{},
		&models.ExporterInstallationConfirmation{},
		// 配置中心（Module_09）
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
		// 告警收敛（Module_08）：alertmanager.yml 挂载留痕
		&models.AlertmanagerConfigVersion{},
	))
	require.NoError(t, seed.Run(db))

	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	// review-fix B：M08/M09 管理写端点挂 auth.RequireAdmin() 后才要求在 gin context
	// 存在已认证管理员（ContextUserKey）。本集成测试未挂真实 AuthMiddleware（由 seed
	// 预置 admin 账号），故注入等价中间件把种子管理员解析进 context，放行最小授权。
	// 注意：资源标签「静态资源 403」等业务断言在处理器内完成、与用户身份无关，注入
	// 管理员不影响这些既有断言（seed.Run 之后 AdminUsername 恒存在）。
	injectSeededAdmin(db, platform)
	networkdomain.RegisterRoutes(platform, db)

	// M07 收口（T07-18）：业务分组字典（DB-backed，决策 48）+ 资源 + 标签模板。
	// 先按决策 48 seed 业务字典（yaml 首次导入 + infra 兜底），再构造 DB store。
	require.NoError(t, seed.BusinessDomains(db, businessDomainsTestPath))
	bizStore := resource.NewBusinessDomainStore(db)
	resource.RegisterRoutes(platform, db, bizStore)
	label.RegisterRoutes(platform, db)

	// Module 01 收口（T01-09）：监控策略全部路由。
	strategy.RegisterRoutes(platform, db)

	// Module 09 收口（T09-07）：网域监控纳管 + 配置草稿 + 配置下发与历史。
	configcenter.RegisterRoutes(platform, db)

	// Module 08 收口（T08-05）：告警收敛——alertmanager.yml 挂载/留痕 + 静默代理，
	// 指向测试内启动的 fake Alertmanager（见 fakeAlertmanager）。
	amURL := fakeAlertmanager(t).URL
	require.NoError(t, alertmanager.RegisterRoutes(platform, db, amURL))

	// M02 采集状态路由收口（决策 47 / T02-03）：与生产 main.go（registerPlatformConfigRoutes
	// 上方的 apiV1 组）保持一致，M02 目标/覆盖端点挂在 /api/v1 组下（仅全局认证、不授权），
	// 而非本引擎既有的 /api/v2/platform 组。fakePromUpstream 提供按路径分发的伪 Prometheus
	// 上游（/api/v1/query + /api/v1/targets），夹具与 platform/query/coverage_test.go 的
	// coverageUp/targetsFixture 对齐，便于集成层直接断言三态与过滤。该路由与 /api/v2/platform/*
	// 无路径冲突；本引擎不挂 SPA 静态兜底（NoRoute 即 404），故 /api/v1 端点 200 即证明已真实挂载、
	// 未被兜底吞掉。
	promUp := fakePromUpstream(t)
	promURL, err := url.Parse(promUp.URL)
	require.NoError(t, err)
	apiV1 := r.Group("/api/v1")
	query.RegisterRoutes(apiV1, db, promURL)

	return r, db
}

// injectSeededAdmin 以测试中间件把 seed 预置的初始管理员（seed.AdminUsername）解析
// 进 gin context 的 ContextUserKey，模拟真实 AuthMiddleware 的最小解析语义，使挂接
// auth.RequireAdmin() 的管理写端点在集成测试中放行。seed.Run() 已保证管理员恒存在；
// 查询失败时兜底构造同名管理员对象，避免测试依赖具体 DB 行。
func injectSeededAdmin(db *gorm.DB, g *gin.RouterGroup) {
	var admin models.User
	if err := db.Where("username = ?", seed.AdminUsername).First(&admin).Error; err != nil {
		admin = models.User{
			Username: seed.AdminUsername,
			Role:     models.UserRoleAdmin,
			Status:   models.UserStatusActive,
		}
	}
	g.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, &admin)
		c.Next()
	})
}

// apiClient 封装对测试路由器的 HTTP 调用与统一响应信封解析。
type apiClient struct {
	t *testing.T
	r *gin.Engine
}

// json 发送 JSON 请求（body 为空串时不带 body）。
func (c *apiClient) json(method, path, body string) (int, map[string]interface{}) {
	c.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "http://mc.local"+path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	c.r.ServeHTTP(w, req)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

// multipart 发送 multipart/form-data 请求（Excel 导入等文件上传场景）。
func (c *apiClient) multipart(path string, fields map[string]string, fileField, fileName string, fileBytes []byte) (int, map[string]interface{}) {
	c.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		require.NoError(c.t, mw.WriteField(k, v))
	}
	if fileField != "" {
		fw, err := mw.CreateFormFile(fileField, fileName)
		require.NoError(c.t, err)
		_, err = fw.Write(fileBytes)
		require.NoError(c.t, err)
	}
	require.NoError(c.t, mw.Close())
	req := httptest.NewRequest(http.MethodPost, "http://mc.local"+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	c.r.ServeHTTP(w, req)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

// mustJSON 将任意值序列化为 JSON 字符串（失败即 Fail）。
func mustJSON(t *testing.T, v interface{}) string {
	t.Helper()
	raw, err := json.Marshal(v)
	require.NoError(t, err)
	return string(raw)
}

// buildXLSX 按资源类型模板列头生成 xlsx 字节（合法列头 + 数据行）。
func buildXLSX(t *testing.T, category models.ResourceCategory, rows [][]string) []byte {
	t.Helper()
	cols := resource.TemplateColumns[category]
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	for i, col := range cols {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		require.NoError(t, err)
		require.NoError(t, f.SetCellValue(sheet, cell, col))
	}
	for r, row := range rows {
		for c, val := range row {
			cell, err := excelize.CoordinatesToCellName(c+1, r+2)
			require.NoError(t, err)
			require.NoError(t, f.SetCellValue(sheet, cell, val))
		}
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

// resourcePayload 构造某类型资源的创建/更新完整请求体（五类共享字段 + 差异化字段）。
func resourcePayload(category string, overrides map[string]interface{}) map[string]interface{} {
	base := map[string]interface{}{
		"resource_category": category,
		"network_domain_id": "default",
		"biz_code":          "authorized-ops",
		"app_name":          "app",
		"cluster":           "cluster-1",
		"owner":             "ops",
		"env":               "prod",
		"status":            "online",
	}
	switch category {
	case "host":
		base["instance_name"] = "web-01"
		base["instance_ip"] = "10.0.0.1"
		base["os_type"] = "Linux"
	case "database":
		base["database_type"] = "mysql"
		base["instance_ip"] = "10.0.0.10"
		base["port"] = 3306
		base["version"] = "8.0"
	case "middleware":
		base["middleware_type"] = "kafka"
		base["instance_ip"] = "10.0.0.11"
		base["port"] = 9092
		base["version"] = "3.4"
	case "application":
		base["service_name"] = "pay-service"
		base["health_check_url"] = "http://10.0.0.20:8080/health"
		base["protocol"] = "http"
		base["endpoint"] = "10.0.0.20:8080"
		base["port"] = 8080
	case "generic_target":
		base["target_name"] = "snmp-switch-01"
		base["instance_ip"] = "10.0.0.30"
		base["port"] = 161
		base["metrics_path"] = "/metrics"
		base["scheme"] = "http"
		base["exporter_type"] = "snmp_exporter"
	}
	for k, v := range overrides {
		base[k] = v
	}
	return base
}

func TestEndToEndDomainRegistry(t *testing.T) {
	r, _ := buildIntegrationEngine(t)

	exec := func(method, path, body string) (int, map[string]interface{}) {
		t.Helper()
		httpReq := httptest.NewRequest(method, "http://mc.local"+path, strings.NewReader(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httpReq)
		var out map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}

	// 0. seeded default domain present
	{
		code, out := exec("GET", "/api/v2/platform/network-domains", "")
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		found := false
		for _, it := range data["list"].([]interface{}) {
			if it.(map[string]interface{})["id"] == models.DefaultDomainID {
				found = true
			}
		}
		assert.True(t, found, "default domain should be seeded")
	}

	// 1. zone-types returns enabled dictionary (non-paginated array)
	{
		code, out := exec("GET", "/api/v2/platform/zone-types", "")
		require.Equal(t, http.StatusOK, code)
		arr, ok := out["data"].([]interface{})
		require.True(t, ok, "zone-types data should be an array")
		assert.Len(t, arr, 2, "acceptance baseline enables only 政务外网区/互联网区")
		for _, it := range arr {
			m := it.(map[string]interface{})
			assert.True(t, m["code"] == "extranet" || m["code"] == "internet", "unexpected enabled zone type: %v", m["code"])
		}
	}

	// 2. register an edge domain
	id := ""
	{
		code, out := exec("POST", "/api/v2/platform/network-domains",
			`{"name":"政务网A区","domain_type":"edge","zone_type":"internet","domain_code":"zhw-a"}`)
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		id = data["id"].(string)
		assert.Equal(t, "mc-zhw-a", id)
		assert.Equal(t, models.PlatformAdminTenantID, data["tenant_id"])
	}

	// 3. list by status includes the new domain
	{
		code, out := exec("GET", "/api/v2/platform/network-domains?status=enabled&tenant_id="+models.PlatformAdminTenantID, "")
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		assert.NotZero(t, data["total"].(float64))
	}

	// 4. detail
	{
		code, out := exec("GET", "/api/v2/platform/network-domains/"+id, "")
		require.Equal(t, http.StatusOK, code)
		assert.Equal(t, id, out["data"].(map[string]interface{})["id"])
	}

	// 5. edit editable fields; tenant_id immutable
	{
		code, out := exec("PUT", "/api/v2/platform/network-domains/"+id,
			`{"name":"政务网A区(改)","zone_type":"extranet"}`)
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		assert.Equal(t, "政务网A区(改)", data["name"])
		assert.Equal(t, models.PlatformAdminTenantID, data["tenant_id"])
	}

	// 6. disable empty domain returns flat impact scope
	{
		code, out := exec("PATCH", "/api/v2/platform/network-domains/"+id+"/status", `{"status":"disabled"}`)
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		assert.Equal(t, float64(0), data["resource_count"])
		assert.Equal(t, float64(0), data["managed_edge_agent_count"])
	}

	// 6b. default management domain cannot be disabled/deleted
	{
		code, _ := exec("PATCH", "/api/v2/platform/network-domains/"+models.DefaultDomainID+"/status", `{"status":"disabled"}`)
		assert.Equal(t, 409, code)
		code2, _ := exec("DELETE", "/api/v2/platform/network-domains/"+models.DefaultDomainID, "")
		assert.Equal(t, 409, code2)
	}

	// 7. re-enable then delete the (now enabled, empty) domain
	{
		code, _ := exec("PATCH", "/api/v2/platform/network-domains/"+id+"/status", `{"status":"enabled"}`)
		require.Equal(t, http.StatusOK, code)
		code2, _ := exec("DELETE", "/api/v2/platform/network-domains/"+id, "")
		require.Equal(t, http.StatusOK, code2)
		code3, _ := exec("DELETE", "/api/v2/platform/network-domains/"+id, "")
		assert.Equal(t, 404, code3)
	}
}

// ---------------------------------------------------------------------------
// M07（T07-18）端到端集成验收：
// 五类资源 CRUD / Excel 导入 / 资源标签 / 标签模板 / 业务分组字典（只读）。
// ---------------------------------------------------------------------------

// integrationUUIDRe 校验服务端生成的 resource_id 为 uuid v4 格式（PRD §5.2）。
var integrationUUIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// listItems 从统一响应中提取 data.list。
func listItems(out map[string]interface{}) []interface{} {
	return out["data"].(map[string]interface{})["list"].([]interface{})
}

// TestEndToEndResourceCRUD 覆盖五类资源经 HTTP 的完整 CRUD 闭环（验收要点 1）：
// 创建（uuid/默认字段）→ 列表 → 更新（resource_category 不可改）→ 删除 → 列表收敛。
func TestEndToEndResourceCRUD(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 每类资源的差异化更新字段（owner 对 host 不落库，改用各类展示字段校验）。
	updateField := map[string]string{
		"host":           "instance_name",
		"database":       "version",
		"middleware":     "version",
		"application":    "service_name",
		"generic_target": "target_name",
	}
	updateValue := map[string]string{
		"host":           "web-01-updated",
		"database":       "8.0.1",
		"middleware":     "3.5",
		"application":    "pay-service-v2",
		"generic_target": "snmp-switch-02",
	}

	for _, cat := range []string{"host", "database", "middleware", "application", "generic_target"} {
		t.Run(cat, func(t *testing.T) {
			// 1. create：uuid resource_id + 创建契约字段。
			code, out := c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload(cat, nil)))
			require.Equal(t, http.StatusOK, code, "创建 %s 应成功：%v", cat, out)
			data := out["data"].(map[string]interface{})
			id, _ := data["resource_id"].(string)
			require.Regexp(t, integrationUUIDRe, id, "resource_id 应为服务端生成 uuid v4")
			assert.Equal(t, "manual", data["source_type"])
			assert.Equal(t, cat, data["resource_category"])
			assert.Equal(t, "default", data["network_domain_id"])
			assert.Equal(t, "authorized-ops", data["biz_code"])

			// 2. list：包含新创建资源。
			code, out = c.json("GET", "/api/v2/platform/resources?resource_category="+cat, "")
			require.Equal(t, http.StatusOK, code)
			ldata := out["data"].(map[string]interface{})
			assert.Equal(t, float64(1), ldata["total"], "%s 列表应命中 1 条", cat)
			assert.Equal(t, id, listItems(out)[0].(map[string]interface{})["resource_id"])

			// 3. update：差异化字段变更生效（PUT 需携带完整合法 payload）。
			code, out = c.json("PUT", "/api/v2/platform/resources/"+id,
				mustJSON(t, resourcePayload(cat, map[string]interface{}{updateField[cat]: updateValue[cat]})))
			require.Equal(t, http.StatusOK, code, "更新 %s 应成功：%v", cat, out)
			assert.Equal(t, updateValue[cat], out["data"].(map[string]interface{})[updateField[cat]])

			// 4. resource_category 创建后不可改 → 400。
			other := "host"
			if cat == "host" {
				other = "database"
			}
			code, _ = c.json("PUT", "/api/v2/platform/resources/"+id, mustJSON(t, resourcePayload(other, nil)))
			assert.Equal(t, http.StatusBadRequest, code, "%s 变更 resource_category 应被拒", cat)

			// 5. delete：返回 {resource_id}，列表收敛为 0。
			code, out = c.json("DELETE", "/api/v2/platform/resources/"+id, "")
			require.Equal(t, http.StatusOK, code)
			assert.Equal(t, id, out["data"].(map[string]interface{})["resource_id"])
			code, out = c.json("GET", "/api/v2/platform/resources?resource_category="+cat, "")
			require.Equal(t, http.StatusOK, code)
			assert.Equal(t, float64(0), out["data"].(map[string]interface{})["total"], "%s 软删后列表应为空", cat)

			// 6. 二次删除 → 404。
			code, _ = c.json("DELETE", "/api/v2/platform/resources/"+id, "")
			assert.Equal(t, http.StatusNotFound, code)
		})
	}

	// 非法分类列表 / 缺必填创建 → 400。
	code, _ := c.json("GET", "/api/v2/platform/resources?resource_category=bogus", "")
	assert.Equal(t, http.StatusBadRequest, code)
	code, _ = c.json("POST", "/api/v2/platform/resources",
		mustJSON(t, resourcePayload("host", map[string]interface{}{"instance_ip": ""})))
	assert.Equal(t, http.StatusBadRequest, code, "缺 instance_ip 应 400")
}

// TestEndToEndSmoke 覆盖 T07-18 端到端冒烟（dev-feedback L-7 / L-5 / K-1 / K-2）：
// 经真实路由注册的 handler 串联验证——
//   - L-5：Host legacy 字段映射归一化闭环（请求 legacy 展示字段 → 落库 legacy 列 →
//     列表回读归一化，instance_ip/os_type/env/app_name/cluster）；
//   - K-1：资源列表 biz_code / status 服务端筛选（PRD §11.1）；
//   - K-2：标签模板关联实例 keyword / status 服务端筛选（PRD §11.1 / §3.2）。
func TestEndToEndSmoke(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 1. L-5：创建 3 台 host（infra/online、infra/offline、payment/online），
	//    请求体使用 legacy 展示字段，列表应归一化回读。
	hosts := []map[string]interface{}{
		{"instance_name": "web-online-01", "instance_ip": "10.0.1.1", "env": "prod", "app_name": "pay-web", "cluster": "pay-cluster"},
		{"instance_name": "web-offline-02", "instance_ip": "10.0.1.2", "env": "staging", "app_name": "pay-web", "cluster": "pay-cluster", "status": "offline"},
		{"instance_name": "db-online-03", "instance_ip": "10.0.1.3", "env": "prod", "app_name": "pay-db", "cluster": "db-cluster", "biz_code": "data-innovation-lab"},
	}
	for _, ov := range hosts {
		code, out := c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload("host", ov)))
		require.Equal(t, http.StatusOK, code, "创建 host 应成功：%v", out)
	}

	code, out := c.json("GET", "/api/v2/platform/resources?resource_category=host", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(3), out["data"].(map[string]interface{})["total"])

	byIP := map[string]map[string]interface{}{}
	for _, it := range listItems(out) {
		m := it.(map[string]interface{})
		byIP[m["instance_ip"].(string)] = m
	}
	web := byIP["10.0.1.1"]
	require.NotNil(t, web, "列表应包含 instance_ip=10.0.1.1 的 host")
	assert.Equal(t, "web-online-01", web["instance_name"])
	assert.Equal(t, "web-online-01", web["hostname"], "hostname 应归一化读回 instance_name")
	assert.Equal(t, "Linux", web["os_type"], "os_type 应归一化读回 image 列（legacy）")
	assert.Equal(t, "prod", web["env"], "env 应归一化读回 env_flag 列（legacy）")
	assert.Equal(t, "pay-web", web["app_name"], "app_name 应归一化读回 app_code 列（legacy）")
	assert.Equal(t, "pay-cluster", web["cluster"], "cluster 应归一化读回 sub_app_code 列（legacy）")

	// 2. K-1：biz_code / status 服务端筛选（PRD §11.1）。
	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host&biz_code=authorized-ops", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["data"].(map[string]interface{})["total"], "biz_code=authorized-ops 应命中 2 台")

	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host&status=offline", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "status=offline 应命中 1 台")

	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host&biz_code=authorized-ops&status=online", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "biz_code=authorized-ops&status=online 组合应命中 1 台")

	// 3. K-2：标签模板关联实例 keyword / status 服务端筛选。
	//    创建 2 个 application 资源（svc-online / svc-offline），默认 application 模板应命中。
	for _, ov := range []map[string]interface{}{
		{"service_name": "svc-online", "endpoint": "10.0.2.1:8081"},
		{"service_name": "svc-offline", "endpoint": "10.0.2.2:8082", "status": "offline"},
	} {
		code, out := c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload("application", ov)))
		require.Equal(t, http.StatusOK, code, "创建 application 应成功：%v", out)
	}
	code, out = c.json("GET", "/api/v2/platform/label-templates", "")
	require.Equal(t, http.StatusOK, code)
	var defaultAppID float64
	for _, it := range listItems(out) {
		m := it.(map[string]interface{})
		if m["name"] == "default-application" {
			defaultAppID = m["id"].(float64)
		}
	}
	require.NotZero(t, defaultAppID, "应存在 default-application 种子模板")

	base := fmt.Sprintf("/api/v2/platform/label-templates/%.0f/resources", defaultAppID)
	code, out = c.json("GET", base, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["data"].(map[string]interface{})["total"], "默认模板应关联 2 个实例")

	code, out = c.json("GET", base+"?keyword=svc-offline", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "keyword 筛选应命中 1 条")

	code, out = c.json("GET", base+"?status=online", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "status=online 应命中 1 条")
}

// TestEndToEndExcelImport 覆盖 Excel 模板下载与导入全链路（验收要点 2）：
// 中文状态映射、create_only/upsert、判重、导入记录列表与详情。
func TestEndToEndExcelImport(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 0. 模板下载路由：合法类型返回 xlsx，未知类型 404。
	{
		req := httptest.NewRequest(http.MethodGet, "http://mc.local/api/v2/platform/resources/host/template", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		require.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Header().Get("Content-Type"), "spreadsheetml")
		assert.Contains(t, w.Header().Get("Content-Disposition"), "host_template.xlsx")
		assert.NotEmpty(t, w.Body.Bytes())

		req = httptest.NewRequest(http.MethodGet, "http://mc.local/api/v2/platform/resources/bogus/template", nil)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		require.Equal(t, http.StatusNotFound, w.Code)
	}

	hostRows := func(ip, name, status string) [][]string {
		return [][]string{{"default", name, name, ip, "Linux", "authorized-ops", "", "prod", "", "ops", status}}
	}

	// 1. create_only 导入：中文状态「运行中」映射为 online，新建 source_type=import。
	code, out := c.multipart("/api/v2/platform/resources/host/import",
		map[string]string{"resource_category": "host", "mode": "create_only"},
		"file", "data.xlsx", buildXLSX(t, models.ResourceCategoryHost, hostRows("10.9.0.1", "imp-web-01", "运行中")))
	require.Equal(t, http.StatusOK, code, "create_only 导入应成功：%v", out)
	data := out["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["total"])
	assert.Equal(t, float64(1), data["success"])
	assert.Equal(t, float64(0), data["failed"])
	_, hasUpdated := data["updated"]
	assert.False(t, hasUpdated, "create_only 不应返回 updated 字段（§5.16.3）")

	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host", "")
	require.Equal(t, http.StatusOK, code)
	host := listItems(out)[0].(map[string]interface{})
	assert.Equal(t, "online", host["status"], "中文状态「运行中」应映射为 online")
	assert.Equal(t, "import", host["source_type"])
	assert.Equal(t, "imp-web-01", host["instance_name"])

	// 2. create_only 命中判重键 → 失败计入 partial。
	code, out = c.multipart("/api/v2/platform/resources/host/import",
		map[string]string{"resource_category": "host", "mode": "create_only"},
		"file", "data.xlsx", buildXLSX(t, models.ResourceCategoryHost, hostRows("10.9.0.1", "imp-web-01", "运行中")))
	require.Equal(t, http.StatusOK, code)
	data = out["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["failed"])
	errs := data["errors"].([]interface{})
	require.Len(t, errs, 1)
	assert.Equal(t, "dedup_key", errs[0].(map[string]interface{})["field"])

	// 3. upsert 命中判重键 → updated++，中文状态「已停止」→ offline。
	code, out = c.multipart("/api/v2/platform/resources/host/import",
		map[string]string{"resource_category": "host", "mode": "upsert"},
		"file", "data.xlsx", buildXLSX(t, models.ResourceCategoryHost, hostRows("10.9.0.1", "imp-web-01-renamed", "已停止")))
	require.Equal(t, http.StatusOK, code)
	data = out["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["updated"])
	assert.Equal(t, float64(0), data["success"])
	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host", "")
	host = listItems(out)[0].(map[string]interface{})
	assert.Equal(t, "offline", host["status"], "中文状态「已停止」应映射为 offline")
	assert.Equal(t, "imp-web-01-renamed", host["instance_name"])

	// 4. 非法 biz_code 行 → failed + errors 明细，导入记录 partial。
	code, out = c.multipart("/api/v2/platform/resources/host/import",
		map[string]string{"resource_category": "host", "mode": "create_only"},
		"file", "data.xlsx", buildXLSX(t, models.ResourceCategoryHost,
			[][]string{{"default", "bad-01", "bad-01", "10.9.0.99", "Linux", "no-such-biz", "", "prod", "", "ops", "运行中"}}))
	require.Equal(t, http.StatusOK, code)
	data = out["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["failed"])
	errs = data["errors"].([]interface{})
	require.Len(t, errs, 1)
	assert.Equal(t, "biz_code", errs[0].(map[string]interface{})["field"])

	// 5. 导入记录：列表（host 共 4 条）+ 详情含 errors 明细。
	code, out = c.json("GET", "/api/v2/platform/imports?resource_category=host", "")
	require.Equal(t, http.StatusOK, code)
	idata := out["data"].(map[string]interface{})
	assert.Equal(t, float64(4), idata["total"], "4 次 host 导入应各落一条记录")
	recs := idata["list"].([]interface{})
	var maxID float64
	for _, it := range recs {
		if id := it.(map[string]interface{})["id"].(float64); id > maxID {
			maxID = id
		}
	}
	code, out = c.json("GET", "/api/v2/platform/imports/"+fmt.Sprintf("%.0f", maxID), "")
	require.Equal(t, http.StatusOK, code)
	detail := out["data"].(map[string]interface{})
	assert.Equal(t, "partial", detail["status"])
	detailErrs := detail["errors"].([]interface{})
	require.Len(t, detailErrs, 1)
	assert.Equal(t, "biz_code", detailErrs[0].(map[string]interface{})["field"])
	assert.Equal(t, "no-such-biz", detailErrs[0].(map[string]interface{})["value"])
}

// TestEndToEndResourceLabels 覆盖资源标签读写（验收要点 3）：
// application 可写、静态资源 403、system/内置 label 拦截、重复 key conflict。
func TestEndToEndResourceLabels(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	code, out := c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload("application", nil)))
	require.Equal(t, http.StatusOK, code)
	appID := out["data"].(map[string]interface{})["resource_id"].(string)

	// 1. 读标签：system 标签（默认模板实时计算，不落库）已在 items 中。
	code, out = c.json("GET", "/api/v2/platform/resources/"+appID+"/labels", "")
	require.Equal(t, http.StatusOK, code)
	items := out["data"].(map[string]interface{})["items"].([]interface{})
	keys := make([]string, 0, len(items))
	for _, it := range items {
		keys = append(keys, it.(map[string]interface{})["key"].(string))
	}
	for _, want := range []string{"app", "env", "cluster", "biz", "service_name", "health_check_url"} {
		assert.Contains(t, keys, want, "application 默认模板应生成 system 标签 %s", want)
	}

	// 2. application 可写 user 标签。
	code, out = c.json("POST", "/api/v2/platform/resources/"+appID+"/labels", `{"key":"team","value":"core"}`)
	require.Equal(t, http.StatusOK, code)
	label := out["data"].(map[string]interface{})
	assert.Equal(t, "team", label["key"])
	assert.Equal(t, "user", label["source"])
	labelID := fmt.Sprintf("%.0f", label["id"].(float64))

	// 3. 重复 key → 409。
	code, _ = c.json("POST", "/api/v2/platform/resources/"+appID+"/labels", `{"key":"team","value":"dup"}`)
	assert.Equal(t, http.StatusConflict, code)

	// 4. Prometheus 内置 label → 400；system 标签 key → 400；非法 key → 400。
	code, _ = c.json("POST", "/api/v2/platform/resources/"+appID+"/labels", `{"key":"instance","value":"x"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	code, _ = c.json("POST", "/api/v2/platform/resources/"+appID+"/labels", `{"key":"app","value":"x"}`)
	assert.Equal(t, http.StatusBadRequest, code, "user 不可覆盖 system 标签")
	code, _ = c.json("POST", "/api/v2/platform/resources/"+appID+"/labels", `{"key":"UPPER","value":"x"}`)
	assert.Equal(t, http.StatusBadRequest, code)

	// 5. 编辑 / 删除 user 标签。
	code, out = c.json("PUT", "/api/v2/platform/resources/"+appID+"/labels/"+labelID, `{"value":"core-v2"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "core-v2", out["data"].(map[string]interface{})["value"])
	code, out = c.json("DELETE", "/api/v2/platform/resources/"+appID+"/labels/"+labelID, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, labelID, out["data"].(map[string]interface{})["label_id"])

	// 6. 静态资源（host）写标签 → 403，含 PUT/DELETE。
	code, out = c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload("host", nil)))
	require.Equal(t, http.StatusOK, code)
	hostID := out["data"].(map[string]interface{})["resource_id"].(string)
	code, _ = c.json("POST", "/api/v2/platform/resources/"+hostID+"/labels", `{"key":"team","value":"x"}`)
	assert.Equal(t, http.StatusForbidden, code)
	code, _ = c.json("PUT", "/api/v2/platform/resources/"+hostID+"/labels/1", `{"value":"x"}`)
	assert.Equal(t, http.StatusForbidden, code)
	code, _ = c.json("DELETE", "/api/v2/platform/resources/"+hostID+"/labels/1", "")
	assert.Equal(t, http.StatusForbidden, code)

	// 7. 资源不存在 → 404。
	code, _ = c.json("POST", "/api/v2/platform/resources/no-such-id/labels", `{"key":"team","value":"x"}`)
	assert.Equal(t, http.StatusNotFound, code)
}

// TestEndToEndLabelTemplates 覆盖标签模板全链路（验收要点 4）：
// 列表（种子默认模板）→ 创建/重名冲突 → 更新（category 不可改）→ 克隆 →
// mappings（保护 label 拦截 / composite 例外 / 默认模板只读）→ 关联实例。
func TestEndToEndLabelTemplates(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 1. 列表：种子默认模板 5 个（每类一个）。
	code, out := c.json("GET", "/api/v2/platform/label-templates", "")
	require.Equal(t, http.StatusOK, code)
	ldata := out["data"].(map[string]interface{})
	assert.Equal(t, float64(5), ldata["total"])
	var defaultAppID float64
	for _, it := range listItems(out) {
		m := it.(map[string]interface{})
		if m["name"] == "default-application" {
			defaultAppID = m["id"].(float64)
		}
	}
	require.NotZero(t, defaultAppID, "应存在 default-application 种子模板")

	// 2. 创建自定义模板（含一条 mapping）。
	code, out = c.json("POST", "/api/v2/platform/label-templates", mustJSON(t, map[string]interface{}{
		"name":              "app-custom",
		"resource_category": "application",
		"mappings": []map[string]interface{}{
			{"source_type": "resource_field", "source_field": "owner", "target_label": "owner", "enabled": true},
		},
	}))
	require.Equal(t, http.StatusOK, code)
	tmpl := out["data"].(map[string]interface{})
	customID := tmpl["id"].(float64)
	assert.Equal(t, false, tmpl["is_default"], "创建模板恒非默认")

	// 3. 同名同类型 → 409。
	code, _ = c.json("POST", "/api/v2/platform/label-templates",
		mustJSON(t, map[string]interface{}{"name": "app-custom", "resource_category": "application"}))
	assert.Equal(t, http.StatusConflict, code)

	// 4. 更新名称；resource_category 创建后不可改 → 400。
	code, out = c.json("PUT", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", customID), `{"name":"app-custom-v2"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "app-custom-v2", out["data"].(map[string]interface{})["name"])
	code, _ = c.json("PUT", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", customID), `{"resource_category":"host"}`)
	assert.Equal(t, http.StatusBadRequest, code)

	// 5. 克隆默认模板：新名派生、is_default=false、mappings 全量复制（application 默认 7 条，含 resource_id）。
	code, out = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", defaultAppID)+"/clone", "")
	require.Equal(t, http.StatusOK, code)
	clone := out["data"].(map[string]interface{})
	cloneID := clone["id"].(float64)
	assert.Equal(t, "default-application 副本", clone["name"])
	assert.Equal(t, false, clone["is_default"])
	assert.Len(t, clone["mappings"].([]interface{}), 7)

	// 6. 默认模板禁止删除 → 400。
	code, _ = c.json("DELETE", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", defaultAppID), "")
	assert.Equal(t, http.StatusBadRequest, code)

	// 7. mappings：克隆模板可写。resource_field 目标 instance → 400（保护 label）；
	// composite→instance 例外 → 200；owner → 200。
	code, _ = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings",
		mustJSON(t, map[string]interface{}{"source_type": "resource_field", "source_field": "instance", "target_label": "instance"}))
	assert.Equal(t, http.StatusBadRequest, code, "非 composite 目标 instance 应被拦截")

	code, out = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings",
		mustJSON(t, map[string]interface{}{"source_type": "composite", "source_field": "instance_ip:port"}))
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].([]interface{}), 8, "新增 composite→instance 映射")

	code, out = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings",
		mustJSON(t, map[string]interface{}{"source_type": "resource_field", "source_field": "owner", "target_label": "owner"}))
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].([]interface{}), 9)

	// 8. 更新 / 删除 mapping。
	code, out = c.json("PUT", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings/8", `{"source_field":"instance_ip:port"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].([]interface{}), 9)
	code, out = c.json("DELETE", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings/9", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(9), out["data"].(map[string]interface{})["mapping_id"])

	// 9. 默认模板 mappings 只读 → 400。
	code, _ = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", defaultAppID)+"/mappings",
		mustJSON(t, map[string]interface{}{"source_type": "resource_field", "source_field": "owner", "target_label": "owner"}))
	assert.Equal(t, http.StatusBadRequest, code)

	// 10. 关联实例：创建 2 个 application 资源，默认 application 模板应关联命中。
	for _, ov := range []map[string]interface{}{
		{"service_name": "svc-1", "endpoint": "10.0.0.21:8081"},
		{"service_name": "svc-2", "endpoint": "10.0.0.22:8082"},
	} {
		code, _ = c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload("application", ov)))
		require.Equal(t, http.StatusOK, code)
	}
	code, out = c.json("GET", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", defaultAppID)+"/resources", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["data"].(map[string]interface{})["total"])

	// 11. 删除自定义模板；未命中 → 404。
	code, out = c.json("DELETE", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", customID), "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, customID, out["data"].(map[string]interface{})["template_id"])
	code, _ = c.json("DELETE", "/api/v2/platform/label-templates/99999", "")
	assert.Equal(t, http.StatusNotFound, code)
}

// TestEndToEndBusinessDomains 覆盖业务分组字典（决策 48）端到端：seed 预置 +
// GET 只读 + POST 登记 + PUT 受限编辑 + infra 禁停用 + 无 DELETE。
func TestEndToEndBusinessDomains(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 1. GET：seed 预置 infra 兜底 + yaml 两条。
	code, out := c.json("GET", "/api/v2/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code)
	bdata := out["data"].(map[string]interface{})
	assert.Equal(t, float64(3), bdata["total"], "seed 字典含 infra + authorized-ops + data-innovation-lab")
	codes := make([]string, 0, 3)
	for _, it := range listItems(out) {
		codes = append(codes, it.(map[string]interface{})["code"].(string))
	}
	assert.Contains(t, codes, "infra")
	assert.Contains(t, codes, "authorized-ops")
	assert.Contains(t, codes, "data-innovation-lab")

	// 2. POST 登记：成功 → 200，默认 enabled=true。
	code, out = c.json("POST", "/api/v2/platform/business-domains", `{"code":"risk-control","name":"风控业务","description":"风控业务域"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "success", out["status"])
	created := out["data"].(map[string]interface{})
	assert.Equal(t, "risk-control", created["code"])
	assert.Equal(t, "风控业务", created["name"])
	assert.Equal(t, true, created["enabled"], "登记默认启用")

	// 3. POST 编码不规范 → bad_request。
	code, out = c.json("POST", "/api/v2/platform/business-domains", `{"code":"Bad_Ops","name":"非法编码"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 4. POST 重复 code → bad_request。
	code, out = c.json("POST", "/api/v2/platform/business-domains", `{"code":"risk-control","name":"重名"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 5. PUT 受限编辑：改名 + 停用 risk-control → 200。
	code, out = c.json("PUT", "/api/v2/platform/business-domains/risk-control", `{"name":"风控业务(新)","enabled":false}`)
	require.Equal(t, http.StatusOK, code)
	updated := out["data"].(map[string]interface{})
	assert.Equal(t, "风控业务(新)", updated["name"])
	assert.Equal(t, false, updated["enabled"])
	assert.Equal(t, "risk-control", updated["code"], "code 不受请求体影响，保持不可改")

	// 6. 停用后不再出现在启用列表，但 GET 全量仍可见。
	code, out = c.json("GET", "/api/v2/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(4), out["data"].(map[string]interface{})["total"], "停用不删除，全量列表仍含 risk-control")

	// 7. PUT infra 停用 → bad_request（决策 48 红线）。
	code, out = c.json("PUT", "/api/v2/platform/business-domains/infra", `{"enabled":false}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 8. PUT 不存在条目 → not_found。
	code, _ = c.json("PUT", "/api/v2/platform/business-domains/not-exist", `{"name":"X"}`)
	assert.Equal(t, http.StatusNotFound, code)

	// 9. 无 DELETE 入口（停用不删除）→ 404。
	code, _ = c.json("DELETE", "/api/v2/platform/business-domains/infra", "")
	assert.Equal(t, http.StatusNotFound, code)
}

// ---------------------------------------------------------------------------
// Module_09（T09-07）配置中心端到端集成冒烟：
// 主链路走通——已纳管 default(local) 网域 → 生成草稿 → 校验通过 → 确认
// （生成 ConfigVersion + 触发 local 下发记录）→ deployments 可见 → ScrapeJob.change_status 回写。
// ---------------------------------------------------------------------------

// TestEndToEndConfigCenterSmoke 覆盖 T09-07 全链路集成冒烟（决策 31-M2 / PRD §9.2）：
// 复用 seed 生成的 default(local,已纳管) 网域，经真实路由串联验证 config-center 主链路。
// promtool 在本环境不可调用，草稿校验态由测试直接落库为 passed（等价 revalidate 通过）。
func TestEndToEndConfigCenterSmoke(t *testing.T) {
	r, dbm := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}
	domainID := models.DefaultDomainID

	// 0. 种子一条待下发 ScrapeJob（change_status=pending），供回写断言。
	job := &models.ScrapeJob{
		JobName:               "mc9-smoke-job",
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       domainID,
		InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusPending,
		Enabled:               true,
	}
	require.NoError(t, dbm.Create(job).Error)

	// 1. 生成草稿（POST /config/drafts）。
	code, out := c.json("POST", "/api/v2/platform/config/drafts", mustJSON(t, map[string]interface{}{"network_domain_id": domainID}))
	require.Equal(t, http.StatusOK, code, "生成草稿应成功：%v", out)
	draft := out["data"].(map[string]interface{})
	changeNo, _ := draft["change_no"].(string)
	require.NotEmpty(t, changeNo, "草稿应生成 change_no")
	assert.Equal(t, string(models.DraftStatusPending), draft["status"])

	// 2. 校验通过：测试环境无 promtool，直接落库 validation_status=passed（等价 revalidate）。
	require.NoError(t, dbm.Model(&models.ConfigDraft{}).
		Where("change_no = ?", changeNo).Update("validation_status", string(models.ValidationStatusPassed)).Error)

	// 3. 详情（GET /config-drafts/{change_no}）。
	code, out = c.json("GET", "/api/v2/platform/config-drafts/"+changeNo, "")
	require.Equal(t, http.StatusOK, code, "草稿详情应可读：%v", out)
	assert.Equal(t, changeNo, out["data"].(map[string]interface{})["change_no"])

	// 4. 确认（POST /config-drafts/{change_no}/confirm）→ 触发 local 下发。
	code, out = c.json("POST", "/api/v2/platform/config-drafts/"+changeNo+"/confirm", `{"confirmed_by":"admin"}`)
	require.Equal(t, http.StatusOK, code, "确认应成功：%v", out)
	version := out["data"].(map[string]interface{})
	require.NotEmpty(t, version["id"], "确认应生成 ConfigVersion")
	assert.Equal(t, changeNo, version["change_no"])

	// 5. 下发记录列表（GET /deployments）应含本次 confirm 触发的 local 成功记录。
	code, out = c.json("GET", "/api/v2/platform/deployments?network_domain_id="+domainID, "")
	require.Equal(t, http.StatusOK, code)
	deps := out["data"].(map[string]interface{})["items"].([]interface{})
	require.NotEmpty(t, deps, "应存在下发记录")
	dep := deps[0].(map[string]interface{})
	assert.Equal(t, string(models.ChannelTypeLocal), dep["channel"])
	assert.Equal(t, string(models.DeploymentStatusSuccess), dep["status"])
	assert.Equal(t, changeNo, dep["source_change_no"])

	// 6. change_status 回写（决策 31-M2）：pending → deployed。
	require.NoError(t, dbm.First(job, job.ID).Error)
	assert.Equal(t, models.ChangeStatusDeployed, job.ChangeStatus, "confirm 成功下发后 ScrapeJob.change_status 应回写 deployed")

	// 7. 配置版本列表可见（GET /config-versions）。
	code, out = c.json("GET", "/api/v2/platform/config-versions?network_domain_id="+domainID, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "应存在 1 个配置版本")
}

// TestBuildReloadFunc 覆盖 HIGH-1 装配的 reload 回调（review-fix）：
//   - 未配置 reload 地址必须如实报错，拒绝“伪成功”静默 success；
//   - 2xx 返回 nil，非 2xx / 非法 scheme 返回错误。
func TestBuildReloadFunc(t *testing.T) {
	// 未配置 reload 地址 → 报错（不静默 success）。
	noURL := buildReloadFunc("")
	require.Error(t, noURL(), "未配置 reload 地址应报错而非静默成功")

	// 正常 2xx reload → nil。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	ok := buildReloadFunc(srv.URL)
	require.NoError(t, ok())

	// 非 2xx → error。
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer bad.Close()
	require.Error(t, buildReloadFunc(bad.URL)())

	// 非法 scheme → error。
	require.Error(t, buildReloadFunc("ftp://x/-/reload")())
}

// ---------------------------------------------------------------------------
// Module_08（T08-05）端到端集成冒烟：
// 经真实路由注册的 /api/v2/platform/alertmanager/* 串联验证——
// alertmanager.yml 挂载/当前生效/版本列表（config）+ 静默列表/创建/删除（代理）。
// ---------------------------------------------------------------------------

// fakeAMState 持有一个 fake Alertmanager 的内存静默集合（契约 §4 运行时语义）。
type fakeAMState struct {
	mu       sync.Mutex
	silences map[string]map[string]interface{}
	seq      int
}

func newFakeAMState() *fakeAMState {
	return &fakeAMState{silences: map[string]map[string]interface{}{}}
}

// fakeAlertmanager 启动一个内存 Alertmanager 静默服务，返回其 httptest.Server。
// 覆盖 M08 silence 代理依赖的原生端点：GET/POST /api/v2/silences、GET/DELETE /api/v2/silence/:id。
func fakeAlertmanager(t *testing.T) *httptest.Server {
	t.Helper()
	st := newFakeAMState()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/v2/silences", func(w http.ResponseWriter, _ *http.Request) {
		st.mu.Lock()
		defer st.mu.Unlock()
		data := make([]map[string]interface{}, 0, len(st.silences))
		for _, s := range st.silences {
			data = append(data, s)
		}
		// v2 列表为裸数组。
		writeAMJSON(w, data)
	})

	mux.HandleFunc("POST /api/v2/silences", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		st.mu.Lock()
		defer st.mu.Unlock()
		st.seq++
		id := fmt.Sprintf("am-silence-%d", st.seq)
		st.silences[id] = map[string]interface{}{
			"id":        id,
			"matchers":  body["matchers"],
			"startsAt":  body["startsAt"],
			"endsAt":    body["endsAt"],
			"createdBy": body["createdBy"],
			"comment":   body["comment"],
			"status":    gin.H{"state": "active"},
		}
		// v2 创建直接返回 {"silenceID":"..."}。
		writeAMJSON(w, gin.H{"silenceID": id})
	})

	mux.HandleFunc("GET /api/v2/silence/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/v2/silence/")
		st.mu.Lock()
		s, ok := st.silences[id]
		st.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			writeAMJSON(w, gin.H{"status": "error", "errorType": "not_found"})
			return
		}
		// v2 单条为裸对象。
		writeAMJSON(w, s)
	})

	mux.HandleFunc("DELETE /api/v2/silence/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/v2/silence/")
		st.mu.Lock()
		if _, ok := st.silences[id]; ok {
			delete(st.silences, id)
		}
		st.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func writeAMJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// TestEndToEndAlertmanagerSmoke 覆盖 T08-05 端到端冒烟：经真实路由注册串联验证
// Module_08 告警收敛主链路——
//   - 当前生效 / 版本列表（DB 只读端点，不依赖 amtool）初始为空；
//   - 挂载 alertmanager.yml：amtool 在本环境不可调用，按决策 60 校验失败不落库、
//     bad_request 且 data 带行级错误 items（印证路由已注册 + 校验短路 + 不落库）；
//   - 直写一条 applied 留痕后当前生效可读回（config 挂载管道与 amtool 解耦，
//     DB 是唯一事实源）；
//   - 静默列表 / 创建 / 删除：经 fake Alertmanager 代理串通（决策 56 授权收敛放行）。
func TestEndToEndAlertmanagerSmoke(t *testing.T) {
	r, dbm := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 1. config：当前生效为空（未挂载）→ 200。
	code, out := c.json("GET", "/api/v2/platform/alertmanager/config/current", "")
	require.Equal(t, http.StatusOK, code, "current 应可读：%v", out)
	assert.Equal(t, "", out["data"].(map[string]interface{})["content"])

	// 2. config：版本列表为空 → 200 total 0。
	code, out = c.json("GET", "/api/v2/platform/alertmanager/config/versions", "")
	require.Equal(t, http.StatusOK, code, "versions 应可读：%v", out)
	assert.Equal(t, float64(0), out["data"].(map[string]interface{})["total"])

	// 3. 挂载合法 alertmanager.yml：amtool 不可调用 → 校验失败不落库（决策 60），
	//    返回 bad_request 且 data.items 带行级错误（印证路由 + 校验短路 + 不落库）；
	//    amtool 若恰好可用（CI 注入）则版本成功留痕，两种分支均接受。
	code, out = c.json("POST", "/api/v2/platform/alertmanager/config",
		`{"content":"route:\n  receiver: default\nreceivers:\n  - name: default\n","uploaded_by":"admin"}`)
	if code == http.StatusOK {
		assert.NotEmpty(t, out["data"].(map[string]interface{})["id"], "amtool 可用时应留痕返回版本")
	} else {
		require.Equal(t, http.StatusBadRequest, code, "amtool 不可用应按决策 60 返回 bad_request：%v", out)
		assert.Equal(t, "bad_request", out["errorType"])
		items, ok := out["data"].(map[string]interface{})["items"].([]interface{})
		require.True(t, ok, "校验失败应带行级错误 items")
		require.NotEmpty(t, items)
	}

	// 4. 直写一条 applied 留痕（绕过 amtool 的一次确定性挂载），当前生效可读回。
	amContent := "route:\n  receiver: default\nreceivers:\n  - name: default\n"
	cfg := &models.AlertmanagerConfigVersion{
		Content:   amContent,
		Checksum:  models.AlertmanagerConfigChecksum(amContent),
		Status:    models.AlertmanagerConfigStatusApplied,
		AppliedBy: "admin",
	}
	require.NoError(t, dbm.Create(cfg).Error)
	code, out = c.json("GET", "/api/v2/platform/alertmanager/config/current", "")
	require.Equal(t, http.StatusOK, code)
	assert.Contains(t, out["data"].(map[string]interface{})["content"].(string), "route:", "当前生效应读回留痕内容")

	// 5. silence：列表空 → 200 total 0。
	code, out = c.json("GET", "/api/v2/platform/alertmanager/silences", "")
	require.Equal(t, http.StatusOK, code, "silences 列表应可读：%v", out)
	assert.Equal(t, float64(0), out["data"].(map[string]interface{})["total"])

	// 6. silence：创建（未来时间窗 → active）→ 200 返回 id。
	createBody := `{"matchers":[{"name":"network_domain","value":"default","is_equal":true,"is_regex":false}],"starts_at":"2030-01-01T00:00:00Z","ends_at":"2030-01-01T02:00:00Z","comment":"smoke silence","created_by":"admin"}`
	code, out = c.json("POST", "/api/v2/platform/alertmanager/silences", createBody)
	require.Equal(t, http.StatusOK, code, "创建静默应成功：%v", out)
	silID := out["data"].(map[string]interface{})["id"].(string)
	assert.NotEmpty(t, silID)

	// 7. silence：列表应命中 1 条（默认 active=true）。
	code, out = c.json("GET", "/api/v2/platform/alertmanager/silences", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"])

	// 8. silence：删除 → 200；再列表为空。
	code, out = c.json("DELETE", "/api/v2/platform/alertmanager/silences/"+silID, "")
	require.Equal(t, http.StatusOK, code, "删除静默应成功：%v", out)
	assert.Equal(t, silID, out["data"].(map[string]interface{})["id"])
	code, out = c.json("GET", "/api/v2/platform/alertmanager/silences", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(0), out["data"].(map[string]interface{})["total"])
}

// ---------------------------------------------------------------------------
// Module_02（决策 47 / T02-03）采集状态路由收口集成验收：
// 经真实主路由树（/api/v1 组）验证 targets 代理 + coverage 三态聚合可命中，
// 且与其它路由不冲突、不被 SPA 静态兜底吞掉。夹具与 platform/query/coverage_test.go
// 的 coverageUpFixture / coverageTargetsFixture 对齐。
// ---------------------------------------------------------------------------

// fakePromUpstream 启动一个内存 Prometheus 上游，按路径分发 /api/v1/query 与
// /api/v1/targets，返回与 coverage_test.go 一致的场景夹具：
//   - up 样本：srv-1=1（up）、srv-2=0（down 有样本）、srv-3 无 series；
//   - targets：srv-2 down 且 lastError=connection refused。
func fakePromUpstream(t *testing.T) *httptest.Server {
	t.Helper()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/query":
			fmt.Fprintln(w, mustJSON(t, map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"resultType": "vector",
					"result": []map[string]interface{}{
						{"metric": map[string]string{"resource_id": "srv-1", "job": "job-a"}, "value": []interface{}{float64(1725000000), "1"}},
						{"metric": map[string]string{"resource_id": "srv-2", "job": "job-a"}, "value": []interface{}{float64(1725000000), "0"}},
					},
				},
			}))
		case "/api/v1/targets":
			fmt.Fprintln(w, mustJSON(t, map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"activeTargets": []map[string]interface{}{
						{
							"scrapePool": "job-a",
							"labels": map[string]interface{}{
								"job":         "job-a",
								"instance":    "10.0.0.2:9100",
								"resource_id": "srv-2",
							},
							"health":    "down",
							"lastError": "connection refused",
						},
					},
					"droppedTargets": []interface{}{},
					"targetsByJob":   map[string]interface{}{},
				},
			}))
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

// seedIntegrationHost 落一条 host fixture（与 fakePromUpstream 夹具对齐）。ResourceID
// 与 ServerID 保持一致以共存多条（同 coverage_test.go 约定）。
func seedIntegrationHost(t *testing.T, dbm *gorm.DB, id, domain, name string) {
	t.Helper()
	h := &models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domain,
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     name,
		Status:           "online",
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        "",
	}
	require.NoError(t, dbm.Create(h).Error)
}

// seedIntegrationJob 落一个 ready+enabled 的采集 job（selected 为选中的实例）。
func seedIntegrationJob(t *testing.T, dbm *gorm.DB, jobName string, selected []string) {
	t.Helper()
	j := &models.ScrapeJob{
		JobName:               jobName,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       "default",
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   selected,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusConfirmed,
		Enabled:               true,
	}
	require.NoError(t, dbm.Create(j).Error)
}

// TestEndToEndQueryCoverageRoutes 覆盖 M02 采集状态路由（决策 47 / T02-03）收口集成态：
// 经 buildIntegrationEngine 的真实主路由树（/api/v1 组）断言——
//   - GET /api/v1/targets 透传并本地过滤返回 activeTargets（含 job/network_domain/resource_id 补全）；
//   - GET /api/v1/health/coverage 在预置 host + ScrapeJob.selected_instance_ids + 伪 up 下游
//     按 resource_id 正确输出 collecting/pending_down/not_monitored 三态、last_error 与 coverage_rate；
//   - 上述端点与既有 /api/v2/platform/* 路由无冲突；本引擎不挂 SPA 静态兜底（未挂载端点 NoRoute 即
//     404），端点返回 200 即证明已真实挂载、未被静态兜底吞掉。
func TestEndToEndQueryCoverageRoutes(t *testing.T) {
	r, dbm := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 0. 预置与 fakePromUpstream 夹具对齐的 5 台 host + 1 个 ready+enabled 选中 job。
	for _, h := range []struct{ id, domain, name string }{
		{"srv-1", "default", "host-1"},
		{"srv-2", "default", "host-2"},
		{"srv-3", "default", "host-3"},
		{"srv-4", "default", "host-4"},
		{"dmz-x", "dmz", "host-dmz"},
	} {
		seedIntegrationHost(t, dbm, h.id, h.domain, h.name)
	}
	seedIntegrationJob(t, dbm, "job-a", []string{"srv-1", "srv-2", "srv-3"})

	// 1. /api/v1/targets：透传 + 本地过滤 + 补全。
	code, out := c.json("GET", "/api/v1/targets", "")
	require.Equal(t, http.StatusOK, code, "targets 应可命中：%v", out)
	data := out["data"].(map[string]interface{})
	active := data["activeTargets"].([]interface{})
	require.Len(t, active, 1, "夹具仅 1 个 active target")
	t0 := active[0].(map[string]interface{})
	assert.Equal(t, "down", t0["health"])
	assert.Equal(t, "srv-2", t0["resource_id"], "应补全 resource_id 标签")
	assert.Equal(t, "job-a", t0["job"], "应补全 job 标签")
	assert.Equal(t, "default", t0["network_domain"], "缺失 network_domain 回落 default")

	// health 本地过滤。
	code, out = c.json("GET", "/api/v1/targets?health=down", "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out["data"].(map[string]interface{})["activeTargets"].([]interface{}), 1)
	code, out = c.json("GET", "/api/v1/targets?health=up", "")
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].(map[string]interface{})["activeTargets"].([]interface{}), 0,
		"夹具无 up target，health=up 应过滤为空")

	// job 本地过滤：非 job-a 应为空。
	code, out = c.json("GET", "/api/v1/targets?job=other-job", "")
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].(map[string]interface{})["activeTargets"].([]interface{}), 0)

	// 非法 health 参数 → bad_request。
	code, out = c.json("GET", "/api/v1/targets?health=bogus", "")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 2. /api/v1/health/coverage：三态 + summary.coverage_rate。
	code, out = c.json("GET", "/api/v1/health/coverage", "")
	require.Equal(t, http.StatusOK, code, "coverage 应可命中：%v", out)
	cd := out["data"].(map[string]interface{})
	items := cd["items"].([]interface{})
	require.Len(t, items, 5, "5 台 host 全量覆盖")
	byID := map[string]map[string]interface{}{}
	for _, it := range items {
		m := it.(map[string]interface{})
		byID[m["resource_id"].(string)] = m
	}

	assert.Equal(t, "collecting", byID["srv-1"]["monitor_state"], "选中 + up → collecting")
	assert.Equal(t, "up", byID["srv-1"]["health"])
	assert.Equal(t, "pending_down", byID["srv-2"]["monitor_state"], "选中 + down → pending_down")
	assert.Equal(t, "down", byID["srv-2"]["health"])
	assert.Equal(t, "connection refused", byID["srv-2"]["last_error"], "last_error 应回填")
	assert.Equal(t, "pending_down", byID["srv-3"]["monitor_state"], "选中 + 无 up 样本 → pending_down")
	assert.Equal(t, "unknown", byID["srv-3"]["health"])
	assert.Equal(t, "not_monitored", byID["srv-4"]["monitor_state"], "未选中 → not_monitored")
	assert.Nil(t, byID["srv-4"]["health"], "未监控 health 应为 null")
	assert.Equal(t, "not_monitored", byID["dmz-x"]["monitor_state"])

	summary := cd["summary"].(map[string]interface{})
	assert.Equal(t, float64(5), summary["total"])
	assert.Equal(t, float64(1), summary["collecting"])
	assert.Equal(t, float64(2), summary["pending_down"])
	assert.Equal(t, float64(2), summary["not_monitored"])
	assert.Equal(t, 0.2, summary["coverage_rate"], "coverage_rate = 1/5 = 0.2")

	// state 过滤走真实路由。
	code, out = c.json("GET", "/api/v1/health/coverage?state=not_monitored", "")
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].(map[string]interface{})["items"].([]interface{}), 2)

	// network_domain 过滤走真实路由。
	code, out = c.json("GET", "/api/v1/health/coverage?network_domain=dmz", "")
	require.Equal(t, http.StatusOK, code)
	items = out["data"].(map[string]interface{})["items"].([]interface{})
	require.Len(t, items, 1)
	assert.Equal(t, "dmz-x", items[0].(map[string]interface{})["resource_id"])
}
