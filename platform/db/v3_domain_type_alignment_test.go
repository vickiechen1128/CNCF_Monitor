package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestV3DomainTypeCheckRejectsNonEdge locks the v3 SQLite contract: after the
// migrations, network_domains accepts only domain_type='edge'. 'management' is
// blocked by 00004's BEFORE triggers and 'collection' by the 00000 CHECK.
// Postgres is aligned to the same single value by
// 0013_m06_domain_type_alignment.postgres.sql, so both dialects reject the same
// writes (read-compat for pre-existing 'collection' rows stays in the code).
func TestV3DomainTypeCheckRejectsNonEdge(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_domain_type.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := sql.Open("sqlite3", dsn+"?_foreign_keys=on")
	require.NoError(t, err)
	defer sqlDB.Close()

	_, err = sqlDB.Exec(`INSERT INTO tenants(id, name, status) VALUES ('t', 'T', 'active')`)
	require.NoError(t, err)

	insertDomain := func(id, dtype string) error {
		_, err := sqlDB.Exec(`INSERT INTO network_domains
			(id, name, domain_type, tenant_id, status)
			VALUES (?, ?, ?, 't', 'enabled')`, id, dtype, dtype)
		return err
	}

	require.NoError(t, insertDomain("d-edge", "edge"), "edge must be accepted")
	require.Error(t, insertDomain("d-collection", "collection"), "collection must be rejected by CHECK")
	require.Error(t, insertDomain("d-management", "management"), "management must be rejected by 00004 trigger")
}
