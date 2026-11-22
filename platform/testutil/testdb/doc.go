// Package testdb is the shared PostgreSQL test-database helper.
//
// Every backend test that needs a database goes through this package: it gives
// each test its own isolated PostgreSQL schema, applies the v3 migrations, and
// drops the schema at the end. There is no SQLite path — the suite runs on the
// same dialect as production, so dialect drift (aggregate/GROUP BY, jsonb vs
// TEXT, boolean vs 0/1, …) shows up in tests instead of in production.
//
// # Prerequisites
//
// A disposable PostgreSQL database plus the DSN in METRIC_CENTER_TEST_POSTGRES_DSN:
//
//	make test-platform        # starts local PG, creates metric_center_test, sets the DSN
//
// or manually:
//
//	export METRIC_CENTER_TEST_POSTGRES_DSN='postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable'
//	go test ./platform/... -count=1
//
// Without the variable, DB-backed tests fail fast with a hint (they never fall
// back to SQLite).
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
//	    gormDB := testdb.Open(t)   // isolated PG schema + v3 migrations applied
//	    ... seed rows ...           // unchanged business logic
//	    return gormDB
//	}
//
// Open applies db.MigrateV3 for you. Keep only the fixture-specific statements
// (seed INSERTs, etc.) in the helper. Tests that need a raw *sql.DB should use
// DSN(t) instead; tests that drive migrations directly should pair
// MigrateDriver() with DSN(t).
//
// # Isolation
//
// testdb creates a schema named `test_<random>`, injects it into the DSN as
// `search_path=test_<random>`, and drops it with CASCADE in t.Cleanup. Pinning
// search_path in the DSN (rather than issuing a session-level SET) is essential:
// GORM's connection pool may open multiple connections, and a SET only applies
// to the connection that ran it. Because schemas are per-test, tests can run in
// parallel and packages no longer contend for one database.
package testdb
