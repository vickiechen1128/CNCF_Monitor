// import.go 提供 Excel 导入执行接口（POST /api/v2/platform/resources/:type/import，
// T07-10）：multipart/form-data 解析 `file` + `resource_category` + `mode`
// （create_only 缺省 / upsert，§6.1）；复用 T07-09 ParseExcel/ValidateRows 完成
// 解析与行级校验；逐行按判重键（T07-03 DedupKey）定位已有资源并执行 create_only/
// upsert（§5.16.2）；返回 §5.16.3 结构；导入完成后落 ImportRecord（§6.4）。
//
// 计数口径（对齐 T07-10 验收要点 2）：未命中判重键 → 新建 success++；upsert 命中
// → 覆盖更新 updated++；create_only 命中 → failed 并记录错误行（部分成功不整体回滚，
// 失败行不写入）。
package resource

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// importOperator 是 MVP 导入操作人（Module_07 §6.4：MVP 操作人固定 platform_admin）。
const importOperator = models.PlatformAdminTenantID

// maxImportFileSize 限制 Excel 导入文件大小（≤10MB，防恶意超大 xlsx 内存耗尽）。
const maxImportFileSize = 10 << 20

// ImportResources 是 POST /api/v2/platform/resources/:type/import 的导入执行 handler。
//
// 流程：
//  1. 资源类型：优先取表单 `resource_category`，缺省回退路径 `:type`（T07-18 路由
//     为 /resources/:type/import，前端 F1 仅传 file+mode）；非法返回 bad_request；
//  2. mode：缺省 create_only；非法返回 bad_request；
//  3. file：multipart 文件字段，缺失/读取失败返回 bad_request；
//  4. 复用 T07-09 ParseExcel + ValidateRows：解析失败（列头不符/非 xlsx）返回
//     bad_request；行级校验失败行收集为 errs（§5.16.3 结构）并计入 failed；
//  5. 逐行执行：按判重键 findExistingByDedupKey 定位（GORM 自动排除软删）——
//     upsert 命中 → applyInputToModel + updatableColumns 覆盖更新（source_type 等
//     不可变列不进入更新列，T07-06）；create_only 命中 → 计 failed 并记录
//     dedup_key 冲突错误；未命中 → buildResourceModel 新建并把 source_type 置
//     import（§5.2）；
//  6. 落 ImportRecord（mode/total/success/updated/failed/status/errors/operator，
//     状态 success 或 partial，§6.4）；
//  7. 返回 §5.16.3：{total, success, updated, failed, errors:[{row, resource_category,
//     field, value, reason}]}，create_only 不含 updated 字段。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func ImportResources(db *gorm.DB, bizStore *BusinessDomainStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. 资源类型：表单优先，路径 :type 兜底。
		categoryStr := strings.TrimSpace(c.PostForm("resource_category"))
		if categoryStr == "" {
			categoryStr = strings.TrimSpace(c.Param("type"))
		}
		category := models.ResourceCategory(categoryStr)
		if !isValidCategory(category) {
			response.BadRequest(c, fmt.Errorf("resource_category 非法：%q，可选 host/database/middleware/application/generic_target", categoryStr))
			return
		}

		// 2. mode：缺省 create_only（§6.1）。
		modeStr := strings.TrimSpace(c.PostForm("mode"))
		mode := models.ImportMode(modeStr)
		if modeStr == "" {
			mode = models.ImportModeCreateOnly
		}
		if mode != models.ImportModeCreateOnly && mode != models.ImportModeUpsert {
			response.BadRequest(c, fmt.Errorf("mode 非法：%q，可选 create_only/upsert（缺省 create_only）", modeStr))
			return
		}

		// 3. 上传文件（≤10MB 限制，防超大文件内存耗尽）。
		fileHeader, err := c.FormFile("file")
		if err != nil {
			response.BadRequest(c, fmt.Errorf("file 必填：请上传 .xlsx 模板文件"))
			return
		}
		if fileHeader.Size > maxImportFileSize {
			response.BadRequest(c, fmt.Errorf("文件大小超过限制（最大 10MB）"))
			return
		}
		f, err := fileHeader.Open()
		if err != nil {
			response.BadRequest(c, fmt.Errorf("读取上传文件失败：%w", err))
			return
		}
		defer f.Close()
		fileBytes, err := io.ReadAll(f)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("读取上传文件内容失败：%w", err))
			return
		}

		// 4. 解析 + 行级校验（T07-09 复用）。
		rows, err := ParseExcel(fileBytes, category)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		valid, errs := ValidateRows(rows, bizStore, networkDomainExistsFunc(db), nil)

		// 5. 逐行执行 create_only/upsert。
		total := len(rows)
		success, updated, failed := 0, 0, len(errs)
		for i := range valid {
			row := &valid[i]
			existing, found, lerr := findExistingByDedupKey(db, category, row)
			if lerr != nil {
				response.InternalServerError(c, lerr)
				return
			}
			if found {
				if mode == models.ImportModeCreateOnly {
					// 判重命中即失败（§5.16.2），记录错误行。
					failed++
					errs = append(errs, models.ImportErrorDetail{
						Row:              row.Row,
						ResourceCategory: string(category),
						Field:            "dedup_key",
						Value:            row.DedupKey,
						Reason:           "判重键命中，已存在相同资源（create_only 模式不覆盖）",
					})
					continue
				}
				// upsert：覆盖更新（不可变列不进入更新列）。
				applyInputToModel(category, existing, &row.Input)
				cols := updatableColumns(category)
				if err := db.Model(existing).Select(cols).Updates(existing).Error; err != nil {
					response.InternalServerError(c, fmt.Errorf("更新 %s 资源失败（第 %d 行）：%w", category, row.Row, err))
					return
				}
				updated++
				continue
			}
			// 未命中：新建，source_type=import（§5.2）。
			model, err := buildResourceModel(category, &row.Input)
			if err != nil {
				response.InternalServerError(c, err)
				return
			}
			setSourceType(model, models.SourceTypeImport)
			if err := db.Create(model).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("创建 %s 资源失败（第 %d 行）：%w", category, row.Row, err))
				return
			}
			success++
		}

		// 6. 落 ImportRecord（§6.4）：状态 success 或 partial。
		status := models.ImportStatusSuccess
		if failed > 0 {
			status = models.ImportStatusPartial
		}
		// 全成功时 errs 为 nil，规范化为空数组（§7.2 空数组约定，避免响应/落库为 null）。
		if errs == nil {
			errs = []models.ImportErrorDetail{}
		}
		record := models.ImportRecord{
			ImportNo:         newImportNo(),
			ResourceCategory: category,
			Mode:             mode,
			Total:            total,
			Success:          success,
			Updated:          updated,
			Failed:           failed,
			Status:           status,
			Errors:           errs,
			Operator:         importOperator,
		}
		if err := db.Create(&record).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("写入导入记录失败：%w", err))
			return
		}

		// 7. §5.16.3 响应：create_only 不含 updated 字段。
		data := gin.H{
			"total":   total,
			"success": success,
			"failed":  failed,
			"errors":  errs,
		}
		if mode == models.ImportModeUpsert {
			data["updated"] = updated
		}
		response.OK(c, data)
	}
}

// findExistingByDedupKey 按导入行判重键定位已有资源（Module_07 §5.16.2）。判重键
// 字段映射到模型列（host 的 instance_ip 对应 legacy 列 private_ip），GORM 默认
// 排除软删记录。命中返回该类型的具体模型指针；未命中 found=false。
func findExistingByDedupKey(db *gorm.DB, category models.ResourceCategory, row *ImportRow) (model any, found bool, err error) {
	in := &row.Input
	switch category {
	case models.ResourceCategoryHost:
		var h models.Host
		result := db.Where("network_domain_id = ? AND private_ip = ?", in.NetworkDomainID, in.InstanceIP).First(&h)
		if result.Error == nil {
			return &h, true, nil
		}
		if result.Error != gorm.ErrRecordNotFound {
			return nil, false, fmt.Errorf("按判重键定位 host：%w", result.Error)
		}
	case models.ResourceCategoryDatabase:
		var d models.Database
		result := db.Where("network_domain_id = ? AND instance_ip = ? AND port = ?", in.NetworkDomainID, in.InstanceIP, in.Port).First(&d)
		if result.Error == nil {
			return &d, true, nil
		}
		if result.Error != gorm.ErrRecordNotFound {
			return nil, false, fmt.Errorf("按判重键定位 database：%w", result.Error)
		}
	case models.ResourceCategoryMiddleware:
		var m models.Middleware
		result := db.Where("network_domain_id = ? AND instance_ip = ? AND port = ?", in.NetworkDomainID, in.InstanceIP, in.Port).First(&m)
		if result.Error == nil {
			return &m, true, nil
		}
		if result.Error != gorm.ErrRecordNotFound {
			return nil, false, fmt.Errorf("按判重键定位 middleware：%w", result.Error)
		}
	case models.ResourceCategoryApplication:
		var a models.Application
		result := db.Where("network_domain_id = ? AND service_name = ? AND endpoint = ?", in.NetworkDomainID, in.ServiceName, in.Endpoint).First(&a)
		if result.Error == nil {
			return &a, true, nil
		}
		if result.Error != gorm.ErrRecordNotFound {
			return nil, false, fmt.Errorf("按判重键定位 application：%w", result.Error)
		}
	case models.ResourceCategoryGenericTarget:
		var g models.GenericTarget
		result := db.Where("network_domain_id = ? AND instance_ip = ? AND port = ?", in.NetworkDomainID, in.InstanceIP, in.Port).First(&g)
		if result.Error == nil {
			return &g, true, nil
		}
		if result.Error != gorm.ErrRecordNotFound {
			return nil, false, fmt.Errorf("按判重键定位 generic_target：%w", result.Error)
		}
	}
	return nil, false, nil
}

// setSourceType 将导入新建资源的 source_type 置为 import（Module_07 §5.2）。创建
// 辅助 buildResourceModel 固定 source_type=manual，导入需覆盖为 import。
func setSourceType(model any, st models.SourceType) {
	switch m := model.(type) {
	case *models.Host:
		m.SourceType = st
	case *models.Database:
		m.SourceType = st
	case *models.Middleware:
		m.SourceType = st
	case *models.Application:
		m.SourceType = st
	case *models.GenericTarget:
		m.SourceType = st
	}
}

// newImportNo 生成唯一导入编号（IMP + 时间戳 + 随机 hex），满足 ImportRecord
// ImportNo 唯一索引（size≤64）。
func newImportNo() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("IMP%s", time.Now().Format("20060102150405.000000000"))
	}
	return fmt.Sprintf("IMP%s%s", time.Now().Format("20060102150405"), hex.EncodeToString(b))
}
