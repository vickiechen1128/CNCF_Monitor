package db

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitWithEnvDSN(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())
	require.NotNil(t, DB)

	assert.NoError(t, Health())
}

func TestAutoMigrate(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())

	assert.NoError(t, AutoMigrate())
}

func TestInitDefaultPath(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "metric_center.db")
	t.Setenv("METRIC_CENTER_DB_DSN", dbPath)

	require.NoError(t, Init())
	require.NotNil(t, DB)
	assert.NoError(t, Health())

	_, err := os.Stat(dbPath)
	assert.NoError(t, err)
}

func TestHealthWithoutInit(t *testing.T) {
	// Ensure Health returns an error when DB has not been initialized.
	DB = nil
	assert.Error(t, Health())
}
