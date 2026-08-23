// import_records.go 提供导入记录查询接口（GET /api/v2/platform/imports、
// GET /api/v2/platform/imports/:import_id，T07-10）：列表支持 resource_category /
// status 筛选与分页，返回 {list,total,page,page_size}（03_API_Standard §7.2）；
// 详情返回含 errors 明细的 ImportRecord（Module_07 §6.4）。
package resource

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ListImports 是 GET /api/v2/platform/imports 的列表 handler。
//
// Query（Module_07 §6.4）：resource_category / status 筛选，page/page_size 分页
// （默认 1/50，上限 100，T07-03 ParsePageParams）。非法 resource_category / status
// 返回 bad_request。响应 data 为 {list, total, page, page_size}，list 按导入时间
// 倒序，item 为 ImportRecord（含 errors 明细，§5.16.3 结构）。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func ListImports(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		q := db.Model(&models.ImportRecord{})

		// resource_category 筛选：缺失不过滤，非法返回 bad_request。
		if raw := strings.TrimSpace(c.Query("resource_category")); raw != "" {
			category := models.ResourceCategory(raw)
			if !isValidCategory(category) {
				response.BadRequest(c, fmt.Errorf("resource_category 非法：%q，可选 host/database/middleware/application/generic_target", raw))
				return
			}
			q = q.Where("resource_category = ?", category)
		}
		// status 筛选：缺失不过滤，非法返回 bad_request。
		if raw := strings.TrimSpace(c.Query("status")); raw != "" {
			if !isValidImportStatus(raw) {
				response.BadRequest(c, fmt.Errorf("status 非法：%q，可选 success/partial/failed", raw))
				return
			}
			q = q.Where("status = ?", raw)
		}

		p := ParsePageParams(c.Request.URL.Query())

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count import records: %w", err))
			return
		}
		var list []models.ImportRecord
		if err := q.Order("created_at desc").
			Offset((p.Page - 1) * p.PageSize).
			Limit(p.PageSize).
			Find(&list).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list import records: %w", err))
			return
		}
		if list == nil {
			list = []models.ImportRecord{} // 空结果返回空 list 而非 null
		}

		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}

// GetImportRecord 是 GET /api/v2/platform/imports/:import_id 的详情 handler。
// 按导入记录主键 id 定位，返回含 errors 明细的完整 ImportRecord（§6.4）；
// 未命中/非法 id 返回 not_found。
func GetImportRecord(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.Param("import_id"))
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			response.NotFound(c, fmt.Sprintf("导入记录 %s 不存在", raw))
			return
		}

		var rec models.ImportRecord
		result := db.First(&rec, id)
		if result.Error != nil {
			if result.Error == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("导入记录 %s 不存在", raw))
				return
			}
			response.InternalServerError(c, fmt.Errorf("查询导入记录 %s 失败：%w", raw, result.Error))
			return
		}
		response.OK(c, rec)
	}
}

// isValidImportStatus 判断导入状态筛选值是否合法（success/partial/failed）。
func isValidImportStatus(s string) bool {
	switch models.ImportStatus(s) {
	case models.ImportStatusSuccess, models.ImportStatusPartial, models.ImportStatusFailed:
		return true
	}
	return false
}
