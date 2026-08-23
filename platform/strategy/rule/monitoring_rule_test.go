package rule

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:rule_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.MonitoringRule{}))
	return db
}

func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterRoutes(r.Group("/api/v2/platform"), db)
	return r
}

func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Buffer
	if body == "" {
		buf = bytes.NewBuffer(nil)
	} else {
		buf = bytes.NewBufferString(body)
	}
	req := httptest.NewRequest(method, path, buf)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// rulesFixture 返回一份携带一组 groups 的合法规则 YAML。
func rulesFixture() string {
	return `
groups:
- name: host-cpu-alerts
  rules:
  - alert: HighCPU
    expr: node_cpu_usage > 0.9
`
}

func TestValidateRuleYamlSyntax(t *testing.T) {
	require.NoError(t, validateRuleYAML(rulesFixture()))

	// 顶层的 groups 缺失 / 非数组 → 报错。
	require.Error(t, validateRuleYAML("name: x\n"))
	require.Error(t, validateRuleYAML("groups: scalar"))
	require.Error(t, validateRuleYAML("not: yaml: ["))
	require.Error(t, validateRuleYAML(""))
}

func TestCreateMonitoringRule(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// YAML 非法 → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", `{"rule_content":"name: x\n"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// content_mode 非 yaml_passthrough → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", `{"content_mode":"structured","rule_content":"groups: []"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 合法创建：draft_status=ready，change_status=pending，scope=central。
	body := fmt.Sprintf(`{"content_mode":"yaml_passthrough","rule_content":%s,"name":"cpu-rules","enabled":true}`, jsonString(rulesFixture()))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string              `json:"status"`
		Data   models.MonitoringRule `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, "cpu-rules", out.Data.Name)
	assert.Equal(t, string(models.RuleContentModeYAMLPassthrough), string(out.Data.ContentMode))
	assert.Equal(t, string(models.ScopeTypeCentral), string(out.Data.Scope))
	assert.Equal(t, "ready", out.Data.DraftStatus)
	assert.Equal(t, string(models.ChangeStatusPending), string(out.Data.ChangeStatus))
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestListUpdateDeleteMonitoringRule(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 创建两条规则。
	for _, name := range []string{"cpu-rules", "disk-rules"} {
		body := fmt.Sprintf(`{"rule_content":%s,"name":%s,"enabled":true}`, jsonString(rulesFixture()), jsonString(name))
		w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
		require.Equal(t, http.StatusOK, w.Code)
	}

	// 关键字筛选。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules?keyword=cpu", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []models.MonitoringRule `json:"list"`
			Total int64                   `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "cpu-rules", out.Data.List[0].Name)
	cpuRuleID := strconv.FormatUint(uint64(out.Data.List[0].ID), 10)
	cpuRuleUID := out.Data.List[0].ID

	// enabled=false 筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules?enabled=false", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(0), out.Data.Total)

	// 更新 name + enabled。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/monitoring-rules/"+cpuRuleID, `{"name":"cpu-rules-v2","enabled":false}`)
	require.Equal(t, http.StatusOK, w.Code)
	var upd struct {
		Data struct {
			Name    string `json:"name"`
			Enabled bool   `json:"enabled"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &upd))
	assert.Equal(t, "cpu-rules-v2", upd.Data.Name)
	assert.Equal(t, false, upd.Data.Enabled)

	// 更新非法 YAML → bad_request。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/monitoring-rules/"+cpuRuleID, `{"rule_content":"name: x\n"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 未命中 not_found。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/monitoring-rules/999999", `{"name":"x"}`)
	require.Equal(t, http.StatusNotFound, w.Code)

	// 软删返回 {id}，列表为空。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/monitoring-rules/"+cpuRuleID, "")
	require.Equal(t, http.StatusOK, w.Code)
	var del struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &del))
	assert.Equal(t, cpuRuleUID, del.Data.ID)

	w = perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total, "软删后仅剩 disk-rules")

	w = perform(t, r, http.MethodDelete, "/api/v2/platform/monitoring-rules/999999", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestValidateYAMLEndpoint(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 创建一条规则作为 :id 上下文目标。
	body := fmt.Sprintf(`{"rule_content":%s,"name":"cpu-rules"}`, jsonString(rulesFixture()))
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	_ = w

	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules/1/validate-yaml", fmt.Sprintf(`{"rule_content":%s}`, jsonString(rulesFixture())))
	require.Equal(t, http.StatusOK, w.Code)
	var okResp struct {
		Data struct {
			Valid bool `json:"valid"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &okResp))
	assert.True(t, okResp.Data.Valid)

	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules/1/validate-yaml", `{"rule_content":"name: x\n"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var badResp struct {
		Data struct {
			Valid bool   `json:"valid"`
			Error string `json:"error"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &badResp))
	assert.False(t, badResp.Data.Valid)
	assert.NotEmpty(t, badResp.Data.Error)
}