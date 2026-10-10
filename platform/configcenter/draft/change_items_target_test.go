package draft

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 本文件覆盖 M09 变更清单的 target 级派生（补齐「只到 Job 级」的缺口）：
// 用户软删主机导致采集 target 收缩时，变更单必须直接报告「移除了哪几个采集目标」。

// seedHostWithIP 造一台指定 IP 的主机（既有 seedHost 固定 10.0.0.1，多 target 场景
// 需要不同地址才能在targets 快照里区分实例）。
func seedHostWithIP(t *testing.T, db *gorm.DB, domainID, resourceID, ip string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       resourceID,
		ServerID:         "srv-" + resourceID,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domainID,
		BizCode:          "biz",
		PrivateIP:        ip,
		InstanceName:     "host-" + resourceID,
		Status:           "online",
		Region:           "cn-east",
		ZoneEnv:          "prod",
		InstanceSpec:     "4c8g",
		Image:            "Ubuntu",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		SourceType:       models.SourceTypeManual,
	}).Error)
}

// seedJobWithInstances 造一个手工选实例的 standard Job，选定给定 resource_id 列表。
func seedJobWithInstances(t *testing.T, db *gorm.DB, domainID, name string, instanceIDs []string) *models.ScrapeJob {
	t.Helper()
	job := &models.ScrapeJob{
		JobName:               name,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       domainID,
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   instanceIDs,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		Enabled:               true,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusPending,
	}
	require.NoError(t, db.Create(job).Error)
	return job
}

// confirmBaseline 生成首版草稿并确认，形成「上一已确认 ConfigVersion」基线
// （变更清单的派生基线，见 service.go lastConfirmedVersion）。
func confirmBaseline(t *testing.T, db *gorm.DB, domainID string) {
	t.Helper()
	d, err := GenerateDraft(db, domainID)
	require.NoError(t, err)
	require.NoError(t, db.Model(d).Update("validation_status", string(models.ValidationStatusPassed)).Error)
	_, err = ConfirmDraft(db, d.ChangeNo, "admin")
	require.NoError(t, err)
}

func itemsOf(t *testing.T, d *models.ConfigDraft) []models.ConfigChangeItem {
	t.Helper()
	var items []models.ConfigChangeItem
	require.NoError(t, json.Unmarshal([]byte(d.ChangeItems), &items))
	return items
}

// itemsByTarget 过滤出某一变更对象的变更项。
func itemsByTarget(items []models.ConfigChangeItem, target string) []models.ConfigChangeItem {
	out := make([]models.ConfigChangeItem, 0)
	for _, it := range items {
		if it.Target == target {
			out = append(out, it)
		}
	}
	return out
}

// TestTargetLevelItemsOnHostSoftDelete 覆盖核心场景：用户软删 3 台主机 → 采集 target
// 从 32 台收缩到 29 台，变更清单必须出现 target 级「移除」项，且 summary 体现之。
//
// 修复前：change_items 只有 Job 级 update（且仅当 Job 自身字段变化时才出现），
// 「移除 3 个采集目标」这件事在变更单里完全不可见。
func TestTargetLevelItemsOnHostSoftDelete(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-shrink", true)

	ids := []string{"res-1", "res-2", "res-3", "res-4", "res-5"}
	for i, id := range ids {
		seedHostWithIP(t, db, "edge-shrink", id, "10.0.0."+string(rune('1'+i)))
	}
	seedJobWithInstances(t, db, "edge-shrink", "job1", ids)

	// 首版确认 → 基线含 5 个 target。
	confirmBaseline(t, db, "edge-shrink")

	// 用户软删 3 台主机（GORM 默认软删：deleted_at 置位，查询自动排除）。
	require.NoError(t, db.Where("resource_id IN ?", []string{"res-1", "res-2", "res-3"}).
		Delete(&models.Host{}).Error)

	d, err := GenerateDraft(db, "edge-shrink")
	require.NoError(t, err)

	targetItems := itemsByTarget(itemsOf(t, d), string(models.ChangeItemTargetTargetInstance))
	require.Len(t, targetItems, 3, "被软删的3 台主机应各产生一条 target 级移除项")

	for _, it := range targetItems {
		assert.Equal(t, string(models.ChangeItemTypeDelete), it.Type)
		assert.Equal(t, string(models.RiskHigh), it.Risk, "移除 target = 监控断点，与移除 Job 同级 high")
		assert.Contains(t, it.Description, "移除采集目标")
		assert.Contains(t, it.Description, "job1")
		assert.Contains(t, it.AffectedFiles, string(models.AffectedFileTargets))
	}

	// 移除项文案带生成侧归因（资源已删除），用户不只知道少了 3 台，还知道原因。
	assert.Contains(t, targetItems[0].Description, "资源已删除")

	// summary 体现 target 级收缩（既有中文表述风格：本次配置变更：…）。
	assert.Contains(t, d.Summary, "本次配置变更：")
	assert.Contains(t, d.Summary, "移除采集目标 3 个")
	assert.Contains(t, d.Summary, "（高风险）", "delete 类变更项沿用既有高风险标注口径")

	// 产物确实收缩到 2 台（res-4 / res-5）：TargetsFiles 为 JSON 编码的map，先解码再断言。
	var targetsFiles map[string]string
	require.NoError(t, json.Unmarshal([]byte(d.TargetsFiles), &targetsFiles))
	assert.NotContains(t, targetsFiles["job1.json"], "10.0.0.1")
	assert.NotContains(t, targetsFiles["job1.json"], "10.0.0.2")
	assert.NotContains(t, targetsFiles["job1.json"], "10.0.0.3")
	assert.Contains(t, targetsFiles["job1.json"], "10.0.0.4")
	assert.Contains(t, targetsFiles["job1.json"], "10.0.0.5")
}

// TestTargetLevelItemsOnHostAdd 验证方案 (b) 快照 diff 对**新增**侧的覆盖能力：
// 给已生效 Job 新增 2 台主机 → 出现 target 级「新增」项（低风险）。
//
// 这是选快照 diff 而非只用 skipped 的关键收益：skipped 只在「未进产物」时非空，
// 结构上无法表达新增。
func TestTargetLevelItemsOnHostAdd(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-grow", true)
	seedHostWithIP(t, db, "edge-grow", "res-1", "10.0.0.1")
	seedHostWithIP(t, db, "edge-grow", "res-2", "10.0.0.2")
	seedJobWithInstances(t, db, "edge-grow", "job1", []string{"res-1"})
	confirmBaseline(t, db, "edge-grow")

	// 新增两台主机并纳入 Job 选实例（selected_instance_ids 为 json serializer 列）。
	seedHostWithIP(t, db, "edge-grow", "res-3", "10.0.0.3")
	seedHostWithIP(t, db, "edge-grow", "res-4", "10.0.0.4")
	require.NoError(t, db.Model(&models.ScrapeJob{}).Where("job_name = ?", "job1").
		Update("selected_instance_ids", `["res-1","res-3","res-4"]`).Error)

	d, err := GenerateDraft(db, "edge-grow")
	require.NoError(t, err)

	targetItems := itemsByTarget(itemsOf(t, d), string(models.ChangeItemTargetTargetInstance))
	require.Len(t, targetItems, 2, "新增的 2 台主机应各产生一条 target 级新增项")

	var descs []string
	for _, it := range targetItems {
		assert.Equal(t, string(models.ChangeItemTypeAdd), it.Type)
		assert.Equal(t, string(models.RiskLow), it.Risk, "新增 target = low，同 Job 级新增口径")
		assert.Contains(t, it.Description, "新增采集目标")
		assert.Contains(t, it.AffectedFiles, string(models.AffectedFileTargets))
		descs = append(descs, it.Description)
	}
	assert.Contains(t, d.Summary, "新增采集目标 2 个")
}

// TestTargetLevelItemsAbsentWhenNothingChanged 是**最危险的回归护栏**：真正无任何变化
// 时必须仍返回 ErrNoChanges。
//
// 这条护栏防的是「拿 skipped 当变更事实来源」的错解：只要网域里存在一台长期offline
// 的实例，skipped 每次生成都非空，若据此派生变更项，则「源数据无变化」也会恒有变更项，
// 决策 44-3 的空跑抑制被彻底废掉、每次点生成都产出一张噪声变更单。
// 本测试用两台主机、其中一台 offline 覆盖该场景。
func TestTargetLevelItemsAbsentWhenNothingChanged(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-noop", true)
	seedHostWithIP(t, db, "edge-noop", "res-1", "10.0.0.1")
	seedHostWithIP(t, db, "edge-noop", "res-2", "10.0.0.2")
	seedJobWithInstances(t, db, "edge-noop", "job1", []string{"res-1", "res-2"})
	confirmBaseline(t, db, "edge-noop")

	// 一台主机下线（ResolveJobTargets 记 skipped/offline），但**基线产物里本来就没有它**
	// —— 基线是在它下线前确认的，所以这里必须显式重confirm 才能构造「skipped 非空但
	// 产物未变」的场景。先下线再重新确认基线，再验证无变化时空跑抑制仍生效。
	require.NoError(t, db.Model(&models.Host{}).Where("resource_id = ?", "res-2").
		Update("status", "offline").Error)
	confirmBaseline(t, db, "edge-noop")

	// 此时源数据未再变动：skipped 仍含 res-2（offline），但产物与基线一致。
	_, err := GenerateDraft(db, "edge-noop")
	assert.ErrorIs(t, err, ErrNoChanges,
		"长期 offline 实例不得让变更清单恒有内容，否则空跑抑制失效")
}

// TestTargetLevelItemsSkipIPChangeAsUpdate 验证换IP 被记为 target 级 update（低风险）
// 而非「一删一增」—— 否则一次改地址会被误报成「移除 1 个采集目标（high，监控断点）」。
func TestTargetLevelItemsSkipIPChangeAsUpdate(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-ip", true)
	seedHostWithIP(t, db, "edge-ip", "res-1", "10.0.0.1")
	seedJobWithInstances(t, db, "edge-ip", "job1", []string{"res-1"})
	confirmBaseline(t, db, "edge-ip")

	require.NoError(t, db.Model(&models.Host{}).Where("resource_id = ?", "res-1").
		Update("private_ip", "10.0.0.99").Error)

	d, err := GenerateDraft(db, "edge-ip")
	require.NoError(t, err)

	targetItems := itemsByTarget(itemsOf(t, d), string(models.ChangeItemTargetTargetInstance))
	require.Len(t, targetItems, 1)
	assert.Equal(t, string(models.ChangeItemTypeUpdate), targetItems[0].Type)
	assert.Equal(t, string(models.RiskLow), targetItems[0].Risk)
	assert.Contains(t, targetItems[0].Description, "变更采集目标 10.0.0.99")

	// 换IP 不应产生任何 high风险项（监控并未断点）。
	assert.False(t, highRisk(itemsOf(t, d)), "换 IP 不构成监控断点，不应产出 high 风险项")
}

// TestTargetLevelItemsNotDoubleCountNewJob 验证新增 Job 的 targets 不被 target 级
// 重复计账（其全量新增已由 Job 级「新增采集 Job」表达）。
func TestTargetLevelItemsNotDoubleCountNewJob(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-newjob", true)
	seedHostWithIP(t, db, "edge-newjob", "res-1", "10.0.0.1")
	seedJobWithInstances(t, db, "edge-newjob", "job1", []string{"res-1"})
	confirmBaseline(t, db, "edge-newjob")

	// 第二个 Job 全新加入，带 3 台主机。
	for i, id := range []string{"res-2", "res-3", "res-4"} {
		seedHostWithIP(t, db, "edge-newjob", id, "10.0.1."+string(rune('1'+i)))
	}
	seedJobWithInstances(t, db, "edge-newjob", "job2", []string{"res-2", "res-3", "res-4"})

	d, err := GenerateDraft(db, "edge-newjob")
	require.NoError(t, err)

	items := itemsOf(t, d)
	assert.Empty(t, itemsByTarget(items, string(models.ChangeItemTargetTargetInstance)),
		"新增 Job 的 target 不重复派生，全量新增已由 Job 级项表达")
	assert.Contains(t, d.Summary, "新增采集 Job 1 个")
}

// TestTargetLevelItemsNotDoubleCountRemovedJob 验证 Job 被禁用时，其 targets 的整体
// 移除不重复派生（已由 Job 级「移除采集 Job」表达，且该项本就 high）。
func TestTargetLevelItemsNotDoubleCountRemovedJob(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-deljob", true)
	seedHostWithIP(t, db, "edge-deljob", "res-1", "10.0.0.1")
	job := seedJobWithInstances(t, db, "edge-deljob", "job1", []string{"res-1"})
	confirmBaseline(t, db, "edge-deljob")

	require.NoError(t, db.Model(job).Update("enabled", false).Error)

	d, err := GenerateDraft(db, "edge-deljob")
	require.NoError(t, err)

	items := itemsOf(t, d)
	assert.Empty(t, itemsByTarget(items, string(models.ChangeItemTargetTargetInstance)),
		"Job 整体移除时不重复派生 target 级项")
	require.Len(t, itemsByTarget(items, string(models.ChangeItemTargetScrapeJob)), 1)
	assert.Contains(t, d.Summary, "移除采集 Job 1 个")
}

// TestExistingJobLevelItemsUnaffected 回归护栏：既有 Job 级 update/delete 派生行为不受
// target 级新项影响（Job 级项仍按原口径产生，target 级项只做叠加）。
func TestExistingJobLevelItemsUnaffected(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-joblevel", true)
	seedHostWithIP(t, db, "edge-joblevel", "res-1", "10.0.0.1")
	seedJobWithInstances(t, db, "edge-joblevel", "job1", []string{"res-1"})
	confirmBaseline(t, db, "edge-joblevel")

	// 仅改 Job 自身字段（metrics_path）→ Job 级 update，targets 不变 → 无 target 级项。
	require.NoError(t, db.Model(&models.ScrapeJob{}).Where("job_name = ?", "job1").
		Update("metrics_path", "/metrics/v2").Error)

	d, err := GenerateDraft(db, "edge-joblevel")
	require.NoError(t, err)

	items := itemsOf(t, d)
	jobItems := itemsByTarget(items, string(models.ChangeItemTargetScrapeJob))
	require.Len(t, jobItems, 1, "Job 级 update 行为不受影响")
	assert.Equal(t, string(models.ChangeItemTypeUpdate), jobItems[0].Type)
	assert.Equal(t, string(models.ChangeItemTargetScrapeJob), jobItems[0].Target)
	assert.Contains(t, jobItems[0].Description, "变更采集 Job job1")
	assert.Equal(t, string(models.RiskLow), jobItems[0].Risk)
	assert.Empty(t, itemsByTarget(items, string(models.ChangeItemTargetTargetInstance)),
		"targets 未变时不应产出 target 级项")
	assert.Contains(t, d.Summary, "变更采集 Job 1 个")
}

// TestTargetLevelItemsTolerateBrokenBaseSnapshot 验证基线 targets 快照损坏时退化为
// 「不派生 target 级项」，不因解析失败伪造增删计数（Job 级 update 仍覆盖该事实）。
func TestTargetLevelItemsTolerateBrokenBaseSnapshot(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-broken", true)
	seedHostWithIP(t, db, "edge-broken", "res-1", "10.0.0.1")
	seedJobWithInstances(t, db, "edge-broken", "job1", []string{"res-1"})
	confirmBaseline(t, db, "edge-broken")

	// 篡改基线产物：job1 的 targets 内容写成非法 JSON。
	require.NoError(t, db.Model(&models.ConfigVersion{}).Where("change_no LIKE ?", "CHG-%").
		Update("targets_files", `{"job1.json":"{not-json"}`).Error)

	// 改动 Job 使产物确实变化（否则本就应ErrNoChanges）。
	require.NoError(t, db.Model(&models.ScrapeJob{}).Where("job_name = ?", "job1").
		Update("metrics_path", "/metrics/v2").Error)

	d, err := GenerateDraft(db, "edge-broken")
	require.NoError(t, err)
	assert.Empty(t, itemsByTarget(itemsOf(t, d), string(models.ChangeItemTargetTargetInstance)),
		"基线快照解析失败时不得伪造 target 级增删项")
}

// TestBuildSummaryTargetLabel 覆盖 summary 聚合口径：target 级项按 target_instance
// 聚合成「采集目标 N 个」，与其余对象标签风格一致。
func TestBuildSummaryTargetLabel(t *testing.T) {
	label, unit := summaryTarget(string(models.ChangeItemTargetTargetInstance))
	assert.Equal(t, "采集目标", label)
	assert.Equal(t, "个", unit)

	items := []models.ConfigChangeItem{
		{Type: string(models.ChangeItemTypeDelete), Target: string(models.ChangeItemTargetTargetInstance)},
		{Type: string(models.ChangeItemTypeDelete), Target: string(models.ChangeItemTargetTargetInstance)},
		{Type: string(models.ChangeItemTypeAdd), Target: string(models.ChangeItemTargetTargetInstance)},
		{Type: string(models.ChangeItemTypeUpdate), Target: string(models.ChangeItemTargetScrapeJob)},
	}
	assert.Equal(t, "本次配置变更：移除采集目标 2 个（高风险）、新增采集目标 1 个、变更采集 Job 1 个",
		buildSummary(items))
}