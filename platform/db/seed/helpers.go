package seed

import "gorm.io/gorm"

// firstOrCreate inserts out if no row matches the given query, otherwise it
// loads the existing row back into out. It is the idempotent upsert primitive
// shared by the v3 core seed steps.
func firstOrCreate(db *gorm.DB, out any, query string, args ...any) error {
	return db.Where(query, args...).FirstOrCreate(out).Error
}
