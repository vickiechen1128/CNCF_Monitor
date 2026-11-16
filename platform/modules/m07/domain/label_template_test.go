package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validTemplate() *LabelTemplate {
	return &LabelTemplate{
		Name:             "host-default",
		ResourceCategory: CategoryHost,
		Mappings: []LabelMapping{
			{SourceField: "instance_ip:port", SourceType: LabelMappingSourceComposite, TargetLabel: "instance", Enabled: true},
			{SourceField: "resource_id", SourceType: LabelMappingSourceResourceField, TargetLabel: "resource_id", Enabled: true},
		},
	}
}

func TestLabelTemplateValidate(t *testing.T) {
	template := validTemplate()
	template.Normalize()
	require.NoError(t, template.Validate())

	cases := []struct {
		name   string
		mutate func(*LabelTemplate)
	}{
		{"empty name", func(t *LabelTemplate) { t.Name = "" }},
		{"long name", func(t *LabelTemplate) { t.Name = string(make([]byte, 101)) }},
		{"bad category", func(t *LabelTemplate) { t.ResourceCategory = "kubernetes" }},
		{"missing target", func(t *LabelTemplate) { t.Mappings[0].TargetLabel = "" }},
		{"reserved target", func(t *LabelTemplate) { t.Mappings[0].TargetLabel = "__name__" }},
		{"bad target", func(t *LabelTemplate) { t.Mappings[0].TargetLabel = "bad-label" }},
		{"missing source field", func(t *LabelTemplate) { t.Mappings[0].SourceField = "" }},
		{"bad source type", func(t *LabelTemplate) { t.Mappings[0].SourceType = "vendor" }},
		{"composite not instance", func(t *LabelTemplate) { t.Mappings[0].TargetLabel = "host" }},
		{"bad transform", func(t *LabelTemplate) { t.Mappings[0].Transform = "reverse" }},
		{"duplicate target", func(t *LabelTemplate) {
			t.Mappings[1].TargetLabel = t.Mappings[0].TargetLabel
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := *validTemplate()
			copy.Mappings = append([]LabelMapping(nil), validTemplate().Mappings...)
			tc.mutate(&copy)
			assert.Error(t, copy.Validate())
		})
	}
}

func TestLabelTemplateNormalize(t *testing.T) {
	template := &LabelTemplate{
		Name: "  host  ",
		Mappings: []LabelMapping{
			{SourceField: " resource_id ", TargetLabel: " resource_id "},
		},
	}
	template.Normalize()
	assert.Equal(t, "host", template.Name)
	assert.Equal(t, "resource_id", template.Mappings[0].SourceField)
	assert.Equal(t, "resource_id", template.Mappings[0].TargetLabel)

	empty := &LabelTemplate{}
	empty.Normalize()
	assert.NotNil(t, empty.Mappings)
	assert.Empty(t, empty.Mappings)
}
