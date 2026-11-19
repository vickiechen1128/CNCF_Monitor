package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

func TestValidateMonitorTypeEntryAcceptsCapabilityRule(t *testing.T) {
	definition := domain.MonitorTypeDefinition{
		Code:             "host_npu_probe",
		Name:             "NPU 主机（自定义）",
		ResourceCategory: domain.CategoryHost,
		RuleLogic:        domain.RuleLogicAll,
		Enabled:          true,
	}
	rules := []domain.MonitorTypeRule{{
		Field:    "has_npu",
		Operator: domain.RuleOpEq,
		Values:   []string{"true"},
	}}
	require.NoError(t, domain.ValidateMonitorTypeEntry(definition, rules))
}

func TestValidateMonitorTypeEntryRejectsUnknownField(t *testing.T) {
	definition := domain.MonitorTypeDefinition{
		Code:             "host_custom",
		Name:             "自定义主机",
		ResourceCategory: domain.CategoryHost,
	}
	rules := []domain.MonitorTypeRule{{
		Field:    "select * from resources",
		Operator: domain.RuleOpEq,
		Values:   []string{"x"},
	}}
	err := domain.ValidateMonitorTypeEntry(definition, rules)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown scope field", "rule fields must come from the whitelist")
}

func TestValidateMonitorTypeEntryRejectsFieldOutsideCategory(t *testing.T) {
	definition := domain.MonitorTypeDefinition{
		Code:             "mysql_custom",
		Name:             "MySQL 自定义",
		ResourceCategory: domain.CategoryDatabase,
	}
	rules := []domain.MonitorTypeRule{{
		Field:    "has_npu",
		Operator: domain.RuleOpEq,
		Values:   []string{"true"},
	}}
	err := domain.ValidateMonitorTypeEntry(definition, rules)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not apply to resource category")
}

func TestValidateMonitorTypeEntryRequiresRules(t *testing.T) {
	definition := domain.MonitorTypeDefinition{
		Code:             "host_empty",
		Name:             "空规则",
		ResourceCategory: domain.CategoryHost,
	}
	err := domain.ValidateMonitorTypeEntry(definition, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "at least one derivation rule")
}

func TestValidateMonitorTypeRuleRejectsBooleanArbitraryValue(t *testing.T) {
	definition := domain.MonitorTypeDefinition{
		Code:             "host_bad_bool",
		Name:             "坏布尔",
		ResourceCategory: domain.CategoryHost,
	}
	rules := []domain.MonitorTypeRule{{
		Field:    "has_gpu",
		Operator: domain.RuleOpEq,
		Values:   []string{"yes"},
	}}
	err := domain.ValidateMonitorTypeEntry(definition, rules)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "takes true or false")
}

func TestValidateMonitorTypeRuleRejectsContainsOnBoolean(t *testing.T) {
	definition := domain.MonitorTypeDefinition{
		Code:             "host_bool_contains",
		Name:             "布尔包含",
		ResourceCategory: domain.CategoryHost,
	}
	rules := []domain.MonitorTypeRule{{
		Field:    "has_npu",
		Operator: domain.RuleOpContains,
		Values:   []string{"tru"},
	}}
	err := domain.ValidateMonitorTypeEntry(definition, rules)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by field")
}

func TestMonitorTypeRegistryScopeCompilesRules(t *testing.T) {
	registry := domain.NewMonitorTypeRegistry([]domain.MonitorTypeEntry{{
		Definition: domain.MonitorTypeDefinition{
			Code:             "host_npu_custom",
			Name:             "NPU 主机",
			ResourceCategory: domain.CategoryHost,
			RuleLogic:        domain.RuleLogicAny,
			Enabled:          true,
		},
		Rules: []domain.MonitorTypeRule{
			{ID: "r2", Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}, Priority: 20},
			{ID: "r1", Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}, Priority: 10},
		},
	}})

	scope, ok := registry.Scope("host_npu_custom")
	require.True(t, ok)
	assert.Equal(t, domain.CategoryHost, scope.Category)
	assert.Equal(t, domain.RuleLogicAny, scope.Logic)
	require.Len(t, scope.Filters, 2)
	assert.Equal(t, "has_gpu", scope.Filters[0].Field, "filters are ordered by priority")
	assert.Equal(t, "has_npu", scope.Filters[1].Field)
}

func TestMonitorTypeRegistryDisabledTypeIsNotValid(t *testing.T) {
	registry := domain.NewMonitorTypeRegistry([]domain.MonitorTypeEntry{{
		Definition: domain.MonitorTypeDefinition{
			Code: "host_disabled", Name: "停用", ResourceCategory: domain.CategoryHost,
			Enabled: false,
		},
		Rules: []domain.MonitorTypeRule{{Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}}},
	}})
	assert.False(t, registry.Valid("host_disabled"))
	_, ok := registry.Scope("host_disabled")
	assert.False(t, ok)
}

func TestBuiltinHostTypesAreOrthogonal(t *testing.T) {
	registry := domain.ActiveMonitorTypeRegistry()
	linux, ok := registry.Get(domain.MonitorTypeHostLinux)
	require.True(t, ok)
	require.Len(t, linux.Rules, 1)
	assert.Equal(t, "os_family", linux.Rules[0].Field)

	npu, ok := registry.Get(domain.MonitorTypeHostNPU)
	require.True(t, ok)
	require.Len(t, npu.Rules, 1)
	assert.Equal(t, "has_npu", npu.Rules[0].Field,
		"NPU must be derived from a hardware capability, not from the OS family")

	assert.Equal(t, domain.CategoryHost, npu.Definition.ResourceCategory)
}

func TestScopeFieldWhitelistCoversCapabilities(t *testing.T) {
	keys := domain.AllowedScopeFieldKeys()
	assert.Contains(t, keys, "has_npu")
	assert.Contains(t, keys, "has_gpu")
	assert.Contains(t, keys, "os_family")

	spec, ok := domain.ScopeFieldSpecFor("has_npu")
	require.True(t, ok)
	assert.Equal(t, domain.ScopeFieldBoolean, spec.Kind)
	assert.True(t, spec.AppliesTo(domain.CategoryHost))
	assert.False(t, spec.AppliesTo(domain.CategoryDatabase))

	_, ok = domain.ScopeFieldSpecFor("h.has_npu")
	assert.False(t, ok, "physical column names must never be accepted as rule fields")
}

// Pre-v1.3 data and clients used the bare code "npu"; the registry resolves the
// legacy alias so an old row (or an old client) cannot lose its monitor type.
func TestLegacyNPUCodeResolvesToHostNPU(t *testing.T) {
	assert.Equal(t, domain.MonitorTypeHostNPU, domain.NormalizeMonitorTypeCode("npu"))
	assert.Equal(t, domain.MonitorTypeHostNPU, domain.NormalizeMonitorTypeCode(" npu "))
	assert.Equal(t, domain.MonitorTypeMySQL, domain.NormalizeMonitorTypeCode("mysql"))

	assert.True(t, domain.ValidMonitorType("npu"), "legacy code stays accepted")
	category, ok := domain.CategoryForMonitorType("npu")
	require.True(t, ok)
	assert.Equal(t, domain.CategoryHost, category)

	scope, ok := domain.MonitorTypeScopeFor("npu")
	require.True(t, ok)
	assert.Equal(t, domain.MonitorTypeHostNPU, scope.Code, "scope resolves to the current code")
}
