package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitV3SQLite(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_init.db")
	t.Setenv("METRIC_CENTER_DB_DRIVER", "sqlite")
	t.Setenv("METRIC_CENTER_DB_DSN", dsn)

	require.NoError(t, InitV3())
	require.NotNil(t, DB)

	var cnt int64
	require.NoError(t, DB.Raw(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='resources'`,
	).Scan(&cnt).Error)
	assert.EqualValues(t, 1, cnt, "v3 resources table should exist")
}
