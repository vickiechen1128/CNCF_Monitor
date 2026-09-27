package dashboard

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

// TestPromProbeQuerierProbeSuccess 校验中心 Prometheus /api/v1/query 的 probe_success
// 解析：按 job → instance 建索引，success=1 / 0 正确映射，向量时间戳转为 At。
func TestPromProbeQuerierProbeSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"status":"success",
			"data":{"resultType":"vector","result":[
				{"metric":{"job":"http-probe","instance":"https://shop.example.com"},"value":[1726800000.0,"1"]},
				{"metric":{"job":"http-probe","instance":"https://pay.example.com"},"value":[1726800001.5,"0"]}
			]}
		}`))
	}))
	defer srv.Close()

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	q := NewPromProbeQuerier(u, srv.Client())
	index, err := q.ProbeSuccess(context.Background())
	if err != nil {
		t.Fatalf("ProbeSuccess: %v", err)
	}
	up, ok := index["http-probe"]["https://shop.example.com"]
	if !ok {
		t.Fatal("缺 shop 样本")
	}
	if !up.Success || !up.At.Equal(time.Unix(1726800000, 0)) {
		t.Fatalf("shop sample = %+v", up)
	}
	down, ok := index["http-probe"]["https://pay.example.com"]
	if !ok {
		t.Fatal("缺 pay 样本")
	}
	if down.Success {
		t.Fatal("pay 应为失败")
	}
}

// TestPromProbeQuerierNilBase 未配置 BaseURL 时返回 nil 查询器（视为不启用），避免 panic。
func TestPromProbeQuerierNilBase(t *testing.T) {
	if got := NewPromProbeQuerier(nil, nil); got != nil {
		t.Fatalf("nil baseURL should yield nil querier, got %+v", got)
	}
}