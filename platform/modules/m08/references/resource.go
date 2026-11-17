package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	m01refs "github.com/metriccenter/metriccenter/platform/modules/m01/references"
)

// ResourceInfo is the read-only resource projection M08 needs for instance-name
// backfill (FR-25). `resource_category` doubles as the carrier for the future
// platform/app/biz aggregation (D41 → D44 deferred).
type ResourceInfo struct {
	Name     string
	Category string
}

// ResourceNamer resolves resource display names without owning M07 data.
type ResourceNamer interface {
	GetMany(ctx context.Context, resourceIDs []string) (map[string]ResourceInfo, error)
}

// M01ResourceNamer reuses M01's read-only resource reader (same joins M01 uses
// for candidates) so the instance-name rules stay consistent across modules.
type M01ResourceNamer struct {
	reader m01refs.ResourceReader
}

// NewResourceNamer constructs the namer from the shared M01 reader.
func NewResourceNamer(db *gorm.DB) *M01ResourceNamer {
	return &M01ResourceNamer{reader: m01refs.NewResourceReader(db)}
}

// GetMany implements ResourceNamer.
func (n *M01ResourceNamer) GetMany(ctx context.Context, resourceIDs []string) (map[string]ResourceInfo, error) {
	out := make(map[string]ResourceInfo, len(resourceIDs))
	if len(resourceIDs) == 0 {
		return out, nil
	}
	refs, err := n.reader.GetMany(ctx, resourceIDs)
	if err != nil {
		return nil, fmt.Errorf("read resources: %w", err)
	}
	for id, ref := range refs {
		out[id] = ResourceInfo{Name: ref.DisplayName, Category: string(ref.Category)}
	}
	return out, nil
}
