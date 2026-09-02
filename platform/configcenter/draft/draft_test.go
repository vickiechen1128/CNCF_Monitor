package draft

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

// newMemDB opens a per-test in-memory SQLite DB migrated with all config-center
// source + output tables (so generator.Load*/SourceDataVersion can query them).
func newMemDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:draft_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ScrapeJob{},
		&models.MonitoringRule{},
		&models.LabelTemplate{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.CITypeExporterMapping{},
		&models.ExporterInstallationConfirmation{},
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
		&models.AlertmanagerConfigVersion{},
	))
	return db
}

// seedMonitoredDomain seeds an edge domain already monitored (agent_pull).
func seedMonitoredDomain(t *testing.T, db *gorm.DB, id string, monitored bool) {
	t.Helper()
	d := &models.NetworkDomain{
		ID:          id,
		Name:        "域-" + id,
		DomainType:  models.DomainTypeEdge,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		ZoneType:    "extranet",
		Channel:     models.ChannelTypeAgentPull,
		IsMonitored: monitored,
	}
	require.NoError(t, db.Create(d).Error)
}

// seedDraftWithStatus persists a draft with a given validation_status directly.
func seedDraftWithStatus(t *testing.T, db *gorm.DB, changeNo, domainID, status string, valStatus string) *models.ConfigDraft {
	t.Helper()
	d := &models.ConfigDraft{
		NetworkDomainID:  domainID,
		ChangeNo:         changeNo,
		PrometheusYml:    "global:\n  scrape_interval: 15s\n",
		Status:           models.DraftStatus(status),
		ValidationStatus: valStatus,
		Summary:          "测试草稿",
	}
	require.NoError(t, db.Create(d).Error)
	return d
}

func newGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

func perform(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func unmarshalData(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var resp struct {
		Status string                 `json:"status"`
		Data   map[string]interface{} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "success", resp.Status, w.Body.String())
	return resp.Data
}

// ==================== Service layer ====================

func TestGenerateDraftCreatesPending(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	seedJob(t, db, "edge-g1", "job1") // 决策 44-3：无变更项不再生成空变更单

	d, err := GenerateDraft(db, "edge-g1")
	require.NoError(t, err)
	assert.Equal(t, models.DraftStatusPending, d.Status)
	assert.Contains(t, d.ChangeNo, "CHG-")
	assert.Equal(t, "edge-g1", d.NetworkDomainID)
	assert.Equal(t, string(models.ValidationStatusPending), d.ValidationStatus, "测试环境无 promtool → pending")
	assert.Contains(t, d.PrometheusYml, "network_domain_id: edge-g1")
	assert.Contains(t, d.PrometheusYml, "zone_type: extranet")
	// metadata JSON 含 checksum 与 source_data_version。
	var meta models.ConfigDraftMetadata
	require.NoError(t, json.Unmarshal([]byte(d.Metadata), &meta))
	assert.NotEmpty(t, meta.Checksum)
	assert.Equal(t, generatorVersionPlaceholder, meta.GeneratorVersion)
}

func TestGenerateDraftReturnsExistingLivePending(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-g2", true)
	seedHost(t, db, "edge-g2", "res-1")
	seedJob(t, db, "edge-g2", "job1")

	first, err := GenerateDraft(db, "edge-g2")
	require.NoError(t, err)
	second, err := GenerateDraft(db, "edge-g2")
	require.NoError(t, err)
	assert.Equal(t, first.ChangeNo, second.ChangeNo, "同域活 pending 直接返回，不重复生成")
}

func TestGenerateDraftRejectsNotMonitored(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-g3", false)
	_, err := GenerateDraft(db, "edge-g3")
	assert.ErrorIs(t, err, ErrDomainNotMonitored)
}

func TestGenerateDraftRejectsFrozenDomain(t *testing.T) {
	db := newMemDB(t)
	d := &models.NetworkDomain{
		ID: "edge-g4", Name: "冻结域", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusDisabled,
		Channel: models.ChannelTypeAgentPull, IsMonitored: true,
	}
	require.NoError(t, db.Create(d).Error)
	_, err := GenerateDraft(db, "edge-g4")
	assert.ErrorIs(t, err, ErrDomainFrozen)
}

func TestGenerateDraftChangeNoSequence(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-g5", true)
	seedDraftWithStatus(t, db, "CHG-99990101-007", "edge-g5", string(models.DraftStatusDiscarded), string(models.ValidationStatusPassed))

	// 当日的 001 / 002 递增。
	seedDraftWithStatus(t, db, "CHG-"+todaySuffix()+"-001", "edge-g5", string(models.DraftStatusConfirmed), string(models.ValidationStatusPassed))
	// 已有活 pending 会直接返回（复用 singleToken 测试）；这里用不同网域验证递增。
	seedMonitoredDomain(t, db, "edge-g6", true)
	seedHost(t, db, "edge-g6", "res-1")
	seedJob(t, db, "edge-g6", "job1")
	d, err := GenerateDraft(db, "edge-g6")
	require.NoError(t, err)
	assert.Equal(t, "CHG-"+todaySuffix()+"-002", d.ChangeNo)
}

func TestGenerateDraftBuildsChangeItemsWithJobsAndRules(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-g7", true)

	job := &models.ScrapeJob{
		JobName: "node-exporter-prod", JobType: models.JobTypeStandard,
		ResourceType: models.ResourceTypeHost, NetworkDomainID: "edge-g7",
		InstanceSelectionMode: models.InstanceSelectionManual, ScrapeInterval: "15s",
		ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending,
		Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)

	rule := &models.MonitoringRule{
		Name: "cpu-high", ContentMode: models.RuleContentModeYAMLPassthrough,
		RuleContent: "groups:\n  - name: cpu\n    rules:\n      - alert: HighCPU\n", Scope: models.ScopeTypeCentral,
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(rule).Error)

	d, err := GenerateDraft(db, "edge-g7")
	require.NoError(t, err)
	var items []models.ConfigChangeItem
	require.NoError(t, json.Unmarshal([]byte(d.ChangeItems), &items))
	assert.Len(t, items, 2)
	assert.True(t, highRisk(items), "含告警规则变更 → 高风险")
	assert.Contains(t, d.Summary, "采集 Job 1 个")
	assert.Contains(t, d.Summary, "告警规则 1 条")
	assert.NotEmpty(t, d.RulesYml)
}

// TestGenerateDraftPropagatesLoadFailure 覆盖 MEDIUM-2：rules 源数据加载失败必须
// 上抛错误，不得吞错并静默生成空配置草稿（避免前端拿到空草稿却可 passed→confirm）。
func TestGenerateDraftPropagatesLoadFailure(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-g8", true)
	require.NoError(t, db.Migrator().DropTable(&models.MonitoringRule{}))

	_, err := GenerateDraft(db, "edge-g8")
	require.Error(t, err, "rules 加载失败不得静默生成空草稿")
}

// TestGenerateDraftDiffRemoveOnDisableJob 覆盖「变更清单按产物 diff 派生」（PRD §3.4）：
// 禁用唯一已生效 Job → 新草稿含「移除采集 Job（高风险）」变更项，
// 不再出现「产物变了但摘要显示本次无配置变更」的误导。
func TestGenerateDraftDiffRemoveOnDisableJob(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-diff", true)
	seedHost(t, db, "edge-diff", "res-1")
	job := seedJob(t, db, "edge-diff", "job1")

	// 首版生成并确认，形成生效版本基线。
	d1, err := GenerateDraft(db, "edge-diff")
	require.NoError(t, err)
	require.NoError(t, db.Model(d1).Update("validation_status", string(models.ValidationStatusPassed)).Error)
	_, err = ConfirmDraft(db, d1.ChangeNo, "admin")
	require.NoError(t, err)

	// 用户禁用该 Job（绕过 handler 的 pending 守卫，直接落库）。
	require.NoError(t, db.Model(job).Update("enabled", false).Error)

	// 重新生成草稿：变更清单应含「移除采集 Job job1」高风险项。
	d2, err := GenerateDraft(db, "edge-diff")
	require.NoError(t, err)
	var items []models.ConfigChangeItem
	require.NoError(t, json.Unmarshal([]byte(d2.ChangeItems), &items))
	require.Len(t, items, 1)
	assert.Equal(t, string(models.ChangeItemTypeDelete), items[0].Type)
	assert.Equal(t, string(models.ChangeItemTargetScrapeJob), items[0].Target)
	assert.Equal(t, string(models.RiskHigh), items[0].Risk)
	assert.Contains(t, items[0].Description, "移除采集 Job job1")
	assert.Contains(t, d2.Summary, "移除采集 Job 1 个")
}

// TestGenerateDraftNoDiffReturnsErrNoChanges 覆盖决策 44-3 扩展：源数据 touch 但产物
// 与生效版本一致（如仅改动禁用对象字段的空跑，PRD §3.3.3）→ 不生成噪声变更单。
func TestGenerateDraftNoDiffReturnsErrNoChanges(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-nodiff", true)
	seedHost(t, db, "edge-nodiff", "res-1")
	seedJob(t, db, "edge-nodiff", "job1")

	d1, err := GenerateDraft(db, "edge-nodiff")
	require.NoError(t, err)
	require.NoError(t, db.Model(d1).Update("validation_status", string(models.ValidationStatusPassed)).Error)
	_, err = ConfirmDraft(db, d1.ChangeNo, "admin")
	require.NoError(t, err)

	// 源数据无实质变化 → ErrNoChanges，不再生成「本次无配置变更」的草稿。
	_, err = GenerateDraft(db, "edge-nodiff")
	assert.ErrorIs(t, err, ErrNoChanges)
}

// TestGenerateDraftAlertmanagerChangeItem 覆盖决策 60（T09-60-2）：管理域 default 纳入
// alertmanager.yml，其内容变化须派生「告警收敛配置」变更项，且草稿持久化 alertmanager_yml
// 供预览；edge 域不纳入告警配置（不产出该变更项）。
func TestGenerateDraftAlertmanagerChangeItem(t *testing.T) {
	db := newMemDB(t)
	// 管理域（management）已纳管。
	mgmt := &models.NetworkDomain{
		ID: "default", Name: "管理域", DomainType: models.DomainTypeManagement,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled,
		ZoneType: "central", Channel: models.ChannelTypeAgentPull, IsMonitored: true,
	}
	require.NoError(t, db.Create(mgmt).Error)
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content:  "route:\n  receiver: default\n",
		Checksum: models.AlertmanagerConfigChecksum("route:\n  receiver: default\n"),
		Status:   models.AlertmanagerConfigStatusApplied,
	}).Error)

	d, err := GenerateDraft(db, "default")
	require.NoError(t, err)
	assert.Equal(t, "route:\n  receiver: default\n", d.AlertmanagerYml, "草稿须持久化 alertmanager_yml 供预览")

	var items []models.ConfigChangeItem
	require.NoError(t, json.Unmarshal([]byte(d.ChangeItems), &items))
	var amItems []models.ConfigChangeItem
	for _, it := range items {
		if it.Target == string(models.ChangeItemTargetAlertmanagerCfg) {
			amItems = append(amItems, it)
		}
	}
	require.Len(t, amItems, 1, "管理域须派生告警收敛配置变更项")
	assert.Equal(t, string(models.ChangeItemTypeAdd), amItems[0].Type)
	assert.Equal(t, string(models.RiskLow), amItems[0].Risk)
	assert.Equal(t, []string{string(models.AffectedFileAlertmanager)}, amItems[0].AffectedFiles)
}

// TestGenerateDraftBackfillsSourceVersion 覆盖 T09-05 review-fix：生成草稿时回填
// source_version = 该网域上一已确认 ConfigVersion 的 change_no（用于版本对比 Tab）。
// 无历史版本时保持空（前端据此显示「无历史版本可对比」）。
func TestGenerateDraftBackfillsSourceVersion(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-sv", true)
	seedHost(t, db, "edge-sv", "res-1")
	seedJob(t, db, "edge-sv", "job1") // 决策 44-3：需 ready job 产生实质变更

	// 无历史版本 → source_version 为空。
	d1, err := GenerateDraft(db, "edge-sv")
	require.NoError(t, err)
	assert.Empty(t, d1.SourceVersion, "无历史版本时 source_version 应为空")

	// 废弃 d1 腾出活 pending 名额，再手动补一条上一已确认 ConfigVersion。
	_, _, err = DiscardDraft(db, d1.ChangeNo)
	require.NoError(t, err)
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: "edge-sv",
		DraftID:         "draft-prev",
		ChangeNo:        "CHG-PREV-001",
		PrometheusYml:   "global:\n  scrape_interval: 5s\n",
	}).Error)

	// 变更清单按产物 diff 派生（决策 44-3）：需新增一个 ready job 形成实质差异，
	// 否则与上一版本无变化 → ErrNoChanges。
	seedJob(t, db, "edge-sv", "job2")

	// 已有上一版本 → source_version 回填为其 change_no。
	d2, err := GenerateDraft(db, "edge-sv")
	require.NoError(t, err)
	assert.Equal(t, "CHG-PREV-001", d2.SourceVersion)
}

// TestConfirmDraftKeepsSourceVersion 覆盖 ConfirmDraft 不应把草稿 source_version 覆盖
// 为草稿自身 change_no（旧实现 :379 的缺陷）：确认后 source_version 仍指向前一版本。
func TestConfirmDraftKeepsSourceVersion(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-sv2", true)

	// 上一版本已确认。
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: "edge-sv2",
		DraftID:         "draft-prev",
		ChangeNo:        "CHG-PREV-002",
		PrometheusYml:   "global:\n  scrape_interval: 5s\n",
	}).Error)

	// 变更清单按产物 diff 派生（决策 44-3）：seed 一个 ready job 形成实质差异。
	seedHost(t, db, "edge-sv2", "res-1")
	seedJob(t, db, "edge-sv2", "job1")

	// 生成草稿 → source_version 回填为上一版本 change_no。
	d, err := GenerateDraft(db, "edge-sv2")
	require.NoError(t, err)
	assert.Equal(t, "CHG-PREV-002", d.SourceVersion)

	// 测试环境无 promtool，手动模拟 revalidate 通过后再 confirm。
	require.NoError(t, db.Model(d).Update("validation_status", string(models.ValidationStatusPassed)).Error)
	v, err := ConfirmDraft(db, d.ChangeNo, "admin")
	require.NoError(t, err)
	assert.Equal(t, d.ChangeNo, v.ChangeNo)

	// confirm 不得把 source_version 覆盖为草稿自身 change_no。
	var confirmed models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", d.ChangeNo).First(&confirmed).Error)
	assert.Equal(t, "CHG-PREV-002", confirmed.SourceVersion, "confirm 后 source_version 仍应指向历史版本 change_no")
}

func TestConfirmDraftRejectsUnpassedValidation(t *testing.T) {
	db := newMemDB(t)
	seedDraftWithStatus(t, db, "CHG-99990101-001", "edge-c", string(models.DraftStatusPending), string(models.ValidationStatusPending))
	_, err := ConfirmDraft(db, "CHG-99990101-001", "admin")
	assert.ErrorIs(t, err, ErrValidationNotPassed)
}

func TestConfirmDraftCreatesVersion(t *testing.T) {
	db := newMemDB(t)
	// confirm 触发 local 下发：需网域行解析通道（此处 seed agent_pull → 登记占位下发）。
	seedMonitoredDomain(t, db, "edge-c", true)
	seedDraftWithStatus(t, db, "CHG-99990101-002", "edge-c", string(models.DraftStatusPending), string(models.ValidationStatusPassed))

	v, err := ConfirmDraft(db, "CHG-99990101-002", "admin")
	require.NoError(t, err)
	assert.Equal(t, "CHG-99990101-002", v.ChangeNo)
	assert.Contains(t, v.PrometheusYml, "scrape_interval")

	var draft models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", "CHG-99990101-002").First(&draft).Error)
	assert.Equal(t, models.DraftStatusConfirmed, draft.Status)
	assert.Equal(t, "admin", draft.ConfirmedBy)
	assert.NotNil(t, draft.ConfirmedAt)

	// confirm 应触发一条下发记录（agent_pull 通道 MVP 登记 pending 占位）。
	var deployments []models.ConfigDeployment
	require.NoError(t, db.Where("network_domain_id = ?", "edge-c").Find(&deployments).Error)
	assert.Len(t, deployments, 1)
}

func TestConfirmDraftRejectsNonPending(t *testing.T) {
	db := newMemDB(t)
	seedDraftWithStatus(t, db, "CHG-99990101-003", "edge-c", string(models.DraftStatusConfirmed), string(models.ValidationStatusPassed))
	_, err := ConfirmDraft(db, "CHG-99990101-003", "admin")
	assert.ErrorIs(t, err, ErrNotPending)
}

func TestDiscardDraft(t *testing.T) {
	db := newMemDB(t)
	seedDraftWithStatus(t, db, "CHG-99990101-004", "edge-c", string(models.DraftStatusPending), string(models.ValidationStatusFailed))
	d, impact, err := DiscardDraft(db, "CHG-99990101-004")
	require.NoError(t, err)
	assert.Equal(t, models.DraftStatusDiscarded, d.Status, "校验失败态 failed 草稿也可废弃")
	assert.NotNil(t, impact)
	assert.Equal(t, 0, impact.NewReverted)
	assert.Equal(t, 0, impact.ModifiedKept)
	assert.Equal(t, 0, impact.DeletedRestored)
}

func TestDiscardDraftRejectsNonPending(t *testing.T) {
	db := newMemDB(t)
	seedDraftWithStatus(t, db, "CHG-99990101-005", "edge-c", string(models.DraftStatusConfirmed), string(models.ValidationStatusPassed))
	_, _, err := DiscardDraft(db, "CHG-99990101-005")
	assert.ErrorIs(t, err, ErrNotPending)
}

func TestGetDraftNotFound(t *testing.T) {
	db := newMemDB(t)
	_, err := GetDraftDetail(db, "CHG-NOT-EXIST")
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestListDraftsFilterAndPagination(t *testing.T) {
	db := newMemDB(t)
	for i := 0; i < 3; i++ {
		seedDraftWithStatus(t, db, fmt.Sprintf("CHG-99990101-%03d", i+1), "edge-l", string(models.DraftStatusPending), string(models.ValidationStatusPending))
	}
	seedDraftWithStatus(t, db, "CHG-99990101-009", "edge-l", string(models.DraftStatusConfirmed), string(models.ValidationStatusPassed))

	items, total, err := ListDrafts(db, "edge-l", "pending", 1, 2)
	require.NoError(t, err)
	assert.Len(t, items, 2)
	assert.Equal(t, int64(3), total)

	items, total, err = ListDrafts(db, "edge-l", "all", 1, 20)
	require.NoError(t, err)
	assert.Len(t, items, 4)
	assert.Equal(t, int64(4), total)
}

func TestListDraftsEmptyDomainReturnsAll(t *testing.T) {
	db := newMemDB(t)
	// 跨网域各造 1 条 pending 草稿
	for i, dom := range []string{"edge-l", "edge-c"} {
		seedDraftWithStatus(t, db, fmt.Sprintf("CHG-99990102-%03d", i+1), dom, string(models.DraftStatusPending), string(models.ValidationStatusPending))
	}

	// 未传 network_domain_id（前端默认态 /「全部网域」）应列出全部，而非 ErrDomainNotFound
	items, total, err := ListDrafts(db, "", "pending", 1, 20)
	require.NoError(t, err)
	assert.Len(t, items, 2)
	assert.Equal(t, int64(2), total)
}

// 回归（决策 F20-2）：RevalidateDraft 重校失败时透传具体校验信息并落库
// validation_message，不再丢弃 vMsg / 只报无具象的 "draft validation still failed"。
func TestRevalidateDraftPersistsAndExposesMessage(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "dom1", true)
	d := seedDraftWithStatus(t, db, "CHG-0001", "dom1", "pending", "failed")

	// 覆盖 targets_files：含 job 保护标签触发 schema 失败并产生具象 vMsg。
	targets := map[string]string{
		"a.json": `[{"targets":["10.0.1.10"],"labels":{"job":"x"}}]`,
	}
	b, err := json.Marshal(targets)
	require.NoError(t, err)
	require.NoError(t, db.Model(d).Update("targets_files", string(b)).Error)

	updated, err := RevalidateDraft(db, d.ChangeNo)
	require.Error(t, err)
	require.True(t, errors.Is(err, ErrValidationStillFailed))
	assert.Contains(t, err.Error(), "禁止覆盖内置标签", "错误应透传具体校验信息")

	var reloaded models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", d.ChangeNo).First(&reloaded).Error)
	assert.Equal(t, "failed", reloaded.ValidationStatus)
	assert.Contains(t, reloaded.ValidationMessage, "禁止覆盖内置标签")
	assert.Equal(t, reloaded.ValidationMessage, updated.ValidationMessage)
	// 决策 45-3：schema 失败归因 user_config，且结构化细节落库。
	assert.Equal(t, string(models.ValidationCauseUserConfig), reloaded.ValidationCause)
	assert.Contains(t, reloaded.ValidationDetails, "a.json")
	assert.Contains(t, reloaded.ValidationDetails, "禁止覆盖内置标签")
}

// ==================== HTTP layer ====================

func TestDraftHandlerRoutes(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-h", true)
	seedHost(t, db, "edge-h", "res-1")
	seedJob(t, db, "edge-h", "job1") // 决策 44-3：无变更项时不再生成空变更单，需 ready job 产生实质变更

	r := newGin()
	g := r.Group("/api/v2/platform")
	RegisterRoutes(g, db)

	// POST 生成。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/config/drafts", `{"network_domain_id":"edge-h"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	data := unmarshalData(t, w)
	changeNo := data["change_no"].(string)
	assert.Contains(t, changeNo, "CHG-")

	// GET 列表。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/config-drafts?network_domain_id=edge-h&status=pending", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	listData := unmarshalData(t, w)
	items, ok := listData["items"].([]interface{})
	require.True(t, ok)
	assert.Len(t, items, 1)

	// GET 详情。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/config-drafts/"+changeNo, "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// confirm：validation=pending（无 promtool）→ bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/config-drafts/"+changeNo+"/confirm", `{"confirmed_by":"admin"}`)
	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())

	// discard：pending 可废弃。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/config-drafts/"+changeNo+"/discard", `{}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 已废弃 → 二次 confirm 返回 bad_request（非 pending）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/config-drafts/"+changeNo+"/confirm", `{"confirmed_by":"admin"}`)
	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())

	// 详情 not_found。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/config-drafts/CHG-NOPE", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestDraftHandlerDiscardValidationFailed(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-h-fail", true)

	r := newGin()
	g := r.Group("/api/v2/platform")
	RegisterRoutes(g, db)

	// 直接写入一张 validation_status=failed 的 pending 草稿。
	seedDraftWithStatus(t, db, "CHG-FAILED-001", "edge-h-fail", string(models.DraftStatusPending), string(models.ValidationStatusFailed))

	// 废弃影响预览应返回 200。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/config-drafts/CHG-FAILED-001/discard-impact", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 废弃本身应返回 200，且草稿变为 discarded。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/config-drafts/CHG-FAILED-001/discard", `{}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var draft models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", "CHG-FAILED-001").First(&draft).Error)
	assert.Equal(t, models.DraftStatusDiscarded, draft.Status)
}

func TestDiscardDraftImpactAndRollback(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-discard", true)

	// 构造上一生效版本：线上已有 job-a、job-b。
	prevYml, err := yaml.Marshal(map[string]interface{}{
		"global": map[string]string{"scrape_interval": "15s"},
		"scrape_configs": []map[string]string{
			{"job_name": "job-a"},
			{"job_name": "job-b"},
		},
	})
	require.NoError(t, err)
	version := &models.ConfigVersion{
		NetworkDomainID: "edge-discard",
		DraftID:         "draft-prev",
		ChangeNo:        "CHG-PREV-001",
		PrometheusYml:   string(prevYml),
	}
	require.NoError(t, db.Create(version).Error)

	now := time.Now()
	// job-a：已生效且仍在候选集，参数被修改 → keep_modified
	jobA := &models.ScrapeJob{
		JobName: "job-a", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "edge-discard", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "30s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	// job-b：已生效但被用户删除 → restore
	jobB := &models.ScrapeJob{
		JobName: "job-b", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "edge-discard", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
		BaseModel: models.BaseModel{DeletedAt: gorm.DeletedAt{Valid: true, Time: now}},
	}
	// job-c：新建且 ready，未生效过 → revert_to_draft
	jobC := &models.ScrapeJob{
		JobName: "job-c", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "edge-discard", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	// job-d：一直是 draft，从未生效 → ignore
	jobD := &models.ScrapeJob{
		JobName: "job-d", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "edge-discard", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "draft", ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	for _, j := range []*models.ScrapeJob{jobA, jobB, jobC, jobD} {
		require.NoError(t, db.Create(j).Error)
	}

	draft := seedDraftWithStatus(t, db, "CHG-DISCARD-001", "edge-discard", string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	draft.SourceVersion = version.ChangeNo
	require.NoError(t, db.Save(draft).Error)

	// GetDiscardImpact 预计算与真正废弃结果一致。
	impact, err := GetDiscardImpact(db, draft.ChangeNo)
	require.NoError(t, err)
	assert.Equal(t, 1, impact.NewReverted, "job-c 新建未生效应回退 draft")
	assert.Equal(t, 1, impact.ModifiedKept, "job-a 已生效修改应保留")
	assert.Equal(t, 1, impact.DeletedRestored, "job-b 已生效删除应恢复")
	assert.Equal(t, 0, impact.Missing)

	d, impact2, err := DiscardDraft(db, draft.ChangeNo)
	require.NoError(t, err)
	assert.Equal(t, models.DraftStatusDiscarded, d.Status)
	assert.Equal(t, impact, impact2)

	// 回写断言
	var a, b, c, dJob models.ScrapeJob
	require.NoError(t, db.First(&a, jobA.ID).Error)
	assert.Equal(t, "ready", a.DraftStatus)
	assert.Equal(t, models.ChangeStatusDeployed, a.ChangeStatus)

	require.NoError(t, db.Unscoped().First(&b, jobB.ID).Error)
	assert.False(t, b.DeletedAt.Valid, "job-b 应被恢复（软删撤销）")
	assert.True(t, b.Enabled)
	assert.Equal(t, "ready", b.DraftStatus)
	assert.Equal(t, models.ChangeStatusDeployed, b.ChangeStatus)

	require.NoError(t, db.First(&c, jobC.ID).Error)
	assert.Equal(t, "draft", c.DraftStatus)
	assert.Equal(t, models.ChangeStatusNone, c.ChangeStatus)

	require.NoError(t, db.First(&dJob, jobD.ID).Error)
	assert.Equal(t, "draft", dJob.DraftStatus)
	assert.Equal(t, models.ChangeStatusNone, dJob.ChangeStatus)
}

func TestDiscardDraftRevertsNewJobOnFirstDeploy(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-first", true)

	job := &models.ScrapeJob{
		JobName: "new-job", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "edge-first", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)

	draft := seedDraftWithStatus(t, db, "CHG-FIRST-001", "edge-first", string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	// 首次部署无 SourceVersion
	require.Empty(t, draft.SourceVersion)

	_, impact, err := DiscardDraft(db, draft.ChangeNo)
	require.NoError(t, err)
	assert.Equal(t, 1, impact.NewReverted)
	assert.Equal(t, 0, impact.ModifiedKept)
	assert.Equal(t, 0, impact.DeletedRestored)

	var updated models.ScrapeJob
	require.NoError(t, db.First(&updated, job.ID).Error)
	assert.Equal(t, "draft", updated.DraftStatus)
	assert.Equal(t, models.ChangeStatusNone, updated.ChangeStatus)
}

func TestDiscardImpactHandler(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-impact", true)

	prevYml, err := yaml.Marshal(map[string]interface{}{
		"scrape_configs": []map[string]string{{"job_name": "job-impact"}},
	})
	require.NoError(t, err)
	version := &models.ConfigVersion{
		NetworkDomainID: "edge-impact",
		DraftID:         "draft-prev",
		ChangeNo:        "CHG-IMPACT-PREV",
		PrometheusYml:   string(prevYml),
	}
	require.NoError(t, db.Create(version).Error)

	job := &models.ScrapeJob{
		JobName: "job-impact", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "edge-impact", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)

	draft := seedDraftWithStatus(t, db, "CHG-IMPACT-001", "edge-impact", string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	draft.SourceVersion = version.ChangeNo
	require.NoError(t, db.Save(draft).Error)

	r := newGin()
	RegisterRoutes(r.Group("/api/v2/platform"), db)
	w := perform(t, r, http.MethodGet, "/api/v2/platform/config-drafts/"+draft.ChangeNo+"/discard-impact", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	data := unmarshalData(t, w)
	assert.EqualValues(t, 0, data["new_reverted"])
	assert.EqualValues(t, 1, data["modified_kept"])
	assert.EqualValues(t, 0, data["deleted_restored"])
}

// generatorVersionPlaceholder 仅用于断言 metadata.generator_version 非空占位。
const generatorVersionPlaceholder = "0.1.0"

// todaySuffix 返回当日 YYYYMMDD（与 nextChangeNo 前缀一致，用于构造对照用例）。
func todaySuffix() string {
	return time.Now().Format("20060102")
}