package dto

import "github.com/metriccenter/metriccenter/platform/modules/m09/service"

// ConfigTriggerRequest is the body for POST /api/v3/platform/config-sync/trigger.
type ConfigTriggerRequest struct {
	Scope            string   `json:"scope"`
	NetworkDomainIDs []string `json:"network_domain_ids"`
	Wait             bool     `json:"wait"`
}

// ConfigTriggerDomainResult reports the outcome for one network domain.
type ConfigTriggerDomainResult struct {
	NetworkDomainID   string `json:"network_domain_id"`
	Version           string `json:"version"`
	ValidationStatus  string `json:"validation_status"`
	ValidationCause   string `json:"validation_cause"`
	ValidationDetails string `json:"validation_details,omitempty"`
	Error             string `json:"error,omitempty"`
}

// ConfigTriggerCenterResult reports the outcome of the center rules sync.
type ConfigTriggerCenterResult struct {
	Version           string `json:"version"`
	ValidationStatus  string `json:"validation_status"`
	ValidationCause   string `json:"validation_cause"`
	ValidationDetails string `json:"validation_details,omitempty"`
	Error             string `json:"error,omitempty"`
}

// ConfigTriggerResponse is the immediate-sync response envelope.
type ConfigTriggerResponse struct {
	Accepted  bool                        `json:"accepted"`
	Completed bool                        `json:"completed"`
	Domains   []ConfigTriggerDomainResult `json:"domains,omitempty"`
	Center    *ConfigTriggerCenterResult  `json:"center,omitempty"`
}

// FromTriggerResult converts the service result to the HTTP response.
func FromTriggerResult(result *service.TriggerResult) ConfigTriggerResponse {
	if result == nil {
		return ConfigTriggerResponse{}
	}
	out := ConfigTriggerResponse{
		Accepted:  result.Accepted,
		Completed: result.Completed,
	}
	if len(result.Domains) > 0 {
		out.Domains = make([]ConfigTriggerDomainResult, 0, len(result.Domains))
		for _, item := range result.Domains {
			out.Domains = append(out.Domains, ConfigTriggerDomainResult{
				NetworkDomainID:   item.NetworkDomainID,
				Version:           item.Version,
				ValidationStatus:  item.ValidationStatus,
				ValidationCause:   item.ValidationCause,
				ValidationDetails: item.ValidationDetails,
				Error:             item.Error,
			})
		}
	}
	if result.Center != nil {
		out.Center = &ConfigTriggerCenterResult{
			Version:           result.Center.Version,
			ValidationStatus:  result.Center.ValidationStatus,
			ValidationCause:   result.Center.ValidationCause,
			ValidationDetails: result.Center.ValidationDetails,
			Error:             result.Center.Error,
		}
	}
	return out
}
