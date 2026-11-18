// Package repository contains the v3 M07 persistence adapters.
package repository

import (
	"context"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"gorm.io/gorm"
)

// ListFilter is the repository-level resource list filter.
type ListFilter struct {
	Category        domain.Category
	NetworkDomainID string
	BizCode         string
	AppCode         string
	PlatformCode    string
	Status          domain.Status
	Keyword         string
	Page            int
	PageSize        int
}

// ResourceRepository persists the resource aggregate.
type ResourceRepository interface {
	Create(ctx context.Context, resource *domain.Resource) error
	Get(ctx context.Context, resourceID string) (*domain.Resource, error)
	GetMany(ctx context.Context, resourceIDs []string) ([]*domain.Resource, error)
	List(ctx context.Context, filter ListFilter) ([]*domain.Resource, int64, error)
	Update(ctx context.Context, resource *domain.Resource) error
	SoftDelete(ctx context.Context, resourceID string) error
	FindByDedupKey(ctx context.Context, tenantID string, category domain.Category, dedupKey string) (*domain.Resource, bool, error)
	// BulkReassign moves one reference column for every listed resource in a
	// single transaction (M07 SRS v2.0 FR-28 / NFR-19).
	BulkReassign(ctx context.Context, input BulkReassignInput) (int64, error)
	// BulkSetScrapePort sets the instance-level scrape port (采集端口) for every
	// listed resource in one statement (M07 端口收敛：实例级为唯一入口).
	BulkSetScrapePort(ctx context.Context, resourceIDs []string, scrapePort int) (int64, error)
}

// BulkReassignInput describes one atomic reference reassignment.
type BulkReassignInput struct {
	ResourceIDs []string
	// Field is one of biz_code / app_code / platform_code.
	Field      string
	TargetCode string
	// DerivedPlatformCode replaces platform_code on composed resources
	// (application / interface_service). Only used when Field == "app_code":
	// their platform must follow the target app's primary platform (D43).
	DerivedPlatformCode string
}

// GORMRepository is the GORM-backed ResourceRepository.
type GORMRepository struct {
	db *gorm.DB
}

// NewGORMRepository constructs a repository.
func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}
