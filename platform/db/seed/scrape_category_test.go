package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func resourceTypeOf(t *testing.T, db *gorm.DB, id uint) models.ResourceType {
	t.Helper()
	var job models.ScrapeJob
	require.NoError(t, db.First(&job, id).Error)
	return job.ResourceType
}

// 存量标准 Job 的空 resource_type 必须按 monitor_type 回填；blackbox 与未知类型
// 保持原样，且重复执行幂等。
func TestRunScrapeJobCategoryBackfill(t *testing.T) {
	db := newTestDB(t)

	host := &models.ScrapeJob{
		JobName: "legacy-host", JobType: models.JobTypeStandard, ResourceType: "",
		MonitorType: "host_linux", NetworkDomainID: "default",
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	mysql := &models.ScrapeJob{
		JobName: "legacy-mysql", JobType: models.JobTypeStandard, ResourceType: "",
		MonitorType: "mysql", NetworkDomainID: "default",
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	blackbox := &models.ScrapeJob{
		JobName: "legacy-blackbox", JobType: models.JobTypeBlackbox,
		ResourceType: models.ResourceTypeInterfaceService, NetworkDomainID: "default",
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	unknown := &models.ScrapeJob{
		JobName: "legacy-unknown", JobType: models.JobTypeStandard, ResourceType: "",
		MonitorType: "future_type", NetworkDomainID: "default",
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}
	for _, job := range []*models.ScrapeJob{host, mysql, blackbox, unknown} {
		require.NoError(t, db.Create(job).Error)
	}

	require.NoError(t, runScrapeJobCategoryBackfill(db))

	assert.Equal(t, models.ResourceTypeHost, resourceTypeOf(t, db, host.ID))
	assert.Equal(t, models.ResourceTypeDatabase, resourceTypeOf(t, db, mysql.ID))
	assert.Equal(t, models.ResourceTypeInterfaceService, resourceTypeOf(t, db, blackbox.ID), "blackbox 不应被改动")
	assert.Equal(t, models.ResourceType(""), resourceTypeOf(t, db, unknown.ID), "未知 monitor_type 保持原样")

	// 幂等：重复执行不改变结果、不报错。
	require.NoError(t, runScrapeJobCategoryBackfill(db))
	assert.Equal(t, models.ResourceTypeHost, resourceTypeOf(t, db, host.ID))
}
