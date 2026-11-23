package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ActiveAlerts must keep AM query parameters in the query string. Passing the
// full path+query to url.URL{Path: ...} escaped '?' into the path and made AM
// return 404 (observed in the M09 scenario walkthrough).
func TestActiveAlertsKeepsQueryInURL(t *testing.T) {
	var gotPath, gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()

	base, err := url.Parse(server.URL)
	require.NoError(t, err)

	alerts, err := NewAMClient(base).ActiveAlerts(context.Background())
	require.NoError(t, err)
	assert.Empty(t, alerts)
	assert.Equal(t, "/api/v2/alerts", gotPath)
	assert.Equal(t, "active=true&silenced=true&inhibited=true", gotQuery)
}
