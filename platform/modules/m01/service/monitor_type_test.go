package service

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

func newMonitorTypeService(t *testing.T) (*MonitorTypeService, *gorm.DB) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m01_monitor_types.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	svc := NewMonitorTypeService(repository.NewMonitorTypeRepository(gormDB))
	require.NoError(t, svc.Refresh(context.Background()))
	t.Cleanup(domain.ResetMonitorTypeRegistry)
	return svc, gormDB
}

func TestCreateMonitorTypeIsImmediatelyUsable(t *testing.T) {
	svc, _ := newMonitorTypeService(t)
	ctx := context.Background()

	require.False(t, domain.ValidMonitorType("host_dpu"), "new type must not exist before it is created")

	created, err := svc.Create(ctx, domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code:             "host_dpu",
			Name:             "DPU 主机",
			ResourceCategory: domain.CategoryHost,
			RuleLogic:        domain.RuleLogicAll,
		},
		Rules: []domain.MonitorTypeRule{{
			Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"},
		}},
	})
	require.NoError(t, err)
	assert.False(t, created.Definition.IsBuiltin, "user-created types stay deletable")
	require.Len(t, created.Rules, 1)
	assert.Equal(t, "has_gpu", created.Rules[0].Field)

	// The process-wide registry now answers for the new type, so every existing
	// validation call site (job, mapping, rule, metric) accepts it without a
	// restart or a release (NFR-11).
	assert.True(t, domain.ValidMonitorType("host_dpu"))
	category, ok := domain.CategoryForMonitorType("host_dpu")
	require.True(t, ok)
	assert.Equal(t, domain.CategoryHost, category)
}

func TestCreateMonitorTypeRejectsIllegalField(t *testing.T) {
	svc, _ := newMonitorTypeService(t)

	_, err := svc.Create(context.Background(), domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code: "host_sql_injection", Name: "注入", ResourceCategory: domain.CategoryHost,
		},
		Rules: []domain.MonitorTypeRule{{
			Field: "1=1 OR r.status", Operator: domain.RuleOpEq, Values: []string{"online"},
		}},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown scope field")
}

func TestUpdateMonitorTypeReplacesRules(t *testing.T) {
	svc, _ := newMonitorTypeService(t)
	ctx := context.Background()

	_, err := svc.Create(ctx, domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code: "host_custom", Name: "自定义主机", ResourceCategory: domain.CategoryHost,
		},
		Rules: []domain.MonitorTypeRule{{Field: "os_type", Operator: domain.RuleOpContains, Values: []string{"centos"}}},
	})
	require.NoError(t, err)

	updated, err := svc.Update(ctx, "host_custom", domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code: "host_custom", Name: "自定义主机 v2", ResourceCategory: domain.CategoryHost,
			RuleLogic: domain.RuleLogicAny,
		},
		Rules: []domain.MonitorTypeRule{
			{Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}},
			{Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "自定义主机 v2", updated.Definition.Name)
	assert.Equal(t, domain.RuleLogicAny, updated.Definition.RuleLogic)
	assert.Len(t, updated.Rules, 2)
}

func TestDeleteBuiltinMonitorTypeIsForbidden(t *testing.T) {
	svc, _ := newMonitorTypeService(t)
	ctx := context.Background()
	require.NoError(t, seedBuiltinMonitorTypesForTest(ctx, svc))

	err := svc.Delete(ctx, domain.MonitorTypeHostLinux)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "built in")

	// Built-in types stay listed after a refused delete.
	_, err = svc.Get(ctx, domain.MonitorTypeHostLinux)
	require.NoError(t, err)
}

func TestDeleteCustomMonitorTypeSucceeds(t *testing.T) {
	svc, _ := newMonitorTypeService(t)
	ctx := context.Background()

	_, err := svc.Create(ctx, domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code: "host_temp", Name: "临时类型", ResourceCategory: domain.CategoryHost,
		},
		Rules: []domain.MonitorTypeRule{{Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}}},
	})
	require.NoError(t, err)

	require.NoError(t, svc.Delete(ctx, "host_temp"))
	assert.False(t, domain.ValidMonitorType("host_temp"))

	_, err = svc.Get(ctx, "host_temp")
	require.Error(t, err)
}

func TestImpactCountsRules(t *testing.T) {
	svc, _ := newMonitorTypeService(t)
	ctx := context.Background()
	require.NoError(t, seedBuiltinMonitorTypesForTest(ctx, svc))

	impact, err := svc.Impact(ctx, domain.MonitorTypeHostNPU)
	require.NoError(t, err)
	assert.Equal(t, domain.MonitorTypeHostNPU, impact.Code)
	assert.Equal(t, int64(1), impact.RuleCount)
	assert.Equal(t, int64(0), impact.References.Total())
}

// seedBuiltinMonitorTypesForTest writes the built-in entries so the delete
// guard and impact preview can be exercised against stored rows.
func seedBuiltinMonitorTypesForTest(ctx context.Context, svc *MonitorTypeService) error {
	if err := svc.EnsureBuiltins(ctx); err != nil {
		return err
	}
	return svc.Refresh(ctx)
}
