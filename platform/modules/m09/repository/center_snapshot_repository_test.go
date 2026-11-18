package repository_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

func TestCenterSnapshotPruneKeepsNewestAndCurrent(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "center-prune.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	ctx := context.Background()

	base := time.Now().UTC()
	for i := 0; i < 8; i++ {
		_, err := repo.InsertAndActivate(ctx, repository.CenterConfigSnapshot{
			Version:          "v" + string(rune('a'+i)),
			Checksum:         "sum" + string(rune('a'+i)),
			ValidationStatus: "passed",
			ValidationCause:  "none",
			CreatedAt:        base.Add(time.Duration(i) * time.Minute),
		})
		require.NoError(t, err)
	}

	removed, err := repo.Prune(ctx, 5)
	require.NoError(t, err)
	assert.Len(t, removed, 3, "8 rows, keep 5")
	assert.ElementsMatch(t, []string{"va", "vb", "vc"}, removed)

	items, err := repo.List(ctx, 20)
	require.NoError(t, err)
	require.Len(t, items, 5)
	current, err := repo.CurrentPassed(ctx)
	require.NoError(t, err)
	require.NotNil(t, current)
	assert.True(t, current.IsCurrent)
	assert.Equal(t, "vh", current.Version)
}
