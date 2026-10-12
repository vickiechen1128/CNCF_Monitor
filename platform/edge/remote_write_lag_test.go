package edge

// F-40 延展（M09 节点列表「回传延迟」）：中心视角按网域聚合样本滞后秒数。

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPromSampleLagQuerierParsesVector(t *testing.T) {
	var gotExpr string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/query", r.URL.Path)
		gotExpr = r.URL.Query().Get("query")
		w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[
			{"metric":{"network_domain_id":"mc-edge-debug"},"value":[1760000000,"1267.3"]},
			{"metric":{"network_domain_id":"default"},"value":[1760000000,"3.9"]},
			{"metric":{},"value":[1760000000,"99"]}
		]}}`))
	}))
	defer srv.Close()

	q := NewPromSampleLagQuerier(mustParseURL(t, srv.URL), nil)
	lags, err := q.QueryDomainLags(context.Background())
	require.NoError(t, err)
	assert.Equal(t, SampleLagQueryExpr, gotExpr, "应使用按网域聚合的 PromQL")
	assert.Contains(t, gotExpr, "quantile by (network_domain_id) (0.95", "口径应为 p95 分位而非 max")
	assert.Contains(t, gotExpr, "ts_of_last_over_time", "应取窗口内最后样本的真实时间戳（timestamp(last_over_time) 恒 0）")
	assert.Equal(t, int64(1267), lags["mc-edge-debug"])
	assert.Equal(t, int64(3), lags["default"])
	_, ok := lags[""]
	assert.False(t, ok, "缺 network_domain_id 标签的序列应跳过")
}

func TestPromSampleLagQuerierTTLCache(t *testing.T) {
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer srv.Close()

	q := NewPromSampleLagQuerier(mustParseURL(t, srv.URL), nil)
	for i := 0; i < 3; i++ {
		_, err := q.QueryDomainLags(context.Background())
		require.NoError(t, err)
	}
	assert.Equal(t, int64(1), atomic.LoadInt64(&hits), "TTL 内重复查询应命中缓存")
}

func TestPromSampleLagQuerierUpstreamFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	q := NewPromSampleLagQuerier(mustParseURL(t, srv.URL), nil)
	_, err := q.QueryDomainLags(context.Background())
	assert.Error(t, err)
}

func TestPromSampleLagQuerierNegativeLagClampedToZero(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[
			{"metric":{"network_domain_id":"gov-cloud"},"value":[1760000000,"-0.42"]}
		]}}`))
	}))
	defer srv.Close()

	q := NewPromSampleLagQuerier(mustParseURL(t, srv.URL), nil)
	lags, err := q.QueryDomainLags(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int64(0), lags["gov-cloud"], "边缘时钟轻微超前产生的小负数应截 0（语义即「刚刚」）")
}

// stubLagQuerier 固定返回预置 map 或错误。
type stubLagQuerier struct {
	lags map[string]int64
	err  error
}

func (s stubLagQuerier) QueryDomainLags(context.Context) (map[string]int64, error) {
	return s.lags, s.err
}

func TestFillSampleLags(t *testing.T) {
	views := []AgentView{
		{NetworkDomainID: "mc-edge-debug"},
		{NetworkDomainID: "gov-cloud"},
		{NetworkDomainID: "no-data-domain"},
	}

	// 正常路径：按网域填充；结果里没有的域保持 nil。
	fillSampleLags(views, stubLagQuerier{lags: map[string]int64{"mc-edge-debug": 1267, "gov-cloud": 4}})
	require.NotNil(t, views[0].RemoteWriteLagSeconds)
	assert.Equal(t, int64(1267), *views[0].RemoteWriteLagSeconds)
	require.NotNil(t, views[1].RemoteWriteLagSeconds)
	assert.Equal(t, int64(4), *views[1].RemoteWriteLagSeconds)
	assert.Nil(t, views[2].RemoteWriteLagSeconds, "无样本网域应保持 nil（无数据）")

	// nil querier：整体跳过。
	empty := []AgentView{{NetworkDomainID: "mc-edge-debug"}}
	fillSampleLags(empty, nil)
	assert.Nil(t, empty[0].RemoteWriteLagSeconds)

	// 查询失败：降级为无数据，不阻塞。
	failed := []AgentView{{NetworkDomainID: "mc-edge-debug"}}
	fillSampleLags(failed, stubLagQuerier{err: errors.New("prom down")})
	assert.Nil(t, failed[0].RemoteWriteLagSeconds)
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}
