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
	// 有规则内容时 prometheus.yml 必须注入 rule_files 引用 rules.yml（否则 Prometheus 不加载规则）。
	assert.Contains(t, ca.PrometheusYML, "rule_files:")
	assert.Contains(t, ca.PrometheusYML, "- rules.yml")
}

func TestAssembleRuleFilesOmittedWhenNoRules(t *testing.T) {
	ca, err := Assemble("default", "", "", nil, nil)
	require.NoError(t, err)
	// 无规则时不注入 rule_files，避免指向不存在的文件导致 Prometheus 配置加载失败。
	assert.NotContains(t, ca.PrometheusYML, "rule_files")
	assert.Equal(t, "", ca.RulesYML)
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
	groups, err := ResolveJobTargets(db, job, tmpl, 9100)
	require.NoError(t, err)
	require.Len(t, groups, 1, "offline 实例必须被排除")
	assert.Equal(t, "10.0.1.1:9100", groups[0].Targets[0], "host 抓取地址须拼接 exporter 端口（决策 42-4）")
	assert.Equal(t, "pay", groups[0].Labels["app"])
}

// ---- T09-04: target 端口解析（决策 42-4：host/database/middleware 拼 exporter 端口）----

func TestResolveTargetsExporterPort(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(
		&models.Host{}, &models.Database{}, &models.Middleware{},
		&models.Application{}, &models.GenericTarget{},
	))

	require.NoError(t, db.Create(&models.Host{ResourceID: "h1", NetworkDomainID: "d", PrivateIP: "10.0.1.1", Status: "online"}).Error)
	require.NoError(t, db.Create(&models.Database{ResourceBase: models.ResourceBase{ResourceID: "db1", NetworkDomainID: "d", Status: "online"}, InstanceIP: "10.0.1.2", Port: 3306}).Error)
	require.NoError(t, db.Create(&models.Middleware{ResourceID: "mw1", NetworkDomainID: "d", Status: "online", InstanceIP: "10.0.1.3", Port: 6379}).Error)
	require.NoError(t, db.Create(&models.Application{ResourceID: "app1", NetworkDomainID: "d", Status: "online", HealthCheckURL: "http://10.0.1.4:8080/metrics"}).Error)
	require.NoError(t, db.Create(&models.GenericTarget{ResourceBase: models.ResourceBase{ResourceID: "gt1", NetworkDomainID: "d", Status: "online"}, InstanceIP: "10.0.1.5", Port: 161}).Error)

	tmpl := &models.LabelTemplate{Name: "t", ResourceCategory: models.ResourceCategoryHost, IsDefault: true,
		Mappings: []models.LabelMapping{{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true}}}
	require.NoError(t, db.Create(tmpl).Error)

	t.Run("host 拼接 exporter 端口且 instance 组合字段带端口", func(t *testing.T) {
		groups, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"h1"}}, tmpl, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		assert.Equal(t, "10.0.1.1:9100", groups[0].Targets[0])
		assert.Equal(t, "10.0.1.1:9100", groups[0].Labels["instance"])
	})
	t.Run("database 优先 exporter 端口而非业务端口", func(t *testing.T) {
		groups, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"db1"}}, tmpl, 9104)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.2:9104", groups[0].Targets[0])
	})
	t.Run("middleware 优先 exporter 端口而非业务端口", func(t *testing.T) {
		groups, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"mw1"}}, tmpl, 9121)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.3:9121", groups[0].Targets[0])
	})
	t.Run("exporter 端口为 0 时 database/middleware 回落业务端口", func(t *testing.T) {
		groups, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"db1", "mw1"}}, tmpl, 0)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.2:3306", groups[0].Targets[0])
		assert.Equal(t, "10.0.1.3:6379", groups[1].Targets[0])
	})
	t.Run("application 用健康检查 URL、generic_target 用服务端口", func(t *testing.T) {
		groups, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"app1", "gt1"}}, tmpl, 9100)
		require.NoError(t, err)
		assert.Equal(t, "http://10.0.1.4:8080/metrics", groups[0].Targets[0])
		assert.Equal(t, "10.0.1.5:161", groups[1].Targets[0])
	})
}

func TestLoadExporterPortPriority(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.CITypeExporterMapping{}, &models.ExporterTemplate{}))

	require.NoError(t, db.Create(&models.ExporterTemplate{Name: "node-exporter", DefaultPort: 9100}).Error)
	require.NoError(t, db.Create(&models.CITypeExporterMapping{MonitorType: "host_linux", IsDefault: true, DefaultPort: 19100}).Error)

	t.Run("映射 default_port 优先", func(t *testing.T) {
		port, err := LoadExporterPort(db, models.ScrapeJob{MonitorType: "host_linux"})
		require.NoError(t, err)
		assert.Equal(t, 19100, port)
	})
	t.Run("无映射回落采集器模板", func(t *testing.T) {
		port, err := LoadExporterPort(db, models.ScrapeJob{ExporterTemplateID: "1"})
		require.NoError(t, err)
		assert.Equal(t, 9100, port)
	})
	t.Run("映射模板均缺返回 0", func(t *testing.T) {
		port, err := LoadExporterPort(db, models.ScrapeJob{})
		require.NoError(t, err)
		assert.Equal(t, 0, port)
	})
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
	// 方案 A：instance 是 Prometheus 约定标签（默认模板 instance_ip:port → instance），产物校验层放行；
	// 但 job / scheme 等保护标签在 targets labels 中仍应拒绝。
	assert.NoError(t, ValidateTargetGroups([]TargetGroup{{Targets: []string{"10.0.1.10"}, Labels: map[string]string{"instance": "10.0.1.10:9100"}}}))
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{Targets: []string{"10.0.1.10"}, Labels: map[string]string{"job": "x"}}}), "禁止覆盖内置标签")
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{Targets: []string{""}}}))
	assert.Error(t, ValidateTargetGroups([]TargetGroup{{}}))
}

func TestValidateArtifactsPendingWhenToolMissing(t *testing.T) {
	old := execLookPath
	execLookPath = func(string) (string, error) { return "", errToolMissing }
	t.Cleanup(func() { execLookPath = old })

	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}}}, nil)
	status, cause, details, msg := ValidateArtifacts(ca, false)
	assert.Equal(t, models.ValidationStatusPending, status)
	assert.Equal(t, models.ValidationCausePlatformFault, cause, "promtool 缺失应归因为平台故障")
	assert.Empty(t, details)
	assert.NotEmpty(t, msg)
}

func TestValidateArtifactsPassed(t *testing.T) {
	oldLook := execLookPath
	oldChecker := toolCheckerFn
	execLookPath = func(string) (string, error) { return "promtool", nil }
	toolCheckerFn = func(ca *ConfigArtifacts, ib bool) (bool, string) { return true, "" }
	t.Cleanup(func() { execLookPath = oldLook; toolCheckerFn = oldChecker })

	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}}}, nil)
	status, cause, details, _ := ValidateArtifacts(ca, false)
	assert.Equal(t, models.ValidationStatusPassed, status)
	assert.Empty(t, cause)
	assert.Empty(t, details)
}

func TestValidateArtifactsFailedSchema(t *testing.T) {
	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}}}, nil)
	ca.TargetsFiles["j.json"] = "not-json"
	status, cause, details, _ := ValidateArtifacts(ca, false)
	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause, "targets schema 失败应归因为用户配置")
	assert.Len(t, details, 1)
	assert.Equal(t, "j.json", details[0].File)
	// 保护标签冲突亦归因 user_config 且带结构化定位。
	ca2, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}}}, nil)
	ca2.TargetsFiles["a.json"] = `[{"targets":["10.0.1.10"],"labels":{"job":"x"}}]`
	status2, cause2, details2, _ := ValidateArtifacts(ca2, false)
	assert.Equal(t, models.ValidationStatusFailed, status2)
	assert.Equal(t, models.ValidationCauseUserConfig, cause2)
	assert.Equal(t, "a.json", details2[0].File)
	assert.Contains(t, details2[0].Message, "禁止覆盖内置标签")
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