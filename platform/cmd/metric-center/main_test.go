package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/admin/networkdomain"
	"github.com/metriccenter/metriccenter/platform/config/label"
	"github.com/metriccenter/metriccenter/platform/config/resource"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
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
	))
	require.NoError(t, seed.Run(db))

	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	networkdomain.RegisterRoutes(platform, db)

	// M07 收口（T07-18）：业务分组字典（真实 yaml）+ 资源 + 标签模板。
	bizStore := resource.NewBusinessDomainStore(businessDomainsTestPath)
	resource.RegisterRoutes(platform, db, bizStore)
	label.RegisterRoutes(platform, db)
	return r, db
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
		"biz_code":          "infra",
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
			assert.Equal(t, "infra", data["biz_code"])

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
		{"instance_name": "db-online-03", "instance_ip": "10.0.1.3", "env": "prod", "app_name": "pay-db", "cluster": "db-cluster", "biz_code": "payment"},
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
	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host&biz_code=infra", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(2), out["data"].(map[string]interface{})["total"], "biz_code=infra 应命中 2 台")

	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host&status=offline", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "status=offline 应命中 1 台")

	code, out = c.json("GET", "/api/v2/platform/resources?resource_category=host&biz_code=infra&status=online", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "biz_code=infra&status=online 组合应命中 1 台")

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
		return [][]string{{"default", name, name, ip, "Linux", "infra", "", "prod", "", "ops", status}}
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

	// 5. 克隆默认模板：新名派生、is_default=false、mappings 全量复制（application 默认 6 条）。
	code, out = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", defaultAppID)+"/clone", "")
	require.Equal(t, http.StatusOK, code)
	clone := out["data"].(map[string]interface{})
	cloneID := clone["id"].(float64)
	assert.Equal(t, "default-application 副本", clone["name"])
	assert.Equal(t, false, clone["is_default"])
	assert.Len(t, clone["mappings"].([]interface{}), 6)

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
	assert.Len(t, out["data"].([]interface{}), 7, "新增 composite→instance 映射")

	code, out = c.json("POST", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings",
		mustJSON(t, map[string]interface{}{"source_type": "resource_field", "source_field": "owner", "target_label": "owner"}))
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].([]interface{}), 8)

	// 8. 更新 / 删除 mapping。
	code, out = c.json("PUT", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings/7", `{"source_field":"instance_ip:port"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Len(t, out["data"].([]interface{}), 8)
	code, out = c.json("DELETE", "/api/v2/platform/label-templates/"+fmt.Sprintf("%.0f", cloneID)+"/mappings/8", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(8), out["data"].(map[string]interface{})["mapping_id"])

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

// TestEndToEndBusinessDomainsReadOnly 覆盖业务分组字典（验收要点 5）：只读返回
// 全量条目（含停用 legacy），无 POST/PUT/DELETE 写路由。
func TestEndToEndBusinessDomainsReadOnly(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	code, out := c.json("GET", "/api/v2/platform/business-domains", "")
	require.Equal(t, http.StatusOK, code)
	bdata := out["data"].(map[string]interface{})
	assert.Equal(t, float64(4), bdata["total"], "字典含 infra/payment/data-api/legacy")
	codes := make([]string, 0, 4)
	for _, it := range listItems(out) {
		codes = append(codes, it.(map[string]interface{})["code"].(string))
	}
	assert.Contains(t, codes, "infra")
	assert.Contains(t, codes, "payment")
	assert.Contains(t, codes, "data-api")
	assert.Contains(t, codes, "legacy")

	// 只读：无写路由 → 404。
	code, _ = c.json("POST", "/api/v2/platform/business-domains", `{"code":"x","name":"X"}`)
	assert.Equal(t, http.StatusNotFound, code)
	code, _ = c.json("PUT", "/api/v2/platform/business-domains/infra", `{"name":"Y"}`)
	assert.Equal(t, http.StatusNotFound, code)
	code, _ = c.json("DELETE", "/api/v2/platform/business-domains/infra", "")
	assert.Equal(t, http.StatusNotFound, code)
}
