package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// MetricRequest is the technical metric create/update payload.
type MetricRequest struct {
	MetricName         string                `json:"metric_name"`
	MetricType         string                `json:"metric_type"`
	Help               string                `json:"help"`
	Unit               string                `json:"unit"`
	Labels             []string              `json:"labels"`
	MonitorTypes       []domain.MetricAnchor `json:"monitor_types"`
	Category           string                `json:"category"`
	ExporterTemplateID string                `json:"exporter_template_id"`
	Enabled            *bool                 `json:"enabled"`
}

// ToDomain converts the request into a domain metric.
func (r MetricRequest) ToDomain() *domain.Metric {
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	return &domain.Metric{
		MetricName:         r.MetricName,
		MetricType:         domain.MetricType(r.MetricType),
		Help:               r.Help,
		Unit:               r.Unit,
		Labels:             r.Labels,
		MonitorTypes:       r.MonitorTypes,
		Category:           r.Category,
		ExporterTemplateID: r.ExporterTemplateID,
		Enabled:            enabled,
	}
}

// MetricResponse is the technical metric projection.
type MetricResponse struct {
	ID                 string                `json:"id"`
	MetricName         string                `json:"metric_name"`
	MetricType         string                `json:"metric_type"`
	Help               string                `json:"help"`
	Unit               string                `json:"unit"`
	Labels             []string              `json:"labels"`
	MonitorTypes       []domain.MetricAnchor `json:"monitor_types"`
	Category           string                `json:"category"`
	ExporterTemplateID string                `json:"exporter_template_id"`
	IsBuiltin          bool                  `json:"is_builtin"`
	Enabled            bool                  `json:"enabled"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
}

// FromMetric maps a domain metric to the v3 projection.
func FromMetric(item *domain.Metric) MetricResponse {
	labels := item.Labels
	if labels == nil {
		labels = []string{}
	}
	anchors := item.MonitorTypes
	if anchors == nil {
		anchors = []domain.MetricAnchor{}
	}
	return MetricResponse{
		ID: item.ID, MetricName: item.MetricName, MetricType: string(item.MetricType),
		Help: item.Help, Unit: item.Unit, Labels: labels, MonitorTypes: anchors,
		Category: item.Category, ExporterTemplateID: item.ExporterTemplateID,
		IsBuiltin: item.IsBuiltin, Enabled: item.Enabled,
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}
