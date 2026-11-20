package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// newTemplate returns a minimal valid recipe so each case can mutate one axis.
func newTemplate() domain.CollectionTemplate {
	return domain.CollectionTemplate{
		Code:             "host_dpu",
		Name:             "DPU 主机采集",
		ResourceCategory: domain.CategoryHost,
		MetricsPath:      "/metrics",
		Scheme:           domain.SchemeHTTP,
		ScrapeInterval:   "15s",
		ScrapeTimeout:    "10s",
		DefaultSelector: domain.Selector{
			Logic:   domain.RuleLogicAll,
			Filters: []domain.ScopeFilter{{Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}}},
		},
		Enabled: true,
	}
}

// The template catalogue replaces the removed per-category monitor-type list:
// the category of every built-in recipe is authoritative.
func TestBuiltinCollectionTemplatesByCategory(t *testing.T) {
	cases := []struct {
		name     string
		category domain.ResourceCategory
		want     []string
	}{
		{"host", domain.CategoryHost, []string{domain.TemplateHostLinux, domain.TemplateHostWindows, domain.TemplateHostNPU}},
		{"database", domain.CategoryDatabase, []string{domain.TemplateMySQL, domain.TemplateRedis}},
		{"middleware", domain.CategoryMiddleware, []string{domain.TemplateKafka, domain.TemplateElasticsearch, domain.TemplateNginx}},
		{"application", domain.CategoryApplication, []string{domain.TemplateApplicationHTTP}},
		{"generic target", domain.CategoryGenericTarget, []string{domain.TemplateSNMP}},
		{"interface service has no collection template", domain.CategoryInterfaceService, nil},
		{"empty category", "", nil},
		{"unknown category", "unknown", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got []string
			for _, template := range domain.BuiltinCollectionTemplates() {
				if template.ResourceCategory == tc.category {
					got = append(got, template.Code)
				}
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

// Every seeded recipe must pass the same shape validation a user-defined one
// goes through, otherwise the seed could persist unusable rows.
func TestBuiltinCollectionTemplatesAreValidRecipes(t *testing.T) {
	seen := map[string]struct{}{}
	for _, template := range domain.BuiltinCollectionTemplates() {
		_, duplicate := seen[template.Code]
		assert.False(t, duplicate, "duplicate template code %q", template.Code)
		seen[template.Code] = struct{}{}

		assert.True(t, template.IsBuiltin, template.Code)
		assert.NotEmpty(t, template.Name, template.Code)
		assert.True(t, template.ResourceCategory.Valid(), template.Code)
		require.NoError(t, domain.ValidateCollectionTemplate(template), template.Code)
	}
	assert.Len(t, seen, 10, "the v3 catalogue ships ten built-in recipes")
}

// NPU is a hardware capability, not an operating system: the host_npu recipe
// must stay orthogonal to host_linux / host_windows (SRS Module_01 FR-10/FR-23).
func TestBuiltinHostTemplatesAreOrthogonal(t *testing.T) {
	linux, ok := domain.BuiltinCollectionTemplate(domain.TemplateHostLinux)
	require.True(t, ok)
	require.Len(t, linux.DefaultSelector.Filters, 1)
	assert.Equal(t, "os_family", linux.DefaultSelector.Filters[0].Field)

	npu, ok := domain.BuiltinCollectionTemplate(domain.TemplateHostNPU)
	require.True(t, ok)
	require.Len(t, npu.DefaultSelector.Filters, 1)
	assert.Equal(t, "has_npu", npu.DefaultSelector.Filters[0].Field,
		"NPU must be selected by a hardware capability, not by the OS family")
	assert.Equal(t, domain.CategoryHost, npu.ResourceCategory)

	// A recipe carries no scope of its own beyond the wizard prefill; the
	// selector is what the job stores.
	assert.True(t, linux.DefaultSelector.Normalize().Logic == domain.RuleLogicAll)
}

func TestValidateCollectionTemplate(t *testing.T) {
	valid := newTemplate()
	require.NoError(t, domain.ValidateCollectionTemplate(valid))

	cases := []struct {
		name    string
		mutate  func(*domain.CollectionTemplate)
		message string
	}{
		{"empty code", func(t *domain.CollectionTemplate) { t.Code = "" }, "code"},
		{"uppercase code", func(t *domain.CollectionTemplate) { t.Code = "Host_DPU" }, "code"},
		{"empty name", func(t *domain.CollectionTemplate) { t.Name = "   " }, "name"},
		{"unknown category", func(t *domain.CollectionTemplate) { t.ResourceCategory = "unknown" }, "resource_category"},
		{"bad port", func(t *domain.CollectionTemplate) { t.DefaultPort = 70000 }, "port"},
		{"empty metrics path", func(t *domain.CollectionTemplate) { t.MetricsPath = "" }, "metrics_path"},
		{"relative metrics path", func(t *domain.CollectionTemplate) { t.MetricsPath = "metrics" }, "metrics_path"},
		{"bad scheme", func(t *domain.CollectionTemplate) { t.Scheme = "ftp" }, "scheme"},
		{"bad interval", func(t *domain.CollectionTemplate) { t.ScrapeInterval = "180" }, "scrape_interval"},
		{"timeout longer than interval", func(t *domain.CollectionTemplate) { t.ScrapeTimeout = "30s" }, "scrape_timeout"},
		{"illegal default selector", func(t *domain.CollectionTemplate) {
			t.DefaultSelector = domain.Selector{Filters: []domain.ScopeFilter{
				{Field: "1=1 OR r.status", Operator: domain.RuleOpEq, Values: []string{"online"}},
			}}
		}, "unknown filter field"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := valid
			tc.mutate(&candidate)
			err := domain.ValidateCollectionTemplate(candidate)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.message)
		})
	}
}

func TestNormalizeCollectionTemplate(t *testing.T) {
	template := domain.CollectionTemplate{
		Code:             "  host_dpu  ",
		Name:             "  DPU 主机  ",
		ResourceCategory: domain.CategoryHost,
		Description:      "  说明  ",
		DefaultSelector: domain.Selector{Filters: []domain.ScopeFilter{
			{Field: "  has_gpu  ", Values: []string{"  true  ", "   "}},
		}},
	}
	domain.NormalizeCollectionTemplate(&template)

	assert.Equal(t, "host_dpu", template.Code)
	assert.Equal(t, "DPU 主机", template.Name)
	assert.Equal(t, "说明", template.Description)
	assert.Equal(t, domain.DefaultMetricsPath, template.MetricsPath)
	assert.Equal(t, domain.SchemeHTTP, template.Scheme)
	assert.Equal(t, domain.DefaultScrapeInterval, template.ScrapeInterval)
	assert.Equal(t, domain.DefaultScrapeTimeout, template.ScrapeTimeout)
	assert.Equal(t, 500, template.SortOrder)
	require.Len(t, template.DefaultSelector.Filters, 1)
	assert.Equal(t, "has_gpu", template.DefaultSelector.Filters[0].Field)
	assert.Equal(t, domain.RuleLogicAll, template.DefaultSelector.Logic, "logic defaults to all")
	assert.Equal(t, domain.RuleOpEq, template.DefaultSelector.Filters[0].Operator, "operator defaults to eq")
	assert.Equal(t, []string{"true"}, template.DefaultSelector.Filters[0].Values, "blank values are dropped")
}

func TestValidateSelectorRejectsUnknownField(t *testing.T) {
	selector := domain.Selector{Filters: []domain.ScopeFilter{{
		Field: "select * from resources", Operator: domain.RuleOpEq, Values: []string{"x"},
	}}}
	err := domain.ValidateSelector(selector, domain.CategoryHost)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown filter field", "fields must come from the dictionary")
}

func TestValidateSelectorRejectsFieldOutsideCategory(t *testing.T) {
	selector := domain.Selector{Filters: []domain.ScopeFilter{{
		Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"},
	}}}
	err := domain.ValidateSelector(selector, domain.CategoryDatabase)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not apply to resource category")
}

func TestValidateSelectorRejectsBooleanArbitraryValue(t *testing.T) {
	selector := domain.Selector{Filters: []domain.ScopeFilter{{
		Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"yes"},
	}}}
	err := domain.ValidateSelector(selector, domain.CategoryHost)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "takes true or false")
}

func TestValidateSelectorRejectsContainsOnBoolean(t *testing.T) {
	selector := domain.Selector{Filters: []domain.ScopeFilter{{
		Field: "has_npu", Operator: domain.RuleOpContains, Values: []string{"tru"},
	}}}
	err := domain.ValidateSelector(selector, domain.CategoryHost)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by field")
}

func TestValidateSelectorValueArity(t *testing.T) {
	cases := []struct {
		name     string
		filter   domain.ScopeFilter
		message  string
		category domain.ResourceCategory
	}{
		{"eq takes one value", domain.ScopeFilter{Field: "os_type", Operator: domain.RuleOpEq, Values: []string{"a", "b"}}, "takes exactly one value", domain.CategoryHost},
		{"contains takes one value", domain.ScopeFilter{Field: "hostname", Operator: domain.RuleOpContains, Values: []string{"a", "b"}}, "takes exactly one value", domain.CategoryHost},
		{"always forbids values", domain.ScopeFilter{Field: "os_type", Operator: domain.RuleOpAlways, Values: []string{"a"}}, "must be empty when operator is always", domain.CategoryHost},
		{"values are required", domain.ScopeFilter{Field: "os_type", Operator: domain.RuleOpEq}, "is required", domain.CategoryHost},
		{"invalid regexp", domain.ScopeFilter{Field: "hostname", Operator: domain.RuleOpRegexp, Values: []string{"["}}, "invalid regular expression", domain.CategoryHost},
		{"unknown operator", domain.ScopeFilter{Field: "os_type", Operator: "like", Values: []string{"a"}}, "unknown operator", domain.CategoryHost},
		{"os_family only knows linux/windows", domain.ScopeFilter{Field: "os_family", Operator: domain.RuleOpEq, Values: []string{"solaris"}}, "takes linux or windows", domain.CategoryHost},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := domain.ValidateSelector(domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{tc.filter}}, tc.category)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.message)
		})
	}
}

func TestValidateSelectorAcceptsSupportedShapes(t *testing.T) {
	cases := []struct {
		name     string
		selector domain.Selector
		category domain.ResourceCategory
	}{
		{"empty selector means the whole category", domain.Selector{}, domain.CategoryHost},
		{"always matches the whole category", domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{{Field: "os_family", Operator: domain.RuleOpAlways}}}, domain.CategoryHost},
		{"in takes many values", domain.Selector{Filters: []domain.ScopeFilter{{Field: "os_type", Operator: domain.RuleOpIn, Values: []string{"Ubuntu", "CentOS"}}}}, domain.CategoryHost},
		{"contains_any takes many values", domain.Selector{Filters: []domain.ScopeFilter{{Field: "hostname", Operator: domain.RuleOpContainsAny, Values: []string{"web", "db"}}}}, domain.CategoryHost},
		{"any logic", domain.Selector{Logic: domain.RuleLogicAny, Filters: []domain.ScopeFilter{{Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}}, {Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}}}}, domain.CategoryHost},
		{"regexp on a text field", domain.Selector{Filters: []domain.ScopeFilter{{Field: "hostname", Operator: domain.RuleOpRegexp, Values: []string{"^web-"}}}}, domain.CategoryHost},
		{"database type", domain.Selector{Filters: []domain.ScopeFilter{{Field: "database_type", Operator: domain.RuleOpEq, Values: []string{"mysql"}}}}, domain.CategoryDatabase},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.NoError(t, domain.ValidateSelector(tc.selector, tc.category))
		})
	}
}

func TestValidateSelectorRejectsUnknownLogic(t *testing.T) {
	err := domain.ValidateSelector(domain.Selector{Logic: "xor"}, domain.CategoryHost)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must be all or any")
}

// M07 custom fields are matched by key against its attribute dictionary, so a
// new custom field becomes selectable without an M01 release (NFR-11).
func TestValidateSelectorAcceptsRegisteredCustomFields(t *testing.T) {
	selector := domain.Selector{Filters: []domain.ScopeFilter{{
		Field: "asset_no", Operator: domain.RuleOpEq, Values: []string{"A-1"},
	}}}

	require.Error(t, domain.ValidateSelector(selector, domain.CategoryHost),
		"without a custom-field resolver the key is unknown")

	isCustom := func(key string) bool { return key == "asset_no" }
	require.NoError(t, domain.ValidateSelectorWith(selector, domain.CategoryHost, isCustom))

	// A custom field is still text-like: eq takes exactly one value.
	err := domain.ValidateSelectorWith(domain.Selector{Filters: []domain.ScopeFilter{{
		Field: "asset_no", Operator: domain.RuleOpEq, Values: []string{"A-1", "A-2"},
	}}}, domain.CategoryHost, isCustom)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "takes exactly one value")
}

// The field dictionary must expose the capability flags the retired scope field
// registry used to own, and must never leak physical column names.
func TestFieldDictionaryCoversCapabilities(t *testing.T) {
	keys := domain.AllowedFieldKeys()
	assert.Contains(t, keys, "has_npu")
	assert.Contains(t, keys, "has_gpu")
	assert.Contains(t, keys, "os_family")

	spec, ok := domain.FieldSpecFor("has_npu")
	require.True(t, ok)
	assert.Equal(t, domain.FieldKindBoolean, spec.Kind)
	assert.Equal(t, "h.has_npu", spec.Column)
	assert.True(t, spec.AppliesTo(domain.CategoryHost))
	assert.False(t, spec.AppliesTo(domain.CategoryDatabase))

	osFamily, ok := domain.FieldSpecFor("os_family")
	require.True(t, ok)
	assert.Equal(t, domain.FieldKindOSFamily, osFamily.Kind)
	assert.Empty(t, osFamily.Column, "virtual fields are expanded by the reader, never spliced in")

	_, ok = domain.FieldSpecFor("h.has_npu")
	assert.False(t, ok, "physical column names must never be accepted as selector fields")

	// FieldSpecs returns a copy: callers cannot mutate the dictionary.
	specs := domain.FieldSpecs()
	require.NotEmpty(t, specs)
	specs[0].Key = "tampered"
	assert.NotEqual(t, "tampered", domain.AllowedFieldKeys()[0])
}
