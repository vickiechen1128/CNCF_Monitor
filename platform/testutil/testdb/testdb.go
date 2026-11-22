// Package testdb provides the shared PostgreSQL test database helper.
//
// It is a test-only utility: no production code imports it, and the production
// binary's dependency graph is unaffected (see doc.go for the usage guide).
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

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// PostgresDSNEnv points at a disposable PostgreSQL database. It is required:
// the backend test suite runs on PostgreSQL only (SQLite support was removed).
const PostgresDSNEnv = "METRIC_CENTER_TEST_POSTGRES_DSN"

// testDB is the per-test setup state. It is cached by *testing.T so that a test
// calling both Open and DSN gets the same database (and a single schema).
type testDB struct {
	dsn    string
	schema string
}

var (
	setupMu sync.Mutex
	byTest  = make(map[*testing.T]*testDB)
)

// MigrateDriver returns the driver name to pass to db.MigrateV3. Kept for
// callers that drive migrations directly; it is always "postgres".
func MigrateDriver() string {
	return "postgres"
}

// DSN returns the DSN of the test database.
//
// It is the base DSN with `search_path=<isolated-schema>` appended, so every
// connection in GORM's pool resolves unqualified table names to the test's own
// schema. The DSN is stable across repeated calls with the same *testing.T, and
// the schema is dropped (CASCADE) automatically when the test finishes.
func DSN(t *testing.T) string {
	t.Helper()
	state := stateFor(t)
	if state.dsn == "" {
		state.dsn, state.schema = newPostgresSchema(t)
	}
	return state.dsn
}

// Open creates a fresh isolated PostgreSQL schema for the test, applies the v3
// migrations to it and returns a *gorm.DB bound to it.
//
// Each call gets its own schema, so a test that builds several stacks (e.g. an
// admin router and a viewer router) gets two independent databases — the same
// isolation the old per-test SQLite files provided.
func Open(t *testing.T) *gorm.DB {
	t.Helper()
	state := stateFor(t)

	dsn, schema := newPostgresSchema(t)
	state.dsn, state.schema = dsn, schema

	gormDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard, NowFunc: func() time.Time { return time.Now().UTC() }})
	if err != nil {
		t.Fatalf("testdb: open postgres database (%s): %v", dsn, err)
	}
	t.Cleanup(func() {
		if sqlDB, dbErr := gormDB.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	if err := platformdb.MigrateV3(MigrateDriver(), dsn); err != nil {
		t.Fatalf("testdb: migrate postgres schema %s: %v", schema, err)
	}
	return gormDB
}

func stateFor(t *testing.T) *testDB {
	t.Helper()
	setupMu.Lock()
	defer setupMu.Unlock()
	if existing, ok := byTest[t]; ok {
		return existing
	}
	state := &testDB{}
	byTest[t] = state
	t.Cleanup(func() {
		setupMu.Lock()
		delete(byTest, t)
		setupMu.Unlock()
	})
	return state
}

func requireBaseDSN(t *testing.T) string {
	t.Helper()
	baseDSN := strings.TrimSpace(os.Getenv(PostgresDSNEnv))
	if baseDSN == "" {
		t.Fatalf(
			"%s is required: backend tests run on PostgreSQL only.\n"+
				"  local:  make test-platform   (starts local PG and sets the DSN)\n"+
				"  manual: export %s='postgres://%s@127.0.0.1:5432/metric_center_test?sslmode=disable'",
			PostgresDSNEnv, PostgresDSNEnv, currentUser(),
		)
	}
	return baseDSN
}

func newPostgresSchema(t *testing.T) (dsn, schema string) {
	t.Helper()
	return setupPostgres(t, requireBaseDSN(t))
}

func currentUser() string {
	if u := strings.TrimSpace(os.Getenv("USER")); u != "" {
		return u
	}
	return "postgres"
}

func setupPostgres(t *testing.T, baseDSN string) (dsn, schema string) {
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

	return withSearchPath(baseDSN, schema), schema
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
