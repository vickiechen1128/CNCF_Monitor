package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// CandidateResponse is one instance candidate.
type CandidateResponse struct {
	ResourceID       string `json:"resource_id"`
	ResourceCategory string `json:"resource_category"`
	TemplateCode     string `json:"template_code"`
	DisplayName      string `json:"display_name"`
	InstanceIP       string `json:"instance_ip"`
	Port             int    `json:"port"`
	TargetAddress    string `json:"target_address"`
	NetworkDomainID  string `json:"network_domain_id"`
	Status           string `json:"status"`
	Selectable       bool   `json:"selectable"`
	DisabledReason   string `json:"disabled_reason"`
}

// FromCandidate maps a domain resource plus derived fields to the projection.
func FromCandidate(ref domain.ResourceRef, templateCode, targetAddress string, selectable bool, disabledReason string) CandidateResponse {
	return CandidateResponse{
		ResourceID:       ref.ID,
		ResourceCategory: string(ref.Category),
		TemplateCode:     templateCode,
		DisplayName:      ref.DisplayName,
		InstanceIP:       ref.InstanceIP,
		Port:             ref.Port,
		TargetAddress:    targetAddress,
		NetworkDomainID:  ref.NetworkDomainID,
		Status:           ref.Status,
		Selectable:       selectable,
		DisabledReason:   disabledReason,
	}
}

// InstallationResponse is the optional exporter installation note.
type InstallationResponse struct {
	Status      string     `json:"status"`
	ActualPort  int        `json:"actual_port"`
	ConfirmedBy string     `json:"confirmed_by"`
	Notes       string     `json:"notes"`
	ConfirmedAt *time.Time `json:"confirmed_at"`
}

// FromInstallation maps a domain installation note.
func FromInstallation(item *domain.Installation) *InstallationResponse {
	if item == nil {
		return nil
	}
	return &InstallationResponse{
		Status:      string(item.Status),
		ActualPort:  item.ActualPort,
		ConfirmedBy: item.ConfirmedBy,
		Notes:       item.Notes,
		ConfirmedAt: item.ConfirmedAt,
	}
}

// JobInstanceResponse is one selected instance with its target estimate.
type JobInstanceResponse struct {
	ResourceID  string `json:"resource_id"`
	DisplayName string `json:"display_name"`
	InstanceIP  string `json:"instance_ip"`
	Port        int    `json:"port"`
	// PortSource: instance / mapping / template / business / default / unresolved
	PortSource    string                `json:"port_source"`
	Status        string                `json:"status"`
	TargetAddress string                `json:"target_address"`
	Installation  *InstallationResponse `json:"installation"`
}

// InstallationRequest is the installation registration payload.
type InstallationRequest struct {
	ActualPort  int    `json:"actual_port"`
	ConfirmedBy string `json:"confirmed_by"`
	Notes       string `json:"notes"`
}

// PreviewTarget is one rendered target group.
type PreviewTarget struct {
	Targets []string          `json:"targets"`
	Labels  map[string]string `json:"labels"`
}

// PreviewSkip records an instance that could not be rendered.
type PreviewSkip struct {
	ResourceID string `json:"resource_id"`
	Reason     string `json:"reason"`
}

// PreviewResponse is the dry-run target preview.
type PreviewResponse struct {
	JobName string          `json:"job_name"`
	Targets []PreviewTarget `json:"targets"`
	Skipped []PreviewSkip   `json:"skipped"`
}
