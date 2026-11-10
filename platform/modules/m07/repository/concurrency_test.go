package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConcurrentCreateSameDedupKey(t *testing.T) {
	gormDB := openRepositoryTestDB(t)
	repo := NewGORMRepository(gormDB)
	ctx := context.Background()

	const workers = 8
	var success, conflicts int64
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := repo.Create(ctx, newHost(fmt.Sprintf("res-%d", i), "10.0.0.1", "web-01"))
			if err == nil {
				atomic.AddInt64(&success, 1)
				return
			}
			var conflict *domain.ConflictError
			if errors.As(err, &conflict) {
				atomic.AddInt64(&conflicts, 1)
				return
			}
			t.Errorf("unexpected create error: %v", err)
		}(i)
	}
	wg.Wait()

	assert.EqualValues(t, 1, success, "exactly one create should win")
	assert.EqualValues(t, workers-1, conflicts, "other creates should map to conflict")
	var count int64
	require.NoError(t, gormDB.Model(&resourceRecord{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "only one resource row should exist")
}

func TestCreateRollsBackWhenExtensionFails(t *testing.T) {
	gormDB := openRepositoryTestDB(t)
	repo := NewGORMRepository(gormDB)
	ctx := context.Background()

	require.NoError(t, gormDB.Exec("DROP TABLE host_resources").Error)
	err := repo.Create(ctx, newHost("res-rollback", "10.0.0.2", "web-02"))
	require.Error(t, err)

	var count int64
	require.NoError(t, gormDB.Model(&resourceRecord{}).Count(&count).Error)
	assert.EqualValues(t, 0, count, "base row must roll back with extension failure")
}
