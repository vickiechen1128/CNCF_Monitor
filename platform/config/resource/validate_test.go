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

// alwaysExists 是 networkDomainExists 的全通过桩。
func alwaysExists(string) bool { return true }

// validHostInput 构造通过校验的 host 输入（app_code/cluster 可空，验证留空）。
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
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, validHostInput(), store, nil, nil, alwaysExists))
	})

	t.Run("app_code and cluster optional for host", func(t *testing.T) {
		in := validHostInput()
		in.AppCode = ""
		in.Cluster = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists))
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceIP = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("invalid IPv4 fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceIP = "999.999.999.999"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("missing instance_name fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceName = ""
		in.Hostname = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_name")
	})

	t.Run("hostname serves as instance_name", func(t *testing.T) {
		in := validHostInput()
		in.InstanceName = ""
		in.Hostname = "web-01"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists))
	})

	t.Run("invalid env fails", func(t *testing.T) {
		in := validHostInput()
		in.Env = "production"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "env")
	})

	t.Run("chinese status rejected for API write", func(t *testing.T) {
		in := validHostInput()
		in.Status = "运行中"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "status")
	})

	t.Run("invalid status rejected", func(t *testing.T) {
		in := validHostInput()
		in.Status = "orphan"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
	})
}

func TestValidateResourceInput_Database(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppCode:         "pay-db",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
	}

	t.Run("valid database passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, valid(), store, nil, nil, alwaysExists))
	})

	t.Run("missing database_type fails", func(t *testing.T) {
		in := valid()
		in.DatabaseType = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "database_type")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_code")
	})

	t.Run("missing cluster fails", func(t *testing.T) {
		in := valid()
		in.Cluster = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "cluster")
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		in := valid()
		in.InstanceIP = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("port zero fails (port required)", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("port out of range fails", func(t *testing.T) {
		in := valid()
		in.Port = 70000
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, nil, alwaysExists)
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
			AppCode:         "pay-mq",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			MiddlewareType:  "kafka",
			InstanceIP:      "10.0.0.11",
			Port:            9092,
		}
	}

	t.Run("valid middleware passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryMiddleware, valid(), store, nil, nil, alwaysExists))
	})

	t.Run("missing middleware_type fails", func(t *testing.T) {
		in := valid()
		in.MiddlewareType = ""
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "middleware_type")
	})

	t.Run("missing port fails", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_code")
	})
}

func TestValidateResourceInput_Application(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppCode:         "pay-service",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			ServiceName:     "pay-service",
			HealthCheckURL:  "http://10.0.0.20:8080/health",
			Protocol:        "http",
			Endpoint:        "10.0.0.20",
			Port:            8080,
		}
	}

	t.Run("valid application passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, valid(), store, nil, nil, alwaysExists))
	})

	t.Run("empty health_check_url allowed (可选，仅资源画像与标签来源)", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists))
	})

	t.Run("missing service_name fails", func(t *testing.T) {
		in := valid()
		in.ServiceName = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "service_name")
	})

	t.Run("missing endpoint fails", func(t *testing.T) {
		in := valid()
		in.Endpoint = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "endpoint")
	})

	t.Run("missing 采集端口 port fails", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("port out of range fails", func(t *testing.T) {
		in := valid()
		in.Port = 70000
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_code")
	})

	t.Run("invalid protocol fails", func(t *testing.T) {
		in := valid()
		in.Protocol = "ftp"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protocol")
	})

	t.Run("invalid health_check_url fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = "not-a-url"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "health_check_url")
	})

	t.Run("health_check_url with unsupported scheme fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = "ftp://10.0.0.20/health"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
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
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, valid(), store, nil, nil, alwaysExists))
	})

	t.Run("app_code and cluster optional for generic", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		in.Cluster = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, nil, alwaysExists))
	})

	t.Run("missing target_name fails", func(t *testing.T) {
		in := valid()
		in.TargetName = ""
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "target_name")
	})

	t.Run("invalid IP fails", func(t *testing.T) {
		in := valid()
		in.InstanceIP = "10.0.0"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("domain allowed for generic instance_ip", func(t *testing.T) {
		in := valid()
		in.InstanceIP = "snmp.example.com"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, nil, alwaysExists))
	})

	t.Run("invalid scheme fails", func(t *testing.T) {
		in := valid()
		in.Scheme = "tcp"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "scheme")
	})

	t.Run("port zero ok for generic", func(t *testing.T) {
		in := valid()
		in.Port = 0
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, nil, alwaysExists))
	})
}

func TestValidateResourceInput_Common(t *testing.T) {
	store := newBizStore(t)

	t.Run("invalid category fails", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategory("bogus"), validHostInput(), store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "resource_category")
	})

	t.Run("nil input fails", func(t *testing.T) {
		require.Error(t, ValidateResourceInput(models.ResourceCategoryHost, nil, store, nil, nil, alwaysExists))
	})

	t.Run("missing network_domain_id fails", func(t *testing.T) {
		in := validHostInput()
		in.NetworkDomainID = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "network_domain_id")
	})

	t.Run("network_domain_id not registered fails", func(t *testing.T) {
		in := validHostInput()
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, func(string) bool { return false })
		require.Error(t, err)
		assert.Contains(t, err.Error(), "网域")
	})

	// 决策 93：host 的 biz_code 可空后补（应用上线后才出现业务），空值不校验字典存在性。
	t.Run("host biz_code optional", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists))
	})

	t.Run("disabled or unknown biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "legacy" // sampleYAML 中停用项
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
	})

	t.Run("malformed biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "Bad_Code"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, nil, alwaysExists)
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
	assert.Equal(t, "app_code", m["app_code"])      // Host.GetAppCode() = AppCode
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
		{"app_code", "web"},
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

// ---------------------------------------------------------------------------
// 决策 93/95：biz_code/app_code 必填按类型分化
// ---------------------------------------------------------------------------

// TestValidateResourceInput_BizTypology 覆盖决策 93/95 必填分化：
// host/database/middleware 可空后补、application 必填、generic_target 二选一。
func TestValidateResourceInput_BizTypology(t *testing.T) {
	bizStore := newBizStore(t)
	appStore := newAppStore(t)
	dbInput := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			AppCode:         "pay-db",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
	}
	mwInput := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			AppCode:         "kafka-app",
			Cluster:         "kafka",
			Status:          "online",
			Env:             "prod",
			MiddlewareType:  "kafka",
			InstanceIP:      "10.0.0.11",
			Port:            9092,
		}
	}
	appInput := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			AppCode:         "pay-service",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			ServiceName:     "pay-service",
			HealthCheckURL:  "http://10.0.0.20:8080/health",
			Endpoint:        "10.0.0.20",
			Port:            8080,
		}
	}
	genericInput := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			Status:          "online",
			Env:             "prod",
			TargetName:      "snmp-switch-01",
			InstanceIP:      "10.0.0.30",
			Port:            161,
		}
	}

	t.Run("database biz_code optional (决策 93)", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, dbInput(), bizStore, appStore, nil, alwaysExists))
	})
	t.Run("middleware biz_code optional (决策 93)", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryMiddleware, mwInput(), bizStore, appStore, nil, alwaysExists))
	})
	t.Run("application biz_code required (决策 93)", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategoryApplication, appInput(), bizStore, appStore, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "biz_code")
	})
	t.Run("application biz_code non-empty passes", func(t *testing.T) {
		in := appInput()
		in.BizCode = "payment"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, bizStore, appStore, nil, alwaysExists))
	})
	t.Run("generic both empty fails (决策 95)", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, genericInput(), bizStore, appStore, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "biz_code")
		assert.Contains(t, err.Error(), "app_code")
	})
	t.Run("generic biz only passes", func(t *testing.T) {
		in := genericInput()
		in.BizCode = "infra"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, bizStore, appStore, nil, alwaysExists))
	})
	t.Run("generic app only passes", func(t *testing.T) {
		in := genericInput()
		in.AppCode = "app"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, bizStore, appStore, nil, alwaysExists))
	})
}

// TestValidateResourceInputForUpdate_KeepsDisabledHistory 覆盖决策 92/93 编辑保留停用
// 历史值：请求体值与资源当前值相同时放行（提示并允许保留），修改为新值仍被拒绝。
func TestValidateResourceInputForUpdate_KeepsDisabledHistory(t *testing.T) {
	bizStore := newBizStore(t)
	appStore := newAppStore(t)

	t.Run("disabled app kept as history passes", func(t *testing.T) {
		in := &ResourceInput{
			NetworkDomainID: "default",
			AppCode:         "legacy-app", // 停用条目，保留历史值
			Cluster:         "legacy",
			Status:          "online",
			Env:             "prod",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
		// 不带 keep 时停用条目仍被拒绝（与创建口径一致）。
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, bizStore, appStore, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "应用")
		// 编辑保留历史值：keep 同名 → 放行。
		require.NoError(t, ValidateResourceInputForUpdate(models.ResourceCategoryDatabase, in, bizStore, appStore, nil, alwaysExists, &KeepDisabledValues{AppCode: "legacy-app"}))
	})

	t.Run("disabled app changed to new value rejected", func(t *testing.T) {
		in := &ResourceInput{
			NetworkDomainID: "default",
			AppCode:         "pay-db", // 启用条目
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
		err := ValidateResourceInputForUpdate(models.ResourceCategoryDatabase, in, bizStore, appStore, nil, alwaysExists, &KeepDisabledValues{AppCode: "legacy-app"})
		require.NoError(t, err, "改选启用条目不受 keep 影响")
	})

	t.Run("disabled biz kept as history passes", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "legacy" // 停用业务条目，保留历史值
		err := ValidateResourceInput(models.ResourceCategoryHost, in, bizStore, nil, nil, alwaysExists)
		require.Error(t, err)
		require.NoError(t, ValidateResourceInputForUpdate(models.ResourceCategoryHost, in, bizStore, nil, nil, alwaysExists, &KeepDisabledValues{BizCode: "legacy"}))
	})
}

// ---------------------------------------------------------------------------
// M07 应用资源字段职责（采集地址拆分）：
// health_check_url 为可选「应用实际 URL」，采集地址由 endpoint（主机）+ port（采集端口）
// 构成（M09 generator 拼接口径），二者均必填。
// ---------------------------------------------------------------------------

// TestValidateApplication_AddressSplit 覆盖字段职责拆分后的校验口径：
//   - health_check_url 可选（空值通过），但非空非法时仍按原格式错误返回；
//   - endpoint 必填，缺失报错且文案点明「采集地址主机」；
//   - port 必填且 1~65535（缺省会让 target 落到默认 80 端口）。
func TestValidateApplication_AddressSplit(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppCode:         "pay-service",
			Cluster:         "pay",
			Status:          "online",
			Env:             "prod",
			ServiceName:     "pay-service",
			HealthCheckURL:  "http://10.10.1.4:8081/actuator/health",
			Endpoint:        "10.10.1.4",
			Port:            8081,
			Protocol:        "http",
		}
	}

	t.Run("empty health_check_url passes", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists))
	})

	t.Run("invalid health_check_url keeps format error", func(t *testing.T) {
		for _, raw := range []string{"not-a-url", "ftp://10.10.1.4/health"} {
			in := valid()
			in.HealthCheckURL = raw
			err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "health_check_url", "非法 URL %q 仍按原格式错误返回", raw)
		}
	})

	t.Run("empty endpoint fails with address purpose message", func(t *testing.T) {
		in := valid()
		in.Endpoint = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "endpoint")
		assert.Contains(t, err.Error(), "采集地址")
	})

	t.Run("zero port fails (采集端口必填)", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
		assert.Contains(t, err.Error(), "采集端口")
	})

	t.Run("endpoint 参与唯一键", func(t *testing.T) {
		in := valid()
		assert.Equal(t, "application|default|pay-service|10.10.1.4", DedupKey(models.ResourceCategoryApplication, in))
	})
}

// ---------------------------------------------------------------------------
// 决策 105：可选 service_code（仅 application / generic_target）
// ---------------------------------------------------------------------------

// TestValidateResourceInput_ServiceCode 覆盖可选字段 service_code 的四类场景：
// application / generic_target 填值合法、引用停用 / 未登记拒绝、留空合法；
// host / database / middleware 不挂服务（传值也不校验、不落库）。
func TestValidateResourceInput_ServiceCode(t *testing.T) {
	bizStore := newBizStore(t)
	appStore := newAppStore(t)
	svcStore := newSvcStore(t)

	appIn := func() *ResourceInput {
		return &ResourceInput{
			ResourceCategory: string(models.ResourceCategoryApplication),
			NetworkDomainID:  "default",
			BizCode:          "payment",
			AppCode:          "pay-service",
			Cluster:          "pay",
			Status:           "online",
			Env:              "prod",
			ServiceName:      "pay-service",
			Endpoint:         "10.0.0.20",
			Port:             8080,
		}
	}
	genericIn := func() *ResourceInput {
		return &ResourceInput{
			ResourceCategory: string(models.ResourceCategoryGenericTarget),
			NetworkDomainID:  "default",
			AppCode:          "app",
			Status:           "online",
			Env:              "prod",
			TargetName:       "snmp-switch-01",
			InstanceIP:       "10.0.0.30",
			Port:             161,
		}
	}

	t.Run("application with enabled service_code passes", func(t *testing.T) {
		in := appIn()
		in.ServiceCode = "order-api"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, bizStore, appStore, svcStore, alwaysExists))
	})

	t.Run("application empty service_code passes (纯自由文本向后兼容)", func(t *testing.T) {
		in := appIn()
		in.ServiceCode = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, bizStore, appStore, svcStore, alwaysExists))
	})

	t.Run("application disabled service_code rejected", func(t *testing.T) {
		in := appIn()
		in.ServiceCode = "legacy-api" // 停用条目（fixtures 里 Enabled=false）
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, bizStore, appStore, svcStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "legacy-api")
	})

	t.Run("generic_target with enabled service_code passes", func(t *testing.T) {
		in := genericIn()
		in.ServiceCode = "pay-api"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, bizStore, appStore, svcStore, alwaysExists))
	})

	t.Run("generic_target unknown service_code rejected", func(t *testing.T) {
		in := genericIn()
		in.ServiceCode = "not-registered"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, bizStore, appStore, svcStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not-registered")
	})

	t.Run("host/database/middleware 不挂服务：传 service_code 不校验、不影响通过", func(t *testing.T) {
		// 三种基础设施类型都不提供 service_code 写通道，即便请求体带入也一律忽略
		// （models.Host / Database / Middleware 无该字段，校验不对非适用类型生效）。
		h := validHostInput()
		h.ServiceCode = "legacy-api" // 即便传值也不校验（host 不挂服务）
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, h, bizStore, appStore, svcStore, alwaysExists))

		dbIn := &ResourceInput{
			NetworkDomainID: "default", AppCode: "pay-db", Cluster: "pay", Status: "online", Env: "prod",
			DatabaseType: "mysql", InstanceIP: "10.0.0.10", Port: 3306, ServiceCode: "legacy-api",
		}
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, dbIn, bizStore, appStore, svcStore, alwaysExists))

		mwIn := &ResourceInput{
			NetworkDomainID: "default", AppCode: "kafka-app", Cluster: "kafka", Status: "online", Env: "prod",
			MiddlewareType: "kafka", InstanceIP: "10.0.0.11", Port: 9092, ServiceCode: "legacy-api",
		}
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryMiddleware, mwIn, bizStore, appStore, svcStore, alwaysExists))
	})

	t.Run("service_code 与 service_name 仅软约束：不一致也放行", func(t *testing.T) {
		in := appIn()
		in.ServiceCode = "order-api" // 与 service_name=pay-service 不一致
		in.ServiceName = "pay-service"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, bizStore, appStore, svcStore, alwaysExists))
	})
}

// TestValidateResourceInputForUpdate_KeepsDisabledServiceCode 覆盖 §5.16.2：编辑已属
// 停用服务时允许保留历史值（提示并允许保留），改为其他停用服务仍被拒绝。
func TestValidateResourceInputForUpdate_KeepsDisabledServiceCode(t *testing.T) {
	svcStore := newSvcStore(t)
	base := func() *ResourceInput {
		return &ResourceInput{
			ResourceCategory: string(models.ResourceCategoryApplication),
			NetworkDomainID:  "default",
			BizCode:          "payment",
			AppCode:          "pay-service",
			Cluster:          "pay",
			Status:           "online",
			Env:              "prod",
			ServiceName:      "pay-service",
			Endpoint:         "10.0.0.20",
			Port:             8080,
		}
	}

	keep := &KeepDisabledValues{ServiceCode: "legacy-api"}
	t.Run("keep disabled history value passes", func(t *testing.T) {
		in := base()
		in.ServiceCode = "legacy-api"
		require.NoError(t, ValidateResourceInputForUpdate(models.ResourceCategoryApplication, in, newBizStore(t), newAppStore(t), svcStore, alwaysExists, keep))
	})
	t.Run("switch to another disabled service rejected", func(t *testing.T) {
		in := base()
		in.ServiceCode = "legacy-api"
		err := ValidateResourceInputForUpdate(models.ResourceCategoryApplication, in, newBizStore(t), newAppStore(t), svcStore, alwaysExists, &KeepDisabledValues{ServiceCode: "other"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "legacy-api")
	})
}

// ---- 决策 110 硬校验单测（决策 118-5 强制门禁）----
//
// 此前 validatePlatformCode / ValidateResourceInputWithPlatform{,ForUpdate} 承载
// 「命中启用平台 + 与所属应用关联平台集合自洽 + 编辑保留历史值」全部硬不变量，但
// 全仓无任何测试直接调用（validate_test.go 只覆盖旧 ValidateResourceInput）⇒ 回归缺口。
// 本组用例把三条不变量逐条钉住，并显式覆盖「refs 半初始化 ⇒ 放行」的非 fail-closed 行为。
//
// 夹具复用 app_platform_rel_test.go 的 newAppPlatformStore（in-memory sqlite +
// logger.Discard）：启用平台 platform-a / platform-b / platform-c，停用平台
// old-platform；启用应用 app-a / app-b。本组按需自行挂 app_platform_rel 关联。

// platformTestRefs 注入平台字典 + 应用↔平台关联两个 store（决策 110 生产写链路同构）。
// 三个 store 共用同一夹具 DB，保证「应用字典启用态」与「应用↔平台关联集合」同源
// （openAppPlatformRelTestDB 已落启用应用 app-a / app-b、启用平台 platform-a~c、
// 停用平台 old-platform）。
func platformTestRefs(t *testing.T) *PlatformRefs {
	t.Helper()
	db := openAppPlatformRelTestDB(t)
	return &PlatformRefs{
		PlatformStore:    NewPlatformDictStore(db),
		AppPlatformStore: NewAppPlatformStore(db),
	}
}

// platformTestAppStore 返回与 platformTestRefs 同夹具的应用字典 store（app-a / app-b
// 为启用条目），避免 app_code 启用态校验先于 platform 校验失败、掩盖被测分支。
func platformTestAppStore(t *testing.T) *ApplicationDictStore {
	t.Helper()
	return NewApplicationDictStore(openAppPlatformRelTestDB(t))
}

// platformTestInput 构造通过其余校验的 database 输入，仅供 platform_code 分支测试。
func platformTestInput(appCode, platformCode string) *ResourceInput {
	return &ResourceInput{
		NetworkDomainID: "default",
		BizCode:         "payment",
		AppCode:         appCode,
		PlatformCode:    platformCode,
		Cluster:         "pay",
		Status:          "online",
		Env:             "prod",
		DatabaseType:    "mysql",
		InstanceIP:      "10.0.0.10",
		Port:            3306,
	}
}

// TestValidateResourceInputWithPlatform_SelfConsistency 覆盖决策 110 ②：填值须命中
// 启用平台字典条目，且须落在所属应用的关联平台集合内（自洽）；两条不变量各自正反覆盖。
func TestValidateResourceInputWithPlatform_SelfConsistency(t *testing.T) {
	refs := platformTestRefs(t)
	// app-a 关联 platform-a（含主平台）；app-b 不挂任何平台。
	_, err := refs.AppPlatformStore.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: true})
	require.NoError(t, err)

	t.Run("自洽：启用平台且属于应用关联集合 ⇒ 通过", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-a")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs))
	})

	t.Run("不在应用关联平台集合 ⇒ bad_request", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-b") // 启用但未关联 app-a
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "不属于应用")
		assert.Contains(t, err.Error(), "app-a")
	})

	t.Run("引用停用平台 ⇒ bad_request", func(t *testing.T) {
		in := platformTestInput("app-a", "old-platform") // 已登记但 enabled=false
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "未登记或已停用")
	})

	t.Run("未登记平台 ⇒ bad_request", func(t *testing.T) {
		in := platformTestInput("app-a", "no-such-platform")
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "未登记或已停用")
	})

	t.Run("platform_code 留空 ⇒ 不校验（走应用主平台兜底）", func(t *testing.T) {
		in := platformTestInput("app-a", "")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs))
	})

	t.Run("应用无关联平台 ⇒ 跳过自洽（仅校验启用态）", func(t *testing.T) {
		in := platformTestInput("app-b", "platform-a") // app-b 无任何关联
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs),
			"应用无关联平台集合时不应做自洽比较（决策 110 自洽口径）")
	})

	t.Run("app_code 为空 ⇒ 跳过自洽（host 允许 app_code 留空）", func(t *testing.T) {
		// host 的 app_code 可空（§10A），是「无所属应用」的唯一合法载体；
		// database/middleware/application 的 app_code 必填，不适用于本分支。
		in := validHostInput()
		in.PlatformCode = "platform-a" // 启用平台，但无所属应用可比对
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryHost, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs))
	})
}

// TestValidateResourceInputWithPlatformForUpdate_KeepsDisabledHistory 覆盖决策 110 /
// 92 编辑保留历史值口径：请求体 platform_code 与资源当前值相同时，跳过全部平台校验
// （停用平台 / 与应用平台集合不自洽的历史值均放行）；改为新值仍按创建口径拒绝。
func TestValidateResourceInputWithPlatformForUpdate_KeepsDisabledHistory(t *testing.T) {
	refs := platformTestRefs(t)
	_, err := refs.AppPlatformStore.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: true})
	require.NoError(t, err)

	t.Run("保留停用平台历史值 ⇒ 放行", func(t *testing.T) {
		in := platformTestInput("app-a", "old-platform")
		require.NoError(t, ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, &KeepDisabledValues{PlatformCode: "old-platform"}, refs))
	})

	t.Run("保留与当前应用不关联的历史值 ⇒ 放行（解绑不强制改写）", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-c") // 启用但未关联 app-a
		require.NoError(t, ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, &KeepDisabledValues{PlatformCode: "platform-c"}, refs),
			"决策 111：应用解绑平台后，资源行既有 platform_code 不受解绑影响")
	})

	t.Run("改为新的不自洽值 ⇒ 仍拒绝", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-c")
		err := ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, &KeepDisabledValues{PlatformCode: "old-platform"}, refs)
		require.Error(t, err, "keep 仅豁免同名历史值，改为新值仍须过自洽校验")
		assert.Contains(t, err.Error(), "不属于应用")
	})

	t.Run("改为新的停用平台 ⇒ 仍拒绝", func(t *testing.T) {
		in := platformTestInput("app-a", "old-platform")
		err := ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, &KeepDisabledValues{PlatformCode: "platform-a"}, refs)
		require.Error(t, err, "停用条目不可新选，keep 不豁免不同值")
		assert.Contains(t, err.Error(), "未登记或已停用")
	})
}

// TestValidatePlatformCode_HalfInitializedRefsPasses 固化「refs 半初始化 ⇒ 放行」的
// **非 fail-closed** 行为（决策 118 遗留 MEDIUM-1）。
//
// ⚠️ 此处放行是**已知风险面**，不是推荐口径：validatePlatformCode 在 refs==nil 或
// 任一子 store 为 nil 时直接 return nil，platform_code 的存在性 / 自洽校验被**静默跳过**。
// 因此**禁止半初始化 `PlatformRefs`**——新增任何资源写路径（POST / PUT / Excel 导入）
// 时必须同时注入 `PlatformStore` 与 `AppPlatformStore`，否则该路径的决策 110 硬校验
// 形同虚设且无任何报错。此断言的作用是把该风险显式钉在测试里，供后续新增写路径时
// 由评审对照；一旦生产链路改为 fail-closed，本用例应随之反转。
func TestValidatePlatformCode_HalfInitializedRefsPasses(t *testing.T) {
	t.Run("refs == nil ⇒ 放行（仅供单测跳过）", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-totally-unknown")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, nil),
			"refs 为 nil 时跳过平台校验，行为与旧 ValidateResourceInput 一致")
	})

	t.Run("PlatformStore == nil ⇒ 放行", func(t *testing.T) {
		refs := &PlatformRefs{AppPlatformStore: NewAppPlatformStore(openAppPlatformRelTestDB(t))}
		in := platformTestInput("app-a", "platform-totally-unknown")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs))
	})

	t.Run("AppPlatformStore == nil ⇒ 跳过自洽（启用态仍校验）", func(t *testing.T) {
		refs := &PlatformRefs{PlatformStore: NewPlatformDictStore(openAppPlatformRelTestDB(t))}
		// 自洽被跳过 ⇒ 即便不属于任何应用关联集合也放行。
		in := platformTestInput("app-a", "platform-a")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs))
		// 但启用态校验仍生效：停用平台依旧被拒。
		inDisabled := platformTestInput("app-a", "old-platform")
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, inDisabled,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "未登记或已停用")
	})

	t.Run("不带 keep 的创建态不受 keep 豁免影响", func(t *testing.T) {
		refs := platformTestRefs(t)
		_, err := refs.AppPlatformStore.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: true})
		require.NoError(t, err)
		in := platformTestInput("app-a", "platform-b")
		require.Error(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), nil, alwaysExists, refs),
			"创建态（keep=nil）不做任何豁免")
	})
}
