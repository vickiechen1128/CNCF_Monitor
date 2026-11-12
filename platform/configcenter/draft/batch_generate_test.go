package draft

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBatchGenerateDraftsCreatesPendingDraft：批量动作只生成待确认变更单，不确认下发。
func TestBatchGenerateDraftsCreatesPendingDraft(t *testing.T) {
	stubValidationTools(t)
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "bd-gen", true)
	seedHost(t, db, "bd-gen", "res-1")
	job := seedJob(t, db, "bd-gen", "job-gen")

	results, err := BatchGenerateDrafts(db, []uint{job.ID})
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "bd-gen", results[0].NetworkDomainID)
	assert.Equal(t, BatchGenerateStatusGenerated, results[0].Status)
	assert.NotEmpty(t, results[0].ChangeNo)
	assert.Equal(t, string(models.ValidationStatusPassed), results[0].ValidationStatus)

	// 变更单必须是 pending，等待人工确认。
	var d models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", results[0].ChangeNo).First(&d).Error)
	assert.Equal(t, models.DraftStatusPending, d.Status)
	assert.Equal(t, string(models.ValidationStatusPassed), d.ValidationStatus)

	// 不得生成配置版本 / 下发记录。
	var versions, deployments int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).Count(&versions).Error)
	require.NoError(t, db.Model(&models.ConfigDeployment{}).Count(&deployments).Error)
	assert.Equal(t, int64(0), versions, "批量生成不得自动确认下发")
	assert.Equal(t, int64(0), deployments, "批量生成不得自动确认下发")

	// 再点一次：同 checksum 的活 pending 幂等复用，不重复生成。
	results2, err := BatchGenerateDrafts(db, []uint{job.ID})
	require.NoError(t, err)
	require.Len(t, results2, 1)
	assert.Equal(t, BatchGenerateStatusGenerated, results2[0].Status)
	assert.Equal(t, results[0].ChangeNo, results2[0].ChangeNo, "同 checksum 应复用既有 pending 单")
}

// TestBatchGenerateDraftsForceBypassesNoChangesSuppression：人工确认后源数据无变化，
// 再次批量生成仍应产出一张「无变更项」的待确认草稿（不直接下发）。
func TestBatchGenerateDraftsForceBypassesNoChangesSuppression(t *testing.T) {
	stubValidationTools(t)
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "bd-force", true)
	seedHost(t, db, "bd-force", "res-1")
	job := seedJob(t, db, "bd-force", "job-force")

	first, err := BatchGenerateDrafts(db, []uint{job.ID})
	require.NoError(t, err)
	require.Len(t, first, 1)

	// 模拟用户在「配置变更确认」页手动确认下发。
	_, err = ConfirmDraft(db, first[0].ChangeNo, "admin")
	require.NoError(t, err)

	// 普通生成会被空跑抑制。
	_, err = GenerateDraft(db, "bd-force")
	require.ErrorIs(t, err, ErrNoChanges)

	// 批量生成走强制模式：仍产出待确认草稿，且不自动下发。
	second, err := BatchGenerateDrafts(db, []uint{job.ID})
	require.NoError(t, err)
	require.Len(t, second, 1)
	assert.Equal(t, BatchGenerateStatusGenerated, second[0].Status)
	assert.NotEmpty(t, second[0].ChangeNo)
	assert.NotEqual(t, first[0].ChangeNo, second[0].ChangeNo)

	var forced models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", second[0].ChangeNo).First(&forced).Error)
	assert.Equal(t, models.DraftStatusPending, forced.Status, "强制生成后仍需人工确认")
	assert.Contains(t, forced.Summary, "强制重新生成")
	var items []models.ConfigChangeItem
	require.NoError(t, json.Unmarshal([]byte(forced.ChangeItems), &items))
	assert.Empty(t, items)

	// 版本仍只有手动确认产生的那一个。
	var versions int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).Count(&versions).Error)
	assert.Equal(t, int64(1), versions)
}

// 校验未通过时仍生成变更单（供用户在 M09 处理），但不产生版本。
func TestBatchGenerateDraftsValidationNotPassed(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "bd-pending", true)
	seedHost(t, db, "bd-pending", "res-1")
	job := seedJob(t, db, "bd-pending", "job-pending")

	results, err := BatchGenerateDrafts(db, []uint{job.ID})
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, BatchGenerateStatusGenerated, results[0].Status)
	assert.NotEmpty(t, results[0].ChangeNo, "应保留变更单供 M09 页面处理")
	assert.Equal(t, string(models.ValidationStatusPending), results[0].ValidationStatus)

	var count int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).
		Where("network_domain_id = ?", "bd-pending").Count(&count).Error)
	assert.Equal(t, int64(0), count)
}

// 多个网域一次提交：按网域去重、逐域返回结果。
func TestBatchGenerateDraftsMultipleDomains(t *testing.T) {
	stubValidationTools(t)
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "bd-a", true)
	seedMonitoredDomain(t, db, "bd-b", true)
	seedHost(t, db, "bd-a", "res-1")
	seedHostWithIP(t, db, "bd-b", "res-b", "10.0.0.2")
	jobA := seedJob(t, db, "bd-a", "job-a")
	jobB := seedJobWithInstances(t, db, "bd-b", "job-b", []string{"res-b"})

	results, err := BatchGenerateDrafts(db, []uint{jobA.ID, jobB.ID, jobA.ID})
	require.NoError(t, err)
	require.Len(t, results, 2)
	assert.Equal(t, "bd-a", results[0].NetworkDomainID)
	assert.Equal(t, "bd-b", results[1].NetworkDomainID)
	assert.Equal(t, BatchGenerateStatusGenerated, results[0].Status)
	assert.Equal(t, BatchGenerateStatusGenerated, results[1].Status)
}

func TestBatchGenerateDraftsRejectsNoJobs(t *testing.T) {
	db := newMemDB(t)
	_, err := BatchGenerateDrafts(db, nil)
	require.Error(t, err)

	_, err = BatchGenerateDrafts(db, []uint{9999})
	require.Error(t, err)
}

func TestBatchGenerateHandler(t *testing.T) {
	stubValidationTools(t)
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "bd-h", true)
	seedHost(t, db, "bd-h", "res-1")
	job := seedJob(t, db, "bd-h", "job-h")

	r := newGin()
	g := r.Group("/api/v2/platform")
	g.Use(adminInjector())
	RegisterRoutes(g, db)

	w := perform(t, r, http.MethodPost, "/api/v2/platform/config/drafts/batch-generate",
		fmt.Sprintf(`{"job_ids":[%d]}`, job.ID))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	data := unmarshalData(t, w)
	results, ok := data["results"].([]interface{})
	require.True(t, ok)
	require.Len(t, results, 1)
	item := results[0].(map[string]interface{})
	assert.Equal(t, "bd-h", item["network_domain_id"])
	assert.Equal(t, BatchGenerateStatusGenerated, item["status"])

	var pending int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ? AND status = ?", "bd-h", models.DraftStatusPending).Count(&pending).Error)
	assert.Equal(t, int64(1), pending)
}
