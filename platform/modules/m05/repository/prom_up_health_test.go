package repository

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
)

// TestPromUpHealthQuerierClassifiesSamples covers the real `up` instant query:
// one request, grouped by resource_id into the up=1 / up!=1 sets.
func TestPromUpHealthQuerierClassifiesSamples(t *testing.T) {
	var gotPath, gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[
			{"metric":{"resource_id":"r1","job":"host"},"value":[1700000000,"1"]},
			{"metric":{"resource_id":"r2"},"value":[1700000000,"0"]},
			{"metric":{"resource_id":"r3"},"value":[1700000000,"1"]},
			{"metric":{"resource_id":"r3"},"value":[1700000000,"0"]},
			{"metric":{},"value":[1700000000,"1"]}
		]}}`))
	}))
	t.Cleanup(server.Close)

	base, err := url.Parse(server.URL)
	require.NoError(t, err)
	querier := NewPromUpHealthQuerier(base, server.Client())
	require.NotNil(t, querier)

	index, err := querier.UpHealth(context.Background())
	require.NoError(t, err)
	require.NotNil(t, index)
	assert.Equal(t, "/api/v1/query", gotPath)
	assert.Equal(t, upInstantQuery, gotQuery)

	// r1 up=1, r3 has both states, r2 only up=0, r4 has no sample; the sample
	// without a resource_id label is ignored.
	counts := domain.ClassifyUpHealth([]string{"r1", "r2", "r3", "r4"}, index)
	require.NotNil(t, counts)
	assert.Equal(t, 4, counts.Total)
	assert.Equal(t, 1, counts.Collecting)
	assert.Equal(t, 1, counts.Partial)
	assert.Equal(t, 2, counts.Down)
}

// TestPromUpHealthQuerierDegrades asserts every failure mode returns an error so
// the summary service can omit collection_health instead of reporting zero.
func TestPromUpHealthQuerierDegrades(t *testing.T) {
	t.Run("nil querier", func(t *testing.T) {
		var querier *PromUpHealthQuerier
		_, err := querier.UpHealth(context.Background())
		require.Error(t, err)
	})

	t.Run("nil base url", func(t *testing.T) {
		assert.Nil(t, NewPromUpHealthQuerier(nil, nil), "no Prometheus configured ⇒ no querier")
	})

	t.Run("non-200 status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		t.Cleanup(server.Close)
		base, err := url.Parse(server.URL)
		require.NoError(t, err)

		_, err = NewPromUpHealthQuerier(base, server.Client()).UpHealth(context.Background())
		require.Error(t, err)
	})

	t.Run("unexpected prometheus status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"status":"error","errorType":"bad_data"}`))
		}))
		t.Cleanup(server.Close)
		base, err := url.Parse(server.URL)
		require.NoError(t, err)

		_, err = NewPromUpHealthQuerier(base, server.Client()).UpHealth(context.Background())
		require.Error(t, err)
	})
}
