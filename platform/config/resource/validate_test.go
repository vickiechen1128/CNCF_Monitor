package resource

import (
	"net/url"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newBizStore 构造一个加载 sampleYAML 的业务字典（sampleYAML/writeDomains 定义于
// business_test.go，同包复用）：含启用项 infra/payment/data-api 与停用项 legacy。
func newBizStore(t *testing.T) *BusinessDomainStore {
	t.Helper()
	return NewBusinessDomainStore(writeDomains(t, sampleYAML))
}

// alwaysExists 是 networkDomainExists 的全通过桩。
func alwaysExists(string) bool { return true }

// validHostInput 构造通过校验的 host 输入（app_name/cluster 可空，验证留空）。
func validHostInput() *ResourceInput {
	return &ResourceInput{
		ResourceCategory: string(models.ResourceCategoryHost),
		NetworkDomainID:  "default",
		BizCode:          "infra",
		Status:           "online",
		Env:              "prod",
		InstanceName:     "web-01",
		InstanceIP:       "10.0.0.1",
		OSType:           "Linux",
	}
}

func TestValidateResourceInput_Host(t *testing.T) {
	store := newBizStore(t)

	t.Run("valid host passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, validHostInput(), store, alwaysExists))
	})

	t.Run("app_name and cluster optional for host", func(t *testing.T) {
		in := validHostInput()
		in.AppName = ""
		in.Cluster = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists))
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceIP = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("invalid IPv4 fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceIP = "999.999.999.999"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("missing instance_name fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceName = ""
		in.Hostname = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_name")
	})

	t.Run("hostname serves as instance_name", func(t *testing.T) {
		in := validHostInput()
		in.InstanceName = ""
		in.Hostname = "web-01"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists))
	})

	t.Run("invalid env fails", func(t *testing.T) {
		in := validHostInput()
		in.Env = "production"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "env")
	})

	t.Run("chinese status rejected for API write", func(t *testing.T) {
		in := validHostInput()
		in.Status = "运行中"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "status")
	})

	t.Run("invalid status rejected", func(t *testing.T) {
		in := validHostInput()
		in.Status = "orphan"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
	})
}

func TestValidateResourceInput_Database(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppName:         "pay-db",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
	}

	t.Run("valid database passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, valid(), store, alwaysExists))
	})

	t.Run("missing database_type fails", func(t *testing.T) {
		in := valid()
		in.DatabaseType = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "database_type")
	})

	t.Run("missing app_name fails", func(t *testing.T) {
		in := valid()
		in.AppName = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_name")
	})

	t.Run("missing cluster fails", func(t *testing.T) {
		in := valid()
		in.Cluster = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "cluster")
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		in := valid()
		in.InstanceIP = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("port zero fails (port required)", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("port out of range fails", func(t *testing.T) {
		in := valid()
		in.Port = 70000
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})
}

func TestValidateResourceInput_Middleware(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppName:         "pay-mq",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			MiddlewareType:  "kafka",
			InstanceIP:      "10.0.0.11",
			Port:            9092,
		}
	}

	t.Run("valid middleware passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryMiddleware, valid(), store, alwaysExists))
	})

	t.Run("missing middleware_type fails", func(t *testing.T) {
		in := valid()
		in.MiddlewareType = ""
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "middleware_type")
	})

	t.Run("missing port fails", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("missing app_name fails", func(t *testing.T) {
		in := valid()
		in.AppName = ""
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_name")
	})
}

func TestValidateResourceInput_Application(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppName:         "pay-service",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			ServiceName:     "pay-service",
			HealthCheckURL:  "http://10.0.0.20:8080/health",
			Protocol:        "http",
			Endpoint:        "10.0.0.20:8080",
			Port:            8080,
		}
	}

	t.Run("valid application passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, valid(), store, alwaysExists))
	})

	t.Run("missing service_name fails", func(t *testing.T) {
		in := valid()
		in.ServiceName = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "service_name")
	})

	t.Run("missing endpoint fails", func(t *testing.T) {
		in := valid()
		in.Endpoint = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "endpoint")
	})

	t.Run("missing app_name fails", func(t *testing.T) {
		in := valid()
		in.AppName = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_name")
	})

	t.Run("invalid protocol fails", func(t *testing.T) {
		in := valid()
		in.Protocol = "ftp"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protocol")
	})

	t.Run("invalid health_check_url fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = "not-a-url"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "health_check_url")
	})

	t.Run("health_check_url with unsupported scheme fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = "ftp://10.0.0.20/health"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "health_check_url")
	})
}

func TestValidateResourceInput_GenericTarget(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "infra",
			Status:          "online",
			Env:             "prod",
			TargetName:      "snmp-switch-01",
			InstanceIP:      "10.0.0.30",
			Port:            161,
			Scheme:          "http",
			MetricsPath:     "/metrics",
		}
	}

	t.Run("valid generic passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, valid(), store, alwaysExists))
	})

	t.Run("app_name and cluster optional for generic", func(t *testing.T) {
		in := valid()
		in.AppName = ""
		in.Cluster = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, alwaysExists))
	})

	t.Run("missing target_name fails", func(t *testing.T) {
		in := valid()
		in.TargetName = ""
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "target_name")
	})

	t.Run("invalid IP fails", func(t *testing.T) {
		in := valid()
		in.InstanceIP = "10.0.0"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("domain allowed for generic instance_ip", func(t *testing.T) {
		in := valid()
		in.InstanceIP = "snmp.example.com"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, alwaysExists))
	})

	t.Run("invalid scheme fails", func(t *testing.T) {
		in := valid()
		in.Scheme = "tcp"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "scheme")
	})

	t.Run("port zero ok for generic", func(t *testing.T) {
		in := valid()
		in.Port = 0
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, alwaysExists))
	})
}

func TestValidateResourceInput_Common(t *testing.T) {
	store := newBizStore(t)

	t.Run("invalid category fails", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategory("bogus"), validHostInput(), store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "resource_category")
	})

	t.Run("nil input fails", func(t *testing.T) {
		require.Error(t, ValidateResourceInput(models.ResourceCategoryHost, nil, store, alwaysExists))
	})

	t.Run("missing network_domain_id fails", func(t *testing.T) {
		in := validHostInput()
		in.NetworkDomainID = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "network_domain_id")
	})

	t.Run("network_domain_id not registered fails", func(t *testing.T) {
		in := validHostInput()
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, func(string) bool { return false })
		require.Error(t, err)
		assert.Contains(t, err.Error(), "网域")
	})

	t.Run("missing biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "biz_code")
	})

	t.Run("disabled or unknown biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "legacy" // sampleYAML 中停用项
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
	})

	t.Run("malformed biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "Bad_Code"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, alwaysExists)
		require.Error(t, err)
	})
}

// TestDedupKey 覆盖五类判重键生成（Module_07 §5.16.2）。
func TestDedupKey(t *testing.T) {
	cases := []struct {
		name string
		cat  models.ResourceCategory
		in   *ResourceInput
		want string
	}{
		{"host", models.ResourceCategoryHost,
			&ResourceInput{NetworkDomainID: "default", InstanceIP: "10.0.0.1"},
			"host|default|10.0.0.1"},
		{"database", models.ResourceCategoryDatabase,
			&ResourceInput{NetworkDomainID: "default", InstanceIP: "10.0.0.1", Port: 3306},
			"database|default|10.0.0.1|3306"},
		{"middleware", models.ResourceCategoryMiddleware,
			&ResourceInput{NetworkDomainID: "d1", InstanceIP: "10.0.0.2", Port: 9092},
			"middleware|d1|10.0.0.2|9092"},
		{"generic_target", models.ResourceCategoryGenericTarget,
			&ResourceInput{NetworkDomainID: "d1", InstanceIP: "10.0.0.3", Port: 9100},
			"generic_target|d1|10.0.0.3|9100"},
		{"application", models.ResourceCategoryApplication,
			&ResourceInput{NetworkDomainID: "d1", ServiceName: "pay-service", Endpoint: "10.0.0.4:8080"},
			"application|d1|pay-service|10.0.0.4:8080"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, DedupKey(tc.cat, tc.in))
		})
	}
}

// TestLegacyFieldMap_Host 断言 Host 的 PRD 字段名 → legacy 模型列映射
// （映射来源见 models/host.go 访问器）。
func TestLegacyFieldMap_Host(t *testing.T) {
	m := LegacyFieldMap(models.ResourceCategoryHost)
	assert.Equal(t, "private_ip", m["instance_ip"]) // Host.InstanceIP() = PrivateIP
	assert.Equal(t, "instance_name", m["hostname"]) // Host.Hostname() = InstanceName
	assert.Equal(t, "image", m["os_type"])          // Host.OSType() = Image
	assert.Equal(t, "env_flag", m["env"])           // Host.GetEnv() = EnvFlag
	assert.Equal(t, "sub_app_code", m["cluster"])   // Host.GetCluster() = SubAppCode
	assert.Equal(t, "app_code", m["app_name"])      // Host.GetAppName() = AppCode
}

func TestGetResourceField(t *testing.T) {
	h := &models.Host{
		ResourceID:      "host-uuid",
		NetworkDomainID: "default",
		BizCode:         "infra",
		AppCode:         "web",
		SubAppCode:      "web-cluster",
		EnvFlag:         "prod",
		Status:          "online",
		PrivateIP:       "10.0.0.1",
		InstanceName:    "web-01",
		Image:           "Linux",
	}
	cases := []struct{ field, want string }{
		{"instance_ip", "10.0.0.1"},
		{"hostname", "web-01"},
		{"os_type", "Linux"},
		{"env", "prod"},
		{"cluster", "web-cluster"},
		{"app_name", "web"},
		{"biz_code", "infra"},
		{"network_domain_id", "default"},
		{"status", "online"},
		{"resource_id", "host-uuid"},
	}
	for _, tc := range cases {
		got, ok := GetResourceField(h, tc.field)
		require.True(t, ok, "field %q 应可读取", tc.field)
		assert.Equal(t, tc.want, got, "field %q", tc.field)
	}

	_, ok := GetResourceField(h, "no-such-field")
	assert.False(t, ok)

	_, ok = GetResourceField("not-a-resource", "instance_ip")
	assert.False(t, ok)
}

func TestParsePageParams(t *testing.T) {
	t.Run("defaults to page 1 and page_size 50", func(t *testing.T) {
		p := ParsePageParams(url.Values{})
		assert.Equal(t, 1, p.Page)
		assert.Equal(t, DefaultPageSize, p.PageSize) // PRD §6.1 MVP 默认 50
	})

	t.Run("parses provided values", func(t *testing.T) {
		p := ParsePageParams(url.Values{"page": {"3"}, "page_size": {"25"}})
		assert.Equal(t, 3, p.Page)
		assert.Equal(t, 25, p.PageSize)
	})

	t.Run("clamps oversized page_size to max 100", func(t *testing.T) {
		p := ParsePageParams(url.Values{"page_size": {"5000"}})
		assert.Equal(t, MaxPageSize, p.PageSize)
		assert.Equal(t, 1, p.Page)
	})

	t.Run("invalid values fall back to defaults", func(t *testing.T) {
		p := ParsePageParams(url.Values{"page": {"abc"}, "page_size": {"-5"}})
		assert.Equal(t, 1, p.Page)
		assert.Equal(t, DefaultPageSize, p.PageSize)
	})
}

func TestParseListFilter(t *testing.T) {
	f := ParseListFilter(url.Values{
		"network_domain_id": {"default"},
		"keyword":           {"web"},
		"is_monitored":      {"false"},
		"page":              {"2"},
		"page_size":         {"10"},
	})
	assert.Equal(t, "default", f.NetworkDomainID)
	assert.Equal(t, "web", f.Keyword)
	assert.Equal(t, "false", f.IsMonitored)
	assert.Equal(t, 2, f.Page)
	assert.Equal(t, 10, f.PageSize)
}

// selectModel 返回对应分类的表模型，用于 BuildListQuery 关键字列断言。
func selectModel(cat models.ResourceCategory) any {
	switch cat {
	case models.ResourceCategoryHost:
		return &models.Host{}
	case models.ResourceCategoryDatabase:
		return &models.Database{}
	case models.ResourceCategoryMiddleware:
		return &models.Middleware{}
	case models.ResourceCategoryApplication:
		return &models.Application{}
	case models.ResourceCategoryGenericTarget:
		return &models.GenericTarget{}
	}
	return &models.Host{}
}

func TestBuildListQuery(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)

	cases := []struct {
		name     string
		category models.ResourceCategory
		wantLike []string // keyword LIKE 应命中的列
	}{
		{"host name+ip like", models.ResourceCategoryHost, []string{"instance_name LIKE", "private_ip LIKE"}},
		{"database ip like", models.ResourceCategoryDatabase, []string{"instance_ip LIKE"}},
		{"middleware ip like", models.ResourceCategoryMiddleware, []string{"instance_ip LIKE"}},
		{"application service+endpoint like", models.ResourceCategoryApplication, []string{"service_name LIKE", "endpoint LIKE"}},
		{"generic target+ip like", models.ResourceCategoryGenericTarget, []string{"target_name LIKE", "instance_ip LIKE"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := db.Model(selectModel(tc.category)).Session(&gorm.Session{DryRun: true})
			q = BuildListQuery(q, tc.category, ListFilter{
				NetworkDomainID: "default",
				Keyword:         "web",
				IsMonitored:     "false",
			})
			var out []map[string]any
			require.NoError(t, q.Find(&out).Error)
			sqlStr := q.Statement.SQL.String()
			assert.Contains(t, sqlStr, "network_domain_id = ?", "网域筛选应拼接")
			for _, want := range tc.wantLike {
				assert.Contains(t, sqlStr, want, "keyword 应构造 %s", want)
			}
		})
	}

	t.Run("no filters keeps base query", func(t *testing.T) {
		q := db.Model(&models.Host{}).Session(&gorm.Session{DryRun: true})
		q = BuildListQuery(q, models.ResourceCategoryHost, ListFilter{})
		var out []models.Host
		require.NoError(t, q.Find(&out).Error)
		assert.NotContains(t, q.Statement.SQL.String(), "WHERE", "无筛选时不应拼接 WHERE")
	})
}
