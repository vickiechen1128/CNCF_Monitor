package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeValidator struct {
	token    string
	domainID string
	ok       bool
}

func (f fakeValidator) Validate(_ context.Context, token string) (string, bool) {
	if token != f.token {
		return "", false
	}
	return f.domainID, f.ok
}

func newEdgeTestRouter(mw gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(mw)
	r.POST("/heartbeat", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"domain": NetworkDomainFromContext(c)})
	})
	return r
}

func TestEdgeTokenMiddleware_NoToken(t *testing.T) {
	r := newEdgeTestRouter(EdgeTokenMiddleware(nil))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/heartbeat", nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code, "missing bearer token must be 401")
}

func TestEdgeTokenMiddleware_InvalidToken(t *testing.T) {
	r := newEdgeTestRouter(EdgeTokenMiddleware(fakeValidator{token: "good", domainID: "mc-demo", ok: true}))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code, "unknown token must be 401")
}

func TestEdgeTokenMiddleware_ValidTokenSetsContext(t *testing.T) {
	r := newEdgeTestRouter(EdgeTokenMiddleware(fakeValidator{token: "good", domainID: "mc-demo", ok: true}))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer good")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), "mc-demo", "resolved domain must reach the handler")
}

func TestEdgeTokenMiddleware_DefaultRejectsAll(t *testing.T) {
	// A nil validator falls back to rejectAllValidator: even a present token is
	// rejected. This is the B2 default until B4 wires the real sha256 lookup.
	r := newEdgeTestRouter(EdgeTokenMiddleware(nil))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer any-token")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code, "default validator must reject all tokens")
}

func TestBearerToken_TrimsAndRequiresPrefix(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	assert.Equal(t, "", bearerToken(c), "no header → empty")

	c.Request.Header.Set("Authorization", "Token abc")
	assert.Equal(t, "", bearerToken(c), "non-Bearer scheme → empty")

	c.Request.Header.Set("Authorization", "Bearer   abc  ")
	assert.Equal(t, "abc", bearerToken(c), "bearer token is trimmed")
}
