// Package seed provides idempotent upsert of the Phase 0 seed data:
// platform_admin tenant, default network domain, zone_type dictionary,
// default LabelTemplates and built-in ExporterTemplates with default
// CITypeExporterMappings, plus the initial admin user (Module_06 §5.3).
package seed

import (
	"fmt"

	"gorm.io/gorm"
)

// Run upserts all Phase 0 seed data into the given database connection. It is
// idempotent: calling it repeatedly never duplicates records and never errors.
func Run(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("seed: nil database connection")
	}

	if err := runTenantAndDomain(db); err != nil {
		return fmt.Errorf("seed tenant/domain: %w", err)
	}
	if err := runZoneTypes(db); err != nil {
		return fmt.Errorf("seed zone types: %w", err)
	}
	if err := runLabelTemplates(db); err != nil {
		return fmt.Errorf("seed label templates: %w", err)
	}
	if err := runExporters(db); err != nil {
		return fmt.Errorf("seed exporters: %w", err)
	}
	if err := runMetricLibrary(db); err != nil {
		return fmt.Errorf("seed metric library: %w", err)
	}
	if err := runAdminUser(db); err != nil {
		return fmt.Errorf("seed admin user: %w", err)
	}
	return nil
}

// firstOrCreate inserts out if no row matches the given query, otherwise it
// loads the existing row back into out. It is the idempotent upsert primitive.
func firstOrCreate(db *gorm.DB, out interface{}, query string, args ...interface{}) error {
	return db.Where(query, args...).FirstOrCreate(out).Error
}