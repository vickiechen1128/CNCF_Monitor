package db

import (
	"os"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// This file is the ONLY place in the db package that links the SQLite driver.
// It is a _test.go file, so neither `go build ./platform/...` nor
// `go list -deps ./platform/cmd/metric-center` sees it. Production defaults to
// PostgreSQL; the tests below keep the unchanged legacy SQLite test suite
// working by (a) registering the "sqlite3" database/sql driver and (b)
// providing the dialector factory used by OpenDB's test-only branch.
func init() {
	sqliteDialectorFactory = func(dsn string) gorm.Dialector {
		return sqlite.Open(sqliteDSNWithForeignKeys(dsn))
	}
	// The legacy Init() tests use SQLite DSNs without setting the driver env.
	// With postgres now the production default, force sqlite for this test
	// binary unless a test sets the variable explicitly.
	if os.Getenv("METRIC_CENTER_DB_DRIVER") == "" {
		_ = os.Setenv("METRIC_CENTER_DB_DRIVER", "sqlite")
	}
}
