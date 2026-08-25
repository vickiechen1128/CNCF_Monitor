package resource

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListOSOptions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/os-options", ListOSOptions())

	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/os-options", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var body struct {
		Status string `json:"status"`
		Data   struct {
			List []struct {
				Name   string `json:"name"`
				Family string `json:"family"`
			} `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, "success", body.Status)
	require.NotEmpty(t, body.Data.List)
	for _, o := range body.Data.List {
		assert.NotEmpty(t, o.Name)
		assert.NotEmpty(t, o.Family)
	}
}