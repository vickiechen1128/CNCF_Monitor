package draft

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// queryPage 解析 page/page_size，带默认与上限。
func queryPage(c *gin.Context) (page, pageSize int) {
	page = 1
	pageSize = 20
	if v := c.Query("page"); v != "" {
		fmt.Sscanf(v, "%d", &page)
	}
	if v := c.Query("page_size"); v != "" {
		fmt.Sscanf(v, "%d", &pageSize)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

// RegisterRoutes 将 Module_09 配置草稿端点挂到 /api/v2/platform 子组：
//   - POST       /config/drafts                      手动触发生成
//   - GET        /config-drafts                     列表（网域 + 状态筛选 + 分页）
//   - GET        /config-drafts/{change_no}         详情
//   - POST       /config-drafts/{change_no}/confirm     确认（生成 ConfigVersion）
//   - POST       /config-drafts/{change_no}/revalidate  重校验
//   - POST       /config-drafts/{change_no}/discard     废弃
//   - GET        /config-drafts/{change_no}/discard-impact 废弃影响预览
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	// 读列表 / 废弃影响预览端点保留在平台根组（仅全局认证 au-02）。
	platform.GET("/config-drafts", ListDraftsHandler(db))
	platform.GET("/config-drafts/:change_no/discard-impact", DiscardImpactHandler(db))

	// 写端点（生成/确认/重校验/废弃）与详情端点（返回草稿产物，含凭据明文：basic_auth /
	// bearer_token）统一挂 RequireAdmin 最小授权门（security-review B/C：管理类写接口仅
	// 认证不授权）。严格复用 main.go /users /tenants 的挂法。
	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	admin.POST("/config/drafts", GenerateDraftHandler(db))
	admin.GET("/config-drafts/:change_no", GetDraftHandler(db))
	admin.POST("/config-drafts/:change_no/confirm", ConfirmDraftHandler(db))
	admin.POST("/config-drafts/:change_no/revalidate", RevalidateDraftHandler(db))
	admin.POST("/config-drafts/:change_no/discard", DiscardDraftHandler(db))
}

// GenerateDraftHandler 处理 POST /api/v2/platform/config/drafts。
func GenerateDraftHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			NetworkDomainID string `json:"network_domain_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		d, err := GenerateDraft(db, req.NetworkDomainID)
		if err != nil {
			respondDraftError(c, err)
			return
		}
		response.OK(c, d)
	}
}

// ListDraftsHandler 处理 GET /api/v2/platform/config-drafts。
func ListDraftsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, pageSize := queryPage(c)
		items, total, err := ListDrafts(db, c.Query("network_domain_id"), c.Query("status"), page, pageSize)
		if err != nil {
			respondDraftError(c, err)
			return
		}
		if items == nil {
			items = []models.ConfigDraft{}
		}
		response.OK(c, gin.H{"items": items, "total": total})
	}
}

// GetDraftHandler 处理 GET /api/v2/platform/config-drafts/{change_no}。
func GetDraftHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		d, err := GetDraftDetail(db, c.Param("change_no"))
		if err != nil {
			respondDraftError(c, err)
			return
		}
		response.OK(c, d)
	}
}

// ConfirmDraftHandler 处理 POST /api/v2/platform/config-drafts/{change_no}/confirm。
// 该写端点挂 RequireAdmin；confirmed_by 取自动态认证上下文当前用户（review-fix C：
// 不信任客户端传参，越权伪造操作人被杜绝）。取不到标识符时回落 "unknown"。
func ConfirmDraftHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		confirmedBy := auth.CurrentUsername(c)
		version, err := ConfirmDraft(db, c.Param("change_no"), confirmedBy)
		if err != nil {
			respondDraftError(c, err)
			return
		}
		response.OK(c, version)
	}
}

// RevalidateDraftHandler 处理 POST /api/v2/platform/config-drafts/{change_no}/revalidate。
func RevalidateDraftHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		d, err := RevalidateDraft(db, c.Param("change_no"))
		if err != nil {
			respondDraftError(c, err)
			return
		}
		response.OK(c, gin.H{"validation_status": d.ValidationStatus})
	}
}

// DiscardDraftHandler 处理 POST /api/v2/platform/config-drafts/{change_no}/discard。
func DiscardDraftHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		d, impact, err := DiscardDraft(db, c.Param("change_no"))
		if err != nil {
			respondDraftError(c, err)
			return
		}
		response.OK(c, gin.H{"draft": d, "impact": impact})
	}
}

// DiscardImpactHandler 处理 GET /api/v2/platform/config-drafts/{change_no}/discard-impact。
func DiscardImpactHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		impact, err := GetDiscardImpact(db, c.Param("change_no"))
		if err != nil {
			respondDraftError(c, err)
			return
		}
		response.OK(c, impact)
	}
}

// respondDraftError 将服务层 sentinel 错误映射为统一响应。
func respondDraftError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrDomainNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrNoChanges):
		// 无实质变更：返回 200 + 空数据，前端可据此提示「当前无配置变更」。
		response.OK(c, gin.H{"message": "当前无配置变更", "no_changes": true})
	case errors.Is(err, ErrDomainNotMonitored),
		errors.Is(err, ErrDomainFrozen),
		errors.Is(err, ErrNotPending),
		errors.Is(err, ErrValidationNotPassed),
		errors.Is(err, ErrValidationStillFailed):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}