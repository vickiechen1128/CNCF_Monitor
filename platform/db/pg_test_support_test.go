package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// This file holds the PostgreSQL-only test scaffolding for the db package.
//
// Every test gets its own schema (search_path) so tests and packages can run in
// parallel against one disposable database: the migration bookkeeping table is
// created in current_schema(), so no two tests share state.

// testPostgresDSN returns a DSN pinned to a freshly created schema for one test.
// The schema is dropped (CASCADE) when the test finishes.
func testPostgresDSN(t *testing.T) string {
	t.Helper()

	base := strings.TrimSpace(os.Getenv("METRIC_CENTER_TEST_POSTGRES_DSN"))
	if base == "" {
		t.Fatalf("METRIC_CENTER_TEST_POSTGRES_DSN is required: backend tests run on PostgreSQL only.\n" +
			"  local: make test-platform   (starts local PostgreSQL and sets the DSN)")
	}

	schema := "dbtest_" + randomHex(6)
	admin, err := sql.Open("pgx", base)
	require.NoError(t, err)
	_, err = admin.Exec(`CREATE SCHEMA ` + quoteIdent(schema))
	require.NoError(t, err)
	require.NoError(t, admin.Close())

	t.Cleanup(func() {
		cleanup, err := sql.Open("pgx", base)
		if err != nil {
			t.Errorf("open connection to drop schema %s: %v", schema, err)
			return
		}
		defer cleanup.Close()
		if _, err := cleanup.Exec(`DROP SCHEMA IF EXISTS ` + quoteIdent(schema) + ` CASCADE`); err != nil {
			t.Errorf("drop schema %s: %v", schema, err)
		}
	})

	return testWithSearchPath(base, schema)
}

// openTestSQL opens a normal (extended-protocol) connection to the test schema
// so queries can bind parameters. Migrations themselves must go through
// openMigrationDB / MigrateV3, which use the simple protocol.
func openTestSQL(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	sqlDB, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(2)
	require.NoError(t, sqlDB.Ping())
	t.Cleanup(func() { _ = sqlDB.Close() })
	return sqlDB
}

// requireTableCount asserts whether a table exists in the test schema (want is
// 0 or 1).
func requireTableCount(t *testing.T, sqlDB *sql.DB, table string, want int) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM information_schema.tables
		 WHERE table_schema = current_schema() AND table_name = $1`, table,
	).Scan(&count))
	require.Equal(t, want, count, "table %s", table)
}

// requireColumnCount asserts whether a column exists on a table in the test
// schema (want is 0 or 1).
func requireColumnCount(t *testing.T, sqlDB *sql.DB, table, column string, want int) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
		table, column,
	).Scan(&count))
	require.Equal(t, want, count, "column %s.%s", table, column)
}

// requireIndexCount asserts whether an index exists in the test schema.
func requireIndexCount(t *testing.T, sqlDB *sql.DB, index string, want int) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM pg_indexes
		 WHERE schemaname = current_schema() AND indexname = $1`, index,
	).Scan(&count))
	require.Equal(t, want, count, "index %s", index)
}

// rollbackV3To rolls back the newest applied migrations until `target` is the
// latest applied version (or the DB has no applied migrations). Fixed-step
// rollback chains in the tests below assume 00012 is the newest migration; new
// migrations are skipped by version target instead of counting steps.
func rollbackV3To(t *testing.T, dsn string, target int64) {
	t.Helper()
	for {
		statuses, err := V3MigrationStatus("postgres", dsn)
		require.NoError(t, err)
		newest := int64(-1)
		for _, s := range statuses {
			if s.Applied && s.Version > newest {
				newest = s.Version
			}
		}
		if newest <= target {
			return
		}
		require.NoError(t, MigrateV3Down("postgres", dsn), "rollback to version %d", target)
	}
}

var testSearchPathParam = regexp.MustCompile(`(?:^|\s)search_path\s*=\s*(?:'[^']*'|"[^"]*"|\S+)`)

// testWithSearchPath appends (or replaces) the search_path connection parameter.
func testWithSearchPath(dsn, schema string) string {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		if u, err := url.Parse(dsn); err == nil {
			q := u.Query()
			q.Set("search_path", schema)
			u.RawQuery = q.Encode()
			return u.String()
		}
	}
	cleaned := testSearchPathParam.ReplaceAllString(dsn, "")
	return strings.TrimSpace(cleaned) + " search_path=" + schema
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}
