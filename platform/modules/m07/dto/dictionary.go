package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
)

// BusinessDomain is a v3 business dictionary item.
type BusinessDomain struct {
	Code           string `json:"code"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	Enabled        bool   `json:"enabled"`
	Status         string `json:"status"`
	ReferenceCount int64  `json:"reference_count"`
	MergedInto     string `json:"merged_into,omitempty"`
}

// Application is a v3 application dictionary item.
type Application struct {
	AppCode        string `json:"app_code"`
	AppName        string `json:"app_name"`
	Description    string `json:"description,omitempty"`
	Status         string `json:"status"`
	ReferenceCount int64  `json:"reference_count"`
	MergedInto     string `json:"merged_into,omitempty"`
}

// Platform is a v3 platform dictionary item.
type Platform struct {
	PlatformCode   string `json:"platform_code"`
	PlatformName   string `json:"platform_name"`
	Description    string `json:"description,omitempty"`
	Enabled        bool   `json:"enabled"`
	Status         string `json:"status"`
	ReferenceCount int64  `json:"reference_count"`
	MergedInto     string `json:"merged_into,omitempty"`
}

// DictionaryAuditLog is one lifecycle action on a dictionary entry.
type DictionaryAuditLog struct {
	ID             string `json:"id"`
	DictionaryType string `json:"dictionary_type"`
	Action         string `json:"action"`
	SourceCode     string `json:"source_code"`
	TargetCode     string `json:"target_code,omitempty"`
	ReferenceCount int64  `json:"reference_count"`
	Operator       string `json:"operator"`
	Detail         string `json:"detail,omitempty"`
	CreatedAt      string `json:"created_at"`
}

// Cloud is a v3 cloud dictionary item. Create/disable writes live in M06 (D37);
// M07 serves the read list plus the terminal lifecycle states (revoke/merge).
type Cloud struct {
	CloudCode      string `json:"cloud_code"`
	CloudName      string `json:"cloud_name"`
	CloudType      string `json:"cloud_type"`
	Carrier        string `json:"carrier"`
	Description    string `json:"description,omitempty"`
	Enabled        bool   `json:"enabled"`
	Status         string `json:"status"`
	ReferenceCount int64  `json:"reference_count"`
	MergedInto     string `json:"merged_into,omitempty"`
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
		out = append(out, fromBusinessDomain(item))
	}
	return out
}

// FromBusinessDomain maps one dictionary entry to a DTO.
func FromBusinessDomain(item *dictionary.BusinessDomain) BusinessDomain {
	if item == nil {
		return BusinessDomain{}
	}
	return fromBusinessDomain(*item)
}

func fromBusinessDomain(item dictionary.BusinessDomain) BusinessDomain {
	return BusinessDomain{
		Code: item.Code, Name: item.Name, Description: item.Description, Enabled: item.Enabled,
		Status: item.Status, ReferenceCount: item.ReferenceCount, MergedInto: item.MergedInto,
	}
}

// FromApplications maps dictionary entries to DTOs.
func FromApplications(items []dictionary.Application) []Application {
	out := make([]Application, 0, len(items))
	for _, item := range items {
		out = append(out, fromApplication(item))
	}
	return out
}

// FromApplication maps one dictionary entry to a DTO.
func FromApplication(item *dictionary.Application) Application {
	if item == nil {
		return Application{}
	}
	return fromApplication(*item)
}

func fromApplication(item dictionary.Application) Application {
	return Application{
		AppCode: item.AppCode, AppName: item.AppName, Description: item.Description, Status: item.Status,
		ReferenceCount: item.ReferenceCount, MergedInto: item.MergedInto,
	}
}

// FromPlatforms maps dictionary entries to DTOs.
func FromPlatforms(items []dictionary.Platform) []Platform {
	out := make([]Platform, 0, len(items))
	for _, item := range items {
		out = append(out, fromPlatform(item))
	}
	return out
}

// FromPlatform maps one dictionary entry to a DTO.
func FromPlatform(item *dictionary.Platform) Platform {
	if item == nil {
		return Platform{}
	}
	return fromPlatform(*item)
}

func fromPlatform(item dictionary.Platform) Platform {
	return Platform{
		PlatformCode: item.PlatformCode, PlatformName: item.PlatformName,
		Description: item.Description, Enabled: item.Enabled,
		Status: item.Status, ReferenceCount: item.ReferenceCount, MergedInto: item.MergedInto,
	}
}

// FromDictionaryAuditLogs maps lifecycle audit rows to DTOs.
func FromDictionaryAuditLogs(items []dictionary.DictionaryAuditLog) []DictionaryAuditLog {
	out := make([]DictionaryAuditLog, 0, len(items))
	for _, item := range items {
		out = append(out, DictionaryAuditLog{
			ID: item.ID, DictionaryType: item.DictionaryType, Action: item.Action,
			SourceCode: item.SourceCode, TargetCode: item.TargetCode,
			ReferenceCount: item.ReferenceCount, Operator: item.Operator,
			Detail: item.Detail, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}

// FromClouds maps dictionary entries to DTOs.
func FromClouds(items []dictionary.Cloud) []Cloud {
	out := make([]Cloud, 0, len(items))
	for _, item := range items {
		out = append(out, fromCloud(item))
	}
	return out
}

// FromCloud maps one cloud dictionary entry to a DTO.
func FromCloud(item *dictionary.Cloud) Cloud {
	if item == nil {
		return Cloud{}
	}
	return fromCloud(*item)
}

func fromCloud(item dictionary.Cloud) Cloud {
	return Cloud{
		CloudCode: item.CloudCode, CloudName: item.CloudName, CloudType: item.CloudType,
		Carrier: item.Carrier, Description: item.Description, Enabled: item.Enabled,
		Status: item.Status, ReferenceCount: item.ReferenceCount, MergedInto: item.MergedInto,
	}
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
