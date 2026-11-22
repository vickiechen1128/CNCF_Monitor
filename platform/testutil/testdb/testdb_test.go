package testdb

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// widget is a throwaway model used only to prove that Open returns a working
// GORM handle bound to the isolated schema.
type widget struct {
	ID   uint   `gorm:"primaryKey"`
	Name string `gorm:"not null"`
}

func exerciseCRUD(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&widget{}))

	require.NoError(t, db.Create(&widget{Name: "alpha"}).Error)
	var got widget
	require.NoError(t, db.Where("name = ?", "alpha").First(&got).Error)
	assert.Equal(t, "alpha", got.Name)

	require.NoError(t, db.Model(&widget{}).Where("name = ?", "alpha").Update("name", "beta").Error)
	var count int64
	require.NoError(t, db.Model(&widget{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	require.NoError(t, db.Where("name = ?", "beta").Delete(&widget{}).Error)
	count = 0
	require.NoError(t, db.Model(&widget{}).Count(&count).Error)
	assert.Zero(t, count, "delete must remove the row")
}

// TestOpenAppliesMigrationsAndIsStable proves that Open migrates the isolated
// schema, that DSN(t) points at it and stays stable, and that the raw DSN can
// see the migration bookkeeping.
func TestOpenAppliesMigrationsAndIsStable(t *testing.T) {
	db := Open(t)
	exerciseCRUD(t, db)

	dsn := DSN(t)
	assert.Equal(t, dsn, DSN(t), "DSN must be stable for the same *testing.T")
	schema := schemaFromDSN(t, dsn)
	assert.NotEmpty(t, schema, "DSN must pin an isolated search_path")

	raw, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	defer raw.Close()
	var migrations int
	require.NoError(t, raw.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&migrations))
	assert.Positive(t, migrations, "Open should apply v3 migrations")
}

func TestOpenIsolatesSchemasAndCleansUp(t *testing.T) {
	baseDSN := os.Getenv(PostgresDSNEnv)
	require.NotEmpty(t, baseDSN, "make test-platform sets the DSN")

	var schemaA, schemaB string
	t.Run("schema-a", func(t *testing.T) {
		db := Open(t)
		schemaA = schemaFromDSN(t, DSN(t))
		assert.True(t, len(schemaA) > len("test_"), "expected an isolated test_ schema, got %q", schemaA)
		exerciseCRUD(t, db)

		// Leave a row behind: it must be invisible to the next test's schema.
		require.NoError(t, db.Create(&widget{Name: "only-in-a"}).Error)
	})
	t.Run("schema-b", func(t *testing.T) {
		db := Open(t)
		schemaB = schemaFromDSN(t, DSN(t))
		require.NotEqual(t, schemaA, schemaB, "each test must get its own schema")

		exerciseCRUD(t, db)
		var leftover int64
		require.NoError(t, db.Model(&widget{}).Where("name = ?", "only-in-a").Count(&leftover).Error)
		assert.Zero(t, leftover, "rows from another test's schema must not leak")
	})

	// Both subtests have finished, so their t.Cleanup handlers have dropped the
	// schemas. Verify via a fresh admin connection using the unmodified DSN.
	admin, err := sql.Open("pgx", baseDSN)
	require.NoError(t, err)
	defer admin.Close()
	for _, schema := range []string{schemaA, schemaB} {
		var count int
		require.NoError(t, admin.QueryRowContext(context.Background(),
			`SELECT count(*) FROM information_schema.schemata WHERE schema_name = $1`, schema,
		).Scan(&count))
		assert.Zero(t, count, "schema %s should have been dropped by t.Cleanup", schema)
	}
}

func schemaFromDSN(t *testing.T, dsn string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err, "PostgreSQL DSN should be a URL: %s", dsn)
	return u.Query().Get("search_path")
}
