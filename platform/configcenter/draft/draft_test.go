package draft

import (
	"encoding/json"
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

// TestGenerateDraftBackfillsSourceVersion 覆盖 T09-05 review-fix：生成草稿时回填
// source_version = 该网域上一已确认 ConfigVersion 的 change_no（用于版本对比 Tab）。
// 无历史版本时保持空（前端据此显示「无历史版本可对比」）。
func TestGenerateDraftBackfillsSourceVersion(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-sv", true)

	// 无历史版本 → source_version 为空。
	d1, err := GenerateDraft(db, "edge-sv")
	require.NoError(t, err)
	assert.Empty(t, d1.SourceVersion, "无历史版本时 source_version 应为空")

	// 废弃 d1 腾出活 pending 名额，再手动补一条上一已确认 ConfigVersion。
	_, err = DiscardDraft(db, d1.ChangeNo)
	require.NoError(t, err)
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: "edge-sv",
		DraftID:         "draft-prev",
		ChangeNo:        "CHG-PREV-001",
		PrometheusYml:   "global:\n  scrape_interval: 5s\n",
	}).Error)

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
	d, err := DiscardDraft(db, "CHG-99990101-004")
	require.NoError(t, err)
	assert.Equal(t, models.DraftStatusDiscarded, d.Status, "校验失败态 failed 草稿也可废弃")
}

func TestDiscardDraftRejectsNonPending(t *testing.T) {
	db := newMemDB(t)
	seedDraftWithStatus(t, db, "CHG-99990101-005", "edge-c", string(models.DraftStatusConfirmed), string(models.ValidationStatusPassed))
	_, err := DiscardDraft(db, "CHG-99990101-005")
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

// ==================== HTTP layer ====================

func TestDraftHandlerRoutes(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-h", true)

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

// generatorVersionPlaceholder 仅用于断言 metadata.generator_version 非空占位。
const generatorVersionPlaceholder = "0.1.0"

// todaySuffix 返回当日 YYYYMMDD（与 nextChangeNo 前缀一致，用于构造对照用例）。
func todaySuffix() string {
	return time.Now().Format("20060102")
}