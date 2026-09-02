package resource

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mountBusinessRouter 挂载业务字典 POST/PUT 写路由（GET 校验时序复用 read 测试）。
func mountBusinessRouter(t *testing.T) (*gin.Engine, *BusinessDomainStore) {
	t.Helper()
	store := newBizStore(t) // 预置 infra/payment/data-api(启用)、legacy(停用)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v2/platform/business-domains", CreateBusinessDomain(store))
	r.PUT("/api/v2/platform/business-domains/:code", UpdateBusinessDomain(store))
	return r, store
}

func postJSON(t *testing.T, r *gin.Engine, path, body string) (int, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "http://mc.local"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func putJSON(t *testing.T, r *gin.Engine, path, body string) (int, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "http://mc.local"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestCreateBusinessDomainSuccess(t *testing.T) {
	r, _ := mountBusinessRouter(t)

	code, out := postJSON(t, r, "/api/v2/platform/business-domains", `{"code":"risk-control","name":"风控业务","description":"风控业务域"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "success", out["status"])
	created := out["data"].(map[string]interface{})
	assert.Equal(t, "risk-control", created["code"])
	assert.Equal(t, "风控业务", created["name"])
	assert.Equal(t, true, created["enabled"], "登记默认启用")
}

func TestCreateBusinessDomainInvalidCode(t *testing.T) {
	r, _ := mountBusinessRouter(t)

	for _, body := range []string{
		`{"code":"Bad_Ops","name":"X"}`,
		`{"code":"","name":"X"}`,
		`{"code":"a"}`,
	} {
		code, out := postJSON(t, r, "/api/v2/platform/business-domains", body)
		assert.Equal(t, http.StatusBadRequest, code, "body=%s", body)
		assert.Equal(t, "bad_request", out["errorType"], "body=%s", body)
	}
}

func TestCreateBusinessDomainEmptyName(t *testing.T) {
	r, _ := mountBusinessRouter(t)

	code, out := postJSON(t, r, "/api/v2/platform/business-domains", `{"code":"ok-code","name":"   "}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])
}

func TestCreateBusinessDomainDuplicate(t *testing.T) {
	r, store := mountBusinessRouter(t)

	// parser 排重：已有与新建不重复。
	code, out := postJSON(t, r, "/api/v2/platform/business-domains", `{"code":"payment","name":"重名"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"], "已存在 code 应拒绝")

	// 新建后再次登记同名仍拒绝。
	_, _ = postJSON(t, r, "/api/v2/platform/business-domains", `{"code":"risk-control","name":"先建"}`)
	code, out = postJSON(t, r, "/api/v2/platform/business-domains", `{"code":"risk-control","name":"再建"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	list, err := store.List()
	require.NoError(t, err)
	assert.Len(t, list, 5, "risk-control 仅落一条")
}

func TestUpdateBusinessDomainProfile(t *testing.T) {
	r, store := mountBusinessRouter(t)

	code, out := putJSON(t, r, "/api/v2/platform/business-domains/payment", `{"name":"支付业务(新)","description":"新描述","enabled":false}`)
	require.Equal(t, http.StatusOK, code)
	updated := out["data"].(map[string]interface{})
	assert.Equal(t, "支付业务(新)", updated["name"])
	assert.Equal(t, false, updated["enabled"])
	assert.Equal(t, "payment", updated["code"], "code 受路径约束，请求体 code 不影响")

	d, _, err := store.Lookup("payment")
	require.NoError(t, err)
	assert.Equal(t, "新描述", d.Description)
	assert.False(t, d.Enabled)
}

func TestUpdateBusinessDomainInfraDisableRejected(t *testing.T) {
	r, _ := mountBusinessRouter(t)

	code, out := putJSON(t, r, "/api/v2/platform/business-domains/infra", `{"enabled":false}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 非停用的其他字段仍可编辑 infra。
	code, out = putJSON(t, r, "/api/v2/platform/business-domains/infra", `{"name":"公共基础设施"}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, out["data"].(map[string]interface{})["enabled"], "infra 仅禁停用，其余编辑放行")
}

func TestUpdateBusinessDomainNotFound(t *testing.T) {
	r, _ := mountBusinessRouter(t)

	code, out := putJSON(t, r, "/api/v2/platform/business-domains/not-exist", `{"name":"X"}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestUpdateBusinessDomainEmptyNameRejected(t *testing.T) {
	r, _ := mountBusinessRouter(t)

	code, out := putJSON(t, r, "/api/v2/platform/business-domains/payment", `{"name":""}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])
}