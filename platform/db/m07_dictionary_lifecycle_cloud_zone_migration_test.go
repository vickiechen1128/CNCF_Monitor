package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3CloudZoneDictionaryLifecycle validates the 0018 schema: cloud
// and zone dictionaries gain the terminal lifecycle columns and the audit
// table's dictionary_type CHECK is widened to all five dictionary kinds.
func TestMigrateV3CloudZoneDictionaryLifecycle(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_dict_cloud_zone.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	// Terminal lifecycle columns exist on both dictionaries.
	for _, table := range []string{"cloud_dicts", "zone_types"} {
		for _, column := range []string{"merged_into", "revoked_at"} {
			var count int
			require.NoError(t, sqlDB.QueryRow(
				`SELECT count(*) FROM pragma_table_info(?) WHERE name = ?`, table, column,
			).Scan(&count))
			require.Equal(t, 1, count, "%s.%s must exist after 0018", table, column)
		}
	}

	// The audit table accepts all five dictionary types, but still rejects
	// unknown ones (the CHECK was widened, not removed).
	seed := func(dictionaryType string) error {
		_, err := sqlDB.Exec(`INSERT INTO m07_dictionary_audit_logs
			(id, dictionary_type, action, source_code) VALUES (?, ?, 'revoke', 'src')`,
			"log-"+dictionaryType, dictionaryType)
		return err
	}
	for _, dictionaryType := range []string{"business", "application", "platform", "cloud", "zone"} {
		require.NoError(t, seed(dictionaryType), "dictionary_type %q must be accepted", dictionaryType)
	}
	require.Error(t, seed("bogus"), "unknown dictionary_type must still be rejected")
}
