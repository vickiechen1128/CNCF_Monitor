package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

type fixedUsageChecker struct {
	count int64
}

func (f fixedUsageChecker) CountReferences(context.Context, string) (int64, error) {
	return f.count, nil
}

func newLabelTemplateService(t *testing.T, usage fixedUsageChecker) (*LabelTemplateService, *gorm.DB) {
	t.Helper()
	gormDB := testdb.Open(t)
	repo := repository.NewLabelTemplateRepository(gormDB)
	return NewLabelTemplateService(repo, usage), gormDB
}

func TestLabelTemplateDeleteGuardsReferences(t *testing.T) {
	svc, _ := newLabelTemplateService(t, fixedUsageChecker{count: 2})
	ctx := context.Background()

	template, err := svc.Create(ctx, &domain.LabelTemplate{
		Name:             "host-default",
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)

	err = svc.Delete(ctx, template.ID)
	var conflict *domain.LabelTemplateConflictError
	require.ErrorAs(t, err, &conflict)
}

func TestLabelTemplateDeleteUnreferenced(t *testing.T) {
	svc, _ := newLabelTemplateService(t, fixedUsageChecker{})
	ctx := context.Background()

	template, err := svc.Create(ctx, &domain.LabelTemplate{
		Name:             "host-default",
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)
	require.NoError(t, svc.Delete(ctx, template.ID))

	_, err = svc.Get(ctx, template.ID)
	var nf *domain.LabelTemplateNotFoundError
	require.ErrorAs(t, err, &nf)
}

func TestLabelTemplateDefaultIsExclusive(t *testing.T) {
	svc, _ := newLabelTemplateService(t, fixedUsageChecker{})
	ctx := context.Background()

	first, err := svc.Create(ctx, &domain.LabelTemplate{
		Name: "host-a", ResourceCategory: domain.CategoryHost, IsDefault: true,
	})
	require.NoError(t, err)
	second, err := svc.Create(ctx, &domain.LabelTemplate{
		Name: "host-b", ResourceCategory: domain.CategoryHost, IsDefault: true,
	})
	require.NoError(t, err)

	reloadedFirst, err := svc.Get(ctx, first.ID)
	require.NoError(t, err)
	assert.False(t, reloadedFirst.IsDefault)
	reloadedSecond, err := svc.Get(ctx, second.ID)
	require.NoError(t, err)
	assert.True(t, reloadedSecond.IsDefault)
}

func TestLabelTemplateWritesNotifyAllDomains(t *testing.T) {
	svc, _ := newLabelTemplateService(t, fixedUsageChecker{})
	notifier := &recordedChangeNotifier{}
	svc.SetChangeNotifier(notifier)
	ctx := context.Background()

	template, err := svc.Create(ctx, &domain.LabelTemplate{
		Name: "host-notify", ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, notifier.allCalls)

	template.Name = "host-notify-renamed"
	_, err = svc.Update(ctx, template.ID, template)
	require.NoError(t, err)
	assert.Equal(t, 2, notifier.allCalls)

	require.NoError(t, svc.Delete(ctx, template.ID))
	assert.Equal(t, 3, notifier.allCalls)
}
