package models

import (
	"strconv"
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
		&EdgeAgent{}, &BusinessMetric{},
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
		ID:              PlatformAdminTenantID,
		Name:            "平台默认租户",
		NetworkDomainIDs: []string{DefaultDomainID},
		MultiSiteEnabled: false,
		IsPlatformAdmin: true,
		Status:          TenantStatusActive,
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
	}
	assert.True(t, found, "default host template must map biz_code -> biz")
}

func TestBuiltinTemplates(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ExporterTemplate{}, &CITypeExporterMapping{}))

	templates := BuiltinExporterTemplates()
	assert.Len(t, templates, 4) // node / mysqld / redis / windows
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
		Name:           "node-down",
		ContentMode:    RuleContentModeYAMLPassthrough,
		Scope:          ScopeTypeCentral,
		Enabled:        true,
		DraftStatus:    "ready",
		ChangeStatus:   ChangeStatusNone,
	}
	assert.NoError(t, db.Create(rule).Error)
	assert.NotZero(t, rule.ID)
}

func TestConfigModelsSmoke(t *testing.T) {
	db := newMemDB(t)
	assert.NoError(t, db.AutoMigrate(&ConfigDraft{}, &ConfigVersion{}, &ConfigDeployment{}))

	draft := &ConfigDraft{
		NetworkDomainID: DefaultDomainID,
		ChangeNo:        "CHG-20260821-001",
		PrometheusYml:   "global: { scrape_interval: 15s }",
		Status:          DraftStatusPending,
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
