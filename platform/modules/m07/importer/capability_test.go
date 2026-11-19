package importer

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// A header written by the previous template (no capability columns) must keep
// importing: new columns are trailing and optional (FR-30/31 backward compat).
func TestParseExcelAcceptsLegacyHostHeader(t *testing.T) {
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at"},
		{"mc-demo", "web-01", "web-01", "10.0.0.1", "Ubuntu", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, ""},
	}
	parsed, err := ParseExcel(buildXLSX(t, "Sheet1", rows), domain.CategoryHost)
	require.NoError(t, err)
	require.Len(t, parsed, 1)

	valid, errs := ValidateRows(parsed)
	require.Empty(t, errs)
	require.Len(t, valid, 1)
	host, ok := valid[0].Resource.Attributes.(domain.HostAttributes)
	require.True(t, ok)
	assert.False(t, host.HasNPU, "absent capability column means false, never inferred")
	assert.False(t, host.HasGPU)
	assert.Empty(t, valid[0].Attributes)
}

// The capability columns drive the host attributes, and the attributes column
// is parsed into key/value pairs for the importer service to validate.
func TestParseExcelCarriesCapabilityColumns(t *testing.T) {
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at", "has_npu", "has_gpu", "attributes"},
		{"mc-demo", "npu-01", "npu-01", "10.0.0.9", "Ubuntu", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, "", "是", "否", "dpu_model=BlueField-3; smart_nic=mellanox"},
		{"mc-demo", "plain-01", "plain-01", "10.0.0.10", "CentOS", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, "", "false", "true", ""},
	}
	parsed, err := ParseExcel(buildXLSX(t, "Sheet1", rows), domain.CategoryHost)
	require.NoError(t, err)
	require.Len(t, parsed, 2)

	valid, errs := ValidateRows(parsed)
	require.Empty(t, errs)
	require.Len(t, valid, 2)

	npuHost, ok := valid[0].Resource.Attributes.(domain.HostAttributes)
	require.True(t, ok)
	assert.True(t, npuHost.HasNPU)
	assert.False(t, npuHost.HasGPU)
	assert.Equal(t, map[string]string{"dpu_model": "BlueField-3", "smart_nic": "mellanox"}, valid[0].Attributes)

	gpuHost, ok := valid[1].Resource.Attributes.(domain.HostAttributes)
	require.True(t, ok)
	assert.False(t, gpuHost.HasNPU)
	assert.True(t, gpuHost.HasGPU)
	assert.Empty(t, valid[1].Attributes)
}

func TestParseExcelRejectsIllegalBoolean(t *testing.T) {
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at", "has_npu"},
		{"mc-demo", "npu-01", "npu-01", "10.0.0.9", "Ubuntu", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, "", "maybe"},
	}
	parsed, err := ParseExcel(buildXLSX(t, "Sheet1", rows), domain.CategoryHost)
	require.NoError(t, err)

	valid, errs := ValidateRows(parsed)
	require.Empty(t, valid)
	require.Len(t, errs, 1)
	assert.Equal(t, "has_npu", errs[0].Field)
}

func TestParseExcelRejectsMalformedAttributes(t *testing.T) {
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at", "attributes"},
		{"mc-demo", "npu-01", "npu-01", "10.0.0.9", "Ubuntu", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, "", "dpu_model"},
	}
	parsed, err := ParseExcel(buildXLSX(t, "Sheet1", rows), domain.CategoryHost)
	require.NoError(t, err)

	valid, errs := ValidateRows(parsed)
	require.Empty(t, valid)
	require.Len(t, errs, 1)
	assert.Equal(t, "attributes", errs[0].Field)
}
