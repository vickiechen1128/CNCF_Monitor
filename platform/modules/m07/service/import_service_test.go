package service

import (
	"bytes"
	"context"
	"strconv"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

type fakeImportRepository struct {
	records []*domain.ImportRecord
}

func (f *fakeImportRepository) Create(_ context.Context, record *domain.ImportRecord) error {
	f.records = append(f.records, record)
	return nil
}

func (f *fakeImportRepository) List(_ context.Context, _, _ string) ([]*domain.ImportRecord, error) {
	return f.records, nil
}

func (f *fakeImportRepository) Get(_ context.Context, importID string) (*domain.ImportRecord, error) {
	for _, record := range f.records {
		if record.ID == importID || record.ImportNo == importID {
			return record, nil
		}
	}
	return nil, &domain.NotFoundError{ResourceID: importID}
}

func buildHostXLSX(t *testing.T, ip, status string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	require.NoError(t, f.SetSheetName(f.GetSheetName(0), "Sheet1"))
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at"},
		{"default", "web-01", "web-01", ip, "linux", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", status, 0, ""},
	}
	for i := range rows {
		require.NoError(t, f.SetSheetRow("Sheet1", "A"+strconv.Itoa(i+1), &rows[i]))
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

func TestImportServiceCreateOnlyAndDuplicate(t *testing.T) {
	repo := newFakeRepository()
	imports := &fakeImportRepository{}
	svc := NewImportService(repo, imports, &fakeDictionary{primary: "ecommerce"})
	ctx := context.Background()

	record, err := svc.Import(ctx, domain.CategoryHost, domain.ImportModeCreateOnly, buildHostXLSX(t, "10.0.0.1", "运行中"), "tester")
	require.NoError(t, err)
	assert.Equal(t, domain.ImportStatusSuccess, record.Status)
	assert.Equal(t, 1, record.Success)
	assert.Len(t, repo.resources, 1)

	record, err = svc.Import(ctx, domain.CategoryHost, domain.ImportModeCreateOnly, buildHostXLSX(t, "10.0.0.1", "运行中"), "tester")
	require.NoError(t, err)
	assert.Equal(t, domain.ImportStatusFailed, record.Status)
	assert.Equal(t, 1, record.Failed)
	require.Len(t, record.Errors, 1)
	assert.Equal(t, 2, record.Errors[0].Row)
}

func TestImportServiceUpsert(t *testing.T) {
	repo := newFakeRepository()
	imports := &fakeImportRepository{}
	svc := NewImportService(repo, imports, &fakeDictionary{primary: "ecommerce"})
	ctx := context.Background()

	_, err := svc.Import(ctx, domain.CategoryHost, domain.ImportModeCreateOnly, buildHostXLSX(t, "10.0.0.2", "运行中"), "tester")
	require.NoError(t, err)

	record, err := svc.Import(ctx, domain.CategoryHost, domain.ImportModeUpsert, buildHostXLSX(t, "10.0.0.2", "维护中"), "tester")
	require.NoError(t, err)
	assert.Equal(t, 1, record.Updated)
	assert.Equal(t, domain.ImportStatusSuccess, record.Status)

	for _, resource := range repo.resources {
		assert.Equal(t, domain.StatusMaintenance, resource.Status)
	}
}
