package references

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestGORMReaderListByResource(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "m07_references.db")
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&scrapeJobRecord{}))

	require.NoError(t, db.Create(&scrapeJobRecord{
		JobName: "job-a", NetworkDomainID: "mc-demo", Enabled: true,
		SelectedInstanceIDs: []string{"res-1", "res-2"},
	}).Error)
	require.NoError(t, db.Create(&scrapeJobRecord{
		JobName: "job-b", NetworkDomainID: "edge", Enabled: false,
		SelectedInstanceIDs: []string{"res-2"},
	}).Error)

	refs, err := NewGORMReader(db).ListByResource(context.Background(), "res-1")
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.Equal(t, "job-a", refs[0].JobName)
	assert.True(t, refs[0].Enabled)

	refs, err = NewGORMReader(db).ListByResource(context.Background(), "missing")
	require.NoError(t, err)
	assert.Empty(t, refs)
}
