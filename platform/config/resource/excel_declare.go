// 本文件提供 Excel 导入「业务声明」「应用声明」内联 sheet 的解析、校验与落库
// （决策 97，Module_07 §5.16.1/§5.16.2/§5.18/§5.19）：
//
//   - ParseDeclareSheets：从导入文件解析两个可选 sheet（业务声明 = biz_code|
//     biz_name|说明?；应用声明 = app_code|app_name|说明?），缺省 sheet 返回空不报错；
//   - validateDeclareSheets：声明自身校验（校验顺序 ①）——code/name 必填、编码规范、
//     声明内重码硬拒绝、与存量字典同名（名称一致幂等跳过 / 不一致绝不覆盖）、
//     停用条目不接受声明激活；失败由调用方整体拒绝（bad_request）；
//   - applyDeclaredDicts：把校验通过的声明写入字典（status=enabled、
//     source=excel-import、只增不覆盖），在调用方事务内执行，与资源落库同批原子提交。
//
// 本文件只含解析/校验/写库纯逻辑，不注册路由；导入执行接入见 import.go。
package resource

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

// 声明 sheet 名（决策 97，与模板「取值说明」sheet 并列的固定命名）。
const (
	bizDeclareSheet = "业务声明"
	appDeclareSheet = "应用声明"
)

// 声明 sheet 固定列头（说明列可选）。
var (
	bizDeclareHeader = []string{"biz_code", "biz_name", "说明"}
	appDeclareHeader = []string{"app_code", "app_name", "说明"}
)

// DeclareEntry 是声明 sheet 中一行的解析结果（code/name 必填，说明可选）。
type DeclareEntry struct {
	Code        string
	Name        string
	Description string
}

// DeclareSheets 是资源导入文件内联声明 sheet 的解析结果（决策 97）。sheet 可缺省
// （存量模板文件兼容），缺省对应切片为空。
type DeclareSheets struct {
	Biz []DeclareEntry // 业务声明：biz_code | biz_name | 说明?
	App []DeclareEntry // 应用声明：app_code | app_name | 说明?
}

// ParseDeclareSheets 解析上传 Excel 中的「业务声明」「应用声明」两个内联 sheet。
// sheet 不存在时返回空切片不报错；存在时校验列头（前两列固定 code/name，第三列
// 「说明」可选，超出 3 列报错）并逐行解析，全空行跳过。不执行任何字典相关校验
// （由 validateDeclareSheets 负责）。
func ParseDeclareSheets(fileBytes []byte) (*DeclareSheets, error) {
	f, err := excelize.OpenReader(bytes.NewReader(fileBytes))
	if err != nil {
		return nil, fmt.Errorf("无法解析 Excel 文件，请上传 .xlsx 模板：%w", err)
	}
	defer f.Close()

	sheets := &DeclareSheets{}
	biz, err := parseDeclareSheet(f, bizDeclareSheet, bizDeclareHeader)
	if err != nil {
		return nil, err
	}
	sheets.Biz = biz
	app, err := parseDeclareSheet(f, appDeclareSheet, appDeclareHeader)
	if err != nil {
		return nil, err
	}
	sheets.App = app
	return sheets, nil
}

// parseDeclareSheet 读取单个声明 sheet：不存在返回空；列头校验（code/name 必填列
// 对齐、第三列可选「说明」、不允许超出 3 列）；数据行跳过全空行。
func parseDeclareSheet(f *excelize.File, sheet string, expected []string) ([]DeclareEntry, error) {
	if !sheetExists(f, sheet) {
		return nil, nil // sheet 缺省：无声明（存量模板兼容）
	}
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("读取「%s」sheet 失败：%w", sheet, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("「%s」sheet 缺少表头行", sheet)
	}
	header := trimCells(rows[0])
	if len(header) < 2 || header[0] != expected[0] || header[1] != expected[1] {
		return nil, fmt.Errorf("「%s」sheet 列头与模板不一致：前两列应为「%s」「%s」，第三列「说明」可选",
			sheet, expected[0], expected[1])
	}
	if len(header) > 3 {
		return nil, fmt.Errorf("「%s」sheet 列头超出模板：第 %d 列「%s」未定义（仅支持 %s/%s 与可选「说明」列）",
			sheet, 4, header[3], expected[0], expected[1])
	}
	if len(header) == 3 && header[2] != "说明" {
		return nil, fmt.Errorf("「%s」sheet 第三列应为「说明」，实际为「%s」", sheet, header[2])
	}

	out := make([]DeclareEntry, 0, len(rows)-1)
	for i := 1; i < len(rows); i++ {
		cells := trimCells(rows[i])
		if allEmpty(cells) {
			continue // 跳过空行
		}
		e := DeclareEntry{Code: cellAt(cells, 0), Name: cellAt(cells, 1)}
		if len(cells) > 2 {
			e.Description = cells[2]
		}
		out = append(out, e)
	}
	return out, nil
}

// cellAt 返回 cells[idx]（越界返回空串，容错 excelize 对尾部空单元格的裁剪）。
func cellAt(cells []string, idx int) string {
	if idx < len(cells) {
		return cells[idx]
	}
	return ""
}

// sheetExists 判断工作簿中是否存在指定名字的 sheet。
func sheetExists(f *excelize.File, name string) bool {
	for _, s := range f.GetSheetList() {
		if s == name {
			return true
		}
	}
	return false
}

// trimCells 逐格 TrimSpace 一行单元格。
func trimCells(cells []string) []string {
	out := make([]string, len(cells))
	for i, c := range cells {
		out[i] = strings.TrimSpace(c)
	}
	return out
}

// validateDeclareSheets 校验声明 sheet 自身（决策 97 校验顺序 ①声明自身）。
// 任一声明行不合法返回整体错误（调用方包装为 bad_request 整批拒绝）；成功返回 nil
// 表示声明可进入资源可达性（②）与整体写（③）阶段。
func validateDeclareSheets(sheets *DeclareSheets, bizStore *BusinessDomainStore, appStore *ApplicationDictStore) error {
	if sheets == nil {
		return nil
	}
	if err := validateDeclareEntries(bizDeclareSheet, sheets.Biz, models.ValidBizCode, func(code string) (name string, enabled bool, found bool, err error) {
		d, ok, lerr := bizStore.Lookup(code)
		if lerr != nil {
			return "", false, false, lerr
		}
		return d.Name, d.Enabled, ok, nil
	}); err != nil {
		return err
	}
	if err := validateDeclareEntries(appDeclareSheet, sheets.App, models.ValidAppCode, func(code string) (name string, enabled bool, found bool, err error) {
		d, ok, lerr := appStore.Lookup(code)
		if lerr != nil {
			return "", false, false, lerr
		}
		return d.AppName, d.Status == models.AppStatusEnabled, ok, nil
	}); err != nil {
		return err
	}
	return nil
}

// validateDeclareEntries 通用声明行校验：
//   - code/name 必填，编码符合 codeRe（BIZ_CODE_RE / APP_CODE_RE）；
//   - 声明内重码：硬拒绝（不静默去重）；
//   - 与存量字典同名：名称一致视为幂等跳过（通过）；名称不一致 → 硬拒绝
//     『声明码与存量字典名不一致，绝不覆盖』；
//   - 存量停用条目：不接受声明激活（拒绝，提示先到字典管理页启用）。
func validateDeclareEntries(sheet string, entries []DeclareEntry, codeRe *regexp.Regexp, lookup func(code string) (name string, enabled bool, found bool, err error)) error {
	seen := make(map[string]int, len(entries))
	for i, e := range entries {
		row := i + 2 // sheet 表头后第一行 = 第 2 行
		code := strings.TrimSpace(e.Code)
		name := strings.TrimSpace(e.Name)
		if code == "" {
			return fmt.Errorf("「%s」sheet 第 %d 行缺少编码（%s 必填）", sheet, row, sheetCodeField(sheet))
		}
		if name == "" {
			return fmt.Errorf("「%s」sheet 第 %d 行缺少名称（%s 必填）", sheet, row, sheetNameField(sheet))
		}
		if !codeRe.MatchString(code) {
			return fmt.Errorf("「%s」sheet 第 %d 行编码 %q 不符合规范（小写字母、数字和连字符，长度不超过 64）", sheet, row, code)
		}
		if prev, dup := seen[code]; dup {
			return fmt.Errorf("「%s」sheet 声明内重码：%q 同时出现在第 %d 行与第 %d 行（请去重后重新导入）", sheet, code, prev, row)
		}
		seen[code] = row

		dictName, enabled, found, err := lookup(code)
		if err != nil {
			return fmt.Errorf("查询存量字典 %s 失败：%w", code, err)
		}
		if !found {
			continue // 全新码：校验通过，交由 apply 阶段建字典
		}
		if dictName != name {
			// 决策 97：声明码与存量字典名不一致，绝不覆盖。
			return fmt.Errorf("声明码 %q 与存量字典名不一致（声明 %q vs 存量 %q），绝不覆盖", code, name, dictName)
		}
		if !enabled {
			return fmt.Errorf("声明码 %q 在存量字典中已停用，不接受声明激活（请先在字典管理页启用后重新导入）", code)
		}
		// 名称一致且启用：幂等跳过（apply 阶段不再写入）。
	}
	return nil
}

// sheetCodeField / sheetNameField 返回声明 sheet 的编码列/名称列展示名（错误文案用）。
func sheetCodeField(sheet string) string {
	if sheet == appDeclareSheet {
		return "app_code"
	}
	return "biz_code"
}

func sheetNameField(sheet string) string {
	if sheet == appDeclareSheet {
		return "app_name"
	}
	return "biz_name"
}

// applyDeclaredDicts 把校验通过的声明写入字典（决策 97 ③整体写的第一步）：
//   - 建出条目 status=enabled、source=excel-import，落全局字典（web 下拉可用，
//     不依赖资源存活）；
//   - 只增不覆盖：存量同名条目跳过（名称一致性已在 validateDeclareSheets 保证）。
//
// db 应传入调用方开启的事务连接（tx），与资源落库同一 SQLite 事务原子提交；
// 任一 DB 失败返回错误，由调用方整体回滚（不留孤立字典条目）。
func applyDeclaredDicts(db *gorm.DB, sheets *DeclareSheets) error {
	if sheets == nil || db == nil {
		return nil
	}
	for _, e := range sheets.Biz {
		var count int64
		if err := db.Model(&models.BusinessDomain{}).Where("code = ?", e.Code).Count(&count).Error; err != nil {
			return fmt.Errorf("检查业务声明 %s：%w", e.Code, err)
		}
		if count > 0 {
			continue // 只增不覆盖
		}
		row := models.BusinessDomain{
			Code:        e.Code,
			Name:        e.Name,
			Description: e.Description,
			Enabled:     true,
			Source:      models.DictSourceExcelImport,
		}
		if err := db.Create(&row).Error; err != nil {
			return fmt.Errorf("写入业务声明 %s：%w", e.Code, err)
		}
	}
	for _, e := range sheets.App {
		var count int64
		if err := db.Model(&models.ApplicationDict{}).Where("app_code = ?", e.Code).Count(&count).Error; err != nil {
			return fmt.Errorf("检查应用声明 %s：%w", e.Code, err)
		}
		if count > 0 {
			continue // 只增不覆盖
		}
		row := models.ApplicationDict{
			AppCode:     e.Code,
			AppName:     e.Name,
			Description: e.Description,
			Status:      models.AppStatusEnabled,
			Source:      models.DictSourceExcelImport,
		}
		if err := db.Create(&row).Error; err != nil {
			return fmt.Errorf("写入应用声明 %s：%w", e.Code, err)
		}
	}
	return nil
}
