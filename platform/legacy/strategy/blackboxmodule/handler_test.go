package blackboxmodule

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestModuleRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ScrapeJob{}))
	r := gin.New()
	RegisterRoutes(r.Group("/api/v2/platform"), db)

	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	assert.Equal(t, http.StatusOK, request(http.MethodGet, "/api/v2/platform/blackbox-modules", "").Code)
	assert.Equal(t, http.StatusBadRequest, request(http.MethodPost, "/api/v2/platform/blackbox-modules", `{"name":"custom","content":"other:\n  prober: http\n"}`).Code)
	created := request(http.MethodPost, "/api/v2/platform/blackbox-modules", `{"name":"custom","content":"custom:\n  prober: http\n  timeout: 10s\n"}`)
	assert.Equal(t, http.StatusOK, created.Code)
	assert.Contains(t, created.Body.String(), `"prober":"http"`)
	assert.Equal(t, http.StatusConflict, request(http.MethodPost, "/api/v2/platform/blackbox-modules", `{"name":"custom","content":"custom:\n  prober: http\n"}`).Code)
	assert.Equal(t, http.StatusOK, request(http.MethodPut, "/api/v2/platform/blackbox-modules/5", `{"content":"custom:\n  prober: http\n  timeout: 20s\n","enabled":false}`).Code)
	assert.Equal(t, http.StatusOK, request(http.MethodDelete, "/api/v2/platform/blackbox-modules/5", "").Code)
	assert.Equal(t, http.StatusNotFound, request(http.MethodDelete, "/api/v2/platform/blackbox-modules/5", "").Code)
}
