// Package testdb provides a shared test database helper.
//
// It is a test-only utility: no production code imports it, and the production
// binary's dependency graph is unaffected (see doc.go for the migration guide).
package testdb

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // register the "pgx" database/sql driver
	_ "github.com/mattn/go-sqlite3"    // register the "sqlite3" driver (also used by MigrateV3)

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// PostgresDSNEnv selects the PostgreSQL backend. When unset (or empty) the
// helper uses an isolated in-memory SQLite database, keeping the fast default
// path unchanged.
const PostgresDSNEnv = "METRIC_CENTER_TEST_POSTGRES_DSN"

// testDB is the per-test setup state. It is cached by *testing.T so that a test
// calling both Open and DSN gets the same database (and a single schema).
type testDB struct {
	driver     string
	dsn        string
	migrateDSN string  // PostgreSQL only: search_path includes public (see below)
	schema     string  // PostgreSQL only: the isolated schema name
	keeper     *sql.DB // SQLite only: keeps the shared in-memory database alive
}

var (
	setupMu sync.Mutex
	byTest  = make(map[*testing.T]*testDB)
)

// MigrateDriver returns the driver name to pass to db.MigrateV3 for the
// currently selected backend: "postgres" when PostgresDSNEnv is set,
// "sqlite" otherwise.
func MigrateDriver() string {
	if strings.TrimSpace(os.Getenv(PostgresDSNEnv)) != "" {
		return "postgres"
	}
	return "sqlite"
}

// DSN returns the DSN of the test database for the current backend.
//
// For SQLite this is a unique in-memory URI (`file:testdb_<id>?mode=memory&
// cache=shared&_foreign_keys=on`). For PostgreSQL it is the base DSN with
// `search_path=<isolated-schema>` appended, so every connection in GORM's pool
// resolves unqualified table names to the test's own schema.
//
// The DSN is stable across repeated calls with the same *testing.T, and the
// database is torn down automatically when the test finishes.
func DSN(t *testing.T) string {
	t.Helper()
	return setup(t).dsn
}

// Open opens (and migrates) a database for the test.
//
// Default backend is an isolated in-memory SQLite database. Set
// METRIC_CENTER_TEST_POSTGRES_DSN to run against PostgreSQL instead; in that
// mode each test gets its own schema (e.g. `test_4f1c...`) referenced via the
// DSN's `search_path` parameter, which is dropped (CASCADE) at test end.
//
// Open applies the v3 migrations via db.MigrateV3 so callers get a ready-to-use
// schema. It returns a *gorm.DB whose underlying sql.DB is closed at test end.
func Open(t *testing.T) *gorm.DB {
	t.Helper()
	state := setup(t)

	var dialector gorm.Dialector
	switch state.driver {
	case "postgres":
		dialector = postgres.Open(state.dsn)
	default:
		dialector = sqlite.Open(state.dsn)
	}
	gormDB, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("testdb: open %s database (%s): %v", state.driver, state.dsn, err)
	}
	t.Cleanup(func() {
		if sqlDB, dbErr := gormDB.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	if state.driver != "postgres" {
		// A shared-cache in-memory SQLite DB returns SQLITE_LOCKED (not BUSY)
		// for concurrent writers, which _busy_timeout cannot paper over.
		// Serialising the pool preserves the single-writer semantics the old
		// temp-file helpers provided for concurrency tests.
		if sqlDB, dbErr := gormDB.DB(); dbErr == nil {
			sqlDB.SetMaxOpenConns(1)
			sqlDB.SetMaxIdleConns(1)
		}
	}

	// Migrate with the schema-qualified DSN. On PostgreSQL this DSN keeps
	// `public` in the search path as a fallback: db.migrationChecksumColumnExists
	// hardcodes `table_schema='public'` when probing schema_migrations, so the
	// bookkeeping table must exist there. See ensureMigrationBookkeeping.
	if err := platformdb.MigrateV3(state.driver, state.migrateDSN); err != nil {
		t.Fatalf("testdb: migrate %s database: %v", state.driver, err)
	}
	return gormDB
}

func setup(t *testing.T) *testDB {
	t.Helper()

	setupMu.Lock()
	existing, ok := byTest[t]
	setupMu.Unlock()
	if ok {
		return existing
	}

	state := &testDB{driver: MigrateDriver()}
	if state.driver == "postgres" {
		state.dsn, state.migrateDSN, state.schema = setupPostgres(t, os.Getenv(PostgresDSNEnv))
	} else {
		state.dsn, state.keeper = setupSQLite(t)
		state.migrateDSN = state.dsn
	}

	setupMu.Lock()
	byTest[t] = state
	setupMu.Unlock()
	t.Cleanup(func() {
		setupMu.Lock()
		delete(byTest, t)
		setupMu.Unlock()
	})
	return state
}

func setupSQLite(t *testing.T) (string, *sql.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:testdb_%s?mode=memory&cache=shared&_foreign_keys=on&_busy_timeout=5000", randomSuffix())
	keeper, err := sql.Open("sqlite3", dsn)
	if err != nil {
		t.Fatalf("testdb: open sqlite keeper: %v", err)
	}
	keeper.SetMaxOpenConns(1)
	keeper.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = keeper.Close() })
	return dsn, keeper
}

func setupPostgres(t *testing.T, baseDSN string) (dsn, migrateDSN, schema string) {
	t.Helper()
	schema = "test_" + randomSuffix()

	admin, err := sql.Open("pgx", baseDSN)
	if err != nil {
		t.Fatalf("testdb: open postgres admin connection: %v", err)
	}
	defer admin.Close()

	if _, err := admin.ExecContext(t.Context(), "CREATE SCHEMA "+quoteIdent(schema)); err != nil {
		t.Fatalf("testdb: create schema %s: %v", schema, err)
	}

	// db.MigrateV3 probes schema_migrations via information_schema with a
	// hardcoded table_schema='public'. Make sure that table exists (with the
	// checksum column) so the probe is a no-op; the real bookkeeping table used
	// by the isolated migration run lives in the test schema via search_path.
	ensureMigrationBookkeeping(t, admin)

	t.Cleanup(func() {
		cleanup, err := sql.Open("pgx", baseDSN)
		if err != nil {
			t.Errorf("testdb: open connection to drop schema %s: %v", schema, err)
			return
		}
		defer cleanup.Close()
		if _, err := cleanup.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+quoteIdent(schema)+" CASCADE"); err != nil {
			t.Errorf("testdb: drop schema %s: %v", schema, err)
		}
	})

	return withSearchPath(baseDSN, schema), withSearchPath(baseDSN, schema+", public"), schema
}

func ensureMigrationBookkeeping(t *testing.T, admin *sql.DB) {
	t.Helper()
	_, err := admin.ExecContext(t.Context(), `
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL DEFAULT '',
			applied_at TIMESTAMPTZ NOT NULL
		)`)
	if err != nil {
		t.Fatalf("testdb: ensure public.schema_migrations: %v", err)
	}
	// Older runs may have created the table without the checksum column; add it
	// so migrationChecksumColumnExists returns true and skips its own ALTER.
	_, err = admin.ExecContext(t.Context(), `
		ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT NOT NULL DEFAULT ''`)
	if err != nil {
		t.Fatalf("testdb: ensure public.schema_migrations.checksum: %v", err)
	}
}

// withSearchPath appends (or replaces) the search_path connection parameter.
// Both URL and keyword/value DSN forms are supported. pgx forwards search_path
// as a startup parameter, so every pooled connection observes the same schema.
func withSearchPath(dsn, schema string) string {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		if u, err := url.Parse(dsn); err == nil {
			q := u.Query()
			q.Set("search_path", schema)
			u.RawQuery = q.Encode()
			return u.String()
		}
	}
	cleaned := searchPathParam.ReplaceAllString(dsn, "")
	return strings.TrimSpace(cleaned) + " search_path=" + schema
}

var searchPathParam = regexp.MustCompile(`(?:^|\s)search_path\s*=\s*(?:'[^']*'|"[^"]*"|\S+)`)

// quoteIdent quotes a PostgreSQL identifier (schema names generated here are
// plain lowercase + digits, but quoting keeps the helper robust).
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func randomSuffix() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is exceptional; a time-based fallback keeps tests
		// usable and remains unique at nanosecond resolution in practice.
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
