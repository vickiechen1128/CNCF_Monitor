package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func metricsPathOf(t *testing.T, db *gorm.DB, id uint) string {
	t.Helper()
	var job models.ScrapeJob
	require.NoError(t, db.First(&job, id).Error)
	return job.MetricsPath
}

// TestRunScrapeJobMetricsPathBackfillTrimsDirtyPath 覆盖存量脏数据修正：
// 保存链路早期只判空不写回，" /actuator/prometheus" 原样落库 → vmagent 生成带前导
// 空格的抓取路径 → 目标应用 404 → 中心 up=0 且无业务样本。Run 需 trim 对齐。
func TestRunScrapeJobMetricsPathBackfillTrimsDirtyPath(t *testing.T) {
	db := newTestDB(t)

	// 线上复现的脏数据：前导空格。
	dirty := &models.ScrapeJob{
		JobName: "test-app-01", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeApplication,
		MonitorType: models.MonitorTypeApplicationHTTP, NetworkDomainID: "default",
		MetricsPath: " /actuator/prometheus", DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	require.NoError(t, db.Create(dirty).Error)
	// 首尾均有空白。
	both := &models.ScrapeJob{
		JobName: "both-space", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default",
		MetricsPath: "  /metrics  ", DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	require.NoError(t, db.Create(both).Error)
	// 已对齐的记录：回填不应改动。
	clean := &models.ScrapeJob{
		JobName: "clean", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default",
		MetricsPath: "/metrics", DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	require.NoError(t, db.Create(clean).Error)
	// 留空（=继承下层默认，F-28）：必须保持空串，不得被回填成默认值。
	inherit := &models.ScrapeJob{
		JobName: "inherit", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default",
		MetricsPath: "", DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	require.NoError(t, db.Create(inherit).Error)

	require.NoError(t, runScrapeJobMetricsPathBackfill(db))

	assert.Equal(t, "/actuator/prometheus", metricsPathOf(t, db, dirty.ID), "前导空格应被 trim")
	assert.Equal(t, "/metrics", metricsPathOf(t, db, both.ID), "首尾空格应被 trim")
	assert.Equal(t, "/metrics", metricsPathOf(t, db, clean.ID), "已对齐记录保持不变")
	assert.Equal(t, "", metricsPathOf(t, db, inherit.ID), "留空仍为空（不破坏 F-28 继承语义）")

	// 幂等：重复执行不改变结果、不报错。
	require.NoError(t, runScrapeJobMetricsPathBackfill(db))
	assert.Equal(t, "/actuator/prometheus", metricsPathOf(t, db, dirty.ID))
}

// TestRunScrapeJobMetricsPathBackfillHandlesPureWhitespace 保证纯空白路径回填为空串
// 而非报错：空串 ≡ 留空，下次保存时由 resolveJobScrapeParams 按 F-28 解析。
func TestRunScrapeJobMetricsPathBackfillHandlesPureWhitespace(t *testing.T) {
	db := newTestDB(t)
	blank := &models.ScrapeJob{
		JobName: "blank", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default",
		MetricsPath: "   ", DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	require.NoError(t, db.Create(blank).Error)

	require.NoError(t, runScrapeJobMetricsPathBackfill(db))
	assert.Equal(t, "", metricsPathOf(t, db, blank.ID))
}