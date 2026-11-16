package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// BusinessMetricRequest is the business metric create/update payload.
type BusinessMetricRequest struct {
	MetricID            string `json:"metric_id"`
	MetricName          string `json:"metric_name"`
	Description         string `json:"description"`
	MetricType          string `json:"metric_type"`
	Unit                string `json:"unit"`
	BusinessDomain      string `json:"business_domain"`
	AppName             string `json:"app_name"`
	ThresholdSuggestion string `json:"threshold_suggestion"`
	Owner               string `json:"owner"`
	RegisterSource      string `json:"register_source"`
	Status              string `json:"status"`
}

// ToDomain converts the request into a domain business metric.
func (r BusinessMetricRequest) ToDomain() *domain.BusinessMetric {
	return &domain.BusinessMetric{
		MetricID: r.MetricID, MetricName: r.MetricName, Description: r.Description,
		MetricType: domain.MetricType(r.MetricType), Unit: r.Unit,
		BusinessDomain: r.BusinessDomain, AppName: r.AppName,
		ThresholdSuggestion: r.ThresholdSuggestion, Owner: r.Owner,
		RegisterSource: domain.RegisterSource(r.RegisterSource),
		Status:         domain.BusinessMetricStatus(r.Status),
	}
}

// BusinessMetricResponse is the business metric projection.
type BusinessMetricResponse struct {
	ID                  string    `json:"id"`
	MetricID            string    `json:"metric_id"`
	MetricName          string    `json:"metric_name"`
	Description         string    `json:"description"`
	MetricType          string    `json:"metric_type"`
	Unit                string    `json:"unit"`
	BusinessDomain      string    `json:"business_domain"`
	AppName             string    `json:"app_name"`
	ThresholdSuggestion string    `json:"threshold_suggestion"`
	Owner               string    `json:"owner"`
	RegisterSource      string    `json:"register_source"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// FromBusinessMetric maps a domain business metric to the v3 projection.
func FromBusinessMetric(item *domain.BusinessMetric) BusinessMetricResponse {
	return BusinessMetricResponse{
		ID: item.ID, MetricID: item.MetricID, MetricName: item.MetricName,
		Description: item.Description, MetricType: string(item.MetricType), Unit: item.Unit,
		BusinessDomain: item.BusinessDomain, AppName: item.AppName,
		ThresholdSuggestion: item.ThresholdSuggestion, Owner: item.Owner,
		RegisterSource: string(item.RegisterSource), Status: string(item.Status),
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}
