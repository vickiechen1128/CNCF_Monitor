package models

import (
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

	assert.NoError(t, db.AutoMigrate(&Host{}, &Middleware{}, &Application{}, &LabelTemplate{}, &ScrapeJob{}, &BlackboxProbeConfig{}))
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
