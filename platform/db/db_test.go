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

func TestSharedTablesCreatedAndHealthOK(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())
	require.NotNil(t, DB)
	require.NoError(t, AutoMigrate())

	// Health reports connected on a normal connection.
	assert.NoError(t, Health())

	// Verify the Phase 0 shared tables are present in the schema.
	wantTables := []string{
		"tenants", "network_domains", "zone_types", "resource_status_mappings",
		"hosts", "databases", "middlewares", "applications", "generic_targets",
		"resource_labels", "label_templates", "ci_type_exporter_mappings",
		"exporter_templates", "scrape_jobs", "monitoring_rules",
		"config_drafts", "config_versions", "config_deployments",
		"edge_agents", "business_metrics", "blackbox_probe_configs",
	}
	for _, table := range wantTables {
		var cnt int64
		err := DB.Raw("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&cnt).Error
		require.NoError(t, err, "query table %q", table)
		assert.Equal(t, int64(1), cnt, "table %q should exist", table)
	}
}
