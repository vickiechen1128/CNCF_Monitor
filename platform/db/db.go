// Package db manages PostgreSQL connections and v3 migrations for MetricCenter.
package db

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	// defaultDriver is PostgreSQL: it is the only supported database.
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

// utcNow keeps GORM-managed timestamps (created_at / updated_at) in UTC.
// The v3 schema uses TIMESTAMP WITHOUT TIME ZONE; writing a local time there
// makes the value shift by the server's UTC offset when it is read back (pgx
// interprets timestamp columns as UTC).
func utcNow() time.Time { return time.Now().UTC() }

// DB is the package-level GORM database handle. It is initialized by InitV3.
var DB *gorm.DB

// DBDriver returns the configured database driver.
//
// Supported values: postgres (default, pgsql alias).
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

// OpenDB opens a GORM connection (PostgreSQL only).
func OpenDB(driver, dsn string) (*gorm.DB, error) {
	if driver != "postgres" {
		return nil, fmt.Errorf("unsupported database driver %q (only postgres is supported)", driver)
	}
	return gorm.Open(postgres.Open(dsn), &gorm.Config{NowFunc: utcNow})
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
