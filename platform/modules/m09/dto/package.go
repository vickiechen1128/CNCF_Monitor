package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// PackageComponentResponse is one component version in an offline package.
type PackageComponentResponse struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// EdgePackageResponse is one offline package (contract §5.1).
type EdgePackageResponse struct {
	Version    string                     `json:"version"`
	File       string                     `json:"file"`
	Sha256     string                     `json:"sha256"`
	SizeBytes  int64                      `json:"size_bytes"`
	ReleasedAt *time.Time                 `json:"released_at"`
	Components []PackageComponentResponse `json:"components,omitempty"`
}

// ListEdgePackagesResponse is the package list envelope.
type ListEdgePackagesResponse struct {
	List  []EdgePackageResponse `json:"list"`
	Total int64                 `json:"total"`
}

// FromEdgePackage converts the service read model to the contract response.
func FromEdgePackage(item *service.EdgePackage) EdgePackageResponse {
	components := make([]PackageComponentResponse, 0, len(item.Components))
	for _, component := range item.Components {
		components = append(components, PackageComponentResponse{Name: component.Name, Version: component.Version})
	}
	var released *time.Time
	if !item.ReleasedAt.IsZero() {
		value := item.ReleasedAt
		released = &value
	}
	return EdgePackageResponse{
		Version:    item.Version,
		File:       item.File,
		Sha256:     item.Sha256,
		SizeBytes:  item.SizeBytes,
		ReleasedAt: released,
		Components: components,
	}
}
