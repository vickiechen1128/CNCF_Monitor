package config

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// newConfigRouter 组装 alertmanager config 只读路由（导入 / 重新挂载入口已删除）。
func newConfigRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2/platform/alertmanager/config")
	g.GET("/current", CurrentHandler(db))
	g.GET("/versions", ListVersionsHandler(db))
	g.GET("/versions/:id", GetVersionHandler(db))
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

// seedVersion 通过内部落库工序（唯一生成规则产物的校验 + 留痕）写入一条版本。
func seedVersion(t *testing.T, db *gorm.DB, content, user string) *models.AlertmanagerConfigVersion {
	t.Helper()
	v, err := Submit(db, content, user)
	require.NoError(t, err)
	return v
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

	// 留痕后：返回最近一条 applied 版本。
	seedVersion(t, db, validAMConfig, "")

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

	// 留痕三条不同内容。
	for i := 0; i < 3; i++ {
		cfg := "route:\n  receiver: r" + string(rune('a'+i)) + "\n"
		seedVersion(t, db, cfg, "")
	}

	w := do(t, r, http.MethodGet, "/api/v2/platform/alertmanager/config/versions?page=1&page_size=2", "")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	m := (decodeResponse(t, w))["data"].(map[string]interface{})
	assert.Equal(t, float64(3), m["total"])
	items := m["items"].([]interface{})
	require.Len(t, items, 2)
	// 列表项不含 content。
	assert.NotContains(t, w.Body.String(), `"route:"`)
	// 最近在前：第一条为最后一次留痕的 rb。
	firstItem := items[0].(map[string]interface{})
	assert.NotEmpty(t, firstItem["checksum"])
}

func TestGetVersionEndpointDetail(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	r := newConfigRouter(db)

	v := seedVersion(t, db, validAMConfig, "")
	id := strconv.FormatUint(uint64(v.ID), 10)

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
