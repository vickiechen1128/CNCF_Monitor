package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestIDPropagatesIncoming(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(RequestID())
	router.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, RequestIDFrom(c))
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderRequestID, "req-123")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, "req-123", rec.Body.String())
	assert.Equal(t, "req-123", rec.Header().Get(HeaderRequestID))
}

func TestRequestIDGeneratesAndRejectsInjection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(RequestID())
	router.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, RequestIDFrom(c))
	})

	for _, header := range []string{"", "bad\nvalue", strings.Repeat("a", 129)} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if header != "" {
			req.Header.Set(HeaderRequestID, header)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		got := rec.Body.String()
		require.NotEmpty(t, got)
		assert.NotEqual(t, header, got)
		assert.Equal(t, got, rec.Header().Get(HeaderRequestID))
	}
}

func TestRequestIDFromNilContext(t *testing.T) {
	assert.Empty(t, RequestIDFrom(nil))
}
