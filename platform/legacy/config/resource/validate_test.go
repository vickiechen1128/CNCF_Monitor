package resource

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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
		Env:              "PRD",
		InstanceName:     "web-01",
		InstanceIP:       "10.0.0.1",
		OSType:           "Linux",
	}
}

func TestValidateResourceInput_Host(t *testing.T) {
	store := newBizStore(t)

	t.Run("valid host passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, validHostInput(), store, nil, alwaysExists))
	})

	t.Run("app_code and cluster optional for host", func(t *testing.T) {
		in := validHostInput()
		in.AppCode = ""
		in.Cluster = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists))
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceIP = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("invalid IPv4 fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceIP = "999.999.999.999"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("missing instance_name fails", func(t *testing.T) {
		in := validHostInput()
		in.InstanceName = ""
		in.Hostname = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_name")
	})

	t.Run("hostname serves as instance_name", func(t *testing.T) {
		in := validHostInput()
		in.InstanceName = ""
		in.Hostname = "web-01"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists))
	})

	t.Run("invalid env fails", func(t *testing.T) {
		in := validHostInput()
		in.Env = "production"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "env")
	})

	t.Run("chinese status rejected for API write", func(t *testing.T) {
		in := validHostInput()
		in.Status = "运行中"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "status")
	})

	t.Run("invalid status rejected", func(t *testing.T) {
		in := validHostInput()
		in.Status = "orphan"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
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
			Env:             "PRD",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
	}

	t.Run("valid database passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, valid(), store, nil, alwaysExists))
	})

	t.Run("missing database_type fails", func(t *testing.T) {
		in := valid()
		in.DatabaseType = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "database_type")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_code")
	})

	t.Run("missing cluster fails", func(t *testing.T) {
		in := valid()
		in.Cluster = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "cluster")
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		in := valid()
		in.InstanceIP = ""
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("port zero fails (port required)", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("port out of range fails", func(t *testing.T) {
		in := valid()
		in.Port = 70000
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, store, nil, alwaysExists)
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
			Env:             "PRD",
			MiddlewareType:  "kafka",
			InstanceIP:      "10.0.0.11",
			Port:            9092,
		}
	}

	t.Run("valid middleware passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryMiddleware, valid(), store, nil, alwaysExists))
	})

	t.Run("missing middleware_type fails", func(t *testing.T) {
		in := valid()
		in.MiddlewareType = ""
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "middleware_type")
	})

	t.Run("missing port fails", func(t *testing.T) {
		in := valid()
		in.Port = 0
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryMiddleware, in, store, nil, alwaysExists)
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
			Env:             "PRD",
			ServiceName:     "pay-service",
			HealthCheckURL:  "http://10.0.0.20:8080/health",
			Protocol:        "http",
			Endpoint:        "10.0.0.20",
			Port:            8080,
		}
	}

	t.Run("valid application passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, valid(), store, nil, alwaysExists))
	})

	t.Run("empty health_check_url fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "health_check_url")
	})

	t.Run("missing service_name fails", func(t *testing.T) {
		in := valid()
		in.ServiceName = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "service_name")
	})

	t.Run("empty endpoint and zero port allowed", func(t *testing.T) {
		in := valid()
		in.Endpoint = ""
		in.Port = 0
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists))
	})

	t.Run("port out of range fails", func(t *testing.T) {
		in := valid()
		in.Port = 70000
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "port")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_code")
	})

	t.Run("invalid protocol fails", func(t *testing.T) {
		in := valid()
		in.Protocol = "ftp"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protocol")
	})

	t.Run("invalid health_check_url fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = "not-a-url"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "health_check_url")
	})

	t.Run("health_check_url with unsupported scheme fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = "ftp://10.0.0.20/health"
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
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
			Env:             "PRD",
			TargetName:      "snmp-switch-01",
			InstanceIP:      "10.0.0.30",
			Port:            161,
			Scheme:          "http",
			MetricsPath:     "/metrics",
		}
	}

	t.Run("valid generic passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, valid(), store, nil, alwaysExists))
	})

	t.Run("app_code and cluster optional for generic", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		in.Cluster = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, alwaysExists))
	})

	t.Run("missing target_name fails", func(t *testing.T) {
		in := valid()
		in.TargetName = ""
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "target_name")
	})

	t.Run("invalid IP fails", func(t *testing.T) {
		in := valid()
		in.InstanceIP = "10.0.0"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "instance_ip")
	})

	t.Run("domain allowed for generic instance_ip", func(t *testing.T) {
		in := valid()
		in.InstanceIP = "snmp.example.com"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, alwaysExists))
	})

	t.Run("invalid scheme fails", func(t *testing.T) {
		in := valid()
		in.Scheme = "tcp"
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "scheme")
	})

	t.Run("port zero ok for generic", func(t *testing.T) {
		in := valid()
		in.Port = 0
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, store, nil, alwaysExists))
	})
}

// TestValidateResourceInput_InterfaceService 覆盖第 6 类「接口服务」的类型专属校验
// （阶段 2）：api_name / api_url 必填；api_url 须为 http/https 绝对 URL；
// biz_code / app_code 对接口服务为必填（区别于 generic_target 的可选）。
func TestValidateResourceInput_InterfaceService(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppCode:         "pay-api",
			Status:          "online",
			Env:             "PRD",
			APIName:         "支付下单接口",
			APIURL:          "https://api.example.com/v1/order",
		}
	}

	t.Run("valid interface_service passes", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryInterfaceService, valid(), store, nil, alwaysExists))
	})

	t.Run("http scheme passes", func(t *testing.T) {
		in := valid()
		in.APIURL = "http://10.0.0.20:8080/health"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists))
	})

	t.Run("missing api_name fails", func(t *testing.T) {
		in := valid()
		in.APIName = ""
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_name")
	})

	t.Run("overlong api_name fails", func(t *testing.T) {
		in := valid()
		in.APIName = strings.Repeat("a", 201)
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_name")
	})

	t.Run("missing api_url fails", func(t *testing.T) {
		in := valid()
		in.APIURL = ""
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_url")
	})

	t.Run("ftp scheme fails", func(t *testing.T) {
		in := valid()
		in.APIURL = "ftp://files.example.com/x"
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_url")
	})

	t.Run("relative url fails", func(t *testing.T) {
		in := valid()
		in.APIURL = "/health"
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_url")
	})

	t.Run("overlong api_url fails", func(t *testing.T) {
		in := valid()
		in.APIURL = "https://api.example.com/" + strings.Repeat("a", 500)
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_url")
	})

	t.Run("missing biz_code fails", func(t *testing.T) {
		in := valid()
		in.BizCode = ""
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "biz_code")
	})

	t.Run("missing app_code fails", func(t *testing.T) {
		in := valid()
		in.AppCode = ""
		err := ValidateResourceInput(models.ResourceCategoryInterfaceService, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "app_code")
	})
}

func TestValidateResourceInput_Common(t *testing.T) {
	store := newBizStore(t)

	t.Run("invalid category fails", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategory("bogus"), validHostInput(), store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "resource_category")
	})

	t.Run("nil input fails", func(t *testing.T) {
		require.Error(t, ValidateResourceInput(models.ResourceCategoryHost, nil, store, nil, alwaysExists))
	})

	t.Run("missing network_domain_id fails", func(t *testing.T) {
		in := validHostInput()
		in.NetworkDomainID = ""
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "network_domain_id")
	})

	t.Run("network_domain_id not registered fails", func(t *testing.T) {
		in := validHostInput()
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, func(string) bool { return false })
		require.Error(t, err)
		assert.Contains(t, err.Error(), "网域")
	})

	// 决策 93：host 的 biz_code 可空后补（应用上线后才出现业务），空值不校验字典存在性。
	t.Run("host biz_code optional", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists))
	})

	t.Run("disabled or unknown biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "legacy" // sampleYAML 中停用项
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
		require.Error(t, err)
	})

	t.Run("malformed biz_code fails", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "Bad_Code"
		err := ValidateResourceInput(models.ResourceCategoryHost, in, store, nil, alwaysExists)
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
			&ResourceInput{NetworkDomainID: "d1", ServiceName: "pay-service", HealthCheckURL: "http://10.0.0.4:8080/health"},
			"application|d1|pay-service|http://10.0.0.4:8080/health"},
		{"interface_service", models.ResourceCategoryInterfaceService,
			&ResourceInput{NetworkDomainID: "d1", APIURL: " https://api.example.com/v1/order "},
			"interface_service|d1|https://api.example.com/v1/order"},
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
		EnvFlag:         "PRD",
		Status:          "online",
		PrivateIP:       "10.0.0.1",
		InstanceName:    "web-01",
		Image:           "Linux",
	}
	cases := []struct{ field, want string }{
		{"instance_ip", "10.0.0.1"},
		{"hostname", "web-01"},
		{"os_type", "Linux"},
		{"env", "PRD"},
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
			Env:             "PRD",
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
			Env:             "PRD",
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
			Env:             "PRD",
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
			Env:             "PRD",
			TargetName:      "snmp-switch-01",
			InstanceIP:      "10.0.0.30",
			Port:            161,
		}
	}

	t.Run("database biz_code optional (决策 93)", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, dbInput(), bizStore, appStore, alwaysExists))
	})
	t.Run("middleware biz_code optional (决策 93)", func(t *testing.T) {
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryMiddleware, mwInput(), bizStore, appStore, alwaysExists))
	})
	t.Run("application biz_code required (决策 93)", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategoryApplication, appInput(), bizStore, appStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "biz_code")
	})
	t.Run("application biz_code non-empty passes", func(t *testing.T) {
		in := appInput()
		in.BizCode = "payment"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, bizStore, appStore, alwaysExists))
	})
	t.Run("generic both empty fails (决策 95)", func(t *testing.T) {
		err := ValidateResourceInput(models.ResourceCategoryGenericTarget, genericInput(), bizStore, appStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "biz_code")
		assert.Contains(t, err.Error(), "app_code")
	})
	t.Run("generic biz only passes", func(t *testing.T) {
		in := genericInput()
		in.BizCode = "infra"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, bizStore, appStore, alwaysExists))
	})
	t.Run("generic app only passes", func(t *testing.T) {
		in := genericInput()
		in.AppCode = "app"
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryGenericTarget, in, bizStore, appStore, alwaysExists))
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
			Env:             "PRD",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
		// 不带 keep 时停用条目仍被拒绝（与创建口径一致）。
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, bizStore, appStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "应用")
		// 编辑保留历史值：keep 同名 → 放行。
		require.NoError(t, ValidateResourceInputForUpdate(models.ResourceCategoryDatabase, in, bizStore, appStore, alwaysExists, &KeepDisabledValues{AppCode: "legacy-app"}))
	})

	t.Run("disabled app changed to new value rejected", func(t *testing.T) {
		in := &ResourceInput{
			NetworkDomainID: "default",
			AppCode:         "pay-db", // 启用条目
			Cluster:         "pay",
			Status:          "online",
			Env:             "PRD",
			DatabaseType:    "mysql",
			InstanceIP:      "10.0.0.10",
			Port:            3306,
		}
		err := ValidateResourceInputForUpdate(models.ResourceCategoryDatabase, in, bizStore, appStore, alwaysExists, &KeepDisabledValues{AppCode: "legacy-app"})
		require.NoError(t, err, "改选启用条目不受 keep 影响")
	})

	t.Run("disabled biz kept as history passes", func(t *testing.T) {
		in := validHostInput()
		in.BizCode = "legacy" // 停用业务条目，保留历史值
		err := ValidateResourceInput(models.ResourceCategoryHost, in, bizStore, nil, alwaysExists)
		require.Error(t, err)
		require.NoError(t, ValidateResourceInputForUpdate(models.ResourceCategoryHost, in, bizStore, nil, alwaysExists, &KeepDisabledValues{BizCode: "legacy"}))
	})
}

// ---------------------------------------------------------------------------
// M07 应用资源字段职责：health_check_url 是 blackbox 拨测地址且必填；
// endpoint + port 是 standard 指标采集地址，均可选。
// ---------------------------------------------------------------------------

func TestValidateApplication_AddressSplit(t *testing.T) {
	store := newBizStore(t)
	valid := func() *ResourceInput {
		return &ResourceInput{
			NetworkDomainID: "default",
			BizCode:         "payment",
			AppCode:         "pay-service",
			Cluster:         "pay",
			Status:          "online",
			Env:             "PRD",
			ServiceName:     "pay-service",
			HealthCheckURL:  "http://10.10.1.4:8081/actuator/health",
			Endpoint:        "10.10.1.4",
			Port:            8081,
			Protocol:        "http",
		}
	}

	t.Run("empty health_check_url fails", func(t *testing.T) {
		in := valid()
		in.HealthCheckURL = ""
		err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "health_check_url")
	})

	t.Run("invalid health_check_url keeps format error", func(t *testing.T) {
		for _, raw := range []string{"not-a-url", "ftp://10.10.1.4/health"} {
			in := valid()
			in.HealthCheckURL = raw
			err := ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "health_check_url", "非法 URL %q 仍按原格式错误返回", raw)
		}
	})

	t.Run("empty endpoint and zero port pass", func(t *testing.T) {
		in := valid()
		in.Endpoint = ""
		in.Port = 0
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryApplication, in, store, nil, alwaysExists))
	})

	t.Run("health_check_url participates in dedup key", func(t *testing.T) {
		in := valid()
		assert.Equal(t, "application|default|pay-service|http://10.10.1.4:8081/actuator/health", DedupKey(models.ResourceCategoryApplication, in))
	})
}

// ---------------------------------------------------------------------------
// 决策 110 硬校验单测（决策 118-5 强制门禁）----
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
		Env:             "PRD",
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
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs))
	})

	t.Run("不在应用关联平台集合 ⇒ bad_request", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-b") // 启用但未关联 app-a
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "不属于应用")
		assert.Contains(t, err.Error(), "app-a")
	})

	t.Run("引用停用平台 ⇒ bad_request（引导启用，不误报未登记）", func(t *testing.T) {
		in := platformTestInput("app-a", "old-platform") // 已登记但 enabled=false
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs)
		require.Error(t, err)
		// 原特征：断言合并文案「未登记或已停用」。现 platform_code 已用 Lookup 区分
		// 「已停用」与「未登记」，此处收敛为停用专属文案，且不含「未登记」字样。
		assert.Contains(t, err.Error(), "已停用")
		assert.Contains(t, err.Error(), "启用")
		assert.NotContains(t, err.Error(), "未登记")
	})

	t.Run("未登记平台 ⇒ bad_request（同时给出登记页与平台声明 sheet 双路径）", func(t *testing.T) {
		in := platformTestInput("app-a", "no-such-platform")
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs)
		require.Error(t, err)
		// 原特征：断言合并文案「未登记或已停用」。现未登记文案须与 biz/app/service
		// 同构给出双路径：去『平台管理』页登记，或在本文件『平台声明』sheet 声明。
		assert.Contains(t, err.Error(), "未登记")
		assert.Contains(t, err.Error(), "平台管理")
		assert.Contains(t, err.Error(), "平台声明")
	})

	t.Run("platform_code 留空 ⇒ 不校验（走应用主平台兜底）", func(t *testing.T) {
		in := platformTestInput("app-a", "")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs))
	})

	t.Run("应用无关联平台 ⇒ 跳过自洽（仅校验启用态）", func(t *testing.T) {
		in := platformTestInput("app-b", "platform-a") // app-b 无任何关联
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs),
			"应用无关联平台集合时不应做自洽比较（决策 110 自洽口径）")
	})

	t.Run("app_code 为空 ⇒ 跳过自洽（host 允许 app_code 留空）", func(t *testing.T) {
		// host 的 app_code 可空（§10A），是「无所属应用」的唯一合法载体；
		// database/middleware/application 的 app_code 必填，不适用于本分支。
		in := validHostInput()
		in.PlatformCode = "platform-a" // 启用平台，但无所属应用可比对
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryHost, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs))
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
			newBizStore(t), platformTestAppStore(t), alwaysExists, &KeepDisabledValues{PlatformCode: "old-platform"}, refs))
	})

	t.Run("保留与当前应用不关联的历史值 ⇒ 放行（解绑不强制改写）", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-c") // 启用但未关联 app-a
		require.NoError(t, ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, &KeepDisabledValues{PlatformCode: "platform-c"}, refs),
			"决策 111：应用解绑平台后，资源行既有 platform_code 不受解绑影响")
	})

	t.Run("改为新的不自洽值 ⇒ 仍拒绝", func(t *testing.T) {
		in := platformTestInput("app-a", "platform-c")
		err := ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, &KeepDisabledValues{PlatformCode: "old-platform"}, refs)
		require.Error(t, err, "keep 仅豁免同名历史值，改为新值仍须过自洽校验")
		assert.Contains(t, err.Error(), "不属于应用")
	})

	t.Run("改为新的停用平台 ⇒ 仍拒绝（引导启用）", func(t *testing.T) {
		in := platformTestInput("app-a", "old-platform")
		err := ValidateResourceInputWithPlatformForUpdate(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, &KeepDisabledValues{PlatformCode: "platform-a"}, refs)
		require.Error(t, err, "停用条目不可新选，keep 不豁免不同值")
		// 原特征：断言合并文案「未登记或已停用」。此场景为已登记但停用，收敛为
		// 停用专属文案。
		assert.Contains(t, err.Error(), "已停用")
		assert.Contains(t, err.Error(), "启用")
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
			newBizStore(t), platformTestAppStore(t), alwaysExists, nil),
			"refs 为 nil 时跳过平台校验，行为与旧 ValidateResourceInput 一致")
	})

	t.Run("PlatformStore == nil ⇒ 放行", func(t *testing.T) {
		refs := &PlatformRefs{AppPlatformStore: NewAppPlatformStore(openAppPlatformRelTestDB(t))}
		in := platformTestInput("app-a", "platform-totally-unknown")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs))
	})

	t.Run("AppPlatformStore == nil ⇒ 跳过自洽（启用态仍校验）", func(t *testing.T) {
		refs := &PlatformRefs{PlatformStore: NewPlatformDictStore(openAppPlatformRelTestDB(t))}
		// 自洽被跳过 ⇒ 即便不属于任何应用关联集合也放行。
		in := platformTestInput("app-a", "platform-a")
		require.NoError(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs))
		// 但启用态校验仍生效：停用平台依旧被拒。
		inDisabled := platformTestInput("app-a", "old-platform")
		err := ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, inDisabled,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs)
		require.Error(t, err)
		// 原特征：断言合并文案「未登记或已停用」。此场景为已登记但停用，收敛为
		// 停用专属文案。
		assert.Contains(t, err.Error(), "已停用")
	})

	t.Run("不带 keep 的创建态不受 keep 豁免影响", func(t *testing.T) {
		refs := platformTestRefs(t)
		_, err := refs.AppPlatformStore.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: true})
		require.NoError(t, err)
		in := platformTestInput("app-a", "platform-b")
		require.Error(t, ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase, in,
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs),
			"创建态（keep=nil）不做任何豁免")
	})
}

// TestValidatePlatformCode_GuidanceByRegistrationState 覆盖 platform_code 字典可达性
// 失败时的**引导文案**按登记状态分流（原实现把「未登记」与「已停用」合并为一句，
// 既是文案与能力不一致——文案未提后端事实上支持的「平台声明」sheet 通道——也会让
// 前端 isPendingRegistrationReason（仅匹配含「未登记」的文案）把停用态误高亮为
// 待登记）：
//   - 未登记 → 同时给出『平台管理』页登记路径与本文件『平台声明』sheet 声明路径；
//   - 已停用 → 只引导「启用」，且不含「未登记」字样；
//   - 已启用 → 通过；
//   - 已启用但不属于该 app_code 关联平台 → 仍走「不属于关联平台」文案（回归护栏：
//     自洽校验失败不得被误判为未登记）。
func TestValidatePlatformCode_GuidanceByRegistrationState(t *testing.T) {
	newRefs := func(t *testing.T) *PlatformRefs {
		t.Helper()
		refs := platformTestRefs(t)
		_, err := refs.AppPlatformStore.Create(models.AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: true})
		require.NoError(t, err)
		return refs
	}
	validate := func(t *testing.T, refs *PlatformRefs, appCode, platformCode string) error {
		t.Helper()
		return ValidateResourceInputWithPlatform(models.ResourceCategoryDatabase,
			platformTestInput(appCode, platformCode),
			newBizStore(t), platformTestAppStore(t), alwaysExists, refs)
	}

	t.Run("未登记 ⇒ 双路径引导（平台管理页 / 平台声明 sheet）", func(t *testing.T) {
		err := validate(t, newRefs(t), "app-a", "no-such-platform")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "平台 no-such-platform 未登记")
		assert.Contains(t, err.Error(), "『平台管理』页登记")
		assert.Contains(t, err.Error(), "『平台声明』sheet 补充后重新导入")
		// 保留旧模板提示（字典值以最新模板为准）。
		assert.Contains(t, err.Error(), "重新下载模板")
		// 停用引导不应出现在未登记分支。
		assert.NotContains(t, err.Error(), "已停用")
	})

	t.Run("已停用 ⇒ 引导启用，且不含未登记字样", func(t *testing.T) {
		err := validate(t, newRefs(t), "app-a", "old-platform")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "平台 old-platform 已停用")
		assert.Contains(t, err.Error(), "『平台管理』页启用后重新导入")
		// 前端 isPendingRegistrationReason 依「未登记」判定待登记，停用态不得命中。
		assert.NotContains(t, err.Error(), "未登记")
		assert.NotContains(t, err.Error(), "平台声明")
	})

	t.Run("已启用且属于应用关联平台 ⇒ 通过", func(t *testing.T) {
		require.NoError(t, validate(t, newRefs(t), "app-a", "platform-a"))
	})

	t.Run("已启用但不属于关联平台 ⇒ 仍走自洽文案（回归护栏）", func(t *testing.T) {
		err := validate(t, newRefs(t), "app-a", "platform-b")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "平台 platform-b 不属于应用 app-a 的关联平台")
		assert.NotContains(t, err.Error(), "未登记")
		assert.NotContains(t, err.Error(), "已停用")
	})
}

// ---------------------------------------------------------------------------
// T01-P1：实例级采集端口 scrape_port（提案 resource-scrape-port-chain §5.2/§5.3，
// M07 PRD §5.2 字段表：可选 int，0=未指定）
// ---------------------------------------------------------------------------

// scrapePortInput 构造某类型可通过校验的输入（scrape_port 留 0，由用例覆盖）。
func scrapePortInput(category models.ResourceCategory) *ResourceInput {
	switch category {
	case models.ResourceCategoryHost:
		return validHostInput()
	case models.ResourceCategoryDatabase:
		return &ResourceInput{
			NetworkDomainID: "default", BizCode: "payment", AppCode: "pay-db", Cluster: "pay",
			Status: "online", Env: "PRD", DatabaseType: "mysql", InstanceIP: "10.0.0.10", Port: 3306,
		}
	case models.ResourceCategoryMiddleware:
		return &ResourceInput{
			NetworkDomainID: "default", BizCode: "payment", AppCode: "pay-mq", Cluster: "pay",
			Status: "online", Env: "PRD", MiddlewareType: "kafka", InstanceIP: "10.0.0.11", Port: 9092,
		}
	case models.ResourceCategoryApplication:
		return &ResourceInput{
			NetworkDomainID: "default", BizCode: "payment", AppCode: "pay-service", Cluster: "pay",
			Status: "online", Env: "PRD", ServiceName: "pay-service",
			HealthCheckURL: "http://10.0.0.20:8080/health", Protocol: "http",
			Endpoint: "10.0.0.20", Port: 8080,
		}
	case models.ResourceCategoryGenericTarget:
		return &ResourceInput{
			NetworkDomainID: "default", BizCode: "infra", Status: "online", Env: "PRD",
			TargetName: "snmp-switch-01", InstanceIP: "10.0.0.30", Port: 161,
			Scheme: "http", MetricsPath: "/metrics",
		}
	case models.ResourceCategoryInterfaceService:
		return &ResourceInput{
			NetworkDomainID: "default", BizCode: "payment", AppCode: "pay-api",
			Status: "online", Env: "PRD",
			APIName: "health-check", APIURL: "https://api.example.com/health?token=x",
		}
	}
	return nil
}

// TestValidateResourceInput_ScrapePort 覆盖 validateScrapePort 口径（提案 §5.3 /
// 任务卡验收）：0（未指定）与正常端口合法；65536/-1 越界返回 bad_request 且错误
// 消息以 scrape_port 开头（供 excel.go 前缀映射回 §5.16.3 field），五类同口径。
func TestValidateResourceInput_ScrapePort(t *testing.T) {
	store := newBizStore(t)

	for _, category := range allCategories() {
		t.Run(string(category), func(t *testing.T) {
			t.Run("scrape_port 0（未指定）合法", func(t *testing.T) {
				in := scrapePortInput(category)
				in.ScrapePort = 0
				require.NoError(t, ValidateResourceInput(category, in, store, nil, alwaysExists))
			})
			t.Run("scrape_port 正常端口合法", func(t *testing.T) {
				in := scrapePortInput(category)
				in.ScrapePort = 9100
				require.NoError(t, ValidateResourceInput(category, in, store, nil, alwaysExists))
			})
			t.Run("scrape_port 65536 越界拒绝", func(t *testing.T) {
				in := scrapePortInput(category)
				in.ScrapePort = 65536
				err := ValidateResourceInput(category, in, store, nil, alwaysExists)
				require.Error(t, err)
				assert.Contains(t, err.Error(), "scrape_port")
			})
			t.Run("scrape_port -1 拒绝", func(t *testing.T) {
				in := scrapePortInput(category)
				in.ScrapePort = -1
				err := ValidateResourceInput(category, in, store, nil, alwaysExists)
				require.Error(t, err)
				assert.Contains(t, err.Error(), "scrape_port")
			})
		})
	}
}

// TestScrapePortAutoMigrateAddsColumn 验收「只加列不加新表」：五类资源模型
// AutoMigrate 后均含 scrape_port 列（存量库经 AutoMigrate 自动 ALTER ADD COLUMN
// default:0，无需手写迁移，db.go AutoMigrate 清单 / change_detect 白名单零改动）。
func TestScrapePortAutoMigrateAddsColumn(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.InterfaceService{},
	))
	for _, m := range []any{
		&models.Host{}, &models.Database{}, &models.Middleware{},
		&models.Application{}, &models.GenericTarget{}, &models.InterfaceService{},
	} {
		require.True(t, db.Migrator().HasColumn(m, "scrape_port"), "%T 应含 scrape_port 列", m)
	}
}

// TestGetResourceField_ScrapePort 断言五类模型的字段映射（LegacyFieldMap +
// GetResourceField）均支持 scrape_port——标签模板源字段与更新链路 current 值读取
// 依赖该映射（T01-P1 output：models/resource_fields.go）。
func TestGetResourceField_ScrapePort(t *testing.T) {
	modelsByCategory := map[models.ResourceCategory]any{
		models.ResourceCategoryHost:             &models.Host{},
		models.ResourceCategoryDatabase:         &models.Database{},
		models.ResourceCategoryMiddleware:       &models.Middleware{},
		models.ResourceCategoryApplication:      &models.Application{},
		models.ResourceCategoryGenericTarget:    &models.GenericTarget{},
		models.ResourceCategoryInterfaceService: &models.InterfaceService{},
	}
	for category, model := range modelsByCategory {
		m := LegacyFieldMap(category)
		require.Contains(t, m, "scrape_port", "%s LegacyFieldMap 应含 scrape_port", category)
		assert.Equal(t, "scrape_port", m["scrape_port"])

		v, ok := GetResourceField(model, "scrape_port")
		require.True(t, ok, "%s 应可读取 scrape_port", category)
		assert.Equal(t, "0", v, "缺省 0=未指定")
	}
}

// TestScrapePort_CreateUpdateListChannels 覆盖 create/update/list 三通道读写
// scrape_port（Excel 导入通道见 excel_test.go）与 0/NULL 等价：
//   - 创建写入 9100 → 响应带出；
//   - 列表读出 9100；
//   - 更新带值可写入；
//   - PUT 不带 scrape_port 字段与显式带 0 结果等价（Go 零值 0 = 未指定），
//     且不误清其他列（instance_name / env 等仍按请求体落库）。
func TestScrapePort_CreateUpdateListChannels(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)
	r.GET("/api/v2/platform/resources", ListResources(db))

	// 1. 创建通道：写入 scrape_port=9100，创建响应带出。
	createBody := hostBody()
	createBody["scrape_port"] = 9100
	w, out := doCreate(t, r, createBody)
	require.Equal(t, http.StatusOK, w.Code, out.Error)
	require.Equal(t, "success", out.Status)
	assert.Equal(t, float64(9100), out.Data["scrape_port"], "创建响应应带出 scrape_port")
	idA, _ := out.Data["resource_id"].(string)
	require.NotEmpty(t, idA)
	assert.Equal(t, 9100, loadHostByResourceID(t, db, idA).ScrapePort)

	// 2. 列表通道：GET 列表读出 scrape_port。
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/resources?resource_category=host", nil)
	wList := httptest.NewRecorder()
	r.ServeHTTP(wList, req)
	require.Equal(t, http.StatusOK, wList.Code)
	var listOut struct {
		Status string `json:"status"`
		Data   struct {
			List []map[string]interface{} `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(wList.Body.Bytes(), &listOut))
	require.Len(t, listOut.Data.List, 1)
	assert.Equal(t, float64(9100), listOut.Data.List[0]["scrape_port"], "列表应读出 scrape_port")

	// 3. 更新通道：带值改写 19100。
	updVal := hostBody()
	updVal["scrape_port"] = 19100
	wUpd, outUpd := doUpdate(t, r, idA, updVal)
	require.Equal(t, http.StatusOK, wUpd.Code, outUpd.Error)
	assert.Equal(t, float64(19100), outUpd.Data["scrape_port"])
	assert.Equal(t, 19100, loadHostByResourceID(t, db, idA).ScrapePort)

	// 4. 0/NULL 等价：资源 B（PUT 不带字段）与资源 C（PUT 显式 0）结果一致，
	//    且其他列不被误清。
	_, outB := doCreate(t, r, hostBody())
	idB, _ := outB.Data["resource_id"].(string)
	wB, updB := doUpdate(t, r, idB, hostBody()) // 不含 scrape_port 键
	require.Equal(t, http.StatusOK, wB.Code, updB.Error)
	assert.Equal(t, float64(0), updB.Data["scrape_port"], "不带字段 ⇒ 0（未指定）")

	_, outC := doCreate(t, r, hostBody())
	idC, _ := outC.Data["resource_id"].(string)
	zeroBody := hostBody()
	zeroBody["scrape_port"] = 0
	wC, outC2 := doUpdate(t, r, idC, zeroBody)
	require.Equal(t, http.StatusOK, wC.Code, outC2.Error)
	assert.Equal(t, float64(0), outC2.Data["scrape_port"], "显式 0 ⇒ 0（未指定）")

	hB := loadHostByResourceID(t, db, idB)
	hC := loadHostByResourceID(t, db, idC)
	assert.Equal(t, hB.ScrapePort, hC.ScrapePort, "不带字段与带 0 结果等价")
	assert.Equal(t, 0, hB.ScrapePort)
	assert.Equal(t, 0, hC.ScrapePort)
	// 不误清其他列（PUT 全量替换语义下请求体字段仍落库）。
	assert.Equal(t, "web-01", hB.InstanceName)
	assert.Equal(t, "web-01", hC.InstanceName)
	assert.Equal(t, "PRD", hB.EnvFlag)
	assert.Equal(t, "PRD", hC.EnvFlag)
	assert.Equal(t, "Linux", hB.Image)
	assert.Equal(t, "Linux", hC.Image)
}
