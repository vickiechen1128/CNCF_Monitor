package generator

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/portchain"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newMemDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	return db
}

// 同资源类别出现多个 is_default=true 属数据异常：LoadDefaultTemplate 必须报错，
// 不能按 created_at 静默取第一条（否则前端选择与生成结果可能不一致）。
func TestLoadDefaultTemplateRejectsMultipleDefaults(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:generator_defaults_%d?mode=memory&cache=shared", time.Now().UnixNano())),
		&gorm.Config{},
	)
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.LabelTemplate{}))
	for _, name := range []string{"default-a", "default-b"} {
		require.NoError(t, db.Create(&models.LabelTemplate{
			Name:             name,
			ResourceCategory: models.ResourceCategoryHost,
			IsDefault:        true,
		}).Error)
	}

	_, err = LoadDefaultTemplate(db, models.ResourceCategoryHost)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "2 个默认标签模板")
}

// ---- T09-02: prometheus.yml + rules.yml 主流程 ----

func TestAssemblePrometheusExternalLabels(t *testing.T) {
	ca, err := Assemble("gov-cloud-a", "extranet", "replica-0", []JobBuild{
		{Job: models.ScrapeJob{JobName: "node-exporter-prod", MetricsPath: "/metrics", Scheme: "http"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}},
	}, nil, "", "", true)
	require.NoError(t, err)

	assert.Contains(t, ca.PrometheusYML, "network_domain_id: gov-cloud-a")
	assert.Contains(t, ca.PrometheusYML, "zone_type: extranet")
	assert.Contains(t, ca.PrometheusYML, "replica: replica-0")
	// 不注入 tenant_id 与业务标签（§3.3.1）。
	assert.NotContains(t, ca.PrometheusYML, "tenant_id")
	assert.NotContains(t, ca.PrometheusYML, "biz:")
	// zone_type 未登记时不再注入。
	caNoZone, err := Assemble("gov-cloud-a", "", "replica-0", nil, nil, "", "", true)
	require.NoError(t, err)
	assert.NotContains(t, caNoZone.PrometheusYML, "zone_type")
}

func TestAssembleFileSDNotInline(t *testing.T) {
	ca, err := Assemble("default", "", "", []JobBuild{
		{Job: models.ScrapeJob{JobName: "node-exporter-prod", MetricsPath: "/metrics", Scheme: "http"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}},
	}, nil, "", "", true)
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

	ca, err := Assemble("default", "", "", []JobBuild{{Job: basic}, {Job: bearer}, {Job: tls}}, nil, "", "", true)
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
	ca, err := Assemble("default", "", "", nil, rules, "", "", true)
	require.NoError(t, err)
	assert.Contains(t, ca.RulesYML, "name: a")
	assert.Contains(t, ca.RulesYML, "name: b")
	assert.Contains(t, ca.RulesYML, "alert: B")
	// 多条规则记录解析合并为单个 groups 文档：重新解析应合法且恰含 2 个 group，
	// 不得出现重复顶层 groups 键（拼接语义下会生成非法 YAML）。
	assert.Equal(t, 1, strings.Count(ca.RulesYML, "groups:"))
	var parsed struct {
		Groups []struct {
			Name string `yaml:"name"`
		} `yaml:"groups"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(ca.RulesYML), &parsed))
	require.Len(t, parsed.Groups, 2)
	assert.Equal(t, "a", parsed.Groups[0].Name)
	assert.Equal(t, "b", parsed.Groups[1].Name)
	// 有规则内容时 prometheus.yml 必须注入 rule_files 引用 rules.yml（否则 Prometheus 不加载规则）。
	assert.Contains(t, ca.PrometheusYML, "rule_files:")
	assert.Contains(t, ca.PrometheusYML, "- rules.yml")
}

// 零 Job 也必须输出 scrape_configs 顶层键（边缘 agent 结构校验要求；空列表对
// promtool / vmagent 合法）。空网域由此获得可下发的「空运行」配置。
func TestAssembleZeroJobsEmitsScrapeConfigs(t *testing.T) {
	ca, err := Assemble("default", "", "", nil, nil, "", "", true)
	require.NoError(t, err)
	assert.Contains(t, ca.PrometheusYML, "scrape_configs:")
	var parsed struct {
		ScrapeConfigs []map[string]interface{} `yaml:"scrape_configs"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(ca.PrometheusYML), &parsed))
	assert.Empty(t, parsed.ScrapeConfigs)
}

func TestAssembleRuleFilesOmittedWhenNoRules(t *testing.T) {
	ca, err := Assemble("default", "", "", nil, nil, "", "", true)
	require.NoError(t, err)
	// 无规则时不注入 rule_files，避免指向不存在的文件导致 Prometheus 配置加载失败。
	assert.NotContains(t, ca.PrometheusYML, "rule_files")
	assert.Equal(t, "", ca.RulesYML)
}

// F-28：scrape_interval/scrape_timeout 必须真实写入 prometheus.yml；
// Job 留空（存量/异常数据）时按全局兜底常量回填。
func TestAssembleRendersScrapeIntervalTimeout(t *testing.T) {
	ca, err := Assemble("default", "", "", []JobBuild{
		{Job: models.ScrapeJob{JobName: "with-params", ScrapeInterval: "30s", ScrapeTimeout: "20s", MetricsPath: "/metrics", Scheme: "http"}},
		{Job: models.ScrapeJob{JobName: "sparse"}},
	}, nil, "", "", true)
	require.NoError(t, err)
	assert.Contains(t, ca.PrometheusYML, "scrape_interval: 30s")
	assert.Contains(t, ca.PrometheusYML, "scrape_timeout: 20s")
	// 留空字段按全局兜底回填，保证 scrape_config 参数完整显式。
	assert.Contains(t, ca.PrometheusYML, "scrape_interval: "+models.DefaultScrapeInterval)
	assert.Contains(t, ca.PrometheusYML, "scrape_timeout: "+models.DefaultScrapeTimeout)
	assert.Contains(t, ca.PrometheusYML, "metrics_path: "+models.DefaultMetricsPath)
	assert.Contains(t, ca.PrometheusYML, "scheme: "+models.DefaultScheme)

	// 逐 job 解析校验：sparse 任务的配置块含兜底值。
	var parsed struct {
		ScrapeConfigs []struct {
			JobName        string `yaml:"job_name"`
			ScrapeInterval string `yaml:"scrape_interval"`
			ScrapeTimeout  string `yaml:"scrape_timeout"`
		} `yaml:"scrape_configs"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(ca.PrometheusYML), &parsed))
	require.Len(t, parsed.ScrapeConfigs, 2)
	assert.Equal(t, "30s", parsed.ScrapeConfigs[0].ScrapeInterval)
	assert.Equal(t, models.DefaultScrapeInterval, parsed.ScrapeConfigs[1].ScrapeInterval)
	assert.Equal(t, models.DefaultScrapeTimeout, parsed.ScrapeConfigs[1].ScrapeTimeout)
}

func TestAssembleBlackbox(t *testing.T) {
	job := models.ScrapeJob{
		JobName: "blackbox-http", JobType: models.JobTypeBlackbox, BlackboxModule: "http_2xx",
		MetricsPath: "/probe", Scheme: "http",
		BlackboxTargets: []models.BlackboxTarget{{Target: "https://api.example.com/health", Protocol: models.BlackboxTargetProtocolHTTP}},
	}
	ca, err := Assemble("default", "", "", []JobBuild{
		{Job: job, Targets: []TargetGroup{{Targets: []string{"https://api.example.com/health"}}}},
	}, nil, "", "", true)
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
	a1, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.1"}}}}}, nil, "", "", true)
	a2, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.1"}}}}}, nil, "", "", true)
	require.NoError(t, nil)
	assert.Equal(t, a1.Checksum(), a2.Checksum(), "同内容 checksum 必须一致")
	assert.False(t, a1.ArtifactsChanged(a2.Checksum()), "checksum 一致判定为无实质变化（自动丢弃）")
	assert.True(t, a1.ArtifactsChanged(""), "无生效版本视为有变化")

	// 目标变化 → checksum 变化。
	a3, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.2"}}}}}, nil, "", "", true)
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
	groups, _, err := ResolveJobTargets(db, job, tmpl, 9100)
	require.NoError(t, err)
	require.Len(t, groups, 1, "offline 实例必须被排除")
	assert.Equal(t, "10.0.1.1:9100", groups[0].Targets[0], "host 抓取地址须拼接 exporter 端口（决策 42-4）")
	assert.Equal(t, "pay", groups[0].Labels["app"])
}

// TestResolveTargetsBlackboxResourceMode：拨测与采集同构——目标 = 所选资源类别实例
// 在 job.TargetField 上的字段值（类别不预设、字段不预设，均由用户选择）。本用例
// 类别 = interface_service、字段 = api_url：目标地址与 api_url 逐字节相等（不拼端口），
// 并注入 system 层标签 resource_id / network_domain / cloud / zone（与 standard 同源）。
func TestResolveTargetsBlackboxResourceMode(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.NetworkDomain{}, &models.InterfaceService{}, &models.LabelTemplate{}))

	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "bb-nd", Name: "网域一", DomainType: models.DomainTypeEdge,
		ZoneType: "internet", CloudCode: "aliyun", TenantID: models.PlatformAdminTenantID,
		Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&models.InterfaceService{
		ResourceBase: models.ResourceBase{
			ResourceID: "bb-is-1", ResourceCategory: models.ResourceCategoryInterfaceService,
			NetworkDomainID: "bb-nd", BizCode: "pay", Env: "prod", Status: "online",
			SourceType: models.SourceTypeManual,
		},
		APIName: "订单查询", APIURL: "https://api.example.com/health?token=x",
		ResourceType: models.ResourceTypeInterfaceService,
	}).Error)

	job := models.ScrapeJob{
		JobName: "bb", JobType: models.JobTypeBlackbox, ResourceType: models.ResourceTypeInterfaceService,
		TargetField: "api_url", NetworkDomainID: "bb-nd", SelectedInstanceIDs: []string{"bb-is-1"},
	}
	groups, skipped, err := ResolveJobTargets(db, job, nil, 0)
	require.NoError(t, err)
	require.Empty(t, skipped)
	require.Len(t, groups, 1)
	require.Len(t, groups[0].Targets, 1)
	assert.Equal(t, "https://api.example.com/health?token=x", groups[0].Targets[0],
		"target = 所选字段 api_url 的值（逐字节原样，不拼端口）")
	assert.Equal(t, "bb-is-1", groups[0].Labels["resource_id"], "system 层身份标签注入")
	assert.Equal(t, "bb-nd", groups[0].Labels["network_domain"])
	assert.Equal(t, "aliyun", groups[0].Labels["cloud"])
	assert.Equal(t, "internet", groups[0].Labels["zone"])
}

// TestResolveTargetsBlackboxNonInterfaceServiceCategory：**核心判据**——拨测不再与
// interface_service / api_url 耦合。选非 interface_service 类别（database）实例 +
// target_field=instance_ip → 生成成功，target 等于该实例的 IP，且标签仍注入。
func TestResolveTargetsBlackboxNonInterfaceServiceCategory(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Database{}, &models.LabelTemplate{}))

	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: "bb-db-1", ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: "d", Status: "online", SourceType: models.SourceTypeManual,
		},
		DatabaseType: "mysql", InstanceIP: "10.0.2.7", Port: 3306,
		ResourceType: models.ResourceTypeDatabase,
	}).Error)

	job := models.ScrapeJob{
		JobName: "bb-db", JobType: models.JobTypeBlackbox, ResourceType: models.ResourceTypeDatabase,
		TargetField: "instance_ip", NetworkDomainID: "d", SelectedInstanceIDs: []string{"bb-db-1"},
	}
	groups, skipped, err := ResolveJobTargets(db, job, nil, 0)
	require.NoError(t, err)
	require.Empty(t, skipped)
	require.Len(t, groups, 1)
	assert.Equal(t, "10.0.2.7", groups[0].Targets[0], "target = 所选类别实例在 target_field 上的值")
	assert.Equal(t, "bb-db-1", groups[0].Labels["resource_id"], "标签仍注入")
}

// TestResolveTargetsBlackboxFieldValueEmpty：字段值缺失/为空 → 记 address_empty 归因，
// 不产出 target（复用既有 SkipReasonAddressEmpty）。
func TestResolveTargetsBlackboxFieldValueEmpty(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Database{}, &models.LabelTemplate{}))
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: "bb-db-2", ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: "d", Status: "online", SourceType: models.SourceTypeManual,
		},
		DatabaseType: "mysql", InstanceIP: "", Port: 3306,
		ResourceType: models.ResourceTypeDatabase,
	}).Error)

	job := models.ScrapeJob{
		JobName: "bb-empty", JobType: models.JobTypeBlackbox, ResourceType: models.ResourceTypeDatabase,
		TargetField: "instance_ip", NetworkDomainID: "d", SelectedInstanceIDs: []string{"bb-db-2"},
	}
	groups, skipped, err := ResolveJobTargets(db, job, nil, 0)
	require.NoError(t, err)
	require.Empty(t, groups)
	require.Len(t, skipped, 1)
	assert.Equal(t, "bb-db-2", skipped[0].ResourceID)
	assert.Equal(t, SkipReasonAddressEmpty, skipped[0].Reason)
}

// TestResolveTargetsUnconfirmedIncluded（决策 47-1：安装确认拆闸门）：
// 已选实例即使是 unconfirmed（存在未确认登记记录），也必须同样进入 target 组——
// configgen 只消费 selected_instance_ids（+ offline 排除 + enabled + draft_status），
// 不读取 ExporterInstallationConfirmation 做排除/校验。
func TestResolveTargetsUnconfirmedIncluded(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Host{}, &models.LabelTemplate{}, &models.ExporterInstallationConfirmation{}))

	// 未确认：选中实例且存在 Status=unconfirmed 的确认记录（未登记/未确认均不影响生成）。
	require.NoError(t, db.Create(&models.Host{ServerID: "srv-u", ResourceID: "srv-u", NetworkDomainID: "d", PrivateIP: "10.0.1.9", Status: "online", AppCode: "pay"}).Error)
	require.NoError(t, db.Create(&models.ExporterInstallationConfirmation{
		ResourceID:  "srv-u",
		ScrapeJobID: 1,
		Status:      models.InstallationStatusUnconfirmed,
	}).Error)

	tmpl := &models.LabelTemplate{Name: "host-default", ResourceCategory: models.ResourceCategoryHost, IsDefault: true,
		Mappings: []models.LabelMapping{{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true}}}
	require.NoError(t, db.Create(tmpl).Error)

	job := models.ScrapeJob{JobName: "node-prod", ResourceType: models.ResourceTypeHost, NetworkDomainID: "d",
		DraftStatus: "ready", Enabled: true, SelectedInstanceIDs: []string{"srv-u"}}
	groups, _, err := ResolveJobTargets(db, job, tmpl, 9100)
	require.NoError(t, err)
	require.Len(t, groups, 1, "未确认实例必须同样进入 target 组（决策 47-1）")
	assert.Equal(t, "10.0.1.9:9100", groups[0].Targets[0])
	assert.Equal(t, "pay", groups[0].Labels["app"])
}

// TestResolveTargetsInjectsResourceID（决策 47-3 回归）：
// resource_id 是 M02 coverage 三态判定的回连键，必须作为 system 层身份标签
// 强制注入到每个 target 组——不依赖是否挂载标签模板，也不可被模板映射覆盖。
// 此前 labels 完全依赖模板展开且字段视图缺 resource_id，导致 up 序列无
// resource_id 标签，coverage 恒判「已下发未采到」。
func TestResolveTargetsInjectsResourceID(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Host{}, &models.LabelTemplate{}))
	require.NoError(t, db.Create(&models.Host{ServerID: "srv-1", ResourceID: "srv-1", NetworkDomainID: "d", PrivateIP: "10.0.1.1", Status: "online"}).Error)

	t.Run("无标签模板也注入 resource_id", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"srv-1"}}, nil, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		assert.Equal(t, "srv-1", groups[0].Labels["resource_id"])
	})

	t.Run("模板映射不可覆盖 resource_id", func(t *testing.T) {
		tmpl := &models.LabelTemplate{Name: "t", ResourceCategory: models.ResourceCategoryHost, Mappings: []models.LabelMapping{
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "resource_id", Enabled: true},
		}}
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"srv-1"}}, tmpl, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		assert.Equal(t, "srv-1", groups[0].Labels["resource_id"], "system 身份标签不可被模板覆盖")
	})
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
	require.NoError(t, db.Create(&models.Application{ResourceID: "app1", NetworkDomainID: "d", Status: "online", Endpoint: "10.0.1.4", Port: 8080}).Error)
	require.NoError(t, db.Create(&models.GenericTarget{ResourceBase: models.ResourceBase{ResourceID: "gt1", NetworkDomainID: "d", Status: "online"}, InstanceIP: "10.0.1.5", Port: 161}).Error)

	tmpl := &models.LabelTemplate{Name: "t", ResourceCategory: models.ResourceCategoryHost, IsDefault: true,
		Mappings: []models.LabelMapping{{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true}}}
	require.NoError(t, db.Create(tmpl).Error)

	t.Run("host 拼接 exporter 端口且 instance 组合字段带端口", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"h1"}}, tmpl, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		assert.Equal(t, "10.0.1.1:9100", groups[0].Targets[0])
		assert.Equal(t, "10.0.1.1:9100", groups[0].Labels["instance"])
	})
	t.Run("database 优先 exporter 端口而非业务端口", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"db1"}}, tmpl, 9104)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.2:9104", groups[0].Targets[0])
	})
	t.Run("middleware 优先 exporter 端口而非业务端口", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"mw1"}}, tmpl, 9121)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.3:9121", groups[0].Targets[0])
	})
	t.Run("exporter 端口为 0 时 database/middleware 回落业务端口", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"db1", "mw1"}}, tmpl, 0)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.2:3306", groups[0].Targets[0])
		assert.Equal(t, "10.0.1.3:6379", groups[1].Targets[0])
	})
	t.Run("application 用 endpoint:port 采集地址、generic_target 用服务端口", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"app1", "gt1"}}, tmpl, 9100)
		require.NoError(t, err)
		assert.Equal(t, "10.0.1.4:8080", groups[0].Targets[0])
		assert.Equal(t, "10.0.1.5:161", groups[1].Targets[0])
	})
}

// TestExporterPortOrEquivalenceToPortchain 显式证明决策 D-1 的等价性：改动前
// exporterPortOr(exporterPort, businessPort)（db/mw 分支唯一端口语义）与接入后
// portchain.Resolve(0, exporterPort, 0, businessPort) 的端口值逐例相等——
// scrape_port 留空时生成地址零回归（提案 §9 回归断言）。参照实现留在测试内，
// 生产代码中的 exporterPortOr 已删除（D-1 方案 a，不留死代码）。
func TestExporterPortOrEquivalenceToPortchain(t *testing.T) {
	legacy := func(exporterPort, fallback int) int {
		if exporterPort > 0 {
			return exporterPort
		}
		return fallback
	}
	cases := []struct{ exporter, business int }{
		{9104, 3306}, // 映射/模板命中，业务兜底不生效（现网常态）
		{0, 3306},    // 策略层缺省 → 业务兜底（6379/3306 型事故链路）
		{0, 0},       // 全缺 → 0（裸 IP 失败态）
		{9104, 0},    // 策略层命中且无业务端口
		{9104, 6379}, // 两层都有值，业务端口永不越级
	}
	for _, c := range cases {
		got, _ := portchain.Resolve(0, c.exporter, 0, c.business)
		assert.Equal(t, legacy(c.exporter, c.business), got,
			"等价性: legacy exporterPortOr(exporter=%d, business=%d)", c.exporter, c.business)
	}
}

// TestResolveTargetsScrapePortChain 四级解析链接入回归（T01-P3，提案 §5.1/§9）：
// db/mw 不填 scrape_port 时生成地址与改动前逐字节一致；填了实例覆盖优先；host 无
// 业务 port 兜底（到模板层为止，全缺=裸 IP）；0 与 NULL 等价；app/gt 分支零改动
// （D3a/D3b 守护）——target 字符串逐字节断言。
func TestResolveTargetsScrapePortChain(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(
		&models.Host{}, &models.Database{}, &models.Middleware{},
		&models.Application{}, &models.GenericTarget{},
	))

	// db0：不带 scrape_port 字段（default 0 = 未指定）
	require.NoError(t, db.Create(&models.Database{ResourceBase: models.ResourceBase{
		ResourceID: "chain-db0", NetworkDomainID: "d", Status: "online",
	}, InstanceIP: "10.0.2.1", Port: 3306}).Error)
	// db1：显式实例覆盖 19100
	require.NoError(t, db.Create(&models.Database{ResourceBase: models.ResourceBase{
		ResourceID: "chain-db1", NetworkDomainID: "d", Status: "online", ScrapePort: 19100,
	}, InstanceIP: "10.0.2.2", Port: 3306}).Error)
	// db-null：手工置 NULL，验证 0/NULL 等价
	require.NoError(t, db.Create(&models.Database{ResourceBase: models.ResourceBase{
		ResourceID: "chain-db-null", NetworkDomainID: "d", Status: "online",
	}, InstanceIP: "10.0.2.3", Port: 3306}).Error)
	require.NoError(t, db.Exec("UPDATE databases SET scrape_port = NULL WHERE resource_id = ?", "chain-db-null").Error)
	// mw0：不填 scrape_port
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID: "chain-mw0", NetworkDomainID: "d", Status: "online",
		InstanceIP: "10.0.2.4", Port: 6379,
	}).Error)
	// host0 不填 / host1 填 19100（server_id 唯一索引，须区分）
	require.NoError(t, db.Create(&models.Host{
		ResourceID: "chain-h0", NetworkDomainID: "d", Status: "online", PrivateIP: "10.0.2.5",
		ServerID: "chain-srv-h0",
	}).Error)
	require.NoError(t, db.Create(&models.Host{
		ResourceID: "chain-h1", NetworkDomainID: "d", Status: "online", PrivateIP: "10.0.2.6", ScrapePort: 19100,
		ServerID: "chain-srv-h1",
	}).Error)
	// app/gt：守护对象（端口语义不进链）
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "chain-app", NetworkDomainID: "d", Status: "online", Endpoint: "10.0.2.7", Port: 8080,
	}).Error)
	require.NoError(t, db.Create(&models.GenericTarget{ResourceBase: models.ResourceBase{
		ResourceID: "chain-gt", NetworkDomainID: "d", Status: "online",
	}, InstanceIP: "10.0.2.8", Port: 161}).Error)

	target := func(t *testing.T, rid string, exporterPort int) string {
		t.Helper()
		groups, _, err := ResolveJobTargets(db,
			models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{rid}}, nil, exporterPort)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		require.Len(t, groups[0].Targets, 1)
		return groups[0].Targets[0]
	}

	t.Run("db 不填 scrape_port：策略层命中，与改动前逐字节一致", func(t *testing.T) {
		assert.Equal(t, "10.0.2.1:9104", target(t, "chain-db0", 9104))
	})
	t.Run("db 不填 scrape_port 且策略层缺省：业务端口兜底（等价 exporterPortOr(0,3306)）", func(t *testing.T) {
		assert.Equal(t, "10.0.2.1:3306", target(t, "chain-db0", 0))
	})
	t.Run("db 填 scrape_port：实例覆盖优先于映射/业务", func(t *testing.T) {
		assert.Equal(t, "10.0.2.2:19100", target(t, "chain-db1", 9104))
		assert.Equal(t, "10.0.2.2:19100", target(t, "chain-db1", 0))
	})
	t.Run("0 与 NULL 等价：NULL 行与 0 行解析端口逐字节相同", func(t *testing.T) {
		portOf := func(addr string) string {
			if i := strings.LastIndex(addr, ":"); i >= 0 {
				return addr[i:]
			}
			return addr
		}
		// db0（0）与 db-null（NULL）仅 IP 不同，端口解析结果须完全一致
		assert.Equal(t, portOf(target(t, "chain-db0", 9104)), portOf(target(t, "chain-db-null", 9104)))
		assert.Equal(t, portOf(target(t, "chain-db0", 0)), portOf(target(t, "chain-db-null", 0)))
		assert.Equal(t, "10.0.2.3:9104", target(t, "chain-db-null", 9104))
		assert.Equal(t, "10.0.2.3:3306", target(t, "chain-db-null", 0))
	})
	t.Run("mw 同口径：留空=策略层/业务兜底，填了=实例覆盖", func(t *testing.T) {
		assert.Equal(t, "10.0.2.4:9121", target(t, "chain-mw0", 9121))
		assert.Equal(t, "10.0.2.4:6379", target(t, "chain-mw0", 0))
	})
	t.Run("host 无业务 port 兜底：留空且策略层缺省=裸 IP（unresolved 不展示 0）", func(t *testing.T) {
		assert.Equal(t, "10.0.2.5", target(t, "chain-h0", 0))
		assert.Equal(t, "10.0.2.5:9100", target(t, "chain-h0", 9100))
		assert.Equal(t, "10.0.2.6:19100", target(t, "chain-h1", 9100), "host 实例覆盖优先")
	})
	t.Run("app/gt 分支零改动：exporterPort 存在也不进链（D3a/D3b 守护）", func(t *testing.T) {
		assert.Equal(t, "10.0.2.7:8080", target(t, "chain-app", 9100))
		assert.Equal(t, "10.0.2.8:161", target(t, "chain-gt", 9100))
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

// TestLoadExporterPortIsDefaultFilter 缺陷 D2（提案 resource-scrape-port-chain §7）：
// LoadExporterPort 此前仅按 monitor_type 取行（Order is_default desc），is_default=false
// 的映射行也会被选中参与端口解析；须与 strategy/scrapejob resolveJobScrapeParams 的
// `monitor_type = ? AND is_default = true` 口径严格一致——非默认行不算命中。
func TestLoadExporterPortIsDefaultFilter(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.CITypeExporterMapping{}, &models.ExporterTemplate{}))

	tmpl := &models.ExporterTemplate{Name: "d2-node-exporter", DefaultPort: 9100}
	require.NoError(t, db.Create(tmpl).Error)
	tmplID := strconv.FormatUint(uint64(tmpl.ID), 10)

	t.Run("仅非默认映射时跳过映射层回落模板", func(t *testing.T) {
		require.NoError(t, db.Create(&models.CITypeExporterMapping{MonitorType: "d2_only_false", IsDefault: false, DefaultPort: 9999}).Error)
		port, err := LoadExporterPort(db, models.ScrapeJob{MonitorType: "d2_only_false", ExporterTemplateID: tmplID})
		require.NoError(t, err)
		assert.Equal(t, 9100, port, "is_default=false 的映射不得参与端口解析，应回落采集器模板")
	})

	t.Run("仅非默认映射且无模板时返回 0", func(t *testing.T) {
		port, err := LoadExporterPort(db, models.ScrapeJob{MonitorType: "d2_only_false"})
		require.NoError(t, err)
		assert.Equal(t, 0, port, "非默认映射不算命中，映射/模板皆缺返回 0")
	})

	t.Run("混合行只取 is_default=true", func(t *testing.T) {
		require.NoError(t, db.Create(&models.CITypeExporterMapping{MonitorType: "d2_mixed", IsDefault: false, DefaultPort: 9999}).Error)
		require.NoError(t, db.Create(&models.CITypeExporterMapping{MonitorType: "d2_mixed", IsDefault: true, DefaultPort: 9100}).Error)
		port, err := LoadExporterPort(db, models.ScrapeJob{MonitorType: "d2_mixed"})
		require.NoError(t, err)
		assert.Equal(t, 9100, port, "false=9999 / true=9100 混合行必须取默认行")
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

// TestValidateTargetGroupsRejectsEmpty 覆盖 C-2：空数组（零组）即非法，与边缘 Agent
// ValidateTargetsJSON 的 `empty array` 口径对称。零组意味着该 targets 文件无任何有效
// 采集目标，放行会让「资源地址缺失」这类用户配置缺陷静默通过。
func TestValidateTargetGroupsRejectsEmpty(t *testing.T) {
	assert.Error(t, ValidateTargetGroups(nil), "nil 组必须判非法")
	assert.Error(t, ValidateTargetGroups([]TargetGroup{}), "空数组必须判非法")
	// 与边缘同一入口口径：targets/*.json 内容为 `[]` 时解析出的组为空 → 必须报错。
	var groups []TargetGroup
	require.NoError(t, json.Unmarshal([]byte("[]"), &groups))
	require.Empty(t, groups)
	assert.Error(t, ValidateTargetGroups(groups), "targets JSON 为 [] 时必须报错（与边缘对称回归）")
}

// TestApplicationEmptyAddressGuarded 覆盖 C §5.1-1：application 的采集地址
// （endpoint 主机 + port 采集端口）为空 → 该 Job 解析不出目标（不再静默产出可下发产物）：
//   - ResolveJobTargets 返回 0 组 + address_empty 归因（含 ResourceID 与采集地址文案）；
//   - ValidateTargetGroups 对空组报错；
//   - ValidateArtifacts 判 failed + cause=user_config，validation_details 含文件名，
//     文案含 Job 名 + ResourceID + 原因（资源级归因）。
func TestApplicationEmptyAddressGuarded(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Application{}))
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43",
		Status:     "online",
		// Endpoint / Port 故意留空（现场根因）。
	}).Error)

	job := models.ScrapeJob{JobName: "test-app-01", JobType: models.JobTypeStandard,
		SelectedInstanceIDs: []string{"33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43"}}
	groups, skipped, err := ResolveJobTargets(db, job, nil, 9100)
	require.NoError(t, err)
	require.Empty(t, groups, "地址为空实例不得进入产物 targets")
	require.Len(t, skipped, 1)
	assert.Equal(t, "33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43", skipped[0].ResourceID)
	assert.Equal(t, string(models.ResourceCategoryApplication), skipped[0].Category)
	assert.Equal(t, SkipReasonAddressEmpty, skipped[0].Reason)
	assert.Contains(t, skipped[0].Detail, "采集地址")

	content, err := MarshalTargetGroups(groups)
	require.NoError(t, err)
	fname := normalizeJobFilename(job.JobName)
	ca := &ConfigArtifacts{
		TargetsFiles: map[string]string{fname: content},
		TargetDiagnostics: []TargetDiagnostics{{
			JobName:  job.JobName,
			FileName: "targets/" + fname,
			Skipped:  skipped,
		}},
	}

	assert.Error(t, ValidateTargetGroups(groups), "空组必须判非法")
	status, cause, details, msg := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause)
	require.Len(t, details, 1)
	assert.Equal(t, fname, details[0].File, "details 须含 targets 文件名")
	assert.Equal(t, models.ValidationSourceTargets, details[0].Source)
	assert.Contains(t, details[0].Message, job.JobName, "文案须含 Job 名")
	assert.Contains(t, details[0].Message, "33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43", "文案须含 ResourceID")
	assert.Contains(t, details[0].Message, "采集地址", "文案须含原因")
	assert.Contains(t, msg, job.JobName)

	// 无归因回落路径（如「重新校验」从 DB 重建产物）：判定结果与归因无关，完全一致。
	caNoDiag := &ConfigArtifacts{TargetsFiles: map[string]string{fname: content}}
	status2, cause2, details2, _ := ValidateArtifacts(caNoDiag, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, status2)
	assert.Equal(t, models.ValidationCauseUserConfig, cause2)
	require.Len(t, details2, 1)
	assert.Contains(t, details2[0].Message, "targets 文件", "无归因时回落通用文案")
}

// TestAllInstancesOfflineMessageDiffersFromAddressEmpty 覆盖 C §7 决策 2：
// 「Job 已选实例全部 offline」同样判 failed 阻断，但文案必须区分成因——
// 全部下线引导「移除该 Job 或恢复实例」，地址为空引导「补齐采集地址」。
func TestAllInstancesOfflineMessageDiffersFromAddressEmpty(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Host{}, &models.Application{}))
	require.NoError(t, db.Create(&models.Host{ServerID: "srv-c-off", ResourceID: "c-off", Status: "offline", PrivateIP: "10.0.1.1"}).Error)
	require.NoError(t, db.Create(&models.Application{ResourceID: "c-app-empty", Status: "online"}).Error)

	// 全部 offline：offline 归因（设计预期排除），不得产 address_empty。
	offGroups, offSkipped, err := ResolveJobTargets(db,
		models.ScrapeJob{JobName: "off-job", SelectedInstanceIDs: []string{"c-off"}}, nil, 9100)
	require.NoError(t, err)
	require.Empty(t, offGroups)
	require.Len(t, offSkipped, 1)
	assert.Equal(t, SkipReasonOffline, offSkipped[0].Reason)
	for _, s := range offSkipped {
		assert.NotEqual(t, SkipReasonAddressEmpty, s.Reason, "offline 实例不得产生 address_empty 归因")
	}

	offContent, err := MarshalTargetGroups(offGroups)
	require.NoError(t, err)
	offStatus, offCause, offDetails, _ := ValidateArtifacts(&ConfigArtifacts{
		TargetsFiles: map[string]string{"off-job.json": offContent},
		TargetDiagnostics: []TargetDiagnostics{{
			JobName: "off-job", FileName: "targets/off-job.json", Skipped: offSkipped,
		}},
	}, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, offStatus, "全部 offline 也必须阻断（决策 2）")
	assert.Equal(t, models.ValidationCauseUserConfig, offCause)
	require.Len(t, offDetails, 1)
	assert.Contains(t, offDetails[0].Message, "所有已选实例均已下线")

	// 地址为空：另一种成因，文案必须与「全部下线」不同。
	emptyGroups, emptySkipped, err := ResolveJobTargets(db,
		models.ScrapeJob{JobName: "empty-job", SelectedInstanceIDs: []string{"c-app-empty"}}, nil, 9100)
	require.NoError(t, err)
	require.Empty(t, emptyGroups)
	emptyContent, err := MarshalTargetGroups(emptyGroups)
	require.NoError(t, err)
	emptyStatus, _, emptyDetails, _ := ValidateArtifacts(&ConfigArtifacts{
		TargetsFiles: map[string]string{"empty-job.json": emptyContent},
		TargetDiagnostics: []TargetDiagnostics{{
			JobName: "empty-job", FileName: "targets/empty-job.json", Skipped: emptySkipped,
		}},
	}, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, emptyStatus)
	require.Len(t, emptyDetails, 1)
	assert.Contains(t, emptyDetails[0].Message, "实例采集地址为空")
	assert.NotEqual(t, offDetails[0].Message, emptyDetails[0].Message, "两类成因文案必须不同")
}

// TestResolveTargetsAllValidUnaffected 覆盖 C §5.1-3 回归：目标全部合法时不受影响；
// offline 实例仍按设计排除且不产生 address_empty 归因。
func TestResolveTargetsAllValidUnaffected(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.Host{}))
	require.NoError(t, db.Create(&models.Host{ServerID: "srv-c-v1", ResourceID: "c-v1", Status: "online", PrivateIP: "10.0.1.1"}).Error)
	require.NoError(t, db.Create(&models.Host{ServerID: "srv-c-voff", ResourceID: "c-voff", Status: "offline", PrivateIP: "10.0.1.2"}).Error)

	groups, skipped, err := ResolveJobTargets(db,
		models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"c-v1", "c-voff"}}, nil, 9100)
	require.NoError(t, err)
	require.Len(t, groups, 1, "offline 实例仍按设计排除")
	assert.Equal(t, "10.0.1.1:9100", groups[0].Targets[0])
	require.Len(t, skipped, 1, "仅 offline 实例产生归因")
	assert.Equal(t, SkipReasonOffline, skipped[0].Reason)
	assert.Equal(t, "c-voff", skipped[0].ResourceID)

	assert.NoError(t, ValidateTargetGroups(groups), "合法目标不得被新判定误伤")
}

// TestChecksumUnaffectedByTargetDiagnostics 覆盖 C §5.1-4：TargetDiagnostics 是
// **非产物字段**——内容变化不得改变 Checksum()，也不得改变变更检测判定。
func TestChecksumUnaffectedByTargetDiagnostics(t *testing.T) {
	base := &ConfigArtifacts{
		PrometheusYML:   "global: {}\n",
		TargetsFiles:    map[string]string{"j.json": `[{"targets":["10.0.1.1"],"labels":{}}]`},
		AlertmanagerYML: "route:\n  receiver: r\n",
	}
	withDiag := &ConfigArtifacts{
		PrometheusYML:   base.PrometheusYML,
		TargetsFiles:    base.TargetsFiles,
		AlertmanagerYML: base.AlertmanagerYML,
		TargetDiagnostics: []TargetDiagnostics{{
			JobName: "j", FileName: "targets/j.json",
			Skipped: []SkippedInstance{{ResourceID: "r1", Category: "host", Reason: SkipReasonOffline, Detail: "实例已下线"}},
		}},
	}
	assert.Equal(t, base.Checksum(), withDiag.Checksum(), "归因不得参与 checksum")
	assert.False(t, withDiag.ArtifactsChanged(base.Checksum()), "归因不得触发变更检测")
}

func TestValidateArtifactsPendingWhenToolMissing(t *testing.T) {
	old := ToolLookPath
	ToolLookPath = func(string) (string, error) { return "", errToolMissing }
	t.Cleanup(func() { ToolLookPath = old })

	// C-2 后空 targets 判非法先于工具可用性检查，故此处须给出非空合法目标，
	// 才能落到「工具缺失 → pending」分支。
	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}}}, nil, "", "", true)
	status, cause, details, msg := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusPending, status)
	assert.Equal(t, models.ValidationCausePlatformFault, cause, "promtool 缺失应归因为平台故障")
	assert.Empty(t, details)
	assert.NotEmpty(t, msg)
}

func TestValidateArtifactsPassed(t *testing.T) {
	oldLook := ToolLookPath
	oldChecker := ToolChecker
	ToolLookPath = func(string) (string, error) { return "promtool", nil }
	ToolChecker = func(ca *ConfigArtifacts, ib bool) (ToolCheckStatus, string) { return ToolCheckPassed, "" }
	t.Cleanup(func() { ToolLookPath = oldLook; ToolChecker = oldChecker })

	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}}}, nil, "", "", true)
	status, cause, details, _ := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusPassed, status)
	assert.Empty(t, cause)
	assert.Empty(t, details)
}

func TestValidateArtifactsFailedSchema(t *testing.T) {
	// 给出非空合法目标，避免空 targets（C-2）先行命中干扰本用例聚焦的 schema 失败。
	ca, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}}}, nil, "", "", true)
	ca.TargetsFiles["j.json"] = "not-json"
	status, cause, details, _ := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause, "targets schema 失败应归因为用户配置")
	assert.Len(t, details, 1)
	assert.Equal(t, "j.json", details[0].File)
	// 保护标签冲突亦归因 user_config 且带结构化定位。
	ca2, _ := Assemble("d", "", "", []JobBuild{{Job: models.ScrapeJob{JobName: "j"}, Targets: []TargetGroup{{Targets: []string{"10.0.1.10"}}}}}, nil, "", "", true)
	ca2.TargetsFiles["a.json"] = `[{"targets":["10.0.1.10"],"labels":{"job":"x"}}]`
	status2, cause2, details2, _ := ValidateArtifacts(ca2, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, status2)
	assert.Equal(t, models.ValidationCauseUserConfig, cause2)
	assert.Equal(t, "a.json", details2[0].File)
	assert.Contains(t, details2[0].Message, "禁止覆盖内置标签")
}

func TestSourceDataVersionAndNeedsRegeneration(t *testing.T) {
	db := newMemDB(t)
	// 源数据版本聚合会横跨所有源表，需一次性迁移全量（避免不存在的表导致扫描失败）。
	require.NoError(t, db.AutoMigrate(&models.ScrapeJob{}, &models.Host{}, &models.Database{},
		&models.Middleware{}, &models.Application{}, &models.GenericTarget{}, &models.InterfaceService{},
		&models.MonitoringRule{},
		&models.LabelTemplate{}, &models.CITypeExporterMapping{}, &models.ExporterInstallationConfirmation{},
		&models.NotifyChannel{}, &models.NotifyTemplate{}, &models.AlertmanagerRouteSetting{}))
	require.NoError(t, db.Create(&models.ScrapeJob{JobName: "j", NetworkDomainID: "d", MetricsPath: "/m", Scheme: "http",
		ResourceType: models.ResourceTypeHost, MonitorType: "host_linux", DraftStatus: "ready",
		Enabled: true}).Error)

	v, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	assert.NotEmpty(t, v)
	assert.True(t, NeedsRegeneration("", v), "版本推进应触发重算")
	assert.False(t, NeedsRegeneration(v, v), "版本未变化跳过")
}

// ---- 源数据版本必须感知软删：GORM 软删只写 deleted_at、不更新 updated_at ----

// newSourceVersionDB 建按测试名隔离的内存库并迁移全部源表。
// 不用 newMemDB：其 DSN 为 file::memory:?cache=shared 全进程共享，版本聚合横跨
// 所有源表、要求精确可控的起点，共享库会让他例用例的残留行污染聚合结果。
func newSourceVersionDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:srcver_"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	// 源数据版本聚合横跨所有源表，需一次性迁移全量（避免不存在的表导致扫描失败）。
	require.NoError(t, db.AutoMigrate(&models.ScrapeJob{}, &models.Host{}, &models.Database{},
		&models.Middleware{}, &models.Application{}, &models.GenericTarget{}, &models.InterfaceService{},
		&models.MonitoringRule{},
		&models.LabelTemplate{}, &models.CITypeExporterMapping{}, &models.NotifyChannel{},
		&models.NotifyTemplate{}, &models.AlertmanagerRouteSetting{}))
	return db
}

// hostVersionSeedAt 是测试基准时刻（远早于「现在」），使「删除只推进 deleted_at」
// 可被确定性断言，不依赖墙钟先后与执行速度。
var hostVersionSeedAt = time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)

// seedVersionHost 造一条 updated_at 钉在 hostVersionSeedAt 的 host。
func seedVersionHost(t *testing.T, db *gorm.DB, domainID, serverID, resourceID string) *models.Host {
	t.Helper()
	h := &models.Host{
		BaseModel:       models.BaseModel{UpdatedAt: hostVersionSeedAt},
		ServerID:        serverID,
		ResourceID:      resourceID,
		NetworkDomainID: domainID,
		PrivateIP:       "10.0.1.1",
		Status:          "online",
	}
	require.NoError(t, db.Create(h).Error)
	return h
}

// softDeleteHost 走 GORM 软删（只写 deleted_at，与 platform/config/resource/delete.go 同一路径）。
func softDeleteHost(t *testing.T, db *gorm.DB, h *models.Host) {
	t.Helper()
	require.NoError(t, db.Delete(&models.Host{BaseModel: models.BaseModel{ID: h.ID}}).Error)
}

// hostMaxUpdatedAt / hostMaxDeletedAt 取 hosts 表的 MAX(updated_at) / MAX(deleted_at) 原始字符串。
// 均显式 Unscoped，否则 GORM 的 deleted_at IS NULL 会把软删行整体滤掉、看不到删除时刻。
func hostMaxUpdatedAt(t *testing.T, db *gorm.DB, domainID string) *string {
	t.Helper()
	var s *string
	require.NoError(t, db.Unscoped().Model(&models.Host{}).Select("MAX(updated_at)").
		Where("network_domain_id = ?", domainID).Scan(&s).Error)
	return s
}

func hostMaxDeletedAt(t *testing.T, db *gorm.DB, domainID string) *string {
	t.Helper()
	var s *string
	require.NoError(t, db.Unscoped().Model(&models.Host{}).Select("MAX(deleted_at)").
		Where("network_domain_id = ?", domainID).Scan(&s).Error)
	return s
}

// TestSourceDataVersionStableWithoutChange 未发生任何变更时版本必须逐字节稳定：
// 纳入 deleted_at 不得凭空制造版本抖动，否则 watcher 每轮都重算、退避机制失效。
func TestSourceDataVersionStableWithoutChange(t *testing.T) {
	db := newSourceVersionDB(t)
	seedVersionHost(t, db, "d", "srv-keep", "res-keep")
	seedVersionHost(t, db, "d", "srv-keep2", "res-keep2")

	first, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	require.NotEmpty(t, first)

	// 反复取值应完全一致（含删除发生之后——删除推进一次，随后再次稳定）。
	second, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	assert.Equal(t, first, second, "无变更时版本必须稳定")
	assert.False(t, NeedsRegeneration(first, second), "版本未变化须跳过本轮")

	softDeleteHost(t, db, &models.Host{BaseModel: models.BaseModel{ID: 1}})
	afterDelete, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	require.NotEqual(t, first, afterDelete, "删除推进一次")

	stable, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	assert.Equal(t, afterDelete, stable, "删除后再次取值须稳定")
	assert.False(t, NeedsRegeneration(afterDelete, stable), "删除后稳定轮次须跳过")
}

// TestSourceDataVersionAdvancesOnSoftDelete 是本缺陷的核心锁定断言：
// 软删资源后源数据版本必须推进。否则 NeedsRegeneration 恒 false，watcher 永远走
// 「源数据未变化」退避分支，永不产出配置草稿、用户零提醒。
func TestSourceDataVersionAdvancesOnSoftDelete(t *testing.T) {
	db := newSourceVersionDB(t)
	h := seedVersionHost(t, db, "d", "srv-del", "res-del")

	before, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	require.NotEmpty(t, before)

	softDeleteHost(t, db, h)

	after, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	assert.NotEqual(t, before, after, "软删必须推进源数据版本，否则删除动作永远不进版本流、变更检测不产草稿")
	assert.Greater(t, after, before, "版本应单调推进（字符串字典序）")
	assert.True(t, NeedsRegeneration(before, after), "版本推进须触发重算")
}

// TestSourceDataVersionAdvancesOnDeletedAtOnly 精确锁定根因：
// 删除前后 MAX(updated_at) 逐字节不变、仅 deleted_at 推进，版本仍须变化。
func TestSourceDataVersionAdvancesOnDeletedAtOnly(t *testing.T) {
	db := newSourceVersionDB(t)
	h := seedVersionHost(t, db, "d", "srv-only", "res-only")

	updatedBefore := hostMaxUpdatedAt(t, db, "d")
	require.NotNil(t, updatedBefore)
	require.Nil(t, hostMaxDeletedAt(t, db, "d"), "初始无删除行，deleted_at 聚合应为 NULL")

	vBefore, err := SourceDataVersion(db, "d")
	require.NoError(t, err)

	softDeleteHost(t, db, h)

	updatedAfter := hostMaxUpdatedAt(t, db, "d")
	require.NotNil(t, updatedAfter)
	assert.Equal(t, *updatedBefore, *updatedAfter, "GORM 软删不更新 updated_at（本缺陷前提）")

	deletedAfter := hostMaxDeletedAt(t, db, "d")
	require.NotNil(t, deletedAfter, "软删后 deleted_at 应有值")

	vAfter, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	assert.Equal(t, *deletedAfter, vAfter, "版本应由 deleted_at 推进")
	assert.True(t, NeedsRegeneration(vBefore, vAfter), "仅 deleted_at 变化也须触发重算")
}

// TestSourceDataVersionPureNullDeletedAt 从未删除过任何行时，全部源表的 deleted_at 聚合为 NULL，
// 版本计算不得被 NULL 破坏：不 panic、不塌成空串、不误判。
func TestSourceDataVersionPureNullDeletedAt(t *testing.T) {
	db := newSourceVersionDB(t)
	seedVersionHost(t, db, "d", "srv-null", "res-null")

	require.Nil(t, hostMaxDeletedAt(t, db, "d"), "从未删除时 deleted_at 恒 NULL")

	v, err := SourceDataVersion(db, "d")
	require.NoError(t, err)
	require.NotEmpty(t, v, "纯 NULL deleted_at 不得把版本压成空串")

	updated := hostMaxUpdatedAt(t, db, "d")
	require.NotNil(t, updated)
	assert.Equal(t, *updated, v, "无删除时版本等于纯 updated_at 聚合结果")
	assert.True(t, NeedsRegeneration("", v), "首次见到版本应触发重算")
}

// TestSourceDataVersionEmptyDB 全部源表皆空（updated_at / deleted_at 双双为 NULL）时
// 版本返回空串且不触发重算，与既有空数据语义一致。
func TestSourceDataVersionEmptyDB(t *testing.T) {
	empty, err := SourceDataVersion(newSourceVersionDB(t), "d")
	require.NoError(t, err)
	assert.Equal(t, "", empty, "无任何数据时版本为空串")
	assert.False(t, NeedsRegeneration("v1", empty), "空版本不触发重算")
}

// TestSourceDataVersionDomainScopedDeleteIsolation domainScoped 过滤须对 deleted_at 聚合
// 同样生效：删除 A 域资源只推进 A 域版本，不得向 B 域广播噪声变更。
func TestSourceDataVersionDomainScopedDeleteIsolation(t *testing.T) {
	db := newSourceVersionDB(t)
	hostA := seedVersionHost(t, db, "domain-a", "srv-a", "res-a")
	seedVersionHost(t, db, "domain-b", "srv-b", "res-b")

	aBefore, err := SourceDataVersion(db, "domain-a")
	require.NoError(t, err)
	bBefore, err := SourceDataVersion(db, "domain-b")
	require.NoError(t, err)
	require.Equal(t, aBefore, bBefore, "两域起点相同，便于归因")

	softDeleteHost(t, db, hostA)

	aAfter, err := SourceDataVersion(db, "domain-a")
	require.NoError(t, err)
	bAfter, err := SourceDataVersion(db, "domain-b")
	require.NoError(t, err)

	assert.NotEqual(t, aBefore, aAfter, "A 域自身删除须推进 A 域版本")
	assert.Equal(t, bBefore, bAfter, "A 域删除不得推进 B 域版本")
	assert.False(t, NeedsRegeneration(bBefore, bAfter), "B 域不应因他域删除触发重算")
}

// TestSourceDataVersionRouteSettingDomainScoped AlertmanagerRouteSetting 亦为 domainScoped=true
// （决策 113：alertmanager.yml 恒属 default），删除须只推进所属域版本。
func TestSourceDataVersionRouteSettingDomainScoped(t *testing.T) {
	db := newSourceVersionDB(t)
	setting := &models.AlertmanagerRouteSetting{
		NetworkDomainID: "default",
		Mode:            models.RouteModeManaged,
	}
	require.NoError(t, db.Create(setting).Error)

	// 先把该行的 updated_at 钉在基准时刻（UpdateColumn 避开 GORM 的 autoUpdateTime），
	// 再删——否则「建行」与「软删」在同一次时钟刻度内完成时（Windows 时钟粒度可达
	// 亚毫秒，两次 time.Now() 逐字节相同），deleted_at 与前一刻的 updated_at 相等，
	// 版本不推进，断言假失败。与 seedVersionHost 同法：让断言只依赖「删除推进
	// deleted_at」，不依赖墙钟先后与执行速度。
	require.NoError(t, db.Model(&models.AlertmanagerRouteSetting{}).
		Where("id = ?", setting.ID).
		UpdateColumn("updated_at", hostVersionSeedAt).Error)

	// 造一个更早的版本起点，便于观察删除是否推进。
	seedVersionHost(t, db, "other-domain", "srv-o", "res-o")

	before, err := SourceDataVersion(db, "default")
	require.NoError(t, err)
	require.NotEmpty(t, before)

	require.NoError(t, db.Delete(&models.AlertmanagerRouteSetting{BaseModel: models.BaseModel{ID: setting.ID}}).Error)

	after, err := SourceDataVersion(db, "default")
	require.NoError(t, err)
	assert.NotEqual(t, before, after, "删除管理域单例设定须推进 default 域版本")
}

// ---- helper clones string for composite label expansion ----

func TestExpandLabelTemplateComposite(t *testing.T) {
	tmpl := &models.LabelTemplate{Name: "t", Mappings: []models.LabelMapping{
		{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
		{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
	}}
	labels := expandLabelTemplate(tmpl, map[string]string{"app_name": "pay"}, "10.0.1.1:9100", nil)
	assert.Equal(t, "10.0.1.1:9100", labels["instance"])
	assert.Equal(t, "pay", labels["app"])
}

// TestExpandLabelTemplateDictTransform：transform=dict 把字典编码翻译为展示名；
// 未命中字典时回退原始 code（不丢标签、不阻断生成）。
func TestExpandLabelTemplateDictTransform(t *testing.T) {
	dict := &labelDictionary{
		appNames:      map[string]string{"ceshi": "测试应用"},
		bizNames:      map[string]string{"authorized-ops": "授权运营"},
		platformNames: map[string]string{"k8s-prod": "生产 K8s 平台"},
		domainNames:   map[string]string{"nd-1": "政务网 A 区"},
	}
	tmpl := &models.LabelTemplate{Mappings: []models.LabelMapping{
		{SourceField: "app_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true, Transform: models.LabelTransformDict},
		{SourceField: "biz_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true, Transform: models.LabelTransformDict},
		{SourceField: "platform_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "platform", Enabled: true, Transform: models.LabelTransformDict},
		{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true, Transform: models.LabelTransformDict},
		{SourceField: "network_domain_id", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "domain_name", Enabled: true, Transform: models.LabelTransformDict},
		{SourceField: "app_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app_unknown", Enabled: true, Transform: models.LabelTransformDict},
	}}
	labels := expandLabelTemplate(tmpl, map[string]string{
		"app_code":          "ceshi",
		"biz_code":          "authorized-ops",
		"platform_code":     "k8s-prod",
		"env":               "prod",
		"network_domain_id": "nd-1",
	}, "10.0.1.1:9100", dict)

	assert.Equal(t, "测试应用", labels["app"])
	assert.Equal(t, "授权运营", labels["biz"])
	assert.Equal(t, "生产 K8s 平台", labels["platform"])
	assert.Equal(t, "生产", labels["env"])
	assert.Equal(t, "政务网 A 区", labels["domain_name"])

	// 字典未命中：回退原始 code。
	unknown := expandLabelTemplate(&models.LabelTemplate{Mappings: []models.LabelMapping{
		{SourceField: "app_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true, Transform: models.LabelTransformDict},
	}}, map[string]string{"app_code": "not-registered"}, "", dict)
	assert.Equal(t, "not-registered", unknown["app"])
}

// TestResolveTargetsDictTransform：生成链路端到端验证——host 字段视图必须暴露
// app_code（§5.12.1 权威来源字段），且 transform=dict 使用应用字典展示名。
func TestResolveTargetsDictTransform(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(
		&models.Host{}, &models.ApplicationDict{}, &models.BusinessDomain{},
		&models.PlatformDict{}, &models.NetworkDomain{}, &models.LabelTemplate{},
	))
	require.NoError(t, db.Create(&models.ApplicationDict{AppCode: "dict-app", AppName: "字典应用", Status: "enabled"}).Error)
	require.NoError(t, db.Create(&models.Host{
		ServerID: "dict-host-1", ResourceID: "dict-host-1", NetworkDomainID: "dict-nd",
		PrivateIP: "10.9.0.1", Status: "online", AppCode: "dict-app", EnvFlag: "prod",
	}).Error)

	tmpl := &models.LabelTemplate{Name: "dict-tmpl", ResourceCategory: models.ResourceCategoryHost,
		Mappings: []models.LabelMapping{
			{SourceField: "app_code", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true, Transform: models.LabelTransformDict},
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true, Transform: models.LabelTransformDict},
		}}
	require.NoError(t, db.Create(tmpl).Error)

	job := models.ScrapeJob{JobName: "dict-job", ResourceType: models.ResourceTypeHost,
		NetworkDomainID: "dict-nd", SelectedInstanceIDs: []string{"dict-host-1"}}
	groups, _, err := ResolveJobTargets(db, job, tmpl, 9100)
	require.NoError(t, err)
	require.Len(t, groups, 1)
	assert.Equal(t, "字典应用", groups[0].Labels["app"])
	assert.Equal(t, "生产", groups[0].Labels["env"])
}

func TestMarshalTargetGroupsJSON(t *testing.T) {
	content, err := MarshalTargetGroups([]TargetGroup{{Targets: []string{"10.0.1.10"}, Labels: map[string]string{"app": "pay"}}})
	require.NoError(t, err)
	var out []map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(content), &out))
	assert.Equal(t, "10.0.1.10", out[0]["targets"].([]interface{})[0].(string))
	assert.True(t, strings.Contains(content, "app"))
}

// ---- T09-60-1: alertmanager.yml 纳入生成（决策 60：仅管理域 default 范围）----

func TestAssembleAlertmanagerYML(t *testing.T) {
	// 传入告警配置内容 → 产物携带，且 checksum 受其影响（内容变化触发变更检测）。
	ca, err := Assemble("default", "", "", nil, nil, "global:\n  resolve_timeout: 5m\nroute:\n  receiver: default\n", "", true)
	require.NoError(t, err)
	assert.Equal(t, "global:\n  resolve_timeout: 5m\nroute:\n  receiver: default\n", ca.AlertmanagerYML)

	ca2, err := Assemble("default", "", "", nil, nil, "route:\n  receiver: default\n", "", true)
	require.NoError(t, err)
	assert.NotEqual(t, ca.Checksum(), ca2.Checksum(), "alertmanager.yml 内容变化必须影响联合 checksum")

	// 无告警配置传空串 → 不产生空产物。
	caEmpty, err := Assemble("default", "", "", nil, nil, "", "", true)
	require.NoError(t, err)
	assert.Equal(t, "", caEmpty.AlertmanagerYML)
}

func TestLoadLatestAlertmanagerConfigContent(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.AlertmanagerConfigVersion{}))

	// 无留痕 → 空串。
	got, err := LoadLatestAlertmanagerConfigContent(db)
	require.NoError(t, err)
	assert.Equal(t, "", got)

	// 存在已留痕（applied）版本 → 返回最新一条 content（决策 60 / T09-60-1）。
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content:  "route:\n  receiver: first\n",
		Checksum: models.AlertmanagerConfigChecksum("route:\n  receiver: first\n"),
		Status:   models.AlertmanagerConfigStatusApplied,
	}).Error)
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content:  "route:\n  receiver: latest\n",
		Checksum: models.AlertmanagerConfigChecksum("route:\n  receiver: latest\n"),
		Status:   models.AlertmanagerConfigStatusApplied,
	}).Error)

	got2, err := LoadLatestAlertmanagerConfigContent(db)
	require.NoError(t, err)
	assert.Equal(t, "route:\n  receiver: latest\n", got2, "须返回最新留痕（applied）配置")
}

func TestValidateArtifactsPendingWhenAmmtoolMissing(t *testing.T) {
	old := ToolLookPath
	ToolLookPath = func(name string) (string, error) {
		if name == "amtool" {
			return "", errToolMissing
		}
		return name, nil
	}
	t.Cleanup(func() { ToolLookPath = old })

	ca, _ := Assemble("d", "", "", nil, nil, "route:\n  receiver: default\n", "", true)
	status, cause, details, _ := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusPending, status)
	assert.Equal(t, models.ValidationCausePlatformFault, cause, "amtool 缺失应归因为平台故障")
	assert.Empty(t, details)
}

// stubPassingTools 将外部校验工具模拟为可用且通过、不落真实文件系统，聚焦决策 66
// 规则 job 引用门禁的判定（generator 包内唯一）。
func stubPassingTools(t *testing.T) {
	t.Helper()
	oldLook := ToolLookPath
	oldChecker := ToolChecker
	ToolLookPath = func(name string) (string, error) { return name, nil }
	ToolChecker = func(ca *ConfigArtifacts, ib bool) (ToolCheckStatus, string) { return ToolCheckPassed, "" }
	t.Cleanup(func() { ToolLookPath = oldLook; ToolChecker = oldChecker })
}

// TestValidateArtifactsJobRefErrorBlocks 覆盖决策 66 发布期门禁：存活类规则
// （absent(up)）引用 central 全域名单中不存在的 job → failed（user_config），details
// 定位到 rules.yml，阻断确认。
func TestValidateArtifactsJobRefErrorBlocks(t *testing.T) {
	stubPassingTools(t)
	ca := &ConfigArtifacts{
		PrometheusYML: "scrape_configs:\n  - job_name: existing\n",
		RulesYML: `
groups:
- name: g
  rules:
  - alert: Down
    expr: absent(up{job="missing"})
`,
	}
	status, cause, details, msg := ValidateArtifacts(ca, false, []string{"job-a", "job-b"})
	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause, "job 引用 error 应归因用户配置")
	require.Len(t, details, 1)
	assert.Equal(t, string(models.AffectedFileRules), details[0].File)
	assert.Contains(t, details[0].Message, "missing")
	assert.Contains(t, msg, "Module_01")
}

// TestValidateArtifactsJobRefWarningPasses 覆盖决策 66：非存活类规则引用缺失 job →
// passed（不阻断）+ 携 warning details 与提示 message（允许确认但高亮）。
func TestValidateArtifactsJobRefWarningPasses(t *testing.T) {
	stubPassingTools(t)
	ca := &ConfigArtifacts{
		PrometheusYML: "scrape_configs:\n  - job_name: existing\n",
		RulesYML: `
groups:
- name: g
  rules:
  - alert: HighCPU
    expr: node_cpu_usage{job="ghost"} > 0.9
`,
	}
	status, cause, details, msg := ValidateArtifacts(ca, false, []string{"job-a", "job-b"})
	assert.Equal(t, models.ValidationStatusPassed, status)
	assert.Empty(t, cause)
	require.Len(t, details, 1, "warning 级问题应在 details 呈现供前端高亮")
	assert.Equal(t, string(models.AffectedFileRules), details[0].File)
	assert.Contains(t, msg, "告警")
}

// TestValidateArtifactsJobRefAllExisting 覆盖决策 66：规则引用的 job 全部现身于
// central 全域名单 → 无门禁问题，passed + 空 details。
func TestValidateArtifactsJobRefAllExisting(t *testing.T) {
	stubPassingTools(t)
	ca := &ConfigArtifacts{
		PrometheusYML: "scrape_configs:\n  - job_name: existing\n",
		RulesYML: `
groups:
- name: g
  rules:
  - alert: OK
    expr: absent(up{job="existing"})
`,
	}
	status, cause, details, msg := ValidateArtifacts(ca, false, []string{"existing"})
	assert.Equal(t, models.ValidationStatusPassed, status)
	assert.Empty(t, cause)
	assert.Empty(t, details)
	assert.Equal(t, "", msg)
}

// TestValidateArtifactsJobRefLivenessExistingPasses 覆盖 F-14 改动 Y：central 规则
// 存活类引用（up{job=...}==0）命中 central 全域并集名单中的 job（如边缘域已部署 job，
// 不在本域产物 scrape_configs 中）→ passed，不再按本域产物误判 error 阻断发布。
func TestValidateArtifactsJobRefLivenessExistingPasses(t *testing.T) {
	stubPassingTools(t)
	ca := &ConfigArtifacts{
		PrometheusYML: "scrape_configs:\n  - job_name: local-only\n",
		RulesYML: `
groups:
- name: g
  rules:
  - alert: Down
    expr: up{job="tengxunyun-ceshi-host"} == 0
`,
	}
	status, cause, details, msg := ValidateArtifacts(ca, false, []string{"job-a", "tengxunyun-ceshi-host"})
	assert.Equal(t, models.ValidationStatusPassed, status, "跨域引用命中 central 全域并集应通过")
	assert.Empty(t, cause)
	assert.Empty(t, details)
	assert.Equal(t, "", msg)
}

// ---- 决策 68-2：Prometheus → Alertmanager 投递接线 ----

// TestAlertmanagerTargetFromURL 覆盖 --alertmanager.url → Prometheus alertmanager
// target（host:port）的解析：剥离 scheme 与路径；容忍已是 host:port 的入参；
// 空串 / 非法值返回空串（调用方据此不生成 alerting 段，避免写出悬空目标）。
func TestAlertmanagerTargetFromURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"http://localhost:9093", "localhost:9093"},
		{"http://127.0.0.1:9093/", "127.0.0.1:9093"},
		{"https://am.example.com:9093", "am.example.com:9093"},
		{"localhost:9093", "localhost:9093"},
		{"  http://localhost:9093  ", "localhost:9093"},
		{"", ""},
		{"http://", ""},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, AlertmanagerTargetFromURL(c.in), "input=%q", c.in)
	}
}

// TestAssembleAlertingSectionConditional 覆盖决策 68-2 的条件注入：alerting 段仅在
// 「中心求值器 + alertmanager.yml 非空 + AM 地址非空」三者同时满足时生成；target 为
// 注入地址（禁止硬编码 127.0.0.1:9093）。
func TestAssembleAlertingSectionConditional(t *testing.T) {
	const amYML = "route:\n  receiver: default\n"
	const amAddr = "am-center:9093"

	// 1. 中心 + AM 内容 + 地址 → 生成 alerting 段。
	ca, err := Assemble("default", "", "", nil, nil, amYML, amAddr, true)
	require.NoError(t, err)
	assert.Contains(t, ca.PrometheusYML, "alerting:")
	assert.Contains(t, ca.PrometheusYML, "alertmanagers:")
	assert.Contains(t, ca.PrometheusYML, "static_configs:")
	assert.Contains(t, ca.PrometheusYML, "- "+amAddr, "target 须为注入地址")
	assert.NotContains(t, ca.PrometheusYML, "127.0.0.1:9093", "AM 地址必须参数化，不得硬编码")

	// 2. 中心 + AM 内容 + 空地址 → 不生成（避免悬空目标）。
	caNoAddr, err := Assemble("default", "", "", nil, nil, amYML, "", true)
	require.NoError(t, err)
	assert.NotContains(t, caNoAddr.PrometheusYML, "alerting:")

	// 3. 中心 + 无 AM 挂载内容 + 地址 → 不生成（避免指向不存在的 Alertmanager）。
	caNoAM, err := Assemble("default", "", "", nil, nil, "", amAddr, true)
	require.NoError(t, err)
	assert.NotContains(t, caNoAM.PrometheusYML, "alerting:")

	// 4. 边缘通道（agent_pull → centerEvaluator=false）→ 即便两者齐备也不生成。
	caEdge, err := Assemble("edge-a", "", "", nil, nil, amYML, amAddr, false)
	require.NoError(t, err)
	assert.NotContains(t, caEdge.PrometheusYML, "alerting:")
}

// TestAssembleRuleFilesAndAlertingShareCenterSwitch 覆盖约定纪律（决策 68-2/68-3）：
// rule_files 与 alerting 必须由同一个「是否中心」判定驱动——中心两者皆生成，
// 边缘两者皆不生成，不得出现「一段生成了、另一段没生成」的半残配置。
func TestAssembleRuleFilesAndAlertingShareCenterSwitch(t *testing.T) {
	rules := []models.MonitoringRule{
		{Name: "r", ContentMode: models.RuleContentModeYAMLPassthrough,
			RuleContent: "groups:\n  - name: g\n    rules: [{alert: A, expr: up == 0}]"},
	}
	const amYML = "route:\n  receiver: default\n"

	center, err := Assemble("default", "", "", nil, rules, amYML, "am:9093", true)
	require.NoError(t, err)
	assert.Contains(t, center.PrometheusYML, "rule_files:")
	assert.Contains(t, center.PrometheusYML, "alerting:")

	edge, err := Assemble("edge-a", "", "", nil, rules, amYML, "am:9093", false)
	require.NoError(t, err)
	assert.NotContains(t, edge.PrometheusYML, "rule_files")
	assert.NotContains(t, edge.PrometheusYML, "alerting")
}

// TestDefaultMappingBuildersPlatformMapping 固化「platform_code → platform 映射」
// 口径：五类默认模板各含且仅含一条 platform 映射（资源行一等字段经模板注入）。
func TestDefaultMappingBuildersPlatformMapping(t *testing.T) {
	for _, cat := range []models.ResourceCategory{
		models.ResourceCategoryHost, models.ResourceCategoryDatabase,
		models.ResourceCategoryMiddleware, models.ResourceCategoryGenericTarget,
		models.ResourceCategoryApplication,
	} {
		mappings := models.DefaultMappingBuilders(cat)
		var platformMappings []models.LabelMapping
		for _, m := range mappings {
			if m.TargetLabel == "platform" || m.SourceField == "platform_code" {
				platformMappings = append(platformMappings, m)
			}
		}
		require.Len(t, platformMappings, 1, "%s 默认模板应含 1 条 platform_code → platform 映射", cat)
		assert.Equal(t, "platform_code", platformMappings[0].SourceField)
		assert.Equal(t, "platform", platformMappings[0].TargetLabel)
		assert.Equal(t, models.LabelSourceTypeResourceField, platformMappings[0].SourceType)
	}
}

// TestResolveTargetsInjectsDerivedPlatformLabel（决策 118-2 / 118-5）固化 `platform`
// 标签的**唯一权威 = target 级标签模板映射层**（`platform_code → platform` 的
// resource_field 映射），并作为「模板 vs system 同键冲突」组合的强制门禁：
//
//  1. **冲突用例（决策 118-5 强制）**：传**真实模板** + 资源行 platform_code ≠ 应用
//     is_primary 平台 ⇒ 断言最终 `platform` 取**资源行值**。此前 3 个子用例全传
//     tmpl=nil（expandLabelTemplate 早退返回空）且夹具资源与 app 同值，该组合从未被测过。
//  2. 资源留空 + 应用有 is_primary 平台 ⇒ 取主平台值（决策 110 ③ 兜底）。
//  3. 资源留空 + 应用无主平台 ⇒ 不注入 platform（PRD §5.2 空值不注入）。
//  4. system 层**不得**再注入 platform：tmpl=nil 时即便应用挂了主平台也不注入
//     （决策 118-2「system 层禁止再注入 platform」）。
//
// 迁移说明：原三个子用例（应用未挂平台不注入 / 无 app_code 不注入）的有效断言保留，
// 但**必须改为传真实模板**，否则它们测不到模板路径（原写法恒早退）。
func TestResolveTargetsInjectsDerivedPlatformLabel(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(
		&models.Host{}, &models.Application{}, &models.GenericTarget{},
		&models.ApplicationDict{}, &models.LabelTemplate{}, &models.AppPlatformRel{},
	))
	// 应用↔平台关联（决策 111 M:N）：
	//   - app-with-primary 挂 is_primary=true 的 cmp-primary（兜底取值来源）；
	//   - app-rel-no-primary 只挂非主平台关联（无主平台 ⇒ 兜底不生效）；
	//   - app-orphan 无任何关联。
	require.NoError(t, db.Create(&[]models.AppPlatformRel{
		{AppCode: "app-with-primary", PlatformCode: "cmp-primary", IsPrimary: true},
		{AppCode: "app-with-primary", PlatformCode: "cmp-secondary", IsPrimary: false},
		{AppCode: "app-rel-no-primary", PlatformCode: "cmp-secondary", IsPrimary: false},
	}).Error)
	require.NoError(t, db.Create(&[]models.ApplicationDict{
		{AppCode: "app-with-primary", AppName: "有主平台应用", Status: models.AppStatusEnabled},
		{AppCode: "app-rel-no-primary", AppName: "仅非主平台应用", Status: models.AppStatusEnabled},
		{AppCode: "app-orphan", AppName: "无关联应用", Status: models.AppStatusEnabled},
	}).Error)

	// 冲突用例夹具：资源行显式填 res-platform，与所属应用 is_primary 平台
	// cmp-primary **不同值**——旧夹具两者同值，即便打通也测不出优先级反转。
	require.NoError(t, db.Create(&models.Host{
		ServerID: "host-res-platform", ResourceID: "host-res-platform", NetworkDomainID: "d",
		PrivateIP: "10.0.1.1", Status: "online", AppCode: "app-with-primary",
		PlatformCode: "res-platform",
	}).Error)
	// 资源留空 + 应用有 is_primary 平台 ⇒ 走兜底。
	require.NoError(t, db.Create(&models.Host{
		ServerID: "host-blank-platform", ResourceID: "host-blank-platform", NetworkDomainID: "d",
		PrivateIP: "10.0.1.2", Status: "online", AppCode: "app-with-primary",
	}).Error)
	// 资源留空 + 应用仅挂非主平台关联 ⇒ 兜底不生效、不注入。
	require.NoError(t, db.Create(&models.Host{
		ServerID: "host-no-primary", ResourceID: "host-no-primary", NetworkDomainID: "d",
		PrivateIP: "10.0.1.3", Status: "online", AppCode: "app-rel-no-primary",
	}).Error)
	// 资源留空 + 应用无任何关联 ⇒ 不注入。
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "app-orphan-res", ResourceCategory: models.ResourceCategoryApplication, NetworkDomainID: "d",
		BizCode: "payment", AppName: "app-orphan", Env: "prod", Status: "online",
		ServiceName: "svc", Endpoint: "10.0.0.20", Port: 8080,
	}).Error)
	// generic_target 仅填 biz_code、无 app_code ⇒ 无所属应用，既不走资源值也无兜底。
	require.NoError(t, db.Create(&models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID: "gt-biz-only", ResourceCategory: models.ResourceCategoryGenericTarget, NetworkDomainID: "d",
			BizCode: "infra", Env: "prod", Status: "online",
		},
		TargetName: "gt", InstanceIP: "10.0.0.30", Port: 161,
	}).Error)

	// 真实模板：直接用 models.DefaultMappingBuilders 产出的默认映射集
	// （含启用的 platform_code → platform resource_field 行，决策 110 ②）。
	hostTmpl := &models.LabelTemplate{Name: "default-host", ResourceCategory: models.ResourceCategoryHost,
		IsDefault: true, Mappings: models.DefaultMappingBuilders(models.ResourceCategoryHost)}
	appTmpl := &models.LabelTemplate{Name: "default-application", ResourceCategory: models.ResourceCategoryApplication,
		IsDefault: true, Mappings: models.DefaultMappingBuilders(models.ResourceCategoryApplication)}
	gtTmpl := &models.LabelTemplate{Name: "default-generic_target", ResourceCategory: models.ResourceCategoryGenericTarget,
		IsDefault: true, Mappings: models.DefaultMappingBuilders(models.ResourceCategoryGenericTarget)}
	require.NoError(t, db.Create(hostTmpl).Error)
	require.NoError(t, db.Create(appTmpl).Error)
	require.NoError(t, db.Create(gtTmpl).Error)

	t.Run("资源 platform_code ≠ 应用主平台 ⇒ 取资源行值（冲突门禁）", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"host-res-platform"}}, hostTmpl, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		assert.Equal(t, "res-platform", groups[0].Labels["platform"],
			"资源行 platform_code 优先于应用 is_primary 平台（决策 110 ① > ③）")
	})

	t.Run("资源留空 + 应用有 is_primary 平台 ⇒ 取主平台值", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"host-blank-platform"}}, hostTmpl, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		assert.Equal(t, "cmp-primary", groups[0].Labels["platform"],
			"资源留空时兜底取所属应用 is_primary 平台（决策 110 ③）")
	})

	t.Run("资源留空 + 应用仅非主平台关联 ⇒ 不注入", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"host-no-primary"}}, hostTmpl, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		_, exists := groups[0].Labels["platform"]
		assert.False(t, exists, "应用无 is_primary 平台时兜底不生效、platform 缺位（预期正常态）")
	})

	t.Run("应用无任何平台关联则不注入", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"app-orphan-res"}}, appTmpl, 0)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		_, exists := groups[0].Labels["platform"]
		assert.False(t, exists, "应用未挂平台时 platform 缺位（预期正常态）")
	})

	t.Run("generic_target 仅填 biz_code 则不注入（无 app_code）", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"gt-biz-only"}}, gtTmpl, 0)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		_, exists := groups[0].Labels["platform"]
		assert.False(t, exists, "无 app_code 时不注入 platform")
	})

	t.Run("system 层停注 platform：tmpl=nil 时即便应用有主平台也不注入", func(t *testing.T) {
		groups, _, err := ResolveJobTargets(db, models.ScrapeJob{JobName: "j", SelectedInstanceIDs: []string{"host-blank-platform"}}, nil, 9100)
		require.NoError(t, err)
		require.Len(t, groups, 1)
		_, exists := groups[0].Labels["platform"]
		assert.False(t, exists,
			"决策 118-2：platform 产出方唯一 = 模板层，system 层不得注入（无模板即无 platform）")
	})
}
