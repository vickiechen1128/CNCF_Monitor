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
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

func newAttributeService(t *testing.T) (*AttributeService, *gorm.DB) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m07_attributes.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-npu','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.41')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-npu','npu-01','10.0.0.41','Ubuntu',1,0)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	svc := NewAttributeService(
		repository.NewAttributeDefinitionRepository(gormDB),
		repository.NewResourceAttributeRepository(gormDB),
		repository.NewGORMRepository(gormDB),
	)
	return svc, gormDB
}

func TestCreateAttributeDefinitionNeedsNoSchemaChange(t *testing.T) {
	svc, _ := newAttributeService(t)
	ctx := context.Background()

	def, err := svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key:              "dpu_model",
		DisplayName:      "DPU 型号",
		ValueType:        domain.AttributeTypeText,
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, def.ID)
	assert.True(t, def.Enabled)

	// A second key with the same name in the same category is a duplicate.
	_, err = svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key:              "dpu_model",
		DisplayName:      "重复",
		ValueType:        domain.AttributeTypeText,
		ResourceCategory: domain.CategoryHost,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already exists")
}

func TestAttributeDefinitionValidatesTypeAndOptions(t *testing.T) {
	svc, _ := newAttributeService(t)
	ctx := context.Background()

	_, err := svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "bad_type", DisplayName: "坏类型", ValueType: "date", ResourceCategory: domain.CategoryHost,
	})
	require.Error(t, err)

	_, err = svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "empty_enum", DisplayName: "空枚举", ValueType: domain.AttributeTypeEnum,
		ResourceCategory: domain.CategoryHost,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "enum_options")
}

func TestReplaceResourceAttributesValidatesValues(t *testing.T) {
	svc, _ := newAttributeService(t)
	ctx := context.Background()

	_, err := svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "smart_nic", DisplayName: "智能网卡", ValueType: domain.AttributeTypeEnum,
		ResourceCategory: domain.CategoryHost, EnumOptions: []string{"none", "mellanox"},
	})
	require.NoError(t, err)

	stored, err := svc.ReplaceResourceAttributes(ctx, "r-npu", []AttributeValue{
		{Key: "smart_nic", Value: "mellanox"},
	})
	require.NoError(t, err)
	require.Len(t, stored, 1)
	assert.Equal(t, "mellanox", stored[0].Value)

	// Enum values are constrained by the dictionary.
	_, err = svc.ReplaceResourceAttributes(ctx, "r-npu", []AttributeValue{
		{Key: "smart_nic", Value: "intel"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must be one of")

	// Unregistered keys are rejected, keeping the attribute space controlled.
	_, err = svc.ReplaceResourceAttributes(ctx, "r-npu", []AttributeValue{
		{Key: "unknown_key", Value: "x"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "is not registered")

	// Values survive a rejected replace: the earlier set is still there.
	reloaded, err := svc.ListResourceAttributes(ctx, "r-npu")
	require.NoError(t, err)
	require.Len(t, reloaded, 1)
	assert.Equal(t, "mellanox", reloaded[0].Value)
}

func TestDeleteAttributeDefinitionBlockedWhileUsed(t *testing.T) {
	svc, _ := newAttributeService(t)
	ctx := context.Background()

	def, err := svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "gpu_memory_gb", DisplayName: "显存", ValueType: domain.AttributeTypeNumber,
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)

	_, err = svc.ReplaceResourceAttributes(ctx, "r-npu", []AttributeValue{
		{Key: "gpu_memory_gb", Value: "80"},
	})
	require.NoError(t, err)

	err = svc.DeleteDefinition(ctx, def.ID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "disable it instead")

	// Clearing the value unblocks deletion.
	_, err = svc.ReplaceResourceAttributes(ctx, "r-npu", nil)
	require.NoError(t, err)
	require.NoError(t, svc.DeleteDefinition(ctx, def.ID))
}
