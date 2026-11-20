// Package db manages database connections and migrations for MetricCenter.
//
// The v3 line targets PostgreSQL in production and keeps SQLite for local
// development and fast tests.
package db

import (
	"fmt"
	"os"
	"strings"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	// defaultDriver is PostgreSQL: the production binary never links the
	// SQLite driver. SQLite remains available to tests only (see
	// sqlite_test_support_test.go), which inject a dialector factory.
	defaultDriver = "postgres"

	// PostgreSQL connection defaults. Everything except the database name is a
	// placeholder: production supplies host/port/user/password via environment,
	// because they vary per deployment. The db name defaults to metric_center
	// (shared-instance friendly) and is the only stable default.
	defaultDBHost     = "localhost"
	defaultDBPort     = "5432"
	defaultDBUser     = "postgres"
	defaultDBPassword = ""
	defaultDBName     = "metric_center"
	defaultDBSSLMode  = "disable"
)

// sqliteDialectorFactory is injected by test-only code so the runtime package
// does not import gorm.io/driver/sqlite. It is nil in every production build.
var sqliteDialectorFactory func(dsn string) gorm.Dialector

// DB is the package-level GORM database handle. It is initialized by InitV3.
var DB *gorm.DB

// DBDriver returns the configured database driver.
//
// Supported values: postgres (default, pgsql alias) and sqlite (tests only).
func DBDriver() string {
	driver := strings.ToLower(strings.TrimSpace(os.Getenv("METRIC_CENTER_DB_DRIVER")))
	if driver == "" {
		return defaultDriver
	}
	if driver == "pgsql" {
		return "postgres"
	}
	return driver
}

// DSN returns the configured database DSN.
//
// Precedence:
//  1. METRIC_CENTER_DB_DSN — a complete DSN, used verbatim (highest priority;
//     tests and custom deployments rely on this).
//  2. Segmented METRIC_CENTER_DB_HOST / PORT / USER / PASSWORD / NAME /
//     SSLMODE variables, assembled into a PostgreSQL URL. DB_NAME defaults to
//     "metric_center"; host/port/user/password have placeholder defaults and
//     are expected to be overridden in production.
func DSN() string {
	if dsn := os.Getenv("METRIC_CENTER_DB_DSN"); dsn != "" {
		return dsn
	}

	get := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}
	host := get("METRIC_CENTER_DB_HOST", defaultDBHost)
	port := get("METRIC_CENTER_DB_PORT", defaultDBPort)
	user := get("METRIC_CENTER_DB_USER", defaultDBUser)
	password := get("METRIC_CENTER_DB_PASSWORD", defaultDBPassword)
	name := get("METRIC_CENTER_DB_NAME", defaultDBName)
	sslmode := get("METRIC_CENTER_DB_SSLMODE", defaultDBSSLMode)

	userinfo := user
	if password != "" {
		userinfo += ":" + password
	}
	return fmt.Sprintf("postgres://%s@%s:%s/%s?sslmode=%s", userinfo, host, port, name, sslmode)
}

// OpenDB opens a GORM connection for the given driver.
//
// The sqlite branch exists only so the (unchanged) legacy tests can still boot
// in-memory databases. It is unreachable in production: no production file
// injects sqliteDialectorFactory, so requesting sqlite there returns an error
// and, more importantly, the production dependency graph contains no sqlite.
func OpenDB(driver, dsn string) (*gorm.DB, error) {
	switch driver {
	case "sqlite":
		if sqliteDialectorFactory == nil {
			return nil, fmt.Errorf("sqlite driver is test-only; use postgres in production builds")
		}
		// V3 migrations declare FOREIGN KEY constraints; the test-only factory
		// applies the same _foreign_keys pragma as the migration runner.
		return gorm.Open(sqliteDialectorFactory(dsn), &gorm.Config{})
	case "postgres":
		return gorm.Open(postgres.Open(dsn), &gorm.Config{})
	default:
		return nil, fmt.Errorf("unsupported database driver %q (want sqlite or postgres)", driver)
	}
}

// InitV3 opens the v3 database and applies versioned migrations.
func InitV3() error {
	driver := DBDriver()
	dsn := DSN()

	var err error
	DB, err = OpenDB(driver, dsn)
	if err != nil {
		return fmt.Errorf("failed to open v3 database %q: %w", dsn, err)
	}
	if err := MigrateV3(driver, dsn); err != nil {
		return fmt.Errorf("failed to apply v3 migrations: %w", err)
	}
	return nil
}
