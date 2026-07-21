// Package db manages the SQLite database connection and GORM migrations
// for the MetricCenter platform.
package db

import (
	"fmt"
	"os"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const defaultDSN = "metric_center.db"

// DB is the package-level GORM database handle.
// It is initialized by Init.
var DB *gorm.DB

// Init opens the SQLite database using the METRIC_CENTER_DB_DSN environment
// variable, falling back to the default "metric_center.db" file.
// It also runs AutoMigrate to create tables.
func Init() error {
	dsn := os.Getenv("METRIC_CENTER_DB_DSN")
	if dsn == "" {
		dsn = defaultDSN
	}

	var err error
	DB, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to open database %q: %w", dsn, err)
	}

	return AutoMigrate()
}

// AutoMigrate creates or updates the database schema for all known models.
func AutoMigrate() error {
	if DB == nil {
		return fmt.Errorf("database connection is not initialized")
	}

	return DB.AutoMigrate(
		&models.Host{},
		&models.Middleware{},
		&models.Application{},
		&models.LabelTemplate{},
		&models.ScrapeJob{},
		&models.BlackboxProbeConfig{},
	)
}

// Health checks whether the database connection is alive.
func Health() error {
	if DB == nil {
		return fmt.Errorf("database connection is not initialized")
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	return sqlDB.Ping()
}
