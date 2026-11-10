// Package references provides read-only cross-module adapters for M07.
package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// JobReference is a read-only ScrapeJob reference.
type JobReference struct {
	JobName         string
	NetworkDomainID string
	Enabled         bool
}

// Reader lists ScrapeJobs that reference a resource.
type Reader interface {
	ListByResource(ctx context.Context, resourceID string) ([]JobReference, error)
}

// GORMReader reads the M01-owned scrape_jobs table without taking ownership.
type GORMReader struct {
	db *gorm.DB
}

// NewGORMReader constructs a read-only reference reader.
func NewGORMReader(db *gorm.DB) *GORMReader {
	return &GORMReader{db: db}
}

type scrapeJobRecord struct {
	JobName             string   `gorm:"column:job_name"`
	NetworkDomainID     string   `gorm:"column:network_domain_id"`
	Enabled             bool     `gorm:"column:enabled"`
	SelectedInstanceIDs []string `gorm:"column:selected_instance_ids;serializer:json"`
}

func (scrapeJobRecord) TableName() string { return "scrape_jobs" }

// ListByResource returns all non-soft-deleted jobs whose selected instances
// contain resourceID.
func (r *GORMReader) ListByResource(ctx context.Context, resourceID string) ([]JobReference, error) {
	var jobs []scrapeJobRecord
	if err := r.db.WithContext(ctx).Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("list scrape jobs: %w", err)
	}
	out := make([]JobReference, 0)
	for _, job := range jobs {
		if contains(job.SelectedInstanceIDs, resourceID) {
			out = append(out, JobReference{
				JobName:         job.JobName,
				NetworkDomainID: job.NetworkDomainID,
				Enabled:         job.Enabled,
			})
		}
	}
	return out, nil
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
