package seed

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newTestDB opens an isolated PostgreSQL schema (no v3 migrations) so the seed
// tests can AutoMigrate the models they exercise.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormDB, err := gorm.Open(postgres.Open(testdb.DSN(t)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, gormDB.AutoMigrate(
		&models.Tenant{},
		&models.User{},
		&models.CloudDict{},
		&models.BusinessDomain{},
		&models.NetworkDomain{},
		&models.ApplicationDict{},
		&models.AppPlatformRel{},
	))
	return gormDB
}

func countRows(t *testing.T, db *gorm.DB, model any, out *int64) {
	t.Helper()
	require.NoError(t, db.Model(model).Count(out).Error)
}
