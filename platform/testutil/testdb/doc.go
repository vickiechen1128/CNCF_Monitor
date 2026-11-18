// Package testdb lets a test open the same domain database on either SQLite
// (fast default) or a local PostgreSQL instance, without changing the test's
// business logic.
//
// # Why this package exists
//
// Historically each of the ~90 *_test.go files built its own database with
// gorm.Open(sqlite.Open(dsn), ...), using a mix of in-memory and temp-file
// DSNs. That made it impossible to exercise the v3 PostgreSQL schema with the
// same tests. testdb centralises the backend choice and isolation logic; it is
// imported only by tests, so the production binary never links SQLite through
// it (go list -deps ./platform/cmd/metric-center still shows no sqlite).
//
// # Adopting in an existing test
//
// Replace a local helper such as:
//
//	func openTestDB(t *testing.T) *gorm.DB {
//	    t.Helper()
//	    dsn := filepath.Join(t.TempDir(), "m07_repository.db")
//	    require.NoError(t, db.MigrateV3("sqlite", dsn))
//	    gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{})
//	    require.NoError(t, err)
//	    ... seed rows ...
//	    return gormDB
//	}
//
// with a thin delegate:
//
//	func openTestDB(t *testing.T) *gorm.DB {
//	    t.Helper()
//	    gormDB := testdb.Open(t)   // backend chosen by env; v3 migrations applied
//	    ... seed rows ...           // unchanged business logic
//	    return gormDB
//	}
//
// Open applies db.MigrateV3 for you. Keep only the fixture-specific statements
// (seed INSERTs, etc.) in the helper. Tests that need a raw *sql.DB should use
// DSN(t) instead; tests that drive migrations directly should pair
// MigrateDriver() with DSN(t).
//
// # Switching backends
//
// Default (no env): an isolated in-memory SQLite database per test. Run as
// usual:
//
//	go test ./platform/...
//
// PostgreSQL: set the DSN env var; every test then gets its own schema:
//
//	METRIC_CENTER_TEST_POSTGRES_DSN='postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable' \
//	  go test ./platform/... -count=1
//
// On the PostgreSQL path testdb creates a schema named `test_<random>`,
// injects it into the DSN as `search_path=test_<random>`, and drops it with
// CASCADE in t.Cleanup. Pinning search_path in the DSN (rather than issuing a
// session-level SET) is essential: GORM's connection pool may open multiple
// connections, and a SET only applies to the connection that ran it.
//
// # Scope
//
// Migration of all existing test files is intentionally incremental. A few
// representative repository tests have been converted; the rest can be moved
// one helper at a time with the mechanical change shown above.
package testdb
