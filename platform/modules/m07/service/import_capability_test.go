package service

import (
	"bytes"
	"context"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

func buildCapabilityXLSX(t *testing.T, ip, attributes string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	require.NoError(t, f.SetSheetName(f.GetSheetName(0), "Sheet1"))
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at", "has_npu", "has_gpu", "attributes"},
		{"mc-demo", "npu-01", "npu-01", ip, "Ubuntu", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, "", "是", "否", attributes},
	}
	for i := range rows {
		require.NoError(t, f.SetSheetRow("Sheet1", "A"+strconv.Itoa(i+1), &rows[i]))
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

// newCapabilityImportService builds an import service over a real (sqlite)
// repository, because capability values have to be persisted, not faked.
func newCapabilityImportService(t *testing.T) (*ImportService, *gorm.DB, *repository.GORMRepository) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m07_import_capability.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
		`INSERT INTO business_domains(code,name,enabled) VALUES ('payment','支付',1)`,
		`INSERT INTO application_dicts(app_code,app_name,status) VALUES ('order-service','订单服务','enabled')`,
		`INSERT INTO platform_dicts(platform_code,platform_name,enabled) VALUES ('ecommerce','电商平台',1)`,
		`INSERT INTO app_platform_rels(id,app_code,platform_code,is_primary) VALUES ('rel-1','order-service','ecommerce',1)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	resourceRepo := repository.NewGORMRepository(gormDB)
	defs := repository.NewAttributeDefinitionRepository(gormDB)
	attrs := repository.NewResourceAttributeRepository(gormDB)
	svc := NewImportService(resourceRepo, &fakeImportRepository{}, &fakeDictionary{primary: "ecommerce"})
	svc.SetAttributeWriter(defs, attrs)
	return svc, gormDB, resourceRepo
}

func TestImportPersistsCapabilityFlagsAndAttributes(t *testing.T) {
	svc, gormDB, _ := newCapabilityImportService(t)
	ctx := context.Background()

	_, err := NewAttributeService(
		repository.NewAttributeDefinitionRepository(gormDB),
		repository.NewResourceAttributeRepository(gormDB),
		repository.NewGORMRepository(gormDB),
	).CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "dpu_model", DisplayName: "DPU 型号", ValueType: domain.AttributeTypeText,
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)

	record, err := svc.Import(ctx, domain.CategoryHost, domain.ImportModeCreateOnly,
		buildCapabilityXLSX(t, "10.0.0.51", "dpu_model=BlueField-3"), "tester")
	require.NoError(t, err)
	assert.Equal(t, domain.ImportStatusSuccess, record.Status, record.Errors)

	var hasNPU bool
	require.NoError(t, gormDB.Raw(`SELECT has_npu FROM host_resources WHERE instance_ip = '10.0.0.51'`).Row().Scan(&hasNPU))
	assert.True(t, hasNPU, "has_npu column must land on the host record")

	var value string
	require.NoError(t, gormDB.Raw(`SELECT value FROM m07_resource_attributes WHERE attribute_key = 'dpu_model'`).Row().Scan(&value))
	assert.Equal(t, "BlueField-3", value)
}

func TestImportRejectsUnregisteredAttributeKey(t *testing.T) {
	svc, _, _ := newCapabilityImportService(t)

	record, err := svc.Import(context.Background(), domain.CategoryHost, domain.ImportModeCreateOnly,
		buildCapabilityXLSX(t, "10.0.0.52", "unknown_key=x"), "tester")
	require.NoError(t, err)
	assert.Equal(t, domain.ImportStatusFailed, record.Status)
	require.Len(t, record.Errors, 1)
	assert.Equal(t, "attributes", record.Errors[0].Field)
	assert.Contains(t, record.Errors[0].Reason, "not registered")
}

// TestImportRejectsRemovedAttributeKey covers FR-34: a field that left the CI
// model no longer accepts values through Excel import.
func TestImportRejectsRemovedAttributeKey(t *testing.T) {
	svc, gormDB, resourceRepo := newCapabilityImportService(t)
	ctx := context.Background()
	attrSvc := NewAttributeService(
		repository.NewAttributeDefinitionRepository(gormDB),
		repository.NewResourceAttributeRepository(gormDB),
		resourceRepo,
	)

	def, err := attrSvc.CreateDefinition(ctx, &domain.AttributeDefinition{
		Key: "dpu_model", DisplayName: "DPU 型号", ValueType: domain.AttributeTypeText,
		ResourceCategory: domain.CategoryHost,
	})
	require.NoError(t, err)

	// First import creates a value, so the field has a reference.
	record, err := svc.Import(ctx, domain.CategoryHost, domain.ImportModeCreateOnly,
		buildCapabilityXLSX(t, "10.0.0.53", "dpu_model=BlueField-3"), "tester")
	require.NoError(t, err)
	require.Equal(t, domain.ImportStatusSuccess, record.Status, record.Errors)

	result, err := attrSvc.RemoveDefinition(ctx, def.ID)
	require.NoError(t, err)
	require.Equal(t, RemoveModeRemoved, result.Mode)

	record, err = svc.Import(ctx, domain.CategoryHost, domain.ImportModeCreateOnly,
		buildCapabilityXLSX(t, "10.0.0.54", "dpu_model=BlueField-3"), "tester")
	require.NoError(t, err)
	assert.Equal(t, domain.ImportStatusFailed, record.Status)
	require.Len(t, record.Errors, 1)
	assert.Contains(t, record.Errors[0].Reason, "removed")
}
