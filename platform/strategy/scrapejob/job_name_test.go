package scrapejob

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCreateScrapeJobAllowsChineseName：中文 Job 名可直接保存（targets 文件名即「主机监控.json」）。
func TestCreateScrapeJobAllowsChineseName(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	body := `{"job_name":"主机监控","job_type":"standard","draft_status":"draft","enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "主机监控", out.Data.JobName)
}

// TestCreateScrapeJobRejectsInvalidName：无法作为文件名的字符在保存入口直接拦截。
func TestCreateScrapeJobRejectsInvalidName(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	cases := []string{"a/b", "a:b", "主机 监控"}
	for _, name := range cases {
		body := `{"job_name":"` + name + `","job_type":"standard","draft_status":"draft","enabled":true}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		assert.Equal(t, http.StatusBadRequest, w.Code, "name=%q", name)
		assert.Contains(t, w.Body.String(), "job_name", "name=%q", name)
	}
}

// TestCreateScrapeJobNameUniqueCaseInsensitive：Host / host 视为同名，
// 避免 Windows 文件系统下落到同一个 targets 文件。
func TestCreateScrapeJobNameUniqueCaseInsensitive(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	body := `{"job_name":"Host-Job","job_type":"standard","draft_status":"draft","enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	body = `{"job_name":"host-job","job_type":"standard","draft_status":"draft","enabled":true}`
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusConflict, w.Code, "大小写不同的同名 Job 应冲突")
}

// TestResolveJobNameConflictSoftDeleted：同名软删残留应被物理清理并允许重建。
func TestResolveJobNameConflictSoftDeleted(t *testing.T) {
	db := openTestDB(t)
	job := models.ScrapeJob{
		JobName: "soft-job", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone,
	}
	require.NoError(t, db.Create(&job).Error)

	// 存活同名 → 占用。
	taken, err := resolveJobNameConflict(db, "soft-job", 0)
	require.NoError(t, err)
	assert.True(t, taken)

	// 排除自身（改名场景）→ 不占用。
	taken, err = resolveJobNameConflict(db, "soft-job", job.ID)
	require.NoError(t, err)
	assert.False(t, taken)

	// 软删后 → 清理残留并允许重建。
	require.NoError(t, db.Delete(&job).Error)
	taken, err = resolveJobNameConflict(db, "soft-job", 0)
	require.NoError(t, err)
	assert.False(t, taken)

	var count int64
	require.NoError(t, db.Unscoped().Model(&models.ScrapeJob{}).
		Where("job_name = ?", "soft-job").Count(&count).Error)
	assert.Equal(t, int64(0), count, "软删残留应被物理清理")
}
