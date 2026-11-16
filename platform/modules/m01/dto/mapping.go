package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// MappingRequest is the create/update payload of a default collection mapping.
// label_template_id is intentionally absent: it has a dedicated endpoint.
type MappingRequest struct {
	MonitorType        string `json:"monitor_type"`
	ExporterTemplateID string `json:"exporter_template_id"`
	IsDefault          bool   `json:"is_default"`
	DefaultPort        int    `json:"default_port"`
	MetricsPath        string `json:"metrics_path"`
	Scheme             string `json:"scheme"`
	ScrapeInterval     string `json:"scrape_interval"`
	ScrapeTimeout      string `json:"scrape_timeout"`
}

// ToDomain converts the request into a domain entity (without ID/timestamps).
func (r MappingRequest) ToDomain() *domain.Mapping {
	return &domain.Mapping{
		MonitorType:        r.MonitorType,
		ExporterTemplateID: r.ExporterTemplateID,
		IsDefault:          r.IsDefault,
		DefaultPort:        r.DefaultPort,
		MetricsPath:        r.MetricsPath,
		Scheme:             domain.Scheme(r.Scheme),
		ScrapeInterval:     r.ScrapeInterval,
		ScrapeTimeout:      r.ScrapeTimeout,
	}
}

// SetLabelTemplateRequest is the dedicated label-template change payload.
type SetLabelTemplateRequest struct {
	LabelTemplateID string `json:"label_template_id"`
}

// MappingResponse is the v3 mapping projection.
type MappingResponse struct {
	ID                   string    `json:"id"`
	MonitorType          string    `json:"monitor_type"`
	ExporterTemplateID   string    `json:"exporter_template_id"`
	ExporterTemplateName string    `json:"exporter_template_name"`
	IsDefault            bool      `json:"is_default"`
	DefaultPort          int       `json:"default_port"`
	MetricsPath          string    `json:"metrics_path"`
	Scheme               string    `json:"scheme"`
	ScrapeInterval       string    `json:"scrape_interval"`
	ScrapeTimeout        string    `json:"scrape_timeout"`
	LabelTemplateID      string    `json:"label_template_id"`
	LabelTemplateName    string    `json:"label_template_name"`
	IsBuiltin            bool      `json:"is_builtin"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// FromMapping maps a domain mapping plus resolved display names to the v3
// projection. The names are empty when the cross-module port cannot resolve
// them (D-3 not ready yet).
func FromMapping(item *domain.Mapping, exporterName, labelTemplateName string) MappingResponse {
	return MappingResponse{
		ID:                   item.ID,
		MonitorType:          item.MonitorType,
		ExporterTemplateID:   item.ExporterTemplateID,
		ExporterTemplateName: exporterName,
		IsDefault:            item.IsDefault,
		DefaultPort:          item.DefaultPort,
		MetricsPath:          item.MetricsPath,
		Scheme:               string(item.Scheme),
		ScrapeInterval:       item.ScrapeInterval,
		ScrapeTimeout:        item.ScrapeTimeout,
		LabelTemplateID:      item.LabelTemplateID,
		LabelTemplateName:    labelTemplateName,
		IsBuiltin:            item.IsBuiltin,
		CreatedAt:            item.CreatedAt,
		UpdatedAt:            item.UpdatedAt,
	}
}
