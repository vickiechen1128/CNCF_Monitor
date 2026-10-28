package blackboxmodule

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ScrapeJob{}))
	repo := NewRepository(db)
	require.NoError(t, repo.Migrate())
	return NewService(repo), db
}

func TestServiceCRUDAndValidation(t *testing.T) {
	svc, _ := newTestService(t)
	items, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, items, 4)
	assert.Equal(t, "http", items[1].Prober)

	created, err := svc.Create("https_internal", "https_internal:\n  prober: http\n  timeout: 10s\n  http:\n    tls_config:\n      insecure_skip_verify: true\n")
	require.NoError(t, err)
	assert.True(t, created.Enabled)
	assert.Equal(t, "http", created.Prober)

	_, err = svc.Create("https_internal", "https_internal:\n  prober: http\n")
	assert.ErrorIs(t, err, ErrConflict)
	_, err = svc.Create("bad", "other:\n  prober: http\n")
	assert.ErrorIs(t, err, ErrValidation)
	_, err = svc.Create("bad", "bad:\n  prober: http\n  timeout: forever\n")
	assert.ErrorIs(t, err, ErrValidation)

	updated, err := svc.Update(created.ID, "https_internal:\n  prober: http\n  timeout: 15s\n", false)
	require.NoError(t, err)
	assert.False(t, updated.Enabled)
	assert.Contains(t, updated.Content, "15s")
	require.NoError(t, svc.Delete(created.ID))
	_, err = svc.Update(created.ID, "https_internal:\n  prober: http\n", true)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestDeleteRejectsReferencedModule(t *testing.T) {
	svc, db := newTestService(t)
	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "probe-api", JobType: models.JobTypeBlackbox, BlackboxModule: "http_2xx",
	}).Error)
	items, err := svc.List()
	require.NoError(t, err)
	var id uint
	for _, item := range items {
		if item.Name == "http_2xx" {
			id = item.ID
			assert.EqualValues(t, 1, item.ReferencedJobs)
		}
	}
	assert.NotZero(t, id)
	assert.ErrorIs(t, svc.Delete(id), ErrConflict)
}
