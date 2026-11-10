package importer

import (
	"bytes"
	"strconv"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

func setRows(t *testing.T, f *excelize.File, sheet string, rows [][]any) {
	t.Helper()
	for i := range rows {
		axis := "A" + strconv.Itoa(i+1)
		require.NoError(t, f.SetSheetRow(sheet, axis, &rows[i]))
	}
}

func buildXLSX(t *testing.T, sheet string, rows [][]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	require.NoError(t, f.SetSheetName(f.GetSheetName(0), sheet))
	setRows(t, f, sheet, rows)
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

func TestParseExcelAndValidateRows(t *testing.T) {
	rows := [][]any{
		{"network_domain", "instance_name", "hostname", "instance_ip", "os_type", "biz_code", "app_code", "platform_code", "env", "cluster", "owner", "status", "scrape_port", "activated_at"},
		{"default", "web-01", "web-01", "10.0.0.1", "linux", "payment", "order-service", "ecommerce", "PRD", "prod-a", "ops", "运行中", 0, ""},
	}
	data := buildXLSX(t, "Sheet1", rows)

	parsed, err := ParseExcel(data, domain.CategoryHost)
	require.NoError(t, err)
	require.Len(t, parsed, 1)
	assert.Equal(t, 2, parsed[0].RowNumber)
	assert.Equal(t, "web-01", parsed[0].Hostname)

	valid, errs := ValidateRows(parsed)
	require.Empty(t, errs)
	require.Len(t, valid, 1)
	assert.Equal(t, domain.StatusOnline, valid[0].Resource.Status)
	assert.Equal(t, "host|default|10.0.0.1", valid[0].Resource.DedupKey)
}

func TestParseDeclareSheets(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	require.NoError(t, f.SetSheetName(f.GetSheetName(0), bizDeclareSheet))
	setRows(t, f, bizDeclareSheet, [][]any{
		{"biz_code", "biz_name", "说明"},
		{"payment", "支付", "支付业务"},
	})
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))

	sheets, err := ParseDeclareSheets(buf.Bytes())
	require.NoError(t, err)
	require.Len(t, sheets.Biz, 1)
	assert.Equal(t, "payment", sheets.Biz[0].Code)
	require.NoError(t, ValidateDeclarations(sheets))

	sheets.Biz[0].Code = "Bad Code"
	require.Error(t, ValidateDeclarations(sheets))
}
