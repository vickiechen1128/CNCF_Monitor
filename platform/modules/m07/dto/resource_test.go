package dto

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateResourceRequestToDomain(t *testing.T) {
	raw := `{
		"resource_category":"host",
		"network_domain_id":"default",
		"env":"PRD",
		"status":"online",
		"attributes":{"hostname":"web-01","instance_ip":"10.0.0.1","os_type":"linux"}
	}`
	var req CreateResourceRequest
	require.NoError(t, json.Unmarshal([]byte(raw), &req))
	resource, err := req.ToDomain()
	require.NoError(t, err)
	assert.Equal(t, domain.CategoryHost, resource.Category)
	assert.Equal(t, domain.EnvPRD, resource.Env)
	attrs, ok := resource.Attributes.(domain.HostAttributes)
	require.True(t, ok)
	assert.Equal(t, "web-01", attrs.Hostname)
}

func TestDecodeAttributesRejectsUnknownCategory(t *testing.T) {
	_, err := DecodeAttributes(domain.Category("unknown"), json.RawMessage(`{}`))
	require.Error(t, err)
}

func TestFromDomainMapsAttributes(t *testing.T) {
	resource := &domain.Resource{
		ResourceID:      "app-1",
		Category:        domain.CategoryApplication,
		TenantID:        "platform_admin",
		NetworkDomainID: "default",
		AppCode:         "order-service",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Status:          domain.StatusOnline,
		SourceType:      domain.SourceManual,
		Attributes: domain.ApplicationAttributes{
			ServiceName:    "order-api",
			HealthCheckURL: "https://order.example.com/health",
			Port:           8080,
		},
	}
	resp := FromDomain(resource)
	assert.Equal(t, "app-1", resp.ResourceID)
	attrs, ok := resp.Attributes.(ApplicationAttributes)
	require.True(t, ok)
	assert.Equal(t, "order-api", attrs.ServiceName)
	assert.Equal(t, 8080, attrs.Port)
}
