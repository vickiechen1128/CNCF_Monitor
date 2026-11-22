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

func newAttributeService(t *testing.T) (*AttributeService, *gorm.DB) {
	t.Helper()
	gormDB := testdb.Open(t)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-npu','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.41')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-npu','npu-01','10.0.0.41','Ubuntu',TRUE,FALSE)`,
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

	// 有引用：只能移出模型，值保留（FR-34）。
	result, err := svc.RemoveDefinition(ctx, def.ID)
	require.NoError(t, err)
	assert.Equal(t, RemoveModeRemoved, result.Mode)
	assert.EqualValues(t, 1, result.UsageCount)

	// 已移出字段不再出现在「在模型中」列表。
	active, err := svc.ListDefinitions(ctx, domain.CategoryHost, domain.AttributeStatusActive)
	require.NoError(t, err)
	assert.Empty(t, active)

	// 已移出字段不可再填值。
	_, err = svc.ReplaceResourceAttributes(ctx, "r-npu", []AttributeValue{
		{Key: "gpu_memory_gb", Value: "81"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "removed")

	// 历史值仍在。
	values, err := svc.ListResourceAttributes(ctx, "r-npu")
	require.NoError(t, err)
	require.Len(t, values, 1)
	assert.Equal(t, "80", values[0].Value)

	// 重新登记同名 key：恢复为「在模型中」，不新建记录，历史值自动可用。
	restored, err := svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "gpu_memory_gb", DisplayName: "显存（GB）", ValueType: domain.AttributeTypeNumber,
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)
	assert.Equal(t, def.ID, restored.ID)
	assert.Equal(t, domain.AttributeStatusActive, restored.EffectiveStatus())
	assert.Equal(t, "显存（GB）", restored.DisplayName)

	// 清空值后再次移除：零引用走物理删除。
	_, err = svc.ReplaceResourceAttributes(ctx, "r-npu", nil)
	require.NoError(t, err)
	result, err = svc.RemoveDefinition(ctx, def.ID)
	require.NoError(t, err)
	assert.Equal(t, RemoveModeDeleted, result.Mode)
	assert.EqualValues(t, 0, result.UsageCount)
}

func TestAttributeDefinitionGroupAndOrder(t *testing.T) {
	svc, _ := newAttributeService(t)
	ctx := context.Background()

	// 未指定分组时落在「画像信息」，排序默认 0。
	def, err := svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "rack_position", DisplayName: "机柜位置", ValueType: domain.AttributeTypeText,
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.AttributeGroupProfile, def.Group)
	assert.Equal(t, 0, def.Order)

	// 非法分组被拒绝。
	_, err = svc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "bad_group", DisplayName: "坏分组", ValueType: domain.AttributeTypeText,
		ResourceCategory: domain.CategoryHost, Group: "invented",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "display_group")

	// 编辑可改分组与排序；key 与类别不可改。
	updated, err := svc.UpdateDefinition(ctx, def.ID, &domain.AttributeDefinition{
		DisplayName: "机柜位置", ValueType: domain.AttributeTypeText,
		Group: domain.AttributeGroupCapability, Order: 3,
	}, nil)
	require.NoError(t, err)
	assert.Equal(t, domain.AttributeGroupCapability, updated.Group)
	assert.Equal(t, 3, updated.Order)

	// 排序必须非负。
	_, err = svc.UpdateDefinition(ctx, def.ID, &domain.AttributeDefinition{
		DisplayName: "机柜位置", ValueType: domain.AttributeTypeText,
		Group: domain.AttributeGroupCapability, Order: -1,
	}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "display_order")
}
