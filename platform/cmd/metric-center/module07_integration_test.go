package main

// 本文件收口 T07-97-B2 的端到端集成测试（决策 92/97，memory DB + seed）：
//
//   - TestModule07ApplicationDictEndToEnd：application-dict 管理闭环——登记 → 受限
//     编辑 → 停用 → resource 引用停用拒绝（决策 92 红线）；
//   - TestModule07DeclareImportEndToEnd：Excel 声明导入闭环（决策 97）——声明建字典
//     + 落资源同批原子提交、资源失败整体回滚不留字典、声明内重码硬拒绝、声明内缺
//     name 报错、未登记未声明码归入「待登记清单」（部分成功）。
//
// 复用 main_test.go 的 buildIntegrationEngine（已挂 /api/v2/platform/* 全量路由 +
// application-dict + import + 字典夹具 seed），本文件只补充声明 sheet 的 xlsx 构造
// helper 与各用例断言，不新增任何路由。

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

// 声明 sheet 名（与 resource 包 excel_declare.go 常量一致；跨包不导出，本地重声明）。
const (
	intBizDeclareSheet = "业务声明"
	intAppDeclareSheet = "应用声明"
)

// buildDeclareXLSX 构造含资源数据 sheet（sheet0）+「业务声明」「应用声明」内联 sheet
// 的导入文件（决策 97）。声明参数为 nil 表示不创建对应 sheet；声明行格式
// [code, name, 说明?]。
func buildDeclareXLSX(t *testing.T, category models.ResourceCategory, dataRows [][]string, bizDeclares, appDeclares [][]string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	for i, col := range resourceTemplateColumns(t, category) {
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
	if bizDeclares != nil {
		_, err := f.NewSheet(intBizDeclareSheet)
		require.NoError(t, err)
		writeDeclareSheet(t, f, intBizDeclareSheet, []string{"biz_code", "biz_name", "说明"}, bizDeclares)
	}
	if appDeclares != nil {
		_, err := f.NewSheet(intAppDeclareSheet)
		require.NoError(t, err)
		writeDeclareSheet(t, f, intAppDeclareSheet, []string{"app_code", "app_name", "说明"}, appDeclares)
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

// writeDeclareSheet 把 header + 数据行写入指定 sheet（构造声明 sheet 复用）。
func writeDeclareSheet(t *testing.T, f *excelize.File, sheet string, header []string, rows [][]string) {
	t.Helper()
	for i, col := range header {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		require.NoError(t, err)
		require.NoError(t, f.SetCellValue(sheet, cell, col))
	}
	for r, row := range rows {
		for c, val := range row {
			cell, err := excelize.CoordinatesToCellName(c+1, r+2)
			require.NoError(t, err)
			require.NoError(t, f.SetCellValue(sheet, cell, val))
		}
	}
}

// resourceTemplateColumns 返回某资源类型 Excel 模板列头（与 resource.TemplateColumns
// 等价；host 行构造用硬编码列序，见 declareHostRow）。
func resourceTemplateColumns(t *testing.T, category models.ResourceCategory) []string {
	t.Helper()
	switch category {
	case models.ResourceCategoryHost:
		return []string{"network_domain", "instance_name", "hostname", "instance_ip", "os_type",
			"biz_code", "app_code", "env", "cluster", "owner", "status"}
	default:
		t.Fatalf("unexpected category %s", category)
		return nil
	}
}

// declareHostRow 构造一行 host 导入数据（列序对齐 TemplateColumns[host]）：
// network_domain, instance_name, hostname, instance_ip, os_type, biz_code, app_code,
// env, cluster, owner, status。
func declareHostRow(ip, biz, app string) []string {
	return []string{"default", "decl-web-" + ip, "decl-web-" + ip, ip, "Linux", biz, app, "prod", "cluster-1", "ops", "运行中"}
}

// TestModule07ApplicationDictEndToEnd 覆盖 application-dict 管理闭环（T07-97-B2
// 验收要点 2a，决策 92）：登记 → 受限编辑 → 停用 → 新资源引用停用条目被拒。
func TestModule07ApplicationDictEndToEnd(t *testing.T) {
	r, dbm := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 1. GET：seed 预置 app/pay-web/pay-db 三条启用条目。
	code, out := c.json("GET", "/api/v2/platform/application-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(3), out["data"].(map[string]interface{})["total"])
	codes := make([]string, 0, 3)
	for _, it := range listItems(out) {
		item := it.(map[string]interface{})
		codes = append(codes, item["app_code"].(string))
		assert.Equal(t, "enabled", item["status"])
	}
	assert.ElementsMatch(t, []string{"app", "pay-web", "pay-db"}, codes)

	// 2. POST 登记：成功 → 200，默认 enabled=true，source=manual。
	code, out = c.json("POST", "/api/v2/platform/application-dict",
		`{"app_code":"new-app","app_name":"新应用","description":"集成登记"}`)
	require.Equal(t, http.StatusOK, code, "登记应成功：%v", out)
	assert.Equal(t, "success", out["status"])
	created := out["data"].(map[string]interface{})
	assert.Equal(t, "new-app", created["app_code"])
	assert.Equal(t, "新应用", created["app_name"])
	assert.Equal(t, "enabled", created["status"], "登记默认启用（决策 92）")

	// 3. POST 编码不规范 → bad_request（APP_CODE_RE 服务端预校验）。
	code, out = c.json("POST", "/api/v2/platform/application-dict", `{"app_code":"Bad_App","app_name":"非法编码"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 4. POST 重复 app_code → bad_request（编码不可变红线）。
	code, out = c.json("POST", "/api/v2/platform/application-dict", `{"app_code":"new-app","app_name":"重名"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// 5. PUT 受限编辑：改名 + 停用 new-app → 200；app_code 不受请求体影响。
	code, out = c.json("PUT", "/api/v2/platform/application-dict/new-app", `{"app_name":"新应用(新)","status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, "受限编辑应成功：%v", out)
	updated := out["data"].(map[string]interface{})
	assert.Equal(t, "新应用(新)", updated["app_name"])
	assert.Equal(t, "disabled", updated["status"])
	assert.Equal(t, "new-app", updated["app_code"], "app_code 创建后不可改")

	// 6. 停用不删除：GET 全量仍含 new-app（total=4）。
	code, out = c.json("GET", "/api/v2/platform/application-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(4), out["data"].(map[string]interface{})["total"], "停用不删除")

	// 7. resource 引用停用条目 → bad_request（决策 92 红线：录入处校验）。
	code, out = c.json("POST", "/api/v2/platform/resources",
		mustJSON(t, resourcePayload("host", map[string]interface{}{"app_code": "new-app"})))
	require.Equal(t, http.StatusBadRequest, code, "引用停用应用应被拒：%v", out)
	assert.Equal(t, "bad_request", out["errorType"])
	assert.Contains(t, out["error"], "停用")

	// 8. PUT 不存在条目 → not_found。
	code, _ = c.json("PUT", "/api/v2/platform/application-dict/not-exist", `{"app_name":"X"}`)
	assert.Equal(t, http.StatusNotFound, code)

	// 9. 无 DELETE 入口（停用不删除）→ 404。
	code, _ = c.json("DELETE", "/api/v2/platform/application-dict/new-app", "")
	assert.Equal(t, http.StatusNotFound, code)

	// 10. 字典落库断言：new-app 条目 source=manual、状态 disabled。
	var app models.ApplicationDict
	require.NoError(t, dbm.Where("app_code = ?", "new-app").First(&app).Error)
	assert.Equal(t, models.AppStatusDisabled, app.Status)
	assert.Equal(t, models.DictSourceManual, app.Source)
}

// TestModule07DeclareImportEndToEnd 覆盖 Excel 声明导入闭环（T07-97-B2 验收要点 2b，
// 决策 97）：声明建字典+落资源同批原子提交、资源失败整体回滚不留字典、重码硬拒绝、
// 声明内缺 name 报错、未登记未声明码归入「待登记清单」。
func TestModule07DeclareImportEndToEnd(t *testing.T) {
	r, dbm := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 0. 导入前字典基线：业务 3 条（infra/authorized-ops/data-innovation-lab）、应用 3 条。
	assertDictCounts(t, dbm, 3, 3)

	t.Run("声明建字典+落资源成功原子提交", func(t *testing.T) {
		xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
			[][]string{declareHostRow("10.9.1.1", "new-biz", "new-app")},
			[][]string{{"new-biz", "新业务", "声明说明"}},
			[][]string{{"new-app", "新应用"}})

		code, out := c.multipart("/api/v2/platform/resources/host/import",
			map[string]string{"resource_category": "host", "mode": "create_only"},
			"file", "data.xlsx", xlsx)
		require.Equal(t, http.StatusOK, code, "声明导入应成功：%v", out)
		data := out["data"].(map[string]interface{})
		assert.Equal(t, float64(1), data["success"])
		assert.Equal(t, float64(0), data["failed"])

		// 声明建出字典：enabled + source=excel-import（写入全局字典，web 下拉可用）。
		var biz models.BusinessDomain
		require.NoError(t, dbm.Where("code = ?", "new-biz").First(&biz).Error)
		assert.True(t, biz.Enabled)
		assert.Equal(t, models.DictSourceExcelImport, biz.Source)
		var app models.ApplicationDict
		require.NoError(t, dbm.Where("app_code = ?", "new-app").First(&app).Error)
		assert.Equal(t, models.AppStatusEnabled, app.Status)
		assert.Equal(t, models.DictSourceExcelImport, app.Source)

		// 资源落库：host 物理列 app_code（决策 92）。
		var h models.Host
		require.NoError(t, dbm.Where("private_ip = ?", "10.9.1.1").First(&h).Error)
		assert.Equal(t, "new-biz", h.BizCode)
		assert.Equal(t, "new-app", h.AppCode)

		// ImportRecord 同事务落库。
		var rec models.ImportRecord
		require.NoError(t, dbm.Order("id DESC").First(&rec).Error)
		assert.Equal(t, models.ImportStatusSuccess, rec.Status)
		assert.Equal(t, 1, rec.Success)
	})

	t.Run("资源失败整体回滚不留字典", func(t *testing.T) {
		// 强制资源写失败：drop hosts 表 → 事务内声明已写、资源写报错 → 整体回滚。
		require.NoError(t, dbm.Migrator().DropTable(&models.Host{}))
		xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
			[][]string{declareHostRow("10.9.2.1", "rollback-biz", "")},
			[][]string{{"rollback-biz", "回滚业务"}}, nil)

		code, out := c.multipart("/api/v2/platform/resources/host/import",
			map[string]string{"resource_category": "host", "mode": "create_only"},
			"file", "data.xlsx", xlsx)
		require.Equal(t, http.StatusInternalServerError, code, "资源写失败应 500：%v", out)

		// 整体回滚：不留孤立字典条目（业务仍 4 条 = 基线 3 + new-biz）、不留 ImportRecord。
		var biz models.BusinessDomain
		err := dbm.Where("code = ?", "rollback-biz").First(&biz).Error
		require.ErrorIs(t, err, gorm.ErrRecordNotFound, "声明建出的字典条目应随事务回滚")
		var bizTotal, appTotal, recTotal int64
		require.NoError(t, dbm.Model(&models.BusinessDomain{}).Count(&bizTotal).Error)
		assert.Equal(t, int64(4), bizTotal, "业务字典仅基线 3 + new-biz，无回滚残留")
		require.NoError(t, dbm.Model(&models.ApplicationDict{}).Count(&appTotal).Error)
		assert.Equal(t, int64(4), appTotal, "应用字典仅基线 3 + new-app，无回滚残留")
		require.NoError(t, dbm.Model(&models.ImportRecord{}).Count(&recTotal).Error)
		assert.Equal(t, int64(1), recTotal, "失败导入不落新 ImportRecord")

		// 恢复 hosts 表，供后续子测试继续使用同一内存库。
		require.NoError(t, dbm.AutoMigrate(&models.Host{}))
	})

	t.Run("声明内重码硬拒绝", func(t *testing.T) {
		xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
			[][]string{declareHostRow("10.9.3.1", "dup-biz", "")},
			[][]string{{"dup-biz", "业务A"}, {"dup-biz", "业务B"}}, nil)

		code, out := c.multipart("/api/v2/platform/resources/host/import",
			map[string]string{"resource_category": "host", "mode": "create_only"},
			"file", "data.xlsx", xlsx)
		require.Equal(t, http.StatusBadRequest, code, "声明内重码应 bad_request 整体拒绝：%v", out)
		assert.Equal(t, "bad_request", out["errorType"])
		assert.Contains(t, out["error"], "声明内重码")

		var biz models.BusinessDomain
		err := dbm.Where("code = ?", "dup-biz").First(&biz).Error
		require.ErrorIs(t, err, gorm.ErrRecordNotFound, "重码拒绝不落任何数据")
	})

	t.Run("声明内缺 name 报错", func(t *testing.T) {
		xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
			[][]string{declareHostRow("10.9.4.1", "noname-biz", "")},
			[][]string{{"noname-biz", ""}}, nil)

		code, out := c.multipart("/api/v2/platform/resources/host/import",
			map[string]string{"resource_category": "host", "mode": "create_only"},
			"file", "data.xlsx", xlsx)
		require.Equal(t, http.StatusBadRequest, code, "声明缺 name 应 bad_request：%v", out)
		assert.Contains(t, out["error"], "缺少名称")
	})

	t.Run("未登记未声明码归入待登记清单", func(t *testing.T) {
		// 行 1 引用已声明码 → 通过；行 2 引用既不存、也未声明的码 → 待登记清单（部分成功）。
		xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
			[][]string{declareHostRow("10.9.5.1", "new-biz", ""), declareHostRow("10.9.5.2", "ghost-biz", "")},
			[][]string{{"new-biz", "新业务"}}, nil)

		code, out := c.multipart("/api/v2/platform/resources/host/import",
			map[string]string{"resource_category": "host", "mode": "create_only"},
			"file", "data.xlsx", xlsx)
		require.Equal(t, http.StatusOK, code, "部分失败仍返回 200：%v", out)
		data := out["data"].(map[string]interface{})
		assert.Equal(t, float64(1), data["success"])
		assert.Equal(t, float64(1), data["failed"])
		errs := data["errors"].([]interface{})
		require.Len(t, errs, 1)
		first := errs[0].(map[string]interface{})
		assert.Equal(t, float64(3), first["row"])
		assert.Equal(t, "biz_code", first["field"])
		assert.Equal(t, "ghost-biz", first["value"])
		assert.Contains(t, first["reason"], "声明", "待登记清单给出声明 sheet 引导文案")
	})
}

// assertDictCounts 断言业务/应用字典条数（集成测试基线校验用）。
func assertDictCounts(t *testing.T, dbm *gorm.DB, bizCount, appCount int64) {
	t.Helper()
	var got int64
	require.NoError(t, dbm.Model(&models.BusinessDomain{}).Count(&got).Error)
	assert.Equal(t, bizCount, got)
	require.NoError(t, dbm.Model(&models.ApplicationDict{}).Count(&got).Error)
	assert.Equal(t, appCount, got)
}
