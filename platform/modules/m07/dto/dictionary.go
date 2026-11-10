package dto

import (
	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
)

// BusinessDomain is a v3 business dictionary item.
type BusinessDomain struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

// Application is a v3 application dictionary item.
type Application struct {
	AppCode string `json:"app_code"`
	AppName string `json:"app_name"`
	Status  string `json:"status"`
}

// Platform is a v3 platform dictionary item.
type Platform struct {
	PlatformCode string `json:"platform_code"`
	PlatformName string `json:"platform_name"`
	Enabled      bool   `json:"enabled"`
}

// Cloud is a v3 cloud dictionary item.
type Cloud struct {
	CloudCode string `json:"cloud_code"`
	CloudName string `json:"cloud_name"`
	Enabled   bool   `json:"enabled"`
}

// ZoneType is a v3 zone type item.
type ZoneType struct {
	Code        string `json:"code"`
	DisplayName string `json:"display_name"`
	Enabled     bool   `json:"enabled"`
}

// OSOption is a v3 OS dictionary item.
type OSOption struct {
	Name   string `json:"name"`
	Family string `json:"family"`
}

// AppPlatformRel is a v3 application↔platform relation.
type AppPlatformRel struct {
	RelID        string `json:"rel_id"`
	AppCode      string `json:"app_code"`
	PlatformCode string `json:"platform_code"`
	IsPrimary    bool   `json:"is_primary"`
}

// FromAppPlatformRel maps one dictionary relation to a DTO.
func FromAppPlatformRel(item *dictionary.AppPlatformRel) AppPlatformRel {
	return AppPlatformRel{
		RelID:        item.RelID,
		AppCode:      item.AppCode,
		PlatformCode: item.PlatformCode,
		IsPrimary:    item.IsPrimary,
	}
}

// FromBusinessDomains maps dictionary entries to DTOs.
func FromBusinessDomains(items []dictionary.BusinessDomain) []BusinessDomain {
	out := make([]BusinessDomain, 0, len(items))
	for _, item := range items {
		out = append(out, BusinessDomain{Code: item.Code, Name: item.Name, Enabled: item.Enabled})
	}
	return out
}

// FromApplications maps dictionary entries to DTOs.
func FromApplications(items []dictionary.Application) []Application {
	out := make([]Application, 0, len(items))
	for _, item := range items {
		out = append(out, Application{AppCode: item.AppCode, AppName: item.AppName, Status: item.Status})
	}
	return out
}

// FromPlatforms maps dictionary entries to DTOs.
func FromPlatforms(items []dictionary.Platform) []Platform {
	out := make([]Platform, 0, len(items))
	for _, item := range items {
		out = append(out, Platform{PlatformCode: item.PlatformCode, PlatformName: item.PlatformName, Enabled: item.Enabled})
	}
	return out
}

// FromClouds maps dictionary entries to DTOs.
func FromClouds(items []dictionary.Cloud) []Cloud {
	out := make([]Cloud, 0, len(items))
	for _, item := range items {
		out = append(out, Cloud{CloudCode: item.CloudCode, CloudName: item.CloudName, Enabled: item.Enabled})
	}
	return out
}

// FromZoneTypes maps dictionary entries to DTOs.
func FromZoneTypes(items []dictionary.ZoneType) []ZoneType {
	out := make([]ZoneType, 0, len(items))
	for _, item := range items {
		out = append(out, ZoneType{Code: item.Code, DisplayName: item.DisplayName, Enabled: item.Enabled})
	}
	return out
}

// FromOSOptions maps dictionary entries to DTOs.
func FromOSOptions(items []dictionary.OSOption) []OSOption {
	out := make([]OSOption, 0, len(items))
	for _, item := range items {
		out = append(out, OSOption{Name: item.Name, Family: item.Family})
	}
	return out
}

// FromAppPlatformRels maps dictionary entries to DTOs.
func FromAppPlatformRels(items []dictionary.AppPlatformRel) []AppPlatformRel {
	out := make([]AppPlatformRel, 0, len(items))
	for _, item := range items {
		out = append(out, AppPlatformRel{
			RelID:        item.RelID,
			AppCode:      item.AppCode,
			PlatformCode: item.PlatformCode,
			IsPrimary:    item.IsPrimary,
		})
	}
	return out
}
