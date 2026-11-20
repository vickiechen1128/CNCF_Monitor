package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// ExporterTemplateRequest is the create/update payload of an exporter template.
type ExporterTemplateRequest struct {
	Name         string `json:"name"`
	Version      string `json:"version"`
	DefaultPort  int    `json:"default_port"`
	MetricsPath  string `json:"metrics_path"`
	Scheme       string `json:"scheme"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	DownloadURL  string `json:"download_url"`
	Homepage     string `json:"homepage"`
	InstallGuide string `json:"install_guide"`
	Description  string `json:"description"`
	Source       string `json:"source"`
}

// ToDomain converts the request into a domain entity (without ID/timestamps).
func (r ExporterTemplateRequest) ToDomain() *domain.ExporterTemplate {
	return &domain.ExporterTemplate{
		Name:         r.Name,
		Version:      r.Version,
		DefaultPort:  r.DefaultPort,
		MetricsPath:  r.MetricsPath,
		Scheme:       domain.Scheme(r.Scheme),
		OS:           r.OS,
		Arch:         r.Arch,
		DownloadURL:  r.DownloadURL,
		Homepage:     r.Homepage,
		InstallGuide: r.InstallGuide,
		Description:  r.Description,
		Source:       domain.ExporterSource(r.Source),
	}
}

// ExporterTemplateResponse is the v3 exporter template projection.
type ExporterTemplateResponse struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Version      string    `json:"version"`
	DefaultPort  int       `json:"default_port"`
	MetricsPath  string    `json:"metrics_path"`
	Scheme       string    `json:"scheme"`
	OS           string    `json:"os"`
	Arch         string    `json:"arch"`
	DownloadURL  string    `json:"download_url"`
	Homepage     string    `json:"homepage"`
	InstallGuide string    `json:"install_guide"`
	Description  string    `json:"description"`
	IsBuiltin    bool      `json:"is_builtin"`
	Source       string    `json:"source"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// FromExporterTemplate maps a domain entity to the v3 projection.
func FromExporterTemplate(item *domain.ExporterTemplate) ExporterTemplateResponse {
	return ExporterTemplateResponse{
		ID:           item.ID,
		Name:         item.Name,
		Version:      item.Version,
		DefaultPort:  item.DefaultPort,
		MetricsPath:  item.MetricsPath,
		Scheme:       string(item.Scheme),
		OS:           item.OS,
		Arch:         item.Arch,
		DownloadURL:  item.DownloadURL,
		Homepage:     item.Homepage,
		InstallGuide: item.InstallGuide,
		Description:  item.Description,
		IsBuiltin:    item.IsBuiltin,
		Source:       string(item.Source),
		CreatedAt:    item.CreatedAt,
		UpdatedAt:    item.UpdatedAt,
	}
}

// FromExporterTemplates maps a page of domain entities.
func FromExporterTemplates(items []*domain.ExporterTemplate) []ExporterTemplateResponse {
	out := make([]ExporterTemplateResponse, 0, len(items))
	for _, item := range items {
		out = append(out, FromExporterTemplate(item))
	}
	return out
}
