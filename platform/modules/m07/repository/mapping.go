package repository

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func toResourceRecord(r *domain.Resource) *resourceRecord {
	return &resourceRecord{
		ResourceID:       r.ResourceID,
		ResourceCategory: string(r.Category),
		TenantID:         r.TenantID,
		NetworkDomainID:  r.NetworkDomainID,
		BizCode:          stringPtr(r.BizCode),
		AppCode:          stringPtr(r.AppCode),
		PlatformCode:     stringPtr(r.PlatformCode),
		Env:              string(r.Env),
		Cluster:          stringPtr(r.Cluster),
		Owner:            stringPtr(r.Owner),
		Status:           string(r.Status),
		SourceType:       string(r.SourceType),
		ScrapePort:       r.ScrapePort,
		DedupKey:         r.DedupKey,
	}
}

func toExtensionRecord(category domain.Category, resourceID string, attrs domain.Attributes) (any, error) {
	switch category {
	case domain.CategoryHost:
		a, ok := attrs.(domain.HostAttributes)
		if !ok {
			return nil, fmt.Errorf("host attributes type mismatch")
		}
		return &hostRecord{
			ResourceID:  resourceID,
			Hostname:    a.Hostname,
			InstanceIP:  a.InstanceIP,
			OSType:      a.OSType,
			OSVersion:   stringPtr(a.OSVersion),
			ActivatedAt: a.ActivatedAt,
		}, nil
	case domain.CategoryDatabase:
		a, ok := attrs.(domain.DatabaseAttributes)
		if !ok {
			return nil, fmt.Errorf("database attributes type mismatch")
		}
		return &databaseRecord{
			ResourceID:          resourceID,
			DatabaseType:        a.DatabaseType,
			InstanceIP:          a.InstanceIP,
			Port:                a.Port,
			Version:             stringPtr(a.Version),
			ConnectionSecretRef: stringPtr(a.ConnectionSecretRef),
		}, nil
	case domain.CategoryMiddleware:
		a, ok := attrs.(domain.MiddlewareAttributes)
		if !ok {
			return nil, fmt.Errorf("middleware attributes type mismatch")
		}
		return &middlewareRecord{
			ResourceID:          resourceID,
			MiddlewareType:      a.MiddlewareType,
			InstanceIP:          a.InstanceIP,
			Port:                a.Port,
			Version:             stringPtr(a.Version),
			ConnectionSecretRef: stringPtr(a.ConnectionSecretRef),
		}, nil
	case domain.CategoryApplication:
		a, ok := attrs.(domain.ApplicationAttributes)
		if !ok {
			return nil, fmt.Errorf("application attributes type mismatch")
		}
		return &applicationRecord{
			ResourceID:       resourceID,
			ServiceName:      a.ServiceName,
			HealthCheckURL:   a.HealthCheckURL,
			Protocol:         stringPtr(a.Protocol),
			Endpoint:         stringPtr(a.Endpoint),
			Port:             a.Port,
			Owner1:           stringPtr(a.Owner1),
			Owner1Contact:    stringPtr(a.Owner1Contact),
			Owner2:           stringPtr(a.Owner2),
			Owner2Contact:    stringPtr(a.Owner2Contact),
			OpsPerson:        stringPtr(a.OpsPerson),
			OpsPersonContact: stringPtr(a.OpsPersonContact),
			GoLiveAt:         a.GoLiveAt,
		}, nil
	case domain.CategoryGenericTarget:
		a, ok := attrs.(domain.GenericTargetAttributes)
		if !ok {
			return nil, fmt.Errorf("generic_target attributes type mismatch")
		}
		return &genericTargetRecord{
			ResourceID:   resourceID,
			TargetName:   a.TargetName,
			InstanceIP:   a.InstanceIP,
			Port:         a.Port,
			MetricsPath:  stringPtr(a.MetricsPath),
			Scheme:       stringPtr(a.Scheme),
			ExporterType: stringPtr(a.ExporterType),
		}, nil
	case domain.CategoryInterfaceService:
		a, ok := attrs.(domain.InterfaceServiceAttributes)
		if !ok {
			return nil, fmt.Errorf("interface_service attributes type mismatch")
		}
		return &interfaceServiceRecord{
			ResourceID: resourceID,
			APIName:    a.APIName,
			APIURL:     a.APIURL,
		}, nil
	default:
		return nil, &domain.UnsupportedCategoryError{Category: string(category)}
	}
}

func fromResourceRecord(base *resourceRecord, ext any) (*domain.Resource, error) {
	category := domain.Category(base.ResourceCategory)
	if !category.Valid() {
		return nil, &domain.UnsupportedCategoryError{Category: base.ResourceCategory}
	}
	r := &domain.Resource{
		ResourceID:      base.ResourceID,
		Category:        category,
		TenantID:        base.TenantID,
		NetworkDomainID: base.NetworkDomainID,
		BizCode:         derefString(base.BizCode),
		AppCode:         derefString(base.AppCode),
		PlatformCode:    derefString(base.PlatformCode),
		Env:             domain.Environment(base.Env),
		Cluster:         derefString(base.Cluster),
		Owner:           derefString(base.Owner),
		Status:          domain.Status(base.Status),
		SourceType:      domain.SourceType(base.SourceType),
		ScrapePort:      base.ScrapePort,
		DedupKey:        base.DedupKey,
		CreatedAt:       base.CreatedAt,
		UpdatedAt:       base.UpdatedAt,
	}

	switch category {
	case domain.CategoryHost:
		rec, ok := ext.(*hostRecord)
		if !ok || rec == nil {
			return nil, fmt.Errorf("host extension missing for %s", base.ResourceID)
		}
		r.Attributes = domain.HostAttributes{
			Hostname:    rec.Hostname,
			InstanceIP:  rec.InstanceIP,
			OSType:      rec.OSType,
			OSVersion:   derefString(rec.OSVersion),
			ActivatedAt: rec.ActivatedAt,
		}
	case domain.CategoryDatabase:
		rec, ok := ext.(*databaseRecord)
		if !ok || rec == nil {
			return nil, fmt.Errorf("database extension missing for %s", base.ResourceID)
		}
		r.Attributes = domain.DatabaseAttributes{
			DatabaseType:        rec.DatabaseType,
			InstanceIP:          rec.InstanceIP,
			Port:                rec.Port,
			Version:             derefString(rec.Version),
			ConnectionSecretRef: derefString(rec.ConnectionSecretRef),
		}
	case domain.CategoryMiddleware:
		rec, ok := ext.(*middlewareRecord)
		if !ok || rec == nil {
			return nil, fmt.Errorf("middleware extension missing for %s", base.ResourceID)
		}
		r.Attributes = domain.MiddlewareAttributes{
			MiddlewareType:      rec.MiddlewareType,
			InstanceIP:          rec.InstanceIP,
			Port:                rec.Port,
			Version:             derefString(rec.Version),
			ConnectionSecretRef: derefString(rec.ConnectionSecretRef),
		}
	case domain.CategoryApplication:
		rec, ok := ext.(*applicationRecord)
		if !ok || rec == nil {
			return nil, fmt.Errorf("application extension missing for %s", base.ResourceID)
		}
		r.Attributes = domain.ApplicationAttributes{
			ServiceName:      rec.ServiceName,
			HealthCheckURL:   rec.HealthCheckURL,
			Protocol:         derefString(rec.Protocol),
			Endpoint:         derefString(rec.Endpoint),
			Port:             rec.Port,
			Owner1:           derefString(rec.Owner1),
			Owner1Contact:    derefString(rec.Owner1Contact),
			Owner2:           derefString(rec.Owner2),
			Owner2Contact:    derefString(rec.Owner2Contact),
			OpsPerson:        derefString(rec.OpsPerson),
			OpsPersonContact: derefString(rec.OpsPersonContact),
			GoLiveAt:         rec.GoLiveAt,
		}
	case domain.CategoryGenericTarget:
		rec, ok := ext.(*genericTargetRecord)
		if !ok || rec == nil {
			return nil, fmt.Errorf("generic_target extension missing for %s", base.ResourceID)
		}
		r.Attributes = domain.GenericTargetAttributes{
			TargetName:   rec.TargetName,
			InstanceIP:   rec.InstanceIP,
			Port:         rec.Port,
			MetricsPath:  derefString(rec.MetricsPath),
			Scheme:       derefString(rec.Scheme),
			ExporterType: derefString(rec.ExporterType),
		}
	case domain.CategoryInterfaceService:
		rec, ok := ext.(*interfaceServiceRecord)
		if !ok || rec == nil {
			return nil, fmt.Errorf("interface_service extension missing for %s", base.ResourceID)
		}
		r.Attributes = domain.InterfaceServiceAttributes{
			APIName: rec.APIName,
			APIURL:  rec.APIURL,
		}
	}
	return r, nil
}
