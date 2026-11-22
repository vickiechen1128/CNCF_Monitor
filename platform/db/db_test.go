package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitV3Postgres(t *testing.T) {
	dsn := testPostgresDSN(t)
	t.Setenv("METRIC_CENTER_DB_DRIVER", "postgres")
	t.Setenv("METRIC_CENTER_DB_DSN", dsn)

	require.NoError(t, InitV3())
	require.NotNil(t, DB)

	var cnt int64
	require.NoError(t, DB.Raw(
		`SELECT count(*) FROM information_schema.tables
		 WHERE table_schema = current_schema() AND table_name = 'resources'`,
	).Scan(&cnt).Error)
	assert.EqualValues(t, 1, cnt, "v3 resources table should exist")
}
