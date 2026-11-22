package db

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestV3DomainTypeCheckRejectsNonEdge locks the v3 contract: after the
// migrations network_domains accepts only domain_type='edge'. 'management' is
// replaced by 00004 (which rewrites historical rows to edge) and 'collection'
// by the 0013 alignment migration.
func TestV3DomainTypeCheckRejectsNonEdge(t *testing.T) {
	dsn := testPostgresDSN(t)
	require.NoError(t, MigrateV3("postgres", dsn))
	sqlDB := openTestSQL(t, dsn)

	_, err := sqlDB.Exec(`INSERT INTO tenants(id, name, status) VALUES ('t', 'T', 'active')`)
	require.NoError(t, err)

	insertDomain := func(id, dtype string) error {
		_, err := sqlDB.Exec(`INSERT INTO network_domains
			(id, name, domain_type, tenant_id, status)
			VALUES ($1, $2, $3, 't', 'enabled')`, id, dtype, dtype)
		return err
	}

	require.NoError(t, insertDomain("d-edge", "edge"), "edge must be accepted")
	require.Error(t, insertDomain("d-collection", "collection"), "collection must be rejected by CHECK")
	require.Error(t, insertDomain("d-management", "management"), "management must be rejected by CHECK")
}
