package dashboard

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeUpHealthQuerier 是 UpHealthQuerier 的测试替身（反馈 10）。
type fakeUpHealthQuerier struct {
	idx *UpHealthIndex
	err error
}

func (f *fakeUpHealthQuerier) UpHealth(context.Context) (*UpHealthIndex, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.idx, nil
}

// TestClassifyCollectionHealthTwoStates 覆盖两态互斥完备分类（反馈 12，与监控对象页
// coverage 同口径）：5min 内 up==1 → 采集中；其余（up==0 / 待首抓 / 回传延迟）→ 已下发未采到。
func TestClassifyCollectionHealthTwoStates(t *testing.T) {
	idx := &UpHealthIndex{
		upNow:  map[string]bool{"collecting": true, "down": true},
		upTrue: map[string]bool{"collecting": true},
	}
	got := classifyCollectionHealth([]string{"collecting", "down", "stale", "pending"}, idx)
	require.NotNil(t, got)
	assert.Equal(t, CollectionHealth{
		DispatchedCount: 4,
		CollectingCount: 1,
		DownCount:       3,
	}, *got)
	// 不变量：两态之和 == 已下发数。
	assert.Equal(t, got.DispatchedCount, got.CollectingCount+got.DownCount)
}

// TestClassifyCollectionHealthNilIndex 未注入 / 查询失败（nil 索引）时返回 nil，不误报 0。
func TestClassifyCollectionHealthNilIndex(t *testing.T) {
	assert.Nil(t, classifyCollectionHealth([]string{"a", "b"}, nil))
}

// TestSummaryCollectionHealth 注入 up 健康查询器后，collection_health 分母对齐 monitored_count，
// 且两态度量正确（反馈 12：无 up==1 样本一律归「已下发未采到」）。
func TestSummaryCollectionHealth(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	// seed 中 ready+enabled Job 覆盖 9 个资源：标准 Job 6 个（res-host-1/2、res-db-1、
	// res-mw-1、res-app-1、res-gt-1）+ 拨测资源模式 3 个接口服务（res-is-1/2/3，H9）。
	// 构造：2 采集中 + 7 已下发未采到（含 up==0 / 无样本 / 回传延迟）。
	idx := &UpHealthIndex{
		upNow:  map[string]bool{"res-host-1": true, "res-host-2": true, "res-db-1": true},
		upTrue: map[string]bool{"res-host-1": true, "res-host-2": true},
	}
	s, err := Build(db, WithUpHealthQuerier(&fakeUpHealthQuerier{idx: idx}))
	require.NoError(t, err)
	require.NotNil(t, s.CollectionHealth)

	assert.Equal(t, 9, s.MonitoredCount)
	assert.Equal(t, 9, s.CollectionHealth.DispatchedCount, "分母 = 已下发资源数")
	assert.Equal(t, 2, s.CollectionHealth.CollectingCount)
	assert.Equal(t, 7, s.CollectionHealth.DownCount, "up==0 / 无样本 / 回传延迟统一归「已下发未采到」")
}

// TestSummaryCollectionHealthDegradesOnError 查询失败时聚合接口不失败，collection_health 留空
// （前端按不可用呈现，绝不误报 0）。
func TestSummaryCollectionHealthDegradesOnError(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	s, err := Build(db, WithUpHealthQuerier(&fakeUpHealthQuerier{err: errors.New("prometheus unreachable")}))
	require.NoError(t, err)
	assert.Nil(t, s.CollectionHealth)
	// 其余聚合不受影响（含拨测资源模式的 3 个接口服务）。
	assert.Equal(t, 9, s.MonitoredCount)
}

// TestSummaryCollectionHealthOmittedWhenNotInjected 未注入 querier 时 collection_health 留空
// （向后兼容既有调用方）。
func TestSummaryCollectionHealthOmittedWhenNotInjected(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	s, err := Build(db)
	require.NoError(t, err)
	assert.Nil(t, s.CollectionHealth)
}

// TestPromUpHealthQuerierUpHealth 校验中心 Prometheus 单段查询解析：
// `up` 归集 5min 实时态（存在 / ==1）；无 resource_id 标签的 series 不计入。
func TestPromUpHealthQuerierUpHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		assert.Equal(t, upInstantQuery, r.URL.Query().Get("query"))
		w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[
			{"metric":{"resource_id":"r-up","job":"j"},"value":[1726800000.0,"1"]},
			{"metric":{"resource_id":"r-down","job":"j"},"value":[1726800000.0,"0"]},
			{"metric":{"instance":"no-resource-id"},"value":[1726800000.0,"1"]}
		]}}`))
	}))
	defer srv.Close()

	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	q := NewPromUpHealthQuerier(u, srv.Client())
	idx, err := q.UpHealth(context.Background())
	require.NoError(t, err)
	require.NotNil(t, idx)

	assert.True(t, idx.upNow["r-up"])
	assert.True(t, idx.upTrue["r-up"])
	assert.True(t, idx.upNow["r-down"])
	assert.False(t, idx.upTrue["r-down"])
	assert.False(t, idx.upNow["r-stale"], "5min 内无 up 样本 → 不在实时态")
	assert.False(t, idx.upNow["no-resource-id"], "无 resource_id 标签的 series 不计入")
}

// TestPromUpHealthQuerierNilBase 未配置 BaseURL 时返回 nil 查询器（视为不启用），避免 panic。
func TestPromUpHealthQuerierNilBase(t *testing.T) {
	assert.Nil(t, NewPromUpHealthQuerier(nil, nil))
}