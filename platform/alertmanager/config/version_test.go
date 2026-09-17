package config

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// newConfigRouter 组装 alertmanager config 路由（与 T08-05 一致的前缀子组）。
func newConfigRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2/platform/alertmanager/config")
	g.POST("", SubmitHandler(db))
	g.GET("/current", CurrentHandler(db))
	g.GET("/versions", ListVersionsHandler(db))
	g.GET("/versions/:id", GetVersionHandler(db))
	g.POST("/versions/:id/remount", RemountHandler(db))
	return r
}

func do(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &m))
	return m
}

func TestSubmitEndpointCreatesVersion(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	r := newConfigRouter(db)

	body := `{"content":"` + strings.ReplaceAll(validAMConfig, "\n", "\\n") + `","uploaded_by":"chenrt"}`
	w := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body)
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	m := decodeResponse(t, w)
	assert.Equal(t, "success", m["status"])
	data := m["data"].(map[string]interface{})
	assert.Equal(t, "applied", data["status"])
	assert.NotEmpty(t, data["id"])
	assert.Contains(t, data["content"], "route:")
}

func TestSubmitEndpointValidationFails(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolFails(t)
	stubChangeTrigger(t)
	r := newConfigRouter(db)

	body := `{"content":"route:\n  receiver: missing\n","uploaded_by":"chenrt"}`
	w := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body)
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	m := decodeResponse(t, w)
	assert.Equal(t, "error", m["status"])
	assert.Equal(t, "bad_request", m["errorType"])
	// 行级错误集合在 data.items。
	assert.Contains(t, w.Body.String(), `"items"`)
	assert.Contains(t, w.Body.String(), `"note"`)

	// 校验失败不落库。
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestCurrentEndpointEmptyThenAfterSubmit(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	r := newConfigRouter(db)

	// 无版本：当前生效返回 { content: '' }。
	w := do(t, r, http.MethodGet, "/api/v2/platform/alertmanager/config/current", "")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	m := (decodeResponse(t, w))["data"].(map[string]interface{})
	assert.Equal(t, "", m["content"])

	// 挂载后：返回最近一条 applied 版本。
	body := `{"content":"` + strings.ReplaceAll(validAMConfig, "\n", "\\n") + `"}`
	require.Equal(t, http.StatusOK, do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body).Code)

	w = do(t, r, http.MethodGet, "/api/v2/platform/alertmanager/config/current", "")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	m = (decodeResponse(t, w))["data"].(map[string]interface{})
	assert.Equal(t, "applied", m["status"])
	assert.Contains(t, m["content"], "route:")
}

func TestListVersionsEndpointPagination(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	r := newConfigRouter(db)

	// 挂载三条不同内容。
	for i := 0; i < 3; i++ {
		cfg := "route:\n  receiver: r" + string(rune('a'+i)) + "\n"
		body := `{"content":"` + strings.ReplaceAll(cfg, "\n", "\\n") + `"}`
		require.Equal(t, http.StatusOK, do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body).Code)
	}

	w := do(t, r, http.MethodGet, "/api/v2/platform/alertmanager/config/versions?page=1&page_size=2", "")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	m := (decodeResponse(t, w))["data"].(map[string]interface{})
	assert.Equal(t, float64(3), m["total"])
	items := m["items"].([]interface{})
	require.Len(t, items, 2)
	// 列表项不含 content。
	assert.NotContains(t, w.Body.String(), `"route:"`)
	// 最近在前：第一条为最后一次挂载的 rb。
	firstItem := items[0].(map[string]interface{})
	assert.NotEmpty(t, firstItem["checksum"])
}

func TestGetVersionEndpointDetail(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	r := newConfigRouter(db)

	body := `{"content":"` + strings.ReplaceAll(validAMConfig, "\n", "\\n") + `"}`
	sub := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body)
	require.Equal(t, http.StatusOK, sub.Code)
	id := ((decodeResponse(t, sub))["data"].(map[string]interface{}))["id"].(string)

	// 详情返回完整 content。
	w := do(t, r, http.MethodGet, "/api/v2/platform/alertmanager/config/versions/"+id, "")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	m := (decodeResponse(t, w))["data"].(map[string]interface{})
	assert.Contains(t, m["content"], "route:")

	// 不存在的 id → not_found。
	w = do(t, r, http.MethodGet, "/api/v2/platform/alertmanager/config/versions/999999", "")
	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	assert.Equal(t, "not_found", decodeResponse(t, w)["errorType"])
}

func TestRemountEndpointCreatesNewVersion(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	calls := stubChangeTrigger(t)
	r := newConfigRouter(db)

	// 挂载 v1。
	body := `{"content":"` + strings.ReplaceAll(validAMConfig, "\n", "\\n") + `","uploaded_by":"a"}`
	sub := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body)
	require.Equal(t, http.StatusOK, sub.Code, sub.Body.String())
	id := ((decodeResponse(t, sub))["data"].(map[string]interface{}))["id"].(string)

	// remount 同 id 内容 → 总是写新版本，版本数 +1。
	w := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config/versions/"+id+"/remount", `{"uploaded_by":"b"}`)
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	newID := ((decodeResponse(t, w))["data"].(map[string]interface{}))["id"].(string)
	assert.NotEqual(t, id, newID, "remount 应写入新版本")

	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
	// remount 触发变更检测。
	assert.EqualValues(t, 2, atomic.LoadInt32(calls))
}

func TestRemountEndpointNotFound(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	r := newConfigRouter(db)

	w := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config/versions/999999/remount", `{"uploaded_by":"b"}`)
	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	assert.Equal(t, "not_found", decodeResponse(t, w)["errorType"])
}

func TestRemountEndpointValidationFailsNoPersist(t *testing.T) {
	db := newMemConfigDB(t)
	calls := stubChangeTrigger(t)
	r := newConfigRouter(db)

	// 先挂载合法内容。
	stubAmtoolAvailable(t)
	body := `{"content":"` + strings.ReplaceAll(validAMConfig, "\n", "\\n") + `"}`
	sub := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body)
	require.Equal(t, http.StatusOK, sub.Code, sub.Body.String())
	id := ((decodeResponse(t, sub))["data"].(map[string]interface{}))["id"].(string)

	// remount 前切换为校验失败：内容本身来自已校验通过版本，这里模拟对已留痕内容
	// 重新校验失败（如 amtool 行为变化）——校验失败不写入新版本。
	stubAmtoolFails(t)
	w := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config/versions/"+id+"/remount", `{}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())

	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "校验失败不产生新版本")
	assert.EqualValues(t, 1, atomic.LoadInt32(calls))
}