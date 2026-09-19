package resource

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// 测试构造 helper：带「业务声明」「应用声明」内联 sheet 的导入文件（决策 97）
// ---------------------------------------------------------------------------

// writeSheetRows 把 header + 数据行写入指定 sheet（构造声明 sheet 复用）。
func writeSheetRows(t *testing.T, f *excelize.File, sheet string, header []string, rows [][]string) {
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

// buildDeclareXLSX 构造含资源数据 sheet（sheet0，buildXLSX 语义）+「业务声明」/
// 「应用声明」内联 sheet 的导入文件（决策 97）。声明参数为 nil 表示不创建对应 sheet；
// 声明行格式 [code, name, 说明?]。
func buildDeclareXLSX(t *testing.T, category models.ResourceCategory, dataRows [][]string, bizDeclares, appDeclares [][]string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	writeSheetRows(t, f, sheet, TemplateColumns[category], dataRows)
	if bizDeclares != nil {
		_, err := f.NewSheet(bizDeclareSheet)
		require.NoError(t, err)
		writeSheetRows(t, f, bizDeclareSheet, []string{"biz_code", "biz_name", "说明"}, bizDeclares)
	}
	if appDeclares != nil {
		_, err := f.NewSheet(appDeclareSheet)
		require.NoError(t, err)
		writeSheetRows(t, f, appDeclareSheet, []string{"app_code", "app_name", "说明"}, appDeclares)
	}
	var buf bytes.Buffer
	require.NoError(t, f.Write(&buf))
	return buf.Bytes()
}

// mountImportOnDict 挂载导入 handler，biz/app 字典 store 与资源同库（决策 97 事务内
// 声明可见性依赖同库连接），供声明导入闭环测试使用。字典夹具 infra/app 已由
// openImportTestDB 预置。
func mountImportOnDict(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v2/platform/resources/:type/import",
		ImportResources(db, NewBusinessDomainStore(db), NewApplicationDictStore(db)))
	return r
}

// ---------------------------------------------------------------------------
// ParseDeclareSheets：声明 sheet 解析
// ---------------------------------------------------------------------------

func TestParseDeclareSheets_Valid(t *testing.T) {
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{hostRow("10.0.0.1", "运行中")},
		[][]string{{"new-biz", "新业务", "声明说明"}, {"pay-biz", "支付业务域"}},
		[][]string{{"new-app", "新应用"}, {"pay-app", "支付应用", "应用说明"}})

	sheets, err := ParseDeclareSheets(xlsx)
	require.NoError(t, err)
	require.Len(t, sheets.Biz, 2)
	assert.Equal(t, "new-biz", sheets.Biz[0].Code)
	assert.Equal(t, "新业务", sheets.Biz[0].Name)
	assert.Equal(t, "声明说明", sheets.Biz[0].Description)
	assert.Equal(t, "pay-biz", sheets.Biz[1].Code)
	assert.Equal(t, "", sheets.Biz[1].Description, "说明列可空")
	require.Len(t, sheets.App, 2)
	assert.Equal(t, "new-app", sheets.App[0].Code)
	assert.Equal(t, "新应用", sheets.App[0].Name)
	assert.Equal(t, "", sheets.App[0].Description)
	assert.Equal(t, "pay-app", sheets.App[1].Code)
	assert.Equal(t, "应用说明", sheets.App[1].Description)
}

func TestParseDeclareSheets_MissingSheetsOK(t *testing.T) {
	// 无声明 sheet：不报错，切片为空（存量模板文件兼容）。
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{hostRow("10.0.0.1", "运行中")})
	sheets, err := ParseDeclareSheets(xlsx)
	require.NoError(t, err)
	assert.Empty(t, sheets.Biz)
	assert.Empty(t, sheets.App)
}

func TestParseDeclareSheets_OnlyBizSheet(t *testing.T) {
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{hostRow("10.0.0.1", "运行中")},
		[][]string{{"new-biz", "新业务"}}, nil)
	sheets, err := ParseDeclareSheets(xlsx)
	require.NoError(t, err)
	require.Len(t, sheets.Biz, 1)
	assert.Empty(t, sheets.App)
}

func TestParseDeclareSheets_SkipsBlankRows(t *testing.T) {
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{hostRow("10.0.0.1", "运行中")},
		[][]string{{"new-biz", "新业务"}, {"", "", ""}},
		nil)
	sheets, err := ParseDeclareSheets(xlsx)
	require.NoError(t, err)
	require.Len(t, sheets.Biz, 1, "空行应被跳过")
	assert.Equal(t, "new-biz", sheets.Biz[0].Code)
}

func TestParseDeclareSheets_HeaderErrors(t *testing.T) {
	t.Run("mismatched column", func(t *testing.T) {
		f := excelize.NewFile()
		defer f.Close()
		writeSheetRows(t, f, f.GetSheetName(0), TemplateColumns[models.ResourceCategoryHost], [][]string{hostRow("10.0.0.1", "运行中")})
		_, err := f.NewSheet(bizDeclareSheet)
		require.NoError(t, err)
		// 第二列应为 biz_name，写成 biz_nm → 报错
		writeSheetRows(t, f, bizDeclareSheet, []string{"biz_code", "biz_nm", "说明"}, [][]string{{"new-biz", "新业务"}})
		var buf bytes.Buffer
		require.NoError(t, f.Write(&buf))
		_, perr := ParseDeclareSheets(buf.Bytes())
		require.Error(t, perr)
		assert.Contains(t, perr.Error(), bizDeclareSheet)
	})

	t.Run("extra dynamic column", func(t *testing.T) {
		f := excelize.NewFile()
		defer f.Close()
		writeSheetRows(t, f, f.GetSheetName(0), TemplateColumns[models.ResourceCategoryHost], [][]string{hostRow("10.0.0.1", "运行中")})
		_, err := f.NewSheet(appDeclareSheet)
		require.NoError(t, err)
		writeSheetRows(t, f, appDeclareSheet, []string{"app_code", "app_name", "说明", "extra"}, [][]string{{"new-app", "新应用"}})
		var buf bytes.Buffer
		require.NoError(t, f.Write(&buf))
		_, perr := ParseDeclareSheets(buf.Bytes())
		require.Error(t, perr)
		assert.Contains(t, perr.Error(), appDeclareSheet)
	})
}

func TestParseDeclareSheets_NotXLSX(t *testing.T) {
	_, err := ParseDeclareSheets([]byte("this is not a valid xlsx"))
	require.Error(t, err)
}

// ---------------------------------------------------------------------------
// validateDeclareSheets：声明自身校验（决策 97 顺序 ①）
// ---------------------------------------------------------------------------

func TestValidateDeclareSheets_NewCodesPass(t *testing.T) {
	sheets := &DeclareSheets{
		Biz: []DeclareEntry{{Code: "new-biz", Name: "新业务"}},
		App: []DeclareEntry{{Code: "new-app", Name: "新应用"}},
	}
	require.NoError(t, validateDeclareSheets(sheets, newBizStore(t), newAppStore(t)))
}

func TestValidateDeclareSheets_MissingCodeFails(t *testing.T) {
	sheets := &DeclareSheets{Biz: []DeclareEntry{{Code: "", Name: "无名"}}}
	err := validateDeclareSheets(sheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "biz_code 必填")
}

func TestValidateDeclareSheets_MissingNameFails(t *testing.T) {
	sheets := &DeclareSheets{Biz: []DeclareEntry{{Code: "new-biz", Name: ""}}}
	err := validateDeclareSheets(sheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "缺少名称")
}

func TestValidateDeclareSheets_InvalidCodeFails(t *testing.T) {
	sheets := &DeclareSheets{App: []DeclareEntry{{Code: "Bad_App", Name: "非法编码"}}}
	err := validateDeclareSheets(sheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "不符合规范")
}

func TestValidateDeclareSheets_DuplicateCodeHardRejected(t *testing.T) {
	sheets := &DeclareSheets{Biz: []DeclareEntry{
		{Code: "new-biz", Name: "新业务"},
		{Code: "new-biz", Name: "重复业务"},
	}}
	err := validateDeclareSheets(sheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "声明内重码")
}

func TestValidateDeclareSheets_ExistingSameNameIdempotent(t *testing.T) {
	// 存量字典 infra 名称一致 → 幂等跳过，不报错。
	sheets := &DeclareSheets{Biz: []DeclareEntry{{Code: "infra", Name: "公共基础设施"}}}
	require.NoError(t, validateDeclareSheets(sheets, newBizStore(t), newAppStore(t)))

	appSheets := &DeclareSheets{App: []DeclareEntry{{Code: "app", Name: "示例应用"}}}
	require.NoError(t, validateDeclareSheets(appSheets, newBizStore(t), newAppStore(t)))
}

func TestValidateDeclareSheets_ExistingDifferentNameHardRejected(t *testing.T) {
	sheets := &DeclareSheets{Biz: []DeclareEntry{{Code: "infra", Name: "改了个名"}}}
	err := validateDeclareSheets(sheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "绝不覆盖")
}

func TestValidateDeclareSheets_DisabledEntryRejected(t *testing.T) {
	// 存量停用条目不接受声明激活（决策 97）。
	sheets := &DeclareSheets{Biz: []DeclareEntry{{Code: "legacy", Name: "遗留系统"}}}
	err := validateDeclareSheets(sheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "停用")

	appSheets := &DeclareSheets{App: []DeclareEntry{{Code: "legacy-app", Name: "遗留应用"}}}
	err = validateDeclareSheets(appSheets, newBizStore(t), newAppStore(t))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "停用")
}

// ---------------------------------------------------------------------------
// applyDeclaredDicts：声明建字典（status=enabled、source=excel-import、只增不覆盖）
// ---------------------------------------------------------------------------

func TestApplyDeclaredDicts_CreatesWithExcelImportSource(t *testing.T) {
	db := openImportTestDB(t)
	sheets := &DeclareSheets{
		Biz: []DeclareEntry{{Code: "new-biz", Name: "新业务", Description: "声明"}},
		App: []DeclareEntry{{Code: "new-app", Name: "新应用"}},
	}
	require.NoError(t, applyDeclaredDicts(db, sheets))

	var biz models.BusinessDomain
	require.NoError(t, db.Where("code = ?", "new-biz").First(&biz).Error)
	assert.True(t, biz.Enabled, "声明建出条目默认启用")
	assert.Equal(t, models.DictSourceExcelImport, biz.Source, "声明建出条目 source=excel-import")
	assert.Equal(t, "声明", biz.Description)

	var app models.ApplicationDict
	require.NoError(t, db.Where("app_code = ?", "new-app").First(&app).Error)
	assert.Equal(t, models.AppStatusEnabled, app.Status)
	assert.Equal(t, models.DictSourceExcelImport, app.Source)
}

func TestApplyDeclaredDicts_SkipsExisting(t *testing.T) {
	db := openImportTestDB(t)
	// 存量同名条目（幂等跳过）——只增不覆盖，名称与描述保持存量值。
	sheets := &DeclareSheets{
		Biz: []DeclareEntry{{Code: "infra", Name: "篡改名", Description: "篡改描述"}},
		App: []DeclareEntry{{Code: "app", Name: "篡改名", Description: "篡改描述"}},
	}
	require.NoError(t, applyDeclaredDicts(db, sheets))

	var biz models.BusinessDomain
	require.NoError(t, db.Where("code = ?", "infra").First(&biz).Error)
	assert.Equal(t, "公共基础设施", biz.Name, "存量条目不被覆盖")

	var app models.ApplicationDict
	require.NoError(t, db.Where("app_code = ?", "app").First(&app).Error)
	assert.Equal(t, "示例应用", app.AppName, "存量条目不被覆盖")
}

// ---------------------------------------------------------------------------
// 声明导入闭环（handler 级，决策 97：声明建字典+落资源同批原子）
// ---------------------------------------------------------------------------

func TestImportResource_DeclareSheets_CreatesDictAndResources(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImportOnDict(t, db)

	// host 行引用新 biz 与 新 app（均由声明 sheet 补充）。
	vals := baseValues(models.ResourceCategoryHost)
	vals["biz_code"] = "new-biz"
	vals["app_code"] = "new-app"
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{makeRow(models.ResourceCategoryHost, vals)},
		[][]string{{"new-biz", "新业务"}},
		[][]string{{"new-app", "新应用"}})

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusOK, w.Code, "导入应成功：%s", out.Error)
	assert.Equal(t, 1, out.Data.Success)
	assert.Equal(t, 0, out.Data.Failed)

	// 字典与资源同落：声明建出条目 source=excel-import、启用，写入全局字典。
	var biz models.BusinessDomain
	require.NoError(t, db.Where("code = ?", "new-biz").First(&biz).Error)
	assert.True(t, biz.Enabled)
	assert.Equal(t, models.DictSourceExcelImport, biz.Source)
	var app models.ApplicationDict
	require.NoError(t, db.Where("app_code = ?", "new-app").First(&app).Error)
	assert.Equal(t, models.AppStatusEnabled, app.Status)
	assert.Equal(t, models.DictSourceExcelImport, app.Source)
	// 资源落库。
	assert.Equal(t, int64(1), countHosts(t, db))
	var h models.Host
	require.NoError(t, db.Where("private_ip = ?", "10.0.0.1").First(&h).Error)
	assert.Equal(t, "new-biz", h.BizCode)
	assert.Equal(t, "new-app", h.AppCode, "Host 物理列 app_code（决策 92）")
	// ImportRecord 同事务落库。
	rec := loadLatestImport(t, db)
	assert.Equal(t, models.ImportStatusSuccess, rec.Status)
}

func TestImportResource_DeclareSheets_AtomicRollbackNoOrphanDict(t *testing.T) {
	db := openImportTestDB(t)
	// 强制资源写失败：drop hosts 表 → 事务内声明已写、资源写报错 → 整体回滚。
	require.NoError(t, db.Migrator().DropTable(&models.Host{}))
	r := mountImportOnDict(t, db)

	vals := baseValues(models.ResourceCategoryHost)
	vals["biz_code"] = "new-biz"
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{makeRow(models.ResourceCategoryHost, vals)},
		[][]string{{"new-biz", "新业务"}}, nil)

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusInternalServerError, w.Code, "资源写失败应返回 500：%s", out.Error)

	// 整体回滚：不留孤立字典条目、不落 ImportRecord。
	var bizCount int64
	require.NoError(t, db.Model(&models.BusinessDomain{}).Count(&bizCount).Error)
	assert.Equal(t, int64(1), bizCount, "声明建出的业务条目应随事务回滚")
	var appCount int64
	require.NoError(t, db.Model(&models.ApplicationDict{}).Count(&appCount).Error)
	assert.Equal(t, int64(1), appCount)
	var recCount int64
	require.NoError(t, db.Model(&models.ImportRecord{}).Count(&recCount).Error)
	assert.Equal(t, int64(0), recCount, "失败导入不落 ImportRecord")
}

func TestImportResource_DeclareSheets_DuplicateNameRejected(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImportOnDict(t, db)

	// 声明 infra 但名称不一致 → 硬拒绝（绝不覆盖）→ bad_request 整体拒绝。
	vals := baseValues(models.ResourceCategoryHost)
	vals["biz_code"] = "infra"
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{makeRow(models.ResourceCategoryHost, vals)},
		[][]string{{"infra", "篡改业务名"}}, nil)

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "绝不覆盖")
	assert.Equal(t, int64(0), countHosts(t, db), "声明自身失败整批拒绝、不落资源")
}

func TestImportResource_DeclareSheets_MissingNameRejected(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImportOnDict(t, db)

	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{hostRow("10.0.0.1", "运行中")},
		[][]string{{"new-biz", ""}}, nil) // 声明内缺 name → 声明自身校验失败

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, out.Error, "缺少名称")
	assert.Equal(t, int64(0), countHosts(t, db))
}

func TestImportResource_DeclareSheets_UndeclaredCodeGoesToPendingList(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImportOnDict(t, db)

	// 行 1 引用已声明码 → 通过；行 2 引用既不存、也未声明的码 → 归入「待登记清单」。
	row1 := baseValues(models.ResourceCategoryHost)
	row1["biz_code"] = "new-biz"
	row2 := baseValues(models.ResourceCategoryHost)
	row2["instance_ip"] = "10.0.0.2"
	row2["instance_name"] = "web-02"
	row2["hostname"] = "web-02"
	row2["biz_code"] = "ghost-biz"
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{makeRow(models.ResourceCategoryHost, row1), makeRow(models.ResourceCategoryHost, row2)},
		[][]string{{"new-biz", "新业务"}}, nil)

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusOK, w.Code, "部分失败仍返回 200")
	assert.Equal(t, 1, out.Data.Success)
	assert.Equal(t, 1, out.Data.Failed)
	require.Len(t, out.Data.Errors, 1)
	assert.Equal(t, 3, out.Data.Errors[0].Row)
	assert.Equal(t, "biz_code", out.Data.Errors[0].Field)
	assert.Equal(t, "ghost-biz", out.Data.Errors[0].Value)
	assert.Contains(t, out.Data.Errors[0].Reason, "声明", "待登记清单给声明 sheet 引导文案")

	// 声明建出的条目与成功行资源照常落库。
	var biz models.BusinessDomain
	require.NoError(t, db.Where("code = ?", "new-biz").First(&biz).Error)
	assert.Equal(t, models.DictSourceExcelImport, biz.Source)
	assert.Equal(t, int64(1), countHosts(t, db))
}

func TestImportResource_DeclareSheets_IdempotentReimport(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImportOnDict(t, db)

	vals := baseValues(models.ResourceCategoryHost)
	vals["biz_code"] = "new-biz"
	xlsx := buildDeclareXLSX(t, models.ResourceCategoryHost,
		[][]string{makeRow(models.ResourceCategoryHost, vals)},
		[][]string{{"new-biz", "新业务"}}, nil)

	_, out1 := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host", "mode": "create_only",
	})
	require.Equal(t, 1, out1.Data.Success)

	// 同文件重导：声明幂等跳过（不重复建、不覆盖），资源判重命中计入 failed。
	_, out2 := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host", "mode": "create_only",
	})
	require.Equal(t, 0, out2.Data.Success)
	require.Equal(t, 1, out2.Data.Failed)
	var bizCount int64
	require.NoError(t, db.Model(&models.BusinessDomain{}).Where("code = ?", "new-biz").Count(&bizCount).Error)
	assert.Equal(t, int64(1), bizCount, "重导不重复建字典")
	var biz models.BusinessDomain
	require.NoError(t, db.Where("code = ?", "new-biz").First(&biz).Error)
	assert.Equal(t, "新业务", biz.Name, "重导不覆盖存量字典名")
}
