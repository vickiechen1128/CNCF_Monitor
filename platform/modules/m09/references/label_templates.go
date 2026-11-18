package references

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// This file holds the M09-side read-only view of M07 v3 label templates
// (`m07_label_templates`). M09 consumes the persisted mapping contract; it does
// not import M07 domain behaviour, matching the "M09 only reads" boundary used
// for M01 jobs and M07 resources.

// labelMapping is the persisted mapping shape written by M07. Keep it in sync
// with `m07_label_templates.mappings` (JSON array).
type labelMapping struct {
	SourceField string `json:"source_field"`
	SourceType  string `json:"source_type"`
	TargetLabel string `json:"target_label"`
	Enabled     bool   `json:"enabled"`
	Transform   string `json:"transform,omitempty"`
}

// labelTemplate is the resolved template projection used by the generator.
type labelTemplate struct {
	ID               string
	ResourceCategory string
	IsDefault        bool
	Mappings         []labelMapping
}

// labelTemplateRow is the GORM projection of one row. `serializer:json` keeps
// SQLite TEXT and PostgreSQL jsonb portable without driver-specific SQL.
type labelTemplateRow struct {
	ID               string         `gorm:"column:id"`
	ResourceCategory string         `gorm:"column:resource_category"`
	IsDefault        bool           `gorm:"column:is_default"`
	Mappings         []labelMapping `gorm:"column:mappings;serializer:json"`
	UpdatedAt        time.Time      `gorm:"column:updated_at"`
	DeletedAt        *time.Time     `gorm:"column:deleted_at"`
}

// TableName pins the v3 table name.
func (labelTemplateRow) TableName() string { return "m07_label_templates" }

// labelTemplateSet is the per-BuildSource snapshot: every non-deleted template
// indexed by id plus the category default index.
type labelTemplateSet struct {
	byID              map[string]labelTemplate
	defaultByCategory map[string]labelTemplate
}

// loadLabelTemplates reads all non-deleted templates in one query. Cardinality
// is low (≤ a handful per category), so no cross-call cache is used — a template
// edit must be visible on the next BuildSource tick, and Fingerprint already
// covers template changes.
func (r *GORMSourceReader) loadLabelTemplates(ctx context.Context) (labelTemplateSet, error) {
	var rows []labelTemplateRow
	if err := r.db.WithContext(ctx).
		Where("deleted_at IS NULL").
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return labelTemplateSet{}, fmt.Errorf("load m07 label templates: %w", err)
	}

	set := labelTemplateSet{
		byID:              make(map[string]labelTemplate, len(rows)),
		defaultByCategory: make(map[string]labelTemplate, len(rows)),
	}
	for _, row := range rows {
		tpl := labelTemplate{
			ID:               row.ID,
			ResourceCategory: row.ResourceCategory,
			IsDefault:        row.IsDefault,
			Mappings:         row.Mappings,
		}
		set.byID[tpl.ID] = tpl
		if !tpl.IsDefault {
			continue
		}
		if prev, exists := set.defaultByCategory[tpl.ResourceCategory]; exists {
			// The DB unique index prevents this; a manual edit that breaks it is
			// a data anomaly. Fail loudly instead of silently picking one.
			return labelTemplateSet{}, fmt.Errorf(
				"resource category %q has multiple default label templates (%s, %s)",
				tpl.ResourceCategory, prev.ID, tpl.ID)
		}
		set.defaultByCategory[tpl.ResourceCategory] = tpl
	}
	return set, nil
}

// resolve applies the v2.56 priority:
//  1. Job explicit label_template_id, when it exists and matches the category;
//  2. category default (is_default=true);
//  3. no template (system labels only).
//
// A soft-deleted explicit template is absent from byID, and a category mismatch
// falls through, so both cases fall back to the category default.
func (s labelTemplateSet) resolve(explicitID, category string) (labelTemplate, bool) {
	if explicitID != "" {
		if tpl, ok := s.byID[explicitID]; ok && tpl.ResourceCategory == category {
			return tpl, true
		}
	}
	if category != "" {
		if tpl, ok := s.defaultByCategory[category]; ok {
			return tpl, true
		}
	}
	return labelTemplate{}, false
}

// expandTemplateLabels materialises the enabled mappings of one template into
// target labels. `instance` is the already-resolved scrape address (standard
// ip:port or blackbox URL); `jobName` feeds the prometheus_builtin `job` source.
func expandTemplateLabels(tpl labelTemplate, ref domain.ResourceRef, instance, jobName string) map[string]string {
	fields := resourceFieldView(ref)
	labels := make(map[string]string, len(tpl.Mappings))
	for _, mapping := range tpl.Mappings {
		if !mapping.Enabled || mapping.TargetLabel == "" {
			continue
		}
		switch mapping.SourceType {
		case "composite":
			// MVP only defines instance_ip:port; the composite value is the
			// address already resolved by M01 (application endpoints carry their
			// own port, so composite is not used for that category).
			if mapping.SourceField == "instance_ip:port" && instance != "" {
				labels[mapping.TargetLabel] = instance
			}
		case "resource_field":
			if value := fields[mapping.SourceField]; value != "" {
				labels[mapping.TargetLabel] = applyLabelTransform(value, mapping.Transform)
			}
		case "prometheus_builtin":
			if value := builtinField(mapping.SourceField, instance, jobName); value != "" {
				labels[mapping.TargetLabel] = applyLabelTransform(value, mapping.Transform)
			}
		case "cmdb_field":
			// v0.4+; no CMDB source is available in v3.
		}
	}
	return labels
}

// resourceFieldView converts a resource projection into the M07 field-name
// view used by `source_type=resource_field`. Category-specific collisions
// (`version`) are resolved by the category.
func resourceFieldView(ref domain.ResourceRef) map[string]string {
	fields := map[string]string{
		"resource_id":       ref.ID,
		"tenant_id":         ref.TenantID,
		"resource_category": string(ref.Category),
		"status":            ref.Status,
		"instance_ip":       ref.InstanceIP,
		"biz_code":          ref.BizCode,
		"app_code":          ref.AppCode,
		"platform_code":     ref.PlatformCode,
		"env":               ref.Env,
		"cluster":           ref.Cluster,
		"owner":             ref.Owner,
		"scrape_port":       positiveIntString(ref.ScrapePort),
	}
	switch ref.Category {
	case domain.CategoryHost:
		fields["instance_name"] = ref.DisplayName
		fields["hostname"] = ref.Hostname
		fields["os_type"] = ref.OSType
		fields["os_version"] = ref.OSVersion
		fields["activated_at"] = ref.ActivatedAt
	case domain.CategoryDatabase:
		fields["database_type"] = ref.DatabaseType
		fields["port"] = positiveIntString(ref.Port)
		fields["version"] = ref.DatabaseVersion
	case domain.CategoryMiddleware:
		fields["middleware_type"] = ref.MiddlewareType
		fields["port"] = positiveIntString(ref.Port)
		fields["version"] = ref.MiddlewareVersion
	case domain.CategoryApplication:
		fields["service_name"] = ref.ServiceName
		fields["health_check_url"] = ref.HealthCheckURL
		fields["protocol"] = ref.Protocol
		fields["endpoint"] = ref.Endpoint
		fields["port"] = positiveIntString(ref.Port)
		fields["owner1"] = ref.Owner1
		fields["owner1_contact"] = ref.Owner1Contact
		fields["owner2"] = ref.Owner2
		fields["owner2_contact"] = ref.Owner2Contact
		fields["ops_person"] = ref.OpsPerson
		fields["ops_person_contact"] = ref.OpsPersonContact
		fields["go_live_at"] = ref.GoLiveAt
	case domain.CategoryGenericTarget:
		fields["target_name"] = ref.TargetName
		fields["port"] = positiveIntString(ref.Port)
		fields["metrics_path"] = ref.MetricsPath
		fields["scheme"] = ref.Scheme
		fields["exporter_type"] = ref.ExporterType
	case domain.CategoryInterfaceService:
		fields["api_name"] = ref.APIName
		fields["api_url"] = ref.APIURL
	}
	return fields
}

// builtinField resolves the MVP-supported prometheus_builtin sources. The
// frontend keeps these mappings hidden for new templates, but existing ones
// must keep rendering.
func builtinField(sourceField, instance, jobName string) string {
	switch sourceField {
	case "instance", "__address__":
		return instance
	case "job":
		return jobName
	default:
		return ""
	}
}

// applyLabelTransform applies the v3 transform whitelist. `prefix` / `replace`
// carry no parameters in the v3 contract, so they pass through unchanged
// (same as empty / legacy dict); only lower / upper mutate the value.
func applyLabelTransform(value, transform string) string {
	switch transform {
	case "lower":
		return strings.ToLower(value)
	case "upper":
		return strings.ToUpper(value)
	default:
		return value
	}
}

// systemTargetLabels are the protected identity labels M09 always injects.
// Templates may not override them (v2.56 §5.13).
func systemTargetLabels(ref domain.ResourceRef) map[string]string {
	return map[string]string{"resource_id": ref.ID}
}

// mergeTargetLabels merges template labels under the protected system layer.
// Prometheus-internal labels (`__…`) are dropped defensively even if a legacy
// template row bypassed validation.
func mergeTargetLabels(system, template map[string]string) map[string]string {
	out := make(map[string]string, len(system)+len(template))
	for key, value := range template {
		if strings.HasPrefix(key, "__") {
			continue
		}
		out[key] = value
	}
	for key, value := range system {
		out[key] = value
	}
	return out
}

func positiveIntString(value int) string {
	if value <= 0 {
		return ""
	}
	return strconv.Itoa(value)
}
