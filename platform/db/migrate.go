// Package db provides the v3 schema migration entry points.
//
// v3 migrations are intentionally isolated from the legacy `migrations/` files:
// the legacy files were written against an AutoMigrate baseline and are not
// replayable on an empty database. New v2.0 schema changes live in
// `migrations/v3/`.
//
// The runner is deliberately small and supports SQLite (dev/test) and
// PostgreSQL (v3 production). It understands the `-- +goose Up` /
// `-- +goose Down` markers used by the migration files, so the files stay
// compatible with goose if the project adopts it later.
//
// Dialect-specific files use a `<version>_<name>.<dialect>.sql` suffix
// (`.sqlite.sql` / `.postgres.sql`) and are only loaded for that driver. This
// keeps DB-specific DDL (e.g. auto-increment primary keys) explicit instead of
// hiding dialect branches inside one file.
package db

import (
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/mattn/go-sqlite3"
)

// V3MigrationsDir is the embedded directory containing v3 SQL migrations.
const V3MigrationsDir = "migrations/v3"

//go:embed migrations/v3/*.sql
var v3Migrations embed.FS

type migration struct {
	version  int64
	name     string
	up       string
	down     string
	checksum string
}

type appliedMigration struct {
	checksum  string
	appliedAt time.Time
}

// MigrationStatus describes one v3 migration and its state.
type MigrationStatus struct {
	Version          int64      `json:"version"`
	Name             string     `json:"name"`
	Applied          bool       `json:"applied"`
	AppliedAt        *time.Time `json:"applied_at,omitempty"`
	Checksum         string     `json:"checksum,omitempty"`
	ChecksumMismatch bool       `json:"checksum_mismatch"`
}

func sqliteDSNWithForeignKeys(dsn string) string {
	separator := "?"
	if strings.Contains(dsn, "?") {
		separator = "&"
	}
	return dsn + separator + "_foreign_keys=on"
}

func openMigrationDB(driver, dsn string) (*sql.DB, error) {
	switch driver {
	case "sqlite":
		sqlDB, err := sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
		if err != nil {
			return nil, fmt.Errorf("open sqlite for migration: %w", err)
		}
		// SQLite in-memory DSNs are per-connection unless shared; one connection also
		// avoids lock surprises while applying multiple statements.
		sqlDB.SetMaxOpenConns(1)
		if _, err := sqlDB.Exec("PRAGMA foreign_keys = ON"); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("enable sqlite foreign_keys: %w", err)
		}
		return sqlDB, nil
	case "postgres":
		sqlDB, err := sql.Open("pgx", dsn)
		if err != nil {
			return nil, fmt.Errorf("open postgres for migration: %w", err)
		}
		if err := sqlDB.Ping(); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("ping postgres for migration: %w", err)
		}
		return sqlDB, nil
	default:
		return nil, fmt.Errorf("unsupported migration driver %q (want sqlite or postgres)", driver)
	}
}

func loadV3Migrations(driver string) ([]migration, error) {
	entries, err := fs.ReadDir(v3Migrations, V3MigrationsDir)
	if err != nil {
		return nil, fmt.Errorf("read v3 migrations: %w", err)
	}

	out := make([]migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, name, ok, err := parseMigrationName(entry.Name(), driver)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		raw, err := fs.ReadFile(v3Migrations, path.Join(V3MigrationsDir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		up, down := splitGooseSections(string(raw))
		out = append(out, migration{
			version:  version,
			name:     name,
			up:       up,
			down:     down,
			checksum: migrationChecksum(up, down),
		})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	for i := 1; i < len(out); i++ {
		if out[i].version == out[i-1].version {
			return nil, fmt.Errorf("duplicate v3 migration version %d (%s and %s)",
				out[i].version, out[i-1].name, out[i].name)
		}
	}
	return out, nil
}

// parseMigrationName parses `<version>_<name>.sql` and the dialect-specific
// `<version>_<name>.<dialect>.sql` form. ok is false when the file belongs to a
// different dialect.
func parseMigrationName(filename, driver string) (version int64, name string, ok bool, err error) {
	base := strings.TrimSuffix(filename, ".sql")
	for _, dialect := range []string{"sqlite", "postgres"} {
		suffix := "." + dialect
		if strings.HasSuffix(base, suffix) {
			if driver != dialect {
				return 0, "", false, nil
			}
			base = strings.TrimSuffix(base, suffix)
			break
		}
	}
	parts := strings.SplitN(base, "_", 2)
	if len(parts) != 2 {
		return 0, "", false, fmt.Errorf("invalid migration filename %q (want <version>_<name>.sql)", filename)
	}
	version, err = strconv.ParseInt(parts[0], 10, 64)
	if err != nil || version < 0 {
		return 0, "", false, fmt.Errorf("invalid migration version in %q", filename)
	}
	if strings.TrimSpace(parts[1]) == "" {
		return 0, "", false, fmt.Errorf("invalid migration name in %q", filename)
	}
	return version, parts[1], true, nil
}

func migrationChecksum(up, down string) string {
	sum := sha256.Sum256([]byte(up + "\n-- +goose Down\n" + down))
	return hex.EncodeToString(sum[:])
}

func splitGooseSections(raw string) (up, down string) {
	upMarker := "-- +goose Up"
	downMarker := "-- +goose Down"

	upIdx := strings.Index(raw, upMarker)
	downIdx := strings.Index(raw, downMarker)

	switch {
	case upIdx >= 0 && downIdx > upIdx:
		up = raw[upIdx+len(upMarker) : downIdx]
		down = raw[downIdx+len(downMarker):]
	case upIdx >= 0:
		up = raw[upIdx+len(upMarker):]
	default:
		up = raw
	}
	return strings.TrimSpace(up), strings.TrimSpace(down)
}

func ensureMigrationTable(sqlDB *sql.DB, driver string) error {
	_, err := sqlDB.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL DEFAULT '',
			applied_at TIMESTAMP NOT NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	exists, err := migrationChecksumColumnExists(sqlDB, driver)
	if err != nil {
		return err
	}
	if !exists {
		if _, err := sqlDB.Exec(`ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add schema_migrations.checksum: %w", err)
		}
	}
	return nil
}

func migrationChecksumColumnExists(sqlDB *sql.DB, driver string) (bool, error) {
	var count int
	var err error
	switch driver {
	case "sqlite":
		err = sqlDB.QueryRow(
			`SELECT count(*) FROM pragma_table_info('schema_migrations') WHERE name = 'checksum'`,
		).Scan(&count)
	case "postgres":
		err = sqlDB.QueryRow(
			`SELECT count(*) FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'checksum'`,
		).Scan(&count)
	default:
		return false, fmt.Errorf("unsupported migration driver %q", driver)
	}
	if err != nil {
		return false, fmt.Errorf("inspect schema_migrations checksum column: %w", err)
	}
	return count > 0, nil
}

func appliedMigrations(sqlDB *sql.DB) (map[int64]appliedMigration, error) {
	rows, err := sqlDB.Query(`SELECT version, checksum, applied_at FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int64]appliedMigration)
	for rows.Next() {
		var version int64
		var item appliedMigration
		if err := rows.Scan(&version, &item.checksum, &item.appliedAt); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		applied[version] = item
	}
	return applied, rows.Err()
}

// MigrateV3 applies all pending v3 migrations.
func MigrateV3(driver, dsn string) error {
	sqlDB, err := openMigrationDB(driver, dsn)
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	if err := ensureMigrationTable(sqlDB, driver); err != nil {
		return err
	}
	migrations, err := loadV3Migrations(driver)
	if err != nil {
		return err
	}
	applied, err := appliedMigrations(sqlDB)
	if err != nil {
		return err
	}

	for _, m := range migrations {
		if prev, ok := applied[m.version]; ok {
			if prev.checksum != "" && prev.checksum != m.checksum {
				return fmt.Errorf(
					"migration %d (%s) checksum mismatch: applied %s, current %s (migration files are immutable; add a new migration instead)",
					m.version, m.name, prev.checksum, m.checksum,
				)
			}
			continue
		}
		if strings.TrimSpace(m.up) == "" {
			return fmt.Errorf("migration %d (%s) has no Up section", m.version, m.name)
		}
		tx, err := sqlDB.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.version, err)
		}
		if _, err := tx.Exec(m.up); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %d (%s): %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
			m.version, m.name, m.checksum, time.Now().UTC(),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d (%s): %w", m.version, m.name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d (%s): %w", m.version, m.name, err)
		}
	}
	return nil
}

// V3MigrationStatus returns the state of every embedded v3 migration.
func V3MigrationStatus(driver, dsn string) ([]MigrationStatus, error) {
	sqlDB, err := openMigrationDB(driver, dsn)
	if err != nil {
		return nil, err
	}
	defer sqlDB.Close()

	if err := ensureMigrationTable(sqlDB, driver); err != nil {
		return nil, err
	}
	migrations, err := loadV3Migrations(driver)
	if err != nil {
		return nil, err
	}
	applied, err := appliedMigrations(sqlDB)
	if err != nil {
		return nil, err
	}

	out := make([]MigrationStatus, 0, len(migrations))
	for _, m := range migrations {
		item := MigrationStatus{Version: m.version, Name: m.name, Checksum: m.checksum}
		if prev, ok := applied[m.version]; ok {
			item.Applied = true
			appliedAt := prev.appliedAt
			item.AppliedAt = &appliedAt
			item.ChecksumMismatch = prev.checksum != "" && prev.checksum != m.checksum
		}
		out = append(out, item)
	}
	return out, nil
}

// MigrateV3Status prints the current v3 migration status.
func MigrateV3Status(driver, dsn string) error {
	statuses, err := V3MigrationStatus(driver, dsn)
	if err != nil {
		return err
	}
	for _, item := range statuses {
		state := "pending"
		if item.Applied {
			state = "applied"
		}
		if item.ChecksumMismatch {
			state += " (checksum mismatch)"
		}
		fmt.Printf("%d\t%s\t%s\n", item.Version, item.Name, state)
	}
	return nil
}

// MigrateV3Down rolls back the latest applied v3 migration (development only).
func MigrateV3Down(driver, dsn string) error {
	return MigrateV3Steps(driver, dsn, 1)
}

// MigrateV3Steps rolls back up to steps applied migrations, newest first.
func MigrateV3Steps(driver, dsn string, steps int) error {
	if steps <= 0 {
		return nil
	}
	sqlDB, err := openMigrationDB(driver, dsn)
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	if err := ensureMigrationTable(sqlDB, driver); err != nil {
		return err
	}
	migrations, err := loadV3Migrations(driver)
	if err != nil {
		return err
	}
	applied, err := appliedMigrations(sqlDB)
	if err != nil {
		return err
	}

	rollback := make([]migration, 0, len(migrations))
	for _, m := range migrations {
		if _, ok := applied[m.version]; ok {
			rollback = append(rollback, m)
		}
	}
	if len(rollback) == 0 {
		return nil
	}
	if steps > len(rollback) {
		steps = len(rollback)
	}
	for i := 0; i < steps; i++ {
		// rollback is sorted ascending by version; take from the end.
		m := rollback[len(rollback)-1-i]
		if err := rollbackMigration(sqlDB, m); err != nil {
			return err
		}
	}
	return nil
}

// MigrateV3DownTo rolls back every applied migration newer than target.
// A negative target rolls back all migrations.
func MigrateV3DownTo(driver, dsn string, target int64) error {
	sqlDB, err := openMigrationDB(driver, dsn)
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	if err := ensureMigrationTable(sqlDB, driver); err != nil {
		return err
	}
	migrations, err := loadV3Migrations(driver)
	if err != nil {
		return err
	}
	applied, err := appliedMigrations(sqlDB)
	if err != nil {
		return err
	}

	for i := len(migrations) - 1; i >= 0; i-- {
		m := migrations[i]
		if _, ok := applied[m.version]; !ok {
			continue
		}
		if target >= 0 && m.version <= target {
			continue
		}
		if err := rollbackMigration(sqlDB, m); err != nil {
			return err
		}
	}
	return nil
}

func rollbackMigration(sqlDB *sql.DB, m migration) error {
	if strings.TrimSpace(m.down) == "" {
		return fmt.Errorf("migration %d (%s) has no Down section", m.version, m.name)
	}
	tx, err := sqlDB.Begin()
	if err != nil {
		return fmt.Errorf("begin rollback %d: %w", m.version, err)
	}
	if _, err := tx.Exec(m.down); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("rollback migration %d (%s): %w", m.version, m.name, err)
	}
	if _, err := tx.Exec(`DELETE FROM schema_migrations WHERE version = ?`, m.version); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("remove migration record %d: %w", m.version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit rollback %d (%s): %w", m.version, m.name, err)
	}
	return nil
}
