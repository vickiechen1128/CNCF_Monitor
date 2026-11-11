package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validResource(category Category, attrs Attributes) *Resource {
	r := &Resource{
		ResourceID:      "res-1",
		Category:        category,
		TenantID:        "platform_admin",
		NetworkDomainID: "mc-demo",
		Env:             EnvPRD,
		Status:          StatusOnline,
		SourceType:      SourceManual,
		Attributes:      attrs,
	}
	switch category {
	case CategoryApplication, CategoryDatabase, CategoryMiddleware:
		r.AppCode = "order-service"
		r.Cluster = "prod-a"
	case CategoryInterfaceService:
		r.AppCode = "order-service"
		r.BizCode = "payment"
	case CategoryGenericTarget:
		r.AppCode = "order-service"
	}
	return r
}

func TestDedupKey(t *testing.T) {
	tests := []struct {
		name string
		r    *Resource
		want string
	}{
		{
			name: "host",
			r: validResource(CategoryHost, HostAttributes{
				Hostname: "web-01", InstanceIP: "10.0.0.1", OSType: "linux",
			}),
			want: "host|mc-demo|10.0.0.1",
		},
		{
			name: "database",
			r: validResource(CategoryDatabase, DatabaseAttributes{
				DatabaseType: "mysql", InstanceIP: "10.0.0.2", Port: 3306,
			}),
			want: "database|mc-demo|10.0.0.2|3306",
		},
		{
			name: "middleware",
			r: validResource(CategoryMiddleware, MiddlewareAttributes{
				MiddlewareType: "kafka", InstanceIP: "10.0.0.3", Port: 9092,
			}),
			want: "middleware|mc-demo|10.0.0.3|9092",
		},
		{
			name: "application",
			r: validResource(CategoryApplication, ApplicationAttributes{
				ServiceName: "order-api", HealthCheckURL: "https://order.example.com/health",
			}),
			want: "application|mc-demo|order-api|https://order.example.com/health",
		},
		{
			name: "generic_target",
			r: validResource(CategoryGenericTarget, GenericTargetAttributes{
				TargetName: "switch", InstanceIP: "10.0.0.4", Port: 161,
			}),
			want: "generic_target|mc-demo|10.0.0.4|161",
		},
		{
			name: "interface_service",
			r: validResource(CategoryInterfaceService, InterfaceServiceAttributes{
				APIName: "orders", APIURL: "https://api.example.com/orders",
			}),
			want: "interface_service|mc-demo|https://api.example.com/orders",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DedupKey(tt.r)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestResourceValidate(t *testing.T) {
	t.Run("valid host", func(t *testing.T) {
		r := validResource(CategoryHost, HostAttributes{
			Hostname: "web-01", InstanceIP: "10.0.0.1", OSType: "linux",
		})
		require.NoError(t, r.Validate())
		require.NoError(t, r.EnsureDedupKey())
		assert.Equal(t, "host|mc-demo|10.0.0.1", r.DedupKey)
	})

	t.Run("application requires app and cluster", func(t *testing.T) {
		r := validResource(CategoryApplication, ApplicationAttributes{
			ServiceName: "order-api", HealthCheckURL: "https://order.example.com/health",
		})
		r.AppCode = ""
		require.ErrorContains(t, r.Validate(), "app_code")
		r.AppCode = "order-service"
		r.Cluster = ""
		require.ErrorContains(t, r.Validate(), "cluster")
	})

	t.Run("generic_target requires app or biz", func(t *testing.T) {
		r := validResource(CategoryGenericTarget, GenericTargetAttributes{
			TargetName: "switch", InstanceIP: "10.0.0.4", Port: 161,
		})
		r.AppCode = ""
		require.ErrorContains(t, r.Validate(), "app_code or biz_code")
	})

	t.Run("category mismatch", func(t *testing.T) {
		r := validResource(CategoryHost, DatabaseAttributes{
			DatabaseType: "mysql", InstanceIP: "10.0.0.2", Port: 3306,
		})
		require.ErrorContains(t, r.Validate(), "category mismatch")
	})

	t.Run("invalid attributes", func(t *testing.T) {
		r := validResource(CategoryHost, HostAttributes{Hostname: "web-01", OSType: "linux"})
		require.ErrorContains(t, r.Validate(), "instance_ip")
	})
}

func TestParseCategory(t *testing.T) {
	got, err := ParseCategory(" host ")
	require.NoError(t, err)
	assert.Equal(t, CategoryHost, got)

	_, err = ParseCategory("unknown")
	require.ErrorContains(t, err, "invalid resource_category")
}

func TestNewResourceID(t *testing.T) {
	id, err := NewResourceID()
	require.NoError(t, err)
	assert.Len(t, id, 36)
	assert.NotEqual(t, id, mustID(t))
}

func mustID(t *testing.T) string {
	t.Helper()
	id, err := NewResourceID()
	require.NoError(t, err)
	return id
}
