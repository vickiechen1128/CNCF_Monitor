package models

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestResourceTypeConstants(t *testing.T) {
	assert.Equal(t, ResourceType("host"), ResourceTypeHost)
	assert.Equal(t, ResourceType("middleware"), ResourceTypeMiddleware)
	assert.Equal(t, ResourceType("application"), ResourceTypeApplication)
}

func TestHostImplementsResource(t *testing.T) {
	var _ Resource = (*Host)(nil)

	h := &Host{
		ServerID:     "srv-001",
		InstanceName: "host-01",
		AppCode:      "app-a",
		EnvFlag:      "PRD",
		SubAppCode:   "cluster-1",
		Status:       "running",
	}

	assert.Equal(t, "srv-001", h.GetResourceID())
	assert.Equal(t, ResourceTypeHost, h.GetResourceType())
	assert.Equal(t, "app-a", h.GetAppName())
	assert.Equal(t, "PRD", h.GetEnv())
	assert.Equal(t, "cluster-1", h.GetCluster())
	assert.Equal(t, "running", h.GetStatus())
}

func TestHostResourceIDFallback(t *testing.T) {
	h := &Host{InstanceName: "host-02"}
	assert.Equal(t, "host-02", h.GetResourceID())
}

func TestHostTemplateFields(t *testing.T) {
	h := &Host{
		CloudCode:     "TX",
		AppCode:       "SJJS",
		SubAppCode:    "YD2",
		EnvFlag:       "SIT",
		ServerID:      "srv-123",
		InstanceName:  "V_TX_SH02_GGSQ_SJJS_SIT_WEB_01_X86",
		Status:        "running",
		Region:        "上海",
		ZoneEnv:       "INT",
		InstanceSpec:  "S9.LARGE8",
		VCPU:          4,
		MemoryGB:      8,
		Image:         "Ubuntu Server 22.04 LTS 64位",
		SystemDiskGB:  100,
		DataDiskGB:    100,
		PublicIP:      "",
		Bandwidth:     0,
		PrivateSubnet: "10.0.1.0/24",
		PrivateIP:     "10.0.1.10",
		Purpose:       "web",
		VPC:           "TX_SH02_vpc_SJJS_SIT_010010001/24",
		SecurityGroup: "TX_SH02_sg_WEB_SIT_01",
	}

	assert.Equal(t, "TX", h.CloudCode)
	assert.Equal(t, 4, h.VCPU)
	assert.Equal(t, "10.0.1.10", h.InstanceIP())
	assert.Equal(t, "V_TX_SH02_GGSQ_SJJS_SIT_WEB_01_X86", h.Hostname())
	assert.Equal(t, "Ubuntu Server 22.04 LTS 64位", h.OSType())
}

func TestMiddlewareImplementsResource(t *testing.T) {
	var _ Resource = (*Middleware)(nil)

	m := &Middleware{
		ResourceID:     "redis-01",
		ResourceType:   ResourceTypeMiddleware,
		AppName:        "app-a",
		Env:            "prod",
		Cluster:        "cluster-1",
		Status:         "online",
		MiddlewareType: "redis",
		InstanceIP:     "10.0.1.20",
		Port:           6379,
	}

	assert.Equal(t, "redis-01", m.GetResourceID())
	assert.Equal(t, ResourceTypeMiddleware, m.GetResourceType())
	assert.Equal(t, "app-a", m.GetAppName())
	assert.Equal(t, "prod", m.GetEnv())
	assert.Equal(t, "cluster-1", m.GetCluster())
	assert.Equal(t, "online", m.GetStatus())
}

func TestApplicationImplementsResource(t *testing.T) {
	var _ Resource = (*Application)(nil)

	a := &Application{
		ResourceID:     "svc-01",
		ResourceType:   ResourceTypeApplication,
		AppName:        "app-a",
		Env:            "prod",
		Cluster:        "cluster-1",
		Status:         "online",
		ServiceName:    "order-service",
		HealthCheckURL: "https://order-service.prod/api/health",
		Protocol:       "https",
		Endpoint:       "/metrics",
		Port:           8080,
	}

	assert.Equal(t, "svc-01", a.GetResourceID())
	assert.Equal(t, ResourceTypeApplication, a.GetResourceType())
	assert.Equal(t, "order-service", a.ServiceName)
	assert.Equal(t, "https", a.Protocol)
}

func TestAutoMigrate(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	assert.NoError(t, err)

	assert.NoError(t, db.AutoMigrate(
		&Host{}, &Middleware{}, &Application{}, &Database{}, &GenericTarget{},
		&LabelTemplate{}, &ScrapeJob{}, &BlackboxProbeConfig{},
		&Tenant{}, &NetworkDomain{}, &ZoneType{}, &ResourceStatusMapping{},
		&ResourceLabel{}, &CITypeExporterMapping{}, &ExporterTemplate{},
		&MonitoringRule{}, &ConfigDraft{}, &ConfigVersion{}, &ConfigDeployment{},
		&EdgeAgent{}, &BusinessMetric{}, &ImportRecord{}, &LabelTemplateSnapshot{},
	))
}

func TestHostSoftDelete(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&Host{}))

	h := &Host{InstanceName: "host-delete", Status: "running", Region: "上海", ZoneEnv: "INT", InstanceSpec: "S9.LARGE8", Image: "Ubuntu", VPC: "vpc", SecurityGroup: "sg"}
	assert.NoError(t, db.Create(h).Error)
	assert.NotZero(t, h.ID)

	assert.NoError(t, db.Delete(h).Error)

	var count int64
	assert.NoError(t, db.Model(&Host{}).Count(&count).Error)
	assert.Equal(t, int64(0), count)

	assert.NoError(t, db.Unscoped().Model(&Host{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

// --- Phase 0: shared model contracts ---

func TestResourceCategoryConstants(t *testing.T) {
	assert.Equal(t, ResourceCategory("host"), ResourceCategoryHost)
	assert.Equal(t, ResourceCategory("database"), ResourceCategoryDatabase)
	assert.Equal(t, ResourceCategory("middleware"), ResourceCategoryMiddleware)
	assert.Equal(t, ResourceCategory("application"), ResourceCategoryApplication)
	assert.Equal(t, ResourceCategory("generic_target"), ResourceCategoryGenericTarget)
	assert.Len(t, ValidResourceCategories(), 5)
}

func TestResourceInterfaceImplementations(t *testing.T) {
	var (
		_ Resource = (*Host)(nil)
		_ Resource = (*Database)(nil)
		_ Resource = (*Middleware)(nil)
		_ Resource = (*Application)(nil)
		_ Resource = (*GenericTarget)(nil)
	)

	db := &Database{
		ResourceBase: ResourceBase{
			ResourceID:       "db-01",
			ResourceCategory: ResourceCategoryDatabase,
			NetworkDomainID:  DefaultDomainID,
			BizCode:          "pay",
			Env:              "prod",
			Status:           "online",
			SourceType:       SourceTypeManual,
		},
		InstanceIP: "10.0.1.30",
		Port:       3306,
	}
	assert.Equal(t, "db-01", db.GetResourceID())
	assert.Equal(t, ResourceTypeDatabase, db.GetResourceType())
	assert.Equal(t, ResourceCategoryDatabase, db.GetResourceCategory())
	assert.Equal(t, "prod", db.GetEnv())
	assert.Equal(t, "online", db.GetStatus())

	gt := &GenericTarget{
		ResourceBase: ResourceBase{
			ResourceID:       "gt-01",
			ResourceCategory: ResourceCategoryGenericTarget,
			NetworkDomainID:  DefaultDomainID,
			Env:              "prod",
			Status:           "online",
			SourceType:       SourceTypeManual,
		},
		TargetName:   "snmp-sw01",
		InstanceIP:   "10.0.1.40",
		MetricsPath:  "/snmp",
		Scheme:       "http",
		CustomLabels: map[string]string{"vendor": "h3c"},
	}
	assert.Equal(t, "gt-01", gt.GetResourceID())
	assert.Equal(t, ResourceCategoryGenericTarget, gt.GetResourceCategory())
	assert.Equal(t, "snmp-sw01", gt.TargetName)
	assert.Equal(t, map[string]string{"vendor": "h3c"}, gt.CustomLabels)
}

func TestResourceStatusMapping(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ResourceStatusMapping{}))

	mappings := DefaultStatusMappings()
	assert.Len(t, mappings, 3)
	assert.NoError(t, db.Create(&mappings).Error)

	var count int64
	assert.NoError(t, db.Model(&ResourceStatusMapping{}).Count(&count).Error)
	assert.Equal(t, int64(3), count)
}

func TestTenantCreateAndDefaults(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&Tenant{}))

	tenant := &Tenant{
		ID:               PlatformAdminTenantID,
		Name:             "平台默认租户",
		NetworkDomainIDs: []string{DefaultDomainID},
		MultiSiteEnabled: false,
		IsPlatformAdmin:  true,
		Status:           TenantStatusActive,
	}
	assert.NoError(t, db.Create(tenant).Error)

	var got Tenant
	assert.NoError(t, db.First(&got, "id = ?", PlatformAdminTenantID).Error)
	assert.Equal(t, PlatformAdminTenantID, got.ID)
	assert.Equal(t, TenantStatusActive, got.Status)
	assert.Equal(t, []string{DefaultDomainID}, got.NetworkDomainIDs)
	assert.False(t, got.MultiSiteEnabled)
}

func TestNetworkDomainDefaultLocal(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&NetworkDomain{}))

	domain := &NetworkDomain{
		ID:         DefaultDomainID,
		Name:       "默认网域",
		DomainType: DomainTypeManagement,
		Channel:    ChannelTypeLocal,
		TenantID:   PlatformAdminTenantID,
		Status:     DomainStatusEnabled,
	}
	assert.NoError(t, db.Create(domain).Error)
	assert.True(t, domain.IsManagement())

	var got NetworkDomain
	assert.NoError(t, db.First(&got, "id = ?", DefaultDomainID).Error)
	assert.Equal(t, ChannelTypeLocal, got.Channel)
	assert.Equal(t, DomainTypeManagement, got.DomainType)
	assert.Equal(t, PlatformAdminTenantID, got.TenantID)
}

func TestZoneTypePresetCodes(t *testing.T) {
	assert.Equal(t, ZoneTypeCode("internet"), ZoneTypeInternet)
	assert.Equal(t, ZoneTypeCode("extranet"), ZoneTypeExtranet)
	assert.Equal(t, ZoneTypeCode("private-line"), ZoneTypePrivateLine)
	assert.Equal(t, ZoneTypeCode("dmz"), ZoneTypeDMZ)
}

func TestResourceBaseAndLabel(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&Host{}, &ResourceLabel{}))

	label := &ResourceLabel{ResourceID: "db-01", Key: "env", Value: "prod", Source: LabelSourceSystem}
	assert.NoError(t, db.Create(label).Error)
	assert.NotZero(t, label.ID)
}

func TestLabelTemplateByCategory(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&LabelTemplate{}))

	tmpl := &LabelTemplate{
		Name:             "主机默认模板",
		ResourceCategory: ResourceCategoryHost,
		IsDefault:        true,
		Mappings:         DefaultMappingBuilders(ResourceCategoryHost),
	}
	assert.NoError(t, db.Create(tmpl).Error)
	assert.NotZero(t, tmpl.ID)

	found := false
	for _, m := range tmpl.Mappings {
		if m.TargetLabel == "biz" && m.SourceField == "biz_code" {
			found = true
		}
		if m.TargetLabel == "instance" && m.SourceType == LabelSourceTypeComposite {
			assert.Equal(t, "instance_ip:port", m.SourceField)
		}
		if m.TargetLabel == "resource_id" {
			assert.Equal(t, "resource_id", m.SourceField)
			assert.Equal(t, LabelSourceTypeResourceField, m.SourceType)
		}
	}
	assert.True(t, found, "default host template must map biz_code -> biz")
}

// TestDefaultTemplatesContainResourceID 覆盖 Module_01 v3.29 §9.1 验收收紧：
// 五类默认模板必须含 resource_id 稳定身份标签（决策 47-3 coverage 回连键）。
func TestDefaultTemplatesContainResourceID(t *testing.T) {
	for _, cat := range ValidResourceCategories() {
		found := false
		for _, m := range DefaultMappingBuilders(cat) {
			if m.TargetLabel == "resource_id" && m.SourceField == "resource_id" && m.SourceType == LabelSourceTypeResourceField && m.Enabled {
				found = true
			}
		}
		assert.True(t, found, "default template for %q must contain resource_id -> resource_id", cat)
	}
}

func TestBuiltinTemplates(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ExporterTemplate{}, &CITypeExporterMapping{}))

	templates := BuiltinExporterTemplates()
	assert.Len(t, templates, 6) // node / mysqld / redis / windows / kafka / snmp
	for i := range templates {
		templates[i].IsBuiltin = true
		assert.NoError(t, db.Create(&templates[i]).Error)
	}
	// The default mapping references the ExporterTemplate.ID (as a string),
	// matching the seed semantics: synchronize with the real primary key.
	nodeID := strconv.FormatUint(uint64(templates[0].ID), 10)
	assert.NoError(t, db.Create(&CITypeExporterMapping{
		MonitorType:        "host_linux",
		ExporterTemplateID: nodeID,
		IsDefault:          true,
		DefaultPort:        9100,
		MetricsPath:        "/metrics",
		Scheme:             "http",
		ScrapeInterval:     "15s",
		ScrapeTimeout:      "12s",
		IsBuiltin:          true,
	}).Error)

	// ExporterTemplateID must join back to a real ExporterTemplate.
	var joined ExporterTemplate
	assert.NoError(t, db.Where("id = ?", nodeID).First(&joined).Error)
	assert.Equal(t, "node-exporter", joined.Name)
}

func TestScrapeJobAndMonitoringRule(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ScrapeJob{}, &MonitoringRule{}))

	job := &ScrapeJob{
		JobName:               "node-exporter-prod",
		JobType:               JobTypeStandard,
		ResourceType:          ResourceTypeHost,
		MonitorType:           "host_linux",
		NetworkDomainID:       DefaultDomainID,
		InstanceSelectionMode: InstanceSelectionManual,
		SelectedInstanceIDs:   []string{"srv-001"},
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "12s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              AuthTypeNone,
		ChangeStatus:          ChangeStatusNone,
		DraftStatus:           "ready",
		Enabled:               true,
	}
	assert.NoError(t, db.Create(job).Error)
	assert.NotZero(t, job.ID)
	assert.Equal(t, []string{"srv-001"}, job.SelectedInstanceIDs)

	rule := &MonitoringRule{
		Name:         "node-down",
		ContentMode:  RuleContentModeYAMLPassthrough,
		Scope:        ScopeTypeCentral,
		Enabled:      true,
		DraftStatus:  "ready",
		ChangeStatus: ChangeStatusNone,
	}
	assert.NoError(t, db.Create(rule).Error)
	assert.NotZero(t, rule.ID)
}

func TestConfigModelsSmoke(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ConfigDraft{}, &ConfigVersion{}, &ConfigDeployment{}))

	draft := &ConfigDraft{
		NetworkDomainID:  DefaultDomainID,
		ChangeNo:         "CHG-20260821-001",
		PrometheusYml:    "global: { scrape_interval: 15s }",
		Status:           DraftStatusPending,
		ValidationStatus: "passed",
	}
	assert.NoError(t, db.Create(draft).Error)
	assert.NotZero(t, draft.ID)

	version := &ConfigVersion{
		NetworkDomainID: DefaultDomainID,
		DraftID:         "1",
		ChangeNo:        "CHG-20260821-001",
		PrometheusYml:   "global: { scrape_interval: 15s }",
	}
	assert.NoError(t, db.Create(version).Error)

	deploy := &ConfigDeployment{
		NetworkDomainID:  DefaultDomainID,
		ConfigVersionID:  "1",
		SourceChangeNo:   "CHG-20260821-001",
		Channel:          ChannelTypeLocal,
		Status:           DeploymentStatusSuccess,
		ValidationStatus: "passed",
		TriggeredBy:      "system",
	}
	assert.NoError(t, db.Create(deploy).Error)
	assert.NotZero(t, deploy.ID)
}

func TestEdgeAgentAndBusinessMetric(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&EdgeAgent{}, &BusinessMetric{}))

	agent := &EdgeAgent{
		NetworkDomainID: "mc-gov-a",
		AgentType:       AgentTypeVMAgent,
		Version:         "1.0.0",
		Status:          "online",
	}
	assert.NoError(t, db.Create(agent).Error)
	assert.NotZero(t, agent.ID)

	bm := &BusinessMetric{
		MetricID:       "bm-payment-rate",
		MetricName:     "payment_success_rate",
		Description:    "支付成功率",
		MetricType:     "gauge",
		Unit:           "%",
		BusinessDomain: "payment",
		Owner:          "zhangsan",
		RegisterSource: BusinessMetricSourceSelf,
		Status:         BusinessMetricStatusPending,
	}
	assert.NoError(t, db.Create(bm).Error)
	assert.NotZero(t, bm.ID)
}

func newMemDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	assert.NoError(t, err)
	return db
}

func TestScrapeJobSecretsNotSerialized(t *testing.T) {
	// 决策31：password/token 仅存储，JSON 不回显明文。
	job := &ScrapeJob{
		JobName:               "sec-prod",
		JobType:               JobTypeStandard,
		ResourceType:          ResourceTypeHost,
		MonitorType:           MonitorTypeHostLinux,
		NetworkDomainID:       DefaultDomainID,
		InstanceSelectionMode: InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "12s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              AuthTypeBasic,
		Username:              "monitor",
		Password:              "p@ssw0rd-secret",
		Token:                 "tok-xyz-secret",
		ChangeStatus:          ChangeStatusNone,
		DraftStatus:           "ready",
		Enabled:               true,
	}
	b, err := json.Marshal(job)
	assert.NoError(t, err)
	assert.NotContains(t, string(b), "p@ssw0rd-secret", "JSON 不得回显 password 明文")
	assert.NotContains(t, string(b), "tok-xyz-secret", "JSON 不得回显 token 明文")
	assert.NotContains(t, string(b), "\"password\"", "JSON 不得包含 password 字段键")
	assert.NotContains(t, string(b), "\"token\"", "JSON 不得包含 token 字段键")
	// 公开字段仍保留（创建/更新响应保留 username 即可）。
	assert.Contains(t, string(b), "\"username\":\"monitor\"")
}

// --- T07-01: shared contract columns + ImportRecord + LabelTemplateSnapshot + label rules ---

func TestHostSharedContractColumns(t *testing.T) {
	// Zero-value Host must not panic on the new shared contract fields/accessors.
	var h Host
	assert.NotPanics(t, func() {
		assert.Equal(t, "", h.GetResourceID())
		assert.Equal(t, SourceType(""), h.SourceType)
		assert.Equal(t, "", h.TenantID)
	})

	// ResourceID column takes precedence over the legacy ServerID fallback.
	pref := &Host{ResourceID: "uuid-123", ServerID: "srv-001", InstanceName: "host-01"}
	assert.Equal(t, "uuid-123", pref.GetResourceID())

	// Legacy fallback stays intact when ResourceID is empty.
	legacy := &Host{ServerID: "srv-001", InstanceName: "host-01"}
	assert.Equal(t, "srv-001", legacy.GetResourceID())

	// Middleware / Application expose the new columns without rearranging layout.
	m := &Middleware{ResourceID: "mw-1", SourceType: SourceTypeImport, TenantID: PlatformAdminTenantID}
	assert.Equal(t, SourceTypeImport, m.SourceType)
	assert.Equal(t, PlatformAdminTenantID, m.TenantID)
	a := &Application{ResourceID: "app-1", SourceType: SourceTypeManual, TenantID: PlatformAdminTenantID}
	assert.Equal(t, SourceTypeManual, a.SourceType)
	assert.Equal(t, PlatformAdminTenantID, a.TenantID)
}

func TestImportRecordErrorsJSONRoundTrip(t *testing.T) {
	rec := &ImportRecord{
		ImportNo:         "IMP-20260822-001",
		ResourceCategory: ResourceCategoryHost,
		Mode:             ImportModeUpsert,
		Total:            3,
		Success:          2,
		Updated:          1,
		Failed:           1,
		Status:           ImportStatusPartial,
		Errors: []ImportErrorDetail{
			{Row: 5, ResourceCategory: "host", Field: "instance_ip", Value: "999.999.999.999", Reason: "IP 格式不正确"},
			{Row: 6, ResourceCategory: "host", Field: "env", Value: "qa", Reason: "环境枚举不合法"},
		},
		Operator: PlatformAdminTenantID,
	}

	// Pure JSON round trip (errors array must survive).
	b, err := json.Marshal(rec)
	assert.NoError(t, err)
	var back ImportRecord
	assert.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, rec.ImportNo, back.ImportNo)
	assert.Equal(t, rec.Mode, back.Mode)
	assert.Equal(t, ImportStatusPartial, back.Status)
	assert.Equal(t, rec.Errors, back.Errors)

	// GORM serializer:json persistence round trip.
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ImportRecord{}))
	assert.NoError(t, db.Create(rec).Error)
	assert.NotZero(t, rec.ID)

	var got ImportRecord
	assert.NoError(t, db.First(&got, "import_no = ?", rec.ImportNo).Error)
	assert.Equal(t, ImportModeUpsert, got.Mode)
	assert.Equal(t, 2, got.Success)
	assert.Equal(t, 1, got.Failed)
	assert.Len(t, got.Errors, 2)
	assert.Equal(t, "instance_ip", got.Errors[0].Field)
	assert.Equal(t, "IP 格式不正确", got.Errors[0].Reason)
	assert.Equal(t, PlatformAdminTenantID, got.Operator)
}

func TestProtectedPrometheusLabels(t *testing.T) {
	for _, key := range []string{"instance", "job", "scheme", "__address__", "__scheme__", "__metrics_path__"} {
		assert.True(t, IsProtectedLabel(key), "expected %q to be a protected label", key)
	}
	assert.False(t, IsProtectedLabel("app"))
	assert.False(t, IsProtectedLabel("env"))
}

func TestLabelRules(t *testing.T) {
	// ValidBizCode: lowercase letters / digits / hyphens, length ≤ 64.
	assert.True(t, ValidBizCode.MatchString("payment"))
	assert.True(t, ValidBizCode.MatchString("data-api"))
	assert.True(t, ValidBizCode.MatchString("a1-b2"))
	assert.False(t, ValidBizCode.MatchString("Payment"))
	assert.False(t, ValidBizCode.MatchString("with_underscore"))
	assert.False(t, ValidBizCode.MatchString(strings.Repeat("a", 65)))

	// ValidateLabelKey: lowercase / underscore / no "__" prefix / ≤128.
	assert.NoError(t, ValidateLabelKey("app"))
	assert.NoError(t, ValidateLabelKey("app_name"))
	assert.Error(t, ValidateLabelKey(""))
	assert.Error(t, ValidateLabelKey("__name__"))
	assert.Error(t, ValidateLabelKey("AppName"))
	assert.Error(t, ValidateLabelKey("has-dash"))
	assert.Error(t, ValidateLabelKey(strings.Repeat("a", 129)))

	// Enum slices.
	assert.Equal(t, []string{"dev", "test", "staging", "prod"}, ValidEnvs)
	assert.Equal(t, []string{"http", "https", "tcp"}, ValidProtocols)
	assert.Equal(t, []string{"http", "https"}, ValidSchemes)
}

// --- Module 01 (T01-01): models contract baseline ---

func TestMonitorTypeDerivationMapFull(t *testing.T) {
	expected := map[string]string{
		"host:linux":               MonitorTypeHostLinux,
		"host:unix":                MonitorTypeHostLinux,
		"host:windows":             MonitorTypeHostWindows,
		"database:mysql":           MonitorTypeMySQL,
		"database:redis":           MonitorTypeRedis,
		"middleware:kafka":         MonitorTypeKafka,
		"middleware:elasticsearch": MonitorTypeElasticsearch,
		"middleware:nginx":         MonitorTypeNginx,
		"application:":             MonitorTypeApplicationHTTP,
		"generic_target:":          MonitorTypeSNMP,
	}
	assert.Equal(t, expected, MONITOR_TYPE_DERIVATION_MAP, "MONITOR_TYPE_DERIVATION_MAP must cover all mappings (no dm8)")

	// Derivation helper round-trip.
	mt, ok := DeriveMonitorType(ResourceCategoryHost, "linux")
	assert.True(t, ok)
	assert.Equal(t, MonitorTypeHostLinux, mt)
	_, ok = DeriveMonitorType(ResourceCategoryDatabase, "dm8")
	assert.False(t, ok, "dm8 is out of MVP scope")
}

func TestValidMonitorTypes(t *testing.T) {
	types := ValidMonitorTypes()
	assert.Len(t, types, 9)
	assert.True(t, ValidMonitorType("mysql"))
	assert.True(t, ValidMonitorType("application_http"))
	assert.False(t, ValidMonitorType("dm8"))
	assert.False(t, ValidMonitorType(""))
}

func TestBlackboxTargetJSONRoundTrip(t *testing.T) {
	orig := []BlackboxTarget{
		{Target: "10.0.1.11", Protocol: BlackboxTargetProtocolHTTP, URL: "https://api.example.com/health"},
		{Target: "10.0.1.12", Protocol: BlackboxTargetProtocolICMP},
	}
	b, err := json.Marshal(orig)
	assert.NoError(t, err)
	var back []BlackboxTarget
	assert.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, orig, back)

	// Enum guards.
	assert.True(t, ValidBlackboxTargetProtocol("https"))
	assert.True(t, ValidBlackboxTargetProtocol("dns"))
	assert.False(t, ValidBlackboxTargetProtocol("ftp"))
	assert.Len(t, ValidBlackboxTargetProtocols(), 5)
}

func TestScrapeJobBlackboxTargetsPersistence(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ScrapeJob{}))

	job := &ScrapeJob{
		JobName:               "blackbox-http",
		JobType:               JobTypeBlackbox,
		ResourceType:          ResourceTypeApplication,
		NetworkDomainID:       DefaultDomainID,
		InstanceSelectionMode: InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "12s",
		MetricsPath:           "/probe",
		Scheme:                "http",
		AuthType:              AuthTypeNone,
		BlackboxModule:        "http_2xx",
		BlackboxTargets:       []BlackboxTarget{{Target: "10.0.1.11", Protocol: BlackboxTargetProtocolHTTP}},
		ChangeStatus:          ChangeStatusNone,
		DraftStatus:           "ready",
		Enabled:               true,
	}
	assert.NoError(t, db.Create(job).Error)
	assert.Len(t, job.BlackboxTargets, 1)

	var got ScrapeJob
	assert.NoError(t, db.First(&got, "id = ?", job.ID).Error)
	assert.Equal(t, "10.0.1.11", got.BlackboxTargets[0].Target)
	assert.Equal(t, BlackboxTargetProtocolHTTP, got.BlackboxTargets[0].Protocol)
}

func TestExporterMetricLibraryMonitorTypesSerialization(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ExporterMetricLibrary{}))

	m := &ExporterMetricLibrary{
		MetricName: "node_cpu_usage",
		MetricType: MetricTypeGauge,
		Help:       "CPU 使用率",
		Unit:       "percent",
		Labels:     []string{"cpu", "mode"},
		MonitorTypes: []ExporterMetricAnchor{
			{MonitorType: MonitorTypeHostLinux, SourceExporter: "node-exporter"},
		},
		Category:  "cpu",
		IsBuiltin: true,
		Enabled:   true,
	}
	assert.NoError(t, db.Create(m).Error)
	assert.NotZero(t, m.ID)

	var got ExporterMetricLibrary
	assert.NoError(t, db.First(&got, "id = ?", m.ID).Error)
	assert.Equal(t, "cpu", got.Category)
	assert.Equal(t, []string{"cpu", "mode"}, got.Labels)
	assert.Len(t, got.MonitorTypes, 1)
	assert.Equal(t, "node-exporter", got.MonitorTypes[0].SourceExporter)
	assert.True(t, got.IsBuiltin)
}

func TestExporterInstallationConfirmationDefaultAndPK(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ScrapeJob{}, &ExporterInstallationConfirmation{}))

	job := &ScrapeJob{
		JobName:               "node-prod",
		JobType:               JobTypeStandard,
		ResourceType:          ResourceTypeHost,
		MonitorType:           MonitorTypeHostLinux,
		NetworkDomainID:       DefaultDomainID,
		InstanceSelectionMode: InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "12s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              AuthTypeNone,
		ChangeStatus:          ChangeStatusNone,
		DraftStatus:           "ready",
	}
	assert.NoError(t, db.Create(job).Error)

	// PK = (resource_id, scrape_job_id)；default status unconfirmed.
	conf := &ExporterInstallationConfirmation{ResourceID: "srv-001", ScrapeJobID: job.ID}
	assert.Equal(t, InstallationStatus(""), conf.Status)

	conf.Status = InstallationStatusConfirmed
	conf.ConfirmedBy = PlatformAdminTenantID
	assert.NoError(t, db.Create(conf).Error)

	var got ExporterInstallationConfirmation
	assert.NoError(t, db.Where("resource_id = ? AND scrape_job_id = ?", "srv-001", job.ID).First(&got).Error)
	assert.Equal(t, InstallationStatusConfirmed, got.Status)

	// Duplicate is illegal (composite PK) → second upsert replaces, not new row.
	assert.NoError(t, db.Save(&ExporterInstallationConfirmation{
		ResourceID: "srv-001", ScrapeJobID: job.ID, Status: InstallationStatusNotApplicable,
	}).Error)
	var count int64
	assert.NoError(t, db.Model(&ExporterInstallationConfirmation{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestInstallationStatusEnums(t *testing.T) {
	assert.Equal(t, InstallationStatus("unconfirmed"), InstallationStatusUnconfirmed)
	assert.Equal(t, InstallationStatus("confirmed"), InstallationStatusConfirmed)
	assert.Equal(t, InstallationStatus("not_applicable"), InstallationStatusNotApplicable)
}

// --- Module 09 (T09-01): config-center enum & JSON carrier contracts ---

func TestConfigCenterEnumConstants(t *testing.T) {
	// ChannelType / AgentType / DraftStatus / DeploymentStatus enum values.
	assert.Equal(t, ChannelType("local"), ChannelTypeLocal)
	assert.Equal(t, ChannelType("agent_pull"), ChannelTypeAgentPull)
	assert.Equal(t, AgentType("vmagent"), AgentTypeVMAgent)
	assert.Equal(t, AgentType("prometheus-agent"), AgentTypePrometheusAgent)

	assert.Equal(t, DraftStatus("pending"), DraftStatusPending)
	assert.Equal(t, DraftStatus("confirmed"), DraftStatusConfirmed)
	assert.Equal(t, DraftStatus("discarded"), DraftStatusDiscarded)

	assert.Equal(t, DeploymentStatus("pending"), DeploymentStatusPending)
	assert.Equal(t, DeploymentStatus("running"), DeploymentStatusRunning)
	assert.Equal(t, DeploymentStatus("success"), DeploymentStatusSuccess)
	assert.Equal(t, DeploymentStatus("failed"), DeploymentStatusFailed)
	assert.Equal(t, DeploymentStatus("rolled_back"), DeploymentStatusRolledBack)
}

func TestConfigCenterValidationStatus(t *testing.T) {
	assert.Equal(t, ValidationStatus("passed"), ValidationStatusPassed)
	assert.Equal(t, ValidationStatus("failed"), ValidationStatusFailed)
	assert.Equal(t, ValidationStatus("pending"), ValidationStatusPending)
	assert.Equal(t, ValidationStatus("rejected"), ValidationStatusRejected)
	assert.True(t, IsValidValidationStatus(string(ValidationStatusFailed)))
	assert.False(t, IsValidValidationStatus("bogus"))
	assert.Equal(t, []string{"passed", "failed", "pending", "rejected"}, ValidValidationStatus())
}

func TestConfigCenterEnumCollections(t *testing.T) {
	assert.Equal(t, []string{"scrape_job", "target_instance", "monitoring_rule", "probe_target", "label_template", "alertmanager_config"}, ValidChangeItemTargets())
	assert.Equal(t, []string{"add", "update", "delete"}, ValidChangeItemTypes())
	assert.Equal(t, []string{"low", "high"}, ValidRisks())
	assert.Equal(t, []string{"prometheus", "targets", "rules", "blackbox", "alertmanager"}, ValidAffectedFiles())
	assert.True(t, IsValidRisk("high"))
	assert.False(t, IsValidRisk("medium"))

	assert.Equal(t, AffectedFile("prometheus"), AffectedFilePrometheus)
	assert.Equal(t, ChangeItemTarget("monitoring_rule"), ChangeItemTargetMonitoringRule)
	assert.Equal(t, ChangeItemType("delete"), ChangeItemTypeDelete)
	assert.Equal(t, Risk("high"), RiskHigh)
	assert.Equal(t, ConfigSyncStatus("in_sync"), ConfigSyncStatusInSync)
	assert.Equal(t, ConfigSyncStatus("no_version"), ConfigSyncStatusNoVersion)
	assert.Equal(t, OutOfSyncCause("pending_draft"), OutOfSyncCausePendingDraft)
}

func TestConfigChangeItemJSONRoundTrip(t *testing.T) {
	item := ConfigChangeItem{
		ID:            "ci-1",
		Type:          string(ChangeItemTypeAdd),
		Target:        string(ChangeItemTargetTargetInstance),
		Description:   "新增 1 台服务器加入 node-exporter 采集",
		AffectedFiles: []string{string(AffectedFileTargets)},
		Risk:          string(RiskLow),
	}
	b, err := json.Marshal(item)
	assert.NoError(t, err)
	var back ConfigChangeItem
	assert.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, item, back)
	// snake_case JSON 键名。
	assert.Contains(t, string(b), "\"affected_files\"")
	assert.Contains(t, string(b), "\"target_instance\"")
}

func TestConfigDraftMetadataJSONRoundTrip(t *testing.T) {
	md := ConfigDraftMetadata{
		SourceDataVersion:    "2026-08-23T10:00:00Z",
		TriggerSummary:       "ScrapeJob node-exporter-prod 变更",
		Checksum:             "sha256-abc123",
		GeneratorVersion:     "0.1.0",
		SupersededByChangeNo: "CHG-20260823-002",
	}
	b, err := json.Marshal(md)
	assert.NoError(t, err)
	var back ConfigDraftMetadata
	assert.NoError(t, json.Unmarshal(b, &back))
	assert.Equal(t, md, back)
	assert.Contains(t, string(b), "\"source_data_version\"")
	assert.Contains(t, string(b), "\"superseded_by_change_no\"")
}

func TestConfigDeploymentStatusValues(t *testing.T) {
	// All DeploymentStatus must map to a string (contract §5 / §8).
	for _, s := range []DeploymentStatus{
		DeploymentStatusPending, DeploymentStatusRunning, DeploymentStatusSuccess,
		DeploymentStatusFailed, DeploymentStatusRolledBack,
	} {
		assert.NotEmpty(t, string(s))
	}
}

func TestTokenMasked(t *testing.T) {
	assert.Equal(t, "", TokenMasked(""))
	assert.Equal(t, "****", TokenMasked("abcd"), "完全脱敏，不显明文片段")
	assert.Equal(t, 8, len(TokenMasked("tok-1234")))
}

func TestLabelTemplateSnapshotSmoke(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&LabelTemplateSnapshot{}))

	oldMap := LabelMapping{SourceField: "app_name", SourceType: LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true}
	newMap := LabelMapping{SourceField: "service_name", SourceType: LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true}
	snap := &LabelTemplateSnapshot{
		TemplateID: 1,
		Operator:   PlatformAdminTenantID,
		ChangedMappings: []MappingChange{
			{TargetLabel: "app", OldValue: &oldMap, NewValue: &newMap},
		},
	}
	assert.NoError(t, db.Create(snap).Error)
	assert.NotZero(t, snap.ID)

	var got LabelTemplateSnapshot
	assert.NoError(t, db.First(&got, "template_id = ?", 1).Error)
	assert.Len(t, got.ChangedMappings, 1)
	assert.Equal(t, "app", got.ChangedMappings[0].TargetLabel)
	assert.Equal(t, "app_name", got.ChangedMappings[0].OldValue.SourceField)
}
