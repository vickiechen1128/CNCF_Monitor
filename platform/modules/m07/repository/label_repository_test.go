package repository

import (
	"context"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLabelRepositoryCRUD(t *testing.T) {
	gormDB := openRepositoryTestDB(t)
	resourceRepo := NewGORMRepository(gormDB)
	labelRepo := NewGORMLabelRepository(gormDB)
	ctx := context.Background()

	app := &domain.Resource{
		ResourceID:      "app-1",
		Category:        domain.CategoryApplication,
		TenantID:        "platform_admin",
		NetworkDomainID: "mc-demo",
		BizCode:         "payment",
		AppCode:         "order-service",
		PlatformCode:    "ecommerce",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Status:          domain.StatusOnline,
		SourceType:      domain.SourceManual,
		Attributes: domain.ApplicationAttributes{
			ServiceName:    "order-api",
			HealthCheckURL: "https://order.example.com/health",
		},
	}
	require.NoError(t, resourceRepo.Create(ctx, app))

	label := &domain.Label{
		ResourceID: app.ResourceID,
		Key:        "team",
		Value:      "payments",
		Source:     domain.LabelSourceUser,
	}
	require.NoError(t, labelRepo.Create(ctx, label))
	assert.NotEmpty(t, label.ID)

	list, err := labelRepo.List(ctx, app.ResourceID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "team", list[0].Key)

	updated, err := labelRepo.Update(ctx, app.ResourceID, label.ID, "payments-v2")
	require.NoError(t, err)
	assert.Equal(t, "payments-v2", updated.Value)

	dup := &domain.Label{ResourceID: app.ResourceID, Key: "team", Value: "other", Source: domain.LabelSourceUser}
	err = labelRepo.Create(ctx, dup)
	require.Error(t, err)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)

	require.NoError(t, labelRepo.Delete(ctx, app.ResourceID, label.ID))
	list, err = labelRepo.List(ctx, app.ResourceID)
	require.NoError(t, err)
	assert.Empty(t, list)

	// Partial unique index allows re-adding after soft delete.
	require.NoError(t, labelRepo.Create(ctx, &domain.Label{
		ResourceID: app.ResourceID, Key: "team", Value: "again", Source: domain.LabelSourceUser,
	}))
}
