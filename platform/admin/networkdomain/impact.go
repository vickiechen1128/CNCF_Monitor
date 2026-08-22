package networkdomain

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DomainImpact reports how much active data references a network domain: the
// number of M07 resources and the number of managed (non-offline) EdgeAgents.
// It is returned when disabling a domain and reused as the delete precondition.
type DomainImpact struct {
	ResourceCount         int64 `json:"resource_count"`
	ManagedEdgeAgentCount int64 `json:"managed_edge_agent_count"`
}

// resourceModels lists the five M07 resource tables that reference a network
// domain through their network_domain_id column.
var resourceModels = []interface{}{
	&models.Host{},
	&models.Database{},
	&models.Middleware{},
	&models.Application{},
	&models.GenericTarget{},
}

// countResources sums the rows referencing domainID across the five resource
// tables. Soft-deleted rows are excluded automatically (gorm.DeletedAt).
func countResources(db *gorm.DB, domainID string) (int64, error) {
	var total int64
	for _, m := range resourceModels {
		var n int64
		if err := db.Model(m).Where("network_domain_id = ?", domainID).Count(&n).Error; err != nil {
			return 0, fmt.Errorf("count resource for domain %q: %w", domainID, err)
		}
		total += n
	}
	return total, nil
}

// countManagedEdgeAgents counts EdgeAgents of a domain that are not offline
// (status in online/unknown), i.e. deemed "managed".
func countManagedEdgeAgents(db *gorm.DB, domainID string) (int64, error) {
	var n int64
	if err := db.Model(&models.EdgeAgent{}).
		Where("network_domain_id = ?", domainID).
		Where("status IN ?", []string{"online", "unknown"}).
		Count(&n).Error; err != nil {
		return 0, fmt.Errorf("count managed edge agents for domain %q: %w", domainID, err)
	}
	return n, nil
}

// ComputeImpact returns the current impact scope of a network domain.
func ComputeImpact(db *gorm.DB, domainID string) (*DomainImpact, error) {
	resources, err := countResources(db, domainID)
	if err != nil {
		return nil, err
	}
	agents, err := countManagedEdgeAgents(db, domainID)
	if err != nil {
		return nil, err
	}
	return &DomainImpact{ResourceCount: resources, ManagedEdgeAgentCount: agents}, nil
}
