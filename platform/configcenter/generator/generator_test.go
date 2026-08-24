package generator

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMemDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	return db
}

// ---- T09-02: prometheus.yml + rules.yml 主流程 ----

func TestAssemblePrometheusExternalLabels(t *testing.T) {
	ca, err := Assemble("gov-cloud-a", "extranet", "replica-0", []JobBuild{
		{Job: models.ScrapeJob{JobName: "node-exporter-prod", MetricsPath: "/metrics", Scheme: "http"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}},
	}, nil)
	require.NoError(t, err)

	assert.Contains(t, ca.PrometheusYML, "network_domain_id: gov-cloud-a")
	assert.Contains(t, ca.PrometheusYML, "zone_type: extranet")
	assert.Contains(t, ca.PrometheusYML, "replica: replica-0")
	// 不注入 tenant_id 与业务标签（§3.3.1）。
	assert.NotContains(t, ca.PrometheusYML, "tenant_id")
	assert.NotContains(t, ca.PrometheusYML, "biz:")
	// zone_type 未登记时不再注入。
	caNoZone, err := Assemble("gov-cloud-a", "", "replica-0", nil, nil)
	require.NoError(t, err)
	assert.NotContains(t, caNoZone.PrometheusYML, "zone_type")
}

func TestAssembleFileSDNotInline(t *testing.T) {
	ca, err := Assemble("default", "", "", []JobBuild{
		{Job: models.ScrapeJob{JobName: "node-exporter-prod", MetricsPath: "/metrics", Scheme: "http"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}},
	}, nil)
	require.NoError(t, err)
	// scrape_config 用 file_sd_configs 引用 targets/*.json，不内联实例地址。
	assert.Contains(t, ca.PrometheusYML, "file_sd_configs")
	assert.Contains(t, ca.PrometheusYML, "targets/node-exporter-prod.json")
	assert.NotContains(t, ca.PrometheusYML, "10.0.1.10")
	// 实例地址在 targets 文件中。
	assert.Contains(t, ca.TargetsFiles["node-exporter-prod.json"], "10.0.1.10")
}

func TestAssembleAuthTLSPassthrough(t *testing.T) {
	basic := models.ScrapeJob{JobName: "basic", MetricsPath: "/m", Scheme: "http", AuthType: models.AuthTypeBasic, Username: "monitor", Password: "secret"}
	bearer := models.ScrapeJob{JobName: "bearer", MetricsPath: "/m", Scheme: "http", AuthType: models.AuthTypeBearer, Token: "tok-123"}
	tls := models.ScrapeJob{JobName: "tls", MetricsPath: "/m", Scheme: "https", TLSSkipVerify: true, CAFile: "/etc/ca.pem"}

	ca, err := Assemble("default", "", "", []JobBuild{{Job: basic}, {Job: bearer}, {Job: tls}}, nil)
	require.NoError(t, err)
	assert.Contains(t, ca.PrometheusYML, "basic_auth")
	assert.Contains(t, ca.PrometheusYML, "username: monitor")
	assert.Contains(t, ca.PrometheusYML, "credentials: tok-123")
	assert.Contains(t, ca.PrometheusYML, "insecure_skip_verify: true")
	assert.Contains(t, ca.PrometheusYML, "ca_file: /etc/ca.pem")
}

func TestAssembleRulesYAMLPassthrough(t *testing.T) {
	rules := []models.MonitoringRule{
		{Name: "r-a", ContentMode: models.RuleContentModeYAMLPassthrough, RuleContent: "groups:\n  - name: a\n    rules: [{alert: A, expr: up == 0}]"},
		{Name: "r-b", ContentMode: models.RuleContentModeYAMLPassthrough, RuleContent: "groups:\n  - name: b\n    rules: [{alert: B, expr: up == 1}]"},
	}
	ca, err := Assemble("default", "", "", nil, rules)
	require.NoError(t, err)
	assert.Contains(t, ca.RulesYML, "name: a")
	assert.Contains(t, ca.RulesYML, "name: b")
	assert.Contains(t, ca.RulesYML, "alert: B")
}

func TestAssembleBlackbox(t *testing.T) {
	job := models.ScrapeJob{
		JobName: "blackbox-http", JobType: models.JobTypeBlackbox, BlackboxModule: "http_2xx",
		MetricsPath: "/probe", Scheme: "http",
		BlackboxTargets: []models.BlackboxTarget{{Target: "https://api.example.com/health", Protocol: models.BlackboxTargetProtocolHTTP}},
	}
	ca, err := Assemble("default", "", "", []JobBuild{
		{Job: job, Targets: []TargetGroup{{Targets: []string{"https://api.example.com/health"}}}},
	}, nil)
	require.NoError(t, err)
	assert.Contains(t, ca.PrometheusYML, "metrics_path: /probe")
	assert.Contains(t, ca.PrometheusYML, "__param_target")
	assert.Contains(t, ca.PrometheusYML, "replacement: 127.0.0.1:9115")
	assert.Contains(t, ca.BlackboxYML, "http_2xx:")
	assert.Contains(t, ca.BlackboxYML, "prober: http")
	assert.Contains(t, ca.TargetsFiles["blackbox-http.json"], "https://api.example.com/health")
}

func TestNormalizeJobFilename(t *testing.T) {
	assert.Equal(t, "node-exporter-prod.json", normalizeJobFilename("node-exporter-prod"))
	assert.Equal(t, "my-job.json", normalizeJobFilename("My Job"))
	assert.Equal(t, "default.json", normalizeJobFilename("!!!"))
}

func TestChecksumConsistency(t *testing.T) {
	a1, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.1"}}}}}, nil)
	a2, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.1"}}}}}, nil)
	require.NoError(t, nil)
	assert.Equal(t, a1.Checksum(), a2.Checksum(), "同内容 checksum 必须一致")
	assert.False(t, a1.ArtifactsChanged(a2.Checksum()), "checksum 一致判定为无实质变化（自动丢弃）")
	assert.True(t, a1.ArtifactsChanged(""), "无生效版本视为有变化")

	// 目标变化 → checksum 变化。
	a3, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.2"}}}}}, nil)
	assert.NotEqual(t, a1.Checksum(), a3.Checksum())
}

// ---- T09-03: targets / 标签优先级 / 校验 / 源数据版本 ----

func TestResolveTargetsOfflineExclusion(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Host{}, &models.LabelTemplate{}))

	require.NoError(t, db.Create(&models.Host{ServerID: "srv-online", ResourceID: "srv-online", NetworkDomainID: "d", PrivateIP: "10.0.1.1", Status: "online", AppCode: "pay"}).Error)
	require.NoError(t, db.Create(&models.Host{ServerID: "srv-offline", ResourceID: "srv-offline", NetworkDomainID: "d", PrivateIP: "10.0.1.2", Status: "offline", AppCode: "pay"}).Error)

	tmpl := &models.LabelTemplate{Name: "host-default", ResourceCategory: models.ResourceCategoryHost, IsDefault: true,
		Mappings: []models.LabelMapping{{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true}}}
	require.NoError(t, db.Create(tmpl).Error)

	job := models.ScrapeJob{JobName: "node-prod", ResourceType: models.ResourceTypeHost, NetworkDomainID: "d",
		SelectedInstanceIDs: []string{"srv-online", "srv-offline"}}
	groups, err := ResolveJobTargets(db, job, tmpl)
	require.NoError(t, err)
	require.Len(t, groups, 1, "offline 实例必须被排除")
	assert.Equal(t, "10.0.1.1", groups[0].Targets[0])
	assert.Equal(t, "pay", groups[0].Labels["app"])
}

func TestMergeLabelsPriority(t *testing.T) {
	// system 受保护：user/cmdb 均不可覆盖 system 的键；其余键由 user/cmdb 补充填充。
	got := mergeLabels(
		map[string]string{"app": "sys", "env": "prod"},
		map[string]string{"app": "user", "extra": "x"},
		map[string]string{"app": "cmdb", "env": "cmdb-env", "biz": "cmdb-biz"},
	)
	assert.Equal(t, "sys", got["app"], "system 标签不可被 user/cmdb 覆盖")
	assert.Equal(t, "prod", got["env"], "system 标签不可被 user/cmdb 覆盖")
	assert.Equal(t, "x", got["extra"])
	assert.Equal(t, "cmdb-biz", got["biz"])
}

func TestValidateTargetGroups(t *testing.T) {
	ok := []TargetGroup{{Targets: []string{"10.0.1.10"}, Labels: map[string]string{"app": "pay"}}, {Targets: []string{"https://api.example.com"}}}
	assert.NoError(t, ValidateTargetGroups(ok))
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{Targets: []string{"__bad__"}}}))
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{Targets: []string{"10.0.1.10"}, Labels: map[string]string{"__address__": "x"}}}), "禁止覆盖内置标签")
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{Targets: []string{""}}}))
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{}}))
}

func TestValidateArtifactsPendingWhenToolMissing(t *testing.T) {
	old := execLookPath
	execLookPath = func(string) (string, error) { return "", errToolMissing }
	t.Cleanup(func() { execLookPath = old })

	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}}}, nil)
	status, msg := ValidateArtifacts(ca, false)
	assert.Equal(t, models.ValidationStatusPending, status)
	assert.NotEmpty(t, msg)
}

func TestValidateArtifactsPassed(t *testing.T) {
	oldLook := execLookPath
	oldChecker := toolCheckerFn
	execLookPath = func(string) (string, error) { return "promtool", nil }
	toolCheckerFn = func(a, b string, ib bool) (bool, string) { return true, "" }
	t.Cleanup(func() { execLookPath = oldLook; toolCheckerFn = oldChecker })

	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}}}, nil)
	status, _ := ValidateArtifacts(ca, false)
	assert.Equal(t, models.ValidationStatusPassed, status)
}

func TestValidateArtifactsFailedSchema(t *testing.T) {
	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}}}, nil)
	ca.TargetsFiles["j.json"] = "not-json"
	status, _ := ValidateArtifacts(ca, false)
	assert.Equal(t, models.ValidationStatusFailed, status)
}

func TestSourceDataVersionAndNeedsRegeneration(t *testing.T) {
	db := newMemDB(t)
	// 源数据版本聚合会横跨所有源表，需一次性迁移全量（避免不存在的表导致扫描失败）。
	require.NoError(t, db.AutoMigrate(&models.ScrapeJob{}, &models.Host{}, &models.Database{},
		&models.Middleware{}, &models.Application{}, &models.GenericTarget{}, &models.MonitoringRule{},
		&models.LabelTemplate{}, &models.CITypeExporterMapping{}, &models.ExporterInstallationConfirmation{}))
	require.NoError(t, db.Create(&models.ScrapeJob{JobName: "j", NetworkDomainID: "d", MetricsPath: "/m", Scheme: "http",
		ResourceType: models.ResourceTypeHost, MonitorType: "host_linux", DraftStatus: "ready",
		Enabled: true}).Error)

	v, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	assert.NotEmpty(t, v)
	assert.True(t, NeedsRegeneration("", v), "版本推进应触发重算")
	assert.False(t, NeedsRegeneration(v, v), "版本未变化跳过")
}

// ---- helper clones string for composite label expansion ----

func TestExpandLabelTemplateComposite(t *testing.T) {
	tmpl := &models.LabelTemplate{Name: "t", Mappings: []models.LabelMapping{
		{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
		{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
	}}
	labels := expandLabelTemplate(tmpl, map[string]string{"app_name": "pay"}, "10.0.1.1:9100")
	assert.Equal(t, "10.0.1.1:9100", labels["instance"])
	assert.Equal(t, "pay", labels["app"])
}

func TestMarshalTargetGroupsJSON(t *testing.T) {
	content, err := MarshalTargetGroups([]TargetGroup{{Targets: []string{"10.0.1.10"}, Labels: map[string]string{"app": "pay"}}})
	require.NoError(t, err)
	var out []map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(content), &out))
	assert.Equal(t, "10.0.1.10", out[0]["targets"].([]interface{})[0].(string))
	assert.True(t, strings.Contains(content, "app"))
}