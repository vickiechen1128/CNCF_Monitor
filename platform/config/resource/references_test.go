package resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// referencesTestDBCounter 为每个测试生成唯一的内存 DB 名。
var referencesTestDBCounter int64

// openReferencesTestDB 打开逐测试的内存 SQLite，迁移 Host、NetworkDomain 与 ScrapeJob
// （引用反查需读 scrape_jobs.selected_instance_ids，见 references.go 说明）。
func openReferencesTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&referencesTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_ref_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.InterfaceService{},
		&models.NetworkDomain{},
		&models.ScrapeJob{},
	))
	return db
}

// refJob 构造一个引用给定实例列表的采集 Job（填齐 NOT NULL 列，供测试落库）。
func refJob(jobName, domain string, ids []string, enabled bool) models.ScrapeJob {
	return models.ScrapeJob{
		JobName:               jobName,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		MonitorType:           "host_linux",
		NetworkDomainID:       domain,
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   ids,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              "none",
		DraftStatus:           "ready",
		ChangeStatus:          "applied",
		Enabled:               enabled,
	}
}

// mountReferences 挂载创建 + 引用反查 handler 供测试（路由收口见 T07-18，此处仅测试挂载）。
func mountReferences(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v2/platform/resources", CreateResource(db, newBizStore(t), newAppStore(t), newPlatformStore(t), newAppPlatformStore(t)))
	r.GET("/api/v2/platform/resources/:resource_id/referenced-by", ListResourceReferences(db))
	return r
}

// refResponse 镜像引用反查接口的统一响应信封，data 为 {jobs, total}。
type refResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Jobs  []ResourceReferenceJob `json:"jobs"`
		Total int                    `json:"total"`
	} `json:"data"`
}

func doReferences(t *testing.T, r *gin.Engine, resourceID string) (*httptest.ResponseRecorder, refResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources/"+resourceID+"/referenced-by", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out refResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// TestListResourceReferences_Referenced 验证：返回引用该资源的 Job 名单，停用 Job
// 计入、引用其他资源的 Job 不计入、软删 Job 不计入。
func TestListResourceReferences_Referenced(t *testing.T) {
	db := openReferencesTestDB(t)
	r := mountReferences(t, db)
	rid := deleteCreate(t, r, hostBody())

	// 引用该资源（启用）
	jobA := refJob("job-a", "default", []string{rid}, true)
	require.NoError(t, db.Create(&jobA).Error)
	// 引用其他资源（不计入）
	jobB := refJob("job-b", "default", []string{"other"}, false)
	require.NoError(t, db.Create(&jobB).Error)
	// 软删的引用 Job（deleted_at 置位，不计入）
	soft := refJob("job-c", "default", []string{rid}, true)
	require.NoError(t, db.Create(&soft).Error)
	// 软删 job-c：gorm 原生软删置 deleted_at，handler 的 db.Find 自动排除（与 §6.6.3.1 同口径）
	require.NoError(t, db.Delete(&soft).Error)

	w, out := doReferences(t, r, rid)
	require.Equal(t, http.StatusOK, w.Code, "反查应成功：%s", out.Error)
	assert.Equal(t, "success", out.Status)
	require.Len(t, out.Data.Jobs, 1, "仅 job-a 应计入引用")
	assert.Equal(t, "job-a", out.Data.Jobs[0].JobName)
	assert.Equal(t, "default", out.Data.Jobs[0].NetworkDomainID)
	assert.True(t, out.Data.Jobs[0].Enabled)
	assert.Equal(t, 1, out.Data.Total)
}

// TestListResourceReferences_NoReference 验证：资源存在但无 Job 引用时返回空 jobs、total=0。
func TestListResourceReferences_NoReference(t *testing.T) {
	db := openReferencesTestDB(t)
	r := mountReferences(t, db)
	rid := deleteCreate(t, r, hostBody())
	jobX := refJob("job-x", "default", []string{"someone-else"}, true)
	require.NoError(t, db.Create(&jobX).Error)

	w, out := doReferences(t, r, rid)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", out.Status)
	assert.Empty(t, out.Data.Jobs)
	assert.Equal(t, 0, out.Data.Total)
}

// TestListResourceReferences_NotFound 验证：资源不存在/已软删 → not_found。
func TestListResourceReferences_NotFound(t *testing.T) {
	db := openReferencesTestDB(t)
	r := mountReferences(t, db)

	w, out := doReferences(t, r, "not-exist")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", out.ErrorType)
}
