package query

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var identityTestDBCounter int64

// openResourceIdentityTestDB 打开逐测试独享的内存 SQLite，迁移五类资源表。
func openResourceIdentityTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&identityTestDBCounter, 1)
	dsn := fmt.Sprintf("file:identity_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	))
	return db
}

// seedIdentityHost 落一条 host fixture（resource_id 与 server_id 保持一致以共存多条）。
func seedIdentityHost(t *testing.T, db *gorm.DB, id, name, ip string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     name,
		Status:           "online",
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        ip,
	}).Error)
}

// seedIdentityDatabase 落一条 database fixture（业务端口 3306）。
func seedIdentityDatabase(t *testing.T, db *gorm.DB, id, ip string, port int) {
	t.Helper()
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID:       id,
			ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID:  "default",
			BizCode:          "payment",
			Env:              "prod",
			Status:           "online",
			SourceType:       models.SourceTypeManual,
		},
		DatabaseType: "mysql",
		InstanceIP:   ip,
		Port:         port,
		ResourceType: models.ResourceTypeDatabase,
	}).Error)
}

// seedIdentityMiddleware 落一条 middleware fixture（业务端口 6379）。
func seedIdentityMiddleware(t *testing.T, db *gorm.DB, id, ip string, port int) {
	t.Helper()
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeMiddleware,
		ResourceCategory: models.ResourceCategoryMiddleware,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppName:          "cache",
		Env:              "prod",
		Cluster:          "prod-a",
		Status:           "online",
		MiddlewareType:   "redis",
		InstanceIP:       ip,
		Port:             port,
	}).Error)
}

// seedIdentityApplication 落一条 application fixture（服务名 + 业务端口）。
func seedIdentityApplication(t *testing.T, db *gorm.DB, id, serviceName string, port int) {
	t.Helper()
	require.NoError(t, db.Create(&models.Application{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeApplication,
		ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppName:          "order",
		Env:              "prod",
		Cluster:          "prod-a",
		Status:           "online",
		ServiceName:      serviceName,
		HealthCheckURL:   "http://10.0.0.9:8080/health",
		Protocol:         "http",
		Port:             port,
	}).Error)
}

// seedIdentityGenericTarget 落一条 generic_target fixture。
func seedIdentityGenericTarget(t *testing.T, db *gorm.DB, id, targetName, ip string, port int) {
	t.Helper()
	require.NoError(t, db.Create(&models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID:       id,
			ResourceCategory: models.ResourceCategoryGenericTarget,
			NetworkDomainID:  "default",
			BizCode:          "infra",
			Env:              "prod",
			Status:           "online",
			SourceType:       models.SourceTypeManual,
		},
		TargetName:   targetName,
		InstanceIP:   ip,
		Port:         port,
		MetricsPath:  "/metrics",
		Scheme:       "http",
		ResourceType: models.ResourceTypeGenericTarget,
	}).Error)
}

// countingLogger 统计实际执行的 SQL 条数（验证回连为批量查询、非 N+1）。
type countingLogger struct {
	logger.Interface
	queries int64
}

func (l *countingLogger) Trace(_ context.Context, _ time.Time, _ func() (string, int64), _ error) {
	atomic.AddInt64(&l.queries, 1)
}

// TestResolveResourceIdentitiesFiveCategories 覆盖五类资源表的归一化取值口径
// （host=instance_name、database/middleware=instance_ip、application=service_name、
// generic_target=target_name；端口为资源业务端口，host 无业务端口）。
func TestResolveResourceIdentitiesFiveCategories(t *testing.T) {
	db := openResourceIdentityTestDB(t)
	seedIdentityHost(t, db, "res-host", "ceshi", "1.15.94.116")
	seedIdentityDatabase(t, db, "res-db", "10.0.0.7", 3306)
	seedIdentityMiddleware(t, db, "res-mw", "10.0.0.11", 6379)
	seedIdentityApplication(t, db, "res-app", "order-svc", 8080)
	seedIdentityGenericTarget(t, db, "res-gt", "nginx-exp", "10.0.0.9", 9113)

	got, err := ResolveResourceIdentities(db, []string{"res-host", "res-db", "res-mw", "res-app", "res-gt"})
	require.NoError(t, err)
	require.Len(t, got, 5)

	assert.Equal(t, ResourceIdentity{
		ResourceID: "res-host", Name: "ceshi", Category: "host", IP: "1.15.94.116", Port: 0,
	}, got["res-host"])
	assert.Equal(t, ResourceIdentity{
		ResourceID: "res-db", Name: "10.0.0.7", Category: "database", IP: "10.0.0.7", Port: 3306,
	}, got["res-db"])
	assert.Equal(t, ResourceIdentity{
		ResourceID: "res-mw", Name: "10.0.0.11", Category: "middleware", IP: "10.0.0.11", Port: 6379,
	}, got["res-mw"])
	assert.Equal(t, ResourceIdentity{
		ResourceID: "res-app", Name: "order-svc", Category: "application", IP: "", Port: 8080,
	}, got["res-app"])
	assert.Equal(t, ResourceIdentity{
		ResourceID: "res-gt", Name: "nginx-exp", Category: "generic_target", IP: "10.0.0.9", Port: 9113,
	}, got["res-gt"])
}

// TestResolveResourceIdentitiesUnmatchedAndEmpty 覆盖未命中 / 空输入 / 去重：
// 未命中不出现在结果中；空输入与 nil db 返回空 map 且不报错；重复 id 不重复查询。
func TestResolveResourceIdentitiesUnmatchedAndEmpty(t *testing.T) {
	db := openResourceIdentityTestDB(t)
	seedIdentityHost(t, db, "res-host", "ceshi", "1.15.94.116")

	got, err := ResolveResourceIdentities(db, []string{"res-host", "res-host", "", "no-such-id"})
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "ceshi", got["res-host"].Name)

	empty, err := ResolveResourceIdentities(db, nil)
	require.NoError(t, err)
	assert.Empty(t, empty)

	nilDB, err := ResolveResourceIdentities(nil, []string{"res-host"})
	require.NoError(t, err)
	assert.Empty(t, nilDB)

	// Safe 封装：nil db 同样安全返回空 map（告警主链路不阻塞）。
	assert.Empty(t, ResolveResourceIdentitiesSafe(nil, []string{"res-host"}))
}

// TestResolveResourceIdentitiesIsBatched 覆盖「禁 N+1」：任意数量的 resource_id
// 只产生固定 5 条 SELECT（每类资源表一条 IN 查询）。
func TestResolveResourceIdentitiesIsBatched(t *testing.T) {
	db := openResourceIdentityTestDB(t)
	seedIdentityHost(t, db, "res-1", "h1", "10.0.0.1")
	seedIdentityHost(t, db, "res-2", "h2", "10.0.0.2")
	seedIdentityHost(t, db, "res-3", "h3", "10.0.0.3")

	// 记录器必须在 seed 之后挂载，只统计回连产生的 SQL。
	counter := &countingLogger{Interface: logger.Discard}
	db.Logger = counter

	got, err := ResolveResourceIdentities(db, []string{"res-1", "res-2", "res-3"})
	require.NoError(t, err)
	require.Len(t, got, 3)

	assert.Equal(t, int64(5), atomic.LoadInt64(&counter.queries),
		"3 个 resource_id 应只触发 5 条批量 SELECT（每类资源表一条），而非逐 id 查询")
}

// TestInstanceFieldsOf 覆盖实例展示字段组的组装口径（v1.15 决策 70）：
// 回连命中优先；无 resource_id 或未命中时实例名为空、兼容字段走标签回落链；
// 死键 hostname 不再参与，service_name / instance_name 按新键序生效。
func TestInstanceFieldsOf(t *testing.T) {
	identities := map[string]ResourceIdentity{
		"res-host": {ResourceID: "res-host", Name: "ceshi", Category: "host", IP: "1.15.94.116"},
	}

	tests := []struct {
		name     string
		labels   map[string]string
		wantAddr string
		wantName string
		wantDisp string
		wantCat  string
		wantIP   string
	}{
		{
			name:     "回连命中 host：实例名取 M01，采集地址取 instance",
			labels:   map[string]string{"resource_id": "res-host", "instance": "1.15.94.116:9100"},
			wantAddr: "1.15.94.116:9100", wantName: "ceshi", wantDisp: "ceshi", wantCat: "host", wantIP: "1.15.94.116",
		},
		{
			name:     "聚合告警：无任何实例标签",
			labels:   map[string]string{},
			wantAddr: "", wantName: "", wantDisp: "", wantCat: "", wantIP: "",
		},
		{
			name:     "resource_id 未命中：实例名为空、兼容字段回落地址",
			labels:   map[string]string{"resource_id": "gone", "instance": "1.15.94.116:9100"},
			wantAddr: "1.15.94.116:9100", wantName: "", wantDisp: "1.15.94.116:9100",
		},
		{
			name:     "拨测 Job：target 组无标签（无 resource_id）",
			labels:   map[string]string{"instance": "http://10.0.0.9:8080/health"},
			wantAddr: "http://10.0.0.9:8080/health", wantName: "", wantDisp: "http://10.0.0.9:8080/health",
		},
		{
			name:     "service_name 兜底：application 无回连时展示服务名",
			labels:   map[string]string{"service_name": "order-svc"},
			wantAddr: "", wantName: "", wantDisp: "order-svc",
		},
		{
			name:     "instance_name 标签（三期）优先于 instance",
			labels:   map[string]string{"instance_name": "ceshi-tag", "instance": "1.15.94.116:9100"},
			wantAddr: "1.15.94.116:9100", wantName: "", wantDisp: "ceshi-tag",
		},
		{
			name:     "死键 hostname 不再参与回落",
			labels:   map[string]string{"hostname": "legacy-name"},
			wantAddr: "", wantName: "", wantDisp: "",
		},
		{
			name:     "无 instance 时采集地址回落 instance_ip",
			labels:   map[string]string{"instance_ip": "10.0.0.10"},
			wantAddr: "10.0.0.10", wantName: "", wantDisp: "10.0.0.10",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := InstanceFieldsOf(tt.labels, identities)
			assert.Equal(t, tt.wantAddr, got.InstanceAddress)
			assert.Equal(t, tt.wantName, got.ResourceName)
			assert.Equal(t, tt.wantDisp, got.InstanceDisplay)
			assert.Equal(t, tt.wantCat, got.ResourceCategory)
			assert.Equal(t, tt.wantIP, got.ResourceIP)
		})
	}
}
