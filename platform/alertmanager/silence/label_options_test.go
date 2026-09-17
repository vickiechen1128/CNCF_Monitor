package silence

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

// labelOptDBCounter 为每个测试生成唯一内存 DSN，避免并行测试共享库造成数据串扰。
var labelOptDBCounter int64

func newLabelOptionsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&labelOptDBCounter, 1)
	dsn := fmt.Sprintf("file:silence_labelopt_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.LabelTemplate{},
		&models.ScrapeJob{},
		&models.MonitoringRule{},
	))
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func performLabelOptions(t *testing.T, db *gorm.DB) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/alertmanager/silences/label-options", LabelOptionsHandler(db))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/alertmanager/silences/label-options", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	var body struct {
		Status string         `json:"status"`
		Data   map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, "success", body.Status)
	return w, body.Data
}

func groupBySource(t *testing.T, data map[string]any, source string) []LabelOption {
	t.Helper()
	raw, err := json.Marshal(data["groups"])
	require.NoError(t, err)
	var groups []LabelOptionGroup
	require.NoError(t, json.Unmarshal(raw, &groups))
	for _, g := range groups {
		if g.Source == source {
			return g.Items
		}
	}
	return nil
}

// 空库：四组齐全，动态组（template/rule 自定义键）为空，固定组返回固定清单。
func TestLabelOptionsEmptyDB(t *testing.T) {
	db := newLabelOptionsTestDB(t)
	_, data := performLabelOptions(t, db)

	system := groupBySource(t, data, LabelSourceTargetSystem)
	require.Len(t, system, 3)
	assert.Equal(t, "resource_id", system[0].Name)
	assert.Equal(t, "instance", system[1].Name)
	assert.Equal(t, "job", system[2].Name)

	assert.Empty(t, groupBySource(t, data, LabelSourceTemplate))

	rule := groupBySource(t, data, LabelSourceRule)
	// 空库无规则：仅 alertname（自动附加），无 severity。
	require.Len(t, rule, 1)
	assert.Equal(t, "alertname", rule[0].Name)

	external := groupBySource(t, data, LabelSourceExternal)
	require.Len(t, external, 2)
	assert.Equal(t, "network_domain_id", external[0].Name)
	assert.Equal(t, "zone_type", external[1].Name)
}

// 决策 71 核心口径：template 组只含「被 enabled+ready Job 实际引用模板」的 enabled mappings 键；
// draft Job 引用的模板、disabled mappings、未被引用模板的键均不出现。
func TestLabelOptionsTemplateGroupReflectsReadyJobs(t *testing.T) {
	db := newLabelOptionsTestDB(t)
	hostDefault := models.LabelTemplate{
		Name: "host-default", ResourceCategory: models.ResourceCategoryHost, IsDefault: true,
		Mappings: []models.LabelMapping{
			{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "hostname", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "hostname", Enabled: false},
		},
	}
	require.NoError(t, db.Create(&hostDefault).Error)
	customTmpl := models.LabelTemplate{
		Name: "custom-host", ResourceCategory: models.ResourceCategoryHost,
		Mappings: []models.LabelMapping{
			{SourceField: "cluster", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
		},
	}
	require.NoError(t, db.Create(&customTmpl).Error)
	unusedTmpl := models.LabelTemplate{
		Name: "unused", ResourceCategory: models.ResourceCategoryHost,
		Mappings: []models.LabelMapping{
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
		},
	}
	require.NoError(t, db.Create(&unusedTmpl).Error)

	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "ready-jobs", JobType: models.JobTypeStandard, ResourceType: models.ResourceType(models.ResourceCategoryHost),
		NetworkDomainID: "default", DraftStatus: "ready", Enabled: true,
		LabelTemplateID: fmt.Sprintf("%d", customTmpl.ID),
	}).Error)
	// 无显式挂载的 ready Job → 回落 host 类别默认模板（hostDefault）。
	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "ready-jobs-default", JobType: models.JobTypeStandard, ResourceType: models.ResourceType(models.ResourceCategoryHost),
		NetworkDomainID: "default", DraftStatus: "ready", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "draft-jobs", JobType: models.JobTypeStandard, ResourceType: models.ResourceType(models.ResourceCategoryHost),
		NetworkDomainID: "default", DraftStatus: "draft", Enabled: true,
		LabelTemplateID: fmt.Sprintf("%d", unusedTmpl.ID),
	}).Error)

	_, data := performLabelOptions(t, db)
	got := groupBySource(t, data, LabelSourceTemplate)
	names := make([]string, 0, len(got))
	for _, it := range got {
		names = append(names, it.Name)
	}
	// customTmpl（ready Job 显式挂载）+ hostDefault（无显式挂载 → 类别默认模板回落）；
	// unusedTmpl（仅 draft Job 引用）与 disabled mapping（hostname）不可见。
	assert.ElementsMatch(t, []string{"instance", "app", "cluster"}, names)
}

// 规则组：alertname 固定 + severity（仅当生效规则带此键）+ 自定义键（标注来源规则名）；
// draft / disabled / edge-scope 规则的键不出现。
func TestLabelOptionsRuleGroup(t *testing.T) {
	db := newLabelOptionsTestDB(t)
	require.NoError(t, db.Create(&models.MonitoringRule{
		Name: "cpu-rule", ContentMode: models.RuleContentModeStructured, RuleType: "alerting",
		Labels: map[string]string{"severity": "critical"}, Scope: models.ScopeTypeCentral,
		Enabled: true, DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}).Error)
	require.NoError(t, db.Create(&models.MonitoringRule{
		Name: "disk-rule", ContentMode: models.RuleContentModeStructured, RuleType: "alerting",
		Labels: map[string]string{"severity": "warning", "team": "infra"}, Scope: models.ScopeTypeCentral,
		Enabled: true, DraftStatus: "ready", ChangeStatus: models.ChangeStatusDeployed,
	}).Error)
	require.NoError(t, db.Create(&models.MonitoringRule{
		Name: "draft-rule", ContentMode: models.RuleContentModeStructured, RuleType: "alerting",
		Labels: map[string]string{"secret": "x"}, Scope: models.ScopeTypeCentral,
		Enabled: true, DraftStatus: "draft", ChangeStatus: models.ChangeStatusNone,
	}).Error)

	_, data := performLabelOptions(t, db)
	got := groupBySource(t, data, LabelSourceRule)
	names := make([]string, 0, len(got))
	descByName := make(map[string]string)
	for _, it := range got {
		names = append(names, it.Name)
		descByName[it.Name] = it.Description
	}
	assert.Equal(t, []string{"alertname", "severity", "team"}, names)
	assert.Contains(t, descByName["team"], "disk-rule")
	assert.NotContains(t, names, "secret")
}

// nil DB（装配异常）应返回 500 而非 panic。
func TestLabelOptionsNilDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/label-options", LabelOptionsHandler(nil))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/label-options", nil))
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
