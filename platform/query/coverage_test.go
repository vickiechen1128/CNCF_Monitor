package query

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var coverageTestDBCounter int64

// openCoverageTestDB 打开逐测试的内存 SQLite，迁移五类资源表与 ScrapeJob。
func openCoverageTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&coverageTestDBCounter, 1)
	dsn := fmt.Sprintf("file:coverage_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.ScrapeJob{},
	))
	return db
}

// seedCoverageHost 落一条 host fixture：ResourceID 与 ServerID 保持一致以共存多条。
func seedCoverageHost(t *testing.T, db *gorm.DB, id, domain, name string) {
	t.Helper()
	h := &models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domain,
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     name,
		Status:           "online",
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        "",
	}
	require.NoError(t, db.Create(h).Error)
}

// seedCoverageJob 落一个 ready+enabled 的采集 job，selected 为选中的实例。
func seedCoverageJob(t *testing.T, db *gorm.DB, jobName string, selected []string) {
	t.Helper()
	j := &models.ScrapeJob{
		JobName:               jobName,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       "default",
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   selected,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusConfirmed,
		Enabled:               true,
	}
	require.NoError(t, db.Create(j).Error)
}

// coverageUpFixture 构造 /api/v1/query?query=up 的 vector 响应。
//   - srv-1 → 1（up）
//   - srv-2 → 0（down，有样本）
//   - srv-3 无 series（无 up 样本）
func coverageUpFixture() map[string]interface{} {
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"resultType": "vector",
			"result": []map[string]interface{}{
				{"metric": map[string]string{"resource_id": "srv-1", "job": "job-a"}, "value": []interface{}{float64(1725000000), "1"}},
				{"metric": map[string]string{"resource_id": "srv-2", "job": "job-a"}, "value": []interface{}{float64(1725000000), "0"}},
			},
		},
	}
}

// coverageTargetsFixture 构造 /api/v1/targets 的 lastError 回填（srv-2 down）。
func coverageTargetsFixture() map[string]interface{} {
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"activeTargets": []map[string]interface{}{
				{
					"scrapePool": "job-a",
					"labels": map[string]interface{}{
						"job":         "job-a",
						"instance":    "10.0.0.2:9100",
						"resource_id": "srv-2",
					},
					"health":    "down",
					"lastError": "connection refused",
				},
			},
			"droppedTargets": []interface{}{},
			"targetsByJob":   map[string]interface{}{},
		},
	}
}

// newCoverageRouter 构造带 DB + fake 上游的 router（上游按路径分发 query/targets）。
func newCoverageRouter(t *testing.T, db *gorm.DB, up, targets map[string]interface{}) (*gin.Engine, *httptest.Server) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/query":
			fmt.Fprintln(w, mustJSON(up))
		case "/api/v1/targets":
			fmt.Fprintln(w, mustJSON(targets))
		default:
			http.NotFound(w, r)
		}
	}))
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)

	r := gin.New()
	r.GET("/api/v1/health/coverage", CoverageHandler(db, u, http.DefaultClient))
	return r, srv
}

// doCoverage 请求 coverage 并解码响应。
func doCoverage(t *testing.T, r *gin.Engine, query string) coverageResp {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health/coverage"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out coverageResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return out
}

// coverageResp 镜像 coverage 统一响应信封。
type coverageResp struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Items   []coverageItemJSON  `json:"items"`
		Total   int                 `json:"total"`
		Summary coverageSummaryJSON `json:"summary"`
	} `json:"data"`
}

type coverageItemJSON struct {
	ResourceID       string  `json:"resource_id"`
	ResourceCategory string  `json:"resource_category"`
	InstanceName     string  `json:"instance_name"`
	MonitorState     string  `json:"monitor_state"`
	Health           *string `json:"health"`
	LastError        string  `json:"last_error"`
}

type coverageSummaryJSON struct {
	Total        int     `json:"total"`
	Collecting   int     `json:"collecting"`
	PendingDown  int     `json:"pending_down"`
	NotMonitored int     `json:"not_monitored"`
	CoverageRate float64 `json:"coverage_rate"`
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// coverageFixture 搭建一个完整的 3 + 1 + 1 场景：srv-1/2/3 被选中（1 up、2 down、
// 3 无样本），srv-4 未选中，dmz-x 在另一网域未选中。
func setupCoverageScenario(t *testing.T) (*gin.Engine, *httptest.Server) {
	db := openCoverageTestDB(t)
	seedCoverageHost(t, db, "srv-1", "default", "host-1")
	seedCoverageHost(t, db, "srv-2", "default", "host-2")
	seedCoverageHost(t, db, "srv-3", "default", "host-3")
	seedCoverageHost(t, db, "srv-4", "default", "host-4")
	seedCoverageHost(t, db, "dmz-x", "dmz", "host-dmz")
	seedCoverageJob(t, db, "job-a", []string{"srv-1", "srv-2", "srv-3"})
	return newCoverageRouter(t, db, coverageUpFixture(), coverageTargetsFixture())
}

func TestCoverageTriState(t *testing.T) {
	r, srv := setupCoverageScenario(t)
	defer srv.Close()
	out := doCoverage(t, r, "")

	require.Equal(t, "success", out.Status)
	require.Equal(t, 5, out.Data.Total)

	byID := map[string]coverageItemJSON{}
	for _, it := range out.Data.Items {
		byID[it.ResourceID] = it
	}

	// srv-1：选中 + up → collecting。
	c1 := byID["srv-1"]
	require.Equal(t, StateCollecting, c1.MonitorState)
	require.Equal(t, "up", *c1.Health)
	require.Equal(t, "host", c1.ResourceCategory)

	// srv-2：选中 + down 有样本 → pending_down，health=down，last_error 回填。
	c2 := byID["srv-2"]
	require.Equal(t, StatePendingDown, c2.MonitorState)
	require.Equal(t, "down", *c2.Health)
	require.Equal(t, "connection refused", c2.LastError)

	// srv-3：选中 + 无 up 样本 → pending_down，health=unknown。
	c3 := byID["srv-3"]
	require.Equal(t, StatePendingDown, c3.MonitorState)
	require.Equal(t, "unknown", *c3.Health)

	// srv-4：未选中 → not_monitored，health=null。
	c4 := byID["srv-4"]
	require.Equal(t, StateNotMonitored, c4.MonitorState)
	require.Nil(t, c4.Health)

	// summary 与 coverage_rate：collecting=1, pending_down=2, not_monitored=2, total=5。
	s := out.Data.Summary
	require.Equal(t, 5, s.Total)
	require.Equal(t, 1, s.Collecting)
	require.Equal(t, 2, s.PendingDown)
	require.Equal(t, 2, s.NotMonitored)
	require.Equal(t, 1.0/5.0, s.CoverageRate)
}

func TestCoverageFilterNetworkDomain(t *testing.T) {
	r, srv := setupCoverageScenario(t)
	defer srv.Close()
	out := doCoverage(t, r, "?network_domain=dmz")
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.Items, 1)
	require.Equal(t, "dmz-x", out.Data.Items[0].ResourceID)
	require.Equal(t, StateNotMonitored, out.Data.Items[0].MonitorState)
}

func TestCoverageFilterResourceCategory(t *testing.T) {
	r, srv := setupCoverageScenario(t)
	defer srv.Close()
	out := doCoverage(t, r, "?resource_category=database")
	require.Equal(t, "success", out.Status)
	require.Empty(t, out.Data.Items) // 无 database 资源
	require.Equal(t, 0, out.Data.Total)
	require.Equal(t, 0.0, out.Data.Summary.CoverageRate)
}

func TestCoverageFilterState(t *testing.T) {
	r, srv := setupCoverageScenario(t)
	defer srv.Close()
	out := doCoverage(t, r, "?state=collecting")
	require.Len(t, out.Data.Items, 1)
	require.Equal(t, "srv-1", out.Data.Items[0].ResourceID)
	require.Equal(t, 1, out.Data.Total)
	require.Equal(t, 1, out.Data.Summary.Collecting)
}

func TestCoveragePagination(t *testing.T) {
	r, srv := setupCoverageScenario(t)
	defer srv.Close()
	// page=1&page_size=2 → 前 2 条（按 resource_id 排序：dmz-x, srv-1）。
	out := doCoverage(t, r, "?page=1&page_size=2")
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.Items, 2)
	require.Equal(t, 5, out.Data.Total) // total 为全量过滤后计数
	require.Equal(t, "dmz-x", out.Data.Items[0].ResourceID)
	require.Equal(t, "srv-1", out.Data.Items[1].ResourceID)

	// page=3&page_size=2 → 最后 1 条。
	out2 := doCoverage(t, r, "?page=3&page_size=2")
	require.Len(t, out2.Data.Items, 1)
	require.Equal(t, "srv-4", out2.Data.Items[0].ResourceID)
}

func TestCoveragePageSizeCap(t *testing.T) {
	// page_size 上限 maxCoveragePageSize=1000 钳制。本场景仅 5 个资源（不足上限），
	// 传 2000 也被钳到 1000，故全部返回；精确钳制边界见 TestParseCoveragePageCap。
	r, srv := setupCoverageScenario(t)
	defer srv.Close()
	out := doCoverage(t, r, "?page_size=2000")
	require.Equal(t, 5, len(out.Data.Items))
	require.Equal(t, 5, out.Data.Total)
}

func TestParseCoveragePageCap(t *testing.T) {
	// review-fix F1：对 page_size 钳制上限做精确断言（避免仅依赖元素不足而掩盖钳制逻辑）。
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health/coverage?page_size=1500", nil)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	_, size := parseCoveragePage(c)
	require.Equal(t, maxCoveragePageSize, size, "page_size=1500 应钳制到上限 1000")
}

func TestCoverageEmptyResources(t *testing.T) {
	db := openCoverageTestDB(t)
	r, srv := newCoverageRouter(t, db, coverageUpFixture(), coverageTargetsFixture())
	defer srv.Close()
	out := doCoverage(t, r, "")
	require.Equal(t, "success", out.Status)
	require.Empty(t, out.Data.Items) // [] 而非 null
	require.Equal(t, 0, out.Data.Total)
	require.Equal(t, 0, out.Data.Summary.Total)
	require.Equal(t, 0, out.Data.Summary.Collecting)
	require.Equal(t, 0, out.Data.Summary.PendingDown)
	require.Equal(t, 0, out.Data.Summary.NotMonitored)
	require.Equal(t, 0.0, out.Data.Summary.CoverageRate)
}

func TestCoverageNoUpAggDependency(t *testing.T) {
	// 上游 query 不可达（points 到已关闭 server）→ 应 internal 而非 panic。
	db := openCoverageTestDB(t)
	seedCoverageHost(t, db, "srv-1", "default", "host-1")
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		http.Error(httptest.NewRecorder(), "boom", 500)
	}))
	u, _ := url.Parse(srv.URL)
	srv.Close() // 立即关闭，令上游不可达
	r := gin.New()
	r.GET("/api/v1/health/coverage", CoverageHandler(db, u, http.DefaultClient))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health/coverage", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out coverageResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, "error", out.Status)
	require.Equal(t, "internal", out.ErrorType)
}