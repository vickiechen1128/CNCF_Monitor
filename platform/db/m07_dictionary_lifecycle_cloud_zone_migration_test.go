package db

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3CloudZoneDictionaryLifecycle validates the 0018 schema: cloud
// and zone dictionaries gain the terminal lifecycle columns and the audit
// table's dictionary_type CHECK is widened to all five dictionary kinds.
func TestMigrateV3CloudZoneDictionaryLifecycle(t *testing.T) {
	dsn := testPostgresDSN(t)
	require.NoError(t, MigrateV3("postgres", dsn))

	sqlDB := openTestSQL(t, dsn)

	// Terminal lifecycle columns exist on both dictionaries.
	for _, table := range []string{"cloud_dicts", "zone_types"} {
		for _, column := range []string{"merged_into", "revoked_at"} {
			requireColumnCount(t, sqlDB, table, column, 1)
		}
	}

	// The audit table accepts all five dictionary types, but still rejects
	// unknown ones (the CHECK was widened, not removed).
	seed := func(dictionaryType string) error {
		_, err := sqlDB.Exec(`INSERT INTO m07_dictionary_audit_logs
			(id, dictionary_type, action, source_code) VALUES ($1, $2, 'revoke', 'src')`,
			"log-"+dictionaryType, dictionaryType)
		return err
	}
	for _, dictionaryType := range []string{"business", "application", "platform", "cloud", "zone"} {
		require.NoError(t, seed(dictionaryType), "dictionary_type %q must be accepted", dictionaryType)
	}
	require.Error(t, seed("bogus"), "unknown dictionary_type must still be rejected")
}
