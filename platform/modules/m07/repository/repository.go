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
	List(ctx context.Context, filter ListFilter) ([]*domain.Resource, int64, error)
	Update(ctx context.Context, resource *domain.Resource) error
	SoftDelete(ctx context.Context, resourceID string) error
	FindByDedupKey(ctx context.Context, category domain.Category, dedupKey string) (*domain.Resource, bool, error)
}

// GORMRepository is the GORM-backed ResourceRepository.
type GORMRepository struct {
	db *gorm.DB
}

// NewGORMRepository constructs a repository.
func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}
