// Package tenant implements Module_06 租户管理 MVP 子集 API（决策 44 修订）
// — 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md §6.1
// 与 docs/05-execution-records/module-06-tenant-user-auth/api-contract-snapshot.md §3。
// MVP 仅开放查看与编辑：GET 列表/详情 + PUT 编辑 name/multi_site_enabled；
// POST 新建与 PATCH status 禁用一律返回 forbidden（前端无入口，后端兜底拒绝）。
package tenant

import (
	"errors"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// RegisterRoutes mounts the Module 06 tenant-admin MVP subset endpoints under
// an `/api/v2/platform` sub-group (the caller passes the platform group).
// 认证中间件由 au-02 统一挂载，本任务路由与现网其它管理接口一致暂不鉴权。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	h := NewHandler(NewService(NewRepository(db)))
	platform.GET("/tenants", h.ListTenants)
	platform.GET("/tenants/:id", h.GetTenant)
	platform.PUT("/tenants/:id", h.UpdateTenant)
	platform.POST("/tenants", h.CreateTenantNotAllowed)
	platform.PATCH("/tenants/:id/status", h.UpdateTenantStatusNotAllowed)
}

// Handler adapts the tenant Service to HTTP, enforcing the unified response
// envelope and standard errorType mapping.
type Handler struct {
	svc *Service
}

// NewHandler constructs a Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// tenantDTO 是租户对象的对外序列化形态（契约快照 §3 字段集，不含敏感/越权字段）。
type tenantDTO struct {
	ID               string       `json:"id"`
	Name             string       `json:"name"`
	NetworkDomainIDs []string     `json:"network_domain_ids"`
	MultiSiteEnabled bool         `json:"multi_site_enabled"`
	IsPlatformAdmin  bool         `json:"is_platform_admin"`
	Status           string       `json:"status"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
	DeletedAt        *time.Time   `json:"deleted_at,omitempty"`
}

func toTenantDTO(tn *models.Tenant) tenantDTO {
	return tenantDTO{
		ID:               tn.ID,
		Name:             tn.Name,
		NetworkDomainIDs: tn.NetworkDomainIDs,
		MultiSiteEnabled: tn.MultiSiteEnabled,
		IsPlatformAdmin:  tn.IsPlatformAdmin,
		Status:           string(tn.Status),
		CreatedAt:        tn.CreatedAt,
		UpdatedAt:        tn.UpdatedAt,
		DeletedAt:        tn.DeletedAt,
	}
}

// updateTenantRequest is the body for PUT /tenants/:id。name 与 multi_site_enabled
// 均用指针以区分「字段未出现」与「字段出现为空」；MVP 仅允许编辑展示名与行政字段，
// id/is_platform_admin/status 等字段不可入体。
type updateTenantRequest struct {
	Name             *string `json:"name"`
	MultiSiteEnabled *bool   `json:"multi_site_enabled"`
}

// ListTenants handles GET /api/v2/platform/tenants，响应 data = {items, total}
// （契约快照 §3 信封）。可选查询参数：status（如 active/suspended）用于筛选
// 指定状态的租户（承接原 networkdomain 版「租户授权字典」能力）。
func (h *Handler) ListTenants(c *gin.Context) {
	page, pageSize := parsePage(c)
	status := c.Query("status")
	list, total, err := h.svc.ListTenants(page, pageSize, status)
	if err != nil {
		writeError(c, err)
		return
	}
	items := make([]tenantDTO, 0, len(list))
	for i := range list {
		items = append(items, toTenantDTO(&list[i]))
	}
	response.OK(c, gin.H{"items": items, "total": total})
}

// GetTenant handles GET /api/v2/platform/tenants/:id（契约快照 §3）。
func (h *Handler) GetTenant(c *gin.Context) {
	tn, err := h.svc.GetTenant(c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, toTenantDTO(tn))
}

// UpdateTenant handles PUT /api/v2/platform/tenants/:id（仅 name / multi_site_enabled）。
func (h *Handler) UpdateTenant(c *gin.Context) {
	var req updateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	tn, err := h.svc.UpdateTenant(c.Param("id"), req.Name, req.MultiSiteEnabled)
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, toTenantDTO(tn))
}

// CreateTenantNotAllowed handles POST /api/v2/platform/tenants（契约快照 §3：
// MVP 不开放新建，返回 forbidden）。
func (h *Handler) CreateTenantNotAllowed(c *gin.Context) {
	response.Forbidden(c, "tenant creation is not allowed in the MVP subset")
}

// UpdateTenantStatusNotAllowed handles PATCH /api/v2/platform/tenants/:id/status
// （契约快照 §3：MVP 不开放禁用，返回 forbidden）。
func (h *Handler) UpdateTenantStatusNotAllowed(c *gin.Context) {
	response.Forbidden(c, "tenant status change is not allowed in the MVP subset")
}

// writeError maps service-layer errors to the standard errorType enumeration
// (03_API_Standard §3): ValidationError->bad_request, ErrNotFound->not_found,
// anything else->internal.
func writeError(c *gin.Context, err error) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		response.BadRequest(c, ve)
	case errors.Is(err, ErrNotFound):
		response.NotFound(c, err.Error())
	default:
		response.InternalServerError(c, err)
	}
}

// errInvalidPayload wraps a JSON binding failure as a bad_request detail.
func errInvalidPayload(err error) error {
	return errors.New("invalid request payload: " + err.Error())
}

// 分页参数约定（API 标准 §7.2）：page 从 1 开始，默认 page_size=20，上限 100。
const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// parsePage parses page / page_size per API 标准 §7.2.
func parsePage(c *gin.Context) (int, int) {
	page := parseIntDefault(c.Query("page"), 1)
	pageSize := parseIntDefault(c.Query("page_size"), defaultPageSize)
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

func parseIntDefault(raw string, def int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return def
	}
	return v
}