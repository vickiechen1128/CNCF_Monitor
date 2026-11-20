package seed

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// testDBSeq keeps each call to newTestDB on a fresh, isolated in-memory
// database so tests never pollute one another via the shared cache DSN.
var testDBSeq int64

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&testDBSeq, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:seed_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.User{},
		&models.CloudDict{},
		&models.BusinessDomain{},
		&models.NetworkDomain{},
		&models.ApplicationDict{},
		&models.AppPlatformRel{},
	))
	return db
}

func countRows(t *testing.T, db *gorm.DB, model any, out *int64) {
	t.Helper()
	require.NoError(t, db.Model(model).Count(out).Error)
}
