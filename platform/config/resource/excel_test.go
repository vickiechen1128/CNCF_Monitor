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
		"app_code":       "app",
		"cluster":        "cluster-1",
		"owner":          "ops",
		"env":            "PRD",
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
		base["endpoint"] = "10.0.0.20"
		base["port"] = "8080"
	case models.ResourceCategoryGenericTarget:
		base["target_name"] = "snmp-switch-01"
		base["instance_ip"] = "10.0.0.30"
		base["port"] = "161"
		base["metrics_path"] = "/metrics"
		base["scheme"] = "http"
		base["exporter_type"] = "snmp_exporter"
		base["custom_labels"] = "zone=az1;env=prod"
	case models.ResourceCategoryInterfaceService:
		base["api_name"] = "health-check"
		base["api_url"] = "https://api.example.com/health?token=x"
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

// requireIndex 返回 col 在列头中的下标（不存在即 Fail），用于列序无关的 fixture。
func requireIndex(t *testing.T, header []string, col string) int {
	t.Helper()
	for i, c := range header {
		if c == col {
			return i
		}
	}
	t.Fatalf("模板列头缺少 %s：%v", col, header)
	return -1
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
			"app_code": "pay", "env": "UAT", "cluster": "c2", "owner": "ops", "status": "已停止",
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
		// 去掉末两列 status 与 scrape_port：scrape_port 单独缺省是旧模板兼容
		// （决策 D-7 P1，见 TestExcelLegacyTemplateWithoutScrapePortStillImports），
		// 必填列 status 缺失必须报「列头缺失」。
		header := cols[:len(cols)-2]
		_, err := ParseExcel(buildXLSXWithHeader(t, header, nil), models.ResourceCategoryHost)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "列头缺失")
	})

	t.Run("mismatched column name", func(t *testing.T) {
		header := append([]string{}, cols...)
		// 按列定位而非硬编码下标，避免模板列增删改时误命中其他列。
		idx := requireIndex(t, header, "os_type")
		header[idx] = "os"
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

	t.Run("valid host passes with app_code/cluster optional", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		delete(vals, "app_code")
		delete(vals, "cluster")
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, models.ResourceStatusOnline, row.Status, "运行中→online")
		assert.Equal(t, "host|default|10.0.0.1", row.DedupKey, "判重键 T07-03")
	})

	t.Run("missing instance_ip fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["instance_ip"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		assertRowError(t, err, 2, "instance_ip", "")
	})

	t.Run("invalid IPv4 fails with value", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["instance_ip"] = "999.999.999.999"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		rerr := assertRowError(t, err, 2, "instance_ip", "999.999.999.999")
		assert.Contains(t, rerr.Detail.Reason, "IPv4")
	})

	t.Run("missing instance_name fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["instance_name"] = ""
		vals["hostname"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		assertRowError(t, err, 2, "instance_name", "")
	})

	t.Run("invalid env fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["env"] = "qa"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		assertRowError(t, err, 2, "env", "qa")
	})

	t.Run("unregistered domain fails with closed-loop copy", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["network_domain"] = "ghost"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil) // ok 只认 default
		rerr := assertRowError(t, err, 2, "network_domain_id", "ghost")
		assert.Contains(t, rerr.Detail.Reason, "网域 ghost 未登记，请先到『系统设置 → 网域管理』登记后重新导入")
	})

	t.Run("empty domain auto-fills default", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["network_domain"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, models.DefaultDomainID, row.Input.NetworkDomainID)
	})

	t.Run("biz_code optional for host (决策 93)", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["biz_code"] = ""
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, "", row.Input.BizCode, "host 业务可空，空值不注入 biz 标签")
	})

	t.Run("disabled/unknown biz_code fails with closed-loop copy", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["biz_code"] = "legacy" // sampleYAML 中停用项
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		rerr := assertRowError(t, err, 2, "biz_code", "legacy")
		assert.Contains(t, rerr.Detail.Reason, "业务 legacy 未登记且未在声明 sheet 声明，请在『业务管理』页登记，或在本文件『业务声明』sheet 补充后重新导入。若你使用的是旧模板，可能缺少最新字典值，请重新下载模板后填写")
	})

	t.Run("malformed biz_code fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["biz_code"] = "Bad_Code"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
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
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, "database|default|10.0.0.10|3306", row.DedupKey)
	})

	t.Run("missing database_type fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["database_type"] = ""
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "database_type", "")
	})

	t.Run("missing app_name fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["app_code"] = ""
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "app_code", "")
	})

	t.Run("missing cluster fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["cluster"] = ""
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "cluster", "")
	})

	t.Run("port out of range fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["port"] = "70000"
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		rerr := assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "port", "70000")
		assert.Contains(t, rerr.Detail.Reason, "1~65535")
	})

	t.Run("non-numeric port fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryDatabase)
		vals["port"] = "abc"
		row := mustParse(t, models.ResourceCategoryDatabase, [][]string{makeRow(models.ResourceCategoryDatabase, vals)})[0]
		rerr := assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "port", "abc")
		assert.Contains(t, rerr.Detail.Reason, "整数")
	})
}

func TestValidateImportRow_Application(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	t.Run("valid application passes with explicit endpoint/port", func(t *testing.T) {
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{
			makeRow(models.ResourceCategoryApplication, baseValues(models.ResourceCategoryApplication)),
		})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, "10.0.0.20", row.Input.Endpoint)
		assert.Equal(t, 8080, row.Input.Port)
		assert.Equal(t, "http", row.Input.Protocol)
		assert.Equal(t, "application|default|pay-service|http://10.0.0.20:8080/health", row.DedupKey)

	})

	t.Run("invalid health_check_url fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["health_check_url"] = "not-a-url"
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "health_check_url", "not-a-url")
	})

	t.Run("unsupported scheme in health_check_url fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["health_check_url"] = "ftp://10.0.0.20:8080/health"
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "health_check_url", "ftp://10.0.0.20:8080/health")
	})

	t.Run("missing health_check_url fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["health_check_url"] = ""
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "health_check_url", "")
	})

	t.Run("missing endpoint and port pass", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryApplication)
		vals["endpoint"] = ""
		vals["port"] = ""
		row := mustParse(t, models.ResourceCategoryApplication, [][]string{makeRow(models.ResourceCategoryApplication, vals)})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Empty(t, row.Input.Endpoint)
		assert.Zero(t, row.Input.Port)
	})
}

func TestValidateImportRow_GenericTarget(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	t.Run("valid generic passes and parses custom_labels", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		delete(vals, "app_code")
		delete(vals, "cluster")
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{
			makeRow(models.ResourceCategoryGenericTarget, vals),
		})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, "generic_target|default|10.0.0.30|161", row.DedupKey)
		require.NotNil(t, row.Input.CustomLabels)
		assert.Equal(t, "az1", row.Input.CustomLabels["zone"])
		assert.Equal(t, "prod", row.Input.CustomLabels["env"])
	})

	t.Run("invalid scheme fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		vals["scheme"] = "tcp"
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
		assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "scheme", "tcp")
	})

	t.Run("missing segment in custom_labels fails", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		vals["custom_labels"] = "keyonly"
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
		rerr := assertRowError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), 2, "custom_labels", "keyonly")
		assert.Contains(t, rerr.Detail.Reason, "key1=value1;key2=value2")
	})

	t.Run("empty key/value in custom_labels fails", func(t *testing.T) {
		for _, raw := range []string{"=v", "k="} {
			vals := baseValues(models.ResourceCategoryGenericTarget)
			vals["custom_labels"] = raw
			row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
			err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
			rerr := assertRowError(t, err, 2, "custom_labels", raw)
			assert.Contains(t, rerr.Detail.Reason, "key1=value1;key2=value2")
		}
	})

	t.Run("unregistered app_code fails with closed-loop copy and old-template hint", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryGenericTarget)
		vals["app_code"] = "ghost-app" // 既不在启用字典、也未在声明 sheet 申报
		row := mustParse(t, models.ResourceCategoryGenericTarget, [][]string{makeRow(models.ResourceCategoryGenericTarget, vals)})[0]
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		rerr := assertRowError(t, err, 2, "app_code", "ghost-app")
		assert.Contains(t, rerr.Detail.Reason, "应用 ghost-app 未登记且未在声明 sheet 声明，请在『应用管理』页登记，或在本文件『应用声明』sheet 补充后重新导入。若你使用的是旧模板，可能缺少最新字典值，请重新下载模板后填写")
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
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil), "source=%q", tc.source)
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
	err := ValidateImportRow(&row, store, newAppStore(t), ok, extra)
	rerr := assertRowError(t, err, 2, "status", "运行中")
	assert.Contains(t, rerr.Detail.Reason, "状态映射失败")

	// ValidateRows 层：该行计入 failed 而非 valid。
	rows := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})
	valid, errs := ValidateRows(rows, store, newAppStore(t), ok, extra)
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
		makeRow(models.ResourceCategoryHost, badIP),                                   // 第 3 行 非法 IP
		makeRow(models.ResourceCategoryHost, stopped),                                 // 第 4 行 已停止
	})
	valid, errs := ValidateRows(rows, store, newAppStore(t), ok, nil)

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
	valid, errs := ValidateRows(rows, store, newAppStore(t), ok, nil)

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
		{models.ResourceCategoryApplication, "application|default|pay-service|http://10.0.0.20:8080/health"},
		{models.ResourceCategoryGenericTarget, "generic_target|default|10.0.0.30|161"},
	}
	for _, tc := range cases {
		row := mustParse(t, tc.cat, [][]string{makeRow(tc.cat, baseValues(tc.cat))})[0]
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
		assert.Equal(t, tc.want, row.DedupKey, "资源类型 %s 判重键", tc.cat)
	}
}

// ---------------------------------------------------------------------------
// T01-P1：scrape_port Excel 导入侧（决策 D-7：导入解析与字段映射随模型进 P0；
// 模板列 TemplateColumns 由 T01-P7 处理，故此处直调 applyCells / 构造 ImportRow，
// 不走 ParseExcel 固定列头校验）
// ---------------------------------------------------------------------------

// TestApplyCells_ScrapePort 覆盖 applyCells 的 scrape_port 解析：数值 → int、
// 空 → 0（未指定）、非数字 → -1 哨兵（交由 ValidateImportRow 报行级错误）。
func TestApplyCells_ScrapePort(t *testing.T) {
	cases := []struct {
		name string
		cell string
		want int
	}{
		{"数值解析", "9100", 9100},
		{"空值→0（未指定）", "", 0},
		{"非数字→-1 哨兵", "abc", -1},
		{"显式 0", "0", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			row := ImportRow{Row: 2, Category: models.ResourceCategoryHost}
			applyCells(&row, []string{"scrape_port"}, []string{tc.cell})
			assert.Equal(t, tc.want, row.Input.ScrapePort)
		})
	}
}

// TestValidateImportRow_ScrapePort 覆盖导入行校验把越界 scrape_port 映射回
// §5.16.3 结构（field=scrape_port、value=原文），并守护 0（未指定）合法。
func TestValidateImportRow_ScrapePort(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")
	parseHost := func(t *testing.T) ImportRow {
		t.Helper()
		return mustParse(t, models.ResourceCategoryHost,
			[][]string{makeRow(models.ResourceCategoryHost, baseValues(models.ResourceCategoryHost))})[0]
	}

	t.Run("scrape_port 0（未指定）通过", func(t *testing.T) {
		row := parseHost(t)
		row.Input.ScrapePort = 0
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
	})

	t.Run("scrape_port 65536 越界映射 field/value", func(t *testing.T) {
		row := parseHost(t)
		row.Input.ScrapePort = 65536
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		rerr := assertRowError(t, err, 2, "scrape_port", "65536")
		assert.Contains(t, rerr.Detail.Reason, "scrape_port")
	})

	t.Run("scrape_port -1（非数字哨兵）被拒绝", func(t *testing.T) {
		row := parseHost(t)
		row.Input.ScrapePort = -1
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		rerr := assertRowError(t, err, 2, "scrape_port", "-1")
		assert.Contains(t, rerr.Detail.Reason, "scrape_port")
	})

	t.Run("scrape_port 正常值通过", func(t *testing.T) {
		row := parseHost(t)
		row.Input.ScrapePort = 19100
		require.NoError(t, ValidateImportRow(&row, store, newAppStore(t), ok, nil))
	})
}

// ---------------------------------------------------------------------------
// T01-P7：下载模板列末尾追加 scrape_port 后的导入兼容性回归（决策 D-7 P1）
// ---------------------------------------------------------------------------

// withoutScrapePort 返回去掉 scrape_port 列的模板列头（构造旧模板 xlsx 用）。
func withoutScrapePort(cols []string) []string {
	out := make([]string, 0, len(cols))
	for _, c := range cols {
		if c != "scrape_port" {
			out = append(out, c)
		}
	}
	return out
}

// TestExcelLegacyTemplateWithoutScrapePortStillImports 旧模板（无 scrape_port 列）
// 兼容回归：五类旧列头文件仍解析并行级校验成功，缺列按 0（未指定）处理。
func TestExcelLegacyTemplateWithoutScrapePortStillImports(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")
	for _, cat := range allCategories() {
		t.Run(string(cat), func(t *testing.T) {
			cols := TemplateColumns[cat]
			header := withoutScrapePort(cols)
			// 列序护栏（T01-P7 防列序依赖断裂）：**持有** scrape_port 的类别，该列必须在
			// 末列 —— 这是「旧模板去掉末列仍可导入」这条兼容路径成立的前提。
			// 接口服务用平台自带的 blackbox_exporter 探活（目标即完整 URL），无采集端口
			// 语义，其模板不含该列，故护栏按「有才断言」而非全类别硬性要求。
			if len(header) < len(cols) {
				require.Contains(t, cols, "scrape_port")
				require.Len(t, header, len(cols)-1)
			}
			vals := baseValues(cat)
			row := make([]string, len(header))
			for i, col := range header {
				row[i] = vals[col]
			}

			rows, err := ParseExcel(buildXLSXWithHeader(t, header, [][]string{row}), cat)
			require.NoError(t, err, "旧模板（无 scrape_port 列）导入应成功")
			require.Len(t, rows, 1)
			assert.Equal(t, 0, rows[0].Input.ScrapePort, "缺 scrape_port 列按 0（未指定）处理")
			require.NoError(t, ValidateImportRow(&rows[0], store, newAppStore(t), ok, nil))
		})
	}
}

// TestExcelTemplateWithScrapePortColumnWritesValue 新模板（末列含 scrape_port）
// 导入回归：单元格值写入 Input.ScrapePort，留空单元格按 0（未指定）。
// 仅覆盖**模板持有该列**的类别 —— 接口服务用平台自带 blackbox_exporter 探活、
// 无采集端口语义，其模板不含该列，不适用本用例。
func TestExcelTemplateWithScrapePortColumnWritesValue(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")
	for _, cat := range allCategories() {
		cols := TemplateColumns[cat]
		if len(cols) == 0 || cols[len(cols)-1] != "scrape_port" {
			continue
		}
		t.Run(string(cat), func(t *testing.T) {
			vals := baseValues(cat)
			vals["scrape_port"] = "19100"
			rows := mustParse(t, cat, [][]string{makeRow(cat, vals)})
			require.Len(t, rows, 1)
			assert.Equal(t, 19100, rows[0].Input.ScrapePort, "含列导入应写入正确值")
			require.NoError(t, ValidateImportRow(&rows[0], store, newAppStore(t), ok, nil))
		})
	}

	t.Run("留空单元格按 0", func(t *testing.T) {
		rows := mustParse(t, models.ResourceCategoryHost, [][]string{
			makeRow(models.ResourceCategoryHost, baseValues(models.ResourceCategoryHost)),
		})
		require.Len(t, rows, 1)
		assert.Equal(t, 0, rows[0].Input.ScrapePort)
	})

	t.Run("非数字 → -1 哨兵被行级校验拒绝", func(t *testing.T) {
		vals := baseValues(models.ResourceCategoryHost)
		vals["scrape_port"] = "abc"
		row := mustParse(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})[0]
		assert.Equal(t, -1, row.Input.ScrapePort)
		err := ValidateImportRow(&row, store, newAppStore(t), ok, nil)
		rerr := assertRowError(t, err, 2, "scrape_port", "-1")
		assert.Contains(t, rerr.Detail.Reason, "scrape_port")
	})
}

// ---------------------------------------------------------------------------
// 决策 101 后续：zone_env 废弃后的存量模板兼容回归
// ---------------------------------------------------------------------------

// legacyHostHeaderWithZoneEnv 构造废弃前的存量 host 模板列头：在 cluster 之后
// 插入 zone_env（原位置），共 14 列；其余列与当前 TemplateColumns[host] 一致。
func legacyHostHeaderWithZoneEnv() []string {
	cols := TemplateColumns[models.ResourceCategoryHost]
	out := make([]string, 0, len(cols)+1)
	for _, c := range cols {
		out = append(out, c)
		if c == "cluster" {
			out = append(out, "zone_env")
		}
	}
	return out
}

// TestExcelLegacyTemplateWithZoneEnvStillImports 存量模板（带已废弃的 zone_env 列）
// 兼容回归：按列名剔除后仍通过严格逐列比对，行级校验不因该列报错，且该列的值
// 不进入 ImportRow 的任何字段（静默忽略）。
func TestExcelLegacyTemplateWithZoneEnvStillImports(t *testing.T) {
	store := newBizStore(t)
	ok := existsDomains("default")

	header := legacyHostHeaderWithZoneEnv()
	require.Len(t, header, len(TemplateColumns[models.ResourceCategoryHost])+1,
		"存量模板应比当前模板多一列 zone_env")
	require.NotContains(t, TemplateColumns[models.ResourceCategoryHost], "zone_env",
		"当前 host 模板不应再输出 zone_env")

	vals := baseValues(models.ResourceCategoryHost)
	vals["zone_env"] = "GOV" // 存量文件里该列填了值，必须被忽略而非报错
	row := make([]string, len(header))
	for i, col := range header {
		row[i] = vals[col]
	}

	rows, err := ParseExcel(buildXLSXWithHeader(t, header, [][]string{row}), models.ResourceCategoryHost)
	require.NoError(t, err, "存量模板（带 zone_env）导入应成功，不得因该列报错")
	require.Len(t, rows, 1)
	require.NoError(t, ValidateImportRow(&rows[0], store, newAppStore(t), ok, nil))

	// 该列的值不落到任何字段：ImportRow 已无 ZoneEnv 字段，且行内其余字段正常解析。
	assert.Equal(t, "cluster-1", rows[0].Input.Cluster, "cluster 应正常解析（列序未被错位）")
	assert.Equal(t, "ops", rows[0].Input.Owner, "owner 应正常解析（zone_env 之后的列不错位）")
}

// TestExcelZoneEnvRemovedColumnStillRejectsRealExtraColumn 回归护栏：剔除废弃列
// 不能放宽为「列数相同即可」，真正未定义的动态列仍须报「超出模板」。
func TestExcelZoneEnvRemovedColumnStillRejectsRealExtraColumn(t *testing.T) {
	header := append(legacyHostHeaderWithZoneEnv(), "extra_col")
	_, err := ParseExcel(buildXLSXWithHeader(t, header, nil), models.ResourceCategoryHost)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "超出模板")
}

// TestExcelNonHostTemplatesUnaffectedByZoneEnvRemoval 回归断言：其余四类模板
// 本就不含 zone_env，废弃后列头与解析行为不变。
func TestExcelNonHostTemplatesUnaffectedByZoneEnvRemoval(t *testing.T) {
	for _, cat := range []models.ResourceCategory{
		models.ResourceCategoryDatabase,
		models.ResourceCategoryMiddleware,
		models.ResourceCategoryApplication,
		models.ResourceCategoryGenericTarget,
	} {
		t.Run(string(cat), func(t *testing.T) {
			assert.NotContains(t, TemplateColumns[cat], "zone_env", "非 host 模板不应含 zone_env")
			rows, err := ParseExcel(buildXLSXWithHeader(t, TemplateColumns[cat], nil), cat)
			require.NoError(t, err)
			assert.Empty(t, rows)
		})
	}
}
