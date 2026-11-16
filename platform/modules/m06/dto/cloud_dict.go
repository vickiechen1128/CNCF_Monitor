package dto

import "github.com/metriccenter/metriccenter/platform/modules/m06/domain"

// CloudDictResponse is the cloud dictionary representation returned by M06.
type CloudDictResponse struct {
	Code        string `json:"cloud_code"`
	Name        string `json:"cloud_name"`
	Type        string `json:"cloud_type"`
	Carrier     string `json:"carrier"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

// FromCloudDict converts a domain entry to the response DTO.
func FromCloudDict(item *domain.CloudDict) CloudDictResponse {
	return CloudDictResponse{
		Code:        item.Code,
		Name:        item.Name,
		Type:        item.Type,
		Carrier:     item.Carrier,
		Description: item.Description,
		Enabled:     item.Enabled,
	}
}

// CreateCloudDictRequest is the POST /cloud-dict body. cloud_code must be the
// composite `{cloud_type}-{carrier}`; unknown fields are rejected by the strict
// decoder so immutable attributes cannot sneak in.
type CreateCloudDictRequest struct {
	CloudCode   string `json:"cloud_code"`
	CloudName   string `json:"cloud_name"`
	CloudType   string `json:"cloud_type"`
	Carrier     string `json:"carrier"`
	Description string `json:"description"`
}

// ToDomain converts the request to the service input.
func (r CreateCloudDictRequest) ToDomain() domain.CreateCloudDictInput {
	return domain.CreateCloudDictInput{
		Code:        r.CloudCode,
		Name:        r.CloudName,
		Type:        r.CloudType,
		Carrier:     r.Carrier,
		Description: r.Description,
	}
}

// UpdateCloudDictRequest is the PUT /cloud-dict/:cloud_code body. Only the
// enabled flag is accepted (D37: disable-only, no attribute edits).
type UpdateCloudDictRequest struct {
	Enabled *bool `json:"enabled"`
}
