package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParsePanelID covers the :id boundary: numeric IDs only, 0 invalid.
func TestParsePanelID(t *testing.T) {
	cases := []struct {
		raw     string
		want    uint
		wantErr bool
	}{
		{raw: "1", want: 1},
		{raw: "42", want: 42},
		{raw: "0", wantErr: true},
		{raw: "-1", wantErr: true},
		{raw: "abc", wantErr: true},
		{raw: "", wantErr: true},
		{raw: "1.5", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := parsePanelID(tc.raw)
			if tc.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// TestDecodeStrictJSON rejects unknown fields so a typo (e.g. "link" instead of
// "url") fails fast with 400 instead of silently creating an empty URL panel.
func TestDecodeStrictJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	decode := func(body string) error {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v3/platform/dashboard/panels", strings.NewReader(body))
		var req panelRequest
		return decodeStrictJSON(c, &req)
	}

	require.NoError(t, decode(`{"name":"节点大屏","url":"http://grafana.example.com/d/node"}`))
	assert.Error(t, decode(`{"name":"节点大屏","link":"http://grafana.example.com/d/node"}`),
		"unknown fields must be rejected")
	assert.Error(t, decode(`[]`), "a JSON array is not a valid panel payload")
	assert.Error(t, decode(`not-json`))
}
