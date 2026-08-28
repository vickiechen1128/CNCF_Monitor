// Package db manages the SQLite database connection and GORM migrations
// for the MetricCenter platform.
package db

import (
	"fmt"
	"os"

	"github.com/metriccenter/metriccenter/platform/db/seed"
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

	err = AutoMigrate()
	if err != nil {
		return fmt.Errorf("failed to migrate database schema: %w", err)
	}

	// Idempotently seed platform core data (platform_admin tenant, default
	// domain, zone_type dictionary, label templates, built-in exporters).
	if err := seed.Run(DB); err != nil {
		return fmt.Errorf("failed to seed platform core data: %w", err)
	}
	return nil
}

// AutoMigrate creates or updates the database schema for all known models.
func AutoMigrate() error {
	if DB == nil {
		return fmt.Errorf("database connection is not initialized")
	}

	return DB.AutoMigrate(
		// 共享基础模型
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ZoneType{},
		&models.ResourceStatusMapping{},
		// 用户认证（Module_06 §5.3/§5.4，Module_03 §4.0）
		&models.User{},
		&models.Session{},
		&models.LoginLog{},
		// 五类资源
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.ResourceLabel{},
		// 标签模板与采集策略
		&models.LabelTemplate{},
		&models.LabelTemplateSnapshot{},
		&models.ImportRecord{},
		&models.CITypeExporterMapping{},
		&models.ExporterTemplate{},
		&models.ScrapeJob{},
		&models.MonitoringRule{},
		&models.ExporterMetricLibrary{},
		&models.ExporterInstallationConfirmation{},
		// 历史表
		&models.BlackboxProbeConfig{},
		// 配置中心
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
		&models.ConfigChangeBaseline{},
		&models.EdgeAgent{},
		// 预留
		&models.BusinessMetric{},
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
