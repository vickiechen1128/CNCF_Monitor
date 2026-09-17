package resource

import (
	"bytes"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

// buildXLSXWithHeader 按给定表头与数据行生成 xlsx 字节（供解析测试构造任意
// 合法/非法列头场景）。
func buildXLSXWithHeader(t *testing.T, header []string, dataRows [][]string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	for i, col := range header {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		require.NoError(t, err)
		require.NoError(t, f.SetCellValue(sheet, cell, col))
	}
	for r, row := range dataRows {
		for c, val := range row {
			cell, err := excelize.CoordinatesToCellName(c+1, r+2)
			require.NoError(t, err)
			require.NoError(t, f.SetCellValue(sheet, cell, val))
		}
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

// buildXLSX 按类型固定模板列头生成 xlsx（合法列头 + 数据行）。
func buildXLSX(t *testing.T, category models.ResourceCategory, dataRows [][]string) []byte {
	t.Helper()
	return buildXLSXWithHeader(t, TemplateColumns[category], dataRows)
}

// makeRow 把「列 -> 值」映射转成与模板列对齐的一行数据。
func makeRow(category models.ResourceCategory, vals map[string]string) []string {
	cols := TemplateColumns[category]
	row := make([]string, len(cols))
	for i, col := range cols {
		row[i] = vals[col]
	}
	return row
}

// baseValues 返回某资源类型一行合法数据的列值（可在此基础上覆盖制造校验命中）。
func baseValues(category models.ResourceCategory) map[string]string {
	base := map[string]string{
		"network_domain": "default",
		"biz_code":       "infra",
		"app_name":       "app",
		"cluster":        "cluster-1",
		"owner":          "ops",
		"env":            "prod",
		"status":         "运行中",
	}
	switch category {
	case models.ResourceCategoryHost:
		base["instance_name"] = "web-01"
		base["hostname"] = "web-01"
		base["instance_ip"] = "10.0.0.1"
		base["os_type"] = "Linux"
	case models.ResourceCategoryDatabase:
		base["database_type"] = "mysql"
		base["instance_ip"] = "10.0.0.10"
		base["port"] = "3306"
		base["version"] = "8.0"
	case models.ResourceCategoryMiddleware:
		base["middleware_type"] = "kafka"
		base["instance_ip"] = "10.0.0.11"
		base["port"] = "9092"
		base["version"] = "3.4"
	case models.ResourceCategoryApplication:
		base["service_name"] = "pay-service"
		base["health_check_url"] = "http://10.0.0.20:8080/health"
		base["protocol"] = "http"
		base["endpoint"] = "10.0.0.20:8080"
		base["port"] = "8080"
	case models.ResourceCategoryGenericTarget:
		base["target_name"] = "snmp-switch-01"
		base["instance_ip"] = "10.0.0.30"
		base["port"] = "161"
		base["metrics_path"] = "/metrics"
		base["scheme"] = "http"
		base["exporter_type"] = "snmp_exporter"
		base["custom_labels"] = "zone=az1;env=prod"
	}
	return base
}

// existsDomains 构造 networkDomainExists 桩：仅列出的网域存在。
func existsDomains(ids ...string) func(string) bool {
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return func(id string) bool {
		_, ok := set[id]
		return ok
	}
}

// mustParse 构建并解析 Excel 返回行（解析失败即 Fail）。
func mustParse(t *testing.T, category models.ResourceCategory, dataRows [][]string) []ImportRow {
	t.Helper()
	rows, err := ParseExcel(buildXLSX(t, category, dataRows), category)
	require.NoError(t, err)
	return rows
}

// assertRowError 断言 err 是 *ImportRowError 并校验其结构化字段。
func assertRowError(t *testing.T, err error, row int, field, value string) *ImportRowError {
	t.Helper()
	var rerr *ImportRowError
	require.ErrorAs(t, err, &rerr, "应返回 *ImportRowError")
	assert.Equal(t, row, rerr.Detail.Row)
	assert.Equal(t, field, rerr.Detail.Field)
	assert.Equal(t, value, rerr.Detail.Value)
	assert.NotEmpty(t, rerr.Detail.Reason)
	return rerr
}

// ---------------------------------------------------------------------------
// ParseExcel：合法文件解析
// ---------------------------------------------------------------------------

func TestParseExcel_ValidRows(t *testing.T) {
	rows := mustParse(t, models.ResourceCategoryHost, [][]string{
		makeRow(models.ResourceCategoryHost, baseValues(models.ResourceCategoryHost)),
		makeRow(models.ResourceCategoryHost, map[string]string{
			"network_domain": "gz-prod-01", "instance_name": "web-02", "hostname": "web-02",
			"instance_ip": "10.0.0.2", "os_type": "Linux", "biz_code": "payment",
			"app_name": "pay", "env": "staging", "cluster": "c2", "owner": "ops", "status": "已停止",
		}),
	})
	require.Len(t, rows, 2)
	assert.Equal(t, 2, rows[0].Row, "表头后第一行 row=2（§5.16.3）")
	assert.Equal(t, 3, rows[1].Row)
	assert.Equal(t, models.ResourceCategoryHost, rows[0].Category)
	assert.Equal(t, "web-01", rows[0].Input.InstanceName)
	assert.Equal(t, "10.0.0.1", rows[0].Input.InstanceIP)
	assert.Equal(t, "infra", rows[0].Input.BizCode)
	assert.Equal(t, "运行中", rows[0].Input.Status, "原始业务语言保留待映射")
	assert.Equal(t, "已停止", rows[1].Input.Status)
}

func TestParseExcel_DatabasePortParsed(t *testing.T) {
	rows := mustParse(t, models.ResourceCategoryDatabase, [][]string{
		makeRow(models.ResourceCategoryDatabase, baseValues(models.ResourceCategoryDatabase)),
	})
	require.Len(t, rows, 1)
	assert.Equal(t, 3306, rows[0].Input.Port)
	assert.Equal(t, "3306", rows[0].PortRaw)
}

func TestParseExcel_SkipsBlankRowsAndReturnsEmptyData(t *testing.T) {
	// 仅表头：返回 0 行。
	rows := mustParse(t, models.ResourceCategoryHost, nil)
	assert.Empty(t, rows)

	// 表头 + 一行数据 + 末尾空行：空行被跳过。
	data := baseValues(models.ResourceCategoryHost)
	rows = mustParse(t, models.ResourceCategoryHost, [][]string{
		makeRow(models.ResourceCategoryHost, data),
		{"", "", "", "", "", "", "", "", "", "", ""},
	})
	require.Len(t, rows, 1)
	assert.Equal(t, 2, rows[0].Row)
}

// ---------------------------------------------------------------------------
// ParseExcel：列头固定列校验（§5.16.1 不支持动态列）
// ---------------------------------------------------------------------------

func TestParseExcel_HeaderErrors(t *testing.T) {
	cols := TemplateColumns[models.ResourceCategoryHost]

	t.Run("missing column", func(t *testing.T) {
		header := cols[:len(cols)-1] // 去掉 status
		_, err := ParseExcel(buildXLSXWithHeader(t, header, nil), models.ResourceCategoryHost)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "列头缺失")
	})

	t.Run("mismatched column name", func(t *testing.T) {
		header := append([]string{}, cols...)
		header[4] = "os" // 应为 os_type
		_, err := ParseExcel(buildXLSXWithHeader(t, header, nil), models.ResourceCategoryHost)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "列头与模板不一致")
		assert.Contains(t, err.Error(), "os_type")
	})

	t.Run("extra dynamic column", func(t *testing.T) {
		header := append([]string{}, cols...)
		header = append(header, "extra_col")
		_, err := ParseExcel(buildXLSXWithHeader(t, header, nil), models.ResourceCategoryHost)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "超出模板")
	})

	t.Run("empty header", func(t *testing.T) {
		_, err := ParseExcel(buildXLSXWithHeader(t, nil, nil), models.ResourceCategoryHost)
		require.Error(t, err)
	})
}

func TestParseExcel_InvalidInput(t *testing.T) {
	t.Run("unknown category", func(t *testing.T) {
		_, err := ParseExcel(buildXLSX(t, models.ResourceCategoryHost, nil), models.ResourceCategory("bogus"))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "未知资源类型")
	})

	t.Run("not xlsx bytes", func(t *testing.T) {
		_, err := ParseExcel([]byte("this is not a valid xlsx"), models.ResourceCategoryHost)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "无法解析 Excel 文件")
	})
}

// ---------------------------------------------------------------------------
// ValidateImportRow：host 行级校验
// ---------------------------------------------------------------------------

func TestValidateImportRow_Host(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	t.Run("valid host passes with app_name/cluster optional", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		delete(vals, "app_name")
		delete(vals, "cluster")
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil))
		assert.Equal(t, models.ResourceStatusOnline, row.Status, "运行中→online")
		assert.Equal(t, "host|default|10.0.0.1", row.DedupKey, "判重键 T07-03")
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["instance_ip"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		assertRowError(t, err, 2, "instance_ip", "")
	})

	t.Run("invalid IPv4 fails with value", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["instance_ip"] = "999.999.999.999"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		rerr := assertRowError(t, err, 2, "instance_ip", "999.999.999.999")
		assert.Contains(t, rerr.Detail.Reason, "IPv4")
	})

	t.Run("missing instance_name fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["instance_name"] = ""
		vals["hostname"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		assertRowError(t, err, 2, "instance_name", "")
	})

	t.Run("invalid env fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["env"] = "qa"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		assertRowError(t, err, 2, "env", "qa")
	})

	t.Run("unregistered domain fails with closed-loop copy", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["network_domain"] = "ghost"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil) // ok 只认 default
		rerr := assertRowError(t, err, 2, "network_domain_id", "ghost")
		assert.Contains(t, rerr.Detail.Reason, "网域 ghost 未登记，请先到『系统设置 → 网域管理』登记后重新导入")
	})

	t.Run("empty domain auto-fills default", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["network_domain"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil))
		assert.Equal(t, models.DefaultDomainID, row.Input.NetworkDomainID)
	})

	t.Run("missing biz_code fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["biz_code"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		assertRowError(t, err, 2, "biz_code", "")
	})

	t.Run("disabled/unknown biz_code fails with closed-loop copy", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["biz_code"] = "legacy" // sampleYAML 中停用项
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		rerr := assertRowError(t, err, 2, "biz_code", "legacy")
		assert.Contains(t, rerr.Detail.Reason, "业务 legacy 未登记，请到『业务管理』页登记后重新导入")
	})

	t.Run("malformed biz_code fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["biz_code"] = "Bad_Code"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, ok, nil)
		assertRowError(t, err, 2, "biz_code", "Bad_Code")
	})
}

// ---------------------------------------------------------------------------
// ValidateImportRow：database / application / generic 差异化校验
// ---------------------------------------------------------------------------

func TestValidateImportRow_Database(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	t.Run("valid database passes and generates dedup key", func(t *testing.T) {
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{
			makeRow(models.ResourceCategoryDatabase, baseValues(models.ResourceCategoryDatabase)),
		})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil))
		assert.Equal(t, "database|default|10.0.0.10|3306", row.DedupKey)
	})

	t.Run("missing database_type fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["database_type"] = ""
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "database_type", "")
	})

	t.Run("missing app_name fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["app_name"] = ""
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "app_name", "")
	})

	t.Run("missing cluster fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["cluster"] = ""
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "cluster", "")
	})

	t.Run("port out of range fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["port"] = "70000"
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		rerr := assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "port", "70000")
		assert.Contains(t, rerr.Detail.Reason, "1~65535")
	})

	t.Run("non-numeric port fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["port"] = "abc"
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		rerr := assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "port", "abc")
		assert.Contains(t, rerr.Detail.Reason, "整数")
	})
}

func TestValidateImportRow_Application(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	t.Run("valid application passes", func(t *testing.T) {
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{
			makeRow(models.ResourceCategoryApplication, baseValues(models.ResourceCategoryApplication)),
		})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil))
		assert.Equal(t, "application|default|pay-service|10.0.0.20:8080", row.DedupKey)
	})

	t.Run("invalid health_check_url fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["health_check_url"] = "not-a-url"
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "health_check_url", "not-a-url")
	})

	t.Run("invalid protocol fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["protocol"] = "ftp"
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "protocol", "ftp")
	})

	t.Run("missing endpoint fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["endpoint"] = ""
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "endpoint", "")
	})
}

func TestValidateImportRow_GenericTarget(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	t.Run("valid generic passes and parses custom_labels", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		delete(vals, "app_name")
		delete(vals, "cluster")
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{
			makeRow(models.ResourceCategoryGenericTarget, vals),
		})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil))
		assert.Equal(t, "generic_target|default|10.0.0.30|161", row.DedupKey)
		require.NotNil(t, row.Input.CustomLabels)
		assert.Equal(t, "az1", row.Input.CustomLabels["zone"])
		assert.Equal(t, "prod", row.Input.CustomLabels["env"])
	})

	t.Run("invalid scheme fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		vals["scheme"] = "tcp"
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "scheme", "tcp")
	})

	t.Run("missing segment in custom_labels fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		vals["custom_labels"] = "keyonly"
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
		rerr := assertRowError(t, ValidateImportRow(&row, store, ok, nil), 2, "custom_labels", "keyonly")
		assert.Contains(t, rerr.Detail.Reason, "key1=value1;key2=value2")
	})

	t.Run("empty key/value in custom_labels fails", func(t *testing.T) {
		for _, raw := range []string{"=v", "k="} {
			vals := baseValues(models.ResourceCategoryGenericTarget)
			vals["custom_labels"] = raw
			row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
			err := ValidateImportRow(&row, store, ok, nil)
			rerr := assertRowError(t, err, 2, "custom_labels", raw)
			assert.Contains(t, rerr.Detail.Reason, "key1=value1;key2=value2")
		}
	})
}

// ---------------------------------------------------------------------------
// status 中文状态映射（T07-04 MapStatus）与映射失败计入 failed
// ---------------------------------------------------------------------------

func TestValidateImportRow_ChineseStatusMapping(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")
	cases := []struct {
		source string
		want   models.ResourceStatus
	}{
		{"运行中", models.ResourceStatusOnline},
		{"正常", models.ResourceStatusOnline},
		{"已停止", models.ResourceStatusOffline},
		{"关机", models.ResourceStatusOffline},
		{"维护中", models.ResourceStatusMaintenance},
		{"", models.ResourceStatusOffline}, // 未命中 default_target 兜底
	}
	for _, tc := range cases {
		vals := baseValues(models.ResourceCategoryHost)
		vals["status"] = tc.source
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil), "source=%q", tc.source)
		assert.Equal(t, tc.want, row.Status, "source=%q", tc.source)
		assert.Equal(t, string(tc.want), row.Input.Status, "source=%q", tc.source)
	}
}

func TestValidateImportRow_StatusMappingFailureCountsAsFailed(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")
	// 扩展规则把 运行中 → 非法目标，MapStatus 返回错误（§5.5.4 第 4 条）。
	extra := []Rule{{SourceStatus: "运行中", TargetStatus: models.ResourceStatus("invalid_target"), Priority: 200, Enabled: true}}

	vals := baseValues(models.ResourceCategoryHost)
	row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
	err := ValidateImportRow(&row, store, ok, extra)
	rerr := assertRowError(t, err, 2, "status", "运行中")
	assert.Contains(t, rerr.Detail.Reason, "状态映射失败")

	// ValidateRows 层：该行计入 failed 而非 valid。
	rows := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})
	valid, errs := ValidateRows(rows, store, ok, extra)
	assert.Empty(t, valid)
	require.Len(t, errs, 1)
	assert.Equal(t, "status", errs[0].Field)
}

// ---------------------------------------------------------------------------
// ValidateRows：错误行收集与行号（row 从 2 起始，§5.16.3）
// ---------------------------------------------------------------------------

func TestValidateRows_CollectsErrorsWithRowNumbers(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	badIP := baseValues(models.ResourceCategoryHost)
	badIP["instance_ip"] = "999.999.999.999" // 第 3 行
	stopped := baseValues(models.ResourceCategoryHost)
	stopped["status"] = "已停止" // 第 4 行

	rows := mustParse(t, models.ResourceCategoryHost, [][]string{
		makeRow(models.ResourceCategoryHost, baseValues(models.ResourceCategoryHost)), // 第 2 行 合法
		makeRow(models.ResourceCategoryHost, badIP),                                  // 第 3 行 非法 IP
		makeRow(models.ResourceCategoryHost, stopped),                                // 第 4 行 已停止
	})
	valid, errs := ValidateRows(rows, store, ok, nil)

	require.Len(t, errs, 1, "仅非法行计入 failed")
	assert.Equal(t, 3, errs[0].Row, "错误行号=3（表头后第 2 行）")
	assert.Equal(t, "host", errs[0].ResourceCategory)
	assert.Equal(t, "instance_ip", errs[0].Field)
	assert.Equal(t, "999.999.999.999", errs[0].Value)

	require.Len(t, valid, 2)
	assert.Equal(t, 2, valid[0].Row)
	assert.Equal(t, 4, valid[1].Row, "第 4 行映射后保留原行号")
	assert.Equal(t, models.ResourceStatusOffline, valid[1].Status, "已停止→offline")
	assert.NotEmpty(t, valid[1].DedupKey, "合法行带判重键供 upsert")
}

func TestValidateRows_UnregisteredDomainCollected(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	ghost := baseValues(models.ResourceCategoryHost)
	ghost["network_domain"] = "ghost"
	rows := mustParse(t, models.ResourceCategoryHost, [][]string{
		makeRow(models.ResourceCategoryHost, baseValues(models.ResourceCategoryHost)),
		makeRow(models.ResourceCategoryHost, ghost),
	})
	valid, errs := ValidateRows(rows, store, ok, nil)

	require.Len(t, valid, 1, "default 网域行合法")
	assert.Equal(t, 2, valid[0].Row)
	require.Len(t, errs, 1)
	assert.Equal(t, 3, errs[0].Row)
	assert.Equal(t, "network_domain_id", errs[0].Field)
	assert.Contains(t, errs[0].Reason, "网域 ghost 未登记，请先到『系统设置 → 网域管理』登记后重新导入")
}

// ---------------------------------------------------------------------------
// 判重键生成（T07-03 DedupKey 复用）
// ---------------------------------------------------------------------------

func TestValidateImportRow_GeneratesDedupKeyForAllCategories(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")
	cases := []struct {
		cat  models.ResourceCategory
		want string
	}{
		{models.ResourceCategoryHost, "host|default|10.0.0.1"},
		{models.ResourceCategoryDatabase, "database|default|10.0.0.10|3306"},
		{models.ResourceCategoryMiddleware, "middleware|default|10.0.0.11|9092"},
		{models.ResourceCategoryApplication, "application|default|pay-service|10.0.0.20:8080"},
		{models.ResourceCategoryGenericTarget, "generic_target|default|10.0.0.30|161"},
	}
	for _, tc := range cases {
		row := mustParse(t, tc.cat, [][]string{makeRow(tc.cat, baseValues(tc.cat))})[0]
		require.NoError(t, ValidateImportRow(&row, store, ok, nil))
		assert.Equal(t, tc.want, row.DedupKey, "资源类型 %s 判重键", tc.cat)
	}
}
