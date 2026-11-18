package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDSNSegmentedEnv(t *testing.T) {
	// No full-DSN override: segments are assembled, db name defaults.
	t.Setenv("METRIC_CENTER_DB_DSN", "")
	t.Setenv("METRIC_CENTER_DB_HOST", "db.internal")
	t.Setenv("METRIC_CENTER_DB_PORT", "6432")
	t.Setenv("METRIC_CENTER_DB_USER", "svc_metric")
	t.Setenv("METRIC_CENTER_DB_PASSWORD", "s3cret")
	t.Setenv("METRIC_CENTER_DB_NAME", "")
	t.Setenv("METRIC_CENTER_DB_SSLMODE", "require")

	assert.Equal(t,
		"postgres://svc_metric:s3cret@db.internal:6432/metric_center?sslmode=require",
		DSN())
}

func TestDSNFullOverrideWins(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "postgres://custom@host:9999/customdb?sslmode=verify-full")
	t.Setenv("METRIC_CENTER_DB_HOST", "ignored")
	assert.Equal(t, "postgres://custom@host:9999/customdb?sslmode=verify-full", DSN())
}

func TestDSNDefaults(t *testing.T) {
	for _, k := range []string{
		"METRIC_CENTER_DB_DSN", "METRIC_CENTER_DB_HOST", "METRIC_CENTER_DB_PORT",
		"METRIC_CENTER_DB_USER", "METRIC_CENTER_DB_PASSWORD", "METRIC_CENTER_DB_NAME",
		"METRIC_CENTER_DB_SSLMODE",
	} {
		t.Setenv(k, "")
	}
	assert.Equal(t, "postgres://postgres@localhost:5432/metric_center?sslmode=disable", DSN())
}
