package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

func writeAndDecode(t *testing.T, err error) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	WriteError(c, err)

	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return rec.Code, out
}

func TestWriteErrorMapsKinds(t *testing.T) {
	cases := []struct {
		err       error
		status    int
		errorType string
		message   string
	}{
		{apierror.New(apierror.BadRequest, "field invalid"), 400, "bad_request", "field invalid"},
		{apierror.New(apierror.Unauthorized, "token expired"), 401, "unauthorized", "token expired"},
		{apierror.New(apierror.Forbidden, "admin only"), 403, "forbidden", "admin only"},
		{apierror.New(apierror.NotFound, "missing"), 404, "not_found", "missing"},
		{apierror.New(apierror.Conflict, "duplicate"), 409, "conflict", "duplicate"},
		{apierror.New(apierror.Unavailable, "db down"), 503, "unavailable", "service unavailable"},
		{errors.New("secret dsn"), 500, "internal", "internal error"},
	}
	for _, tc := range cases {
		status, out := writeAndDecode(t, tc.err)
		assert.Equal(t, tc.status, status, tc.errorType)
		assert.Equal(t, "error", out["status"])
		assert.Equal(t, tc.errorType, out["errorType"])
		assert.Equal(t, tc.message, out["error"])
	}
}

func TestWriteErrorNil(t *testing.T) {
	status, out := writeAndDecode(t, nil)
	assert.Equal(t, http.StatusInternalServerError, status)
	assert.Equal(t, "internal", out["errorType"])
}
