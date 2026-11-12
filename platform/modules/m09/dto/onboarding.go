package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// OnboardingResponse is the onboarding view (contract §2.1). Runtime fields
// are masked; the plaintext token never appears here.
type OnboardingResponse struct {
	NetworkDomainID    string     `json:"network_domain_id"`
	Name               string     `json:"name"`
	CloudCode          string     `json:"cloud_code"`
	ZoneType           string     `json:"zone_type"`
	RegistrationStatus string     `json:"registration_status"`
	MonitoredAt        *time.Time `json:"monitored_at"`
	TokenMasked        string     `json:"token_masked"`
	AgentCount         int64      `json:"agent_count"`
	OnlineAgentCount   int64      `json:"online_agent_count"`
	LastHeartbeatAt    *time.Time `json:"last_heartbeat_at"`
	LastConfigVersion  string     `json:"last_config_version"`
	CenterEndpoint     string     `json:"center_endpoint"`
	RemoteWriteURL     string     `json:"remote_write_url"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// ListOnboardingResponse is the pagination envelope (contract §1.2).
type ListOnboardingResponse struct {
	List     []OnboardingResponse `json:"list"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"page_size"`
}

// InstallGuideResponse is the standard edge-agent installation walkthrough.
type InstallGuideResponse struct {
	Steps              []string `json:"steps"`
	PackageDownloadURL string   `json:"package_download_url"`
}

// MonitorResponse is the onboarding success payload (contract §2.3). The
// `token` field is the only place a plaintext token is ever returned.
type MonitorResponse struct {
	NetworkDomainID    string               `json:"network_domain_id"`
	RegistrationStatus string               `json:"registration_status"`
	Token              string               `json:"token"`
	TokenMasked        string               `json:"token_masked"`
	CenterEndpoint     string               `json:"center_endpoint"`
	RemoteWriteURL     string               `json:"remote_write_url"`
	InstallGuide       InstallGuideResponse `json:"install_guide"`
}

// ResetTokenResponse is the reset payload (contract §2.4); the new plaintext
// token is returned once.
type ResetTokenResponse struct {
	Token       string    `json:"token"`
	TokenMasked string    `json:"token_masked"`
	ResetAt     time.Time `json:"reset_at"`
}

// UnmonitorResponse reports the post-unmonitor onboarding state.
type UnmonitorResponse struct {
	NetworkDomainID    string `json:"network_domain_id"`
	RegistrationStatus string `json:"registration_status"`
}

// FromOnboarding converts a repository read model to the contract response.
func FromOnboarding(item *repository.DomainOnboarding) OnboardingResponse {
	return OnboardingResponse{
		NetworkDomainID:    item.DomainID,
		Name:               item.Name,
		CloudCode:          item.CloudCode,
		ZoneType:           item.ZoneType,
		RegistrationStatus: item.RegistrationStatus,
		MonitoredAt:        item.MonitoredAt,
		TokenMasked:        item.TokenMasked,
		AgentCount:         item.AgentCount,
		OnlineAgentCount:   item.OnlineAgentCount,
		LastHeartbeatAt:    item.LastHeartbeatAt,
		LastConfigVersion:  item.LastConfigVersion,
		CenterEndpoint:     item.CenterEndpoint,
		RemoteWriteURL:     item.RemoteWriteURL,
		CreatedAt:          item.CreatedAt,
		UpdatedAt:          item.UpdatedAt,
	}
}

// FromMonitorResult converts the service result to the contract response.
func FromMonitorResult(result *service.MonitorResult) MonitorResponse {
	return MonitorResponse{
		NetworkDomainID:    result.DomainID,
		RegistrationStatus: result.RegistrationState,
		Token:              result.TokenPlain,
		TokenMasked:        result.TokenMasked,
		CenterEndpoint:     result.CenterEndpoint,
		RemoteWriteURL:     result.RemoteWriteURL,
		InstallGuide: InstallGuideResponse{
			Steps:              result.InstallGuide.Steps,
			PackageDownloadURL: result.InstallGuide.PackageDownloadURL,
		},
	}
}

// FromResetToken converts the service result to the contract response.
func FromResetToken(result *service.ResetTokenResult) ResetTokenResponse {
	return ResetTokenResponse{
		Token:       result.TokenPlain,
		TokenMasked: result.TokenMasked,
		ResetAt:     result.ResetAt,
	}
}
